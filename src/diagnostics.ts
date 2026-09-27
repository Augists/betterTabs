import { Repository } from "./repository";
import { defaults, exportBackup } from "./model";

export type DiagnosticReport = {
  startedAt: string;
  elapsedMs: number;
  browser: string;
  checks: { name: string; passed: boolean; detail?: string }[];
};

// Real Chrome API checks. All mutations are scoped to IDs created by this run.
// No queries for "all windows" and no modifications to existing BetterTab groups.
export async function runChromeDiagnostics(
  api: typeof chrome,
): Promise<DiagnosticReport> {
  const started = Date.now(),
    token = crypto.randomUUID();
  const report: DiagnosticReport = {
    startedAt: new Date(started).toISOString(),
    elapsedMs: 0,
    browser: navigator.userAgent,
    checks: [],
  };
  const markerUrl = `https://bettertab.invalid/root/v1?diagnostic=${token}`;
  const options = {
    rootName: `BetterTab 自检 ${token.slice(0, 8)}`,
    markerUrl,
    settings: { ...defaults },
  };
  const repo = new Repository(api, options);
  let rootId: string | undefined, windowId: number | undefined;
  const assert = (condition: unknown, detail: string) => {
    if (!condition) throw new Error(detail);
  };
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      report.checks.push({ name, passed: true });
    } catch (error) {
      report.checks.push({ name, passed: false, detail: String(error) });
    }
  };
  const url = (name: string) =>
    `https://example.com/?bettertab-test=${token}-${name}`;
  try {
    const root = await repo.ensureRoot();
    rootId = root.id;
    const win = await api.windows.create({
      url: "about:blank",
      focused: false,
      type: "normal",
    });
    windowId = win?.id;
    if (windowId === undefined) throw new Error("Chrome 未创建测试窗口。");

    await check("真实书签创建与后台重建", async () => {
      const id = await repo.create(
        "持久化自检",
        [{ title: "测试链接", url: url("saved") }],
        { note: "可同步笔记", starred: true },
      );
      const recreated = await new Repository(api, options).group(id);
      assert(
        recreated.items[0].url === url("saved") &&
          recreated.meta.note === "可同步笔记" &&
          recreated.meta.starred,
        "书签或元信息未完整重建",
      );
    });
    await check("根目录改名后仍可识别", async () => {
      await api.bookmarks.update(root.id, {
        title: `已改名的自检目录 ${token.slice(0, 8)}`,
      });
      assert(
        (await repo.roots()).some((r) => r.id === root.id),
        "目录标记未被识别",
      );
    });
    await check("归档后关闭源标签，保留固定标签", async () => {
      const a = await api.tabs.create({
        windowId,
        url: url("archive"),
        active: false,
      });
      const pinned = await api.tabs.create({
        windowId,
        url: url("pinned"),
        pinned: true,
        active: false,
      });
      const result = await repo.archive("window", windowId, a.id);
      assert(
        result.saved === 1 && result.closed === 1,
        `实际保存 ${result.saved}、关闭 ${result.closed}`,
      );
      assert((await api.tabs.get(pinned.id!)).pinned, "固定标签未保留");
    });
    await check("重复地址不关闭", async () => {
      const tab = await api.tabs.create({
        windowId,
        url: url("archive"),
        active: false,
      });
      assert(
        (await repo.archive("current", windowId, tab.id)).saved === 0,
        "重复地址被再次保存",
      );
      await api.tabs.get(tab.id!);
    });
    await check("单条恢复到指定窗口并移除归档", async () => {
      const id = await repo.create("恢复自检", [
        { title: "恢复链接", url: url("restore") },
      ]);
      assert(
        (await repo.restore(id, undefined, false, windowId)) === 1,
        "恢复数量错误",
      );
      assert((await repo.group(id)).items.length === 0, "已恢复条目仍在归档");
      assert(
        (await api.tabs.query({ windowId })).some(
          (t) => (t.pendingUrl || t.url) === url("restore"),
        ),
        "标签被恢复到错误窗口",
      );
    });
    await check("锁定保护与保留恢复", async () => {
      const id = await repo.create(
        "锁定自检",
        [{ title: "锁定链接", url: url("locked") }],
        { locked: true },
      );
      await repo.restore(id, undefined, false, windowId);
      assert((await repo.group(id)).items.length === 1, "锁定组恢复后丢失条目");
      let rejected = false;
      try {
        await repo.trash(id);
      } catch {
        rejected = true;
      }
      assert(rejected, "锁定组未阻止删除");
    });
    await check("Chrome 同组拖拽索引语义", async () => {
      const id = await repo.create(
        "排序自检",
        ["A", "B", "C"].map((title) => ({ title, url: url(title) })),
      );
      const g = await repo.group(id);
      await repo.move(id, id, [g.items[0].id], undefined, g.items[2].id);
      assert(
        (await repo.group(id)).items.map((t) => t.title).join("") === "BAC",
        "向后移动索引错误",
      );
      await repo.move(id, id, [g.items[2].id], undefined, g.items[1].id);
      assert(
        (await repo.group(id)).items.map((t) => t.title).join("") === "CBA",
        "向前移动索引错误",
      );
    });
    await check("跨组移动保留任务和星标", async () => {
      const id = await repo.create(
        "移动源",
        [{ title: "带状态的链接", url: url("move") }],
        {
          items: {
            [url("move")]: { starred: true, task: "todo", quick: true },
          },
        },
      );
      const target = await repo.create("移动目标", []);
      await repo.move(id, target, [(await repo.group(id)).items[0].id]);
      const item = (await repo.group(target)).items[0];
      assert(
        item.starred && item.quick && item.task === "todo",
        "条目状态丢失",
      );
    });
    await check("回收站可以移回资料库", async () => {
      const id = await repo.create("回收站自检", [
        { title: "删除测试链接", url: url("trash") },
      ]);
      await repo.trash(id);
      assert((await repo.group(id)).meta.trashed, "未进入回收站");
      await repo.patch(id, { trashed: false });
      assert(
        !(await repo.group(id)).meta.trashed &&
          (await repo.group(id)).items.length === 1,
        "回收站恢复失败",
      );
    });
    await check("完整备份导入保留笔记与状态", async () => {
      const id = await repo.create(
        "备份自检",
        [{ title: "备份链接", url: url("backup") }],
        { note: "备份笔记", folder: "测试分类", starred: true },
      );
      const old = await repo.group(id);
      await repo.importBackup(exportBackup([old]));
      const copy = (await repo.snapshot()).groups.find(
        (g) => g.title === old.title && g.id !== old.id,
      );
      assert(
        copy &&
          copy.meta.note === old.meta.note &&
          copy.meta.starred &&
          copy.items[0].url === old.items[0].url,
        "完整备份未还原",
      );
    });
    await check("原生 Chrome 标签组恢复", async () => {
      const items = ["native-a", "native-b"].map((name) => ({
        title: name,
        url: url(name),
        native: {
          title: "BetterTab 自检组",
          color: "blue" as const,
          key: token,
        },
      }));
      const id = await repo.create("原生组自检", items);
      await repo.restore(id, undefined, false, windowId);
      const tabs = (await api.tabs.query({ windowId })).filter((t) =>
        items.some((i) => i.url === (t.pendingUrl || t.url)),
      );
      assert(
        tabs.length === 2 &&
          tabs[0].groupId >= 0 &&
          tabs[0].groupId === tabs[1].groupId,
        "原生组未还原",
      );
      const group = await api.tabGroups.get(tabs[0].groupId);
      assert(
        group.title === "BetterTab 自检组" && group.color === "blue",
        "原生组名称或颜色丢失",
      );
    });
    await check("危险地址导入无副作用", async () => {
      const count = (await repo.snapshot()).groups.length;
      let rejected = false;
      try {
        await repo.importText("https://example.com/\n\njavascript:alert(1)");
      } catch {
        rejected = true;
      }
      assert(
        rejected && (await repo.snapshot()).groups.length === count,
        "无效导入出现部分写入",
      );
    });
  } catch (error) {
    report.checks.push({
      name: "测试环境初始化",
      passed: false,
      detail: String(error),
    });
  } finally {
    await check("清理本次自检窗口及书签", async () => {
      if (windowId !== undefined) await api.windows.remove(windowId);
      if (rootId) {
        const children = await api.bookmarks.getChildren(rootId);
        assert(
          children.some((n) => n.url === markerUrl),
          "未找到本次运行标记，停止自动清理",
        );
        await api.bookmarks.removeTree(rootId);
      }
    });
    report.elapsedMs = Date.now() - started;
    await api.storage.local.set({ diagnosticsReport: report });
  }
  return report;
}

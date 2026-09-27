import { Repository } from "./repository";
import { defaults, normalizeSettings } from "./model";
import { validateMessage, isTrustedPage } from "./messages";
import { runChromeDiagnostics } from "./diagnostics";
export function registerBackground(chrome: typeof globalThis.chrome) {
  const repo = new Repository(chrome);
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  }
  async function report(error: unknown) {
    await chrome.storage.local.set({ lastError: String(error) });
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#bb463b" });
  }
  async function dispatch(
    input: unknown,
    sender?: chrome.runtime.MessageSender,
  ) {
    const m = validateMessage(input);
    switch (m.type) {
      case "diagnostics":
        return runChromeDiagnostics(chrome);
      case "snapshot":
        return repo.snapshot();
      case "archive":
        return repo.archive(
          m.scope,
          sender?.tab?.windowId ?? m.windowId,
          m.currentId,
        );
      case "restore":
        return repo.restore(
          m.id,
          m.ids,
          m.newWindow,
          sender?.tab?.windowId ?? m.windowId,
        );
      case "patch":
        return repo.patch(m.id, m.patch, m.title);
      case "create":
        return repo.create(m.title || "新建标签组", []);
      case "trash":
        return repo.trash(m.id, m.ids);
      case "move":
        return repo.move(m.from, m.to, m.ids, m.index, m.before);
      case "reorder": {
        const a = await repo.group(m.id),
          b = await repo.group(m.before);
        if (a.meta.locked || b.meta.locked) throw new Error("请先解锁。");
        const node = (await chrome.bookmarks.get(b.id))[0];
        return chrome.bookmarks.move(a.id, {
          parentId: node.parentId,
          index: node.index,
        });
      }
      case "item": {
        const g = await repo.group(m.id);
        if (!g.items.some((t) => t.url === m.url))
          throw new Error("条目不存在。");
        return repo.patch(g.id, {
          items: {
            ...g.meta.items,
            [m.url]: { ...g.meta.items?.[m.url], ...m.patch },
          },
        });
      }
      case "import":
        return repo.importText(m.text);
      case "import-backup":
        return repo.importBackup(m.text);
      case "purge": {
        const g = await repo.group(m.id);
        if (!g.meta.trashed || g.meta.locked)
          throw new Error("仅可永久删除回收站中未锁定的组。");
        if ((await chrome.bookmarks.getChildren(g.id)).some((n) => !n.url))
          throw new Error("此组包含子文件夹，请先移出，避免误删。");
        return chrome.bookmarks.removeTree(g.id);
      }
      case "settings": {
        const settings = normalizeSettings({
          ...(await repo.settings()),
          ...m.settings,
        });
        await chrome.storage.local.set({ settings });
        await chrome.action.setPopup({
          popup: settings.popup ? "index.html?popup=1" : "",
        });
        return;
      }
      case "library":
        return repo.openLibrary();
      case "bookmarks": {
        const root = await repo.ensureRoot();
        if (chrome.runtime.getURL("").startsWith("moz-extension:"))
          throw new Error("Firefox 请按 Ctrl+Shift+O 打开书签管理器，在“其他书签”中查看 BetterTab 文件夹。");
        return chrome.tabs.create({ url: `chrome://bookmarks/?id=${root.id}` });
      }
      case "clear-error":
        await chrome.storage.local.remove("lastError");
        await chrome.action.setBadgeText({ text: "" });
        return;
      default:
        throw new Error("未知操作。");
    }
  }
  chrome.runtime.onMessage.addListener((m, sender, respond) => {
    if (!isTrustedPage(sender, chrome.runtime)) return;
    enqueue(() => dispatch(m, sender)).then(
      (data) => respond({ ok: true, data }),
      (error) => respond({ ok: false, error: String(error) }),
    );
    return true;
  });
  chrome.runtime.onInstalled.addListener(() => {
    void enqueue(async () => {
      await chrome.contextMenus.removeAll();
      const entries = {
        window: "归档当前窗口",
        current: "只归档此标签",
        selected: "归档选中的标签",
        others: "归档其他标签",
        left: "归档左侧标签",
        right: "归档右侧标签",
        all: "归档所有窗口",
        library: "打开栖签",
      };
      for (const [id, title] of Object.entries(entries))
        chrome.contextMenus.create({ id, title, contexts: ["all"] });
      const settings = { ...defaults, ...(await repo.settings()) };
      await chrome.action.setPopup({
        popup: settings.popup ? "index.html?popup=1" : "",
      });
    }).catch(report);
  });
  chrome.runtime.onStartup.addListener(() => {
    void enqueue(async () => {
      const settings = await repo.settings();
      await chrome.action.setPopup({
        popup: settings.popup ? "index.html?popup=1" : "",
      });
    }).catch(report);
  });
  chrome.action.onClicked.addListener((tab) => {
    void enqueue(() => repo.archive("window", tab.windowId, tab.id)).catch(
      report,
    );
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void enqueue<unknown>(() =>
      info.menuItemId === "library"
        ? repo.openLibrary()
        : repo.archive(String(info.menuItemId), tab?.windowId, tab?.id),
    ).catch(report);
  });
  chrome.commands.onCommand.addListener((command) => {
    if (command !== "open-library" && command !== "archive-window") return;
    void enqueue<unknown>(() =>
      command === "open-library" ? repo.openLibrary() : repo.archive("window"),
    ).catch(report);
  });
  chrome.omnibox.onInputEntered.addListener((text) => {
    void repo.openLibrary(text).catch(report);
  });
  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    const escaped = (s: string) =>
      s.replace(
        /[<>&]/g,
        (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!,
      );
    void repo
      .snapshot()
      .then((s) =>
        suggest(
          s.groups
            .filter((g) => !g.meta.trashed)
            .flatMap((g) => g.items)
            .filter((t) =>
              `${t.title} ${t.url}`.toLowerCase().includes(text.toLowerCase()),
            )
            .slice(0, 6)
            .map((t) => ({ content: t.title, description: escaped(t.title) })),
        ),
      )
      .catch(() => suggest([]));
  });

  return {
    dispatch: (m: unknown, sender?: chrome.runtime.MessageSender) =>
      enqueue(() => dispatch(m, sender)),
    idle: () => queue,
  };
}

import {
  defaults,
  freshMeta,
  parseText,
  parseBackup,
  normalizeSettings,
  type Snapshot,
  type Group,
} from "./model";
const make = (
  title: string,
  folder: string,
  links: [string, string][],
  extra = {},
): Group => ({
  id: crypto.randomUUID(),
  rootId: "demo",
  title,
  meta: { ...freshMeta(), folder, ...extra },
  items: links.map(([title, url]) => ({ id: crypto.randomUUID(), title, url })),
});
export const seed = (): Snapshot => ({
  demo: true,
  roots: [],
  settings: defaults,
  groups: [
    make(
      "让灵感有迹可循",
      "设计灵感",
      [
        ["shadcn/ui — 为你的想法搭建界面", "https://ui.shadcn.com/"],
        ["Layers — A home for your design work", "https://layers.to/"],
        ["Radix Themes · 用细节定义体验", "https://www.radix-ui.com/themes"],
        ["对好设计保持好奇心 — Awwwards", "https://www.awwwards.com/"],
      ],
      { starred: true, quick: true, note: "下一次设计探索，从这里继续。" },
    ),
    make(
      "这周想读的东西",
      "稍后阅读",
      [
        ["The creative process is a practice", "https://www.are.na/"],
        ["构建更好的 Web · web.dev", "https://web.dev/"],
        ["A little room for a new idea", "https://www.notion.so/"],
      ],
      { created: Date.now() - 86400000 },
    ),
    make(
      "BetterTab · 开发参考",
      "工作",
      [
        [
          "Chrome Extensions — 开发者文档",
          "https://developer.chrome.com/docs/extensions/",
        ],
        ["React · The library for user interfaces", "https://react.dev/"],
        [
          "TypeScript — JavaScript with syntax for types",
          "https://www.typescriptlang.org/",
        ],
      ],
      { locked: true, created: Date.now() - 172800000 },
    ),
  ],
});
let state: Snapshot;
function get() {
  if (!state) {
    try {
      state =
        JSON.parse(localStorage.getItem("bettertab-demo") || "null") || seed();
    } catch {
      state = seed();
    }
  }
  return state;
}
export async function demoRequest(m: any): Promise<any> {
  const s = get();
  const g = s.groups.find((g) => g.id === m.id);
  switch (m.type) {
    case "snapshot":
      s.settings = normalizeSettings(s.settings);
      return structuredClone(s);
    case "settings":
      s.settings = { ...s.settings, ...m.settings };
      break;
    case "create": {
      const newGroup = make(m.title || "新建标签组", "", []);
      s.groups.unshift(newGroup);
      localStorage.setItem("bettertab-demo", JSON.stringify(s));
      return newGroup.id;
    }
    case "patch":
      if (g) {
        if (
          g.meta.locked &&
          (m.title || Object.keys(m.patch).some((k) => k !== "locked"))
        )
          throw new Error("请先解锁。");
        g.meta = { ...g.meta, ...m.patch };
        if (m.title) g.title = m.title;
      }
      break;
    case "item":
      if (g && !g.meta.locked) {
        g.meta.items = {
          ...g.meta.items,
          [m.url]: { ...g.meta.items?.[m.url], ...m.patch },
        };
        g.items = g.items.map((t) =>
          t.url === m.url ? { ...t, ...m.patch } : t,
        );
      }
      break;
    case "trash":
      if (g) {
        if (g.meta.locked) throw new Error("锁定组不能删除。");
        if (m.ids) {
          const dest = make(`来自 ${g.title}`, "", [], { trashed: true });
          dest.items = g.items.filter((t) => m.ids.includes(t.id));
          g.items = g.items.filter((t) => !m.ids.includes(t.id));
          s.groups.push(dest);
        } else g.meta.trashed = true;
      }
      break;
    case "purge":
      if (g?.meta.trashed) s.groups = s.groups.filter((x) => x !== g);
      break;
    case "move": {
      const from = s.groups.find((g) => g.id === m.from),
        to = s.groups.find((g) => g.id === m.to);
      if (from && to) {
        if (from.meta.locked || to.meta.locked) throw new Error("请先解锁。");
        const items = from.items.filter((t) => m.ids.includes(t.id));
        from.items = from.items.filter((t) => !m.ids.includes(t.id));
        to.items.splice(m.index ?? to.items.length, 0, ...items);
      }
      break;
    }
    case "reorder": {
      const a = s.groups.find((x) => x.id === m.id);
      if (a) {
        s.groups = s.groups.filter((x) => x !== a);
        s.groups.splice(
          s.groups.findIndex((x) => x.id === m.before),
          0,
          a,
        );
      }
      break;
    }
    case "import":
      for (const x of parseText(m.text))
        s.groups.unshift(
          make(
            x.title,
            "",
            x.items.map((t) => [t.title, t.url]),
          ),
        );
      break;
    case "import-backup":
      for (const g of parseBackup(m.text)) {
        const imported = make(
          g.title,
          g.meta.folder || "",
          g.items.map((t) => [t.title, t.url]),
          { ...g.meta, uuid: crypto.randomUUID() },
        );
        imported.items = imported.items.map((t) => ({
          ...g.meta.items?.[t.url],
          ...t,
        }));
        s.groups.unshift(imported);
      }
      break;
    case "diagnostics":
      throw new Error("请在 Chrome 扩展中运行自检。");
    case "restore":
      throw new Error(
        "这是界面样例。真实标签恢复请在 Chrome 加载 dist 扩展后体验。",
      );
    case "archive":
      throw new Error("这是界面样例。加载 Chrome 扩展后即可归档真实标签。");
    case "bookmarks":
      throw new Error("界面样例不访问你的书签，请在 Chrome 扩展中打开。");
  }
  localStorage.setItem("bettertab-demo", JSON.stringify(s));
}
export const isExtension =
  typeof chrome !== "undefined" && !!chrome.runtime?.id;
export async function request<T = any>(message: any): Promise<T> {
  if (!isExtension) {
    if (location.protocol === "chrome-extension:")
      throw new Error("扩展连接已失效，请刷新管理页。");
    return demoRequest(message);
  }
  if (
    (message.type === "archive" || message.type === "restore") &&
    message.windowId === undefined
  ) {
    message = { ...message, windowId: (await chrome.windows.getCurrent()).id };
  }
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok)
    throw new Error(response?.error || "后台未响应，请重新加载扩展。");
  return response.data;
}

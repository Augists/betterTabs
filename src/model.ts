export type Item = {
  id: string;
  title: string;
  url: string;
  starred?: boolean;
  quick?: boolean;
  task?: "todo" | "done" | null;
  native?: {
    title: string;
    color: chrome.tabGroups.TabGroup["color"];
    key: string;
  };
};
export type Meta = {
  version: 1;
  uuid: string;
  created: number;
  starred?: boolean;
  locked?: boolean;
  note?: string;
  folder?: string;
  quick?: boolean;
  trashed?: boolean;
  items?: Record<string, Partial<Item>>;
};
export type Group = {
  id: string;
  rootId: string;
  title: string;
  meta: Meta;
  items: Item[];
};
export type Settings = {
  includePinned: boolean;
  keepRestored: boolean;
  newWindow: boolean;
  dedupe: boolean;
  excluded: string;
  popup: boolean;
  theme: "light" | "dark" | "system";
};
export const defaults: Settings = {
  includePinned: false,
  keepRestored: false,
  newWindow: false,
  dedupe: true,
  excluded: "",
  popup: false,
  theme: "light",
};
export type Snapshot = {
  groups: Group[];
  roots: { id: string; syncing: boolean | null }[];
  settings: Settings;
  demo?: boolean;
  lastError?: string;
};
export const ROOT = "BetterTab";
export const META_TITLE = "⚙ BetterTab metadata — 请保留";
// Reserved .invalid domain: never contacted. Portable across extension installations.
export const META_URL = "https://bettertab.invalid/meta/v1#";
export const ROOT_URL = "https://bettertab.invalid/root/v1";
export const freshMeta = (): Meta => ({
  version: 1,
  uuid: crypto.randomUUID(),
  created: Date.now(),
  items: {},
});
export function safeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname !== "bettertab.invalid" &&
      ["http:", "https:", "file:", "ftp:"].includes(parsed.protocol)
    );
  } catch {
    return false;
  }
}
export function readMeta(url?: string): Meta | undefined {
  try {
    if (!url?.startsWith(META_URL)) return;
    const m = JSON.parse(decodeURIComponent(url.slice(META_URL.length)));
    if (
      m &&
      m.version === 1 &&
      typeof m.uuid === "string" &&
      typeof m.created === "number" &&
      Number.isFinite(m.created) &&
      ["starred", "locked", "quick", "trashed"].every(
        (k) => m[k] === undefined || typeof m[k] === "boolean",
      ) &&
      ["note", "folder"].every(
        (k) => m[k] === undefined || typeof m[k] === "string",
      ) &&
      (m.items === undefined ||
        (m.items && typeof m.items === "object" && !Array.isArray(m.items)))
    )
      return m;
  } catch {
    /* A damaged metadata bookmark must never hide actual tabs. */
  }
}
export function normalizeSettings(raw: unknown): Settings {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const settings = { ...defaults };
  for (const key of [
    "includePinned",
    "keepRestored",
    "newWindow",
    "dedupe",
    "popup",
  ] as const) {
    if (typeof value[key] === "boolean") settings[key] = value[key];
  }
  if (typeof value.excluded === "string") settings.excluded = value.excluded;
  if (["light", "dark", "system"].includes(String(value.theme)))
    settings.theme = value.theme as Settings["theme"];
  return settings;
}

export type Backup = {
  format: "bettertab";
  version: 1;
  exportedAt: string;
  groups: { title: string; meta: Meta; items: Pick<Item, "url" | "title">[] }[];
};
export function exportBackup(groups: Group[]): string {
  const data: Backup = {
    format: "bettertab",
    version: 1,
    exportedAt: new Date().toISOString(),
    groups: groups.map((g) => ({
      title: g.title,
      meta: g.meta,
      items: g.items.map(({ title, url }) => ({ title, url })),
    })),
  };
  return JSON.stringify(data, null, 2);
}
export function parseBackup(text: string): Backup["groups"] {
  let data: Backup;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("备份文件不是有效的 JSON。");
  }
  if (
    !data ||
    data.format !== "bettertab" ||
    data.version !== 1 ||
    !Array.isArray(data.groups)
  )
    throw new Error("不支持此备份格式或版本。");
  for (const g of data.groups) {
    if (
      !g ||
      typeof g.title !== "string" ||
      !Array.isArray(g.items) ||
      !readMeta(encodeMeta(g.meta))
    )
      throw new Error("备份分组数据无效。");
    for (const t of g.items)
      if (
        !t ||
        typeof t.title !== "string" ||
        typeof t.url !== "string" ||
        !safeUrl(t.url)
      )
        throw new Error("备份包含无效或不支持的链接。");
  }
  return data.groups;
}
export const encodeMeta = (m: Meta) =>
  META_URL + encodeURIComponent(JSON.stringify(m));
export function parseText(
  text: string,
): { title: string; items: { title: string; url: string }[] }[] {
  return text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((block, i) => ({
      title: `导入的标签 ${i + 1}`,
      items: block
        .split(/\r?\n/)
        .filter((x) => x.trim())
        .map((line) => {
          const split = line.indexOf(" | ");
          const url = (split < 0 ? line : line.slice(0, split)).trim();
          if (!safeUrl(url))
            throw new Error(`无法导入此地址：${url.slice(0, 90)}`);
          return {
            url,
            title: split < 0 ? url : line.slice(split + 3).trim() || url,
          };
        }),
    }))
    .filter((g) => g.items.length);
}
export const exportText = (groups: Group[]) =>
  groups
    .map((g) =>
      g.items
        .map((t) => `${t.url} | ${t.title.replace(/[\r\n]+/g, " ")}`)
        .join("\n"),
    )
    .join("\n\n");
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function shareHtml(groups: Group[]) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>栖签 · 分享的标签</title><style>body{font:16px system-ui;max-width:800px;margin:60px auto;padding:24px;background:#faf9f6;color:#25352c}a{color:#26714c}li{margin:18px 0}h1{font-size:32px}</style><h1>值得留下的标签</h1>${groups
    .map(
      (g) =>
        `<section><h2>${escapeHtml(g.title)}</h2><ul>${g.items
          .filter((t) => safeUrl(t.url))
          .map(
            (t) =>
              `<li><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t.title)}</a></li>`,
          )
          .join("")}</ul></section>`,
    )
    .join("")}</html>`;
}

import type { Meta, Settings } from "./model";

export type Scope =
  "window" | "all" | "current" | "selected" | "others" | "left" | "right";
export type Message =
  | {
      type:
        "snapshot" | "library" | "bookmarks" | "clear-error" | "diagnostics";
    }
  | { type: "archive"; scope: Scope; windowId?: number; currentId?: number }
  | {
      type: "restore";
      id: string;
      ids?: string[];
      newWindow?: boolean;
      windowId?: number;
    }
  | { type: "patch"; id: string; patch: Partial<Meta>; title?: string }
  | { type: "create"; title?: string }
  | { type: "trash"; id: string; ids?: string[] }
  | {
      type: "move";
      from: string;
      to: string;
      ids: string[];
      before?: string;
      index?: number;
    }
  | { type: "reorder"; id: string; before: string }
  | {
      type: "item";
      id: string;
      url: string;
      patch: {
        starred?: boolean;
        quick?: boolean;
        task?: "todo" | "done" | null;
      };
    }
  | { type: "import" | "import-backup"; text: string }
  | { type: "purge"; id: string }
  | { type: "settings"; settings: Partial<Settings> };

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown) => typeof v === "string" && v.length > 0;
const ids = (v: unknown) =>
  Array.isArray(v) && v.length <= 20000 && v.every(string);
const optional = (v: unknown, test: (v: unknown) => boolean) =>
  v === undefined || test(v);
const integer = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;
export function validateMessage(value: unknown): Message {
  if (!object(value)) throw new Error("操作参数无效。");
  const m = value;
  let valid = true;
  switch (m.type) {
    case "snapshot":
    case "library":
    case "bookmarks":
    case "clear-error":
    case "diagnostics":
      break;
    case "archive":
      valid =
        [
          "window",
          "all",
          "current",
          "selected",
          "others",
          "left",
          "right",
        ].includes(String(m.scope)) &&
        optional(m.windowId, integer) &&
        optional(m.currentId, integer);
      break;
    case "restore":
      valid =
        string(m.id) &&
        optional(m.ids, ids) &&
        optional(m.newWindow, (v) => typeof v === "boolean") &&
        optional(m.windowId, integer);
      break;
    case "trash":
      valid = string(m.id) && optional(m.ids, ids);
      break;
    case "purge":
      valid = string(m.id);
      break;
    case "move":
      valid =
        string(m.from) &&
        string(m.to) &&
        ids(m.ids) &&
        optional(m.before, string) &&
        optional(m.index, integer);
      break;
    case "reorder":
      valid = string(m.id) && string(m.before);
      break;
    case "create":
      valid = optional(
        m.title,
        (v) => typeof v === "string" && v.length <= 500,
      );
      break;
    case "patch":
      valid =
        string(m.id) &&
        optional(m.title, (v) => typeof v === "string" && v.length <= 500) &&
        object(m.patch) &&
        Object.entries(m.patch).every(([k, v]) =>
          ["starred", "locked", "quick", "trashed"].includes(k)
            ? typeof v === "boolean"
            : ["note", "folder"].includes(k) &&
              typeof v === "string" &&
              v.length <= (k === "note" ? 4000 : 500),
        );
      break;
    case "item":
      valid =
        string(m.id) &&
        string(m.url) &&
        object(m.patch) &&
        Object.entries(m.patch).every(([k, v]) =>
          k === "task"
            ? v === null || v === "todo" || v === "done"
            : ["starred", "quick"].includes(k) && typeof v === "boolean",
        );
      break;
    case "settings":
      valid =
        object(m.settings) &&
        Object.entries(m.settings).every(([k, v]) =>
          [
            "includePinned",
            "keepRestored",
            "newWindow",
            "dedupe",
            "popup",
          ].includes(k)
            ? typeof v === "boolean"
            : k === "theme"
              ? ["light", "dark", "system"].includes(String(v))
              : k === "excluded" && typeof v === "string" && v.length <= 20000,
        );
      break;
    case "import":
    case "import-backup":
      valid = typeof m.text === "string" && m.text.length <= 20_000_000;
      break;
    default:
      valid = false;
  }
  if (!valid) throw new Error("操作参数无效，请刷新扩展页面后重试。");
  return m as Message;
}

export function isTrustedPage(
  sender: chrome.runtime.MessageSender,
  runtime: Pick<typeof chrome.runtime, "id" | "getURL">,
) {
  if (sender.id !== runtime.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    const page = new URL(runtime.getURL("index.html"));
    return (
      (url.protocol === "chrome-extension:" || url.protocol === "moz-extension:") &&
      url.host === page.host &&
      url.pathname === page.pathname
    );
  } catch {
    return false;
  }
}

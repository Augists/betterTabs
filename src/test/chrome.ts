import { vi } from "vitest";
import { Repository } from "../repository";
export function fixture(
  options: {
    failAt?: number;
    failTab?: number;
    navigate?: boolean;
    account?: boolean;
  } = {},
) {
  let counter = 2,
    created = 0;
  const nodes = new Map<string, any>([
    ["0", { id: "0", title: "", children: [] }],
    [
      "1",
      {
        id: "1",
        parentId: "0",
        title: "Other",
        folderType: "other",
        syncing: options.account !== false,
      },
    ],
  ]);
  const storage: any = {};
  const tabs = [
    {
      id: 10,
      windowId: 1,
      index: 0,
      title: "A",
      url: "https://a.test/",
      active: true,
      highlighted: true,
      groupId: -1,
    },
    {
      id: 11,
      windowId: 1,
      index: 1,
      title: "B",
      url: "https://b.test/",
      groupId: -1,
    },
  ];
  const get = (id: string) => {
    const n = nodes.get(id);
    if (!n) throw new Error("Missing bookmark");
    return n;
  };
  const children = (id: string): any[] =>
    [...nodes.values()]
      .filter((n) => n.parentId === id)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const reindex = (list: any[]) =>
    list.forEach((n, index) => (n.index = index));
  const tree = (id: string): any => ({
    ...get(id),
    children: children(id).map((n) => (n.url ? { ...n } : tree(n.id))),
  });
  const api: any = {
    bookmarks: {
      search: vi.fn(async (query: any) =>
        [...nodes.values()].filter((n) =>
          Object.entries(query).every(([key, value]) => n[key] === value),
        ),
      ),
      get: vi.fn(async (id: string) => [{ ...get(id) }]),
      getTree: vi.fn(async () => [tree("0")]),
      getSubTree: vi.fn(async (id: string) => [tree(id)]),
      getChildren: vi.fn(async (id: string) =>
        children(id).map((n) => ({ ...n })),
      ),
      create: vi.fn(async (data: any) => {
        if (++created === options.failAt) throw new Error("Disk full");
        const n = {
          ...data,
          id: String(counter++),
          dateAdded: Date.now(),
          syncing: get(data.parentId).syncing,
          index: data.index ?? children(data.parentId).length,
        };
        const siblings = children(data.parentId);
        siblings.splice(n.index, 0, n);
        reindex(siblings);
        nodes.set(n.id, n);
        return { ...n };
      }),
      update: vi.fn(async (id: string, data: any) => {
        Object.assign(get(id), data);
        return { ...get(id) };
      }),
      move: vi.fn(async (id: string, data: any) => {
        const n = get(id),
          oldParent = n.parentId,
          parentId = data.parentId ?? oldParent;
        const destination = children(parentId);
        let index = data.index ?? destination.length;
        if (oldParent === parentId && index > n.index) index--;
        const siblings = destination.filter((x) => x.id !== id);
        n.parentId = parentId;
        siblings.splice(index, 0, n);
        reindex(siblings);
        if (oldParent !== parentId) reindex(children(oldParent));
        return { ...get(id) };
      }),
      remove: vi.fn(async (id: string) => {
        const parent = get(id).parentId;
        nodes.delete(id);
        reindex(children(parent));
      }),
      removeTree: vi.fn(async (id: string) => {
        const remove = (id: string) => {
          children(id).forEach((n) => remove(n.id));
          nodes.delete(id);
        };
        remove(id);
      }),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (data: any) => Object.assign(storage, data)),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
    tabs: {
      query: vi.fn(async (query: any) =>
        tabs.filter(
          (t) =>
            (query.windowId === undefined || t.windowId === query.windowId) &&
            (!query.active || t.active) &&
            (!query.highlighted || t.highlighted),
        ),
      ),
      get: vi.fn(async (id: number) => ({
        ...tabs.find((t) => t.id === id),
        ...(options.navigate ? { url: "https://changed.test/" } : {}),
      })),
      create: vi.fn(async (data: any) => {
        if (
          options.failTab &&
          api.tabs.create.mock.calls.length === options.failTab
        )
          throw new Error("Tab creation failed");
        return { ...data, id: 100 + api.tabs.create.mock.calls.length };
      }),
      remove: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      group: vi.fn(async () => 1),
    },
    tabGroups: {
      get: vi.fn(async () => ({ title: "Research", color: "blue" })),
      update: vi.fn(async () => {}),
    },
    windows: {
      getLastFocused: vi.fn(async () => ({ id: 1 })),
      update: vi.fn(async () => {}),
      create: vi.fn(async () => ({ id: 2, tabs: [{ id: 50 }] })),
    },
    runtime: {
      id: "test",
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
    },
    action: {
      onClicked: event(),
      setPopup: vi.fn(async () => {}),
      setBadgeText: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
    },
    contextMenus: {
      onClicked: event(),
      removeAll: vi.fn(async () => {}),
      create: vi.fn((data: any, callback?: () => void) => {
        callback?.();
        return data.id;
      }),
    },
    commands: { onCommand: event() },
    omnibox: { onInputEntered: event(), onInputChanged: event() },
  };
  return { api, repo: new Repository(api), nodes, storage, tabs };
}
export function event() {
  const listeners: ((...args: any[]) => any)[] = [];
  return {
    addListener: vi.fn((listener: (...args: any[]) => any) =>
      listeners.push(listener),
    ),
    emit: (...args: any[]) => listeners.map((fn) => fn(...args)),
    listeners,
  };
}

import {
  ROOT,
  ROOT_URL,
  META_TITLE,
  META_URL,
  defaults,
  freshMeta,
  readMeta,
  encodeMeta,
  safeUrl,
  parseText,
  parseBackup,
  normalizeSettings,
  type Group,
  type Meta,
  type Item,
  type Snapshot,
  type Settings,
} from "./model";

export class Repository {
  constructor(
    private api: typeof chrome,
    private options: {
      rootName?: string;
      markerUrl?: string;
      settings?: Settings;
    } = {},
  ) {}
  private get markerUrl() {
    return this.options.markerUrl ?? ROOT_URL;
  }
  async roots() {
    const named = await this.api.bookmarks.search({
      title: this.options.rootName ?? ROOT,
    });
    const markers = await this.api.bookmarks.search({ url: this.markerUrl });
    const marked = await Promise.all(
      markers
        .filter((m) => m.parentId)
        .map(async (m) => {
          try {
            return (await this.api.bookmarks.get(m.parentId!))[0];
          } catch {
            return undefined;
          }
        }),
    );
    const all = [
      ...new Map(
        [
          ...named,
          ...marked.filter((n): n is chrome.bookmarks.BookmarkTreeNode => !!n),
        ].map((n) => [n.id, n]),
      ).values(),
    ];
    const candidates = all.filter((n) => !n.url && !n.unmodifiable);
    // A user-created group named BetterTab must not become another archive root.
    const ids = new Set(candidates.map((n) => n.id));
    const roots = [];
    for (const n of candidates) {
      let parent = n.parentId,
        nested = false;
      while (parent && parent !== "0") {
        if (ids.has(parent)) {
          nested = true;
          break;
        }
        parent = (await this.api.bookmarks.get(parent))[0]?.parentId;
      }
      if (!nested) roots.push(n);
    }
    return roots;
  }
  async ensureRoot() {
    const roots = await this.roots();
    if (roots.length) {
      const root = roots.find((n) => n.syncing) ?? roots[0];
      await this.ensureMarker(root.id);
      return root;
    }
    const tree = await this.api.bookmarks.getTree();
    const parents =
      tree[0].children?.filter(
        (n) => !n.unmodifiable && n.folderType !== "managed",
      ) ?? [];
    const parent =
      parents.find((n) => n.syncing && n.folderType === "other") ??
      parents.find((n) => n.syncing) ??
      parents.find((n) => n.folderType === "other" || n.id === "unfiled_____") ??
      parents[0];
    if (!parent) throw new Error("找不到可写的书签目录。");
    const root = await this.api.bookmarks.create({
      parentId: parent.id,
      title: this.options.rootName ?? ROOT,
    });
    await this.ensureMarker(root.id);
    return root;
  }
  private async ensureMarker(id: string) {
    if (
      !(await this.api.bookmarks.getChildren(id)).some(
        (n) => n.url === this.markerUrl,
      )
    )
      await this.api.bookmarks.create({
        parentId: id,
        title: "⚙ BetterTab archive — 请保留",
        url: this.markerUrl,
      });
  }
  async settings(): Promise<Settings> {
    return (
      this.options.settings ??
      normalizeSettings((await this.api.storage.local.get("settings")).settings)
    );
  }
  async snapshot(): Promise<Snapshot> {
    const roots = await this.roots();
    const groups: Group[] = [];
    const walk = (
      node: chrome.bookmarks.BookmarkTreeNode,
      rootId: string,
      path = "",
    ) => {
      const children = node.children ?? [];
      const links = children.filter(
        (n) => n.url && !n.url.startsWith(META_URL) && n.url !== this.markerUrl,
      );
      const metaNode = children.find((n) => n.url?.startsWith(META_URL));
      if (
        node.id !== rootId &&
        (links.length || metaNode || !children.length)
      ) {
        const meta = readMeta(metaNode?.url) ?? {
          version: 1 as const,
          uuid: `legacy-${node.id}`,
          created: node.dateAdded ?? Date.now(),
          // Corrupted metadata may contain a lock. Preserve links, fail closed on deletion.
          locked: !!metaNode,
        };
        groups.push({
          id: node.id,
          rootId,
          title: node.title,
          meta: { ...meta, folder: meta.folder || path },
          items: links.map((n) => ({
            ...meta.items?.[n.url!],
            id: n.id,
            title: n.title,
            url: n.url!,
          })),
        });
      }
      for (const child of children.filter((n) => !n.url))
        walk(
          child,
          rootId,
          node.id === rootId
            ? ""
            : [path, node.title].filter(Boolean).join(" / "),
        );
    };
    for (const root of roots)
      walk((await this.api.bookmarks.getSubTree(root.id))[0], root.id);
    return {
      groups,
      roots: roots.map((r) => ({
        id: r.id,
        syncing: typeof r.syncing === "boolean" ? r.syncing : null,
      })),
      settings: await this.settings(),
      lastError: (await this.api.storage.local.get("lastError")).lastError as
        string | undefined,
    };
  }
  async group(id: string) {
    const g = (await this.snapshot()).groups.find((g) => g.id === id);
    if (!g) throw new Error("这组标签已被移动或删除，请刷新后重试。");
    return g;
  }
  async writeMeta(id: string, meta: Meta) {
    const nodes = await this.api.bookmarks.getChildren(id);
    const node = nodes.find((n) => n.url?.startsWith(META_URL));
    const url = encodeMeta(meta);
    if (node) await this.api.bookmarks.update(node.id, { url });
    else
      await this.api.bookmarks.create({ parentId: id, title: META_TITLE, url });
  }
  async create(
    title: string,
    items: Pick<Item, "title" | "url" | "native">[],
    meta?: Partial<Meta>,
  ) {
    if (items.some((t) => !safeUrl(t.url)))
      throw new Error("仅支持 HTTP、HTTPS、FTP 与 file 地址。");
    items = items.map((t) => ({ ...t, url: new URL(t.url).href }));
    const root = await this.ensureRoot();
    const folder = await this.api.bookmarks.create({
      parentId: root.id,
      title: title.trim() || "未命名标签组",
      index: 0,
    });
    // Keep partially saved groups on failure. Source tabs remain open.
    const m = { ...freshMeta(), ...meta };
    m.items = { ...m.items };
    for (const t of items)
      if (t.native) m.items[t.url] = { ...m.items[t.url], native: t.native };
    await this.writeMeta(folder.id, m);
    for (const t of items)
      await this.api.bookmarks.create({
        parentId: folder.id,
        title: t.title || t.url,
        url: t.url,
      });
    return folder.id;
  }
  async patch(id: string, patch: Partial<Meta>, title?: string) {
    const g = await this.group(id);
    if (g.meta.locked && Object.keys(patch).some((k) => k !== "locked"))
      throw new Error("请先解锁此组。");
    if (title !== undefined) {
      if (g.meta.locked) throw new Error("请先解锁此组。");
      await this.api.bookmarks.update(id, {
        title: title.trim() || "未命名标签组",
      });
    }
    await this.writeMeta(id, { ...g.meta, ...patch });
  }
  async trash(id: string, itemIds?: string[]) {
    const g = await this.group(id);
    if (g.meta.locked) throw new Error("锁定组不能删除。");
    if (!itemIds) {
      if ((await this.api.bookmarks.getChildren(id)).some((n) => !n.url))
        throw new Error("此组包含子文件夹，请先移出子文件夹再删除。");
      await this.patch(id, { trashed: true });
      return;
    }
    const items = g.items.filter((t) => itemIds.includes(t.id));
    if (!items.length) return;
    const destination = await this.create(`来自 ${g.title}`, [], {
      trashed: true,
      items: g.meta.items,
    });
    for (const t of items)
      await this.api.bookmarks.move(t.id, { parentId: destination });
  }
  async move(
    fromId: string,
    toId: string,
    itemIds: string[],
    index?: number,
    beforeId?: string,
  ) {
    const from = await this.group(fromId),
      to = await this.group(toId);
    if (from.meta.locked || to.meta.locked || to.meta.trashed)
      throw new Error("锁定组或回收站不接受移动。");
    const items = from.items.filter((t) => itemIds.includes(t.id));
    if (beforeId) {
      if (itemIds.includes(beforeId)) return;
      const before = (await this.api.bookmarks.get(beforeId))[0];
      if (before.parentId !== toId || !to.items.some((t) => t.id === beforeId))
        throw new Error("目标标签已移动，请刷新重试。");
      index = before.index;
    }
    // Destination metadata is saved before moving URLs, preserving source info if a move fails.
    const states = { ...to.meta.items };
    for (const t of items)
      if (from.meta.items?.[t.url]) states[t.url] = from.meta.items[t.url];
    await this.writeMeta(to.id, { ...to.meta, items: states });
    // Chrome interprets same-folder indices before removing the source node.
    // Re-read the anchor for every move instead of caching indices across writes.
    let i = index;
    for (const t of items) {
      const at = beforeId
        ? (await this.api.bookmarks.get(beforeId))[0].index
        : i;
      await this.api.bookmarks.move(t.id, {
        parentId: to.id,
        ...(at === undefined ? {} : { index: at }),
      });
      if (!beforeId && i !== undefined) i++;
    }
  }
  async restore(
    id: string,
    ids?: string[],
    newWindow?: boolean,
    destinationWindow?: number,
  ) {
    const g = await this.group(id),
      settings = await this.settings();
    const items = g.items.filter(
      (t) => (!ids || ids.includes(t.id)) && safeUrl(t.url),
    );
    if (!items.length) return 0;
    let windowId = destinationWindow;
    if (!(newWindow ?? settings.newWindow) && windowId === undefined)
      windowId = (
        await this.api.windows.getLastFocused({ windowTypes: ["normal"] })
      ).id;
    const opened: { item: Item; tabId: number }[] = [];
    if (newWindow ?? settings.newWindow) {
      const win = await this.api.windows.create({ url: items[0].url });
      windowId = win?.id;
      if (!win?.tabs?.[0]?.id)
        throw new Error("新窗口未返回标签，归档保持不变。");
      opened.push({ item: items[0], tabId: win.tabs[0].id });
    }
    try {
      for (const item of items.slice(opened.length)) {
        const tab = await this.api.tabs.create({
          url: item.url,
          active: items.length === 1,
          ...(windowId === undefined ? {} : { windowId }),
        });
        if (tab.id !== undefined) opened.push({ item, tabId: tab.id });
      }
      const nativeGroups = new Map<string, typeof opened>();
      for (const t of opened)
        if (t.item.native)
          nativeGroups.set(t.item.native.key, [
            ...(nativeGroups.get(t.item.native.key) ?? []),
            t,
          ]);
      for (const entries of nativeGroups.values()) {
        const gid = await this.api.tabs.group({
          tabIds: entries.map((t) => t.tabId) as [number, ...number[]],
        });
        await this.api.tabGroups.update(gid, {
          title: entries[0].item.native!.title,
          color: entries[0].item.native!.color,
        });
      }
    } catch (error) {
      throw new Error(`恢复未全部完成，归档仍保留：${String(error)}`);
    }
    if (!settings.keepRestored && !g.meta.locked && !g.meta.trashed) {
      for (const t of opened) {
        const latest = await this.group(id);
        if (latest.meta.locked) break;
        const now = latest.items.find((i) => i.id === t.item.id);
        if (now?.url === t.item.url) await this.api.bookmarks.remove(t.item.id);
      }
    }
    return opened.length;
  }
  async archive(scope: string, windowId?: number, currentId?: number) {
    if (
      ![
        "window",
        "all",
        "current",
        "selected",
        "others",
        "left",
        "right",
      ].includes(scope)
    )
      throw new Error("无效的归档范围。");
    const settings = await this.settings();
    const active = currentId
      ? await this.api.tabs.get(currentId)
      : (
          await this.api.tabs.query({ active: true, lastFocusedWindow: true })
        )[0];
    const sourceWindow = windowId ?? active?.windowId;
    if (scope !== "all" && sourceWindow === undefined)
      throw new Error("没有可归档的浏览器窗口。");
    const tabs = await this.api.tabs.query(
      scope === "all" ? {} : { windowId: sourceWindow },
    );
    const excluded = settings.excluded
      .split(/[\s,，]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    const seen = new Set(
      settings.dedupe
        ? (await this.snapshot()).groups
            .filter((g) => !g.meta.trashed)
            .flatMap((g) => g.items.map((t) => t.url))
        : [],
    );
    const selected: chrome.tabs.Tab[] = [];
    for (const t of tabs.sort(
      (a, b) => a.windowId - b.windowId || a.index - b.index,
    )) {
      const url = t.pendingUrl || t.url;
      if (!url || !safeUrl(url) || (!settings.includePinned && t.pinned))
        continue;
      const host = new URL(url).hostname.toLowerCase();
      if (excluded.some((d) => host === d || host.endsWith(`.${d}`))) continue;
      if (
        (scope === "current" && t.id !== active?.id) ||
        (scope === "selected" && !t.highlighted) ||
        (scope === "others" && t.id === active?.id) ||
        (scope === "left" && t.index >= (active?.index ?? 0)) ||
        (scope === "right" && t.index <= (active?.index ?? Infinity))
      )
        continue;
      if (settings.dedupe && seen.has(url)) continue;
      seen.add(url);
      selected.push(t);
    }
    if (!selected.length) {
      await this.openLibrary();
      return { saved: 0, closed: 0 };
    }
    const archiveKey = crypto.randomUUID();
    const items: Pick<Item, "title" | "url" | "native">[] = [];
    for (const t of selected) {
      let native: Item["native"];
      if (t.groupId !== undefined && t.groupId >= 0) {
        const g = await this.api.tabGroups.get(t.groupId);
        native = {
          key: `${archiveKey}-${t.windowId}-${t.groupId}`,
          title: g.title || "",
          color: g.color,
        };
      }
      items.push({
        title: t.title || t.url || "",
        url: (t.pendingUrl || t.url)!,
        native,
      });
    }
    const id = await this.create(
      new Date().toLocaleString("zh-CN", {
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      items,
    );
    const saved = await this.group(id);
    if (
      saved.items.length !== selected.length ||
      selected.some(
        (t) => !saved.items.some((b) => b.url === (t.pendingUrl || t.url)),
      )
    )
      throw new Error("书签校验失败，源标签未关闭。");
    // Open the library before closing the last remaining source tab/window.
    await this.openLibrary();
    let closed = 0;
    for (const t of selected) {
      try {
        const now = await this.api.tabs.get(t.id!);
        if ((now.pendingUrl || now.url) === (t.pendingUrl || t.url)) {
          await this.api.tabs.remove(t.id!);
          closed++;
        }
      } catch {
        /* Already closed or inaccessible: archive is still safe. */
      }
    }
    return { saved: selected.length, closed };
  }
  async openLibrary(query = "") {
    const url = this.api.runtime.getURL("index.html");
    const existing = (await this.api.tabs.query({})).find(
      (t) => t.url?.startsWith(url) && !t.url.includes("popup=1"),
    );
    if (existing?.id) {
      await this.api.tabs.update(existing.id, {
        active: true,
        ...(query ? { url: `${url}?q=${encodeURIComponent(query)}` } : {}),
      });
      await this.api.windows.update(existing.windowId, { focused: true });
    } else
      await this.api.tabs.create({
        url: query ? `${url}?q=${encodeURIComponent(query)}` : url,
      });
  }
  async importText(text: string) {
    const groups = parseText(text);
    for (const g of groups) await this.create(g.title, g.items);
    return groups.reduce((n, g) => n + g.items.length, 0);
  }
  async importBackup(text: string) {
    const groups = parseBackup(text);
    for (const g of groups)
      await this.create(g.title, g.items, {
        ...g.meta,
        uuid: crypto.randomUUID(),
      });
    return groups.reduce((n, g) => n + g.items.length, 0);
  }
}

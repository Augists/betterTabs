import { describe, it, expect, vi } from "vitest";
import { Repository } from "./repository";
import {
  META_URL,
  encodeMeta,
  exportText,
  freshMeta,
  parseText,
  safeUrl,
  shareHtml,
} from "./model";

import { fixture } from "./test/chrome";

describe("archive data safety", () => {
  it("saves ordinary bookmarks before closing source tabs", async () => {
    const { repo, api } = fixture();
    expect(await repo.archive("window")).toEqual({ saved: 2, closed: 2 });
    const snapshot = await repo.snapshot();
    expect(snapshot.groups[0].items.map((t) => t.url)).toEqual([
      "https://a.test/",
      "https://b.test/",
    ]);
    expect(snapshot.roots[0].syncing).toBe(true);
    expect(api.bookmarks.create.mock.invocationCallOrder.at(-1)).toBeLessThan(
      api.tabs.remove.mock.invocationCallOrder[0],
    );
  });
  it("never closes source tabs when a bookmark write fails mid-archive", async () => {
    const { repo, api } = fixture({ failAt: 6 });
    await expect(repo.archive("window")).rejects.toThrow("Disk full");
    expect(api.tabs.remove).not.toHaveBeenCalled();
    expect((await repo.snapshot()).groups[0].items).toHaveLength(1);
  });
  it("does not close tabs that navigated after being saved", async () => {
    const { repo, api } = fixture({ navigate: true });
    expect((await repo.archive("window")).closed).toBe(0);
    expect(api.tabs.remove).not.toHaveBeenCalled();
  });
  it("skips duplicates without closing them", async () => {
    const { repo, api } = fixture();
    await repo.create("Existing", [{ title: "A", url: "https://a.test/" }]);
    expect(await repo.archive("window")).toEqual({ saved: 1, closed: 1 });
    expect(api.tabs.remove).toHaveBeenCalledWith(11);
  });
  it("skips pinned tabs, excluded domains, and extension pages", async () => {
    const { repo, api, tabs, storage } = fixture();
    (tabs[0] as any).pinned = true;
    storage.settings = { excluded: "b.test" };
    tabs.push({
      ...tabs[0],
      id: 12,
      url: "chrome-extension://test/index.html",
    });
    expect((await repo.archive("window")).saved).toBe(0);
    expect(api.tabs.remove).not.toHaveBeenCalled();
  });
  it("honors left/right/current selection", async () => {
    const f = fixture();
    expect((await f.repo.archive("right", 1, 10)).saved).toBe(1);
    expect(f.api.tabs.remove).toHaveBeenCalledWith(11);
    const g = fixture();
    expect((await g.repo.archive("current", 1, 10)).saved).toBe(1);
    expect(g.api.tabs.remove).toHaveBeenCalledWith(10);
  });
  it("reports local-only storage truthfully", async () => {
    const { repo } = fixture({ account: false });
    await repo.create("test", []);
    expect((await repo.snapshot()).roots[0].syncing).toBe(false);
  });
});
describe("restoration and organization", () => {
  it("retains the entire archive if restoring a later tab fails", async () => {
    const { repo, api } = fixture({ failTab: 2 });
    const id = await repo.create("G", [
      { title: "A", url: "https://a.test/" },
      { title: "B", url: "https://b.test/" },
    ]);
    await expect(repo.restore(id)).rejects.toThrow("恢复未全部完成");
    expect(api.bookmarks.remove).not.toHaveBeenCalled();
    expect((await repo.group(id)).items).toHaveLength(2);
  });
  it("removes successfully restored items unless the group is locked", async () => {
    const { repo } = fixture();
    const id = await repo.create("G", [{ title: "A", url: "https://a.test/" }]);
    await repo.patch(id, { locked: true });
    await repo.restore(id);
    expect((await repo.group(id)).items).toHaveLength(1);
    await expect(repo.trash(id)).rejects.toThrow("锁定");
    await expect(repo.patch(id, { note: "change" })).rejects.toThrow("解锁");
    await repo.patch(id, { locked: false });
    await repo.restore(id);
    expect((await repo.group(id)).items).toHaveLength(0);
  });
  it("moves deleted items to a recoverable group", async () => {
    const { repo } = fixture();
    const id = await repo.create("G", [{ title: "A", url: "https://a.test/" }]);
    const g = await repo.group(id);
    await repo.trash(id, [g.items[0].id]);
    const trash = (await repo.snapshot()).groups.find((g) => g.meta.trashed)!;
    expect(trash.items[0].url).toBe("https://a.test/");
    await repo.patch(trash.id, { trashed: false });
    expect((await repo.group(trash.id)).meta.trashed).toBe(false);
  });
  it("can reconstruct metadata on another device without local storage", async () => {
    const { repo, api } = fixture();
    const id = await repo.create(
      "Portable",
      [{ title: "A", url: "https://a.test/" }],
      {
        starred: true,
        note: "同步笔记",
        items: { "https://a.test/": { task: "todo" } },
      },
    );
    const rebuilt = await new Repository(api).group(id);
    expect(rebuilt.meta.note).toBe("同步笔记");
    expect(rebuilt.items[0].task).toBe("todo");
  });
  it("does not hide links when metadata is malformed", async () => {
    const { repo, api } = fixture();
    const id = await repo.create("Broken meta", [
      { title: "A", url: "https://a.test/" },
    ]);
    const meta = (await api.bookmarks.getChildren(id)).find((n: any) =>
      n.url?.startsWith(META_URL),
    );
    await api.bookmarks.update(meta.id, { url: META_URL + "bad" });
    expect((await repo.group(id)).items).toHaveLength(1);
  });
  it("does not mistake a nested group named BetterTab for a second root", async () => {
    const { repo } = fixture();
    await repo.create("BetterTab", []);
    expect((await repo.snapshot()).roots).toHaveLength(1);
  });
  it("protects nested folders from group deletion", async () => {
    const { repo, api } = fixture();
    const id = await repo.create("Parent", []);
    await api.bookmarks.create({ parentId: id, title: "Child" });
    await expect(repo.trash(id)).rejects.toThrow("子文件夹");
    expect((await repo.group(id)).meta.trashed).not.toBe(true);
  });
  it("reads externally renamed bookmarks without a local database", async () => {
    const { repo, api } = fixture();
    const id = await repo.create("G", [
      { title: "Original", url: "https://a.test/" },
    ]);
    const item = (await repo.group(id)).items[0];
    await api.bookmarks.update(item.id, {
      title: "Changed in bookmark manager",
    });
    expect((await repo.group(id)).items[0].title).toBe(
      "Changed in bookmark manager",
    );
  });
  it("rejects moving into a locked group before modifying bookmarks", async () => {
    const { repo, api } = fixture();
    const from = await repo.create("From", [
      { title: "A", url: "https://a.test/" },
    ]);
    const to = await repo.create("To", [], { locked: true });
    await expect(
      repo.move(from, to, [(await repo.group(from)).items[0].id]),
    ).rejects.toThrow("锁定");
    expect(api.bookmarks.move).not.toHaveBeenCalled();
  });
});
describe("portable import and export", () => {
  it("preserves pipes in titles and empty-line group boundaries", () => {
    const result = parseText("https://a.test/ | A | B\r\n\r\nhttps://b.test/");
    expect(result).toHaveLength(2);
    expect(result[0].items[0].title).toBe("A | B");
  });
  it("rejects executable schemes before writing anything", async () => {
    const { repo, api } = fixture();
    await expect(
      repo.importText("https://a.test/\n\njavascript:alert(1)"),
    ).rejects.toThrow();
    expect(api.bookmarks.create).not.toHaveBeenCalled();
    expect(safeUrl("data:text/html,test")).toBe(false);
  });
  it("escapes HTML exports and emits no script", async () => {
    const { repo } = fixture();
    const id = await repo.create("<img src=x onerror=alert(1)>", [
      { title: "<script>alert(1)</script>", url: 'https://a.test/?x="' },
    ]);
    const g = await repo.group(id);
    const html = shareHtml([g]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(exportText([g])).toContain(" | ");
  });
  it("encodes unicode metadata in a portable reserved URL", () => {
    expect(encodeMeta({ ...freshMeta(), note: "你好" })).toMatch(
      /^https:\/\/bettertab\.invalid\/meta\/v1#/,
    );
  });
});

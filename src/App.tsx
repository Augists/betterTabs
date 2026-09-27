import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  Cloud,
  Copy,
  Download,
  Folder,
  GripVertical,
  LayoutGrid,
  LockKeyhole,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Sun,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { Button as B, Modal } from "./components/ui";
import { request, isExtension } from "./demo";
import type { DiagnosticReport } from "./diagnostics";
import {
  exportText,
  exportBackup,
  shareHtml,
  defaults,
  type Snapshot,
  type Group,
  type Item,
  type Settings,
} from "./model";

const titles: Record<string, string> = {
  all: "所有标签",
  starred: "星标收藏",
  quick: "快捷列表",
  tasks: "待办任务",
  trash: "回收站",
};
const firefox = navigator.userAgent.includes("Firefox/");
const browserName = firefox ? "Firefox" : navigator.userAgent.includes("Edg/") ? "Edge" : "Chrome";
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "本地文件";
  } catch {
    return url;
  }
};
function download(content: string, filename: string, type = "text/plain") {
  const url = URL.createObjectURL(
    new Blob([content], { type: `${type};charset=utf-8` }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type Drag = { from: string; ids: string[]; group?: boolean };
export default function App() {
  const [data, setData] = useState<Snapshot>({
    groups: [],
    roots: [],
    settings: defaults,
  });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [view, setView] = useState(
      new URLSearchParams(location.search).has("popup") ? "quick" : "all",
    ),
    [query, setQuery] = useState(
      new URLSearchParams(location.search).get("q") || "",
    );
  const [selected, setSelected] = useState<string[]>([]),
    [folded, setFolded] = useState<string[]>([]);
  const [dialog, setDialog] = useState(""),
    [edit, setEdit] = useState<Group>(),
    [draft, setDraft] = useState({ title: "", note: "", folder: "" });
  const [text, setText] = useState(""),
    [destination, setDestination] = useState("");
  const [report, setReport] = useState<DiagnosticReport>();
  const [excludedDraft, setExcludedDraft] = useState("");
  const running = useRef(false);
  const [notice, setNotice] = useState(""),
    [failure, setFailure] = useState(""),
    [menu, setMenu] = useState("");
  const search = useRef<HTMLInputElement>(null),
    drag = useRef<Drag | null>(null);
  const popup = new URLSearchParams(location.search).has("popup");
  const reload = useCallback(async () => {
    try {
      setData(await request<Snapshot>({ type: "snapshot" }));
    } catch (e) {
      setFailure(String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    if (location.hash === "#settings") setDialog("settings");
    if (isExtension) {
      void chrome.storage.local
        .get<{ diagnosticsReport?: DiagnosticReport }>("diagnosticsReport")
        .then((stored) => {
          if (stored.diagnosticsReport) setReport(stored.diagnosticsReport);
        })
        .catch(() => {});
    }
  }, [reload]);
  useEffect(() => {
    if (!isExtension) return;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), 180);
    };
    const events = [
      chrome.bookmarks.onCreated,
      chrome.bookmarks.onChanged,
      chrome.bookmarks.onRemoved,
      chrome.bookmarks.onMoved,
    ];
    events.forEach((e) => e.addListener(update));
    chrome.storage.onChanged.addListener(update);
    return () => {
      clearTimeout(timer);
      events.forEach((e) => e.removeListener(update));
      chrome.storage.onChanged.removeListener(update);
    };
  }, [reload]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        ) &&
        !dialog
      ) {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.key === "Escape") {
        setMenu("");
        setSelected([]);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [dialog]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        data.settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : data.settings.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [data.settings.theme]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (dialog === "settings") setExcludedDraft(data.settings.excluded);
  }, [dialog]);
  async function run(fn: () => Promise<unknown>, success = "已保存") {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setFailure("");
    try {
      const result = await fn();
      await reload();
      if (success)
        setNotice(
          result && typeof result === "object" && "saved" in result
            ? `已保存 ${result.saved} 个标签；重复、固定及排除的标签保持打开`
            : success,
        );
      return true;
    } catch (e) {
      setFailure(String(e).replace(/^Error: /, ""));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
      setMenu("");
    }
  }
  const action = (message: any, success?: string) =>
    run(() => request(message), success);
  const settings = (patch: Partial<Settings>) =>
    action({ type: "settings", settings: patch }, "偏好已保存");
  const iconButton = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    active = false,
    disabled = false,
  ) => (
    <B
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      className={active ? "is-active" : ""}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {icon}
    </B>
  );
  const live = data.groups.filter((g) => !g.meta.trashed),
    total = live.reduce((n, g) => n + g.items.length, 0);
  const folders = [
    ...new Set(live.map((g) => g.meta.folder).filter(Boolean)),
  ] as string[];
  const inView = data.groups.filter((g) =>
    view === "trash"
      ? g.meta.trashed
      : !g.meta.trashed &&
        (view === "all" ||
          (view === "starred" &&
            (g.meta.starred || g.items.some((t) => t.starred))) ||
          (view === "quick" &&
            (g.meta.quick || g.items.some((t) => t.quick))) ||
          (view === "tasks" && g.items.some((t) => t.task)) ||
          (view.startsWith("folder:") && g.meta.folder === view.slice(7))),
  );
  const visible = inView
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (t) =>
          (view !== "tasks" || t.task) &&
          (view !== "quick" || g.meta.quick || t.quick) &&
          (view !== "starred" || g.meta.starred || t.starred) &&
          `${g.title} ${g.meta.note || ""} ${t.title} ${t.url}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    }))
    .filter(
      (g) =>
        g.items.length ||
        (!query &&
          view !== "tasks" &&
          view !== "starred" &&
          view !== "quick") ||
        (g.title.toLowerCase().includes(query.toLowerCase()) && query),
    );
  const groups = [...visible].sort(
    (a, b) => Number(!!b.meta.starred) - Number(!!a.meta.starred),
  );
  const selectionGroups = data.groups
    .map((g) => ({
      ...g,
      items: g.items.filter((t) => selected.includes(t.id)),
    }))
    .filter((g) => g.items.length);
  const scopeGroups = selected.length ? selectionGroups : groups;
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((i) => i !== id) : [...s, id],
    );
  const patch = (g: Group, p: any) =>
    action({ type: "patch", id: g.id, patch: p });
  const copy = (gs: Group[]) =>
    run(() => navigator.clipboard.writeText(exportText(gs)), "链接已复制");
  const editGroup = (g: Group) => {
    setEdit(g);
    setDraft({
      title: g.title,
      note: g.meta.note || "",
      folder: g.meta.folder || "",
    });
    setDialog("edit");
    setMenu("");
  };
  async function batch(type: "restore" | "trash" | "move") {
    const done = await run(
      async () => {
        if (type !== "restore" && selectionGroups.some((g) => g.meta.locked))
          throw new Error("选中条目包含锁定组，请先解锁。");
        for (const g of selectionGroups)
          await request(
            type === "move"
              ? {
                  type,
                  from: g.id,
                  to: destination,
                  ids: g.items.map((t) => t.id),
                }
              : { type, id: g.id, ids: g.items.map((t) => t.id) },
          );
      },
      type === "restore"
        ? "选中标签已恢复"
        : type === "trash"
          ? "已移至回收站"
          : "标签已移动",
    );
    if (done) {
      setSelected([]);
      setDialog("");
    }
  }
  async function drop(to?: Group, item?: Item) {
    const value = drag.current;
    drag.current = null;
    if (!value || to?.meta.locked || busy) return;
    await run(async () => {
      const target =
        to?.id ??
        (await request<string>({ type: "create", title: "新建标签组" }));
      const index = item
        ? (data.groups
            .find((g) => g.id === target)
            ?.items.findIndex((t) => t.id === item.id) ?? 0)
        : undefined;
      if (value.group && to?.id === value.from) return;
      await request({
        type: "move",
        from: value.from,
        to: target,
        ids: value.ids,
        index,
        before: item?.id,
      });
    }, "标签已整理");
  }
  const startDrag = (e: React.DragEvent, value: Drag) => {
    drag.current = value;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", value.from);
  };
  const switchView = (v: string) => {
    setView(v);
    setSelected([]);
    setQuery("");
  };

  return (
    <div className={`app shadcn-design ${popup ? "popup" : ""}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            switchView("all");
          }}
        >
          <span className="brand-mark">
            <Archive size={21} />
          </span>
          <span>
            栖签<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">B</span>
          <div>
            我的标签空间<small>少一点杂乱，多一点专注</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-caption">资料库</span>
        <nav>
          {[
            [LayoutGrid, "all", "所有标签", total],
            [
              Star,
              "starred",
              "星标收藏",
              live.filter((g) => g.meta.starred).length,
            ],
            [
              Zap,
              "quick",
              "快捷列表",
              live.filter((g) => g.meta.quick || g.items.some((t) => t.quick))
                .length,
            ],
            [
              CheckCheck,
              "tasks",
              "待办任务",
              live.flatMap((g) => g.items).filter((t) => t.task === "todo")
                .length,
            ],
          ].map(([Icon, id, label, count]) => {
            const I = Icon as typeof Archive;
            return (
              <button
                key={String(id)}
                className={`nav-item ${view === id ? "active" : ""}`}
                onClick={() => switchView(String(id))}
              >
                <I size={17} />
                <span>{String(label)}</span>
                <small>{Number(count)}</small>
              </button>
            );
          })}
        </nav>
        <div className="nav-caption folder-label">
          文件夹
          {iconButton("新建分类", <Plus />, () => {
            setEdit(undefined);
            setDraft({ title: "", folder: "", note: "" });
            setDialog("new");
          })}
        </div>
        <nav>
          {folders.map((f, i) => (
            <button
              key={f}
              className={`nav-item ${view === `folder:${f}` ? "active" : ""}`}
              onClick={() => switchView(`folder:${f}`)}
            >
              <span className={`folder-dot color-${i % 3}`} />
              <span>{f}</span>
              <small>{live.filter((g) => g.meta.folder === f).length}</small>
            </button>
          ))}
        </nav>
        <button
          className={`nav-item trash-nav ${view === "trash" ? "active" : ""}`}
          onClick={() => switchView("trash")}
        >
          <Trash2 size={17} />
          <span>回收站</span>
          <small>{data.groups.filter((g) => g.meta.trashed).length}</small>
        </button>
        <div className="sidebar-bottom">
          <div className="sync-note">
            <ShieldCheck size={21} />
            <strong>好好保存，每一个灵感</strong>
            <p>
              标签归档到你的{browserName}书签。
              <br />
              换一台电脑，也能接着探索。
            </p>
            <button onClick={() => setDialog("sync")}>
              了解书签同步 <ArrowUpRight size={13} />
            </button>
          </div>
          <button className="nav-item" onClick={() => setDialog("settings")}>
            <Settings2 size={17} />
            <span>设置与偏好</span>
            <kbd>⌘</kbd>
          </button>
          <div className="sidebar-foot">
            <span>给标签一个归处</span>
            <span>v0.2</span>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            我的空间 <ChevronRight size={13} />{" "}
            <span>{titles[view] || view.slice(7)}</span>
          </div>
          <div className="topbar-right">
            {popup && (
              <>
                <B
                  variant="ghost"
                  size="sm"
                  onClick={() => switchView(view === "quick" ? "all" : "quick")}
                >
                  {view === "quick" ? "所有标签" : "快捷列表"}
                </B>
                <B
                  variant="outline"
                  size="sm"
                  onClick={() => void action({ type: "library" }, "")}
                >
                  打开资料库
                </B>
                <B
                  variant="ghost"
                  size="icon"
                  aria-label="设置"
                  onClick={() => setDialog("settings")}
                >
                  <Settings2 />
                </B>
              </>
            )}
            <button className="sync-pill" onClick={() => setDialog("sync")}>
              <span
                className={`status-dot ${data.roots.some((r) => r.syncing) ? "online" : ""}`}
              />
              {data.demo
                ? "界面样例"
                : data.roots.some((r) => r.syncing)
                  ? "已存入账号书签"
                  : data.roots.some((r) => r.syncing === null)
                    ? "已存入浏览器书签"
                    : "本地书签"}
              <Cloud size={14} />
            </button>
            {iconButton(
              "切换明暗主题",
              data.settings.theme === "dark" ? <Sun /> : <Moon />,
              () =>
                void settings({
                  theme: data.settings.theme === "dark" ? "light" : "dark",
                }),
            )}
            <div className="avatar">B</div>
          </div>
        </header>
        <main>
          <section className="page-heading">
            <div>
              <div className="eyebrow">A LITTLE SPACE FOR YOUR IDEAS</div>
              <h1>
                {titles[view] || view.slice(7)}
                <span className="heading-dot">.</span>
              </h1>
              <p>让打开的思绪，有个安心的归处。</p>
            </div>
            <div className="heading-actions">
              <B
                variant="outline"
                onClick={() => {
                  setEdit(undefined);
                  setDraft({ title: "", folder: "", note: "" });
                  setDialog("new");
                }}
              >
                <Plus />
                新建分组
              </B>
              <B
                disabled={busy}
                onClick={() =>
                  void action(
                    { type: "archive", scope: "window" },
                    "窗口标签已归档",
                  )
                }
              >
                <ArrowDownToLine />
                收起当前窗口
              </B>
            </div>
          </section>
          {data.demo && (
            <div className="demo-note">
              <Monitor size={14} />
              当前为独立演示数据，不会访问或修改真实标签和书签。加载扩展后可使用完整归档流程。
            </div>
          )}
          {(failure || data.lastError) && (
            <div className="error-banner" role="alert">
              <span>{failure || data.lastError}</span>
              <button
                aria-label="关闭错误提示"
                onClick={() => {
                  setFailure("");
                  if (data.lastError) void action({ type: "clear-error" }, "");
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <section className="list-toolbar">
            <div className="searchbox">
              <Search size={17} />
              <input
                ref={search}
                aria-label="搜索标签"
                placeholder="搜索标签、网址或分组…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected([]);
                }}
              />
              {query ? (
                <button aria-label="清除搜索" onClick={() => setQuery("")}>
                  <X size={14} />
                </button>
              ) : (
                <kbd>/</kbd>
              )}
            </div>
            <div className="tools">
              <B
                variant="ghost"
                size="sm"
                disabled={!groups.length}
                onClick={() =>
                  setSelected(groups.flatMap((g) => g.items.map((t) => t.id)))
                }
              >
                全选
              </B>
              <span className="result-count">{groups.length} 个分组</span>
              <B
                variant="ghost"
                size="sm"
                onClick={() =>
                  setFolded(folded.length ? [] : groups.map((g) => g.id))
                }
              >
                {folded.length ? "展开全部" : "折叠全部"}
              </B>
              <B
                variant="outline"
                size="sm"
                onClick={() => {
                  setText("");
                  setDialog("import");
                }}
              >
                <Upload />
                导入
              </B>
              <B
                variant="outline"
                size="sm"
                onClick={() => setDialog("export")}
              >
                <Download />
                导出
              </B>
            </div>
          </section>
          {selected.length > 0 && (
            <div className="selection-bar">
              <span>已选择 {selected.length} 个标签</span>
              <B
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void batch("restore")}
              >
                恢复
              </B>
              <B
                size="sm"
                variant="outline"
                onClick={() => void copy(selectionGroups)}
              >
                复制
              </B>
              <B
                size="sm"
                variant="outline"
                onClick={() => {
                  setDestination("");
                  setDialog("move");
                }}
              >
                移动到
              </B>
              <B
                size="sm"
                variant="outline"
                onClick={() => setDialog("delete-selected")}
              >
                删除
              </B>
              <button onClick={() => setSelected([])}>取消选择</button>
            </div>
          )}
          <div className="group-list" aria-busy={loading || busy}>
            {loading ? (
              <div className="empty-state">正在读取书签…</div>
            ) : groups.length === 0 ? (
              <div className="empty-state">
                <Archive size={34} />
                <h2>
                  {query
                    ? "没有找到匹配的标签"
                    : view === "trash"
                      ? "回收站是空的"
                      : "留一点空间给下一个灵感"}
                </h2>
                <p>
                  {query
                    ? "试试其他标题、网址或分组名。"
                    : "收起当前窗口，或导入已有的 OneTab 标签。"}
                </p>
                {!query && view === "all" && (
                  <B
                    onClick={() =>
                      void action(
                        { type: "archive", scope: "window" },
                        "已归档",
                      )
                    }
                  >
                    归档当前窗口
                  </B>
                )}
              </div>
            ) : (
              groups.map((g) => {
                const collapsed = folded.includes(g.id),
                  ids = g.items.map((t) => t.id);
                const full = data.groups.find((x) => x.id === g.id)!;
                const content = (
                  <>
                    <div
                      className="group-heading"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void drop(full);
                      }}
                    >
                      <button
                        className="drag-handle"
                        aria-label={`拖动分组 ${g.title}`}
                        title="拖到其他组的把手排序；拖到标题合并标签"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const value = drag.current;
                          drag.current = null;
                          if (value?.group && value.from !== g.id)
                            void action(
                              { type: "reorder", id: value.from, before: g.id },
                              "分组顺序已更新",
                            );
                        }}
                        draggable={!g.meta.locked && !busy}
                        onDragStart={(e) =>
                          startDrag(e, {
                            from: g.id,
                            ids: full.items.map((t) => t.id),
                            group: true,
                          })
                        }
                      >
                        <GripVertical size={17} />
                      </button>
                      {iconButton(
                        collapsed ? "展开分组" : "折叠分组",
                        collapsed ? <ChevronRight /> : <ChevronDown />,
                        () =>
                          setFolded((s) =>
                            s.includes(g.id)
                              ? s.filter((x) => x !== g.id)
                              : [...s, g.id],
                          ),
                      )}
                      <div className="group-title">
                        <div>
                          <h2>{g.title}</h2>
                          {g.meta.starred && (
                            <Star
                              size={13}
                              className="star-icon"
                              fill="currentColor"
                            />
                          )}
                          {g.meta.locked && <LockKeyhole size={13} />}
                          <span className="count-badge">
                            {g.items.length} 个标签
                          </span>
                        </div>
                        <small>
                          {new Date(g.meta.created).toLocaleString("zh-CN", {
                            month: "long",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {g.meta.folder && (
                            <>
                              {" "}
                              <span>·</span> {g.meta.folder}
                            </>
                          )}
                        </small>
                      </div>
                      <div className="group-actions">
                        {g.meta.trashed ? (
                          <B
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void patch(g, { trashed: false })}
                          >
                            移回资料库
                          </B>
                        ) : (
                          <B
                            variant="ghost"
                            size="sm"
                            disabled={busy || !ids.length}
                            onClick={() =>
                              void action(
                                { type: "restore", id: g.id, ids },
                                "标签已恢复",
                              )
                            }
                          >
                            <ArrowUpRight />
                            恢复{query ? "匹配项" : "全部"}
                          </B>
                        )}
                        {iconButton(
                          g.meta.starred ? "取消星标" : "星标分组",
                          <Star />,
                          () => void patch(g, { starred: !g.meta.starred }),
                          !!g.meta.starred,
                          !!g.meta.locked,
                        )}
                        <div className="menu-wrap">
                          {iconButton("分组更多操作", <MoreHorizontal />, () =>
                            setMenu(menu === g.id ? "" : g.id),
                          )}
                          {menu === g.id && (
                            <>
                              <button
                                className="menu-dismiss"
                                aria-label="关闭菜单"
                                onClick={() => setMenu("")}
                              />
                              <div className="dropdown-menu">
                                <button
                                  onClick={() => {
                                    setSelected((s) => [
                                      ...new Set([...s, ...ids]),
                                    ]);
                                    setMenu("");
                                  }}
                                >
                                  选择整组
                                </button>
                                <button
                                  disabled={g.meta.locked}
                                  onClick={() => editGroup(full)}
                                >
                                  重命名、分类与笔记
                                </button>
                                <button onClick={() => void copy([g])}>
                                  复制链接
                                </button>
                                <button
                                  onClick={() => {
                                    download(
                                      shareHtml([g]),
                                      "bettertab-share.html",
                                      "text/html",
                                    );
                                    setMenu("");
                                  }}
                                >
                                  导出分享网页（离线）
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void action(
                                      {
                                        type: "restore",
                                        id: g.id,
                                        ids,
                                        newWindow: true,
                                      },
                                      "已在新窗口恢复",
                                    )
                                  }
                                >
                                  在新窗口恢复
                                </button>
                                <button
                                  onClick={() =>
                                    void patch(g, { locked: !g.meta.locked })
                                  }
                                >
                                  {g.meta.locked ? "解锁分组" : "锁定分组"}
                                </button>
                                <button
                                  disabled={g.meta.locked}
                                  onClick={() =>
                                    void patch(g, { quick: !g.meta.quick })
                                  }
                                >
                                  {g.meta.quick
                                    ? "移出快捷列表"
                                    : "添加到快捷列表"}
                                </button>
                                <button
                                  disabled={
                                    g.meta.locked || groups[0]?.id === g.id
                                  }
                                  onClick={() =>
                                    void action({
                                      type: "reorder",
                                      id: g.id,
                                      before: groups[0].id,
                                    })
                                  }
                                >
                                  移到列表最前
                                </button>
                                <button
                                  className="danger"
                                  disabled={g.meta.locked}
                                  onClick={() => {
                                    setEdit(full);
                                    setDialog(
                                      g.meta.trashed ? "purge" : "delete",
                                    );
                                    setMenu("");
                                  }}
                                >
                                  {g.meta.trashed ? "永久删除" : "移至回收站"}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {!collapsed && (
                      <>
                        <div className="tab-rows">
                          {g.items.map((t, i) => (
                            <div
                              key={t.id}
                              className={`tab-row ${selected.includes(t.id) ? "selected" : ""}`}
                              draggable={
                                !g.meta.locked && !busy && !g.meta.trashed
                              }
                              onDragStart={(e) =>
                                startDrag(e, { from: g.id, ids: [t.id] })
                              }
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void drop(full, t);
                              }}
                            >
                              <input
                                type="checkbox"
                                aria-label={`选择 ${t.title}`}
                                checked={selected.includes(t.id)}
                                onChange={() => toggle(t.id)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setSelected(
                                    ids.every((id) => selected.includes(id))
                                      ? selected.filter(
                                          (id) => !ids.includes(id),
                                        )
                                      : [...new Set([...selected, ...ids])],
                                  );
                                }}
                              />
                              <span className={`site-icon site-${i % 5}`}>
                                {host(t.url).slice(0, 1).toUpperCase()}
                              </span>
                              <button
                                className={`tab-link ${t.task === "done" ? "completed" : ""}`}
                                disabled={busy}
                                title={t.url}
                                onClick={() =>
                                  void action(
                                    { type: "restore", id: g.id, ids: [t.id] },
                                    "标签已打开",
                                  )
                                }
                              >
                                {t.title}
                              </button>
                              <span className="domain">{host(t.url)}</span>
                              <div className="row-actions">
                                {iconButton(
                                  t.task === "todo"
                                    ? "完成任务"
                                    : t.task === "done"
                                      ? "取消任务标记"
                                      : "标记为任务",
                                  t.task === "done" ? (
                                    <CheckCheck />
                                  ) : (
                                    <Circle />
                                  ),
                                  () =>
                                    void action({
                                      type: "item",
                                      id: g.id,
                                      url: t.url,
                                      patch: {
                                        task:
                                          t.task === "todo"
                                            ? "done"
                                            : t.task === "done"
                                              ? null
                                              : "todo",
                                      },
                                    }),
                                  !!t.task,
                                  !!g.meta.locked,
                                )}
                                {iconButton(
                                  t.starred ? "取消标签星标" : "星标标签",
                                  <Star />,
                                  () =>
                                    void action({
                                      type: "item",
                                      id: g.id,
                                      url: t.url,
                                      patch: { starred: !t.starred },
                                    }),
                                  !!t.starred,
                                  !!g.meta.locked,
                                )}
                                {iconButton(
                                  t.quick ? "移出快捷列表" : "快捷收藏标签",
                                  <Zap />,
                                  () =>
                                    void action({
                                      type: "item",
                                      id: g.id,
                                      url: t.url,
                                      patch: { quick: !t.quick },
                                    }),
                                  !!t.quick,
                                  !!g.meta.locked,
                                )}
                                {iconButton(
                                  "删除标签",
                                  <X />,
                                  () => {
                                    setSelected([t.id]);
                                    setDialog("delete-selected");
                                  },
                                  false,
                                  !!g.meta.locked || !!g.meta.trashed,
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        {g.meta.note && (
                          <div className="group-note">
                            <span>笔记</span>
                            {g.meta.note}
                          </div>
                        )}
                        <div className="group-footer">
                          <button
                            onClick={() =>
                              setSelected(
                                ids.every((id) => selected.includes(id))
                                  ? selected.filter((id) => !ids.includes(id))
                                  : [...new Set([...selected, ...ids])],
                              )
                            }
                          >
                            {ids.length > 0 &&
                            ids.every((id) => selected.includes(id))
                              ? "取消全选"
                              : "选择整组"}
                          </button>
                          <span>
                            {g.meta.locked ? (
                              <>
                                <LockKeyhole size={11} />
                                已锁定 · 恢复后保留
                              </>
                            ) : g.meta.quick ? (
                              <>
                                <Zap size={11} />
                                快捷列表
                              </>
                            ) : (
                              "拖动标签，重新整理你的思绪"
                            )}
                          </span>
                        </div>
                      </>
                    )}
                  </>
                );
                return (
                  <section key={g.id} className="group-card">
                    {content}
                  </section>
                );
              })
            )}
          </div>
          {view !== "trash" && (
            <button
              className="drop-zone"
              disabled={busy}
              onClick={() => {
                setEdit(undefined);
                setDraft({ title: "", folder: "", note: "" });
                setDialog("new");
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void drop();
              }}
            >
              <Plus size={17} />
              拖动标签到这里，开始一个新的分组<span>或点击创建</span>
            </button>
          )}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} />
              你的标签，保存在你的书签里。
            </span>
            <button onClick={() => firefox ? setDialog("sync") : void action({ type: "bookmarks" }, "")}>
              {firefox ? "在 Firefox 书签中查看" : `在${browserName}书签中查看`} <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      <Modal
        open={!!dialog}
        onClose={() => setDialog("")}
        title={
          dialog === "diagnostics"
            ? "Chrome 插件自检"
            : dialog === "settings"
              ? "设置与偏好"
              : dialog === "sync"
                ? "你的书签，也是你的归档"
                : dialog === "import"
                  ? "从 OneTab 导入"
                  : dialog === "export"
                    ? "导出与分享"
                    : dialog === "move"
                      ? "移动选中的标签"
                      : dialog === "edit"
                        ? "编辑分组"
                        : dialog === "new"
                          ? "给新的思绪起个名字"
                          : dialog === "purge"
                            ? "永久删除此组？"
                            : "移至回收站？"
        }
        description={
          dialog === "sync"
            ? "使用 Chrome 自身的书签同步连接不同电脑。"
            : dialog === "import"
              ? "每行 URL | 标题，空行分组。也支持一行一个 URL。"
              : dialog === "purge"
                ? "将永久删除书签，操作不能撤销。"
                : dialog.startsWith("delete")
                  ? "删除的标签会留在回收站中，可随时移回。锁定组需要先解锁。"
                  : undefined
        }
      >
        {failure && (
          <div className="error-banner" role="alert">
            {failure}
          </div>
        )}
        {(dialog === "new" || dialog === "edit") && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const id =
                  edit?.id ||
                  (await request({ type: "create", title: draft.title }));
                await request({
                  type: "patch",
                  id,
                  title: draft.title,
                  patch: { note: draft.note, folder: draft.folder },
                });
                setDialog("");
              }, "分组已保存");
            }}
          >
            <label>
              分组名称
              <input
                required
                autoFocus
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              文件夹分类
              <input
                list="folders"
                value={draft.folder}
                placeholder="例如：设计灵感"
                onChange={(e) => setDraft({ ...draft, folder: e.target.value })}
              />
              <datalist id="folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
            <label>
              笔记
              <textarea
                maxLength={4000}
                rows={3}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </label>
            <div className="dialog-actions">
              <B disabled={busy} type="submit">
                保存分组
              </B>
            </div>
          </form>
        )}
        {dialog === "import" && (
          <>
            <textarea
              className="import-text"
              rows={9}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "https://example.com/ | 页面标题\nhttps://example.org/ | 另一个页面"
              }
            />
            <label className="file-label">
              <Upload size={15} />
              选择文本或 JSON 备份
              <input
                type="file"
                accept=".txt,.json,text/plain,application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void file
                      .text()
                      .then(setText)
                      .catch((e) => setFailure(String(e)));
                }}
              />
            </label>
            <div className="dialog-actions">
              <B
                disabled={!text.trim() || busy}
                onClick={() =>
                  void run(async () => {
                    await request({
                      type: text.trimStart().startsWith("{")
                        ? "import-backup"
                        : "import",
                      text,
                    });
                    setDialog("");
                  }, "标签已导入")
                }
              >
                导入标签
              </B>
            </div>
          </>
        )}
        {dialog === "diagnostics" && (
          <div className="diagnostic-panel">
            <p>
              会创建独立的测试窗口和临时书签目录，验证归档、恢复、排序、锁定、备份和原生标签组。完成后清理本次测试数据，不修改现有归档。
            </p>
            <B
              disabled={busy || !isExtension}
              onClick={() =>
                void run(async () => {
                  setReport(
                    await request<DiagnosticReport>({ type: "diagnostics" }),
                  );
                }, "自检完成")
              }
            >
              {busy ? `正在运行${browserName}自检…` : "开始自检"}
            </B>
            {!isExtension && (
              <p className="muted">请在已加载的浏览器扩展中运行。</p>
            )}
            {report && (
              <>
                <p role="status">
                  {report.checks.filter((c) => c.passed).length} /{" "}
                  {report.checks.length} 项通过 ·{" "}
                  {(report.elapsedMs / 1000).toFixed(1)} 秒
                </p>
                <ul>
                  {report.checks.map((c) => (
                    <li
                      key={c.name}
                      className={c.passed ? "check-pass" : "check-fail"}
                    >
                      {c.passed ? "✓" : "✕"} {c.name}
                      {c.detail && <small>{c.detail}</small>}
                    </li>
                  ))}
                </ul>
                <B
                  variant="outline"
                  onClick={() =>
                    download(
                      JSON.stringify(report, null, 2),
                      "bettertab-diagnostics.json",
                      "application/json",
                    )
                  }
                >
                  下载自检报告
                </B>
              </>
            )}
          </div>
        )}
        {dialog === "export" && (
          <div className="export-options">
            <p>
              导出{selected.length ? "已选标签" : "当前视图"}，共{" "}
              {scopeGroups.reduce((n, g) => n + g.items.length, 0)}{" "}
              个链接。OneTab 文本仅包含
              URL、标题与分组边界，不包含星标、笔记等元信息。
            </p>
            <B
              variant="outline"
              onClick={() =>
                download(exportText(scopeGroups), "bettertab-export.txt")
              }
            >
              <Download />
              OneTab 兼容文本
            </B>
            <B
              variant="outline"
              onClick={() =>
                download(
                  exportBackup(data.groups),
                  "bettertab-backup.json",
                  "application/json",
                )
              }
            >
              <Download />
              完整备份（含全部分组、笔记和回收站）
            </B>
            <B variant="outline" onClick={() => void copy(scopeGroups)}>
              <Copy />
              复制到剪贴板
            </B>
            <B
              variant="outline"
              onClick={() =>
                download(
                  shareHtml(scopeGroups),
                  "bettertab-share.html",
                  "text/html",
                )
              }
            >
              <ArrowUpRight />
              离线分享网页
            </B>
            <small className="muted">
              分享网页是独立 HTML
              文件，可发给他人；当前没有公网分享链接或撤回服务。
            </small>
          </div>
        )}
        {dialog === "move" && (
          <>
            <label>
              目标分组
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="">选择分组</option>
                {live
                  .filter((g) => !g.meta.locked)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
              </select>
            </label>
            <div className="dialog-actions">
              <B
                disabled={!destination || busy}
                onClick={() => void batch("move")}
              >
                移动标签
              </B>
            </div>
          </>
        )}
        {(dialog === "delete" ||
          dialog === "delete-selected" ||
          dialog === "purge") && (
          <div className="dialog-actions">
            <B variant="outline" onClick={() => setDialog("")}>
              取消
            </B>
            <B
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (dialog === "delete-selected") void batch("trash");
                else if (edit)
                  void run(
                    async () => {
                      await request({
                        type: dialog === "purge" ? "purge" : "trash",
                        id: edit.id,
                      });
                      setDialog("");
                    },
                    dialog === "purge" ? "已永久删除" : "已移至回收站",
                  );
              }}
            >
              {dialog === "purge" ? "永久删除" : "移至回收站"}
            </B>
          </div>
        )}
        {dialog === "sync" && (
          <div className="sync-explanation">
            <div className="sync-diagram">
              <Monitor />
              <span>→</span>
              <Folder />
              <span>→</span>
              <Cloud />
              <span>→</span>
              <Monitor />
            </div>
            <p>
              归档位于{browserName}书签的 <strong>BetterTab</strong>{" "}
              专用文件夹。每个分组对应一个文件夹，页面是普通书签；卸载扩展也不会删除它们。
            </p>
            <ol>
              <li>在两台电脑的{browserName}中登录同一浏览器账号。</li>
              <li>
                在{browserName}设置中开启书签同步，并在两台电脑安装栖签。
              </li>
              <li>等待{browserName}同步完成，在另一台电脑打开栖签。</li>
            </ol>
            <p>
              {data.demo
                ? "当前是界面演示，无法检测真实同步状态。"
                : data.roots.length
                  ? data.roots
                      .map(
                        (r, i) =>
                          `目录 ${i + 1}：${r.syncing === true ? "账号书签" : r.syncing === false ? "本地书签（未确认账号同步）" : "浏览器书签（同步状态请在浏览器设置中确认）"}`,
                      )
                      .join("；")
                  : "首次归档时自动创建目录，优先选择账号书签存储。"}
            </p>
            <small>
              书签 API
              无法确认另一台电脑是否已收到数据。笔记与状态存于组内元信息书签，请保留它。分类使用同步的组属性，并非额外嵌套目录；在书签页新建的嵌套目录也可读取。
            </small>
            {firefox ? (
              <p>在 Firefox 中按 Ctrl+Shift+O 打开书签管理器，在“其他书签”里查看 BetterTab 文件夹。</p>
            ) : (
              <B variant="outline" onClick={() => void action({ type: "bookmarks" }, "")}>
                查看书签目录 <ArrowUpRight />
              </B>
            )}
          </div>
        )}
        {dialog === "settings" && (
          <div className="settings-form">
            <div className="settings-info">
              <B variant="outline" onClick={() => setDialog("diagnostics")}>
                <ShieldCheck size={16} />
                运行 Chrome 自检
              </B>
              <div>检查归档、恢复和书签操作，可下载检查报告。</div>
            </div>
            {(
              [
                [
                  "includePinned",
                  "归档固定标签",
                  "默认保留浏览器中固定的标签。",
                ],
                [
                  "keepRestored",
                  "恢复后保留归档",
                  "关闭时，成功打开的条目会从归档移除；锁定组始终保留。",
                ],
                ["newWindow", "默认恢复到新窗口", "关闭则在当前窗口恢复。"],
                [
                  "dedupe",
                  "跳过重复的网址",
                  "与已有归档或本次收集重复的标签保留打开。",
                ],
                [
                  "popup",
                  "工具栏使用快捷面板",
                  "关闭时，点击扩展图标直接归档当前窗口。",
                ],
              ] as const
            ).map(([key, title, desc]) => (
              <label className="setting-row" key={key}>
                <span>
                  <strong>{title}</strong>
                  <small>{desc}</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={data.settings[key]}
                  disabled={busy}
                  onChange={(e) => void settings({ [key]: e.target.checked })}
                />
              </label>
            ))}
            <label>
              不归档的网站
              <textarea
                rows={2}
                placeholder="mail.google.com, example.com"
                value={excludedDraft}
                onChange={(e) => setExcludedDraft(e.target.value)}
              />
              <small>以逗号或空格分隔域名，同时排除其子域名。</small>
              <B
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void settings({ excluded: excludedDraft })}
              >
                保存排除规则
              </B>
            </label>
            <label>
              外观
              <select
                value={data.settings.theme}
                onChange={(e) =>
                  void settings({ theme: e.target.value as Settings["theme"] })
                }
              >
                <option value="light">浅色</option>
                <option value="dark">深色</option>
                <option value="system">跟随系统</option>
              </select>
            </label>
            <div className="settings-info">
              归档窗口：Alt + Shift + 1<br />
              打开资料库：Alt + Shift + B<br />
              地址栏搜索：输入 bt 后按空格
              <br />
              自定义快捷键：{firefox ? "Firefox 扩展管理器 → 齿轮 → 管理扩展快捷键" : browserName === "Edge" ? "edge://extensions/shortcuts" : "chrome://extensions/shortcuts"}
              <br />
              隐身窗口需在扩展详情中允许访问；归档后会成为持久书签。
            </div>
            {popup && (
              <B onClick={() => void action({ type: "library" }, "")}>
                打开完整资料库
              </B>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}


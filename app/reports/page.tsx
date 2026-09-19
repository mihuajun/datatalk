"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileBarChart2,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import type { ReportFolder, ReportItem, ReportStatus } from "@/lib/report-types";
import { useRouter } from "next/navigation";

function findFolder(folders: ReportFolder[], id: string | null): ReportFolder | null {
  if (!id) return null;

  for (const folder of folders) {
    if (folder.id === id) return folder;
    const nested = findFolder(folder.children, id);
    if (nested) return nested;
  }

  return null;
}

function containsFolder(folders: ReportFolder[], id: string) {
  return Boolean(findFolder(folders, id));
}

function FolderTree({
  folders,
  selected,
  expanded,
  onSelect,
  onToggle,
  menuOpenId,
  onMenuToggle,
  onCreateChild,
  onRename,
  onCreateReport,
  onDelete,
  level = 0,
}: {
  folders: ReportFolder[];
  selected: string | null;
  expanded: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  menuOpenId: string | null;
  onMenuToggle: (id: string) => void;
  onCreateChild: (id: string) => void;
  onRename: (folder: ReportFolder) => void;
  onCreateReport: (folder: ReportFolder) => void;
  onDelete: (folder: ReportFolder) => void;
  level?: number;
}) {
  return (
    <div className="space-y-1">
      {folders.map((folder) => {
        const active = folder.id === selected;
        const hasChildren = folder.children.length > 0;
        const count = folder.reportCount + folder.children.length;

        return (
          <div key={folder.id} className="relative">
            <div
              className={`flex h-10 w-full items-center gap-2 rounded-md border px-2 text-left transition ${
                active ? "border-transparent bg-[#EDF3FF]" : "border-transparent hover:bg-[#F5F8FD]"
              }`}
              style={{ paddingLeft: `${level * 16 + 8}px` }}
            >
              <button
                type="button"
                onClick={() => onSelect(folder.id)}
                className={`flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] ${active ? "font-bold text-[#2167E8]" : "font-medium text-[#526174]"}`}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="flex min-w-0 items-center gap-1 truncate">
                  <span className="truncate">{folder.name}</span>
                  <span className={`shrink-0 text-[11px] font-normal ${active ? "text-[#6B8DDA]" : "text-[#8A98AC]"}`}>({count})</span>
                </span>
              </button>
              {hasChildren ? (
                <button
                  type="button"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#8A98AC] hover:bg-white/80 hover:text-[#2167E8]"
                  aria-label={expanded.has(folder.id) ? `收起${folder.name}` : `展开${folder.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle(folder.id);
                  }}
                >
                  {expanded.has(folder.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              ) : null}
              <span className="ml-auto shrink-0" data-folder-menu>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onMenuToggle(folder.id);
                  }}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
                    menuOpenId === folder.id ? "bg-white/90 text-[#2167E8]" : "text-[#8A98AC] hover:bg-white hover:text-[#2167E8]"
                  }`}
                  aria-label={`${folder.name}目录操作`}
                  aria-expanded={menuOpenId === folder.id}
                  title="目录操作"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </span>
            </div>
            {menuOpenId === folder.id ? (
              <div data-folder-menu className="absolute right-2 top-[42px] z-30 w-[140px] rounded-md border border-[#DDE5F0] bg-white p-2 shadow-[0_8px_24px_rgba(23,36,58,0.12)]">
                <button type="button" onClick={() => onCreateReport(folder)} className="flex h-[34px] w-full items-center gap-2 rounded-[5px] px-2 text-left text-xs font-bold text-[#526174] hover:bg-[#F5F8FF]"><FilePlus2 className="h-[15px] w-[15px]" />创建报表</button>
                <button type="button" onClick={() => onCreateChild(folder.id)} className="flex h-[34px] w-full items-center gap-2 rounded-[5px] px-2 text-left text-xs font-bold text-[#2167E8] hover:bg-[#F5F8FF]"><FolderPlus className="h-[15px] w-[15px]" />创建子目录</button>
                <button type="button" onClick={() => onRename(folder)} className="flex h-[34px] w-full items-center gap-2 rounded-[5px] px-2 text-left text-xs font-bold text-[#526174] hover:bg-[#F5F8FF]"><Pencil className="h-[15px] w-[15px]" />重命名</button>
                <button type="button" onClick={() => onDelete(folder)} className="flex h-[34px] w-full items-center gap-2 rounded-[5px] px-2 text-left text-xs font-bold text-[#D92D20] hover:bg-[#FFF8F8]"><Trash2 className="h-[15px] w-[15px]" />删除目录</button>
              </div>
            ) : null}
            {hasChildren && expanded.has(folder.id) ? (
              <FolderTree folders={folder.children} selected={selected} expanded={expanded} onSelect={onSelect} onToggle={onToggle} menuOpenId={menuOpenId} onMenuToggle={onMenuToggle} onCreateChild={onCreateChild} onRename={onRename} onCreateReport={onCreateReport} onDelete={onDelete} level={level + 1} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function statusClass(status: ReportStatus) {
  return status === "已发布"
    ? "bg-[#EAF8F2] text-[#16845B]"
    : "bg-[#FFF5E8] text-[#B76700]";
}

export default function ReportsPage() {
  const router = useRouter();
  const [folders, setFolders] = useState<ReportFolder[]>([]);
  const [summary, setSummary] = useState({ folderCount: 0, reportCount: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"全部" | ReportStatus>("全部");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingReportCode, setDeletingReportCode] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showFavorites, setShowFavorites] = useState(false);
  const [favorites, setFavorites] = useState<Array<{ code: string; title: string; summary: string | null; createdAt: string }>>([]);

  const loadFavorites = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/favorites", { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json() as { favorites?: Array<{ code: string; title: string; summary: string | null; createdAt: string }>; message?: string };
      if (!response.ok || !result.favorites) throw new Error(result.message || "收藏数据暂时不可用");
      setFavorites(result.favorites);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "收藏数据暂时不可用");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReports = useCallback(async (showRefreshState = false) => {
    if (showRefreshState) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/reports", { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json() as {
        folders?: ReportFolder[];
        summary?: { folderCount: number; reportCount: number };
        message?: string;
      };
      if (!response.ok || !result.folders || !result.summary) {
        throw new Error(result.message || "报表数据暂时不可用");
      }

      setFolders(result.folders);
      setSummary(result.summary);
      setSelected((previous) => previous && containsFolder(result.folders ?? [], previous) ? previous : result.folders?.[0]?.id ?? null);
      setExpanded((previous) => {
        const next = new Set(previous);
        for (const folder of result.folders ?? []) next.add(folder.id);
        return next;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "报表数据暂时不可用");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (!menuOpenId) return;

    function closeMenu(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-folder-menu]")) return;
      setMenuOpenId(null);
    }

    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpenId(null);
    }

    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [menuOpenId]);

  const current = useMemo(() => findFolder(folders, selected) ?? folders[0] ?? null, [folders, selected]);
  const reports = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (current?.reports ?? []).filter((report) => {
      const matchesQuery = !normalizedQuery || `${report.name} ${report.code}`.toLowerCase().includes(normalizedQuery);
      const matchesStatus = status === "全部" || report.status === status;
      return matchesQuery && matchesStatus;
    });
  }, [current, query, status]);
  const defaultFolder = useMemo(() => folders.find((folder) => folder.isDefault) ?? folders[0], [folders]);
  const createReportTarget = current ?? defaultFolder ?? null;

  function toggleFolder(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createFolder(parentId: string | null = null) {
    const name = window.prompt("请输入目录名称", "新建目录")?.trim();
    if (!name || creating) return;

    setMenuOpenId(null);
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/reports/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name, parentId }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "新建目录失败");
      await loadReports(true);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "新建目录失败");
    } finally {
      setCreating(false);
    }
  }

  async function renameFolder(folder: ReportFolder) {
    const name = window.prompt("请输入新的目录名称", folder.name)?.trim();
    if (!name || name === folder.name) {
      setMenuOpenId(null);
      return;
    }

    setMenuOpenId(null);
    setCreating(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/folders/${folder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "重命名目录失败");
      await loadReports(true);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "重命名目录失败");
    } finally {
      setCreating(false);
    }
  }

  async function createReport(folder: ReportFolder) {
    if (creating) return;

    setMenuOpenId(null);
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ folderId: folder.id, name: "未命名报表" }),
      });
      const result = await response.json() as { message?: string; report?: ReportItem };
      if (!response.ok) throw new Error(result.message || "创建报表失败");
      if (!result.report) throw new Error("创建报表失败");
      router.push(`/reports/editor/${encodeURIComponent(result.report.code)}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建报表失败");
    } finally {
      setCreating(false);
    }
  }

  async function deleteFolder(folder: ReportFolder) {
    setMenuOpenId(null);
    if (folder.isDefault) {
      setError("默认目录不能删除");
      return;
    }
    if (!window.confirm(`确定删除目录“${folder.name}”吗？`)) return;

    setCreating(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/folders/${folder.id}`, { method: "DELETE", headers: { Accept: "application/json" } });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "删除目录失败");
      await loadReports(true);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除目录失败");
    } finally {
      setCreating(false);
    }
  }

  function viewReport(report: ReportItem) {
    window.open(`/view/${encodeURIComponent(report.code)}`, "_blank", "noopener,noreferrer");
  }

  function editReport(report: ReportItem) {
    window.open(`/reports/editor?code=${encodeURIComponent(report.code)}`, "_blank", "noopener,noreferrer");
  }

  async function deleteReport(report: ReportItem) {
    if (deletingReportCode) return;
    if (!window.confirm(`确定删除报表“${report.name}”吗？删除后将不再显示在报表中心。`)) return;

    setError("");
    setDeletingReportCode(report.code);
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(report.code)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "删除报表失败");
      await loadReports(true);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除报表失败");
    } finally {
      setDeletingReportCode(null);
    }
  }

  return (
    <div className="min-w-0">
      <section className="grid min-h-[calc(100vh-118px)] gap-5 lg:grid-cols-[252px_minmax(0,1fr)]">
        <aside className="panel min-w-0 bg-[#fbfcfe] p-3">
          <div className="flex h-[42px] items-center justify-between">
            <h1 className="text-[15px] font-bold text-[#17243A]">报表目录</h1>
            <span className="rounded-full bg-white px-2 py-1 text-[11px] text-[#71819B]">{summary.folderCount} 个目录</span>
          </div>
          <button type="button" onClick={() => void createFolder(null)} disabled={loading || creating} className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-[#2167E8] hover:underline disabled:cursor-not-allowed disabled:opacity-50">
            {creating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
            {creating ? "保存中" : "新建目录"}
          </button>
          <div className="border-t border-[#EEF2F7] pt-3">
            <button
              type="button"
              onClick={() => defaultFolder && setSelected(defaultFolder.id)}
              disabled={!defaultFolder}
              className="mb-1 flex h-[42px] w-full items-center gap-2 rounded-md border border-transparent bg-[#FFF8ED] px-2 text-left text-[13px] font-extrabold text-[#C45A11] hover:bg-[#FFF4DF] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-[#D97706]" />
              <span className="truncate">我的订阅 ({defaultFolder?.reportCount ?? 0})</span>
            </button>
            <button
              type="button"
              onClick={() => { setShowFavorites(true); void loadFavorites(); }}
              className={`mb-1 flex h-[42px] w-full items-center gap-2 rounded-md border px-2 text-left text-[13px] font-semibold ${showFavorites ? "border-[#D7E5FF] bg-[#EDF3FF] text-[#2167E8]" : "border-transparent text-[#526174] hover:bg-white"}`}
            >
              <Star className="h-4 w-4 shrink-0" />
              <span className="truncate">我的收藏</span>
            </button>
            {loading ? (
              <div className="space-y-2 px-2 py-3" aria-label="正在加载报表目录">
                {["w-11/12", "w-8/12", "w-10/12"].map((width) => <div key={width} className={`h-8 animate-pulse rounded-md bg-[#E9EEF6] ${width}`} />)}
              </div>
            ) : folders.length ? (
              <FolderTree folders={folders} selected={selected} expanded={expanded} onSelect={setSelected} onToggle={toggleFolder} menuOpenId={menuOpenId} onMenuToggle={(id) => setMenuOpenId((previous) => previous === id ? null : id)} onCreateChild={(id) => void createFolder(id)} onRename={(folder) => void renameFolder(folder)} onCreateReport={(folder) => void createReport(folder)} onDelete={(folder) => void deleteFolder(folder)} />
            ) : null}
          </div>
        </aside>

        <section className="panel min-w-0 overflow-hidden bg-[#f8fafd]">
          <div className="flex min-h-[58px] items-center justify-between gap-4 border-b border-[#E7EDF5] bg-white px-5 py-2.5">
            <div className="flex items-center gap-3">
              <h2 className="text-[16px] font-bold text-[#17243A]">{showFavorites ? "我的收藏" : current?.name ?? "报表中心"}</h2>
              <span className="rounded-full bg-[#EDF3FF] px-2.5 py-1 text-[11px] font-semibold text-[#2167E8]">{showFavorites ? favorites.length : current?.reportCount ?? 0} 张报表</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void loadReports(true)} disabled={loading || refreshing} className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-md border border-[#DDE5F0] text-[#526174] hover:border-[#2167E8] hover:text-[#2167E8] disabled:cursor-wait disabled:opacity-50" aria-label="刷新报表数据" title="刷新报表数据">
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={() => createReportTarget && void createReport(createReportTarget)}
                disabled={loading || creating || !createReportTarget}
                className="inline-flex h-[38px] items-center gap-2 rounded-md bg-[#2167E8] px-3 text-xs font-semibold text-white shadow-[0_6px_14px_rgba(33,103,232,0.18)] transition hover:bg-[#1858CC] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
                创建报表
              </button>
            </div>
          </div>

          <div className="flex min-h-[46px] flex-wrap items-center justify-between gap-3 border-b border-[#E7EDF5] bg-[#F8FAFD] px-3 py-2">
            <label className="relative block"><span className="sr-only">搜索报表</span><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A4AEC0]" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 w-[260px] max-w-full rounded-md border border-[#DDE5F0] bg-white pl-8 pr-3 text-xs outline-none placeholder:text-[#98A2B3] focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10" placeholder="搜索报表名称 / 编码" /></label>
            <div className="flex items-center gap-1">
              {(["全部", "已发布", "草稿"] as const).map((item) => <button key={item} type="button" onClick={() => setStatus(item)} className={`rounded-md px-3 py-1.5 text-[12px] ${status === item ? "bg-[#EDF3FF] font-semibold text-[#2167E8]" : "text-[#526174] hover:bg-white"}`}>{item}</button>)}
            </div>
          </div>

          {error ? <div className="flex items-center justify-between gap-3 border-b border-[#F5D4CC] bg-[#FFF8F6] px-4 py-3 text-xs text-[#B42318]"><span>{error}</span><button type="button" onClick={() => void loadReports()} className="font-semibold underline">重试</button></div> : null}

          <div className="overflow-x-auto bg-white">
            {loading ? <div className="px-6 py-20 text-center text-sm text-[#8A98AC]">正在加载报表数据...</div> : showFavorites ? favorites.length ? (
              <table className="data-table min-w-[700px] w-full border-collapse text-left"><thead className="h-[46px] bg-[#F5F8FF] text-[11px] font-semibold text-[#526174]"><tr><th className="w-[72px] px-4">序号</th><th className="px-4">报表名称</th><th className="px-4">摘要</th><th className="w-[150px] px-4">收藏时间</th><th className="w-[100px] px-4">操作</th></tr></thead><tbody>{favorites.map((favorite, index) => <tr key={favorite.code} className="h-[60px] text-[13px]"><td className="px-4 font-semibold text-[#667085]">{index + 1}</td><td className="px-4"><div className="flex items-center gap-2.5 font-semibold text-[#344054]"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#FFF8ED] text-[#D97706]"><Star className="h-4 w-4" /></span>{favorite.title}</div><div className="mt-1 pl-9 text-[11px] text-[#8A98AC]">{favorite.code}</div></td><td className="max-w-[320px] truncate px-4 text-[#526174]">{favorite.summary || "—"}</td><td className="px-4 text-[#526174]">{favorite.createdAt}</td><td className="px-4"><button type="button" onClick={() => window.open(`/view/${encodeURIComponent(favorite.code)}`, "_blank", "noopener,noreferrer")} className="text-xs font-semibold text-[#2167E8] hover:underline">查看</button></td></tr>)}</tbody></table>
            ) : <div className="px-6 py-20 text-center text-sm text-[#8A98AC]">还没有收藏报告</div> : reports.length ? (
              <table className="data-table min-w-[800px] w-full border-collapse text-left"><thead className="h-[46px] bg-[#F5F8FF] text-[11px] font-semibold text-[#526174]"><tr><th className="w-[72px] px-4">序号</th><th className="px-4">报表名称</th><th className="w-[142px] px-4">最近更新时间</th><th className="w-[96px] px-4">负责人</th><th className="w-[88px] px-4">状态</th><th className="w-[168px] px-4">操作</th></tr></thead><tbody>{reports.map((report, index) => <tr key={report.id} className="h-[60px] text-[13px]"><td className="px-4 font-semibold text-[#667085]">{index + 1}</td><td className="px-4"><div className="flex items-center gap-2.5 font-semibold text-[#344054]"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#EDF3FF] text-[#2167E8]"><FileBarChart2 className="h-4 w-4" /></span>{report.name}</div></td><td className="px-4 text-[#526174]">{report.updatedAt}</td><td className="px-4 text-[#526174]">{report.owner}</td><td className="px-4"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass(report.status)}`}>{report.status}</span></td><td className="px-4"><div className="flex items-center gap-3 whitespace-nowrap"><button type="button" onClick={() => viewReport(report)} className="text-xs font-semibold text-[#2167E8] hover:underline">查看</button><button type="button" onClick={() => editReport(report)} className="text-xs font-semibold text-[#526174] hover:text-[#2167E8] hover:underline">编辑</button><button type="button" onClick={() => void deleteReport(report)} disabled={deletingReportCode === report.code} className="inline-flex items-center gap-1 text-xs font-semibold text-[#D92D20] hover:underline disabled:cursor-not-allowed disabled:opacity-60">{deletingReportCode === report.code ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}删除</button></div></td></tr>)}</tbody></table>
            ) : <div className="px-6 py-20 text-center text-sm text-[#8A98AC]">{current ? "当前目录还没有匹配的报表" : "暂无报表目录，请先初始化报表数据"}</div>}
          </div>
          <div className="flex min-h-[50px] items-center justify-between border-t border-[#E7EDF5] bg-white px-4 py-2 text-xs text-[#526174]"><span>共 {showFavorites ? favorites.length : reports.length} 条记录{!showFavorites && summary.reportCount ? `，当前租户共 ${summary.reportCount} 张` : ""}</span><div className="flex items-center gap-1"><button type="button" className="rounded p-1.5 text-[#B8C5D8]" aria-label="上一页" disabled><ChevronLeft className="h-4 w-4" /></button><span className="rounded bg-[#EDF3FF] px-2.5 py-1.5 font-semibold text-[#2167E8]">1</span><button type="button" className="rounded p-1.5 text-[#B8C5D8]" aria-label="下一页" disabled><ChevronRight className="h-4 w-4" /></button></div></div>
        </section>
      </section>
    </div>
  );
}

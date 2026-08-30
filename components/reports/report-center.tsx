"use client";

import type { ChangeEvent, MouseEvent } from "react";
import { ChevronDown, ChevronRight, FileBarChart2, FolderOpen, FolderPlus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { ReportFolder } from "@/lib/mock-data";
import { reportFolders } from "@/lib/mock-data";
import { StatusBadge } from "@/components/shared/status-badge";

function findFolderById(folders: ReportFolder[], id: string): ReportFolder | null {
  for (const folder of folders) {
    if (folder.id === id) {
      return folder;
    }

    if (folder.children) {
      const matched = findFolderById(folder.children, id);
      if (matched) {
        return matched;
      }
    }
  }

  return null;
}

function insertFolder(folders: ReportFolder[], parentId: string, nextFolder: ReportFolder): ReportFolder[] {
  return folders.map((folder) => {
    if (folder.id === parentId) {
      return {
        ...folder,
        children: [...(folder.children ?? []), nextFolder],
      };
    }

    if (!folder.children) {
      return folder;
    }

    return {
      ...folder,
      children: insertFolder(folder.children, parentId, nextFolder),
    };
  });
}

function FolderTree({
  folders,
  expandedIds,
  selectedId,
  onToggle,
  onSelect,
  level = 0,
}: {
  folders: ReportFolder[];
  expandedIds: Set<string>;
  selectedId: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  level?: number;
}) {
  return (
    <div className="space-y-1">
      {folders.map((folder) => {
        const expanded = expandedIds.has(folder.id);
        const hasChildren = Boolean(folder.children?.length);
        const active = folder.id === selectedId;

        return (
          <div key={folder.id}>
            <button
              type="button"
              onClick={() => onSelect(folder.id)}
              className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm transition ${
                active ? "bg-[#eef2ff] text-[#354edb]" : "text-[#344054] hover:bg-[#f8fafc]"
              }`}
              style={{ paddingLeft: `${level * 16 + 12}px` }}
            >
              {hasChildren ? (
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md hover:bg-black/5"
                  onClick={(event: MouseEvent<HTMLSpanElement>) => {
                    event.stopPropagation();
                    onToggle(folder.id);
                  }}
                >
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
              ) : (
                <span className="inline-flex h-5 w-5" />
              )}
              <FolderOpen className="h-4 w-4" />
              <span className="truncate">{folder.name}</span>
            </button>

            {hasChildren && expanded ? (
              <div className="mt-1">
                <FolderTree
                  folders={folder.children ?? []}
                  expandedIds={expandedIds}
                  selectedId={selectedId}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  level={level + 1}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ReportCenter() {
  const [folders, setFolders] = useState<ReportFolder[]>(reportFolders);
  const [selectedId, setSelectedId] = useState("default");
  const [expandedIds, setExpandedIds] = useState(new Set(["default"]));
  const [keyword, setKeyword] = useState("");

  const selectedFolder = useMemo(() => findFolderById(folders, selectedId) ?? folders[0], [folders, selectedId]);
  const filteredReports = useMemo(() => {
    const reports = selectedFolder?.reports ?? [];
    if (!keyword.trim()) {
      return reports;
    }

    return reports.filter((report) => report.name.toLowerCase().includes(keyword.trim().toLowerCase()));
  }, [keyword, selectedFolder]);

  const visibleChildren = selectedFolder?.children ?? [];

  function handleToggle(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleCreateFolder() {
    const name = window.prompt("请输入目录名称", "新建目录");
    if (!name?.trim()) {
      return;
    }

    const nextFolder: ReportFolder = {
      id: `folder-${Date.now()}`,
      name: name.trim(),
      reports: [],
    };

    setFolders((prev) => insertFolder(prev, selectedId, nextFolder));
    setExpandedIds((prev) => new Set(prev).add(selectedId));
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="rounded-3xl border border-[#eaecf0] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">报表目录</h2>
            <p className="mt-1 text-sm text-muted">左侧支持树形目录，默认目录始终保留。</p>
          </div>
          <button
            type="button"
            onClick={handleCreateFolder}
            className="inline-flex items-center gap-2 rounded-2xl border border-[#d0d5dd] px-3 py-2 text-sm text-[#344054] transition hover:border-brand hover:text-brand"
          >
            <FolderPlus className="h-4 w-4" />
            新建目录
          </button>
        </div>

        <div className="mt-5 rounded-2xl bg-[#f8fafc] p-2">
          <FolderTree
            folders={folders}
            expandedIds={expandedIds}
            selectedId={selectedId}
            onToggle={handleToggle}
            onSelect={setSelectedId}
          />
        </div>
      </aside>

      <div className="space-y-6">
        <section className="rounded-3xl border border-[#eaecf0] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-ink">{selectedFolder?.name}</h2>
                <StatusBadge tone="brand">当前目录</StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted">
                右侧展示当前目录下的子目录与报表，后续可继续接入拖拽排序、权限分配和分享链接。
              </p>
            </div>

            <label className="flex items-center gap-2 rounded-2xl border border-[#d0d5dd] px-4 py-3 text-sm text-muted lg:w-[320px]">
              <Search className="h-4 w-4" />
              <input
                value={keyword}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyword(event.target.value)}
                className="w-full border-0 bg-transparent p-0 text-[#101828] outline-none"
                placeholder="搜索当前目录下的报表"
              />
            </label>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleChildren.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => setSelectedId(folder.id)}
                className="rounded-3xl border border-[#eaecf0] bg-[#f8fafc] p-5 text-left transition hover:border-brand hover:bg-white"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-brand shadow-sm">
                    <FolderOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium text-ink">{folder.name}</div>
                    <div className="text-sm text-muted">{folder.reports?.length ?? 0} 个报表</div>
                  </div>
                </div>
              </button>
            ))}

            {filteredReports.map((report) => (
              <article key={report.id} className="rounded-3xl border border-[#eaecf0] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eef2ff] text-[#354edb]">
                    <FileBarChart2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium text-ink">{report.name}</div>
                    <div className="text-sm text-muted">负责人: {report.owner}</div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-sm text-[#475467]">
                  <span>最近更新 {report.updatedAt}</span>
                  <span>{report.views} 次访问</span>
                </div>
              </article>
            ))}
          </div>

          {!visibleChildren.length && !filteredReports.length ? (
            <div className="mt-6 rounded-3xl border border-dashed border-[#d0d5dd] px-6 py-10 text-center text-sm text-muted">
              当前目录还没有内容，先新建目录或创建第一张报表。
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}

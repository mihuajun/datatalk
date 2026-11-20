"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, BookOpenCheck, CheckCircle2, Clock3, ChevronDown, Check, History, Database, FileText, LoaderCircle, Search, Trash2, X } from "lucide-react";

type MetricStatus = "active" | "disabled" | "archived";
type Metric = {
  metricKey: string;
  ownerName: string | null;
  updatedByName: string | null;
  name: string;
  aliases: string[];
  content: string; keywords: string[]; createdAt: string;
  status: MetricStatus;
  version: number;
  fingerprint: string;
  acceptedCount: number;
  rejectedCount: number;
  updatedAt: string;
  sourceReportCode: string | null;
  sourceReportName: string | null;
  sourceReports: string[];
  reportBindings?: Array<{ reportCode: string; reportName: string; version: number; updatedAt: string }>;
};
type Proposal = {
  id: number;
  metricKey: string;
  name: string;
  aliases: string[];
  content: string; keywords: string[]; createdAt: string;
  action: string;
  confirmed: boolean;
  validated: boolean;
  status: string;
  phase: string;
  failureReason?: string | null;
  baseVersion: number;
  sourceReportName: string | null;
  updatedAt: string;
  updatedByName: string | null;
  ownerName: string | null;
};
type MetricHistory = { name: string; aliases: string[]; content: string; keywords: string[]; createdAt: string; version: number; action: string; sourceReportName: string | null; updatedAt: string; ownerName: string | null };
type Tab = "active" | "pending" | "archived";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function StatusTag({ status }: { status: MetricStatus | string }) {
  const verified = status === "active";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${verified ? "bg-[#e8f6ef] text-[#17835a]" : "bg-[#f1f3f6] text-[#68758a]"}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${verified ? "bg-[#20a36d]" : "bg-[#96a0af]"}`} />{verified ? "有效" : status === "disabled" ? "已禁用" : status === "archived" ? "已归档" : "待处理"}
  </span>;
}

function proposalPhase(proposal: Proposal) {
  if (proposal.status === "rejected") return "版本或状态冲突，需重试";
  const needs = [
    ...(!proposal.confirmed ? ["业务确认"] : []),
    ...(!proposal.validated ? ["SQL 校验"] : []),
  ];
  if (needs.length) return `待${needs.join("、")}`;
  return "等待报表提交";
}

function ProposalPhaseTag({ proposal }: { proposal: Proposal }) {
  return <span className="inline-flex items-center rounded-full bg-[#fff6e6] px-2 py-1 text-[11px] font-semibold text-[#986b1f]">{proposalPhase(proposal)}</span>;
}

function VersionPicker({ metric, history, loading, selectedVersion, onSelect }: {
  metric: Metric; history: MetricHistory[]; loading: boolean; selectedVersion: number; onSelect: (version: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const versions = [...history];
  if (!versions.some(entry => entry.version === metric.version)) versions.push({
    version: metric.version, name: metric.name, aliases: metric.aliases, content: metric.content,
    keywords: metric.keywords, createdAt: metric.updatedAt, updatedAt: metric.updatedAt,
    action: "update", sourceReportName: metric.sourceReportName, ownerName: metric.updatedByName,
  });
  versions.sort((a, b) => b.version - a.version);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    container.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div ref={container} className="relative" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <button ref={trigger} type="button" aria-label="查看语义版本" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? "metric-version-menu" : undefined} disabled={loading}
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dfe4ea] bg-white px-3 text-xs text-[#45556b] shadow-sm transition hover:border-[#bcc7d5] hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6089c8] disabled:opacity-60">
      {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5 text-[#8290a3]" />}
      <span className="font-semibold">v{selectedVersion}</span><span className="text-[#8290a3]">{selectedVersion === metric.version ? "当前版本" : "历史版本"}</span>
      <ChevronDown className={`h-3.5 w-3.5 text-[#8290a3] transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open ? <div className="absolute right-0 top-full z-[60] mt-2 w-[320px] max-w-[calc(100vw-48px)] overflow-hidden rounded-xl border border-[#e3e8ef] bg-white shadow-[0_12px_36px_rgba(23,36,58,0.16)]">
      <div className="border-b border-[#edf0f4] px-4 py-3"><p className="text-xs font-semibold text-[#26354a]">版本记录</p><p className="mt-1 text-[11px] text-[#8793a4]">选择版本查看对应内容</p></div>
      <div id="metric-version-menu" role="menu" aria-label="语义版本记录" className="max-h-[min(360px,45dvh)] overflow-y-auto p-1.5" onKeyDown={event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
        {versions.map(entry => <button key={entry.version} type="button" role="menuitemradio" aria-checked={entry.version === selectedVersion} tabIndex={-1}
          onClick={() => { onSelect(entry.version); close(); }} className={`flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-[#f1f4f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6089c8] ${entry.version === selectedVersion ? "bg-[#f1f5f9]" : "bg-white"}`}>
          <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="text-[13px] font-semibold text-[#26354a]">v{entry.version}</span>{entry.version === metric.version ? <span className="rounded bg-[#e8f6ef] px-1.5 py-0.5 text-[10px] font-medium text-[#17835a]">当前版本</span> : null}</span>
            <span data-testid="version-update-meta" className="mt-2 flex min-w-0 items-center gap-2 text-[11px] leading-5">
              <span className="min-w-0 flex-1 truncate text-[#637188]" title={`更新人：${entry.ownerName || "未记录"}`} aria-label={`更新人：${entry.ownerName || "未记录"}`}>{entry.ownerName || "未记录"}</span>
              <time dateTime={entry.updatedAt} title="更新时间" aria-label={`更新时间：${new Date(entry.updatedAt).toLocaleString("zh-CN")}`} className="shrink-0 whitespace-nowrap tabular-nums text-[#8793a4]">{new Date(entry.updatedAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time>
            </span>
          </span>
          <span className="mt-0.5 h-4 w-4 shrink-0">{entry.version === selectedVersion ? <Check className="h-4 w-4 text-[#26354a]" /> : null}</span>
        </button>)}
      </div>
    </div> : null}
  </div>;
}

function DetailPanel({ metric, proposal, onClose }: { metric: Metric | null; proposal: Proposal | null; onClose: () => void }) {
  const [history, setHistory] = useState<MetricHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<"details" | "reports">("details");
  useEffect(() => { setDetailTab("details"); }, [metric?.metricKey, proposal?.id]);
  useEffect(() => {
    setHistory([]);
    setSelectedVersion(null);
    setHistoryError(false);
    if (!metric) { setHistoryLoading(false); return; }
    let active = true;
    setHistoryLoading(true);
    void fetch(`/api/metrics?history=${encodeURIComponent(metric.metricKey)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { history?: MetricHistory[] };
        if (!response.ok) throw new Error("版本记录读取失败");
        if (active) setHistory(result.history || []);
      })
      .catch(() => { if (active) { setHistory([]); setHistoryError(true); } })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [metric?.metricKey, metric?.version]);
  const item = metric || proposal;
  if (!item) return null;

  const isProposal = Boolean(proposal);
  const revision = metric && selectedVersion !== null && selectedVersion !== metric.version
    ? history.find(entry => entry.version === selectedVersion) : undefined;
  const display = revision || item;
  const displayedVersion = revision?.version ?? metric?.version;
  const rows = [
    ...(proposal?.failureReason ? [["处理说明", proposal.failureReason]] : []),
    ["创建人", isProposal ? proposal!.ownerName || "未记录" : metric!.ownerName || "未记录"],
    [revision ? "版本创建人" : "更新人", (revision ? revision.ownerName : item.updatedByName) || "未记录"],
    [revision ? "版本创建时间" : "创建时间", formatDate(display.createdAt)],
    ["关键词", display.keywords.join("、") || "未提供"],
    ...(revision ? [["版本来源报表", revision.sourceReportName || "未关联报表"]] : []),
  ] as const;

  return <>
    <button type="button" aria-label="关闭指标详情" onClick={onClose} className="fixed inset-0 z-40 cursor-default bg-[#101828]/25" />
    <aside aria-label={`${item.name}详情`} className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[880px] flex-col border-l border-[#e3e8ef] bg-white shadow-2xl">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e9edf2] px-6 py-5">
        <div className="min-w-0 flex-1 basis-[200px]">
          <div className="mb-2 flex items-center gap-2">{isProposal ? <ProposalPhaseTag proposal={proposal!} /> : <StatusTag status={metric!.status} />}{metric ? <span className="text-xs text-[#8290a3]">v{displayedVersion}</span> : null}</div>
          <h2 className="truncate text-xl font-bold tracking-tight text-[#17243a]">{display.name}</h2>
          {display.aliases.length ? <p className="mt-1 text-xs text-[#758399]">别名：{display.aliases.join("、")}</p> : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">

        <button type="button" aria-label="关闭" onClick={onClose} className="ml-1 rounded-md p-2 text-[#77849a] hover:bg-[#f2f5f9] hover:text-[#17243a]"><X className="h-4 w-4" /></button>
        </div>
      </header>
      <div role="tablist" aria-label="指标信息" className="flex shrink-0 gap-6 border-b border-[#e9edf2] px-6">
        {([["details", "详情"], ["reports", "关联报表"]] as const).map(([value, label]) => <button key={value} type="button" role="tab" id={`metric-panel-tab-${value}`} aria-controls={`metric-panel-${value}`} aria-selected={detailTab === value} tabIndex={detailTab === value ? 0 : -1} onClick={() => setDetailTab(value)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "details" : event.key === "End" ? "reports" : detailTab === "details" ? "reports" : "details";
          setDetailTab(next);
          document.getElementById(`metric-panel-tab-${next}`)?.focus();
        }} className={`border-b-2 py-3 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6089c8] ${detailTab === value ? "border-[#26354a] text-[#17243a]" : "border-transparent text-[#8290a3] hover:text-[#45556b]"}`}>{label}</button>)}
      </div>
      <div key={detailTab} role="tabpanel" id={`metric-panel-${detailTab}`} aria-labelledby={`metric-panel-tab-${detailTab}`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {detailTab === "details" ? <>
        {historyError ? <p role="status" className="mb-4 text-xs text-[#986b1f]">历史版本读取失败，当前显示最新内容。请关闭后重新打开重试。</p> : null}
        {revision ? <p role="status" className="mb-4 rounded-md bg-[#fff6e6] px-3 py-2 text-xs leading-5 text-[#986b1f]">正在查看历史版本 v{revision.version}（只读）。当前版本为 v{metric!.version}，切换查看不会修改指标或报表绑定。</p> : null}
        <div data-testid="metric-detail-toolbar" className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 basis-[480px] flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#718096]">
          <span className="inline-flex items-center gap-1.5"><Database className="h-3.5 w-3.5" />纯文本语义 · {item.metricKey}</span>
          <span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />{isProposal ? `候选来源报表：${proposal!.sourceReportName || "未关联报表"}` : `引用报表：${metric!.sourceReports.length} 份`}</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{formatDate(revision ? revision.updatedAt : item.updatedAt)}</span>
          </div>
          {metric ? <div className="ml-auto shrink-0"><VersionPicker key={metric.metricKey} metric={metric} history={history} loading={historyLoading} selectedVersion={displayedVersion!} onSelect={setSelectedVersion} /></div> : null}
        </div>
        <dl className="divide-y divide-[#edf0f4] rounded-lg border border-[#e7ebf0] px-4">
          {rows.map(([label, value]) => <div key={label} className="grid grid-cols-[94px_minmax(0,1fr)] gap-4 py-3.5">
            <dt className="pt-0.5 text-xs font-medium text-[#8793a4]">{label}</dt>
            <dd className="whitespace-pre-wrap break-words text-[13px] leading-6 text-[#26354a]">{Array.isArray(value) ? value.join("；") : value || <span className="text-[#a5afbd">未提供</span>}</dd>
          </div>)}
        </dl>
        <section className="mt-5 rounded-lg border border-[#e7ebf0] p-4">
          <h3 className="mb-2 text-[13px] font-semibold">语义内容</h3>
          <p className="mb-3 text-[11px] text-[#8793a4]">{revision ? "此处展示所选历史版本的完整内容，不会替换当前检索版本；SQL 示例不会在此执行。" : "检索命中后，将此完整内容交给 AI；SQL 示例不会在此执行。"}</p>
          <pre data-testid="metric-content" className="whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-[#26354a]">{display.content}</pre>
        </section>
        {metric ? <>

          <div className="mt-4 rounded-lg bg-[#f6f8fb] px-4 py-3 text-xs leading-5 text-[#69778c]">已采用 {metric.acceptedCount} 次 · 被拒绝 {metric.rejectedCount} 次</div>

        </> : <div className="mt-4 rounded-lg border border-[#f3dfb8] bg-[#fffaf0] px-4 py-3 text-xs leading-5 text-[#896a31]">此处用于查看 Skill 提交的候选。需补充定义时，请回到报表编辑器中的 AI 助手处理；候选需要业务确认、本指标 SQL 校验和报表提交；冲突候选须重新检索口径后提交。</div>}
        </> : metric ? <>
          <p className="mb-4 text-xs leading-5 text-[#8290a3]">展示此指标所有版本的报表引用；各报表使用其固定绑定的版本，不随详情中的查看版本切换。</p>
          <section className="rounded-lg border border-[#e7ebf0] px-4 py-3">
            <h3 className="mb-2 text-[13px] font-semibold text-[#26354a]">引用此指标的报表 <span className="ml-1 text-xs font-normal text-[#8290a3]">{metric.sourceReports.length}</span></h3>
            {metric.reportBindings?.length ? <ul className="space-y-1.5">{metric.reportBindings.map(binding => <li key={binding.reportCode} className="flex items-start gap-2 text-xs leading-5 text-[#637188]"><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8290a3]" /><span>{binding.reportName} · v{binding.version}{binding.version < metric.version ? "（使用历史口径，不自动升级）" : ""}</span></li>)}</ul> : <p className="text-xs text-[#8290a3]">暂无已提交报表引用记录</p>}
          </section>
        </> : <div className="rounded-lg border border-[#e7ebf0] px-4 py-5">
          <h3 className="text-[13px] font-semibold text-[#26354a]">暂无已提交报表引用记录</h3>
          <p className="mt-2 text-xs leading-5 text-[#8290a3]">候选尚未成为正式指标。候选来源报表：{proposal!.sourceReportName || "未关联报表"}。</p>
        </div>}
      </div>
      <footer className="border-t border-[#e9edf2] px-6 py-4">
        <Link href="/reports" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#1d2c42] px-4 text-[13px] font-semibold text-white hover:bg-[#2a3d58] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6089c8]">前往报表中心使用 AI 助手<ArrowRight className="h-4 w-4" /></Link>
      </footer>
    </aside>
  </>;
}

export default function MetricsPage() {
  const [tab, setTab] = useState<Tab>("active");
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedMetricKey, setSelectedMetricKey] = useState<string | null>(null);
  const [selectedProposalId, setSelectedProposalId] = useState<number | null>(null);
  const [savingMetricKey, setSavingMetricKey] = useState<string | null>(null);
  const [confirmDeleteMetric, setConfirmDeleteMetric] = useState<Metric | null>(null);

  const load = useCallback(async (search: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ keyword: search, status: "all" });
      const response = await fetch(`/api/metrics?${params}`, { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json() as { metrics?: Metric[]; proposals?: Proposal[]; message?: string };
      if (!response.ok || !result.metrics || !result.proposals) throw new Error(result.message || "指标语义读取失败");
      setMetrics(result.metrics);
      setProposals(result.proposals);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "指标语义读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(""); }, [load]);
  const visibleMetrics = useMemo(() => metrics.filter((metric) => tab === "active" ? metric.status === "active" || metric.status === "disabled" : metric.status === tab), [metrics, tab]);
  const selectedMetric = metrics.find((metric) => metric.metricKey === selectedMetricKey) || null;
  const selectedProposal = proposals.find((proposal) => proposal.id === selectedProposalId) || null;
  const pendingCount = proposals.length;

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedKeyword(keyword.trim());
    void load(keyword.trim());
  }

  async function updateManagement(metric: Metric, change: { status: MetricStatus }) {
    setSavingMetricKey(metric.metricKey);
    setError("");
    try {
      const response = await fetch("/api/metrics", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ metricKey: metric.metricKey, ...change }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "指标管理信息更新失败");
      await load(submittedKeyword);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "指标管理信息更新失败");
    } finally {
      setSavingMetricKey(null);
    }
  }

  async function deleteMetric(metric: Metric) {
    setSavingMetricKey(metric.metricKey);
    setError("");
    try {
      const response = await fetch("/api/metrics", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ metricKey: metric.metricKey }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "指标删除失败");
      setConfirmDeleteMetric(null);
      if (selectedMetricKey === metric.metricKey) setSelectedMetricKey(null);
      await load(submittedKeyword);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "指标删除失败");
      setConfirmDeleteMetric(null);
    } finally {
      setSavingMetricKey(null);
    }
  }

  return <main className="min-h-screen bg-[#f7f8fa] py-7 text-[#17243a]">
    <div className="w-full">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8793a4]"><BookOpenCheck className="h-4 w-4" />SHARED BUSINESS DEFINITIONS</div>
          <h1 className="text-[26px] font-bold tracking-[-0.03em]">指标语义</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-6 text-[#758399]">浏览团队确认的指标口径。定义和变更由报表助手中的 Skill 生成，管理页专注于查看与基础治理。</p>
        </div>
        <Link href="/reports" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#1d2c42] px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-[#2a3d58] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6089c8]">通过报表助手定义指标<ArrowRight className="h-4 w-4" /></Link>
      </div>

      <div className="mb-5 flex flex-col gap-4 border-b border-[#dfe4ea] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-6 overflow-x-auto">
          {([ ["active", "有效"], ["pending", `指标候选${pendingCount ? ` · ${pendingCount}` : ""}`], ["archived", "已归档"] ] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} className={`relative shrink-0 pb-3 text-[13px] font-semibold transition ${tab === value ? "text-[#17243a]" : "text-[#8290a3] hover:text-[#45556b]"}`}>
            {label}{tab === value ? <span className="absolute inset-x-0 bottom-[-1px] h-[2px] bg-[#2d4f78]" /> : null}
          </button>)}
        </div>
        <form onSubmit={submitSearch} className="mb-2 flex h-9 w-full max-w-[360px] items-center gap-2 rounded-md border border-[#dfe4ea] bg-white px-3 focus-within:border-[#8099b9]">
          <Search className="h-4 w-4 shrink-0 text-[#8b98aa]" />
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索名称、关键词或内容" aria-label="搜索名称、关键词或内容" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#a0aaba]" />
          {keyword ? <button type="button" onClick={() => { setKeyword(""); setSubmittedKeyword(""); void load(""); }} className="text-[11px] font-semibold text-[#718096] hover:text-[#17243a]">清空</button> : null}
          <button type="submit" className="sr-only">搜索</button>
        </form>
      </div>

      {submittedKeyword ? <p className="mb-3 text-xs text-[#8290a3]">“{submittedKeyword}” 的搜索结果</p> : null}
      {error ? <div role="alert" className="mb-4 flex items-center gap-2 rounded-md border border-[#f3cbcb] bg-[#fff6f6] px-4 py-3 text-[13px] text-[#b42318]"><AlertCircle className="h-4 w-4" />{error}<button type="button" className="ml-auto underline" onClick={() => void load(submittedKeyword)}>重试</button></div> : null}

      <section className="overflow-hidden rounded-lg border border-[#e1e6ec] bg-white">
        <div className="flex items-center justify-between border-b border-[#e9edf2] px-5 py-3.5">
          <div className="text-[13px] font-semibold">{tab === "active" ? "有效指标" : tab === "archived" ? "已归档指标" : "指标候选"}</div>
          <div className="text-xs text-[#8a96a7]">{loading ? "正在读取…" : tab === "pending" ? `${proposals.length} 项` : `${visibleMetrics.length} 项`}</div>
        </div>
        {loading ? <div className="flex h-52 items-center justify-center gap-2 text-[13px] text-[#8290a3]"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取指标语义</div> : tab === "pending" ? proposals.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1040px] border-collapse text-left">
          <thead><tr className="bg-[#fafbfc] text-[11px] font-semibold text-[#8793a4]"><th className="min-w-[72px] whitespace-nowrap px-4 py-3">序号</th><th className="px-5 py-3">候选指标</th><th className="px-4 py-3">口径摘要</th><th className="px-4 py-3">来源报表</th><th className="px-4 py-3">当前阶段</th><th className="px-4 py-3">更新时间</th><th className="px-4 py-3">更新人</th><th className="px-5 py-3 text-right">操作</th></tr></thead>
          <tbody className="divide-y divide-[#edf0f4]">{proposals.map((proposal, index) => <tr key={proposal.id} className="hover:bg-[#f8fafc]">
            <td className="px-4 py-4 text-xs tabular-nums text-[#8290a3]">{index + 1}</td>
            <td className="px-5 py-4"><span className="text-[13px] font-semibold text-[#233247]">{proposal.name}</span></td>
            <td className="max-w-[360px] px-4 py-4"><div className="truncate text-xs text-[#5e6d82]">{proposal.content || "候选定义尚未补全"}</div><div className="mt-1 truncate text-[11px] text-[#9aa5b4]">{proposal.keywords.join("、") || "计算规则待补充"}</div></td>
            <td className="px-4 py-4 text-xs text-[#637188]">{proposal.sourceReportName || "未关联报表"}</td><td className="px-4 py-4"><ProposalPhaseTag proposal={proposal} /></td><td className="px-4 py-4 text-xs text-[#8290a3]">{formatDate(proposal.updatedAt)}</td><td className="px-4 py-4 text-xs text-[#637188]">{proposal.updatedByName || "未记录"}</td>
            <td className="px-5 py-4 text-right"><button type="button" onClick={() => { setSelectedMetricKey(null); setSelectedProposalId(proposal.id); }} className="inline-flex items-center gap-1 rounded border border-[#dfe4ea] px-2.5 py-1.5 text-[11px] font-medium text-[#526174] hover:bg-white">查看<ArrowRight className="h-3 w-3" /></button></td>
          </tr>)}</tbody>
        </table></div> : <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center"><CheckCircle2 className="mb-3 h-7 w-7 text-[#61a885]" /><p className="text-[13px] font-semibold">当前没有尚未沉淀的指标候选</p><p className="mt-1 text-xs text-[#8290a3]">候选来自报表助手中的 Skill 流程；需业务确认和 SQL 校验，并随报表提交后才会成为团队共享指标。</p></div> : visibleMetrics.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1480px] border-collapse text-left [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
          <thead><tr className="bg-[#fafbfc] text-[11px] font-semibold text-[#8793a4]"><th className="min-w-[72px] whitespace-nowrap px-4 py-3">序号</th><th className="sticky left-0 z-10 min-w-[210px] bg-[#fafbfc] px-5 py-3">指标</th><th className="px-4 py-3">口径摘要</th><th className="px-4 py-3">使用数量</th><th className="px-4 py-3">创建人</th><th className="px-4 py-3">更新人</th><th className="px-4 py-3">关键词</th><th className="px-4 py-3">版本</th><th className="px-4 py-3">更新时间</th><th className="sticky right-0 z-20 min-w-[240px] border-l border-[#edf0f4] bg-[#fafbfc] px-5 py-3 text-right">操作</th></tr></thead>
          <tbody className="divide-y divide-[#edf0f4]">{visibleMetrics.map((metric, index) => <tr key={metric.metricKey} className="cursor-pointer transition hover:bg-[#f8fafc]" onClick={() => { setSelectedProposalId(null); setSelectedMetricKey(metric.metricKey); }} onKeyDown={(event) => { if (event.key === "Enter") { setSelectedProposalId(null); setSelectedMetricKey(metric.metricKey); } }} tabIndex={0}>
            <td className="px-4 py-4 text-xs tabular-nums text-[#8290a3]">{index + 1}</td>
            <td className="sticky left-0 z-10 bg-white px-5 py-4"><div className="max-w-[210px] truncate text-[13px] font-semibold text-[#233247]">{metric.name}</div>{metric.aliases.length ? <div className="mt-1 max-w-[200px] truncate text-[11px] text-[#8996a8]">{metric.aliases.join(" · ")}</div> : null}</td>
            <td className="max-w-[320px] px-4 py-4"><div className="truncate text-[12px] text-[#5e6d82]">{metric.content || "尚未补充业务定义"}</div><div className="mt-1 truncate text-[11px] text-[#9aa5b4]">{metric.keywords.join("、") || "计算规则待补充"}</div></td>
            <td className="px-4 py-4 text-xs tabular-nums text-[#637188]">{metric.sourceReports.length}</td>
            <td className="px-4 py-4 text-xs text-[#637188]">{metric.ownerName || "未指定"}</td>
            <td className="px-4 py-4 text-xs text-[#637188]">{metric.updatedByName || "未记录"}</td>
            <td className="px-4 py-4 text-xs text-[#637188]">{metric.keywords.join("、") || "—"}</td>
            <td className="px-4 py-4 text-xs text-[#637188]">v{metric.version}</td>
            <td className="px-4 py-4 text-xs text-[#8290a3]">{formatDate(metric.updatedAt)}</td>
            <td className="sticky right-0 z-20 border-l border-[#edf0f4] bg-white px-5 py-4 text-right" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><div className="inline-flex items-center justify-end gap-2"><StatusTag status={metric.status} />{metric.status !== "archived" ? <button type="button" disabled={savingMetricKey === metric.metricKey} onClick={() => void updateManagement(metric, { status: metric.status === "active" ? "disabled" : "active" })} className="rounded border border-[#dfe4ea] px-2.5 py-1.5 text-[11px] font-medium text-[#526174] hover:bg-[#f3f6fa] disabled:opacity-50">{metric.status === "active" ? "禁用" : "启用"}</button> : null}<button type="button" disabled={savingMetricKey === metric.metricKey} onClick={() => void updateManagement(metric, { status: metric.status === "archived" ? "active" : "archived" })} className="rounded border border-[#dfe4ea] px-2.5 py-1.5 text-[11px] font-medium text-[#526174] hover:bg-[#f3f6fa] disabled:opacity-50">{metric.status === "archived" ? "恢复" : "归档"}</button>{metric.status === "archived" ? <button type="button" aria-label={`删除${metric.name}`} disabled={savingMetricKey === metric.metricKey} onClick={() => setConfirmDeleteMetric(metric)} className="inline-flex items-center gap-1 rounded border border-[#f0d6d6] px-2.5 py-1.5 text-[11px] text-[#a24848] hover:bg-[#fff5f5] disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />删除</button> : null}</div></td>
          </tr>)}</tbody>
        </table></div> : <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center"><BookOpenCheck className="mb-3 h-7 w-7 text-[#9aa8b9]" /><p className="text-[13px] font-semibold">{submittedKeyword ? "没有匹配的指标" : tab === "archived" ? "没有已归档指标" : "还没有有效指标"}</p><p className="mt-1 max-w-md text-xs leading-5 text-[#8290a3]">复杂定义通过报表编辑器中的 BI Metric Knowledge Skill 生成并验证。管理页负责统一查看，不要求团队在这里重复配置公式和关联规则。</p><Link href="/reports" className="mt-3 text-xs font-semibold text-[#315f95] hover:underline">前往报表中心<ArrowRight className="ml-1 inline h-3 w-3" /></Link></div>}
      </section>
      <p className="mt-4 text-[11px] leading-5 text-[#98a3b2]">左右滑动可查看更新人、版本和更新时间，指标与操作列保持固定。序号仅用于当前页，不保存到数据库。指标可启用、禁用或归档；禁用后不参与新的语义召回，已有报表引用与历史版本保留。只有已归档且无在用报表引用的指标允许删除；新增或修订定义仍通过报表 AI 助手中的现有 Skill 流程完成。</p>
    </div>
    <DetailPanel metric={selectedMetric} proposal={selectedProposal} onClose={() => { setSelectedMetricKey(null); setSelectedProposalId(null); }} />
    {confirmDeleteMetric ? <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#101828]/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmDeleteMetric(null); }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="delete-metric-title" className="w-full max-w-[420px] rounded-xl border border-[#e3e8ef] bg-white p-5 shadow-2xl">
        <h2 id="delete-metric-title" className="text-base font-semibold text-[#17243a]">删除指标语义？</h2>
        <p className="mt-2 text-[13px] leading-6 text-[#65748a]">“{confirmDeleteMetric.name}”已归档。有在用报表引用时将阻止删除。删除后将从当前清单和 AI 检索中移除；历史版本与操作记录仍会保留。</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmDeleteMetric(null)} className="rounded-md border border-[#dfe4ea] px-3.5 py-2 text-[13px] font-medium text-[#526174] hover:bg-[#f7f9fb]">取消</button><button type="button" disabled={savingMetricKey === confirmDeleteMetric.metricKey} onClick={() => void deleteMetric(confirmDeleteMetric)} className="rounded-md bg-[#a33e3e] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#8c3434] disabled:opacity-50">{savingMetricKey === confirmDeleteMetric.metricKey ? "删除中…" : "确认删除"}</button></div>
      </section>
    </div> : null}
  </main>;
}

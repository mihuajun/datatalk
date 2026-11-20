"use client";

import { ExternalLink, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ReportDownloadFormat } from "@/lib/report-download";
import { ReportDownloadMenu, ReportDownloadFeedback, useReportDownload } from "@/components/reports/report-download-menu";
import { copyTextWithFallback } from "@/lib/copy-text";
import { PublicLinkPanel } from "@/components/reports/public-link-panel";

type Detail = {
  report: { name: string; publicLinkEnabled: boolean };
  publicLinkCode: string | null; publicLinkPassword: string | null;
  publicLinkPasswordEnabled: boolean; publicLinkExpiresAt: string | null;
};
const buttonClass = "inline-flex h-7 items-center gap-1.5 rounded-md border border-[#DDE5F0] bg-white px-2.5 text-xs font-medium text-[#526174] hover:border-[#2167E8] hover:text-[#2167E8] disabled:opacity-50";

export function WorkBuddyPreviewToolbar({ reportCode }: { reportCode: string }) {
  const base = `/api/reports/${encodeURIComponent(reportCode)}`;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [panel, setPanel] = useState<"publish" | "link" | "download" | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copiedTarget, setCopiedTarget] = useState<"link" | "all" | null>(null);
  useEffect(() => {
    if (!copiedTarget) return;
    const timer = window.setTimeout(() => setCopiedTarget(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedTarget]);
  const [manualCopyText, setManualCopyText] = useState("");
  const reportDownload = useReportDownload();
  const rootRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  const publishRef = useRef<HTMLButtonElement>(null);

  const api = useCallback(async (path = "", method = "GET", body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status === 401) throw new Error("网页登录已过期，请刷新当前页面重新登录；未自动执行任何操作。");
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "操作失败，请稍后重试");
    return result;
  }, [base]);
  const reload = useCallback(async () => { const result = await api(); setDetail(result); return result as Detail; }, [api]);
  useEffect(() => { void reload().catch(e => setError(e.message)); }, [reload]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busyRef.current) { setPanel(null); publishRef.current?.focus(); } };
    const outside = (event: PointerEvent) => { if (!busyRef.current && !rootRef.current?.contains(event.target as Node)) setPanel(null); };
    window.addEventListener("keydown", close); window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("pointerdown", outside); };
  }, []);
  async function run(task: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice(""); setCopiedTarget(null);
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function openExternal(path: string) { window.open(new URL(path, window.location.origin).toString(), "_blank", "noopener,noreferrer"); }
  function toggle(next: typeof panel) { if (!busyRef.current) { setPanel(panel === next ? null : next); setError(""); setNotice(""); } }
  async function publicLinkChange(body: Record<string, unknown>) {
    await run(async () => {
      const result = await api("/public-link", "PATCH", { enabled: true, ...body });
      setDetail(current => current ? { ...current, ...result } : current);
      setManualCopyText("");
    });
  }
  async function downloadReport(format: ReportDownloadFormat) {
    if (!detail) return;
    await run(async () => {
      setPanel(null);
      const frame = document.querySelector<HTMLIFrameElement>('[data-workbuddy-preview] iframe:not([aria-hidden="true"])');
      await reportDownload.start(frame, detail.report.name, format);
    });
  }
  const link = detail?.report.publicLinkEnabled && detail.publicLinkCode && typeof window !== "undefined" ? `${window.location.origin}/link/${encodeURIComponent(detail.publicLinkCode)}` : "";

  return <div ref={rootRef} className="sticky top-0 z-50 border-b border-[#E3EAF3] bg-white">
    <nav aria-label="WorkBuddy 报表工具栏" className="flex min-h-11 items-center gap-3 px-3 py-1.5 sm:px-4">
      <div className="min-w-0 flex-1">
        {notice && panel !== "link" && <p role="status" title={notice} className="truncate text-xs text-green-700">{notice}</p>}
        {!notice && panel !== "link" && <ReportDownloadFeedback state={reportDownload} />}
      </div>
      <div role="group" aria-label="报表操作" className="flex shrink-0 items-center gap-1.5">
      <button type="button" title="在外置浏览器打开编辑页面" className={buttonClass} onClick={() => openExternal(`/reports/editor?code=${encodeURIComponent(reportCode)}`)}><ExternalLink className="h-3.5 w-3.5" />打开</button>
      <div className="relative">
        <button ref={publishRef} type="button" disabled={!detail || busy} onClick={() => toggle("publish")} aria-expanded={panel === "publish"} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#2167E8] px-3 text-xs font-medium text-white disabled:opacity-50"><Upload className="h-3.5 w-3.5" />发布</button>
        {panel === "publish" && <section role="dialog" aria-label="发布报表" className="absolute right-0 top-9 w-[min(340px,calc(100vw-32px))] rounded-lg border bg-white p-4 shadow-xl">
          <h2 className="font-semibold">发布报表</h2><p className="my-3 text-sm text-slate-600">将「{detail?.report.name}」当前已保存的工作区发布为正式版本。此操作不会自动发布到资源中心。</p>
          <div className="flex justify-end gap-2"><button className={buttonClass} disabled={busy} onClick={() => setPanel(null)}>取消</button><button className={buttonClass} disabled={busy} onClick={() => void run(async () => { const result = await api("/release", "POST"); setPanel(null); setNotice(`报表已发布${result.version ? `（v${result.version}）` : ""}`); })}>{busy ? "发布中…" : "确认发布"}</button></div>
        </section>}
      </div>
      {detail && <PublicLinkPanel error={error} status={notice} manualCopyText={manualCopyText} compact buttonLabel="分享" containerRef={linkRef} visible={panel === "link"} enabled={detail.report.publicLinkEnabled} updating={busy} copied={copiedTarget !== null} copiedWithPassword={copiedTarget === "all"} publicLink={link} password={detail.publicLinkPassword} passwordEnabled={detail.publicLinkPasswordEnabled} expiresAt={detail.publicLinkExpiresAt} onTogglePanel={() => toggle("link")} onToggleLink={() => void publicLinkChange({ enabled: !detail.report.publicLinkEnabled })} onCopy={includePassword => void run(async () => { const text = link + (includePassword && detail.publicLinkPasswordEnabled && detail.publicLinkPassword ? `\n密码: ${detail.publicLinkPassword}` : ""); if (await copyTextWithFallback(text)) { setManualCopyText(""); setCopiedTarget(includePassword ? "all" : "link"); } else { setManualCopyText(text); } })} onRotate={() => void publicLinkChange({ rotate: true })} onResetPassword={() => void publicLinkChange({ resetPassword: true })} onTogglePasswordProtection={enabled => void publicLinkChange({ passwordEnabled: enabled })} onSaveExpiresAt={expiresAt => void publicLinkChange({ expiresAt })} />}
      <ReportDownloadMenu compact visible={panel === "download"} disabled={!detail || busy} onToggle={() => toggle("download")} onClose={() => setPanel(current => current === "download" ? null : current)} onDownload={format => void downloadReport(format)} />
      {!detail && !error && <span className="text-xs text-slate-500">正在加载报表操作…</span>}
      </div>
    </nav>
    {error && panel !== "link" && <div role="alert" className="px-6 pb-2 text-sm text-red-600">{error}{!detail && <button className="ml-3 underline" disabled={busy} onClick={() => void run(async () => { await reload(); })}>重试</button>}</div>}
  </div>;
}

"use client";

import { ChevronDown, Download, FileImage, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createReportDownload, triggerReportDownload, type ReportDownloadFormat } from "@/lib/report-download";

/** Shared export lifecycle for the editor and embedded preview. */
export function useReportDownload() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [download, setDownload] = useState<{ url: string; filename: string; format: ReportDownloadFormat } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);

  async function start(frame: HTMLIFrameElement | null, name: string, format: ReportDownloadFormat) {
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true); setDownload(null); setNotice(`正在生成 ${format.toUpperCase()}…`);
    try {
      const result = await createReportDownload(frame, name, format, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      setDownload({ url, filename: result.filename, format });
      triggerReportDownload(url, result.filename);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      abortRef.current = null;
      if (!controller.signal.aborted) { setBusy(false); setNotice(""); }
    }
  }
  return { busy, notice, download, start };
}

export function ReportDownloadFeedback({ state }: { state: ReturnType<typeof useReportDownload> }) {
  if (state.notice) return <span role="status" className="block truncate text-xs text-[#16845B]">{state.notice}</span>;
  if (!state.download) return null;
  return <a href={state.download.url} download={state.download.filename} title={`若未自动下载，请点击保存 ${state.download.filename}`} className="block truncate text-xs text-[#2167E8] underline">保存 {state.download.format.toUpperCase()}</a>;
}

export function ReportDownloadMenu({ visible, disabled, compact = false, onToggle, onClose, onDownload }: {
  visible: boolean;
  disabled?: boolean;
  compact?: boolean;
  onToggle: () => void;
  onClose: () => void;
  onDownload: (format: ReportDownloadFormat) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [visible, onClose]);
  return <div ref={rootRef} className="relative" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) onClose();
  }}>
    <button ref={buttonRef} type="button" disabled={disabled} onClick={onToggle} aria-haspopup="menu" aria-expanded={visible} className={`inline-flex items-center gap-1.5 rounded-md border border-[#DDE5F0] bg-white text-xs text-[#526174] hover:border-[#2167E8] hover:text-[#2167E8] disabled:opacity-50 ${compact ? "h-7 px-2.5 font-medium" : "h-9 px-3 font-semibold"}`}><Download className="h-3.5 w-3.5" />下载<ChevronDown className="h-3 w-3" /></button>
    {visible && <div role="menu" aria-label="下载报表" className="absolute right-0 top-full z-50 mt-2 w-32 rounded-md border border-[#DDE5F0] bg-white p-1 shadow-lg" onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); buttonRef.current?.focus(); }
    }}>
      <button autoFocus type="button" role="menuitem" onClick={() => onDownload("pdf")} className="flex w-full items-center gap-2 rounded px-3 py-2 text-xs text-[#526174] hover:bg-[#EDF3FF] focus:bg-[#EDF3FF]"><FileText className="h-4 w-4" />PDF</button>
      <button type="button" role="menuitem" onClick={() => onDownload("png")} className="flex w-full items-center gap-2 rounded px-3 py-2 text-xs text-[#526174] hover:bg-[#EDF3FF] focus:bg-[#EDF3FF]"><FileImage className="h-4 w-4" />PNG</button>
    </div>}
  </div>;
}

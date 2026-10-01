"use client";

import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";

export function ExportHtmlButton({ reportCode, reportName, className }: { reportCode: string; reportName?: string; className?: string }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(reportCode)}/export-html`, { method: "POST" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({ message: "导出失败" }));
        throw new Error(result.message || "导出失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disposition = response.headers.get("Content-Disposition");
      const match = /filename\*=UTF-8''(.+)/.exec(disposition || "");
      a.download = match ? decodeURIComponent(match[1]) : `${reportName || reportCode}.html`;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "导出静态 HTML 失败");
    } finally {
      setExporting(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={exporting}
        className={className || "inline-flex h-9 items-center gap-1.5 rounded-md border border-[#DDE5F0] bg-white px-3 text-xs font-semibold text-[#526174] transition hover:border-[#2167E8] hover:text-[#2167E8] disabled:cursor-not-allowed disabled:opacity-45"}
        aria-label="导出静态 HTML"
        title="导出静态 HTML"
      >
        {exporting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        导出
      </button>
      {error ? <span className="text-xs text-[#D92D20]">{error}</span> : null}
    </span>
  );
}

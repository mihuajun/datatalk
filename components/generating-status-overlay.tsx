"use client";

import { useEffect, useState } from "react";

type Props = {
  reportCode: string;
};

export function GeneratingStatusOverlay({ reportCode }: Props) {
  const [generating, setGenerating] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval>;

    async function check() {
      try {
        const response = await fetch(`/api/reports/${encodeURIComponent(reportCode)}/status`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && data.generating) {
          setGenerating(true);
        } else if (!cancelled && generating) {
          // Was generating, now done — reload
          window.location.reload();
        }
      } catch {
        // Ignore network errors
      }
    }

    void check();
    timer = setInterval(() => void check(), 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [reportCode, generating, dismissed]);

  if (!generating || dismissed) return null;

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 99999, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto", marginTop: "16px", display: "flex", alignItems: "center", gap: "8px", borderRadius: "8px", background: "#2167E8", padding: "8px 16px", color: "#fff", fontSize: "13px", boxShadow: "0 4px 12px rgba(33,103,232,0.3)" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: "spin 1s linear infinite" }}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeDasharray="31.4 31.4" strokeDashoffset="10" />
        </svg>
        <span>内容更新中，完成后自动刷新…</span>
        <button type="button" onClick={() => setDismissed(true)} style={{ marginLeft: "4px", cursor: "pointer", opacity: 0.8, background: "none", border: "none", color: "inherit", fontSize: "16px", lineHeight: 1 }} aria-label="关闭提示">×</button>
      </div>
    </div>
  );
}

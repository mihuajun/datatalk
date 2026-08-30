"use client";

import type { CSSProperties, RefObject } from "react";
import { useEffect, useLayoutEffect, useState } from "react";
import { CalendarDays, Check, Copy, Link2, RefreshCw, RotateCcw } from "lucide-react";

type PublicLinkPanelProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  anchorRef?: RefObject<HTMLElement | null>;
  visible: boolean;
  enabled: boolean;
  updating: boolean;
  copied: boolean;
  publicLink: string;
  password: string | null;
  passwordEnabled: boolean;
  expiresAt: string | null;
  onTogglePanel: () => void;
  onToggleLink: () => void;
  onCopy: () => void;
  onRotate: () => void;
  onResetPassword: () => void;
  onTogglePasswordProtection: (enabled: boolean) => void;
  onSaveExpiresAt: (expiresAt: string | null) => void;
  panelOnly?: boolean;
};

function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultDateTimeLocal() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setSeconds(0, 0);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PublicLinkPanel({
  containerRef,
  anchorRef,
  visible,
  enabled,
  updating,
  copied,
  publicLink,
  password,
  passwordEnabled,
  expiresAt,
  onTogglePanel,
  onToggleLink,
  onCopy,
  onRotate,
  onResetPassword,
  onTogglePasswordProtection,
  onSaveExpiresAt,
  panelOnly = false,
}: PublicLinkPanelProps) {
  const [expiryMode, setExpiryMode] = useState(expiresAt ? "custom" : "permanent");
  const [expiryInput, setExpiryInput] = useState(toDateTimeLocal(expiresAt));
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    setExpiryMode(expiresAt ? "custom" : "permanent");
    setExpiryInput(toDateTimeLocal(expiresAt));
  }, [expiresAt]);

  useLayoutEffect(() => {
    if (!panelOnly || !visible) {
      setPanelPosition(null);
      return;
    }

    function updatePanelPosition() {
      const anchor = anchorRef?.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const panelWidth = Math.min(350, window.innerWidth - 24);
      const left = Math.min(
        Math.max(12, rect.right - panelWidth),
        Math.max(12, window.innerWidth - panelWidth - 12),
      );
      setPanelPosition({ top: rect.bottom + 8, left });
    }

    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [anchorRef, panelOnly, visible]);

  function changeExpiryMode(value: string) {
    setExpiryMode(value);
    if (value === "permanent") {
      setExpiryInput("");
      onSaveExpiresAt(null);
      return;
    }
    const nextValue = expiryInput || defaultDateTimeLocal();
    setExpiryInput(nextValue);
    const date = new Date(nextValue);
    if (!Number.isNaN(date.getTime())) onSaveExpiresAt(date.toISOString());
  }

  function saveExpiry() {
    if (expiryMode === "permanent") {
      onSaveExpiresAt(null);
      return;
    }
    const date = new Date(expiryInput);
    if (!Number.isNaN(date.getTime())) onSaveExpiresAt(date.toISOString());
  }

  return (
    <div ref={containerRef} className={panelOnly ? "pointer-events-none" : "relative"}>
      {!panelOnly ? <button type="button" onClick={onTogglePanel} className={`flex h-8 w-8 items-center justify-center rounded transition ${visible || enabled ? "bg-[#EDF3FF] text-[#2167E8]" : "text-[#526174] hover:bg-[#F5F8FD]"}`} aria-label={visible ? "收起公共链接设置" : "显示公共链接设置"} aria-expanded={visible} title="公共链接">
        <Link2 className="h-4 w-4" />
      </button> : null}
      {visible ? (
        <div
          className={`${panelOnly ? "pointer-events-auto fixed z-50" : "absolute right-0 top-[38px] z-30"} w-[350px] max-w-[calc(100vw-24px)] rounded-lg border border-[#E7EDF5] bg-white p-4 text-left shadow-[0_12px_30px_rgba(23,36,58,0.12)]`}
          style={panelOnly ? {
            top: panelPosition?.top,
            left: panelPosition?.left,
            visibility: panelPosition ? "visible" : "hidden",
          } satisfies CSSProperties : undefined}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-bold text-[#344054]">获取公共链接</div>
              <p className="mt-1 text-[11px] leading-5 text-[#8A98AC]">{passwordEnabled ? "启用后，任何持有链接和密码的人都可以访问已发布报表。" : "默认无需密码，启用密码保护后访问时需要输入密码。"}</p>
            </div>
            <button type="button" role="switch" aria-checked={enabled} aria-label={enabled ? "禁用公共链接" : "启用公共链接"} title={enabled ? "点击禁用公共链接" : "点击启用公共链接"} disabled={updating} onClick={onToggleLink} className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:cursor-wait disabled:opacity-60 ${enabled ? "bg-[#2167E8]" : "bg-[#CBD5E1]"}`}>
              <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition ${enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
            </button>
          </div>

          {enabled ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-md border border-[#DDE5F0] bg-[#FAFCFF] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold text-[#98A2B3]">完整链接</div>
                    <div className="mt-1 truncate text-[11px] text-[#344054]" title={publicLink}>{publicLink}</div>
                  </div>
                  <button type="button" onClick={onCopy} disabled={updating} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#DDE5F0] bg-white text-[#526174] hover:border-[#2167E8] hover:text-[#2167E8] disabled:opacity-50" aria-label={passwordEnabled ? "复制链接和密码" : "复制公共链接"} title={passwordEnabled ? "复制链接和密码" : "复制公共链接"}>
                    {copied ? <Check className="h-3.5 w-3.5 text-[#16845B]" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" onClick={onRotate} disabled={updating} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#DDE5F0] bg-white text-[#526174] hover:border-[#2167E8] hover:text-[#2167E8] disabled:cursor-not-allowed disabled:opacity-50" aria-label="更换公共链接" title="更换公共链接">
                    <RefreshCw className={`h-3.5 w-3.5 ${updating ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>

              <div className="rounded-md border border-[#E7EDF5] px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#17243A]">
                    <input type="checkbox" checked={passwordEnabled} disabled={updating} onChange={(event) => onTogglePasswordProtection(event.target.checked)} className="h-4 w-4 rounded border-[#B8C4D4] accent-[#2167E8]" />
                    <span>Password Protection</span>
                  </label>
                  {passwordEnabled ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold tracking-[0.2em] text-[#17243A]">{password || "----"}</span>
                      <button type="button" onClick={onResetPassword} disabled={updating} className="inline-flex h-7 items-center gap-1 rounded px-1.5 text-xs font-semibold text-[#2167E8] hover:bg-[#EDF3FF] disabled:opacity-50" title="重置密码">
                        <RotateCcw className="h-3.5 w-3.5" />重置
                      </button>
                    </div>
                  ) : <span className="text-[11px] text-[#98A2B3]">未启用</span>}
                </div>
              </div>

              <div>
                <label htmlFor="public-link-expiry-mode" className="text-xs font-semibold text-[#526174]">有效期</label>
                <div className="mt-1.5 flex items-center gap-2">
                  <select id="public-link-expiry-mode" value={expiryMode} disabled={updating} onChange={(event) => changeExpiryMode(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-[#DDE5F0] bg-white px-2.5 text-xs text-[#526174] outline-none focus:border-[#2167E8]">
                    <option value="permanent">永久有效</option>
                    <option value="custom">截止日期</option>
                  </select>
                  <CalendarDays className="h-4 w-4 shrink-0 text-[#71819B]" />
                </div>
                {expiryMode === "custom" ? <input type="datetime-local" value={expiryInput} disabled={updating} onChange={(event) => setExpiryInput(event.target.value)} onBlur={saveExpiry} min={toDateTimeLocal(new Date().toISOString())} className="mt-2 h-9 w-full rounded-md border border-[#DDE5F0] px-2.5 text-xs text-[#526174] outline-none focus:border-[#2167E8]" /> : null}
              </div>

              <button type="button" onClick={onCopy} disabled={updating || !publicLink} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#2167E8] px-3 text-xs font-semibold text-white hover:bg-[#1858CC] disabled:cursor-not-allowed disabled:opacity-55">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? (passwordEnabled ? "已复制链接和密码" : "已复制公共链接") : (passwordEnabled ? "复制链接和密码" : "复制公共链接")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

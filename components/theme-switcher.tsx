"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Palette } from "lucide-react";

import { REPORT_THEMES, type ReportThemeId } from "@/lib/report-themes";

export function ThemeSwitcher({ reportCode, onChanged }: { reportCode: string; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ left: 0, top: 0 });
  const [current, setCurrent] = useState<ReportThemeId>("default");
  const [customText, setCustomText] = useState("");
  const [customDraft, setCustomDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/reports/${encodeURIComponent(reportCode)}/theme`, { headers: { Accept: "application/json" }, cache: "no-store" });
        const result = await response.json() as { theme?: { id: ReportThemeId; custom?: string } };
        if (!cancelled && response.ok && result.theme) {
          setCurrent(result.theme.id);
          if (result.theme.custom) {
            setCustomText(result.theme.custom);
            setCustomDraft(result.theme.custom);
          }
        }
      } catch {
        // 读取失败时保持默认风格
      }
    })();
    return () => { cancelled = true; };
  }, [reportCode]);

  // 工具栏容器有 overflow-x-auto，下拉菜单用 fixed 定位避免被裁剪
  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, true);
    };
  }, [open]);

  const toggle = useCallback(() => {
    setOpen((value) => {
      if (!value && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const left = Math.min(rect.left, window.innerWidth - 250);
        setMenuPos({ left: Math.max(8, left), top: rect.bottom + 4 });
      }
      return !value;
    });
  }, []);

  const applyTheme = useCallback(async (id: ReportThemeId, custom?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(reportCode)}/theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id, ...(custom ? { custom } : {}) }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "风格更新失败");
      setCurrent(id);
      if (custom) setCustomText(custom);
      setOpen(false);
      onChanged?.();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "风格更新失败");
    } finally {
      setBusy(false);
    }
  }, [busy, reportCode, onChanged]);

  const activeTheme = REPORT_THEMES.find((theme) => theme.id === current) ?? REPORT_THEMES[0];

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={busy}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded px-2 text-xs font-semibold transition ${open ? "bg-[#EDF3FF] text-[#2167E8]" : "text-[#526174] hover:bg-[#F5F8FD]"} disabled:cursor-wait disabled:opacity-60`}
        aria-label="切换报表风格"
        aria-expanded={open}
        title="切换报表风格"
      >
        <Palette className="h-4 w-4" />
        <span className="max-w-[80px] truncate">{activeTheme.name}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <div ref={menuRef} style={{ left: menuPos.left, top: menuPos.top }} className="fixed z-[100] w-[240px] rounded-md border border-[#DDE5F0] bg-white p-2 shadow-[0_8px_24px_rgba(23,36,58,0.12)]">
          <div className="px-2 pb-1.5 text-[11px] font-semibold text-[#8A98AC]">报表风格</div>
          {REPORT_THEMES.map((theme) => {
            const active = current === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (theme.id === "custom") {
                    // 自定义风格需先填写描述，展开输入区
                    setCurrent("custom");
                    return;
                  }
                  void applyTheme(theme.id);
                }}
                className={`flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left transition ${active ? "bg-[#EDF3FF]" : "hover:bg-[#F5F8FF]"}`}
              >
                <span className="flex h-6 w-9 shrink-0 overflow-hidden rounded-sm border border-[#E7EDF5]" style={{ background: theme.swatches.background }}>
                  <span className="m-0.5 flex-1 rounded-[2px]" style={{ background: theme.swatches.primary }} />
                  <span className="m-0.5 ml-0 w-1.5 rounded-[2px]" style={{ background: theme.swatches.accent }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs font-bold ${active ? "text-[#2167E8]" : "text-[#344054]"}`}>{theme.name}</span>
                </span>
                {active ? <Check className="h-3.5 w-3.5 shrink-0 text-[#2167E8]" /> : null}
              </button>
            );
          })}

          {current === "custom" ? (
            <div className="mt-1.5 border-t border-[#EDF1F7] px-2 pt-2">
              <textarea
                value={customDraft}
                onChange={(event) => setCustomDraft(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="描述自定义风格，例如：国风配色，朱红主色，米白背景"
                className="w-full resize-none rounded-md border border-[#DDE5F0] bg-white px-2 py-1.5 text-xs text-[#17243A] outline-none placeholder:text-[#98A2B3] focus:border-[#2167E8]"
              />
              <button
                type="button"
                disabled={busy || !customDraft.trim()}
                onClick={() => void applyTheme("custom", customDraft.trim())}
                className="mt-1.5 h-7 w-full rounded-md bg-[#2167E8] text-xs font-semibold text-white transition hover:bg-[#1858CC] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "应用中" : customText ? "更新自定义风格" : "应用自定义风格"}
              </button>
            </div>
          ) : null}

          <p className="mt-1.5 border-t border-[#EDF1F7] px-2 pt-1.5 text-[10px] leading-4 text-[#8A98AC]">切换后下一轮 AI 对话将按新风格调整页面</p>
          {error ? <p className="px-2 pt-1 text-[10px] text-[#D92D20]">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

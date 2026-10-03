"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Globe2, XCircle } from "lucide-react";

type SettingsResponse = {
  message?: string;
  settings: { timezone: string };
  systemTimeZone: string;
  preview: { effectiveTimeZone: string; offsetLabel: string; currentTime: string };
};

const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "自动（跟随服务器时区）" },
  { value: "Asia/Shanghai", label: "北京时间（UTC+8）" },
  { value: "Asia/Urumqi", label: "乌鲁木齐时间（UTC+6）" },
  { value: "Asia/Hong_Kong", label: "香港时间（UTC+8）" },
  { value: "Asia/Tokyo", label: "东京时间（UTC+9）" },
  { value: "Asia/Singapore", label: "新加坡时间（UTC+8）" },
  { value: "Asia/Bangkok", label: "曼谷时间（UTC+7）" },
  { value: "Asia/Dubai", label: "迪拜时间（UTC+4）" },
  { value: "Europe/London", label: "伦敦时间（UTC+0）" },
  { value: "Europe/Berlin", label: "柏林时间（UTC+1）" },
  { value: "Europe/Moscow", label: "莫斯科时间（UTC+3）" },
  { value: "Australia/Sydney", label: "悉尼时间（UTC+10/+11）" },
  { value: "America/New_York", label: "纽约时间（UTC-5/-4）" },
  { value: "America/Los_Angeles", label: "洛杉矶时间（UTC-8/-7）" },
  { value: "UTC", label: "UTC 世界标准时间" },
];

export function SystemTimeZoneCard() {
  const [timezone, setTimezone] = useState("");
  const [systemTimeZone, setSystemTimeZone] = useState("");
  const [preview, setPreview] = useState<SettingsResponse["preview"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/system", { cache: "no-store" });
      const result = await response.json() as SettingsResponse;
      if (!response.ok) throw new Error(result.message || "读取系统设置失败");
      setTimezone(result.settings.timezone);
      setSystemTimeZone(result.systemTimeZone);
      setPreview(result.preview);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "读取系统设置失败");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/settings/system", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ timezone }),
      });
      const result = await response.json() as SettingsResponse;
      if (!response.ok) throw new Error(result.message || "保存失败");
      setSystemTimeZone(result.systemTimeZone);
      setPreview(result.preview);
      setMessage(result.message || "时区设置已保存");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="settings-model-card">
      <div className="settings-model-heading">
        <div className="flex items-center gap-3">
          <div className="settings-model-mark"><Globe2 className="h-5 w-5" /></div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[17px] font-bold text-[#17243A]">区域与时区</h2>
            </div>
            <p className="mt-1 text-[13px] text-[#71819B]">设置全站时间（报表更新时间、对话时间等）的展示时区</p>
          </div>
        </div>
      </div>

      <div className="settings-model-form">
        <label className="settings-model-field settings-model-field-wide">
          <span>系统时区</span>
          <select
            value={timezone}
            disabled={loading || saving}
            onChange={(event) => { setTimezone(event.target.value); setMessage(null); }}
            className="h-10 w-full rounded-md border border-[#DDE5F0] bg-white px-3 text-[13px] text-[#17243A] outline-none transition focus:border-[#8DB7F8] disabled:cursor-wait disabled:opacity-60"
          >
            {TIMEZONE_OPTIONS.map((option) => (
              <option key={option.value || "auto"} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-[#E7EDF5] bg-[#F9FBFE] px-3.5 py-3 text-[12px] text-[#526174]">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5 text-[#2167E8]" />
            {loading || !preview ? "读取当前时间中…" : `当前时间 ${preview.currentTime}（${preview.offsetLabel}）`}
          </span>
          <span className="text-[#8A98AC]">服务器时区：{systemTimeZone || "—"}</span>
        </div>

        {message ? <div className="settings-alert settings-alert-success"><CheckCircle2 className="h-4 w-4 shrink-0" />{message}</div> : null}
        {error ? <div className="settings-alert settings-alert-error"><XCircle className="h-4 w-4 shrink-0" />{error}</div> : null}

        <div className="settings-model-actions">
          <button type="button" onClick={() => void save()} disabled={loading || saving} className="settings-primary-button">
            {saving ? "保存中…" : "保存"}
          </button>
          <span>保存后立即生效；数据库仍以 UTC 存储，仅影响页面展示</span>
        </div>
      </div>
    </section>
  );
}

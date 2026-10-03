import fs from "node:fs";
import path from "node:path";

import { ensureWorkspaceStorageLayout, RUNTIME_STORAGE_ROOT } from "@/lib/server/workspace-storage";

export type SystemSettings = {
  /** IANA 时区名，如 Asia/Shanghai；空串表示跟随服务器/容器时区 */
  timezone: string;
};

const SETTINGS_FILE_PATH = path.join(RUNTIME_STORAGE_ROOT, "system-settings.json");
const DEFAULT_SETTINGS: SystemSettings = { timezone: "" };

let cachedSettings: SystemSettings | null = null;

export function isValidTimeZone(value: string) {
  if (!value) return false;
  try {
    void new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function getSystemTimeZone() {
  return getSystemSettings().timezone || detectSystemTimeZone();
}

export function detectSystemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function getSystemSettings(): SystemSettings {
  if (cachedSettings) return cachedSettings;

  ensureWorkspaceStorageLayout();
  try {
    const raw = fs.readFileSync(SETTINGS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<SystemSettings>;
    const timezone = typeof parsed.timezone === "string" ? parsed.timezone.trim() : "";
    cachedSettings = { timezone: timezone && isValidTimeZone(timezone) ? timezone : "" };
  } catch {
    cachedSettings = { ...DEFAULT_SETTINGS };
  }
  return cachedSettings;
}

export function saveSystemSettings(input: { timezone?: string }): SystemSettings {
  ensureWorkspaceStorageLayout();
  const timezone = typeof input.timezone === "string" ? input.timezone.trim() : "";
  if (timezone && !isValidTimeZone(timezone)) {
    throw new Error("不支持的时区");
  }
  const next: SystemSettings = { timezone };
  const tempPath = `${SETTINGS_FILE_PATH}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o640 });
  fs.renameSync(tempPath, SETTINGS_FILE_PATH);
  cachedSettings = next;
  return next;
}

/** 返回某 IANA 时区相对 UTC 的偏移小时数（如 Asia/Shanghai => 8），用于设置页展示 */
export function getTimeZoneOffsetHours(timeZone: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const valueOf = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUTC = Date.UTC(valueOf("year"), valueOf("month") - 1, valueOf("day"), valueOf("hour") % 24, valueOf("minute"));
  return Math.round((asUTC - Math.floor(at.getTime() / 60000) * 60000) / 3600000);
}

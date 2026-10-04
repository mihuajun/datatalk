// 客户端通用时间工具：按系统设置中的时区格式化时间。
// 数据库时间经服务端统一转成带 Z 的 ISO 字符串，这里只负责按时区展示。

let cachedTimeZone: string | null = null;
let pendingFetch: Promise<string> | null = null;

export function getCachedSystemTimeZone() {
  return cachedTimeZone;
}

export async function fetchSystemTimeZone() {
  if (cachedTimeZone) return cachedTimeZone;
  if (!pendingFetch) {
    pendingFetch = fetch("/api/system/timezone", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("timezone unavailable");
        const result = await response.json() as { timeZone?: string };
        cachedTimeZone = result.timeZone || "";
        return cachedTimeZone;
      })
      .catch(() => {
        cachedTimeZone = "";
        return "";
      });
  }
  return pendingFetch;
}

function partsInZone(date: Date, timeZone: string | undefined) {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const valueOf = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: valueOf("year"), month: valueOf("month"), day: valueOf("day"), hour: valueOf("hour") % 24, minute: valueOf("minute") };
}

function startOfDayInZone(date: Date, timeZone: string | undefined) {
  const parts = partsInZone(date, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

/** 对话时间：今天显示 HH:mm，昨天显示"昨天"，一周内显示"N天"，更早显示日期 */
export function formatConversationTime(value: string, timeZone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const dayOffset = Math.round((startOfDayInZone(now, timeZone) - startOfDayInZone(date, timeZone)) / dayMs);

  if (dayOffset === 0) {
    const parts = partsInZone(date, timeZone);
    return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  }
  if (dayOffset === 1) return "昨天";
  if (dayOffset > 1 && dayOffset < 7) return `${dayOffset}天`;

  const parts = partsInZone(date, timeZone);
  const month = String(parts.month).padStart(2, "0");
  if (parts.year === partsInZone(now, timeZone).year) return `${month}/${String(parts.day).padStart(2, "0")}`;
  return `${String(parts.year).slice(-2)}/${month}`;
}

export function formatFullTime(value: string, timeZone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timeZone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

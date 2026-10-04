/**
 * 解析数据库中存储的时间值。
 *
 * SQLite 的 CURRENT_TIMESTAMP 始终返回 UTC，格式为 "YYYY-MM-DD HH:MM:SS" 且不带时区；
 * MySQL 驱动通常直接返回 Date 实例。直接 new Date("YYYY-MM-DD HH:MM:SS") 会被
 * Node 按运行环境本地时区解析，导致 UTC 存储的时间少/多算时区偏移。
 *
 * 约定：数据库无时区后缀的时间字符串一律按 UTC 处理；已带 Z 或 ±HH:mm 的
 * ISO 字符串保持原解析；Date 实例原样返回。
 */
export function parseStoredDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const trimmed = value.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return new Date(trimmed);
  }
  if (/^\d{4}-\d{2}-\d{2}[ T][\d:.]+$/.test(trimmed)) {
    const iso = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
    return new Date(`${iso}Z`);
  }
  return new Date(trimmed);
}

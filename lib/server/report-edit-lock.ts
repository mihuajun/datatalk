import { randomUUID } from "node:crypto";

import { getDbPool } from "@/lib/server/mysql";
import { ensureOpenApiSchema } from "@/lib/server/open-api-schema";
import type { RowDataPacket } from "mysql2/promise";

import { readAppConfig, readBooleanConfigValue } from "@/lib/server/app-config";

const TTL_SECONDS = 60;
const DISABLED_LOCK_TOKEN = "edit-lock-disabled";

const key = (tenantId: number, reportCode: string) => {
  if (!Number.isSafeInteger(tenantId) || tenantId < 1 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(reportCode)) throw new Error("INVALID_REPORT_CODE");
  return `report:edit-lock:${tenantId}:${reportCode}`;
};
export type ReportEditLock = { userId: number; username: string; name: string; lockToken: string };

export function isReportEditLockEnabled() {
  const envValue = process.env.REPORT_EDIT_LOCK_ENABLED?.trim().toLowerCase();
  if (envValue === "true" || envValue === "1") return true;
  if (envValue === "false" || envValue === "0") return false;
  const parsed = readAppConfig();
  return readBooleanConfigValue(parsed?.reportEditLock?.enabled, true, "reportEditLock.enabled");
}

function disabledLock(input: { userId: number; username: string; name: string }): ReportEditLock {
  return { userId: input.userId, username: input.username, name: input.name, lockToken: DISABLED_LOCK_TOKEN };
}

export async function acquireReportEditLock(input: { tenantId: number; reportCode: string; userId: number; username: string; name: string }) {
  const lockKey = key(input.tenantId, input.reportCode);
  if (!isReportEditLockEnabled()) {
    return disabledLock(input);
  }
  const lock = { userId: input.userId, username: input.username, name: input.name, lockToken: randomUUID() };
  await ensureOpenApiSchema();
  await getDbPool().execute("DELETE FROM studio_report_edit_lock WHERE lock_key=? AND expires_at<=?", [lockKey, Date.now()]);
  try {
    await getDbPool().execute("INSERT INTO studio_report_edit_lock (lock_key,lock_token,user_id,username,name,expires_at) VALUES (?,?,?,?,?,?)", [lockKey, lock.lockToken, lock.userId, lock.username, lock.name, Date.now() + TTL_SECONDS * 1000]);
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return null;
    throw error;
  }
  return lock;
}

export async function getReportEditLock(tenantId: number, reportCode: string) {
  const lockKey = key(tenantId, reportCode);
  if (!isReportEditLockEnabled()) {
    return null;
  }
  await ensureOpenApiSchema();
  const [rows] = await getDbPool().query<Array<RowDataPacket & { lock_token: string; user_id: number; username: string; name: string }>>("SELECT lock_token,user_id,username,name FROM studio_report_edit_lock WHERE lock_key=? AND expires_at>? LIMIT 1", [lockKey, Date.now()]);
  return rows[0] ? { lockToken: rows[0].lock_token, userId: Number(rows[0].user_id), username: rows[0].username, name: rows[0].name } : null;
}

export async function renewReportEditLock(tenantId: number, reportCode: string, lockToken: string) {
  const lockKey = key(tenantId, reportCode);
  if (!isReportEditLockEnabled()) return true;
  if (!lockToken) return false;
  await ensureOpenApiSchema();
  const [result] = await getDbPool().execute("UPDATE studio_report_edit_lock SET expires_at=? WHERE lock_key=? AND lock_token=? AND expires_at>?", [Date.now() + TTL_SECONDS * 1000, lockKey, lockToken, Date.now()]);
  return Boolean((result as { affectedRows: number }).affectedRows);
}

export async function releaseReportEditLock(tenantId: number, reportCode: string, lockToken: string) {
  const lockKey = key(tenantId, reportCode);
  if (!isReportEditLockEnabled()) return true;
  if (!lockToken) return false;
  await ensureOpenApiSchema();
  const [result] = await getDbPool().execute("DELETE FROM studio_report_edit_lock WHERE lock_key=? AND lock_token=?", [lockKey, lockToken]);
  return Boolean((result as { affectedRows: number }).affectedRows);
}

export { DISABLED_LOCK_TOKEN, TTL_SECONDS };

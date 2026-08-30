import { randomUUID } from "node:crypto";

import { readAppConfig, readBooleanConfigValue } from "@/lib/server/app-config";

const TTL_SECONDS = 60;
const DISABLED_LOCK_TOKEN = "edit-lock-disabled";

const key = (tenantId: number, reportCode: string) => {
  if (!Number.isSafeInteger(tenantId) || tenantId < 1 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(reportCode)) throw new Error("INVALID_REPORT_CODE");
  return `report:edit-lock:${tenantId}:${reportCode}`;
};
export type ReportEditLock = { userId: number; username: string; name: string; lockToken: string };
type MemoryLockRecord = { lock: ReportEditLock; expiresAt: number };

const memoryLocks = new Map<string, MemoryLockRecord>();

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

function cleanupExpiredLock(lockKey: string) {
  const current = memoryLocks.get(lockKey);
  if (current && current.expiresAt <= Date.now()) memoryLocks.delete(lockKey);
}

function readMemoryLock(lockKey: string) {
  cleanupExpiredLock(lockKey);
  return memoryLocks.get(lockKey) ?? null;
}

export async function acquireReportEditLock(input: { tenantId: number; reportCode: string; userId: number; username: string; name: string }) {
  const lockKey = key(input.tenantId, input.reportCode);
  if (!isReportEditLockEnabled()) {
    return disabledLock(input);
  }
  const lock = { userId: input.userId, username: input.username, name: input.name, lockToken: randomUUID() };
  if (readMemoryLock(lockKey)) return null;
  memoryLocks.set(lockKey, { lock, expiresAt: Date.now() + TTL_SECONDS * 1000 });
  return lock;
}

export async function getReportEditLock(tenantId: number, reportCode: string) {
  const lockKey = key(tenantId, reportCode);
  if (!isReportEditLockEnabled()) {
    return null;
  }
  return readMemoryLock(lockKey)?.lock ?? null;
}

export async function renewReportEditLock(tenantId: number, reportCode: string, lockToken: string) {
  const lockKey = key(tenantId, reportCode);
  if (!isReportEditLockEnabled()) return true;
  if (!lockToken) return false;
  const current = readMemoryLock(lockKey);
  if (!current || current.lock.lockToken !== lockToken) return false;
  memoryLocks.set(lockKey, { ...current, expiresAt: Date.now() + TTL_SECONDS * 1000 });
  return true;
}

export async function releaseReportEditLock(tenantId: number, reportCode: string, lockToken: string) {
  const lockKey = key(tenantId, reportCode);
  if (!isReportEditLockEnabled()) return true;
  if (!lockToken) return false;
  const current = readMemoryLock(lockKey);
  if (!current || current.lock.lockToken !== lockToken) return false;
  memoryLocks.delete(lockKey);
  return true;
}

export { DISABLED_LOCK_TOKEN, TTL_SECONDS };

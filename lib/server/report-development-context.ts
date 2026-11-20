import { AsyncLocalStorage } from "node:async_hooks";

// Server-only, request-scoped override. Never accept a filesystem path from clients.
const storage = new AsyncLocalStorage<{ tenantId: number; reportCode: string; root: string }>();
export function withReportDevelopmentRoot<T>(tenantId: number, reportCode: string, root: string, run: () => T): T {
  return storage.run({ tenantId, reportCode, root }, run);
}
export function reportDevelopmentRoot(tenantId: number, reportCode: string) {
  const value = storage.getStore();
  return value?.tenantId === tenantId && value.reportCode === reportCode ? value.root : null;
}

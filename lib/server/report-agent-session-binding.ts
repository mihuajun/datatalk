import { randomBytes } from "node:crypto";

import { REPORT_AGENT_TOOL_SCOPES, type ReportAgentToolScope } from "@/lib/server/report-agent-tool-auth";

export const REPORT_AGENT_SESSION_BINDING_TTL_MS = 30 * 60 * 1000;

export type ReportAgentSessionBinding = {
  dshSessionId: string;
  tenantId: number;
  userId: number;
  reportCode: string;
  conversationId: string | null;
  toolToken: string;
  scopes: ReportAgentToolScope[];
  sqlPreviewSuccessCount: number;
  issuedAt: number;
  expiresAt: number;
  updatedAt: number;
};

const bindingStore = new Map<string, ReportAgentSessionBinding>();

function normalizeSessionId(value: string) {
  return value.trim();
}

function nextToolToken() {
  return randomBytes(24).toString("base64url");
}

function pruneExpiredBindings(now = Date.now()) {
  for (const [sessionId, binding] of bindingStore.entries()) {
    if (binding.expiresAt <= now) {
      bindingStore.delete(sessionId);
    }
  }
}

export function bindReportAgentSession(input: {
  dshSessionId: string;
  tenantId: number;
  userId: number;
  reportCode: string;
  conversationId?: string | null;
  scopes?: ReportAgentToolScope[];
}) {
  const dshSessionId = normalizeSessionId(input.dshSessionId);
  if (!dshSessionId) {
    throw new Error("REPORT_AGENT_SESSION_ID_REQUIRED");
  }

  const now = Date.now();
  pruneExpiredBindings(now);

  const previous = bindingStore.get(dshSessionId);
  const binding: ReportAgentSessionBinding = {
    dshSessionId,
    tenantId: input.tenantId,
    userId: input.userId,
    reportCode: input.reportCode,
    conversationId: input.conversationId ?? previous?.conversationId ?? null,
    toolToken: nextToolToken(),
    scopes: Array.from(new Set(input.scopes || [...REPORT_AGENT_TOOL_SCOPES])),
    sqlPreviewSuccessCount: previous?.sqlPreviewSuccessCount || 0,
    issuedAt: now,
    expiresAt: now + REPORT_AGENT_SESSION_BINDING_TTL_MS,
    updatedAt: now,
  };

  bindingStore.set(dshSessionId, binding);
  return binding;
}

export function resolveReportAgentSession(dshSessionId: string) {
  const normalized = normalizeSessionId(dshSessionId);
  if (!normalized) return null;
  pruneExpiredBindings();
  return bindingStore.get(normalized) || null;
}

export function markReportAgentSqlPreviewSuccess(dshSessionId: string) {
  const binding = resolveReportAgentSession(dshSessionId);
  if (!binding) throw new Error("REPORT_AGENT_TOOL_SESSION_NOT_FOUND");
  binding.sqlPreviewSuccessCount += 1;
  binding.updatedAt = Date.now();
  return binding.sqlPreviewSuccessCount;
}

export function authorizeReportAgentSessionBinding(input: {
  dshSessionId: string;
  reportCode?: string;
  scope: ReportAgentToolScope;
}) {
  const binding = resolveReportAgentSession(input.dshSessionId);
  if (!binding) throw new Error("REPORT_AGENT_TOOL_SESSION_NOT_FOUND");
  if (binding.expiresAt <= Date.now()) {
    bindingStore.delete(binding.dshSessionId);
    throw new Error("REPORT_AGENT_TOOL_TOKEN_EXPIRED");
  }
  if (input.reportCode && binding.reportCode !== input.reportCode) {
    throw new Error("REPORT_AGENT_TOOL_FORBIDDEN");
  }
  if (!binding.scopes.includes(input.scope)) {
    throw new Error("REPORT_AGENT_TOOL_FORBIDDEN");
  }
  return binding;
}

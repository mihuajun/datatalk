import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ensureWorkspaceStorageLayout, REPORT_AGENT_TOOL_SECRET_ROOT } from "@/lib/server/workspace-storage";

export const REPORT_AGENT_TOOL_SCOPES = [
  "datasource:list",
  "schema:read",
  "sql:preview",
  "metric:read",
  "metric:propose",
  "metric:feedback",
  "report:read",
  "web:search",
] as const;
export type ReportAgentToolScope = (typeof REPORT_AGENT_TOOL_SCOPES)[number];

type ReportAgentToolTokenPayload = {
  version: 1;
  tenantId: number;
  userId: number;
  reportCode: string;
  dshSessionId?: string;
  scopes: ReportAgentToolScope[];
  issuedAt: number;
  expiresAt: number;
};

const SECRET_DIR = REPORT_AGENT_TOOL_SECRET_ROOT;
const SECRET_PATH = path.join(SECRET_DIR, "secret.key");
const TOKEN_TTL_MS = 30 * 60 * 1000;

function ensureSecret() {
  const envSecret = process.env.REPORT_AGENT_TOOL_SECRET?.trim();
  if (envSecret) return envSecret;

  ensureWorkspaceStorageLayout();
  fs.mkdirSync(SECRET_DIR, { recursive: true });
  if (!fs.existsSync(SECRET_PATH)) {
    fs.writeFileSync(SECRET_PATH, randomBytes(32).toString("base64url"), { mode: 0o600 });
    fs.chmodSync(SECRET_PATH, 0o600);
  }
  return fs.readFileSync(SECRET_PATH, "utf8").trim();
}

function encodePayload(payload: ReportAgentToolTokenPayload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(value: string) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as ReportAgentToolTokenPayload;
  } catch {
    return null;
  }
}

function sign(encodedPayload: string) {
  return createHmac("sha256", ensureSecret()).update(encodedPayload).digest("base64url");
}

function normalizeScopes(scopes: ReportAgentToolScope[]) {
  return Array.from(new Set(scopes)).filter((scope): scope is ReportAgentToolScope => REPORT_AGENT_TOOL_SCOPES.includes(scope));
}

export function issueReportAgentToolToken(input: {
  tenantId: number;
  userId: number;
  reportCode: string;
  dshSessionId?: string;
  scopes?: ReportAgentToolScope[];
}) {
  const now = Date.now();
  const payload: ReportAgentToolTokenPayload = {
    version: 1,
    tenantId: input.tenantId,
    userId: input.userId,
    reportCode: input.reportCode,
    ...(input.dshSessionId ? { dshSessionId: input.dshSessionId } : {}),
    scopes: normalizeScopes(input.scopes || [...REPORT_AGENT_TOOL_SCOPES]),
    issuedAt: now,
    expiresAt: now + TOKEN_TTL_MS,
  };
  const encodedPayload = encodePayload(payload);
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyReportAgentToolToken(token: string, input: { reportCode: string; scope: ReportAgentToolScope }) {
  const normalized = token.trim();
  if (!normalized) throw new Error("REPORT_AGENT_TOOL_UNAUTHORIZED");

  const [encodedPayload, signature] = normalized.split(".");
  if (!encodedPayload || !signature) throw new Error("REPORT_AGENT_TOOL_UNAUTHORIZED");

  const expectedSignature = sign(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new Error("REPORT_AGENT_TOOL_UNAUTHORIZED");
  }

  const payload = decodePayload(encodedPayload);
  if (!payload || payload.version !== 1) throw new Error("REPORT_AGENT_TOOL_UNAUTHORIZED");
  if (payload.expiresAt <= Date.now()) throw new Error("REPORT_AGENT_TOOL_TOKEN_EXPIRED");
  if (payload.reportCode !== input.reportCode) throw new Error("REPORT_AGENT_TOOL_FORBIDDEN");
  if (!Array.isArray(payload.scopes) || !payload.scopes.includes(input.scope)) throw new Error("REPORT_AGENT_TOOL_FORBIDDEN");
  if (!Number.isInteger(payload.tenantId) || payload.tenantId < 1 || !Number.isInteger(payload.userId) || payload.userId < 1) {
    throw new Error("REPORT_AGENT_TOOL_UNAUTHORIZED");
  }

  return payload;
}

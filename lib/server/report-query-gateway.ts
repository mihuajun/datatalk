import { createHash } from "node:crypto";

import { getDataSourceCredentials, getDataSourceCredentialsByRef } from "@/lib/server/data-source-repository";
import { getReportDataSourceAdapter, type ReportQueryParams } from "@/lib/server/report-data-source-adapter";

export type ReportQueryRequest = { tenantId: number; dataSourceId?: number; dataSourceRef?: string; sql: string; params?: ReportQueryParams; timeoutMs?: number; maxRows?: number; maxBytes?: number };
export type ReportQueryResult = {
  columns: Array<{ name: string; type: string }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  fingerprint: string;
  meta: { tenantId: number; dataSourceRef: string; durationMs: number; timeoutMs: number; maxRows: number };
};

const DEFAULT_MAX_ROWS = 1000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT = 60000;
const MAX_TIMEOUT = 60000;
const dangerous = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|replace|merge|call|set|use|load|load_file|outfile|dumpfile|sleep|benchmark|get_lock|release_lock|extractvalue|updatexml)\b/i;
const QUERY_ERROR_CODES = new Set([
  "QUERY_REJECTED", "QUERY_PARAMETER_MISSING", "QUERY_PARAMETER_INVALID", "QUERY_TIMEOUT", "QUERY_RESULT_LIMIT",
  "DATA_SOURCE_NOT_FOUND", "DATA_SOURCE_NOT_SUPPORTED", "DATA_SOURCE_DATABASE_REQUIRED", "LOCAL_DATABASE_PATH_REQUIRED",
  "DATABRICKS_HTTP_PATH_REQUIRED", "DATABRICKS_TOKEN_REQUIRED", "MONGO_REQUEST_INVALID", "MONGO_COLLECTION_REQUIRED",
  "REDIS_REQUEST_INVALID", "ELASTICSEARCH_REQUEST_INVALID", "ELASTICSEARCH_INDEX_REQUIRED", "GRAPHQL_REQUEST_INVALID",
  "GRAPHQL_REQUEST_FAILED", "TRINO_QUERY_FAILED", "REST_CONFIG_INVALID", "REST_REQUEST_INVALID", "REST_REQUEST_FAILED",
  "REST_RESPONSE_INVALID", "QUERY_AUTH_FAILED", "QUERY_DATABASE_NOT_FOUND", "QUERY_PERMISSION_DENIED", "QUERY_SYNTAX_ERROR",
  "QUERY_COLUMN_NOT_FOUND", "QUERY_TABLE_NOT_FOUND", "QUERY_CONNECTION_FAILED",
]);

function errorMessages(error: unknown) {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (current instanceof Error) {
      if (current.name && current.name !== "Error") messages.push(current.name);
      if (current.message) messages.push(current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === "object") {
      const candidate = current as { name?: unknown; message?: unknown; cause?: unknown };
      if (typeof candidate.name === "string" && candidate.name) messages.push(candidate.name);
      if (typeof candidate.message === "string" && candidate.message) messages.push(candidate.message);
      current = candidate.cause;
      continue;
    }
    if (typeof current === "string") messages.push(current);
    break;
  }
  return messages;
}

function errorProperties(error: unknown) {
  const properties: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (!current || typeof current !== "object") break;
    const candidate = current as { code?: unknown; errno?: unknown; sqlState?: unknown; cause?: unknown };
    for (const key of ["code", "errno", "sqlState"] as const) {
      if (candidate[key] !== undefined && candidate[key] !== null) properties.push(String(candidate[key]));
    }
    current = candidate.cause;
  }
  return properties;
}

function queryErrorCode(message: string) {
  for (const code of QUERY_ERROR_CODES) {
    if (message === code || message.startsWith(`${code}:`)) return code;
  }
  return "";
}

function safeQueryDiagnostic(messages: string[], properties: string[]) {
  const text = messages.join(" ").replace(/\s+/g, " ").trim();
  const propertyText = properties.join(" ");
  const combined = `${propertyText} ${text}`;
  if (messages.some((message) => queryErrorCode(message) === "QUERY_TIMEOUT") || /AbortError|TimeoutError|timed? ?out|timeout/i.test(combined)) {
    return "QUERY_TIMEOUT";
  }

  const knownCode = messages.map(queryErrorCode).find(Boolean);
  if (knownCode) return knownCode;

  if (/28P01|28000|ER_ACCESS_DENIED_ERROR|access denied|authentication failed|password authentication failed|login failed/i.test(combined)) {
    return "QUERY_AUTH_FAILED";
  }
  if (/42501|ER_TABLEACCESS_DENIED_ERROR|permission denied|not authorized/i.test(combined)) {
    return "QUERY_PERMISSION_DENIED";
  }
  if (/3D000|ER_BAD_DB_ERROR|database [^\n]{0,120} does not exist/i.test(combined)) {
    return "QUERY_DATABASE_NOT_FOUND";
  }

  const missingColumn = text.match(/(?:column|field|no such column)\s+["'`]?([^"'`\s]+)["'`]?\s+(?:does not exist|not found)|no such column:\s*["'`]?([^"'`\s]+)["'`]?/i);
  if (/42703|ER_BAD_FIELD_ERROR|unknown column|no such column/i.test(combined)) {
    return missingColumn ? `QUERY_COLUMN_NOT_FOUND: ${missingColumn[1] || missingColumn[2]}` : "QUERY_COLUMN_NOT_FOUND";
  }

  const missingTable = text.match(/(?:relation|table|view)\s+["'`]?([^"'`\s]+)["'`]?\s+(?:does not exist|not found)|no such table:\s*["'`]?([^"'`\s]+)["'`]?/i);
  if (/42P01|ER_NO_SUCH_TABLE|table .*doesn't exist|relation .*does not exist|no such table/i.test(combined)) {
    return missingTable ? `QUERY_TABLE_NOT_FOUND: ${missingTable[1] || missingTable[2]}` : "QUERY_TABLE_NOT_FOUND";
  }
  if (/42601|ER_PARSE_ERROR|syntax error|You have an error in your SQL syntax/i.test(combined)) {
    return "QUERY_SYNTAX_ERROR";
  }
  if (/ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ENETDOWN|EAI_AGAIN|ENOTFOUND|fetch failed|network error|connection .*failed|connect .*failed/i.test(combined)) {
    return "QUERY_CONNECTION_FAILED";
  }
  return "QUERY_EXECUTION_FAILED";
}

export function normalizeReportQueryError(error: unknown) {
  return safeQueryDiagnostic(errorMessages(error), errorProperties(error));
}

export function validateReadOnlySql(sql: string) {
  const normalized = sql.trim().replace(/;\s*$/, "");
  if (!normalized || normalized.includes(";") || dangerous.test(normalized) || !/^(select|with)\b/i.test(normalized)) throw new Error("QUERY_REJECTED");
  if (/\bwith\b[\s\S]*\b(insert|update|delete)\b/i.test(normalized)) throw new Error("QUERY_REJECTED");
  return normalized;
}

export async function executeReportQuery(request: ReportQueryRequest): Promise<ReportQueryResult> {
  const startedAt = Date.now();
  const sourceRef = request.dataSourceRef || (request.dataSourceId == null ? "" : String(request.dataSourceId));
  const maxRows = Math.min(Math.max(request.maxRows || DEFAULT_MAX_ROWS, 1), DEFAULT_MAX_ROWS);
  const maxBytes = Math.min(Math.max(request.maxBytes || DEFAULT_MAX_BYTES, 1024), DEFAULT_MAX_BYTES);
  const timeoutMs = Math.min(Math.max(request.timeoutMs || DEFAULT_TIMEOUT, 100), MAX_TIMEOUT);

  const source = request.dataSourceId != null
    ? await getDataSourceCredentials(request.tenantId, request.dataSourceId)
    : await getDataSourceCredentialsByRef(request.tenantId, sourceRef);
  if (!source) throw new Error("DATA_SOURCE_NOT_FOUND");
  const adapter = getReportDataSourceAdapter(source.type);
  const sql = adapter.prepareRequest ? adapter.prepareRequest(request.sql) : validateReadOnlySql(request.sql);
  try {
    const rows = await adapter.query(source, sql, request.params || {}, timeoutMs);
    const resultRows = rows.slice(0, maxRows);
    const encoded = JSON.stringify(resultRows);
    if (Buffer.byteLength(encoded) > maxBytes || (rows as unknown[]).length > maxRows) throw new Error("QUERY_RESULT_LIMIT");
    const columns = resultRows.length
      ? Object.entries(resultRows[0]).map(([name, value]) => ({ name, type: value === null ? "null" : typeof value }))
      : [];
    return {
      columns,
      rows: resultRows,
      rowCount: resultRows.length,
      fingerprint: createHash("sha256").update(sql.replace(/'[^']*'/g, "?")).digest("hex"),
      meta: { tenantId: request.tenantId, dataSourceRef: sourceRef, durationMs: Date.now() - startedAt, timeoutMs, maxRows },
    };
  } catch (error) {
    const normalizedMessage = normalizeReportQueryError(error);
    if (error instanceof Error && error.message === normalizedMessage) throw error;
    throw new Error(normalizedMessage, { cause: error });
  }
}

import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";

import { getDbPool } from "@/lib/server/mysql";
import { getDataSourceCredentialsByRef, listDataSources } from "@/lib/server/data-source-repository";
import { getReportDataSourceAdapter } from "@/lib/server/report-data-source-adapter";
import { executeReportQuery } from "@/lib/server/report-query-gateway";
import { isAllowedReportSourceFile } from "@/lib/server/report-workspace";
import { readReportWorkspaceFile } from "@/lib/server/report-schema";

type PreviewParamValue = string | number | boolean | null | Array<string | number>;

const DEFAULT_SCHEMA_LIMIT = 20;
const MAX_SCHEMA_LIMIT = 50;
const DEFAULT_PREVIEW_ROWS = 20;
const REPORT_QUERY_TIMEOUT_MS = 60000;
const DEFAULT_REFERENCE_LIMIT = 20;
const MAX_REFERENCE_LIMIT = 50;
const MAX_REFERENCE_FILES = 8;
const MAX_REFERENCE_FILE_BYTES = 512 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 2 * 1024 * 1024;
const DEFAULT_REFERENCE_FILES = ["report.json", "description.md", "page.html", "styles.css", "app.js", "server.js"];

export const REPORT_AGENT_TOOL_SCRIPT_PATH = path.join(process.cwd(), "scripts", "report-agent-tools.cjs");

function clampInteger(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTableList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((item) => {
    const tableName = trimText(item);
    return tableName ? [tableName] : [];
  }))).slice(0, MAX_SCHEMA_LIMIT);
}

function normalizeReferenceFiles(value: unknown) {
  const requested = Array.isArray(value)
    ? value.flatMap((item) => {
        const fileName = trimText(item).replaceAll("\\", "/");
        return fileName ? [fileName] : [];
      })
    : [];
  const files = requested.length ? Array.from(new Set(requested)) : DEFAULT_REFERENCE_FILES;
  if (files.length > MAX_REFERENCE_FILES) throw new Error("REPORT_AGENT_REFERENCE_FILE_LIMIT");
  if (files.some((fileName) => !isAllowedReportSourceFile(fileName))) {
    throw new Error("REPORT_AGENT_REFERENCE_FILE_INVALID");
  }
  return files;
}

function toPreviewParamValue(value: unknown): PreviewParamValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number")) {
    return value;
  }
  throw new Error("REPORT_AGENT_TOOL_INVALID_PARAMS");
}

function normalizePreviewParams(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPreviewParamValue(item)]));
}

async function getReportSourceOrThrow(tenantId: number, dataSourceRef: string) {
  const source = await getDataSourceCredentialsByRef(tenantId, dataSourceRef);
  if (!source) throw new Error("DATA_SOURCE_NOT_FOUND");
  return source;
}

export async function listReportAgentDataSources(tenantId: number) {
  const sources = await listDataSources(tenantId);
  return sources.map((item) => ({
    name: item.name,
    type: item.type,
    database: item.database,
    status: item.status,
    updatedAt: item.updatedAt,
  }));
}

export async function getReportAgentDataSourceSchema(input: {
  tenantId: number;
  dataSourceRef: string;
  keyword?: string;
  tables?: unknown;
  limit?: number;
}) {
  const dataSourceRef = trimText(input.dataSourceRef);
  if (!dataSourceRef) throw new Error("DATA_SOURCE_REF_REQUIRED");

  const source = await getReportSourceOrThrow(input.tenantId, dataSourceRef);
  const keyword = trimText(input.keyword);
  const tables = normalizeTableList(input.tables);
  const limit = clampInteger(input.limit, DEFAULT_SCHEMA_LIMIT, MAX_SCHEMA_LIMIT);
  const schemaTables = await getReportDataSourceAdapter(source.type).schema(source, { keyword, tables, limit }, REPORT_QUERY_TIMEOUT_MS);

  return {
    dataSource: {
      name: source.name,
      type: source.type,
      database: source.database,
    },
    filters: {
      keyword,
      tables,
      limit,
    },
    tables: schemaTables,
  };
}

export async function previewReportAgentSql(input: {
  tenantId: number;
  dataSourceRef: string;
  sql: string;
  params?: unknown;
  maxRows?: number;
}) {
  const dataSourceRef = trimText(input.dataSourceRef);
  const sql = trimText(input.sql);
  if (!dataSourceRef) throw new Error("DATA_SOURCE_REF_REQUIRED");
  if (!sql) throw new Error("REPORT_AGENT_TOOL_SQL_REQUIRED");

  const maxRows = clampInteger(input.maxRows, DEFAULT_PREVIEW_ROWS, DEFAULT_PREVIEW_ROWS);
  const result = await executeReportQuery({
    tenantId: input.tenantId,
    dataSourceRef,
    sql,
    params: normalizePreviewParams(input.params),
    maxRows,
    maxBytes: 256 * 1024,
    timeoutMs: REPORT_QUERY_TIMEOUT_MS,
  });

  return {
    ok: true,
    columns: result.columns,
    sampleRows: result.rows,
    rowCount: result.rowCount,
    meta: result.meta,
  };
}

type ReferenceReportRow = RowDataPacket & {
  id: number;
  code: string;
  name: string;
  status: string;
  updated_at: string | Date;
};

function normalizeReferenceReport(row: ReferenceReportRow, currentReportCode?: string) {
  const updatedAt = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
  return {
    code: row.code,
    name: row.name,
    status: row.status,
    updatedAt: Number.isNaN(updatedAt.getTime()) ? String(row.updated_at) : updatedAt.toISOString(),
    isCurrent: row.code === currentReportCode,
  };
}

export async function listReportAgentReferenceReports(input: {
  tenantId: number;
  currentReportCode?: string;
  keyword?: string;
  limit?: number;
}) {
  const keyword = trimText(input.keyword);
  const limit = clampInteger(input.limit, DEFAULT_REFERENCE_LIMIT, MAX_REFERENCE_LIMIT);
  const conditions = ["tenant_id = ?", "deleted_at IS NULL"];
  const params: Array<string | number> = [input.tenantId];
  if (keyword) {
    const pattern = `%${keyword}%`;
    // Report codes are ASCII. Comparing an ASCII column with a Chinese
    // literal makes MySQL mix ascii_bin and utf8mb4 collations.
    if (/^[\x00-\x7F]*$/.test(keyword)) {
      conditions.push("(code LIKE ? OR name LIKE ?)");
      params.push(pattern, pattern);
    } else {
      conditions.push("name LIKE ?");
      params.push(pattern);
    }
  }

  const [rows] = await getDbPool().query<ReferenceReportRow[]>(
    `SELECT id, code, name, status, updated_at
       FROM tenant_report
      WHERE ${conditions.join(" AND ")}
      ORDER BY updated_at DESC, id DESC
      LIMIT ${limit}`,
    params,
  );

  return {
    keyword,
    limit,
    items: rows.map((row) => normalizeReferenceReport(row, input.currentReportCode)),
  };
}

export async function readReportAgentReferenceReport(input: {
  tenantId: number;
  reportCode: string;
  files?: unknown;
}) {
  const reportCode = trimText(input.reportCode);
  if (!reportCode) throw new Error("REPORT_AGENT_REFERENCE_REPORT_REQUIRED");

  const [reportRows] = await getDbPool().query<ReferenceReportRow[]>(
    `SELECT id, code, name, status, updated_at
       FROM tenant_report
      WHERE tenant_id = ? AND code = ? AND deleted_at IS NULL
      LIMIT 1`,
    [input.tenantId, reportCode],
  );
  const referenceReport = reportRows[0];
  if (!referenceReport) throw new Error("REPORT_AGENT_REFERENCE_NOT_FOUND");

  const requestedFiles = normalizeReferenceFiles(input.files);
  const files: Record<string, string> = {};
  const missingFiles: string[] = [];
  let totalBytes = 0;

  for (const fileName of requestedFiles) {
    let content: string;
    try {
      content = await readReportWorkspaceFile(input.tenantId, reportCode, fileName);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
        missingFiles.push(fileName);
        continue;
      }
      throw error;
    }

    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_REFERENCE_FILE_BYTES || totalBytes + bytes > MAX_REFERENCE_TOTAL_BYTES) {
      throw new Error("REPORT_AGENT_REFERENCE_CONTENT_TOO_LARGE");
    }
    totalBytes += bytes;
    files[fileName] = content;
  }

  return {
    report: normalizeReferenceReport(referenceReport),
    requestedFiles,
    files,
    missingFiles,
    totalBytes,
  };
}

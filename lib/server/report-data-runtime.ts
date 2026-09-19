import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import ts from "typescript";
import * as XLSX from "xlsx";
import type { RowDataPacket } from "mysql2/promise";

import { getDbPool } from "@/lib/server/mysql";
import type { ReportFilterManifest } from "@/lib/report-filters";
import { hashPublicLinkPassword, hasPublicLinkAccess } from "@/lib/server/public-link-security";
import { readReportFilterManifest } from "@/lib/server/report-filter-runtime";
import { executeReportQuery } from "@/lib/server/report-query-gateway";
import { isAllowedReportDataFile, resolveReportSourcePath } from "@/lib/server/report-workspace";
import { getPublishedResourceReportTarget } from "@/lib/server/resource-repository";

type RuntimeSource = "working" | "release";
type RuntimeFilters = Record<string, unknown>;
type QueryParamValue = string | number | boolean | null | Array<string | number>;

type RuntimeQueryOptions = {
  timeoutMs?: number;
  maxRows?: number;
  maxBytes?: number;
};

type RuntimeContext = {
  tenantId: number;
  reportCode: string;
  dataId: string;
  filters: RuntimeFilters;
  source: RuntimeSource;
  query: (dataSource: string, sql: string, params?: Record<string, QueryParamValue>, options?: RuntimeQueryOptions) => Promise<Record<string, unknown>[]>;
};

type RuntimeHandler =
  | ((context: RuntimeContext) => unknown | Promise<unknown>)
  | {
      resolve: (context: RuntimeContext) => unknown | Promise<unknown>;
    };

type RuntimeModule = {
  handlers: Record<string, RuntimeHandler>;
};

const REPORT_DATA_RUNTIME_EXTENSIONS = new Set([".json", ".csv", ".tsv", ".xlsx", ".xls"]);

type ReportRuntimeTarget = {
  tenantId: number;
  reportCode: string;
  releaseVersion: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFilters(value: unknown, manifest?: ReportFilterManifest | null): RuntimeFilters {
  const input = isRecord(value) ? value : {};
  if (!manifest) return input;

  const result: RuntimeFilters = {};
  for (const filter of manifest.filters) {
    if (Object.prototype.hasOwnProperty.call(input, filter.key)) {
      result[filter.key] = input[filter.key];
      continue;
    }
    if (filter.urlKey !== filter.key && Object.prototype.hasOwnProperty.call(input, filter.urlKey)) {
      result[filter.key] = input[filter.urlKey];
      continue;
    }
    result[filter.key] = filter.defaultValue;
  }
  return result;
}

function toQueryParamValue(value: unknown): QueryParamValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number")) {
    return value;
  }
  throw new Error("REPORT_DATA_FILTER_INVALID");
}

function normalizeQueryParams(value: Record<string, unknown> | undefined) {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toQueryParamValue(item)]));
}

function getRuntimeEntry(handler: RuntimeHandler) {
  if (typeof handler === "function") {
    return { resolve: handler };
  }
  if (isRecord(handler) && typeof handler.resolve === "function") {
    return {
      resolve: handler.resolve as (context: RuntimeContext) => unknown | Promise<unknown>,
    };
  }
  throw new Error("REPORT_DATA_HANDLER_INVALID");
}

function resolveReportDataImportPath(tenantId: number, reportCode: string, specifier: string, releaseVersion?: number | null) {
  if (typeof specifier !== "string") throw new Error(`REPORT_SERVER_IMPORT_NOT_ALLOWED: ${String(specifier)}`);
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  if (!normalizedSpecifier.startsWith("./")) throw new Error(`REPORT_SERVER_IMPORT_NOT_ALLOWED: ${specifier}`);
  const fileName = path.posix.normalize(normalizedSpecifier.slice(2));
  if (!isAllowedReportDataFile(fileName) || !REPORT_DATA_RUNTIME_EXTENSIONS.has(path.posix.extname(fileName).toLowerCase())) {
    throw new Error(`REPORT_SERVER_IMPORT_NOT_ALLOWED: ${specifier}`);
  }
  return resolveReportSourcePath(tenantId, reportCode, fileName, releaseVersion ?? undefined);
}

function readReportTabularFile(filePath: string) {
  const workbook = XLSX.read(fsSync.readFileSync(filePath), {
    type: "buffer",
    cellDates: true,
  });
  return {
    sheets: workbook.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], {
        defval: null,
        raw: true,
      }),
    })),
  };
}

function readReportDataFile(tenantId: number, reportCode: string, specifier: string, releaseVersion?: number | null) {
  const filePath = resolveReportDataImportPath(tenantId, reportCode, specifier, releaseVersion);
  const extension = path.extname(filePath).toLowerCase();
  try {
    if (extension === ".json") return JSON.parse(fsSync.readFileSync(filePath, "utf8")) as unknown;
    if ([".csv", ".tsv", ".xlsx", ".xls"].includes(extension)) return readReportTabularFile(filePath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    if (code === "ENOENT") throw new Error(`REPORT_DATA_FILE_NOT_FOUND: ${specifier}`);
    if (extension === ".json" && error instanceof SyntaxError) throw new Error(`REPORT_DATA_JSON_INVALID: ${specifier}`);
    throw new Error(`REPORT_DATA_FILE_READ_FAILED: ${specifier}`);
  }
  throw new Error(`REPORT_DATA_FILE_UNSUPPORTED: ${specifier}`);
}

async function resolveRuntimeModulePath(tenantId: number, reportCode: string, source: RuntimeSource, releaseVersion?: number | null) {
  const version = source === "release" ? releaseVersion : undefined;
  const candidates = ["server.js", "server.ts"];
  for (const fileName of candidates) {
    const filePath = resolveReportSourcePath(tenantId, reportCode, fileName, version ?? undefined);
    try {
      await fs.access(filePath);
      return { fileName, filePath };
    } catch {
      // Try next runtime filename.
    }
  }
  throw new Error("REPORT_SERVER_NOT_FOUND");
}

async function readRuntimeModule(tenantId: number, reportCode: string, source: RuntimeSource, releaseVersion?: number | null) {
  const version = source === "release" ? releaseVersion : undefined;
  if (source === "release" && !version) throw new Error("REPORT_RELEASE_NOT_FOUND");
  const { fileName, filePath } = await resolveRuntimeModulePath(tenantId, reportCode, source, releaseVersion);
  const sourceText = await fs.readFile(filePath, "utf8");
  const transpileSource = fileName.endsWith(".ts");
  const result = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
    fileName: filePath,
  });
  if (transpileSource) {
    const diagnostics = (result.diagnostics || [])
      .filter((item) => item.category === ts.DiagnosticCategory.Error)
      .map((item) => ts.flattenDiagnosticMessageText(item.messageText, " "));
    if (diagnostics.length) {
      throw new Error(`REPORT_SERVER_COMPILE_FAILED: ${diagnostics.join("；")}`);
    }
  }
  const module = { exports: {} as Record<string, unknown> };
  const require = (specifier: string) => readReportDataFile(tenantId, reportCode, specifier, version);
  const executable = transpileSource ? result.outputText : sourceText;
  const run = new Function("exports", "module", "require", `${executable}\n//# sourceURL=${filePath.replaceAll("\\", "/")}`);
  run(module.exports, module, require);
  const exported = module.exports as Record<string, unknown>;
  const handlers = exported.handlers;
  if (!isRecord(handlers)) throw new Error("REPORT_SERVER_HANDLERS_MISSING");
  return {
    handlers: handlers as Record<string, RuntimeHandler>,
  } satisfies RuntimeModule;
}

export async function validateWorkingReportRuntime(tenantId: number, reportCode: string) {
  const runtimeModule = await readRuntimeModule(tenantId, reportCode, "working");
  const handlerIds = Object.keys(runtimeModule.handlers);
  for (const handlerId of handlerIds) {
    getRuntimeEntry(runtimeModule.handlers[handlerId]);
  }
  return { handlerIds };
}

export async function getTenantReportRuntimeTarget(tenantId: number, reportCode: string): Promise<ReportRuntimeTarget | null> {
  const [rows] = await getDbPool().query<Array<RowDataPacket & { current_release_version: number | null }>>(
    "SELECT current_release_version FROM tenant_report WHERE tenant_id=? AND code=? AND deleted_at IS NULL LIMIT 1",
    [tenantId, reportCode],
  );
  if (!rows[0]) return null;
  return {
    tenantId,
    reportCode,
    releaseVersion: rows[0].current_release_version == null ? null : Number(rows[0].current_release_version),
  };
}

export async function getPublicReportRuntimeTarget(publicLinkCode: string): Promise<ReportRuntimeTarget | null> {
  const [rows] = await getDbPool().query<Array<RowDataPacket & {
    tenant_id: number;
    code: string;
    current_release_version: number;
    public_link_id: number;
    password_enabled: number;
    password: string | null;
  }>>(
    `SELECT r.tenant_id, r.code, r.current_release_version,
            l.id AS public_link_id, l.password_enabled, l.password
       FROM report_public_link l
       INNER JOIN tenant_report r ON r.tenant_id = l.tenant_id AND r.code = l.report_code
      WHERE l.short_code = ?
        AND l.enabled = 1
        AND l.revoked_at IS NULL
        AND (l.expires_at IS NULL OR l.expires_at > CURRENT_TIMESTAMP)
        AND r.deleted_at IS NULL
        AND r.public_link_enabled = 1
        AND r.current_release_version IS NOT NULL
      LIMIT 1`,
    [publicLinkCode],
  );
  if (!rows[0]) return null;
  const link = rows[0];
  if (Number(link.password_enabled) === 1 && link.password && !(await hasPublicLinkAccess(publicLinkCode, {
    linkId: Number(link.public_link_id),
    passwordHash: hashPublicLinkPassword(link.password),
  }))) return null;
  return {
    tenantId: Number(link.tenant_id),
    reportCode: link.code,
    releaseVersion: Number(link.current_release_version),
  };
}

export async function getPublishedResourceRuntimeTarget(reportCode: string): Promise<ReportRuntimeTarget | null> {
  const target = await getPublishedResourceReportTarget(reportCode);
  if (!target) return null;
  return {
    tenantId: target.tenantId,
    reportCode: target.reportCode,
    releaseVersion: target.version,
  };
}

export async function executeReportDataRequest(input: {
  tenantId: number;
  reportCode: string;
  source: RuntimeSource;
  releaseVersion?: number | null;
  dataId: string;
  filters?: unknown;
}) {
  const runtimeModule = await readRuntimeModule(input.tenantId, input.reportCode, input.source, input.releaseVersion);
  const handler = runtimeModule.handlers[input.dataId];
  if (!handler) throw new Error("REPORT_DATA_HANDLER_NOT_FOUND");
  const entry = getRuntimeEntry(handler);
  const filterManifest = await readReportFilterManifest(input.tenantId, input.reportCode, input.source, input.releaseVersion);
  const filters = normalizeFilters(input.filters, filterManifest);
  const context: RuntimeContext = {
    tenantId: input.tenantId,
    reportCode: input.reportCode,
    dataId: input.dataId,
    filters,
    source: input.source,
    query: async (dataSource, sql, params, options) => {
      const normalizedDataSource = typeof dataSource === "string" ? dataSource.trim() : "";
      if (!normalizedDataSource) throw new Error("REPORT_DATA_SOURCE_REQUIRED");
      const result = await executeReportQuery({
        tenantId: input.tenantId,
        dataSourceRef: normalizedDataSource,
        sql,
        params: normalizeQueryParams(params),
        timeoutMs: options?.timeoutMs,
        maxRows: options?.maxRows,
        maxBytes: options?.maxBytes,
      });
      return result.rows;
    },
  };
  return await entry.resolve(context);
}

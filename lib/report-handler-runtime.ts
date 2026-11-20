/** Shared handler contract used by cloud and the standalone local runtime. No I/O or credentials. */
import type { ReportFilterManifest } from "@/lib/report-filters";
type RuntimeSource = "working" | "release";
type RuntimeFilters = Record<string, unknown>;
type QueryParamValue = string | number | boolean | null | Array<string | number>;

type RuntimeQueryOptions = {
  timeoutMs?: number;
  maxRows?: number;
  maxBytes?: number;
};

export type RuntimeContext = {
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

export type RuntimeModule = {
  handlers: Record<string, RuntimeHandler>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeFilters(value: unknown, manifest?: ReportFilterManifest | null): RuntimeFilters {
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

export function normalizeQueryParams(value: Record<string, unknown> | undefined) {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toQueryParamValue(item)]));
}

export function getRuntimeEntry(handler: RuntimeHandler) {
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


export function evaluateRuntimeModule(source: string, requireData: (specifier: string) => unknown, sourceName = "server.js"): RuntimeModule {
  const module = { exports: {} as Record<string, unknown> };
  const run = new Function("exports", "module", "require", source + "\n//# sourceURL=" + sourceName.replace(/[\r\n]/g, ""));
  run(module.exports, module, requireData);
  const handlers = module.exports.handlers;
  if (!isRecord(handlers)) throw new Error("REPORT_SERVER_HANDLERS_MISSING");
  return { handlers: handlers as RuntimeModule["handlers"] };
}

export type ReportFilterType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "dateRange"
  | "select"
  | "multiSelect";

export type ReportFilterValue = string | number | boolean | null | Array<string | number>;

export type ReportFilterOption = {
  value: string | number;
  label?: string;
};

export type ReportFilterDefinition = {
  key: string;
  urlKey: string;
  label: string;
  type: ReportFilterType;
  defaultValue: ReportFilterValue;
  visible: boolean;
  options?: ReportFilterOption[];
};

export type ReportFilterManifest = {
  schemaVersion: "1.0";
  filters: ReportFilterDefinition[];
};

export type ReportFilterResolution = {
  values: Record<string, ReportFilterValue>;
  urlValues: Record<string, ReportFilterValue>;
  defaults: Record<string, ReportFilterValue>;
  suppliedKeys: string[];
  warnings: string[];
};

export type ReportPageSearchParams = Record<string, string | string[] | undefined>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeKey(value: unknown, fallback: string) {
  const candidate = text(value, fallback).replace(/[^A-Za-z0-9_-]/g, "-");
  return candidate || fallback;
}

function normalizeType(value: unknown): ReportFilterType {
  if (value === "number" || value === "boolean" || value === "date" || value === "dateRange" || value === "multiSelect") return value;
  return value === "text" ? "text" : "select";
}

function normalizeValue(value: unknown): ReportFilterValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number")) return value;
  return "";
}

function normalizeOptions(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const options = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const optionValue = item.value;
    if (typeof optionValue !== "string" && typeof optionValue !== "number") return [];
    return [{ value: optionValue, label: text(item.label) } satisfies ReportFilterOption];
  });
  return options.length ? options : undefined;
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function normalizeReportFilterManifest(value: unknown, fallback?: unknown): ReportFilterManifest | null {
  const source = isRecord(value) && Array.isArray(value.filters)
    ? value
    : isRecord(fallback) && Array.isArray(fallback.filters)
      ? fallback
      : Array.isArray(fallback)
        ? { filters: fallback }
        : null;
  if (!source || !Array.isArray(source.filters)) return null;

  const seenKeys = new Set<string>();
  const filters = source.filters.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const key = normalizeKey(item.key, `filter-${index + 1}`);
    if (seenKeys.has(key)) return [];
    seenKeys.add(key);
    const type = normalizeType(item.type);
    const display = isRecord(item.display) ? item.display : null;
    const fallbackValue = item.defaultValue ?? item.value ?? "";
    return [{
      key,
      urlKey: normalizeKey(item.urlKey, key),
      label: text(item.label ?? item.name, key),
      type,
      defaultValue: normalizeValue(fallbackValue),
      visible: display?.visible === false || item.visible === false ? false : true,
      options: normalizeOptions(item.options),
    } satisfies ReportFilterDefinition];
  });

  return { schemaVersion: "1.0", filters };
}

export function reportFilterManifestFromDefinition(value: unknown): ReportFilterManifest | null {
  if (!isRecord(value) || !Array.isArray(value.filters)) return null;
  return normalizeReportFilterManifest(null, value.filters.map((item, index) => {
    if (!isRecord(item)) return item;
    return {
      key: item.key ?? `filter-${index + 1}`,
      urlKey: item.urlKey ?? item.key ?? `filter-${index + 1}`,
      label: item.label,
      type: item.type ?? "select",
      defaultValue: item.defaultValue ?? item.value ?? "",
      visible: item.visible !== false,
      options: item.options,
    };
  }));
}

function rawValues(searchParams: URLSearchParams, filter: ReportFilterDefinition) {
  const values = searchParams.getAll(filter.urlKey);
  return values.length ? values : searchParams.getAll(filter.key);
}

function resolveValue(raw: string[], filter: ReportFilterDefinition): ReportFilterValue | undefined {
  if (!raw.length) return undefined;
  if (filter.type === "multiSelect") {
    const values = raw.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
    return values.length ? values : undefined;
  }
  const value = raw[0]?.trim();
  if (!value) return undefined;
  if (filter.type === "number") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }
  if (filter.type === "date") return isValidIsoDate(value) ? value : undefined;
  if (filter.type === "boolean") {
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    return undefined;
  }
  // Display options can be incomplete for dynamic filters, so declared URL values remain valid.
  return value;
}

export function resolveReportFilterValues(manifest: ReportFilterManifest | null, searchParams: URLSearchParams): ReportFilterResolution {
  const values: Record<string, ReportFilterValue> = {};
  const urlValues: Record<string, ReportFilterValue> = {};
  const defaults: Record<string, ReportFilterValue> = {};
  const suppliedKeys: string[] = [];
  const warnings: string[] = [];
  if (!manifest) return { values, urlValues, defaults, suppliedKeys, warnings };

  for (const filter of manifest.filters) {
    const raw = rawValues(searchParams, filter);
    const resolved = resolveValue(raw, filter);
    defaults[filter.key] = filter.defaultValue;
    values[filter.key] = resolved === undefined ? filter.defaultValue : resolved;
    if (!raw.length) continue;
    suppliedKeys.push(filter.key);
    if (resolved === undefined) {
      warnings.push(`Invalid value for filter: ${filter.key}`);
      continue;
    }
    urlValues[filter.key] = resolved;
  }
  return { values, urlValues, defaults, suppliedKeys, warnings };
}

export function toReportSearchParams(value: ReportPageSearchParams | undefined) {
  const searchParams = new URLSearchParams();
  if (!value) return searchParams;
  for (const [key, rawValue] of Object.entries(value)) {
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) searchParams.append(key, item);
    } else if (typeof rawValue === "string") {
      searchParams.set(key, rawValue);
    }
  }
  return searchParams;
}

export function reportFilterValuesToSearchParams(manifest: ReportFilterManifest | null, values: Record<string, ReportFilterValue>) {
  const searchParams = new URLSearchParams();
  if (!manifest) return searchParams;

  for (const filter of manifest.filters) {
    const value = values[filter.key];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) searchParams.append(filter.urlKey, String(item));
      continue;
    }
    searchParams.set(filter.urlKey, String(value));
  }
  return searchParams;
}

export function reportFilterManifestToJson(manifest: ReportFilterManifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

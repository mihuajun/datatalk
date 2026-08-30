import fs from "node:fs/promises";

import {
  normalizeReportFilterManifest,
  type ReportFilterManifest,
} from "@/lib/report-filters";
import { resolveReportSourcePath } from "@/lib/server/report-workspace";

type RuntimeSource = "working" | "release";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function readReportFilterManifest(
  tenantId: number,
  reportCode: string,
  source: RuntimeSource,
  releaseVersion?: number | null,
  fallback?: unknown,
): Promise<ReportFilterManifest | null> {
  const version = source === "release" ? releaseVersion : undefined;
  if (source === "release" && !version) return normalizeReportFilterManifest(null, fallback);

  try {
    const filePath = resolveReportSourcePath(tenantId, reportCode, "report.json", version ?? undefined);
    const document = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    const declaredFilters = isRecord(document) ? document.filters : null;
    return normalizeReportFilterManifest(
      Array.isArray(declaredFilters) ? { filters: declaredFilters } : null,
      fallback,
    );
  } catch {
    return normalizeReportFilterManifest(null, fallback);
  }
}

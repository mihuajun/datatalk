import fs from "node:fs/promises";
import path from "node:path";

import {
  toReportDocument,
} from "@/lib/report-types";
import { ensureWorkspaceStorageLayout, REPORT_WORKSPACE_ROOT } from "@/lib/server/workspace-storage";

const REPORT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/;
const TENANT_ID_PATTERN = /^[1-9][0-9]*$/;
const ROOT_FILES = ["report.json", "description.md", "page.html", "styles.css", "app.js", "server.js", "theme.json", "interactions.json"] as const;
const BLANK_TEMPLATE_WORKING_PATH = path.resolve(process.cwd(), "templates", "_blank", "working");

export const REPORT_SOURCE_FILES = new Set<string>(ROOT_FILES);

export function isAllowedReportSourceFile(fileName: string) {
  const normalized = fileName.replaceAll("\\", "/");
  return !normalized.startsWith("/")
    && !normalized.split("/").some((part) => part === "..")
    && (REPORT_SOURCE_FILES.has(normalized) || /^(components|assets)\/[A-Za-z0-9][A-Za-z0-9_.-]*\.(html|css|js|json|svg|txt)$/.test(normalized));
}

export function isAllowedReportWorkingFile(fileName: string) {
  const normalized = fileName.replaceAll("\\", "/");
  return normalized.length > 0
    && !normalized.startsWith("/")
    && !normalized.split("/").some((part) => !part || part === "." || part === "..");
}

export function assertReportCode(reportCode: string) {
  if (!REPORT_CODE_PATTERN.test(reportCode)) throw new Error("INVALID_REPORT_CODE");
  return reportCode;
}

function assertTenantId(tenantId: number) {
  if (!Number.isSafeInteger(tenantId) || !TENANT_ID_PATTERN.test(String(tenantId))) throw new Error("INVALID_TENANT_ID");
}

export function getTenantWorkspacePath(tenantId: number) {
  assertTenantId(tenantId);
  ensureWorkspaceStorageLayout();
  return path.join(REPORT_WORKSPACE_ROOT, String(tenantId));
}

export function getReportWorkspacePath(tenantId: number, reportCode: string) {
  assertReportCode(reportCode);
  return path.join(getTenantWorkspacePath(tenantId), reportCode);
}

export function getReportWorkingPath(tenantId: number, reportCode: string) {
  return path.join(getReportWorkspacePath(tenantId, reportCode), "working");
}

export function resolveReportWorkingPath(tenantId: number, reportCode: string, fileName: string) {
  const normalized = fileName.replaceAll("\\", "/");
  if (!isAllowedReportWorkingFile(normalized)) throw new Error("REPORT_FILE_NOT_ALLOWED");
  const workingPath = getReportWorkingPath(tenantId, reportCode);
  const resolvedPath = path.resolve(workingPath, normalized);
  if (resolvedPath !== workingPath && !resolvedPath.startsWith(`${workingPath}${path.sep}`)) {
    throw new Error("REPORT_FILE_NOT_ALLOWED");
  }
  return resolvedPath;
}

export function resolveReportSourcePath(tenantId: number, reportCode: string, fileName: string, version?: number) {
  const normalized = fileName.replaceAll("\\", "/");
  if (!isAllowedReportSourceFile(normalized)) {
    throw new Error("REPORT_FILE_NOT_ALLOWED");
  }
  const root = getReportWorkspacePath(tenantId, reportCode);
  return path.join(root, version == null ? "working" : path.join("releases", `v${version}`), normalized);
}

function seededReportTitle(reportCode: string, definition?: unknown) {
  if (definition && typeof definition === "object" && !Array.isArray(definition)) {
    const title = (definition as { title?: unknown }).title;
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  return reportCode;
}

function applyTemplateBindings(content: string, bindings: Record<string, string>) {
  return Object.entries(bindings).reduce((result, [key, value]) => result.replaceAll(key, value), content);
}

async function seedDirectoryFromTemplate(sourceDir: string, targetDir: string, bindings: Record<string, string>) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await seedDirectoryFromTemplate(sourcePath, targetPath, bindings);
      continue;
    }

    try {
      await fs.access(targetPath);
      continue;
    } catch {
      const templateContent = await fs.readFile(sourcePath, "utf8");
      await fs.writeFile(targetPath, applyTemplateBindings(templateContent, bindings));
    }
  }
}

async function removeLegacyWorkspaceFiles(workingPath: string) {
  for (const file of ["page.json", "data.json"]) {
    await fs.rm(path.join(/*turbopackIgnore: true*/ workingPath, file), { force: true });
  }
}

export async function initializeReportWorkspace(tenantId: number, reportCode: string, definition?: unknown) {
  const workspacePath = getReportWorkspacePath(tenantId, reportCode);
  const workingPath = path.join(workspacePath, "working");
  const reportTitle = seededReportTitle(reportCode, definition);
  const bindings = {
    "__REPORT_CODE__": reportCode,
    "__REPORT_TITLE__": reportTitle,
    "__TENANT_ID__": String(tenantId),
    "__UPDATED_AT__": new Date().toISOString(),
  };

  await seedDirectoryFromTemplate(BLANK_TEMPLATE_WORKING_PATH, workingPath, bindings);
  await removeLegacyWorkspaceFiles(workingPath);

  const reportPath = path.join(workingPath, "report.json");
  const readJson = async (filePath: string) => {
    try { return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown; } catch { return null; }
  };
  const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const reportDocument = await readJson(reportPath);

  if (!isRecord(reportDocument) || reportDocument.schemaVersion !== "1.0" || String(reportDocument.entry) !== "page.html") {
    await fs.writeFile(reportPath, `${JSON.stringify(toReportDocument({
      tenantId,
      reportCode,
      name: reportTitle,
    }), null, 2)}\n`);
  }
  return workspacePath;
}

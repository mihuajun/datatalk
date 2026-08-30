import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import { validateWorkingReportRuntime } from "@/lib/server/report-data-runtime";
import { resolveReportSourcePath } from "@/lib/server/report-workspace";

export type ReportValidationIssue = { file: string; message: string };
export type ReportValidationResult = { valid: boolean; issues: ReportValidationIssue[]; emptyData: boolean };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function addIssue(issues: ReportValidationIssue[], file: string, message: string) {
  issues.push({ file, message });
}

function entries(value: unknown) {
  return isRecord(value)
    ? Object.entries(value).filter(([, item]) => isRecord(item)).map(([id, item]) => ({ id, value: item as JsonRecord }))
    : [];
}

function isInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value);
}

async function readRuntimeSource(tenantId: number, reportCode: string) {
  for (const runtimeFile of ["server.js", "server.ts"] as const) {
    try {
      return {
        fileName: runtimeFile,
        content: await fs.readFile(resolveReportSourcePath(tenantId, reportCode, runtimeFile), "utf8"),
      };
    } catch {
      // Try next runtime filename.
    }
  }
  return null;
}

export async function validateReportWorkspace(tenantId: number, reportCode: string): Promise<ReportValidationResult> {
  const issues: ReportValidationIssue[] = [];
  const parsed = new Map<string, unknown>();

  for (const file of ["report.json"]) {
    try {
      const value = JSON.parse(await fs.readFile(resolveReportSourcePath(tenantId, reportCode, file), "utf8")) as unknown;
      parsed.set(file, value);
      if (!isRecord(value)) addIssue(issues, file, "根节点必须是对象");
    } catch {
      addIssue(issues, file, "文件不存在或不是有效 JSON");
    }
  }

  const report = parsed.get("report.json");
  const isWebReport = isRecord(report) && report.entry === "page.html";
  if (!isRecord(report)) {
    addIssue(issues, "report.json", "根节点必须是对象");
  } else {
    for (const key of ["schemaVersion", "reportCode", "tenantId", "name", "entry", "format"]) {
      if (!(key in report)) addIssue(issues, "report.json", `缺少字段 ${key}`);
    }
    if (report.schemaVersion !== "1.0") addIssue(issues, "report.json", "schemaVersion 必须为 1.0");
    if (report.reportCode !== reportCode) addIssue(issues, "report.json", "reportCode 与当前报表不一致");
    if (String(report.entry) !== "page.html") addIssue(issues, "report.json", "entry 必须指向 page.html");
    if (String(report.format) !== "web") addIssue(issues, "report.json", "format 必须为 web");
  }

  for (const file of ["page.html", "styles.css", "app.js"]) {
    try {
      const content = await fs.readFile(resolveReportSourcePath(tenantId, reportCode, file), "utf8");
      if (!content.trim()) addIssue(issues, file, "网页源文件不能为空");
    } catch {
      if (isWebReport) addIssue(issues, file, "网页源文件不存在");
    }
  }

  const runtimeSource = await readRuntimeSource(tenantId, reportCode);
  if (runtimeSource) {
    if (!runtimeSource.content.trim()) addIssue(issues, runtimeSource.fileName, `${runtimeSource.fileName} 不能为空`);
    if (runtimeSource.fileName.endsWith(".ts")) {
      const result = ts.transpileModule(runtimeSource.content, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
        reportDiagnostics: true,
      });
      for (const diagnostic of result.diagnostics || []) addIssue(issues, runtimeSource.fileName, ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
    }
    if (runtimeSource.content.trim()) {
      try {
        await validateWorkingReportRuntime(tenantId, reportCode);
      } catch (error) {
        const message = error instanceof Error ? error.message : "REPORT_SERVER_INVALID";
        addIssue(issues, runtimeSource.fileName, `服务端运行时无效：${message}`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    emptyData: false,
  };
}

export async function readReportWorkspaceFile(tenantId: number, reportCode: string, fileName: string) {
  return fs.readFile(resolveReportSourcePath(tenantId, reportCode, fileName), "utf8");
}

export function reportWorkspaceFilePath(tenantId: number, reportCode: string, fileName: string) {
  return path.normalize(resolveReportSourcePath(tenantId, reportCode, fileName));
}

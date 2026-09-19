import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getDbPool } from "@/lib/server/mysql";
import type { RowDataPacket } from "mysql2/promise";
import { commitWorkspace, deleteReportSourceFile, getWorkspaceHead, getWorkspaceStatus, restoreWorkspace, writeReportSourceFile } from "@/lib/server/local-git";
import { buildReleaseThumbnailUrl, writeReleaseThumbnail, writeResourceThumbnailDataUrl } from "@/lib/server/report-release-thumbnail";
import { getReportDetailByCode } from "@/lib/server/report-repository";
import { getReportEditLock, isReportEditLockEnabled } from "@/lib/server/report-edit-lock";
import { getReportWorkspacePath, initializeReportWorkspace, assertReportCode, isAllowedReportWorkingFile, resolveReportSourcePath, resolveReportWorkingPath } from "@/lib/server/report-workspace";
import { validateReportWorkspace } from "@/lib/server/report-schema";

export type ReportChangeSet = { files: Record<string, string>; deleteFiles?: string[] };

type ReleaseMetadataRow = RowDataPacket & {
  tenant_name: string | null;
  folder_name: string | null;
};

function auditError(code: string) { const error = new Error(code); Object.assign(error, { code }); return error; }

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function releaseDescription(definition: unknown) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null;
  const record = definition as Record<string, unknown>;
  return optionalText(record.description) || optionalText(record.subTitle);
}

function releaseDisplayName(definition: unknown, fallback: string) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return fallback;
  return optionalText((definition as Record<string, unknown>).title) || fallback;
}

function releaseRemark(definition: unknown) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null;
  return optionalText((definition as Record<string, unknown>).remark);
}

function releaseThumbnailUrl(definition: unknown) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null;
  const record = definition as Record<string, unknown>;
  return optionalText(record.thumbnailUrl) || optionalText(record.thumbnail) || optionalText(record.coverImage);
}

async function ensureReleaseCategory(connection: any, tenantId: number, categoryName: string) {
  const normalizedName = categoryName.trim();
  const [rows] = await connection.query(
    `SELECT id, name
       FROM report_release_category
      WHERE tenant_id = ?
        AND name IN (?, '未分类')
      ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END, sort_order ASC, id ASC
      LIMIT 1`,
    [tenantId, normalizedName || "未分类", normalizedName || "未分类"],
  ) as [Array<RowDataPacket & { id: number; name: string }>, unknown[]];

  if (rows[0]) {
    return {
      id: Number(rows[0].id),
      name: String(rows[0].name || "未分类"),
    };
  }

  return {
    id: null,
    name: normalizedName || "未分类",
  };
}

async function loadReleaseMetadata(tenantId: number, reportCode: string, definition: unknown) {
  const [rows] = await getDbPool().query<Array<ReleaseMetadataRow>>(
    `SELECT t.name AS tenant_name, f.name AS folder_name
       FROM tenant_report r
       LEFT JOIN tenant t ON t.id = r.tenant_id
       LEFT JOIN tenant_report_folder f ON f.id = r.folder_id
      WHERE r.tenant_id = ? AND r.code = ? AND r.deleted_at IS NULL
      LIMIT 1`,
    [tenantId, reportCode],
  );
  const metadata = rows[0];
  return {
    publisherTenantName: optionalText(metadata?.tenant_name),
    categoryName: optionalText(metadata?.folder_name) || "未分类",
    description: releaseDescription(definition),
    remark: releaseRemark(definition),
    thumbnailUrl: releaseThumbnailUrl(definition),
  };
}

async function assertReportEditLock(tenantId: number, reportCode: string, userId?: number, lockToken?: string) {
  if (!isReportEditLockEnabled()) return;
  if (userId == null || !lockToken) throw auditError("EDIT_LOCK_REQUIRED");
  const lock = await getReportEditLock(tenantId, reportCode);
  if (!lock || lock.userId !== userId || lock.lockToken !== lockToken) throw auditError("EDIT_LOCK_REQUIRED");
}

export async function ensureReportOwnership(tenantId: number, reportCode: string) {
  assertReportCode(reportCode);
  const report = await getReportDetailByCode(tenantId, reportCode);
  if (!report) throw auditError("REPORT_NOT_FOUND");
  await initializeReportWorkspace(tenantId, reportCode);
  return report;
}

function validateChangeSet(changeSet: ReportChangeSet, reportCode?: string) {
  if (!changeSet || !changeSet.files || typeof changeSet.files !== "object" || Array.isArray(changeSet.files)) throw auditError("INVALID_CHANGE_SET");
  for (const [file, content] of Object.entries(changeSet.files)) {
    if (typeof content !== "string") throw auditError("INVALID_FILE_CONTENT");
    if (file.startsWith("_knowledge/") || file.includes("..")) throw auditError("REPORT_FILE_NOT_ALLOWED");
    if (reportCode) resolveReportSourcePath(1, reportCode, file);
  }
  if (changeSet.deleteFiles !== undefined && !Array.isArray(changeSet.deleteFiles)) throw auditError("INVALID_DELETE_FILES");
  for (const file of changeSet.deleteFiles || []) {
    if (typeof file !== "string" || file.startsWith("_knowledge/") || file.includes("..") || file === "report.json") throw auditError("REPORT_FILE_NOT_ALLOWED");
    if (reportCode) resolveReportSourcePath(1, reportCode, file);
    if (file in changeSet.files) throw auditError("CHANGE_SET_CONFLICT");
  }
}

function validateWorkingChangeSet(changeSet: ReportChangeSet, tenantId: number, reportCode: string) {
  if (!changeSet || !changeSet.files || typeof changeSet.files !== "object" || Array.isArray(changeSet.files)) throw auditError("INVALID_CHANGE_SET");
  for (const [file, content] of Object.entries(changeSet.files)) {
    if (typeof content !== "string") throw auditError("INVALID_FILE_CONTENT");
    if (!isAllowedReportWorkingFile(file)) throw auditError("REPORT_FILE_NOT_ALLOWED");
    resolveReportWorkingPath(tenantId, reportCode, file);
  }
  if (changeSet.deleteFiles !== undefined && !Array.isArray(changeSet.deleteFiles)) throw auditError("INVALID_DELETE_FILES");
  for (const file of changeSet.deleteFiles || []) {
    if (typeof file !== "string" || !isAllowedReportWorkingFile(file)) throw auditError("REPORT_FILE_NOT_ALLOWED");
    resolveReportWorkingPath(tenantId, reportCode, file);
    if (file in changeSet.files) throw auditError("CHANGE_SET_CONFLICT");
  }
}

export async function applyReportChanges(input: { tenantId: number; reportCode: string; userId: number; changeSet: ReportChangeSet; message: string; baseCommitHash?: string; lockToken?: string; auditAction?: "ai_edit" | "rollback" }) {
  await assertReportEditLock(input.tenantId, input.reportCode, input.userId, input.lockToken);
  const report = await ensureReportOwnership(input.tenantId, input.reportCode); validateChangeSet(input.changeSet);
  const base = await getWorkspaceHead(input.tenantId, input.reportCode);
  if (input.baseCommitHash && base && input.baseCommitHash !== base) throw auditError("WORKING_BASE_CONFLICT");
  const opId = randomUUID();
  const [audit] = await getDbPool().execute("INSERT INTO report_edit_audit (tenant_id, report_code, user_id, op_id, action, status, base_commit_hash) VALUES (?, ?, ?, ?, ?, 'pending', ?)", [input.tenantId, input.reportCode, input.userId, opId, input.auditAction || "ai_edit", base]);
  const auditId = Number((audit as { insertId: number }).insertId);
  let commitHash: string | null = null;
  try {
    for (const file of input.changeSet.deleteFiles || []) await deleteReportSourceFile(input.tenantId, input.reportCode, file);
    for (const [file, content] of Object.entries(input.changeSet.files)) await writeReportSourceFile(input.tenantId, input.reportCode, file, content);
    try {
      const reportPath = resolveReportSourcePath(input.tenantId, input.reportCode, "report.json");
      const reportDocument = JSON.parse(await fs.readFile(reportPath, "utf8")) as Record<string, unknown>;
      if (reportDocument.schemaVersion === "1.0" && reportDocument.entry === "page.html") {
        reportDocument.updatedAt = new Date().toISOString();
        if (input.changeSet.files["page.html"] !== undefined) {
          reportDocument.entry = "page.html";
          reportDocument.format = "web";
        }
        await writeReportSourceFile(input.tenantId, input.reportCode, "report.json", `${JSON.stringify(reportDocument, null, 2)}\n`);
      }
    } catch {
      throw auditError("REPORT_METADATA_UPDATE_FAILED");
    }
    const validation = await validateReportWorkspace(
      input.tenantId,
      input.reportCode,
    );
    if (!validation.valid) {
      const error = auditError("REPORT_VALIDATION_FAILED");
      Object.assign(error, { issues: validation.issues });
      throw error;
    }
    commitHash = await commitWorkspace(input.tenantId, input.reportCode, input.message, opId);
    try {
      await getDbPool().execute("UPDATE report_edit_audit SET status='success', commit_hash=? WHERE id=?", [commitHash, auditId]);
      await getDbPool().execute("UPDATE tenant_report SET working_commit_hash=?, current_working_revision=current_working_revision+1 WHERE tenant_id=? AND code=? AND deleted_at IS NULL", [commitHash, input.tenantId, input.reportCode]);
    } catch (auditErrorValue) {
      const errorMessage = String(auditErrorValue instanceof Error ? auditErrorValue.message : auditErrorValue).slice(0, 500);
      await getDbPool().execute("INSERT INTO report_pending_audit (tenant_id, report_code, audit_id, commit_hash, error_message) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE commit_hash=VALUES(commit_hash), error_message=VALUES(error_message), status='pending'", [input.tenantId, input.reportCode, auditId, commitHash, errorMessage]);
      throw auditError("AUDIT_PENDING");
    }
      return { auditId, opId, commitHash, validation };
  } catch (error) {
    if (base && !commitHash) await restoreWorkspace(input.tenantId, input.reportCode, base);
    const errorMessage = String(error instanceof Error ? error.message : error).slice(0, 500);
    try { await getDbPool().execute("UPDATE report_edit_audit SET status='failed', error_message=?, commit_hash=COALESCE(commit_hash, ?) WHERE id=?", [errorMessage, commitHash, auditId]); } catch { /* preserve original operation error */ }
    throw error;
  }
}

export async function commitRuntimeWorkspaceChanges(input: {
  tenantId: number;
  reportCode: string;
  userId: number;
  lockToken?: string;
  message: string;
  changedFiles: string[];
  deletedFiles: string[];
  baseCommitHash?: string;
}) {
  await assertReportEditLock(input.tenantId, input.reportCode, input.userId, input.lockToken);
  await ensureReportOwnership(input.tenantId, input.reportCode);
  const base = await getWorkspaceHead(input.tenantId, input.reportCode);
  if (input.baseCommitHash && input.baseCommitHash !== base) throw auditError("WORKING_BASE_CONFLICT");
  const changedFiles = [...new Set(input.changedFiles)];
  const deletedFiles = [...new Set(input.deletedFiles)];
  validateWorkingChangeSet({ files: Object.fromEntries(changedFiles.map((file) => [file, ""])), deleteFiles: deletedFiles }, input.tenantId, input.reportCode);
  const allWorkspaceFiles = await getWorkspaceStatus(input.tenantId, input.reportCode, "working");
  const actualFiles = allWorkspaceFiles.map((file) => path.posix.normalize(file.replace(/\\/g, "/")));
  const declared = new Set([...changedFiles, ...deletedFiles].map((file) => path.posix.normalize(file.replace(/\\/g, "/"))));
  const undeclared = actualFiles.filter((file) => !declared.has(file));
  if (undeclared.length) {
    if (base) await restoreWorkspace(input.tenantId, input.reportCode, base);
    throw auditError("UNDECLARED_WORKSPACE_CHANGES");
  }
  const opId = randomUUID();
  const [audit] = await getDbPool().execute("INSERT INTO report_edit_audit (tenant_id, report_code, user_id, op_id, action, status, base_commit_hash) VALUES (?, ?, ?, ?, 'ai_edit', 'pending', ?)", [input.tenantId, input.reportCode, input.userId, opId, base]);
  const auditId = Number((audit as { insertId: number }).insertId);
  let commitHash: string | null = null;
  try {
    const validation = await validateReportWorkspace(input.tenantId, input.reportCode);
    if (!validation.valid) {
      const error = auditError("REPORT_VALIDATION_FAILED");
      Object.assign(error, { issues: validation.issues });
      throw error;
    }
    commitHash = await commitWorkspace(input.tenantId, input.reportCode, input.message, opId, "working");
    await getDbPool().execute("UPDATE report_edit_audit SET status='success', commit_hash=? WHERE id=?", [commitHash, auditId]);
    await getDbPool().execute("UPDATE tenant_report SET working_commit_hash=?, current_working_revision=current_working_revision+1 WHERE tenant_id=? AND code=? AND deleted_at IS NULL", [commitHash, input.tenantId, input.reportCode]);
      return { auditId, opId, commitHash, validation, changedFiles, deletedFiles, actualFiles };
  } catch (error) {
    if (base && !commitHash) await restoreWorkspace(input.tenantId, input.reportCode, base);
    const errorMessage = String(error instanceof Error ? error.message : error).slice(0, 500);
    try { await getDbPool().execute("UPDATE report_edit_audit SET status='failed', error_message=? WHERE id=?", [errorMessage, auditId]); } catch { /* preserve original operation error */ }
    throw error;
  }
}

export async function renameReport(input: {
  tenantId: number;
  reportCode: string;
  userId: number;
  name: string;
  lockToken?: string;
}) {
  await assertReportEditLock(input.tenantId, input.reportCode, input.userId, input.lockToken);

  const [rows] = await getDbPool().query<Array<RowDataPacket & { code: string }>>(
    "SELECT code FROM tenant_report WHERE tenant_id=? AND code=? AND deleted_at IS NULL LIMIT 1",
    [input.tenantId, input.reportCode],
  );
  if (!rows[0]) throw auditError("REPORT_NOT_FOUND");

  const name = input.name.trim();
  if (!name || name.length > 160) throw auditError("INVALID_REPORT_NAME");

  await getDbPool().execute(
    "UPDATE tenant_report SET name=? WHERE tenant_id=? AND code=? AND deleted_at IS NULL",
    [name, input.tenantId, input.reportCode],
  );

  return { name };
}

export async function rollbackReportEdit(tenantId: number, reportCode: string, userId: number, auditId: number, lockToken?: string) {
  await assertReportEditLock(tenantId, reportCode, userId, lockToken);
  const [rows] = await getDbPool().query<Array<RowDataPacket & { commit_hash: string | null }>>("SELECT commit_hash FROM report_edit_audit WHERE id=? AND tenant_id=? AND report_code=? LIMIT 1", [auditId, tenantId, reportCode]);
  const target = rows[0]?.commit_hash; if (!target) throw auditError("AUDIT_NOT_FOUND");
  const before = await getWorkspaceHead(tenantId, reportCode); await restoreWorkspace(tenantId, reportCode, target);
  const result = await applyReportChanges({ tenantId, reportCode, userId, changeSet: { files: {} }, message: "rollback report edit", baseCommitHash: target, lockToken, auditAction: "rollback" });
  if (before && result.commitHash === before) throw auditError("ROLLBACK_FAILED");
  return result;
}

export async function restoreReportEditToCommit(input: { tenantId: number; reportCode: string; userId: number; targetCommitHash: string; lockToken?: string }) {
  await assertReportEditLock(input.tenantId, input.reportCode, input.userId, input.lockToken);
  if (!/^[a-f0-9]{7,64}$/.test(input.targetCommitHash)) throw auditError("INVALID_COMMIT_HASH");
  await ensureReportOwnership(input.tenantId, input.reportCode);

  const [knownCommits] = await getDbPool().query<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM report_edit_audit WHERE tenant_id=? AND report_code=? AND status='success' AND (commit_hash=? OR base_commit_hash=?) LIMIT 1",
    [input.tenantId, input.reportCode, input.targetCommitHash, input.targetCommitHash],
  );
  if (!knownCommits[0]) throw auditError("AUDIT_NOT_FOUND");

  const before = await getWorkspaceHead(input.tenantId, input.reportCode);
  if (before === input.targetCommitHash) return { auditId: null, opId: null, commitHash: before, validation: await validateReportWorkspace(input.tenantId, input.reportCode) };

  await restoreWorkspace(input.tenantId, input.reportCode, input.targetCommitHash);
  try {
    return await applyReportChanges({
      tenantId: input.tenantId,
      reportCode: input.reportCode,
      userId: input.userId,
      changeSet: { files: {} },
      message: "恢复网页报表历史版本",
      baseCommitHash: input.targetCommitHash,
      lockToken: input.lockToken,
      auditAction: "rollback",
    });
  } catch (error) {
    if (before) await restoreWorkspace(input.tenantId, input.reportCode, before);
    throw error;
  }
}

export async function publishReport(tenantId: number, reportCode: string, userId: number, options?: { resourceThumbnailDataUrl?: string | null }) {
  const pool = getDbPool();
  let report!: Awaited<ReturnType<typeof ensureReportOwnership>>;
  let sourceCommit: string | null = null;
  let version = 0;
  let releasePath = "";
  let tempPath = "";
  let releaseStarted = false;
  try {
    report = await ensureReportOwnership(tenantId, reportCode);
    const metadata = await loadReleaseMetadata(tenantId, reportCode, report.definition);
    const validation = await validateReportWorkspace(tenantId, reportCode);
    if (!validation.valid) throw auditError("REPORT_VALIDATION_FAILED");
    sourceCommit = await getWorkspaceHead(tenantId, reportCode); if (!sourceCommit) throw auditError("WORKING_NOT_COMMITTED");
    const [versions] = await pool.query<Array<RowDataPacket & { version: number }>>("SELECT MAX(version) AS version FROM report_release WHERE tenant_id=? AND report_code=?", [tenantId, reportCode]);
    version = Number(versions[0]?.version || 0) + 1;
    const root = getReportWorkspacePath(tenantId, reportCode); const releasesPath = path.join(root, "releases");
    releasePath = path.join(releasesPath, `v${version}`); tempPath = path.join(releasesPath, `.v${version}.${randomUUID()}.tmp`);
    await fs.mkdir(releasesPath, { recursive: true });
    await fs.rm(tempPath, { recursive: true, force: true });
    const workingPath = path.join(root, "working");
    await fs.cp(workingPath, tempPath, {
      recursive: true,
      filter: (source) => {
        const relativePath = path.relative(workingPath, source);
        return relativePath !== "runtime" && !relativePath.startsWith(`runtime${path.sep}`);
      },
    });
    await writeReleaseThumbnail({
      tenantId,
      reportCode,
      version,
      reportName: report.report.name,
      tenantName: metadata.publisherTenantName,
      categoryName: metadata.categoryName,
      description: metadata.description,
      targetDirectory: tempPath,
    });
    const resourceThumbnailDataUrl = optionalText(options?.resourceThumbnailDataUrl);
    if (resourceThumbnailDataUrl) {
      await writeResourceThumbnailDataUrl({
        tenantId,
        reportCode,
        version,
        dataUrl: resourceThumbnailDataUrl,
        targetDirectory: tempPath,
      });
    }
    const releaseThumbnailUrl = buildReleaseThumbnailUrl(reportCode, version);
    const releaseFiles = await fs.readdir(tempPath, { recursive: true });
    for (const entry of releaseFiles) { const target = path.join(tempPath, String(entry)); const stat = await fs.stat(target); if (stat.isFile()) await fs.chmod(target, 0o444); }
    const releaseMeta = path.join(tempPath, "release.json"); await fs.writeFile(releaseMeta, JSON.stringify({ version, sourceCommitHash: sourceCommit }, null, 2)); await fs.chmod(releaseMeta, 0o444);
    await fs.rm(releasePath, { recursive: true, force: true }); await fs.rename(tempPath, releasePath);
    releaseStarted = true;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const category = await ensureReleaseCategory(connection, tenantId, metadata.categoryName);
      await connection.execute(
        `INSERT INTO report_release
          (tenant_id, report_code, version, source_commit_hash, thumbnail_url, publisher_tenant_name, view_count, like_count, display_name, remark, description, category_id, category_name, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 'published', ?)`,
        [
          tenantId,
          reportCode,
          version,
          sourceCommit,
          metadata.thumbnailUrl || releaseThumbnailUrl,
          metadata.publisherTenantName,
          releaseDisplayName(report.definition, report.report.name),
          metadata.remark,
          metadata.description,
          category.id,
          category.name,
          userId,
        ],
      );
      await connection.execute("UPDATE tenant_report SET current_release_version=?, release_status='已发布', status='已发布' WHERE tenant_id=? AND code=? AND deleted_at IS NULL", [version, tenantId, reportCode]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return { report: report.report, version, sourceCommitHash: sourceCommit };
  } catch (error) {
    await fs.rm(tempPath, { recursive: true, force: true }).catch(() => undefined);
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    try {
      await pool.execute("INSERT INTO report_release (tenant_id, report_code, version, source_commit_hash, status, error_message, created_by) VALUES (?, ?, ?, ?, 'failed', ?, ?) ON DUPLICATE KEY UPDATE status='failed', error_message=VALUES(error_message)", [tenantId, reportCode, version, sourceCommit, message, userId]);
      await pool.execute("UPDATE tenant_report SET release_status='发布失败' WHERE tenant_id=? AND code=? AND deleted_at IS NULL", [tenantId, reportCode]);
    } catch { /* keep original publish error */ }
    if (releaseStarted) await fs.rm(releasePath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function rollbackRelease(tenantId: number, reportCode: string, version: number) {
  const [rows] = await getDbPool().query<Array<RowDataPacket & { version: number }>>("SELECT version FROM report_release WHERE tenant_id=? AND report_code=? AND version=? LIMIT 1", [tenantId, reportCode, version]); if (!rows[0]) throw auditError("RELEASE_NOT_FOUND");
  await getDbPool().execute("UPDATE tenant_report SET current_release_version=?, release_status='已发布', status='已发布' WHERE tenant_id=? AND code=? AND deleted_at IS NULL", [version, tenantId, reportCode]);
  return { version };
}

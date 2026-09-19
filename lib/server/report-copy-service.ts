import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { RowDataPacket } from "mysql2/promise";

import type { ReportItem } from "@/lib/report-types";
import type { ResourceAssetType } from "@/lib/resource-center-types";
import { getDbPool } from "@/lib/server/mysql";
import { commitWorkspace, getWorkspaceHead, getWorkspaceStatus } from "@/lib/server/local-git";
import { validateReportWorkspace } from "@/lib/server/report-schema";
import { createReport, ensureDefaultReportFolder, getReportDetailByCode } from "@/lib/server/report-repository";
import { getReportWorkingPath, getReportWorkspacePath } from "@/lib/server/report-workspace";
import { getResourceItemBySource } from "@/lib/server/resource-repository";

type SourceReportRow = RowDataPacket & {
  name: string;
  current_release_version: number | null;
  owner_id: number | null;
  published_by: number | null;
  source_commit_hash: string | null;
};

type CopyableResourceAssetType = Extract<ResourceAssetType, "report" | "template">;

function copyName(title: string) {
  const suffix = "（副本）";
  return `${title.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
}

async function rewriteCopiedReportMetadata(workingPath: string, target: { tenantId: number; reportCode: string; name: string }) {
  const reportPath = path.join(workingPath, "report.json");
  const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as Record<string, unknown>;
  report.reportCode = target.reportCode;
  report.tenantId = String(target.tenantId);
  report.name = target.name;
  report.updatedAt = new Date().toISOString();
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function makeWorkspaceWritable(root: string) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  await fs.chmod(root, 0o755);
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await makeWorkspaceWritable(target);
    } else if (entry.isFile()) {
      await fs.chmod(target, 0o644);
    }
  }
}

async function resolvePublishedSourcePath(input: { tenantId: number; reportCode: string; version: number; sourceCommitHash: string | null }) {
  const releasePath = path.join(getReportWorkspacePath(input.tenantId, input.reportCode), "releases", `v${input.version}`);
  try {
    await fs.access(path.join(releasePath, "report.json"));
    return releasePath;
  } catch {
    const [workspaceHead, workspaceStatus] = await Promise.all([
      getWorkspaceHead(input.tenantId, input.reportCode),
      getWorkspaceStatus(input.tenantId, input.reportCode, "working"),
    ]);
    if (!input.sourceCommitHash || workspaceHead !== input.sourceCommitHash || workspaceStatus.length > 0) {
      throw new Error("RESOURCE_RELEASE_NOT_FOUND");
    }

    const workingPath = getReportWorkingPath(input.tenantId, input.reportCode);
    await fs.access(path.join(workingPath, "report.json"));
    return workingPath;
  }
}

export async function copyPublishedResourceReport(input: {
  targetTenantId: number;
  ownerId: number;
  ownerName: string;
  sourceTenantId: number;
  sourceCode: string;
  sourceAssetType: CopyableResourceAssetType;
}) {
  const sourceCode = input.sourceCode.trim();
  const sourceResource = await getResourceItemBySource(input.sourceTenantId, input.sourceAssetType, sourceCode);
  if (!sourceResource || sourceResource.status !== "published" || sourceResource.sourceVersion < 1) {
    throw new Error("RESOURCE_NOT_PUBLISHED");
  }

  const [sourceRows] = await getDbPool().query<SourceReportRow[]>(
    `SELECT r.name, r.current_release_version, r.owner_id, ri.published_by, rr.source_commit_hash
       FROM tenant_report r
       INNER JOIN report_release rr
               ON rr.tenant_id = r.tenant_id
              AND rr.report_code = r.code
              AND rr.version = ?
              AND rr.status = 'published'
       LEFT JOIN resource_item ri
              ON ri.tenant_id = r.tenant_id
             AND ri.asset_type = ?
             AND ri.source_code = r.code
             AND ri.status = 'published'
      WHERE r.tenant_id = ?
        AND r.code = ?
        AND r.deleted_at IS NULL
      LIMIT 1`,
    [sourceResource.sourceVersion, input.sourceAssetType, input.sourceTenantId, sourceCode],
  );
  const sourceReport = sourceRows[0];
  if (!sourceReport) throw new Error("RESOURCE_RELEASE_NOT_FOUND");

  const isOwnPublishedResource = input.sourceTenantId === input.targetTenantId
    && Number(sourceReport.published_by) === input.ownerId;
  if (isOwnPublishedResource) {
    const ownReport = await getReportDetailByCode(input.targetTenantId, sourceCode);
    if (!ownReport) throw new Error("SOURCE_REPORT_NOT_FOUND");
    return {
      report: ownReport.report,
      reused: true,
      source: {
        tenantId: input.sourceTenantId,
        assetType: input.sourceAssetType,
        code: sourceCode,
        version: sourceResource.sourceVersion,
        title: sourceResource.title || sourceReport.name,
      },
    };
  }

  const sourceSnapshotPath = await resolvePublishedSourcePath({
    tenantId: input.sourceTenantId,
    reportCode: sourceCode,
    version: sourceResource.sourceVersion,
    sourceCommitHash: sourceReport.source_commit_hash,
  });

  const folderId = await ensureDefaultReportFolder(input.targetTenantId);
  const reportName = copyName(sourceResource.title || sourceReport.name || sourceCode);
  const created = await createReport({
    tenantId: input.targetTenantId,
    folderId,
    name: reportName,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
  });
  if (!created) throw new Error("TARGET_FOLDER_NOT_FOUND");

  const targetWorkingPath = getReportWorkingPath(input.targetTenantId, created.code);
  try {
    await fs.rm(targetWorkingPath, { recursive: true, force: true });
    await fs.cp(sourceSnapshotPath, targetWorkingPath, {
      recursive: true,
      filter: (source) => {
        const relativePath = path.relative(sourceSnapshotPath, source);
        return relativePath !== "release.json"
          && relativePath !== "runtime"
          && !relativePath.startsWith(`runtime${path.sep}`);
      },
    });
    await makeWorkspaceWritable(targetWorkingPath);
    await rewriteCopiedReportMetadata(targetWorkingPath, {
      tenantId: input.targetTenantId,
      reportCode: created.code,
      name: reportName,
    });

    const validation = await validateReportWorkspace(input.targetTenantId, created.code);
    if (!validation.valid) throw new Error("COPIED_REPORT_INVALID");

    const commitHash = await commitWorkspace(
      input.targetTenantId,
      created.code,
      "从资源中心复制报告",
      `resource-copy-${randomUUID()}`,
    );
    await getDbPool().execute(
      "UPDATE tenant_report SET working_commit_hash = ?, current_working_revision = current_working_revision + 1 WHERE tenant_id = ? AND code = ? AND deleted_at IS NULL",
      [commitHash, input.targetTenantId, created.code],
    );

    return {
      report: created satisfies ReportItem,
      source: {
        tenantId: input.sourceTenantId,
        assetType: input.sourceAssetType,
        code: sourceCode,
        version: sourceResource.sourceVersion,
        title: sourceResource.title || sourceReport.name,
      },
    };
  } catch (error) {
    await fs.rm(getReportWorkspacePath(input.targetTenantId, created.code), { recursive: true, force: true }).catch(() => undefined);
    await getDbPool().execute(
      "DELETE FROM tenant_report WHERE tenant_id = ? AND code = ? AND deleted_at IS NULL",
      [input.targetTenantId, created.code],
    ).catch(() => undefined);
    throw error;
  }
}

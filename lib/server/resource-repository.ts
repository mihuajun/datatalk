import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { ResourceAssetType, ResourceCategoryOption, ResourceItemRecord, ResourceItemStatus } from "@/lib/resource-center-types";
import { getDbPool, withDatabaseReadRetry } from "@/lib/server/mysql";

type ResourceCategoryRow = RowDataPacket & {
  id: number;
  asset_type: string;
  parent_id: number | null;
  code: string;
  name: string;
  sort_order: number;
};

type ResourceItemRow = RowDataPacket & {
  id: number;
  tenant_id: number;
  asset_type: string;
  source_code: string;
  source_version: number;
  status: string;
  title: string;
  summary: string | null;
  thumbnail_url: string | null;
  category_id: number | null;
  category_name: string | null;
  view_count: number;
  favorite_count: number;
  like_count: number;
  content_updated_at: string | Date | null;
  submitted_at: string | Date | null;
  published_at: string | Date | null;
};

type ReportPublicationRow = RowDataPacket & {
  current_release_version: number | null;
  working_commit_hash: string | null;
  published_commit_hash: string | null;
  status: string;
};

type PublishedResourceTargetRow = RowDataPacket & {
  tenant_id: number;
  asset_type: string;
  source_code: string;
  source_version: number;
};

function normalizeDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStatus(value: string): ResourceItemStatus {
  return value === "pending_review" || value === "offline" || value === "rejected" || value === "draft"
    ? value
    : "published";
}

function normalizeAssetType(value: string): ResourceAssetType {
  return value === "template" || value === "dataset" ? value : "report";
}

function normalizeResourceItem(row: ResourceItemRow): ResourceItemRecord {
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    assetType: normalizeAssetType(row.asset_type),
    sourceCode: row.source_code,
    sourceVersion: Number(row.source_version || 0),
    status: normalizeStatus(row.status || "published"),
    title: row.title,
    summary: optionalText(row.summary),
    thumbnailUrl: optionalText(row.thumbnail_url),
    categoryId: row.category_id == null ? null : Number(row.category_id),
    categoryName: optionalText(row.category_name),
    viewCount: Number(row.view_count || 0),
    favoriteCount: Number(row.favorite_count || 0),
    likeCount: Number(row.like_count || 0),
    contentUpdatedAt: normalizeDate(row.content_updated_at),
    submittedAt: normalizeDate(row.submitted_at),
    publishedAt: normalizeDate(row.published_at),
  };
}

export async function listResourceCategories(assetType: ResourceAssetType): Promise<ResourceCategoryOption[]> {
  const [rows] = await withDatabaseReadRetry(() => getDbPool().query<ResourceCategoryRow[]>(
    `SELECT id, asset_type, parent_id, code, name, sort_order
       FROM resource_category
      WHERE asset_type = ? AND enabled = 1
      ORDER BY sort_order ASC, id ASC`,
    [assetType],
  ));

  const byId = new Map<number, ResourceCategoryRow>();
  const children = new Map<number | null, ResourceCategoryRow[]>();
  for (const row of rows) {
    byId.set(Number(row.id), row);
    const parentId = row.parent_id == null ? null : Number(row.parent_id);
    const list = children.get(parentId) || [];
    list.push(row);
    children.set(parentId, list);
  }

  const pathCache = new Map<number, string>();
  const levelCache = new Map<number, number>();

  function resolvePath(row: ResourceCategoryRow): string {
    const id = Number(row.id);
    const cached = pathCache.get(id);
    if (cached) return cached;
    const parentId = row.parent_id == null ? null : Number(row.parent_id);
    const path = parentId && byId.get(parentId) ? `${resolvePath(byId.get(parentId)!)} / ${row.name}` : row.name;
    pathCache.set(id, path);
    return path;
  }

  function resolveLevel(row: ResourceCategoryRow): number {
    const id = Number(row.id);
    const cached = levelCache.get(id);
    if (cached != null) return cached;
    const parentId = row.parent_id == null ? null : Number(row.parent_id);
    const level = parentId && byId.get(parentId) ? resolveLevel(byId.get(parentId)!) + 1 : 0;
    levelCache.set(id, level);
    return level;
  }

  return rows.map((row) => ({
    id: Number(row.id),
    assetType: normalizeAssetType(row.asset_type),
    parentId: row.parent_id == null ? null : Number(row.parent_id),
    code: row.code,
    name: row.name,
    level: resolveLevel(row),
    pathLabel: resolvePath(row),
    isLeaf: !(children.get(Number(row.id)) || []).length,
  }));
}

export async function getResourceItemBySource(tenantId: number, assetType: ResourceAssetType, sourceCode: string) {
  const [rows] = await withDatabaseReadRetry(() => getDbPool().query<ResourceItemRow[]>(
    `SELECT ri.id, ri.tenant_id, ri.asset_type, ri.source_code, ri.source_version, ri.status,
            ri.title, ri.summary, ri.thumbnail_url, ri.category_id, rc.name AS category_name,
            ri.view_count, ri.favorite_count, ri.like_count, ri.content_updated_at,
            ri.submitted_at, ri.published_at
       FROM resource_item ri
       LEFT JOIN resource_category rc ON rc.id = ri.category_id AND rc.asset_type = ri.asset_type
      WHERE ri.tenant_id = ? AND ri.asset_type = ? AND ri.source_code = ?
      LIMIT 1`,
    [tenantId, assetType, sourceCode],
  ));

  return rows[0] ? normalizeResourceItem(rows[0]) : null;
}

export async function getPublishedResourceReportTarget(reportCode: string, version?: number) {
  const versionFilter = version == null ? "" : "\n        AND ri.source_version = ?";
  const values = version == null ? [reportCode] : [reportCode, version];
  const [rows] = await withDatabaseReadRetry(() => getDbPool().query<PublishedResourceTargetRow[]>(
    `SELECT ri.tenant_id, ri.asset_type, ri.source_code, ri.source_version
       FROM resource_item ri
       INNER JOIN tenant_report r
               ON r.tenant_id = ri.tenant_id
              AND r.code = ri.source_code
       INNER JOIN report_release rr
               ON rr.tenant_id = ri.tenant_id
              AND rr.report_code = ri.source_code
              AND rr.version = ri.source_version
              AND rr.status = 'published'
      WHERE ri.asset_type IN ('report', 'template')
        AND ri.status = 'published'
        AND r.deleted_at IS NULL
        AND LOWER(ri.source_code) = LOWER(?)
        ${versionFilter}
      ORDER BY ri.published_at DESC, ri.updated_at DESC, ri.id DESC
      LIMIT 1`,
    values,
  ));

  const row = rows[0];
  if (!row) return null;
  return {
    tenantId: Number(row.tenant_id),
    assetType: row.asset_type === "template" ? "template" as const : "report" as const,
    reportCode: row.source_code,
    version: Number(row.source_version),
  };
}

export async function getPublishedResourceThumbnailTarget(reportCode: string, version: number) {
  return getPublishedResourceReportTarget(reportCode, version);
}

export async function incrementPublishedResourceView(input: { tenantId: number; assetType: "report" | "template"; reportCode: string }) {
  const [result] = await withDatabaseReadRetry(() => getDbPool().execute<ResultSetHeader>(
    `UPDATE resource_item
        SET view_count = COALESCE(view_count, 0) + 1,
            updated_at = updated_at
      WHERE tenant_id = ?
        AND asset_type = ?
        AND source_code = ?
        AND status = 'published'`,
    [input.tenantId, input.assetType, input.reportCode],
  ));
  return result.affectedRows > 0;
}

export async function getReportResourcePublicationState(tenantId: number, reportCode: string) {
  const [rows] = await withDatabaseReadRetry(() => getDbPool().query<ReportPublicationRow[]>(
    `SELECT r.current_release_version,
            r.working_commit_hash,
            (
              SELECT rr.source_commit_hash
                FROM report_release rr
               WHERE rr.tenant_id = r.tenant_id
                 AND rr.report_code = r.code
                 AND rr.version = r.current_release_version
                 AND rr.status = 'published'
               ORDER BY rr.id DESC
               LIMIT 1
            ) AS published_commit_hash,
            r.status
       FROM tenant_report r
      WHERE r.tenant_id = ? AND r.code = ? AND r.deleted_at IS NULL
      LIMIT 1`,
    [tenantId, reportCode],
  ));

  const row = rows[0];
  if (!row) return null;
  return {
    currentReleaseVersion: row.current_release_version == null ? null : Number(row.current_release_version),
    workingCommitHash: optionalText(row.working_commit_hash),
    publishedCommitHash: optionalText(row.published_commit_hash),
    status: row.status,
  };
}

export async function upsertResourceItem(input: {
  tenantId: number;
  userId: number;
  assetType: ResourceAssetType;
  sourceCode: string;
  sourceVersion: number;
  title: string;
  summary?: string | null;
  thumbnailUrl?: string | null;
  categoryId?: number | null;
}) {
  const title = input.title.trim().slice(0, 160);
  if (!title) throw new Error("资源标题不能为空");

  const summary = optionalText(input.summary)?.slice(0, 500) || null;
  const thumbnailUrl = optionalText(input.thumbnailUrl)?.slice(0, 500) || null;
  const categoryId = Number.isInteger(input.categoryId) ? Number(input.categoryId) : null;
  const connection = await getDbPool().getConnection();

  try {
    await connection.beginTransaction();
    const [reportRows] = await connection.query<Array<RowDataPacket & { id: number }>>(
      "SELECT id FROM tenant_report WHERE tenant_id = ? AND code = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE",
      [input.tenantId, input.sourceCode],
    );
    if (!reportRows[0]) throw new Error("报表不存在");

    if (categoryId != null) {
      const [categoryRows] = await connection.query<Array<RowDataPacket & { id: number }>>(
        "SELECT id FROM resource_category WHERE id = ? AND asset_type = ? AND enabled = 1 LIMIT 1",
        [categoryId, input.assetType],
      );
      if (!categoryRows[0]) throw new Error("资源分类不存在");
    }

    if (input.assetType === "report" || input.assetType === "template") {
      const previousAssetType = input.assetType === "report" ? "template" : "report";
      const resourceKey = [input.tenantId, previousAssetType, input.sourceCode];
      await connection.execute(
        "DELETE FROM resource_favorite WHERE tenant_id = ? AND asset_type = ? AND LOWER(source_code) = LOWER(?)",
        resourceKey,
      );
      await connection.execute(
        "DELETE FROM resource_like WHERE tenant_id = ? AND asset_type = ? AND LOWER(source_code) = LOWER(?)",
        resourceKey,
      );
      await connection.execute(
        "DELETE FROM resource_item WHERE tenant_id = ? AND asset_type = ? AND LOWER(source_code) = LOWER(?)",
        resourceKey,
      );
    }

    await connection.execute<ResultSetHeader>(
      `INSERT INTO resource_item
        (tenant_id, asset_type, source_code, source_version, status, title, summary, thumbnail_url, category_id, view_count, favorite_count, like_count, content_updated_at, submitted_by, submitted_at, published_by, published_at)
       VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, 0, 0, 0, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         source_version = VALUES(source_version),
         status = 'published',
         title = VALUES(title),
         summary = VALUES(summary),
         thumbnail_url = VALUES(thumbnail_url),
         category_id = VALUES(category_id),
         content_updated_at = CURRENT_TIMESTAMP,
         submitted_by = VALUES(submitted_by),
         submitted_at = VALUES(submitted_at),
         published_by = VALUES(published_by),
         published_at = VALUES(published_at),
         updated_at = CURRENT_TIMESTAMP`,
      [
        input.tenantId,
        input.assetType,
        input.sourceCode,
        input.sourceVersion,
        title,
        summary,
        thumbnailUrl,
        categoryId,
        input.userId,
        input.userId,
      ],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return getResourceItemBySource(input.tenantId, input.assetType, input.sourceCode);
}

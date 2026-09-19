import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { getDbPool } from "@/lib/server/mysql";

const ASSET_TYPE = "report";

type FavoriteRow = RowDataPacket & { source_code: string };
type ResourceRow = RowDataPacket & { tenant_id: number; source_code: string; favorite_count: number | string | null };

async function getResource(code: string) {
  const [rows] = await getDbPool().query<ResourceRow[]>(
    "SELECT tenant_id, source_code, favorite_count FROM resource_item WHERE asset_type = ? AND source_code = ? AND status = 'published' ORDER BY published_at DESC, updated_at DESC, id DESC LIMIT 1",
    [ASSET_TYPE, code],
  );
  return rows[0] || null;
}

export async function getFavoriteState(userId: number, code: string) {
  const resource = await getResource(code);
  if (!resource) return null;
  const [rows] = await getDbPool().query<FavoriteRow[]>(
    "SELECT source_code FROM resource_favorite WHERE tenant_id = ? AND user_id = ? AND asset_type = ? AND source_code = ? LIMIT 1",
    [resource.tenant_id, userId, ASSET_TYPE, resource.source_code],
  );
  return { code: resource.source_code, favorited: rows.length > 0, favoriteCount: Number(resource.favorite_count || 0) };
}

export async function favoriteResource(userId: number, code: string) {
  const resource = await getResource(code);
  if (!resource) return null;
  const tenantId = resource.tenant_id;
  const [result] = await getDbPool().execute<ResultSetHeader>(
    "INSERT IGNORE INTO resource_favorite (tenant_id, user_id, asset_type, source_code) VALUES (?, ?, ?, ?)",
    [tenantId, userId, ASSET_TYPE, resource.source_code],
  );
  if (result.affectedRows > 0) {
    await getDbPool().execute("UPDATE resource_item SET favorite_count = COALESCE(favorite_count, 0) + 1, updated_at = updated_at WHERE tenant_id = ? AND asset_type = ? AND source_code = ?", [tenantId, ASSET_TYPE, resource.source_code]);
  }
  return { code: resource.source_code, favorited: true, favoriteCount: await getFavoriteCount(tenantId, resource.source_code) };
}

export async function unfavoriteResource(userId: number, code: string) {
  const resource = await getResource(code);
  if (!resource) return null;
  const tenantId = resource.tenant_id;
  const [result] = await getDbPool().execute<ResultSetHeader>("DELETE FROM resource_favorite WHERE tenant_id = ? AND user_id = ? AND asset_type = ? AND source_code = ?", [tenantId, userId, ASSET_TYPE, resource.source_code]);
  if (result.affectedRows > 0) await getDbPool().execute("UPDATE resource_item SET favorite_count = CASE WHEN favorite_count > 0 THEN favorite_count - 1 ELSE 0 END, updated_at = updated_at WHERE tenant_id = ? AND asset_type = ? AND source_code = ?", [tenantId, ASSET_TYPE, resource.source_code]);
  return { code: resource.source_code, favorited: false, favoriteCount: await getFavoriteCount(tenantId, resource.source_code) };
}

async function getFavoriteCount(tenantId: number, sourceCode: string) {
  const [rows] = await getDbPool().query<Array<RowDataPacket & { favorite_count: number | string | null }>>(
    "SELECT favorite_count FROM resource_item WHERE tenant_id = ? AND asset_type = ? AND source_code = ? AND status = 'published' LIMIT 1",
    [tenantId, ASSET_TYPE, sourceCode],
  );
  return Number(rows[0]?.favorite_count || 0);
}

export async function listMyFavorites(userId: number) {
  const [rows] = await getDbPool().query<Array<FavoriteRow & { title: string; summary: string | null; created_at: string }>>(
    `SELECT f.source_code, ri.title, ri.summary, f.created_at
       FROM resource_favorite f INNER JOIN resource_item ri ON ri.tenant_id = f.tenant_id AND ri.asset_type = f.asset_type AND ri.source_code = f.source_code
      WHERE f.user_id = ? ORDER BY f.created_at DESC`, [userId],
  );
  return rows.map((row) => ({ code: row.source_code, title: row.title, summary: row.summary, createdAt: row.created_at }));
}

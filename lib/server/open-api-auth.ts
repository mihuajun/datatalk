import { authenticateOAuthToken } from "@/lib/server/studio-oauth";
import { randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { API_SCOPES, type ApiKeyView, type ApiScope } from "@/lib/open-api-contract";
import { normalizeUserRole, type AuthSession } from "@/lib/server/auth-session";
import { getDbPool } from "@/lib/server/mysql";
import { ensureOpenApiSchema } from "@/lib/server/open-api-schema";

export class OpenApiError extends Error {
  constructor(public code: string, public status: number, message: string, public details?: unknown) { super(message); }
}
type KeyRow = RowDataPacket & { id: number; name: string; prefix: string; api_key: string; created_at: string; last_used_at: string | null };
export type ApiPrincipal = AuthSession & { keyId: number; oauthGrantId?: string; scopes: ApiScope[] };
function view(row: KeyRow): ApiKeyView {
  return { id: Number(row.id), name: row.name, prefix: row.prefix,
    createdAt: row.created_at, lastUsedAt: row.last_used_at };
}
export async function listApiKeys(session: AuthSession) {
  await ensureOpenApiSchema();
  const [rows] = await getDbPool().query<KeyRow[]>("SELECT id, name, prefix, created_at, last_used_at FROM studio_api_key WHERE tenant_id=? AND user_id=? ORDER BY id DESC", [session.tenantId, session.userId]);
  return rows.map(view);
}
export async function createApiKey(session: AuthSession, input: { name?: unknown }) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 100 || Object.keys(input).some(field => field !== "name")) throw new OpenApiError("INVALID_KEY_CONFIG", 400, "创建 Key 只需填写名称（最多 100 字）");
  await ensureOpenApiSchema();
  const secret = `dtk_${randomBytes(16).toString("base64url")}`;
  const createdAt = new Date().toISOString();
  const [result] = await getDbPool().execute("INSERT INTO studio_api_key (tenant_id,user_id,name,prefix,api_key,created_at) VALUES (?,?,?,?,?,?)",
    [session.tenantId, session.userId, name, secret.slice(0, 12), secret, createdAt]);
  return { secret, key: { id: Number((result as { insertId: number }).insertId), name, prefix: secret.slice(0, 12), createdAt, lastUsedAt: null } satisfies ApiKeyView };
}
export async function readApiKeySecret(session: AuthSession, id: number) {
  await ensureOpenApiSchema();
  const [rows] = await getDbPool().query<KeyRow[]>("SELECT api_key FROM studio_api_key WHERE id=? AND tenant_id=? AND user_id=?", [id, session.tenantId, session.userId]);
  if (!rows[0]) throw new OpenApiError("KEY_NOT_FOUND", 404, "API Key 不存在");
  return rows[0].api_key;
}
export async function deleteApiKey(session: AuthSession, id: number) {
  await ensureOpenApiSchema();
  const [result] = await getDbPool().execute("DELETE FROM studio_api_key WHERE id=? AND tenant_id=? AND user_id=?", [id, session.tenantId, session.userId]);
  if (!(result as { affectedRows: number }).affectedRows) throw new OpenApiError("KEY_NOT_FOUND", 404, "Key 不存在");
}
export async function authenticateApiRequest(request: Request): Promise<ApiPrincipal> {
  const bearer = /^Bearer (\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (bearer?.startsWith("dtat_")) {
    const principal = await authenticateOAuthToken(bearer);
    if (!principal) throw new OpenApiError("INVALID_ACCESS_TOKEN", 401, "云端授权已失效，请重新连接");
    return principal;
  }
  const key = /^Bearer (dtk_(?:[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{43}))$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!key) throw new OpenApiError("INVALID_API_KEY", 401, "请使用 Studio API Key 进行连接");
  await ensureOpenApiSchema();
  const [rows] = await getDbPool().query<Array<KeyRow & { tenant_id: number; user_id: number; username: string; user_name: string; role: string; user_status: number; tenant_status: number }>>(
    `SELECT k.*, u.username, u.name AS user_name, u.role, u.status AS user_status, t.status AS tenant_status
     FROM studio_api_key k JOIN tenant_user u ON u.id=k.user_id AND u.tenant_id=k.tenant_id
     JOIN tenant t ON t.id=k.tenant_id WHERE k.api_key=? LIMIT 1`, [key]);
  const row = rows[0];
  if (!row || !Number(row.user_status) || !Number(row.tenant_status)) throw new OpenApiError("INVALID_API_KEY", 401, "Key 不可用或账号不可用");
  // Studio currently grants all three active roles tenant-wide report/data access.
  // Re-evaluate the live role here, rather than trusting a role captured at key creation.
  const role = normalizeUserRole(row.role);
  if (!["administrator", "admin", "developer"].includes(row.role)) throw new OpenApiError("FORBIDDEN", 403, "当前角色不可访问开放接口");
  await getDbPool().execute("UPDATE studio_api_key SET last_used_at=? WHERE id=?", [new Date().toISOString(), row.id]);
  return { keyId: Number(row.id), tenantId: Number(row.tenant_id), userId: Number(row.user_id), username: row.username, name: row.user_name, role, scopes: [...API_SCOPES] };
}
export function requireApiScope(principal: ApiPrincipal, scope: ApiScope) {
  if (!principal.scopes.includes(scope)) throw new OpenApiError("FORBIDDEN", 403, `此 Key 缺少权限 ${scope}`);
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new OpenApiError("FORBIDDEN_ORIGIN", 403, "不允许跨站访问"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.host !== (request.headers.get("host") || new URL(request.url).host)) throw new OpenApiError("FORBIDDEN_ORIGIN", 403, "不允许跨站访问");
}
export function apiBaseUrl(request: Request) {
  const url = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto");
  return `${protocol === "https" ? "https:" : url.protocol}//${request.headers.get("host") || url.host}`;
}
export async function readApiJson(request: Request) {
  const limit = 2 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new OpenApiError("BODY_TOO_LARGE", 413, "请求不能超过 2 MB");
  const reader = request.body?.getReader();
  if (!reader) throw new OpenApiError("INVALID_JSON", 400, "请求需要 JSON 内容");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new OpenApiError("BODY_TOO_LARGE", 413, "请求不能超过 2 MB"); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new OpenApiError("INVALID_JSON", 400, "请求内容不是有效 JSON"); }
}
export function apiErrorResponse(error: unknown) {
  const value = error instanceof OpenApiError ? error : new OpenApiError("INTERNAL_ERROR", 500, "服务暂时不可用，请重试");
  if (!(error instanceof OpenApiError)) console.error("Open API failed", error instanceof Error ? error.name : "unknown");
  return Response.json({ error: { code: value.code, message: value.message, ...(value.details ? { details: value.details } : {}) } }, { status: value.status, headers: { "Cache-Control": "no-store" } });
}

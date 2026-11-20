import { createHash, randomBytes } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/server/mysql";
import { ensureConnectionSchema } from "@/lib/server/studio-connection-schema";
import { normalizeUserRole, type AuthSession } from "@/lib/server/auth-session";
import { API_SCOPES } from "@/lib/open-api-contract";
import type { ApiPrincipal } from "@/lib/server/open-api-auth";
import { readAppConfig, readOptionalStringConfigValue } from "@/lib/server/app-config";

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export const hashCredential = (value: string) => createHash("sha256").update(value).digest("hex");
const random = () => randomBytes(32).toString("base64url");
const now = () => Date.now();
export function studioOrigin(requestUrl?: string) {
  const configured = process.env.STUDIO_PUBLIC_URL?.trim() || readOptionalStringConfigValue(readAppConfig()?.site?.studioPublicUrl);
  let url: URL;
  try { url = new URL(configured || requestUrl || "http://127.0.0.1:3010"); }
  catch { throw new OAuthError("server_error", "请配置 HTTPS 的 STUDIO_PUBLIC_URL 或 site.studioPublicUrl（不包含路径）", 503); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!configured && (!local || process.env.NODE_ENV === "production")) || (url.protocol !== "https:" && !(local && process.env.NODE_ENV !== "production" && url.protocol === "http:")) || url.username || url.password || (configured && (url.search || url.hash || url.pathname !== "/"))) {
    throw new OAuthError("server_error", "请配置 HTTPS 的 STUDIO_PUBLIC_URL 或 site.studioPublicUrl（不包含路径）", 503);
  }
  return url.origin;
}
export function studioRequestOrigin(request: Request) {
  const url = new URL(request.url);
  return studioOrigin(`${url.protocol}//${request.headers.get("host") || url.host}`);
}
export function oauthMetadata(origin: string) {
  return { issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`, registration_endpoint: `${origin}/oauth/register`, revocation_endpoint: `${origin}/oauth/revoke`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: ["studio"], authorization_response_iss_parameter_supported: true };
}
export function oauthErrorResponse(error: unknown) {
  const e = error instanceof OAuthError ? error : new OAuthError("server_error", "授权服务暂时不可用", 500);
  if (!(error instanceof OAuthError)) console.error("Studio OAuth failed", error instanceof Error ? error.name : "unknown");
  return Response.json({ error: e.code, error_description: e.message }, { status: e.status, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } });
}
export async function readOAuthBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 16384) throw new OAuthError("invalid_request", "请求过大", 413);
  const reader = request.body?.getReader(); let size = 0; const parts: Uint8Array[] = [];
  if (reader) for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 16384) { await reader.cancel(); throw new OAuthError("invalid_request", "请求过大", 413); } parts.push(part.value); }
  const raw = Buffer.concat(parts).toString("utf8");
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = JSON.parse(raw); if (!body || Array.isArray(body) || typeof body !== "object") throw new Error(); return body as Record<string, unknown>;
    }
    const params = new URLSearchParams(raw); rejectDuplicates(params); return Object.fromEntries(params);
  } catch (e) { if (e instanceof OAuthError) throw e; throw new OAuthError("invalid_request", "请求格式无效"); }
}
function rejectDuplicates(params: URLSearchParams) {
  for (const key of new Set(params.keys())) if (params.getAll(key).length !== 1) throw new OAuthError("invalid_request", "授权参数不能重复");
}
function validRedirect(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const u = new URL(value);
    if (u.hash || u.username || u.password) return false;
    if (u.protocol === "workbuddy:") return u.hostname === "workbuddy" && /^\/mcp\/[^/]+\/oauth\/callback$/.test(u.pathname) && !u.search;
    if (u.protocol === "http:") return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && !!u.port && u.pathname === "/oauth/callback" && !u.search;
    return u.protocol === "https:";
  } catch { return false; }
}
type ClientRow = RowDataPacket & { id: string; name: string; redirect_uris: string };
function oauthClientDisplayName(name: string) {
  const trimmed = name.trim();
  return /^(?:workbuddy|workbuddy connector)$/i.test(trimmed) ? "WorkBuddy" : trimmed || "未命名应用";
}
export async function registerOAuthClient(body: Record<string, unknown>) {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(validRedirect)) throw new OAuthError("invalid_redirect_uri", "回调地址必须是 HTTPS、WorkBuddy 回调或本机 loopback 回调");
  if ((body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") || (body.grant_types && (!Array.isArray(body.grant_types) || !body.grant_types.every(v => ["authorization_code", "refresh_token"].includes(v)))) || (body.response_types && (!Array.isArray(body.response_types) || body.response_types.length !== 1 || body.response_types[0] !== "code"))) throw new OAuthError("invalid_client_metadata", "仅支持公共客户端的授权码与刷新令牌流程");
  if (body.scope && body.scope !== "studio") throw new OAuthError("invalid_scope", "仅支持 studio scope");
  const name = typeof body.client_name === "string" ? body.client_name.trim() : "未命名应用";
  if (!name || name.length > 100) throw new OAuthError("invalid_client_metadata", "客户端名称长度应为 1–100 字");
  await ensureConnectionSchema();
  const id = random();
  await getDbPool().execute("INSERT INTO studio_oauth_client (id,name,redirect_uris,created_at) VALUES (?,?,?,?)", [id, name, JSON.stringify(uris), now()]);
  return { client_id: id, client_name: name, redirect_uris: uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "studio", client_id_issued_at: Math.floor(now()/1000) };
}
export async function validateAuthorization(params: URLSearchParams, origin: string) {
  rejectDuplicates(params);
  await ensureConnectionSchema();
  const [clients] = await getDbPool().query<ClientRow[]>("SELECT * FROM studio_oauth_client WHERE id=?", [params.get("client_id") || ""]);
  const client = clients[0];
  const redirectUri = params.get("redirect_uri") || "";
  if (!client || !(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) throw new OAuthError("invalid_request", "客户端或回调地址不匹配");
  if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") || "")) throw new OAuthError("invalid_request", "必须使用授权码和 PKCE S256");
  if (params.get("scope") && params.get("scope") !== "studio") throw new OAuthError("invalid_scope", "仅支持 studio scope");
  if (!params.get("state") || params.get("state")!.length > 2048) throw new OAuthError("invalid_request", "缺少有效 state");
  const resource = params.get("resource") || `${origin}/api/mcp`;
  if (resource !== `${origin}/api/mcp`) throw new OAuthError("invalid_target", "资源地址不匹配");
  return { clientId: client.id, clientName: oauthClientDisplayName(client.name), redirectUri, challenge: params.get("code_challenge")!, resource, state: params.get("state")!, issuer: origin };
}
type Authorization = Awaited<ReturnType<typeof validateAuthorization>>;
export async function createConsentRequest(auth: Authorization, session: AuthSession) {
  const id = random();
  await getDbPool().execute("INSERT INTO studio_oauth_request (id,tenant_id,user_id,params_json,expires_at) VALUES (?,?,?,?,?)", [id, session.tenantId, session.userId, JSON.stringify(auth), now()+600000]);
  return id;
}
export async function resolveConsent(id: string, session: AuthSession, approve: boolean) {
  await ensureConnectionSchema();
  const conn = await getDbPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<Array<RowDataPacket & { params_json: string; expires_at: number }>>("SELECT params_json,expires_at FROM studio_oauth_request WHERE id=? AND tenant_id=? AND user_id=? FOR UPDATE", [id, session.tenantId, session.userId]);
    if (!rows[0] || Number(rows[0].expires_at) <= now()) throw new OAuthError("invalid_request", "授权页面已过期，请从来源应用重新连接");
    const auth = JSON.parse(rows[0].params_json) as Authorization;
    await liveIdentity(conn, session.tenantId, session.userId);
    await conn.execute("DELETE FROM studio_oauth_request WHERE id=?", [id]);
    const url = new URL(auth.redirectUri); url.searchParams.set("state", auth.state); url.searchParams.set("iss", auth.issuer);
    if (approve) {
      const grantId = random(); const code = random();
      await conn.execute("INSERT INTO studio_oauth_grant (id,client_id,tenant_id,user_id,resource,redirect_uri,challenge,created_at) VALUES (?,?,?,?,?,?,?,?)", [grantId, auth.clientId, session.tenantId, session.userId, auth.resource, auth.redirectUri, auth.challenge, now()]);
      await conn.execute("INSERT INTO studio_oauth_token (token_hash,grant_id,kind,expires_at) VALUES (?,?,?,?)", [hashCredential(code), grantId, "code", now()+120000]);
      url.searchParams.set("code", code);
    } else url.searchParams.set("error", "access_denied");
    await conn.commit(); return url.toString();
  } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
}
type Grant = RowDataPacket & { id: string; client_id: string; tenant_id: number; user_id: number; resource: string; redirect_uri: string; challenge: string; revoked_at: number | null };
async function liveIdentity(db: Pick<PoolConnection, "query">, tenantId: number, userId: number): Promise<AuthSession> {
  const [rows] = await db.query<Array<RowDataPacket & { username: string; name: string; role: string; status: number; tenant_status: number }>>("SELECT u.username,u.name,u.role,u.status,t.status AS tenant_status FROM tenant_user u JOIN tenant t ON t.id=u.tenant_id WHERE u.id=? AND u.tenant_id=?", [userId, tenantId]);
  const u = rows[0];
  if (!u || !Number(u.status) || !Number(u.tenant_status) || !["administrator", "admin", "developer"].includes(u.role)) throw new OAuthError("invalid_grant", "授权账号不可用", 401);
  return { tenantId: Number(tenantId), userId: Number(userId), username: u.username, name: u.name, role: normalizeUserRole(u.role) };
}
export async function exchangeOAuthToken(body: Record<string, unknown>, origin: string) {
  if (!["authorization_code", "refresh_token"].includes(String(body.grant_type))) throw new OAuthError("unsupported_grant_type", "不支持此授权类型");
  if (body.client_secret) throw new OAuthError("invalid_client", "公共客户端不使用 client_secret");
  const refresh = body.grant_type === "refresh_token";
  const credential = refresh ? body.refresh_token : body.code;
  if (typeof credential !== "string" || credential.length > 128 || typeof body.client_id !== "string") throw new OAuthError("invalid_grant", "凭证格式无效");
  if (body.scope && body.scope !== "studio") throw new OAuthError("invalid_scope", "仅支持 studio scope");
  await ensureConnectionSchema();
  const conn = await getDbPool().getConnection();
  try {
    await conn.beginTransaction();
    // Lock the grant first so exchanges, refresh rotation and revocation serialize together.
    const [lookup] = await conn.query<Array<RowDataPacket & { grant_id: string }>>("SELECT grant_id FROM studio_oauth_token WHERE token_hash=?", [hashCredential(credential)]);
    if (!lookup[0]) throw new OAuthError("invalid_grant", "凭证无效或已过期");
    const [grants] = await conn.query<Grant[]>("SELECT * FROM studio_oauth_grant WHERE id=? FOR UPDATE", [lookup[0].grant_id]);
    const grant = grants[0];
    if (!grant || grant.revoked_at || grant.client_id !== body.client_id || grant.resource !== `${origin}/api/mcp` || (body.resource && body.resource !== grant.resource)) throw new OAuthError("invalid_grant", "凭证与客户端或资源不匹配");
    const [tokens] = await conn.query<Array<RowDataPacket & { kind: string; expires_at: number; consumed_at: number | null }>>("SELECT kind,expires_at,consumed_at FROM studio_oauth_token WHERE token_hash=? FOR UPDATE", [hashCredential(credential)]);
    const token = tokens[0];
    if (!token || token.kind !== (refresh ? "refresh" : "code") || Number(token.expires_at) <= now()) throw new OAuthError("invalid_grant", "凭证无效或已过期");
    if (!refresh) {
      if (body.redirect_uri !== grant.redirect_uri || typeof body.code_verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier) || createHash("sha256").update(body.code_verifier).digest("base64url") !== grant.challenge) throw new OAuthError("invalid_grant", "回调地址或 PKCE 校验失败");
    }
    if (token.consumed_at) {
      await conn.execute("UPDATE studio_oauth_grant SET revoked_at=? WHERE id=?", [now(), grant.id]);
      await conn.commit(); throw new OAuthError("invalid_grant", "凭证已使用，此次授权已终止，请重新连接");
    }
    await liveIdentity(conn, grant.tenant_id, grant.user_id);
    await conn.execute("UPDATE studio_oauth_token SET consumed_at=? WHERE token_hash=?", [now(), hashCredential(credential)]);
    const access = `dtat_${random()}`, nextRefresh = `dtrt_${random()}`;
    await conn.execute("INSERT INTO studio_oauth_token (token_hash,grant_id,kind,expires_at) VALUES (?,?,?,?),(?,?,?,?)", [hashCredential(access), grant.id, "access", now()+3600000, hashCredential(nextRefresh), grant.id, "refresh", now()+30*86400000]);
    await conn.commit();
    return { access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: nextRefresh, scope: "studio" };
  } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
}
export async function oauthGrantIdentity(grantId: string): Promise<ApiPrincipal | null> {
  await ensureConnectionSchema();
  const [rows] = await getDbPool().query<Grant[]>("SELECT * FROM studio_oauth_grant WHERE id=? AND revoked_at IS NULL", [grantId]);
  if (!rows[0]) return null;
  try { return { ...await liveIdentity(getDbPool(), rows[0].tenant_id, rows[0].user_id), keyId: 0, oauthGrantId: grantId, scopes: [...API_SCOPES] }; } catch { return null; }
}
export async function authenticateOAuthToken(token: string): Promise<ApiPrincipal | null> {
  if (!/^dtat_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  await ensureConnectionSchema();
  const [rows] = await getDbPool().query<Array<RowDataPacket & { grant_id: string }>>("SELECT grant_id FROM studio_oauth_token WHERE token_hash=? AND kind='access' AND expires_at>?", [hashCredential(token), now()]);
  return rows[0] ? oauthGrantIdentity(rows[0].grant_id) : null;
}
export async function revokeOAuthToken(body: Record<string, unknown>) {
  if (typeof body.token !== "string" || typeof body.client_id !== "string") throw new OAuthError("invalid_request", "缺少 token 或 client_id");
  await ensureConnectionSchema();
  const [rows] = await getDbPool().query<Array<RowDataPacket & { grant_id: string }>>("SELECT grant_id FROM studio_oauth_token WHERE token_hash=? AND kind IN ('access','refresh')", [hashCredential(body.token)]);
  if (rows[0]) await getDbPool().execute("UPDATE studio_oauth_grant SET revoked_at=? WHERE id=? AND client_id=?", [now(), rows[0].grant_id, body.client_id]);
}
export async function listOAuthGrants(session: AuthSession) {
  await ensureConnectionSchema();
  const [rows] = await getDbPool().query<Array<RowDataPacket & { id: string; name: string; resource: string; created_at: number }>>("SELECT g.id,c.name,g.resource,g.created_at FROM studio_oauth_grant g JOIN studio_oauth_client c ON c.id=g.client_id WHERE g.tenant_id=? AND g.user_id=? AND g.revoked_at IS NULL AND EXISTS (SELECT 1 FROM studio_oauth_token t WHERE t.grant_id=g.id AND t.kind='refresh' AND t.consumed_at IS NULL AND t.expires_at>?) ORDER BY g.created_at DESC", [session.tenantId, session.userId, now()]);
  return rows.map(r => ({ id: r.id, name: oauthClientDisplayName(r.name), resource: r.resource, createdAt: new Date(Number(r.created_at)).toISOString() }));
}
export async function revokeOAuthGrant(session: AuthSession, id: string) {
  await ensureConnectionSchema();
  await getDbPool().execute("UPDATE studio_oauth_grant SET revoked_at=? WHERE id=? AND tenant_id=? AND user_id=?", [now(), id, session.tenantId, session.userId]);
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import type { AuthSession } from "@/lib/server/auth-session";
import { getDatabaseConfig } from "@/lib/server/database-config";
import { getDbPool } from "@/lib/server/mysql";
import { grantSignupConversationQuota } from "@/lib/server/conversation-quota";
import { ensureWorkspaceStorageLayout, RUNTIME_STORAGE_ROOT } from "@/lib/server/workspace-storage";
import { OAuthError } from "@/lib/server/studio-oauth";
import { normalizeAvatar } from "@/lib/avatar";
import { readAppConfig, readOptionalStringConfigValue } from "@/lib/server/app-config";
import { isRegistrationEnabled } from "@/lib/server/auth-config";
import { safeReturnTo } from "@/lib/server/safe-return-to";
import { normalizeUserRole } from "@/lib/auth/roles";
import { isGitHubConfigured } from "@/lib/server/github-auth";
import { isGoogleConfigured } from "@/lib/server/google-auth";

// WorkBuddy is the authorization server here. Studio's MCP OAuth is a separate protocol role.
export const WORKBUDDY_CALLBACK_PATH = "/api/integrations/workbuddy/callback";
export const WORKBUDDY_STATE_COOKIE = "studio-workbuddy-state";
export const WORKBUDDY_LOGIN_COOKIE = "studio-workbuddy-login";
const PROVIDER = "https://www.workbuddy.cn";
const SCOPE = "user.profile.readable";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const random = () => randomBytes(32).toString("base64url");
type Identity = Pick<AuthSession, "tenantId" | "userId">;
type ProviderFetch = typeof fetch;
type Connection = Awaited<ReturnType<ReturnType<typeof getDbPool>["getConnection"]>>;
type Binding = RowDataPacket & {
  tenant_id: number; user_id: number; client_id: string; open_id: string;
  nickname: string; scope: string; token_cipher: string; expires_at: number;
  needs_reauth: number; updated_at: number;
};

function configuration() {
  const config = readAppConfig(process.env.STUDIO_WORKBUDDY_CONFIG_PATH)?.auth?.workbuddy;
  const clientId = process.env.WORKBUDDY_CLIENT_ID?.trim() || readOptionalStringConfigValue(config?.clientId);
  const secretFile = process.env.WORKBUDDY_CLIENT_SECRET_FILE?.trim();
  let clientSecret = process.env.WORKBUDDY_CLIENT_SECRET?.trim() || "";
  if (!clientSecret && secretFile && fs.existsSync(/*turbopackIgnore: true*/ secretFile)) clientSecret = fs.readFileSync(/*turbopackIgnore: true*/ secretFile, "utf8").trim();
  if (!clientSecret) clientSecret = readOptionalStringConfigValue(config?.clientSecret);
  if (!clientId || !clientSecret) throw new OAuthError("not_configured", "管理员尚未配置 WorkBuddy 应用凭据", 503);
  return { clientId, clientSecret };
}

export function isWorkBuddyLoginConfigured() {
  try {
    configuration();
    return isRegistrationEnabled();
  } catch { return false; }
}

function encryptionKey() {
  const configured = process.env.WORKBUDDY_TOKEN_ENCRYPTION_KEY?.trim();
  if (configured) {
    if (!/^[a-fA-F0-9]{64}$/.test(configured)) throw new OAuthError("server_error", "WorkBuddy 凭证存储配置无效", 503);
    return Buffer.from(configured, "hex");
  }
  ensureWorkspaceStorageLayout();
  const file = path.join(RUNTIME_STORAGE_ROOT, "workbuddy-token.key");
  try { fs.writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const key = fs.readFileSync(/*turbopackIgnore: true*/ file);
  if (key.length !== 32) throw new OAuthError("server_error", "WorkBuddy 凭证存储配置无效", 503);
  return key;
}
function context(session: Identity, clientId: string) { return `${session.tenantId}:${session.userId}:${clientId}`; }
function encrypt(value: unknown, aad: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url");
}
function decrypt(value: string, aad: string): { accessToken: string; refreshToken: string } {
  try {
    const bytes = Buffer.from(value, "base64url"), cipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8"));
  } catch { throw new OAuthError("credential_unavailable", "无法读取 WorkBuddy 凭证，请检查存储配置或重新绑定", 503); }
}

let ready: Promise<void> | undefined;
export function ensureWorkBuddySchema() {
  ready ??= (async () => {
    const suffix = getDatabaseConfig().kind === "sqlite" ? "" : " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin";
    for (const table of [
      `studio_workbuddy_request (state_hash varchar(64) PRIMARY KEY, browser_hash varchar(64) NOT NULL, tenant_id bigint NOT NULL, user_id bigint NOT NULL, client_id varchar(64) NOT NULL, redirect_uri varchar(2048) NOT NULL, expires_at bigint NOT NULL)`,
      `studio_workbuddy_login_request (state_hash varchar(64) PRIMARY KEY, browser_hash varchar(64) NOT NULL, client_id varchar(64) NOT NULL, redirect_uri varchar(2048) NOT NULL, return_to TEXT NOT NULL, expires_at bigint NOT NULL)`,
      `studio_workbuddy_binding (tenant_id bigint NOT NULL, user_id bigint NOT NULL, client_id varchar(64) NOT NULL, open_id varchar(255) NOT NULL, nickname varchar(255) NOT NULL, scope varchar(1000) NOT NULL, token_cipher MEDIUMTEXT NOT NULL, expires_at bigint NOT NULL, needs_reauth integer NOT NULL DEFAULT 0, updated_at bigint NOT NULL, PRIMARY KEY (tenant_id,user_id,client_id))`,
    ]) await getDbPool().query(`CREATE TABLE IF NOT EXISTS ${table}${suffix}`);
    if (getDatabaseConfig().kind === "sqlite") {
      await getDbPool().query("CREATE INDEX IF NOT EXISTS idx_workbuddy_open_identity ON studio_workbuddy_binding(client_id,open_id)");
    } else {
      const [indexes] = await getDbPool().query<RowDataPacket[]>("SHOW INDEX FROM studio_workbuddy_binding WHERE Key_name='idx_workbuddy_open_identity'");
      if (!indexes.length) {
        try { await getDbPool().query("CREATE INDEX idx_workbuddy_open_identity ON studio_workbuddy_binding(client_id,open_id)"); }
        catch (error) { if ((error as { code?: string }).code !== "ER_DUP_KEYNAME") throw error; }
      }
    }
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}

export async function workBuddyStatus(session: Identity) {
  let config;
  try { config = configuration(); }
  catch { return { configured: false, connected: false, needsReauth: false, nickname: "", scope: "", updatedAt: null }; }
  await ensureWorkBuddySchema();
  const [rows] = await getDbPool().query<Binding[]>("SELECT * FROM studio_workbuddy_binding WHERE tenant_id=? AND user_id=? AND client_id=?", [session.tenantId, session.userId, config.clientId]);
  const row = rows[0];
  return { configured: true, connected: !!row && !row.needs_reauth, needsReauth: !!row?.needs_reauth, nickname: row?.nickname || "", scope: row?.scope || "", updatedAt: row ? new Date(Number(row.updated_at)).toISOString() : null };
}

export async function beginWorkBuddyBinding(session: Identity, origin: string) {
  const { clientId } = configuration();
  encryptionKey(); // Fail before sending the user away if credentials cannot be stored.
  await ensureWorkBuddySchema();
  const state = random(), browserNonce = random(), redirectUri = `${origin}${WORKBUDDY_CALLBACK_PATH}`;
  await getDbPool().execute("DELETE FROM studio_workbuddy_request WHERE expires_at < ?", [Date.now()]);
  await getDbPool().execute("INSERT INTO studio_workbuddy_request (state_hash,browser_hash,tenant_id,user_id,client_id,redirect_uri,expires_at) VALUES (?,?,?,?,?,?,?)", [hash(state), hash(browserNonce), session.tenantId, session.userId, clientId, redirectUri, Date.now() + 600000]);
  const url = new URL("/openapi/v2/authorize", PROVIDER);
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: SCOPE, state }).toString();
  return { url: url.toString(), browserNonce };
}

// Do not echo upstream bodies: they may contain credentials or request parameters.
async function providerJson(url: string, init: RequestInit, providerFetch: ProviderFetch) {
  let response: Response;
  try { response = await providerFetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) }); }
  catch { throw new OAuthError("provider_unavailable", "WorkBuddy 暂时无法连接，请稍后重试", 502); }
  let raw = "";
  try {
    const reader = response.body?.getReader(); const parts: Uint8Array[] = []; let size = 0;
    if (reader) for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 65536) { await reader.cancel(); throw new Error(); } parts.push(chunk.value); }
    raw = Buffer.concat(parts).toString("utf8");
  } catch { throw new OAuthError("provider_unavailable", "WorkBuddy 返回无效响应", 502); }
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw); if (!data || Array.isArray(data) || typeof data !== "object") throw new Error(); }
  catch { throw new OAuthError("provider_unavailable", "WorkBuddy 返回无效响应", 502); }
  if (!response.ok || data.error) {
    const expired = data.error === "invalid_grant" || (response.status === 401 && data.error !== "invalid_client");
    throw new OAuthError(expired ? "reconnect_required" : "provider_unavailable", expired ? "WorkBuddy 授权已失效，请重新绑定" : "WorkBuddy 授权请求失败，请检查应用配置后重试", expired ? 401 : 502);
  }
  return data;
}

async function exchange(params: Record<string, string>, providerFetch: ProviderFetch, expectedOpenId?: string, previousRefresh?: string) {
  const config = configuration();
  const data = await providerJson(`${PROVIDER}/openapi/v2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ ...params, client_id: config.clientId, client_secret: config.clientSecret }) }, providerFetch);
  const accessToken = data.access_token, refreshToken = data.refresh_token ?? previousRefresh, openId = data.open_id;
  const scope = typeof data.scope === "string" ? data.scope : "";
  const expiresIn = data.expires_in;
  if (typeof accessToken !== "string" || !accessToken || accessToken.length > 16000 || typeof refreshToken !== "string" || !refreshToken || refreshToken.length > 16000 || typeof openId !== "string" || !openId || openId.length > 255 || (expectedOpenId && openId !== expectedOpenId) || typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn < 1 || expiresIn > 31536000 || typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" || scope !== SCOPE) {
    throw new OAuthError("invalid_token_response", "WorkBuddy 返回的账号或授权范围不匹配，请重新绑定", 502);
  }
  return { accessToken, refreshToken, openId, scope, expiresAt: Date.now() + expiresIn * 1000 };
}

// Keep the existing identity table's unique constraints authoritative. Never overwrite ownership.
function identityKey(clientId: string, openId: string) { return hash(JSON.stringify([clientId, openId])); }
function identityConflict() { return new OAuthError("identity_conflict", "此 WorkBuddy 身份存在其他账号关联，请使用原登录方式登录后处理绑定", 409); }
async function identityOwner(conn: Connection, clientId: string, openId: string) {
  const [identities] = await conn.query<Array<RowDataPacket & { user_id: number }>>("SELECT user_id FROM user_identity WHERE provider='workbuddy' AND provider_key=? FOR UPDATE", [identityKey(clientId, openId)]);
  // Upgrade unambiguous legacy bindings lazily, only after authenticating with WorkBuddy.
  const [legacy] = await conn.query<Array<RowDataPacket & { user_id: number }>>("SELECT user_id FROM studio_workbuddy_binding WHERE client_id=? AND open_id=? FOR UPDATE", [clientId, openId]);
  const owners = new Set([...identities, ...legacy].map(row => Number(row.user_id)));
  if (owners.size > 1) throw identityConflict();
  return [...owners][0];
}
async function claimIdentity(conn: Connection, userId: number, clientId: string, openId: string) {
  const key = identityKey(clientId, openId);
  const owner = await identityOwner(conn, clientId, openId);
  if (owner && owner !== userId) throw identityConflict();
  const [own] = await conn.query<Array<RowDataPacket & { provider_key: string }>>("SELECT provider_key FROM user_identity WHERE user_id=? AND provider='workbuddy' FOR UPDATE", [userId]);
  if (own[0]) { if (own[0].provider_key !== key) throw identityConflict(); return; }
  const [oldBindings] = await conn.query<Binding[]>("SELECT * FROM studio_workbuddy_binding WHERE user_id=? FOR UPDATE", [userId]);
  if (oldBindings.some(row => identityKey(row.client_id, row.open_id) !== key)) throw identityConflict();
  await conn.execute("INSERT INTO user_identity (user_id,provider,provider_key,verified_at) VALUES (?,'workbuddy',?,CURRENT_TIMESTAMP)", [userId, key]);
}
async function saveBinding(conn: Connection, session: Identity, clientId: string, tokens: Awaited<ReturnType<typeof exchange>>, nickname = "") {
  await conn.execute(`INSERT INTO studio_workbuddy_binding (tenant_id,user_id,client_id,open_id,nickname,scope,token_cipher,expires_at,needs_reauth,updated_at) VALUES (?,?,?,?,?,?,?,?,0,?) ON DUPLICATE KEY UPDATE open_id=VALUES(open_id),nickname=VALUES(nickname),scope=VALUES(scope),token_cipher=VALUES(token_cipher),expires_at=VALUES(expires_at),needs_reauth=0,updated_at=VALUES(updated_at)`, [session.tenantId, session.userId, clientId, tokens.openId, nickname, tokens.scope, encrypt(tokens, context(session, clientId)), tokens.expiresAt, Date.now()]);
}

export class WorkBuddyLoginError extends OAuthError {
  constructor(error: unknown, public readonly returnTo: string) {
    super(error instanceof OAuthError ? error.code : "login_failed", error instanceof OAuthError ? error.message : "WorkBuddy 登录未完成，请重试", error instanceof OAuthError ? error.status : 500);
  }
}

export function workBuddyReturnTo(value: unknown) {
  // URL parsers strip control characters; reject them before checking internal paths.
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) return "/reports";
  return safeReturnTo(value);
}

export async function beginWorkBuddyLogin(origin: string, returnTo?: string) {
  if (!isWorkBuddyLoginConfigured()) throw new OAuthError("not_configured", "WorkBuddy 登录暂未启用", 503);
  const { clientId } = configuration();
  encryptionKey();
  await ensureWorkBuddySchema();
  const state = `login.${random()}`, browserNonce = random(), redirectUri = `${origin}${WORKBUDDY_CALLBACK_PATH}`;
  const next = workBuddyReturnTo(returnTo);
  await getDbPool().execute("DELETE FROM studio_workbuddy_login_request WHERE expires_at < ?", [Date.now()]);
  await getDbPool().execute("INSERT INTO studio_workbuddy_login_request (state_hash,browser_hash,client_id,redirect_uri,return_to,expires_at) VALUES (?,?,?,?,?,?)", [hash(state), hash(browserNonce), clientId, redirectUri, next, Date.now() + 600000]);
  const url = new URL("/openapi/v2/authorize", PROVIDER);
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: SCOPE, state }).toString();
  return { url: url.toString(), browserNonce };
}

export async function finishWorkBuddyLogin(origin: string, params: URLSearchParams, browserNonce: string, providerFetch: ProviderFetch = fetch) {
  if (!isWorkBuddyLoginConfigured()) throw new OAuthError("not_configured", "WorkBuddy 登录暂未启用", 503);
  for (const name of params.keys()) if (params.getAll(name).length !== 1) throw new OAuthError("invalid_request", "回调参数重复");
  const state = params.get("state") || "", code = params.get("code") || "";
  if (!/^login\.[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browserNonce) || code.length > 4096) throw new OAuthError("invalid_state", "登录请求已失效，请重新发起");
  const { clientId } = configuration();
  await ensureWorkBuddySchema();
  // Consume state before the provider exchange. A failed exchange must not replay the code.
  const conn = await getDbPool().getConnection();
  let returnTo = "/reports";
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<Array<RowDataPacket & { expires_at: number; redirect_uri: string; return_to: string }>>("SELECT expires_at,redirect_uri,return_to FROM studio_workbuddy_login_request WHERE state_hash=? AND browser_hash=? AND client_id=? FOR UPDATE", [hash(state), hash(browserNonce), clientId]);
    const row = rows[0];
    if (!row || Number(row.expires_at) <= Date.now() || row.redirect_uri !== `${origin}${WORKBUDDY_CALLBACK_PATH}`) throw new OAuthError("invalid_state", "登录请求已过期或不属于当前浏览器，请重新发起");
    returnTo = workBuddyReturnTo(row.return_to);
    await conn.execute("DELETE FROM studio_workbuddy_login_request WHERE state_hash=?", [hash(state)]);
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
  try {
    if (params.has("error")) throw new OAuthError("access_denied", "已取消 WorkBuddy 登录");
    if (!code) throw new OAuthError("invalid_request", "WorkBuddy 回调缺少授权码");
    const tokens = await exchange({ grant_type: "authorization_code", code, redirect_uri: `${origin}${WORKBUDDY_CALLBACK_PATH}` }, providerFetch);
    const profile = await providerJson(`${PROVIDER}/openapi/v2/user/profile`, { headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" } }, providerFetch);
    if (typeof profile.nickname !== "string" || profile.nickname.length > 255) throw new OAuthError("invalid_provider_response", "WorkBuddy 返回的用户资料无效", 502);
    const normalized = normalizeAvatar(profile.avatar);
    const avatar = normalized?.startsWith("https://") ? normalized : null;
    const name = Array.from(profile.nickname.trim() || "WorkBuddy 用户").slice(0, 80).join("");
    // Retry only local transactional races, never the provider authorization-code exchange.
    for (let attempt = 0; attempt < 3; attempt++) {
      const account = await getDbPool().getConnection();
      try {
        await account.beginTransaction();
        let userId = await identityOwner(account, clientId, tokens.openId);
        if (!userId) {
          const suffix = randomBytes(16).toString("hex");
          const [tenant] = await account.execute("INSERT INTO tenant (code,name,status) VALUES (?,?,1)", [`personal-wb-${suffix}`, `${name} 的工作台`]);
          const tenantId = Number((tenant as { insertId: number }).insertId);
          const [user] = await account.execute("INSERT INTO tenant_user (tenant_id,name,username,avatar,phone,email,role,password,salt,status,last_active) VALUES (?,?,?,?,NULL,NULL,'developer','',NULL,1,CURRENT_TIMESTAMP)", [tenantId, name, `workbuddy-${suffix}`, avatar]);
          userId = Number((user as { insertId: number }).insertId);
          await grantSignupConversationQuota(account, tenantId);
        }
        const [users] = await account.query<Array<RowDataPacket & { id: number; tenant_id: number; username: string; name: string; role: string; status: number; tenant_status: number; avatar: string | null }>>("SELECT u.*,t.status AS tenant_status FROM tenant_user u JOIN tenant t ON t.id=u.tenant_id WHERE u.id=? FOR UPDATE", [userId]);
        const user = users[0];
        if (!user || Number(user.status) !== 1 || Number(user.tenant_status) !== 1) throw new OAuthError("account_disabled", "该账号或工作空间已停用，请联系管理员", 403);
        await claimIdentity(account, userId, clientId, tokens.openId);
        const session: AuthSession = { userId, tenantId: Number(user.tenant_id), username: user.username, name: user.name, role: normalizeUserRole(user.role), avatar: avatar || normalizeAvatar(user.avatar) };
        await saveBinding(account, session, clientId, tokens, profile.nickname);
        await account.execute("UPDATE tenant_user SET last_active=CURRENT_TIMESTAMP,avatar=COALESCE(?,avatar) WHERE id=?", [avatar, userId]);
        await account.commit();
        return { user: session, returnTo };
      } catch (error) {
        await account.rollback();
        if (attempt < 2 && ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes((error as { code?: string }).code || "")) continue;
        throw error;
      } finally { account.release(); }
    }
    throw identityConflict();
  } catch (error) { throw new WorkBuddyLoginError(error, returnTo); }
}

export async function finishWorkBuddyBinding(session: Identity, origin: string, params: URLSearchParams, browserNonce: string, providerFetch: ProviderFetch = fetch) {
  for (const name of params.keys()) if (params.getAll(name).length !== 1) throw new OAuthError("invalid_request", "回调参数重复");
  const state = params.get("state") || "", code = params.get("code") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browserNonce) || code.length > 4096) throw new OAuthError("invalid_state", "绑定请求已失效，请重新发起");
  const { clientId } = configuration();
  await ensureWorkBuddySchema();
  const conn = await getDbPool().getConnection();
  let consumed = false;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<Array<RowDataPacket & { expires_at: number; redirect_uri: string }>>("SELECT expires_at,redirect_uri FROM studio_workbuddy_request WHERE state_hash=? AND browser_hash=? AND tenant_id=? AND user_id=? AND client_id=? FOR UPDATE", [hash(state), hash(browserNonce), session.tenantId, session.userId, clientId]);
    const row = rows[0];
    if (!row || Number(row.expires_at) <= Date.now() || row.redirect_uri !== `${origin}${WORKBUDDY_CALLBACK_PATH}`) throw new OAuthError("invalid_state", "绑定请求已失效或账号已切换，请重新发起");
    await conn.execute("DELETE FROM studio_workbuddy_request WHERE state_hash=?", [hash(state)]);
    consumed = true;
    if (params.has("error")) throw new OAuthError("access_denied", "已取消 WorkBuddy 授权");
    if (!code) throw new OAuthError("invalid_request", "WorkBuddy 回调缺少授权码");
    const tokens = await exchange({ grant_type: "authorization_code", code, redirect_uri: row.redirect_uri }, providerFetch);
    await conn.query("SAVEPOINT workbuddy_identity");
    try {
      await claimIdentity(conn, session.userId, clientId, tokens.openId);
      // The transaction serializes callback completion with local unbinding.
      await saveBinding(conn, session, clientId, tokens);
    } catch (error) {
      // InnoDB may already have rolled back the whole transaction after a deadlock.
      try { await conn.query("ROLLBACK TO SAVEPOINT workbuddy_identity"); } catch { await conn.rollback(); }
      throw (error as { code?: string }).code === "ER_DUP_ENTRY" ? identityConflict() : error;
    }
    await conn.commit();
  } catch (error) {
    if (consumed) { try { await conn.commit(); } catch { await conn.rollback(); } }
    else await conn.rollback();
    throw error;
  } finally {
    conn.release();
    // Also consume the state when a database deadlock rolled back the transaction.
    if (consumed) await getDbPool().execute("DELETE FROM studio_workbuddy_request WHERE state_hash=?", [hash(state)]);
  }
}

export async function readWorkBuddyProfile(session: Identity, providerFetch: ProviderFetch = fetch) {
  const { clientId } = configuration();
  await ensureWorkBuddySchema();
  const conn = await getDbPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<Binding[]>("SELECT * FROM studio_workbuddy_binding WHERE tenant_id=? AND user_id=? AND client_id=? FOR UPDATE", [session.tenantId, session.userId, clientId]);
    const row = rows[0];
    if (!row || row.needs_reauth) throw new OAuthError("reconnect_required", "请先绑定 WorkBuddy 账号", 401);
    let tokens = decrypt(row.token_cipher, context(session, clientId));
    if (Number(row.expires_at) <= Date.now() + 60000) {
      const renewed = await exchange({ grant_type: "refresh_token", refresh_token: tokens.refreshToken }, providerFetch, row.open_id, tokens.refreshToken);
      tokens = renewed;
      await conn.execute("UPDATE studio_workbuddy_binding SET token_cipher=?,expires_at=?,updated_at=? WHERE tenant_id=? AND user_id=? AND client_id=?", [encrypt(tokens, context(session, clientId)), renewed.expiresAt, Date.now(), session.tenantId, session.userId, clientId]);
      // Persist a rotated refresh token even when the subsequent profile request fails.
    }
    const profile = await providerJson(`${PROVIDER}/openapi/v2/user/profile`, { headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" } }, providerFetch);
    if (typeof profile.nickname !== "string" || profile.nickname.length > 255) throw new OAuthError("invalid_provider_response", "WorkBuddy 返回的用户资料无效", 502);
    const avatar = normalizeAvatar(profile.avatar);
    if (avatar?.startsWith("https://")) await conn.execute("UPDATE tenant_user SET avatar=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?", [avatar, session.userId, session.tenantId]);
    await conn.execute("UPDATE studio_workbuddy_binding SET nickname=?,updated_at=? WHERE tenant_id=? AND user_id=? AND client_id=?", [profile.nickname, Date.now(), session.tenantId, session.userId, clientId]);
    await conn.commit();
    return { nickname: profile.nickname, avatar };
  } catch (error) {
    if (error instanceof OAuthError && ["reconnect_required", "invalid_token_response"].includes(error.code)) await conn.execute("UPDATE studio_workbuddy_binding SET needs_reauth=1,token_cipher='' WHERE tenant_id=? AND user_id=? AND client_id=?", [session.tenantId, session.userId, clientId]);
    await conn.commit();
    throw error;
  } finally { conn.release(); }
}

export async function disconnectWorkBuddy(session: Identity) {
  const { clientId } = configuration();
  await ensureWorkBuddySchema();
  const conn = await getDbPool().getConnection();
  try {
    await conn.beginTransaction();
    const [identities] = await conn.query<Array<RowDataPacket & { provider: string; provider_key: string }>>("SELECT provider,provider_key FROM user_identity WHERE user_id=? FOR UPDATE", [session.userId]);
    const [bindings] = await conn.query<Binding[]>("SELECT * FROM studio_workbuddy_binding WHERE tenant_id=? AND user_id=? AND client_id=? FOR UPDATE", [session.tenantId, session.userId, clientId]);
    const binding = bindings[0];
    if (binding && identities.some(row => row.provider === "workbuddy" && row.provider_key === identityKey(clientId, binding.open_id))) {
      const [users] = await conn.query<Array<RowDataPacket & { password: string }>>("SELECT password FROM tenant_user WHERE id=? AND tenant_id=? FOR UPDATE", [session.userId, session.tenantId]);
      const alternateProvider = isRegistrationEnabled() && identities.some(row => (row.provider === "github" && isGitHubConfigured()) || (row.provider === "google" && isGoogleConfigured()));
      if (!users[0]?.password && !alternateProvider) throw new OAuthError("last_login_method", "WorkBuddy 是当前账号唯一的登录方式，请先设置账号密码或绑定其他可用登录方式", 409);
      await conn.execute("DELETE FROM user_identity WHERE user_id=? AND provider='workbuddy' AND provider_key=?", [session.userId, identityKey(clientId, binding.open_id)]);
    }
    await conn.execute("DELETE FROM studio_workbuddy_request WHERE tenant_id=? AND user_id=? AND client_id=?", [session.tenantId, session.userId, clientId]);
    await conn.execute("DELETE FROM studio_workbuddy_binding WHERE tenant_id=? AND user_id=? AND client_id=?", [session.tenantId, session.userId, clientId]);
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";

import { normalizeUserRole, type UserRole } from "@/lib/auth/roles";
import { readAppConfig, readOptionalStringConfigValue } from "@/lib/server/app-config";
import { getDbPool } from "@/lib/server/mysql";

type GoogleProfile = { sub: string; name?: string; email?: string; email_verified?: boolean };
type GoogleConfig = { clientId: string; clientSecret: string };

export type GoogleSessionUser = { userId: number; tenantId: number; username: string; name: string; role: UserRole };

function getConfig(): GoogleConfig | null {
  const google = readAppConfig()?.auth?.google;
  const clientId = readOptionalStringConfigValue(google?.clientId) || process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = readOptionalStringConfigValue(google?.clientSecret) || process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function isGoogleConfigured() { return Boolean(getConfig()); }

export function getGoogleRedirectUri(request: Request) {
  const configured = readOptionalStringConfigValue(readAppConfig()?.auth?.google?.redirectUri);
  return process.env.GOOGLE_REDIRECT_URI?.trim() || configured || new URL("/api/auth/google/callback", request.url).toString();
}

export function getGoogleAuthorizationUrl(request: Request, state: string) {
  const config = getConfig();
  if (!config) throw new Error("GOOGLE_NOT_CONFIGURED");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", getGoogleRedirectUri(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("state", state);
  return url.toString();
}

async function getGoogleProfile(request: Request, code: string) {
  const config = getConfig();
  if (!config) throw new Error("GOOGLE_NOT_CONFIGURED");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: getGoogleRedirectUri(request), grant_type: "authorization_code" }),
    cache: "no-store",
  });
  const token = await tokenResponse.json() as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token) throw new Error("GOOGLE_TOKEN_FAILED");
  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` }, cache: "no-store" });
  if (!profileResponse.ok) throw new Error("GOOGLE_PROFILE_FAILED");
  const profile = await profileResponse.json() as GoogleProfile;
  if (!profile.sub || !profile.email || profile.email_verified === false) throw new Error("GOOGLE_EMAIL_UNVERIFIED");
  return { providerKey: profile.sub, email: profile.email.trim().toLowerCase(), name: profile.name?.trim() || profile.email.split("@")[0] };
}

export async function findOrCreateGoogleUser(request: Request, code: string): Promise<GoogleSessionUser> {
  const profile = await getGoogleProfile(request, code);
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [identityRows] = await connection.query<Array<RowDataPacket & { user_id: number }>>("SELECT user_id FROM user_identity WHERE provider = 'google' AND provider_key = ? LIMIT 1 FOR UPDATE", [profile.providerKey]);
    let userId = identityRows[0]?.user_id ? Number(identityRows[0].user_id) : 0;
    if (userId) {
      await connection.execute("UPDATE tenant_user SET last_active = CURRENT_TIMESTAMP WHERE id = ?", [userId]);
    } else {
      const [emailRows] = await connection.query<Array<RowDataPacket & { id: number; tenant_id: number; username: string; name: string; role: string; status: number }>>("SELECT id, tenant_id, username, name, role, status FROM tenant_user WHERE LOWER(email) = ? LIMIT 1 FOR UPDATE", [profile.email]);
      const existing = emailRows[0];
      if (existing) {
        if (Number(existing.status) === 0) throw new Error("GOOGLE_USER_DISABLED");
        userId = Number(existing.id);
      } else {
        const username = `google-${profile.providerKey}`;
        const [tenantResult] = await connection.execute("INSERT INTO tenant (code, name, status) VALUES (?, ?, 1)", [`personal-google-${randomUUID().replaceAll("-", "").slice(0, 20)}`, `${profile.name} 的工作台`]);
        const tenantId = Number((tenantResult as { insertId: number }).insertId);
        const [userResult] = await connection.execute("INSERT INTO tenant_user (tenant_id, name, username, phone, email, role, password, salt, status, last_active) VALUES (?, ?, ?, NULL, ?, 'developer', '', NULL, 1, CURRENT_TIMESTAMP)", [tenantId, profile.name, username, profile.email]);
        userId = Number((userResult as { insertId: number }).insertId);
      }
      await connection.execute("INSERT INTO user_identity (user_id, provider, provider_key, provider_email, verified_at) VALUES (?, 'google', ?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), provider_email = VALUES(provider_email), verified_at = CURRENT_TIMESTAMP", [userId, profile.providerKey, profile.email]);
      await connection.execute("UPDATE tenant_user SET last_active = CURRENT_TIMESTAMP WHERE id = ?", [userId]);
    }
    const [userRows] = await connection.query<Array<RowDataPacket & { id: number; tenant_id: number; username: string; name: string; role: string; status: number }>>("SELECT id, tenant_id, username, name, role, status FROM tenant_user WHERE id = ? LIMIT 1", [userId]);
    const user = userRows[0];
    if (!user || Number(user.status) === 0) throw new Error("GOOGLE_USER_DISABLED");
    await connection.commit();
    return { userId: Number(user.id), tenantId: Number(user.tenant_id), username: user.username, name: user.name, role: normalizeUserRole(user.role) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

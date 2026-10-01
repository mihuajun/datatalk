import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";

import { normalizeUserRole, type UserRole } from "@/lib/auth/roles";
import { readAppConfig, readOptionalStringConfigValue } from "@/lib/server/app-config";
import { getDbPool } from "@/lib/server/mysql";

type GitHubProfile = { id: number; login: string; name?: string | null; email?: string | null };
type GitHubEmail = { email: string; primary?: boolean; verified?: boolean };

export type GitHubSessionUser = { userId: number; tenantId: number; username: string; name: string; role: UserRole };

function getConfig() {
  const appConfig = readAppConfig();
  const clientId = readOptionalStringConfigValue(appConfig?.auth?.github?.clientId) || process.env.GITHUB_CLIENT_ID?.trim() || "";
  const clientSecret = readOptionalStringConfigValue(appConfig?.auth?.github?.clientSecret) || process.env.GITHUB_CLIENT_SECRET?.trim() || "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isGitHubConfigured() { return Boolean(getConfig()); }

export function getGitHubRedirectUri(request: Request) {
  const configured = readOptionalStringConfigValue(readAppConfig()?.auth?.github?.redirectUri);
  return process.env.GITHUB_REDIRECT_URI?.trim() || configured || new URL("/api/auth/github/callback", request.url).toString();
}

export function getGitHubAuthorizationUrl(request: Request, state: string) {
  const config = getConfig();
  if (!config) throw new Error("GITHUB_NOT_CONFIGURED");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", getGitHubRedirectUri(request));
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}

async function getGitHubProfile(request: Request, code: string) {
  const config = getConfig();
  if (!config) throw new Error("GITHUB_NOT_CONFIGURED");
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: getGitHubRedirectUri(request) }),
    cache: "no-store",
  });
  const token = await tokenResponse.json() as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !token.access_token) throw new Error("GITHUB_TOKEN_FAILED");
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token.access_token}`, "X-GitHub-Api-Version": "2022-11-28" };
  const [profileResponse, emailResponse] = await Promise.all([
    fetch("https://api.github.com/user", { headers, cache: "no-store" }),
    fetch("https://api.github.com/user/emails", { headers, cache: "no-store" }),
  ]);
  if (!profileResponse.ok || !emailResponse.ok) throw new Error("GITHUB_PROFILE_FAILED");
  const profile = await profileResponse.json() as GitHubProfile;
  const emails = await emailResponse.json() as GitHubEmail[];
  const email = emails.find((item) => item.primary && item.verified)?.email || emails.find((item) => item.verified)?.email || profile.email || null;
  return { profile, email: email?.trim().toLowerCase() || null };
}

export async function findOrCreateGitHubUser(request: Request, code: string): Promise<GitHubSessionUser> {
  const { profile, email } = await getGitHubProfile(request, code);
  const pool = getDbPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [identityRows] = await connection.query<Array<RowDataPacket & { user_id: number }>>(
      "SELECT user_id FROM user_identity WHERE provider = 'github' AND provider_key = ? LIMIT 1 FOR UPDATE",
      [String(profile.id)],
    );
    let userId = identityRows[0]?.user_id ? Number(identityRows[0].user_id) : 0;
    if (userId) {
      await connection.execute("UPDATE tenant_user SET last_active = CURRENT_TIMESTAMP WHERE id = ?", [userId]);
    } else {
      const [emailRows] = email ? await connection.query<Array<RowDataPacket & { id: number; tenant_id: number; username: string; name: string; role: string; status: number }>>("SELECT id, tenant_id, username, name, role, status FROM tenant_user WHERE LOWER(email) = ? LIMIT 1 FOR UPDATE", [email]) : [[]];
      const existing = emailRows[0];
      if (existing) {
        if (Number(existing.status) === 0) throw new Error("GITHUB_USER_DISABLED");
        userId = Number(existing.id);
      } else {
        const username = `github-${profile.id}`;
        const name = profile.name?.trim() || profile.login || username;
        const [tenantResult] = await connection.execute("INSERT INTO tenant (code, name, status) VALUES (?, ?, 1)", [`personal-github-${randomUUID().replaceAll("-", "").slice(0, 20)}`, `${name} 的工作台`]);
        const tenantId = Number((tenantResult as { insertId: number }).insertId);
        const [userResult] = await connection.execute("INSERT INTO tenant_user (tenant_id, name, username, phone, email, role, password, salt, status, last_active) VALUES (?, ?, ?, NULL, ?, 'developer', '', NULL, 1, CURRENT_TIMESTAMP)", [tenantId, name, username, email]);
        userId = Number((userResult as { insertId: number }).insertId);
      }
      await connection.execute("INSERT INTO user_identity (user_id, provider, provider_key, provider_email) VALUES (?, 'github', ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), provider_email = VALUES(provider_email)", [userId, String(profile.id), email]);
      await connection.execute("UPDATE tenant_user SET last_active = CURRENT_TIMESTAMP WHERE id = ?", [userId]);
    }
    const [userRows] = await connection.query<Array<RowDataPacket & { id: number; tenant_id: number; username: string; name: string; role: string; status: number }>>("SELECT id, tenant_id, username, name, role, status FROM tenant_user WHERE id = ? LIMIT 1", [userId]);
    const user = userRows[0];
    if (!user || Number(user.status) === 0) throw new Error("GITHUB_USER_DISABLED");
    await connection.commit();
    return { userId: Number(user.id), tenantId: Number(user.tenant_id), username: user.username, name: user.name, role: normalizeUserRole(user.role) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

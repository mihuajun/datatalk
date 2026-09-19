import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2/promise";

import { ensureWorkspaceStorageLayout, RUNTIME_STORAGE_ROOT } from "@/lib/server/workspace-storage";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { canAccessMembersRole, canManageMembersRole, isAdminRole, isAdministratorRole, normalizeUserRole as normalizeRoleValue, type UserRole } from "@/lib/auth/roles";
import { getDbPool } from "@/lib/server/mysql";

export type { UserRole } from "@/lib/auth/roles";

export type AuthSession = {
  userId: number;
  tenantId: number;
  username: string;
  name: string;
  role: UserRole;
};

type AuthUserRow = RowDataPacket & {
  id: number;
  tenant_id: number;
  username: string;
  name: string;
  role?: string | null;
  status: number;
};

export function normalizeUserRole(value: unknown): UserRole {
  return normalizeRoleValue(value);
}

export function isAdminSession(session: AuthSession | null): boolean {
  return session ? isAdminRole(session.role) : false;
}

export function isAdministratorSession(session: AuthSession | null): boolean {
  return session ? isAdministratorRole(session.role) : false;
}

export function canAccessMembersSession(session: AuthSession | null): boolean {
  return session ? canAccessMembersRole(session.role) : false;
}

export function canManageMembersSession(session: AuthSession | null): boolean {
  return session ? canManageMembersRole(session.role) : false;
}

const SESSION_SECRET_PATH = path.join(RUNTIME_STORAGE_ROOT, "auth-session.secret");

function getSessionSecret() {
  const configured = process.env.AUTH_SESSION_SECRET?.trim();
  if (configured) return configured;
  ensureWorkspaceStorageLayout();
  if (!fs.existsSync(SESSION_SECRET_PATH)) {
    fs.writeFileSync(SESSION_SECRET_PATH, randomBytes(32).toString("base64url"), { mode: 0o600 });
  }
  return fs.readFileSync(SESSION_SECRET_PATH, "utf8").trim();
}

function signSession(value: string) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function authCookieOptions() {
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
    ...(domain ? { domain } : {}),
  };
}

export function encodeAuthSession(session: AuthSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${signSession(payload)}`;
}

function decodeSession(value: string): AuthSession | null {
  try {
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return null;
    const expected = Buffer.from(signSession(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<AuthSession>;

    if (!parsed?.userId || !parsed?.tenantId || !parsed?.username) {
      return null;
    }

    return {
      userId: Number(parsed.userId),
      tenantId: Number(parsed.tenantId),
      username: parsed.username,
      name: parsed.name || parsed.username,
      // Older cookies did not contain a role. Default them to the least-privileged role.
      role: normalizeUserRole(parsed.role),
    };
  } catch {
    return null;
  }
}

export async function getAuthSession() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!cookieValue) {
    return null;
  }

  const session = decodeSession(cookieValue);
  if (!session) return null;

  try {
    const [rows] = await getDbPool().query<AuthUserRow[]>(
      "SELECT id, tenant_id, username, name, role, status FROM tenant_user WHERE id = ? AND tenant_id = ? LIMIT 1",
      [session.userId, session.tenantId],
    );
    const user = rows[0];

    if (!user || Number(user.status) === 0 || user.username !== session.username) {
      return null;
    }

    return {
      ...session,
      username: user.username,
      name: user.name || session.name,
      role: normalizeUserRole(user.role),
    };
  } catch (error) {
    console.error("Validate auth session failed", error);
    return null;
  }
}

export async function setAuthSession(session: AuthSession) {
  const cookieStore = await cookies();

  cookieStore.set(AUTH_COOKIE_NAME, encodeAuthSession(session), authCookieOptions());
}

export async function clearAuthSession() {
  const cookieStore = await cookies();

  cookieStore.delete(AUTH_COOKIE_NAME);
}

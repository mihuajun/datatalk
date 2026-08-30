import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2/promise";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { isAdminRole, normalizeUserRole as normalizeRoleValue, type UserRole } from "@/lib/auth/roles";
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

function encodeSession(session: AuthSession) {
  return Buffer.from(JSON.stringify(session)).toString("base64url");
}

function decodeSession(value: string): AuthSession | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<AuthSession>;

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

  cookieStore.set(AUTH_COOKIE_NAME, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
}

export async function clearAuthSession() {
  const cookieStore = await cookies();

  cookieStore.delete(AUTH_COOKIE_NAME);
}

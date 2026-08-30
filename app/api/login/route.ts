import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { normalizeUserRole, type UserRole } from "@/lib/server/auth-session";
import { getDbPool } from "@/lib/server/mysql";
import { hashPassword } from "@/lib/server/password";

type TenantUserRow = RowDataPacket & {
  id?: number;
  user_id?: number;
  tenant_id?: number;
  username?: string;
  name?: string;
  display_name?: string;
  nickname?: string;
  password_hash?: string;
  hashed_password?: string;
  password?: string;
  password_salt?: string;
  salt?: string;
  status?: number;
  role?: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function pickName(user: TenantUserRow) {
  return user.name || user.display_name || user.nickname || user.username || "BI 用户";
}

function verifyPassword(user: TenantUserRow, password: string) {
  const salt = user.password_salt || user.salt || "";
  const storedPassword = user.password_hash || user.hashed_password || user.password;

  if (!storedPassword) {
    return false;
  }

  if (!salt) {
    return storedPassword === password;
  }

  return hashPassword(password, salt) === storedPassword;
}

function encodeSession(session: { userId: number; tenantId: number; username: string; name: string; role: UserRole }) {
  return Buffer.from(JSON.stringify(session)).toString("base64url");
}

export async function POST(request: Request) {
  let body: { username?: string; password?: string } | null = null;

  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "请求格式不正确。",
      },
      { status: 400 },
    );
  }

  const username = normalizeText(body?.username);
  const password = normalizeText(body?.password);

  if (!username || !password) {
    return NextResponse.json(
      {
        success: false,
        message: "请输入账号和密码。",
      },
      { status: 400 },
    );
  }

  try {
    const pool = getDbPool();
    const [rows] = await pool.query<TenantUserRow[]>("SELECT * FROM tenant_user WHERE username = ? LIMIT 1", [username]);
    const user = rows[0];

    if (!user?.tenant_id || !user.username || user.status === 0 || !verifyPassword(user, password)) {
      return NextResponse.json(
        {
          success: false,
          message: "账号或密码不正确。",
        },
        { status: 401 },
      );
    }

    await pool.execute("UPDATE tenant_user SET last_active = CURRENT_TIMESTAMP WHERE id = ?", [Number(user.id || user.user_id || 0)]);

    const response = NextResponse.json({
      success: true,
      redirectTo: "/reports",
    });

    response.cookies.set(AUTH_COOKIE_NAME, encodeSession({
      userId: Number(user.id || user.user_id || 0),
      tenantId: Number(user.tenant_id),
      username: user.username,
      name: pickName(user),
      role: normalizeUserRole(user.role),
    }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    });

    return response;
  } catch (error) {
    console.error("Login failed", error);

    return NextResponse.json(
      {
        success: false,
        message: "登录服务暂时不可用，请稍后重试。",
      },
      { status: 500 },
    );
  }
}

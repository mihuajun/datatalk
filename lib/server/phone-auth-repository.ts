import { randomUUID } from "node:crypto";

import type { RowDataPacket } from "mysql2/promise";

import { normalizeUserRole, type UserRole } from "@/lib/auth/roles";
import { getDbPool } from "@/lib/server/mysql";

export const DEMO_PHONE_CODE = "8888";

type PhoneUserRow = RowDataPacket & {
  id: number;
  tenant_id: number;
  username: string;
  name: string;
  role?: string | null;
  status: number;
};

export type PhoneAuthUser = {
  userId: number;
  tenantId: number;
  username: string;
  name: string;
  role: UserRole;
  created: boolean;
};

function personalTenantCode(phone: string) {
  return `personal-${phone}-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

function normalizeUser(row: PhoneUserRow, created: boolean): PhoneAuthUser {
  return {
    userId: Number(row.id),
    tenantId: Number(row.tenant_id),
    username: row.username,
    name: row.name || "个人用户",
    role: normalizeUserRole(row.role),
    created,
  };
}

export async function findOrCreatePhoneUser(phone: string) {
  const pool = getDbPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.query<PhoneUserRow[]>(
      "SELECT id, tenant_id, username, name, role, status FROM tenant_user WHERE phone = ? LIMIT 1 FOR UPDATE",
      [phone],
    );
    const existing = existingRows[0];
    if (existing) {
      if (Number(existing.status) === 0) throw new Error("PHONE_USER_DISABLED");
      await connection.execute("UPDATE tenant_user SET last_active = CURRENT_TIMESTAMP WHERE id = ?", [Number(existing.id)]);
      await connection.commit();
      return normalizeUser(existing, false);
    }

    const tenantName = `${phone.slice(0, 3)}****${phone.slice(-4)} 的工作台`;
    const username = `phone-${phone}`;
    const [tenantResult] = await connection.execute(
      "INSERT INTO tenant (code, name, status) VALUES (?, ?, 1)",
      [personalTenantCode(phone), tenantName],
    );
    const tenantId = Number((tenantResult as { insertId: number }).insertId);
    const [userResult] = await connection.execute(
      `INSERT INTO tenant_user
        (tenant_id, name, username, phone, email, role, password, salt, status, last_active)
       VALUES (?, ?, ?, ?, NULL, 'developer', '', NULL, 1, CURRENT_TIMESTAMP)`,
      [tenantId, "个人用户", username, phone],
    );
    const userId = Number((userResult as { insertId: number }).insertId);
    await connection.commit();
    return {
      userId,
      tenantId,
      username,
      name: "个人用户",
      role: "developer" as const,
      created: true,
    } satisfies PhoneAuthUser;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

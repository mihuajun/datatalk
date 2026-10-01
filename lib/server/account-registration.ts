import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";

import { normalizeUserRole, type UserRole } from "@/lib/auth/roles";
import { getDbPool } from "@/lib/server/mysql";
import { createSalt, hashPassword } from "@/lib/server/password";

export type RegistrationInput = {
  username: string;
  password: string;
  phone?: string;
  email?: string;
};

export type RegisteredUser = {
  userId: number;
  tenantId: number;
  username: string;
  name: string;
  role: UserRole;
};

function personalTenantCode() {
  return `personal-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export async function registerAccount(input: RegistrationInput): Promise<RegisteredUser> {
  const pool = getDbPool();
  const connection = await pool.getConnection();
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;

  try {
    await connection.beginTransaction();
    const [duplicates] = await connection.query<RowDataPacket[]>(
      `SELECT username, phone, email
         FROM tenant_user
        WHERE username = ? OR (? IS NOT NULL AND phone = ?) OR (? IS NOT NULL AND LOWER(email) = ?)
        LIMIT 1 FOR UPDATE`,
      [input.username, phone, phone, email, email],
    );
    const duplicate = duplicates[0] as { username?: string; phone?: string; email?: string } | undefined;
    if (duplicate) {
      if (duplicate.username === input.username) throw new Error("USERNAME_EXISTS");
      if (phone && duplicate.phone === phone) throw new Error("PHONE_EXISTS");
      throw new Error("EMAIL_EXISTS");
    }

    const tenantName = `${input.username} 的工作台`;
    const [tenantResult] = await connection.execute(
      "INSERT INTO tenant (code, name, status) VALUES (?, ?, 1)",
      [personalTenantCode(), tenantName],
    );
    const tenantId = Number((tenantResult as { insertId: number }).insertId);
    const name = input.username;
    const salt = createSalt();
    const [userResult] = await connection.execute(
      `INSERT INTO tenant_user
        (tenant_id, name, username, phone, email, role, password, salt, status, last_active)
       VALUES (?, ?, ?, ?, ?, 'developer', ?, ?, 1, CURRENT_TIMESTAMP)`,
      [tenantId, name, input.username, phone, email, hashPassword(input.password, salt), salt],
    );
    await connection.commit();
    return {
      userId: Number((userResult as { insertId: number }).insertId),
      tenantId,
      username: input.username,
      name,
      role: normalizeUserRole("developer"),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

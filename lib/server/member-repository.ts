import type { RowDataPacket } from "mysql2/promise";

import { normalizeUserRole, type UserRole } from "@/lib/auth/roles";
import { createSalt, hashPassword } from "@/lib/server/password";
import { getDbPool } from "@/lib/server/mysql";

export type MemberRole = UserRole;

export type MemberRecord = {
  id: number;
  name: string;
  username: string;
  email: string;
  role: MemberRole;
  enabled: boolean;
  lastActive: string;
};

type MemberRow = RowDataPacket & {
  id: number;
  name: string;
  username: string;
  email: string | null;
  role: string | null;
  status: number;
  last_active?: string | Date | null;
};

function normalizeMember(row: MemberRow): MemberRecord {
  const lastActive = row.last_active instanceof Date
    ? row.last_active.toLocaleString("zh-CN", { hour12: false })
    : row.last_active;

  return {
    id: Number(row.id),
    name: row.name,
    username: row.username,
    email: row.email || "",
    role: normalizeUserRole(row.role),
    enabled: Number(row.status) === 1,
    lastActive: lastActive || "未登录",
  };
}

export async function listMembers(tenantId: number) {
  const [rows] = await getDbPool().query<MemberRow[]>(
    "SELECT id, name, username, email, role, status, last_active FROM tenant_user WHERE tenant_id = ? ORDER BY id ASC",
    [tenantId],
  );
  return rows.map(normalizeMember);
}

export async function getMember(tenantId: number, id: number) {
  const [rows] = await getDbPool().query<MemberRow[]>(
    "SELECT id, name, username, email, role, status, last_active FROM tenant_user WHERE tenant_id = ? AND id = ? LIMIT 1",
    [tenantId, id],
  );
  return rows[0] ? normalizeMember(rows[0]) : null;
}

export async function createMember(input: { tenantId: number; name: string; username: string; email: string; role: MemberRole; password: string }) {
  const salt = createSalt();
  const [result] = await getDbPool().execute(
    "INSERT INTO tenant_user (tenant_id, name, username, email, role, password, salt, status) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    [input.tenantId, input.name, input.username, input.email, input.role, hashPassword(input.password, salt), salt],
  );
  return getMember(input.tenantId, Number((result as { insertId: number }).insertId));
}

export async function updateMember(input: { tenantId: number; id: number; name: string; username: string; email: string; role: MemberRole; password?: string }) {
  const pool = getDbPool();
  if (input.password) {
    const salt = createSalt();
    await pool.execute(
      "UPDATE tenant_user SET name = ?, username = ?, email = ?, role = ?, password = ?, salt = ? WHERE tenant_id = ? AND id = ?",
      [input.name, input.username, input.email, input.role, hashPassword(input.password, salt), salt, input.tenantId, input.id],
    );
  } else {
    await pool.execute(
      "UPDATE tenant_user SET name = ?, username = ?, email = ?, role = ? WHERE tenant_id = ? AND id = ?",
      [input.name, input.username, input.email, input.role, input.tenantId, input.id],
    );
  }
  return getMember(input.tenantId, input.id);
}

export async function setMemberEnabled(tenantId: number, id: number, enabled: boolean) {
  await getDbPool().execute("UPDATE tenant_user SET status = ? WHERE tenant_id = ? AND id = ?", [enabled ? 1 : 0, tenantId, id]);
  return getMember(tenantId, id);
}

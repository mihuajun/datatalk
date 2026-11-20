import type { Connection, RowDataPacket } from "mysql2/promise";

import { getDbPool } from "@/lib/server/mysql";

export const CONVERSATION_QUOTA_EXHAUSTED_MESSAGE = "对话次数已用完，请联系管理员申请配额。";

/** Atomically consumes one tenant-scoped conversation. Returns false when empty. */
export async function consumeTenantConversationQuota(tenantId: number) {
  const pool = getDbPool();
  const [result] = await pool.execute(
    `UPDATE studio_conversation_quota
        SET available_count = available_count - 1,
            consumed_count = consumed_count + 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND available_count > 0`,
    [tenantId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** Adds the signup grant to a newly created personal tenant. */
export async function grantSignupConversationQuota(connection: Connection, tenantId: number) {
  await connection.execute(
    `INSERT INTO studio_conversation_quota (tenant_id, available_count, granted_count)
     VALUES (?, 10, 10)
     ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [tenantId],
  );
}

export async function getTenantConversationQuota(tenantId: number) {
  const [rows] = await getDbPool().query<Array<RowDataPacket & { available_count: number }>>(
    "SELECT available_count FROM studio_conversation_quota WHERE tenant_id = ? LIMIT 1",
    [tenantId],
  );
  return Number(rows[0]?.available_count ?? 0);
}

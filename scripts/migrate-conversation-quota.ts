import { getDbPool } from "@/lib/server/mysql";
import { getDatabaseConfig } from "@/lib/server/database-config";
import type { RowDataPacket } from "mysql2/promise";

async function main() {
  const config = getDatabaseConfig();
  const pool = getDbPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS studio_conversation_quota (
        tenant_id bigint unsigned NOT NULL,
        available_count int unsigned NOT NULL DEFAULT 0,
        granted_count int unsigned NOT NULL DEFAULT 0,
        consumed_count int unsigned NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id),
        CONSTRAINT chk_studio_conversation_quota_nonnegative CHECK (available_count >= 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [result] = await pool.execute(
      `INSERT IGNORE INTO studio_conversation_quota (tenant_id, available_count, granted_count)
       SELECT id, 10, 10 FROM tenant`,
    );
    const [counts] = await pool.query<Array<RowDataPacket & { tenants: number; quotas: number; ten_quota: number; other_quota: number }>>(
      `SELECT (SELECT COUNT(*) FROM tenant) AS tenants,
              (SELECT COUNT(*) FROM studio_conversation_quota) AS quotas,
              (SELECT COUNT(*) FROM studio_conversation_quota WHERE available_count = 10) AS ten_quota,
              (SELECT COUNT(*) FROM studio_conversation_quota WHERE available_count <> 10) AS other_quota`,
    );
    console.info("Conversation quota migration complete", {
      databaseKind: config.kind,
      tenants: Number(counts[0]?.tenants ?? 0),
      quotaRows: Number(counts[0]?.quotas ?? 0),
      tenantsWithTenTurns: Number(counts[0]?.ten_quota ?? 0),
      tenantsWithOtherBalance: Number(counts[0]?.other_quota ?? 0),
      insertedRows: Number((result as { affectedRows?: number }).affectedRows ?? 0),
    });
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Conversation quota migration failed", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});

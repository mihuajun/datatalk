import { getDbPool } from "@/lib/server/mysql";
import { getDatabaseConfig } from "@/lib/server/database-config";

let ready: Promise<void> | undefined;
export async function ensureOpenApiSchema() {
  ready ??= initialize().catch((error) => { ready = undefined; throw error; });
  await ready;
}
async function initialize() {
  const sqlite = getDatabaseConfig().kind === "sqlite";
  const id = sqlite ? "INTEGER PRIMARY KEY AUTOINCREMENT" : "bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY";
  const suffix = sqlite ? "" : " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
  const tables = [
    `studio_api_key (id ${id}, tenant_id bigint NOT NULL, user_id bigint NOT NULL, name varchar(100) NOT NULL,
      prefix varchar(24) NOT NULL, api_key varchar(47)${sqlite ? "" : " CHARACTER SET ascii COLLATE ascii_bin"} NOT NULL UNIQUE,
      created_at varchar(32) NOT NULL, last_used_at varchar(32))`,
    `studio_api_log (id ${id}, tenant_id bigint NOT NULL, user_id bigint NOT NULL, key_id bigint NOT NULL,
      tool varchar(80) NOT NULL, report_code varchar(50), status varchar(80) NOT NULL, created_at varchar(32) NOT NULL)`,
    `studio_api_operation (id ${id}, tenant_id bigint NOT NULL, user_id bigint NOT NULL,
      operation_id varchar(100) NOT NULL, input_digest varchar(64) NOT NULL, result_json MEDIUMTEXT,
      created_at varchar(32) NOT NULL, UNIQUE(tenant_id, user_id, operation_id))`,
    `studio_report_edit_lock (lock_key varchar(100) PRIMARY KEY, lock_token varchar(64) NOT NULL,
      user_id bigint NOT NULL, username varchar(80) NOT NULL, name varchar(80) NOT NULL, expires_at bigint NOT NULL)`,
  ];
  for (const table of tables) await getDbPool().query(`CREATE TABLE IF NOT EXISTS ${table}${suffix}`);
}

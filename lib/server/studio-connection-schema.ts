import { getDbPool } from "@/lib/server/mysql";
import { getDatabaseConfig } from "@/lib/server/database-config";
import { ensureOpenApiSchema } from "@/lib/server/open-api-schema";

let ready: Promise<void> | undefined;
export async function ensureConnectionSchema() {
  ready ??= initialize().catch(error => { ready = undefined; throw error; });
  return ready;
}
async function initialize() {
  await ensureOpenApiSchema();
  const sqlite = getDatabaseConfig().kind === "sqlite";
  const suffix = sqlite ? "" : " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin";
  const tables = [
    `studio_oauth_client (id varchar(64) PRIMARY KEY, name varchar(100) NOT NULL, redirect_uris MEDIUMTEXT NOT NULL, created_at bigint NOT NULL)`,
    `studio_oauth_request (id varchar(64) PRIMARY KEY, tenant_id bigint NOT NULL, user_id bigint NOT NULL, params_json MEDIUMTEXT NOT NULL, expires_at bigint NOT NULL)`,
    `studio_oauth_grant (id varchar(64) PRIMARY KEY, client_id varchar(64) NOT NULL, tenant_id bigint NOT NULL, user_id bigint NOT NULL, resource varchar(512) NOT NULL, redirect_uri varchar(2048) NOT NULL, challenge varchar(64) NOT NULL, revoked_at bigint, created_at bigint NOT NULL)`,
    `studio_oauth_token (token_hash varchar(64) PRIMARY KEY, grant_id varchar(64) NOT NULL, kind varchar(16) NOT NULL, expires_at bigint NOT NULL, consumed_at bigint)`,
    `studio_preview_session (ticket_hash varchar(64) PRIMARY KEY, session_hash varchar(64) UNIQUE, tenant_id bigint NOT NULL, user_id bigint NOT NULL, key_id bigint NOT NULL, oauth_grant_id varchar(64), report_code varchar(50) NOT NULL, ticket_expires_at bigint NOT NULL, session_expires_at bigint NOT NULL)`,
  ];
  for (const table of tables) await getDbPool().query(`CREATE TABLE IF NOT EXISTS ${table}${suffix}`);
  // Existing API logs use key_id=0 for OAuth, with the real grant identity kept separately.
  const [columns] = await getDbPool().query(sqlite ? "PRAGMA table_info(studio_api_log)" : "SHOW COLUMNS FROM studio_api_log");
  if (!(columns as Array<{ name?: string; Field?: string }>).some(c => (c.name || c.Field) === "oauth_grant_id")) {
    try { await getDbPool().query("ALTER TABLE studio_api_log ADD COLUMN oauth_grant_id varchar(64)"); }
    catch (error) {
      // Another server process may have applied this additive migration concurrently.
      if (!/duplicate column/i.test(String((error as Error).message))) throw error;
    }
  }
}

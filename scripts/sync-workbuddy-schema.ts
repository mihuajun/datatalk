import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { getDatabaseConfig } from "../lib/server/database-config";
import { getDbPool } from "../lib/server/mysql";
import { ensureConnectionSchema } from "../lib/server/studio-connection-schema";
import { ensureWorkBuddySchema } from "../lib/server/workbuddy-oauth";

// Default is read-only. Apply reuses the runtime's additive migrations only.
const expected: Record<string, string[]> = Object.fromEntries(Object.entries({
  studio_api_key: "id tenant_id user_id name prefix api_key created_at last_used_at",
  studio_api_log: "id tenant_id user_id key_id tool report_code status created_at oauth_grant_id",
  studio_api_operation: "id tenant_id user_id operation_id input_digest result_json created_at",
  studio_report_edit_lock: "lock_key lock_token user_id username name expires_at",
  studio_oauth_client: "id name redirect_uris created_at",
  studio_oauth_request: "id tenant_id user_id params_json expires_at",
  studio_oauth_grant: "id client_id tenant_id user_id resource redirect_uri challenge revoked_at created_at",
  studio_oauth_token: "token_hash grant_id kind expires_at consumed_at",
  studio_preview_session: "ticket_hash session_hash tenant_id user_id key_id oauth_grant_id report_code ticket_expires_at session_expires_at",
  studio_workbuddy_request: "state_hash browser_hash tenant_id user_id client_id redirect_uri expires_at",
  studio_workbuddy_login_request: "state_hash browser_hash client_id redirect_uri return_to expires_at",
  studio_workbuddy_binding: "tenant_id user_id client_id open_id nickname scope token_cipher expires_at needs_reauth updated_at",
}).map(([table, columns]) => [table, columns.split(" ")]));

async function main() {
  const config = getDatabaseConfig();
  if (config.kind !== "mysql") throw new Error("MySQL configuration required");
  const target = createHash("sha256").update(JSON.stringify([config.host, config.port, config.database])).digest("hex");
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const arg = (name: string) => args[args.indexOf(name) + 1];
  if (apply && (!args.includes("--expect-target") || arg("--expect-target") !== target)) {
    throw new Error("Target fingerprint must match the read-only preflight");
  }
  if (!args.includes("--output")) throw new Error("--output is required for the schema-only audit record");
  const output = path.resolve(arg("--output"));
  if (fs.existsSync(output)) throw new Error("Choose a new output file to preserve previous audit records");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const connect = () => mysql.createConnection({ host: config.host, port: config.port, user: config.username,
    password: config.password, database: config.database, connectTimeout: 10000 });
  async function snapshot() {
    const db = await connect();
    try {
      await db.query("START TRANSACTION READ ONLY");
      const result: Record<string, { columns: RowDataPacket[]; indexes: RowDataPacket[]; ddl: string }> = {};
      for (const table of [...Object.keys(expected), "tenant_user", "user_identity"]) {
        const [columns] = await db.query<RowDataPacket[]>(
          "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION", [table]);
        if (!columns.length) continue;
        const [indexes] = await db.query<RowDataPacket[]>(
          "SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME, SEQ_IN_INDEX", [table]);
        const [ddl] = await db.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${table}\``);
        result[table] = { columns, indexes, ddl: String(ddl[0]["Create Table"]) };
      }
      await db.rollback();
      return result;
    } finally { await db.end(); }
  }
  const before = await snapshot();
  const names = (table: string, state = before) => (state[table]?.columns || []).map(c => c.COLUMN_NAME as string);
  const indexExists = (table: string, columns: string[], unique: boolean, state = before) => {
    const groups = new Map<string, RowDataPacket[]>();
    for (const row of state[table]?.indexes || []) groups.set(row.INDEX_NAME, [...(groups.get(row.INDEX_NAME) || []), row]);
    return [...groups.values()].some(rows => (!unique || Number(rows[0].NON_UNIQUE) === 0)
      && rows.map(r => r.COLUMN_NAME).join(",") === columns.join(","));
  };
  // User/identity bootstrap can seed business data, so require those existing prerequisites.
  if (!names("tenant_user").includes("avatar") || !indexExists("user_identity", ["provider", "provider_key"], true)
    || !indexExists("user_identity", ["user_id", "provider"], true)) throw new Error("Existing avatar/identity prerequisites require a separate reviewed migration");
  for (const [table, columns] of Object.entries(expected)) {
    if (!before[table]) continue;
    const missing = columns.filter(c => !names(table).includes(c) && !(table === "studio_api_log" && c === "oauth_grant_id"));
    if (missing.length) throw new Error(`Existing ${table} has incompatible columns`);
  }
  if (["scopes_json", "expires_at", "revoked_at", "key_hash", "key_cipher"].some(c => names("studio_api_key").includes(c))) {
    throw new Error("Legacy API-key schema requires a separate reviewed migration");
  }
  const record: Record<string, unknown> = { startedAt: new Date().toISOString(), mode: apply ? "apply" : "read-only", targetFingerprint: target,
    missingTables: Object.keys(expected).filter(t => !before[t]), before };
  const save = () => fs.writeFileSync(output, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  save();
  if (apply) {
    try {
      await ensureConnectionSchema();
      await ensureWorkBuddySchema();
      const after = await snapshot(); // independent connection, not the migration pool
      const failures: string[] = [];
      for (const [table, columns] of Object.entries(expected)) {
        if (columns.some(c => !names(table, after).includes(c))) failures.push(`${table}: missing columns`);
        if (!after[table]?.indexes.some(i => i.INDEX_NAME === "PRIMARY")) failures.push(`${table}: missing primary key`);
      }
      for (const [table, columns, unique] of [
        ["studio_api_key", ["api_key"], true],
        ["studio_api_operation", ["tenant_id", "user_id", "operation_id"], true],
        ["studio_preview_session", ["session_hash"], true],
        ["studio_workbuddy_binding", ["tenant_id", "user_id", "client_id"], true],
        ["studio_workbuddy_binding", ["client_id", "open_id"], false],
      ] as const) if (!indexExists(table, [...columns], unique, after)) failures.push(`${table}: missing index`);
      if (JSON.stringify(before.tenant_user) !== JSON.stringify(after.tenant_user)
        || JSON.stringify(before.user_identity) !== JSON.stringify(after.user_identity)) failures.push("Existing account schema changed");
      Object.assign(record, { after, failures, verified: failures.length === 0, completedAt: new Date().toISOString() });
      save();
      if (failures.length) throw new Error("Post-migration verification failed; inspect schema audit");
    } catch (error) {
      Object.assign(record, { failed: true, errorCode: (error as { code?: string }).code || "SCHEMA_SYNC_FAILED" });
      save();
      throw error;
    } finally { await getDbPool().end(); }
  }
  console.log(JSON.stringify({ mode: record.mode, targetFingerprint: target, missingTables: record.missingTables,
    verified: record.verified ?? false, output }, null, 2));
}
main().catch(error => {
  // Driver error messages may contain SQL or connection details.
  console.error(JSON.stringify({ error: "Schema synchronization stopped", code: error.code || "PREFLIGHT_OR_VERIFICATION_FAILED" }));
  process.exitCode = 1;
});

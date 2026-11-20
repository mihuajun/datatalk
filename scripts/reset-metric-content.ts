/** Explicit, scoped reset. Default is read-only; no boot-time destructive migration. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getDatabaseConfig } from "../lib/server/database-config";
import { getDbPool } from "../lib/server/mysql";
import { ensureMetricGovernanceSchema } from "../lib/server/metric-governance-schema";

export const metricTables = ["tenant_metric_search_index", "tenant_report_metric_binding", "tenant_metric_knowledge_version", "report_metric_knowledge_proposal", "tenant_metric_knowledge"] as const;
export async function coreMetricDdl(sqlite: boolean) {
  const source = await fs.readFile(path.resolve(sqlite ? "lib/server/sqlite-bootstrap.ts" : "lib/server/database-bootstrap.ts"), "utf8");
  return ["tenant_metric_knowledge", "report_metric_knowledge_proposal"].map(table => {
    const start = source.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
    const end = sqlite ? source.indexOf(";", start) : source.indexOf("`", start);
    if (start < 0 || end < start) throw new Error("METRIC_DDL_NOT_FOUND");
    return source.slice(start, end);
  });
}
export async function resetMetricContent(execute = false, tenantId = 1, expectedDigest?: string, allTenants = false) {
  const pool = getDbPool(), sqlite = getDatabaseConfig().kind === "sqlite";
  const exists = async (table: string) => (await pool.query<RowDataPacket[]>(sqlite ? "SELECT name FROM sqlite_master WHERE type='table' AND name=?" : "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?",[table]))[0].length > 0;
  const rows: Record<string,RowDataPacket[]> = {};
  const ddl: Record<string,unknown> = {};
  for (const table of metricTables) {
    rows[table] = await exists(table) ? (await pool.query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY tenant_id`))[0] : [];
    if (await exists(table)) ddl[table] = (await pool.query(sqlite ? "SELECT sql FROM sqlite_master WHERE type='table' AND name=?" : `SHOW CREATE TABLE ${table}`, sqlite ? [table] : []))[0];
  }
  // Do not leave old manifests silently pointing at discarded published definitions.
  const feedback = await exists("tenant_bi_feedback") ? (await pool.query<RowDataPacket[]>(`SELECT * FROM tenant_bi_feedback WHERE knowledge_type='metric'${allTenants ? "" : " AND tenant_id=?"}`,allTenants ? [] : [tenantId]))[0] : [];
  const digest = createHash("sha256").update(JSON.stringify({rows,feedback})).digest("hex");
  const before = Object.fromEntries(Object.entries(rows).map(([key,value]) => [key,value.length]));
  if (!execute) return {schemaVersion:2,allTenants,mode:"dry-run",databaseKind:sqlite?"sqlite":"mysql",tenantId,before,tenantIds:[...new Set(Object.values(rows).flat().map(row=>Number(row.tenant_id)))],metricFeedback:feedback.length,digest};
  if (!allTenants && Object.values(rows).flat().some(row=>Number(row.tenant_id)!==tenantId)) throw new Error("RESET_REFUSED_OTHER_TENANT_DATA");
  if (rows.tenant_report_metric_binding.length) throw new Error("RESET_REFUSED_BOUND_REPORTS: detach existing report bindings explicitly first");
  if (!expectedDigest || expectedDigest !== digest) throw new Error("RESET_PREVIEW_CHANGED: repeat dry-run and provide its digest");
  const protectedState = async () => {
    const result: Record<string,string> = {};
    for (const table of ["tenant_report","tenant_data_source","resource_item","report_release"]) {
      if (await exists(table)) {
        const [records] = await pool.query<RowDataPacket[]>(`SELECT * FROM ${table}`);
        result[table] = createHash("sha256").update(JSON.stringify(records.map(row=>JSON.stringify(row)).sort())).digest("hex");
      }
    }
    return result;
  };
  const protectedBefore = await protectedState();
  const folder=path.resolve(".workbuddy-local/metric-content-v2/backups");
  await fs.mkdir(folder,{recursive:true,mode:0o700});
  const backup=path.join(folder,`before-reset-${Date.now()}.json`);
  await fs.writeFile(backup,JSON.stringify({rows,ddl,feedback,protectedBefore},null,2),{mode:0o600,flag:"wx"});
  // MySQL DDL commits implicitly. Retain exact pre-reset DDL/data for recovery on failure.
  for (const table of metricTables) await pool.query(`DROP TABLE IF EXISTS ${table}`);
  for (const statement of await coreMetricDdl(sqlite)) await pool.query(statement);
  if (sqlite) {
    await pool.query("CREATE UNIQUE INDEX uq_tenant_metric_key ON tenant_metric_knowledge(tenant_id, metric_key)");
    await pool.query("CREATE UNIQUE INDEX uq_metric_proposal_key ON report_metric_knowledge_proposal(proposal_key)");
    await pool.query("CREATE INDEX idx_metric_tenant_status_name ON tenant_metric_knowledge(tenant_id,status,normalized_name)");
    await pool.query("CREATE INDEX idx_metric_proposal_session ON report_metric_knowledge_proposal(tenant_id,report_code,dsh_session_id,status)");
  }
  await ensureMetricGovernanceSchema(pool,sqlite);
  await pool.query("DROP TABLE IF EXISTS metric_governance_migration");
  if (feedback.length) await pool.execute(`DELETE FROM tenant_bi_feedback WHERE knowledge_type='metric'${allTenants ? "" : " AND tenant_id=?"}`,allTenants ? [] : [tenantId]);
  const after: Record<string,number> = {};
  for (const table of metricTables) after[table] = Number((await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n);
  const protectedUnchanged = JSON.stringify(protectedBefore) === JSON.stringify(await protectedState());
  if (!protectedUnchanged) throw new Error("NON_METRIC_DATA_CHANGED_DURING_RESET: inspect concurrent writes; backup retained");
  return {schemaVersion:2,allTenants,mode:"executed",databaseKind:sqlite?"sqlite":"mysql",tenantId,before,after,backup,protectedUnchanged};
}
if (process.argv[1]?.endsWith("reset-metric-content.ts")) {
  const arg = (name:string) => process.argv.find(v=>v.startsWith(`${name}=`))?.split("=").slice(1).join("=");
  resetMetricContent(process.argv.includes("--execute"),Number(arg("--tenant-id") || 1),arg("--digest"),process.argv.includes("--all-tenants"))
    .then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(error=>{console.error(error instanceof Error ? error.message : "RESET_FAILED");process.exitCode=1;})
    .finally(()=>getDbPool().end());
}

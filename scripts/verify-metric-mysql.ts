/** Run the lifecycle suite using connection-local TEMPORARY tables only.
 * No shared table contents or persistent schema are changed.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mysql, { type Pool } from "mysql2/promise";
import { getDatabaseConfig } from "../lib/server/database-config";
import { ensureMetricGovernanceSchema } from "../lib/server/metric-governance-schema";
async function main() {
  const isolatedRuntime=await fs.mkdtemp(path.join(os.tmpdir(),"metric-mysql-runtime-"));
  process.env.WORKSPACE_STORAGE_ROOT=isolatedRuntime;
  const config=getDatabaseConfig();
  if (config.kind !== "mysql") throw new Error("MySQL config required");
  const connection=await mysql.createConnection({host:config.host,port:config.port,user:config.username,password:config.password,database:config.database,connectTimeout:5000});
  try {
    const source=await fs.readFile("lib/server/database-bootstrap.ts","utf8");
    for (const table of ["tenant_metric_knowledge","report_metric_knowledge_proposal","tenant_bi_feedback"]) {
      const start=source.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
      const end=source.indexOf('`',start);
      if (start<0||end<0) throw new Error(`DDL_NOT_FOUND:${table}`);
      await connection.query(source.slice(start,end).replace("CREATE TABLE IF NOT EXISTS","CREATE TEMPORARY TABLE"));
    }
    await connection.query("CREATE TEMPORARY TABLE tenant_user (id BIGINT,tenant_id BIGINT,name VARCHAR(160))");
    await connection.query("CREATE TEMPORARY TABLE tenant_report (tenant_id BIGINT,code VARCHAR(50),name VARCHAR(160),folder_id BIGINT,deleted_at TIMESTAMP NULL)");
    await connection.query("CREATE TEMPORARY TABLE tenant_report_folder (tenant_id BIGINT,id BIGINT,name VARCHAR(160))");
    await connection.query("CREATE TEMPORARY TABLE report_edit_audit (tenant_id BIGINT,report_code VARCHAR(50),user_id BIGINT,op_id VARCHAR(100) PRIMARY KEY,action VARCHAR(30),status VARCHAR(30),commit_hash VARCHAR(64))");
    // MySQL TEMPORARY tables cannot be joined twice; use an empty mirror for the updater alias.
    await connection.query("CREATE TEMPORARY TABLE tenant_user_updater LIKE tenant_user");
    const query = (sql: string, params?: unknown[]) => connection.query(sql.replace(/JOIN tenant_user updater/g,"JOIN tenant_user_updater updater"),params);
    const session=Object.assign(Object.create(connection),{
      query,execute:connection.execute.bind(connection),
      beginTransaction:connection.beginTransaction.bind(connection),commit:connection.commit.bind(connection),rollback:connection.rollback.bind(connection),release:()=>{},
    });
    const pool={query,execute:connection.execute.bind(connection),getConnection:async()=>session,end:async()=>{}} as unknown as Pool;
    const migrationPool={...pool,query:((sql:string,params:unknown[])=>connection.query(sql.replace(/CREATE TABLE IF NOT EXISTS/g,"CREATE TEMPORARY TABLE IF NOT EXISTS"),params))} as unknown as Pool;
    await ensureMetricGovernanceSchema(migrationPool,false);
    // Verify idempotence while all backfill sources are empty isolated tables.
    await ensureMetricGovernanceSchema(migrationPool,false);
    globalThis.__chatBiMySqlPool=pool;
    process.env.AUTO_INIT_DATABASE="false";
    process.env.METRIC_TEST_IMPORT_ONLY="true";
    const { verifyMetricKnowledge } = await import("./verify-metric-knowledge");
    await verifyMetricKnowledge();
    console.log("MySQL TEMPORARY-table migration and lifecycle verification completed; shared tables untouched");
  } finally { await connection.end(); await fs.rm(isolatedRuntime,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

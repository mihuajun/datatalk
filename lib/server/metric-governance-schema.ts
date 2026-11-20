import type { Pool } from "mysql2/promise";

/** v2 text-based schema. Never converts or republishes old candidates on startup. */
export async function ensureMetricGovernanceSchema(db: Pool, sqlite: boolean) {
  const text = sqlite ? "TEXT" : "LONGTEXT";
  const key = sqlite ? "TEXT" : "VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin";
  const report = sqlite ? "TEXT" : "VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin";
  const suffix = sqlite ? "" : " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
  for (const table of ["tenant_metric_knowledge", "report_metric_knowledge_proposal"]) {
    const [columns] = await db.query(sqlite ? `PRAGMA table_info(${table})` : `SHOW COLUMNS FROM ${table}`);
    if (!(columns as Array<{name?:string;Field?:string}>).some(c => (c.name || c.Field) === "content")) {
      throw new Error("METRIC_SCHEMA_RESET_REQUIRED: run db:reset-metric-content explicitly; startup never deletes data");
    }
    if (table === "report_metric_knowledge_proposal" && !(columns as Array<{name?:string;Field?:string}>).some(c => (c.name || c.Field) === "failure_reason")) {
      await db.query(`ALTER TABLE ${table} ADD COLUMN failure_reason ${sqlite ? "TEXT" : "VARCHAR(500) NULL"}`);
    }
  }
  await db.query(`CREATE TABLE IF NOT EXISTS tenant_metric_knowledge_version (
    tenant_id BIGINT NOT NULL, metric_key ${key} NOT NULL, version INTEGER NOT NULL,
    name VARCHAR(160) NOT NULL, aliases_json ${text} NOT NULL, keywords_json ${text} NOT NULL, content ${text} NOT NULL,
    fingerprint VARCHAR(64) NOT NULL, change_summary ${text} NOT NULL,
    source_report_code ${report}, source_op_id VARCHAR(100), created_by BIGINT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, metric_key, version)
  )${suffix}`);
  await db.query(`CREATE TABLE IF NOT EXISTS tenant_report_metric_binding (
    tenant_id BIGINT NOT NULL, report_code ${report} NOT NULL, metric_key ${key} NOT NULL,
    metric_version INTEGER NOT NULL, source_op_id VARCHAR(100), bound_by BIGINT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, report_code, metric_key)
  )${suffix}`);
  await db.query(`CREATE TABLE IF NOT EXISTS tenant_metric_search_index (
    tenant_id BIGINT NOT NULL, metric_key ${key} NOT NULL, version INTEGER NOT NULL,
    content_hash VARCHAR(64) NOT NULL, model VARCHAR(255) NOT NULL,
    embedding_json ${text} NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, metric_key, version)
  )${suffix}`);
  const [versionColumns] = await db.query(sqlite ? "PRAGMA table_info(tenant_metric_knowledge_version)" : "SHOW COLUMNS FROM tenant_metric_knowledge_version");
  if (!(versionColumns as Array<{name?:string;Field?:string}>).some(c => (c.name || c.Field) === "content")) throw new Error("METRIC_SCHEMA_RESET_REQUIRED");
}

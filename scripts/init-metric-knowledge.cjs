const mysql = require("mysql2/promise");
const { readDatabaseConfig, initializeSqliteDatabase } = require("./lib/config.cjs");

function getConfig() {
  return readDatabaseConfig();
}

async function main() {
  const databaseConfig = getConfig();
  if (databaseConfig.kind === "sqlite") {
    await initializeSqliteDatabase(databaseConfig);
    console.log(`SQLite metric knowledge tables initialized at ${databaseConfig.path}`);
    return;
  }

  const connection = await mysql.createConnection(databaseConfig);
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS tenant_metric_knowledge (
        id bigint unsigned NOT NULL AUTO_INCREMENT,
        tenant_id bigint unsigned NOT NULL,
        metric_key varchar(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        name varchar(160) NOT NULL,
        normalized_name varchar(160) NOT NULL,
        aliases_json json NOT NULL,
        normalized_aliases_json json NOT NULL,
        search_text text NOT NULL,
        definition_json json NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'verified',
        version int unsigned NOT NULL DEFAULT 1,
        fingerprint char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        source_report_code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NULL,
        source_conversation_id varchar(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
        source_op_id varchar(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
        created_by bigint unsigned NULL,
        accepted_count int unsigned NOT NULL DEFAULT 0,
        rejected_count int unsigned NOT NULL DEFAULT 0,
        last_used_at timestamp NULL,
        last_validated_at timestamp NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_tenant_metric_key (tenant_id, metric_key),
        KEY idx_metric_tenant_status_name (tenant_id, status, normalized_name),
        KEY idx_metric_tenant_fingerprint (tenant_id, fingerprint)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS report_metric_knowledge_proposal (
        id bigint unsigned NOT NULL AUTO_INCREMENT,
        proposal_key char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        tenant_id bigint unsigned NOT NULL,
        report_code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        conversation_id varchar(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
        dsh_session_id varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        metric_key varchar(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        name varchar(160) NOT NULL,
        normalized_name varchar(160) NOT NULL,
        aliases_json json NOT NULL,
        normalized_aliases_json json NOT NULL,
        definition_json json NOT NULL,
        fingerprint char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        action varchar(20) NOT NULL,
        confirmed tinyint NOT NULL DEFAULT 0,
        validated tinyint NOT NULL DEFAULT 0,
        status varchar(20) NOT NULL DEFAULT 'pending',
        previous_json json NULL,
        published_version int unsigned NULL,
        source_op_id varchar(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
        created_by bigint unsigned NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_metric_proposal_key (proposal_key),
        KEY idx_metric_proposal_session (tenant_id, report_code, dsh_session_id, status),
        KEY idx_metric_proposal_metric (tenant_id, metric_key, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS tenant_bi_feedback (
        id bigint unsigned NOT NULL AUTO_INCREMENT,
        tenant_id bigint unsigned NOT NULL,
        knowledge_type varchar(30) NOT NULL,
        knowledge_key varchar(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        action varchar(20) NOT NULL,
        before_json json NULL,
        after_json json NULL,
        reason varchar(500) NULL,
        conversation_id varchar(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
        report_code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NULL,
        user_id bigint unsigned NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_feedback_knowledge (tenant_id, knowledge_type, knowledge_key, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [tables] = await connection.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_name IN ('tenant_metric_knowledge', 'report_metric_knowledge_proposal', 'tenant_bi_feedback') ORDER BY table_name",
      [getConfig().database],
    );
    console.table(tables);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Metric knowledge database initialization failed", error.message);
  process.exitCode = 1;
});

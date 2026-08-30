const fs = require("node:fs");
const { randomInt } = require("node:crypto");
const mysql = require("mysql2/promise");
const { readDatabaseConfig, initializeSqliteDatabase } = require("./lib/config.cjs");

function getConfig() {
  return readDatabaseConfig();
}

function generatePublicLinkPassword() {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

async function findFolder(db, tenantId, parentId, name) {
  const [rows] = await db.query(
    "SELECT id FROM tenant_report_folder WHERE tenant_id = ? AND parent_id <=> ? AND name = ? LIMIT 1",
    [tenantId, parentId, name],
  );
  return rows[0]?.id ? Number(rows[0].id) : null;
}

async function ensureFolder(db, { tenantId, parentId, name, isDefault = 0, sortOrder = 0 }) {
  const existingId = await findFolder(db, tenantId, parentId, name);
  if (existingId) return existingId;

  const [result] = await db.execute(
    "INSERT INTO tenant_report_folder (tenant_id, parent_id, name, is_default, sort_order, created_by) VALUES (?, ?, ?, ?, ?, NULL)",
    [tenantId, parentId, name, isDefault, sortOrder],
  );
  return Number(result.insertId);
}

async function upsertReport(db, report) {
  await db.execute(
    `INSERT INTO tenant_report
      (tenant_id, folder_id, code, name, owner_id, owner_name, status, views, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        folder_id = VALUES(folder_id), name = VALUES(name), owner_id = VALUES(owner_id),
        owner_name = VALUES(owner_name), status = VALUES(status), views = VALUES(views),
        updated_at = VALUES(updated_at)`,
    [report.tenantId, report.folderId, report.code, report.name, report.ownerId, report.ownerName, report.status, report.views, report.updatedAt],
  );
}

async function ensureGlobalReportCodeIndex(db) {
  await db.query("ALTER TABLE tenant_report MODIFY code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL");
  const [indexes] = await db.query("SHOW INDEX FROM tenant_report");
  const hasScopedIndex = indexes.some((index) => index.Key_name === "uq_report_tenant_code");
  const hasGlobalIndex = indexes.some((index) => index.Key_name === "uq_report_code");

  if (hasScopedIndex) {
    await db.query("ALTER TABLE tenant_report DROP INDEX uq_report_tenant_code");
  }
  if (!hasGlobalIndex) {
    await db.query("ALTER TABLE tenant_report ADD UNIQUE KEY uq_report_code (code)");
  }
}

async function main() {
  const databaseConfig = getConfig();
  if (databaseConfig.kind === "sqlite") {
    await initializeSqliteDatabase(databaseConfig);
    console.log(`SQLite reports initialized at ${databaseConfig.path}`);
    return;
  }

  const db = await mysql.createConnection(databaseConfig);
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS tenant_report_folder (
        id bigint unsigned NOT NULL AUTO_INCREMENT,
        tenant_id bigint unsigned NOT NULL,
        parent_id bigint unsigned NULL,
        name varchar(100) NOT NULL,
        is_default tinyint NOT NULL DEFAULT 0,
        sort_order int NOT NULL DEFAULT 0,
        created_by bigint unsigned NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_report_folder_tenant_parent (tenant_id, parent_id),
        KEY idx_report_folder_tenant_default (tenant_id, is_default)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS tenant_report (
        id bigint unsigned NOT NULL AUTO_INCREMENT,
        tenant_id bigint unsigned NOT NULL,
        folder_id bigint unsigned NOT NULL,
        code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        name varchar(160) NOT NULL,
        owner_id bigint unsigned NULL,
        owner_name varchar(64) NOT NULL,
        status varchar(20) NOT NULL DEFAULT '草稿',
        views int unsigned NOT NULL DEFAULT 0,
        definition_json longtext NULL,
        working_commit_hash varchar(64) NULL,
        current_working_revision bigint unsigned NOT NULL DEFAULT 0,
        current_release_version int unsigned NULL,
        release_status varchar(20) NOT NULL DEFAULT '未发布',
        public_link_enabled tinyint NOT NULL DEFAULT 0,
        deleted_at timestamp NULL,
        deleted_by bigint unsigned NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_report_tenant_folder (tenant_id, folder_id),
        KEY idx_report_tenant_status (tenant_id, status),
        UNIQUE KEY uq_report_code (code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS report_ai_conversation (
        id bigint unsigned NOT NULL AUTO_INCREMENT,
        tenant_id bigint unsigned NOT NULL,
        report_code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        conversation_id varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        title varchar(160) NOT NULL,
        created_by bigint unsigned NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        dsh_session_id varchar(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_ai_conversation (tenant_id, report_code, conversation_id),
        KEY idx_ai_conversation_recent (tenant_id, report_code, updated_at, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    try {
      await db.query("ALTER TABLE tenant_report ADD COLUMN public_link_enabled tinyint NOT NULL DEFAULT 0");
    } catch (error) {
      if (!/^ER_DUP_/.test(String(error?.code || "")) && !/duplicate column/i.test(String(error?.message || ""))) throw error;
    }
    for (const column of [
      "ADD COLUMN deleted_at timestamp NULL",
      "ADD COLUMN deleted_by bigint unsigned NULL",
    ]) {
      try {
        await db.query(`ALTER TABLE tenant_report ${column}`);
      } catch (error) {
        if (!/^ER_DUP_/.test(String(error?.code || "")) && !/duplicate column/i.test(String(error?.message || ""))) throw error;
      }
    }
    await ensureGlobalReportCodeIndex(db);
    await db.query(`
      CREATE TABLE IF NOT EXISTS report_public_link (
        id bigint unsigned NOT NULL AUTO_INCREMENT,
        tenant_id bigint unsigned NOT NULL,
        report_code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        short_code varchar(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        enabled tinyint NOT NULL DEFAULT 1,
        password_enabled tinyint NOT NULL DEFAULT 0,
        password varchar(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        expires_at datetime NULL,
        created_by bigint unsigned NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at timestamp NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_report_public_link_code (short_code),
        KEY idx_report_public_link_report (tenant_id, report_code, enabled, revoked_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const publicLinkColumns = [
      "ADD COLUMN password_enabled tinyint NOT NULL DEFAULT 0",
      "ADD COLUMN password varchar(4) CHARACTER SET ascii COLLATE ascii_bin NULL",
      "ADD COLUMN expires_at datetime NULL",
    ];
    for (const column of publicLinkColumns) {
      try {
        await db.query(`ALTER TABLE report_public_link ${column}`);
      } catch (error) {
        if (!/^ER_DUP_/.test(String(error?.code || "")) && !/duplicate column/i.test(String(error?.message || ""))) throw error;
      }
    }
    await db.query("ALTER TABLE report_public_link MODIFY password_enabled tinyint NOT NULL DEFAULT 0");
    const [linksMissingPassword] = await db.query("SELECT id FROM report_public_link WHERE password IS NULL");
    for (const link of linksMissingPassword) {
      await db.execute("UPDATE report_public_link SET password = ? WHERE id = ? AND password IS NULL", [generatePublicLinkPassword(), link.id]);
    }
    await db.query("ALTER TABLE report_public_link MODIFY password varchar(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL");

    const tenantId = 1;
    const [users] = await db.query("SELECT id, name FROM tenant_user WHERE tenant_id = ? ORDER BY id ASC LIMIT 1", [tenantId]);
    const ownerId = users[0]?.id ? Number(users[0].id) : null;
    const ownerName = users[0]?.name || "管理员";
    const defaultFolderId = await ensureFolder(db, { tenantId, parentId: null, name: "默认目录", isDefault: 1 });
    const salesFolderId = await ensureFolder(db, { tenantId, parentId: defaultFolderId, name: "销售分析", sortOrder: 1 });
    const operationsFolderId = await ensureFolder(db, { tenantId, parentId: defaultFolderId, name: "运营监控", sortOrder: 2 });
    const financeFolderId = await ensureFolder(db, { tenantId, parentId: null, name: "财务专题", sortOrder: 1 });

    const reports = [
      { folderId: defaultFolderId, code: "RPT-001", name: "CEO 总览看板", ownerName: "管理员", status: "已发布", views: 512, updatedAt: "2026-08-13 11:05:00" },
      { folderId: salesFolderId, code: "RPT-002", name: "区域销售驾驶舱", ownerName: "数据分析师", status: "已发布", views: 283, updatedAt: "2026-08-13 09:36:00" },
      { folderId: salesFolderId, code: "RPT-003", name: "渠道转化漏斗", ownerName: "管理员", status: "草稿", views: 141, updatedAt: "2026-08-12 20:10:00" },
      { folderId: operationsFolderId, code: "RPT-004", name: "活动投放看板", ownerName: "运营负责人", status: "已发布", views: 96, updatedAt: "2026-08-13 08:58:00" },
      { folderId: financeFolderId, code: "RPT-005", name: "利润结构分析", ownerName: "财务负责人", status: "草稿", views: 77, updatedAt: "2026-08-12 16:22:00" },
    ];

    for (const report of reports) {
      await upsertReport(db, { ...report, tenantId, ownerId });
    }

    const [folders] = await db.query("SELECT id, parent_id, name, is_default FROM tenant_report_folder WHERE tenant_id = ? ORDER BY id", [tenantId]);
    const [savedReports] = await db.query("SELECT id, folder_id, code, name, status, views, updated_at FROM tenant_report WHERE tenant_id = ? ORDER BY id", [tenantId]);
    console.log("Report folders initialized:");
    console.table(folders);
    console.log("Reports initialized:");
    console.table(savedReports);
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("Report initialization failed", error);
  process.exitCode = 1;
});

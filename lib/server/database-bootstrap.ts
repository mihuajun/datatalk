import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";

import { getDatabaseConfig } from "@/lib/server/database-config";
import { createSalt, hashPassword } from "@/lib/server/password";
import { RELEASE_CATEGORY_DEFAULTS } from "@/lib/server/release-category-defaults";
import { RESOURCE_CATEGORY_DEFAULTS } from "@/lib/server/resource-category-defaults";
import { initializeSqliteDatabase } from "@/lib/server/sqlite-bootstrap";

const DEFAULT_TENANT_ID = 1;
const DEFAULT_TENANT_CODE = "default";
const DEFAULT_TENANT_NAME = "默认租户";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin";
const DEFAULT_DEV_USERNAME = "dev";
const DEFAULT_DEV_PASSWORD = "dev";

let bootstrapPromise: Promise<void> | null = null;

function bootstrapEnabled() {
  const value = process.env.AUTO_INIT_DATABASE?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off");
}

async function addColumnIfMissing(connection: Connection, tableName: string, column: string, definition: string) {
  const [rows] = await connection.query<RowDataPacket[]>(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [column]);
  if (rows.length === 0) {
    await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${column} ${definition}`);
    return true;
  }
  return false;
}

async function addIndexIfMissing(connection: Connection, tableName: string, indexName: string, definition: string) {
  const [rows] = await connection.query<RowDataPacket[]>(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [indexName]);
  if (rows.length === 0) await connection.query(`ALTER TABLE ${tableName} ADD ${definition}`);
}

async function dropIndexIfExists(connection: Connection, tableName: string, indexName: string) {
  const [rows] = await connection.query<RowDataPacket[]>(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [indexName]);
  if (rows.length > 0) await connection.query(`ALTER TABLE ${tableName} DROP INDEX ${indexName}`);
}

async function removeSupersededReportTemplateResources(connection: Connection) {
  const [rows] = await connection.query<Array<RowDataPacket & {
    id: number;
    tenant_id: number;
    asset_type: "report" | "template";
    source_code: string;
  }>>(
    `SELECT id, tenant_id, asset_type, source_code
       FROM resource_item
      WHERE asset_type IN ('report', 'template')
      ORDER BY tenant_id ASC,
               LOWER(source_code) ASC,
               COALESCE(published_at, updated_at, created_at) DESC,
               id DESC`,
  );
  const seen = new Set<string>();
  const superseded = rows.filter((row) => {
    const key = `${row.tenant_id}:${row.source_code.toLowerCase()}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  if (!superseded.length) return;

  await connection.beginTransaction();
  try {
    for (const row of superseded) {
      const resourceKey = [row.tenant_id, row.asset_type, row.source_code];
      await connection.execute(
        "DELETE FROM resource_favorite WHERE tenant_id = ? AND asset_type = ? AND source_code = ?",
        resourceKey,
      );
      await connection.execute(
        "DELETE FROM resource_like WHERE tenant_id = ? AND asset_type = ? AND source_code = ?",
        resourceKey,
      );
      await connection.execute("DELETE FROM resource_item WHERE id = ?", [row.id]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function ensureTenantTable(connection: Connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS tenant (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      code varchar(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name varchar(120) NOT NULL,
      status tinyint NOT NULL DEFAULT 1,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_tenant_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [codeRows] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM tenant LIKE 'code'");
  if (codeRows.length === 0) {
    await connection.query(
      "ALTER TABLE tenant ADD COLUMN code varchar(60) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER id",
    );
  }

  await addColumnIfMissing(connection, "tenant", "status", "tinyint NOT NULL DEFAULT 1 AFTER name");
  await addColumnIfMissing(connection, "tenant", "created_at", "timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP");
  await addColumnIfMissing(
    connection,
    "tenant",
    "updated_at",
    "timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
  );

  await connection.query(
    `UPDATE tenant
        SET code = CASE
          WHEN id = ? THEN ?
          ELSE CONCAT('tenant-', CAST(id AS CHAR))
        END
      WHERE code IS NULL OR code = ''`,
    [DEFAULT_TENANT_ID, DEFAULT_TENANT_CODE],
  );

  await connection.query(
    "ALTER TABLE tenant MODIFY COLUMN code varchar(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
  );
  await addIndexIfMissing(connection, "tenant", "uq_tenant_code", "UNIQUE KEY uq_tenant_code (code)");

  await connection.execute(
    `INSERT INTO tenant (id, code, name, status)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE id = id`,
    [DEFAULT_TENANT_ID, DEFAULT_TENANT_CODE, DEFAULT_TENANT_NAME],
  );
}

async function ensureTenantUserTable(connection: Connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS tenant_user (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      tenant_id bigint unsigned NOT NULL,
      name varchar(80) NOT NULL,
      username varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      phone varchar(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
      email varchar(160) NULL,
      role varchar(20) NOT NULL DEFAULT 'developer',
      password varchar(255) NOT NULL,
      salt varchar(64) NULL,
      status tinyint NOT NULL DEFAULT 1,
      last_active timestamp NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tenant_user_tenant (tenant_id),
      UNIQUE KEY uq_tenant_user_username (username),
      UNIQUE KEY uq_tenant_user_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(connection, "tenant_user", "email", "varchar(160) NULL AFTER username");
  await addColumnIfMissing(connection, "tenant_user", "phone", "varchar(20) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER username");
  await addColumnIfMissing(connection, "tenant_user", "role", "varchar(20) NOT NULL DEFAULT 'developer' AFTER email");
  await addColumnIfMissing(connection, "tenant_user", "last_active", "timestamp NULL AFTER status");
  await addIndexIfMissing(connection, "tenant_user", "uq_tenant_user_phone", "UNIQUE KEY uq_tenant_user_phone (phone)");
  await connection.execute(
    `UPDATE tenant_user
        SET role = CASE
          WHEN LOWER(TRIM(role)) IN ('administrator', 'adminstrator', 'super_admin', 'superadmin') OR role = '超级管理员' THEN 'administrator'
          WHEN role IN ('管理员', '租户管理员') THEN 'admin'
          WHEN role = '开发者' THEN 'developer'
          ELSE role
        END
      WHERE LOWER(TRIM(role)) IN ('administrator', 'adminstrator', 'super_admin', 'superadmin')
         OR role IN ('超级管理员', '管理员', '租户管理员', '开发者')`,
  );
}

async function ensureReportTables(connection: Connection) {
  await connection.query(`
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
  await connection.query(`
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
  await connection.query(`
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
  await connection.query(`
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
  await connection.query(`
    CREATE TABLE IF NOT EXISTS report_edit_audit (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      tenant_id bigint unsigned NOT NULL,
      report_code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      user_id bigint unsigned NOT NULL,
      op_id varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      action varchar(20) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'pending',
      base_commit_hash varchar(64) NULL,
      commit_hash varchar(64) NULL,
      error_message varchar(500) NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_report_edit_audit_op (op_id),
      KEY idx_report_edit_audit_lookup (tenant_id, report_code, status, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS report_pending_audit (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      tenant_id bigint unsigned NOT NULL,
      report_code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      audit_id bigint unsigned NOT NULL,
      commit_hash varchar(64) NOT NULL,
      error_message varchar(500) NULL,
      status varchar(20) NOT NULL DEFAULT 'pending',
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_report_pending_audit_audit (audit_id),
      KEY idx_report_pending_audit_lookup (tenant_id, report_code, status, audit_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS report_release_category (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      tenant_id bigint unsigned NOT NULL,
      code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name varchar(100) NOT NULL,
      description varchar(255) NULL,
      sort_order int NOT NULL DEFAULT 0,
      created_by bigint unsigned NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_report_release_category_code (tenant_id, code),
      UNIQUE KEY uq_report_release_category_name (tenant_id, name),
      KEY idx_report_release_category_sort (tenant_id, sort_order, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS report_release (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      tenant_id bigint unsigned NOT NULL,
      report_code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      version int unsigned NOT NULL,
      source_commit_hash varchar(64) NULL,
      thumbnail_url varchar(500) NULL,
      publisher_tenant_name varchar(120) NULL,
      view_count int unsigned NOT NULL DEFAULT 0,
      like_count int unsigned NOT NULL DEFAULT 0,
      display_name varchar(160) NULL,
      remark varchar(500) NULL,
      description varchar(500) NULL,
      category_id bigint unsigned NULL,
      category_name varchar(100) NULL,
      status varchar(20) NOT NULL DEFAULT 'published',
      error_message varchar(500) NULL,
      created_by bigint unsigned NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_report_release_version (tenant_id, report_code, version),
      KEY idx_report_release_recent (tenant_id, report_code, created_at),
      KEY idx_report_release_category (tenant_id, category_id, category_name),
      KEY idx_report_release_popularity (tenant_id, view_count, like_count)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(connection, "tenant_report", "public_link_enabled", "tinyint NOT NULL DEFAULT 0");
  await addColumnIfMissing(connection, "tenant_report", "current_working_revision", "bigint unsigned NOT NULL DEFAULT 0");
  await addColumnIfMissing(connection, "tenant_report", "current_release_version", "int unsigned NULL");
  await addColumnIfMissing(connection, "tenant_report", "release_status", "varchar(20) NOT NULL DEFAULT '未发布'");
  await addColumnIfMissing(connection, "tenant_report", "deleted_at", "timestamp NULL");
  await addColumnIfMissing(connection, "tenant_report", "deleted_by", "bigint unsigned NULL");
  await addColumnIfMissing(connection, "report_ai_conversation", "dsh_session_id", "varchar(160) CHARACTER SET ascii COLLATE ascii_bin NULL");
  await addColumnIfMissing(connection, "report_public_link", "password_enabled", "tinyint NOT NULL DEFAULT 0");
  await addColumnIfMissing(connection, "report_public_link", "password", "varchar(4) CHARACTER SET ascii COLLATE ascii_bin NULL");
  await addColumnIfMissing(connection, "report_public_link", "expires_at", "datetime NULL");
  await addColumnIfMissing(connection, "report_release", "thumbnail_url", "varchar(500) NULL AFTER source_commit_hash");
  await addColumnIfMissing(connection, "report_release", "publisher_tenant_name", "varchar(120) NULL AFTER thumbnail_url");
  await addColumnIfMissing(connection, "report_release", "view_count", "int unsigned NOT NULL DEFAULT 0 AFTER publisher_tenant_name");
  await addColumnIfMissing(connection, "report_release", "like_count", "int unsigned NOT NULL DEFAULT 0 AFTER view_count");
  await addColumnIfMissing(connection, "report_release", "display_name", "varchar(160) NULL AFTER like_count");
  await addColumnIfMissing(connection, "report_release", "remark", "varchar(500) NULL AFTER display_name");
  await addColumnIfMissing(connection, "report_release", "description", "varchar(500) NULL AFTER remark");
  await addColumnIfMissing(connection, "report_release", "category_id", "bigint unsigned NULL AFTER description");
  await addColumnIfMissing(connection, "report_release", "category_name", "varchar(100) NULL AFTER category_id");
  await addColumnIfMissing(connection, "report_release", "updated_at", "timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
  await addIndexIfMissing(connection, "report_release", "idx_report_release_category", "KEY idx_report_release_category (tenant_id, category_id, category_name)");
  await addIndexIfMissing(connection, "report_release", "idx_report_release_popularity", "KEY idx_report_release_popularity (tenant_id, view_count, like_count)");
}

async function ensureResourceTables(connection: Connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS resource_category (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      asset_type varchar(30) NOT NULL DEFAULT 'report',
      parent_id bigint unsigned NULL,
      code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name varchar(100) NOT NULL,
      sort_order int NOT NULL DEFAULT 0,
      enabled tinyint NOT NULL DEFAULT 1,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_resource_category_type_code (asset_type, code),
      KEY idx_resource_category_type_parent (asset_type, parent_id, enabled, sort_order, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS resource_item (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      tenant_id bigint unsigned NOT NULL,
      asset_type varchar(30) NOT NULL,
      source_code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_version int unsigned NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'draft',
      title varchar(160) NOT NULL,
      summary varchar(500) NULL,
      thumbnail_url varchar(500) NULL,
      category_id bigint unsigned NULL,
      view_count int unsigned NOT NULL DEFAULT 0,
      favorite_count int unsigned NOT NULL DEFAULT 0,
      like_count int unsigned NOT NULL DEFAULT 0,
      content_updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
      submitted_by bigint unsigned NULL,
      submitted_at timestamp NULL,
      published_by bigint unsigned NULL,
      published_at timestamp NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_resource_item_source (tenant_id, asset_type, source_code),
      KEY idx_resource_item_status (status, updated_at),
      KEY idx_resource_item_publish (published_at),
      KEY idx_resource_item_category (category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(connection, "resource_category", "asset_type", "varchar(30) NOT NULL DEFAULT 'report' AFTER id");
  await addColumnIfMissing(connection, "resource_category", "parent_id", "bigint unsigned NULL AFTER id");
  await addColumnIfMissing(connection, "resource_category", "sort_order", "int NOT NULL DEFAULT 0 AFTER name");
  await addColumnIfMissing(connection, "resource_category", "enabled", "tinyint NOT NULL DEFAULT 1 AFTER sort_order");
  await addColumnIfMissing(connection, "resource_category", "created_at", "timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP");
  await addColumnIfMissing(connection, "resource_category", "updated_at", "timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
  await dropIndexIfExists(connection, "resource_category", "uq_resource_category_code");
  await addIndexIfMissing(connection, "resource_category", "uq_resource_category_type_code", "UNIQUE KEY uq_resource_category_type_code (asset_type, code)");
  await addIndexIfMissing(connection, "resource_category", "idx_resource_category_parent", "KEY idx_resource_category_parent (parent_id, enabled, sort_order, id)");
  await addIndexIfMissing(connection, "resource_category", "idx_resource_category_type_parent", "KEY idx_resource_category_type_parent (asset_type, parent_id, enabled, sort_order, id)");

  await addColumnIfMissing(connection, "resource_item", "tenant_id", "bigint unsigned NOT NULL AFTER id");
  await addColumnIfMissing(connection, "resource_item", "asset_type", "varchar(30) NOT NULL AFTER tenant_id");
  await addColumnIfMissing(connection, "resource_item", "source_code", "varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL AFTER asset_type");
  await addColumnIfMissing(connection, "resource_item", "source_version", "int unsigned NOT NULL AFTER source_code");
  await addColumnIfMissing(connection, "resource_item", "status", "varchar(20) NOT NULL DEFAULT 'draft' AFTER source_version");
  await addColumnIfMissing(connection, "resource_item", "title", "varchar(160) NOT NULL AFTER status");
  await addColumnIfMissing(connection, "resource_item", "summary", "varchar(500) NULL AFTER title");
  await addColumnIfMissing(connection, "resource_item", "thumbnail_url", "varchar(500) NULL AFTER summary");
  await addColumnIfMissing(connection, "resource_item", "category_id", "bigint unsigned NULL AFTER thumbnail_url");
  await addColumnIfMissing(connection, "resource_item", "view_count", "int unsigned NOT NULL DEFAULT 0 AFTER category_id");
  await addColumnIfMissing(connection, "resource_item", "favorite_count", "int unsigned NOT NULL DEFAULT 0 AFTER view_count");
  const resourceLikeCountAdded = await addColumnIfMissing(connection, "resource_item", "like_count", "int unsigned NOT NULL DEFAULT 0 AFTER favorite_count");
  await addColumnIfMissing(connection, "resource_item", "content_updated_at", "timestamp NULL DEFAULT CURRENT_TIMESTAMP AFTER favorite_count");
  await addColumnIfMissing(connection, "resource_item", "submitted_by", "bigint unsigned NULL AFTER content_updated_at");
  await addColumnIfMissing(connection, "resource_item", "submitted_at", "timestamp NULL AFTER submitted_by");
  await addColumnIfMissing(connection, "resource_item", "published_by", "bigint unsigned NULL AFTER submitted_at");
  await addColumnIfMissing(connection, "resource_item", "published_at", "timestamp NULL AFTER published_by");
  await addColumnIfMissing(connection, "resource_item", "created_at", "timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP");
  await addColumnIfMissing(connection, "resource_item", "updated_at", "timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
  await addIndexIfMissing(connection, "resource_item", "uq_resource_item_source", "UNIQUE KEY uq_resource_item_source (tenant_id, asset_type, source_code)");
  await addIndexIfMissing(connection, "resource_item", "idx_resource_item_status", "KEY idx_resource_item_status (status, updated_at)");
  await addIndexIfMissing(connection, "resource_item", "idx_resource_item_publish", "KEY idx_resource_item_publish (published_at)");
  await addIndexIfMissing(connection, "resource_item", "idx_resource_item_category", "KEY idx_resource_item_category (category_id)");
  await connection.query(`
    CREATE TABLE IF NOT EXISTS resource_favorite (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      tenant_id bigint unsigned NOT NULL,
      user_id bigint unsigned NOT NULL,
      asset_type varchar(30) NOT NULL,
      source_code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_resource_favorite_user_asset (tenant_id, user_id, asset_type, source_code),
      KEY idx_resource_favorite_user (tenant_id, user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS resource_like (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      tenant_id bigint unsigned NOT NULL,
      visitor_key varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      asset_type varchar(30) NOT NULL,
      source_code varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_resource_like_visitor_asset (tenant_id, visitor_key, asset_type, source_code),
      KEY idx_resource_like_asset (tenant_id, asset_type, source_code, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  if (resourceLikeCountAdded) {
    await connection.query(`
      UPDATE resource_item ri
      LEFT JOIN (
        SELECT tenant_id, asset_type, source_code, COUNT(*) AS favorite_count
          FROM resource_favorite
         GROUP BY tenant_id, asset_type, source_code
      ) favorites
        ON favorites.tenant_id = ri.tenant_id
       AND favorites.asset_type = ri.asset_type
       AND favorites.source_code = ri.source_code
         SET ri.like_count = GREATEST(COALESCE(ri.favorite_count, 0) - COALESCE(favorites.favorite_count, 0), 0),
             ri.favorite_count = COALESCE(favorites.favorite_count, 0)
    `);
  }
  await addColumnIfMissing(
    connection,
    "resource_item",
    "report_template_source_code",
    "varchar(50) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN asset_type IN ('report', 'template') THEN LOWER(source_code) ELSE NULL END) STORED AFTER source_code",
  );
  await removeSupersededReportTemplateResources(connection);
  await addIndexIfMissing(
    connection,
    "resource_item",
    "uq_resource_item_report_template_source",
    "UNIQUE KEY uq_resource_item_report_template_source (tenant_id, report_template_source_code)",
  );
}

async function ensureDataSourceTables(connection: Connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS tenant_data_source (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      tenant_id bigint unsigned NOT NULL,
      name varchar(100) NOT NULL,
      type varchar(30) NOT NULL,
      host varchar(255) NOT NULL,
      port int unsigned NULL,
      database_name varchar(160) NULL,
      username varchar(160) NULL,
      password varchar(255) NULL,
      status varchar(20) NOT NULL DEFAULT '在线',
      owner varchar(64) NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tenant_data_source_tenant (tenant_id),
      UNIQUE KEY uq_tenant_data_source_name (tenant_id, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureMetricKnowledgeTables(connection: Connection) {
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
}

async function ensureDefaultUser(connection: Connection, input: { name: string; username: string; email: string; role: string; password: string }) {
  const [rows] = await connection.query<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM tenant_user WHERE tenant_id = ? AND username = ? LIMIT 1",
    [DEFAULT_TENANT_ID, input.username],
  );

  if (!rows[0]) {
    const salt = createSalt();
    await connection.execute(
      `INSERT INTO tenant_user
        (tenant_id, name, username, email, role, password, salt, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [DEFAULT_TENANT_ID, input.name, input.username, input.email, input.role, hashPassword(input.password, salt), salt],
    );
    return;
  }

  await connection.execute(
    `UPDATE tenant_user
        SET email = CASE WHEN email IS NULL OR email = '' THEN ? ELSE email END,
            status = 1
      WHERE id = ?`,
    [input.email, Number(rows[0].id)],
  );
}

async function ensureDefaultUsers(connection: Connection) {
  const [guestRows] = await connection.query<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM tenant_user WHERE tenant_id = ? AND username = ? LIMIT 1",
    [DEFAULT_TENANT_ID, "guest"],
  );
  const [adminRows] = await connection.query<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM tenant_user WHERE tenant_id = ? AND username = ? LIMIT 1",
    [DEFAULT_TENANT_ID, DEFAULT_ADMIN_USERNAME],
  );

  if (!adminRows[0] && guestRows[0]) {
    const salt = createSalt();
    await connection.execute(
      `UPDATE tenant_user
          SET name = ?, username = ?, email = ?, role = ?, password = ?, salt = ?, status = 1
        WHERE id = ?`,
      ["管理员", DEFAULT_ADMIN_USERNAME, "admin@datatalk.local", "admin", hashPassword(DEFAULT_ADMIN_PASSWORD, salt), salt, Number(guestRows[0].id)],
    );
  } else if (adminRows[0] && guestRows[0]) {
    await connection.execute("UPDATE tenant_user SET status = 0 WHERE id = ?", [Number(guestRows[0].id)]);
  }

  await ensureDefaultUser(connection, {
    name: "管理员",
    username: DEFAULT_ADMIN_USERNAME,
    email: "admin@datatalk.local",
    role: "admin",
    password: DEFAULT_ADMIN_PASSWORD,
  });
  await ensureDefaultUser(connection, {
    name: "开发者",
    username: DEFAULT_DEV_USERNAME,
    email: "dev@datatalk.local",
    role: "developer",
    password: DEFAULT_DEV_PASSWORD,
  });
}

async function ensureDefaultReleaseCategories(connection: Connection) {
  const [tenantRows] = await connection.query<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM tenant ORDER BY id ASC",
  );
  const tenantIds = tenantRows.length > 0 ? tenantRows.map((row) => Number(row.id)) : [DEFAULT_TENANT_ID];

  for (const tenantId of tenantIds) {
    for (const category of RELEASE_CATEGORY_DEFAULTS) {
      await connection.execute(
        `INSERT INTO report_release_category
          (tenant_id, code, name, description, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           description = VALUES(description),
           sort_order = VALUES(sort_order)`,
        [tenantId, category.code, category.name, category.description, category.sortOrder],
      );
    }
  }
}

async function ensureDefaultResourceCategories(connection: Connection) {
  const assetTypes = [...new Set(RESOURCE_CATEGORY_DEFAULTS.map((category) => category.assetType))];
  for (const assetType of assetTypes) {
    await connection.execute("UPDATE resource_category SET enabled = 0 WHERE asset_type = ?", [assetType]);
  }
  for (const category of RESOURCE_CATEGORY_DEFAULTS) {
    let parentId: number | null = null;
    if (category.parentCode) {
      const [parentRows] = await connection.query<Array<RowDataPacket & { id: number }>>(
        "SELECT id FROM resource_category WHERE asset_type = ? AND code = ? LIMIT 1",
        [category.assetType, category.parentCode],
      );
      parentId = parentRows[0] ? Number(parentRows[0].id) : null;
    }

    await connection.execute(
      `INSERT INTO resource_category
        (asset_type, parent_id, code, name, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         parent_id = VALUES(parent_id),
         name = VALUES(name),
         sort_order = VALUES(sort_order),
         enabled = VALUES(enabled)`,
      [category.assetType, parentId, category.code, category.name, category.sortOrder],
    );
  }
}

async function migrateLegacyResourceCategoryReferences(connection: Connection) {
  const mappings: Record<string, string> = {
    overview: "enterprise-operations",
    "growth-marketing": "marketing-growth",
    "product-supply": "supply-operations",
    "customer-service": "users-customers",
    "finance-organization": "finance-analysis",
    "data-building": "industry-public",
    "key-metrics": "enterprise-operations",
    "trend-overview": "industry-research",
    "channel-campaign": "marketing-campaign",
    "user-growth": "users-customers",
    "inventory-supply": "supply-operations",
    "procurement-fulfillment": "fulfillment",
    "customer-operations": "users-customers",
    "service-after-sales": "customer-service",
    "risk-alert": "enterprise-operations",
    "organization-efficiency": "organization-effectiveness",
    "subject-dataset": "industry-public",
    "metric-model": "industry-public",
    "dimension-dictionary": "industry-public",
    other: "industry-public",
    healthcare: "industry-research",
  };

  for (const [legacyCode, targetCode] of Object.entries(mappings)) {
    const [legacyRows] = await connection.query<Array<RowDataPacket & { id: number; enabled: number }>>(
      "SELECT id, enabled FROM resource_category WHERE asset_type = 'report' AND code = ? LIMIT 1",
      [legacyCode],
    );
    const legacy = legacyRows[0];
    if (!legacy || Number(legacy.enabled) === 1) continue;
    const [targetRows] = await connection.query<Array<RowDataPacket & { id: number }>>(
      "SELECT id FROM resource_category WHERE asset_type = 'report' AND code = ? AND enabled = 1 LIMIT 1",
      [targetCode],
    );
    const target = targetRows[0];
    if (!target || Number(target.id) === Number(legacy.id)) continue;
    await connection.execute(
      "UPDATE resource_item SET category_id = ? WHERE asset_type = 'report' AND category_id = ?",
      [target.id, legacy.id],
    );
  }
}

async function runBootstrap() {
  const config = getDatabaseConfig();
  if (config.kind === "sqlite") {
    await initializeSqliteDatabase(config);
    return;
  }

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    connectTimeout: 10000,
    multipleStatements: false,
  });

  try {
    await ensureTenantTable(connection);
    await ensureTenantUserTable(connection);
    await ensureReportTables(connection);
    await ensureResourceTables(connection);
    await ensureDataSourceTables(connection);
    await ensureMetricKnowledgeTables(connection);
    await ensureDefaultUsers(connection);
    await ensureDefaultReleaseCategories(connection);
    await ensureDefaultResourceCategories(connection);
    await migrateLegacyResourceCategoryReferences(connection);
  } finally {
    await connection.end();
  }
}

export async function ensureDatabaseBootstrap() {
  if (!bootstrapEnabled()) return;
  bootstrapPromise ??= runBootstrap();
  await bootstrapPromise;
}

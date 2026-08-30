import fs from "node:fs";
import path from "node:path";

import type { DatabaseSync } from "node:sqlite";

import type { SqliteDatabaseConfig } from "@/lib/server/database-config";
import { createSalt, hashPassword } from "@/lib/server/password";

const DEFAULT_TENANT_ID = 1;
const DEFAULT_TENANT_CODE = "default";
const DEFAULT_TENANT_NAME = "默认租户";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin";
const DEFAULT_DEV_USERNAME = "dev";
const DEFAULT_DEV_PASSWORD = "dev";

type SqliteModule = typeof import("node:sqlite");
let sqliteModule: Promise<SqliteModule> | undefined;

function loadSqlite() {
  return sqliteModule ??= import("node:sqlite");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenant (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'developer',
  password TEXT NOT NULL,
  salt TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  last_active TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_report_folder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  parent_id INTEGER,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  folder_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_id INTEGER,
  owner_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '草稿',
  views INTEGER NOT NULL DEFAULT 0,
  definition_json TEXT,
  working_commit_hash TEXT,
  current_working_revision INTEGER NOT NULL DEFAULT 0,
  current_release_version INTEGER,
  release_status TEXT NOT NULL DEFAULT '未发布',
  public_link_enabled INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  deleted_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_ai_conversation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  report_code TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dsh_session_id TEXT
);

CREATE TABLE IF NOT EXISTS report_public_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  report_code TEXT NOT NULL,
  short_code TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  password_enabled INTEGER NOT NULL DEFAULT 0,
  password TEXT NOT NULL,
  expires_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS report_edit_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  report_code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  op_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  base_commit_hash TEXT,
  commit_hash TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_pending_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  report_code TEXT NOT NULL,
  audit_id INTEGER NOT NULL,
  commit_hash TEXT NOT NULL,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_release (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  report_code TEXT NOT NULL,
  version INTEGER NOT NULL,
  source_commit_hash TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  error_message TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_data_source (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER,
  database_name TEXT,
  username TEXT,
  password TEXT,
  status TEXT NOT NULL DEFAULT '在线',
  owner TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_metric_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  metric_key TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  normalized_aliases_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'verified',
  version INTEGER NOT NULL DEFAULT 1,
  fingerprint TEXT NOT NULL,
  source_report_code TEXT,
  source_conversation_id TEXT,
  source_op_id TEXT,
  created_by INTEGER,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  last_validated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_metric_knowledge_proposal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_key TEXT NOT NULL,
  tenant_id INTEGER NOT NULL,
  report_code TEXT NOT NULL,
  conversation_id TEXT,
  dsh_session_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  normalized_aliases_json TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  action TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  validated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  previous_json TEXT,
  published_version INTEGER,
  source_op_id TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_bi_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  knowledge_type TEXT NOT NULL,
  knowledge_key TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  conversation_id TEXT,
  report_code TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_code ON tenant(code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_user_username ON tenant_user(username);
CREATE INDEX IF NOT EXISTS idx_tenant_user_tenant ON tenant_user(tenant_id);
CREATE INDEX IF NOT EXISTS idx_report_folder_tenant_parent ON tenant_report_folder(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_report_folder_tenant_default ON tenant_report_folder(tenant_id, is_default);
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_code ON tenant_report(code);
CREATE INDEX IF NOT EXISTS idx_report_tenant_folder ON tenant_report(tenant_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_report_tenant_status ON tenant_report(tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_conversation ON report_ai_conversation(tenant_id, report_code, conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversation_recent ON report_ai_conversation(tenant_id, report_code, updated_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_public_link_code ON report_public_link(short_code);
CREATE INDEX IF NOT EXISTS idx_report_public_link_report ON report_public_link(tenant_id, report_code, enabled, revoked_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_edit_audit_op ON report_edit_audit(op_id);
CREATE INDEX IF NOT EXISTS idx_report_edit_audit_lookup ON report_edit_audit(tenant_id, report_code, status, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_pending_audit_audit ON report_pending_audit(audit_id);
CREATE INDEX IF NOT EXISTS idx_report_pending_audit_lookup ON report_pending_audit(tenant_id, report_code, status, audit_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_release_version ON report_release(tenant_id, report_code, version);
CREATE INDEX IF NOT EXISTS idx_report_release_recent ON report_release(tenant_id, report_code, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_data_source_name ON tenant_data_source(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_tenant_data_source_tenant ON tenant_data_source(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_metric_key ON tenant_metric_knowledge(tenant_id, metric_key);
CREATE INDEX IF NOT EXISTS idx_metric_tenant_status_name ON tenant_metric_knowledge(tenant_id, status, normalized_name);
CREATE INDEX IF NOT EXISTS idx_metric_tenant_fingerprint ON tenant_metric_knowledge(tenant_id, fingerprint);
CREATE UNIQUE INDEX IF NOT EXISTS uq_metric_proposal_key ON report_metric_knowledge_proposal(proposal_key);
CREATE INDEX IF NOT EXISTS idx_metric_proposal_session ON report_metric_knowledge_proposal(tenant_id, report_code, dsh_session_id, status);
CREATE INDEX IF NOT EXISTS idx_metric_proposal_metric ON report_metric_knowledge_proposal(tenant_id, metric_key, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_knowledge ON tenant_bi_feedback(tenant_id, knowledge_type, knowledge_key, created_at);
`;

function execute(database: DatabaseSync, sql: string, values: unknown[] = []) {
  return database.prepare(sql).run(...values as never[]);
}

function queryOne<T extends Record<string, unknown>>(database: DatabaseSync, sql: string, values: unknown[] = []) {
  return database.prepare(sql).get(...values as never[]) as T | undefined;
}

function hasColumn(database: DatabaseSync, tableName: string, columnName: string) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return columns.some((column) => column.name === columnName);
}

function addColumnIfMissing(database: DatabaseSync, tableName: string, columnName: string, definition: string) {
  if (!hasColumn(database, tableName, columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function ensureFolder(database: DatabaseSync, input: { tenantId: number; parentId: number | null; name: string; isDefault?: number; sortOrder?: number }) {
  const existing = queryOne<{ id: number }>(
    database,
    "SELECT id FROM tenant_report_folder WHERE tenant_id = ? AND parent_id IS ? AND name = ? LIMIT 1",
    [input.tenantId, input.parentId, input.name],
  );
  if (existing) return Number(existing.id);

  const result = execute(
    database,
    "INSERT INTO tenant_report_folder (tenant_id, parent_id, name, is_default, sort_order, created_by) VALUES (?, ?, ?, ?, ?, NULL)",
    [input.tenantId, input.parentId, input.name, input.isDefault || 0, input.sortOrder || 0],
  );
  return Number(result.lastInsertRowid);
}

function seedTenant(database: DatabaseSync) {
  execute(
    database,
    `INSERT INTO tenant (id, code, name, status) VALUES (?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, status=1`,
    [DEFAULT_TENANT_ID, DEFAULT_TENANT_CODE, DEFAULT_TENANT_NAME],
  );
}

function insertDefaultUser(database: DatabaseSync, input: { name: string; username: string; email: string; role: string; password: string }) {
  const salt = createSalt();
  execute(
    database,
    `INSERT INTO tenant_user (tenant_id, name, username, email, role, password, salt, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [DEFAULT_TENANT_ID, input.name, input.username, input.email, input.role, hashPassword(input.password, salt), salt],
  );
}

function ensureDefaultUser(database: DatabaseSync, input: { name: string; username: string; email: string; role: string; password: string }) {
  const existing = queryOne<{ id: number }>(
    database,
    "SELECT id FROM tenant_user WHERE tenant_id=? AND username=? LIMIT 1",
    [DEFAULT_TENANT_ID, input.username],
  );

  if (!existing) {
    insertDefaultUser(database, input);
    return;
  }

  execute(
    database,
    `UPDATE tenant_user
        SET email = CASE WHEN email IS NULL OR email = '' THEN ? ELSE email END,
            status = 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [input.email, Number(existing.id)],
  );
}

function seedDefaultUsers(database: DatabaseSync) {
  execute(
    database,
    `UPDATE tenant_user
        SET role = CASE role WHEN '管理员' THEN 'admin' WHEN '开发者' THEN 'developer' ELSE role END
      WHERE role IN ('管理员', '开发者')`,
  );

  const guest = queryOne<{ id: number }>(
    database,
    "SELECT id FROM tenant_user WHERE tenant_id=? AND username=? LIMIT 1",
    [DEFAULT_TENANT_ID, "guest"],
  );
  const admin = queryOne<{ id: number }>(
    database,
    "SELECT id FROM tenant_user WHERE tenant_id=? AND username=? LIMIT 1",
    [DEFAULT_TENANT_ID, DEFAULT_ADMIN_USERNAME],
  );

  if (!admin && guest) {
    const salt = createSalt();
    execute(
      database,
      `UPDATE tenant_user
          SET name = ?, username = ?, email = ?, role = ?, password = ?, salt = ?, status = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      ["管理员", DEFAULT_ADMIN_USERNAME, "admin@datatalk.local", "admin", hashPassword(DEFAULT_ADMIN_PASSWORD, salt), salt, Number(guest.id)],
    );
  } else if (admin && guest) {
    execute(database, "UPDATE tenant_user SET status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [Number(guest.id)]);
  }

  ensureDefaultUser(database, {
    name: "管理员",
    username: DEFAULT_ADMIN_USERNAME,
    email: "admin@datatalk.local",
    role: "admin",
    password: DEFAULT_ADMIN_PASSWORD,
  });
  ensureDefaultUser(database, {
    name: "开发者",
    username: DEFAULT_DEV_USERNAME,
    email: "dev@datatalk.local",
    role: "developer",
    password: DEFAULT_DEV_PASSWORD,
  });
}

function seedReports(database: DatabaseSync) {
  const admin = queryOne<{ id: number; name: string }>(database, "SELECT id, name FROM tenant_user WHERE tenant_id=? AND username=? LIMIT 1", [DEFAULT_TENANT_ID, DEFAULT_ADMIN_USERNAME]);
  const ownerId = admin ? Number(admin.id) : null;
  const defaultFolderId = ensureFolder(database, { tenantId: DEFAULT_TENANT_ID, parentId: null, name: "默认目录", isDefault: 1 });
  const salesFolderId = ensureFolder(database, { tenantId: DEFAULT_TENANT_ID, parentId: defaultFolderId, name: "销售分析", sortOrder: 1 });
  const operationsFolderId = ensureFolder(database, { tenantId: DEFAULT_TENANT_ID, parentId: defaultFolderId, name: "运营监控", sortOrder: 2 });
  const financeFolderId = ensureFolder(database, { tenantId: DEFAULT_TENANT_ID, parentId: null, name: "财务专题", sortOrder: 1 });

  const reports = [
    { folderId: defaultFolderId, code: "RPT-001", name: "CEO 总览看板", ownerName: "管理员", status: "已发布", views: 512, updatedAt: "2026-08-13 11:05:00" },
    { folderId: salesFolderId, code: "RPT-002", name: "区域销售驾驶舱", ownerName: "数据分析师", status: "已发布", views: 283, updatedAt: "2026-08-13 09:36:00" },
    { folderId: salesFolderId, code: "RPT-003", name: "渠道转化漏斗", ownerName: "管理员", status: "草稿", views: 141, updatedAt: "2026-08-12 20:10:00" },
    { folderId: operationsFolderId, code: "RPT-004", name: "活动投放看板", ownerName: "运营负责人", status: "已发布", views: 96, updatedAt: "2026-08-13 08:58:00" },
    { folderId: financeFolderId, code: "RPT-005", name: "利润结构分析", ownerName: "财务负责人", status: "草稿", views: 77, updatedAt: "2026-08-12 16:22:00" },
  ];

  for (const report of reports) {
    execute(
      database,
      `INSERT INTO tenant_report
        (tenant_id, folder_id, code, name, owner_id, owner_name, status, views, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO NOTHING`,
      [DEFAULT_TENANT_ID, report.folderId, report.code, report.name, ownerId, report.ownerName, report.status, report.views, report.updatedAt],
    );
  }
}

function seedDataSources(database: DatabaseSync, config: SqliteDatabaseConfig) {
  const rows = [
    {
      name: "业务主库",
      type: "SQLite",
      host: config.path,
      port: null,
      database: null,
      username: null,
      password: null,
      status: "在线",
      owner: "管理员",
    },
    { name: "销售分析库", type: "ClickHouse", host: "192.168.2.1", port: 8123, database: "sales_dw", username: "analytics", password: null, status: "同步中", owner: "管理员" },
    { name: "客户服务接口", type: "REST API", host: "https://api.datatalk.local", port: null, database: "crm", username: null, password: null, status: "在线", owner: "管理员" },
  ];

  for (const row of rows) {
    execute(
      database,
      `INSERT INTO tenant_data_source
        (tenant_id, name, type, host, port, database_name, username, password, status, owner)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, name) DO NOTHING`,
      [DEFAULT_TENANT_ID, row.name, row.type, row.host, row.port, row.database, row.username, row.password, row.status, row.owner],
    );
  }
}

export async function initializeSqliteDatabase(config: SqliteDatabaseConfig) {
  const { DatabaseSync } = await loadSqlite();
  if (config.path !== ":memory:") fs.mkdirSync(path.dirname(config.path), { recursive: true });
  const database = new DatabaseSync(config.path);
  try {
    database.exec(SCHEMA);
    addColumnIfMissing(database, "tenant_report", "deleted_at", "TEXT");
    addColumnIfMissing(database, "tenant_report", "deleted_by", "INTEGER");
    database.exec("BEGIN IMMEDIATE");
    try {
      seedTenant(database);
      seedDefaultUsers(database);
      seedReports(database);
      seedDataSources(database, config);
      database.exec("COMMIT");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

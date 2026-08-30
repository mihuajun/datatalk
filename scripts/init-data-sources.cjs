const mysql = require("mysql2/promise");
const { readDatabaseConfig, initializeSqliteDatabase } = require("./lib/config.cjs");

function config() { return readDatabaseConfig(); }
async function main() {
  const databaseConfig = config();
  if (databaseConfig.kind === "sqlite") {
    await initializeSqliteDatabase(databaseConfig);
    console.log(`SQLite data sources initialized at ${databaseConfig.path}`);
    return;
  }

  const db = await mysql.createConnection(databaseConfig); try {
  await db.query(`CREATE TABLE IF NOT EXISTS tenant_data_source (id bigint unsigned NOT NULL AUTO_INCREMENT, tenant_id bigint unsigned NOT NULL, name varchar(100) NOT NULL, type varchar(30) NOT NULL, host varchar(255) NOT NULL, port int unsigned NULL, database_name varchar(160) NULL, username varchar(160) NULL, password varchar(255) NULL, status varchar(20) NOT NULL DEFAULT '在线', owner varchar(64) NOT NULL, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), KEY idx_tenant_data_source_tenant (tenant_id), UNIQUE KEY uq_tenant_data_source_name (tenant_id, name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const rows = [{ name: "业务主库", type: "MySQL", host: "rm-uf6f636wkcvs3omm7wo.mysql.rds.aliyuncs.com", port: 3306, database: "chat_bi", username: "root", status: "在线", owner: "管理员" }, { name: "销售分析库", type: "ClickHouse", host: "192.168.2.1", port: 8123, database: "sales_dw", username: "analytics", status: "同步中", owner: "管理员" }, { name: "客户服务接口", type: "REST API", host: "https://api.datatalk.local", port: null, database: "crm", username: "", status: "在线", owner: "管理员" }];
  for (const row of rows) { await db.query("INSERT IGNORE INTO tenant_data_source (tenant_id, name, type, host, port, database_name, username, password, status, owner) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [row.name, row.type, row.host, row.port, row.database, row.username || null, row.name === "业务主库" ? config().password : null, row.status, row.owner]); }
  await db.execute("UPDATE tenant_data_source SET password = ? WHERE tenant_id = 1 AND name = ? AND (password IS NULL OR password = '')", [config().password, "业务主库"]);
  const [result] = await db.query("SELECT id, tenant_id, name, type, host, port, database_name, status, owner FROM tenant_data_source ORDER BY id"); console.table(result);
  } finally { await db.end(); }
}
main().catch((error) => { console.error("Data source initialization failed", error.message); process.exitCode = 1; });

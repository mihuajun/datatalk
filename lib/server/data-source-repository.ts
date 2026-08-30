import type { RowDataPacket } from "mysql2/promise";

import { getDbPool } from "@/lib/server/mysql";

export const DATA_SOURCE_TYPES = [
  "MySQL", "PostgreSQL", "MariaDB", "SQL Server", "Oracle", "SQLite", "TiDB", "OceanBase",
  "ClickHouse", "Apache Doris", "StarRocks", "Snowflake", "BigQuery", "Amazon Redshift",
  "Databricks SQL", "DuckDB", "Trino", "Greenplum", "MongoDB", "Redis", "Elasticsearch",
  "REST API", "GraphQL",
] as const;
export type DataSourceType = string;
export type DataSourceStatus = "在线" | "同步中" | "告警";

export type DataSourceRecord = {
  id: number;
  name: string;
  type: DataSourceType;
  host: string;
  port: number | null;
  database: string;
  username: string;
  status: DataSourceStatus;
  owner: string;
  updatedAt: string;
};

export type DataSourceCredentials = DataSourceRecord & {
  password: string;
};

type DataSourceRow = RowDataPacket & {
  id: number;
  name: string;
  type: DataSourceType;
  host: string;
  port: number | null;
  database_name: string | null;
  username: string | null;
  status: DataSourceStatus;
  owner: string;
  updated_at: string | Date;
};

function normalize(row: DataSourceRow): DataSourceRecord {
  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toLocaleString("zh-CN", { hour12: false })
    : row.updated_at;
  return {
    id: Number(row.id),
    name: row.name,
    type: row.type?.trim() || "MySQL",
    host: row.host,
    port: row.port == null ? null : Number(row.port),
    database: row.database_name || "",
    username: row.username || "",
    status: row.status === "告警" || row.status === "同步中" ? row.status : "在线",
    owner: row.owner,
    updatedAt,
  };
}

const SELECT_FIELDS = "id, name, type, host, port, database_name, username, status, owner, updated_at";

export async function listDataSources(tenantId: number) {
  const [rows] = await getDbPool().query<DataSourceRow[]>(
    `SELECT ${SELECT_FIELDS} FROM tenant_data_source WHERE tenant_id = ? ORDER BY id ASC`,
    [tenantId],
  );
  return rows.map(normalize);
}

export async function getDataSource(tenantId: number, id: number) {
  const [rows] = await getDbPool().query<DataSourceRow[]>(
    `SELECT ${SELECT_FIELDS} FROM tenant_data_source WHERE tenant_id = ? AND id = ? LIMIT 1`,
    [tenantId, id],
  );
  return rows[0] ? normalize(rows[0]) : null;
}

export async function getDataSourceCredentials(tenantId: number, id: number) {
  const [rows] = await getDbPool().query<(DataSourceRow & { password: string | null })[]>(
    `SELECT ${SELECT_FIELDS}, password FROM tenant_data_source WHERE tenant_id = ? AND id = ? LIMIT 1`,
    [tenantId, id],
  );
  if (!rows[0]) return null;
  return { ...normalize(rows[0]), password: rows[0].password || "" };
}

export async function getDataSourceCredentialsByRef(tenantId: number, dataSourceRef: string) {
  const normalizedRef = dataSourceRef.trim();
  if (!normalizedRef) return null;

  const aliases = normalizedRef === "mysql.main" ? [normalizedRef, "业务主库"] : [normalizedRef];
  const [rows] = await getDbPool().query<(DataSourceRow & { password: string | null })[]>(
    `SELECT ${SELECT_FIELDS}, password
       FROM tenant_data_source
      WHERE tenant_id = ? AND name IN (?, ?)
      ORDER BY CASE name WHEN ? THEN 0 ELSE 1 END, id ASC
      LIMIT 1`,
    [tenantId, aliases[0], aliases[1] || aliases[0], aliases[0]],
  );
  if (!rows[0]) return null;
  return { ...normalize(rows[0]), password: rows[0].password || "" };
}

export async function createDataSource(input: {
  tenantId: number;
  name: string;
  type: DataSourceType;
  host: string;
  port: number | null;
  database: string;
  username: string;
  password: string;
  owner: string;
}) {
  const [result] = await getDbPool().execute(
    "INSERT INTO tenant_data_source (tenant_id, name, type, host, port, database_name, username, password, status, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '在线', ?)",
    [input.tenantId, input.name, input.type, input.host, input.port, input.database || null, input.username || null, input.password || null, input.owner],
  );
  return getDataSource(input.tenantId, Number((result as { insertId: number }).insertId));
}

export async function updateDataSource(input: {
  tenantId: number;
  id: number;
  name: string;
  type: DataSourceType;
  host: string;
  port: number | null;
  database: string;
  username: string;
  password?: string;
}) {
  const pool = getDbPool();
  const values = [input.name, input.type, input.host, input.port, input.database || null, input.username || null];
  if (input.password) {
    await pool.execute("UPDATE tenant_data_source SET name = ?, type = ?, host = ?, port = ?, database_name = ?, username = ?, password = ? WHERE tenant_id = ? AND id = ?", [...values, input.password, input.tenantId, input.id]);
  } else {
    await pool.execute("UPDATE tenant_data_source SET name = ?, type = ?, host = ?, port = ?, database_name = ?, username = ? WHERE tenant_id = ? AND id = ?", [...values, input.tenantId, input.id]);
  }
  return getDataSource(input.tenantId, input.id);
}

export async function deleteDataSource(tenantId: number, id: number) {
  await getDbPool().execute("DELETE FROM tenant_data_source WHERE tenant_id = ? AND id = ?", [tenantId, id]);
}

export async function duplicateDataSource(tenantId: number, id: number) {
  const pool = getDbPool();
  const [rows] = await pool.query<(RowDataPacket & { name: string; type: DataSourceType; host: string; port: number | null; database_name: string | null; username: string | null; password: string | null; owner: string })[]>(
    "SELECT name, type, host, port, database_name, username, password, owner FROM tenant_data_source WHERE tenant_id = ? AND id = ? LIMIT 1",
    [tenantId, id],
  );
  const source = rows[0];
  if (!source) return null;

  const [names] = await pool.query<(RowDataPacket & { name: string })[]>(
    "SELECT name FROM tenant_data_source WHERE tenant_id = ? AND (name = ? OR name LIKE ?) ORDER BY name",
    [tenantId, source.name + " - 副本", source.name + " - 副本%"],
  );
  const usedNames = new Set(names.map((row) => row.name));
  let name = `${source.name} - 副本`;
  let index = 2;
  while (usedNames.has(name)) name = `${source.name} - 副本 ${index++}`;

  const [result] = await pool.execute(
    "INSERT INTO tenant_data_source (tenant_id, name, type, host, port, database_name, username, password, status, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '在线', ?)",
    [tenantId, name, source.type, source.host, source.port, source.database_name, source.username, source.password, source.owner],
  );
  return getDataSource(tenantId, Number((result as { insertId: number }).insertId));
}

export async function refreshDataSourceStatuses(tenantId: number) {
  await getDbPool().execute("UPDATE tenant_data_source SET updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ?", [tenantId]);
  return listDataSources(tenantId);
}

import type { RowDataPacket } from "mysql2/promise";

import { getDbPool } from "@/lib/server/mysql";
import { DATA_SOURCE_TYPES, type DataSourceType } from "@/lib/server/data-source-repository";
import { testExtendedDataSourceConnection } from "@/lib/server/connector-drivers";

type ConnectionInput = { tenantId: number; id?: number; type: DataSourceType; host: string; port: number | null; database: string; username: string; password: string };

let mysqlModule: Promise<typeof import("mysql2/promise")> | undefined;
let pgModule: Promise<typeof import("pg")> | undefined;

function loadMySql() {
  return mysqlModule ??= import("mysql2/promise");
}

function loadPostgres() {
  return pgModule ??= import("pg");
}

function timeout(ms: number) {
  return new Promise<never>((_, reject) => setTimeout(() => reject(new Error("连接超时，请检查地址和端口")), ms));
}

async function testMySql(input: ConnectionInput) {
  const mysql = await loadMySql();
  const connection = await Promise.race([mysql.createConnection({ host: input.host, port: input.port || 3306, database: input.database || undefined, user: input.username || undefined, password: input.password, connectTimeout: 7000 }), timeout(8000)]);
  try { await connection.query("SELECT 1"); } finally { await connection.end(); }
}

async function testPostgres(input: ConnectionInput) {
  const pg = await loadPostgres();
  const client = new pg.Client({ host: input.host, port: input.port || 5432, database: input.database || undefined, user: input.username || undefined, password: input.password, connectionTimeoutMillis: 7000 });
  await Promise.race([client.connect(), timeout(8000)]);
  try { await client.query("SELECT 1"); } finally { await client.end(); }
}

function restApiUrl(input: ConnectionInput) {
  let base: URL;
  try {
    base = new URL(input.host);
  } catch {
    throw new Error("REST API 地址必须是完整的 http 或 https URL");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("REST API 地址必须是完整的 http 或 https URL");
  if (input.port && !base.port) base.port = String(input.port);
  const url = new URL(input.database || "/", base);
  if (url.origin !== base.origin) throw new Error("REST API 资源地址不能跳转到其他域名");
  return url;
}

async function testRestApi(input: ConnectionInput) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (input.username) headers.Authorization = `Basic ${Buffer.from(`${input.username}:${input.password}`).toString("base64")}`;
  else if (input.password) headers.Authorization = `Bearer ${input.password}`;
  const response = await fetch(restApiUrl(input), { method: "GET", headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}`);
}

function clickHouseUrl(input: ConnectionInput) {
  const rawHost = input.host.trim();
  const url = new URL(/^https?:\/\//i.test(rawHost) ? rawHost : `http://${rawHost}`);
  if (!url.port) url.port = String(input.port || 8123);
  if (input.database) url.searchParams.set("database", input.database);
  return url;
}

async function testHttp(input: ConnectionInput) {
  const response = await fetch(clickHouseUrl(input), {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-ClickHouse-User": input.username || "default",
      "X-ClickHouse-Key": input.password,
    },
    body: "SELECT 1",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}`);
}

export async function testDataSourceConnection(input: ConnectionInput) {
  let password = input.password;
  if (!password && input.id) {
    const [rows] = await getDbPool().query<(RowDataPacket & { password: string | null })[]>("SELECT password FROM tenant_data_source WHERE tenant_id = ? AND id = ? LIMIT 1", [input.tenantId, input.id]);
    password = rows[0]?.password || "";
  }
  const passwordRequiredTypes = new Set(["MySQL", "PostgreSQL", "MariaDB", "TiDB", "OceanBase", "Apache Doris", "StarRocks", "Greenplum", "Amazon Redshift", "SQL Server", "Oracle", "Snowflake"]);
  if (passwordRequiredTypes.has(input.type) && !password) {
    throw new Error("请填写数据库密码；编辑已有数据源时，也可以使用已保存的密码");
  }
  const mysqlTypes = new Set(["MySQL", "MariaDB", "TiDB", "OceanBase", "Apache Doris", "StarRocks"]);
  const postgresTypes = new Set(["PostgreSQL", "Greenplum", "Amazon Redshift"]);
  const normalizedInput = { ...input, password };
  if (mysqlTypes.has(input.type)) await testMySql(normalizedInput);
  else if (postgresTypes.has(input.type)) await testPostgres(normalizedInput);
  else if (input.type === "ClickHouse") await testHttp(normalizedInput);
  else if (input.type === "REST API") await testRestApi(normalizedInput);
  else await testExtendedDataSourceConnection(normalizedInput);
  return { success: true, message: "连接成功" };
}

export function isDataSourceType(value: unknown): value is DataSourceType {
  return typeof value === "string" && (DATA_SOURCE_TYPES as readonly string[]).includes(value);
}

import { fileURLToPath } from "node:url";

import type { Document } from "mongodb";

import type { DataSourceCredentials, DataSourceType } from "@/lib/server/data-source-repository";
import type {
  ReportDataSourceAdapter,
  ReportQueryParam,
  ReportQueryParams,
  ReportSchemaColumn,
  ReportSchemaRequest,
  ReportSchemaTable,
} from "@/lib/server/report-data-source-adapter";

export type ConnectorConnectionInput = {
  tenantId: number;
  id?: number;
  type: DataSourceType;
  host: string;
  port: number | null;
  database: string;
  username: string;
  password: string;
};

const DRIVER_TIMEOUT = 8000;

type SnowflakeModule = typeof import("snowflake-sdk");
type SnowflakeConnection = ReturnType<SnowflakeModule["createConnection"]>;
type DatabricksClient = InstanceType<(typeof import("@databricks/sql"))["DBSQLClient"]>;
type DuckDbConnection = Awaited<ReturnType<InstanceType<(typeof import("@duckdb/node-api"))["DuckDBInstance"]>["connect"]>>;

let bigQueryModule: Promise<typeof import("@google-cloud/bigquery")> | undefined;
let databricksModule: Promise<typeof import("@databricks/sql")> | undefined;
let duckDbModule: Promise<typeof import("@duckdb/node-api")> | undefined;
let elasticsearchModule: Promise<typeof import("@elastic/elasticsearch")> | undefined;
let mongoModule: Promise<typeof import("mongodb")> | undefined;
let mssqlModule: Promise<typeof import("mssql")> | undefined;
let oracleModule: Promise<typeof import("oracledb")> | undefined;
let redisModule: Promise<typeof import("redis")> | undefined;
let snowflakeModule: Promise<typeof import("snowflake-sdk")> | undefined;
let sqliteModule: Promise<typeof import("node:sqlite")> | undefined;

function loadBigQuery() {
  return bigQueryModule ??= import("@google-cloud/bigquery");
}

function loadDatabricks() {
  return databricksModule ??= import("@databricks/sql");
}

function loadDuckDb() {
  return duckDbModule ??= import("@duckdb/node-api");
}

function loadElasticsearch() {
  return elasticsearchModule ??= import("@elastic/elasticsearch");
}

function loadMongo() {
  return mongoModule ??= import("mongodb");
}

function loadMssql() {
  return mssqlModule ??= import("mssql");
}

function loadOracle() {
  return oracleModule ??= import("oracledb");
}

function loadRedis() {
  return redisModule ??= import("redis");
}

function loadSnowflake() {
  return snowflakeModule ??= import("snowflake-sdk");
}

function loadSqlite() {
  return sqliteModule ??= import("node:sqlite");
}

function timeoutError() {
  return new Error("QUERY_TIMEOUT");
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function httpUrl(host: string, port: number | null, defaultPort: number) {
  const raw = text(host);
  const hasScheme = /^https?:\/\//i.test(raw);
  const url = new URL(hasScheme ? raw : `http://${raw}`);
  if (!url.port && port) url.port = String(port);
  if (!url.port && defaultPort && !hasScheme) url.port = String(defaultPort);
  return url;
}

function sqlParameterValues(params: ReportQueryParams, name: string) {
  if (!(name in params)) throw new Error("QUERY_PARAMETER_MISSING");
  const value = params[name];
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > 100) throw new Error("QUERY_PARAMETER_INVALID");
  return values;
}

function escapeSqlValue(value: ReportQueryParam) {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("QUERY_PARAMETER_INVALID");
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function bindSqlParams(sql: string, params: ReportQueryParams) {
  return sql.replace(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g, (_placeholder, name: string) => (
    sqlParameterValues(params, name).map(escapeSqlValue).join(", ")
  ));
}

function normalizeBson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
  if (Array.isArray(value)) return value.map(normalizeBson);
  if (typeof value === "object") {
    const candidate = value as { toHexString?: () => string; toJSON?: () => unknown };
    if (typeof candidate.toHexString === "function") return candidate.toHexString();
    if (candidate.constructor?.name === "Decimal128") return String(value);
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeBson(item)]));
  }
  return value;
}

function localFilePath(host: string) {
  const value = text(host);
  if (!value) throw new Error("LOCAL_DATABASE_PATH_REQUIRED");
  if (value === ":memory:") return value;
  if (/^file:/i.test(value)) return fileURLToPath(value);
  return value;
}

async function testSqlServer(input: ConnectorConnectionInput) {
  const mssql = await loadMssql();
  const pool = await withTimeout(mssql.connect({
    server: input.host,
    port: input.port || 1433,
    database: input.database || undefined,
    user: input.username || undefined,
    password: input.password,
    connectionTimeout: DRIVER_TIMEOUT,
    requestTimeout: DRIVER_TIMEOUT,
    options: { encrypt: false, trustServerCertificate: true },
  }), DRIVER_TIMEOUT + 500);
  try {
    await withTimeout(pool.request().query("SELECT 1 AS ok"), DRIVER_TIMEOUT);
  } finally {
    await pool.close();
  }
}

async function oracleConnect(input: ConnectorConnectionInput) {
  const oracledb = await loadOracle();
  return withTimeout(oracledb.getConnection({
    user: input.username || undefined,
    password: input.password,
    connectString: `${input.host}:${input.port || 1521}${input.database ? `/${input.database}` : ""}`,
  }), DRIVER_TIMEOUT);
}

async function testOracle(input: ConnectorConnectionInput) {
  const connection = await oracleConnect(input);
  try {
    await withTimeout(connection.execute("SELECT 1 AS OK FROM DUAL"), DRIVER_TIMEOUT);
  } finally {
    await connection.close();
  }
}

function snowflakeAccount(host: string) {
  const raw = text(host);
  const value = /^https?:\/\//i.test(raw) ? new URL(raw).hostname : raw;
  return value.replace(/\.snowflakecomputing\.com$/i, "");
}

async function snowflakeConnection(input: ConnectorConnectionInput) {
  const snowflake = await loadSnowflake();
  return snowflake.createConnection({
    account: snowflakeAccount(input.host),
    username: input.username,
    password: input.password,
    database: input.database || undefined,
    timeout: DRIVER_TIMEOUT,
    rowMode: "object",
  });
}

async function snowflakeConnect(input: ConnectorConnectionInput) {
  const connection = await snowflakeConnection(input);
  await withTimeout(new Promise<void>((resolve, reject) => {
    connection.connect((error) => error ? reject(error) : resolve());
  }), DRIVER_TIMEOUT + 1000);
  return connection;
}

function snowflakeExecute(connection: SnowflakeConnection, sql: string, binds?: unknown[]) {
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      binds: binds as never,
      rowMode: "object",
      complete: (error, _statement, rows) => {
        if (error) reject(error);
        else resolve((rows || []) as Record<string, unknown>[]);
      },
    });
  });
}

async function closeSnowflake(connection: SnowflakeConnection) {
  await new Promise<void>((resolve) => connection.destroy(() => resolve()));
}

async function testSnowflake(input: ConnectorConnectionInput) {
  const connection = await snowflakeConnect(input);
  try {
    await withTimeout(snowflakeExecute(connection, "SELECT 1 AS OK"), DRIVER_TIMEOUT);
  } finally {
    await closeSnowflake(connection);
  }
}

async function testBigQuery(input: ConnectorConnectionInput) {
  const { BigQuery } = await loadBigQuery();
  const projectId = text(input.host).replace(/^https?:\/\//i, "").split("/")[0];
  const client = new BigQuery(projectId ? { projectId } : {});
  await withTimeout(client.query({ query: "SELECT 1 AS ok", useLegacySql: false }), DRIVER_TIMEOUT);
}

function databricksPath(input: { database: string }) {
  const value = text(input.database);
  if (!value) throw new Error("DATABRICKS_HTTP_PATH_REQUIRED");
  return value.startsWith("/") ? value : `/sql/1.0/warehouses/${value}`;
}

async function databricksConnect(input: ConnectorConnectionInput) {
  if (!input.password) throw new Error("DATABRICKS_TOKEN_REQUIRED");
  const { DBSQLClient } = await loadDatabricks();
  const client = new DBSQLClient();
  await withTimeout(client.connect({ host: text(input.host).replace(/^https?:\/\//i, "").replace(/\/$/, ""), path: databricksPath(input), token: input.password }), DRIVER_TIMEOUT);
  return client;
}

async function testDatabricks(input: ConnectorConnectionInput) {
  const client = await databricksConnect(input);
  let session: Awaited<ReturnType<DatabricksClient["openSession"]>> | undefined;
  let operation: Awaited<ReturnType<NonNullable<typeof session>["executeStatement"]>> | undefined;
  try {
    session = await withTimeout(client.openSession(), DRIVER_TIMEOUT);
    operation = await withTimeout(session.executeStatement("SELECT 1 AS ok"), DRIVER_TIMEOUT);
    await withTimeout(operation.fetchAll({ maxRows: 1 }), DRIVER_TIMEOUT);
  } finally {
    if (operation) await operation.close().catch(() => undefined);
    if (session) await session.close().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

async function testSQLite(input: ConnectorConnectionInput) {
  const path = localFilePath(input.host);
  const { DatabaseSync } = await loadSqlite();
  const database = new DatabaseSync(path, path === ":memory:" ? undefined : { readOnly: true });
  try {
    database.prepare("SELECT 1 AS ok").get();
  } finally {
    database.close();
  }
}

async function withDuckDb<T>(source: { host: string }, operation: (connection: DuckDbConnection) => Promise<T>) {
  const { DuckDBInstance } = await loadDuckDb();
  const instance = await DuckDBInstance.create(localFilePath(source.host));
  const connection = await instance.connect();
  try {
    return await operation(connection);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

async function testDuckDb(input: ConnectorConnectionInput) {
  await withDuckDb(input, async (connection) => {
    await connection.run("SELECT 1 AS ok");
  });
}

function trinoUrl(input: { host: string; port: number | null }) {
  return httpUrl(input.host, input.port, 8080);
}

function trinoHeaders(input: { username: string; password: string; database: string }) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Trino-User": input.username || "report",
  };
  if (input.database) headers["X-Trino-Catalog"] = input.database;
  if (input.username && input.password) headers.Authorization = `Basic ${Buffer.from(`${input.username}:${input.password}`).toString("base64")}`;
  return headers;
}

async function trinoQuery(source: ConnectorConnectionInput | DataSourceCredentials, sql: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(trinoUrl(source), { method: "POST", headers: trinoHeaders(source), body: sql, signal: controller.signal });
    const initial = await response.json() as { error?: { message?: string }; nextUri?: string; columns?: unknown[]; data?: unknown[][] };
    if (!response.ok || initial.error) throw new Error(`TRINO_QUERY_FAILED: ${initial.error?.message || response.status}`);
    const rows: Record<string, unknown>[] = [];
    let columns = initial.columns as Array<{ name: string }> | undefined;
    let page = initial;
    while (true) {
      if (page.columns) columns = page.columns as Array<{ name: string }>;
      for (const values of page.data || []) {
        rows.push(Object.fromEntries((columns || []).map((column, index) => [column.name, normalizeBson(values[index])] )));
      }
      if (!page.nextUri) return rows;
      const next = await fetch(page.nextUri, { headers: trinoHeaders(source), signal: controller.signal });
      page = await next.json() as typeof page;
      if (!next.ok || page.error) throw new Error(`TRINO_QUERY_FAILED: ${page.error?.message || next.status}`);
    }
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function testTrino(input: ConnectorConnectionInput) {
  await trinoQuery(input, "SELECT 1 AS ok", DRIVER_TIMEOUT);
}

function mongoUri(input: { host: string; port: number | null; username: string; password: string; database: string }) {
  const raw = text(input.host);
  if (/^mongodb(?:\+srv)?:\/\//i.test(raw)) return raw;
  const auth = input.username ? `${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@` : "";
  return `mongodb://${auth}${raw}:${input.port || 27017}/${encodeURIComponent(input.database || "admin")}`;
}

async function mongoConnect(source: ConnectorConnectionInput | DataSourceCredentials) {
  const { MongoClient } = await loadMongo();
  const client = new MongoClient(mongoUri(source), { serverSelectionTimeoutMS: DRIVER_TIMEOUT, connectTimeoutMS: DRIVER_TIMEOUT });
  await withTimeout(client.connect(), DRIVER_TIMEOUT);
  return client;
}

async function testMongo(input: ConnectorConnectionInput) {
  const client = await mongoConnect(input);
  try {
    await withTimeout(client.db(input.database || "admin").command({ ping: 1 }), DRIVER_TIMEOUT);
  } finally {
    await client.close();
  }
}

function redisUrl(input: { host: string; port: number | null; username: string; password: string; database: string }) {
  const raw = text(input.host);
  if (/^rediss?:\/\//i.test(raw)) return raw;
  const url = new URL(`redis://${raw}:${input.port || 6379}`);
  if (input.username) url.username = input.username;
  if (input.password) url.password = input.password;
  if (/^\d+$/.test(input.database)) url.pathname = `/${input.database}`;
  return url.toString();
}

async function redisConnect(source: ConnectorConnectionInput | DataSourceCredentials) {
  const { createClient } = await loadRedis();
  const client = createClient({ url: redisUrl(source), socket: { connectTimeout: DRIVER_TIMEOUT, reconnectStrategy: false } });
  await withTimeout(client.connect(), DRIVER_TIMEOUT);
  return client;
}

const REDIS_READ_COMMANDS = new Set(["GET", "MGET", "HGET", "HMGET", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE", "ZRANGEBYSCORE", "SCARD", "LLEN", "SISMEMBER", "EXISTS", "TYPE", "TTL", "PTTL", "DBSIZE", "INFO", "SCAN"]);

function parseRedisRequest(request: string, source: { database: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(request);
  } catch {
    parsed = request.trim().split(/\s+/);
  }
  const parts = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? [(parsed as Record<string, unknown>).command, ...((parsed as Record<string, unknown>).args as unknown[] || [])]
      : [];
  const command = text(parts[0]).toUpperCase();
  const args = parts.slice(1).map((value) => String(value));
  if (!command || !REDIS_READ_COMMANDS.has(command)) throw new Error("REDIS_REQUEST_INVALID");
  if (command === "SCAN" && !args.length) args.push("0", "MATCH", source.database || "*", "COUNT", "100");
  return [command, ...args];
}

function redisRows(value: unknown) {
  if (Array.isArray(value)) return value.map((item, index) => ({ index, value: normalizeBson(item) }));
  if (value && typeof value === "object") return [normalizeBson(value) as Record<string, unknown>];
  return [{ value: normalizeBson(value) }];
}

async function queryRedis(source: DataSourceCredentials, request: string) {
  const client = await redisConnect(source);
  try {
    const value = await client.sendCommand(parseRedisRequest(request, source));
    return redisRows(value);
  } finally {
    await client.quit().catch(() => client.disconnect());
  }
}

async function testRedis(input: ConnectorConnectionInput) {
  const client = await redisConnect(input);
  try {
    await client.ping();
  } finally {
    await client.quit().catch(() => client.disconnect());
  }
}

async function elasticClient(source: ConnectorConnectionInput | DataSourceCredentials) {
  const { Client } = await loadElasticsearch();
  const options: ConstructorParameters<typeof Client>[0] = {
    node: httpUrl(source.host, source.port, 9200).toString(),
    requestTimeout: DRIVER_TIMEOUT,
  };
  if (source.username) options.auth = { username: source.username, password: source.password };
  else if (source.password) options.auth = { bearer: source.password };
  return new Client(options);
}

async function testElasticsearch(input: ConnectorConnectionInput) {
  const client = await elasticClient(input);
  await withTimeout(client.info(), DRIVER_TIMEOUT);
}

type ElasticsearchRequest = { index?: string; query?: Record<string, unknown>; size?: number; from?: number; sort?: unknown; _source?: unknown };

function parseElasticsearchRequest(source: { database: string }, request: string): ElasticsearchRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(request);
  } catch {
    parsed = { index: source.database || request.trim(), query: { match_all: {} } };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ELASTICSEARCH_REQUEST_INVALID");
  const value = parsed as ElasticsearchRequest;
  if (!value.index && !source.database) throw new Error("ELASTICSEARCH_INDEX_REQUIRED");
  return { ...value, index: value.index || source.database, query: value.query || { match_all: {} }, size: Math.min(Math.max(value.size || 100, 1), 1000) };
}

async function queryElasticsearch(source: DataSourceCredentials, request: string, timeoutMs: number) {
  const client = await elasticClient(source);
  const spec = parseElasticsearchRequest(source, request);
  const result = await withTimeout(client.search(spec as never), timeoutMs) as { hits?: { hits?: Array<{ _id?: string; _source?: Record<string, unknown> }> } };
  return (result.hits?.hits || []).map((hit) => ({ ...(hit._source || {}), ...(hit._id ? { _id: hit._id } : {}) }));
}

async function graphqlRequest(source: ConnectorConnectionInput | DataSourceCredentials, request: string, params: ReportQueryParams, timeoutMs: number) {
  let parsed: unknown;
  try {
    parsed = request.trim().startsWith("{") ? JSON.parse(request) : { query: request };
  } catch {
    parsed = { query: request };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as Record<string, unknown>).query !== "string") throw new Error("GRAPHQL_REQUEST_INVALID");
  const body = parsed as { query: string; variables?: Record<string, unknown>; operationName?: string };
  if (/\bmutation\b|\bsubscription\b/i.test(body.query)) throw new Error("GRAPHQL_REQUEST_INVALID");
  const variables = { ...(body.variables || {}) };
  for (const [name, value] of Object.entries(params)) variables[name] = Array.isArray(value) ? value[0] : value;
  const base = httpUrl(source.host, source.port, 443);
  const endpoint = new URL(source.database || "/graphql", base);
  if (endpoint.origin !== base.origin) throw new Error("GRAPHQL_REQUEST_INVALID");
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (source.username) headers.Authorization = `Basic ${Buffer.from(`${source.username}:${source.password}`).toString("base64")}`;
  else if (source.password) headers.Authorization = `Bearer ${source.password}`;
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ ...body, variables }), signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json() as { data?: unknown; errors?: Array<{ message?: string }> };
  if (!response.ok || payload.errors?.length) throw new Error(`GRAPHQL_REQUEST_FAILED: ${payload.errors?.[0]?.message || response.status}`);
  return payload.data;
}

function graphqlRows(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    const list = entries.find(([, item]) => Array.isArray(item));
    if (list) return (list[1] as unknown[]).map((item) => item && typeof item === "object" ? normalizeBson(item) as Record<string, unknown> : { value: item });
    return [normalizeBson(value) as Record<string, unknown>];
  }
  return [{ value: normalizeBson(value) }];
}

async function testGraphql(input: ConnectorConnectionInput) {
  await graphqlRequest(input, "query ConnectorHealth { __typename }", {}, DRIVER_TIMEOUT);
}

async function queryGraphql(source: DataSourceCredentials, request: string, params: ReportQueryParams, timeoutMs: number) {
  return graphqlRows(await graphqlRequest(source, request, params, timeoutMs));
}

async function querySQLite(source: DataSourceCredentials, sql: string, params: ReportQueryParams) {
  const { DatabaseSync } = await loadSqlite();
  const database = new DatabaseSync(localFilePath(source.host), source.host === ":memory:" ? undefined : { readOnly: true });
  try {
    const bound = bindSqlParams(sql, params).replace(/\bTRUE\b/gi, "1").replace(/\bFALSE\b/gi, "0");
    return database.prepare(bound).all() as Record<string, unknown>[];
  } finally {
    database.close();
  }
}

async function queryDuckDb(source: DataSourceCredentials, sql: string, params: ReportQueryParams) {
  return withDuckDb(source, async (connection) => {
    const reader = await connection.runAndReadAll(bindSqlParams(sql, params));
    await reader.readAll();
    return reader.getRowObjects().map((row) => normalizeBson(row) as Record<string, unknown>);
  });
}

async function querySqlServer(source: DataSourceCredentials, sql: string, params: ReportQueryParams, timeoutMs: number) {
  const mssql = await loadMssql();
  const pool = await withTimeout(mssql.connect({ server: source.host, port: source.port || 1433, database: source.database || undefined, user: source.username || undefined, password: source.password, connectionTimeout: timeoutMs, requestTimeout: timeoutMs, options: { encrypt: false, trustServerCertificate: true } }), timeoutMs);
  try {
    const result = await withTimeout(pool.request().query(bindSqlParams(sql, params)), timeoutMs);
    return result.recordset as Record<string, unknown>[];
  } finally {
    await pool.close();
  }
}

async function queryOracle(source: DataSourceCredentials, sql: string, params: ReportQueryParams, timeoutMs: number) {
  const oracledb = await loadOracle();
  const connection = await oracleConnect({ ...source, tenantId: 0 });
  try {
    const result = await withTimeout(connection.execute(bindSqlParams(sql, params), [], { outFormat: oracledb.OUT_FORMAT_OBJECT }), timeoutMs) as { rows?: Record<string, unknown>[] };
    return (result.rows || []).map((row) => normalizeBson(row) as Record<string, unknown>);
  } finally {
    await connection.close();
  }
}

async function querySnowflake(source: DataSourceCredentials, sql: string, params: ReportQueryParams, timeoutMs: number) {
  const connection = await snowflakeConnect({ ...source, tenantId: 0 });
  try {
    return await withTimeout(snowflakeExecute(connection, bindSqlParams(sql, params)), timeoutMs);
  } finally {
    await closeSnowflake(connection);
  }
}

async function queryBigQuery(source: DataSourceCredentials, sql: string, params: ReportQueryParams, timeoutMs: number) {
  const { BigQuery } = await loadBigQuery();
  const projectId = text(source.host).replace(/^https?:\/\//i, "").split("/")[0];
  const client = new BigQuery(projectId ? { projectId } : {});
  const [rows] = await withTimeout(client.query({ query: bindSqlParams(sql, params), useLegacySql: false }), timeoutMs);
  return (rows as Record<string, unknown>[]).map((row) => normalizeBson(row) as Record<string, unknown>);
}

async function queryDatabricks(source: DataSourceCredentials, sql: string, params: ReportQueryParams, timeoutMs: number) {
  const client = await databricksConnect({ ...source, tenantId: 0 });
  let session: Awaited<ReturnType<DatabricksClient["openSession"]>> | undefined;
  let operation: Awaited<ReturnType<NonNullable<typeof session>["executeStatement"]>> | undefined;
  try {
    session = await withTimeout(client.openSession(), timeoutMs);
    operation = await withTimeout(session.executeStatement(bindSqlParams(sql, params)), timeoutMs);
    return await withTimeout(operation.fetchAll({ maxRows: 1000 }), timeoutMs) as Record<string, unknown>[];
  } finally {
    if (operation) await operation.close().catch(() => undefined);
    if (session) await session.close().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

async function queryTrinoAdapter(source: DataSourceCredentials, sql: string, params: ReportQueryParams, timeoutMs: number) {
  return trinoQuery(source, bindSqlParams(sql, params), timeoutMs);
}

function tableFilter(request: ReportSchemaRequest, name: string) {
  return (!request.tables.length || request.tables.includes(name)) && (!request.keyword || name.toLowerCase().includes(request.keyword.toLowerCase()));
}

function schemaColumns(rows: Array<Record<string, unknown>>, keyMap: { name: string; dataType: string; columnType?: string; nullable?: string; key?: string; defaultValue?: string; comment?: string }) {
  return rows.map((row) => ({
    name: String(row[keyMap.name] ?? ""),
    dataType: String(row[keyMap.dataType] ?? ""),
    columnType: String(row[keyMap.columnType || keyMap.dataType] ?? ""),
    nullable: keyMap.nullable === "notnull"
      ? !Boolean(Number(row[keyMap.nullable] ?? 0))
      : String(row[keyMap.nullable || ""] ?? "YES").toUpperCase() !== "NO",
    key: String(row[keyMap.key || ""] ?? ""),
    defaultValue: row[keyMap.defaultValue || ""] == null ? null : String(row[keyMap.defaultValue || ""]),
    comment: String(row[keyMap.comment || ""] ?? ""),
  } satisfies ReportSchemaColumn));
}

async function sqlServerSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number) {
  requireDatabase(source);
  const tableRows = await querySqlServer(source, `SELECT TOP ${Math.min(request.limit, 200)} TABLE_SCHEMA AS tableSchema, TABLE_NAME AS tableName FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_CATALOG = :database AND TABLE_TYPE IN ('BASE TABLE', 'VIEW') ORDER BY TABLE_SCHEMA, TABLE_NAME`, { database: source.database }, timeoutMs);
  const tables = tableRows.map((row) => ({ name: row.tableSchema === "dbo" ? String(row.tableName) : `${row.tableSchema}.${row.tableName}`, schema: String(row.tableSchema), table: String(row.tableName) })).filter((row) => tableFilter(request, row.name));
  const columns = tables.length ? await querySqlServer(source, `SELECT TABLE_SCHEMA AS tableSchema, TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_CATALOG = :database ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`, { database: source.database }, timeoutMs) : [];
  return tables.map((table) => ({ name: table.name, comment: "", columns: schemaColumns(columns.filter((row) => String(row.tableSchema) === table.schema && String(row.tableName) === table.table), { name: "columnName", dataType: "dataType", nullable: "isNullable", defaultValue: "columnDefault" }) }));
}

async function oracleSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number) {
  const owner = source.username.toUpperCase();
  const tables = await queryOracle(source, `SELECT OWNER AS owner, TABLE_NAME AS tableName, COMMENTS AS tableComment FROM ALL_TAB_COMMENTS WHERE OWNER = :owner AND TABLE_TYPE = 'TABLE'`, { owner }, timeoutMs);
  const selected = tables.filter((row) => tableFilter(request, String(row.tableName))).slice(0, request.limit);
  const columns = selected.length ? await queryOracle(source, `SELECT OWNER AS owner, TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType, DATA_LENGTH AS dataLength, NULLABLE AS nullable, DATA_DEFAULT AS dataDefault FROM ALL_TAB_COLUMNS WHERE OWNER = :owner ORDER BY TABLE_NAME, COLUMN_ID`, { owner }, timeoutMs) : [];
  return selected.map((table) => ({ name: String(table.tableName), comment: String(table.tableComment || ""), columns: schemaColumns(columns.filter((row) => String(row.tableName) === String(table.tableName)), { name: "columnName", dataType: "dataType", columnType: "dataType", nullable: "nullable", defaultValue: "dataDefault" }) }));
}

async function localSqlSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number, duckdb: boolean) {
  const tables = duckdb
    ? await queryDuckDb(source, `SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name LIMIT :limit`, { limit: request.limit })
    : await querySQLite(source, `SELECT name AS tableName FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT :limit`, { limit: request.limit });
  const selected = tables.filter((row) => tableFilter(request, String(row.tableName)));
  const result: ReportSchemaTable[] = [];
  for (const table of selected) {
    const name = String(table.tableName);
    const columns = duckdb
      ? await queryDuckDb(source, `SELECT column_name AS columnName, data_type AS dataType, is_nullable AS isNullable FROM information_schema.columns WHERE table_name = :table ORDER BY ordinal_position`, { table: name })
      : await querySQLite(source, `PRAGMA table_info(${JSON.stringify(name)})`, {});
    result.push({ name, comment: "", columns: schemaColumns(columns, duckdb ? { name: "columnName", dataType: "dataType", nullable: "isNullable" } : { name: "name", dataType: "type", columnType: "type", nullable: "notnull" }) });
  }
  return result;
}

async function snowflakeSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number) {
  requireDatabase(source);
  const database = source.database.replace(/[^A-Za-z0-9_$]/g, "");
  const tables = await querySnowflake(source, `SELECT TABLE_SCHEMA AS tableSchema, TABLE_NAME AS tableName, COMMENT AS tableComment FROM ${database}.INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')`, {}, timeoutMs);
  const selected = tables.filter((row) => tableFilter(request, String(row.tableName))).slice(0, request.limit);
  const columns = await querySnowflake(source, `SELECT TABLE_SCHEMA AS tableSchema, TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault FROM ${database}.INFORMATION_SCHEMA.COLUMNS`, {}, timeoutMs);
  return selected.map((table) => ({ name: String(table.tableName), comment: String(table.tableComment || ""), columns: schemaColumns(columns.filter((row) => String(row.tableName) === String(table.tableName)), { name: "columnName", dataType: "dataType", nullable: "isNullable", defaultValue: "columnDefault" }) }));
}

async function bigQuerySchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number) {
  requireDatabase(source);
  const project = text(source.host).replace(/[^A-Za-z0-9_-]/g, "");
  const dataset = source.database.replace(/[^A-Za-z0-9_]/g, "");
  const rows = await queryBigQuery(source, `SELECT table_name AS tableName, column_name AS columnName, data_type AS dataType, is_nullable AS isNullable FROM \`${project}.${dataset}.INFORMATION_SCHEMA.COLUMNS\` ORDER BY table_name, ordinal_position`, {}, timeoutMs);
  const names = Array.from(new Set(rows.map((row) => String(row.tableName)))).filter((name) => tableFilter(request, name)).slice(0, request.limit);
  return names.map((name) => ({ name, comment: "", columns: schemaColumns(rows.filter((row) => String(row.tableName) === name), { name: "columnName", dataType: "dataType", nullable: "isNullable" }) }));
}

async function genericSqlSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number, query: (source: DataSourceCredentials, sql: string, params: ReportQueryParams, timeoutMs: number) => Promise<Record<string, unknown>[]>) {
  requireDatabase(source);
  const rows = await query(source, `SELECT table_name AS tableName, column_name AS columnName, data_type AS dataType, is_nullable AS isNullable FROM information_schema.columns WHERE table_catalog = :database ORDER BY table_name, ordinal_position`, { database: source.database }, timeoutMs);
  const names = Array.from(new Set(rows.map((row) => String(row.tableName)))).filter((name) => tableFilter(request, name)).slice(0, request.limit);
  return names.map((name) => ({ name, comment: "", columns: schemaColumns(rows.filter((row) => String(row.tableName) === name), { name: "columnName", dataType: "dataType", nullable: "isNullable" }) }));
}

async function mongoSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number) {
  const client = await mongoConnect(source);
  try {
    const db = client.db(source.database);
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name).filter((name) => tableFilter(request, name)).slice(0, request.limit);
    return Promise.all(names.map(async (name) => {
      const sample = await db.collection(name).findOne({}, { projection: { _id: 0 } });
      const columns = sample && typeof sample === "object" ? Object.entries(sample).map(([key, value]) => ({ name: key, dataType: Array.isArray(value) ? "array" : typeof value, columnType: Array.isArray(value) ? "array" : typeof value, nullable: true, key: "", defaultValue: null, comment: "" })) : [];
      return { name, comment: "MongoDB collection", columns };
    }));
  } finally {
    await client.close();
  }
}

async function redisSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number) {
  const client = await redisConnect(source);
  try {
    const value = await client.sendCommand(parseRedisRequest(JSON.stringify({ command: "SCAN", args: ["0", "MATCH", source.database || "*", "COUNT", String(Math.min(request.limit, 100))] }), source));
    return [{ name: source.database || "Redis keys", comment: "Redis keyspace", columns: [{ name: "key", dataType: "string", columnType: "string", nullable: false, key: "", defaultValue: null, comment: "" }, { name: "type", dataType: "string", columnType: "string", nullable: true, key: "", defaultValue: null, comment: "" }] } satisfies ReportSchemaTable, ...(Array.isArray(value) && Array.isArray(value[1]) ? value[1].map((key) => ({ name: String(key), comment: "Redis key", columns: [] })) : [])];
  } finally {
    await client.quit().catch(() => client.disconnect());
  }
}

async function elasticSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number) {
  const client = await elasticClient(source);
  const index = source.database || "_all";
  const mappings = await withTimeout(client.indices.getMapping({ index }), timeoutMs) as Record<string, { mappings?: { properties?: Record<string, { type?: string; properties?: Record<string, unknown> }> } }>;
  return Object.entries(mappings).filter(([name]) => tableFilter(request, name)).slice(0, request.limit).map(([name, value]) => ({ name, comment: "Elasticsearch index", columns: Object.entries(value.mappings?.properties || {}).map(([field, definition]) => ({ name: field, dataType: definition.type || "object", columnType: definition.type || "object", nullable: true, key: "", defaultValue: null, comment: "" })) }));
}

async function graphqlSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number) {
  const introspection = `query ConnectorSchema { __schema { queryType { fields { name type { kind name ofType { kind name } } } } } }`;
  const value = await graphqlRequest(source, introspection, {}, timeoutMs) as { __schema?: { queryType?: { fields?: Array<{ name: string; type?: { name?: string; kind?: string } }> } } };
  const fields = value?.__schema?.queryType?.fields || [];
  return fields.filter((field) => tableFilter(request, field.name)).slice(0, request.limit).map((field) => ({ name: field.name, comment: "GraphQL query field", columns: [{ name: "value", dataType: field.type?.name || field.type?.kind || "object", columnType: field.type?.name || field.type?.kind || "object", nullable: true, key: "", defaultValue: null, comment: "" }] }));
}

function requireDatabase(source: DataSourceCredentials) {
  if (!source.database) throw new Error("DATA_SOURCE_DATABASE_REQUIRED");
}

function jsonPrepare(request: string, error: string) {
  if (!request.trim()) throw new Error(error);
  try {
    JSON.parse(request);
  } catch {
    throw new Error(error);
  }
  return request.trim();
}

const sqlServerAdapter: ReportDataSourceAdapter = { query: querySqlServer, schema: sqlServerSchema };
const oracleAdapter: ReportDataSourceAdapter = { query: queryOracle, schema: oracleSchema };
const sqliteAdapter: ReportDataSourceAdapter = { query: querySQLite, schema: (source, request, timeoutMs) => localSqlSchema(source, request, timeoutMs, false) };
const duckdbAdapter: ReportDataSourceAdapter = { query: queryDuckDb, schema: (source, request, timeoutMs) => localSqlSchema(source, request, timeoutMs, true) };
const snowflakeAdapter: ReportDataSourceAdapter = { query: querySnowflake, schema: snowflakeSchema };
const bigQueryAdapter: ReportDataSourceAdapter = { query: queryBigQuery, schema: bigQuerySchema };
const databricksAdapter: ReportDataSourceAdapter = { query: queryDatabricks, schema: (source, request, timeoutMs) => genericSqlSchema(source, request, timeoutMs, queryDatabricks) };
const trinoAdapter: ReportDataSourceAdapter = { query: queryTrinoAdapter, schema: (source, request, timeoutMs) => genericSqlSchema(source, request, timeoutMs, queryTrinoAdapter) };
const mongoAdapter: ReportDataSourceAdapter = { prepareRequest: (request) => jsonPrepare(request, "MONGO_REQUEST_INVALID"), query: async (source, request, params, timeoutMs) => {
  const client = await mongoConnect(source);
  try {
    const value = JSON.parse(request) as { collection?: string; filter?: Document; projection?: Document; sort?: Document; limit?: number; aggregate?: Document[] };
    if (!value.collection) throw new Error("MONGO_COLLECTION_REQUIRED");
    const collection = client.db(source.database).collection(value.collection);
    if (Array.isArray(value.aggregate)) {
      if (value.aggregate.some((stage) => stage && typeof stage === "object" && ("$out" in stage || "$merge" in stage))) throw new Error("MONGO_REQUEST_INVALID");
      return (await collection.aggregate(value.aggregate).limit(Math.min(value.limit || 1000, 1000)).toArray()).map((row) => normalizeBson(row) as Record<string, unknown>);
    }
    return (await collection.find(value.filter || {}, { projection: value.projection, sort: value.sort }).limit(Math.min(value.limit || 1000, 1000)).toArray()).map((row) => normalizeBson(row) as Record<string, unknown>);
  } finally {
    await client.close();
  }
}, schema: mongoSchema };
const redisAdapter: ReportDataSourceAdapter = { prepareRequest: (request) => request.trim() || (() => { throw new Error("REDIS_REQUEST_INVALID"); })(), query: (source, request) => queryRedis(source, request), schema: redisSchema };
const elasticAdapter: ReportDataSourceAdapter = { prepareRequest: (request) => jsonPrepare(request, "ELASTICSEARCH_REQUEST_INVALID"), query: (source, request, _params, timeoutMs) => queryElasticsearch(source, request, timeoutMs), schema: elasticSchema };
const graphqlAdapter: ReportDataSourceAdapter = { prepareRequest: (request) => request.trim() || (() => { throw new Error("GRAPHQL_REQUEST_INVALID"); })(), query: queryGraphql, schema: graphqlSchema };

const ADAPTERS: Record<string, ReportDataSourceAdapter> = {
  "SQL Server": sqlServerAdapter,
  Oracle: oracleAdapter,
  SQLite: sqliteAdapter,
  Snowflake: snowflakeAdapter,
  BigQuery: bigQueryAdapter,
  "Databricks SQL": databricksAdapter,
  DuckDB: duckdbAdapter,
  Trino: trinoAdapter,
  MongoDB: mongoAdapter,
  Redis: redisAdapter,
  Elasticsearch: elasticAdapter,
  GraphQL: graphqlAdapter,
};

export function getExtendedReportDataSourceAdapter(type: string) {
  return ADAPTERS[type];
}

export async function testExtendedDataSourceConnection(input: ConnectorConnectionInput) {
  switch (input.type) {
    case "SQL Server": return testSqlServer(input);
    case "Oracle": return testOracle(input);
    case "SQLite": return testSQLite(input);
    case "Snowflake": return testSnowflake(input);
    case "BigQuery": return testBigQuery(input);
    case "Databricks SQL": return testDatabricks(input);
    case "DuckDB": return testDuckDb(input);
    case "Trino": return testTrino(input);
    case "MongoDB": return testMongo(input);
    case "Redis": return testRedis(input);
    case "Elasticsearch": return testElasticsearch(input);
    case "GraphQL": return testGraphql(input);
    default: throw new Error("DATA_SOURCE_NOT_SUPPORTED");
  }
}

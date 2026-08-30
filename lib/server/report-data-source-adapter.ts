import mysql, { type RowDataPacket } from "mysql2/promise";
import pg from "pg";

import type { DataSourceCredentials, DataSourceType } from "@/lib/server/data-source-repository";
import { getExtendedReportDataSourceAdapter } from "@/lib/server/connector-drivers";

export type ReportQueryParam = string | number | boolean | null;
export type ReportQueryParams = Record<string, ReportQueryParam | ReportQueryParam[]>;

export type ReportSchemaColumn = {
  name: string;
  dataType: string;
  columnType: string;
  nullable: boolean;
  key: string;
  defaultValue: string | null;
  comment: string;
};

export type ReportSchemaTable = {
  name: string;
  comment: string;
  columns: ReportSchemaColumn[];
};

export type ReportSchemaRequest = {
  keyword: string;
  tables: string[];
  limit: number;
};

export type ReportDataSourceAdapter = {
  prepareRequest?: (request: string) => string;
  query(source: DataSourceCredentials, sql: string, params: ReportQueryParams, timeoutMs: number): Promise<Record<string, unknown>[]>;
  schema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number): Promise<ReportSchemaTable[]>;
};

const adapters = new Map<string, ReportDataSourceAdapter>();

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

function getParamValues(params: ReportQueryParams, name: string) {
  if (!(name in params)) throw new Error("QUERY_PARAMETER_MISSING");
  const value = params[name];
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > 100) throw new Error("QUERY_PARAMETER_INVALID");
  return values;
}

function bindMySqlParams(sql: string, params: ReportQueryParams) {
  return sql.replace(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g, (_placeholder, name: string) => {
    return getParamValues(params, name).map((value) => mysql.escape(value)).join(", ");
  });
}

function bindPostgresParams(sql: string, params: ReportQueryParams) {
  const values: ReportQueryParam[] = [];
  const text = sql.replace(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g, (_placeholder, name: string) => {
    const placeholders = getParamValues(params, name).map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return placeholders.join(", ");
  });
  return { text, values };
}

function escapeClickHouseValue(value: ReportQueryParam) {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("QUERY_PARAMETER_INVALID");
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function bindClickHouseParams(sql: string, params: ReportQueryParams) {
  return sql.replace(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g, (_placeholder, name: string) => {
    return getParamValues(params, name).map(escapeClickHouseValue).join(", ");
  });
}

async function queryMySql(source: DataSourceCredentials, sql: string, params: ReportQueryParams, timeoutMs: number) {
  const connection = await withTimeout(mysql.createConnection({
    host: source.host,
    port: source.port || 3306,
    database: source.database || undefined,
    user: source.username || undefined,
    password: source.password,
    connectTimeout: timeoutMs,
  }), timeoutMs);
  try {
    const [rows] = await withTimeout(connection.query(bindMySqlParams(sql, params)), timeoutMs);
    return rows as Record<string, unknown>[];
  } finally {
    await connection.end();
  }
}

async function queryPostgresValues(source: DataSourceCredentials, text: string, values: unknown[], timeoutMs: number) {
  const client = new pg.Client({
    host: source.host,
    port: source.port || 5432,
    database: source.database || undefined,
    user: source.username || undefined,
    password: source.password,
    connectionTimeoutMillis: timeoutMs,
    statement_timeout: timeoutMs,
  });
  await withTimeout(client.connect(), timeoutMs);
  try {
    const result = await withTimeout(client.query({ text, values }), timeoutMs);
    return result.rows as Record<string, unknown>[];
  } finally {
    await client.end();
  }
}

async function queryPostgres(source: DataSourceCredentials, sql: string, params: ReportQueryParams, timeoutMs: number) {
  const bound = bindPostgresParams(sql, params);
  return queryPostgresValues(source, bound.text, bound.values, timeoutMs);
}

function clickHouseUrl(source: DataSourceCredentials) {
  const host = source.host.trim();
  const url = new URL(/^https?:\/\//i.test(host) ? host : `http://${host}:${source.port || 8123}`);
  if (source.database) url.searchParams.set("database", source.database);
  return url;
}

async function queryClickHouse(source: DataSourceCredentials, sql: string, params: ReportQueryParams, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(clickHouseUrl(source), {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-ClickHouse-User": source.username || "default",
        "X-ClickHouse-Key": source.password,
      },
      body: `${bindClickHouseParams(sql, params)} FORMAT JSONEachRow`,
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`CLICKHOUSE_QUERY_FAILED: ${body.slice(0, 200)}`);
    return body.trim()
      ? body.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
      : [];
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

type RestRequestSpec = {
  method: "GET";
  path: string;
  query?: Record<string, unknown>;
  dataPath?: string;
};

function restBaseUrl(source: DataSourceCredentials) {
  try {
    const url = new URL(source.host.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("REST_CONFIG_INVALID");
    if (source.port && !url.port) url.port = String(source.port);
    return url;
  } catch {
    throw new Error("REST_CONFIG_INVALID");
  }
}

function resolveRestPath(path: string, params: ReportQueryParams) {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_placeholder, name: string) => {
    const values = getParamValues(params, name);
    if (values.length !== 1) throw new Error("QUERY_PARAMETER_INVALID");
    return encodeURIComponent(values[0] == null ? "" : String(values[0]));
  });
}

function resolveRestQuery(query: Record<string, unknown> | undefined, params: ReportQueryParams) {
  const entries: Array<[string, string]> = [];
  for (const [key, rawValue] of Object.entries(query || {})) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const item of values) {
      if (typeof item === "string" && /^:[A-Za-z_][A-Za-z0-9_]*$/.test(item)) {
        for (const value of getParamValues(params, item.slice(1))) {
          if (value !== null) entries.push([key, String(value)]);
        }
        continue;
      }
      if (item === null) continue;
      if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
        throw new Error("REST_REQUEST_INVALID");
      }
      entries.push([key, String(item)]);
    }
  }
  return entries;
}

function parseRestRequestSpec(source: DataSourceCredentials, input: string): RestRequestSpec {
  const text = input.trim();
  let parsed: unknown;
  try {
    const shorthand = text.match(/^GET\s+(.+)$/i);
    parsed = text.startsWith("{") ? JSON.parse(text) : { method: "GET", path: shorthand ? shorthand[1].trim() : text };
  } catch {
    throw new Error("REST_REQUEST_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("REST_REQUEST_INVALID");
  const value = parsed as Record<string, unknown>;
  const method = typeof value.method === "string" ? value.method.toUpperCase() : "GET";
  const path = typeof value.path === "string" && value.path.trim() ? value.path.trim() : source.database || "/";
  if (method !== "GET" || !path) throw new Error("REST_REQUEST_INVALID");
  if (value.query !== undefined && (!value.query || typeof value.query !== "object" || Array.isArray(value.query))) {
    throw new Error("REST_REQUEST_INVALID");
  }
  if (value.dataPath !== undefined && typeof value.dataPath !== "string") throw new Error("REST_REQUEST_INVALID");
  return {
    method: "GET",
    path,
    query: value.query as Record<string, unknown> | undefined,
    dataPath: typeof value.dataPath === "string" ? value.dataPath.trim() : undefined,
  };
}

function restHeaders(source: DataSourceCredentials) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (source.username) {
    headers.Authorization = `Basic ${Buffer.from(`${source.username}:${source.password}`).toString("base64")}`;
  } else if (source.password) {
    headers.Authorization = `Bearer ${source.password}`;
  }
  return headers;
}

async function fetchRestJson(source: DataSourceCredentials, spec: RestRequestSpec, params: ReportQueryParams, timeoutMs: number) {
  const url = new URL(resolveRestPath(spec.path, params), restBaseUrl(source));
  const base = restBaseUrl(source);
  if (url.origin !== base.origin) throw new Error("REST_REQUEST_INVALID");
  for (const [key, value] of resolveRestQuery(spec.query, params)) url.searchParams.append(key, value);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: spec.method, headers: restHeaders(source), signal: controller.signal });
    const body = await response.text();
    if (!response.ok) throw new Error("REST_REQUEST_FAILED");
    try {
      return body.trim() ? JSON.parse(body) as unknown : [];
    } catch {
      throw new Error("REST_RESPONSE_INVALID");
    }
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getRestDataPath(value: unknown, dataPath?: string) {
  if (dataPath) {
    return dataPath.split(".").filter(Boolean).reduce<unknown>((current, key) => (
      current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined
    ), value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["data", "rows", "items", "result"]) {
      if (Array.isArray(record[key])) return record[key];
    }
  }
  return value;
}

function restRows(value: unknown, dataPath?: string) {
  const payload = getRestDataPath(value, dataPath);
  const items = Array.isArray(payload) ? payload : [payload];
  return items.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) return item as Record<string, unknown>;
    return { value: item };
  });
}

async function queryRestApi(source: DataSourceCredentials, request: string, params: ReportQueryParams, timeoutMs: number) {
  const spec = parseRestRequestSpec(source, request);
  return restRows(await fetchRestJson(source, spec, params, timeoutMs), spec.dataPath);
}

async function restApiSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number) {
  const resource = source.database || "/";
  const name = resource.split("?")[0].split("/").filter(Boolean).pop() || "api";
  if ((request.tables.length && !request.tables.includes(name) && !request.tables.includes(resource)) || (request.keyword && !name.toLowerCase().includes(request.keyword.toLowerCase()))) {
    return [];
  }
  const rows = await queryRestApi(source, JSON.stringify({ method: "GET", path: resource }), {}, timeoutMs);
  const samples = rows.slice(0, 20);
  const sampleValues = new Map<string, unknown>();
  for (const row of samples) {
    for (const [key, value] of Object.entries(row)) {
      if (!sampleValues.has(key) || sampleValues.get(key) == null) sampleValues.set(key, value);
    }
  }
  return [{
    name,
    comment: `REST API ${resource} 响应字段`,
    columns: Array.from(sampleValues.entries()).map(([key, value]) => ({
      name: key,
      dataType: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
      columnType: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
      nullable: true,
      key: "",
      defaultValue: null,
      comment: "",
    })),
  }];
}

function requireDatabase(source: DataSourceCredentials) {
  if (!source.database) throw new Error("DATA_SOURCE_DATABASE_REQUIRED");
}

async function mysqlSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number) {
  requireDatabase(source);
  const tableArgs: Array<ReportQueryParam | ReportQueryParam[]> = [source.database];
  let tableSql = `
    SELECT table_name AS tableName, table_comment AS tableComment
    FROM information_schema.tables
    WHERE table_schema = ?
  `;

  if (request.tables.length) {
    tableSql += " AND table_name IN (?)";
    tableArgs.push(request.tables);
  } else if (request.keyword) {
    const keywordLike = `%${request.keyword.replace(/[\\%_]/g, "\\$&")}%`;
    tableSql += " AND (table_name LIKE ? ESCAPE '\\\\' OR table_comment LIKE ? ESCAPE '\\\\')";
    tableArgs.push(keywordLike, keywordLike);
  }
  tableSql += " ORDER BY table_name ASC LIMIT ?";
  tableArgs.push(request.limit);

  const connection = await withTimeout(mysql.createConnection({
    host: source.host,
    port: source.port || 3306,
    database: source.database,
    user: source.username || undefined,
    password: source.password,
    connectTimeout: timeoutMs,
  }), timeoutMs);
  try {
    const [tableRows] = await withTimeout(connection.query<(RowDataPacket & {
      tableName: string;
      tableComment: string | null;
    })[]>(tableSql, tableArgs as unknown[]), timeoutMs);
    const tableNames = tableRows.map((row) => row.tableName);
    const columnsByTable = new Map<string, ReportSchemaColumn[]>();

    if (tableNames.length) {
      const [columnRows] = await withTimeout(connection.query<(RowDataPacket & {
        tableName: string;
        columnName: string;
        dataType: string;
        columnType: string;
        isNullable: "YES" | "NO";
        columnKey: string;
        columnDefault: string | null;
        columnComment: string | null;
      })[]>(`
        SELECT
          table_name AS tableName,
          column_name AS columnName,
          data_type AS dataType,
          column_type AS columnType,
          is_nullable AS isNullable,
          column_key AS columnKey,
          column_default AS columnDefault,
          column_comment AS columnComment
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name IN (?)
        ORDER BY table_name ASC, ordinal_position ASC
      `, [source.database, tableNames]), timeoutMs);

      for (const row of columnRows) {
        const columns = columnsByTable.get(row.tableName) || [];
        columns.push({
          name: row.columnName,
          dataType: row.dataType,
          columnType: row.columnType,
          nullable: row.isNullable === "YES",
          key: row.columnKey,
          defaultValue: row.columnDefault,
          comment: row.columnComment || "",
        });
        columnsByTable.set(row.tableName, columns);
      }
    }

    return tableRows.map((row) => ({
      name: row.tableName,
      comment: row.tableComment || "",
      columns: columnsByTable.get(row.tableName) || [],
    }));
  } finally {
    await connection.end();
  }
}

type PostgresTableRow = { tableName: string; tableSchema: string; tableComment: string | null };
type PostgresColumnRow = {
  tableName: string;
  tableSchema: string;
  columnName: string;
  dataType: string;
  columnType: string;
  isNullable: "YES" | "NO";
  columnDefault: string | null;
};

function postgresTableDisplayName(row: { tableName: string; tableSchema: string }) {
  return row.tableSchema === "public" ? row.tableName : `${row.tableSchema}.${row.tableName}`;
}

async function postgresSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number) {
  requireDatabase(source);
  const tableValues: Array<ReportQueryParam | ReportQueryParam[]> = [source.database];
  let tableSql = `
    SELECT
      table_name AS "tableName",
      table_schema AS "tableSchema",
      COALESCE(obj_description((quote_ident(table_schema) || '.' || quote_ident(table_name))::regclass, 'pg_class'), '') AS "tableComment"
    FROM information_schema.tables
    WHERE table_catalog = $1
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
      AND table_type IN ('BASE TABLE', 'VIEW')
  `;

  if (request.tables.length) {
    tableValues.push(request.tables);
    tableSql += `
      AND (table_name = ANY($2::text[]) OR (table_schema || '.' || table_name) = ANY($2::text[]))
    `;
  } else if (request.keyword) {
    tableValues.push(`%${request.keyword}%`);
    tableSql += " AND (table_name ILIKE $2 OR table_schema || '.' || table_name ILIKE $2)";
  }
  const limitIndex = tableValues.length + 1;
  tableValues.push(request.limit);
  tableSql += ` ORDER BY table_schema ASC, table_name ASC LIMIT $${limitIndex}`;

  const tableRows = await queryPostgresValues(source, tableSql, tableValues, timeoutMs);
  const normalizedTables = tableRows as unknown as PostgresTableRow[];
  const columnsByTable = new Map<string, ReportSchemaColumn[]>();

  if (normalizedTables.length) {
    const columnValues: Array<ReportQueryParam | ReportQueryParam[]> = [source.database];
    const selections = normalizedTables.map((row) => {
      columnValues.push(row.tableSchema, row.tableName);
      const schemaIndex = columnValues.length - 1;
      const tableIndex = columnValues.length;
      return `(table_schema = $${schemaIndex} AND table_name = $${tableIndex})`;
    });
    const columnSql = `
      SELECT
        table_name AS "tableName",
        table_schema AS "tableSchema",
        column_name AS "columnName",
        data_type AS "dataType",
        udt_name AS "columnType",
        is_nullable AS "isNullable",
        column_default AS "columnDefault"
      FROM information_schema.columns
      WHERE table_catalog = $1
        AND (${selections.join(" OR ")})
      ORDER BY table_schema ASC, table_name ASC, ordinal_position ASC
    `;
    const columnRows = await queryPostgresValues(source, columnSql, columnValues, timeoutMs) as unknown as PostgresColumnRow[];
    for (const row of columnRows) {
      const tableKey = postgresTableDisplayName(row);
      const columns = columnsByTable.get(tableKey) || [];
      columns.push({
        name: row.columnName,
        dataType: row.dataType,
        columnType: row.columnType,
        nullable: row.isNullable === "YES",
        key: "",
        defaultValue: row.columnDefault,
        comment: "",
      });
      columnsByTable.set(tableKey, columns);
    }
  }

  return normalizedTables.map((row) => {
    const name = postgresTableDisplayName(row);
    return { name, comment: row.tableComment || "", columns: columnsByTable.get(name) || [] };
  });
}

async function clickHouseSchema(source: DataSourceCredentials, request: ReportSchemaRequest, timeoutMs: number) {
  requireDatabase(source);
  const tableParams: ReportQueryParams = { database: source.database, limit: request.limit };
  let tableSql = `
    SELECT name AS tableName, '' AS tableComment
    FROM system.tables
    WHERE database = :database
  `;
  if (request.tables.length) {
    tableSql += " AND name IN (:tables)";
    tableParams.tables = request.tables;
  } else if (request.keyword) {
    tableSql += " AND name LIKE :keyword";
    tableParams.keyword = `%${request.keyword}%`;
  }
  tableSql += " ORDER BY name ASC LIMIT :limit";

  const tableRows = await queryClickHouse(source, tableSql, tableParams, timeoutMs) as Array<{ tableName: string; tableComment: string | null }>;
  const tableNames = tableRows.map((row) => row.tableName);
  const columnsByTable = new Map<string, ReportSchemaColumn[]>();
  if (tableNames.length) {
    const columnRows = await queryClickHouse(source, `
      SELECT
        table AS tableName,
        name AS columnName,
        type AS dataType,
        type AS columnType,
        startsWith(type, 'Nullable(') AS isNullable,
        if(is_in_primary_key, 'PRI', '') AS columnKey,
        default_expression AS columnDefault
      FROM system.columns
      WHERE database = :database AND table IN (:tables)
      ORDER BY table ASC, position ASC
    `, { database: source.database, tables: tableNames }, timeoutMs) as Array<{
      tableName: string;
      columnName: string;
      dataType: string;
      columnType: string;
      isNullable: boolean | number;
      columnKey: string;
      columnDefault: string | null;
    }>;
    for (const row of columnRows) {
      const columns = columnsByTable.get(row.tableName) || [];
      columns.push({
        name: row.columnName,
        dataType: row.dataType,
        columnType: row.columnType,
        nullable: Boolean(row.isNullable),
        key: row.columnKey,
        defaultValue: row.columnDefault,
        comment: "",
      });
      columnsByTable.set(row.tableName, columns);
    }
  }
  return tableRows.map((row) => ({ name: row.tableName, comment: row.tableComment || "", columns: columnsByTable.get(row.tableName) || [] }));
}

const mysqlAdapter: ReportDataSourceAdapter = {
  query: queryMySql,
  schema: mysqlSchema,
};

const postgresAdapter: ReportDataSourceAdapter = {
  query: queryPostgres,
  schema: postgresSchema,
};

const clickHouseAdapter: ReportDataSourceAdapter = {
  query: queryClickHouse,
  schema: clickHouseSchema,
};

const restApiAdapter: ReportDataSourceAdapter = {
  prepareRequest: (request) => {
    if (!request.trim()) throw new Error("REST_REQUEST_INVALID");
    return request.trim();
  },
  query: queryRestApi,
  schema: restApiSchema,
};

adapters.set("MySQL", mysqlAdapter);
adapters.set("PostgreSQL", postgresAdapter);
adapters.set("ClickHouse", clickHouseAdapter);
adapters.set("REST API", restApiAdapter);

for (const type of ["MariaDB", "TiDB", "OceanBase", "Apache Doris", "StarRocks"]) {
  adapters.set(type, mysqlAdapter);
}
for (const type of ["Greenplum", "Amazon Redshift"]) {
  adapters.set(type, postgresAdapter);
}
for (const type of ["SQL Server", "Oracle", "SQLite", "Snowflake", "BigQuery", "Databricks SQL", "DuckDB", "Trino", "MongoDB", "Redis", "Elasticsearch", "GraphQL"]) {
  const adapter = getExtendedReportDataSourceAdapter(type);
  if (adapter) adapters.set(type, adapter);
}

export function registerReportDataSourceAdapter(type: string, adapter: ReportDataSourceAdapter) {
  adapters.set(type, adapter);
}

export function getReportDataSourceAdapter(type: DataSourceType) {
  const adapter = adapters.get(type);
  if (!adapter) throw new Error("DATA_SOURCE_NOT_SUPPORTED");
  return adapter;
}

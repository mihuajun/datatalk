import fs from "node:fs";
import path from "node:path";

import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { SqliteDatabaseConfig } from "@/lib/server/database-config";

type SqliteRow = Record<string, unknown>;
type SqliteResult = {
  affectedRows: number;
  changedRows: number;
  insertId: number;
  warningStatus: number;
};

type SqliteModule = typeof import("node:sqlite");

let sqliteModule: Promise<SqliteModule> | undefined;

function loadSqlite() {
  return sqliteModule ??= import("node:sqlite");
}

function formatDate(value: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
}

function normalizeValue(value: unknown): SQLInputValue {
  if (value instanceof Date) return formatDate(value);
  if (value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "string" || typeof value === "number" || value === null) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`SQLite parameter type is not supported: ${typeof value}`);
}

function isQuoteStart(sql: string, index: number) {
  return sql[index] === "'" || sql[index] === '"' || sql[index] === "`";
}

function expandArrayParameters(sql: string, values: readonly unknown[]) {
  const expandedValues: unknown[] = [];
  let result = "";
  let valueIndex = 0;
  let quote: string | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      result += character;
      if (character === quote) {
        if (sql[index + 1] === quote) {
          result += sql[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (isQuoteStart(sql, index)) {
      quote = character;
      result += character;
      continue;
    }

    if (character !== "?") {
      result += character;
      continue;
    }

    const value = values[valueIndex++];
    if (!Array.isArray(value)) {
      result += "?";
      expandedValues.push(value);
      continue;
    }

    if (value.length === 0) {
      result += "NULL";
      continue;
    }

    result += value.map(() => "?").join(", ");
    expandedValues.push(...value);
  }

  if (valueIndex !== values.length) {
    throw new Error(`SQLite parameter count mismatch: expected ${valueIndex}, received ${values.length}`);
  }

  return { sql: result, values: expandedValues };
}

function rewriteMySqlSyntax(sql: string) {
  return sql
    .replace(/\s+FOR\s+UPDATE\b/gi, "")
    .replace(/<=>/g, "IS")
    .replace(/\bCONVERT\((\?|[^,()]+)\s+USING\s+utf8mb4\)/gi, "$1")
    .replace(/\bJSON_CONTAINS\(([^,]+),\s*JSON_QUOTE\(\?\)\)/gi, "EXISTS (SELECT 1 FROM json_each($1) WHERE json_each.value = ?)")
    .replace(/\bORDER\s+BY\s+FIELD\(([^,]+),\s*\?\)/gi, "ORDER BY CASE $1 WHEN ? THEN 0 ELSE 1 END")
    .replace(/\bLEAST\(/gi, "min(")
    .replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, "INSERT OR IGNORE INTO");
}

function rewriteDuplicateKeyUpsert(sql: string) {
  return sql
    .replace(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/gi, "ON CONFLICT DO UPDATE SET")
    .replace(/\bVALUES\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/gi, "excluded.$1");
}

function rewriteSql(sql: string) {
  return rewriteDuplicateKeyUpsert(rewriteMySqlSyntax(sql));
}

function isReadQuery(sql: string) {
  return /^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql.trim());
}

function duplicateEntryError(error: unknown) {
  if (!(error instanceof Error)) return error;
  if (!/UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(error.message)) return error;
  Object.assign(error, { code: "ER_DUP_ENTRY" });
  return error;
}

function resultHeader(result: { changes: number | bigint; lastInsertRowid: number | bigint }): SqliteResult {
  const affectedRows = Number(result.changes);
  return {
    affectedRows,
    changedRows: affectedRows,
    insertId: Number(result.lastInsertRowid),
    warningStatus: 0,
  };
}

class SqliteDatabase {
  private readonly database: DatabaseSync;
  private lockTail = Promise.resolve();

  private constructor(database: DatabaseSync) {
    this.database = database;
    this.database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  }

  static async open(config: SqliteDatabaseConfig) {
    const { DatabaseSync } = await loadSqlite();
    if (config.path !== ":memory:") fs.mkdirSync(path.dirname(config.path), { recursive: true });
    return new SqliteDatabase(new DatabaseSync(config.path));
  }

  private async acquire() {
    const previous = this.lockTail;
    let release!: () => void;
    this.lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }

  async run<T>(operation: () => T) {
    const release = await this.acquire();
    try {
      return operation();
    } finally {
      release();
    }
  }

  async beginConnection() {
    const release = await this.acquire();
    return new SqliteConnection(this, this.database, release);
  }

  close() {
    if (this.database.isOpen) this.database.close();
  }

  execute(sql: string, values: readonly unknown[] = []) {
    const prepared = expandArrayParameters(rewriteSql(sql), values);
    const statement = this.database.prepare(prepared.sql);
    return resultHeader(statement.run(...prepared.values.map(normalizeValue)));
  }

  query(sql: string, values: readonly unknown[] = []) {
    const prepared = expandArrayParameters(rewriteSql(sql), values);
    const statement = this.database.prepare(prepared.sql);
    if (isReadQuery(prepared.sql)) {
      return statement.all(...prepared.values.map(normalizeValue)) as SqliteRow[];
    }
    return resultHeader(statement.run(...prepared.values.map(normalizeValue)));
  }
}

class SqliteConnection {
  private released = false;

  constructor(
    private readonly owner: SqliteDatabase,
    private readonly database: DatabaseSync,
    private readonly releaseLock: () => void,
  ) {}

  async query<T = SqliteRow[]>(sql: string, values: readonly unknown[] = []) {
    const result = this.run(sql, values);
    return [result as T, []] as [T, unknown[]];
  }

  async execute<T = SqliteResult>(sql: string, values: readonly unknown[] = []) {
    const result = this.run(sql, values);
    return [result as T, []] as [T, unknown[]];
  }

  async beginTransaction() {
    this.database.exec("BEGIN IMMEDIATE");
  }

  async commit() {
    this.database.exec("COMMIT");
  }

  async rollback() {
    if (this.database.isTransaction) this.database.exec("ROLLBACK");
  }

  release() {
    if (this.released) return;
    this.released = true;
    this.releaseLock();
  }

  private run(sql: string, values: readonly unknown[]) {
    try {
      const prepared = expandArrayParameters(rewriteSql(sql), values);
      const statement = this.database.prepare(prepared.sql);
      if (isReadQuery(prepared.sql)) {
        return statement.all(...prepared.values.map(normalizeValue));
      }
      return resultHeader(statement.run(...prepared.values.map(normalizeValue)));
    } catch (error) {
      throw duplicateEntryError(error);
    }
  }
}

export type SqlitePool = {
  query<T = SqliteRow[]>(sql: string, values?: readonly unknown[]): Promise<[T, unknown[]]>;
  execute<T = SqliteResult>(sql: string, values?: readonly unknown[]): Promise<[T, unknown[]]>;
  getConnection(): Promise<SqliteConnection>;
  end(): Promise<void>;
};

export async function createSqlitePool(config: SqliteDatabaseConfig): Promise<SqlitePool> {
  const database = await SqliteDatabase.open(config);
  return {
    async query<T = SqliteRow[]>(sql: string, values: readonly unknown[] = []) {
      try {
        const result = await database.run(() => database.query(sql, values));
        return [result as T, []] as [T, unknown[]];
      } catch (error) {
        throw duplicateEntryError(error);
      }
    },
    async execute<T = SqliteResult>(sql: string, values: readonly unknown[] = []) {
      try {
        const result = await database.run(() => database.execute(sql, values));
        return [result as T, []] as [T, unknown[]];
      } catch (error) {
        throw duplicateEntryError(error);
      }
    },
    getConnection: () => database.beginConnection(),
    async end() {
      await database.run(() => database.close());
    },
  };
}

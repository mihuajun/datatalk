import mysql, { type Pool } from "mysql2/promise";

import { getDatabaseConfig } from "@/lib/server/database-config";
import { createSqlitePool } from "@/lib/server/sqlite";

declare global {
  var __chatBiMySqlPool: Pool | undefined;
  var __chatBiSqlitePool: Pool | undefined;
}

function createPool() {
  const databaseConfig = getDatabaseConfig();

  return mysql.createPool({
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.username,
    password: databaseConfig.password,
    database: databaseConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 5000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    namedPlaceholders: true,
  });
}

const TRANSIENT_DATABASE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
]);

function isTransientDatabaseError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      TRANSIENT_DATABASE_ERROR_CODES.has(String((error as { code?: unknown }).code)),
  );
}

export async function withDatabaseReadRetry<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientDatabaseError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return operation();
  }
}

export function getDbPool() {
  const databaseConfig = getDatabaseConfig();
  if (databaseConfig.kind === "sqlite") {
    if (!globalThis.__chatBiSqlitePool) {
      const poolPromise = createSqlitePool(databaseConfig);
      // The rest of the server uses mysql2's Pool shape. SQLite keeps that shape
      // so repositories do not need a database-specific branch for every query.
      globalThis.__chatBiSqlitePool = {
        query: (sql: string, values?: readonly unknown[]) => poolPromise.then((pool) => pool.query(sql, values)),
        execute: (sql: string, values?: readonly unknown[]) => poolPromise.then((pool) => pool.execute(sql, values)),
        getConnection: () => poolPromise.then((pool) => pool.getConnection()),
        end: () => poolPromise.then((pool) => pool.end()),
      } as unknown as Pool;
    }
    return globalThis.__chatBiSqlitePool;
  }

  if (!globalThis.__chatBiMySqlPool) {
    globalThis.__chatBiMySqlPool = createPool();
  }

  return globalThis.__chatBiMySqlPool;
}

import path from "node:path";

import { readAppConfig, readOptionalStringConfigValue } from "@/lib/server/app-config";

const JDBC_PREFIX = "jdbc:";
export type MySqlDatabaseConfig = {
  kind: "mysql";
  url: string;
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
};

export type SqliteDatabaseConfig = {
  kind: "sqlite";
  url: string;
  path: string;
  username: "";
  password: "";
  host: string;
  port: 0;
  database: string;
};

export type DatabaseConfig = MySqlDatabaseConfig | SqliteDatabaseConfig;

function parseJdbcUrl(jdbcUrl: string) {
  const normalizedUrl = jdbcUrl.startsWith(JDBC_PREFIX) ? jdbcUrl.slice(JDBC_PREFIX.length) : jdbcUrl;
  const parsedUrl = new URL(normalizedUrl);

  return {
    host: parsedUrl.hostname,
    port: Number(parsedUrl.port || 3306),
    database: parsedUrl.pathname.replace(/^\//, ""),
  };
}

function defaultSqlitePath() {
  const configuredPath = process.env.SQLITE_DATABASE_PATH?.trim();
  if (configuredPath === ":memory:") return configuredPath;
  if (configuredPath) return path.resolve(configuredPath);

  const configuredStorageRoot = process.env.WORKSPACE_STORAGE_ROOT?.trim();
  const cwd = process.cwd();
  const storageRoot = configuredStorageRoot
    ? path.resolve(configuredStorageRoot)
    : (process.env.NODE_ENV === "production" && (cwd === "/app" || cwd.startsWith("/app/")))
      ? "/app/workspace"
      : path.resolve(cwd, "..", "datatalk-workspace");
  return path.join(storageRoot, "chat-bi.sqlite");
}

function parseSqlitePath(databaseUrl: string) {
  const value = databaseUrl.trim();
  if (value === "sqlite::memory:" || value === "sqlite:memory:") return ":memory:";

  const rawPath = value.slice("sqlite:".length).trim();
  if (!rawPath) return defaultSqlitePath();
  if (rawPath.startsWith("//")) return path.resolve(`/${rawPath.replace(/^\/+/, "")}`);
  return path.resolve(rawPath);
}

function sqliteConfig(databaseUrl = "") : SqliteDatabaseConfig {
  const databasePath = databaseUrl.trim().toLowerCase().startsWith("sqlite:")
    ? parseSqlitePath(databaseUrl)
    : defaultSqlitePath();
  return {
    kind: "sqlite",
    url: databaseUrl || `sqlite:${databasePath}`,
    path: databasePath,
    username: "",
    password: "",
    host: databasePath,
    port: 0,
    database: databasePath,
  };
}

export function getDatabaseConfig(): DatabaseConfig {
  const appConfig = readAppConfig();
  const configuredUrl = readOptionalStringConfigValue(appConfig?.database?.url);
  const configuredUsername = readOptionalStringConfigValue(appConfig?.database?.username);
  const configuredPassword = readOptionalStringConfigValue(appConfig?.database?.password);
  const envUrl = configuredUrl || process.env.DATABASE_URL?.trim() || "";
  const envUsername = configuredUsername || process.env.DATABASE_USERNAME?.trim() || "";
  const envPassword = configuredPassword || process.env.DATABASE_PASSWORD?.trim() || "";

  if (!envUrl) return sqliteConfig();
  if (envUrl.toLowerCase().startsWith("sqlite:")) return sqliteConfig(envUrl);

  // A MySQL connection is considered configured only when all three values are present.
  // This keeps an incomplete deployment from failing before the app can fall back to SQLite.
  if (!envUsername || !envPassword) return sqliteConfig();

  const url = envUrl;
  const parsed = parseJdbcUrl(url);

  return {
    kind: "mysql",
    url,
    username: envUsername,
    password: envPassword,
    ...parsed,
  };
}

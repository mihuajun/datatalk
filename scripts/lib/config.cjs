const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("yaml");

const CONFIG_SEARCH_PATHS = [
  path.resolve(process.cwd(), "config", "config.local.yaml"),
  path.resolve(process.cwd(), "config", "config.yaml"),
  path.resolve(__dirname, "../../config/config.local.yaml"),
  path.resolve(__dirname, "../../config/config.yaml"),
];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseEnvPlaceholder(value) {
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([\s\S]*))?\}$/.exec(value.trim());
  if (!match) return null;
  return {
    envName: match[1],
    defaultValue: match[2],
  };
}

function readAppConfig() {
  const resolvedPath = CONFIG_SEARCH_PATHS.find((candidatePath) => fs.existsSync(candidatePath)) ?? null;
  if (!resolvedPath) {
    throw new Error(`缺少配置文件：${CONFIG_SEARCH_PATHS.join("、")}`);
  }

  const parsed = parse(fs.readFileSync(resolvedPath, "utf8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`配置文件格式无效：${resolvedPath}`);
  }
  return parsed;
}

function readRequiredStringConfigValue(value, fieldName) {
  if (typeof value === "string" && value.trim()) {
    const placeholder = parseEnvPlaceholder(value);
    if (!placeholder) return value.trim();
    const envValue = process.env[placeholder.envName]?.trim();
    if (envValue) return envValue;
    if (typeof placeholder.defaultValue === "string" && placeholder.defaultValue.trim()) return placeholder.defaultValue.trim();
    throw new Error(`缺少环境变量：${placeholder.envName}`);
  }

  if (isRecord(value)) {
    const envName = typeof value.env === "string" ? value.env.trim() : "";
    const envValue = envName ? process.env[envName]?.trim() : "";
    if (envValue) return envValue;
    if (typeof value.default === "string" && value.default.trim()) return value.default.trim();
    if (envName) throw new Error(`缺少环境变量：${envName}`);
  }

  throw new Error(`缺少配置字段：${fieldName}`);
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
      : path.resolve(cwd, "..", "chat-bi-workspace");
  return path.join(storageRoot, "chat-bi.sqlite");
}


function sqliteConfig(databaseUrl = "") {
  const rawPath = databaseUrl.trim().toLowerCase().startsWith("sqlite:") ? databaseUrl.trim().slice("sqlite:".length).trim() : "";
  const databasePath = rawPath === ":memory:" || rawPath === "memory:"
    ? ":memory:"
    : rawPath
      ? path.resolve(rawPath.startsWith("//") ? `/${rawPath.replace(/^\/+/, "")}` : rawPath)
      : defaultSqlitePath();
  return {
    kind: "sqlite",
    url: databaseUrl || `sqlite:${databasePath}`,
    path: databasePath,
    host: databasePath,
    port: 0,
    user: "",
    username: "",
    password: "",
    database: databasePath,
  };
}

function readDatabaseConfig() {
  const urlValue = process.env.DATABASE_URL?.trim() || "";
  const username = process.env.DATABASE_USERNAME?.trim() || "";
  const password = process.env.DATABASE_PASSWORD?.trim() || "";
  if (!urlValue || urlValue.toLowerCase().startsWith("sqlite:") || !username || !password) return sqliteConfig(urlValue);

  const normalizedUrl = urlValue.startsWith("jdbc:") ? urlValue.slice(5) : urlValue;
  const url = new URL(normalizedUrl);

  return {
    kind: "mysql",
    url: urlValue,
    host: url.hostname,
    port: Number(url.port || 3306),
    user: username,
    password,
    database: url.pathname.replace(/^\//, "") || undefined,
  };
}

async function initializeSqliteDatabase(config) {
  require("tsx/cjs");
  const { initializeSqliteDatabase: initialize } = require("../../lib/server/sqlite-bootstrap.ts");
  await initialize(config);
}

module.exports = {
  CONFIG_SEARCH_PATHS,
  readAppConfig,
  readDatabaseConfig,
  readRequiredStringConfigValue,
  initializeSqliteDatabase,
};

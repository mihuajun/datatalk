import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_SEARCH_PATHS = [
  path.join(process.cwd(), "config", "config.local.yaml"),
  path.join(process.cwd(), "config", "config.yaml"),
  path.resolve(CURRENT_DIR, "../../config/config.local.yaml"),
  path.resolve(CURRENT_DIR, "../../config/config.yaml"),
];

type ConfigValue<T> = T | {
  env?: string;
  default?: T;
};

export type AppConfig = {
  database?: {
    url?: ConfigValue<string>;
    username?: ConfigValue<string>;
    password?: ConfigValue<string>;
  };
  reportEditLock?: {
    enabled?: ConfigValue<boolean> | ConfigValue<string>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseEnvPlaceholder(value: string) {
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([\s\S]*))?\}$/.exec(value.trim());
  if (!match) return null;
  return {
    envName: match[1],
    defaultValue: match[2],
  };
}

function parseBoolean(value: unknown, fieldName: string) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  throw new Error(`Invalid boolean config field: ${fieldName}`);
}

export function readAppConfig(): AppConfig | null {
  const resolvedPath = CONFIG_SEARCH_PATHS.find((candidatePath) => fs.existsSync(candidatePath)) ?? null;
  if (!resolvedPath) return null;

  const fileContent = fs.readFileSync(/*turbopackIgnore: true*/ resolvedPath, "utf8");
  const parsed = parse(fileContent);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid YAML config at ${resolvedPath}`);
  }

  return parsed as AppConfig;
}

export function readRequiredStringConfigValue(value: ConfigValue<string> | undefined, fieldName: string) {
  if (typeof value === "string" && value.trim()) {
    const placeholder = parseEnvPlaceholder(value);
    if (!placeholder) return value.trim();
    const envValue = process.env[placeholder.envName]?.trim();
    if (envValue) return envValue;
    if (typeof placeholder.defaultValue === "string" && placeholder.defaultValue.trim()) return placeholder.defaultValue.trim();
    throw new Error(`Missing required environment variable: ${placeholder.envName}`);
  }

  if (isRecord(value)) {
    const envName = typeof value.env === "string" ? value.env.trim() : "";
    const envValue = envName ? process.env[envName]?.trim() : "";
    if (envValue) return envValue;
    if (typeof value.default === "string" && value.default.trim()) return value.default.trim();
    if (envName) throw new Error(`Missing required environment variable: ${envName}`);
  }

  throw new Error(`Missing required config field: ${fieldName}`);
}

export function readBooleanConfigValue(value: unknown, fallback: boolean, fieldName: string) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const placeholder = parseEnvPlaceholder(value);
    if (!placeholder) return parseBoolean(value, fieldName);
    const envValue = process.env[placeholder.envName];
    if (typeof envValue === "string" && envValue.trim()) return parseBoolean(envValue, fieldName);
    if (typeof placeholder.defaultValue === "string" && placeholder.defaultValue.trim()) {
      return parseBoolean(placeholder.defaultValue, fieldName);
    }
    return fallback;
  }

  if (isRecord(value)) {
    const envName = typeof value.env === "string" ? value.env.trim() : "";
    const envValue = envName ? process.env[envName] : undefined;
    if (typeof envValue === "string" && envValue.trim()) return parseBoolean(envValue, fieldName);
    if ("default" in value) return parseBoolean(value.default, fieldName);
    return fallback;
  }

  throw new Error(`Invalid config field: ${fieldName}`);
}

import { readAppConfig, readOptionalStringConfigValue } from "@/lib/server/app-config";

function isSafeInternalPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}

function getWebAppUrl() {
  const appConfig = readAppConfig();
  return readOptionalStringConfigValue(appConfig?.site?.webAppUrl)
    || process.env.WEB_APP_URL?.trim()
    || "http://localhost:3001";
}

function isTrustedWebUrl(value: string) {
  try {
    const target = new URL(value);
    const trustedOrigin = new URL(getWebAppUrl());
    return ["http:", "https:"].includes(target.protocol)
      && !target.username
      && !target.password
      && target.origin === trustedOrigin.origin;
  } catch {
    return false;
  }
}

export function safeReturnTo(value: unknown) {
  if (typeof value !== "string") return "/reports";
  const normalized = value.trim();
  if (isSafeInternalPath(normalized) || isTrustedWebUrl(normalized)) return normalized;
  return "/reports";
}

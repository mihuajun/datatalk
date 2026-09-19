import { readAppConfig, readOptionalStringConfigValue } from "@/lib/server/app-config";

export function getWebAppUrl() {
  const appConfig = readAppConfig();
  return readOptionalStringConfigValue(appConfig?.site?.webAppUrl)
    || process.env.WEB_APP_URL?.trim()
    || "http://localhost:3001";
}

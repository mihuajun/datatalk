import { readAppConfig, readBooleanConfigValue } from "@/lib/server/app-config";

export function isResourceCenterEnabled() {
  const parsed = readAppConfig();
  return readBooleanConfigValue(parsed?.resourceCenter?.enabled ?? process.env.RESOURCE_CENTER_ENABLED, false, "resourceCenter.enabled");
}

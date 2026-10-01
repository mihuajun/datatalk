import { readAppConfig, readBooleanConfigValue } from "@/lib/server/app-config";

// Registration controls every non-password account entry point, including OAuth and password recovery.
export function isRegistrationEnabled() {
  const parsed = readAppConfig();
  return readBooleanConfigValue(parsed?.auth?.allowRegistration, true, "auth.allowRegistration");
}

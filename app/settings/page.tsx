import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AgentRuntimeSettings } from "@/components/settings/agent-runtime-settings";
import { getAgentRuntimeBrowserAuthUrl, getAgentRuntimeBrowserHostname } from "@/lib/server/agent-runtime";
import { getAuthSession, isAdministratorSession } from "@/lib/server/auth-session";

export default async function SettingsPage() {
  const session = await getAuthSession();
  if (!session) redirect("/");
  if (!isAdministratorSession(session)) redirect("/reports");

  const requestHeaders = await headers();
  const runtimeWebUrl = await getAgentRuntimeBrowserAuthUrl(getAgentRuntimeBrowserHostname(requestHeaders.get("host")));
  return <AgentRuntimeSettings initialRuntimeWebUrl={runtimeWebUrl} />;
}

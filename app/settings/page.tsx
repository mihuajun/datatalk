import { redirect } from "next/navigation";

import { AgentRuntimeSettings } from "@/components/settings/agent-runtime-settings";
import { getAuthSession, isAdminSession } from "@/lib/server/auth-session";

export default async function SettingsPage() {
  const session = await getAuthSession();
  if (!session) redirect("/");
  if (!isAdminSession(session)) redirect("/reports");

  return <AgentRuntimeSettings />;
}

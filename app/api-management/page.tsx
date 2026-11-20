import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/server/auth-session";
import { ApiManagement } from "@/components/settings/api-management";
export default async function ApiManagementPage() {
  const session = await getAuthSession();
  if (!session) redirect("/");
  return <ApiManagement />;
}

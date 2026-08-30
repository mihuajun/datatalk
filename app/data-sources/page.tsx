import { getAuthSession } from "@/lib/server/auth-session";
import { listDataSources } from "@/lib/server/data-source-repository";
import { DataSourcesClient } from "@/components/data-sources/data-sources-client";

export default async function DataSourcesPage() {
  const session = await getAuthSession();
  if (!session) return null;
  return <DataSourcesClient initialDataSources={await listDataSources(session.tenantId)} />;
}

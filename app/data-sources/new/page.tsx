import { getAuthSession } from "@/lib/server/auth-session";
import { ConnectorPickerClient } from "@/components/data-sources/connector-picker-client";

export default async function NewDataSourcePage() {
  const session = await getAuthSession();
  if (!session) return null;
  return <ConnectorPickerClient />;
}

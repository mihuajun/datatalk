import { redirect } from "next/navigation";

import { canAccessMembersSession, canManageMembersSession, getAuthSession } from "@/lib/server/auth-session";
import { listMembers } from "@/lib/server/member-repository";
import { MembersClient } from "@/components/members/members-client";

export default async function MembersPage() {
  const session = await getAuthSession();
  if (!session) redirect("/");
  if (!canAccessMembersSession(session)) redirect("/reports");

  const initialMembers = await listMembers(session.tenantId);
  return <MembersClient initialMembers={initialMembers} canManageMembers={canManageMembersSession(session)} />;
}

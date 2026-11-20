import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { isRegistrationEnabled } from "@/lib/server/auth-config";
import { getTenantConversationQuota } from "@/lib/server/conversation-quota";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  if (!isRegistrationEnabled()) {
    return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const remainingCount = await getTenantConversationQuota(session.tenantId);
  return NextResponse.json({ enabled: true, remainingCount }, { headers: { "Cache-Control": "no-store" } });
}

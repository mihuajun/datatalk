import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { refreshDataSourceStatuses } from "@/lib/server/data-source-repository";

export async function POST() {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  return NextResponse.json({ dataSources: await refreshDataSourceStatuses(session.tenantId) });
}

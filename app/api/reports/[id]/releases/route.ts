import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { listReportReleases } from "@/lib/server/report-repository";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const code = (await params).id;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code)) {
    return NextResponse.json({ message: "报表编码无效" }, { status: 400 });
  }

  try {
    const result = await listReportReleases(session.tenantId, code);
    return NextResponse.json(result);
  } catch (error) {
    console.error("List report releases failed", error);
    return NextResponse.json({ message: "版本数据暂时不可用" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { renameReport } from "@/lib/server/report-workspace-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  try {
    const body = await request.json() as { name?: unknown; lockToken?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 160) {
      return NextResponse.json({ message: "请输入有效的报表名称" }, { status: 400 });
    }

    return NextResponse.json(await renameReport({
      tenantId: session.tenantId,
      reportCode: (await params).id,
      userId: session.userId,
      name,
      lockToken: typeof body.lockToken === "string" ? body.lockToken : undefined,
    }));
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "报表名称更新失败" }, { status: 400 });
  }
}

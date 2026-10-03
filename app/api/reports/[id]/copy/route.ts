import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { copyWorkingReport } from "@/lib/server/report-copy-service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const code = (await params).id;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code)) {
    return NextResponse.json({ message: "报表编码无效" }, { status: 400 });
  }

  try {
    const body = await _request.json().catch(() => ({})) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length > 160) return NextResponse.json({ message: "报表名称不能超过 160 个字符" }, { status: 400 });
    const result = await copyWorkingReport({
      tenantId: session.tenantId,
      sourceCode: code,
      ownerId: session.userId,
      ownerName: session.name || session.username,
      name,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "复制报表失败";
    console.error("Copy report failed", error);
    if (message === "SOURCE_REPORT_NOT_FOUND") return NextResponse.json({ message: "源报表不存在" }, { status: 404 });
    if (message === "REPORT_NAME_TOO_LONG") return NextResponse.json({ message: "报表名称不能超过 160 个字符" }, { status: 400 });
    if (message === "COPIED_REPORT_INVALID") return NextResponse.json({ message: "源报表内容不符合复制要求" }, { status: 422 });
    return NextResponse.json({ message: "复制报表失败，请稍后重试" }, { status: 400 });
  }
}

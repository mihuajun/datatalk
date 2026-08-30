import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { deleteReportByCode, getCurrentReportPublicLink, getReportDetailByCode } from "@/lib/server/report-repository";

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  const reportCode = parseReportCode((await params).id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });
  try {
    const result = await getReportDetailByCode(session.tenantId, reportCode);
    if (!result) return NextResponse.json({ message: "报表不存在" }, { status: 404 });
    const publicLink = await getCurrentReportPublicLink(session.tenantId, reportCode);
    return NextResponse.json({
      ...result,
      publicLinkCode: publicLink?.publicLinkCode || null,
      publicLinkPassword: publicLink?.publicLinkPassword || null,
      publicLinkPasswordEnabled: publicLink?.publicLinkPasswordEnabled ?? false,
      publicLinkExpiresAt: publicLink?.publicLinkExpiresAt || null,
    });
  } catch (error) {
    console.error("Get report detail failed", error);
    return NextResponse.json({ message: "报表数据暂时不可用" }, { status: 500 });
  }
}

export async function PATCH(_request: Request) {
  return NextResponse.json({ message: "请通过工作区接口修改报表，PATCH definition_json 已停用" }, { status: 405 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  const reportCode = parseReportCode((await params).id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });

  try {
    const deleted = await deleteReportByCode({
      tenantId: session.tenantId,
      reportCode,
      userId: session.userId,
    });
    if (!deleted) return NextResponse.json({ message: "报表不存在" }, { status: 404 });
    return NextResponse.json({ success: true, report: deleted });
  } catch (error) {
    console.error("Delete report failed", error);
    return NextResponse.json({ message: "删除报表失败" }, { status: 500 });
  }
}

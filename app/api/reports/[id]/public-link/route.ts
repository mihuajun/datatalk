import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { updateReportPublicLink } from "@/lib/server/report-repository";

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

function parseExpiresAt(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return "invalid" as const;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return "invalid" as const;
  return date;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const reportCode = parseReportCode((await params).id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });

  const body = await request.json().catch(() => null) as {
    enabled?: unknown;
    rotate?: unknown;
    passwordEnabled?: unknown;
    resetPassword?: unknown;
    expiresAt?: unknown;
  } | null;
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ message: "公共链接状态无效" }, { status: 400 });
  }
  if (body.passwordEnabled !== undefined && typeof body.passwordEnabled !== "boolean") {
    return NextResponse.json({ message: "密码保护状态无效" }, { status: 400 });
  }
  if (body.rotate !== undefined && typeof body.rotate !== "boolean") {
    return NextResponse.json({ message: "链接更换参数无效" }, { status: 400 });
  }
  if (body.resetPassword !== undefined && typeof body.resetPassword !== "boolean") {
    return NextResponse.json({ message: "密码重置参数无效" }, { status: 400 });
  }
  const expiresAt = parseExpiresAt(body.expiresAt);
  if (expiresAt === "invalid") {
    return NextResponse.json({ message: "有效期必须是未来的时间" }, { status: 400 });
  }

  try {
    const result = await updateReportPublicLink({
      tenantId: session.tenantId,
      reportCode,
      userId: session.userId,
      enabled: body.enabled,
      rotate: body.rotate === true,
      passwordEnabled: body.passwordEnabled as boolean | undefined,
      resetPassword: body.resetPassword === true,
      expiresAt,
    });
    if (!result) return NextResponse.json({ message: "报表不存在" }, { status: 404 });
    return NextResponse.json({
      report: result.report,
      publicLinkCode: result.publicLinkCode,
      publicLinkPassword: result.publicLinkPassword,
      publicLinkPasswordEnabled: result.publicLinkPasswordEnabled,
      publicLinkExpiresAt: result.publicLinkExpiresAt,
    });
  } catch (error) {
    console.error("Update report public link failed", error);
    return NextResponse.json({ message: "公共链接状态更新失败" }, { status: 500 });
  }
}

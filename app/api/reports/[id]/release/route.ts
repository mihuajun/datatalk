import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/server/auth-session";
import { deleteReportRelease, publishReport, rollbackRelease } from "@/lib/server/report-workspace-service";

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

function releaseErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "RELEASE_NOT_FOUND":
      return "版本不存在或已被删除";
    case "RELEASE_CURRENT_CANNOT_DELETE":
      return "当前线上运行版本不能删除，请先切换到其他版本";
    case "RELEASE_REFERENCED_BY_RESOURCE":
      return "该版本已发布到资源中心，请先在资源中心移除后再删除";
    case "REPORT_NOT_FOUND":
      return "报表不存在";
    default:
      return code || "删除版本失败";
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({})) as { action?: string; version?: number };
    const code = (await params).id;
    if (body.action === "rollback") {
      if (!Number.isInteger(body.version)) return NextResponse.json({ message: "版本无效" }, { status: 400 });
      return NextResponse.json(await rollbackRelease(session.tenantId, code, body.version as number));
    }
    return NextResponse.json(await publishReport(session.tenantId, code, session.userId));
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "发布失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const code = parseReportCode((await params).id);
  if (!code) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });

  const body = await request.json().catch(() => ({})) as { version?: number };
  if (!Number.isInteger(body.version) || (body.version as number) <= 0) {
    return NextResponse.json({ message: "版本无效" }, { status: 400 });
  }

  try {
    return NextResponse.json(await deleteReportRelease(session.tenantId, code, body.version as number));
  } catch (error) {
    const code2 = error instanceof Error ? error.message : "";
    const status = code2 === "RELEASE_NOT_FOUND" || code2 === "REPORT_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ message: releaseErrorMessage(error) }, { status });
  }
}

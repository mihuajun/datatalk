import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/server/auth-session";
import { restoreReportEditToCommit, rollbackReportEdit } from "@/lib/server/report-workspace-service";
import { getReportDetailByCode } from "@/lib/server/report-repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession(); if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  try {
    const reportCode = (await params).id;
    const body = await request.json() as { auditId?: number; targetCommitHash?: string; lockToken?: string };
    if (typeof body.targetCommitHash === "string") {
      const result = await restoreReportEditToCommit({ tenantId: session.tenantId, reportCode, userId: session.userId, targetCommitHash: body.targetCommitHash, lockToken: typeof body.lockToken === "string" ? body.lockToken : undefined });
      const current = await getReportDetailByCode(session.tenantId, reportCode);
      return NextResponse.json({ ...result, webFiles: current?.webFiles, filterManifest: current?.filterManifest, report: current?.report });
    }
    if (!Number.isInteger(body.auditId)) return NextResponse.json({ message: "auditId 无效" }, { status: 400 });
    return NextResponse.json(await rollbackReportEdit(session.tenantId, reportCode, session.userId, body.auditId as number, typeof body.lockToken === "string" ? body.lockToken : undefined));
  }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "回退失败" }, { status: 400 }); }
}

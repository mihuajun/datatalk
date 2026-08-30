import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/server/auth-session";
import { publishReport, rollbackRelease } from "@/lib/server/report-workspace-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession(); if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  try { const body = await request.json().catch(() => ({})) as { action?: string; version?: number }; const code = (await params).id; if (body.action === "rollback") { if (!Number.isInteger(body.version)) return NextResponse.json({ message: "版本无效" }, { status: 400 }); return NextResponse.json(await rollbackRelease(session.tenantId, code, body.version as number)); } return NextResponse.json(await publishReport(session.tenantId, code, session.userId)); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "发布失败" }, { status: 400 }); }
}

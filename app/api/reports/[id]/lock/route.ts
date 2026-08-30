import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/server/auth-session";
import { getReportDetailByCode } from "@/lib/server/report-repository";
import { acquireReportEditLock, getReportEditLock, isReportEditLockEnabled, releaseReportEditLock, renewReportEditLock } from "@/lib/server/report-edit-lock";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  const reportCode = (await params).id;
  try {
    const body = await request.json().catch(() => ({})) as { action?: string; lockToken?: string };
    if (!isReportEditLockEnabled()) {
      if (body.action === "heartbeat" || body.action === "release") return NextResponse.json({ ok: true, lockEnabled: false });
      const lock = await acquireReportEditLock({ tenantId: session.tenantId, reportCode, userId: session.userId, username: session.username, name: session.name || session.username });
      return NextResponse.json({ locked: false, lockEnabled: false, lock });
    }
    if (body.action === "heartbeat") {
      const ok = body.lockToken ? await renewReportEditLock(session.tenantId, reportCode, body.lockToken) : false;
      return NextResponse.json({ ok }, { status: ok ? 200 : 409 });
    }
    if (body.action === "release") {
      const ok = body.lockToken ? await releaseReportEditLock(session.tenantId, reportCode, body.lockToken) : false;
      return NextResponse.json({ ok });
    }
    const report = await getReportDetailByCode(session.tenantId, reportCode);
    if (!report) return NextResponse.json({ message: "报表不存在" }, { status: 404 });
    const existing = await getReportEditLock(session.tenantId, reportCode);
    if (existing && existing.userId !== session.userId) return NextResponse.json({ locked: true, lock: existing }, { status: 409 });
    const lock = existing ?? await acquireReportEditLock({ tenantId: session.tenantId, reportCode, userId: session.userId, username: session.username, name: session.name || session.username });
    if (!lock) return NextResponse.json({ locked: true, lock: await getReportEditLock(session.tenantId, reportCode) }, { status: 409 });
    return NextResponse.json({ locked: false, lock });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "编辑锁不可用" }, { status: 400 });
  }
}

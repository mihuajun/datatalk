import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { resolveReportPreviewInspection, type ReportPreviewInspectionResult } from "@/lib/server/report-preview-inspection-bridge";
import { getReportDetailByCode, getReportWorkspaceFingerprint, readReportWorkspaceSnapshot } from "@/lib/server/report-repository";

const maxScreenshotDataUrlChars = 4 * 1024 * 1024;
const maxInspectionJsonChars = 800_000;
const pngDataUrlPattern = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorStatus(message: string) {
  if (message === "REPORT_PREVIEW_INSPECTION_FORBIDDEN") return 403;
  if (message === "REPORT_PREVIEW_INSPECTION_NOT_PENDING") return 409;
  return 400;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  const reportCode = (await params).id.trim();
  const report = await getReportDetailByCode(session.tenantId, reportCode);
  if (!report) return NextResponse.json({ message: "报表不存在" }, { status: 404 });
  const fingerprint = await getReportWorkspaceFingerprint(session.tenantId, reportCode);
  const snapshot = await readReportWorkspaceSnapshot(session.tenantId, reportCode, fingerprint);
  if (await getReportWorkspaceFingerprint(session.tenantId, reportCode) !== fingerprint) {
    return NextResponse.json({ message: "REPORT_PREVIEW_STALE_WORKSPACE" }, { status: 409 });
  }
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const reportCode = (await params).id.trim();
  const report = await getReportDetailByCode(session.tenantId, reportCode);
  if (!report) return NextResponse.json({ message: "报表不存在" }, { status: 404 });

  const body = await request.json().catch(() => null) as {
    dshSessionId?: unknown;
    requestId?: unknown;
    result?: unknown;
  } | null;
  if (!body || typeof body.dshSessionId !== "string" || !body.dshSessionId.trim() || typeof body.requestId !== "string" || !body.requestId.trim() || !isRecord(body.result)) {
    return NextResponse.json({ message: "预览检查响应参数无效" }, { status: 400 });
  }

  const candidate = body.result;
  const screenshotDataUrl = candidate.screenshotDataUrl;
  if (screenshotDataUrl !== undefined && (typeof screenshotDataUrl !== "string" || screenshotDataUrl.length > maxScreenshotDataUrlChars || !pngDataUrlPattern.test(screenshotDataUrl))) {
    return NextResponse.json({ message: "预览截图格式无效或过大" }, { status: 400 });
  }
  const inspection = candidate.inspection;
  if (inspection !== undefined && (!isRecord(inspection) || JSON.stringify(inspection).length > maxInspectionJsonChars)) {
    return NextResponse.json({ message: "预览检查结果过大或格式无效" }, { status: 400 });
  }

  const result: ReportPreviewInspectionResult = {
    ok: candidate.ok === true,
    source: "working",
    checkedAt: typeof candidate.checkedAt === "string" && candidate.checkedAt ? candidate.checkedAt : new Date().toISOString(),
    ...(inspection ? { inspection } : {}),
    ...(typeof screenshotDataUrl === "string" ? { screenshotDataUrl } : {}),
    ...(typeof candidate.workspaceFingerprint === "string" ? { workspaceFingerprint: candidate.workspaceFingerprint.slice(0, 100) } : {}),
    ...(typeof candidate.error === "string" ? { error: candidate.error.slice(0, 1000) } : {}),
    ...(typeof candidate.screenshotError === "string" ? { screenshotError: candidate.screenshotError.slice(0, 500) } : {}),
  };

  try {
    return NextResponse.json(await resolveReportPreviewInspection({
      requestId: body.requestId.trim(),
      dshSessionId: body.dshSessionId.trim(),
      tenantId: session.tenantId,
      userId: session.userId,
      reportCode,
      result,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "REPORT_PREVIEW_INSPECTION_INVALID";
    return NextResponse.json({ message }, { status: errorStatus(message) });
  }
}

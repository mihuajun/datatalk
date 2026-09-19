import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { executeReportDataRequest, getPublicReportRuntimeTarget, getPublishedResourceRuntimeTarget, getTenantReportRuntimeTarget } from "@/lib/server/report-data-runtime";

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

function parseDataId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value) ? value : null;
}

function parseSource(value: unknown) {
  return value === "release" ? "release" : value === "working" ? "working" : null;
}

function parseRuntimeTarget(value: unknown) {
  return value === "public-link" || value === "resource" ? value : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const reportCode = parseReportCode((await params).id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });

  const body = await request.json().catch(() => ({})) as { dataId?: unknown; filters?: unknown; source?: unknown; runtimeTarget?: unknown };
  const dataId = parseDataId(body.dataId);
  if (!dataId) return NextResponse.json({ message: "dataId 不正确" }, { status: 400 });
  const source = parseSource(body.source);
  if (!source) return NextResponse.json({ message: "source 不正确" }, { status: 400 });
  const runtimeTarget = parseRuntimeTarget(body.runtimeTarget);

  const session = await getAuthSession();

  try {
    if (source === "working") {
      if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
      const target = await getTenantReportRuntimeTarget(session.tenantId, reportCode);
      if (!target) return NextResponse.json({ message: "报表不存在" }, { status: 404 });
      const data = await executeReportDataRequest({
        tenantId: target.tenantId,
        reportCode: target.reportCode,
        source,
        dataId,
        filters: body.filters,
      });
      return NextResponse.json({ data });
    }

    if (!runtimeTarget && !session) {
      return NextResponse.json({ message: "未登录" }, { status: 401 });
    }

    const target = runtimeTarget === "public-link"
      ? await getPublicReportRuntimeTarget(reportCode)
      : runtimeTarget === "resource"
        ? await getPublishedResourceRuntimeTarget(reportCode)
        : await getTenantReportRuntimeTarget(session!.tenantId, reportCode);
    if (target && !target.releaseVersion) {
      return NextResponse.json({ message: "报表尚未发布" }, { status: 404 });
    }
    if (!target?.releaseVersion) return NextResponse.json({ message: "已发布报表不存在" }, { status: 404 });
    const data = await executeReportDataRequest({
      tenantId: target.tenantId,
      reportCode: target.reportCode,
      source,
      releaseVersion: target.releaseVersion,
      dataId,
      filters: body.filters,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "运行时数据请求失败" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";

import type { ResourceAssetType } from "@/lib/resource-center-types";
import { getAuthSession } from "@/lib/server/auth-session";
import { getReportDetailByCode } from "@/lib/server/report-repository";
import { recommendResourceCategories } from "@/lib/server/resource-category-recommender";
import { isResourceCenterEnabled } from "@/lib/server/resource-center-config";
import { listResourceCategories } from "@/lib/server/resource-repository";

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

function parseAssetType(value: unknown): ResourceAssetType | null {
  return value === "report" || value === "template" || value === "dataset" ? value : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  if (!isResourceCenterEnabled()) return NextResponse.json({ message: "资源中心能力未启用" }, { status: 404 });

  const reportCode = parseReportCode((await params).id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });
  const body = await request.json().catch(() => ({})) as { assetType?: unknown; title?: unknown; summary?: unknown };
  const assetType = parseAssetType(body.assetType);
  if (!assetType) return NextResponse.json({ message: "资源类型不正确" }, { status: 400 });

  try {
    const detail = await getReportDetailByCode(session.tenantId, reportCode);
    if (!detail) return NextResponse.json({ message: "报表不存在" }, { status: 404 });
    const categories = await listResourceCategories(assetType);
    const recommendations = await recommendResourceCategories({
      assetType,
      title: typeof body.title === "string" ? body.title.trim().slice(0, 160) : detail.definition?.title || detail.report.name,
      summary: typeof body.summary === "string" ? body.summary.trim().slice(0, 500) : detail.definition?.subTitle || null,
      reportName: detail.report.name,
      definition: detail.definition,
      categories,
    });
    return NextResponse.json({ assetType, recommendations });
  } catch (error) {
    console.error("Recommend resource category failed", error);
    return NextResponse.json({ message: "分类推荐暂时不可用", recommendations: [] }, { status: 200 });
  }
}

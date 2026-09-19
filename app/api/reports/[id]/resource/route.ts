import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import type { ResourceAssetType } from "@/lib/resource-center-types";
import { buildReleaseThumbnailUrl, writeResourceThumbnailDataUrl } from "@/lib/server/report-release-thumbnail";
import { getReportDetailByCode } from "@/lib/server/report-repository";
import { isResourceCenterEnabled } from "@/lib/server/resource-center-config";
import { getReportResourcePublicationState, upsertResourceItem } from "@/lib/server/resource-repository";
import { publishReport } from "@/lib/server/report-workspace-service";

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

  const body = await request.json().catch(() => ({})) as {
    title?: string;
    summary?: string | null;
    generatedThumbnailDataUrl?: string | null;
    generatedThumbnailSvg?: string | null;
    categoryId?: number | null;
    assetType?: string;
  };

  const title = optionalText(body.title);
  if (!title) return NextResponse.json({ message: "资源标题不能为空" }, { status: 400 });
  const assetType = parseAssetType(body.assetType ?? "report");
  if (!assetType) return NextResponse.json({ message: "资源类型不正确" }, { status: 400 });
  if (!Number.isInteger(body.categoryId)) return NextResponse.json({ message: "请选择资源分类" }, { status: 400 });

  try {
    const report = await getReportDetailByCode(session.tenantId, reportCode);
    if (!report) return NextResponse.json({ message: "报表不存在" }, { status: 404 });

    const publicationState = await getReportResourcePublicationState(session.tenantId, reportCode);
    if (!publicationState) return NextResponse.json({ message: "报表不存在" }, { status: 404 });

    let releaseVersion = publicationState.currentReleaseVersion;
    let reportPublished = false;
    const generatedThumbnailDataUrl = optionalText(body.generatedThumbnailDataUrl) || optionalText(body.generatedThumbnailSvg);
    let generatedThumbnailPersisted = false;
    if (!releaseVersion || publicationState.workingCommitHash !== publicationState.publishedCommitHash) {
      const published = await publishReport(session.tenantId, reportCode, session.userId, {
        resourceThumbnailDataUrl: generatedThumbnailDataUrl,
      });
      releaseVersion = published.version;
      reportPublished = true;
      generatedThumbnailPersisted = Boolean(generatedThumbnailDataUrl);
    }
    if (!releaseVersion) return NextResponse.json({ message: "报表尚未发布成功，请稍后重试" }, { status: 400 });
    if (generatedThumbnailDataUrl && !generatedThumbnailPersisted) {
      await writeResourceThumbnailDataUrl({
        tenantId: session.tenantId,
        reportCode,
        version: releaseVersion,
        dataUrl: generatedThumbnailDataUrl,
      });
      generatedThumbnailPersisted = true;
    }

    const autoThumbnailUrl = buildReleaseThumbnailUrl(
      reportCode,
      releaseVersion,
      generatedThumbnailPersisted ? Date.now() : null,
      generatedThumbnailPersisted ? "resource" : undefined,
    );

    const resourceItem = await upsertResourceItem({
      tenantId: session.tenantId,
      assetType,
      userId: session.userId,
      sourceCode: reportCode,
      sourceVersion: releaseVersion,
      title,
      summary: body.summary,
      thumbnailUrl: autoThumbnailUrl,
      categoryId: Number.isInteger(body.categoryId) ? Number(body.categoryId) : null,
    });

    return NextResponse.json({
      resourceItem,
      releaseVersion,
      reportPublished,
      sourceCommitHash: publicationState.workingCommitHash,
      reportStatus: "已发布",
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "同步资源中心失败" }, { status: 400 });
  }
}

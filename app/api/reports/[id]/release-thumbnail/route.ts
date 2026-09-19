import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import {
  LEGACY_RELEASE_THUMBNAIL_FILE,
  LEGACY_RESOURCE_RELEASE_THUMBNAIL_FILE,
  RELEASE_THUMBNAIL_FILE,
  RESOURCE_RELEASE_THUMBNAIL_FILE,
} from "@/lib/server/report-release-thumbnail";
import { getReportWorkspacePath } from "@/lib/server/report-workspace";
import { getPublishedResourceThumbnailTarget } from "@/lib/server/resource-repository";

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

function parseVersion(value: string | null) {
  if (!value) return null;
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const reportCode = parseReportCode((await params).id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });

  const requestUrl = new URL(request.url);
  const version = parseVersion(requestUrl.searchParams.get("version"));
  if (!version) return NextResponse.json({ message: "发布版本不正确" }, { status: 400 });

  const isResourceThumbnail = requestUrl.searchParams.get("variant") === "resource";
  let workspaceTenantId: number;
  let workspaceReportCode = reportCode;

  if (isResourceThumbnail) {
    const target = await getPublishedResourceThumbnailTarget(reportCode, version);
    if (!target) return NextResponse.json({ message: "资源缩略图不存在" }, { status: 404 });
    workspaceTenantId = target.tenantId;
    workspaceReportCode = target.reportCode;
  } else {
    const session = await getAuthSession();
    if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
    workspaceTenantId = session.tenantId;
  }

  const releasePath = path.join(getReportWorkspacePath(workspaceTenantId, workspaceReportCode), "releases", `v${version}`);
  const candidates = isResourceThumbnail
    ? [
        { fileName: RESOURCE_RELEASE_THUMBNAIL_FILE, contentType: "image/png" },
        { fileName: LEGACY_RESOURCE_RELEASE_THUMBNAIL_FILE, contentType: "image/svg+xml; charset=utf-8" },
        { fileName: RELEASE_THUMBNAIL_FILE, contentType: "image/png" },
        { fileName: LEGACY_RELEASE_THUMBNAIL_FILE, contentType: "image/svg+xml; charset=utf-8" },
      ]
    : [
        { fileName: RELEASE_THUMBNAIL_FILE, contentType: "image/png" },
        { fileName: LEGACY_RELEASE_THUMBNAIL_FILE, contentType: "image/svg+xml; charset=utf-8" },
      ];

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(path.join(releasePath, candidate.fileName));
      return new NextResponse(content, {
        headers: {
          "Content-Type": candidate.contentType,
          "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        },
      });
    } catch {
      // Try the next format or the release thumbnail fallback.
    }
  }

  return NextResponse.json({ message: "缩略图不存在" }, { status: 404 });
}

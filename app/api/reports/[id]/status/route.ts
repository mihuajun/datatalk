import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { getPublicReportRuntimeTarget, getTenantReportRuntimeTarget } from "@/lib/server/report-data-runtime";
import { getAuthSession } from "@/lib/server/auth-session";
import { getReportWorkspacePath } from "@/lib/server/report-workspace";

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const reportCode = parseReportCode((await params).id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });

  // Try public link first (no auth required)
  const publicTarget = await getPublicReportRuntimeTarget(reportCode);
  const target = publicTarget || await (async () => {
    const session = await getAuthSession();
    if (!session) return null;
    return getTenantReportRuntimeTarget(session.tenantId, reportCode);
  })();

  if (!target) return NextResponse.json({ message: "报表不存在" }, { status: 404 });

  const generatingPath = path.join(getReportWorkspacePath(target.tenantId, target.reportCode), "releases", ".generating");
  let generating = false;
  let startedAt: string | null = null;
  try {
    const content = await fs.readFile(generatingPath, "utf8");
    generating = true;
    startedAt = content.trim() || null;
  } catch {
    // File doesn't exist, not generating
  }

  return NextResponse.json({
    generating,
    startedAt,
    releaseVersion: target.releaseVersion,
  });
}

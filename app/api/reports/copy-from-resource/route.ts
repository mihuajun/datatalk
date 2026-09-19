import { NextResponse } from "next/server";

import type { ResourceAssetType } from "@/lib/resource-center-types";
import { getAuthSession } from "@/lib/server/auth-session";
import { copyPublishedResourceReport } from "@/lib/server/report-copy-service";

type CopyableResourceAssetType = Extract<ResourceAssetType, "report" | "template">;

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function reportCode(value: unknown) {
  const code = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

function copyableAssetType(value: unknown): CopyableResourceAssetType | null {
  if (value == null || value === "" || value === "report") return "report";
  return value === "template" ? "template" : null;
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    sourceTenantId?: unknown;
    sourceCode?: unknown;
    sourceAssetType?: unknown;
  };
  const sourceTenantId = positiveInteger(body.sourceTenantId);
  const sourceCode = reportCode(body.sourceCode);
  const sourceAssetType = copyableAssetType(body.sourceAssetType);
  if (!sourceTenantId || !sourceCode || !sourceAssetType) return NextResponse.json({ message: "资源来源不正确" }, { status: 400 });

  try {
    const result = await copyPublishedResourceReport({
      targetTenantId: session.tenantId,
      ownerId: session.userId,
      ownerName: session.name || session.username,
      sourceTenantId,
      sourceCode,
      sourceAssetType,
    });
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "复制资源失败";
    const status = message === "RESOURCE_NOT_PUBLISHED" || message === "RESOURCE_RELEASE_NOT_FOUND" ? 404 : 400;
    console.error("Copy resource report failed", error);
    return NextResponse.json({ message: status === 404 ? "资源已下架或发布版本不可用" : "复制资源失败，请稍后重试" }, { status });
  }
}

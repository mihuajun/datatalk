import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { isAllowedReportAiArtifactPath, isReportAiImageArtifact } from "@/lib/report-ai-artifacts";
import { getAuthSession } from "@/lib/server/auth-session";
import { getReportDetailByCode } from "@/lib/server/report-repository";
import { getReportWorkingPath, resolveReportWorkingPath } from "@/lib/server/report-workspace";

const maxArtifactBytes = 25 * 1024 * 1024;
const contentTypes: Record<string, string> = {
  avif: "image/avif",
  csv: "text/csv; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  html: "text/html; charset=utf-8",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  pdf: "application/pdf",
  png: "image/png",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  svg: "image/svg+xml; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

function contentTypeFor(fileName: string) {
  const extension = fileName.split(".").at(-1)?.toLowerCase() || "";
  return contentTypes[extension] || "application/octet-stream";
}

function contentDisposition(fileName: string, disposition: "attachment" | "inline") {
  const asciiName = fileName.replace(/[^A-Za-z0-9._-]/g, "_") || "artifact";
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const routeParams = await params;
  const reportCode = parseReportCode(routeParams.id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });

  const relativePath = Array.isArray(routeParams.path) ? routeParams.path.join("/") : "";
  if (!isAllowedReportAiArtifactPath(relativePath)) {
    return NextResponse.json({ message: "文件地址不正确" }, { status: 400 });
  }

  try {
    const report = await getReportDetailByCode(session.tenantId, reportCode);
    if (!report) return NextResponse.json({ message: "报表不存在" }, { status: 404 });

    const workingPath = getReportWorkingPath(session.tenantId, reportCode);
    const filePath = resolveReportWorkingPath(session.tenantId, reportCode, relativePath);
    const [realWorkingPath, realFilePath] = await Promise.all([fs.realpath(workingPath), fs.realpath(filePath)]);
    if (realFilePath !== realWorkingPath && !realFilePath.startsWith(`${realWorkingPath}${path.sep}`)) {
      return NextResponse.json({ message: "文件地址不正确" }, { status: 400 });
    }

    const stat = await fs.stat(realFilePath);
    if (!stat.isFile()) return NextResponse.json({ message: "文件不存在" }, { status: 404 });
    if (stat.size > maxArtifactBytes) return NextResponse.json({ message: "文件过大，无法在线打开" }, { status: 413 });

    const content = await fs.readFile(realFilePath);
    const fileName = path.basename(realFilePath);
    const inline = isReportAiImageArtifact(relativePath) && new URL(request.url).searchParams.get("download") !== "1";
    return new NextResponse(content, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "Content-Disposition": contentDisposition(fileName, inline ? "inline" : "attachment"),
        "Content-Length": String(content.byteLength),
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
        "Content-Type": contentTypeFor(fileName),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.warn("Read report AI workspace file failed", {
      tenantId: session.tenantId,
      reportCode,
      relativePath,
      error,
    });
    return NextResponse.json({ message: "文件不存在或暂时不可用" }, { status: 404 });
  }
}

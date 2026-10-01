import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { getReportWorkingPath } from "@/lib/server/report-workspace";
import { normalizeReportThemeId, parseReportThemeFromDocument } from "@/lib/report-themes";

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

async function readReportDocument(workingPath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(workingPath, "report.json"), "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const reportCode = parseReportCode((await params).id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });

  const document = await readReportDocument(getReportWorkingPath(session.tenantId, reportCode));
  if (!document) return NextResponse.json({ message: "报表不存在" }, { status: 404 });

  return NextResponse.json({ theme: parseReportThemeFromDocument(document) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const reportCode = parseReportCode((await params).id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });

  const body = await request.json().catch(() => ({})) as { id?: unknown; custom?: unknown };
  const id = normalizeReportThemeId(body.id);
  const custom = typeof body.custom === "string" ? body.custom.trim() : "";
  if (id === "custom" && !custom) {
    return NextResponse.json({ message: "请填写自定义风格描述" }, { status: 400 });
  }

  const workingPath = getReportWorkingPath(session.tenantId, reportCode);
  const document = await readReportDocument(workingPath);
  if (!document) return NextResponse.json({ message: "报表不存在" }, { status: 404 });

  document.theme = { id, ...(custom ? { custom } : {}) };
  document.updatedAt = new Date().toISOString();
  await fs.writeFile(path.join(workingPath, "report.json"), `${JSON.stringify(document, null, 2)}\n`);

  return NextResponse.json({ theme: { id, ...(custom ? { custom } : {}) } });
}

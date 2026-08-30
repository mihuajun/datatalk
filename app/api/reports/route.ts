import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { createReport, listReports } from "@/lib/server/report-repository";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET() {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  try {
    return NextResponse.json(await listReports(session.tenantId));
  } catch (error) {
    console.error("List reports failed", error);
    return NextResponse.json({ message: "报表数据暂时不可用" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const folderId = parseId(body.folderId);
    const name = text(body.name);
    if (!folderId || !name || name.length > 160) {
      return NextResponse.json({ message: "请输入有效的报表名称" }, { status: 400 });
    }

    const report = await createReport({
      tenantId: session.tenantId,
      folderId,
      name,
      ownerId: session.userId,
      ownerName: session.name || session.username,
    });
    if (!report) return NextResponse.json({ message: "目录不存在" }, { status: 404 });
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    console.error("Create report failed", error);
    return NextResponse.json({ message: "创建报表失败" }, { status: 400 });
  }
}

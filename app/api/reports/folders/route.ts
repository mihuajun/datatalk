import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { createReportFolder } from "@/lib/server/report-repository";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseParentId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = text(body.name);
    const parentId = parseParentId(body.parentId);

    if (!name || name.length > 100 || parentId === undefined) {
      return NextResponse.json({ message: "请输入有效的目录名称" }, { status: 400 });
    }

    const folder = await createReportFolder({
      tenantId: session.tenantId,
      parentId,
      name,
      createdBy: session.userId,
    });

    if (!folder) {
      return NextResponse.json({ message: "上级目录不存在" }, { status: 400 });
    }

    return NextResponse.json({ folder }, { status: 201 });
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    const message = code === "REPORT_FOLDER_DUPLICATE" || code === "ER_DUP_ENTRY"
      ? "同级目录名称已存在"
      : "新建目录失败";
    console.error("Create report folder failed", error);
    return NextResponse.json({ message }, { status: 400 });
  }
}

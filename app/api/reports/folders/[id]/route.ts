import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { deleteReportFolder, renameReportFolder } from "@/lib/server/report-repository";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getErrorCode(error: unknown) {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

function errorResponse(error: unknown, fallback: string) {
  const code = getErrorCode(error);
  const messages: Record<string, string> = {
    REPORT_FOLDER_DUPLICATE: "同级目录名称已存在",
    REPORT_FOLDER_DEFAULT: "默认目录不能删除",
    REPORT_FOLDER_HAS_CHILDREN: "目录下还有子目录，请先处理子目录",
    REPORT_FOLDER_HAS_REPORTS: "目录下还有报表，请先移动或删除报表",
  };
  return NextResponse.json({ message: messages[String(code)] || fallback }, { status: 400 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const folderId = parseId((await params).id);
  if (!folderId) return NextResponse.json({ message: "目录编号不正确" }, { status: 400 });

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = text(body.name);
    if (!name || name.length > 100) {
      return NextResponse.json({ message: "请输入有效的目录名称" }, { status: 400 });
    }

    const folder = await renameReportFolder({ tenantId: session.tenantId, folderId, name });
    if (!folder) return NextResponse.json({ message: "目录不存在" }, { status: 404 });
    return NextResponse.json({ folder });
  } catch (error) {
    console.error("Rename report folder failed", error);
    return errorResponse(error, "重命名目录失败");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const folderId = parseId((await params).id);
  if (!folderId) return NextResponse.json({ message: "目录编号不正确" }, { status: 400 });

  try {
    const deleted = await deleteReportFolder(session.tenantId, folderId);
    if (!deleted) return NextResponse.json({ message: "目录不存在" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete report folder failed", error);
    return errorResponse(error, "删除目录失败");
  }
}

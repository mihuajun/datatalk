import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { duplicateDataSource } from "@/lib/server/data-source-repository";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ message: "连接器编号不正确" }, { status: 400 });
  try {
    const dataSource = await duplicateDataSource(session.tenantId, id);
    if (!dataSource) return NextResponse.json({ message: "连接器不存在" }, { status: 404 });
    return NextResponse.json({ dataSource }, { status: 201 });
  } catch (error) {
    console.error("Duplicate data source failed", error);
    return NextResponse.json({ message: "复制连接器失败" }, { status: 400 });
  }
}

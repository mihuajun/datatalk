import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { DATA_SOURCE_TYPES, deleteDataSource, updateDataSource, type DataSourceType } from "@/lib/server/data-source-repository";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const sourceType = (value: unknown): DataSourceType | null => typeof value === "string" && (DATA_SOURCE_TYPES as readonly string[]).includes(value) ? value : null;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ message: "连接器编号不正确" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const name = text(body.name); const type = sourceType(body.type); const host = text(body.host);
    const portValue = text(body.port); const port = portValue ? Number(portValue) : null;
    if (!name || !type || !host || (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))) return NextResponse.json({ message: "请填写完整且有效的连接器信息" }, { status: 400 });
    const dataSource = await updateDataSource({ tenantId: session.tenantId, id, name, type, host, port, database: text(body.database), username: text(body.username), password: text(body.password) || undefined });
    if (!dataSource) return NextResponse.json({ message: "连接器不存在" }, { status: 404 });
    return NextResponse.json({ dataSource });
  } catch (error: unknown) {
    const message = error instanceof Error && "code" in error && error.code === "ER_DUP_ENTRY" ? "连接器名称已存在" : "更新连接器失败";
    console.error("Update data source failed", error);
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ message: "连接器编号不正确" }, { status: 400 });
  await deleteDataSource(session.tenantId, id);
  return NextResponse.json({ success: true });
}

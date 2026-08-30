import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { DATA_SOURCE_TYPES, createDataSource, listDataSources, type DataSourceType } from "@/lib/server/data-source-repository";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const sourceType = (value: unknown): DataSourceType | null => typeof value === "string" && (DATA_SOURCE_TYPES as readonly string[]).includes(value) ? value : null;

export async function GET() {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  try {
    return NextResponse.json({ dataSources: await listDataSources(session.tenantId) });
  } catch (error) {
    console.error("List data sources failed", error);
    return NextResponse.json({ message: "连接器暂时不可用" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const name = text(body.name); const type = sourceType(body.type); const host = text(body.host);
    const portValue = text(body.port); const port = portValue ? Number(portValue) : null;
    const database = text(body.database); const username = text(body.username); const password = text(body.password);
    if (!name || !type || !host || (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))) return NextResponse.json({ message: "请填写完整且有效的连接器信息" }, { status: 400 });
    const dataSource = await createDataSource({ tenantId: session.tenantId, name, type, host, port, database, username, password, owner: session.name || session.username });
    return NextResponse.json({ dataSource }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error && "code" in error && error.code === "ER_DUP_ENTRY" ? "连接器名称已存在" : "新增连接器失败";
    console.error("Create data source failed", error);
    return NextResponse.json({ message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { isDataSourceType, testDataSourceConnection } from "@/lib/server/data-source-connection";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const type = body.type;
    const host = text(body.host);
    const portValue = text(body.port);
    const port = portValue ? Number(portValue) : null;
    if (!isDataSourceType(type) || !host || (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))) return NextResponse.json({ message: "请先填写有效的连接地址和端口" }, { status: 400 });
    const result = await testDataSourceConnection({ tenantId: session.tenantId, id: Number(body.id) || undefined, type, host, port, database: text(body.database), username: text(body.username), password: text(body.password) });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接失败，请检查连接器配置";
    console.error("Test data source connection failed", error);
    return NextResponse.json({ success: false, message: `连接失败：${message}` }, { status: 400 });
  }
}

import { NextResponse } from "next/server";

import { getAuthSession, isAdministratorSession } from "@/lib/server/auth-session";
import { getAgentModelConfig, saveAgentModelConfig } from "@/lib/server/agent-runtime";

export async function GET() {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  if (!isAdministratorSession(session)) return NextResponse.json({ message: "无权限" }, { status: 403 });

  try {
    return NextResponse.json({ model: getAgentModelConfig() });
  } catch (error) {
    console.error("Get agent model config failed", error);
    return NextResponse.json({ message: "读取模型配置失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  if (!isAdministratorSession(session)) return NextResponse.json({ message: "无权限" }, { status: 403 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const text = (value: unknown) => typeof value === "string" ? value : undefined;
    const model = await saveAgentModelConfig({
      baseUrl: text(body.baseUrl),
      apiKey: text(body.apiKey),
      model: text(body.model),
      imageModel: text(body.imageModel),
    });
    return NextResponse.json({ message: "模型配置已保存并立即生效", model });
  } catch (error) {
    console.error("Save agent model config failed", error);
    const message = error instanceof Error && error.message.trim() ? error.message : "保存模型配置失败";
    return NextResponse.json({ message }, { status: 400 });
  }
}

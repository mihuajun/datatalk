import { NextResponse } from "next/server";

import { getAuthSession, isAdministratorSession } from "@/lib/server/auth-session";
import { getAgentModelConfig, saveAgentModelConfig, updateScopedModelConfig } from "@/lib/server/agent-runtime";

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
    if (body.section !== undefined || body.action !== undefined) {
      if ((body.section !== "chat" && body.section !== "image") || (body.action !== "test" && body.action !== "save")) throw new Error("不支持的配置操作");
      const model = await updateScopedModelConfig(body.section, body.action, {
        baseUrl: text(body.baseUrl), model: text(body.model), apiKey: text(body.apiKey),
        imageEnabled: typeof body.imageEnabled === "boolean" ? body.imageEnabled : undefined, imageModel: text(body.imageModel), imageBaseUrl: text(body.imageBaseUrl), imageApiKey: text(body.imageApiKey), clearImageApiKey: body.clearImageApiKey === true,
      });
      return NextResponse.json({ model, message: `${body.section === "chat" ? "对话" : "图片"}模型${body.action === "test" ? "测试成功，未保存配置" : "配置已保存并写入 Runtime"}` });
    }
    const model = await saveAgentModelConfig({
      baseUrl: text(body.baseUrl),
      apiKey: text(body.apiKey),
      model: text(body.model),
      imageEnabled: typeof body.imageEnabled === "boolean" ? body.imageEnabled : undefined, imageModel: text(body.imageModel), imageBaseUrl: text(body.imageBaseUrl),
      imageApiKey: text(body.imageApiKey),
      clearImageApiKey: body.clearImageApiKey === true,
    });
    return NextResponse.json({ message: "模型配置已保存并立即生效", model });
  } catch (error) {
    console.error("Save agent model config failed", error);
    const message = error instanceof Error && error.message.trim() ? error.message : "保存模型配置失败";
    return NextResponse.json({ message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";

import { getAuthSession, isAdministratorSession } from "@/lib/server/auth-session";
import {
  getAgentRuntimeStatus,
  installAgentRuntime,
  restartAgentRuntime,
  startAgentRuntime,
  stopAgentRuntime,
} from "@/lib/server/agent-runtime";

export async function GET() {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  if (!isAdministratorSession(session)) {
    return NextResponse.json({ message: "无权限" }, { status: 403 });
  }

  try {
    return NextResponse.json({ runtime: await getAgentRuntimeStatus() });
  } catch (error) {
    console.error("Get agent runtime status failed", error);
    return NextResponse.json({ message: "读取 Agent Runtime 状态失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  if (!isAdministratorSession(session)) {
    return NextResponse.json({ message: "无权限" }, { status: 403 });
  }

  try {
    const body = await request.json() as { action?: string };

    switch (body.action) {
      case "install":
        return NextResponse.json({ message: "Agent Runtime 安装任务已启动", runtime: await installAgentRuntime() });
      case "start":
        return NextResponse.json({ message: "Agent Runtime 已启动", runtime: await startAgentRuntime() });
      case "restart":
        return NextResponse.json({ message: "Agent Runtime 已重启", runtime: await restartAgentRuntime() });
      case "stop":
        return NextResponse.json({ message: "Agent Runtime 已关闭", runtime: await stopAgentRuntime() });
      default:
        return NextResponse.json({ message: "不支持的操作" }, { status: 400 });
    }
  } catch (error) {
    console.error("Operate agent runtime failed", error);
    const message = error instanceof Error && error.message.trim() ? error.message : "Agent Runtime 操作失败";
    return NextResponse.json({ message }, { status: 500 });
  }
}

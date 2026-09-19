import { NextResponse } from "next/server";

import { getAuthSession, isAdministratorSession } from "@/lib/server/auth-session";
import { getAgentRuntimeBrowserAuthUrl, getAgentRuntimeBrowserHostname } from "@/lib/server/agent-runtime";

export async function GET(request: Request) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  if (!isAdministratorSession(session)) {
    return NextResponse.json({ message: "无权限" }, { status: 403 });
  }

  try {
    const authUrl = await getAgentRuntimeBrowserAuthUrl(getAgentRuntimeBrowserHostname(request.headers.get("host")));
    if (!authUrl) {
      return NextResponse.json({ message: "Agent Runtime 尚未启动或启动地址未就绪" }, { status: 503 });
    }

    return NextResponse.redirect(authUrl, {
      status: 303,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error("Open agent runtime web failed", error);
    return NextResponse.json({ message: "打开 Agent Runtime Web 失败" }, { status: 500 });
  }
}

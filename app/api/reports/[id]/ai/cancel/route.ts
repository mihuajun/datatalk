import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { cancelReportAgentFromRuntime } from "@/lib/server/agent-runtime-client";
import { getReportAiConversation } from "@/lib/server/report-repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const reportCode = (await params).id;
  const body = await request.json().catch(() => ({})) as { conversationId?: unknown };
  const conversationId = typeof body.conversationId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(body.conversationId)
    ? body.conversationId
    : "";
  if (!conversationId) return NextResponse.json({ message: "缺少 AI 会话" }, { status: 400 });

  try {
    const conversation = await getReportAiConversation(session.tenantId, reportCode, conversationId);
    if (!conversation) return NextResponse.json({ message: "会话不存在" }, { status: 404 });
    if (!conversation.dshSessionId) return NextResponse.json({ accepted: true });

    await cancelReportAgentFromRuntime(conversation.dshSessionId);
    return NextResponse.json({ accepted: true });
  } catch (error) {
    console.error("Cancel report AI task failed", {
      tenantId: session.tenantId,
      reportCode,
      conversationId,
      error,
    });
    return NextResponse.json({ message: error instanceof Error ? error.message : "终止 AI 任务失败" }, { status: 503 });
  }
}

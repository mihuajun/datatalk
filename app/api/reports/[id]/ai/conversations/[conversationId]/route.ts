import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { listRuntimeSessions, readRuntimePendingQuestion, readRuntimeSessionHistory, readRuntimeSessionHistoryPage } from "@/lib/server/agent-runtime-client";
import { getReportAiConversation } from "@/lib/server/report-repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; conversationId: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const { id: reportCode, conversationId } = await params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(conversationId)) return NextResponse.json({ message: "会话编码无效" }, { status: 400 });
  try {
    const result = await getReportAiConversation(session.tenantId, reportCode, conversationId);
    if (!result) return NextResponse.json({ message: "会话不存在" }, { status: 404 });
    if (!result.dshSessionId) return NextResponse.json({ ...result, events: [], runtimeRunning: false, runtimeAvailable: true }, { headers: { "Cache-Control": "no-store" } });

    const tailOnly = new URL(request.url).searchParams.get("tail") === "1";
    let runtimeRunning = false;
    let runtimeAvailable = false;
    let history: Awaited<ReturnType<typeof readRuntimeSessionHistory>> = [];
    let pendingQuestion: Awaited<ReturnType<typeof readRuntimePendingQuestion>> = null;

    try {
      const runtimeSessions = await listRuntimeSessions();
      runtimeAvailable = true;
      runtimeRunning = runtimeSessions.some((runtimeSession) => runtimeSession.sessionId === result.dshSessionId && runtimeSession.running);
    } catch (error) {
      console.error("[report-ai] runtime session status read failed", {
        reportCode,
        conversationId,
        dshSessionId: result.dshSessionId,
        error,
      });
    }

    try {
      history = tailOnly
        ? await readRuntimeSessionHistoryPage(result.dshSessionId, 1)
        : await readRuntimeSessionHistory(result.dshSessionId);
      runtimeAvailable = true;
    } catch (error) {
      console.error("[report-ai] runtime session history read failed", {
        reportCode,
        conversationId,
        dshSessionId: result.dshSessionId,
        error,
      });
    }

    if (runtimeRunning) {
      try {
        pendingQuestion = await readRuntimePendingQuestion(result.dshSessionId);
      } catch (error) {
        console.error("[report-ai] runtime pending question read failed", {
          reportCode,
          conversationId,
          dshSessionId: result.dshSessionId,
          error,
        });
      }
    }

    return NextResponse.json({ ...result, events: history, runtimeRunning, runtimeAvailable, pendingQuestion }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "读取 AI 对话失败" }, { status: 500 });
  }
}

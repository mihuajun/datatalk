import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { answerRuntimeQuestion, cancelRuntimeQuestion, type RuntimeQuestionAnswer } from "@/lib/server/agent-runtime-client";
import { getReportAiConversation } from "@/lib/server/report-repository";

function isQuestionAnswer(value: unknown): value is RuntimeQuestionAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const answers = (value as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) return false;
  return answers.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const candidate = item as { id?: unknown; selected?: unknown; custom?: unknown };
    return typeof candidate.id === "string"
      && Array.isArray(candidate.selected)
      && candidate.selected.every((selected) => typeof selected === "string")
      && (candidate.custom === undefined || typeof candidate.custom === "string");
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const reportCode = (await params).id;
  const body = await request.json().catch(() => ({})) as {
    conversationId?: unknown;
    questionRpcId?: unknown;
    action?: unknown;
    answer?: unknown;
  };
  const conversationId = typeof body.conversationId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(body.conversationId)
    ? body.conversationId
    : "";
  const questionRpcId = typeof body.questionRpcId === "string" && body.questionRpcId.trim()
    ? body.questionRpcId.trim()
    : "";
  const action = body.action === "cancel" ? "cancel" : "answer";

  if (!conversationId) return NextResponse.json({ message: "缺少 AI 会话" }, { status: 400 });
  if (!questionRpcId) return NextResponse.json({ message: "缺少问题标识" }, { status: 400 });
  if (action === "answer" && !isQuestionAnswer(body.answer)) {
    return NextResponse.json({ message: "问题答案格式无效" }, { status: 400 });
  }

  try {
    const conversation = await getReportAiConversation(session.tenantId, reportCode, conversationId);
    if (!conversation) return NextResponse.json({ message: "会话不存在" }, { status: 404 });
    if (!conversation.dshSessionId) return NextResponse.json({ message: "Runtime 会话不存在" }, { status: 409 });

    if (action === "cancel") {
      await cancelRuntimeQuestion({ questionRpcId });
      return NextResponse.json({ accepted: true });
    }

    await answerRuntimeQuestion({
      questionRpcId,
      sessionId: conversation.dshSessionId,
      answer: body.answer as RuntimeQuestionAnswer,
    });
    return NextResponse.json({ accepted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交问题答案失败";
    const questionExpired = message.includes("QUESTION_RESPONSE_REJECTED:not-pending")
      || message.includes("QUESTION_RESPONSE_REJECTED") && message.includes("no active event stream");
    const status = questionExpired ? 409 : 503;
    return NextResponse.json({
      message: status === 409 ? "当前问题已失效，请刷新对话后重试" : message,
    }, { status });
  }
}

import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { listRuntimeSessions, getRuntimeSessionTitle } from "@/lib/server/agent-runtime-client";
import { listReportAiConversationRecords, updateReportAiConversationTitle } from "@/lib/server/report-repository";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const reportCode = (await params).id;
  try {
    const records = await listReportAiConversationRecords(session.tenantId, reportCode);
    const runtimeTitles = new Map<string, string>();
    try {
      const runtimeSessions = await listRuntimeSessions();
      for (const runtimeSession of runtimeSessions) {
        const title = getRuntimeSessionTitle(runtimeSession);
        if (title) runtimeTitles.set(runtimeSession.sessionId, title);
      }
    } catch (runtimeError) {
      // The database index remains a usable fallback while Runtime is stopped.
      console.warn("Read runtime report AI conversation titles failed", {
        tenantId: session.tenantId,
        reportCode,
        error: runtimeError,
      });
    }

    const conversations = await Promise.all(records.map(async ({ conversation, dshSessionId }) => {
      const runtimeTitle = dshSessionId ? runtimeTitles.get(dshSessionId) : undefined;
      if (!runtimeTitle || runtimeTitle === conversation.title) return conversation;

      try {
        await updateReportAiConversationTitle({
          tenantId: session.tenantId,
          reportCode,
          conversationId: conversation.id,
          title: runtimeTitle,
        });
      } catch (runtimeTitleError) {
        console.warn("Persist runtime report AI conversation title failed", {
          tenantId: session.tenantId,
          reportCode,
          conversationId: conversation.id,
          error: runtimeTitleError,
        });
      }
      return { ...conversation, title: runtimeTitle };
    }));

    return NextResponse.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("List report AI conversations failed", {
      tenantId: session.tenantId,
      reportCode,
      error,
    });
    return NextResponse.json({ message: "AI 对话历史暂时不可用" }, { status: 500 });
  }
}

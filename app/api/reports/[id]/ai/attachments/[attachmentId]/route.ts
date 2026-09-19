import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { readRuntimeSessionAttachment } from "@/lib/server/agent-runtime-client";
import { getReportAiConversation } from "@/lib/server/report-repository";

const attachmentIdPattern = /^sha256:[a-f0-9]{64}$/;

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

function parseConversationId(value: string | null) {
  return value && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const { id, attachmentId } = await params;
  const reportCode = parseReportCode(id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });
  if (!attachmentIdPattern.test(attachmentId)) return NextResponse.json({ message: "图片附件标识无效" }, { status: 400 });

  const conversationId = parseConversationId(new URL(request.url).searchParams.get("conversationId"));
  if (!conversationId) return NextResponse.json({ message: "缺少 AI 会话" }, { status: 400 });

  try {
    // The conversation lookup enforces the current tenant/report boundary before
    // the Runtime's session-level attachment authorization is used.
    const conversation = await getReportAiConversation(session.tenantId, reportCode, conversationId);
    if (!conversation?.dshSessionId) return NextResponse.json({ message: "会话不存在" }, { status: 404 });

    const result = await readRuntimeSessionAttachment(conversation.dshSessionId, attachmentId);
    const content = Buffer.from(result.data, "base64");
    return new NextResponse(content, {
      headers: {
        "Content-Type": result.attachment.mediaType,
        "Content-Length": String(content.byteLength),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.warn("Read report AI image attachment failed", {
      tenantId: session.tenantId,
      reportCode,
      conversationId,
      attachmentId,
      error,
    });
    return NextResponse.json({ message: "图片附件暂时不可用" }, { status: 404 });
  }
}

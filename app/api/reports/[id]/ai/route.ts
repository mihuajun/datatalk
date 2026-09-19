import { getAuthSession } from "@/lib/server/auth-session";
import { requestReportAgentFromRuntime, waitForRuntimeSessionTitle, type RuntimePromptImage, type RuntimeQuestionEvent } from "@/lib/server/agent-runtime-client";
import { getAgentRuntimeStatus } from "@/lib/server/agent-runtime";
import { bindReportAgentSession } from "@/lib/server/report-agent-session-binding";
import { registerReportPreviewClient } from "@/lib/server/report-preview-inspection-bridge";
import { isReportEditLockEnabled } from "@/lib/server/report-edit-lock";
import { getReportAiConversation, getReportDetailByCode, readReportWorkspaceSnapshot, saveReportAiConversationIndex, updateReportAiConversationTitle } from "@/lib/server/report-repository";
import { getWorkspaceHead, getWorkspaceStatusEntries } from "@/lib/server/local-git";
import { finalizeMetricKnowledgeProposals } from "@/lib/server/report-metric-knowledge-service";
import { cleanupRuntimeAttachments, stageRuntimeAttachments, type RuntimeAttachmentInput } from "@/lib/server/report-runtime-attachments";
import { getReportWorkingPath, isAllowedReportWorkingFile } from "@/lib/server/report-workspace";
import { withReportAiWorkspaceCommitLock } from "@/lib/server/report-ai-workspace-lock";
import { commitRuntimeWorkspaceChanges } from "@/lib/server/report-workspace-service";

function sseEvent(type: string, payload: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function buildConversationTitle(message: string, existingTitle?: string | null) {
  if (existingTitle?.trim()) return existingTitle.trim();
  const normalized = message.replace(/\s+/g, " ").trim();
  return (normalized || "报表对话").slice(0, 160);
}

function runtimeTitleFromEvent(event: { type?: string; data?: unknown }) {
  if (event.type !== "session/title" || !event.data || typeof event.data !== "object" || Array.isArray(event.data)) return null;
  const title = (event.data as { title?: unknown }).title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

function toUserFacingAiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (message === "AGENT_RUNTIME_TIMEOUT") return "AI 处理超时，请稍后重试；如果持续超时，请检查 Agent Runtime。";
  if (message === "AGENT_RUNTIME_UNAUTHORIZED") return "Agent Runtime 鉴权已失效，请重启 Agent Runtime 后重试。";
  if (message === "DSH_EVENT_STREAM_FAILED" || message === "DSH_STREAM_FAILED") return "AI 实时连接中断，请稍后重试。";
  if (message.includes("UNDECLARED_WORKSPACE_CHANGES")) return "本次 AI 修改未提交，请检查报表工作区后重试。";
  if (message.toLowerCase().includes("does not support image input") || message.toLowerCase().includes("image input is not supported")) {
    return "当前模型不支持图片输入，请在 Agent Runtime 模型配置中选择支持视觉输入的模型。";
  }
  return message || "AI 报表处理失败";
}

const aiImageMediaTypes = new Set<RuntimePromptImage["mediaType"]>(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const maxAiImages = 4;
const maxAiImageDataChars = 14 * 1024 * 1024;

type ParsedAiRequest = {
  message: string;
  images: unknown;
  lockToken: string;
  conversationId: string | undefined;
  files: RuntimeAttachmentInput[];
};

function formText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function isRuntimeAttachmentFile(value: FormDataEntryValue): value is File {
  return typeof value !== "string"
    && typeof value.name === "string"
    && typeof value.size === "number"
    && typeof value.arrayBuffer === "function";
}

async function parseAiRequest(request: Request): Promise<ParsedAiRequest> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.includes("multipart/form-data")) {
    const body = await request.json().catch(() => ({})) as { message?: unknown; images?: unknown; lockToken?: unknown; conversationId?: unknown };
    return {
      message: typeof body.message === "string" ? body.message.trim() : "",
      images: body.images,
      lockToken: typeof body.lockToken === "string" ? body.lockToken : "",
      conversationId: typeof body.conversationId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(body.conversationId) ? body.conversationId : undefined,
      files: [],
    };
  }

  const formData = await request.formData();
  const rawImages = formData.get("images");
  let images: unknown;
  if (typeof rawImages === "string" && rawImages.trim()) {
    try {
      images = JSON.parse(rawImages);
    } catch {
      throw new Error("图片参数无效");
    }
  }

  const files = formData.getAll("files");
  if (files.some((file) => !isRuntimeAttachmentFile(file))) throw new Error("附件参数无效");

  const conversationId = formText(formData, "conversationId");
  return {
    message: formText(formData, "message").trim(),
    images,
    lockToken: formText(formData, "lockToken"),
    conversationId: /^[A-Za-z0-9_-]{1,80}$/.test(conversationId) ? conversationId : undefined,
    files: files.filter(isRuntimeAttachmentFile),
  };
}

function parseAiImages(value: unknown): RuntimePromptImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("图片参数无效");
  if (value.length > maxAiImages) throw new Error(`最多发送 ${maxAiImages} 张图片`);

  let totalDataChars = 0;
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("图片参数无效");
    const candidate = item as { mediaType?: unknown; data?: unknown; name?: unknown };
    if (typeof candidate.mediaType !== "string" || !aiImageMediaTypes.has(candidate.mediaType as RuntimePromptImage["mediaType"])) throw new Error("图片格式不受支持");
    if (typeof candidate.data !== "string" || !candidate.data || candidate.data.length > maxAiImageDataChars || !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate.data)) throw new Error("图片数据无效或过大");
    totalDataChars += candidate.data.length;
    if (totalDataChars > maxAiImages * maxAiImageDataChars) throw new Error("图片总大小超过限制");
    const name = typeof candidate.name === "string" ? candidate.name.replace(/[\\/]/g, "_").trim().slice(0, 120) : "";
    return {
      type: "image",
      mediaType: candidate.mediaType as RuntimePromptImage["mediaType"],
      data: candidate.data,
      ...(name ? { name } : {}),
    };
  });
}

function splitWorkspaceChanges(entries: Array<{ path: string; status: string }>) {
  const changedFiles: string[] = [];
  const deletedFiles: string[] = [];

  for (const entry of entries) {
    if (!entry.path) continue;
    if (entry.path === "runtime" || entry.path.startsWith("runtime/")) continue;
    if (!isAllowedReportWorkingFile(entry.path)) continue;
    if (entry.status.includes("D") && !entry.status.includes("R")) {
      deletedFiles.push(entry.path);
      continue;
    }
    changedFiles.push(entry.path);
  }

  return {
    changedFiles: [...new Set(changedFiles)],
    deletedFiles: [...new Set(deletedFiles)],
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return new Response(JSON.stringify({ message: "未登录" }), { status: 401, headers: { "Content-Type": "application/json" } });

  const reportCode = (await params).id;
  let parsedRequest: ParsedAiRequest;
  try {
    parsedRequest = await parseAiRequest(request);
  } catch (parseError) {
    return new Response(JSON.stringify({ message: parseError instanceof Error ? parseError.message : "AI 请求参数无效" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const message = parsedRequest.message;
  let images: RuntimePromptImage[];
  try {
    images = parseAiImages(parsedRequest.images);
  } catch (imageError) {
    return new Response(JSON.stringify({ message: imageError instanceof Error ? imageError.message : "图片参数无效" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const lockToken = parsedRequest.lockToken;
  const conversationId = parsedRequest.conversationId;
  if (!message && !images.length && !parsedRequest.files.length) return new Response(JSON.stringify({ message: "请输入报表请求或添加图片或附件" }), { status: 400, headers: { "Content-Type": "application/json" } });
  if (isReportEditLockEnabled() && !lockToken) return new Response(JSON.stringify({ message: "编辑锁已失效，请退出后重新进入" }), { status: 409, headers: { "Content-Type": "application/json" } });

  const current = await getReportDetailByCode(session.tenantId, reportCode);
  if (!current) return new Response(JSON.stringify({ message: "报表不存在" }), { status: 404, headers: { "Content-Type": "application/json" } });

  const runtimeStatus = await getAgentRuntimeStatus();
  if (!runtimeStatus.running) return new Response(JSON.stringify({ message: "Agent Runtime 未运行，请先启动 Runtime" }), { status: 503, headers: { "Content-Type": "application/json" } });

  const previousConversation = conversationId ? await getReportAiConversation(session.tenantId, reportCode, conversationId) : null;
  const workingDirectory = getReportWorkingPath(session.tenantId, reportCode);
  let stagedAttachments;
  try {
    stagedAttachments = await stageRuntimeAttachments({
      workingDirectory,
      files: parsedRequest.files,
    });
  } catch (attachmentError) {
    return new Response(JSON.stringify({ message: attachmentError instanceof Error ? attachmentError.message : "附件上传失败" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  let clientDisconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (type: string, payload: unknown) => {
        if (clientDisconnected || controller.desiredSize === null) return;
        try {
          controller.enqueue(encoder.encode(sseEvent(type, payload)));
        } catch {
          clientDisconnected = true;
        }
      };

      const disposePreviewClientRef = { current: null as (() => void) | null };
      try {
        let persistedConversationId = conversationId;
        let conversation: Awaited<ReturnType<typeof saveReportAiConversationIndex>> | null = null;

        const persistConversation = async (dshSessionId: string) => {
          try {
            conversation = await saveReportAiConversationIndex({
              tenantId: session.tenantId,
              reportCode,
              userId: session.userId,
              conversationId: persistedConversationId,
              dshSessionId,
              title: buildConversationTitle(message, previousConversation?.conversation.title),
            });
            persistedConversationId = conversation.id;
            bindReportAgentSession({
              dshSessionId,
              tenantId: session.tenantId,
              userId: session.userId,
              reportCode,
              conversationId: conversation.id,
            });
            send("conversation", conversation);
          } catch (conversationError) {
            console.error("[report-ai] conversation persistence failed", {
              tenantId: session.tenantId,
              reportCode,
              conversationId: persistedConversationId,
              dshSessionId,
              error: conversationError,
            });
            send("warning", { message: "本次 AI 结果已完成，但 AI 对话历史保存失败" });
          }
        };

        const syncRuntimeConversationTitle = async (runtimeTitle: string) => {
          const persistedConversation = conversation as Awaited<ReturnType<typeof saveReportAiConversationIndex>> | null;
          if (!persistedConversation || persistedConversation.title === runtimeTitle) return;

          const updated = await updateReportAiConversationTitle({
            tenantId: session.tenantId,
            reportCode,
            conversationId: persistedConversation.id,
            title: runtimeTitle,
          });
          if (!updated) return;

          const nextConversation = { ...persistedConversation, title: runtimeTitle };
          conversation = nextConversation;
          send("conversation", nextConversation);
        };

        const runtimeResult = await requestReportAgentFromRuntime({
          message,
          images,
          attachments: stagedAttachments.files,
          workingDirectory,
          reportName: current.report.name,
          sessionId: previousConversation?.dshSessionId,
          tenantId: session.tenantId,
          reportCode,
          onSessionReady: (dshSessionId) => {
            disposePreviewClientRef.current?.();
            disposePreviewClientRef.current = registerReportPreviewClient({
              dshSessionId,
              tenantId: session.tenantId,
              userId: session.userId,
              reportCode,
              send,
            });
            bindReportAgentSession({
              dshSessionId,
              tenantId: session.tenantId,
              userId: session.userId,
              reportCode,
              conversationId: persistedConversationId || null,
            });
            return persistConversation(dshSessionId);
          },
          onEvent: async (event) => {
            send("runtime", event);
            const runtimeTitle = runtimeTitleFromEvent(event);
            if (runtimeTitle) {
              try {
                await syncRuntimeConversationTitle(runtimeTitle);
              } catch (runtimeTitleError) {
                console.warn("Sync runtime report AI conversation title event failed", {
                  tenantId: session.tenantId,
                  reportCode,
                  conversationId: persistedConversationId,
                  error: runtimeTitleError,
                });
              }
            }
          },
          onQuestionEvent: (event: RuntimeQuestionEvent) => {
            if (event.type === "question/requested") {
              send("question", {
                type: "requested",
                questionRpcId: event.rpcId,
                sessionId: event.sessionId,
                questions: event.questions,
              });
              return;
            }
            send("question", {
              type: "resolved",
              questionRpcId: event.questionRpcId,
              sessionId: event.sessionId,
              outcome: event.outcome,
            });
          },
        });

        // The session index is normally persisted from onSessionReady, before the
        // prompt starts. Retry here if that early write hit a transient DB failure.
        if (!conversation) await persistConversation(runtimeResult.dshSessionId);

        const persistedConversation = conversation as Awaited<ReturnType<typeof saveReportAiConversationIndex>> | null;
        if (persistedConversation) {
          try {
            const runtimeTitle = await waitForRuntimeSessionTitle(runtimeResult.dshSessionId, persistedConversation.title);
            if (runtimeTitle && runtimeTitle !== persistedConversation.title) {
              await syncRuntimeConversationTitle(runtimeTitle);
            }
          } catch (runtimeTitleError) {
            // Runtime title synchronization is advisory; it must not discard a
            // completed report edit or turn result.
            console.warn("Sync runtime report AI conversation title failed", {
              tenantId: session.tenantId,
              reportCode,
              conversationId: persistedConversation.id,
              dshSessionId: runtimeResult.dshSessionId,
              error: runtimeTitleError,
            });
          }
        }

        if (runtimeResult.cancelled) {
          send("result", { applied: false, cancelled: true, changedFiles: [], deletedFiles: [], commitHash: null, auditId: null });
          send("done", { applied: false, cancelled: true });
          return;
        }

        const workspaceCommit = await withReportAiWorkspaceCommitLock(session.tenantId, reportCode, async () => {
          const workspaceEntries = await getWorkspaceStatusEntries(session.tenantId, reportCode, "working");
          const { changedFiles, deletedFiles } = splitWorkspaceChanges(workspaceEntries);
          const hasWorkspaceChanges = changedFiles.length > 0 || deletedFiles.length > 0;
          if (!hasWorkspaceChanges) return { hasWorkspaceChanges, changedFiles, deletedFiles, commitResult: null };

          const commitResult = await commitRuntimeWorkspaceChanges({
            tenantId: session.tenantId,
            reportCode,
            userId: session.userId,
            lockToken,
            message: `Agent 修改报表：${message}`,
            changedFiles,
            deletedFiles,
            // Queued Runtime requests start with the same session state. Read the
            // current head inside the serialized commit section instead of using
            // a stale hash captured before earlier queued turns finished.
            baseCommitHash: (await getWorkspaceHead(session.tenantId, reportCode)) ?? undefined,
          });
          return { hasWorkspaceChanges, changedFiles, deletedFiles, commitResult };
        });
        const { changedFiles, deletedFiles, hasWorkspaceChanges } = workspaceCommit;

        let commitHash: string | null = null;
        let auditId: number | null = null;
        let metricKnowledge: Awaited<ReturnType<typeof finalizeMetricKnowledgeProposals>> | null = null;
        if (hasWorkspaceChanges && workspaceCommit.commitResult) {
          const commitResult = workspaceCommit.commitResult;
          commitHash = commitResult.commitHash;
          auditId = commitResult.auditId;
          try {
            metricKnowledge = await finalizeMetricKnowledgeProposals({
              tenantId: session.tenantId,
              reportCode,
              conversationId: persistedConversationId || conversationId || null,
              dshSessionId: runtimeResult.dshSessionId,
              opId: commitResult.opId,
            });
            if (metricKnowledge.drafts > 0) {
              send("warning", { message: `报表已提交；${metricKnowledge.drafts} 个指标候选因缺少确认或 SQL 预览保留为草稿` });
            }
          } catch (metricKnowledgeError) {
            console.error("[report-ai] metric knowledge finalization failed", {
              tenantId: session.tenantId,
              reportCode,
              dshSessionId: runtimeResult.dshSessionId,
              error: metricKnowledgeError,
            });
            send("warning", { message: "报表已提交，但指标知识沉淀失败；候选仍保留，可稍后补偿" });
          }
          const snapshot = await readReportWorkspaceSnapshot(session.tenantId, reportCode);
          send("runtime", { type: "workspace_snapshot", data: snapshot });
        }

        send("result", {
          applied: hasWorkspaceChanges,
          changedFiles,
          deletedFiles,
          commitHash,
          auditId,
          metricKnowledge,
        });
        send("done", { applied: hasWorkspaceChanges, commitHash, auditId });
      } catch (error) {
        const details = error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)
          ? error.issues.map((issue: { file?: string; message?: string }) => `${issue.file || "报表"}: ${issue.message || "校验失败"}`).join("；")
          : "";
        const publicError = toUserFacingAiError(error);
        send("error", { message: details ? `${publicError}：${details}` : publicError });
        send("done", { applied: false });
      } finally {
        disposePreviewClientRef.current?.();
        await cleanupRuntimeAttachments(stagedAttachments.directoryPath);
        if (!clientDisconnected && controller.desiredSize !== null) controller.close();
      }
    },
    cancel() {
      clientDisconnected = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

import { getAgentRuntimeStatus, getAgentRuntimeUrl } from "@/lib/server/agent-runtime";
import { getReportWorkspaceFingerprint, readReportWorkspaceSnapshot } from "@/lib/server/report-repository";

export type RuntimeConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RuntimePromptImage = {
  type: "image";
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string;
  name?: string;
};

export type RuntimeQuestionOption = {
  label: string;
  description?: string;
};

export type RuntimeQuestionIntent =
  | {
    kind: "plan-review";
    approve: string;
  };

export type RuntimeQuestionItem = {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: RuntimeQuestionOption[];
  multiSelect?: boolean;
  intent?: RuntimeQuestionIntent;
};

export type RuntimeQuestionAnswer = {
  answers: Array<{
    id: string;
    selected: string[];
    custom?: string;
  }>;
};

export type RuntimeQuestionRequestedEvent = {
  type: "question/requested";
  rpcId: string;
  sessionId: string;
  questions: RuntimeQuestionItem[];
};

export type RuntimeQuestionResolvedEvent = {
  type: "question/resolved";
  rpcId: string;
  sessionId: string;
  questionRpcId: string;
  outcome: "answered" | "cancelled";
};

export type RuntimeQuestionEvent =
  | RuntimeQuestionRequestedEvent
  | RuntimeQuestionResolvedEvent;

export type RuntimeEvent = {
  type: string;
  phase?: string;
  text?: string;
  detail?: string;
  seq?: number;
  time?: number;
  surfaceOp?: string;
  view?: {
    for?: "call" | "result";
    view?: { card?: string; [key: string]: unknown };
  };
  data?: unknown;
};

export type RuntimeAgentResult = {
  output: string;
  dshSessionId: string;
  cancelled: boolean;
  turnEndReason?: { kind?: string; reason?: string; error?: { message?: string; code?: string } };
};

export type RuntimeSessionSummary = {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  cwd?: string;
  projections?: {
    asOfSeq: number;
    values: Record<string, unknown>;
  };
};

export type RuntimeSessionHistoryEntry = {
  event: {
    type: string;
    seq: number;
    time: number;
    data: unknown;
    surfaceOp?: string;
  };
  view?: {
    for?: "call" | "result";
    view?: { card?: string; [key: string]: unknown };
  };
};

type RpcResponse<T> = {
  result?: { ok: boolean; value?: T; error?: { code?: string; message?: string } };
};

type RuntimeWorkspace = {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds?: string[];
};

function textFromRuntimeContent(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value.flatMap((part) => {
    if (!part || typeof part !== "object" || typeof (part as { text?: unknown }).text !== "string") return [];
    return [(part as { text: string }).text];
  }).join("");
}

function runtimeUserMessage(event: RuntimeSessionHistoryEntry["event"]) {
  const data = (event.data || {}) as Record<string, unknown>;
  const message = data.message && typeof data.message === "object" ? data.message as Record<string, unknown> : null;
  const source = data.source && typeof data.source === "object" ? data.source as Record<string, unknown> : null;
  const messageSource = message?.source && typeof message.source === "object" ? message.source as Record<string, unknown> : null;
  return {
    content: textFromRuntimeContent(data.content) || textFromRuntimeContent(message?.content),
    sourceKind: source?.kind || messageSource?.kind,
  };
}

async function rpc<T>(baseUrl: string, method: string, payload: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId: crypto.randomUUID(), method, payload }),
    cache: "no-store",
  });
  const body = await response.json() as RpcResponse<T>;
  if (!response.ok || !body.result?.ok || body.result.value === undefined) {
    throw new Error(body.result?.error?.message || `DSH_${method}_FAILED`);
  }
  return body.result.value;
}

async function createOrAdoptWorkspace(baseUrl: string, workingDirectory: string) {
  try {
    return (await rpc<{ workspace: RuntimeWorkspace }>(baseUrl, "workspace.create", {
      path: workingDirectory,
    })).workspace;
  } catch (error) {
    // Older Runtime versions can report a duplicate while the path is already
    // registered. Reconcile from the authoritative list before failing.
    const message = error instanceof Error ? error.message : String(error);
    if (!/already in use/i.test(message)) throw error;

    const listed = await rpc<{ workspaces?: RuntimeWorkspace[] }>(baseUrl, "workspace.list", {});
    const existing = listed.workspaces?.find((workspace) => workspace.path === workingDirectory);
    if (!existing) throw error;
    return existing;
  }
}

async function renameWorkspaceIfAvailable(baseUrl: string, workspaceId: string, title: string) {
  try {
    await rpc(baseUrl, "workspace.rename", { workspaceId, title });
  } catch (error) {
    // A stale workspace registration may already own this display title. The
    // workspace path is the identity used by the agent, so keep its current
    // title and continue the request rather than failing the whole turn.
    const message = error instanceof Error ? error.message : String(error);
    if (!/already in use/i.test(message)) throw error;
  }
}

async function respond(baseUrl: string, payload: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as { accepted?: boolean; reason?: string };
  if (!response.ok) {
    throw new Error(typeof body.reason === "string" ? body.reason : "DSH_RESPOND_FAILED");
  }
  if (body.accepted !== true) {
    throw new Error(body.reason ? `QUESTION_RESPONSE_REJECTED:${body.reason}` : "QUESTION_RESPONSE_REJECTED");
  }
}

async function streamMuxFrames({
  baseUrl,
  signal,
  onFrame,
}: {
  baseUrl: string;
  signal: AbortSignal;
  onFrame: (frame: RuntimeQuestionEvent) => void | Promise<void>;
}) {
  const WebSocketConstructor = globalThis.WebSocket;
  if (typeof WebSocketConstructor !== "function") throw new Error("DSH_MUX_STREAM_UNAVAILABLE");

  const endpoint = new URL("/api/events.mux", baseUrl);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  const websocket = new WebSocketConstructor(endpoint);
  let settled = false;
  let messageChain = Promise.resolve();
  let removeAbortListener: () => void = () => undefined;

  const close = () => {
    if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) websocket.close();
  };

  const parseFrame = async (raw: unknown) => {
    const data = typeof raw === "string"
      ? raw
      : raw instanceof ArrayBuffer
        ? new TextDecoder().decode(raw)
        : raw instanceof Blob
          ? await raw.text()
          : String(raw);
    const envelope = JSON.parse(data) as { rpcId?: string; payload?: Record<string, unknown> };
    const payload = envelope.payload;
    if (!payload || typeof payload !== "object" || typeof payload.type !== "string") return;
    if (payload.type === "question/requested" && typeof envelope.rpcId === "string" && typeof payload.sessionId === "string" && Array.isArray(payload.questions)) {
      await onFrame({
        type: "question/requested",
        rpcId: envelope.rpcId,
        sessionId: payload.sessionId,
        questions: payload.questions as RuntimeQuestionItem[],
      });
      return;
    }
    if (
      payload.type === "question/resolved"
      && typeof envelope.rpcId === "string"
      && typeof payload.sessionId === "string"
      && typeof payload.questionRpcId === "string"
      && (payload.outcome === "answered" || payload.outcome === "cancelled")
    ) {
      await onFrame({
        type: "question/resolved",
        rpcId: envelope.rpcId,
        sessionId: payload.sessionId,
        questionRpcId: payload.questionRpcId,
        outcome: payload.outcome,
      });
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        removeAbortListener();
        close();
        if (error) reject(error);
        else resolve();
      };

      const onAbort = () => finish();
      signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", onAbort);

      websocket.addEventListener("message", (event) => {
        messageChain = messageChain.then(() => parseFrame(event.data)).catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
      });
      websocket.addEventListener("error", () => finish(new Error("DSH_MUX_STREAM_FAILED")));
      websocket.addEventListener("close", () => {
        if (!signal.aborted) finish(new Error("DSH_MUX_STREAM_FAILED"));
        else finish();
      });
      if (signal.aborted) finish();
    });
    await messageChain;
  } finally {
    removeAbortListener();
    close();
  }
}

function runtimeBaseUrl() {
  return getAgentRuntimeUrl();
}

async function runWebAgent(input: {
  message: string;
  images?: RuntimePromptImage[];
  workingDirectory: string;
  reportName: string;
  reportCode?: string;
  tenantId?: number;
  sessionId?: string | null;
  onSessionReady?: (sessionId: string) => void | Promise<void>;
  onEvent?: (event: RuntimeEvent) => void | Promise<void>;
  onQuestionEvent?: (event: RuntimeQuestionEvent) => void | Promise<void>;
}) {
  const status = await getAgentRuntimeStatus();
  if (!status.running) throw new Error("Agent Runtime 未运行，请先启动 Runtime");
  const baseUrl = getAgentRuntimeUrl();
  const workspace = await createOrAdoptWorkspace(baseUrl, input.workingDirectory);
  if (input.reportCode) {
    await renameWorkspaceIfAvailable(baseUrl, workspace.workspaceId, `${input.reportName}/${input.reportCode}`);
  }
  const session = await rpc<{ sessionId: string }>(baseUrl, "session.create", {
    workspaceId: workspace.workspaceId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
  const sessionId = session.sessionId;
  await input.onSessionReady?.(sessionId);
  const muxAbortController = new AbortController();
  const deliveredQuestionRpcIds = new Set<string>();
  const deliverQuestionEvent = async (frame: RuntimeQuestionEvent) => {
    if (frame.sessionId !== sessionId) return;
    if (frame.type === "question/requested") {
      if (deliveredQuestionRpcIds.has(frame.rpcId)) return;
      deliveredQuestionRpcIds.add(frame.rpcId);
    }
    await input.onQuestionEvent?.(frame);
  };
  const muxWatcher = input.onQuestionEvent
    ? streamMuxFrames({
      baseUrl,
      signal: muxAbortController.signal,
      onFrame: async (frame) => {
        await deliverQuestionEvent(frame);
      },
    }).catch((error) => {
      if (muxAbortController.signal.aborted) return;
      throw error;
    })
    : Promise.resolve();
  const assistantParts: string[] = [];
  let lastWorkspaceFingerprint: string | null = null;
  let workspaceCheckTimer: ReturnType<typeof setTimeout> | null = null;
  let workspaceCheckChain = Promise.resolve();
  let workspaceCheckIdle: Promise<void> | null = null;
  let resolveWorkspaceCheckIdle: (() => void) | null = null;

  if (input.tenantId !== undefined && input.reportCode) {
    try {
      lastWorkspaceFingerprint = await getReportWorkspaceFingerprint(input.tenantId, input.reportCode);
    } catch {
      // A later workspace event can still establish the first usable fingerprint.
    }
  }

  const checkWorkspace = async () => {
    if (input.tenantId === undefined || !input.reportCode) return;
    try {
      const fingerprint = await getReportWorkspaceFingerprint(input.tenantId!, input.reportCode!);
      if (!fingerprint || fingerprint === lastWorkspaceFingerprint) return;
      const snapshot = await readReportWorkspaceSnapshot(input.tenantId!, input.reportCode!, fingerprint);
      lastWorkspaceFingerprint = fingerprint;
      await input.onEvent?.({ type: "workspace_snapshot", data: snapshot });
    } catch {
      // Workspace refresh is advisory and must not interrupt the agent turn.
    }
  };

  const scheduleWorkspaceCheck = () => {
    if (input.tenantId === undefined || !input.reportCode) return;
    if (workspaceCheckTimer) clearTimeout(workspaceCheckTimer);
    if (!workspaceCheckIdle) {
      workspaceCheckIdle = new Promise((resolve) => { resolveWorkspaceCheckIdle = resolve; });
    }
    workspaceCheckTimer = setTimeout(() => {
      workspaceCheckTimer = null;
      const resolveIdle = resolveWorkspaceCheckIdle;
      workspaceCheckIdle = null;
      resolveWorkspaceCheckIdle = null;
      workspaceCheckChain = workspaceCheckChain.then(checkWorkspace).finally(() => {
        resolveIdle?.();
      });
    }, 500);
  };

  const waitForWorkspaceChecks = async () => {
    while (true) {
      const idle = workspaceCheckIdle;
      if (idle) await idle;
      const chain = workspaceCheckChain;
      await chain;
      if (chain === workspaceCheckChain && !workspaceCheckIdle && !workspaceCheckTimer) return;
    }
  };

  const content = [
    ...(input.images || []),
    ...(input.message ? [{ type: "text" as const, text: input.message }] : []),
  ];

  // session.history is paged backwards from the tail and includes every
  // completed turn in the page. Capture the tail before prompting so a
  // resumed session cannot mistake an older turn/end for this request.
  const baselineHistory = await rpc<{ events: RuntimeSessionHistoryEntry[] }>(baseUrl, "session.history", { sessionId, maxMessages: 1 });
  const baselineEvents = baselineHistory.events || [];
  const baselineSeq = baselineEvents.reduce((max, entry) => Math.max(max, entry.event.seq ?? -1), -1);
  const baselineLastEvent = baselineEvents.reduce<RuntimeSessionHistoryEntry["event"] | null>((last, entry) => {
    if (!last || (entry.event.seq ?? -1) > (last.seq ?? -1)) return entry.event;
    return last;
  }, null);
  const baselineActiveTurn = baselineLastEvent?.type === "turn/end"
    ? null
    : typeof baselineLastEvent?.data === "object" && baselineLastEvent.data && typeof (baselineLastEvent.data as { turn?: unknown }).turn === "number"
      ? (baselineLastEvent.data as { turn: number }).turn
      : null;

  await rpc(baseUrl, "session.prompt", { sessionId, mode: "queue", content });

  const seenEventSequences = new Set<number>();
  let promptEventSeen = false;
  let candidateTurn: number | null = null;
  let targetTurn: number | null = null;
  let turnEndReason: RuntimeAgentResult["turnEndReason"];
  let pendingQuestionRecovery: Promise<void> | null = null;
  const deadline = Date.now() + 300000;
  let settled = false;
  while (!settled) {
    if (Date.now() >= deadline) throw new Error("AGENT_RUNTIME_TIMEOUT");
    const page = await rpc<{ events: RuntimeSessionHistoryEntry[] }>(baseUrl, "session.history", { sessionId, maxMessages: 500 });
    for (const entry of page.events || []) {
      const event = entry.event;
      if (event.seq === undefined || event.seq <= baselineSeq || seenEventSequences.has(event.seq)) continue;
      seenEventSequences.add(event.seq);
      const data = (event.data || {}) as Record<string, unknown>;
      await input.onEvent?.({
        type: event.type || "event",
        seq: event.seq,
        time: event.time,
        surfaceOp: event.surfaceOp,
        view: entry.view,
        data,
      });
      if (event.type === "tool/call" && data.name === "ask_user_question" && input.onQuestionEvent) {
        // The mux notification is transient. If a reconnect or a competing
        // mux consumer caused it to be missed, use the Runtime replay path
        // while the tool is still waiting instead of leaving the model to
        // continue without a visible question.
        pendingQuestionRecovery ??= readRuntimePendingQuestion(sessionId, 1200)
          .then((pending) => {
            if (!pending) return;
            return deliverQuestionEvent({
              type: "question/requested",
              rpcId: pending.rpcId,
              sessionId: pending.sessionId,
              questions: pending.questions,
            });
          })
          .catch(() => undefined)
          .finally(() => { pendingQuestionRecovery = null; });
        await pendingQuestionRecovery;
      }
      if (event.type === "turn/start" && typeof data.turn === "number") {
        if (promptEventSeen) targetTurn = data.turn;
        else if (baselineActiveTurn === null) candidateTurn = data.turn;
      }
      if (event.type === "user/message" && event.surfaceOp === "append") {
        const userMessage = runtimeUserMessage(event);
        const isUserSource = userMessage.sourceKind === "user" || userMessage.sourceKind === undefined;
        const hasMatchingText = !input.message || userMessage.content === input.message;
        if (isUserSource && hasMatchingText) {
          promptEventSeen = true;
          if (baselineActiveTurn === null && candidateTurn !== null) targetTurn = candidateTurn;
        }
      }
      if (event.type === "tool/result") scheduleWorkspaceCheck();
      if (event.type === "assistant/chunk") {
        const chunk = data.chunk as { type?: string; text?: string } | undefined;
        if (chunk?.type === "text-delta" && chunk.text) assistantParts.push(chunk.text);
      }
      if (event.type === "turn/end" && targetTurn !== null && data.turn === targetTurn) {
        const reason = data.reason;
        if (reason && typeof reason === "object") {
          turnEndReason = reason as RuntimeAgentResult["turnEndReason"];
        }
        settled = true;
      }
    }
    if (!settled) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  try {
    await waitForWorkspaceChecks();
  } finally {
    muxAbortController.abort();
    await muxWatcher.catch(() => undefined);
    if (workspaceCheckTimer) clearTimeout(workspaceCheckTimer);
    workspaceCheckTimer = null;
    const resolveIdle = resolveWorkspaceCheckIdle as unknown as (() => void) | null;
    if (resolveIdle) resolveIdle();
    workspaceCheckIdle = null;
    resolveWorkspaceCheckIdle = null;
  }
  return {
    sessionId,
    output: assistantParts.join(""),
    cancelled: turnEndReason?.kind === "aborted" || turnEndReason?.kind === "interrupted",
    ...(turnEndReason ? { turnEndReason } : {}),
  };
}

export async function requestReportAgentFromRuntime({
  message,
  images,
  workingDirectory,
  reportName,
  sessionId,
  tenantId,
  reportCode,
  onSessionReady,
  onEvent,
  onQuestionEvent,
}: {
  message: string;
  images?: RuntimePromptImage[];
  workingDirectory: string;
  reportName: string;
  sessionId?: string | null;
  tenantId?: number;
  reportCode?: string;
  onSessionReady?: (sessionId: string) => void | Promise<void>;
  onEvent?: (event: RuntimeEvent) => void | Promise<void>;
  onQuestionEvent?: (event: RuntimeQuestionEvent) => void | Promise<void>;
}) {
  const result = await runWebAgent({ message, images, workingDirectory, reportName, sessionId, tenantId, reportCode, onSessionReady, onEvent, onQuestionEvent });
  return {
    output: result.output,
    dshSessionId: result.sessionId,
    cancelled: result.cancelled,
    ...(result.turnEndReason ? { turnEndReason: result.turnEndReason } : {}),
  };
}

export async function listRuntimeSessions() {
  const status = await getAgentRuntimeStatus();
  if (!status.running) throw new Error("Agent Runtime 未运行，请先启动 Runtime");
  const result = await rpc<{ items: RuntimeSessionSummary[] }>(runtimeBaseUrl(), "session.list", {});
  return result.items || [];
}

export function getRuntimeSessionTitle(session: RuntimeSessionSummary | undefined) {
  const title = session?.projections?.values?.title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

export async function readRuntimeSessionTitle(sessionId: string) {
  const session = (await listRuntimeSessions()).find((item) => item.sessionId === sessionId);
  return getRuntimeSessionTitle(session);
}

export async function waitForRuntimeSessionTitle(sessionId: string, fallbackTitle?: string | null, timeoutMs = 3500) {
  const deadline = Date.now() + timeoutMs;
  let latestTitle: string | null = null;

  while (true) {
    latestTitle = await readRuntimeSessionTitle(sessionId);
    if (latestTitle && (!fallbackTitle || latestTitle !== fallbackTitle.trim())) return latestTitle;
    if (Date.now() >= deadline) return latestTitle;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function cancelReportAgentFromRuntime(sessionId: string) {
  const status = await getAgentRuntimeStatus();
  if (!status.running) throw new Error("Agent Runtime 未运行，请先启动 Runtime");
  return rpc<{ accepted: true }>(runtimeBaseUrl(), "session.cancel", { sessionId });
}

export async function readRuntimePendingQuestion(sessionId: string, timeoutMs = 800) {
  const status = await getAgentRuntimeStatus();
  if (!status.running) throw new Error("Agent Runtime 未运行，请先启动 Runtime");

  const controller = new AbortController();
  let pendingRpcId = "";
  let pendingSessionId = "";
  let pendingQuestions: RuntimeQuestionItem[] | null = null;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await streamMuxFrames({
      baseUrl: runtimeBaseUrl(),
      signal: controller.signal,
      onFrame: async (frame) => {
        if (frame.type !== "question/requested" || frame.sessionId !== sessionId) return;
        pendingRpcId = frame.rpcId;
        pendingSessionId = frame.sessionId;
        pendingQuestions = frame.questions;
        controller.abort();
      },
    });
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!pendingQuestions) return null;
  return {
    rpcId: pendingRpcId,
    sessionId: pendingSessionId,
    questions: pendingQuestions,
  };
}

export async function answerRuntimeQuestion(params: {
  questionRpcId: string;
  sessionId: string;
  answer: RuntimeQuestionAnswer;
}) {
  const status = await getAgentRuntimeStatus();
  if (!status.running) throw new Error("Agent Runtime 未运行，请先启动 Runtime");
  await respond(runtimeBaseUrl(), {
    type: "client-response",
    rpcId: params.questionRpcId,
    result: {
      ok: true,
      value: {
        sessionId: params.sessionId,
        answer: params.answer,
      },
    },
  });
  return { accepted: true as const };
}

export async function cancelRuntimeQuestion(params: {
  questionRpcId: string;
}) {
  const status = await getAgentRuntimeStatus();
  if (!status.running) throw new Error("Agent Runtime 未运行，请先启动 Runtime");
  await respond(runtimeBaseUrl(), {
    type: "client-response",
    rpcId: params.questionRpcId,
    result: {
      ok: false,
      error: {
        code: "cancelled",
        message: "the user closed this question request",
        details: {},
      },
    },
  });
  return { accepted: true as const };
}

export async function readRuntimeSessionHistoryPage(sessionId: string, maxMessages = 500) {
  const status = await getAgentRuntimeStatus();
  if (!status.running) throw new Error("Agent Runtime 未运行，请先启动 Runtime");
  const page = await rpc<{ events: RuntimeSessionHistoryEntry[]; hasMore: boolean }>(
    runtimeBaseUrl(),
    "session.history",
    { sessionId, maxMessages },
  );
  return page.events || [];
}

export async function readRuntimeSessionHistory(sessionId: string, maxMessages = 200) {
  const status = await getAgentRuntimeStatus();
  if (!status.running) throw new Error("Agent Runtime 未运行，请先启动 Runtime");

  const pages: RuntimeSessionHistoryEntry[][] = [];
  let beforeSeq: number | undefined;

  while (true) {
    const page = await rpc<{ events: RuntimeSessionHistoryEntry[]; hasMore: boolean }>(
      runtimeBaseUrl(),
      "session.history",
      {
        sessionId,
        maxMessages,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      },
    );
    const events = page.events || [];
    if (!events.length) break;
    pages.unshift(events);
    if (!page.hasMore) break;
    beforeSeq = events[0]?.event.seq;
    if (beforeSeq === undefined) break;
  }

  return pages.flat();
}

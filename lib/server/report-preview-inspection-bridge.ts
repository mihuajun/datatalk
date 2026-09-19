import { randomUUID } from "node:crypto";
import { getReportWorkspaceFingerprint } from "@/lib/server/report-repository";

const PREVIEW_INSPECTION_TIMEOUT_MS = 180_000;

export type ReportPreviewScreenshotMode = "thumbnail" | "full" | "element";

export type ReportPreviewInspectionRequest = {
  requestId: string;
  dshSessionId: string;
  reportCode: string;
  source: "working";
  includeScreenshot: boolean;
  screenshotMode: ReportPreviewScreenshotMode;
  screenshotSelector?: string;
  workspaceFingerprint: string;
};

export type ReportPreviewInspectionResult = {
  ok: boolean;
  source: "working";
  checkedAt: string;
  inspection?: Record<string, unknown>;
  screenshotDataUrl?: string;
  error?: string;
  screenshotError?: string;
  workspaceFingerprint?: string;
};

type PreviewClientChannel = {
  id: string;
  dshSessionId: string;
  tenantId: number;
  userId: number;
  reportCode: string;
  send: (type: string, payload: unknown) => void;
};

type PendingInspection = {
  dshSessionId: string;
  tenantId: number;
  userId: number;
  reportCode: string;
  workspaceFingerprint: string;
  resolve: (result: ReportPreviewInspectionResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const clientChannels = new Map<string, Map<string, PreviewClientChannel>>();
const pendingInspections = new Map<string, PendingInspection>();

function normalized(value: string) {
  return value.trim();
}

export function registerReportPreviewClient(input: Omit<PreviewClientChannel, "id">) {
  const channel: PreviewClientChannel = { ...input, id: randomUUID() };
  const channels = clientChannels.get(input.dshSessionId) || new Map<string, PreviewClientChannel>();
  channels.set(channel.id, channel);
  clientChannels.set(input.dshSessionId, channels);

  return () => {
    const current = clientChannels.get(channel.dshSessionId);
    current?.delete(channel.id);
    if (current && current.size === 0) clientChannels.delete(channel.dshSessionId);
  };
}

export async function requestReportPreviewInspection(input: {
  dshSessionId: string;
  tenantId: number;
  userId: number;
  reportCode: string;
  includeScreenshot?: boolean;
  screenshotMode?: ReportPreviewScreenshotMode;
  screenshotSelector?: string;
}) {
  const dshSessionId = normalized(input.dshSessionId);
  const reportCode = normalized(input.reportCode);
  const channels = clientChannels.get(dshSessionId);
  if (!channels || channels.size === 0) throw new Error("REPORT_PREVIEW_CLIENT_UNAVAILABLE");
  const eligibleChannels = [...channels.values()].filter((channel) =>
    channel.tenantId === input.tenantId
    && channel.userId === input.userId
    && channel.reportCode === reportCode,
  );
  if (!eligibleChannels.length) throw new Error("REPORT_PREVIEW_CLIENT_UNAVAILABLE");

  const requestId = randomUUID();
  const includeScreenshot = input.includeScreenshot === true;
  const screenshotMode: ReportPreviewScreenshotMode = input.screenshotMode === "full"
    ? "full"
    : input.screenshotMode === "element"
      ? "element"
      : "thumbnail";
  const screenshotSelector = typeof input.screenshotSelector === "string" ? input.screenshotSelector.trim() : "";
  if (screenshotSelector.length > 500) throw new Error("REPORT_PREVIEW_SELECTOR_INVALID");
  if (includeScreenshot && screenshotMode === "element" && !screenshotSelector) throw new Error("REPORT_PREVIEW_SELECTOR_REQUIRED");
  const workspaceFingerprint = await getReportWorkspaceFingerprint(input.tenantId, reportCode);

  return await new Promise<ReportPreviewInspectionResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingInspections.delete(requestId);
      reject(new Error("REPORT_PREVIEW_INSPECTION_TIMEOUT"));
    }, PREVIEW_INSPECTION_TIMEOUT_MS);

    pendingInspections.set(requestId, {
      dshSessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      reportCode,
      workspaceFingerprint,
      resolve: (result) => {
        clearTimeout(timer);
        pendingInspections.delete(requestId);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        pendingInspections.delete(requestId);
        reject(error);
      },
      timer,
    });

    const payload: ReportPreviewInspectionRequest = {
      requestId,
      dshSessionId,
      reportCode,
      source: "working",
      includeScreenshot,
      screenshotMode,
      workspaceFingerprint,
      ...(screenshotSelector ? { screenshotSelector } : {}),
    };
    for (const channel of eligibleChannels) {
      channel.send("preview_inspection_request", payload);
    }
  });
}

export async function resolveReportPreviewInspection(input: {
  requestId: string;
  dshSessionId: string;
  tenantId: number;
  userId: number;
  reportCode: string;
  result: ReportPreviewInspectionResult;
}) {
  const requestId = normalized(input.requestId);
  const pending = pendingInspections.get(requestId);
  if (!pending) throw new Error("REPORT_PREVIEW_INSPECTION_NOT_PENDING");
  if (
    pending.dshSessionId !== normalized(input.dshSessionId)
    || pending.tenantId !== input.tenantId
    || pending.userId !== input.userId
    || pending.reportCode !== normalized(input.reportCode)
  ) {
    throw new Error("REPORT_PREVIEW_INSPECTION_FORBIDDEN");
  }

  const currentFingerprint = await getReportWorkspaceFingerprint(input.tenantId, pending.reportCode);
  const isCurrent = input.result.workspaceFingerprint === pending.workspaceFingerprint
    && currentFingerprint === pending.workspaceFingerprint;
  pending.resolve({
    ...input.result,
    ...(!isCurrent && input.result.ok ? { ok: false, error: "REPORT_PREVIEW_STALE_WORKSPACE", screenshotDataUrl: undefined } : {}),
    source: "working",
    checkedAt: input.result.checkedAt || new Date().toISOString(),
  });
  return { accepted: true as const };
}

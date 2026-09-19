"use client";

import { type ChangeEvent, type ClipboardEvent, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderSearch,
  Hand,
  ImageIcon,
  LayoutDashboard,
  Link2,
  LineChart,
  LoaderCircle,
  MessageCircle,
  Minus,
  MousePointer2,
  MoreHorizontal,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Paperclip,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  ScanSearch,
  Send,
  Search,
  Settings2,
  Sparkles,
  Square,
  Table2,
  Terminal,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { ReportWebFrame } from "@/components/report-web-frame";
import { PublicLinkPanel } from "@/components/reports/public-link-panel";
import { ResourcePublishPanel } from "@/components/reports/resource-publish-panel";
import { reportAiArtifactDownloadUrl, resolveReportAiSandboxArtifact, type ReportAiArtifact } from "@/lib/report-ai-artifacts";
import { reportFilterManifestFromDefinition, reportFilterValuesToSearchParams, resolveReportFilterValues, type ReportFilterManifest } from "@/lib/report-filters";
import { readSelectedElementContext, runtimeMessageMatchesPending, withSelectedElementContext, type ReportSelectedElement } from "@/lib/report-element-context";
import { type ResourceAssetType, type ResourceCategoryOption, type ResourceCategoryRecommendation, type ResourceItemRecord } from "@/lib/resource-center-types";
import { type ReportDefinition, type ReportItem, type ReportWidget, type ReportWidgetType } from "@/lib/report-types";
import { composeWebReportSrcDoc, REPORT_MAX_CANVAS_WIDTH, resolveReportCanvasWidth, toWebReportFiles, type WebFileMap } from "@/lib/report-web";

const defaultDefinition: ReportDefinition = {
  title: "未命名报表",
  dateRange: "",
  filters: [],
  widgets: [],
};

const editorPreferences = {
  version: "datatalk.report-editor.preferences-version",
  aiPanelWidth: "datatalk.report-editor.ai-panel-width",
  aiPanelVisible: "datatalk.report-editor.ai-panel-visible",
  propertiesVisible: "datatalk.report-editor.properties-visible",
};
const editorPreferencesVersion = "3";
const defaultAiPanelWidth = 360;
const minAiPanelWidth = 300;
const defaultWebReportHeight = 800;
const minWebZoom = 10;
const maxWebZoom = 400;
const maxCaptureZoom = 100;
const reportCanvasPadding = 48;
const reportCanvasMinimumVisible = 96;
const reportCanvasZoomSensitivity = 0.0045;
const releaseThumbnailWidth = 1200;
const releaseThumbnailHeight = 630;

function getMaxAiPanelWidth() {
  return Math.max(minAiPanelWidth, Math.floor(window.innerWidth * 0.5));
}

const chartTypes: Array<{ type: ReportWidgetType; label: string; icon: typeof LineChart }> = [
  { type: "line", label: "折线图", icon: LineChart },
  { type: "bar", label: "柱状图", icon: BarChart3 },
  { type: "table", label: "明细表", icon: Table2 },
];

type RuntimeImageAttachment = {
  attachmentId: string;
  mediaType: AiImageMediaType;
  bytes?: number;
  width?: number;
  height?: number;
  name?: string;
};

type AiTimelineNode =
  | { id: string; kind: "user"; content: string; selectedElements?: ReportSelectedElement[]; images?: string[]; time?: number }
  | { id: string; kind: "assistant"; content: string; reasoning?: string; time?: number; streaming?: boolean; interrupted?: boolean }
  | { id: string; kind: "question"; status: "running" | "done" | "error"; questions: PendingQuestionItem[]; input?: string; output?: string; answer?: PendingQuestionAnswer; outcome?: "answered" | "cancelled"; time?: number }
  | { id: string; kind: "tool"; name: string; status: "running" | "done" | "error"; summary?: string; detail?: string; images?: RuntimeImageAttachment[]; time?: number }
  | { id: string; kind: "command"; name: string; args?: string; status: "running" | "success" | "error"; summary?: string; detail?: string; time?: number }
  | { id: string; kind: "retry"; provider?: string; status: "scheduled" | "started" | "cancelled"; retry?: number; maxRetries?: number; delayMs?: number; failure?: string; summary?: string; time?: number }
  | { id: string; kind: "compaction"; summary?: string; shadowedItemCount?: number; shadowedTokenCount?: number; time?: number }
  | { id: string; kind: "progress"; turn?: number; step?: number; label: string; doneLabel?: string; status: "running" | "done"; detail?: string; time?: number }
  | { id: string; kind: "notice"; tone: "info" | "warning" | "error"; content: string; time?: number };

type AiConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

type AiImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

type AiImageDraft = {
  id: string;
  name?: string;
  mediaType: AiImageMediaType;
  data: string;
  previewUrl: string;
};

type AiFileDraft = {
  id: string;
  file: File;
};

type SentAiImagePreview = {
  id: string;
  message: string;
  previews: string[];
};

type PendingAiMessage = {
  id: string;
  message: string;
  previews: string[];
  files?: string[];
  time: number;
  queued: boolean;
};

type PendingQuestionOption = {
  label: string;
  description?: string;
};

type PendingQuestionIntent =
  | {
    kind: "plan-review";
    approve: string;
  };

type PendingQuestionItem = {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: PendingQuestionOption[];
  multiSelect?: boolean;
  intent?: PendingQuestionIntent;
};

type PendingQuestionAnswer = {
  answers: Array<{
    id: string;
    selected: string[];
    custom?: string;
  }>;
};

type PendingQuestionRequest = {
  rpcId: string;
  sessionId: string;
  questions: PendingQuestionItem[];
};

type AiStreamError = Error & { runtimeEventReported?: boolean };

const aiImageMediaTypes = new Set<AiImageMediaType>(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const aiImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const maxAiImages = 4;
const maxAiImageBytes = 10 * 1024 * 1024;
const aiFileExtensions = new Set([".txt", ".md", ".json", ".csv", ".tsv", ".pdf", ".docx", ".xlsx", ".xls", ".html"]);
const aiAttachmentAccept = "image/png,image/jpeg,image/webp,image/gif,.txt,.md,.json,.csv,.tsv,.pdf,.docx,.xlsx,.xls,.html";
const maxAiFiles = 10;
const maxAiFileBytes = 20 * 1024 * 1024;
const maxAiTotalFileBytes = 100 * 1024 * 1024;

type RuntimeContentBlock = { type?: string; text?: string; content?: string | RuntimeContentBlock[]; attachment?: RuntimeImageAttachment; isError?: boolean };

type RuntimeEventPayload = {
  type?: string;
  seq?: number;
  time?: number;
  surfaceOp?: string;
  text?: string;
  view?: { for?: "call" | "result"; view?: { card?: string; [key: string]: unknown } };
  data?: {
    id?: string;
    turn?: number;
    step?: number;
    reason?: { kind?: string; reason?: string; error?: { message?: string; code?: string } };
    source?: { kind?: string };
    retryId?: string;
    retry?: number;
    maxRetries?: number;
    provider?: string;
    delayMs?: number;
    policyKey?: string;
    failure?: { message?: string; code?: string; status?: number };
    commandId?: string;
    kind?: "success" | "error";
    args?: string;
    text?: string;
    content?: RuntimeContentBlock[];
    summary?: RuntimeContentBlock[] | string;
    shadowedTokenCount?: number;
    shadowedSeqs?: number[];
    sourceCommandId?: string;
    chunk?: { type?: string; text?: string; blockType?: string };
    message?: {
      id?: string;
      source?: { kind?: string; callId?: string };
      content?: RuntimeContentBlock[];
    };
    callId?: string;
    name?: string;
    arguments?: string;
    isError?: boolean;
    error?: { name?: string; code?: string };
    meta?: unknown;
  };
};

type RuntimeHistoryEntry = {
  event: RuntimeEventPayload;
  view?: RuntimeEventPayload["view"];
};

function runtimeEventsFromHistory(entries: RuntimeHistoryEntry[]) {
  return dedupeRuntimeEvents(entries.map((entry) => ({
    ...entry.event,
    view: entry.view,
  })));
}

// History can arrive through the initial load, the live stream, and recovery polling.
function stableRuntimeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(stableRuntimeValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableRuntimeValue(nested)}`)
      .join(",")}}`;
  }
  return typeof value;
}

function runtimeEventIdentity(event: RuntimeEventPayload) {
  const data = event.data;
  const messageId = event.type === "user/message"
    ? data?.id
    : event.type === "assistant/message"
      ? data?.message?.id
      : undefined;
  if (typeof messageId === "string" && messageId) return `message:${event.type}:${messageId}:${event.surfaceOp || ""}`;

  const operationId = event.type === "tool/call" || event.type === "tool/result"
    ? data?.callId || data?.message?.source?.callId
    : event.type === "command/run" || event.type === "command/done"
      ? data?.commandId
      : event.type === "llm/retry" || event.type === "llm/retry-started"
        ? data?.retryId
        : undefined;
  if (typeof operationId === "string" && operationId) return `operation:${event.type}:${operationId}`;
  if (typeof event.seq === "number") return `seq:${event.seq}`;
  return `fingerprint:${stableRuntimeValue(event)}`;
}

function dedupeRuntimeEvents(events: RuntimeEventPayload[]) {
  const uniqueEvents = new Map<string, RuntimeEventPayload>();
  for (const event of events) uniqueEvents.set(runtimeEventIdentity(event), event);
  return [...uniqueEvents.values()];
}

function mergeRuntimeEvents(current: RuntimeEventPayload[], incoming: RuntimeEventPayload[]) {
  const mergedEvents = dedupeRuntimeEvents([...current, ...incoming]);
  const sequenceEvents = new Map<number, RuntimeEventPayload>();
  const unsequencedEvents = mergedEvents.filter((event) => typeof event.seq !== "number");

  for (const event of mergedEvents) {
    if (typeof event.seq === "number") sequenceEvents.set(event.seq, event);
  }

  return [...unsequencedEvents, ...Array.from(sequenceEvents.entries()).sort(([left], [right]) => left - right).map(([, event]) => event)];
}

type ReportHistoryEntry = {
  commitHash: string;
  auditId: number | null;
  label: string;
};

type ResourcePublishFormState = {
  title: string;
  summary: string;
  thumbnailUrl: string;
  categoryId: string;
  assetType: ResourceAssetType;
};

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function escapeSvgText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function splitSvgLines(value: string, maxLength: number, maxLines: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return [];

  const lines: string[] = [];
  let current = "";
  for (const char of normalized) {
    const next = `${current}${char}`;
    if (next.length > maxLength) {
      lines.push(current);
      current = char;
      if (lines.length >= maxLines) break;
      continue;
    }
    current = next;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && normalized.length > lines.join("").length) {
    const last = lines[maxLines - 1] || "";
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  return lines.map((line) => escapeSvgText(line));
}

type ReportPreviewCapture = {
  dataUrl: string;
  width: number;
  height: number;
};

type ReportPreviewScreenshotMode = "thumbnail" | "full" | "element";

type ReportPreviewElementTarget = {
  selector: string;
  tag?: string;
  text?: string;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
};

type ReportPreviewInspectionRequest = {
  requestId: string;
  dshSessionId: string;
  reportCode: string;
  source: "working";
  includeScreenshot: boolean;
  screenshotMode: ReportPreviewScreenshotMode;
  screenshotSelector?: string;
  workspaceFingerprint: string;
};

type ReportPreviewInspectionResponse = {
  type?: string;
  requestId?: string;
  ok?: boolean;
  inspection?: Record<string, unknown>;
  capture?: Partial<ReportPreviewCapture> | null;
  error?: string;
};

type ReportPreviewInspectionResult = {
  ok: boolean;
  source: "working";
  checkedAt: string;
  inspection?: Record<string, unknown>;
  screenshotDataUrl?: string;
  error?: string;
  screenshotError?: string;
  workspaceFingerprint?: string;
};

const maxPreviewScreenshotDataUrlChars = 4 * 1024 * 1024;
function isPngDataUrl(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= maxPreviewScreenshotDataUrlChars
    && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/i.test(value);
}

type ThumbnailCaptureAttempt = { dataUrl: string | null; error?: string };

function thumbnailCaptureErrorMessage(error?: string) {
  if (error === "REPORT_PREVIEW_REFRESH_TIMEOUT") return "预览尚未加载完成";
  if (error === "REPORT_PREVIEW_FRAME_UNAVAILABLE") return "预览画布尚未就绪";
  if (error === "REPORT_PREVIEW_STALE_WORKSPACE") return "预览内容尚未同步";
  if (error === "REPORT_PREVIEW_INSPECTION_TIMEOUT") return "预览截图超时";
  if (error === "REPORT_CAPTURE_SVG_RENDER_TIMEOUT" || error === "REPORT_CAPTURE_TIMEOUT") return "截图渲染超时";
  if (error === "REPORT_CAPTURE_SVG_RENDER_FAILED") return "SVG 图像渲染失败";
  if (error === "REPORT_CAPTURE_DATA_TOO_LARGE") return "生成的图片过大";
  if (error === "REPORT_CAPTURE_IMAGE_DECODE_FAILED") return "截图图片无法读取";
  if (error === "REPORT_CAPTURE_CANVAS_UNAVAILABLE") return "截图画布不可用";
  if (error === "REPORT_CAPTURE_CANVAS_TAINTED") return "预览中有不可导出的跨域图片";
  return error ? `截图组件错误：${error.slice(0, 100)}` : "截图暂时不可用";
}

async function requestFrameElementLocation(frame: HTMLIFrameElement | null, selector: string) {
  const targetWindow = frame?.contentWindow;
  if (!targetWindow || !selector.trim()) return null;

  const requestId = `locate_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return await new Promise<ReportPreviewElementTarget | null>((resolve) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", handleMessage);
      window.clearTimeout(timeoutId);
    };
    const finish = (value: ReportPreviewElementTarget | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== targetWindow) return;
      const payload = event.data as { type?: string; requestId?: string; ok?: boolean; target?: Partial<ReportPreviewElementTarget> | null };
      if (payload?.type !== "__DATATALK_LOCATE_RESPONSE__" || payload.requestId !== requestId) return;
      const rect = payload.target?.rect;
      if (
        !payload.ok
        || typeof payload.target?.selector !== "string"
        || !rect
        || ![rect.left, rect.top, rect.width, rect.height].every((value) => typeof value === "number" && Number.isFinite(value))
        || rect.width <= 0
        || rect.height <= 0
      ) {
        finish(null);
        return;
      }
      finish(payload.target as ReportPreviewElementTarget);
    };
    const timeoutId = window.setTimeout(() => finish(null), 8000);
    window.addEventListener("message", handleMessage);
    targetWindow.postMessage({ type: "__DATATALK_LOCATE_REQUEST__", requestId, selector: selector.trim() }, "*");
  });
}

async function requestFramePreviewInspection(
  frame: HTMLIFrameElement | null,
  request: Pick<ReportPreviewInspectionRequest, "includeScreenshot" | "screenshotMode" | "screenshotSelector"> & { screenshotScale?: number },
  timeoutMs = request.includeScreenshot ? 120_000 : 30_000,
) {
  const targetWindow = frame?.contentWindow;
  const checkedAt = new Date().toISOString();
  if (!targetWindow) {
    return { ok: false, source: "working", checkedAt, error: "REPORT_PREVIEW_FRAME_UNAVAILABLE" } satisfies ReportPreviewInspectionResult;
  }

  const requestId = `inspect_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return await new Promise<ReportPreviewInspectionResult>((resolve) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", handleMessage);
      window.clearTimeout(timeoutId);
    };
    const finish = (value: ReportPreviewInspectionResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== targetWindow) return;
      const payload = event.data as ReportPreviewInspectionResponse;
      if (payload?.type !== "__DATATALK_INSPECT_RESPONSE__" || payload.requestId !== requestId) return;
      const baseResult: ReportPreviewInspectionResult = {
        ok: payload.ok === true,
        source: "working",
        checkedAt: new Date().toISOString(),
        ...(payload.inspection ? { inspection: payload.inspection } : {}),
        ...(payload.error ? { error: payload.error } : {}),
      };
      if (!payload.ok || !request.includeScreenshot) {
        finish(baseResult);
        return;
      }
      const dataUrl = payload.capture?.dataUrl;
      const dataUrlTooLarge = typeof dataUrl === "string" && dataUrl.length > maxPreviewScreenshotDataUrlChars;
      if (!isPngDataUrl(dataUrl)) {
        finish({ ...baseResult, screenshotError: dataUrlTooLarge ? "REPORT_CAPTURE_DATA_TOO_LARGE" : "REPORT_CAPTURE_UNAVAILABLE" });
        return;
      }
      finish({ ...baseResult, screenshotDataUrl: dataUrl });
    };
    const timeoutId = window.setTimeout(() => {
      finish({ ok: false, source: "working", checkedAt, error: "REPORT_PREVIEW_INSPECTION_TIMEOUT" });
    }, timeoutMs);
    window.addEventListener("message", handleMessage);
    targetWindow.postMessage({
      type: "__DATATALK_INSPECT_REQUEST__",
      requestId,
      includeScreenshot: request.includeScreenshot,
      screenshotMode: request.screenshotMode,
      screenshotSelector: request.screenshotSelector,
      screenshotScale: request.screenshotScale,
    }, "*");
  });
}

async function normalizeResourceThumbnail(dataUrl: string) {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error("REPORT_CAPTURE_IMAGE_DECODE_FAILED")), 15000);
    image.onload = () => { window.clearTimeout(timeoutId); resolve(); };
    image.onerror = () => { window.clearTimeout(timeoutId); reject(new Error("REPORT_CAPTURE_IMAGE_DECODE_FAILED")); };
    image.src = dataUrl;
  });
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("REPORT_CAPTURE_IMAGE_DECODE_FAILED");
  const canvas = document.createElement("canvas");
  canvas.width = releaseThumbnailWidth;
  canvas.height = releaseThumbnailHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("REPORT_CAPTURE_CANVAS_UNAVAILABLE");
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const sourceHeight = Math.min(image.naturalHeight, image.naturalWidth * releaseThumbnailHeight / releaseThumbnailWidth);
  context.drawImage(image, 0, 0, image.naturalWidth, sourceHeight, 0, 0,
    releaseThumbnailWidth, sourceHeight * releaseThumbnailWidth / image.naturalWidth);
  const normalized = canvas.toDataURL("image/png");
  if (!isPngDataUrl(normalized)) throw new Error("REPORT_CAPTURE_DATA_TOO_LARGE");
  return normalized;
}

async function requestResourceThumbnail(frame: HTMLIFrameElement | null, expectedFingerprint: string): Promise<ThumbnailCaptureAttempt> {
  const result = await requestFramePreviewInspection(frame, {
    includeScreenshot: true,
    screenshotMode: "thumbnail",
    screenshotScale: 1,
  });
  if (expectedFingerprint && result.inspection?.workspaceFingerprint !== expectedFingerprint) {
    return { dataUrl: null, error: "REPORT_PREVIEW_STALE_WORKSPACE" };
  }
  if (!result.ok || !result.screenshotDataUrl) {
    const error = (result.error || result.screenshotError || "REPORT_CAPTURE_UNAVAILABLE").split("\n")[0];
    console.warn("Resource thumbnail inspection failed", error);
    return { dataUrl: null, error };
  }
  try {
    return { dataUrl: await normalizeResourceThumbnail(result.screenshotDataUrl) };
  } catch (error) {
    const code = error instanceof Error ? error.message : "REPORT_CAPTURE_UNAVAILABLE";
    console.warn("Resource thumbnail normalization failed", error);
    return { dataUrl: null, error: code };
  }
}

function buildFallbackThumbnailPreviewUrl(input: {
  report: ReportItem;
  definition: ReportDefinition | null;
  resourceItem: ResourceItemRecord | null;
  hasUnpublishedChanges: boolean;
}) {
  const title = optionalText(input.definition?.title) || optionalText(input.report.name) || input.report.code;
  const description = optionalText(input.definition?.subTitle) || optionalText(input.definition?.dateRange) || "资源中心发布预览";
  const titleLines = splitSvgLines(title, 14, 2);
  const descriptionLines = splitSvgLines(description, 24, 2);
  const statusLabel = input.hasUnpublishedChanges
    ? "本次将生成新缩略图"
    : input.resourceItem
      ? `资源版本 v${input.resourceItem.sourceVersion}`
      : input.report.status === "已发布"
        ? "当前已发布版本"
        : "首次发布";
  const escapedCode = escapeSvgText(input.report.code);
  const escapedStatus = escapeSvgText(statusLabel);
  const titleSvg = titleLines
    .map((line, index) => `<text x="40" y="${116 + (index * 34)}" fill="#FFFFFF" font-size="${index === 0 ? 28 : 24}" font-weight="700">${line}</text>`)
    .join("");
  const descriptionSvg = descriptionLines
    .map((line, index) => `<text x="40" y="${196 + (index * 22)}" fill="rgba(255,255,255,0.84)" font-size="16">${line}</text>`)
    .join("");
  const svg = `<svg width="${releaseThumbnailWidth}" height="${releaseThumbnailHeight}" viewBox="0 0 ${releaseThumbnailWidth} ${releaseThumbnailHeight}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="preview-bg" x1="52" y1="36" x2="1108" y2="594" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1E4FD6"/>
      <stop offset="0.52" stop-color="#2167E8"/>
      <stop offset="1" stop-color="#0F172A"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" rx="40" fill="#0F172A"/>
  <rect x="24" y="24" width="1152" height="582" rx="32" fill="url(#preview-bg)"/>
  <circle cx="1048" cy="138" r="172" fill="rgba(255,255,255,0.08)"/>
  <circle cx="1156" cy="10" r="88" fill="rgba(255,255,255,0.10)"/>
  <rect x="40" y="44" width="176" height="34" rx="17" fill="rgba(255,255,255,0.14)"/>
  <text x="62" y="66" fill="#FFFFFF" font-size="16" font-weight="600">DataTalk Studio</text>
  ${titleSvg}
  ${descriptionSvg}
  <rect x="40" y="514" width="286" height="74" rx="22" fill="rgba(255,255,255,0.12)"/>
  <text x="64" y="544" fill="#DCEBFF" font-size="15">报表编码</text>
  <text x="64" y="574" fill="#FFFFFF" font-size="24" font-weight="700">${escapedCode}</text>
  <rect x="350" y="514" width="220" height="74" rx="22" fill="rgba(255,255,255,0.12)"/>
  <text x="374" y="544" fill="#DCEBFF" font-size="15">缩略图状态</text>
  <text x="374" y="574" fill="#FFFFFF" font-size="22" font-weight="700">${escapedStatus}</text>
  <rect x="840" y="118" width="292" height="372" rx="28" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.18)"/>
  <rect x="874" y="152" width="224" height="16" rx="8" fill="rgba(255,255,255,0.24)"/>
  <rect x="874" y="190" width="120" height="88" rx="18" fill="rgba(255,255,255,0.14)"/>
  <rect x="1008" y="190" width="90" height="88" rx="18" fill="rgba(255,255,255,0.12)"/>
  <rect x="874" y="302" width="224" height="116" rx="22" fill="rgba(255,255,255,0.10)"/>
  <path d="M908 382C942 332 980 360 1014 330C1045 302 1069 316 1096 274" stroke="#FFFFFF" stroke-opacity="0.88" stroke-width="10" stroke-linecap="round"/>
  <circle cx="908" cy="382" r="9" fill="#FFFFFF"/>
  <circle cx="1014" cy="330" r="9" fill="#FFFFFF"/>
  <circle cx="1096" cy="274" r="9" fill="#FFFFFF"/>
  <rect x="874" y="438" width="224" height="16" rx="8" fill="rgba(255,255,255,0.18)"/>
  <rect x="874" y="466" width="168" height="16" rx="8" fill="rgba(255,255,255,0.12)"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildResourcePublishForm(report: ReportItem, definition: ReportDefinition | null, resourceItem: ResourceItemRecord | null): ResourcePublishFormState {
  if (resourceItem) {
    return {
      title: resourceItem.title,
      summary: resourceItem.summary || "",
      thumbnailUrl: "",
      categoryId: resourceItem.categoryId == null ? "" : String(resourceItem.categoryId),
      assetType: resourceItem.assetType,
    };
  }

  return {
    title: optionalText(definition?.title) || optionalText(report.name) || "",
    summary: optionalText((definition as unknown as Record<string, unknown> | null)?.description) || optionalText(definition?.subTitle) || "",
    thumbnailUrl: "",
    categoryId: "",
    assetType: "report",
  };
}

function safeMarkdownHref(href: string) {
  const normalized = href.trim();
  if (normalized.startsWith("/") || normalized.startsWith("#")) return normalized;
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? normalized : null;
  } catch {
    return null;
  }
}

function renderFormattedMarkdownText(text: string, reportCode: string | null | undefined, keyPrefix: string): ReactNode[] {
  return text.split(/(!?\[[^\]\n]*\]\((?:<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\)|\*\*[^*\n]+\*\*)/g).filter(Boolean).map((segment, segmentIndex) => {
    if (segment.startsWith("**") && segment.endsWith("**")) {
      return <strong key={`${keyPrefix}-strong-${segmentIndex}`} className="font-semibold text-[#17243A]">{segment.slice(2, -2)}</strong>;
    }

    const link = segment.match(/^(!?)\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)$/);
    if (!link) return <span key={`${keyPrefix}-text-${segmentIndex}`}>{segment}</span>;

    const [, imageMarker, label, angleHref, plainHref] = link;
    const rawHref = angleHref || plainHref || "";
    const artifact = resolveReportAiSandboxArtifact(rawHref, reportCode);
    const href = artifact?.url || safeMarkdownHref(rawHref);
    if (!href) return <span key={`${keyPrefix}-invalid-link-${segmentIndex}`}>{label || rawHref}</span>;

    if (imageMarker && artifact?.isImage) {
      return <img key={`${keyPrefix}-image-${segmentIndex}`} src={href} alt={label || artifact.fileName} loading="lazy" decoding="async" className="my-2 block h-auto max-h-[420px] max-w-full rounded-md border border-[#DDE5F0] object-contain" />;
    }
    return <a key={`${keyPrefix}-link-${segmentIndex}`} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-[#2167E8] underline decoration-[#B8D1FA] underline-offset-2 hover:decoration-[#2167E8]">{label || artifact?.fileName || rawHref}</a>;
  });
}

function renderInlineMarkdown(text: string, reportCode?: string | null): ReactNode[] {
  return text.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`code-${index}`} className="break-words rounded bg-[#EEF3FA] px-1.5 py-0.5 font-mono text-[0.9em] text-[#344054]">{part.slice(1, -1)}</code>;
    }
    return renderFormattedMarkdownText(part, reportCode, `inline-${index}`);
  }).flat();
}

function parseStandaloneArtifactMarkdown(text: string, reportCode?: string | null) {
  const match = text.trim().match(/^!?\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)$/);
  if (!match) return null;
  const artifact = resolveReportAiSandboxArtifact(match[2] || match[3] || "", reportCode);
  return artifact ? { artifact, label: match[1].trim() } : null;
}

function AssistantArtifactPreview({ artifact, label }: { artifact: ReportAiArtifact; label: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const accessibleLabel = label || artifact.fileName;

  if (!artifact.isImage) {
    return <div className="flex min-w-0 items-center gap-2 text-[13px] leading-6">
      <FileText className="h-4 w-4 shrink-0 text-[#667085]" />
      <a href={reportAiArtifactDownloadUrl(artifact)} className="min-w-0 truncate font-medium text-[#2167E8] hover:underline" title={accessibleLabel}>{accessibleLabel}</a>
      <a href={reportAiArtifactDownloadUrl(artifact)} className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#667085] hover:bg-[#EDF3FF] hover:text-[#2167E8]" aria-label={`下载 ${artifact.fileName}`} title="下载"><Download className="h-3.5 w-3.5" /></a>
    </div>;
  }

  return <figure className="min-w-0">
    <a href={artifact.url} target="_blank" rel="noopener noreferrer" className="block min-h-24 overflow-hidden rounded-md border border-[#DDE5F0] bg-[#F7F9FC]" aria-label={`查看 ${accessibleLabel}`}>
      {imageFailed
        ? <span className="flex min-h-24 items-center justify-center gap-2 px-3 text-[12px] text-[#667085]"><ImageIcon className="h-4 w-4" />图片暂时无法加载</span>
        : <img src={artifact.url} alt={accessibleLabel} loading="lazy" decoding="async" onError={() => setImageFailed(true)} className="block h-auto max-h-[420px] w-full object-contain" />}
    </a>
    <figcaption className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[#667085]">
      <ImageIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={artifact.fileName}>{artifact.fileName}</span>
      <a href={artifact.url} target="_blank" rel="noopener noreferrer" className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#667085] hover:bg-[#EDF3FF] hover:text-[#2167E8]" aria-label={`新窗口查看 ${artifact.fileName}`} title="新窗口查看"><ExternalLink className="h-3.5 w-3.5" /></a>
      <a href={reportAiArtifactDownloadUrl(artifact)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#667085] hover:bg-[#EDF3FF] hover:text-[#2167E8]" aria-label={`下载 ${artifact.fileName}`} title="下载"><Download className="h-3.5 w-3.5" /></a>
    </figcaption>
  </figure>;
}

function renderAssistantMarkdown(content: string, reportCode?: string | null) {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    const text = paragraphBuffer.join(" ").trim();
    const standaloneArtifact = parseStandaloneArtifactMarkdown(text, reportCode);
    if (standaloneArtifact) {
      nodes.push(<AssistantArtifactPreview key={`artifact-${nodes.length}`} {...standaloneArtifact} />);
    } else if (text) {
      nodes.push(<p key={`p-${nodes.length}`} className="break-words whitespace-pre-wrap text-[13px] leading-6 text-[#344054]">{renderInlineMarkdown(text, reportCode)}</p>);
    }
    paragraphBuffer = [];
  };

  while (index < lines.length) {
    const line = lines[index] || "";

    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      flushParagraph();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith("```")) {
        codeLines.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push(
        <pre key={`codeblock-${nodes.length}`} className="overflow-hidden break-words whitespace-pre-wrap rounded-md border border-[#DDE5F0] bg-[#F7F9FC] px-3 py-2.5 text-[12px] leading-5 text-[#344054]">
          <code className="break-words">{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] || "")) {
        items.push((lines[index] || "").replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      nodes.push(
        <ul key={`ul-${nodes.length}`} className="space-y-2 break-words pl-5 text-[13px] leading-6 text-[#344054]">
          {items.map((item, itemIndex) => <li key={`li-${itemIndex}`} className="list-disc break-words">{renderInlineMarkdown(item, reportCode)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] || "")) {
        items.push((lines[index] || "").replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      nodes.push(
        <ol key={`ol-${nodes.length}`} className="space-y-2 break-words pl-5 text-[13px] leading-6 text-[#344054]">
          {items.map((item, itemIndex) => <li key={`oli-${itemIndex}`} className="list-decimal break-words">{renderInlineMarkdown(item, reportCode)}</li>)}
        </ol>,
      );
      continue;
    }

    paragraphBuffer.push(line);
    index += 1;
  }

  flushParagraph();
  return nodes.length ? nodes : [<p key="empty" className="break-words text-[13px] leading-6 text-[#344054]">{content}</p>];
}

function firstLine(text: string) {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

function latestLine(text: string) {
  const visible = text.trimEnd();
  const newline = visible.lastIndexOf("\n");
  return newline === -1 ? visible : visible.slice(newline + 1);
}

function ReasoningDisclosure({ text, streaming }: { text: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const summary = (streaming ? latestLine(text) : firstLine(text)).trim() || (streaming ? "正在思考..." : "思考过程");

  return (
    <div className="min-w-0 text-[13px] leading-6 text-[#667085]">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="group/reasoning relative flex h-6 w-full min-w-0 items-center overflow-hidden text-left outline-none"
        aria-expanded={expanded}
        aria-controls={detailsId}
      >
        <span className="relative mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center text-[#98A2B3]">
          <Sparkles className={`h-3.5 w-3.5 transition-opacity ${expanded ? "opacity-0" : "group-hover/reasoning:opacity-0"}`} />
          <ChevronRight className={`absolute h-3.5 w-3.5 transition-all ${expanded ? "opacity-0" : "opacity-0 group-hover/reasoning:opacity-100"}`} />
          <ChevronDown className={`absolute h-3.5 w-3.5 transition-opacity ${expanded ? "opacity-100" : "opacity-0"}`} />
        </span>
        <span className="shrink-0 text-[#526174]">思考</span>
        {!expanded ? <>
          <span className="mx-2 inline-block h-[2px] w-[2px] shrink-0 rounded-full bg-[#B9C8DC] align-middle" />
          <span className="min-w-0 flex-1 truncate text-[#667085]">{summary}</span>
        </> : null}
      </button>
      {expanded ? <div id={detailsId} className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words pl-[22px] pr-1 text-[12px] leading-5 text-[#667085]">{text}</div> : null}
    </div>
  );
}

function TimelineDisclosure({ icon, title, summary, detail, detailClassName = "" }: { icon: ReactNode; title: string; summary: string; detail?: string; detailClassName?: string }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const expandable = Boolean(detail?.trim());

  return (
    <div className="min-w-0 text-[13px] leading-6 text-[#98A2B3]">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setExpanded((current) => !current)}
        className={`group/disclosure relative flex min-h-6 w-full min-w-0 items-center overflow-hidden text-left outline-none ${expandable ? "cursor-pointer" : "cursor-default"}`}
        aria-expanded={expandable ? expanded : undefined}
        aria-controls={expandable ? detailsId : undefined}
      >
        <span className="relative mr-2 flex h-4 w-4 shrink-0 items-center justify-center text-[#667085]">
          <span className={`${expanded ? "opacity-0" : "group-hover/disclosure:opacity-0"} transition-opacity`}>{icon}</span>
          {expandable ? <>
            <ChevronRight className={`absolute h-3.5 w-3.5 transition-opacity ${expanded ? "opacity-0" : "opacity-0 group-hover/disclosure:opacity-100"}`} />
            <ChevronDown className={`absolute h-3.5 w-3.5 transition-opacity ${expanded ? "opacity-100" : "opacity-0"}`} />
          </> : null}
        </span>
        <span className="min-w-0 shrink-0 font-medium text-[#526174]">{title}</span>
        {summary ? <>
          <span className="mx-2 inline-block h-[2px] w-[2px] shrink-0 rounded-full bg-[#B9C8DC] align-middle" />
          <span className="min-w-0 flex-1 truncate text-[#667085]">{summary}</span>
        </> : null}
      </button>
      {expanded && detail ? <div id={detailsId} className={`ml-1 mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-[#DDE5F0] bg-[#F7F9FC] px-3 py-2.5 font-mono text-[12px] leading-5 text-[#344054] ${detailClassName}`}>{detail}</div> : null}
    </div>
  );
}

function reportAiAttachmentUrl(reportCode: string | null, conversationId: string | null, attachmentId: string) {
  if (!reportCode || !conversationId) return null;
  const query = new URLSearchParams({ conversationId });
  return `/api/reports/${encodeURIComponent(reportCode)}/ai/attachments/${encodeURIComponent(attachmentId)}?${query.toString()}`;
}

function parsePendingQuestionItems(argumentsValue: unknown): PendingQuestionItem[] {
  const args = parseToolArguments(argumentsValue);
  if (!args || !Array.isArray(args.questions)) return [];
  return args.questions.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.question !== "string") return [];
    const options = Array.isArray(item.options)
      ? item.options.flatMap((option) => {
        if (!option || typeof option !== "object" || Array.isArray(option)) return [];
        const candidate = option as Record<string, unknown>;
        if (typeof candidate.label !== "string") return [];
        return [{
          label: candidate.label,
          ...(typeof candidate.description === "string" ? { description: candidate.description } : {}),
        }];
      })
      : undefined;
    const multiSelect = item.multiSelect ?? item.multi_select;
    return [{
      id: item.id,
      question: item.question,
      ...(typeof item.header === "string" ? { header: item.header } : {}),
      ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
      ...(options?.length ? { options } : {}),
      ...(typeof multiSelect === "boolean" ? { multiSelect } : {}),
    }];
  });
}

function parsePendingQuestionAnswer(value: unknown): PendingQuestionAnswer | null {
  const text = typeof value === "string" ? value.trim() : stringifyToolPayload(value).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const answers = (parsed as { answers?: unknown }).answers;
    if (!Array.isArray(answers)) return null;
    const normalized = answers.map((answer) => {
      if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
      const item = answer as Record<string, unknown>;
      if (typeof item.id !== "string" || !Array.isArray(item.selected) || !item.selected.every((selected) => typeof selected === "string")) return null;
      return {
        id: item.id,
        selected: item.selected as string[],
        ...(typeof item.custom === "string" ? { custom: item.custom } : {}),
      };
    });
    if (normalized.some((answer) => answer === null)) return null;
    return { answers: normalized as PendingQuestionAnswer["answers"] };
  } catch {
    return null;
  }
}

function questionAnswerFromRuntimeData(data: RuntimeEventPayload["data"] | undefined) {
  const output = runtimeToolResultText(data) || stringifyToolPayload(data?.meta);
  return parsePendingQuestionAnswer(output);
}

function answeredQuestionCount(questions: PendingQuestionItem[], answer: PendingQuestionAnswer | undefined) {
  const answeredIds = new Set(
    (answer?.answers || [])
      .filter((item) => item.selected.length > 0 || Boolean(item.custom?.trim()))
      .map((item) => item.id),
  );
  return questions.filter((question) => answeredIds.has(question.id)).length;
}

function QuestionTimelineDisclosure({ node }: { node: Extract<AiTimelineNode, { kind: "question" }> }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const total = node.questions.length;
  const answered = answeredQuestionCount(node.questions, node.answer);
  const summary = node.status === "running"
    ? `${answered}/${total} answered`
    : node.outcome === "cancelled"
      ? "cancelled"
      : `${answered}/${total} answered`;

  return (
    <div className="min-w-0 text-[13px] leading-6 text-[#98A2B3]">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="group/question relative flex min-h-6 w-full min-w-0 items-center overflow-hidden text-left outline-none"
        aria-expanded={expanded}
        aria-controls={detailsId}
      >
        <span className="relative mr-2 flex h-4 w-4 shrink-0 items-center justify-center text-[#667085]">
          <ChevronRight className={`absolute h-3.5 w-3.5 transition-opacity ${expanded ? "opacity-0" : "opacity-100 group-hover/question:opacity-0"}`} />
          <ChevronDown className={`h-3.5 w-3.5 transition-opacity ${expanded ? "opacity-100" : "opacity-0"}`} />
        </span>
        <span className="min-w-0 shrink-0 font-medium text-[#526174]">Ask question</span>
        <span className="mx-2 inline-block h-[2px] w-[2px] shrink-0 rounded-full bg-[#B9C8DC] align-middle" />
        <span className={`min-w-0 flex-1 truncate ${node.status === "error" ? "text-[#F97066]" : "text-[#667085]"}`}>{summary}</span>
      </button>
      {expanded ? (
        <div id={detailsId} className="ml-1 mt-1 overflow-hidden rounded-xl border border-[#DDE5F0] bg-[#F7F9FC] text-[12px] leading-5 text-[#344054]">
          <div className="flex min-w-0 items-start gap-3 px-3 py-3">
            <span className="w-7 shrink-0 pt-0.5 font-mono text-[11px] font-semibold text-[#98A2B3]">IN</span>
            <pre className="max-h-64 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-[#344054]">{node.input || "{}"}</pre>
          </div>
          <div className="border-t border-[#DDE5F0]" />
          <div className="flex min-w-0 items-start gap-3 px-3 py-3">
            <span className="w-7 shrink-0 pt-0.5 font-mono text-[11px] font-semibold text-[#98A2B3]">OUT</span>
            <pre className="max-h-64 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-[#344054]">{node.output || (node.status === "running" ? "等待回答" : "")}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const dayOffset = Math.floor((startOfToday - startOfDate) / dayMs);

  if (dayOffset === 0) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  if (dayOffset === 1) return "昨天";
  if (dayOffset > 1 && dayOffset < 7) return `${dayOffset}天`;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  if (date.getFullYear() === now.getFullYear()) return `${month}/${String(date.getDate()).padStart(2, "0")}`;
  return `${String(date.getFullYear()).slice(-2)}/${month}`;
}

function formatConversationTimeTitle(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString("zh-CN", { hour12: false });
}

function PendingQuestionComposer({
  pending,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  pending: PendingQuestionRequest;
  submitting: boolean;
  error: string;
  onSubmit: (answer: PendingQuestionAnswer) => void;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState(() => pending.questions.map(() => ({ selected: [] as string[] })));
  const [questionIndex, setQuestionIndex] = useState(0);
  const [supplement, setSupplement] = useState("");
  const [validationError, setValidationError] = useState("");
  const questionCount = pending.questions.length;
  const totalSteps = questionCount + 1;
  const isSupplementStep = questionIndex === questionCount;
  const currentQuestion = pending.questions[questionIndex];
  const currentDraft = currentQuestion ? drafts[questionIndex] : undefined;

  function updateSelected(questionIndex: number, label: string, multiSelect: boolean) {
    setDrafts((current) => current.map((draft, index) => {
      if (index !== questionIndex) return draft;
      if (multiSelect) {
        return draft.selected.includes(label)
          ? { ...draft, selected: draft.selected.filter((item) => item !== label) }
          : { ...draft, selected: [...draft.selected, label] };
      }
      return { selected: [label] };
    }));
    setValidationError("");
  }

  function goNext() {
    if (isSupplementStep) {
      const firstFreeformQuestion = pending.questions.findIndex((question) => !question.options?.length);
      if (firstFreeformQuestion >= 0 && !supplement.trim()) {
        setValidationError(`请补充回答：${pending.questions[firstFreeformQuestion]?.question || "当前问题"}`);
        return;
      }

      const custom = supplement.trim();
      const supplementTargetIndex = firstFreeformQuestion >= 0
        ? firstFreeformQuestion
        : pending.questions.length - 1;
      onSubmit({
        // Runtime treats custom text as the alternative to a single-select choice;
        // multi-select answers may retain both selected labels and custom text.
        answers: pending.questions.map((question, index) => {
          const draft = drafts[index]!;
          const shouldAttachSupplement = Boolean(custom) && index === supplementTargetIndex;
          return {
            id: question.id,
            selected: shouldAttachSupplement && question.multiSelect !== true ? [] : draft.selected,
            ...(shouldAttachSupplement ? { custom } : {}),
          };
        }),
      });
      return;
    }

    if (currentQuestion?.options?.length && !currentDraft?.selected.length) {
      setValidationError("请先选择一个选项");
      return;
    }
    setValidationError("");
    setQuestionIndex((current) => current + 1);
  }

  function goPrevious() {
    setValidationError("");
    setQuestionIndex((current) => Math.max(0, current - 1));
  }

  return (
    <div className="rounded-xl border border-[#B8D1FA] bg-[#F5F9FF] p-3 shadow-[0_4px_14px_rgba(33,103,232,0.08)]">
      <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-[#2167E8]">
        <CircleHelp className="h-3.5 w-3.5" />
        需要你来确认
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] leading-5 text-[#526174]">AI 已暂停在当前步骤，等你回答后会继续往下执行。</div>
        <div className="shrink-0 text-[11px] font-medium text-[#2167E8]">{questionIndex + 1} / {totalSteps}</div>
      </div>
      {isSupplementStep ? (
        <div className="mt-3">
          <div className="text-[13px] font-medium leading-6 text-[#17243A]">还有需要补充的信息吗？</div>
          <textarea
            value={supplement}
            onChange={(event) => { setSupplement(event.target.value); setValidationError(""); }}
            disabled={submitting}
            rows={4}
            className="mt-2 min-h-[88px] w-full resize-y rounded-md border border-[#DDE5F0] bg-[#FAFCFF] px-3 py-2 text-[12px] leading-5 text-[#344054] outline-none placeholder:text-[#98A2B3] disabled:cursor-wait disabled:opacity-60"
            placeholder="可补充背景、限制或特殊口径（选填）"
            aria-label="补充信息"
          />
        </div>
      ) : currentQuestion ? (
        <div className="mt-3">
          <div className="text-[13px] font-medium leading-6 text-[#17243A]">{currentQuestion.question}</div>
          {currentQuestion.detail ? <div className="mt-1 space-y-2 text-[12px] leading-5 text-[#526174]">{renderAssistantMarkdown(currentQuestion.detail)}</div> : null}
          {currentQuestion.options?.length ? (
            <div className="mt-3 flex flex-col gap-2">
              {currentQuestion.options.map((option) => {
                const selected = currentDraft?.selected.includes(option.label) ?? false;
                return (
                  <button
                    key={option.label}
                    type="button"
                    disabled={submitting}
                    onClick={() => updateSelected(questionIndex, option.label, currentQuestion.multiSelect === true)}
                    title={option.description}
                    className={`flex min-h-9 w-full items-center justify-start rounded-md border px-3 py-1.5 text-left text-[12px] transition ${
                      selected
                        ? "border-[#2167E8] bg-[#EDF3FF] text-[#2167E8]"
                        : "border-[#DDE5F0] bg-white text-[#526174] hover:border-[#B8D1FA]"
                    } ${submitting ? "cursor-wait opacity-60" : ""}`}
                  >
                    <span className={`mr-2 h-2 w-2 shrink-0 rounded-full border ${selected ? "border-[#2167E8] bg-[#2167E8]" : "border-[#98A2B3] bg-white"}`} aria-hidden="true" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-md bg-[#F7F9FC] px-3 py-2 text-[12px] leading-5 text-[#667085]">这个问题没有预设选项，请在最后一步补充回答。</div>
          )}
        </div>
      ) : null}
      {validationError || error ? <div className="mt-2 text-[12px] leading-5 text-[#B42318]">{validationError || error}</div> : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={onCancel}
          className="rounded-md border border-[#DDE5F0] bg-white px-3 py-1.5 text-[12px] text-[#526174] hover:border-[#B8D1FA] disabled:cursor-wait disabled:opacity-60"
        >
          取消提问
        </button>
        {questionIndex > 0 ? <button
          type="button"
          disabled={submitting}
          onClick={goPrevious}
          className="rounded-md border border-[#DDE5F0] bg-white px-3 py-1.5 text-[12px] text-[#526174] hover:border-[#B8D1FA] disabled:cursor-wait disabled:opacity-60"
        >
          上一步
        </button> : null}
        <button
          type="button"
          disabled={submitting}
          onClick={goNext}
          className="rounded-md bg-[#2167E8] px-3 py-1.5 text-[12px] text-white hover:bg-[#1858CC] disabled:cursor-wait disabled:opacity-60"
        >
          {submitting ? "提交中..." : isSupplementStep ? "确认" : "下一步"}
        </button>
      </div>
    </div>
  );
}

function AiChatPanel({
  reportCode,
  timeline,
  streaming,
  pendingMessages,
  pendingQuestion,
  questionSubmitting,
  questionError,
  error,
  stopping,
  chatInput,
  chatImages,
  chatFiles,
  selectedElements,
  onInputChange,
  onPaste,
  onPickAttachments,
  onRemoveImage,
  onRemoveFile,
  onRemoveSelectedElement,
  onClearSelectedElements,
  onSubmit,
  onStop,
  onSubmitQuestion,
  onCancelQuestion,
  conversations,
  activeConversationId,
  conversationLoading,
  onSelectConversation,
  onNewConversation,
}: {
  reportCode: string | null;
  timeline: AiTimelineNode[];
  streaming: boolean;
  pendingMessages: PendingAiMessage[];
  pendingQuestion: PendingQuestionRequest | null;
  questionSubmitting: boolean;
  questionError: string;
  error: string;
  stopping: boolean;
  chatInput: string;
  chatImages: AiImageDraft[];
  chatFiles: AiFileDraft[];
  selectedElements: ReportSelectedElement[];
  onInputChange: (value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onPickAttachments: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: (id: string) => void;
  onRemoveFile: (id: string) => void;
  onRemoveSelectedElement: (selector: string) => void;
  onClearSelectedElements: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
  onSubmitQuestion: (answer: PendingQuestionAnswer) => void;
  onCancelQuestion: () => void;
  conversations: AiConversation[];
  activeConversationId: string | null;
  conversationLoading: boolean;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const conversationMenuRef = useRef<HTMLDivElement | null>(null);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);

  useEffect(() => {
    if (selectedElements.length) chatTextareaRef.current?.focus();
  }, [selectedElements]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    const anchor = scrollAnchorRef.current;
    if (!container || !anchor) return;
    anchor.scrollIntoView({ block: "end" });
  }, [timeline, streaming]);

  useEffect(() => {
    if (!conversationMenuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!conversationMenuRef.current?.contains(event.target as Node)) setConversationMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setConversationMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [conversationMenuOpen]);

  const activeNode = timeline.at(-1);
  const activeProgress = [...timeline].reverse().find((node) => node.kind === "progress" && node.step === undefined && node.status === "running");
  const activeStatus = !streaming
    ? null
    : pendingQuestion
      ? "等待你的回答"
    : activeNode?.kind === "tool" && activeNode.status === "running"
      ? "正在执行工具"
      : activeNode?.kind === "command" && activeNode.status === "running"
        ? `正在执行 /${activeNode.name}`
        : activeNode?.kind === "retry" && activeNode.status === "scheduled"
          ? "正在等待模型重试"
          : activeNode?.kind === "retry" && activeNode.status === "started"
            ? "正在重试模型请求"
            : activeNode?.kind === "compaction"
            ? "正在整理上下文"
              : activeNode?.kind === "assistant" && activeNode.streaming
                ? "正在生成回复"
                : activeProgress?.kind === "progress"
                  ? activeProgress.label
                  : "正在处理请求";
  const selectedConversationTitle = activeConversationId
    ? conversations.find((conversation) => conversation.id === activeConversationId)?.title || "当前会话"
    : "新会话";
  const attachmentCount = chatImages.length + chatFiles.length;
  const attachmentSummary = attachmentCount > 0 ? `${attachmentCount} 个附件` : "";

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-[#DDE5F0] bg-white">
      <div className="border-b border-[#E7EDF5] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#EDF3FF] text-[#2167E8]"><Sparkles className="h-4 w-4" /></span>
          <div className="min-w-0 shrink-0 text-[13px] font-bold text-[#17243A]">AI 对话</div>
          <div ref={conversationMenuRef} className="relative min-w-0 flex-1">
            <button type="button" onClick={() => setConversationMenuOpen((current) => !current)} disabled={streaming || conversationLoading} className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-[#DDE5F0] bg-white px-2.5 text-left text-[11px] text-[#526174] outline-none transition hover:border-[#B8D1FA] focus:border-[#8DB7F8] disabled:cursor-wait disabled:opacity-60" aria-label="历史对话" aria-haspopup="listbox" aria-expanded={conversationMenuOpen}>
              <span className="min-w-0 flex-1 truncate">{selectedConversationTitle}</span>
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#98A2B3] transition-transform ${conversationMenuOpen ? "rotate-180 text-[#2167E8]" : ""}`} />
            </button>
            {conversationMenuOpen ? <div role="listbox" aria-label="历史对话列表" className="absolute left-0 top-[calc(100%+6px)] z-40 max-h-64 w-full min-w-[220px] overflow-y-auto rounded-md border border-[#DDE5F0] bg-white p-1 shadow-[0_12px_28px_rgba(23,36,58,0.14)]">
              {conversations.map((conversation) => <button type="button" role="option" aria-selected={conversation.id === activeConversationId} key={conversation.id} onClick={() => { setConversationMenuOpen(false); onSelectConversation(conversation.id); }} className={`flex w-full items-center rounded px-2.5 py-2 text-left text-[11px] transition ${conversation.id === activeConversationId ? "bg-[#EDF3FF] font-semibold text-[#2167E8]" : "text-[#526174] hover:bg-[#F7F9FC]"}`}>
                <time dateTime={conversation.updatedAt} title={formatConversationTimeTitle(conversation.updatedAt)} className="w-10 shrink-0 whitespace-nowrap text-[10px] font-normal tabular-nums text-[#98A2B3]">{formatConversationTime(conversation.updatedAt)}</time>
                <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
                {conversation.id === activeConversationId ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
              </button>)}
            </div> : null}
          </div>
          <button type="button" onClick={onNewConversation} disabled={streaming || conversationLoading} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#526174] hover:bg-[#EDF3FF] hover:text-[#2167E8] disabled:cursor-not-allowed disabled:opacity-50" aria-label="新建 AI 对话" title="新建 AI 对话"><Plus className="h-4 w-4" /></button>
        </div>
      </div>
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#F8FAFD] px-4 py-4">
        <div className="min-w-0 space-y-4">
          {timeline.map((node) => node.kind === "user" ? (
            <div key={node.id} className="flex min-w-0 justify-end">
              <div className="min-w-0 max-w-[88%] space-y-1">
                <div className="flex min-w-0 items-center justify-end gap-1.5 pr-1 text-[11px] font-medium text-[#667085]">
                  {node.selectedElements?.length ? <span className="inline-flex min-w-0 max-w-[180px] items-center gap-1 text-[#2167E8]" title={node.selectedElements.map((element) => element.selector).join("\n")}><ScanSearch className="h-3 w-3 shrink-0" /><span className="min-w-0 truncate">{node.selectedElements[0].text || `<${node.selectedElements[0].tag}>`}</span>{node.selectedElements.length > 1 ? <span className="shrink-0">+{node.selectedElements.length - 1}</span> : null}</span> : null}
                  <span>你</span>
                </div>
                <div className="min-w-0 space-y-2 break-words rounded-2xl rounded-br-md bg-[#2167E8] px-3.5 py-2.5 text-[13px] leading-6 text-white shadow-[0_2px_5px_rgba(33,103,232,0.16)]">
                  {node.images?.length ? <div className="flex flex-wrap justify-end gap-1.5">{node.images.map((src, imageIndex) => <img key={`${node.id}-image-${imageIndex}`} src={src} alt="用户上传附件" className="max-h-40 max-w-[220px] rounded-lg border border-white/30 object-contain" />)}</div> : null}
                  {node.content ? <div className="break-words whitespace-pre-wrap">{node.content}</div> : null}
                </div>
              </div>
            </div>
          ) : node.kind === "assistant" ? (
            <div key={node.id} className="flex min-w-0 justify-start">
              <div className="min-w-0 max-w-[92%] space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#667085]"><Sparkles className="h-3.5 w-3.5 text-[#98A2B3]" />AI</div>
              <div className="min-w-0 space-y-2 break-words rounded-2xl rounded-bl-md border border-[#DDE5F0] bg-white px-3.5 py-2.5 shadow-[0_1px_3px_rgba(23,36,58,0.04)]">
                {node.reasoning ? <ReasoningDisclosure text={node.reasoning} streaming={Boolean(node.streaming)} /> : null}
                {node.content ? renderAssistantMarkdown(node.content, reportCode) : !node.reasoning && node.streaming ? <span className="text-[13px] leading-6 text-[#667085]">...</span> : null}
              </div>
              {node.streaming ? <div className="pl-1 text-[12px] leading-5 text-[#667085]">正在生成...</div> : null}
              {node.interrupted ? <div className="pl-1 text-[12px] leading-5 text-[#F79009]">已停止</div> : null}
              </div>
            </div>
          ) : node.kind === "question" ? (
            <div key={node.id}>
              <QuestionTimelineDisclosure node={node} />
            </div>
          ) : node.kind === "tool" ? (
            <div key={node.id}>
              <TimelineDisclosure
                icon={toolOperationIcon(node.name, node.status)}
                title={node.name}
                summary={node.summary || (node.status === "running" ? "执行中" : node.status === "done" ? "已完成" : "执行失败")}
                detail={node.detail || node.summary}
              />
              {node.images?.length ? <div className="ml-6 mt-2 min-w-0 space-y-2">
                {node.images.map((image) => {
                  const src = reportAiAttachmentUrl(reportCode, activeConversationId, image.attachmentId);
                  if (!src) return null;
                  return <a key={image.attachmentId} href={src} target="_blank" rel="noreferrer" className="block max-w-full overflow-hidden rounded-lg border border-[#DDE5F0] bg-white shadow-[0_1px_3px_rgba(23,36,58,0.05)]" aria-label={image.name || "查看报表预览截图"} title="查看截图">
                    <img src={src} alt={image.name || "报表预览截图"} width={image.width} height={image.height} loading="lazy" decoding="async" className="block h-auto max-h-[420px] max-w-full object-contain" />
                  </a>;
                })}
              </div> : null}
            </div>
          ) : node.kind === "command" ? (
            <div key={node.id}>
              <TimelineDisclosure
                icon={commandOperationIcon(node.status)}
                title={`/${node.name}`}
                summary={node.summary || (node.status === "running" ? "执行中" : node.status === "success" ? "已完成" : "执行失败")}
                detail={node.detail || undefined}
              />
            </div>
          ) : node.kind === "retry" ? (
            <div key={node.id} className="break-words text-[13px] leading-6 text-[#98A2B3]">
              <TimelineDisclosure
                icon={node.status === "scheduled" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#2167E8]" /> : node.status === "started" ? <RefreshCw className="h-3.5 w-3.5 text-[#2167E8]" /> : <CircleHelp className="h-3.5 w-3.5 text-[#F79009]" />}
                title="模型重试"
                summary={node.summary || (node.status === "started" ? "已重试模型请求" : node.status === "cancelled" ? "模型请求重试已取消" : "等待重试模型请求")}
                detail={[
                  node.delayMs !== undefined ? `重试延迟：${Math.round(node.delayMs)}ms` : "",
                  node.failure ? `失败原因：${node.failure}` : "",
                ].filter(Boolean).join("\n") || undefined}
              />
            </div>
          ) : node.kind === "compaction" ? (
            <div key={node.id} className="break-words text-[13px] leading-6 text-[#98A2B3]">
              <div className="font-medium text-[#526174]">上下文已压缩</div>
              {(node.shadowedItemCount !== undefined || node.shadowedTokenCount !== undefined) ? (
                <div className="mt-1 text-[12px] leading-5 text-[#667085]">
                  {node.shadowedItemCount !== undefined ? `替换 ${node.shadowedItemCount} 条记录` : ""}
                  {node.shadowedItemCount !== undefined && node.shadowedTokenCount !== undefined ? " · " : ""}
                  {node.shadowedTokenCount !== undefined ? `约 ${node.shadowedTokenCount} tokens` : ""}
                </div>
              ) : null}
              {node.summary ? <div className="mt-1 break-words whitespace-pre-wrap text-[12px] leading-5 text-[#667085]">{node.summary}</div> : null}
            </div>
          ) : node.kind === "progress" ? null : (
            <div key={node.id} className={`break-words text-[12px] leading-5 ${
              node.tone === "error"
                ? "text-[#F97066]"
                : node.tone === "warning"
                  ? "text-[#F79009]"
                  : "text-[#667085]"
            }`}>
              {node.content}
            </div>
          ))}
          {activeStatus ? (
            <div className="flex items-center gap-2 border-t border-[#E7EDF5] pt-3 text-[12px] text-[#71819B]">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#2167E8]" />
              <span>{activeStatus}</span>
              <span className="inline-flex gap-0.5" aria-label="处理中">
                <span className="h-1 w-1 animate-pulse rounded-full bg-[#8DB7F8]" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-[#8DB7F8] [animation-delay:150ms]" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-[#8DB7F8] [animation-delay:300ms]" />
              </span>
            </div>
          ) : null}
          <div ref={scrollAnchorRef} />
        </div>
      </div>
      <div className="relative z-10 min-w-0 shrink-0 overflow-hidden border-t border-[#E7EDF5] bg-white px-3 pb-4 pt-3">
        {pendingQuestion ? (
          <PendingQuestionComposer
            key={pendingQuestion.rpcId}
            pending={pendingQuestion}
            submitting={questionSubmitting}
            error={questionError}
            onSubmit={onSubmitQuestion}
            onCancel={onCancelQuestion}
          />
        ) : (
          <>
            {error ? <div role="alert" className="mb-2 break-words rounded-md border border-[#F5D4CC] bg-[#FFF8F6] px-2.5 py-2 text-[11px] leading-5 text-[#B42318]">{error}</div> : null}
            {pendingMessages.some((pendingMessage) => pendingMessage.queued) ? <div className="mb-2 space-y-1.5" aria-label="待发送消息">
              {pendingMessages.filter((pendingMessage) => pendingMessage.queued).map((pendingMessage) => {
                const visible = readSelectedElementContext(pendingMessage.message);
                return <div key={pendingMessage.id} className="flex min-w-0 items-start gap-2 rounded-md border border-[#DDE5F0] bg-[#F7F9FC] px-2.5 py-2 text-[11px] text-[#526174]">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[#2167E8]"><LoaderCircle className="h-3 w-3 animate-spin" /></span>
                  <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{[visible.message || "附件消息", visible.selected.length ? `目标：${visible.selected.slice(0, 2).map((element) => element.text || element.selector).join("、")}${visible.selected.length > 2 ? ` 等 ${visible.selected.length} 个元素` : ""}` : "", pendingMessage.files?.length ? `附件：${pendingMessage.files.join("、")}` : ""].filter(Boolean).join("\n")}</span>
                  <span className="shrink-0 text-[10px] text-[#98A2B3]">待发送</span>
                </div>})}
            </div> : null}
            <div className="mb-2 flex items-center gap-1.5 text-[10px] text-[#98A2B3]"><MessageCircle className="h-3.5 w-3.5" />询问或修改这份报表</div>
            <form onSubmit={onSubmit} className="min-w-0 rounded-md border border-[#DDE5F0] bg-[#FAFCFF] p-2 focus-within:border-[#8DB7F8]">
              <input type="file" accept={aiAttachmentAccept} multiple onChange={onPickAttachments} className="hidden" id="report-ai-attachment-input" />
              {selectedElements.length ? <div className="mb-2 min-w-0 border-b border-[#DDE5F0] pb-2 text-[11px] text-[#2167E8]">
                <div className="mb-1 flex items-center gap-1.5"><ScanSearch className="h-3.5 w-3.5 shrink-0" /><span className="flex-1 font-semibold">选中 {selectedElements.length}</span><button type="button" onClick={onClearSelectedElements} className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-[#EDF3FF]" aria-label="清除所有选中元素" title="清除所有选中元素"><X className="h-3.5 w-3.5" /></button></div>
                <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                  {selectedElements.map((element) => <span key={element.selector} className="inline-flex h-7 min-w-0 max-w-full items-center gap-1 rounded border border-[#C9DAF5] bg-white px-1.5 text-[#344054]" title={element.selector}><span className="min-w-0 max-w-[190px] truncate">{element.text || `<${element.tag}>`}</span><button type="button" onClick={() => onRemoveSelectedElement(element.selector)} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#667085] hover:bg-[#EDF3FF] hover:text-[#2167E8]" aria-label={`移除选中元素 ${element.text || element.selector}`} title="移除选中元素"><X className="h-3 w-3" /></button></span>)}
                </div>
              </div> : null}
              {chatImages.length || chatFiles.length ? <div className="mb-2 flex max-w-full flex-wrap gap-2 overflow-hidden pb-1">
                {chatImages.map((image) => <div key={image.id} className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-[#DDE5F0] bg-white"><img src={image.previewUrl} alt={image.name || "待发送附件"} className="h-full w-full object-cover" /><button type="button" onClick={() => onRemoveImage(image.id)} className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#17243A]/75 text-white opacity-0 transition group-hover:opacity-100" aria-label={`移除附件${image.name ? ` ${image.name}` : ""}`} title="移除附件"><X className="h-3 w-3" /></button></div>)}
                {chatFiles.map((attachment) => <div key={attachment.id} className="group flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-[#DDE5F0] bg-white px-2 py-1.5 text-[#526174]" title={`${attachment.file.name}（${formatAiFileSize(attachment.file.size)}）`}><FileText className="h-3.5 w-3.5 shrink-0 text-[#2167E8]" /><span className="min-w-0 max-w-[150px] truncate text-[10px]">{attachment.file.name}</span><span className="shrink-0 text-[10px] text-[#98A2B3]">{formatAiFileSize(attachment.file.size)}</span><button type="button" onClick={() => onRemoveFile(attachment.id)} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#98A2B3] hover:bg-[#F3F6FA] hover:text-[#B42318]" aria-label={`移除附件 ${attachment.file.name}`} title="移除附件"><X className="h-3 w-3" /></button></div>)}
              </div> : null}
              <textarea ref={chatTextareaRef} value={chatInput} onChange={(event) => onInputChange(event.target.value)} onPaste={onPaste} onKeyDown={(event) => { if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return; event.preventDefault(); event.currentTarget.form?.requestSubmit(); }} rows={2} className="min-h-[42px] w-full resize-none border-0 bg-transparent px-1 text-xs leading-5 text-[#344054] outline-none placeholder:text-[#98A2B3]" placeholder="描述要生成或修改的报表内容" aria-label="询问或修改报表" />
              <div className="mt-1 flex items-center justify-between gap-2">
                <div className="flex shrink-0 items-center gap-0.5">
                  <label htmlFor="report-ai-attachment-input" className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[#526174] hover:bg-[#EDF3FF] hover:text-[#2167E8]" aria-label="添加附件" title="添加附件"><Paperclip className="h-4 w-4" /></label>
                </div>
                {attachmentSummary ? <span className="min-w-0 flex-1 truncate text-[10px] text-[#98A2B3]">{attachmentSummary}待发送</span> : <span className="flex-1" />}
                <div className="flex shrink-0 items-center gap-1">
                  {streaming ? <button type="button" onClick={onStop} disabled={stopping} className="flex h-8 w-8 items-center justify-center rounded-md border border-[#F5D4CC] bg-[#FFF8F6] text-[#B42318] hover:bg-[#FDECE8] disabled:cursor-wait disabled:opacity-50" aria-label="停止 AI 任务" title="停止 AI 任务"><Square className="h-3.5 w-3.5 fill-current" /></button> : <button type="submit" disabled={!chatInput.trim() && chatImages.length === 0 && chatFiles.length === 0} className="flex h-8 w-8 items-center justify-center rounded-md bg-[#2167E8] text-white hover:bg-[#1858CC] disabled:cursor-not-allowed disabled:opacity-50" aria-label="发送报表请求" title="发送"><Send className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
            </form>
          </>
        )}
      </div>
    </aside>
  );
}

function makeDefinition(report: ReportItem, definition: ReportDefinition | null): ReportDefinition {
  if (!definition) return { ...defaultDefinition, title: report.name };

  return {
    ...defaultDefinition,
    ...definition,
    title: definition.title || report.name,
    filters: Array.isArray(definition.filters) ? definition.filters : [],
    widgets: Array.isArray(definition.widgets) ? definition.widgets : [],
  };
}

function WidgetIcon({ type }: { type: ReportWidgetType }) {
  if (type === "line") return <LineChart className="h-4 w-4" />;
  if (type === "bar") return <BarChart3 className="h-4 w-4" />;
  if (type === "table") return <Table2 className="h-4 w-4" />;
  return <LayoutDashboard className="h-4 w-4" />;
}

function WidgetPreview({ widget }: { widget: ReportWidget }) {
  return <div className="flex min-h-[180px] flex-col justify-between bg-white p-4"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-[#526174]">{widget.title}</span><MoreHorizontal className="h-4 w-4 text-[#98A2B3]" /></div><div className="flex items-end justify-between gap-3"><strong className="text-xl text-[#17243A]">{widget.metric || "待接入数据"}</strong><span className="text-[11px] text-[#98A2B3]">server.js 运行时数据</span></div></div>;
}

function textOfBlocks(content: RuntimeContentBlock[] | undefined) {
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (block.type !== "text") return "";
    if (typeof block.text === "string") return block.text;
    if (typeof block.content === "string") return block.content;
    return "";
  }).join("").trim();
}

function textOfToolResultBlocks(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return "";
    const candidate = block as Record<string, unknown>;
    if (candidate.type === "text" && typeof candidate.text === "string") return candidate.text;
    if (Array.isArray(candidate.content)) return textOfToolResultBlocks(candidate.content);
    return "";
  }).join("").trim();
}

function runtimeToolResultText(data: RuntimeEventPayload["data"] | undefined) {
  return textOfToolResultBlocks(data?.content)
    || textOfToolResultBlocks(data?.message?.content)
    || "";
}

function runtimeImageAttachmentFromBlock(value: unknown): RuntimeImageAttachment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const block = value as Record<string, unknown>;
  if (block.type !== "image" || !block.attachment || typeof block.attachment !== "object" || Array.isArray(block.attachment)) return null;

  const attachment = block.attachment as Record<string, unknown>;
  const attachmentId = attachment.attachmentId;
  const mediaType = attachment.mediaType;
  if (typeof attachmentId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(attachmentId)) return null;
  if (typeof mediaType !== "string" || !aiImageMediaTypes.has(mediaType as AiImageMediaType)) return null;

  const positiveInteger = (candidate: unknown) => typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0 ? candidate : undefined;
  const name = typeof attachment.name === "string" && attachment.name.trim() ? attachment.name.trim().slice(0, 160) : undefined;
  return {
    attachmentId,
    mediaType: mediaType as AiImageMediaType,
    bytes: positiveInteger(attachment.bytes),
    width: positiveInteger(attachment.width),
    height: positiveInteger(attachment.height),
    ...(name ? { name } : {}),
  };
}

function runtimeImageAttachmentsFromBlocks(value: unknown): RuntimeImageAttachment[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => [
      ...runtimeImageAttachmentsFromBlocks(item),
    ]);
  }
  if (!value || typeof value !== "object") return [];
  const block = value as Record<string, unknown>;
  const attachment = runtimeImageAttachmentFromBlock(block);
  return [
    ...(attachment ? [attachment] : []),
    ...(Array.isArray(block.content) ? runtimeImageAttachmentsFromBlocks(block.content) : []),
  ];
}

function runtimeToolResultImages(data: RuntimeEventPayload["data"] | undefined) {
  const images = [
    ...runtimeImageAttachmentsFromBlocks(data?.content),
    ...runtimeImageAttachmentsFromBlocks(data?.message?.content),
  ];
  return [...new Map(images.map((image) => [image.attachmentId, image])).values()];
}

function runtimeToolResultIsError(data: RuntimeEventPayload["data"] | undefined) {
  if (data?.isError === true) return true;
  return Array.isArray(data?.message?.content) && data.message.content.some((block) => block.isError === true || (
    block.type === "tool-result" && Array.isArray(block.content) && block.content.some((nested) => nested.isError === true)
  ));
}

function reasoningOfBlocks(content: RuntimeContentBlock[] | undefined) {
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (block.type !== "reasoning") return "";
    if (typeof block.text === "string") return block.text;
    if (typeof block.content === "string") return block.content;
    return "";
  }).join("");
}

function stringifyToolPayload(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function isFileReadWriteTool(name: string) {
  const normalized = name.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return normalized === "read" || normalized.startsWith("read") || normalized === "write" || normalized.startsWith("write");
}

function toWorkingRelativePath(value: string) {
  const normalized = value.replaceAll("\\", "/");
  const withoutTrailingSlash = normalized.replace(/\/+$/, "");
  const workingPrefix = "/working/";
  const workingIndex = withoutTrailingSlash.lastIndexOf(workingPrefix);
  if (workingIndex >= 0) return withoutTrailingSlash.slice(workingIndex + workingPrefix.length) || ".";
  if (withoutTrailingSlash === "working") return ".";
  if (withoutTrailingSlash.startsWith("working/")) return withoutTrailingSlash.slice("working/".length) || ".";
  return value;
}

function displayWorkingPathReferences(value: string) {
  const absolutePathPattern = /(?:[A-Za-z]:[\\/]|\/)(?:[^\\/\s"'<>]+[\\/])*working(?:[\\/][^\\/\s"'<>]+)*/g;
  const relativePathPattern = /(^|[\s"'`(=])working[\\/][^\\/\s"'<>]+/g;
  const absolutePathsDisplayed = value.replace(absolutePathPattern, (match) => toWorkingRelativePath(match));
  return absolutePathsDisplayed.replace(relativePathPattern, (match, prefix: string) => `${prefix}${toWorkingRelativePath(match.slice(prefix.length))}`);
}

function normalizeFileToolArgumentPaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeFileToolArgumentPaths(item));
  if (!value || typeof value !== "object") return value;

  const pathKeys = new Set(["path", "file", "file_path", "filePath", "filename", "fileName"]);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    pathKeys.has(key) && typeof item === "string"
      ? toWorkingRelativePath(item)
      : normalizeFileToolArgumentPaths(item),
  ]));
}

function formatFileToolArguments(name: string, value: unknown) {
  if (!isFileReadWriteTool(name)) return stringifyToolPayload(value);
  if (typeof value !== "string") return stringifyToolPayload(normalizeFileToolArgumentPaths(value));

  const parsed = parseToolArguments(value);
  if (parsed) return stringifyToolPayload(normalizeFileToolArgumentPaths(parsed));
  return displayWorkingPathReferences(value);
}

function formatJsonPayload(value: unknown) {
  const raw = typeof value === "string" ? value : stringifyToolPayload(value);
  if (!raw.trim()) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function parseToolArguments(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function firstStringValue(value: unknown) {
  if (typeof value !== "string") return "";
  return value.split(/\r?\n/, 1)[0].trim();
}

function toolOperationIcon(name: string, status: "running" | "done" | "error") {
  const normalized = name.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const Icon = normalized === "skill"
    ? Sparkles
    : normalized === "glob"
      ? FolderSearch
      : normalized === "read" || normalized.startsWith("read") || ["cat", "open", "view"].includes(normalized)
        ? FileText
        : normalized === "grep" || normalized === "rg" || normalized === "ripgrep" || normalized.includes("search") || normalized.includes("find")
          ? Search
          : normalized.includes("edit") || normalized.includes("write") || normalized.includes("patch") || normalized.includes("modify") || normalized.includes("replace") || normalized.includes("delete")
            ? Pencil
            : CircleHelp;
  const color = status === "running" ? "text-[#2167E8] animate-pulse" : status === "error" ? "text-[#F97066]" : "text-[#32D583]";
  return <Icon className={`h-3.5 w-3.5 ${color}`} />;
}

function commandOperationIcon(status: "running" | "success" | "error") {
  const color = status === "running" ? "text-[#2167E8] animate-pulse" : status === "error" ? "text-[#F97066]" : "text-[#32D583]";
  return <Terminal className={`h-3.5 w-3.5 ${color}`} />;
}

function summarizeToolCall(name: string, argumentsValue: unknown) {
  const raw = typeof argumentsValue === "string" ? argumentsValue : "";
  const args = parseToolArguments(raw);
  if (!args) return displayWorkingPathReferences(firstStringValue(raw));

  const preferredKeys = name === "read"
    ? ["path", "file_path", "url", "offset"]
    : name === "glob" || name === "grep"
      ? ["pattern", "query", "path"]
      : name === "skill"
        ? ["name", "description"]
        : ["description", "command", "cmd", "path", "file_path", "query", "pattern", "name"];
  for (const key of preferredKeys) {
    const summary = firstStringValue(args[key]);
    if (summary) return displayWorkingPathReferences(summary);
  }
  for (const value of Object.values(args)) {
    const summary = firstStringValue(value);
    if (summary) return displayWorkingPathReferences(summary);
  }
  return displayWorkingPathReferences(firstStringValue(raw));
}

function summarizeToolPayload(value: unknown) {
  const text = stringifyToolPayload(value).replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 140)}...` : text;
}

function combineToolDetail(input: string | undefined, output: string | undefined) {
  const sections = [
    input?.trim() ? `入参\n${input.trim()}` : "",
    output?.trim() ? `结果\n${output.trim()}` : "",
  ].filter(Boolean);
  return sections.join("\n\n");
}

function appendToolResult(detail: string | undefined, output: string | undefined) {
  if (!output?.trim()) return detail || "";
  if (!detail?.trim()) return combineToolDetail(undefined, output);
  return `${detail.trim()}\n\n结果\n${output.trim()}`;
}

function summarizeTurnEnd(payload: RuntimeEventPayload["data"]) {
  const reason = payload?.reason;
  if (!reason?.kind) return "";
  if (reason.kind === "max-tokens") return "本轮回复触达输出上限，可继续追问。";
  if (reason.kind === "blocked") return "本轮暂时阻塞。";
  if (reason.kind === "aborted") return "本轮已停止。";
  if (reason.kind === "interrupted") return "本轮中断。";
  if (reason.kind === "error") {
    const message = toUserFacingAiError(reason.error?.message, "本轮执行失败。");
    return `本轮执行失败：${message}${reason.error?.code ? `（${reason.error.code}）` : ""}`;
  }
  return "";
}

function toUserFacingAiError(value: unknown, fallback = "本轮执行失败。") {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) return fallback;
  if (message === "AGENT_RUNTIME_TIMEOUT") return "AI 处理超时，请稍后重试；如果持续超时，请检查 Agent Runtime。";
  if (message === "AGENT_RUNTIME_UNAUTHORIZED") return "Agent Runtime 鉴权已失效，请重启 Agent Runtime 后重试。";
  if (message === "DSH_EVENT_STREAM_FAILED" || message === "DSH_STREAM_FAILED") return "AI 实时连接中断，请稍后重试。";
  if (message.includes("UNDECLARED_WORKSPACE_CHANGES")) return "本次 AI 修改未提交，请检查报表工作区后重试。";
  if (message.toLowerCase().includes("does not support image input") || message.toLowerCase().includes("image input is not supported")) {
    return "当前模型不支持图片输入，请在 Agent Runtime 模型配置中选择支持视觉输入的模型。";
  }
  return message;
}

function blocksOrStringToText(value: RuntimeContentBlock[] | string | undefined) {
  if (typeof value === "string") return value.trim();
  return textOfBlocks(value);
}

const aiImageMediaTypeByExtension: Record<string, AiImageMediaType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function getAiImageMediaType(file: File): AiImageMediaType | null {
  const mediaType = file.type as AiImageMediaType;
  if (aiImageMediaTypes.has(mediaType)) return mediaType;
  const name = file.name.trim();
  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
  return aiImageExtensions.has(extension) ? aiImageMediaTypeByExtension[extension] || null : null;
}

function isAiImageFile(file: File) {
  return getAiImageMediaType(file) !== null;
}

function readAiImageFile(file: File): Promise<AiImageDraft> {
  return new Promise((resolve, reject) => {
    const mediaType = getAiImageMediaType(file);
    if (!mediaType) {
      reject(new Error("仅支持 PNG、JPEG、WebP 或 GIF 图片"));
      return;
    }
    if (file.size > maxAiImageBytes) {
      reject(new Error("单张图片不能超过 10 MB"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => {
      const previewUrl = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = previewUrl.indexOf(",");
      const data = commaIndex >= 0 ? previewUrl.slice(commaIndex + 1) : "";
      if (!data) {
        reject(new Error("图片内容为空"));
        return;
      }
      resolve({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name || undefined,
        mediaType,
        data,
        previewUrl,
      });
    };
    reader.readAsDataURL(file);
  });
}

function formatAiFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function readAiFileDraft(file: File): AiFileDraft {
  const name = file.name.trim();
  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
  if (!name || !aiFileExtensions.has(extension)) {
    throw new Error("附件格式不受支持，请上传 TXT、MD、JSON、CSV、PDF、DOCX、XLSX 或 HTML 文件");
  }
  if (file.size > maxAiFileBytes) throw new Error("单个附件不能超过 20 MB");
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
  };
}

function foldTimeline(events: RuntimeEventPayload[], sentImagePreviews: SentAiImagePreview[] = [], pendingMessages: PendingAiMessage[] = []) {
  const timeline: AiTimelineNode[] = [];
  const runningTools = new Map<string, number>();
  const runningCommands = new Map<string, number>();
  const scheduledRetries = new Map<string, number>();
  const runningTurns = new Map<number, number>();
  const runningSteps = new Map<string, number>();
  const matchedPendingMessageIds = new Set<string>();
  let partialAssistantIndex: number | null = null;
  let activeStepIndex: number | null = null;
  let sentImagePreviewIndex = 0;

  const stepKey = (turn: number | undefined, step: number | undefined) => `${turn ?? "?"}:${step ?? "?"}`;

  const finishProgress = (index: number, time?: number) => {
    const current = timeline[index];
    if (current?.kind !== "progress") return;
    timeline[index] = {
      ...current,
      label: current.doneLabel || `${current.label}完成`,
      status: "done",
      time,
    };
  };

  const updateActiveStep = (label: string, detail?: string) => {
    if (activeStepIndex === null) return;
    const current = timeline[activeStepIndex];
    if (current?.kind !== "progress" || current.status !== "running") return;
    timeline[activeStepIndex] = { ...current, label, detail };
  };

  const ensurePartialAssistant = (time?: number) => {
    if (partialAssistantIndex !== null) return partialAssistantIndex;
    const index = timeline.push({ id: `assistant-partial-${time || Date.now()}-${timeline.length}`, kind: "assistant", content: "", time, streaming: true }) - 1;
    partialAssistantIndex = index;
    return index;
  };

  const finalizePartialAssistant = (content: string, reasoning: string, time?: number, interrupted?: boolean) => {
    if (partialAssistantIndex !== null) {
      const previous = timeline[partialAssistantIndex];
      timeline[partialAssistantIndex] = {
        id: previous!.id,
        kind: "assistant",
        content,
        ...(reasoning || (previous?.kind === "assistant" && previous.reasoning) ? { reasoning: reasoning || (previous?.kind === "assistant" ? previous.reasoning : "") } : {}),
        time,
        interrupted,
      };
      partialAssistantIndex = null;
      return;
    }
    timeline.push({ id: `assistant-final-${time || Date.now()}-${timeline.length}`, kind: "assistant", content, ...(reasoning ? { reasoning } : {}), time, interrupted });
  };

  for (const [runtimeEventIndex, runtimeEvent] of events.entries()) {
    const event = runtimeEvent;
    const eventType = event.type || "";
    const eventTime = event.time;
    const eventData = event.data;
    const eventKey = `${event.seq ?? "event"}-${runtimeEventIndex}`;

    if (eventType === "turn/start") {
      const turn = eventData?.turn;
      const index = timeline.push({
        id: `progress-turn-${eventKey}`,
        kind: "progress",
        turn,
        label: "开始处理请求",
        doneLabel: "请求处理已完成",
        status: "running",
        time: eventTime,
      }) - 1;
      if (typeof turn === "number") runningTurns.set(turn, index);
      continue;
    }

    if (eventType === "step/start") {
      const turn = eventData?.turn;
      const step = eventData?.step;
      const stepLabel = typeof step === "number" ? `正在分析第 ${step} 步` : "正在分析请求";
      const index = timeline.push({
        id: `progress-step-${turn ?? "unknown"}-${step ?? "unknown"}-${eventKey}`,
        kind: "progress",
        turn,
        step,
        label: stepLabel,
        doneLabel: typeof step === "number" ? `第 ${step} 步处理完成` : "当前步骤已完成",
        status: "running",
        time: eventTime,
      }) - 1;
      runningSteps.set(stepKey(turn, step), index);
      activeStepIndex = index;
      continue;
    }

    if (eventType === "user/message" && event.surfaceOp === "append") {
      const runtimeContent = textOfBlocks(eventData?.content) || textOfBlocks(eventData?.message?.content);
      const content = runtimeContent.trim();
      const visible = readSelectedElementContext(content);
      const sourceKind = eventData?.source?.kind || eventData?.message?.source?.kind;
      const normalizedContent = runtimeContent.trim();
      const pendingMessage = pendingMessages.find((candidate) => !matchedPendingMessageIds.has(candidate.id) && runtimeMessageMatchesPending(normalizedContent, candidate.message));
      if (pendingMessage) matchedPendingMessageIds.add(pendingMessage.id);
      const sentImagePreview = sentImagePreviews[sentImagePreviewIndex];
      const images = sentImagePreview && runtimeMessageMatchesPending(runtimeContent, sentImagePreview.message) ? sentImagePreview.previews : undefined;
      if (images) sentImagePreviewIndex += 1;
      if ((content || images?.length) && (sourceKind === "user" || !sourceKind)) timeline.push({ id: `user-${eventKey}`, kind: "user", content: visible.message, selectedElements: visible.selected, images, time: eventTime });
      continue;
    }

    if (eventType === "assistant/chunk") {
      const chunk = eventData?.chunk;
      if (chunk?.type === "block-start" && chunk.blockType === "tool-call") updateActiveStep("正在准备工具调用");
      if (chunk?.type === "text-delta") updateActiveStep("正在生成回复");
      if (chunk?.type === "reasoning-delta") updateActiveStep("正在思考");
      const text = chunk?.type === "text-delta" ? chunk.text || "" : "";
      const reasoning = chunk?.type === "reasoning-delta" ? chunk.text || "" : "";
      if (!text && !reasoning) continue;
      const index = ensurePartialAssistant(eventTime);
      const current = timeline[index];
      if (current?.kind === "assistant") {
        timeline[index] = {
          ...current,
          content: `${current.content}${text}`,
          ...(reasoning ? { reasoning: `${current.reasoning || ""}${reasoning}` } : {}),
          time: eventTime,
          streaming: true,
        };
      }
      continue;
    }

    if (eventType === "assistant/message" && event.surfaceOp === "append") {
      const content = textOfBlocks(eventData?.content) || textOfBlocks(eventData?.message?.content);
      const reasoning = reasoningOfBlocks(eventData?.content) || reasoningOfBlocks(eventData?.message?.content);
      if (!content && !reasoning.trim()) continue;
      finalizePartialAssistant(content, reasoning, eventTime);
      continue;
    }

    if (eventType === "tool/call") {
      const name = eventData?.name || "工具调用";
      updateActiveStep("正在执行工具", name);
      if (name === "ask_user_question") {
        const questions = parsePendingQuestionItems(eventData?.arguments);
        const index = timeline.push({ id: `question-${eventData?.callId || "event"}-${eventKey}`, kind: "question", status: "running", questions, input: formatJsonPayload(eventData?.arguments), time: eventTime }) - 1;
        if (eventData?.callId) runningTools.set(eventData.callId, index);
        continue;
      }
      const input = formatFileToolArguments(name, eventData?.arguments);
      const summary = summarizeToolCall(name, eventData?.arguments);
      const detail = combineToolDetail(input, undefined);
      const index = timeline.push({ id: `tool-${eventData?.callId || "event"}-${eventKey}`, kind: "tool", name, status: "running", summary, detail, time: eventTime }) - 1;
      if (eventData?.callId) runningTools.set(eventData.callId, index);
      continue;
    }

    if (eventType === "tool/result") {
      const callId = eventData?.callId || eventData?.message?.source?.callId;
      const existingNode = callId && runningTools.has(callId) ? timeline[runningTools.get(callId)!] : undefined;
      const resultToolName = existingNode?.kind === "tool" ? existingNode.name : eventData?.name || "工具调用";
      const rawOutput = runtimeToolResultText(eventData) || stringifyToolPayload(eventData?.meta);
      const output = isFileReadWriteTool(resultToolName) ? displayWorkingPathReferences(rawOutput) : rawOutput;
      const outputSummary = summarizeToolPayload(output);
      const status = eventData?.error || runtimeToolResultIsError(eventData) ? "error" : "done";
      const images = runtimeToolResultImages(eventData);
      if (callId && runningTools.has(callId)) {
        const index = runningTools.get(callId)!;
        const current = timeline[index];
        if (current?.kind === "question") {
          const answer = questionAnswerFromRuntimeData(eventData);
          timeline[index] = {
            ...current,
            status,
            output,
            ...(answer ? { answer } : {}),
            ...(eventData?.error?.code === "ASK_CANCELLED" ? { outcome: "cancelled" as const } : {}),
            time: eventTime,
          };
        } else if (current?.kind === "tool") {
          timeline[index] = {
            ...current,
            status,
            summary: status === "error" && outputSummary ? outputSummary : current.summary,
            detail: appendToolResult(current.detail, output),
            ...(images.length ? { images } : {}),
            time: eventTime,
          };
        }
        runningTools.delete(callId);
      } else {
        timeline.push({
          id: `tool-result-${callId || "event"}-${eventKey}`,
          kind: "tool",
          name: resultToolName,
          status,
          summary: outputSummary,
          detail: combineToolDetail(undefined, output),
          ...(images.length ? { images } : {}),
          time: eventTime,
        });
      }
      updateActiveStep(status === "error" ? "工具执行失败" : "工具执行完成");
      continue;
    }

    if (eventType === "command/run") {
      const name = eventData?.name || "command";
      const args = eventData?.args;
      updateActiveStep("正在执行命令", `/${name}`);
      const index = timeline.push({
        id: `command-${eventData?.commandId || "event"}-${eventKey}`,
        kind: "command",
        name,
        args,
        status: "running",
        summary: firstStringValue(args),
        detail: combineToolDetail(args, undefined),
        time: eventTime,
      }) - 1;
      if (eventData?.commandId) runningCommands.set(eventData.commandId, index);
      continue;
    }

    if (eventType === "command/done") {
      const commandId = eventData?.commandId;
      const status = eventData?.kind === "error" ? "error" : "success";
      const summary = eventData?.text;
      if (commandId && runningCommands.has(commandId)) {
        const index = runningCommands.get(commandId)!;
        const current = timeline[index];
        if (current?.kind === "command") timeline[index] = { ...current, status, summary: current.summary || summary, detail: appendToolResult(current.detail, summary), time: eventTime };
        runningCommands.delete(commandId);
      } else {
        timeline.push({
          id: `command-done-${commandId || "event"}-${eventKey}`,
          kind: "command",
          name: "command",
          status,
          summary,
          detail: summary,
          time: eventTime,
        });
      }
      continue;
    }

    if (eventType === "llm/retry") {
      const summary = [
        typeof eventData?.retry === "number" ? `第 ${eventData.retry}/${eventData.maxRetries ?? "∞"} 次` : "",
        typeof eventData?.delayMs === "number" ? `${Math.max(1, Math.ceil(eventData.delayMs / 1000))}秒后继续` : "",
      ].filter(Boolean).join(" · ");
      const index = timeline.push({
        id: `retry-${eventData?.retryId || "event"}-${eventKey}`,
        kind: "retry",
        provider: eventData?.provider,
        status: "scheduled",
        retry: eventData?.retry,
        maxRetries: eventData?.maxRetries,
        delayMs: eventData?.delayMs,
        failure: eventData?.failure?.message,
        summary,
        time: eventTime,
      }) - 1;
      if (eventData?.retryId) scheduledRetries.set(eventData.retryId, index);
      continue;
    }

    if (eventType === "llm/retry-started") {
      const retryId = eventData?.retryId;
      if (retryId && scheduledRetries.has(retryId)) {
        const index = scheduledRetries.get(retryId)!;
        const current = timeline[index];
        if (current?.kind === "retry") timeline[index] = { ...current, status: "started", time: eventTime };
      } else {
        timeline.push({
          id: `retry-started-${retryId || "event"}-${eventKey}`,
          kind: "retry",
          status: "started",
          time: eventTime,
        });
      }
      continue;
    }

    if (eventType === "compaction/summary") {
      timeline.push({
        id: `compaction-${eventKey}`,
        kind: "compaction",
        summary: blocksOrStringToText(eventData?.summary),
        shadowedItemCount: Array.isArray(eventData?.shadowedSeqs) ? eventData.shadowedSeqs.length : undefined,
        shadowedTokenCount: eventData?.shadowedTokenCount,
        time: eventTime,
      });
      continue;
    }

    if (eventType === "step/end") {
      const turn = eventData?.turn;
      const step = eventData?.step;
      const key = stepKey(turn, step);
      const index = runningSteps.get(key);
      if (index !== undefined) {
        finishProgress(index, eventTime);
        runningSteps.delete(key);
        if (activeStepIndex === index) activeStepIndex = null;
      }
      continue;
    }

    if (eventType === "turn/end") {
      const turn = eventData?.turn;
      const turnIndex = typeof turn === "number" ? runningTurns.get(turn) : undefined;
      if (turnIndex !== undefined) {
        finishProgress(turnIndex, eventTime);
        runningTurns.delete(turn!);
      }
      for (const [key, index] of runningSteps.entries()) {
        const progress = timeline[index];
        if (progress?.kind === "progress" && (turn === undefined || progress.turn === turn)) {
          finishProgress(index, eventTime);
          runningSteps.delete(key);
        }
      }
      activeStepIndex = null;
      const summary = summarizeTurnEnd(eventData);
      if ((eventData?.reason?.kind === "interrupted" || eventData?.reason?.kind === "aborted") && partialAssistantIndex !== null) {
        const current = timeline[partialAssistantIndex];
        if (current?.kind === "assistant") finalizePartialAssistant(current.content, current.reasoning || "", eventTime, true);
      }
      if (eventData?.reason?.kind === "error") {
        for (const [retryId, retryIndex] of scheduledRetries.entries()) {
          const retryNode = timeline[retryIndex];
          if (retryNode?.kind === "retry" && retryNode.status === "scheduled") {
            timeline[retryIndex] = { ...retryNode, status: "cancelled", time: eventTime };
            scheduledRetries.delete(retryId);
          }
        }
      }
      if (summary) {
        timeline.push({
          id: `notice-${eventKey}`,
          kind: "notice",
          tone: eventData?.reason?.kind === "error" ? "error" : eventData?.reason?.kind === "max-tokens" ? "warning" : "info",
          content: summary,
          time: eventTime,
        });
      }
    }
  }

  for (const pendingMessage of pendingMessages) {
    if (pendingMessage.queued || matchedPendingMessageIds.has(pendingMessage.id)) continue;
    const visible = readSelectedElementContext(pendingMessage.message);
    timeline.push({
      id: `optimistic-user-${pendingMessage.id}`,
      kind: "user",
      content: visible.message,
      selectedElements: visible.selected,
      images: pendingMessage.previews,
      time: pendingMessage.time,
    });
  }

  // Runtime emits turn/step start before the persisted user message. Keep the
  // conversation readable by placing those progress rows directly after it.
  const orderedTimeline: AiTimelineNode[] = [];
  let index = 0;
  while (index < timeline.length) {
    if (timeline[index]?.kind !== "progress") {
      orderedTimeline.push(timeline[index]!);
      index += 1;
      continue;
    }
    const progressRows: AiTimelineNode[] = [];
    while (index < timeline.length && timeline[index]?.kind === "progress") {
      progressRows.push(timeline[index]!);
      index += 1;
    }
    if (timeline[index]?.kind === "user") {
      orderedTimeline.push(timeline[index]!, ...progressRows);
      index += 1;
    } else {
      orderedTimeline.push(...progressRows);
    }
  }

  return orderedTimeline;
}

function displayReportFilterValue(filter: ReportFilterManifest["filters"][number]) {
  const value = filter.defaultValue;
  if (Array.isArray(value)) return value.join(", ") || "未设置";
  if (value === null || value === "") return "未设置";
  const option = filter.options?.find((candidate) => String(candidate.value) === String(value));
  return option?.label || String(value);
}

function ReportPropertiesPanel({ visible, manifest }: { visible: boolean; manifest: ReportFilterManifest | null }) {
  if (!visible) return null;
  const filters = manifest?.filters || [];

  return (
    <aside className="report-properties-panel hidden min-h-0 min-w-0 border-l border-[#DDE5F0] bg-white lg:flex lg:flex-col">
      <div className="flex h-[50px] shrink-0 items-center justify-between border-b border-[#E7EDF5] px-4">
        <span className="text-[13px] font-bold text-[#17243A]">报表属性</span>
      </div>
      <div className="flex h-[42px] shrink-0 items-end border-b border-[#E7EDF5] px-4">
        <div className="border-b-2 border-[#2167E8] px-1 pb-2 text-xs font-semibold text-[#2167E8]">筛选条件</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filters.length ? filters.map((filter) => (
          <div key={filter.key} className="flex items-center justify-between gap-3 border-b border-[#EEF2F7] px-4 py-3.5">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-[#344054]" title={filter.label}>{filter.label}</div>
              <div className="mt-1 truncate font-mono text-[10px] text-[#8A98AC]" title={`${filter.key}=${displayReportFilterValue(filter)}`}>
                {filter.key}={displayReportFilterValue(filter)}
              </div>
            </div>
            <div className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold ${filter.visible ? "bg-[#EAF8F2] text-[#16845B]" : "bg-[#F2F4F7] text-[#98A2B3]"}`}>
              {filter.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {filter.visible ? "显示" : "隐藏"}
            </div>
          </div>
        )) : (
          <div className="flex min-h-[240px] items-center justify-center px-6 text-center text-xs text-[#98A2AC]">
            当前报表没有定义筛选条件
          </div>
        )}
      </div>
    </aside>
  );
}

function measureReportFrameSize(frame: HTMLIFrameElement | null) {
  const documentElement = frame?.contentDocument?.documentElement;
  const body = frame?.contentDocument?.body;
  if (!documentElement || !body) return null;

  const explicitRoot = documentElement.querySelector<HTMLElement>('[data-report-root], #report-root, .report-page, main');
  const contentRoot = explicitRoot || Array.from(body.children).find((element) => {
    const tagName = element.tagName.toLowerCase();
    if (["script", "style", "link", "meta"].includes(tagName)) return false;
    if (element.hasAttribute("data-datatalk-report-scroll-spacer") || element.hasAttribute("data-datatalk-report-scroll-viewport")) return false;
    const computed = frame.contentWindow?.getComputedStyle(element);
    if (computed?.display === "none" || computed?.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || element.scrollWidth > 0 || element.scrollHeight > 0;
  }) || body;
  const rootWidth = Math.max(contentRoot.scrollWidth || 0, contentRoot.clientWidth || 0, Math.ceil(contentRoot.getBoundingClientRect().width || 0));
  const rootRect = contentRoot.getBoundingClientRect();
  const height = Math.ceil(Math.max(documentElement.scrollHeight || 0, body.scrollHeight || 0, contentRoot.scrollHeight || 0, rootRect.height || 0));
  const viewportWidth = Math.max(documentElement.clientWidth || 0, body.clientWidth || 0);

  return {
    width: Math.min(REPORT_MAX_CANVAS_WIDTH, Math.ceil(rootWidth || viewportWidth)),
    height,
  };
}

type WebReportCanvasProps = {
  reportCode: string;
  files: WebFileMap;
  workspaceFingerprint: string;
  filters: Record<string, unknown>;
  urlFilters: Record<string, unknown>;
  defaults: Record<string, unknown>;
  zoom: number;
  autoFit: boolean;
  fitRequestKey: number;
  refreshKey: number;
  elementPickerEnabled: boolean;
  selectedElementSelectors: string[];
  onElementPickerChange: (enabled: boolean) => void;
  onElementSelected: (element: ReportSelectedElement) => void;
  onLoad: () => void;
  onZoomChange: (zoom: number) => void;
  onAutoFitZoomChange: (zoom: number) => void;
  onFrameReady?: (frame: HTMLIFrameElement | null) => void;
  onFocusControllerChange?: (controller: ReportCanvasFocusController | null) => void;
};

type CanvasPosition = {
  x: number;
  y: number;
};

type ReportCanvasFocusController = {
  focusElement: (target: ReportPreviewElementTarget) => number;
};

function constrainCanvasPosition(position: CanvasPosition, viewportWidth: number, viewportHeight: number, contentWidth: number, contentHeight: number, zoom: number) {
  if (viewportWidth <= 1 || viewportHeight <= 1) return position;
  const scale = zoom / 100;
  const visualWidth = contentWidth * scale;
  const visualHeight = contentHeight * scale;
  const visibleX = Math.min(reportCanvasMinimumVisible, visualWidth);
  const visibleY = Math.min(reportCanvasMinimumVisible, visualHeight);
  return {
    x: Math.min(viewportWidth - visibleX, Math.max(visibleX - visualWidth, position.x)),
    y: Math.min(viewportHeight - visibleY, Math.max(visibleY - visualHeight, position.y)),
  };
}

function initialCanvasPosition(viewportWidth: number, viewportHeight: number, contentWidth: number, contentHeight: number, zoom: number) {
  const scale = zoom / 100;
  const visualWidth = contentWidth * scale;
  const visualHeight = contentHeight * scale;
  return {
    x: Math.round((viewportWidth - visualWidth) / 2),
    y: Math.round(visualHeight + reportCanvasPadding * 2 <= viewportHeight ? (viewportHeight - visualHeight) / 2 : reportCanvasPadding),
  };
}

function WebReportCanvas({ reportCode, files, workspaceFingerprint, filters, urlFilters, defaults, zoom, autoFit, fitRequestKey, refreshKey, elementPickerEnabled, selectedElementSelectors, onElementPickerChange, onElementSelected, onLoad, onZoomChange, onAutoFitZoomChange, onFrameReady, onFocusControllerChange }: WebReportCanvasProps) {
  const srcDoc = useMemo(() => composeWebReportSrcDoc(files, { filters, urlFilters, defaults, workspaceFingerprint }), [defaults, files, filters, urlFilters, workspaceFingerprint]);
  const designWidth = useMemo(() => resolveReportCanvasWidth(files), [files]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const canvasHoveredRef = useRef(false);
  const cameraPositionRef = useRef<CanvasPosition>({ x: 0, y: reportCanvasPadding });
  const dragStartRef = useRef<{ clientX: number; clientY: number; position: CanvasPosition; pointerId: number } | null>(null);
  const frameDragStartRef = useRef<{ clientX: number; clientY: number; position: CanvasPosition; pointerId: number } | null>(null);
  const previousZoomRef = useRef(zoom);
  const previousViewportRef = useRef({ width: 0, height: 0 });
  const hasPositionedCanvasRef = useRef(false);
  const [contentHeight, setContentHeight] = useState(defaultWebReportHeight);
  // Keep the declared design width as a lower bound while allowing intrinsically wider reports.
  const [contentWidth, setContentWidth] = useState(designWidth);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [availableHeight, setAvailableHeight] = useState(0);
  const [fitZoom, setFitZoom] = useState(100);
  const [panToolActive, setPanToolActive] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cameraPosition, setCameraPosition] = useState<CanvasPosition>(cameraPositionRef.current);
  const displayZoom = autoFit ? fitZoom : zoom;
  const effectiveContentWidth = Math.max(designWidth, contentWidth);
  const panningEnabled = panToolActive || spacePressed;

  useEffect(() => {
    setContentWidth(designWidth);
    hasPositionedCanvasRef.current = false;
  }, [designWidth]);

  const handleFrameLoad = useCallback((frame: HTMLIFrameElement | null) => {
    const measuredSize = measureReportFrameSize(frame);
    if (measuredSize) {
      const nextWidth = Math.max(designWidth, measuredSize.width);
      setContentWidth((current) => current === nextWidth ? current : nextWidth);
      setContentHeight((current) => current === measuredSize.height ? current : measuredSize.height);
    }
    onFrameReady?.(frame);
    onLoad();
  }, [designWidth, onFrameReady, onLoad]);
  const handleFrameContentSizeChange = useCallback((_frame: HTMLIFrameElement, width: number, height?: number) => {
    if (Number.isFinite(width) && width > 0) {
      const measuredWidth = Math.min(REPORT_MAX_CANVAS_WIDTH, Math.ceil(width));
      const nextWidth = Math.max(designWidth, measuredWidth);
      setContentWidth((current) => current === nextWidth ? current : nextWidth);
    }
    if (typeof height === "number" && height > 0) {
      const measuredHeight = Math.ceil(height);
      setContentHeight((current) => current === measuredHeight ? current : measuredHeight);
    }
  }, [designWidth]);

  const commitCameraPosition = useCallback((position: CanvasPosition, targetZoom = displayZoom) => {
    const nextPosition = constrainCanvasPosition(position, availableWidth, availableHeight, effectiveContentWidth, contentHeight, targetZoom);
    cameraPositionRef.current = nextPosition;
    setCameraPosition((current) => current.x === nextPosition.x && current.y === nextPosition.y ? current : nextPosition);
    return nextPosition;
  }, [availableHeight, availableWidth, contentHeight, displayZoom, effectiveContentWidth]);

  const deactivateAutoFit = useCallback(() => {
    if (autoFit) onZoomChange(displayZoom);
  }, [autoFit, displayZoom, onZoomChange]);

  const updateZoomAt = useCallback((deltaY: number, viewportX: number, viewportY: number) => {
    if (!deltaY) return;
    const currentZoom = previousZoomRef.current;
    const nextZoom = Math.max(minWebZoom, Math.min(maxWebZoom, currentZoom * Math.exp(-deltaY * reportCanvasZoomSensitivity)));
    if (nextZoom === currentZoom) return;

    const currentScale = currentZoom / 100;
    const nextScale = nextZoom / 100;
    const currentPosition = cameraPositionRef.current;
    const contentX = (viewportX - currentPosition.x) / currentScale;
    const contentY = (viewportY - currentPosition.y) / currentScale;
    previousZoomRef.current = nextZoom;
    commitCameraPosition({
      x: viewportX - contentX * nextScale,
      y: viewportY - contentY * nextScale,
    }, nextZoom);
    onZoomChange(nextZoom);
  }, [commitCameraPosition, onZoomChange]);

  const panCanvasBy = useCallback((deltaX: number, deltaY: number) => {
    if (!deltaX && !deltaY) return;
    deactivateAutoFit();
    const currentPosition = cameraPositionRef.current;
    commitCameraPosition({ x: currentPosition.x - deltaX, y: currentPosition.y - deltaY });
  }, [commitCameraPosition, deactivateAutoFit]);

  const applyCanvasWheel = useCallback((deltaX: number, deltaY: number, deltaMode: number, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean, viewportX: number, viewportY: number) => {
    const container = canvasRef.current;
    if (!container) return;
    const multiplier = deltaMode === 1 ? 16 : deltaMode === 2 ? container.clientHeight : 1;
    const normalizedX = deltaX * multiplier;
    const normalizedY = deltaY * multiplier;
    if (ctrlKey || metaKey) {
      updateZoomAt(normalizedY || normalizedX, viewportX, viewportY);
      return;
    }
    panCanvasBy(shiftKey && !normalizedX ? normalizedY : normalizedX, shiftKey ? 0 : normalizedY);
  }, [panCanvasBy, updateZoomAt]);

  const framePointInViewport = useCallback((frame: HTMLIFrameElement, clientX?: number, clientY?: number) => {
    const container = canvasRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const frameScaleX = effectiveContentWidth > 0 ? frameRect.width / effectiveContentWidth : displayZoom / 100;
    const frameScaleY = contentHeight > 0 ? frameRect.height / contentHeight : displayZoom / 100;
    return {
      x: typeof clientX === "number" ? frameRect.left + clientX * frameScaleX - containerRect.left : container.clientWidth / 2,
      y: typeof clientY === "number" ? frameRect.top + clientY * frameScaleY - containerRect.top : container.clientHeight / 2,
    };
  }, [contentHeight, displayZoom, effectiveContentWidth]);

  const handleFrameWheel = useCallback((frame: HTMLIFrameElement, deltaX: number, deltaY: number, clientX?: number, clientY?: number, deltaMode?: number, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean) => {
    const point = framePointInViewport(frame, clientX, clientY);
    if (!point) return;
    applyCanvasWheel(deltaX, deltaY, deltaMode || 0, Boolean(ctrlKey), Boolean(metaKey), Boolean(shiftKey), point.x, point.y);
  }, [applyCanvasWheel, framePointInViewport]);

  const handleFramePanPointer = useCallback((frame: HTMLIFrameElement, phase: "start" | "move" | "end", pointerId: number, clientX: number, clientY: number) => {
    const point = framePointInViewport(frame, clientX, clientY);
    if (!point) return;
    if (phase === "start") {
      deactivateAutoFit();
      frameDragStartRef.current = { clientX: point.x, clientY: point.y, position: cameraPositionRef.current, pointerId };
      setDragging(true);
      return;
    }
    const dragStart = frameDragStartRef.current;
    if (!dragStart || dragStart.pointerId !== pointerId) return;
    if (phase === "move") {
      commitCameraPosition({
        x: dragStart.position.x + point.x - dragStart.clientX,
        y: dragStart.position.y + point.y - dragStart.clientY,
      });
      return;
    }
    frameDragStartRef.current = null;
    setDragging(false);
  }, [commitCameraPosition, deactivateAutoFit, framePointInViewport]);

  const focusElement = useCallback((target: ReportPreviewElementTarget) => {
    const viewportWidth = availableWidth || canvasRef.current?.clientWidth || 1;
    const viewportHeight = availableHeight || canvasRef.current?.clientHeight || 1;
    const focusPadding = Math.min(reportCanvasPadding, Math.floor(Math.min(viewportWidth, viewportHeight) * 0.1));
    const focusWidth = Math.max(1, viewportWidth - focusPadding * 2);
    const focusHeight = Math.max(1, viewportHeight - focusPadding * 2);
    const targetZoom = Math.max(minWebZoom, Math.min(maxCaptureZoom, (Math.min(focusWidth / target.rect.width, focusHeight / target.rect.height)) * 100));
    const targetScale = targetZoom / 100;
    const targetCenterX = target.rect.left + target.rect.width / 2;
    const targetCenterY = target.rect.top + target.rect.height / 2;

    previousZoomRef.current = targetZoom;
    commitCameraPosition({
      x: viewportWidth / 2 - targetCenterX * targetScale,
      y: viewportHeight / 2 - targetCenterY * targetScale,
    }, targetZoom);
    onZoomChange(targetZoom);
    return targetZoom;
  }, [availableHeight, availableWidth, commitCameraPosition, onZoomChange]);

  useEffect(() => {
    if (!onFocusControllerChange) return;
    const controller = { focusElement } satisfies ReportCanvasFocusController;
    onFocusControllerChange(controller);
    return () => onFocusControllerChange(null);
  }, [focusElement, onFocusControllerChange]);

  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = container!.getBoundingClientRect();
      applyCanvasWheel(event.deltaX, event.deltaY, event.deltaMode, event.ctrlKey, event.metaKey, event.shiftKey, event.clientX - rect.left, event.clientY - rect.top);
    }
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [applyCanvasWheel]);

  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    const updateAvailableWidth = () => {
      const nextWidth = Math.max(1, Math.floor(container.clientWidth || 0));
      const nextHeight = Math.max(1, Math.floor(container.clientHeight || 0));
      setAvailableWidth((current) => current === nextWidth ? current : nextWidth);
      setAvailableHeight((current) => current === nextHeight ? current : nextHeight);
    };
    updateAvailableWidth();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateAvailableWidth);
    observer?.observe(container);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat || !canvasHoveredRef.current || isEditableTarget(event.target)) return;
      event.preventDefault();
      setSpacePressed(true);
    }
    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") setSpacePressed(false);
    }
    function handleBlur() {
      setSpacePressed(false);
      dragStartRef.current = null;
      frameDragStartRef.current = null;
      setDragging(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useLayoutEffect(() => {
    if (!autoFit) return;
    const referenceWidth = availableWidth || canvasRef.current?.clientWidth || 0;
    if (!referenceWidth || availableHeight <= 1 || !effectiveContentWidth) return;
    const nextZoom = Math.max(minWebZoom, Math.min(maxWebZoom, Math.floor(((referenceWidth - reportCanvasPadding * 2) / effectiveContentWidth) * 100)));
    const nextPosition = initialCanvasPosition(availableWidth, availableHeight, effectiveContentWidth, contentHeight, nextZoom);
    cameraPositionRef.current = nextPosition;
    setCameraPosition((current) => current.x === nextPosition.x && current.y === nextPosition.y ? current : nextPosition);
    previousZoomRef.current = nextZoom;
    previousViewportRef.current = { width: availableWidth, height: availableHeight };
    hasPositionedCanvasRef.current = true;
    setFitZoom((current) => current === nextZoom ? current : nextZoom);
    onAutoFitZoomChange(nextZoom);
  }, [autoFit, availableHeight, availableWidth, contentHeight, effectiveContentWidth, fitRequestKey, onAutoFitZoomChange]);

  useLayoutEffect(() => {
    if (autoFit || availableWidth <= 1 || availableHeight <= 1) return;
    const previousZoom = previousZoomRef.current;
    const previousViewport = previousViewportRef.current;
    let nextPosition = cameraPositionRef.current;

    if (!hasPositionedCanvasRef.current) {
      nextPosition = initialCanvasPosition(availableWidth, availableHeight, effectiveContentWidth, contentHeight, displayZoom);
      hasPositionedCanvasRef.current = true;
    } else if (previousZoom !== displayZoom) {
      const viewportX = availableWidth / 2;
      const viewportY = availableHeight / 2;
      const contentX = (viewportX - nextPosition.x) / (previousZoom / 100);
      const contentY = (viewportY - nextPosition.y) / (previousZoom / 100);
      nextPosition = {
        x: viewportX - contentX * (displayZoom / 100),
        y: viewportY - contentY * (displayZoom / 100),
      };
    } else if (previousViewport.width > 1 && previousViewport.height > 1 && (previousViewport.width !== availableWidth || previousViewport.height !== availableHeight)) {
      nextPosition = {
        x: nextPosition.x + (availableWidth - previousViewport.width) / 2,
        y: nextPosition.y + (availableHeight - previousViewport.height) / 2,
      };
    }

    previousZoomRef.current = displayZoom;
    previousViewportRef.current = { width: availableWidth, height: availableHeight };
    commitCameraPosition(nextPosition);
  }, [autoFit, availableHeight, availableWidth, commitCameraPosition, contentHeight, displayZoom, effectiveContentWidth]);

  function startCanvasDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-canvas-control]")) return;
    const clickedContent = Boolean(target.closest("[data-report-content]"));
    const shouldStart = event.button === 1 || (event.button === 0 && (panningEnabled || !clickedContent));
    if (!shouldStart) return;

    event.preventDefault();
    deactivateAutoFit();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      position: cameraPositionRef.current,
      pointerId: event.pointerId,
    };
    setDragging(true);
  }

  function moveCanvasDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    commitCameraPosition({
      x: dragStart.position.x + event.clientX - dragStart.clientX,
      y: dragStart.position.y + event.clientY - dragStart.clientY,
    });
  }

  function stopCanvasDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStartRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragStartRef.current = null;
    setDragging(false);
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#E9EEF4]">
      <div
        ref={canvasRef}
        className={`relative min-h-0 min-w-0 flex-1 overflow-clip bg-[#E9EEF4] ${dragging ? "cursor-grabbing select-none" : panningEnabled ? "cursor-grab" : ""}`}
        style={{ touchAction: "none", backgroundImage: "radial-gradient(circle, rgba(113,129,155,0.22) 1px, transparent 1px)", backgroundPosition: "0 0", backgroundSize: "20px 20px" }}
        onPointerDown={startCanvasDrag}
        onPointerMove={moveCanvasDrag}
        onPointerUp={stopCanvasDrag}
        onPointerCancel={stopCanvasDrag}
        onPointerEnter={() => { canvasHoveredRef.current = true; }}
        onPointerLeave={() => { canvasHoveredRef.current = false; }}
      >
        <div
          className="absolute left-0 top-0 z-10 bg-white shadow-[0_12px_32px_rgba(30,52,82,0.14)] ring-1 ring-[#C8D2DF]"
          data-report-canvas
          data-report-content
          role="region"
          aria-label={`内容画布 ${effectiveContentWidth} × ${contentHeight}px`}
          style={{
            width: `${effectiveContentWidth}px`,
            height: `${contentHeight}px`,
            transform: `translate3d(${cameraPosition.x}px, ${cameraPosition.y}px, 0) scale(${displayZoom / 100})`,
            transformOrigin: "top left",
            pointerEvents: panningEnabled ? "none" : undefined,
            willChange: "transform",
          }}
        >
          <ReportWebFrame
            refreshKey={refreshKey}
            className="block min-h-0 border-0 bg-white"
            style={{ width: `${effectiveContentWidth}px`, height: `${contentHeight}px` }}
            fixedCanvas
            elementPickerEnabled={elementPickerEnabled}
            selectedElementSelectors={selectedElementSelectors}
            title="网页型报表预览"
            reportCode={reportCode}
            source="working"
            srcDoc={srcDoc}
            onLoad={handleFrameLoad}
            onContentSizeChange={handleFrameContentSizeChange}
            onWheelChange={handleFrameWheel}
            onPanPointerChange={handleFramePanPointer}
            onElementSelected={onElementSelected}
            onElementPickerCancel={() => onElementPickerChange(false)}
          />
        </div>
      </div>
      <div data-canvas-control className="absolute bottom-4 left-4 z-30 inline-flex h-9 items-center rounded-md border border-[#C8D2DF] bg-white p-0.5 text-[#526174] shadow-[0_4px_14px_rgba(30,52,82,0.14)]">
        <button type="button" onClick={() => { setPanToolActive(false); onElementPickerChange(false); }} className={`flex h-8 w-8 items-center justify-center rounded ${!panToolActive && !elementPickerEnabled ? "bg-[#EAF1FD] text-[#2167E8]" : "hover:bg-[#F3F6FA]"}`} aria-label="使用报表交互工具" aria-pressed={!panToolActive && !elementPickerEnabled} title="交互工具"><MousePointer2 className="h-4 w-4" /></button>
        <button type="button" onClick={() => { setPanToolActive(false); onElementPickerChange(true); }} className={`flex h-8 w-8 items-center justify-center rounded ${elementPickerEnabled ? "bg-[#EAF1FD] text-[#2167E8]" : "hover:bg-[#F3F6FA]"}`} aria-label="选取报表元素用于对话" aria-pressed={elementPickerEnabled} title="选择元素"><ScanSearch className="h-4 w-4" /></button>
        <button type="button" onClick={() => { setPanToolActive(true); onElementPickerChange(false); }} className={`flex h-8 w-8 items-center justify-center rounded ${panToolActive ? "bg-[#EAF1FD] text-[#2167E8]" : "hover:bg-[#F3F6FA]"}`} aria-label="使用画布拖动工具" aria-pressed={panToolActive} title="拖动画布"><Hand className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

export function ReportEditorPageClient({ reportCode, sourceTenantId = null, sourceCode = null, sourceAssetType = null }: { reportCode: string | null; sourceTenantId?: string | null; sourceCode?: string | null; sourceAssetType?: string | null }) {
  const router = useRouter();
  const currentSearchParams = useSearchParams();
  const [report, setReport] = useState<ReportItem | null>(null);
  const [definition, setDefinition] = useState<ReportDefinition | null>(null);
  const [webFiles, setWebFiles] = useState<WebFileMap>({});
  const [workspaceFingerprint, setWorkspaceFingerprint] = useState("");
  const initialCommitHash = useRef<string | null>(null);
  const reportLoadStartedFor = useRef<string | null>(null);
  const sourceCopyStartedFor = useRef<string | null>(null);
  const [currentWorkingCommit, setCurrentWorkingCommit] = useState<string | null>(null);
  const [publishedCommitHash, setPublishedCommitHash] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ReportHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyEntriesRef = useRef<ReportHistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>("trend");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lockToken, setLockToken] = useState<string | null>(null);
  const [lockConflict, setLockConflict] = useState<{ name?: string } | null>(null);
  const [workingStatus, setWorkingStatus] = useState("");
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatImages, setChatImages] = useState<AiImageDraft[]>([]);
  const [chatFiles, setChatFiles] = useState<AiFileDraft[]>([]);
  const [selectedElements, setSelectedElements] = useState<ReportSelectedElement[]>([]);
  const [elementPickerEnabled, setElementPickerEnabled] = useState(false);
  const [sentImagePreviews, setSentImagePreviews] = useState<SentAiImagePreview[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingAiMessage[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestionRequest | null>(null);
  const [questionSubmitting, setQuestionSubmitting] = useState(false);
  const [questionError, setQuestionError] = useState("");
  const [runtimeEvents, setRuntimeEvents] = useState<RuntimeEventPayload[]>([]);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const conversationRequestVersionRef = useRef(0);
  const conversationRecoveryAbortRef = useRef<AbortController | null>(null);
  const conversationRecoveryTimerRef = useRef<number | null>(null);
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiStopping, setAiStopping] = useState(false);
  const activeAiRequestCountRef = useRef(0);
  const activeConversationIdRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);
  const [zoom, setZoom] = useState(100);
  const [webAutoFit, setWebAutoFit] = useState(false);
  const [fitRequestKey, setFitRequestKey] = useState(0);
  const [propertiesVisible, setPropertiesVisible] = useState(false);
  const [filterManifest, setFilterManifest] = useState<ReportFilterManifest | null>(null);
  const [publicLinkEnabled, setPublicLinkEnabled] = useState(false);
  const [publicLinkUpdating, setPublicLinkUpdating] = useState(false);
  const [publicLinkCopied, setPublicLinkCopied] = useState(false);
  const [publicLinkCode, setPublicLinkCode] = useState<string | null>(null);
  const [publicLinkPassword, setPublicLinkPassword] = useState<string | null>(null);
  const [publicLinkPasswordEnabled, setPublicLinkPasswordEnabled] = useState(false);
  const [publicLinkExpiresAt, setPublicLinkExpiresAt] = useState<string | null>(null);
  const [publicLinkPanelVisible, setPublicLinkPanelVisible] = useState(false);
  const [publicLinkOrigin, setPublicLinkOrigin] = useState("");
  const [resourceCenterEnabled, setResourceCenterEnabled] = useState(false);
  const [resourceItem, setResourceItem] = useState<ResourceItemRecord | null>(null);
  const [resourceCategories, setResourceCategories] = useState<ResourceCategoryOption[]>([]);
  const [resourceCategoriesByType, setResourceCategoriesByType] = useState<Partial<Record<ResourceAssetType, ResourceCategoryOption[]>>>({});
  const [resourcePanelVisible, setResourcePanelVisible] = useState(false);
  const [resourcePublishing, setResourcePublishing] = useState(false);
  const [resourceRecommendation, setResourceRecommendation] = useState<ResourceCategoryRecommendation | null>(null);
  const [resourceRecommendationLoading, setResourceRecommendationLoading] = useState(false);
  const resourceRecommendationRequestRef = useRef(0);
  const resourceAutoRecommendationTimerRef = useRef<number | null>(null);
  const resourceAutoRecommendationReportRef = useRef<string | null>(null);
  const [resourceFormError, setResourceFormError] = useState("");
  const [resourceThumbnailLoading, setResourceThumbnailLoading] = useState(false);
  const [resourcePreviewThumbnailUrl, setResourcePreviewThumbnailUrl] = useState("");
  const [resourceGeneratedThumbnailDataUrl, setResourceGeneratedThumbnailDataUrl] = useState("");
  const [resourceForm, setResourceForm] = useState<ResourcePublishFormState>({
    title: "",
    summary: "",
    thumbnailUrl: "",
    categoryId: "",
    assetType: "report",
  });
  const [contentRefreshKey, setContentRefreshKey] = useState(0);
  const [contentRefreshing, setContentRefreshing] = useState(false);
  const [aiPanelVisible, setAiPanelVisible] = useState(true);
  const [aiPanelWidth, setAiPanelWidth] = useState(defaultAiPanelWidth);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [resizingAiPanel, setResizingAiPanel] = useState(false);
  const resizeStart = useRef({ x: 0, width: defaultAiPanelWidth });
  const resizeHandleRef = useRef<HTMLButtonElement | null>(null);
  const resizePointerId = useRef<number | null>(null);
  const publicLinkPanelRef = useRef<HTMLDivElement | null>(null);
  const publicLinkOverlayRef = useRef<HTMLDivElement | null>(null);
  const resourcePanelRef = useRef<HTMLDivElement | null>(null);
  const webPreviewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const reportCanvasFocusControllerRef = useRef<ReportCanvasFocusController | null>(null);
  const previewRefreshPendingRef = useRef(false);
  const workspaceFingerprintRef = useRef("");
  const nameAutoSavePendingRef = useRef(false);
  const normalizedReportCode = reportCode?.trim() || null;
  const normalizedSourceCode = sourceCode?.trim() || null;
  const normalizedSourceTenantId = sourceTenantId?.trim() || null;
  const normalizedSourceAssetType = sourceAssetType?.trim() || "report";
  const selectedElementSelectors = useMemo(() => selectedElements.map((element) => element.selector), [selectedElements]);

  useEffect(() => {
    setSelectedElements([]);
  }, [workspaceFingerprint, contentRefreshKey, normalizedReportCode]);

  const handleElementSelected = useCallback((element: ReportSelectedElement) => {
    if (!element.workspaceFingerprint || element.workspaceFingerprint !== workspaceFingerprintRef.current) return;
    setSelectedElements((current) => current.some((selected) => selected.selector === element.selector) ? current : [...current, element]);
    setAiPanelVisible(true);
  }, []);

  const timeline = useMemo(() => {
    const folded = foldTimeline(runtimeEvents, sentImagePreviews, pendingMessages);
    if (folded.length) return folded;
    return [{ id: "welcome", kind: "notice", tone: "info", content: "你好，你可以直接让我修改报表、解释逻辑，或者排查问题。" } satisfies AiTimelineNode];
  }, [runtimeEvents, sentImagePreviews, pendingMessages]);

  function appendRuntimeEvent(event: RuntimeEventPayload) {
    if (event.type === "user/message" && event.surfaceOp === "append") {
      const content = textOfBlocks(event.data?.content) || textOfBlocks(event.data?.message?.content);
      const normalizedContent = content.trim();
      setPendingMessages((current) => {
        const pendingIndex = current.findIndex((candidate) => runtimeMessageMatchesPending(normalizedContent, candidate.message));
        if (pendingIndex < 0) return current;
        return current.filter((_, index) => index !== pendingIndex);
      });
    }
    setRuntimeEvents((current) => mergeRuntimeEvents(current, [event]));
  }

  function rememberPendingQuestion(question: PendingQuestionRequest | null) {
    setPendingQuestion((current) => {
      if (!question || !current) return question;
      const currentSeparator = current.rpcId.indexOf(":");
      const nextSeparator = question.rpcId.indexOf(":");
      const currentEventId = currentSeparator >= 0 ? current.rpcId.slice(currentSeparator + 1) : current.rpcId;
      const nextEventId = nextSeparator >= 0 ? question.rpcId.slice(nextSeparator + 1) : question.rpcId;
      if (currentEventId !== nextEventId) return question;
      // Recovery polls may observe the same pending event through a new
      // client stream. Keep the existing rpcId so the composer is not
      // remounted and the user's in-progress selections remain intact.
      return { ...question, rpcId: current.rpcId };
    });
  }

  function resetQuestionState() {
    setPendingQuestion(null);
    setQuestionSubmitting(false);
    setQuestionError("");
  }

  async function addAiImageFiles(files: File[]) {
    if (!files.length) return;
    const available = maxAiImages - chatImages.length;
    if (available <= 0) {
      setError(`最多添加 ${maxAiImages} 张图片`);
      return;
    }
    const nextImages: AiImageDraft[] = [];
    let lastError = "";
    for (const file of files.slice(0, available)) {
      try {
        nextImages.push(await readAiImageFile(file));
      } catch (imageError) {
        lastError = imageError instanceof Error ? imageError.message : "读取图片失败";
      }
    }
    if (nextImages.length) {
      setChatImages((current) => [...current, ...nextImages]);
      setError("");
    } else if (lastError) {
      setError(lastError);
    }
    if (files.length > available) setError(`最多添加 ${maxAiImages} 张图片`);
  }

  function addAiFiles(files: File[]) {
    if (!files.length) return;
    const available = maxAiFiles - chatFiles.length;
    if (available <= 0) {
      setError(`最多添加 ${maxAiFiles} 个附件`);
      return;
    }
    let totalBytes = chatFiles.reduce((total, attachment) => total + attachment.file.size, 0);
    const nextFiles: AiFileDraft[] = [];
    let lastError = "";
    for (const file of files.slice(0, available)) {
      try {
        const draft = readAiFileDraft(file);
        if (totalBytes + file.size > maxAiTotalFileBytes) throw new Error("附件总大小不能超过 100 MB");
        totalBytes += file.size;
        nextFiles.push(draft);
      } catch (fileError) {
        lastError = fileError instanceof Error ? fileError.message : "读取附件失败";
      }
    }
    if (nextFiles.length) {
      setChatFiles((current) => [...current, ...nextFiles]);
      setError("");
    } else if (lastError) {
      setError(lastError);
    }
    if (files.length > available) setError(`最多添加 ${maxAiFiles} 个附件`);
  }

  async function addAiAttachmentFiles(files: File[]) {
    if (!files.length) return;
    const imageFiles = files.filter(isAiImageFile);
    const otherFiles = files.filter((file) => !isAiImageFile(file));
    await addAiImageFiles(imageFiles);
    addAiFiles(otherFiles);
  }

  function handleAiAttachmentPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) {
      files.push(...Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file)));
    }
    if (!files.length) return;
    event.preventDefault();
    void addAiAttachmentFiles(files);
  }

  function handleAiAttachmentPicker(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    void addAiAttachmentFiles(files);
  }

  function stopConversationRecovery() {
    if (conversationRecoveryTimerRef.current !== null) {
      window.clearTimeout(conversationRecoveryTimerRef.current);
      conversationRecoveryTimerRef.current = null;
    }
    conversationRecoveryAbortRef.current?.abort();
    conversationRecoveryAbortRef.current = null;
  }

  function waitForConversationRecovery(signal: AbortSignal) {
    return new Promise<boolean>((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }

      const timer = window.setTimeout(() => {
        conversationRecoveryTimerRef.current = null;
        signal.removeEventListener("abort", onAbort);
        resolve(true);
      }, 1000);
      conversationRecoveryTimerRef.current = timer;

      function onAbort() {
        window.clearTimeout(timer);
        if (conversationRecoveryTimerRef.current === timer) conversationRecoveryTimerRef.current = null;
        signal.removeEventListener("abort", onAbort);
        resolve(false);
      }

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  function startConversationRecovery(code: string, conversationId: string, requestVersion: number, runtimeRunning: boolean) {
    stopConversationRecovery();
    if (!runtimeRunning) {
      if (activeAiRequestCountRef.current === 0) setAiStreaming(false);
      return;
    }

    const controller = new AbortController();
    conversationRecoveryAbortRef.current = controller;
    setAiStreaming(true);

    void (async () => {
      try {
        while (!controller.signal.aborted && requestVersion === conversationRequestVersionRef.current) {
          if (!await waitForConversationRecovery(controller.signal)) return;

          let result: { conversation?: AiConversation; events?: RuntimeHistoryEntry[]; runtimeRunning?: boolean; runtimeAvailable?: boolean; pendingQuestion?: PendingQuestionRequest | null; message?: string };
          try {
            const response = await fetch(`/api/reports/${encodeURIComponent(code)}/ai/conversations/${encodeURIComponent(conversationId)}?tail=1`, {
              headers: { Accept: "application/json" },
              cache: "no-store",
              signal: controller.signal,
            });
            result = await response.json() as typeof result;
            if (!response.ok) continue;
          } catch (recoveryError) {
            if (controller.signal.aborted) return;
            continue;
          }

          if (requestVersion !== conversationRequestVersionRef.current) return;
          if (result.events?.length) setRuntimeEvents((current) => mergeRuntimeEvents(current, runtimeEventsFromHistory(result.events || [])));
          if (result.pendingQuestion !== undefined) rememberPendingQuestion(result.pendingQuestion || null);
          if (!result.runtimeRunning) {
            try {
              const finalResponse = await fetch(`/api/reports/${encodeURIComponent(code)}/ai/conversations/${encodeURIComponent(conversationId)}`, {
                headers: { Accept: "application/json" },
                cache: "no-store",
                signal: controller.signal,
              });
              const finalResult = await finalResponse.json() as typeof result;
              if (finalResponse.ok && requestVersion === conversationRequestVersionRef.current && finalResult.events?.length) {
                setRuntimeEvents(runtimeEventsFromHistory(finalResult.events));
              }
            } catch (finalRecoveryError) {
              if (controller.signal.aborted) return;
            }
            if (activeAiRequestCountRef.current === 0) setAiStreaming(false);
            return;
          }
        }
      } finally {
        if (conversationRecoveryAbortRef.current === controller) {
          conversationRecoveryAbortRef.current = null;
          if (conversationRecoveryTimerRef.current !== null) {
            window.clearTimeout(conversationRecoveryTimerRef.current);
            conversationRecoveryTimerRef.current = null;
          }
        }
      }
    })();
  }

  async function loadConversationMessages(code: string, conversationId: string, requestVersion: number) {
    const response = await fetch(`/api/reports/${encodeURIComponent(code)}/ai/conversations/${encodeURIComponent(conversationId)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
    const result = await response.json() as { conversation?: AiConversation; events?: RuntimeHistoryEntry[]; runtimeRunning?: boolean; runtimeAvailable?: boolean; pendingQuestion?: PendingQuestionRequest | null; message?: string };
    if (!response.ok || !result.conversation) throw new Error(result.message || "读取 AI 对话失败");
    if (requestVersion !== conversationRequestVersionRef.current) return;
    setActiveConversationId(result.conversation.id);
    activeConversationIdRef.current = result.conversation.id;
    setRuntimeEvents(runtimeEventsFromHistory(result.events || []));
    resetQuestionState();
    rememberPendingQuestion(result.pendingQuestion || null);
    setQuestionSubmitting(false);
    setQuestionError("");
    setPendingMessages([]);
    setSentImagePreviews([]);
    startConversationRecovery(code, result.conversation.id, requestVersion, result.runtimeRunning === true);
  }

  async function loadConversationHistory(code: string) {
    stopConversationRecovery();
    const requestVersion = conversationRequestVersionRef.current + 1;
    conversationRequestVersionRef.current = requestVersion;
    setConversationLoading(true);
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(code)}/ai/conversations`, { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json() as { conversations?: AiConversation[]; message?: string };
      if (!response.ok) throw new Error(result.message || "读取 AI 对话历史失败");
      if (requestVersion !== conversationRequestVersionRef.current) return;
      const nextConversations = result.conversations || [];
      setConversations(nextConversations);
      if (nextConversations[0]) {
        await loadConversationMessages(code, nextConversations[0].id, requestVersion);
      } else {
        if (requestVersion !== conversationRequestVersionRef.current) return;
        setActiveConversationId(null);
        activeConversationIdRef.current = null;
        setRuntimeEvents([]);
        resetQuestionState();
      }
    } catch (conversationError) {
      if (requestVersion !== conversationRequestVersionRef.current) return;
      setConversations([]);
      setActiveConversationId(null);
      activeConversationIdRef.current = null;
      setRuntimeEvents([]);
      resetQuestionState();
      setWorkingStatus(conversationError instanceof Error ? conversationError.message : "AI 对话历史暂时不可用");
    } finally {
      if (requestVersion === conversationRequestVersionRef.current) setConversationLoading(false);
    }
  }

  async function selectConversation(conversationId: string) {
    if (!normalizedReportCode || aiStreaming || conversationLoading) return;
    stopConversationRecovery();
    const requestVersion = conversationRequestVersionRef.current + 1;
    conversationRequestVersionRef.current = requestVersion;
    setConversationLoading(true);
    setError("");
    try {
      await loadConversationMessages(normalizedReportCode, conversationId, requestVersion);
      if (requestVersion !== conversationRequestVersionRef.current) return;
      setChatInput("");
      setChatImages([]);
      setChatFiles([]);
    } catch (conversationError) {
      if (requestVersion !== conversationRequestVersionRef.current) return;
      setError(conversationError instanceof Error ? conversationError.message : "读取 AI 对话失败");
    } finally {
      if (requestVersion === conversationRequestVersionRef.current) setConversationLoading(false);
    }
  }

  function startNewConversation() {
    if (aiStreaming || conversationLoading) return;
    stopConversationRecovery();
    conversationRequestVersionRef.current += 1;
    setActiveConversationId(null);
    activeConversationIdRef.current = null;
    setRuntimeEvents([]);
    resetQuestionState();
    setPendingMessages([]);
    setChatInput("");
    setChatImages([]);
    setChatFiles([]);
    setSentImagePreviews([]);
    setError("");
  }

  useEffect(() => () => {
    stopConversationRecovery();
  }, []);

  useEffect(() => {
    setPublicLinkOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    try {
      const isCurrentPreferencesVersion = window.localStorage.getItem(editorPreferences.version) === editorPreferencesVersion;
      const storedAiPanelWidthValue = isCurrentPreferencesVersion ? window.localStorage.getItem(editorPreferences.aiPanelWidth) : null;
      const storedAiPanelVisible = isCurrentPreferencesVersion ? window.localStorage.getItem(editorPreferences.aiPanelVisible) : null;
      const storedPropertiesVisible = isCurrentPreferencesVersion ? window.localStorage.getItem(editorPreferences.propertiesVisible) : null;
      const storedAiPanelWidth = storedAiPanelWidthValue === null ? null : Number(storedAiPanelWidthValue);
      if (storedAiPanelWidth !== null && Number.isFinite(storedAiPanelWidth)) {
        setAiPanelWidth(Math.min(getMaxAiPanelWidth(), Math.max(minAiPanelWidth, storedAiPanelWidth)));
      }
      if (storedAiPanelVisible === "true" || storedAiPanelVisible === "false") {
        setAiPanelVisible(storedAiPanelVisible === "true");
      }
      if (storedPropertiesVisible === "true" || storedPropertiesVisible === "false") {
        setPropertiesVisible(storedPropertiesVisible === "true");
      }
    } catch {
      // Browser storage can be unavailable in private or restricted contexts.
    } finally {
      setPreferencesReady(true);
    }
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      window.localStorage.setItem(editorPreferences.aiPanelWidth, String(aiPanelWidth));
      window.localStorage.setItem(editorPreferences.aiPanelVisible, String(aiPanelVisible));
      window.localStorage.setItem(editorPreferences.propertiesVisible, String(propertiesVisible));
      window.localStorage.setItem(editorPreferences.version, editorPreferencesVersion);
    } catch {
      // Keep the current session usable when storage is unavailable.
    }
  }, [aiPanelVisible, aiPanelWidth, preferencesReady, propertiesVisible]);

  useEffect(() => {
    if (!publicLinkCopied) return;
    const resetTimer = window.setTimeout(() => setPublicLinkCopied(false), 1800);
    return () => window.clearTimeout(resetTimer);
  }, [publicLinkCopied]);

  useEffect(() => {
    if (!publicLinkPanelVisible) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && (publicLinkPanelRef.current?.contains(target) || publicLinkOverlayRef.current?.contains(target))) return;
      setPublicLinkPanelVisible(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPublicLinkPanelVisible(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [publicLinkPanelVisible]);

  useEffect(() => {
    if (!resourcePanelVisible) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && resourcePanelRef.current?.contains(target)) return;
      setResourcePanelVisible(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setResourcePanelVisible(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [resourcePanelVisible]);

  useEffect(() => {
    if (!resizingAiPanel) return;

    function handlePointerMove(event: PointerEvent) {
      if (resizePointerId.current !== null && event.pointerId !== resizePointerId.current) return;
      const nextWidth = resizeStart.current.width + event.clientX - resizeStart.current.x;
      setAiPanelWidth(Math.min(getMaxAiPanelWidth(), Math.max(minAiPanelWidth, nextWidth)));
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const resizeHandle = resizeHandleRef.current;
    resizeHandle?.addEventListener("lostpointercapture", stopAiPanelResize);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopAiPanelResize);
    window.addEventListener("pointercancel", stopAiPanelResize);
    window.addEventListener("mouseup", stopAiPanelResize);
    window.addEventListener("blur", stopAiPanelResize);
    document.addEventListener("visibilitychange", stopAiPanelResize);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizeHandle?.removeEventListener("lostpointercapture", stopAiPanelResize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopAiPanelResize);
      window.removeEventListener("pointercancel", stopAiPanelResize);
      window.removeEventListener("mouseup", stopAiPanelResize);
      window.removeEventListener("blur", stopAiPanelResize);
      document.removeEventListener("visibilitychange", stopAiPanelResize);
    };
  }, [resizingAiPanel]);

  useEffect(() => {
    if (normalizedReportCode || !normalizedSourceCode) return;
    const sourceKey = `${normalizedSourceTenantId || ""}:${normalizedSourceAssetType}:${normalizedSourceCode}`;
    if (sourceCopyStartedFor.current === sourceKey) return;
    sourceCopyStartedFor.current = sourceKey;

    async function copySourceReport() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/reports/copy-from-resource", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ sourceTenantId: normalizedSourceTenantId, sourceCode: normalizedSourceCode, sourceAssetType: normalizedSourceAssetType }),
        });
        const result = await response.json() as { report?: { code?: string }; message?: string };
        if (!response.ok || !result.report?.code) throw new Error(result.message || "复制报告失败");
        router.replace(`/reports/editor?code=${encodeURIComponent(result.report.code)}`);
      } catch (copyError) {
        setError(copyError instanceof Error ? copyError.message : "复制报告失败");
        setLoading(false);
      }
    }

    void copySourceReport();
  }, [normalizedReportCode, normalizedSourceAssetType, normalizedSourceCode, normalizedSourceTenantId, router]);

  useEffect(() => {
    if (!normalizedReportCode) {
      if (normalizedSourceCode) return;
      setError("缺少报表编码");
      setLoading(false);
      return;
    }
    const currentReportCode = normalizedReportCode;
    if (reportLoadStartedFor.current === currentReportCode) return;
    reportLoadStartedFor.current = currentReportCode;

    async function loadReport() {
      setLoading(true);
      setError("");
      setLockConflict(null);
      try {
        void loadConversationHistory(currentReportCode);
        const [lockResponse, response] = await Promise.all([
          fetch(`/api/reports/${encodeURIComponent(currentReportCode)}/lock`, { method: "POST", headers: { Accept: "application/json" } }),
          fetch(`/api/reports/${encodeURIComponent(currentReportCode)}`, { headers: { Accept: "application/json" }, cache: "no-store" }),
        ]);
        const lockResult = await lockResponse.json() as { lock?: { lockToken?: string; name?: string }; message?: string };
        if (lockResponse.status === 409) { setLockConflict(lockResult.lock || {}); setLoading(false); return; }
        if (!lockResponse.ok || !lockResult.lock?.lockToken) throw new Error(lockResult.message || "无法获取编辑锁");
        setLockToken(lockResult.lock.lockToken);

        const result = await response.json() as {
          report?: ReportItem;
          definition?: ReportDefinition | null;
          filterManifest?: ReportFilterManifest | null;
          webFiles?: WebFileMap;
          workspaceFingerprint?: string;
          workingCommitHash?: string | null;
          publishedCommitHash?: string | null;
          publicLinkCode?: string | null;
          publicLinkPassword?: string | null;
          publicLinkPasswordEnabled?: boolean;
          publicLinkExpiresAt?: string | null;
          resourceCenterEnabled?: boolean;
          resourceItem?: ResourceItemRecord | null;
          resourceCategories?: ResourceCategoryOption[];
          resourceCategoriesByType?: Partial<Record<ResourceAssetType, ResourceCategoryOption[]>>;
          message?: string;
        };
        if (!response.ok || !result.report) throw new Error(result.message || "报表数据暂时不可用");
        setReport(result.report);
        setPublicLinkEnabled(result.report.publicLinkEnabled);
        setPublicLinkCode(result.publicLinkCode || null);
        setPublicLinkPassword(result.publicLinkPassword || null);
        setPublicLinkPasswordEnabled(result.publicLinkPasswordEnabled ?? false);
        setPublicLinkExpiresAt(result.publicLinkExpiresAt || null);
        setDefinition(makeDefinition(result.report, result.definition ?? null));
        setResourceCenterEnabled(result.resourceCenterEnabled === true);
        setResourceItem(result.resourceItem || null);
        setResourceCategories(result.resourceCategories || []);
        setResourceCategoriesByType(result.resourceCategoriesByType || { report: result.resourceCategories || [] });
        setResourceRecommendation(null);
        setResourcePanelVisible(false);
        setResourceFormError("");
        setFilterManifest(result.filterManifest || reportFilterManifestFromDefinition(result.definition));
        setWebFiles(result.webFiles || {});
        workspaceFingerprintRef.current = result.workspaceFingerprint || "";
        setWorkspaceFingerprint(workspaceFingerprintRef.current);
        initialCommitHash.current = result.workingCommitHash || null;
        setCurrentWorkingCommit(result.workingCommitHash || null);
        setPublishedCommitHash(result.publishedCommitHash || null);
        historyEntriesRef.current = [];
        historyIndexRef.current = -1;
        setHistoryEntries([]);
        setHistoryIndex(-1);
        setSavedAt(result.report.updatedAt);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "报表数据暂时不可用");
      } finally {
        setLoading(false);
      }
    }

    void loadReport();
  }, [normalizedReportCode]);

  useEffect(() => {
    if (!normalizedReportCode || !lockToken || lockToken === "edit-lock-disabled") return;
    const beat = window.setInterval(() => { void fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/lock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "heartbeat", lockToken }) }).then((response) => { if (!response.ok) setError("编辑锁已失效，请退出后重新进入"); }); }, 10000);
    return () => window.clearInterval(beat);
  }, [lockToken, normalizedReportCode]);

  useEffect(() => () => { if (normalizedReportCode && lockToken && lockToken !== "edit-lock-disabled") void fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/lock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release", lockToken }), keepalive: true }); }, [lockToken, normalizedReportCode]);

  const editorFilterResolution = useMemo(
    () => resolveReportFilterValues(filterManifest, new URLSearchParams(currentSearchParams.toString())),
    [currentSearchParams, filterManifest],
  );
  const editorFilterValues = editorFilterResolution.values;
  const editorFilterQuery = useMemo(
    () => reportFilterValuesToSearchParams(filterManifest, editorFilterResolution.urlValues).toString(),
    [editorFilterResolution.urlValues, filterManifest],
  );
  const publicReportLink = useMemo(() => {
    if (!publicLinkOrigin || !publicLinkCode || !publicLinkEnabled) return "";
    return `${publicLinkOrigin}/link/${encodeURIComponent(publicLinkCode)}${editorFilterQuery ? `?${editorFilterQuery}` : ""}`;
  }, [editorFilterQuery, publicLinkCode, publicLinkEnabled, publicLinkOrigin]);
  const previewReportLink = useMemo(() => {
    if (!normalizedReportCode) return "";
    return `/preview/${encodeURIComponent(normalizedReportCode)}${editorFilterQuery ? `?${editorFilterQuery}` : ""}`;
  }, [editorFilterQuery, normalizedReportCode]);
  const hasUnpublishedChanges = Boolean(currentWorkingCommit) && currentWorkingCommit !== publishedCommitHash;
  const resourceButtonLabel = resourceItem ? "更新资源中心" : "发布到资源中心";
  const resourceSubmitLabel = resourceItem ? "确认更新" : "确认发布";

  useEffect(() => {
    if (!resourcePanelVisible) {
      resourceRecommendationRequestRef.current += 1;
      setResourceRecommendationLoading(false);
      return;
    }
    if (resourceItem || resourceAutoRecommendationReportRef.current === normalizedReportCode) {
      return;
    }
    const categories = resourceCategoriesByType[resourceForm.assetType]
      || (resourceForm.assetType === "report" ? resourceCategories : []);
    if ((!resourceForm.title.trim() && !resourceForm.summary.trim()) || !categories.length) {
      setResourceRecommendation(null);
      setResourceRecommendationLoading(false);
      return;
    }
    setResourceRecommendation(null);
    const timer = window.setTimeout(() => {
      resourceAutoRecommendationTimerRef.current = null;
      resourceAutoRecommendationReportRef.current = normalizedReportCode;
      void recommendResourceCategory(resourceForm.assetType, !resourceForm.categoryId, resourceForm);
    }, 500);
    resourceAutoRecommendationTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (resourceAutoRecommendationTimerRef.current === timer) resourceAutoRecommendationTimerRef.current = null;
    };
  }, [normalizedReportCode, resourceItem, resourcePanelVisible, resourceForm.assetType, resourceForm.title, resourceForm.summary, resourceCategoriesByType, resourceCategories]);

  function updateReportName(name: string) {
    nameAutoSavePendingRef.current = true;
    setError("");
    setReport((current) => current ? { ...current, name } : current);
  }

  async function autoSaveReportName() {
    if (!nameAutoSavePendingRef.current) return;
    if (!report) return;
    if (!report.name.trim()) {
      setError("报表名称不能为空");
      return;
    }
    if (!normalizedReportCode || !lockToken) {
      setError("编辑锁已失效，请退出后重新进入");
      return;
    }

    nameAutoSavePendingRef.current = false;
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: report.name.trim(), lockToken }),
      });
      const result = await response.json() as { name?: string; message?: string };
      if (!response.ok || !result.name) throw new Error(result.message || "报表名称更新失败");
      setReport((current) => current ? { ...current, name: result.name! } : current);
      setSavedAt("刚刚更新报表名称");
      setWorkingStatus("报表名称已更新");
    } catch (renameError) {
      nameAutoSavePendingRef.current = true;
      setError(renameError instanceof Error ? renameError.message : "报表名称更新失败");
    }
  }

  function recordHistory(commitHash: string | null | undefined, auditId: number | null | undefined, label: string) {
    if (!commitHash) return;
    setCurrentWorkingCommit(commitHash);
    const nextEntry: ReportHistoryEntry = { commitHash, auditId: auditId ?? null, label };
    const nextEntries = [...historyEntriesRef.current.slice(0, historyIndexRef.current + 1), nextEntry];
    historyEntriesRef.current = nextEntries;
    historyIndexRef.current = nextEntries.length - 1;
    setHistoryEntries(nextEntries);
    setHistoryIndex(nextEntries.length - 1);
  }

  async function moveHistory(direction: -1 | 1) {
    if (historyBusy || !lockToken || !normalizedReportCode) return;
    const targetIndex = historyIndex + direction;
    if (targetIndex < -1 || targetIndex >= historyEntries.length) return;
    const targetCommitHash = targetIndex < 0 ? initialCommitHash.current : historyEntries[targetIndex]?.commitHash;
    if (!targetCommitHash) {
      setError("当前工作区没有可用的历史提交");
      return;
    }

    setHistoryBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ targetCommitHash, lockToken }),
      });
        const result = await response.json() as { message?: string; webFiles?: WebFileMap; filterManifest?: ReportFilterManifest | null; report?: ReportItem; commitHash?: string | null };
      if (!response.ok) throw new Error(result.message || "历史版本恢复失败");
      if (result.webFiles) setWebFiles(result.webFiles);
      if (result.filterManifest !== undefined) setFilterManifest(result.filterManifest);
      if (result.report) setReport(result.report);
      setCurrentWorkingCommit(result.commitHash || null);
      historyIndexRef.current = targetIndex;
      setHistoryIndex(targetIndex);
      setSavedAt("刚刚恢复历史版本");
      setWorkingStatus(direction < 0 ? "已撤销上一次网页修改" : "已重做网页修改");
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "历史版本恢复失败");
    } finally {
      setHistoryBusy(false);
    }
  }

  async function publishReport() {
    if (!lockToken) {
      setError("编辑锁已失效，请退出后重新进入");
      return;
    }
    if (!normalizedReportCode || !report || saving) return;
    if (!hasUnpublishedChanges) {
      setWorkingStatus("没有未发布的报表修改");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const releaseResponse = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/release`, { method: "POST", headers: { Accept: "application/json" } });
      const release = await releaseResponse.json() as { sourceCommitHash?: string | null; version?: number; message?: string };
      if (!releaseResponse.ok) throw new Error(release.message || "发布失败");
      const sourceCommitHash = release.sourceCommitHash || currentWorkingCommit;
      setPublishedCommitHash(sourceCommitHash);
      setCurrentWorkingCommit(sourceCommitHash);
      setSavedAt("已发布");
      setReport((current) => current ? { ...current, status: "已发布" } : current);
      setWorkingStatus("报表已发布");
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "发布失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleResourcePanel() {
    if (!resourceCenterEnabled || !report) return;
    if (resourcePanelVisible) {
      setResourcePanelVisible(false);
      setResourceThumbnailLoading(false);
      return;
    }
    const nextForm = buildResourcePublishForm(report, definition, resourceItem);
    setResourceForm(nextForm);
    const fallbackThumbnailUrl = buildFallbackThumbnailPreviewUrl({
      report,
      definition,
      resourceItem,
      hasUnpublishedChanges,
    });
    setResourcePreviewThumbnailUrl("");
    setResourceGeneratedThumbnailDataUrl(fallbackThumbnailUrl);
    setResourceFormError("");
    setResourceRecommendation(null);
    setResourcePanelVisible(true);
    setResourceThumbnailLoading(true);
    try {
      const refreshed = await waitForPreviewRefresh();
      const thumbnailAttempt = refreshed
        ? await captureCurrentResourceThumbnail()
        : { dataUrl: null, error: "REPORT_PREVIEW_REFRESH_TIMEOUT" } satisfies ThumbnailCaptureAttempt;
      if (!thumbnailAttempt.dataUrl) {
        setResourcePreviewThumbnailUrl(fallbackThumbnailUrl);
        setResourceFormError(`${thumbnailCaptureErrorMessage(thumbnailAttempt.error)}，确认发布时会重试截图`);
        return;
      }
      setResourcePreviewThumbnailUrl(thumbnailAttempt.dataUrl);
      setResourceGeneratedThumbnailDataUrl(thumbnailAttempt.dataUrl);
    } finally {
      setResourceThumbnailLoading(false);
    }
  }

  async function recommendResourceCategory(assetType: ResourceAssetType, applyRecommendation: boolean, form: ResourcePublishFormState) {
    if (!normalizedReportCode) return;
    const requestId = resourceRecommendationRequestRef.current + 1;
    resourceRecommendationRequestRef.current = requestId;
    setResourceRecommendationLoading(true);
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/resource/recommend-category`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ assetType, title: form.title.trim(), summary: form.summary.trim() }),
      });
      const result = await response.json() as { recommendations?: ResourceCategoryRecommendation[]; message?: string };
      if (!response.ok) throw new Error(result.message || "分类推荐失败");
      if (requestId !== resourceRecommendationRequestRef.current) return;
      const recommendation = result.recommendations?.[0] || null;
      setResourceRecommendation(recommendation);
      if (applyRecommendation && recommendation) {
        setResourceForm((current) => current.assetType === assetType && !current.categoryId
          ? { ...current, categoryId: String(recommendation.categoryId) }
          : current);
      }
    } catch {
      if (requestId === resourceRecommendationRequestRef.current) setResourceRecommendation(null);
    } finally {
      if (requestId === resourceRecommendationRequestRef.current) setResourceRecommendationLoading(false);
    }
  }

  function changeResourceForm(key: keyof ResourcePublishFormState, value: string) {
    if (key === "assetType") {
      const assetType = value as ResourceAssetType;
      resourceRecommendationRequestRef.current += 1;
      setResourceRecommendationLoading(false);
      setResourceForm((current) => ({ ...current, assetType, categoryId: "" }));
      setResourceRecommendation(null);
      return;
    }
    setResourceForm((current) => ({ ...current, [key]: value }));
  }

  async function publishToResourceCenter() {
    if (!normalizedReportCode || !report || resourcePublishing) return;
    if (!resourceForm.title.trim()) {
      setResourceFormError("请先填写资源标题");
      return;
    }
    if (!resourceForm.categoryId) {
      setResourceFormError("请选择所属行业或行业子类");
      return;
    }

    setResourcePublishing(true);
    setResourceFormError("");
    setError("");
    const refreshed = await waitForPreviewRefresh();
    const nextThumbnailAttempt = refreshed
      ? await captureCurrentResourceThumbnail()
      : { dataUrl: null, error: "REPORT_PREVIEW_REFRESH_TIMEOUT" } satisfies ThumbnailCaptureAttempt;
    const generatedThumbnailDataUrl = nextThumbnailAttempt.dataUrl
      || (isPngDataUrl(resourceGeneratedThumbnailDataUrl) ? resourceGeneratedThumbnailDataUrl : "");
    if (nextThumbnailAttempt.dataUrl) {
      setResourcePreviewThumbnailUrl(nextThumbnailAttempt.dataUrl);
      setResourceGeneratedThumbnailDataUrl(nextThumbnailAttempt.dataUrl);
    }
    if (!generatedThumbnailDataUrl) {
      setResourceFormError(`${thumbnailCaptureErrorMessage(nextThumbnailAttempt.error)}，请稍后重试`);
      setResourcePublishing(false);
      return;
    }
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/resource`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          title: resourceForm.title.trim(),
          summary: resourceForm.summary.trim() || null,
          thumbnailUrl: null,
          generatedThumbnailDataUrl,
          categoryId: Number(resourceForm.categoryId),
          assetType: resourceForm.assetType,
        }),
      });
      const result = await response.json() as {
        resourceItem?: ResourceItemRecord | null;
        reportPublished?: boolean;
        sourceCommitHash?: string | null;
        reportStatus?: string;
        message?: string;
      };
      if (!response.ok || !result.resourceItem) throw new Error(result.message || "同步资源中心失败");

      setResourceItem(result.resourceItem);
      setResourcePanelVisible(false);
      if (result.reportPublished) {
        setPublishedCommitHash(result.sourceCommitHash || currentWorkingCommit);
        setSavedAt("已发布");
      }
      setReport((current) => current ? { ...current, status: result.reportStatus === "已发布" ? "已发布" : current.status } : current);
      setWorkingStatus(resourceItem ? "资源中心内容已更新" : "已发布到资源中心");
    } catch (publishError) {
      setResourceFormError(publishError instanceof Error ? publishError.message : "同步资源中心失败");
    } finally {
      setResourcePublishing(false);
    }
  }

  async function streamAiEdit(message: string, conversationId: string | null, images: AiImageDraft[], files: AiFileDraft[]) {
    if (!normalizedReportCode || !lockToken) throw new Error("编辑锁已失效，请退出后重新进入");
    const formData = new FormData();
    formData.set("message", message);
    formData.set("images", JSON.stringify(images.map(({ mediaType, data, name }) => ({ mediaType, data, name }))));
    formData.set("lockToken", lockToken);
    if (conversationId) formData.set("conversationId", conversationId);
    for (const attachment of files) formData.append("files", attachment.file, attachment.file.name);
    const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/ai`, {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      body: formData,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(result.message || "AI 请求失败");
    }
    if (!response.body) throw new Error("AI 流式响应不可用");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamError = "";
    let streamWarning = "";
    let lastAppliedSnapshotFingerprint: string | null = null;

    function applyWorkspaceSnapshot(webFiles: WebFileMap, fingerprint?: string, nextFilterManifest?: ReportFilterManifest | null) {
      if (fingerprint && fingerprint === lastAppliedSnapshotFingerprint) return;
      previewRefreshPendingRef.current = true;
      setContentRefreshing(true);
      setWebFiles(webFiles);
      workspaceFingerprintRef.current = fingerprint || "";
      setWorkspaceFingerprint(workspaceFingerprintRef.current);
      if (nextFilterManifest !== undefined) setFilterManifest(nextFilterManifest);
      setContentRefreshKey((current) => current + 1);
      lastAppliedSnapshotFingerprint = fingerprint || null;
    }

    function handleEvent(block: string) {
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) return;
      const payload = JSON.parse(dataLines.join("\n")) as { id?: string; title?: string; updatedAt?: string; text?: string; message?: string; changedFiles?: string[]; deletedFiles?: string[]; commitHash?: string | null; auditId?: number | null; applied?: boolean; cancelled?: boolean; requestId?: string; dshSessionId?: string; reportCode?: string; source?: "working"; includeScreenshot?: boolean; screenshotMode?: ReportPreviewScreenshotMode; screenshotSelector?: string; workspaceFingerprint?: string };
      if (eventName === "preview_inspection_request" && payload.requestId && payload.dshSessionId && payload.reportCode && payload.workspaceFingerprint) {
        void submitPreviewInspection({
          requestId: payload.requestId,
          dshSessionId: payload.dshSessionId,
          reportCode: payload.reportCode,
          source: payload.source === "working" ? "working" : "working",
          includeScreenshot: payload.includeScreenshot === true,
          screenshotMode: payload.screenshotMode === "full" ? "full" : payload.screenshotMode === "element" ? "element" : "thumbnail",
          screenshotSelector: typeof payload.screenshotSelector === "string" ? payload.screenshotSelector : undefined,
          workspaceFingerprint: payload.workspaceFingerprint,
        });
        return;
      }
      if (eventName === "runtime") {
        const runtime = payload as RuntimeEventPayload;
        if (runtime.type === "workspace_snapshot" && runtime.data && typeof runtime.data === "object") {
          const snapshot = runtime.data as { webFiles?: WebFileMap; filterManifest?: ReportFilterManifest | null; fingerprint?: string };
          if (snapshot.webFiles) applyWorkspaceSnapshot(snapshot.webFiles, snapshot.fingerprint, snapshot.filterManifest);
          return;
        }
        if (runtime.type === "turn/end" && runtime.data?.reason?.kind === "error") streamError = summarizeTurnEnd(runtime.data) || "AI 报表处理失败";
        appendRuntimeEvent(runtime);
        return;
      }
      if (eventName === "conversation" && payload.id && payload.title) {
        const updatedAt = payload.updatedAt || new Date().toISOString();
        setActiveConversationId(payload.id);
        activeConversationIdRef.current = payload.id;
        setConversations((current) => {
          const existing = current.find((conversation) => conversation.id === payload.id);
          const nextConversation: AiConversation = {
            id: payload.id as string,
            title: payload.title as string,
            createdAt: existing?.createdAt || updatedAt,
            updatedAt,
            messageCount: (existing?.messageCount || 0) + 2,
          };
          return [nextConversation, ...current.filter((conversation) => conversation.id !== payload.id)];
        });
        if (stopRequestedRef.current) void cancelAiTask(payload.id);
        return;
      }
      if (eventName === "result") {
        setPendingQuestion(null);
        setQuestionSubmitting(false);
        setQuestionError("");
        if (payload.cancelled) {
          setWorkingStatus("AI 任务已停止");
        } else if (payload.applied) {
          setSavedAt("刚刚更新 working");
          setWorkingStatus("working 已更新并通过校验");
          recordHistory(payload.commitHash, payload.auditId, "AI 网页修改");
        } else {
          setWorkingStatus("AI 对话已完成");
        }
        setError("");
        return;
      }
      if (eventName === "error") {
        setPendingQuestion(null);
        setQuestionSubmitting(false);
        streamError = toUserFacingAiError(payload.message, "AI 报表修改失败");
      }
      if (eventName === "question") {
        const questionPayload = payload as {
          type?: string;
          questionRpcId?: string;
          sessionId?: string;
          questions?: PendingQuestionItem[];
          outcome?: "answered" | "cancelled";
        };
        if (questionPayload.type === "requested" && typeof questionPayload.questionRpcId === "string" && Array.isArray(questionPayload.questions)) {
          rememberPendingQuestion({
            rpcId: questionPayload.questionRpcId,
            sessionId: questionPayload.sessionId || "",
            questions: questionPayload.questions,
          });
          setQuestionSubmitting(false);
          setQuestionError("");
          return;
        }
        if (questionPayload.type === "resolved" && typeof questionPayload.questionRpcId === "string") {
          setPendingQuestion((current) => current?.rpcId === questionPayload.questionRpcId ? null : current);
          setQuestionSubmitting(false);
          setQuestionError("");
          return;
        }
      }
      if (eventName === "warning" && payload.message) {
        streamWarning = payload.message;
      }
    }

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        handleEvent(buffer.slice(0, separator));
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf("\n\n");
      }
      if (done) {
        if (buffer.trim()) handleEvent(buffer);
        break;
      }
    }
    if (streamError) {
      const reportedError = new Error(streamError) as AiStreamError;
      reportedError.runtimeEventReported = true;
      throw reportedError;
    }
    if (streamWarning) setWorkingStatus(streamWarning);
  }

  async function cancelAiTask(conversationId: string) {
    if (!normalizedReportCode || aiStopping) return;
    stopRequestedRef.current = false;
    setAiStopping(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/ai/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message || "终止 AI 任务失败");
      setWorkingStatus("正在停止 AI 任务");
    } catch (stopError) {
      stopRequestedRef.current = false;
      setError(stopError instanceof Error ? stopError.message : "终止 AI 任务失败");
    } finally {
      setAiStopping(false);
    }
  }

  function stopAiTask() {
    if (aiStopping) return;
    const conversationId = activeConversationIdRef.current || activeConversationId;
    if (!conversationId) {
      stopRequestedRef.current = true;
      setWorkingStatus("正在停止 AI 任务");
      return;
    }
    stopRequestedRef.current = false;
    void cancelAiTask(conversationId);
  }

  async function respondPendingQuestion(answer: PendingQuestionAnswer) {
    const conversationId = activeConversationIdRef.current || activeConversationId;
    if (!normalizedReportCode || !conversationId || !pendingQuestion) return;
    setQuestionSubmitting(true);
    setQuestionError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/ai/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          conversationId,
          questionRpcId: pendingQuestion.rpcId,
          action: "answer",
          answer,
        }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message || "提交问题答案失败");
      setPendingQuestion((current) => current?.rpcId === pendingQuestion.rpcId ? null : current);
      setQuestionSubmitting(false);
    } catch (questionSubmitError) {
      setQuestionSubmitting(false);
      setQuestionError(questionSubmitError instanceof Error ? questionSubmitError.message : "提交问题答案失败");
    }
  }

  async function cancelPendingQuestion() {
    const conversationId = activeConversationIdRef.current || activeConversationId;
    if (!normalizedReportCode || !conversationId || !pendingQuestion) return;
    setQuestionSubmitting(true);
    setQuestionError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/ai/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          conversationId,
          questionRpcId: pendingQuestion.rpcId,
          action: "cancel",
        }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message || "取消问题失败");
      setPendingQuestion((current) => current?.rpcId === pendingQuestion.rpcId ? null : current);
      setQuestionSubmitting(false);
    } catch (questionCancelError) {
      setQuestionSubmitting(false);
      setQuestionError(questionCancelError instanceof Error ? questionCancelError.message : "取消问题失败");
    }
  }

  async function submitChat(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatInput.trim();
    const targets = selectedElements;
    const images = chatImages;
    const files = chatFiles;
    if (!message && !images.length && !files.length) return;
    if (targets.some((target) => target.workspaceFingerprint !== workspaceFingerprintRef.current)) {
      setSelectedElements([]);
      setError("选中元素已过期，请重新从当前预览选取");
      return;
    }
    const prompt = withSelectedElementContext(message, targets);
    const queued = activeAiRequestCountRef.current > 0
      || Boolean(conversationRecoveryAbortRef.current)
      || aiStreaming;
    stopConversationRecovery();
    conversationRequestVersionRef.current += 1;
    setConversationLoading(false);
    const submittedConversationId = activeConversationIdRef.current || activeConversationId;
    stopRequestedRef.current = false;
    const pendingId = `pending-user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPendingMessages((current) => [...current, {
      id: pendingId,
      message: prompt,
      previews: images.map((image) => image.previewUrl),
      files: files.map((attachment) => attachment.file.name),
      time: Date.now(),
      queued,
    }]);
    setSentImagePreviews((current) => [...current, { id: pendingId, message: prompt, previews: images.map((image) => image.previewUrl) }]);
    setChatInput("");
    setChatImages([]);
    setChatFiles([]);
    setSelectedElements([]);
    activeAiRequestCountRef.current += 1;
    setAiStreaming(true);
    setError("");
    try {
      await streamAiEdit(prompt, submittedConversationId, images, files);
    } catch (chatError) {
      const errorMessage = toUserFacingAiError(chatError instanceof Error ? chatError.message : "AI 报表处理失败", "AI 报表处理失败");
      if (!(chatError instanceof Error && (chatError as AiStreamError).runtimeEventReported)) {
        appendRuntimeEvent({ type: "turn/end", data: { reason: { kind: "error", error: { message: errorMessage } } }, time: Date.now() });
      }
      setWorkingStatus("AI 任务已终止");
      setError(errorMessage);
      setPendingMessages((current) => current.filter((pendingMessage) => pendingMessage.id !== pendingId));
      setSentImagePreviews((current) => current.filter((sentImage) => sentImage.id !== pendingId));
      if (targets.length && targets.every((target) => target.workspaceFingerprint === workspaceFingerprintRef.current)) {
        setSelectedElements((current) => {
          const selectedSelectors = new Set(current.map((element) => element.selector));
          return [...targets.filter((target) => !selectedSelectors.has(target.selector)), ...current];
        });
      }
    } finally {
      activeAiRequestCountRef.current = Math.max(0, activeAiRequestCountRef.current - 1);
      if (activeAiRequestCountRef.current === 0 && !conversationRecoveryAbortRef.current) setAiStreaming(false);
    }
  }

  function startAiPanelResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (window.innerWidth < 1024) return;
    event.preventDefault();
    resizeHandleRef.current = event.currentTarget;
    resizePointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStart.current = { x: event.clientX, width: aiPanelWidth };
    setResizingAiPanel(true);
  }

  function stopAiPanelResize() {
    const pointerId = resizePointerId.current;
    const handle = resizeHandleRef.current;
    resizePointerId.current = null;
    if (pointerId !== null && handle?.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    setResizingAiPanel(false);
  }

  async function copyPublicLink() {
    if (!publicReportLink) {
      setError("请先启用公共链接");
      return;
    }

    try {
      const copyValue = publicLinkPasswordEnabled && publicLinkPassword
        ? `${publicReportLink}\n密码: ${publicLinkPassword}`
        : publicReportLink;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copyValue);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = copyValue;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setPublicLinkCopied(true);
    } catch {
      setError("复制链接和密码失败，请稍后重试");
    }
  }

  async function rotatePublicLink() {
    if (publicLinkUpdating || !normalizedReportCode || !publicLinkEnabled || !publicLinkCode) return;
    if (!window.confirm("确定更换公共链接吗？更换后历史链接将立即失效。")) return;

    setPublicLinkUpdating(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/public-link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ enabled: true, rotate: true }),
      });
      const result = await response.json() as { publicLinkCode?: string | null; publicLinkPassword?: string | null; publicLinkPasswordEnabled?: boolean; publicLinkExpiresAt?: string | null; message?: string };
      if (!response.ok || !result.publicLinkCode) throw new Error(result.message || "更换公共链接失败");
      setPublicLinkCode(result.publicLinkCode);
      setPublicLinkPassword(result.publicLinkPassword || null);
      setPublicLinkPasswordEnabled(result.publicLinkPasswordEnabled ?? publicLinkPasswordEnabled);
      setPublicLinkExpiresAt(result.publicLinkExpiresAt || null);
      setPublicLinkCopied(false);
    } catch (rotateError) {
      setError(rotateError instanceof Error ? rotateError.message : "更换公共链接失败");
    } finally {
      setPublicLinkUpdating(false);
    }
  }

  async function togglePublicLink() {
    if (publicLinkUpdating || !normalizedReportCode) return;

    const enabled = !publicLinkEnabled;
    setPublicLinkUpdating(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/public-link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const result = await response.json() as { report?: ReportItem; publicLinkCode?: string | null; publicLinkPassword?: string | null; publicLinkPasswordEnabled?: boolean; publicLinkExpiresAt?: string | null; message?: string };
      if (!response.ok) throw new Error(result.message || "公共链接状态更新失败");
      const nextEnabled = result.report?.publicLinkEnabled ?? enabled;
      setPublicLinkEnabled(nextEnabled);
      setPublicLinkCode(result.publicLinkCode || null);
      setPublicLinkPassword(result.publicLinkPassword || null);
      setPublicLinkPasswordEnabled(result.publicLinkPasswordEnabled ?? false);
      setPublicLinkExpiresAt(result.publicLinkExpiresAt || null);
      setReport((current) => current ? { ...current, publicLinkEnabled: nextEnabled } : current);
      setPublicLinkCopied(false);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "公共链接状态更新失败");
    } finally {
      setPublicLinkUpdating(false);
    }
  }

  async function resetPublicLinkPassword() {
    if (publicLinkUpdating || !normalizedReportCode || !publicLinkEnabled) return;
    if (!window.confirm("确定重置公共链接密码吗？重置后旧密码立即失效。")) return;

    setPublicLinkUpdating(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/public-link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ enabled: true, resetPassword: true }),
      });
      const result = await response.json() as { publicLinkPassword?: string | null; publicLinkPasswordEnabled?: boolean; publicLinkExpiresAt?: string | null; message?: string };
      if (!response.ok || !result.publicLinkPassword) throw new Error(result.message || "重置密码失败");
      setPublicLinkPassword(result.publicLinkPassword);
      setPublicLinkPasswordEnabled(result.publicLinkPasswordEnabled ?? publicLinkPasswordEnabled);
      setPublicLinkExpiresAt(result.publicLinkExpiresAt || null);
      setPublicLinkCopied(false);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "重置密码失败");
    } finally {
      setPublicLinkUpdating(false);
    }
  }

  async function togglePublicLinkPassword(enabled: boolean) {
    if (publicLinkUpdating || !normalizedReportCode || !publicLinkEnabled) return;

    setPublicLinkUpdating(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/public-link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ enabled: true, passwordEnabled: enabled }),
      });
      const result = await response.json() as { publicLinkPassword?: string | null; publicLinkPasswordEnabled?: boolean; publicLinkExpiresAt?: string | null; message?: string };
      if (!response.ok) throw new Error(result.message || "更新密码保护失败");
      setPublicLinkPassword(result.publicLinkPassword || null);
      setPublicLinkPasswordEnabled(result.publicLinkPasswordEnabled ?? enabled);
      setPublicLinkExpiresAt(result.publicLinkExpiresAt || null);
      setPublicLinkCopied(false);
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "更新密码保护失败");
    } finally {
      setPublicLinkUpdating(false);
    }
  }

  async function savePublicLinkExpiresAt(expiresAt: string | null) {
    if (publicLinkUpdating || !normalizedReportCode || !publicLinkEnabled) return;

    setPublicLinkUpdating(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}/public-link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ enabled: true, expiresAt }),
      });
      const result = await response.json() as { publicLinkPassword?: string | null; publicLinkPasswordEnabled?: boolean; publicLinkExpiresAt?: string | null; message?: string };
      if (!response.ok) throw new Error(result.message || "更新有效期失败");
      setPublicLinkPassword(result.publicLinkPassword || null);
      setPublicLinkPasswordEnabled(result.publicLinkPasswordEnabled ?? publicLinkPasswordEnabled);
      setPublicLinkExpiresAt(result.publicLinkExpiresAt || null);
    } catch (expiryError) {
      setError(expiryError instanceof Error ? expiryError.message : "更新有效期失败");
    } finally {
      setPublicLinkUpdating(false);
    }
  }

  async function refreshContent() {
    if (contentRefreshing || !normalizedReportCode) return;
    setContentRefreshing(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode)}?refresh=${Date.now()}`, { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json() as {
        report?: ReportItem;
        definition?: ReportDefinition | null;
        filterManifest?: ReportFilterManifest | null;
        webFiles?: WebFileMap;
        workspaceFingerprint?: string;
        workingCommitHash?: string | null;
        publishedCommitHash?: string | null;
        publicLinkCode?: string | null;
        publicLinkPassword?: string | null;
        publicLinkPasswordEnabled?: boolean;
        publicLinkExpiresAt?: string | null;
        resourceCenterEnabled?: boolean;
          resourceItem?: ResourceItemRecord | null;
          resourceCategories?: ResourceCategoryOption[];
          resourceCategoriesByType?: Partial<Record<ResourceAssetType, ResourceCategoryOption[]>>;
          message?: string;
      };
      if (!response.ok || !result.report) throw new Error(result.message || "刷新报表内容失败");
        setReport(result.report);
        setPublicLinkEnabled(result.report.publicLinkEnabled);
        setPublicLinkCode(result.publicLinkCode || null);
        setPublicLinkPassword(result.publicLinkPassword || null);
        setPublicLinkPasswordEnabled(result.publicLinkPasswordEnabled ?? false);
        setPublicLinkExpiresAt(result.publicLinkExpiresAt || null);
      setResourceCenterEnabled(result.resourceCenterEnabled === true);
      setResourceItem(result.resourceItem || null);
      setResourceCategories(result.resourceCategories || []);
      setResourceCategoriesByType(result.resourceCategoriesByType || { report: result.resourceCategories || [] });
      setDefinition(makeDefinition(result.report, result.definition ?? null));
      setFilterManifest(result.filterManifest || reportFilterManifestFromDefinition(result.definition));
      setWebFiles(result.webFiles || {});
      workspaceFingerprintRef.current = result.workspaceFingerprint || "";
      setWorkspaceFingerprint(workspaceFingerprintRef.current);
      setCurrentWorkingCommit(result.workingCommitHash || null);
      setPublishedCommitHash(result.publishedCommitHash || null);
      setSavedAt(result.report.updatedAt);
      setWorkingStatus("已刷新报表内容");
      previewRefreshPendingRef.current = true;
      setContentRefreshKey((current) => current + 1);
    } catch (refreshError) {
      previewRefreshPendingRef.current = false;
      setError(refreshError instanceof Error ? refreshError.message : "刷新报表内容失败");
    } finally {
      setContentRefreshing(false);
    }
  }

  const effectiveWebFiles = useMemo(() => webFiles["page.html"] ? webFiles : definition ? toWebReportFiles(definition) : {}, [definition, webFiles]);
  const canUndo = historyIndex >= 0 && Boolean(initialCommitHash.current);
  const canRedo = historyIndex + 1 < historyEntries.length;
  const handleAutoFitZoomChange = useCallback((nextZoom: number) => setZoom(Math.round(nextZoom)), []);
  const handleCanvasZoomChange = useCallback((nextZoom: number) => {
    setWebAutoFit(false);
    setZoom(nextZoom);
  }, []);
  const handleCanvasFocusControllerChange = useCallback((controller: ReportCanvasFocusController | null) => {
    reportCanvasFocusControllerRef.current = controller;
  }, []);

  async function waitForPreviewRefresh() {
    const deadline = Date.now() + 12000;
    while (previewRefreshPendingRef.current && Date.now() < deadline) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
    }
    return !previewRefreshPendingRef.current;
  }

  async function alignPreviewWorkspace(expectedFingerprint: string) {
    const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode || "")}/ai/preview-inspection`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (response.status === 409) return "REPORT_PREVIEW_STALE_WORKSPACE";
    if (!response.ok) return "REPORT_PREVIEW_WORKSPACE_UNAVAILABLE";
    const snapshot = await response.json() as { fingerprint?: string; webFiles?: WebFileMap; filterManifest?: ReportFilterManifest | null };
    if (!snapshot.fingerprint || snapshot.fingerprint !== expectedFingerprint) return "REPORT_PREVIEW_STALE_WORKSPACE";

    const inspectVersion = async () => {
      const result = await requestFramePreviewInspection(webPreviewFrameRef.current, { includeScreenshot: false, screenshotMode: "thumbnail" }, 1500);
      return result.ok && result.inspection?.workspaceFingerprint === expectedFingerprint;
    };
    if (await inspectVersion()) return null;
    if (workspaceFingerprintRef.current !== expectedFingerprint || !previewRefreshPendingRef.current) {
      previewRefreshPendingRef.current = true;
      workspaceFingerprintRef.current = expectedFingerprint;
      setWorkspaceFingerprint(expectedFingerprint);
      setWebFiles(snapshot.webFiles || {});
      setFilterManifest(snapshot.filterManifest || null);
      setContentRefreshKey((current) => current + 1);
    }

    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 200));
      if (!previewRefreshPendingRef.current && await inspectVersion()) return null;
    }
    return "REPORT_PREVIEW_REFRESH_TIMEOUT";
  }

  async function captureCurrentResourceThumbnail(): Promise<ThumbnailCaptureAttempt> {
    const expectedFingerprint = workspaceFingerprintRef.current;
    if (!expectedFingerprint) {
      return await requestResourceThumbnail(webPreviewFrameRef.current, "");
    }

    let alignmentError: string | null;
    try {
      alignmentError = await alignPreviewWorkspace(expectedFingerprint);
    } catch {
      alignmentError = "REPORT_PREVIEW_WORKSPACE_UNAVAILABLE";
    }
    if (alignmentError) return { dataUrl: null, error: alignmentError };

    const firstAttempt = await requestResourceThumbnail(webPreviewFrameRef.current, expectedFingerprint);
    if (firstAttempt.error !== "REPORT_PREVIEW_STALE_WORKSPACE") return firstAttempt;

    previewRefreshPendingRef.current = true;
    setContentRefreshKey((current) => current + 1);
    if (!await waitForPreviewRefresh()) return { dataUrl: null, error: "REPORT_PREVIEW_REFRESH_TIMEOUT" };
    return await requestResourceThumbnail(webPreviewFrameRef.current, expectedFingerprint);
  }

  async function submitPreviewInspection(request: ReportPreviewInspectionRequest) {
    let alignmentError: string | null;
    try {
      alignmentError = await alignPreviewWorkspace(request.workspaceFingerprint);
    } catch {
      alignmentError = "REPORT_PREVIEW_WORKSPACE_UNAVAILABLE";
    }
    const refreshed = !alignmentError && await waitForPreviewRefresh();
    let result: ReportPreviewInspectionResult;
    if (!refreshed) {
      result = {
        ok: false,
        source: "working" as const,
        checkedAt: new Date().toISOString(),
        error: alignmentError || "REPORT_PREVIEW_REFRESH_TIMEOUT",
      };
    } else if (request.includeScreenshot && request.screenshotMode === "element") {
      const selector = request.screenshotSelector?.trim() || "";
      const frame = webPreviewFrameRef.current;
      const target = selector ? await requestFrameElementLocation(frame, selector) : null;
      const focusController = reportCanvasFocusControllerRef.current;
      if (!selector) {
        result = { ok: false, source: "working", checkedAt: new Date().toISOString(), error: "REPORT_PREVIEW_SELECTOR_REQUIRED" };
      } else if (!target) {
        result = { ok: false, source: "working", checkedAt: new Date().toISOString(), error: "REPORT_CAPTURE_TARGET_NOT_FOUND" };
      } else if (!focusController) {
        result = { ok: false, source: "working", checkedAt: new Date().toISOString(), error: "REPORT_CANVAS_CONTROLLER_UNAVAILABLE" };
      } else {
        const focusedZoom = focusController.focusElement(target);
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.setTimeout(resolve, 80))));
        result = await requestFramePreviewInspection(frame, { ...request, screenshotScale: focusedZoom / 100 });
      }
    } else {
      result = await requestFramePreviewInspection(webPreviewFrameRef.current, request);
    }
    if (request.includeScreenshot && result.error === "REPORT_PREVIEW_INSPECTION_TIMEOUT") {
      const inspectionOnly = await requestFramePreviewInspection(webPreviewFrameRef.current, {
        includeScreenshot: false,
        screenshotMode: "thumbnail",
      }, 15_000);
      if (inspectionOnly.ok) {
        result = { ...inspectionOnly, screenshotError: "REPORT_PREVIEW_INSPECTION_TIMEOUT" };
      }
    }
    const renderedFingerprint = typeof result.inspection?.workspaceFingerprint === "string" ? result.inspection.workspaceFingerprint : "";
    result = renderedFingerprint === request.workspaceFingerprint
      ? { ...result, workspaceFingerprint: renderedFingerprint }
      : { ...result, ok: false, error: result.error || "REPORT_PREVIEW_STALE_WORKSPACE", screenshotDataUrl: undefined, workspaceFingerprint: renderedFingerprint };
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(normalizedReportCode || request.reportCode)}/ai/preview-inspection`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          dshSessionId: request.dshSessionId,
          requestId: request.requestId,
          result,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { message?: string };
        console.warn("Report preview inspection response was rejected", payload.message || response.status);
      }
    } catch (error) {
      console.warn("Report preview inspection response failed", error instanceof Error ? error.message : "REPORT_PREVIEW_INSPECTION_RESPONSE_FAILED");
    }
  }

  const handleTogglePreviewSize = () => {
    if (webAutoFit) {
      setWebAutoFit(false);
      setZoom(100);
      return;
    }
    if (effectiveWebFiles["page.html"]) {
      setFitRequestKey((current) => current + 1);
      setWebAutoFit(true);
      return;
    }
    setWebAutoFit(false);
    setZoom(100);
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#F4F7FB] text-sm text-[#71819B]"><LoaderCircle className="mr-2 h-4 w-4 animate-spin text-[#2167E8]" />正在打开报表编辑器...</div>;
  }

  if (lockConflict && !report) {
    return <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F4F7FB] px-6 text-center text-sm text-[#71819B]"><div className="rounded-lg border border-[#F6D8D2] bg-white px-8 py-7 shadow-[0_8px_24px_rgba(23,36,58,0.06)]"><div className="text-base font-bold text-[#344054]">报表正在编辑中</div><p className="mt-2 text-xs leading-5 text-[#8A98AC]">用户“{lockConflict.name || "其他用户"}”编辑中，你暂时不能编辑</p><button type="button" onClick={() => router.push("/reports")} className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-[#2167E8] px-3 text-xs font-semibold text-white"><ArrowLeft className="h-3.5 w-3.5" />返回报表中心</button></div></main>;
  }

  if ((!normalizedReportCode || error) && !report) {
    return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F4F7FB] text-sm text-[#71819B]"><div className="text-[#B42318]">{error}</div><button type="button" onClick={() => router.push("/reports")} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2167E8] px-3 text-xs font-semibold text-white"><ArrowLeft className="h-3.5 w-3.5" />返回报表中心</button></div>;
  }

  if (!report || !definition) return null;

  return (
    <div className="report-editor flex h-screen max-h-screen min-h-0 min-w-0 flex-col overflow-hidden bg-[#F4F7FB] text-[#17243A]">
      <PublicLinkPanel
        containerRef={publicLinkOverlayRef}
        anchorRef={publicLinkPanelRef}
        visible={publicLinkPanelVisible}
        enabled={publicLinkEnabled}
        updating={publicLinkUpdating}
        copied={publicLinkCopied}
        publicLink={publicReportLink}
        password={publicLinkPassword}
        passwordEnabled={publicLinkPasswordEnabled}
        expiresAt={publicLinkExpiresAt}
        onTogglePanel={() => setPublicLinkPanelVisible((current) => !current)}
        onToggleLink={() => void togglePublicLink()}
        onCopy={() => void copyPublicLink()}
        onRotate={() => void rotatePublicLink()}
        onResetPassword={() => void resetPublicLinkPassword()}
        onTogglePasswordProtection={(nextEnabled) => void togglePublicLinkPassword(nextEnabled)}
        onSaveExpiresAt={(nextExpiresAt) => void savePublicLinkExpiresAt(nextExpiresAt)}
        panelOnly
      />
      <header className="flex min-h-[64px] items-center justify-between gap-4 border-b border-[#DDE5F0] bg-white px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3"><button type="button" onClick={() => router.push("/reports")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#526174] hover:bg-[#F3F6FA] hover:text-[#2167E8]" aria-label="返回报表中心" title="返回报表中心"><ArrowLeft className="h-4 w-4" /></button><div className="h-5 w-px bg-[#E7EDF5]" /><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><input value={report.name} onChange={(event) => updateReportName(event.target.value)} onBlur={autoSaveReportName} onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); event.currentTarget.blur(); }} className="min-w-0 max-w-[300px] truncate border-0 bg-transparent p-0 text-[16px] font-bold text-[#17243A] outline-none focus:ring-0" aria-label="报表名称" /></div><div className="mt-1 flex items-center gap-2 text-[11px] text-[#8A98AC]"><span>{report.code}</span><span>·</span><span>{savedAt || "未保存修改"}</span></div></div></div>
        <div className="flex shrink-0 items-center gap-2">
          <span aria-live="polite" className="hidden max-w-[180px] truncate text-[11px] text-[#16845B] xl:inline">{workingStatus}</span>
          <span className={`hidden rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex ${report.status === "已发布" ? "bg-[#EAF8F2] text-[#16845B]" : "bg-[#FFF5E8] text-[#B76700]"}`}>{report.status}</span>
          <a href={previewReportLink} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#DDE5F0] bg-white px-3 text-xs font-semibold text-[#526174] transition hover:border-[#2167E8] hover:text-[#2167E8]" aria-label="在新标签页预览报表" title="在新标签页预览报表"><Eye className="h-3.5 w-3.5" />预览</a>
          <button type="button" onClick={() => void publishReport()} disabled={saving || !hasUnpublishedChanges} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2167E8] px-3 text-xs font-semibold text-white shadow-[0_6px_14px_rgba(33,103,232,0.18)] hover:bg-[#1858CC] disabled:cursor-not-allowed disabled:opacity-45"><Upload className="h-3.5 w-3.5" />发布</button>
          {resourceCenterEnabled ? (
            <div ref={resourcePanelRef}>
              <ResourcePublishPanel
                visible={resourcePanelVisible}
                saving={resourcePublishing}
                buttonLabel={resourceButtonLabel}
                submitLabel={resourceSubmitLabel}
                form={resourceForm}
                previewThumbnailUrl={resourcePreviewThumbnailUrl}
                thumbnailLoading={resourceThumbnailLoading}
                categoriesByType={resourceCategoriesByType.report ? resourceCategoriesByType : { report: resourceCategories }}
                recommendation={resourceRecommendation}
                recommendationLoading={resourceRecommendationLoading}
                error={resourceFormError}
                onToggle={toggleResourcePanel}
                onChange={changeResourceForm}
                onRecommend={() => {
                  if (resourceAutoRecommendationTimerRef.current) window.clearTimeout(resourceAutoRecommendationTimerRef.current);
                  resourceAutoRecommendationTimerRef.current = null;
                  resourceAutoRecommendationReportRef.current = normalizedReportCode;
                  void recommendResourceCategory(resourceForm.assetType, !resourceForm.categoryId, resourceForm);
                }}
                onSubmit={() => void publishToResourceCenter()}
              />
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[#DDE5F0] bg-white px-4 py-1 sm:px-6">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap">
          <button type="button" onClick={() => setAiPanelVisible((current) => !current)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded transition ${aiPanelVisible ? "bg-[#EDF3FF] text-[#2167E8]" : "text-[#526174] hover:bg-[#F5F8FD]"}`} aria-label={aiPanelVisible ? "隐藏 AI 对话侧边栏" : "显示 AI 对话侧边栏"} aria-expanded={aiPanelVisible} title={aiPanelVisible ? "隐藏 AI 对话侧边栏" : "显示 AI 对话侧边栏"}>
            {aiPanelVisible ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => void moveHistory(-1)} disabled={!canUndo || historyBusy} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded px-2 text-xs font-semibold text-[#526174] hover:bg-[#F5F8FD] disabled:cursor-not-allowed disabled:text-[#B4BFCE]" aria-label="撤销上一次网页修改" title="撤销上一次网页修改"><Undo2 className="h-4 w-4" />撤销</button>
          <button type="button" onClick={() => void moveHistory(1)} disabled={!canRedo || historyBusy} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded px-2 text-xs font-semibold text-[#526174] hover:bg-[#F5F8FD] disabled:cursor-not-allowed disabled:text-[#B4BFCE]" aria-label="重做网页修改" title="重做网页修改"><Redo2 className="h-4 w-4" />重做</button>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-[#71819B]">
          <button type="button" onClick={() => { setWebAutoFit(false); setZoom((current) => Math.max(minWebZoom, current - 10)); }} className="flex h-8 w-8 items-center justify-center rounded hover:bg-[#F5F8FD]" aria-label="缩小画布" title="缩小画布"><Minus className="h-4 w-4" /></button>
          <span className="min-w-[42px] text-center font-medium" title="Ctrl/Cmd + 滚轮缩放">{Math.round(zoom)}%</span>
          <button type="button" onClick={() => { setWebAutoFit(false); setZoom((current) => Math.min(maxWebZoom, current + 10)); }} className="flex h-8 w-8 items-center justify-center rounded hover:bg-[#F5F8FD]" aria-label="放大画布" title="放大画布"><Plus className="h-4 w-4" /></button>
          <button type="button" onClick={handleTogglePreviewSize} className="h-8 min-w-[68px] shrink-0 rounded px-2 text-[#2167E8] hover:bg-[#EDF3FF]" aria-label={webAutoFit ? "恢复 100%" : "使画布适应可视宽度"} title={webAutoFit ? "恢复报表原始大小" : "适应宽度"}>{webAutoFit ? "100%" : "适应宽度"}</button>
          <div ref={publicLinkPanelRef} className="relative">
            <button type="button" onClick={() => setPublicLinkPanelVisible((current) => !current)} className={`flex h-8 w-8 items-center justify-center rounded transition ${publicLinkPanelVisible || publicLinkEnabled ? "bg-[#EDF3FF] text-[#2167E8]" : "hover:bg-[#F5F8FD]"}`} aria-label={publicLinkPanelVisible ? "收起公共链接设置" : "显示公共链接设置"} aria-expanded={publicLinkPanelVisible} title="公共链接"><Link2 className="h-4 w-4" /></button>
          </div>
          <button type="button" onClick={refreshContent} disabled={contentRefreshing} className="flex h-8 w-8 items-center justify-center rounded transition hover:bg-[#F5F8FD] disabled:cursor-wait disabled:text-[#B4BFCE]" aria-label="刷新报表内容" title="刷新报表内容"><RefreshCw className={`h-4 w-4 ${contentRefreshing ? "animate-spin" : ""}`} /></button>
          <button type="button" onClick={() => setPropertiesVisible((current) => !current)} className={`flex h-8 w-8 items-center justify-center rounded transition ${propertiesVisible ? "bg-[#EDF3FF] text-[#2167E8]" : "hover:bg-[#F5F8FD]"}`} aria-label={propertiesVisible ? "收起报表属性" : "显示报表属性"} aria-expanded={propertiesVisible} title={propertiesVisible ? "收起报表属性" : "显示报表属性"}><PanelRight className="h-4 w-4" /></button>
        </div>
      </div>


      <div className={`report-editor-grid relative grid min-h-0 flex-1 grid-cols-1 overflow-hidden ${effectiveWebFiles["page.html"] ? "report-web-mode" : ""} ${aiPanelVisible ? "" : "ai-panel-hidden"}`} style={{ "--report-editor-ai-width": aiPanelVisible ? `${aiPanelWidth}px` : "0px", "--report-editor-properties-width": propertiesVisible ? "276px" : "0px" } as CSSProperties}>
        {publicLinkPanelVisible ? <button type="button" onPointerDown={() => setPublicLinkPanelVisible(false)} className="absolute inset-0 z-40 cursor-default border-0 bg-transparent p-0" aria-label="关闭公共链接设置" /> : null}
        <div className="group relative h-full min-h-0 min-w-0 overflow-hidden"><AiChatPanel reportCode={normalizedReportCode} timeline={timeline} streaming={aiStreaming} pendingMessages={pendingMessages} pendingQuestion={pendingQuestion} questionSubmitting={questionSubmitting} questionError={questionError} error={error} stopping={aiStopping} chatInput={chatInput} chatImages={chatImages} chatFiles={chatFiles} selectedElements={selectedElements} onInputChange={setChatInput} onPaste={handleAiAttachmentPaste} onPickAttachments={handleAiAttachmentPicker} onRemoveImage={(id) => setChatImages((current) => current.filter((image) => image.id !== id))} onRemoveFile={(id) => setChatFiles((current) => current.filter((attachment) => attachment.id !== id))} onRemoveSelectedElement={(selector) => setSelectedElements((current) => current.filter((element) => element.selector !== selector))} onClearSelectedElements={() => setSelectedElements([])} onSubmit={submitChat} onStop={stopAiTask} onSubmitQuestion={(answer) => void respondPendingQuestion(answer)} onCancelQuestion={() => void cancelPendingQuestion()} conversations={conversations} activeConversationId={activeConversationId} conversationLoading={conversationLoading} onSelectConversation={(conversationId) => void selectConversation(conversationId)} onNewConversation={startNewConversation} /><button type="button" onPointerDown={startAiPanelResize} className="absolute right-[-4px] top-0 z-20 h-full w-2 cursor-col-resize border-0 bg-transparent p-0 hover:bg-[#2167E8]/10" aria-label="调整 AI 面板宽度" title="拖动调整 AI 面板宽度"><span className="absolute left-1/2 top-1/2 h-12 w-px -translate-x-1/2 -translate-y-1/2 bg-[#C8D5E5] opacity-0 transition group-hover:opacity-100" /></button></div>

        {effectiveWebFiles["page.html"] && normalizedReportCode ? <div className="report-web-overlay z-10 overflow-hidden bg-[#E9EEF4]"><WebReportCanvas reportCode={normalizedReportCode} files={effectiveWebFiles} workspaceFingerprint={workspaceFingerprint} filters={editorFilterValues} urlFilters={editorFilterResolution.urlValues} defaults={editorFilterResolution.defaults} zoom={zoom} autoFit={webAutoFit} fitRequestKey={fitRequestKey} refreshKey={contentRefreshKey} elementPickerEnabled={elementPickerEnabled} selectedElementSelectors={selectedElementSelectors} onElementPickerChange={setElementPickerEnabled} onElementSelected={handleElementSelected} onLoad={() => { previewRefreshPendingRef.current = false; setContentRefreshing(false); }} onZoomChange={handleCanvasZoomChange} onAutoFitZoomChange={handleAutoFitZoomChange} onFrameReady={(frame) => { webPreviewFrameRef.current = frame; if (frame) previewRefreshPendingRef.current = false; }} onFocusControllerChange={handleCanvasFocusControllerChange} /></div> : null}

        <main className="relative min-h-0 overflow-auto bg-[#EEF3F9] p-4 sm:p-6"><div className="mx-auto w-[1000px] max-w-none transition-transform" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top left" }}><div className="overflow-hidden border border-[#DCE5F0] bg-white shadow-[0_12px_30px_rgba(30,68,119,0.08)]"><div className="border-b border-[#E7EDF5] px-7 pb-5 pt-7"><div className="flex items-start justify-between gap-5"><div><div className="flex items-center gap-2 text-[11px] font-semibold text-[#2167E8]"><Sparkles className="h-3.5 w-3.5" />智能报表</div><h1 className="mt-2 text-[22px] font-extrabold tracking-[-0.03em] text-[#17243A]">{definition.title}</h1><p className="mt-1.5 text-xs text-[#8A98AC]">经营数据概览 · {definition.dateRange}</p></div><button type="button" className="flex h-8 items-center gap-1.5 rounded-md border border-[#DDE5F0] px-2.5 text-xs font-semibold text-[#526174] hover:border-[#2167E8] hover:text-[#2167E8]"><Settings2 className="h-3.5 w-3.5" />页面设置</button></div><div className="mt-5 flex flex-wrap items-center gap-2">{definition.filters.map((filter, index) => <button type="button" key={`${filter.label}-${index}`} onClick={() => setWorkingStatus(`筛选器“${filter.label}”已选中，可通过对话修改`)} className="inline-flex h-8 items-center gap-2 rounded-md border border-[#DDE5F0] bg-[#FAFCFF] px-2.5 text-xs text-[#526174] hover:border-[#B8D1FA]"><span className="text-[#8A98AC]">{filter.label}</span><span>{filter.value}</span><ChevronDown className="h-3.5 w-3.5 text-[#98A2B3]" /></button>)}</div></div><div className="grid grid-cols-2 gap-3 bg-[#F8FAFD] p-5">{definition.widgets.filter((widget) => widget.type === "kpi").map((widget) => <button type="button" key={widget.id} onClick={() => setSelectedWidgetId(widget.id)} className={`min-w-0 overflow-hidden rounded-md border text-left shadow-[0_1px_2px_rgba(23,36,58,0.03)] ${selectedWidgetId === widget.id ? "border-[#73A7F4] ring-2 ring-[#2167E8]/10" : "border-[#E3EAF3]"}`}><WidgetPreview widget={widget} /></button>)}</div><div className="grid gap-3 bg-[#F8FAFD] px-5 pb-5 md:grid-cols-2">{definition.widgets.filter((widget) => widget.type !== "kpi").map((widget, index) => <button type="button" key={widget.id} onClick={() => setSelectedWidgetId(widget.id)} className={`min-w-0 overflow-hidden rounded-md border text-left shadow-[0_1px_2px_rgba(23,36,58,0.03)] ${widget.type === "table" || index === 0 ? "md:col-span-2" : ""} ${selectedWidgetId === widget.id ? "border-[#73A7F4] ring-2 ring-[#2167E8]/10" : "border-[#E3EAF3]"}`}><WidgetPreview widget={widget} /></button>)}</div><div className="border-t border-[#E7EDF5] bg-white px-5 py-4"><div className="flex items-center gap-2 text-[11px] text-[#8A98AC]"><Check className="h-3.5 w-3.5 text-[#16845B]" />数据已同步 · 最后更新今天 11:05</div></div></div></div>{error ? <div className="mx-auto mt-3 max-w-[1000px] rounded-md border border-[#F5D4CC] bg-[#FFF8F6] px-3 py-2 text-xs text-[#B42318]">{error}</div> : null}</main>

        <ReportPropertiesPanel visible={propertiesVisible} manifest={filterManifest} />
      </div>
    </div>
  );
}

export default function ReportEditorPage() {
  const searchParams = useSearchParams();

  return <ReportEditorPageClient reportCode={searchParams.get("code")} sourceTenantId={searchParams.get("sourceTenantId")} sourceCode={searchParams.get("sourceCode")} sourceAssetType={searchParams.get("sourceAssetType")} />;
}

"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";

type ReportWebFrameProps = {
  title: string;
  reportCode: string;
  source: "working" | "release";
  srcDoc: string;
  className?: string;
  style?: CSSProperties;
  refreshKey?: number | string;
  hideHorizontalOverflow?: boolean;
  onLoad?: (frame: HTMLIFrameElement | null) => void;
};

type RuntimeQueryMessage = {
  type: "__DATATALK_RUNTIME_QUERY__";
  requestId: string;
  dataId: string;
  filters?: unknown;
};

type RuntimeReadyMessage = {
  type: "__DATATALK_RUNTIME_READY__";
};

function isRuntimeReadyMessage(value: unknown): value is RuntimeReadyMessage {
  return Boolean(value)
    && typeof value === "object"
    && (value as { type?: unknown }).type === "__DATATALK_RUNTIME_READY__";
}

function isRuntimeQueryMessage(value: unknown): value is RuntimeQueryMessage {
  return Boolean(value)
    && typeof value === "object"
    && (value as { type?: unknown }).type === "__DATATALK_RUNTIME_QUERY__"
    && typeof (value as { requestId?: unknown }).requestId === "string"
    && typeof (value as { dataId?: unknown }).dataId === "string";
}

type FrameState = {
  id: number;
  srcDoc: string;
  refreshKey?: number | string;
};

type InlineOverflowStyle = {
  value: string;
  priority: string;
};

type OriginalOverflowStyles = {
  document: InlineOverflowStyle;
  body: InlineOverflowStyle;
};

export function ReportWebFrame({ title, reportCode, source, srcDoc, className, style, refreshKey, hideHorizontalOverflow = false, onLoad }: ReportWebFrameProps) {
  const nextFrameId = useRef(1);
  const initialFrame = useRef<FrameState>({ id: 0, srcDoc, refreshKey }).current;
  const [activeFrame, setActiveFrame] = useState<FrameState>(initialFrame);
  const [pendingFrame, setPendingFrame] = useState<FrameState | null>(null);
  const activeFrameRef = useRef(activeFrame);
  const pendingFrameRef = useRef<FrameState | null>(null);
  const frameRefs = useRef(new Map<number, HTMLIFrameElement>());
  const originalOverflowStyles = useRef(new Map<number, OriginalOverflowStyles>());
  const pendingPromotionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const currentActive = activeFrameRef.current;
    const currentPending = pendingFrameRef.current;
    if (currentActive.srcDoc === srcDoc && currentActive.refreshKey === refreshKey) return;
    if (currentPending?.srcDoc === srcDoc && currentPending.refreshKey === refreshKey) return;

    const nextFrame = { id: nextFrameId.current++, srcDoc, refreshKey } satisfies FrameState;
    pendingFrameRef.current = nextFrame;
    setPendingFrame(nextFrame);
    if (pendingPromotionTimer.current) clearTimeout(pendingPromotionTimer.current);
    pendingPromotionTimer.current = setTimeout(() => promotePendingFrame(nextFrame), 5000);
  }, [refreshKey, srcDoc]);

  useEffect(() => () => {
    if (pendingPromotionTimer.current) clearTimeout(pendingPromotionTimer.current);
  }, []);

  function registerFrame(id: number, frame: HTMLIFrameElement | null) {
    if (frame) frameRefs.current.set(id, frame);
    else frameRefs.current.delete(id);
  }

  function setHorizontalOverflow(frame: HTMLIFrameElement, id: number, hidden: boolean) {
    const documentElement = frame.contentDocument?.documentElement;
    const body = frame.contentDocument?.body;
    if (!documentElement || !body) return;

    if (hidden) {
      if (!originalOverflowStyles.current.has(id)) {
        originalOverflowStyles.current.set(id, {
          document: {
            value: documentElement.style.getPropertyValue("overflow-x"),
            priority: documentElement.style.getPropertyPriority("overflow-x"),
          },
          body: {
            value: body.style.getPropertyValue("overflow-x"),
            priority: body.style.getPropertyPriority("overflow-x"),
          },
        });
      }
      documentElement.style.setProperty("overflow-x", "hidden", "important");
      body.style.setProperty("overflow-x", "hidden", "important");
      return;
    }

    const original = originalOverflowStyles.current.get(id);
    if (!original) return;
    if (original.document.value) documentElement.style.setProperty("overflow-x", original.document.value, original.document.priority);
    else documentElement.style.removeProperty("overflow-x");
    if (original.body.value) body.style.setProperty("overflow-x", original.body.value, original.body.priority);
    else body.style.removeProperty("overflow-x");
    originalOverflowStyles.current.delete(id);
  }

  function markFrame(frame: HTMLIFrameElement, id: number) {
    setHorizontalOverflow(frame, id, hideHorizontalOverflow);
  }

  useEffect(() => {
    for (const [id, frame] of frameRefs.current) markFrame(frame, id);
  }, [hideHorizontalOverflow, activeFrame.id, pendingFrame?.id]);

  function promotePendingFrame(frame: FrameState) {
    if (pendingFrameRef.current?.id !== frame.id) return;
    if (pendingPromotionTimer.current) clearTimeout(pendingPromotionTimer.current);
    pendingPromotionTimer.current = null;
    activeFrameRef.current = frame;
    setActiveFrame(frame);
    pendingFrameRef.current = null;
    setPendingFrame(null);
    onLoad?.(frameRefs.current.get(frame.id) ?? null);
  }

  function handleFrameLoad(frame: HTMLIFrameElement, id: number, pending: FrameState | null = null) {
    markFrame(frame, id);
    if (pending) promotePendingFrame(pending);
    else onLoad?.(frame);
  }

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const targetWindow = event.source as Window | null;
      const isReportFrame = Boolean(targetWindow)
        && Array.from(frameRefs.current.values()).some((frame) => frame.contentWindow === targetWindow);
      if (!isReportFrame || !targetWindow) return;
      if (isRuntimeReadyMessage(event.data)) {
        targetWindow.postMessage({ type: "__DATATALK_RUNTIME_READY_ACK__" }, "*");
        return;
      }
      if (!isRuntimeQueryMessage(event.data)) return;
      const payload = event.data;
      void (async () => {
        try {
          const response = await fetch(`/api/reports/${encodeURIComponent(reportCode)}/data`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dataId: payload.dataId,
              filters: payload.filters,
              source,
            }),
          });
          const body = await response.json().catch(() => ({})) as { data?: unknown; message?: string };
          targetWindow.postMessage({
            type: "__DATATALK_RUNTIME_RESPONSE__",
            requestId: payload.requestId,
            ok: response.ok,
            data: body.data,
            error: body.message || "运行时数据请求失败",
          }, "*");
        } catch (error) {
          targetWindow.postMessage({
            type: "__DATATALK_RUNTIME_RESPONSE__",
            requestId: payload.requestId,
            ok: false,
            error: error instanceof Error ? error.message : "运行时数据请求失败",
          }, "*");
        }
      })();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [reportCode, source]);

  const frameStyle = { ...style, position: "absolute", left: 0, top: 0 } satisfies CSSProperties;

  return (
    <div className="relative h-full w-full">
      <iframe
        key={activeFrame.id}
        ref={(frame) => registerFrame(activeFrame.id, frame)}
        className={`${className || ""} absolute left-0 top-0`}
        style={frameStyle}
        title={title}
        sandbox="allow-scripts"
        srcDoc={activeFrame.srcDoc}
        onLoad={(event) => handleFrameLoad(event.currentTarget, activeFrame.id)}
      />
      {pendingFrame ? (
        <iframe
          key={pendingFrame.id}
          ref={(frame) => registerFrame(pendingFrame.id, frame)}
          className={`${className || ""} absolute left-0 top-0`}
          style={{ ...frameStyle, visibility: "hidden", pointerEvents: "none" }}
          title={title}
          aria-hidden="true"
          sandbox="allow-scripts"
          srcDoc={pendingFrame.srcDoc}
          onLoad={(event) => handleFrameLoad(event.currentTarget, pendingFrame.id, pendingFrame)}
        />
      ) : null}
    </div>
  );
}

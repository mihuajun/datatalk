"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { REPORT_FRAME_SANDBOX } from "@/lib/report-web";
import type { ReportSelectedElement } from "@/lib/report-element-context";

type ReportWebFrameProps = {
  title: string;
  reportCode: string;
  source: "working" | "release";
  runtimeTarget?: "public-link" | "resource";
  srcDoc: string;
  className?: string;
  style?: CSSProperties;
  refreshKey?: number | string;
  hideHorizontalOverflow?: boolean;
  horizontalOverflowMode?: "restore" | "auto";
  reportZoom?: number;
  fixedCanvas?: boolean;
  elementPickerEnabled?: boolean;
  selectedElementSelectors?: string[];
  onLoad?: (frame: HTMLIFrameElement | null) => void;
  onContentSizeChange?: (frame: HTMLIFrameElement, width: number, height?: number) => void;
  onScrollChange?: (frame: HTMLIFrameElement, left: number, top?: number) => void;
  onWheelChange?: (frame: HTMLIFrameElement, deltaX: number, deltaY: number, clientX?: number, clientY?: number, deltaMode?: number, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean) => void;
  onPanPointerChange?: (frame: HTMLIFrameElement, phase: "start" | "move" | "end", pointerId: number, clientX: number, clientY: number) => void;
  onElementSelected?: (element: ReportSelectedElement) => void;
  onElementPickerCancel?: () => void;
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

type ReportSizeMessage = {
  type: "__DATATALK_REPORT_SIZE__";
  width: number;
  height?: number;
};

type ReportScrollMessage = {
  type: "__DATATALK_REPORT_SCROLL__";
  left: number;
  top?: number;
};

type ReportWheelMessage = {
  type: "__DATATALK_REPORT_WHEEL__";
  deltaX: number;
  deltaY: number;
  clientX?: number;
  clientY?: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

type ReportPanPointerMessage = {
  type: "__DATATALK_REPORT_PAN_POINTER__";
  phase: "start" | "move" | "end";
  pointerId: number;
  clientX: number;
  clientY: number;
};

function isRuntimeReadyMessage(value: unknown): value is RuntimeReadyMessage {
  return Boolean(value)
    && typeof value === "object"
    && (value as { type?: unknown }).type === "__DATATALK_RUNTIME_READY__";
}

function isReportSizeMessage(value: unknown): value is ReportSizeMessage {
  return Boolean(value)
    && typeof value === "object"
    && (value as { type?: unknown }).type === "__DATATALK_REPORT_SIZE__"
    && typeof (value as { width?: unknown }).width === "number"
    && Number.isFinite((value as { width: number }).width)
    && (value as { width: number }).width > 0
    && (typeof (value as { height?: unknown }).height === "undefined"
      || (typeof (value as { height?: unknown }).height === "number"
        && Number.isFinite((value as { height: number }).height)
        && (value as { height: number }).height > 0));
}

function isReportScrollMessage(value: unknown): value is ReportScrollMessage {
  return Boolean(value)
    && typeof value === "object"
    && (value as { type?: unknown }).type === "__DATATALK_REPORT_SCROLL__"
    && typeof (value as { left?: unknown }).left === "number"
    && Number.isFinite((value as { left: number }).left)
    && (value as { left: number }).left >= 0
    && (typeof (value as { top?: unknown }).top === "undefined"
      || (typeof (value as { top?: unknown }).top === "number"
        && Number.isFinite((value as { top: number }).top)
        && (value as { top: number }).top >= 0));
}

function isReportWheelMessage(value: unknown): value is ReportWheelMessage {
  return Boolean(value)
    && typeof value === "object"
    && (value as { type?: unknown }).type === "__DATATALK_REPORT_WHEEL__"
    && typeof (value as { deltaX?: unknown }).deltaX === "number"
    && Number.isFinite((value as { deltaX: number }).deltaX)
    && typeof (value as { deltaY?: unknown }).deltaY === "number"
    && Number.isFinite((value as { deltaY: number }).deltaY);
}

function isReportPanPointerMessage(value: unknown): value is ReportPanPointerMessage {
  return Boolean(value)
    && typeof value === "object"
    && (value as { type?: unknown }).type === "__DATATALK_REPORT_PAN_POINTER__"
    && ["start", "move", "end"].includes(String((value as { phase?: unknown }).phase || ""))
    && typeof (value as { pointerId?: unknown }).pointerId === "number"
    && Number.isFinite((value as { pointerId: number }).pointerId)
    && typeof (value as { clientX?: unknown }).clientX === "number"
    && Number.isFinite((value as { clientX: number }).clientX)
    && typeof (value as { clientY?: unknown }).clientY === "number"
    && Number.isFinite((value as { clientY: number }).clientY);
}

function isRuntimeQueryMessage(value: unknown): value is RuntimeQueryMessage {
  return Boolean(value)
    && typeof value === "object"
    && (value as { type?: unknown }).type === "__DATATALK_RUNTIME_QUERY__"
    && typeof (value as { requestId?: unknown }).requestId === "string"
    && typeof (value as { dataId?: unknown }).dataId === "string";
}

function isElementSelectedMessage(value: unknown): value is { type: "__DATATALK_ELEMENT_SELECTED__"; target: ReportSelectedElement } {
  if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "__DATATALK_ELEMENT_SELECTED__") return false;
  const target = (value as { target?: unknown }).target;
  if (!target || typeof target !== "object") return false;
  const element = target as Partial<ReportSelectedElement>;
  return typeof element.selector === "string" && element.selector.length > 0 && element.selector.length <= 500
    && typeof element.tag === "string" && element.tag.length > 0 && element.tag.length <= 60
    && typeof element.text === "string" && element.text.length <= 240
    && typeof element.workspaceFingerprint === "string" && element.workspaceFingerprint.length <= 100;
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

export function ReportWebFrame({ title, reportCode, source, runtimeTarget, srcDoc, className, style, refreshKey, hideHorizontalOverflow = false, horizontalOverflowMode = "restore", reportZoom, fixedCanvas = false, elementPickerEnabled = false, selectedElementSelectors, onLoad, onContentSizeChange, onScrollChange, onWheelChange, onPanPointerChange, onElementSelected, onElementPickerCancel }: ReportWebFrameProps) {
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
    if (!documentElement || !body) {
      frame.contentWindow?.postMessage({ type: "__DATATALK_SET_HORIZONTAL_OVERFLOW__", hidden, mode: horizontalOverflowMode }, "*");
      return;
    }

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
    if (horizontalOverflowMode === "auto") {
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
      documentElement.style.setProperty("overflow-x", "auto", "important");
      body.style.setProperty("overflow-x", "visible", "important");
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

  function setReportZoom(frame: HTMLIFrameElement) {
    if (typeof reportZoom !== "number") return;
    frame.contentWindow?.postMessage({ type: "__DATATALK_SET_REPORT_ZOOM__", zoom: reportZoom }, "*");
  }

  function setFixedCanvas(frame: HTMLIFrameElement) {
    frame.contentWindow?.postMessage({ type: "__DATATALK_SET_FIXED_CANVAS__", enabled: fixedCanvas }, "*");
  }

  function setElementPicker(frame: HTMLIFrameElement) {
    frame.contentWindow?.postMessage({ type: "__DATATALK_SET_ELEMENT_PICKER__", enabled: elementPickerEnabled, selectedSelectors: selectedElementSelectors || [] }, "*");
  }

  useEffect(() => {
    if (!elementPickerEnabled) return;
    const clearHover = () => {
      const frame = frameRefs.current.get(activeFrameRef.current.id);
      frame?.contentWindow?.postMessage({ type: "__DATATALK_CLEAR_ELEMENT_PICKER_HOVER__" }, "*");
    };
    window.addEventListener("pointermove", clearHover, { capture: true });
    return () => window.removeEventListener("pointermove", clearHover, { capture: true });
  }, [elementPickerEnabled]);

  useEffect(() => {
    for (const [id, frame] of frameRefs.current) markFrame(frame, id);
  }, [hideHorizontalOverflow, horizontalOverflowMode, activeFrame.id, pendingFrame?.id]);

  useEffect(() => {
    for (const frame of frameRefs.current.values()) setReportZoom(frame);
  }, [reportZoom, activeFrame.id, pendingFrame?.id]);

  useEffect(() => {
    for (const frame of frameRefs.current.values()) setFixedCanvas(frame);
  }, [fixedCanvas, activeFrame.id, pendingFrame?.id]);

  useEffect(() => {
    for (const frame of frameRefs.current.values()) setElementPicker(frame);
  }, [elementPickerEnabled, selectedElementSelectors, activeFrame.id, pendingFrame?.id]);

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
    setFixedCanvas(frame);
    setReportZoom(frame);
    setElementPicker(frame);
    if (pending) promotePendingFrame(pending);
    else onLoad?.(frame);
  }

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const targetWindow = event.source as Window | null;
      const reportFrame = targetWindow
        ? Array.from(frameRefs.current.values()).find((frame) => frame.contentWindow === targetWindow)
        : undefined;
      if (!reportFrame || !targetWindow) return;
      if (reportFrame === frameRefs.current.get(activeFrameRef.current.id)) {
        if (isElementSelectedMessage(event.data)) {
          onElementSelected?.(event.data.target);
          return;
        }
        if (event.data?.type === "__DATATALK_ELEMENT_PICKER_CANCEL__") {
          onElementPickerCancel?.();
          return;
        }
      }
      if (isReportSizeMessage(event.data)) {
        onContentSizeChange?.(reportFrame, event.data.width, event.data.height);
        return;
      }
      if (isReportScrollMessage(event.data)) {
        onScrollChange?.(reportFrame, event.data.left, event.data.top);
        return;
      }
      if (isReportWheelMessage(event.data)) {
        onWheelChange?.(reportFrame, event.data.deltaX, event.data.deltaY, event.data.clientX, event.data.clientY, event.data.deltaMode, event.data.ctrlKey, event.data.metaKey, event.data.shiftKey);
        return;
      }
      if (isReportPanPointerMessage(event.data)) {
        onPanPointerChange?.(reportFrame, event.data.phase, event.data.pointerId, event.data.clientX, event.data.clientY);
        return;
      }
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
              runtimeTarget,
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
  }, [onContentSizeChange, onElementPickerCancel, onElementSelected, onPanPointerChange, onScrollChange, onWheelChange, reportCode, runtimeTarget, source]);

  const frameStyle = { ...style, position: "absolute", left: 0, top: 0 } satisfies CSSProperties;

  return (
    <div className="relative h-full w-full">
      <iframe
        key={activeFrame.id}
        ref={(frame) => registerFrame(activeFrame.id, frame)}
        className={`${className || ""} absolute left-0 top-0`}
        style={frameStyle}
        title={title}
        sandbox={REPORT_FRAME_SANDBOX}
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
          sandbox={REPORT_FRAME_SANDBOX}
          srcDoc={pendingFrame.srcDoc}
          onLoad={(event) => handleFrameLoad(event.currentTarget, pendingFrame.id, pendingFrame)}
        />
      ) : null}
    </div>
  );
}

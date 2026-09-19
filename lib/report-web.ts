import type { ReportDefinition } from "@/lib/report-types";

export type WebFileMap = Partial<Record<"page.html" | "styles.css" | "app.js", string>> & {
  assets?: Record<string, string>;
};

export const REPORT_ASSET_URL_PREFIX = "datatalk-asset://";

const REPORT_ASSET_REFERENCE_PATTERN = /(^|[\s"'(=,:])((?:datatalk-asset:\/\/|\.\/|\/)?assets\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#][^\s"'()<>]*)?)/gim;
const REPORT_ASSET_UNQUOTED_ATTRIBUTE_PATTERN = /(\b(?:poster|src)\s*=\s*)((?:datatalk-asset:\/\/|\.\/|\/)?assets\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#][^\s"'<>]*)?)/gim;
const REPORT_ASSET_CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gim;

function normalizeReportAssetReference(reference: string) {
  const normalized = reference.trim();
  const pathEnd = normalized.search(/[?#]/);
  return (pathEnd >= 0 ? normalized.slice(0, pathEnd) : normalized)
    .replace(/^datatalk-asset:\/\//i, "")
    .replace(/^\.\//, "")
    .replace(/^\//, "");
}

export function inlineWebReportAssets(source: string, assets: Record<string, string> | undefined) {
  if (!assets) return source;
  const resolveDataUrl = (reference: string) => assets[normalizeReportAssetReference(reference)];
  const withSafeAttributes = source.replace(REPORT_ASSET_UNQUOTED_ATTRIBUTE_PATTERN, (match, prefix: string, reference: string) => {
    const dataUrl = resolveDataUrl(reference);
    return dataUrl ? `${prefix}"${dataUrl}"` : match;
  });
  const withSafeCssUrls = withSafeAttributes.replace(REPORT_ASSET_CSS_URL_PATTERN, (match, doubleQuoted: string, singleQuoted: string, unquoted: string) => {
    const dataUrl = resolveDataUrl(doubleQuoted || singleQuoted || unquoted || "");
    return dataUrl ? `url("${dataUrl}")` : match;
  });
  return withSafeCssUrls.replace(REPORT_ASSET_REFERENCE_PATTERN, (match, boundary: string, reference: string) => {
    const dataUrl = resolveDataUrl(reference);
    return dataUrl ? `${boundary}${dataUrl}` : match;
  });
}

export const REPORT_DEFAULT_CANVAS_WIDTH = 1180;
export const REPORT_MAX_CANVAS_WIDTH = 2400;

const REPORT_MIN_CANVAS_WIDTH = 480;

function parseCanvasWidth(value: unknown) {
  const numericValue = Number.parseFloat(String(value ?? "").replace(/px\s*$/i, "").trim());
  if (!Number.isFinite(numericValue)) return null;
  return Math.max(REPORT_MIN_CANVAS_WIDTH, Math.min(REPORT_MAX_CANVAS_WIDTH, Math.round(numericValue)));
}

function readAttribute(tag: string, attribute: string) {
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] || null;
}

export function resolveReportCanvasWidth(files: WebFileMap) {
  const html = files["page.html"] || "";
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    if (readAttribute(tag, "name")?.toLowerCase() !== "datatalk-report-width") continue;
    const width = parseCanvasWidth(readAttribute(tag, "content"));
    if (width) return width;
  }

  const reportRootTag = html.match(/<[^>]*data-report-width\s*=\s*["'][^"']+["'][^>]*>/i)?.[0];
  const rootWidth = parseCanvasWidth(reportRootTag ? readAttribute(reportRootTag, "data-report-width") : null);
  if (rootWidth) return rootWidth;

  const styles = files["styles.css"] || "";
  const cssWidth = styles.match(/--datatalk-report-width\s*:\s*([^;]+);?/i)?.[1];
  return parseCanvasWidth(cssWidth) || REPORT_DEFAULT_CANVAS_WIDTH;
}

// Reports run in a sandboxed iframe; popups escape it so external pages remain usable.
export const REPORT_FRAME_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: unknown) {
  return escapeHtml(value).replaceAll("\n", " ");
}

export function toWebReportFiles(definition: ReportDefinition): Required<Pick<WebFileMap, "page.html" | "styles.css" | "app.js">> {
  const filters = definition.filters.map((filter) => `
    <button class="report-filter" type="button" data-filter-key="${escapeAttribute(filter.label)}">
      <span class="report-filter-label">${escapeHtml(filter.label)}</span>
      <span>${escapeHtml(filter.value)}</span>
    </button>`).join("");
  const widgets = definition.widgets.map((widget) => `
    <article class="report-widget report-widget-${escapeAttribute(widget.type)}" data-widget-id="${escapeAttribute(widget.id)}" data-widget-type="${escapeAttribute(widget.type)}">
      <div class="report-widget-header">
        <div>
          <h2>${escapeHtml(widget.title)}</h2>
          <p>${widget.type === "kpi" ? escapeHtml(widget.metric) : `按${escapeHtml(widget.dimension || "日期")}查看${escapeHtml(widget.metric || "销售额")}`}</p>
        </div>
      </div>
      <div class="report-widget-content" data-widget-content>
        <strong class="report-value js-report-value">--</strong>
          <span class="report-empty js-report-empty">待接入 server.js 数据逻辑</span>
      </div>
    </article>`).join("");

  return {
    "page.html": `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${REPORT_DEFAULT_CANVAS_WIDTH}px, initial-scale=1.0" />
    <meta name="datatalk-report-width" content="${REPORT_DEFAULT_CANVAS_WIDTH}" />
    <title>${escapeHtml(definition.title)}</title>
  </head>
  <body>
    <main class="report-page" data-report-root>
      <header class="report-header">
        <div>
          <span class="report-eyebrow">DATATALK REPORT</span>
          <h1>${escapeHtml(definition.title)}</h1>
          <p>${escapeHtml(definition.subTitle || "经营数据概览")} · ${escapeHtml(definition.dateRange || "")}</p>
        </div>
        <span class="report-status">实时预览</span>
      </header>
        <section class="report-filters" aria-label="报表筛选器">${filters}</section>
      <section class="report-grid">${widgets}</section>
    </main>
  </body>
</html>`,
    "styles.css": `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #17243a;
  background: #f4f7fb;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; background: #f4f7fb; }
.report-page { width: ${REPORT_DEFAULT_CANVAS_WIDTH}px; min-height: 100vh; margin: 0 auto; padding: 40px; }
.report-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; padding: 32px; border: 1px solid #dce5f0; border-radius: 20px; background: #fff; box-shadow: 0 16px 40px rgba(30, 68, 119, .08); }
.report-eyebrow { color: #2167e8; font-size: 11px; font-weight: 800; letter-spacing: .12em; }
h1 { margin: 10px 0 8px; font-size: clamp(28px, 4vw, 46px); line-height: 1.08; letter-spacing: -.04em; }
.report-header p { margin: 0; color: #71819b; font-size: 14px; }
.report-status { padding: 8px 12px; border-radius: 999px; background: #eaf8f2; color: #16845b; font-size: 12px; font-weight: 700; white-space: nowrap; }
.report-filters { display: flex; flex-wrap: wrap; gap: 10px; padding: 20px 0; }
.report-filter { display: inline-flex; gap: 10px; align-items: center; padding: 10px 14px; border: 1px solid #dce5f0; border-radius: 10px; color: #526174; background: #fff; font: inherit; font-size: 13px; }
.report-filter-label { color: #98a2b3; }
.report-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.report-widget { min-height: 180px; padding: 22px; border: 1px solid #e3eaf3; border-radius: 16px; background: #fff; box-shadow: 0 6px 18px rgba(23, 36, 58, .05); }
.report-widget-header { display: flex; justify-content: space-between; gap: 16px; }
.report-widget h2 { margin: 0; font-size: 16px; }
.report-widget p { margin: 7px 0 0; color: #98a2b3; font-size: 12px; }
.report-widget-content { display: flex; min-height: 105px; align-items: center; gap: 12px; margin-top: 16px; color: #98a2b3; }
.report-value { color: #17243a; font-size: 30px; letter-spacing: -.04em; }
.report-empty { font-size: 12px; }
.report-widget-table, .report-widget-line, .report-widget-bar { grid-column: span 2; }
.report-header { min-width: 0; }
`,
    "app.js": `(() => {
  const widgetNodes = document.querySelectorAll("[data-widget-content]");
  widgetNodes.forEach((node) => {
    const valueNode = node.querySelector(".js-report-value");
    const emptyNode = node.querySelector(".js-report-empty");
    if (valueNode) valueNode.textContent = "待接入";
    if (emptyNode) emptyNode.textContent = "请在 server.js 中返回组件可直接使用的数据";
  });
})();
`,
  };
}

function safeInline(value: string, closingTag: string) {
  return value.replace(new RegExp(`</${closingTag}`, "gi"), `<\\/${closingTag}`);
}

function buildRuntimeHelperScript() {
  return `(() => {
    const pending = new Map();
    const bridgeReadyWaiters = [];
    const runtimeErrors = [];
    let bridgeReady = false;
    let bridgeReadyTimer = null;
    const reportContext = window.__DATATALK_REPORT_CONTEXT__ && typeof window.__DATATALK_REPORT_CONTEXT__ === "object"
      ? window.__DATATALK_REPORT_CONTEXT__
      : {};
    const initialFilters = reportContext && typeof reportContext.filters === "object" && !Array.isArray(reportContext.filters)
      ? reportContext.filters
      : {};
    const urlFilters = reportContext && typeof reportContext.urlFilters === "object" && !Array.isArray(reportContext.urlFilters)
      ? reportContext.urlFilters
      : {};
    const defaultFilters = reportContext && typeof reportContext.defaults === "object" && !Array.isArray(reportContext.defaults)
      ? reportContext.defaults
      : {};
    function sameFilterValue(left, right) {
      if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && JSON.stringify(left) === JSON.stringify(right);
      }
      return Object.is(left, right);
    }
    function resolveQueryFilters(filters) {
      const queryFilters = filters && typeof filters === "object" && !Array.isArray(filters) ? filters : {};
      const resolved = { ...initialFilters, ...queryFilters };
      for (const [key, value] of Object.entries(urlFilters)) {
        const hasQueryValue = Object.prototype.hasOwnProperty.call(queryFilters, key);
        if (!hasQueryValue || sameFilterValue(queryFilters[key], defaultFilters[key])) resolved[key] = value;
      }
      return resolved;
    }
    function nextRequestId() {
      return "rt_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    }
    function recordRuntimeError(kind, value, source) {
      const message = value instanceof Error
        ? value.message
        : typeof value === "string"
          ? value
          : value && typeof value.message === "string"
            ? value.message
            : String(value || "未知运行时错误");
      const stack = value instanceof Error && typeof value.stack === "string" ? value.stack : undefined;
      runtimeErrors.push({
        kind,
        message: message.slice(0, 1000),
        ...(stack ? { stack: stack.slice(0, 2000) } : {}),
        ...(source ? { source: String(source).slice(0, 500) } : {}),
        at: new Date().toISOString(),
      });
      if (runtimeErrors.length > 20) runtimeErrors.splice(0, runtimeErrors.length - 20);
    }
    window.addEventListener("error", (event) => {
      recordRuntimeError("error", event.error || event.message, event.filename ? String(event.filename) + ":" + (event.lineno || 0) + ":" + (event.colno || 0) : undefined);
    });
    window.addEventListener("unhandledrejection", (event) => {
      recordRuntimeError("unhandledrejection", event.reason);
    });
    function announceBridgeReady() {
      if (bridgeReady || !window.parent || window.parent === window) return;
      window.parent.postMessage({ type: "__DATATALK_RUNTIME_READY__" }, "*");
      if (bridgeReadyTimer) return;
      bridgeReadyTimer = window.setTimeout(() => {
        bridgeReadyTimer = null;
        announceBridgeReady();
      }, 100);
    }
    function markBridgeReady() {
      if (bridgeReady) return;
      bridgeReady = true;
      if (bridgeReadyTimer) window.clearTimeout(bridgeReadyTimer);
      bridgeReadyTimer = null;
      bridgeReadyWaiters.splice(0).forEach((send) => send());
    }
    function sendQuery(requestId, dataId, filters) {
      window.parent.postMessage({
        type: "__DATATALK_RUNTIME_QUERY__",
        requestId,
        dataId,
        filters: resolveQueryFilters(filters),
      }, "*");
    }
    let html2CanvasPromise = null;
    const captureDataUrlLimit = 4 * 1024 * 1024;
    function loadHtml2Canvas() {
      if (typeof window.html2canvas === "function") return Promise.resolve(window.html2canvas);
      if (html2CanvasPromise) return html2CanvasPromise;
      html2CanvasPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector("script[data-datatalk-html2canvas]");
        if (existing) {
          existing.addEventListener("load", () => typeof window.html2canvas === "function" ? resolve(window.html2canvas) : reject(new Error("REPORT_CAPTURE_LIBRARY_INVALID")), { once: true });
          existing.addEventListener("error", () => reject(new Error("REPORT_CAPTURE_LIBRARY_UNAVAILABLE")), { once: true });
          return;
        }
        const script = document.createElement("script");
        script.setAttribute("data-datatalk-html2canvas", "true");
        script.src = "/api/report-capture-library";
        script.async = true;
        script.addEventListener("load", () => typeof window.html2canvas === "function" ? resolve(window.html2canvas) : reject(new Error("REPORT_CAPTURE_LIBRARY_INVALID")), { once: true });
        script.addEventListener("error", () => reject(new Error("REPORT_CAPTURE_LIBRARY_UNAVAILABLE")), { once: true });
        document.head.appendChild(script);
      }).catch((error) => {
        html2CanvasPromise = null;
        throw error;
      });
      return html2CanvasPromise;
    }
    function waitForPaint(delay = 0) {
      return new Promise((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.setTimeout(resolve, delay)));
      });
    }
    function canvasVisualFingerprint() {
      return Array.from(document.querySelectorAll("canvas")).map((canvas) => {
        const dimensions = canvas.width + "x" + canvas.height;
        if (!canvas.width || !canvas.height) return dimensions;
        try {
          const probe = document.createElement("canvas");
          probe.width = 32;
          probe.height = 32;
          const context = probe.getContext("2d");
          if (!context) return dimensions;
          context.drawImage(canvas, 0, 0, probe.width, probe.height);
          return dimensions + ":" + probe.toDataURL("image/png");
        } catch {
          return dimensions;
        }
      }).join("|");
    }
    async function waitForCanvasStability() {
      if (!document.querySelector("canvas")) return;
      const deadline = Date.now() + 1800;
      let previous = canvasVisualFingerprint();
      let stablePasses = 0;
      while (Date.now() < deadline && stablePasses < 2) {
        await waitForPaint(120);
        const current = canvasVisualFingerprint();
        stablePasses = current === previous ? stablePasses + 1 : 0;
        previous = current;
      }
    }
    function captureStringFingerprint(value) {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16);
    }
    function reportVisualFingerprint() {
      const body = document.body;
      const visibleText = (body?.innerText || "").replace(/\\s+/g, " ").slice(0, 50000);
      const svgEvidence = Array.from(document.querySelectorAll("svg")).map((svg) => {
        const paths = Array.from(svg.querySelectorAll("path")).slice(0, 250).map((path) => path.getAttribute("d") || "").join("|");
        return svg.childElementCount + ":" + svg.innerHTML.length + ":" + paths;
      }).join(";");
      return [
        document.readyState,
        pending.size,
        body?.getElementsByTagName("*").length || 0,
        body?.scrollWidth || 0,
        body?.scrollHeight || 0,
        captureStringFingerprint(visibleText),
        captureStringFingerprint(svgEvidence),
        canvasVisualFingerprint(),
      ].join("|");
    }
    async function waitForReportStability() {
      const deadline = Date.now() + 12000;
      let previous = "";
      let stableSince = 0;
      while (Date.now() < deadline) {
        await waitForPaint(140);
        const current = reportVisualFingerprint();
        const ready = document.readyState === "complete" && pending.size === 0;
        if (ready && current === previous) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= 900) return;
        } else {
          stableSince = 0;
        }
        previous = current;
      }
    }
    async function waitForCaptureAssets() {
      const fontReady = document.fonts?.ready?.catch(() => undefined) || Promise.resolve();
      const imageReady = Promise.all(Array.from(document.images).map((image) => {
        if (image.complete) return image.decode?.().catch(() => undefined) || Promise.resolve();
        return new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            image.removeEventListener("load", finish);
            image.removeEventListener("error", finish);
            resolve();
          };
          image.addEventListener("load", finish, { once: true });
          image.addEventListener("error", finish, { once: true });
          window.setTimeout(finish, 5000);
        });
      }));
      await Promise.race([
        Promise.all([fontReady, imageReady]),
        new Promise((resolve) => window.setTimeout(resolve, 5000)),
      ]);
      await waitForReportStability();
      await waitForCanvasStability();
    }
    function resizeCaptureDataUrl(canvas, dataUrl) {
      if (dataUrl.length <= captureDataUrlLimit) return dataUrl;
      let scale = 0.85;
      let current = dataUrl;
      while (current.length > captureDataUrlLimit && scale >= 0.25) {
        const resized = document.createElement("canvas");
        resized.width = Math.max(1, Math.floor(canvas.width * scale));
        resized.height = Math.max(1, Math.floor(canvas.height * scale));
        const context = resized.getContext("2d");
        if (!context) break;
        context.drawImage(canvas, 0, 0, resized.width, resized.height);
        current = resized.toDataURL("image/png");
        scale -= 0.1;
      }
      if (current.length > captureDataUrlLimit) throw new Error("REPORT_CAPTURE_DATA_TOO_LARGE");
      return current;
    }
    function removeCaptureContainers() {
      document.querySelectorAll("iframe.html2canvas-container").forEach((element) => element.remove());
    }
    function canAccessTemporaryFrameDocument() {
      try {
        return window.location.origin !== "null";
      } catch {
        return false;
      }
    }
    function copyComputedStyle(source, target) {
      const computedStyle = window.getComputedStyle(source);
      for (let index = 0; index < computedStyle.length; index += 1) {
        const property = computedStyle[index];
        target.style.setProperty(property, computedStyle.getPropertyValue(property), computedStyle.getPropertyPriority(property));
      }
    }
    const captureStyleProperties = [
      "position", "inset", "left", "top", "right", "bottom", "z-index",
      "display", "visibility", "opacity", "box-sizing", "width", "height", "min-width", "min-height", "max-width", "max-height",
      "margin", "padding", "overflow", "overflow-x", "overflow-y",
      "align-items", "align-content", "align-self", "justify-content", "justify-items", "justify-self",
      "flex", "flex-basis", "flex-direction", "flex-grow", "flex-shrink", "flex-wrap", "order", "gap", "row-gap", "column-gap",
      "grid", "grid-area", "grid-template", "grid-template-areas", "grid-template-columns", "grid-template-rows",
      "background-color", "background-position", "background-repeat", "background-size",
      "border", "border-width", "border-style", "border-color", "border-radius", "outline", "outline-offset", "box-shadow",
      "color", "font-family", "font-size", "font-style", "font-weight", "line-height", "letter-spacing",
      "text-align", "text-decoration", "text-overflow", "text-transform", "white-space", "word-break", "overflow-wrap",
      "transform", "transform-origin", "object-fit", "object-position", "clip-path", "filter",
    ];
    function copyCaptureComputedStyle(source, target) {
      const computedStyle = window.getComputedStyle(source);
      captureStyleProperties.forEach((property) => {
        const value = computedStyle.getPropertyValue(property);
        if (value) target.style.setProperty(property, value, computedStyle.getPropertyPriority(property));
      });
      const backgroundImage = computedStyle.getPropertyValue("background-image");
      if (backgroundImage && !backgroundImage.includes("url(")) target.style.setProperty("background-image", backgroundImage);
    }
    function captureImageReferences(value) {
      if (typeof value !== "string") return [];
      const references = [];
      const pattern = /url\\(\\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\\s*\\)/gi;
      let match;
      while ((match = pattern.exec(value))) {
        const url = (match[1] || match[2] || match[3] || "").trim();
        if (/^(?:data:image\\/|blob:|https?:\\/\\/)/i.test(url)) references.push({ token: match[0], url });
      }
      return references;
    }
    function captureImageUrl(value) {
      return captureImageReferences(value)[0]?.url || "";
    }
    function loadCaptureImage(dataUrl) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        if (/^https?:\\/\\//i.test(dataUrl)) image.crossOrigin = "anonymous";
        let settled = false;
        const finish = (result, error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          if (error) reject(error);
          else resolve(result);
        };
        image.onload = () => finish(image);
        image.onerror = () => finish(null, new Error("REPORT_CAPTURE_IMAGE_DECODE_FAILED"));
        const timeoutId = window.setTimeout(() => finish(null, new Error("REPORT_CAPTURE_IMAGE_DECODE_FAILED")), 8000);
        image.src = dataUrl;
      });
    }
    async function compactCaptureImage(sourceUrl, width, height, scale) {
      if (/^data:image\\//i.test(sourceUrl) && sourceUrl.length < 256 * 1024) return sourceUrl;
      const image = await loadCaptureImage(sourceUrl);
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));
      const imageScale = Math.min(1, targetWidth / image.naturalWidth, targetHeight / image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * imageScale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * imageScale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("REPORT_CAPTURE_CANVAS_UNAVAILABLE");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const compacted = canvas.toDataURL("image/webp", 0.82);
      return /^data:image\\//i.test(sourceUrl) && compacted.length >= sourceUrl.length ? sourceUrl : compacted;
    }
    async function cloneReportRootForSvg(sourceRoot, crop, scale) {
      const clonedRoot = sourceRoot.cloneNode(true);
      const sourceCanvases = Array.from(sourceRoot.querySelectorAll("canvas"));
      const clonedCanvases = Array.from(clonedRoot.querySelectorAll("canvas"));
      const rootRect = sourceRoot.getBoundingClientRect();
      sourceCanvases.forEach((canvas, index) => {
        const clonedCanvas = clonedCanvases[index];
        if (!clonedCanvas || typeof canvas.toDataURL !== "function") return;
        const rect = canvas.getBoundingClientRect();
        if (rect.right <= rootRect.left + crop.x || rect.left >= rootRect.left + crop.x + crop.width
          || rect.bottom <= rootRect.top + crop.y || rect.top >= rootRect.top + crop.y + crop.height) return;
        try {
          const image = document.createElement("img");
          Array.from(canvas.attributes).forEach((attribute) => {
            if (attribute.name === "width" || attribute.name === "height" || attribute.name === "style") return;
            image.setAttribute(attribute.name, attribute.value);
          });
          if (scale < 1) {
            const bitmap = document.createElement("canvas");
            bitmap.width = Math.max(1, Math.round(canvas.width * scale));
            bitmap.height = Math.max(1, Math.round(canvas.height * scale));
            const context = bitmap.getContext("2d");
            if (!context) throw new Error("REPORT_CAPTURE_CANVAS_UNAVAILABLE");
            context.drawImage(canvas, 0, 0, bitmap.width, bitmap.height);
            image.src = bitmap.toDataURL("image/png");
          } else {
            image.src = canvas.toDataURL("image/png");
          }
          image.width = canvas.width;
          image.height = canvas.height;
          copyComputedStyle(canvas, image);
          clonedCanvas.replaceWith(image);
        } catch {
          // Keep the cloned canvas when its bitmap cannot be read.
        }
      });
      const sourceElements = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll("*"))];
      const clonedElements = [clonedRoot, ...Array.from(clonedRoot.querySelectorAll("*"))];
      for (let index = 0; index < sourceElements.length; index += 1) {
        const sourceElement = sourceElements[index];
        const clonedElement = clonedElements[index];
        if (!clonedElement?.style || typeof sourceElement?.getBoundingClientRect !== "function") continue;
        copyCaptureComputedStyle(sourceElement, clonedElement);
        const rect = sourceElement.getBoundingClientRect();
        const visibleInCrop = rect.right > rootRect.left + crop.x && rect.left < rootRect.left + crop.x + crop.width
          && rect.bottom > rootRect.top + crop.y && rect.top < rootRect.top + crop.y + crop.height;
        const sourceBackgroundImage = window.getComputedStyle(sourceElement).backgroundImage;
        const backgroundImages = captureImageReferences(sourceBackgroundImage);
        if (backgroundImages.length) {
          let capturedBackgroundImage = sourceBackgroundImage;
          for (const backgroundImage of backgroundImages) {
            let replacement = "none";
            if (visibleInCrop) {
              try {
                const compacted = await compactCaptureImage(backgroundImage.url, rect.width, rect.height, scale);
                replacement = 'url("' + compacted + '")';
              } catch {}
            }
            capturedBackgroundImage = capturedBackgroundImage.replace(backgroundImage.token, replacement);
          }
          clonedElement.style.setProperty("background-image", capturedBackgroundImage, "important");
        }
        if (sourceElement.tagName === "IMG") {
          const sourceUrl = typeof sourceElement.currentSrc === "string" && sourceElement.currentSrc
            ? sourceElement.currentSrc
            : typeof sourceElement.src === "string" ? sourceElement.src : "";
          clonedElement.removeAttribute("src");
          clonedElement.removeAttribute("srcset");
          if (sourceUrl && visibleInCrop) {
            try {
              clonedElement.setAttribute("src", await compactCaptureImage(sourceUrl, rect.width, rect.height, scale));
            } catch {}
          }
        }
        if (sourceElement.tagName === "SOURCE") clonedElement.removeAttribute("srcset");
      }
      clonedRoot.querySelectorAll("script, iframe, [data-datatalk-report-scroll-spacer]").forEach((element) => element.remove());
      return clonedRoot;
    }
    function captureReportPreviewWithSvg(sourceRoot, sourceWidth, sourceHeight, crop, scale = 1) {
      const outputWidth = Math.max(1, Math.round(crop.width * scale));
      const outputHeight = Math.max(1, Math.round(crop.height * scale));
      return cloneReportRootForSvg(sourceRoot, crop, scale).then(async (clonedRoot) => {
        return await new Promise((resolve, reject) => {
        const styleNode = document.createElement("style");
        styleNode.textContent = "*{animation:none!important;transition:none!important;}";
        const serializer = new XMLSerializer();
        const serializedStyles = serializer.serializeToString(styleNode);
        const serializedRoot = serializer.serializeToString(clonedRoot);
        const svg = '<?xml version="1.0" encoding="UTF-8"?>'
          + '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + outputWidth + '" height="' + outputHeight + '" viewBox="0 0 ' + outputWidth + ' ' + outputHeight + '">'
          + '<foreignObject x="' + (-crop.x * scale) + '" y="' + (-crop.y * scale) + '" width="' + (sourceWidth * scale) + '" height="' + (sourceHeight * scale) + '">'
          + '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + (sourceWidth * scale) + 'px;height:' + (sourceHeight * scale) + 'px;overflow:hidden;">'
          + '<div style="width:' + sourceWidth + 'px;height:' + sourceHeight + 'px;transform:scale(' + scale + ');transform-origin:top left;">'
          + serializedStyles
          + serializedRoot
          + '</div></div></foreignObject></svg>';
        const image = new Image();
        const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        let settled = false;
        let triedDataUrl = false;
        const cleanup = () => {
          window.clearTimeout(timeoutId);
          URL.revokeObjectURL(svgUrl);
        };
        const fail = (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };
        const retryWithDataUrl = () => {
          if (triedDataUrl) return false;
          triedDataUrl = true;
          image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
          return true;
        };
        image.onload = () => {
          if (settled) return;
          try {
            const canvas = document.createElement("canvas");
            canvas.width = outputWidth;
            canvas.height = outputHeight;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("REPORT_CAPTURE_CANVAS_UNAVAILABLE");
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const dataUrl = resizeCaptureDataUrl(canvas, canvas.toDataURL("image/png"));
            settled = true;
            cleanup();
            resolve({ dataUrl, width: canvas.width, height: canvas.height });
          } catch (error) {
            if (error?.name === "SecurityError") {
              if (retryWithDataUrl()) return;
              fail(new Error("REPORT_CAPTURE_CANVAS_TAINTED"));
              return;
            }
            fail(error);
          }
        };
        image.onerror = () => {
          if (retryWithDataUrl()) return;
          fail(new Error("REPORT_CAPTURE_SVG_RENDER_FAILED"));
        };
        const timeoutId = window.setTimeout(() => fail(new Error("REPORT_CAPTURE_SVG_RENDER_TIMEOUT")), 15000);
        image.src = svgUrl;
        });
      });
    }
    function captureFallbackColor(backgroundImage) {
      if (!backgroundImage || !backgroundImage.includes("gradient(")) return "";
      return backgroundImage.match(/#[0-9a-f]{3,8}\\b/i)?.[0]
        || backgroundImage.match(/rgba?\([^)]*\)/i)?.[0]
        || "";
    }
    function drawCaptureImageCover(context, image, x, y, width, height) {
      const sourceRatio = image.naturalWidth / image.naturalHeight;
      const targetRatio = width / height;
      let sourceX = 0;
      let sourceY = 0;
      let sourceWidth = image.naturalWidth;
      let sourceHeight = image.naturalHeight;
      if (sourceRatio > targetRatio) {
        sourceWidth = image.naturalHeight * targetRatio;
        sourceX = (image.naturalWidth - sourceWidth) / 2;
      } else if (sourceRatio < targetRatio) {
        sourceHeight = image.naturalWidth / targetRatio;
        sourceY = (image.naturalHeight - sourceHeight) / 2;
      }
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
    }
    async function captureReportPreviewWithCanvas(sourceRoot, crop, scale = 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(crop.width * scale));
      canvas.height = Math.max(1, Math.round(crop.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("REPORT_CAPTURE_CANVAS_UNAVAILABLE");
      const rootRect = sourceRoot.getBoundingClientRect();
      const elements = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll("*"))].filter((element) => {
        if (!(element instanceof Element) || !isVisible(element)) return false;
        const rect = element.getBoundingClientRect();
        return rect.right > rootRect.left + crop.x && rect.left < rootRect.left + crop.x + crop.width
          && rect.bottom > rootRect.top + crop.y && rect.top < rootRect.top + crop.y + crop.height;
      });
      const rasterImages = new Map();
      const svgImages = new Map();
      await Promise.all(elements.map(async (element) => {
        const style = window.getComputedStyle(element);
        const backgroundUrl = captureImageUrl(style.backgroundImage);
        const elementUrl = element.tagName === "IMG" && typeof (element.currentSrc || element.src) === "string"
          ? element.currentSrc || element.src : "";
        const imageUrl = backgroundUrl || elementUrl;
        if (!imageUrl) return;
        try {
          rasterImages.set(element, await loadCaptureImage(imageUrl));
        } catch {}
      }));
      await Promise.all(elements.map(async (element) => {
        if (element.tagName?.toLowerCase() !== "svg" || element.parentElement?.closest("svg")) return;
        try {
          const serialized = new XMLSerializer().serializeToString(element);
          svgImages.set(element, await loadCaptureImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(serialized)));
        } catch {}
      }));
      const coordinate = (value, origin, offset) => (value - origin - offset) * scale;
      for (const element of elements) {
        const ownerSvg = element.closest?.("svg");
        if (ownerSvg && ownerSvg !== element) continue;
        const rect = element.getBoundingClientRect();
        const x = coordinate(rect.left, rootRect.left, crop.x);
        const y = coordinate(rect.top, rootRect.top, crop.y);
        const width = rect.width * scale;
        const height = rect.height * scale;
        if (width <= 0 || height <= 0) continue;
        const style = window.getComputedStyle(element);
        const backgroundColor = style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent"
          ? style.backgroundColor : captureFallbackColor(style.backgroundImage);
        if (backgroundColor) {
          context.fillStyle = backgroundColor;
          context.fillRect(x, y, width, height);
        }
        const rasterImage = rasterImages.get(element);
        if (rasterImage) {
          try {
            drawCaptureImageCover(context, rasterImage, x, y, width, height);
          } catch {}
        }
        const svgImage = svgImages.get(element);
        if (svgImage) {
          try {
            context.drawImage(svgImage, x, y, width, height);
          } catch {}
        }
        if (element.tagName === "CANVAS" && typeof element.toDataURL === "function") {
          try {
            element.toDataURL("image/png");
            context.drawImage(element, x, y, width, height);
          } catch {}
        }
        const borderWidth = Math.max(
          Number.parseFloat(style.borderTopWidth) || 0,
          Number.parseFloat(style.borderRightWidth) || 0,
          Number.parseFloat(style.borderBottomWidth) || 0,
          Number.parseFloat(style.borderLeftWidth) || 0,
        ) * scale;
        if (borderWidth > 0 && style.borderTopStyle !== "none") {
          context.strokeStyle = style.borderTopColor || style.color || "#000000";
          context.lineWidth = borderWidth;
          context.strokeRect(x + borderWidth / 2, y + borderWidth / 2, Math.max(0, width - borderWidth), Math.max(0, height - borderWidth));
        }
        const directText = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || "")
          .join(" ")
          .replace(/\\s+/g, " ")
          .trim();
        if (!directText || style.color === "rgba(0, 0, 0, 0)" || style.fontSize === "0px") continue;
        const fontSize = Math.max(1, (Number.parseFloat(style.fontSize) || 16) * scale);
        const lineHeight = Math.max(fontSize, (Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) || 16) * scale);
        context.fillStyle = style.color || "#000000";
        context.font = [style.fontStyle, style.fontWeight, fontSize + "px", style.fontFamily || "sans-serif"].filter(Boolean).join(" ");
        context.textBaseline = "alphabetic";
        let textX = x;
        if (style.textAlign === "center") {
          context.textAlign = "center";
          textX = x + width / 2;
        } else if (style.textAlign === "right" || style.textAlign === "end") {
          context.textAlign = "right";
          textX = x + width;
        } else {
          context.textAlign = "left";
        }
        context.fillText(directText, textX, y + Math.max(fontSize, (lineHeight - fontSize) / 2 + fontSize * 0.84), width);
      }
      const dataUrl = resizeCaptureDataUrl(canvas, canvas.toDataURL("image/png"));
      return { dataUrl, width: canvas.width, height: canvas.height };
    }
    function resolvePreviewElement(selector, sourceRoot = getReportContentRoot()) {
      const normalizedSelector = typeof selector === "string" ? selector.trim() : "";
      if (!normalizedSelector || normalizedSelector.length > 500) throw new Error("REPORT_CAPTURE_TARGET_INVALID");
      let target;
      try {
        target = sourceRoot instanceof Element && sourceRoot.matches(normalizedSelector)
          ? sourceRoot
          : sourceRoot instanceof Element
            ? sourceRoot.querySelector(normalizedSelector)
            : null;
      } catch {
        throw new Error("REPORT_CAPTURE_TARGET_INVALID");
      }
      if (!(target instanceof Element) || !(sourceRoot instanceof Element) || (target !== sourceRoot && !sourceRoot.contains(target))) {
        throw new Error("REPORT_CAPTURE_TARGET_NOT_FOUND");
      }
      if (!isVisible(target)) throw new Error("REPORT_CAPTURE_TARGET_HIDDEN");
      return target;
    }
    async function captureReportPreview(mode = "thumbnail", selector = "", requestedScale = 1) {
      const body = document.body;
      if (!body) throw new Error("REPORT_CAPTURE_DOCUMENT_UNAVAILABLE");
      const contentRoot = getReportContentRoot();
      if (!(contentRoot instanceof HTMLElement)) throw new Error("REPORT_CAPTURE_ROOT_UNAVAILABLE");
      const captureRoot = body;
      const targetElement = mode === "element" ? resolvePreviewElement(selector, contentRoot) : null;
      const numericScale = Number(requestedScale);
      const captureScale = Number.isFinite(numericScale)
        ? Math.max(0.1, Math.min(1, numericScale))
        : 1;

      const transformTarget = reportZoomTarget instanceof HTMLElement ? reportZoomTarget : null;
      const restoreTransform = Boolean(transformTarget && (reportZoom !== 1 || reportScrollLeft !== 0 || reportScrollTop !== 0));
      const previousTransform = transformTarget?.style.getPropertyValue("transform") || "";
      const previousTransformPriority = transformTarget?.style.getPropertyPriority("transform") || "";
      const previousTransformOrigin = transformTarget?.style.getPropertyValue("transform-origin") || "";
      const previousTransformOriginPriority = transformTarget?.style.getPropertyPriority("transform-origin") || "";
      if (restoreTransform) transformTarget.style.setProperty("transform", "none", "important");
      try {
        removeCaptureContainers();
        await waitForCaptureAssets();
        const rootRect = captureRoot.getBoundingClientRect();
        const rootWidth = Math.max(captureRoot.scrollWidth || 0, captureRoot.clientWidth || 0, Math.ceil(rootRect.width || 0));
        const rootHeight = Math.max(captureRoot.scrollHeight || 0, captureRoot.clientHeight || 0, Math.ceil(rootRect.height || 0));
        if (!rootWidth || !rootHeight) throw new Error("REPORT_CAPTURE_ROOT_EMPTY");
        const cropHeight = mode === "full" || mode === "element" ? rootHeight : Math.max(1, Math.min(rootHeight, Math.round(rootWidth * (630 / 1200))));
        const targetRect = targetElement?.getBoundingClientRect();
        const cropX = targetRect ? Math.max(0, Math.round(targetRect.left - rootRect.left)) : 0;
        const cropY = targetRect ? Math.max(0, Math.round(targetRect.top - rootRect.top)) : 0;
        const cropWidth = targetRect ? Math.max(1, Math.min(rootWidth - cropX, Math.round(targetRect.width))) : rootWidth;
        const finalCropHeight = targetRect ? Math.max(1, Math.min(rootHeight - cropY, Math.round(targetRect.height))) : cropHeight;
        const crop = { x: cropX, y: cropY, width: cropWidth, height: finalCropHeight };
        const outputScale = mode === "thumbnail" ? Math.min(captureScale, 1200 / crop.width) : captureScale;
        if (!canAccessTemporaryFrameDocument()) {
          try {
            return await captureReportPreviewWithSvg(captureRoot, rootWidth, rootHeight, crop, outputScale);
          } catch {
            return await captureReportPreviewWithCanvas(captureRoot, crop, outputScale);
          }
        }
        try {
          const html2canvas = await loadHtml2Canvas();
          const canvas = await html2canvas(captureRoot, {
            backgroundColor: null,
            width: crop.width,
            height: crop.height,
            x: crop.x,
            y: crop.y,
            scale: outputScale,
            useCORS: true,
            allowTaint: false,
            imageTimeout: 5000,
            logging: false,
            scrollX: 0,
            scrollY: 0,
            windowWidth: rootWidth,
            windowHeight: rootHeight,
            ignoreElements: (element) => element.tagName === "IFRAME",
          });
          const dataUrl = resizeCaptureDataUrl(canvas, canvas.toDataURL("image/png"));
          return { dataUrl, width: canvas.width, height: canvas.height };
        } catch (error) {
          try {
            return await captureReportPreviewWithSvg(captureRoot, rootWidth, rootHeight, crop, outputScale);
          } catch {
            return await captureReportPreviewWithCanvas(captureRoot, crop, outputScale);
          }
        } finally {
          removeCaptureContainers();
        }
      } finally {
        if (restoreTransform && transformTarget) {
          if (previousTransform) transformTarget.style.setProperty("transform", previousTransform, previousTransformPriority);
          else transformTarget.style.removeProperty("transform");
          if (previousTransformOrigin) transformTarget.style.setProperty("transform-origin", previousTransformOrigin, previousTransformOriginPriority);
          else transformTarget.style.removeProperty("transform-origin");
        }
      }
    }
    function isVisible(element) {
      if (!(element instanceof Element)) return false;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    function countVisible(selector) {
      return Array.from(document.querySelectorAll(selector)).filter(isVisible).length;
    }
    function visibleText(selector, limit = 400) {
      return Array.from(document.querySelectorAll(selector))
        .filter(isVisible)
        .map((element) => (element.textContent || "").replace(/\\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 10)
        .join(" | ")
        .slice(0, limit);
    }
    function previewElementSelector(element) {
      if (!(element instanceof Element)) return "";
      if (element.id) {
        const selector = "[id=" + JSON.stringify(element.id) + "]";
        try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
      }
      for (const attribute of ["data-screenshot-target", "data-widget-id", "data-widget", "data-chart", "data-chart-type", "data-pencil-name", "data-testid", "aria-label"]) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        const selector = element.tagName.toLowerCase() + "[" + attribute + "=" + JSON.stringify(value) + "]";
        try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
      }

      const parts = [];
      let current = element;
      while (current instanceof Element && current !== document.documentElement) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((candidate) => candidate.tagName === current.tagName);
          if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
        }
        parts.unshift(part);
        const selector = parts.join(" > ");
        try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
        current = parent;
      }
      return parts.join(" > ");
    }
    function describePreviewElement(selector, sourceRoot = getReportContentRoot()) {
      const element = resolvePreviewElement(selector, sourceRoot);
      const elementRect = element.getBoundingClientRect();
      const scrollingElement = document.scrollingElement || document.documentElement;
      return {
        selector: previewElementSelector(element) || selector,
        tag: element.tagName.toLowerCase(),
        text: (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240),
        rect: {
          left: Math.round(elementRect.left + (scrollingElement?.scrollLeft || window.scrollX || 0)),
          top: Math.round(elementRect.top + (scrollingElement?.scrollTop || window.scrollY || 0)),
          width: Math.round(elementRect.width),
          height: Math.round(elementRect.height),
        },
      };
    }
    let elementPickerEnabled = false;
    let elementPickerSelectedSelectors = [];
    let elementPickerHoverTarget = null;
    const elementPickerOutlines = [];
    let elementPickerCursorStyle = null;
    function setElementPickerCursor(enabled) {
      if (enabled && !elementPickerCursorStyle) {
        elementPickerCursorStyle = document.createElement("style");
        elementPickerCursorStyle.setAttribute("data-datatalk-element-picker-cursor", "true");
        elementPickerCursorStyle.textContent = "html[data-datatalk-element-picker-active]:not([data-datatalk-canvas-panning]) * {cursor:crosshair !important;}";
        document.documentElement.appendChild(elementPickerCursorStyle);
      }
      document.documentElement.toggleAttribute("data-datatalk-element-picker-active", enabled);
    }
    function elementPickerTarget(target) {
      const contentRoot = getReportContentRoot();
      if (!(target instanceof Element) || !(contentRoot instanceof Element) || !contentRoot.contains(target)) return null;
      const preferred = target.closest("[data-screenshot-target], [data-widget-id], [data-widget], [data-chart], [data-pencil-name], article, section, table, h1, h2, h3, button, input, select");
      return preferred && contentRoot.contains(preferred) ? preferred : target;
    }
    function drawElementPickerOutline(target, index, hover = false) {
      if (!(target instanceof Element) || !isVisible(target)) return false;
      if (!elementPickerOutlines[index]) {
        const outline = document.createElement("div");
        outline.setAttribute("data-datatalk-element-picker-outline", "true");
        outline.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;box-shadow:0 0 0 1px rgba(255,255,255,0.85);";
        document.documentElement.appendChild(outline);
        elementPickerOutlines[index] = outline;
      }
      const rect = target.getBoundingClientRect();
      const outline = elementPickerOutlines[index];
      outline.style.display = "block";
      outline.style.border = hover ? "2px dashed #0e9384" : "2px solid #2167e8";
      outline.style.background = hover ? "rgba(14,147,132,0.10)" : "rgba(33,103,232,0.08)";
      outline.style.left = rect.left + "px";
      outline.style.top = rect.top + "px";
      outline.style.width = rect.width + "px";
      outline.style.height = rect.height + "px";
      return true;
    }
    function refreshElementPickerOutline() {
      let count = 0;
      const selectedTargets = [];
      for (const selector of elementPickerSelectedSelectors) {
        try {
          const target = resolvePreviewElement(selector);
          if (drawElementPickerOutline(target, count)) {
            selectedTargets.push(target);
            count += 1;
          }
        } catch {}
      }
      if (elementPickerEnabled && elementPickerHoverTarget?.isConnected && !selectedTargets.includes(elementPickerHoverTarget)) {
        if (drawElementPickerOutline(elementPickerHoverTarget, count, true)) count += 1;
      }
      for (let index = count; index < elementPickerOutlines.length; index += 1) elementPickerOutlines[index].style.display = "none";
    }
    function selectReportElement(target) {
      const contentRoot = getReportContentRoot();
      let element = elementPickerTarget(target);
      let selector = "";
      while (element instanceof Element && contentRoot instanceof Element && contentRoot.contains(element)) {
        selector = previewElementSelector(element);
        if (selector && selector.length <= 500) break;
        element = element.parentElement;
      }
      if (!selector || selector.length > 500) return false;
      const selected = describePreviewElement(selector);
      if (!elementPickerSelectedSelectors.includes(selected.selector)) elementPickerSelectedSelectors.push(selected.selector);
      elementPickerHoverTarget = null;
      refreshElementPickerOutline();
      window.parent.postMessage({
        type: "__DATATALK_ELEMENT_SELECTED__",
        target: {
          selector: selected.selector,
          tag: selected.tag,
          text: selected.text,
          workspaceFingerprint: typeof reportContext.workspaceFingerprint === "string" ? reportContext.workspaceFingerprint : "",
        },
      }, "*");
      return true;
    }
    document.addEventListener("pointermove", (event) => {
      if (!elementPickerEnabled || fixedCanvasSpacePressed || fixedCanvasPanPointerId !== null) return;
      elementPickerHoverTarget = elementPickerTarget(event.target);
      refreshElementPickerOutline();
    }, true);
    document.addEventListener("pointerleave", () => {
      if (!elementPickerEnabled) return;
      elementPickerHoverTarget = null;
      refreshElementPickerOutline();
    }, true);
    window.addEventListener("pointerout", (event) => {
      if (!elementPickerEnabled || event.relatedTarget) return;
      elementPickerHoverTarget = null;
      refreshElementPickerOutline();
    }, true);
    document.addEventListener("pointerdown", (event) => {
      if (!elementPickerEnabled || event.button !== 0 || fixedCanvasSpacePressed) return;
      if (!elementPickerTarget(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    document.addEventListener("click", (event) => {
      if (!elementPickerEnabled || event.button !== 0 || fixedCanvasSpacePressed) return;
      if (!elementPickerTarget(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      selectReportElement(event.target);
    }, true);
    document.addEventListener("keydown", (event) => {
      if (!elementPickerEnabled) return;
      if (event.key === "Escape") {
        elementPickerEnabled = false;
        elementPickerHoverTarget = null;
        setElementPickerCursor(false);
        refreshElementPickerOutline();
        window.parent.postMessage({ type: "__DATATALK_ELEMENT_PICKER_CANCEL__" }, "*");
      } else if (event.key === "Enter" && elementPickerTarget(document.activeElement)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        selectReportElement(document.activeElement);
      }
    }, true);
    document.addEventListener("scroll", refreshElementPickerOutline, true);
    window.addEventListener("resize", refreshElementPickerOutline);
    function listPreviewElements(sourceRoot) {
      if (!(sourceRoot instanceof Element)) return [];
      const candidates = Array.from(sourceRoot.querySelectorAll([
        "[data-screenshot-target]",
        "[data-widget-id]",
        "[data-widget]",
        "[data-chart]",
        "[data-chart-type]",
        "[data-pencil-name]",
        ".report-widget",
        ".chart",
        ".chart-container",
        ".report-chart",
        "article",
        "section",
        "table",
        "h1",
        "h2",
        "h3",
      ].join(",")));
      const largeNamedPanels = candidates.filter((element) => {
        if (!element.hasAttribute("data-pencil-name") || !isVisible(element)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width >= 180 && rect.height >= 96;
      });
      const orderedCandidates = [...largeNamedPanels, ...candidates];
      const seen = new Set();
      const elements = [];
      for (const element of orderedCandidates) {
        if (elements.length >= 60 || !isVisible(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 48 || rect.height < 24) continue;
        const selector = previewElementSelector(element);
        if (!selector || seen.has(selector)) continue;
        seen.add(selector);
        elements.push(describePreviewElement(selector, sourceRoot));
      }
      return elements;
    }
    function collectLayoutEvidence(sourceRoot) {
      if (!(sourceRoot instanceof Element)) return { coordinateSpace: "report-design-px", zoom: reportZoom, elements: [], peerGaps: [], coverage: { sampled: 0, candidates: 0, limit: 100, truncated: false } };
      const rootRect = sourceRoot.getBoundingClientRect();
      const zoom = reportZoom > 0 ? reportZoom : 1;
      const selector = [
        "[data-screenshot-target]", "[data-widget-id]", "[data-widget]", "[data-chart]",
        "[data-pencil-name]", ".report-widget", "article", "section", "table",
        "h1", "h2", "h3", "p", "button", "input", "select",
        "[data-filter-key]", ".report-value", "[data-kpi]", "[data-metric]",
      ].join(",");
      const candidates = [sourceRoot, ...sourceRoot.querySelectorAll(selector)].filter(isVisible);
      const seen = new Set();
      const elements = [];
      for (const element of candidates) {
        if (elements.length >= 100) break;
        const elementSelector = previewElementSelector(element);
        if (!elementSelector || seen.has(elementSelector)) continue;
        seen.add(elementSelector);
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const parent = element.parentElement;
        const parentSelector = parent && sourceRoot.contains(parent) ? previewElementSelector(parent) : null;
        const box = {
          left: Math.round((rect.left - rootRect.left) / zoom),
          top: Math.round((rect.top - rootRect.top) / zoom),
          width: Math.round(rect.width / zoom),
          height: Math.round(rect.height / zoom),
        };
        const leafText = element.children.length === 0 && (element.textContent || "").trim();
        elements.push({
          selector: elementSelector,
          parentSelector,
          tag: element.tagName.toLowerCase(),
          text: (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120),
          box,
          style: {
            display: style.display, position: style.position, fontSize: style.fontSize,
            lineHeight: style.lineHeight, fontWeight: style.fontWeight,
            padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
            gap: style.gap, overflowX: style.overflowX, overflowY: style.overflowY,
            whiteSpace: style.whiteSpace,
          },
          ...(leafText && element instanceof HTMLElement ? {
            textFit: {
              clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
              clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
              possibleClipping: (style.overflowX === "hidden" || style.overflowX === "clip") && element.scrollWidth > element.clientWidth + 1
                || (style.overflowY === "hidden" || style.overflowY === "clip") && element.scrollHeight > element.clientHeight + 1,
            },
          } : {}),
        });
      }
      const peerGaps = [];
      for (let index = 0; index < elements.length; index += 1) {
        const first = elements[index];
        if (!first.parentSelector) continue;
        for (let next = index + 1; next < elements.length; next += 1) {
          const second = elements[next];
          if (second.parentSelector !== first.parentSelector) continue;
          const horizontalOverlap = Math.min(first.box.left + first.box.width, second.box.left + second.box.width) - Math.max(first.box.left, second.box.left);
          const verticalOverlap = Math.min(first.box.top + first.box.height, second.box.top + second.box.height) - Math.max(first.box.top, second.box.top);
          const axis = verticalOverlap > 0 && horizontalOverlap <= 0 ? "horizontal" : horizontalOverlap > 0 && verticalOverlap <= 0 ? "vertical" : null;
          if (!axis) continue;
          const earlier = axis === "horizontal"
            ? first.box.left < second.box.left ? first : second
            : first.box.top < second.box.top ? first : second;
          const later = earlier === first ? second : first;
          const between = elements.some((peer) => {
            if (peer === first || peer === second || peer.parentSelector !== first.parentSelector) return false;
            if (axis === "horizontal") {
              return peer.box.left >= earlier.box.left + earlier.box.width
                && peer.box.left + peer.box.width <= later.box.left
                && Math.min(peer.box.top + peer.box.height, first.box.top + first.box.height, second.box.top + second.box.height)
                  > Math.max(peer.box.top, first.box.top, second.box.top);
            }
            return peer.box.top >= earlier.box.top + earlier.box.height
              && peer.box.top + peer.box.height <= later.box.top
              && Math.min(peer.box.left + peer.box.width, first.box.left + first.box.width, second.box.left + second.box.width)
                > Math.max(peer.box.left, first.box.left, second.box.left);
          });
          if (between) continue;
          const gap = axis === "horizontal"
            ? Math.max(first.box.left, second.box.left) - Math.min(first.box.left + first.box.width, second.box.left + second.box.width)
            : Math.max(first.box.top, second.box.top) - Math.min(first.box.top + first.box.height, second.box.top + second.box.height);
          peerGaps.push({ parentSelector: first.parentSelector, first: first.selector, second: second.selector, axis, gap });
          if (peerGaps.length >= 80) break;
        }
        if (peerGaps.length >= 80) break;
      }
      return {
        coordinateSpace: "report-design-px",
        zoom,
        elements,
        peerGaps,
        coverage: { sampled: elements.length, candidates: candidates.length, limit: 100, truncated: candidates.length > elements.length },
      };
    }
    function compactImageSource(value) {
      const source = String(value || "");
      if (/^data:/i.test(source)) return source.slice(0, source.indexOf(";") > 0 ? source.indexOf(";") : 40);
      return source.slice(0, 500);
    }
    function inspectImageAssets(rootElement) {
      const imageElements = Array.from(document.images).slice(0, 100);
      const images = imageElements.map((image) => ({
        selector: previewElementSelector(image),
        source: compactImageSource(image.currentSrc || image.getAttribute("src") || ""),
        status: !image.complete ? "pending" : image.naturalWidth > 0 ? "loaded" : "failed",
        naturalWidth: image.naturalWidth || 0,
        naturalHeight: image.naturalHeight || 0,
      }));
      const backgroundItems = [];
      const candidates = rootElement instanceof Element ? [rootElement, ...Array.from(rootElement.querySelectorAll("*"))] : [];
      for (const element of candidates.slice(0, 2000)) {
        const backgroundImage = getComputedStyle(element).backgroundImage;
        if (!backgroundImage || backgroundImage === "none") continue;
        backgroundItems.push({
          selector: previewElementSelector(element),
          source: compactImageSource(backgroundImage),
          status: /(?:datatalk-asset:\\/\\/|(?:^|[\\s"'(])\\.?\\/?assets\\/)/i.test(backgroundImage) ? "unresolved" : "resolved",
        });
        if (backgroundItems.length >= 100) break;
      }
      return {
        images: {
          declared: images.length,
          loaded: images.filter((item) => item.status === "loaded").length,
          failed: images.filter((item) => item.status === "failed").length,
          pending: images.filter((item) => item.status === "pending").length,
          items: images,
        },
        backgrounds: {
          declared: backgroundItems.length,
          unresolved: backgroundItems.filter((item) => item.status === "unresolved").length,
          items: backgroundItems,
        },
      };
    }
    async function waitForPreviewImages() {
      const pending = Array.from(document.images).filter((image) => !image.complete).slice(0, 100);
      if (!pending.length) return;
      const settled = Promise.allSettled(pending.map((image) => typeof image.decode === "function"
        ? image.decode()
        : new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        })));
      await Promise.race([settled, new Promise((resolve) => window.setTimeout(resolve, 3000))]);
    }
    function inspectPreview(screenshotSelector = "") {
      const documentElement = document.documentElement;
      const body = document.body;
      const root = document.querySelector("[data-report-root]");
      const rootElement = root instanceof HTMLElement ? root : getReportContentRoot();
      const rootRect = rootElement?.getBoundingClientRect();
      const documentWidth = Math.max(documentElement?.scrollWidth || 0, body?.scrollWidth || 0, documentElement?.clientWidth || 0, body?.clientWidth || 0);
      const documentHeight = Math.max(documentElement?.scrollHeight || 0, body?.scrollHeight || 0, documentElement?.clientHeight || 0, body?.clientHeight || 0);
      const rootWidth = Math.max(rootElement?.scrollWidth || 0, rootElement?.clientWidth || 0, Math.round(rootRect?.width || 0));
      const rootHeight = Math.max(rootElement?.scrollHeight || 0, rootElement?.clientHeight || 0, Math.round(rootRect?.height || 0));
      const text = (body?.innerText || "").replace(/\\s+/g, " ").trim();
      return {
        title: document.title,
        url: window.location.href,
        workspaceFingerprint: typeof reportContext.workspaceFingerprint === "string" ? reportContext.workspaceFingerprint : "",
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
        },
        document: {
          width: documentWidth,
          height: documentHeight,
          horizontalOverflow: documentWidth > (documentElement?.clientWidth || window.innerWidth) + 1,
          verticalOverflow: documentHeight > (documentElement?.clientHeight || window.innerHeight) + 1,
        },
        root: {
          selector: root ? "[data-report-root]" : rootElement === body ? "body" : previewElementSelector(rootElement),
          width: rootWidth,
          height: rootHeight,
          ...(rootRect ? { left: Math.round(rootRect.left), top: Math.round(rootRect.top), right: Math.round(rootRect.right), bottom: Math.round(rootRect.bottom) } : {}),
        },
        visibleText: text.slice(0, 6000),
        counts: {
          headings: countVisible("h1, h2, h3, h4, h5, h6"),
          filters: countVisible("[data-filter-key], [data-filter], .report-filter, input, select, [role=combobox]"),
          widgets: countVisible("[data-widget-id], [data-widget], .report-widget"),
          charts: countVisible("[data-chart], [data-chart-type], .chart, .chart-container, .report-chart"),
          svg: countVisible("svg"),
          canvas: countVisible("canvas"),
          tables: countVisible("table"),
        },
        states: {
          emptyCount: countVisible("[data-empty], .empty, .empty-state, .report-empty, [class*=empty]"),
          loadingCount: countVisible("[data-loading], .loading, .loading-state, [aria-busy=true], [class*=loading]"),
          errorCount: countVisible("[data-error], .error, .error-state, [role=alert], [class*=error]"),
          emptyText: visibleText("[data-empty], .empty, .empty-state, .report-empty, [class*=empty]"),
          loadingText: visibleText("[data-loading], .loading, .loading-state, [aria-busy=true], [class*=loading]"),
          errorText: visibleText("[data-error], .error, .error-state, [role=alert], [class*=error]"),
        },
        elements: listPreviewElements(rootElement),
        layoutEvidence: collectLayoutEvidence(rootElement),
        imageAssets: inspectImageAssets(rootElement),
        ...(screenshotSelector ? { target: describePreviewElement(screenshotSelector, rootElement) } : {}),
        runtimeErrors: runtimeErrors.slice(-20),
      };
    }
    let reportSizeAnimationFrame = null;
    let reportSize = { width: 0, height: 0 };
    let reportZoom = 1;
    let reportZoomTarget = null;
    let originalReportTransform = null;
    let originalReportTransformOrigin = null;
    let originalHorizontalOverflow = null;
    let reportScrollViewport = null;
    let reportScrollSpacer = null;
    let reportScrollLeft = 0;
    let reportScrollTop = 0;
    let fixedCanvas = false;
    let originalFixedCanvasOverflow = null;
    let originalFixedCanvasContentWidth = null;
    let fixedCanvasContentWidth = null;
    let fixedCanvasSpacePressed = false;
    let fixedCanvasPanPointerId = null;
    let fixedCanvasOriginalCursor = null;
    function getReportContentRoot() {
      const explicitRoot = document.querySelector("[data-report-root], #report-root, .report-page, main");
      if (explicitRoot) return explicitRoot;

      const body = document.body;
      if (!body) return document.documentElement;
      const fallbackRoot = Array.from(body.children).find((element) => {
        const tagName = element.tagName.toLowerCase();
        if (["script", "style", "link", "meta"].includes(tagName)) return false;
        if (element.hasAttribute("data-datatalk-report-scroll-spacer") || element.hasAttribute("data-datatalk-report-scroll-viewport")) return false;
        const computed = window.getComputedStyle(element);
        if (computed.display === "none" || computed.visibility === "hidden") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0 || element.scrollWidth > 0 || element.scrollHeight > 0;
      });
      return fallbackRoot || body;
    }
    function lockFixedCanvasContentWidth(contentRoot) {
      const body = document.body;
      if (!fixedCanvas || !body || !contentRoot || contentRoot === body) return;
      const rect = contentRoot.getBoundingClientRect();
      const measuredWidth = Math.ceil(Math.max(contentRoot.scrollWidth || 0, contentRoot.clientWidth || 0, rect.width || 0));
      if (!measuredWidth) return;
      if (!originalFixedCanvasContentWidth) {
        originalFixedCanvasContentWidth = {
          value: contentRoot.style.getPropertyValue("width"),
          priority: contentRoot.style.getPropertyPriority("width"),
          target: contentRoot,
        };
      }
      if (fixedCanvasContentWidth === null || measuredWidth > fixedCanvasContentWidth + 1) {
        fixedCanvasContentWidth = measuredWidth;
        contentRoot.style.setProperty("width", fixedCanvasContentWidth + "px", "important");
      }
    }
    function applyReportTransform() {
      const contentRoot = reportZoomTarget;
      if (!contentRoot) return;
      if (reportZoom === 1 && reportScrollLeft === 0 && reportScrollTop === 0) {
        if (originalReportTransform?.value) contentRoot.style.setProperty("transform", originalReportTransform.value, originalReportTransform.priority);
        else contentRoot.style.removeProperty("transform");
        if (originalReportTransformOrigin?.value) contentRoot.style.setProperty("transform-origin", originalReportTransformOrigin.value, originalReportTransformOrigin.priority);
        else contentRoot.style.removeProperty("transform-origin");
        return;
      }
      const contentOffsetX = reportZoom > 0 ? reportScrollLeft / reportZoom : reportScrollLeft;
      const contentOffsetY = reportZoom > 0 ? reportScrollTop / reportZoom : reportScrollTop;
      contentRoot.style.setProperty("transform", "scale(" + reportZoom + ") translate(" + (-contentOffsetX) + "px, " + (-contentOffsetY) + "px)", "important");
      contentRoot.style.setProperty("transform-origin", "top left", "important");
    }
    function measureReportContentSize() {
      const documentElement = document.documentElement;
      const body = document.body;
      if (!documentElement || !body || !window.parent || window.parent === window) return null;

      const contentRoot = getReportContentRoot();
      const hasTransform = reportZoomTarget && (reportZoom !== 1 || reportScrollLeft !== 0 || reportScrollTop !== 0);
      const spacerDisplay = reportScrollSpacer?.style.display;
      if (reportScrollSpacer) reportScrollSpacer.style.display = "none";
      if (hasTransform) reportZoomTarget.style.setProperty("transform", "none", "important");
      lockFixedCanvasContentWidth(contentRoot);
      const rootRect = contentRoot.getBoundingClientRect();
      const rootWidth = Math.max(contentRoot.scrollWidth || 0, contentRoot.clientWidth || 0, Math.ceil(rootRect.width || 0));
      const viewportWidth = Math.max(documentElement.clientWidth || 0, body.clientWidth || 0, window.innerWidth || 0);
      const width = Math.ceil(rootWidth || viewportWidth);
      const height = Math.ceil(Math.max(documentElement.scrollHeight || 0, body.scrollHeight || 0, contentRoot.scrollHeight || 0, Math.ceil(rootRect.height || 0)));
      if (hasTransform) applyReportTransform();
      if (reportScrollSpacer) reportScrollSpacer.style.display = spacerDisplay || "";
      return width > 0 && height > 0 ? { width, height } : null;
    }
    function ensureReportScrollViewport() {
      if (reportScrollViewport || !document.body) return reportScrollViewport;
      const contentRoot = getReportContentRoot();
      if (!contentRoot || contentRoot === document.body) return null;
      const rootRect = contentRoot.getBoundingClientRect();
      const rootWidth = Math.max(contentRoot.clientWidth || 0, Math.ceil(rootRect.width || 0));
      if (!rootWidth) return null;
      const viewport = document.createElement("div");
      viewport.setAttribute("data-datatalk-report-scroll-viewport", "true");
      viewport.style.setProperty("position", "fixed", "important");
      viewport.style.setProperty("inset", "0", "important");
      viewport.style.setProperty("width", "100vw", "important");
      viewport.style.setProperty("height", "100vh", "important");
      viewport.style.setProperty("overflow", "hidden", "important");
      viewport.style.setProperty("box-sizing", "border-box", "important");
      viewport.style.setProperty("margin", "0", "important");
      viewport.style.setProperty("padding", "0", "important");
      viewport.style.setProperty("border", "0", "important");
      document.body.appendChild(viewport);
      viewport.appendChild(contentRoot);
      contentRoot.style.setProperty("width", rootWidth + "px", "important");
      document.documentElement.style.setProperty("width", "100%", "important");
      document.documentElement.style.setProperty("overflow", "hidden", "important");
      document.body.style.setProperty("width", "100%", "important");
      document.body.style.setProperty("overflow", "hidden", "important");
      reportScrollViewport = viewport;
      if (reportScrollSpacer && reportScrollSpacer.parentElement !== reportScrollViewport) {
        reportScrollViewport.insertBefore(reportScrollSpacer, contentRoot);
      } else if (reportScrollSpacer && reportScrollSpacer.nextSibling !== contentRoot) {
        reportScrollViewport.insertBefore(reportScrollSpacer, contentRoot);
      }
      reportScrollViewport.addEventListener("wheel", (event) => {
        const deltaX = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
        const deltaY = event.shiftKey ? 0 : event.deltaY;
        if (!deltaX && !deltaY) return;
        event.preventDefault();
        setReportScroll(reportScrollLeft + deltaX, reportScrollTop + deltaY);
        announceReportScroll();
      }, { passive: false });
      return reportScrollViewport;
    }
    function setReportScrollWidth(rawWidth, rawHeight) {
      const body = document.body;
      const documentElement = document.documentElement;
      const numericWidth = Number(rawWidth);
      const numericHeight = Number(rawHeight);
      if (!body || !documentElement || !Number.isFinite(numericWidth) || numericWidth <= 0) return;
      if (!reportScrollSpacer) {
        reportScrollSpacer = document.createElement("div");
        reportScrollSpacer.setAttribute("aria-hidden", "true");
        reportScrollSpacer.setAttribute("data-datatalk-report-scroll-spacer", "true");
        reportScrollSpacer.style.setProperty("display", "block", "important");
        reportScrollSpacer.style.setProperty("position", "absolute", "important");
        reportScrollSpacer.style.setProperty("left", "0", "important");
        reportScrollSpacer.style.setProperty("top", "0", "important");
        reportScrollSpacer.style.setProperty("height", "1px", "important");
        reportScrollSpacer.style.setProperty("flex", "none", "important");
        reportScrollSpacer.style.setProperty("margin", "0", "important");
        reportScrollSpacer.style.setProperty("padding", "0", "important");
        reportScrollSpacer.style.setProperty("border", "0", "important");
        reportScrollSpacer.style.setProperty("visibility", "hidden", "important");
        reportScrollSpacer.style.setProperty("pointer-events", "none", "important");
        const host = reportScrollViewport || body;
        const contentRoot = getReportContentRoot();
        if (reportScrollViewport && contentRoot.parentElement === host) host.insertBefore(reportScrollSpacer, contentRoot);
        else host.appendChild(reportScrollSpacer);
      }
      const visualWidth = Math.max(documentElement.clientWidth || window.innerWidth || 0, Math.ceil(numericWidth * reportZoom));
      const contentHeight = Number.isFinite(numericHeight) && numericHeight > 0
        ? numericHeight
        : Math.max(documentElement.scrollHeight || 0, body.scrollHeight || 0, window.innerHeight || 0);
      const visualHeight = Math.max(documentElement.clientHeight || window.innerHeight || 0, Math.ceil(contentHeight * reportZoom));
      reportScrollSpacer.style.setProperty("width", visualWidth + "px", "important");
      reportScrollSpacer.style.setProperty("height", visualHeight + "px", "important");
    }
    function announceReportSize(force = false) {
      const nextSize = measureReportContentSize();
      if (!nextSize || (!force && nextSize.width === reportSize.width && nextSize.height === reportSize.height)) return;
      reportSize = nextSize;
      setReportScrollWidth(nextSize.width, nextSize.height);
      window.parent.postMessage({ type: "__DATATALK_REPORT_SIZE__", ...nextSize }, "*");
    }
    function scheduleReportSize() {
      if (reportSizeAnimationFrame !== null) return;
      reportSizeAnimationFrame = window.requestAnimationFrame(() => {
        reportSizeAnimationFrame = null;
        announceReportSize();
      });
    }
    function startReportSizeObserver() {
      if (typeof document === "undefined" || typeof document.querySelector !== "function") return;
      announceReportSize();
      const contentRoot = getReportContentRoot();
      const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleReportSize);
      [document.documentElement, document.body, contentRoot]
        .filter((element, index, elements) => Boolean(element) && elements.indexOf(element) === index)
        .forEach((element) => resizeObserver?.observe(element));
      const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(scheduleReportSize);
      mutationObserver?.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
      window.addEventListener("resize", scheduleReportSize);
      [0, 100, 300, 700, 1500].forEach((delay) => window.setTimeout(scheduleReportSize, delay));
    }
    function announceReportScroll() {
      const scrollingElement = reportScrollViewport || document.scrollingElement || document.documentElement;
      const currentLeft = reportScrollViewport ? reportScrollLeft : scrollingElement?.scrollLeft || window.scrollX || 0;
      const currentTop = reportScrollViewport ? reportScrollTop : scrollingElement?.scrollTop || window.scrollY || 0;
      const left = Math.max(0, Number(currentLeft));
      const top = Math.max(0, Number(currentTop));
      window.parent.postMessage({ type: "__DATATALK_REPORT_SCROLL__", left, top }, "*");
    }
    function setReportScroll(rawLeft, rawTop) {
      const documentElement = document.documentElement;
      const scrollingElement = reportScrollViewport || document.scrollingElement || documentElement;
      const numericLeft = Number(rawLeft);
      const numericTop = typeof rawTop === "number" ? rawTop : reportScrollTop;
      if (!documentElement || !scrollingElement || !Number.isFinite(numericLeft) || !Number.isFinite(numericTop)) return;
      const maxLeft = Math.max(0, scrollingElement.scrollWidth - scrollingElement.clientWidth);
      const maxTop = Math.max(0, scrollingElement.scrollHeight - scrollingElement.clientHeight);
      const left = Math.max(0, Math.min(maxLeft, numericLeft));
      const top = Math.max(0, Math.min(maxTop, numericTop));
      if (reportScrollViewport) {
        reportScrollLeft = left;
        reportScrollTop = top;
        applyReportTransform();
        return;
      }
      if (Math.abs(scrollingElement.scrollLeft - left) > 1 || Math.abs(scrollingElement.scrollTop - top) > 1) scrollingElement.scrollTo({ left, top });
      if (!reportScrollViewport && Math.abs(documentElement.scrollLeft - left) > 1) documentElement.scrollLeft = left;
      if (!reportScrollViewport && Math.abs(documentElement.scrollTop - top) > 1) documentElement.scrollTop = top;
    }
    function setHorizontalOverflow(hidden, mode = "restore") {
      const documentElement = document.documentElement;
      const body = document.body;
      if (!documentElement || !body) return;
      if (hidden) {
        if (!originalHorizontalOverflow) {
          originalHorizontalOverflow = {
            document: {
              value: documentElement.style.getPropertyValue("overflow-x"),
              priority: documentElement.style.getPropertyPriority("overflow-x"),
            },
            body: {
              value: body.style.getPropertyValue("overflow-x"),
              priority: body.style.getPropertyPriority("overflow-x"),
            },
          };
        }
        documentElement.style.setProperty("overflow-x", "hidden", "important");
        body.style.setProperty("overflow-x", "hidden", "important");
        return;
      }
      if (mode === "auto") {
        if (reportScrollViewport) {
          documentElement.style.setProperty("overflow", "hidden", "important");
          body.style.setProperty("overflow", "hidden", "important");
          reportScrollViewport.style.setProperty("overflow", "hidden", "important");
          return;
        }
        if (!originalHorizontalOverflow) {
          originalHorizontalOverflow = {
            document: {
              value: documentElement.style.getPropertyValue("overflow-x"),
              priority: documentElement.style.getPropertyPriority("overflow-x"),
            },
            body: {
              value: body.style.getPropertyValue("overflow-x"),
              priority: body.style.getPropertyPriority("overflow-x"),
            },
          };
        }
        documentElement.style.setProperty("overflow-x", "auto", "important");
        body.style.setProperty("overflow-x", "visible", "important");
        return;
      }
      if (!originalHorizontalOverflow) return;
      if (originalHorizontalOverflow.document.value) documentElement.style.setProperty("overflow-x", originalHorizontalOverflow.document.value, originalHorizontalOverflow.document.priority);
      else documentElement.style.removeProperty("overflow-x");
      if (originalHorizontalOverflow.body.value) body.style.setProperty("overflow-x", originalHorizontalOverflow.body.value, originalHorizontalOverflow.body.priority);
      else body.style.removeProperty("overflow-x");
      originalHorizontalOverflow = null;
    }
    function setFixedCanvas(enabled) {
      const documentElement = document.documentElement;
      const body = document.body;
      fixedCanvas = enabled;
      if (!documentElement || !body) return;
      if (enabled) {
        if (!originalFixedCanvasOverflow) {
          originalFixedCanvasOverflow = {
            document: {
              value: documentElement.style.getPropertyValue("overflow"),
              priority: documentElement.style.getPropertyPriority("overflow"),
            },
            body: {
              value: body.style.getPropertyValue("overflow"),
              priority: body.style.getPropertyPriority("overflow"),
            },
          };
        }
        documentElement.style.setProperty("overflow", "hidden", "important");
        body.style.setProperty("overflow", "hidden", "important");
        lockFixedCanvasContentWidth(getReportContentRoot());
        return;
      }
      fixedCanvasSpacePressed = false;
      fixedCanvasPanPointerId = null;
      setFixedCanvasCursor("");
      if (!originalFixedCanvasOverflow) return;
      if (originalFixedCanvasOverflow.document.value) documentElement.style.setProperty("overflow", originalFixedCanvasOverflow.document.value, originalFixedCanvasOverflow.document.priority);
      else documentElement.style.removeProperty("overflow");
      if (originalFixedCanvasOverflow.body.value) body.style.setProperty("overflow", originalFixedCanvasOverflow.body.value, originalFixedCanvasOverflow.body.priority);
      else body.style.removeProperty("overflow");
      originalFixedCanvasOverflow = null;
      if (originalFixedCanvasContentWidth) {
        const contentRoot = originalFixedCanvasContentWidth.target;
        if (originalFixedCanvasContentWidth.value) contentRoot.style.setProperty("width", originalFixedCanvasContentWidth.value, originalFixedCanvasContentWidth.priority);
        else contentRoot.style.removeProperty("width");
      }
      originalFixedCanvasContentWidth = null;
      fixedCanvasContentWidth = null;
    }
    function setFixedCanvasCursor(cursor) {
      const documentElement = document.documentElement;
      if (!documentElement) return;
      documentElement.toggleAttribute("data-datatalk-canvas-panning", Boolean(cursor));
      if (cursor) {
        if (!fixedCanvasOriginalCursor) {
          fixedCanvasOriginalCursor = {
            value: documentElement.style.getPropertyValue("cursor"),
            priority: documentElement.style.getPropertyPriority("cursor"),
          };
        }
        documentElement.style.setProperty("cursor", cursor, "important");
        return;
      }
      if (!fixedCanvasOriginalCursor) return;
      if (fixedCanvasOriginalCursor.value) documentElement.style.setProperty("cursor", fixedCanvasOriginalCursor.value, fixedCanvasOriginalCursor.priority);
      else documentElement.style.removeProperty("cursor");
      fixedCanvasOriginalCursor = null;
    }
    function announceFixedCanvasWheel(event) {
      if (!fixedCanvas || !window.parent || window.parent === window) return;
      const deltaX = event.deltaX;
      const deltaY = event.deltaY;
      if (!deltaX && !deltaY) return;
      if (event.cancelable) event.preventDefault();
      window.parent.postMessage({ type: "__DATATALK_REPORT_WHEEL__", deltaX, deltaY, clientX: event.clientX, clientY: event.clientY, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }, "*");
    }
    function isFixedCanvasEditableTarget(target) {
      return Boolean(target && typeof target.closest === "function" && target.closest("input, textarea, select, [contenteditable='true']"));
    }
    function announceFixedCanvasPanPointer(phase, event) {
      if (!window.parent || window.parent === window) return;
      window.parent.postMessage({
        type: "__DATATALK_REPORT_PAN_POINTER__",
        phase,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      }, "*");
    }
    function handleFixedCanvasKeyDown(event) {
      if (!fixedCanvas || event.code !== "Space" || isFixedCanvasEditableTarget(event.target)) return;
      if (event.cancelable) event.preventDefault();
      fixedCanvasSpacePressed = true;
      if (fixedCanvasPanPointerId === null) setFixedCanvasCursor("grab");
    }
    function handleFixedCanvasKeyUp(event) {
      if (event.code !== "Space") return;
      fixedCanvasSpacePressed = false;
      if (fixedCanvasPanPointerId === null) setFixedCanvasCursor("");
    }
    function handleFixedCanvasPointerDown(event) {
      if (!fixedCanvas || fixedCanvasPanPointerId !== null) return;
      const shouldPan = event.button === 1 || (event.button === 0 && fixedCanvasSpacePressed);
      if (!shouldPan) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      fixedCanvasPanPointerId = event.pointerId;
      if (event.target && typeof event.target.setPointerCapture === "function") {
        try { event.target.setPointerCapture(event.pointerId); } catch {}
      }
      setFixedCanvasCursor("grabbing");
      announceFixedCanvasPanPointer("start", event);
    }
    function handleFixedCanvasPointerMove(event) {
      if (fixedCanvasPanPointerId !== event.pointerId) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      announceFixedCanvasPanPointer("move", event);
    }
    function finishFixedCanvasPointer(event) {
      if (fixedCanvasPanPointerId !== event.pointerId) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      announceFixedCanvasPanPointer("end", event);
      fixedCanvasPanPointerId = null;
      setFixedCanvasCursor(fixedCanvasSpacePressed ? "grab" : "");
    }
    function setReportZoom(value) {
      const body = document.body;
      const numericValue = Number(value);
      if (!body || !Number.isFinite(numericValue)) return;
      reportZoom = Math.max(0.1, Math.min(2, numericValue / 100));
      const contentRoot = getReportContentRoot();
      ensureReportScrollViewport();
      if (reportZoomTarget !== contentRoot) {
        if (reportZoomTarget && originalReportTransform) {
          if (originalReportTransform.value) reportZoomTarget.style.setProperty("transform", originalReportTransform.value, originalReportTransform.priority);
          else reportZoomTarget.style.removeProperty("transform");
          if (originalReportTransformOrigin.value) reportZoomTarget.style.setProperty("transform-origin", originalReportTransformOrigin.value, originalReportTransformOrigin.priority);
          else reportZoomTarget.style.removeProperty("transform-origin");
        }
        reportZoomTarget = contentRoot;
        originalReportTransform = {
          value: contentRoot.style.getPropertyValue("transform"),
          priority: contentRoot.style.getPropertyPriority("transform"),
        };
        originalReportTransformOrigin = {
          value: contentRoot.style.getPropertyValue("transform-origin"),
          priority: contentRoot.style.getPropertyPriority("transform-origin"),
        };
      }
      applyReportTransform();
      const measuredSize = measureReportContentSize();
      if (measuredSize) {
        reportSize = measuredSize;
        setReportScrollWidth(measuredSize.width, measuredSize.height);
      } else if (reportSize.width > 0) {
        setReportScrollWidth(reportSize.width, reportSize.height);
      }
      scheduleReportSize();
    }
    function isExternalLink(link) {
      const href = link.getAttribute("href")?.trim() || "";
      return /^(?:https?:|mailto:|tel:)/i.test(href) || href.startsWith("//");
    }
    function openExternalLinksInNewTab() {
      document.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.target;
        const link = target instanceof Element ? target.closest("a[href]") : null;
        if (!(link instanceof HTMLAnchorElement) || !isExternalLink(link) || link.target.toLowerCase() === "_blank") return;
        event.preventDefault();
        window.open(link.href, "_blank", "noopener,noreferrer");
      });
    }
    window.reportRuntime = {
      query(dataId, filters = {}) {
        return new Promise((resolve, reject) => {
          if (!window.parent || window.parent === window) {
            reject(new Error("REPORT_RUNTIME_BRIDGE_UNAVAILABLE"));
            return;
          }
          const requestId = nextRequestId();
          pending.set(requestId, { resolve, reject });
          const send = () => {
            if (pending.has(requestId)) sendQuery(requestId, dataId, filters);
          };
          if (bridgeReady) send();
          else {
            bridgeReadyWaiters.push(send);
            announceBridgeReady();
          }
          window.setTimeout(() => {
            const task = pending.get(requestId);
            if (!task) return;
            pending.delete(requestId);
            task.reject(new Error("REPORT_RUNTIME_TIMEOUT"));
          }, 30000);
        });
      },
    };
    window.addEventListener("message", async (event) => {
      const payload = event.data;
      if (payload?.type === "__DATATALK_RUNTIME_READY_ACK__") {
        markBridgeReady();
        announceReportSize(true);
        announceReportScroll();
        return;
      }
      if (payload?.type === "__DATATALK_SET_ELEMENT_PICKER__" && typeof payload.enabled === "boolean") {
        elementPickerEnabled = payload.enabled;
        setElementPickerCursor(elementPickerEnabled);
        elementPickerSelectedSelectors = Array.isArray(payload.selectedSelectors)
          ? [...new Set(payload.selectedSelectors.filter((selector) => typeof selector === "string" && selector.length > 0 && selector.length <= 500))]
          : [];
        elementPickerHoverTarget = null;
        refreshElementPickerOutline();
        return;
      }
      if (payload?.type === "__DATATALK_CLEAR_ELEMENT_PICKER_HOVER__") {
        if (elementPickerHoverTarget) {
          elementPickerHoverTarget = null;
          refreshElementPickerOutline();
        }
        return;
      }
      if (payload?.type === "__DATATALK_LOCATE_REQUEST__" && typeof payload.requestId === "string") {
        try {
          const target = describePreviewElement(payload.selector);
          window.parent.postMessage({ type: "__DATATALK_LOCATE_RESPONSE__", requestId: payload.requestId, ok: true, target }, "*");
        } catch (error) {
          window.parent.postMessage({
            type: "__DATATALK_LOCATE_RESPONSE__",
            requestId: payload.requestId,
            ok: false,
            error: error instanceof Error ? error.message : "REPORT_CAPTURE_TARGET_NOT_FOUND",
          }, "*");
        }
        return;
      }
      if (payload?.type === "__DATATALK_CAPTURE_REQUEST__" && typeof payload.requestId === "string") {
        try {
          const capture = await captureReportPreview(payload.screenshotMode === "full" ? "full" : "thumbnail", "", payload.screenshotScale);
          window.parent.postMessage({
            type: "__DATATALK_CAPTURE_RESPONSE__",
            requestId: payload.requestId,
            ok: Boolean(capture),
            capture,
            error: capture ? undefined : "REPORT_CAPTURE_UNAVAILABLE",
          }, "*");
        } catch (error) {
          window.parent.postMessage({
            type: "__DATATALK_CAPTURE_RESPONSE__",
            requestId: payload.requestId,
            ok: false,
            error: error instanceof Error ? error.message + (error.stack ? "\\n" + error.stack : "") : "REPORT_CAPTURE_FAILED",
          }, "*");
        }
        return;
      }
      if (payload?.type === "__DATATALK_INSPECT_REQUEST__" && typeof payload.requestId === "string") {
        try {
          const screenshotMode = payload.screenshotMode === "full" ? "full" : payload.screenshotMode === "element" ? "element" : "thumbnail";
          const screenshotSelector = typeof payload.screenshotSelector === "string" ? payload.screenshotSelector : "";
          await waitForPreviewImages();
          const inspection = inspectPreview(screenshotSelector);
          const includeScreenshot = payload.includeScreenshot === true;
          const capture = includeScreenshot ? await captureReportPreview(screenshotMode, screenshotSelector, payload.screenshotScale) : null;
          window.parent.postMessage({
            type: "__DATATALK_INSPECT_RESPONSE__",
            requestId: payload.requestId,
            ok: true,
            inspection,
            capture,
          }, "*");
        } catch (error) {
          recordRuntimeError("inspection", error);
          window.parent.postMessage({
            type: "__DATATALK_INSPECT_RESPONSE__",
            requestId: payload.requestId,
            ok: false,
            inspection: inspectPreview(),
            error: error instanceof Error ? error.message : "REPORT_PREVIEW_INSPECTION_FAILED",
          }, "*");
        }
        return;
      }
      if (payload?.type === "__DATATALK_SET_HORIZONTAL_OVERFLOW__" && typeof payload.hidden === "boolean") {
        setHorizontalOverflow(payload.hidden, payload.mode === "auto" ? "auto" : "restore");
        return;
      }
      if (payload?.type === "__DATATALK_SET_FIXED_CANVAS__" && typeof payload.enabled === "boolean") {
        setFixedCanvas(payload.enabled);
        return;
      }
      if (payload?.type === "__DATATALK_SET_REPORT_SCROLL__" && typeof payload.left === "number") {
        setReportScroll(payload.left, typeof payload.top === "number" ? payload.top : undefined);
        return;
      }
      if (payload?.type === "__DATATALK_SET_REPORT_ZOOM__" && typeof payload.zoom === "number") {
        setReportZoom(payload.zoom);
        return;
      }
      if (!payload || payload.type !== "__DATATALK_RUNTIME_RESPONSE__" || typeof payload.requestId !== "string") return;
      const task = pending.get(payload.requestId);
      if (!task) return;
      pending.delete(payload.requestId);
      if (payload.ok) task.resolve(payload.data);
      else task.reject(new Error(typeof payload.error === "string" ? payload.error : "REPORT_RUNTIME_FAILED"));
    });
    openExternalLinksInNewTab();
    document.addEventListener("wheel", announceFixedCanvasWheel, { passive: false, capture: true });
    window.addEventListener("keydown", handleFixedCanvasKeyDown, { capture: true });
    window.addEventListener("keyup", handleFixedCanvasKeyUp, { capture: true });
    window.addEventListener("blur", () => {
      if (fixedCanvasPanPointerId !== null && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "__DATATALK_REPORT_PAN_POINTER__", phase: "end", pointerId: fixedCanvasPanPointerId, clientX: 0, clientY: 0 }, "*");
      }
      fixedCanvasSpacePressed = false;
      fixedCanvasPanPointerId = null;
      setFixedCanvasCursor("");
    });
    window.addEventListener("pointerdown", handleFixedCanvasPointerDown, { capture: true });
    window.addEventListener("pointermove", handleFixedCanvasPointerMove, { capture: true });
    window.addEventListener("pointerup", finishFixedCanvasPointer, { capture: true });
    window.addEventListener("pointercancel", finishFixedCanvasPointer, { capture: true });
    window.addEventListener("auxclick", (event) => {
      if (fixedCanvas && event.button === 1 && event.cancelable) event.preventDefault();
    }, { capture: true });
    window.addEventListener("scroll", announceReportScroll, { passive: true });
    startReportSizeObserver();
    announceBridgeReady();
  })();`;
}

export function composeWebReportSrcDoc(files: WebFileMap, context?: { filters?: Record<string, unknown>; urlFilters?: Record<string, unknown>; defaults?: Record<string, unknown>; workspaceFingerprint?: string }) {
  const html = inlineWebReportAssets(files["page.html"] || "<!doctype html><html><head></head><body></body></html>", files.assets);
  const styles = safeInline(inlineWebReportAssets(files["styles.css"] || "", files.assets), "style");
  const script = safeInline(files["app.js"] || "", "script");
  const runtimeHelper = safeInline(buildRuntimeHelperScript(), "script");
  const runtimeContext = safeInline(`window.__DATATALK_REPORT_CONTEXT__=${JSON.stringify({ filters: context?.filters || {}, urlFilters: context?.urlFilters || {}, defaults: context?.defaults || {}, workspaceFingerprint: context?.workspaceFingerprint || "" })};`, "script");
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'self' http: https:; img-src data: blob: http: https:; font-src data: https:;">`;
  const styleTag = `<style>${styles}</style>`;
  const runtimeTag = `<script>${runtimeContext}${runtimeHelper}${script}</script>`;
  const withHead = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${csp}${styleTag}</head>`) : `${csp}${styleTag}${html}`;
  return /<\/body>/i.test(withHead) ? withHead.replace(/<\/body>/i, `${runtimeTag}</body>`) : `${withHead}${runtimeTag}`;
}

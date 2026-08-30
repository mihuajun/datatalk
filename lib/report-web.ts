import type { ReportDefinition } from "@/lib/report-types";

export type WebFileMap = Partial<Record<"page.html" | "styles.css" | "app.js", string>>;

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

export function toWebReportFiles(definition: ReportDefinition): Required<WebFileMap> {
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
.report-page { max-width: 1120px; margin: 0 auto; padding: 40px; }
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
@media (max-width: 720px) {
  .report-page { padding: 18px; }
  .report-header { padding: 22px; flex-direction: column; }
  .report-grid { grid-template-columns: 1fr; }
  .report-widget-table, .report-widget-line, .report-widget-bar { grid-column: auto; }
}
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
    window.addEventListener("message", (event) => {
      const payload = event.data;
      if (payload?.type === "__DATATALK_RUNTIME_READY_ACK__") {
        markBridgeReady();
        return;
      }
      if (!payload || payload.type !== "__DATATALK_RUNTIME_RESPONSE__" || typeof payload.requestId !== "string") return;
      const task = pending.get(payload.requestId);
      if (!task) return;
      pending.delete(payload.requestId);
      if (payload.ok) task.resolve(payload.data);
      else task.reject(new Error(typeof payload.error === "string" ? payload.error : "REPORT_RUNTIME_FAILED"));
    });
    announceBridgeReady();
  })();`;
}

export function composeWebReportSrcDoc(files: WebFileMap, context?: { filters?: Record<string, unknown>; urlFilters?: Record<string, unknown>; defaults?: Record<string, unknown> }) {
  const html = files["page.html"] || "<!doctype html><html><head></head><body></body></html>";
  const styles = safeInline(files["styles.css"] || "", "style");
  const script = safeInline(files["app.js"] || "", "script");
  const runtimeHelper = safeInline(buildRuntimeHelperScript(), "script");
  const runtimeContext = safeInline(`window.__DATATALK_REPORT_CONTEXT__=${JSON.stringify({ filters: context?.filters || {}, urlFilters: context?.urlFilters || {}, defaults: context?.defaults || {} })};`, "script");
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'self' https:; img-src data: https:; font-src data: https:;">`;
  const styleTag = `<style>${styles}</style>`;
  const runtimeTag = `<script>${runtimeContext}${runtimeHelper}${script}</script>`;
  const withHead = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${csp}${styleTag}</head>`) : `${csp}${styleTag}${html}`;
  return /<\/body>/i.test(withHead) ? withHead.replace(/<\/body>/i, `${runtimeTag}</body>`) : `${withHead}${runtimeTag}`;
}

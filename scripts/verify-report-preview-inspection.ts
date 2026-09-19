import assert from "node:assert/strict";
import vm from "node:vm";

import { composeWebReportSrcDoc } from "@/lib/report-web";

import {
  registerReportPreviewClient,
  requestReportPreviewInspection,
  resolveReportPreviewInspection,
  type ReportPreviewInspectionRequest,
  type ReportPreviewInspectionResult,
} from "@/lib/server/report-preview-inspection-bridge";
import { getReportAgentToolsBaseUrl } from "@/lib/server/agent-runtime";

const tenantId = 2147483647;
const userId = 1;
const reportCode = "preview-inspection-contract-test";

function verifyLayoutMeasurements() {
  const source = composeWebReportSrcDoc({ "page.html": "<!doctype html><html><body><main data-report-root></main></body></html>" });
  const script = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
  assert.ok(script);
  const start = script.indexOf("function collectLayoutEvidence(");
  const end = script.indexOf("function inspectPreview(", start);
  assert.ok(start >= 0 && end > start);

  class TestElement {
    children: TestElement[] = [];
    parentElement: TestElement | null = null;
    textContent = "";
    clientWidth = 0;
    scrollWidth = 0;
    clientHeight = 0;
    scrollHeight = 0;
    constructor(
      readonly selector: string,
      readonly tagName: string,
      readonly rect: { left: number; top: number; width: number; height: number },
      readonly style: Record<string, string> = {},
    ) {}
    getBoundingClientRect() { return this.rect; }
    querySelectorAll() { return this.children; }
    contains(element: TestElement) { return this === element || this.children.includes(element); }
  }
  class TestHtmlElement extends TestElement {}
  const root = new TestHtmlElement("main", "MAIN", { left: 20, top: 10, width: 900, height: 320 });
  const heading = new TestHtmlElement("h1", "H1", { left: 38, top: 34, width: 300, height: 31.5 }, {
    fontSize: "32px", lineHeight: "42px", overflowX: "hidden", overflowY: "visible",
  });
  heading.textContent = "经营总览";
  heading.clientWidth = 400;
  heading.scrollWidth = 410;
  heading.clientHeight = heading.scrollHeight = 42;
  const panels = [38, 203, 391].map((left, index) => new TestHtmlElement(
    `section${index + 1}`, "SECTION", { left, top: 100, width: 150, height: 100 }, { overflowX: "visible", overflowY: "visible" },
  ));
  root.children = [heading, ...panels];
  root.children.forEach((element) => { element.parentElement = root; });
  type Evidence = {
    coordinateSpace: string;
    elements: Array<{ selector: string; box: { left: number; top: number; width: number; height: number }; textFit?: { possibleClipping: boolean } }>;
    peerGaps: Array<{ first: string; second: string; axis: string; gap: number }>;
    coverage: { truncated: boolean };
  };
  const measure = () => vm.runInNewContext(`(() => { ${script.slice(start, end)} return collectLayoutEvidence(root); })()`, {
    root,
    Element: TestElement,
    HTMLElement: TestHtmlElement,
    reportZoom: 0.75,
    window: { getComputedStyle: (element: TestElement) => element.style },
    isVisible: () => true,
    previewElementSelector: (element: TestElement) => element.selector,
  }) as Evidence;
  const evidence = measure();
  assert.equal(evidence.coordinateSpace, "report-design-px");
  assert.deepEqual({ ...evidence.elements.find((element) => element.selector === "h1")?.box }, { left: 24, top: 32, width: 400, height: 42 });
  assert.equal(evidence.elements.find((element) => element.selector === "h1")?.textFit?.possibleClipping, true);
  assert.equal(evidence.peerGaps.find((gap) => gap.first === "section1" && gap.second === "section2")?.gap, 20);
  assert.equal(evidence.peerGaps.some((gap) => gap.first === "section1" && gap.second === "section3"), false);
  assert.equal(evidence.coverage.truncated, false);

  heading.style.overflowX = "visible";
  assert.equal(measure().elements.find((element) => element.selector === "h1")?.textFit?.possibleClipping, false);
  const additional = Array.from({ length: 101 }, (_, index) => new TestHtmlElement(
    `panel${index}`, "SECTION", { left: 38, top: 230 + index * 110, width: 150, height: 100 },
  ));
  root.children.push(...additional);
  additional.forEach((element) => { element.parentElement = root; });
  const capped = measure();
  assert.equal(capped.elements.length, 100);
  assert.equal(capped.coverage.truncated, true);
}

function verifyReportAgentToolsBaseUrl() {
  const previousExplicitBaseUrl = process.env.REPORT_AGENT_TOOLS_BASE_URL;
  const previousPort = process.env.PORT;
  try {
    delete process.env.REPORT_AGENT_TOOLS_BASE_URL;
    delete process.env.PORT;
    assert.equal(getReportAgentToolsBaseUrl(), "http://localhost:3001");

    process.env.PORT = "4100";
    assert.equal(getReportAgentToolsBaseUrl(), "http://127.0.0.1:4100");

    process.env.REPORT_AGENT_TOOLS_BASE_URL = "http://runtime-host:4200/";
    assert.equal(getReportAgentToolsBaseUrl(), "http://runtime-host:4200");
  } finally {
    if (previousExplicitBaseUrl === undefined) delete process.env.REPORT_AGENT_TOOLS_BASE_URL;
    else process.env.REPORT_AGENT_TOOLS_BASE_URL = previousExplicitBaseUrl;
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
  }
}

async function inspectWithResponse(resultFor: (request: ReportPreviewInspectionRequest) => ReportPreviewInspectionResult) {
  const dshSessionId = `test-${Math.random().toString(16).slice(2)}`;
  let responseError: Error | null = null;
  const unregister = registerReportPreviewClient({
    dshSessionId,
    tenantId,
    userId,
    reportCode,
    send: (_type, payload) => {
      const request = payload as ReportPreviewInspectionRequest;
      void resolveReportPreviewInspection({
        requestId: request.requestId,
        dshSessionId,
        tenantId,
        userId,
        reportCode,
        result: resultFor(request),
      }).catch((error) => { responseError = error; });
    },
  });
  try {
    const result = await requestReportPreviewInspection({ dshSessionId, tenantId, userId, reportCode, includeScreenshot: true });
    if (responseError) throw responseError;
    return result;
  } finally {
    unregister();
  }
}

async function main() {
  verifyReportAgentToolsBaseUrl();
  verifyLayoutMeasurements();
  const checkedAt = new Date().toISOString();
  const screenshotDataUrl = "data:image/png;base64,AA==";
  const layoutEvidence = {
    coordinateSpace: "report-design-px",
    zoom: 0.75,
    elements: [{ selector: "h1", parentSelector: "main", box: { left: 24, top: 32, width: 400, height: 42 }, style: { fontSize: "32px", lineHeight: "42px" } }],
    peerGaps: [{ parentSelector: "main", first: "h1", second: "section", axis: "vertical", gap: 24 }],
    coverage: { sampled: 2, candidates: 2, limit: 100, truncated: false },
  };
  const current = await inspectWithResponse((request) => ({
    ok: true,
    source: "working",
    checkedAt,
    screenshotDataUrl,
    inspection: { workspaceFingerprint: request.workspaceFingerprint, layoutEvidence },
    workspaceFingerprint: request.workspaceFingerprint,
  }));
  assert.equal(current.ok, true);
  assert.equal(current.screenshotDataUrl, screenshotDataUrl);
  assert.deepEqual(current.inspection?.layoutEvidence, layoutEvidence);

  const stale = await inspectWithResponse(() => ({
    ok: true,
    source: "working",
    checkedAt,
    screenshotDataUrl,
    workspaceFingerprint: "outdated-version",
  }));
  assert.equal(stale.ok, false);
  assert.equal(stale.error, "REPORT_PREVIEW_STALE_WORKSPACE");
  assert.equal(stale.screenshotDataUrl, undefined);

  const unavailable = await inspectWithResponse(() => ({
    ok: false,
    source: "working",
    checkedAt,
    error: "REPORT_PREVIEW_WORKSPACE_UNAVAILABLE",
  }));
  assert.equal(unavailable.error, "REPORT_PREVIEW_WORKSPACE_UNAVAILABLE");
  console.log("Report preview inspection version and layout contract passed");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });

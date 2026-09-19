import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { composeWebReportSrcDoc } from "@/lib/report-web";

const editor = fs.readFileSync(path.join(process.cwd(), "app/reports/editor/page.tsx"), "utf8");
assert.ok(!editor.includes("requestFrameThumbnailCapture"));
assert.ok(editor.includes("requestFramePreviewInspection(frame, {\n    includeScreenshot: true,\n    screenshotMode: \"thumbnail\",\n    screenshotScale: 1,"));
assert.ok(editor.includes("alignmentError = await alignPreviewWorkspace(expectedFingerprint)"));
assert.ok(editor.includes('firstAttempt.error !== "REPORT_PREVIEW_STALE_WORKSPACE"'));

async function verifyThumbnailNormalization() {
  const start = editor.indexOf("async function normalizeResourceThumbnail(");
  const end = editor.indexOf("async function requestResourceThumbnail(", start);
  assert.ok(start >= 0 && end > start);
  const snippet = editor.slice(start, end).replace("dataUrl: string", "dataUrl").replace("new Promise<void>", "new Promise");
  for (const [width, height, expectedHeight] of [
    [2400, 1800, 1260],
    [2400, 800, 800],
    [600, 1200, 315],
  ]) {
    const draws: unknown[][] = [];
    const fills: unknown[][] = [];
    const canvas = {
      width: 0, height: 0,
      getContext() { return { fillStyle: "", fillRect: (...args: unknown[]) => fills.push(args), drawImage: (...args: unknown[]) => draws.push(args) }; },
      toDataURL() { return "data:image/png;base64,AA=="; },
    };
    class TestImage {
      naturalWidth = width;
      naturalHeight = height;
      onload?: () => void;
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    const normalize = vm.runInNewContext(`(() => { ${snippet} return normalizeResourceThumbnail; })()`, {
      Image: TestImage,
      document: { createElement: () => canvas },
      window: { setTimeout: () => 1, clearTimeout: () => {} },
      releaseThumbnailWidth: 1200,
      releaseThumbnailHeight: 630,
      isPngDataUrl: (value: string) => value.startsWith("data:image/png;base64,"),
    }) as (dataUrl: string) => Promise<string>;
    assert.equal(await normalize("data:image/png;base64,AA=="), "data:image/png;base64,AA==");
    assert.equal(canvas.width, 1200);
    assert.equal(canvas.height, 630);
    assert.deepEqual(fills, [[0, 0, 1200, 630]]);
    assert.deepEqual(draws.map((draw) => draw.slice(1)), [[0, 0, width, expectedHeight, 0, 0, 1200, expectedHeight * 1200 / width]]);
  }
}

const srcDoc = composeWebReportSrcDoc({ "page.html": "<!doctype html><html><body><main data-report-root></main></body></html>" });
const script = [...srcDoc.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert.ok(script);
const helperScript: string = script;
const start = script.indexOf("async function captureReportPreview(");
const end = script.indexOf("function isVisible(", start);
assert.ok(start >= 0 && end > start);
assert.ok(srcDoc.includes("img-src data: blob: http: https:"));
assert.ok(srcDoc.includes("captureReportPreviewWithCanvas(captureRoot, crop, outputScale)"));
assert.ok(srcDoc.includes('document.readyState === "complete" && pending.size === 0'));
assert.ok(srcDoc.includes("Date.now() - stableSince >= 900"));
assert.ok(srcDoc.includes('svgImages.set(element, await loadCaptureImage("data:image/svg+xml'));
assert.ok(srcDoc.includes('image.crossOrigin = "anonymous"'));
assert.ok(srcDoc.includes('clonedElement.style.setProperty("background-image", capturedBackgroundImage, "important")'));

class CaptureRoot {
  scrollWidth = 2400;
  clientWidth = 2400;
  scrollHeight = 1800;
  clientHeight = 1800;
  getBoundingClientRect() { return { left: 0, top: 0, width: 2400, height: 1800 }; }
}

const root = new CaptureRoot();
const captures: Array<{ crop: { width: number; height: number }; scale: number }> = [];
const canvasFallbacks: Array<{ crop: { width: number; height: number }; scale: number }> = [];
let failSvgCapture = false;
const capture = vm.runInNewContext(`(() => { ${script.slice(start, end)} return captureReportPreview; })()`, {
  document: { body: root },
  HTMLElement: CaptureRoot,
  getReportContentRoot: () => root,
  reportZoomTarget: null,
  reportZoom: 1,
  reportScrollLeft: 0,
  reportScrollTop: 0,
  removeCaptureContainers: () => {},
  waitForCaptureAssets: async () => {},
  canAccessTemporaryFrameDocument: () => false,
  captureReportPreviewWithSvg: async (_sourceRoot: unknown, _width: number, _height: number, crop: { width: number; height: number }, scale: number) => {
    if (failSvgCapture) throw new Error("REPORT_CAPTURE_SVG_RENDER_FAILED");
    captures.push({ crop, scale });
    return { dataUrl: "data:image/png;base64,AA==", width: Math.round(crop.width * scale), height: Math.round(crop.height * scale) };
  },
  captureReportPreviewWithCanvas: async (_sourceRoot: unknown, crop: { width: number; height: number }, scale: number) => {
    canvasFallbacks.push({ crop, scale });
    return { dataUrl: "data:image/png;base64,canvas", width: Math.round(crop.width * scale), height: Math.round(crop.height * scale) };
  },
}) as (mode: "thumbnail" | "full", selector?: string, scale?: number) => Promise<{ width: number; height: number }>;

async function verifyCaptureImageInlining() {
  const imageStart = helperScript.indexOf("function captureImageReferences(");
  const imageEnd = helperScript.indexOf("async function cloneReportRootForSvg(", imageStart);
  assert.ok(imageStart >= 0 && imageEnd > imageStart);

  let requestedSource = "";
  let requestedCrossOrigin = "";
  const draws: unknown[][] = [];
  class TestImage {
    naturalWidth = 1600;
    naturalHeight = 900;
    crossOrigin = "";
    onload?: () => void;
    onerror?: () => void;
    set src(value: string) {
      requestedSource = value;
      requestedCrossOrigin = this.crossOrigin;
      queueMicrotask(() => this.onload?.());
    }
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: (...args: unknown[]) => draws.push(args) }),
    toDataURL: () => "data:image/webp;base64,CAPTURED",
  };
  const helpers = vm.runInNewContext(`(() => { ${helperScript.slice(imageStart, imageEnd)} return { captureImageReferences, compactCaptureImage }; })()`, {
    Image: TestImage,
    document: { createElement: () => canvas },
    window: { setTimeout: () => 1, clearTimeout: () => {} },
  }) as {
    captureImageReferences: (value: string) => Array<{ token: string; url: string }>;
    compactCaptureImage: (source: string, width: number, height: number, scale: number) => Promise<string>;
  };

  assert.deepEqual(
    Array.from(helpers.captureImageReferences('linear-gradient(#0008,#0008), url("https://images.example.com/factory.jpg")'), (item) => ({ ...item })),
    [{ token: 'url("https://images.example.com/factory.jpg")', url: "https://images.example.com/factory.jpg" }],
  );
  assert.equal(await helpers.compactCaptureImage("https://images.example.com/factory.jpg", 800, 450, 0.5), "data:image/webp;base64,CAPTURED");
  assert.equal(requestedSource, "https://images.example.com/factory.jpg");
  assert.equal(requestedCrossOrigin, "anonymous");
  assert.equal(canvas.width, 400);
  assert.equal(canvas.height, 225);
  assert.equal(draws.length, 1);
}

async function verifySvgFallback() {
  const cloneStart = helperScript.indexOf("function copyComputedStyle(");
  const cloneEnd = helperScript.indexOf("function resolvePreviewElement(", cloneStart);
  assert.ok(cloneStart >= 0 && cloneEnd > cloneStart);

  let originalCanvasReads = 0;
  const bitmapSizes: Array<{ width: number; height: number }> = [];
  let removedScripts = 0;
  let revokedUrls = 0;
  let svgText = "";
  let failBlobLoad = false;
  let taintBlobCanvas = false;
  const imageSources: string[] = [];
  const sourceCanvases = [
    { width: 2400, height: 800, attributes: [], getBoundingClientRect: () => ({ left: 0, right: 2400, top: 20, bottom: 820 }), toDataURL: () => { originalCanvasReads += 1; return "data:image/png;base64,original"; } },
    { width: 2400, height: 800, attributes: [], getBoundingClientRect: () => ({ left: 0, right: 2400, top: 1400, bottom: 2200 }), toDataURL: () => { originalCanvasReads += 1; return "data:image/png;base64,offscreen"; } },
  ];
  const clonedCanvases = sourceCanvases.map(() => ({ replaceWith: (_image: unknown) => {} }));
  const clonedRoot = {
    querySelectorAll: (selector: string) => selector === "canvas" ? clonedCanvases : [{ remove: () => { removedScripts += 1; } }],
  };
  const sourceRoot = {
    cloneNode: () => clonedRoot,
    querySelectorAll: () => sourceCanvases,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  class TestImage {
    onload?: () => void;
    onerror?: () => void;
    style = { setProperty: () => {} };
    setAttribute() {}
    set src(value: string) {
      imageSources.push(value);
      queueMicrotask(() => value.startsWith("blob:") && failBlobLoad ? this.onerror?.() : this.onload?.());
    }
  }
  const document = {
    querySelectorAll: (selector: string) => selector === "style" ? [{ textContent: '.report[data-name="a&b"]{content:"<"}' }] : [],
    createElement: (tag: string) => tag === "style" ? { textContent: "" } : tag === "img" ? new TestImage() : {
      width: 0,
      height: 0,
      getContext() { return { drawImage: () => { bitmapSizes.push({ width: this.width, height: this.height }); } }; },
      toDataURL: () => {
        if (taintBlobCanvas && imageSources.at(-1)?.startsWith("blob:")) {
          const error = new Error("Tainted canvases may not be exported");
          error.name = "SecurityError";
          throw error;
        }
        return "data:image/png;base64,AA==";
      },
    },
  };
  const svgCapture = vm.runInNewContext(`(() => { ${helperScript.slice(cloneStart, cloneEnd)} return captureReportPreviewWithSvg; })()`, {
    document,
    window: { getComputedStyle: () => [], setTimeout: () => 1, clearTimeout: () => {} },
    XMLSerializer: class {
      serializeToString(element: { textContent?: string }) {
        return "textContent" in element
          ? `<style>${element.textContent?.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</style>`
          : '<body xmlns="http://www.w3.org/1999/xhtml" />';
      }
    },
    Image: TestImage,
    Blob: class { constructor(parts: string[]) { svgText = parts[0]; } },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => { revokedUrls += 1; } },
    resizeCaptureDataUrl: (_canvas: unknown, dataUrl: string) => dataUrl,
  }) as (root: unknown, width: number, height: number, crop: { x: number; y: number; width: number; height: number }, scale: number) => Promise<{ width: number; height: number }>;

  const result = await svgCapture(sourceRoot, 2400, 2200, { x: 0, y: 0, width: 2400, height: 1260 }, 0.5);
  assert.equal(result.width, 1200);
  assert.equal(result.height, 630);
  assert.deepEqual(bitmapSizes, [{ width: 1200, height: 400 }, { width: 1200, height: 630 }]);
  assert.equal(originalCanvasReads, 0);
  assert.equal(removedScripts, 1);
  assert.equal(revokedUrls, 1);
  assert.ok(svgText.includes("<foreignObject"));
  assert.ok(svgText.includes('width="1200" height="630" viewBox="0 0 1200 630"'));
  assert.ok(svgText.includes("transform:scale(0.5)"));
  assert.ok(svgText.includes("animation:none!important"));
  assert.ok(!svgText.includes('.report[data-name="a&amp;b"]'));

  failBlobLoad = true;
  const fallback = await svgCapture(sourceRoot, 2400, 2200, { x: 0, y: 0, width: 2400, height: 1260 }, 0.5);
  assert.equal(fallback.width, 1200);
  assert.ok(imageSources.some((value) => value.startsWith("data:image/svg+xml")));
  assert.equal(revokedUrls, 2);

  failBlobLoad = false;
  taintBlobCanvas = true;
  const taintedFallback = await svgCapture(sourceRoot, 2400, 2200, { x: 0, y: 0, width: 2400, height: 1260 }, 0.5);
  assert.equal(taintedFallback.width, 1200);
  assert.ok(imageSources.at(-1)?.startsWith("data:image/svg+xml"));
  assert.equal(revokedUrls, 3);
}

async function main() {
  const thumbnail = await capture("thumbnail");
  assert.deepEqual(thumbnail, { dataUrl: "data:image/png;base64,AA==", width: 1200, height: 630 });
  assert.equal(captures.at(-1)?.scale, 0.5);

  const smaller = await capture("thumbnail", "", 0.25);
  assert.equal(smaller.width, 600);
  assert.equal(smaller.height, 315);

  failSvgCapture = true;
  const canvasFallback = await capture("thumbnail");
  failSvgCapture = false;
  assert.deepEqual(canvasFallback, { dataUrl: "data:image/png;base64,canvas", width: 1200, height: 630 });
  assert.deepEqual({ ...canvasFallbacks.at(-1)?.crop }, { x: 0, y: 0, width: 2400, height: 1260 });
  assert.equal(canvasFallbacks.at(-1)?.scale, 0.5);

  const full = await capture("full");
  assert.equal(full.width, 2400);
  assert.equal(full.height, 1800);
  assert.equal(captures.at(-1)?.scale, 1);
  await verifyCaptureImageInlining();
  await verifySvgFallback();
  await verifyThumbnailNormalization();
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });

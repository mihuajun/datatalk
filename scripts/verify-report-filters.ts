import assert from "node:assert/strict";
import vm from "node:vm";

import {
  normalizeReportFilterManifest,
  reportFilterValuesToSearchParams,
  resolveReportFilterValues,
} from "../lib/report-filters";
import { composeWebReportSrcDoc, REPORT_FRAME_SANDBOX } from "../lib/report-web";

async function verifyRuntimeMerge() {
  const messages: Array<Record<string, unknown>> = [];
  let messageHandler: ((event: { data: unknown }) => void) | undefined;
  const parent = { postMessage(message: Record<string, unknown>) { messages.push(message); } };
  const windowObject: Record<string, any> = {
    parent,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    addEventListener(type: string, handler: (event: { data: unknown }) => void) {
      if (type === "message") messageHandler = handler;
    },
  };
  const source = composeWebReportSrcDoc(
    { "page.html": "<!doctype html><html><body></body></html>" },
    { filters: { region: "url-region" }, urlFilters: { region: "url-region" }, defaults: { region: "default-region" } },
  );
  const script = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
  assert.ok(script);
  vm.runInNewContext(script, { window: windowObject, document: { addEventListener() {} } });

  const firstQuery = windowObject.reportRuntime.query("summary", { region: "default-region" });
  messageHandler?.({ data: { type: "__DATATALK_RUNTIME_READY_ACK__" } });
  const firstRequest = messages.find((message) => message.type === "__DATATALK_RUNTIME_QUERY__") || {};
  assert.equal(JSON.stringify(firstRequest.filters), JSON.stringify({ region: "url-region" }));
  messageHandler?.({ data: { type: "__DATATALK_RUNTIME_RESPONSE__", requestId: firstRequest.requestId, ok: true, data: { ok: true } } });
  await firstQuery;

  const secondQuery = windowObject.reportRuntime.query("summary", { region: "interactive-region" });
  const secondRequest = messages.filter((message) => message.type === "__DATATALK_RUNTIME_QUERY__").at(-1) || {};
  assert.equal(JSON.stringify(secondRequest.filters), JSON.stringify({ region: "interactive-region" }));
  messageHandler?.({ data: { type: "__DATATALK_RUNTIME_RESPONSE__", requestId: secondRequest.requestId, ok: true, data: { ok: true } } });
  await secondQuery;
}

function verifyExternalLinkSupport() {
  assert.match(REPORT_FRAME_SANDBOX, /(?:^| )allow-popups(?: |$)/);
  assert.match(REPORT_FRAME_SANDBOX, /(?:^| )allow-popups-to-escape-sandbox(?: |$)/);

  const source = composeWebReportSrcDoc({
    "page.html": "<!doctype html><html><body><a href=\"https://example.com\">source</a></body></html>",
  });
  assert.match(source, /function openExternalLinksInNewTab\(\)/);
  assert.match(source, /window\.open\(link\.href, "_blank", "noopener,noreferrer"\)/);

  let clickHandler: ((event: Record<string, unknown>) => void) | undefined;
  const openCalls: string[][] = [];
  const parent = { postMessage() {} };
  const windowObject: Record<string, any> = {
    parent,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    open(href: string, target: string, features: string) {
      openCalls.push([href, target, features]);
    },
    addEventListener() {},
  };
  const documentObject = {
    addEventListener(type: string, handler: (event: Record<string, unknown>) => void) {
      if (type === "click") clickHandler = handler;
    },
  };
  class TestElement {
    closest() {
      return this;
    }
  }
  class TestAnchor extends TestElement {
    target = "";
    href = "https://example.com/report";

    getAttribute(name: string) {
      return name === "href" ? this.href : null;
    }
  }
  const script = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
  assert.ok(script);
  vm.runInNewContext(script, {
    window: windowObject,
    document: documentObject,
    Element: TestElement,
    HTMLAnchorElement: TestAnchor,
  });

  let prevented = false;
  clickHandler?.({
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: new TestAnchor(),
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(openCalls, [["https://example.com/report", "_blank", "noopener,noreferrer"]]);
}

async function main() {
  const manifest = normalizeReportFilterManifest({
    filters: [
      { key: "region", urlKey: "area", type: "select", defaultValue: "default-region" },
      { key: "startDate", urlKey: "startDate", type: "date", defaultValue: "2026-08-01" },
      { key: "tags", urlKey: "tag", type: "multiSelect", defaultValue: [] },
    ],
  });
  assert.ok(manifest);

  const resolution = resolveReportFilterValues(manifest, new URLSearchParams("area=url-region&startDate=2026-08-12&tag=one,two&tag=three"));
  assert.deepEqual(resolution.values, { region: "url-region", startDate: "2026-08-12", tags: ["one", "two", "three"] });
  assert.deepEqual(resolution.urlValues, resolution.values);
  assert.deepEqual(resolution.defaults, { region: "default-region", startDate: "2026-08-01", tags: [] });
  assert.equal(reportFilterValuesToSearchParams(manifest, resolution.urlValues).toString(), "area=url-region&startDate=2026-08-12&tag=one&tag=two&tag=three");

  await verifyRuntimeMerge();
  verifyExternalLinkSupport();
  console.log("report filter verification passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

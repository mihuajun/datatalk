import assert from "node:assert/strict";
import vm from "node:vm";

import {
  normalizeReportFilterManifest,
  reportFilterValuesToSearchParams,
  resolveReportFilterValues,
} from "../lib/report-filters";
import { composeWebReportSrcDoc } from "../lib/report-web";

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
  vm.runInNewContext(script, { window: windowObject });

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
  console.log("report filter verification passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

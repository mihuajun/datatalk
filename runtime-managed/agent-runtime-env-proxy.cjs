"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

// Keep the runtime's previous network-family behavior without passing a Node 22
// CLI flag through NODE_OPTIONS to package-manager processes using another Node.
if (typeof net.setDefaultAutoSelectFamily === "function") {
  net.setDefaultAutoSelectFamily(false);
}

const proxyConfigured = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
].some((name) => Boolean(process.env[name]?.trim()));

function runtimeInstallDir() {
  if (!process.env.DSH_HOME) return null;
  return path.join(path.dirname(process.env.DSH_HOME), "deepseek-harness");
}

function loadRuntimeUndici(installDir) {
  const searchPaths = [
    path.join(installDir, "node_modules", "@deepseek-ai", "dsh-web-fetch-http"),
    path.join(installDir, "node_modules", "@deepseek-ai", "dsh"),
    path.join(installDir, "node_modules"),
  ];

  for (const searchPath of searchPaths) {
    try {
      return require(require.resolve("undici", { paths: [searchPath] }));
    } catch {
      // The provider's own ESM import can still resolve Undici if no CJS path is visible here.
    }
  }

  return null;
}

function patchWebFetchHttpTransport(installDir) {
  const providerPath = path.join(
    installDir,
    "node_modules",
    "@deepseek-ai",
    "dsh-web-fetch-http",
    "lib",
    "index.js",
  );
  if (!fs.existsSync(providerPath)) return;

  const source = fs.readFileSync(providerPath, "utf8");
  if (source.includes("DATATALK_ENV_PROXY_PATCH_V3")) return;

  const startMarker = "async function requestPinned(url, addresses, headers, signal) {";
  const endMarker = "/** Production network operations kept as an object";
  const functionStart = source.indexOf(startMarker);
  const previousPatchStart = source.lastIndexOf("/* DATATALK_ENV_PROXY_PATCH", functionStart);
  const start = previousPatchStart >= 0 ? previousPatchStart : functionStart;
  const end = source.indexOf(endMarker, functionStart);
  if (start < 0 || end < 0) {
    throw new Error(`Unable to patch ${providerPath}: requestPinned() was not found`);
  }

  const replacement = `/* DATATALK_ENV_PROXY_PATCH_V3 */
async function requestPinned(url, addresses, headers, signal) {
\tconst { Agent, fetch: undiciFetch } = await import("undici");
\tconst proxyConfigured = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]
\t\t.some((name) => Boolean(process.env[name]?.trim()));
\tconst dispatcher = proxyConfigured ? void 0 : new Agent({
\t\t\tautoSelectFamily: true,
\t\t\tconnect: { lookup: createPinnedLookup(addresses) }
\t\t});
\tconst requestFetch = proxyConfigured ? globalThis.fetch : undiciFetch;
\ttry {
\t\treturn {
\t\t\tresponse: await requestFetch(url, {
\t\t\t\tmethod: "GET",
\t\t\t\tredirect: "manual",
\t\t\t\theaders,
\t\t\t\tsignal,
\t\t\t\t...(dispatcher ? { dispatcher } : {})
\t\t\t}),
\t\t\tclose: async () => {
\t\t\t\tif (dispatcher) await dispatcher.close();
\t\t\t}
\t\t};
\t} catch (error) {
\t\tif (dispatcher) await dispatcher.close();
\t\tthrow error;
\t}
}
`;

  fs.writeFileSync(providerPath, `${source.slice(0, start)}${replacement}${source.slice(end)}`);
}

const installDir = runtimeInstallDir();
if (installDir) {
  if (proxyConfigured) {
    patchWebFetchHttpTransport(installDir);
  }

  if (proxyConfigured) {
    const undici = loadRuntimeUndici(installDir);
    if (undici?.setGlobalDispatcher && undici.EnvHttpProxyAgent) {
      undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
    }
  }
}

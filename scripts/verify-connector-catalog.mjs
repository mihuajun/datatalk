// Isolated catalog/UI regression. No database, credentials, or application APIs.
// Run with --serve to inspect the real picker component in a local browser fixture.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const mocks = {
  "next/navigation": "export const useRouter = () => ({ push() {}, refresh() {} });",
  "next/link": "import React from 'react'; export default function Link(props) { return React.createElement('a', props); }",
};
const plugins = [{ name: "isolated-next", setup(builder) {
  builder.onResolve({ filter: /^next\/(navigation|link)$/ }, ({ path }) => ({ path, namespace: "mock" }));
  builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], resolveDir: root }));
} }];
const options = { bundle: true, write: false, jsx: "automatic", plugins, absWorkingDir: root };
const result = await build({ ...options, platform: "node", format: "cjs", packages: "external", stdin: {
  contents: `import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {ConnectorPickerClient} from './components/data-sources/connector-picker-client';
    export {CONNECTOR_CATALOG, CONNECTOR_CATEGORIES} from './lib/data-source-catalog';
    export {DATA_SOURCE_OPTIONS} from './components/data-sources/data-source-form-drawer';
    export const markup = renderToStaticMarkup(<ConnectorPickerClient/>);`,
  loader: "tsx", resolveDir: root,
} });
const module = { exports: {} };
runInThisContext(`(function(require,module,exports){${result.outputFiles[0].text}\n})`)(require, module, module.exports);
const { CONNECTOR_CATALOG: catalog, CONNECTOR_CATEGORIES: categories, DATA_SOURCE_OPTIONS: formOptions, markup } = module.exports;
const names = ["美团", "抖音", "企微", "飞书", "宏脉", "领健", "岚时", "哪吒"];
const applications = catalog.filter(item => item.category === "应用数据");
assert.deepEqual(applications.map(item => item.name), names);
assert.equal(categories.filter(category => category === "应用数据").length, 1);
assert.equal(new Set(catalog.map(item => item.type)).size, catalog.length);
assert.equal(new Set(catalog.map(item => item.slug)).size, catalog.length);
for (const item of applications) {
  assert.equal(item.supported, false);
  assert.equal(formOptions.includes(item.type), false);
  assert.ok(item.description.includes("待开放"));
  const tag = markup.match(new RegExp(`<button[^>]*aria-label="${item.name}连接器，待开放"[^>]*>`))?.[0];
  assert.ok(tag?.includes('disabled=""'), `${item.name} must be disabled`);
}
const supported = catalog.filter(item => item.supported);
assert.equal(supported.length, 23);
assert.equal(catalog.length, 31);
assert.ok(markup.includes("23 / 31 已支持"));
assert.equal((markup.match(/disabled=""/g) || []).length, 8);
for (const item of supported) {
  assert.ok(formOptions.includes(item.type));
  const tag = markup.match(new RegExp(`<button[^>]*aria-label="选择${item.name}连接器"[^>]*>`))?.[0];
  assert.ok(tag && !tag.includes('disabled=""'), `${item.name} must remain available`);
}
assert.ok(applications.find(item => item.name === "企微").aliases.includes("企业微信"));
console.log("PASS: 8 pending applications, 23 supported / 31 total, disabled cards, existing connectors available, form excludes pending types");

if (process.argv.includes("--serve")) {
  const client = await build({ ...options, platform: "browser", format: "iife", stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ConnectorPickerClient} from './components/data-sources/connector-picker-client';
      createRoot(document.getElementById('root')).render(<ConnectorPickerClient/>);`,
    loader: "tsx", resolveDir: root,
  } });
  const postcss = require("postcss");
  const css = await postcss([require("tailwindcss")({ content: [path.join(root, "components/data-sources/*.tsx")] })])
    .process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: undefined });
  const server = createServer(async (req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(client.outputFiles[0].text); }
    if (req.url === "/styles.css") { res.setHeader("Content-Type", "text/css"); return res.end(css.css); }
    if (/^\/connectors\/[a-z0-9-]+\.svg$/.test(req.url)) {
      try { res.setHeader("Content-Type", "image/svg+xml"); return res.end(await readFile(path.join(root, "public", req.url))); }
      catch { res.writeHead(404); return res.end(); }
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接器目录本地验证</title><link rel="stylesheet" href="/styles.css"><body style="padding:32px"><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  console.log(`Local isolated fixture: http://127.0.0.1:${server.address().port}`);
}

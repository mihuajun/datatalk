import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { composeWebReportSrcDoc } from "@/lib/report-web";
import {
  decodeGeneratedImageBase64,
  detectGeneratedImageType,
  normalizeDataTalkImageGenerationInput,
} from "@/lib/server/datatalk-image-gen-service";

const root = process.cwd();

const defaults = normalizeDataTalkImageGenerationInput({ prompt: "  一张用于经营报表的横向城市夜景  " });
assert.deepEqual(defaults, {
  prompt: "一张用于经营报表的横向城市夜景",
  size: "1024x1024",
  quality: "medium",
  background: "auto",
  outputFormat: "webp",
});

assert.throws(() => normalizeDataTalkImageGenerationInput({ prompt: "" }), /IMAGE_PROMPT_REQUIRED/);
assert.throws(
  () => normalizeDataTalkImageGenerationInput({ prompt: "透明商品图", background: "transparent", outputFormat: "jpeg" }),
  /IMAGE_GENERATION_INVALID_PARAMS/,
);
assert.throws(
  () => normalizeDataTalkImageGenerationInput({ prompt: "图片", size: "2048x2048" }),
  /IMAGE_GENERATION_INVALID_PARAMS/,
);

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
const webp = Buffer.from("RIFF0000WEBP", "ascii");
assert.equal(detectGeneratedImageType(png), "image/png");
assert.equal(detectGeneratedImageType(jpeg), "image/jpeg");
assert.equal(detectGeneratedImageType(webp), "image/webp");
assert.equal(detectGeneratedImageType(Buffer.from("not-an-image")), null);
assert.equal(decodeGeneratedImageBase64(png.toString("base64")).mediaType, "image/png");
assert.throws(() => decodeGeneratedImageBase64("bm90LWFuLWltYWdl"), /IMAGE_GENERATION_INVALID_RESPONSE/);

const assetDataUrl = `data:image/png;base64,${png.toString("base64")}`;
const reportWithGeneratedAsset = composeWebReportSrcDoc({
  "page.html": '<!doctype html><html><head></head><body><img src="datatalk-asset://assets/generated/example.png"><img src=/assets/generated/example.png?v=1><img srcset="./assets/generated/example.png 1x, datatalk-asset://assets/generated/example.png 2x"><img src="https://example.com/assets/generated/example.png"></body></html>',
  "styles.css": ".hero { background-image: url(assets/generated/example.png#hero); }",
  assets: { "assets/generated/example.png": assetDataUrl },
});
assert.match(reportWithGeneratedAsset, /https:\/\/example\.com\/assets\/generated\/example\.png/);
const reportMarkup = reportWithGeneratedAsset.slice(0, reportWithGeneratedAsset.indexOf("<script>"));
assert.doesNotMatch(reportMarkup, /datatalk-asset:\/\//);
assert.match(reportMarkup, /<img src="data:image\/png;base64,[^"]+">/);
assert.match(reportMarkup, /background-image: url\("data:image\/png;base64,/);
assert.equal(reportWithGeneratedAsset.match(/data:image\/png;base64,/g)?.length, 5);
assert.match(reportWithGeneratedAsset, /imageAssets: inspectImageAssets/);
const generatedScripts = Array.from(reportWithGeneratedAsset.matchAll(/<script>([\s\S]*?)<\/script>/gi), (match) => match[1]);
assert.ok(generatedScripts.length > 0);
for (const generatedScript of generatedScripts) new Function(generatedScript);

for (const profile of ["headless", "web"]) {
  const profilePath = path.join(root, "runtime-managed", "agent-runtime-home", "profiles", profile, "cordis.patch.yml");
  const entries = parseYaml(fs.readFileSync(profilePath, "utf8")) as Array<{ insert?: Array<{ id?: string; name?: string }> }>;
  const plugin = entries.flatMap((entry) => entry.insert || []).find((entry) => entry.id === "datatalk-image-gen");
  assert.deepEqual(plugin, { id: "datatalk-image-gen", name: "../../plugins/datatalk-image-gen.mjs" });
}

const pluginSource = fs.readFileSync(path.join(root, "runtime-managed", "agent-runtime-home", "plugins", "datatalk-image-gen.mjs"), "utf8");
assert.match(pluginSource, /name:\s*"datatalk-image-gen"/);
assert.match(pluginSource, /tool:\s*"datatalk-image-gen"/);
assert.match(pluginSource, /attachments\.saveImage/);
assert.match(pluginSource, /assetUrl:\s*`datatalk-asset:\/\//);
assert.match(pluginSource, /session\?\.header\?\.cwd/);
assert.doesNotMatch(pluginSource, /process\.cwd\s*\(/);

const skillSource = fs.readFileSync(path.join(root, "skills", "datatalk-image-gen", "SKILL.md"), "utf8");
assert.match(skillSource, /^---\nname: datatalk-image-gen\n/m);
assert.match(skillSource, /saveMode=report_asset/);
assert.match(skillSource, /inspect_report_preview/);

console.log("DataTalk image generation contract passed");

import fs from "node:fs/promises";
import path from "node:path";
import type { WebFileMap } from "@/lib/report-web";

const WEB_IMAGE_MEDIA_TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};
const MAX_INLINE_WEB_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_INLINE_WEB_ASSETS_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_INLINE_WEB_ASSETS = 30;

function referencedWebImagePaths(files: WebFileMap) {
  const source = `${files["page.html"] || ""}\n${files["styles.css"] || ""}\n${files["app.js"] || ""}`;
  const matches = source.matchAll(/(?:\.\/)?(assets\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:avif|gif|jpe?g|png|svg|webp))/gi);
  return [...new Set(Array.from(matches, (match) => match[1]))]
    .filter((relativePath) => !relativePath.split("/").some((segment) => segment === "." || segment === ".."))
    .slice(0, MAX_INLINE_WEB_ASSETS);
}

async function readReferencedWebImageAssets(root: string, files: WebFileMap) {
  const assets: Record<string, string> = {};
  let totalBytes = 0;
  const realRoot = await fs.realpath(root).catch(() => path.resolve(root));
  for (const relativePath of referencedWebImagePaths(files)) {
    const extension = relativePath.split(".").at(-1)?.toLowerCase() || "";
    const mediaType = WEB_IMAGE_MEDIA_TYPES[extension];
    if (!mediaType) continue;
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${path.resolve(root)}${path.sep}`)) continue;
    try {
      const realAssetPath = await fs.realpath(absolutePath);
      if (!realAssetPath.startsWith(`${realRoot}${path.sep}`)) continue;
      const stat = await fs.stat(realAssetPath);
      if (!stat.isFile() || stat.size > MAX_INLINE_WEB_ASSET_BYTES || totalBytes + stat.size > MAX_INLINE_WEB_ASSETS_TOTAL_BYTES) continue;
      const content = await fs.readFile(realAssetPath);
      totalBytes += content.byteLength;
      assets[relativePath] = `data:${mediaType};base64,${content.toString("base64")}`;
    } catch {
      // A missing or unreadable referenced asset remains visible to the preview as a broken image.
    }
  }
  return assets;
}

export async function readWebFiles(root: string) {
  const webFiles: WebFileMap = {};
  for (const name of ["page.html", "styles.css", "app.js"] as const) {
    try { webFiles[name] = await fs.readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ root, name), "utf8"); } catch { /* optional workspace file */ }
  }
  const assets = await readReferencedWebImageAssets(root, webFiles);
  if (Object.keys(assets).length) webFiles.assets = assets;
  return webFiles;
}


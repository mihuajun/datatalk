import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getReportWorkspacePath } from "@/lib/server/report-workspace";

export const RELEASE_THUMBNAIL_FILE = "thumbnail.png";
export const LEGACY_RELEASE_THUMBNAIL_FILE = "thumbnail.svg";
export const RESOURCE_RELEASE_THUMBNAIL_FILE = "resource-thumbnail.png";
export const LEGACY_RESOURCE_RELEASE_THUMBNAIL_FILE = "resource-thumbnail.svg";
const SVG_OPEN_TAG_PATTERN = /<svg[\s>]/i;
const PNG_DATA_URL_PATTERN = /^data:image\/png;base64,/i;
const SVG_DATA_URL_PATTERN = /^data:image\/svg\+xml([^,]*),(.*)$/is;

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function splitLines(value: string, lineLength: number, maxLines: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return [];

  const lines: string[] = [];
  let current = "";
  for (const char of normalized) {
    const next = `${current}${char}`;
    if (next.length > lineLength) {
      lines.push(current);
      current = char;
      if (lines.length >= maxLines) break;
      continue;
    }
    current = next;
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (lines.length === maxLines && normalized.length > lines.join("").length) {
    const last = lines[maxLines - 1] || "";
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, lineLength - 1))}…`;
  }

  return lines.map((line) => escapeXml(line));
}

function decodeSvgDataUrl(value: string) {
  if (SVG_OPEN_TAG_PATTERN.test(value)) return value;
  const match = value.match(SVG_DATA_URL_PATTERN);
  if (!match) return null;
  const metadata = match[1] || "";
  const payload = match[2] || "";
  try {
    const svg = /;base64/i.test(metadata)
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    return SVG_OPEN_TAG_PATTERN.test(svg) ? svg : null;
  } catch {
    return null;
  }
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function buildReleaseThumbnailUrl(reportCode: string, version: number, cacheKey?: string | number | null, variant?: "resource") {
  const params = new URLSearchParams({
    version: String(version),
  });
  if (variant) params.set("variant", variant);
  if (cacheKey != null && String(cacheKey).trim()) {
    params.set("t", String(cacheKey));
  }
  return `/api/reports/${encodeURIComponent(reportCode)}/release-thumbnail?${params.toString()}`;
}

export function renderReleaseThumbnailSvg(input: {
  reportCode: string;
  reportName: string;
  version: number;
  tenantName?: string | null;
  categoryName?: string | null;
  description?: string | null;
}) {
  const titleLines = splitLines(optionalText(input.reportName) || input.reportCode, 18, 2);
  const descriptionLines = splitLines(optionalText(input.description), 26, 3);
  const tenantName = escapeXml(optionalText(input.tenantName) || "DataTalk Studio");
  const categoryName = escapeXml(optionalText(input.categoryName) || "已发布报表");
  const reportCode = escapeXml(input.reportCode);
  const versionLabel = escapeXml(`v${input.version}`);

  const titleSvg = titleLines
    .map((line, index) => `<text x="48" y="${140 + (index * 42)}" fill="#FFFFFF" font-size="${index === 0 ? 34 : 30}" font-weight="700">${line}</text>`)
    .join("");
  const descriptionSvg = descriptionLines
    .map((line, index) => `<text x="48" y="${258 + (index * 28)}" fill="rgba(255,255,255,0.82)" font-size="20">${line}</text>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="40" y1="24" x2="1112" y2="630" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1E4FD6"/>
      <stop offset="0.52" stop-color="#2167E8"/>
      <stop offset="1" stop-color="#0F172A"/>
    </linearGradient>
    <linearGradient id="panel" x1="870" y1="110" x2="1128" y2="540" gradientUnits="userSpaceOnUse">
      <stop stop-color="rgba(255,255,255,0.28)"/>
      <stop offset="1" stop-color="rgba(255,255,255,0.08)"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" rx="40" fill="#0F172A"/>
  <rect x="24" y="24" width="1152" height="582" rx="32" fill="url(#bg)"/>
  <circle cx="1054" cy="120" r="170" fill="rgba(255,255,255,0.08)"/>
  <circle cx="1140" cy="16" r="96" fill="rgba(255,255,255,0.10)"/>
  <rect x="48" y="52" width="194" height="38" rx="19" fill="rgba(255,255,255,0.15)"/>
  <text x="72" y="77" fill="#FFFFFF" font-size="18" font-weight="600">${tenantName}</text>
  <rect x="260" y="52" width="132" height="38" rx="19" fill="rgba(255,255,255,0.12)"/>
  <text x="284" y="77" fill="#DCEBFF" font-size="18" font-weight="600">${categoryName}</text>
  ${titleSvg}
  ${descriptionSvg}
  <rect x="48" y="510" width="280" height="84" rx="24" fill="rgba(255,255,255,0.12)"/>
  <text x="76" y="546" fill="#DCEBFF" font-size="18">报表编码</text>
  <text x="76" y="577" fill="#FFFFFF" font-size="28" font-weight="700">${reportCode}</text>
  <rect x="352" y="510" width="160" height="84" rx="24" fill="rgba(255,255,255,0.12)"/>
  <text x="380" y="546" fill="#DCEBFF" font-size="18">发布版本</text>
  <text x="380" y="577" fill="#FFFFFF" font-size="28" font-weight="700">${versionLabel}</text>
  <rect x="860" y="110" width="268" height="372" rx="28" fill="url(#panel)" stroke="rgba(255,255,255,0.18)"/>
  <rect x="892" y="146" width="204" height="18" rx="9" fill="rgba(255,255,255,0.24)"/>
  <rect x="892" y="188" width="112" height="84" rx="18" fill="rgba(255,255,255,0.16)"/>
  <rect x="1018" y="188" width="78" height="84" rx="18" fill="rgba(255,255,255,0.12)"/>
  <rect x="892" y="292" width="204" height="112" rx="20" fill="rgba(255,255,255,0.10)"/>
  <path d="M924 364C957 314 991 344 1022 318C1047 297 1069 308 1094 270" stroke="#FFFFFF" stroke-opacity="0.88" stroke-width="10" stroke-linecap="round"/>
  <circle cx="924" cy="364" r="9" fill="#FFFFFF"/>
  <circle cx="1022" cy="318" r="9" fill="#FFFFFF"/>
  <circle cx="1094" cy="270" r="9" fill="#FFFFFF"/>
  <rect x="892" y="428" width="204" height="18" rx="9" fill="rgba(255,255,255,0.18)"/>
  <rect x="892" y="458" width="160" height="18" rx="9" fill="rgba(255,255,255,0.12)"/>
</svg>
`;
}

export async function writeReleaseThumbnail(input: {
  tenantId: number;
  reportCode: string;
  version: number;
  reportName: string;
  tenantName?: string | null;
  categoryName?: string | null;
  description?: string | null;
  targetDirectory?: string;
}) {
  const targetDirectory = input.targetDirectory
    ?? path.join(getReportWorkspacePath(input.tenantId, input.reportCode), "releases", `v${input.version}`);
  const filePath = path.join(targetDirectory, LEGACY_RELEASE_THUMBNAIL_FILE);
  const svg = renderReleaseThumbnailSvg(input);
  await fs.mkdir(targetDirectory, { recursive: true });
  await fs.rm(path.join(targetDirectory, RELEASE_THUMBNAIL_FILE), { force: true });
  await fs.writeFile(filePath, svg, "utf8");
  return filePath;
}

export async function writeResourceThumbnailDataUrl(input: {
  tenantId: number;
  reportCode: string;
  version: number;
  dataUrl: string;
  targetDirectory?: string;
}) {
  const dataUrl = input.dataUrl.trim();
  const targetDirectory = input.targetDirectory
    ?? path.join(getReportWorkspacePath(input.tenantId, input.reportCode), "releases", `v${input.version}`);
  await fs.mkdir(targetDirectory, { recursive: true });
  const isPng = PNG_DATA_URL_PATTERN.test(dataUrl);
  const fileName = isPng ? RESOURCE_RELEASE_THUMBNAIL_FILE : LEGACY_RESOURCE_RELEASE_THUMBNAIL_FILE;
  const filePath = path.join(targetDirectory, fileName);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;

  if (isPng) {
    const binary = dataUrl.replace(PNG_DATA_URL_PATTERN, "");
    try {
      await fs.writeFile(temporaryPath, Buffer.from(binary, "base64"));
      await fs.chmod(temporaryPath, 0o444);
      await fs.rm(filePath, { force: true });
      await fs.rm(path.join(targetDirectory, LEGACY_RESOURCE_RELEASE_THUMBNAIL_FILE), { force: true });
      await fs.rename(temporaryPath, filePath);
      return filePath;
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
  const svg = decodeSvgDataUrl(dataUrl);
  if (!svg) {
    throw new Error("缩略图内容不正确");
  }
  try {
    await fs.writeFile(temporaryPath, svg, "utf8");
    await fs.chmod(temporaryPath, 0o444);
    await fs.rm(filePath, { force: true });
    await fs.rm(path.join(targetDirectory, RESOURCE_RELEASE_THUMBNAIL_FILE), { force: true });
    await fs.rename(temporaryPath, filePath);
    return filePath;
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { getReportWorkspacePath } from "@/lib/server/report-workspace";

export type ReportMetricKnowledge = {
  key: string;
  name: string;
  description: string;
  sourceCode: string;
  sourceRef: string;
  aliases: string[];
  fingerprint: string;
  updatedAt?: string;
};

function metricKnowledgeRoot(tenantId: number, reportCode: string) {
  return path.join(getReportWorkspacePath(tenantId, reportCode), "_knowledge", "metrics");
}

function metricDir(tenantId: number, reportCode: string, metricKey: string) {
  return path.join(metricKnowledgeRoot(tenantId, reportCode), metricKey);
}

function sanitizeMetricKey(metricKey: string) {
  const normalized = metricKey.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("INVALID_METRIC_KEY");
  return normalized.slice(0, 80);
}

function fingerprintMetric(input: Pick<ReportMetricKnowledge, "name" | "description" | "sourceCode" | "sourceRef" | "aliases">) {
  return createHash("sha256").update(JSON.stringify({
    name: input.name,
    description: input.description,
    sourceCode: input.sourceCode,
    sourceRef: input.sourceRef,
    aliases: [...input.aliases].sort(),
  })).digest("hex");
}

async function readFileIfExists(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export async function ensureMetricKnowledgeRoot(tenantId: number, reportCode: string) {
  await fs.mkdir(metricKnowledgeRoot(tenantId, reportCode), { recursive: true });
}

export async function listMetricKnowledge(tenantId: number, reportCode: string) {
  await ensureMetricKnowledgeRoot(tenantId, reportCode);
  const entries = await fs.readdir(metricKnowledgeRoot(tenantId, reportCode), { withFileTypes: true });
  const metrics = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => readMetricKnowledge(tenantId, reportCode, entry.name)));
  return metrics.filter(Boolean) as ReportMetricKnowledge[];
}

export async function readMetricKnowledge(tenantId: number, reportCode: string, metricKey: string) {
  const key = sanitizeMetricKey(metricKey);
  const dir = metricDir(tenantId, reportCode, key);
  try {
    const [description, sourceCode, sourceRef, aliases, fingerprint, stat] = await Promise.all([
      readFileIfExists(path.join(dir, "README.md")),
      readFileIfExists(path.join(dir, "source.ts")),
      readFileIfExists(path.join(dir, "source-ref.txt")),
      readFileIfExists(path.join(dir, "aliases.txt")),
      readFileIfExists(path.join(dir, "fingerprint.txt")),
      fs.stat(dir),
    ]);
    if (!description && !sourceCode && !sourceRef && !aliases && !fingerprint) return null;
    const nameLine = description.split("\n").find((line) => line.trim().startsWith("# "));
    const name = nameLine ? nameLine.trim().slice(2).trim() : key;
    const aliasList = aliases.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const normalizedFingerprint = fingerprint.trim() || fingerprintMetric({ name, description, sourceCode, sourceRef: sourceRef.trim(), aliases: aliasList });
    return {
      key,
      name,
      description,
      sourceCode,
      sourceRef: sourceRef.trim(),
      aliases: aliasList,
      fingerprint: normalizedFingerprint,
      updatedAt: stat.mtime.toISOString(),
    } satisfies ReportMetricKnowledge;
  } catch {
    return null;
  }
}

export async function writeMetricKnowledge(tenantId: number, reportCode: string, input: Omit<ReportMetricKnowledge, "key" | "fingerprint" | "updatedAt"> & { key: string }) {
  const key = sanitizeMetricKey(input.key);
  const dir = metricDir(tenantId, reportCode, key);
  await fs.mkdir(dir, { recursive: true });
  const aliases = Array.from(new Set(input.aliases.map((item) => item.trim()).filter(Boolean)));
  const fingerprint = fingerprintMetric({
    name: input.name,
    description: input.description,
    sourceCode: input.sourceCode,
    sourceRef: input.sourceRef,
    aliases,
  });
  await Promise.all([
    fs.writeFile(path.join(dir, "README.md"), input.description || `# ${input.name}\n`),
    fs.writeFile(path.join(dir, "source.ts"), input.sourceCode || ""),
    fs.writeFile(path.join(dir, "source-ref.txt"), `${input.sourceRef || ""}\n`),
    fs.writeFile(path.join(dir, "aliases.txt"), aliases.join("\n")),
    fs.writeFile(path.join(dir, "fingerprint.txt"), `${fingerprint}\n`),
  ]);
  return readMetricKnowledge(tenantId, reportCode, key);
}

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AGENT_RUNTIME_ROOT } from "@/lib/server/workspace-storage";

type Config = { enabled: boolean; baseUrl: string; model: string; key: string };
const file = path.join(AGENT_RUNTIME_ROOT, "metric-embedding.json");
export function readMetricEmbeddingConfig(): Config {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as Config; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: false, baseUrl: "", model: "", key: "" };
    throw new Error("无法读取向量模型配置");
  }
}
export function publicMetricEmbeddingConfig() {
  const { key, ...config } = readMetricEmbeddingConfig();
  return { ...config, apiKeyConfigured: Boolean(key), apiKeyPreview: key ? (key.length > 8 ? `${key.slice(0, 4)}••••${key.slice(-4)}` : "••••") : "" };
}
export function prepareMetricEmbeddingConfig(input: Record<string, unknown>): Config {
  const previous = readMetricEmbeddingConfig();
  if (typeof input.enabled !== "boolean") throw new Error("必须指定启用状态");
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim().replace(/\/+$/, "") : previous.baseUrl;
  const model = typeof input.model === "string" ? input.model.trim() : previous.model;
  if (baseUrl) {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("服务地址必须为不含凭据和查询参数的 HTTP(S) 地址");
  }
  const suppliedKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (baseUrl !== previous.baseUrl && previous.key && !suppliedKey && input.clearApiKey !== true) throw new Error("服务地址已变更，请重新填写 API Key 或清除原密钥");
  const key = input.clearApiKey === true ? "" : suppliedKey || previous.key;
  if (input.enabled && (!baseUrl || !model)) throw new Error("启用前请填写服务地址和模型名称");
  return { enabled: input.enabled, baseUrl, model, key };
}
export function saveMetricEmbeddingConfig(input: Record<string, unknown>) {
  const config = prepareMetricEmbeddingConfig(input);
  fs.mkdirSync(AGENT_RUNTIME_ROOT, { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(config), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return publicMetricEmbeddingConfig();
}

import { readMetricEmbeddingConfig } from "@/lib/server/metric-embedding-config";
import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/server/mysql";

export function embeddingConfig() {
  const config = readMetricEmbeddingConfig();
  return config.enabled && config.baseUrl && config.model ? config : null;
}
export function metricIndexText(row: { name: string; aliases_json: unknown; keywords_json: unknown; content: string }) {
  const list = (value: unknown): string[] => {
    try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed.filter(x => typeof x === "string") : []; }
    catch { return []; }
  };
  return [`指标：${row.name}`, `别名：${list(row.aliases_json).join("、")}`, `关键词：${list(row.keywords_json).join("、")}`, row.content].join("\n");
}
export function contentHash(text: string) { return createHash("sha256").update(text).digest("hex"); }
export function vectorValue(value: unknown): number[] | null {
  try {
    const v: unknown = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(v) && v.length > 0 && v.every(x => typeof x === "number" && Number.isFinite(x)) && v.some(x => x !== 0) ? v : null;
  } catch { return null; }
}
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export class MetricEmbeddingError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number, public readonly providerCode?: string) {
    super(message); this.name = "MetricEmbeddingError";
  }
}
export async function embedMetricText(text: string, config = embeddingConfig()) {
  if (!config) throw new MetricEmbeddingError("EMBEDDING_NOT_CONFIGURED", "向量模型尚未配置或启用");
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const multimodal = baseUrl.endsWith("/embeddings/multimodal");
  const endpoint = multimodal || baseUrl.endsWith("/embeddings") ? baseUrl : `${baseUrl}/embeddings`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}) },
      body: JSON.stringify({ model: config.model, input: multimodal ? [{ type: "text", text }] : text, encoding_format: "float" }),
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    const name = (error as { name?: string }).name;
    const timedOut = name === "TimeoutError" || name === "AbortError" || cause === "UND_ERR_CONNECT_TIMEOUT";
    const reason = timedOut ? "向量服务请求超时（10 秒），请检查网络或服务响应速度" : cause === "ENOTFOUND" || cause === "EAI_AGAIN" ? "无法解析向量服务域名，请检查服务地址和 DNS" : cause === "ECONNREFUSED" ? "向量服务拒绝连接，请检查端口与服务是否启动" : "无法连接向量服务，请检查网络、TLS 证书及服务地址（不支持重定向）";
    throw new MetricEmbeddingError(timedOut ? "EMBEDDING_TIMEOUT" : "EMBEDDING_NETWORK_ERROR", reason);
  }
  if (!response.ok) {
    let providerCode: string | undefined;
    try {
      const body = await response.json() as { error?: { code?: unknown } };
      if (typeof body.error?.code === "string" && /^[a-z_]{1,60}$/i.test(body.error.code)) providerCode = body.error.code;
    } catch { /* HTML and empty errors are classified by HTTP status. */ }
    const reasons: Record<number, string> = {
      400: "请求被服务拒绝，请确认模型支持 embeddings 接口及当前请求参数",
      401: "鉴权失败，请检查向量模型 API Key 是否正确或已过期",
      403: "访问被拒绝，请检查密钥的模型权限、渠道或 IP 限制",
      404: "未找到接口或模型，请检查服务地址是否包含正确的 API 前缀，以及模型名称是否存在",
      405: "服务不支持该请求方法，请检查是否填写了正确的 API 服务地址",
      429: "服务限流或额度不足，请检查余额与调用配额",
    };
    throw new MetricEmbeddingError("EMBEDDING_HTTP_ERROR", `向量服务返回 HTTP ${response.status}：${reasons[response.status] || (response.status >= 500 ? "上游服务异常，请稍后重试或检查服务日志" : "请求失败，请检查服务配置")}${providerCode ? `（${providerCode}）` : ""}`, response.status, providerCode);
  }
  let body: { data?: Array<{ embedding?: unknown }> | { embedding?: unknown } };
  try { body = await response.json(); }
  catch { throw new MetricEmbeddingError("EMBEDDING_INVALID_RESPONSE", "服务返回的不是 JSON，请检查地址是否指向 API 而非网站页面"); }
  const vector = vectorValue(multimodal && !Array.isArray(body?.data) ? body?.data?.embedding : Array.isArray(body?.data) ? body.data[0]?.embedding : undefined);
  if (!vector) throw new MetricEmbeddingError("EMBEDDING_INVALID_RESPONSE", `服务响应中缺少有效的 ${multimodal ? "data.embedding" : "data[0].embedding"} 数值数组，请确认使用的是向量模型和匹配的接口`);
  return { vector, model: `${config.baseUrl}|${config.model}` };
}
export function keywordScore(query: string, key: string, name: string, aliases: string[], text: string) {
  const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const q = norm(query);
  if (!q) return 0;
  if (q === norm(key)) return 100;
  if (q === norm(name)) return 95;
  if (aliases.some(a => norm(a) === q)) return 90;
  const document = norm(text);
  if (document.includes(q)) return 60;
  // Word tokens plus CJK bigrams handle Chinese questions without a tokenizer dependency.
  const tokens = new Set(query.toLowerCase().match(/[a-z0-9_]+/g) || []);
  for (const segment of query.match(/[\p{Script=Han}]+/gu) || []) {
    for (let i = 0; i < segment.length - 1; i++) tokens.add(segment.slice(i, i + 2));
  }
  const hits = [...tokens].filter(t => document.includes(norm(t))).length;
  return tokens.size && hits ? 40 * hits / tokens.size : 0;
}

/** Explicit rebuild/retry; never calls embedding on a hidden global tenant corpus. */
export async function rebuildMetricSearchIndex(tenantId: number, metricKeys?: string[], options: { skipUnchanged?: boolean } = {}) {
  const config = embeddingConfig();
  if (!config) return { indexed: 0, failed: 0, status: "not_configured" as const };
  // An explicitly empty batch must never expand into a whole-tenant rebuild.
  if (metricKeys?.length === 0) return { indexed: 0, failed: 0, status: "ready" as const };
  const params: (number | string)[] = [tenantId];
  const clause = metricKeys?.length ? ` AND m.metric_key IN (${metricKeys.map(() => "?").join(",")})` : "";
  if (metricKeys) params.push(...metricKeys);
  const [rows] = await getDbPool().query<Array<RowDataPacket & {
    metric_key: string; version: number; name: string; aliases_json: unknown; keywords_json: unknown; content: string;
  }>>(`SELECT m.metric_key, m.version, m.name, m.aliases_json, m.keywords_json, m.content
    FROM tenant_metric_knowledge m WHERE m.tenant_id=? AND m.status='active'${clause}`, params);
  let indexed = 0, failed = 0;
  for (const row of rows) {
    try {
      const text = metricIndexText(row);
      const hash = contentHash(text);
      if (options.skipUnchanged) {
        const [cached] = await getDbPool().query<RowDataPacket[]>(
          `SELECT content_hash, model, embedding_json FROM tenant_metric_search_index
           WHERE tenant_id=? AND metric_key=? AND version=?`,
          [tenantId, row.metric_key, row.version],
        );
        const index = cached[0];
        if (index?.content_hash === hash && index.model === `${config.baseUrl}|${config.model}`
          && vectorValue(index.embedding_json)) continue;
      }
      const { vector, model } = await embedMetricText(text, config);
      await getDbPool().execute(`INSERT INTO tenant_metric_search_index
        (tenant_id,metric_key,version,content_hash,model,embedding_json) VALUES (?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE content_hash=VALUES(content_hash), model=VALUES(model), embedding_json=VALUES(embedding_json), updated_at=CURRENT_TIMESTAMP`,
      [tenantId, row.metric_key, row.version, hash, model, JSON.stringify(vector)]);
      indexed++;
    } catch { failed++; }
  }
  return { indexed, failed, status: failed ? "partial" as const : "ready" as const };
}

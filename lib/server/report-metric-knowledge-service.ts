import { contentHash, cosine, embedMetricText, embeddingConfig, keywordScore, metricIndexText, rebuildMetricSearchIndex, vectorValue } from "@/lib/server/metric-retrieval";
import { createHash } from "node:crypto";

import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import { getDbPool } from "@/lib/server/mysql";

export type MetricKnowledgeView = {
  metricKey: string;
  name: string;
  ownerName: string | null;
  updatedByName: string | null;
  aliases: string[];
  content: string;
  keywords: string[];
  createdAt: string;
  status: "active" | "disabled" | "archived" | "deleted";
  version: number;
  fingerprint: string;
  acceptedCount: number;
  rejectedCount: number;
  updatedAt: string;
  sourceReportCode: string | null;
  sourceReportName: string | null;
  sourceReports: string[];
  reportBindings?: Array<{ reportCode: string; reportName: string; version: number; updatedAt: string }>;
};

export type MetricSearchIntent = {
  query: string;
  formulaHint?: string;
  grainHint?: string;
  dimensions?: unknown;
  timeFieldHint?: string;
  filters?: unknown;
  dedupRule?: string;
  dataSource?: string;
  limit?: number;
};

type MetricKnowledgeRow = RowDataPacket & {
  id: number;
  metric_key: string;
  name: string;
  normalized_name: string;
  aliases_json: unknown;
  content: string;
  keywords_json: unknown;
  created_at: string | Date;
  status: "active" | "disabled" | "archived" | "deleted";
  owner_name?: string | null;
  updated_by_name?: string | null;
  version: number;
  fingerprint: string;
  accepted_count: number;
  rejected_count: number;
  updated_at: string | Date;
  source_report_code?: string | null;
  source_report_name?: string | null;
  source_report_folder_name?: string | null;
  match_score?: number | string;
};

type MetricProposalRow = RowDataPacket & {
  id: number;
  metric_key: string;
  name: string;
  normalized_name: string;
  aliases_json: unknown;
  content: string;
  keywords_json: unknown;
  created_at: string | Date;
  fingerprint: string;
  action: "create" | "update" | "reuse";
  confirmed: number;
  validated: number;
  previous_json: unknown;
  created_by?: number | null;
  updated_by?: number | null;
};

type QueryExecutor = Pool | PoolConnection;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function trimText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function stringList(value: unknown, limit = 20, itemLength = 300) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((item) => {
    const normalized = trimText(item, itemLength);
    return normalized ? [normalized] : [];
  }))).slice(0, limit);
}

export function normalizeMetricTerm(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function normalizeMetricExpression(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeMetricKey(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function metricKeyForName(name: string) {
  const direct = normalizeMetricKey(name);
  if (direct) return direct;
  return `metric-${createHash("sha256").update(normalizeMetricTerm(name)).digest("hex").slice(0, 12)}`;
}

function aliasesFromRow(value: unknown) {
  return stringList(parseJson(value), 30, 160);
}

function metricDate(value: string | Date) {
  // SQLite CURRENT_TIMESTAMP is UTC text without a zone; mysql2 normally returns Date.
  const utc = typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(" ", "T")}Z` : value;
  return new Date(utc).toISOString();
}

function metricView(row: MetricKnowledgeRow): MetricKnowledgeView {
  return {
    metricKey: row.metric_key,
    name: row.name,
    ownerName: row.owner_name || null,
    updatedByName: row.updated_by_name || null,
    aliases: aliasesFromRow(row.aliases_json),
    content: row.content, keywords: aliasesFromRow(row.keywords_json), createdAt: metricDate(row.created_at),
    status: row.status,
    version: Number(row.version),
    fingerprint: row.fingerprint,
    acceptedCount: Number(row.accepted_count || 0),
    rejectedCount: Number(row.rejected_count || 0),
    updatedAt: metricDate(row.updated_at),
    sourceReportCode: row.source_report_code || null,
    sourceReportName: row.source_report_name
      ? [row.source_report_folder_name, row.source_report_name].filter(Boolean).join("/")
      : null,
    sourceReports: [],
  };
}

function semanticFingerprint(content: string, name: string, aliases: string[], keywords: string[]) {
  // Preserve SQL operators, punctuation, case and all text: never normalize away semantic changes.
  return createHash("sha256").update(JSON.stringify({content, name, aliases: [...aliases].sort(), keywords: [...keywords].sort()})).digest("hex");
}

function clampLimit(value: unknown, fallback = 10, max = 20) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function rankCandidate(intent: MetricSearchIntent, row: MetricKnowledgeRow) {
  // Text is authoritative. Do not infer correctness by extracting a handful of headings.
  const hasHints = Boolean(intent.formulaHint || intent.grainHint || intent.timeFieldHint || intent.dedupRule || intent.dataSource || stringList(intent.filters).length || stringList(intent.dimensions).length);
  return { ...metricView(row), score: Number(row.match_score || 0),
    conflicts: hasHints ? ["请阅读完整 content 核对请求口径；纯文本未进行字段级自动判定"] : [] as string[] };
}

export async function searchMetricKnowledge(tenantId: number, intent: MetricSearchIntent) {
  const query = trimText(intent.query, 500);
  if (!normalizeMetricTerm(query)) throw new Error("METRIC_QUERY_REQUIRED");
  const limit = clampLimit(intent.limit);
  // Apply tenant and lifecycle scope in SQL, including the vector join, before scoring.
  const [rows] = await getDbPool().query<Array<MetricKnowledgeRow & {
    embedding_json: unknown; content_hash: string | null; model: string | null;
  }>>(`SELECT m.*, u.name AS owner_name, updater.name AS updated_by_name,
      i.embedding_json, i.content_hash, i.model
    FROM tenant_metric_knowledge m
    LEFT JOIN tenant_metric_search_index i ON i.tenant_id=m.tenant_id AND i.metric_key=m.metric_key AND i.version=m.version
    LEFT JOIN tenant_user u ON u.tenant_id=m.tenant_id AND u.id=m.created_by
    LEFT JOIN tenant_user updater ON updater.tenant_id=m.tenant_id AND updater.id=m.updated_by
    WHERE m.tenant_id=? AND m.status='active'`, [tenantId]);
  let queryEmbedding: Awaited<ReturnType<typeof embedMetricText>> | null = null;
  let degradation: string | null = embeddingConfig() ? null : "embedding_not_configured";
  if (rows.length && !degradation) {
    try { queryEmbedding = await embedMetricText(query); }
    catch { degradation = "embedding_unavailable"; }
  }
  let indexed = 0;
  const scored = rows.map(row => {
    const text = metricIndexText(row);
    const lexical = keywordScore(query, row.metric_key, row.name, aliasesFromRow(row.aliases_json), text);
    const vector = vectorValue(row.embedding_json);
    const usable = queryEmbedding && vector && vector.length === queryEmbedding.vector.length
      && row.model === queryEmbedding.model && row.content_hash === contentHash(text);
    if (usable) indexed++;
    const semantic = usable ? cosine(queryEmbedding!.vector, vector!) : 0;
    return { row, lexical, semantic };
  });
  if (queryEmbedding && indexed < rows.length) degradation = "index_incomplete";
  const lexicalRanks = new Map(scored.filter(x => x.lexical > 0).sort((a,b) => b.lexical-a.lexical).map((x,i) => [x.row.metric_key, i+1]));
  const semanticRanks = new Map(scored.filter(x => x.semantic >= 0.45).sort((a,b) => b.semantic-a.semantic).map((x,i) => [x.row.metric_key, i+1]));
  const candidates = scored.filter(x => lexicalRanks.has(x.row.metric_key) || semanticRanks.has(x.row.metric_key)).map(x => {
    const lexicalRank = lexicalRanks.get(x.row.metric_key), semanticRank = semanticRanks.get(x.row.metric_key);
    const fusion = (lexicalRank ? 1/(60+lexicalRank) : 0) + (semanticRank ? 1/(60+semanticRank) : 0);
    const candidate = rankCandidate(intent, { ...x.row, match_score: x.lexical });
    return { ...candidate, score: candidate.score + fusion * 100,
      match: { keyword: x.lexical, cosine: x.semantic, fusion, exact: x.lexical >= 90,
        reasons: [...(x.lexical >= 90 ? ["名称、标识或别名精确匹配"] : x.lexical > 0 ? ["定义关键词匹配"] : []), ...(semanticRank ? ["向量语义匹配"] : [])] } };
  }).sort((a,b) => Number(a.conflicts.length > 0)-Number(b.conflicts.length > 0) || Number(b.match.exact)-Number(a.match.exact) || b.match.fusion-a.match.fusion || b.score-a.score);
  // Decide before truncation: a small limit must never hide ambiguity.
  const exact = candidates.filter(x => x.match.exact && !x.conflicts.length);
  const decision = !candidates.length ? "create" : exact.length === 1 ? "reuse" : "confirm";
  return { decision, query, requiresContentReview: true, candidates: candidates.slice(0, limit),
    retrieval: { mode: queryEmbedding && indexed > 0 ? "hybrid" : "keyword", degradation, indexed, total: rows.length },
    question: decision === "confirm" ? `“${query}”需要确认指标及口径；相似度不代表业务含义一致。` : null } as const;
}

export async function listMetricKnowledge(tenantId: number, input?: {
  keyword?: unknown;
  limit?: unknown;
}) {
  const keyword = trimText(input?.keyword, 160);
  const normalizedKeyword = normalizeMetricTerm(keyword);
  const limit = clampLimit(input?.limit, 20, 100);
  const [rows] = await getDbPool().query<MetricKnowledgeRow[]>(
    `SELECT id, metric_key, name, normalized_name, aliases_json, content, keywords_json, created_at, status,
            version, fingerprint, accepted_count, rejected_count, updated_at
       FROM tenant_metric_knowledge
      WHERE tenant_id=? AND status='active'
        AND (?='' OR normalized_name LIKE ? OR search_text LIKE ?)
      ORDER BY accepted_count DESC, updated_at DESC
      LIMIT ?`,
    [
      tenantId,
      normalizedKeyword,
      `%${normalizedKeyword}%`,
      `%${normalizedKeyword}%`,
      limit,
    ],
  );

  return {
    keyword,
    items: rows.map(metricView),
  } as const;
}

/** Read-only management view; unlike agent search this includes archived metrics. */
export async function listMetricKnowledgeForManagement(tenantId: number, input?: {
  keyword?: unknown;
  status?: unknown;
  limit?: unknown;
}) {
  const keyword = trimText(input?.keyword, 160);
  const normalizedKeyword = normalizeMetricTerm(keyword);
  const status = input?.status === "active" || input?.status === "disabled" || input?.status === "archived" ? input.status : "all";
  const limit = clampLimit(input?.limit, 100, 100);
  const statusClause = status === "all" ? "" : " AND m.status=?";
  const keywordClause = normalizedKeyword ? " AND (m.normalized_name LIKE ? OR m.search_text LIKE ?)" : "";
  const params: Array<string | number> = [tenantId];
  if (status !== "all") params.push(status);
  if (normalizedKeyword) {
    const likeKeyword = `%${normalizedKeyword}%`;
    params.push(likeKeyword, likeKeyword);
  }
  params.push(limit);
  // mysql2 query() formats LIMIT placeholders for this MySQL server; execute()
  // sends a prepared LIMIT parameter, which this server rejects as invalid args.
  const [rows] = await getDbPool().query<MetricKnowledgeRow[]>(
    `SELECT m.id, m.metric_key, m.name, m.normalized_name, m.aliases_json, m.content, m.keywords_json, m.created_at, m.status,
            m.version, m.fingerprint, m.accepted_count, m.rejected_count, m.updated_at, m.source_report_code,
            u.name AS owner_name, updater.name AS updated_by_name,
            r.name AS source_report_name, f.name AS source_report_folder_name
       FROM tenant_metric_knowledge m
       LEFT JOIN tenant_user u ON u.tenant_id=m.tenant_id AND u.id=m.created_by
       LEFT JOIN tenant_user updater ON updater.tenant_id=m.tenant_id AND updater.id=m.updated_by
       LEFT JOIN tenant_report r ON r.tenant_id=m.tenant_id AND r.code=m.source_report_code
       LEFT JOIN tenant_report_folder f ON f.tenant_id=r.tenant_id AND f.id=r.folder_id
      WHERE m.tenant_id=? AND m.status<>'deleted'${statusClause}${keywordClause}
      ORDER BY CASE WHEN m.status='active' THEN 0 ELSE 1 END, m.updated_at DESC
      LIMIT ?`,
    params,
  );
  if (!rows.length) return { keyword, status, items: [] } as const;

  const metricKeys = rows.map((row) => row.metric_key);
  const reportPlaceholders = metricKeys.map(() => "?").join(",");
  const [usageRows] = await getDbPool().query<Array<RowDataPacket & {
    metric_key: string;
    report_code: string;
    report_name: string | null;
    folder_name: string | null;
    metric_version: number; updated_at: string | Date;
  }>>(
    `SELECT p.metric_key, p.report_code, p.metric_version, p.updated_at, r.name AS report_name, f.name AS folder_name
       FROM tenant_report_metric_binding p
       LEFT JOIN tenant_report r ON r.tenant_id=p.tenant_id AND r.code=p.report_code
       LEFT JOIN tenant_report_folder f ON f.tenant_id=r.tenant_id AND f.id=r.folder_id
      WHERE p.tenant_id=? AND r.deleted_at IS NULL AND p.metric_key IN (${reportPlaceholders})
      ORDER BY p.updated_at DESC`,
    [tenantId, ...metricKeys],
  );
  const reportsByMetric = new Map<string, Map<string, string>>();
  for (const usage of usageRows) {
    if (!usage.report_name) continue;
    const reports = reportsByMetric.get(usage.metric_key) || new Map<string, string>();
    if (!reports.has(usage.report_code)) {
      reports.set(usage.report_code, [usage.folder_name, usage.report_name].filter(Boolean).join("/"));
    }
    reportsByMetric.set(usage.metric_key, reports);
  }
  const items = rows.map((row) => {
    const item = metricView(row);
    const reports = reportsByMetric.get(row.metric_key) || new Map<string, string>();
    return { ...item, sourceReports: Array.from(reports.values()), reportBindings: usageRows
      .filter(usage => usage.metric_key === row.metric_key && usage.report_name)
      .map(usage => ({ reportCode: usage.report_code, reportName: [usage.folder_name, usage.report_name].filter(Boolean).join("/"),
        version: Number(usage.metric_version), updatedAt: metricDate(usage.updated_at) })) };
  });
  return { keyword, status, items } as const;
}

export async function listMetricKnowledgeHistory(tenantId: number, metricKey: string) {
  const [rows] = await getDbPool().query<Array<RowDataPacket & {
    name: string; content: string; keywords_json: unknown; version: number; change_summary: string;
    created_at: string | Date; owner_name: string | null; source_report_name: string | null; source_report_folder_name: string | null;
  }>>(`SELECT v.*, u.name AS owner_name, r.name AS source_report_name, f.name AS source_report_folder_name
    FROM tenant_metric_knowledge_version v
    LEFT JOIN tenant_user u ON u.tenant_id=v.tenant_id AND u.id=v.created_by
    LEFT JOIN tenant_report r ON r.tenant_id=v.tenant_id AND r.code=v.source_report_code
    LEFT JOIN tenant_report_folder f ON f.tenant_id=r.tenant_id AND f.id=r.folder_id
    WHERE v.tenant_id=? AND v.metric_key=? ORDER BY v.version DESC`, [tenantId, metricKey]);
  return rows.map(row => ({ name: row.name, aliases: aliasesFromRow(row.aliases_json), content: row.content, keywords: aliasesFromRow(row.keywords_json), createdAt: metricDate(row.created_at), version: Number(row.version),
    action: Number(row.version) === 1 ? "create" : "update", changeSummary: row.change_summary,
    sourceReportName: row.source_report_name ? [row.source_report_folder_name,row.source_report_name].filter(Boolean).join("/") : null,
    updatedAt: metricDate(row.created_at), ownerName: row.owner_name || null }));
}

export async function readReportMetricBindings(tenantId: number, reportCode: string) {
  const [rows] = await getDbPool().query<Array<RowDataPacket & { metric_key: string; metric_version: number; name: string; content: string; keywords_json: unknown; created_at: string | Date; status: string; version: number }>>(
    `SELECT b.metric_key, b.metric_version, v.name, v.aliases_json, v.content, v.keywords_json, v.created_at, m.status, m.version
     FROM tenant_report_metric_binding b
     JOIN tenant_metric_knowledge_version v ON v.tenant_id=b.tenant_id AND v.metric_key=b.metric_key AND v.version=b.metric_version
     JOIN tenant_metric_knowledge m ON m.tenant_id=b.tenant_id AND m.metric_key=b.metric_key
     WHERE b.tenant_id=? AND b.report_code=?`, [tenantId, reportCode]);
  return rows.map(row => ({ metricKey: row.metric_key, version: Number(row.metric_version), name: row.name, aliases: aliasesFromRow(row.aliases_json),
    content: row.content, keywords: aliasesFromRow(row.keywords_json), createdAt: metricDate(row.created_at), status: row.status, currentVersion: Number(row.version), upgradeAvailable: Number(row.version)>Number(row.metric_version) }));
}

/** Limited management controls: publication/archive state only; definitions remain Skill-managed. */
export async function updateMetricKnowledgeManagement(
  tenantId: number,
  metricKey: string,
  userId: number,
  input: { status: "active" | "disabled" | "archived" },
) {
  const params: Array<string | number> = [input.status, userId, tenantId, metricKey];
  const [result] = await getDbPool().execute(
    "UPDATE tenant_metric_knowledge SET status=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND metric_key=? AND status<>'deleted'",
    params,
  );
  return Number((result as { affectedRows?: number }).affectedRows || 0) > 0 || await metricKnowledgeExists(tenantId, metricKey);
}

/** Only archived metrics can be deleted; keep publication/version traces available. */
export async function deleteMetricKnowledgeManagement(tenantId: number, metricKey: string, userId: number) {
  const [result] = await getDbPool().execute(
    "UPDATE tenant_metric_knowledge SET status='deleted', updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND metric_key=? AND status='archived' AND NOT EXISTS (SELECT 1 FROM tenant_report_metric_binding b JOIN tenant_report r ON r.tenant_id=b.tenant_id AND r.code=b.report_code WHERE b.tenant_id=tenant_metric_knowledge.tenant_id AND b.metric_key=tenant_metric_knowledge.metric_key AND r.deleted_at IS NULL)",
    [userId, tenantId, metricKey],
  );
  return Number((result as { affectedRows?: number }).affectedRows || 0) > 0;
}

async function metricKnowledgeExists(tenantId: number, metricKey: string) {
  const [rows] = await getDbPool().query<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM tenant_metric_knowledge WHERE tenant_id=? AND metric_key=? AND status<>'deleted' LIMIT 1",
    [tenantId, metricKey],
  );
  return rows.length > 0;
}

export async function listMetricKnowledgeProposals(tenantId: number, input?: {
  keyword?: unknown;
  limit?: unknown;
}) {
  const keyword = trimText(input?.keyword, 160);
  const normalizedKeyword = normalizeMetricTerm(keyword);
  const limit = clampLimit(input?.limit, 100, 100);
  const [rows] = await getDbPool().query<Array<MetricProposalRow & {
    report_code: string;
    source_report_name: string | null;
    source_report_folder_name: string | null;
    status: string;
    failure_reason: string | null;
    created_at: string | Date;
    updated_at: string | Date;
    updated_by_name: string | null; owner_name: string | null;
  }>>(
    `SELECT p.id, p.metric_key, p.name, p.normalized_name, p.aliases_json, p.content, p.keywords_json, p.created_at,
            p.fingerprint, p.action, p.confirmed, p.validated, p.previous_json, p.report_code, p.status, p.failure_reason, p.updated_at,
            updater.name AS updated_by_name, creator.name AS owner_name,
            r.name AS source_report_name, f.name AS source_report_folder_name
       FROM report_metric_knowledge_proposal p
       LEFT JOIN tenant_user updater ON updater.tenant_id=p.tenant_id AND updater.id=p.updated_by
       LEFT JOIN tenant_user creator ON creator.tenant_id=p.tenant_id AND creator.id=p.created_by
       LEFT JOIN tenant_report r ON r.tenant_id=p.tenant_id AND r.code=p.report_code
       LEFT JOIN tenant_report_folder f ON f.tenant_id=r.tenant_id AND f.id=r.folder_id
      WHERE p.tenant_id=? AND p.status IN ('pending', 'draft', 'rejected')
        AND (?='' OR p.normalized_name LIKE ? OR p.name LIKE ? OR p.content LIKE ? OR p.keywords_json LIKE ?)
      ORDER BY p.created_at DESC
      LIMIT ?`,
    [tenantId, normalizedKeyword, `%${normalizedKeyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, limit],
  );
  return {
    keyword,
    items: rows.map((row) => ({
      id: Number(row.id),
      metricKey: row.metric_key,
      name: row.name,
      aliases: aliasesFromRow(row.aliases_json),
      content: row.content, keywords: aliasesFromRow(row.keywords_json), createdAt: metricDate(row.created_at),
      action: row.action,
      confirmed: Boolean(row.confirmed),
      validated: Boolean(row.validated),
      status: row.status,
      failureReason: row.failure_reason || null,
      phase: row.status === "rejected" ? "conflict" : !row.confirmed ? "awaiting_confirmation" : !row.validated ? "awaiting_validation" : "ready",
      sourceReportCode: row.report_code,
      baseVersion: (parseJson(row.previous_json) as { version?: number } | null)?.version || 0,
      sourceReportName: row.source_report_name
        ? [row.source_report_folder_name, row.source_report_name].filter(Boolean).join("/")
        : null,
      updatedAt: metricDate(row.updated_at),
      updatedByName: row.updated_by_name || null, ownerName: row.owner_name || null,
    })),
  } as const;
}

async function findExistingMetric(
  executor: QueryExecutor,
  tenantId: number,
  metricKey: string,
  normalizedName: string,
  includeDisabled = false,
  lockForUpdate = false,
) {
  const [rows] = await executor.query<MetricKnowledgeRow[]>(
    `SELECT id, metric_key, name, normalized_name, aliases_json, content, keywords_json, created_at, status,
            version, fingerprint, accepted_count, rejected_count, updated_at
       FROM tenant_metric_knowledge
      WHERE tenant_id=? ${includeDisabled ? "" : "AND status='active'"} AND metric_key=?
      ORDER BY CASE WHEN metric_key=? THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1${lockForUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, metricKey, metricKey],
  );
  return rows[0] || null;
}

export async function proposeMetricKnowledge(input: {
  tenantId: number;
  reportCode: string;
  conversationId?: string | null;
  dshSessionId: string;
  userId: number;
  sqlPreviewValidated: boolean;
  metricKey?: unknown;
  name?: unknown;
  aliases?: unknown;
  content?: unknown;
  keywords?: unknown;
  baseVersion?: unknown;
  confirmed?: unknown;
}) {
  if (typeof input.content !== "string" || !input.content.trim()) throw new Error("METRIC_CONTENT_REQUIRED");
  if (input.content.length > 60000) throw new Error("METRIC_CONTENT_TOO_LARGE");
  if (typeof input.name !== "string" || input.name.trim().length > 160) throw new Error("METRIC_NAME_INVALID");
  for (const value of [input.aliases, input.keywords]) {
    if (value !== undefined && (!Array.isArray(value) || value.length > 30 || value.some(item => typeof item !== "string" || !item.trim() || item.length > 160))) throw new Error("METRIC_KEYWORDS_INVALID");
  }
  if (!Number.isInteger(input.baseVersion) || Number(input.baseVersion) < 0) throw new Error("METRIC_BASE_VERSION_REQUIRED");
  const name = trimText(input.name, 160);
  if (!name) throw new Error("METRIC_NAME_REQUIRED");
  const normalizedName = normalizeMetricTerm(name);
  const requestedKey = normalizeMetricKey(trimText(input.metricKey, 100));
  const lookupKey = requestedKey || metricKeyForName(name);
  const existing = await findExistingMetric(getDbPool(), input.tenantId, lookupKey, normalizedName, true);
  if (existing && existing.status !== "active") throw new Error("METRIC_NOT_ACTIVE");
  if (existing && input.baseVersion === undefined) throw new Error("METRIC_BASE_VERSION_REQUIRED");
  if (input.baseVersion !== undefined && Number(input.baseVersion) !== Number(existing?.version || 0)) throw new Error("METRIC_VERSION_CONFLICT");
  const metricKey = existing?.metric_key || lookupKey;
  const content = input.content.trim();
  const keywords = input.keywords === undefined && existing ? aliasesFromRow(existing.keywords_json) : stringList(input.keywords, 30, 160);
  const aliases = input.aliases === undefined && existing ? aliasesFromRow(existing.aliases_json) : stringList(input.aliases, 30, 160);
  const normalizedAliases = Array.from(new Set(aliases.map(normalizeMetricTerm).filter(Boolean)));
  const fingerprint = semanticFingerprint(content, name, aliases, keywords);
  const confirmed = input.confirmed === true;
  const existingFingerprint = existing?.fingerprint || "";
  const action = existing ? existingFingerprint === fingerprint ? "reuse" : "update" : "create";

  const validated = input.sqlPreviewValidated;
  const proposalKey = createHash("sha256")
    .update(`${input.tenantId}:${input.reportCode}:${input.dshSessionId}:${metricKey}:${input.baseVersion}:${fingerprint}`)
    .digest("hex");
  const previous = existing ? metricView(existing) : null;
  const [finished] = await getDbPool().query<RowDataPacket[]>("SELECT published_version FROM report_metric_knowledge_proposal WHERE proposal_key=? AND tenant_id=? AND status='finalized'", [proposalKey,input.tenantId]);
  if (finished.length) return { accepted: true, decision: action, metricKey, version: Number(finished[0].published_version), fingerprint, confirmed: true, validated: true, publication: "already_finalized" } as const;
  await getDbPool().execute("UPDATE report_metric_knowledge_proposal SET status='superseded', updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND report_code=? AND dsh_session_id=? AND metric_key=? AND status IN ('pending','draft') AND proposal_key<>?", [input.userId, input.tenantId, input.reportCode, input.dshSessionId, metricKey, proposalKey]);
  await getDbPool().execute(
    `INSERT INTO report_metric_knowledge_proposal
      (proposal_key, tenant_id, report_code, conversation_id, dsh_session_id, metric_key, name,
       normalized_name, aliases_json, normalized_aliases_json, content, keywords_json, fingerprint,
       action, confirmed, validated, status, previous_json, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CONVERT(? USING utf8mb4), ?, ?)
     ON DUPLICATE KEY UPDATE
       conversation_id=CASE WHEN status='finalized' THEN conversation_id ELSE VALUES(conversation_id) END,
       name=CASE WHEN status='finalized' THEN name ELSE VALUES(name) END,
       aliases_json=CASE WHEN status='finalized' THEN aliases_json ELSE VALUES(aliases_json) END,
       normalized_aliases_json=CASE WHEN status='finalized' THEN normalized_aliases_json ELSE VALUES(normalized_aliases_json) END,
       content=CASE WHEN status='finalized' THEN content ELSE VALUES(content) END,
       keywords_json=CASE WHEN status='finalized' THEN keywords_json ELSE VALUES(keywords_json) END,
       action=CASE WHEN status='finalized' THEN action ELSE VALUES(action) END,
       confirmed=CASE WHEN status='finalized' THEN confirmed ELSE VALUES(confirmed) END,
       validated=CASE WHEN status='finalized' THEN validated ELSE VALUES(validated) END,
       previous_json=CASE WHEN status='finalized' THEN previous_json ELSE VALUES(previous_json) END,
       updated_by=CASE WHEN status='finalized' THEN updated_by ELSE VALUES(updated_by) END,
       failure_reason=CASE WHEN status='finalized' THEN failure_reason ELSE NULL END,
       updated_at=CASE WHEN status='finalized' THEN updated_at ELSE CURRENT_TIMESTAMP END,
       status=CASE WHEN status='finalized' THEN status ELSE 'pending' END`,
    [
      proposalKey,
      input.tenantId,
      input.reportCode,
      input.conversationId || null,
      input.dshSessionId,
      metricKey,
      name,
      normalizedName,
      JSON.stringify(aliases),
      JSON.stringify(normalizedAliases),
      content,
      JSON.stringify(keywords),
      fingerprint,
      action,
      confirmed ? 1 : 0,
      validated ? 1 : 0,
      previous ? JSON.stringify(previous) : null,
      input.userId,
      input.userId,
    ],
  );
  return {
    accepted: true,
    decision: action,
    metricKey,
    version: existing ? Number(existing.version) + (action === "update" ? 1 : 0) : 1,
    fingerprint,
    confirmed,
    validated,
    publication: confirmed && validated ? "after_report_commit" : "draft",
  } as const;
}

function mergeAliases(existing: string[], proposed: string[], name: string) {
  return Array.from(new Set([...existing, ...proposed].map((item) => trimText(item, 160)).filter(Boolean))).slice(0, 30);
}

export async function finalizeMetricKnowledgeProposals(input: {
  tenantId: number;
  reportCode: string;
  conversationId?: string | null;
  dshSessionId: string;
  opId: string;
  bindings?: MetricBindingInput[];
}) {
  const connection = await getDbPool().getConnection();
  let finalized = 0;
  let drafts = 0;
  let created = 0;
  let updated = 0;
  let reused = 0;
  let rejected = 0;
  const rejectedIds: number[] = [];
  try {
    await connection.beginTransaction();
    const [commits] = await connection.query<Array<RowDataPacket & { user_id: number }>>(
      "SELECT user_id FROM report_edit_audit WHERE tenant_id=? AND report_code=? AND op_id=? AND status='success' AND commit_hash IS NOT NULL LIMIT 1",
      [input.tenantId,input.reportCode,input.opId]);
    if (!commits.length) throw new Error("METRIC_REPORT_COMMIT_REQUIRED");
    const [proposals] = await connection.query<MetricProposalRow[]>(
      `SELECT id, metric_key, name, normalized_name, aliases_json, content, keywords_json, created_at, fingerprint,
              action, confirmed, validated, previous_json, created_by, updated_by
         FROM report_metric_knowledge_proposal
        WHERE tenant_id=? AND report_code=? AND dsh_session_id=? AND status='pending'
        ORDER BY id ASC
        FOR UPDATE`,
      [input.tenantId, input.reportCode, input.dshSessionId],
    );

    for (const proposal of proposals) {
      if (input.bindings && !input.bindings.some(binding => binding.metricKey === proposal.metric_key)) {
        await connection.execute("UPDATE report_metric_knowledge_proposal SET status='superseded', failure_reason='未被当前报表引用清单采用', updated_at=CURRENT_TIMESTAMP WHERE id=?", [proposal.id]);
        continue;
      }
      if (!proposal.confirmed || !proposal.validated) {
        await connection.execute(
          "UPDATE report_metric_knowledge_proposal SET status='draft', source_op_id=?, conversation_id=COALESCE(conversation_id, ?) WHERE id=?",
          [input.opId, input.conversationId || null, proposal.id],
        );
        drafts += 1;
        continue;
      }

      const existing = await findExistingMetric(
        connection,
        input.tenantId,
        proposal.metric_key,
        proposal.normalized_name,
        true,
        true,
      );
      const proposedAliases = aliasesFromRow(proposal.aliases_json);
      const content = proposal.content;
      const keywords = aliasesFromRow(proposal.keywords_json);
      const previous = parseJson(proposal.previous_json);
      const existingFingerprint = existing?.fingerprint || "";
      const previousFingerprint = isRecord(previous) ? previous.fingerprint : "";
      const hasConcurrentConflict = Boolean(existing && existing.status !== "active")
        || Boolean(existing && isRecord(previous) && Number(previous.version) !== Number(existing.version))
        || (!existing && proposal.action !== "create")
        || Boolean(existing
          && existingFingerprint !== proposal.fingerprint
          && (proposal.action === "create" || !previousFingerprint || existingFingerprint !== previousFingerprint));
      if (hasConcurrentConflict) {
        rejectedIds.push(Number(proposal.id));
        await connection.execute(
          "UPDATE report_metric_knowledge_proposal SET status='rejected', failure_reason='指标版本或状态已变化，请重新读取并确认', source_op_id=?, conversation_id=COALESCE(conversation_id, ?) WHERE id=?",
          [input.opId, input.conversationId || null, proposal.id],
        );
        rejected += 1;
        continue;
      }
      let version = 1;
      if (!existing) {
        const aliases = mergeAliases([], proposedAliases, proposal.name);
        const normalizedAliases = Array.from(new Set(aliases.map(normalizeMetricTerm).filter(Boolean)));
        await connection.execute(
          `INSERT INTO tenant_metric_knowledge
            (tenant_id, metric_key, name, normalized_name, aliases_json, normalized_aliases_json,
             search_text, content, keywords_json, status, version, fingerprint, source_report_code,
             source_conversation_id, source_op_id, created_by, updated_by, accepted_count, last_used_at, last_validated_at)
           SELECT tenant_id, metric_key, name, normalized_name, ?, ?, ?, content, keywords_json, 'active', 1,
                  fingerprint, report_code, COALESCE(conversation_id, ?), ?, created_by, created_by, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
             FROM report_metric_knowledge_proposal WHERE id=?`,
          [JSON.stringify(aliases), JSON.stringify(normalizedAliases), normalizeMetricTerm([proposal.name, ...aliases, ...keywords, content].join(" ")), input.conversationId || null, input.opId, proposal.id],
        );
        created += 1;
      } else {
        const changed = proposal.action === "update";
        const name = changed ? proposal.name : existing.name;
        const normalizedName = normalizeMetricTerm(name);
        const aliases = changed ? mergeAliases([], proposedAliases, name) : aliasesFromRow(existing.aliases_json);
        const normalizedAliases = Array.from(new Set(aliases.map(normalizeMetricTerm).filter(Boolean)));
        version = changed ? Number(existing.version) + 1 : Number(existing.version);
        if (changed) await connection.execute(
          `UPDATE tenant_metric_knowledge
              SET name=?, normalized_name=?, aliases_json=?, normalized_aliases_json=?, search_text=?, updated_by=COALESCE(?, updated_by), updated_at=CURRENT_TIMESTAMP,
                  content=?, keywords_json=?, status='active', version=?, fingerprint=?, source_report_code=?,
                  source_conversation_id=?, source_op_id=?, accepted_count=accepted_count+1,
                  last_used_at=CURRENT_TIMESTAMP, last_validated_at=CURRENT_TIMESTAMP
            WHERE id=?`,
          [
            name,
            normalizedName,
            JSON.stringify(aliases),
            JSON.stringify(normalizedAliases),
            normalizeMetricTerm([name, ...aliases, ...keywords, content].join(" ")),
            changed ? (proposal.updated_by ?? proposal.created_by ?? null) : null,
            content,
            JSON.stringify(keywords),
            version,
            changed ? proposal.fingerprint : existing.fingerprint,
            input.reportCode,
            input.conversationId || null,
            input.opId,
            existing.id,
          ],
        );
        if (changed) updated += 1;
        else {
          await connection.execute("UPDATE tenant_metric_knowledge SET accepted_count=accepted_count+1, last_used_at=CURRENT_TIMESTAMP, last_validated_at=CURRENT_TIMESTAMP, updated_at=updated_at WHERE id=?", [existing.id]);
          reused += 1;
        }
      }

      if (input.bindings && !input.bindings.some(binding => binding.metricKey === proposal.metric_key && binding.version === version)) {
        throw new Error("METRIC_BINDING_VERSION_MISMATCH");
      }
      await connection.execute(`INSERT IGNORE INTO tenant_metric_knowledge_version
        (tenant_id,metric_key,version,name,aliases_json,content,keywords_json,fingerprint,change_summary,source_report_code,source_op_id,created_by)
        SELECT tenant_id,metric_key,version,name,aliases_json,content,keywords_json,fingerprint,?,source_report_code,source_op_id,updated_by
        FROM tenant_metric_knowledge WHERE tenant_id=? AND metric_key=?`,
        [existing ? "Skill 确认并校验后的口径修订" : "Skill 首次确认并校验", input.tenantId, proposal.metric_key]);
      await connection.execute(`INSERT INTO tenant_report_metric_binding
        (tenant_id,report_code,metric_key,metric_version,source_op_id,bound_by) VALUES (?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE metric_version=VALUES(metric_version), source_op_id=VALUES(source_op_id), bound_by=VALUES(bound_by), updated_at=CURRENT_TIMESTAMP`,
        [input.tenantId,input.reportCode,proposal.metric_key,version,input.opId,proposal.updated_by ?? proposal.created_by ?? null]);
      await connection.execute(
        "UPDATE report_metric_knowledge_proposal SET status='finalized', source_op_id=?, published_version=?, conversation_id=COALESCE(conversation_id, ?) WHERE id=?",
        [input.opId, version, input.conversationId || null, proposal.id],
      );
      finalized += 1;
    }
    if (rejected && input.bindings !== undefined) throw new Error("METRIC_PROPOSAL_CONFLICT");
    if (input.bindings !== undefined) await replaceMetricBindings(connection, {
      ...input, bindings: parseMetricBindings(input.bindings)!, userId: commits[0].user_id,
    });
    await connection.commit();
    if (finalized) await rebuildMetricSearchIndex(input.tenantId, [...new Set(proposals.map(p => p.metric_key))], { skipUnchanged: true }).catch(() => null);
    return { finalized, drafts, rejected, created, updated, reused };
  } catch (error) {
    await connection.rollback();
    // Preserve conflict evidence after rolling back the publication batch. Never bind a
    // stale candidate to a different writer's version that happens to have the same number.
    for (const id of rejectedIds) await connection.execute("UPDATE report_metric_knowledge_proposal SET status='rejected', failure_reason='指标版本或状态已变化，请重新读取并确认', updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?", [input.tenantId,id]);
    throw error;
  } finally {
    connection.release();
  }
}

export async function recordMetricFeedback(input: {
  tenantId: number;
  reportCode: string;
  conversationId?: string | null;
  userId: number;
  metricKey?: unknown;
  action?: unknown;
  reason?: unknown;
  before?: unknown;
  after?: unknown;
}) {
  const metricKey = normalizeMetricKey(trimText(input.metricKey, 100));
  if (!metricKey) throw new Error("METRIC_KEY_REQUIRED");
  const action = input.action === "accepted" || input.action === "rejected" || input.action === "corrected"
    ? input.action
    : null;
  if (!action) throw new Error("METRIC_FEEDBACK_INVALID");
  const reason = trimText(input.reason, 500);
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [metrics] = await connection.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM tenant_metric_knowledge WHERE tenant_id=? AND metric_key=? LIMIT 1 FOR UPDATE",
      [input.tenantId, metricKey],
    );
    const metric = metrics[0];
    if (!metric) throw new Error("METRIC_NOT_FOUND");

    await connection.execute(
      `INSERT INTO tenant_bi_feedback
        (tenant_id, knowledge_type, knowledge_key, action, before_json, after_json, reason,
         conversation_id, report_code, user_id)
       VALUES (?, 'metric', ?, ?, CONVERT(? USING utf8mb4), CONVERT(? USING utf8mb4), ?, ?, ?, ?)`,
      [
        input.tenantId,
        metricKey,
        action,
        input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after),
        reason || null,
        input.conversationId || null,
        input.reportCode,
        input.userId,
      ],
    );
    const counterColumn = action === "accepted" ? "accepted_count" : "rejected_count";
    await connection.execute(
      `UPDATE tenant_metric_knowledge SET ${counterColumn}=${counterColumn}+1 WHERE id=?`,
      [metric.id],
    );
    await connection.commit();
    return { recorded: true, metricKey, action } as const;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export type MetricBindingInput = { metricKey: string; version: number };
export function parseMetricBindings(value: unknown): MetricBindingInput[] | undefined {
  if (value === undefined) return undefined; // Legacy reports: preserve existing associations.
  if (!Array.isArray(value) || value.length > 200) throw new Error("METRIC_BINDINGS_INVALID");
  const seen = new Set<string>();
  return value.map(item => {
    if (!isRecord(item) || typeof item.metricKey !== "string" || !/^[a-z0-9_-]{1,100}$/.test(item.metricKey)
      || !Number.isInteger(item.version) || Number(item.version) < 1 || seen.has(item.metricKey)) throw new Error("METRIC_BINDINGS_INVALID");
    seen.add(item.metricKey);
    return { metricKey: item.metricKey, version: Number(item.version) };
  });
}

async function replaceMetricBindings(connection: PoolConnection, input: {
  tenantId: number; reportCode: string; opId: string; userId: number | null; bindings: MetricBindingInput[];
}) {
  // Called in the same transaction as version publication. Historical pins remain readable.
  for (const binding of input.bindings) {
    const [versions] = await connection.query<RowDataPacket[]>(`SELECT v.version, m.status, b.metric_version
      FROM tenant_metric_knowledge_version v JOIN tenant_metric_knowledge m ON m.tenant_id=v.tenant_id AND m.metric_key=v.metric_key
      LEFT JOIN tenant_report_metric_binding b ON b.tenant_id=v.tenant_id AND b.metric_key=v.metric_key AND b.report_code=?
      WHERE v.tenant_id=? AND v.metric_key=? AND v.version=? FOR UPDATE`,
      [input.reportCode,input.tenantId,binding.metricKey,binding.version]);
    const row = versions[0];
    if (!row || (row.status !== "active" && Number(row.metric_version) !== binding.version)) throw new Error("METRIC_BINDING_UNAVAILABLE");
  }
  await connection.execute("DELETE FROM tenant_report_metric_binding WHERE tenant_id=? AND report_code=?", [input.tenantId,input.reportCode]);
  for (const binding of input.bindings) {
    await connection.execute(`INSERT INTO tenant_report_metric_binding (tenant_id,report_code,metric_key,metric_version,source_op_id,bound_by) VALUES (?,?,?,?,?,?)`,
      [input.tenantId,input.reportCode,binding.metricKey,binding.version,input.opId,input.userId]);
  }
}

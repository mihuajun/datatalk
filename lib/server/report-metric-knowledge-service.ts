import { createHash } from "node:crypto";

import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import { getDbPool } from "@/lib/server/mysql";

export type MetricKnowledgeDefinition = {
  definition: string;
  formula: string;
  grain: string;
  timeField: string;
  filters: string[];
  dedupRule: string;
  dataSourceRef: string;
  sourceRef: string;
};

export type MetricKnowledgeView = {
  metricKey: string;
  name: string;
  aliases: string[];
  definition: MetricKnowledgeDefinition;
  status: "verified" | "disabled";
  version: number;
  fingerprint: string;
  acceptedCount: number;
  rejectedCount: number;
  updatedAt: string;
};

export type MetricSearchIntent = {
  query: string;
  formulaHint?: string;
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
  definition_json: unknown;
  status: "verified" | "disabled";
  version: number;
  fingerprint: string;
  accepted_count: number;
  rejected_count: number;
  updated_at: string | Date;
  match_score?: number | string;
};

type MetricProposalRow = RowDataPacket & {
  id: number;
  metric_key: string;
  name: string;
  normalized_name: string;
  aliases_json: unknown;
  definition_json: unknown;
  fingerprint: string;
  action: "create" | "update" | "reuse";
  confirmed: number;
  validated: number;
  previous_json: unknown;
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

function metricDefinition(value: unknown): MetricKnowledgeDefinition {
  const parsed = parseJson(value);
  const record = isRecord(parsed) ? parsed : {};
  return {
    definition: trimText(record.definition, 2000),
    formula: trimText(record.formula, 2000),
    grain: trimText(record.grain, 160),
    timeField: trimText(record.timeField, 160),
    filters: stringList(record.filters),
    dedupRule: trimText(record.dedupRule, 500),
    dataSourceRef: trimText(record.dataSourceRef, 160),
    sourceRef: trimText(record.sourceRef, 300),
  };
}

function aliasesFromRow(value: unknown) {
  return stringList(parseJson(value), 30, 160);
}

function metricView(row: MetricKnowledgeRow): MetricKnowledgeView {
  return {
    metricKey: row.metric_key,
    name: row.name,
    aliases: aliasesFromRow(row.aliases_json),
    definition: metricDefinition(row.definition_json),
    status: row.status,
    version: Number(row.version),
    fingerprint: row.fingerprint,
    acceptedCount: Number(row.accepted_count || 0),
    rejectedCount: Number(row.rejected_count || 0),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function semanticFingerprint(definition: MetricKnowledgeDefinition) {
  return createHash("sha256").update(JSON.stringify({
    definition: normalizeMetricTerm(definition.definition),
    formula: normalizeMetricExpression(definition.formula),
    grain: normalizeMetricTerm(definition.grain),
    timeField: normalizeMetricTerm(definition.timeField),
    filters: definition.filters.map(normalizeMetricExpression).sort(),
    dedupRule: normalizeMetricTerm(definition.dedupRule),
    dataSourceRef: normalizeMetricTerm(definition.dataSourceRef),
  })).digest("hex");
}

function clampLimit(value: unknown, fallback = 10, max = 20) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function compareExplicitHint(
  label: string,
  hint: string | undefined,
  candidate: string,
  weight: number,
  normalize: (value: string) => string = normalizeMetricTerm,
) {
  const normalizedHint = normalize(trimText(hint));
  if (!normalizedHint) return { score: 0, conflicts: [] as string[] };
  const normalizedCandidate = normalize(candidate);
  if (!normalizedCandidate) return { score: 0, conflicts: [`候选指标未声明${label}`] };
  const matches = normalizedCandidate === normalizedHint;
  return matches
    ? { score: weight, conflicts: [] as string[] }
    : { score: 0, conflicts: [`${label}不一致：请求为“${trimText(hint)}”，候选为“${candidate}”`] };
}

function rankCandidate(intent: MetricSearchIntent, row: MetricKnowledgeRow) {
  const view = metricView(row);
  let score = Number(row.match_score || 0);
  const conflicts: string[] = [];
  for (const compared of [
    compareExplicitHint("公式", intent.formulaHint, view.definition.formula, 20, normalizeMetricExpression),
    compareExplicitHint("时间字段", intent.timeFieldHint, view.definition.timeField, 10),
    compareExplicitHint("去重规则", intent.dedupRule, view.definition.dedupRule, 10),
    compareExplicitHint("数据源", intent.dataSource, view.definition.dataSourceRef, 10),
  ]) {
    score += compared.score;
    conflicts.push(...compared.conflicts);
  }

  for (const requestedFilter of stringList(intent.filters)) {
    const normalizedFilter = normalizeMetricExpression(requestedFilter);
    const matches = view.definition.filters.some((candidate) => normalizeMetricExpression(candidate) === normalizedFilter);
    if (matches) score += 5;
    else conflicts.push(`候选指标未包含过滤条件“${requestedFilter}”`);
  }

  if (conflicts.length) score -= 100;
  return { ...view, score, conflicts };
}

export async function searchMetricKnowledge(tenantId: number, intent: MetricSearchIntent) {
  const query = trimText(intent.query, 160);
  const normalizedQuery = normalizeMetricTerm(query);
  if (!normalizedQuery) throw new Error("METRIC_QUERY_REQUIRED");
  const metricKeyQuery = normalizeMetricKey(query);
  const limit = clampLimit(intent.limit);
  const likeQuery = `%${normalizedQuery}%`;
  const [rows] = await getDbPool().query<MetricKnowledgeRow[]>(
    `SELECT id, metric_key, name, normalized_name, aliases_json, definition_json, status,
            version, fingerprint, accepted_count, rejected_count, updated_at,
            CASE
              WHEN metric_key=? THEN 100
              WHEN normalized_name=? THEN 95
              WHEN JSON_CONTAINS(normalized_aliases_json, JSON_QUOTE(?)) THEN 90
              WHEN search_text LIKE ? THEN 60
              ELSE 0
            END AS match_score
      FROM tenant_metric_knowledge
      WHERE tenant_id=? AND status='verified'
        AND (metric_key=? OR normalized_name=? OR JSON_CONTAINS(normalized_aliases_json, JSON_QUOTE(?)) OR search_text LIKE ?)
      ORDER BY match_score DESC, accepted_count DESC, updated_at DESC
      LIMIT ?`,
    [metricKeyQuery, normalizedQuery, normalizedQuery, likeQuery, tenantId, metricKeyQuery, normalizedQuery, normalizedQuery, likeQuery, limit],
  );

  const candidates = rows.map((row) => rankCandidate(intent, row)).sort((left, right) => right.score - left.score);
  const exactUsable = candidates.filter((candidate) => candidate.score >= 90 && candidate.conflicts.length === 0);
  const decision = !candidates.length ? "create" : exactUsable.length === 1 ? "reuse" : "confirm";
  return {
    decision,
    query,
    candidates,
    question: decision === "confirm"
      ? `“${query}”命中了多个口径或存在条件冲突，请先确认要使用哪一个定义。`
      : null,
  } as const;
}

export async function listMetricKnowledge(tenantId: number, input?: {
  keyword?: unknown;
  limit?: unknown;
}) {
  const keyword = trimText(input?.keyword, 160);
  const normalizedKeyword = normalizeMetricTerm(keyword);
  const limit = clampLimit(input?.limit, 20, 100);
  const [rows] = await getDbPool().query<MetricKnowledgeRow[]>(
    `SELECT id, metric_key, name, normalized_name, aliases_json, definition_json, status,
            version, fingerprint, accepted_count, rejected_count, updated_at
       FROM tenant_metric_knowledge
      WHERE tenant_id=? AND status='verified'
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

async function findExistingMetric(
  executor: QueryExecutor,
  tenantId: number,
  metricKey: string,
  normalizedName: string,
  includeDisabled = false,
  lockForUpdate = false,
) {
  const [rows] = await executor.query<MetricKnowledgeRow[]>(
    `SELECT id, metric_key, name, normalized_name, aliases_json, definition_json, status,
            version, fingerprint, accepted_count, rejected_count, updated_at
       FROM tenant_metric_knowledge
      WHERE tenant_id=? ${includeDisabled ? "" : "AND status='verified'"} AND (metric_key=? OR normalized_name=?)
      ORDER BY CASE WHEN metric_key=? THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1${lockForUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, metricKey, normalizedName, metricKey],
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
  definition?: unknown;
  formula?: unknown;
  grain?: unknown;
  timeField?: unknown;
  filters?: unknown;
  dedupRule?: unknown;
  dataSource?: unknown;
  sourceRef?: unknown;
  confirmed?: unknown;
}) {
  const name = trimText(input.name, 160);
  if (!name) throw new Error("METRIC_NAME_REQUIRED");
  const normalizedName = normalizeMetricTerm(name);
  const requestedKey = normalizeMetricKey(trimText(input.metricKey, 100));
  const lookupKey = requestedKey || metricKeyForName(name);
  const existing = await findExistingMetric(getDbPool(), input.tenantId, lookupKey, normalizedName);
  const metricKey = existing?.metric_key || lookupKey;
  const definition: MetricKnowledgeDefinition = {
    definition: trimText(input.definition, 2000),
    formula: trimText(input.formula, 2000),
    grain: trimText(input.grain, 160),
    timeField: trimText(input.timeField, 160),
    filters: stringList(input.filters),
    dedupRule: trimText(input.dedupRule, 500),
    dataSourceRef: trimText(input.dataSource, 160),
    sourceRef: trimText(input.sourceRef, 300),
  };
  if (!definition.definition) throw new Error("METRIC_DEFINITION_REQUIRED");
  if (!definition.formula) throw new Error("METRIC_FORMULA_REQUIRED");
  if (!definition.sourceRef) throw new Error("METRIC_SOURCE_REF_REQUIRED");

  const aliases = Array.from(new Set([name, ...stringList(input.aliases, 30, 160)]));
  const normalizedAliases = Array.from(new Set(aliases.map(normalizeMetricTerm).filter(Boolean)));
  const fingerprint = semanticFingerprint(definition);
  const confirmed = input.confirmed === true;
  const existingFingerprint = existing ? semanticFingerprint(metricDefinition(existing.definition_json)) : "";
  const action = existing ? existingFingerprint === fingerprint ? "reuse" : "update" : "create";
  if (action === "update" && !confirmed) {
    return {
      accepted: false,
      decision: "confirm",
      question: `指标“${name}”与已发布版本口径不同，请先让用户确认是否更新公共指标。`,
      existing: existing ? metricView(existing) : null,
    } as const;
  }

  const validated = input.sqlPreviewValidated;
  const proposalKey = createHash("sha256")
    .update(`${input.tenantId}:${input.dshSessionId}:${metricKey}:${fingerprint}`)
    .digest("hex");
  const previous = existing ? metricView(existing) : null;
  await getDbPool().execute(
    `INSERT INTO report_metric_knowledge_proposal
      (proposal_key, tenant_id, report_code, conversation_id, dsh_session_id, metric_key, name,
       normalized_name, aliases_json, normalized_aliases_json, definition_json, fingerprint,
       action, confirmed, validated, status, previous_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CONVERT(? USING utf8mb4), ?)
     ON DUPLICATE KEY UPDATE
       conversation_id=VALUES(conversation_id), name=VALUES(name), aliases_json=VALUES(aliases_json),
       normalized_aliases_json=VALUES(normalized_aliases_json), definition_json=VALUES(definition_json),
       action=VALUES(action), confirmed=VALUES(confirmed), validated=VALUES(validated),
       status='pending', previous_json=VALUES(previous_json), updated_at=CURRENT_TIMESTAMP`,
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
      JSON.stringify(definition),
      fingerprint,
      action,
      confirmed ? 1 : 0,
      validated ? 1 : 0,
      previous ? JSON.stringify(previous) : null,
      input.userId,
    ],
  );
  return {
    accepted: true,
    decision: action,
    metricKey,
    fingerprint,
    confirmed,
    validated,
    publication: confirmed && validated ? "after_report_commit" : "draft",
  } as const;
}

function mergeAliases(existing: string[], proposed: string[], name: string) {
  return Array.from(new Set([name, ...existing, ...proposed].map((item) => trimText(item, 160)).filter(Boolean))).slice(0, 30);
}

export async function finalizeMetricKnowledgeProposals(input: {
  tenantId: number;
  reportCode: string;
  conversationId?: string | null;
  dshSessionId: string;
  opId: string;
}) {
  const connection = await getDbPool().getConnection();
  let finalized = 0;
  let drafts = 0;
  let created = 0;
  let updated = 0;
  let reused = 0;
  let rejected = 0;
  try {
    await connection.beginTransaction();
    const [proposals] = await connection.query<MetricProposalRow[]>(
      `SELECT id, metric_key, name, normalized_name, aliases_json, definition_json, fingerprint,
              action, confirmed, validated, previous_json
         FROM report_metric_knowledge_proposal
        WHERE tenant_id=? AND report_code=? AND dsh_session_id=? AND status='pending'
        ORDER BY id ASC
        FOR UPDATE`,
      [input.tenantId, input.reportCode, input.dshSessionId],
    );

    for (const proposal of proposals) {
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
      const definition = metricDefinition(proposal.definition_json);
      const previous = parseJson(proposal.previous_json);
      const existingFingerprint = existing ? semanticFingerprint(metricDefinition(existing.definition_json)) : "";
      const previousFingerprint = isRecord(previous)
        ? semanticFingerprint(metricDefinition(previous.definition))
        : "";
      const hasConcurrentConflict = (!existing && proposal.action !== "create")
        || Boolean(existing
          && existingFingerprint !== proposal.fingerprint
          && (proposal.action === "create" || !previousFingerprint || existingFingerprint !== previousFingerprint));
      if (hasConcurrentConflict) {
        await connection.execute(
          "UPDATE report_metric_knowledge_proposal SET status='rejected', source_op_id=?, conversation_id=COALESCE(conversation_id, ?) WHERE id=?",
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
             search_text, definition_json, status, version, fingerprint, source_report_code,
             source_conversation_id, source_op_id, created_by, accepted_count, last_used_at, last_validated_at)
           SELECT tenant_id, metric_key, name, normalized_name, ?, ?, ?, definition_json, 'verified', 1,
                  fingerprint, report_code, COALESCE(conversation_id, ?), ?, created_by, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
             FROM report_metric_knowledge_proposal WHERE id=?`,
          [JSON.stringify(aliases), JSON.stringify(normalizedAliases), normalizedAliases.join(" "), input.conversationId || null, input.opId, proposal.id],
        );
        created += 1;
      } else {
        const definitionChanged = existingFingerprint !== proposal.fingerprint;
        const changed = proposal.action === "update" && definitionChanged;
        const name = changed ? proposal.name : existing.name;
        const normalizedName = changed ? proposal.normalized_name : existing.normalized_name;
        const aliases = mergeAliases(aliasesFromRow(existing.aliases_json), proposedAliases, name);
        const normalizedAliases = Array.from(new Set(aliases.map(normalizeMetricTerm).filter(Boolean)));
        version = changed ? Number(existing.version) + 1 : Number(existing.version);
        await connection.execute(
          `UPDATE tenant_metric_knowledge
              SET name=?, normalized_name=?, aliases_json=?, normalized_aliases_json=?, search_text=?,
                  definition_json=?, status='verified', version=?, fingerprint=?, source_report_code=?,
                  source_conversation_id=?, source_op_id=?, accepted_count=accepted_count+1,
                  last_used_at=CURRENT_TIMESTAMP, last_validated_at=CURRENT_TIMESTAMP
            WHERE id=?`,
          [
            name,
            normalizedName,
            JSON.stringify(aliases),
            JSON.stringify(normalizedAliases),
            normalizedAliases.join(" "),
            JSON.stringify(definition),
            version,
            proposal.fingerprint,
            input.reportCode,
            input.conversationId || null,
            input.opId,
            existing.id,
          ],
        );
        if (changed) updated += 1;
        else reused += 1;
      }

      await connection.execute(
        "UPDATE report_metric_knowledge_proposal SET status='finalized', source_op_id=?, published_version=?, conversation_id=COALESCE(conversation_id, ?) WHERE id=?",
        [input.opId, version, input.conversationId || null, proposal.id],
      );
      finalized += 1;
    }
    await connection.commit();
    return { finalized, drafts, rejected, created, updated, reused };
  } catch (error) {
    await connection.rollback();
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

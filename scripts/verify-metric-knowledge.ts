import assert from "node:assert/strict";

import type { RowDataPacket } from "mysql2/promise";

import { getDbPool } from "../lib/server/mysql";
import {
  finalizeMetricKnowledgeProposals,
  proposeMetricKnowledge,
  recordMetricFeedback,
  searchMetricKnowledge,
} from "../lib/server/report-metric-knowledge-service";
import { ensureDatabaseBootstrap } from "../lib/server/database-bootstrap";

type MetricRow = RowDataPacket & {
  name: string;
  aliases_json: unknown;
  definition_json: unknown;
  status: string;
  version: number;
  accepted_count: number;
};

const runId = `${Date.now().toString(36)}-${process.pid}`;
const tenantId = 1_000_000_000 + Number(String(Date.now()).slice(-8));
const reportCode = `metric-test-${runId}`.slice(0, 50);
const keyPrefix = `test-${runId}`.slice(0, 70);
const userId = 1;
const pool = getDbPool();

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  return JSON.parse(value) as unknown;
}

function definition(overrides: Partial<{
  definition: string;
  formula: string;
  grain: string;
  timeField: string;
  filters: string[];
  dedupRule: string;
  dataSource: string;
  sourceRef: string;
}> = {}) {
  return {
    definition: "Paid order revenue",
    formula: "SUM(paid_amount)",
    grain: "day",
    timeField: "paid_at",
    filters: ["status = 'unpaid'"],
    dedupRule: "order_id",
    dataSource: "test-orders",
    sourceRef: "server.js#handler:metric-test",
    ...overrides,
  };
}

async function propose(input: {
  key: string;
  name: string;
  session: string;
  aliases?: string[];
  confirmed?: boolean;
  validated?: boolean;
  fields?: ReturnType<typeof definition>;
}) {
  const fields = input.fields || definition();
  const result = await proposeMetricKnowledge({
    tenantId,
    reportCode,
    conversationId: `conversation-${runId}`,
    dshSessionId: input.session,
    userId,
    sqlPreviewValidated: input.validated ?? true,
    metricKey: input.key,
    name: input.name,
    aliases: input.aliases || [],
    ...fields,
    confirmed: input.confirmed ?? true,
  });
  assert.equal(result.accepted, true, `proposal ${input.key} should be accepted`);
  return result;
}

async function finalize(session: string, op: string) {
  return finalizeMetricKnowledgeProposals({
    tenantId,
    reportCode,
    conversationId: `conversation-${runId}`,
    dshSessionId: session,
    opId: `${op}-${runId}`,
  });
}

async function getMetric(metricKey: string) {
  const [rows] = await pool.query<MetricRow[]>(
    `SELECT name, aliases_json, definition_json, status, version, accepted_count
       FROM tenant_metric_knowledge
      WHERE tenant_id=? AND metric_key=?`,
    [tenantId, metricKey],
  );
  return rows[0] || null;
}

async function countRows(table: string, clause = "", params: unknown[] = []) {
  const [rows] = await pool.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM ${table} WHERE tenant_id=? ${clause}`,
    [tenantId, ...params],
  );
  return Number(rows[0]?.total || 0);
}

async function cleanup() {
  await pool.execute("DELETE FROM tenant_bi_feedback WHERE tenant_id=?", [tenantId]);
  await pool.execute("DELETE FROM report_metric_knowledge_proposal WHERE tenant_id=?", [tenantId]);
  await pool.execute("DELETE FROM tenant_metric_knowledge WHERE tenant_id=?", [tenantId]);
  const remaining = {
    metrics: await countRows("tenant_metric_knowledge"),
    proposals: await countRows("report_metric_knowledge_proposal"),
    feedback: await countRows("tenant_bi_feedback"),
  };
  assert.deepEqual(remaining, { metrics: 0, proposals: 0, feedback: 0 });
  return remaining;
}

async function main() {
  const results: string[] = [];
  try {
    await ensureDatabaseBootstrap();
    const minus = await propose({
      key: `${keyPrefix}-minus`,
      name: "Net revenue minus",
      session: `${runId}-fingerprint-minus`,
      fields: definition({ formula: "SUM(amount - refund)" }),
    });
    const plus = await propose({
      key: `${keyPrefix}-plus`,
      name: "Net revenue plus",
      session: `${runId}-fingerprint-plus`,
      fields: definition({ formula: "SUM(amount + refund)" }),
    });
    assert.notEqual(minus.fingerprint, plus.fingerprint);
    results.push("formula operators produce different fingerprints");

    const metricKey = `${keyPrefix}-gmv`;
    const createSession = `${runId}-create`;
    const createdProposal = await propose({
      key: metricKey,
      name: "GMV",
      aliases: ["\u6210\u4ea4\u603b\u989d"],
      session: createSession,
    });
    assert.equal(createdProposal.decision, "create");
    assert.equal(createdProposal.publication, "after_report_commit");
    assert.deepEqual(await finalize(createSession, "create"), {
      finalized: 1,
      drafts: 0,
      rejected: 0,
      created: 1,
      updated: 0,
      reused: 0,
    });
    results.push("confirmed and previewed proposal is published");

    const exact = await searchMetricKnowledge(tenantId, { query: "GMV" });
    assert.equal(exact.decision, "reuse");
    assert.equal(exact.candidates[0]?.metricKey, metricKey);
    const alias = await searchMetricKnowledge(tenantId, { query: "\u6210\u4ea4\u603b\u989d" });
    assert.equal(alias.decision, "reuse");
    assert.equal(alias.candidates[0]?.metricKey, metricKey);
    results.push("exact name and localized alias are reusable");

    const filterConflict = await searchMetricKnowledge(tenantId, {
      query: "GMV",
      filters: ["status = 'paid'"],
    });
    assert.equal(filterConflict.decision, "confirm");
    assert.ok(filterConflict.candidates[0]?.conflicts.some((item) => item.includes("status = 'paid'")));
    results.push("paid and unpaid filters require confirmation");

    const draftKey = `${keyPrefix}-draft`;
    const draftSession = `${runId}-draft`;
    const draftProposal = await propose({
      key: draftKey,
      name: "Draft metric",
      session: draftSession,
      validated: false,
    });
    assert.equal(draftProposal.publication, "draft");
    assert.deepEqual(await finalize(draftSession, "draft"), {
      finalized: 0,
      drafts: 1,
      rejected: 0,
      created: 0,
      updated: 0,
      reused: 0,
    });
    assert.equal(await getMetric(draftKey), null);
    results.push("proposal without SQL preview remains a draft");

    const reuseSession = `${runId}-reuse-alias`;
    const reuseProposal = await propose({
      key: metricKey,
      name: "\u6210\u4ea4\u603b\u989d",
      aliases: ["GMV"],
      session: reuseSession,
    });
    assert.equal(reuseProposal.decision, "reuse");
    const reuseResult = await finalize(reuseSession, "reuse-alias");
    assert.equal(reuseResult.reused, 1);
    const reusedMetric = await getMetric(metricKey);
    assert.equal(reusedMetric?.name, "GMV");
    assert.deepEqual(new Set(parseJson(reusedMetric?.aliases_json) as string[]), new Set(["GMV", "\u6210\u4ea4\u603b\u989d"]));
    assert.equal(Number(reusedMetric?.version), 1);
    results.push("alias reuse preserves the primary metric name and version");

    const staleSession = `${runId}-stale`;
    const winnerSession = `${runId}-winner`;
    await propose({
      key: metricKey,
      name: "GMV",
      session: staleSession,
      fields: definition({ formula: "SUM(paid_amount) - SUM(refund_amount)" }),
    });
    await propose({
      key: metricKey,
      name: "GMV",
      session: winnerSession,
      fields: definition({ formula: "COUNT(DISTINCT order_id)" }),
    });
    const winner = await finalize(winnerSession, "winner");
    assert.equal(winner.updated, 1);
    const stale = await finalize(staleSession, "stale");
    assert.equal(stale.rejected, 1);
    const concurrentMetric = await getMetric(metricKey);
    assert.equal((parseJson(concurrentMetric?.definition_json) as { formula: string }).formula, "COUNT(DISTINCT order_id)");
    assert.equal(Number(concurrentMetric?.version), 2);
    results.push("stale concurrent proposal is rejected");

    const disabledKey = `${keyPrefix}-disabled`;
    const disabledCreateSession = `${runId}-disabled-create`;
    await propose({ key: disabledKey, name: "Disabled metric", session: disabledCreateSession });
    await finalize(disabledCreateSession, "disabled-create");
    await pool.execute(
      "UPDATE tenant_metric_knowledge SET status='disabled' WHERE tenant_id=? AND metric_key=?",
      [tenantId, disabledKey],
    );
    const reactivateSession = `${runId}-reactivate`;
    const reactivateProposal = await propose({ key: disabledKey, name: "Disabled metric", session: reactivateSession });
    assert.equal(reactivateProposal.decision, "create");
    const reactivated = await finalize(reactivateSession, "reactivate");
    assert.equal(reactivated.reused, 1);
    const reactivatedMetric = await getMetric(disabledKey);
    assert.equal(reactivatedMetric?.status, "verified");
    assert.equal(Number(reactivatedMetric?.version), 1);
    assert.equal(await countRows("tenant_metric_knowledge", "AND metric_key=?", [disabledKey]), 1);
    results.push("disabled metric is reactivated without a duplicate key failure");

    const acceptedBefore = Number((await getMetric(metricKey))?.accepted_count || 0);
    await recordMetricFeedback({
      tenantId,
      reportCode,
      conversationId: `conversation-${runId}`,
      userId,
      metricKey,
      action: "accepted",
      reason: "Verified with a unicode payload",
      before: { label: "\u65e7\u53e3\u5f84" },
      after: { label: "\u65b0\u53e3\u5f84", mark: "\ud83d\udcca" },
    });
    assert.equal(Number((await getMetric(metricKey))?.accepted_count), acceptedBefore + 1);
    assert.equal(await countRows("tenant_bi_feedback", "AND knowledge_key=?", [metricKey]), 1);
    await assert.rejects(
      recordMetricFeedback({
        tenantId,
        reportCode,
        userId,
        metricKey: `${keyPrefix}-missing`,
        action: "rejected",
      }),
      (error: unknown) => error instanceof Error && error.message === "METRIC_NOT_FOUND",
    );
    assert.equal(await countRows("tenant_bi_feedback", "AND knowledge_key=?", [`${keyPrefix}-missing`]), 0);
    results.push("feedback and counters commit atomically; missing metrics fail");

    console.log(JSON.stringify({ ok: true, tenantId, checks: results }, null, 2));
  } finally {
    try {
      const remaining = await cleanup();
      console.log(JSON.stringify({ cleanup: remaining }));
    } finally {
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

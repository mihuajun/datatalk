import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
async function main() {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"metric-content-v2-"));
  process.env.STUDIO_CONFIG_PATH=path.join(dir,"config.yaml");
  process.env.WORKSPACE_STORAGE_ROOT=path.join(dir,"workspace");
  await fs.writeFile(process.env.STUDIO_CONFIG_PATH,`database:\n  url: sqlite:${dir}/test.sqlite\n`);
  const {ensureDatabaseBootstrap}=await import("../lib/server/database-bootstrap");
  const {getDbPool}=await import("../lib/server/mysql");
  const {ensureMetricGovernanceSchema}=await import("../lib/server/metric-governance-schema");
  const {resetMetricContent}=await import("./reset-metric-content");
  const {proposeMetricKnowledge,finalizeMetricKnowledgeProposals,readReportMetricBindings,searchMetricKnowledge,listMetricKnowledgeHistory}=await import("../lib/server/report-metric-knowledge-service");
  const pool=getDbPool();
  try {
    await ensureDatabaseBootstrap();
    // Simulate an old JSON-only metric table with sample data from multiple tenants.
    await pool.query("DROP TABLE tenant_metric_knowledge");
    await pool.query("CREATE TABLE tenant_metric_knowledge (tenant_id INTEGER, definition_json TEXT)");
    await pool.execute("INSERT INTO tenant_metric_knowledge VALUES (43,?)",['{"definition":"legacy sample"}']);
    await assert.rejects(ensureMetricGovernanceSchema(pool,true),/METRIC_SCHEMA_RESET_REQUIRED/);
    const before=await resetMetricContent(false,1,undefined,true);
    assert.equal(before.mode,"dry-run");
    await assert.rejects(resetMetricContent(true,1,"wrong",true),/RESET_PREVIEW_CHANGED/);
    const reset=await resetMetricContent(true,1,before.digest,true);
    assert.equal(reset.mode,"executed");
    assert.equal(reset.protectedUnchanged,true);
    const [columns]=await pool.query<any[]>("PRAGMA table_info(tenant_metric_knowledge)");
    assert.ok(columns.some(c=>c.name==="content"));assert.ok(!columns.some(c=>c.name==="definition_json"));
    const content="业务定义：完整正文 📊\n计算逻辑：SUM(amount-refund)\nSQL 示例：SELECT SUM(amount-refund) FROM orders WHERE status = 'Paid'\n未确认事项：无\n补充说明：<script>not executable</script>";
    const input={tenantId:1,reportCode:"content-test",dshSessionId:"session-1",userId:1,sqlPreviewValidated:true,metricKey:"content-test",baseVersion:0,name:"纯文本指标",aliases:["正文指标"],keywords:["内容词"],content,confirmed:true};
    await assert.rejects(proposeMetricKnowledge({...input,content:""}),/METRIC_CONTENT_REQUIRED/);
    await assert.rejects(proposeMetricKnowledge({...input,content:"x".repeat(60001)}),/METRIC_CONTENT_TOO_LARGE/);
    await assert.rejects(proposeMetricKnowledge({...input,keywords:[4]}),/METRIC_KEYWORDS_INVALID/);
    await assert.rejects(proposeMetricKnowledge({...input,baseVersion:undefined}),/METRIC_BASE_VERSION_REQUIRED/);
    await pool.execute("INSERT INTO report_edit_audit (tenant_id,report_code,user_id,op_id,action,status,commit_hash) VALUES (1,'content-test',1,'op-1','ai_edit','success',?)",["a".repeat(40)]);
    const first=await proposeMetricKnowledge(input);assert.equal(first.version,1);
    await finalizeMetricKnowledgeProposals({tenantId:1,reportCode:"content-test",dshSessionId:input.dshSessionId,opId:"op-1",bindings:[{metricKey:input.metricKey,version:1}]});
    const exact=await searchMetricKnowledge(1,{query:input.name});
    assert.equal(exact.candidates[0].content,content);assert.deepEqual(exact.candidates[0].keywords,["内容词"]);assert.equal(exact.requiresContentReview,true);
    assert.ok(Math.abs(Date.now()-Date.parse(exact.candidates[0].createdAt))<60000,"SQLite UTC timestamps must not drift by host timezone");
    assert.ok(!("definition" in exact.candidates[0]));
    assert.equal((await searchMetricKnowledge(1,{query:"内容词"})).candidates[0].metricKey,input.metricKey);
    assert.equal((await readReportMetricBindings(1,input.reportCode))[0].content,content);
    const second=await proposeMetricKnowledge({...input,baseVersion:1,dshSessionId:"session-2",keywords:["变更关键词"]});
    assert.equal(second.decision,"update");assert.equal(second.version,2);
    await finalizeMetricKnowledgeProposals({tenantId:1,reportCode:input.reportCode,dshSessionId:"session-2",opId:"op-1",bindings:[{metricKey:input.metricKey,version:2}]});
    const history=await listMetricKnowledgeHistory(1,input.metricKey);
    assert.deepEqual(history.map(x=>x.version),[2,1]);assert.deepEqual(history[1].keywords,["内容词"]);
    assert.equal(history[0].content,content);
    await assert.rejects(resetMetricContent(true,1,(await resetMetricContent()).digest),/RESET_REFUSED_BOUND_REPORTS/);
    // Bootstrap is idempotent and does not restore manually unbound relationships.
    await pool.execute("DELETE FROM tenant_report_metric_binding");
    await ensureMetricGovernanceSchema(pool,true);await ensureMetricGovernanceSchema(pool,true);
    assert.deepEqual(await readReportMetricBindings(1,input.reportCode),[]);
    await pool.execute("UPDATE tenant_metric_knowledge SET tenant_id=2");
    await assert.rejects(resetMetricContent(true,1,(await resetMetricContent()).digest),/RESET_REFUSED_OTHER_TENANT_DATA/);
    console.log(JSON.stringify({ok:true,checks:["v2 has content/keywords and no definition_json","reset dry-run, digest and protected report/data-source hashes","old multi-tenant samples discarded without migration","exact full-text round trip including SQL punctuation and markup","content length/input rejection","keywords recalled and versioned","immutable content snapshots","binding and tenant reset guards","idempotent bootstrap never resurrects bindings"]},null,2));
  } finally {await pool.end();await fs.rm(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

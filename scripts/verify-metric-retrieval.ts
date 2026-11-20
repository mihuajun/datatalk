import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { getDatabaseConfig } from "../lib/server/database-config";





const isolatedWorkspace = mkdtempSync(path.join(tmpdir(), "datatalk-metric-settings-"));
process.env.WORKSPACE_STORAGE_ROOT = isolatedWorkspace;
assert.equal(getDatabaseConfig().kind,"sqlite","Use an isolated SQLite database");
const tenantId = 900000000 + Date.now() % 100000000;

let failed = false, requests = 0;
const server = createServer(async (req,res) => {
  let body=""; for await (const chunk of req) body += chunk;
  const {input} = JSON.parse(body); requests++;
  res.setHeader("Content-Type","application/json");
  if (failed) { res.writeHead(503); res.end('{}'); return; }
  const embedding = /首购|第一次购买/.test(input) ? [1,0,0] : /退款/.test(input) ? [0,1,0] : [0,0,1];
  res.end(JSON.stringify({data:[{embedding}]}));
});
async function main() {
  const { ensureDatabaseBootstrap } = await import("../lib/server/database-bootstrap");
  const { getDbPool } = await import("../lib/server/mysql");
  const pool = getDbPool();
  const { saveMetricEmbeddingConfig, publicMetricEmbeddingConfig } = await import("../lib/server/metric-embedding-config");
  const { searchMetricKnowledge } = await import("../lib/server/report-metric-knowledge-service");
  const { rebuildMetricSearchIndex } = await import("../lib/server/metric-retrieval");
  try {
    saveMetricEmbeddingConfig({enabled:false,baseUrl:"",model:"",clearApiKey:true});
    delete process.env.METRIC_EMBEDDING_BASE_URL;
    delete process.env.METRIC_EMBEDDING_MODEL;
    await ensureDatabaseBootstrap();
    for (const [key,name,status,t] of [
      ["first-revenue","首购金额","active",tenantId], ["refund","退款金额","active",tenantId],
      ["archived","首购历史","archived",tenantId], ["other-tenant","首购金额","active",tenantId+1],
    ] as const) {
      await pool.execute(`INSERT INTO tenant_metric_knowledge (tenant_id,metric_key,name,normalized_name,aliases_json,normalized_aliases_json,search_text,content,keywords_json,status,version,fingerprint)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`, [t,key,name,name,'[]','[]',name,`业务定义：${name}\n计算逻辑：SUM(amount)\n数据来源：sales.orders\n关联逻辑：orders.customer_id = customers.id`,'["业务术语"]',status,"f".repeat(64)]);
    }
    const fallback = await searchMetricKnowledge(tenantId,{query:"首购金额"});
    assert.equal(fallback.retrieval.degradation,"embedding_not_configured");
    assert.equal(fallback.decision,"reuse");
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    process.env.METRIC_EMBEDDING_BASE_URL = `http://127.0.0.1:${(server.address() as {port:number}).port}/v1`;
    process.env.METRIC_EMBEDDING_MODEL = "fixture-embedding";
    saveMetricEmbeddingConfig({enabled:true,baseUrl:process.env.METRIC_EMBEDDING_BASE_URL,model:"fixture-embedding",apiKey:"fixture-secret"});
    assert.ok(!JSON.stringify(publicMetricEmbeddingConfig()).includes("fixture-secret"));
    assert.deepEqual(await rebuildMetricSearchIndex(tenantId),{indexed:2,failed:0,status:"ready"});
    const initialRequests = requests;
    assert.deepEqual(await rebuildMetricSearchIndex(tenantId, ["first-revenue", "refund"], {skipUnchanged:true}), {indexed:0,failed:0,status:"ready"});
    assert.equal(requests, initialRequests, "Unchanged reuse must not call embedding provider");
    await rebuildMetricSearchIndex(tenantId, [], {skipUnchanged:true});
    assert.equal(requests, initialRequests, "Empty batch must not rebuild the tenant");
    await pool.execute("UPDATE tenant_metric_search_index SET embedding_json='[0,0,0]' WHERE tenant_id=? AND metric_key='refund'", [tenantId]);
    assert.equal((await rebuildMetricSearchIndex(tenantId, ["refund"], {skipUnchanged:true})).indexed, 1);
    await pool.execute("UPDATE tenant_metric_search_index SET content_hash='stale' WHERE tenant_id=? AND metric_key='refund'", [tenantId]);
    assert.equal((await rebuildMetricSearchIndex(tenantId, ["refund"], {skipUnchanged:true})).indexed, 1);
    await pool.execute("UPDATE tenant_metric_search_index SET model='old-model' WHERE tenant_id=? AND metric_key='refund'", [tenantId]);
    assert.equal((await rebuildMetricSearchIndex(tenantId, ["refund"], {skipUnchanged:true})).indexed, 1);
    assert.equal((await rebuildMetricSearchIndex(tenantId, ["refund"])).indexed, 1, "Manual rebuild remains forced");
    const result = await searchMetricKnowledge(tenantId,{query:"第一次购买的客户贡献多少"});
    assert.equal(result.retrieval.mode,"hybrid");
    assert.equal(result.candidates[0].metricKey,"first-revenue");
    assert.equal(result.candidates[0].match.keyword,0);
    assert.equal(result.decision,"confirm","Semantic similarity alone cannot authorize reuse");
    assert.ok(result.candidates.every(x=>!['other-tenant','archived'].includes(x.metricKey)));
    const grain = await searchMetricKnowledge(tenantId,{query:"首购金额",grainHint:"user",dimensions:["地区"]});
    assert.equal(grain.decision,"confirm");
    assert.equal(grain.candidates[0].conflicts.length,1);
    assert.ok(result.candidates[0].content.includes("sales.orders"));
    assert.ok(!("definition" in result.candidates[0]));
    assert.deepEqual(result.candidates[0].keywords,["业务术语"]);
    // Model drift and content drift must invalidate, not silently mix embeddings.
    saveMetricEmbeddingConfig({enabled:true,model:"fixture-v2"});
    assert.equal((await searchMetricKnowledge(tenantId,{query:"首购金额"})).retrieval.degradation,"index_incomplete");
    saveMetricEmbeddingConfig({enabled:true,model:"fixture-embedding"});
    await pool.execute("UPDATE tenant_metric_knowledge SET status='archived' WHERE tenant_id=? AND metric_key='first-revenue'",[tenantId]);
    assert.equal((await searchMetricKnowledge(tenantId,{query:"第一次购买的客户贡献多少"})).candidates.length,0);
    failed=true;
    const degraded = await searchMetricKnowledge(tenantId,{query:"退款金额"});
    assert.equal(degraded.retrieval.degradation,"embedding_unavailable");
    assert.equal(degraded.candidates[0].metricKey,"refund");
    saveMetricEmbeddingConfig({enabled:false});
    const before = requests;
    await searchMetricKnowledge(tenantId,{query:"退款金额"});
    assert.equal((await rebuildMetricSearchIndex(tenantId)).status,"not_configured");
    assert.equal(requests,before,"Disabled switch blocks requests even with environment configured");
    console.log(JSON.stringify({ok:true,requests,checks:["real HTTP embedding adapter with deterministic local fixture","vector-only recall","keyword fallback","content-review required for explicit hints","archive and tenant isolation","model drift","provider failure fallback"]},null,2));
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    for (const table of ["tenant_metric_search_index","tenant_metric_knowledge"]) await pool.execute(`DELETE FROM ${table} WHERE tenant_id IN (?,?)`,[tenantId,tenantId+1]);
    await pool.end();
    rmSync(isolatedWorkspace,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

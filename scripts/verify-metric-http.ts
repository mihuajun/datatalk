import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { getDatabaseConfig } from "../lib/server/database-config";
import { getDbPool } from "../lib/server/mysql";
import { createDataSource } from "../lib/server/data-source-repository";

const config = getDatabaseConfig();
assert.ok(config.kind === "sqlite" && process.env.STUDIO_CONFIG_PATH?.includes("metric-governance"), "isolated fixture required");
const base=process.env.STUDIO_TEST_URL || "http://127.0.0.1:3010";
const run=randomUUID().slice(0,8);
const pool=getDbPool();
async function main() {
  const login=await fetch(`${base}/api/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin"})});
  assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(x=>x.split(";")[0]).join("; ");
  const headers={Cookie:cookie,"Content-Type":"application/json",Origin:base};
  const keyResponse=await fetch(`${base}/api/settings/api-keys`,{method:"POST",headers,body:JSON.stringify({name:`metric-acceptance-${run}`})});
  assert.equal(keyResponse.status,201);
  const key=await keyResponse.json();
  async function api(tool:string,args:unknown={}) {
    if (process.env.METRIC_TEST_TRANSPORT === "mcp") {
      const response = await fetch(`${base}/api/mcp`, {method:"POST", headers:{Authorization:`Bearer ${key.secret}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream"}, body:JSON.stringify({jsonrpc:"2.0",id:randomUUID(),method:"tools/call",params:{name:tool,arguments:args}})});
      const envelope = await response.json();
      assert.equal(response.status,200);
      assert.ok(!envelope.error && !envelope.result?.isError, JSON.stringify(envelope));
      return envelope.result.structuredContent ?? JSON.parse(envelope.result.content[0].text);
    }
    const response=await fetch(`${base}/api/open/v1/tools/${tool}`,{method:"POST",headers:{Authorization:`Bearer ${key.secret}`,"Content-Type":"application/json"},body:JSON.stringify(args)});
    const body=await response.json();
    assert.equal(response.status,200,`${tool}: ${JSON.stringify(body)}`);
    return body;
  }
  async function management(method:string,metricKey:string,status?:string) {
    return fetch(`${base}/api/metrics`,{method,headers,body:JSON.stringify({metricKey,status})});
  }
  if (process.env.METRIC_TEST_TRANSPORT === "mcp") {
    const response = await fetch(`${base}/api/mcp`, {method:"POST",headers:{Authorization:`Bearer ${key.secret}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})});
    const listed = await response.json();
    for (const name of ["search_metric_knowledge","read_report_metric_bindings","propose_metric_knowledge"]) assert.ok(listed.result.tools.some((t:any)=>t.name===name));
    assert.equal(listed.result.tools.find((t:any)=>t.name==="propose_metric_knowledge").annotations.readOnlyHint,false);
  }
  const context=await api("get_studio_context");
  const folderId=Number(context.folders[0].id);
  const a=await api("create_report",{name:`指标验收·经营日报 ${run}`,folderId,operationId:`metric-a-${run}`});
  const b=await api("create_report",{name:`指标验收·渠道周报 ${run}`,folderId,operationId:`metric-b-${run}`});
  const reportA=a.report.code,reportB=b.report.code;
  const sourceFile=path.resolve(path.dirname((config as {path:string}).path),`metric-business-${run}.sqlite`);
  const database=new DatabaseSync(sourceFile);
  database.exec("CREATE TABLE orders (id INTEGER, amount REAL, status TEXT); INSERT INTO orders VALUES(1,1200,'paid'),(2,800,'paid'),(3,600,'unpaid');"); database.close();
  const dataSource=`metric_orders_${run}`;
  await createDataSource({tenantId:1,name:dataSource,type:"SQLite",host:sourceFile,port:null,database:"business",username:"",password:"",owner:"Acceptance fixture"});
  const metricKey=`paid-revenue-${run}`;
  const content = `业务定义：支付成功订单的实付金额合计，不含未支付订单。
计算逻辑：SUM(amount)
统计粒度：订单
时间口径：当前订单快照；本测试表没有支付时间字段，不支持按支付日期分组。
数据来源：${dataSource}，SQLite，orders 表。
字段映射：orders.id 为订单编号；orders.amount 为实付金额；orders.status 为支付状态。
关联逻辑：单表，不关联。
过滤条件：orders.status = 'paid'
去重规则：业务表一行一笔订单，按 id 唯一；重复编号须先核查。
支持维度：无。
单位与空值处理：测试金额单位元；SUM 忽略 NULL，无匹配记录返回 NULL。
SQL 示例：SELECT SUM(amount) AS revenue FROM orders WHERE status='paid'
未确认事项：仅隔离验收数据，不代表真实财务口径。`;
  const args={metricKey,baseVersion:0,name:`已支付收入 ${run}`,aliases:[`收入 ${run}`],keywords:["实付金额","验收收入"],content,dataSource,confirmed:true,validationSql:"SELECT SUM(amount) AS revenue FROM orders WHERE status='paid'"};
  const numericV1=await api("preview_query",{dataSourceRef:dataSource,sql:"SELECT SUM(amount) AS revenue FROM orders WHERE status='paid'"});
  assert.equal(Number(numericV1.sampleRows[0].revenue),2000);
  const numericV2=await api("preview_query",{dataSourceRef:dataSource,sql:"SELECT SUM(amount)*0.9 AS revenue FROM orders WHERE status='paid'"});
  assert.equal(Number(numericV2.sampleRows[0].revenue),1800);
  // Public tool contract rejects missing content and invalid SQL before writing a proposal.
  const invalid=await fetch(`${base}/api/open/v1/tools/propose_metric_knowledge`,{method:"POST",headers:{Authorization:`Bearer ${key.secret}`,"Content-Type":"application/json"},body:JSON.stringify({...args,content:undefined,reportCode:reportA})});
  assert.equal(invalid.status,400);
  const badSql=await fetch(`${base}/api/open/v1/tools/propose_metric_knowledge`,{method:"POST",headers:{Authorization:`Bearer ${key.secret}`,"Content-Type":"application/json"},body:JSON.stringify({...args,metricKey:`bad-sql-${run}`,reportCode:reportA,validationSql:"SELECT missing_column FROM nonexistent_table"})});
  assert.equal(badSql.status,422);
  const [badRows]=await pool.query<any[]>("SELECT COUNT(*) AS n FROM report_metric_knowledge_proposal WHERE metric_key=?",[`bad-sql-${run}`]);assert.equal(badRows[0].n,0);
  const draft=await api("propose_metric_knowledge",{...args,metricKey:`draft-${run}`,name:`未确认候选 ${run}`,confirmed:false,reportCode:reportA});
  assert.equal(draft.publication,"draft");
  const proposal=await api("propose_metric_knowledge",{...args,reportCode:reportA});
  assert.equal(proposal.publication,"after_report_commit");
  assert.equal((await api("search_metric_knowledge",{query:args.name})).candidates.filter((x:any)=>x.metricKey===metricKey).length,0,"draft invisible");
  async function save(reportCode:string,bindings:Array<{metricKey:string;version:number}>,tag:string) {
    const read=await api("read_report",{reportCode});
    const files=read.files;
    const raw=Array.isArray(files)? files.find((x:any)=>x.path==="report.json"||x.name==="report.json")?.content : files["report.json"];
    assert.equal(typeof raw,"string",`read shape ${Object.keys(read)}`);
    const doc=JSON.parse(raw);doc.metricBindings=bindings;
    return api("apply_report_changes",{reportCode,baseCommitHash:read.baseCommitHash,operationId:`metric-${tag}-${run}`,message:`指标验收 ${tag}`,files:{"report.json":JSON.stringify(doc,null,2)}});
  }
  const created=await save(reportA,[{metricKey,version:1}],"create");
  assert.equal(created.metricKnowledge.created,1);
  const [stored]=await pool.query<any[]>("SELECT content,keywords_json,created_by,updated_by FROM tenant_metric_knowledge WHERE metric_key=?",[metricKey]);
  assert.equal(stored[0].content,content);assert.equal(stored[0].created_by,1);assert.equal(stored[0].updated_by,1);
  const stale=await fetch(`${base}/api/open/v1/tools/propose_metric_knowledge`,{method:"POST",headers:{Authorization:`Bearer ${key.secret}`,"Content-Type":"application/json"},body:JSON.stringify({...args,reportCode:reportA})});
  assert.equal(stale.status,409);
  const reused=await api("propose_metric_knowledge",{...args,baseVersion:1,reportCode:reportB});
  assert.equal(reused.decision,"reuse");
  assert.equal((await save(reportB,[{metricKey,version:1}],"reuse")).metricKnowledge.reused,1);
  await api("propose_metric_knowledge",{...args,baseVersion:1,reportCode:reportA,content:content.replaceAll("SUM(amount)","SUM(amount) * 0.9").replace("支付成功订单的实付金额合计","支付成功订单的实付金额扣减 10% 费用"),validationSql:"SELECT SUM(amount)*0.9 AS revenue FROM orders WHERE status='paid'"});
  assert.equal((await save(reportA,[{metricKey,version:2}],"update")).metricKnowledge.updated,1);
  const retrieved = await api("search_metric_knowledge",{query:args.name});
  assert.equal(retrieved.candidates[0].version,2);
  assert.ok(retrieved.candidates[0].content.includes("SUM(amount) * 0.9"));
  assert.ok(!("definition" in retrieved.candidates[0]));
  const old=await api("read_report_metric_bindings",{reportCode:reportB});
  assert.equal(old[0].version,1);assert.ok(old[0].content.includes("计算逻辑：SUM(amount)"));assert.equal(old[0].upgradeAvailable,true);
  const list=await fetch(`${base}/api/metrics?status=all`,{headers}).then(r=>r.json());
  const metric=list.metrics.find((x:any)=>x.metricKey===metricKey);
  assert.equal(metric.sourceReports.length,2);assert.deepEqual(metric.reportBindings.map((x:any)=>x.version).sort(),[1,2]);
  assert.equal((await management("DELETE",metricKey)).status,409);
  assert.equal((await management("PATCH",metricKey,"archived")).status,200);
  assert.equal((await management("DELETE",metricKey)).status,409,"in-use archived metric cannot be deleted");
  assert.equal((await api("search_metric_knowledge",{query:args.name})).candidates.filter((x:any)=>x.metricKey===metricKey).length,0);
  assert.ok((await api("read_report_metric_bindings",{reportCode:reportB}))[0].content.includes("计算逻辑：SUM(amount)"));
  await management("PATCH",metricKey,"active");
  // Leave this isolated fixture for browser inspection; never touches the shared database.
  await fs.writeFile(path.resolve(path.dirname((config as {path:string}).path),"acceptance.json"),JSON.stringify({metricKey,name:args.name,reportA,reportB,base},null,2));
  await fetch(`${base}/api/settings/api-keys/${key.key.id}`,{method:"DELETE",headers});
  console.log(JSON.stringify({ok:true,metricKey,checks:["real login and API authorization","candidate-specific real SQLite SQL preview with 2000/1800 expected values","Git commit gate","version publication","second report reuse","immutable historical pin","2 report paths with versions","archive retrieval exclusion","in-use deletion guard","historical read while archived"]},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>pool.end());

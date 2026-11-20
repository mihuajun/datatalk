/** Opt-in real configured embedding smoke test. Synthetic text and MySQL TEMPORARY tables only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import mysql, {type Pool} from "mysql2/promise";
import {getDatabaseConfig} from "../lib/server/database-config";
import {coreMetricDdl} from "./reset-metric-content";
async function main(){
 const cfg=getDatabaseConfig();if(cfg.kind!=="mysql")throw new Error("MYSQL_REQUIRED");
 const connection=await mysql.createConnection({host:cfg.host,port:cfg.port,user:cfg.username,password:cfg.password,database:cfg.database});
 try{
  await connection.query((await coreMetricDdl(false))[0].replace("CREATE TABLE IF NOT EXISTS","CREATE TEMPORARY TABLE"));
  await connection.query("CREATE TEMPORARY TABLE tenant_metric_search_index (tenant_id BIGINT,metric_key VARCHAR(100),version INT,content_hash VARCHAR(64),model VARCHAR(255),embedding_json LONGTEXT,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,metric_key,version))");
  await connection.query("CREATE TEMPORARY TABLE tenant_user (tenant_id BIGINT,id BIGINT,name VARCHAR(160))");
  await connection.query("CREATE TEMPORARY TABLE tenant_user_updater LIKE tenant_user");
  const query=(sql:string,values?:unknown[])=>connection.query(sql.replace(/JOIN tenant_user updater/g,"JOIN tenant_user_updater updater"),values);
  globalThis.__chatBiMySqlPool={query,execute:connection.execute.bind(connection)} as unknown as Pool;
  const {embeddingConfig,rebuildMetricSearchIndex}=await import("../lib/server/metric-retrieval");
  const {searchMetricKnowledge}=await import("../lib/server/report-metric-knowledge-service");
  if(!embeddingConfig())throw new Error("EMBEDDING_NOT_ENABLED");
  const content="业务定义：验收合成订单实付金额，不包含客户数据。\n数据来源：合成 sales.orders，amount 表示实付金额。\n计算逻辑：SUM(amount)\n过滤条件：status = 'paid'\n未确认事项：此为技术验收用例。";
  await connection.execute("INSERT INTO tenant_metric_knowledge (tenant_id,metric_key,name,normalized_name,aliases_json,normalized_aliases_json,search_text,content,keywords_json,status,version,fingerprint) VALUES (999999999,'synthetic-paid','验收实付金额','验收实付金额','[]','[]','验收实付金额',?,'[\"实付\",\"订单金额\"]','active',1,?)",[content,"a".repeat(64)]);
  const rebuilt=await rebuildMetricSearchIndex(999999999);assert.deepEqual(rebuilt,{indexed:1,failed:0,status:"ready"});
  const result=await searchMetricKnowledge(999999999,{query:"验收实付金额"});
  assert.equal(result.retrieval.mode,"hybrid");assert.equal(result.retrieval.indexed,1);assert.equal(result.retrieval.degradation,null);
  assert.equal(result.candidates[0].content,content);assert.equal(result.candidates[0].version,1);
  const [vectors]=await connection.query<any[]>("SELECT embedding_json FROM tenant_metric_search_index");
  const output={ok:true,syntheticDataOnly:true,sharedTablesUntouched:true,dimension:JSON.parse(vectors[0].embedding_json).length,checks:["real configured embedding API","write/read vector cache in MySQL temporary table","live query embedding + keyword/vector fusion","full content returned verbatim"]};
  await fs.mkdir(".workbuddy-local/metric-content-v2",{recursive:true});
  await fs.writeFile(".workbuddy-local/metric-content-v2/real-embedding.json",JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 }finally{await connection.end();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"REAL_EMBEDDING_TEST_FAILED");process.exitCode=1;});

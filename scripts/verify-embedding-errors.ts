import assert from "node:assert/strict";
import { embedMetricText, MetricEmbeddingError } from "../lib/server/metric-retrieval";
async function main() {
 const original=globalThis.fetch;
 const config={enabled:true,baseUrl:"https://fixture.invalid/v1",model:"fixture",key:"secret-do-not-print"};
 try {
  for(const status of [400,401,403,404,429,503]) {
   globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:"invalid_api_key",message:config.key}}),{status});
   await assert.rejects(()=>embedMetricText("test",config),error=>error instanceof MetricEmbeddingError && error.status===status && !error.message.includes(config.key));
  }
  globalThis.fetch=async()=>new Response('<html>not API</html>');
  await assert.rejects(()=>embedMetricText("test",config),error=>error instanceof MetricEmbeddingError && error.code==="EMBEDDING_INVALID_RESPONSE");
  globalThis.fetch=async()=>{throw new DOMException("timeout","TimeoutError")};
  await assert.rejects(()=>embedMetricText("test",config),error=>error instanceof MetricEmbeddingError && error.code==="EMBEDDING_TIMEOUT");
  globalThis.fetch=async()=>{throw Object.assign(new Error("fetch failed"),{cause:{code:"ENOTFOUND"}})};
  await assert.rejects(()=>embedMetricText("test",config),/域名/);
  globalThis.fetch=async()=>new Response(JSON.stringify({data:[{embedding:[1,0]}]}));
  assert.deepEqual((await embedMetricText("test",config)).vector,[1,0]);
  globalThis.fetch=async(url,options)=>{
   assert.equal(String(url),"https://fixture.invalid/v1/embeddings/multimodal");
   assert.deepEqual(JSON.parse(String(options?.body)).input,[{type:"text",text:"test"}]);
   return new Response(JSON.stringify({data:{embedding:[0.5,0.7]}}));
  };
  assert.deepEqual((await embedMetricText("test",{...config,baseUrl:"https://fixture.invalid/v1/embeddings/multimodal"})).vector,[0.5,0.7]);
  globalThis.fetch=async(url)=>{
   assert.equal(String(url),"https://fixture.invalid/v1/embeddings");
   return new Response(JSON.stringify({data:[{embedding:[1,0]}]}));
  };
  await embedMetricText("test",{...config,baseUrl:"https://fixture.invalid/v1/embeddings"});
  console.log(JSON.stringify({ok:true,checks:["HTTP classifications","no upstream secret echo","invalid response","timeout","DNS","valid embedding","Ark multimodal payload and response","full endpoint without duplicate suffix"]}));
 } finally {globalThis.fetch=original;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

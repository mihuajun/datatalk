import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { ApiPrincipal } from '../lib/server/open-api-auth';
export async function verifyLocalPreview(principal:ApiPrincipal,reportCode:string,temporary:string,check:(ok:unknown,label:string)=>void){
 const {invokeStudioTool}=await import('../lib/server/open-api-tools');
 const transfer=await import('../app/api/open/report-development/[tenant]/[code]/[session]/route');
 const queryRoute=await import('../app/api/open/report-development/[tenant]/[code]/[session]/local-query/route');
 const {getDbPool}=await import('../lib/server/mysql');
 const {getReportWorkspacePath}=await import('../lib/server/report-workspace');
 const cli=fileURLToPath(new URL('../public/studio-runtime/studio-report-local.cjs',import.meta.url));
 await fs.mkdir(path.join(process.cwd(),'public/studio-runtime'),{recursive:true});await fs.copyFile(cli,path.join(process.cwd(),'public/studio-runtime/studio-report-local.cjs'));
 const requests:{method:string;url:string;keys:string[]}[]=[];let ctx:any;
 const server=http.createServer(async(req,res)=>{try{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const bytes=Buffer.concat(chunks);requests.push({method:req.method!,url:req.url!,keys:bytes.length?Object.keys(JSON.parse(bytes.toString())):[]});
  const request=new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers as any,...(bytes.length?{body:bytes}:{})});
  const response=req.url!.endsWith('/local-query')?await queryRoute.POST(request,ctx):req.method==='PUT'?await transfer.PUT(request,ctx):await transfer.GET(request,ctx);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('{}');}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(server.address() as any).port;
 const call=(name:string,args:object)=>invokeStudioTool(principal,name,args,base) as Promise<any>;
 const original=await call('read_report',{reportCode});
 const local=await call('prepare_report_local_preview',{reportCode,baseCommitHash:original.baseCommitHash,dataSources:['dev_fixture'],operationId:'local_preview_prepare_01'});
 ctx={params:Promise.resolve({tenant:String(principal.tenantId),code:reportCode,session:local.sessionId})};
 assert.equal(local.runtime,'local');assert.equal(local.uploadManifest.length,0);
 const credential=path.join(temporary,'local.credentials.json');await fs.writeFile(credential,JSON.stringify(local),{mode:0o600});
 const workspace=path.join(temporary,'local-preview-source');const run=(...args:string[])=>promisify(execFile)(process.execPath,[cli,...args],{timeout:30000});
 await run('pull',credential,workspace);
 let child:ReturnType<typeof spawn>|undefined;
 const request=(origin:string,url:string,body?:unknown,headers:Record<string,string>={})=>new Promise<{status:number;value:any}>((resolve,reject)=>{
  const req=http.request(origin+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers}},res=>{const b:Buffer[]=[];res.on('data',x=>b.push(x));res.on('end',()=>{try{resolve({status:res.statusCode!,value:JSON.parse(Buffer.concat(b).toString())});}catch(e){reject(e);}});});req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();
 });
 try{
  child=spawn(process.execPath,[cli,'serve',credential,workspace],{stdio:['ignore','pipe','pipe'],env:{...process.env,STUDIO_TEST_RUNTIME_ENV_CONTROL:'preserved'}});
  const started=await new Promise<any>((resolve,reject)=>{let out='';const t=setTimeout(()=>reject(Error('Local startup timed out')),15000);child!.stdout!.on('data',b=>{out+=b;if(out.includes('\n')){clearTimeout(t);try{resolve(JSON.parse(out.split('\n')[0]));}catch(e){reject(e);}}});child!.on('exit',code=>{clearTimeout(t);reject(Error('Local process exited '+code));});child!.stderr!.on('data',b=>console.error(String(b)));});
  const control=JSON.parse(await fs.readFile(started.controlFile,'utf8'));const origin=control.origin;const headers={Authorization:control.authorization};
  assert.equal((await request(origin,'/__snapshot')).status,401);
  assert.equal((await request(origin,'/__snapshot',undefined,{...headers,Origin:'https://evil.invalid'})).status,403);
  assert.equal((await request(origin,'/__snapshot',undefined,{...headers,Host:'evil.invalid'})).status,403);
  check(true,'local server binds loopback, authenticates API and rejects cross-origin/DNS rebinding requests');
  const sql=`SELECT COUNT(*) AS n,SUM(amount) AS amount FROM orders WHERE status=:status`;
  for(const round of [1,2,3]){
   await fs.writeFile(path.join(workspace,'server.js'),`module.exports={handlers:{orders:async c=>({round:${round},rows:await c.query('dev_fixture',${JSON.stringify(sql)},{status:c.filters.status})}),echo:c=>({round:${round},value:c.filters.status==='cancelled'?22:11,environmentControl:process.env.STUDIO_TEST_RUNTIME_ENV_CONTROL})}};`);
   await fs.writeFile(path.join(workspace,'page.html'),original.files['page.html'].replace('</body>',`<p>LOCAL ROUND ${round}</p></body>`));
   const snapshot=await request(origin,'/__snapshot',undefined,headers);assert.equal(snapshot.status,200);assert.match(snapshot.value.srcdoc,new RegExp('LOCAL ROUND '+round));
   for(const [status,amount] of [['paid',200],['cancelled',99]] as const){const v=await request(origin,'/__query',{dataId:'orders',filters:{status},fingerprint:snapshot.value.fingerprint},headers);assert.equal(v.status,200,JSON.stringify(v.value));assert.equal(v.value.data.round,round);assert.equal(v.value.data.rows[0].amount,amount);}
   const boundary=await call('inspect_report_local_preview_boundary',{reportCode,sessionId:local.sessionId});assert.equal(boundary.cloudDraftUnchanged,true);assert.equal(boundary.uploadedBlobs,0);
  }
  check(true,'three local HTML/server edits execute locally with real disposable SQL (paid 200/cancelled 99); cloud Git/hashes unchanged and zero upload blobs each round');
  const sn=await request(origin,'/__snapshot',undefined,headers);
  await fs.appendFile(path.join(workspace,'server.js'),'\n');
  assert.match((await request(origin,'/__query',{dataId:'orders',fingerprint:sn.value.fingerprint},headers)).value.error,/LOCAL_FILES_CHANGED/);
  const sn2=await request(origin,'/__snapshot',undefined,headers);
  const before=requests.length;
  assert.equal((await request(origin,'/__query',{dataId:'echo',filters:{status:'paid'},fingerprint:sn2.value.fingerprint},headers)).value.data.value,11);
  assert.equal((await request(origin,'/__query',{dataId:'echo',filters:{status:'paid'},fingerprint:sn2.value.fingerprint},headers)).value.data.environmentControl,'preserved');
  assert.equal(requests.length,before);
  assert.ok(requests.every(r=>r.method==='GET'||(r.method==='POST'&&r.url.endsWith('/local-query')&&r.keys.every(k=>['dataSourceRef','sql','params','options'].includes(k)))));
  check(true,'echo and refresh make no cloud request; captured cloud traffic contains downloads and SQL only, never source PUT or handler code');
  const query=(body:any,auth=local.localQuery.authorization)=>queryRoute.POST(new Request(local.localQuery.endpoint,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(body)}),ctx);
  assert.equal((await query({dataSourceRef:'dev_fixture',sql,files:{'server.js':'SECRET'}})).status,400);
  assert.equal((await query({dataSourceRef:'other',sql})).status,403);
  assert.equal((await query({dataSourceRef:'dev_fixture',sql:'DELETE FROM orders'})).status,422);
  assert.equal((await query({dataSourceRef:'dev_fixture',sql},local.transfer.authorization)).status,401);
  assert.equal((await transfer.PUT(new Request(local.transfer.endpoint+'?path=server.js',{method:'PUT',headers:{Authorization:local.transfer.authorization},body:'x'}),ctx)).status,400);
  assert.equal((await transfer.GET(new Request(local.transfer.endpoint+'?path=server.js',{headers:{Authorization:local.localQuery.authorization}}),ctx)).status,401);
  await assert.rejects(call('commit_report_development',{reportCode,sessionId:local.sessionId,operationId:'local_no_commit_01',message:'should not save'}),{code:'EMPTY_CHANGE_SET'});
  check(true,'query capability rejects source payload, wrong source, writes, transfer token; download session cannot upload/commit and query token cannot download');
  const stats=JSON.parse((await run('status',started.controlFile)).stdout);assert.equal(stats.sourceUploadRequests,0);assert.equal(stats.cloudDraftWrites,0);assert.equal(stats.gatewayRequests,6);
  const statusBefore=await call('read_report',{reportCode});assert.equal(statusBefore.baseCommitHash,original.baseCommitHash);assert.deepEqual(statusBefore.files,original.files);
  // Real explicit raw upload/commit after local validation; this is the first source transfer.
  const manifest=JSON.parse((await run('manifest',workspace,'server.js','page.html')).stdout);
  const upload=await call('begin_report_development',{reportCode,baseCommitHash:original.baseCommitHash,...manifest,operationId:'local_explicit_upload_01'});
  const upctx={params:Promise.resolve({tenant:String(principal.tenantId),code:reportCode,session:upload.sessionId})};
  for(const f of manifest.files){const response=await transfer.PUT(new Request(upload.transfer.endpoint+'?path='+f.path,{method:'PUT',headers:{Authorization:upload.transfer.authorization},body:await fs.readFile(path.join(workspace,f.path))}),upctx);assert.equal(response.status,200);}
  const saved=await call('commit_report_development',{reportCode,sessionId:upload.sessionId,operationId:'local_explicit_commit_01',message:'local validation then explicit submit'});assert.equal(saved.saved,true);
  const {executeReportDataRequest}=await import('../lib/server/report-data-runtime');
  const cloud:any=await executeReportDataRequest({tenantId:principal.tenantId,reportCode,source:'working',dataId:'orders',filters:{status:'paid'}});assert.equal(cloud.round,3);assert.equal(cloud.rows[0].amount,200);
  for(const f of manifest.files)assert.equal((await call('read_report',{reportCode})).files[f.path],await fs.readFile(path.join(workspace,f.path),'utf8'));
  check(true,'only explicit upload+commit changes draft; submitted source bytes and cloud dynamic SQL results match validated local runtime');
  const metaPath=path.join(getReportWorkspacePath(principal.tenantId,reportCode),'.development',local.sessionId,'session.json');const meta=JSON.parse(await fs.readFile(metaPath,'utf8'));await fs.writeFile(metaPath,JSON.stringify({...meta,expiresAt:Date.now()-1}));assert.equal((await query({dataSourceRef:'dev_fixture',sql})).status,410);await fs.writeFile(metaPath,JSON.stringify(meta));
  await getDbPool().execute('UPDATE tenant_user SET status=0 WHERE id=?',[principal.userId]);assert.equal((await query({dataSourceRef:'dev_fixture',sql})).status,401);await getDbPool().execute('UPDATE tenant_user SET status=1 WHERE id=?',[principal.userId]);
  await call('close_report_development',{reportCode,sessionId:local.sessionId});assert.equal((await query({dataSourceRef:'dev_fixture',sql})).status,404);
  await call('close_report_development',{reportCode,sessionId:upload.sessionId});
  await run('stop',started.controlFile);
  check(true,'expired/disabled-parent/closed local data capability fails closed; explicit local stop ends preview without publishing');
 }finally{child?.kill('SIGTERM');server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}

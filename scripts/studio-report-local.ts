/** Standalone MCP runtime. Bundle with build-report-local.mjs; requires only Node >=22.5.
 * Trusted developer code only. A Worker provides timeout/reload, not a security sandbox.
 */
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import * as XLSX from "xlsx";
import { composeWebReportSrcDoc } from "../lib/report-web";
import { normalizeReportFilterManifest } from "../lib/report-filters";
import { evaluateRuntimeModule, normalizeFilters, normalizeQueryParams, getRuntimeEntry } from "../lib/report-handler-runtime";
// @ts-expect-error plain ESM helper is also usable without this bundle
import { fileMain } from "./studio-report-files.mjs";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const VERSION = "0.5.1";
const allowed = /^(report\.json|description\.md|page\.html|styles\.css|app\.js|server\.js|theme\.json|interactions\.json|(assets|components)\/[A-Za-z0-9][A-Za-z0-9_.-]*\.(html|css|js|json|svg|txt)|data\/(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.(json|csv|tsv|txt))$/;
async function privateJson(file: string) {
  const s = await fs.lstat(file);
  if (!s.isFile() || s.isSymbolicLink() || (process.platform !== 'win32' && (s.mode & 0o077))) throw Error("Credentials/control file must be chmod 600 regular file");
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function readSources(root: string) {
  if ((await fs.lstat(root)).isSymbolicLink()) throw Error('Symlink workspace rejected');
  const files: Record<string,string> = {}; let total = 0;
  async function walk(relative: string) {
    for (const item of await fs.readdir(path.join(root,relative),{withFileTypes:true})) {
      const name = relative ? relative+'/'+item.name : item.name;
      if (name.startsWith('.')) continue;
      if (item.isSymbolicLink()) throw Error('Symlink source rejected');
      if (item.isDirectory() && ['data','assets','components'].includes(name.split('/')[0])) { await walk(name); continue; }
      if (!item.isFile()) continue;
      if (!allowed.test(name) || name.split('/').some(p=>p==='.'||p==='..')) throw Error('Unsupported source file: '+name);
      const stat = await fs.stat(path.join(root,name)); if (stat.size > 524288) throw Error('File exceeds 512KB');
      const bytes = await fs.readFile(path.join(root,name));total+=bytes.length;
      if (total>16777216 || Object.keys(files).length>=100) throw Error('Workspace exceeds limits');
      const text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);if(text.includes('\0'))throw Error('Binary source rejected');
      files[name]=text;
    }
  }
  await walk('');
  for(const name of ['report.json','description.md','page.html','styles.css','server.js'])if(!(name in files))throw Error('Required file missing: '+name);
  return files;
}
function fingerprint(files: Record<string,string>) { return sha(JSON.stringify(Object.keys(files).sort().map(name=>[name,sha(files[name])]))); }
function manifestFor(files: Record<string,string>, session: any) {
  const doc=JSON.parse(files['report.json']);
  if(doc.reportCode!==session.reportCode || String(doc.tenantId)!==String(new URL(session.transfer.endpoint).pathname.split('/')[4]))throw Error('Report identity mismatch');
  return normalizeReportFilterManifest(Array.isArray(doc.filters)?{filters:doc.filters}:null);
}
function shell() { return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Studio 本地动态预览</title><style>body{margin:0;font:14px system-ui}header{padding:12px;background:#e8f5ee;display:flex;gap:20px;align-items:center}iframe{width:100%;height:calc(100vh - 65px);border:0}button{padding:6px 16px}</style><header><strong>本地动态预览 · 源码未上传 · 未提交</strong><button id="reload">刷新本地文件</button><span id="status"></span></header><iframe title="本地报表" sandbox="allow-scripts"></iframe><script>
(()=>{const key='studio-local-token';const token=new URLSearchParams(location.hash.slice(1)).get('token')||sessionStorage.getItem(key);if(token)sessionStorage.setItem(key,token);history.replaceState(null,'',location.pathname);const f=document.querySelector('iframe'),s=document.querySelector('#status');let revision='',pending=0;
async function request(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const v=await r.json();if(!r.ok)throw Error(v.error||'本地请求失败');return v;}
async function refresh(){try{const v=await request('/__snapshot');revision=v.fingerprint;f.srcdoc=v.srcdoc;s.textContent='本地版本 '+revision.slice(0,10);}catch(e){s.textContent=e.message;}}
window.addEventListener('message',async e=>{if(e.source!==f.contentWindow||!e.data)return;const p=e.data;if(p.type==='__DATATALK_RUNTIME_READY__'){f.contentWindow.postMessage({type:'__DATATALK_RUNTIME_READY_ACK__'},'*');return;}if(p.type!=='__DATATALK_RUNTIME_QUERY__'||typeof p.requestId!=='string')return;const reply={type:'__DATATALK_RUNTIME_RESPONSE__',requestId:p.requestId};if(pending>=4){f.contentWindow.postMessage({...reply,ok:false,error:'查询过于频繁'},'*');return;}pending++;try{const v=await request('/__query',{dataId:p.dataId,filters:p.filters,fingerprint:revision});f.contentWindow.postMessage({...reply,ok:true,data:v.data},'*');}catch(e){f.contentWindow.postMessage({...reply,ok:false,error:e.message},'*');}finally{pending--;}});document.querySelector('#reload').onclick=refresh;refresh();})();</script></html>`; }
async function workerRun() {
  const { files, context }=workerData;
  let seq=0;const tasks=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
  parentPort!.on('message',r=>{const t=tasks.get(r.id);if(!t)return;tasks.delete(r.id);r.error?t.reject(Error(r.error)):t.resolve(r.rows);});
  const requireData=(specifier:string)=>{
    if(typeof specifier!=='string'||!specifier.startsWith('./data/')||specifier.includes('\\')||specifier.split('/').slice(1).some(p=>p==='.'||p==='..')||!/^data\/.+\.(json|csv|tsv)$/.test(specifier.slice(2)))throw Error('REPORT_SERVER_IMPORT_NOT_ALLOWED');
    const text=files[specifier.slice(2)];if(text===undefined)throw Error('REPORT_DATA_FILE_NOT_FOUND');
    if(specifier.endsWith('.json'))return JSON.parse(text);
    const wb=XLSX.read(Buffer.from(text),{type:'buffer',cellDates:true});return {sheets:wb.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:null,raw:true})}))};
  };
  const runtime=evaluateRuntimeModule(files['server.js'],requireData);
  if(!Object.hasOwn(runtime.handlers,context.dataId))throw Error('REPORT_DATA_HANDLER_NOT_FOUND');
  const query=(dataSource:string,sql:string,params?:any,options?:any)=>new Promise((resolve,reject)=>{const id=++seq;tasks.set(id,{resolve,reject});parentPort!.postMessage({type:'query',id,input:{dataSourceRef:typeof dataSource==='string'?dataSource.trim():'',sql,params:normalizeQueryParams(params),options}});});
  const result=await getRuntimeEntry(runtime.handlers[context.dataId]).resolve({...context,query} as any);
  const encoded=JSON.stringify(result??null);if(Buffer.byteLength(encoded)>2097152)throw Error('QUERY_RESULT_LIMIT');
  parentPort!.postMessage({type:'result',data:JSON.parse(encoded)});
}
async function serve(credentials: string, workspace: string, port = 0) {
  const root=path.resolve(workspace);const session=await privateJson(credentials);
  if(path.resolve(credentials).startsWith(root+path.sep))throw Error('Credentials must be outside report sources');
  if(session.runtime!=='local'||!session.localQuery||session.uploadManifest?.length)throw Error('Use prepare_report_local_preview, not an upload session');
  const endpoint=new URL(session.localQuery.endpoint);
  if(endpoint.protocol!=='https:' && !(endpoint.protocol==='http:'&&endpoint.hostname==='127.0.0.1'))throw Error('HTTPS required');
  if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!/^\/api\/open\/report-development\/[1-9][0-9]*\/[A-Za-z0-9_-]+\/[a-f0-9]{32}\/local-query$/.test(endpoint.pathname)||!/^Bearer [A-Za-z0-9_-]{43}$/.test(session.localQuery.authorization))throw Error('Invalid query capability');
  const initial=await readSources(root);manifestFor(initial,session);
  const auth=randomBytes(32).toString('base64url');let origin='';let active=0;
  const stats={runtimeVersion:VERSION,reportCode:session.reportCode,baseCommitHash:session.baseCommitHash,snapshots:0,handlerCalls:0,gatewayRequests:0,sourceUploadRequests:0,cloudDraftWrites:0,startedAt:new Date().toISOString()};
  const execute=(files:Record<string,string>,dataId:string,filters:unknown)=>new Promise((resolve,reject)=>{
    const worker=new Worker(__filename,{workerData:{files,context:{tenantId:Number(JSON.parse(files['report.json']).tenantId),reportCode:session.reportCode,source:'working',dataId,filters:normalizeFilters(filters,manifestFor(files,session))}},resourceLimits:{maxOldGenerationSizeMb:128}});
    const timer=setTimeout(()=>finish(Error('REPORT_RUNTIME_TIMEOUT')),65000);let ended=false;
    const finish=(error?:Error,data?:unknown)=>{if(ended)return;ended=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(data);};
    worker.on('error',finish);worker.on('exit',code=>{if(!ended)finish(Error('REPORT_WORKER_EXIT_'+code));});
    worker.on('message',async m=>{
      if(m.type==='result'){finish(undefined,m.data);return;}
      if(m.type!=='query')return;
      try{
        if(Date.parse(session.expiresAt)<=Date.now())throw Error('LOCAL_QUERY_SESSION_EXPIRED: prepare again, retain local edits');
        if(!session.localQuery.dataSources.includes(m.input.dataSourceRef))throw Error('DATA_SOURCE_NOT_ALLOWED');
        const body=JSON.stringify(m.input);if(Buffer.byteLength(body)>65536)throw Error('QUERY_ARGUMENT_LIMIT');
        stats.gatewayRequests++;
        const r=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:session.localQuery.authorization,'Content-Type':'application/json'},body});
        const v=await r.json();if(!r.ok)throw Error(v.error?.message||'LOCAL_QUERY_FAILED');
        if(!ended)worker.postMessage({id:m.id,rows:v.rows});
      }catch(e){if(!ended)worker.postMessage({id:m.id,error:e instanceof Error?e.message:'LOCAL_QUERY_FAILED'});}
    });
  });
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    if(req.headers.host!==new URL(origin).host || (req.headers.origin && req.headers.origin!==origin)){send(403,{error:'LOCAL_ORIGIN_REJECTED'});return;}
    if(req.method==='GET'&&req.url==='/'){
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline' 'self' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(shell());return;
    }
    if(req.headers.authorization!=='Bearer '+auth){send(401,{error:'LOCAL_AUTH_REQUIRED'});return;}
    try{
      if(req.method==='GET'&&req.url==='/__status'){send(200,{...stats,activeHandlers:active});return;}
      if(req.method==='POST'&&req.url==='/__stop'){send(200,{stopped:true});server.close();server.closeAllConnections();return;}
      if(req.method==='GET'&&req.url==='/__snapshot'){
        const files=await readSources(root);const manifest=manifestFor(files,session);stats.snapshots++;
        const assets=Object.fromEntries(Object.entries(files).filter(([p])=>p.startsWith('assets/')&&p.endsWith('.svg')).map(([p,text])=>[p,'data:image/svg+xml;base64,'+Buffer.from(text).toString('base64')]));
        const defaults=normalizeFilters({},manifest);
        send(200,{srcdoc:composeWebReportSrcDoc({...files,assets},{filters:defaults,defaults,workspaceFingerprint:fingerprint(files)}),fingerprint:fingerprint(files)});return;
      }
      if(req.method!=='POST'||req.url!=='/__query'){send(404,{error:'NOT_FOUND'});return;}
      if(active>=4){send(429,{error:'LOCAL_QUERY_BUSY'});return;}
      let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw Error('QUERY_BODY_LIMIT');chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body||typeof body!=='object'||Object.keys(body).some(k=>!['dataId','filters','fingerprint'].includes(k))||typeof body.dataId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(body.dataId))throw Error('INVALID_QUERY');
      const files=await readSources(root);if(body.fingerprint!==fingerprint(files))throw Error('LOCAL_FILES_CHANGED: 请刷新本地文件后重试');
      stats.handlerCalls++;active++;
      try{send(200,{data:await execute(files,body.dataId,body.filters)});}finally{active--;}
    }catch(e){send(422,{error:e instanceof Error?e.message:'LOCAL_RUNTIME_ERROR'});}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const addr=server.address() as {port:number};origin='http://127.0.0.1:'+addr.port;
  const controlFile=path.resolve(credentials)+'.local-control.json';
  await fs.writeFile(controlFile,JSON.stringify({origin,authorization:'Bearer '+auth,pid:process.pid,previewUrl:origin+'/#token='+auth}),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({previewUrl:origin+'/#token='+auth,controlFile,workspace:root,runtimeVersion:VERSION,sourceUploadsEnabled:false,cloudDraftWritesEnabled:false}));
  const shutdown=()=>{server.close();server.closeAllConnections();};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
async function main(){
  const [command,first,second,third]=process.argv.slice(2);
  if(['pull','push','manifest'].includes(command)){await fileMain();return;}
  if(command==='serve'&&first&&second){await serve(first,second,third?Number(third):0);return;}
  if(['status','stop'].includes(command)&&first){const c=await privateJson(first);const u=new URL(c.origin);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password)throw Error('Invalid local control');const r=await fetch(c.origin+'/__'+command,{method:command==='stop'?'POST':'GET',headers:{Authorization:c.authorization}});if(!r.ok)throw Error('Control request failed');console.log(JSON.stringify(await r.json()));return;}
  throw Error('Usage: pull|push <credentials> <workspace>; manifest <workspace> <files...>; serve <credentials> <workspace> [port]; status|stop <control.json>');
}
if(isMainThread)main().catch(e=>{console.error(e.message);process.exitCode=1;});else workerRun().catch(e=>{throw e;});

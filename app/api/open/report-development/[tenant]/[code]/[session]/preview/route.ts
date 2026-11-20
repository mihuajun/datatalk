import { apiErrorResponse, assertSameOrigin, OpenApiError } from "@/lib/server/open-api-auth";
import { authorizeDevelopmentTransfer, developmentPreview } from "@/lib/server/report-development";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenant: string; code: string; session: string }> };
// Token remains in the parent closure, never in report source or the sandboxed iframe.
export async function GET() {
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Studio 云端开发预览</title><style>body{margin:0;font:14px system-ui}header{padding:10px;background:#eef2ff}iframe{width:100%;height:calc(100vh - 60px);border:0}</style><header id="status">云端开发预览 · 尚未提交正式草稿 · 未发布</header><iframe title="报表开发预览" sandbox="allow-scripts"></iframe><script>
(() => {
 const token = new URLSearchParams(location.hash.slice(1)).get('token'); history.replaceState(null,'',location.pathname);
 const frame=document.querySelector('iframe'); const status=document.querySelector('#status'); let pending=0;
 async function request(body) { const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error?.message||'开发预览请求失败');return v; }
 window.addEventListener('message',async e=>{
  if(e.source!==frame.contentWindow || !e.data || typeof e.data!=='object')return;
  const p=e.data;
  if(p.type==='__DATATALK_RUNTIME_READY__'){frame.contentWindow.postMessage({type:'__DATATALK_RUNTIME_READY_ACK__'},'*');return;}
  if(p.type!=='__DATATALK_RUNTIME_QUERY__' || typeof p.requestId!=='string')return;
  const reply={type:'__DATATALK_RUNTIME_RESPONSE__',requestId:p.requestId};
  if(pending>=4){frame.contentWindow.postMessage({...reply,ok:false,error:'查询过于频繁'},'*');return;}
  pending++;try{const v=await request({dataId:p.dataId,filters:p.filters});frame.contentWindow.postMessage({...reply,ok:true,data:v.data},'*');}catch(e){frame.contentWindow.postMessage({...reply,ok:false,error:e.message},'*');}finally{pending--;}
 });
 request({}).then(v=>{frame.srcdoc=v.srcdoc;}).catch(e=>{status.textContent=e.message;});
})();</script></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline' 'self' http: https:; img-src data: blob: http: https:; font-src data: https:; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'" } });
}
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const { tenant, code, session } = await context.params;
    if (!/^[1-9][0-9]*$/.test(tenant) || !Number.isSafeInteger(Number(tenant)) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code)) throw new OpenApiError("DEVELOPMENT_NOT_FOUND", 404, "开发会话不存在");
    const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.get("authorization") || "")?.[1] || "";
    const value = await authorizeDevelopmentTransfer(Number(tenant), code, session, token, true);
    const chunks: Uint8Array[] = []; let size = 0; const reader = request.body?.getReader();
    if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 16384) { await reader.cancel(); throw new OpenApiError("BODY_TOO_LARGE", 413, "预览参数超过16KB"); } chunks.push(value); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new OpenApiError("INVALID_ARGUMENTS", 400, "预览参数无效"); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !["dataId", "filters"].includes(k)) || (body.dataId !== undefined && (typeof body.dataId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(body.dataId)))) throw new OpenApiError("INVALID_ARGUMENTS", 400, "预览参数无效");
    const result = await developmentPreview(value, body.dataId ? body : undefined);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return apiErrorResponse(e); }
}

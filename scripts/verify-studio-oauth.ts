import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { getDatabaseConfig } from "../lib/server/database-config";
import { getDbPool } from "../lib/server/mysql";

const base=process.env.STUDIO_TEST_URL || "http://127.0.0.1:3010";
assert.equal(getDatabaseConfig().kind,"sqlite","OAuth tests require isolated SQLite");
assert.ok(process.env.STUDIO_CONFIG_PATH?.includes("workbuddy-local"));
const pool=getDbPool(); let checks=0;
function check(v:unknown,label:string){assert.ok(v,label);checks++;console.log(`PASS ${label}`);}
async function request(route:string,init:RequestInit={}){const r=await fetch(new URL(route,base),{redirect:"manual",...init});const text=await r.text();let data:any;try{data=JSON.parse(text);}catch{data=null;}return{status:r.status,headers:r.headers,text,data};}
function post(body:unknown,headers:Record<string,string>={}){return{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)};}
function previewTicket(url:string){return new URLSearchParams(new URL(url).hash.slice(1)).get("ticket")!;}
async function redeem(url:string){return request("/api/open/preview",post({ticket:previewTicket(url)},{Origin:base}));}
async function main(){
 const meta=await request("/.well-known/oauth-authorization-server");check(meta.status===200 && meta.data.issuer===base && meta.data.code_challenge_methods_supported[0]==="S256","OAuth discovery returns canonical issuer and PKCE");
 const rootResource=await request("/.well-known/oauth-protected-resource");check(rootResource.status===200&&rootResource.headers.get("content-type")?.includes("application/json")&&rootResource.data.resource===base,"root protected-resource discovery matches root identifier");
 const resource=await request("/.well-known/oauth-protected-resource/api/mcp");check(resource.status===200&&resource.headers.get("content-type")?.includes("application/json")&&resource.data.resource===`${base}/api/mcp`,"path-specific protected-resource discovery matches MCP identifier");
 const missing=await request("/api/mcp");check(missing.status===401&&missing.headers.get("www-authenticate")?.includes(`${base}/.well-known/oauth-protected-resource/api/mcp`),"MCP advertises path-specific OAuth discovery on 401");
 const login=await request("/api/login",post({username:"admin",password:"admin"}));assert.equal(login.status,200);
 const cookie=login.headers.getSetCookie().map(s=>s.split(";")[0]).join("; ");const headers={Cookie:cookie,Origin:base};
 const callback="http://127.0.0.1:47999/oauth/callback";
 async function register(){const r=await request("/oauth/register",post({client_name:"WorkBuddy OAuth 验收",redirect_uris:[callback,"workbuddy://workbuddy/mcp/connector%3Ashuwen-studio-cloud/oauth/callback"],token_endpoint_auth_method:"none"}));assert.equal(r.status,201);return r.data.client_id as string;}
 const client=await register(),client2=await register();
 check((await request("/oauth/register",post({redirect_uris:["http://evil.example/oauth/callback"]}))).status===400,"registration rejects non-loopback insecure callback");
 check((await request("/oauth/register",post({redirect_uris:[callback],token_endpoint_auth_method:"client_secret_post"}))).status===400,"public-client registration rejects secret-based authentication");
 const verifier=randomBytes(32).toString("base64url");const challenge=createHash("sha256").update(verifier).digest("base64url");
 function authParams(){return new URLSearchParams({client_id:client,redirect_uri:callback,response_type:"code",code_challenge_method:"S256",code_challenge:challenge,scope:"studio",state:randomBytes(20).toString("hex"),resource:`${base}/api/mcp`});}
 async function consent(params=authParams()){
  const page=await request(`/oauth/authorize?${params}`,{headers});assert.equal(page.status,200);
  const id=/name="request_id" value="([^"]+)"/.exec(page.text)?.[1];assert.ok(id,"consent has opaque request id");return{id,params,page};
 }
 async function approve(){const c=await consent();const r=await request("/api/oauth/authorize",post({request_id:c.id,decision:"approve"},headers));assert.equal(r.status,303);const callbackUrl=new URL(r.headers.get("location")!);assert.equal(callbackUrl.searchParams.get("state"),c.params.get("state"));return callbackUrl.searchParams.get("code")!;}
 for (const [name,expected] of [["WorkBuddy Connector","WorkBuddy"],["Example BI Client","Example BI Client"],["WorkBuddy Research Helper","WorkBuddy Research Helper"],[undefined,"未命名应用"]] as const) {
  const registered=await request("/oauth/register",post({client_name:name,redirect_uris:[callback],token_endpoint_auth_method:"none"}));assert.equal(registered.status,201);
  const params=authParams();params.set("client_id",registered.data.client_id);params.set("client_name","Injected Client Name");
  const {page}=await consent(params);const heading=/<h1[^>]*>(.*?)<\/h1>/.exec(page.text)?.[1].replace(/<!--.*?-->/g,"");
  check(heading===`授权给 ${expected}`,`consent identifies registered client ${name??"(unnamed)"} and ignores URL-supplied names`);
 }
 const start=authParams();check((await request(`/oauth/authorize?${start}`)).headers.get("location")?.includes("next="),"unauthenticated authorization returns through login with original request");
 const bad=authParams();bad.set("redirect_uri",`${callback}?changed=1`);check(!(await request(`/oauth/authorize?${bad}`,{headers})).text.includes('name="request_id"'),"exact redirect matching blocks modified callback");
 const wrongResource=authParams();wrongResource.set("resource","https://other.example/api/mcp");check(!(await request(`/oauth/authorize?${wrongResource}`,{headers})).text.includes('name="request_id"'),"authorization rejects a different resource audience");
 const noPkce=authParams();noPkce.set("code_challenge_method","plain");check(!(await request(`/oauth/authorize?${noPkce}`,{headers})).text.includes('name="request_id"'),"plain PKCE rejected");
 const c=await consent();check(c.page.text.includes("DataTalk Studio")&&c.page.text.includes("授权连接"),"consent shows account and draft-development capabilities");
 check(c.page.headers.get("referrer-policy")==="same-origin","consent HTTP policy preserves the browser Origin for same-origin form submission");
 check(c.page.text.includes('name="referrer" content="same-origin"'),"consent metadata agrees with its HTTP referrer policy");
 check((await request("/api/oauth/authorize",post({request_id:c.id,decision:"approve"},{Cookie:cookie,Origin:"https://evil.example"}))).status===403,"consent rejects cross-origin approval");
 check((await request("/api/oauth/authorize",post({request_id:c.id,decision:"approve"},{Cookie:cookie}))).status===403,"consent requires same-origin browser submission");
 const denied=await request("/api/oauth/authorize",post({request_id:c.id,decision:"deny"},headers));check(denied.status===303&&new URL(denied.headers.get("location")!).searchParams.get("error")==="access_denied","denial returns state and access_denied");
 check((await request("/api/oauth/authorize",post({request_id:c.id,decision:"approve"},headers))).status===400,"consent nonce is single use");
 const code=await approve();
 const exchange=(code:string,extra:Record<string,unknown>={})=>request("/oauth/token",post({grant_type:"authorization_code",client_id:client,redirect_uri:callback,resource:`${base}/api/mcp`,code,code_verifier:verifier,...extra}));
 check((await exchange(code,{code_verifier:randomBytes(32).toString("base64url")})).status===400,"wrong verifier cannot exchange authorization code");
 check((await exchange(code,{client_id:client2})).status===400,"code bound to registered client");
 check((await exchange(code,{redirect_uri:callback+"?other=1"})).status===400,"code bound to exact redirect");
 check((await exchange(code,{resource:"https://other.example/api/mcp"})).status===400,"token exchange rejects wrong audience");
 const issued=await exchange(code);check(issued.status===200&&issued.data.expires_in===3600&&issued.data.refresh_token.startsWith("dtrt_"),"valid PKCE issues 1h access and refresh tokens");
 const api=(token:string,tool="get_studio_context",args={})=>request(`/api/open/v1/tools/${tool}`,post(args,{Authorization:`Bearer ${token}`}));
 check((await api(issued.data.access_token)).status===200,"OAuth token uses existing Studio tools");
 check((await exchange(code)).status===400&&(await api(issued.data.access_token)).status===401,"authorization code replay terminates its grant");
 const active=(await exchange(await approve())).data;
 const refresh=(token:string,extra:Record<string,unknown>={})=>request("/oauth/token",post({grant_type:"refresh_token",client_id:client,refresh_token:token,...extra}));
 check((await refresh(active.refresh_token,{client_id:client2})).status===400,"refresh token bound to original client");
 const renewed=await refresh(active.refresh_token);check(renewed.status===200&&renewed.data.refresh_token!==active.refresh_token&&(await api(renewed.data.access_token)).status===200,"refresh rotates credentials and preserves tool access");
 check((await refresh(active.refresh_token)).status===400&&(await api(renewed.data.access_token)).status===401,"refresh reuse revokes entire token family");
 const racing=(await exchange(await approve())).data;
 const races=await Promise.all([refresh(racing.refresh_token),refresh(racing.refresh_token)]);check(races.filter(r=>r.status===200).length===1&&races.filter(r=>r.status===400).length===1,"concurrent refresh has exactly one successful exchange");
 const raceToken=races.find(r=>r.status===200)!.data.access_token;check((await api(raceToken)).status===401,"concurrent replay also invalidates the winning token family");
 const valid=(await exchange(await approve())).data;
 const fixture=JSON.parse(await fs.readFile(".workbuddy-local/acceptance.json","utf8"));const reportCode=fixture.reportCode;
 const inspected=await api(valid.access_token,"inspect_report",{reportCode});
 check(inspected.status===200&&!inspected.data.previewRequiresLogin&&!inspected.data.visualInspectionPerformed,"inspect issues a fresh limited preview link without claiming visual acceptance");
 const landing=await request(inspected.data.previewUrl);check(landing.status===200&&!landing.headers.getSetCookie().length&&landing.text.includes("location.hash"),"link metadata GET does not consume preview ticket");
 check((await request(inspected.data.previewUrl,{method:"HEAD"})).status===200,"HEAD probe does not consume preview ticket");
 check((await request("/api/open/preview",post({ticket:previewTicket(inspected.data.previewUrl)},{Origin:"https://evil.example"}))).status===403,"preview exchange rejects foreign origin");
 const preview=await redeem(inspected.data.previewUrl);check(preview.status===200&&preview.data.next===`/preview/${reportCode}`,"preview ticket exchanges for clean report URL");
 const previewCookie=preview.headers.getSetCookie().map(s=>s.split(";")[0]).join("; ");
 check(previewCookie.startsWith(`studio-preview-${reportCode}=`)&&!previewCookie.includes("datatalk-session"),"preview never grants a full Studio login session");
 check(preview.headers.getSetCookie()[0].includes("HttpOnly")&&preview.headers.get("referrer-policy")==="no-referrer","preview cookie is HttpOnly and ticket not forwarded as referrer");
 check((await redeem(inspected.data.previewUrl)).status===401,"preview ticket replay rejected");
 const ph={Cookie:previewCookie,Origin:base};
 const page=await request(`/preview/${reportCode}`,{headers:ph});check(page.status===200&&page.text.includes("iframe")&&!page.text.includes("预览会话已结束"),"fresh browser session can open report without Studio login");
 const data=await request(`/api/reports/${reportCode}/data`,post({dataId:"channelRevenue",source:"working"},ph));check(data.status===200&&JSON.stringify(data.data).includes("1200")&&JSON.stringify(data.data).includes("800"),"limited preview executes real report data handler");
 check((await request("/api/settings/api-keys",{headers:ph})).status===401,"preview cannot read API key management");
 check((await request("/api/settings/oauth-grants",{headers:ph})).status===401,"preview cannot manage OAuth grants");
 check((await request("/api/reports/not_this_report/data",post({dataId:"channelRevenue",source:"working"},ph))).status===401,"preview cookie cannot access other report data");
 check((await request(`/api/reports/${reportCode}/data`,post({dataId:"channelRevenue",source:"working"},{...ph,Origin:"https://evil.example"}))).status===403,"working report data rejects cross-site requests");
 const [logs]=await pool.query<any[]>("SELECT key_id,oauth_grant_id FROM studio_api_log WHERE oauth_grant_id IS NOT NULL ORDER BY id DESC LIMIT 1");check(logs.length&&Number(logs[0].key_id)===0&&logs[0].oauth_grant_id,"OAuth invocations retain grant provenance in audit");
 const [tokenRows]=await pool.query<any[]>("SELECT token_hash FROM studio_oauth_token LIMIT 100");check(tokenRows.every(r=>/^[a-f0-9]{64}$/.test(r.token_hash)),"OAuth stores digests separately from plaintext API keys");
 const list=await request("/api/settings/oauth-grants",{headers});check(list.data.grants.length>0,"API management lists active cloud connections");
 const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
 const [target]=await pool.query<any[]>("SELECT grant_id FROM studio_oauth_token WHERE token_hash=?",[hash(valid.access_token)]);
 check((await request(`/api/settings/oauth-grants/${target[0].grant_id}`,{method:"DELETE",headers})).status===200,"user can cancel own cloud authorization");
 check((await api(valid.access_token)).status===401&&(await refresh(valid.refresh_token)).status===400,"canceling authorization invalidates access and refresh tokens");
 check((await request(`/api/reports/${reportCode}/data`,post({dataId:"channelRevenue",source:"working"},ph))).status===401,"canceling authorization invalidates open preview data access");
 const key=await request("/api/settings/api-keys",post({name:"preview-test"},headers));
 const keyPreview=await api(key.data.secret,"inspect_report",{reportCode});const kp=await redeem(keyPreview.data.previewUrl);const kh={Cookie:kp.headers.getSetCookie().map(s=>s.split(";")[0]).join("; "),Origin:base};
 check((await request(`/api/reports/${reportCode}/data`,post({dataId:"channelRevenue",source:"working"},kh))).status===200,"private API Key receives the same limited preview flow");
 await request(`/api/settings/api-keys/${key.data.key.id}`,{method:"DELETE",headers});check((await request(`/api/reports/${reportCode}/data`,post({dataId:"channelRevenue",source:"working"},kh))).status===401,"physical API Key deletion invalidates its preview");
 const expiry=(await exchange(await approve())).data;const expiredLink=await api(expiry.access_token,"inspect_report",{reportCode});
 await pool.execute("UPDATE studio_preview_session SET ticket_expires_at=0 WHERE ticket_hash=?",[hash(previewTicket(expiredLink.data.previewUrl))]);check((await redeem(expiredLink.data.previewUrl)).status===401,"expired preview tickets fail closed");
 const sessionLink=await api(expiry.access_token,"inspect_report",{reportCode});const sp=await redeem(sessionLink.data.previewUrl);const sessionCookie=sp.headers.getSetCookie()[0].split(";")[0];
 await pool.execute("UPDATE studio_preview_session SET session_expires_at=0 WHERE session_hash=?",[hash(sessionCookie.slice(sessionCookie.indexOf("=")+1))]);check((await request(`/api/reports/${reportCode}/data`,post({dataId:"channelRevenue",source:"working"},{Cookie:sessionCookie,Origin:base}))).status===401,"expired preview sessions fail closed");
 await pool.execute("UPDATE studio_oauth_token SET expires_at=0 WHERE token_hash=?",[hash(expiry.access_token)]);check((await api(expiry.access_token)).status===401,"expired OAuth access token rejected");
 const refreshed=await refresh(expiry.refresh_token);check(refreshed.status===200,"valid refresh recovers an expired access token");
 await request("/oauth/revoke",post({client_id:client,token:refreshed.data.refresh_token}));check((await api(refreshed.data.access_token)).status===401,"RFC7009 revocation terminates the connection");
 await fs.writeFile(".workbuddy-local/oauth-acceptance.json",JSON.stringify({baseUrl:base,checks,reportCode,verifiedAt:new Date().toISOString(),coverage:["metadata","DCR","PKCE","consent","refresh rotation","replay","revocation","limited preview","dynamic report data","API key compatibility"]},null,2));
 console.log(`OAuth and preview integration: ${checks} checks passed`);
}
main().finally(()=>pool.end()).catch(e=>{console.error(e);process.exitCode=1;});

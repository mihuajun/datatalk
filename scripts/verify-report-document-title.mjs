// Isolated metadata authorization and browser title regression; no database access.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
const mocks={
 '@/lib/server/studio-preview':'export async function getReportPreviewSession(){return globalThis.titleFixture.preview}',
 '@/lib/server/auth-session':'export async function getAuthSession(){return globalThis.titleFixture.auth}',
 '@/lib/server/report-repository':'export async function getReportDetailByCode(tenantId,code){globalThis.titleFixture.reads++;return tenantId===7&&code==="fixture"?{report:{name:"测试报表 · 中文标题"}}:null}',
 '@/lib/server/workbuddy-oauth':'export function isWorkBuddyLoginConfigured(){return true}',
 '@/lib/report-filters':'export const resolveReportFilterValues=()=>({});export const toReportSearchParams=()=>new URLSearchParams()',
 '@/lib/report-web':'export const composeWebReportSrcDoc=()=>"";export const toWebReportFiles=()=>({})',
 '@/components/report-web-frame':'export const ReportWebFrame=()=>null',
 './workbuddy-toolbar':'export const WorkBuddyPreviewToolbar=()=>null',
 'next/navigation':'export function notFound(){throw Error("not found")};export function redirect(){throw Error("redirect")}',
};
const result=await build({entryPoints:['app/preview/[code]/page.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'isolation',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}))}}]});
const dir=await mkdtemp(path.join(tmpdir(),'studio-title-'));await writeFile(path.join(dir,'metadata.mjs'),result.outputFiles[0].text);
try{
 const {generateMetadata}=await import(pathToFileURL(path.join(dir,'metadata.mjs')).href);
 async function title(auth,preview,tools=false,code='fixture'){
  globalThis.titleFixture={auth,preview,reads:0};return generateMetadata({params:Promise.resolve({code}),searchParams:Promise.resolve(tools?{workbuddyTools:'1'}:{})});
 }
 assert.equal((await title({tenantId:7},null)).title.absolute,'测试报表 · 中文标题');
 assert.equal((await title(null,{tenantId:7})).title.absolute,'测试报表 · 中文标题');
 assert.equal((await title(null,{tenantId:7},true)).title.absolute,'DataTalk Studio');assert.equal(globalThis.titleFixture.reads,0);
 assert.equal((await title({tenantId:8},{tenantId:7},true)).title.absolute,'DataTalk Studio');
 assert.equal((await title(null,null)).title.absolute,'DataTalk Studio');assert.equal(globalThis.titleFixture.reads,0);
 await title({tenantId:7},null,false,'../invalid');assert.equal(globalThis.titleFixture.reads,0);
 console.log('PASS preview metadata: report name, preview session, login-only toolbar, tenant isolation, invalid/unauthenticated fallback');
}finally{await rm(dir,{recursive:true,force:true});delete globalThis.titleFixture}
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const client=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{useReportDocumentTitle}from'./components/reports/report-document-title';function Title({name}){useReportDocumentTitle(name);return null};const root=createRoot(document.getElementById('root'));window.updateTitle=name=>root.render(<Title name={name}/>);window.disposeTitle=()=>root.unmount();window.updateTitle(null);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'});
const server=createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(client.outputFiles[0].text)}else{res.setHeader('Content-Type','text/html');res.end('<html><title>DataTalk Studio</title><div id="root"></div><script src="/bundle.js"></script></html>')}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);assert.equal(await page.title(),'DataTalk Studio');
 for(const name of ['销售经营报表','修改后的报表名']){await page.evaluate(name=>window.updateTitle(name),name);await page.waitForFunction(name=>document.title===name,name)}
 await page.evaluate(()=>window.updateTitle(''));await page.waitForFunction(()=>document.title==='DataTalk Studio');
 await page.evaluate(()=>window.updateTitle('新报表'));await page.waitForFunction(()=>document.title==='新报表');await page.evaluate(()=>{document.title='下一页';window.disposeTitle()});assert.equal(await page.title(),'下一页');
 console.log('PASS editor title: initial load, Chinese report name, rename, empty fallback, route cleanup');
}finally{await browser.close();await new Promise(r=>server.close(r))}

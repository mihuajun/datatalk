// Real file generation and browser downloads against an isolated report-frame fixture.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const editorMode=process.argv.includes('--editor');
const mocks={
 'next/navigation':'const params=new URLSearchParams();const router={push(){},replace(){}};export const useRouter=()=>router;export const useSearchParams=()=>params;',
 '@/components/report-web-frame':`import React from 'react';export function ReportWebFrame({onLoad,title}){return <iframe title={title} src="/frame" onLoad={event=>onLoad?.(event.currentTarget)}/>}`,
};
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';${editorMode ? "import{ReportEditorPageClient as Screen}from'./app/reports/editor/page';" : "import{WorkBuddyPreviewToolbar as Screen}from'./app/preview/[code]/workbuddy-toolbar';"}window.opens=[];window.open=(...a)=>window.opens.push(a);createRoot(document.getElementById('root')).render(<Screen reportCode="fixture"/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'editor-fixtures',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}))}}]});
const server=createServer((req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text)}
 if(req.url==='/api/reports/fixture'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({report:{name:'年度销售报表',code:'fixture',status:'草稿',updatedAt:'2026-11-17',publicLinkEnabled:false},webFiles:{'page.html':'<h1>年度销售报表</h1>'},resourceCenterEnabled:false,publicLinkCode:null,publicLinkPassword:null,publicLinkPasswordEnabled:false,publicLinkExpiresAt:null}))}
 if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({lock:{lockToken:'edit-lock-disabled'},conversations:[]}))}
 if(req.url==='/frame'){res.setHeader('Content-Type','text/html');return res.end(`<script>addEventListener('message',e=>{if(e.data.type!=='__DATATALK_INSPECT_REQUEST__')return;parent.captureMode=e.data.screenshotMode;const c=document.createElement('canvas');c.width=640;c.height=2000;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,640,2000);x.fillStyle='blue';x.fillRect(0,0,640,100);x.fillStyle='red';x.fillRect(0,1900,640,100);parent.postMessage({type:'__DATATALK_INSPECT_RESPONSE__',requestId:e.data.requestId,ok:!parent.failCapture,capture:{dataUrl:c.toDataURL('image/png')}},'*')})</script>`)}
 res.setHeader('Content-Type','text/html');res.end('<html><meta charset="utf-8"><div id="root"></div>'+(editorMode?'':'<div data-workbuddy-preview><iframe src="/frame"></iframe></div>')+'<script src="/bundle.js"></script></html>');
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const dir=await mkdtemp(path.join(tmpdir(),'studio-download-'));
try{
 const page=await browser.newPage({acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 if(!editorMode) assert.equal(await page.getByRole('button',{name:'分享',exact:true}).count(),1);
 else {await page.getByRole('textbox',{name:'报表名称',exact:true}).waitFor(); await page.waitForFunction(()=>document.title==='年度销售报表');}
 await page.getByRole('button',{name:'下载',exact:true}).click();assert.equal(await page.getByRole('menuitem').count(),2);await page.keyboard.press('Escape');assert.equal(await page.getByRole('menu').count(),0);
 assert.equal(await page.getByRole('button',{name:'下载',exact:true}).evaluate(el=>el===document.activeElement),true);
 await page.getByRole('button',{name:'下载',exact:true}).click();await page.getByRole('menu').waitFor();await page.locator('body').dispatchEvent('pointerdown');assert.equal(await page.getByRole('menu').count(),0);
 await page.getByRole('button',{name:'下载',exact:true}).click();await page.keyboard.press('ArrowDown');assert.equal(await page.getByRole('menuitem',{name:'PNG',exact:true}).evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');
 for(const format of ['PNG','PDF']){
  await page.getByRole('button',{name:'下载',exact:true}).click();
  const pending=page.waitForEvent('download');await page.getByRole('menuitem',{name:format,exact:true}).click();const download=await pending;
  assert.equal(download.suggestedFilename(),`年度销售报表.${format.toLowerCase()}`);assert.equal(await download.failure(),null);assert.equal(await page.evaluate(()=>window.captureMode),'full');
  const file=path.join(dir,`report.${format.toLowerCase()}`);await download.saveAs(file);const bytes=await readFile(file);
  if(format==='PNG'){assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),640);assert.equal(bytes.readUInt32BE(20),2000)}
  else{assert.equal(bytes.subarray(0,5).toString(),'%PDF-');const info=execFileSync('pdfinfo',[file],{encoding:'utf8'});assert.match(info,/Pages:\s+3/);assert.match(info,/Page size:\s+595\S* x 841\S* pts/)}
  await page.getByRole('link',{name:`保存 ${format}`,exact:true}).waitFor();
 }
 assert.equal(await page.evaluate(()=>window.opens.length),0);
 await page.evaluate(()=>window.failCapture=true);await page.getByRole('button',{name:'下载',exact:true}).click();await page.getByRole('menuitem',{name:'PNG',exact:true}).click();await page.getByRole('alert').filter({hasText:'无法生成报表截图'}).waitFor();assert.equal(await page.getByRole('link',{name:'保存 PNG'}).count(),0);
 assert.deepEqual(errors,[]);console.log(editorMode ? 'EDITOR: PASS actual editor header/ref integration, PDF/PNG downloads, Chinese report title and filenames, keyboard/focus, manual save, failure feedback' : 'PASS share label; download menu/Escape; full-height PNG; valid 3-page A4 PDF; Chinese filenames; manual download link; capture failure; no external windows');
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})}

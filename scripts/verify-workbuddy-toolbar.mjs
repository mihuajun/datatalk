// Isolated browser test; mock report APIs only, never writes to production.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {WorkBuddyPreviewToolbar} from './app/preview/[code]/workbuddy-toolbar'; window.opens=[]; window.open=(...args)=>window.opens.push(args); createRoot(document.getElementById('root')).render(<WorkBuddyPreviewToolbar reportCode="fixture"/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle:true, write:false, platform:'browser', format:'iife', jsx:'automatic' });
let unauthorized = false;
const writes = [];
const detail = { report:{name:'测试报表',publicLinkEnabled:false}, publicLinkCode:null, publicLinkPassword:null, publicLinkPasswordEnabled:false, publicLinkExpiresAt:null, resourceCenterEnabled:true, resourceItem:null, resourceCategoriesByType:{ report:[{id:1,name:'测试行业',level:0,parentId:null}] } };
const server = createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text)}
 if(req.url.startsWith('/api/reports/')){
  res.setHeader('Content-Type','application/json');
  if(unauthorized){res.statusCode=401;return res.end('{}')}
  if(req.method==='GET')return res.end(JSON.stringify(detail));
  let body=''; for await(const chunk of req)body+=chunk; writes.push({url:req.url,body:body?JSON.parse(body):{}});
  if(req.url.endsWith('/public-link')){const b=JSON.parse(body); detail.report.publicLinkEnabled=b.enabled;detail.publicLinkCode=b.rotate?'rotated-link':(detail.publicLinkCode||'public-test'); if(b.passwordEnabled!==undefined)detail.publicLinkPasswordEnabled=b.passwordEnabled; if(b.resetPassword||b.passwordEnabled)detail.publicLinkPassword=b.resetPassword?'5678':'1234'; if(b.expiresAt!==undefined)detail.publicLinkExpiresAt=b.expiresAt;return res.end(JSON.stringify(detail))}
  res.end(JSON.stringify(req.url.endsWith('/release')?{version:2}:{resourceItem:{id:1,title:'测试报表'}}));return;
 }
 res.setHeader('Content-Type','text/html');res.end(`<html><meta charset="utf-8"><div id="root"></div><div data-workbuddy-preview><iframe srcdoc="<script>addEventListener('message',e=>{if(e.data.type==='__DATATALK_INSPECT_REQUEST__')parent.postMessage({type:'__DATATALK_INSPECT_RESPONSE__',requestId:e.data.requestId,ok:true,capture:{dataUrl:'data:image/png;base64,TEST'}},'*')})</script>"></iframe></div><script src="/bundle.js"></script></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.confirm=()=>{throw new Error('native confirm must not be used')}; window.testCopySuccess=false; document.execCommand=()=>{window.copiedValue=document.activeElement.value;return window.testCopySuccess}; Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new DOMException('Write permission denied','NotAllowedError')}}});});
 async function changeLink(action){const response=page.waitForResponse(r=>r.url().endsWith('/public-link')&&r.request().method()==='PATCH');await action();await response;await page.waitForFunction(()=>!document.querySelector('[role=switch]').disabled);}
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'发布',exact:true}).click(); assert.equal(writes.length,0);
 await page.getByRole('button',{name:'确认发布',exact:true}).click(); await page.getByRole('status').filter({hasText:'报表已发布'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'发布到资源中心',exact:true}).count(),0);
 assert.equal(await page.getByRole('navigation',{name:'WorkBuddy 报表工具栏'}).getByRole('status').textContent(),'报表已发布（v2）');
 await page.getByRole('button',{name:'分享'}).click();await changeLink(()=>page.getByRole('switch',{name:'启用公共链接'}).click());
 assert.equal(await page.evaluate(()=>window.opens.length),0);assert.equal(writes.length,2);
 // Modern clipboard denied + legacy succeeds; then both denied, manual fallback.
 await page.evaluate(()=>window.testCopySuccess=true);
 await page.getByRole('button',{name:'复制公共链接',exact:true}).first().click(); assert.equal(await page.getByRole('status').count(),0);
 await page.getByRole('button',{name:'复制公共链接',exact:true}).first().locator('svg.lucide-check').waitFor();
 await page.getByRole('button',{name:'复制公共链接',exact:true}).first().locator('svg.lucide-copy').waitFor({timeout:4000});
 await page.evaluate(()=>window.testCopySuccess=false);
 await page.getByRole('button',{name:'复制公共链接',exact:true}).first().click(); assert.equal(await page.getByRole('button',{name:'复制公共链接',exact:true}).first().locator('svg.lucide-check').count(),0); await page.getByRole('textbox',{name:'手动复制链接和密码'}).waitFor();
 assert.ok((await page.getByRole('textbox',{name:'手动复制链接和密码'}).inputValue()).includes('/link/public-test'));
 await changeLink(()=>page.getByRole('button',{name:'更换公共链接',exact:true}).click());assert.equal(writes.at(-1).body.rotate,true);assert.equal(await page.getByRole('alertdialog').count(),0);assert.equal(await page.getByRole('status').count(),0);
 await changeLink(()=>page.getByRole('checkbox',{name:'密码保护'}).click());
 await changeLink(()=>page.getByRole('button',{name:'重置',exact:true}).click());assert.equal(writes.at(-1).body.resetPassword,true);assert.equal(await page.getByRole('alertdialog').count(),0);
 await page.evaluate(()=>window.testCopySuccess=true);
 await page.getByRole('button',{name:'复制公共链接',exact:true}).click();assert.ok((await page.evaluate(()=>window.copiedValue)).endsWith('/link/rotated-link'));assert.ok(!(await page.evaluate(()=>window.copiedValue)).includes('5678')); await page.getByRole('button',{name:'复制公共链接',exact:true}).locator('svg.lucide-check').waitFor(); assert.equal(await page.getByRole('button',{name:'复制链接和密码',exact:true}).locator('svg.lucide-check').count(),0);
 await page.getByRole('button',{name:'复制链接和密码',exact:true}).click();assert.ok((await page.evaluate(()=>window.copiedValue)).includes('密码: 5678'));assert.equal(await page.getByRole('status').count(),0);
 await page.getByRole('button',{name:'已复制链接和密码',exact:true}).locator('svg.lucide-check').waitFor();assert.equal(await page.getByRole('button',{name:'复制公共链接',exact:true}).locator('svg.lucide-check').count(),0);
 await page.getByRole('button',{name:'复制链接和密码',exact:true}).locator('svg.lucide-copy').waitFor({timeout:4000});
 await page.evaluate(()=>window.testCopySuccess=false);
 await page.getByRole('button',{name:/^(已)?复制链接和密码$/}).click();await page.getByRole('textbox',{name:'手动复制链接和密码'}).waitFor();assert.ok((await page.getByRole('textbox',{name:'手动复制链接和密码'}).inputValue()).includes('5678'));
 await changeLink(()=>page.getByRole('button',{name:'设置截止时间',exact:true}).click());await page.locator('input[aria-label=截止时间]').fill('2000-01-01T12:00');const beforeExpiry=writes.length;await page.getByRole('button',{name:'保存有效期'}).click();await page.getByRole('alert').filter({hasText:'请输入未来'}).waitFor();assert.equal(writes.length,beforeExpiry);
 await page.locator('input[aria-label=截止时间]').fill('2099-12-31T18:00');await changeLink(()=>page.getByRole('button',{name:'保存有效期'}).click());assert.ok(writes.at(-1).body.expiresAt.startsWith('2099-12-31'));
 await changeLink(()=>page.getByRole('combobox',{name:'有效期',exact:true}).selectOption('permanent'));assert.equal(writes.at(-1).body.expiresAt,null);
 await changeLink(()=>page.getByRole('switch',{name:'禁用公共链接'}).click());assert.equal(writes.at(-1).body.enabled,false);
 const successfulWrites=writes.length;

 await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('button',{name:'预览',exact:true}).count(),0); await page.getByRole('button',{name:'打开',exact:true}).click();assert.equal(await page.evaluate(()=>window.opens.length),1); assert.ok((await page.evaluate(()=>window.opens[0][0])).endsWith('/reports/editor?code=fixture'));
 unauthorized=true;await page.getByRole('button',{name:'发布',exact:true}).click();await page.getByRole('button',{name:'确认发布',exact:true}).click();await page.getByRole('alert').filter({hasText:'网页登录已过期'}).waitFor();assert.equal(writes.length,successfulWrites);
 assert.deepEqual(errors,[]);console.log('PASS: confirmation, inline release/public-link, resource button removed, editor-native expiry controls, external open-editor only; no preview button, clipboard denial fallbacks, silent rotate/reset without confirmation; link-only vs link-and-password copy, per-button copied icon restores after 1800ms; failed copy never shows success; expiry validation/save/permanent, link disabling, expired session fails closed');
}finally{await browser.close();await new Promise(r=>server.close(r))}

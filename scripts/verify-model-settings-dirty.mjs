import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const db=new DatabaseSync(path.resolve('.workbuddy-local/metric-governance/test.sqlite'));
const original=db.prepare("SELECT role FROM tenant_user WHERE username='admin'").get();
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 db.prepare("UPDATE tenant_user SET role='administrator' WHERE username='admin'").run();
 const context=await browser.newContext();await context.request.post('http://127.0.0.1:3010/api/login',{data:{username:'admin',password:'admin'}});
 const page=await context.newPage();
 let model={baseUrl:'https://chat.example/v1',model:'chat-fixture',apiKeyConfigured:true,apiKeyPreview:'test••••test',imageBaseUrl:'https://image.example/v1',imageModel:'image-fixture',imageEnabled:true,imageApiKeyConfigured:true,imageApiKeyPreview:'test••••test'};
 let vector={baseUrl:'https://vector.example/v1',model:'vector-fixture',enabled:true,apiKeyConfigured:true,apiKeyPreview:'test••••test'};let saves=0;
 await page.route('**/api/settings/agent-runtime',r=>r.fulfill({json:{runtime:{installed:true,running:false,installing:false,state:'installed'}}}));
 await page.route('**/api/settings/agent-model',async r=>{if(r.request().method()==='POST'){const b=r.request().postDataJSON();if(b.action==='save'){saves++;model=b.section==='chat'?{...model,model:b.model,baseUrl:b.baseUrl}:{...model,imageModel:b.imageModel,imageBaseUrl:b.imageBaseUrl,imageEnabled:b.imageEnabled};}}await r.fulfill({json:{model,message:'已保存'}});});
 await page.route('**/api/settings/metric-embedding',async r=>{if(r.request().method()==='POST'){const b=r.request().postDataJSON();if(b.action==='save'){saves++;vector={...vector,model:b.model,baseUrl:b.baseUrl,enabled:b.enabled};}}await r.fulfill({json:{config:vector,message:'已保存'}});});
 await page.goto('http://127.0.0.1:3010/settings');await page.getByRole('button',{name:'模型配置',exact:true}).click();
 const sections=['#agent-model-config','#image-model-config','#embedding-model-config'];
 for(const [i,id] of sections.entries()){
  const section=page.locator(id), save=section.getByRole('button',{name:'保存配置',exact:true}),input=section.getByLabel('模型名称',{exact:false});
  await input.waitFor();await page.waitForTimeout(100);
  assert.equal(await save.isDisabled(),true,`${id} initial disabled`);
  assert.equal(await section.getByRole('button',{name:'测试连接',exact:true}).isEnabled(),true);
  const old=await input.inputValue();await input.fill(old+'-changed');assert.equal(await save.isEnabled(),true);
  for(const other of sections.filter(x=>x!==id))assert.equal(await page.locator(other).getByRole('button',{name:'保存配置',exact:true}).isDisabled(),true);
  await input.fill(old);assert.equal(await save.isDisabled(),true);
  await input.fill(old+'-saved');await save.click();await page.waitForTimeout(100);assert.equal(await save.isDisabled(),true);
  const key=section.locator('input[type=password]');await key.fill('new-key');assert.equal(await save.isEnabled(),true);await key.fill('');assert.equal(await save.isDisabled(),true);
  if(i>0){await section.getByRole('switch').click();assert.equal(await save.isEnabled(),true);await section.getByRole('switch').click();assert.equal(await save.isDisabled(),true);}
 }
 assert.equal(saves,3);console.log(JSON.stringify({ok:true,checks:['all three initially disabled','editing enables own save only','reverting disables','save resets baseline','key edits detected','switch edits detected','test buttons remain enabled']}));
}finally{db.prepare("UPDATE tenant_user SET role=? WHERE username='admin'").run(original.role);db.close();await browser.close();}

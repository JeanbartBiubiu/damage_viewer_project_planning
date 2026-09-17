import {chromium} from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {plan} from './候选.mjs';
import {here,request,diff,verifySources} from './录入.mjs';
const key='annie_r',body=plan.skills[key].write.parameters.find(p=>p.parameterKey==='magic_penetration_ratio');
const report={startedAt:new Date().toISOString(),purpose:'当前版本R法穿参数页面试录，参数存在则只读',actions:[],failures:[]};
await verifySources();const before=await request('/skills/'+key+'/parameters/'+body.parameterKey);
if(before.ok&&diff(body,before.data))throw Error('同键现值不同，禁止覆盖');
if(!before.ok&&before.status!==404)throw Error('前置读取失败');
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1450,height:1050}});
try{
 await page.goto('http://127.0.0.1:5173/#/skills',{waitUntil:'domcontentloaded'});
 await page.locator('.app-toolbar-field--api input').fill('http://127.0.0.1:8080');
 await page.locator('.app-toolbar-field--token input').fill('local-entry');
 await page.getByRole('button',{name:'应用',exact:true}).click();
 await page.locator('.sidebar-status-line').filter({hasText:/^GameId lol$/}).waitFor();
 await page.getByLabel('技能关键词',{exact:true}).fill(key);await page.getByRole('button',{name:'查询',exact:true}).click();
 const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:key,exact:true})});
 await row.getByRole('button',{name:'参数与公式',exact:true}).click();
 const list=page.getByRole('dialog').filter({hasText:'参数与公式'}).first();
 await list.waitFor();
 if(before.status===404){
  if(!process.argv.includes('--apply-browser')){report.actions.push({action:'read-only-missing'});}
  else{
   await list.getByRole('button',{name:'新增参数',exact:true}).click();
   const modal=page.getByRole('dialog',{name:'新增参数',exact:true});await modal.waitFor();
   await modal.getByLabel('稳定标识',{exact:true}).fill(body.parameterKey);await modal.getByLabel('参数名称',{exact:true}).fill(body.name);
   await modal.locator('label').filter({hasText:/^小数$/}).click();await modal.locator('label').filter({hasText:/^按技能等级$/}).click();
   for(const [level,value] of Object.entries(body.levelValues))await modal.getByRole('spinbutton',{name:'等级'+level+'数值',exact:true}).fill(String(value));
   await modal.getByLabel('说明',{exact:true}).fill(body.description);await modal.getByRole('spinbutton',{name:'排序',exact:true}).fill(String(body.sortOrder));
   await modal.getByRole('button',{name:'保存',exact:true}).click();await modal.waitFor({state:'hidden'});
   report.actions.push({action:'browser-create',object:key+'/'+body.parameterKey});
  }
 }
 const got=await request('/skills/'+key+'/parameters/'+body.parameterKey);
 if(got.ok){const d=diff(body,got.data);if(d)throw Error('页面保存独立GET不符 '+JSON.stringify(d));report.actions.push({action:'independent-get',match:true});
  const item=list.getByRole('row').filter({hasText:body.parameterKey});await item.getByRole('button',{name:'查看',exact:true}).click();const view=page.getByRole('dialog',{name:'查看参数',exact:true});await view.waitFor();
  const values={};for(const i of [1,2,3])values[i]=await view.getByRole('spinbutton',{name:'等级'+i+'数值',exact:true}).inputValue();
  if(values[1]!=='0.1'||values[2]!=='0.15'||values[3]!=='0.2')throw Error('页面等级数值不符');report.actions.push({action:'reopen-view',values,match:true});
  await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));await page.locator('.app-toolbar-field--token').evaluate(el=>el.style.visibility='hidden');await page.screenshot({path:path.join(here,'安妮R法穿参数页面.png'),fullPage:false});
 }
}catch(e){report.failures.push(String(e));process.exitCode=1;}finally{report.finishedAt=new Date().toISOString();await writeFile(path.join(here,before.ok?'页面试录复查证据.json':'页面试录证据.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify(report));

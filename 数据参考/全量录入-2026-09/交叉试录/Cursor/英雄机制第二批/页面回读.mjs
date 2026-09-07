import {chromium} from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {here} from './录入.mjs';
const report={startedAt:new Date().toISOString(),purpose:'四英雄代表组成的真实页面只读验收',readbacks:[],failures:[],screenshots:[]};
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1450,height:1100}});
async function shot(name){await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));await page.locator('.app-toolbar-field--token').evaluate(el=>el.style.visibility='hidden');await page.screenshot({path:path.join(here,name),fullPage:false});report.screenshots.push(name);}
async function openSkill(key,button){await page.getByLabel('技能关键词',{exact:true}).fill(key);await page.getByRole('button',{name:'查询',exact:true}).click();const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:key,exact:true})});await row.getByRole('button',{name:button,exact:true}).click();const list=page.getByRole('dialog').filter({hasText:button}).first();await list.waitFor();return list;}
async function close(m){await m.getByRole('button',{name:'关闭',exact:true}).click();await m.waitFor({state:'hidden'});}
function record(object,actual,match){report.readbacks.push({object,actual,match});if(!match)throw Error('页面值不符 '+object);}
try{
 await page.goto('http://127.0.0.1:5173/#/skills',{waitUntil:'domcontentloaded'});await page.locator('.app-toolbar-field--api input').fill('http://127.0.0.1:8080');await page.locator('.app-toolbar-field--token input').fill('local-entry');await page.getByRole('button',{name:'应用',exact:true}).click();await page.locator('.sidebar-status-line').filter({hasText:/^GameId lol$/}).waitFor();
 for(const [skill,param,a,b,ea,eb]of [['malphite_p','recharge_delay_ms',6,13,'8000','6000'],['brand_p','explosion_base_max_hp_ratio',1,18,'0.06','0.12']]){
  const list=await openSkill(skill,'参数与公式');await list.getByRole('row').filter({hasText:param}).getByRole('button',{name:'查看',exact:true}).click();const view=page.getByRole('dialog',{name:'查看参数',exact:true});await view.waitFor();const va=await view.getByRole('spinbutton',{name:'等级'+a+'数值',exact:true}).inputValue(),vb=await view.getByRole('spinbutton',{name:'等级'+b+'数值',exact:true}).inputValue();record(skill+'/'+param,{[a]:va,[b]:vb},va===ea&&vb===eb);await shot(skill+'-参数页面.png');await close(view);await close(list);
 }
 {
  const list=await openSkill('annie_e','效果与结果');await list.getByRole('row').filter({hasText:'molten_shield'}).getByRole('button',{name:'查看',exact:true}).click();const view=page.getByRole('dialog',{name:'查看效果',exact:true});await view.waitFor();const scope=(await view.getByLabel('实例范围',{exact:true}).innerText()).trim();const resultRow=view.getByRole('row').filter({hasText:'shield'}).first();const text=await resultRow.innerText();record('annie_e/molten_shield',{scope,result:text},scope.includes('按来源对象')&&text.includes('施法者'));await resultRow.scrollIntoViewIfNeeded();await shot('安妮E自护盾页面.png');await close(view);await close(list);
 }
 {
  const list=await openSkill('missfortune_r','效果与结果');await list.getByRole('row').filter({hasText:'bullet_wave'}).getByRole('button',{name:'查看',exact:true}).click();const view=page.getByRole('dialog',{name:'查看效果',exact:true});await view.waitFor();const row=view.getByRole('row').filter({hasText:'damage'}).first();const summary=await row.innerText();await row.getByRole('button',{name:'查看',exact:true}).click();const result=page.getByRole('dialog',{name:'查看结果',exact:true});await result.waitFor();const checked=await result.getByLabel('暴击方式',{exact:true}).locator('input:checked').inputValue();const content=await result.innerText();record('missfortune_r/bullet_wave',{summary,criticalMode:checked,formulaShown:content.includes('wave_crit_multiplier')},checked==='SOURCE_CRIT_CHANCE'&&content.includes('wave_crit_multiplier'));await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));await result.getByLabel('暴击方式',{exact:true}).evaluate(el=>el.scrollIntoView({block:'center'}));await shot('厄运小姐R每波暴击页面.png');await close(result);await close(view);await close(list);
 }
}catch(e){report.failures.push(String(e));process.exitCode=1;}finally{report.finishedAt=new Date().toISOString();await writeFile(path.join(here,'页面回读证据.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify(report));

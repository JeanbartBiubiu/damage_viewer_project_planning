import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir=path.dirname(fileURLToPath(import.meta.url));
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const old=read('修正前证据/录入候选.json').objects;
const current=read('录入候选.json').objects;
const apply=process.argv.includes('--apply');
assert.ok(process.argv.slice(2).every(x=>x==='--apply'));
const base='http://127.0.0.1:8080/api/admin/games/lol';
const report={startedAt:new Date().toISOString(),mode:apply?'有界纠错':'只读检查',preflight:[],changes:[],deferredBrowser:['item_6657_passive/processes/timeless_growth_process','item_6657_passive/trigger-rules/initialize_timeless_growth']};
const save=()=>fs.writeFileSync(path.join(dir,apply?'纠错执行记录.json':'纠错只读检查.json'),JSON.stringify(report,null,2)+'\n');
const project=(actual,expected)=>expected&&typeof expected==='object'?Array.isArray(expected)?Array.isArray(actual)?actual.map((v,i)=>project(v,expected[i])):actual:Object.fromEntries(Object.keys(expected).map(k=>[k,project(actual?.[k],expected[k])])):actual;
const equals=(actual,expected)=>{try{assert.deepEqual(project(actual,expected),expected);return true;}catch{return false;}};
async function request(route,method='GET',body){const r=await fetch(base+route,{method,headers:{Authorization:'Bearer local-entry','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const t=await r.text();let data=null;if(t){try{data=JSON.parse(t);}catch{data=t;}}return {status:r.status,data};}
const tasks=[];
const rod=current.find(o=>o.equipmentKey==='item_6657');
tasks.push({route:'/skills/item_6657_passive/trigger-rules/initialize_timeless_growth',previous:old.find(o=>o.equipmentKey==='item_6657').triggerRules[0],target:null,finalAllowed:rod.triggerRules[0]});
for(const o of current){const previous=old.find(x=>x.equipmentKey===o.equipmentKey);assert.ok(previous);const prefix='/skills/'+o.skill.skillKey;
  tasks.push({route:prefix,previous:previous.skill,target:o.skill,key:'skillKey',collection:'/skills'});
  for(const [type,key] of [['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey'],['triggerRules','ruleKey']]){
    const apiType=type==='triggerRules'?'trigger-rules':type;
    for(const stableKey of new Set([...previous[type].map(x=>x[key]),...o[type].map(x=>x[key])])){
      if(o.equipmentKey==='item_6657'&&type==='triggerRules')continue;
      tasks.push({route:prefix+'/'+apiType+'/'+stableKey,collection:prefix+'/'+apiType,key,previous:previous[type].find(x=>x[key]===stableKey)??null,target:o[type].find(x=>x[key]===stableKey)??null});
    }
  }
}
try{
  for(const task of tasks){const got=await request(task.route);const sameFinal=got.status===200&&task.finalAllowed&&equals(got.data,task.finalAllowed);const sameTarget=task.target===null?got.status===404:got.status===200&&equals(got.data,task.target);const sameOld=task.previous===null?got.status===404:got.status===200&&equals(got.data,task.previous);assert.ok(sameFinal||sameTarget||sameOld,task.route+'出现范围外不同值，未开始本轮写入');task.before=got;task.state=sameFinal?'已由页面恢复目标规则':sameTarget?'已为目标值':'待纠错';report.preflight.push({route:task.route,state:task.state,before:got});}
  report.preflightPassed=true;save();
  for(const task of tasks){if(task.state!=='待纠错')continue;if(!apply)continue;const fresh=await request(task.route);assert.deepEqual(fresh,task.before,task.route+'写前值已变化');const method=task.target===null?'DELETE':task.previous===null?'POST':'PUT';let body=task.target?structuredClone(task.target):undefined;if(method==='PUT')delete body[task.key];const written=await request(method==='POST'?task.collection:task.route,method,body);assert.ok(written.status>=200&&written.status<300,task.route+'写入HTTP '+written.status);const got=await request(task.route);if(task.target===null)assert.equal(got.status,404);else{assert.equal(got.status,200);assert.ok(equals(got.data,task.target),task.route+'写后不同');}report.changes.push({route:task.route,method,before:task.before,writeStatus:written.status,readback:got});save();}
  report.pendingPrerequisites=apply?0:tasks.filter(t=>t.state==='待纠错').length;
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({preflightPassed:true,changes:report.changes.length,pendingPrerequisites:report.pendingPrerequisites,deferredBrowser:report.deferredBrowser}));
}catch(error){report.error={name:error.name,message:error.message};save();throw error;}

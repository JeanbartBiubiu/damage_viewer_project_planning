import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {objects,skippedObjects,compareFields,request} from './录入装备技能.mjs';
const oldBytes=await readFile(new URL('./修正前证据/录入候选.json',import.meta.url));
const original=JSON.parse(oldBytes).objects;
const keys=['item_3072_passive','item_3508_passive','item_6676_passive'];
const kinds=[['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey'],['processes','processKey'],['internal-states','stateKey'],['trigger-rules','ruleKey']];
const property=k=>k==='trigger-rules'?'triggerRules':k==='internal-states'?'internalStates':k;
const getOld=key=>original.find(o=>o.skill.skillKey===key),getNew=key=>objects.find(o=>o.skill.skillKey===key);
const match=(e,a)=>!compareFields(e,a).some(x=>!x.equal);
const ok=r=>r.status>=200&&r.status<300;
const detail=(key,kind,id)=>'/skills/'+key+(kind?'/'+kind+'/'+id:'');
const report={startedAt:new Date().toISOString(),mode:process.argv.includes('--apply')?'显式有界纠错':'只读预检',originalCandidateSha256:createHash('sha256').update(oldBytes).digest('hex'),preflight:[],actions:[],conflicts:[],failures:[]};
async function current(route){const r=await request('GET',route);if(!ok(r)&&r.status!==404)throw Error('读取失败 '+route+' HTTP '+r.status);return r;}
function classify(old,target,r){if(r.status===404)return !old||!target?'allowed-absence':null;if(target&&match(target,r.data))return 'target';if(old&&match(old,r.data))return 'original';return null;}
// 先检查三个技能的全部组成，不只检查将修改的字段。未知新增/变更也停止。
for(const key of keys){const old=getOld(key),target=getNew(key);const s=await current(detail(key));const state=classify(old.skill,target.skill,s);report.preflight.push({route:detail(key),state,actual:s});if(!state)report.conflicts.push({route:detail(key),reason:'技能现值不等于原始或精确目标'});
 for(const[kind,idKey]of kinds){const list=await current('/skills/'+key+'/'+kind);if(!ok(list)||!Array.isArray(list.data))throw Error('列表读取失败 '+key+'/'+kind);const before=old[property(kind)]??[],after=target[property(kind)]??[];const union=new Set([...before.map(x=>x[idKey]),...after.map(x=>x[idKey]),...list.data.map(x=>x[idKey])]);for(const id of union){const a=before.find(x=>x[idKey]===id),b=after.find(x=>x[idKey]===id),route=detail(key,kind,id),r=await current(route);const state=classify(a,b,r);report.preflight.push({route,state,actual:r});if(!state)report.conflicts.push({route,reason:'组成现值不等于原始或精确目标'});}}
}
await writeFile(new URL('./录入候选.json',import.meta.url),JSON.stringify({generatedAt:new Date().toISOString(),objects,skipped:skippedObjects},null,2)+'\n');
await writeFile(new URL(process.argv.includes('--apply')?'./纠错写前检查.json':'./纠错只读检查.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
if(report.conflicts.length)throw Error('预检出现不同现值，禁止全部写入');
const defs=[
 ['item_6676_passive','formulas','formulaKey','execute_threshold_health','CREATE'],
 ['item_6676_passive','effects','effectKey','execute_below_threshold','UPDATE'],
 ['item_3072_passive','effects','effectKey','lifesteal_overshield','DELETE'],
 ['item_3072_passive','parameters','parameterKey','overshield_duration_ms','DELETE'],
 ['item_3072_passive','parameters','parameterKey','overshield_by_character_level','UPDATE'],
 ['item_3072_passive',null,'skillKey',null,'UPDATE'],
 ['item_3508_passive','parameters','parameterKey','spellblade_ready_window_ms','DELETE']
];
for(const[key,kind,idKey,id,action]of defs){const o=getOld(key),n=getNew(key),old=kind?(o[property(kind)]??[]).find(x=>x[idKey]===id):o.skill,target=kind?(n[property(kind)]??[]).find(x=>x[idKey]===id):n.skill,route=detail(key,kind,id);const r=await current(route);const state=classify(old,target,r);if(!state)throw Error('写前现值变化，停止 '+route);const record={route,action,state,applied:false};
 if((action==='DELETE'&&r.status===404)||(action!=='DELETE'&&state==='target')){record.action='same-target-skip';report.actions.push(record);continue;}
 if(!process.argv.includes('--apply')){report.actions.push(record);continue;}
 try{
  let response;
  if(action==='CREATE')response=await request('POST','/skills/'+key+'/'+kind,target);
  else if(action==='DELETE')response=await request('DELETE',route);
  else{const body=Object.fromEntries(Object.entries(target).filter(([k])=>k!==idKey));response=await request('PUT',route,body);}
  record.writeStatus=response.status;if(!ok(response))throw Error('写入被拒绝，未扩大删除或覆盖 '+JSON.stringify(response));
  const read=await current(route);record.readback=read;record.applied=true;
  if(action==='DELETE'){const list=await current('/skills/'+key+'/'+kind);record.listAfter=list;record.match=read.status===404&&ok(list)&&Array.isArray(list.data)&&!list.data.some(x=>x[idKey]===id);}
  else record.match=ok(read)&&match(target,read.data);
  report.actions.push(record);await appendFile(new URL('./纠错流水.jsonl',import.meta.url),JSON.stringify({at:new Date().toISOString(),...record})+'\n');
  if(!record.match)throw Error('写后独立GET不同 '+route);
 }catch(e){report.failures.push({route,message:String(e)});break;}
}
report.finishedAt=new Date().toISOString();await writeFile(new URL(process.argv.includes('--apply')?'./纠错结果.json':'./纠错只读检查.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({mode:report.mode,preflight:report.preflight.length,actions:report.actions.map(({route,action,applied,match})=>({route,action,applied,match})),conflicts:report.conflicts,failures:report.failures}));if(report.failures.length)process.exitCode=1;

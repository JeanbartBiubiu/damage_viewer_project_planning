import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),read=f=>JSON.parse(fs.readFileSync(f)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const planFile=path.join(here,'写前方案.json'),planBytes=fs.readFileSync(planFile),plan=JSON.parse(planBytes);
assert.equal(sha(planBytes),'e67f35dcb651387c13124c7c4f34bffd823fd91cab1330297da85a994700c43b');
const heroDir=path.resolve(here,'../Cursor/英雄机制第八批'),gearDir='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/装备技能实录/第十五批伤害装备';
const heroBytes=fs.readFileSync(path.join(heroDir,'最终请求.json')),gearBytes=fs.readFileSync(path.join(gearDir,'完整候选.json'));assert.equal(sha(heroBytes),'56dbefdb84857b820fe5278f6d82e226967c5f7edee828e37c8b937003b1af4b');assert.equal(sha(gearBytes),'8eef5d285f2ee624db477c9519e7aa94c4cb7c61f1a24ff227daa084931947be');
const hero=JSON.parse(heroBytes),gear=JSON.parse(gearBytes),heroSource=read(path.join(heroDir,'根绑定与数值证据.json')),gearSource=read(path.join(gearDir,'冻结来源.json'));
const heroReceipt=read(path.join(heroDir,'执行记录/2026-09-09T02-03-09-891Z/执行结果.json')),gearReceipt=read(path.join(gearDir,'写入执行记录-2026-09-09T02-27-44-283Z.json'));
const findings=[],changes=[],sourceChecks=[],deletions=[],math=[],getRecords=[];
function walk(x,fn,p=''){if(x&&typeof x==='object'){fn(x,p);for(const[k,v]of Object.entries(x))walk(v,fn,p+'/'+k);}}
const selected=(value,keys)=>Object.fromEntries(keys.map(k=>[k,value[k]??null]));
const oldSkill=s=>hero.skills[s]?.write||gear.objects.find(x=>x.skillKey===s).apiPayload;
const oldObject=(s,kind,key)=>kind==='skill'?oldSkill(s).skill:oldSkill(s)[kind].find(x=>x[{parameters:'parameterKey',formulas:'formulaKey'}[kind]]===key);
let encounteredDelete=false;
for(const op of plan.operations){
 assert.ok(plan.scope.includes(op.skillKey));assert.equal(op.route,op.kind==='skill'?'/skills/'+op.skillKey:`/skills/${op.skillKey}/${op.kind}/${op.key}`);
 const original=oldObject(op.skillKey,op.kind,op.key);assert.deepEqual(op.before,selected(original,Object.keys(op.before)));
 if(op.method==='DELETE'){
  encounteredDelete=true;assert.equal(op.kind,'parameters');assert.equal(original.valueMode,'RUNTIME_INPUT');assert.equal(original.fixedValue,null);assert.ok(plan.mapping[op.skillKey][op.key]);
  let receipt;
  if(hero.skills[op.skillKey])receipt=heroReceipt.events.find(e=>e.skillKey===op.skillKey&&e.id===op.key&&e.postStatus===201&&e.readbackStatus===200&&e.match===true);
  else receipt=gearReceipt.events.find(e=>e.route===op.route&&e.write?.status===201&&e.after?.status===200&&e.match===true);
  // 装备记录使用不同的等值标志；用201及独立GET正文再逐字段比对。
  if(!receipt&&!hero.skills[op.skillKey])receipt=gearReceipt.events.find(e=>e.route===op.route&&e.write?.status===201&&e.after?.status===200);
  assert.ok(receipt,op.route+' 原批新建证据');const actual=receipt.actual||receipt.after?.data;assert.deepEqual(selected(actual,Object.keys(original)),original);
  deletions.push({skillKey:op.skillKey,key:op.key,createdByOriginalBatch:true,postStatus:201,independentGetStatus:200,receiptAt:receipt.at});continue;
 }
 assert.equal(encounteredDelete,false,'所有修改必须在删除之前');assert.equal(op.method,'PUT');
 if(op.kind==='parameters')assert.deepEqual(selected(op.after,Object.keys(op.before).filter(k=>!['name','description'].includes(k))),selected(op.before,Object.keys(op.before).filter(k=>!['name','description'].includes(k))));
 else if(op.kind==='skill')assert.deepEqual(selected(op.after,Object.keys(op.before).filter(k=>k!=='description')),selected(op.before,Object.keys(op.before).filter(k=>k!=='description')));
 else {
  assert.equal(op.kind,'formulas');assert.deepEqual(selected(op.after,Object.keys(op.before).filter(k=>!['description','expression'].includes(k))),selected(op.before,Object.keys(op.before).filter(k=>!['description','expression'].includes(k))));
  function compare(a,b,p=''){
   if(a?.nodeType==='PARAMETER'&&plan.mapping[op.skillKey][a.parameterKey]){assert.deepEqual(b,plan.mapping[op.skillKey][a.parameterKey]);changes.push({skillKey:op.skillKey,formulaKey:op.key,path:p,parameterKey:a.parameterKey,replacement:b});return;}
   if(a&&typeof a==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const k of Object.keys(a))compare(a[k],b[k],p+'/'+k);}else assert.equal(a,b);
  }compare(op.before.expression,op.after.expression);
 }
}
assert.equal(deletions.length,10);assert.equal(plan.operations.filter(o=>o.kind==='formulas').length,14);assert.equal(plan.operations.filter(o=>o.method==='PUT').length,30);
for(const ev of plan.sourceEvidence){
 const src=hero.skills[ev.skillKey]?heroSource.heroes.flatMap(h=>h.spells).find(s=>s.skillKey===ev.skillKey).object.mSpell.mSpellCalculations:gearSource.objects.find(i=>i.equipmentKey===gear.objects.find(o=>o.skillKey===ev.skillKey).equipmentKey).object.mItemCalculations;
 for(const item of ev.originalNodes){let actual=src;for(const k of item.path.split('/').filter(Boolean))actual=actual[k];assert.deepEqual(actual,item.node);assert.ok(['StatByCoefficientCalculationPart','StatByNamedDataValueCalculationPart','StatBySubPartCalculationPart'].includes(actual.__type));assert.equal(actual.UseNewStats??false,false);assert.equal(actual.OutputType??0,0);assert.equal(actual.mStatFormula??0,0);assert.ok([0,2].includes(actual.mStat??0));assert.equal(item.attribute,(actual.mStat??0)===0?'ability_power':'attack_damage');sourceChecks.push({skillKey:ev.skillKey,path:item.path,nodeType:actual.__type,rawStat:actual.mStat??null,rawFormula:actual.mStatFormula??null,mapped:item.attribute,passed:true});}
 for(const attr of Object.values(plan.mapping[ev.skillKey]))assert.ok(ev.originalNodes.some(n=>n.attribute===attr.attributeKey));
}
const scenarios=[{ad:200,bonus:70,ap:300,crit:.2,critBonus:.4,levelRatio:.6,spears:2,rank:1},{ad:80,bonus:20,ap:0,crit:0,critBonus:0,levelRatio:1,spears:0,rank:1},{ad:350,bonus:190,ap:900,crit:1,critBonus:.6,levelRatio:1,spears:4,rank:'max'}];
function evaluate(expression,skillKey,s,{before=false,wrong=null}={}){
 const parameters=oldSkill(skillKey).parameters,rank=s.rank==='max'?(plan.reads.find(r=>r.route==='/skills/'+skillKey).actual.maxLevel):s.rank;
 const attrs={attack_damage:s.ad,ability_power:s.ap,critical_strike_chance:s.crit,critical_strike_damage_bonus_percent:s.critBonus};
 function n(x){
  if(x.nodeType==='PARAMETER'){
   if(plan.mapping[skillKey][x.parameterKey]){assert.ok(before);return attrs[plan.mapping[skillKey][x.parameterKey].attributeKey];}
   const p=parameters.find(p=>p.parameterKey===x.parameterKey);assert.ok(p);if(p.valueMode==='FIXED')return p.fixedValue;if(p.valueMode==='SKILL_LEVEL')return p.levelValues[rank];if(p.parameterKey==='level_bonus_ratio')return s.levelRatio;if(p.parameterKey==='additional_spear_count')return s.spears;throw Error('未提供独立输入 '+x.parameterKey);
  }
  if(x.nodeType==='ATTRIBUTE'){assert.equal(x.attributeOwner,'SOURCE');assert.equal(x.attributeValueKind,'TOTAL');if(wrong===x.attributeKey)return x.attributeKey==='attack_damage'?s.bonus:s.ad;assert.ok(Object.hasOwn(attrs,x.attributeKey));return attrs[x.attributeKey];}
  const[a,b]=x.operands.map(n);switch(x.operation){case'ADD':return a+b;case'MULTIPLY':return a*b;case'SUBTRACT':return a-b;case'DIVIDE':return a/b;case'MIN':return Math.min(a,b);case'MAX':return Math.max(a,b);default:throw Error(x.operation);}
 }return n(expression);
}
for(const op of plan.operations.filter(o=>o.kind==='formulas')){
 for(const s of scenarios){const before=evaluate(op.before.expression,op.skillKey,s,{before:true}),after=evaluate(op.after.expression,op.skillKey,s);assert.ok(Number.isFinite(after));assert.ok(Math.abs(before-after)<1e-9);math.push({skillKey:op.skillKey,formulaKey:op.key,inputs:s,before,after,equivalent:true});}
 const types=new Set(changes.filter(c=>c.skillKey===op.skillKey&&c.formulaKey===op.key).map(c=>c.replacement.attributeKey));
 for(const type of types){const right=evaluate(op.after.expression,op.skillKey,scenarios[0]),wrong=evaluate(op.after.expression,op.skillKey,scenarios[0],{wrong:type});assert.notEqual(right,wrong);math.push({skillKey:op.skillKey,formulaKey:op.key,wrongMapping:type==='attack_damage'?'误用额外AD':'误把AP读作AD',right,wrong,distinguishes:true});}
}
// 本脚本只有GET。重读主方案中每个具体查询，含九主体、六类列表/详情和代表图。
const token=process.env.ATTRIBUTE_REVIEW_TOKEN;if(!token)throw Error('缺少本地只读认证环境变量');
for(let start=0;start<plan.reads.length;start+=4){
 const batch=await Promise.all(plan.reads.slice(start,start+4).map(async old=>{const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+old.route,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,old.route);const actual=await response.json();assert.deepEqual(actual,old.actual,old.route+' 独立当前值');return{route:old.route,status:response.status,actual,equalToWritePlan:true};}));getRecords.push(...batch);
}
const kinds=['parameters','formulas','effects','processes','internal-states','trigger-rules'];
for(const d of deletions){
 const refs=[],remaining=[];
 for(const kind of kinds){const route=`/skills/${d.skillKey}/${kind}`,rows=getRecords.find(r=>r.route===route).actual;
  for(const row of rows){if(kind==='parameters'&&row.parameterKey===d.key)continue;let value=row;
   const id=row[{parameters:'parameterKey',formulas:'formulaKey',effects:'effectKey',processes:'processKey','internal-states':'stateKey','trigger-rules':'ruleKey'}[kind]];const detail=getRecords.find(r=>r.route===route+'/'+id);assert.ok(detail);value=detail.actual;
   walk(value,(n,p)=>{if(n.parameterKey===d.key)refs.push({kind,id,path:p});});
   const replaced=plan.operations.find(o=>o.method==='PUT'&&o.route===route+'/'+id)?.after||value;
   walk(replaced,(n,p)=>{if(n.parameterKey===d.key)remaining.push({kind,id,path:p});});
  }
 }
 assert.ok(refs.length);assert.ok(refs.every(r=>r.kind==='formulas'&&plan.operations.some(o=>o.skillKey===d.skillKey&&o.key===r.id&&o.kind==='formulas'&&o.method==='PUT')));assert.equal(remaining.length,0);d.currentReferences=refs;d.projectedRemainingReferences=remaining;d.deleteGate='写后必须重新GET六类列表及全部详情，发现任何新引用均不得删除；本次只是写前投影';
}
assert.ok(!plan.operations.some(o=>o.skillKey==='caitlyn_r'));const preserved=plan.scope.map(s=>({skillKey:s,unchangedCollections:['effects','processes','internal-states','trigger-rules'],imageUnchanged:true}));
const report={at:new Date().toISOString(),decision:'READY',planSha256:sha(planBytes),reviewedBoundary:'只批准本SHA的属性语义回补方案；执行工具尚未审查，删除必须用写后的实时六类详情作为闸门。',counts:{skills:9,puts:30,deletes:10,formulaChanges:14,nodeReplacements:changes.length,sourceNodes:sourceChecks.length,mathCases:math.length,independentGets:getRecords.length},sourceChecks,changes,deletions,math,preserved,findings,executionRequirements:['技能主体PUT只发送after中除skillKey外字段；比较before/after及GET仍保留原稳定键。','所有30项PUT均写后GET相等；未知响应先GET，不直接重放。','所有引用修改完成后，再独立GET各技能六类列表和每项详情，任何待删参数引用不为0就禁止删除。','10条DELETE仅精确父技能路径及原批新增临时参数，且删除前当前正文仍等于原值；任意现值不同停止该对象。','不得修改等级曲线、其他未知输入、固定数值、伤害结果、触发、图片或挂载。'],contractEvidence:['技能参数与公式管理详细设计.md:326 参数仅同技能引用','条件事件与动态输入供值管理详细设计.md:37 动作只给同技能运行参数供值'],businessWrites:0};
fs.writeFileSync(path.join(here,'独立审查回读.json'),JSON.stringify({at:report.at,method:'GET_ONLY',records:getRecords},null,2)+'\n');fs.writeFileSync(path.join(here,'独立审查.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({decision:report.decision,counts:report.counts,writes:0}));

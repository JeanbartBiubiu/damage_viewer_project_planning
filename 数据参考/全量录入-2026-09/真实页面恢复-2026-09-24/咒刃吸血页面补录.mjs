import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// 只GET与本地记录。保留已完成前四笔，把未执行说明与资格合并，避免重复保存。
const here=path.dirname(fileURLToPath(import.meta.url));
const [mode,id,countText]=process.argv.slice(2);
assert(['prepare','readback'].includes(mode));assert(['3508','3057'].includes(id));
const label=id==='3508'?'夺萃':'耀光',baseCount=4,completed=Number(countText??0);
const read=name=>JSON.parse(fs.readFileSync(path.join(here,name),'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(here,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const baseSnapshot=read(`${label}-回读-${baseCount}.json`);
assert.equal(baseSnapshot.status,'PASS');
const before=mode==='prepare'?baseSnapshot:read(`${label}-合并-01-写前现值.json`);
const values={},audit=[],token=crypto.randomUUID(),base='http://127.0.0.1:8080/api/admin/games/lol';
for(const route of Object.keys(before.values)){
  const response=await fetch(base+route,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
  audit.push({method:'GET',route,status:response.status});
  assert(response.status===200 || response.status===404 && before.values[route]?.http===404,route);
  values[route]=response.status===404?{http:404}:await response.json();
}
const prefix='/skills/item_'+id+'_passive',effectRoute=prefix+'/effects/spellblade_damage';
function bodyFor(route,key){
  const {gameId,skillKey,createdAt,updatedAt,...body}=structuredClone(values[route]);
  if(key!=='skillKey')delete body[key];
  if(key==='processKey')for(const row of [...body.effectBindings,...body.stateOperations])row.moment.failureReason??=null;
  return body;
}
function cleanGet(value,key,method){
  const {gameId,skillKey,createdAt,updatedAt,...body}=structuredClone(value);
  if(method==='PUT'&&key!=='skillKey')delete body[key];
  return body;
}
if(mode==='prepare'){
  assert.deepEqual(values,baseSnapshot.values,'第四笔回读后数据变化，先重新审核');
  const main=read(`${label}-02-页面批准.json`);
  const decision=read('22-咒刃吸血资格核定.json');
  const effect=bodyFor(effectRoute,'effectKey');
  const damage=effect.results.filter(x=>x.resultType==='DAMAGE');assert.equal(damage.length,1);
  assert.equal(damage[0].detail.vampQualification,'UNRESOLVED');assert.deepEqual(damage[0].detail.vampOverrides,[]);
  damage[0].detail.vampQualification='RESOLVED';damage[0].detail.vampOverrides=[structuredClone(decision.projectDecision.necessaryOverride)];
  effect.description='咒刃附加物理伤害，由单强化步骤在实际普攻命中时结算。吸血按项目核定：生命偷取使用本结果的必要覆盖，全能吸血继承游戏规则。';
  const requests=structuredClone(id==='3508'?[main.requests[4]]:[main.requests[4],main.requests[5]]);
  requests.push({method:'PUT',route:effectRoute,detailRoute:effectRoute,key:'effectKey',body:effect,purpose:'核定资格，仅增加必要生命偷取覆盖，原伤害及数值保持'});
  const skill=structuredClone(main.requests.find(x=>x.route===prefix).body);
  if(id==='3508'){
    assert(skill.description.includes('额外伤害的吸血资格尚未核定。'));
    skill.description=skill.description.replace('额外伤害的吸血资格尚未核定。','额外伤害已按项目口径核定吸血：生命偷取使用必要覆盖，全能吸血继承游戏规则。');
  }else{
    assert(skill.description.includes('正式伤害吸血资格仍未核定，尚不代表完整装备运行。'));
    skill.description=skill.description.replace('正式伤害吸血资格仍未核定，尚不代表完整装备运行。','附伤已按项目口径核定吸血：生命偷取使用必要覆盖，全能吸血继承游戏规则；尚不代表完整装备运行。');
  }
  requests.push({method:'PUT',route:prefix,detailRoute:prefix,key:'skillKey',body:skill,purpose:'仅移除过时未核定说明，保留有限模拟边界'});
  if(id==='3057'){
    const route=prefix+'/processes/spellblade_consume',body=bodyFor(route,'processKey');
    assert(body.description.includes('特殊使用和吸血资格仍待核。'));
    body.description=body.description.replace('特殊使用和吸血资格仍待核。','特殊使用仍待核。');
    requests.push({method:'PUT',route,detailRoute:route,key:'processKey',body,purpose:'只纠正过程顶层过时说明；步骤、绑定、操作和时序保持'});
    const equipmentRoute='/equipment/item_3057',equipment=structuredClone(main.requests.find(x=>x.route===equipmentRoute).body);
    assert(equipment.description.includes('特殊使用和正式伤害吸血资格仍未验证，未声明完整装备运行。'));
    equipment.description=equipment.description.replace('特殊使用和正式伤害吸血资格仍未验证，未声明完整装备运行。','特殊使用仍未验证，未声明完整装备运行。');
    requests.push({method:'PUT',route:equipmentRoute,detailRoute:equipmentRoute,key:'equipmentKey',body:equipment,purpose:'仅移除装备入口过时吸血待核说明'});
  }
  for(const request of requests){
    if(request.method==='POST'){assert.deepEqual(values[request.detailRoute],{http:404});continue;}
    const old=bodyFor(request.route,request.key),next=structuredClone(request.body);
    delete old.description;delete next.description;
    if(request.key==='effectKey'){
      const d=next.results.find(x=>x.resultType==='DAMAGE');d.detail.vampQualification='UNRESOLVED';d.detail.vampOverrides=[];
    }
    assert.deepEqual(next,old,'批准含范围外变更：'+request.route);
  }
  write(`${label}-合并-01-写前现值.json`,{at:new Date().toISOString(),audit,values,businessWrites:0});
  write(`${label}-合并-02-页面批准.json`,{
    at:new Date().toISOString(),executionMode:'PLAYWRIGHT_UI_ONLY',model:id==='3508'?'gpt-6-sol':'gpt-6-luna',effort:'max',
    baseBatch:`${label}-回读-${baseCount}.json`,baselineSha256:hash(fs.readFileSync(path.join(here,`${label}-合并-01-写前现值.json`))),
    replaces:'原页面批准第5笔起尚未执行的请求，以本合并批准替代；前4笔已保存，不重做',
    originalPlanSha256:hash(fs.readFileSync(path.join(here,`${label}-02-页面批准.json`))),
    decision:'22-咒刃吸血资格核定.json',decisionSha256:hash(fs.readFileSync(path.join(here,'22-咒刃吸血资格核定.json'))),
    question:'单启动入口与必要生命偷取覆盖能否准确保存，保留全能默认及真实被动分类，并减少过时说明的重复保存',requests,
    protected:'原公式、参数数值、伤害数值、分类、游戏吸血规则、装备属性/引用/图片保持；仅新增本批准列出的单启动规则；既有对象除说明更正外，仅伤害结果的资格与一项生命偷取覆盖允许改变',
    runtimeValidated:false,wholeEquipmentComplete:false
  });
  console.log(JSON.stringify({status:'APPROVED_UI_ONLY',object:label,GETs:audit.length,plannedPageWrites:requests.length,businessWrites:0}));
}else{
  const plan=read(`${label}-合并-02-页面批准.json`);
  assert(Number.isInteger(completed)&&completed>=1&&completed<=plan.requests.length);
  assert.equal(hash(fs.readFileSync(path.join(here,`${label}-合并-01-写前现值.json`))),plan.baselineSha256);
  const applied=plan.requests.slice(0,completed),changed=new Set(applied.map(x=>x.detailRoute));
  for(const request of applied){
    const expected=structuredClone(request.body);
    if(request.key==='processKey')for(const row of [...expected.effectBindings,...expected.stateOperations]){assert.equal(row.moment.failureReason,null);delete row.moment.failureReason;}
    assert.deepEqual(cleanGet(values[request.detailRoute],request.key,request.method),expected,'保存正文不符：'+request.detailRoute);
    if(request.method==='PUT')for(const field of ['gameId','skillKey','equipmentKey','effectKey','processKey','createdAt'])assert.equal(values[request.detailRoute][field],before.values[request.detailRoute][field]);
  }
  let protectedResponses=0;
  for(const[route,original]of Object.entries(before.values)){
    if(changed.has(route))continue;
    const updates=applied.filter(x=>x.method==='PUT'&&x.route.startsWith(route+'/')&&['effectKey','processKey','parameterKey'].includes(x.key));
    const additions=applied.filter(x=>x.method==='POST'&&x.route===route);
    if((updates.length||additions.length)&&Array.isArray(original)){
      const expected=structuredClone(original);assert.equal(values[route].length,original.length+additions.length);
      for(const update of updates){const row=expected.find(x=>x[update.key]===update.route.split('/').at(-1));assert(row);row.description=update.body.description;row.updatedAt=values[update.route].updatedAt;}
      assert.deepEqual(values[route].filter(row=>!additions.some(x=>row[x.key]===x.body[x.key])),expected,'旧列表受保护字段改变：'+route);
    }else{assert.deepEqual(values[route],original,'保护内容改变：'+route);protectedResponses++;}
  }
  write(`${label}-合并-回读-${completed}.json`,{status:'PASS',at:new Date().toISOString(),completedPageWrites:4+completed,completedMergedWrites:completed,audit,values,protectedResponses,businessWrites:0,runtimeValidated:false});
  console.log(JSON.stringify({status:'PASS',object:label,completed,GETs:audit.length,protectedResponses,businessWrites:0}));
}

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 原有无条件命中入口的页面收窄保护；只读，不提供接口写入模式。
const executor=fileURLToPath(import.meta.url),web=path.resolve(path.dirname(executor),'../..');
const tool='tools/authoring/reviewed-hit-scope-ui.mjs',mode=process.argv[2],here=path.resolve(process.argv[3]||'');
assert(['prepare','preflight','readback'].includes(mode));assert(here.startsWith(path.join(web,'数据参考')+path.sep));
const read=n=>JSON.parse(fs.readFileSync(path.join(here,n),'utf8')),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=n=>sha(n===tool?executor:path.join(here,n)),save=(n,v)=>fs.writeFileSync(path.join(here,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const base='http://127.0.0.1:8080/api/admin/games/lol',plan=read('01-候选方案.json'),id=v=>typeof v==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(v);
assert.equal(plan.executionMode,'BROWSER_UI_ONLY');assert(id(plan.skillKey)&&id(plan.ruleKey));
const root='/skills/'+plan.skillKey,listRoute=root+'/trigger-rules',detailRoute=listRoute+'/'+plan.ruleKey;
const groups=[{groupKey:'champion_target',name:'本轮敌方英雄',sortOrder:10,conditions:[{conditionKey:'champion_target',conditionType:'TARGET_CATEGORY_CHECK',sortOrder:10,detail:{categories:['CHAMPION']}},{conditionKey:'enemy_target',conditionType:'SKILL_HIT_TARGET_IS_ENEMY',sortOrder:20,detail:{}}]}];
assert.deepEqual(plan.conditionGroups,groups);
const kinds={parameters:'parameterKey',formulas:'formulaKey',effects:'effectKey',processes:'processKey','internal-states':'stateKey','trigger-rules':'ruleKey'};
function sources(){assert(Array.isArray(plan.sourceFiles)&&plan.sourceFiles.length);return plan.sourceFiles.map(s=>{const r={web,planning:path.resolve(web,'../damage_viewer_project_planning')}[s.root];assert(r&&typeof s.path==='string');const p=path.resolve(r,s.path);assert(p.startsWith(r+path.sep));const actualSha256=sha(p);assert.equal(actualSha256,s.sha256,'来源漂移：'+s.path);return{...s,actualSha256};});}
function client(){const audit=[],token=crypto.randomUUID();return{audit,async get(route){assert(route===root||route.startsWith(root+'/'));const r=await fetch(base+route,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});audit.push({method:'GET',path:route,status:r.status});assert.equal(r.status,200,route);return r.json();}};}
async function snapshot(api){const values={[root]:await api.get(root)};assert.equal(values[root].status,'ENABLED');for(const[kind,key]of Object.entries(kinds)){const route=root+'/'+kind,rows=await api.get(route);assert(Array.isArray(rows));assert.equal(new Set(rows.map(x=>x[key])).size,rows.length);values[route]=rows;for(const row of rows){assert(id(row[key]));values[route+'/'+row[key]]=await api.get(route+'/'+row[key]);}}
  assert(values[detailRoute]);const summary=values[listRoute].find(x=>x.ruleKey===plan.ruleKey),detail=values[detailRoute];assert(summary);for(const k of ['ruleKey','name','description','sortOrder'])assert.deepEqual(summary[k],detail[k]);assert.equal(summary.eventType,detail.eventSource.eventType);assert.equal(summary.conditionGroupCount,detail.conditionGroups.length);assert.equal(summary.actionCount,detail.actions.length);assert.equal(summary.perTargetCooldownEnabled,detail.perTargetCooldown!==null);assert.equal(summary.maxTriggersPerProcessEnabled,detail.maxTriggersPerProcess!==null);assert(Number.isFinite(Date.parse(summary.updatedAt)));return values;}
function requestFrom(values){const old=values[detailRoute];assert.equal(old.ruleKey,plan.ruleKey);assert.deepEqual(old.conditionGroups,[]);assert.deepEqual(old.eventSource,{eventType:'SKILL_HIT',detail:{sourceSkillKey:plan.skillKey,useKind:null}});
  const expectedReadback={...old,conditionGroups:groups},{ruleKey,...body}=structuredClone(expectedReadback);delete body.eventSource.detail.useKind;return{method:'PUT',route:detailRoute,body,expectedReadback};}
const required=[tool,'01-候选方案.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'];
if(mode==='prepare'){
  for(const n of required.slice(2))assert(!fs.existsSync(path.join(here,n)),'拒绝覆盖'+n);
  const source=sources(),api=client(),values=await snapshot(api),request=requestFrom(values);
  save('03-来源摘要.json',source);save('04-写入前现值.json',{at:new Date().toISOString(),base,values,audit:api.audit,businessWrites:0});
  save('02-冻结请求.json',{base,executionMode:'BROWSER_UI_ONLY',request,sourceSha256:hash('03-来源摘要.json'),baselineSha256:hash('04-写入前现值.json')});console.log(JSON.stringify({status:'READY_FOR_REVIEW',GETs:api.audit.length,plannedBrowserWrites:1,batchFileSha256:hash('02-冻结请求.json')}));
}else{
  const review=read('05-独立评审.json');assert.equal(review.status,'APPROVED');for(const n of required)assert.equal(hash(n),review.approvedFiles[n],'批准文件漂移：'+n);assert.deepEqual(sources(),read('03-来源摘要.json'));
  const frozen=read('02-冻结请求.json'),before=read('04-写入前现值.json');assert.equal(frozen.base,base);assert.equal(frozen.executionMode,'BROWSER_UI_ONLY');assert.equal(frozen.sourceSha256,hash('03-来源摘要.json'));assert.equal(frozen.baselineSha256,hash('04-写入前现值.json'));assert.deepEqual(frozen.request,requestFrom(before.values));
  const api=client(),values=await snapshot(api);
  if(mode==='preflight'){assert.deepEqual(values,before.values,'写前原组成漂移');console.log(JSON.stringify({status:'PASS',businessWrites:0,GETs:api.audit.length}));}
  else{
    const writer=read('06-写入与即时回读.json');assert.equal(writer.status,'PASS');assert.equal(writer.executionMode,'BROWSER_UI_ONLY');assert.equal(writer.businessWritesAttempted,1);assert.deepEqual(writer.approvedFiles,review.approvedFiles);
    assert.deepEqual(values[detailRoute],frozen.request.expectedReadback,'完整规则不符');assert.deepEqual(Object.keys(values).sort(),Object.keys(before.values).sort(),'新增或遗漏组成');
    let unchanged=0;for(const[route,old]of Object.entries(before.values)){
      if(route===detailRoute)continue;
      if(route===listRoute){const actualRow=values[route].find(x=>x.ruleKey===plan.ruleKey),oldRow=old.find(x=>x.ruleKey===plan.ruleKey);assert(actualRow&&oldRow);assert(Date.parse(actualRow.updatedAt)>=Date.parse(oldRow.updatedAt));const expected=old.map(row=>row.ruleKey===plan.ruleKey?{...row,conditionGroupCount:1,updatedAt:actualRow.updatedAt}:row);assert.deepEqual(values[route],expected,'原规则列表其他字段或顺序变化');continue;}
      assert.deepEqual(values[route],old,'原组成含时间戳变化：'+route);unchanged++;
    }
    console.log(JSON.stringify({status:'PASS',at:new Date().toISOString(),businessWrites:0,GETs:api.audit.length,unchangedResponsesIncludingTimestamps:unchanged,expectedChangedCollections:1,changedDetails:{[detailRoute]:values[detailRoute]},audit:api.audit}));
  }
}

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 复用固定摘要、现值保护和防重放；仅补已限制敌方英雄的普通魔法或物理技能伤害的全能吸血资格。
// 首次真实写入后保持本文件字节不变。
const executor=fileURLToPath(import.meta.url),web=path.resolve(path.dirname(executor),'../..');
const executorKey='tools/authoring/update-reviewed-damage-vamp-v2.mjs';
const mode=process.argv[2],here=path.resolve(process.argv[3]||'');
assert(['prepare','preflight','write','readback'].includes(mode));
assert(here.startsWith(path.join(web,'数据参考')+path.sep));
const base='http://127.0.0.1:8080/api/admin/games/lol';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hash=name=>sha(fs.readFileSync(name===executorKey?executor:path.join(here,name)));
const read=name=>JSON.parse(fs.readFileSync(path.join(here,name),'utf8'));
const save=(name,value)=>fs.writeFileSync(path.join(here,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const plan=read('01-纠错计划.json');
const seen=new Set();
assert(Array.isArray(plan.changes)&&plan.changes.length>0);
for(const c of plan.changes){
  const m=/^\/skills\/([a-z0-9_]+)\/effects\/([a-z0-9_]+)$/.exec(c.route);
  assert(m);assert.equal(c.skillKey,m[1]);assert.equal(c.effectKey,m[2]);assert(!seen.has(c.route));seen.add(c.route);
  assert(['magic','physics'].includes(c.damageTypeKey));
  assert(typeof c.scopeRuleKey==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(c.scopeRuleKey));
  assert(typeof c.resultKey==='string'&&/^[a-z0-9_]+$/.test(c.resultKey));
  assert(typeof c.description==='string'&&c.description.trim()&&c.description.length<=2000);
}
const skills=[...new Set(plan.changes.map(x=>x.skillKey))];
const kinds=[['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey'],['processes','processKey'],['internal-states','stateKey'],['trigger-rules','ruleKey']];
const vampRules=[{vampType:'OMNIVAMP',basisOutputKind:'POST_DEFENSE_DAMAGE',efficiencyValue:{kind:'FIXED',value:1}}];
function sources(){
  assert(Array.isArray(plan.sourceFiles)&&plan.sourceFiles.length);
  return plan.sourceFiles.map(s=>{const root=s.root==='web'?web:s.root==='planning'?path.resolve(web,'../damage_viewer_project_planning'):null;assert(root);assert(typeof s.path==='string');const file=path.resolve(root,s.path);assert(file.startsWith(root+path.sep));const actualSha=sha(fs.readFileSync(file));assert.equal(actualSha,s.sha256,'来源变化：'+s.path);return {...s,sha256:actualSha};});
}
function client(){
  const token=crypto.randomUUID(),audit=[];
  async function request(route,method='GET',body,onResponse=null){
    assert(method==='GET'||(mode==='write'&&method==='PUT'&&seen.has(route)));
    const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
    audit.push({method,path:route,status:r.status});
    if(onResponse)onResponse(r.status);
    const data=await r.json();return {status:r.status,data};
  }
  async function get(route){const r=await request(route);assert.equal(r.status,200,route);return r.data;}
  return {request,get,audit};
}
async function snapshot(api){
  const values={};
  for(const skillKey of skills){const root='/skills/'+skillKey;values[root]=await api.get(root);
    for(const[kind,id]of kinds){const route=root+'/'+kind,list=await api.get(route);assert(Array.isArray(list));assert.equal(new Set(list.map(x=>x[id])).size,list.length);values[route]=list;for(const row of list)values[route+'/'+row[id]]=await api.get(route+'/'+row[id]);}
  }
  return values;
}
function makeRequests(values){return plan.changes.map(c=>{
  const old=values[c.route];assert(old);assert.equal(old.gameId,'lol');assert.equal(old.skillKey,c.skillKey);assert.equal(old.effectKey,c.effectKey);assert.equal(old.lifecycle,null);assert.equal(old.results.length,1);
  const result=old.results[0];assert.equal(result.resultKey,c.resultKey);assert.equal(result.resultType,'DAMAGE');assert.equal(result.target,'TARGET');assert.equal(result.detail.damageTypeKey,c.damageTypeKey);assert.equal(result.detail.deliveryKind,'SKILL');assert.equal(result.detail.originKind,'DIRECT');assert.equal(result.detail.critical.mode,'DISALLOWED');assert.deepEqual(result.detail.vampRules,[],'目标不再是待补的空吸血规则');
  const skillRoot='/skills/'+c.skillKey,scopeRoute=skillRoot+'/trigger-rules/'+c.scopeRuleKey,scope=values[scopeRoute];
  assert(scope,'缺少已回读的实际命中范围规则');
  assert.deepEqual(scope.eventSource,{eventType:'SKILL_HIT',detail:{sourceSkillKey:c.skillKey,useKind:null}});
  assert.deepEqual(scope.conditionGroups,[{conditions:[{conditionKey:'champion_target',conditionType:'TARGET_CATEGORY_CHECK',detail:{categories:['CHAMPION']},sortOrder:10},{conditionKey:'enemy_target',conditionType:'SKILL_HIT_TARGET_IS_ENEMY',detail:{},sortOrder:20}],groupKey:'champion_target',name:'本轮敌方英雄',sortOrder:10}]);
  const direct=scope.actions.filter(a=>a.actionType==='EXECUTE_EFFECT'&&a.detail.effectKey===c.effectKey);
  assert.equal(direct.length,1);assert.equal(direct[0].targetContext,'CURRENT_TARGET');
  for(const row of values[skillRoot+'/trigger-rules'])if(row.ruleKey!==c.scopeRuleKey)assert(!values[skillRoot+'/trigger-rules/'+row.ruleKey].actions.some(a=>a.actionType==='EXECUTE_EFFECT'&&a.detail.effectKey===c.effectKey),'还有未经本批确认的直接调用入口');
  for(const row of values[skillRoot+'/processes'])assert(!values[skillRoot+'/processes/'+row.processKey].effectBindings.some(b=>b.effectKey===c.effectKey),'存在过程直接执行，不能只按英雄命中修正');
  const body={};for(const key of ['name','description','sortOrder','lifecycle','results']){assert(Object.hasOwn(old,key));body[key]=structuredClone(old[key]);}
  body.description=c.description;body.results[0].detail.vampRules=structuredClone(vampRules);
  const expectedReadback={...old,description:body.description,results:body.results};
  return {method:'PUT',route:c.route,body,expectedReadback};
});}
const required=[executorKey,'01-纠错计划.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'];
const sameIgnoringUpdated=(actual,expected)=>{assert(typeof actual.updatedAt==='string'&&Number.isFinite(Date.parse(actual.updatedAt)));assert.deepEqual({...actual,updatedAt:expected.updatedAt},expected);};
if(mode==='prepare'){
  for(const f of required.slice(2))assert(!fs.existsSync(path.join(here,f)),'拒绝覆盖'+f);
  const api=client(),values=await snapshot(api),source=sources(),requests=makeRequests(values);
  save('03-来源摘要.json',source);save('04-写入前现值.json',{at:new Date().toISOString(),base,values,audit:api.audit,businessWrites:0});
  save('02-冻结请求.json',{base,requests,sourceSha256:hash('03-来源摘要.json'),baselineSha256:hash('04-写入前现值.json')});
  console.log(JSON.stringify({status:'READY_FOR_REVIEW',GETs:api.audit.length,plannedPUTs:requests.length,batchFileSha256:hash('02-冻结请求.json')}));
}else{
  const review=read('05-独立评审.json');assert.equal(review.status,'APPROVED');for(const f of required)assert.equal(hash(f),review.approvedFiles[f],'批准文件漂移：'+f);
  assert.deepEqual(sources(),read('03-来源摘要.json'));
  const frozen=read('02-冻结请求.json'),before=read('04-写入前现值.json');assert.equal(frozen.base,base);assert.equal(frozen.sourceSha256,hash('03-来源摘要.json'));assert.equal(frozen.baselineSha256,hash('04-写入前现值.json'));assert.deepEqual(frozen.requests,makeRequests(before.values));
  const api=client(),current=await snapshot(api);
  if(mode==='readback'){
    assert.equal(read('06-写入与即时回读.json').status,'PASS');assert.equal(Object.keys(current).length,Object.keys(before.values).length);
    let unchanged=0,changedCollections=0;const changedDetails={};
    for(const[route,old]of Object.entries(before.values)){
      const direct=frozen.requests.find(w=>w.route===route);
      if(direct){sameIgnoringUpdated(current[route],direct.expectedReadback);changedDetails[route]=current[route];continue;}
      const edits=frozen.requests.filter(w=>w.route.slice(0,w.route.lastIndexOf('/'))===route);
      if(edits.length){assert(Array.isArray(old));const expected=old.map(row=>{const w=edits.find(x=>x.route.endsWith('/'+row.effectKey));return w?{...row,description:w.body.description,updatedAt:current[w.route].updatedAt}:row;});assert.deepEqual(current[route],expected);changedCollections++;continue;}
      assert.deepEqual(current[route],old,'旧响应变化：'+route);unchanged++;
    }
    assert.equal(Object.keys(changedDetails).length,frozen.requests.length);
    console.log(JSON.stringify({status:'PASS',at:new Date().toISOString(),businessWrites:0,GETs:api.audit.length,unchangedResponsesIncludingTimestamps:unchanged,expectedChangedCollections:changedCollections,changedDetails,audit:api.audit}));
  }else{
    assert.deepEqual(current,before.values,'保护现值漂移');
    if(mode==='preflight')console.log(JSON.stringify({status:'PASS',GETs:api.audit.length,businessWrites:0}));
    else{
      assert.equal(process.env.DAMAGE_APPROVED_BATCH_SHA,hash('02-冻结请求.json'));
      const report={startedAt:new Date().toISOString(),status:'STARTED',businessWritesAttempted:0,operations:[],approvedFiles:review.approvedFiles};save('06-写入与即时回读.json',report);
      const persist=()=>fs.writeFileSync(path.join(here,'06-写入与即时回读.json'),JSON.stringify(report,null,2)+'\n');
      try{for(const w of frozen.requests){
        assert.deepEqual(await api.get(w.route),before.values[w.route],'当前目标漂移');report.businessWritesAttempted++;report.pendingRoute=w.route;persist();
        const result=await api.request(w.route,w.method,w.body,status=>{report.pendingResponseStatus=status;report.audit=api.audit;persist();});report.operations.push({route:w.route,response:result});persist();assert.equal(result.status,200);
        const actual=await api.get(w.route);sameIgnoringUpdated(actual,w.expectedReadback);report.operations.at(-1).readback=actual;report.pendingRoute=null;persist();
      }report.status='PASS';}
      catch(error){report.status='FAILED_CHECK_CURRENT_BEFORE_RECOVERY';report.error=error.message;throw error;}
      finally{report.finishedAt=new Date().toISOString();report.audit=api.audit;persist();}
      console.log(JSON.stringify({status:report.status,PUTs:report.businessWritesAttempted,immediateReadbacks:report.operations.filter(x=>x.readback).length}));
    }
  }
}

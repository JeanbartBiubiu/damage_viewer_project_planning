import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 从已验收安妮/莫甘娜批次复用保护流程；自施批次只查目标及引用，不重复遍历全游戏。
const executor=fileURLToPath(import.meta.url),web=path.resolve(path.dirname(executor),'../../../..');
const executorKey='共享受保护触发批次/受保护自施补录-v1.mjs';
const mode=process.argv[2]||'prepare',here=path.resolve(process.argv[3]||'');
assert(['prepare','preflight','write','readback'].includes(mode));
assert(here.startsWith(path.join(web,'数据参考')+path.sep));
const base='http://127.0.0.1:8080/api/admin/games/lol';
const read=name=>JSON.parse(fs.readFileSync(path.join(here,name),'utf8'));
const save=(name,value)=>fs.writeFileSync(path.join(here,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hash=name=>sha(fs.readFileSync(name===executorKey?executor:path.join(here,name)));
const noTimes=x=>Array.isArray(x)?x.map(noTimes):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>!['createdAt','updatedAt'].includes(k)).map(([k,v])=>[k,noTimes(v)])):x;
const plan=read('01-补录计划.json'),skills=new Set();
for(const t of plan.targets){assert(/^[a-z0-9_]+$/.test(t.skillKey));assert(!skills.has(t.skillKey));skills.add(t.skillKey);assert(t.ownerKey&&t.ruleKey&&t.effects.length);assert.equal(new Set(t.effects).size,t.effects.length);}
const kinds=[['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey'],['processes','processKey'],['internal-states','stateKey'],['trigger-rules','ruleKey']];
function sources(){return plan.sourceFiles.map(s=>{const root=s.root==='planning'?path.resolve(web,'../damage_viewer_project_planning'):s.root==='web'?web:null;assert(root);const p=path.resolve(root,s.path);assert(p.startsWith(root+path.sep));return {...s,sha256:sha(fs.readFileSync(p))};});}
function client(writes=[]){
  const token=crypto.randomUUID(),audit=[];
  async function request(route,method='GET',body){
    assert(method==='GET'||mode==='write');
    if(method!=='GET'){const allowed=writes.find(w=>w.method===method&&w.route===route);assert(allowed,'请求越界');assert.deepEqual(body,allowed.body);}
    const r=await fetch(base+route,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    const data=await r.json();audit.push({method,path:route,status:r.status});return {status:r.status,data};
  }
  async function get(route,status=200){const r=await request(route);assert.equal(r.status,status,route);return r.data;}
  return {request,get,audit};
}
async function snapshot(api){
  const values={},attributes=new Set(),zones=new Set();
  const once=async route=>{if(!Object.hasOwn(values,route))values[route]=await api.get(route);return values[route];};
  function refs(x){if(Array.isArray(x))x.forEach(refs);else if(x&&typeof x==='object'){if(typeof x.attributeKey==='string')attributes.add(x.attributeKey);if(typeof x.modifierZoneKey==='string')zones.add(x.modifierZoneKey);Object.values(x).forEach(refs);}}
  for(const t of plan.targets){const root='/skills/'+t.skillKey,owner='/characters/'+t.ownerKey;
    for(const route of [root,owner,owner+'/attributes',owner+'/representative-image',root+'/representative-image','/character-skill-relations?characterKey='+t.ownerKey,'/character-skill-relations?skillKey='+t.skillKey])await once(route);
    for(const [kind,key]of kinds){const route=root+'/'+kind,list=await once(route);assert(Array.isArray(list));assert.equal(new Set(list.map(x=>x[key])).size,list.length);for(const row of list){const detail=await once(route+'/'+row[key]);if(kind==='effects'||kind==='formulas')refs(detail);}}
  }
  for(const key of attributes)await once('/attributes/'+key);for(const key of zones)await once('/modifier-zones/'+key);
  return values;
}
function requests(values){
  const writes=[];
  for(const t of plan.targets){const root='/skills/'+t.skillKey;
    assert.equal(values[root].status,'ENABLED');assert.deepEqual(values[root+'/trigger-rules'],[],'仅处理当前空规则集合');
    const actions=t.effects.map((key,i)=>{const e=values[root+'/effects/'+key];assert(e&&e.results.length);assert.equal(e.lifecycle.instanceScope,'SOURCE');assert(e.results.every(r=>r.target==='SOURCE'));assert.equal(e.lifecycle.periodicIntervalValue,null);
      return {actionKey:'apply_'+key,name:'执行'+e.name,actionType:'EXECUTE_EFFECT',sortOrder:(i+1)*10,targetContext:'CURRENT_TARGET',detail:{effectKey:key},runtimeInputBindings:[],resultModifiers:[]};});
    const body={ruleKey:t.ruleKey,name:t.ruleName,description:t.description,sortOrder:10,eventSource:{eventType:'SKILL_USED',detail:{sourceSkillKey:t.skillKey,useKind:'ACTIVE'}},conditionGroups:[{groupKey:'self_cast',name:'明确对自身施放',sortOrder:10,conditions:[{conditionKey:'explicit_self',conditionType:'EXPLICIT_TARGET_IS_SOURCE',sortOrder:10,detail:{}}]}],actions,perTargetCooldown:null,maxTriggersPerProcess:null};
    writes.push({method:'POST',route:root+'/trigger-rules',detailRoute:root+'/trigger-rules/'+t.ruleKey,body,expectedReadback:body});
  }
  for(const edit of plan.effectDescriptions||[]){assert(skills.has(edit.skillKey));const route='/skills/'+edit.skillKey+'/effects/'+edit.effectKey,before=values[route];assert(before);assert.notEqual(before.description,edit.description);const body={};for(const key of ['name','description','sortOrder','lifecycle','results']){assert(Object.hasOwn(before,key));body[key]=key==='description'?edit.description:before[key];}writes.push({method:'PUT',route,detailRoute:route,body,expectedReadback:{...before,description:edit.description}});}
  assert.equal(new Set(writes.map(x=>x.method+' '+x.route)).size,writes.length);return writes;
}
const required=[executorKey,'01-补录计划.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'];
if(mode==='prepare'){
  for(const f of required.slice(2))assert(!fs.existsSync(path.join(here,f)),'拒绝覆盖'+f);
  const source=sources(),api=client(),values=await snapshot(api),writes=requests(values);
  for(const w of writes)if(w.method==='POST')await api.get(w.detailRoute,404);
  save('03-来源摘要.json',source);save('04-写入前现值.json',{at:new Date().toISOString(),base,values,audit:api.audit,businessWrites:0});save('02-冻结请求.json',{base,writes,sourceSha256:hash('03-来源摘要.json'),baselineSha256:hash('04-写入前现值.json')});
  console.log(JSON.stringify({status:'READY_FOR_REVIEW',GETs:api.audit.length,POSTs:writes.filter(w=>w.method==='POST').length,PUTs:writes.filter(w=>w.method==='PUT').length,batchFileSha256:hash('02-冻结请求.json')}));
}else{
  const review=read('05-独立评审.json');assert.equal(review.status,'APPROVED');for(const f of required)assert.equal(hash(f),review.approvedFiles[f],'批准文件漂移：'+f);
  assert.deepEqual(sources(),read('03-来源摘要.json'));const frozen=read('02-冻结请求.json'),before=read('04-写入前现值.json');assert.equal(frozen.base,base);assert.equal(frozen.sourceSha256,hash('03-来源摘要.json'));assert.equal(frozen.baselineSha256,hash('04-写入前现值.json'));assert.deepEqual(frozen.writes,requests(before.values));
  const api=client(mode==='write'?frozen.writes:[]),values=await snapshot(api);
  if(mode==='readback'){
    const detailByRoute=new Map(frozen.writes.map(w=>[w.detailRoute,w]));let changed=0,unchanged=0;
    for(const [route,old]of Object.entries(before.values)){
      if(detailByRoute.has(route)){assert.deepEqual(noTimes(values[route]),noTimes(detailByRoute.get(route).expectedReadback));changed++;continue;}
      const added=frozen.writes.find(w=>w.method==='POST'&&w.route===route);
      if(added){assert.equal(values[route].length,old.length+1);const row=values[route][0];assert.equal(typeof row.updatedAt,'string');assert(Number.isFinite(Date.parse(row.updatedAt)));assert.deepEqual(row,{actionCount:added.body.actions.length,conditionGroupCount:1,description:added.body.description,eventType:'SKILL_USED',maxTriggersPerProcessEnabled:false,name:added.body.name,perTargetCooldownEnabled:false,ruleKey:added.body.ruleKey,sortOrder:added.body.sortOrder,updatedAt:row.updatedAt});changed++;continue;}
      const edits=frozen.writes.filter(w=>w.method==='PUT'&&w.route.substring(0,w.route.lastIndexOf('/'))===route);
      if(edits.length){assert.equal(values[route].length,old.length);const expected=old.map(row=>{const w=edits.find(e=>e.route.endsWith('/'+row.effectKey));return w?{...row,description:w.body.description,updatedAt:values[w.route].updatedAt}:row;});assert.deepEqual(values[route],expected);changed++;continue;}
      assert.deepEqual(values[route],old,'旧对象变化：'+route);unchanged++;
    }
    const newRules={};for(const w of frozen.writes.filter(x=>x.method==='POST')){assert.deepEqual(values[w.detailRoute],w.body);newRules[w.detailRoute]=values[w.detailRoute];}
    assert.equal(Object.keys(values).length,Object.keys(before.values).length+Object.keys(newRules).length);
    console.log(JSON.stringify({status:'PASS',at:new Date().toISOString(),businessWrites:0,GETs:api.audit.length,unchangedResponsesIncludingTimestamps:unchanged,expectedChangedResponses:changed,newRules,audit:api.audit}));
  }else{
    assert.deepEqual(values,before.values,'受保护现值漂移');for(const w of frozen.writes)if(w.method==='POST')await api.get(w.detailRoute,404);
    if(mode==='preflight')console.log(JSON.stringify({status:'PASS',GETs:api.audit.length,businessWrites:0}));
    else{
      assert.equal(process.env.DAMAGE_APPROVED_BATCH_SHA,hash('02-冻结请求.json'));
      const report={startedAt:new Date().toISOString(),status:'STARTED',businessWritesAttempted:0,operations:[],approvedFiles:review.approvedFiles};save('06-写入与即时回读.json',report);const persist=()=>fs.writeFileSync(path.join(here,'06-写入与即时回读.json'),JSON.stringify(report,null,2)+'\n');
      try{for(const w of frozen.writes){if(w.method==='POST')await api.get(w.detailRoute,404);else assert.deepEqual(await api.get(w.detailRoute),before.values[w.detailRoute]);report.businessWritesAttempted++;report.pendingRoute=w.detailRoute;persist();const result=await api.request(w.route,w.method,w.body);report.operations.push({method:w.method,route:w.route,response:result});persist();assert.equal(result.status,w.method==='POST'?201:200);const actual=await api.get(w.detailRoute);assert.deepEqual(noTimes(actual),noTimes(w.expectedReadback));report.operations.at(-1).readback=actual;report.pendingRoute=null;persist();}report.status='PASS';}
      catch(error){report.status='FAILED_CHECK_CURRENT_BEFORE_RECOVERY';report.error=error.message;throw error;}
      finally{report.finishedAt=new Date().toISOString();report.audit=api.audit;persist();}
      console.log(JSON.stringify({status:report.status,writes:report.businessWritesAttempted,immediateReadbacks:report.operations.filter(x=>x.readback).length}));
    }
  }
}

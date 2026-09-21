import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 普通说明纠错工具 v2：复用既有批次的摘要评审、定点预检与防重放，并先保存响应审计再解析响应。
const executor=fileURLToPath(import.meta.url),web=path.resolve(path.dirname(executor),'../..');
const mode=process.argv[2]||'prepare',here=path.resolve(process.argv[3]||'');
assert(['prepare','preflight','write'].includes(mode));
assert(here.startsWith(path.join(web,'数据参考')+path.sep),'批次目录必须位于当前Web数据参考下');
const base='http://127.0.0.1:8080/api/admin/games/lol';
const read=name=>JSON.parse(fs.readFileSync(path.join(here,name),'utf8'));
const save=(name,value)=>fs.writeFileSync(path.join(here,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fileHash=name=>sha(fs.readFileSync(name==='tools/authoring/update-reviewed-descriptions-v2.mjs'?executor:path.join(here,name)));
const sameIgnoringUpdated=(actual,expected)=>{assert(typeof actual.updatedAt==='string'&&Number.isFinite(Date.parse(actual.updatedAt)));assert.deepEqual({...actual,updatedAt:expected.updatedAt},expected);};
const plan=read('01-纠错计划.json');
assert(Array.isArray(plan.changes)&&plan.changes.length>0);
const fieldSets={skill:['name','description','maxLevel','status','sortOrder','skillCategoryKeys'],parameter:['name','description','valueType','valueMode','fixedValue','levelValues','sortOrder'],effect:['name','description','sortOrder','lifecycle','results']};
const seen=new Set();
for(const change of plan.changes){
  const m=change.route.match(/^\/skills\/([a-z0-9_]+)(?:\/(parameters|effects)\/([a-z0-9_]+))?$/);
  assert(m,'只允许技能、参数或效果说明');assert(!seen.has(change.route));seen.add(change.route);
  assert.equal(change.kind,m[2]==='parameters'?'parameter':m[2]==='effects'?'effect':'skill');
  assert.equal(change.skillKey,m[1]);assert.equal(typeof change.description,'string');assert(change.description.trim()&&change.description.length<=2000);
}
const skills=[...new Set(plan.changes.map(x=>x.skillKey))];
const kinds=[['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey'],['processes','processKey'],['internal-states','stateKey'],['trigger-rules','ruleKey']];
function sources(){return plan.sourceFiles.map(source=>{const root=source.root==='planning'?path.resolve(web,'../damage_viewer_project_planning'):source.root==='web'?web:null;assert(root);const p=path.resolve(root,source.path);assert(p.startsWith(root+path.sep));return {...source,sha256:sha(fs.readFileSync(p))};});}
function client(){
  const token=crypto.randomUUID(),audit=[];
  async function request(route,method='GET',body){
    assert(method==='GET'||(mode==='write'&&method==='PUT'&&seen.has(route)));
    const r=await fetch(base+route,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    audit.push({method,path:route,status:r.status});const data=await r.json();return {status:r.status,data};
  }
  async function get(route){const r=await request(route);assert.equal(r.status,200,route);return r.data;}
  return {request,get,audit};
}
async function snapshot(api){
  const values={};
  for(const key of skills){const root='/skills/'+key;values[root]=await api.get(root);
    for(const [kind,id]of kinds){const route=root+'/'+kind,list=await api.get(route);assert(Array.isArray(list));assert.equal(new Set(list.map(x=>x[id])).size,list.length);values[route]=list;for(const row of list)values[route+'/'+row[id]]=await api.get(route+'/'+row[id]);}
  }
  return values;
}
function makeRequests(values){return plan.changes.map(change=>{
  const before=values[change.route];assert(before,change.route);assert.notEqual(before.description,change.description,'说明已一致，不应重复写入');
  const body={};for(const key of fieldSets[change.kind]){assert(Object.hasOwn(before,key),change.route+'/'+key);body[key]=key==='description'?change.description:before[key];}
  return {method:'PUT',route:change.route,body,expectedReadback:{...before,description:change.description}};
});}
const required=['tools/authoring/update-reviewed-descriptions-v2.mjs','01-纠错计划.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'];
if(mode==='prepare'){
  for(const f of required.slice(2))assert(!fs.existsSync(path.join(here,f)),'拒绝覆盖'+f);
  const api=client(),values=await snapshot(api),source=sources(),requests=makeRequests(values);
  save('03-来源摘要.json',source);save('04-写入前现值.json',{at:new Date().toISOString(),base,values,audit:api.audit,businessWrites:0});
  save('02-冻结请求.json',{base,requests,sourceSha256:fileHash('03-来源摘要.json'),baselineSha256:fileHash('04-写入前现值.json')});
  console.log(JSON.stringify({status:'READY_FOR_REVIEW',GETs:api.audit.length,writes:requests.length,batchFileSha256:fileHash('02-冻结请求.json')}));
}else{
  const review=read('05-独立评审.json');assert.equal(review.status,'APPROVED');
  for(const f of required)assert.equal(fileHash(f),review.approvedFiles[f],'批准文件漂移：'+f);
  assert.deepEqual(sources(),read('03-来源摘要.json'));
  const frozen=read('02-冻结请求.json'),before=read('04-写入前现值.json');
  assert.equal(frozen.base,base);assert.equal(frozen.sourceSha256,fileHash('03-来源摘要.json'));assert.equal(frozen.baselineSha256,fileHash('04-写入前现值.json'));
  assert.deepEqual(frozen.requests,makeRequests(before.values));
  const api=client(),current=await snapshot(api);assert.deepEqual(current,before.values,'保护现值漂移');
  if(mode==='preflight')console.log(JSON.stringify({status:'PASS',GETs:api.audit.length,businessWrites:0}));
  else{
    assert.equal(process.env.DAMAGE_APPROVED_BATCH_SHA,fileHash('02-冻结请求.json'),'缺少准确的获批冻结文件摘要');
    const report={startedAt:new Date().toISOString(),status:'STARTED',businessWritesAttempted:0,operations:[],approvedFiles:review.approvedFiles};
    save('06-写入与即时回读.json',report);
    const persist=()=>fs.writeFileSync(path.join(here,'06-写入与即时回读.json'),JSON.stringify(report,null,2)+'\n');
    try{for(const request of frozen.requests){
      assert.deepEqual(await api.get(request.route),before.values[request.route],'当前目标漂移');
      report.businessWritesAttempted+=1;report.pendingRoute=request.route;persist();
      const result=await api.request(request.route,'PUT',request.body);report.operations.push({route:request.route,response:result});persist();assert.equal(result.status,200);
      const actual=await api.get(request.route);sameIgnoringUpdated(actual,request.expectedReadback);
      report.operations.at(-1).readback=actual;report.pendingRoute=null;persist();
    }report.status='PASS';}
    catch(error){report.status='FAILED_CHECK_CURRENT_BEFORE_RECOVERY';report.error=error.message;throw error;}
    finally{report.finishedAt=new Date().toISOString();report.audit=api.audit;persist();}
    console.log(JSON.stringify({status:report.status,PUTs:report.businessWritesAttempted,immediateReadbacks:report.operations.filter(x=>x.readback).length}));
  }
}

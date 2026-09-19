import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 已核固定来源的主技能：只将空分类补为ultimate，保留所有其他技能字段。
const executor=fileURLToPath(import.meta.url),web=path.resolve(path.dirname(executor),'../..');
const mode=process.argv[2],here=path.resolve(process.argv[3]||'');
assert(['prepare','preflight','write','readback'].includes(mode));
assert(here.startsWith(path.join(web,'数据参考')+path.sep));
const base='http://127.0.0.1:8080/api/admin/games/lol';
const read=n=>JSON.parse(fs.readFileSync(path.join(here,n),'utf8'));
const save=(n,o)=>fs.writeFileSync(path.join(here,n),JSON.stringify(o,null,2)+'\n',{flag:'wx'});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const writerKey='tools/authoring/append-reviewed-ultimate-categories.mjs';
const hash=n=>sha(fs.readFileSync(n===writerKey?executor:path.join(here,n)));
const plan=read('01-分类计划.json');
assert(Array.isArray(plan.skillKeys)&&plan.skillKeys.length>0);
assert.equal(new Set(plan.skillKeys).size,plan.skillKeys.length);
assert(plan.skillKeys.every(k=>/^[a-z0-9_]+$/.test(k)));
const sourcePath=path.resolve(web,plan.sourceCandidatesFile);
assert(sourcePath.startsWith(path.join(web,'数据参考')+path.sep));
const sourceBytes=fs.readFileSync(sourcePath),source=JSON.parse(sourceBytes);
assert.equal(sha(sourceBytes),plan.sourceCandidatesSha256);
assert.deepEqual(source.sourceVersion,{client:'16.17',ddragon:'16.17.1'});
const sourceRows=plan.skillKeys.map(key=>{
 const rows=source.eligible.filter(x=>x.skillKey===key);assert.equal(rows.length,1);
 const row=rows[0];assert(Object.values(row.checks).every(x=>x===true));
 assert.equal(row.rootType,'SpellObject');assert.equal(row.objectPath,row.spellPath);assert.equal(row.abilityRoot,row.spellPath);assert(row.tags.includes('Trait_Ultimate'));
 return row;
});
function sourceHashes(){return [{path:plan.sourceCandidatesFile,sha256:sha(fs.readFileSync(sourcePath))},...sourceRows.flatMap(row=>row.sourceFiles).map(ref=>{
 const file=path.resolve(web,ref.path);assert(file.startsWith(path.join(web,'数据参考')+path.sep));const digest=sha(fs.readFileSync(file));assert.equal(digest,ref.sha256);return {path:ref.path,sha256:digest};
})];}
const token=crypto.randomUUID(),audit=[];
async function request(route,method='GET',body,onResponse){
 assert(method==='GET'||(mode==='write'&&method==='PUT'&&plan.skillKeys.some(k=>route==='/skills/'+k)));
 const r=await fetch(base+route,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 const event={method,path:route,status:r.status};audit.push(event);if(onResponse)onResponse(event);
 const data=await r.json();return {status:r.status,data};
}
async function get(route){const r=await request(route);assert.equal(r.status,200,route);return r.data;}
async function snapshot(){const values={'/skill-categories':await get('/skill-categories')};for(const key of plan.skillKeys)values['/skills/'+key]=await get('/skills/'+key);return values;}
function freeze(values){
 const categories=values['/skill-categories'];assert(Array.isArray(categories.items));
 const ultimate=categories.items.filter(x=>x.skillCategoryKey==='ultimate');assert.equal(ultimate.length,1);assert.equal(ultimate[0].status,'ENABLED');
 const requests=[],reused=[],manualReview=[];
 for(const key of plan.skillKeys){const route='/skills/'+key,before=values[route];assert.equal(before.skillKey,key);assert.equal(before.gameId,'lol');assert(Array.isArray(before.skillCategoryKeys));
  if(before.skillCategoryKeys.includes('ultimate')){reused.push(key);continue;}
  if(before.skillCategoryKeys.length!==0){manualReview.push({skillKey:key,skillCategoryKeys:before.skillCategoryKeys});continue;}
  const body={};for(const field of ['name','description','maxLevel','status','sortOrder','skillCategoryKeys']){assert(Object.hasOwn(before,field));body[field]=field==='skillCategoryKeys'?['ultimate']:before[field];}
  requests.push({method:'PUT',route,body,expectedReadback:{...before,skillCategoryKeys:['ultimate']}});
 }
 return {requests,reused,manualReview};
}
const required=[writerKey,'01-分类计划.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'];
if(mode==='prepare'){
 for(const name of required.slice(2))assert(!fs.existsSync(path.join(here,name)),'拒绝覆盖'+name);
 const sources=sourceHashes(),values=await snapshot(),changes=freeze(values);
 save('03-来源摘要.json',sources);save('04-写入前现值.json',{at:new Date().toISOString(),base,values,audit,businessWrites:0});
 save('02-冻结请求.json',{base,...changes,sourceSha256:hash('03-来源摘要.json'),baselineSha256:hash('04-写入前现值.json')});
 console.log(JSON.stringify({status:'READY_FOR_REVIEW',GETs:audit.length,writes:changes.requests.length,reused:changes.reused,manualReview:changes.manualReview,batchFileSha256:hash('02-冻结请求.json')}));
}else{
 const review=read('05-独立评审.json');assert.equal(review.status,'APPROVED');for(const name of required)assert.equal(hash(name),review.approvedFiles[name],'批准文件漂移：'+name);
 assert.deepEqual(sourceHashes(),read('03-来源摘要.json'));
 const frozen=read('02-冻结请求.json'),before=read('04-写入前现值.json');assert.equal(frozen.base,base);assert.equal(frozen.sourceSha256,hash('03-来源摘要.json'));assert.equal(frozen.baselineSha256,hash('04-写入前现值.json'));
 const expected=freeze(before.values);assert.deepEqual({requests:frozen.requests,reused:frozen.reused,manualReview:frozen.manualReview},expected);
 if(mode==='readback'){
  const written=read('06-写入与即时回读.json');assert.equal(written.status,'PASS');assert.equal(written.operations.length,frozen.requests.length);
  const current=await snapshot(),changed=new Map(frozen.requests.map(x=>[x.route,x]));
  for(const[route,value]of Object.entries(current)){
   if(changed.has(route)){const operation=written.operations.find(x=>x.route===route);assert(operation?.readback);assert.deepEqual(value,operation.readback);assert.deepEqual({...value,updatedAt:before.values[route].updatedAt},changed.get(route).expectedReadback);}
   else assert.deepEqual(value,before.values[route]);
  }
  console.log(JSON.stringify({status:'PASS',at:new Date().toISOString(),businessWrites:0,GETs:audit.length,updatedSkills:changed.size,unchangedResponsesIncludingTimestamps:Object.keys(current).length-changed.size,reused:frozen.reused,manualReview:frozen.manualReview,values:current,audit}));
 }else{
  assert.deepEqual(await snapshot(),before.values,'保护现值漂移');
  if(mode==='preflight')console.log(JSON.stringify({status:'PASS',GETs:audit.length,businessWrites:0}));
  else{
   assert.equal(process.env.DAMAGE_APPROVED_BATCH_SHA,hash('02-冻结请求.json'));
   const report={startedAt:new Date().toISOString(),status:'STARTED',businessWritesAttempted:0,operations:[],approvedFiles:review.approvedFiles};save('06-写入与即时回读.json',report);
   const persist=()=>fs.writeFileSync(path.join(here,'06-写入与即时回读.json'),JSON.stringify(report,null,2)+'\n');
   try{for(const item of frozen.requests){
    assert.deepEqual(await get(item.route),before.values[item.route],'写前目标漂移');report.pendingRoute=item.route;report.businessWritesAttempted++;persist();
    const operation={route:item.route};report.operations.push(operation);persist();
    const response=await request(item.route,'PUT',item.body,event=>{operation.responseAudit=event;persist();});operation.response=response;persist();assert.equal(response.status,200);
    const actual=await get(item.route);assert.equal(typeof actual.updatedAt,'string');assert(Number.isFinite(Date.parse(actual.updatedAt)));assert.notEqual(actual.updatedAt,before.values[item.route].updatedAt);
    assert.deepEqual({...actual,updatedAt:before.values[item.route].updatedAt},item.expectedReadback);operation.readback=actual;report.pendingRoute=null;persist();
   }report.status='PASS';}
   catch(error){report.status='FAILED_CHECK_CURRENT_BEFORE_RECOVERY';report.error=error.message;throw error;}
   finally{report.finishedAt=new Date().toISOString();report.audit=audit;persist();}
   console.log(JSON.stringify({status:report.status,PUTs:report.businessWritesAttempted,immediateReadbacks:report.operations.filter(x=>x.readback).length}));
  }
 }
}

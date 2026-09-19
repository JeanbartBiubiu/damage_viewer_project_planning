import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 状态目录首次页面录入的只读保护 v3：追加魅惑身份；没有 HTTP 写入模式，旧工具保持冻结。
const executor=fileURLToPath(import.meta.url),web=path.resolve(path.dirname(executor),'../..');
const tool='tools/authoring/reviewed-status-ui-v3.mjs',mode=process.argv[2],here=path.resolve(process.argv[3]||'');
assert(['prepare','preflight','readback'].includes(mode));assert(here.startsWith(path.join(web,'数据参考')+path.sep));
const base='http://127.0.0.1:8080/api/admin/games/lol',read=n=>JSON.parse(fs.readFileSync(path.join(here,n),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=n=>sha(n===tool?executor:path.join(here,n)),save=(n,v)=>fs.writeFileSync(path.join(here,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const plan=read('01-候选方案.json'),body=plan.body;
assert.equal(plan.executionMode,'BROWSER_UI_ONLY');
assert.deepEqual(Object.keys(body).sort(),['description','name','sortOrder','status','statusKey','statusKind']);
assert(/^[a-z][a-z0-9_]{0,63}$/.test(body.statusKey));assert(['STUN','MOVEMENT_SLOW','ROOT','SILENCE','CHARM'].includes(body.statusKind));
assert.equal(typeof body.name,'string');assert(body.name.trim()===body.name&&body.name.length>0);
assert(body.description===null||typeof body.description==='string');assert(['ENABLED','DISABLED'].includes(body.status));
assert(Number.isInteger(body.sortOrder)&&body.sortOrder>=0);
const detailRoute='/statuses/'+body.statusKey,required=[tool,'01-候选方案.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'];
function sources(){
  assert(Array.isArray(plan.sourceFiles)&&plan.sourceFiles.length>0);
  return plan.sourceFiles.map(s=>{
    const root={web,backend:path.resolve(web,'../damage_backend_dev'),planning:path.resolve(web,'../damage_viewer_project_planning')}[s.root];
    assert(root&&typeof s.path==='string');const p=path.resolve(root,s.path);assert(p.startsWith(root+path.sep));
    const actualSha256=sha(p);assert.equal(actualSha256,s.sha256,'来源漂移：'+s.path);return{...s,actualSha256};
  });
}
function client(){
  const token=crypto.randomUUID(),audit=[];
  async function get(route,status=200){
    assert(route==='/statuses'||/^\/statuses\/[a-z][a-z0-9_]{0,63}$/.test(route));
    const response=await fetch(base+route,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
    audit.push({method:'GET',path:route,status:response.status});assert.equal(response.status,status,route);return response.json();
  }
  return{get,audit};
}
async function snapshot(api){
  const list=await api.get('/statuses');assert(Array.isArray(list.items));assert.equal(list.total,list.items.length);
  assert.equal(new Set(list.items.map(x=>x.statusKey)).size,list.items.length);
  const values={'/statuses':list};
  for(const item of list.items){assert.equal(item.gameId,'lol');assert(/^[a-z][a-z0-9_]{0,63}$/.test(item.statusKey));const route='/statuses/'+item.statusKey;values[route]=await api.get(route);assert.deepEqual(values[route],item,'列表与详情不一致');}
  return values;
}
function checkNew(actual){
  assert(actual&&typeof actual==='object');const{gameId,createdAt,updatedAt,...actualBody}=actual;
  assert.equal(gameId,'lol');for(const value of[createdAt,updatedAt])assert(typeof value==='string'&&Number.isFinite(Date.parse(value)));
  assert.deepEqual(actualBody,body,'新状态与完整冻结请求不一致');
}
if(mode==='prepare'){
  for(const n of required.slice(2))assert(!fs.existsSync(path.join(here,n)),'拒绝覆盖'+n);
  const source=sources(),api=client(),values=await snapshot(api);assert(!Object.hasOwn(values,detailRoute));await api.get(detailRoute,404);
  save('03-来源摘要.json',source);save('04-写入前现值.json',{at:new Date().toISOString(),base,values,audit:api.audit,businessWrites:0});
  save('02-冻结请求.json',{base,executionMode:'BROWSER_UI_ONLY',request:{method:'POST',route:'/statuses',detailRoute,body},sourceSha256:hash('03-来源摘要.json'),baselineSha256:hash('04-写入前现值.json')});
  console.log(JSON.stringify({status:'READY_FOR_REVIEW',GETs:api.audit.length,plannedBrowserWrites:1,batchFileSha256:hash('02-冻结请求.json')}));
}else{
  const review=read('05-独立评审.json');assert.equal(review.status,'APPROVED');for(const n of required)assert.equal(hash(n),review.approvedFiles[n],'批准文件漂移：'+n);
  assert.deepEqual(sources(),read('03-来源摘要.json'));const frozen=read('02-冻结请求.json'),before=read('04-写入前现值.json');
  assert.equal(frozen.base,base);assert.equal(frozen.executionMode,'BROWSER_UI_ONLY');assert.deepEqual(frozen.request,{method:'POST',route:'/statuses',detailRoute,body});assert.equal(frozen.sourceSha256,hash('03-来源摘要.json'));assert.equal(frozen.baselineSha256,hash('04-写入前现值.json'));
  const api=client(),values=await snapshot(api);
  if(mode==='preflight'){
    assert.deepEqual(values,before.values,'原状态目录或详情漂移');assert(!Object.hasOwn(values,detailRoute));await api.get(detailRoute,404);
    console.log(JSON.stringify({status:'PASS',businessWrites:0,GETs:api.audit.length}));
  }else{
    const writer=read('06-写入与即时回读.json');assert.equal(writer.status,'PASS');assert.equal(writer.executionMode,'BROWSER_UI_ONLY');assert.equal(writer.businessWritesAttempted,1);
    const old=before.values['/statuses'],actual=values['/statuses'];assert.equal(actual.total,old.total+1);assert.equal(actual.items.length,old.items.length+1);
    assert.deepEqual(actual.items.filter(x=>x.statusKey!==body.statusKey),old.items,'原列表项或顺序变化');
    let unchanged=0;for(const[route,value]of Object.entries(before.values)){if(route==='/statuses')continue;assert.deepEqual(values[route],value,'原状态含时间戳变化：'+route);unchanged++;}
    checkNew(values[detailRoute]);assert.equal(Object.keys(values).length,Object.keys(before.values).length+1);
    console.log(JSON.stringify({status:'PASS',at:new Date().toISOString(),businessWrites:0,GETs:api.audit.length,unchangedResponsesIncludingTimestamps:unchanged,expectedChangedCollections:1,newObjects:{[detailRoute]:values[detailRoute]},audit:api.audit}));
  }
}

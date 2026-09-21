import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const web=process.cwd(),dir=path.join(web,'数据参考/全量录入-2026-09/交叉试录/禁锢目录首次页面录入');
const tool='tools/authoring/reviewed-status-ui.mjs',file=path.join(web,tool);
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const plan=read('01-候选方案.json'),frozen=read('02-冻结请求.json'),sources=read('03-来源摘要.json'),before=read('04-写入前现值.json');
assert.equal(sha(file),'3b509e846436dc84aca6d68f15876de8e53884bb7f9ac376842b79a5231f3ada');
assert.equal(sha(path.join(dir,'02-冻结请求.json')),'c485153628144d59058974c3b1d8ab2b797f5ee1185e4612a6f1c578d6bfac6f');
assert.equal(sources.length,11);
for(const s of sources){const root={web,backend:path.resolve(web,'../damage_backend_dev'),planning:path.resolve(web,'../damage_viewer_project_planning')}[s.root];assert.equal(sha(path.join(root,s.path)),s.sha256);assert.equal(s.actualSha256,s.sha256);}
assert.deepEqual(sources,plan.sourceFiles.map(s=>({...s,actualSha256:s.sha256})));
assert.equal(frozen.sourceSha256,sha(path.join(dir,'03-来源摘要.json')));assert.equal(frozen.baselineSha256,sha(path.join(dir,'04-写入前现值.json')));
assert.deepEqual(plan.body,{statusKey:'root',name:'禁锢',description:'禁锢状态身份；具体持续时间由技能效果生命周期维护，本状态不另设强度数值。',statusKind:'ROOT',status:'ENABLED',sortOrder:20});
assert.deepEqual(frozen.request,{method:'POST',route:'/statuses',detailRoute:'/statuses/root',body:plan.body});
assert.deepEqual(before.audit,[{method:'GET',path:'/statuses',status:200},{method:'GET',path:'/statuses/vertigo',status:200},{method:'GET',path:'/statuses/root',status:404}]);
assert.deepEqual(before.values['/statuses'].items,[before.values['/statuses/vertigo']]);assert.equal(before.values['/statuses'].total,1);assert.equal(before.businessWrites,0);
const required=[tool,'01-候选方案.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'];
const approvedFiles=Object.fromEntries(required.map(n=>[n,sha(n===tool?file:path.join(dir,n))]));
const review={status:'APPROVED',approvedFiles};
const source=fs.readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace('import.meta.url',JSON.stringify(pathToFileURL(file).href));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const run=new AsyncFunction('assert','crypto','fs','path','fileURLToPath','process','console','fetch','AbortSignal',source);
const results=[];
async function scenario(name,mode,mutate,expectedPass){
  const values=structuredClone(before.values),newRow={...plan.body,gameId:'lol',createdAt:'2026-09-19T05:00:00Z',updatedAt:'2026-09-19T05:00:00Z'};
  if(mode==='readback'){values['/statuses'].items.push(newRow);values['/statuses'].total++;values['/statuses/root']=structuredClone(newRow);}
  const writer={status:'PASS',executionMode:'BROWSER_UI_ONLY',businessWritesAttempted:1};
  mutate?.(values,writer);
  const calls=[],logs=[],virtual=new Map(),hidden=new Set(mode==='prepare'?['02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'].map(n=>path.join(dir,n)):[]);
  virtual.set(path.join(dir,'05-独立评审.json'),JSON.stringify(review));virtual.set(path.join(dir,'06-写入与即时回读.json'),JSON.stringify(writer));
  const mockFs={...fs,existsSync:p=>virtual.has(p)||(!hidden.has(p)&&fs.existsSync(p)),readFileSync:(p,encoding)=>virtual.has(p)?encoding?virtual.get(p):Buffer.from(virtual.get(p)):fs.readFileSync(p,encoding),writeFileSync:(p,text,opts)=>{assert.equal(mode,'prepare');assert(hidden.has(p));assert.equal(opts.flag,'wx');assert(!virtual.has(p));virtual.set(p,text);}};
  let error=null;
  try{await run(assert,crypto,mockFs,path,fileURLToPath,{argv:['node',file,mode,dir]},{log:s=>logs.push(JSON.parse(s))},async(url,opts)=>{assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert(url.startsWith(frozen.base));const route=url.slice(frozen.base.length);assert(route==='/statuses'||/^\/statuses\/[a-z][a-z0-9_]*$/.test(route));calls.push({method:opts.method,path:route});const data=values[route];return{status:data?200:404,json:async()=>structuredClone(data??{error:'not found'})};},AbortSignal);}catch(e){error=e.message;}
  assert.equal(error===null,expectedPass,name+': '+error);
  if(expectedPass){assert.equal(logs.length,1);assert.equal(logs[0].GETs,3);if(mode==='readback'){assert.equal(logs[0].unchangedResponsesIncludingTimestamps,1);assert.equal(logs[0].expectedChangedCollections,1);assert.equal(Object.keys(logs[0].newObjects).length,1);}if(mode==='prepare'){const written=JSON.parse(virtual.get(path.join(dir,'02-冻结请求.json')));assert.deepEqual(written.request,frozen.request);}}
  results.push({name,mode,expectedPass,passed:true,mockedGETs:calls.length,result:error??logs[0]});
}
await scenario('准备路径生成同一完整请求且只写独占证据','prepare',null,true);
await scenario('写前完整旧值与缺失新目录','preflight',null,true);
await scenario('正常新目录与原眩晕保持','readback',null,true);
await scenario('旧详情时间戳变化且列表同步仍拒绝','readback',v=>{v['/statuses/vertigo'].updatedAt='2026-09-19T05:01:00Z';v['/statuses'].items[0].updatedAt='2026-09-19T05:01:00Z';},false);
await scenario('列表与详情不一致拒绝','readback',v=>{v['/statuses'].items[1].name='其他';},false);
await scenario('新详情多余业务字段拒绝','readback',v=>{v['/statuses/root'].extra=true;v['/statuses'].items[1].extra=true;},false);
await scenario('新目录种类错误拒绝','readback',v=>{v['/statuses/root'].statusKind='STUN';v['/statuses'].items[1].statusKind='STUN';},false);
await scenario('缺少新目录拒绝','readback',v=>{delete v['/statuses/root'];v['/statuses'].items.pop();v['/statuses'].total--;},false);
await scenario('重复目录标识拒绝','readback',v=>{v['/statuses'].items.push(v['/statuses'].items[1]);v['/statuses'].total++;},false);
await scenario('非页面写入声明拒绝','readback',(_,w)=>{w.executionMode='API';},false);
await scenario('非成功写入声明拒绝','readback',(_,w)=>{w.status='STARTED';},false);
await scenario('写前旧目录漂移拒绝','preflight',v=>{v['/statuses/vertigo'].name='其他';v['/statuses'].items[0].name='其他';},false);
const report={status:'PASS',at:new Date().toISOString(),realHTTP:0,businessWrites:0,method:'原工具源码在同一 JavaScript 引擎执行；仅替换文件读写、参数、输出及 fetch 为内存输入，未修改原文件。',sourceFilesVerified:11,approvedFiles,cases:results};
fs.writeFileSync(path.join(web,'output/seven-hit-review/root-status-ui-offline.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PASS',cases:results.length,realHTTP:0,approvedFiles}));

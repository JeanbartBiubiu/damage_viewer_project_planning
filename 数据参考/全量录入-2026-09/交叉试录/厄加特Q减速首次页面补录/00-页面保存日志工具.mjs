import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const d='数据参考/全量录入-2026-09/交叉试录/厄加特Q减速首次页面补录',mode=process.argv[2],index=Number(process.argv[3]);assert(['before-save','readback'].includes(mode));assert([0,1].includes(index));
const read=n=>JSON.parse(fs.readFileSync(d+'/'+n,'utf8')),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const f=read('02-冻结请求.json'),review=read('05-独立评审.json');assert.equal(review.status,'APPROVED');for(const [p,h] of Object.entries(review.approvedFiles))assert.equal(sha(p.startsWith('tools/')?p:d+'/'+p),h,p);
for(const s of read('03-来源摘要.json'))assert.equal(sha((s.root==='web'?'':'../damage_viewer_project_planning/')+s.path),s.sha256);
const request=f.requests[index],journal=d+'/06-写入与即时回读.json';
const log=fs.existsSync(journal)?read('06-写入与即时回读.json'):{startedAt:new Date().toISOString(),status:'STARTED',executionMode:'BROWSER_UI_ONLY',approvedFiles:review.approvedFiles,businessWritesAttempted:0,postResponseCaptured:false,operations:[],audit:[],preflightGETs:25};
assert.equal(log.status,'STARTED');const response=await fetch(f.base+request.detailRoute,{method:'GET',headers:{Authorization:'Bearer '+crypto.randomUUID()},signal:AbortSignal.timeout(20000)});
log.audit.push({method:'GET',path:request.detailRoute,status:response.status,at:new Date().toISOString()});
if(mode==='before-save'){
  assert.equal(log.businessWritesAttempted,index);assert.equal(log.operations.length,index);assert.equal(response.status,404);assert(!log.pendingRoute);log.businessWritesAttempted++;log.pendingRoute=request.detailRoute;
}else{
  assert.equal(log.businessWritesAttempted,index+1);assert.equal(log.operations.length,index);assert.equal(log.pendingRoute,request.detailRoute);assert.equal(response.status,200);const actual=await response.json();let body=actual;
  if(request.route.endsWith('/effects')){const{gameId,skillKey,createdAt,updatedAt,...rest}=actual;assert.equal(gameId,'lol');assert.equal(skillKey,'urgot_q');for(const x of[createdAt,updatedAt])assert(Number.isFinite(Date.parse(x)));body=rest;}
  assert.deepEqual(body,request.expectedReadback);log.operations.push({method:'BROWSER_FORM_SAVE',route:request.route,detailRoute:request.detailRoute,postResponseCaptured:false,readback:actual});log.pendingRoute=null;
  if(index===1){log.status='PASS';log.finishedAt=new Date().toISOString();}
}
fs.writeFileSync(journal,JSON.stringify(log,null,2)+'\n',{flag:fs.existsSync(journal)?'w':'wx'});console.log({status:mode==='before-save'?'READY_FOR_SINGLE_BROWSER_SAVE':log.status,index,businessWritesByThisTool:0,GETs:1});

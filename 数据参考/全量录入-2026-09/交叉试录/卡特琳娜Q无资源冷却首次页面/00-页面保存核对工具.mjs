import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const dir='数据参考/全量录入-2026-09/交叉试录/卡特琳娜Q无资源冷却首次页面/';
const [mode,indexText]=process.argv.slice(2),index=Number(indexText),plan=JSON.parse(fs.readFileSync(dir+'01-候选方案.json')),review=JSON.parse(fs.readFileSync(dir+'05-独立评审.json'));
assert.equal(review.status,'APPROVED');for(const[p,h]of Object.entries(review.approvedFiles))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p.startsWith('tools/')?p:dir+p)).digest('hex'),h);
assert([0,1].includes(index));const w=plan.requests[index],file=dir+'06-写入与即时回读.json';
const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+w.detailRoute,{headers:{Authorization:'Bearer '+crypto.randomUUID()},signal:AbortSignal.timeout(30000)});const data=await r.json();
const audit={at:new Date().toISOString(),method:'GET',path:w.detailRoute,status:r.status};
if(mode==='before'){
 assert.equal(r.status,404);const journal=index===0?{status:'STARTED',startedAt:new Date().toISOString(),executionMode:'BROWSER_UI_ONLY',businessWritesAttempted:0,operations:[],approvedFiles:review.approvedFiles}:JSON.parse(fs.readFileSync(file));
 assert.equal(journal.operations.length,index);if(index===1)assert(journal.operations[0].readback);
 journal.operations.push({index,method:'POST',route:w.route,detailRoute:w.detailRoute,body:w.body,attempt:1,before:audit,writer:'CUA页面单次保存'});journal.businessWritesAttempted++;journal.pendingRoute=w.detailRoute;
 fs.writeFileSync(file,JSON.stringify(journal,null,2)+'\n',{flag:index===0?'wx':'w'});console.log(JSON.stringify({status:'READY_FOR_SINGLE_UI_SAVE',index}));
}else if(mode==='after'){
 assert.equal(r.status,200);let body=data;if(index===0){const{gameId,skillKey,createdAt,updatedAt,...rest}=data;assert.equal(gameId,'lol');assert.equal(skillKey,'katarina_q');assert(Number.isFinite(Date.parse(createdAt)));assert(Number.isFinite(Date.parse(updatedAt)));body=rest;}
 assert.deepEqual(body,w.expectedReadback);const journal=JSON.parse(fs.readFileSync(file));assert.equal(journal.operations.length,index+1);assert(!journal.operations[index].readback);journal.operations[index].readback=data;journal.operations[index].readbackAudit=audit;journal.pendingRoute=null;if(index===1){journal.status='PASS';journal.finishedAt=new Date().toISOString();}fs.writeFileSync(file,JSON.stringify(journal,null,2)+'\n');console.log(JSON.stringify({status:'PASS',index}));
}else throw new Error('Unknown mode');

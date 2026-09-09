import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const raw=fs.readFileSync(path.join(dir,'写前方案.json')),sha=crypto.createHash('sha256').update(raw).digest('hex');
assert.equal(sha,'e67f35dcb651387c13124c7c4f34bffd823fd91cab1330297da85a994700c43b');
const apply=process.argv[2]==='--apply';assert(!process.argv[2]||apply);if(apply)assert.equal(process.argv[3],sha,'写入必须明确同一方案摘要');
const proposal=JSON.parse(raw),log={startedAt:new Date().toISOString(),sha,apply,records:[],operations:[],success:false};
const out=path.join(dir,(apply?'执行':'只读')+'-'+log.startedAt.replace(/[:.]/g,'-')+'.json');
const persist=()=>fs.writeFileSync(out,JSON.stringify(log,null,2)+'\n');
const pick=(a,e)=>Object.fromEntries(Object.keys(e).map(k=>[k,a[k]??null]));
const norm=v=>Array.isArray(v)?v.map(norm):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['createdAt','updatedAt'].includes(k)).map(([k,x])=>[k,norm(x)])):v;
function same(a,b){try{assert.deepEqual(a,b);return true;}catch{return false;}}
async function request(route,method='GET',body){
 try{const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{method,headers:{Authorization:'Bearer local-entry',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const text=await r.text(),data=text?JSON.parse(text):null;log.records.push({route,method,status:r.status,data});persist();return {status:r.status,data};}
 catch(e){log.error={route,method,message:e.message};persist();throw e;}
}
const kinds={parameters:'parameterKey',formulas:'formulaKey',effects:'effectKey',processes:'processKey','internal-states':'stateKey','trigger-rules':'ruleKey'};
function walk(v,fn){if(v&&typeof v==='object'){fn(v);for(const x of Object.values(v))walk(x,fn);}}
async function assertUnreferenced(op){for(const [kind,id]of Object.entries(kinds)){if(kind==='parameters')continue;const l=await request(`/skills/${op.skillKey}/${kind}`);assert.equal(l.status,200);for(const row of l.data){const d=await request(`/skills/${op.skillKey}/${kind}/${row[id]}`);assert.equal(d.status,200);walk(d.data,n=>assert(n.parameterKey!==op.key,op.route+' still referenced'));}}}
try{
 // 整批先检：允许已同值完成的请求，遇到异值不覆盖。所有读取仅本方案9个技能。
 for(const op of proposal.operations){const c=await request(op.route);if(op.method==='DELETE'&&c.status===404)continue;assert.equal(c.status,200,op.route);assert(same(pick(c.data,op.before),op.before)||(op.after&&same(pick(c.data,op.after),op.after)),op.route+' current conflict');}
 if(apply){
  assert(!fs.existsSync(path.join(dir,'回补完成.json')),'完成后禁止再写，使用独立GET复核');
  for(const op of proposal.operations){
   const c=await request(op.route);let status='already_same';
   if(op.method==='DELETE'){
    if(c.status!==404){assert.equal(c.status,200);assert.deepEqual(pick(c.data,op.before),op.before);await assertUnreferenced(op);const w=await request(op.route,'DELETE');assert.equal(w.status,204);assert.equal((await request(op.route)).status,404);status='deleted';}
   }else{
    assert.equal(c.status,200);if(!same(pick(c.data,op.after),op.after)){assert.deepEqual(pick(c.data,op.before),op.before);const body=structuredClone(op.after);delete body[{skill:'skillKey',parameters:'parameterKey',formulas:'formulaKey'}[op.kind]];const w=await request(op.route,'PUT',body);assert.equal(w.status,200,op.route);const after=await request(op.route);assert.equal(after.status,200);assert.deepEqual(pick(after.data,op.after),op.after);status='updated';}
   }
   log.operations.push({route:op.route,method:op.method,status});persist();
  }
  // 再读写前全部路由：列表稳定键集合与非本次修改的完整字段都须保留。
  for(const old of proposal.reads){const op=proposal.operations.find(o=>o.route===old.route);const got=await request(old.route);if(op?.method==='DELETE'){assert.equal(got.status,404);continue;}assert.equal(got.status,200,old.route);
   if(op){assert.deepEqual(pick(got.data,op.after),op.after);continue;}
   const parts=old.route.split('/'),listKind=parts.length===4&&kinds[parts[3]]?parts[3]:null;
   if(listKind){const id=kinds[listKind],removed=new Set(proposal.operations.filter(o=>o.method==='DELETE'&&o.skillKey===parts[2]&&o.kind===listKind).map(o=>o.key));assert.deepEqual(got.data.map(x=>x[id]).sort(),old.actual.filter(x=>!removed.has(x[id])).map(x=>x[id]).sort());}
   else assert.deepEqual(norm(got.data),norm(old.actual),old.route+' protected change');
  }
 }
 log.success=true;log.finishedAt=new Date().toISOString();persist();
 if(apply)fs.writeFileSync(path.join(dir,'回补完成.json'),JSON.stringify({at:log.finishedAt,sha,executionFile:path.basename(out),puts:log.operations.filter(o=>o.status==='updated').length,deletes:log.operations.filter(o=>o.status==='deleted').length,readRequests:log.records.filter(r=>r.method==='GET').length,allSnapshotsProtected:true},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({success:true,apply,operations:log.operations.length,requests:log.records.length,file:path.basename(out)}));
}catch(e){log.error={...(log.error||{}),message:e.message};persist();throw e;}

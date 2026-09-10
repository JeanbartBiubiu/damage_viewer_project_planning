import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import{fileURLToPath}from'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));const read=n=>JSON.parse(fs.readFileSync(here+'/'+n));
const sha=n=>crypto.createHash('sha256').update(fs.readFileSync(here+'/'+n)).digest('hex');
assert.equal(sha('最小修正计划.json'),'69982f7c32978b2d075b1b21b66fa3f35f137f0958e2b66d8713ec5c2eacb4cb');
const mode=process.argv[2];assert(['--apply','--verify'].includes(mode));assert.equal(process.argv.length,3);
const plan=read('最小修正计划.json'),before=read('写前保护快照.json');assert.equal(plan.requests.length,6);assert.equal(before.calls.length,31);
const strip=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k)));
for(const x of plan.requests){assert.equal(x.method,'PUT');const original=strip(x.before);assert.deepEqual({...x.body,description:original.description},original);}
const run=mode==='--apply'?'实际修正':'独立GET',journal=here+'/'+run+'.jsonl';const lock=here+'/写入锁.json';const calls=[];const report={at:new Date().toISOString(),mode,planSha256:sha('最小修正计划.json'),apiWrites:0,confirmed:0,passed:false};
if(mode==='--apply')fs.writeFileSync(lock,JSON.stringify({status:'STARTED'})+'\n',{flag:'wx'});else assert.equal(read('写入锁.json').status,'COMPLETED');
assert(!fs.existsSync(journal));
function log(x){fs.appendFileSync(journal,JSON.stringify(x)+'\n');}
async function req(route,method='GET',body){assert(route.startsWith('/skills/nilah_r'));if(method!=='GET')assert(mode==='--apply'&&plan.requests.some(x=>x.route===route&&JSON.stringify(x.body)===JSON.stringify(body)));
log({at:new Date().toISOString(),phase:'BEFORE',route,method,body});const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{method,headers:{Authorization:'Bearer local-entry','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=await r.json();const entry={route,method,status:r.status,data};calls.push(entry);log({phase:'AFTER',...entry});assert.equal(r.status,200,route);if(method==='PUT')report.apiWrites++;return data;}
async function protect(after){for(const old of before.calls){const actual=await req(old.route);const p=plan.requests.find(x=>x.route===old.route);if(p&&after)assert.deepEqual(strip(actual),p.body,old.route);else if(Array.isArray(actual)&&after){const expected=structuredClone(old.data);for(const row of expected){const id=row.parameterKey??row.formulaKey;const item=plan.requests.find(x=>x.route===old.route+'/'+id);if(item&&Object.hasOwn(row,'description'))row.description=item.body.description;}assert.deepEqual(actual.map(strip),expected.map(strip),old.route);}else assert.deepEqual(strip(actual??{}),strip(old.data??{}),old.route);}}
try{
  if(mode==='--apply'){await protect(false);for(const x of plan.requests){assert.deepEqual(await req(x.route),x.before,x.route);await req(x.route,'PUT',x.body);assert.deepEqual(strip(await req(x.route)),x.body);report.confirmed++;fs.writeFileSync(lock,JSON.stringify({status:'RUNNING',confirmed:report.confirmed})+'\n');}await protect(true);fs.writeFileSync(lock,JSON.stringify({status:'COMPLETED',confirmed:6})+'\n');}
  else await protect(true);
  report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;if(mode==='--apply')fs.writeFileSync(lock,JSON.stringify({status:'STOPPED',confirmed:report.confirmed})+'\n');}
report.GETs=calls.filter(x=>x.method==='GET').length;report.calls=calls;report.finishedAt=new Date().toISOString();fs.writeFileSync(here+'/'+run+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,calls:undefined}));

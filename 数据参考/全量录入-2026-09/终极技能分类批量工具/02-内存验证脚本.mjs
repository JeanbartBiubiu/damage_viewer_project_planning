import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const original={read:fs.readFileSync.bind(fs),write:fs.writeFileSync.bind(fs),exists:fs.existsSync.bind(fs)},originalFetch=globalThis.fetch,originalLog=console.log;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),bytes=o=>Buffer.from(JSON.stringify(o,null,2)+'\n');
const writer=path.resolve('tools/authoring/append-reviewed-ultimate-categories.mjs'),writerKey='tools/authoring/append-reviewed-ultimate-categories.mjs',virtual=path.resolve('数据参考/内存工具验证');
const actualDir='数据参考/全量录入-2026-09/交叉试录/其余主R终极技能分类补录',actual=n=>JSON.parse(original.read(actualDir+'/'+n,'utf8'));
const results=[];
for(const scenario of ['normal','baseline-drift','existing-journal','invalid-write-json']){
 const plan=actual('01-分类计划.json');plan.skillKeys=plan.skillKeys.slice(0,2);
 const baseline=actual('04-写入前现值.json');baseline.values=Object.fromEntries(Object.entries(baseline.values).filter(([k])=>k==='/skill-categories'||plan.skillKeys.some(x=>k==='/skills/'+x)));baseline.audit=baseline.audit.filter(x=>Object.hasOwn(baseline.values,x.path));
 const source=JSON.parse(original.read(plan.sourceCandidatesFile,'utf8'));
 const sources=[{path:plan.sourceCandidatesFile,sha256:plan.sourceCandidatesSha256},...plan.skillKeys.flatMap(k=>source.eligible.find(x=>x.skillKey===k).sourceFiles)];
 const requests=actual('02-冻结请求.json').requests.filter(x=>plan.skillKeys.some(k=>x.route==='/skills/'+k));
 const store=new Map([['01-分类计划.json',bytes(plan)],['03-来源摘要.json',bytes(sources)],['04-写入前现值.json',bytes(baseline)]]);
 const frozen={base:baseline.base,requests,reused:[],manualReview:[],sourceSha256:hash(store.get('03-来源摘要.json')),baselineSha256:hash(store.get('04-写入前现值.json'))};store.set('02-冻结请求.json',bytes(frozen));
 const approvedFiles={[writerKey]:hash(original.read(writer))};for(const n of ['01-分类计划.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'])approvedFiles[n]=hash(store.get(n));store.set('05-独立评审.json',bytes({status:'APPROVED',approvedFiles}));
 if(scenario==='existing-journal')store.set('06-写入与即时回读.json',bytes({status:'STARTED'}));
 const current=structuredClone(baseline.values);if(scenario==='baseline-drift')current[requests[0].route].name+='模拟并发修改';
 let simulatedGETs=0,simulatedPUTs=0,error;
 const localName=file=>{const p=path.resolve(String(file));return p.startsWith(virtual+path.sep)?path.relative(virtual,p):null;};
 fs.readFileSync=(file,encoding)=>{const n=localName(file);if(n!==null){assert(store.has(n));return encoding==='utf8'?store.get(n).toString('utf8'):store.get(n);}return original.read(file,encoding);};
 fs.existsSync=file=>{const n=localName(file);return n!==null?store.has(n):original.exists(file);};
 fs.writeFileSync=(file,data,options)=>{const n=localName(file);assert(n!==null,'禁止写出内存空间');if(options?.flag==='wx'&&store.has(n))throw Error('EEXIST');store.set(n,Buffer.from(data));};
 globalThis.fetch=async(url,options={})=>{const route=String(url).slice(baseline.base.length);assert(Object.hasOwn(current,route));if(options.method==='PUT'){
  simulatedPUTs++;const request=requests.find(x=>x.route===route);assert(request);assert.deepEqual(JSON.parse(options.body),request.body);
  current[route]={...current[route],...request.body,updatedAt:'2030-01-01T00:00:00.000Z'};
  return new Response(scenario==='invalid-write-json'?'bad-json':JSON.stringify(current[route]),{status:200,headers:{'content-type':'application/json'}});
 }simulatedGETs++;return new Response(JSON.stringify(current[route]),{status:200,headers:{'content-type':'application/json'}});};
 process.argv=['node',writer,'write',virtual];process.env.DAMAGE_APPROVED_BATCH_SHA=hash(store.get('02-冻结请求.json'));console.log=()=>{};
 try{await import(pathToFileURL(writer).href+'?case='+scenario);}catch(e){error=e;}
 finally{fs.readFileSync=original.read;fs.writeFileSync=original.write;fs.existsSync=original.exists;globalThis.fetch=originalFetch;console.log=originalLog;delete process.env.DAMAGE_APPROVED_BATCH_SHA;}
 const journal=store.has('06-写入与即时回读.json')?JSON.parse(store.get('06-写入与即时回读.json')):null;
 if(scenario==='normal'){assert(!error,error?.message);assert.equal(simulatedPUTs,2);assert.equal(journal.status,'PASS');assert.equal(journal.operations.filter(x=>x.readback).length,2);}
 if(scenario==='baseline-drift'||scenario==='existing-journal'){assert(error);assert.equal(simulatedPUTs,0);}
 if(scenario==='invalid-write-json'){assert(error);assert.equal(simulatedPUTs,1);assert.equal(journal.status,'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');assert.equal(journal.operations[0].responseAudit.status,200);assert(!journal.operations[0].readback);assert.equal(journal.pendingRoute,requests[0].route);}
 results.push({scenario,status:'PASS',simulatedGETs,simulatedPUTs,realHTTP:0,businessWrites:0});
}
originalLog(JSON.stringify({status:'PASS',at:new Date().toISOString(),writerSha256:hash(original.read(writer)),cases:results,realHTTP:0,businessWrites:0}));

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const web=process.cwd(),tool=path.join(web,'tools/authoring/update-reviewed-damage-vamp.mjs');
const virtual=path.join(web,'数据参考/__offline_vamp_guards__');
const originals={read:fs.readFileSync,write:fs.writeFileSync,exists:fs.existsSync,fetch:globalThis.fetch,log:console.log,argv:process.argv,gate:process.env.DAMAGE_APPROVED_BATCH_SHA};
const normalize=p=>path.resolve(String(p));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const clone=structuredClone,stamp='2026-09-19T00:00:00Z';
const route='/skills/offline_skill/effects/hit';
const oldEffect={gameId:'lol',skillKey:'offline_skill',effectKey:'hit',name:'离线伤害',description:'旧说明',sortOrder:10,lifecycle:null,createdAt:stamp,updatedAt:stamp,results:[{resultKey:'damage',name:'伤害',description:null,sortOrder:10,resultType:'DAMAGE',target:'TARGET',lifecycleBehavior:null,spellShieldBlockScope:'RESULT',valueRule:{value:{kind:'FIXED',value:100},fixedMultiplier:1,fixedMinValue:0,fixedMaxValue:null},detail:{damageTypeKey:'magic',deliveryKind:'SKILL',originKind:'DIRECT',critical:{mode:'DISALLOWED',multiplierValue:null},vampRules:[]}}]};
const summary=e=>({gameId:e.gameId,skillKey:e.skillKey,effectKey:e.effectKey,name:e.name,description:e.description,sortOrder:e.sortOrder,lifecycleEnabled:false,resultCount:1,createdAt:e.createdAt,updatedAt:e.updatedAt});
const initialDb={'/skills/offline_skill':{gameId:'lol',skillKey:'offline_skill',status:'ENABLED',createdAt:stamp,updatedAt:stamp},'/skills/offline_skill/parameters':[{parameterKey:'amount',valueMode:'FIXED',fixedValue:100}],'/skills/offline_skill/parameters/amount':{parameterKey:'amount',valueMode:'FIXED',fixedValue:100},'/skills/offline_skill/formulas':[],'/skills/offline_skill/effects':[summary(oldEffect)],[route]:oldEffect,'/skills/offline_skill/processes':[],'/skills/offline_skill/internal-states':[],'/skills/offline_skill/trigger-rules':[]};
const plan={changes:[{skillKey:'offline_skill',effectKey:'hit',resultKey:'damage',route,description:'明确资格'}],sourceFiles:[{root:'web',path:'tools/authoring/update-reviewed-damage-vamp.mjs'}]};
let files=new Map(),db=clone(initialDb),audit=[],logs=[],sequence=0,jsonFailureOnPut=false;
const fileKey=name=>path.join(virtual,name);
const putFile=(name,j)=>files.set(fileKey(name),Buffer.from(JSON.stringify(j,null,2)+'\n'));
const getFile=name=>JSON.parse(files.get(fileKey(name)).toString('utf8'));
const putCount=()=>audit.filter(x=>x.method==='PUT').length;
const cases=[];
function reset(){files=new Map();db=clone(initialDb);audit=[];logs=[];jsonFailureOnPut=false;putFile('01-纠错计划.json',clone(plan));delete process.env.DAMAGE_APPROVED_BATCH_SHA;}
fs.readFileSync=(p,opts)=>{const key=normalize(p);if(files.has(key)){const b=files.get(key);return typeof opts==='string'||opts?.encoding?b.toString(typeof opts==='string'?opts:opts.encoding):Buffer.from(b);}if(key.startsWith(virtual+path.sep))throw Object.assign(new Error('virtual ENOENT'),{code:'ENOENT'});return originals.read(p,opts);};
fs.existsSync=p=>{const key=normalize(p);return key.startsWith(virtual+path.sep)?files.has(key):originals.exists(p);};
fs.writeFileSync=(p,value,opts)=>{const key=normalize(p);assert(key.startsWith(virtual+path.sep),'工具不得写入真实文件');if(opts?.flag==='wx'&&files.has(key))throw Object.assign(new Error('virtual EEXIST'),{code:'EEXIST'});files.set(key,Buffer.from(value));};
console.log=(...args)=>logs.push(args.join(' '));
globalThis.fetch=async(url,options)=>{assert(String(url).startsWith('http://127.0.0.1:8080/api/admin/games/lol/'));const p=String(url).slice('http://127.0.0.1:8080/api/admin/games/lol'.length),method=options?.method??'GET';audit.push({path:p,method});assert(Object.hasOwn(db,p));if(method==='PUT'){assert.equal(p,route);const body=JSON.parse(options.body);db[p]={...db[p],...body,updatedAt:'2026-09-19T00:00:01Z'};db['/skills/offline_skill/effects']=[summary(db[p])];if(jsonFailureOnPut)return {status:200,json:async()=>{throw new SyntaxError('synthetic invalid JSON');}};}else assert.equal(method,'GET');return {status:200,json:async()=>clone(db[p])};};
async function run(mode){process.argv=['node',tool,mode,virtual];await import(pathToFileURL(tool).href+'?offlineCase='+(++sequence));return logs.length?JSON.parse(logs.at(-1)):null;}
function approve(){const approvedFiles={};for(const f of ['tools/authoring/update-reviewed-damage-vamp.mjs','01-纠错计划.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'])approvedFiles[f]=sha(f.startsWith('tools/')?originals.read(path.join(web,f)):files.get(fileKey(f)));putFile('05-独立评审.json',{status:'APPROVED',approvedFiles});process.env.DAMAGE_APPROVED_BATCH_SHA=approvedFiles['02-冻结请求.json'];}
async function prepared(){reset();await run('prepare');approve();}
async function verify(name,fn){try{await fn();cases.push({name,status:'PASS'});}catch(error){cases.push({name,status:'FAIL',error:error.message});}}
try{
  await verify('成功写入及独立回读只允许吸血资格和父说明变化',async()=>{await prepared();const old=clone(db[route]);await run('write');const out=await run('readback');assert.equal(putCount(),1);assert.equal(out.changedDetails[route].createdAt,old.createdAt);assert.equal(out.expectedChangedCollections,1);assert.equal(out.unchangedResponsesIncludingTimestamps,7);const actual=clone(db[route]);actual.description=old.description;actual.updatedAt=old.updatedAt;actual.results[0].detail.vampRules=[];assert.deepEqual(actual,old);});
  await verify('已完成写入不可重放',async()=>{await prepared();await run('write');const n=putCount();await assert.rejects(run('write'));assert.equal(putCount(),n);});
  await verify('即使数据恢复旧值，已存在06也拒绝重放',async()=>{await prepared();await run('write');db=clone(initialDb);const n=putCount();await assert.rejects(run('write'));assert.equal(putCount(),n);});
  await verify('获批文件散列漂移在网络前拒绝',async()=>{await prepared();files.set(fileKey('01-纠错计划.json'),Buffer.concat([files.get(fileKey('01-纠错计划.json')),Buffer.from(' ')]));const n=audit.length;await assert.rejects(run('write'));assert.equal(audit.length,n);assert.equal(putCount(),0);});
  await verify('错误批准环境散列拒绝业务写入',async()=>{await prepared();process.env.DAMAGE_APPROVED_BATCH_SHA='invalid';await assert.rejects(run('write'));assert.equal(putCount(),0);assert(!files.has(fileKey('06-写入与即时回读.json')));});
  await verify('目标旧吸血资格非空时不制作纠错请求',async()=>{reset();db[route].results[0].detail.vampRules=[{vampType:'LIFE_STEAL'}];await assert.rejects(run('prepare'));assert.equal(putCount(),0);});
  await verify('非法资源路径在网络前拒绝',async()=>{reset();const p=clone(plan);p.changes[0].route='/skills/offline_skill/parameters/x';putFile('01-纠错计划.json',p);await assert.rejects(run('prepare'));assert.equal(audit.length,0);});
  await verify('即使错误批准完整请求中的额外数值改动也会拒绝',async()=>{await prepared();const f=getFile('02-冻结请求.json');f.requests[0].body.results[0].valueRule.fixedMultiplier=2;putFile('02-冻结请求.json',f);approve();const n=audit.length;await assert.rejects(run('write'));assert.equal(audit.length,n);assert.equal(putCount(),0);});
  await verify('独立回读发现非目标参数变化',async()=>{await prepared();await run('write');db['/skills/offline_skill/parameters/amount'].fixedValue=999;await assert.rejects(run('readback'));assert.equal(putCount(),1);});
  await verify('响应无法解析时保留写入尝试和HTTP审计',async()=>{await prepared();jsonFailureOnPut=true;await assert.rejects(run('write'));const r=getFile('06-写入与即时回读.json');assert.equal(r.status,'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');assert.equal(r.businessWritesAttempted,1);assert.equal(r.pendingRoute,route);assert.equal(r.audit.filter(x=>x.method==='PUT').length,1);assert.equal(putCount(),1);});
}finally{
  fs.readFileSync=originals.read;fs.writeFileSync=originals.write;fs.existsSync=originals.exists;globalThis.fetch=originals.fetch;console.log=originals.log;process.argv=originals.argv;
  if(originals.gate===undefined)delete process.env.DAMAGE_APPROVED_BATCH_SHA;else process.env.DAMAGE_APPROVED_BATCH_SHA=originals.gate;
}
const report={at:new Date().toISOString(),status:cases.every(x=>x.status==='PASS')?'PASS':'FAIL',scope:'在内存文件与fetch替身中执行真实工具；业务HTTP请求0，真实业务写入0，不代表后端/浏览器/战斗运行',toolSha256:sha(fs.readFileSync(tool)),cases};
fs.mkdirSync('output/damage-vamp-guards',{recursive:true});fs.writeFileSync('output/damage-vamp-guards/report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(report.status!=='PASS')process.exitCode=1;

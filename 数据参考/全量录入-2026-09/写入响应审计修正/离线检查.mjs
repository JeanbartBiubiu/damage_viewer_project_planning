import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const web=process.cwd();
const out=path.join(web,'output','authoring-response-audit-fix');
const appendOld=path.join(web,'tools/authoring/append-reviewed-skill-components-v2.mjs');
const appendNew=path.join(web,'tools/authoring/append-reviewed-skill-components-v3.mjs');
const descriptionsOld=path.join(web,'tools/authoring/update-reviewed-descriptions.mjs');
const descriptionsNew=path.join(web,'tools/authoring/update-reviewed-descriptions-v2.mjs');
const virtualRoot=path.resolve(web,'数据参考/__offline_authoring_response_audit_fix__');
const base='http://127.0.0.1:8080/api/admin/games/lol';
const originals={
  read:fs.readFileSync,
  write:fs.writeFileSync,
  exists:fs.existsSync,
  fetch:globalThis.fetch,
  log:console.log,
  argv:[...process.argv],
  gate:process.env.DAMAGE_APPROVED_BATCH_SHA
};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const clone=structuredClone;
const normalize=p=>path.resolve(String(p));
const files=new Map();
let httpCalls=0;
let realHTTP=0;
let importSequence=0;
let currentFetch=null;
let currentLogs=[];
const cases=[];
const rawFailures=[];

function key(name){return normalize(name);}
function virtualFile(name){return path.join(virtualRoot,name);}
function putFile(name,value){files.set(key(virtualFile(name)),Buffer.from(JSON.stringify(value,null,2)+'\n'));}
function getFile(name){return JSON.parse(files.get(key(virtualFile(name))).toString('utf8'));}
function resetFiles(){files.clear();}
function installVirtualFs(){
  fs.readFileSync=(file,options)=>{
    const resolved=key(file);
    if(files.has(resolved)){
      const bytes=files.get(resolved);
      if(typeof options==='string')return bytes.toString(options);
      if(options&&typeof options==='object'&&options.encoding)return bytes.toString(options.encoding);
      return Buffer.from(bytes);
    }
    if(resolved===virtualRoot||resolved.startsWith(virtualRoot+path.sep))throw Object.assign(new Error(`virtual ENOENT: ${file}`),{code:'ENOENT'});
    return originals.read(file,options);
  };
  fs.writeFileSync=(file,value,options)=>{
    const resolved=key(file);assert(resolved===virtualRoot||resolved.startsWith(virtualRoot+path.sep),'工具不得写入真实文件');
    if(options?.flag==='wx'&&files.has(resolved))throw Object.assign(new Error(`virtual EEXIST: ${file}`),{code:'EEXIST'});
    files.set(resolved,Buffer.from(value));
  };
  fs.existsSync=file=>{
    const resolved=key(file);
    if(resolved===virtualRoot||resolved.startsWith(virtualRoot+path.sep))return files.has(resolved);
    return originals.exists(file);
  };
}
function textLines(file){return originals.read(file,'utf8').replaceAll('\r\n','\n').split('\n');}
function exactLineChanges(oldFile,newFile,expected){
  const oldLines=textLines(oldFile),newLines=textLines(newFile);
  assert.equal(newLines.length,oldLines.length,`${path.basename(newFile)} 行数变化`);
  const actual=[];
  for(let i=0;i<oldLines.length;i++)if(oldLines[i]!==newLines[i])actual.push({line:i+1,old:oldLines[i],new:newLines[i]});
  assert.deepEqual(actual,expected,`${path.basename(newFile)} 超出允许的最小差异`);
  return {lineCount:oldLines.length,changedLines:actual.map(x=>x.line)};
}
function nodeCheck(file){
  const result=spawnSync(process.execPath,['--check',file],{cwd:web,encoding:'utf8'});
  assert.equal(result.status,0,`${path.basename(file)} node --check 失败：${result.stderr||result.stdout}`);
  return {status:'PASS',file:path.relative(web,file)};
}
function setGate(value){
  if(value===undefined)delete process.env.DAMAGE_APPROVED_BATCH_SHA;
  else process.env.DAMAGE_APPROVED_BATCH_SHA=value;
}
function response(status,data,failJson=false){
  return {status,json:async()=>{if(failJson)throw new SyntaxError('synthetic invalid JSON');return clone(data);}};
}
function setDbEntry(db,route,value){db.set(route,clone(value));}
function installFetch(handler){
  currentFetch=handler;
  globalThis.fetch=async(...args)=>{
    httpCalls+=1;
    return handler(...args);
  };
}
function makeAppendFixture(){
  const stamp='2026-09-19T00:00:00.000Z';
  const route='/skills/offline_skill/parameters';
  const detailRoute=route+'/offline_param';
  const body={parameterKey:'offline_param',name:'离线参数',description:'离线验证参数',valueType:'INTEGER',valueMode:'FIXED',fixedValue:1,levelValues:null,sortOrder:10};
  const plan={
    targets:[{skillKey:'offline_skill',ownerKey:'offline_owner'}],
    requests:[{method:'POST',route,body,expectedReadback:{...body},detailRoute}],
    sourceFiles:[{root:'web',path:'tools/authoring/append-reviewed-skill-components-v3.mjs',sha256:sha(originals.read(appendNew))}]
  };
  const db=new Map();
  setDbEntry(db,'/skills/offline_skill',{gameId:'lol',skillKey:'offline_skill',status:'ENABLED',createdAt:stamp,updatedAt:stamp});
  setDbEntry(db,'/characters/offline_owner',{gameId:'lol',characterKey:'offline_owner'});
  for(const routeName of ['/characters/offline_owner/attributes','/characters/offline_owner/representative-image','/skills/offline_skill/representative-image','/character-skill-relations?characterKey=offline_owner','/character-skill-relations?skillKey=offline_skill','/skills/offline_skill/parameters','/skills/offline_skill/formulas','/skills/offline_skill/effects','/skills/offline_skill/processes','/skills/offline_skill/internal-states','/skills/offline_skill/trigger-rules'])setDbEntry(db,routeName,[]);
  let failPostJson=false;
  const calls=[];
  installFetch(async(url,options={})=>{
    const full=String(url);assert(full.startsWith(base+'/'));const routeName=full.slice(base.length);const method=options.method||'GET';
    assert(method==='GET'||method==='POST');
    if(method==='GET'){
      if(routeName===detailRoute&&!db.has(routeName)){calls.push({method,path:routeName,status:404});return response(404,{error:'NOT_FOUND'});}
      assert(db.has(routeName),`追加工具访问未建模路由 ${routeName}`);calls.push({method,path:routeName,status:200});return response(200,db.get(routeName));
    }
    assert.equal(routeName,route);const requestBody=JSON.parse(options.body);assert.deepEqual(requestBody,body);
    const actual={...requestBody,gameId:'lol',skillKey:'offline_skill',createdAt:stamp,updatedAt:'2026-09-19T00:00:01.000Z'};
    setDbEntry(db,detailRoute,actual);setDbEntry(db,route,[actual]);calls.push({method,path:route,status:201});return response(201,actual,failPostJson);
  });
  return {tool:appendNew,virtual:virtualRoot,plan,db,route,detailRoute,calls,set failPostJson(value){failPostJson=value;},get failPostJson(){return failPostJson;}};
}
function makeDescriptionFixture(){
  const stamp='2026-09-19T00:00:00.000Z';
  const route='/skills/offline_skill/parameters/amount';
  const parameter={gameId:'lol',skillKey:'offline_skill',parameterKey:'amount',name:'基础数量',description:'旧说明',valueType:'INTEGER',valueMode:'FIXED',fixedValue:100,levelValues:null,sortOrder:10,createdAt:stamp,updatedAt:stamp};
  const skill={gameId:'lol',skillKey:'offline_skill',name:'离线技能',description:'技能说明',maxLevel:1,status:'ENABLED',sortOrder:10,skillCategoryKeys:[],createdAt:stamp,updatedAt:stamp};
  const plan={
    changes:[{skillKey:'offline_skill',kind:'parameter',route,description:'新说明'}],
    sourceFiles:[{root:'web',path:'tools/authoring/update-reviewed-descriptions-v2.mjs',sha256:sha(originals.read(descriptionsNew))}]
  };
  const db=new Map();setDbEntry(db,'/skills/offline_skill',skill);setDbEntry(db,'/skills/offline_skill/parameters',[parameter]);setDbEntry(db,route,parameter);
  for(const kind of ['formulas','effects','processes','internal-states','trigger-rules'])setDbEntry(db,'/skills/offline_skill/'+kind,[]);
  let failPutJson=false,driftCreatedAt=false;
  const calls=[];
  installFetch(async(url,options={})=>{
    const full=String(url);assert(full.startsWith(base+'/'));const routeName=full.slice(base.length);const method=options.method||'GET';assert(method==='GET'||method==='PUT');
    if(method==='GET'){assert(db.has(routeName),`说明工具访问未建模路由 ${routeName}`);calls.push({method,path:routeName,status:200});return response(200,db.get(routeName));}
    assert.equal(routeName,route);const requestBody=JSON.parse(options.body);const old=db.get(routeName);const actual={...old,...requestBody,updatedAt:'2026-09-19T00:00:01.000Z'};if(driftCreatedAt)actual.createdAt='2026-09-19T00:00:02.000Z';setDbEntry(db,route,actual);setDbEntry(db,'/skills/offline_skill/parameters',[actual]);calls.push({method,path:route,status:200});return response(200,actual,failPutJson);
  });
  return {tool:descriptionsNew,virtual:virtualRoot,plan,db,route,calls,set failPutJson(value){failPutJson=value;},get failPutJson(){return failPutJson;},set driftCreatedAt(value){driftCreatedAt=value;},get driftCreatedAt(){return driftCreatedAt;}};
}
async function runTool(tool,mode,virtual){
  currentLogs=[];console.log=(...args)=>currentLogs.push(args.join(' '));process.argv=['node',tool,mode,virtual];
  try{await import(pathToFileURL(tool).href+'?offlineResponseAuditFix='+(++importSequence));return {error:null,logs:[...currentLogs]};}
  catch(error){return {error,logs:[...currentLogs]};}
}
function approveAppend(fixture){
  const approvedFiles={};for(const file of ['tools/authoring/append-reviewed-skill-components-v3.mjs','01-候选方案.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'])approvedFiles[file]=sha(file.startsWith('tools/')?originals.read(path.join(web,file)):files.get(key(virtualFile(file))));
  putFile('05-独立评审.json',{status:'APPROVED',approvedFiles});setGate(approvedFiles['02-冻结请求.json']);
}
function approveDescriptions(){
  const approvedFiles={};for(const file of ['tools/authoring/update-reviewed-descriptions-v2.mjs','01-纠错计划.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'])approvedFiles[file]=sha(file.startsWith('tools/')?originals.read(path.join(web,file)):files.get(key(virtualFile(file))));
  putFile('05-独立评审.json',{status:'APPROVED',approvedFiles});setGate(approvedFiles['02-冻结请求.json']);
}
async function verify(name,fn){
  try{await fn();cases.push({name,status:'PASS'});}
  catch(error){const item={name,status:'FAIL',error:error.message};cases.push(item);rawFailures.push({name,error:{name:error.name,message:error.message,stack:error.stack}});}
}

let staticAppend,staticDescriptions,nodeChecks;
try{
  staticAppend=exactLineChanges(appendOld,appendNew,[
    {line:7,old:'// 本版在已评审追加流程上支持新增参数；首次真实写入后保持文件字节不变。',new:'// 本版在已评审追加流程上支持新增参数，并先保存响应审计再解析响应；首次真实写入后保持文件字节不变。'},
    {line:10,old:"const executorKey = 'tools/authoring/append-reviewed-skill-components-v2.mjs';",new:"const executorKey = 'tools/authoring/append-reviewed-skill-components-v3.mjs';"},
    {line:53,old:'    const data = await r.json(); audit.push({ method, path: route, status: r.status }); return { status: r.status, data };',new:'    audit.push({ method, path: route, status: r.status }); const data = await r.json(); return { status: r.status, data };'}
  ]);
  staticDescriptions=exactLineChanges(descriptionsOld,descriptionsNew,[
    {line:7,old:'// 复用既有批次的摘要评审、定点预检与防重放，仅合并普通说明纠错的重复执行代码。',new:'// 普通说明纠错工具 v2：复用既有批次的摘要评审、定点预检与防重放，并先保存响应审计再解析响应。'},
    {line:16,old:"const fileHash=name=>sha(fs.readFileSync(name==='tools/authoring/update-reviewed-descriptions.mjs'?executor:path.join(here,name)));",new:"const fileHash=name=>sha(fs.readFileSync(name==='tools/authoring/update-reviewed-descriptions-v2.mjs'?executor:path.join(here,name)));"},
    {line:17,old:"const noTimes=x=>Array.isArray(x)?x.map(noTimes):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>!['createdAt','updatedAt'].includes(k)).map(([k,v])=>[k,noTimes(v)])):x;",new:"const sameIgnoringUpdated=(actual,expected)=>{assert(typeof actual.updatedAt==='string'&&Number.isFinite(Date.parse(actual.updatedAt)));assert.deepEqual({...actual,updatedAt:expected.updatedAt},expected);};"},
    {line:36,old:'    const data=await r.json();audit.push({method,path:route,status:r.status});return {status:r.status,data};',new:'    audit.push({method,path:route,status:r.status});const data=await r.json();return {status:r.status,data};'},
    {line:53,old:"const required=['tools/authoring/update-reviewed-descriptions.mjs','01-纠错计划.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'];",new:"const required=['tools/authoring/update-reviewed-descriptions-v2.mjs','01-纠错计划.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'];"},
    {line:78,old:"      const actual=await api.get(request.route);assert.deepEqual(noTimes(actual),noTimes(request.expectedReadback),'即时回读不一致');",new:'      const actual=await api.get(request.route);sameIgnoringUpdated(actual,request.expectedReadback);'}
  ]);
  nodeChecks=[nodeCheck(appendNew),nodeCheck(descriptionsNew)];
  installVirtualFs();

  resetFiles();setGate(undefined);const append=makeAppendFixture();putFile('01-候选方案.json',append.plan);
  await verify('追加工具响应坏JSON仍保留06 pendingRoute、attempt=1、失败终态和POST审计',async()=>{
    const prepared=await runTool(append.tool,'prepare',append.virtual);assert.ifError(prepared.error);approveAppend(append);append.failPostJson=true;const written=await runTool(append.tool,'write',append.virtual);assert(written.error,'响应坏JSON应使写入流程失败');
    const report=getFile('06-写入与即时回读.json');assert.equal(report.status,'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');assert.equal(report.businessWritesAttempted,1);assert.equal(report.pendingRoute,append.detailRoute);assert.equal(report.audit.filter(x=>x.method==='POST'&&x.path===append.route&&x.status===201).length,1);assert.equal(append.calls.filter(x=>x.method==='POST').length,1);
  });

  resetFiles();setGate(undefined);const descriptionsFailure=makeDescriptionFixture();putFile('01-纠错计划.json',descriptionsFailure.plan);
  await verify('说明工具响应坏JSON仍保留06 pendingRoute、attempt=1、失败终态和PUT审计',async()=>{
    const prepared=await runTool(descriptionsFailure.tool,'prepare',descriptionsFailure.virtual);assert.ifError(prepared.error);approveDescriptions();descriptionsFailure.failPutJson=true;const written=await runTool(descriptionsFailure.tool,'write',descriptionsFailure.virtual);assert(written.error,'响应坏JSON应使写入流程失败');
    const report=getFile('06-写入与即时回读.json');assert.equal(report.status,'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');assert.equal(report.businessWritesAttempted,1);assert.equal(report.pendingRoute,descriptionsFailure.route);assert.equal(report.audit.filter(x=>x.method==='PUT'&&x.path===descriptionsFailure.route&&x.status===200).length,1);assert.equal(descriptionsFailure.calls.filter(x=>x.method==='PUT').length,1);
  });

  resetFiles();setGate(undefined);const descriptionsPass=makeDescriptionFixture();putFile('01-纠错计划.json',descriptionsPass.plan);
  await verify('说明即时回读允许仅updatedAt变化并保留createdAt及其他字段',async()=>{
    const prepared=await runTool(descriptionsPass.tool,'prepare',descriptionsPass.virtual);assert.ifError(prepared.error);approveDescriptions();const written=await runTool(descriptionsPass.tool,'write',descriptionsPass.virtual);assert.ifError(written.error);const report=getFile('06-写入与即时回读.json');assert.equal(report.status,'PASS');assert.equal(report.businessWritesAttempted,1);assert.equal(report.pendingRoute,null);assert.equal(report.operations[0].readback.createdAt,'2026-09-19T00:00:00.000Z');assert.equal(report.operations[0].readback.updatedAt,'2026-09-19T00:00:01.000Z');
  });

  resetFiles();setGate(undefined);const descriptionsDrift=makeDescriptionFixture();putFile('01-纠错计划.json',descriptionsDrift.plan);
  await verify('说明即时回读拒绝createdAt漂移',async()=>{
    const prepared=await runTool(descriptionsDrift.tool,'prepare',descriptionsDrift.virtual);assert.ifError(prepared.error);approveDescriptions();descriptionsDrift.driftCreatedAt=true;const written=await runTool(descriptionsDrift.tool,'write',descriptionsDrift.virtual);assert(written.error,'createdAt漂移应使即时回读失败');const report=getFile('06-写入与即时回读.json');assert.equal(report.status,'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');assert.equal(report.businessWritesAttempted,1);assert.equal(report.pendingRoute,descriptionsDrift.route);assert.equal(report.audit.filter(x=>x.method==='PUT'&&x.path===descriptionsDrift.route&&x.status===200).length,1);
  });
} finally {
  fs.readFileSync=originals.read;fs.writeFileSync=originals.write;fs.existsSync=originals.exists;globalThis.fetch=originals.fetch;console.log=originals.log;process.argv=originals.argv;setGate(originals.gate);
}

const oldHashes={appendV2:sha(originals.read(appendOld)),descriptions:sha(originals.read(descriptionsOld))};
const newHashes={appendV3:sha(originals.read(appendNew)),descriptionsV2:sha(originals.read(descriptionsNew))};
assert.equal(oldHashes.appendV2,'dc7af7426c1f3fcaa53a8c03738f649fc2f8236ba10090981a091ff1acc1a378');
assert.equal(oldHashes.descriptions,'eab116c1b4ac83239d16946ff275c51170154d0ea26229c9f03c1d71f0b2cfed');
const report={at:new Date().toISOString(),status:rawFailures.length===0?'PASS':'FAIL',realHTTP:0,oldHashes,newHashes,nodeChecks,static:{appendV3:staticAppend,descriptionsV2:staticDescriptions},cases};
originals.write(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
if(rawFailures.length)originals.write(path.join(out,'raw-failures.json'),JSON.stringify(rawFailures,null,2)+'\n');
originals.log(JSON.stringify(report));
if(report.status!=='PASS')process.exitCode=1;

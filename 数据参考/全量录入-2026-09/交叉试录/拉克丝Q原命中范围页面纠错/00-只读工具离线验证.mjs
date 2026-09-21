import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const web=process.cwd(),dir=path.join(web,'数据参考/全量录入-2026-09/交叉试录/拉克丝Q原命中范围页面纠错'),tool='tools/authoring/reviewed-hit-scope-ui.mjs',file=path.join(web,tool);
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8')),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const plan=read('01-候选方案.json'),frozen=read('02-冻结请求.json'),before=read('04-写入前现值.json'),sources=read('03-来源摘要.json'),prior=read('00-独立来源与顺序核对.json');
assert.equal(sha(path.join(dir,'02-冻结请求.json')),'90cf046052e50992704723ccb5ce7b5bc72658045c69d73a6ca8cc8e0aa1e101');
assert.equal(sources.length,9);assert.deepEqual(sources,plan.sourceFiles.map(s=>({...s,actualSha256:s.sha256})));for(const s of sources){const root=s.root==='web'?web:path.resolve(web,'../damage_viewer_project_planning');assert.equal(sha(path.join(root,s.path)),s.sha256);}
assert.equal(frozen.sourceSha256,sha(path.join(dir,'03-来源摘要.json')));assert.equal(frozen.baselineSha256,sha(path.join(dir,'04-写入前现值.json')));assert.deepEqual(frozen.request.body,prior.stageOne.body);assert.deepEqual(frozen.request.expectedReadback,prior.stageOne.expectedReadback);assert.equal(Object.keys(before.values).length,23);assert.equal(before.audit.length,23);assert(before.audit.every(x=>x.method==='GET'&&x.status===200));assert.equal(before.businessWrites,0);
const required=[tool,'01-候选方案.json','02-冻结请求.json','03-来源摘要.json','04-写入前现值.json'],approvedFiles=Object.fromEntries(required.map(n=>[n,sha(n===tool?file:path.join(dir,n))]));
const source=fs.readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace('import.meta.url',JSON.stringify(pathToFileURL(file).href)),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,run=new AsyncFunction('assert','crypto','fs','path','fileURLToPath','process','console','fetch','AbortSignal',source);
const root='/skills/lux_q',route=frozen.request.route,listRoute=root+'/trigger-rules',cases=[];
async function scenario(name,mode,mutate,expectedPass){
 const values=structuredClone(before.values),review={status:'APPROVED',approvedFiles:structuredClone(approvedFiles)},writer={status:'PASS',executionMode:'BROWSER_UI_ONLY',businessWritesAttempted:1,approvedFiles:structuredClone(approvedFiles)};
 if(mode==='readback'){values[route]=structuredClone(frozen.request.expectedReadback);const row=values[listRoute].find(x=>x.ruleKey===plan.ruleKey);row.conditionGroupCount=1;row.updatedAt='2026-09-19T06:00:00Z';}
 mutate?.({values,review,writer});
 const virtual=new Map([[path.join(dir,'05-独立评审.json'),JSON.stringify(review)],[path.join(dir,'06-写入与即时回读.json'),JSON.stringify(writer)]]),hidden=new Set(mode==='prepare'?required.slice(2).map(n=>path.join(dir,n)):[]),calls=[],logs=[];
 const mockFs={...fs,existsSync:p=>virtual.has(p)||(!hidden.has(p)&&fs.existsSync(p)),readFileSync:(p,encoding)=>virtual.has(p)?encoding?virtual.get(p):Buffer.from(virtual.get(p)):fs.readFileSync(p,encoding),writeFileSync:(p,t,opts)=>{assert.equal(mode,'prepare');assert(hidden.has(p));assert.equal(opts.flag,'wx');assert(!virtual.has(p));virtual.set(p,t);}};
 let error=null;try{await run(assert,crypto,mockFs,path,fileURLToPath,{argv:['node',file,mode,dir]},{log:t=>logs.push(JSON.parse(t))},async(url,opts)=>{assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert(url.startsWith(frozen.base));const p=url.slice(frozen.base.length);calls.push({method:'GET',path:p});const body=values[p];return{status:body===undefined?404:200,json:async()=>structuredClone(body??{})};},AbortSignal);}catch(e){error=e.message;}
 assert.equal(error===null,expectedPass,name+': '+error);if(expectedPass){assert.equal(logs.length,1);assert.equal(logs[0].GETs,23);if(mode==='readback'){assert.equal(logs[0].unchangedResponsesIncludingTimestamps,21);assert.equal(logs[0].expectedChangedCollections,1);assert.deepEqual(logs[0].changedDetails[route],frozen.request.expectedReadback);}if(mode==='prepare')assert.deepEqual(JSON.parse(virtual.get(path.join(dir,'02-冻结请求.json'))).request,frozen.request);}
 cases.push({name,mode,expectedPass,passed:true,mockedGETs:calls.length,result:error??logs[0]});
}
await scenario('准备只推导同一完整请求','prepare',null,true);
await scenario('写前全部现值一致','preflight',null,true);
await scenario('正常仅范围收窄回读','readback',null,true);
await scenario('原组成时间戳漂移拒绝','readback',({values})=>{values[root+'/effects/light_binding_hit'].updatedAt='2026-09-19T06:00:00Z';},false);
await scenario('原动作改为法力消耗拒绝','readback',({values})=>{values[route].actions[0].detail.effectKey='mana_cost';},false);
await scenario('原事件变更拒绝','readback',({values})=>{values[route].eventSource.detail.sourceSkillKey='morgana_q';},false);
await scenario('新条件拆为或组拒绝','readback',({values})=>{const group=values[route].conditionGroups[0],last=group.conditions.pop();values[route].conditionGroups.push({...group,groupKey:'or',conditions:[last]});values[listRoute].find(x=>x.ruleKey===plan.ruleKey).conditionGroupCount=2;},false);
await scenario('目标列表与详情计数不一致拒绝','readback',({values})=>{values[listRoute].find(x=>x.ruleKey===plan.ruleKey).actionCount=2;},false);
await scenario('规则列表其他项变化拒绝','readback',({values})=>{values[listRoute].find(x=>x.ruleKey==='on_used').description='changed';},false);
await scenario('目标更新时间倒退拒绝','readback',({values})=>{values[listRoute].find(x=>x.ruleKey===plan.ruleKey).updatedAt='2000-01-01T00:00:00Z';},false);
await scenario('写前动作漂移拒绝','preflight',({values})=>{values[route].actions[0].detail.effectKey='mana_cost';},false);
await scenario('未批准评审拒绝','preflight',({review})=>{review.status='REVISE';},false);
await scenario('批准摘要不符拒绝','preflight',({review})=>{review.approvedFiles['02-冻结请求.json']='0'.repeat(64);},false);
await scenario('不允许HTTP写模式','write',null,false);
await scenario('尚未完成的页面写入拒绝','readback',({writer})=>{writer.status='STARTED';},false);
await scenario('API替代首次页面声明拒绝','readback',({writer})=>{writer.executionMode='API';},false);
await scenario('多次写入声明拒绝','readback',({writer})=>{writer.businessWritesAttempted=2;},false);
await scenario('写入所用批准摘要不符拒绝','readback',({writer})=>{writer.approvedFiles['02-冻结请求.json']='0'.repeat(64);},false);
const report={status:'PASS',at:new Date().toISOString(),realHTTP:0,businessWrites:0,method:'原工具源码在同一引擎执行，仅替换 fetch、参数、输出和证据文件读写为内存输入；原工具未修改。',sourceFilesVerified:9,approvedFiles,cases};
fs.writeFileSync(path.join(web,'output/seven-hit-review/lux-hit-scope-offline.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'PASS',cases:cases.length,realHTTP:0,approvedFiles}));

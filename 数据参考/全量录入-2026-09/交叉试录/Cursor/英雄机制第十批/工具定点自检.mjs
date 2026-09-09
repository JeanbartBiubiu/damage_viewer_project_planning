// 全部使用本地替身，不调用 createRequester 或业务接口。只验证顺序、幂等与未知响应处理。
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {here,loadPlan,business,diff,createMissing,verifySaved,candidateFileSha256} from './录入工具.mjs';
if(process.argv.slice(2).join(' ')!=='--apply')throw Error('测试替身需要 --apply 以覆盖已授权写入分支；本文件没有联网实现');
const {plan}=await loadPlan(),checks=[];const check=(name,fn)=>{fn();checks.push({name,pass:true});};
const mk=(id,skillKey='graves_q')=>{const body=plan.skills[skillKey].write.parameters.find(x=>x.parameterKey===id),base='/skills/'+skillKey+'/parameters';assert.ok(body);return {skillKey,kind:'parameters',idField:'parameterKey',id,body,base,route:base+'/'+id};};
const fresh=mk('base_damage'),other=mk('bonus_ad_ratio'),actual={...fresh.body,gameId:'lol',skillKey:fresh.skillKey,createdAt:'fixed',updatedAt:'fixed'},snapshot={conflicts:[],missing:[fresh]},journal=async()=>{};
check('忽略对象字段顺序，但完整比较字段值',()=>{const reversed=Object.fromEntries(Object.entries(actual).reverse());assert.equal(diff(business(actual),business(reversed)),null);assert.notEqual(diff(business(actual),business({...actual,fixedValue:999})),null);});
let calls=[];const recovered=await createMissing(plan,snapshot,async(route,{method='GET'}={})=>{calls.push({route,method});if(method==='POST')return {ok:false,status:503,data:null};return calls.length===1?{ok:false,status:404,data:null}:{ok:true,status:200,data:actual};},{journal});
check('POST503后只GET对账，不重放',()=>{assert.deepEqual(calls.map(x=>x.method),['GET','POST','GET']);assert.equal(recovered.events.at(-1).match,true);assert.deepEqual(recovered.failedSkills,[]);});
calls=[];const missing=await createMissing(plan,{conflicts:[],missing:[fresh,other]},async(route,{method='GET'}={})=>{calls.push({route,method});return {ok:false,status:method==='POST'?503:404,data:null};},{journal});
check('异常且未落地时暂停该技能后续依赖',()=>{assert.deepEqual(calls.map(x=>x.method),['GET','POST','GET']);assert.deepEqual(missing.failedSkills,['graves_q']);assert.equal(missing.events.at(-1).action,'当前技能异常后跳过依赖');});
calls=[];const conflict=await createMissing(plan,snapshot,async(route,{method='GET'}={})=>{calls.push(method);return {ok:true,status:200,data:{...actual,fixedValue:999}};},{journal});
check('写前异值不会发POST',()=>{assert.deepEqual(calls,['GET']);assert.deepEqual(conflict.failedSkills,['graves_q']);});
calls=[];const reused=await createMissing(plan,snapshot,async(route,{method='GET'}={})=>{calls.push(method);return {ok:true,status:200,data:actual};},{journal});
check('并发同值只复用，不发POST',()=>{assert.deepEqual(calls,['GET']);assert.deepEqual(reused.failedSkills,[]);});
const skipped=await verifySaved(plan,{missing:[fresh],conflicts:[]},new URL('不应创建/',here));check('实际缺项时拒绝用候选替代求值',()=>{assert.equal(skipped.pass,false);assert.equal(skipped.fields,0);});
const report={at:new Date().toISOString(),pass:true,businessHttp:0,businessWrites:0,candidateFileSha256,checks};await writeFile(new URL('工具定点自检.json',here),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:true,businessHttp:0,businessWrites:0,checks:checks.length}));

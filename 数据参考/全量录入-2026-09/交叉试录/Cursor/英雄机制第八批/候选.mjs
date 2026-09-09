import {readFile} from 'node:fs/promises';
export {evidence,clean,levels,val,fval,fixed,pn,attr,op,add,mul,valueRule,behavior,life,begin,parameter,data,literal,coefficient,formula,result,effect,damage,manaEffect,castProcess,hit,pending,exclude,attributeEffect,curve};
const evidence=JSON.parse(await readFile(new URL('./根绑定与数值证据.json',import.meta.url),'utf8'));
const clean=n=>Math.round(n*1e6)/1e6;
const levels=a=>Object.fromEntries(a.map((v,i)=>[String(i+1),v]));
const val=parameterKey=>({kind:'PARAMETER',parameterKey});
const fval=formulaKey=>({kind:'FORMULA',formulaKey});
const fixed=value=>({kind:'FIXED',value});
const pn=parameterKey=>({nodeType:'PARAMETER',parameterKey});
const attr=(key,owner='SOURCE',kind='TOTAL')=>({nodeType:'ATTRIBUTE',attributeOwner:owner,attributeKey:key,attributeValueKind:kind});
const op=(operation,a,b)=>({nodeType:'OPERATION',operation,operands:[a,b]});
const add=(...xs)=>xs.reduce((a,b)=>op('ADD',a,b));
const mul=(a,b)=>op('MULTIPLY',a,b);
const valueRule=value=>({value,fixedMultiplier:1,fixedMinValue:0,fixedMaxValue:null});
const behavior={moment:'PERSISTENT',valueReadMode:'APPLICATION_SNAPSHOT',stackValueMode:'SHARED',reapplicationValueMode:'REPLACE',periodicExecutionMode:null};
const life=duration=>({durationValue:duration,maxStacksValue:fixed(1),applicationStacksValue:fixed(1),instanceScope:'SOURCE',reapplicationStackMode:'KEEP',reapplicationDurationMode:duration?'REFRESH_ALL':null,expiryMode:duration?'ALL_AT_ONCE':'EXPLICIT_ONLY',periodicIntervalValue:null,firstPeriodicExecution:null});
export const plan={meta:{executor:'第八批候选；Cursor与Codex实际执行分别记录',gameId:'lol',note:'来源冻结与当前录入分开；只计实际GET一致的组成。没有运行Wasm或战斗。本批仅补缺，不更新既有不同内容。',sources:evidence.heroes.map(h=>({id:h.id,client:h.client,official:h.official})),scope:'四英雄20技能；召唤物、纯视野、野怪支路和多对象空间执行按既有约定后置。控制与跨技能接线是待补，不是范围外。'},skills:{}};
function begin(key){const h=evidence.heroes.find(h=>h.spells.some(s=>s.skillKey===key));const s=h.spells.find(s=>s.skillKey===key);const c={skillKey:key,name:s.official.name,maxLevel:s.official.maxrank??1,source:{hero:h.id,rootPath:h.rootPath,spellPath:s.binding,clientSha256:h.client.sha256,officialSha256:h.official.sha256},write:{parameters:[],formulas:[],effects:[],processes:[],internalStates:[],triggerRules:[]},proofs:[],pending:[],excluded:[]};plan.skills[key]=c;return {c,s,p:s.object.mSpell};}
function parameter(x,key,name,values,description,mode){const a=Array.isArray(values)?values:[values];if(!a.length||!a.every(Number.isFinite))throw Error('缺值 '+x.c.skillKey+'/'+key);const variable=mode==='CHARACTER_LEVEL'||new Set(a).size>1;const body={parameterKey:key,name,valueType:a.every(Number.isInteger)?'INTEGER':'DECIMAL',valueMode:mode??(variable?'SKILL_LEVEL':'FIXED'),fixedValue:variable?null:a[0],levelValues:variable?levels(a):null,description,sortOrder:(x.c.write.parameters.length+1)*10};x.c.write.parameters.push(body);return key;}
function data(x,source,key,name,{scale=1,unit='',fixedOnly=false}={}){const d=(x.p.DataValues??x.p.mDataValues??[]).find(d=>(d.name??d.mName)===source);const raw=d?.values??d?.mValues;if(!raw||raw.length<x.c.maxLevel+1)throw Error('数据字段缺失 '+x.c.skillKey+'/'+source);const arr=raw.slice(1,x.c.maxLevel+1).map(v=>clean(clean(v)*scale));if(fixedOnly&&new Set(arr).size!==1)throw Error('不是固定值 '+source);x.c.proofs.push({parameterKey:key,source:'DataValues.'+source,raw,offset:1,values:arr,scale});return parameter(x,key,name,arr,`客户端当前根绑定 DataValues.${source} 取索引1至${x.c.maxLevel}${unit?'；单位'+unit:''}。`);}
function literal(x,key,name,value,description,path){x.c.proofs.push({parameterKey:key,source:path??'官方说明或明确计算派生',values:Array.isArray(value)?value:[value]});return parameter(x,key,name,value,description);}
function coefficient(){throw Error('禁止默认省略属性枚举猜作法强；必须按本批来源显式核对');}
function formula(x,key,name,expression,description){x.c.write.formulas.push({formulaKey:key,name,expression,description,sortOrder:(x.c.write.formulas.length+1)*10});}
function result(key,name,type,target,value,detail,lifecycleBehavior=null,block=null,description=null){return {resultKey:key,name,resultType:type,target,description,sortOrder:10,lifecycleBehavior,spellShieldBlockScope:block,valueRule:value?valueRule(value):null,detail};}
function effect(x,key,name,results,lifecycle=null,description=null){x.c.write.effects.push({effectKey:key,name,description,sortOrder:(x.c.write.effects.length+1)*10,lifecycle,results});}
function damage(){throw Error('已撤出未核资格或缺省曲线入口；必须先补完整来源再建立当前分支，不允许默认值绕过。');}
function manaEffect(x){effect(x,'mana_cost','施放法力消耗',[result('consume_mana','消耗法力','RESOURCE_CHANGE','SOURCE',val('mana_cost'),{attributeKey:'mana',operation:'CONSUME'})],null,'仅施放法力消耗；具体过程单独绑定。');}
function castProcess(x){x.c.write.processes.push({processKey:'cast',name:'施放'+x.c.name,activationType:'ACTIVE',description:'只绑定法力、基础冷却及施法延迟；不在过程结束时自动造成伤害。',sortOrder:10,cooldown:{durationValue:val('cooldown_ms'),startMoment:{momentType:'PROCESS_START',stepKey:null}},steps:[{stepKey:'cast_time',name:'施法延迟',description:'主技能已核对的施法时间。',sortOrder:10,stepType:'DELAY',detail:{delayValue:val('cast_time_ms')}}],effectBindings:[{bindingKey:'mana_cost',effectKey:'mana_cost',moment:{momentType:'PROCESS_START',stepKey:null},sortOrder:10}],stateOperations:[]});}
function hit(){throw Error('已撤出未核资格或缺省曲线入口；必须先补完整来源再建立当前分支，不允许默认值绕过。');}
function pending(x,component,reason,kind='未接线'){if(!['来源','系统','未接线'].includes(kind))throw Error('待补类型不合法 '+kind);x.c.pending.push({kind,component,reason});}
function exclude(x,component,reason){x.c.excluded.push({component,reason});}
function attributeEffect(x,key,name,parameterKey,attributeKey,duration){effect(x,key,name,[result('attribute',name,'ATTRIBUTE_CHANGE','SOURCE',val(parameterKey),{attributeKey,operation:'INCREASE',modifierZoneKey:'attribute_flat_add'},behavior)],life(duration),'独立持续属性。比例属性按百分点加算，1表示100%；不是把面板最终属性乘此比例。');}
function curve(){throw Error('已撤出未核资格或缺省曲线入口；必须先补完整来源再建立当前分支，不允许默认值绕过。');}

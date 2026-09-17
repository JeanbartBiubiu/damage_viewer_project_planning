import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
if(process.argv.length!==2)throw Error('仅GET和本地核对');
const here=path.dirname(fileURLToPath(import.meta.url)),read=f=>JSON.parse(fs.readFileSync(path.join(here,f),'utf8')),plan=read('可审查请求.json'),saved={},gets=[];
for(const p of plan.scope){saved[p.id]={};for(const component of ['parameters','formulas','effects','processes','internal-states','trigger-rules']){const route=`/skills/${p.skillKey}/${component}`,r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(30000)}),data=await r.json();assert.equal(r.status,200);assert(Array.isArray(data));const expected=plan.requests.filter(x=>x.id===p.id&&x.route===`/skills/${p.skillKey}/${component}`).length;assert.equal(data.length,expected,route);saved[p.id][component]=data;gets.push({route,status:r.status,count:data.length,expected});}}
// 公式列表只有摘要时单独读取详情；数值核算仅使用实际保存值。
for(const p of plan.requests.filter(x=>x.kind==='formula')){const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+p.readRoute,{headers:{Authorization:'Bearer local-entry'}});assert.equal(r.status,200);const f=await r.json();saved[p.id].formulas=saved[p.id].formulas.map(x=>x.formulaKey===f.formulaKey?f:x);gets.push({route:p.readRoute,status:r.status});}
function calculate(n,params,attrs){if(n.nodeType==='PARAMETER'){assert(n.parameterKey in params);return params[n.parameterKey];}if(n.nodeType==='ATTRIBUTE'){const k=`${n.attributeOwner}:${n.attributeKey}:${n.attributeValueKind}`;assert(k in attrs,k);return attrs[k];}assert.equal(n.operands.length,2);const a=calculate(n.operands[0],params,attrs),b=calculate(n.operands[1],params,attrs);switch(n.operation){case'ADD':return a+b;case'MULTIPLY':return a*b;default:throw Error('本批不应有其他运算');}}
const cases=[];
function check(id,key,attrs,inputs,expected){const s=saved[id],f=s.formulas.find(x=>x.formulaKey===key),params={...Object.fromEntries(s.parameters.filter(x=>x.valueMode==='FIXED').map(x=>[x.parameterKey,x.fixedValue])),...inputs};assert(f);const actual=calculate(f.expression,params,attrs);assert(Math.abs(actual-expected)<1e-9,`${id}/${key}`);cases.push({id,key,attrs,inputs,expected,actual,passed:true});}
check(9111,'triumph_heal',{'SOURCE:hp:TOTAL':3000,'SOURCE:hp:MISSING':1200},{},135);
check(9111,'triumph_heal',{'SOURCE:hp:TOTAL':1000,'SOURCE:hp:MISSING':0},{},25);
check(8009,'takedown_mana_restore',{'SOURCE:mana:TOTAL':1600},{},240);
check(8009,'takedown_energy_restore',{'SOURCE:energy:TOTAL':200},{},30);
check(8226,'missing_mana_restore',{'SOURCE:mana:MISSING':800},{},8);
check(8226,'missing_mana_restore',{'SOURCE:mana:MISSING':0},{},0);
check(8437,'melee_damage',{'SOURCE:hp:TOTAL':3000},{},105);
check(8437,'ranged_damage',{'SOURCE:hp:TOTAL':3000},{},42);
check(8437,'melee_heal',{'SOURCE:hp:TOTAL':3000},{},39);
check(8437,'ranged_heal',{'SOURCE:hp:TOTAL':3000},{},15.6);
check(8351,'glacial_slow_ratio',{'SOURCE:heal_shield_power_percent:TOTAL':.1,'SOURCE:ability_power:TOTAL':200,'SOURCE:attack_damage:BONUS':100},{},.48);
check(8128,'harvest_damage',{'SOURCE:attack_damage:BONUS':80,'SOURCE:ability_power:TOTAL':100},{confirmed_souls:3},76);
const lv=saved[8210].parameters.find(x=>x.parameterKey==='level_ability_haste');assert.deepEqual([1,4,5,7,8,11,18].map(x=>lv.levelValues[x]),[0,0,5,5,10,10,10]);
assert.deepEqual(plan.scope.filter(p=>saved[p.id]['trigger-rules'].length).map(p=>p.id).sort(),[8210,8453,9104]);
assert(saved[8437].effects.every(x=>!x.effectKey.includes('damage')));
const count=key=>Object.values(saved).reduce((n,s)=>n+s[key].length,0);
const result={at:new Date().toISOString(),passed:true,readRequests:gets.length,counts:{parameters:count('parameters'),formulas:count('formulas'),effects:count('effects'),processes:count('processes'),internalStates:count('internal-states'),rules:count('trigger-rules')},cases,characterLevelCheck:{id:8210,levels:[1,4,5,7,8,11,18],values:[0,0,5,5,10,10,10]},gets,boundary:'实际保存公式的独立数值核算，不代表条件自动连接或战斗结算；其他输入不得缺省'};
fs.writeFileSync(path.join(here,'独立数值核对.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:true,reads:gets.length,cases:cases.length,counts:result.counts}));

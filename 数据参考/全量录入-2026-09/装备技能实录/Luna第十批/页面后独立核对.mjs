import fs from 'node:fs';
import assert from 'node:assert/strict';
const here=new URL('./',import.meta.url);
const candidate=JSON.parse(fs.readFileSync(new URL('接口候选.json',here),'utf8'));
const checks=[],arithmetic=[],actuals={};
function compare(actual,expected,label){
  if(expected&&typeof expected==='object'){
    if(Array.isArray(expected))assert.equal(actual.length,expected.length,label);
    for(const [key,value] of Object.entries(expected))compare(actual?.[key],value,`${label}/${key}`);
  }else assert.deepEqual(actual,expected,label);
}
async function get(route){
  const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,route);const body=await response.json();checks.push({route,body});return body;
}
for(const object of candidate.objects){
  const skill={parameters:{},formulas:{},effects:{}};actuals[object.skillKey]=skill;
  for(const [type,key] of [['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey']]){
    for(const expected of object.apiPayload[type]){
      const route=`/skills/${object.skillKey}/${type}/${expected[key]}`;
      const actual=await get(route);compare(actual,expected,route);skill[type][expected[key]]=actual;
    }
  }
  const image=await get(`/skills/${object.skillKey}/representative-image`);
  assert.equal(image.image.imageKey,candidate.representativeImages.find(x=>x.skillKey===object.skillKey).imageKey);assert.equal(image.image.enabled,true);
  const rules=await get(`/skills/${object.skillKey}/trigger-rules`);assert.deepEqual(rules,[]);
}
const ringEffects=await get('/skills/duolanjie_passive/effects');assert.deepEqual(ringEffects,[]);
assert.deepEqual((await get('/equipment/duolanjie/attributes')).attributeValues,{hp:90,mana:50,ability_power:18});
assert.deepEqual((await get('/equipment/item_1082/attributes')).attributeValues,{hp:50,ability_power:15});
function evaluate(node,parameters){
  if(node.nodeType==='PARAMETER'){assert.equal(parameters[node.parameterKey].valueMode,'FIXED');return parameters[node.parameterKey].fixedValue;}
  assert.equal(node.nodeType,'OPERATION');assert.equal(node.operation,'MULTIPLY');
  return node.operands.reduce((value,child)=>value*evaluate(child,parameters),1);
}
const ring=actuals.duolanjie_passive;
for(const [formulaKey,expected] of Object.entries({mana_restore_rate_base:1,mana_restore_rate_upgraded:2,fallback_health_rate_base:0.45,fallback_health_rate_upgraded:0.9})){
  const actual=evaluate(ring.formulas[formulaKey].expression,ring.parameters);assert.equal(actual,expected);arithmetic.push({formulaKey,expected,actual,match:true});
}
const seal=actuals.item_1082_passive,effect=seal.effects.glory_ability_power;
assert.equal(effect.lifecycle.expiryMode,'EXPLICIT_ONLY');assert.equal(effect.results[0].lifecycleBehavior.stackValueMode,'PER_STACK');
const perStack=evaluate(seal.formulas.ability_power_from_glory.expression,seal.parameters);
for(const [stacks,expected] of [[0,0],[1,4],[5,20],[10,40]]){
  const actual=stacks*perStack;assert.equal(actual,expected);arithmetic.push({stacks,expected,actual,match:true});
}
assert.equal(checks.length,22);assert.equal(arithmetic.length,8);
fs.writeFileSync(new URL('页面验收.json',here),JSON.stringify({at:new Date().toISOString(),url:'http://127.0.0.1:5173/#/skills',
  method:'主负责人真实页面查看，未修改；页面后独立22项GET及对实际保存表达式的8项算术核对。',
  samples:[{skillKey:'item_1082_passive',observation:'生命周期按来源、显式移除、叠层增加；结果为施法者持续属性，每层分别贡献法强。击杀助攻阵亡及共享层数未接线。'},
    {skillKey:'duolanjie_passive',observation:'参数列表1、2、5000、0.45；四公式按每秒速率命名，强化无蓝公式详情为强化每秒回蓝乘治疗比例，预览正确。'}],
  imageObservation:'两个技能列表均有正确的代表图片元素和名称。',checks,arithmetic,runtimeValidation:'未执行',passed:true},null,2)+'\n');
console.log(JSON.stringify({independentGet:checks.length,arithmetic:arithmetic.length,passed:true}));

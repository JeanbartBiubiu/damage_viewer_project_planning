import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const here=new URL('./',import.meta.url),bytes=fs.readFileSync(new URL('第二组接口候选.json',here));
if(process.argv.length>2)throw Error('只读固定候选核对不接受参数');
const hash=createHash('sha256').update(bytes).digest('hex');
assert.equal(hash,'8e1befbdbdeef83b78f0208fd2eff260a1e0d3333a5db514f1c5eda3d4ab88e2');
const plan=JSON.parse(bytes),checks=[],actualSkills={};
function compare(actual,expected,label){
  if(expected&&typeof expected==='object'&&!Array.isArray(expected)){for(const [k,v]of Object.entries(expected))compare(actual?.[k],v,`${label}/${k}`);}
  else assert.deepEqual(actual,expected,label);
}
async function get(route){const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,route);return await r.json();}
for(const object of plan.objects){
  const base=`/skills/${object.skillKey}`,actual={parameters:{},formulas:{},effects:{},triggerRules:{}};
  actualSkills[object.skillKey]=actual;
  const subject=await get(base);compare(subject,object.apiPayload.skill,base);checks.push({route:base,actual:subject,match:true});
  for(const [kind,key,api]of [['parameters','parameterKey','parameters'],['formulas','formulaKey','formulas'],['effects','effectKey','effects'],['triggerRules','ruleKey','trigger-rules']]){
    for(const expected of object.apiPayload[kind]){const route=`${base}/${api}/${expected[key]}`,value=await get(route);compare(value,expected,route);actual[kind][expected[key]]=value;checks.push({route,actual:value,match:true});}
  }
  const relation=plan.relations.find(x=>x.skillKey===object.skillKey),route='/equipment-skill-relations?equipmentKey='+object.equipmentKey,data=await get(route),items=data.items??data;
  assert.equal(items.length,1);compare(items[0],relation,route);checks.push({route,actual:data,match:true});
  const image=plan.representativeImages.find(x=>x.skillKey===object.skillKey),imageRoute=base+'/representative-image',imageData=await get(imageRoute);
  compare(imageData,{image:{imageKey:image.imageKey,enabled:true}},imageRoute);checks.push({route:imageRoute,actual:imageData,match:true});
}
assert.equal(checks.length,27);
function evaluate(node,skill,attrs){
  if(node.nodeType==='PARAMETER'){const p=skill.parameters[node.parameterKey];assert.equal(p.valueMode,'FIXED');return p.fixedValue;}
  if(node.nodeType==='ATTRIBUTE'){assert.equal(node.attributeOwner,'SOURCE');assert.equal(node.attributeValueKind,'TOTAL');assert.ok(Object.hasOwn(attrs,node.attributeKey));return attrs[node.attributeKey];}
  assert.equal(node.nodeType,'OPERATION');assert.equal(node.operation,'MULTIPLY');return node.operands.reduce((a,n)=>a*evaluate(n,skill,attrs),1);
}
const arithmetic=[],mana=actualSkills.item_3004_passive,glory=actualSkills.item_3041_passive;
function check(name,actual,expected){assert.ok(Math.abs(actual-expected)<1e-10,name);arithmetic.push({name,actual,expected,match:true});}
for(const n of [0,1,500,1250,2500,5000])check(`最大法力${n}`,evaluate(mana.formulas.bonus_attack_damage_from_max_mana.expression,mana,{mana:n}),n*0.02);
check('普通合法命中的独立数值',evaluate(mana.formulas.mana_flow_max_mana_per_hit.expression,mana,{}),3);
check('英雄合法命中的独立数值',evaluate(mana.formulas.mana_flow_hero_hit_max_mana.expression,mana,{}),6);
const perLayer=evaluate(glory.formulas.ability_power_from_glory.expression,glory,{});
for(const layers of [0,1,9,10,25])check(`荣耀${layers}层数值贡献`,perLayer*layers,layers*5);
check('荣耀门槛比例数值',evaluate(glory.formulas.move_speed_percent_from_glory_threshold.expression,glory,{}),0.1);
assert.equal(arithmetic.length,14);
assert.equal(Object.keys(mana.triggerRules).length,1);assert.equal(Object.keys(glory.triggerRules).length,0);
fs.writeFileSync(new URL('页面验收.json',here),JSON.stringify({at:new Date().toISOString(),candidateSha256:hash,passed:true,independentGetCount:27,arithmeticCount:14,
  url:'http://127.0.0.1:5173/#/skills',method:'主负责人真实页面查看，魔宗规则打开编辑检查后取消且未改值；随后另次27项独立GET逐字段对照固定候选。',
  samples:[{skillKey:'item_3004_passive',observation:'敬畏自身攻击力效果按来源实例、仅显式移除、整个实例共享数值，按当前时点读取最大法力换算公式；唯一初始化规则为来源对象初始化完成，只执行敬畏效果，未扩大法力流事件。'},
    {skillKey:'item_3041_passive',observation:'荣耀上限引用25层参数，重复增加层数、仅显式移除；每层法强结果持续生效、施加时留存、每层分别贡献，引用每层5法强公式。没有默认初始化或无条件移速效果。'}],
  checks,arithmetic,arithmeticBoundary:'使用实际保存表达式及参数的独立数值核对；荣耀总贡献按显式给出的层数相乘，不声称实现叠层事件、上限裁决或动态门槛。',runtimeValidation:'未执行'},null,2)+'\n');
console.log(JSON.stringify({passed:true,independentGetCount:checks.length,arithmeticCount:arithmetic.length}));

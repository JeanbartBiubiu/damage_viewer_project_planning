import fs from 'node:fs';
import assert from 'node:assert/strict';
const candidate=JSON.parse(fs.readFileSync(new URL('./录入候选.json',import.meta.url)));
const base='http://127.0.0.1:8080/api/admin/games/lol';
async function get(endpoint,status=200) {const r=await fetch(base+endpoint,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(30000)});assert.equal(r.status,status,endpoint);return r.json();}
function pick(a,e) {return e&&typeof e==='object'?Array.isArray(e)?a.map((v,i)=>pick(v,e[i])):Object.fromEntries(Object.keys(e).map(k=>[k,pick(a[k],e[k])])):a;}
const out={checkedAt:new Date().toISOString(),records:[],components:0,counts:{skills:0,parameters:0,formulas:0,effects:0,triggerRules:0,equipmentRelations:0,representativeImageReuses:0},passed:false,status:'部分录入，完整触发及待核公式继续处理',runtimeValidation:'未执行'};
for(const object of candidate.objects) {
 const root='/skills/'+object.skill.skillKey, record={equipmentKey:object.equipmentKey,skillKey:object.skill.skillKey,components:[]};
 const check=async(endpoint,expected,kind)=>{const actual=await get(endpoint);assert.deepEqual(pick(actual,expected),expected);record.components.push({endpoint,kind,expected,actual,matches:true});out.components++;out.counts[kind]++;};
 await check(root,object.skill,'skills');
 for(const [kind,type,key] of [['parameters','parameters','parameterKey'],['formulas','formulas','formulaKey'],['effects','effects','effectKey'],['triggerRules','trigger-rules','ruleKey']]) {
  const list=await get(root+'/'+type);assert.equal(list.length,object[kind].length,root+'/'+type+'存在额外或遗漏组成');
  for(const expected of object[kind]) await check(root+'/'+type+'/'+expected[key],expected,kind);
 }
 const relations=await get('/equipment-skill-relations?equipmentKey='+object.equipmentKey);
 record.relation=(Array.isArray(relations)?relations:relations.items).find(r=>r.skillKey===object.skill.skillKey);assert.deepEqual(pick(record.relation,object.relation),object.relation);
 const gear=await get('/equipment/'+object.equipmentKey+'/representative-image'), skill=await get(root+'/representative-image');
 assert.ok(gear.image.enabled&&skill.image.enabled);assert.equal(gear.image.imageKey,skill.image.imageKey);record.imageKey=skill.image.imageKey;
 out.components+=2;out.counts.equipmentRelations++;out.counts.representativeImageReuses++;out.records.push(record);
}
assert.equal(out.components,76);assert.deepEqual(out.counts,{skills:6,parameters:41,formulas:8,effects:9,triggerRules:0,equipmentRelations:6,representativeImageReuses:6});
out.directAttributeCorrection=await get('/equipment/item_1054/attributes');assert.deepEqual(out.directAttributeCorrection.attributeValues,{hp:110,hp_regen:4});
for(const endpoint of ['/skills/item_1054_passive/trigger-rules/minion_bonus_damage_on_basic_attack_hit','/skills/item_1054_passive/effects/minion_bonus_damage','/skills/item_1054_passive/effects/base_regen','/skills/item_1054_passive/parameters/minion_bonus_damage','/skills/item_1054_passive/parameters/base_regen_per_5s','/skills/item_3153_passive/parameters/minion_monster_damage_cap']) await get(endpoint,404);
out.removedComponentsAbsent=6;
out.browser={checkedAt:'2026-09-08',observations:['技能列表显示玛莫提乌斯代表图','近战魔法护盾为施法者、按来源对象、持续时间参数、magic专用护盾','多兰盾装备属性显示生命110、每5秒生命回复4','多兰盾挂载item_1054_passive，名称耐久专注、启用、排序10']};
out.passed=true;fs.writeFileSync(new URL('./主负责人复核.json',import.meta.url),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({passed:true,components:out.components,counts:out.counts,directAttributeCorrect:true,removedAbsent:6}));

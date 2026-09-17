import fs from 'node:fs';
import assert from 'node:assert/strict';

// 仅GET。页面观察由主负责人实际打开技能、效果和结果后记录。
const readbacks=[];
for(const [route, status] of [
  ['/skills/item_3050_passive/effects/ultimate_haste',200],
  ['/skills/item_3050_passive/parameters/ultimate_haste',200],
  ['/skills/item_3050_passive/trigger-rules/initialize_ultimate_haste',200],
  ['/skills/item_3050_passive/effects/storm_magic_damage',404],
  ['/skills/item_3050_passive/parameters/storm_tick_interval_ms',404],
  ['/skills/item_3071_passive/effects/armor_shred',200],
  ['/skills/item_8010_passive/effects/magic_resistance_shred',200],
  ['/skills/item_3032_passive/trigger-rules',200],
]) {
  const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{
    headers:{Authorization:'Bearer local-entry'}, signal:AbortSignal.timeout(30000),
  });
  assert.equal(response.status,status,route);
  readbacks.push({route,status:response.status,data:await response.json()});
}
const [haste,value,init,,,armor,resistance,rules]=readbacks.map(x=>x.data);
assert.equal(value.fixedValue,15);
assert.equal(haste.lifecycle.instanceScope,'SOURCE');
assert.equal(haste.lifecycle.expiryMode,'EXPLICIT_ONLY');
assert.equal(haste.results[0].resultType,'SKILL_HASTE_MODIFIER');
const keys=haste.results[0].detail.affectedSkillScope.skillKeys;
assert.equal(keys.length,170);assert.ok(keys.includes('ez_r'));assert.ok(!keys.includes('udyr_r'));
assert.equal(init.eventSource.eventType,'SOURCE_INITIALIZED');
assert.deepEqual(rules,[]);
for(const [effect,zone] of [[armor,'item_3071_armor_reduction'],[resistance,'item_8010_magic_resistance_reduction']]) {
  assert.equal(effect.lifecycle.instanceScope,'TARGET');
  assert.equal(effect.results[0].detail.modifierZoneKey,zone);
  assert.equal(effect.results[0].detail.operation,'DECREASE');
  assert.equal(effect.results[0].lifecycleBehavior.stackValueMode,'PER_STACK');
  assert.equal(effect.results[0].lifecycleBehavior.reapplicationValueMode,null);
}
const report={checkedAt:new Date().toISOString(),passed:true,page:'http://127.0.0.1:5173/#/skills',
  observations:[
    '基克的聚合技能行显示代表图片；效果列表仅有冰晶燃烧终极技能急速，无旧风暴伤害。详情显示按来源对象、仅显式移除、施法者持续急速，关键引用列完整列出技能集合。',
    '基克触发列表只有初始化冰晶燃烧终极技能急速，事件为来源对象初始化完成，零条件组、一个动作。',
    '黑色切割者技能代表图片可见；效果按承受对象叠层、刷新全部时间、整体到期。结果为当前目标护甲减少，引用黑色切割者护甲削减乘区，每层分别贡献数值。',
  ],experience:[{topic:'大量指定技能的结果摘要',observed:'基克结果关键引用摘要完整列出170个技能名称。',suggestion:'后续将长集合默认显示数量与少量名称，允许展开核对，避免每次维护都阅读完整清单。',blocking:false}],
  readbacks,boundary:'代表页面真实查看与随后独立GET；没有编辑保存或战斗执行，完整触发筛选及运行接线继续核对。',
};
fs.writeFileSync(new URL('页面验收.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,readbacks:readbacks.length}));

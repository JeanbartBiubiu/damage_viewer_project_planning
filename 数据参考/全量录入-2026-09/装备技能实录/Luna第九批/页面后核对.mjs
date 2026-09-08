import fs from 'node:fs';
import assert from 'node:assert/strict';

const here = new URL('./', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, here), 'utf8'));
const plan = read('接口候选.json');
const writePlan = read('写入时接口候选.json');
assert.deepEqual(plan.objects.map(x => x.apiPayload), writePlan.objects.map(x => x.apiPayload));
const readbacks = [];
for (const route of [
  '/skills/item_4632_passive/effects/consume_spell_shield',
  '/skills/item_4632_passive/trigger-rules/consume_on_spell_block',
  '/skills/item_4632_passive/trigger-rules/initialize_spell_shield',
  '/skills/item_6672_passive/parameters/damage_amount_by_character_level',
]) {
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
    headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, route);
  readbacks.push({ route, status: response.status, data: await response.json() });
}
const [consume, rule, initialize, parameter] = readbacks.map(x => x.data);
assert.equal(consume.results[0].resultType, 'LIFECYCLE_OPERATION');
assert.equal(consume.results[0].target, 'SOURCE');
assert.equal(consume.results[0].detail.operation, 'REMOVE');
assert.equal(rule.eventSource.eventType, 'SPELL_SHIELD_BLOCKED');
assert.equal(rule.eventSource.detail.shieldEffectKey, 'spell_shield');
assert.equal(initialize.eventSource.eventType, 'SOURCE_INITIALIZED');
assert.equal(parameter.valueMode, 'CHARACTER_LEVEL');
assert.deepEqual(Object.values(parameter.levelValues), [150,150,150,150,150,150,150,150,155,160,165,170,175,180,185,190,195,200]);
const report = {
  checkedAt: new Date().toISOString(), passed: true, page: 'http://127.0.0.1:5173/#/skills',
  observations: [
    '翠绿屏障技能行显示复用代表图；效果列表有法术护盾及成功格挡消费两个效果。消费详情为无生命周期、施法者、生命周期移除并引用spell_shield。',
    '规则列表显示来源对象初始化完成和法术护盾成功阻挡两条规则。打开成功规则，选择废除法术护盾，执行当前目标的consume_spell_shield，无额外条件组；未改动取消。',
    '海妖杀手技能行显示复用代表图；参数列表显示角色等级1至8为150、9为155、18为200，4秒计数时长、1.75上限与0.8远程倍率分开。',
  ], readbacks,
  boundary: '真实页面查看与后续独立GET；未执行战斗或Wasm，恢复计时、攻击计数和资料未明确支路继续补录。',
};
fs.writeFileSync(new URL('页面验收.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, readbacks: readbacks.length, businessPayloadUnchanged: true }));

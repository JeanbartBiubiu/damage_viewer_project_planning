import fs from 'node:fs';
import assert from 'node:assert/strict';

const local = name => new URL(name, import.meta.url);
const plan = JSON.parse(fs.readFileSync(local('./完整候选.json'), 'utf8'));
const targets = [
  ['xinzhao_e', 'parameters', 'parameterKey', 'permanent_bonus_attack_speed_ratio'],
  ['xinzhao_e', 'parameters', 'parameterKey', 'attack_speed_duration_ms'],
  ['xinzhao_e', 'effects', 'effectKey', 'charge_attack_speed'],
  ['trundle_q', 'parameters', 'parameterKey', 'sap_duration_ms'],
  ['trundle_q', 'effects', 'effectKey', 'target_attack_damage_loss'],
  ['sett_e', 'trigger-rules', 'ruleKey', 'actual_hit'],
];
const reads = [];
function compare(expected, actual, label) {
  if (!expected || typeof expected !== 'object') { assert.deepEqual(actual, expected, label); return; }
  if (Array.isArray(expected)) { assert.equal(actual.length, expected.length, label); expected.forEach((value, index) => compare(value, actual[index], `${label}/${index}`)); return; }
  for (const [key, value] of Object.entries(expected)) compare(value, actual[key], `${label}/${key}`);
}
async function get(route) {
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
    headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, route);
  const record = { route, status: response.status, checkedAt: new Date().toISOString(), data: await response.json() };
  reads.push(record);
  return record.data;
}
for (const [skillKey, collection, keyField, key] of targets) {
  const field = collection === 'trigger-rules' ? 'triggerRules' : collection;
  const expected = plan.skills[skillKey].write[field].find(row => row[keyField] === key);
  assert.ok(expected, `${skillKey}/${key}`);
  compare(expected, await get(`/skills/${skillKey}/${collection}/${key}`), `${skillKey}/${key}`);
}
assert.deepEqual(await get('/skills/sett_e/processes'), []);
for (const key of ['xinzhao_e', 'trundle_q', 'sett_e']) {
  const image = (await get(`/skills/${key}/representative-image`)).image;
  assert.ok(image?.imageKey);
  assert.equal(image.enabled, true);
}
const report = {
  checkedAt: new Date().toISOString(), method: '主负责人CUA真实浏览器查看，随后独立GET',
  pages: [
    { skillKey: 'xinzhao_e', observed: ['自身永久额外攻速比例位于计算时传入、小数；说明明确排除E与其他临时攻速', 'charge_attack_speed按来源对象实例、引用attack_speed_duration_ms、持续生效、施加时留存', '结果作用施法者，引用attack_speed_bonus公式，额外攻击速度比例增加、属性固定加算'] },
    { skillKey: 'trundle_q', observed: ['target_attack_damage_loss按来源与承受对象实例，引用sap_duration_ms', '结果为当前目标攻击力减少，持续生效、施加时留存、引用同名参数'] },
    { skillKey: 'sett_e', observed: ['actual_hit规则显示技能命中事件、0条件组、1动作', '代表图图像节点已加载；4个未保存空过程以独立400/404证据为准'] },
  ],
  pageWrites: 0, reads, passed: true,
  experience: '详情及目录加载期间短暂显示空默认值、暂无结果或目录不完整提示，加载后内容正确。验收等待实际值和目录名称稳定，效率提示后置处理。',
  runtimeValidation: '未执行；页面可查看和独立GET不表示29个未接线效果已触发，也不验证动态输入生产。',
};
fs.writeFileSync(local('./页面验收.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pageCount: report.pages.length, independentGetCount: reads.length, pageWrites: 0, passed: true }));

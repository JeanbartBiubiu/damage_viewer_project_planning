import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

// 真实浏览器完成参数、公式、效果复制与三条规则切换后，清理唯一旧效果。
assert.equal(process.argv[2], '--apply', '仅在页面录入完成后执行');
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const out = new URL('../../output/authoring-simplification/', import.meta.url);
const before = JSON.parse(await fs.readFile(new URL('after-lifecycle-expected.json', out), 'utf8'));
assert.ok((await fs.stat(new URL('test0221-before-source-cost-20260906.dump', out))).size > 0);
const expected = structuredClone(before);
const events = [];
async function call(method, path, status = 200) {
  const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer local-aggregate-acceptance-placeholder' } });
  const raw = await response.text();
  assert.equal(response.status, status, `${method} ${path}: ${response.status} ${raw}`);
  events.push({ method, path, status });
  return raw ? JSON.parse(raw) : null;
}
const path = '/skills/ez_w';
const parameter = await call('GET', path + '/parameters/source_cast_mana_cost');
assert.equal(parameter.valueType, 'DECIMAL');
assert.equal(parameter.valueMode, 'RUNTIME_INPUT');
assert.equal(parameter.fixedValue, null);
assert.equal(parameter.levelValues, null);
const formula = await call('GET', path + '/formulas/mana_restore_total');
assert.deepEqual(formula.expression, { nodeType: 'OPERATION', operation: 'ADD', operands: [
  { nodeType: 'PARAMETER', parameterKey: 'mana_restore_base' },
  { nodeType: 'PARAMETER', parameterKey: 'source_cast_mana_cost' }
] });
const original = await call('GET', path + '/effects/detonate_by_skill');
assert.deepEqual(original, before.skills.ez_w.effects.find(item => item.effectKey === 'detonate_by_skill'));
const copy = await call('GET', path + '/effects/detonate_with_mana_refund');
assert.equal(copy.lifecycle, null);
assert.equal(copy.results.length, 2);
assert.deepEqual(copy.results[0], original.results[0]);
const oldRestore = original.results[1];
assert.deepEqual(copy.results[1], { ...oldRestore, resultKey: 'restore_mana', name: '回复法力',
  description: '回复基础60加引爆技能该次施放的法力消耗。',
  valueRule: { ...oldRestore.valueRule, value: { kind: 'FORMULA', formulaKey: 'mana_restore_total' } } });
for (const skill of ['ez_q', 'ez_e', 'ez_r']) {
  const key = `detonate_private_mark_on_${skill}_hit`;
  const rule = await call('GET', path + '/trigger-rules/' + key);
  const previous = before.skills.ez_w['trigger-rules'].find(item => item.ruleKey === key);
  const wanted = { ...previous, description: '来源技能实际命中且存在自身来源的 W 印记时，消费印记并结算引爆伤害，回复60加该次来源施放法力消耗；法术护盾阻挡条件待命中上下文步骤补齐。',
    actions: previous.actions.map(action => ({ ...action, detail: { effectKey: 'detonate_with_mana_refund' }, runtimeInputBindings: [{
      bindingKey: 'source_cast_mana', parameterKey: 'source_cast_mana_cost', sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: { attributeKey: 'mana' }
    }] })) };
  assert.deepEqual(rule, wanted, '整条规则必须仅包含已确认调整');
  expected.skills.ez_w['trigger-rules'] = expected.skills.ez_w['trigger-rules'].map(item => item.ruleKey === key ? rule : item);
}
// 删除仍由后端引用保护兜底；失败不得继续生成已完成快照。
await call('DELETE', path + '/effects/detonate_by_skill', 204);
await call('GET', path + '/effects/detonate_by_skill', 404);
expected.skills.ez_w.parameters.push(parameter);
expected.skills.ez_w.formulas.push(formula);
expected.skills.ez_w.effects = expected.skills.ez_w.effects.filter(item => item.effectKey !== 'detonate_by_skill');
expected.skills.ez_w.effects.push(copy);
expected.capturedAt = new Date().toISOString();
await fs.writeFile(new URL('after-source-cost-expected.json', out), JSON.stringify(expected, null, 2));
await fs.writeFile(new URL('source-cost-browser-evidence.json', out), JSON.stringify({ checkedAt: new Date().toISOString(),
  runtimeExecuted: false, removedEffect: 'detonate_by_skill', changedRules: 3, events }, null, 2));
console.log(JSON.stringify({ rules: 3, removedEffects: 1, newParameters: 1, newFormulas: 1, runtimeExecuted: false }));

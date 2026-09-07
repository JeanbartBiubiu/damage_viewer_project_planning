import fs from 'node:fs';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8080/api/admin/games/lol/skills/nasus_';
async function get(slot, endpoint) {
  const r = await fetch(base + slot + endpoint, { headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(30000) });
  assert.equal(r.status, 200);
  return r.json();
}
const samples = [];
async function check(slot, formulaKey, rank, attrs, inputs, expected) {
  const parameters = await get(slot, '/parameters');
  const formula = await get(slot, '/formulas/' + formulaKey);
  function evaluate(node) {
    if (node.nodeType === 'PARAMETER') {
      const p = parameters.find(p => p.parameterKey === node.parameterKey);
      assert.ok(p);
      if (p.valueMode === 'FIXED') return p.fixedValue;
      if (p.valueMode === 'SKILL_LEVEL') return p.levelValues[rank];
      if (p.valueMode === 'RUNTIME_INPUT') { assert.ok(Object.hasOwn(inputs, p.parameterKey)); return inputs[p.parameterKey]; }
      throw new Error('未覆盖的参数模式');
    }
    if (node.nodeType === 'ATTRIBUTE') {
      const key = `${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`;
      assert.ok(Object.hasOwn(attrs, key), key); return attrs[key];
    }
    assert.equal(node.nodeType, 'OPERATION');
    assert.equal(node.operands.length, 2);
    const [a, b] = node.operands.map(evaluate);
    if (node.operation === 'ADD') return a + b;
    assert.equal(node.operation, 'MULTIPLY'); return a * b;
  }
  const actual = evaluate(formula.expression);
  assert.ok(Math.abs(actual - expected) < 1e-8, `${slot}.${formulaKey}: ${actual} != ${expected}`);
  samples.push({ slot, formulaKey, rank, attrs, inputs, expected, actual, passed: true });
}
await check('q', 'bonus_damage', 1, {}, { q_stack_damage: 0 }, 40);
await check('q', 'bonus_damage', 5, {}, { q_stack_damage: 600 }, 720);
await check('w', 'initial_attack_speed_slow_ratio', 1, {}, {}, .2625);
await check('w', 'max_attack_speed_slow_ratio', 5, {}, {}, .7125);
await check('e', 'initial_damage', 1, { 'SOURCE.ability_power.TOTAL': 0 }, {}, 50);
await check('e', 'initial_damage', 5, { 'SOURCE.ability_power.TOTAL': 200 }, {}, 290);
await check('e', 'damage_per_second', 5, { 'SOURCE.ability_power.TOTAL': 200 }, {}, 58);
await check('r', 'damage_per_second', 1, { 'SOURCE.ability_power.TOTAL': 0, 'TARGET.hp.TOTAL': 2000 }, {}, 60);
await check('r', 'damage_per_second', 3, { 'SOURCE.ability_power.TOTAL': 200, 'TARGET.hp.TOTAL': 2000 }, {}, 140);
const p = await get('p', '/parameters/life_steal_ratio');
for (const [level, expected] of [[1, .1], [6, .1], [7, .15], [12, .15], [13, .2], [18, .2]]) {
  assert.equal(p.levelValues[level], expected);
  samples.push({ slot: 'p', parameterKey: p.parameterKey, level, expected, actual: p.levelValues[level], passed: true });
}
const passive = await get('p', '/effects/soul_eater_lifesteal');
assert.equal(passive.lifecycle.expiryMode, 'EXPLICIT_ONLY');
assert.equal(passive.results[0].lifecycleBehavior.valueReadMode, 'MOMENT_EVALUATION');
assert.equal(passive.results[0].detail.modifierZoneKey, 'attribute_flat_add');
const r = await get('r', '/effects/fury_attributes');
assert.deepEqual(r.results.map(x => x.detail.attributeKey).sort(), ['armor', 'hp', 'magic_resistance']);
assert.deepEqual(r.lifecycle.durationValue, { kind: 'PARAMETER', parameterKey: 'duration_ms' });
const output = { checkedAt: new Date().toISOString(), samples, passed: true, structuralChecks: 5,
  boundary: '读取真实保存的公式与参数计算样例，非战斗执行或Wasm验收' };
fs.writeFileSync(new URL('./算术核对.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ samples: samples.length, structuralChecks: output.structuralChecks, passed: true }));

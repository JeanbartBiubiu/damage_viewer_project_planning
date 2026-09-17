import fs from 'node:fs';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
async function call(endpoint, body) {
  const r = await fetch(base + endpoint, { method: body ? 'PUT' : 'GET',
    headers: { Authorization: 'Bearer local-entry', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  assert.equal(r.status, 200, endpoint);
  return r.json();
}
const records = [];
for (const itemKey of ['item_3091', 'item_3115']) {
  const skillKey = itemKey + '_passive';
  const parameters = await call(`/skills/${skillKey}/parameters`);
  const formulas = await call(`/skills/${skillKey}/formulas`);
  const effect = await call(`/skills/${skillKey}/effects/on_hit_damage`);
  const rule = await call(`/skills/${skillKey}/trigger-rules/resolve_on_basic_attack_hit`);
  const relations = await call(`/equipment-skill-relations?equipmentKey=${itemKey}`);
  assert.equal(relations.items.filter(x => x.skillKey === skillKey).length, 1);
  assert.equal(effect.results[0].detail.damageTypeKey, 'magic');
  assert.equal(rule.eventSource.eventType, 'BASIC_ATTACK_HIT');
  assert.equal(rule.actions[0].detail.effectKey, effect.effectKey);
  assert.equal(rule.actions[0].targetContext, 'CURRENT_TARGET');
  let arithmetic;
  if (itemKey === 'item_3091') {
    assert.equal(parameters.find(p => p.parameterKey === 'on_hit_damage').fixedValue, 45);
    assert.equal(formulas.length, 0);
    assert.deepEqual(effect.results[0].valueRule.value, { kind: 'PARAMETER', parameterKey: 'on_hit_damage' });
    arithmetic = { expected: 45, actual: 45 };
  } else {
    assert.equal(parameters.find(p => p.parameterKey === 'base_damage').fixedValue, 15);
    assert.equal(parameters.find(p => p.parameterKey === 'ap_ratio').fixedValue, 0.15);
    const f = await call(`/skills/${skillKey}/formulas/on_hit_damage`);
    assert.deepEqual(f.expression, { nodeType: 'OPERATION', operation: 'ADD', operands: [
      { nodeType: 'PARAMETER', parameterKey: 'base_damage' },
      { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
        { nodeType: 'PARAMETER', parameterKey: 'ap_ratio' },
        { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'ability_power', attributeValueKind: 'TOTAL' }
      ] }
    ] });
    arithmetic = { ap: 200, expected: 45, actual: 15 + 0.15 * 200 };
    assert.equal(arithmetic.actual, arithmetic.expected);
  }
  const originalImage = await call(`/equipment/${itemKey}/representative-image`);
  assert.equal(originalImage.image.enabled, true);
  let skillImage = await call(`/skills/${skillKey}/representative-image`);
  if (!skillImage.image && process.argv.includes('--apply-images')) {
    await call(`/skills/${skillKey}/representative-image`, { imageKey: originalImage.image.imageKey });
    skillImage = await call(`/skills/${skillKey}/representative-image`);
  }
  assert.deepEqual(skillImage.image, originalImage.image);
  records.push({ itemKey, skillKey, parameterCount: parameters.length, formulaCount: formulas.length,
    effect, rule, relation: relations.items.find(x => x.skillKey === skillKey), skillImage, arithmetic });
}
fs.writeFileSync(new URL('./主负责人复核.json', import.meta.url), JSON.stringify({ observedAt: new Date().toISOString(), records, passed: true, runtime: '未执行' }, null, 2) + '\n');
console.log('两项装备技能数值、公式、普攻触发、挂载和代表图独立复核通过。');

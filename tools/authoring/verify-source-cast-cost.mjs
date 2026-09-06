import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

// 仅验证管理配置；此脚本不生产或执行真实施放消耗快照。
const base = 'http://127.0.0.1:8081/api/admin/games/lol';
const key = 'source_cast_verification';
const root = `/skills/${key}`;
const events = [];
async function call(method, path, body, expected) {
  const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer local-aggregate-acceptance-placeholder', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  events.push({ method, path, status: response.status });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${path}: ${response.status} ${text}`);
  return value;
}
const meta = name => ({ name, description: '来源施放消耗配置验收', sortOrder: 10 });
const update = (body, key) => { const result = structuredClone(body); delete result[key]; return result; };
const parameter = (parameterKey, valueMode = 'RUNTIME_INPUT', valueType = 'DECIMAL') => ({ parameterKey, ...meta(parameterKey), valueMode, valueType, fixedValue: valueMode === 'FIXED' ? 60 : null, levelValues: null });
const formula = { formulaKey: 'refund', ...meta('基础加来源消耗'), expression: { nodeType: 'OPERATION', operation: 'ADD', operands: [{ nodeType: 'PARAMETER', parameterKey: 'base' }, { nodeType: 'PARAMETER', parameterKey: 'cost' }] } };
function effect(effectKey, value = { kind: 'FORMULA', formulaKey: 'refund' }) {
  return { effectKey, ...meta(effectKey), lifecycle: null, results: [{ resultKey: 'restore', ...meta('恢复法力'), resultType: 'RESOURCE_CHANGE', target: 'SOURCE', valueRule: { value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: { attributeKey: 'mana', operation: 'RESTORE' }, lifecycleBehavior: null, spellShieldBlockScope: null }] };
}
const binding = { bindingKey: 'source_cost', parameterKey: 'cost', sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: { attributeKey: 'mana' } };
function rule(ruleKey, source = binding, effectKey = 'refund') {
  return { ruleKey, ...meta(ruleKey), eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: key, useKind: null } }, conditionGroups: [], actions: [{ actionKey: 'refund', name: '恢复法力', sortOrder: 10, actionType: 'EXECUTE_EFFECT', targetContext: 'CURRENT_TARGET', detail: { effectKey }, runtimeInputBindings: [source], resultModifiers: [] }], perTargetCooldown: null, maxTriggersPerProcess: null };
}
let created = false;
try {
  await call('GET', root, undefined, 404);
  await call('POST', '/skills', { skillKey: key, ...meta('来源施放消耗验收'), maxLevel: 1, status: 'ENABLED', skillCategoryKeys: [] }, 201); created = true;
  for (const item of [parameter('base', 'FIXED'), parameter('cost'), parameter('integer_cost', 'RUNTIME_INPUT', 'INTEGER')]) await call('POST', root + '/parameters', item, 201);
  await call('POST', root + '/formulas', formula, 201);
  await call('POST', root + '/effects', effect('refund'), 201);
  const savedRule = rule('on_hit');
  await call('POST', root + '/trigger-rules', savedRule, 201);
  assert.deepEqual(await call('GET', root + '/trigger-rules/on_hit', undefined, 200), savedRule);
  for (const [index, detail] of [{}, { attributeKey: '' }, { attributeKey: null }, { attributeKey: ['mana'] }, { attributeKey: 'missing' }, { attributeKey: 'mana', sourceSkillKey: key }, { attributeKey: 'mana', stateKey: 'state' }].entries()) {
    await call('POST', root + '/trigger-rules', rule('invalid_detail_' + index, { ...binding, detail }), 400);
  }
  const missingSource = rule('missing_source'); missingSource.eventSource.detail.sourceSkillKey = null;
  await call('POST', root + '/trigger-rules', missingSource, 400);
  const attack = rule('attack'); attack.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
  await call('POST', root + '/trigger-rules', attack, 400);
  await call('POST', root + '/effects', effect('integer_refund', { kind: 'PARAMETER', parameterKey: 'integer_cost' }), 201);
  await call('POST', root + '/trigger-rules', rule('integer_rule', { ...binding, parameterKey: 'integer_cost' }, 'integer_refund'), 400);
  await call('POST', root + '/trigger-rules', rule('unreachable', { ...binding, parameterKey: 'integer_cost' }), 400);
  const changedSourceType = update(savedRule, 'ruleKey');
  changedSourceType.actions[0].runtimeInputBindings[0] = { ...binding, sourceType: 'EVENT_VALUE', detail: { valueKey: 'HIT_INDEX' } };
  await call('PUT', root + '/trigger-rules/on_hit', changedSourceType, 400);
  const changedEvent = update(savedRule, 'ruleKey'); changedEvent.eventSource.detail.sourceSkillKey = null;
  await call('PUT', root + '/trigger-rules/on_hit', changedEvent, 400);
  assert.deepEqual(await call('GET', root + '/trigger-rules/on_hit', undefined, 200), savedRule);
  await call('PUT', root + '/parameters/cost', update(parameter('cost', 'RUNTIME_INPUT', 'INTEGER'), 'parameterKey'), 400);
  const fixedZero = update(parameter('cost', 'FIXED'), 'parameterKey'); fixedZero.fixedValue = 0;
  await call('PUT', root + '/parameters/cost', fixedZero, 400);
  const savedCost = await call('GET', root + '/parameters/cost', undefined, 200);
  assert.equal(savedCost.valueType, 'DECIMAL'); assert.equal(savedCost.valueMode, 'RUNTIME_INPUT'); assert.equal(savedCost.fixedValue, null);
  const changedFormula = update(formula, 'formulaKey'); changedFormula.expression = { nodeType: 'PARAMETER', parameterKey: 'base' };
  await call('PUT', root + '/formulas/refund', changedFormula, 400);
  assert.deepEqual((await call('GET', root + '/formulas/refund', undefined, 200)).expression, formula.expression);
  await call('DELETE', root + '/parameters/cost', undefined, 409);
  await fs.writeFile(new URL('../../output/authoring-simplification/source-cast-cost-evidence.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), runtimeSnapshotExecuted: false, checks: ['binding_roundtrip', 'strict_detail', 'known_attribute', 'explicit_source_skill', 'skill_hit_only', 'decimal_parameter_only', 'reachable_parameter_only', 'immutable_binding_source', 'event_reverse_guard', 'parameter_reverse_guard', 'formula_reverse_guard', 'parameter_delete_guard'], events }, null, 2));
  console.log(JSON.stringify({ checks: 12, requests: events.length, runtimeSnapshotExecuted: false }));
} finally {
  if (created) {
    await call('DELETE', root, undefined, 204);
    await call('GET', root, undefined, 404);
    console.log('专属来源施放消耗验收技能已清理');
  }
}

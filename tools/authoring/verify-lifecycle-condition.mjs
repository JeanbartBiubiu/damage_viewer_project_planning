import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

// 仅操作本次恢复副本中的专属技能；既有同名数据会使验收停止。
const base = 'http://127.0.0.1:8081/api/admin/games/lol';
const key = 'lifecycle_condition_verification';
const root = `/skills/${key}`;
const events = [];
async function call(method, path, body, expected) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-aggregate-acceptance-placeholder' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  events.push({ method, path, status: response.status, code: value?.error?.code });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${path}: ${response.status} ${text}`);
  return value;
}
const meta = name => ({ name, description: '直接生命周期条件验收', sortOrder: 10 });
const fixed = value => ({ kind: 'FIXED', value });
const parameterValue = parameterKey => ({ kind: 'PARAMETER', parameterKey });
const formulaValue = formulaKey => ({ kind: 'FORMULA', formulaKey });
const update = (object, key) => { const result = structuredClone(object); delete result[key]; return result; };
function effect(effectKey, instanceScope = 'SOURCE_TARGET') {
  return { effectKey, ...meta(effectKey), lifecycle: instanceScope ? {
    durationValue: fixed(4000), maxStacksValue: fixed(1), applicationStacksValue: fixed(1), instanceScope,
    reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null, firstPeriodicExecution: null,
  } : null, results: [{ resultKey: 'damage', ...meta('伤害'), resultType: 'DAMAGE', target: 'TARGET',
    valueRule: { value: fixed(10), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: { damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierValue: null }, vampRules: [] },
    lifecycleBehavior: instanceScope ? { moment: 'EARLY_REMOVE', valueReadMode: 'APPLICATION_SNAPSHOT', periodicExecutionMode: null, stackValueMode: null, reapplicationValueMode: null } : null,
    spellShieldBlockScope: null }] };
}
function condition(checkKind = 'PRESENT', comparisonValue = null, effectKey = 'mark', subject = 'CURRENT_TARGET') {
  return { conditionKey: 'mark_check', conditionType: 'LIFECYCLE_CHECK', sortOrder: 10,
    detail: { effectKey, subject, checkKind, comparator: checkKind === 'STACKS_COMPARE' ? 'GTE' : null, comparisonValue } };
}
function rule(ruleKey, check = condition()) {
  return { ruleKey, ...meta(ruleKey), eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
    conditionGroups: [{ groupKey: 'mark_group', name: '生命周期检查', sortOrder: 10, conditions: [check] }],
    actions: [{ actionKey: 'run', name: '执行伤害', sortOrder: 10, actionType: 'EXECUTE_EFFECT', targetContext: 'CURRENT_TARGET', detail: { effectKey: 'hit' }, runtimeInputBindings: [], resultModifiers: [] }],
    perTargetCooldown: null, maxTriggersPerProcess: null };
}
let created = false;
try {
  await call('GET', root, undefined, 404);
  await call('POST', '/skills', { skillKey: key, ...meta('生命周期条件验收'), maxLevel: 1, status: 'ENABLED', skillCategoryKeys: [] }, 201); created = true;
  const threshold = { parameterKey: 'threshold', ...meta('阈值'), valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1, levelValues: null };
  const runtime = { ...threshold, parameterKey: 'runtime', valueMode: 'RUNTIME_INPUT', fixedValue: null };
  await call('POST', root + '/parameters', threshold, 201);
  await call('POST', root + '/parameters', runtime, 201);
  const formula = { formulaKey: 'threshold', ...meta('阈值公式'), expression: { nodeType: 'PARAMETER', parameterKey: 'threshold' } };
  await call('POST', root + '/formulas', formula, 201);
  for (const item of [effect('hit', null), effect('mark'), effect('skill_mark', 'SKILL'), effect('source_mark', 'SOURCE'), effect('target_mark', 'TARGET')]) {
    await call('POST', root + '/effects', item, 201);
  }
  const storedRule = rule('check');
  await call('POST', root + '/trigger-rules', storedRule, 201);
  for (const check of [condition(), condition('ABSENT'), condition('STACKS_COMPARE', fixed(0)), condition('STACKS_COMPARE', parameterValue('threshold')), condition('STACKS_COMPARE', formulaValue('threshold'))]) {
    const body = update(rule('check', check), 'ruleKey');
    await call('PUT', root + '/trigger-rules/check', body, 200);
    const read = await call('GET', root + '/trigger-rules/check', undefined, 200);
    assert.deepEqual(read.conditionGroups[0].conditions[0], check);
  }
  await call('POST', root + '/trigger-rules', rule('direct_threshold', condition('STACKS_COMPARE', parameterValue('threshold'))), 201);
  for (const [effectKey, subject] of [['skill_mark', null], ['source_mark', null], ['target_mark', 'CURRENT_TARGET']]) {
    await call('POST', root + '/trigger-rules', rule(effectKey, condition('PRESENT', null, effectKey, subject)), 201);
  }
  const invalidConditions = [
    condition('PRESENT', fixed(1)),
    condition('STACKS_COMPARE', null),
    condition('STACKS_COMPARE', fixed(-1)),
    condition('STACKS_COMPARE', fixed(1.5)),
    condition('STACKS_COMPARE', parameterValue('runtime')),
    condition('PRESENT', null, 'missing'),
    condition('PRESENT', null, 'essence_flux_mark'),
    condition('PRESENT', null, 'hit'),
    condition('PRESENT', null, 'mark', null),
    condition('PRESENT', null, 'skill_mark', 'CURRENT_TARGET'),
    condition('PRESENT', null, 'mark', 'EVENT_SOURCE'),
  ];
  const foreign = condition(); foreign.detail.stateKey = 'old_counter'; invalidConditions.push(foreign);
  for (const [index, check] of invalidConditions.entries()) {
    await call('POST', root + '/trigger-rules', rule('invalid_' + index, check), 400);
  }
  await call('DELETE', root + '/effects/mark', undefined, 409);
  await call('PUT', root + '/effects/mark', update(effect('mark', null), 'effectKey'), 409);
  await call('PUT', root + '/effects/mark', update(effect('mark', 'SOURCE'), 'effectKey'), 400);
  assert.equal((await call('GET', root + '/effects/mark', undefined, 200)).lifecycle.instanceScope, 'SOURCE_TARGET');
  await call('DELETE', root + '/parameters/threshold', undefined, 409);
  await call('DELETE', root + '/formulas/threshold', undefined, 409);
  const changedParameter = update({ ...threshold, valueMode: 'RUNTIME_INPUT', fixedValue: null }, 'parameterKey');
  await call('PUT', root + '/parameters/threshold', changedParameter, [400, 409]);
  assert.equal((await call('GET', root + '/parameters/threshold', undefined, 200)).valueMode, 'FIXED');
  const changedFormula = update(formula, 'formulaKey'); changedFormula.expression.parameterKey = 'runtime';
  await call('PUT', root + '/formulas/threshold', changedFormula, [400, 409]);
  assert.deepEqual((await call('GET', root + '/formulas/threshold', undefined, 200)).expression, formula.expression);
  await fs.writeFile(new URL('../../output/authoring-simplification/lifecycle-condition-evidence.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), checks: ['three_checks_roundtrip', 'three_value_sources', 'zero_stacks_threshold', 'scope_subject_selection', 'strict_shape', 'integer_threshold', 'current_skill_lifecycle_only', 'missing_subject', 'event_source_availability', 'effect_delete_guard', 'lifecycle_removal_guard', 'immutable_scope', 'reference_delete_guard', 'reverse_runtime_guard'], events }, null, 2));
  console.log(JSON.stringify({ checks: 14, requests: events.length }));
} finally {
  if (created) {
    await call('DELETE', root, undefined, 204);
    await call('GET', root, undefined, 404);
    console.log('专属生命周期验收技能已清理');
  }
}

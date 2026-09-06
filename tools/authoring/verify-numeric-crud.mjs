import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

// 仅对本次专属恢复副本的独立技能操作；同名数据存在时停止。
const base = 'http://127.0.0.1:8081/api/admin/games/lol';
const key = 'numeric_verification';
const root = `/skills/${key}`;
const events = [];
async function call(method, path, body, expected) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-aggregate-acceptance-placeholder' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  events.push({ method, path, status: response.status, code: value?.error?.code });
  if (expected !== undefined) assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${path}: ${response.status} ${text}`);
  return { status: response.status, value };
}
const get = async path => (await call('GET', path, undefined, 200)).value;
const meta = name => ({ name, description: '直接数值取值验收', sortOrder: 10 });
const fixed = value => ({ kind: 'FIXED', value });
const parameterValue = parameterKey => ({ kind: 'PARAMETER', parameterKey });
const formulaValue = formulaKey => ({ kind: 'FORMULA', formulaKey });
const parameter = (parameterKey, value = 1) => ({ parameterKey, ...meta(parameterKey), valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: value, levelValues: null });
const update = (body, key) => { const value = structuredClone(body); delete value[key]; return value; };
const skill = { skillKey: key, ...meta('直接数值验收'), maxLevel: 1, status: 'ENABLED', skillCategoryKeys: [] };
const formula = { formulaKey: 'one', ...meta('公式一'), expression: { nodeType: 'PARAMETER', parameterKey: 'one' } };
function effect(effectKey, value) {
  return { effectKey, ...meta(effectKey), lifecycle: null, results: [{ resultKey: 'damage', ...meta('伤害'), resultType: 'DAMAGE', target: 'TARGET', valueRule: { value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: { damageTypeKey: 'physics', deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierValue: null }, vampRules: [] }, lifecycleBehavior: null, spellShieldBlockScope: null }] };
}
function rule(ruleKey, actionType, targetKey, bindings = []) {
  return { ruleKey, ...meta(ruleKey), eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }, conditionGroups: [], actions: [{ actionKey: 'run', name: '执行', sortOrder: 10, actionType, targetContext: 'CURRENT_TARGET', detail: actionType === 'EXECUTE_EFFECT' ? { effectKey: targetKey } : { processKey: targetKey }, runtimeInputBindings: bindings, resultModifiers: [] }], perTargetCooldown: null, maxTriggersPerProcess: null };
}
let created = false;
try {
  await call('GET', root, undefined, 404);
  await call('POST', '/skills', skill, 201); created = true;
  await call('POST', root + '/parameters', parameter('one'), 201);
  await call('POST', root + '/formulas', formula, 201);
  const zeroEffect = effect('hit', fixed(0));
  await call('POST', root + '/effects', zeroEffect, 201);
  assert.deepEqual((await get(root + '/effects/hit')).results[0].valueRule.value, fixed(0));
  for (const value of [parameterValue('one'), formulaValue('one')]) {
    await call('PUT', root + '/effects/hit', update(effect('hit', value), 'effectKey'), 200);
    assert.deepEqual((await get(root + '/effects/hit')).results[0].valueRule.value, value);
  }
  const exactDecimal = '0.12345678901234567890123456789';
  const rawPreciseBody = JSON.stringify(effect('precise', fixed(0))).replace('"kind":"FIXED","value":0', `"kind":"FIXED","value":${exactDecimal}`);
  const preciseResponse = await fetch(base + root + '/effects', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-aggregate-acceptance-placeholder' }, body: rawPreciseBody });
  const preciseText = await preciseResponse.text();
  assert.equal(preciseResponse.status, 201, preciseText);
  assert.ok(preciseText.includes(exactDecimal), `HTTP 输入不能先转换为双精度数值：${preciseText}`);
  const preciseRead = await fetch(base + root + '/effects/precise', { headers: { Authorization: 'Bearer local-aggregate-acceptance-placeholder' } });
  assert.equal(preciseRead.status, 200);
  assert.ok((await preciseRead.text()).includes(exactDecimal), '数据库读回必须保留十进制精度');
  events.push({ method: 'POST', path: root + '/effects', status: 201, exactDecimalPreserved: true });
  events.push({ method: 'GET', path: root + '/effects/precise', status: 200, exactDecimalPreserved: true });
  const mixed = effect('bad_mixed', { ...fixed(1), parameterKey: 'one' });
  await call('POST', root + '/effects', mixed, 400);
  await call('POST', root + '/effects', effect('bad_string', fixed('1')), 400);
  const oldField = effect('bad_old', fixed(1)); delete oldField.results[0].valueRule.value; oldField.results[0].valueRule.formulaKey = 'one';
  await call('POST', root + '/effects', oldField, 400);

  await call('POST', root + '/parameters', parameter('direct_only'), 201);
  await call('POST', root + '/effects', effect('direct', parameterValue('direct_only')), 201);
  await call('DELETE', root + '/parameters/direct_only', undefined, 409);
  await call('POST', root + '/trigger-rules', rule('on_hit', 'EXECUTE_EFFECT', 'hit'), 201);
  await call('POST', root + '/trigger-rules', rule('on_direct', 'EXECUTE_EFFECT', 'direct'), 201);
  for (const parameterKey of ['one', 'direct_only']) {
    const runtimeChange = update(parameter(parameterKey), 'parameterKey'); runtimeChange.valueMode = 'RUNTIME_INPUT'; runtimeChange.fixedValue = null;
    await call('PUT', root + '/parameters/' + parameterKey, runtimeChange, [400, 409]);
    assert.equal((await get(root + '/parameters/' + parameterKey)).valueMode, 'FIXED');
  }

  const runtime = parameter('runtime'); runtime.valueMode = 'RUNTIME_INPUT'; runtime.fixedValue = null;
  await call('POST', root + '/parameters', runtime, 201);
  await call('POST', root + '/effects', effect('runtime_hit', parameterValue('runtime')), 201);
  await call('POST', root + '/trigger-rules', rule('unbound', 'EXECUTE_EFFECT', 'runtime_hit'), [400, 409]);
  await call('GET', root + '/trigger-rules/unbound', undefined, 404);
  const changedFormula = update(formula, 'formulaKey'); changedFormula.expression.parameterKey = 'runtime';
  await call('PUT', root + '/formulas/one', changedFormula, [400, 409]);
  assert.deepEqual((await get(root + '/formulas/one')).expression, formula.expression);

  const counter = { stateKey: 'counter', ...meta('零上限计数'), stateType: 'COUNTER', scope: 'SKILL', detail: { initialValue: fixed(0), maxValue: fixed(0) } };
  await call('POST', root + '/internal-states', counter, 201);
  assert.deepEqual((await get(root + '/internal-states/counter')).detail, counter.detail);
  const binding = { bindingKey: 'from_counter', parameterKey: 'runtime', sourceType: 'INTERNAL_STATE', detail: { stateKey: 'counter', valueKind: 'VALUE', optionKey: null } };
  await call('POST', root + '/trigger-rules', rule('bound', 'EXECUTE_EFFECT', 'runtime_hit', [binding]), 201);
  assert.deepEqual((await get(root + '/trigger-rules/bound')).actions[0].runtimeInputBindings, [binding]);

  const interval = parameter('interval'); interval.valueMode = 'SKILL_LEVEL'; interval.fixedValue = null; interval.levelValues = { '1': 100 };
  await call('POST', root + '/parameters', interval, 201);
  const process = { processKey: 'process', ...meta('带计数初始化的过程'), activationType: 'PASSIVE', cooldown: null,
    steps: [{ stepKey: 'step', ...meta('周期步骤'), stepType: 'PERIODIC', detail: { repeatCountValue: fixed(1), intervalValue: parameterValue('interval'), firstExecution: 'AFTER_INTERVAL' } }],
    effectBindings: [{ bindingKey: 'hit', effectKey: 'hit', sortOrder: 10, moment: { momentType: 'PROCESS_START', stepKey: null } }],
    stateOperations: [{ operationKey: 'reset', name: '重置计数', sortOrder: 10, stateKey: 'counter', operation: 'RESET', value: null, optionKey: null, moment: { momentType: 'PROCESS_START', stepKey: null } }] };
  await call('POST', root + '/processes', process, 201);
  await call('POST', root + '/trigger-rules', rule('on_process', 'START_PROCESS', 'process'), 201);
  const fractional = update(process, 'processKey'); fractional.steps[0].detail.repeatCountValue = fixed(1.5);
  await call('PUT', root + '/processes/process', fractional, 400);
  const changedState = update(counter, 'stateKey'); changedState.detail.initialValue = parameterValue('runtime');
  await call('PUT', root + '/internal-states/counter', changedState, [400, 409]);
  assert.deepEqual((await get(root + '/internal-states/counter')).detail, counter.detail);
  const changedProcess = update(process, 'processKey'); changedProcess.steps[0].detail.intervalValue = parameterValue('runtime');
  await call('PUT', root + '/processes/process', changedProcess, [400, 409]);
  assert.deepEqual((await get(root + '/processes/process')).steps[0].detail, process.steps[0].detail);
  const invalidInterval = update(interval, 'parameterKey'); invalidInterval.levelValues['1'] = 0;
  await call('PUT', root + '/parameters/interval', invalidInterval, [400, 409]);
  assert.deepEqual((await get(root + '/parameters/interval')).levelValues, interval.levelValues);
  const zeroCooldown = rule('zero_cooldown', 'EXECUTE_EFFECT', 'hit');
  zeroCooldown.perTargetCooldown = { durationValue: fixed(0), targetContext: 'CURRENT_TARGET' };
  await call('POST', root + '/trigger-rules', zeroCooldown, 400);
  await call('POST', root + '/parameters', parameter('guard_cooldown', 100), 201);
  const guardedRule = rule('guarded_cooldown', 'EXECUTE_EFFECT', 'hit');
  guardedRule.perTargetCooldown = { durationValue: parameterValue('guard_cooldown'), targetContext: 'CURRENT_TARGET' };
  await call('POST', root + '/trigger-rules', guardedRule, 201);
  await call('PUT', root + '/parameters/guard_cooldown', update(parameter('guard_cooldown', 0), 'parameterKey'), [400, 409]);
  assert.equal((await get(root + '/parameters/guard_cooldown')).fixedValue, 100);
  const expandedSkill = update(skill, 'skillKey'); expandedSkill.maxLevel = 2;
  await call('PUT', root, expandedSkill, [400, 409]);
  assert.equal((await get(root)).maxLevel, 1);
  assert.deepEqual((await get(root + '/parameters/interval')).levelValues, interval.levelValues);
  const charge = structuredClone(process); charge.processKey = 'bad_charge'; charge.name = '倒置蓄力区间'; charge.steps = [{ stepKey: 'charge', ...meta('蓄力'), stepType: 'CHARGE', detail: { minimumChargeValue: fixed(1000), maximumChargeValue: fixed(500), releaseAtMaximum: true } }];
  await call('POST', root + '/processes', charge, 400);

  await call('POST', root + '/parameters', parameter('race'), 201);
  const race = await Promise.all([call('POST', root + '/effects', effect('race_hit', parameterValue('race'))), call('DELETE', root + '/parameters/race')]);
  assert.equal(race.filter(item => item.status >= 200 && item.status < 300).length, 1);
  assert.ok(race.some(item => [400, 409].includes(item.status)));
  await fs.writeFile(new URL('../../output/authoring-simplification/numeric-crud-evidence.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), checks: ['three_value_sources', 'decimal_precision', 'zero_and_null', 'strict_shape', 'direct_reference_delete', 'parameter_mode_reverse_guard', 'formula_reverse_guard', 'runtime_bindings', 'state_process_reverse_guard', 'static_parameter_bounds', 'positive_protection_cooldown', 'skill_level_reverse_guard', 'charge_bounds', 'reference_delete_concurrency'], events }, null, 2));
  console.log(JSON.stringify({ checks: 14, requests: events.length, concurrentStatuses: race.map(item => item.status) }));
} finally {
  if (created) {
    await call('DELETE', root, undefined, 204);
    await call('GET', root, undefined, 404);
    console.log('专属数值验收技能已清理');
  }
}

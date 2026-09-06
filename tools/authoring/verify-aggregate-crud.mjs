import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

// 所有写入仅发生在本次恢复副本中的专属技能；已有同名对象时停止。
const base = 'http://127.0.0.1:8081/api/admin/games/lol';
const key = 'aggregate_verification';
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
const metadata = name => ({ name, description: '聚合存储真实数据库验收', sortOrder: 10 });
const parameter = { parameterKey: 'one', ...metadata('常数一'), valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1, levelValues: null };
const formula = { formulaKey: 'value', ...metadata('常数公式'), expression: { nodeType: 'PARAMETER', parameterKey: 'one' } };
const state = { stateKey: 'counter', ...metadata('独立计数'), stateType: 'COUNTER', scope: 'SKILL', detail: { initialValueFormulaKey: 'value', maxValueFormulaKey: 'value' } };
const effect = { effectKey: 'hit', ...metadata('命中伤害'), lifecycle: null, results: [{ resultKey: 'damage', ...metadata('物理伤害'), resultType: 'DAMAGE', target: 'TARGET', valueRule: { formulaKey: 'value', fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: { damageTypeKey: 'physics', deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierFormulaKey: null }, vampRules: [] }, lifecycleBehavior: null, spellShieldBlockScope: null }] };
const process = { processKey: 'process', ...metadata('一次过程'), activationType: 'PASSIVE', cooldown: null, steps: [{ stepKey: 'step', ...metadata('立即执行'), stepType: 'IMMEDIATE', detail: {} }], effectBindings: [{ bindingKey: 'hit', effectKey: 'hit', sortOrder: 10, moment: { momentType: 'PROCESS_START', stepKey: null } }], stateOperations: [{ operationKey: 'set', ...metadata('设置计数'), stateKey: 'counter', operation: 'SET', valueFormulaKey: 'value', optionKey: null, moment: { momentType: 'PROCESS_START', stepKey: null } }] };
const action = { actionKey: 'hit', ...metadata('执行伤害'), actionType: 'EXECUTE_EFFECT', targetContext: 'CURRENT_TARGET', detail: { effectKey: 'hit' }, runtimeInputBindings: [], resultModifiers: [] };
delete action.description;
delete process.stateOperations[0].description;
const rule = { ruleKey: 'on_hit', ...metadata('命中规则'), eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }, conditionGroups: [], actions: [action], perTargetCooldown: null, maxTriggersPerProcess: null };
function updateBody(body, immutableKey) { const result = structuredClone(body); delete result[immutableKey]; return result; }

let created = false;
try {
  await call('GET', root, undefined, 404);
  await call('POST', '/skills', { skillKey: key, ...metadata('聚合验收专用技能'), maxLevel: 1, status: 'ENABLED', skillCategoryKeys: [] }, 201);
  created = true;
  await call('POST', root + '/parameters', parameter, 201);
  for (const [resource, id, body] of [['formulas','formulaKey',formula],['internal-states','stateKey',state],['effects','effectKey',effect],['processes','processKey',process],['trigger-rules','ruleKey',rule]]) {
    await call('POST', root + '/' + resource, body, 201);
    const path = `${root}/${resource}/${body[id]}`;
    assert.equal((await get(path))[id], body[id]);
    const update = updateBody(body, id); update.name += '（已修改）';
    await call('PUT', path, update, 200);
    assert.equal((await get(path)).name, update.name);
  }
  assert.equal((await call('DELETE', root + '/formulas/value', undefined, 409)).value.error.code, '409.SKILL_FORMULA_IN_USE');
  await call('DELETE', root + '/parameters/one', undefined, 409);
  await call('DELETE', root + '/effects/hit', undefined, 409);
  await call('DELETE', root + '/internal-states/counter', undefined, 409);

  const stepRule = { ...rule, ruleKey: 'on_step', name: '步骤完成', eventSource: { eventType: 'PROCESS_MOMENT', detail: { processKey: 'process', moment: { momentType: 'STEP_COMPLETE', stepKey: 'step' } } } };
  await call('POST', root + '/trigger-rules', stepRule, 201);
  const changedProcess = updateBody(process, 'processKey'); changedProcess.steps[0].stepKey = 'other';
  await call('PUT', root + '/processes/process', changedProcess, 409);
  assert.equal((await get(root + '/processes/process')).steps[0].stepKey, 'step');
  const loop = { ...rule, ruleKey: 'loop', name: '禁止无界自循环', eventSource: { eventType: 'PROCESS_MOMENT', detail: { processKey: 'process', moment: { momentType: 'PROCESS_START', stepKey: null } } }, actions: [{ ...action, actionType: 'START_PROCESS', detail: { processKey: 'process' } }] };
  await call('POST', root + '/trigger-rules', loop, [400, 409]);
  await call('GET', root + '/trigger-rules/loop', undefined, 404);

  await call('POST', root + '/parameters', { ...parameter, parameterKey: 'runtime', name: '动态输入', valueMode: 'RUNTIME_INPUT', fixedValue: null }, 201);
  await call('POST', root + '/formulas', { ...formula, formulaKey: 'runtime_value', name: '动态公式', expression: { nodeType: 'PARAMETER', parameterKey: 'runtime' } }, 201);
  const runtimeEffect = structuredClone(effect); runtimeEffect.effectKey = 'runtime_hit'; runtimeEffect.name = '动态伤害'; runtimeEffect.results[0].valueRule.formulaKey = 'runtime_value';
  await call('POST', root + '/effects', runtimeEffect, 201);
  const unbound = structuredClone(rule); unbound.ruleKey = 'unbound'; unbound.name = '缺失输入'; unbound.actions[0].detail.effectKey = 'runtime_hit';
  await call('POST', root + '/trigger-rules', unbound, [400, 409]);
  await call('GET', root + '/trigger-rules/unbound', undefined, 404);

  const statuses = await get('/statuses');
  const statusKey = (Array.isArray(statuses) ? statuses : statuses.items).find(item => item.status === 'ENABLED').statusKey;
  const statusRule = { ...rule, ruleKey: 'status_changed', name: '状态应用事件', eventSource: { eventType: 'STATUS_CHANGED', detail: { subject: 'CURRENT_TARGET', statusKey, change: 'APPLY' } } };
  await call('POST', root + '/trigger-rules', statusRule, 201);
  assert.deepEqual((await get(root + '/trigger-rules/status_changed')).eventSource, statusRule.eventSource);

  await call('POST', root + '/formulas', { ...formula, formulaKey: 'race_value', name: '并发引用目标' }, 201);
  const raceEffect = structuredClone(effect); raceEffect.effectKey = 'race_hit'; raceEffect.name = '并发引用来源'; raceEffect.results[0].valueRule.formulaKey = 'race_value';
  const race = await Promise.all([call('POST', root + '/effects', raceEffect), call('DELETE', root + '/formulas/race_value')]);
  const successes = race.filter(r => r.status >= 200 && r.status < 300);
  assert.equal(successes.length, 1, '新增引用与删除目标必须有一方被拒绝');
  assert.ok(race.some(r => [400,409].includes(r.status)), '并发失败应返回业务冲突');
  if (race[0].status === 201) await get(root + '/formulas/race_value');
  await fs.writeFile(new URL('../../output/authoring-simplification/clone-crud-evidence.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), checks: ['five_aggregates_crud','root_delete_conflicts','referenced_step_delete_rollback','cycle_rejected','missing_runtime_input_rejected','status_event_field_roundtrip','reference_delete_concurrency'], events }, null, 2));
  console.log(JSON.stringify({ checks: 7, requests: events.length, concurrentStatuses: race.map(r=>r.status) }));
} finally {
  if (created) {
    await call('DELETE', root, undefined, 204);
    await call('GET', root, undefined, 404);
    console.log('专属验收技能已清理');
  }
}

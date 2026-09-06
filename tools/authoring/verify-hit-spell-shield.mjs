import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:8081/api/admin/games/lol';
const key = 'hit_shield_verification';
const root = '/skills/' + key;
const valueKey = 'SKILL_HIT_SPELL_SHIELD_BLOCKED';
const events = [];
async function call(method, path, body, expected = 200) {
  const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer local-aggregate-acceptance-placeholder', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${raw}`);
  events.push({ method, path, status: response.status });
  return raw ? JSON.parse(raw) : null;
}
const meta = name => ({ name, description: '技能命中法术护盾值验收', sortOrder: 10 });
const hit = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: key, useKind: null } };
const attack = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
const used = { eventType: 'SKILL_USED', detail: { sourceSkillKey: key, useKind: null } };
function rule(ruleKey, eventSource = hit, threshold = 0) {
  return { ruleKey, ...meta(ruleKey), eventSource,
    conditionGroups: [{ groupKey: 'not_blocked', name: '未被法术护盾阻挡', sortOrder: 10, conditions: [
      { conditionKey: 'shield', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 10, detail: { eventValueKey: valueKey, comparator: 'EQ', comparisonValue: { kind: 'FIXED', value: threshold } } }
    ] }], actions: [{ actionKey: 'run', name: '执行结果', sortOrder: 10, actionType: 'EXECUTE_EFFECT', targetContext: 'CURRENT_TARGET', detail: { effectKey: 'hit' }, runtimeInputBindings: [{ bindingKey: 'blocked', parameterKey: 'blocked', sourceType: 'EVENT_VALUE', detail: { eventValueKey: valueKey } }], resultModifiers: [] }],
    perTargetCooldown: null, maxTriggersPerProcess: null };
}
const update = body => { const copy = structuredClone(body); delete copy.ruleKey; return copy; };
let created = false;
try {
  await call('GET', root, undefined, 404);
  await call('POST', '/skills', { skillKey: key, ...meta('命中护盾验收'), maxLevel: 1, status: 'ENABLED', skillCategoryKeys: [] }, 201); created = true;
  await call('POST', root + '/parameters', { parameterKey: 'blocked', ...meta('命中阻挡结果'), valueMode: 'RUNTIME_INPUT', valueType: 'INTEGER', fixedValue: null, levelValues: null }, 201);
  await call('POST', root + '/effects', { effectKey: 'hit', ...meta('伤害'), lifecycle: null, results: [
    { resultKey: 'damage', ...meta('伤害'), resultType: 'DAMAGE', target: 'TARGET', valueRule: { value: { kind: 'PARAMETER', parameterKey: 'blocked' }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: { damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierValue: null }, vampRules: [] }, lifecycleBehavior: null, spellShieldBlockScope: null }
  ] }, 201);
  const initial = rule('on_hit');
  await call('POST', root + '/trigger-rules', initial, 201);
  assert.deepEqual(await call('GET', root + '/trigger-rules/on_hit'), initial);
  for (const threshold of [1, 2, 0]) {
    const wanted = rule('on_hit', hit, threshold);
    await call('PUT', root + '/trigger-rules/on_hit', update(wanted));
    assert.deepEqual(await call('GET', root + '/trigger-rules/on_hit'), wanted);
  }
  for (const eventSource of [attack, used]) {
    await call('PUT', root + '/trigger-rules/on_hit', update(rule('on_hit', eventSource)), 400);
    // 单独去除条件，确认输入绑定自身也限制事件。
    const bindingOnly = { ...update(rule('on_hit', eventSource)), conditionGroups: [] };
    await call('PUT', root + '/trigger-rules/on_hit', bindingOnly, 400);
  }
  for (const invalid of [undefined, 'BLOCKED', 'UNKNOWN_HIT_SHIELD']) {
    const wanted = rule('bad');
    wanted.conditionGroups[0].conditions[0].detail.eventValueKey = invalid;
    await call('POST', root + '/trigger-rules', wanted, 400);
  }
  assert.deepEqual(await call('GET', root + '/trigger-rules/on_hit'), initial);
  await fs.writeFile(new URL('../../output/authoring-simplification/hit-spell-shield-evidence.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), runtimeExecuted: false, checks: ['zero_roundtrip', 'one_roundtrip', 'threshold_not_boolean_restricted', 'integer_binding', 'skill_hit_only', 'binding_event_restriction', 'old_blocked_not_repurposed', 'event_change_rollback'], events }, null, 2));
  console.log(JSON.stringify({ checks: 8, requests: events.length, runtimeExecuted: false }));
} finally {
  if (created) { await call('DELETE', root, undefined, 204); await call('GET', root, undefined, 404); }
}

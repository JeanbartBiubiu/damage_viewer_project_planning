import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:8081/api/admin/games/lol';
const key = 'target_category_verification';
const root = '/skills/' + key;
const events = [];
async function call(method, path, body, expected = 200) {
  const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer local-aggregate-acceptance-placeholder', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${raw}`);
  events.push({ method, path, status: response.status });
  return raw ? JSON.parse(raw) : null;
}
const meta = name => ({ name, description: '实际命中目标类别验收', sortOrder: 10 });
const categories = ['CHAMPION', 'EPIC_MONSTER', 'MINION', 'NON_EPIC_MONSTER', 'STRUCTURE'];
const skillHit = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: key, useKind: null } };
const attackHit = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
const used = { eventType: 'SKILL_USED', detail: { sourceSkillKey: key, useKind: null } };
function rule(ruleKey, detail = { categories }, eventSource = skillHit) {
  return { ruleKey, ...meta(ruleKey), eventSource,
    conditionGroups: [{ groupKey: 'target', name: '命中目标', sortOrder: 10, conditions: [
      { conditionKey: 'category', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 10, detail }
    ] }], actions: [{ actionKey: 'damage', name: '造成伤害', sortOrder: 10, actionType: 'EXECUTE_EFFECT', targetContext: 'CURRENT_TARGET', detail: { effectKey: 'hit' }, runtimeInputBindings: [], resultModifiers: [] }],
    perTargetCooldown: null, maxTriggersPerProcess: null };
}
const update = body => { const copy = structuredClone(body); delete copy.ruleKey; return copy; };
let created = false;
try {
  await call('GET', root, undefined, 404);
  await call('POST', '/skills', { skillKey: key, ...meta('命中类别验收'), maxLevel: 1, status: 'ENABLED', skillCategoryKeys: [] }, 201); created = true;
  await call('POST', root + '/effects', { effectKey: 'hit', ...meta('伤害'), lifecycle: null, results: [
    { resultKey: 'damage', ...meta('伤害'), resultType: 'DAMAGE', target: 'TARGET', valueRule: { value: { kind: 'FIXED', value: 10 }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: { damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierValue: null }, vampRules: [] }, lifecycleBehavior: null, spellShieldBlockScope: null }
  ] }, 201);
  const initial = rule('on_hit');
  await call('POST', root + '/trigger-rules', initial, 201);
  assert.deepEqual(await call('GET', root + '/trigger-rules/on_hit'), initial);
  for (const selected of [['CHAMPION', 'EPIC_MONSTER'], ['MINION', 'NON_EPIC_MONSTER'], ['STRUCTURE']]) {
    const wanted = rule('on_hit', { categories: selected }, attackHit);
    await call('PUT', root + '/trigger-rules/on_hit', update(wanted));
    assert.deepEqual(await call('GET', root + '/trigger-rules/on_hit'), wanted);
  }
  const valid = await call('GET', root + '/trigger-rules/on_hit');
  for (const [index, detail] of [{}, { categories: [] }, { categories: null }, { categories: 'CHAMPION' }, { categories: [0] }, { categories: [null] }, { categories: ['UNKNOWN'] }, { categories: ['CHAMPION', 'CHAMPION'] }, { categories: ['CHAMPION'], subject: 'CURRENT_TARGET' }, { categories: ['CHAMPION'], comparisonValue: null }, { categories: ['CHAMPION'], unknownFields: [] }].entries()) {
    await call('POST', root + '/trigger-rules', rule('bad_' + index, detail), 400);
  }
  await call('POST', root + '/trigger-rules', rule('bad_event', { categories: ['CHAMPION'] }, used), 400);
  await call('PUT', root + '/trigger-rules/on_hit', { ...update(valid), eventSource: used }, 400);
  assert.deepEqual(await call('GET', root + '/trigger-rules/on_hit'), valid);
  await fs.writeFile(new URL('../../output/authoring-simplification/target-category-evidence.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), runtimeExecuted: false, checks: ['five_categories', 'two_hit_events', 'subset_roundtrip', 'strict_shape', 'unique_nonempty', 'no_subject_or_threshold', 'event_restriction', 'event_change_rollback'], events }, null, 2));
  console.log(JSON.stringify({ checks: 8, requests: events.length, runtimeExecuted: false }));
} finally {
  if (created) { await call('DELETE', root, undefined, 204); await call('GET', root, undefined, 404); }
}

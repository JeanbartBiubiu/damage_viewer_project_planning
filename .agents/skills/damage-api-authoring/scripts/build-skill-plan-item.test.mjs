import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSkillPlanItem } from './apply-skill-plan.mjs';
const evidence = [{ path: 'confirmed.json', sha256: 'c'.repeat(64), note: '已确认文本' }];
function baseline() {
  return { baseDigest: 'a'.repeat(64), skill: { gameId: 'lol', skillKey: 'sample', name: '技能', description: null,
    maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: [], createdAt: 'old', updatedAt: 'old' },
    parameters: [{ gameId: 'lol', skillKey: 'sample', parameterKey: 'amount', name: '金额', description: null, sortOrder: 1,
      valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 1, levelValues: null, createdAt: 'old', updatedAt: 'old' }],
    formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] };
}
test('完整候选只生成本次主体/组成差分，保留嵌套声明且不回传只读字段', () => {
  const before = baseline(), expected = structuredClone(before), frozen = structuredClone(before);
  expected.skill.name = '新名称'; expected.parameters[0].fixedValue = 2;
  expected.effects.push({ gameId: 'lol', skillKey: 'sample', effectKey: 'hit', name: '伤害', description: null, sortOrder: 2,
    lifecycle: null, results: [{ resultKey: 'damage', name: '伤害', description: null, sortOrder: 1, resultType: 'DAMAGE', target: 'TARGET',
      lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: { value: { kind: 'FIXED', value: 5 }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
      detail: { damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierValue: null },
        vampQualification: 'RESOLVED', vampOverrides: [], spellShieldFollowResult: { skillKey: 'other', effectKey: 'hit', resultKey: 'damage' } } }] });
  const candidate = structuredClone(expected), item = buildSkillPlanItem(before, expected, evidence);
  assert.deepEqual(before, frozen); assert.deepEqual(expected, candidate);
  assert.equal(item.request.skill.name, '新名称'); assert.equal(item.request.changes.length, 2);
  const update = item.request.changes.find(row => row.objectType === 'PARAMETER');
  assert.equal(update.operation, 'UPDATE'); assert.equal(update.value.fixedValue, 2);
  for (const field of ['gameId', 'skillKey', 'parameterKey', 'createdAt', 'updatedAt']) assert.equal(Object.hasOwn(update.value, field), false);
  const create = item.request.changes.find(row => row.objectType === 'EFFECT');
  assert.equal(create.operation, 'CREATE'); assert.equal(create.value.effectKey, 'hit');
  assert.deepEqual(create.value.results[0].detail.spellShieldFollowResult, { skillKey: 'other', effectKey: 'hit', resultKey: 'damage' });
  expected.effects[0].results[0].detail.spellShieldFollowResult.skillKey = 'changed';
  assert.equal(create.value.results[0].detail.spellShieldFollowResult.skillKey, 'other');
});
test('完整候选删除必须有一一对应的明确组成声明', () => {
  const before = baseline(), expected = structuredClone(before); expected.parameters = [];
  assert.throws(() => buildSkillPlanItem(before, expected, evidence), /缺少明确删除声明/);
  const allowed = [{ objectType: 'PARAMETER', key: 'amount' }];
  assert.deepEqual(buildSkillPlanItem(before, expected, evidence, allowed).request.changes,
    [{ objectType: 'PARAMETER', operation: 'DELETE', key: 'amount', value: null }]);
  assert.throws(() => buildSkillPlanItem(before, before, evidence, allowed), /未对应本次实际删除/);
});
test('时间戳差异不制造写入，归属及未知字段继续由同一完整计划守卫拒绝', () => {
  const before = baseline(), expected = structuredClone(before); expected.skill.updatedAt = 'later';
  expected.parameters[0].updatedAt = 'later';
  assert.throws(() => buildSkillPlanItem(before, expected, evidence), /没有变更/);
  expected.skill.gameId = 'wrong'; assert.throws(() => buildSkillPlanItem(before, expected, evidence));
  expected.skill.gameId = 'lol'; expected.parameters[0].unreviewed = 1;
  assert.throws(() => buildSkillPlanItem(before, expected, evidence), /未知字段/);
});

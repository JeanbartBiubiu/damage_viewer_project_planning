import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { previewUpdates, validateCandidate } from './candidate.mjs';
import { buildSkillPlanItem } from '../../.agents/skills/damage-api-authoring/scripts/apply-skill-plan.mjs';

// 从固定机制用例取完整技能配置，仅构造候选冻结入口所需的快照字段。
const cases = new URL('../../web/tests/mechanisms/cases/', import.meta.url);
const gameId = 'mechanism_lab';
const id = '0f053196-ddbb-4e83-9a77-818c51b21268';
const digest = 'a'.repeat(64);

function fixedSnapshot(caseKey) {
  return JSON.parse(readFileSync(new URL(caseKey + '.json', cases), 'utf8')).snapshot;
}

function configuration(snapshot, skillKey) {
  const row = structuredClone(snapshot.skillConfigurations.find(entry => entry.skill.skillKey === skillKey));
  assert.ok(row, '固定机制用例缺少技能 ' + skillKey);
  row.baseDigest = digest;
  row.skill.description ??= null;
  // 维护聚合按稳定键排序。固定机制文件保留原有录入顺序。
  for (const [collection, key] of Object.entries({
    parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey',
    internalStates: 'stateKey', processes: 'processKey', triggerRules: 'ruleKey'
  })) {
    row[collection].sort((a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
  }
  return row;
}

function change(before, expected) {
  return buildSkillPlanItem(before, expected, [
    { path: 'source.txt', sha256: digest, note: '固定机制用例' }
  ]);
}

function snapshot(selection, skillConfigurations, executionSkillKeys, references = []) {
  return {
    gameId, selection, skillConfigurations, executionSkillKeys, references,
    readAt: '2026-01-01T00:00:00Z', snapshotDigest: digest,
    source: { skillSources: executionSkillKeys.map(skillKey => ({
      skillKey, skillStatus: 'ENABLED', enabled: true, skillLevel: 1, inactiveReason: null
    })) },
    target: { skillSources: [] }
  };
}

function candidate(version, items, scenes) {
  return {
    version, batchId: id, principalId: id, gameId, reference: 'scoped-review',
    sourceRevision: '359cf902a', baselineDigest: digest,
    skillPlan: { schemaVersion: 'skill-configuration-plan-v1', gameId, items },
    scenes,
    expectedPlan: { cases: scenes.map(({ id }) => ({
      id, inputs: { attack: 1 },
      checks: [{ pointer: '/done/damage', expression: 'attack', comparison: 'amount' }]
    })) }
  };
}

function castReference(skillKey) {
  return {
    sourceSkillKey: skillKey, sourceType: 'TRIGGER', sourceKey: 'first_cast',
    fieldPath: 'actions[0].detail.processKey', targetType: 'PROCESS',
    targetSkillKey: skillKey, targetKey: 'cast', targetSubKey: ''
  };
}

test('开发候选允许预检省去旧引用，仍按两场投影与执行键覆盖全批', () => {
  const model = fixedSnapshot('schedule_future_cooldown_duration');
  const buffKey = 'lab_clock_buff';
  const strikeKey = 'lab_true_strike';
  const buff = configuration(model, buffKey);
  const strike = configuration(model, strikeKey);
  const nextBuff = structuredClone(buff);
  const nextStrike = structuredClone(strike);
  const scope = nextBuff.effects.find(effect => effect.effectKey === 'hit')
    .results.find(result => result.resultKey === 'duration').detail.affectedSkillScope;
  assert.deepEqual(scope.skillKeys, [strikeKey]);
  scope.skillKeys = [buffKey];
  nextStrike.skill.description = '修订技能说明';
  const buffChange = change(buff, nextBuff);
  const strikeChange = change(strike, nextStrike);

  function cooldownTarget(targetKey) {
    return {
      sourceSkillKey: buffKey, sourceType: 'EFFECT', sourceKey: 'hit',
      fieldPath: 'results[0].detail.affectedSkillScope.skillKeys[0]', targetType: 'SKILL',
      targetSkillKey: '', targetKey, targetSubKey: ''
    };
  }
  function selectionFor(skillKey) {
    return {
      ...structuredClone(model.selection),
      plannedSkills: model.selection.plannedSkills.filter(plan => plan.skillKey === skillKey),
      sourceSkillSettings: model.selection.sourceSkillSettings.filter(setting => setting.skillKey === skillKey)
    };
  }

  // 第一场的旧目标仅由显式技能范围加载。第二场独立执行旧目标自身的技能。
  const buffSelection = selectionFor(buffKey);
  const strikeSelection = selectionFor(strikeKey);
  const scenes = [{
    id: 'buff', scenario: { mode: 'fixed' },
    snapshot: snapshot(buffSelection, [buff, strike], [buffKey], [castReference(buffKey), cooldownTarget(strikeKey)]),
    previewSnapshot: snapshot(buffSelection, [buffChange.expected], [buffKey], [castReference(buffKey), cooldownTarget(buffKey)])
  }, {
    id: 'strike', scenario: { mode: 'fixed' },
    snapshot: snapshot(strikeSelection, [strike], [strikeKey], [castReference(strikeKey)]),
    previewSnapshot: snapshot(strikeSelection, [strikeChange.expected], [strikeKey], [castReference(strikeKey)])
  }];
  const input = candidate('maintenance-development-candidate-v1', [buffChange, strikeChange], scenes);
  assert.deepEqual(scenes.map(scene => previewUpdates(input, scene).map(update => update.skillKey)), [[buffKey], [strikeKey]]);
  assert.equal(validateCandidate(input).scenes.length, 2);

  const uncovered = candidate(input.version, input.skillPlan.items, [scenes[0]]);
  assert.throws(() => validateCandidate(uncovered), /未被任何候选场景覆盖/);
});

test('有限计数应用伤害从 1 修成 0 时拒绝自动候选，原场景的说明修订仍可冻结', () => {
  const model = fixedSnapshot('target_counter_unplanned_no_window');
  const attackKey = model.selection.basicAttackSkillKey;
  const counterKey = 'lab_charge';
  assert.equal(attackKey, 'lab_basic_attack');
  assert.deepEqual(model.selection.plannedSkills, []);
  assert.equal(model.source.skillSources.find(source => source.skillKey === counterKey).inactiveReason, 'ACTIVE_DEFERRED');

  const after = configuration(model, counterKey);
  const before = structuredClone(after);
  const applicationValue = before.effects.find(effect => effect.effectKey === 'application_hit')
    .results.find(result => result.resultKey === 'damage').valueRule.value;
  assert.deepEqual(applicationValue, { kind: 'FIXED', value: 0 });
  applicationValue.value = 1;
  // 非零旧配置的普攻自然入口可达。零值修订应交给后端重新装配闭包。
  const scenes = [{
    id: 'normal', scenario: { mode: 'fixed' },
    snapshot: snapshot(model.selection, [configuration(model, attackKey), before], [attackKey, counterKey])
  }];
  const version = 'maintenance-candidate-v1';
  const metadata = structuredClone(before);
  metadata.skill.description = '修订技能说明';
  assert.equal(validateCandidate(candidate(version, [change(before, metadata)], scenes)).scenes.length, 1);
  assert.throws(() => validateCandidate(candidate(version, [change(before, after)], scenes)), /自动候选.*开发预检/);
});

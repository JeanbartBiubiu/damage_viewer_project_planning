import { describe, expect, it } from 'vitest';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { assembleNaturalSkillSources } from './simulationNaturalSkillSources';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { shieldResultDefinitionRef } from './shieldEffectAdapter';

function sample() {
  const snapshot = loadMechanismCases().find(row => row.caseKey === 'defense_own_counter_shield_expiry')!.buildSnapshot();
  const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_guard')!;
  const rule = configuration.triggerRules.find(row => row.ruleKey === 'damaged')!;
  rule.conditionGroups[0]!.conditions = [{ conditionKey: 'hp', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 0,
    detail: { eventValueKey: 'ACTUAL_HP_LOSS', comparator: 'GT', comparisonValue: { kind: 'FIXED', value: 0 } } }];
  rule.conditionGroups.push({ groupKey: 'first_shield', name: '首次自身盾受损', sortOrder: 1, conditions: [
    { conditionKey: 'idle', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 0,
      detail: { stateSkillKey: 'lab_guard', stateKey: 'wait', valueKind: 'VALUE', comparator: 'EQ',
        comparisonValue: { kind: 'FIXED', value: 0 }, optionKey: null, expectedBoolean: null } },
    { conditionKey: 'shield', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 1,
      detail: { eventValueKey: 'SHIELD_ABSORBED', comparator: 'GT', comparisonValue: { kind: 'FIXED', value: 0 },
        shieldResult: { skillKey: 'lab_guard', effectKey: 'guard', resultKey: 'barrier' } } }
  ] });
  approveSnapshotFixture(snapshot);
  return { snapshot, configuration, rule };
}

describe('指定自身普通盾的本笔吸收条件', () => {
  it('同一受伤监听保留两组OR条件，只生成一次既有等待写入，并绑定完整父定义', () => {
    const { snapshot } = sample(), before = structuredClone(snapshot);
    const compiled = assembleNaturalSkillSources(snapshot);
    expect(snapshot).toEqual(before);
    const parent = compiled.providers.find(row => row.skillKey === 'lab_guard' && row.kind === 'character')!;
    const listeners = parent.abilities!.filter(row => row.listenerSpec?.listenerKey === 'damaged');
    expect(listeners).toHaveLength(1);
    const listener = listeners[0]!.listenerSpec!;
    expect(listener.eventMatcher.all).toEqual(expect.arrayContaining(['event/damage_taken', 'event/target_owner']));
    expect(listener.operations).toHaveLength(1);
    expect(listener.operations[0]).toMatchObject({ operation: 'state_change', ref: 'wait', amount: { op: 'const', value: 1 } });
    expect(listener.condition).toMatchObject({ op: 'max', args: [
      { op: 'gt', args: [{ op: 'read', path: 'event.damage.actualHpLoss' }, { op: 'const', value: 0 }] },
      { op: 'min', args: [expect.anything(), { op: 'gt', args: [{ op: 'read',
        path: `event.damage.linked_shield[${shieldResultDefinitionRef('lab_guard', 'guard', 'barrier', parent.providerKey)}].absorbed` },
      { op: 'const', value: 0 }] }] }
    ] });
    expect(compiled.providers.filter(row => row.linkedShieldDefinitionRef?.endsWith('/lab_guard/guard/barrier'))).toHaveLength(1);
    expect(compiled.providers.find(row => row.linkedShieldDefinitionRef?.endsWith('/lab_guard/guard/barrier'))!.modifiers).toHaveLength(1);
  });

  it.each(['missing', 'null', 'foreign', 'wrong_skill', 'wrong_effect', 'wrong_result', 'wrong_event', 'wrong_value', 'target'] as const)(
    '明确拒绝不完整或不授权的选择 %s', variant => {
      const { snapshot, configuration, rule } = sample();
      const condition = rule.conditionGroups[1]!.conditions[1]!;
      if (condition.conditionType !== 'EVENT_VALUE_COMPARE') throw new Error('fixture condition');
      const detail = condition.detail;
      if (variant === 'missing') delete detail.shieldResult;
      if (variant === 'null') Object.assign(detail, { shieldResult: null });
      if (variant === 'foreign') Object.assign(detail.shieldResult!, { owner: 'target' });
      if (variant === 'wrong_skill') detail.shieldResult!.skillKey = 'lab_armor';
      if (variant === 'wrong_effect') detail.shieldResult!.effectKey = 'missing';
      if (variant === 'wrong_result') detail.shieldResult!.resultKey = 'missing';
      if (variant === 'wrong_event') rule.eventSource = { eventType: 'BASIC_ATTACK_RECEIVED', detail: {} };
      if (variant === 'wrong_value') detail.eventValueKey = 'ACTUAL_HP_LOSS';
      if (variant === 'target') configuration.effects[0]!.lifecycle!.instanceScope = 'SOURCE_TARGET';
      expect(() => assembleNaturalSkillSources(snapshot)).toThrow();
    }
  );
  it('只有初始化规则的独立关联盾也走完整施盾路径，不误作永久属性', () => {
    const { snapshot, configuration } = sample();
    const extra = JSON.parse(JSON.stringify(configuration).replaceAll('"lab_guard"', '"lab_external"')) as typeof configuration;
    extra.formulas = []; extra.parameters = []; extra.processes = []; extra.internalStates = [];
    extra.effects[0]!.results[0]!.valueRule!.value = { kind: 'FIXED', value: 50 };
    extra.triggerRules = extra.triggerRules.filter(row => row.ruleKey === 'initialize');
    snapshot.skillConfigurations.push(extra);
    const target = snapshot.target;
    target.attachedSkills.push({ ...target.attachedSkills[0]!, skillKey: 'lab_external', sortOrder: 2 });
    target.skillSources.push({ ...target.skillSources[0]!, skillKey: 'lab_external', enabledRuleKeys: ['initialize'] });
    snapshot.selection.targetSkillSettings.push({ origin: { kind: 'CHARACTER', characterKey: 'lab_dummy' }, skillKey: 'lab_external', enabled: true, skillLevel: 1 });
    approveSnapshotFixture(snapshot);
    const compiled = assembleNaturalSkillSources(snapshot);
    const parent = compiled.providers.find(provider => provider.skillKey === 'lab_external' && provider.kind === 'character')!;
    expect(parent.abilities).toHaveLength(1);
    expect(parent.abilities![0]!.listenerSpec!.operations).toEqual([expect.objectContaining({ operation: 'shield', target: 'self', amount: { op: 'const', value: 50 } })]);
    expect(compiled.providers.filter(provider => provider.linkedShieldDefinitionRef?.includes('/lab_external/guard/barrier'))).toHaveLength(1);
  });
});

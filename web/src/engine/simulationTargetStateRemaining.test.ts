import { describe, expect, it } from 'vitest';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { fixedValue, parameterValue } from '../types/numericValue';
import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillParameter } from '../types/skillParameter';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import { assembleTriggeredSkillSources } from './simulation/compile/triggered';
import { assembleNaturalSkillSources } from './simulation/sources/natural';
import { naturalRuleKeys } from './simulation/sources/description';
import type { TriggeredSourceDescription } from './simulation/model';

function sample() {
  const snapshot = simulationActiveSample();
  const active = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
  const skillKey = 'sample_mark';
  const mark: SkillInternalState = { gameId: snapshot.gameId, skillKey, stateKey: 'mark', name: '目标标记',
    stateType: 'COUNTER', scope: 'TARGET', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
    detail: { initialValue: fixedValue(0), maxValue: fixedValue(1), durationValue: fixedValue(6000) } };
  const rule: SkillTriggerRuleDetail = { ruleKey: 'keep_short_mark', name: '短标记保留窗口', description: null, sortOrder: 0,
    eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'sample_active', useKind: 'ACTIVE', castPhase: 'INITIAL' } },
    conditionGroups: [{ groupKey: 'short_mark', name: '有效短标记', sortOrder: 0, conditions: [
      { conditionKey: 'present', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 0,
        detail: { stateSkillKey: skillKey, stateKey: 'mark', valueKind: 'VALUE', optionKey: null, expectedBoolean: null,
          comparator: 'GT', comparisonValue: fixedValue(0) } },
      { conditionKey: 'alive', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 1,
        detail: { stateSkillKey: skillKey, stateKey: 'mark', valueKind: 'REMAINING_MS', optionKey: null, expectedBoolean: null,
          comparator: 'GT', comparisonValue: fixedValue(0) } },
      { conditionKey: 'short', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 2,
        detail: { stateSkillKey: skillKey, stateKey: 'mark', valueKind: 'REMAINING_MS', optionKey: null, expectedBoolean: null,
          comparator: 'LT', comparisonValue: fixedValue(1000) } }
    ] }],
    actions: [{ actionKey: 'keep', name: '确保余时', actionType: 'MODIFY_INTERNAL_STATE', sortOrder: 0,
      targetContext: 'CURRENT_TARGET', detail: { stateSkillKey: skillKey, stateKey: 'mark', operation: 'ENSURE_REMAINING', value: fixedValue(1250) },
      runtimeInputBindings: [], resultModifiers: [] }], perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null };
  const configuration: SkillConfiguration = { ...structuredClone(active), skill: { ...active.skill, skillKey, name: '被动目标标记' },
    parameters: [], formulas: [], effects: [], processes: [], internalStates: [mark], triggerRules: [rule] };
  snapshot.skillConfigurations.push(configuration);
  const origin = snapshot.selection.plannedSkills[0]!.origin;
  snapshot.source.skillSources.push({ origin, skillKey, skillName: configuration.skill.name, skillStatus: 'ENABLED', enabled: true,
    skillLevel: 1, enabledRuleKeys: [rule.ruleKey], inactiveReason: null });
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[0]!, skillKey, skillName: configuration.skill.name });
  snapshot.selection.sourceSkillSettings.push({ origin, skillKey, enabled: true, skillLevel: 1 });
  const description: TriggeredSourceDescription = { side: 'source', kind: 'character', stableId: 'mark_definition',
    providerRef: 'mark_provider', definitionRef: 'mark_definition', path: 'source.skillSources.mark',
    skills: [{ skillKey, skillLevel: 1, path: 'skills.sample_mark', configuration }] };
  return { snapshot, configuration, rule, mark, description };
}

function assemble(fixture: ReturnType<typeof sample>) {
  return assembleTriggeredSkillSources(fixture.snapshot, [fixture.description]);
}

function ensureAction(fixture: ReturnType<typeof sample>) {
  const action = fixture.rule.actions[0]!;
  if (action.actionType !== 'MODIFY_INTERNAL_STATE') throw new Error('需要内部状态修改动作');
  return action;
}

describe('自身目标计数真实剩余毫秒的宿主转换', () => {
  it.each([
    { mode: 'FIXED_VALUE', skillLevel: 1, characterLevel: 1, expected: 1250 },
    { mode: 'FIXED', skillLevel: 1, characterLevel: 1, expected: 1250 },
    { mode: 'SKILL_LEVEL', skillLevel: 1, characterLevel: 1, expected: 1250 },
    { mode: 'SKILL_LEVEL', skillLevel: 2, characterLevel: 1, expected: 1500 },
    { mode: 'SKILL_LEVEL', skillLevel: 3, characterLevel: 1, expected: 1750 },
    { mode: 'CHARACTER_LEVEL', skillLevel: 1, characterLevel: 1, expected: 1250 },
    { mode: 'CHARACTER_LEVEL', skillLevel: 1, characterLevel: 2, expected: 1500 },
    { mode: 'CHARACTER_LEVEL', skillLevel: 1, characterLevel: 3, expected: 1750 }
  ] as const)('$mode 按技能$skillLevel级和角色$characterLevel级输出无读取依赖的静态$expected毫秒', row => {
    const fixture = sample();
    fixture.configuration.skill.maxLevel = 3;
    fixture.description.skills[0]!.skillLevel = row.skillLevel;
    fixture.snapshot.selection.sourceLevel = row.characterLevel;
    if (row.mode !== 'FIXED_VALUE') {
      const parameter: SkillParameter = { gameId: fixture.snapshot.gameId, skillKey: 'sample_mark', parameterKey: 'keep_ms', name: '静态保留毫秒',
        valueMode: row.mode, valueType: 'INTEGER', fixedValue: row.mode === 'FIXED' ? 1250 : null,
        levelValues: row.mode === 'FIXED' ? null : { '1': 1250, '2': 1500, '3': 1750 },
        description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
      fixture.configuration.parameters.push(parameter);
      ensureAction(fixture).detail.value = parameterValue('keep_ms');
    }
    const operation = assemble(fixture).providers[0]!.abilities![0]!.listenerSpec!.operations![0]!;
    expect(operation.amount).toEqual({ op: 'const', value: row.expected });
    expect(JSON.stringify(operation.amount)).not.toContain('ability.param');
  });

  it('P拥有状态和监听，R为真实施放来源，P无主动计划仍生成目标余时条件和确保余时动作', () => {
    const fixture = sample();
    const before = structuredClone(fixture.snapshot);
    expect(fixture.snapshot.selection.plannedSkills.map(row => row.skillKey)).toEqual(['sample_active']);
    expect(naturalRuleKeys(fixture.snapshot, fixture.configuration, 'source')).toEqual(['keep_short_mark']);
    const result = assemble(fixture);
    const provider = result.providers[0]!;
    expect(provider.skillKey).toBe('sample_mark');
    expect(provider.initialStateSchema!.mark).toMatchObject({ valueType: 'integer', defaultValue: 0, maxValue: 1, durationMs: 6000 });
    const listener = provider.abilities![0]!;
    expect(listener.skillKey).toBe('sample_mark');
    expect(JSON.stringify(listener.listenerSpec!.eventMatcher)).toContain('sample_active');
    expect(JSON.stringify(listener.listenerSpec!.condition)).toContain('provider.target_state_remaining_ms.mark');
    expect(JSON.stringify(listener.listenerSpec!.condition)).toContain('provider.target_state.mark');
    expect(listener.listenerSpec!.operations).toEqual([{ operation: 'state_duration_change', target: 'self', ref: 'mark',
      valuePolicy: 'ensure_remaining', amount: { op: 'const', value: 1250 }, types: ['state_scope/provider_target'] }]);
    expect(assemble(fixture)).toEqual(result);
    expect(fixture.snapshot).toEqual(before);
    const natural = assembleNaturalSkillSources(fixture.snapshot);
    expect(natural.providers.find(row => row.skillKey === 'sample_mark')?.abilities![0]!.listenerSpec!.operations)
      .toEqual(listener.listenerSpec!.operations);
  });

  it('R未安排时移除该自然根，P开关保持原值，其他初始化根保留', () => {
    const fixture = sample();
    const active = fixture.snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
    fixture.configuration.effects.push({ ...structuredClone(active.effects[0]!), skillKey: 'sample_mark', effectKey: 'other_init',
      results: [{ resultKey: 'heal', name: '自身治疗', resultType: 'DIRECT_HEAL', target: 'SOURCE', description: null, sortOrder: 0,
        valueRule: { value: fixedValue(1), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
        detail: {}, lifecycleBehavior: null, spellShieldBlockScope: null }] });
    fixture.configuration.triggerRules.push({ ...structuredClone(fixture.rule), ruleKey: 'other_listener',
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, conditionGroups: [],
      actions: [{ actionKey: 'other_heal', name: '自身初始化', actionType: 'EXECUTE_EFFECT', sortOrder: 0,
        targetContext: 'EVENT_SOURCE', detail: { effectKey: 'other_init' }, runtimeInputBindings: [], resultModifiers: [] }] });
    fixture.snapshot.selection.plannedSkills = [];
    const activeSource = fixture.snapshot.source.skillSources.find(row => row.skillKey === 'sample_active')!;
    activeSource.enabledRuleKeys = []; activeSource.inactiveReason = 'ACTIVE_DEFERRED';
    const passiveSource = fixture.snapshot.source.skillSources.find(row => row.skillKey === 'sample_mark')!;
    passiveSource.enabledRuleKeys = ['other_listener'];
    expect(naturalRuleKeys(fixture.snapshot, fixture.configuration, 'source')).toEqual(['other_listener']);
    expect(assembleNaturalSkillSources(fixture.snapshot).providers.find(row => row.skillKey === 'sample_mark')!.abilities!
      .map(row => row.abilityKey)).toEqual(['other_listener']);
    expect(passiveSource.enabled).toBe(true);
    passiveSource.enabled = false; passiveSource.inactiveReason = 'SCENE_DISABLED'; passiveSource.enabledRuleKeys = [];
    fixture.snapshot.selection.sourceSkillSettings.find(row => row.skillKey === 'sample_mark')!.enabled = false;
    expect(naturalRuleKeys(fixture.snapshot, fixture.configuration, 'source')).toEqual([]);
    expect(assembleNaturalSkillSources(fixture.snapshot).providers.find(row => row.skillKey === 'sample_mark')).toBeUndefined();
    expect(passiveSource.enabled).toBe(false);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('动作值%s不符合正安全整数时明确拒绝', amount => {
    const fixture = sample();
    ensureAction(fixture).detail.value = fixedValue(amount);
    expect(() => assemble(fixture)).toThrow();
  });

  it.each([-1, .5, Number.MAX_SAFE_INTEGER + 1])('比较值%s不符合非负安全整数时明确拒绝', amount => {
    const fixture = sample();
    const condition = fixture.rule.conditionGroups[0]!.conditions[2]!;
    if (condition.conditionType !== 'INTERNAL_STATE_CHECK') throw new Error('需要内部状态条件');
    condition.detail.comparisonValue = fixedValue(amount);
    expect(() => assemble(fixture)).toThrow();
  });

  it.each([null, fixedValue(0), fixedValue(1.5), fixedValue(Number.MAX_SAFE_INTEGER + 1)])('缺失或非法有限期限%s明确拒绝', duration => {
    const fixture = sample();
    fixture.mark.detail.durationValue = duration;
    expect(() => assemble(fixture)).toThrow();
  });

  it('拒绝自身范围、外部状态、动态值及错误的事件或目标身份', () => {
    const invalid: Array<(fixture: ReturnType<typeof sample>) => void> = [
      fixture => { fixture.mark.scope = 'SKILL'; },
      fixture => { ensureAction(fixture).detail.stateSkillKey = 'sample_active'; },
      fixture => { fixture.rule.actions[0]!.targetContext = 'EVENT_SOURCE'; },
      fixture => { if (fixture.rule.eventSource.eventType === 'SKILL_USED') fixture.rule.eventSource.detail.sourceSkillKey = null; },
      fixture => { if (fixture.rule.eventSource.eventType === 'SKILL_USED') fixture.rule.eventSource.detail.castPhase = 'RECAST'; },
      fixture => { if (fixture.rule.eventSource.eventType === 'SKILL_USED') fixture.rule.eventSource.detail.useKind = 'ANY'; },
      fixture => { fixture.snapshot.selection.plannedSkills[0]!.origin = { kind: 'CHARACTER', characterKey: 'other_owner' }; },
      fixture => {
        fixture.configuration.parameters.push({ gameId: fixture.snapshot.gameId, skillKey: 'sample_mark', parameterKey: 'dynamic_ms', name: '动态时间',
          valueMode: 'RUNTIME_INPUT', valueType: 'INTEGER', fixedValue: null, levelValues: null, description: null, sortOrder: 0, createdAt: '', updatedAt: '' });
        const action = fixture.rule.actions[0]!;
        if (action.actionType === 'MODIFY_INTERNAL_STATE') action.detail.value = parameterValue('dynamic_ms');
      }
    ];
    for (const mutate of invalid) { const fixture = sample(); mutate(fixture); expect(() => assemble(fixture)).toThrow(); }
  });
});

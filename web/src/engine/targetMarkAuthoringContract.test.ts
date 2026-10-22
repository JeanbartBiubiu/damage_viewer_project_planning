import { describe, expect, it } from 'vitest';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillProcess } from '../types/skillProcess';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import { fixedValue } from '../types/numericValue';
import { isTargetMarkPostHitRule, targetMarkAuthoringContract } from './targetMarkAuthoringContract';

function graph() {
  const snapshot = simulationActiveSample();
  const base = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
  const common = { gameId: snapshot.gameId, skillKey: base.skill.skillKey, createdAt: '', updatedAt: '' };
  const valueRule = (value: number) => ({ value: fixedValue(value), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null });
  const damage = (zero: boolean): SkillEffectResult => ({ resultKey: 'magic_hit', name: '独立魔伤', description: null, sortOrder: 10,
    resultType: 'DAMAGE', target: 'TARGET', lifecycleBehavior: null, spellShieldBlockScope: zero ? 'SKILL' : 'DAMAGE_INSTANCE',
    valueRule: valueRule(zero ? 0 : 200), detail: { damageTypeKey: 'physics', deliveryKind: 'SKILL', originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: [] } });
  const effect = (effectKey: string, results: SkillEffectResult[]): SkillEffect => ({ ...common, effectKey, name: effectKey,
    description: null, sortOrder: 10, lifecycle: null, results });
  const passive = (processKey: string, value: number, effectKey?: string): SkillProcess => ({ ...common, processKey, name: processKey,
    description: null, sortOrder: 10, activationType: 'PASSIVE', cooldown: null,
    steps: [{ stepKey: 'execute', stepType: 'IMMEDIATE', name: '即时', description: null, sortOrder: 10, occupiesAction: false, detail: {} }],
    effectBindings: effectKey ? [{ bindingKey: 'damage', effectKey, sortOrder: 10, moment: { momentType: 'STEP_EXECUTION', stepKey: 'execute', failureReason: null } }] : [],
    stateOperations: [{ operationKey: 'write', name: '写计数', sortOrder: 10, stateSkillKey: common.skillKey, stateKey: 'mark',
      operation: 'SET', value: fixedValue(value), optionKey: null, moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } }] });
  const rule = (ruleKey: string, eventSource: SkillTriggerRuleDetail['eventSource'], processKey: string): SkillTriggerRuleDetail => ({
    ruleKey, name: ruleKey, description: null, sortOrder: 10, eventSource, conditionGroups: [],
    actions: [{ actionKey: 'start', name: '开始', sortOrder: 10, actionType: 'START_PROCESS', detail: { processKey },
      targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }],
    perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null });
  const blocked = { conditionKey: 'not_blocked', conditionType: 'EVENT_VALUE_COMPARE' as const, sortOrder: 20,
    detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED' as const, comparator: 'EQ' as const, comparisonValue: fixedValue(0) } };
  const mark = { conditionKey: 'marked', conditionType: 'INTERNAL_STATE_CHECK' as const, sortOrder: 10,
    detail: { stateSkillKey: common.skillKey, stateKey: 'mark', valueKind: 'VALUE' as const, optionKey: null, expectedBoolean: null,
      comparator: 'EQ' as const, comparisonValue: fixedValue(1) } };
  const onUsed = rule('on_used', { eventType: 'SKILL_USED', detail: { sourceSkillKey: common.skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' } }, 'cast');
  const root = rule('root_hit', { eventType: 'SKILL_HIT', detail: { sourceSkillKey: common.skillKey } }, 'cast');
  root.actions = [{ actionKey: 'zero', name: '零应用', sortOrder: 10, actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'zero_hit' },
    targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }];
  const apply = rule('apply', { eventType: 'SKILL_HIT', detail: { sourceSkillKey: common.skillKey } }, 'apply');
  apply.conditionGroups = [{ groupKey: 'eligible', name: '未挡', sortOrder: 10, conditions: [blocked] }];
  const attack = rule('attack', { eventType: 'BASIC_ATTACK_HIT', detail: {} }, 'attack');
  attack.conditionGroups = [{ groupKey: 'eligible', name: '已标记', sortOrder: 10, conditions: [structuredClone(mark)] }];
  const skill = rule('skill', { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'sibling' } }, 'skill');
  skill.conditionGroups = [{ groupKey: 'eligible', name: '已标记未挡', sortOrder: 10, conditions: [structuredClone(mark), structuredClone(blocked)] }];
  const configuration: SkillConfiguration = { ...base, effects: [effect('zero_hit', [damage(true)]), effect('attack_hit', [damage(false)]),
    effect('skill_hit', [damage(false), { resultKey: 'mana', name: '回蓝', description: null, sortOrder: 20, resultType: 'RESOURCE_CHANGE',
      target: 'SOURCE', lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: valueRule(60), detail: { attributeKey: 'mana', operation: 'RESTORE' } }])],
    processes: [{ ...base.processes[0]!, effectBindings: [], stateOperations: [] }, passive('apply', 1), passive('attack', 0, 'attack_hit'), passive('skill', 0, 'skill_hit')],
    parameters: [], formulas: [], internalStates: [{ ...common, stateKey: 'mark', name: '自身目标标记', description: null, sortOrder: 10,
      stateType: 'COUNTER', scope: 'TARGET', detail: { initialValue: fixedValue(0), maxValue: fixedValue(1), durationValue: fixedValue(4000) } }],
    triggerRules: [onUsed, root, apply, attack, skill] };
  snapshot.skillConfigurations[snapshot.skillConfigurations.indexOf(base)] = configuration;
  snapshot.source.skillSources.find(row => row.skillKey === common.skillKey)!.enabledRuleKeys = configuration.triggerRules.map(row => row.ruleKey).sort();
  return { snapshot, configuration };
}

describe('有限目标标记完整作者图', () => {
  it('按结构识别任意技能键，并保留真正零伤根和主动入口', () => {
    const { configuration } = graph(); const before = structuredClone(configuration);
    const contract = targetMarkAuthoringContract(configuration)!;
    expect(contract.state.stateKey).toBe('mark');
    expect(contract.skill.restore?.valueRule.value).toEqual(fixedValue(60));
    expect(configuration.triggerRules.filter(rule => isTargetMarkPostHitRule(configuration, rule)).map(rule => rule.ruleKey)).toEqual(['apply', 'attack', 'skill']);
    expect(isTargetMarkPostHitRule(configuration, contract.rootRule)).toBe(false);
    expect(isTargetMarkPostHitRule(configuration, contract.onUsed)).toBe(false);
    expect(configuration).toEqual(before);
  });
  it('普通旧图交原入口，EARLY_REMOVE没有标记图授权', () => {
    const snapshot = simulationActiveSample();
    expect(targetMarkAuthoringContract(snapshot.skillConfigurations[1]!)).toBeNull();
  });
  it.each(['scope', 'initial', 'duration', 'extra_state', 'extra_writer', 'occupies', 'cooldown', 'writer_target', 'writer_value',
    'writer_block', 'consumer_block', 'foreign_state', 'same_skill', 'duplicate_source', 'runtime_binding', 'extra_action',
    'early_remove', 'attack_restore', 'restore_hp', 'extra_root', 'extra_result', 'unknown_field', 'root_nonzero'])(
    '完整图的%s变异明确拒绝，不能过滤缺失组成', change => {
      const { configuration: c } = graph();
      const contract = targetMarkAuthoringContract(c)!;
      if (change === 'scope') contract.state.scope = 'SKILL';
      if (change === 'initial') contract.state.detail.initialValue = fixedValue(1);
      if (change === 'duration') contract.state.detail.durationValue = null;
      if (change === 'extra_state') c.internalStates.push({ ...structuredClone(contract.state), stateKey: 'other' });
      if (change === 'extra_writer') c.processes.push({ ...structuredClone(contract.applicationProcess), processKey: 'unreferenced' });
      if (change === 'occupies') contract.attack.process.steps[0]!.occupiesAction = true;
      if (change === 'cooldown') contract.attack.process.cooldown = structuredClone(contract.cast.cooldown);
      if (change === 'writer_target') contract.applicationProcess.stateOperations[0]!.stateSkillKey = 'foreign';
      if (change === 'writer_value') contract.applicationProcess.stateOperations[0]!.value = fixedValue(2);
      if (change === 'writer_block') contract.applicationRule.conditionGroups[0]!.conditions = [];
      if (change === 'consumer_block') contract.skill.rules[0]!.conditionGroups[0]!.conditions.pop();
      if (change === 'foreign_state') (contract.attack.rule.conditionGroups[0]!.conditions[0]!.detail as { stateSkillKey: string }).stateSkillKey = 'foreign';
      if (change === 'same_skill') (contract.skill.rules[0]!.eventSource.detail as { sourceSkillKey: string }).sourceSkillKey = c.skill.skillKey;
      if (change === 'duplicate_source') c.triggerRules.push({ ...structuredClone(contract.skill.rules[0]!), ruleKey: 'duplicate' });
      if (change === 'runtime_binding') (contract.skill.rules[0]!.actions[0]!.runtimeInputBindings as unknown[]).push({ arbitrary: true });
      if (change === 'extra_action') contract.applicationRule.actions.push({ ...structuredClone(contract.applicationRule.actions[0]!), actionKey: 'extra' });
      if (change === 'early_remove') contract.attack.damage.lifecycleBehavior = { moment: 'EARLY_REMOVE', valueReadMode: 'APPLICATION_SNAPSHOT', reapplicationValueMode: null, stackValueMode: null, periodicExecutionMode: null };
      if (change === 'attack_restore') contract.attack.effect.results.push(structuredClone(contract.skill.restore!));
      if (change === 'restore_hp') contract.skill.restore!.detail.attributeKey = 'hp';
      if (change === 'extra_root') c.triggerRules.push({ ...structuredClone(contract.rootRule), ruleKey: 'duplicate_root' });
      if (change === 'extra_result') contract.skill.effect.results.push({ ...structuredClone(contract.skill.damage), resultKey: 'extra' });
      if (change === 'unknown_field') Object.assign(contract.state.detail, { onExpire: [] });
      if (change === 'root_nonzero') contract.rootEffect.results[0]!.valueRule!.value = fixedValue(1);
      expect(() => targetMarkAuthoringContract(c)).toThrow();
    });
});

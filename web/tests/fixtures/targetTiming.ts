import { simulationActiveSample } from './simulationActiveSkill';
import { fixedValue, formulaValue, parameterValue } from '../../src/types/numericValue';
import type { SkillConfiguration } from '../../src/types/skillConfiguration';
import type { SkillInternalStateCounter } from '../../src/types/skillInternalState';
import type { SkillProcess, SkillProcessMoment } from '../../src/types/skillProcess';
import type { SkillTriggerRuleDetail } from '../../src/types/skillTriggerRule';
import type { SkillEffect, SkillEffectResult } from '../../src/types/skillEffect';
import type { TriggeredSkillSourceDescription } from '../../src/engine/simulationSkillSourceDescription';

/** 完全合成的作者图，只供协议与装配边界检查，不复制正式英雄配置。 */
export function targetTimingSample() {
  const snapshot = simulationActiveSample();
  const base = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
  const skillKey = 'lab_timing';
  const common = { gameId: snapshot.gameId, skillKey, createdAt: '', updatedAt: '' };
  const start: SkillProcessMoment = { momentType: 'PROCESS_START', stepKey: null, failureReason: null };
  const complete: SkillProcessMoment = { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null };
  const execute: SkillProcessMoment = { momentType: 'STEP_EXECUTION', stepKey: 'now', failureReason: null };
  const counter = (stateKey: string, max: number, duration: number): SkillInternalStateCounter => ({
    ...common, stateKey, name: stateKey, description: null, sortOrder: 10,
    stateType: 'COUNTER', scope: 'TARGET',
    detail: { initialValue: fixedValue(0), maxValue: fixedValue(max), durationValue: fixedValue(duration) }
  });
  const phases = ['phase_a', 'phase_b', 'phase_c'].map(key => counter(key, 1, 4000));
  for (const state of phases) state.detail.targetTiming = { kind: 'PHASED_TICK', processKey: 'one_tick',
    intervalValue: parameterValue('period_ms'), phasePolicy: 'PRESERVE_ON_EXTEND' };
  const reservation = counter('reservation', 1, 2000);
  reservation.detail.targetTiming = { kind: 'EXPIRY_PAYLOAD', processKey: 'detonate' };
  const count = counter('layer_count', 3, 4000);
  const restriction = counter('restriction', 1, 4000);
  const write = (stateKey: string, value: number, order: number, moment = start): SkillProcess['stateOperations'][number] => ({
    operationKey: `write_${stateKey}`, name: `写${stateKey}`, stateSkillKey: skillKey, stateKey,
    operation: 'SET', value: fixedValue(value), optionKey: null, sortOrder: order, moment
  });
  const process = (processKey: string, effectKey?: string): SkillProcess => ({
    ...common, processKey, name: processKey, activationType: 'PASSIVE', description: null, sortOrder: 10,
    cooldown: null, steps: [{ stepKey: 'now', name: '即时', stepType: 'IMMEDIATE', detail: {}, occupiesAction: false,
      description: null, sortOrder: 10 }], stateOperations: [],
    effectBindings: effectKey ? [{ bindingKey: 'damage', effectKey, sortOrder: 50, moment: execute }] : []
  });
  const result = (resultKey: string, formulaKey: string): SkillEffectResult => ({
    resultKey, name: resultKey, description: null, sortOrder: 10, target: 'TARGET', resultType: 'DAMAGE',
    lifecycleBehavior: null, spellShieldBlockScope: null,
    valueRule: { value: formulaValue(formulaKey), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: { damageTypeKey: 'physics', deliveryKind: 'SKILL', originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: [] }
  });
  const effect = (effectKey: string, formulaKey: string): SkillEffect => ({ ...common, effectKey, name: effectKey,
    description: null, sortOrder: 10, lifecycle: null, results: [result(effectKey, formulaKey)] });
  const tick = process('one_tick', 'tick_damage');
  const detonate = process('detonate', 'detonation_damage');
  detonate.stateOperations = [
    ...phases.map((state, index) => write(state.stateKey, 0, (index + 1) * 10)),
    write(count.stateKey, 0, 40), write(restriction.stateKey, 1, 60, complete)
  ];
  const reapply = process('reapply');
  reapply.stateOperations = [write(phases[0]!.stateKey, 1, 70), write(count.stateKey, 1, 80)];
  const apply = process('apply_windows');
  apply.stateOperations = [...phases.map((state, index) => write(state.stateKey, 1, index * 10)),
    write(count.stateKey, 3, 40), write(reservation.stateKey, 1, 50), write(restriction.stateKey, 0, 60)];
  const terminal = process('terminal');
  terminal.stateOperations = [write(count.stateKey, 0, 10)];
  const rule = (ruleKey: string, eventSource: SkillTriggerRuleDetail['eventSource'], processKey: string): SkillTriggerRuleDetail => ({
    ruleKey, name: ruleKey, description: null, sortOrder: 10, eventSource, conditionGroups: [],
    actions: [{ actionKey: 'start', name: '开始', actionType: 'START_PROCESS', sortOrder: 10,
      detail: { processKey }, targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }],
    perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
  });
  const onHit = rule('apply_on_hit', { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'sample_active' } }, apply.processKey);
  onHit.conditionGroups = [{ groupKey: 'unblocked', name: '未被挡住', sortOrder: 10, conditions: [
    { conditionKey: 'unblocked', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 10,
      detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED', comparator: 'EQ', comparisonValue: fixedValue(0) } }
  ] }];
  onHit.actions.push(...phases.map((state, index) => ({
    actionKey: `extend_${state.stateKey}`, name: '保相位续期', actionType: 'MODIFY_INTERNAL_STATE' as const,
    sortOrder: 20 + index, targetContext: 'CURRENT_TARGET' as const,
    detail: { stateSkillKey: skillKey, stateKey: state.stateKey, operation: 'ENSURE_REMAINING_PRESERVE_PHASE' as const,
      value: parameterValue('duration_ms') }, runtimeInputBindings: [], resultModifiers: []
  })));
  const tail = rule('reapply_if_alive', { eventType: 'PROCESS_MOMENT', detail: { processKey: detonate.processKey,
    moment: complete } }, reapply.processKey);
  tail.sortOrder = 90;
  tail.conditionGroups = [{ groupKey: 'alive', name: '当前目标仍存活', sortOrder: 10, conditions: [
    { conditionKey: 'alive', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 10,
      detail: { subject: 'CURRENT_TARGET', attributeKey: 'hp', attributeValueKind: 'CURRENT', comparator: 'GT', comparisonValue: fixedValue(0) } }
  ] }];
  const killed = rule('terminal_before_state', { eventType: 'DAMAGE_DEALT', detail: {
    sourceSkillKey: null, damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY' } }, terminal.processKey);
  killed.conditionGroups = [{ groupKey: 'terminal', name: '逐伤前值与致死', sortOrder: 10, conditions: [
    { conditionKey: 'before', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 10,
      detail: { stateSkillKey: skillKey, stateKey: count.stateKey, valueKind: 'DAMAGE_BEFORE_VALUE', optionKey: null,
        expectedBoolean: null, comparator: 'GT', comparisonValue: fixedValue(0) } },
    { conditionKey: 'killed', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 20,
      detail: { eventValueKey: 'KILLED', comparator: 'EQ', comparisonValue: fixedValue(1) } }
  ] }];
  const configuration: SkillConfiguration = { ...structuredClone(base),
    skill: { ...base.skill, skillKey, name: '合成目标时序', skillCategoryKeys: ['passive'] },
    parameters: [ ['period_ms', 250], ['duration_ms', 4000] ].map(([key, value], index) => ({
      ...common, parameterKey: String(key), name: String(key), valueMode: 'FIXED', valueType: 'INTEGER',
      fixedValue: Number(value), levelValues: null, sortOrder: index * 10, description: null
    })),
    formulas: [ ['tick_amount', '0.00125'], ['detonation_amount', '0.06'] ].map(([key, ratio], index) => ({
      ...common, formulaKey: key!, name: key!, description: null, sortOrder: index * 10,
      expression: { inputs: [{ key: 'max_hp', binding: { kind: 'attribute', object: 'target', attributeKey: 'hp',
        valueKind: 'MAX', view: 'current_frame' } }], stages: [{ key: 'amount', name: '当前上限比例',
        expression: { op: 'mul', args: [{ op: 'read', inputKey: 'max_hp' }, { op: 'const', value: ratio! }] } }], outputStageKey: 'amount' }
    })), effects: [effect('tick_damage', 'tick_amount'), effect('detonation_damage', 'detonation_amount')],
    internalStates: [...phases, count, reservation, restriction], processes: [tick, detonate, reapply, apply, terminal],
    triggerRules: [onHit, tail, killed], baseDigest: 'synthetic_target_timing'
  };
  snapshot.skillConfigurations.push(configuration);
  snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'passive', name: '被动' });
  const origin = snapshot.selection.plannedSkills[0]!.origin;
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[0]!, skillKey, skillName: configuration.skill.name });
  snapshot.source.skillSources.push({ origin, skillKey, skillName: configuration.skill.name, skillStatus: 'ENABLED', enabled: true,
    skillLevel: 1, enabledRuleKeys: [onHit.ruleKey, killed.ruleKey].sort(), inactiveReason: null });
  snapshot.selection.sourceSkillSettings.push({ origin, skillKey, enabled: true, skillLevel: 1 });
  // 后台普攻仍由真实普攻入口驱动；时序P没有主动计划。
  const basic = snapshot.skillConfigurations[0]!;
  snapshot.selection.basicAttackSkillKey = basic.skill.skillKey; snapshot.selection.basicAttackLevel = 1;
  snapshot.source.skillSources[0]!.enabledRuleKeys = basic.triggerRules.map(row => row.ruleKey).sort();
  snapshot.source.skillSources[0]!.inactiveReason = null;
  const description: TriggeredSkillSourceDescription = { side: 'source', kind: 'character', stableId: 'lab_timing_definition',
    providerRef: 'lab_timing_mount', definitionRef: 'lab_timing_definition', path: 'source.skillSources.lab_timing',
    skills: [{ skillKey, skillLevel: 1, path: 'skills.lab_timing', configuration }] };
  return { snapshot, configuration, description, phases, reservation, count, restriction, tick, detonate, reapply, apply,
    terminal, onHit, tail, killed };
}

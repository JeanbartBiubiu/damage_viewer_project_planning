import { skillFormulaDefinition } from './skillFormulaDefinition';
import { simulationActiveSample } from './simulationActiveSkill';
import type { SkillActionInput, SkillActionInputs } from '../../src/engine/skillActionRequest';
import type { SkillProcessStep } from '../../src/types/skillProcess';
import type { SkillTriggerRuleDetail } from '../../src/types/skillTriggerRule';
import { fixedValue, formulaValue } from '../../src/types/numericValue';
import { plannedSkillRuleKeys } from '../../src/engine/simulation/sources/description';
import { triggeredEquipmentSimulationSample } from './simulationTriggeredEquipment';
import { naturalRuleKeys } from '../../src/engine/simulation/sources/description';

export type ComplexSampleKind = 'MULTI_HIT' | 'CHANNEL' | 'CHARGE' | 'RECAST';

export function simulationComplexSample(kind: ComplexSampleKind = 'MULTI_HIT', backgroundAttack = true, occupiesAction = true) {
  const snapshot = simulationActiveSample();
  const configuration = snapshot.skillConfigurations[1]!;
  const process = configuration.processes[0]!;
  const plan = snapshot.selection.plannedSkills[0]!;
  const initial = configuration.triggerRules[0]!;
  const baseStep = { stepKey: 'complex', name: '独立复杂步骤', description: null, sortOrder: 1, occupiesAction };
  let terminal: SkillProcessStep;
  if (kind === 'MULTI_HIT') terminal = { ...baseStep, stepType: kind, detail: { repeatCountValue: fixedValue(3), intervalValue: fixedValue(100) } };
  else if (kind === 'CHANNEL') terminal = { ...baseStep, stepType: kind, detail: { durationValue: fixedValue(600), executionCountValue: fixedValue(3), firstExecution: 'IMMEDIATE' } };
  else if (kind === 'CHARGE') terminal = { ...baseStep, stepType: kind, detail: { minimumChargeValue: fixedValue(200), maximumChargeValue: fixedValue(1000), releaseAtMaximum: false } };
  else terminal = { ...baseStep, stepType: kind, detail: { windowValue: fixedValue(500), maximumRecastCountValue: fixedValue(1) } };
  process.steps[0]!.occupiesAction = occupiesAction;
  process.steps.push(terminal);
  if (kind === 'CHARGE' || kind === 'RECAST') {
    const phase = kind === 'CHARGE' ? 'CHARGE_RELEASE' : 'RECAST';
    plan.phaseKinds.push(phase);
    configuration.triggerRules.push({ ...structuredClone(initial), ruleKey: 'release_cast', sortOrder: 2,
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: configuration.skill.skillKey, useKind: 'ACTIVE', castPhase: phase } },
      actions: [{ actionKey: 'release_cast', name: '明确关联原步骤推进', actionType: 'ADVANCE_PROCESS', sortOrder: 0, targetContext: null,
        detail: { processKey: process.processKey, stepKey: terminal.stepKey }, runtimeInputBindings: [], resultModifiers: [] }] });
  }
  plan.phaseKinds.push('CANCEL');
  configuration.triggerRules.push({ ...structuredClone(initial), ruleKey: 'cancel_cast', sortOrder: 3,
    eventSource: { eventType: 'PROCESS_CANCEL_REQUESTED', detail: { processKey: process.processKey } },
    actions: [{ actionKey: 'cancel_cast', name: '明确主动取消', actionType: 'FAIL_PROCESS', sortOrder: 0, targetContext: null,
      detail: { processKey: process.processKey, failureReason: 'ACTIVE_CANCELLED' }, runtimeInputBindings: [], resultModifiers: [] }] });
  if (kind === 'CHARGE') {
    configuration.parameters = [
      { gameId: snapshot.gameId, skillKey: plan.skillKey, parameterKey: 'charged_ms', name: '真实蓄力毫秒', description: null, sortOrder: 0,
        valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null, createdAt: '', updatedAt: '' },
      { gameId: snapshot.gameId, skillKey: plan.skillKey, parameterKey: 'base_hit', name: '独立基础伤害', description: null, sortOrder: 1,
        valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 100, levelValues: null, createdAt: '', updatedAt: '' }
    ];
    configuration.formulas = [{ gameId: snapshot.gameId, skillKey: plan.skillKey, formulaKey: 'charged_damage', name: '独立蓄力伤害表达式',
      description: null, sortOrder: 0, createdAt: '', updatedAt: '', expression: skillFormulaDefinition(plan.skillKey, { nodeType: 'OPERATION', operation: 'ADD', operands: [
        { nodeType: 'PARAMETER', parameterKey: 'base_hit' }, { nodeType: 'PARAMETER', parameterKey: 'charged_ms' }
      ] }) }];
    configuration.effects[0]!.results[0]!.valueRule!.value = formulaValue('charged_damage');
    const hitRule = configuration.triggerRules.find(rule => rule.eventSource.eventType === 'SKILL_HIT')!;
    hitRule.actions[0]!.runtimeInputBindings = [{ bindingKey: 'charge_input', parameterKey: 'charged_ms', sourceType: 'EVENT_VALUE', detail: { eventValueKey: 'CHARGE_DURATION_MS' } }];
  }
  snapshot.source.skillSources[1]!.enabledRuleKeys = plannedSkillRuleKeys(configuration, plan.phaseKinds);
  if (backgroundAttack) {
    snapshot.selection.basicAttackSkillKey = 'sample_basic_attack';
    snapshot.selection.basicAttackLevel = 1;
    snapshot.source.skillSources[0]!.enabledRuleKeys = ['begin_attack', 'hit_attack'];
    snapshot.source.skillSources[0]!.inactiveReason = null;
  }
  snapshot.source.selectedLevelValues.hp = 1000;
  snapshot.source.selectedLevelValues.attack_speed = 1;
  snapshot.source.selectedLevelValues.attack_damage = 30;
  snapshot.target.selectedLevelValues.hp = 5000;
  snapshot.source.attributes.levelValues['1'] = { ...snapshot.source.selectedLevelValues };
  snapshot.target.attributes.levelValues['1'] = { ...snapshot.target.selectedLevelValues };
  return snapshot;
}

export function complexAction(snapshot: ReturnType<typeof simulationComplexSample>, instructionKey: string, atMs: number,
  phaseKind: SkillActionInput['phaseKind'] = 'INITIAL', parentInstructionKey: string | null = null, sortOrder = 0): SkillActionInput {
  const plan = snapshot.selection.plannedSkills[0]!;
  return { origin: plan.origin, skillKey: plan.skillKey, skillLevel: plan.skillLevel, instructionKey, atMs, sortOrder, phaseKind,
    parentInstructionKey, targetSide: 'target', hitPreset: phaseKind === 'INITIAL' ? 'TARGET_HIT' : null };
}

export function complexInputs(actions: SkillActionInput[], durationMs = 1200): SkillActionInputs {
  return { actions, durationMs, recordTimeSeries: true, attackSpeedInputMax: 10,
    maxSkillActionRecords: 64, maxSkillUseRecords: 256, maxHealingRecords: 256 };
}

export function complexHitRules(snapshot: ReturnType<typeof simulationComplexSample>): SkillTriggerRuleDetail[] {
  return snapshot.skillConfigurations[1]!.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_HIT');
}

export function simulationComplexNaturalSample() {
  const snapshot = simulationComplexSample();
  const active = snapshot.skillConfigurations[1]!;
  const skillKey = 'sample_counter';
  const process = { ...structuredClone(active.processes[0]!), skillKey, activationType: 'PASSIVE' as const, processKey: 'increment', cooldown: null,
    steps: [{ stepKey: 'instant', name: '独立即时计数', description: null, sortOrder: 0, occupiesAction: false, stepType: 'IMMEDIATE' as const, detail: {} }],
    stateOperations: [{ operationKey: 'increment', name: '计数加一', stateSkillKey: skillKey, stateKey: 'hits', operation: 'INCREASE' as const,
      moment: { momentType: 'PROCESS_START' as const, stepKey: null, failureReason: null }, sortOrder: 0, value: fixedValue(1), optionKey: null }] };
  const start = { actionKey: 'increment', name: '推进本来源计数', actionType: 'START_PROCESS' as const, sortOrder: 0, targetContext: 'CURRENT_TARGET' as const,
    detail: { processKey: 'increment' }, runtimeInputBindings: [], resultModifiers: [] };
  const configuration = { ...structuredClone(active), skill: { ...active.skill, skillKey, name: '独立同角色命中计数来源', skillCategoryKeys: ['passive'] },
    parameters: [], formulas: [], processes: [process], internalStates: [{ gameId: snapshot.gameId, skillKey, stateKey: 'hits', name: '独立同目标计数',
      description: null, sortOrder: 0, createdAt: '', updatedAt: '', scope: 'TARGET' as const, stateType: 'COUNTER' as const,
      detail: { initialValue: fixedValue(0), maxValue: fixedValue(3), durationValue: fixedValue(4000) } }],
    effects: [{ ...structuredClone(active.effects[0]!), skillKey, effectKey: 'third_hit', results: [{ ...structuredClone(active.effects[0]!.results[0]!),
      valueRule: { value: fixedValue(20), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null } }] }],
    triggerRules: [
      { ...structuredClone(active.triggerRules[0]!), ruleKey: 'count_active_hit', eventSource: { eventType: 'SKILL_HIT' as const, detail: { sourceSkillKey: active.skill.skillKey } }, actions: [start] },
      { ...structuredClone(active.triggerRules[0]!), ruleKey: 'third_hit', eventSource: { eventType: 'PROCESS_MOMENT' as const,
        detail: { processKey: 'increment', moment: { momentType: 'PROCESS_COMPLETE' as const, stepKey: null, failureReason: null } } },
        conditionGroups: [{ groupKey: 'third', name: '第三次', sortOrder: 0, conditions: [{ conditionKey: 'count', conditionType: 'INTERNAL_STATE_CHECK' as const,
          sortOrder: 0, detail: { stateSkillKey: skillKey, stateKey: 'hits', valueKind: 'VALUE' as const, optionKey: null, expectedBoolean: null,
            comparator: 'EQ' as const, comparisonValue: fixedValue(3) } }] }],
        actions: [{ ...start, actionKey: 'third_hit', actionType: 'EXECUTE_EFFECT' as const, detail: { effectKey: 'third_hit' } }] }
    ] };
  snapshot.skillConfigurations.push(configuration);
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[1]!, skillKey, skillName: configuration.skill.name });
  snapshot.source.skillSources.push({ ...snapshot.source.skillSources[1]!, skillKey, skillName: configuration.skill.name,
    enabledRuleKeys: naturalRuleKeys(snapshot, configuration, 'source') });
  snapshot.selection.sourceSkillSettings.push({ origin: snapshot.selection.plannedSkills[0]!.origin, skillKey, skillLevel: 1, enabled: true });
  const equipment = JSON.parse(JSON.stringify(triggeredEquipmentSimulationSample()).replaceAll('lol', snapshot.gameId)) as typeof snapshot;
  const item = equipment.source.selectedEquipment[0]!;
  item.attributes.attributeValues = {};
  snapshot.source.selectedEquipment.push(item);
  snapshot.selection.sourceEquipmentKeys.push(item.equipment.equipmentKey);
  snapshot.skillConfigurations.push(equipment.skillConfigurations.find(configuration => configuration.skill.skillKey === 'item_1043_passive')!);
  snapshot.source.skillSources.push(equipment.source.skillSources.find(source => source.origin.kind === 'EQUIPMENT')!);
  snapshot.catalogs.skillCategories.push(equipment.catalogs.skillCategories.find(category => category.skillCategoryKey === 'passive')!);
  snapshot.catalogs.calculationRules.configuration!.equipmentPassiveCategoryKey = 'passive';
  return JSON.parse(JSON.stringify(snapshot).replaceAll('demo', 'lol')) as typeof snapshot;
}

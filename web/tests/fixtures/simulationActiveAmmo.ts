import { simulationActiveSample } from './simulationActiveSkill';
import type { SkillParameter } from '../../src/types/skillParameter';
import type { SkillInternalState } from '../../src/types/skillInternalState';
import type { SkillTriggerSceneInitialParameterBinding } from '../../src/types/skillTriggerRule';
import { naturalRuleKeys, plannedSkillRuleKeys } from '../../src/engine/simulationSkillSourceDescription';
import { sceneInitialParameterRequirements } from '../../src/engine/sceneInitialParameterInput';

/** 独立机制样例，不使用真实英雄标识或数据。 */
export function simulationActiveAmmo(backgroundAttack = true) {
  const snapshot = simulationActiveSample();
  const configuration = snapshot.skillConfigurations[1]!;
  const skillKey = configuration.skill.skillKey;
  const meta = { gameId: snapshot.gameId, skillKey, createdAt: '', updatedAt: '', description: null, sortOrder: 0 };
  const parameter = (parameterKey: string): SkillParameter => ({ ...meta, parameterKey, name: parameterKey,
    valueType: 'INTEGER', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null });
  configuration.parameters = ['initial_stock', 'initial_remaining', 'initial_phase', 'phase_read'].map(parameter);
  const binding = (parameterKey: string, minValue: number, maxValue: number): SkillTriggerSceneInitialParameterBinding => ({
    bindingKey: parameterKey, parameterKey, sourceType: 'SCENE_INITIAL_PARAMETER', detail: { minValue, maxValue }
  });
  const stock: SkillInternalState = { ...meta, stateKey: 'stock', name: '库存', stateType: 'AMMO', scope: 'SKILL', detail: {
    initialValue: { kind: 'PARAMETER', parameterKey: 'initial_stock' }, initialValueBinding: binding('initial_stock', 0, 4),
    maxValue: { kind: 'FIXED', value: 4 }, recoveryIntervalValue: { kind: 'FIXED', value: 20000 },
    recoveryMode: 'ONE_BY_ONE', recoveryStartCondition: 'AFTER_CONSUME',
    initialRemainingValue: { kind: 'PARAMETER', parameterKey: 'initial_remaining' }, initialRemainingMsBinding: binding('initial_remaining', 0, 20000)
  } };
  const phase: SkillInternalState = { ...meta, stateKey: 'next_phase', name: '下一发', stateType: 'COUNTER', scope: 'SKILL', detail: {
    initialValue: { kind: 'PARAMETER', parameterKey: 'initial_phase' }, initialValueBinding: binding('initial_phase', 1, 3), maxValue: { kind: 'FIXED', value: 3 }
  } };
  const frozen: SkillInternalState = { ...meta, stateKey: 'frozen_phase', name: '本次发射', stateType: 'COUNTER', scope: 'SKILL',
    detail: { initialValue: { kind: 'FIXED', value: 1 }, maxValue: { kind: 'FIXED', value: 3 } } };
  configuration.internalStates = [stock, phase, frozen];
  configuration.formulas = [{ ...meta, formulaKey: 'next_phase', name: '循环推进', expression: {
    inputs: [{ key: 'phase', binding: { kind: 'parameter', skillKey, parameterKey: 'phase_read' } }],
    stages: [{ key: 'next', name: '循环', expression: { op: 'if', args: [
      { op: 'eq', args: [{ op: 'read', inputKey: 'phase' }, { op: 'const', value: '3' }] },
      { op: 'const', value: '1' }, { op: 'add', args: [{ op: 'read', inputKey: 'phase' }, { op: 'const', value: '1' }] }
    ] } }], outputStageKey: 'next'
  } }];
  const process = configuration.processes[0]!;
  process.steps = [{ ...process.steps[0]!, stepType: 'IMMEDIATE', occupiesAction: false, detail: {} }];
  process.cooldown!.durationValue = { kind: 'FIXED', value: 2000 };
  const moment = { momentType: 'PROCESS_START' as const, stepKey: null, failureReason: null };
  process.stateOperations = [
    { operationKey: 'consume', name: '扣一枚', stateSkillKey: skillKey, stateKey: 'stock', moment, operation: 'CONSUME',
      value: { kind: 'FIXED', value: 1 }, optionKey: null, sortOrder: 0 },
    { operationKey: 'freeze', name: '冻结序号', stateSkillKey: skillKey, stateKey: 'frozen_phase', moment, operation: 'SET',
      value: { kind: 'PARAMETER', parameterKey: 'phase_read' }, optionKey: null, sortOrder: 1 },
    { operationKey: 'advance', name: '推进序号', stateSkillKey: skillKey, stateKey: 'next_phase', moment, operation: 'SET',
      value: { kind: 'FORMULA', formulaKey: 'next_phase' }, optionKey: null, sortOrder: 2 }
  ];
  configuration.triggerRules[0]!.actions[0]!.runtimeInputBindings = [{ bindingKey: 'phase_read', parameterKey: 'phase_read', sourceType: 'INTERNAL_STATE',
    detail: { stateSkillKey: skillKey, stateKey: 'next_phase', valueKind: 'VALUE', optionKey: null } }];
  const small = configuration.triggerRules[1]!;
  const condition = (comparator: 'LT' | 'EQ') => [{ groupKey: 'phase', name: '本次发射', sortOrder: 0,
    conditions: [{ conditionKey: 'phase', conditionType: 'INTERNAL_STATE_CHECK' as const, sortOrder: 0, detail: {
      stateSkillKey: skillKey, stateKey: 'frozen_phase', valueKind: 'VALUE' as const, optionKey: null, expectedBoolean: null,
      comparator, comparisonValue: { kind: 'FIXED' as const, value: 3 }
    } }] }];
  small.conditionGroups = condition('LT');
  const big = structuredClone(small); big.ruleKey = 'big_hit'; big.sortOrder = 2; big.conditionGroups = condition('EQ');
  const bigEffect = structuredClone(configuration.effects[0]!); bigEffect.effectKey = 'big_damage';
  bigEffect.results[0]!.valueRule!.value = { kind: 'FIXED', value: 200 };
  configuration.effects.push(bigEffect);
  big.actions = [{ ...big.actions[0]!, actionType: 'EXECUTE_EFFECT', detail: { effectKey: bigEffect.effectKey } }];
  configuration.triggerRules.push(big);
  configuration.triggerRules.push({ ...structuredClone(small), ruleKey: 'refund', sortOrder: 3,
    eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }, conditionGroups: [{ groupKey: 'champion', name: '英雄命中', sortOrder: 0,
      conditions: [{ conditionKey: 'champion', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 0, detail: { categories: ['CHAMPION'] } }] }],
    actions: [{ actionKey: 'refund', name: '减下一枚回充', actionType: 'MODIFY_INTERNAL_STATE', targetContext: 'EVENT_SOURCE', sortOrder: 0,
      detail: { stateSkillKey: skillKey, stateKey: 'stock', operation: 'REDUCE_RECOVERY', value: { kind: 'FIXED', value: 2000 } },
      runtimeInputBindings: [], resultModifiers: [] }] });
  if (backgroundAttack) {
    snapshot.selection.basicAttackSkillKey = 'sample_basic_attack'; snapshot.selection.basicAttackLevel = 1;
    snapshot.source.skillSources[0]!.inactiveReason = null;
    snapshot.source.skillSources[0]!.enabledRuleKeys = snapshot.skillConfigurations[0]!.triggerRules.map(row => row.ruleKey).sort();
  }
  snapshot.source.skillSources[1]!.enabledRuleKeys = [...naturalRuleKeys(snapshot, configuration, 'source'), ...plannedSkillRuleKeys(configuration)].sort();
  const inputs = (stock = 1, remaining = 5000, phase = 1) => sceneInitialParameterRequirements(snapshot).map(requirement => ({
    side: requirement.side, origin: requirement.origin, skillKey: requirement.skillKey, parameterKey: requirement.parameterKey,
    declarationIdentity: requirement.declarationIdentity,
    value: ({ initial_stock: stock, initial_remaining: remaining, initial_phase: phase } as Record<string, number>)[requirement.parameterKey]!
  }));
  return { snapshot, configuration, process, stock, phase, frozen, inputs };
}

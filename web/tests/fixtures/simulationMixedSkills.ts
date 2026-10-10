import { skillFormulaDefinition } from './skillFormulaDefinition';
import type { SkillActionInput, SkillActionInputs } from '../../src/engine/skillActionRequest';
import { inspectSimulationSnapshot, prepareSimulation } from '../../src/engine/simulationAdapter';
import { simulationActiveSample } from './simulationActiveSkill';
import { triggeredEquipmentSimulationSample } from './simulationTriggeredEquipment';
import { fixedValue, formulaValue } from '../../src/types/numericValue';
import { syncSimulationSkillSources } from './simulationSkillSources';

export function simulationMixedSample(backgroundAttack = true, occupiesAction = true) {
  const snapshot = simulationActiveSample();
  const healing = simulationActiveSample(true);
  const secondKey = 'sample_second';
  const second = JSON.parse(JSON.stringify(healing.skillConfigurations[1]).replaceAll('sample_active', secondKey)) as typeof snapshot.skillConfigurations[number];
  snapshot.skillConfigurations.push(second);
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[1]!, skillKey: secondKey, skillName: '独立第二技能' });
  snapshot.source.skillSources.push({ ...snapshot.source.skillSources[1]!, skillKey: secondKey, skillName: '独立第二技能',
    enabledRuleKeys: second.triggerRules.map(rule => rule.ruleKey).sort() });
  snapshot.selection.plannedSkills.push({ ...snapshot.selection.plannedSkills[0]!, skillKey: secondKey });
  snapshot.selection.sourceSkillSettings.push({ ...snapshot.selection.sourceSkillSettings[0]!, skillKey: secondKey });
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
  for (const configuration of snapshot.skillConfigurations.slice(1)) for (const step of configuration.processes[0]!.steps) step.occupiesAction = occupiesAction;
  return snapshot;
}

export function mixedAction(snapshot: ReturnType<typeof simulationMixedSample>, skillKey: string, instructionKey: string,
  atMs: number, sortOrder = 0): SkillActionInput {
  const plan = snapshot.selection.plannedSkills.find(plan => plan.skillKey === skillKey)!;
  return { origin: plan.origin, skillKey, skillLevel: plan.skillLevel, instructionKey, atMs, sortOrder,
    phaseKind: 'INITIAL', parentInstructionKey: null, targetSide: skillKey === 'sample_second' ? 'source' : 'target',
    hitPreset: skillKey === 'sample_second' ? null : 'TARGET_HIT' };
}

export function mixedInputs(snapshot: ReturnType<typeof simulationMixedSample>): SkillActionInputs {
  return { actions: [mixedAction(snapshot, 'sample_active', 'first_cast', 0), mixedAction(snapshot, 'sample_second', 'competing_cast', 0, 1),
    mixedAction(snapshot, 'sample_second', 'after_release', 100), mixedAction(snapshot, 'sample_active', 'cooldown_before', 999),
    mixedAction(snapshot, 'sample_active', 'cooldown_at', 1000), mixedAction(snapshot, 'sample_active', 'cooldown_after', 1001)],
    durationMs: 1500, attackSpeedInputMax: 10, recordTimeSeries: false,
    maxSkillActionRecords: 64, maxSkillUseRecords: 256, maxHealingRecords: 256 };
}

export async function prepareMixedSample(snapshot = simulationMixedSample()) {
  const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
  return prepareSimulation(snapshot, attributes, { source: 300, target: 5000 });
}

export function simulationChangingSpeedSample() {
  const snapshot = simulationMixedSample(true, false);
  snapshot.selection.plannedSkills = snapshot.selection.plannedSkills.filter(plan => plan.skillKey === 'sample_active');
  snapshot.selection.sourceSkillSettings.find(setting => setting.skillKey === 'sample_second')!.enabled = false;
  snapshot.catalogs.attributes.find(row => row.attributeKey === 'attack_speed')!.attributeKey = 'saved_tempo';
  snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes.find(row => row.attributeKey === 'saved_tempo')!,
    attributeKey: 'saved_extra', name: '作者额外速度', minValue: 0, maxValue: null });
  for (const side of ['source', 'target'] as const) {
    const values = snapshot[side].selectedLevelValues;
    values.saved_tempo = values.attack_speed!;
    delete values.attack_speed;
    values.saved_extra = 0;
    snapshot[side].attributes.levelValues['1'] = { ...values };
  }
  for (const configuration of snapshot.skillConfigurations) for (const formula of configuration.formulas) {
    for (const input of formula.expression.inputs) if (input.binding.kind === 'attribute' && input.binding.attributeKey === 'attack_speed') input.binding.attributeKey = 'saved_tempo';
  }
  const calculation = snapshot.catalogs.calculationRules.configuration!;
  calculation.attackSpeedAttributeKey = 'saved_tempo';
  calculation.attributeDerivations = [{ ruleKey: 'active_speed', attributeKey: 'saved_tempo', valuePolicy: 'set',
    activationAttributeKeys: ['saved_extra'], formula: {
      inputs: [{ key: 'base', binding: { kind: 'attribute', object: 'source', attributeKey: 'saved_tempo', valueKind: 'BASE', view: 'current_frame' } },
        { key: 'extra', binding: { kind: 'attribute', object: 'source', attributeKey: 'saved_extra', valueKind: 'TOTAL', view: 'current_frame' } }],
      stages: [{ key: 'output', name: '作者最终速度', expression: { op: 'add', args: [{ op: 'read', inputKey: 'base' }, { op: 'read', inputKey: 'extra' }] } }], outputStageKey: 'output'
    } }];
  const active = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
  active.effects[0]!.results.push({ resultKey: 'speed_gain', name: '即时自身速度输入', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE',
    description: null, sortOrder: 30, spellShieldBlockScope: null, lifecycleBehavior: null,
    valueRule: { value: fixedValue(.2), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: { attributeKey: 'saved_extra', operation: 'INCREASE', modifierZoneKey: null } });
  return syncSimulationSkillSources(snapshot);
}

export function changingSpeedInputs(snapshot = simulationChangingSpeedSample()): SkillActionInputs {
  return { actions: [mixedAction(snapshot, 'sample_active', 'speed_cast', 500)], durationMs: 2700, attackSpeedInputMax: 10,
    recordTimeSeries: false, maxSkillActionRecords: 64, maxSkillUseRecords: 256, maxHealingRecords: 256 };
}

export function simulationEmpoweredSample() {
  const snapshot = simulationMixedSample();
  const equipmentSample = JSON.parse(JSON.stringify(triggeredEquipmentSimulationSample()).replaceAll('lol', 'demo')) as typeof snapshot;
  const equipment = equipmentSample.source.selectedEquipment[0]!;
  equipment.attributes.attributeValues = { ability_haste: 10 };
  const configuration = equipmentSample.skillConfigurations.find(configuration => configuration.skill.skillKey === 'item_1043_passive')!;
  const skillKey = configuration.skill.skillKey;
  configuration.skill.name = '独立强化待击作者构造';
  configuration.internalStates = [
    { gameId: snapshot.gameId, skillKey, stateKey: 'ready', name: '待击标志', description: null, sortOrder: 0,
      scope: 'SKILL', stateType: 'FLAG', detail: { initialEnabled: false }, createdAt: '', updatedAt: '' },
    { gameId: snapshot.gameId, skillKey, stateKey: 'icd', name: '内部冷却', description: null, sortOrder: 1,
      scope: 'SKILL', stateType: 'INTERNAL_COOLDOWN', detail: { durationValue: fixedValue(300) }, createdAt: '', updatedAt: '' }
  ];
  const moment = (momentType: 'PROCESS_START' | 'STEP_EXECUTION' | 'STEP_TIMEOUT') => ({ momentType,
    stepKey: momentType === 'PROCESS_START' ? null : 'wait_hit', failureReason: null });
  configuration.processes = [{ gameId: snapshot.gameId, skillKey, processKey: 'empowered', name: '独立等待一次命中',
    description: null, sortOrder: 0, createdAt: '', updatedAt: '', activationType: 'ACTIVE', cooldown: null,
    steps: [{ stepKey: 'wait_hit', name: '强化待击', description: null, sortOrder: 0, stepType: 'EMPOWERED_BASIC_ATTACK', occupiesAction: false,
      detail: { windowValue: fixedValue(1000), consumeMoment: 'ATTACK_HIT' } }],
    effectBindings: [{ bindingKey: 'deal', effectKey: configuration.effects[0]!.effectKey, moment: moment('STEP_EXECUTION'), sortOrder: 10 }],
    stateOperations: [
      { operationKey: 'arm', name: '开启', stateSkillKey: skillKey, stateKey: 'ready', operation: 'ENABLE', value: null, optionKey: null, moment: moment('PROCESS_START'), sortOrder: 10 },
      { operationKey: 'consume', name: '消费', stateSkillKey: skillKey, stateKey: 'ready', operation: 'DISABLE', value: null, optionKey: null, moment: moment('STEP_EXECUTION'), sortOrder: 20 },
      { operationKey: 'cooldown', name: '起算内部冷却', stateSkillKey: skillKey, stateKey: 'icd', operation: 'START', value: null, optionKey: null, moment: moment('STEP_EXECUTION'), sortOrder: 30 },
      { operationKey: 'timeout', name: '超时清空', stateSkillKey: skillKey, stateKey: 'ready', operation: 'DISABLE', value: null, optionKey: null, moment: moment('STEP_TIMEOUT'), sortOrder: 40 }
    ] }];
  configuration.triggerRules = [{ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'arm',
    eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: null, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
    actions: [{ actionKey: 'begin', name: '开启待击', actionType: 'START_PROCESS', detail: { processKey: 'empowered' },
      sortOrder: 0, targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }],
    conditionGroups: [{ groupKey: 'cooldown', name: '冷却就绪', sortOrder: 0, conditions: [{ conditionKey: 'ready', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 0,
      detail: { stateSkillKey: skillKey, stateKey: 'icd', valueKind: 'REMAINING_MS', optionKey: null, expectedBoolean: null,
        comparator: 'EQ', comparisonValue: fixedValue(0) } }] }] }];
  snapshot.skillConfigurations.push(configuration);
  snapshot.selection.sourceEquipmentKeys = [equipment.equipment.equipmentKey];
  snapshot.source.selectedEquipment.push(equipment);
  snapshot.source.skillSources.push({ origin: { kind: 'EQUIPMENT', equipmentKey: equipment.equipment.equipmentKey },
    skillKey, skillName: configuration.skill.name, skillStatus: 'ENABLED', enabled: true, skillLevel: 1,
    enabledRuleKeys: ['arm'], inactiveReason: null });
  snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'ability_haste', name: '技能急速' });
  snapshot.catalogs.skillCategories.push(equipmentSample.catalogs.skillCategories.find(category => category.skillCategoryKey === 'passive')!);
  return JSON.parse(JSON.stringify(snapshot).replaceAll('demo', 'lol')) as typeof snapshot;
}

export function simulationHasteSample(haste = 10) {
  const snapshot = simulationMixedSample(false);
  snapshot.source.selectedLevelValues.ability_haste = haste;
  snapshot.source.attributes.levelValues['1'] = { ...snapshot.source.selectedLevelValues };
  snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'ability_haste', name: '技能急速' });
  for (const [index, configuration] of snapshot.skillConfigurations.slice(1).entries()) {
    configuration.parameters = [['base_cooldown_ms', index === 0 ? 4000 : 7000], ['haste_scale', 100]].map(([parameterKey, amount]) => ({
      gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, parameterKey: String(parameterKey), name: String(parameterKey),
      description: null, sortOrder: 0, createdAt: '', updatedAt: '', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: Number(amount), levelValues: null
    }));
    configuration.formulas = [{ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, formulaKey: 'effective_cooldown',
      name: '独立作者急速冷却', description: null, sortOrder: 0, createdAt: '', updatedAt: '', expression: skillFormulaDefinition(configuration.skill.skillKey, {
        nodeType: 'OPERATION', operation: 'DIVIDE', operands: [
          { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [{ nodeType: 'PARAMETER', parameterKey: 'base_cooldown_ms' }, { nodeType: 'PARAMETER', parameterKey: 'haste_scale' }] },
          { nodeType: 'OPERATION', operation: 'ADD', operands: [{ nodeType: 'PARAMETER', parameterKey: 'haste_scale' },
            { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'ability_haste', attributeValueKind: 'TOTAL' }] }
        ]
      }) }];
    configuration.processes[0]!.cooldown!.durationValue = formulaValue('effective_cooldown');
  }
  return snapshot;
}

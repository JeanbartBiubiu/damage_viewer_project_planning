import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { simulationComplexSample } from '../../tests/fixtures/simulationComplexSkills';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { equipmentSimulationSample } from '../../tests/fixtures/simulationEquipment';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import type { SkillTriggerSceneAttributeSnapshotBinding } from '../types/skillTriggerRule';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { fixedValue, formulaValue, parameterValue } from '../types/numericValue';
import { sceneAttributeParameterInputs } from './sceneAttributeSnapshotInput';
import { adaptProcessProgram, type AuthoredProcessProgram } from './processAdapter';
import { assembleSimulation, inspectSimulationSnapshot, simulationAbility } from './simulationAdapter';
import { automaticSkillRequest } from './automaticSkillRequest';
import { assessAutomaticSkillResult } from './automaticSkillResult';
import { TinyGoV2Bridge } from './tinygoV2Bridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';

let bridge: TinyGoV2Bridge;
beforeAll(async () => {
  const bytes = readFileSync(process.env.PHASE3B_WASM_PATH || new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url));
  expect(bytes.length).toBe(2750409);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('1346f63b089edfda34335720864b3784196b350504ec47d75134524df1ba70d1');
  bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
});

function sample(suffix = 'alpha') {
  const original = simulationComplexSample('CHANNEL', false);
  const oldSkill = original.selection.plannedSkills[0]!.skillKey;
  const skillKey = `snapshot_channel_${suffix}`, attributeKey = `snapshot_stat_${suffix}`, parameterKey = `snapshot_input_${suffix}`;
  const snapshot = JSON.parse(JSON.stringify(original).replaceAll(oldSkill, skillKey)) as SimulationSnapshot;
  const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === skillKey)!;
  const process = configuration.processes[0]!;
  const step = process.steps[1]!;
  if (step.stepType !== 'CHANNEL') throw new Error('需要真实引导步骤');
  process.steps = [{ ...step, sortOrder: 0, detail: { ...step.detail, executionCountValue: formulaValue('frozen_count') } }];
  process.cooldown!.startMoment = { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null };
  configuration.triggerRules = configuration.triggerRules.filter(rule => rule.eventSource.eventType !== 'PROCESS_CANCEL_REQUESTED');
  snapshot.selection.plannedSkills[0]!.phaseKinds = ['INITIAL'];
  configuration.parameters = [{ gameId: snapshot.gameId, skillKey, parameterKey, name: '本次指定来源快照', description: null,
    valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null, levelValues: null, sortOrder: 0, createdAt: '', updatedAt: '' }];
  configuration.formulas = [{ gameId: snapshot.gameId, skillKey, formulaKey: 'frozen_count', name: '独立取整圈数', description: null,
    sortOrder: 0, createdAt: '', updatedAt: '', expression: {
      inputs: [{ key: 'snapshot', binding: { kind: 'parameter', skillKey, parameterKey } }],
      stages: [{ key: 'count', name: '圈数', expression: { op: 'add', args: [{ op: 'const', value: '1' },
        { op: 'floor', args: [{ op: 'mul', args: [{ op: 'read', inputKey: 'snapshot' }, { op: 'const', value: '4' }] }] }] } }], outputStageKey: 'count'
    } }];
  snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey, name: '独立场景属性', valueType: 'DECIMAL' });
  snapshot.source.selectedLevelValues[attributeKey] = .25;
  snapshot.source.attributes.levelValues['1'] = { ...snapshot.source.selectedLevelValues };
  const equipment = structuredClone(equipmentSimulationSample(['item_1042']).source.selectedEquipment[0]!);
  equipment.equipment.gameId = snapshot.gameId;
  equipment.attributes.attributeValues = { [attributeKey]: .5 };
  snapshot.source.selectedEquipment = [equipment];
  snapshot.selection.sourceEquipmentKeys = [equipment.equipment.equipmentKey];
  const binding: SkillTriggerSceneAttributeSnapshotBinding = { bindingKey: 'scene_snapshot', parameterKey, sourceType: 'SCENE_ATTRIBUTE_SNAPSHOT',
    detail: { subject: 'SOURCE', attributeKey, sources: ['CHARACTER_LEVEL', 'EQUIPMENT_DIRECT'] } };
  configuration.triggerRules[0]!.actions[0]!.runtimeInputBindings = [binding];
  syncSimulationSkillSources(snapshot);
  return { snapshot, configuration, process, skillKey, attributeKey, parameterKey, binding };
}

function authoredOf(context: ReturnType<typeof sample>): AuthoredProcessProgram {
  return { gameId: context.snapshot.gameId, skillKey: context.skillKey, skillLevel: 1, characterLevel: context.snapshot.selection.sourceLevel,
    process: context.process, effects: context.configuration.effects, parameters: context.configuration.parameters,
    formulas: context.configuration.formulas, rules: context.configuration.triggerRules.filter(rule => rule.eventSource.eventType !== 'SKILL_HIT'),
    castCosts: [], modifierZones: context.snapshot.catalogs.modifierZones,
    sceneAttributeInputs: sceneAttributeParameterInputs(context.snapshot, context.configuration, context.process.processKey) };
}

async function execute(context: ReturnType<typeof sample>, expectedSnapshot: number, expectedCount: number) {
  const { snapshot, skillKey, parameterKey } = context;
  const before = structuredClone(snapshot);
  const collector = sceneAttributeParameterInputs(snapshot, context.configuration, context.process.processKey);
  expect(collector).toEqual([expect.objectContaining({ parameterKey, attributeKey: context.attributeKey, value: expectedSnapshot })]);
  const standalone = adaptProcessProgram(authoredOf(context));
  expect(standalone.provider.abilities.find(ability => ability.abilityKey === standalone.initialAbilityKey)?.params?.[parameterKey]).toBe(expectedSnapshot);
  approveSnapshotFixture(snapshot);
  const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
  const prepared = assembleSimulation(snapshot, attributes, { source: 500, target: 5000 });
  const binding = prepared.compileRequest.rules.skillActionBindings!.find(row => row.skillKey === skillKey)!;
  const first = simulationAbility(prepared.compileRequest, binding.controls[0]!.abilityRef)!;
  expect(first.ability.params?.[parameterKey]).toBe(expectedSnapshot);
  const formula = prepared.compileRequest.formulas!.find(formula => formula.skillKey === skillKey && formula.parameters.some(row => row.parameterKey === parameterKey))!;
  expect(formula.parameters).toEqual([{ parameterKey, valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', runtimeSource: { kind: 'ability_parameter' } }]);
  expect(snapshot).toEqual(before);
  const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
  expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
  if (!compiled.sessionId) throw new Error('缺少真实会话');
  try {
    const selected = snapshot.selection.plannedSkills[0]!;
    const request = (await automaticSkillRequest(prepared, snapshot, { rules: [{ ...selected, ruleKey: 'scene_channel', sortOrder: 0,
      targetSide: 'target', hitPreset: 'TARGET_HIT', waitForCooldowns: [], releaseAfterRuleKey: null }], durationMs: 600,
    recordTimeSeries: false, maxAutomaticSkillRecords: 1000, maxHealingRecords: 20, outputMode: 'detailed' }, compiled.sessionId)).runRequest;
    const done = parseDoneResult(bridge.run(request));
    const process = done.finalSnapshot.processInstances!.find(row => row.skillKey === skillKey)!;
    expect(process).toMatchObject({ status: 'complete', finishedAtMs: 600, repeat: { executionCount: expectedCount, executionIndex: expectedCount } });
    expect(done.summary.skillUses).toMatchObject({ startedCount: 1, completedCount: 1, releasedCount: expectedCount, hitCount: expectedCount });
    expect(done.damageRecords!.filter(row => row.useRef === process.useKey).map(row => row.timeMs))
      .toEqual(Array.from({ length: expectedCount }, (_, index) => Math.round(600 * index / expectedCount)));
    const assessment = assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins);
    expect(assessment.factsValid, assessment.issues.join(';')).toBe(true);
    return { done, prepared, first, collector };
  } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
}

function addFirstHeal(context: ReturnType<typeof sample>) {
  const original = simulationActiveSample(true).skillConfigurations[1]!;
  const healer = JSON.parse(JSON.stringify(original).replaceAll(original.skill.skillKey, context.skillKey)) as typeof original;
  const effect = healer.effects[0]!;
  const rule = healer.triggerRules.find(rule => rule.actions.some(action => action.actionType === 'EXECUTE_EFFECT' && action.detail.effectKey === effect.effectKey))!;
  context.configuration.effects.push(effect);
  context.configuration.triggerRules.push(rule);
  syncSimulationSkillSources(context.snapshot);
  return { effect, rule };
}

describe('场景属性快照到正式Wasm引导圈数的完整接线', () => {
  it.each(['alpha', 'beta'])('%s异名属性／技能／参数：等级与装备直接值合成后沿实际首次能力供给动态圈数', async suffix => {
    const context = sample(suffix);
    const result = await execute(context, .75, 4);
    expect(result.collector[0]!.sourcePaths).toEqual([`source.selectedLevelValues.${context.attributeKey}`, `source.selectedEquipment[0].attributes.attributeValues.${context.attributeKey}`]);
  });

  it('等级改变重新准备，旧首次能力参数保持自己的冻结数值', async () => {
    const context = sample();
    const old = await execute(context, .75, 4);
    context.snapshot.catalogs.levelConfig!.maxLevel = 2;
    context.snapshot.source.attributes.maxLevel = 2;
    context.snapshot.source.attributes.levelValues['2'] = { ...context.snapshot.source.selectedLevelValues, [context.attributeKey]: .5 };
    context.snapshot.selection.sourceLevel = 2;
    context.snapshot.source.selectedLevelValues = { ...context.snapshot.source.attributes.levelValues['2']! };
    await execute(context, 1, 5);
    expect(old.first.ability.params?.[context.parameterKey]).toBe(.75);
  });

  it.each(['no_equipment', 'sparse_equipment'] as const)('仅装备来源的%s真实0不是缺失，圈数公式仍得到1', async kind => {
    const context = sample();
    context.binding.detail.sources = ['EQUIPMENT_DIRECT'];
    delete context.snapshot.source.selectedLevelValues[context.attributeKey];
    delete context.snapshot.source.attributes.levelValues['1']![context.attributeKey];
    if (kind === 'no_equipment') {
      context.snapshot.source.selectedEquipment = [];
      context.snapshot.selection.sourceEquipmentKeys = [];
    } else context.snapshot.source.selectedEquipment[0]!.attributes.attributeValues = {};
    await execute(context, 0, 1);
  });

  it('同一场景换装备直接属性后重新准备，次数改变且原请求保持原数值', async () => {
    const context = sample();
    const old = await execute(context, .75, 4);
    context.snapshot.source.selectedEquipment[0]!.attributes.attributeValues[context.attributeKey] = .75;
    await execute(context, 1, 5);
    expect(old.first.ability.params?.[context.parameterKey]).toBe(.75);
  });

  it('施放时真实临时属性增加10，场景快照及圈数仍只使用等级与装备', async () => {
    const context = sample();
    context.snapshot.catalogs.modifierZones.push({ gameId: context.snapshot.gameId, modifierZoneKey: 'temporary_flat', name: '临时平加',
      domain: 'ATTRIBUTE', calculationMode: 'FLAT_ADD', applicationStage: 'ATTRIBUTE_FLAT', status: 'ENABLED', description: null,
      sortOrder: 0, createdAt: '', updatedAt: '' });
    context.configuration.effects.push({ gameId: context.snapshot.gameId, skillKey: context.skillKey, effectKey: 'temporary', name: '真实临时增益',
      description: null, sortOrder: 1, createdAt: '', updatedAt: '',
      lifecycle: { instanceScope: 'SOURCE', durationValue: fixedValue(1000), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
        reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null,
        firstPeriodicExecution: null, endWhenShieldEndsResultKey: null },
      results: [{ resultKey: 'temporary', name: '临时值', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description: null, sortOrder: 0,
        spellShieldBlockScope: null, lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
          reapplicationValueMode: 'REPLACE', periodicExecutionMode: null },
        valueRule: { value: fixedValue(10), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: { attributeKey: context.attributeKey, operation: 'INCREASE', modifierZoneKey: 'temporary_flat' } }] });
    context.process.effectBindings.push({ bindingKey: 'temporary', effectKey: 'temporary', sortOrder: 0,
      moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } });
    syncSimulationSkillSources(context.snapshot);
    const { done } = await execute(context, .75, 4);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'source')!.attributes[context.attributeKey]!.resolved).toBe(10.75);
  });

  it.each(['PARAMETER', 'FORMULA'] as const)('%s条件不能借首次绑定的场景参数读取能力帧', kind => {
    const context = sample();
    const { rule } = addFirstHeal(context);
    const condition = rule.conditionGroups[0]!.conditions[0]!;
    if (condition.conditionType !== 'ATTRIBUTE_COMPARE') throw new Error('需要真实属性比较');
    condition.detail.comparisonValue = kind === 'PARAMETER' ? parameterValue(context.parameterKey) : formulaValue('frozen_count');
    expect(() => adaptProcessProgram(authoredOf(context))).toThrow(/条件比较不能使用计算时输入/);
  });

  it.each(['PARAMETER', 'FORMULA'] as const)('首次治疗监听的%s金额不能继承没有能力参数帧的场景读取', kind => {
    const context = sample();
    const { effect } = addFirstHeal(context);
    effect.results[0]!.valueRule!.value = kind === 'PARAMETER' ? parameterValue(context.parameterKey) : formulaValue('frozen_count');
    expect(() => adaptProcessProgram(authoredOf(context))).toThrow(/首次自身治疗不能使用未供值的计算时输入/);
  });

  it('合法固定首次治疗继续执行，只有实际首次能力持有场景参数', async () => {
    const context = sample();
    addFirstHeal(context);
    const { done, prepared, first } = await execute(context, .75, 4);
    const listeners = first.provider.abilities!.filter(ability => ability.listenerSpec);
    expect(listeners.length).toBeGreaterThan(0);
    for (const listener of listeners) {
      expect(listener.params).toBeUndefined();
      expect(JSON.stringify(listener.listenerSpec)).not.toContain(`ability.param.${context.parameterKey}`);
    }
    expect(done.healingRecords).toEqual([expect.objectContaining({ rawAmount: 40, actualHealing: 40, hpBefore: 500, hpAfter: 540 })]);
    expect(prepared.compileRequest.sharedProviders!.flatMap(provider => provider.abilities ?? [])
      .filter(ability => Object.prototype.hasOwnProperty.call(ability.params ?? {}, context.parameterKey))).toEqual([first.ability]);
  });
});

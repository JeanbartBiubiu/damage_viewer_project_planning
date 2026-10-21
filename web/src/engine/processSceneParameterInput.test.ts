import { describe, expect, it } from 'vitest';
import { simulationSceneInitialParameter } from '../../tests/fixtures/simulationSceneInitialParameter';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { fixedValue, parameterValue } from '../types/numericValue';
import { sceneInitialParameterInput, sceneInitialParameterRequirements } from './sceneInitialParameterInput';
import { validateProcessSceneParameterBinding } from './processSceneParameterInput';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { skillFormulaPreflightRequest } from './skillFormulaPreflight';
import { rememberApprovedFormulaValues } from './approvedFormulaValues';
import { compileFixtureWithNative } from '../../tests/fixtures/nativeFormulaProof';

function sample() {
  const { snapshot, configuration } = simulationSceneInitialParameter();
  configuration.triggerRules = [configuration.triggerRules[0]!];
  const rule = configuration.triggerRules[0]!, action = rule.actions[0]!;
  rule.conditionGroups = [{ groupKey: 'self', name: '明确自身', sortOrder: 0,
    conditions: [{ conditionKey: 'self', conditionType: 'EXPLICIT_TARGET_IS_SOURCE', detail: {}, sortOrder: 0 }] }];
  const binding = { bindingKey: 'stacks', parameterKey: 'prebattle_count', sourceType: 'SCENE_INITIAL_PARAMETER' as const,
    detail: { minValue: 0, maxValue: 150, sharedInputKey: 'shared_count' } };
  action.runtimeInputBindings = [binding];
  const process = configuration.processes[0]!;
  process.steps = [{ stepKey: 'attack', name: '待击', description: null, sortOrder: 0, occupiesAction: false,
    stepType: 'EMPOWERED_BASIC_ATTACK', detail: { windowValue: fixedValue(6000), consumeMoment: 'ATTACK_HIT' } }];
  const effect = configuration.effects[0]!;
  configuration.effects = [effect];
  effect.results[0]!.valueRule!.value = { kind: 'FORMULA', formulaKey: 'prebattle_bonus' };
  process.effectBindings = [{ bindingKey: 'payload', effectKey: effect.effectKey, sortOrder: 0,
    moment: { momentType: 'STEP_EXECUTION', stepKey: 'attack', failureReason: null } }];
  snapshot.selection.basicAttackSkillKey = snapshot.skillConfigurations[0]!.skill.skillKey;
  snapshot.selection.basicAttackLevel = 1;
  syncSimulationSkillSources(snapshot);
  return { snapshot, configuration, rule, action, binding, process, effect };
}

describe('真实首次强化过程的不可变场景负载', () => {
  it('新发动配额与零强度减速标记均来自真实负载，不扩普通命中场景输入', () => {
    const { snapshot, configuration, process, effect } = sample();
    if (process.steps[0]!.stepType !== 'EMPOWERED_BASIC_ATTACK') throw new Error('fixture');
    process.steps[0]!.detail.consumeMoment = 'ATTACK_START';
    process.steps[0]!.detail.maximumAttackCountValue = fixedValue(3);
    process.cooldown!.startMoment = { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null };
    snapshot.catalogs.statuses.push({ gameId: snapshot.gameId, statusKey: 'marker', statusKind: 'MOVEMENT_SLOW', name: '减速标记', status: 'ENABLED',
      description: null, sortOrder: 0, createdAt: '', updatedAt: '' });
    configuration.effects.push({ ...structuredClone(effect), effectKey: 'marker', lifecycle: { durationValue: fixedValue(1500), maxStacksValue: fixedValue(1),
      applicationStacksValue: fixedValue(1), instanceScope: 'SOURCE_TARGET', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL',
      expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null },
      results: [{ resultKey: 'slow', name: '只保留标记', resultType: 'STATUS_OPERATION', target: 'TARGET', sortOrder: 0,
        detail: { statusKey: 'marker', operation: 'APPLY' }, valueRule: { value: fixedValue(0), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: 1 },
        lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null }, spellShieldBlockScope: 'RESULT' }] });
    process.effectBindings.push({ bindingKey: 'marker', effectKey: 'marker', moment: { momentType: 'STEP_EXECUTION', stepKey: 'attack', failureReason: null }, sortOrder: 1 });
    const scene = sceneInitialParameterRequirements(snapshot).map(row => sceneInitialParameterInput(row, 0));
    approveSnapshotFixture(snapshot, scene);
    const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot, [], scene).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
    const compiled = assembleSimulation(snapshot, attributes, { source: 250, target: 500 }, [], [], [], scene).compileRequest;
    const parent = compiled.sharedProviders.find(provider => provider.processes?.some(row => row.skillKey === configuration.skill.skillKey))!;
    expect(parent.processes![0]!.steps[0]).toMatchObject({ consumeMoment: 'ATTACK_START', maximumAttackCount: { op: 'const', value: 3 } });
    expect(parent.abilities!.flatMap(ability => ability.operations ?? []).find(operation => operation.operation === 'resolve_skill_hit')!.skillHit!.candidates)
      .toHaveLength(2);
    expect(compileFixtureWithNative(compiled).ok).toBe(true);
  });
  it('场景值只进入实际负载共同公式，费用与时间不获取该上下文', () => {
    const { snapshot, configuration } = sample();
    const declarations = sceneInitialParameterRequirements(snapshot);
    expect(declarations).toHaveLength(1);
    const inputs = declarations.map(row => sceneInitialParameterInput(row, 10));
    const preflight = skillFormulaPreflightRequest(snapshot, inputs), native = compileFixtureWithNative(preflight);
    expect(native.ok, JSON.stringify(native.errors)).toBe(true);
    rememberApprovedFormulaValues(preflight.formulas ?? [], native.metadata?.approvedStaticValues ?? {});
    approveSnapshotFixture(snapshot, inputs);
    const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot, [], inputs).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
    const prepared = assembleSimulation(snapshot, attributes, { source: 250, target: 500 }, [], [], [], inputs);
    const formula = prepared.compileRequest.formulas!.find(row => row.skillKey === configuration.skill.skillKey && row.parameters.some(row => row.parameterKey === 'prebattle_count'))!;
    expect(formula.parameters.find(row => row.parameterKey === 'prebattle_count')!.runtimeSource).toEqual({ kind: 'scene_parameter', value: 10 });
    expect(prepared.compileRequest.sharedProviders.find(row => row.processes?.some(row => row.skillKey === configuration.skill.skillKey))!.processes![0]!.steps[0]!.windowMs)
      .toEqual({ op: 'const', value: 6000 });
  });
  it.each(['cooldown', 'window', 'lifecycle', 'multiplier', 'condition', 'unconsumed', 'other_process', 'other_skill'] as const)(
    '拒绝上下文外消费或虚假声明 %s', kind => {
      const { configuration, rule, action, binding, process, effect } = sample();
      if (kind === 'cooldown') process.cooldown!.durationValue = parameterValue('prebattle_count');
      if (kind === 'window' && process.steps[0]!.stepType === 'EMPOWERED_BASIC_ATTACK') process.steps[0]!.detail.windowValue = parameterValue('prebattle_count');
      if (kind === 'lifecycle') effect.lifecycle = { durationValue: parameterValue('prebattle_count'), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
        instanceScope: 'TARGET', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'DURATION',
        periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null };
      if (kind === 'multiplier' && effect.results[0]!.resultType === 'DAMAGE') effect.results[0]!.detail.critical = { mode: 'GUARANTEED', multiplierValue: parameterValue('prebattle_count') };
      if (kind === 'condition') rule.conditionGroups[0]!.conditions = [{ conditionKey: 'threshold', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 0,
        detail: { subject: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'CURRENT', comparator: 'GTE', comparisonValue: parameterValue('prebattle_count') } }];
      if (kind === 'unconsumed') effect.results[0]!.valueRule!.value = fixedValue(100);
      if (kind === 'other_process' && action.actionType === 'START_PROCESS') action.detail.processKey = 'foreign';
      if (kind === 'other_skill' && rule.eventSource.eventType === 'SKILL_USED') rule.eventSource.detail.sourceSkillKey = 'foreign';
      expect(() => validateProcessSceneParameterBinding(configuration, rule, action, binding, 'test.binding')).toThrow();
    });
});

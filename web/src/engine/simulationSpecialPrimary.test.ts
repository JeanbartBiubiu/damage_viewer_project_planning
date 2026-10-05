import { describe, expect, it } from 'vitest';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';
import { fixedValue, formulaValue } from '../types/numericValue';
import type { SkillTriggerCondition } from '../types/skillTriggerRule';
import type { SkillEffectDamageResult } from '../types/skillEffect';
import type { SimulationMechanicStateInput, SimulationSnapshot } from '../types/simulationSnapshot';
import { assembleSimulation, inspectSimulationSnapshot, prepareSimulation, singleAttackRequest } from './simulationAdapter';
import { continuousAttackRequest } from './continuousAttackRequest';

export function specialPrimarySample(ammo = true) {
  const snapshot = simulationSample();
  const configuration = snapshot.skillConfigurations[0]!;
  const skillKey = configuration.skill.skillKey;
  const hit = configuration.triggerRules[1]!;
  const branch = structuredClone(hit);
  branch.ruleKey = 'special_hit'; branch.sortOrder = 2;
  branch.actions[0]!.detail = { effectKey: 'special_hit' };
  const effect = structuredClone(configuration.effects[1]!);
  effect.effectKey = 'special_hit'; effect.sortOrder = 2;
  (effect.results[0] as SkillEffectDamageResult).detail.critical.mode = 'FORCED';
  configuration.triggerRules.push(branch); configuration.effects.push(effect);
  snapshot.source.skillSources[0]!.enabledRuleKeys.push(branch.ruleKey);
  for (const rule of [hit, branch]) rule.eventSource = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } };
  const condition = (special: boolean): SkillTriggerCondition => ammo ? { conditionKey: 'inventory', sortOrder: 0, conditionType: 'INTERNAL_STATE_CHECK',
    detail: { stateSkillKey: skillKey, stateKey: 'rounds', valueKind: 'ATTACK_START_VALUE', comparator: special ? 'EQ' : 'GT',
      comparisonValue: fixedValue(1), optionKey: null, expectedBoolean: null } } : {
    conditionKey: 'frost', conditionType: 'STATUS_CHECK', sortOrder: 0, detail: { subject: 'CURRENT_TARGET', statusKey: 'frost',
      checkKind: special ? 'PRESENT' : 'ABSENT', effectSkillKey: null, sourceEffectKey: null, sourceResultKey: null, comparator: null, comparisonValue: null }
  };
  hit.conditionGroups = [{ groupKey: 'ordinary', name: '普通分支', sortOrder: 0, conditions: [condition(false)] }];
  branch.conditionGroups = [{ groupKey: 'special', name: '特殊分支', sortOrder: 0, conditions: [condition(true)] }];
  if (ammo) {
    configuration.internalStates.push({ gameId: snapshot.gameId, skillKey, stateKey: 'rounds', name: '弹药', stateType: 'AMMO', scope: 'SKILL',
      description: null, sortOrder: 0, createdAt: '', updatedAt: '', detail: { initialValue: fixedValue(4), maxValue: fixedValue(4),
        recoveryIntervalValue: fixedValue(2500), recoveryMode: 'ALL_AT_ONCE', recoveryStartCondition: 'WHEN_EMPTY' } });
    configuration.processes[0]!.stateOperations.push({ operationKey: 'consume', name: '开始消费', sortOrder: -1,
      stateSkillKey: skillKey, stateKey: 'rounds', moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null },
      operation: 'CONSUME', value: fixedValue(1), optionKey: null });
    effect.results.splice(1, 0, { ...structuredClone(effect.results[0] as SkillEffectDamageResult), resultKey: 'missing_health', sortOrder: 15,
      valueRule: { value: formulaValue('missing'), fixedMultiplier: .2, fixedMinValue: null, fixedMaxValue: null },
      detail: { ...(effect.results[0] as SkillEffectDamageResult).detail, critical: { mode: 'DISALLOWED', multiplierValue: null } } });
    configuration.formulas.push({ ...configuration.formulas[0]!, formulaKey: 'missing', expression: {
      nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'MISSING' } });
  } else snapshot.catalogs.statuses.push({ gameId: snapshot.gameId, statusKey: 'frost', name: '减速状态', statusKind: 'MOVEMENT_SLOW',
    status: 'ENABLED', description: null, sortOrder: 0, createdAt: '', updatedAt: '' });
  return snapshot;
}

function inputs(snapshot: SimulationSnapshot) {
  const values = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const requirement of inspectSimulationSnapshot(snapshot).requirements) if (requirement.storedValue === undefined) {
    values[requirement.side][requirement.attribute.attributeKey] = 0;
  }
  return values;
}
const health = { source: 650, target: 590 };
const mechanicInput = (snapshot: SimulationSnapshot, value: number): SimulationMechanicStateInput => ({ side: 'source',
  origin: { kind: 'CHARACTER', characterKey: snapshot.selection.sourceCharacterKey }, skillKey: snapshot.selection.basicAttackSkillKey, stateKey: 'rounds', value });

describe('5C配置驱动特殊普攻与弹药', () => {
  it('主体只有一次真实命中，完整条件进入互斥候选，第四发附伤单独禁止暴击', async () => {
    const snapshot = specialPrimarySample();
    const prepared = assembleSimulation(snapshot, inputs(snapshot), health);
    const provider = prepared.compileRequest.sharedProviders![0]!;
    const candidates = provider.abilities![2]!.operations![0]!.skillHit!.candidates;
    expect(provider.abilities).toHaveLength(3); expect(provider.listeners).toHaveLength(1);
    expect(candidates).toHaveLength(5);
    expect(candidates.every(row => JSON.stringify(row.participationCondition).includes('use.ammo.before'))).toBe(true);
    expect(candidates.find(row => row.resultKey === 'missing_health')!.operations[0]!.critEligible).toBe(false);
    expect(candidates.filter(row => row.resultKey === 'damage').map(row => row.operations[0]!.critChance)).toEqual([
      { op: 'read', path: 'source.attr.critical_strike_chance.resolved' }, { op: 'const', value: 1 }
    ]);
    expect(provider.initialStateSchema!.rounds).toEqual({ valueType: 'integer', defaultValue: 4, maxValue: 4, stateKind: 'ammo',
      ammoRecovery: { intervalMs: { op: 'const', value: 2500 }, mode: 'all_at_once', startCondition: 'when_empty' } });
    expect(provider.processes![0]!.momentOperations.flatMap(row => row.operations).filter(row => row.operation === 'state_change')).toEqual([
      { operation: 'state_change', target: 'self', ref: 'rounds', valuePolicy: 'add', amount: { op: 'const', value: -1 }, types: ['state_scope/provider'] }
    ]);
    const run = await continuousAttackRequest(prepared, snapshot, { durationMs: 10000, attackSpeedInputMax: 2 });
    expect(run.runRequest.recordBudget!.maxMechanicRecords).toBe(2000);
    expect(run.runRequest.driverPlan.entries).toEqual([]);
    expect(() => singleAttackRequest(prepared.compileRequest, 'session')).toThrow(/开始值冻结/);
  });
  it.each([0, 1, 4])('初态%d是明确合法供值，冻结身份和摘要均保留', async value => {
    const snapshot = specialPrimarySample();
    const prepared = await prepareSimulation(snapshot, inputs(snapshot), health, [], [mechanicInput(snapshot, value)]);
    expect(prepared.mechanicStateInputs[0]!.value).toBe(value);
    expect(prepared.compileRequest.sharedProviders![0]!.initialStateSchema!.rounds).toMatchObject({ defaultValue: value });
    expect(prepared.compileRequest.combatants[0]!.providers[0]!.initialState).toBeUndefined();
    const run = await continuousAttackRequest(prepared, snapshot, { durationMs: 5000, attackSpeedInputMax: 2 });
    expect(run.runRequest.initialSnapshot.combatants[0]!.providers[0]!.state).toEqual({});
    expect(run.runRequest.runtimeOptions!.mechanicStateInputs).toEqual(prepared.mechanicStateInputs);
  });
  it('未覆盖使用声明初值，合法零声明不补满；摘要区分未覆盖与显式同值', async () => {
    const snapshot = specialPrimarySample();
    const omitted = await prepareSimulation(snapshot, inputs(snapshot), health);
    const explicit = await prepareSimulation(snapshot, inputs(snapshot), health, [], [mechanicInput(snapshot, 4)]);
    expect(omitted.mechanicStateInputs).toEqual([]); expect(omitted.compileRequest.rulesHash).not.toBe(explicit.compileRequest.rulesHash);
    const declaration = snapshot.skillConfigurations[0]!.internalStates[0]!;
    if (declaration.stateType !== 'AMMO') throw new Error('需要弹药声明');
    declaration.detail.initialValue = fixedValue(0);
    expect(inspectSimulationSnapshot(snapshot).mechanicRequirements[0]!.initialValue).toBe(0);
  });
  it('状态存在／不存在按真实目录编译，两种主体命中事件不重复生成规则', () => {
    for (const event of ['SKILL_HIT', 'BASIC_ATTACK_HIT'] as const) {
      const snapshot = specialPrimarySample(false);
      if (event === 'BASIC_ATTACK_HIT') for (const rule of snapshot.skillConfigurations[0]!.triggerRules.slice(1)) rule.eventSource = { eventType: event, detail: {} };
      const prepared = assembleSimulation(snapshot, inputs(snapshot), health);
      expect(prepared.compileRequest.typeCatalog.types).toContainEqual({ key: 'status/frost', domain: 'status' });
      const candidates = prepared.compileRequest.sharedProviders![0]!.abilities![2]!.operations![0]!.skillHit!.candidates;
      expect(candidates).toHaveLength(4);
      expect(candidates[0]!.participationCondition).toEqual({ op: 'eq', args: [{ op: 'read', path: 'target.status.frost.present' }, { op: 'const', value: 0 }] });
      expect(candidates[2]!.participationCondition).toEqual({ op: 'eq', args: [{ op: 'read', path: 'target.status.frost.present' }, { op: 'const', value: 1 }] });
    }
  });
  it('完整条件组的组间或与组内且均保留，重叠分支拒绝', () => {
    const snapshot = specialPrimarySample(false);
    const conditions = snapshot.skillConfigurations[0]!.triggerRules[1]!.conditionGroups[0]!.conditions;
    conditions.push({ conditionKey: 'health', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 1,
      detail: { subject: 'CURRENT_TARGET', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO', comparator: 'GT', comparisonValue: fixedValue(0) } });
    const groups = snapshot.skillConfigurations[0]!.triggerRules[1]!.conditionGroups;
    groups.push({ ...structuredClone(groups[0]!), groupKey: 'alternate', sortOrder: 1 });
    const compiled = JSON.stringify(assembleSimulation(snapshot, inputs(snapshot), health).compileRequest.sharedProviders![0]!.abilities);
    expect(compiled).toContain('"op":"min"'); expect(compiled).toContain('"op":"max"');
    snapshot.skillConfigurations[0]!.triggerRules[2]!.conditionGroups = structuredClone(snapshot.skillConfigurations[0]!.triggerRules[1]!.conditionGroups);
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/互斥/);
  });
  it('容量、声明初值和恢复数值均按保存参数与本次等级取值，没有四弹或2500默认算法', () => {
    const snapshot = specialPrimarySample();
    const configuration = snapshot.skillConfigurations[0]!;
    configuration.skill.maxLevel = 2; snapshot.selection.basicAttackLevel = snapshot.source.skillSources[0]!.skillLevel = 2;
    configuration.parameters.push({ ...configuration.parameters[0]!, parameterKey: 'saved_capacity', valueType: 'INTEGER', fixedValue: null,
      valueMode: 'SKILL_LEVEL', levelValues: { '1': 4, '2': 3 } }, { ...configuration.parameters[0]!, parameterKey: 'saved_interval', fixedValue: 1234 });
    const state = configuration.internalStates[0]!;
    if (state.stateType !== 'AMMO') throw new Error('需要弹药声明');
    state.detail.maxValue = { kind: 'PARAMETER', parameterKey: 'saved_capacity' }; state.detail.initialValue = fixedValue(1);
    state.detail.recoveryIntervalValue = { kind: 'PARAMETER', parameterKey: 'saved_interval' };
    const prepared = assembleSimulation(snapshot, inputs(snapshot), health);
    expect(prepared.compileRequest.sharedProviders![0]!.initialStateSchema!.rounds).toMatchObject({ defaultValue: 1, maxValue: 3,
      ammoRecovery: { intervalMs: { op: 'const', value: 1234 } } });
  });
  it.each([-1, .5, 5, NaN, Infinity])('非法初态%s整体拒绝', value => {
    const snapshot = specialPrimarySample();
    expect(() => assembleSimulation(snapshot, inputs(snapshot), health, [], [mechanicInput(snapshot, value)])).toThrow(/初值/);
  });
  it('禁止重复输入、跨来源、缺声明、非弹药开始值和未支持恢复／消费', () => {
    const snapshot = specialPrimarySample();
    const input = mechanicInput(snapshot, 1);
    for (const overrides of [[input, input], [{ ...input, side: 'target' as const }], [{ ...input, skillKey: 'different' }]]) {
      expect(() => assembleSimulation(snapshot, inputs(snapshot), health, [], overrides)).toThrow(/来源|重复/);
    }
    for (const mutate of [
      (scene: SimulationSnapshot) => { scene.skillConfigurations[0]!.processes[0]!.stateOperations[0]!.value = fixedValue(2); },
      (scene: SimulationSnapshot) => { scene.skillConfigurations[0]!.processes[0]!.stateOperations.push(structuredClone(scene.skillConfigurations[0]!.processes[0]!.stateOperations[0]!)); },
      (scene: SimulationSnapshot) => { const state = scene.skillConfigurations[0]!.internalStates[0]!; if (state.stateType === 'AMMO') state.detail.recoveryMode = 'ONE_BY_ONE'; },
      (scene: SimulationSnapshot) => { const detail = scene.skillConfigurations[0]!.triggerRules[1]!.conditionGroups[0]!.conditions[0]!.detail; if ('stateSkillKey' in detail) detail.stateSkillKey = 'other'; }
    ]) {
      const invalid = specialPrimarySample(); mutate(invalid); expect(() => inspectSimulationSnapshot(invalid)).toThrow();
    }
  });
  it('仅依赖作者配置：重命名英雄、技能和状态后形状不变', () => {
    const original = specialPrimarySample();
    const rename = (value: unknown): unknown => {
      if (typeof value === 'string') return value.replaceAll('sample_basic_attack', 'unrelated_primary').replaceAll('rounds', 'inventory').replaceAll('actor_a', 'unrelated_owner');
      if (Array.isArray(value)) return value.map(rename);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rename(child)]));
      return value;
    };
    const renamed = rename(original) as SimulationSnapshot;
    const old = assembleSimulation(original, inputs(original), health);
    const next = assembleSimulation(renamed, inputs(renamed), health);
    expect(JSON.stringify(next.compileRequest)).toBe(JSON.stringify(old.compileRequest).replaceAll('sample_basic_attack', 'unrelated_primary').replaceAll('rounds', 'inventory'));
  });
});

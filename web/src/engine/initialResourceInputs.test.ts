import { describe, expect, it } from 'vitest';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { preparedActiveSample, simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import type { SimulationInitialResourceInput } from '../types/simulationSnapshot';
import { inspectSimulationSnapshot, assembleSimulation, prepareSimulation } from './simulationAdapter';
import { simulationCastCostCandidates } from './simulationActiveSkills';
import { fixedValue, parameterValue } from '../types/numericValue';
import type { SimulationSnapshot } from '../types/simulationSnapshot';

function sample() {
  const definition = loadMechanismCases().find(row => row.caseKey === 'kill_restore_lethal')!;
  const snapshot = definition.buildSnapshot(); approveSnapshotFixture(snapshot);
  const inputs = definition.scenario.initialResourceInputs!;
  const assemble = (resourceInputs: readonly SimulationInitialResourceInput[] = inputs) => assembleSimulation(snapshot, { source: {}, target: {} },
    definition.scenario.initialHealth, [], [], [], [], resourceInputs);
  return { snapshot, definition, inputs, assemble };
}

describe('只为本场可达普通恢复明确提供当前资源', () => {
  it('真实主动定义装配在active集合时仍可预检；无普通资源恢复不额外索取current', () => {
    for (const heal of [false, true]) {
      const { snapshot, prepared } = preparedActiveSample(heal);
      expect(inspectSimulationSnapshot(snapshot).resourceRequirements).toEqual([]);
      expect(prepared.initialResourceInputs).toEqual([]);
      expect(prepared.compileRequest.combatants.every(actor => Object.keys(actor.resources).length === 0)).toBe(true);
    }
  });
  it('inspect只报告容量与需求，不造假current；明确1进入实际资源槽', () => {
    const f = sample();
    expect(inspectSimulationSnapshot(f.snapshot).resourceRequirements).toEqual([{ side: 'source', resourceKey: 'mana', resourceName: '法力', maxValue: 50 }]);
    expect(() => f.assemble([])).toThrow(/明确填写.*0也需要填写/);
    const prepared = f.assemble();
    expect(prepared.initialResourceInputs).toEqual([{ side: 'source', resourceKey: 'mana', current: 1 }]);
    expect(prepared.compileRequest.combatants.find(row => row.key === 'source')!.resources).toEqual({ mana: { current: 1, max: 50 } });
    expect(prepared.compileRequest.combatants.find(row => row.key === 'target')!.resources).toEqual({});
  });
  it('0合法且必须显式，规范初值参与真实rulesHash而不是属性容量', async () => {
    const f = sample();
    const zero = await prepareSimulation(f.snapshot, { source: {}, target: {} }, f.definition.scenario.initialHealth, [], [], [], [], [{ side: 'source', resourceKey: 'mana', current: 0 }]);
    const one = await prepareSimulation(f.snapshot, { source: {}, target: {} }, f.definition.scenario.initialHealth, [], [], [], [], f.inputs);
    expect(zero.compileRequest.rulesHash).not.toBe(one.compileRequest.rulesHash);
    expect(zero.compileRequest.combatants[0]!.attributes.mana!.base).toBe(50);
    expect(zero.compileRequest.combatants[0]!.resources.mana).toEqual({ current: 0, max: 50 });
  });
  it.each([-1, 51, Infinity, NaN, null, undefined])('拒绝非法或缺失current=%s', current => {
    const f = sample(); expect(() => f.assemble([{ side: 'source', resourceKey: 'mana', current } as never])).toThrow(/初始当前资源/);
  });
  it('拒绝多余、重复或夹带max的输入', () => {
    const f = sample();
    for (const inputs of [[...f.inputs, ...f.inputs], [{ side: 'target', resourceKey: 'mana', current: 1 }], [{ ...f.inputs[0]!, max: 50 }]]) {
      expect(() => f.assemble(inputs as SimulationInitialResourceInput[])).toThrow(/重复|不是本场需求|形状/);
    }
  });
  it('容量必须有限正数，0不能借原生无上限语义通过', () => {
    for (const max of [0, -1, Infinity]) {
      const f = sample(); f.snapshot.source.selectedLevelValues.mana = max;
      expect(() => inspectSimulationSnapshot(f.snapshot)).toThrow(/容量.*严格大于0/);
      expect(() => f.assemble()).toThrow(/容量.*严格大于0/);
    }
  });
  it('容量缺录时保持未知，补明确属性容量后仍需填写当前值', () => {
    const f = sample(); delete f.snapshot.source.selectedLevelValues.mana;
    const inspection = inspectSimulationSnapshot(f.snapshot);
    expect(inspection.resourceRequirements[0]!.maxValue).toBeUndefined();
    expect(inspection.requirements.find(row => row.side === 'source' && row.attribute.attributeKey === 'mana')!.storedValue).toBeUndefined();
    expect(() => f.assemble()).toThrow(/容量尚未补全/);
    expect(assembleSimulation(f.snapshot, { source: { mana: 50 }, target: {} }, f.definition.scenario.initialHealth, [], [], [], [], f.inputs)
      .compileRequest.combatants[0]!.resources.mana).toEqual({ current: 1, max: 50 });
  });
  it('关闭真实恢复来源后不要求或挂载资源，旧无需求场景不受影响', () => {
    const f = sample();
    const source = f.snapshot.source.skillSources.find(row => row.skillKey === 'lab_kill_restore')!;
    Object.assign(source, { enabled: false, inactiveReason: 'SCENE_DISABLED', enabledRuleKeys: [] });
    f.snapshot.selection.sourceSkillSettings.find(row => row.skillKey === source.skillKey)!.enabled = false;
    expect(inspectSimulationSnapshot(f.snapshot).resourceRequirements).toEqual([]);
    expect(f.assemble([]).compileRequest.combatants[0]!.resources).toEqual({});
    expect(() => f.assemble()).toThrow(/不是本场需求/);
  });
});

describe('真实计划过程成本与退款的初始资源', () => {
  const initialHealth = { source: 250, target: 500 };
  function explicitAttributes(snapshot: SimulationSnapshot) {
    const values = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) {
      if (row.storedValue === undefined) values[row.side][row.attribute.attributeKey] = 0;
    }
    return values;
  }

  function activeCost(refund = false): SimulationSnapshot {
    const snapshot = simulationActiveSample();
    snapshot.catalogs.calculationRules.configuration!.ignorableCastCostAttributeKeys = ['mana'];
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'mana', name: '法力' });
    snapshot.source.selectedLevelValues.mana = 200;
    const config = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
    const effect = { ...structuredClone(config.effects[0]!), effectKey: 'cost', lifecycle: null, results: [{
      resultKey: 'pay', name: '真实费用', resultType: 'RESOURCE_CHANGE' as const, target: 'SOURCE' as const,
      description: null, sortOrder: 0, lifecycleBehavior: null, spellShieldBlockScope: null,
      valueRule: { value: fixedValue(80), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
      detail: { operation: 'CONSUME' as const, attributeKey: 'mana' }
    }] };
    config.effects.push(effect);
    config.processes[0]!.effectBindings.push({ bindingKey: 'pay', effectKey: 'cost', sortOrder: 0,
      moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } });
    if (refund) {
      config.parameters.push({ gameId: snapshot.gameId, skillKey: 'sample_active', parameterKey: 'paid', name: '实付', description: null,
        sortOrder: 0, valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null, createdAt: '', updatedAt: '' });
      config.effects.push({ ...effect, effectKey: 'refund', results: [{ ...effect.results[0]!, resultKey: 'refund',
        valueRule: { value: parameterValue('paid'), fixedMultiplier: .5, fixedMinValue: 0, fixedMaxValue: null }, detail: { operation: 'REFUND', attributeKey: 'mana' } }] });
      config.triggerRules.push({ ruleKey: 'refund', name: '结束退款', description: null, sortOrder: 30,
        eventSource: { eventType: 'PROCESS_MOMENT', detail: { processKey: 'cast', moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } } },
        conditionGroups: [], actions: [{ actionKey: 'refund', name: '实付一半退款', actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'refund' },
          targetContext: 'CURRENT_TARGET', sortOrder: 10, runtimeInputBindings: [{ bindingKey: 'paid', parameterKey: 'paid', sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: { attributeKey: 'mana' } }], resultModifiers: [] }],
        perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null });
    }
    approveSnapshotFixture(snapshot);
    return snapshot;
  }

  it('实际已挂载主动费用收集需求，缺当前值拒绝，0与费用不足值保持显式', () => {
    const snapshot = activeCost();
    expect(inspectSimulationSnapshot(snapshot).resourceRequirements).toEqual([{ side: 'source', resourceKey: 'mana', resourceName: '法力', maxValue: 200 }]);
    const assemble = (current?: number) => assembleSimulation(snapshot, explicitAttributes(snapshot), initialHealth, [], [], [], [],
      current === undefined ? [] : [{ side: 'source', resourceKey: 'mana', current }]);
    expect(() => assemble()).toThrow(/明确填写/);
    for (const current of [0, 79, 200]) {
      const prepared = assemble(current);
      expect(prepared.compileRequest.combatants[0]!.resources.mana).toEqual({ current, max: 200 });
      const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
      const process = prepared.compileRequest.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!.processes![0]!;
      expect(process.costs).toEqual([{ resourceKey: 'mana', amount: { op: 'const', value: 80 } }]);
      expect(process.momentOperations.flatMap(row => row.operations).some(row => row.operation === 'resource_change')).toBe(false);
    }
  });

  it('真实退款与成本共用一个资源需求，保留实付读取而非补0', () => {
    const snapshot = activeCost(true), requirement = inspectSimulationSnapshot(snapshot).resourceRequirements;
    expect(requirement).toHaveLength(1);
    const prepared = assembleSimulation(snapshot, explicitAttributes(snapshot), initialHealth, [], [], [], [], [{ side: 'source', resourceKey: 'mana', current: 200 }]);
    expect(prepared.compileRequest.combatants[0]!.resources.mana).toEqual({ current: 200, max: 200 });
    expect(JSON.stringify(prepared.compileRequest.sharedProviders)).toContain('process.actual_cost.mana');
  });

  it('精确忽略费用不要求当前资源，忽略后仍配置实付退款的输入必须拒绝', () => {
    const snapshot = activeCost(), ignored = simulationCastCostCandidates(snapshot);
    expect(inspectSimulationSnapshot(snapshot, ignored).resourceRequirements).toEqual([]);
    expect(assembleSimulation(snapshot, explicitAttributes(snapshot), initialHealth, [], [], ignored).compileRequest.combatants[0]!.resources).toEqual({});
    expect(() => assembleSimulation(snapshot, explicitAttributes(snapshot), initialHealth, [], [], ignored, [], [{ side: 'source', resourceKey: 'mana', current: 200 }])).toThrow(/不是本场需求/);
    const refundable = activeCost(true);
    expect(() => inspectSimulationSnapshot(refundable, simulationCastCostCandidates(refundable))).toThrow(/不能补 0/);
  });
});

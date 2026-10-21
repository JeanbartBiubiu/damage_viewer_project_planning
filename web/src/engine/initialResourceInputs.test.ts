import { describe, expect, it } from 'vitest';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { preparedActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import type { SimulationInitialResourceInput } from '../types/simulationSnapshot';
import { inspectSimulationSnapshot, assembleSimulation, prepareSimulation } from './simulationAdapter';

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

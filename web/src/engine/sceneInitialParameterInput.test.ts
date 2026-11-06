import { describe, expect, it } from 'vitest';
import { simulationSceneInitialParameter } from '../../tests/fixtures/simulationSceneInitialParameter';
import { normalizeSceneInitialParameterInputs, sceneInitialParameterRequirements, SceneInitialParameterRequired } from './sceneInitialParameterInput';
import { snapshotFormulaProofIdentity, skillFormulaPreflightRequest } from './skillFormulaPreflight';
import { inspectSimulationSnapshot, assembleSimulation } from './simulationAdapter';
import { rememberApprovedFormulaValues } from './approvedFormulaValues';
import { compileFixtureWithNative } from '../../tests/fixtures/nativeFormulaProof';

describe('显式战前参数按来源冻结', () => {
  it.each([['initial_alpha', 'before_count'], ['initial_beta', 'another_count']])('异名%s保留双方自然初始化及主动兄弟', (skill, parameter) => {
    const { snapshot, inputs } = simulationSceneInitialParameter(skill, parameter);
    const before = structuredClone(snapshot);
    const declarations = sceneInitialParameterRequirements(snapshot);
    expect(declarations).toHaveLength(2);
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(SceneInitialParameterRequired);
    const values = inputs(0, 150);
    const preflight = skillFormulaPreflightRequest(snapshot, values);
    const result = compileFixtureWithNative(preflight);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    rememberApprovedFormulaValues(preflight.formulas ?? [], result.metadata?.approvedStaticValues ?? {});
    const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot, [], values).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
    const prepared = assembleSimulation(snapshot, attributes, { source: 250, target: 500 }, [], [], [], values);
    expect(prepared.sceneParameterInputs).toEqual(values);
    expect(prepared.sceneParameterInputs.map(row => ({ side: row.side, origin: row.origin,
      skillKey: 'skillKey' in row ? row.skillKey : null, parameterKey: 'parameterKey' in row ? row.parameterKey : null, value: row.value })))
      .toEqual([
        { side: 'source', origin: { kind: 'CHARACTER', characterKey: snapshot.source.character.characterKey }, skillKey: skill, parameterKey: parameter, value: 0 },
        { side: 'target', origin: { kind: 'CHARACTER', characterKey: snapshot.target.character.characterKey }, skillKey: skill, parameterKey: parameter, value: 150 }
      ]);
    const request = prepared.compileRequest;
    expect(compileFixtureWithNative(request).ok).toBe(true);
    const sources = request.sharedProviders.filter(row => row.skillKey === skill);
    expect(sources.some(row => row.processes?.length)).toBe(true);
    expect(sources.filter(row => row.modifiers?.[0]?.kind === 'attribute').map(row => row.modifiers![0]!.value)).toEqual(
      expect.arrayContaining([{ op: 'const', value: 0 }, { op: 'const', value: 30 }]));
    expect(snapshot).toEqual(before);
  });
  it.each([NaN, Infinity, -1, 150.1, 151, 9007199254740992])('拒绝非法输入%s', value => {
    const { snapshot, inputs } = simulationSceneInitialParameter();
    expect(() => normalizeSceneInitialParameterInputs(snapshot, inputs(value, 0))).toThrow();
  });
  it('缺失、重复、错侧、额外来源及声明变化不能借旧草稿', () => {
    const { snapshot, configuration, inputs } = simulationSceneInitialParameter();
    const values = inputs(0, 150);
    expect(() => normalizeSceneInitialParameterInputs(snapshot, [])).toThrow(SceneInitialParameterRequired);
    expect(() => normalizeSceneInitialParameterInputs(snapshot, [...values, values[0]!])).toThrow(/重复/);
    expect(() => normalizeSceneInitialParameterInputs(snapshot, [{ ...values[0]!, side: values[0]!.side === 'source' ? 'target' : 'source' }, values[1]!])).toThrow(/归属/);
    configuration.baseDigest = 'changed';
    expect(() => normalizeSceneInitialParameterInputs(snapshot, values)).toThrow(/身份/);
  });
  it('不同初值参与预检身份与共同公式值，输入顺序无关', () => {
    const { snapshot, inputs } = simulationSceneInitialParameter();
    expect(snapshotFormulaProofIdentity(snapshot, inputs(0, 1))).not.toBe(snapshotFormulaProofIdentity(snapshot, inputs(1, 1)));
    expect(snapshotFormulaProofIdentity(snapshot, inputs(0, 1))).toBe(snapshotFormulaProofIdentity(snapshot, inputs(0, 1).reverse()));
    expect(skillFormulaPreflightRequest(snapshot, inputs(0, 1)).formulas!.some(row => row.parameters.some(p =>
      p.runtimeSource?.kind === 'scene_parameter' && p.runtimeSource.value === 0))).toBe(true);
  });
  it('生命周期消费不能借用结果初值授权', () => {
    const { snapshot, configuration } = simulationSceneInitialParameter();
    configuration.effects.find(row => row.effectKey === 'permanent_resist')!.lifecycle!.maxStacksValue = { kind: 'PARAMETER', parameterKey: 'prebattle_count' };
    expect(() => sceneInitialParameterRequirements(snapshot)).toThrow(/生命周期/);
  });
});

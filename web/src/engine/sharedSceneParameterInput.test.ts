import { describe, expect, it } from 'vitest';
import { simulationSceneInitialParameter } from '../../tests/fixtures/simulationSceneInitialParameter';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { sceneInitialParameterInput, sceneInitialParameterRequirements, normalizeSceneInitialParameterInputs,
  sceneInitialValuesForSource } from './sceneInitialParameterInput';

function sample() {
  const { snapshot, configuration } = simulationSceneInitialParameter();
  const second = JSON.parse(JSON.stringify(configuration).replaceAll('initial_alpha', 'initial_beta').replaceAll('prebattle_count', 'other_count')) as typeof configuration;
  for (const config of [configuration, second]) for (const rule of config.triggerRules) for (const action of rule.actions) {
    for (const binding of action.runtimeInputBindings) if (binding.sourceType === 'SCENE_INITIAL_PARAMETER') binding.detail.sharedInputKey = 'shared_count';
  }
  snapshot.skillConfigurations.push(second);
  for (const side of ['source', 'target'] as const) {
    snapshot[side].attachedSkills.push({ ...snapshot[side].attachedSkills.find(row => row.skillKey === 'initial_alpha')!, skillKey: 'initial_beta' });
    snapshot.selection[`${side}SkillSettings`].push({ ...snapshot.selection[`${side}SkillSettings`].find(row => row.skillKey === 'initial_alpha')!, skillKey: 'initial_beta' });
  }
  syncSimulationSkillSources(snapshot);
  return { snapshot, configuration, second };
}

describe('同角色侧共享战前初值', () => {
  it('同组只存一个显式值，0逐成员分发，双方隔离且不添加旧字段', () => {
    const { snapshot } = sample();
    const requirements = sceneInitialParameterRequirements(snapshot);
    expect(requirements).toHaveLength(2);
    expect(requirements.every(row => row.members?.length === 2)).toBe(true);
    const inputs = requirements.map(row => sceneInitialParameterInput(row, row.side === 'source' ? 0 : 10));
    expect(Object.keys(inputs[0]!).sort()).toEqual(['declarationIdentity', 'origin', 'sharedInputKey', 'side', 'value']);
    expect(normalizeSceneInitialParameterInputs(snapshot, inputs.reverse())).toEqual([...inputs].reverse());
    for (const side of ['source', 'target'] as const) for (const source of snapshot[side].skillSources.filter(row => row.skillKey.startsWith('initial_'))) {
      const values = sceneInitialValuesForSource(requirements, inputs, side, source);
      expect(values).toEqual({ [source.skillKey === 'initial_alpha' ? 'prebattle_count' : 'other_count']: side === 'source' ? 0 : 10 });
    }
  });
  it('成员配置及等级、来源关闭会改变组身份，但不挂载关闭成员', () => {
    const { snapshot, second } = sample();
    const before = sceneInitialParameterRequirements(snapshot);
    const inputs = before.map(row => sceneInitialParameterInput(row, 0));
    second.baseDigest = 'changed_member';
    expect(() => normalizeSceneInitialParameterInputs(snapshot, inputs)).toThrow(/身份/);
    const setting = snapshot.selection.sourceSkillSettings.find(row => row.skillKey === second.skill.skillKey)!;
    setting.enabled = false;
    syncSimulationSkillSources(snapshot);
    const after = sceneInitialParameterRequirements(snapshot);
    expect(after.find(row => row.side === 'source')!.members!.map(row => row.skillKey)).toEqual(['initial_alpha']);
    expect(after.find(row => row.side === 'target')!.members).toHaveLength(2);
  });
  it('配置/来源顺序不改变共享身份，缺失与重复仍失败', () => {
    const { snapshot } = sample();
    const identity = sceneInitialParameterRequirements(snapshot).map(row => row.declarationIdentity);
    snapshot.skillConfigurations.reverse(); snapshot.source.skillSources.reverse(); snapshot.target.skillSources.reverse();
    expect(sceneInitialParameterRequirements(snapshot).map(row => row.declarationIdentity)).toEqual(identity);
    const inputs = sceneInitialParameterRequirements(snapshot).map(row => sceneInitialParameterInput(row, 0));
    expect(() => normalizeSceneInitialParameterInputs(snapshot, inputs.slice(1))).toThrow(/明确填写/);
    expect(() => normalizeSceneInitialParameterInputs(snapshot, [...inputs, inputs[0]!])).toThrow(/重复/);
  });
  it.each(['bounds', 'type', 'null', 'empty', 'extra'] as const)('冲突或不完整声明拒绝 %s', kind => {
    const { snapshot, second } = sample();
    const binding = second.triggerRules.flatMap(row => row.actions).flatMap(row => row.runtimeInputBindings)
      .find(row => row.sourceType === 'SCENE_INITIAL_PARAMETER')!;
    if (binding.sourceType !== 'SCENE_INITIAL_PARAMETER') throw new Error('fixture');
    if (kind === 'bounds') binding.detail.maxValue = 151;
    if (kind === 'type') second.parameters[0]!.valueType = 'DECIMAL';
    if (kind === 'null') Object.assign(binding.detail, { sharedInputKey: null });
    if (kind === 'empty') binding.detail.sharedInputKey = '';
    if (kind === 'extra') Object.assign(binding.detail, { foreign: 1 });
    expect(() => sceneInitialParameterRequirements(snapshot)).toThrow();
  });
  it('省略共享声明完整保留逐来源输入形状', () => {
    const { snapshot, inputs } = simulationSceneInitialParameter();
    const requirements = sceneInitialParameterRequirements(snapshot);
    expect(requirements.every(row => !Object.prototype.hasOwnProperty.call(row, 'sharedInputKey') && !Object.prototype.hasOwnProperty.call(row, 'members'))).toBe(true);
    expect(requirements.map(row => sceneInitialParameterInput(row, row.side === 'source' ? 0 : 1))).toEqual(inputs(0, 1));
  });
});

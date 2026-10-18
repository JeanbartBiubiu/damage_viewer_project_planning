import { describe, expect, it } from 'vitest';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { equipmentSimulationSample } from '../../tests/fixtures/simulationEquipment';
import type { SkillTriggerSceneAttributeSnapshotBinding } from '../types/skillTriggerRule';
import { createNumericCompileState } from './numericAdapter';
import { bindSceneAttributeParameters, sceneAttributeParameterInputs } from './sceneAttributeSnapshotInput';

function sample(attributeKey = 'authored_speed', parameterKey = 'authored_snapshot') {
  const snapshot = simulationActiveSample();
  const configuration = snapshot.skillConfigurations[1]!;
  configuration.parameters.push({ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, parameterKey,
    name: '明确的场景输入', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null, levelValues: null,
    description: null, sortOrder: 20, createdAt: '', updatedAt: '' });
  snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey, valueType: 'DECIMAL', name: '独立属性' });
  snapshot.source.selectedLevelValues[attributeKey] = .25;
  snapshot.target.selectedLevelValues[attributeKey] = .75;
  const equipment = structuredClone(equipmentSimulationSample(['item_1042']).source.selectedEquipment[0]!);
  equipment.attributes.attributeValues = { [attributeKey]: .5 };
  snapshot.source.selectedEquipment = [equipment];
  const rule = configuration.triggerRules[0]!;
  const action = rule.actions[0]!;
  const binding: SkillTriggerSceneAttributeSnapshotBinding = { bindingKey: 'authored_binding', parameterKey, sourceType: 'SCENE_ATTRIBUTE_SNAPSHOT',
    detail: { subject: 'SOURCE' as const, attributeKey, sources: ['CHARACTER_LEVEL', 'EQUIPMENT_DIRECT'] as Array<'CHARACTER_LEVEL' | 'EQUIPMENT_DIRECT'> } };
  action.runtimeInputBindings = [binding];
  return { snapshot, configuration, processKey: configuration.processes[0]!.processKey, binding, action, rule };
}

describe('按明确来源读取场景属性快照', () => {
  it.each([['authored_speed', 'authored_snapshot'], ['another_stat', 'another_input']])('异名%s只读等级与装备直接属性', (attribute, parameter) => {
    const { snapshot, configuration, processKey, binding } = sample(attribute, parameter);
    const before = structuredClone(snapshot);
    const inputs = sceneAttributeParameterInputs(snapshot, configuration, processKey);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ parameterKey: parameter, attributeKey: attribute, value: .75, subject: 'SOURCE' });
    expect(inputs[0]!.sourcePaths).toEqual([`source.selectedLevelValues.${attribute}`, `source.selectedEquipment[0].attributes.attributeValues.${attribute}`]);
    binding.detail.sources = ['CHARACTER_LEVEL'];
    expect(sceneAttributeParameterInputs(snapshot, configuration, processKey)[0]!.value).toBe(.25);
    binding.detail.sources = ['CHARACTER_LEVEL', 'EQUIPMENT_DIRECT'];
    expect(snapshot).toEqual(before);
  });

  it('只取装备时等级缺值不阻塞；空装备与稀疏属性明确为零，不把缺等级补零', () => {
    const { snapshot, configuration, processKey, binding } = sample();
    delete snapshot.source.selectedLevelValues.authored_speed;
    expect(() => sceneAttributeParameterInputs(snapshot, configuration, processKey)).toThrow('缺少真实有限值');
    binding.detail.sources = ['EQUIPMENT_DIRECT'];
    expect(sceneAttributeParameterInputs(snapshot, configuration, processKey)[0]!.value).toBe(.5);
    snapshot.source.selectedEquipment[0]!.attributes.attributeValues = {};
    expect(sceneAttributeParameterInputs(snapshot, configuration, processKey)[0]!.value).toBe(0);
    snapshot.source.selectedEquipment = [];
    expect(sceneAttributeParameterInputs(snapshot, configuration, processKey)[0]!.value).toBe(0);
  });

  it('固定目标方槽位不受自施目标影响，来源集合按明确顺序采集', () => {
    const { snapshot, configuration, processKey, binding } = sample();
    binding.detail.subject = 'TARGET';
    binding.detail.sources = ['EQUIPMENT_DIRECT', 'CHARACTER_LEVEL'];
    const input = sceneAttributeParameterInputs(snapshot, configuration, processKey)[0]!;
    expect(input.value).toBe(.75);
    expect(input.subject).toBe('TARGET');
    expect(input.sources).toEqual(['CHARACTER_LEVEL', 'EQUIPMENT_DIRECT']);
  });

  it('重复来源、缺目录、非首次及未声明参数均拒绝', () => {
    const { snapshot, configuration, processKey, binding, rule } = sample();
    binding.detail.sources = ['CHARACTER_LEVEL', 'CHARACTER_LEVEL'];
    expect(() => sceneAttributeParameterInputs(snapshot, configuration, processKey)).toThrow('来源集合无效');
    binding.detail.sources = ['CHARACTER_LEVEL'];
    snapshot.catalogs.attributes.find(row => row.attributeKey === 'authored_speed')!.status = 'DISABLED';
    expect(() => sceneAttributeParameterInputs(snapshot, configuration, processKey)).toThrow('属性目录');
    snapshot.catalogs.attributes.find(row => row.attributeKey === 'authored_speed')!.status = 'ENABLED';
    if (rule.eventSource.eventType === 'SKILL_USED') rule.eventSource.detail.castPhase = 'RECAST';
    expect(() => sceneAttributeParameterInputs(snapshot, configuration, processKey)).toThrow('首次主动过程');
    if (rule.eventSource.eventType === 'SKILL_USED') rule.eventSource.detail.castPhase = 'INITIAL';
    binding.parameterKey = 'unbound';
    expect(() => sceneAttributeParameterInputs(snapshot, configuration, processKey)).toThrow('已有的计算时数值参数');
  });

  it('整数按最终值检查，合法0与缺失不同；输入只绑定对应真实首次控制', () => {
    const { snapshot, configuration, processKey, binding } = sample();
    configuration.parameters.find(row => row.parameterKey === binding.parameterKey)!.valueType = 'INTEGER';
    expect(() => sceneAttributeParameterInputs(snapshot, configuration, processKey)).toThrow('整数参数约束');
    snapshot.source.selectedLevelValues.authored_speed = 0;
    snapshot.source.selectedEquipment = [];
    const inputs = sceneAttributeParameterInputs(snapshot, configuration, processKey);
    const state = createNumericCompileState({ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, skillLevel: 1,
      characterLevel: 1, formulaNamespace: 'scene-test', bindParameters: true, allowAttributeReads: true,
      runtimeInputMessage: '未供值', parameters: configuration.parameters });
    const authored = { gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, process: { processKey },
      rules: configuration.triggerRules, parameters: configuration.parameters, sceneAttributeInputs: inputs };
    bindSceneAttributeParameters(authored, state);
    expect(state.params.authored_snapshot).toBe(0);
    expect(state.runtimeInputReads!.authored_snapshot).toEqual({ op: 'read', path: 'ability.param.authored_snapshot' });
    const wrong = { ...authored, sceneAttributeInputs: [{ ...inputs[0]!, actionKey: 'forged' }] };
    expect(() => bindSceneAttributeParameters(wrong, { ...state, params: {}, runtimeInputReads: undefined })).toThrow('不属于当前首次绑定');
    expect(() => bindSceneAttributeParameters({ ...authored, sceneAttributeInputs: [...inputs, ...inputs] },
      { ...state, params: {}, runtimeInputReads: undefined })).toThrow('缺失、重复');
  });
});

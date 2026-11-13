import { describe, expect, it } from 'vitest';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { runMechanismCase } from '../../tests/mechanisms/mechanismRunner';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { inspectSimulationSnapshot } from './simulationAdapter';
import type { SimulationSnapshot } from '../types/simulationSnapshot';

const cases = loadMechanismCases();
const definition = cases.find(row => row.caseKey === 'spell_shield_initialized_result');
if (!definition) throw new Error('缺少独立初始化法盾固定用例');
function guard(snapshot: SimulationSnapshot, side: 'source' | 'target' = 'target') {
  const row = snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === `lab_${side}_guard`);
  if (!row) throw new Error('固定用例缺少真实法盾配置');
  return row;
}

describe('来源初始化法盾完整拒绝边界', () => {
  it('拒绝用假数值补齐无数值法盾', () => {
    const snapshot = definition.buildSnapshot();
    Object.assign(guard(snapshot).effects[0]!.results[0]!, { valueRule: { value: { kind: 'FIXED', value: 1 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null } });
    expect(() => inspectSimulationSnapshot(syncSimulationSkillSources(snapshot))).toThrow(/无数值/);
  });
  it('没有真实初始化时不按盾效果存在自动施盾', () => {
    const snapshot = definition.buildSnapshot();
    guard(snapshot).triggerRules = guard(snapshot).triggerRules.filter(rule => rule.eventSource.eventType !== 'SOURCE_INITIALIZED');
    expect(() => inspectSimulationSnapshot(syncSimulationSkillSources(snapshot))).toThrow(/完整程序|完整作者|默认自然|初始化/);
  });
  it('消费必须指向本次冻结的同效果盾', () => {
    const snapshot = definition.buildSnapshot();
    const result = guard(snapshot).effects[1]!.results[0]!;
    if (result.resultType !== 'LIFECYCLE_OPERATION') throw new Error('固定用例缺少明确移除');
    result.detail.targetEffectKey = 'different_shield';
    expect(() => inspectSimulationSnapshot(syncSimulationSkillSources(snapshot))).toThrow(/本盾|效果.*缺失|效果.*不存在/);
  });
  it('不把未接入的消费治疗副作用丢掉后成功', () => {
    const snapshot = definition.buildSnapshot();
    guard(snapshot).effects[1]!.results.push({ resultKey: 'unexpected_heal', name: '未接入副作用', description: null,
      resultType: 'DIRECT_HEAL', target: 'SOURCE', sortOrder: 1, lifecycleBehavior: null, spellShieldBlockScope: null, detail: {},
      valueRule: { value: { kind: 'FIXED', value: 25 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null } });
    expect(() => inspectSimulationSnapshot(syncSimulationSkillSources(snapshot))).toThrow(/副作用/);
  });
  it('不把多个消费监听当成一次安全消费', () => {
    const snapshot = definition.buildSnapshot();
    const rule = structuredClone(guard(snapshot).triggerRules[1]!);
    rule.ruleKey = 'second_consumption'; rule.sortOrder = 2;
    guard(snapshot).triggerRules.push(rule);
    expect(() => inspectSimulationSnapshot(syncSimulationSkillSources(snapshot))).toThrow(/多个独立消费/);
  });
  it('同一目标两个同时活动法盾保持原生拒绝，不选择一个消费', async () => {
    const snapshot = definition.buildSnapshot();
    const extra = structuredClone(guard(snapshot));
    extra.skill.skillKey = 'lab_extra_guard';
    for (const effect of extra.effects) effect.skillKey = extra.skill.skillKey;
    snapshot.skillConfigurations.push(extra);
    const relation = snapshot.target.attachedSkills[0];
    if (!relation) throw new Error('固定目标盾缺少挂载');
    snapshot.target.attachedSkills.push({ ...relation, skillKey: extra.skill.skillKey });
    snapshot.selection.targetSkillSettings.push({ origin: { kind: 'CHARACTER', characterKey: snapshot.target.character.characterKey },
      skillKey: extra.skill.skillKey, enabled: true, skillLevel: 1 });
    syncSimulationSkillSources(snapshot);
    await expect(runMechanismCase({ ...definition, buildSnapshot: () => snapshot })).rejects.toThrow(/multiple active spell_shield/);
  });
});

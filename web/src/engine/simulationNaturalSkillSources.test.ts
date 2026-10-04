import { describe, expect, it } from 'vitest';
import { simulationBuildSample, simulationSample } from '../../tests/fixtures/simulationSnapshot';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { permanentEquipmentSimulationSample } from '../../tests/fixtures/simulationPermanentEquipment';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { assembleSimulation, inspectSimulationSnapshot, prepareSimulation } from './simulationAdapter';
import { continuousAttackRequest } from './continuousAttackRequest';

function naturalSample(snapshot: SimulationSnapshot = simulationSample()) {
  const base = snapshot.skillConfigurations[0]!;
  const skillKey = 'sample_natural';
  const metadata = { createdAt: '', updatedAt: '' };
  const configuration: SkillConfiguration = {
    ...structuredClone(base), skill: { ...base.skill, skillKey, name: '独立初始化结构', maxLevel: 3, skillCategoryKeys: [] },
    parameters: [{ ...base.parameters[0]!, skillKey, parameterKey: 'bonus', valueMode: 'SKILL_LEVEL',
      fixedValue: null, levelValues: { '1': .05, '2': .1, '3': .15 } }], formulas: [], processes: [], internalStates: [],
    effects: [{ gameId: snapshot.gameId, skillKey, effectKey: 'passive', name: '常驻收益', description: null,
      sortOrder: 0, ...metadata, lifecycle: {
        durationValue: null, maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 },
        instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY',
        periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null
      }, results: [{ resultKey: 'bonus_speed', name: '额外攻速', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description: null,
        sortOrder: 0, detail: { attributeKey: 'bonus_attack_speed_percent', operation: 'INCREASE', modifierZoneKey: 'flat' },
        spellShieldBlockScope: null, valueRule: { value: { kind: 'PARAMETER', parameterKey: 'bonus' }, fixedMultiplier: 1,
          fixedMinValue: null, fixedMaxValue: null }, lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION',
          stackValueMode: 'SHARED', reapplicationValueMode: null, periodicExecutionMode: null } }] }],
    triggerRules: [{ ruleKey: 'initialize', name: '初始化', description: null, sortOrder: 0,
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, conditionGroups: [], oncePerUse: null,
      perTargetCooldown: null, maxTriggersPerProcess: null, actions: [{ actionKey: 'apply', name: '应用', sortOrder: 0,
        actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'passive' }, targetContext: 'EVENT_SOURCE',
        runtimeInputBindings: [], resultModifiers: [] }] }]
  };
  snapshot.skillConfigurations.push(configuration);
  snapshot.catalogs.modifierZones.push({ gameId: snapshot.gameId, modifierZoneKey: 'flat', name: '属性加算', domain: 'ATTRIBUTE',
    calculationMode: 'FLAT_ADD', applicationStage: 'ATTRIBUTE_FLAT', description: null, status: 'ENABLED', sortOrder: 0, ...metadata });
  for (const attributeKey of ['bonus_attack_speed_percent', 'attack_speed_ratio']) {
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey, name: attributeKey, minValue: 0, maxValue: null });
  }
  for (const side of ['source', 'target'] as const) {
    const actor = snapshot[side];
    actor.selectedLevelValues.bonus_attack_speed_percent = 0;
    actor.selectedLevelValues.attack_speed_ratio = .5;
    actor.attachedSkills.push({ gameId: snapshot.gameId, characterKey: actor.character.characterKey,
      characterName: actor.character.name, skillKey, skillName: configuration.skill.name, skillStatus: 'ENABLED', sortOrder: 1 });
    snapshot.selection[`${side}SkillSettings`].push({ origin: { kind: 'CHARACTER', characterKey: actor.character.characterKey },
      skillKey, enabled: true, skillLevel: side === 'source' ? 3 : 1 });
  }
  return syncSimulationSkillSources(snapshot);
}

function scene(snapshot: SimulationSnapshot) {
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(snapshot, inputs, { source: 650, target: 590 });
}

describe('5A完整默认来源', () => {
  it('无装备也启用自身攻速派生，双方等级、实例独立且只保留一个普攻主体', async () => {
    const snapshot = naturalSample();
    const prepared = scene(snapshot);
    expect(prepared.compileRequest.rules.attributeDerivations?.map(row => row.combatantKey)).toEqual(['source', 'target']);
    const modifiers = prepared.compileRequest.sharedProviders!.flatMap(row => row.modifiers ?? []);
    expect(modifiers.map(row => row.value)).toEqual([{ op: 'const', value: .15 }, { op: 'const', value: .05 }]);
    expect(prepared.compileRequest.sharedProviders!.filter(row => row.kind === 'character')).toHaveLength(2);
    expect(prepared.basicAttackBinding.skillKey).toBe(snapshot.selection.basicAttackSkillKey);
    expect(prepared.skillOrigins.filter(row => row.providerRef)).toHaveLength(2);
    const continuous = await continuousAttackRequest(prepared, snapshot, { durationMs: 2000, attackSpeedInputMax: 5 });
    expect(continuous.runRequest.runtimeOptions?.skillOrigins).toEqual(prepared.skillOrigins);
    expect(continuous.runRequest.driverPlan.entries).toHaveLength(0);
  });

  it('只执行完整初始化，主动兄弟分支不生成使用或命中监听', () => {
    const snapshot = naturalSample();
    const configuration = snapshot.skillConfigurations[1]!;
    configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'active',
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: null, useKind: 'ANY', castPhase: null } } });
    syncSimulationSkillSources(snapshot);
    const prepared = scene(snapshot);
    const listeners = prepared.compileRequest.sharedProviders!.filter(row => row.providerKey.includes('natural_skill')).flatMap(row => row.listeners ?? []);
    expect(listeners).toHaveLength(2);
    expect(listeners.every(row => row.listenerKey === 'initialize')).toBe(true);
  });

  it('同一构筑选项在不同位置授予同一技能，保持完整来源及独立初始化', () => {
    const snapshot = naturalSample();
    const build = simulationBuildSample();
    snapshot.source.selectedBuilds.push(build);
    snapshot.selection.sourceBuildConfigurations.push(build.configuration);
    syncSimulationSkillSources(snapshot);
    const prepared = scene(snapshot);
    const origins = prepared.skillOrigins.filter(row => row.origin.kind === 'BUILD_OPTION');
    expect(origins).toHaveLength(2);
    expect(new Set(origins.map(row => row.providerRef)).size).toBe(2);
    expect(prepared.compileRequest.sharedProviders!.filter(row => row.kind === 'build')).toHaveLength(2);
    expect(origins.every(row => row.skillLevel === 1)).toBe(true);
    snapshot.selection.sourceSkillSettings.push({ origin: origins[0]!.origin, skillKey: origins[0]!.skillKey, enabled: false });
    syncSimulationSkillSources(snapshot);
    const disabled = scene(snapshot);
    expect(disabled.skillOrigins.filter(row => row.origin.kind === 'BUILD_OPTION' && row.providerRef)).toHaveLength(1);
    expect(snapshot.source.selectedBuilds[0]!.configuration.selections).toHaveLength(2);
  });

  it('逐侧开关改变冻结摘要但不删除原关系，等级0未学不执行', async () => {
    const snapshot = naturalSample();
    const prepared = scene(snapshot);
    const before = await prepareSimulation(snapshot, prepared.attributeInputs, { source: 650, target: 590 });
    snapshot.selection.sourceSkillSettings[0]!.enabled = false;
    syncSimulationSkillSources(snapshot);
    const after = await prepareSimulation(snapshot, prepared.attributeInputs, { source: 650, target: 590 });
    expect(after.compileRequest.rulesHash).not.toBe(before.compileRequest.rulesHash);
    expect(after.skillOrigins.filter(row => row.providerRef).map(row => row.side)).toEqual(['target']);
    expect(snapshot.source.attachedSkills).toHaveLength(2);
    snapshot.selection.targetSkillSettings[0]!.skillLevel = 0;
    syncSimulationSkillSources(snapshot);
    expect(scene(snapshot).skillOrigins.filter(row => row.providerRef)).toHaveLength(0);
  });

  it('常驻装备被禁用只去掉初始化，直接属性保持且不再要求光环确认', async () => {
    const snapshot = permanentEquipmentSimulationSample(['item_3065'], ['item_3110']);
    for (const side of ['source', 'target'] as const) {
      const source = snapshot[side].skillSources.find(row => row.origin.kind === 'EQUIPMENT')!;
      snapshot.selection[`${side}SkillSettings`].push({ origin: source.origin, skillKey: source.skillKey, enabled: false });
    }
    syncSimulationSkillSources(snapshot);
    const prepared = scene(snapshot);
    expect(prepared.compileRequest.sharedProviders!.some(row => row.listeners?.some(listener => listener.eventMatcher.all?.includes('event/source_initialized')))).toBe(false);
    expect(prepared.compileRequest.combatants[0]!.attributes.hp!.max).toBe(1050);
    expect(prepared.compileRequest.combatants[1]!.providers).toHaveLength(1);
    await expect(continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 5 })).resolves.toBeDefined();
  });

  it('缺默认来源、缺等级和未知并列结果整体拒绝，不自动选择普攻替身', () => {
    const missing = naturalSample();
    missing.source.skillSources.pop();
    expect(() => scene(missing)).toThrow(/不能被过滤/);
    const level = naturalSample();
    delete level.selection.sourceSkillSettings[0]!.skillLevel;
    level.source.skillSources.find(row => row.skillKey === 'sample_natural')!.skillLevel = null;
    syncSimulationSkillSources(level);
    expect(() => scene(level)).toThrow(/等级/);
    const unsupported = naturalSample();
    unsupported.skillConfigurations[1]!.effects[0]!.results.push({ ...structuredClone(unsupported.skillConfigurations[1]!.effects[0]!.results[0]!),
      resultKey: 'unsupported', resultType: 'DIRECT_HEAL' as never });
    expect(() => scene(unsupported)).toThrow(/不能只执行/);
    const primary = naturalSample();
    primary.selection.sourceSkillSettings.push({ origin: { kind: 'CHARACTER', characterKey: 'actor_a' },
      skillKey: primary.selection.basicAttackSkillKey, enabled: false });
    syncSimulationSkillSources(primary);
    expect(() => scene(primary)).toThrow(/不能自动改用/);
  });

  it('初始化产生的生命周期及结果尾规则尚未接入时整体拒绝', () => {
    for (const eventSource of [
      { eventType: 'LIFECYCLE_MOMENT' as const, detail: { effectKey: 'passive', moment: 'APPLICATION' as const } },
      { eventType: 'RESULT_AVAILABLE' as const, detail: { effectKey: 'passive', resultKey: 'bonus_speed' } }
    ]) {
      const snapshot = naturalSample();
      const configuration = snapshot.skillConfigurations[1]!;
      configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'tail', eventSource });
      syncSimulationSkillSources(snapshot);
      expect(() => scene(snapshot)).toThrow(/尾规则尚未接入5A/);
    }
  });

  it('虚假主动后置、无自主攻击或漏掉自然根不能隐藏开启贡献', () => {
    for (const inactiveReason of ['ACTIVE_DEFERRED', 'NO_AUTONOMOUS_ATTACK', null] as const) {
      const snapshot = naturalSample();
      const source = snapshot.source.skillSources.find(row => row.skillKey === 'sample_natural')!;
      source.inactiveReason = inactiveReason;
      source.enabledRuleKeys = [];
      expect(() => scene(snapshot)).toThrow(/真实自然入口|排除原因|完整保留/);
    }
  });
});

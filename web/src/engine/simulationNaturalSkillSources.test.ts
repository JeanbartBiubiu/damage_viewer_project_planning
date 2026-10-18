import { authorEquipmentSpeedRule } from '../../tests/fixtures/simulationCalculationRules';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import { describe, expect, it } from 'vitest';
import { simulationBuildSample, simulationSample } from '../../tests/fixtures/simulationSnapshot';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { permanentEquipmentSimulationSample } from '../../tests/fixtures/simulationPermanentEquipment';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { assembleSimulation as raw_assembleSimulation, inspectSimulationSnapshot as raw_inspectSimulationSnapshot, prepareSimulation } from './simulationAdapter';
import { continuousAttackRequest } from './continuousAttackRequest';
import { recurveBowConfiguration, triggeredEquipmentSimulationSample } from '../../tests/fixtures/simulationTriggeredEquipment';
import type { SkillEffect, SkillEffectLifecycle } from '../types/skillEffect';
import type { SkillProcess } from '../types/skillProcess';
import type { SkillTriggerAction, SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import { naturalRuleKeys, validateSimulationSkillSourceManifest } from './simulationSkillSourceDescription';
import { selectSimulationSkillSourceClosure } from './simulationSkillSourceClosure';

function syncNaturalSources(snapshot: SimulationSnapshot) {
  syncSimulationSkillSources(snapshot);
  for (const side of ['source', 'target'] as const) for (const source of snapshot[side].skillSources) {
    if (source.origin.kind === 'EQUIPMENT' || source.inactiveReason !== null) continue;
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === source.skillKey)!;
    source.enabledRuleKeys = naturalRuleKeys(snapshot, configuration, side);
  }
  return snapshot;
}

function dynamicNaturalSample(skillKey = 'authored_trigger') {
  const snapshot = triggeredEquipmentSimulationSample([], []);
  const configuration = JSON.parse(JSON.stringify(recurveBowConfiguration()).replaceAll('item_1043_passive', skillKey)) as SkillConfiguration;
  configuration.skill.maxLevel = 3;
  configuration.skill.skillCategoryKeys = ['authored_natural'];
  snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'authored_natural', name: '独立非P槽自然分类' });
  configuration.parameters[0]!.valueMode = 'SKILL_LEVEL';
  configuration.parameters[0]!.fixedValue = null;
  configuration.parameters[0]!.levelValues = { '1': 11, '2': 17, '3': 23 };
  const firstRule = configuration.triggerRules[0]!;
  const metadata = { gameId: snapshot.gameId, skillKey, description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
  const fixed = (value: number) => ({ kind: 'FIXED' as const, value });
  const action = (key: string, process = false, sortOrder = 0, own = false): SkillTriggerAction => ({
    ...structuredClone(firstRule.actions[0]!), actionKey: key, sortOrder,
    actionType: process ? 'START_PROCESS' : 'EXECUTE_EFFECT', detail: process ? { processKey: key } : { effectKey: key },
    targetContext: own ? 'EVENT_SOURCE' : 'CURRENT_TARGET'
  } as SkillTriggerAction);
  const rule = (key: string, eventSource: SkillTriggerRuleDetail['eventSource'], actions: SkillTriggerAction[], sortOrder = 0): SkillTriggerRuleDetail => ({
    ...structuredClone(firstRule), ruleKey: key, eventSource, actions, sortOrder
  });
  const life: SkillEffectLifecycle = {
    durationValue: fixed(2500), maxStacksValue: fixed(8), applicationStacksValue: fixed(1), instanceScope: 'SOURCE',
    reapplicationStackMode: 'INCREASE', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE',
    periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null
  };
  configuration.effects.push({ ...structuredClone(configuration.effects[0]!), effectKey: 'stacking', lifecycle: life, results: [{
    ...structuredClone(configuration.effects[0]!.results[0]!), resultKey: 'speed', resultType: 'ATTRIBUTE_CHANGE',
    target: 'SOURCE', detail: { attributeKey: 'bonus_attack_speed_percent', operation: 'INCREASE', modifierZoneKey: null },
    valueRule: { value: fixed(.04), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
    lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'PER_STACK',
      reapplicationValueMode: null, periodicExecutionMode: null }
  }] });
  configuration.internalStates = [
    { ...metadata, stateKey: 'hits', name: '按真实对手计数', stateType: 'COUNTER', scope: 'TARGET',
      detail: { initialValue: fixed(0), maxValue: fixed(3), durationValue: fixed(4000) } },
    { ...metadata, stateKey: 'gate', name: '按真实对手冷却', stateType: 'INTERNAL_COOLDOWN', scope: 'TARGET',
      detail: { durationValue: fixed(1001) } }
  ];
  const process = (key: string): SkillProcess => ({
    ...metadata, processKey: key, name: key, activationType: 'PASSIVE', cooldown: null, effectBindings: [], stateOperations: [],
    steps: [{ stepKey: 'instant', name: '即时', description: null, sortOrder: 0, stepType: 'IMMEDIATE', detail: {} }]
  });
  const advance = process('advance');
  advance.stateOperations.push({ operationKey: 'increment', name: '累计一次', stateSkillKey: skillKey, stateKey: 'hits',
    operation: 'INCREASE', value: fixed(1), optionKey: null, sortOrder: 0,
    moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } });
  const reset = process('reset');
  reset.stateOperations.push(
    { ...advance.stateOperations[0]!, operationKey: 'reset', operation: 'SET', value: fixed(0) },
    { ...advance.stateOperations[0]!, operationKey: 'start_gate', stateKey: 'gate', operation: 'START', value: null, sortOrder: 1 }
  );
  configuration.processes = [advance, reset];
  const reward = rule('threshold_reward', { eventType: 'PROCESS_MOMENT', detail: { processKey: 'advance',
    moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } } },
  [action('on_hit_damage'), action('reset', true, 1)], 6);
  reward.conditionGroups = [{ groupKey: 'eligible', name: '完整条件', sortOrder: 0, conditions: [
    { conditionKey: 'third', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 0, detail: { stateSkillKey: skillKey,
      stateKey: 'hits', valueKind: 'VALUE', optionKey: null, expectedBoolean: null, comparator: 'GTE', comparisonValue: fixed(3) } },
    { conditionKey: 'ready', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 1, detail: { stateSkillKey: skillKey,
      stateKey: 'gate', valueKind: 'REMAINING_MS', optionKey: null, expectedBoolean: null, comparator: 'EQ', comparisonValue: fixed(0) } }
  ] }];
  configuration.triggerRules = [
    rule('initialize', { eventType: 'SOURCE_INITIALIZED', detail: {} }, [action('stacking', false, 0, true)]),
    rule('start', { eventType: 'BASIC_ATTACK_START', detail: {} }, [action('stacking', false, 0, true)], 1),
    rule('hit', { eventType: 'BASIC_ATTACK_HIT', detail: {} }, [action('advance', true)], 2),
    rule('receive', { eventType: 'BASIC_ATTACK_RECEIVED', detail: {} }, [action('advance', true, 0, true)], 3),
    rule('linked', { eventType: 'HIT_LINK_APPLIED', detail: { sourceSkillKey: null } }, [action('on_hit_damage')], 4),
    reward
  ];
  snapshot.skillConfigurations.push(configuration);
  for (const side of ['source', 'target'] as const) {
    const actor = snapshot[side];
    actor.selectedLevelValues.attack_speed_ratio = .5;
    actor.attachedSkills.push({ gameId: snapshot.gameId, characterKey: actor.character.characterKey,
      characterName: actor.character.name, skillKey, skillName: '异名自然结构', skillStatus: 'ENABLED', sortOrder: 1 });
    snapshot.selection[`${side}SkillSettings`].push({ origin: { kind: 'CHARACTER', characterKey: actor.character.characterKey },
      skillKey, enabled: true, skillLevel: side === 'source' ? 3 : 1 });
  }
  return syncNaturalSources(snapshot);
}

function dynamicConfiguration(snapshot: SimulationSnapshot) {
  return snapshot.skillConfigurations.find(row => row.skill.skillKey !== snapshot.selection.basicAttackSkillKey)!;
}

function undrivenTargetSample(build = false) {
  const snapshot = dynamicNaturalSample('sample_natural');
  const configuration = dynamicConfiguration(snapshot);
  configuration.triggerRules = configuration.triggerRules.filter(rule => ['start', 'hit', 'linked', 'threshold_reward'].includes(rule.ruleKey));
  configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules.find(rule => rule.ruleKey === 'linked')!),
    ruleKey: 'attack_linked', eventSource: { eventType: 'ATTACK_LINK_APPLIED', detail: { sourceSkillKey: null } }, sortOrder: 5 });
  if (build) {
    const selected = simulationBuildSample();
    snapshot.target.selectedBuilds.push(selected);
    snapshot.selection.targetBuildConfigurations.push(selected.configuration);
  }
  syncNaturalSources(snapshot);
  for (const source of snapshot.target.skillSources.filter(row => row.skillKey === configuration.skill.skillKey)) {
    source.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
    source.enabledRuleKeys = [];
  }
  return snapshot;
}

function naturalPrograms(snapshot: SimulationSnapshot) {
  const assembled = scene(snapshot);
  const programs = assembled.skillOrigins.filter(row => row.providerRef).map(origin => ({
    origin, provider: assembled.compileRequest.sharedProviders!.find(row => row.providerKey === origin.definitionRef)!
  }));
  return { assembled, programs };
}

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
  authorEquipmentSpeedRule(snapshot);
  return syncSimulationSkillSources(snapshot);
}

function scene(snapshot: SimulationSnapshot) {
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(snapshot, inputs, { source: 650, target: 590 });
}

function deferredResolutionSample(skillKey: string, processKey: string, resolvedOnly = false, basicAttack = false) {
  const snapshot = naturalSample(simulationActiveSample());
  const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_natural')!;
  const active = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
  active.processes[0]!.processKey = processKey;
  active.triggerRules[0]!.actions[0]!.detail = { processKey };
  if (basicAttack) {
    snapshot.selection.basicAttackSkillKey = snapshot.skillConfigurations[0]!.skill.skillKey;
    snapshot.selection.basicAttackLevel = 1;
  }
  configuration.skill.skillKey = skillKey;
  for (const row of configuration.parameters) row.skillKey = skillKey;
  for (const row of configuration.effects) row.skillKey = skillKey;
  const initial = configuration.triggerRules[0]!;
  configuration.triggerRules = [
    ...resolvedOnly ? [] : [
      { ...structuredClone(initial), ruleKey: 'use', eventSource: { eventType: 'SKILL_USED' as const,
        detail: { sourceSkillKey: active.skill.skillKey, useKind: 'ACTIVE' as const, castPhase: 'INITIAL' as const } } },
      { ...structuredClone(initial), ruleKey: 'contact', eventSource: { eventType: 'SKILL_HIT' as const,
        detail: { sourceSkillKey: active.skill.skillKey } } }
    ],
    { ...structuredClone(initial), ruleKey: 'resolved', eventSource: { eventType: 'PROCESS_RESOLVED',
      detail: { sourceSkillKey: active.skill.skillKey, processKey } } }
  ];
  for (const side of ['source', 'target'] as const) {
    snapshot[side].attachedSkills.find(row => row.skillKey === 'sample_natural')!.skillKey = skillKey;
    snapshot.selection[`${side}SkillSettings`].find(row => row.skillKey === 'sample_natural')!.skillKey = skillKey;
    const source = snapshot[side].skillSources.find(row => row.skillKey === 'sample_natural')!;
    source.skillKey = skillKey;
    source.enabledRuleKeys = naturalRuleKeys(snapshot, configuration, side);
    source.inactiveReason = side === 'source' ? null : 'ACTIVE_DEFERRED';
  }
  if (basicAttack) {
    const source = snapshot.source.skillSources[0]!;
    source.inactiveReason = null;
    source.enabledRuleKeys = naturalRuleKeys(snapshot, snapshot.skillConfigurations[0]!, 'source');
  }
  return { snapshot, configuration };
}

describe('无施放计划的跨技能自然入口', () => {
  it.each([
    ['deferred_alpha', 'finish_alpha', false],
    ['deferred_beta', 'finish_beta', true]
  ] as const)('目标保留%s完整开启配置，使用、接触和终结入口均不可达时允许主动后置', (skillKey, processKey, basicAttack) => {
    const { snapshot, configuration } = deferredResolutionSample(skillKey, processKey, false, basicAttack);
    const before = structuredClone(snapshot);
    expect(naturalRuleKeys(snapshot, configuration, 'source')).toEqual(['contact', 'resolved', 'use']);
    expect(naturalRuleKeys(snapshot, configuration, 'target')).toEqual([]);
    expect(snapshot.target.skillSources.find(row => row.skillKey === skillKey))
      .toMatchObject({ enabled: true, inactiveReason: 'ACTIVE_DEFERRED', enabledRuleKeys: [] });
    expect(() => validateSimulationSkillSourceManifest(snapshot)).not.toThrow();
    expect(snapshot).toEqual(before);
  });

  it('只有真实过程终结订阅也能证明主动后置，不要求伪造使用或命中入口', () => {
    const { snapshot } = deferredResolutionSample('terminal_only', 'terminal_process', true);
    expect(() => validateSimulationSkillSourceManifest(snapshot)).not.toThrow();
  });

  it.each([
    { eventType: 'SOURCE_INITIALIZED' as const, detail: {} },
    { eventType: 'DAMAGE_TAKEN' as const, detail: { sourceSkillKey: null, damageTypeKey: null,
      deliveryKind: 'ANY' as const, originKind: 'ANY' as const } }
  ])('主动后置仍不能隐藏目标实际$eventType入口', eventSource => {
    const { snapshot, configuration } = deferredResolutionSample('deferred_guard', 'finish_guard');
    configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'real_natural', eventSource });
    snapshot.source.skillSources.find(row => row.skillKey === configuration.skill.skillKey)!.enabledRuleKeys =
      naturalRuleKeys(snapshot, configuration, 'source');
    expect(() => validateSimulationSkillSourceManifest(snapshot)).toThrow(/主动后置原因不能隐藏真实自然入口/);
  });

  it('真实施放来源的过程终结入口不能用主动后置隐藏', () => {
    const { snapshot, configuration } = deferredResolutionSample('driven_guard', 'finish_guard', true);
    const source = snapshot.source.skillSources.find(row => row.skillKey === configuration.skill.skillKey)!;
    source.inactiveReason = 'ACTIVE_DEFERRED';
    source.enabledRuleKeys = [];
    expect(() => validateSimulationSkillSourceManifest(snapshot)).toThrow(/主动后置原因不能隐藏真实自然入口/);
  });
});

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
      { eventType: 'LIFECYCLE_MOMENT' as const, detail: { effectKey: 'passive', moment: 'NATURAL_END' as const } },
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

describe('5B真实默认来源复用通用触发核心', () => {
  it.each(['damage_reduce_alpha', 'damage_reduce_beta'])('%s 的新增自然有限减伤和补集属性都拒绝，不能仅凭编译结果准入', skillKey => {
    const snapshot = naturalSample();
    const configuration = snapshot.skillConfigurations[1]!;
    // 使用同一真实来源测试布局，仅改该布局作者标识与完整结果；不新增虚假事件。
    const previousKey = configuration.skill.skillKey;
    const renamed = JSON.parse(JSON.stringify(snapshot).replaceAll(previousKey, skillKey)) as SimulationSnapshot;
    const authored = renamed.skillConfigurations[1]!;
    const effect = authored.effects[0]!;
    effect.lifecycle = { ...effect.lifecycle!, durationValue: { kind: 'FIXED', value: 4000 }, expiryMode: 'ALL_AT_ONCE', reapplicationDurationMode: 'REFRESH_ALL' };
    effect.results = [{ ...effect.results[0]!, resultType: 'DAMAGE_MODIFIER', target: 'SOURCE', spellShieldBlockScope: null,
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED', reapplicationValueMode: null, periodicExecutionMode: null },
      valueRule: { value: { kind: 'FIXED', value: .25 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      detail: { modifierZoneKey: 'incoming_product', direction: 'TAKEN', operation: 'DECREASE', damageTypeKey: renamed.catalogs.damageTypes[0]!.type.damageTypeKey,
        deliveryKind: 'ANY', originKind: 'ANY', criticalFilter: 'ANY' } }];
    authored.triggerRules[0]!.eventSource = { eventType: 'DAMAGE_TAKEN', detail: { sourceSkillKey: null, damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY' } };
    authored.triggerRules[0]!.actions[0]!.targetContext = 'CURRENT_TARGET';
    renamed.catalogs.modifierZones.push({ ...renamed.catalogs.modifierZones[0]!, modifierZoneKey: 'incoming_product', name: '承受乘算', domain: 'DAMAGE',
      calculationMode: 'RATIO_MULTIPLY', applicationStage: 'DAMAGE_POST_DEFENSE' });
    syncNaturalSources(renamed);
    expect(() => scene(renamed)).toThrow(/仅接真实过程施加/);
    effect.results = [{ ...effect.results[0]!, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE',
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null },
      detail: { attributeKey: 'bonus_attack_speed_percent', operation: 'INCREASE', modifierZoneKey: 'incoming_product' } }];
    renamed.catalogs.modifierZones.find(row => row.modifierZoneKey === 'incoming_product')!.calculationMode = 'RATIO_COMPLEMENT_MULTIPLY';
    expect(() => scene(renamed)).toThrow(/仅接真实过程施加/);
  });

  it('双方18级的异名PER_STACK有期SOURCE单一开始根只为A编译，B保留无自主攻击原因及空根', () => {
    const snapshot = undrivenTargetSample();
    const configuration = dynamicConfiguration(snapshot);
    const stacking = configuration.effects.find(effect => effect.effectKey === 'stacking')!;
    configuration.skill.maxLevel = 1;
    configuration.effects = [stacking];
    configuration.processes = [];
    configuration.internalStates = [];
    configuration.triggerRules = configuration.triggerRules.filter(rule => rule.ruleKey === 'start');
    configuration.parameters = [{ ...configuration.parameters[0]!, parameterKey: 'character_speed',
      valueMode: 'CHARACTER_LEVEL', valueType: 'DECIMAL', fixedValue: null, levelValues: { '18': .16 } }];
    stacking.results[0]!.valueRule!.value = { kind: 'PARAMETER', parameterKey: 'character_speed' };
    snapshot.catalogs.levelConfig.maxLevel = 18;
    for (const side of ['source', 'target'] as const) {
      snapshot.selection[`${side}Level`] = 18;
      snapshot.selection[`${side}SkillSettings`][0]!.skillLevel = 1;
      snapshot[side].attributes.levelValues['18'] = { ...snapshot[side].selectedLevelValues };
    }
    syncNaturalSources(snapshot);
    const source = snapshot.source.skillSources.find(row => row.skillKey === configuration.skill.skillKey)!;
    const target = snapshot.target.skillSources.find(row => row.skillKey === configuration.skill.skillKey)!;
    target.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
    target.enabledRuleKeys = [];
    expect(source.enabledRuleKeys).toEqual(['start']);
    const before = structuredClone(snapshot);
    const { assembled, programs } = naturalPrograms(snapshot);
    expect(programs.map(row => row.origin.side)).toEqual(['source']);
    const provider = programs[0]!.provider;
    expect(provider.abilities).toHaveLength(1);
    expect(provider.abilities![0]).toMatchObject({ abilityKey: 'start', kind: 'passive_listener',
      params: { character_speed: .16 }, listenerSpec: {
        eventMatcher: { all: ['event/basic_attack_start', 'event/source_owner'] },
        operations: [{ operation: 'state_change', ref: 'effect_stacking', valuePolicy: 'add',
          amount: { op: 'const', value: 1 }, types: ['state_scope/provider'] }]
      } });
    expect(provider.initialStateSchema!.effect_stacking).toEqual({ valueType: 'integer', defaultValue: 0,
      maxValue: 8, durationMs: 2500, refreshPolicy: 'refresh_on_write' });
    expect(provider.modifiers![0]!.value).toEqual({ op: 'mul', args: [
      { op: 'const', value: .16 }, { op: 'read', path: 'provider.state.effect_stacking' }
    ] });
    expect(assembled.skillOrigins.find(row => row.side === 'target' && row.skillKey === configuration.skill.skillKey))
      .toMatchObject({ enabledRuleKeys: [], inactiveReason: 'NO_AUTONOMOUS_ATTACK' });
    expect(assembled.compileRequest.combatants[1]!.providers).toHaveLength(0);
    expect(snapshot).toEqual(before);
  });

  it.each([false, true])('B方只有合法开始命中联动及其完整过程闭包时保留真实来源但不生成状态监听，构筑=%s', build => {
    const snapshot = undrivenTargetSample(build);
    const before = structuredClone(snapshot);
    const { assembled, programs } = naturalPrograms(snapshot);
    expect(programs.map(row => row.origin.side)).toEqual(['source']);
    const excluded = assembled.skillOrigins.filter(row => row.side === 'target' && row.skillKey === 'sample_natural');
    expect(excluded).toHaveLength(build ? 3 : 1);
    expect(excluded.every(row => row.inactiveReason === 'NO_AUTONOMOUS_ATTACK' && !row.providerRef && !row.definitionRef)).toBe(true);
    expect(assembled.compileRequest.combatants[1]!.providers).toHaveLength(0);
    expect(assembled.coverage.some(row => row.authorPath.startsWith('target.skillSources')
      && row.note?.includes('不生成挂载、状态或监听'))).toBe(true);
    expect(snapshot).toEqual(before);
  });

  it.each([
    { eventType: 'SOURCE_INITIALIZED' as const, detail: {} },
    { eventType: 'BASIC_ATTACK_RECEIVED' as const, detail: {} },
    { eventType: 'DAMAGE_PENDING' as const, detail: {} },
    { eventType: 'DAMAGE_TAKEN' as const, detail: { sourceSkillKey: null, damageTypeKey: null, deliveryKind: 'ANY' as const, originKind: 'ANY' as const } }
  ])('无自主攻击理由不能隐藏B实际$eventType自然根，角色与构筑均拒绝', eventSource => {
    for (const build of [false, true]) {
      const snapshot = undrivenTargetSample(build);
      const configuration = dynamicConfiguration(snapshot);
      configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'real_target_root', eventSource });
      syncNaturalSources(snapshot);
      for (const source of snapshot.target.skillSources.filter(row => row.skillKey === configuration.skill.skillKey)) {
        source.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
        source.enabledRuleKeys = [];
      }
      expect(() => scene(snapshot)).toThrow(/排除原因不能隐藏真实自然入口/);
    }
  });

  it('普通攻击分类也不能让无自主攻击理由隐藏B初始化根或A所选主体', () => {
    const target = undrivenTargetSample();
    const primary = target.skillConfigurations.find(row => row.skill.skillKey === target.selection.basicAttackSkillKey)!;
    primary.triggerRules.push({ ...structuredClone(primary.triggerRules[0]!), ruleKey: 'real_initialized',
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} } });
    syncNaturalSources(target);
    expect(() => scene(target)).toThrow(/排除原因不能隐藏真实自然入口/);
    const source = undrivenTargetSample();
    const selected = source.source.skillSources.find(row => row.skillKey === source.selection.basicAttackSkillKey)!;
    selected.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
    selected.enabledRuleKeys = [];
    expect(() => scene(source)).toThrow(/排除原因不能隐藏真实自然入口或所选主体/);
  });

  it('未驱动主动兄弟可保留；此理由仍不能隐藏A自然来源、未知入口或空配置', () => {
    const source = undrivenTargetSample();
    source.source.skillSources.find(row => row.skillKey === 'sample_natural')!.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
    source.source.skillSources.find(row => row.skillKey === 'sample_natural')!.enabledRuleKeys = [];
    expect(() => scene(source)).toThrow(/排除原因不能隐藏/);
    for (const eventSource of [
      { eventType: 'SKILL_USED' as const, detail: { sourceSkillKey: 'sample_natural', useKind: 'ACTIVE' as const, castPhase: 'INITIAL' as const } },
      { eventType: 'ENTITY_DIED' as const, detail: { subject: 'SOURCE' as const } }
    ]) {
      const snapshot = undrivenTargetSample();
      const configuration = dynamicConfiguration(snapshot);
      configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'other_entry', eventSource });
      if (eventSource.eventType === 'SKILL_USED') expect(() => scene(snapshot)).not.toThrow();
      else expect(() => scene(snapshot)).toThrow(/排除原因不能隐藏/);
    }
    const empty = undrivenTargetSample();
    empty.selection.sourceSkillSettings[0]!.enabled = false;
    syncNaturalSources(empty);
    empty.target.skillSources.find(row => row.skillKey === 'sample_natural')!.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
    dynamicConfiguration(empty).triggerRules = [];
    expect(() => scene(empty)).toThrow(/排除原因不能隐藏/);
  });

  it('不驱动的攻击配置仍必须完整引用，角色及构筑身份、真实授予等级不能伪造', () => {
    const missing = undrivenTargetSample();
    missing.selection.sourceSkillSettings[0]!.enabled = false;
    syncNaturalSources(missing);
    missing.target.skillSources.find(row => row.skillKey === 'sample_natural')!.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
    dynamicConfiguration(missing).processes = [];
    expect(() => scene(missing)).toThrow(/必要闭包引用缺失或重复/);
    const character = undrivenTargetSample();
    const source = character.target.skillSources.find(row => row.skillKey === 'sample_natural')!;
    source.origin = { kind: 'CHARACTER', characterKey: character.source.character.characterKey };
    expect(() => scene(character)).toThrow(/默认来源与原始绑定不一致/);
    const build = undrivenTargetSample(true);
    const grant = build.target.skillSources.find(row => row.origin.kind === 'BUILD_OPTION')!;
    if (grant.origin.kind !== 'BUILD_OPTION') throw new Error('需要真实构筑来源');
    grant.origin.slotKey = 'not_selected';
    expect(() => scene(build)).toThrow(/默认来源与原始绑定不一致/);
    const level = undrivenTargetSample(true);
    level.target.skillSources.find(row => row.origin.kind === 'BUILD_OPTION')!.skillLevel = 3;
    expect(() => scene(level)).toThrow(/等级与真实绑定授予不一致/);
  });

  it('普通攻击分类的独立主动兄弟保留但不驱动，空配置仍拒绝', () => {
    for (const active of [false, true]) {
      const snapshot = undrivenTargetSample();
      snapshot.selection.sourceSkillSettings[0]!.enabled = false;
      syncNaturalSources(snapshot);
      const configuration = dynamicConfiguration(snapshot);
      configuration.skill.skillCategoryKeys = ['basic_attack'];
      if (active) configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'separate_active',
        eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'sample_natural', useKind: 'ACTIVE', castPhase: 'INITIAL' } } });
      else configuration.triggerRules = [];
      snapshot.target.skillSources.find(row => row.skillKey === 'sample_natural')!.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
      if (active) expect(() => scene(snapshot)).not.toThrow();
      else expect(() => scene(snapshot)).toThrow(/target.skillSources.sample_natural.*排除原因不能隐藏/);
    }
  });

  it.each(['first_authored', 'different_structure_name'])('异名%s按真实来源等级绑定、两侧状态隔离且B无自主普攻', async skillKey => {
    const snapshot = dynamicNaturalSample(skillKey);
    const before = structuredClone(snapshot);
    const { assembled, programs } = naturalPrograms(snapshot);
    expect(programs.map(row => row.provider.kind)).toEqual(['character', 'character']);
    expect(new Set(programs.map(row => row.provider.stableId)).size).toBe(2);
    expect(programs.map(row => row.provider.abilities![0]!.params!.on_hit_damage)).toEqual([23, 11]);
    expect(assembled.compileRequest.sharedProviders!.filter(row => row.kind === 'item')).toHaveLength(0);
    expect(assembled.compileRequest.sharedProviders!.filter(row => row.processes?.length)).toHaveLength(1);
    expect(assembled.compileRequest.combatants[0]!.providers.filter(row => row.providerRef === 'selected_basic_attack')).toHaveLength(1);
    expect(assembled.compileRequest.combatants[1]!.providers.some(row => row.providerRef === 'selected_basic_attack')).toBe(false);
    expect(programs[1]!.provider.abilities!.map(row => row.abilityKey)).toEqual(['initialize', 'receive']);
    expect(assembled.compileRequest.rules.attributeDerivations?.map(row => row.combatantKey)).toEqual(['source', 'target']);
    const continuous = await continuousAttackRequest(assembled, snapshot, { durationMs: 2000, attackSpeedInputMax: 5 });
    expect(continuous.runRequest.driverPlan.entries).toHaveLength(0);
    expect(snapshot).toEqual(before);
  });

  it('真实开始、命中、接收和明确联动分离，只有保存的合格分支改变计数', () => {
    const snapshot = dynamicNaturalSample();
    const { assembled, programs } = naturalPrograms(snapshot);
    const source = programs[0]!.provider;
    const byKey = (key: string) => source.abilities!.find(row => row.abilityKey === key)!.listenerSpec!;
    expect(byKey('start').eventMatcher.all).toEqual(['event/basic_attack_start', 'event/source_owner']);
    expect(byKey('hit').eventMatcher.all).toEqual(['event/basic_attack_hit', 'event/source_owner']);
    expect(programs[1]!.provider.abilities!.find(row => row.abilityKey === 'receive')!.listenerSpec!.eventMatcher.all)
      .toEqual(['event/basic_attack_received', 'event/target_owner']);
    expect(byKey('linked').eventMatcher.all).toEqual(['event/hit_link_applied', 'event/source_owner']);
    expect(byKey('start').operations!.map(row => row.ref)).toEqual(['effect_stacking']);
    expect(byKey('hit').operations![0]).toMatchObject({ operation: 'state_change', ref: 'hits',
      amount: { op: 'const', value: 1 }, types: ['state_scope/provider_target'] });
    expect(byKey('hit').operations!.map(row => row.operation)).toEqual(['state_change', 'state_change', 'damage', 'state_change', 'state_change']);
    expect(byKey('hit').operations![1]!.amount).toMatchObject({ op: 'min', args: [
      { op: 'gte', args: [{ op: 'read', path: 'provider.target_state.hits' }, { op: 'const', value: 3 }] },
      { op: 'eq', args: [{ op: 'read', path: 'provider.target_state.gate' }, { op: 'const', value: 0 }] }
    ] });
    expect(byKey('linked').operations!.map(row => row.operation)).toEqual(['damage']);
    expect(assembled.compileRequest.typeCatalog.types).toEqual(expect.arrayContaining([
      { key: 'event/basic_attack_start', domain: 'event' }, { key: 'state_scope/provider_target', domain: 'state_scope' }
    ]));
    expect(assembled.operationOrigins.filter(row => row.resultKey === 'on_hit_damage').every(row =>
      row.compiledPaths.every(path => /^sharedProviders\[\d+\]/.test(path)))).toBe(true);
  });

  it.each(['PARAMETER', 'FORMULA'] as const)('吸血效率%s按双方角色及真实构筑授予等级独立绑定', kind => {
    const snapshot = dynamicNaturalSample('sample_natural');
    const configuration = dynamicConfiguration(snapshot);
    configuration.parameters.push({ ...configuration.parameters[0]!, parameterKey: 'vamp_efficiency',
      valueType: 'DECIMAL', levelValues: { '1': .2, '2': .4, '3': .6 } });
    const damage = configuration.effects[0]!.results[0]!;
    if (damage.resultType !== 'DAMAGE') throw new Error('需要实际伤害结果');
    if (kind === 'FORMULA') configuration.formulas.push({ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey,
      formulaKey: 'vamp_efficiency_formula', name: '等级吸血效率', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
      expression: skillFormulaDefinition(configuration.skill.skillKey, { nodeType: 'PARAMETER', parameterKey: 'vamp_efficiency' }) });
    damage.detail.vampOverrides[0]!.efficiencyValue = kind === 'PARAMETER'
      ? { kind: 'PARAMETER', parameterKey: 'vamp_efficiency' }
      : { kind: 'FORMULA', formulaKey: 'vamp_efficiency_formula' };
    const selected = simulationBuildSample();
    selected.definition.skillRelations[0]!.fixedSkillLevel = 2;
    snapshot.source.selectedBuilds.push(selected);
    snapshot.selection.sourceBuildConfigurations.push(selected.configuration);
    syncNaturalSources(snapshot);
    const before = structuredClone(snapshot);
    const { assembled, programs } = naturalPrograms(snapshot);
    expect(programs).toHaveLength(4);
    for (const { origin, provider } of programs) {
      const expected = origin.origin.kind === 'BUILD_OPTION' ? .4 : origin.side === 'source' ? .6 : .2;
      const abilities = provider.abilities!.filter(ability => ability.listenerSpec?.operations?.some(operation => operation.operation === 'damage'));
      expect(abilities.length).toBeGreaterThan(0);
      for (const ability of abilities) {
        expect(ability.params!.vamp_efficiency).toBe(expected);
        const operation = ability.listenerSpec!.operations!.find(row => row.operation === 'damage')!;
        const override = operation.vampOverrides![0]!;
        if (override.mode !== 'OVERRIDE') throw new Error('需要实际吸血效率覆盖');
        if (kind === 'PARAMETER') expect(override.efficiency).toEqual({ op: 'read', path: 'ability.param.vamp_efficiency' });
        else {
          expect(override.efficiency.ref).toContain(origin.providerRef);
          const formula = assembled.compileRequest.formulas.find(row => row.key === override.efficiency.ref)!;
          expect(formula.expression.inputs).toContainEqual({ key: 'input_0', binding: { kind: 'parameter', skillKey: formula.skillKey, parameterKey: 'vamp_efficiency' } });
          expect(formula.parameters).toContainEqual({ parameterKey: 'vamp_efficiency', valueMode: 'SKILL_LEVEL', valueType: 'DECIMAL', value: expected });
        }
      }
    }
    expect(snapshot).toEqual(before);
  });

  it('目标COUNTER保持4000毫秒刷新，ICD不刷新，SOURCE八层2500毫秒整体到期', () => {
    const { programs } = naturalPrograms(dynamicNaturalSample());
    for (const { provider } of programs) {
      expect(provider.initialStateSchema).toMatchObject({
        hits: { valueType: 'integer', defaultValue: 0, maxValue: 3, durationMs: 4000, refreshPolicy: 'refresh_on_write' },
        gate: { valueType: 'number', defaultValue: 0, maxValue: 1, durationMs: 1001, refreshPolicy: 'start_on_first_write' },
        effect_stacking: { valueType: 'integer', defaultValue: 0, maxValue: 8, durationMs: 2500, refreshPolicy: 'refresh_on_write' }
      });
      expect(provider.modifiers![0]).toMatchObject({ target: 'self.attr.bonus_attack_speed_percent',
        value: { op: 'mul', args: [{ op: 'const', value: .04 }, { op: 'read', path: 'provider.state.effect_stacking' }] } });
    }
  });

  it.each([
    [false, 'RATIO_ADD'], [true, 'RATIO_ADD'], [false, 'RATIO_MULTIPLY'], [true, 'RATIO_MULTIPLY']
  ] as const)('一般目标护甲削减与完整伤害、来源叠层并列保留，动态期限=%s修正方式=%s完整重命名', (dynamic, mode) => {
    const snapshot = dynamicNaturalSample();
    const configuration = dynamicConfiguration(snapshot);
    const original = configuration.effects[0]!;
    const armor: SkillEffect = { ...structuredClone(original), effectKey: 'armor_window',
      lifecycle: { ...configuration.effects[1]!.lifecycle!, instanceScope: 'SOURCE_TARGET',
        maxStacksValue: { kind: 'FIXED', value: 1 }, reapplicationStackMode: 'KEEP',
        durationValue: dynamic ? { kind: 'FORMULA', formulaKey: 'owned_duration' } : { kind: 'FIXED', value: 4000 } },
      results: [{ ...structuredClone(original.results[0]!), resultKey: 'armor', resultType: 'ATTRIBUTE_CHANGE', target: 'TARGET',
        detail: { attributeKey: 'armor', operation: 'DECREASE', modifierZoneKey: 'attribute_percent' },
        valueRule: { value: { kind: 'FIXED', value: .2 }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
        lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
          reapplicationValueMode: 'REPLACE', periodicExecutionMode: null } }] };
    snapshot.catalogs.modifierZones.push({ gameId: snapshot.gameId, modifierZoneKey: 'attribute_percent', name: '一般属性比例',
      description: null, status: 'ENABLED', domain: 'ATTRIBUTE', calculationMode: mode, applicationStage: 'ATTRIBUTE_PERCENT',
      sortOrder: 0, createdAt: '', updatedAt: '' });
    if (dynamic) {
      configuration.formulas.push({ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, formulaKey: 'owned_duration',
        name: '实际拥有方生命期限', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
        expression: skillFormulaDefinition(configuration.skill.skillKey, { nodeType: 'OPERATION', operation: 'ADD', operands: [
          { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'TOTAL' },
          { nodeType: 'PARAMETER', parameterKey: configuration.parameters[0]!.parameterKey }
        ] }) });
    }
    configuration.effects.push(armor);
    const reward = configuration.triggerRules.find(row => row.ruleKey === 'threshold_reward')!;
    reward.actions[1]!.sortOrder = 2;
    reward.actions.splice(1, 0, { ...structuredClone(reward.actions[0]!), actionKey: 'apply_armor', sortOrder: 1,
      detail: { effectKey: armor.effectKey } });
    syncNaturalSources(snapshot);
    const { assembled, programs } = naturalPrograms(snapshot);
    for (const { provider, origin } of programs) {
      const persistent = assembled.compileRequest.sharedProviders!.find(row => row.stableId === provider.stableId
        && row.modifiers?.some(modifier => modifier.target === 'self.attr.armor'))!;
      expect(persistent.lifecycle).toMatchObject({ instanceScope: 'source_target', maxStacks: 1, refreshPolicy: 'replace' });
      expect(persistent.modifiers![0]).toMatchObject({ target: 'self.attr.armor',
        valuePolicy: mode === 'RATIO_MULTIPLY' ? 'multiply' : 'add_percent',
        value: { op: 'const', value: mode === 'RATIO_MULTIPLY' ? .8 : -.2 } });
      const listener = provider.abilities!.find(row => row.abilityKey === (origin.side === 'source' ? 'hit' : 'receive'))!.listenerSpec!;
      expect(listener.operations!.filter(row => row.operation === 'damage')).toHaveLength(1);
      expect(listener.operations!.filter(row => row.operation === 'apply_provider')).toMatchObject([
        { target: 'target', providerDefinitionRef: persistent.providerKey }
      ]);
      if (dynamic) {
        const reference = persistent.lifecycle!.durationMs!.ref;
        const formula = assembled.compileRequest.formulas.find(row => row.key === reference)!;
        expect(formula.key).toContain(`${origin.side}_natural_skill_`);
        expect(formula.expression.stages[0]!.expression).toMatchObject({ op: 'add' });
      } else expect(persistent.lifecycle!.durationMs).toEqual({ op: 'const', value: 4000 });
    }
    expect(assembled.operationOrigins.filter(row => row.resultKey === 'armor')).toHaveLength(2);
    expect(assembled.compileRequest.sharedProviders!.filter(row => row.modifiers?.some(modifier =>
      modifier.target === 'self.attr.bonus_attack_speed_percent'))).toHaveLength(2);
    const zoneIndex = snapshot.catalogs.modifierZones.findIndex(zone => zone.modifierZoneKey === 'attribute_percent');
    const zone = snapshot.catalogs.modifierZones[zoneIndex]!;
    for (const invalid of [
      { status: 'DISABLED' }, { gameId: 'other_game' }, { domain: 'HEALING' }, { applicationStage: 'ATTRIBUTE_FLAT' }
    ] as const) {
      snapshot.catalogs.modifierZones[zoneIndex] = { ...zone, ...invalid };
      expect(() => scene(snapshot)).toThrow(/目标属性修正区需要唯一已启用/);
    }
  });

  it('两側开关、未学与等级变更只影响实际来源，不删除角色关系或另一侧', () => {
    const snapshot = dynamicNaturalSample();
    snapshot.selection.sourceSkillSettings[0]!.enabled = false;
    syncNaturalSources(snapshot);
    expect(naturalPrograms(snapshot).programs.map(row => row.origin.side)).toEqual(['target']);
    expect(snapshot.source.attachedSkills).toHaveLength(2);
    snapshot.selection.sourceSkillSettings[0]!.enabled = true;
    snapshot.selection.sourceSkillSettings[0]!.skillLevel = 2;
    snapshot.selection.targetSkillSettings[0]!.skillLevel = 0;
    syncNaturalSources(snapshot);
    expect(naturalPrograms(snapshot).programs.map(row => row.provider.abilities![0]!.params!.on_hit_damage)).toEqual([17]);
  });

  it('同技能在构筑两个位置与角色各自挂载，构筑等级来自真实授予且可独立关闭', () => {
    const snapshot = dynamicNaturalSample('sample_natural');
    const selected = simulationBuildSample();
    snapshot.source.selectedBuilds.push(selected);
    snapshot.selection.sourceBuildConfigurations.push(selected.configuration);
    syncNaturalSources(snapshot);
    const { programs } = naturalPrograms(snapshot);
    const builds = programs.filter(row => row.origin.origin.kind === 'BUILD_OPTION');
    expect(builds).toHaveLength(2);
    expect(new Set(builds.map(row => row.provider.stableId)).size).toBe(2);
    expect(builds.map(row => row.provider.kind)).toEqual(['build', 'build']);
    expect(builds.map(row => row.provider.abilities![0]!.params!.on_hit_damage)).toEqual([11, 11]);
    snapshot.selection.sourceSkillSettings.push({ origin: builds[0]!.origin.origin, skillKey: 'sample_natural', enabled: false });
    syncNaturalSources(snapshot);
    expect(naturalPrograms(snapshot).programs.filter(row => row.provider.kind === 'build')).toHaveLength(1);
    const enabled = snapshot.source.skillSources.find(row => row.origin.kind === 'BUILD_OPTION' && row.enabled)!;
    enabled.skillLevel = 3;
    expect(() => scene(snapshot)).toThrow(/等级与真实绑定授予不一致/);
  });

  it('所选普攻的技能使用与命中根仅翻译真实开始和命中，不执行其它主动使用', () => {
    const snapshot = dynamicNaturalSample();
    const configuration = dynamicConfiguration(snapshot);
    configuration.triggerRules.find(row => row.ruleKey === 'start')!.eventSource = { eventType: 'SKILL_USED',
      detail: { sourceSkillKey: snapshot.selection.basicAttackSkillKey, useKind: 'ANY', castPhase: 'INITIAL' } };
    configuration.triggerRules.find(row => row.ruleKey === 'hit')!.eventSource = { eventType: 'SKILL_HIT',
      detail: { sourceSkillKey: snapshot.selection.basicAttackSkillKey } };
    syncNaturalSources(snapshot);
    const source = naturalPrograms(snapshot).programs[0]!.provider;
    for (const [ruleKey, event] of [['start', 'event/basic_attack_start'], ['hit', 'event/basic_attack_hit']]) {
      expect(source.abilities!.find(row => row.abilityKey === ruleKey)!.listenerSpec!.eventMatcher.all).toEqual([
        event, 'event/source_owner', `ability/skill/${snapshot.selection.basicAttackSkillKey}`
      ]);
    }
    expect(source.processes).toBeUndefined();
  });

  it('无效果的完整来源计数过程仍可执行，不伪造空成功效果或额外主体', () => {
    const snapshot = dynamicNaturalSample();
    const configuration = dynamicConfiguration(snapshot);
    configuration.effects = [];
    configuration.processes = configuration.processes.filter(row => row.processKey === 'advance');
    configuration.internalStates = configuration.internalStates.filter(row => row.stateKey === 'hits');
    configuration.triggerRules = configuration.triggerRules.filter(row => ['hit', 'receive'].includes(row.ruleKey));
    syncNaturalSources(snapshot);
    const { programs } = naturalPrograms(snapshot);
    expect(programs.map(row => row.provider.abilities!.length)).toEqual([1, 1]);
    expect(programs.every(row => row.provider.abilities![0]!.listenerSpec!.operations!.length === 1)).toBe(true);
    expect(programs.every(row => row.provider.initialStateSchema!.hits)).toBe(true);
  });

  it('自身初始化不伪造TARGET对手绑定，也不伪造真实攻击的同次使用身份', () => {
    const snapshot = dynamicNaturalSample();
    const configuration = dynamicConfiguration(snapshot);
    const initialize = configuration.triggerRules.find(row => row.ruleKey === 'initialize')!;
    const hit = configuration.triggerRules.find(row => row.ruleKey === 'hit')!;
    initialize.actions = hit.actions.map(action => ({ ...structuredClone(action), targetContext: 'EVENT_SOURCE' }));
    expect(() => scene(snapshot)).toThrow(/初始化没有实际攻击对手身份/);
    initialize.actions = [{ ...configuration.triggerRules.find(row => row.ruleKey === 'start')!.actions[0]! }];
    initialize.oncePerUse = { groupKey: 'no_real_use', scope: 'SKILL' };
    expect(() => scene(snapshot)).toThrow(/初始化没有真实攻击使用身份/);
  });

  it('接收入口内的真实过程时点按拥有方与过程对手读属性，不沿用外层攻击者为事件来源', () => {
    const snapshot = dynamicNaturalSample();
    const configuration = dynamicConfiguration(snapshot);
    const reward = configuration.triggerRules.find(row => row.ruleKey === 'threshold_reward')!;
    reward.conditionGroups = [{ groupKey: 'real_participants', name: '过程拥有方及对手', sortOrder: 0, conditions: [
      { conditionKey: 'owner', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 0,
        detail: { subject: 'EVENT_SOURCE', attributeKey: 'attack_damage', attributeValueKind: 'TOTAL',
          comparator: 'GTE', comparisonValue: { kind: 'FIXED', value: 0 } } },
      { conditionKey: 'opponent', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 1,
        detail: { subject: 'CURRENT_TARGET', attributeKey: 'hp', attributeValueKind: 'CURRENT',
          comparator: 'GT', comparisonValue: { kind: 'FIXED', value: 0 } } }
    ] }];
    const target = naturalPrograms(snapshot).programs[1]!.provider;
    const operations = target.abilities!.find(row => row.abilityKey === 'receive')!.listenerSpec!.operations!;
    expect(operations[1]!.amount).toMatchObject({ op: 'min', args: [
      { op: 'gte', args: [{ op: 'read', path: 'source.attr.attack_damage.resolved' }, { op: 'const', value: 0 }] },
      { op: 'gt', args: [{ op: 'read', path: 'target.attr.hp.current' }, { op: 'const', value: 0 }] }
    ] });
  });

  it('主动兄弟的费用、主动过程及未供值输入不进入自然闭包，完整作者树不变', () => {
    const snapshot = dynamicNaturalSample();
    const configuration = dynamicConfiguration(snapshot);
    const activeEffect = { ...structuredClone(configuration.effects[0]!), effectKey: 'active_only' };
    activeEffect.results[0]!.valueRule!.value = { kind: 'PARAMETER', parameterKey: 'active_input' };
    configuration.effects.push(activeEffect);
    configuration.parameters.push({ ...configuration.parameters[0]!, parameterKey: 'active_input', valueMode: 'RUNTIME_INPUT',
      fixedValue: null, levelValues: null });
    configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'active_only',
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: configuration.skill.skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
      actions: [{ ...configuration.triggerRules[0]!.actions[0]!, detail: { effectKey: 'active_only' } }] });
    syncNaturalSources(snapshot);
    const before = structuredClone(snapshot);
    const { assembled, programs } = naturalPrograms(snapshot);
    expect(programs.every(row => row.provider.abilities!.every(ability => ability.abilityKey !== 'active_only'))).toBe(true);
    expect(programs.every(row => row.provider.abilities!.every(ability => !Object.hasOwn(ability.params!, 'active_input')))).toBe(true);
    expect(assembled.coverage.some(row => row.authorPath.endsWith('.triggerRules.active_only') && row.note?.includes('主动兄弟暂缓'))).toBe(true);
    expect(snapshot).toEqual(before);
  });

  it('递归过程闭包保留条件与尾动作，任何必要未知结果或尾规则不能只编译自然根', () => {
    for (const eventSource of [
      { eventType: 'RESULT_AVAILABLE' as const, detail: { effectKey: 'on_hit_damage', resultKey: 'on_hit_damage' } },
      { eventType: 'LIFECYCLE_MOMENT' as const, detail: { effectKey: 'stacking', moment: 'NATURAL_END' as const } },
      { eventType: 'INTERNAL_STATE_CHANGED' as const, detail: { stateSkillKey: 'authored_trigger', stateKey: 'hits', changeKind: 'VALUE_CHANGED' as const } }
    ]) {
      const snapshot = dynamicNaturalSample();
      const configuration = dynamicConfiguration(snapshot);
      configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'necessary_tail', eventSource });
      syncNaturalSources(snapshot);
      expect(selectSimulationSkillSourceClosure(configuration, snapshot.source.skillSources[1]!.enabledRuleKeys).configuration.triggerRules.some(row =>
        row.ruleKey === 'necessary_tail')).toBe(true);
      expect(() => scene(snapshot)).toThrow(/necessary_tail.*尾规则|necessary_tail.*未接入/);
    }
    const unknownResult = dynamicNaturalSample();
    dynamicConfiguration(unknownResult).effects[0]!.results.push({ ...structuredClone(dynamicConfiguration(unknownResult).effects[0]!.results[0]!),
      resultKey: 'unsupported_parallel', resultType: 'DIRECT_HEAL' as never });
    expect(() => scene(unknownResult)).toThrow(/unsupported_parallel.*未接入/);
    const missing = dynamicNaturalSample();
    dynamicConfiguration(missing).effects[0]!.results = [];
    expect(() => scene(missing)).toThrow(/缺少完整结果/);
  });

  it('不丢缺失并列结果的尾引用，也不从只读其它技能定义借用状态', () => {
    const missing = dynamicNaturalSample();
    const configuration = dynamicConfiguration(missing);
    configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'missing_parallel',
      eventSource: { eventType: 'RESULT_AVAILABLE', detail: { effectKey: 'on_hit_damage', resultKey: 'missing' } } });
    expect(() => scene(missing)).toThrow(/missing_parallel.*缺失的并列结果/);
    const cross = dynamicNaturalSample();
    dynamicConfiguration(cross).processes[0]!.stateOperations[0]!.stateSkillKey = cross.selection.basicAttackSkillKey;
    expect(() => scene(cross)).toThrow(/跨技能执行/);
  });

  it('未知逐层退层、漏自然根、重复根与伪造等级都整体拒绝', () => {
    const expiry = dynamicNaturalSample();
    dynamicConfiguration(expiry).effects[1]!.lifecycle!.expiryMode = 'ONE_BY_ONE';
    expect(() => scene(expiry)).toThrow(/来源叠层需要完整有期/);
    const omitted = dynamicNaturalSample();
    omitted.source.skillSources[1]!.enabledRuleKeys.pop();
    expect(() => scene(omitted)).toThrow(/完整保留真实自然入口/);
    const duplicate = dynamicNaturalSample();
    duplicate.source.skillSources[1]!.enabledRuleKeys.push(duplicate.source.skillSources[1]!.enabledRuleKeys[0]!);
    expect(() => scene(duplicate)).toThrow(/重复/);
    const level = dynamicNaturalSample();
    level.source.skillSources[1]!.skillLevel = 1;
    expect(() => scene(level)).toThrow(/等级与明确场景设置不一致/);
  });

  it('真实来源同时包含5A常驻与5B命中时，初始化与有期来源共用唯一挂载', () => {
    const snapshot = naturalSample();
    const configuration = snapshot.skillConfigurations[1]!;
    const stacking = dynamicConfiguration(dynamicNaturalSample()).effects[1]!;
    configuration.effects.push({ ...structuredClone(stacking), gameId: snapshot.gameId, skillKey: configuration.skill.skillKey });
    configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'on_hit',
      eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
      actions: [{ ...configuration.triggerRules[0]!.actions[0]!, detail: { effectKey: 'stacking' } }] });
    syncNaturalSources(snapshot);
    const { programs } = naturalPrograms(snapshot);
    const source = programs.find(row => row.origin.side === 'source')!.provider;
    expect(source.abilities!.map(row => row.abilityKey)).toEqual(['initialize', 'on_hit']);
    expect(source.abilities![0]!.listenerSpec!.operations![0]!.operation).toBe('apply_provider');
    expect(source.abilities![1]!.listenerSpec!.operations![0]!.ref).toBe('effect_stacking');
  });
});

const assembleSimulation = (...args: Parameters<typeof raw_assembleSimulation>): ReturnType<typeof raw_assembleSimulation> => { approveSnapshotFixture(args[0]); return raw_assembleSimulation(...args); };
const inspectSimulationSnapshot = (...args: Parameters<typeof raw_inspectSimulationSnapshot>): ReturnType<typeof raw_inspectSimulationSnapshot> => { approveSnapshotFixture(args[0]); return raw_inspectSimulationSnapshot(...args); };

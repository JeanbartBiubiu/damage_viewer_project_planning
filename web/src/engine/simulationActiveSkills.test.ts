import { describe, expect, it } from 'vitest';
import { preparedActiveSample, simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { inspectSimulationSnapshot, prepareSimulation } from './simulationAdapter';
import { skillActionRequest, type SkillActionInputs } from './skillActionRequest';
import { normalizeSimulationSelection, validateSimulationSnapshot } from '../services/simulationSnapshotClient';
import { assembleActiveSkills, simulationCastCostCandidates } from './simulationActiveSkills';
import { fixedValue, formulaValue } from '../types/numericValue';
import { naturalRuleKeys, plannedSkillRuleKeys } from './simulationSkillSourceDescription';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';
import { selectSimulationSkillSourceClosure } from './simulationSkillSourceClosure';
import type { SkillEffect } from '../types/skillEffect';
import { adaptHitProgram } from './hitAdapter';

const inputs: SkillActionInputs = { actions: [{ origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey: 'sample_active', skillLevel: 1,
  instructionKey: 'first_cast', atMs: 50, sortOrder: 0, targetSide: 'target', hitPreset: 'TARGET_HIT', phaseKind: 'INITIAL', parentInstructionKey: null }],
  durationMs: 200, recordTimeSeries: true, maxSkillActionRecords: 32, maxSkillUseRecords: 128, maxHealingRecords: 256 };

describe('6A完整单次主动装配', () => {
  it('配对空普攻与真实角色计划经快照校验，空普攻不要求主体', () => {
    const snapshot = simulationActiveSample();
    expect(normalizeSimulationSelection(snapshot.selection).basicAttackSkillKey).toBeNull();
    expect(validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection)).toBe(snapshot);
    const wrong = { ...snapshot.selection, basicAttackLevel: 1 };
    expect(() => normalizeSimulationSelection(wrong)).toThrow(/basicAttack/);
  });

  it('只绑定原过程成功完成和同来源命中，不造假普攻或第二时钟', async () => {
    const { snapshot, prepared } = preparedActiveSample();
    const original = structuredClone(snapshot);
    const run = await skillActionRequest(prepared, snapshot, inputs);
    expect(snapshot).toEqual(original);
    expect(prepared.basicAttackBinding).toBeNull();
    expect(prepared.compileRequest.rules.skillActionBindings![0]!.hitBindings[0]!.moment).toEqual({ momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null });
    expect(prepared.compileRequest.sharedProviders!.flatMap(provider => provider.abilities ?? [])
      .some(ability => ability.types?.includes('ability/basic_attack'))).toBe(false);
    expect(prepared.compileRequest.combatants.flatMap(actor => actor.providers).some(provider => provider.providerRef === 'selected_basic_attack')).toBe(false);
    for (const rule of prepared.compileRequest.rules.vampRules ?? []) expect(prepared.compileRequest.combatants[0]!.attributes[rule.sourceAttributeKey]).toBeDefined();
    for (const origin of prepared.operationOrigins) for (const path of origin.compiledPaths) {
      let node: unknown = prepared.compileRequest;
      for (const key of path.replace(/\[(\d+)\]/g, '.$1').split('.')) node = (node as Record<string, unknown>)?.[key];
      expect((node as { operation: string }).operation).toBe('damage');
    }
    expect(run.runRequest.driverPlan.entries).toEqual([]);
    expect(run.runRequest.driverPlan.basicAttack).toBeUndefined();
    expect(run.runRequest.driverPlan.skillActions).toHaveLength(1);
    expect(run.runRequest.driverPlan.skillActions![0]).toMatchObject({ firstAtMs: 50, action: 'INITIAL', parentInstructionKey: null });
    for (const field of ['skillUses', 'skillHitFacts', 'attackStartFacts', 'processCommandFacts'] as const) expect(run.runRequest[field]).toEqual([]);
    const missed = await skillActionRequest(prepared, snapshot, { ...inputs, actions: [{ ...inputs.actions[0]!, hitPreset: 'MISS' }] });
    expect(missed.runInputHash).not.toBe(run.runInputHash);
  });

  it('自身治疗条件在监听层冻结，开始过程不治疗，命中数组为空', async () => {
    const { snapshot, prepared } = preparedActiveSample(true);
    const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
    expect(binding.hitBindings).toEqual([]);
    const provider = prepared.compileRequest.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!;
    const listeners = provider.abilities!.filter(row => row.kind === 'passive_listener');
    expect(listeners).toHaveLength(2);
    expect(listeners.every(row => row.listenerSpec!.condition && row.listenerSpec!.operations!.every(operation => !operation.condition))).toBe(true);
    expect(provider.processes![0]!.momentOperations).toEqual([]);
    const run = await skillActionRequest(prepared, snapshot, { ...inputs, actions: [{ ...inputs.actions[0]!, targetSide: 'source', hitPreset: null }],
      maxSkillActionRecords: 0, maxSkillUseRecords: 0, maxHealingRecords: 0 });
    expect(run.runRequest.driverPlan.skillActions![0]!.hitBindings).toEqual([]);
    expect(run.runRequest.recordBudget!.maxHealingRecords).toBe(0);
    await expect(skillActionRequest(prepared, snapshot, { ...inputs, actions: [{ ...inputs.actions[0]!, targetSide: 'source' }] })).rejects.toThrow(/自身治疗/);
  });

  it.each(['disabled', 'unlearned', 'wrong_owner', 'wrong_level'] as const)('拒绝非法真实计划：%s', kind => {
    const snapshot = simulationActiveSample();
    const source = snapshot.source.skillSources[1]!;
    if (kind === 'disabled') source.enabled = false;
    if (kind === 'unlearned') source.skillLevel = 0;
    if (kind === 'wrong_owner') snapshot.selection.plannedSkills[0]!.origin.characterKey = 'actor_b';
    if (kind === 'wrong_level') snapshot.selection.plannedSkills[0]!.skillLevel = 2;
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow();
  });

  it('重复来源仍拒绝，背景普攻可选，6C复杂步骤不切成部分成功', () => {
    const snapshot = simulationActiveSample();
    snapshot.selection.plannedSkills.push(structuredClone(snapshot.selection.plannedSkills[0]!));
    expect(() => assembleActiveSkills(snapshot)).toThrow(/不同真实来源/);
    snapshot.selection.plannedSkills.pop();
    snapshot.selection.basicAttackSkillKey = 'sample_basic_attack';
    expect(assembleActiveSkills(snapshot).bindings).toHaveLength(1);
    snapshot.selection.basicAttackSkillKey = null;
    snapshot.skillConfigurations[1]!.processes[0]!.steps.push(structuredClone(snapshot.skillConfigurations[1]!.processes[0]!.steps[0]!));
    expect(() => assembleActiveSkills(snapshot)).toThrow(/步骤标识重复/);
  });

  it('只忽略逐项明确声明的成本引用，另一资源消费仍被严格拒绝', () => {
    const snapshot = simulationActiveSample(true);
    const config = snapshot.skillConfigurations[1]!;
    const process = config.processes[0]!;
    const effect = { ...structuredClone(config.effects[0]!), effectKey: 'cost', results: [
      { resultKey: 'consume', name: '明确成本', resultType: 'RESOURCE_CHANGE' as const, target: 'SOURCE' as const,
        description: null, sortOrder: 0, valueRule: { value: fixedValue(50), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
        detail: { attributeKey: 'mana', operation: 'CONSUME' as const }, lifecycleBehavior: null, spellShieldBlockScope: null }
    ] };
    config.effects.push(effect);
    process.effectBindings.push({ bindingKey: 'pay', effectKey: 'cost', moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, sortOrder: 0 });
    expect(() => assembleActiveSkills(snapshot)).toThrow(/资源改变/);
    const costs = simulationCastCostCandidates(snapshot);
    const active = assembleActiveSkills(snapshot, costs);
    expect(active.providers[0]!.processes![0]!.costs).toEqual([]);
    expect(active.ignoredCastCosts).toEqual(costs);
    expect(active.providers[0]!.processes![0]!.momentOperations).toEqual([]);
    process.effectBindings.push({ bindingKey: 'necessary_spend', effectKey: 'cost',
      moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null }, sortOrder: 1 });
    expect(() => assembleActiveSkills(snapshot, costs)).toThrow(/资源改变/);
    process.effectBindings.pop();
    effect.results.push({ ...structuredClone(effect.results[0]!), resultKey: 'necessary_consume' });
    expect(() => assembleActiveSkills(snapshot, costs)).toThrow(/资源改变/);
  });

  it('主动闭包保留实际产生护盾的BLOCKED消费、效果和数值依赖，不开启未计划重施兄弟', () => {
    const snapshot = simulationActiveSample();
    const configuration = snapshot.skillConfigurations[1]!;
    const original = configuration.effects[0]!;
    const guard: SkillEffect = { ...structuredClone(original), effectKey: 'guard', lifecycle: {
      durationValue: fixedValue(1000), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1), instanceScope: 'SOURCE',
      reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE',
      periodicIntervalValue: null, firstPeriodicExecution: null
    }, results: [{ resultKey: 'shield', name: '自身法盾', resultType: 'SPELL_SHIELD', target: 'SOURCE', description: null, sortOrder: 0,
      valueRule: null, detail: {}, lifecycleBehavior: null, spellShieldBlockScope: null }] };
    const consumer: SkillEffect = { ...structuredClone(original), effectKey: 'consume_guard', results: [
      { resultKey: 'heal', name: '格挡治疗', resultType: 'DIRECT_HEAL', target: 'SOURCE', description: null, sortOrder: 0,
        valueRule: { value: formulaValue('blocked_heal'), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
        detail: {}, lifecycleBehavior: null, spellShieldBlockScope: null },
      { resultKey: 'consume', name: '消费实际护盾', resultType: 'LIFECYCLE_OPERATION', target: 'SOURCE', description: null, sortOrder: 1,
        valueRule: null, detail: { operation: 'REMOVE', targetEffectKey: 'guard' }, lifecycleBehavior: null, spellShieldBlockScope: null }
    ] };
    configuration.effects.push(guard, consumer, { ...structuredClone(guard), effectKey: 'unplanned_guard' });
    configuration.parameters.push({ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, parameterKey: 'heal_amount',
      name: '格挡治疗', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 20, levelValues: null, description: null,
      sortOrder: 0, createdAt: '', updatedAt: '' });
    configuration.formulas.push({ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, formulaKey: 'blocked_heal',
      name: '格挡治疗', description: null, sortOrder: 0, createdAt: '', updatedAt: '', expression: { nodeType: 'PARAMETER', parameterKey: 'heal_amount' } });
    configuration.processes[0]!.effectBindings.push({ bindingKey: 'grant_guard', effectKey: 'guard',
      moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null }, sortOrder: 0 });
    const blocked = { ...structuredClone(configuration.triggerRules[1]!), ruleKey: 'consume_on_block',
      eventSource: { eventType: 'SPELL_SHIELD_BLOCKED' as const, detail: { shieldEffectKey: 'guard' } },
      actions: [{ actionKey: 'consume', name: '格挡消费', actionType: 'EXECUTE_EFFECT' as const, sortOrder: 0,
        targetContext: 'CURRENT_TARGET' as const, detail: { effectKey: 'consume_guard' }, runtimeInputBindings: [], resultModifiers: [] }] };
    configuration.triggerRules.push(blocked, { ...structuredClone(blocked), ruleKey: 'unplanned_block',
      eventSource: { eventType: 'SPELL_SHIELD_BLOCKED', detail: { shieldEffectKey: 'unplanned_guard' } } },
      { ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'unplanned_recast',
        eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: configuration.skill.skillKey, useKind: 'ACTIVE', castPhase: 'RECAST' } },
        actions: [{ ...structuredClone(blocked.actions[0]!), detail: { effectKey: 'unplanned_guard' } }] });
    const originalConfiguration = structuredClone(configuration);
    const roots = plannedSkillRuleKeys(configuration);
    expect(roots).not.toContain('consume_on_block');
    const closure = selectSimulationSkillSourceClosure(configuration, roots);
    expect(closure.configuration.triggerRules.map(rule => rule.ruleKey)).toContain('consume_on_block');
    expect(closure.configuration.effects.map(effect => effect.effectKey)).toContain('consume_guard');
    expect(closure.configuration.formulas.map(formula => formula.formulaKey)).toEqual(['blocked_heal']);
    expect(closure.configuration.parameters.map(parameter => parameter.parameterKey)).toEqual(['heal_amount']);
    expect(closure.excludedRuleKeys).toEqual(['unplanned_block', 'unplanned_recast']);
    expect(closure.configuration.effects.map(effect => effect.effectKey)).not.toContain('unplanned_guard');
    expect(configuration).toEqual(originalConfiguration);
    const hit = adaptHitProgram({ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, skillLevel: 1, characterLevel: 1,
      rules: closure.configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_HIT' || rule.eventSource.eventType === 'SPELL_SHIELD_BLOCKED'),
      effects: closure.configuration.effects, parameters: closure.configuration.parameters, formulas: closure.configuration.formulas,
      statuses: snapshot.catalogs.statuses, skillCategoryKeys: configuration.skill.skillCategoryKeys, vampRules: snapshot.catalogs.vampRules.rules,
      identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } } });
    expect(hit.typeEntries).toContainEqual({ key: 'provider/spell_shield', domain: 'provider' });
    expect(hit.typeEntries).toContainEqual({ key: 'event/spell_shield_blocked', domain: 'event' });
    const listener = hit.providers.find(provider => provider.types?.includes('provider/spell_shield'))!.listeners![0]!;
    expect(listener.listenerKey).toBe('consume_on_block');
    expect(listener.operations!.map(operation => operation.operation)).toEqual(['heal', 'expire_provider']);
    configuration.processes[0]!.effectBindings = [];
    const unreachable = selectSimulationSkillSourceClosure(configuration, roots);
    expect(unreachable.configuration.triggerRules.map(rule => rule.ruleKey)).not.toContain('consume_on_block');
  });

  it('没有背景普攻时不种普攻根，计划成功使用与实际命中根仍保留', () => {
    const snapshot = simulationActiveSample();
    expect(naturalRuleKeys(snapshot, snapshot.skillConfigurations[0]!, 'source')).toEqual([]);
    const natural = structuredClone(snapshot.skillConfigurations[0]!);
    natural.skill.skillKey = 'use_listener';
    natural.triggerRules[0]!.eventSource = { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'sample_active', useKind: 'ACTIVE', castPhase: 'INITIAL' } };
    snapshot.skillConfigurations.push(natural);
    snapshot.source.skillSources.push({ ...snapshot.source.skillSources[1]!, skillKey: 'use_listener' });
    expect(naturalRuleKeys(snapshot, natural, 'source')).toEqual(['begin_attack']);
  });

  it('保留普攻原模式，尝试时刻不改变编译摘要而改变运行摘要', async () => {
    const normal = simulationSample();
    expect(inspectSimulationSnapshot(normal).requirements.length).toBeGreaterThan(0);
    const { snapshot, prepared } = preparedActiveSample();
    const original = await skillActionRequest(prepared, snapshot, inputs);
    const changed = await skillActionRequest(prepared, snapshot, { ...inputs, actions: [{ ...inputs.actions[0]!, atMs: 51 }] });
    expect(changed.runRequest.rulesHash).toBe(original.runRequest.rulesHash);
    expect(changed.runInputHash).not.toBe(original.runInputHash);
    await expect(skillActionRequest(prepared, snapshot, { ...inputs, actions: [{ ...inputs.actions[0]!, atMs: 201 }] })).rejects.toThrow(/atMs/);
    await expect(skillActionRequest(prepared, snapshot, { ...inputs, maxSkillUseRecords: 10001 })).rejects.toThrow(/maxSkillUseRecords/);
    const result = await prepareSimulation(snapshot, prepared.attributeInputs, prepared.initialHealth);
    expect(result.compileRequest.rulesHash).not.toBe('pending');
  });
});

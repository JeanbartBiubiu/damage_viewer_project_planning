import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CompileRequest, RunRequest } from '../types/genericEngine';
import type { SkillEffect } from '../types/skillEffect';
import { fixedValue } from '../types/numericValue';
import { adaptProcessProgram, withProcessProgram, type AuthoredProcessProgram } from './processAdapter';
import { compileLinkedShieldEffect } from './shieldEffectAdapter';
import { createNumericCompileState } from './numericAdapter';
import { TinyGoV2Bridge, TinyGoV2InvocationError, OUTBOX_GENERIC_DONE } from '../../tests/fixtures/authorizedBridge';
import { parseCompileResult, parseDoneResult, parseEngineError, parseReleaseResult } from './genericEngineClient';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { triggeredEquipmentSimulationSample } from '../../tests/fixtures/simulationTriggeredEquipment';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { assembleActiveSkills } from './simulationActiveSkills';
import { assembleTriggeredEquipment } from './simulation/sources/equipment';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';

function program(skillKey = 'ward_alpha', amount = 100, duration = 3000): AuthoredProcessProgram {
  const moment = { momentType: 'PROCESS_START' as const, stepKey: null, failureReason: null };
  const effect: SkillEffect = {
    gameId: 'lol', skillKey, effectKey: 'guard', name: '自护盾', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
    lifecycle: { durationValue: fixedValue(duration), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1), instanceScope: 'SOURCE',
      reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null,
      firstPeriodicExecution: null, endWhenShieldEndsResultKey: 'barrier' },
    results: [{ resultKey: 'barrier', name: '数值盾', description: null, sortOrder: 0, resultType: 'NORMAL_SHIELD', target: 'SOURCE', spellShieldBlockScope: null,
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null },
      valueRule: { value: fixedValue(amount), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: { absorbedDamageTypeKey: null, decayMode: 'NONE' } }]
  };
  return { gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1, effects: [effect], castCosts: [],
    internalStates: [{ gameId: 'lol', skillKey, stateKey: 'quota', name: '当前目标额度', scope: 'TARGET', stateType: 'COUNTER', description: null,
      sortOrder: 0, createdAt: '', updatedAt: '', detail: { initialValue: fixedValue(0), maxValue: fixedValue(1), durationValue: null } }],
    process: { gameId: 'lol', skillKey, processKey: 'cast', name: '施放', activationType: 'ACTIVE', description: null, sortOrder: 0,
      cooldown: null, steps: [{ stepKey: 'now', name: '即时', stepType: 'IMMEDIATE', detail: {}, description: null, sortOrder: 0, occupiesAction: false }],
      effectBindings: [{ bindingKey: 'shield', effectKey: 'guard', moment, sortOrder: 0 }],
      stateOperations: [{ operationKey: 'reset', name: '重施重置', stateSkillKey: skillKey, stateKey: 'quota', moment, sortOrder: 1, operation: 'SET', value: fixedValue(0), optionKey: null }],
      createdAt: '', updatedAt: '' },
    rules: [{ ruleKey: 'cast_self', name: '明确自施', description: null, sortOrder: 0,
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
      conditionGroups: [{ groupKey: 'self', name: '明确目标', sortOrder: 0, conditions: [{ conditionKey: 'self', conditionType: 'EXPLICIT_TARGET_IS_SOURCE', detail: {}, sortOrder: 0 }] }],
      actions: [{ actionKey: 'start', name: '开始', sortOrder: 0, actionType: 'START_PROCESS', detail: { processKey: 'cast' }, targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }],
      oncePerUse: null, perTargetCooldown: null, maxTriggersPerProcess: null }]
  };
}
function request(): CompileRequest {
  const hp = { base: 1000, current: 1000, max: 1000, resolved: 1000 };
  return { schemaVersion: 'generic-p0', schemaHash: 'shield-host-test', rulesHash: 'before', typeCatalog: { types: [], relations: [] }, rules: {},
    combatants: ['source', 'target'].map(key => ({ key, attributes: { hp }, resources: {}, providers: [] })) };
}

describe('普通盾过程与作者状态', () => {
  it.each([['ward_alpha', 100, 3000], ['aegis_beta', 175, 2200]] as const)('%s 只生成一次盾，与原技能目标状态重置同一时点', (skillKey, amount, duration) => {
    const authored = program(skillKey, amount, duration);
    const before = structuredClone(authored);
    const result = adaptProcessProgram(authored);
    expect(authored).toEqual(before);
    expect(result.provider.abilities).toHaveLength(1);
    expect(result.provider.abilities[0]!.processControl).toMatchObject({ action: 'INITIAL', requireExplicitSelfTarget: true });
    expect(result.provider.initialStateSchema).toMatchObject({ quota: { defaultValue: 0, maxValue: 1 } });
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!.initialStateSchema).toBeUndefined();
    const groups = result.provider.processes[0]!.momentOperations;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.operations).toEqual([
      { operation: 'shield', target: 'self', amount: { op: 'const', value: amount }, shieldDurationMs: { op: 'const', value: duration },
        shieldRef: `shield/process_${skillKey}/${skillKey}/guard/barrier`, shieldLifecycleProviderDefinitionRef: `shield/process_${skillKey}/${skillKey}/guard`, ref: `skills.${skillKey}.effects.guard.results.barrier` },
      { operation: 'state_change', target: 'self', ref: 'quota', valuePolicy: 'set', amount: { op: 'const', value: 0 }, types: ['state_scope/provider_target'] }
    ]);
    const compiled = withProcessProgram(request(), { processProviderKey: 'selected', authored }, { rulesHash: 'linked-shield-host' });
    expect(compiled.sharedProviders).toHaveLength(2);
    expect(compiled.combatants[0]!.providers).toEqual([{ providerRef: 'selected', definitionRef: 'process_source_selected' }]);
  });

  it.each(['missing', 'multi', 'target', 'keep', 'decay', 'specific', 'periodic', 'instant', 'mixed'] as const)('拒绝未接入组合 %s', variant => {
    const authored = program();
    const effect = authored.effects[0]!;
    const shield = effect.results[0]!;
    if (variant === 'missing') effect.lifecycle!.endWhenShieldEndsResultKey = 'absent';
    if (variant === 'multi') effect.lifecycle!.maxStacksValue = fixedValue(2);
    if (variant === 'target') effect.lifecycle!.instanceScope = 'TARGET';
    if (variant === 'keep') shield.lifecycleBehavior!.reapplicationValueMode = 'KEEP';
    if (variant === 'decay' && shield.resultType === 'NORMAL_SHIELD') shield.detail.decayMode = 'LINEAR';
    if (variant === 'specific' && shield.resultType === 'NORMAL_SHIELD') shield.detail.absorbedDamageTypeKey = 'magic';
    if (variant === 'periodic') effect.lifecycle!.periodicIntervalValue = fixedValue(100);
    if (variant === 'instant') shield.lifecycleBehavior = null;
    if (variant === 'mixed') effect.results.push({ resultKey: 'extra', name: '额外即时治疗', description: null, sortOrder: 1, resultType: 'DIRECT_HEAL', target: 'SOURCE',
      spellShieldBlockScope: null, lifecycleBehavior: null, valueRule: shield.valueRule, detail: {} });
    expect(() => adaptProcessProgram(authored)).toThrow(/guard/);
  });

  it('真正无期显式关联不生成虚构到期，不能丢弃有限期', () => {
    const authored = program();
    authored.effects[0]!.lifecycle = { ...authored.effects[0]!.lifecycle!, expiryMode: 'EXPLICIT_ONLY', durationValue: null, reapplicationDurationMode: null };
    expect(adaptProcessProgram(authored).providers[0]!.lifecycle!.durationMs).toBeUndefined();
    authored.effects[0]!.lifecycle!.durationValue = fixedValue(100);
    expect(() => adaptProcessProgram(authored)).toThrow(/真正无期限/);
  });

  it('同父效果的持续属性随同一关联 provider，金额精度保留', () => {
    const authored = program();
    const effect = authored.effects[0]!;
    effect.results.push({ ...effect.results[0]!, resultKey: 'speed', resultType: 'ATTRIBUTE_CHANGE', valueRule: { value: fixedValue(.20000000298023224), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
      detail: { attributeKey: 'move_speed', operation: 'INCREASE', modifierZoneKey: 'speed_bonus' } });
    const state = createNumericCompileState({ ...authored, formulaNamespace: 'shield-proof', bindParameters: true, allowAttributeReads: true, runtimeInputMessage: '不能猜输入' });
    const compiled = compileLinkedShieldEffect(effect, state, [{ gameId: 'lol', modifierZoneKey: 'speed_bonus', name: '移速', description: null, domain: 'ATTRIBUTE', calculationMode: 'RATIO_ADD', applicationStage: 'ATTRIBUTE_PERCENT', status: 'ENABLED', sortOrder: 0, createdAt: '', updatedAt: '' }]);
    expect(compiled.provider.modifiers).toHaveLength(1);
    expect(compiled.provider.modifiers![0]!.value).toEqual({ op: 'const', value: .20000000298023224 });
    expect(compiled.operation.operation).toBe('shield');
  });

  it('跨技能写入、缺失状态、重复自施条件都拒绝', () => {
    const authored = program();
    authored.process.stateOperations[0]!.stateSkillKey = 'foreign';
    expect(() => adaptProcessProgram(authored)).toThrow(/不能跨技能/);
    authored.process.stateOperations[0]!.stateSkillKey = authored.skillKey;
    authored.internalStates = [];
    expect(() => adaptProcessProgram(authored)).toThrow(/已声明状态/);
    authored.internalStates = program().internalStates;
    authored.rules[0]!.conditionGroups[0]!.conditions.push(structuredClone(authored.rules[0]!.conditionGroups[0]!.conditions[0]!));
    expect(() => adaptProcessProgram(authored)).toThrow(/条件标识重复/);
  });

  it('真实计划装配保留技能父状态、静态盾身份及作者来源映射', () => {
    const snapshot = simulationActiveSample();
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
    const authored = program(configuration.skill.skillKey);
    authored.process.gameId = snapshot.gameId;
    for (const effect of authored.effects) effect.gameId = snapshot.gameId;
    for (const state of authored.internalStates!) state.gameId = snapshot.gameId;
    configuration.parameters = []; configuration.formulas = [];
    configuration.effects = [...authored.effects]; configuration.triggerRules = [...authored.rules];
    configuration.internalStates = [...authored.internalStates!]; configuration.processes = [authored.process];
    syncSimulationSkillSources(snapshot);
    approveSnapshotFixture(snapshot);
    const assembly = assembleActiveSkills(snapshot);
    const binding = assembly.bindings[0]!;
    const parent = assembly.providers.find(row => row.providerKey === binding.providerDefinitionRef)!;
    expect(parent.initialStateSchema!.quota).toMatchObject({ defaultValue: 0 });
    const operations = parent.processes![0]!.momentOperations[0]!.operations;
    expect(operations.map(row => row.operation)).toEqual(['shield', 'state_change']);
    expect(operations[0]!.shieldRef).toBe(`shield/${binding.providerDefinitionRef}/sample_active/guard/barrier`);
    expect(assembly.operationOrigins).toContainEqual(expect.objectContaining({ skillKey: 'sample_active', effectKey: 'guard', resultKey: 'barrier', providerDefinitionRef: binding.providerDefinitionRef }));
    expect(assembly.providers.filter(row => row.linkedShieldDefinitionRef)).toHaveLength(1);
  });

  it('自然来源存在条件读取精确关联盾，不造影子计数或施盾操作', () => {
    const snapshot = triggeredEquipmentSimulationSample();
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'item_1043_passive')!;
    const authored = program(configuration.skill.skillKey);
    authored.effects[0]!.gameId = snapshot.gameId;
    configuration.effects.push(authored.effects[0]!);
    configuration.triggerRules = [{ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'shield_present',
      conditionGroups: [{ groupKey: 'shield', name: '盾存在', sortOrder: 0, conditions: [{ conditionKey: 'present', conditionType: 'LIFECYCLE_CHECK', sortOrder: 0,
        detail: { effectSkillKey: configuration.skill.skillKey, effectKey: 'guard', subject: null, checkKind: 'PRESENT', comparator: null, comparisonValue: null } }] }] }];
    syncSimulationSkillSources(snapshot); approveSnapshotFixture(snapshot);
    const assembly = assembleTriggeredEquipment(snapshot);
    const parent = assembly.providers.find(row => row.skillKey === configuration.skill.skillKey && row.abilities?.length)!;
    expect(parent.initialStateSchema).toBeUndefined();
    const linked = assembly.providers.find(row => row.linkedShieldDefinitionRef)!;
    expect(parent.abilities![0]!.listenerSpec!.condition).toEqual({ op: 'gt', args: [{ op: 'read', path: `provider.linked_shield[${linked.linkedShieldDefinitionRef}].present` }, { op: 'const', value: 0 }] });
    expect(parent.abilities![0]!.listenerSpec!.operations!.map(row => row.operation)).toEqual(['damage']);
  });

  it('完整技能的主动自施与被动受伤过程各走自己的闭包，共用原技能状态', () => {
    const snapshot = simulationActiveSample();
    snapshot.selection.basicAttackSkillKey = snapshot.skillConfigurations[0]!.skill.skillKey;
    snapshot.selection.basicAttackLevel = 1;
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
    const authored = program(configuration.skill.skillKey);
    authored.process.gameId = snapshot.gameId;
    authored.effects[0]!.gameId = snapshot.gameId;
    authored.internalStates![0]!.gameId = snapshot.gameId;
    const reaction = { ...structuredClone(authored.process), processKey: 'retaliate', activationType: 'PASSIVE' as const, effectBindings: [],
      stateOperations: [{ ...structuredClone(authored.process.stateOperations[0]!), operationKey: 'consume', value: fixedValue(1) }] };
    configuration.parameters = []; configuration.formulas = [];
    configuration.effects = [...authored.effects]; configuration.internalStates = [...authored.internalStates!];
    configuration.processes = [reaction, authored.process];
    configuration.triggerRules = [...authored.rules, { ...structuredClone(authored.rules[0]!), ruleKey: 'received',
      eventSource: { eventType: 'DAMAGE_TAKEN', detail: { sourceSkillKey: null, damageTypeKey: null, deliveryKind: 'ANY', originKind: 'DIRECT' } },
      conditionGroups: [{ groupKey: 'current_shield', name: '当前真实盾与计数', sortOrder: 0, conditions: [
        { conditionKey: 'present', conditionType: 'LIFECYCLE_CHECK', sortOrder: 0,
          detail: { effectSkillKey: configuration.skill.skillKey, effectKey: 'guard', subject: null, checkKind: 'PRESENT', comparator: null, comparisonValue: null } },
        { conditionKey: 'quota', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 1,
          detail: { stateSkillKey: configuration.skill.skillKey, stateKey: 'quota', valueKind: 'VALUE', optionKey: null, expectedBoolean: null, comparator: 'EQ', comparisonValue: fixedValue(0) } }
      ] }], actions: [{ actionKey: 'retaliate', name: '受伤后消费', actionType: 'START_PROCESS', sortOrder: 0, targetContext: 'EVENT_SOURCE',
        detail: { processKey: 'retaliate' }, runtimeInputBindings: [], resultModifiers: [] }] }];
    // 明确由目标的受击反击产生来伤，主动盾来源才能收到真实受伤事件。
    const basic = snapshot.skillConfigurations[0]!, incomingKey = 'target_reaction';
    const incomingDamage = structuredClone(basic.effects[1]!.results[0]!);
    if (incomingDamage.resultType !== 'DAMAGE') throw new Error('合成来伤需要伤害结果');
    incomingDamage.detail.deliveryKind = 'SKILL'; incomingDamage.detail.critical = { mode: 'DISALLOWED', multiplierValue: null };
    incomingDamage.valueRule!.value = fixedValue(7);
    snapshot.skillConfigurations.push({ ...structuredClone(basic),
      skill: { ...basic.skill, skillKey: incomingKey, skillCategoryKeys: configuration.skill.skillCategoryKeys }, parameters: [], formulas: [], internalStates: [],
      effects: [{ ...structuredClone(basic.effects[1]!), skillKey: incomingKey, effectKey: 'incoming', results: [incomingDamage] }],
      processes: [{ ...structuredClone(authored.process), skillKey: incomingKey, processKey: 'incoming', activationType: 'PASSIVE',
        stateOperations: [], effectBindings: [{ bindingKey: 'damage', effectKey: 'incoming', sortOrder: 0,
          moment: { momentType: 'STEP_EXECUTION', stepKey: 'now', failureReason: null } }] }],
      triggerRules: [{ ...structuredClone(authored.rules[0]!), ruleKey: 'on_received', conditionGroups: [],
        eventSource: { eventType: 'BASIC_ATTACK_RECEIVED', detail: {} },
        actions: [{ actionKey: 'retaliate', name: '真实来伤', sortOrder: 0, actionType: 'START_PROCESS',
          detail: { processKey: 'incoming' }, targetContext: 'EVENT_SOURCE', runtimeInputBindings: [], resultModifiers: [] }] }] });
    snapshot.target.attachedSkills.push({ ...snapshot.target.attachedSkills[0]!, skillKey: incomingKey, skillName: '合成受击反击' });
    snapshot.selection.targetSkillSettings.push({ origin: { kind: 'CHARACTER', characterKey: snapshot.target.character.characterKey },
      skillKey: incomingKey, enabled: true, skillLevel: 1 });
    syncSimulationSkillSources(snapshot); approveSnapshotFixture(snapshot);
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const requirement of inspectSimulationSnapshot(snapshot).requirements) if (requirement.storedValue === undefined) inputs[requirement.side][requirement.attribute.attributeKey] = 0;
    const prepared = assembleSimulation(snapshot, inputs, { source: 250, target: 500 });
    const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
    const parent = prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === binding.providerDefinitionRef)!;
    expect(configuration.processes.map(process => process.processKey)).toEqual(['retaliate', 'cast']);
    expect(parent.processes!.map(process => process.processKey)).toEqual(['cast']);
    expect(parent.initialStateSchema!.quota).toMatchObject({ defaultValue: 0, maxValue: 1 });
    const receiver = parent.abilities!.find(ability => ability.listenerSpec?.listenerKey === 'received')!.listenerSpec!;
    expect(receiver.eventMatcher.all).toContain('event/damage_taken');
    expect(JSON.stringify(receiver.condition)).toContain('provider.linked_shield[');
    expect(receiver.operations).toEqual([expect.objectContaining({ operation: 'state_change', ref: 'quota', amount: { op: 'const', value: 1 } })]);
    expect(parent.processes![0]!.momentOperations[0]!.operations.map(operation => operation.operation)).toEqual(['shield', 'state_change']);
  });

  it.each(['ward_alpha', 'aegis_beta'])('%s 的真实 Wasm 编译、运行、释放核对盾关联和自施门槛', async skillKey => {
    const input = withProcessProgram(request(), { processProviderKey: 'selected', authored: program(skillKey) }, { rulesHash: `compile-${skillKey}` });
    const bytes = readFileSync(process.env.PHASE3B_WASM_PATH || new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url));
    const bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
    const result = parseCompileResult(bridge.compile(input));
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    if (!result.sessionId) throw new Error('真实编译缺少会话');
    const runRequest = (target: string): RunRequest => ({ sessionId: result.sessionId!, expectedRulesHash: input.rulesHash, schemaVersion: input.schemaVersion,
      schemaHash: input.schemaHash, rulesHash: input.rulesHash, initialSnapshot: simulationInitialSnapshot(input),
      driverPlan: { conditionRecheckIntervalMs: 100, entries: [{ entryKey: 'cast', abilityRef: 'source.provider[selected].ability[start]', source: 'source', target, firstAtMs: 0 }] },
      skillUses: [{ useKey: 'one_cast', source: 'source', skillKey, historyState: 'complete' }], processCommandFacts: [{ driverEntryKey: 'cast', useRef: 'one_cast' }],
      stopPolicy: { durationMs: 1, stopOnTargetDeath: false, stopWhenNoEvents: false }, sampling: { disabled: true, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 10 } });
    const baseline = new Map<string, ReturnType<typeof parseDoneResult>>();
    try {
      for (const target of ['source', 'target']) {
        const done = parseDoneResult(bridge.run(runRequest(target)));
        baseline.set(target, done);
        expect(done.ok, JSON.stringify(done.errors)).toBe(true);
        const actor = done.finalSnapshot.combatants.find(row => row.key === 'source')!;
        if (target === 'source') {
          expect(actor.shields).toHaveLength(1);
          const shield = actor.shields[0] as { definitionRef: string; lifecycleProviderRef: string; remaining: number };
          expect(shield).toMatchObject({ definitionRef: `shield/process_source_selected/${skillKey}/guard/barrier`, remaining: 100 });
          expect(shield.lifecycleProviderRef).toBeTruthy();
          expect(actor.providers.find(row => row.providerRef === shield.lifecycleProviderRef)).toMatchObject({ definitionRef: `shield/process_source_selected/${skillKey}/guard`, owner: 'source', source: 'source' });
        } else {
          expect(actor.shields).toEqual([]);
          expect(actor.providers).toHaveLength(1);
          expect(done.finalSnapshot.processInstances).toEqual([]);
        }
      }
      for (const target of ['', 'absent']) {
        let error: unknown;
        try { bridge.run(runRequest(target)); } catch (caught) { error = caught; }
        expect(error).toBeInstanceOf(TinyGoV2InvocationError);
        if (!(error instanceof TinyGoV2InvocationError)) throw new Error('非法目标必须返回真实运行错误');
        expect(error.fnName).toBe('engine_run');
        expect(parseEngineError(error.frames)).toMatchObject({ ok: false, phase: 'run', code: 'runtime_invariant_failed',
          path: 'driverPlan.entries[cast]', message: 'process driver must identify its real owner and target',
          schemaHash: input.schemaHash, rulesHash: input.rulesHash, sessionId: result.sessionId });
        expect(error.frames.some(frame => frame.kind === OUTBOX_GENERIC_DONE)).toBe(false);
        for (const validTarget of ['target', 'source']) {
          const next = parseDoneResult(bridge.run(runRequest(validTarget)));
          expect(next.finalSnapshot).toEqual(baseline.get(validTarget)!.finalSnapshot);
          expect(next.summary).toEqual(baseline.get(validTarget)!.summary);
        }
      }
    } finally { expect(parseReleaseResult(bridge.releaseSession(result.sessionId, input.rulesHash)).released).toBe(true); }
  });
});

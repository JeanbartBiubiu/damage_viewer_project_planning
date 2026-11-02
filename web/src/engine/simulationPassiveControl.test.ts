import { describe, expect, it } from 'vitest';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { SkillProcess } from '../types/skillProcess';
import { fixedValue } from '../types/numericValue';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { permanentModifier, type PermanentResultContext } from './simulationPermanentResults';
import { naturalRuleKeys } from './simulation/sources/description';
import { readFileSync } from 'node:fs';
import { TinyGoV2Bridge } from './tinygoV2Bridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';
import { skillActionRequest } from './skillActionRequest';
import { assessSkillActionResult } from './skillActionResult';

function scene(passiveKey = 'charged_alpha', stateKey = 'stacks', statusKey = 'lock_alpha', initial = 4, basic = false) {
  const snapshot = simulationActiveSample();
  if (basic) {
    snapshot.selection.basicAttackSkillKey = snapshot.skillConfigurations[0]!.skill.skillKey;
    snapshot.selection.basicAttackLevel = 1;
  }
  const active = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
  active.effects[0]!.results[0]!.spellShieldBlockScope = 'SKILL';
  const configuration: SkillConfiguration = { ...structuredClone(active), skill: { ...active.skill, skillKey: passiveKey, name: passiveKey, skillCategoryKeys: ['passive'] },
    parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] };
  configuration.internalStates.push({ gameId: snapshot.gameId, skillKey: passiveKey, stateKey, stateType: 'COUNTER', scope: 'SKILL', name: stateKey, description: null,
    sortOrder: 0, createdAt: '', updatedAt: '', detail: { initialValue: fixedValue(initial), maxValue: fixedValue(4), durationValue: null } });
  const process = (processKey: string, consume: boolean): SkillProcess => ({ gameId: snapshot.gameId, skillKey: passiveKey, processKey, name: processKey,
    activationType: 'PASSIVE', description: null, sortOrder: consume ? 0 : 1, createdAt: '', updatedAt: '', cooldown: null,
    steps: [{ stepKey: 'now', name: '即时状态', stepType: 'IMMEDIATE', detail: {}, occupiesAction: false, sortOrder: 0, description: null }], effectBindings: [],
    stateOperations: [{ operationKey: 'write', name: '状态操作', stateSkillKey: passiveKey, stateKey, operation: consume ? 'SET' : 'INCREASE', value: fixedValue(consume ? 0 : 1), optionKey: null,
      sortOrder: 0, moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } }] });
  configuration.processes.push(process('consume', true), process('charge', false));
  configuration.effects.push({ gameId: snapshot.gameId, skillKey: passiveKey, effectKey: 'control', name: '原命中控制', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
    lifecycle: { instanceScope: 'SOURCE_TARGET', maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1), durationValue: fixedValue(1250), reapplicationStackMode: 'KEEP',
      reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null, firstPeriodicExecution: null },
    results: [{ resultKey: 'disable', name: '控制', resultType: 'STATUS_OPERATION', target: 'TARGET', description: null, sortOrder: 0, valueRule: null, spellShieldBlockScope: 'RESULT',
      detail: { statusKey, operation: 'APPLY' }, lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: null, stackValueMode: null, reapplicationValueMode: null, periodicExecutionMode: null } }] });
  const rule = (full: boolean): SkillTriggerRuleDetail => ({ ruleKey: full ? 'full' : 'charge', name: '条件冻结', description: null, sortOrder: full ? 0 : 1,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'sample_active' } },
    conditionGroups: [{ groupKey: 'counter', name: '原被动状态', sortOrder: 0, conditions: [{ conditionKey: 'check', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 0,
      detail: { stateSkillKey: passiveKey, stateKey, valueKind: 'VALUE', comparator: full ? 'EQ' : 'LT', comparisonValue: fixedValue(4), optionKey: null, expectedBoolean: null } },
      { conditionKey: 'enemy', conditionType: 'SKILL_HIT_TARGET_IS_ENEMY', sortOrder: 1, detail: {} }] }],
    actions: [...(full ? [{ actionKey: 'control', name: '控制', actionType: 'EXECUTE_EFFECT' as const, sortOrder: 0, targetContext: 'CURRENT_TARGET' as const,
      detail: { effectKey: 'control' }, runtimeInputBindings: [], resultModifiers: [] }] : []),
      { actionKey: 'write', name: '处理状态', actionType: 'START_PROCESS', sortOrder: 1, targetContext: 'CURRENT_TARGET', detail: { processKey: full ? 'consume' : 'charge' }, runtimeInputBindings: [], resultModifiers: [] }],
    oncePerUse: null, perTargetCooldown: null, maxTriggersPerProcess: null });
  configuration.triggerRules.push(rule(true), rule(false));
  snapshot.skillConfigurations.push(configuration);
  snapshot.catalogs.statuses.push({ gameId: snapshot.gameId, statusKey, statusKind: 'STUN', name: '合成控制', status: 'ENABLED', description: null, createdAt: '', updatedAt: '' });
  snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'passive', name: '被动' });
  const origin = { kind: 'CHARACTER' as const, characterKey: snapshot.selection.sourceCharacterKey };
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[0]!, skillKey: passiveKey, skillName: passiveKey });
  snapshot.source.skillSources.push({ ...snapshot.source.skillSources[1]!, origin, skillKey: passiveKey, skillName: passiveKey, skillLevel: 1 });
  snapshot.selection.sourceSkillSettings.push({ origin, skillKey: passiveKey, enabled: true, skillLevel: 1 });
  syncSimulationSkillSources(snapshot);
  const source = snapshot.source.skillSources.find(row => row.skillKey === passiveKey)!;
  source.enabledRuleKeys = naturalRuleKeys(snapshot, configuration, 'source');
  source.inactiveReason = null;
  return { snapshot, configuration };
}
function assemble(snapshot: ReturnType<typeof scene>['snapshot']) {
  approveSnapshotFixture(snapshot);
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const requirement of inspectSimulationSnapshot(snapshot).requirements) if (requirement.storedValue === undefined) inputs[requirement.side][requirement.attribute.attributeKey] = 0;
  return assembleSimulation(snapshot, inputs, { source: 250, target: 500 });
}

describe('自然技能控制候选与原使用', () => {
  it('强化待击没有独立技能命中事实，拒绝将该事件被动控制贡献偷渡到负载', () => {
    const { snapshot } = scene('charged_window', 'stacks', 'lock_window', 4, true);
    const active = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
    active.triggerRules = active.triggerRules.filter(row => row.eventSource.eventType !== 'SKILL_HIT');
    const process = active.processes[0]!;
    process.steps = [{ stepKey: 'wait', stepType: 'EMPOWERED_BASIC_ATTACK', detail: { windowValue: fixedValue(1500), consumeMoment: 'ATTACK_HIT' },
      occupiesAction: false, sortOrder: 0, name: '待击', description: null }];
    process.effectBindings = [{ bindingKey: 'hit', effectKey: active.effects[0]!.effectKey, sortOrder: 0,
      moment: { momentType: 'STEP_EXECUTION', stepKey: 'wait', failureReason: null } }];
    syncSimulationSkillSources(snapshot);
    const passive = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'charged_window')!;
    const source = snapshot.source.skillSources.find(row => row.skillKey === passive.skill.skillKey)!;
    source.enabledRuleKeys = naturalRuleKeys(snapshot, passive, 'source'); source.inactiveReason = null;
    expect(() => assemble(snapshot)).toThrow(/强化待击不发布独立技能命中/);
  });
  it.each([['charged_alpha', 'stacks', 'lock_alpha'], ['ready_beta', 'charges', 'lock_beta']] as const)('%s 只附加原命中候选，保留被动自身监听与状态', (skillKey, stateKey, statusKey) => {
    const { snapshot } = scene(skillKey, stateKey, statusKey);
    const original = structuredClone(snapshot);
    const result = assemble(snapshot);
    expect(snapshot).toEqual(original);
    const providers = result.compileRequest.sharedProviders!;
    const passive = providers.find(provider => provider.skillKey === skillKey && provider.initialStateSchema)!;
    const binding = result.compileRequest.rules.skillActionBindings![0]!;
    const active = providers.find(provider => provider.providerKey === binding.providerDefinitionRef)!;
    const resolutions = active.abilities!.flatMap(ability => ability.operations ?? []).filter(operation => operation.operation === 'resolve_skill_hit');
    expect(resolutions).toHaveLength(1);
    const candidates = resolutions[0]!.skillHit!.candidates;
    expect(candidates).toHaveLength(2);
    const control = candidates.find(row => row.semantic.resultType === 'STATUS_OPERATION')!;
    expect(control.spellShieldBlockScope).toBe('RESULT');
    expect(control.semantic.statusKey).toBe(statusKey);
    const mount = result.compileRequest.combatants[0]!.providers.find(row => row.definitionRef === passive.providerKey)!;
    expect(control.participationProviderRef).toBe(mount.providerRef);
    expect(control.participationCondition).toEqual({ op: 'min', args: [
      { op: 'eq', args: [{ op: 'read', path: `provider.state.${stateKey}` }, { op: 'const', value: 4 }] }, { op: 'const', value: 1 }
    ] });
    expect(passive.abilities!.flatMap(ability => ability.listenerSpec?.operations ?? []).map(operation => operation.operation)).toEqual(['state_change', 'state_change']);
    expect(result.operationOrigins).toContainEqual(expect.objectContaining({ skillKey, effectKey: 'control', resultKey: 'disable', abilityRef: binding.hitBindings[0]!.hitAbilityRef }));
  });

  it('控制与其它结果混装或绕开技能覆盖时拒绝', () => {
    const { snapshot, configuration } = scene();
    configuration.effects[0]!.results[0]!.spellShieldBlockScope = 'SKILL';
    expect(() => assemble(snapshot)).toThrow(/原技能覆盖/);
  });

  it('敌方命中条件不能用于非命中事件或忽略未知字段、错误来源身份', () => {
    const wrongEvent = scene();
    wrongEvent.configuration.triggerRules.forEach(rule => {
      rule.eventSource = { eventType: 'PROCESS_RESOLVED', detail: { sourceSkillKey: 'sample_active', processKey: 'cast' } };
    });
    wrongEvent.snapshot.source.skillSources.find(row => row.skillKey === wrongEvent.configuration.skill.skillKey)!.enabledRuleKeys =
      naturalRuleKeys(wrongEvent.snapshot, wrongEvent.configuration, 'source');
    expect(() => assemble(wrongEvent.snapshot)).toThrow(/敌方命中检查/);
    const extra = scene();
    const enemy = extra.configuration.triggerRules[0]!.conditionGroups[0]!.conditions[1]!;
    (enemy.detail as Record<string, unknown>).ignore = true;
    expect(() => assemble(extra.snapshot)).toThrow(/未接入的字段/);
    const owner = scene();
    owner.snapshot.selection.sourceCharacterKey = 'other_identity';
    expect(() => assemble(owner.snapshot)).toThrow(/真实来源快照归属不一致/);
  });

  it('过程终结后事实按真实技能与过程匹配，只读本次接触数', () => {
    const { snapshot, configuration } = scene();
    const resolved = structuredClone(configuration.triggerRules[1]!);
    resolved.ruleKey = 'after_resolved';
    resolved.eventSource = { eventType: 'PROCESS_RESOLVED', detail: { sourceSkillKey: 'sample_active', processKey: 'cast' } };
    resolved.conditionGroups[0]!.conditions = resolved.conditionGroups[0]!.conditions.filter(row => row.conditionType === 'INTERNAL_STATE_CHECK');
    resolved.conditionGroups[0]!.conditions.push({ conditionKey: 'no_contact', sortOrder: 1, conditionType: 'EVENT_VALUE_COMPARE',
      detail: { eventValueKey: 'SKILL_USE_CONTACT_COUNT', comparator: 'EQ', comparisonValue: fixedValue(0) } });
    configuration.triggerRules.push(resolved);
    snapshot.source.skillSources.find(row => row.skillKey === configuration.skill.skillKey)!.enabledRuleKeys = naturalRuleKeys(snapshot, configuration, 'source');
    const prepared = assemble(snapshot);
    const passive = prepared.compileRequest.sharedProviders!.find(provider => provider.skillKey === configuration.skill.skillKey && provider.initialStateSchema)!;
    const listener = passive.abilities!.find(ability => ability.listenerSpec?.listenerKey === 'after_resolved')!.listenerSpec!;
    expect(listener.eventMatcher.all).toEqual(['event/process_resolved', 'event/source_owner', 'ability/sample_active', 'event/process_resolved/sample_active/cast']);
    expect(JSON.stringify(listener.condition)).toContain('event.skill_use.contactCount');
    resolved.eventSource.detail.processKey = 'not_a_real_process';
    expect(() => assemble(snapshot)).toThrow(/真实过程|真实自然入口/);
  });

  it.each([['charged_alpha', 'stacks', 'lock_alpha'], ['ready_beta', 'charges', 'lock_beta']] as const)('%s 真实 Wasm 原命中执行控制，第三层只充能第四层', async (skillKey, stateKey, statusKey) => {
    const bytes = readFileSync(process.env.PHASE3B_WASM_PATH || new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url));
    const bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
    for (const [initial, preset, expected, shielded, excludedCategory] of [
      [3, 'TARGET_HIT', 4, false, false], [4, 'TARGET_HIT', 0, false, false], [3, 'MISS', 3, false, false],
      [4, 'TARGET_HIT', 0, true, false], [4, 'TARGET_HIT', 4, false, true]
    ] as const) {
      const { snapshot, configuration } = scene(skillKey, stateKey, statusKey, initial);
      if (excludedCategory) for (const rule of configuration.triggerRules) {
        rule.conditionGroups[0]!.conditions.push({ conditionKey: 'non_champion', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 2, detail: { categories: ['MINION'] } });
      }
      const prepared = assemble(snapshot);
      if (shielded) {
        prepared.compileRequest.typeCatalog.types.push({ key: 'provider/spell_shield', domain: 'provider' }, { key: 'event/spell_shield_blocked', domain: 'event' });
        prepared.compileRequest.sharedProviders!.push({ providerKey: 'guard_definition', stableId: 'guard_definition', kind: 'status', types: ['provider/spell_shield'] });
        prepared.compileRequest.combatants.find(row => row.key === 'target')!.providers.push({ providerRef: 'guard', definitionRef: 'guard_definition' });
      }
      const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
      expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
      if (!compiled.sessionId) throw new Error('真实编译没有会话');
      try {
        const request = await skillActionRequest(prepared, snapshot, { actions: [{ ...snapshot.selection.plannedSkills[0]!, instructionKey: 'cast', atMs: 0, sortOrder: 0,
          targetSide: 'target', phaseKind: 'INITIAL', parentInstructionKey: null, hitPreset: preset }], durationMs: 200, recordTimeSeries: false,
          maxSkillActionRecords: 32, maxSkillUseRecords: 32, maxHealingRecords: 32 }, compiled.sessionId);
        if (initial === 4 && preset === 'TARGET_HIT' && !shielded && !excludedCategory) {
          await expect(skillActionRequest(prepared, snapshot, { actions: [{ ...snapshot.selection.plannedSkills[0]!, instructionKey: 'self', atMs: 0, sortOrder: 0,
            targetSide: 'source', phaseKind: 'INITIAL', parentInstructionKey: null, hitPreset: preset }], durationMs: 200, recordTimeSeries: false }, compiled.sessionId))
            .rejects.toThrow(/伤害释放仅允许唯一目标B/);
        }
        const definition = prepared.compileRequest.sharedProviders!.find(row => row.skillKey === skillKey && row.initialStateSchema)!;
        const source = request.runRequest.initialSnapshot.combatants.find(row => row.key === 'source')!;
        const mount = source.providers.find(row => row.definitionRef === definition.providerKey)!;
        const done = parseDoneResult(bridge.run(request.runRequest));
        expect(done.ok, JSON.stringify(done.errors)).toBe(true);
        const finalSource = done.finalSnapshot.combatants.find(row => row.key === 'source')!;
        const state = finalSource.providerState[mount.providerRef] as { state: Record<string, number> } | undefined;
        if (preset === 'MISS') {
          expect(state).toBeUndefined();
          expect(definition.initialStateSchema![stateKey]).toMatchObject({ defaultValue: expected });
        } else expect(state!.state[stateKey]).toBe(expected);
        const target = done.finalSnapshot.combatants.find(row => row.key === 'target')!;
        const controlDefinitions = prepared.compileRequest.sharedProviders!.filter(row => row.types?.includes('provider/status_stun')).map(row => row.providerKey);
        expect(target.providers.some(row => controlDefinitions.includes(row.definitionRef))).toBe(initial === 4 && preset === 'TARGET_HIT' && !shielded && !excludedCategory);
        expect(done.damageRecords).toHaveLength(preset === 'TARGET_HIT' && !shielded ? 1 : 0);
        if (preset === 'TARGET_HIT' && !shielded) expect(done.damageRecords[0]!.rawAmount).toBe(100);
        if (shielded) expect(done.evidence.items.filter(row => row.kind === 'emitted_event' && row.ref === 'event/spell_shield_blocked')).toHaveLength(1);
      } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
    }
  });

  it.each([['mixed_alpha', 'tokens', 'stop_alpha'], ['mixed_beta', 'charges', 'stop_beta']] as const)
    ('%s 原命中控制的作者来源与实际执行来源分别核对，普攻保持开启', async (skillKey, stateKey, statusKey) => {
      const { snapshot } = scene(skillKey, stateKey, statusKey, 4, true);
      const prepared = assemble(snapshot);
      const bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,'
        + readFileSync(process.env.PHASE3B_WASM_PATH || new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url)).toString('base64') });
      const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
      expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
      if (!compiled.sessionId) throw new Error('真实编译没有会话');
      try {
        const { runRequest } = await skillActionRequest(prepared, snapshot, { actions: [{ ...snapshot.selection.plannedSkills[0]!, instructionKey: 'mixed', atMs: 0, sortOrder: 0,
          targetSide: 'target', phaseKind: 'INITIAL', parentInstructionKey: null, hitPreset: 'TARGET_HIT' }], durationMs: 200, recordTimeSeries: false,
          attackSpeedInputMax: 5, maxSkillActionRecords: 32, maxSkillUseRecords: 32, maxHealingRecords: 32 }, compiled.sessionId);
        expect(runRequest.driverPlan.basicAttack).toBeDefined();
        const done = parseDoneResult(bridge.run(runRequest));
        const assess = (input = prepared.compileRequest, origins = prepared.operationOrigins) => assessSkillActionResult(input, runRequest, done, origins);
        expect(assess()).toMatchObject({ complete: true, factsValid: true, issues: [] });
        expect(done.summary.basicAttack!.hitCount).toBeGreaterThan(0);
        const origin = prepared.operationOrigins.find(row => row.skillKey === skillKey)!;
        expect(origin.abilityRef).toContain('selected_skill_hit');
        expect(origin.operationRef).toBe(`skills.${skillKey}.effects.control.results.disable`);
        for (const corruption of ['missing', 'other_owner', 'wrong_author', 'wrong_path', 'non_control', 'wrong_control_author', 'duplicate'] as const) {
          const input = structuredClone(prepared.compileRequest);
          const origins = structuredClone(prepared.operationOrigins);
          const altered = origins.find(row => row.skillKey === skillKey)!;
          const binding = input.rules.skillActionBindings![0]!;
          const active = input.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!;
          const candidate = active.abilities!.flatMap(ability => ability.operations ?? []).find(operation => operation.operation === 'resolve_skill_hit')!
            .skillHit!.candidates.find(row => row.semantic.resultType === 'STATUS_OPERATION')!;
          if (corruption === 'missing') candidate.participationProviderRef = 'not_mounted';
          if (corruption === 'other_owner') {
            const owner = input.combatants[0]!;
            const index = owner.providers.findIndex(row => row.providerRef === candidate.participationProviderRef);
            input.combatants[1]!.providers.push(owner.providers.splice(index, 1)[0]!);
          }
          if (corruption === 'wrong_author') {
            altered.skillKey = 'other_author';
            altered.operationRef = 'skills.other_author.effects.control.results.disable';
          }
          if (corruption === 'wrong_path') altered.compiledPaths = [origins.find(row => row.skillKey === 'sample_active')!.compiledPaths[0]!];
          if (corruption === 'non_control') candidate.semantic.resultType = 'DAMAGE';
          if (corruption === 'wrong_control_author') input.sharedProviders!.find(row => row.providerKey === candidate.operations[0]!.providerDefinitionRef)!.skillKey = 'other_author';
          if (corruption === 'duplicate') origins.push(structuredClone(altered));
          expect(assess(input, origins).issues.join(';'), corruption).toContain('operationOrigins');
        }
      } finally {
        expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true);
      }
    });

  it.each(['ratio_alpha', 'ratio_beta'])('%s 的剩余比例连乘按配置翻译，不按属性键或当前值改写', skillKey => {
    const { snapshot, configuration } = scene(skillKey);
    const attribute = snapshot.catalogs.attributes.find(row => row.attributeKey !== 'hp')!;
    const zone = { ...snapshot.catalogs.modifierZones[0]!, gameId: snapshot.gameId, modifierZoneKey: 'ratio_complement', domain: 'ATTRIBUTE' as const,
      calculationMode: 'RATIO_COMPLEMENT_MULTIPLY', applicationStage: 'ATTRIBUTE_PERCENT' as const, status: 'ENABLED' as const };
    snapshot.catalogs.modifierZones = [zone as typeof snapshot.catalogs.modifierZones[number]];
    const result = { resultKey: 'ratio', name: '补集比例', resultType: 'ATTRIBUTE_CHANGE' as const, target: 'SOURCE' as const, description: null, sortOrder: 0,
      spellShieldBlockScope: null, valueRule: { value: fixedValue(.1), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
      detail: { attributeKey: attribute.attributeKey, operation: 'INCREASE' as const, modifierZoneKey: zone.modifierZoneKey },
      lifecycleBehavior: { moment: 'PERSISTENT' as const, valueReadMode: 'APPLICATION_SNAPSHOT' as const, stackValueMode: 'SHARED' as const, reapplicationValueMode: 'REPLACE' as const, periodicExecutionMode: null } };
    const context: PermanentResultContext = { snapshot, configuration, source: snapshot.source.skillSources.at(-1)!, side: 'source', formulaNamespace: 'ratio-proof' };
    expect(permanentModifier(context, result, 'ratio')).toMatchObject({ target: `self.attr.${attribute.attributeKey}`, valuePolicy: 'complement_multiply', value: { op: 'const', value: .1 } });
    result.valueRule.value = fixedValue(1.01);
    expect(() => permanentModifier(context, result, 'ratio')).toThrow(/0与1/);
  });
});

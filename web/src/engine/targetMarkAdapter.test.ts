import { describe, expect, it } from 'vitest';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillProcess } from '../types/skillProcess';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import type { AbilityDefinition, ProviderDefinition } from '../types/genericEngine';
import { fixedValue } from '../types/numericValue';
import { assembleActiveSkills } from './simulationActiveSkills';
import { assembleTargetMarkSource, type TargetMarkAssemblyInput } from './targetMarkAdapter';
import { targetMarkAuthoringContract } from './targetMarkAuthoringContract';
import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import { inspectSimulationSnapshot, prepareSimulation, simulationAbility } from './simulationAdapter';
import { naturalRuleKeys, plannedSkillRuleKeys } from './simulationSkillSourceDescription';

function graph() {
  const snapshot = simulationActiveSample();
  const base = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
  const common = { gameId: snapshot.gameId, skillKey: base.skill.skillKey, createdAt: '', updatedAt: '' };
  const valueRule = (value: number) => ({ value: fixedValue(value), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null });
  const damage = (zero: boolean): SkillEffectResult => ({ resultKey: 'magic_hit', name: '独立魔伤', description: null, sortOrder: 10,
    resultType: 'DAMAGE', target: 'TARGET', lifecycleBehavior: null, spellShieldBlockScope: zero ? 'SKILL' : 'DAMAGE_INSTANCE',
    valueRule: valueRule(zero ? 0 : 200), detail: { damageTypeKey: 'physics', deliveryKind: 'SKILL', originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: [] } });
  const effect = (effectKey: string, results: SkillEffectResult[]): SkillEffect => ({ ...common, effectKey, name: effectKey,
    description: null, sortOrder: 10, lifecycle: null, results });
  const passive = (processKey: string, value: number, effectKey?: string): SkillProcess => ({ ...common, processKey, name: processKey,
    description: null, sortOrder: 10, activationType: 'PASSIVE', cooldown: null,
    steps: [{ stepKey: 'execute', stepType: 'IMMEDIATE', name: '即时', description: null, sortOrder: 10, occupiesAction: false, detail: {} }],
    effectBindings: effectKey ? [{ bindingKey: 'damage', effectKey, sortOrder: 10, moment: { momentType: 'STEP_EXECUTION', stepKey: 'execute', failureReason: null } }] : [],
    stateOperations: [{ operationKey: 'write', name: '写计数', sortOrder: 10, stateSkillKey: common.skillKey, stateKey: 'mark',
      operation: 'SET', value: fixedValue(value), optionKey: null, moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } }] });
  const rule = (ruleKey: string, eventSource: SkillTriggerRuleDetail['eventSource'], processKey: string): SkillTriggerRuleDetail => ({
    ruleKey, name: ruleKey, description: null, sortOrder: 10, eventSource, conditionGroups: [],
    actions: [{ actionKey: 'start', name: '开始', sortOrder: 10, actionType: 'START_PROCESS', detail: { processKey },
      targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }],
    perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null });
  const blocked = { conditionKey: 'not_blocked', conditionType: 'EVENT_VALUE_COMPARE' as const, sortOrder: 20,
    detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED' as const, comparator: 'EQ' as const, comparisonValue: fixedValue(0) } };
  const mark = { conditionKey: 'marked', conditionType: 'INTERNAL_STATE_CHECK' as const, sortOrder: 10,
    detail: { stateSkillKey: common.skillKey, stateKey: 'mark', valueKind: 'VALUE' as const, optionKey: null, expectedBoolean: null,
      comparator: 'EQ' as const, comparisonValue: fixedValue(1) } };
  const onUsed = rule('on_used', { eventType: 'SKILL_USED', detail: { sourceSkillKey: common.skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' } }, 'cast');
  const root = rule('root_hit', { eventType: 'SKILL_HIT', detail: { sourceSkillKey: common.skillKey } }, 'cast');
  root.actions = [{ actionKey: 'zero', name: '零应用', sortOrder: 10, actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'zero_hit' },
    targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }];
  const apply = rule('apply', { eventType: 'SKILL_HIT', detail: { sourceSkillKey: common.skillKey } }, 'apply');
  apply.conditionGroups = [{ groupKey: 'eligible', name: '未挡', sortOrder: 10, conditions: [blocked] }];
  const attack = rule('attack', { eventType: 'BASIC_ATTACK_HIT', detail: {} }, 'attack');
  attack.conditionGroups = [{ groupKey: 'eligible', name: '已标记', sortOrder: 10, conditions: [structuredClone(mark)] }];
  const skill = rule('skill', { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'sibling' } }, 'skill');
  skill.conditionGroups = [{ groupKey: 'eligible', name: '已标记未挡', sortOrder: 10, conditions: [structuredClone(mark), structuredClone(blocked)] }];
  const configuration: SkillConfiguration = { ...base, effects: [effect('zero_hit', [damage(true)]), effect('attack_hit', [damage(false)]),
    effect('skill_hit', [damage(false), { resultKey: 'mana', name: '回蓝', description: null, sortOrder: 20, resultType: 'RESOURCE_CHANGE',
      target: 'SOURCE', lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: valueRule(60), detail: { attributeKey: 'mana', operation: 'RESTORE' } }])],
    processes: [{ ...base.processes[0]!, effectBindings: [], stateOperations: [] }, passive('apply', 1), passive('attack', 0, 'attack_hit'), passive('skill', 0, 'skill_hit')],
    parameters: [], formulas: [], internalStates: [{ ...common, stateKey: 'mark', name: '自身目标标记', description: null, sortOrder: 10,
      stateType: 'COUNTER', scope: 'TARGET', detail: { initialValue: fixedValue(0), maxValue: fixedValue(1), durationValue: fixedValue(4000) } }],
    triggerRules: [onUsed, root, apply, attack, skill] };
  snapshot.skillConfigurations[snapshot.skillConfigurations.indexOf(base)] = configuration;
  snapshot.source.skillSources.find(row => row.skillKey === common.skillKey)!.enabledRuleKeys = configuration.triggerRules.map(row => row.ruleKey).sort();
  return { snapshot, configuration };
}

function input(withBasic = false): TargetMarkAssemblyInput {
  const { snapshot, configuration } = graph();
  const simple = simulationActiveSample().skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
  const sibling = JSON.parse(JSON.stringify(simple).replaceAll('sample_active', 'sibling')) as SkillConfiguration;
  snapshot.skillConfigurations.push(sibling);
  const source = snapshot.source.skillSources.find(row => row.skillKey === configuration.skill.skillKey)!;
  snapshot.source.skillSources.push({ ...structuredClone(source), skillKey: 'sibling', enabledRuleKeys: sibling.triggerRules.map(row => row.ruleKey).sort() });
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills.find(row => row.skillKey === configuration.skill.skillKey)!, skillKey: 'sibling' });
  snapshot.selection.sourceSkillSettings.push({ ...snapshot.selection.sourceSkillSettings.find(row => row.skillKey === configuration.skill.skillKey)!, skillKey: 'sibling' });
  snapshot.selection.plannedSkills.push({ ...structuredClone(snapshot.selection.plannedSkills[0]!), skillKey: 'sibling' });
  const compileSnapshot = structuredClone(snapshot);
  const closed = compileSnapshot.skillConfigurations.find(row => row.skill.skillKey === configuration.skill.skillKey)!;
  closed.processes = closed.processes.filter(row => row.activationType === 'ACTIVE');
  closed.triggerRules = closed.triggerRules.filter(row => ['on_used', 'root_hit'].includes(row.ruleKey));
  closed.effects = closed.effects.filter(row => row.effectKey === 'zero_hit');
  closed.internalStates = [];
  compileSnapshot.source.skillSources.find(row => row.skillKey === configuration.skill.skillKey)!.enabledRuleKeys = closed.triggerRules.map(row => row.ruleKey).sort();
  approveSnapshotFixture(compileSnapshot);
  const active = assembleActiveSkills(compileSnapshot);
  const binding = active.bindings.find(row => row.skillKey === configuration.skill.skillKey)!;
  const value: TargetMarkAssemblyInput = { snapshot, source, side: 'source', providerRef: binding.providerRef, definitionRef: binding.providerDefinitionRef,
    providers: active.providers, skillActionBindings: active.bindings, basicAttackBinding: null,
    mounts: active.bindings.map(row => ({ side: 'source', providerRef: row.providerRef, definitionRef: row.providerDefinitionRef })) };
  if (withBasic) {
    const skillKey = snapshot.skillConfigurations[0]!.skill.skillKey;
    snapshot.selection.basicAttackSkillKey = skillKey; snapshot.selection.basicAttackLevel = 1;
    const provider: ProviderDefinition = { providerKey: 'actual_basic_definition', stableId: 'actual_basic_definition', kind: 'character', skillKey,
      abilities: [{ abilityKey: 'actual_hit', kind: 'active', skillKey, types: ['ability/basic_attack', `ability/skill/${skillKey}`],
        operations: [{ operation: 'resolve_skill_hit', target: 'target', skillHit: { skillKey, candidates: [] } }] }] };
    value.providers = [...value.providers, provider];
    value.mounts = [...value.mounts, { side: 'source', providerRef: 'actual_basic_mount', definitionRef: provider.providerKey }];
    value.basicAttackBinding = { source: 'source', target: 'target', skillKey, attackSpeedAttributeKey: 'attack_speed',
      startAbilityRef: 'source.provider[actual_basic_mount].ability[actual_start]',
      hitAbilityRef: 'source.provider[actual_basic_mount].ability[actual_hit]', initialControlAbilityRef: 'source.provider[actual_basic_mount].ability[actual_start]' };
  }
  return value;
}
function operations(assembly: NonNullable<ReturnType<typeof assembleTargetMarkSource>>) {
  return assembly.providers[0]!.abilities!.flatMap(ability => ability.listenerSpec?.operations ?? []);
}
function integrationSnapshot() {
  const snapshot = input(true).snapshot;
  const basic = snapshot.source.skillSources.find(row => row.skillKey === snapshot.selection.basicAttackSkillKey)!;
  basic.inactiveReason = null;
  basic.enabledRuleKeys = snapshot.skillConfigurations.find(row => row.skill.skillKey === basic.skillKey)!.triggerRules.map(row => row.ruleKey).sort();
  snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'mana', name: '法力容量', minValue: 0, maxValue: null });
  snapshot.source.selectedLevelValues.mana = 100;
  snapshot.source.attributes.levelValues['1']!.mana = 100;
  approveSnapshotFixture(snapshot);
  return snapshot;
}
function attributeInputs(snapshot: ReturnType<typeof integrationSnapshot>) {
  const value = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const required of inspectSimulationSnapshot(snapshot).requirements) if (required.storedValue === undefined) value[required.side][required.attribute.attributeKey] = required.attribute.minValue ?? 0;
  return value;
}

describe('总装配后真实挂载的有限目标标记降低', () => {
  it('prepare/inspect总装配把辅助能力合回真实同父，最终数字路径逐叶指向相同伤害/恢复', async () => {
    const snapshot = integrationSnapshot();
    expect(inspectSimulationSnapshot(snapshot).resourceRequirements).toMatchObject([{ side: 'source', resourceKey: 'mana', maxValue: 100 }]);
    await expect(prepareSimulation(snapshot, attributeInputs(snapshot), { source: 250, target: 500 })).rejects.toThrow(/初始|缺少|明确/);
    const prepared = await prepareSimulation(snapshot, attributeInputs(snapshot), { source: 250, target: 500 }, [], [], [], [], [{ side: 'source', resourceKey: 'mana', current: 0 }]);
    const parents = prepared.compileRequest.sharedProviders!.filter(provider => provider.skillKey === 'sample_active');
    expect(parents).toHaveLength(1);
    expect(parents[0]!.processes).toHaveLength(1);
    expect(parents[0]!.abilities!.filter(ability => ability.listenerSpec?.operations?.some(operation => operation.operation === 'consume_target_mark'))).toHaveLength(2);
    const origins = prepared.operationOrigins.filter(origin => origin.skillKey === 'sample_active' && origin.compiledPaths.some(path => path.includes('.targetMark.')));
    expect(origins).toHaveLength(3);
    for (const origin of origins) {
      expect(simulationAbility(prepared.compileRequest, origin.abilityRef)!.provider).toBe(parents[0]);
      for (const path of origin.compiledPaths) {
        expect(path).toMatch(/^sharedProviders\[\d+\]\.abilities\[\d+\]\.listenerSpec\.operations\[0\]\.targetMark\.(damage|restore)$/);
        const resolved = path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], prepared.compileRequest);
        expect((resolved as { ref: string }).ref).toBe(origin.operationRef);
      }
    }
    expect(prepared.compileRequest.combatants[0]!.resources.mana).toEqual({ current: 0, max: 100 });
  });
  it('总装配仅BAA消费不索要法力；W关闭或未计划也无标记辅助能力和资源需求', async () => {
    for (const mode of ['attack_only', 'w_disabled', 'w_unplanned'] as const) {
      const snapshot = integrationSnapshot();
      snapshot.selection.plannedSkills = snapshot.selection.plannedSkills.filter(plan => plan.skillKey !== 'sibling' && (mode !== 'w_unplanned' || plan.skillKey !== 'sample_active'));
      const sibling = snapshot.source.skillSources.find(row => row.skillKey === 'sibling')!;
      sibling.enabled = false; sibling.inactiveReason = 'SCENE_DISABLED'; sibling.enabledRuleKeys = [];
      snapshot.selection.sourceSkillSettings.find(row => row.skillKey === 'sibling')!.enabled = false;
      if (mode === 'w_disabled') {
        const w = snapshot.source.skillSources.find(row => row.skillKey === 'sample_active')!;
        w.enabled = false; w.inactiveReason = 'SCENE_DISABLED'; w.enabledRuleKeys = [];
        snapshot.selection.plannedSkills = [];
        snapshot.selection.sourceSkillSettings.find(row => row.skillKey === w.skillKey)!.enabled = false;
      }
      if (mode === 'w_unplanned') snapshot.source.skillSources.find(row => row.skillKey === 'sample_active')!.inactiveReason = 'ACTIVE_DEFERRED';
      const w = snapshot.source.skillSources.find(row => row.skillKey === 'sample_active')!;
      const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === w.skillKey)!;
      if (mode === 'w_unplanned') w.enabledRuleKeys = [];
      if (mode === 'attack_only') w.enabledRuleKeys = [...new Set([...naturalRuleKeys(snapshot, configuration, 'source', w), ...plannedSkillRuleKeys(configuration)])].sort();
      approveSnapshotFixture(snapshot);
      expect(inspectSimulationSnapshot(snapshot).resourceRequirements).toEqual([]);
      const prepared = await prepareSimulation(snapshot, attributeInputs(snapshot), { source: 250, target: 500 });
      const operations = prepared.compileRequest.sharedProviders!.flatMap(provider => provider.abilities ?? []).flatMap(ability => ability.listenerSpec?.operations ?? []);
      expect(operations.filter(operation => operation.operation === 'consume_target_mark')).toHaveLength(mode === 'attack_only' ? 1 : 0);
      expect(prepared.compileRequest.combatants.every(actor => !Object.keys(actor.resources).length)).toBe(true);
    }
  });
  it('复用真实主动生产装配绑定，生成单父补充且不改原定义/作者图', () => {
    const value = input(); const before = structuredClone(value);
    const assembled = assembleTargetMarkSource(value)!;
    const consume = operations(assembled).filter(operation => operation.operation === 'consume_target_mark');
    expect(consume).toHaveLength(1);
    expect(consume[0]!.targetMark?.triggerAbilityRef).toBe(value.skillActionBindings.find(row => row.skillKey === 'sibling')!.hitBindings[0]!.hitAbilityRef);
    expect(consume[0]!.targetMark?.restore?.amount).toEqual({ op: 'const', value: 60 });
    expect(consume[0]!.targetMark?.damage.types).toEqual(['damage_trait/delivery_skill', 'damage_trait/origin_direct']);
    expect(consume[0]!.targetMark?.damage.amount).toEqual({ op: 'const', value: 200 });
    expect(assembled.providers[0]!.initialStateSchema).toEqual({ mark: { valueType: 'integer', defaultValue: 0, maxValue: 1, durationMs: 4000, refreshPolicy: 'refresh_on_write' } });
    expect(assembled.mounts).toEqual([]);
    expect(assembled.required.source.has('mana')).toBe(true);
    expect(assembled.required.target.has('armor')).toBe(true);
    expect(assembled.operationOrigins).toHaveLength(2);
    expect(assembled.operationOrigins.every(row => row.skillKey === 'sample_active' && row.providerDefinitionRef === value.definitionRef
      && row.abilityRef.startsWith(`source.provider[${value.providerRef}]`) && row.compiledPaths.every(path => /\.targetMark\.(damage|restore)$/.test(path)))).toBe(true);
    expect(value).toEqual(before);
    expect(JSON.stringify(assembled.providers)).not.toMatch(/pending|runtimeInputReads|SOURCE_CAST_RESOURCE_COST/);
  });
  it('真实所选普攻只消费、独立附伤，没有恢复字段或伪造主动使用', () => {
    const value = input(true), assembled = assembleTargetMarkSource(value)!;
    const consume = operations(assembled).filter(operation => operation.operation === 'consume_target_mark');
    expect(consume).toHaveLength(2);
    const attack = consume.find(operation => operation.targetMark?.triggerKind === 'event/basic_attack_hit')!;
    expect(attack.targetMark!.triggerAbilityRef).toBe(value.basicAttackBinding!.hitAbilityRef);
    expect(Object.prototype.hasOwnProperty.call(attack.targetMark, 'restore')).toBe(false);
    const listener = assembled.providers[0]!.abilities!.find(ability => ability.listenerSpec?.operations?.includes(attack))!.listenerSpec!;
    expect(listener.eventMatcher.all).toEqual(['event/basic_attack_hit', 'event/source_owner']);
    expect(operations(assembled).some(operation => operation.operation === 'resolve_skill_hit')).toBe(false);
  });
  it.each(['unplanned', 'disabled', 'zero'] as const)('W自身%s不挂标或偷启来源', mode => {
    const value = input();
    if (mode === 'unplanned') value.snapshot.selection.plannedSkills = value.snapshot.selection.plannedSkills.filter(row => row.skillKey !== value.source.skillKey);
    if (mode === 'disabled') value.source.enabled = false;
    if (mode === 'zero') value.source.skillLevel = 0;
    expect(assembleTargetMarkSource(value)).toBeNull();
  });
  it.each(['unplanned', 'disabled', 'zero'] as const)('兄弟%s零匹配，保留自身挂标但不索要法力', mode => {
    const value = input();
    const sibling = value.snapshot.source.skillSources.find(row => row.skillKey === 'sibling')!;
    value.skillActionBindings = value.skillActionBindings.filter(row => row.skillKey !== 'sibling');
    if (mode === 'unplanned') value.snapshot.selection.plannedSkills = value.snapshot.selection.plannedSkills.filter(row => row.skillKey !== 'sibling');
    if (mode === 'disabled') sibling.enabled = false;
    if (mode === 'zero') sibling.skillLevel = 0;
    const assembled = assembleTargetMarkSource(value)!;
    expect(operations(assembled).map(operation => operation.operation)).toEqual(['state_change']);
    expect(assembled.required.source.has('mana')).toBe(false);
  });
  it.each(['missing_initial', 'duplicate_initial', 'foreign_mount', 'missing_mount', 'wrong_definition', 'wrong_skill', 'unbound',
    'duplicate_binding', 'wrong_hit', 'wrong_phase', 'wrong_process', 'state_cap', 'fractional_duration', 'infinite_duration'])(
    '真实%s错误在降低前拒绝，不留下半份装配', mode => {
      const value = input(), originalProviders = structuredClone(value.providers);
      const binding = value.skillActionBindings.find(row => row.skillKey === 'sibling')!;
      if (mode === 'missing_initial') binding.controls = [];
      if (mode === 'duplicate_initial') binding.controls.push(structuredClone(binding.controls[0]!));
      if (mode === 'foreign_mount') binding.hitBindings[0]!.hitAbilityRef = binding.hitBindings[0]!.hitAbilityRef.replace('source.', 'target.');
      if (mode === 'missing_mount') value.mounts = value.mounts.filter(row => row.providerRef !== binding.providerRef);
      if (mode === 'wrong_definition') (value.mounts.find(row => row.providerRef === binding.providerRef)! as { definitionRef: string }).definitionRef = value.definitionRef;
      if (mode === 'wrong_skill') value.providers.find(row => row.providerKey === binding.providerDefinitionRef)!.skillKey = 'foreign';
      if (mode === 'unbound') value.skillActionBindings = value.skillActionBindings.filter(row => row !== binding);
      if (mode === 'duplicate_binding') value.skillActionBindings = [...value.skillActionBindings, structuredClone(binding)];
      if (mode === 'wrong_hit') binding.hitBindings[0]!.hitAbilityRef += '_missing';
      if (mode === 'wrong_phase') binding.controls[0]!.action = 'RECAST';
      if (mode === 'wrong_process') binding.hitBindings[0]!.processKey = 'other';
      const state = value.snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!.internalStates[0]!;
      if (state.stateType !== 'COUNTER') throw new Error('counter');
      if (mode === 'state_cap') state.detail.maxValue = fixedValue(2);
      if (mode === 'fractional_duration') state.detail.durationValue = fixedValue(.5);
      if (mode === 'infinite_duration') state.detail.durationValue = fixedValue(Infinity);
      const before = structuredClone(value.providers);
      expect(() => assembleTargetMarkSource(value)).toThrow();
      expect(value.providers).toEqual(before);
      if (!['wrong_skill'].includes(mode)) expect(value.providers).toEqual(originalProviders);
    });
  it.each(['foreign', 'missing_mount', 'not_basic'] as const)('普攻%s不能借用能力身份', mode => {
    const value = input(true);
    if (mode === 'foreign') value.basicAttackBinding!.hitAbilityRef = value.basicAttackBinding!.hitAbilityRef.replace('source.', 'target.');
    if (mode === 'missing_mount') value.mounts = value.mounts.filter(row => row.providerRef !== 'actual_basic_mount');
    if (mode === 'not_basic') (value.providers[value.providers.length - 1]!.abilities![0] as AbilityDefinition).types = [];
    expect(() => assembleTargetMarkSource(value)).toThrow();
  });
  it('固定恢复完整折叠成const；没有消费者的历史运行参数不要求输入', () => {
    const value = input(), c = value.snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
    c.parameters.push({ ...c.skill, parameterKey: 'unused_cost', valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null });
    const assembled = assembleTargetMarkSource(value)!;
    expect(operations(assembled).find(operation => operation.targetMark)?.targetMark?.restore?.amount).toEqual({ op: 'const', value: 60 });
  });
  it.each(['negative', 'dynamic', 'hidden_attribute'] as const)('恢复%s不得从运行上下文求值或越界', mode => {
    const value = input(), c = value.snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
    const restore = targetMarkAuthoringContract(c)!.skill.restore!;
    if (mode === 'negative') { restore.valueRule.value = fixedValue(-1); restore.valueRule.fixedMinValue = null; }
    if (mode === 'dynamic') {
      c.parameters.push({ ...c.skill, parameterKey: 'cost_input', valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null });
      restore.valueRule.value = { kind: 'PARAMETER', parameterKey: 'cost_input' };
    }
    if (mode === 'hidden_attribute') {
      c.formulas.push({ gameId: c.skill.gameId, skillKey: c.skill.skillKey, formulaKey: 'hidden_restore', name: '静态恢复', description: null,
        sortOrder: 10, createdAt: '', updatedAt: '', expression: { inputs: [{ key: 'unused', binding: { kind: 'attribute', object: 'source',
          attributeKey: 'attack_damage', valueKind: 'TOTAL', view: 'current_frame' } }],
          stages: [{ key: 'output', name: '60', expression: { op: 'const', value: '60' } }], outputStageKey: 'output' } });
      restore.valueRule.value = { kind: 'FORMULA', formulaKey: 'hidden_restore' };
    }
    expect(() => assembleTargetMarkSource(value)).toThrow();
  });
  it('伤害保留本技能当前属性共同公式，不在装配时采样；隐藏上下文依赖也拒绝', () => {
    const value = input(), c = value.snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
    const formula = { gameId: c.skill.gameId, skillKey: c.skill.skillKey, name: '动态伤害', description: null, sortOrder: 10, createdAt: '', updatedAt: '',
      formulaKey: 'live_damage', expression: skillFormulaDefinition(c.skill.skillKey, {
        nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'attack_damage', attributeValueKind: 'TOTAL' }) };
    c.formulas.push(formula);
    const contract = targetMarkAuthoringContract(c)!;
    contract.attack.damage.valueRule.value = { kind: 'FORMULA', formulaKey: 'live_damage' };
    contract.skill.damage.valueRule.value = { kind: 'FORMULA', formulaKey: 'live_damage' };
    approveSnapshotFixture(value.snapshot);
    const assembled = assembleTargetMarkSource(value)!;
    expect(operations(assembled).find(operation => operation.targetMark)?.targetMark?.damage.amount?.op).toBe('max');
    expect(assembled.required.source.has('attack_damage')).toBe(true);
    expect(assembled.formulas.some(row => row.key.endsWith('/live_damage'))).toBe(true);
    c.formulas[0]!.expression.inputs.push({ key: 'hidden', binding: { kind: 'context', contextKey: 'effect_elapsed_ms' } });
    expect(() => assembleTargetMarkSource(value)).toThrow(/全部声明/);
  });
});

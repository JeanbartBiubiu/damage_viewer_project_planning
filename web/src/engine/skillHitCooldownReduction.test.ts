import { describe, expect, it } from 'vitest';
import { approveAuthoredFixture, approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import type { SkillFormula } from '../types/skillFormula';
import type { SkillParameter } from '../types/skillParameter';
import { fixedValue, formulaValue, parameterValue } from '../types/numericValue';
import { createNumericCompileState } from './numericAdapter';
import { assembleActiveSkills } from './simulationActiveSkills';
import { bindSkillHitCooldownReductions, compileSkillHitCooldownReduction, type SkillHitCooldownAssembly } from './skillHitCooldownReduction';

const key = 'sample_active';
function authored() {
  const snapshot = simulationActiveSample();
  const effect = structuredClone(snapshot.skillConfigurations.find(row => row.skill.skillKey === key)!.effects[0]!);
  const result: Extract<SkillEffectResult, { resultType: 'COOLDOWN_CHANGE' }> = {
    resultKey: 'reduce', name: '真实命中减少当前冷却', description: null, sortOrder: 20,
    resultType: 'COOLDOWN_CHANGE', target: 'SOURCE', lifecycleBehavior: null, spellShieldBlockScope: null,
    detail: { operation: 'REDUCE', affectedSkillScope: { mode: 'SKILLS', skillKeys: [key], skillCategoryKeys: [] } },
    valueRule: { value: fixedValue(1500), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
  };
  effect.results = [result];
  const state = createNumericCompileState({ gameId: 'lol', skillKey: key, skillLevel: 1, characterLevel: 1,
    parameters: [], formulas: [], bindParameters: true, allowAttributeReads: true,
    formulaNamespace: 'test/cooldown', runtimeInputMessage: '未提供动态输入' });
  return { effect, result, state };
}
function compile(value = authored()) {
  return compileSkillHitCooldownReduction(key, value.effect, value.result, 'skills.sample_active.effects.hit.results.reduce', value.state);
}

function graph(count = 1) {
  const snapshot = simulationActiveSample();
  const base = snapshot.skillConfigurations.find(row => row.skill.skillKey === key)!;
  for (let index = 1; index < count; index++) {
    const skillKey = `sibling_${index}`;
    const configuration = JSON.parse(JSON.stringify(base).replaceAll(`"${key}"`, `"${skillKey}"`)) as typeof base;
    snapshot.skillConfigurations.push(configuration);
    snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills.find(row => row.skillKey === key)!, skillKey });
    snapshot.source.skillSources.push({ ...structuredClone(snapshot.source.skillSources.find(row => row.skillKey === key)!), skillKey });
    snapshot.selection.sourceSkillSettings.push({ ...structuredClone(snapshot.selection.sourceSkillSettings.find(row => row.skillKey === key)!), skillKey });
    snapshot.selection.plannedSkills.push({ ...structuredClone(snapshot.selection.plannedSkills[0]!), skillKey });
  }
  return snapshot;
}
function pendingGraph(snapshot = graph()) {
  approveSnapshotFixture(snapshot);
  const active = assembleActiveSkills(snapshot);
  const assemblies: SkillHitCooldownAssembly[] = active.bindings.map(binding => ({
    origin: snapshot.selection.plannedSkills.find(plan => plan.skillKey === binding.skillKey)!.origin,
    binding, providers: active.providers.filter(provider => provider.providerKey === binding.providerDefinitionRef),
    coverage: [], operationOrigins: [], hitCooldownReductions: [],
  }));
  const owner = assemblies.find(assembly => assembly.binding.skillKey === key)!;
  const hit = owner.providers[0]!.abilities!.find(ability => ability.operations?.some(operation => operation.operation === 'resolve_skill_hit'))!;
  const candidate = hit.operations![0]!.skillHit!.candidates[0]!;
  candidate.semantic = { resultType: 'COOLDOWN_CHANGE', target: 'SOURCE', moment: 'INSTANT' };
  candidate.spellShieldBlockScope = null;
  candidate.operations = [];
  owner.hitCooldownReductions.push({ candidate, skillKeys: snapshot.source.skillSources.filter(source => source.skillKey !== 'sample_basic_attack').map(source => source.skillKey),
    amountMs: 1500, authorPath: 'skills.sample_active.effects.hit.results.reduce',
    compiledPath: `sharedProviders[${owner.binding.providerDefinitionRef}].abilities[${owner.providers[0]!.abilities!.indexOf(hit)}].operations[0].skillHit.candidates[0]`,
    hitAbilityRef: owner.binding.hitBindings[0]!.hitAbilityRef });
  return { snapshot, assemblies, owner, candidate };
}

describe('真实技能命中减冷却的窄静态合同', () => {
  it.each([0, 1500, Number.MAX_SAFE_INTEGER])('明确非负安全整数毫秒 %s 保留为静态值', amount => {
    const value = authored(); value.result.valueRule.value = fixedValue(amount);
    expect(compile(value)).toEqual({ skillKeys: [key], amountMs: amount });
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])('拒绝无效毫秒 %s', amount => {
    const value = authored(); value.result.valueRule.value = fixedValue(amount); value.result.valueRule.fixedMinValue = null;
    expect(() => compile(value)).toThrow();
  });
  it.each(['target', 'self', 'increase', 'ratio', 'all', 'categories', 'duplicate', 'foreign_only', 'five', 'bad_key', 'shield', 'lifecycle', 'moment'] as const)(
    '不扩展未授权作者形状：%s', kind => {
      const value = authored();
      if (kind === 'target') value.result.target = 'TARGET';
      if (kind === 'self') (value.result as { target: string }).target = 'SELF';
      if (kind === 'increase') value.result.detail.operation = 'INCREASE';
      if (kind === 'ratio') value.result.detail.operation = 'REDUCE_REMAINING_RATIO';
      if (kind === 'all') value.result.detail.affectedSkillScope = { mode: 'ALL', skillKeys: [], skillCategoryKeys: [] };
      if (kind === 'categories') value.result.detail.affectedSkillScope.skillCategoryKeys = ['common'];
      if (kind === 'duplicate') value.result.detail.affectedSkillScope.skillKeys.push(key);
      if (kind === 'foreign_only') value.result.detail.affectedSkillScope.skillKeys = ['sibling'];
      if (kind === 'five') value.result.detail.affectedSkillScope.skillKeys.push('a', 'b', 'c', 'd');
      if (kind === 'bad_key') value.result.detail.affectedSkillScope.skillKeys.push('bad-key');
      if (kind === 'shield') value.result.spellShieldBlockScope = 'SKILL';
      if (kind === 'lifecycle') value.effect.lifecycle = {} as NonNullable<SkillEffect['lifecycle']>;
      if (kind === 'moment') value.result.lifecycleBehavior = { moment: 'APPLICATION', valueReadMode: null, stackValueMode: null,
        reapplicationValueMode: null, periodicExecutionMode: null };
      expect(() => compile(value)).toThrow();
    });
  it.each(['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL'] as const)('参数 %s 在选定等级冻结，不输出ability.param', mode => {
    const value = authored();
    value.state.parameters = [{ gameId: 'lol', skillKey: key, parameterKey: 'reduction', name: '毫秒', description: null, sortOrder: 0,
      valueType: 'INTEGER', valueMode: mode, fixedValue: mode === 'FIXED' ? 1250 : null,
      levelValues: mode === 'FIXED' ? null : { '1': 1250, '2': 1500 }, createdAt: '', updatedAt: '' } satisfies SkillParameter];
    value.result.valueRule.value = parameterValue('reduction');
    expect(compile(value).amountMs).toBe(1250);
  });
  it('计算时参数及隐藏属性依赖均不得靠未选分支或clamp伪装静态', () => {
    const value = authored();
    value.state.parameters = [{ gameId: 'lol', skillKey: key, parameterKey: 'runtime', name: '动态', description: null, sortOrder: 0,
      valueType: 'INTEGER', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null, createdAt: '', updatedAt: '' }];
    value.result.valueRule.value = parameterValue('runtime');
    expect(() => compile(value)).toThrow(/计算时输入/);
    value.state.formulas = [{ gameId: 'lol', skillKey: key, formulaKey: 'hidden', name: '隐藏依赖', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
      expression: { inputs: [{ key: 'late', binding: { kind: 'attribute', object: 'source', attributeKey: 'attack_damage', valueKind: 'TOTAL', view: 'current_frame' } }],
        stages: [{ key: 'out', name: '输出', expression: { op: 'if', args: [{ op: 'const', value: '1' }, { op: 'const', value: '1500' }, { op: 'read', inputKey: 'late' }] } }], outputStageKey: 'out' } } as SkillFormula];
    value.result.valueRule.value = formulaValue('hidden');
    expect(() => compile(value)).toThrow(/属性|事件|实例时间/);
  });
  it('完整共同公式及倍率共同静态核定，而非只检查顶层值', () => {
    const value = authored();
    value.state.formulas = [{ gameId: 'lol', skillKey: key, formulaKey: 'fixed_math', name: '共同公式', description: null, sortOrder: 0,
      createdAt: '', updatedAt: '', expression: skillFormulaDefinition(key, { inputs: [], stages: [{ key: 'out', name: '输出',
        expression: { op: 'const', value: '750' } }], outputStageKey: 'out' }) }];
    approveAuthoredFixture({ gameId: 'lol', skillKey: key, skillLevel: 1, characterLevel: 1, formulas: value.state.formulas });
    value.result.valueRule.value = formulaValue('fixed_math'); value.result.valueRule.fixedMultiplier = 2;
    expect(compile(value).amountMs).toBe(1500);
    value.result.valueRule.fixedMultiplier = Infinity;
    expect(() => compile(value)).toThrow();
  });
});

describe('实际首次能力引用绑定', () => {
  it('四真实来源按作者范围顺序绑定，先全验证再发布且清除宿主待绑定信息', () => {
    const { snapshot, assemblies, owner, candidate } = pendingGraph(graph(4));
    bindSkillHitCooldownReductions(snapshot, assemblies);
    expect(candidate.operations.map(operation => operation.abilityRef)).toEqual(snapshot.source.skillSources
      .filter(source => source.skillKey !== 'sample_basic_attack').map(source => assemblies.find(row => row.binding.skillKey === source.skillKey)!.binding.controls[0]!.abilityRef));
    expect(candidate.operations.every(operation => operation.target === 'source' && operation.valuePolicy === 'reduce'
      && JSON.stringify(operation.amount) === JSON.stringify({ op: 'const', value: 1500 }))).toBe(true);
    expect(owner.operationOrigins[0]!.compiledPaths).toHaveLength(4);
    expect(assemblies.every(row => row.hitCooldownReductions.length === 0)).toBe(true);
  });
  it.each(['unplanned', 'disabled', 'unlearned'] as const)('兄弟来源%s零匹配且不被启用，自身引用仍完整', mode => {
    const snapshot = graph(2), skillKey = 'sibling_1';
    snapshot.selection.plannedSkills = snapshot.selection.plannedSkills.filter(plan => plan.skillKey !== skillKey);
    const source = snapshot.source.skillSources.find(source => source.skillKey === skillKey)!;
    source.enabledRuleKeys = []; source.inactiveReason = 'ACTIVE_DEFERRED';
    if (mode === 'disabled') { source.enabled = false; source.inactiveReason = 'SCENE_DISABLED'; snapshot.selection.sourceSkillSettings.find(row => row.skillKey === skillKey)!.enabled = false; }
    if (mode === 'unlearned') { source.skillLevel = 0; source.inactiveReason = 'UNLEARNED'; snapshot.selection.sourceSkillSettings.find(row => row.skillKey === skillKey)!.skillLevel = 0; }
    const { assemblies, candidate } = pendingGraph(snapshot);
    bindSkillHitCooldownReductions(snapshot, assemblies);
    expect(candidate.operations).toHaveLength(1);
    expect(assemblies.some(row => row.binding.skillKey === skillKey)).toBe(false);
  });
  it.each(['missing_assembly', 'duplicate_assembly', 'missing_initial', 'duplicate_initial', 'no_cooldown', 'foreign_ref', 'foreign_skill', 'wrong_kind',
    'event_use', 'wrong_process', 'duplicate_ability', 'foreign_origin', 'duplicate_definition', 'foreign_hit'] as const)('真实资格或挂载损坏%s即拒绝，不落半组', kind => {
    const { snapshot, assemblies, candidate, owner } = pendingGraph(graph(2));
    const sibling = assemblies.find(row => row.binding.skillKey === 'sibling_1')!, control = sibling.binding.controls[0]!;
    const provider = sibling.providers[0]!, ability = provider.abilities!.find(row => control.abilityRef.endsWith(`.ability[${row.abilityKey}]`))!;
    if (kind === 'missing_assembly') assemblies.splice(assemblies.indexOf(sibling), 1);
    if (kind === 'duplicate_assembly') assemblies.push(sibling);
    if (kind === 'missing_initial') sibling.binding.controls = [];
    if (kind === 'duplicate_initial') sibling.binding.controls.push({ ...control });
    if (kind === 'no_cooldown') provider.processes![0]!.cooldown = null;
    if (kind === 'foreign_ref') control.abilityRef = control.abilityRef.replace('source.provider', 'target.provider');
    if (kind === 'foreign_skill') ability.skillKey = 'foreign';
    if (kind === 'wrong_kind') ability.kind = 'passive_listener';
    if (kind === 'event_use') ability.processControl!.useRefFromEvent = true;
    if (kind === 'wrong_process') ability.processControl!.processKey = 'foreign';
    if (kind === 'duplicate_ability') provider.abilities!.push(structuredClone(ability));
    if (kind === 'foreign_origin') sibling.origin = { kind: 'CHARACTER', characterKey: 'actor_b' };
    if (kind === 'duplicate_definition') sibling.providers.push(structuredClone(provider));
    if (kind === 'foreign_hit') owner.hitCooldownReductions[0]!.hitAbilityRef = sibling.binding.hitBindings[0]!.hitAbilityRef;
    expect(() => bindSkillHitCooldownReductions(snapshot, assemblies)).toThrow();
    expect(candidate.operations).toEqual([]);
    expect(owner.operationOrigins).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import type { SkillEffect } from '../types/skillEffect';
import { fixedValue } from '../types/numericValue';
import { assembleActiveSkills } from './simulationActiveSkills';
import { compileCooldownDurationEffect } from './cooldownDurationEffectAdapter';
import { createNumericCompileState } from './numericAdapter';
import { compileTimedAttributeEffect } from './timedAttributeEffectAdapter';
import type { ModifierZone } from '../types/modifierZone';

const lifetime = (): SkillEffect['lifecycle'] => ({ durationValue: fixedValue(15000), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
  instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE',
  periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null });
const behavior = { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null } as const;
const zone: ModifierZone = { gameId: 'lol', modifierZoneKey: 'static_flat', name: '静态加算', domain: 'ATTRIBUTE', calculationMode: 'FLAT_ADD', applicationStage: 'ATTRIBUTE_FLAT',
  status: 'ENABLED', description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
function effect(skillKey: string, resource = false): SkillEffect {
  const base = { name: '通用有限效果', description: null, sortOrder: 0, spellShieldBlockScope: null, lifecycleBehavior: { ...behavior },
    valueRule: { value: fixedValue(.5), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null } };
  return { gameId: 'lol', skillKey, effectKey: resource ? 'static_attributes' : 'duration_modifier', name: '通用有限效果', description: null, sortOrder: 0, createdAt: '', updatedAt: '', lifecycle: lifetime(),
    results: resource ? ['hp', 'armor', 'magic_resistance'].map((attributeKey, i) => ({ ...base, resultKey: attributeKey, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', sortOrder: i,
      valueRule: { ...base.valueRule, value: fixedValue(i === 0 ? 300 : 40) }, detail: { attributeKey, operation: 'INCREASE', modifierZoneKey: zone.modifierZoneKey } }))
      : [{ ...base, resultKey: 'duration', resultType: 'COOLDOWN_DURATION_MODIFIER', target: 'SOURCE', detail: { affectedSkillScope: { mode: 'SKILLS', skillKeys: ['sample_active'], skillCategoryKeys: [] } } }] };
}
const state = (skillKey = 'different_active') => createNumericCompileState({ gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 18, formulaNamespace: 'finite-test',
  bindParameters: false, allowAttributeReads: false, runtimeInputMessage: '无运行时输入' });
function snapshot() {
  const value = simulationActiveSample(), first = value.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
  const other = JSON.parse(JSON.stringify(first).replaceAll('sample_active', 'different_active')) as typeof first;
  const actor = value.source.attachedSkills.find(row => row.skillKey === first.skill.skillKey)!;
  value.source.attachedSkills.push({ ...actor, skillKey: other.skill.skillKey, skillName: '另一个主动' });
  value.selection.sourceSkillSettings.push({ ...value.selection.sourceSkillSettings.find(row => row.skillKey === first.skill.skillKey)!, skillKey: other.skill.skillKey });
  value.selection.plannedSkills.push({ ...value.selection.plannedSkills[0]!, skillKey: other.skill.skillKey });
  value.skillConfigurations.push(other); value.catalogs.modifierZones.push({ ...zone, gameId: value.gameId });
  other.effects.push({ ...effect(other.skill.skillKey), gameId: value.gameId }, { ...effect(other.skill.skillKey, true), gameId: value.gameId });
  for (const row of other.effects.slice(-2)) other.processes[0]!.effectBindings.push({ bindingKey: row.effectKey, effectKey: row.effectKey,
    moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, sortOrder: other.processes[0]!.effectBindings.length });
  syncSimulationSkillSources(value); return value;
}
const assemble = (value: ReturnType<typeof snapshot>) => { approveSnapshotFixture(value); return assembleActiveSkills(value); };

describe('有限生命上限、同快照属性组与真实冷却范围', () => {
  it('一个三结果作者效果仍是同一供值实例，不拆帧；生命上限使用独立策略', () => {
    const source = effect('different_active', true), before = structuredClone(source);
    const compiled = compileTimedAttributeEffect(source, state(), [zone], 'actual_definition');
    expect(compiled.provider.modifiers).toHaveLength(3);
    expect(compiled.provider.modifiers![0]).toMatchObject({ kind: 'resource_max', target: 'self.attr.hp', currentValuePolicy: 'grant_positive_delta_clamp', value: { op: 'const', value: 300 } });
    expect(compiled.provider.modifiers![0]).not.toHaveProperty('bucket');
    expect(compiled.provider.modifiers!.slice(1).every(row => row.kind === 'attribute' && !('currentValuePolicy' in row))).toBe(true);
    expect(compiled.operation.ref).toBe('skills.different_active.effects.static_attributes'); expect(source).toEqual(before);
  });
  it.each(['negative', 'real_time', 'percent', 'target', 'permanent', 'stacked'])('生命上限拒绝越界%s', kind => {
    const source = effect('different_active', true), zones = [structuredClone(zone)];
    if (kind === 'negative') source.results[0]!.valueRule!.value = fixedValue(-1);
    if (kind === 'real_time') source.results[0]!.lifecycleBehavior!.valueReadMode = 'MOMENT_EVALUATION';
    if (kind === 'percent') { zones[0]!.calculationMode = 'RATIO_ADD'; zones[0]!.applicationStage = 'ATTRIBUTE_PERCENT'; }
    if (kind === 'target') source.results[0]!.target = 'TARGET';
    if (kind === 'permanent') source.lifecycle!.durationValue = null;
    if (kind === 'stacked') source.lifecycle!.maxStacksValue = fixedValue(2);
    expect(() => compileTimedAttributeEffect(source, state(), zones)).toThrow();
  });
  it('在全部来源装配后绑定实际INITIAL，不硬编码技能或挂载名称；同组每个结果覆盖到原作者', () => {
    const source = snapshot(), result = assemble(source);
    const modifier = result.providers.flatMap(row => row.modifiers ?? []).find(row => row.kind === 'cooldown_duration')!;
    const ordinary = result.bindings.find(row => row.skillKey === 'sample_active')!;
    expect(modifier.affectedAbilityRefs).toEqual([ordinary.controls.find(row => row.action === 'INITIAL')!.abilityRef]);
    const grouped = result.operationOrigins.filter(row => row.effectKey === 'static_attributes');
    expect(grouped.map(row => row.resultKey)).toEqual(['hp', 'armor', 'magic_resistance']);
    expect(new Set(grouped.map(row => row.compiledPaths[0])).size).toBe(1);
    expect(result.changedAttributes.source.has('hp')).toBe(true);
  });
  it.each(['disabled', 'zero', 'unplanned'])('真实%s来源本场零匹配，覆盖保留且不偷偷启用', mode => {
    const source = snapshot(); source.selection.plannedSkills = source.selection.plannedSkills.filter(row => row.skillKey !== 'sample_active');
    const setting = source.selection.sourceSkillSettings.find(row => row.skillKey === 'sample_active')!;
    if (mode === 'disabled') setting.enabled = false;
    if (mode === 'zero') setting.skillLevel = 0;
    syncSimulationSkillSources(source);
    const result = assemble(source);
    expect(result.providers.flatMap(row => row.modifiers ?? []).find(row => row.kind === 'cooldown_duration')!.affectedAbilityRefs).toEqual([]);
    expect(result.coverage.some(row => row.authorPath.endsWith('affectedSkillScope') && row.note?.includes('零匹配'))).toBe(true);
    expect(source.source.skillSources.find(row => row.skillKey === 'sample_active')!.enabled).toBe(mode !== 'disabled');
  });
  it.each(['missing_cooldown', 'basic_attack', 'foreign_skill', 'missing_manifest', 'forged_deferred'])('冷却范围拒绝伪绑定%s', mode => {
    const source = snapshot(), ordinary = source.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
    const scope = source.skillConfigurations.find(row => row.skill.skillKey === 'different_active')!.effects.find(row => row.effectKey === 'duration_modifier')!.results[0]!;
    if (scope.resultType !== 'COOLDOWN_DURATION_MODIFIER') throw new Error('测试形状');
    if (mode === 'missing_cooldown') ordinary.processes[0]!.cooldown = null;
    if (mode === 'basic_attack') scope.detail.affectedSkillScope.skillKeys = [source.skillConfigurations[0]!.skill.skillKey];
    if (mode === 'foreign_skill') scope.detail.affectedSkillScope.skillKeys = ['not_owned'];
    if (mode === 'missing_manifest') source.source.skillSources = source.source.skillSources.filter(row => row.skillKey !== 'sample_active');
    if (mode === 'forged_deferred') source.source.skillSources.find(row => row.skillKey === 'sample_active')!.inactiveReason = 'ACTIVE_DEFERRED';
    expect(() => assemble(source)).toThrow();
  });
  it.each([0, -1, Infinity, NaN])('冷却倍率拒绝%s，不能变相转为急速', value => {
    const source = effect('different_active'); source.results[0]!.valueRule!.value = fixedValue(value);
    expect(() => compileCooldownDurationEffect(source, state(), 'definition')).toThrow();
  });
  it.each([
    { value: fixedValue(0), fixedMultiplier: 1, fixedMinValue: .5, fixedMaxValue: null },
    { value: fixedValue(-2), fixedMultiplier: -.25, fixedMinValue: null, fixedMaxValue: null }
  ])('冷却倍率按完整规则而非原始固定值决定资格', rule => {
    const source = effect('different_active'); source.results[0]!.valueRule = rule;
    expect(compileCooldownDurationEffect(source, state(), 'definition').provider.modifiers![0]!.value).toEqual({ op: 'const', value: .5 });
  });
  it('1合法且空作用范围由后续实际绑定决定；操作、分类范围和结果盾资格严格拒绝', () => {
    const source = effect('different_active'); source.results[0]!.valueRule!.value = fixedValue(1);
    expect(compileCooldownDurationEffect(source, state(), 'definition').provider.modifiers![0]).toMatchObject({ kind: 'cooldown_duration', value: { op: 'const', value: 1 }, affectedAbilityRefs: [] });
    Object.assign(source.results[0]!.detail, { operation: 'DECREASE' });
    expect(() => compileCooldownDurationEffect(source, state(), 'definition')).toThrow();
  });
});

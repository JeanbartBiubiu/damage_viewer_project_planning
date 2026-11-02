import { describe, expect, it } from 'vitest';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { fixedValue } from '../types/numericValue';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { SkillEffect } from '../types/skillEffect';
import { inspectSimulationSnapshot, assembleSimulation } from './simulationAdapter';
import { naturalRuleKeys, plannedSkillRuleKeys } from './simulation/sources/description';

function sync(snapshot: SimulationSnapshot) {
  syncSimulationSkillSources(snapshot);
  for (const source of snapshot.source.skillSources) {
    if (!source.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel === 0 || source.inactiveReason === 'NO_AUTONOMOUS_ATTACK') continue;
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === source.skillKey)!;
    const plan = snapshot.selection.plannedSkills.find(row => row.skillKey === source.skillKey);
    source.enabledRuleKeys = [...new Set([...naturalRuleKeys(snapshot, configuration, 'source'),
      ...(plan ? plannedSkillRuleKeys(configuration, plan.phaseKinds) : [])])].sort();
    source.inactiveReason = source.enabledRuleKeys.length ? null : 'ACTIVE_DEFERRED';
  }
  return snapshot;
}
function sample() {
  const snapshot = simulationActiveSample(), active = snapshot.skillConfigurations[1]!;
  snapshot.selection.basicAttackSkillKey = snapshot.skillConfigurations[0]!.skill.skillKey;
  snapshot.selection.basicAttackLevel = 1;
  const zone = { gameId: snapshot.gameId, name: '自身属性', domain: 'ATTRIBUTE' as const, status: 'ENABLED' as const,
    description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
  snapshot.catalogs.modifierZones.push({ ...zone, modifierZoneKey: 'flat', calculationMode: 'FLAT_ADD', applicationStage: 'ATTRIBUTE_FLAT' },
    { ...zone, modifierZoneKey: 'total', calculationMode: 'RATIO_MULTIPLY', applicationStage: 'ATTRIBUTE_PERCENT' });
  const window: SkillEffect = { ...structuredClone(active.effects[0]!), effectKey: 'window', name: '有限自身攻击力',
    lifecycle: { durationValue: fixedValue(3000), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
      instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE',
      periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null },
    results: [10, .25].map((value, index) => ({ resultKey: `ad_${index}`, name: '攻击力', resultType: 'ATTRIBUTE_CHANGE',
      target: 'SOURCE', description: null, sortOrder: index, spellShieldBlockScope: null,
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null },
      valueRule: { value: fixedValue(value), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      detail: { attributeKey: 'attack_damage', operation: 'INCREASE', modifierZoneKey: index === 0 ? 'flat' : 'total' } })) };
  const maintain: SkillEffect = { ...structuredClone(window), effectKey: 'maintain', name: '至少保留余时', lifecycle: null,
    results: [{ resultKey: 'ensure', name: '至少2500毫秒', resultType: 'LIFECYCLE_OPERATION', target: 'SOURCE', description: null, sortOrder: 0,
      lifecycleBehavior: null, spellShieldBlockScope: null,
      valueRule: { value: fixedValue(2500), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      detail: { operation: 'ENSURE_REMAINING', targetEffectKey: window.effectKey } }] };
  const passive: SkillEffect = { ...structuredClone(window), effectKey: 'passive', name: '初始化双抗',
    lifecycle: { ...window.lifecycle!, durationValue: null, expiryMode: 'EXPLICIT_ONLY', reapplicationDurationMode: null },
    results: [{ ...structuredClone(window.results[0]!), resultKey: 'armor', detail: { attributeKey: 'armor', operation: 'INCREASE', modifierZoneKey: 'flat' } }] };
  active.effects.push(window, maintain, passive);
  active.processes[0]!.effectBindings.push({ bindingKey: 'window', effectKey: window.effectKey, sortOrder: 0,
    moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } });
  const rule = structuredClone(active.triggerRules[1]!);
  rule.ruleKey = 'ensure_on_attack'; rule.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
  rule.actions = [{ actionKey: 'ensure', name: '保持期限', sortOrder: 0, actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'maintain' },
    targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }];
  active.triggerRules.push(rule, { ...structuredClone(rule), ruleKey: 'initialize', eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} },
    actions: [{ ...structuredClone(rule.actions[0]!), targetContext: 'EVENT_SOURCE', detail: { effectKey: 'passive' } }] });
  return sync(snapshot);
}
function compile(snapshot: SimulationSnapshot) {
  approveSnapshotFixture(snapshot);
  const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(snapshot, attributes, { source: 250, target: 500 });
}
function operations(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(operations);
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  return [...(row.operation === 'provider_duration_change' ? [row] : []), ...Object.values(row).flatMap(operations)];
}
describe('同来源有期属性至少保留剩余时长', () => {
  it('与真实主动施加复用完整定义，显式自己整体乘数可大于1', () => {
    const compiled = compile(sample()).compileRequest;
    const operation = operations(compiled)[0]!;
    expect(operation).toMatchObject({ operation: 'provider_duration_change', target: 'self', valuePolicy: 'ensure_remaining', amount: { op: 'const', value: 2500 } });
    const target = compiled.sharedProviders!.find(row => row.providerKey === operation.providerDefinitionRef)!;
    expect(target.modifiers!.map(row => row.valuePolicy)).toEqual(['add', 'multiply']);
    expect(target.modifiers![1]).toMatchObject({ stage: 'total', value: { op: 'const', value: 1.25 } });
    expect(JSON.stringify(compiled)).toContain('apply_provider');
  });
  it.each([false, true])('R未计划时保留初始化属性、过滤普攻及E施放纯维护根，背景普攻=%s', noAttack => {
    const snapshot = sample(), active = snapshot.skillConfigurations[1]!;
    const other = JSON.parse(JSON.stringify(active).replaceAll('sample_active', 'other_active')) as typeof active;
    other.effects = other.effects.slice(0, 1); other.triggerRules = other.triggerRules.slice(0, 2); other.processes[0]!.effectBindings = [];
    snapshot.skillConfigurations.push(other);
    snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[1]!, skillKey: 'other_active' });
    snapshot.selection.sourceSkillSettings.push({ ...snapshot.selection.sourceSkillSettings[0]!, skillKey: 'other_active' });
    snapshot.selection.plannedSkills[0]!.skillKey = 'other_active';
    active.triggerRules.push({ ...structuredClone(active.triggerRules[2]!), ruleKey: 'ensure_on_sibling',
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'other_active', useKind: 'ACTIVE', castPhase: 'INITIAL' } } });
    if (noAttack) { snapshot.selection.basicAttackSkillKey = null; snapshot.selection.basicAttackLevel = null; }
    sync(snapshot);
    expect(naturalRuleKeys(snapshot, active, 'source')).toEqual(['initialize']);
    const compiled = compile(snapshot).compileRequest;
    expect(operations(compiled)).toEqual([]);
    expect(compiled.sharedProviders!.some(row => row.modifiers?.some(modifier => modifier.target === 'self.attr.armor'))).toBe(true);
  });
  it.each(['hp', 'target', 'negative', 'fraction', 'unsafe', 'unknown', 'wrong_context'])('拒绝不支持的组合%s', mode => {
    const snapshot = sample(), active = snapshot.skillConfigurations[1]!, result = active.effects[2]!.results[0]!;
    if (mode === 'hp') (active.effects[1]!.results[0]!.detail as { attributeKey: string }).attributeKey = 'hp';
    if (mode === 'target') active.effects[1]!.results[0]!.target = 'TARGET';
    if (mode === 'negative') result.valueRule!.value = fixedValue(-1);
    if (mode === 'fraction') result.valueRule!.value = fixedValue(.5);
    if (mode === 'unsafe') result.valueRule!.value = fixedValue(Number.MAX_SAFE_INTEGER + 1);
    if (mode === 'unknown' && result.resultType === 'LIFECYCLE_OPERATION') result.detail.targetEffectKey = 'absent';
    if (mode === 'wrong_context') active.triggerRules[2]!.actions[0]!.targetContext = 'EVENT_SOURCE';
    sync(snapshot); expect(() => compile(snapshot)).toThrow();
  });
  it('未计划主动的混合规则必须报告，不能过滤其它动作', () => {
    const snapshot = sample(), active = snapshot.skillConfigurations[1]!;
    snapshot.selection.plannedSkills = [];
    active.triggerRules[2]!.actions.push({ ...structuredClone(active.triggerRules[1]!.actions[0]!), actionKey: 'other' });
    sync(snapshot); expect(() => compile(snapshot)).toThrow('不能静默丢弃');
  });
});

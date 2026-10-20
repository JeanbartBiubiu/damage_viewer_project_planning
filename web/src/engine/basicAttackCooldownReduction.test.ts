import { describe, expect, it } from 'vitest';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import { fixedValue } from '../types/numericValue';
import type { SkillEffect } from '../types/skillEffect';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { inspectSimulationSnapshot, assembleSimulation } from './simulationAdapter';
import { naturalRuleKeys, plannedSkillRuleKeys } from './simulationSkillSourceDescription';
import { bindBasicAttackCooldownReductions } from './basicAttackCooldownReduction';

function sync(snapshot: SimulationSnapshot) {
  syncSimulationSkillSources(snapshot);
  for (const source of snapshot.source.skillSources) {
    if (!source.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel === 0) continue;
    if (source.inactiveReason === 'NO_AUTONOMOUS_ATTACK') continue;
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === source.skillKey)!;
    const plan = snapshot.selection.plannedSkills.find(row => row.skillKey === source.skillKey);
    source.enabledRuleKeys = [...new Set([...naturalRuleKeys(snapshot, configuration, 'source'),
      ...(plan ? plannedSkillRuleKeys(configuration, plan.phaseKinds) : [])])].sort();
    source.inactiveReason = source.enabledRuleKeys.length ? null : 'ACTIVE_DEFERRED';
  }
  return snapshot;
}
function sample() {
  const snapshot = simulationActiveSample();
  snapshot.selection.basicAttackSkillKey = snapshot.skillConfigurations[0]!.skill.skillKey;
  snapshot.selection.basicAttackLevel = 1;
  const active = snapshot.skillConfigurations[1]!;
  active.processes[0]!.cooldown!.durationValue = fixedValue(7000);
  const result: SkillEffect = { ...structuredClone(active.effects[0]!), effectKey: 'reduce_own', name: '减少自身普通冷却',
    results: [{ resultKey: 'remaining', name: '减少剩余毫秒', resultType: 'COOLDOWN_CHANGE', target: 'SOURCE', description: null, sortOrder: 0,
      lifecycleBehavior: null, spellShieldBlockScope: null,
      valueRule: { value: fixedValue(1000), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      detail: { operation: 'REDUCE', affectedSkillScope: { mode: 'SKILLS', skillKeys: [active.skill.skillKey], skillCategoryKeys: [] } } }] };
  active.effects.push(result);
  active.triggerRules.push({ ...structuredClone(active.triggerRules[1]!), ruleKey: 'attack_reduces_own', sortOrder: 2,
    eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
    actions: [{ actionKey: 'reduce', name: '普攻命中减少自身冷却', sortOrder: 0, actionType: 'EXECUTE_EFFECT',
      detail: { effectKey: 'reduce_own' }, targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }] });
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
  return [...(row.operation === 'cooldown_change' ? [row] : []), ...Object.values(row).flatMap(operations)];
}

describe('真实普攻命中减少自身主动剩余冷却', () => {
  it('按同拥有者、实际挂载和INITIAL引用绑定，不拼技能专用能力名称', () => {
    const value = compile(sample());
    const binding = value.compileRequest.rules.skillActionBindings![0]!;
    expect(operations(value.compileRequest)).toEqual([expect.objectContaining({ operation: 'cooldown_change', target: 'self',
      valuePolicy: 'reduce', amount: { op: 'const', value: 1000 }, abilityRef: binding.controls.find(row => row.action === 'INITIAL')!.abilityRef })]);
    const definition = value.compileRequest.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!;
    expect(definition.abilities!.some(row => row.kind === 'passive_listener')).toBe(true);
    expect(definition.abilities!.some(row => row.processControl?.action === 'INITIAL')).toBe(true);
  });
  it.each(['unplanned', 'disabled', 'unlearned', 'no_attack'])('%s场景不安装普攻减冷却监听', mode => {
    const snapshot = sample();
    if (mode === 'no_attack') { snapshot.selection.basicAttackSkillKey = null; snapshot.selection.basicAttackLevel = null; }
    else snapshot.selection.plannedSkills = [];
    if (mode === 'disabled') snapshot.selection.sourceSkillSettings[0]!.enabled = false;
    if (mode === 'unlearned') snapshot.selection.sourceSkillSettings[0]!.skillLevel = 0;
    sync(snapshot);
    expect(operations(compile(snapshot).compileRequest)).toEqual([]);
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity])('拒绝非法毫秒金额%s', milliseconds => {
    const snapshot = sample(); snapshot.skillConfigurations[1]!.effects[1]!.results[0]!.valueRule!.value = fixedValue(milliseconds);
    expect(() => compile(snapshot)).toThrow();
  });
  it('0毫秒合法，按完整值规则核对实际金额', () => {
    const snapshot = sample(); snapshot.skillConfigurations[1]!.effects[1]!.results[0]!.valueRule!.value = fixedValue(0);
    expect(operations(compile(snapshot).compileRequest)[0]!.amount).toEqual({ op: 'const', value: 0 });
  });
  it.each(['foreign', 'category', 'target', 'wrong_event', 'wrong_context', 'missing_cooldown', 'dynamic'])('拒绝越界%s', mode => {
    const snapshot = sample(), active = snapshot.skillConfigurations[1]!, result = active.effects[1]!.results[0]!;
    if (result.resultType !== 'COOLDOWN_CHANGE') throw new Error('测试形状');
    if (mode === 'foreign') result.detail.affectedSkillScope.skillKeys = [snapshot.skillConfigurations[0]!.skill.skillKey];
    if (mode === 'category') result.detail.affectedSkillScope = { mode: 'ALL', skillKeys: [], skillCategoryKeys: [] };
    if (mode === 'target') result.target = 'TARGET';
    if (mode === 'wrong_event') active.triggerRules[2]!.eventSource = { eventType: 'BASIC_ATTACK_START', detail: {} };
    if (mode === 'wrong_context') active.triggerRules[2]!.actions[0]!.targetContext = 'EVENT_SOURCE';
    if (mode === 'missing_cooldown') active.processes[0]!.cooldown = null;
    if (mode === 'dynamic') {
      active.formulas.push({ ...snapshot.skillConfigurations[0]!.formulas[0]!, skillKey: active.skill.skillKey, formulaKey: 'dynamic',
        expression: skillFormulaDefinition(active.skill.skillKey, { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'attack_damage', attributeValueKind: 'TOTAL' }) });
      result.valueRule!.value = { kind: 'FORMULA', formulaKey: 'dynamic' };
    }
    sync(snapshot);
    expect(() => compile(snapshot)).toThrow();
  });
  it('未计划主动的混合规则不静默丢弃减冷却或其它动作', () => {
    const snapshot = sample(), active = snapshot.skillConfigurations[1]!;
    active.triggerRules[2]!.actions.push({ ...structuredClone(active.triggerRules[1]!.actions[0]!), actionKey: 'other_damage' });
    snapshot.selection.plannedSkills = []; sync(snapshot);
    expect(() => compile(snapshot)).toThrow('不能静默丢弃');
  });
  it('同技能其它挂载不能替代真正主动来源', () => {
    const operation = { operation: 'cooldown_change', target: 'self', valuePolicy: 'reduce', amount: { op: 'const', value: 1000 } } as const;
    expect(() => bindBasicAttackCooldownReductions([{ side: 'source', skillKey: 'ordinary', providerRef: 'actual_origin',
      definitionRef: 'actual_definition', authorPath: 'result', operation }], [{ bindingKey: 'other', source: 'source',
      skillKey: 'ordinary', providerRef: 'other_origin', providerDefinitionRef: 'other_definition', controls: [], hitBindings: [] }], [])).toThrow('同实际来源');
  });
});

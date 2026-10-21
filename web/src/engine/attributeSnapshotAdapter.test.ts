import { describe, expect, it } from 'vitest';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { assertAttributeSnapshotOutputShape } from './attributeSnapshotContract';
import type { DoneResult } from '../types/genericEngine';

const cases = loadMechanismCases();
function fixture(key: string) {
  const definition = cases.find(row => row.caseKey === key)!;
  return { snapshot: definition.buildSnapshot(), scenario: definition.scenario };
}
function compile(key: string) {
  const { snapshot, scenario } = fixture(key);
  approveSnapshotFixture(snapshot);
  return { snapshot, scenario, prepared: assembleSimulation(snapshot, { source: {}, target: {} }, scenario.initialHealth) };
}

describe('自身盾到期与双端属性快照的生产装配', () => {
  it('两个作者结果只组装一个实际目标候选、同一实例两项冻结修正及双结果覆盖', () => {
    const { prepared } = compile('attribute_paired_snapshot_refresh');
    const candidates = prepared.compileRequest.sharedProviders!.flatMap(provider => provider.abilities ?? [])
      .flatMap(ability => ability.operations ?? []).flatMap(operation => operation.skillHit?.skillKey === 'lab_transfer' ? operation.skillHit.candidates : []);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ semantic: { target: 'TARGET', resultType: 'ATTRIBUTE_CHANGE', moment: 'PERSISTENT' }, spellShieldBlockScope: 'SKILL' });
    const definition = prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === candidates[0]!.operations[0]!.providerDefinitionRef)!;
    expect(definition.lifecycle).toMatchObject({ instanceScope: 'source_target', maxStacks: 1, refreshPolicy: 'replace' });
    expect(definition.modifiers).toEqual([
      expect.objectContaining({ modifierKey: 'target_slow', target: 'self.attr.move_speed', stage: 'total', valueReadMode: 'APPLICATION_SNAPSHOT', value: { op: 'const', value: 0.8 } }),
      expect.objectContaining({ modifierKey: 'source_gain', target: 'opponent.attr.move_speed', valueReadMode: 'APPLICATION_SNAPSHOT', value: expect.objectContaining({ op: 'ref' }) })
    ]);
    for (const key of ['target_slow', 'source_gain']) expect(prepared.coverage.some(row => row.authorPath.endsWith(`results.${key}`) && row.compiledPath.includes('.modifiers['))).toBe(true);
  });

  it.each(['foreign_ratio', 'current_health', 'source_block', 'third_result'] as const)('双端完整图拒绝变异：%s', variant => {
    const { snapshot, scenario } = fixture('attribute_paired_snapshot_refresh');
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_transfer')!;
    if (variant === 'foreign_ratio') configuration.formulas[0]!.expression.stages[0]!.expression = { op: 'mul', args: [{ op: 'read', inputKey: 'speed' }, { op: 'const', value: '0.2' }] };
    if (variant === 'current_health') {
      const binding = configuration.formulas[0]!.expression.inputs[0]!.binding;
      if (binding.kind === 'attribute') binding.valueKind = 'CURRENT';
    }
    if (variant === 'source_block') configuration.effects[0]!.results[1]!.spellShieldBlockScope = 'SKILL';
    if (variant === 'third_result') configuration.effects[0]!.results.push({ ...configuration.effects[0]!.results[1]!, resultKey: 'extra' });
    approveSnapshotFixture(snapshot);
    expect(() => assembleSimulation(snapshot, { source: {}, target: {} }, scenario.initialHealth)).toThrow();
  });

  it('双端修改明确要求来源初始属性，缺值不能作为零安装增量', () => {
    const { snapshot, scenario } = fixture('attribute_paired_snapshot_refresh');
    delete snapshot.source.selectedLevelValues.move_speed;
    delete snapshot.source.attributes.levelValues['1']!.move_speed;
    approveSnapshotFixture(snapshot);
    expect(inspectSimulationSnapshot(snapshot).requirements).toContainEqual(expect.objectContaining({ side: 'source', storedValue: undefined, attribute: expect.objectContaining({ attributeKey: 'move_speed' }) }));
    expect(() => assembleSimulation(snapshot, { source: {}, target: {} }, scenario.initialHealth)).toThrow(/source.move_speed/);
    expect(() => assembleSimulation(snapshot, { source: { move_speed: 300 }, target: {} }, scenario.initialHealth)).not.toThrow();
  });

  it('实际扣血条件只映射真实受击的冻结生命损失，不能用扣盾或防御后伤害代替', () => {
    const { snapshot, scenario } = fixture('defense_own_counter_shield_restart');
    const rule = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_guard')!.triggerRules.find(row => row.ruleKey === 'damaged')!;
    const condition = rule.conditionGroups[0]!.conditions[0]!;
    if (condition.conditionType !== 'EVENT_VALUE_COMPARE') throw new Error('缺少事件条件');
    condition.detail.eventValueKey = 'ACTUAL_HP_LOSS';
    approveSnapshotFixture(snapshot);
    const prepared = assembleSimulation(snapshot, { source: {}, target: {} }, scenario.initialHealth);
    const listener = prepared.compileRequest.sharedProviders!.flatMap(provider => provider.abilities ?? [])
      .find(ability => ability.listenerSpec?.eventMatcher.all.includes('event/damage_taken'))!;
    expect(listener.listenerSpec!.condition).toEqual({ op: 'gt', args: [{ op: 'read', path: 'event.damage.actualHpLoss' }, { op: 'const', value: 0 }] });
  });

  it('回盾只生成一条完整shield回调，初始化沿同身份金额；正伤害读取防御后冻结值', () => {
    const { prepared } = compile('defense_own_counter_shield_restart');
    const guard = prepared.compileRequest.sharedProviders!.find(provider => provider.skillKey === 'lab_guard' && provider.kind === 'character')!;
    const field = guard.initialStateSchema!.wait;
    expect(field).toMatchObject({ valueType: 'integer', defaultValue: 0, maxValue: 1, durationMs: 1500, refreshPolicy: 'refresh_on_write' });
    if (typeof field !== 'object') throw new Error('缺少完整状态');
    expect(field.onExpire).toHaveLength(1);
    expect(field.onExpire![0]).toMatchObject({ operation: 'shield', target: 'self' });
    const initialized = guard.abilities!.find(ability => ability.listenerSpec?.eventMatcher.all.includes('event/source_initialized'))!;
    expect(initialized.listenerSpec!.operations).toEqual(field.onExpire);
    const damaged = guard.abilities!.find(ability => ability.listenerSpec?.eventMatcher.all.includes('event/damage_taken'))!;
    expect(damaged.listenerSpec!.condition).toEqual({ op: 'gt', args: [{ op: 'read', path: 'event.damage.mitigatedAmount' }, { op: 'const', value: 0 }] });
    const linked = prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === field.onExpire![0]!.shieldLifecycleProviderDefinitionRef)!;
    expect(linked.modifiers).toEqual([expect.objectContaining({ modifierKey: 'lab_armor/extra', target: 'self.attr.armor', stage: 'total', value: { op: 'const', value: 1.1818181818181819 } })]);
    expect(JSON.stringify(prepared.compileRequest)).not.toContain('requiredShield');
    expect(prepared.compileRequest.sharedProviders!.some(provider => provider.providerKey.endsWith('/shield_armor/extra'))).toBe(false);
    expect(prepared.coverage.some(row => row.authorPath.endsWith('.detail.requiredShield') && row.compiledPath.includes('.modifiers[0]'))).toBe(true);
  });

  it('依赖盾保留全声明技能等级静态共同公式的原生预检，不依赖别场缓存', () => {
    const { snapshot, scenario } = fixture('defense_own_counter_shield_restart');
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_armor')!;
    configuration.skill.maxLevel = 2;
    configuration.parameters.push({ gameId: snapshot.gameId, skillKey: 'lab_armor', parameterKey: 'ratio', name: '比例',
      valueMode: 'SKILL_LEVEL', valueType: 'DECIMAL', fixedValue: null, levelValues: { '1': 0.1, '2': 0.3 }, description: null, sortOrder: 0, createdAt: '', updatedAt: '' });
    configuration.formulas.push({ gameId: snapshot.gameId, skillKey: 'lab_armor', formulaKey: 'extra', name: '额外盾倍率',
      expression: { inputs: [{ key: 'r', binding: { kind: 'parameter', skillKey: 'lab_armor', parameterKey: 'ratio' } }],
        stages: [{ key: 'out', name: '额外倍率', expression: { op: 'sub', args: [{ op: 'div', args: [
          { op: 'add', args: [{ op: 'const', value: '1' }, { op: 'mul', args: [{ op: 'const', value: '3' }, { op: 'read', inputKey: 'r' }] }] },
          { op: 'add', args: [{ op: 'const', value: '1' }, { op: 'read', inputKey: 'r' }] }] }, { op: 'const', value: '1' }] } }], outputStageKey: 'out' },
      description: null, sortOrder: 0, createdAt: '', updatedAt: '' });
    configuration.effects[1]!.results[0]!.valueRule!.value = { kind: 'FORMULA', formulaKey: 'extra' };
    approveSnapshotFixture(snapshot);
    const prepared = assembleSimulation(snapshot, { source: {}, target: {} }, scenario.initialHealth);
    const modifier = prepared.compileRequest.sharedProviders!.flatMap(provider => provider.modifiers ?? []).find(row => row.modifierKey === 'lab_armor/extra')!;
    expect(modifier.value.value).toBeCloseTo(13 / 11, 12);
    expect(prepared.compileRequest.formulas!.filter(formula => formula.skillKey === 'lab_armor' && formula.key.endsWith('/extra')).length).toBeGreaterThanOrEqual(2);
  });

  it.each(['shield_closed', 'armor_unlearned'] as const)('真实关闭或零级依赖不产生额外属性：%s', variant => {
    const { snapshot, scenario } = fixture('defense_own_counter_shield_restart');
    const key = variant === 'shield_closed' ? 'lab_guard' : 'lab_armor';
    const source = snapshot.target.skillSources.find(row => row.skillKey === key)!;
    const setting = snapshot.selection.targetSkillSettings.find(row => row.skillKey === key)!;
    source.enabledRuleKeys = [];
    if (variant === 'shield_closed') { source.enabled = false; setting.enabled = false; source.inactiveReason = 'SCENE_DISABLED'; }
    else { source.skillLevel = 0; setting.skillLevel = 0; source.inactiveReason = 'UNLEARNED'; }
    approveSnapshotFixture(snapshot);
    const prepared = assembleSimulation(snapshot, { source: {}, target: {} }, scenario.initialHealth);
    expect(prepared.compileRequest.sharedProviders!.flatMap(provider => provider.modifiers ?? []).some(modifier => modifier.modifierKey === 'lab_armor/extra')).toBe(false);
    if (variant === 'shield_closed') expect(prepared.compileRequest.sharedProviders!.flatMap(provider => provider.modifiers ?? []).some(modifier => modifier.modifierKey === 'base')).toBe(true);
  });

  it.each([null, { skillKey: 'lab_guard', effectKey: 'guard' }, { skillKey: 'lab_guard', effectKey: 'guard', resultKey: 'barrier', extra: true }])('拒绝不完整或显式空依赖', dependency => {
    const { snapshot, scenario } = fixture('defense_own_counter_shield_restart');
    const result = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_armor')!.effects[1]!.results[0]!;
    if (result.resultType !== 'ATTRIBUTE_CHANGE') throw new Error('缺少属性');
    Object.assign(result.detail, { requiredShield: dependency });
    approveSnapshotFixture(snapshot);
    expect(() => assembleSimulation(snapshot, { source: {}, target: {} }, scenario.initialHealth)).toThrow(/依赖盾/);
  });

  it('依赖盾属性不能从有条件初始化静默改成无条件跟盾生效', () => {
    const { snapshot, scenario } = fixture('defense_own_counter_shield_restart');
    const rule = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_armor')!.triggerRules[0]!;
    rule.conditionGroups = [{ groupKey: 'qualified', name: '仅半血', sortOrder: 0, conditions: [{ conditionKey: 'hp', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 0,
      detail: { subject: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO', comparator: 'LTE', comparisonValue: { kind: 'FIXED', value: 0.5 } } }] }];
    approveSnapshotFixture(snapshot);
    expect(() => assembleSimulation(snapshot, { source: {}, target: {} }, scenario.initialHealth)).toThrow(/依赖盾属性只接唯一无条件/);
  });

  it('修正快照允许合法零，拒绝空值、数组及非有限金额', () => {
    const done = { finalSnapshot: { combatants: [{ providers: [{ modifierSnapshots: { gain: 0, factor: 0.8 } }] }] } } as unknown as DoneResult;
    expect(() => assertAttributeSnapshotOutputShape(done)).not.toThrow();
    for (const value of [null, [], { gain: NaN }, { gain: '0' }, { gain: -1 }]) {
      Object.assign(done.finalSnapshot.combatants[0]!.providers[0]!, { modifierSnapshots: value });
      expect(() => assertAttributeSnapshotOutputShape(done)).toThrow(/modifierSnapshots/);
    }
  });
});

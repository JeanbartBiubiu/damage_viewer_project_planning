import { describe, expect, it } from 'vitest';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { recurveBowConfiguration, triggeredEquipmentSimulationSample } from '../../tests/fixtures/simulationTriggeredEquipment';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import { compileNaturalRestoration } from './naturalRestoration';
import { assembleNaturalSkillSources } from './simulationNaturalSkillSources';

function sample(event: 'DAMAGE_DEALT' | 'DAMAGE_TAKEN' | 'BASIC_ATTACK_START' | 'DAMAGE_PENDING' = 'DAMAGE_DEALT') {
  const snapshot = triggeredEquipmentSimulationSample([], []), config = recurveBowConfiguration();
  const result = config.effects[0]!.results[0]!;
  config.effects[0]!.results = [{ ...result, resultType: 'DIRECT_HEAL', target: 'SOURCE', detail: {},
    resultKey: 'heal', valueRule: { value: { kind: 'FIXED', value: 30 }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null } },
  { ...result, resultType: 'RESOURCE_CHANGE', target: 'SOURCE', detail: { attributeKey: 'mana', operation: 'RESTORE' },
    resultKey: 'mana', sortOrder: 20, valueRule: { value: { kind: 'FIXED', value: 12 }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null } }];
  config.triggerRules[0]!.eventSource = event === 'DAMAGE_DEALT' || event === 'DAMAGE_TAKEN' || event === 'DAMAGE_PENDING'
    ? { eventType: event, detail: { sourceSkillKey: snapshot.selection.basicAttackSkillKey, damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT' } }
    : { eventType: event, detail: {} };
  config.triggerRules[0]!.conditionGroups = [{ groupKey: 'kill', name: '本笔实际击杀', sortOrder: 0,
    conditions: [{ conditionKey: 'killed', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 0,
      detail: { eventValueKey: 'KILLED', comparator: 'EQ', comparisonValue: { kind: 'FIXED', value: 1 } } }] }];
  snapshot.skillConfigurations.push(config);
  snapshot.source.attachedSkills.push({ gameId: snapshot.gameId, characterKey: snapshot.source.character.characterKey,
    characterName: snapshot.source.character.name, skillKey: config.skill.skillKey, skillName: config.skill.name, skillStatus: 'ENABLED', sortOrder: 10 });
  snapshot.selection.sourceSkillSettings.push({ origin: { kind: 'CHARACTER', characterKey: snapshot.source.character.characterKey },
    skillKey: config.skill.skillKey, skillLevel: 1, enabled: true });
  if (!snapshot.catalogs.attributes.some(row => row.attributeKey === 'mana')) snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!,
    attributeKey: 'mana', name: '法力', minValue: 0, maxValue: null });
  syncSimulationSkillSources(snapshot);
  return { snapshot, config };
}
function assembled(event: Parameters<typeof sample>[0] = 'DAMAGE_DEALT') {
  const { snapshot, config } = sample(event);
  approveSnapshotFixture(snapshot);
  const result = assembleNaturalSkillSources(snapshot);
  return { snapshot, config, result, listener: result.providers.flatMap(provider => provider.abilities ?? [])
    .find(ability => ability.skillKey === config.skill.skillKey)!.listenerSpec! };
}

describe('真实逐笔击杀条件与自然普通恢复', () => {
  it.each(['DAMAGE_DEALT', 'DAMAGE_TAKEN'] as const)('%s只读真实冻结击杀值并保留完整来源筛选', event => {
    const { listener, result, config } = assembled(event);
    expect(listener.eventMatcher.all).toEqual(expect.arrayContaining([event === 'DAMAGE_DEALT' ? 'event/damage_instance' : 'event/damage_taken',
      event === 'DAMAGE_DEALT' ? 'event/source_owner' : 'event/target_owner', 'physics', 'damage_trait/delivery_basic_attack', 'damage_trait/origin_direct']));
    expect(listener.eventMatcher.all!.some(key => key.startsWith('ability/skill/'))).toBe(true);
    expect(listener.condition).toEqual({ op: 'eq', args: [{ op: 'read', path: 'event.damage.killed' }, { op: 'const', value: 1 }] });
    expect(listener.operations).toMatchObject([{ operation: 'heal', target: 'self', ref: expect.stringContaining('results.heal') },
      { operation: 'resource_change', target: 'self', resourceKey: 'mana', ref: expect.stringContaining('results.mana') }]);
    expect(result.required.source.has('mana')).toBe(true);
    expect(result.triggered.operationOrigins.filter(row => row.skillKey === config.skill.skillKey)).toHaveLength(2);
  });

  it.each(['BASIC_ATTACK_START', 'DAMAGE_PENDING'] as const)('拒绝在%s把缺失击杀事实补为0', event => {
    const { snapshot } = sample(event); approveSnapshotFixture(snapshot);
    expect(() => assembleNaturalSkillSources(snapshot)).toThrow(/真实冻结字段|未接入的事件节点/);
  });

  it('明确0合法，非0/1及缺值比较拒绝', () => {
    for (const value of [0, 2, -1, .5, null]) {
      const { snapshot, config } = sample();
      const condition = config.triggerRules[0]!.conditionGroups[0]!.conditions[0]!;
      if (condition.conditionType !== 'EVENT_VALUE_COMPARE') throw new Error('fixture');
      condition.detail.comparisonValue = value === null ? null as never : { kind: 'FIXED', value };
      approveSnapshotFixture(snapshot);
      if (value === 0) expect(() => assembleNaturalSkillSources(snapshot)).not.toThrow();
      else expect(() => assembleNaturalSkillSources(snapshot)).toThrow();
    }
  });

  it('普通恢复复用原数值规则和共同公式，不绕开倍率与上限', () => {
    const { snapshot, config } = sample();
    config.formulas.push({ gameId: snapshot.gameId, skillKey: config.skill.skillKey, formulaKey: 'amount', name: '静态恢复额', description: null,
      sortOrder: 0, createdAt: '', updatedAt: '', expression: { inputs: [], stages: [{ key: 'amount', name: '金额', expression: { op: 'const', value: '20' } }], outputStageKey: 'amount' } });
    config.effects[0]!.results[0]!.valueRule = { value: { kind: 'FORMULA', formulaKey: 'amount' }, fixedMultiplier: 2, fixedMinValue: 0, fixedMaxValue: 30 };
    approveSnapshotFixture(snapshot);
    const result = assembleNaturalSkillSources(snapshot);
    const operation = result.providers.flatMap(provider => provider.abilities ?? []).find(row => row.skillKey === config.skill.skillKey)!.listenerSpec!.operations![0]!;
    expect(JSON.stringify(operation.amount)).toContain('amount');
    expect(operation.amount).toMatchObject({ op: 'min', args: [expect.anything(), { op: 'const', value: 30 }] });
    expect(result.triggered.formulas.some(row => row.key.endsWith('/amount'))).toBe(true);
  });
});

describe('普通恢复形状不能扩成费用、其它目标或持续', () => {
  function fixture() { const { config } = sample(); return { effect: config.effects[0]!, heal: config.effects[0]!.results[0]!, mana: config.effects[0]!.results[1]! }; }
  it.each(['target', 'duration', 'moment', 'detail', 'consume', 'refund', 'hp'] as const)('拒绝%s且不调用金额求值掩盖非法形状', mutation => {
    const { effect, heal, mana } = fixture(); let result = heal;
    if (mutation === 'target') result.target = 'TARGET';
    if (mutation === 'duration') effect.lifecycle = { durationValue: { kind: 'FIXED', value: 1000 } } as SkillEffect['lifecycle'];
    if (mutation === 'moment') result.lifecycleBehavior = { moment: 'PERSISTENT', valueReadMode: null, stackValueMode: null, reapplicationValueMode: null, periodicExecutionMode: null };
    if (mutation === 'detail') Object.assign(result.detail, { unknown: true });
    if (['consume', 'refund', 'hp'].includes(mutation)) {
      result = mana;
      if (result.resultType !== 'RESOURCE_CHANGE') throw new Error('fixture');
      if (mutation === 'hp') result.detail.attributeKey = 'hp';
      else result.detail.operation = mutation === 'consume' ? 'CONSUME' : 'REFUND';
    }
    expect(() => compileNaturalRestoration(effect, result, 'result', () => { throw new Error('金额不应执行'); })).toThrow(/普通恢复|明细|普通资源恢复/);
  });
  it('合法0保持0，负数恢复明确拒绝', () => {
    const { effect, heal } = fixture();
    expect(compileNaturalRestoration(effect, heal, 'result', () => ({ op: 'const', value: 0 }))).toMatchObject({ amount: { op: 'const', value: 0 } });
    expect(() => compileNaturalRestoration(effect, heal, 'result', () => ({ op: 'const', value: -1 }))).toThrow(/非负/);
    expect(compileNaturalRestoration(effect, { ...heal, resultType: 'DAMAGE' } as SkillEffectResult, 'result', () => { throw new Error('无关'); })).toBeNull();
  });
  it('动态RESTORE未证明下界时拒绝，最终保护下界合法，后续负倍率或负上界不能借局部下界过关', () => {
    const { effect, mana } = fixture();
    const dynamic = { op: 'read' as const, path: 'source.attr.ability_power.resolved' };
    const bounded = { op: 'max' as const, args: [dynamic, { op: 'const' as const, value: 0 }] };
    expect(() => compileNaturalRestoration(effect, mana, 'valueRule', () => dynamic)).toThrow(/最终金额.*非负/);
    expect(compileNaturalRestoration(effect, mana, 'valueRule', () => bounded)).toMatchObject({ amount: bounded });
    expect(() => compileNaturalRestoration(effect, mana, 'valueRule', () => ({ op: 'mul', args: [bounded, { op: 'const', value: -1 }] }))).toThrow(/最终金额.*非负/);
    expect(() => compileNaturalRestoration(effect, mana, 'valueRule', () => ({ op: 'min', args: [bounded, { op: 'const', value: -1 }] }))).toThrow(/最终金额.*非负/);
  });
  it('实际共同动态负公式没有最终下界时拒绝，而作者最终0下界保持原表达式', () => {
    const { snapshot, config } = sample();
    config.formulas = [{ gameId: snapshot.gameId, skillKey: config.skill.skillKey, formulaKey: 'dynamic', name: '动态', description: null,
      sortOrder: 0, createdAt: '', updatedAt: '', expression: { inputs: [{ key: 'ap', binding: { kind: 'attribute', object: 'source', attributeKey: 'hp', valueKind: 'CURRENT', view: 'current_frame' } }],
        stages: [{ key: 'negative', name: '负金额', expression: { op: 'mul', args: [{ op: 'read', inputKey: 'ap' }, { op: 'const', value: '-1' }] } }], outputStageKey: 'negative' } }];
    const mana = config.effects[0]!.results[1]!;
    mana.valueRule = { value: { kind: 'FORMULA', formulaKey: 'dynamic' }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null };
    approveSnapshotFixture(snapshot); expect(() => assembleNaturalSkillSources(snapshot)).toThrow(/最终金额.*非负/);
    mana.valueRule.fixedMinValue = 0;
    approveSnapshotFixture(snapshot); expect(() => assembleNaturalSkillSources(snapshot)).not.toThrow();
    mana.valueRule.fixedMultiplier = -2; mana.valueRule.fixedMinValue = null;
    approveSnapshotFixture(snapshot); expect(() => assembleNaturalSkillSources(snapshot)).toThrow(/最终金额.*非负/);
  });
});

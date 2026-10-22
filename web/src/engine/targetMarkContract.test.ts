import { describe, expect, it } from 'vitest';
import type { DoneResult, OperationDefinition } from '../types/genericEngine';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';
import { assertTargetMarkOutputShape, compiledTargetMark } from './targetMarkContract';
import { initialResourceRequirements, normalizeInitialResourceInputs } from './initialResourceInputs';

const packet = (): OperationDefinition => ({ operation: 'consume_target_mark', target: 'target', ref: 'skills.mark.triggerRules.consume.actions.consume', targetMark: {
  stateKey: 'mark', stateScope: 'provider_target', triggerKind: 'event/skill_hit', triggerAbilityRef: 'source.provider[skill].ability[hit]', damageBlockScope: 'DAMAGE_INSTANCE',
  damage: { operation: 'damage', target: 'target', ref: 'skills.mark.effects.detonate.results.damage', amount: { op: 'const', value: 80 }, damageType: 'magic',
    types: ['damage_trait/delivery_skill', 'damage_trait/origin_direct'], critEligible: false, vampQualification: 'RESOLVED', vampOverrides: [] },
  restore: { operation: 'resource_change', target: 'self', ref: 'skills.mark.effects.detonate.results.restore', resourceKey: 'mana', amount: { op: 'const', value: 60 } }
} });

describe('目标标记结算运输与输出', () => {
  it('完整技能结算允许明确回复，普通攻击分支必须省略回复', () => {
    const operation = packet(); expect(compiledTargetMark(operation, 'test')).toEqual(operation.targetMark);
    operation.targetMark!.triggerKind = 'event/basic_attack_hit';
    expect(() => compiledTargetMark(operation, 'test')).toThrow(/仅技能接触/);
    delete operation.targetMark!.restore;
    expect(compiledTargetMark(operation, 'test')).not.toBeNull();
  });
  it.each(['outer', 'scope', 'ref', 'condition', 'critical', 'restore_hp', 'restore_dynamic', 'restore_null'] as const)('拒绝夹带或缺失%s', mode => {
    const operation = packet();
    if (mode === 'outer') operation.repeatCount = 2;
    if (mode === 'scope') operation.targetMark!.stateScope = 'provider' as 'provider_target';
    if (mode === 'ref') operation.targetMark!.triggerAbilityRef = '';
    if (mode === 'condition') operation.targetMark!.damage.condition = { op: 'const', value: 1 };
    if (mode === 'critical') operation.targetMark!.damage.critEligible = true;
    if (mode === 'restore_hp') operation.targetMark!.restore!.resourceKey = 'hp';
    if (mode === 'restore_dynamic') operation.targetMark!.restore!.amount = { op: 'read', path: 'source.attr.mana.max' };
    if (mode === 'restore_null') operation.targetMark!.restore = null as unknown as OperationDefinition;
    expect(() => compiledTargetMark(operation, 'test')).toThrow();
  });
  it('旧操作明确省略新字段，不能夹带null', () => {
    expect(compiledTargetMark({ operation: 'damage', target: 'target' }, 'test')).toBeNull();
    expect(() => compiledTargetMark({ operation: 'damage', target: 'target', targetMark: null } as unknown as OperationDefinition, 'test')).toThrow(/旧操作不能夹带/);
  });
  it('输出计数必须完整守恒，旧输出保持省略', () => {
    expect(() => assertTargetMarkOutputShape({} as DoneResult)).not.toThrow();
    const done = { targetMarkSummary: { consumedCount: 2, attackCount: 1, skillCount: 1, damageBlockedCount: 1 } } as DoneResult;
    expect(() => assertTargetMarkOutputShape(done)).not.toThrow();
    for (const summary of [null, { consumedCount: 0 }, { ...done.targetMarkSummary, consumedCount: 3 }, { ...done.targetMarkSummary, damageBlockedCount: 3 },
      { ...done.targetMarkSummary, skillCount: .5 }, { ...done.targetMarkSummary, extra: 0 }]) expect(() => assertTargetMarkOutputShape({ targetMarkSummary: summary } as DoneResult)).toThrow();
  });
  it('只为真实已装配技能消费收集法力初值，0合法且不默认满额', () => {
    const snapshot = simulationSample(); snapshot.source.selectedLevelValues.mana = 100;
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'mana', name: '法力', status: 'ENABLED' });
    const operation = packet(), provider = { providerKey: 'mark_definition', kind: 'character', stableId: 'mark', abilities: [
      { abilityKey: 'consume', kind: 'passive_listener', listenerSpec: { eventMatcher: { all: ['event/skill_hit', 'event/source_owner'] }, maxTriggersPerEvent: 1, operations: [operation] } }
    ] };
    const mounts = [{ side: 'source' as const, providerRef: 'mark', definitionRef: 'mark_definition' }];
    const required = initialResourceRequirements(snapshot, [provider], mounts);
    expect(required).toEqual([{ side: 'source', resourceKey: 'mana', resourceName: '法力', maxValue: 100 }]);
    expect(() => normalizeInitialResourceInputs(required, [])).toThrow(/明确填写/);
    expect(normalizeInitialResourceInputs(required, [{ side: 'source', resourceKey: 'mana', current: 0 }])).toEqual([{ side: 'source', resourceKey: 'mana', current: 0 }]);
    delete operation.targetMark!.restore; operation.targetMark!.triggerKind = 'event/basic_attack_hit';
    expect(initialResourceRequirements(snapshot, [provider], mounts)).toEqual([]);
  });
});

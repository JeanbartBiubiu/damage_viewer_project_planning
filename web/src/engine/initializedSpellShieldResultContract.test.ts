import { describe, expect, it } from 'vitest';
import type { CompileRequest, ProviderDefinition } from '../types/genericEngine';
import type { OperationOrigin } from './simulation/model';
import { initializedSpellShieldConsumptionOriginMatches } from './initializedSpellShieldResultContract';

function fixture(side: 'source' | 'target' = 'source') {
  const shield: ProviderDefinition = { providerKey: 'guard_shield_def', stableId: 'guard_shield_def', skillKey: 'guard', kind: 'status',
    types: ['provider/spell_shield'], lifecycle: { maxStacks: 1, refreshPolicy: 'replace' }, listeners: [{ listenerKey: 'consume',
      eventMatcher: { all: ['event/spell_shield_blocked'] }, maxTriggersPerEvent: 1, operations: [{ operation: 'expire_provider',
        target: 'self', providerRefFromEvent: true, ref: 'skills.guard.effects.consume.results.remove' }] }] };
  const parent: ProviderDefinition = { providerKey: 'guard_parent_def', stableId: 'guardian_item', skillKey: 'guard', kind: 'item',
    abilities: [{ abilityKey: 'initialize', skillKey: 'guard', kind: 'passive_listener', listenerSpec: { listenerKey: 'initialize',
      eventMatcher: { all: ['event/source_initialized', 'event/source_owner'] }, maxTriggersPerEvent: 1, operations: [{
        operation: 'apply_provider', target: 'self', providerDefinitionRef: shield.providerKey, providerRef: shield.providerKey,
        ref: 'skills.guard.effects.guard.results.spell_shield' }] } }] };
  const input: CompileRequest = { schemaVersion: 'generic-p0', schemaHash: 'test', rulesHash: 'test', typeCatalog: { types: [], relations: [] },
    combatants: (['source', 'target'] as const).map(key => ({ key, attributes: {}, resources: {},
      providers: key === side ? [{ providerRef: 'guard', definitionRef: parent.providerKey }] : [] })), sharedProviders: [shield, parent], rules: {} };
  const origin: OperationOrigin = { abilityRef: `${side}.provider[${shield.providerKey}]`, operationRef: 'skills.guard.effects.consume.results.remove',
    providerDefinitionRef: shield.providerKey, skillKey: 'guard', effectKey: 'consume', resultKey: 'remove',
    compiledPaths: ['sharedProviders[0].listeners[0].operations[0]'] };
  return { input, origin, parent, shield };
}
type Fixture = ReturnType<typeof fixture>;

describe('初始化法盾的冻结消费来源归属', () => {
  it.each(['source', 'target'] as const)('接受%s自己的唯一父初始化与无独立能力的消费', side => {
    const { input, origin } = fixture(side);
    expect(initializedSpellShieldConsumptionOriginMatches(input, origin)).toBe(true);
  });

  const rejected: Array<[string, (value: Fixture) => void]> = [
    ['不能借用另一方的实际父挂载', value => { value.origin.abilityRef = 'target.provider[guard_shield_def]'; }],
    ['不能以同名作者结果替代另一编译节点', value => { value.origin.compiledPaths[0] = 'sharedProviders[1].abilities[0].listenerSpec.operations[0]'; }],
    ['必须保留真实作者ref而非仅凭expire操作类型', value => { delete value.shield.listeners![0]!.operations![0]!.ref; }],
    ['其它盾实例的静态移除不属于冻结消费', value => { value.shield.listeners![0]!.operations![0]!.providerRef = 'other'; }],
    ['互相矛盾的阻挡匹配器不能变成合法消费', value => { value.shield.listeners![0]!.eventMatcher.none = ['event/spell_shield_blocked']; }],
    ['重复挂载的父来源不能映成唯一消费', value => { value.input.combatants[1]!.providers.push({ providerRef: 'duplicate', definitionRef: value.parent.providerKey }); }],
    ['父独立伤害不能藏在初始化来源中', value => { value.parent.abilities![0]!.operations = [{ operation: 'damage', target: 'target', amount: { op: 'const', value: 10 } }]; }],
    ['子额外伤害不能借冻结消费获得来源准入', value => { value.shield.listeners![0]!.operations!.push({ operation: 'damage', target: 'target', amount: { op: 'const', value: 10 } }); }],
    ['初始化不能改为给其它实例引用施盾', value => { value.parent.abilities![0]!.listenerSpec!.operations![0]!.providerRef = 'other'; }]
  ];
  it.each(rejected)('%s', (_name, mutate) => {
    const value = fixture(); mutate(value);
    expect(initializedSpellShieldConsumptionOriginMatches(value.input, value.origin)).toBe(false);
  });
});

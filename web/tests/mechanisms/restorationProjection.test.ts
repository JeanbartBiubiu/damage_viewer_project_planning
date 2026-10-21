import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CompileRequest, DoneResult, RunRequest } from '../../src/types/genericEngine';
import type { OperationOrigin } from '../../src/engine/simulationAdapter';
import { compareMechanismExpectation } from './mechanismRunner';
import { MECHANISM_ROOT, parseMechanismCase, type MechanismProjection, type ProjectedRestoration } from './mechanismCase';
import { projectRestorations } from './restorationProjection';

const providerRef = 'source_restorer', definitionRef = 'source_restorer_definition';
const abilityRef = `source.provider[${providerRef}].ability[on_kill]`;
function fixture(kind: 'heal' | 'resource_restore' = 'resource_restore') {
  const resource = kind === 'resource_restore', ref = resource ? 'skills.lab_restorer.effects.restore.results.mana' : 'skills.lab_restorer.effects.restore.results.heal';
  const operationPath = 'sharedProviders[0].abilities[0].listenerSpec.operations[0]';
  const compile: CompileRequest = { schemaVersion: 'generic-p0', schemaHash: 'test', rulesHash: 'test', typeCatalog: { types: [], relations: [] },
    combatants: [{ key: 'source', attributes: {}, resources: {}, providers: [{ providerRef, definitionRef }] }, { key: 'target', attributes: {}, resources: {}, providers: [] }],
    sharedProviders: [{ providerKey: definitionRef, stableId: 'lab_restorer', skillKey: 'lab_restorer', kind: 'character', abilities: [{ abilityKey: 'on_kill', skillKey: 'lab_restorer', kind: 'passive_listener',
      listenerSpec: { listenerKey: 'on_kill', eventMatcher: { all: ['event/damage_instance', 'event/source_owner'] },
        operations: [{ operation: resource ? 'resource_change' : 'heal', target: 'self', ref, amount: { op: 'const', value: resource ? 12 : 30 },
          ...(resource ? { resourceKey: 'mana' } : {}) }] } }] }], rules: {} };
  const origin: OperationOrigin = { abilityRef, operationRef: ref, skillKey: 'lab_restorer', effectKey: 'restore', resultKey: resource ? 'mana' : 'heal', compiledPaths: [operationPath] };
  const data: Record<string, unknown> = { owner: 'source', source: 'source', target: 'source', providerRef, providerDefinitionRef: definitionRef,
    abilityRef, operationRef: ref, operationPath, useRef: 'basic:lab:1', ...(resource ? {
      resourceKey: 'mana', requestedAmount: 12, currentBefore: 1, currentAfter: 13, actualDelta: 12, overflow: 0
    } : { category: 'DIRECT', hpBefore: 200, hpAfter: 230, healingBeforeModifiers: 30, healingAfterDone: 30, healingAfterModifiers: 30,
      actualHealing: 30, overheal: 0, modifiers: [] }) };
  const done = { finalSnapshot: { timeMs: 1, processInstances: [] }, attackRecords: [{ useRef: 'basic:lab:1', source: 'source' }],
    damageRecords: [{ useRef: 'basic:lab:1', timeMs: 0, source: 'source', target: 'target' }],
    evidence: { truncated: false, items: [{ timeMs: 0, kind, ref: resource ? ref : abilityRef, data }] } } as unknown as DoneResult;
  const request = { skillUses: [] } as unknown as RunRequest;
  const expected: ProjectedRestoration = { timeMs: 0, kind, owner: 'source', source: 'source', target: 'source', providerRef, providerDefinitionRef: definitionRef,
    abilityRef, operationRef: ref, operationPath, useRef: 'basic:lab:1', resourceKey: resource ? 'mana' : 'hp', requestedAmount: resource ? 12 : 30,
    effectiveAmount: resource ? 12 : 30, currentBefore: resource ? 1 : 200, currentAfter: resource ? 13 : 230, actualDelta: resource ? 12 : 30, overflow: 0 };
  return { compile, origin, request, done, data, expected, project: () => projectRestorations([origin], compile, request, done) };
}

describe('普通恢复完整事实投影', () => {
  it.each(['heal', 'resource_restore'] as const)('%s保留所有原始身份与手算金额，0不是缺值', kind => {
    const f = fixture(kind); expect(f.project()).toEqual([f.expected]);
    const before = kind === 'heal' ? 'hpBefore' : 'currentBefore', after = kind === 'heal' ? 'hpAfter' : 'currentAfter';
    const actual = kind === 'heal' ? 'actualHealing' : 'actualDelta', overflow = kind === 'heal' ? 'overheal' : 'overflow';
    f.data[before] = kind === 'heal' ? 1000 : 50; f.data[after] = f.data[before]; f.data[actual] = 0; f.data[overflow] = f.expected.requestedAmount;
    expect(f.project()[0]).toMatchObject({ currentBefore: f.data[before], currentAfter: f.data[after], actualDelta: 0, overflow: f.expected.requestedAmount });
  });
  it('完整列表不去重，完整期望逐字段及条数比较', () => {
    const f = fixture(); f.done.evidence.items.push(structuredClone(f.done.evidence.items[0]!));
    const projection = { restorations: f.project() } as MechanismProjection;
    expect(projection.restorations).toHaveLength(2);
    expect(compareMechanismExpectation(projection, { restorations: [f.expected] }).join(';')).toContain('实际 2 条');
    for (const field of ['requestedAmount', 'effectiveAmount', 'currentBefore', 'currentAfter', 'actualDelta', 'overflow'] as const) {
      const changed = structuredClone(f.expected); changed[field]++;
      expect(compareMechanismExpectation({ restorations: [f.expected] } as MechanismProjection, { restorations: [changed] }).join(';')).toContain(field);
    }
  });
  it.each(['owner', 'source', 'target', 'providerRef', 'providerDefinitionRef', 'abilityRef', 'operationRef', 'operationPath', 'useRef',
    'resourceKey', 'requestedAmount', 'currentBefore', 'currentAfter', 'actualDelta', 'overflow'])('缺少%s不能补默认身份或0', field => {
    const f = fixture(); delete f.data[field]; expect(f.project).toThrow(/restorations/);
  });
  it.each(['provider', 'path', 'op', 'use', 'amount', 'truncated', 'wrong_owner'])('拒绝%s伪造或不完整事实', mutation => {
    const f = fixture();
    if (mutation === 'provider') f.data.providerDefinitionRef = 'foreign';
    if (mutation === 'path') f.data.operationPath = 'sharedProviders[1].abilities[0].listenerSpec.operations[0]';
    if (mutation === 'op') f.data.operationRef = 'foreign';
    if (mutation === 'use') f.data.useRef = 'foreign';
    if (mutation === 'amount') f.data.actualDelta = 0;
    if (mutation === 'truncated') f.done.evidence.truncated = true;
    if (mutation === 'wrong_owner') f.data.owner = 'target';
    expect(f.project).toThrow(/restorations/);
  });
  it('受伤方恢复保留攻击方原使用，不把原使用来源改成接收者', () => {
    const f = fixture();
    f.compile.combatants[0]!.providers = []; f.compile.combatants[1]!.providers = [{ providerRef, definitionRef }];
    const ref = abilityRef.replace('source.provider', 'target.provider'); f.origin.abilityRef = ref;
    f.compile.sharedProviders![0]!.abilities![0]!.listenerSpec!.eventMatcher.all = ['event/damage_taken', 'event/target_owner'];
    Object.assign(f.data, { owner: 'target', source: 'target', target: 'target', abilityRef: ref });
    expect(f.project()[0]).toMatchObject({ owner: 'target', source: 'target', target: 'target', useRef: 'basic:lab:1' });
  });
  it('不存在普通监听恢复的旧主动heal不加入本批恢复列表', () => {
    const f = fixture('heal'); f.compile.sharedProviders![0]!.abilities![0]!.kind = 'active';
    delete f.compile.sharedProviders![0]!.abilities![0]!.listenerSpec;
    expect(f.project()).toEqual([]);
  });
  it('合法主动resource_restore按其真实编译路径保留原通道，未知或伪造路径不被全局跳过', () => {
    const f = fixture();
    const ability = f.compile.sharedProviders![0]!.abilities![0]!;
    ability.kind = 'active'; ability.operations = ability.listenerSpec!.operations; delete ability.listenerSpec;
    f.data.operationPath = 'sharedProviders[0].abilities[0].operations[0]';
    expect(f.project()).toEqual([]);
    delete ability.operations![0]!.ref; f.data.operationRef = ''; f.done.evidence.items[0]!.ref = abilityRef;
    expect(f.project()).toEqual([]);
    ability.operations![0]!.ref = f.origin.operationRef; f.data.operationRef = f.origin.operationRef; f.done.evidence.items[0]!.ref = f.origin.operationRef;
    f.data.providerDefinitionRef = 'foreign'; expect(f.project).toThrow(/真实原挂载/);
    f.data.providerDefinitionRef = definitionRef; f.data.operationPath = 'sharedProviders[0].abilities[1].operations[0]';
    expect(f.project).toThrow();
    f.data.operationPath = 'sharedProviders[0].abilities[0].operations[0]'; f.data.abilityRef = 'source.provider[unknown].ability[on_kill]';
    expect(f.project).toThrow(/普通监听恢复/);
  });
});

describe('固定恢复期望必须完整而且不伪装数值覆盖', () => {
  const file = resolve(MECHANISM_ROOT, 'cases/basic_attack_kill_rounding.json');
  function parse(restorations: unknown) {
    const original = JSON.parse(readFileSync(file, 'utf8'));
    return parseMechanismCase(Buffer.from(JSON.stringify({ ...original, expected: { restorations } })), file);
  }
  it('接受明确完整事实，遗漏任何字段均拒绝', () => {
    const value = fixture().expected; expect(() => parse([value])).not.toThrow();
    for (const field of Object.keys(value)) {
      const changed = { ...value } as Record<string, unknown>; delete changed[field];
      expect(() => parse([changed]), field).toThrow(/完整恢复/);
    }
    for (const changed of [{ ...value, actualDelta: -1 }, { ...value, timeMs: .5 }, { ...value, providerRef: '' },
      { ...value, source: 'foreign' }, { ...value, useRef: '' }, { ...value, extra: 1 }]) expect(() => parse([changed])).toThrow();
  });
});

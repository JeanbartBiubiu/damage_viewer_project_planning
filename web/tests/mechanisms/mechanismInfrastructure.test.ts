import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MECHANISM_ROOT, parseMechanismCase, loadMechanismCases, type MechanismProjection } from './mechanismCase';
import { compareMechanismExpectation, mechanismEngine, projectMechanismResult, runMechanismCase } from './mechanismRunner';
import { assessContinuousAttackResult } from '../../src/engine/continuousAttackResult';

const file = resolve(MECHANISM_ROOT, 'cases/basic_attack_armor_cadence.json');
const original = JSON.parse(readFileSync(file, 'utf8'));
function parse(expected: unknown) {
  return parseMechanismCase(Buffer.from(JSON.stringify({ ...original, expected })), file);
}

describe('机制覆盖必须有有效的手算数值断言', () => {
  it('新增额度列表实际参与期望比较，数量和每项身份变异都必须报差异', () => {
    const row = { owner: 'source', providerRef: 'actual_parent', groupKey: 'once', scope: 'provider_target' as const,
      useSource: 'source', useSkillKey: 'lab_active', useKey: 'skill:first', target: 'target' };
    const actual = { finalUseTriggerLedger: [row] } as MechanismProjection;
    expect(compareMechanismExpectation(actual, { finalUseTriggerLedger: [row] })).toEqual([]);
    for (const [key, value] of Object.entries({ owner: 'target', providerRef: 'other_parent', groupKey: 'other_group',
      scope: 'provider', useSource: 'target', useSkillKey: 'other_skill', useKey: 'skill:other', target: 'source' })) {
      const wrong = { ...row, [key]: value };
      expect(compareMechanismExpectation(actual, { finalUseTriggerLedger: [wrong] }).join(';'), key).toContain(`finalUseTriggerLedger[0].${key}`);
    }
    expect(compareMechanismExpectation(actual, { finalUseTriggerLedger: [] }).join(';')).toContain('实际 1 条，期望 0 条');
    expect(compareMechanismExpectation({ finalUseTriggerLedger: [] } as unknown as MechanismProjection, { finalUseTriggerLedger: [row] }).join(';')).toContain('实际 0 条，期望 1 条');
  });
  it('完整同次使用额度期望必须保留挂载、范围、真实使用和明确目标，不补缺失身份', () => {
    const row = { owner: 'source', providerRef: 'actual_parent', groupKey: 'once', scope: 'provider_target',
      useSource: 'source', useSkillKey: 'lab_active', useKey: 'skill:first', target: 'target' };
    const expected = { summary: { sourceDamageDealt: 100 }, finalUseTriggerLedger: [row] };
    expect(() => parse(expected)).not.toThrow();
    for (const key of Object.keys(row)) {
      const missing = { ...row } as Record<string, unknown>; delete missing[key];
      expect(() => parse({ ...expected, finalUseTriggerLedger: [missing] }), key).toThrow();
    }
    for (const changed of [{ ...row, scope: 'bad' }, { ...row, target: null }, { ...row, owner: 'foreign' },
      { ...row, useKey: '' }, { ...row, extra: 'ignored' }, { ...row, scope: 'provider' }]) {
      expect(() => parse({ ...expected, finalUseTriggerLedger: [changed] })).toThrow();
    }
    expect(() => parse({ ...expected, finalUseTriggerLedger: [{ ...row, scope: 'provider', target: null }] })).not.toThrow();
  });
  it('状态强度与有效取强期望均要求完整身份、明确0和真实期限，不接受缺值或越界', () => {
    const contribution = { owner: 'target', source: 'source', definitionRef: 'slow_definition', resultRef: 'slow',
      statusKey: 'lab_slow', statusKind: 'movement_slow', strength: 0, appliedAtMs: 1125, expireAt: 3625 };
    const effective = { owner: 'target', statusKind: 'movement_slow', strength: 0 };
    expect(() => parse({ finalStatusContributions: [contribution], finalEffectiveStatuses: [effective] })).not.toThrow();
    for (const key of Object.keys(contribution)) {
      const changed = { ...contribution } as Record<string, unknown>; delete changed[key];
      expect(() => parse({ finalStatusContributions: [changed] }), key).toThrow();
    }
    for (const changed of [{ ...contribution, strength: -.1 }, { ...contribution, strength: 1.1 },
      { ...contribution, appliedAtMs: -1 }, { ...contribution, expireAt: null }, { ...contribution, source: 'foreign' },
      { ...contribution, extra: 0 }]) expect(() => parse({ finalStatusContributions: [changed] })).toThrow();
    expect(() => parse({ finalEffectiveStatuses: [{ ...effective, strength: null }] })).toThrow();
    expect(() => parse({ finalStatusContributions: [{ ...contribution, appliedAtMs: null }] })).not.toThrow();
  });
  it('初始化、额度与冷却投影只接受明确合法字段，不以名称获得覆盖', () => {
    expect(() => parse({ initializations: [{ owner: 'source', max: 1200, current: 1000, value: 200, abilityRef: null, useRef: null }] })).not.toThrow();
    expect(() => parse({ empoweredWindows: [{ maximumAttackCount: 3, consumptionCount: 2, pendingHitCount: 1, finishedAtMs: null }] })).not.toThrow();
    expect(() => parse({ empoweredConsumptions: [{ consumptionIndex: 1, startedAtMs: 1000, hitRef: null, hitSequence: null, resolvedAtMs: null }] })).not.toThrow();
    for (const expected of [{ initializations: [{ abilityRef: 'invented', value: 200 }] }, { initializations: [{ value: -1 }] },
      { empoweredWindows: [{ maximumAttackCount: 65 }] }, { empoweredConsumptions: [{ consumptionIndex: 0 }] },
      { finalCooldowns: [{ owner: 'foreign', readyAtMs: 1 }] }, { finalCooldowns: [{ readyAtMs: -1 }] },
      { empoweredWindows: [{ consumptionCount: 1, unknown: 1 }] }, { initializations: [{ owner: 'source' }] }]) expect(() => parse(expected)).toThrow();
  });
  it.each([{}, { summary: {} }, { damage: [{}] }, { summary: { stopReason: 'duration_reached' } }, { damage: [] }])('拒绝空泛期望 %j', expected => {
    expect(() => parse(expected)).toThrow(/期望|数值断言/);
  });
  it('允许明确的零伤害，并拒绝拼错的断言字段', () => {
    expect(() => parse({ summary: { sourceDamageDealt: 0 } })).not.toThrow();
    expect(() => parse({ summary: { sourceDamage: 0 } })).toThrow(/未定义字段/);
  });
  it('完整实例期望保留归属、层数和期限，缺字段与错误数值不能获得覆盖', () => {
    const provider = { owner: 'target', source: 'source', definitionRef: 'status:lab:root', stacks: 1, expireAt: 1500 };
    expect(() => parse({ finalProviders: [provider] })).not.toThrow();
    expect(() => parse({ finalProviders: [{ ...provider, expireAt: null }] })).not.toThrow();
    for (const key of Object.keys(provider)) {
      const missing = { ...provider } as Record<string, unknown>;
      delete missing[key];
      expect(() => parse({ finalProviders: [missing] }), key).toThrow(/完整实例/);
    }
    for (const malformed of [{ ...provider, stacks: 0 }, { ...provider, expireAt: -1 }, { ...provider, expireAt: 1.5 },
      { ...provider, owner: 'foreign' }, { ...provider, source: 'foreign' }, { ...provider, definitionRef: '' }, { ...provider, extra: 1 }]) {
      expect(() => parse({ finalProviders: [malformed] })).toThrow(/完整实例|未定义字段/);
    }
  });
});

it('完整实例投影不补归属、不隐藏重复，所有数值和列表长度参与比较', async () => {
  const definition = loadMechanismCases().find(row => row.caseKey === 'finite_status_single_active')!;
  const { prepared, runRequest, done, projection } = await runMechanismCase(definition);
  expect(compareMechanismExpectation(projection, definition.expected)).toEqual([]);
  for (const field of ['owner', 'source', 'definitionRef', 'stacks', 'expireAt']) {
    const changed = structuredClone(done);
    const provider = changed.finalSnapshot.combatants.find(row => row.key === 'target')!.providers[0]!;
    delete (provider as unknown as Record<string, unknown>)[field];
    expect(() => projectMechanismResult(prepared.operationOrigins, prepared.compileRequest, runRequest, changed), field).toThrow('实例归属');
  }
  const duplicated = structuredClone(projection);
  duplicated.finalProviders.push({ ...duplicated.finalProviders[duplicated.finalProviders.length - 1]! });
  expect(compareMechanismExpectation(duplicated, definition.expected).join(';')).toContain('finalProviders:');
  const wrongDeadline = structuredClone(projection);
  wrongDeadline.finalProviders[wrongDeadline.finalProviders.length - 1]!.expireAt = 999;
  expect(compareMechanismExpectation(wrongDeadline, definition.expected).join(';')).toContain('expireAt');
}, 60000);

it('独立Generic初始法盾在真实命中资格处阻止有限禁锢和眩晕，不声明作者法盾能力', async () => {
  const definition = loadMechanismCases().find(row => row.caseKey === 'finite_status_single_active')!;
  const { prepared, runRequest } = await runMechanismCase(definition);
  const { client } = await mechanismEngine();
  const input = structuredClone(prepared.compileRequest);
  input.typeCatalog.types.push({ key: 'provider/spell_shield', domain: 'provider' });
  input.sharedProviders!.push({ providerKey: 'infrastructure_spell_shield_definition', kind: 'character',
    stableId: 'infrastructure_spell_shield', types: ['provider/spell_shield'] });
  input.combatants.find(row => row.key === 'target')!.providers.push({
    providerRef: 'infrastructure_spell_shield', definitionRef: 'infrastructure_spell_shield_definition'
  });
  const compiled = await client.compile(input);
  if (!compiled.ok || !compiled.sessionId) throw new Error('独立法盾fresh compile失败：' + JSON.stringify(compiled.errors));
  const sessionId = compiled.sessionId;
  try {
    const request = structuredClone(runRequest);
    request.sessionId = sessionId;
    request.initialSnapshot.combatants.find(row => row.key === 'target')!.providers.push({
      providerRef: 'infrastructure_spell_shield', definitionRef: 'infrastructure_spell_shield_definition',
      owner: 'target', source: 'target', stacks: 1, expireAt: null, state: {}
    });
    const done = await client.run(request);
    expect(done.evidence.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'skill_hit',
      data: expect.objectContaining({ skillKey: 'lab_transfer', blocked: 1, blockScope: 'SKILL' }) })]));
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.providers.map(row => row.definitionRef))
      .toEqual(['infrastructure_spell_shield_definition']);
    expect(done.summary.basicAttack?.hitCount).toBe(1);
    expect(done.summary.sourceDamageDealt).toBe(0);
    expect(await client.run(request)).toEqual(done);
  } finally {
    expect((await client.release(sessionId, input.rulesHash)).released).toBe(true);
  }
}, 60000);

it('角色自然周期必须绑定同拥有者、同技能且实际施加的父来源', async () => {
  const definition = loadMechanismCases().find(row => row.caseKey === 'periodic_finite_damage_expiry')!;
  expect(definition).toBeDefined();
  const { prepared, runRequest, done } = await runMechanismCase(definition);
  for (const kind of ['item', 'character', 'build']) {
    const input = structuredClone(prepared.compileRequest);
    const parent = input.sharedProviders!.find(row => row.skillKey === 'lab_periodic' && row.kind === 'character')!;
    parent.kind = kind;
    const result = assessContinuousAttackResult(input, runRequest, done, prepared.operationOrigins);
    expect(result.complete, result.issues.join(';')).toBe(true);
  }
  for (const corruption of ['kind', 'stableId', 'skillKey', 'application', 'owner'] as const) {
    const input = structuredClone(prepared.compileRequest);
    const parent = input.sharedProviders!.find(row => row.skillKey === 'lab_periodic' && row.kind === 'character')!;
    if (corruption === 'kind') parent.kind = 'status';
    if (corruption === 'stableId') parent.stableId = 'unrelated';
    if (corruption === 'skillKey') for (const ability of parent.abilities ?? []) ability.skillKey = 'other_skill';
    if (corruption === 'application') for (const ability of parent.abilities ?? []) {
      for (const operation of [...(ability.operations ?? []), ...(ability.listenerSpec?.operations ?? [])]) {
        if (operation.operation === 'apply_provider') operation.providerDefinitionRef = 'other_definition';
      }
    }
    if (corruption === 'owner') {
      const source = input.combatants.find(row => row.key === 'source')!;
      const mounted = source.providers.find(row => row.definitionRef === parent.providerKey)!;
      source.providers = source.providers.filter(row => row !== mounted);
      input.combatants.find(row => row.key === 'target')!.providers.push(mounted);
    }
    const result = assessContinuousAttackResult(input, runRequest, done, prepared.operationOrigins);
    expect(result.complete, corruption).toBe(false);
    expect(result.issues.join(';'), corruption).toContain('来源映射');
  }
}, 60000);

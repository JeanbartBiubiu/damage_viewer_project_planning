import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MECHANISM_ROOT, parseMechanismCase, loadMechanismCases } from './mechanismCase';
import { runMechanismCase } from './mechanismRunner';
import { assessContinuousAttackResult } from '../../src/engine/continuousAttackResult';

const file = resolve(MECHANISM_ROOT, 'cases/basic_attack_armor_cadence.json');
const original = JSON.parse(readFileSync(file, 'utf8'));
function parse(expected: unknown) {
  return parseMechanismCase(Buffer.from(JSON.stringify({ ...original, expected })), file);
}

describe('机制覆盖必须有有效的手算数值断言', () => {
  it.each([{}, { summary: {} }, { damage: [{}] }, { summary: { stopReason: 'duration_reached' } }, { damage: [] }])('拒绝空泛期望 %j', expected => {
    expect(() => parse(expected)).toThrow(/期望|数值断言/);
  });
  it('允许明确的零伤害，并拒绝拼错的断言字段', () => {
    expect(() => parse({ summary: { sourceDamageDealt: 0 } })).not.toThrow();
    expect(() => parse({ summary: { sourceDamage: 0 } })).toThrow(/未定义字段/);
  });
});

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

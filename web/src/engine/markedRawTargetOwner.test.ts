import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMechanismCase } from '../../tests/mechanisms/mechanismCase';
import { runMechanismCase } from '../../tests/mechanisms/mechanismRunner';
import { validateMarkedRawDamageAssembly } from './markedRawDamageAssembly';

const cases = ['marked_raw_target_periodic_unmarked', 'marked_raw_target_periodic_opposite_mark'];
function definition(key: string) {
  const file = new URL(`../../tests/mechanisms/cases/${key}.json`, import.meta.url);
  return parseMechanismCase(readFileSync(file), fileURLToPath(file));
}

describe('目标周期与真实拥有者的伤前标记', () => {
  it.each(cases)('%s：目标不借用源方PRIMARY或诅咒', async key => {
    const result = await runMechanismCase(definition(key));
    expect(result.done.summary).toMatchObject({ sourceFinalHp: 970, targetFinalHp: 990, sourceDamageDealt: 10 });
    expect(result.done.damageRecords).toHaveLength(3);
    expect(result.done.damageRecords!.map(row => [row.source, row.target, row.damageType, row.rawAmount])).toEqual([
      ['source', 'target', 'physics', 10], ['target', 'source', 'magic', 15], ['target', 'source', 'magic', 15]
    ]);
    const origin = result.prepared.skillOrigins.find(row => row.side === 'target' && row.skillKey === 'lab_marked_p')!;
    expect([...origin.enabledRuleKeys].sort()).toEqual(['derive_true_on_marked_magic', 'refresh_on_marked_w']);
    const target = result.done.finalSnapshot.combatants.find(actor => actor.key === 'target')!;
    const targetState = target.providerState[origin.providerRef!] as { targetState?: { values: Record<string, number>; expireAt: Record<string, number> } } | undefined;
    expect(targetState?.targetState?.values.curse ?? 0).toBe(0);
    expect(targetState?.targetState?.expireAt.curse).toBeUndefined();
    if (key.endsWith('opposite_mark')) {
      const sourceOrigin = result.prepared.skillOrigins.find(row => row.side === 'source' && row.skillKey === 'lab_marked_p')!;
      const source = result.done.finalSnapshot.combatants.find(actor => actor.key === 'source')!;
      expect(source.providerState[sourceOrigin.providerRef!]).toMatchObject({ targetState: { values: { curse: 1 }, expireAt: { curse: 3000 } } });
    }

    for (const mutation of ['wrong_owner', 'duplicate_owner', 'same_skill_mount', 'fake_primary', 'extra_writer', 'build_owner']) {
      const request = structuredClone(result.prepared.compileRequest), origins = structuredClone(result.prepared.skillOrigins);
      const owned = origins.find(row => row.side === 'target' && row.skillKey === 'lab_marked_p')!;
      const actor = request.combatants.find(row => row.key === 'target')!;
      const provider = request.sharedProviders!.find(row => row.providerKey === owned.definitionRef)!;
      if (mutation === 'wrong_owner') owned.side = 'source';
      if (mutation === 'duplicate_owner') request.combatants.push(structuredClone(actor));
      if (mutation === 'same_skill_mount') actor.providers.push({ providerRef: 'another_mark', definitionRef: owned.definitionRef! });
      if (mutation === 'fake_primary') owned.enabledRuleKeys.push('mark_on_primary_attack');
      if (mutation === 'extra_writer') provider.abilities!.push({ ...structuredClone(provider.abilities![0]!), abilityKey: 'forged_writer' });
      if (mutation === 'build_owner') provider.kind = 'build';
      expect(() => validateMarkedRawDamageAssembly(definition(key).buildSnapshot(), request,
        result.prepared.basicAttackBinding, origins, result.prepared.operationOrigins), mutation).toThrow();
    }
  }, 60000);
});

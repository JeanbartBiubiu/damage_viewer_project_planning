import type { CompileRequest, DoneResult } from '../../src/types/genericEngine';

export type ProjectedStatusContribution = { owner: string; source: string; definitionRef: string; resultRef: string;
  statusKey: string; statusKind: string; strength: number; appliedAtMs: number | null; expireAt: number };
export type ProjectedEffectiveStatus = { owner: string; statusKind: string; strength: number };

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const strength = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function fail(): never { throw new Error('状态投影缺少真实实例身份、施加时间、强度或完整聚合事实'); }

/** 两份实际输出互相核对；不由公式或整场时刻伪造某一实例的强度。 */
export function projectFinalStatuses(compile: CompileRequest, done: DoneResult) {
  const finalStatusContributions: ProjectedStatusContribution[] = [], finalEffectiveStatuses: ProjectedEffectiveStatus[] = [];
  for (const actor of done.finalSnapshot.combatants) {
    const actual = new Map<string, ProjectedStatusContribution>();
    for (const provider of actor.providers) {
      for (const contribution of provider.statusContributions ?? []) {
        const definitions = compile.sharedProviders?.filter(row => row.providerKey === provider.definitionRef) ?? [];
        const definition = definitions[0]?.statusContributions?.filter(row => row.resultRef === contribution.resultRef) ?? [];
        const moment = definition[0]?.valueReadMode === 'MOMENT_EVALUATION';
        if (definitions.length !== 1 || definition.length !== 1 || provider.owner !== actor.key || !['source', 'target'].includes(provider.source)
          || !text(provider.providerRef) || !text(provider.definitionRef) || !text(contribution.resultRef) || !text(contribution.statusKey)
          || contribution.statusKind !== 'movement_slow' || contribution.statusKey !== definition[0]!.statusKey
          || !strength(contribution.strength) || !time(provider.expireAt) || provider.expireAt <= done.finalSnapshot.timeMs
          || moment && (!time(provider.appliedAtMs) || provider.appliedAtMs > done.finalSnapshot.timeMs)
          || provider.appliedAtMs != null && !time(provider.appliedAtMs)) fail();
        const key = `${provider.providerRef}/${contribution.resultRef}`;
        if (actual.has(key)) fail();
        const row = { owner: provider.owner, source: provider.source, definitionRef: provider.definitionRef, resultRef: contribution.resultRef,
          statusKey: contribution.statusKey, statusKind: contribution.statusKind, strength: contribution.strength,
          appliedAtMs: provider.appliedAtMs ?? null, expireAt: provider.expireAt };
        actual.set(key, row); finalStatusContributions.push(row);
      }
    }
    const used = new Set<string>(), kinds = new Set<string>();
    for (const effective of actor.effectiveStatuses ?? []) {
      if (effective.statusKind !== 'movement_slow' || !strength(effective.strength) || !Array.isArray(effective.contributions)
        || !effective.contributions.length || kinds.has(effective.statusKind)) fail();
      kinds.add(effective.statusKind);
      const values: number[] = [];
      for (const contribution of effective.contributions) {
        const key = `${contribution.providerRef}/${contribution.resultRef}`, row = actual.get(key);
        if (!row || used.has(key) || row.statusKind !== effective.statusKind || row.statusKey !== contribution.statusKey
          || row.source !== contribution.source || row.expireAt !== contribution.expireAt || row.strength !== contribution.strength) fail();
        used.add(key); values.push(row.strength);
      }
      if (Math.max(...values) !== effective.strength) fail();
      finalEffectiveStatuses.push({ owner: actor.key, statusKind: effective.statusKind, strength: effective.strength });
    }
    if (used.size !== actual.size) fail();
  }
  finalStatusContributions.sort((a, b) => a.owner.localeCompare(b.owner) || a.source.localeCompare(b.source)
    || a.definitionRef.localeCompare(b.definitionRef) || a.resultRef.localeCompare(b.resultRef));
  finalEffectiveStatuses.sort((a, b) => a.owner.localeCompare(b.owner) || a.statusKind.localeCompare(b.statusKind));
  return { finalStatusContributions, finalEffectiveStatuses };
}

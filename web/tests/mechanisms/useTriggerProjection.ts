import type { CompileRequest, DoneResult, ListenerDefinition, RunRequest } from '../../src/types/genericEngine';
import { validateProviderOncePerUseScopes } from '../../src/engine/skillOncePerUse';
import { projectFiniteRecasts } from './finiteRecastProjection';

export type ProjectedUseTrigger = { owner: string; providerRef: string; groupKey: string; scope: 'provider' | 'provider_target';
  useSource: string; useSkillKey: string; useKey: string; target: string | null };

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const fail = (): never => { throw new Error('同次使用额度投影缺少真实挂载、共享范围或使用身份，或包含重复条目'); };

/** 完整账本直接取原生事实；provider范围仍要求原生明确的null目标。 */
export function projectUseTriggerLedger(compile: CompileRequest, request: RunRequest, done: DoneResult): ProjectedUseTrigger[] {
  const authorization = new Map<string, { scope: string; hitSkills: Set<string>; listener: boolean }>();
  for (const owner of compile.combatants) for (const mount of owner.providers) {
    const definitions = compile.sharedProviders?.filter(row => row.providerKey === mount.definitionRef) ?? [];
    if (definitions.length !== 1) fail();
    const provider = definitions[0]!;
    validateProviderOncePerUseScopes(provider, provider.providerKey, fail);
    const add = (limit: NonNullable<ListenerDefinition['oncePerUse']>, hitSkill?: string) => {
      if (provider.kind === 'status' || provider.lifecycle || !text(mount.providerRef)
        || !/^[a-z][a-z0-9_]{0,63}$/.test(limit.groupKey) || !['provider', 'provider_target'].includes(limit.scope)) fail();
      const key = `${owner.key}/${mount.providerRef}/${limit.groupKey}`, previous = authorization.get(key);
      if (previous && previous.scope !== limit.scope) fail();
      const auth = previous ?? { scope: limit.scope, hitSkills: new Set<string>(), listener: false };
      if (hitSkill) auth.hitSkills.add(hitSkill); else auth.listener = true;
      authorization.set(key, auth);
    };
    for (const listener of provider.listeners ?? []) if (listener.oncePerUse) add(listener.oncePerUse);
    for (const ability of provider.abilities ?? []) {
      if (ability.listenerSpec?.oncePerUse) add(ability.listenerSpec.oncePerUse);
      for (const operation of ability.operations ?? []) for (const group of operation.skillHit?.ruleGroups ?? []) {
        if (operation.operation !== 'resolve_skill_hit' || !text(ability.skillKey)
          || operation.skillHit!.skillKey !== ability.skillKey) fail();
        add(group.oncePerUse, ability.skillKey);
      }
    }
  }
  const rows = done.finalSnapshot.useTriggerLedger;
  if (rows !== undefined && !Array.isArray(rows) || (rows?.length ?? 0) > 1024) fail();
  const seen = new Set<string>();
  const finite = projectFiniteRecasts(compile, request, done);
  const facts = [...(request.skillUses ?? []), ...(done.finalSnapshot.processInstances ?? []).map(process => ({
    useKey: process.useKey, source: process.owner, skillKey: process.skillKey
  })), ...finite.finiteRecastStages.map(stage => ({ useKey: stage.useRef, source: stage.owner, skillKey: stage.skillKey })),
  ...(done.attackRecords ?? []).map(attack => ({ useKey: attack.useRef, source: attack.source, skillKey: attack.skillKey }))];
  return (rows ?? []).map(row => {
    if (!text(row.owner) || !text(row.providerRef) || !text(row.groupKey) || !text(row.useSource)
      || !text(row.useSkillKey) || !text(row.useKey) || !['source', 'target'].includes(row.owner)
      || !['source', 'target'].includes(row.useSource) || !['provider', 'provider_target'].includes(row.scope)) fail();
    const auth = authorization.get(`${row.owner}/${row.providerRef}/${row.groupKey}`);
    if (!auth || auth.scope !== row.scope || row.scope === 'provider_target' && !['source', 'target'].includes(row.target ?? '')
      || row.scope === 'provider' && row.target !== null
      || !auth.listener && (row.useSource !== row.owner || !auth.hitSkills.has(row.useSkillKey))) fail();
    if (!facts.some(fact => fact.useKey === row.useKey && fact.source === row.useSource && fact.skillKey === row.useSkillKey)) fail();
    if (row.useKey.startsWith('recast:')) {
      const stage = finite.finiteRecastStages.filter(s => s.useRef === row.useKey && s.owner === row.useSource && s.skillKey === row.useSkillKey);
      if (stage.length !== 1 || row.scope === 'provider_target' && !finite.finiteRecastWindows.some(p => p.useKey === stage[0]!.windowUseRef && p.target === row.target)) fail();
    }
    const target = row.target;
    const key = JSON.stringify([row.owner, row.providerRef, row.groupKey, row.scope, row.useSource, row.useKey, target]);
    if (seen.has(key)) fail();
    seen.add(key);
    return { owner: row.owner, providerRef: row.providerRef, groupKey: row.groupKey, scope: row.scope,
      useSource: row.useSource, useSkillKey: row.useSkillKey, useKey: row.useKey, target };
  }).sort((a, b) => a.owner.localeCompare(b.owner) || a.providerRef.localeCompare(b.providerRef)
    || a.groupKey.localeCompare(b.groupKey) || a.useSource.localeCompare(b.useSource) || a.useKey.localeCompare(b.useKey)
    || (a.target ?? '').localeCompare(b.target ?? ''));
}

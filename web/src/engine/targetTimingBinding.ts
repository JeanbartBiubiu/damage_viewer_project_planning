import type { ProviderDefinition, SkillActionBinding } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { SimulationCoverage } from './simulationAdapter';
import { NumericAdaptationError } from './numericAdapter';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';

/** Resolve declared hit listeners to this scene's actual driven roots after active assembly. */
export function bindTargetTimingSources(snapshot: SimulationSnapshot, providers: readonly ProviderDefinition[], active: {
  bindings: SkillActionBinding[]; providers: ProviderDefinition[]; types: Array<{ key: string; domain: string }>; coverage: SimulationCoverage[];
}): void {
  const staged: Array<{ listener: NonNullable<NonNullable<ProviderDefinition['abilities']>[number]['listenerSpec']>;
    abilities: NonNullable<ProviderDefinition['abilities']>; type: string; path: string; authorPath: string }> = [];
  for (const provider of providers) {
    if (!provider.abilities?.some(ability => ability.tickSpec?.phasePolicy === 'preserve_on_extend' || ability.targetExpirySpec)) continue;
    const fail = (message: string): never => { throw new NumericAdaptationError(`skills.${provider.skillKey}.triggerRules`, message); };
    if (!provider.skillKey || !provider.stableId || !['character', 'build'].includes(provider.kind)) fail('目标时序缺少真实永久拥有来源');
    for (const [index, ability] of provider.abilities!.entries()) {
      const listener = ability.listenerSpec;
      if (!listener?.eventMatcher.all?.includes('event/skill_hit')) continue;
      const identities = listener.eventMatcher.all.filter(key => key.startsWith('ability/skill/'));
      if (identities.length !== 1 || listener.eventMatcher.any?.length) fail('目标时序命中必须明确唯一实际技能来源');
      const skillKey = identities[0]!.slice('ability/skill/'.length);
      const bindings = active.bindings.filter(binding => binding.source === 'source' && binding.skillKey === skillKey);
      const plans = snapshot.selection.plannedSkills.filter(plan => plan.skillKey === skillKey && plan.phaseKinds.includes('INITIAL'));
      const sources = snapshot.source.skillSources.filter(source => source.skillKey === skillKey && source.enabled
        && source.skillStatus === 'ENABLED' && source.skillLevel !== null && source.skillLevel > 0 && source.inactiveReason === null);
      if (bindings.length !== 1 || plans.length !== 1 || sources.length !== 1
        || simulationSkillSourceIdentity(plans[0]!.origin, skillKey) !== simulationSkillSourceIdentity(sources[0]!.origin, skillKey)) {
        fail('目标时序命中来源必须实际启用、已学且明确计划');
      }
      const binding = bindings[0]!;
      const parents = active.providers.filter(row => row.providerKey === binding.providerDefinitionRef && row.skillKey === skillKey);
      const initials = binding.controls.filter(control => control.action === 'INITIAL');
      if (parents.length !== 1 || initials.length !== 1 || !binding.hitBindings.length) fail('目标时序命中缺少唯一实际首次父来源');
      const hitAbilities = binding.hitBindings.map(hit => parents[0]!.abilities?.find(row => hit.hitAbilityRef
        === `source.provider[${binding.providerRef}].ability[${row.abilityKey}]`));
      if (hitAbilities.some(row => !row || row.skillKey !== skillKey || row.kind !== 'active' || row.operations?.length !== 1
        || row.operations[0]!.operation !== 'resolve_skill_hit' || row.operations[0]!.skillHit?.skillKey !== skillKey)) {
        fail('目标时序只接实际根命中，不能按同名技能借用独立能力');
      }
      staged.push({ listener, abilities: [...new Set(hitAbilities)] as NonNullable<ProviderDefinition['abilities']>,
        type: `ability/target_timing_hit/${binding.providerRef}`, path: `sharedProviders[${provider.providerKey}].abilities[${index}].listenerSpec.eventMatcher`,
        authorPath: `skills.${provider.skillKey}.triggerRules.${ability.abilityKey}.eventSource` });
    }
  }
  for (const entry of staged) {
    if (!active.types.some(row => row.key === entry.type)) active.types.push({ key: entry.type, domain: 'ability' });
    for (const ability of entry.abilities) ability.types = [...new Set([...(ability.types ?? []), entry.type])];
    entry.listener.eventMatcher.all!.push(entry.type);
    active.coverage.push({ authorPath: entry.authorPath, compiledPath: entry.path,
      note: '显式目标时序监听绑定同拥有者实际计划技能的真实根命中，不启用关闭或未计划兄弟' });
  }
}

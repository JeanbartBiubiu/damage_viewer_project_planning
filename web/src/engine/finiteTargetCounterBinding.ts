import type { ProviderDefinition, SkillActionBinding } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { SimulationCoverage } from './simulation/model';
import { finiteTargetCounterContract } from './finiteTargetCounterContract';
import { NumericAdaptationError } from './numericAdapter';

/** 仅真实已装配的根命中获得本次监听标记，不能靠技能名称猜出额外命中入口。 */
export function bindFiniteTargetCounterSources(snapshot: SimulationSnapshot, naturalProviders: ProviderDefinition[], active: {
  providers: ProviderDefinition[]; bindings: SkillActionBinding[]; types: Array<{ key: string; domain: string }>; coverage: SimulationCoverage[];
}) {
  const fail = (skillKey: string, message: string): never => { throw new NumericAdaptationError(`skills.${skillKey}.triggerRules`, message); };
  for (const configuration of snapshot.skillConfigurations) {
    if (!snapshot.selection.plannedSkills.some(plan => plan.skillKey === configuration.skill.skillKey)) continue;
    const contract = finiteTargetCounterContract(configuration);
    if (!contract) continue;
    const skillKey = configuration.skill.skillKey;
    const providers = naturalProviders.filter(provider => provider.skillKey === skillKey && provider.abilities?.some(ability =>
      ability.tickSpec?.anchorScope === 'state_scope/provider_target' && ability.tickSpec.anchorStateKey === contract.window.stateKey));
    if (providers.length !== 1) fail(skillKey, '计数窗口缺少唯一实际自然拥有者与目标状态实例');
    const provider = providers[0]!;
    for (const [index, ability] of (provider.abilities ?? []).entries()) {
      const listener = ability.listenerSpec;
      if (!listener?.eventMatcher.all?.includes('event/skill_hit')) continue;
      const identities = listener.eventMatcher.all.filter(type => type.startsWith('ability/skill/'));
      if (identities.length !== 1 || listener.eventMatcher.any?.length) fail(skillKey, '目标计数命中需要唯一真实同拥有者技能入口');
      const sourceSkillKey = identities[0]!.slice('ability/skill/'.length);
      const bindings = active.bindings.filter(binding => binding.skillKey === sourceSkillKey);
      if (bindings.length !== 1) fail(skillKey, '计数命中引用的兄弟来源没有真实本场计划');
      const binding = bindings[0]!;
      const controls = binding.controls.filter(control => control.action === 'INITIAL');
      const hit = binding.hitBindings[0];
      const roots = active.providers.filter(row => row.providerKey === binding.providerDefinitionRef);
      const root = roots[0];
      const hitKey = hit?.hitAbilityRef.match(/\.ability\[([^\]]+)\]$/)?.[1];
      const actual = root?.abilities?.find(row => row.abilityKey === hitKey);
      if (binding.source !== 'source' || controls.length !== 1 || binding.hitBindings.length !== 1 || roots.length !== 1
        || root?.skillKey !== sourceSkillKey || actual?.skillKey !== sourceSkillKey
        || !hit!.hitAbilityRef.startsWith(`source.provider[${binding.providerRef}].ability[`)
        || actual.operations?.length !== 1 || actual.operations[0]!.operation !== 'resolve_skill_hit'
        || actual.operations[0]!.skillHit?.skillKey !== sourceSkillKey) return fail(skillKey, '计数命中必须绑定实际首次来源及唯一根命中，不能借用独立能力');
      const type = `ability/target_counter_hit/${binding.providerRef}`;
      if (!active.types.some(row => row.key === type)) active.types.push({ key: type, domain: 'ability' });
      actual.types = [...new Set([...(actual.types ?? []), type])];
      listener.eventMatcher.all.push(type);
      active.coverage.push({ authorPath: `skills.${skillKey}.triggerRules.${ability.abilityKey}.eventSource`,
        compiledPath: `sharedProviders[${provider.providerKey}].abilities[${index}].listenerSpec.eventMatcher`,
        note: '只接本次实际INITIAL绑定的唯一根命中；同名技能、未计划来源和非实际根能力不能叠层或挂窗' });
    }
  }
}

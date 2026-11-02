import type { AbilityDefinition, CompileRequest, SkillHitCandidate } from '../types/genericEngine';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { OperationOrigin } from './simulation/model';
import type { LoweredBasicAttackContributionFormula } from './basicAttackContributionFormula';

export type BasicAttackContribution = {
  authorSkillKey: string;
  candidate: SkillHitCandidate;
  lowerings: Array<{ field: string; value: LoweredBasicAttackContributionFormula }>;
};

/** 明确的首版作者约定：纯、无条件、无额度的直接普攻伤害进入同次命中。 */
export function isBasicAttackContributionRule(rule: SkillTriggerRuleDetail, configuration: SkillConfiguration): boolean {
  return rule.eventSource.eventType === 'BASIC_ATTACK_HIT' && Object.keys(rule.eventSource.detail).length === 0
    && rule.conditionGroups.length === 0 && rule.oncePerUse === null && rule.perTargetCooldown === null
    && rule.maxTriggersPerProcess === null && rule.actions.length > 0 && rule.actions.every(action => {
      if (action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET'
        || action.runtimeInputBindings.length || action.resultModifiers.length) return false;
      const effects = configuration.effects.filter(row => row.effectKey === action.detail.effectKey);
      return effects.length === 1 && effects[0]!.lifecycle === null && effects[0]!.results.length > 0
        && effects[0]!.results.every(result => result.resultType === 'DAMAGE' && result.target === 'TARGET'
          && result.lifecycleBehavior === null && result.detail.deliveryKind === 'BASIC_ATTACK'
          && result.detail.originKind === 'DIRECT');
    });
}

export function basicAttackContributionKey(providerRef: string, ruleKey: string, actionKey: string, resultKey?: string): string {
  return ['basic_component', providerRef, ruleKey, actionKey, ...(resultKey === undefined ? [] : [resultKey])].join('/');
}

export function isAlwaysParticipatingContribution(candidate: SkillHitCandidate): boolean {
  const condition = candidate.participationCondition;
  return !!candidate.participationProviderRef && !!condition && condition.op === 'const' && condition.value === 1
    && Object.keys(condition).every(key => key === 'op' || key === 'value')
    && !candidate.eventValueConditions?.length && candidate.spellShieldBlockScope === null
    && candidate.semantic.resultType === 'DAMAGE' && candidate.semantic.target === 'TARGET'
    && candidate.semantic.moment === 'INSTANT';
}

/** 只允许静态自然来源的真实参与挂载向所选父普攻贡献，不能借此放宽任意跨作者来源。 */
export function basicAttackContributionAuthorMatches(input: CompileRequest, origin: OperationOrigin, ability: AbilityDefinition,
  abilityPath: string, owner: string | undefined, hitAbilityRef: string): boolean {
  if (owner !== 'source' || origin.abilityRef !== hitAbilityRef || ability.skillKey === origin.skillKey
    || !origin.compiledPaths.length || ability.kind !== 'active') return false;
  const actor = input.combatants.find(row => row.key === owner);
  if (!actor) return false;
  return origin.compiledPaths.every(path => {
    if (!path.startsWith(abilityPath + '.')) return false;
    const match = /^\.operations\[(\d+)\]\.skillHit\.candidates\[(\d+)\]\.operations\[0\]$/.exec(path.slice(abilityPath.length));
    if (!match) return false;
    const resolver = ability.operations?.[Number(match[1])];
    const candidate = resolver?.skillHit?.candidates[Number(match[2])];
    if (resolver?.operation !== 'resolve_skill_hit' || resolver.skillHit?.skillKey !== ability.skillKey
      || !candidate || !isAlwaysParticipatingContribution(candidate) || candidate.operations.length !== 1) return false;
    const mounts = actor.providers.filter(row => row.providerRef === candidate.participationProviderRef);
    const participants = input.sharedProviders?.filter(row => row.providerKey === mounts[0]?.definitionRef) ?? [];
    const participant = participants[0];
    const operation = candidate.operations[0];
    return mounts.length === 1 && participants.length === 1 && !!participant
      && ['character', 'build'].includes(participant.kind) && participant.skillKey === origin.skillKey
      && !participant.lifecycle && !participant.initialStateSchema && !participant.processes?.length
      && !participant.modifiers?.length && !participant.abilities?.length && !participant.listeners?.length
      && !mounts[0]!.initialState && !mounts[0]!.initialAbilityState
      && candidate.effectKey === origin.effectKey && candidate.resultKey === origin.resultKey
      && candidate.candidateKey.startsWith('basic_component/' + mounts[0]!.providerRef + '/')
      && candidate.effectOccurrenceKey.startsWith('basic_component/' + mounts[0]!.providerRef + '/')
      && candidate.candidateKey === candidate.effectOccurrenceKey + '/' + candidate.resultKey
      && operation?.operation === 'damage' && operation.target === 'target' && operation.ref === origin.operationRef
      && !operation.condition && !operation.repeatCount && !operation.repeatDelayMs && !operation.repeatScope
      && operation.types?.includes('damage_trait/delivery_basic_attack') === true
      && operation.types?.includes('damage_trait/origin_direct') === true;
  });
}

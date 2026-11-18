import type { AbilityDefinition, CompileRequest, SkillHitCandidate } from '../types/genericEngine';
import type { GenericFormulaExpr, ProviderDefinition } from '../types/genericEngine';
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

/** 只把自身计数条件下的即时伤害叶移入真实父命中；消费仍由原自然尾处理。 */
export function isConditionalHitContributionRule(rule: SkillTriggerRuleDetail, configuration: SkillConfiguration): boolean {
  const event = rule.eventSource;
  if (!(event.eventType === 'BASIC_ATTACK_HIT' && Object.keys(event.detail).length === 0
    || event.eventType === 'SKILL_HIT' && typeof event.detail.sourceSkillKey === 'string'
      && Object.keys(event.detail).every(key => key === 'sourceSkillKey'))
    || !rule.conditionGroups.length || rule.oncePerUse !== null || rule.perTargetCooldown !== null
    || rule.maxTriggersPerProcess !== null || !rule.actions.length) return false;
  if (!rule.conditionGroups.every(group => group.conditions.length > 0 && group.conditions.every(condition => {
    if (condition.conditionType !== 'INTERNAL_STATE_CHECK') return false;
    const detail = condition.detail;
    const state = configuration.internalStates.find(row => row.stateKey === detail.stateKey);
    return detail.stateSkillKey === configuration.skill.skillKey && detail.valueKind === 'VALUE'
      && detail.optionKey === null && detail.expectedBoolean === null && detail.comparator !== null
      && detail.comparisonValue !== null && state?.stateType === 'COUNTER' && state.scope === 'SKILL';
  }))) return false;
  return rule.actions.every(action => {
    if (action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET'
      || action.runtimeInputBindings.length || action.resultModifiers.length) return false;
    const effects = configuration.effects.filter(effect => effect.effectKey === action.detail.effectKey);
    return effects.length === 1 && effects[0]!.lifecycle === null && effects[0]!.results.length > 0
      && effects[0]!.results.every(result => result.resultType === 'DAMAGE' && result.target === 'TARGET'
        && result.lifecycleBehavior === null && result.detail.originKind === 'DIRECT' && result.detail.attackDamageRole === undefined);
  });
}

export function conditionalHitContributionKey(providerRef: string, ruleKey: string, actionKey: string, resultKey?: string): string {
  return ['hit_component', providerRef, ruleKey, actionKey, ...(resultKey === undefined ? [] : [resultKey])].join('/');
}

function ownedCounterPredicate(expression: GenericFormulaExpr, provider: ProviderDefinition): boolean {
  if (expression.op === 'const') return typeof expression.value === 'number' && Number.isSafeInteger(expression.value) && expression.value >= 0;
  if (expression.op === 'read') {
    const key = /^provider\.state\.([a-z][a-z0-9_]*)$/.exec(expression.path ?? '')?.[1];
    const field = key && provider.initialStateSchema?.[key];
    return !!field && typeof field === 'object' && field.valueType === 'integer' && !field.stateKind;
  }
  return ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'min', 'max'].includes(expression.op)
    && expression.args?.length === 2 && expression.args.every(child => ownedCounterPredicate(child, provider));
}

/** 有条件组成仍须核对真实同拥有者来源、父能力与原作者路径。 */
export function conditionalHitContributionAuthorMatches(input: CompileRequest, origin: OperationOrigin, ability: AbilityDefinition,
  abilityPath: string, owner: string | undefined, basicHitAbilityRef: string): boolean {
  if (owner !== 'source' || ability.kind !== 'active' || ability.skillKey === origin.skillKey || !origin.compiledPaths.length) return false;
  const actualParent = origin.abilityRef === basicHitAbilityRef || input.rules.skillActionBindings?.some(binding => binding.source === owner
    && binding.skillKey === ability.skillKey && binding.hitBindings.some(hit => hit.hitAbilityRef === origin.abilityRef));
  if (!actualParent) return false;
  const actor = input.combatants.find(row => row.key === owner);
  if (!actor) return false;
  return origin.compiledPaths.every(path => {
    if (!path.startsWith(abilityPath + '.')) return false;
    const match = /^\.operations\[(\d+)\]\.skillHit\.candidates\[(\d+)\]\.operations\[0\]$/.exec(path.slice(abilityPath.length));
    if (!match) return false;
    const resolver = ability.operations?.[Number(match[1])], candidate = resolver?.skillHit?.candidates[Number(match[2])];
    if (!candidate || resolver?.operation !== 'resolve_skill_hit' || resolver.skillHit?.skillKey !== ability.skillKey
      || candidate.operations.length !== 1 || candidate.attackDamageRole !== undefined || candidate.eventValueConditions?.length
      || candidate.semantic.resultType !== 'DAMAGE' || candidate.semantic.target !== 'TARGET' || candidate.semantic.moment !== 'INSTANT') return false;
    const mounts = actor.providers.filter(row => row.providerRef === candidate.participationProviderRef);
    const participants = input.sharedProviders?.filter(row => row.providerKey === mounts[0]?.definitionRef) ?? [];
    const participant = participants[0], operation = candidate.operations[0];
    return mounts.length === 1 && participants.length === 1 && !!participant && participant.kind === 'character'
      && participant.skillKey === origin.skillKey && !participant.lifecycle && !participant.modifiers?.length
      && !!candidate.participationCondition && ownedCounterPredicate(candidate.participationCondition, participant)
      && candidate.effectKey === origin.effectKey && candidate.resultKey === origin.resultKey
      && candidate.effectOccurrenceKey.startsWith('hit_component/' + mounts[0]!.providerRef + '/')
      && candidate.candidateKey === candidate.effectOccurrenceKey + '/' + candidate.resultKey
      && operation?.operation === 'damage' && operation.target === 'target' && operation.ref === origin.operationRef
      && !operation.condition && !operation.repeatCount && !operation.repeatDelayMs && !operation.repeatScope;
  });
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

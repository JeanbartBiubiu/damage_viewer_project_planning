import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { NumericValue } from '../types/numericValue';
import type { CombatantProviderMount, OperationDefinition, ProviderDefinition, SkillActionBinding } from '../types/genericEngine';
import { isValidCooldownReductionRatio } from '../types/cooldownRatio';
import { skillFormulaReachableInputs } from '../services/skillFormulaContract';
import { createNumericCompileState, NumericAdaptationError, type NumericCompileState } from './numericAdapter';
import { staticEffectAmount, staticEffectValue } from './staticEffectValue';
import { calculationConfiguration } from './simulationCalculationRules';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';

const fail = (path: string, message: string): never => { throw new NumericAdaptationError(path, message); };
export type CommittedTotalRefundPlan = { targetSkillKey: string; ratio: number; effectKey: string; authorPath: string; dormantReason: string | null };
export type PendingCommittedTotalRefund = CommittedTotalRefundPlan & {
  sourceSkillKey: string; providerRef: string; definitionRef: string; listenerAbilityRef: string; operation: OperationDefinition;
};

/** 按作者声明的实际等级目录核全部可静态取值，不给缺级补值。 */
export function committedRefundProofLevels(configuration: SkillConfiguration, value: NumericValue, skillLevel: number, characterLevel: number,
  characterRange: { minLevel: number; maxLevel: number }) {
  const keys = value.kind === 'PARAMETER' ? [value.parameterKey] : [];
  if (value.kind === 'FORMULA') {
    const formulas = configuration.formulas.filter(row => row.formulaKey === value.formulaKey);
    if (formulas.length !== 1) fail(value.formulaKey, '总冷却返还缺少唯一真实公式');
    keys.push(...skillFormulaReachableInputs(formulas[0]!.expression).flatMap(row => row.binding.kind === 'parameter' ? [row.binding.parameterKey] : []));
  }
  const skills = new Set([skillLevel]), characters = new Set([characterLevel]);
  const declaredLevels = (key: string, table: Record<string, number> | null, min: number, max: number) => {
    if (!Number.isSafeInteger(min) || min < 1 || !Number.isSafeInteger(max) || max < min) fail(key, '实际等级范围必须完整');
    const entries = Object.entries(table ?? {});
    if (entries.length !== max - min + 1 || entries.some(([text, value]) => !/^[1-9][0-9]*$/.test(text)
      || !Number.isSafeInteger(Number(text)) || Number(text) < min || Number(text) > max || !Number.isFinite(value))) {
      fail(key, '返还比例的等级表必须逐级完整且有限');
    }
    return entries.map(([text]) => Number(text));
  };
  for (const key of keys) {
    const parameter = configuration.parameters.find(row => row.parameterKey === key);
    if (parameter?.valueMode === 'SKILL_LEVEL') for (const level of declaredLevels(key, parameter.levelValues, 1, configuration.skill.maxLevel)) skills.add(level);
    if (parameter?.valueMode === 'CHARACTER_LEVEL') {
      for (const level of declaredLevels(key, parameter.levelValues, characterRange.minLevel, characterRange.maxLevel)) characters.add(level);
    }
  }
  return [...skills].flatMap(skillLevel => [...characters].map(characterLevel => ({ skillLevel, characterLevel })));
}

export function compileCommittedTotalRefundRule(snapshot: SimulationSnapshot, configuration: SkillConfiguration,
  rule: SkillTriggerRuleDetail, state: NumericCompileState, side: 'source' | 'target', sourceKind: string): CommittedTotalRefundPlan | null {
  const matches = rule.actions.flatMap(action => action.actionType === 'EXECUTE_EFFECT'
    ? configuration.effects.filter(effect => effect.effectKey === action.detail.effectKey).flatMap(effect => effect.results
      .filter(result => result.resultType === 'COOLDOWN_CHANGE' && result.detail.operation === 'REDUCE_TOTAL_RATIO').map(result => ({ effect, result }))) : []);
  if (!matches.length) return null;
  const root = `skills.${configuration.skill.skillKey}.triggerRules.${rule.ruleKey}`, action = rule.actions[0], found = matches[0]!;
  const { effect, result } = found;
  if (side !== 'source' || sourceKind !== 'character' || matches.length !== 1 || rule.eventSource.eventType !== 'DAMAGE_DEALT'
    || rule.actions.length !== 1 || !action || action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET'
    || action.runtimeInputBindings.length || action.resultModifiers.length || rule.oncePerUse !== null || rule.perTargetCooldown !== null
    || rule.maxTriggersPerProcess !== null || effect.lifecycle !== null || effect.results.length !== 1 || result.resultType !== 'COOLDOWN_CHANGE'
    || result.target !== 'SOURCE' || result.lifecycleBehavior !== null || result.spellShieldBlockScope !== null || !result.valueRule) {
    return fail(root, '总冷却比例返还只接真实永久角色DAMAGE_DEALT的无额度单操作自身结果');
  }
  const scope = result.detail.affectedSkillScope;
  if (Object.keys(result.detail).some(key => !['operation', 'affectedSkillScope'].includes(key)) || !scope || scope.mode !== 'SKILLS'
    || Object.keys(scope).some(key => !['mode', 'skillKeys', 'skillCategoryKeys'].includes(key)) || !Array.isArray(scope.skillKeys)
    || scope.skillKeys.length !== 1 || typeof scope.skillKeys[0] !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(scope.skillKeys[0])
    || !Array.isArray(scope.skillCategoryKeys) || scope.skillCategoryKeys.length) fail(root, '总冷却返还需要唯一明确同拥有者技能范围');
  const path = `skills.${configuration.skill.skillKey}.effects.${effect.effectKey}.results.${result.resultKey}`, valueRule = result.valueRule;
  if (!rule.conditionGroups.length || rule.conditionGroups.some(group => !group.conditions.some(condition => condition.conditionType === 'EVENT_VALUE_COMPARE'
    && condition.detail.eventValueKey === 'POST_DEFENSE_DAMAGE' && condition.detail.comparator === 'GT'
    && staticEffectValue(condition.detail.comparisonValue, root + '.conditionGroups', state) === 0))) fail(root, '本笔退款必须明确保留每组正防御后伤害条件');
  for (const levels of committedRefundProofLevels(configuration, valueRule.value, state.skillLevel, state.characterLevel, snapshot.source.attributes)) {
    const variant = createNumericCompileState({ ...state, ...levels, formulaNamespace: `${state.formulaNamespace}/refund-check/${levels.skillLevel}/${levels.characterLevel}` });
    const value = staticEffectValue(valueRule.value, path + '.valueRule.value', variant);
    if (!isValidCooldownReductionRatio(value, valueRule)) fail(path, '总冷却返还的所有静态等级及倍率必须有限且在0至1之间');
  }
  const ratio = staticEffectAmount(valueRule, path + '.valueRule', state), skillKey = scope.skillKeys[0]!;
  const sources = snapshot.source.skillSources.filter(source => source.skillKey === skillKey && source.origin.kind === 'CHARACTER'
    && source.origin.characterKey === snapshot.selection.sourceCharacterKey);
  const configurations = snapshot.skillConfigurations.filter(row => row.skill.skillKey === skillKey), source = sources[0], target = configurations[0];
  if (sources.length !== 1 || configurations.length !== 1 || !source || !target || target.skill.gameId !== snapshot.gameId
    || target.skill.skillCategoryKeys.includes(calculationConfiguration(snapshot)?.basicAttackCategoryKey ?? '')) fail(path, '返还范围必须是本角色真实唯一普通技能');
  const plans = snapshot.selection.plannedSkills.filter(plan => simulationSkillSourceIdentity(plan.origin, plan.skillKey) === simulationSkillSourceIdentity(source.origin, skillKey));
  let dormantReason: string | null = null;
  if (!source.enabled || source.skillStatus === 'DISABLED' || target.skill.status === 'DISABLED') dormantReason = 'SCENE_DISABLED';
  else {
    if (source.skillStatus !== 'ENABLED' || target.skill.status !== 'ENABLED' || source.skillLevel === null || !Number.isSafeInteger(source.skillLevel)
      || source.skillLevel < 0 || source.skillLevel > target.skill.maxLevel || source.inactiveReason !== null && source.inactiveReason !== 'ACTIVE_DEFERRED'
        && !(source.skillLevel === 0 && source.inactiveReason === 'UNLEARNED')) fail(path, '返还目标必须是明确关闭、未学、未计划或完整开启的实际来源');
    if (source.skillLevel === 0) dormantReason = 'UNLEARNED';
    else if (!plans.length) dormantReason = 'ACTIVE_DEFERRED';
  }
  if (dormantReason && plans.length) fail(path, '关闭或未学的返还目标不能有实际主动计划');
  if (!dormantReason && (source.skillStatus !== 'ENABLED' || target.skill.status !== 'ENABLED' || source.inactiveReason !== null
    || plans.length !== 1 || source.skillLevel !== plans[0]!.skillLevel)) fail(path, '已计划返还目标缺少完整真实来源资格');
  return { targetSkillKey: skillKey, ratio, effectKey: effect.effectKey, authorPath: path, dormantReason };
}

/** 全部装配与挂载完成后一次校验/发布，不拼能力名，也不生成未计划来源。 */
export function bindCommittedTotalRefunds(pending: readonly PendingCommittedTotalRefund[], bindings: readonly SkillActionBinding[],
  providers: readonly ProviderDefinition[], mounts: readonly (CombatantProviderMount & { side: 'source' | 'target' })[]): void {
  const staged: Array<{ item: PendingCommittedTotalRefund; abilityRef: string }> = [];
  for (const item of pending) {
    const reject = (message: string): never => fail(item.authorPath, message);
    const parents = providers.filter(row => row.providerKey === item.definitionRef), parent = parents[0];
    const owned = mounts.filter(row => row.definitionRef === item.definitionRef);
    const ownerNames = mounts.filter(row => row.side === 'source' && row.providerRef === item.providerRef);
    const listeners = parent?.abilities?.filter(ability => item.listenerAbilityRef === `source.provider[${item.providerRef}].ability[${ability.abilityKey}]`) ?? [];
    const listener = listeners[0], spec = listener?.listenerSpec;
    if (parents.length !== 1 || parent?.kind !== 'character' || !parent.stableId || parent.lifecycle || parent.skillKey !== item.sourceSkillKey
      || owned.length !== 1 || ownerNames.length !== 1 || owned[0]?.side !== 'source' || owned[0].providerRef !== item.providerRef || listeners.length !== 1
      || listener?.kind !== 'passive_listener' || listener.skillKey !== item.sourceSkillKey || spec?.operations?.length !== 1
      || spec.operations[0] !== item.operation || !spec.eventMatcher.all?.includes('event/damage_instance') || !spec.eventMatcher.all.includes('event/source_owner')
      || spec.maxTriggersPerEvent !== 1 || spec.abilityRef || spec.oncePerUse || spec.perCastThrottleMs || item.operation.abilityRef !== undefined) reject('返还监听缺少真实永久拥有者、挂载或独立伤害事件操作');
    const matches = bindings.filter(row => row.skillKey === item.targetSkillKey && row.source === 'source'), binding = matches[0];
    const initials = binding?.controls.filter(row => row.action === 'INITIAL') ?? [], initial = initials[0];
    const definitions = providers.filter(row => row.providerKey === binding?.providerDefinitionRef), definition = definitions[0];
    const targetMounts = mounts.filter(row => row.definitionRef === binding?.providerDefinitionRef);
    const targetNames = mounts.filter(row => row.side === 'source' && row.providerRef === binding?.providerRef);
    const processes = definition?.processes?.filter(row => row.processKey === initial?.processKey) ?? [], process = processes[0];
    const abilities = definition?.abilities?.filter(row => initial?.abilityRef === `source.provider[${binding?.providerRef}].ability[${row.abilityKey}]`) ?? [], ability = abilities[0];
    if (matches.length !== 1 || initials.length !== 1 || definitions.length !== 1 || definition?.kind !== 'character' || !definition.stableId || definition.skillKey !== item.targetSkillKey
      || targetMounts.length !== 1 || targetNames.length !== 1 || targetMounts[0]?.side !== 'source' || targetMounts[0].providerRef !== binding?.providerRef
      || processes.length !== 1 || process?.skillKey !== item.targetSkillKey || !process.cooldown || abilities.length !== 1
      || ability?.kind !== 'active' || ability.skillKey !== item.targetSkillKey || ability.processControl?.action !== 'INITIAL'
      || ability.processControl.processKey !== process.processKey || ability.processControl.useRefFromEvent === true) reject('返还目标缺少同拥有者唯一真实INITIAL、实际挂载及普通过程冷却');
    staged.push({ item, abilityRef: initial!.abilityRef });
  }
  for (const { item, abilityRef } of staged) item.operation.abilityRef = abilityRef;
}

import type { SkillConfiguration } from '../types/skillConfiguration';
import { NumericAdaptationError } from './numericAdapter';

/** 只识别自身单层计数到期恢复关联盾的完整作者分支，不开放一般状态变化事件。 */
export function ownCounterShieldExpiry(configuration: SkillConfiguration) {
  const skillKey = configuration.skill.skillKey;
  const candidates = configuration.triggerRules.filter(rule => {
    const event = rule.eventSource;
    return event.eventType === 'INTERNAL_STATE_CHANGED' && event.detail.stateSkillKey === skillKey
      && configuration.internalStates.some(state => state.stateKey === event.detail.stateKey && state.scope === 'SKILL'
        && state.stateType === 'COUNTER' && state.detail.durationValue != null)
      && rule.actions.some(action => action.actionType === 'EXECUTE_EFFECT' && configuration.effects.some(effect =>
        effect.effectKey === action.detail.effectKey && effect.lifecycle?.endWhenShieldEndsResultKey != null));
  });
  if (!candidates.length) return null;
  const rule = candidates[0]!, root = `skills.${skillKey}.triggerRules.${rule.ruleKey}`;
  const fail = (message: string): never => { throw new NumericAdaptationError(root, message); };
  const exact = (value: object, allowed: readonly string[]) => {
    if (Object.keys(value).some(key => !allowed.includes(key))) fail('自身到期回盾不能丢弃未识别作者字段');
  };
  exact(rule, ['ruleKey', 'name', 'description', 'sortOrder', 'eventSource', 'conditionGroups', 'actions', 'oncePerUse', 'perTargetCooldown', 'maxTriggersPerProcess']);
  exact(rule.eventSource, ['eventType', 'detail']); exact(rule.eventSource.detail, ['stateSkillKey', 'stateKey', 'changeKind']);
  if (candidates.length !== 1 || rule.eventSource.eventType !== 'INTERNAL_STATE_CHANGED'
    || rule.eventSource.detail.changeKind !== 'VALUE_CHANGED' || rule.oncePerUse !== null
    || rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null || rule.actions.length !== 1
    || rule.conditionGroups.length !== 1 || rule.conditionGroups[0]!.conditions.length !== 2) return fail('自身到期回盾需要唯一完整的1至0分支与一个自身施盾动作');
  const action = rule.actions[0]!;
  exact(rule.conditionGroups[0]!, ['groupKey', 'name', 'sortOrder', 'conditions']);
  for (const condition of rule.conditionGroups[0]!.conditions) {
    exact(condition, ['conditionKey', 'conditionType', 'sortOrder', 'detail']);
    exact(condition.detail, ['eventValueKey', 'comparator', 'comparisonValue']);
    if (condition.conditionType === 'EVENT_VALUE_COMPARE') exact(condition.detail.comparisonValue, ['kind', 'value']);
  }
  if (action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET'
    || action.resultModifiers.length || action.runtimeInputBindings.length) return fail('到期回盾不接受其它目标、修正或运行输入');
  for (const [key, expected] of [['STATE_BEFORE', 1], ['STATE_AFTER', 0]] as const) {
    const conditions = rule.conditionGroups[0]!.conditions.filter(condition => condition.conditionType === 'EVENT_VALUE_COMPARE'
      && condition.detail.eventValueKey === key && condition.detail.comparator === 'EQ'
      && condition.detail.comparisonValue.kind === 'FIXED' && condition.detail.comparisonValue.value === expected);
    if (conditions.length !== 1) return fail('到期回盾必须明确核对冻结的状态1至0');
  }
  const stateKey = rule.eventSource.detail.stateKey;
  const state = configuration.internalStates.find(row => row.stateKey === stateKey)!;
  if (state.stateType !== 'COUNTER' || state.detail.initialValue.kind !== 'FIXED' || state.detail.initialValue.value !== 0
    || state.detail.maxValue.kind !== 'FIXED' || state.detail.maxValue.value !== 1) return fail('自身到期回盾只接受初始0、上限1的自身计数');
  const effect = configuration.effects.find(row => row.effectKey === action.detail.effectKey)!;
  if (effect.lifecycle?.instanceScope !== 'SOURCE' || effect.results.length !== 1
    || effect.results[0]!.resultType !== 'NORMAL_SHIELD' || effect.results[0]!.target !== 'SOURCE'
    || effect.lifecycle.endWhenShieldEndsResultKey !== effect.results[0]!.resultKey) return fail('自身到期只接完整自身唯一关联普通盾');
  return { ruleKey: rule.ruleKey, stateKey: state.stateKey, effectKey: effect.effectKey };
}

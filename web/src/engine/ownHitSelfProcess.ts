import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import { selectSimulationSkillSourceClosure } from './simulation/sources/closure';

/** 只区分执行归属；数值、条件和过程顺序仍由实际自然来源编译器校验。 */
export function isOwnHitSelfProcessRule(configuration: SkillConfiguration, rule: SkillTriggerRuleDetail): boolean {
  const skillKey = configuration.skill.skillKey, event = rule.eventSource;
  if (event.eventType !== 'SKILL_HIT' || event.detail.sourceSkillKey !== skillKey || Object.prototype.hasOwnProperty.call(event.detail, 'processMoment')
    || !rule.actions.length || rule.actions.some(action => action.actionType !== 'START_PROCESS' || action.targetContext !== 'CURRENT_TARGET'
      || action.runtimeInputBindings.length || action.resultModifiers.length)) return false;
  const { configuration: closure } = selectSimulationSkillSourceClosure(configuration, [rule.ruleKey]);
  // 自动展开的时点、结果、状态变化尾部须继续由原入口拒绝，不能只检查直接挂接后忽略它们。
  if (closure.triggerRules.length !== 1 || !closure.processes.length || !closure.effects.length) return false;
  if (closure.processes.some(process => process.gameId !== configuration.skill.gameId || process.skillKey !== skillKey
    || process.activationType !== 'PASSIVE' || process.cooldown !== null || !process.steps.length
    || process.steps.some(step => step.stepType !== 'IMMEDIATE' || step.occupiesAction !== false)
    || process.stateOperations.some(operation => operation.stateSkillKey !== skillKey
      || !closure.internalStates.some(state => state.stateKey === operation.stateKey && state.scope === 'SKILL')))) return false;
  return closure.effects.every(effect => effect.gameId === configuration.skill.gameId && effect.skillKey === skillKey
    && effect.lifecycle?.instanceScope === 'SOURCE' && effect.results.length > 0
    && effect.results.every(result => result.resultType === 'ATTRIBUTE_CHANGE' && result.target === 'SOURCE'));
}

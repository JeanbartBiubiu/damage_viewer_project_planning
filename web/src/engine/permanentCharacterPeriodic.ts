import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import { NumericAdaptationError } from './numericAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

/** 仅识别新入口的声明；完整原图仍须验证，不能以裁选后的单条规则代替。 */
export function declaresPermanentCharacterPeriod(configuration: SkillConfiguration, rule: SkillTriggerRuleDetail): boolean {
  return rule.eventSource.eventType === 'SOURCE_INITIALIZED' && rule.actions.some(action => action.actionType === 'EXECUTE_EFFECT'
    && configuration.effects.some(effect => effect.effectKey === action.detail.effectKey && effect.lifecycle?.expiryMode === 'EXPLICIT_ONLY'
      && effect.lifecycle.periodicIntervalValue != null));
}

/** 正首延迟与单层供值继续交原周期编译核定；此处封闭完整角色作者图。 */
export function validatePermanentCharacterPeriod(configuration: SkillConfiguration, selected: SkillConfiguration,
  rule: SkillTriggerRuleDetail, path: string): void {
  if (configuration.triggerRules.length !== 1 || configuration.triggerRules[0]!.ruleKey !== rule.ruleKey
    || configuration.effects.length !== 1 || configuration.processes.length || configuration.internalStates.length) {
    fail(path, '角色常驻周期必须是完整单规则、单效果且无过程或状态的独立来源');
  }
  for (const collection of ['triggerRules', 'effects', 'parameters', 'formulas'] as const) {
    for (const row of selected[collection]) if (!configuration[collection].some(original => JSON.stringify(original) === JSON.stringify(row))) {
      fail(`${path}.${collection}`, '角色常驻周期的实际消费必须来自完整原作者对象，不能替换裁选内容');
    }
  }
  const rulePath = `${path}.triggerRules.${rule.ruleKey}`;
  if (rule.eventSource.eventType !== 'SOURCE_INITIALIZED' || Object.keys(rule.eventSource.detail).length
    || rule.actions.length !== 1 || rule.conditionGroups.length || rule.oncePerUse !== null
    || rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null) {
    fail(rulePath, '角色常驻周期只接唯一无条件初始化，无次数、节流或使用额度');
  }
  const action = rule.actions[0]!;
  if (action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'EVENT_SOURCE'
    || action.runtimeInputBindings.length || action.resultModifiers.length
    || action.detail.effectKey !== configuration.effects[0]!.effectKey) {
    fail(`${rulePath}.actions.${action.actionKey}`, '角色常驻周期必须唯一完整施加给真实事件来源，不接运行绑定或修饰');
  }
  const effect = configuration.effects[0]!, life = effect.lifecycle;
  const effectPath = `${path}.effects.${effect.effectKey}`;
  if (!life || life.durationValue !== null || life.expiryMode !== 'EXPLICIT_ONLY' || life.instanceScope !== 'SOURCE'
    || life.reapplicationStackMode !== 'KEEP' || life.reapplicationDurationMode !== null
    || life.periodicIntervalValue === null || life.firstPeriodicExecution !== 'AFTER_INTERVAL'
    || life.endWhenShieldEndsResultKey != null || effect.results.length !== 1) {
    fail(effectPath, '角色常驻周期只接无期限单层来源、间隔后首跳且无盾关联的唯一伤害');
  }
  const result = effect.results[0]!;
  if (result.resultType !== 'DAMAGE' || result.target !== 'TARGET' || result.spellShieldBlockScope !== null
    || !result.valueRule || result.detail.deliveryKind !== 'SKILL' || result.detail.originKind !== 'DIRECT'
    || result.detail.critical.mode !== 'DISALLOWED' || result.detail.critical.multiplierValue !== null
    || result.detail.vampQualification !== 'RESOLVED' || result.detail.vampOverrides.length
    || Object.prototype.hasOwnProperty.call(result.detail, 'attackDamageRole')) {
    fail(`${effectPath}.results.${result.resultKey}`, '角色常驻周期只接完整对手直接技能伤害，禁止暴击且吸血资格明确，无附加覆盖');
  }
  const behavior = result.lifecycleBehavior;
  if (!behavior || behavior.moment !== 'PERIODIC' || behavior.valueReadMode !== 'MOMENT_EVALUATION'
    || behavior.stackValueMode !== null || behavior.reapplicationValueMode !== null
    || behavior.periodicExecutionMode !== 'ONCE_PER_INSTANCE') {
    fail(effectPath, '角色常驻周期必须逐跳重新求值，不快照、叠层或重复执行');
  }
}

import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffect } from '../types/skillEffect';
import type { SkillTriggerAction } from '../types/skillTriggerRule';
import type { OperationDefinition } from '../types/genericEngine';
import type { ModifierZone } from '../types/modifierZone';
import { NumericAdaptationError, constExpr, type NumericCompileState } from './numericAdapter';
import { staticEffectAmount } from './staticEffectValue';
import { compileTimedAttributeEffect } from './timedAttributeEffectAdapter';

export function isOwnProviderDurationMaintenanceAction(configuration: SkillConfiguration, action: SkillTriggerAction): boolean {
  if (action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET'
    || action.runtimeInputBindings.length || action.resultModifiers.length) return false;
  const effects = configuration.effects.filter(effect => effect.effectKey === action.detail.effectKey);
  return effects.length === 1 && effects[0]!.lifecycle === null && effects[0]!.results.length > 0
    && effects[0]!.results.every(result => result.resultType === 'LIFECYCLE_OPERATION' && result.target === 'SOURCE'
      && result.detail.operation === 'ENSURE_REMAINING' && result.lifecycleBehavior === null && result.spellShieldBlockScope === null
      && result.detail.targetEffectKey !== effects[0]!.effectKey
      && configuration.effects.some(target => target.effectKey === result.detail.targetEffectKey && target.lifecycle?.durationValue != null));
}

/** 只修改已存在的纯自身属性实例期限；定义、金额及真实主动来源随后继续核对。 */
export function compileProviderDurationResult(effect: SkillEffect, target: SkillEffect, resultKey: string,
  state: NumericCompileState, zones: readonly ModifierZone[], parent: string) {
  const path = `skills.${state.skillKey}.effects.${effect.effectKey}.results.${resultKey}`;
  const fail = (message: string): never => { throw new NumericAdaptationError(path, message); };
  const result = effect.results.find(row => row.resultKey === resultKey);
  if (!result || result.resultType !== 'LIFECYCLE_OPERATION' || !result.valueRule) return fail('续时结果缺少完整数值');
  if (effect.lifecycle !== null
    || result.target !== 'SOURCE' || result.detail.operation !== 'ENSURE_REMAINING' || result.detail.targetEffectKey !== target.effectKey
    || target.effectKey === effect.effectKey || target.skillKey !== state.skillKey || result.lifecycleBehavior !== null
    || result.spellShieldBlockScope !== null || !result.valueRule
    || Object.keys(result.detail).some(key => !['operation', 'targetEffectKey'].includes(key))) fail('续时只接受当前技能自身的完整即时ENSURE_REMAINING结果');
  if (target.results.some(row => row.resultType !== 'ATTRIBUTE_CHANGE' || row.detail.attributeKey === 'hp'
    || row.lifecycleBehavior?.valueReadMode !== 'APPLICATION_SNAPSHOT')) fail('续时目标只允许静态单层自身非生命属性组');
  const milliseconds = staticEffectAmount(result.valueRule, `${path}.valueRule`, state);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) fail('至少保留的剩余时长必须为静态非负安全整数毫秒');
  const compiled = compileTimedAttributeEffect(target, state, zones, parent);
  const operation: OperationDefinition = { operation: 'provider_duration_change', target: 'self', valuePolicy: 'ensure_remaining',
    providerDefinitionRef: compiled.provider.providerKey, amount: constExpr(milliseconds), ref: path };
  return { provider: compiled.provider, operation };
}

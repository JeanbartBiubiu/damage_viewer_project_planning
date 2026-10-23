import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffectValueRule } from '../types/skillEffect';
import type { SkillTriggerAction, SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { GenericFormulaExpr } from '../types/genericEngine';
import { NumericAdaptationError } from './numericAdapter';
import { lowerSettledDamageHealValueRule } from './settledDamageHeal';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: unknown, fields: readonly string[], path: string, optional: readonly string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !fields.includes(field) && !optional.includes(field))) {
    fail(path, '原额目标伤害需要完整明确字段，不能缺省或夹带额外字段');
  }
}
function key(value: unknown, path: string) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) fail(path, '原额目标伤害需要明确稳定标识');
}
function valueRuleShape(rule: SkillEffectValueRule, path: string) {
  exact(rule, ['value', 'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue'], path);
  if (rule.value?.kind === 'PARAMETER') {
    exact(rule.value, ['kind', 'parameterKey'], `${path}.value`);
    key(rule.value.parameterKey, `${path}.value.parameterKey`);
  } else if (rule.value?.kind === 'FORMULA') {
    exact(rule.value, ['kind', 'formulaKey'], `${path}.value`);
    key(rule.value.formulaKey, `${path}.value.formulaKey`);
  } else fail(path, '原额绑定必须由本动作参数或具名公式实际消费');
}

/** 只核本动作结构；真实标记、伤前条件、目录及永久挂载须由完整装配图另证。 */
export function rawDamageTargetBinding(action: SkillTriggerAction, rule: SkillTriggerRuleDetail,
  configuration: SkillConfiguration, path: string): string {
  exact(rule, ['ruleKey', 'name', 'description', 'sortOrder', 'eventSource', 'conditionGroups', 'actions',
    'oncePerUse', 'perTargetCooldown', 'maxTriggersPerProcess'], path, ['createdAt', 'updatedAt']);
  exact(rule.eventSource, ['eventType', 'detail'], `${path}.eventSource`);
  exact(action, ['actionKey', 'name', 'actionType', 'sortOrder', 'targetContext', 'detail', 'runtimeInputBindings', 'resultModifiers'], path);
  if (rule.eventSource.eventType !== 'DAMAGE_DEALT' || !Array.isArray(rule.actions) || rule.actions.length !== 1
    || rule.actions[0] !== action || rule.oncePerUse !== null || rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null
    || !Array.isArray(rule.conditionGroups) || action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET'
    || !Array.isArray(action.resultModifiers) || action.resultModifiers.length
    || !Array.isArray(action.runtimeInputBindings) || action.runtimeInputBindings.length !== 1) {
    fail(path, '原额只接DAMAGE_DEALT的无节流单动作目标伤害');
  }
  exact(rule.eventSource.detail, ['sourceSkillKey', 'damageTypeKey', 'deliveryKind', 'originKind'], `${path}.eventSource.detail`);
  exact(action.detail, ['effectKey'], `${path}.detail`);
  key(action.detail.effectKey, `${path}.detail.effectKey`);
  const binding = action.runtimeInputBindings[0]!;
  exact(binding, ['bindingKey', 'parameterKey', 'sourceType', 'detail'], `${path}.runtimeInputBindings[0]`);
  if (binding.sourceType !== 'EVENT_VALUE') fail(path, '原额目标伤害只能绑定本笔RAW_DAMAGE');
  exact(binding.detail, ['eventValueKey'], `${path}.runtimeInputBindings[0].detail`);
  if (binding.detail.eventValueKey !== 'RAW_DAMAGE') fail(path, '原额目标伤害只能绑定本笔RAW_DAMAGE');
  key(binding.bindingKey, `${path}.runtimeInputBindings[0].bindingKey`);
  key(binding.parameterKey, `${path}.runtimeInputBindings[0].parameterKey`);
  const parameters = configuration.parameters.filter(row => row.parameterKey === binding.parameterKey), parameter = parameters[0];
  if (parameters.length !== 1 || !parameter || parameter.gameId !== configuration.skill.gameId || parameter.skillKey !== configuration.skill.skillKey
    || parameter.valueMode !== 'RUNTIME_INPUT' || parameter.valueType !== 'DECIMAL' || parameter.fixedValue !== null || parameter.levelValues !== null) {
    fail(path, '原额参数必须是本技能唯一无默认DECIMAL计算时参数');
  }
  exact(parameter, ['gameId', 'skillKey', 'parameterKey', 'name', 'description', 'sortOrder', 'valueMode', 'valueType', 'fixedValue', 'levelValues'],
    `${path}.parameter`, ['createdAt', 'updatedAt']);
  const effectKey = action.detail.effectKey;
  const effects = configuration.effects.filter(row => row.effectKey === effectKey), effect = effects[0];
  if (effects.length !== 1 || !effect) fail(path, '原额目标伤害需要唯一完整效果');
  exact(effect, ['gameId', 'skillKey', 'effectKey', 'name', 'description', 'sortOrder', 'lifecycle', 'results'], path, ['createdAt', 'updatedAt']);
  if (effect.gameId !== configuration.skill.gameId || effect.skillKey !== configuration.skill.skillKey || effect.lifecycle !== null
    || !Array.isArray(effect.results) || effect.results.length !== 1) fail(path, '原额效果必须为本技能即时单结果');
  const result = effect.results[0]!;
  exact(result, ['resultKey', 'name', 'description', 'sortOrder', 'resultType', 'target', 'detail', 'valueRule',
    'lifecycleBehavior', 'spellShieldBlockScope'], path);
  if (result.resultType !== 'DAMAGE' || result.target !== 'TARGET' || result.lifecycleBehavior !== null
    || result.spellShieldBlockScope !== null || !result.valueRule) fail(path, '原额只接无独立法盾单元的即时TARGET伤害');
  exact(result.detail, ['damageTypeKey', 'deliveryKind', 'originKind', 'critical', 'vampQualification', 'vampOverrides'], `${path}.detail`);
  key(result.detail.damageTypeKey, `${path}.detail.damageTypeKey`);
  exact(result.detail.critical, ['mode', 'multiplierValue'], `${path}.detail.critical`);
  if (result.detail.deliveryKind !== 'SKILL' || result.detail.originKind !== 'DIRECT' || result.detail.critical.mode !== 'DISALLOWED'
    || result.detail.critical.multiplierValue !== null || result.detail.vampQualification !== 'RESOLVED'
    || !Array.isArray(result.detail.vampOverrides) || result.detail.vampOverrides.length) {
    fail(path, '原额目标伤害只接禁暴击、无吸血覆盖的已核定DIRECT/SKILL结果');
  }
  valueRuleShape(result.valueRule, `${path}.valueRule`);
  return binding.parameterKey;
}

/** 只复用有界算术，不调用或扩大旧POST自身治疗授权，也不为原公式补事件供值。 */
export function lowerRawDamageTargetValueRule(rule: SkillEffectValueRule, configuration: SkillConfiguration,
  skillLevel: number, characterLevel: number, parameterKey: string, valueRulePath: string) {
  key(parameterKey, `${valueRulePath}.parameterKey`);
  valueRuleShape(rule, valueRulePath);
  const lowered = lowerSettledDamageHealValueRule(rule, configuration, skillLevel, characterLevel, parameterKey, valueRulePath);
  let reads = 0;
  const replace = (expression: GenericFormulaExpr): GenericFormulaExpr => {
    if (expression.op === 'read') {
      if (expression.path !== 'event.damage.mitigatedAmount') return fail(valueRulePath, '原额展开不能夹带其它事件或属性读取');
      reads++;
      return { ...expression, path: 'event.damage.baseRawAmount' };
    }
    return { ...expression, ...(expression.args ? { args: expression.args.map(replace) } : {}),
      ...(expression.expr ? { expr: replace(expression.expr) } : {}), ...(expression.min ? { min: replace(expression.min) } : {}),
      ...(expression.max ? { max: replace(expression.max) } : {}) };
  };
  const expression = replace(lowered.expression);
  if (reads !== 1) fail(valueRulePath, '本笔原额必须在实际降低树中恰好出现一次');
  return { ...lowered, expression };
}

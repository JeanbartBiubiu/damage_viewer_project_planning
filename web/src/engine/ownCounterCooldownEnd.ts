import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffectResult } from '../types/skillEffect';
import type { NumericCompileState } from './numericAdapter';
import type { CompileRequest, GenericFormulaExpr } from '../types/genericEngine';
import type { OperationOrigin } from './simulation/model';
import { compileNumericValue, NumericAdaptationError, tryFoldConstant, wrapValueRuleExpression } from './numericAdapter';
import { skillFormulaReachableInputs } from '../services/skillFormulaContract';

export function isOwnCooldownSetResult(result: SkillEffectResult, skillKey: string): boolean {
  if (result.resultType !== 'COOLDOWN_CHANGE' || result.detail.operation !== 'SET_REMAINING'
    || result.target !== 'SOURCE' || result.lifecycleBehavior !== null || result.spellShieldBlockScope !== null) return false;
  const scope = result.detail.affectedSkillScope;
  return scope.mode === 'SKILLS' && scope.skillKeys.length === 1 && scope.skillKeys[0] === skillKey && scope.skillCategoryKeys.length === 0;
}

/** 只识别自身有期0..1计数自然结束所触发的唯一冷却尾，不开放一般状态事件。 */
export function ownCounterCooldownExpiry(configuration: SkillConfiguration) {
  const skillKey = configuration.skill.skillKey;
  const candidates = configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'INTERNAL_STATE_CHANGED'
    && rule.eventSource.detail.stateSkillKey === skillKey && rule.actions.some(action => action.actionType === 'EXECUTE_EFFECT'
      && configuration.effects.some(effect => effect.effectKey === action.detail.effectKey
        && effect.results.some(result => isOwnCooldownSetResult(result, skillKey)))));
  if (!candidates.length) return null;
  const rule = candidates[0]!, path = `skills.${skillKey}.triggerRules.${rule.ruleKey}`;
  const fail = (message: string): never => { throw new NumericAdaptationError(path, message); };
  if (candidates.length !== 1 || rule.eventSource.eventType !== 'INTERNAL_STATE_CHANGED'
    || Object.keys(rule.eventSource.detail).some(key => !['stateSkillKey', 'stateKey', 'changeKind'].includes(key))
    || rule.eventSource.detail.changeKind !== 'VALUE_CHANGED' || rule.oncePerUse !== null
    || rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null || rule.actions.length !== 1
    || rule.conditionGroups.length !== 1 || rule.conditionGroups[0]!.conditions.length !== 2) fail('计数结束冷却需要唯一明确的自身1至0分支');
  const action = rule.actions[0]!;
  if (action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET'
    || action.runtimeInputBindings.length || action.resultModifiers.length) fail('计数结束冷却只接受明确自身冷却效果');
  for (const [key, value] of [['STATE_BEFORE', 1], ['STATE_AFTER', 0]] as const) {
    if (rule.conditionGroups[0]!.conditions.filter(condition => condition.conditionType === 'EVENT_VALUE_COMPARE'
      && condition.detail.eventValueKey === key && condition.detail.comparator === 'EQ'
      && condition.detail.comparisonValue.kind === 'FIXED' && condition.detail.comparisonValue.value === value
      && Object.keys(condition.detail).every(field => ['eventValueKey', 'comparator', 'comparisonValue'].includes(field))).length !== 1) {
      fail('计数结束冷却必须明确核对冻结的状态1至0');
    }
  }
  const state = configuration.internalStates.find(row => row.stateKey === (rule.eventSource.eventType === 'INTERNAL_STATE_CHANGED' ? rule.eventSource.detail.stateKey : ''));
  if (!state || state.scope !== 'SKILL' || state.stateType !== 'COUNTER' || state.detail.durationValue == null
    || state.detail.initialValue.kind !== 'FIXED' || state.detail.initialValue.value !== 0
    || state.detail.maxValue.kind !== 'FIXED' || state.detail.maxValue.value !== 1) fail('计数结束冷却需要初始0、上限1的自身有期计数');
  const effect = configuration.effects.find(row => action.actionType === 'EXECUTE_EFFECT' && row.effectKey === action.detail.effectKey);
  if (!effect || effect.lifecycle !== null || effect.results.length !== 1 || !isOwnCooldownSetResult(effect.results[0]!, skillKey)) fail('计数结束冷却必须为单一自身SET_REMAINING结果');
  return { ruleKey: rule.ruleKey, stateKey: state!.stateKey, effectKey: effect!.effectKey };
}

/** 未计划自身首次时，只有由该首次武装的单一窗口可完整休眠；不影响独立被动。 */
export function ownCooldownWindowDormant(configuration: SkillConfiguration): boolean {
  const expiry = ownCounterCooldownExpiry(configuration);
  if (!expiry || configuration.internalStates.length !== 1) return false;
  const skillKey = configuration.skill.skillKey;
  const ownInitial = (rule: SkillConfiguration['triggerRules'][number]) => rule.eventSource.eventType === 'SKILL_USED'
    && rule.eventSource.detail.sourceSkillKey === skillKey && rule.eventSource.detail.useKind === 'ACTIVE' && rule.eventSource.detail.castPhase === 'INITIAL';
  const positive = (rule: SkillConfiguration['triggerRules'][number]) => rule.conditionGroups.length > 0
    && rule.conditionGroups.every(group => group.conditions.some(condition => condition.conditionType === 'INTERNAL_STATE_CHECK'
      && condition.detail.stateSkillKey === skillKey && condition.detail.stateKey === expiry.stateKey && condition.detail.valueKind === 'VALUE'
      && condition.detail.comparisonValue?.kind === 'FIXED'
      && (condition.detail.comparator === 'EQ' && condition.detail.comparisonValue.value === 1
        || condition.detail.comparator === 'GTE' && condition.detail.comparisonValue.value >= 1
        || condition.detail.comparator === 'GT' && condition.detail.comparisonValue.value >= 0)));
  if (!configuration.triggerRules.every(rule => ownInitial(rule) || rule.ruleKey === expiry.ruleKey
    || ['BASIC_ATTACK_HIT', 'SKILL_HIT'].includes(rule.eventSource.eventType) && positive(rule))) return false;
  for (const process of configuration.processes) {
    if (process.stateOperations.some(operation => operation.stateKey === expiry.stateKey
      && !(operation.operation === 'SET' && operation.value?.kind === 'FIXED' && operation.value.value === 0))) {
      if (process.activationType !== 'ACTIVE' || configuration.triggerRules.some(rule => !ownInitial(rule)
        && rule.actions.some(action => action.actionType === 'START_PROCESS' && action.detail.processKey === process.processKey))) return false;
    }
  }
  return !configuration.triggerRules.some(rule => !ownInitial(rule) && rule.actions.some(action => action.actionType === 'MODIFY_INTERNAL_STATE'
    && action.detail.stateKey === expiry.stateKey));
}

/** 沿普通冷却口径转换正时长；非正动态结果交非法时长使原生拒绝。 */
export function compileOwnCooldownSetAmount(result: SkillEffectResult, configuration: SkillConfiguration, numeric: NumericCompileState,
  path: string, fail: (path: string, message: string) => never): GenericFormulaExpr {
  if (!result.valueRule) return fail(path, '结束冷却缺少明确时长');
  const value = result.valueRule.value;
  if (value.kind === 'FORMULA') {
    const formulas = configuration.formulas.filter(row => row.formulaKey === value.formulaKey);
    if (formulas.length !== 1) return fail(path, '结束冷却缺少唯一自身公式');
    for (const input of skillFormulaReachableInputs(formulas[0]!.expression)) {
      const binding = input.binding;
      if (binding.kind === 'attribute') {
        if (binding.object !== 'source' || binding.view !== 'current_frame' || binding.attributeKey === 'hp') fail(path, '结束冷却只读取当前来源普通属性');
      } else if (binding.kind !== 'parameter' || binding.skillKey !== configuration.skill.skillKey
        || configuration.parameters.find(row => row.parameterKey === binding.parameterKey)?.valueMode === 'RUNTIME_INPUT') fail(path, '结束冷却不读取事件、资源或动态输入');
    }
  }
  const expression = wrapValueRuleExpression(compileNumericValue(value, `${path}.value`, numeric, fail), result.valueRule);
  const fixed = tryFoldConstant(expression);
  if (fixed !== null && (!Number.isFinite(fixed) || fixed <= 0)) return fail(path, '结束冷却时长必须为有限正值');
  // 通用SET_REMAINING允许重置为0；结束冷却要求原值为正，非正值不能被max夹成成功。
  return { op: 'if', args: [{ op: 'gt', args: [expression, { op: 'const', value: 0 }] },
    { op: 'max', args: [{ op: 'const', value: 1 }, { op: 'round', expr: expression }] }, { op: 'const', value: -1 }] };
}

/** 到期尾没有伪造的监听能力；按真实自身字段和被设置的唯一INITIAL核对作者来源。 */
export function ownCounterCooldownExpiryOriginMatches(input: CompileRequest, origin: OperationOrigin): boolean {
  const match = /^source\.provider\[([^\]]+)\]\.state\[([a-z][a-z0-9_]*)\]$/.exec(origin.abilityRef);
  if (!match || origin.compiledPaths.length !== 1) return false;
  const mounts = input.combatants.find(actor => actor.key === 'source')?.providers.filter(row => row.providerRef === match[1]) ?? [];
  const providerIndex = input.sharedProviders?.findIndex(row => row.providerKey === mounts[0]?.definitionRef) ?? -1;
  const provider = input.sharedProviders?.[providerIndex], field = provider?.initialStateSchema?.[match[2]!];
  if (mounts.length !== 1 || !provider || provider.kind !== 'character' || provider.skillKey !== origin.skillKey || provider.lifecycle
    || origin.providerDefinitionRef !== undefined && origin.providerDefinitionRef !== provider.providerKey
    || !field || typeof field !== 'object' || field.valueType !== 'integer' || field.stateKind || field.onExpire?.length !== 1
    || field.defaultValue !== 0 || field.maxValue !== 1 || field.refreshPolicy !== 'refresh_on_write'
    || origin.compiledPaths[0] !== `sharedProviders[${providerIndex}].initialStateSchema.${match[2]}.onExpire[0]`) return false;
  const operation = field.onExpire[0]!;
  const bindings = input.rules.skillActionBindings?.filter(row => row.source === 'source' && row.skillKey === origin.skillKey
    && row.providerRef === match[1] && row.providerDefinitionRef === provider.providerKey) ?? [];
  const initials = bindings.flatMap(row => row.controls.filter(control => control.action === 'INITIAL'));
  const expected = initials[0]?.abilityRef;
  const initialKey = /^source\.provider\[[^\]]+\]\.ability\[([^\]]+)\]$/.exec(expected ?? '')?.[1];
  const abilities = provider.abilities?.filter(row => row.abilityKey === initialKey) ?? [];
  return bindings.length === 1 && initials.length === 1 && abilities.length === 1 && abilities[0]!.kind === 'active'
    && abilities[0]!.skillKey === origin.skillKey && abilities[0]!.processControl?.action === 'INITIAL'
    && operation.operation === 'cooldown_change' && operation.target === 'self' && operation.valuePolicy === 'set_remaining'
    && operation.abilityRef === expected && operation.ref === origin.operationRef && !!operation.amount
    && !operation.condition && !operation.repeatCount && !operation.repeatDelayMs && !operation.repeatScope
    && origin.operationRef === `skills.${origin.skillKey}.effects.${origin.effectKey}.results.${origin.resultKey}`;
}

import type { SkillEffect } from '../types/skillEffect';
import type { ModifierZone } from '../types/modifierZone';
import type { OperationDefinition, ProviderDefinition } from '../types/genericEngine';
import { compileNumericValue, constExpr, finiteNumber, NumericAdaptationError, tryFoldConstant, wrapValueRuleExpression, type NumericCompileState } from './numericAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: object, keys: string[], path: string) { for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, '未接入的有限持续属性字段'); }

/** 明确的自身单层刷新；只为当前实例的持续属性读取已过时间。 */
export function compileTimedAttributeEffect(effect: SkillEffect, state: NumericCompileState, zones: readonly ModifierZone[], parentDefinition = `process_${state.skillKey}`) {
  const root = `skills.${state.skillKey}.effects.${effect.effectKey}`;
  const life = effect.lifecycle;
  if (!life || effect.gameId !== state.gameId || effect.skillKey !== state.skillKey) fail(root, '有限持续属性需要同技能完整生命周期');
  exact(life, ['durationValue', 'maxStacksValue', 'applicationStacksValue', 'instanceScope', 'reapplicationStackMode', 'reapplicationDurationMode', 'expiryMode', 'periodicIntervalValue', 'firstPeriodicExecution', 'endWhenShieldEndsResultKey'], `${root}.lifecycle`);
  if (life.instanceScope !== 'SOURCE' || life.expiryMode !== 'ALL_AT_ONCE' || life.reapplicationStackMode !== 'KEEP' || life.reapplicationDurationMode !== 'REFRESH_ALL'
    || life.periodicIntervalValue !== null || life.firstPeriodicExecution !== null || life.endWhenShieldEndsResultKey != null || !life.durationValue || !effect.results.length) fail(`${root}.lifecycle`, '有限持续属性只接入自身单层、刷新全部且无周期的有期效果');
  const staticState = { ...state, bindParameters: false, allowAttributeReads: false, allowedContextKeys: undefined };
  for (const key of ['maxStacksValue', 'applicationStacksValue'] as const) if (tryFoldConstant(compileNumericValue(life[key], `${root}.lifecycle.${key}`, staticState, fail)) !== 1) fail(`${root}.lifecycle.${key}`, '有限持续属性只接入单层');
  const duration = tryFoldConstant(compileNumericValue(life.durationValue, `${root}.lifecycle.durationValue`, staticState, fail));
  if (duration === null || !Number.isSafeInteger(duration) || duration <= 0) fail(`${root}.lifecycle.durationValue`, '持续时间必须是明确正整数，不能读取实例已过时间');
  const providerKey = `timed/${parentDefinition}/${state.skillKey}/${effect.effectKey}`;
  const provider: ProviderDefinition = { providerKey, skillKey: state.skillKey, kind: 'status', stableId: providerKey,
    lifecycle: { durationMs: constExpr(duration), maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' }, modifiers: [] };
  const seen = new Set<string>();
  for (const result of effect.results) {
    const path = `${root}.results.${result.resultKey}`;
    if (seen.has(result.resultKey)) fail(path, '结果身份重复');
    seen.add(result.resultKey);
    exact(result, ['resultKey', 'name', 'resultType', 'target', 'description', 'sortOrder', 'lifecycleBehavior', 'spellShieldBlockScope', 'valueRule', 'detail'], path);
    const behavior = result.lifecycleBehavior;
    if (result.resultType !== 'ATTRIBUTE_CHANGE' || result.target !== 'SOURCE' || result.spellShieldBlockScope !== null || !behavior
      || behavior.moment !== 'PERSISTENT' || behavior.valueReadMode !== 'MOMENT_EVALUATION' || behavior.stackValueMode !== 'SHARED'
      || behavior.reapplicationValueMode !== null || behavior.periodicExecutionMode !== null || !result.valueRule) fail(path, '只接入自身持续属性当前时点求值，不能把时间读取授权给其它结果');
    exact(behavior, ['moment', 'valueReadMode', 'stackValueMode', 'reapplicationValueMode', 'periodicExecutionMode'], `${path}.lifecycleBehavior`);
    exact(result.detail, ['attributeKey', 'operation', 'modifierZoneKey'], `${path}.detail`);
    const zone = zones.filter(row => row.modifierZoneKey === result.detail.modifierZoneKey);
    if (zone.length !== 1 || zone[0]!.gameId !== state.gameId || zone[0]!.status !== 'ENABLED' || zone[0]!.domain !== 'ATTRIBUTE'
      || !(zone[0]!.calculationMode === 'FLAT_ADD' && zone[0]!.applicationStage === 'ATTRIBUTE_FLAT'
        || zone[0]!.calculationMode === 'RATIO_ADD' && zone[0]!.applicationStage === 'ATTRIBUTE_PERCENT')
      || result.detail.operation !== 'INCREASE' || result.detail.attributeKey === 'hp') fail(`${path}.detail`, '有限实时属性只接入真实启用的加算或比例增加区域');
    const rule = result.valueRule;
    exact(rule, ['value', 'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue'], `${path}.valueRule`);
    finiteNumber(rule.fixedMultiplier, `${path}.valueRule.fixedMultiplier`, fail);
    for (const key of ['fixedMinValue', 'fixedMaxValue'] as const) if (rule[key] !== null) finiteNumber(rule[key], `${path}.valueRule.${key}`, fail);
    if (rule.fixedMinValue !== null && rule.fixedMaxValue !== null && rule.fixedMinValue > rule.fixedMaxValue) fail(path, '数值下界不能高于上界');
    const value = wrapValueRuleExpression(compileNumericValue(rule.value, `${path}.valueRule.value`, { ...state, bindParameters: false,
      allowedContextKeys: new Set(['effect_elapsed_ms'] as const) }, fail), rule);
    state.requiredAttributes.add(result.detail.attributeKey);
    provider.modifiers!.push({ modifierKey: result.resultKey, kind: 'attribute', target: `self.attr.${result.detail.attributeKey}`,
      valuePolicy: zone[0]!.calculationMode === 'FLAT_ADD' ? 'add' : 'add_percent', bucket: zone[0]!.modifierZoneKey, value });
  }
  const operation: OperationDefinition = { operation: 'apply_provider', target: 'self', providerDefinitionRef: providerKey };
  return { provider, operation };
}

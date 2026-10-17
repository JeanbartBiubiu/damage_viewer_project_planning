import type { OperationDefinition, ProviderDefinition } from '../types/genericEngine';
import type { SkillEffect } from '../types/skillEffect';
import type { ModifierZone } from '../types/modifierZone';
import type { NumericValue } from '../types/numericValue';
import { compileNumericValue, constExpr, finiteNumber, NumericAdaptationError, tryFoldConstant, wrapValueRuleExpression, type NumericCompileState } from './numericAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: object, keys: string[], path: string) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, '未接入的关联盾字段');
}
function staticInteger(value: NumericValue, path: string, state: NumericCompileState, minimum: number): number {
  const result = tryFoldConstant(compileNumericValue(value, path, { ...state, bindParameters: false, allowAttributeReads: false }, fail));
  if (result === null || !Number.isSafeInteger(result) || result < minimum) fail(path, '关联盾需要明确的合法整数');
  return result;
}

export function shieldEffectDefinitionRef(skillKey: string, effectKey: string, parentDefinition = `process_${skillKey}`) { return `shield/${parentDefinition}/${skillKey}/${effectKey}`; }
export function shieldResultDefinitionRef(skillKey: string, effectKey: string, resultKey: string, parentDefinition = `process_${skillKey}`) { return `${shieldEffectDefinitionRef(skillKey, effectKey, parentDefinition)}/${resultKey}`; }

/** 关联只由作者字段建立；盾与持续修正共享一个实例，不能另行 apply_provider 重复施加。 */
export function compileLinkedShieldEffect(effect: SkillEffect, state: NumericCompileState, zones: readonly ModifierZone[] = [], parentDefinition?: string) {
  const root = `skills.${state.skillKey}.effects.${effect.effectKey}`;
  if (effect.gameId !== state.gameId || effect.skillKey !== state.skillKey || !/^[a-z][a-z0-9_]{0,63}$/.test(effect.effectKey)
    || parentDefinition !== undefined && (!parentDefinition || /[\]\s]/.test(parentDefinition))) fail(root, '关联盾需要明确的同技能效果与合法父定义身份');
  exact(effect, ['gameId', 'skillKey', 'effectKey', 'name', 'description', 'sortOrder', 'lifecycle', 'results', 'createdAt', 'updatedAt'], root);
  const life = effect.lifecycle;
  if (!life || !life.endWhenShieldEndsResultKey) fail(`${root}.lifecycle.endWhenShieldEndsResultKey`, '普通盾需要明确关联本效果数值盾的生命周期');
  exact(life, ['durationValue', 'maxStacksValue', 'applicationStacksValue', 'instanceScope', 'reapplicationStackMode', 'reapplicationDurationMode', 'expiryMode', 'periodicIntervalValue', 'firstPeriodicExecution', 'endWhenShieldEndsResultKey'], `${root}.lifecycle`);
  if (!['SOURCE', 'SOURCE_TARGET'].includes(life.instanceScope) || life.reapplicationStackMode !== 'KEEP'
    || life.periodicIntervalValue !== null || life.firstPeriodicExecution !== null
    || staticInteger(life.maxStacksValue, `${root}.lifecycle.maxStacksValue`, state, 1) !== 1
    || staticInteger(life.applicationStacksValue, `${root}.lifecycle.applicationStacksValue`, state, 1) !== 1) fail(`${root}.lifecycle`, '关联盾只接入明确来源或来源目标、共享单层且无周期的保持实例');
  let duration: number | null = null;
  if (life.expiryMode === 'ALL_AT_ONCE' && life.durationValue != null && life.reapplicationDurationMode === 'REFRESH_ALL') {
    duration = staticInteger(life.durationValue, `${root}.lifecycle.durationValue`, state, 1);
  } else if (!(life.expiryMode === 'EXPLICIT_ONLY' && life.durationValue === null && life.reapplicationDurationMode === null)) {
    fail(`${root}.lifecycle`, '关联盾只接入整体刷新到期或真正无期限的显式移除');
  }
  const shields = effect.results.filter(result => result.resultType === 'NORMAL_SHIELD');
  const shield = shields[0];
  if (shields.length !== 1 || !shield || shield.resultKey !== life.endWhenShieldEndsResultKey) fail(`${root}.lifecycle.endWhenShieldEndsResultKey`, '关联必须指向同效果唯一普通盾');
  if (life.instanceScope === 'SOURCE' && shield.target !== 'SOURCE' || life.instanceScope === 'SOURCE_TARGET' && shield.target !== 'TARGET') fail(`${root}.results.${shield.resultKey}.target`, '普通盾目标必须与实例范围一致');
  const providerKey = shieldEffectDefinitionRef(state.skillKey, effect.effectKey, parentDefinition);
  const provider: ProviderDefinition = { providerKey, skillKey: state.skillKey, kind: 'status', stableId: providerKey,
    linkedShieldDefinitionRef: shieldResultDefinitionRef(state.skillKey, effect.effectKey, shield.resultKey, parentDefinition),
    lifecycle: { ...(duration !== null ? { durationMs: constExpr(duration) } : {}), maxStacks: 1, refreshPolicy: 'replace',
      ...(life.instanceScope === 'SOURCE_TARGET' ? { instanceScope: 'source_target' } : {}) } };
  const keys = new Set<string>();
  let amount;
  for (const result of effect.results) {
    const path = `${root}.results.${result.resultKey}`;
    exact(result, ['resultKey', 'name', 'resultType', 'target', 'description', 'sortOrder', 'lifecycleBehavior', 'spellShieldBlockScope', 'valueRule', 'detail'], path);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(result.resultKey)) fail(path, '结果需要合法稳定标识');
    if (keys.has(result.resultKey)) fail(path, '关联盾结果身份重复');
    keys.add(result.resultKey);
    const behavior = result.lifecycleBehavior;
    if (result.target !== shield.target || result.spellShieldBlockScope !== null || !behavior || behavior.moment !== 'PERSISTENT'
      || behavior.valueReadMode !== 'APPLICATION_SNAPSHOT' || behavior.stackValueMode !== 'SHARED'
      || behavior.reapplicationValueMode !== 'REPLACE' || behavior.periodicExecutionMode !== null) fail(path, '关联盾结果需要同目标、无阻挡资格、共享施加快照和重读覆盖');
    exact(behavior, ['moment', 'valueReadMode', 'stackValueMode', 'reapplicationValueMode', 'periodicExecutionMode'], `${path}.lifecycleBehavior`);
    const rule = result.valueRule;
    if (!rule) fail(`${path}.valueRule`, '持续结果数值缺失');
    exact(rule, ['value', 'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue'], `${path}.valueRule`);
    finiteNumber(rule.fixedMultiplier, `${path}.valueRule.fixedMultiplier`, fail);
    for (const key of ['fixedMinValue', 'fixedMaxValue'] as const) if (rule[key] !== null) finiteNumber(rule[key], `${path}.valueRule.${key}`, fail);
    if (rule.fixedMinValue !== null && rule.fixedMaxValue !== null && rule.fixedMinValue > rule.fixedMaxValue) fail(`${path}.valueRule`, '数值下界不能高于上界');
    const expression = wrapValueRuleExpression(compileNumericValue(rule.value, `${path}.valueRule.value`, state, fail), rule);
    const folded = tryFoldConstant(expression);
    if (folded !== null && (!Number.isFinite(folded) || folded < 0)) fail(`${path}.valueRule`, '持续结果金额必须是有限非负数');
    if (result.resultType === 'NORMAL_SHIELD') {
      exact(result.detail, ['absorbedDamageTypeKey', 'decayMode'], `${path}.detail`);
      if (result.detail.absorbedDamageTypeKey !== null || result.detail.decayMode !== 'NONE') fail(`${path}.detail`, '只接入普通全伤害、无衰减数值盾');
      amount = expression;
    } else if (result.resultType === 'ATTRIBUTE_CHANGE') {
      exact(result.detail, ['attributeKey', 'operation', 'modifierZoneKey'], `${path}.detail`);
      const zone = zones.filter(row => row.modifierZoneKey === result.detail.modifierZoneKey);
      if (zone.length !== 1 || zone[0]!.gameId !== state.gameId || zone[0]!.status !== 'ENABLED' || zone[0]!.domain !== 'ATTRIBUTE'
        || !(zone[0]!.calculationMode === 'FLAT_ADD' && zone[0]!.applicationStage === 'ATTRIBUTE_FLAT'
          || ['RATIO_ADD', 'RATIO_MULTIPLY'].includes(zone[0]!.calculationMode) && zone[0]!.applicationStage === 'ATTRIBUTE_PERCENT')
        || !['INCREASE', 'DECREASE'].includes(result.detail.operation) || result.detail.attributeKey === 'hp'
        || folded === null || result.detail.operation === 'DECREASE' && zone[0]!.calculationMode !== 'FLAT_ADD' && folded > 1) fail(`${path}.detail`, '关联盾持续属性需要完整修正区与明确施加快照数值');
      state.requiredAttributes.add(result.detail.attributeKey);
      const signed = result.detail.operation === 'DECREASE' ? -folded : folded;
      const multiply = zone[0]!.calculationMode === 'RATIO_MULTIPLY';
      (provider.modifiers ??= []).push({ modifierKey: result.resultKey, kind: 'attribute', target: `self.attr.${result.detail.attributeKey}`, bucket: zone[0]!.modifierZoneKey,
        valuePolicy: multiply ? 'multiply' : zone[0]!.calculationMode === 'FLAT_ADD' ? 'add' : 'add_percent', value: constExpr(multiply ? 1 + signed : signed) });
    } else fail(`${path}.resultType`, '关联盾尚未接入该持续结果，不能只执行普通盾');
  }
  const operation: OperationDefinition = { operation: 'shield', target: shield.target === 'SOURCE' ? 'self' : 'target', amount,
    shieldRef: shieldResultDefinitionRef(state.skillKey, effect.effectKey, shield.resultKey, parentDefinition), shieldLifecycleProviderDefinitionRef: providerKey,
    ...(duration !== null ? { shieldDurationMs: constExpr(duration) } : {}), ref: `${root}.results.${shield.resultKey}` };
  return { provider, operation };
}

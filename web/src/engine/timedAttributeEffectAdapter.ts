import type { SkillEffect, SkillEffectValueRule } from '../types/skillEffect';
import type { ModifierZone } from '../types/modifierZone';
import type { OperationDefinition, ProviderDefinition } from '../types/genericEngine';
import { compileNumericValue, constExpr, finiteNumber, NumericAdaptationError, tryFoldConstant, wrapValueRuleExpression, type NumericCompileState } from './numericAdapter';
import { staticEffectAmount } from './staticEffectValue';
import { groupedAmplificationFields, staticGroupedAmplificationAmount } from './groupedAmplification';
import { skillFormulaReachableInputs } from '../services/skillFormulaContract';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: object, keys: string[], path: string) { for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, '未接入的有限持续属性字段'); }

/** 只路由实际读取属性的施加快照；原静态叠层继续走原有入口。 */
export function requiresSelfAttributeSnapshot(effect: SkillEffect, state: NumericCompileState): boolean {
  return effect.results.some(result => result.lifecycleBehavior?.valueReadMode === 'APPLICATION_SNAPSHOT') && effect.results.some(result => {
    const value = result.valueRule?.value;
    return value?.kind === 'FORMULA' && state.formulas?.some(formula => formula.formulaKey === value.formulaKey
      && skillFormulaReachableInputs(formula.expression).some(input => input.binding.kind === 'attribute'));
  });
}

/** 仅完整自身平加组使用；运行期采样和整组冻结仍归原生生命周期。 */
function selfSnapshotAmount(rule: SkillEffectValueRule, path: string, state: NumericCompileState) {
  const value = rule.value;
  const parameterKeys: string[] = value.kind === 'PARAMETER' ? [value.parameterKey] : [];
  if (value.kind === 'FORMULA') {
    const matches = state.formulas?.filter(formula => formula.formulaKey === value.formulaKey) ?? [];
    if (matches.length !== 1) fail(path, '自身快照缺少唯一完整公式');
    for (const { binding } of skillFormulaReachableInputs(matches[0]!.expression)) {
      if (binding.kind === 'parameter') parameterKeys.push(binding.parameterKey);
      else if (binding.kind !== 'attribute' || binding.object !== 'source' || binding.view !== 'current_frame' || binding.attributeKey === 'hp') {
        fail(path, '自身属性快照只允许来源普通属性和静态参数，不读取生命、对方、状态或实例时间');
      }
    }
  }
  for (const key of parameterKeys) {
    const matches = state.parameters?.filter(parameter => parameter.parameterKey === key) ?? [];
    if (matches.length !== 1 || matches[0]!.valueMode === 'RUNTIME_INPUT') fail(path, '自身属性快照不能读取计算时输入');
  }
  return wrapValueRuleExpression(compileNumericValue(rule.value, `${path}.value`, { ...state, bindParameters: false,
    allowAttributeReads: true, runtimeInputReads: undefined, processStartStateBindings: undefined,
    sceneParameterValues: undefined, allowedContextKeys: undefined }, fail), rule);
}

/** 共同的自身有限单层刷新边界；调用者继续校验真实结果种类和读取方式。 */
export function compileSelfSingleLayerLifecycle(effect: SkillEffect, state: NumericCompileState) {
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
  return { durationMs: constExpr(duration), maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' as const };
}

/** 自身单层刷新；普通属性平加可整组冻结施加前读值，实时属性才可读本实例时间。 */
export function compileTimedAttributeEffect(effect: SkillEffect, state: NumericCompileState, zones: readonly ModifierZone[], parentDefinition = `process_${state.skillKey}`) {
  const root = `skills.${state.skillKey}.effects.${effect.effectKey}`;
  const lifecycle = compileSelfSingleLayerLifecycle(effect, state);
  const providerKey = `timed/${parentDefinition}/${state.skillKey}/${effect.effectKey}`;
  const provider: ProviderDefinition = { providerKey, skillKey: state.skillKey, kind: 'status', stableId: providerKey,
    lifecycle, modifiers: [] };
  const attributeSnapshot = requiresSelfAttributeSnapshot(effect, state);
  const seen = new Set<string>();
  for (const result of effect.results) {
    const path = `${root}.results.${result.resultKey}`;
    if (seen.has(result.resultKey)) fail(path, '结果身份重复');
    seen.add(result.resultKey);
    exact(result, ['resultKey', 'name', 'resultType', 'target', 'description', 'sortOrder', 'lifecycleBehavior', 'spellShieldBlockScope', 'valueRule', 'detail'], path);
    const behavior = result.lifecycleBehavior;
    const snapshot = behavior?.valueReadMode === 'APPLICATION_SNAPSHOT';
    if (result.resultType !== 'ATTRIBUTE_CHANGE' || result.target !== 'SOURCE' || result.spellShieldBlockScope !== null || !behavior
      || behavior.moment !== 'PERSISTENT' || !['MOMENT_EVALUATION', 'APPLICATION_SNAPSHOT'].includes(behavior.valueReadMode ?? '') || behavior.stackValueMode !== 'SHARED'
      || behavior.reapplicationValueMode !== (snapshot ? 'REPLACE' : null) || behavior.periodicExecutionMode !== null || !result.valueRule
      || snapshot && effect.results.some(row => row.lifecycleBehavior?.valueReadMode !== 'APPLICATION_SNAPSHOT')) fail(path, '只接入自身实时持续属性或同一施加前值的完整快照组，不能把时间读取授权给快照');
    exact(behavior, ['moment', 'valueReadMode', 'stackValueMode', 'reapplicationValueMode', 'periodicExecutionMode'], `${path}.lifecycleBehavior`);
    exact(result.detail, ['attributeKey', 'operation', 'modifierZoneKey'], `${path}.detail`);
    if (result.detail.operation === 'LIMIT_MAX') {
      if (attributeSnapshot) fail(`${path}.detail`, '属性读取快照组只接受普通属性平加');
      if (result.detail.attributeKey === 'hp' || result.detail.modifierZoneKey !== null) fail(`${path}.detail`, '最终上界只接受非生命普通属性且不使用乘区');
      const limit = staticEffectAmount(result.valueRule, `${path}.valueRule`, state);
      if (!Number.isFinite(limit)) fail(`${path}.valueRule`, '最终上界必须是明确静态有限数值');
      state.requiredAttributes.add(result.detail.attributeKey);
      provider.modifiers!.push({ modifierKey: result.resultKey, kind: 'attribute', target: `self.attr.${result.detail.attributeKey}`,
        valuePolicy: 'min', stage: 'final', value: constExpr(limit) });
      continue;
    }
    const zone = zones.filter(row => row.modifierZoneKey === result.detail.modifierZoneKey);
    if (zone.length !== 1 || zone[0]!.gameId !== state.gameId || zone[0]!.status !== 'ENABLED' || zone[0]!.domain !== 'ATTRIBUTE'
      || !(zone[0]!.calculationMode === 'FLAT_ADD' && zone[0]!.applicationStage === 'ATTRIBUTE_FLAT'
        || zone[0]!.calculationMode === 'RATIO_ADD' && zone[0]!.applicationStage === 'ATTRIBUTE_PERCENT'
        || zone[0]!.calculationMode === 'RATIO_GROUP_ADD' && zone[0]!.applicationStage === 'ATTRIBUTE_PERCENT'
        || snapshot && zone[0]!.calculationMode === 'RATIO_MULTIPLY' && zone[0]!.applicationStage === 'ATTRIBUTE_PERCENT'
        || snapshot && zone[0]!.calculationMode === 'RATIO_COMPLEMENT_MULTIPLY' && zone[0]!.applicationStage === 'ATTRIBUTE_PERCENT')
      || result.detail.operation !== 'INCREASE') fail(`${path}.detail`, '有限实时属性只接入真实启用的加算或比例增加区域');
    const resourceMax = result.detail.attributeKey === 'hp';
    if (attributeSnapshot && (resourceMax || zone[0]!.calculationMode !== 'FLAT_ADD')) fail(`${path}.detail`, '属性读取快照组只接受非生命普通属性平加');
    if (resourceMax && (!snapshot || zone[0]!.calculationMode !== 'FLAT_ADD' || effect.results.some(row => row.lifecycleBehavior?.valueReadMode !== 'APPLICATION_SNAPSHOT'))) {
      fail(`${path}.detail`, '生命上限只允许同一施加前状态的静态非负平加快照');
    }
    const rule = result.valueRule;
    exact(rule, ['value', 'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue'], `${path}.valueRule`);
    finiteNumber(rule.fixedMultiplier, `${path}.valueRule.fixedMultiplier`, fail);
    for (const key of ['fixedMinValue', 'fixedMaxValue'] as const) if (rule[key] !== null) finiteNumber(rule[key], `${path}.valueRule.${key}`, fail);
    if (rule.fixedMinValue !== null && rule.fixedMaxValue !== null && rule.fixedMinValue > rule.fixedMaxValue) fail(path, '数值下界不能高于上界');
    const complement = zone[0]!.calculationMode === 'RATIO_COMPLEMENT_MULTIPLY';
    const grouped = zone[0]!.calculationMode === 'RATIO_GROUP_ADD';
    const totalMultiply = grouped || zone[0]!.calculationMode === 'RATIO_MULTIPLY';
    const amount = grouped ? staticGroupedAmplificationAmount(rule, `${path}.valueRule`, state) : snapshot && !attributeSnapshot ? staticEffectAmount(rule, `${path}.valueRule`, state) : null;
    if (resourceMax && (amount === null || !Number.isFinite(amount) || amount < 0)) fail(`${path}.valueRule`, '生命上限增量必须为静态有限非负数');
    if (complement && (amount === null || amount < 0 || amount > 1)) fail(`${path}.valueRule`, '剩余比例连乘的静态比例必须在0与1之间');
    if (totalMultiply && (resourceMax || amount === null || amount < 0)) fail(`${path}.valueRule`, '自身整体增幅必须为静态有限非负比例且不能修改生命上限');
    const value = attributeSnapshot ? selfSnapshotAmount(rule, `${path}.valueRule`, state) : grouped ? groupedAmplificationFields(zone[0]!.modifierZoneKey, amount!, path).value : snapshot ? constExpr(totalMultiply ? 1 + amount! : amount!) : wrapValueRuleExpression(compileNumericValue(rule.value, `${path}.valueRule.value`, { ...state, bindParameters: false,
      allowedContextKeys: new Set(['effect_elapsed_ms'] as const) }, fail), rule);
    state.requiredAttributes.add(result.detail.attributeKey);
    provider.modifiers!.push({ modifierKey: result.resultKey, kind: resourceMax ? 'resource_max' : 'attribute', target: `self.attr.${result.detail.attributeKey}`,
      ...(resourceMax ? { currentValuePolicy: 'grant_positive_delta_clamp' as const } : {}),
      valuePolicy: complement ? 'complement_multiply' : totalMultiply ? 'multiply' : zone[0]!.calculationMode === 'FLAT_ADD' ? 'add' : 'add_percent',
      ...(grouped ? { multiplierGroupKey: groupedAmplificationFields(zone[0]!.modifierZoneKey, amount!, path).multiplierGroupKey } : {}),
      ...(complement || totalMultiply ? { stage: 'total' } : {}), ...(!resourceMax ? { bucket: zone[0]!.modifierZoneKey } : {}),
      ...(attributeSnapshot ? { valueReadMode: 'APPLICATION_SNAPSHOT' as const } : {}), value });
  }
  const operation: OperationDefinition = { operation: 'apply_provider', target: 'self', providerDefinitionRef: providerKey,
    ref: effect.results.length === 1 ? `${root}.results.${effect.results[0]!.resultKey}` : root };
  return { provider, operation };
}

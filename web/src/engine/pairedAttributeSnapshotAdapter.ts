import type { SkillEffect } from '../types/skillEffect';
import type { SkillParameter } from '../types/skillParameter';
import type { SkillFormula } from '../types/skillFormula';
import type { ModifierZone } from '../types/modifierZone';
import type { ProviderDefinition } from '../types/genericEngine';
import { compileNumericValue, constExpr, NumericAdaptationError, type NumericCompileState, wrapValueRuleExpression } from './numericAdapter';
import { staticEffectAmount } from './staticEffectValue';
import { compilePersistentResult } from './persistentResultAdapter';

type Authored = { gameId: string; skillKey: string; skillLevel: number; characterLevel: number;
  parameters?: readonly SkillParameter[]; formulas?: readonly SkillFormula[];
  modifierZones?: ReadonlyArray<Pick<ModifierZone, 'modifierZoneKey' | 'domain' | 'calculationMode' | 'status'> & Partial<Pick<ModifierZone, 'gameId' | 'applicationStage'>>> };
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => same(left[key], right[key]));
};
const fail = (path: string, message: string): never => { throw new NumericAdaptationError(path, message); };
const exact = (value: object, allowed: readonly string[], path: string) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, '双端快照不能丢弃未识别的作者字段');
};

/** 两个完整作者结果只生成一项实际目标应用，全部修正值在同一施加前视图冻结。 */
export function compilePairedAttributeSnapshot(authored: Authored, effect: SkillEffect, state: NumericCompileState) {
  if (effect.results.length !== 2 || !effect.results.every(result => result.resultType === 'ATTRIBUTE_CHANGE')) return null;
  const target = effect.results.find(result => result.target === 'TARGET'), source = effect.results.find(result => result.target === 'SOURCE');
  if (!target || !source || target.resultType !== 'ATTRIBUTE_CHANGE' || source.resultType !== 'ATTRIBUTE_CHANGE') return null;
  const root = `skills.${authored.skillKey}.effects.${effect.effectKey}`;
  if (target.resultKey === source.resultKey || !/^[a-z][a-z0-9_]{0,63}$/.test(target.resultKey)
    || !/^[a-z][a-z0-9_]{0,63}$/.test(source.resultKey)) fail(root, '双端快照结果需要不同的合法稳定标识');
  for (const result of [target, source]) {
    exact(result, ['resultKey', 'name', 'resultType', 'target', 'description', 'sortOrder', 'lifecycleBehavior', 'spellShieldBlockScope', 'valueRule', 'detail'], `${root}.results.${result.resultKey}`);
    exact(result.detail, ['attributeKey', 'operation', 'modifierZoneKey'], `${root}.results.${result.resultKey}.detail`);
    if (result.valueRule) exact(result.valueRule, ['value', 'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue'], `${root}.results.${result.resultKey}.valueRule`);
  }
  const behavior = { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null };
  if (!same(target.lifecycleBehavior, behavior) || !same(source.lifecycleBehavior, behavior)
    || target.spellShieldBlockScope !== 'SKILL' || source.spellShieldBlockScope !== null
    || target.detail.requiredShield !== undefined || source.detail.requiredShield !== undefined
    || target.detail.attributeKey === 'hp' || target.detail.attributeKey !== source.detail.attributeKey
    || target.detail.operation !== 'DECREASE' || source.detail.operation !== 'INCREASE' || !target.valueRule || !source.valueRule) fail(root, '双端快照需要同属性目标总比例减少及来源固定增加，资格只由目标SKILL结果控制');
  const zones = authored.modifierZones ?? [];
  const targetZone = zones.filter(zone => zone.modifierZoneKey === target.detail.modifierZoneKey), sourceZone = zones.filter(zone => zone.modifierZoneKey === source.detail.modifierZoneKey);
  if (targetZone.length !== 1 || targetZone[0]!.calculationMode !== 'RATIO_MULTIPLY' || targetZone[0]!.applicationStage !== 'ATTRIBUTE_PERCENT'
    || sourceZone.length !== 1 || sourceZone[0]!.calculationMode !== 'FLAT_ADD' || sourceZone[0]!.applicationStage !== 'ATTRIBUTE_FLAT'
    || [targetZone[0]!, sourceZone[0]!].some(zone => zone.gameId !== authored.gameId || zone.domain !== 'ATTRIBUTE' || zone.status !== 'ENABLED')) fail(root, '双端快照需要真实启用的总乘算及固定加算区域');
  const targetValue = target.valueRule.value;
  if (targetValue.kind !== 'PARAMETER' && targetValue.kind !== 'FIXED' || target.valueRule.fixedMultiplier !== 1
    || target.valueRule.fixedMinValue !== null && target.valueRule.fixedMinValue !== 0 || target.valueRule.fixedMaxValue !== null) return fail(root, '目标比例只接受同技能静态等级值或固定值');
  const ratio = staticEffectAmount(target.valueRule, `${root}.results.${target.resultKey}.valueRule`, state);
  if (ratio < 0 || ratio > 1) fail(root, '目标比例必须在0至1之间');
  const sourceValue = source.valueRule.value, formula = sourceValue.kind === 'FORMULA' ? authored.formulas?.find(row => row.formulaKey === sourceValue.formulaKey) : undefined;
  if (!formula || formula.expression.stages.length !== 1 || formula.expression.inputs.length !== (targetValue.kind === 'PARAMETER' ? 2 : 1)
    || source.valueRule.fixedMultiplier !== 1 || source.valueRule.fixedMinValue !== null
    || source.valueRule.fixedMaxValue !== null) return fail(root, '来源快照只接受同一次实际目标总值乘同一静态比例的完整公式');
  const output = formula.expression.stages[0]!, expression = output.expression;
  const attribute = formula.expression.inputs.find(input => input.binding.kind === 'attribute');
  if (formula.expression.outputStageKey !== output.key || attribute?.binding.kind !== 'attribute'
    || attribute.binding.object !== 'target' || attribute.binding.view !== 'current_frame' || attribute.binding.valueKind !== 'TOTAL'
    || attribute.binding.attributeKey !== target.detail.attributeKey || expression.op !== 'mul' || expression.args.length !== 2) return fail(root, '来源快照必须只读取实际目标同属性总值');
  const parameter = formula.expression.inputs.find(input => input.binding.kind === 'parameter');
  const ratioExpression = targetValue.kind === 'FIXED' ? { op: 'const', value: String(targetValue.value) }
    : parameter?.binding.kind === 'parameter' && parameter.binding.skillKey === authored.skillKey && parameter.binding.parameterKey === targetValue.parameterKey
      ? { op: 'read', inputKey: parameter.key } : null;
  if (!ratioExpression || !expression.args.some(arg => same(arg, { op: 'read', inputKey: attribute.key }))
    || !expression.args.some(arg => same(arg, ratioExpression))) fail(root, '来源与目标必须使用相同的作者比例，不能只在本等级碰巧相等');
  if (!effect.lifecycle) return fail(root, '双端快照必须有完整有限生命周期');
  exact(effect.lifecycle, ['durationValue', 'maxStacksValue', 'applicationStacksValue', 'instanceScope', 'reapplicationStackMode',
    'reapplicationDurationMode', 'expiryMode', 'periodicIntervalValue', 'firstPeriodicExecution', 'endWhenShieldEndsResultKey'], `${root}.lifecycle`);
  if (effect.lifecycle.endWhenShieldEndsResultKey != null) fail(root, '双端快照不能夹带关联盾生命周期');
  const compiled = compilePersistentResult({ ...authored, effectKey: effect.effectKey, lifecycle: effect.lifecycle!, result: target,
    modifierZones: zones, statuses: [], source: 'source', target: 'target' }, `attribute:${authored.skillKey}:${effect.effectKey}:${target.resultKey}`);
  // 完整生命周期仍由共用目标持续属性校验，来源公式只改变求值时点，不改写原公式。
  const amount = wrapValueRuleExpression(compileNumericValue(sourceValue, `${root}.results.${source.resultKey}.valueRule.value`, state, fail), source.valueRule);
  const provider: ProviderDefinition = { ...compiled.provider, modifiers: [
    { ...compiled.provider.modifiers![0]!, valueReadMode: 'APPLICATION_SNAPSHOT', value: constExpr(1 - ratio) },
    { modifierKey: source.resultKey, kind: 'attribute', target: `opponent.attr.${source.detail.attributeKey}`, valuePolicy: 'add',
      bucket: source.detail.modifierZoneKey!, valueReadMode: 'APPLICATION_SNAPSHOT', value: amount }
  ] };
  state.requiredAttributes.add(target.detail.attributeKey);
  return { provider, operation: compiled.operation, targetResult: target, sourceResult: source };
}

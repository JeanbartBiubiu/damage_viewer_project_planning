import type { NumericValue } from '../types/numericValue';
import type { SkillEffectValueRule } from '../types/skillEffect';
import { skillFormulaReachableInputs } from '../services/skillFormulaContract';
import { compileNumericValue, finiteNumber, NumericAdaptationError, tryFoldConstant, wrapValueRuleExpression, type NumericCompileState } from './numericAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

/** 有期施加快照的窄子集：整个消费依赖必须在所选等级下确定，不采样运行期读值。 */
export function staticEffectValue(value: NumericValue, path: string, state: NumericCompileState): number {
  const parameterKeys: string[] = value.kind === 'PARAMETER' ? [value.parameterKey] : [];
  if (value.kind === 'FORMULA') {
    const formulas = state.formulas?.filter(row => row.formulaKey === value.formulaKey) ?? [];
    if (formulas.length !== 1) fail(path, '静态快照缺少唯一真实公式');
    for (const input of skillFormulaReachableInputs(formulas[0]!.expression)) {
      if (input.binding.kind !== 'parameter') fail(path, '静态快照不能依赖属性、事件或实例时间');
      parameterKeys.push(input.binding.parameterKey);
    }
  }
  for (const key of parameterKeys) {
    const parameters = state.parameters?.filter(row => row.parameterKey === key) ?? [];
    if (parameters.length !== 1 || parameters[0]!.valueMode === 'RUNTIME_INPUT') fail(path, '静态快照不能依赖计算时输入');
  }
  const expression = compileNumericValue(value, path, { ...state, bindParameters: false, allowAttributeReads: false,
    runtimeInputReads: undefined, allowedContextKeys: undefined }, fail);
  const result = tryFoldConstant(expression);
  if (result === null || !Number.isFinite(result)) fail(path, '静态快照的完整依赖必须可折为有限常量');
  return result;
}

export function staticEffectAmount(rule: SkillEffectValueRule, path: string, state: NumericCompileState): number {
  for (const key of Object.keys(rule)) if (!['value', 'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue'].includes(key)) fail(`${path}.${key}`, '未接入的快照数值修正');
  finiteNumber(rule.fixedMultiplier, `${path}.fixedMultiplier`, fail);
  for (const key of ['fixedMinValue', 'fixedMaxValue'] as const) if (rule[key] !== null) finiteNumber(rule[key], `${path}.${key}`, fail);
  if (rule.fixedMinValue !== null && rule.fixedMaxValue !== null && rule.fixedMinValue > rule.fixedMaxValue) fail(path, '数值下界不能高于上界');
  const value = tryFoldConstant(wrapValueRuleExpression({ op: 'const', value: staticEffectValue(rule.value, `${path}.value`, state) }, rule));
  if (value === null || !Number.isFinite(value)) fail(path, '静态快照金额必须为有限常量');
  return value;
}

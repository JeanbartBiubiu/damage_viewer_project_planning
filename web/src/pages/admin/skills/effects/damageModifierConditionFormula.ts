import type { SkillFormula, FormulaExpressionNode } from '../../../../types/skillFormula';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { NumericValue } from '../../../../types/numericValue';
import type { SkillEffectResultDraft, SkillEffectResultIndexError } from './effectForm';
import { skillFormulaReachableInputs, validateStoredSkillFormula } from '../../../../services/skillFormulaContract';
/** 只做完整结构与可达依赖提示；精确比例和恒1证明由后端及原生负责。 */
export function staticDamageModifierConditionFormulaIssue(expression: FormulaExpressionNode, parameters: readonly SkillParameter[]): string | null {
  const parameterBinding = expression.inputs?.find(input => input.binding.kind === 'parameter');
  const skillKey = parameters[0]?.skillKey ?? (parameterBinding?.binding.kind === 'parameter' ? parameterBinding.binding.skillKey : '');
  if (validateStoredSkillFormula(expression, skillKey)) return '门槛公式表达式不完整或授权非法。';
  for (const input of skillFormulaReachableInputs(expression)) {
    if (input.binding.kind !== 'parameter') return '门槛公式不能读取属性。';
    const binding = input.binding;
    const parameter = parameters.find(row => row.parameterKey === binding.parameterKey && row.skillKey === binding.skillKey);
    if (!parameter) return '门槛公式引用的参数不存在。';
    if (parameter.valueMode === 'RUNTIME_INPUT') return '门槛公式不能引用计算时传入的参数。';
  }
  return null;
}
export function staticShieldStackValueIssue(value: NumericValue | null, parameters: readonly SkillParameter[], formulas: readonly Pick<SkillFormula, 'formulaKey' | 'expression'>[]): string | null {
  if (!value) return '层数取值未配置。';
  if (value.kind === 'FIXED') return value.value === 1 ? null : '关联盾要求层数恒为 1。';
  if (value.kind === 'PARAMETER') {
    const parameter = parameters.find(row => row.parameterKey === value.parameterKey);
    if (!parameter) return '层数引用的参数不存在。';
    if (parameter.valueMode === 'RUNTIME_INPUT') return '层数不能引用计算时传入的参数。';
    return null;
  }
  const formula = formulas.find(row => row.formulaKey === value.formulaKey);
  return formula ? staticDamageModifierConditionFormulaIssue(formula.expression, parameters) : '层数公式详情不可用。';
}
export async function preflightDamageModifierConditionFormulas(
  results: readonly SkillEffectResultDraft[],
  parameters: readonly SkillParameter[],
  parametersLoadState: 'ready' | 'failed' | undefined,
  getFormula: (formulaKey: string) => Promise<Pick<SkillFormula, 'expression'>>
): Promise<SkillEffectResultIndexError[]> {
  const errors: SkillEffectResultIndexError[] = [];
  const formulaCache = new Map<string, Promise<Pick<SkillFormula, 'expression'>>>();
  for (const [index, result] of results.entries()) {
    const value = result.resultType === 'DAMAGE_MODIFIER'
      ? result.damageModifierCondition?.comparisonValue : null;
    if (value?.kind !== 'FORMULA') continue;
    let message: string | null;
    if (parametersLoadState !== 'ready') {
      message = '参数目录不完整，无法核对门槛公式。';
    } else {
      try {
        let pending = formulaCache.get(value.formulaKey);
        if (!pending) {
          pending = getFormula(value.formulaKey);
          formulaCache.set(value.formulaKey, pending);
        }
        message = staticDamageModifierConditionFormulaIssue((await pending).expression, parameters);
      } catch {
        message = '无法读取门槛公式详情，请重试。';
      }
    }
    if (message) errors.push({ index, fieldErrors: { conditionComparisonValue: message } });
  }
  return errors;
}

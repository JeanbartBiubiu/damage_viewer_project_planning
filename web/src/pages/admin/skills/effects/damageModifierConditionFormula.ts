import type { SkillFormula, FormulaExpressionNode } from '../../../../types/skillFormula';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillEffectResultDraft, SkillEffectResultIndexError } from './effectForm';

type Fraction = { numerator: bigint; denominator: bigint };
type LevelValue = { skillLevel: string; characterLevel: string; value: Fraction };

function failure(message: string): never {
  throw new Error(message);
}

function fraction(value: number): Fraction {
  if (!Number.isFinite(value)) failure('门槛公式的参数必须是有限数值。');
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) failure('门槛公式的参数不是有效数值。');
  const decimals = match[3] ?? '';
  const exponent = Number(match[4] ?? 0) - decimals.length;
  const digits = BigInt(`${match[2]}${decimals}`);
  const signed = match[1] ? -digits : digits;
  return exponent >= 0
    ? { numerator: signed * 10n ** BigInt(exponent), denominator: 1n }
    : { numerator: signed, denominator: 10n ** BigInt(-exponent) };
}

function compare(left: Fraction, right: Fraction): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function apply(operation: string, left: Fraction, right: Fraction): Fraction {
  switch (operation) {
    case 'ADD': return {
      numerator: left.numerator * right.denominator + right.numerator * left.denominator,
      denominator: left.denominator * right.denominator
    };
    case 'SUBTRACT': return {
      numerator: left.numerator * right.denominator - right.numerator * left.denominator,
      denominator: left.denominator * right.denominator
    };
    case 'MULTIPLY': return {
      numerator: left.numerator * right.numerator,
      denominator: left.denominator * right.denominator
    };
    case 'DIVIDE':
      if (right.numerator === 0n) failure('门槛公式存在除零，无法静态求值。');
      return {
        numerator: left.numerator * right.denominator * (right.numerator < 0n ? -1n : 1n),
        denominator: left.denominator * (right.numerator < 0n ? -right.numerator : right.numerator)
      };
    case 'MIN': return compare(left, right) <= 0 ? left : right;
    case 'MAX': return compare(left, right) >= 0 ? left : right;
    default: return failure('门槛公式运算方式不合法。');
  }
}

function parameterValues(parameterKey: string, parameters: readonly SkillParameter[]): LevelValue[] {
  const parameter = parameters.find((item) => item.parameterKey === parameterKey);
  if (!parameter) failure('门槛公式引用的参数不存在。');
  if (parameter.valueMode === 'RUNTIME_INPUT') failure('门槛公式不能引用计算时传入的参数。');
  if (parameter.valueMode === 'FIXED') {
    if (parameter.fixedValue === null) failure('门槛公式引用的固定参数缺少数值。');
    return [{ skillLevel: '', characterLevel: '', value: fraction(parameter.fixedValue) }];
  }
  if (parameter.valueMode !== 'SKILL_LEVEL' && parameter.valueMode !== 'CHARACTER_LEVEL') {
    failure('门槛公式引用的参数取值方式不合法。');
  }
  const levels = Object.entries(parameter.levelValues ?? {});
  if (levels.length === 0) failure('门槛公式引用的等级参数缺少数值。');
  return levels.map(([level, value]) => ({
    skillLevel: parameter.valueMode === 'SKILL_LEVEL' ? level : '',
    characterLevel: parameter.valueMode === 'CHARACTER_LEVEL' ? level : '',
    value: fraction(value)
  }));
}

function evaluate(node: FormulaExpressionNode, parameters: readonly SkillParameter[], depth: number): LevelValue[] {
  if (depth > 32) failure('门槛公式超过深度限制。');
  if (!node || typeof node !== 'object') failure('门槛公式表达式不完整。');
  if (node.nodeType === 'ATTRIBUTE') failure('门槛公式不能读取属性。');
  if (node.nodeType === 'PARAMETER') return parameterValues(node.parameterKey, parameters);
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2) {
    failure('门槛公式表达式不完整。');
  }
  const left = evaluate(node.operands[0], parameters, depth + 1);
  const right = evaluate(node.operands[1], parameters, depth + 1);
  const values: LevelValue[] = [];
  for (const lhs of left) for (const rhs of right) {
    if (lhs.skillLevel && rhs.skillLevel && lhs.skillLevel !== rhs.skillLevel) continue;
    if (lhs.characterLevel && rhs.characterLevel && lhs.characterLevel !== rhs.characterLevel) continue;
    values.push({
      skillLevel: lhs.skillLevel || rhs.skillLevel,
      characterLevel: lhs.characterLevel || rhs.characterLevel,
      value: apply(node.operation, lhs.value, rhs.value)
    });
  }
  if (!values.length) failure('门槛公式没有可求值的等级组合。');
  return values;
}

export function staticDamageModifierConditionFormulaIssue(
  expression: FormulaExpressionNode,
  parameters: readonly SkillParameter[]
): string | null {
  try {
    const values = evaluate(expression, parameters, 1);
    const zero = fraction(0), one = fraction(1);
    if (values.some(({ value }) => compare(value, zero) < 0 || compare(value, one) > 0)) {
      return '门槛公式全部等级必须是0到1之间的有限比例。';
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : '门槛公式无法静态求值。';
  }
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

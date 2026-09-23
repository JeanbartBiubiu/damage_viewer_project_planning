import type { FormulaExpressionNode, SkillFormula } from '../types/skillFormula';
import type { SkillParameter } from '../types/skillParameter';
import type { NumericValue } from '../types/numericValue';
import type { GenericFormulaExpr, NamedFormula } from '../types/genericEngine';
import type { SkillEffectValueRule } from '../types/skillEffect';

export class NumericAdaptationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'NumericAdaptationError';
  }
}

export type NumericCompileState = {
  gameId: string;
  skillKey: string;
  skillLevel: number;
  characterLevel: number;
  parameters?: readonly SkillParameter[];
  formulas?: readonly SkillFormula[];
  formulaNamespace: string;
  bindParameters: boolean;
  allowAttributeReads: boolean;
  runtimeInputMessage: string;
  /**
   * 仅当前动作显式提供的 RUNTIME_INPUT 读值。未列入的计算时参数仍按 runtimeInputMessage 拒绝。
   * 固定值和等级参数不读取此表。
   */
  runtimeInputReads?: Readonly<Record<string, GenericFormulaExpr>>;
  params: Record<string, number>;
  namedFormulas: Map<string, NamedFormula>;
  requiredAttributes: Set<string>;
};

const OPERATIONS: Record<string, string> = {
  ADD: 'add', SUBTRACT: 'sub', MULTIPLY: 'mul', DIVIDE: 'div', MIN: 'min', MAX: 'max'
};

export function finiteNumber(value: unknown, path: string, fail: (path: string, message: string) => never): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(path, '需要明确的有限数值，不能用零替代缺失值');
  }
  return value;
}

export function constExpr(value: number): GenericFormulaExpr {
  return { op: 'const', value };
}

export function tryFoldConstant(expr: GenericFormulaExpr): number | null {
  if (expr.op === 'const' && typeof expr.value === 'number' && Number.isFinite(expr.value) && !expr.args) {
    return expr.value;
  }
  const folded = expr.args?.map(tryFoldConstant);
  if (!folded || folded.length !== 2 || folded.some((value) => value === null)) return null;
  const [left, right] = folded as [number, number];
  switch (expr.op) {
    case 'add': return left + right;
    case 'sub': return left - right;
    case 'mul': return left * right;
    case 'div': return right === 0 ? null : left / right;
    case 'min': return Math.min(left, right);
    case 'max': return Math.max(left, right);
    default: return null;
  }
}

export function wrapValueRuleExpression(expr: GenericFormulaExpr, rule: SkillEffectValueRule): GenericFormulaExpr {
  let out = expr;
  if (rule.fixedMultiplier !== 1) out = { op: 'mul', args: [out, constExpr(rule.fixedMultiplier)] };
  if (rule.fixedMinValue !== null) out = { op: 'max', args: [out, constExpr(rule.fixedMinValue)] };
  if (rule.fixedMaxValue !== null) out = { op: 'min', args: [out, constExpr(rule.fixedMaxValue)] };
  const folded = tryFoldConstant(out);
  return folded === null ? out : constExpr(folded);
}

function failAt(path: string, message: string): never {
  throw new NumericAdaptationError(path, message);
}

export function compileParameter(
  key: string,
  path: string,
  state: NumericCompileState,
  fail: (path: string, message: string) => never = failAt
): GenericFormulaExpr {
  const matches = state.parameters?.filter((value) => value.parameterKey === key) ?? [];
  if (matches.length !== 1) fail(path, '技能参数缺失或重复');
  const row = matches[0]!;
  if (row.gameId !== state.gameId || row.skillKey !== state.skillKey) fail(path, '参数不属于当前游戏和技能');
  let value: number;
  if (row.valueMode === 'FIXED') value = finiteNumber(row.fixedValue, path, fail);
  else if (row.valueMode === 'SKILL_LEVEL' || row.valueMode === 'CHARACTER_LEVEL') {
    const level = row.valueMode === 'SKILL_LEVEL' ? state.skillLevel : state.characterLevel;
    if (!Number.isInteger(level) || level < 1) fail(path, '本次等级必须明确且有效');
    value = finiteNumber(row.levelValues?.[String(level)], `${path}.levelValues.${level}`, fail);
  } else if (row.valueMode === 'RUNTIME_INPUT') {
    if (!state.runtimeInputReads || !Object.prototype.hasOwnProperty.call(state.runtimeInputReads, key)) {
      return fail(path, state.runtimeInputMessage);
    }
    const mapped = state.runtimeInputReads?.[key];
    if (!mapped) return fail(path, state.runtimeInputMessage);
    return mapped;
  } else return fail(path, state.runtimeInputMessage);
  if (key in state.params && state.params[key] !== value) fail(path, '参数与现有运行输入冲突');
  if (state.bindParameters) {
    state.params[key] = value;
    return { op: 'read', path: `ability.param.${key}` };
  }
  return constExpr(value);
}

export function compileFormulaExpression(
  node: FormulaExpressionNode,
  path: string,
  state: NumericCompileState,
  fail: (path: string, message: string) => never = failAt,
  depth = 0
): GenericFormulaExpr {
  if (depth > 32) return fail(path, '公式深度超过限制');
  if (node.nodeType === 'PARAMETER') return compileParameter(node.parameterKey, `${path}.parameterKey`, state, fail);
  if (node.nodeType === 'OPERATION') {
    const operation = OPERATIONS[node.operation];
    if (!operation || node.operands.length !== 2) return fail(path, '不支持的公式运算');
    return {
      op: operation,
      args: node.operands.map((operand, index) => compileFormulaExpression(operand, `${path}.operands[${index}]`, state, fail, depth + 1))
    };
  }
  if (node.nodeType !== 'ATTRIBUTE' || !['SOURCE', 'TARGET'].includes(node.attributeOwner)) {
    return fail(path, '不支持的公式节点');
  }
  if (!state.allowAttributeReads) {
    return fail(path, '不能把依赖施加时属性的公式改成治疗时实时读取');
  }
  if (typeof node.attributeKey !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(node.attributeKey)) {
    return fail(`${path}.attributeKey`, '需要非空、无重复的合法分类标识');
  }
  state.requiredAttributes.add(node.attributeKey);
  const owner = node.attributeOwner === 'SOURCE' ? 'source' : 'target';
  const read = (field: string): GenericFormulaExpr => ({ op: 'read', path: `${owner}.attr.${node.attributeKey}.${field}` });
  const missing: GenericFormulaExpr = { op: 'sub', args: [read('max'), read('current')] };
  switch (node.attributeValueKind) {
    case 'BASE': return read('base');
    case 'TOTAL': return read('resolved');
    case 'CURRENT': return read('current');
    case 'BONUS': return { op: 'sub', args: [read('resolved'), read('base')] };
    case 'MISSING': return missing;
    case 'CURRENT_RATIO': return { op: 'div', args: [read('current'), read('max')] };
    case 'MISSING_RATIO': return { op: 'div', args: [missing, read('max')] };
    default: return fail(path, '不支持的属性取值口径');
  }
}

export function compileNumericValue(
  value: NumericValue,
  path: string,
  state: NumericCompileState,
  fail: (path: string, message: string) => never = failAt
): GenericFormulaExpr {
  if (value.kind === 'FIXED') return constExpr(finiteNumber(value.value, path, fail));
  if (value.kind === 'PARAMETER') return compileParameter(value.parameterKey, path, state, fail);
  if (value.kind !== 'FORMULA') return fail(path, '不支持的数值来源');
  const matches = state.formulas?.filter((row) => row.formulaKey === value.formulaKey) ?? [];
  if (matches.length !== 1) return fail(path, '技能公式缺失或重复');
  const row = matches[0]!;
  if (row.gameId !== state.gameId || row.skillKey !== state.skillKey) return fail(path, '公式不属于当前游戏和技能');
  const compiled = compileFormulaExpression(row.expression, `${path}.expression`, state, fail);
  if (!state.bindParameters) {
    const folded = tryFoldConstant(compiled);
    // Owned listeners have no ability parameter frame. Inline known parameters
    // while retaining explicitly permitted owner-relative attribute reads.
    if (folded === null && state.allowAttributeReads) return compiled;
    if (folded === null) return fail(path, '本期只能把常量、明确等级参数及完全由其组成的公式折成常量');
    return constExpr(folded);
  }
  const key = `${state.formulaNamespace}/${row.formulaKey}`;
  const existing = state.namedFormulas.get(key);
  if (existing && JSON.stringify(existing.expression) !== JSON.stringify(compiled)) {
    return fail(path, '具名公式与现有输入冲突');
  }
  if (!existing) state.namedFormulas.set(key, { key, expression: compiled });
  return { op: 'ref', ref: key };
}

export function createNumericCompileState(input: Omit<NumericCompileState, 'params' | 'namedFormulas' | 'requiredAttributes'>): NumericCompileState {
  return { ...input, params: {}, namedFormulas: new Map(), requiredAttributes: new Set() };
}

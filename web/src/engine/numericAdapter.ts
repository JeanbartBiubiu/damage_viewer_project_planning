import { approvedFormulaValue, registerFormulaForApprovedReads } from './approvedFormulaValues';
import { skillFormulaReachableInputs, validateStoredSkillFormula, sameFormulaPayload } from '../services/skillFormulaContract';
import type { FormulaAttributeOwner, FormulaAttributeValueKind, SkillFormula } from '../types/skillFormula';
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
  if (expr.op === 'ref' && expr.ref) return approvedFormulaValue(expr.ref);
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
  const folded = hasNamedFormulaReference(out) ? null : tryFoldConstant(out);
  return folded === null ? out : constExpr(folded);
}
export function hasNamedFormulaReference(expr: GenericFormulaExpr): boolean {
  return expr.op === 'ref' || (expr.args?.some(hasNamedFormulaReference) ?? false)
    || !!expr.expr && hasNamedFormulaReference(expr.expr)
    || !!expr.min && hasNamedFormulaReference(expr.min) || !!expr.max && hasNamedFormulaReference(expr.max);
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

/** 仅为既有内部条件构造属性包装；共同作者表达式不翻译为内部树。 */
export function compileAttributeValue(node: { attributeOwner: FormulaAttributeOwner; attributeKey: string; attributeValueKind: FormulaAttributeValueKind }, path: string, state: NumericCompileState,
  fail: (path: string, message: string) => never = failAt): GenericFormulaExpr {
  if (!state.allowAttributeReads) return fail(path, '不能把依赖施加时属性的公式改成治疗时实时读取');
  if (!['SOURCE', 'TARGET'].includes(node.attributeOwner) || !/^[a-z][a-z0-9_]{0,63}$/.test(node.attributeKey)) return fail(path, '不支持的属性绑定');
  state.requiredAttributes.add(node.attributeKey);
  const owner = node.attributeOwner === 'SOURCE' ? 'source' : 'target';
  const read = (field: string): GenericFormulaExpr => ({ op: 'read', path: owner + '.attr.' + node.attributeKey + '.' + field });
  const missing: GenericFormulaExpr = { op: 'sub', args: [read('max'), read('current')] };
  switch (node.attributeValueKind) {
    case 'BASE': return read('base'); case 'TOTAL': return read('resolved'); case 'CURRENT': return read('current'); case 'MAX': return read('max');
    case 'BONUS': return { op: 'sub', args: [read('resolved'), read('base')] };
    case 'MISSING': return missing;
    case 'CURRENT_RATIO': return { op: 'div', args: [read('current'), read('max')] };
    case 'MISSING_RATIO': return { op: 'div', args: [missing, read('max')] };
  }
}
function parameterDirectory(state: NumericCompileState, path: string, fail: (path: string, message: string) => never, declaredKeys: ReadonlySet<string>): NamedFormula['parameters'] {
  return (state.parameters ?? []).filter(row => declaredKeys.has(row.parameterKey)).map(row => {
    if (row.gameId !== state.gameId || row.skillKey !== state.skillKey) return fail(path, '参数不属于当前游戏和技能');
    const base = { parameterKey: row.parameterKey, valueMode: row.valueMode, valueType: row.valueType };
    if (row.valueMode === 'RUNTIME_INPUT') {
      const read = state.runtimeInputReads?.[row.parameterKey];
      if (!read) return base;
      if (read.op === 'read' && read.path === 'use.charge_duration_ms') return { ...base, runtimeSource: { kind: 'use_charge_duration' as const } };
      const match = read.op === 'read' ? /^process\.actual_cost\.([a-z][a-z0-9_]{0,63})$/.exec(read.path ?? '') : null;
      if (match) return { ...base, runtimeSource: { kind: 'process_actual_cost' as const, resourceKey: match[1]! } };
      return fail(path, '共同公式本批不授权该计算时参数供值来源');
    }
    let value: number;
    if (row.valueMode === 'FIXED') value = finiteNumber(row.fixedValue, path, fail);
    else {
      const level = row.valueMode === 'SKILL_LEVEL' ? state.skillLevel : state.characterLevel;
      if (!Number.isInteger(level) || level < 1) return fail(path, '本次等级必须明确且有效');
      value = finiteNumber(row.levelValues?.[String(level)], path + '.levelValues.' + level, fail);
    }
    return { ...base, value };
  });
}

export function registerCommonFormula(row: SkillFormula, path: string, state: NumericCompileState,
  fail: (path: string, message: string) => never = failAt): NamedFormula {
  if (row.gameId !== state.gameId || row.skillKey !== state.skillKey) return fail(path, '公式不属于当前游戏和技能');
  const problem = validateStoredSkillFormula(row.expression, state.skillKey);
  if (problem) return fail(path + '.expression' + problem.path, problem.code);
  const declaredKeys = new Set(row.expression.inputs.flatMap(input => input.binding.kind === 'parameter' ? [input.binding.parameterKey] : []));
  const directory = parameterDirectory(state, path, fail, declaredKeys);
  for (const input of row.expression.inputs) if (input.binding.kind === 'parameter') {
    if (!directory.some(parameter => parameter.parameterKey === (input.binding as Extract<typeof input.binding, {kind: 'parameter'}>).parameterKey)) return fail(path, '公式参数声明不在真实参数目录中');
  }
  const key = state.formulaNamespace + '/' + row.formulaKey;
  const payload: NamedFormula = { key, scope: 'skill', skillKey: row.skillKey, expression: structuredClone(row.expression), parameters: structuredClone(directory) };
  const existing = state.namedFormulas.get(key);
  if (existing && !sameFormulaPayload(existing, payload)) return fail(path, '具名公式与现有完整输入冲突');
  if (!existing) state.namedFormulas.set(key, payload);
  registerFormulaForApprovedReads(payload);
  return state.namedFormulas.get(key)!;
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
  const payload = registerCommonFormula(row, path, state, fail);
  for (const input of skillFormulaReachableInputs(row.expression)) {
    if (input.binding.kind === 'attribute') {
      if (!state.allowAttributeReads) return fail(path, '不能把依赖施加时属性的公式改成治疗时实时读取');
      state.requiredAttributes.add(input.binding.attributeKey);
    } else if (input.binding.kind === 'parameter') {
      const binding = input.binding;
      const parameter = payload.parameters.find(parameter => parameter.parameterKey === binding.parameterKey)!;
      if (parameter.valueMode === 'RUNTIME_INPUT' && !parameter.runtimeSource) return fail(path, state.runtimeInputMessage);
    }
  }
  const key = payload.key;
  return { op: 'ref', ref: key };
}

export function createNumericCompileState(input: Omit<NumericCompileState, 'params' | 'namedFormulas' | 'requiredAttributes'>): NumericCompileState {
  const levels = '/levels/' + input.skillLevel + '/' + input.characterLevel;
  return { ...input, formulaNamespace: input.formulaNamespace.includes('/levels/') ? input.formulaNamespace : input.formulaNamespace + levels, params: {}, namedFormulas: new Map(), requiredAttributes: new Set() };
}

export function staticNumericField(value: NumericValue, path: string, state: NumericCompileState,
  fail: (path: string, message: string) => never = failAt): import('../types/genericEngine').StaticNumericValue {
  const expression = compileNumericValue(value, path, { ...state, bindParameters: false, allowAttributeReads: false }, fail);
  if (expression.op === 'const') return finiteNumber(expression.value, path, fail);
  if (expression.op === 'ref' && expression.ref) return { op: 'ref', ref: expression.ref };
  return fail(path, '静态字段只接受明确数字或共同公式外部引用');
}

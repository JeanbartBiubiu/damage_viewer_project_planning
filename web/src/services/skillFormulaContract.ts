import type { Binding, Expression, FormulaDefinition } from '../types/formulaContract.generated';
import type { SkillParameter } from '../types/skillParameter';
import { validateFormulaDefinition } from './formulaContract';

export const SKILL_FORMULA_VALUE_KINDS = ['BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MAX', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO'] as const;
export function skillFormulaAllowedBindings(skillKey: string,
  parameters: readonly Pick<SkillParameter, 'parameterKey' | 'skillKey'>[],
  attributes: readonly { attributeKey: string; status?: string }[]): Binding[] {
  const allowed: Binding[] = [];
  for (const row of parameters) if (row.skillKey === skillKey) {
    allowed.push({ kind: 'parameter', skillKey, parameterKey: row.parameterKey });
  }
  for (const row of attributes) if (row.status === 'ENABLED') {
    for (const object of ['source', 'target'] as const) for (const valueKind of SKILL_FORMULA_VALUE_KINDS) {
      allowed.push({ kind: 'attribute', object, attributeKey: row.attributeKey, valueKind, view: 'current_frame' });
    }
  }
  return allowed;
}
/** 管理读回保留失效目录项供修复；正式写入使用真实启用目录授权。 */
export function validateStoredSkillFormula(value: unknown, skillKey: string) {
  const inputs = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).inputs : null;
  const declared = Array.isArray(inputs) ? inputs.flatMap<Binding>(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const binding = (row as Record<string, unknown>).binding as Binding | undefined;
    if (binding?.kind === 'parameter' && binding.skillKey === skillKey) return [binding];
    if (binding?.kind === 'attribute' && ['source', 'target'].includes(binding.object)
      && binding.view === 'current_frame' && SKILL_FORMULA_VALUE_KINDS.includes(binding.valueKind)) return [binding];
    return [];
  }) : [];
  return validateFormulaDefinition(value, declared);
}
/** 输出可达读取，两条条件分支均加入。只收依赖，不解释运算或选择条件。 */
export function skillFormulaReachableInputs(formula: FormulaDefinition): FormulaDefinition['inputs'] {
  const stageByKey = new Map(formula.stages.map(stage => [stage.key, stage]));
  const visited = new Set<string>();
  const reads = new Set<string>();
  const visitStage = (key: string): void => {
    if (visited.has(key)) return;
    visited.add(key);
    const stage = stageByKey.get(key);
    if (stage) walk(stage.expression);
  };
  const walk = (expression: Expression): void => {
    if (expression.op === 'read') reads.add(expression.inputKey);
    else if (expression.op === 'ref') visitStage(expression.stageKey);
    else if ('args' in expression) expression.args.forEach(walk);
  };
  visitStage(formula.outputStageKey);
  return formula.inputs.filter(input => reads.has(input.key));
}
export function skillFormulaParameterKeys(formula: FormulaDefinition, reachableOnly = true): string[] {
  const inputs = reachableOnly ? skillFormulaReachableInputs(formula) : formula.inputs;
  return [...new Set(inputs.flatMap(input => input.binding.kind === 'parameter' ? [input.binding.parameterKey] : []))];
}
export function sameFormulaPayload(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((item, index) => sameFormulaPayload(item, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.prototype.hasOwnProperty.call(b, key) && sameFormulaPayload(a[key], b[key]));
}

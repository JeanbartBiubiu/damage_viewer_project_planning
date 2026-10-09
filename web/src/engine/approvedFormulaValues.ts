import type { NamedFormula } from '../types/genericEngine';
import { sameFormulaPayload } from '../services/skillFormulaContract';

/** 原生核定值按完整作者定义与私有参数目录记录；Web 不解释共同运算。 */
const approved = new Map<string, number>();
const declared = new Map<string, NamedFormula>();
const consumed = new Map<string, { formula: NamedFormula; value: number }>();
let scope = '';
let scopeRevision = 0;
export function selectFormulaProofScope(identity: string, restart = false) {
  if (identity === scope && !restart) return scopeRevision;
  scopeRevision++;
  scope = identity;
  approved.clear(); declared.clear(); consumed.clear();
  return scopeRevision;
}
export function matchesFormulaProofScope(identity: string, revision?: number) {
  return identity === scope && (revision === undefined || revision === scopeRevision);
}
export function clearFormulaProofScope(identity: string, revision?: number) {
  if (!matchesFormulaProofScope(identity, revision)) return;
  scopeRevision++;
  scope = ''; approved.clear(); declared.clear(); consumed.clear();
}
function fingerprint(formula: NamedFormula): string {
  return JSON.stringify([formula.skillKey, formula.expression, formula.parameters]);
}
export function rememberApprovedFormulaValues(formulas: readonly NamedFormula[], values: Readonly<Record<string, number>>) {
  for (const formula of formulas) {
    if (!Object.prototype.hasOwnProperty.call(values, formula.key)) continue;
    const value = values[formula.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('原生静态公式核定值不是有限数。');
    approved.set(fingerprint(formula), value);
  }
}
export function registerFormulaForApprovedReads(formula: NamedFormula) {
  declared.set(formula.key, structuredClone(formula));
}
export function approvedFormulaValue(key: string): number | null {
  const formula = declared.get(key);
  const value = formula ? approved.get(fingerprint(formula)) : undefined;
  if (formula && value !== undefined) consumed.set(key, { formula: structuredClone(formula), value });
  return value ?? null;
}
export function declaredFormulaForApprovedReads(key: string) { return declared.get(key); }
export function consumedApprovedFormulaValues() { return [...consumed.values()].map(row => structuredClone(row)); }
export function resetConsumedApprovedFormulaValues() { consumed.clear(); declared.clear(); }
export function collectedCommonFormulaDefinitions() { return [...declared.values()].map(row => structuredClone(row)); }
export function formulasUsedByInternalValue(value: unknown, formulas: readonly NamedFormula[]): NamedFormula[] {
  const output = new Map(formulas.map(formula => [formula.key, formula]));
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    const row = node as Record<string, unknown>;
    if (row.op === 'ref' && typeof row.ref === 'string') {
      const formula = declared.get(row.ref);
      if (formula) output.set(formula.key, formula);
    }
    Object.values(row).forEach(visit);
  };
  visit(value);
  return [...output.values()].map(formula => structuredClone(formula));
}
export function validateConsumedFormulaValues(rows: readonly { formula: NamedFormula; value: number }[],
  formulas: readonly NamedFormula[], values: Readonly<Record<string, number>>) {
  for (const row of rows) {
    const final = formulas.find(formula => formula.key === row.formula.key);
    if (!final || !sameFormulaPayload(final, row.formula) || !Object.prototype.hasOwnProperty.call(values, final.key)
      || !Object.is(values[final.key], row.value)) throw new Error('最终编译缺少本次准入已消费的同身份静态公式核定值：' + row.formula.key);
  }
}
export function validateApprovedFormulaValues(formulas: readonly NamedFormula[], values: Readonly<Record<string, number>>) {
  for (const formula of formulas) {
    const expected = approved.get(fingerprint(formula));
    if (expected === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(values, formula.key) || !Object.is(values[formula.key], expected)) {
      throw new Error('最终原生编译的静态核定值与本次准入预检不一致：' + formula.key);
    }
    const existing = declared.get(formula.key);
    if (existing && !sameFormulaPayload(existing, formula)) throw new Error('静态公式身份与完整程序不一致：' + formula.key);
  }
}

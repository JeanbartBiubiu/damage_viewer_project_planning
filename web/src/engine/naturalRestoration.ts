import type { GenericFormulaExpr, OperationDefinition } from '../types/genericEngine';
import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import { NumericAdaptationError, tryFoldConstant } from './numericAdapter';

function nonnegativeLowerBound(expression: GenericFormulaExpr): number {
  const folded = tryFoldConstant(expression);
  if (folded !== null) return Number.isFinite(folded) ? folded : -Infinity;
  const children = expression.args?.map(nonnegativeLowerBound) ?? [];
  if (children.length && expression.op === 'max') return Math.max(...children);
  if (children.length && expression.op === 'min') return Math.min(...children);
  if (children.length && expression.op === 'add' && children.every(value => Number.isFinite(value))) return children.reduce((sum, value) => sum + value, 0);
  if (children.length && expression.op === 'mul' && children.every(value => value >= 0)) return 0;
  return -Infinity;
}

/** 自然监听只补普通即时自身恢复；普通施法费用和失败退款仍属于原过程入口。 */
export function compileNaturalRestoration(effect: SkillEffect, result: SkillEffectResult, path: string,
  amount: () => GenericFormulaExpr): OperationDefinition | null {
  if (result.resultType !== 'DIRECT_HEAL' && result.resultType !== 'RESOURCE_CHANGE') return null;
  const fail = (message: string): never => { throw new NumericAdaptationError(path, message); };
  if (effect.lifecycle !== null || result.lifecycleBehavior !== null || result.target !== 'SOURCE'
    || result.spellShieldBlockScope !== null) fail('普通恢复仅接完整即时自身结果，不得丢弃持续、目标或阻挡资格');
  if (result.resultType === 'DIRECT_HEAL') {
    if (Object.keys(result.detail).length !== 0) fail('直接治疗明细不能夹带未知字段');
  } else if (Object.keys(result.detail).length !== 2
    || Object.keys(result.detail).some(key => !['attributeKey', 'operation'].includes(key))
    || result.detail.operation !== 'RESTORE' || !/^[a-z][a-z0-9_]{0,63}$/.test(result.detail.attributeKey)
    || result.detail.attributeKey === 'hp') fail('普通资源恢复只接明确非生命资源的RESTORE，生命恢复必须使用直接治疗');
  const value = amount();
  const lower = nonnegativeLowerBound(value);
  if (!Number.isFinite(lower) || lower < 0) fail('普通恢复最终金额必须可证明非负；请核对完整公式、倍率和最终上下界');
  return result.resultType === 'DIRECT_HEAL' ? { operation: 'heal', target: 'self', amount: value, ref: path }
    : { operation: 'resource_change', target: 'self', resourceKey: result.detail.attributeKey, amount: value, ref: path };
}

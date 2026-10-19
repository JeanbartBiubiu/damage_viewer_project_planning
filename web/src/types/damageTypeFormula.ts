import { FORMULA_SCHEMA } from './formulaContract.generated';
import type { Binding, Expression, FormulaDefinition } from './formulaContract.generated';

/** 伤害类型完整消费共同定义；技能公式的旧协议保持独立。 */
export type DamageTypeFormula = FormulaDefinition;
export type DamageTypeFormulaNode = Expression;
export type DamageTypeFormulaAttributeBinding = Extract<Binding, { kind: 'attribute' }> & {
  object: 'source' | 'target';
  view: 'current_frame';
  valueKind: 'BASE' | 'BONUS' | 'TOTAL';
};

export const DAMAGE_TYPE_FORMULA_MAX_DEPTH = FORMULA_SCHEMA['x-limits'].maxDepth;
export const DAMAGE_TYPE_FORMULA_MAX_NODES = FORMULA_SCHEMA['x-limits'].maxNodes;
export const DAMAGE_TYPE_FORMULA_NOT_FOUND = '404.DAMAGE_TYPE_FORMULA_NOT_FOUND';

export type DamageTypeFormulaDetail = {
  gameId: string;
  damageTypeKey: string;
  formula: DamageTypeFormula;
  updatedAt: string;
};
export type UpdateDamageTypeFormulaRequest = { formula: DamageTypeFormula };

export function isDamageTypeFormulaAttributeBinding(binding: Binding): binding is DamageTypeFormulaAttributeBinding {
  return binding.kind === 'attribute'
    && (binding.object === 'source' || binding.object === 'target')
    && binding.view === 'current_frame'
    && (binding.valueKind === 'BASE' || binding.valueKind === 'BONUS' || binding.valueKind === 'TOTAL');
}

/** 由当前使用点的独立属性目录产生辅助校验集合。真实保存权限由后端检查。 */
export function damageTypeFormulaAllowedBindings(attributes: readonly { attributeKey: string; status: string }[]): Binding[] {
  return attributes.filter(attribute => attribute.status === 'ENABLED').flatMap(attribute =>
    (['source', 'target'] as const).flatMap(object => (['BASE', 'BONUS', 'TOTAL'] as const).map(valueKind => ({
      kind: 'attribute' as const, object, attributeKey: attribute.attributeKey, view: 'current_frame' as const, valueKind
    }))));
}

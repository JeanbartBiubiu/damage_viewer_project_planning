import type { Attribute } from '../../../types/attribute';
import type { SkillCategory } from '../../../types/skillCategory';
import type { GameCalculationConfiguration } from '../../../types/gameCalculationRules';
import type { CommonFormulaDraft } from '../common-formula/commonFormulaForm';
import { parseGameCalculationConfiguration } from '../../../services/gameCalculationRulesClient';

export type GameCalculationDraft = Omit<GameCalculationConfiguration, 'attributeDerivations'> & {
  attributeDerivations: Array<Omit<GameCalculationConfiguration['attributeDerivations'][number], 'formula'> & { formula: CommonFormulaDraft }>;
};
export function emptyGameCalculationDraft(): GameCalculationDraft {
  return { criticalChanceAttributeKey: null, criticalMultiplierMin: null, attackSpeedAttributeKey: null,
    basicAttackCategoryKey: null, equipmentPassiveCategoryKey: null, ignorableCastCostAttributeKeys: [], attributeDerivations: [] };
}
export function validateGameCalculationDraft(draft: GameCalculationDraft, attributes: readonly Attribute[], skillCategories: readonly SkillCategory[]) {
  return parseGameCalculationConfiguration(draft, attributes, skillCategories);
}

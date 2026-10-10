import type { FormulaDefinition } from './formulaContract.generated';

export type GameAttributeDerivation = {
  ruleKey: string;
  attributeKey: string;
  valuePolicy: 'set' | 'multiply';
  activationAttributeKeys: string[];
  formula: FormulaDefinition;
};
export type GameCalculationConfiguration = {
  criticalChanceAttributeKey: string | null;
  criticalMultiplierMin: number | null;
  attackSpeedAttributeKey: string | null;
  attributeDerivations: GameAttributeDerivation[];
};
export type GameCalculationRulesResponse = {
  gameId: string;
  baseDigest: string;
  configuration: GameCalculationConfiguration | null;
};

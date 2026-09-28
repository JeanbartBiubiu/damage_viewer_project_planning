import type {
  FormulaAttributeOwner,
  FormulaAttributeValueKind,
  FormulaExpressionNode,
  FormulaOperation
} from './skillFormula';

export const DAMAGE_TYPE_FORMULA_STAGE_KEYS = [
  'resistanceBeforePenetration',
  'penetrationPercent',
  'penetrationFlat',
  'effectiveResistance',
  'resistanceFactor'
] as const;

export type DamageTypeFormulaStageKey = (typeof DAMAGE_TYPE_FORMULA_STAGE_KEYS)[number];

export const DAMAGE_TYPE_FORMULA_STAGE_RESULT_KEYS = [
  'RESISTANCE_BEFORE_PENETRATION',
  'PENETRATION_PERCENT',
  'PENETRATION_FLAT',
  'EFFECTIVE_RESISTANCE',
  'RESISTANCE_FACTOR'
] as const;

export type DamageTypeFormulaStageResultKey = (typeof DAMAGE_TYPE_FORMULA_STAGE_RESULT_KEYS)[number];

const STAGE_RESULT_KEY_BY_STAGE: Record<DamageTypeFormulaStageKey, DamageTypeFormulaStageResultKey> = {
  resistanceBeforePenetration: 'RESISTANCE_BEFORE_PENETRATION',
  penetrationPercent: 'PENETRATION_PERCENT',
  penetrationFlat: 'PENETRATION_FLAT',
  effectiveResistance: 'EFFECTIVE_RESISTANCE',
  resistanceFactor: 'RESISTANCE_FACTOR'
};

const STAGE_BY_RESULT_KEY: Record<DamageTypeFormulaStageResultKey, DamageTypeFormulaStageKey> = {
  RESISTANCE_BEFORE_PENETRATION: 'resistanceBeforePenetration',
  PENETRATION_PERCENT: 'penetrationPercent',
  PENETRATION_FLAT: 'penetrationFlat',
  EFFECTIVE_RESISTANCE: 'effectiveResistance',
  RESISTANCE_FACTOR: 'resistanceFactor'
};

export const DAMAGE_TYPE_FORMULA_MAX_DEPTH = 32;
export const DAMAGE_TYPE_FORMULA_MAX_NODES = 256;

export const DAMAGE_TYPE_FORMULA_NOT_FOUND = '404.DAMAGE_TYPE_FORMULA_NOT_FOUND';

export type DamageTypeFormulaOperationNode = {
  nodeType: 'OPERATION';
  operation: FormulaOperation;
  operands: [DamageTypeFormulaNode, DamageTypeFormulaNode];
};

export type DamageTypeFormulaFixedNode = {
  nodeType: 'FIXED';
  value: number;
};

export type DamageTypeFormulaAttributeNode = {
  nodeType: 'ATTRIBUTE';
  attributeOwner: FormulaAttributeOwner;
  attributeKey: string;
  attributeValueKind: FormulaAttributeValueKind;
};

export type DamageTypeFormulaStageResultNode = {
  nodeType: 'STAGE_RESULT';
  stageKey: DamageTypeFormulaStageResultKey;
};

export type DamageTypeFormulaNode =
  | DamageTypeFormulaOperationNode
  | DamageTypeFormulaFixedNode
  | DamageTypeFormulaAttributeNode
  | DamageTypeFormulaStageResultNode;

export type DamageTypeFormula = Record<DamageTypeFormulaStageKey, DamageTypeFormulaNode>;

export type DamageTypeFormulaDetail = {
  gameId: string;
  damageTypeKey: string;
  formula: DamageTypeFormula;
  updatedAt: string;
};

export type UpdateDamageTypeFormulaRequest = {
  formula: DamageTypeFormula;
};

export function isDamageTypeFormulaStageKey(value: unknown): value is DamageTypeFormulaStageKey {
  return DAMAGE_TYPE_FORMULA_STAGE_KEYS.some((stage) => stage === value);
}

export function isDamageTypeFormulaStageResultKey(value: unknown): value is DamageTypeFormulaStageResultKey {
  return DAMAGE_TYPE_FORMULA_STAGE_RESULT_KEYS.some((stage) => stage === value);
}

export function damageTypeFormulaStageResultKey(
  stage: DamageTypeFormulaStageKey
): DamageTypeFormulaStageResultKey {
  return STAGE_RESULT_KEY_BY_STAGE[stage];
}

export function damageTypeFormulaStageFromResultKey(
  stage: DamageTypeFormulaStageResultKey
): DamageTypeFormulaStageKey {
  return STAGE_BY_RESULT_KEY[stage];
}

export function priorDamageTypeFormulaStages(
  stage: DamageTypeFormulaStageKey
): DamageTypeFormulaStageKey[] {
  const index = DAMAGE_TYPE_FORMULA_STAGE_KEYS.indexOf(stage);
  return DAMAGE_TYPE_FORMULA_STAGE_KEYS.slice(0, index);
}

export function priorDamageTypeFormulaStageResults(
  stage: DamageTypeFormulaStageKey
): DamageTypeFormulaStageResultKey[] {
  return priorDamageTypeFormulaStages(stage).map(damageTypeFormulaStageResultKey);
}

type SkillFormulaNodeType = FormulaExpressionNode['nodeType'];
type DamageTypeFormulaNodeType = DamageTypeFormulaNode['nodeType'];

type _SkillFormulaExcludesDamageTypeNodes = Extract<SkillFormulaNodeType, 'FIXED' | 'STAGE_RESULT'> extends never
  ? true
  : never;
type _DamageTypeFormulaExcludesParameter = Extract<DamageTypeFormulaNodeType, 'PARAMETER'> extends never
  ? true
  : never;

export const skillFormulaExcludesDamageTypeNodes: _SkillFormulaExcludesDamageTypeNodes = true;
export const damageTypeFormulaExcludesParameter: _DamageTypeFormulaExcludesParameter = true;

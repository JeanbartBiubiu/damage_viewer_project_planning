import type { Binding, FormulaDefinition } from './formulaContract.generated';
export type FormulaAttributeOwner = 'SOURCE' | 'TARGET';
export type FormulaAttributeValueKind = Extract<Binding, { kind: 'attribute' }>['valueKind'];
/** 技能作者表达式只有完整共同定义。 */
export type FormulaExpressionNode = FormulaDefinition;

export type SkillFormulaSummary = {
  gameId: string;
  skillKey: string;
  formulaKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type SkillFormula = SkillFormulaSummary & {
  expression: FormulaExpressionNode;
};

export type CreateSkillFormulaRequest = {
  formulaKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  expression: FormulaExpressionNode;
};

export type UpdateSkillFormulaRequest = Omit<CreateSkillFormulaRequest, 'formulaKey'>;

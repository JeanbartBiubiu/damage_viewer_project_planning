export type FormulaAttributeOwner = 'SOURCE' | 'TARGET';

export type FormulaAttributeValueKind =
  | 'BASE'
  | 'BONUS'
  | 'TOTAL'
  | 'CURRENT'
  | 'MISSING'
  | 'CURRENT_RATIO'
  | 'MISSING_RATIO';

export type FormulaOperation =
  | 'ADD'
  | 'SUBTRACT'
  | 'MULTIPLY'
  | 'DIVIDE'
  | 'MIN'
  | 'MAX';

export type FormulaOperationNode = {
  nodeType: 'OPERATION';
  operation: FormulaOperation;
  operands: [FormulaExpressionNode, FormulaExpressionNode];
};

export type FormulaParameterNode = {
  nodeType: 'PARAMETER';
  parameterKey: string;
};

export type FormulaAttributeNode = {
  nodeType: 'ATTRIBUTE';
  attributeOwner: FormulaAttributeOwner;
  attributeKey: string;
  attributeValueKind: FormulaAttributeValueKind;
};

export type FormulaExpressionNode =
  | FormulaOperationNode
  | FormulaParameterNode
  | FormulaAttributeNode;

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

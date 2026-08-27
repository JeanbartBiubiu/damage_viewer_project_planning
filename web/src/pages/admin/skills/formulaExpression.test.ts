import { describe, expect, it } from 'vitest';
import type { FormulaExpressionNode } from '../../../types/skillFormula';
import {
  MAX_FORMULA_DEPTH,
  MAX_FORMULA_NODES,
  canExpandOperationChild,
  countFormulaNodes,
  createEmptyNodeDraft,
  expressionToDraft,
  mapFormulaFieldIssues,
  measureFormulaDepth,
  normalizeFormulaNodePath,
  previewFormulaExpression,
  switchNodeType,
  validateFormulaDraft
} from './formulaExpression';

const catalog = {
  parameters: [
    { parameterKey: 'missing_health_ratio', name: '已损失生命值系数', valueMode: 'FIXED' as const },
    { parameterKey: 'current_stacks', name: '当前层数', valueMode: 'RUNTIME_INPUT' as const }
  ],
  attributes: [
    { attributeKey: 'hp', name: '生命值' },
    { attributeKey: 'attack_damage', name: '攻击力' }
  ]
};

function deepOperationTree(depth: number): ReturnType<typeof createEmptyNodeDraft> {
  let node = switchNodeType(createEmptyNodeDraft(), 'PARAMETER');
  if (node.nodeType === 'PARAMETER') {
    node = { ...node, parameterKey: 'current_stacks' };
  }
  for (let current = 2; current <= depth; current += 1) {
    node = {
      nodeType: 'OPERATION',
      operation: 'ADD',
      left: node,
      right: {
        nodeType: 'PARAMETER',
        parameterKey: 'current_stacks'
      }
    };
  }
  return node;
}

describe('formulaExpression structure', () => {
  it('supports three node kinds, six operations and seven attribute kinds in conversion', () => {
    const expression: FormulaExpressionNode = {
      nodeType: 'OPERATION',
      operation: 'MIN',
      operands: [
        {
          nodeType: 'OPERATION',
          operation: 'MAX',
          operands: [
            {
              nodeType: 'ATTRIBUTE',
              attributeOwner: 'SOURCE',
              attributeKey: 'attack_damage',
              attributeValueKind: 'TOTAL'
            },
            {
              nodeType: 'ATTRIBUTE',
              attributeOwner: 'TARGET',
              attributeKey: 'hp',
              attributeValueKind: 'MISSING'
            }
          ]
        },
        {
          nodeType: 'PARAMETER',
          parameterKey: 'missing_health_ratio'
        }
      ]
    };
    const draft = expressionToDraft(expression);
    const validated = validateFormulaDraft(
      {
        formulaKey: 'cap',
        name: '上限',
        description: '',
        sortOrder: '1',
        expression: draft
      },
      true,
      catalog
    );
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.normalized.expression).toEqual(expression);
    }
  });

  it('clears old fields when switching node types', () => {
    const parameter = switchNodeType(createEmptyNodeDraft(), 'PARAMETER');
    expect(parameter).toEqual({ nodeType: 'PARAMETER', parameterKey: '' });
    const operation = switchNodeType(parameter, 'OPERATION');
    expect(operation).toEqual({
      nodeType: 'OPERATION',
      operation: '',
      left: { nodeType: 'empty' },
      right: { nodeType: 'empty' }
    });
    const attribute = switchNodeType(operation, 'ATTRIBUTE');
    expect(attribute).toEqual({
      nodeType: 'ATTRIBUTE',
      attributeOwner: '',
      attributeKey: '',
      attributeValueKind: ''
    });
  });

  it('enforces depth 32 and node count 256 including root', () => {
    const depth32 = deepOperationTree(MAX_FORMULA_DEPTH);
    expect(measureFormulaDepth(depth32)).toBe(MAX_FORMULA_DEPTH);
    let deepestPath = 'expression';
    let cursor = depth32;
    while (cursor.nodeType === 'OPERATION') {
      deepestPath = `${deepestPath}.operands[0]`;
      cursor = cursor.left;
    }
    expect(canExpandOperationChild(depth32, deepestPath).ok).toBe(false);

    let wide = switchNodeType(createEmptyNodeDraft(), 'PARAMETER');
    if (wide.nodeType === 'PARAMETER') {
      wide = { ...wide, parameterKey: 'current_stacks' };
    }
    while (countFormulaNodes(wide) + 2 <= MAX_FORMULA_NODES) {
      wide = {
        nodeType: 'OPERATION',
        operation: 'ADD',
        left: wide,
        right: { nodeType: 'PARAMETER', parameterKey: 'current_stacks' }
      };
    }
    expect(countFormulaNodes(wide)).toBeLessThanOrEqual(MAX_FORMULA_NODES);
    expect(countFormulaNodes(wide) + 2).toBeGreaterThan(MAX_FORMULA_NODES);
    expect(canExpandOperationChild(wide, 'expression').ok).toBe(false);
  });

  it('maps nested field paths and validates incomplete nodes', () => {
    const draft = {
      formulaKey: 'damage',
      name: '伤害',
      description: '',
      sortOrder: '0',
      expression: {
        nodeType: 'OPERATION' as const,
        operation: 'MULTIPLY' as const,
        left: {
          nodeType: 'ATTRIBUTE' as const,
          attributeOwner: 'TARGET' as const,
          attributeKey: 'hp',
          attributeValueKind: '' as const
        },
        right: { nodeType: 'empty' as const }
      }
    };
    const result = validateFormulaDraft(draft, true, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.nodeIssues.some((item) => item.path === 'expression.operands[0]')).toBe(true);
      expect(result.nodeIssues.some((item) => item.path === 'expression.operands[1]')).toBe(true);
    }
  });
});

describe('formulaExpression preview', () => {
  it('renders owner.attribute.kind, preserves left/right order and marks missing refs', () => {
    const draft = expressionToDraft({
      nodeType: 'OPERATION',
      operation: 'MULTIPLY',
      operands: [
        {
          nodeType: 'ATTRIBUTE',
          attributeOwner: 'TARGET',
          attributeKey: 'hp',
          attributeValueKind: 'MISSING'
        },
        {
          nodeType: 'PARAMETER',
          parameterKey: 'missing_health_ratio'
        }
      ]
    });
    const text = previewFormulaExpression(draft, catalog).map((item) => item.text).join('');
    expect(text).toBe('目标.生命值.已损失值 × 已损失生命值系数');

    const nested = expressionToDraft({
      nodeType: 'OPERATION',
      operation: 'DIVIDE',
      operands: [
        {
          nodeType: 'OPERATION',
          operation: 'SUBTRACT',
          operands: [
            {
              nodeType: 'ATTRIBUTE',
              attributeOwner: 'SOURCE',
              attributeKey: 'attack_damage',
              attributeValueKind: 'TOTAL'
            },
            {
              nodeType: 'PARAMETER',
              parameterKey: 'current_stacks'
            }
          ]
        },
        {
          nodeType: 'PARAMETER',
          parameterKey: 'missing_health_ratio'
        }
      ]
    });
    const nestedText = previewFormulaExpression(nested, catalog).map((item) => item.text).join('');
    expect(nestedText).toBe('(施法者.攻击力.最终值 − 当前层数) ÷ 已损失生命值系数');

    const minMax = expressionToDraft({
      nodeType: 'OPERATION',
      operation: 'MIN',
      operands: [
        { nodeType: 'PARAMETER', parameterKey: 'current_stacks' },
        { nodeType: 'PARAMETER', parameterKey: 'missing_health_ratio' }
      ]
    });
    expect(previewFormulaExpression(minMax, catalog).map((item) => item.text).join('')).toBe(
      '取较小值(当前层数, 已损失生命值系数)'
    );

    const missing = expressionToDraft({
      nodeType: 'PARAMETER',
      parameterKey: 'gone'
    });
    const missingPreview = previewFormulaExpression(missing, catalog);
    expect(missingPreview).toEqual([{ text: 'gone', error: true }]);
  });
});

describe('mapFormulaFieldIssues path normalization', () => {
  it('normalizes node field paths to owning node paths', () => {
    expect(normalizeFormulaNodePath('expression.operands')).toBe('expression');
    expect(normalizeFormulaNodePath('expression.operands[0].parameterKey')).toBe(
      'expression.operands[0]'
    );
    expect(normalizeFormulaNodePath('expression.operands[1].attributeKey')).toBe(
      'expression.operands[1]'
    );
    expect(normalizeFormulaNodePath('expression.operands[0].attributeOwner')).toBe(
      'expression.operands[0]'
    );
    expect(normalizeFormulaNodePath('expression.operands[0].attributeValueKind')).toBe(
      'expression.operands[0]'
    );
    expect(normalizeFormulaNodePath('expression.operation')).toBe('expression');
    expect(normalizeFormulaNodePath('expression.operands[0].operands')).toBe(
      'expression.operands[0]'
    );
    expect(normalizeFormulaNodePath('expression.operands[0]')).toBe('expression.operands[0]');
    expect(normalizeFormulaNodePath('expression.operands[0].operands[1]')).toBe(
      'expression.operands[0].operands[1]'
    );
  });

  it('maps nested field issues to node paths and keeps unmapped messages', () => {
    const mapped = mapFormulaFieldIssues({
      details: {
        fieldIssues: [
          { field: 'expression.operands[0].parameterKey', message: '参数无效' },
          { field: 'expression.operands[1].attributeKey', message: '属性无效' },
          { field: 'expression.operands', message: '运算数不合法' },
          { field: 'name', message: '名称过长' },
          { field: 'unknownField', message: '未知字段' }
        ]
      }
    });
    expect(mapped.fieldErrors.name).toBe('名称过长');
    expect(mapped.nodeIssues).toEqual([
      { path: 'expression.operands[0]', message: '参数无效' },
      { path: 'expression.operands[1]', message: '属性无效' },
      { path: 'expression', message: '运算数不合法' }
    ]);
    expect(mapped.unmappedMessages).toEqual(['未知字段']);
  });
});

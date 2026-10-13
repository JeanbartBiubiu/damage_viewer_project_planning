import type { FormulaDefinition } from '../../src/types/formulaContract.generated';

/** 用例作者明确提供完整定义；此处不识别或补全伤害类型目录。 */
export function authoredConstantDefense(multiplier: string): FormulaDefinition {
  return { inputs: [], stages: [{ key: 'factor', name: '作者防御倍率',
    expression: { op: 'const', value: multiplier } }], outputStageKey: 'factor' };
}

/** 用例作者明确指定抗性属性；原键和目录须由调用处声明。 */
export function authoredResistanceDefense(attributeKey: string): FormulaDefinition {
  return {
    inputs: [{ key: 'resistance', binding: { kind: 'attribute', object: 'target', attributeKey,
      valueKind: 'TOTAL', view: 'current_frame' } }],
    stages: [{ key: 'resistance', name: '作者抗性', expression: { op: 'read', inputKey: 'resistance' } },
      { key: 'factor', name: '作者防御倍率', expression: { op: 'if', args: [
        { op: 'gte', args: [{ op: 'ref', stageKey: 'resistance' }, { op: 'const', value: '0' }] },
        { op: 'div', args: [{ op: 'const', value: '100' },
          { op: 'add', args: [{ op: 'const', value: '100' }, { op: 'ref', stageKey: 'resistance' }] }] },
        { op: 'sub', args: [{ op: 'const', value: '2' },
          { op: 'div', args: [{ op: 'const', value: '100' },
            { op: 'sub', args: [{ op: 'const', value: '100' }, { op: 'ref', stageKey: 'resistance' }] }] }] }
      ] } }], outputStageKey: 'factor'
  };
}

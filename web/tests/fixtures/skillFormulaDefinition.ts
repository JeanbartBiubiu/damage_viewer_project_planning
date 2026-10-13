import type { Expression, FormulaDefinition, Binding } from '../../src/types/formulaContract.generated';
/** 历史用例的一次性显式构造工具；产品接口和运行适配只接受共同定义。 */
export type HistoricalSkillExpression =
  | { nodeType: 'PARAMETER'; parameterKey: string }
  | { nodeType: 'ATTRIBUTE'; attributeOwner: 'SOURCE' | 'TARGET'; attributeKey: string; attributeValueKind: Extract<Binding, { kind: 'attribute' }>['valueKind'] }
  | { nodeType: 'OPERATION'; operation: 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE' | 'MIN' | 'MAX'; operands: HistoricalSkillExpression[] };
export function skillFormulaDefinition(skillKey: string, node: HistoricalSkillExpression | FormulaDefinition): FormulaDefinition {
  const inputs: FormulaDefinition['inputs'] = [];
  const read = (binding: Binding): Expression => {
    let input = inputs.find(input => JSON.stringify(input.binding) === JSON.stringify(binding));
    if (!input) { input = { key: 'input_' + inputs.length, binding }; inputs.push(input); }
    return { op: 'read', inputKey: input.key };
  };
  const build = (value: HistoricalSkillExpression | FormulaDefinition): Expression => {
    if ('stages' in value) {
      const expand = (expr: Expression): Expression => {
        if (expr.op === 'read') return read(value.inputs.find(input => input.key === expr.inputKey)!.binding);
        if (expr.op === 'ref') return expand(value.stages.find(stage => stage.key === expr.stageKey)!.expression);
        return 'args' in expr ? { ...expr, args: expr.args.map(expand) } as Expression : structuredClone(expr);
      };
      return expand(value.stages.find(stage => stage.key === value.outputStageKey)!.expression);
    }
    if (value.nodeType === 'PARAMETER') return read({ kind: 'parameter', skillKey, parameterKey: value.parameterKey });
    if (value.nodeType === 'ATTRIBUTE') return read({ kind: 'attribute', object: value.attributeOwner === 'SOURCE' ? 'source' : 'target', attributeKey: value.attributeKey, valueKind: value.attributeValueKind, view: 'current_frame' });
    const op = ({ ADD: 'add', SUBTRACT: 'sub', MULTIPLY: 'mul', DIVIDE: 'div', MIN: 'min', MAX: 'max' } as const)[value.operation];
    return { op, args: value.operands.map(build) } as Expression;
  };
  const expression = build(node);
  return { inputs, stages: [{ key: 'output', name: '用例输出', expression }], outputStageKey: 'output' };
}

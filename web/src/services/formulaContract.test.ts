import { describe, expect, it } from 'vitest';
import generatedCases from './__fixtures__/formulaContractCases.generated.json';
import {
  FORMULA_SCHEMA_SHA256,
  type Binding,
  type Expression,
  type FormulaDefinition
} from '../types/formulaContract.generated';
import { validateFormulaDefinition, type FormulaContractIssue } from './formulaContract';

type Fixture = {
  name: string;
  definition: unknown;
  allowedBindings: Binding[];
  expected: FormulaContractIssue | null;
};

const fixtures = generatedCases as unknown as { schemaSha256: string; cases: Fixture[] };

function freezeJson(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  Object.values(value).forEach(freezeJson);
  Object.freeze(value);
}

function formulaWithExpression(expression: unknown): unknown {
  return { inputs: [], stages: [{ key: 'result', name: '结果', expression }], outputStageKey: 'result' };
}

function unaryChain(length: number, leaf: unknown = { op: 'const', value: '1' }): unknown {
  let expression = leaf;
  for (let index = 1; index < length; index += 1) expression = { op: 'floor', args: [expression] };
  return expression;
}

describe('共同公式定义校验', () => {
  it('结构和共同样例引用相同的结构摘要', () => {
    expect(fixtures.schemaSha256).toBe(FORMULA_SCHEMA_SHA256);
    expect(fixtures.cases.length).toBeGreaterThan(0);
  });

  it.each(fixtures.cases)('$name', ({ definition, allowedBindings, expected }) => {
    const before = JSON.stringify({ definition, allowedBindings });
    freezeJson(definition);
    freezeJson(allowedBindings);
    expect(validateFormulaDefinition(definition, allowedBindings)).toEqual(expected);
    expect(JSON.stringify({ definition, allowedBindings })).toBe(before);
  });

  it('保留完整十进制原文并能原样往返', () => {
    const value = '-1.000000000000000000000000000000000000001';
    const definition = formulaWithExpression({ op: 'const', value }) as FormulaDefinition;
    freezeJson(definition);
    expect(validateFormulaDefinition(definition, [])).toBeNull();
    const restored = JSON.parse(JSON.stringify(definition)) as FormulaDefinition;
    expect(restored.stages[0].expression).toEqual({ op: 'const', value });
    expect(validateFormulaDefinition(restored, [])).toBeNull();
  });

  it('进入第33层前停止，不读取超限节点', () => {
    const unreadable = new Proxy({}, { get: () => { throw new Error('不应读取第33层'); } });
    expect(validateFormulaDefinition(formulaWithExpression(unaryChain(33, unreadable)), [])).toEqual({
      code: 'FORMULA_LIMIT',
      path: `/stages/0/expression${'/args/0'.repeat(32)}`
    });
  });

  it('进入第257个节点前停止，不读取超限节点', () => {
    const unreadable = new Proxy({}, { get: () => { throw new Error('不应读取第257个节点'); } });
    const stages = Array.from({ length: 64 }, (_, index) => ({
      key: `s${index}`,
      name: '结果',
      expression: unaryChain(index === 63 ? 5 : 4, index === 63 ? unreadable : { op: 'const', value: '1' })
    }));
    expect(validateFormulaDefinition({ inputs: [], stages, outputStageKey: 's0' }, [])).toEqual({
      code: 'FORMULA_LIMIT',
      path: `/stages/63/expression${'/args/0'.repeat(4)}`
    });
  });

  it('按树和结果引用的联合深度检查，引用共享结果不会复制计算', () => {
    const leaf: Expression = { op: 'const', value: '1' };
    const first = unaryChain(31, { op: 'ref', stageKey: 'shared' });
    const definition = {
      inputs: [],
      stages: [
        { key: 'result', name: '结果', expression: first },
        { key: 'shared', name: '共享结果', expression: leaf },
        { key: 'unused', name: '未用结果', expression: { op: 'ref', stageKey: 'shared' } }
      ],
      outputStageKey: 'result'
    };
    expect(validateFormulaDefinition(definition, [])).toBeNull();
    definition.stages[1].expression = { op: 'floor', args: [leaf] };
    expect(validateFormulaDefinition(definition, [])).toEqual({ code: 'FORMULA_LIMIT', path: '/stages/0/expression' });
  });
});

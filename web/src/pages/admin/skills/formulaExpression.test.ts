import { describe, expect, it } from 'vitest';
import { skillFormulaDefinition } from '../../../../tests/fixtures/skillFormulaDefinition';
import { createEmptyFormulaDraft, expressionToDraft, formulaToDraft, mapFormulaFieldIssues, normalizeFormulaNodePath, previewFormulaExpression, validateFormulaDraft, updateNodeAtPath } from './formulaExpression';
import { COMMON_FORMULA_OPERATIONS, commonFormulaNode } from '../common-formula/commonFormulaForm';
const catalog = { skillKey: 'q', parameters: [{ skillKey: 'q', parameterKey: 'ratio', name: '系数', valueMode: 'FIXED' as const }],
  attributes: [{ attributeKey: 'hp', name: '生命值', status: 'ENABLED' }] };
const expression = skillFormulaDefinition('q', { nodeType: 'PARAMETER', parameterKey: 'ratio' });
const draft = () => ({ ...createEmptyFormulaDraft(), formulaKey: 'amount', name: '伤害', expression: expressionToDraft(expression) });
describe('技能共同公式编辑', () => {
  it('完整深复制并保留顺序、任意结果名、十进制原文与所有共同运算', () => {
    const value = { inputs: expression.inputs, stages: [{ key: 'final', name: '最终', expression: { op: 'const' as const, value: '0.3000' } },
      { key: 'unused', name: '未使用', expression: { op: 'read' as const, inputKey: 'input_0' } }], outputStageKey: 'final' };
    const form = formulaToDraft({ formulaKey: 'a', name: '公式', description: null, sortOrder: 0, expression: value });
    expect(form.expression).toEqual(value); expect(form.expression).not.toBe(value);
    expect(COMMON_FORMULA_OPERATIONS).toHaveLength(18);
    expect(commonFormulaNode('if')).toEqual({ op: 'if', args: [{ op: 'empty' }, { op: 'empty' }, { op: 'empty' }] });
    const validated = validateFormulaDraft(form, true, catalog);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.normalized.expression.stages[0]!.expression).toEqual({ op: 'const', value: '0.3000' });
  });
  it('参数授权取最终候选且不接受外国同名技能，停用属性不能保存', () => {
    expect(validateFormulaDraft(draft(), true, catalog).ok).toBe(true);
    expect(validateFormulaDraft(draft(), true, { ...catalog, parameters: [] }).ok).toBe(false);
    const foreign = draft(); foreign.expression.inputs[0]!.binding = { kind: 'parameter', skillKey: 'w', parameterKey: 'ratio' };
    expect(validateFormulaDraft(foreign, true, catalog).ok).toBe(false);
    const attribute = draft(); attribute.expression = expressionToDraft(skillFormulaDefinition('q', { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'MAX' }));
    expect(validateFormulaDraft(attribute, true, catalog).ok).toBe(true);
    expect(validateFormulaDraft(attribute, true, { ...catalog, attributes: [{ ...catalog.attributes[0]!, status: 'DISABLED' }] }).ok).toBe(false);
  });
  it('全定义包含未使用输入的授权；未知引用和循环按共同校验拒绝', () => {
    const value = draft(); value.expression.inputs.push({ key: 'unread', binding: { kind: 'parameter', skillKey: 'q', parameterKey: 'removed' } });
    expect(validateFormulaDraft(value, true, catalog).ok).toBe(false);
    const cycle = draft(); cycle.expression.stages[0]!.expression = { op: 'ref', stageKey: 'output' };
    expect(validateFormulaDraft(cycle, true, catalog).ok).toBe(false);
  });
  it('编辑第三条分支，位置由共同路径决定，预览不求值', () => {
    const value = draft(); value.expression.stages[0]!.expression = commonFormulaNode('if');
    const updated = updateNodeAtPath(value.expression, '/expression/stages/0/expression/args/2', { op: 'const', value: '0.0007' });
    expect(updated.stages[0]!.expression).toMatchObject({ args: [{ op: 'empty' }, { op: 'empty' }, { op: 'const', value: '0.0007' }] });
    expect(previewFormulaExpression(updated, catalog).map(row => row.text).join('')).toContain('0.0007');
    expect(normalizeFormulaNodePath('expression.stages[0].expression.args[2].value')).toBe('/expression/stages/0/expression/args/2');
    expect(mapFormulaFieldIssues({ fieldIssues: [{ field: '/expression/inputs/0/binding/parameterKey', message: '参数删除保护' }] }).nodeIssues)
      .toEqual([{ path: '/expression/inputs/0/binding/parameterKey', message: '参数删除保护' }]);
  });
});

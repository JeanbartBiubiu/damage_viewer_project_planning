import { describe, expect, it, vi } from 'vitest';
import { fixedValue, formulaValue } from '../../../../types/numericValue';
import type { FormulaExpressionNode } from '../../../../types/skillFormula';
import type { SkillParameter } from '../../../../types/skillParameter';
import { createEmptyResultDraft } from './effectForm';
import {
  preflightDamageModifierConditionFormulas,
  staticDamageModifierConditionFormulaIssue
} from './damageModifierConditionFormula';

function parameter(key: string, mode: SkillParameter['valueMode'], fixed: number | null,
  levels: Record<string, number> | null = null): SkillParameter {
  return {
    gameId: 'lol', skillKey: 'rune_8014_passive', parameterKey: key, name: key,
    valueType: 'DECIMAL', valueMode: mode, fixedValue: fixed, levelValues: levels,
    description: null, sortOrder: 0, createdAt: '', updatedAt: ''
  };
}

const ref = (parameterKey: string): FormulaExpressionNode => ({ nodeType: 'PARAMETER', parameterKey });
const operation = (name: 'ADD' | 'MULTIPLY' | 'DIVIDE', left: FormulaExpressionNode,
  right: FormulaExpressionNode): FormulaExpressionNode => ({
  nodeType: 'OPERATION', operation: name, operands: [left, right]
});

describe('逐笔生命门槛公式保存前核对', () => {
  it('evaluates static parameter formula for matching skill and character levels', () => {
    const expression = operation('MULTIPLY', ref('skill_ratio'), ref('character_ratio'));
    const params = [
      parameter('skill_ratio', 'SKILL_LEVEL', null, { '1': 0.4, '2': 0.5 }),
      parameter('character_ratio', 'CHARACTER_LEVEL', null, { '1': 1, '2': 2 })
    ];
    expect(staticDamageModifierConditionFormulaIssue(expression, params)).toBeNull();
    const over = [...params.slice(0, 1), parameter('character_ratio', 'CHARACTER_LEVEL', null, { '1': 1, '2': 2.1 })];
    expect(staticDamageModifierConditionFormulaIssue(expression, over)).toContain('全部等级');
  });

  it('rejects attribute, runtime input, missing values and division by zero', () => {
    const attribute: FormulaExpressionNode = {
      nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO'
    };
    expect(staticDamageModifierConditionFormulaIssue(attribute, [])).toContain('不能读取属性');
    expect(staticDamageModifierConditionFormulaIssue(ref('runtime'), [
      parameter('runtime', 'RUNTIME_INPUT', null)
    ])).toContain('计算时传入');
    expect(staticDamageModifierConditionFormulaIssue(ref('missing'), [])).toContain('不存在');
    expect(staticDamageModifierConditionFormulaIssue(operation('DIVIDE', ref('threshold'), ref('zero')), [
      parameter('threshold', 'FIXED', 0.4), parameter('zero', 'FIXED', 0)
    ])).toContain('除零');
  });

  it('uses decimal rational arithmetic for the exact zero-to-one boundary', () => {
    const expression = operation('ADD', ref('a'), ref('b'));
    expect(staticDamageModifierConditionFormulaIssue(expression, [
      parameter('a', 'FIXED', 0.7), parameter('b', 'FIXED', 0.3)
    ])).toBeNull();
    expect(staticDamageModifierConditionFormulaIssue(expression, [
      parameter('a', 'FIXED', 0.7), parameter('b', 'FIXED', 0.3000001)
    ])).toContain('全部等级');
  });

  it('fetches only selected formula details and returns a field error before POST', async () => {
    const result = createEmptyResultDraft('DAMAGE_MODIFIER');
    result.damageModifierCondition = {
      attributeKey: 'hp', comparator: 'LT', comparisonValue: formulaValue('threshold_formula'),
      originalAttributeKey: null
    };
    const fetchFormula = vi.fn(async () => ({ expression: ref('threshold') }));
    const params = [parameter('threshold', 'FIXED', 0.4)];
    expect(await preflightDamageModifierConditionFormulas([result, result], params, 'ready', fetchFormula))
      .toEqual([]);
    expect(fetchFormula).toHaveBeenCalledTimes(1);
    const invalid = await preflightDamageModifierConditionFormulas([result], [
      parameter('threshold', 'RUNTIME_INPUT', null)
    ], 'ready', fetchFormula);
    expect(invalid).toMatchObject([{ index: 0, fieldErrors: {
      conditionComparisonValue: expect.stringContaining('计算时传入')
    } }]);
    result.damageModifierCondition.comparisonValue = fixedValue(0.4);
    fetchFormula.mockClear();
    expect(await preflightDamageModifierConditionFormulas([result], params, 'ready', fetchFormula))
      .toEqual([]);
    expect(fetchFormula).not.toHaveBeenCalled();
  });

  it('keeps a formula draft and identifies unavailable catalogs or detail reads', async () => {
    const result = createEmptyResultDraft('DAMAGE_MODIFIER');
    result.damageModifierCondition = {
      attributeKey: 'hp', comparator: 'LT', comparisonValue: formulaValue('threshold_formula'),
      originalAttributeKey: null
    };
    const fetchFormula = vi.fn(async () => { throw new Error('unavailable'); });
    const noParams = await preflightDamageModifierConditionFormulas([result], [], 'failed', fetchFormula);
    expect(noParams[0]?.fieldErrors.conditionComparisonValue).toContain('参数目录不完整');
    expect(fetchFormula).not.toHaveBeenCalled();
    const failedGet = await preflightDamageModifierConditionFormulas([result], [], 'ready', fetchFormula);
    expect(failedGet[0]?.fieldErrors.conditionComparisonValue).toContain('无法读取门槛公式详情');
  });
});

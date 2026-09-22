import { describe, expect, it } from 'vitest';
import { parseSkillEffect } from '../../../../services/skillEffectClient';
import { fixedValue, formulaValue } from '../../../../types/numericValue';
import { cooldownOperationOf, listAvailablePriorResultOutputs, validateResultModifier } from '../triggers/triggerRuleForm';
import {
  applyCooldownOperationChange,
  cooldownChangeAmountHint,
  createEmptyEffectDraft,
  createEmptyResultDraft,
  validateSkillEffectDraft,
  type EffectFormCatalog,
  type SkillEffectResultDraft
} from './effectForm';

const catalog: EffectFormCatalog = {
  parentSkillKey: 'masteryi_r',
  formulas: [],
  effects: [],
  damageTypes: [],
  attributes: [],
  skills: ['masteryi_q'].map((skillKey) => ({ skillKey, status: 'ENABLED' })),
  skillCategories: [],
  statuses: []
};
const scope = { mode: 'SKILLS' as const, skillKeys: ['masteryi_q'], skillCategoryKeys: [] };

function remainingDraft(value: number | null = 1500): SkillEffectResultDraft {
  return {
    ...createEmptyResultDraft('COOLDOWN_CHANGE'),
    resultKey: 'set_cd',
    name: '设置剩余冷却',
    target: 'SOURCE',
    cooldownOperation: 'SET_REMAINING',
    value: value === null ? null : fixedValue(value),
    affectedSkillScope: scope
  };
}

function validate(result: SkillEffectResultDraft) {
  return validateSkillEffectDraft(
    { ...createEmptyEffectDraft(), effectKey: 'set_remaining', name: '设置剩余冷却', results: [result] },
    { includeEffectKey: true, catalog }
  );
}

describe('设置剩余冷却', () => {
  it('接受含 0 的非负毫秒，空白不能当作 0，结果输出与减少相同', () => {
    expect(validate(remainingDraft(0)).ok).toBe(true);
    expect(validate(remainingDraft(1500)).ok).toBe(true);
    expect(validate(remainingDraft(null)).ok).toBe(false);
    expect(validate(remainingDraft(-1)).ok).toBe(false);
    expect(validate(remainingDraft(0.5)).ok).toBe(true);
    expect(validate(remainingDraft(1000.25)).ok).toBe(true);
    const valid = validate(remainingDraft(0));
    if (!valid.ok) throw new Error(JSON.stringify(valid));
    expect(valid.normalized.results[0]).toMatchObject({
      resultType: 'COOLDOWN_CHANGE',
      detail: { operation: 'SET_REMAINING', affectedSkillScope: scope }
    });
    expect(valid.normalized.results[0].valueRule).not.toBeNull();
    const response = {
      ...valid.normalized,
      gameId: 'lol',
      skillKey: 'masteryi_r',
      createdAt: '2026-09-22T00:00:00Z',
      updatedAt: '2026-09-22T00:00:00Z'
    };
    expect(parseSkillEffect(response)).toEqual(response);
    expect(cooldownOperationOf(response.results[0])).toBe('SET_REMAINING');
    expect(listAvailablePriorResultOutputs(response.results[0])).toEqual(['CONFIGURED_VALUE']);
    expect(cooldownChangeAmountHint(remainingDraft(0))).toContain('0 表示立即可用');
  });

  it('表单与响应解析一致拒绝非法有效数值，不能用下界掩盖负的原始值', () => {
    for (const [value, multiplier, minimum, maximum] of [
      [-1, '1', '0', ''],
      [1, '1', '', '-1'],
      [1e308, '1e308', '', '']
    ] as const) {
      const draft = remainingDraft(value);
      Object.assign(draft, { fixedMultiplier: multiplier, fixedMinValue: minimum, fixedMaxValue: maximum });
      expect(validate(draft).ok).toBe(false);
      const base = validate(remainingDraft(0.5));
      if (!base.ok) throw new Error(JSON.stringify(base));
      const response = { ...base.normalized, results: base.normalized.results.map((result) => ({
        ...result,
        valueRule: { ...result.valueRule, value: fixedValue(value), fixedMultiplier: Number(multiplier),
          fixedMinValue: minimum === '' ? null : Number(minimum), fixedMaxValue: maximum === '' ? null : Number(maximum) }
      })) };
      expect(() => parseSkillEffect(response)).toThrow();
    }
  });

  it('毫秒操作之间切换保留合法值，切到比例或重置仍按原规则清理', () => {
    const milliseconds = remainingDraft(1500);
    milliseconds.fixedMultiplier = '2';
    milliseconds.fixedMinValue = '0';
    milliseconds.fixedMaxValue = '5000';
    expect(applyCooldownOperationChange(milliseconds, 'REDUCE').value).toEqual(fixedValue(1500));
    expect(applyCooldownOperationChange(milliseconds, 'INCREASE').value).toEqual(fixedValue(1500));
    expect(applyCooldownOperationChange(milliseconds, 'SET_REMAINING').value).toEqual(fixedValue(1500));
    expect(applyCooldownOperationChange(milliseconds, 'REDUCE_REMAINING_RATIO')).toMatchObject({
      value: null,
      fixedMultiplier: '1'
    });
    expect(applyCooldownOperationChange(milliseconds, 'RESET')).toMatchObject({
      value: null,
      fixedMultiplier: ''
    });
  });

  it('未知公式输入也不能配置保证结果为负的上界，动作修正遵循同样约束', () => {
    const base = validate(remainingDraft(0.5));
    if (!base.ok) throw new Error(JSON.stringify(base));
    const target = base.normalized.results[0];
    const dynamicResult = { ...target, valueRule: { ...target.valueRule!, value: formulaValue('runtime_duration'), fixedMaxValue: -1 } };
    expect(() => parseSkillEffect({ ...base.normalized, results: [dynamicResult] })).toThrow();
    const modifier = { resultKey: target.resultKey, fixedMultiplier: null, fixedMinValue: null, fixedMaxValue: -1 };
    expect(validateResultModifier(modifier, target)).toContain('最大值不能小于 0');
    expect(validateResultModifier({ ...modifier, fixedMaxValue: 0.5 }, target)).toBeNull();
    expect(validateResultModifier({ ...modifier, fixedMaxValue: 0 }, target)).toBeNull();
  });
});

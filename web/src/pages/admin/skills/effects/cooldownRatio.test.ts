import { describe, expect, it } from 'vitest';
import { parseSkillEffect } from '../../../../services/skillEffectClient';
import { fixedValue, formulaValue, parameterValue } from '../../../../types/numericValue';
import type { SkillParameter } from '../../../../types/skillParameter';
import { cooldownOperationOf, listAvailablePriorResultOutputs } from '../triggers/triggerRuleForm';
import {
  applyCooldownOperationChange, applyResultTypeChange, cooldownChangeAmountHint,
  createEmptyEffectDraft, createEmptyResultDraft, validateSkillEffectDraft,
  type EffectFormCatalog, type SkillEffectResultDraft
} from './effectForm';

const catalog: EffectFormCatalog = {
  parentSkillKey: 'masteryi_r', formulas: [{ formulaKey: 'ratio' }], effects: [], damageTypes: [], attributes: [],
  skills: ['masteryi_q', 'masteryi_w', 'masteryi_e'].map((skillKey) => ({ skillKey, status: 'ENABLED' })),
  skillCategories: [], statuses: []
};
const scope = { mode: 'SKILLS' as const, skillKeys: ['masteryi_q', 'masteryi_w', 'masteryi_e'], skillCategoryKeys: [] };
function ratioDraft(value = 0.7): SkillEffectResultDraft {
  return { ...createEmptyResultDraft('COOLDOWN_CHANGE'), resultKey: 'refund', name: '返还剩余冷却',
    target: 'SOURCE', cooldownOperation: 'REDUCE_REMAINING_RATIO', value: fixedValue(value), affectedSkillScope: scope };
}
function validate(result: SkillEffectResultDraft, parameters: SkillParameter[] = []) {
  return validateSkillEffectDraft({ ...createEmptyEffectDraft(), effectKey: 'refund', name: '基础技能返还', results: [result] },
    { includeEffectKey: true, catalog, parameters });
}
function parameter(valueMode: SkillParameter['valueMode'], values: number[]): SkillParameter {
  return { gameId: 'lol', skillKey: 'masteryi_r', parameterKey: 'ratio', name: '返还比例', valueType: 'DECIMAL', valueMode,
    fixedValue: valueMode === 'FIXED' ? values[0] : null,
    levelValues: valueMode === 'SKILL_LEVEL' || valueMode === 'CHARACTER_LEVEL'
      ? Object.fromEntries(values.map((v, i) => [String(i + 1), v])) : null,
    description: null, sortOrder: 0, createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z' };
}
function validResponse() {
  const result = validate(ratioDraft());
  if (!result.ok) throw new Error(JSON.stringify(result));
  return { ...result.normalized, gameId: 'lol', skillKey: 'masteryi_r',
    createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z' };
}

describe('按比例减少当前剩余冷却', () => {
  it.each([0, 0.15, 0.7, 1])('比例%s保留小数、目标和三个技能，不换算毫秒', (value) => {
    const result = validate(ratioDraft(value));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalized.results[0]).toMatchObject({ resultType: 'COOLDOWN_CHANGE', target: 'SOURCE',
      valueRule: { value: fixedValue(value), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      detail: { operation: 'REDUCE_REMAINING_RATIO', affectedSkillScope: scope } });
  });

  it.each([-0.01, 1.01, 70])('拒绝越界有效比例%s', (value) => {
    const result = validate(ratioDraft(value));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.resultErrors[0].fieldErrors.value).toContain('0 到 1');
  });

  it('先应用倍率与显式上下界，再核对有效比例', () => {
    expect(validate({ ...ratioDraft(), fixedMultiplier: '2' }).ok).toBe(false);
    expect(validate({ ...ratioDraft(70), fixedMultiplier: '0.01' }).ok).toBe(true);
    expect(validate({ ...ratioDraft(1.4), fixedMaxValue: '1' }).ok).toBe(true);
    expect(validate({ ...ratioDraft(-0.1), fixedMinValue: '0' }).ok).toBe(true);
  });

  it.each(['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL'] as const)('核对%s参数所有已保存值', (mode) => {
    const draft = { ...ratioDraft(), value: parameterValue('ratio') };
    expect(validate(draft, [parameter(mode, [0.7, 0.8, 1])]).ok).toBe(true);
    expect(validate(draft, [parameter(mode, mode === 'FIXED' ? [1.1] : [0.7, 0.8, 1.1])]).ok).toBe(false);
  });

  it('公式和计算时传入值保持引用，不假装已求值或补零', () => {
    const formula = validate({ ...ratioDraft(), value: formulaValue('ratio') });
    const runtime = validate({ ...ratioDraft(), value: parameterValue('ratio') }, [parameter('RUNTIME_INPUT', [])]);
    expect(formula.ok).toBe(true);
    expect(runtime.ok).toBe(true);
    if (runtime.ok) expect(runtime.normalized.results[0].valueRule?.value).toEqual(parameterValue('ratio'));
  });

  it('跨单位切换清理数值，原毫秒操作及同一比例操作保留草稿', () => {
    const milliseconds = { ...ratioDraft(1500), cooldownOperation: 'REDUCE' as const,
      fixedMultiplier: '2', fixedMinValue: '10', fixedMaxValue: '5000' };
    const ratio = applyCooldownOperationChange(milliseconds, 'REDUCE_REMAINING_RATIO');
    expect(ratio).toMatchObject({ value: null, fixedMultiplier: '1', fixedMinValue: '', fixedMaxValue: '',
      target: 'SOURCE', affectedSkillScope: scope });
    expect(validate(ratio).ok).toBe(false);
    expect(cooldownChangeAmountHint(ratio)).toContain('70% 填 0.7');
    expect(applyCooldownOperationChange(ratioDraft(), 'REDUCE')).toMatchObject({ value: null, fixedMultiplier: '1' });
    expect(applyCooldownOperationChange(ratioDraft(), 'REDUCE_REMAINING_RATIO').value).toEqual(fixedValue(0.7));
    expect(applyCooldownOperationChange(milliseconds, 'INCREASE').value).toEqual(fixedValue(1500));
    expect(applyCooldownOperationChange(ratioDraft(), 'RESET')).toMatchObject({ value: null, fixedMultiplier: '' });
    expect(applyResultTypeChange(ratioDraft(), 'DAMAGE').value).toBeNull();
  });

  it('服务响应完整读取新操作，并拒绝缺失数值或越界固定值', () => {
    const response = validResponse();
    expect(parseSkillEffect(response)).toEqual(response);
    expect(cooldownOperationOf(response.results[0])).toBe('REDUCE_REMAINING_RATIO');
    expect(listAvailablePriorResultOutputs(response.results[0])).toEqual(['CONFIGURED_VALUE']);
    for (const value of [-0.1, 1.1]) {
      const invalid = structuredClone(response);
      invalid.results[0].valueRule!.value = fixedValue(value);
      expect(() => parseSkillEffect(invalid)).toThrow(/valueRule/);
    }
    const missing = structuredClone(response);
    missing.results[0].valueRule = null;
    expect(() => parseSkillEffect(missing)).toThrow(/valueRule/);
  });
});

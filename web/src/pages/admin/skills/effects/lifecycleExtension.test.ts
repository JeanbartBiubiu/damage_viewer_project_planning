import { describe, expect, it } from 'vitest';
import { parseSkillEffect } from '../../../../services/skillEffectClient';
import { isValidLifecycleExtensionDuration } from '../../../../types/lifecycleExtension';
import { fixedValue, formulaValue, parameterValue } from '../../../../types/numericValue';
import type { SkillParameter } from '../../../../types/skillParameter';
import { listAvailablePriorResultOutputs } from '../triggers/triggerRuleForm';
import {
  applyLifecycleOperationChange, applyResultTypeChange, createEmptyEffectDraft, createEmptyResultDraft,
  mapSkillEffectFieldIssues, validateSkillEffectDraft, type EffectFormCatalog, type SkillEffectResultDraft
} from './effectForm';

const catalog: EffectFormCatalog = {
  parentSkillKey: 'masteryi_r', formulas: [{ formulaKey: 'extension' }],
  effects: [{ effectKey: 'attack_speed', lifecycleEnabled: true }],
  damageTypes: [], attributes: [], skills: [], skillCategories: [], statuses: []
};
function draft(value = 7000): SkillEffectResultDraft {
  return { ...createEmptyResultDraft('LIFECYCLE_OPERATION'), resultKey: 'extend', name: '延长攻速持续时间',
    target: 'SOURCE', lifecycleOperation: 'EXTEND_DURATION', targetEffectKey: 'attack_speed', value: fixedValue(value) };
}
function validate(result: SkillEffectResultDraft, parameters: SkillParameter[] = []) {
  return validateSkillEffectDraft({ ...createEmptyEffectDraft(), effectKey: 'extend_active', name: '延长主动期限', results: [result] },
    { includeEffectKey: true, catalog, parameters });
}
function parameter(mode: SkillParameter['valueMode'], values: number[]): SkillParameter {
  return { gameId: 'lol', skillKey: 'masteryi_r', parameterKey: 'duration', name: '增加时长', valueType: 'DECIMAL',
    valueMode: mode, fixedValue: mode === 'FIXED' ? values[0] : null,
    levelValues: mode === 'SKILL_LEVEL' || mode === 'CHARACTER_LEVEL'
      ? Object.fromEntries(values.map((value, index) => [String(index + 1), value])) : null,
    description: null, sortOrder: 0, createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z' };
}

describe('延长当前剩余生命周期时长', () => {
  it.each([0, 7000, 1500])('保存非负整数增加量%s且保持目标', (value) => {
    const result = validate(draft(value));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalized.results[0]).toMatchObject({ target: 'SOURCE',
      detail: { operation: 'EXTEND_DURATION', targetEffectKey: 'attack_speed' },
      valueRule: { value: fixedValue(value), fixedMultiplier: 1 } });
  });

  it.each([-1, 0.5, 7000.1, 1.0000000000000002])('拒绝非法有效毫秒%s而不取整', (value) => {
    const result = validate(draft(value));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.resultErrors[0].fieldErrors.value).toBe('有效延长时长必须是非负整数毫秒。');
  });

  it('允许小数单位明确换算，按十进制精确检查而不放宽真实小数', () => {
    expect(validate({ ...draft(0.5), fixedMultiplier: '1000' }).ok).toBe(true);
    expect(validate({ ...draft(0.035), fixedMultiplier: '1000' }).ok).toBe(true);
    expect(validate({ ...draft(0.035001), fixedMultiplier: '1000' }).ok).toBe(false);
    expect(validate({ ...draft(1), fixedMultiplier: '0.5' }).ok).toBe(false);
    expect(validate({ ...draft(-0.5), fixedMinValue: '0' }).ok).toBe(true);
    expect(validate({ ...draft(7000.5), fixedMaxValue: '7000' }).ok).toBe(true);
    const rule = { value: fixedValue(1), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null };
    expect(isValidLifecycleExtensionDuration(Infinity, rule)).toBe(false);
    expect(isValidLifecycleExtensionDuration(1e308, { ...rule, fixedMultiplier: 1e308 })).toBe(false);
    expect(isValidLifecycleExtensionDuration(1e308, { ...rule, fixedMultiplier: 1e308, fixedMaxValue: 7000 })).toBe(true);
  });

  it.each(['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL'] as const)('在%s参数换算后核对全部取值', (mode) => {
    const result = { ...draft(), value: parameterValue('duration'), fixedMultiplier: '1000' };
    expect(validate(result, [parameter(mode, [0.5, 0.035])]).ok).toBe(true);
    expect(validate(result, [parameter(mode, mode === 'FIXED' ? [0.0005] : [0.5, 0.0005])]).ok).toBe(false);
  });

  it('未知公式与运行参数保留引用，不假装已求值', () => {
    expect(validate({ ...draft(), value: formulaValue('extension') }).ok).toBe(true);
    expect(validate({ ...draft(), value: parameterValue('duration') }, [parameter('RUNTIME_INPUT', [])]).ok).toBe(true);
  });

  it('层数与毫秒间清值，同单位保留，旧层数和刷新约束不变', () => {
    const layers = { ...draft(2), lifecycleOperation: 'INCREASE' as const, fixedMultiplier: '3', fixedMinValue: '1' };
    const extension = applyLifecycleOperationChange(layers, 'EXTEND_DURATION');
    expect(extension).toMatchObject({ value: null, fixedMultiplier: '1', fixedMinValue: '', fixedMaxValue: '',
      target: 'SOURCE', targetEffectKey: 'attack_speed' });
    expect(validate(extension).ok).toBe(false);
    expect(applyLifecycleOperationChange(draft(), 'INCREASE').value).toBeNull();
    expect(applyLifecycleOperationChange(draft(), 'EXTEND_DURATION').value).toEqual(fixedValue(7000));
    expect(applyLifecycleOperationChange(layers, 'CONSUME').value).toEqual(fixedValue(2));
    expect(validate({ ...layers, value: fixedValue(0.5) }).ok).toBe(false);
    expect(validate(applyLifecycleOperationChange(draft(), 'REFRESH')).ok).toBe(true);
    expect(applyResultTypeChange(draft(), 'DAMAGE').value).toBeNull();
  });

  it('响应往返、前序配置值及目标错误定位仍可用', () => {
    const result = validate(draft());
    if (!result.ok) throw new Error(JSON.stringify(result));
    const response = { ...result.normalized, gameId: 'lol', skillKey: 'masteryi_r',
      createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z' };
    expect(parseSkillEffect(response)).toEqual(response);
    expect(listAvailablePriorResultOutputs(response.results[0])).toEqual(['CONFIGURED_VALUE']);
    const invalid = structuredClone(response);
    invalid.results[0].valueRule!.value = fixedValue(-1);
    expect(() => parseSkillEffect(invalid)).toThrow(/valueRule/);
    invalid.results[0].valueRule = null;
    expect(() => parseSkillEffect(invalid)).toThrow(/valueRule/);
    const mapped = mapSkillEffectFieldIssues({ fieldIssues: [{ field: 'results[0].detail.targetEffectKey',
      code: 'TARGET_EFFECT_HAS_NO_DURATION', message: '延长目标必须有自然到期期限' }] }, [draft()]);
    expect(mapped.resultErrors[0].fieldErrors.targetEffectKey).toBe('延长目标必须有自然到期期限');
  });
});

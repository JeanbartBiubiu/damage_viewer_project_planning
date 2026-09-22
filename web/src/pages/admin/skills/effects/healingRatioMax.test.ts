import { describe, expect, it } from 'vitest';
import { fixedValue, formulaValue, parameterValue } from '../../../../types/numericValue';
import type { SkillParameter } from '../../../../types/skillParameter';
import {
  createEmptyEffectDraft, createEmptyResultDraft, healingModifierAmountHint, HEALING_RATIO_MAX_HINT,
  skillEffectToDraft, validateSkillEffectDraft, type EffectFormCatalog, type SkillEffectResultDraft
} from './effectForm';

const catalog: EffectFormCatalog = {
  parentSkillKey: 'morellonomicon', formulas: [{ formulaKey: 'wound' }], effects: [],
  damageTypes: [], attributes: [], skills: [], skillCategories: [], statuses: [],
  modifierZones: [
    { modifierZoneKey: 'grievous', domain: 'HEALING', status: 'ENABLED', calculationMode: 'RATIO_MAX' },
    { modifierZoneKey: 'healing_ratio', domain: 'HEALING', status: 'ENABLED', calculationMode: 'RATIO_ADD' },
    { modifierZoneKey: 'disabled_grievous', domain: 'HEALING', status: 'DISABLED', calculationMode: 'RATIO_MAX' }
  ]
};

function draft(patch: Partial<SkillEffectResultDraft> = {}): SkillEffectResultDraft {
  return {
    ...createEmptyResultDraft('HEALING_MODIFIER'), resultKey: 'wound', name: '受到治疗降低',
    target: 'TARGET', healingModifierDirection: 'RECEIVED', modifierOperation: 'DECREASE',
    healingKind: 'ANY', modifierZoneKey: 'grievous', value: fixedValue(0.4),
    lifecycleBehavior: {
      moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
      reapplicationValueMode: 'KEEP', periodicExecutionMode: ''
    },
    ...patch
  };
}

function validate(result: SkillEffectResultDraft, parameters: SkillParameter[] = [], zones = catalog) {
  const effect = createEmptyEffectDraft();
  effect.effectKey = 'grievous'; effect.name = '重伤'; effect.lifecycleEnabled = true;
  effect.lifecycle.maxStacksValue = fixedValue(1);
  effect.lifecycle.applicationStacksValue = fixedValue(1);
  effect.lifecycle.instanceScope = 'SOURCE_TARGET';
  effect.lifecycle.durationValue = fixedValue(3000);
  effect.lifecycle.reapplicationStackMode = 'KEEP';
  effect.lifecycle.reapplicationDurationMode = 'REFRESH_ALL';
  effect.lifecycle.expiryMode = 'ALL_AT_ONCE';
  return validateSkillEffectDraft({ ...effect, results: [result] }, {
    includeEffectKey: true, catalog: zones, parameters, catalogLoadState: { modifierZones: 'ready', formulas: 'ready' },
    parametersLoadState: 'ready'
  });
}

function parameter(mode: SkillParameter['valueMode'], values: number[]): SkillParameter {
  return {
    gameId: 'lol', skillKey: 'morellonomicon', parameterKey: 'ratio', name: '减少比例',
    valueType: 'DECIMAL', valueMode: mode, fixedValue: mode === 'FIXED' ? values[0]! : null,
    levelValues: mode === 'SKILL_LEVEL' || mode === 'CHARACTER_LEVEL'
      ? Object.fromEntries(values.map((value, index) => [String(index + 1), value])) : null,
    description: null, sortOrder: 0, createdAt: '', updatedAt: ''
  };
}

describe('治疗修正引用比例减少取强', () => {
  it.each([0, 0.4, 1])('合法减少比例 %s 按真实目录模式通过', (value) => {
    const result = validate(draft({ value: fixedValue(value) }));
    expect(result.ok).toBe(true);
    expect(healingModifierAmountHint(draft(), catalog)).toBe(HEALING_RATIO_MAX_HINT);
  });

  it('RATIO_ADD 治疗乘区保持原方向和操作，不按名称当成取强', () => {
    const add = draft({ modifierZoneKey: 'healing_ratio', healingModifierDirection: 'DONE', modifierOperation: 'INCREASE' });
    expect(validate(add).ok).toBe(true);
    expect(healingModifierAmountHint(add, catalog)).toBeNull();
    expect(healingModifierAmountHint(draft({ name: '重伤', modifierZoneKey: 'healing_ratio' }), catalog)).toBeNull();
  });

  it('非法方向或操作保留草稿', () => {
    const before = draft({ healingModifierDirection: 'DONE', modifierOperation: 'INCREASE', value: fixedValue(0.4) });
    const copy = structuredClone(before);
    const result = validate(before);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.resultErrors[0]?.fieldErrors.healingModifierDirection).toBe('比例减少取强只允许受到治疗方向');
      expect(result.resultErrors[0]?.fieldErrors.modifierOperation).toBe('比例减少取强只允许降低操作');
    }
    expect(before).toEqual(copy);
  });

  it.each([-0.01, 1.01, 40])('拒绝静态有效比例越界 %s，不夹取作者数值', (value) => {
    const result = validate(draft({ value: fixedValue(value) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.resultErrors[0]?.fieldErrors.value).toContain('0到1');
  });

  it('先应用倍率与已配置上下界再核对有效比例', () => {
    expect(validate(draft({ value: fixedValue(40), fixedMultiplier: '0.01' })).ok).toBe(true);
    expect(validate(draft({ value: fixedValue(2), fixedMaxValue: '0.4' })).ok).toBe(true);
    expect(validate(draft({ value: fixedValue(-0.2), fixedMinValue: '0' })).ok).toBe(true);
    expect(validate(draft({ value: fixedValue(40) })).ok).toBe(false);
  });

  it.each(['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL'] as const)('核对%s参数所有已保存值', (mode) => {
    const result = draft({ value: parameterValue('ratio') });
    expect(validate(result, [parameter(mode, mode === 'FIXED' ? [0.4] : [0.4, 0.5, 1])]).ok).toBe(true);
    expect(validate(result, [parameter(mode, mode === 'FIXED' ? [1.1] : [0.4, 1.1])]).ok).toBe(false);
  });

  it('公式和计算时传入值保持引用，不假装已求值', () => {
    expect(validate(draft({ value: formulaValue('wound') })).ok).toBe(true);
    expect(validate(draft({ value: parameterValue('ratio') }), [parameter('RUNTIME_INPUT', [])]).ok).toBe(true);
  });

  it('保留停用乘区的合法旧引用，新草稿不能引入停用乘区', () => {
    const existing = validate(draft({ modifierZoneKey: 'disabled_grievous', originalModifierZoneKey: 'disabled_grievous' }));
    expect(existing.ok).toBe(true);
    expect(validate(draft({ modifierZoneKey: 'disabled_grievous' })).ok).toBe(false);
  });

  it('往返保留 RATIO_MAX 引用与受到治疗降低', () => {
    const result = validate(draft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roundTrip = skillEffectToDraft({
      ...result.normalized, gameId: 'lol', skillKey: 'morellonomicon',
      createdAt: '', updatedAt: ''
    });
    expect(roundTrip.results[0]).toMatchObject({
      healingModifierDirection: 'RECEIVED', modifierOperation: 'DECREASE', modifierZoneKey: 'grievous'
    });
  });
});

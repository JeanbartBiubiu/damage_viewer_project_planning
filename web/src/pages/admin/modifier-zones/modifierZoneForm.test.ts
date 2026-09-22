import { describe, expect, it } from 'vitest';
import { allowedApplicationStages, allowedCalculationModes, validateModifierZoneDraft } from './modifierZoneForm';

describe('modifierZoneForm', () => {
  it('accepts each supported structure and exposes no unsupported stage', () => {
    expect(allowedApplicationStages('DAMAGE', 'RATIO_ADD')).toEqual([
      'DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'
    ]);
    expect(validateModifierZoneDraft({
      modifierZoneKey: 'damage_pre_defense', name: '伤害前修正', domain: 'DAMAGE',
      calculationMode: 'RATIO_ADD', applicationStage: 'DAMAGE_PRE_DEFENSE',
      description: '', sortOrder: '0'
    }, true)).toEqual({});
  });

  it('rejects an unsupported domain and calculation combination', () => {
    expect(validateModifierZoneDraft({
      modifierZoneKey: 'bad', name: '错误组合', domain: 'DAMAGE',
      calculationMode: 'FLAT_ADD', applicationStage: 'DAMAGE_PRE_DEFENSE',
      description: '', sortOrder: '0'
    }, true)).toMatchObject({ applicationStage: expect.any(String) });
  });

  it('allows HEALING RATIO_MAX with HEALING_RESULT and keeps RATIO_ADD', () => {
    expect(allowedCalculationModes('HEALING')).toEqual(['RATIO_ADD', 'RATIO_MAX']);
    expect(allowedCalculationModes('DAMAGE')).toEqual(['RATIO_ADD']);
    expect(allowedApplicationStages('HEALING', 'RATIO_MAX')).toEqual(['HEALING_RESULT']);
    expect(validateModifierZoneDraft({
      modifierZoneKey: 'grievous', name: '重伤', domain: 'HEALING',
      calculationMode: 'RATIO_MAX', applicationStage: 'HEALING_RESULT',
      description: '', sortOrder: '0'
    }, true)).toEqual({});
    expect(validateModifierZoneDraft({
      modifierZoneKey: 'heal_add', name: '治疗加算', domain: 'HEALING',
      calculationMode: 'RATIO_ADD', applicationStage: 'HEALING_RESULT',
      description: '', sortOrder: '0'
    }, true)).toEqual({});
  });

  it('does not guess a default mode and keeps illegal RATIO_MAX drafts', () => {
    const empty = {
      modifierZoneKey: 'grievous', name: '重伤', domain: 'HEALING' as const,
      calculationMode: '' as const, applicationStage: '' as const, description: '', sortOrder: '0'
    };
    const emptyErrors = validateModifierZoneDraft(empty, true);
    expect(emptyErrors.calculationMode).toBe('计算方式不能为空');
    expect(empty.calculationMode).toBe('');
    expect(validateModifierZoneDraft({
      ...empty, calculationMode: 'RATIO_MAX', applicationStage: 'DAMAGE_PRE_DEFENSE'
    }, true).calculationMode).toBe('作用域、计算方式和应用阶段组合不合法');
    expect(validateModifierZoneDraft({
      modifierZoneKey: 'bad', name: '伤害取强', domain: 'DAMAGE',
      calculationMode: 'RATIO_MAX', applicationStage: 'DAMAGE_PRE_DEFENSE',
      description: '', sortOrder: '0'
    }, true).calculationMode).toBe('作用域、计算方式和应用阶段组合不合法');
  });
});

import { describe, expect, it } from 'vitest';
import { allowedApplicationStages, validateModifierZoneDraft } from './modifierZoneForm';

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
});

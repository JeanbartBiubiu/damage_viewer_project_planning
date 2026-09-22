import { describe, expect, it } from 'vitest';
import type { SkillEffect } from '../../../../types/skillEffect';
import { parseSkillEffect } from '../../../../services/skillEffectClient';
import {
  applyResultTypeChange, buildCreateSkillEffectRequest, createEmptyResultDraft,
  skillEffectToDraft, validateSkillEffectDraft, type EffectFormCatalog
} from './effectForm';
import { allowedApplicationStages, validateModifierZoneDraft } from '../../modifier-zones/modifierZoneForm';

const effect: SkillEffect = {
  gameId: 'lol', skillKey: 'item_3065_passive', effectKey: 'received_shield_increase',
  name: '受到护盾增幅', description: null, sortOrder: 20,
  createdAt: '2026-09-19T00:00:00Z', updatedAt: '2026-09-19T00:00:00Z',
  lifecycle: {
    durationValue: null, maxStacksValue: { kind: 'FIXED', value: 1 },
    applicationStacksValue: { kind: 'FIXED', value: 1 }, instanceScope: 'SOURCE',
    reapplicationStackMode: 'KEEP', reapplicationDurationMode: null,
    expiryMode: 'EXPLICIT_ONLY', periodicIntervalValue: null, firstPeriodicExecution: null
  },
  results: [{
    resultKey: 'shield_received', name: '收到普通护盾提高', resultType: 'SHIELD_RECEIVED_MODIFIER',
    target: 'SOURCE', description: null, sortOrder: 10, spellShieldBlockScope: null,
    valueRule: { value: { kind: 'FIXED', value: 0.25 }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: { modifierZoneKey: 'shield_received_ratio', operation: 'INCREASE' },
    lifecycleBehavior: {
      moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
      reapplicationValueMode: 'REPLACE', periodicExecutionMode: null
    }
  }]
};
const catalog: EffectFormCatalog = {
  parentSkillKey: effect.skillKey, formulas: [], effects: [], damageTypes: [], attributes: [],
  skills: [], skillCategories: [], statuses: [],
  modifierZones: [{ modifierZoneKey: 'shield_received_ratio', domain: 'SHIELD', status: 'ENABLED', calculationMode: 'RATIO_ADD' }]
};

describe('收到普通护盾修正管理契约', () => {
  it('round trips the receiver and ratio without adding direction or shield-generation fields', () => {
    const parsed = parseSkillEffect(structuredClone(effect));
    const validation = validateSkillEffectDraft(skillEffectToDraft(parsed), { includeEffectKey: true, catalog });
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error(JSON.stringify(validation));
    expect(buildCreateSkillEffectRequest(validation.normalized).results).toEqual(effect.results);
    expect(validation.normalized.lifecycle).toEqual(effect.lifecycle);
  });

  it('requires a shield zone and rejects substituting a healing zone', () => {
    const validation = validateSkillEffectDraft(skillEffectToDraft(effect), {
      includeEffectKey: true, catalog: { ...catalog,
        modifierZones: [{ modifierZoneKey: 'shield_received_ratio', domain: 'HEALING', status: 'ENABLED', calculationMode: 'RATIO_ADD' }] }
    });
    expect(validation.ok).toBe(false);
    if (validation.ok) throw new Error('must reject the wrong domain');
    expect(validation.resultErrors[0].fieldErrors.modifierZoneKey).toBeTruthy();
  });

  it('clears healing-only fields when selecting shield reception and clears the zone when leaving it', () => {
    const healing = createEmptyResultDraft('HEALING_MODIFIER');
    healing.healingModifierDirection = 'DONE'; healing.healingKind = 'VAMP'; healing.modifierZoneKey = 'healing';
    const shield = applyResultTypeChange(healing, 'SHIELD_RECEIVED_MODIFIER');
    expect(shield.healingModifierDirection).toBe(''); expect(shield.healingKind).toBe('');
    expect(shield.modifierZoneKey).toBe(''); expect(shield.modifierOperation).toBe('INCREASE');
    expect(shield.lifecycleBehavior.moment).toBe('PERSISTENT');
    shield.modifierZoneKey = 'shield_received_ratio';
    const normal = applyResultTypeChange(shield, 'NORMAL_SHIELD');
    expect(normal.modifierZoneKey).toBe(''); expect(normal.modifierOperation).toBe('');
  });

  it.each(['direction', 'healingKind', 'absorbedDamageTypeKey'])('rejects the unrelated detail field %s', (field) => {
    const bad = structuredClone(effect);
    Object.assign(bad.results[0].detail, { [field]: 'ANY' });
    expect(() => parseSkillEffect(bad)).toThrow();
  });

  it('rejects absent parent lifecycle, discrete behavior, missing ratio and spell-block scope', () => {
    const noParent = structuredClone(effect); noParent.lifecycle = null;
    expect(() => parseSkillEffect(noParent)).toThrow();
    const discrete = structuredClone(effect); discrete.results[0].lifecycleBehavior = null;
    expect(() => parseSkillEffect(discrete)).toThrow();
    const noRatio = structuredClone(effect); Object.assign(noRatio.results[0], { valueRule: null });
    expect(() => parseSkillEffect(noRatio)).toThrow();
    const blocking = structuredClone(effect); blocking.results[0].spellShieldBlockScope = 'RESULT';
    expect(() => parseSkillEffect(blocking)).toThrow();
  });

  it('offers only ratio shield-result zones', () => {
    expect(allowedApplicationStages('SHIELD', 'RATIO_ADD')).toEqual(['SHIELD_RESULT']);
    expect(allowedApplicationStages('SHIELD', 'FLAT_ADD')).toEqual([]);
    const draft = { modifierZoneKey: 'shield_received_ratio', name: '收到护盾增幅', domain: 'SHIELD' as const,
      calculationMode: 'RATIO_ADD' as const, applicationStage: 'SHIELD_RESULT' as const, description: '', sortOrder: '0' };
    expect(validateModifierZoneDraft(draft, true)).toEqual({});
    expect(validateModifierZoneDraft({ ...draft, applicationStage: 'HEALING_RESULT' }, true).applicationStage).toBeTruthy();
  });

  it.each([
    { valueReadMode: 'INVALID' },
    { stackValueMode: undefined },
    { periodicExecutionMode: 'ONCE' },
    { reapplicationValueMode: undefined },
    { valueReadMode: 'MOMENT_EVALUATION', reapplicationValueMode: 'ADD' },
    { stackValueMode: 'PER_STACK', reapplicationValueMode: 'REPLACE' }
  ])('rejects invalid persistent numeric response fields: %j', (fields) => {
    const bad = structuredClone(effect);
    Object.assign(bad.results[0].lifecycleBehavior!, fields);
    expect(() => parseSkillEffect(bad)).toThrow();
  });

  it('accepts current-value and per-stack policies only without a reapplication merge', () => {
    for (const fields of [
      { valueReadMode: 'MOMENT_EVALUATION', reapplicationValueMode: null },
      { stackValueMode: 'PER_STACK', reapplicationValueMode: null }
    ]) {
      const valid = structuredClone(effect);
      Object.assign(valid.results[0].lifecycleBehavior!, fields);
      expect(parseSkillEffect(valid)).toEqual(valid);
    }
  });
});

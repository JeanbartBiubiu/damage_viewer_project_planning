import { describe, expect, it } from 'vitest';
import { fixedValue } from '../../../../types/numericValue';
import { createEmptyEffectDraft, createEmptyResultDraft, enableLifecycleDraft, groupedAmplificationAmountHint, validateSkillEffectDraft,
  type EffectFormCatalog } from './effectForm';

function sample() {
  const result = createEmptyResultDraft('DAMAGE_MODIFIER');
  Object.assign(result, { resultKey: 'amplify', name: '同组增幅', target: 'SOURCE', modifierDirection: 'DEALT', modifierOperation: 'INCREASE',
    modifierZoneKey: 'group_a', damageTypeKey: 'physics', value: fixedValue(.2),
    lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED', reapplicationValueMode: '', periodicExecutionMode: '' } });
  const draft = enableLifecycleDraft({ ...createEmptyEffectDraft(), effectKey: 'buff', name: '增幅效果', results: [result] });
  Object.assign(draft.lifecycle, { durationValue: fixedValue(1000), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
    instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE' });
  const catalog: EffectFormCatalog = { parentSkillKey: 'group_skill', damageTypes: [{ damageTypeKey: 'physics', status: 'ENABLED' }],
    modifierZones: [{ modifierZoneKey: 'group_a', domain: 'DAMAGE', calculationMode: 'RATIO_GROUP_ADD', applicationStage: 'DAMAGE_PRE_DEFENSE', status: 'ENABLED' }] };
  return { draft, result: draft.results[0]!, catalog };
}

describe('同组增幅作者校验', () => {
  it('保存真实区域引用和比例，不另让作者填写组名', () => {
    const { draft, catalog } = sample();
    const checked = validateSkillEffectDraft(draft, { includeEffectKey: true, catalog });
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
    if (checked.ok) expect(checked.normalized.results[0]).toMatchObject({ valueRule: { value: fixedValue(.2) }, detail: { modifierZoneKey: 'group_a', direction: 'DEALT', operation: 'INCREASE' } });
    expect(groupedAmplificationAmountHint(draft.results[0]!, catalog)).toContain('20%填0.2');
  });

  it.each(['decrease', 'direction', 'negative', 'negative_multiplier', 'critical', 'duplicate'])(
    '明确拒绝不可保存的新分组组合：%s', kind => {
      const { draft, result, catalog } = sample();
      if (kind === 'decrease') result.modifierOperation = 'DECREASE';
      if (kind === 'direction') result.modifierDirection = 'TAKEN';
      if (kind === 'negative') { result.value = fixedValue(-.2); result.fixedMinValue = '0'; }
      if (kind === 'negative_multiplier') result.fixedMultiplier = '-1';
      if (kind === 'critical') result.criticalFilter = 'CRITICAL_ONLY';
      if (kind === 'duplicate') catalog.modifierZones = [catalog.modifierZones![0]!, catalog.modifierZones![0]!];
      expect(validateSkillEffectDraft(draft, { includeEffectKey: true, catalog }).ok).toBe(false);
    });
});

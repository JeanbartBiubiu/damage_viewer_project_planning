import { describe, expect, it } from 'vitest';
import { fixedValue, formulaValue } from '../../../../types/numericValue';
import type { GameVampRule } from '../../../../types/gameVamp';
import { createEmptyEffectDraft, createEmptyResultDraft, mapSkillEffectFieldIssues, validateSkillEffectDraft, type SkillEffectResultDraft } from './effectForm';

const rule: GameVampRule = { vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE',
  defaultEfficiency: 1, deliveryKinds: ['SKILL'], originKinds: ['DIRECT'], skillCategoryKeys: ['common'] };
const options = { includeEffectKey: true, gameVampRulesLoadState: 'ready' as const, gameVampRules: [rule], parentSkillCategoryKeys: ['common'] };
const damage = (patch: Partial<SkillEffectResultDraft> = {}): SkillEffectResultDraft => ({ ...createEmptyResultDraft(),
  resultKey: 'hit', name: '伤害', damageTypeKey: 'physical', value: fixedValue(100), ...patch });
const effect = (result: SkillEffectResultDraft) => ({ ...createEmptyEffectDraft(), effectKey: 'hit', name: '伤害效果', results: [result] });

describe('伤害吸血资格与例外', () => {
  it('新建未核定可保存，已核定空例外保留继承且不复制游戏字段', () => {
    const unresolved = validateSkillEffectDraft(effect(damage()), options);
    expect(unresolved.ok && unresolved.normalized.results[0].detail).toMatchObject({ vampQualification: 'UNRESOLVED', vampOverrides: [] });
    const inherited = validateSkillEffectDraft(effect(damage({ vampQualification: 'RESOLVED' })), options);
    expect(inherited.ok && inherited.normalized.results[0].detail).toEqual({ damageTypeKey: 'physical', deliveryKind: 'SKILL', originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: [] });
  });
  it('缺少游戏规则、读取失败或缺少技能分类时不能标为已核定', () => {
    for (const patch of [{ gameVampRules: [] }, { gameVampRulesLoadState: 'failed' as const }, { parentSkillCategoryKeys: [] }]) {
      const result = validateSkillEffectDraft(effect(damage({ vampQualification: 'RESOLVED' })), { ...options, ...patch });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.resultErrors[0].fieldErrors.vampQualification).toBeTruthy();
    }
  });
  it('未核定不允许携带例外，禁止项不能偷偷保留数值引用', () => {
    const disabled = { vampType: 'OMNIVAMP' as const, mode: 'DISABLED' as const, basisOutputKind: null, efficiencyValue: null };
    expect(validateSkillEffectDraft(effect(damage({ vampOverrides: [disabled] })), options).ok).toBe(false);
    expect(validateSkillEffectDraft(effect(damage({ vampQualification: 'RESOLVED', vampOverrides: [disabled] })), options).ok).toBe(true);
    expect(validateSkillEffectDraft(effect(damage({ vampQualification: 'RESOLVED', vampOverrides: [{ ...disabled, efficiencyValue: formulaValue('old') }] })), options).ok).toBe(false);
  });
  it('覆盖必须有本游戏同类规则、明确基数及非负效率，零效率合法', () => {
    const override = { vampType: 'OMNIVAMP' as const, mode: 'OVERRIDE' as const, basisOutputKind: 'ACTUAL_HP_LOSS' as const, efficiencyValue: fixedValue(0) };
    expect(validateSkillEffectDraft(effect(damage({ vampQualification: 'RESOLVED', vampOverrides: [override] })), options).ok).toBe(true);
    for (const patch of [{ basisOutputKind: null }, { efficiencyValue: null }, { efficiencyValue: fixedValue(-1) }, { vampType: 'SPELL_VAMP' as const }]) {
      expect(validateSkillEffectDraft(effect(damage({ vampQualification: 'RESOLVED', vampOverrides: [{ ...override, ...patch }] })), options).ok).toBe(false);
    }
  });
  it('服务端资格与例外错误定位到对应结果字段', () => {
    expect(mapSkillEffectFieldIssues({ fieldIssues: [
      { field: 'results[0].detail.vampQualification', message: '尚未核定' },
      { field: 'results[0].detail.vampOverrides[0].mode', message: '例外方式不合法' }
    ] }).resultErrors).toEqual([{ index: 0, fieldErrors: { vampQualification: '尚未核定', vampOverrides: '例外方式不合法' } }]);
  });
});

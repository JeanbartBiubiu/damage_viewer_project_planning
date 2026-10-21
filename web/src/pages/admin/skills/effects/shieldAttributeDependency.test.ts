import { describe, expect, it } from 'vitest';
import { loadMechanismCases } from '../../../../../tests/mechanisms/mechanismCase';
import { parseSkillEffect } from '../../../../services/skillEffectClient';
import { buildCreateSkillEffectRequest, skillEffectToDraft, validateSkillEffectDraft, skillEffectResultToDraft,
  isSpellShieldBlockScopeVisible, listSpellShieldBlockScopeOptions, clearHiddenResultFields } from './effectForm';

function fixture() {
  const snapshot = loadMechanismCases().find(row => row.caseKey === 'defense_own_counter_shield_restart')!.buildSnapshot();
  return snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_armor')!.effects[1]!;
}

describe('关联盾属性明细表单与协议', () => {
  it('完整依赖读回、编辑、保存保持同一三个标识；关闭字段真正省略', () => {
    const effect = fixture();
    expect(parseSkillEffect(effect)).toEqual(effect);
    const draft = skillEffectToDraft(effect);
    expect(draft.results[0]!.requiredShield).toEqual({ skillKey: 'lab_guard', effectKey: 'guard', resultKey: 'barrier' });
    const validated = validateSkillEffectDraft(draft, { includeEffectKey: true });
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(JSON.stringify(validated));
    expect(buildCreateSkillEffectRequest(validated.normalized).results[0]!.detail).toEqual(effect.results[0]!.detail);
    draft.results[0]!.requiredShield = null;
    const ordinary = validateSkillEffectDraft(draft, { includeEffectKey: true });
    expect(ordinary.ok).toBe(true);
    if (!ordinary.ok) throw new Error(JSON.stringify(ordinary));
    expect(buildCreateSkillEffectRequest(ordinary.normalized).results[0]!.detail).not.toHaveProperty('requiredShield');
  });

  it.each([null, {}, { skillKey: 'lab_guard', effectKey: 'guard' }, { skillKey: 'lab_guard', effectKey: 'guard', resultKey: 'barrier', extra: true }])('显式空值、缺字段或额外字段拒绝读回', value => {
    const effect = fixture();
    Object.assign(effect.results[0]!.detail, { requiredShield: value });
    expect(() => parseSkillEffect(effect)).toThrow(/requiredShield/);
  });

  it('未填全标识保留失败草稿并显示同一明细错误', () => {
    const draft = skillEffectToDraft(fixture());
    draft.results[0]!.requiredShield!.resultKey = '';
    const result = validateSkillEffectDraft(draft, { includeEffectKey: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('未拒绝缺失标识');
    expect(JSON.stringify(result)).toContain('requiredShield');
    expect(draft.results[0]!.requiredShield!.skillKey).toBe('lab_guard');
  });

  it('目标持续SET不能显示、保存或读回新增的技能法术盾粒度', () => {
    const snapshot = loadMechanismCases().find(row => row.caseKey === 'attribute_paired_snapshot_refresh')!.buildSnapshot();
    const effect = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_transfer')!.effects[0]!;
    const result = effect.results[0]!;
    if (result.resultType !== 'ATTRIBUTE_CHANGE') throw new Error('缺少属性');
    result.detail.operation = 'SET';
    const draft = skillEffectResultToDraft(result);
    expect(isSpellShieldBlockScopeVisible(draft)).toBe(false);
    expect(listSpellShieldBlockScopeOptions(draft)).toEqual([]);
    expect(clearHiddenResultFields(draft).spellShieldBlockScope).toBe('');
    expect(() => parseSkillEffect(effect)).toThrow(/spellShieldBlockScope/);
  });
});

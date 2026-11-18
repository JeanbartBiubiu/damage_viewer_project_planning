import { describe, expect, it } from 'vitest';
import { fixedValue } from '../../../../types/numericValue';
import type { SkillEffect } from '../../../../types/skillEffect';
import {
  applyResultTypeChange, buildCreateSkillEffectRequest, buildUpdateSkillEffectRequest,
  createEmptyEffectDraft, createEmptyResultDraft, enableLifecycleDraft, mapSkillEffectFieldIssues,
  normalizeResultDraftForDirtyComparison, skillEffectToDraft, validateSkillEffectDraft,
  type SkillEffectResultDraft
} from './effectForm';

const follow = { skillKey: 'sample_w', effectKey: 'empower_damage', resultKey: 'magic' };
const options = { includeEffectKey: true };
function fixture(patch: Partial<SkillEffectResultDraft> = {}) {
  return { ...createEmptyEffectDraft(), effectKey: 'bonus', name: '既有伤害效果', results: [
    { ...createEmptyResultDraft(), resultKey: 'magic', name: '附伤', damageTypeKey: 'magic',
      value: fixedValue(75), spellShieldFollowResult: { ...follow }, ...patch }
  ] };
}
function savedFixture(): SkillEffect {
  const checked = validateSkillEffectDraft(fixture(), options);
  if (!checked.ok) throw new Error(JSON.stringify(checked));
  return { ...buildCreateSkillEffectRequest(checked.normalized), gameId: 'lol', skillKey: 'sample_r', createdAt: '', updatedAt: '' };
}

describe('同次法盾结果跟随的表单往返', () => {
  it('改效果和结果名称后完整保存并重开，不丢失API录入的引用', () => {
    const saved = savedFixture(), draft = skillEffectToDraft(saved);
    draft.name = '调整效果名称'; draft.results[0]!.name = '调整附伤名称';
    const checked = validateSkillEffectDraft(draft, options);
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error(JSON.stringify(checked));
    const request = buildUpdateSkillEffectRequest(checked.normalized);
    expect(request.results[0]!.detail).toHaveProperty('spellShieldFollowResult', follow);
    const reopened = skillEffectToDraft({ ...saved, ...request });
    expect(reopened.results[0]!.spellShieldFollowResult).toEqual(follow);
    expect(reopened.name).toBe('调整效果名称');
    expect(reopened.results[0]!.name).toBe('调整附伤名称');
    expect(saved.results[0]!.detail).toHaveProperty('spellShieldFollowResult', follow);
  });

  it('读取草稿和构建请求都不与原数据或归一化结果共用可写引用', () => {
    const saved = savedFixture(), draft = skillEffectToDraft(saved);
    draft.results[0]!.spellShieldFollowResult!.resultKey = 'other_magic';
    expect(saved.results[0]!.detail).toHaveProperty('spellShieldFollowResult', follow);
    const checked = validateSkillEffectDraft(draft, options);
    if (!checked.ok) throw new Error(JSON.stringify(checked));
    const request = buildUpdateSkillEffectRequest(checked.normalized);
    const result = request.results[0]!;
    if (result.resultType !== 'DAMAGE' || !result.detail.spellShieldFollowResult) throw new Error('fixture');
    result.detail.spellShieldFollowResult.resultKey = 'request_only';
    expect(checked.normalized.results[0]!.detail).toHaveProperty('spellShieldFollowResult.resultKey', 'other_magic');
    expect(draft.results[0]!.spellShieldFollowResult!.resultKey).toBe('other_magic');
  });

  it('省略声明保持省略，不在请求中补null或空引用', () => {
    const checked = validateSkillEffectDraft(fixture({ spellShieldFollowResult: null }), options);
    if (!checked.ok) throw new Error(JSON.stringify(checked));
    const request = buildCreateSkillEffectRequest(checked.normalized);
    expect(request.results[0]!.detail).not.toHaveProperty('spellShieldFollowResult');
  });

  it('切换非伤害种类清除跟随，切回伤害不恢复已经退出的引用', () => {
    const next = applyResultTypeChange(fixture().results[0]!, 'DIRECT_HEAL');
    expect(next.spellShieldFollowResult).toBeNull();
    const checked = validateSkillEffectDraft({ ...fixture(), results: [next] }, options);
    if (!checked.ok) throw new Error(JSON.stringify(checked));
    expect(buildCreateSkillEffectRequest(checked.normalized).results[0]!.detail).not.toHaveProperty('spellShieldFollowResult');
    expect(applyResultTypeChange(next, 'DAMAGE').spellShieldFollowResult).toBeNull();
  });

  it.each<Partial<SkillEffectResultDraft>>([
    { target: 'SOURCE' }, { attackDamageRole: 'PRIMARY', damageDeliveryKind: 'BASIC_ATTACK' },
    { attackDamageRole: 'REPLACE_PRIMARY', damageDeliveryKind: 'BASIC_ATTACK' }, { spellShieldBlockScope: 'SKILL' }
  ])('拒绝与跟随不兼容的目标、普攻角色或独立判盾 %j', patch => {
    const draft = fixture(patch), checked = validateSkillEffectDraft(draft, options);
    expect(checked.ok).toBe(false);
    if (checked.ok) throw new Error('本场应拒绝');
    expect(checked.resultErrors[0]!.fieldErrors.spellShieldFollowResult).toContain('即时目标伤害');
    expect(draft.results[0]!.spellShieldFollowResult).toEqual(follow);
  });

  it('开启生命周期后明确拒绝跟随，不静默删除已读引用', () => {
    const draft = enableLifecycleDraft(fixture());
    Object.assign(draft.lifecycle, { maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
      instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP' });
    draft.results[0]!.lifecycleBehavior.moment = 'APPLICATION';
    const checked = validateSkillEffectDraft(draft, options);
    expect(checked.ok).toBe(false);
    if (checked.ok) throw new Error('本场应拒绝');
    expect(checked.resultErrors[0]!.fieldErrors.spellShieldFollowResult).toContain('即时目标伤害');
    expect(draft.results[0]!.spellShieldFollowResult).toEqual(follow);
  });

  it('引用的空标识或额外字段不能进入请求', () => {
    const extra = { ...follow, extra: 'ignored' };
    for (const reference of [{ ...follow, skillKey: '' }, { ...follow, effectKey: ' Upper ' }, extra]) {
      const checked = validateSkillEffectDraft(fixture({ spellShieldFollowResult: reference }), options);
      expect(checked.ok).toBe(false);
      if (checked.ok) throw new Error('本场应拒绝');
      expect(checked.resultErrors[0]!.fieldErrors.spellShieldFollowResult).toContain('合法的技能、效果和结果标识');
    }
  });

  it('脏改比较保留引用变化，服务器子字段错误映射回该声明', () => {
    const before = normalizeResultDraftForDirtyComparison(fixture().results[0]!);
    const after = normalizeResultDraftForDirtyComparison(fixture({ spellShieldFollowResult: { ...follow, resultKey: 'other' } }).results[0]!);
    expect(after).not.toEqual(before);
    expect(mapSkillEffectFieldIssues({ fieldIssues: [
      { field: 'results[0].detail.spellShieldFollowResult.skillKey', message: '跟随技能不匹配' }
    ] }).resultErrors).toEqual([{ index: 0, fieldErrors: { spellShieldFollowResult: '跟随技能不匹配' } }]);
  });
});

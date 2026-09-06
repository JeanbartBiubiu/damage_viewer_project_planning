import { describe, expect, it } from 'vitest';
import { SKILL_TRIGGER_TARGET_CATEGORIES, type SkillTriggerEventSource, type SkillTriggerTargetCategoryCheckDetail } from '../../../../types/skillTriggerRule';
import { allowsTargetCategoryCheck, targetCategoryConditionError, TARGET_CATEGORY_LABELS } from './targetCategoryCondition';
import { analyzeEventSwitchImpact, applyEventSwitchCleanup, conditionSummary, createEmptyConditionDraft, createEmptyRuleDraft, fromDetail, requiredCatalogsForDraft, switchConditionType, toCreateRequest, validateSkillTriggerDraft } from './triggerRuleForm';

const hit: SkillTriggerEventSource = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } };
const makeDraft = (detail: SkillTriggerTargetCategoryCheckDetail = { categories: ['CHAMPION', 'EPIC_MONSTER'] }) => {
  const rule = createEmptyRuleDraft();
  return { ...rule, ruleKey: 'hit_categories', name: '命中类别', eventSource: hit,
    conditionGroups: [{ draftId: 'targets-draft', groupKey: 'targets', name: '目标类别', sortOrder: '0', conditions: [{ ...createEmptyConditionDraft([], 'TARGET_CATEGORY_CHECK'), detail }] }],
    actions: [{ ...rule.actions[0], name: '造成伤害', detail: { effectKey: 'hit_damage' } }] };
};

describe('命中目标类别条件', () => {
  it('五类中文多选与严格类别集合一致', () => {
    expect(SKILL_TRIGGER_TARGET_CATEGORIES.map((category) => TARGET_CATEGORY_LABELS[category])).toEqual(['英雄', '史诗野怪', '小兵', '非史诗野怪', '建筑']);
    expect(conditionSummary(makeDraft().conditionGroups[0].conditions[0])).toBe('命中目标类别 / 英雄、史诗野怪');
  });

  it('新条件无默认类别，切换种类彻底清除旧主体和比较字段', () => {
    const original = createEmptyConditionDraft([], 'ATTRIBUTE_COMPARE');
    const category = switchConditionType(original, 'TARGET_CATEGORY_CHECK');
    expect(category.detail).toEqual({ categories: [] });
    expect(targetCategoryConditionError(category.detail as SkillTriggerTargetCategoryCheckDetail, 'SKILL_HIT')).toContain('至少选择');
    expect(switchConditionType(category, 'LIFECYCLE_CHECK').detail).not.toHaveProperty('categories');
  });

  it.each(['SKILL_HIT', 'BASIC_ATTACK_HIT'] as const)('%s 保存回读仅含类别并保持排序；不增加数值依赖或循环保护', (eventType) => {
    const draft = makeDraft({ categories: ['EPIC_MONSTER', 'CHAMPION', 'STRUCTURE'] });
    draft.eventSource = eventType === 'SKILL_HIT' ? hit : { eventType, detail: {} };
    expect(allowsTargetCategoryCheck(eventType)).toBe(true);
    expect(validateSkillTriggerDraft(draft, { includeRuleKey: true }).ok).toBe(true);
    const request = toCreateRequest(draft);
    expect(request.conditionGroups[0].conditions[0].detail).toEqual({ categories: ['EPIC_MONSTER', 'CHAMPION', 'STRUCTURE'] });
    expect(toCreateRequest(fromDetail(request))).toEqual(request);
    expect(request.perTargetCooldown).toBeNull();
    expect(request.maxTriggersPerProcess).toBeNull();
    expect(requiredCatalogsForDraft(draft)).not.toContain('formulas');
    expect(requiredCatalogsForDraft(draft)).not.toContain('attributes');
  });

  it('响应、草稿和请求的类别数组互不共享', () => {
    const request = toCreateRequest(makeDraft());
    const reopened = fromDetail(request);
    const category = reopened.conditionGroups[0].conditions[0];
    if (category.conditionType !== 'TARGET_CATEGORY_CHECK') throw new Error('expected category');
    category.detail.categories.push('MINION');
    expect(request.conditionGroups[0].conditions[0].detail).toEqual({ categories: ['CHAMPION', 'EPIC_MONSTER'] });
    const next = toCreateRequest(reopened);
    category.detail.categories.push('STRUCTURE');
    expect(next.conditionGroups[0].conditions[0].detail).toEqual({ categories: ['CHAMPION', 'EPIC_MONSTER', 'MINION'] });
  });

  it.each([
    { categories: [] }, { categories: ['CHAMPION', 'CHAMPION'] }, { categories: ['UNKNOWN'] }, { categories: [null] }
  ])('拒绝空、重复或未知类别 %j', (detail) => {
    const unsafe = detail as SkillTriggerTargetCategoryCheckDetail;
    expect(targetCategoryConditionError(unsafe, 'SKILL_HIT')).not.toBeNull();
    expect(validateSkillTriggerDraft(makeDraft(unsafe), { includeRuleKey: true }).ok).toBe(false);
  });

  it.each([
    { eventType: 'SKILL_USED', detail: { sourceSkillKey: null, useKind: 'ANY' } },
    { eventType: 'BASIC_ATTACK_START', detail: {} },
    { eventType: 'DAMAGE_DEALT', detail: { damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY' } }
  ] satisfies SkillTriggerEventSource[])('切到非命中事件 %j 提醒并清理条件，原草稿保持不变', (next) => {
    const draft = makeDraft();
    expect(allowsTargetCategoryCheck(next.eventType)).toBe(false);
    expect(analyzeEventSwitchImpact(draft, next).summary).toContain('将清除命中目标类别条件');
    expect(applyEventSwitchCleanup(draft, next).conditionGroups[0].conditions).toEqual([]);
    expect(draft.conditionGroups[0].conditions).toHaveLength(1);
    expect(validateSkillTriggerDraft({ ...draft, eventSource: next }, { includeRuleKey: true }).ok).toBe(false);
  });

  it('在技能命中和普攻命中之间切换保留类别', () => {
    const draft = makeDraft();
    const next: SkillTriggerEventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
    expect(analyzeEventSwitchImpact(draft, next).summary).toBe('');
    expect(applyEventSwitchCleanup(draft, next).conditionGroups).toEqual(draft.conditionGroups);
  });
});

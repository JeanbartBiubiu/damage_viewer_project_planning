import { describe, expect, it } from 'vitest';
import { fixedValue } from '../../../../types/numericValue';
import type { SkillTriggerEventValueBinding } from '../../../../types/skillTriggerRule';
import { SKILL_TRIGGER_EVENT_TYPES, SKILL_TRIGGER_EVENT_VALUE_LABELS, allowedEventValuesFor, analyzeEventSwitchImpact, applyEventSwitchCleanup, createEmptyConditionDraft, createEmptyEventSource, createEmptyGroupDraft, createEmptyRuleDraft, eventValueOptionLabel, fromDetail, isBindingTypeCompatible, sourceValueDomain, toCreateRequest, validateSkillTriggerDraft } from './triggerRuleForm';

const valueKey = 'SKILL_HIT_SPELL_SHIELD_BLOCKED' as const;
const binding: SkillTriggerEventValueBinding = { bindingKey: 'shield_result', parameterKey: 'blocked', sourceType: 'EVENT_VALUE', detail: { eventValueKey: valueKey } };
const makeDraft = (threshold = 0) => {
  const draft = createEmptyRuleDraft();
  return { ...draft, ruleKey: 'unblocked_hit', name: '未阻挡命中', eventSource: createEmptyEventSource('SKILL_HIT'),
    conditionGroups: [{ ...createEmptyGroupDraft([]), name: '命中判定', conditions: [{ ...createEmptyConditionDraft([], 'EVENT_VALUE_COMPARE'), detail: { eventValueKey: valueKey, comparator: 'EQ' as const, comparisonValue: fixedValue(threshold) } }] }],
    actions: [{ ...draft.actions[0], name: '命中动作', detail: { effectKey: 'damage' }, runtimeInputBindings: [binding] }] };
};

describe('技能命中法术护盾结果', () => {
  it('只在技能命中提供，新旧阻挡值互不替代', () => {
    for (const eventType of SKILL_TRIGGER_EVENT_TYPES) {
      expect(allowedEventValuesFor(createEmptyEventSource(eventType)).includes(valueKey)).toBe(eventType === 'SKILL_HIT');
    }
    expect(allowedEventValuesFor(createEmptyEventSource('SKILL_HIT'))).not.toContain('BLOCKED');
    expect(allowedEventValuesFor(createEmptyEventSource('DAMAGE_DEALT'))).toContain('BLOCKED');
    expect(SKILL_TRIGGER_EVENT_VALUE_LABELS.BLOCKED).toBe('是否被法术护盾阻挡（0/1）');
    expect(eventValueOptionLabel(valueKey)).toBe('技能命中被法术护盾阻挡（否 = 0，是 = 1）');
  });

  it.each(['INTEGER', 'DECIMAL'] as const)('整数事件结果可绑定 %s 参数', (type) => {
    expect(sourceValueDomain(binding)).toBe('INTEGER');
    expect(isBindingTypeCompatible(sourceValueDomain(binding)!, type)).toBe(true);
  });

  it.each([-2, 0, 0.5, 1, 2])('比较取值 %s 沿用现有数值规则，不按布尔结果夹取', (threshold) => {
    const draft = makeDraft(threshold);
    expect(validateSkillTriggerDraft(draft, { includeRuleKey: true }).ok).toBe(true);
    const request = toCreateRequest(draft);
    expect(toCreateRequest(fromDetail(request))).toEqual(request);
    expect(request.conditionGroups[0].conditions[0].detail).toEqual({ eventValueKey: valueKey, comparator: 'EQ', comparisonValue: fixedValue(threshold) });
    expect(request.actions[0].runtimeInputBindings[0]).toEqual(binding);
    expect(request.perTargetCooldown).toBeNull();
    expect(request.maxTriggersPerProcess).toBeNull();
  });

  it.each(['BASIC_ATTACK_HIT', 'DAMAGE_DEALT', 'SKILL_USED'] as const)('切换到 %s 提醒并清除条件及绑定，取消时原草稿不变', (eventType) => {
    const draft = makeDraft();
    const next = createEmptyEventSource(eventType);
    expect(analyzeEventSwitchImpact(draft, next).summary).toContain('技能命中被法术护盾阻挡');
    expect(validateSkillTriggerDraft({ ...draft, eventSource: next }, { includeRuleKey: true }).ok).toBe(false);
    const cleaned = applyEventSwitchCleanup(draft, next);
    expect(cleaned.conditionGroups[0].conditions).toEqual([]);
    expect(cleaned.actions[0].runtimeInputBindings).toEqual([]);
    expect(draft.conditionGroups[0].conditions).toHaveLength(1);
    expect(draft.actions[0].runtimeInputBindings).toEqual([binding]);
  });
});

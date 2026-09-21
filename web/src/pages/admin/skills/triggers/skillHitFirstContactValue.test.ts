import { describe, expect, it } from 'vitest';
import { fixedValue } from '../../../../types/numericValue';
import type { SkillTriggerEventValueBinding } from '../../../../types/skillTriggerRule';
import {
  SKILL_TRIGGER_EVENT_TYPES,
  allowedEventValuesFor,
  analyzeEventSwitchImpact,
  applyEventSwitchCleanup,
  createEmptyConditionDraft,
  createEmptyEventSource,
  createEmptyGroupDraft,
  createEmptyRuleDraft,
  eventValueHint,
  eventValueOptionLabel,
  fromDetail,
  isBindingTypeCompatible,
  patchEventValueCompareDetail,
  sourceValueDomain,
  toCreateRequest,
  validateSkillTriggerDraft
} from './triggerRuleForm';

const valueKey = 'SKILL_HIT_FIRST_CONTACT' as const;
const binding: SkillTriggerEventValueBinding = {
  bindingKey: 'first_contact', parameterKey: 'contact', sourceType: 'EVENT_VALUE',
  detail: { eventValueKey: valueKey }
};

function makeDraft(threshold = 1) {
  const draft = createEmptyRuleDraft();
  return {
    ...draft, ruleKey: 'first_contact', name: '首次目标接触',
    eventSource: createEmptyEventSource('SKILL_HIT'),
    conditionGroups: [{
      ...createEmptyGroupDraft([]), name: '接触判定', conditions: [{
        ...createEmptyConditionDraft([], 'EVENT_VALUE_COMPARE'),
        detail: { eventValueKey: valueKey, comparator: 'EQ' as const, comparisonValue: fixedValue(threshold) }
      }]
    }],
    actions: [{ ...draft.actions[0], name: '命中动作', detail: { effectKey: 'damage' }, runtimeInputBindings: [binding] }]
  };
}

describe('本次使用首次目标接触事件值', () => {
  it('只供技能命中选择，并保留原命中序号与护盾判定', () => {
    for (const eventType of SKILL_TRIGGER_EVENT_TYPES) {
      expect(allowedEventValuesFor(createEmptyEventSource(eventType)).includes(valueKey)).toBe(eventType === 'SKILL_HIT');
    }
    expect(allowedEventValuesFor(createEmptyEventSource('SKILL_HIT'))).toEqual([
      'HIT_INDEX', valueKey, 'SKILL_HIT_SPELL_SHIELD_BLOCKED'
    ]);
    expect(eventValueOptionLabel(valueKey)).toBe('本次使用首次目标接触（首次 = 1，已有前序接触 = 0）');
  });

  it('说明完整历史、缺值及与原命中序号的区别', () => {
    const hint = eventValueHint(valueKey);
    for (const text of ['首次符合目标资格', '完整历史', '不按筛选后的目标重新计数', '零伤害、被阻挡或免疫', '不能用已有实例判断', '不表示已强化', '所属使用、历史或真实先后不明', '动态绑定不能默认填 0 或 1']) {
      expect(hint).toContain(text);
    }
    expect(eventValueHint('HIT_INDEX')).toContain('从 1 开始');
    expect(eventValueHint('HIT_INDEX')).toContain('重复步骤的命中沿用当前步骤执行序号');
    expect(eventValueHint('HIT_INDEX')).toContain('不表示目标接触先后');
  });

  it.each(['INTEGER', 'DECIMAL'] as const)('整数供值可绑定 %s 参数', (type) => {
    expect(sourceValueDomain(binding)).toBe('INTEGER');
    expect(isBindingTypeCompatible(sourceValueDomain(binding)!, type)).toBe(true);
  });

  it.each([-2, 0, 0.5, 1, 2])('条件比较取值 %s 原样保存回填，绑定不写实际值', (threshold) => {
    const draft = makeDraft(threshold);
    expect(validateSkillTriggerDraft(draft, { includeRuleKey: true }).ok).toBe(true);
    const request = toCreateRequest(draft);
    expect(toCreateRequest(fromDetail(request))).toEqual(request);
    expect(request.conditionGroups[0].conditions[0].detail).toEqual({
      eventValueKey: valueKey, comparator: 'EQ', comparisonValue: fixedValue(threshold)
    });
    expect(request.actions[0].runtimeInputBindings[0]).toEqual(binding);
  });

  it('从原命中序号切换到首次接触仍保持比较值未填，并阻止保存', () => {
    const empty = createEmptyConditionDraft([], 'EVENT_VALUE_COMPARE');
    const changed = patchEventValueCompareDetail(empty, { eventValueKey: valueKey });
    expect(empty.detail).toEqual({ eventValueKey: 'HIT_INDEX', comparator: 'EQ', comparisonValue: fixedValue(Number.NaN) });
    expect(changed.detail).toEqual({ eventValueKey: valueKey, comparator: 'EQ', comparisonValue: fixedValue(Number.NaN) });
    const draft = makeDraft();
    draft.conditionGroups[0].conditions = [changed];
    expect(validateSkillTriggerDraft(draft, { includeRuleKey: true }).ok).toBe(false);
  });

  it.each(SKILL_TRIGGER_EVENT_TYPES.filter((eventType) => eventType !== 'SKILL_HIT'))(
    '切换到 %s 清理双路径；未确认前保持原草稿', (eventType) => {
      const draft = makeDraft();
      const next = createEmptyEventSource(eventType);
      const errors = validateSkillTriggerDraft({ ...draft, eventSource: next }, { includeRuleKey: true }).nestedErrors;
      expect(errors.some((error) => error.path === 'conditionGroups[0].conditions[0].detail.eventValueKey')).toBe(true);
      expect(errors.some((error) => error.path === 'actions[0].runtimeInputBindings[0].detail.eventValueKey')).toBe(true);
      expect(analyzeEventSwitchImpact(draft, next).summary).toContain('本次使用首次目标接触');
      const cleaned = applyEventSwitchCleanup(draft, next);
      expect(cleaned.conditionGroups).toEqual([]);
      expect(cleaned.actions[0].runtimeInputBindings).toEqual([]);
      expect(draft.conditionGroups[0].conditions).toHaveLength(1);
      expect(draft.actions[0].runtimeInputBindings).toEqual([binding]);
    }
  );

  it('仍为技能命中时保留双路径', () => {
    const draft = makeDraft();
    const cleaned = applyEventSwitchCleanup(draft, createEmptyEventSource('SKILL_HIT'));
    expect(cleaned.conditionGroups).toEqual(draft.conditionGroups);
    expect(cleaned.actions[0].runtimeInputBindings).toEqual([binding]);
  });
});

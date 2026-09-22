import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../../services/apiClient';
import {
  allowsOncePerUse,
  analyzeEventSwitchImpact,
  applyEventSwitchCleanup,
  createEmptyEventSource,
  createEmptyRuleDraft,
  fromDetail,
  mapTriggerFieldIssues,
  SKILL_TRIGGER_ONCE_PER_USE_CLEAR_MESSAGE,
  SKILL_TRIGGER_ONCE_PER_USE_EVENT_MESSAGE,
  SKILL_TRIGGER_ONCE_PER_USE_EVENTS,
  toCreateRequest,
  toUpdateRequest,
  validateSkillTriggerDraft
} from './triggerRuleForm';
import type { SkillTriggerRuleDetail } from '../../../../types/skillTriggerRule';

function namedDraft() {
  const draft = createEmptyRuleDraft();
  return {
    ...draft,
    ruleKey: 'eclipse_proc',
    name: '星蚀触发',
    eventSource: createEmptyEventSource('SKILL_HIT'),
    actions: [{ ...draft.actions[0], name: '执行伤害', detail: { effectKey: 'eclipse_hit' } }],
    oncePerUseEnabled: true,
    oncePerUseGroupKey: 'eclipse',
    oncePerUseScope: 'SKILL' as const
  };
}

function detail(partial: Partial<SkillTriggerRuleDetail> = {}): SkillTriggerRuleDetail {
  return {
    ruleKey: 'eclipse_proc',
    name: '星蚀触发',
    description: null,
    sortOrder: 0,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } },
    conditionGroups: [],
    actions: [{
      actionKey: 'action_1',
      name: '执行伤害',
      actionType: 'EXECUTE_EFFECT',
      sortOrder: 0,
      targetContext: 'CURRENT_TARGET',
      detail: { effectKey: 'eclipse_hit' },
      runtimeInputBindings: [],
      resultModifiers: []
    }],
    perTargetCooldown: null,
    maxTriggersPerProcess: null,
    oncePerUse: { groupKey: 'eclipse', scope: 'SKILL' },
    ...partial
  };
}

describe('同次使用限制草稿', () => {
  it('默认关闭，不把空对象或推断键写入请求', () => {
    const empty = createEmptyRuleDraft();
    expect(empty.oncePerUseEnabled).toBe(false);
    expect(empty.oncePerUseGroupKey).toBe('');
    expect(empty.oncePerUseScope).toBe('SKILL');
    expect(toCreateRequest(empty).oncePerUse).toBeNull();
  });

  it.each(SKILL_TRIGGER_ONCE_PER_USE_EVENTS)('允许事件 %s 往返保存共享键和范围', (eventType) => {
    expect(allowsOncePerUse(eventType)).toBe(true);
    const source = eventType === 'SKILL_HIT'
      ? createEmptyEventSource('SKILL_HIT')
      : createEmptyEventSource(eventType);
    const created = toCreateRequest({ ...namedDraft(), eventSource: source, oncePerUseScope: 'TARGET' });
    expect(created.oncePerUse).toEqual({ groupKey: 'eclipse', scope: 'TARGET' });
    expect(toUpdateRequest(fromDetail({ ...detail(), eventSource: created.eventSource, oncePerUse: created.oncePerUse })))
      .toMatchObject({ oncePerUse: created.oncePerUse });
    expect(fromDetail({ ...detail(), oncePerUse: null }).oncePerUseEnabled).toBe(false);
  });

  it('关闭后不提交对象，保留草稿键以便重新启用', () => {
    const closed = { ...namedDraft(), oncePerUseEnabled: false };
    expect(toCreateRequest(closed).oncePerUse).toBeNull();
    expect(closed.oncePerUseGroupKey).toBe('eclipse');
  });

  it('非法事件、空键和格式错误阻止保存且不补值', () => {
    expect(validateSkillTriggerDraft({
      ...namedDraft(),
      eventSource: createEmptyEventSource('SKILL_USED')
    }, { includeRuleKey: true })).toMatchObject({
      ok: false,
      fieldErrors: { oncePerUse: SKILL_TRIGGER_ONCE_PER_USE_EVENT_MESSAGE }
    });
    expect(validateSkillTriggerDraft({ ...namedDraft(), oncePerUseGroupKey: '' }, { includeRuleKey: true }))
      .toMatchObject({ ok: false, fieldErrors: { oncePerUse: '共享限制键不能为空。' } });
    expect(validateSkillTriggerDraft({ ...namedDraft(), oncePerUseGroupKey: 'Eclipse' }, { includeRuleKey: true }))
      .toMatchObject({ ok: false, fieldErrors: { oncePerUse: '共享限制键格式不合法。' } });
  });

  it('非法事件切换确认摘要，同意关闭限制，取消路径保持原草稿', () => {
    const draft = namedDraft();
    const next = createEmptyEventSource('SKILL_USED');
    const impact = analyzeEventSwitchImpact(draft, next);
    expect(impact.clearsOncePerUse).toBe(true);
    expect(impact.summary).toBe(SKILL_TRIGGER_ONCE_PER_USE_CLEAR_MESSAGE);
    expect(draft.oncePerUseEnabled).toBe(true);
    expect(draft.eventSource.eventType).toBe('SKILL_HIT');
    const cleaned = applyEventSwitchCleanup(draft, next);
    expect(cleaned.oncePerUseEnabled).toBe(false);
    expect(cleaned.oncePerUseGroupKey).toBe('eclipse');
    expect(cleaned.eventSource.eventType).toBe('SKILL_USED');
    expect(applyEventSwitchCleanup(draft, createEmptyEventSource('BASIC_ATTACK_HIT')).oncePerUseEnabled).toBe(true);
  });

  it('409 字段问题带冲突 ruleKey，不吞掉路径', () => {
    const mapped = mapTriggerFieldIssues(new ApiRequestError(
      '同次使用限制组范围与现有规则冲突',
      409,
      '409.SKILL_TRIGGER_RULE_ONCE_PER_USE_INVALID',
      {
        fieldIssues: [{
          field: 'oncePerUse.scope',
          code: 'ONCE_PER_USE_SCOPE_CONFLICT',
          message: '同技能同一共享限制键的范围必须一致',
          conflictingRuleKey: 'first'
        }]
      }
    ));
    expect(mapped.fieldErrors.oncePerUse).toBe('同技能同一共享限制键的范围必须一致（冲突规则：first）');
    expect(mapped.nestedErrors).toEqual([{
      path: 'oncePerUse.scope',
      message: '同技能同一共享限制键的范围必须一致（冲突规则：first）'
    }]);
    expect(mapped.unmappedMessages).toEqual([]);
    expect(mapped.retainedCode).toBe('409.SKILL_TRIGGER_RULE_ONCE_PER_USE_INVALID');
  });
});

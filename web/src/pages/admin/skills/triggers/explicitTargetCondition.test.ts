import { describe, expect, it } from 'vitest';
import type { SkillTriggerEventSource } from '../../../../types/skillTriggerRule';
import { allowsExplicitTargetIsSource, explicitTargetIsSourceError, explicitTargetIsSourceHelp } from './explicitTargetCondition';
import {
  analyzeEventSwitchImpact,
  applyEventSwitchCleanup,
  conditionSummary,
  createEmptyConditionDraft,
  createEmptyEventSource,
  createEmptyRuleDraft,
  fromDetail,
  switchConditionType,
  toCreateRequest,
  validateSkillTriggerDraft
} from './triggerRuleForm';

const used: SkillTriggerEventSource = {
  eventType: 'SKILL_USED',
  detail: { sourceSkillKey: 'annie_e', useKind: 'ACTIVE' }
};

function makeDraft() {
  const rule = createEmptyRuleDraft();
  return {
    ...rule,
    ruleKey: 'explicit_self_target',
    name: '显式自施',
    eventSource: used,
    conditionGroups: [{
      draftId: 'self-target-group',
      groupKey: 'self_target',
      name: '显式目标为来源对象',
      sortOrder: '10',
      conditions: [createEmptyConditionDraft([], 'EXPLICIT_TARGET_IS_SOURCE')]
    }],
    actions: [{ ...rule.actions[0], name: '执行自身护盾', detail: { effectKey: 'molten_shield' } }]
  };
}

describe('显式目标为来源对象条件', () => {
  it('只允许技能使用事件，并说明无显式目标不匹配', () => {
    expect(allowsExplicitTargetIsSource('SKILL_USED')).toBe(true);
    expect(explicitTargetIsSourceError('SKILL_USED')).toBeNull();
    expect(explicitTargetIsSourceHelp('SKILL_USED')).toContain('无显式目标时不匹配');
    expect(allowsExplicitTargetIsSource('SKILL_HIT')).toBe(false);
    expect(explicitTargetIsSourceError('SKILL_HIT')).toContain('仅用于技能使用事件');
  });

  it('草稿、请求和回读始终使用严格空明细', () => {
    const draft = makeDraft();
    const condition = draft.conditionGroups[0].conditions[0];
    expect(condition.detail).toEqual({});
    expect(conditionSummary(condition)).toBe('显式目标为来源对象');
    expect(validateSkillTriggerDraft(draft, { includeRuleKey: true }).ok).toBe(true);
    const request = toCreateRequest(draft);
    expect(request.conditionGroups[0].conditions[0]).toMatchObject({
      conditionType: 'EXPLICIT_TARGET_IS_SOURCE',
      detail: {}
    });
    expect(toCreateRequest(fromDetail({
      ...request,
      createdAt: '2026-09-17T00:00:00Z',
      updatedAt: '2026-09-17T00:00:00Z'
    }))).toEqual(request);
  });

  it('切换种类会清除旧比较字段', () => {
    const original = createEmptyConditionDraft([], 'ATTRIBUTE_COMPARE');
    const explicit = switchConditionType(original, 'EXPLICIT_TARGET_IS_SOURCE');
    expect(explicit.detail).toEqual({});
    expect(switchConditionType(explicit, 'STATUS_CHECK').detail).not.toHaveProperty('attributeKey');
  });

  it('切换到其他事件会提示并删除因此变空的条件组', () => {
    const draft = makeDraft();
    const next = createEmptyEventSource('SKILL_HIT');
    expect(analyzeEventSwitchImpact(draft, next).summary).toContain('空条件组也会一并清除');
    const cleaned = applyEventSwitchCleanup(draft, next);
    expect(cleaned.conditionGroups).toEqual([]);
    expect(draft.conditionGroups).toHaveLength(1);
  });

  it('不删除同组内仍合法的其他条件', () => {
    const draft = makeDraft();
    draft.conditionGroups[0].conditions.push(createEmptyConditionDraft([], 'ATTRIBUTE_COMPARE'));
    const cleaned = applyEventSwitchCleanup(draft, createEmptyEventSource('SKILL_HIT'));
    expect(cleaned.conditionGroups).toHaveLength(1);
    expect(cleaned.conditionGroups[0].conditions.map((condition) => condition.conditionType)).toEqual(['ATTRIBUTE_COMPARE']);
  });
});

import { describe, expect, it } from 'vitest';
import { fixedValue } from '../../../../types/numericValue';
import type { SkillTriggerEventSource } from '../../../../types/skillTriggerRule';
import {
  allowedEventValuesFor,
  analyzeEventSwitchImpact,
  applyEventSwitchCleanup,
  createEmptyConditionDraft,
  createEmptyEventSource,
  createEmptyRuleDraft,
  fromDetail,
  SKILL_TRIGGER_BASIC_ATTACK_RECEIVED_HINT,
  toCreateRequest,
  validateSkillTriggerDraft,
  type SkillTriggerActionDraft,
  type SkillTriggerRuleDraft
} from './triggerRuleForm';

function receivedDraft(actionType: 'EXECUTE_EFFECT' | 'START_PROCESS' = 'EXECUTE_EFFECT'): SkillTriggerRuleDraft {
  const draft = createEmptyRuleDraft();
  const action: SkillTriggerActionDraft = actionType === 'EXECUTE_EFFECT'
    ? { ...draft.actions[0], name: '执行反应', actionType, targetContext: 'EVENT_SOURCE', detail: { effectKey: 'reaction' } }
    : { ...draft.actions[0], name: '启动反应', actionType, targetContext: 'EVENT_SOURCE', detail: { processKey: 'reaction' } };
  return { ...draft, ruleKey: 'received_reaction', name: '结果前接收',
    eventSource: createEmptyEventSource('BASIC_ATTACK_RECEIVED'), actions: [action] };
}

describe('普通攻击命中接收管理契约', () => {
  it.each(['EXECUTE_EFFECT', 'START_PROCESS'] as const)('%s 沿空明细保存并回读，不生成默认使用身份', (actionType) => {
    const draft = receivedDraft(actionType);
    expect(validateSkillTriggerDraft(draft, { includeRuleKey: true }).ok).toBe(true);
    const request = toCreateRequest(draft);
    expect(request.eventSource).toEqual({ eventType: 'BASIC_ATTACK_RECEIVED', detail: {} });
    expect(request.oncePerUse).toBeNull();
    expect(request.actions[0].targetContext).toBe('EVENT_SOURCE');
    expect(toCreateRequest(fromDetail(request))).toEqual(request);
    expect(allowedEventValuesFor(request.eventSource)).toEqual([]);
    expect(SKILL_TRIGGER_BASIC_ATTACK_RECEIVED_HINT).toContain('逐个结果及吸血结算前');
    expect(SKILL_TRIGGER_BASIC_ATTACK_RECEIVED_HINT).toContain('原攻击者');
  });

  it.each([null, [], 1, { useRef: 'default' }, { sourceSkillKey: 'attacker' }])('拒绝非空对象或非法明细 %j', (detail) => {
    const eventSource = { eventType: 'BASIC_ATTACK_RECEIVED', detail } as unknown as SkillTriggerEventSource;
    expect(validateSkillTriggerDraft({ ...receivedDraft(), eventSource }, { includeRuleKey: true })).toMatchObject({
      ok: false,
      nestedErrors: expect.arrayContaining([expect.objectContaining({ path: 'eventSource.detail' })])
    });
  });

  it('切入时清理旧伤害筛选、事件数值和过程额度，保留合法来源与显式原使用限制', () => {
    const draft: SkillTriggerRuleDraft = {
      ...receivedDraft(),
      eventSource: createEmptyEventSource('DAMAGE_TAKEN'),
      oncePerUseEnabled: true,
      oncePerUseGroupKey: 'original_use',
      oncePerUseScope: 'TARGET',
      maxTriggersPerProcessEnabled: true,
      conditionGroups: [{ draftId: 'damage-draft', groupKey: 'damage', name: '伤害数值', sortOrder: '0',
        conditions: [{ ...createEmptyConditionDraft([], 'EVENT_VALUE_COMPARE'),
          detail: { eventValueKey: 'RAW_DAMAGE', comparator: 'GT', comparisonValue: fixedValue(0) } }] }],
      actions: [{ ...receivedDraft().actions[0], runtimeInputBindings: [{
        bindingKey: 'damage_amount', parameterKey: 'damage_amount', sourceType: 'EVENT_VALUE',
        detail: { eventValueKey: 'RAW_DAMAGE' }
      }] }],
      perTargetCooldownEnabled: true,
      perTargetCooldownDurationValue: fixedValue(100),
      perTargetCooldownTargetContext: 'EVENT_SOURCE'
    };
    const next = createEmptyEventSource('BASIC_ATTACK_RECEIVED');
    expect(analyzeEventSwitchImpact(draft, next)).toMatchObject({
      clearsEventValues: true, clearsProcessLimit: true, clearsEventSourceRefs: false, clearsOncePerUse: false
    });
    const cleaned = applyEventSwitchCleanup(draft, next);
    expect(cleaned.eventSource).toEqual(next);
    expect(cleaned.conditionGroups).toEqual([]);
    expect(cleaned.actions[0].runtimeInputBindings).toEqual([]);
    expect(cleaned.actions[0].targetContext).toBe('EVENT_SOURCE');
    expect(cleaned.perTargetCooldownTargetContext).toBe('EVENT_SOURCE');
    expect(cleaned.maxTriggersPerProcessEnabled).toBe(false);
    expect(toCreateRequest(cleaned).oncePerUse).toEqual({ groupKey: 'original_use', scope: 'TARGET' });
    expect(draft.actions[0].runtimeInputBindings).toHaveLength(1);
    expect(draft.maxTriggersPerProcessEnabled).toBe(true);

    const noEventSource = applyEventSwitchCleanup(cleaned, createEmptyEventSource('HIT_LINK_APPLIED'));
    expect(noEventSource.actions[0].targetContext).toBe('CURRENT_TARGET');
    expect(noEventSource.perTargetCooldownTargetContext).toBe('CURRENT_TARGET');
    expect(noEventSource.oncePerUseEnabled).toBe(true);
    expect(applyEventSwitchCleanup(cleaned, createEmptyEventSource('PROCESS_MOMENT')).oncePerUseEnabled).toBe(false);
  });
});

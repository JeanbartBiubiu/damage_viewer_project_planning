import { describe, expect, it } from 'vitest';
import { fixedValue } from '../types/numericValue';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import { parseSkillTriggerRuleDetail, SkillTriggerRuleProtocolError } from './skillTriggerRuleClient';

function detail(): SkillTriggerRuleDetail {
  return { ruleKey: 'ensure_short_mark', name: '确保目标标记余时', description: null, sortOrder: 0,
    eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'sample_r', useKind: 'ACTIVE', castPhase: 'INITIAL' } },
    conditionGroups: [{ groupKey: 'short', name: '短标记', sortOrder: 0, conditions: [
      { conditionKey: 'remaining', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 0,
        detail: { stateSkillKey: 'sample_p', stateKey: 'mark', valueKind: 'REMAINING_MS', comparator: 'LT', comparisonValue: fixedValue(1000),
          optionKey: null, expectedBoolean: null } }
    ] }], actions: [{ actionKey: 'ensure', name: '确保余时', actionType: 'MODIFY_INTERNAL_STATE', sortOrder: 0,
      targetContext: 'CURRENT_TARGET', detail: { stateSkillKey: 'sample_p', stateKey: 'mark', operation: 'ENSURE_REMAINING', value: fixedValue(1250) },
      runtimeInputBindings: [], resultModifiers: [] }], perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null };
}

function action(rule: SkillTriggerRuleDetail) {
  const result = rule.actions[0]!;
  if (result.actionType !== 'MODIFY_INTERNAL_STATE') throw new Error('需要内部状态动作');
  return result;
}

describe('目标计数余时管理接口协议', () => {
  it('完整回读P状态、R首次主动使用和CURRENT_TARGET，不填补归属或数值', () => {
    const rule = detail();
    expect(parseSkillTriggerRuleDetail(rule)).toEqual(rule);
  });

  it.each([0, -1, .5, Number.MAX_SAFE_INTEGER + 1])('拒绝非法固定动作毫秒%s', value => {
    const rule = detail(); action(rule).detail.value = fixedValue(value);
    expect(() => parseSkillTriggerRuleDetail(rule)).toThrow(SkillTriggerRuleProtocolError);
  });

  it('拒绝非首次主动使用、空来源、错误目标、额外字段、绑定和修正', () => {
    const mutations: Array<(rule: SkillTriggerRuleDetail) => void> = [
      rule => { rule.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} }; },
      rule => { if (rule.eventSource.eventType === 'SKILL_USED') rule.eventSource.detail.useKind = 'ANY'; },
      rule => { if (rule.eventSource.eventType === 'SKILL_USED') rule.eventSource.detail.castPhase = 'RECAST'; },
      rule => { if (rule.eventSource.eventType === 'SKILL_USED') rule.eventSource.detail.sourceSkillKey = null; },
      rule => { action(rule).targetContext = 'EVENT_SOURCE'; },
      rule => { action(rule).detail.stateSkillKey = ''; },
      rule => { action(rule).detail.stateKey = ''; },
      rule => { Object.assign(action(rule).detail, { unexpected: true }); },
      rule => { Object.assign(action(rule).detail, { operation: 'EXTEND' }); },
      rule => { Object.assign(action(rule), { runtimeInputBindings: [{}] }); },
      rule => { Object.assign(action(rule), { resultModifiers: [{}] }); }
    ];
    for (const mutate of mutations) {
      const rule = detail(); mutate(rule);
      expect(() => parseSkillTriggerRuleDetail(rule)).toThrow(SkillTriggerRuleProtocolError);
    }
  });

  it('旧回充减时继续接受普攻命中及事件来源自身，不混用确保余时目标', () => {
    const rule = detail();
    rule.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
    rule.conditionGroups = [];
    action(rule).detail.operation = 'REDUCE_RECOVERY';
    action(rule).detail.value = fixedValue(0);
    action(rule).targetContext = 'EVENT_SOURCE';
    expect(parseSkillTriggerRuleDetail(rule)).toEqual(rule);
    action(rule).targetContext = 'CURRENT_TARGET';
    expect(() => parseSkillTriggerRuleDetail(rule)).toThrow(SkillTriggerRuleProtocolError);
  });
});

import { describe, expect, it } from 'vitest';
import { fixedValue, parameterValue } from '../../../../types/numericValue';
import type { SkillInternalState } from '../../../../types/skillInternalState';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillTriggerRuleDetail } from '../../../../types/skillTriggerRule';
import { parseSkillTriggerRuleDetail } from '../../../../services/skillTriggerRuleClient';
import { actionSummary, applyEventSwitchCleanup, conditionSummary, fromDetail, modifyInternalStateActionError,
  targetCounterMillisecondsError, targetCounterRemainingStateError, toUpdateRequest, validateSkillTriggerDraft,
  valueKindsForInternalState } from './triggerRuleForm';

const mark: SkillInternalState = { gameId: 'test', skillKey: 'sample_p', stateKey: 'mark', name: '目标标记',
  stateType: 'COUNTER', scope: 'TARGET', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
  detail: { initialValue: fixedValue(0), maxValue: fixedValue(1), durationValue: fixedValue(6000) } };

function detail(): SkillTriggerRuleDetail {
  return { ruleKey: 'ensure_mark', name: '确保短标记余时', description: null, sortOrder: 0,
    eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'sample_r', useKind: 'ACTIVE', castPhase: 'INITIAL' } },
    conditionGroups: [{ groupKey: 'short', name: '短标记', sortOrder: 0, conditions: [
      { conditionKey: 'remaining', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 0,
        detail: { stateSkillKey: 'sample_p', stateKey: 'mark', valueKind: 'REMAINING_MS', comparator: 'LT', comparisonValue: fixedValue(1000),
          optionKey: null, expectedBoolean: null } }
    ] }], actions: [{ actionKey: 'ensure', name: '确保余时', actionType: 'MODIFY_INTERNAL_STATE', sortOrder: 0,
      targetContext: 'CURRENT_TARGET', detail: { stateSkillKey: 'sample_p', stateKey: 'mark', operation: 'ENSURE_REMAINING', value: fixedValue(1250) },
      runtimeInputBindings: [], resultModifiers: [] }], perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null };
}

function draft() { return fromDetail(detail(), 'sample_p'); }
function validate(value = draft()) {
  return validateSkillTriggerDraft(value, { includeRuleKey: false, skillKey: 'sample_p', parameters: [],
    formulasByKey: new Map(), statesByKey: new Map([['mark', mark]]) });
}

describe('目标计数余时管理表单', () => {
  it('既有数据回填、编辑确认和保存保留新操作、目标上下文及精确毫秒', () => {
    const value = draft();
    expect(validate(value).ok).toBe(true);
    const action = value.actions[0]!;
    if (action.actionType !== 'MODIFY_INTERNAL_STATE') throw new Error('需要状态动作');
    expect(modifyInternalStateActionError(action, value.eventSource, 'sample_p', mark)).toBeUndefined();
    const request = toUpdateRequest(value);
    expect(request.actions).toEqual(detail().actions);
    expect(parseSkillTriggerRuleDetail({ ...request, ruleKey: 'ensure_mark' })).toEqual(detail());
    expect(actionSummary(action)).toContain('确保至少剩余毫秒');
    expect(conditionSummary(value.conditionGroups[0]!.conditions[0]!)).toContain('剩余毫秒');
    expect(applyEventSwitchCleanup(value, { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'other_r', useKind: 'ACTIVE', castPhase: 'INITIAL' } })
      .actions[0]!.targetContext).toBe('CURRENT_TARGET');
  });

  it('目标计数明确核定有限期限后才提供余时取值，保留旧内部冷却和攻击开始值选项', () => {
    expect(valueKindsForInternalState('COUNTER')).toEqual(['VALUE']);
    expect(valueKindsForInternalState('COUNTER', false, true)).toEqual(['VALUE', 'REMAINING_MS']);
    expect(valueKindsForInternalState('COUNTER', true)).toEqual(['VALUE', 'ATTACK_START_VALUE']);
    expect(valueKindsForInternalState('INTERNAL_COOLDOWN')).toEqual(['REMAINING_MS']);
    expect(targetCounterRemainingStateError(mark, 'sample_p', 'sample_p')).toBeUndefined();
    expect(targetCounterRemainingStateError({ ...mark, scope: 'SKILL' }, 'sample_p', 'sample_p')).toBeTruthy();
    expect(targetCounterRemainingStateError(mark, 'other_p', 'sample_p')).toBeTruthy();
    expect(targetCounterRemainingStateError({ ...mark, detail: { ...mark.detail, durationValue: null } }, 'sample_p', 'sample_p')).toBeTruthy();
  });

  it.each([0, -1, .5, Number.MAX_SAFE_INTEGER + 1])('保存前拒绝非法动作毫秒%s', amount => {
    const value = draft(); const action = value.actions[0]!;
    if (action.actionType !== 'MODIFY_INTERNAL_STATE') throw new Error('需要状态动作');
    action.detail.value = fixedValue(amount);
    expect(validate(value).ok).toBe(false);
  });

  it.each([-1, .5, Number.MAX_SAFE_INTEGER + 1])('保存前拒绝非法比较毫秒%s，零毫秒比较合法', amount => {
    const value = draft(); const condition = value.conditionGroups[0]!.conditions[0]!;
    if (condition.conditionType !== 'INTERNAL_STATE_CHECK') throw new Error('需要状态条件');
    condition.detail.comparisonValue = fixedValue(amount);
    expect(validate(value).ok).toBe(false);
    condition.detail.comparisonValue = fixedValue(0);
    expect(validate(value).ok).toBe(true);
  });

  it('拒绝运行输入参数、越界等级参数、错误事件、外部归属、目标与附加绑定或修正', () => {
    const parameter: SkillParameter = { gameId: 'test', skillKey: 'sample_p', parameterKey: 'ms', name: '时间',
      valueType: 'INTEGER', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null,
      description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
    expect(targetCounterMillisecondsError(parameterValue('ms'), { parameters: [parameter] }, true)).toBeTruthy();
    expect(targetCounterMillisecondsError(parameterValue('ms'), { parameters: [{ ...parameter, valueMode: 'SKILL_LEVEL',
      levelValues: { '1': 1250, '2': Number.MAX_SAFE_INTEGER + 1 } }] }, true)).toBeTruthy();
    const mutations: Array<(value: ReturnType<typeof draft>) => void> = [
      value => { if (value.eventSource.eventType === 'SKILL_USED') value.eventSource.detail.castPhase = 'RECAST'; },
      value => { if (value.eventSource.eventType === 'SKILL_USED') value.eventSource.detail.sourceSkillKey = null; },
      value => { value.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} }; },
      value => { const action = value.actions[0]!; if (action.actionType === 'MODIFY_INTERNAL_STATE') action.detail.stateSkillKey = 'other_p'; },
      value => { value.actions[0]!.targetContext = 'EVENT_SOURCE'; },
      value => { Object.assign(value.actions[0]!, { resultModifiers: [{}] }); },
      value => { value.actions[0]!.runtimeInputBindings.push({ bindingKey: 'extra', parameterKey: 'ms',
        sourceType: 'COMBAT_ELAPSED_TIME', detail: { subject: 'SOURCE' } }); }
    ];
    for (const mutate of mutations) { const value = draft(); mutate(value); expect(validate(value).ok).toBe(false); }
  });
});

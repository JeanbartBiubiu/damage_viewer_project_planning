import { describe, expect, it } from 'vitest';
import { parseSkillTriggerRuleDetail, SkillTriggerRuleProtocolError } from '../../../../services/skillTriggerRuleClient';
import { fixedValue } from '../../../../types/numericValue';
import type { SkillEffect } from '../../../../types/skillEffect';
import type { SkillProcess } from '../../../../types/skillProcess';
import {
  SKILL_TRIGGER_ADVANCE_PROCESS_EVENT_MESSAGE,
  SKILL_TRIGGER_ADVANCE_PROCESS_STEP_MESSAGE,
  SKILL_TRIGGER_CAST_PHASE_PENDING_LABEL,
  SKILL_TRIGGER_CAST_PHASE_REQUIRED_MESSAGE,
  SKILL_TRIGGER_START_PROCESS_PHASE_MESSAGE,
  actionSummary,
  applyEventSwitchCleanup,
  createEmptyActionDraft,
  createEmptyEventSource,
  createEmptyRuleDraft,
  fromDetail,
  processMomentLabel,
  switchActionType,
  toCreateRequest,
  validateSkillTriggerDraft
} from './triggerRuleForm';

const STAMP = { gameId: 'lol', skillKey: 'varus_w', createdAt: '', updatedAt: '' };
const EFFECT: SkillEffect = {
  ...STAMP,
  effectKey: 'on_hit',
  name: '命中',
  description: null,
  sortOrder: 0,
  lifecycle: null,
  results: []
};
const PROCESS: SkillProcess = {
  ...STAMP,
  processKey: 'primary_cast',
  name: '主要施放',
  activationType: 'ACTIVE',
  description: null,
  sortOrder: 10,
  cooldown: null,
  steps: [
    {
      stepKey: 'recast',
      name: '重施',
      description: null,
      sortOrder: 10,
      stepType: 'RECAST',
      detail: { windowValue: fixedValue(1000), maximumRecastCountValue: fixedValue(1) }
    },
    {
      stepKey: 'charge',
      name: '蓄力',
      description: null,
      sortOrder: 20,
      stepType: 'CHARGE',
      detail: {
        minimumChargeValue: fixedValue(0),
        maximumChargeValue: fixedValue(1000),
        releaseAtMaximum: true
      }
    }
  ],
  effectBindings: [],
  stateOperations: []
};
const PASSIVE: SkillProcess = { ...PROCESS, processKey: 'passive_aura', activationType: 'PASSIVE', steps: [] };

function executeAction() {
  return {
    ...createEmptyActionDraft([], 'EXECUTE_EFFECT'),
    actionKey: 'apply',
    name: '执行',
    detail: { effectKey: 'on_hit' }
  };
}

function used(overrides: Partial<{ sourceSkillKey: string | null; castPhase: 'INITIAL' | 'RECAST' | 'CHARGE_RELEASE' | null }> = {}) {
  return {
    eventType: 'SKILL_USED' as const,
    detail: {
      sourceSkillKey: 'varus_w',
      useKind: 'ACTIVE' as const,
      castPhase: 'INITIAL' as const,
      ...overrides
    }
  };
}

function options() {
  return {
    includeRuleKey: true,
    skillKey: 'varus_w',
    catalogStates: { effects: 'ready' as const, processes: 'ready' as const, skills: 'ready' as const },
    effectsByKey: new Map([['on_hit', EFFECT]]),
    processesByKey: new Map([['primary_cast', PROCESS], ['passive_aura', PASSIVE]])
  };
}

function ruleBody(eventSource: unknown, actions: unknown[]): Record<string, unknown> {
  return {
    ruleKey: 'used_rule',
    name: '使用规则',
    description: null,
    sortOrder: 10,
    eventSource,
    conditionGroups: [],
    actions,
    perTargetCooldown: null,
    maxTriggersPerProcess: null,
    oncePerUse: null
  };
}

const executeResponseAction = {
  actionKey: 'apply',
  name: '执行',
  actionType: 'EXECUTE_EFFECT',
  sortOrder: 10,
  targetContext: 'CURRENT_TARGET',
  detail: { effectKey: 'on_hit' },
  runtimeInputBindings: [],
  resultModifiers: []
};

describe('技能使用阶段', () => {
  it('旧详情缺阶段可读为待核定，新建为空，提交必填且不能默认首次', () => {
    const parsed = parseSkillTriggerRuleDetail(ruleBody(
      { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'varus_w', useKind: 'ACTIVE' } },
      [executeResponseAction]
    ));
    expect(parsed.eventSource).toEqual(used({ castPhase: null }));
    expect(fromDetail(parsed).eventSource.detail.castPhase).toBeNull();
    expect(SKILL_TRIGGER_CAST_PHASE_PENDING_LABEL).toBe('使用阶段待核定');
    expect(createEmptyEventSource('SKILL_USED').detail.castPhase).toBeNull();
    const draft = createEmptyRuleDraft();
    draft.ruleKey = 'used_rule';
    draft.name = '只改名称';
    draft.actions = [executeAction()];
    const missing = validateSkillTriggerDraft(draft, options());
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('expected invalid');
    expect(missing.nestedErrors).toContainEqual(expect.objectContaining({
      path: 'eventSource.detail.castPhase',
      message: SKILL_TRIGGER_CAST_PHASE_REQUIRED_MESSAGE
    }));
    draft.eventSource = used({ castPhase: 'INITIAL' });
    expect(validateSkillTriggerDraft(draft, options()).ok).toBe(true);
    expect(toCreateRequest(draft).eventSource.detail.castPhase).toBe('INITIAL');
  });

  it('外来字段和非法枚举仍拒绝，缺阶段不会放松其他协议', () => {
    for (const eventSource of [
      { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'varus_w', castPhase: 'INITIAL' } },
      { eventType: 'PROCESS_MOMENT', detail: { processKey: 'primary_cast', castPhase: 'RECAST',
        moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } } }
    ]) {
      expect(() => parseSkillTriggerRuleDetail(ruleBody(eventSource, [executeResponseAction])))
        .toThrow(SkillTriggerRuleProtocolError);
    }
    expect(() => parseSkillTriggerRuleDetail(ruleBody(
      { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'varus_w', useKind: 'ACTIVE', extra: true } },
      [executeResponseAction]
    ))).toThrow(SkillTriggerRuleProtocolError);
    expect(() => parseSkillTriggerRuleDetail(ruleBody(
      { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'varus_w', useKind: 'ACTIVE', castPhase: 'FIRST' } },
      [executeResponseAction]
    ))).toThrow(SkillTriggerRuleProtocolError);
    expect(() => parseSkillTriggerRuleDetail(ruleBody(
      { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'varus_w', castPhase: 'INITIAL' } },
      [executeResponseAction]
    ))).toThrow(SkillTriggerRuleProtocolError);
  });
});

describe('推进当前过程与启动过程阶段约束', () => {
  it('再次施放匹配重施步骤，蓄力释放匹配蓄力步骤，外壳与令过程失败相同', () => {
    const draft = createEmptyRuleDraft();
    draft.ruleKey = 'advance_rule';
    draft.name = '推进';
    draft.eventSource = used({ castPhase: 'RECAST' });
    draft.actions = [{
      ...createEmptyActionDraft([], 'ADVANCE_PROCESS'),
      actionKey: 'advance',
      name: '推进重施',
      detail: { processKey: 'primary_cast', stepKey: 'recast' }
    }];
    expect(validateSkillTriggerDraft(draft, options()).ok).toBe(true);
    expect(toCreateRequest(draft).actions[0]).toMatchObject({
      actionType: 'ADVANCE_PROCESS',
      targetContext: null,
      runtimeInputBindings: [],
      resultModifiers: [],
      detail: { processKey: 'primary_cast', stepKey: 'recast' }
    });
    draft.actions[0].runtimeInputBindings = [{ bindingKey: 'unexpected', parameterKey: 'input',
      sourceType: 'INTERNAL_STATE', detail: { stateKey: 'state', valueKind: 'VALUE', optionKey: null } }];
    expect(validateSkillTriggerDraft(draft, options()).ok).toBe(false);
    draft.actions[0].runtimeInputBindings = [];
    expect(actionSummary(draft.actions[0])).toContain('推进当前过程');
    draft.eventSource = used({ castPhase: 'CHARGE_RELEASE' });
    draft.actions[0] = { ...draft.actions[0], detail: { processKey: 'primary_cast', stepKey: 'charge' } };
    expect(validateSkillTriggerDraft(draft, options()).ok).toBe(true);
    draft.actions[0] = { ...draft.actions[0], detail: { processKey: 'primary_cast', stepKey: 'recast' } };
    const mismatched = validateSkillTriggerDraft(draft, options());
    expect(mismatched.ok).toBe(false);
    if (mismatched.ok) throw new Error('expected invalid');
    expect(mismatched.nestedErrors.some((item) => item.message === SKILL_TRIGGER_ADVANCE_PROCESS_STEP_MESSAGE)).toBe(true);
  });

  it('未明确当前技能、首次阶段、被动过程和其他事件都不能保存推进', () => {
    const draft = createEmptyRuleDraft();
    draft.ruleKey = 'advance_rule';
    draft.name = '推进';
    draft.actions = [{
      ...switchActionType(createEmptyActionDraft([], 'EXECUTE_EFFECT'), 'ADVANCE_PROCESS'),
      actionKey: 'advance',
      name: '推进',
      detail: { processKey: 'primary_cast', stepKey: 'recast' }
    }];
    draft.eventSource = used({ sourceSkillKey: null, castPhase: 'RECAST' });
    expect(validateSkillTriggerDraft(draft, options()).ok).toBe(false);
    draft.eventSource = used({ sourceSkillKey: 'other_q', castPhase: 'RECAST' });
    expect(validateSkillTriggerDraft(draft, options()).nestedErrors.some((item) => (
      item.message === SKILL_TRIGGER_ADVANCE_PROCESS_EVENT_MESSAGE
    ))).toBe(true);
    draft.eventSource = used({ castPhase: 'INITIAL' });
    expect(validateSkillTriggerDraft(draft, options()).ok).toBe(false);
    draft.eventSource = used({ castPhase: 'RECAST' });
    draft.actions[0] = { ...draft.actions[0], detail: { processKey: 'passive_aura', stepKey: 'recast' } };
    expect(validateSkillTriggerDraft(draft, options()).ok).toBe(false);
    draft.eventSource = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'varus_w' } };
    draft.actions[0] = { ...draft.actions[0], detail: { processKey: 'primary_cast', stepKey: 'recast' } };
    expect(validateSkillTriggerDraft(draft, options()).ok).toBe(false);
  });

  it('已核定的技能使用只有首次可以启动过程，其他事件的既有启动仍合法', () => {
    const draft = createEmptyRuleDraft();
    draft.ruleKey = 'start_rule';
    draft.name = '启动';
    draft.actions = [{
      ...createEmptyActionDraft([], 'START_PROCESS'),
      actionKey: 'start',
      name: '启动',
      detail: { processKey: 'primary_cast' }
    }];
    draft.eventSource = used({ castPhase: 'INITIAL' });
    expect(validateSkillTriggerDraft(draft, options()).ok).toBe(true);
    draft.eventSource = used({ castPhase: 'RECAST' });
    const recast = validateSkillTriggerDraft(draft, options());
    expect(recast.ok).toBe(false);
    if (recast.ok) throw new Error('expected invalid');
    expect(recast.nestedErrors).toContainEqual(expect.objectContaining({
      message: SKILL_TRIGGER_START_PROCESS_PHASE_MESSAGE
    }));
    draft.eventSource = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'varus_w' } };
    expect(validateSkillTriggerDraft(draft, options()).ok).toBe(true);
  });

  it('推进动作协议拒绝外壳字段和外来明细', () => {
    const action = {
      actionKey: 'advance',
      name: '推进',
      actionType: 'ADVANCE_PROCESS',
      sortOrder: 10,
      targetContext: null,
      detail: { processKey: 'primary_cast', stepKey: 'recast' },
      runtimeInputBindings: [],
      resultModifiers: []
    };
    expect(parseSkillTriggerRuleDetail(ruleBody(used({ castPhase: 'RECAST' }), [action])).actions[0].actionType).toBe('ADVANCE_PROCESS');
    expect(() => parseSkillTriggerRuleDetail(ruleBody(used({ castPhase: 'RECAST' }), [{
      ...action,
      targetContext: 'CURRENT_TARGET'
    }]))).toThrow(SkillTriggerRuleProtocolError);
    expect(() => parseSkillTriggerRuleDetail(ruleBody(used({ castPhase: 'RECAST' }), [{
      ...action,
      detail: { processKey: 'primary_cast', stepKey: 'recast', extra: true }
    }]))).toThrow(SkillTriggerRuleProtocolError);
  });
});

describe('过程失败原因摘要', () => {
  it('只有失败时点展示原因，主动取消与不限原因分开', () => {
    expect(processMomentLabel({ momentType: 'PROCESS_FAILURE', stepKey: null, failureReason: 'ACTIVE_CANCELLED' }))
      .toBe('过程失败 / 主动取消');
    expect(processMomentLabel({ momentType: 'PROCESS_FAILURE', stepKey: null, failureReason: null }))
      .toBe('过程失败 / 不限原因');
    expect(processMomentLabel({ momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null }))
      .toBe('过程完成');
  });
});

describe('过程完成与失败切换保留仍合法的来源消耗绑定', () => {
  it('完成与失败互相切换不清除绑定，切到开始才清除', () => {
    const binding = {
      bindingKey: 'cost',
      parameterKey: 'source_cost',
      sourceType: 'SOURCE_CAST_RESOURCE_COST' as const,
      detail: { attributeKey: 'mana' }
    };
    const draft = createEmptyRuleDraft();
    draft.eventSource = {
      eventType: 'PROCESS_MOMENT',
      detail: { processKey: 'primary_cast', moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } }
    };
    draft.actions = [{ ...executeAction(), runtimeInputBindings: [binding] }];
    const failure = {
      eventType: 'PROCESS_MOMENT' as const,
      detail: {
        processKey: 'primary_cast',
        moment: { momentType: 'PROCESS_FAILURE' as const, stepKey: null, failureReason: null }
      }
    };
    expect(applyEventSwitchCleanup(draft, failure, null, [PROCESS]).actions[0].runtimeInputBindings).toEqual([binding]);
    const start = {
      eventType: 'PROCESS_MOMENT' as const,
      detail: {
        processKey: 'primary_cast',
        moment: { momentType: 'PROCESS_START' as const, stepKey: null, failureReason: null }
      }
    };
    expect(applyEventSwitchCleanup(draft, start, null, [PROCESS]).actions[0].runtimeInputBindings).toEqual([]);
  });
});

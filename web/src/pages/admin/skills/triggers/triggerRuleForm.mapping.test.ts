import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../../services/apiClient';
import type { SkillEffect, SkillEffectResult } from '../../../../types/skillEffect';
import type { SkillFormula } from '../../../../types/skillFormula';
import type { SkillInternalState } from '../../../../types/skillInternalState';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillProcess } from '../../../../types/skillProcess';
import type {
  SkillTriggerProcessFailureReason,
  SkillTriggerRuleDetail
} from '../../../../types/skillTriggerRule';
import {
  INCOMPLETE_CATALOG_MESSAGE,
  SKILL_TRIGGER_CYCLE_HINT,
  SKILL_TRIGGER_CYCLE_MESSAGE,
  SKILL_TRIGGER_FAIL_PROCESS_LAST_MESSAGE,
  analyzeEventSwitchImpact,
  applyEventSwitchCleanup,
  createEmptyActionDraft,
  createEmptyBinding,
  createEmptyConditionDraft,
  createEmptyEventSource,
  createEmptyGroupDraft,
  createEmptyRuleDraft,
  cyclePathItems,
  formatCyclePath,
  fromDetail,
  mapTriggerFieldIssues,
  nestedErrorFor,
  toCreateRequest,
  toUpdateRequest,
  validateSkillTriggerDraft,
  type SkillTriggerActionDraft,
  type SkillTriggerExecuteEffectActionDraft,
  type SkillTriggerRuleDraft
} from './triggerRuleForm';

const STAMP = {
  gameId: 'lol',
  skillKey: 'ashe_q',
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z'
} as const;

function parameter(overrides: Pick<SkillParameter, 'parameterKey' | 'name' | 'valueType' | 'valueMode'>): SkillParameter {
  return {
    ...STAMP,
    fixedValue: null,
    levelValues: null,
    description: null,
    sortOrder: 10,
    ...overrides
  };
}

function formula(formulaKey: string, parameterKey: string): SkillFormula {
  return {
    ...STAMP,
    formulaKey,
    name: formulaKey,
    description: null,
    sortOrder: 10,
    expression: { nodeType: 'PARAMETER', parameterKey }
  };
}

function damageResult(resultKey: string, formulaKey: string): SkillEffectResult {
  return {
    resultKey,
    name: resultKey,
    resultType: 'DAMAGE',
    target: 'TARGET',
    description: null,
    sortOrder: 10,
    lifecycleBehavior: null,
    valueRule: { formulaKey, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
    detail: {
      damageTypeKey: 'physical',
      deliveryKind: 'SKILL',
      originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierFormulaKey: null },
      vampRules: []
    }
  };
}

function effect(effectKey: string, results: SkillEffectResult[], lifecycle: SkillEffect['lifecycle'] = null): SkillEffect {
  return {
    ...STAMP,
    effectKey,
    name: effectKey,
    description: null,
    sortOrder: 10,
    lifecycle,
    results
  };
}

function executeAction(
  actionKey: string,
  effectKey: string,
  sortOrder: string,
  bindings: SkillTriggerExecuteEffectActionDraft['runtimeInputBindings'] = []
): SkillTriggerExecuteEffectActionDraft {
  return {
    ...createEmptyActionDraft([], 'EXECUTE_EFFECT'),
    actionKey,
    name: actionKey,
    sortOrder,
    detail: { effectKey },
    runtimeInputBindings: bindings,
    resultModifiers: []
  };
}

function namedDraft(ruleKey: string, name: string, overrides: Partial<SkillTriggerRuleDraft> = {}): SkillTriggerRuleDraft {
  return {
    ...createEmptyRuleDraft(),
    ruleKey,
    name,
    sortOrder: '10',
    ...overrides
  };
}

const HIT_EFFECT = effect('on_hit_damage', [damageResult('damage', 'hit_scale')]);
const DETONATE_EFFECT = effect('detonate_damage', [damageResult('burst', 'detonate_scale')]);
const REMOVE_EFFECT = effect('remove_focus_mark', [
  {
    resultKey: 'remove_mark',
    name: '移除标记',
    resultType: 'LIFECYCLE_OPERATION',
    target: 'TARGET',
    description: null,
    sortOrder: 10,
    lifecycleBehavior: null,
    valueRule: null,
    detail: { targetEffectKey: 'focus_mark', operation: 'REMOVE' }
  }
]);
const SHIELD_EFFECT = effect('emergency_shield', [
  {
    resultKey: 'shield',
    name: '护盾',
    resultType: 'NORMAL_SHIELD',
    target: 'SOURCE',
    description: null,
    sortOrder: 10,
    lifecycleBehavior: null,
    valueRule: { formulaKey: 'shield_value', fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: {}
  }
]);
const EMPOWER_EFFECT = effect('empowered_hit', [damageResult('bonus', 'empower_scale')]);
const FOLLOW_EFFECT = effect('follow_damage', [damageResult('damage', 'follow_up')]);

const READY_FLAG: SkillInternalState = {
  ...STAMP,
  stateKey: 'focus_ready',
  name: '专注已准备',
  stateType: 'FLAG',
  scope: 'SKILL',
  description: null,
  sortOrder: 10,
  detail: { initialEnabled: false }
};

const CONSUME_PROCESS: SkillProcess = {
  ...STAMP,
  processKey: 'consume_focus',
  name: '消费专注',
  activationType: 'PASSIVE',
  description: null,
  sortOrder: 10,
  cooldown: null,
  steps: [
    {
      stepKey: 'hit',
      name: '命中',
      description: null,
      sortOrder: 10,
      stepType: 'EMPOWERED_BASIC_ATTACK',
      detail: { windowFormulaKey: 'empower_window_ms', consumeMoment: 'ATTACK_HIT' }
    }
  ],
  effectBindings: [],
  stateOperations: [
    {
      operationKey: 'disable_ready',
      name: '关闭准备',
      stateKey: 'focus_ready',
      operation: 'DISABLE',
      valueFormulaKey: null,
      optionKey: null,
      moment: { momentType: 'PROCESS_START', stepKey: null },
      sortOrder: 10
    }
  ]
};

function expectValid(draft: SkillTriggerRuleDraft, includeRuleKey = true) {
  const result = validateSkillTriggerDraft(draft, { includeRuleKey });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected valid draft: ${JSON.stringify(result)}`);
  }
  return result.normalized;
}

describe('event-switch cleanup of event values, target contexts and process limit', () => {
  it('analyzes and clears stale event-value conditions, bindings, EVENT_SOURCE refs and process limit', () => {
    const eventValueCondition = {
      ...createEmptyConditionDraft([], 'EVENT_VALUE_COMPARE'),
      conditionKey: 'hit_index',
      detail: {
        eventValueKey: 'HIT_INDEX' as const,
        comparator: 'EQ' as const,
        comparisonFormulaKey: 'one'
      }
    };
    const periodCondition = {
      ...createEmptyConditionDraft([], 'EVENT_VALUE_COMPARE'),
      conditionKey: 'period',
      detail: {
        eventValueKey: 'PERIOD_INDEX' as const,
        comparator: 'GTE' as const,
        comparisonFormulaKey: 'one'
      }
    };
    const eventSourceCondition = {
      ...createEmptyConditionDraft([], 'ATTRIBUTE_COMPARE'),
      conditionKey: 'source_hp',
      detail: {
        subject: 'EVENT_SOURCE' as const,
        attributeKey: 'hp',
        attributeValueKind: 'CURRENT' as const,
        comparator: 'LTE' as const,
        comparisonFormulaKey: 'threshold'
      }
    };
    const group = {
      ...createEmptyGroupDraft([]),
      groupKey: 'group_1',
      name: '条件组',
      conditions: [eventValueCondition, periodCondition, eventSourceCondition]
    };
    const draft = namedDraft('hit_rule', '命中规则', {
      eventSource: createEmptyEventSource('SKILL_HIT'),
      conditionGroups: [group],
      maxTriggersPerProcessEnabled: true,
      maxTriggersLimitFormulaKey: 'max_triggers',
      perTargetCooldownEnabled: true,
      perTargetCooldownTargetContext: 'EVENT_SOURCE',
      actions: [
        {
          ...executeAction('apply_damage', 'on_hit_damage', '10', [
            {
              ...createEmptyBinding([], 'EVENT_VALUE'),
              bindingKey: 'bind_hit',
              parameterKey: 'hit_index',
              detail: { eventValueKey: 'HIT_INDEX' }
            },
            {
              ...createEmptyBinding([], 'COMBAT_STATUS'),
              bindingKey: 'bind_status',
              parameterKey: 'mark_present',
              detail: {
                subject: 'EVENT_SOURCE',
                statusKey: 'focus_mark',
                valueKind: 'PRESENT',
                sourceEffectKey: null,
                sourceResultKey: null
              }
            }
          ]),
          targetContext: 'EVENT_SOURCE'
        }
      ]
    });

    const noValueTarget = createEmptyEventSource('BASIC_ATTACK_START');
    const impact = analyzeEventSwitchImpact(draft, noValueTarget);
    expect(impact.clearsEventValues).toBe(true);
    expect(impact.clearsEventSourceRefs).toBe(true);
    expect(impact.clearsProcessLimit).toBe(true);
    expect(impact.summary).toContain('将清除不再可用的事件值：当前命中序号');
    expect(impact.summary).toContain('当前事件不提供事件来源对象，将清除相关对象选择。');
    expect(impact.summary).toContain('单次过程最大触发次数仅用于过程时点事件，将关闭该保护。');

    const cleaned = applyEventSwitchCleanup(draft, noValueTarget);
    expect(cleaned.eventSource.eventType).toBe('BASIC_ATTACK_START');
    expect(cleaned.conditionGroups[0].conditions.map((item) => item.conditionKey)).toEqual(['source_hp']);
    expect(cleaned.conditionGroups[0].conditions[0]).toMatchObject({
      conditionType: 'ATTRIBUTE_COMPARE',
      detail: { subject: 'CURRENT_TARGET' }
    });
    expect(cleaned.actions[0].targetContext).toBe('CURRENT_TARGET');
    expect(cleaned.actions[0].runtimeInputBindings).toEqual([
      expect.objectContaining({
        bindingKey: 'bind_status',
        detail: expect.objectContaining({ subject: 'CURRENT_TARGET' })
      })
    ]);
    expect(cleaned.perTargetCooldownTargetContext).toBe('CURRENT_TARGET');
    expect(cleaned.maxTriggersPerProcessEnabled).toBe(false);
    expect(cleaned.maxTriggersLimitFormulaKey).toBe('');
  });

  it('falls back to the first still-allowed event value instead of dropping a remaining compare', () => {
    const draft = namedDraft('periodic_rule', '周期规则', {
      eventSource: {
        eventType: 'LIFECYCLE_MOMENT',
        detail: { effectKey: 'focus_mark', moment: 'PERIODIC' }
      },
      conditionGroups: [{
        groupKey: 'group_1',
        name: '周期',
        sortOrder: '10',
        conditions: [{
          ...createEmptyConditionDraft([], 'EVENT_VALUE_COMPARE'),
          conditionKey: 'period',
          detail: {
            eventValueKey: 'PERIOD_INDEX',
            comparator: 'EQ',
            comparisonFormulaKey: 'one'
          }
        }]
      }],
      actions: [
        executeAction('tick', 'on_hit_damage', '10', [{
          ...createEmptyBinding([], 'EVENT_VALUE'),
          bindingKey: 'bind_period',
          parameterKey: 'period_index',
          detail: { eventValueKey: 'PERIOD_INDEX' }
        }])
      ]
    });
    const next = {
      eventType: 'LIFECYCLE_MOMENT' as const,
      detail: { effectKey: 'focus_mark', moment: 'FULL_STACKS' as const }
    };
    const cleaned = applyEventSwitchCleanup(draft, next);
    expect(cleaned.conditionGroups[0].conditions[0].detail).toMatchObject({
      eventValueKey: 'LIFECYCLE_STACKS'
    });
    expect(cleaned.actions[0].runtimeInputBindings[0].detail).toEqual({
      eventValueKey: 'LIFECYCLE_STACKS'
    });
    expect(cleaned.maxTriggersPerProcessEnabled).toBe(false);
  });

  it('keeps process-limit fields when staying on PROCESS_MOMENT', () => {
    const draft = namedDraft('charge_cap', '蓄力上限', {
      eventSource: {
        eventType: 'PROCESS_MOMENT',
        detail: { processKey: 'charge_cast', moment: { momentType: 'PROCESS_START', stepKey: null } }
      },
      maxTriggersPerProcessEnabled: true,
      maxTriggersLimitFormulaKey: 'max_triggers',
      actions: [executeAction('proc', 'on_hit_damage', '10')]
    });
    const next = {
      eventType: 'PROCESS_MOMENT' as const,
      detail: {
        processKey: 'charge_cast',
        moment: { momentType: 'STEP_EXECUTION' as const, stepKey: 'charge' }
      }
    };
    const cleaned = applyEventSwitchCleanup(draft, next, 'CHARGE');
    expect(cleaned.maxTriggersPerProcessEnabled).toBe(true);
    expect(cleaned.maxTriggersLimitFormulaKey).toBe('max_triggers');
    expect(analyzeEventSwitchImpact(draft, next, 'CHARGE').clearsProcessLimit).toBe(false);
  });
});

describe('nested backend fieldIssue mapping, cycle path and unknown detail retention', () => {
  it('maps nested field paths, top-level fields, unknown paths and retains code/message/details', () => {
    const details = {
      fieldIssues: [
        { field: 'name', message: '规则名称不能为空。' },
        { field: 'eventSource.detail.effectKey', message: '效果不能为空。' },
        { field: 'conditionGroups[0].conditions[1].detail.comparator', message: '比较符不合法。' },
        { field: 'actions[0].detail.effectKey', message: '效果不能为空。' },
        { field: 'actions[0].runtimeInputBindings[1].parameterKey', message: '参数不能为空。' },
        { field: 'actions[0].resultModifiers[0].fixedMultiplier', message: '倍率不能为负。' },
        { field: 'perTargetCooldown.durationFormulaKey', message: '冷却公式不能为空。' },
        { field: 'maxTriggersPerProcess.limitFormulaKey', message: '次数公式不能为空。' },
        { field: 'unknownZone.foo', message: '无法识别的新字段。' },
        { field: '', message: '缺少字段名。' }
      ],
      extra: { note: 'keep-me' }
    };
    const mapped = mapTriggerFieldIssues(new ApiRequestError(
      '校验失败',
      400,
      '400.VALIDATION_FAILED',
      details
    ));
    expect(mapped.fieldErrors.name).toBe('规则名称不能为空。');
    expect(mapped.fieldErrors.eventSource).toBe('效果不能为空。');
    expect(mapped.fieldErrors.perTargetCooldown).toBe('冷却公式不能为空。');
    expect(mapped.fieldErrors.maxTriggersPerProcess).toBe('次数公式不能为空。');
    expect(mapped.nestedErrors).toEqual([
      { path: 'conditionGroups[0].conditions[1].detail.comparator', message: '比较符不合法。' },
      { path: 'actions[0].detail.effectKey', message: '效果不能为空。' },
      { path: 'actions[0].runtimeInputBindings[1].parameterKey', message: '参数不能为空。' },
      { path: 'actions[0].resultModifiers[0].fixedMultiplier', message: '倍率不能为负。' }
    ]);
    expect(mapped.unmappedMessages).toEqual(['无法识别的新字段。', '缺少字段名。']);
    expect(mapped.retainedCode).toBe('400.VALIDATION_FAILED');
    expect(mapped.retainedMessage).toBe('校验失败');
    expect(mapped.retainedDetails).toEqual(details);
    expect(mapped.cycle).toBeNull();
    expect(nestedErrorFor('actions[0]', mapped.nestedErrors)).toBe('效果不能为空。');
    expect(nestedErrorFor('actions[0].runtimeInputBindings[1]', mapped.nestedErrors)).toBe('参数不能为空。');
  });

  it('maps unguarded cycle paths, unknown keys and produced-event details', () => {
    const details = {
      cyclePath: ['detonate_at_full_stacks', 'reapply_mark', 'unknown_rule'],
      ruleKey: 'detonate_at_full_stacks',
      actionKey: 'detonate',
      producedEvent: { eventType: 'LIFECYCLE_MOMENT', moment: 'FULL_STACKS' }
    };
    const mapped = mapTriggerFieldIssues(new ApiRequestError(
      '循环',
      400,
      '400.TRIGGER_RULE_CYCLE_UNGUARDED',
      details
    ));
    expect(mapped.cycle).toEqual({
      message: SKILL_TRIGGER_CYCLE_MESSAGE,
      hint: SKILL_TRIGGER_CYCLE_HINT,
      pathItems: [
        {
          ruleKey: 'detonate_at_full_stacks',
          actionKey: 'detonate',
          producedEvent: { eventType: 'LIFECYCLE_MOMENT', moment: 'FULL_STACKS' }
        },
        { ruleKey: 'reapply_mark' },
        { ruleKey: 'unknown_rule' }
      ]
    });
    expect(mapped.retainedCode).toBe('400.TRIGGER_RULE_CYCLE_UNGUARDED');
    expect(mapped.retainedDetails).toEqual(details);
    expect(formatCyclePath(mapped.cycle?.pathItems ?? [], new Map([
      ['detonate_at_full_stacks', '满层引爆'],
      ['reapply_mark', '重新施加标记']
    ]))).toEqual([
      '满层引爆（detonate_at_full_stacks） / detonate',
      '重新施加标记（reapply_mark）',
      'unknown_rule'
    ]);
    expect(cyclePathItems({ cyclePath: ['only_a', { nested: true }, 12], ruleKey: 'only_b' })).toEqual([
      { ruleKey: 'only_b' },
      { ruleKey: 'only_a' }
    ]);
  });

  it('surfaces incomplete catalog and FAIL_PROCESS-not-last as field errors', () => {
    const draft = namedDraft('bad', '坏规则', {
      actions: [
        {
          ...createEmptyActionDraft([], 'FAIL_PROCESS'),
          actionKey: 'fail_cast',
          name: '失败',
          sortOrder: '10',
          detail: { processKey: 'cast', failureReason: 'CONTROLLED' }
        },
        executeAction('apply_damage', 'on_hit_damage', '20')
      ]
    });
    const invalid = validateSkillTriggerDraft(draft, {
      includeRuleKey: true,
      catalogStates: { formulas: 'error', parameters: 'ready', effects: 'ready', processes: 'ready' }
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error('expected invalid');
    expect(invalid.fieldErrors.eventSource).toBe(INCOMPLETE_CATALOG_MESSAGE);
    expect(invalid.fieldErrors.actions).toBe(SKILL_TRIGGER_FAIL_PROCESS_LAST_MESSAGE);
  });
});

describe('representative draft transformations', () => {
  it('round-trips full-stack detonation without exposing PERSISTENT or process-limit camouflage', () => {
    const detail: SkillTriggerRuleDetail = {
      ruleKey: 'detonate_at_full_stacks',
      name: '满层引爆',
      description: '达到满层后先造成伤害，再移除标记',
      sortOrder: 10,
      eventSource: {
        eventType: 'LIFECYCLE_MOMENT',
        detail: { effectKey: 'focus_mark', moment: 'FULL_STACKS' }
      },
      conditionGroups: [],
      actions: [
        {
          actionKey: 'detonate',
          name: '引爆伤害',
          actionType: 'EXECUTE_EFFECT',
          sortOrder: 10,
          targetContext: 'CURRENT_TARGET',
          detail: { effectKey: 'detonate_damage' },
          runtimeInputBindings: [],
          resultModifiers: []
        },
        {
          actionKey: 'remove_mark',
          name: '移除标记',
          actionType: 'EXECUTE_EFFECT',
          sortOrder: 20,
          targetContext: 'CURRENT_TARGET',
          detail: { effectKey: 'remove_focus_mark' },
          runtimeInputBindings: [],
          resultModifiers: []
        }
      ],
      perTargetCooldown: null,
      maxTriggersPerProcess: null
    };
    const draft = fromDetail(detail);
    expect(draft.eventSource).toEqual(detail.eventSource);
    expect(draft.maxTriggersPerProcessEnabled).toBe(false);
    const created = expectValid(draft);
    expect(created.ruleKey).toBe('detonate_at_full_stacks');
    expect(created.actions.map((item) => item.detail)).toEqual([
      { effectKey: 'detonate_damage' },
      { effectKey: 'remove_focus_mark' }
    ]);
    expect(toUpdateRequest(draft)).not.toHaveProperty('ruleKey');
    expect(created.eventSource.eventType === 'LIFECYCLE_MOMENT' && created.eventSource.detail.moment).toBe('FULL_STACKS');
    expect(created.maxTriggersPerProcess).toBeNull();
    expect(DETONATE_EFFECT.effectKey).toBe('detonate_damage');
    expect(REMOVE_EFFECT.results[0].detail.operation).toBe('REMOVE');
  });

  it('round-trips a low-health threshold shield with optional attribute condition and per-target cooldown', () => {
    const detail: SkillTriggerRuleDetail = {
      ruleKey: 'low_health_shield',
      name: '低生命护盾',
      description: null,
      sortOrder: 20,
      eventSource: {
        eventType: 'HEALTH_THRESHOLD_CROSSED',
        detail: {
          subject: 'SOURCE',
          attributeKey: 'hp',
          thresholdFormulaKey: 'hp_threshold',
          direction: 'DOWNWARD'
        }
      },
      conditionGroups: [{
        groupKey: 'still_low',
        name: '生命比例仍低',
        sortOrder: 10,
        conditions: [{
          conditionKey: 'hp_ratio',
          conditionType: 'ATTRIBUTE_COMPARE',
          sortOrder: 10,
          detail: {
            subject: 'SOURCE',
            attributeKey: 'hp',
            attributeValueKind: 'CURRENT_RATIO',
            comparator: 'LTE',
            comparisonFormulaKey: 'low_health_ratio'
          }
        }]
      }],
      actions: [{
        actionKey: 'apply_shield',
        name: '施加护盾',
        actionType: 'EXECUTE_EFFECT',
        sortOrder: 10,
        targetContext: 'CURRENT_TARGET',
        detail: { effectKey: 'emergency_shield' },
        runtimeInputBindings: [],
        resultModifiers: []
      }],
      perTargetCooldown: {
        durationFormulaKey: 'shield_cooldown_ms',
        targetContext: 'CURRENT_TARGET'
      },
      maxTriggersPerProcess: null
    };
    const created = toCreateRequest(fromDetail(detail));
    expect(created.ruleKey).toBe('low_health_shield');
    expect(created.eventSource).toEqual(detail.eventSource);
    expect(created.conditionGroups[0].conditions[0].conditionType).toBe('ATTRIBUTE_COMPARE');
    expect(created.perTargetCooldown).toEqual(detail.perTargetCooldown);
    expect(toUpdateRequest(fromDetail(detail))).not.toHaveProperty('ruleKey');
    expect(SHIELD_EFFECT.results[0].resultType).toBe('NORMAL_SHIELD');
  });

  it('round-trips on-hit append with a status presence condition and ordered execute effects', () => {
    const detail: SkillTriggerRuleDetail = {
      ruleKey: 'on_hit_append',
      name: '命中后追加',
      description: null,
      sortOrder: 30,
      eventSource: {
        eventType: 'SKILL_HIT',
        detail: { sourceSkillKey: 'ashe_q' }
      },
      conditionGroups: [{
        groupKey: 'marked',
        name: '已标记',
        sortOrder: 10,
        conditions: [{
          conditionKey: 'has_mark',
          conditionType: 'STATUS_CHECK',
          sortOrder: 10,
          detail: {
            subject: 'CURRENT_TARGET',
            statusKey: 'focus_mark',
            checkKind: 'PRESENT',
            sourceEffectKey: null,
            sourceResultKey: null,
            comparator: null,
            comparisonFormulaKey: null
          }
        }]
      }],
      actions: [
        {
          actionKey: 'bonus_damage',
          name: '追加伤害',
          actionType: 'EXECUTE_EFFECT',
          sortOrder: 10,
          targetContext: 'CURRENT_TARGET',
          detail: { effectKey: 'on_hit_damage' },
          runtimeInputBindings: [],
          resultModifiers: []
        },
        {
          actionKey: 'apply_mark',
          name: '施加标记',
          actionType: 'EXECUTE_EFFECT',
          sortOrder: 20,
          targetContext: 'CURRENT_TARGET',
          detail: { effectKey: 'focus_mark' },
          runtimeInputBindings: [],
          resultModifiers: []
        }
      ],
      perTargetCooldown: null,
      maxTriggersPerProcess: null
    };
    const created = toCreateRequest(fromDetail(detail));
    expect(created.actions.map((item) => item.actionKey)).toEqual(['bonus_damage', 'apply_mark']);
    expect(created.conditionGroups[0].conditions[0]).toMatchObject({
      conditionType: 'STATUS_CHECK',
      detail: { checkKind: 'PRESENT', sourceEffectKey: null }
    });
  });

  it('round-trips a prior-result input binding as CONFIGURED_VALUE from an earlier execute effect', () => {
    const detail: SkillTriggerRuleDetail = {
      ruleKey: 'prior_result_scale',
      name: '前序结果驱动',
      description: null,
      sortOrder: 40,
      eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
      conditionGroups: [],
      actions: [
        {
          actionKey: 'first_hit',
          name: '第一段',
          actionType: 'EXECUTE_EFFECT',
          sortOrder: 10,
          targetContext: 'CURRENT_TARGET',
          detail: { effectKey: 'on_hit_damage' },
          runtimeInputBindings: [],
          resultModifiers: []
        },
        {
          actionKey: 'second_hit',
          name: '第二段',
          actionType: 'EXECUTE_EFFECT',
          sortOrder: 20,
          targetContext: 'CURRENT_TARGET',
          detail: { effectKey: 'follow_damage' },
          runtimeInputBindings: [{
            bindingKey: 'bind_prior',
            parameterKey: 'prior_hit_value',
            sourceType: 'PRIOR_ACTION_RESULT',
            detail: {
              sourceActionKey: 'first_hit',
              sourceResultKey: 'damage',
              outputKind: 'CONFIGURED_VALUE'
            }
          }],
          resultModifiers: []
        }
      ],
      perTargetCooldown: null,
      maxTriggersPerProcess: null
    };
    const draft = fromDetail(detail);
    const created = toCreateRequest(draft);
    expect(created.ruleKey).toBe('prior_result_scale');
    expect(created.actions[1].runtimeInputBindings[0]).toEqual({
      bindingKey: 'bind_prior',
      parameterKey: 'prior_hit_value',
      sourceType: 'PRIOR_ACTION_RESULT',
      detail: {
        sourceActionKey: 'first_hit',
        sourceResultKey: 'damage',
        outputKind: 'CONFIGURED_VALUE'
      }
    });
    expect(toUpdateRequest(draft)).not.toHaveProperty('ruleKey');
    const validated = validateSkillTriggerDraft(draft, {
      includeRuleKey: true,
      effectsByKey: new Map([
        ['on_hit_damage', HIT_EFFECT],
        ['follow_damage', FOLLOW_EFFECT]
      ]),
      formulasByKey: new Map([
        ['hit_scale', formula('hit_scale', 'base_ad')],
        ['follow_up', formula('follow_up', 'prior_hit_value')]
      ]),
      parameters: [
        parameter({
          parameterKey: 'base_ad',
          name: '基础攻击',
          valueType: 'DECIMAL',
          valueMode: 'FIXED'
        }),
        parameter({
          parameterKey: 'prior_hit_value',
          name: '前序命中值',
          valueType: 'DECIMAL',
          valueMode: 'RUNTIME_INPUT'
        })
      ]
    });
    expect(validated.ok).toBe(true);
  });

  it('round-trips empowered basic attack with flag check, hit-index binding and a consume process', () => {
    const detail: SkillTriggerRuleDetail = {
      ruleKey: 'empowered_basic_attack',
      name: '强化普攻',
      description: null,
      sortOrder: 50,
      eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
      conditionGroups: [{
        groupKey: 'ready',
        name: '已准备',
        sortOrder: 10,
        conditions: [{
          conditionKey: 'flag_on',
          conditionType: 'INTERNAL_STATE_CHECK',
          sortOrder: 10,
          detail: {
            stateKey: 'focus_ready',
            valueKind: 'ENABLED',
            optionKey: null,
            expectedBoolean: true,
            comparator: null,
            comparisonFormulaKey: null
          }
        }]
      }],
      actions: [
        {
          actionKey: 'empower',
          name: '强化命中',
          actionType: 'EXECUTE_EFFECT',
          sortOrder: 10,
          targetContext: 'CURRENT_TARGET',
          detail: { effectKey: 'empowered_hit' },
          runtimeInputBindings: [{
            bindingKey: 'bind_hit_index',
            parameterKey: 'hit_index',
            sourceType: 'EVENT_VALUE',
            detail: { eventValueKey: 'HIT_INDEX' }
          }],
          resultModifiers: []
        },
        {
          actionKey: 'consume',
          name: '消费准备',
          actionType: 'START_PROCESS',
          sortOrder: 20,
          targetContext: 'CURRENT_TARGET',
          detail: { processKey: 'consume_focus' },
          runtimeInputBindings: [],
          resultModifiers: []
        }
      ],
      perTargetCooldown: null,
      maxTriggersPerProcess: null
    };
    const created = toCreateRequest(fromDetail(detail));
    expect(created.eventSource.eventType).toBe('BASIC_ATTACK_HIT');
    expect(created.conditionGroups[0].conditions[0].detail).toMatchObject({
      stateKey: 'focus_ready',
      valueKind: 'ENABLED',
      expectedBoolean: true
    });
    expect(created.actions.map((item) => item.actionType)).toEqual(['EXECUTE_EFFECT', 'START_PROCESS']);
    expect(created.actions[0].runtimeInputBindings[0].detail).toEqual({ eventValueKey: 'HIT_INDEX' });
    expect(READY_FLAG.stateType).toBe('FLAG');
    expect(CONSUME_PROCESS.steps[0].stepType).toBe('EMPOWERED_BASIC_ATTACK');
    expect(EMPOWER_EFFECT.effectKey).toBe('empowered_hit');
  });

  it('round-trips process-failure rules with FAIL_PROCESS last and fixed failure reasons', () => {
    const reasons: SkillTriggerProcessFailureReason[] = [
      'CONTROLLED',
      'SOURCE_DIED',
      'TARGET_UNTARGETABLE',
      'ACTIVE_CANCELLED'
    ];
    const eventByReason = {
      CONTROLLED: createEmptyEventSource('CONTROL_RECEIVED'),
      SOURCE_DIED: {
        eventType: 'ENTITY_DIED' as const,
        detail: { subject: 'SOURCE' as const }
      },
      TARGET_UNTARGETABLE: {
        eventType: 'ENTITY_UNTARGETABLE' as const,
        detail: { subject: 'CURRENT_TARGET' as const }
      },
      ACTIVE_CANCELLED: {
        eventType: 'PROCESS_CANCEL_REQUESTED' as const,
        detail: { processKey: 'channel_cast' }
      }
    };
    for (const reason of reasons) {
      const failAction: SkillTriggerActionDraft = {
        ...createEmptyActionDraft([], 'FAIL_PROCESS'),
        actionKey: 'fail_channel',
        name: '令引导失败',
        sortOrder: '20',
        detail: { processKey: 'channel_cast', failureReason: reason }
      };
      const draft = namedDraft(`fail_${reason.toLowerCase()}`, `失败 ${reason}`, {
        eventSource: eventByReason[reason],
        actions: [
          executeAction('cleanup', 'on_hit_damage', '10'),
          failAction
        ]
      });
      const created = expectValid(draft);
      expect(created.actions).toHaveLength(2);
      expect(created.actions[1]).toMatchObject({
        actionType: 'FAIL_PROCESS',
        targetContext: null,
        detail: { processKey: 'channel_cast', failureReason: reason },
        runtimeInputBindings: [],
        resultModifiers: []
      });
      expect(toUpdateRequest(draft)).not.toHaveProperty('ruleKey');
    }
  });
});

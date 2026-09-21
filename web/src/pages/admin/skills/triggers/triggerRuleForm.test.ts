import { formulaValue } from '../../../../types/numericValue';
import { describe, expect, it } from 'vitest';
import type { SkillEffect } from '../../../../types/skillEffect';
import type {
  SkillTriggerAction,
  SkillTriggerCondition,
  SkillTriggerEventType,
  SkillTriggerRuleDetail
} from '../../../../types/skillTriggerRule';
import {
  SKILL_TRIGGER_ACTION_TYPES,
  SKILL_TRIGGER_CONDITION_GROUP_HINT,
  SKILL_TRIGGER_CONDITION_TYPES,
  SKILL_TRIGGER_EVENT_CAPABILITIES,
  SKILL_TRIGGER_EVENT_TYPES,
  SKILL_TRIGGER_EVENT_TYPE_LABELS,
  SKILL_TRIGGER_EVENT_VALUE_DOMAINS,
  SKILL_TRIGGER_EVENT_VALUE_KEYS,
  SKILL_TRIGGER_FAIL_PROCESS_LAST_MESSAGE,
  SKILL_TRIGGER_GROUP_AND_LABEL,
  SKILL_TRIGGER_GROUP_OR_LABEL,
  SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENTS,
  SKILL_TRIGGER_PRODUCED_EVENTS_BY_RESULT,
  SKILL_TRIGGER_RESULT_EVENT_GRAPH_HINT,
  SKILL_TRIGGER_SOURCE_TYPES,
  allowedEventValuesFor,
  analyzeEventSwitchImpact,
  applyEventSwitchCleanup,
  canMoveAction,
  changeKindsForInternalState,
  createEmptyActionDraft,
  createEmptyBinding,
  createEmptyBindingDetail,
  createEmptyConditionDetail,
  createEmptyConditionDraft,
  createEmptyEventSource,
  createEmptyGroupDraft,
  createEmptyRuleDraft,
  emptyEventDetail,
  ensureFailProcessLast,
  eventFieldDescriptors,
  eventHasEventSource,
  eventStepType,
  failProcessIndex,
  findSourceActionCleanupImpact,
  fromDetail,
  groupConditionSummary,
  isFailProcessLast,
  isSpellShieldEventEffect,
  isTriggerRuleDraftDirty,
  lifecycleEventEffects,
  moveActionDrafts,
  nextDraftKey,
  rebuildCombatStatusBindingDetail,
  rebuildInternalStateCheckDetail,
  rebuildStatusCheckDetail,
  removeBindingsByKeys,
  resultAvailableEffects,
  spellShieldEventEffects,
  sortActionDrafts,
  sortConditionDrafts,
  sortGroupDrafts,
  subjectOptionsForEvent,
  switchActionType,
  switchBindingSourceType,
  switchConditionType,
  switchEventType,
  targetContextOptionsForEvent,
  toCreateRequest,
  toUpdateRequest,
  type SkillTriggerActionDraft,
  type SkillTriggerConditionDraft,
  type SkillTriggerExecuteEffectActionDraft
} from './triggerRuleForm';

const EVENT_CAPABILITY_ROWS = [
  {
    eventType: 'SOURCE_INITIALIZED',
    label: '来源对象初始化完成',
    currentTargetBinding: '当前目标与事件来源对象均为完成初始化的来源对象自身，不指向战斗对手。',
    hasEventSource: true,
    requiredCatalogs: [],
    detailFields: []
  },
  {
    eventType: 'SKILL_USED',
    label: '技能被主动或消耗使用',
    currentTargetBinding: '该次技能使用的显式目标；没有时为来源对象。',
    hasEventSource: false,
    requiredCatalogs: ['skills'],
    detailFields: ['sourceSkillKey', 'useKind']
  },
  {
    eventType: 'BASIC_ATTACK_START',
    label: '普通攻击发起',
    currentTargetBinding: '本次普通攻击目标。',
    hasEventSource: false,
    requiredCatalogs: [],
    detailFields: []
  },
  {
    eventType: 'BASIC_ATTACK_HIT',
    label: '普通攻击命中',
    currentTargetBinding: '本次普通攻击命中的对象。',
    hasEventSource: false,
    requiredCatalogs: [],
    detailFields: []
  },
  {
    eventType: 'SKILL_HIT',
    label: '技能命中',
    currentTargetBinding: '本次技能命中的对象。',
    hasEventSource: false,
    requiredCatalogs: ['skills'],
    detailFields: ['sourceSkillKey']
  },
  {
    eventType: 'PROCESS_MOMENT',
    label: '当前技能过程到达固定时点',
    currentTargetBinding: '目标过程实例的目标；没有时为来源对象。',
    hasEventSource: false,
    requiredCatalogs: ['processes', 'steps'],
    detailFields: ['processKey', 'moment']
  },
  {
    eventType: 'RESULT_AVAILABLE',
    label: '当前技能某个无生命周期基础结果到达可用时点',
    currentTargetBinding: '目标效果执行上下文的目标；没有时为来源对象。',
    hasEventSource: false,
    requiredCatalogs: ['effects', 'results'],
    detailFields: ['effectKey', 'resultKey']
  },
  {
    eventType: 'LIFECYCLE_MOMENT',
    label: '当前技能生命周期到达离散时点',
    currentTargetBinding: '目标生命周期实例的承受对象。',
    hasEventSource: false,
    requiredCatalogs: ['effects'],
    detailFields: ['effectKey', 'moment']
  },
  {
    eventType: 'DAMAGE_PENDING',
    label: '即将受到伤害',
    currentTargetBinding: '技能拥有者自身。',
    hasEventSource: true,
    requiredCatalogs: ['damageTypes'],
    detailFields: ['damageTypeKey', 'deliveryKind', 'originKind']
  },
  {
    eventType: 'DAMAGE_DEALT',
    label: '来源对象造成伤害',
    currentTargetBinding: '本次伤害承受对象。',
    hasEventSource: false,
    requiredCatalogs: ['damageTypes'],
    detailFields: ['damageTypeKey', 'deliveryKind', 'originKind']
  },
  {
    eventType: 'DAMAGE_TAKEN',
    label: '来源对象受到伤害',
    currentTargetBinding: '来源对象自身。',
    hasEventSource: true,
    requiredCatalogs: ['damageTypes'],
    detailFields: ['damageTypeKey', 'deliveryKind', 'originKind']
  },
  {
    eventType: 'STATUS_CHANGED',
    label: '指定对象的战斗状态施加或移除',
    currentTargetBinding: 'subject 指定的状态变化对象。',
    hasEventSource: true,
    requiredCatalogs: ['statuses'],
    detailFields: ['subject', 'statusKey', 'change']
  },
  {
    eventType: 'HEALTH_THRESHOLD_CROSSED',
    label: '指定对象生命属性越过阈值',
    currentTargetBinding: 'subject 指定的生命属性变化对象。',
    hasEventSource: false,
    requiredCatalogs: ['attributes', 'formulas'],
    detailFields: ['subject', 'attributeKey', 'thresholdValue', 'direction']
  },
  {
    eventType: 'INTERNAL_STATE_CHANGED',
    label: '当前技能内部状态发生固定变化',
    currentTargetBinding: 'TARGET 范围状态的实例目标；技能范围状态为来源对象。',
    hasEventSource: false,
    requiredCatalogs: ['internalStates'],
    detailFields: ['stateKey', 'changeKind']
  },
  {
    eventType: 'CONTROL_RECEIVED',
    label: '来源对象受到控制',
    currentTargetBinding: '来源对象自身。',
    hasEventSource: true,
    requiredCatalogs: [],
    detailFields: []
  },
  {
    eventType: 'ENTITY_DIED',
    label: '指定对象死亡',
    currentTargetBinding: 'subject 指定的死亡对象。',
    hasEventSource: false,
    requiredCatalogs: [],
    detailFields: ['subject']
  },
  {
    eventType: 'ENTITY_UNTARGETABLE',
    label: '指定对象变为不可选取',
    currentTargetBinding: 'subject 指定的不可选取对象。',
    hasEventSource: false,
    requiredCatalogs: [],
    detailFields: ['subject']
  },
  {
    eventType: 'KILL',
    label: '来源对象完成击杀',
    currentTargetBinding: '本次被击杀对象。',
    hasEventSource: false,
    requiredCatalogs: [],
    detailFields: []
  },
  {
    eventType: 'TAKEDOWN',
    label: '来源对象参与击杀',
    currentTargetBinding: '本次死亡对象。',
    hasEventSource: false,
    requiredCatalogs: [],
    detailFields: []
  },
  {
    eventType: 'PROCESS_CANCEL_REQUESTED',
    label: '指定过程收到主动取消请求',
    currentTargetBinding: '目标过程实例的目标；没有时为来源对象。',
    hasEventSource: false,
    requiredCatalogs: ['processes'],
    detailFields: ['processKey']
  },
  {
    eventType: 'SPELL_SHIELD_BLOCKED',
    label: '法术护盾成功阻挡',
    currentTargetBinding: '法术护盾承受对象（技能拥有者自身）。',
    hasEventSource: true,
    requiredCatalogs: ['effects'],
    detailFields: ['shieldEffectKey']
  },
  {
    eventType: 'HIT_LINK_APPLIED',
    label: '应用命中联动',
    currentTargetBinding: '本次联动目标。',
    hasEventSource: false,
    requiredCatalogs: ['skills'],
    detailFields: ['sourceSkillKey']
  },
  {
    eventType: 'ATTACK_LINK_APPLIED',
    label: '触发攻击联动',
    currentTargetBinding: '本次联动目标。',
    hasEventSource: false,
    requiredCatalogs: ['skills'],
    detailFields: ['sourceSkillKey']
  }
] as const satisfies ReadonlyArray<{
  eventType: SkillTriggerEventType;
  label: string;
  currentTargetBinding: string;
  hasEventSource: boolean;
  requiredCatalogs: readonly string[];
  detailFields: readonly string[];
}>;

function executeAction(
  overrides: Partial<SkillTriggerExecuteEffectActionDraft> & Pick<SkillTriggerExecuteEffectActionDraft, 'actionKey'>
): SkillTriggerExecuteEffectActionDraft {
  return {
    ...createEmptyActionDraft([], 'EXECUTE_EFFECT'),
    name: overrides.actionKey,
    sortOrder: '10',
    targetContext: 'CURRENT_TARGET',
    detail: { effectKey: 'hit_damage' },
    runtimeInputBindings: [],
    resultModifiers: [],
    ...overrides
  };
}

function priorBinding(sourceActionKey: string, parameterKey = 'prior_hit_value') {
  return {
    bindingKey: `bind_${sourceActionKey}`,
    parameterKey,
    sourceType: 'PRIOR_ACTION_RESULT' as const,
    detail: {
      sourceActionKey,
      sourceResultKey: 'damage',
      outputKind: 'CONFIGURED_VALUE' as const
    }
  };
}

const RICH_DETAIL: SkillTriggerRuleDetail = {
  ruleKey: 'on_hit_combo',
  name: '命中追加',
  description: null,
  sortOrder: 20,
  eventSource: {
    eventType: 'SKILL_HIT',
    detail: { sourceSkillKey: 'ashe_q' }
  },
  conditionGroups: [
    {
      groupKey: 'low_or_marked',
      name: '低生命或已标记',
      sortOrder: 10,
      conditions: [
        {
          conditionKey: 'hp_low',
          conditionType: 'ATTRIBUTE_COMPARE',
          sortOrder: 10,
          detail: {
            subject: 'CURRENT_TARGET',
            attributeKey: 'hp',
            attributeValueKind: 'CURRENT_RATIO',
            comparator: 'LTE',
            comparisonValue: formulaValue("low_health_ratio")
          }
        },
        {
          conditionKey: 'has_mark',
          conditionType: 'STATUS_CHECK',
          sortOrder: 20,
          detail: {
            subject: 'CURRENT_TARGET',
            statusKey: 'focus_mark',
            checkKind: 'PRESENT',
            sourceEffectKey: null,
            sourceResultKey: null,
            comparator: null,
            comparisonValue: null
          }
        }
      ]
    },
    {
      groupKey: 'ready_focus',
      name: '专注已准备',
      sortOrder: 20,
      conditions: [
        {
          conditionKey: 'focus_ready',
          conditionType: 'INTERNAL_STATE_CHECK',
          sortOrder: 10,
          detail: {
            stateKey: 'focus_ready',
            valueKind: 'ENABLED',
            optionKey: null,
            expectedBoolean: true,
            comparator: null,
            comparisonValue: null
          }
        },
        {
          conditionKey: 'first_hit',
          conditionType: 'EVENT_VALUE_COMPARE',
          sortOrder: 20,
          detail: {
            eventValueKey: 'HIT_INDEX',
            comparator: 'EQ',
            comparisonValue: formulaValue("one")
          }
        }
      ]
    }
  ],
  actions: [
    {
      actionKey: 'apply_damage',
      name: '造成伤害',
      actionType: 'EXECUTE_EFFECT',
      sortOrder: 10,
      targetContext: 'CURRENT_TARGET',
      detail: { effectKey: 'on_hit_damage' },
      runtimeInputBindings: [
        {
          bindingKey: 'bind_hit_index',
          parameterKey: 'hit_index',
          sourceType: 'EVENT_VALUE',
          detail: { eventValueKey: 'HIT_INDEX' }
        }
      ],
      resultModifiers: [
        { resultKey: 'damage', fixedMultiplier: 1.2, fixedMinValue: 10, fixedMaxValue: 400 }
      ]
    },
    {
      actionKey: 'start_followup',
      name: '启动追加过程',
      actionType: 'START_PROCESS',
      sortOrder: 20,
      targetContext: 'CURRENT_TARGET',
      detail: { processKey: 'followup_cast' },
      runtimeInputBindings: [
        {
          bindingKey: 'bind_focus',
          parameterKey: 'focus_stacks',
          sourceType: 'INTERNAL_STATE',
          detail: { stateKey: 'focus_stacks', valueKind: 'VALUE', optionKey: null }
        }
      ],
      resultModifiers: []
    },
    {
      actionKey: 'fail_followup',
      name: '令追加失败',
      actionType: 'FAIL_PROCESS',
      sortOrder: 30,
      targetContext: null,
      detail: { processKey: 'followup_cast', failureReason: 'EVENT_ABORTED' },
      runtimeInputBindings: [],
      resultModifiers: []
    }
  ],
  perTargetCooldown: {
    durationValue: formulaValue("per_target_cooldown_ms"),
    targetContext: 'CURRENT_TARGET'
  },
  maxTriggersPerProcess: null
};

describe('trigger event member set and capability table', () => {
  it('exposes exactly 23 frozen events with labels, current-target, event-source and catalogs', () => {
    expect(SKILL_TRIGGER_EVENT_TYPES).toHaveLength(23);
    expect([...SKILL_TRIGGER_EVENT_TYPES]).toEqual(EVENT_CAPABILITY_ROWS.map((row) => row.eventType));
    expect(Object.keys(SKILL_TRIGGER_EVENT_CAPABILITIES)).toEqual([...SKILL_TRIGGER_EVENT_TYPES]);

    for (const row of EVENT_CAPABILITY_ROWS) {
      expect(SKILL_TRIGGER_EVENT_TYPE_LABELS[row.eventType]).toBe(row.label);
      expect(SKILL_TRIGGER_EVENT_CAPABILITIES[row.eventType]).toEqual({
        eventType: row.eventType,
        label: row.label,
        currentTargetBinding: row.currentTargetBinding,
        hasEventSource: row.hasEventSource,
        requiredCatalogs: row.requiredCatalogs,
        detailFields: row.detailFields
      });
      expect(eventHasEventSource(row.eventType)).toBe(row.hasEventSource);
      expect(eventFieldDescriptors(row.eventType)).toEqual(row.detailFields);
      expect(subjectOptionsForEvent(row.eventType).includes('EVENT_SOURCE')).toBe(row.hasEventSource);
      expect(targetContextOptionsForEvent(row.eventType).includes('EVENT_SOURCE')).toBe(row.hasEventSource);
    }
  });

  it('creates type-specific empty event details and never carries foreign fields', () => {
    expect(emptyEventDetail()).toEqual({});
    expect(createEmptyEventSource('SOURCE_INITIALIZED')).toEqual({
      eventType: 'SOURCE_INITIALIZED',
      detail: {}
    });
    expect(createEmptyEventSource('TAKEDOWN')).toEqual({ eventType: 'TAKEDOWN', detail: {} });
    expect(switchEventType(createEmptyEventSource('SKILL_USED'), 'TAKEDOWN')).toEqual({ eventType: 'TAKEDOWN', detail: {} });
    expect(createEmptyEventSource('SKILL_USED')).toEqual({
      eventType: 'SKILL_USED',
      detail: { sourceSkillKey: null, useKind: 'ANY' }
    });
    expect(createEmptyEventSource('BASIC_ATTACK_HIT')).toEqual({
      eventType: 'BASIC_ATTACK_HIT',
      detail: {}
    });
    expect(createEmptyEventSource('PROCESS_MOMENT')).toEqual({
      eventType: 'PROCESS_MOMENT',
      detail: { processKey: '', moment: { momentType: 'PROCESS_START', stepKey: null } }
    });
    expect(createEmptyEventSource('RESULT_AVAILABLE')).toEqual({
      eventType: 'RESULT_AVAILABLE',
      detail: { effectKey: '', resultKey: '' }
    });
    expect(createEmptyEventSource('LIFECYCLE_MOMENT')).toEqual({
      eventType: 'LIFECYCLE_MOMENT',
      detail: { effectKey: '', moment: 'APPLICATION' }
    });
    const switched = switchEventType(createEmptyEventSource('SKILL_USED'), 'DAMAGE_TAKEN');
    expect(switched).toEqual({
      eventType: 'DAMAGE_TAKEN',
      detail: { damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY' }
    });
    expect(createEmptyEventSource('SPELL_SHIELD_BLOCKED')).toEqual({
      eventType: 'SPELL_SHIELD_BLOCKED',
      detail: { shieldEffectKey: '' }
    });
    expect(createEmptyEventSource('HIT_LINK_APPLIED')).toEqual({
      eventType: 'HIT_LINK_APPLIED',
      detail: { sourceSkillKey: null }
    });
    expect(createEmptyEventSource('ATTACK_LINK_APPLIED')).toEqual({
      eventType: 'ATTACK_LINK_APPLIED',
      detail: { sourceSkillKey: null }
    });
    expect(switched.detail).not.toHaveProperty('sourceSkillKey');
    expect(switched.detail).not.toHaveProperty('useKind');
    const same = createEmptyEventSource('KILL');
    expect(switchEventType(same, 'KILL')).toBe(same);
  });

  it('returns the exact event-value whitelist per event, moment and step type', () => {
    expect([...SKILL_TRIGGER_EVENT_VALUE_KEYS]).toEqual([
      'STEP_EXECUTION_INDEX',
      'CHARGE_DURATION_MS',
      'RECAST_COUNT',
      'HIT_INDEX',
      'SKILL_HIT_FIRST_CONTACT',
      'SKILL_HIT_SPELL_SHIELD_BLOCKED',
      'LIFECYCLE_STACKS',
      'PERIOD_INDEX',
      'REMAINING_MS',
      'STATE_BEFORE',
      'STATE_AFTER',
      'ATTRIBUTE_BEFORE',
      'ATTRIBUTE_AFTER',
      'THRESHOLD_VALUE',
      'RAW_DAMAGE',
      'POST_DEFENSE_DAMAGE',
      'HEALTH_BEFORE',
      'PROJECTED_HEALTH_AFTER',
      'SHIELD_ABSORBED',
      'ACTUAL_HP_LOSS',
      'BLOCKED',
      'IMMUNE',
      'KILLED',
      'LINK_INDEX',
      'LINK_COUNT'
    ]);
    expect(SKILL_TRIGGER_EVENT_VALUE_DOMAINS.HIT_INDEX).toBe('INTEGER');
    expect(SKILL_TRIGGER_EVENT_VALUE_DOMAINS.CHARGE_DURATION_MS).toBe('DECIMAL');
    expect(SKILL_TRIGGER_EVENT_VALUE_DOMAINS.THRESHOLD_VALUE).toBe('DECIMAL');
    expect(SKILL_TRIGGER_EVENT_VALUE_DOMAINS.PROJECTED_HEALTH_AFTER).toBe('DECIMAL');
    expect(SKILL_TRIGGER_EVENT_VALUE_DOMAINS.SHIELD_ABSORBED).toBe('DECIMAL');
    expect(SKILL_TRIGGER_EVENT_VALUE_DOMAINS.ACTUAL_HP_LOSS).toBe('DECIMAL');
    expect(SKILL_TRIGGER_EVENT_VALUE_DOMAINS.BLOCKED).toBe('INTEGER');
    expect(SKILL_TRIGGER_EVENT_VALUE_DOMAINS.KILLED).toBe('INTEGER');
    expect(SKILL_TRIGGER_EVENT_VALUE_DOMAINS.LINK_INDEX).toBe('INTEGER');

    expect(allowedEventValuesFor(createEmptyEventSource('SOURCE_INITIALIZED'))).toEqual([]);
    expect(allowedEventValuesFor(createEmptyEventSource('TAKEDOWN'))).toEqual([]);
    expect(allowedEventValuesFor(createEmptyEventSource('SKILL_USED'))).toEqual([]);
    expect(allowedEventValuesFor(createEmptyEventSource('BASIC_ATTACK_HIT'))).toEqual(['HIT_INDEX']);
    expect(allowedEventValuesFor(createEmptyEventSource('SKILL_HIT'))).toEqual(['HIT_INDEX', 'SKILL_HIT_FIRST_CONTACT', 'SKILL_HIT_SPELL_SHIELD_BLOCKED']);
    expect(allowedEventValuesFor(createEmptyEventSource('RESULT_AVAILABLE'))).toEqual([]);
    expect(allowedEventValuesFor(createEmptyEventSource('DAMAGE_TAKEN'))).toEqual([
      'RAW_DAMAGE',
      'POST_DEFENSE_DAMAGE',
      'SHIELD_ABSORBED',
      'ACTUAL_HP_LOSS',
      'BLOCKED',
      'IMMUNE',
      'KILLED'
    ]);
    expect(allowedEventValuesFor(createEmptyEventSource('DAMAGE_DEALT'))).toEqual(
      allowedEventValuesFor(createEmptyEventSource('DAMAGE_TAKEN'))
    );
    expect(allowedEventValuesFor(createEmptyEventSource('SPELL_SHIELD_BLOCKED'))).toEqual([]);
    expect(allowedEventValuesFor(createEmptyEventSource('HIT_LINK_APPLIED'))).toEqual([
      'LINK_INDEX',
      'LINK_COUNT'
    ]);
    expect(allowedEventValuesFor(createEmptyEventSource('ATTACK_LINK_APPLIED'))).toEqual([
      'LINK_INDEX',
      'LINK_COUNT'
    ]);
    expect(allowedEventValuesFor(createEmptyEventSource('DAMAGE_PENDING'))).toEqual([
      'RAW_DAMAGE',
      'POST_DEFENSE_DAMAGE',
      'HEALTH_BEFORE',
      'PROJECTED_HEALTH_AFTER'
    ]);
    expect(allowedEventValuesFor(createEmptyEventSource('HEALTH_THRESHOLD_CROSSED'))).toEqual([
      'ATTRIBUTE_BEFORE',
      'ATTRIBUTE_AFTER',
      'THRESHOLD_VALUE'
    ]);

    const processStart = createEmptyEventSource('PROCESS_MOMENT');
    expect(allowedEventValuesFor(processStart)).toEqual([]);
    const stepExecution = {
      eventType: 'PROCESS_MOMENT' as const,
      detail: {
        processKey: 'cast',
        moment: { momentType: 'STEP_EXECUTION' as const, stepKey: 'charge' }
      }
    };
    expect(allowedEventValuesFor(stepExecution)).toEqual(['STEP_EXECUTION_INDEX']);
    expect(allowedEventValuesFor(stepExecution, 'CHARGE')).toEqual([
      'STEP_EXECUTION_INDEX',
      'CHARGE_DURATION_MS'
    ]);
    expect(allowedEventValuesFor({
      eventType: 'PROCESS_MOMENT',
      detail: { processKey: 'cast', moment: { momentType: 'STEP_COMPLETE', stepKey: 'charge' } }
    }, 'CHARGE')).toEqual(['CHARGE_DURATION_MS']);
    expect(allowedEventValuesFor({
      eventType: 'PROCESS_MOMENT',
      detail: { processKey: 'cast', moment: { momentType: 'STEP_TIMEOUT', stepKey: 'charge' } }
    }, 'CHARGE')).toEqual(['CHARGE_DURATION_MS']);
    expect(allowedEventValuesFor({
      eventType: 'PROCESS_MOMENT',
      detail: { processKey: 'cast', moment: { momentType: 'STEP_START', stepKey: 'charge' } }
    }, 'CHARGE')).toEqual([]);
    expect(allowedEventValuesFor({
      eventType: 'PROCESS_MOMENT',
      detail: { processKey: 'cast', moment: { momentType: 'STEP_EXECUTION', stepKey: 'recast' } }
    }, 'RECAST')).toEqual(['STEP_EXECUTION_INDEX', 'RECAST_COUNT']);
    expect(allowedEventValuesFor({
      eventType: 'PROCESS_MOMENT',
      detail: { processKey: 'cast', moment: { momentType: 'STEP_COMPLETE', stepKey: 'recast' } }
    }, 'RECAST')).toEqual(['RECAST_COUNT']);

    expect(allowedEventValuesFor(createEmptyEventSource('LIFECYCLE_MOMENT'))).toEqual([
      'LIFECYCLE_STACKS',
      'REMAINING_MS'
    ]);
    expect(allowedEventValuesFor({
      eventType: 'LIFECYCLE_MOMENT',
      detail: { effectKey: 'mark', moment: 'PERIODIC' }
    })).toEqual(['LIFECYCLE_STACKS', 'REMAINING_MS', 'PERIOD_INDEX']);
    expect(allowedEventValuesFor({
      eventType: 'LIFECYCLE_MOMENT',
      detail: { effectKey: 'mark', moment: 'FULL_STACKS' }
    })).toEqual(['LIFECYCLE_STACKS', 'REMAINING_MS']);

    expect(allowedEventValuesFor(createEmptyEventSource('INTERNAL_STATE_CHANGED'))).toEqual([
      'STATE_BEFORE',
      'STATE_AFTER'
    ]);
    expect(allowedEventValuesFor({
      eventType: 'INTERNAL_STATE_CHANGED',
      detail: { stateKey: 'weapon_mode', changeKind: 'OPTION_SELECTED' }
    })).toEqual([]);
  });
});

describe('forbidden VALUE_REACHED, PERSISTENT event and RESULT_AVAILABLE vs lifecycle', () => {
  it('does not expose VALUE_REACHED and keeps change kinds type-specific', () => {
    expect(SKILL_TRIGGER_EVENT_TYPES).not.toContain('VALUE_REACHED');
    expect(changeKindsForInternalState('COUNTER')).toEqual(['VALUE_CHANGED']);
    expect(changeKindsForInternalState('AMMO')).toEqual(['VALUE_CHANGED']);
    expect(changeKindsForInternalState('MODE')).toEqual(['OPTION_SELECTED']);
    expect(changeKindsForInternalState('FLAG')).toEqual(['FLAG_CHANGED']);
    expect(changeKindsForInternalState('INTERNAL_COOLDOWN')).toEqual(['COOLDOWN_READY']);
    expect(changeKindsForInternalState(null)).not.toContain('VALUE_REACHED');
    expect(createEmptyEventSource('INTERNAL_STATE_CHANGED').detail.changeKind).toBe('VALUE_CHANGED');
  });

  it('does not expose PERSISTENT as a lifecycle event moment', () => {
    expect([...SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENTS]).toEqual([
      'APPLICATION',
      'FULL_STACKS',
      'PERIODIC',
      'NATURAL_END',
      'EARLY_REMOVE'
    ]);
    expect(SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENTS).not.toContain('PERSISTENT');
    expect(createEmptyEventSource('LIFECYCLE_MOMENT').detail.moment).toBe('APPLICATION');
  });

  it('splits RESULT_AVAILABLE to lifecycle-less effects and LIFECYCLE_MOMENT to lifecycle effects', () => {
    const plain: Pick<SkillEffect, 'effectKey' | 'lifecycle' | 'name'> = {
      effectKey: 'on_hit_damage',
      name: '命中伤害',
      lifecycle: null
    };
    const marked: Pick<SkillEffect, 'effectKey' | 'lifecycle' | 'name'> = {
      effectKey: 'focus_mark',
      name: '专注标记',
      lifecycle: {
        durationValue: formulaValue("mark_duration_ms"),
        maxStacksValue: formulaValue("five"),
        applicationStacksValue: formulaValue("one"),
        instanceScope: 'SOURCE_TARGET',
        reapplicationStackMode: 'INCREASE',
        reapplicationDurationMode: 'REFRESH_ALL',
        expiryMode: 'ALL_AT_ONCE',
        periodicIntervalValue: null,
        firstPeriodicExecution: null
      }
    };
    expect(resultAvailableEffects([plain, marked]).map((item) => item.effectKey)).toEqual(['on_hit_damage']);
    expect(lifecycleEventEffects([plain, marked]).map((item) => item.effectKey)).toEqual(['focus_mark']);
  });

  it('selects spell-shield events from complete eligible effect details only', () => {
    const lifecycle = {
      durationValue: null,
      maxStacksValue: formulaValue("one"),
      applicationStacksValue: formulaValue("one"),
      instanceScope: 'SOURCE_TARGET' as const,
      reapplicationStackMode: 'KEEP' as const,
      reapplicationDurationMode: null,
      expiryMode: 'EXPLICIT_ONLY' as const,
      periodicIntervalValue: null,
      firstPeriodicExecution: null
    };
    const eligible: SkillEffect = {
      gameId: 'lol',
      skillKey: 'sivir_e',
      effectKey: 'spell_shield',
      name: '法术护盾',
      description: null,
      sortOrder: 0,
      lifecycle,
      results: [{
        resultKey: 'shield',
        name: '法术护盾',
        resultType: 'SPELL_SHIELD',
        target: 'SOURCE',
        description: null,
        sortOrder: 0,
        spellShieldBlockScope: null,
        lifecycleBehavior: {
          moment: 'PERSISTENT',
          valueReadMode: null,
          stackValueMode: null,
          reapplicationValueMode: null,
          periodicExecutionMode: null
        },
        valueRule: null,
        detail: {}
      }],
      createdAt: '2026-08-31T00:00:00Z',
      updatedAt: '2026-08-31T00:00:00Z'
    };
    const lifecycleWithoutShield: SkillEffect = { ...eligible, effectKey: 'ordinary_buff', results: [] };
    const shieldWithoutLifecycle: SkillEffect = { ...eligible, effectKey: 'broken_shield', lifecycle: null };

    expect(isSpellShieldEventEffect(eligible)).toBe(true);
    expect(isSpellShieldEventEffect(lifecycleWithoutShield)).toBe(false);
    expect(isSpellShieldEventEffect(shieldWithoutLifecycle)).toBe(false);
    expect(spellShieldEventEffects([
      lifecycleWithoutShield,
      eligible,
      shieldWithoutLifecycle
    ]).map((item) => item.effectKey)).toEqual(['spell_shield']);
  });
});

describe('condition, action and runtime-source conversion with stale-field cleanup', () => {
  it('uses exactly eight conditions, three actions and five runtime sources', () => {
    expect([...SKILL_TRIGGER_CONDITION_TYPES]).toEqual([
      'ATTRIBUTE_COMPARE',
      'STATUS_CHECK',
      'LIFECYCLE_CHECK',
      'TARGET_CATEGORY_CHECK',
      'EXPLICIT_TARGET_IS_SOURCE',
      'SKILL_HIT_TARGET_IS_ENEMY',
      'INTERNAL_STATE_CHECK',
      'EVENT_VALUE_COMPARE'
    ]);
    expect([...SKILL_TRIGGER_ACTION_TYPES]).toEqual([
      'EXECUTE_EFFECT',
      'START_PROCESS',
      'FAIL_PROCESS'
    ]);
    expect([...SKILL_TRIGGER_SOURCE_TYPES]).toEqual([
      'INTERNAL_STATE',
      'COMBAT_STATUS',
      'EVENT_VALUE',
      'SOURCE_CAST_RESOURCE_COST',
      'PRIOR_ACTION_RESULT'
    ]);
  });

  it('rebuilds condition details and drops hidden fields of the previous kind', () => {
    const attribute = createEmptyConditionDraft([], 'ATTRIBUTE_COMPARE');
    expect(attribute.detail).toEqual({
      subject: 'CURRENT_TARGET',
      attributeKey: '',
      attributeValueKind: 'CURRENT',
      comparator: 'LTE',
      comparisonValue: { kind: 'FIXED', value: Number.NaN }
    });
    const status = switchConditionType(attribute, 'STATUS_CHECK');
    expect(status.conditionKey).toBe(attribute.conditionKey);
    expect(status.sortOrder).toBe(attribute.sortOrder);
    expect(status.conditionType).toBe('STATUS_CHECK');
    expect(status.detail).toEqual(createEmptyConditionDetail('STATUS_CHECK'));
    expect(status.detail).not.toHaveProperty('attributeKey');

    const stacks = rebuildStatusCheckDetail(status.detail, 'STACKS_COMPARE');
    expect(stacks).toEqual({
      subject: 'CURRENT_TARGET',
      statusKey: '',
      checkKind: 'STACKS_COMPARE',
      sourceEffectKey: '',
      sourceResultKey: '',
      comparator: 'GTE',
      comparisonValue: { kind: 'FIXED', value: Number.NaN }
    });
    expect(rebuildStatusCheckDetail(stacks, 'PRESENT')).toEqual({
      subject: 'CURRENT_TARGET',
      statusKey: '',
      checkKind: 'PRESENT',
      sourceEffectKey: null,
      sourceResultKey: null,
      comparator: null,
      comparisonValue: null
    });

    const valueCheck = createEmptyConditionDraft([], 'INTERNAL_STATE_CHECK');
    const optionCheck = rebuildInternalStateCheckDetail(valueCheck.detail, 'OPTION_SELECTED');
    expect(optionCheck).toEqual({
      stateKey: '',
      valueKind: 'OPTION_SELECTED',
      optionKey: '',
      expectedBoolean: null,
      comparator: null,
      comparisonValue: null
    });
    const enabledCheck = rebuildInternalStateCheckDetail(optionCheck, 'ENABLED');
    expect(enabledCheck).toEqual({
      stateKey: '',
      valueKind: 'ENABLED',
      optionKey: null,
      expectedBoolean: true,
      comparator: null,
      comparisonValue: null
    });
  });

  it('rebuilds action and binding details without leftover kind-specific fields', () => {
    const execute = createEmptyActionDraft([], 'EXECUTE_EFFECT');
    const withModifier: SkillTriggerActionDraft = {
      ...execute,
      actionKey: 'apply_damage',
      name: '造成伤害',
      resultModifiers: [
        { resultKey: 'damage', fixedMultiplier: 2, fixedMinValue: null, fixedMaxValue: null }
      ],
      runtimeInputBindings: [createEmptyBinding([], 'EVENT_VALUE')]
    };
    const fail = switchActionType(withModifier, 'FAIL_PROCESS');
    expect(fail.actionKey).toBe('apply_damage');
    expect(fail.name).toBe('造成伤害');
    expect(fail.actionType).toBe('FAIL_PROCESS');
    expect(fail.targetContext).toBeNull();
    expect(fail.detail).toEqual({ processKey: '', failureReason: 'CONTROLLED' });
    expect(fail.runtimeInputBindings).toEqual([]);
    expect(fail.resultModifiers).toEqual([]);
    expect(fail.detail).not.toHaveProperty('effectKey');

    const start = switchActionType(withModifier, 'START_PROCESS');
    expect(start.detail).toEqual({ processKey: '' });
    expect(start.targetContext).toBe('CURRENT_TARGET');
    expect(start.resultModifiers).toEqual([]);

    const eventBinding = createEmptyBinding(['bind_1'], 'EVENT_VALUE');
    const combat = switchBindingSourceType(eventBinding, 'COMBAT_STATUS');
    expect(combat.bindingKey).toBe(eventBinding.bindingKey);
    expect(combat.parameterKey).toBe(eventBinding.parameterKey);
    expect(combat.detail).toEqual(createEmptyBindingDetail('COMBAT_STATUS'));
    expect(combat.detail).not.toHaveProperty('eventValueKey');
    const stacks = rebuildCombatStatusBindingDetail(combat.detail, 'STACKS');
    expect(stacks.sourceEffectKey).toBe('');
    expect(rebuildCombatStatusBindingDetail(stacks, 'PRESENT').sourceEffectKey).toBeNull();
  });

  it('strips start-process modifiers and fail-process bindings when building requests', () => {
    const draft = createEmptyRuleDraft();
    draft.ruleKey = 'combo';
    draft.name = '组合';
    draft.actions = [
      {
        ...createEmptyActionDraft([], 'START_PROCESS'),
        actionKey: 'start_cast',
        name: '启动过程',
        sortOrder: '10',
        detail: { processKey: 'cast' },
        resultModifiers: [
          { resultKey: 'damage', fixedMultiplier: 2, fixedMinValue: 1, fixedMaxValue: 9 }
        ]
      },
      {
        ...createEmptyActionDraft([], 'FAIL_PROCESS'),
        actionKey: 'fail_cast',
        name: '令过程失败',
        sortOrder: '20',
        detail: { processKey: 'cast', failureReason: 'CONTROLLED' },
        runtimeInputBindings: [createEmptyBinding([], 'INTERNAL_STATE')],
        resultModifiers: [
          { resultKey: 'damage', fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null }
        ]
      }
    ];
    const created = toCreateRequest(draft);
    expect(created.actions[0]).toMatchObject({
      actionType: 'START_PROCESS',
      resultModifiers: [],
      detail: { processKey: 'cast' }
    });
    expect(created.actions[1]).toEqual({
      actionKey: 'fail_cast',
      name: '令过程失败',
      actionType: 'FAIL_PROCESS',
      sortOrder: 20,
      targetContext: null,
      detail: { processKey: 'cast', failureReason: 'CONTROLLED' },
      runtimeInputBindings: [],
      resultModifiers: []
    });
  });
});

describe('detail to draft create/update round-trip', () => {
  it('preserves identifiers, nulls and sort order; create keeps ruleKey and update omits it', () => {
    const draft = fromDetail(RICH_DETAIL);
    expect(draft.ruleKey).toBe('on_hit_combo');
    expect(draft.description).toBe('');
    expect(draft.sortOrder).toBe('20');
    expect(draft.eventSource).toEqual(RICH_DETAIL.eventSource);
    expect(draft.perTargetCooldownEnabled).toBe(true);
    expect(draft.perTargetCooldownDurationValue).toEqual(formulaValue('per_target_cooldown_ms'));
    expect(draft.maxTriggersPerProcessEnabled).toBe(false);

    const created = toCreateRequest(draft);
    expect(created.ruleKey).toBe('on_hit_combo');
    expect(created.description).toBeNull();
    expect(created.sortOrder).toBe(20);
    expect(created.eventSource).toEqual(RICH_DETAIL.eventSource);
    expect(created.conditionGroups).toHaveLength(2);
    expect(created.conditionGroups[0].conditions.map((item: SkillTriggerCondition) => item.conditionType)).toEqual([
      'ATTRIBUTE_COMPARE',
      'STATUS_CHECK'
    ]);
    expect(created.conditionGroups[1].conditions.map((item: SkillTriggerCondition) => item.conditionType)).toEqual([
      'INTERNAL_STATE_CHECK',
      'EVENT_VALUE_COMPARE'
    ]);
    expect(created.actions.map((item: SkillTriggerAction) => item.actionType)).toEqual([
      'EXECUTE_EFFECT',
      'START_PROCESS',
      'FAIL_PROCESS'
    ]);
    expect(created.actions[2].targetContext).toBeNull();
    expect(created.perTargetCooldown).toEqual(RICH_DETAIL.perTargetCooldown);

    const updated = toUpdateRequest(draft);
    expect(updated).not.toHaveProperty('ruleKey');
    expect(updated.name).toBe(created.name);
    expect(updated.eventSource).toEqual(created.eventSource);
    expect(updated.conditionGroups).toEqual(created.conditionGroups);
    expect(updated.actions).toEqual(created.actions);
    expect(updated.perTargetCooldown).toEqual(created.perTargetCooldown);
    expect(updated.maxTriggersPerProcess).toBeNull();
  });

  it('round-trips PROCESS_MOMENT process-limit protection and copies processKey from the event', () => {
    const detail: SkillTriggerRuleDetail = {
      ruleKey: 'charge_cap',
      name: '蓄力次数上限',
      description: '限制单次蓄力触发',
      sortOrder: 5,
      eventSource: {
        eventType: 'PROCESS_MOMENT',
        detail: {
          processKey: 'charge_cast',
          moment: { momentType: 'STEP_EXECUTION', stepKey: 'charge' }
        }
      },
      conditionGroups: [],
      actions: [
        {
          actionKey: 'proc',
          name: '触发',
          actionType: 'EXECUTE_EFFECT',
          sortOrder: 10,
          targetContext: 'CURRENT_TARGET',
          detail: { effectKey: 'bonus' },
          runtimeInputBindings: [],
          resultModifiers: []
        }
      ],
      perTargetCooldown: null,
      maxTriggersPerProcess: {
        processKey: 'charge_cast',
        limitValue: formulaValue("max_triggers")
      }
    };
    const created = toCreateRequest(fromDetail(detail));
    expect(created.ruleKey).toBe('charge_cap');
    expect(created.maxTriggersPerProcess).toEqual({
      processKey: 'charge_cast',
      limitValue: formulaValue("max_triggers")
    });
    expect(toUpdateRequest(fromDetail(detail))).not.toHaveProperty('ruleKey');
  });
});

describe('condition group ordering and OR/AND summaries', () => {
  it('keeps independent draft identities when editable group keys and sort order change', () => {
    const first = createEmptyGroupDraft([]);
    const second = createEmptyGroupDraft([first.groupKey]);
    expect(first.draftId).toBeTruthy();
    expect(second.draftId).not.toBe(first.draftId);
    const renamed = { ...first, groupKey: 'z_target' };
    expect(sortGroupDrafts([renamed, second]).map((group) => group.draftId)).toEqual([second.draftId, first.draftId]);
    const reordered = sortGroupDrafts([{ ...renamed, sortOrder: '0' }, second]);
    expect(reordered.map((group) => group.draftId)).toEqual([first.draftId, second.draftId]);
    expect(reordered[0].groupKey).toBe('z_target');
    expect(reordered[1].groupKey).toBe(second.groupKey);
  });

  it('ignores reloaded draft identities for dirty checks while retaining business changes', () => {
    const baseline = fromDetail(RICH_DETAIL);
    const reloaded = fromDetail(RICH_DETAIL);
    expect(reloaded.conditionGroups[0].draftId).not.toBe(baseline.conditionGroups[0].draftId);
    expect(isTriggerRuleDraftDirty(reloaded, baseline)).toBe(false);
    const changed = { ...reloaded, conditionGroups: reloaded.conditionGroups.map((group, index) => index === 0 ? { ...group, name: '已修改名称' } : group) };
    expect(isTriggerRuleDraftDirty(changed, baseline)).toBe(true);
    expect(isTriggerRuleDraftDirty({ ...reloaded, conditionGroups: reloaded.conditionGroups.map((group, index) => index === 0 ? { ...group, groupKey: 'renamed' } : group) }, baseline)).toBe(true);
    expect(isTriggerRuleDraftDirty({ ...reloaded, conditionGroups: reloaded.conditionGroups.map((group, index) => index === 0 ? { ...group, sortOrder: '900' } : group) }, baseline)).toBe(true);
  });

  it('omits draft identities from create and update payloads and preserves them through cleanup', () => {
    const draft = fromDetail(RICH_DETAIL);
    for (const request of [toCreateRequest(draft), toUpdateRequest(draft)]) {
      expect(JSON.stringify(request)).not.toContain('draftId');
      expect(Object.keys(request.conditionGroups[0]).sort()).toEqual(['conditions', 'groupKey', 'name', 'sortOrder']);
    }
    const cleaned = applyEventSwitchCleanup(draft, createEmptyEventSource('SKILL_USED'));
    expect(cleaned.conditionGroups.map((group) => group.draftId)).toEqual(draft.conditionGroups.map((group) => group.draftId));
  });

  it('sorts groups and conditions by sortOrder then stable key, and summarizes AND within a group', () => {
    expect(SKILL_TRIGGER_CONDITION_GROUP_HINT).toBe(
      '不添加条件时直接触发；多个条件组满足任意一组即可，同一组内必须全部满足。'
    );
    expect(SKILL_TRIGGER_GROUP_OR_LABEL).toBe('或者');
    expect(SKILL_TRIGGER_GROUP_AND_LABEL).toBe('并且');

    const later = createEmptyGroupDraft([]);
    later.groupKey = 'group_b';
    later.name = '后组';
    later.sortOrder = '20';
    later.conditions = [
      { ...createEmptyConditionDraft([], 'EVENT_VALUE_COMPARE'), conditionKey: 'hit', sortOrder: '5' }
    ];
    const earlier = createEmptyGroupDraft([]);
    earlier.groupKey = 'group_a';
    earlier.name = '前组';
    earlier.sortOrder = '10';
    earlier.conditions = [
      {
        ...createEmptyConditionDraft([], 'ATTRIBUTE_COMPARE'),
        conditionKey: 'hp',
        sortOrder: '20',
        detail: {
          subject: 'SOURCE',
          attributeKey: 'hp',
          attributeValueKind: 'CURRENT',
          comparator: 'LTE',
          comparisonValue: formulaValue("threshold")
        }
      },
      {
        ...createEmptyConditionDraft([], 'STATUS_CHECK'),
        conditionKey: 'mark',
        sortOrder: '10',
        detail: {
          subject: 'CURRENT_TARGET',
          statusKey: 'focus_mark',
          checkKind: 'PRESENT',
          sourceEffectKey: null,
          sourceResultKey: null,
          comparator: null,
          comparisonValue: null
        }
      }
    ];
    const tied = createEmptyGroupDraft([]);
    tied.groupKey = 'group_c';
    tied.name = '并列组';
    tied.sortOrder = '10';
    tied.conditions = [createEmptyConditionDraft([], 'INTERNAL_STATE_CHECK')];

    const sorted = sortGroupDrafts([later, tied, earlier]);
    expect(sorted.map((group) => group.groupKey)).toEqual(['group_a', 'group_c', 'group_b']);
    expect(sorted[0].conditions.map((item: SkillTriggerConditionDraft) => item.conditionKey)).toEqual([
      'mark',
      'hp'
    ]);
    expect(sortConditionDrafts(earlier.conditions).map((item) => item.conditionKey)).toEqual(['mark', 'hp']);
    expect(groupConditionSummary(earlier)).toContain(SKILL_TRIGGER_GROUP_AND_LABEL);
    expect(groupConditionSummary(earlier)).toContain('属性比较');
    expect(groupConditionSummary(earlier)).toContain('战斗状态检查');
    expect(groupConditionSummary(earlier).split(` ${SKILL_TRIGGER_GROUP_AND_LABEL} `)).toHaveLength(2);
  });

  it('generates unique temporary keys for new groups and conditions', () => {
    expect(nextDraftKey(['group_1', 'group_2'], 'group')).toBe('group_3');
    const group = createEmptyGroupDraft(['group_1']);
    expect(group.groupKey).toBe('group_2');
    expect(group.conditions).toHaveLength(1);
  });
});

describe('action ordering, FAIL_PROCESS last and source-action binding cleanup', () => {
  it('persists moved action order through the update request and detail readback', () => {
    const execute = executeAction({ actionKey: 'apply_damage', name: '造成伤害', sortOrder: '10' });
    const start: SkillTriggerActionDraft = {
      ...createEmptyActionDraft([], 'START_PROCESS'), actionKey: 'start_cast', name: '启动过程',
      sortOrder: '20', detail: { processKey: 'cast' }
    };
    const moved = moveActionDrafts([execute, start], 0, 1);
    const request = toUpdateRequest({ ...createEmptyRuleDraft(), actions: moved });
    expect(request.actions.map((action) => [action.actionKey, action.sortOrder])).toEqual([
      ['start_cast', 10], ['apply_damage', 20]
    ]);
    const readback = fromDetail({ ruleKey: 'reordered', ...request });
    expect(readback.actions.map((action) => [action.actionKey, action.sortOrder])).toEqual([
      ['start_cast', '10'], ['apply_damage', '20']
    ]);
    expect([execute.sortOrder, start.sortOrder]).toEqual(['10', '20']);
  });

  it('assigns persisted positions when existing tied sort values would undo a move', () => {
    const first = executeAction({ actionKey: 'b_first', sortOrder: '10' });
    const second = executeAction({ actionKey: 'c_second', sortOrder: '10' });
    const third = executeAction({ actionKey: 'a_third', sortOrder: '20' });
    const moved = moveActionDrafts([first, second, third], 1, 1);
    expect(toUpdateRequest({ ...createEmptyRuleDraft(), actions: moved }).actions.map((action) => [action.actionKey, action.sortOrder]))
      .toEqual([['b_first', 10], ['a_third', 20], ['c_second', 30]]);
    const movedTie = moveActionDrafts([first, second], 0, 1);
    expect(sortActionDrafts(movedTie).map((action) => action.actionKey)).toEqual(['c_second', 'b_first']);
  });

  it('keeps numeric action sort edits unchanged in the saved order', () => {
    const first = executeAction({ actionKey: 'first', sortOrder: '30' });
    const second = executeAction({ actionKey: 'second', sortOrder: '20' });
    const request = toUpdateRequest({ ...createEmptyRuleDraft(), actions: ensureFailProcessLast([first, second]) });
    expect(request.actions.map((action) => [action.actionKey, action.sortOrder])).toEqual([['second', 20], ['first', 30]]);
  });

  it('does not move FAIL_PROCESS before another action even when their numeric orders are tied', () => {
    const execute = executeAction({ actionKey: 'a_execute', sortOrder: '10' });
    const fail: SkillTriggerActionDraft = {
      ...createEmptyActionDraft([], 'FAIL_PROCESS'), actionKey: 'z_fail', sortOrder: '10',
      detail: { processKey: 'cast', failureReason: 'CONTROLLED' }
    };
    expect(canMoveAction([execute, fail], 1, -1)).toEqual({ ok: false, message: SKILL_TRIGGER_FAIL_PROCESS_LAST_MESSAGE });
    expect(moveActionDrafts([execute, fail], 0, 1)).toEqual([execute, fail]);
  });

  it('keeps FAIL_PROCESS last and blocks moving it earlier', () => {
    const execute = executeAction({ actionKey: 'apply_damage', sortOrder: '10' });
    const start = createEmptyActionDraft([], 'START_PROCESS');
    const startAction: SkillTriggerActionDraft = {
      ...start,
      actionKey: 'start_cast',
      name: '启动',
      sortOrder: '20',
      detail: { processKey: 'cast' }
    };
    const fail: SkillTriggerActionDraft = {
      ...createEmptyActionDraft([], 'FAIL_PROCESS'),
      actionKey: 'fail_cast',
      name: '失败',
      sortOrder: '5',
      detail: { processKey: 'cast', failureReason: 'CONTROLLED' }
    };
    const disordered = [fail, execute, startAction];
    expect(isFailProcessLast(disordered)).toBe(false);
    expect(failProcessIndex(sortActionDrafts(disordered))).toBe(0);
    const enforced = ensureFailProcessLast(disordered);
    expect(enforced.map((item) => item.actionType)).toEqual([
      'EXECUTE_EFFECT',
      'START_PROCESS',
      'FAIL_PROCESS'
    ]);
    expect(isFailProcessLast(enforced)).toBe(true);
    expect(canMoveAction(enforced, 2, -1)).toEqual({
      ok: false,
      message: SKILL_TRIGGER_FAIL_PROCESS_LAST_MESSAGE
    });
    expect(canMoveAction(enforced, 1, 1)).toEqual({
      ok: false,
      message: SKILL_TRIGGER_FAIL_PROCESS_LAST_MESSAGE
    });
    expect(moveActionDrafts(enforced, 2, -1)).toEqual(enforced);
    expect(canMoveAction(enforced, 0, 1).ok).toBe(true);
    const swapped = sortActionDrafts(moveActionDrafts(enforced, 0, 1));
    expect(swapped.map((item) => item.actionKey)).toEqual(['start_cast', 'apply_damage', 'fail_cast']);
    expect(swapped[2].actionType).toBe('FAIL_PROCESS');
  });

  it('lists and removes dependent prior-result bindings when the source action is removed or moved later', () => {
    const first = executeAction({ actionKey: 'first_hit', name: '第一段', sortOrder: '10' });
    const second = executeAction({
      actionKey: 'second_hit',
      name: '第二段',
      sortOrder: '20',
      runtimeInputBindings: [priorBinding('first_hit')]
    });
    const third = executeAction({
      actionKey: 'third_hit',
      name: '第三段',
      sortOrder: '30',
      runtimeInputBindings: [priorBinding('first_hit', 'bonus')]
    });
    const actions = [first, second, third];
    const impact = findSourceActionCleanupImpact(actions, ['first_hit']);
    expect(impact).toEqual([
      {
        actionKey: 'second_hit',
        bindingKeys: ['bind_first_hit'],
        summaries: ['second_hit / bind_first_hit / damage / 基础配置值']
      },
      {
        actionKey: 'third_hit',
        bindingKeys: ['bind_first_hit'],
        summaries: ['third_hit / bind_first_hit / damage / 基础配置值']
      }
    ]);
    const cleaned = removeBindingsByKeys(
      actions,
      impact.flatMap((item) => item.bindingKeys)
    );
    expect(cleaned[1].runtimeInputBindings).toEqual([]);
    expect(cleaned[2].runtimeInputBindings).toEqual([]);
    expect(cleaned[0].runtimeInputBindings).toEqual([]);

    const reordered = sortActionDrafts(moveActionDrafts(actions, 0, 1));
    expect(reordered.map((item) => item.actionKey)).toEqual(['second_hit', 'first_hit', 'third_hit']);
    const reorderImpact = findSourceActionCleanupImpact(reordered, ['first_hit']);
    expect(reorderImpact.map((item) => item.actionKey)).toEqual(['second_hit', 'third_hit']);
  });
});

describe('process moment step lookup', () => {
  it('resolves PROCESS_MOMENT step types from the selected process', () => {
    const source = {
      eventType: 'PROCESS_MOMENT' as const,
      detail: {
        processKey: 'cast',
        moment: { momentType: 'STEP_EXECUTION' as const, stepKey: 'charge' }
      }
    };
    expect(eventStepType(source, {
      gameId: 'lol',
      skillKey: 'ashe_q',
      processKey: 'cast',
      name: '蓄力',
      activationType: 'ACTIVE',
      description: null,
      sortOrder: 10,
      cooldown: null,
      steps: [
        {
          stepKey: 'charge',
          name: '蓄力',
          description: null,
          sortOrder: 10,
          stepType: 'CHARGE',
          detail: {
            minimumChargeValue: formulaValue("min_charge_ms"),
            maximumChargeValue: formulaValue("max_charge_ms"),
            releaseAtMaximum: true
          }
        }
      ],
      effectBindings: [],
      stateOperations: [],
      createdAt: '2026-08-30T00:00:00Z',
      updatedAt: '2026-08-30T00:00:00Z'
    })).toBe('CHARGE');
    expect(eventStepType(createEmptyEventSource('SKILL_HIT'), null)).toBeNull();
  });
});

describe('hit-link and attack-link events', () => {
  it('round-trips null and explicit source skills without event values or event source', () => {
    const anySkill = {
      ...RICH_DETAIL,
      eventSource: {
        eventType: 'HIT_LINK_APPLIED' as const,
        detail: { sourceSkillKey: null }
      }
    };
    const currentSkill = {
      ...RICH_DETAIL,
      eventSource: {
        eventType: 'ATTACK_LINK_APPLIED' as const,
        detail: { sourceSkillKey: 'ashe_q' }
      }
    };
    expect(fromDetail(anySkill).eventSource).toEqual({
      eventType: 'HIT_LINK_APPLIED',
      detail: { sourceSkillKey: null }
    });
    expect(toCreateRequest(fromDetail(currentSkill)).eventSource).toEqual({
      eventType: 'ATTACK_LINK_APPLIED',
      detail: { sourceSkillKey: 'ashe_q' }
    });
    expect(eventHasEventSource('HIT_LINK_APPLIED')).toBe(false);
    expect(eventHasEventSource('ATTACK_LINK_APPLIED')).toBe(false);
    expect(subjectOptionsForEvent('HIT_LINK_APPLIED')).not.toContain('EVENT_SOURCE');
    expect(SKILL_TRIGGER_PRODUCED_EVENTS_BY_RESULT.EXECUTE).toEqual(['KILL', 'TAKEDOWN', 'ENTITY_DIED']);
    expect(SKILL_TRIGGER_PRODUCED_EVENTS_BY_RESULT.HIT_LINK_APPLICATION).toEqual(['HIT_LINK_APPLIED']);
    expect(SKILL_TRIGGER_PRODUCED_EVENTS_BY_RESULT.ATTACK_LINK_APPLICATION).toEqual(['ATTACK_LINK_APPLIED']);
    expect(SKILL_TRIGGER_RESULT_EVENT_GRAPH_HINT).toContain('来源技能只缩小事件匹配范围');
  });

  it('confirms cleanup when switching from an event-value event and keeps the original draft on cancel', () => {
    const draft = createEmptyRuleDraft();
    draft.eventSource = createEmptyEventSource('SKILL_HIT');
    draft.conditionGroups = [{
      ...createEmptyGroupDraft([]),
      conditions: [{
        ...createEmptyConditionDraft([], 'EVENT_VALUE_COMPARE'),
        conditionKey: 'hit_index',
        detail: {
          eventValueKey: 'HIT_INDEX',
          comparator: 'EQ',
          comparisonValue: formulaValue("one")
        }
      }]
    }];
    const next = createEmptyEventSource('HIT_LINK_APPLIED');
    const impact = analyzeEventSwitchImpact(draft, next);
    expect(impact.clearsEventValues).toBe(true);
    expect(impact.summary).toContain('将清除不再可用的事件值：当前命中序号');
    expect(draft.eventSource.eventType).toBe('SKILL_HIT');
    expect(draft.conditionGroups[0]?.conditions[0]?.conditionType).toBe('EVENT_VALUE_COMPARE');
    const cleaned = applyEventSwitchCleanup(draft, next);
    expect(cleaned.eventSource.eventType).toBe('HIT_LINK_APPLIED');
    expect(cleaned.conditionGroups).toEqual([]);
  });
});

import type { SkillTriggerRecentDamageOutputKind } from './skillSystemEnums.generated';
export type { SkillTriggerRecentDamageOutputKind };
import { SKILL_TRIGGER_TARGET_CATEGORIES } from './skillSystemEnums.generated';
export { SKILL_TRIGGER_TARGET_CATEGORIES };
import type {
  SkillTriggerEventType,
  SkillTriggerConditionType,
  SkillTriggerActionType,
  SkillTriggerRuntimeInputSourceType,
  SkillTriggerEventUseKind,
  SkillTriggerLifecycleEventMoment,
  SkillTriggerSubject,
  SkillTriggerStatusChangeKind,
  SkillTriggerHealthDirection,
  SkillTriggerDamageDeliveryKind,
  SkillTriggerDamageOriginKind,
  SkillTriggerInternalStateChangeKind,
  SkillTriggerEventValueKey,
  SkillTriggerComparator,
  SkillTriggerStatusCheckKind,
  SkillTriggerInternalStateValueKind,
  SkillTriggerTargetContext,
  SkillTriggerCastPhase,
  SkillTriggerCombatStatusValueKind,
  SkillTriggerPriorResultOutputKind,
  SkillTriggerValueDomain,
  SkillTriggerLifecycleCheckKind,
  SkillTriggerTargetCategory,
  SkillTriggerOncePerUseScope
} from './skillSystemEnums.generated';
export type {
  SkillTriggerEventType,
  SkillTriggerConditionType,
  SkillTriggerActionType,
  SkillTriggerRuntimeInputSourceType,
  SkillTriggerEventUseKind,
  SkillTriggerLifecycleEventMoment,
  SkillTriggerSubject,
  SkillTriggerStatusChangeKind,
  SkillTriggerHealthDirection,
  SkillTriggerDamageDeliveryKind,
  SkillTriggerDamageOriginKind,
  SkillTriggerInternalStateChangeKind,
  SkillTriggerEventValueKey,
  SkillTriggerComparator,
  SkillTriggerStatusCheckKind,
  SkillTriggerInternalStateValueKind,
  SkillTriggerTargetContext,
  SkillTriggerCastPhase,
  SkillTriggerCombatStatusValueKind,
  SkillTriggerPriorResultOutputKind,
  SkillTriggerValueDomain,
  SkillTriggerLifecycleCheckKind,
  SkillTriggerTargetCategory,
  SkillTriggerOncePerUseScope
};
import { type NumericValue } from './numericValue';
import type { FormulaAttributeValueKind } from './skillFormula';
import type { SkillProcessFailureReason, SkillProcessMoment } from './skillProcess';

export type SkillTriggerProcessFailureReason = SkillProcessFailureReason;

export type SkillTriggerEmptyDetail = {
  readonly [key: string]: never;
};

export type SkillTriggerSkillUsedEventDetail = {
  sourceSkillKey: string | null;
  useKind: SkillTriggerEventUseKind;
  castPhase: SkillTriggerCastPhase | null;
};

export type SkillTriggerSkillHitEventDetail = {
  sourceSkillKey: string | null;
};

export type SkillTriggerProcessMomentEventDetail = {
  processKey: string;
  moment: SkillProcessMoment;
};
export type SkillTriggerProcessResolvedEventDetail = { sourceSkillKey: string; processKey: string };

export type SkillTriggerResultAvailableEventDetail = {
  effectKey: string;
  resultKey: string;
};

export type SkillTriggerLifecycleMomentEventDetail = {
  effectKey: string;
  moment: SkillTriggerLifecycleEventMoment;
};

export type SkillTriggerDamageEventDetail = {
  sourceSkillKey: string | null;
  damageTypeKey: string | null;
  deliveryKind: SkillTriggerDamageDeliveryKind;
  originKind: SkillTriggerDamageOriginKind;
};

export type SkillTriggerStatusChangedEventDetail = {
  subject: 'SOURCE' | 'CURRENT_TARGET';
  statusKey: string;
  change: SkillTriggerStatusChangeKind;
};

export type SkillTriggerHealthThresholdEventDetail = {
  subject: 'SOURCE' | 'CURRENT_TARGET';
  attributeKey: string;
  thresholdValue: NumericValue;
  direction: SkillTriggerHealthDirection;
};

export type SkillTriggerInternalStateChangedEventDetail = {
  stateSkillKey: string;
  stateKey: string;
  changeKind: SkillTriggerInternalStateChangeKind;
};

export type SkillTriggerSubjectEventDetail = {
  subject: 'SOURCE' | 'CURRENT_TARGET';
};

export type SkillTriggerCancelProcessEventDetail = {
  processKey: string;
};

export type SkillTriggerSpellShieldBlockedEventDetail = {
  shieldEffectKey: string;
};

export type SkillTriggerSkillUsedEventSource = {
  eventType: 'SKILL_USED';
  detail: SkillTriggerSkillUsedEventDetail;
};

export type SkillTriggerSourceInitializedEventSource = {
  eventType: 'SOURCE_INITIALIZED';
  detail: SkillTriggerEmptyDetail;
};

export type SkillTriggerBasicAttackStartEventSource = {
  eventType: 'BASIC_ATTACK_START';
  detail: SkillTriggerEmptyDetail;
};

export type SkillTriggerBasicAttackHitEventSource = {
  eventType: 'BASIC_ATTACK_HIT';
  detail: SkillTriggerEmptyDetail;
};

export type SkillTriggerBasicAttackReceivedEventSource = {
  eventType: 'BASIC_ATTACK_RECEIVED';
  detail: SkillTriggerEmptyDetail;
};

export type SkillTriggerSkillHitEventSource = {
  eventType: 'SKILL_HIT';
  detail: SkillTriggerSkillHitEventDetail;
};

export type SkillTriggerProcessMomentEventSource = {
  eventType: 'PROCESS_MOMENT';
  detail: SkillTriggerProcessMomentEventDetail;
};
export type SkillTriggerProcessResolvedEventSource = { eventType: 'PROCESS_RESOLVED'; detail: SkillTriggerProcessResolvedEventDetail };

export type SkillTriggerResultAvailableEventSource = {
  eventType: 'RESULT_AVAILABLE';
  detail: SkillTriggerResultAvailableEventDetail;
};

export type SkillTriggerLifecycleMomentEventSource = {
  eventType: 'LIFECYCLE_MOMENT';
  detail: SkillTriggerLifecycleMomentEventDetail;
};

export type SkillTriggerDamageDealtEventSource = {
  eventType: 'DAMAGE_DEALT';
  detail: SkillTriggerDamageEventDetail;
};

export type SkillTriggerDamagePendingEventSource = {
  eventType: 'DAMAGE_PENDING';
  detail: SkillTriggerDamageEventDetail;
};

export type SkillTriggerDamageTakenEventSource = {
  eventType: 'DAMAGE_TAKEN';
  detail: SkillTriggerDamageEventDetail;
};

export type SkillTriggerStatusChangedEventSource = {
  eventType: 'STATUS_CHANGED';
  detail: SkillTriggerStatusChangedEventDetail;
};

export type SkillTriggerHealthThresholdEventSource = {
  eventType: 'HEALTH_THRESHOLD_CROSSED';
  detail: SkillTriggerHealthThresholdEventDetail;
};

export type SkillTriggerInternalStateChangedEventSource = {
  eventType: 'INTERNAL_STATE_CHANGED';
  detail: SkillTriggerInternalStateChangedEventDetail;
};

export type SkillTriggerControlReceivedEventSource = {
  eventType: 'CONTROL_RECEIVED';
  detail: SkillTriggerEmptyDetail;
};

export type SkillTriggerEntityDiedEventSource = {
  eventType: 'ENTITY_DIED';
  detail: SkillTriggerSubjectEventDetail;
};

export type SkillTriggerEntityUntargetableEventSource = {
  eventType: 'ENTITY_UNTARGETABLE';
  detail: SkillTriggerSubjectEventDetail;
};

export type SkillTriggerKillEventSource = {
  eventType: 'KILL';
  detail: SkillTriggerEmptyDetail;
};

export type SkillTriggerTakedownEventSource = {
  eventType: 'TAKEDOWN';
  detail: SkillTriggerEmptyDetail;
};

export type SkillTriggerProcessCancelRequestedEventSource = {
  eventType: 'PROCESS_CANCEL_REQUESTED';
  detail: SkillTriggerCancelProcessEventDetail;
};

export type SkillTriggerSpellShieldBlockedEventSource = {
  eventType: 'SPELL_SHIELD_BLOCKED';
  detail: SkillTriggerSpellShieldBlockedEventDetail;
};

export type SkillTriggerHitLinkAppliedEventSource = {
  eventType: 'HIT_LINK_APPLIED';
  detail: SkillTriggerSkillHitEventDetail;
};

export type SkillTriggerAttackLinkAppliedEventSource = {
  eventType: 'ATTACK_LINK_APPLIED';
  detail: SkillTriggerSkillHitEventDetail;
};

export type SkillTriggerEventSource =
  | SkillTriggerSourceInitializedEventSource
  | SkillTriggerSkillUsedEventSource
  | SkillTriggerBasicAttackStartEventSource
  | SkillTriggerBasicAttackHitEventSource
  | SkillTriggerBasicAttackReceivedEventSource
  | SkillTriggerSkillHitEventSource
  | SkillTriggerProcessMomentEventSource
  | SkillTriggerProcessResolvedEventSource
  | SkillTriggerResultAvailableEventSource
  | SkillTriggerLifecycleMomentEventSource
  | SkillTriggerDamagePendingEventSource
  | SkillTriggerDamageDealtEventSource
  | SkillTriggerDamageTakenEventSource
  | SkillTriggerStatusChangedEventSource
  | SkillTriggerHealthThresholdEventSource
  | SkillTriggerInternalStateChangedEventSource
  | SkillTriggerControlReceivedEventSource
  | SkillTriggerEntityDiedEventSource
  | SkillTriggerEntityUntargetableEventSource
  | SkillTriggerKillEventSource
  | SkillTriggerTakedownEventSource
  | SkillTriggerProcessCancelRequestedEventSource
  | SkillTriggerSpellShieldBlockedEventSource
  | SkillTriggerHitLinkAppliedEventSource
  | SkillTriggerAttackLinkAppliedEventSource;

export type SkillTriggerAttributeCompareDetail = {
  subject: SkillTriggerSubject;
  attributeKey: string;
  attributeValueKind: FormulaAttributeValueKind;
  comparator: SkillTriggerComparator;
  comparisonValue: NumericValue;
};

export type SkillTriggerStatusPresenceDetail = {
  subject: SkillTriggerSubject;
  statusKey: string;
  checkKind: 'PRESENT' | 'ABSENT';
  effectSkillKey: null;
  sourceEffectKey: null;
  sourceResultKey: null;
  comparator: null;
  comparisonValue: null;
};

export type SkillTriggerStatusCompareDetail = {
  subject: SkillTriggerSubject;
  statusKey: string;
  checkKind: 'STACKS_COMPARE' | 'REMAINING_MS_COMPARE';
  effectSkillKey: string;
  sourceEffectKey: string;
  sourceResultKey: string;
  comparator: SkillTriggerComparator;
  comparisonValue: NumericValue;
};

export type SkillTriggerStatusCheckDetail =
  | SkillTriggerStatusPresenceDetail
  | SkillTriggerStatusCompareDetail;

export type SkillTriggerLifecycleCheckDetail = {
  effectSkillKey: string;
  effectKey: string;
  subject: SkillTriggerSubject | null;
} & ({
  checkKind: 'PRESENT' | 'ABSENT';
  comparator: null;
  comparisonValue: null;
} | {
  checkKind: 'STACKS_COMPARE';
  comparator: SkillTriggerComparator;
  comparisonValue: NumericValue;
});

export type SkillTriggerInternalStateValueDetail = {
  stateSkillKey: string;
  stateKey: string;
  valueKind: 'VALUE' | 'ATTACK_START_VALUE';
  optionKey: null;
  expectedBoolean: null;
  comparator: SkillTriggerComparator;
  comparisonValue: NumericValue;
};

export type SkillTriggerInternalStateOptionDetail = {
  stateSkillKey: string;
  stateKey: string;
  valueKind: 'OPTION_SELECTED';
  optionKey: string;
  expectedBoolean: null;
  comparator: null;
  comparisonValue: null;
};

export type SkillTriggerInternalStateEnabledDetail = {
  stateSkillKey: string;
  stateKey: string;
  valueKind: 'ENABLED';
  optionKey: null;
  expectedBoolean: boolean;
  comparator: null;
  comparisonValue: null;
};

export type SkillTriggerInternalStateRemainingDetail = {
  stateSkillKey: string;
  stateKey: string;
  valueKind: 'REMAINING_MS';
  optionKey: null;
  expectedBoolean: null;
  comparator: SkillTriggerComparator;
  comparisonValue: NumericValue;
};

export type SkillTriggerInternalStateCheckDetail =
  | SkillTriggerInternalStateValueDetail
  | SkillTriggerInternalStateOptionDetail
  | SkillTriggerInternalStateEnabledDetail
  | SkillTriggerInternalStateRemainingDetail;

export type SkillTriggerEventValueCompareDetail = {
  eventValueKey: SkillTriggerEventValueKey;
  comparator: SkillTriggerComparator;
  comparisonValue: NumericValue;
};

export type SkillTriggerAttributeCompareCondition = {
  conditionKey: string;
  conditionType: 'ATTRIBUTE_COMPARE';
  sortOrder: number;
  detail: SkillTriggerAttributeCompareDetail;
};

export type SkillTriggerStatusCheckCondition = {
  conditionKey: string;
  conditionType: 'STATUS_CHECK';
  sortOrder: number;
  detail: SkillTriggerStatusCheckDetail;
};

export type SkillTriggerInternalStateCheckCondition = {
  conditionKey: string;
  conditionType: 'INTERNAL_STATE_CHECK';
  sortOrder: number;
  detail: SkillTriggerInternalStateCheckDetail;
};

export type SkillTriggerEventValueCompareCondition = {
  conditionKey: string;
  conditionType: 'EVENT_VALUE_COMPARE';
  sortOrder: number;
  detail: SkillTriggerEventValueCompareDetail;
};

export type SkillTriggerCondition =
  | SkillTriggerAttributeCompareCondition
  | SkillTriggerStatusCheckCondition
  | {
      conditionKey: string;
      conditionType: 'LIFECYCLE_CHECK';
      sortOrder: number;
      detail: SkillTriggerLifecycleCheckDetail;
    }
  | {
      conditionKey: string;
      conditionType: 'TARGET_CATEGORY_CHECK';
      sortOrder: number;
      detail: SkillTriggerTargetCategoryCheckDetail;
    }
  | {
      conditionKey: string;
      conditionType: 'EXPLICIT_TARGET_IS_SOURCE';
      sortOrder: number;
      detail: SkillTriggerEmptyDetail;
    }
  | {
      conditionKey: string;
      conditionType: 'SKILL_HIT_TARGET_IS_ENEMY';
      sortOrder: number;
      detail: SkillTriggerEmptyDetail;
    }
  | SkillTriggerInternalStateCheckCondition
  | SkillTriggerEventValueCompareCondition;

export type SkillTriggerTargetCategoryCheckDetail = { categories: SkillTriggerTargetCategory[] };

export type SkillTriggerConditionGroup = {
  groupKey: string;
  name: string;
  sortOrder: number;
  conditions: SkillTriggerCondition[];
};

export type SkillTriggerInternalStateBindingDetail = {
  stateSkillKey: string;
  stateKey: string;
  valueKind: Exclude<SkillTriggerInternalStateValueKind, 'ATTACK_START_VALUE'>;
  optionKey: string | null;
};

export type SkillTriggerCombatStatusPresentBindingDetail = {
  subject: SkillTriggerSubject;
  statusKey: string;
  valueKind: 'PRESENT';
  effectSkillKey: null;
  sourceEffectKey: null;
  sourceResultKey: null;
};

export type SkillTriggerCombatStatusMeasuredBindingDetail = {
  subject: SkillTriggerSubject;
  statusKey: string;
  valueKind: 'STACKS' | 'REMAINING_MS';
  effectSkillKey: string;
  sourceEffectKey: string;
  sourceResultKey: string;
};

export type SkillTriggerCombatStatusBindingDetail =
  | SkillTriggerCombatStatusPresentBindingDetail
  | SkillTriggerCombatStatusMeasuredBindingDetail;

export type SkillTriggerEventValueBindingDetail = {
  eventValueKey: SkillTriggerEventValueKey;
};

export type SkillTriggerCombatElapsedTimeBindingDetail = {
  subject: SkillTriggerSubject;
};

export type SkillTriggerRecentDamageSumBindingDetail = {
  subject: SkillTriggerSubject;
  windowValue: NumericValue;
  outputKind: SkillTriggerRecentDamageOutputKind;
  sourceSkillKey: string | null;
  damageTypeKey: string | null;
  deliveryKind: SkillTriggerDamageDeliveryKind;
  originKind: SkillTriggerDamageOriginKind;
};

export type SkillTriggerSourceCastResourceCostBinding = {
  bindingKey: string;
  parameterKey: string;
  sourceType: 'SOURCE_CAST_RESOURCE_COST';
  detail: { attributeKey: string };
};

export type SkillTriggerSceneAttributeSnapshotBinding = {
  bindingKey: string;
  parameterKey: string;
  sourceType: 'SCENE_ATTRIBUTE_SNAPSHOT';
  detail: {
    subject: 'SOURCE' | 'TARGET';
    attributeKey: string;
    sources: Array<'CHARACTER_LEVEL' | 'EQUIPMENT_DIRECT'>;
  };
};

export type SkillTriggerSceneInitialParameterBinding = {
  bindingKey: string;
  parameterKey: string;
  sourceType: 'SCENE_INITIAL_PARAMETER';
  detail: { minValue: number; maxValue: number };
};

export type SkillTriggerPriorResultBindingDetail = {
  sourceActionKey: string;
  sourceResultKey: string;
  outputKind: SkillTriggerPriorResultOutputKind;
};

export type SkillTriggerInternalStateBinding = {
  bindingKey: string;
  parameterKey: string;
  sourceType: 'INTERNAL_STATE';
  detail: SkillTriggerInternalStateBindingDetail;
};

export type SkillTriggerCombatStatusBinding = {
  bindingKey: string;
  parameterKey: string;
  sourceType: 'COMBAT_STATUS';
  detail: SkillTriggerCombatStatusBindingDetail;
};

export type SkillTriggerEventValueBinding = {
  bindingKey: string;
  parameterKey: string;
  sourceType: 'EVENT_VALUE';
  detail: SkillTriggerEventValueBindingDetail;
};

export type SkillTriggerPriorResultBinding = {
  bindingKey: string;
  parameterKey: string;
  sourceType: 'PRIOR_ACTION_RESULT';
  detail: SkillTriggerPriorResultBindingDetail;
};

export type SkillTriggerCombatElapsedTimeBinding = {
  bindingKey: string;
  parameterKey: string;
  sourceType: 'COMBAT_ELAPSED_TIME';
  detail: SkillTriggerCombatElapsedTimeBindingDetail;
};

export type SkillTriggerRecentDamageSumBinding = {
  bindingKey: string;
  parameterKey: string;
  sourceType: 'RECENT_DAMAGE_SUM';
  detail: SkillTriggerRecentDamageSumBindingDetail;
};

export type SkillTriggerRuntimeInputBinding =
  | SkillTriggerInternalStateBinding
  | SkillTriggerCombatStatusBinding
  | SkillTriggerEventValueBinding
  | SkillTriggerSourceCastResourceCostBinding
  | SkillTriggerSceneAttributeSnapshotBinding
  | SkillTriggerSceneInitialParameterBinding
  | SkillTriggerPriorResultBinding
  | SkillTriggerCombatElapsedTimeBinding
  | SkillTriggerRecentDamageSumBinding;

export type SkillTriggerResultModifier = {
  resultKey: string;
  fixedMultiplier: number | null;
  fixedMinValue: number | null;
  fixedMaxValue: number | null;
};

export type SkillTriggerExecuteEffectAction = {
  actionKey: string;
  name: string;
  actionType: 'EXECUTE_EFFECT';
  sortOrder: number;
  targetContext: SkillTriggerTargetContext;
  detail: { effectKey: string };
  runtimeInputBindings: SkillTriggerRuntimeInputBinding[];
  resultModifiers: SkillTriggerResultModifier[];
};

export type SkillTriggerStartProcessAction = {
  actionKey: string;
  name: string;
  actionType: 'START_PROCESS';
  sortOrder: number;
  targetContext: SkillTriggerTargetContext;
  detail: { processKey: string };
  runtimeInputBindings: SkillTriggerRuntimeInputBinding[];
  resultModifiers: [];
};

export type SkillTriggerFailProcessAction = {
  actionKey: string;
  name: string;
  actionType: 'FAIL_PROCESS';
  sortOrder: number;
  targetContext: null;
  detail: {
    processKey: string;
    failureReason: SkillTriggerProcessFailureReason;
  };
  runtimeInputBindings: [];
  resultModifiers: [];
};

export type SkillTriggerAdvanceProcessAction = {
  actionKey: string;
  name: string;
  actionType: 'ADVANCE_PROCESS';
  sortOrder: number;
  targetContext: null;
  detail: {
    processKey: string;
    stepKey: string;
  };
  runtimeInputBindings: [];
  resultModifiers: [];
};

export type SkillTriggerAction =
  | SkillTriggerExecuteEffectAction
  | SkillTriggerStartProcessAction
  | SkillTriggerFailProcessAction
  | SkillTriggerAdvanceProcessAction;

export type SkillTriggerPerTargetCooldown = {
  durationValue: NumericValue;
  targetContext: SkillTriggerTargetContext;
};

export type SkillTriggerProcessLimit = {
  processKey: string;
  limitValue: NumericValue;
};

export type SkillTriggerOncePerUse = {
  groupKey: string;
  scope: SkillTriggerOncePerUseScope;
};

export type SkillTriggerRuleSummary = {
  ruleKey: string;
  name: string;
  description: string | null;
  eventType: SkillTriggerEventType;
  conditionGroupCount: number;
  actionCount: number;
  perTargetCooldownEnabled: boolean;
  maxTriggersPerProcessEnabled: boolean;
  oncePerUseEnabled: boolean;
  sortOrder: number;
  updatedAt: string;
};

export type SkillTriggerRuleDetail = {
  ruleKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  eventSource: SkillTriggerEventSource;
  conditionGroups: SkillTriggerConditionGroup[];
  actions: SkillTriggerAction[];
  perTargetCooldown: SkillTriggerPerTargetCooldown | null;
  maxTriggersPerProcess: SkillTriggerProcessLimit | null;
  oncePerUse: SkillTriggerOncePerUse | null;
};

export type CreateSkillTriggerRuleRequest = {
  ruleKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  eventSource: SkillTriggerEventSource;
  conditionGroups: SkillTriggerConditionGroup[];
  actions: SkillTriggerAction[];
  perTargetCooldown: SkillTriggerPerTargetCooldown | null;
  maxTriggersPerProcess: SkillTriggerProcessLimit | null;
  oncePerUse: SkillTriggerOncePerUse | null;
};

export type UpdateSkillTriggerRuleRequest = {
  name: string;
  description: string | null;
  sortOrder: number;
  eventSource: SkillTriggerEventSource;
  conditionGroups: SkillTriggerConditionGroup[];
  actions: SkillTriggerAction[];
  perTargetCooldown: SkillTriggerPerTargetCooldown | null;
  maxTriggersPerProcess: SkillTriggerProcessLimit | null;
  oncePerUse: SkillTriggerOncePerUse | null;
};

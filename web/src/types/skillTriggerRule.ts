import type { FormulaAttributeValueKind } from './skillFormula';
import type { SkillProcessMoment } from './skillProcess';

export type SkillTriggerEventType =
  | 'SKILL_USED'
  | 'BASIC_ATTACK_START'
  | 'BASIC_ATTACK_HIT'
  | 'SKILL_HIT'
  | 'PROCESS_MOMENT'
  | 'RESULT_AVAILABLE'
  | 'LIFECYCLE_MOMENT'
  | 'DAMAGE_PENDING'
  | 'DAMAGE_DEALT'
  | 'DAMAGE_TAKEN'
  | 'STATUS_CHANGED'
  | 'HEALTH_THRESHOLD_CROSSED'
  | 'INTERNAL_STATE_CHANGED'
  | 'CONTROL_RECEIVED'
  | 'ENTITY_DIED'
  | 'ENTITY_UNTARGETABLE'
  | 'KILL'
  | 'PROCESS_CANCEL_REQUESTED';

export type SkillTriggerConditionType =
  | 'ATTRIBUTE_COMPARE'
  | 'STATUS_CHECK'
  | 'INTERNAL_STATE_CHECK'
  | 'EVENT_VALUE_COMPARE';

export type SkillTriggerActionType =
  | 'EXECUTE_EFFECT'
  | 'START_PROCESS'
  | 'FAIL_PROCESS';

export type SkillTriggerRuntimeInputSourceType =
  | 'INTERNAL_STATE'
  | 'COMBAT_STATUS'
  | 'EVENT_VALUE'
  | 'PRIOR_ACTION_RESULT';

export type SkillTriggerEventUseKind = 'ACTIVE' | 'CONSUMABLE' | 'ANY';

export type SkillTriggerLifecycleEventMoment =
  | 'APPLICATION'
  | 'FULL_STACKS'
  | 'PERIODIC'
  | 'NATURAL_END'
  | 'EARLY_REMOVE';

export type SkillTriggerSubject = 'SOURCE' | 'CURRENT_TARGET' | 'EVENT_SOURCE';

export type SkillTriggerStatusChangeKind = 'APPLY' | 'REMOVE';

export type SkillTriggerHealthDirection = 'UPWARD' | 'DOWNWARD';

export type SkillTriggerDamageDeliveryKind = 'ANY' | 'SKILL' | 'BASIC_ATTACK';
export type SkillTriggerDamageOriginKind = 'ANY' | 'DIRECT' | 'REFLECTED';

export type SkillTriggerInternalStateChangeKind =
  | 'VALUE_CHANGED'
  | 'OPTION_SELECTED'
  | 'FLAG_CHANGED'
  | 'COOLDOWN_READY';

export type SkillTriggerEventValueKey =
  | 'STEP_EXECUTION_INDEX'
  | 'CHARGE_DURATION_MS'
  | 'RECAST_COUNT'
  | 'HIT_INDEX'
  | 'LIFECYCLE_STACKS'
  | 'PERIOD_INDEX'
  | 'REMAINING_MS'
  | 'STATE_BEFORE'
  | 'STATE_AFTER'
  | 'ATTRIBUTE_BEFORE'
  | 'ATTRIBUTE_AFTER'
  | 'THRESHOLD_VALUE'
  | 'RAW_DAMAGE'
  | 'POST_DEFENSE_DAMAGE'
  | 'HEALTH_BEFORE'
  | 'PROJECTED_HEALTH_AFTER';

export type SkillTriggerComparator = 'LT' | 'LTE' | 'EQ' | 'NE' | 'GTE' | 'GT';

export type SkillTriggerStatusCheckKind =
  | 'PRESENT'
  | 'ABSENT'
  | 'STACKS_COMPARE'
  | 'REMAINING_MS_COMPARE';

export type SkillTriggerInternalStateValueKind =
  | 'VALUE'
  | 'OPTION_SELECTED'
  | 'ENABLED'
  | 'REMAINING_MS';

export type SkillTriggerTargetContext = 'CURRENT_TARGET' | 'EVENT_SOURCE';

export type SkillTriggerProcessFailureReason =
  | 'CONTROLLED'
  | 'SOURCE_DIED'
  | 'TARGET_UNTARGETABLE'
  | 'ACTIVE_CANCELLED'
  | 'EVENT_ABORTED';

export type SkillTriggerCombatStatusValueKind = 'PRESENT' | 'STACKS' | 'REMAINING_MS';

export type SkillTriggerPriorResultOutputKind = 'CONFIGURED_VALUE';

export type SkillTriggerValueDomain = 'INTEGER' | 'DECIMAL';

export type SkillTriggerEmptyDetail = {
  readonly [key: string]: never;
};

export type SkillTriggerSkillUsedEventDetail = {
  sourceSkillKey: string | null;
  useKind: SkillTriggerEventUseKind;
};

export type SkillTriggerSkillHitEventDetail = {
  sourceSkillKey: string | null;
};

export type SkillTriggerProcessMomentEventDetail = {
  processKey: string;
  moment: SkillProcessMoment;
};

export type SkillTriggerResultAvailableEventDetail = {
  effectKey: string;
  resultKey: string;
};

export type SkillTriggerLifecycleMomentEventDetail = {
  effectKey: string;
  moment: SkillTriggerLifecycleEventMoment;
};

export type SkillTriggerDamageEventDetail = {
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
  thresholdFormulaKey: string;
  direction: SkillTriggerHealthDirection;
};

export type SkillTriggerInternalStateChangedEventDetail = {
  stateKey: string;
  changeKind: SkillTriggerInternalStateChangeKind;
};

export type SkillTriggerSubjectEventDetail = {
  subject: 'SOURCE' | 'CURRENT_TARGET';
};

export type SkillTriggerCancelProcessEventDetail = {
  processKey: string;
};

export type SkillTriggerSkillUsedEventSource = {
  eventType: 'SKILL_USED';
  detail: SkillTriggerSkillUsedEventDetail;
};

export type SkillTriggerBasicAttackStartEventSource = {
  eventType: 'BASIC_ATTACK_START';
  detail: SkillTriggerEmptyDetail;
};

export type SkillTriggerBasicAttackHitEventSource = {
  eventType: 'BASIC_ATTACK_HIT';
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

export type SkillTriggerProcessCancelRequestedEventSource = {
  eventType: 'PROCESS_CANCEL_REQUESTED';
  detail: SkillTriggerCancelProcessEventDetail;
};

export type SkillTriggerEventSource =
  | SkillTriggerSkillUsedEventSource
  | SkillTriggerBasicAttackStartEventSource
  | SkillTriggerBasicAttackHitEventSource
  | SkillTriggerSkillHitEventSource
  | SkillTriggerProcessMomentEventSource
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
  | SkillTriggerProcessCancelRequestedEventSource;

export type SkillTriggerAttributeCompareDetail = {
  subject: SkillTriggerSubject;
  attributeKey: string;
  attributeValueKind: FormulaAttributeValueKind;
  comparator: SkillTriggerComparator;
  comparisonFormulaKey: string;
};

export type SkillTriggerStatusPresenceDetail = {
  subject: SkillTriggerSubject;
  statusKey: string;
  checkKind: 'PRESENT' | 'ABSENT';
  sourceEffectKey: null;
  sourceResultKey: null;
  comparator: null;
  comparisonFormulaKey: null;
};

export type SkillTriggerStatusCompareDetail = {
  subject: SkillTriggerSubject;
  statusKey: string;
  checkKind: 'STACKS_COMPARE' | 'REMAINING_MS_COMPARE';
  sourceEffectKey: string;
  sourceResultKey: string;
  comparator: SkillTriggerComparator;
  comparisonFormulaKey: string;
};

export type SkillTriggerStatusCheckDetail =
  | SkillTriggerStatusPresenceDetail
  | SkillTriggerStatusCompareDetail;

export type SkillTriggerInternalStateValueDetail = {
  stateKey: string;
  valueKind: 'VALUE';
  optionKey: null;
  expectedBoolean: null;
  comparator: SkillTriggerComparator;
  comparisonFormulaKey: string;
};

export type SkillTriggerInternalStateOptionDetail = {
  stateKey: string;
  valueKind: 'OPTION_SELECTED';
  optionKey: string;
  expectedBoolean: null;
  comparator: null;
  comparisonFormulaKey: null;
};

export type SkillTriggerInternalStateEnabledDetail = {
  stateKey: string;
  valueKind: 'ENABLED';
  optionKey: null;
  expectedBoolean: boolean;
  comparator: null;
  comparisonFormulaKey: null;
};

export type SkillTriggerInternalStateRemainingDetail = {
  stateKey: string;
  valueKind: 'REMAINING_MS';
  optionKey: null;
  expectedBoolean: null;
  comparator: SkillTriggerComparator;
  comparisonFormulaKey: string;
};

export type SkillTriggerInternalStateCheckDetail =
  | SkillTriggerInternalStateValueDetail
  | SkillTriggerInternalStateOptionDetail
  | SkillTriggerInternalStateEnabledDetail
  | SkillTriggerInternalStateRemainingDetail;

export type SkillTriggerEventValueCompareDetail = {
  eventValueKey: SkillTriggerEventValueKey;
  comparator: SkillTriggerComparator;
  comparisonFormulaKey: string;
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
  | SkillTriggerInternalStateCheckCondition
  | SkillTriggerEventValueCompareCondition;

export type SkillTriggerConditionGroup = {
  groupKey: string;
  name: string;
  sortOrder: number;
  conditions: SkillTriggerCondition[];
};

export type SkillTriggerInternalStateBindingDetail = {
  stateKey: string;
  valueKind: SkillTriggerInternalStateValueKind;
  optionKey: string | null;
};

export type SkillTriggerCombatStatusPresentBindingDetail = {
  subject: SkillTriggerSubject;
  statusKey: string;
  valueKind: 'PRESENT';
  sourceEffectKey: null;
  sourceResultKey: null;
};

export type SkillTriggerCombatStatusMeasuredBindingDetail = {
  subject: SkillTriggerSubject;
  statusKey: string;
  valueKind: 'STACKS' | 'REMAINING_MS';
  sourceEffectKey: string;
  sourceResultKey: string;
};

export type SkillTriggerCombatStatusBindingDetail =
  | SkillTriggerCombatStatusPresentBindingDetail
  | SkillTriggerCombatStatusMeasuredBindingDetail;

export type SkillTriggerEventValueBindingDetail = {
  eventValueKey: SkillTriggerEventValueKey;
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

export type SkillTriggerRuntimeInputBinding =
  | SkillTriggerInternalStateBinding
  | SkillTriggerCombatStatusBinding
  | SkillTriggerEventValueBinding
  | SkillTriggerPriorResultBinding;

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

export type SkillTriggerAction =
  | SkillTriggerExecuteEffectAction
  | SkillTriggerStartProcessAction
  | SkillTriggerFailProcessAction;

export type SkillTriggerPerTargetCooldown = {
  durationFormulaKey: string;
  targetContext: SkillTriggerTargetContext;
};

export type SkillTriggerProcessLimit = {
  processKey: string;
  limitFormulaKey: string;
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
};

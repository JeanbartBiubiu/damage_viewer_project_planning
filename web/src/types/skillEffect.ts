import { type NumericValue } from './numericValue';
export type SkillEffectResultType =
  | 'DAMAGE'
  | 'DIRECT_HEAL'
  | 'NORMAL_SHIELD'
  | 'ATTRIBUTE_CHANGE'
  | 'RESOURCE_CHANGE'
  | 'COOLDOWN_CHANGE'
  | 'STATUS_OPERATION'
  | 'LIFECYCLE_OPERATION'
  | 'DAMAGE_MODIFIER'
  | 'HEALING_MODIFIER'
  | 'SHIELD_RECEIVED_MODIFIER'
  | 'ATTACK_TIMER_RESET'
  | 'DAMAGE_IMMUNITY'
  | 'HEALTH_FLOOR'
  | 'SPELL_SHIELD'
  | 'EXECUTE'
  | 'HIT_LINK_APPLICATION'
  | 'ATTACK_LINK_APPLICATION'
  | 'SKILL_HASTE_MODIFIER';

export type SkillEffectAffectedSkillScopeMode = 'ALL' | 'SKILLS' | 'CATEGORIES';

export interface SkillEffectAffectedSkillScope {
  mode: SkillEffectAffectedSkillScopeMode;
  skillKeys: string[];
  skillCategoryKeys: string[];
}

export type SkillEffectTarget = 'SOURCE' | 'TARGET';
export type SkillEffectSpellShieldBlockScope = 'SKILL' | 'EFFECT' | 'DAMAGE_INSTANCE' | 'RESULT';

export type SkillEffectValueRule = {
  value: NumericValue;
  fixedMultiplier: number;
  fixedMinValue: number | null;
  fixedMaxValue: number | null;
};

export type SkillEffectDamageDeliveryKind = 'SKILL' | 'BASIC_ATTACK';
export type SkillEffectDamageOriginKind = 'DIRECT' | 'REFLECTED';
export type SkillEffectCriticalMode = 'DISALLOWED' | 'SOURCE_CRIT_CHANCE' | 'FORCED';
export type SkillEffectVampType = 'LIFE_STEAL' | 'OMNIVAMP' | 'PHYSICAL_VAMP' | 'SPELL_VAMP';
export type SkillEffectVampBasisOutputKind = 'POST_DEFENSE_DAMAGE' | 'ACTUAL_HP_LOSS';
export type SkillEffectNormalShieldDecayMode = 'NONE' | 'LINEAR_TO_ZERO';
export type SkillEffectModifierOperation = 'INCREASE' | 'DECREASE';
export type SkillEffectDamageModifierDirection = 'DEALT' | 'TAKEN';
export type SkillEffectHealingModifierDirection = 'DONE' | 'RECEIVED';
export type SkillEffectDamageFilterDeliveryKind = 'ANY' | 'SKILL' | 'BASIC_ATTACK';
export type SkillEffectDamageFilterOriginKind = 'ANY' | 'DIRECT' | 'REFLECTED';
export type SkillEffectCriticalFilter = 'ANY' | 'CRITICAL_ONLY' | 'NON_CRITICAL_ONLY';
export type SkillEffectHealingKind = 'ANY' | 'DIRECT' | 'VAMP';

export type SkillEffectCriticalPolicy = {
  mode: SkillEffectCriticalMode;
  multiplierValue: NumericValue | null;
};

/**
 * 当前伤害结果的显式吸血资格、结算依据与效率。
 * 空数组表示没有吸血规则，不会继承默认资格；按已核定来源填写适用规则。
 */
export type SkillEffectVampRule = {
  vampType: SkillEffectVampType;
  basisOutputKind: SkillEffectVampBasisOutputKind;
  efficiencyValue: NumericValue;
};

export type AttributeChangeOperation = 'INCREASE' | 'DECREASE' | 'SET';
export type ResourceChangeOperation = 'RESTORE' | 'CONSUME' | 'REFUND';
export type CooldownChangeOperation = 'REDUCE' | 'INCREASE' | 'RESET' | 'REDUCE_REMAINING_RATIO';
export type StatusOperation = 'APPLY' | 'REMOVE';

export type SkillEffectLifecycleInstanceScope = 'SKILL' | 'SOURCE' | 'TARGET' | 'SOURCE_TARGET';
export type SkillEffectReapplicationStackMode = 'KEEP' | 'INCREASE' | 'REPLACE';
export type SkillEffectReapplicationDurationMode = 'REFRESH_ALL' | 'KEEP_REMAINING' | 'INDEPENDENT';
export type SkillEffectExpiryMode = 'ALL_AT_ONCE' | 'ONE_BY_ONE' | 'INDEPENDENT' | 'EXPLICIT_ONLY';
export type SkillEffectFirstPeriodicExecution = 'IMMEDIATE' | 'AFTER_INTERVAL';

export type SkillEffectLifecycleMoment =
  | 'APPLICATION'
  | 'PERSISTENT'
  | 'FULL_STACKS'
  | 'PERIODIC'
  | 'NATURAL_END'
  | 'EARLY_REMOVE';

export type SkillEffectValueReadMode = 'APPLICATION_SNAPSHOT' | 'MOMENT_EVALUATION';
export type SkillEffectStackValueMode = 'SHARED' | 'PER_STACK';
export type SkillEffectReapplicationValueMode = 'KEEP' | 'REPLACE' | 'ADD';
export type SkillEffectPeriodicExecutionMode = 'ONCE_PER_INSTANCE' | 'ONCE_PER_ACTIVE_STACK';
export type SkillEffectLifecycleOperation =
  | 'INCREASE'
  | 'DECREASE'
  | 'SET'
  | 'REFRESH'
  | 'EXTEND_DURATION'
  | 'CONSUME'
  | 'REMOVE';

export type SkillEffectLifecycle = {
  durationValue: NumericValue | null;
  maxStacksValue: NumericValue;
  applicationStacksValue: NumericValue;
  instanceScope: SkillEffectLifecycleInstanceScope;
  reapplicationStackMode: SkillEffectReapplicationStackMode;
  reapplicationDurationMode: SkillEffectReapplicationDurationMode | null;
  expiryMode: SkillEffectExpiryMode;
  periodicIntervalValue: NumericValue | null;
  firstPeriodicExecution: SkillEffectFirstPeriodicExecution | null;
};

export type SkillEffectResultLifecycleBehavior = {
  moment: SkillEffectLifecycleMoment;
  valueReadMode: SkillEffectValueReadMode | null;
  stackValueMode: SkillEffectStackValueMode | null;
  reapplicationValueMode: SkillEffectReapplicationValueMode | null;
  periodicExecutionMode: SkillEffectPeriodicExecutionMode | null;
};

export type SkillEffectDamageDetail = {
  damageTypeKey: string;
  deliveryKind: SkillEffectDamageDeliveryKind;
  originKind: SkillEffectDamageOriginKind;
  critical: SkillEffectCriticalPolicy;
  vampRules: SkillEffectVampRule[];
};

export type SkillEffectNormalShieldDetail = {
  absorbedDamageTypeKey: string | null;
  decayMode: SkillEffectNormalShieldDecayMode;
};

export type SkillEffectDamageModifierDetail = {
  modifierZoneKey: string;
  direction: SkillEffectDamageModifierDirection;
  operation: SkillEffectModifierOperation;
  damageTypeKey: string | null;
  deliveryKind: SkillEffectDamageFilterDeliveryKind;
  originKind: SkillEffectDamageFilterOriginKind;
  criticalFilter: SkillEffectCriticalFilter;
};

export type SkillEffectHealingModifierDetail = {
  modifierZoneKey: string;
  direction: SkillEffectHealingModifierDirection;
  operation: SkillEffectModifierOperation;
  healingKind: SkillEffectHealingKind;
};

export type SkillEffectShieldReceivedModifierDetail = {
  modifierZoneKey: string;
  operation: SkillEffectModifierOperation;
};

export type SkillEffectDamageImmunityDetail = {
  damageTypeKey: string | null;
  deliveryKind: SkillEffectDamageFilterDeliveryKind;
  originKind: SkillEffectDamageFilterOriginKind;
};

export type SkillEffectHealthFloorDetail = {
  attributeKey: string;
};

export type SkillEffectExecuteDetail = {
  attributeKey: string;
};

export type SkillEffectEmptyDetail = {
  readonly [key: string]: never;
};

export type SkillEffectAttributeChangeDetail = {
  attributeKey: string;
  operation: AttributeChangeOperation;
  modifierZoneKey: string | null;
};

export type SkillEffectResourceChangeDetail = {
  attributeKey: string;
  operation: ResourceChangeOperation;
};

export type SkillEffectCooldownAdjustDetail = {
  affectedSkillScope: SkillEffectAffectedSkillScope;
  operation: 'REDUCE' | 'INCREASE' | 'REDUCE_REMAINING_RATIO';
};

export type SkillEffectCooldownResetDetail = {
  affectedSkillScope: SkillEffectAffectedSkillScope;
  operation: 'RESET';
};

export type SkillEffectSkillHasteModifierDetail = {
  operation: SkillEffectModifierOperation;
  affectedSkillScope: SkillEffectAffectedSkillScope;
};

export type SkillEffectStatusOperationDetail = {
  statusKey: string;
  operation: StatusOperation;
};

export type SkillEffectLifecycleAdjustDetail = {
  targetEffectKey: string;
  operation: 'INCREASE' | 'DECREASE' | 'SET' | 'CONSUME' | 'EXTEND_DURATION';
};

export type SkillEffectLifecycleRefreshRemoveDetail = {
  targetEffectKey: string;
  operation: 'REFRESH' | 'REMOVE';
};

export type SkillEffectLifecycleOperationDetail =
  | SkillEffectLifecycleAdjustDetail
  | SkillEffectLifecycleRefreshRemoveDetail;

type SkillEffectResultBase = {
  resultKey: string;
  name: string;
  target: SkillEffectTarget;
  description: string | null;
  sortOrder: number;
  lifecycleBehavior: SkillEffectResultLifecycleBehavior | null;
  spellShieldBlockScope: SkillEffectSpellShieldBlockScope | null;
};

export type SkillEffectDamageResult = SkillEffectResultBase & {
  resultType: 'DAMAGE';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectDamageDetail;
};

export type SkillEffectDirectHealResult = SkillEffectResultBase & {
  resultType: 'DIRECT_HEAL';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectEmptyDetail;
};

export type SkillEffectNormalShieldResult = SkillEffectResultBase & {
  resultType: 'NORMAL_SHIELD';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectNormalShieldDetail;
};

export type SkillEffectAttributeChangeResult = SkillEffectResultBase & {
  resultType: 'ATTRIBUTE_CHANGE';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectAttributeChangeDetail;
};

export type SkillEffectResourceChangeResult = SkillEffectResultBase & {
  resultType: 'RESOURCE_CHANGE';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectResourceChangeDetail;
};

export type SkillEffectCooldownAdjustResult = SkillEffectResultBase & {
  resultType: 'COOLDOWN_CHANGE';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectCooldownAdjustDetail;
};

export type SkillEffectCooldownResetResult = SkillEffectResultBase & {
  resultType: 'COOLDOWN_CHANGE';
  valueRule: null;
  detail: SkillEffectCooldownResetDetail;
};

export type SkillEffectCooldownChangeResult =
  | SkillEffectCooldownAdjustResult
  | SkillEffectCooldownResetResult;

export type SkillEffectStatusOperationResult = SkillEffectResultBase & {
  resultType: 'STATUS_OPERATION';
  valueRule: SkillEffectValueRule | null;
  detail: SkillEffectStatusOperationDetail;
};

export type SkillEffectLifecycleAdjustResult = SkillEffectResultBase & {
  resultType: 'LIFECYCLE_OPERATION';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectLifecycleAdjustDetail;
};

export type SkillEffectLifecycleRefreshRemoveResult = SkillEffectResultBase & {
  resultType: 'LIFECYCLE_OPERATION';
  valueRule: null;
  detail: SkillEffectLifecycleRefreshRemoveDetail;
};

export type SkillEffectLifecycleOperationResult =
  | SkillEffectLifecycleAdjustResult
  | SkillEffectLifecycleRefreshRemoveResult;

export type SkillEffectDamageModifierResult = SkillEffectResultBase & {
  resultType: 'DAMAGE_MODIFIER';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectDamageModifierDetail;
};

export type SkillEffectHealingModifierResult = SkillEffectResultBase & {
  resultType: 'HEALING_MODIFIER';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectHealingModifierDetail;
};

export type SkillEffectShieldReceivedModifierResult = SkillEffectResultBase & {
  resultType: 'SHIELD_RECEIVED_MODIFIER';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectShieldReceivedModifierDetail;
};

export type SkillEffectDamageImmunityResult = SkillEffectResultBase & {
  resultType: 'DAMAGE_IMMUNITY';
  valueRule: null;
  detail: SkillEffectDamageImmunityDetail;
};

export type SkillEffectHealthFloorResult = SkillEffectResultBase & {
  resultType: 'HEALTH_FLOOR';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectHealthFloorDetail;
};

export type SkillEffectSpellShieldResult = SkillEffectResultBase & {
  resultType: 'SPELL_SHIELD';
  valueRule: null;
  detail: SkillEffectEmptyDetail;
};

export type SkillEffectAttackTimerResetResult = SkillEffectResultBase & {
  resultType: 'ATTACK_TIMER_RESET';
  valueRule: null;
  detail: SkillEffectEmptyDetail;
};

export type SkillEffectExecuteResult = SkillEffectResultBase & {
  resultType: 'EXECUTE';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectExecuteDetail;
};

export type SkillEffectHitLinkApplicationResult = SkillEffectResultBase & {
  resultType: 'HIT_LINK_APPLICATION';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectEmptyDetail;
};

export type SkillEffectAttackLinkApplicationResult = SkillEffectResultBase & {
  resultType: 'ATTACK_LINK_APPLICATION';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectEmptyDetail;
};

export type SkillEffectSkillHasteModifierResult = SkillEffectResultBase & {
  resultType: 'SKILL_HASTE_MODIFIER';
  valueRule: SkillEffectValueRule;
  detail: SkillEffectSkillHasteModifierDetail;
};

export type SkillEffectResult =
  | SkillEffectDamageResult
  | SkillEffectDirectHealResult
  | SkillEffectNormalShieldResult
  | SkillEffectAttributeChangeResult
  | SkillEffectResourceChangeResult
  | SkillEffectCooldownChangeResult
  | SkillEffectStatusOperationResult
  | SkillEffectLifecycleOperationResult
  | SkillEffectDamageModifierResult
  | SkillEffectHealingModifierResult
  | SkillEffectShieldReceivedModifierResult
  | SkillEffectDamageImmunityResult
  | SkillEffectHealthFloorResult
  | SkillEffectSpellShieldResult
  | SkillEffectAttackTimerResetResult
  | SkillEffectExecuteResult
  | SkillEffectHitLinkApplicationResult
  | SkillEffectAttackLinkApplicationResult
  | SkillEffectSkillHasteModifierResult;

export type SkillEffectResultRequest = SkillEffectResult;

export type SkillEffectSummary = {
  gameId: string;
  skillKey: string;
  effectKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  resultCount: number;
  lifecycleEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SkillEffect = {
  gameId: string;
  skillKey: string;
  effectKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  lifecycle: SkillEffectLifecycle | null;
  results: SkillEffectResult[];
  createdAt: string;
  updatedAt: string;
};

export type CreateSkillEffectRequest = {
  effectKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  lifecycle: SkillEffectLifecycle | null;
  results: SkillEffectResultRequest[];
};

export type UpdateSkillEffectRequest = {
  name: string;
  description: string | null;
  sortOrder: number;
  lifecycle: SkillEffectLifecycle | null;
  results: SkillEffectResultRequest[];
};

export type SkillEffectResultType =
  | 'DAMAGE'
  | 'DIRECT_HEAL'
  | 'NORMAL_SHIELD'
  | 'ATTRIBUTE_CHANGE'
  | 'RESOURCE_CHANGE'
  | 'COOLDOWN_CHANGE'
  | 'STATUS_OPERATION'
  | 'LIFECYCLE_OPERATION';

export type SkillEffectTarget = 'SOURCE' | 'TARGET';

export type SkillEffectValueRule = {
  formulaKey: string;
  fixedMultiplier: number;
  fixedMinValue: number | null;
  fixedMaxValue: number | null;
};

export type AttributeChangeOperation = 'INCREASE' | 'DECREASE' | 'SET';
export type ResourceChangeOperation = 'RESTORE' | 'CONSUME' | 'REFUND';
export type CooldownChangeOperation = 'REDUCE' | 'INCREASE' | 'RESET';
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
  | 'CONSUME'
  | 'REMOVE';

export type SkillEffectLifecycle = {
  durationFormulaKey: string | null;
  maxStacksFormulaKey: string;
  applicationStacksFormulaKey: string;
  instanceScope: SkillEffectLifecycleInstanceScope;
  reapplicationStackMode: SkillEffectReapplicationStackMode;
  reapplicationDurationMode: SkillEffectReapplicationDurationMode | null;
  expiryMode: SkillEffectExpiryMode;
  periodicIntervalFormulaKey: string | null;
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
};

export type SkillEffectEmptyDetail = {
  readonly [key: string]: never;
};

export type SkillEffectAttributeChangeDetail = {
  attributeKey: string;
  operation: AttributeChangeOperation;
};

export type SkillEffectResourceChangeDetail = {
  attributeKey: string;
  operation: ResourceChangeOperation;
};

export type SkillEffectCooldownAdjustDetail = {
  affectedSkillKey: string;
  operation: 'REDUCE' | 'INCREASE';
};

export type SkillEffectCooldownResetDetail = {
  affectedSkillKey: string;
  operation: 'RESET';
};

export type SkillEffectStatusOperationDetail = {
  statusKey: string;
  operation: StatusOperation;
};

export type SkillEffectLifecycleAdjustDetail = {
  targetEffectKey: string;
  operation: 'INCREASE' | 'DECREASE' | 'SET' | 'CONSUME';
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
  detail: SkillEffectEmptyDetail;
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
  valueRule: null;
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

export type SkillEffectResult =
  | SkillEffectDamageResult
  | SkillEffectDirectHealResult
  | SkillEffectNormalShieldResult
  | SkillEffectAttributeChangeResult
  | SkillEffectResourceChangeResult
  | SkillEffectCooldownChangeResult
  | SkillEffectStatusOperationResult
  | SkillEffectLifecycleOperationResult;

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

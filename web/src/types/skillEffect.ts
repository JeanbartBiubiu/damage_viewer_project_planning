export type SkillEffectResultType =
  | 'DAMAGE'
  | 'DIRECT_HEAL'
  | 'NORMAL_SHIELD'
  | 'ATTRIBUTE_CHANGE'
  | 'RESOURCE_CHANGE'
  | 'COOLDOWN_CHANGE'
  | 'STATUS_OPERATION';

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

type SkillEffectResultBase = {
  resultKey: string;
  name: string;
  target: SkillEffectTarget;
  description: string | null;
  sortOrder: number;
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

export type SkillEffectResult =
  | SkillEffectDamageResult
  | SkillEffectDirectHealResult
  | SkillEffectNormalShieldResult
  | SkillEffectAttributeChangeResult
  | SkillEffectResourceChangeResult
  | SkillEffectCooldownChangeResult
  | SkillEffectStatusOperationResult;

export type SkillEffectResultRequest = SkillEffectResult;

export type SkillEffectSummary = {
  gameId: string;
  skillKey: string;
  effectKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  resultCount: number;
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
  results: SkillEffectResult[];
  createdAt: string;
  updatedAt: string;
};

export type CreateSkillEffectRequest = {
  effectKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  results: SkillEffectResultRequest[];
};

export type UpdateSkillEffectRequest = {
  name: string;
  description: string | null;
  sortOrder: number;
  results: SkillEffectResultRequest[];
};

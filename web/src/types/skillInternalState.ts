export type SkillInternalStateType =
  | 'COUNTER'
  | 'AMMO'
  | 'MODE'
  | 'FLAG'
  | 'INTERNAL_COOLDOWN';

export type SkillInternalStateScope = 'SKILL' | 'TARGET';

export type SkillInternalStateAmmoRecoveryMode = 'ONE_BY_ONE' | 'ALL_AT_ONCE';

export type SkillInternalStateModeOption = {
  optionKey: string;
  name: string;
  sortOrder: number;
  initial: boolean;
};

export type SkillInternalStateCounterDetail = {
  initialValueFormulaKey: string;
  maxValueFormulaKey: string;
};

export type SkillInternalStateAmmoDetail = {
  initialValueFormulaKey: string;
  maxValueFormulaKey: string;
  recoveryIntervalFormulaKey: string;
  recoveryMode: SkillInternalStateAmmoRecoveryMode;
};

export type SkillInternalStateModeDetail = {
  options: SkillInternalStateModeOption[];
};

export type SkillInternalStateFlagDetail = {
  initialEnabled: boolean;
};

export type SkillInternalStateInternalCooldownDetail = {
  durationFormulaKey: string;
};

type SkillInternalStateBase = {
  gameId: string;
  skillKey: string;
  stateKey: string;
  name: string;
  scope: SkillInternalStateScope;
  description: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type SkillInternalStateCounter = SkillInternalStateBase & {
  stateType: 'COUNTER';
  detail: SkillInternalStateCounterDetail;
};

export type SkillInternalStateAmmo = SkillInternalStateBase & {
  stateType: 'AMMO';
  detail: SkillInternalStateAmmoDetail;
};

export type SkillInternalStateMode = SkillInternalStateBase & {
  stateType: 'MODE';
  detail: SkillInternalStateModeDetail;
};

export type SkillInternalStateFlag = SkillInternalStateBase & {
  stateType: 'FLAG';
  detail: SkillInternalStateFlagDetail;
};

export type SkillInternalStateInternalCooldown = SkillInternalStateBase & {
  stateType: 'INTERNAL_COOLDOWN';
  detail: SkillInternalStateInternalCooldownDetail;
};

export type SkillInternalState =
  | SkillInternalStateCounter
  | SkillInternalStateAmmo
  | SkillInternalStateMode
  | SkillInternalStateFlag
  | SkillInternalStateInternalCooldown;

export type SkillInternalStateSummary = {
  gameId: string;
  skillKey: string;
  stateKey: string;
  name: string;
  stateType: SkillInternalStateType;
  scope: SkillInternalStateScope;
  description: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type CreateSkillInternalStateRequestBase = {
  stateKey: string;
  name: string;
  scope: SkillInternalStateScope;
  description: string | null;
  sortOrder: number;
};

export type CreateSkillInternalStateCounterRequest = CreateSkillInternalStateRequestBase & {
  stateType: 'COUNTER';
  detail: SkillInternalStateCounterDetail;
};

export type CreateSkillInternalStateAmmoRequest = CreateSkillInternalStateRequestBase & {
  stateType: 'AMMO';
  detail: SkillInternalStateAmmoDetail;
};

export type CreateSkillInternalStateModeRequest = CreateSkillInternalStateRequestBase & {
  stateType: 'MODE';
  detail: SkillInternalStateModeDetail;
};

export type CreateSkillInternalStateFlagRequest = CreateSkillInternalStateRequestBase & {
  stateType: 'FLAG';
  detail: SkillInternalStateFlagDetail;
};

export type CreateSkillInternalStateInternalCooldownRequest = CreateSkillInternalStateRequestBase & {
  stateType: 'INTERNAL_COOLDOWN';
  detail: SkillInternalStateInternalCooldownDetail;
};

export type CreateSkillInternalStateRequest =
  | CreateSkillInternalStateCounterRequest
  | CreateSkillInternalStateAmmoRequest
  | CreateSkillInternalStateModeRequest
  | CreateSkillInternalStateFlagRequest
  | CreateSkillInternalStateInternalCooldownRequest;

type UpdateSkillInternalStateRequestBase = {
  name: string;
  scope: SkillInternalStateScope;
  description: string | null;
  sortOrder: number;
};

export type UpdateSkillInternalStateCounterRequest = UpdateSkillInternalStateRequestBase & {
  stateType: 'COUNTER';
  detail: SkillInternalStateCounterDetail;
};

export type UpdateSkillInternalStateAmmoRequest = UpdateSkillInternalStateRequestBase & {
  stateType: 'AMMO';
  detail: SkillInternalStateAmmoDetail;
};

export type UpdateSkillInternalStateModeRequest = UpdateSkillInternalStateRequestBase & {
  stateType: 'MODE';
  detail: SkillInternalStateModeDetail;
};

export type UpdateSkillInternalStateFlagRequest = UpdateSkillInternalStateRequestBase & {
  stateType: 'FLAG';
  detail: SkillInternalStateFlagDetail;
};

export type UpdateSkillInternalStateInternalCooldownRequest = UpdateSkillInternalStateRequestBase & {
  stateType: 'INTERNAL_COOLDOWN';
  detail: SkillInternalStateInternalCooldownDetail;
};

export type UpdateSkillInternalStateRequest =
  | UpdateSkillInternalStateCounterRequest
  | UpdateSkillInternalStateAmmoRequest
  | UpdateSkillInternalStateModeRequest
  | UpdateSkillInternalStateFlagRequest
  | UpdateSkillInternalStateInternalCooldownRequest;

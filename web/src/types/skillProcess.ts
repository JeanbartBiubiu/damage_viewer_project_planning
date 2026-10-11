import type { SkillProcessFirstExecutionKind } from './skillSystemEnums.generated';
export type { SkillProcessFirstExecutionKind };
import type {
  SkillProcessActivationType,
  SkillProcessStepType,
  SkillProcessFirstExecution,
  SkillProcessEmpoweredConsumeMoment,
  SkillProcessProcessMomentType,
  SkillProcessStepMomentType,
  SkillProcessMomentType,
  SkillProcessFailureReason,
  SkillProcessStateOperationKind
} from './skillSystemEnums.generated';
export type {
  SkillProcessActivationType,
  SkillProcessStepType,
  SkillProcessFirstExecution,
  SkillProcessEmpoweredConsumeMoment,
  SkillProcessProcessMomentType,
  SkillProcessStepMomentType,
  SkillProcessMomentType,
  SkillProcessFailureReason,
  SkillProcessStateOperationKind
};
import { type NumericValue } from './numericValue';

export type SkillProcessProcessMoment = {
  momentType: SkillProcessProcessMomentType;
  stepKey: null;
  failureReason: SkillProcessFailureReason | null;
};

export type SkillProcessStepMoment = {
  momentType: SkillProcessStepMomentType;
  stepKey: string;
  failureReason: null;
};

export type SkillProcessMoment = SkillProcessProcessMoment | SkillProcessStepMoment;

export type SkillProcessEmptyDetail = {
  readonly [key: string]: never;
};

export type SkillProcessDelayDetail = {
  delayValue: NumericValue;
};

export type SkillProcessMultiHitDetail = {
  repeatCountValue: NumericValue;
  intervalValue: NumericValue | null;
};

export type SkillProcessPeriodicDetail = {
  repeatCountValue: NumericValue;
  intervalValue: NumericValue;
  firstExecution: SkillProcessFirstExecution;
};

export type SkillProcessChannelDetail = {
  durationValue: NumericValue;
  executionCountValue: NumericValue;
  firstExecution: SkillProcessFirstExecutionKind;
  firstExecutionOffsetValue?: NumericValue;
  lastExecutionOffsetValue?: NumericValue;
};

export type SkillProcessChargeDetail = {
  minimumChargeValue: NumericValue;
  maximumChargeValue: NumericValue;
  releaseAtMaximum: boolean;
};

export type SkillProcessRecastDetail = {
  windowValue: NumericValue;
  maximumRecastCountValue: NumericValue;
};

export type SkillProcessEmpoweredBasicAttackDetail = {
  windowValue: NumericValue;
  consumeMoment: SkillProcessEmpoweredConsumeMoment;
};

type SkillProcessStepBase = {
  stepKey: string;
  occupiesAction?: boolean | null;
  name: string;
  description: string | null;
  sortOrder: number;
};

export type SkillProcessImmediateStep = SkillProcessStepBase & {
  stepType: 'IMMEDIATE';
  detail: SkillProcessEmptyDetail;
};

export type SkillProcessDelayStep = SkillProcessStepBase & {
  stepType: 'DELAY';
  detail: SkillProcessDelayDetail;
};

export type SkillProcessMultiHitStep = SkillProcessStepBase & {
  stepType: 'MULTI_HIT';
  detail: SkillProcessMultiHitDetail;
};

export type SkillProcessPeriodicStep = SkillProcessStepBase & {
  stepType: 'PERIODIC';
  detail: SkillProcessPeriodicDetail;
};

export type SkillProcessChannelStep = SkillProcessStepBase & {
  stepType: 'CHANNEL';
  detail: SkillProcessChannelDetail;
};

export type SkillProcessChargeStep = SkillProcessStepBase & {
  stepType: 'CHARGE';
  detail: SkillProcessChargeDetail;
};

export type SkillProcessRecastStep = SkillProcessStepBase & {
  stepType: 'RECAST';
  detail: SkillProcessRecastDetail;
};

export type SkillProcessEmpoweredBasicAttackStep = SkillProcessStepBase & {
  stepType: 'EMPOWERED_BASIC_ATTACK';
  detail: SkillProcessEmpoweredBasicAttackDetail;
};

export type SkillProcessStep =
  | SkillProcessImmediateStep
  | SkillProcessDelayStep
  | SkillProcessMultiHitStep
  | SkillProcessPeriodicStep
  | SkillProcessChannelStep
  | SkillProcessChargeStep
  | SkillProcessRecastStep
  | SkillProcessEmpoweredBasicAttackStep;

export type SkillProcessCooldown = {
  durationValue: NumericValue;
  startMoment: SkillProcessMoment;
};

export type SkillProcessEffectBinding = {
  bindingKey: string;
  effectKey: string;
  moment: SkillProcessMoment;
  sortOrder: number;
};

type SkillProcessStateOperationBase = {
  operationKey: string;
  name: string;
  stateSkillKey: string;
  stateKey: string;
  moment: SkillProcessMoment;
  sortOrder: number;
};

export type SkillProcessNumericStateOperation = SkillProcessStateOperationBase & {
  operation: 'INCREASE' | 'DECREASE' | 'CONSUME' | 'SET';
  value: NumericValue;
  optionKey: null;
};

export type SkillProcessModeStateOperation = SkillProcessStateOperationBase & {
  operation: 'SELECT';
  value: null;
  optionKey: string;
};

export type SkillProcessFlagStateOperation = SkillProcessStateOperationBase & {
  operation: 'ENABLE' | 'DISABLE' | 'TOGGLE';
  value: null;
  optionKey: null;
};

export type SkillProcessInternalCooldownStateOperation = SkillProcessStateOperationBase & {
  operation: 'START' | 'RESET';
  value: null;
  optionKey: null;
};

export type SkillProcessStateOperation =
  | SkillProcessNumericStateOperation
  | SkillProcessModeStateOperation
  | SkillProcessFlagStateOperation
  | SkillProcessInternalCooldownStateOperation;

export type SkillProcessSummary = {
  gameId: string;
  skillKey: string;
  processKey: string;
  name: string;
  activationType: SkillProcessActivationType;
  description: string | null;
  sortOrder: number;
  stepCount: number;
  effectBindingCount: number;
  stateOperationCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SkillProcess = {
  gameId: string;
  skillKey: string;
  processKey: string;
  name: string;
  activationType: SkillProcessActivationType;
  description: string | null;
  sortOrder: number;
  cooldown: SkillProcessCooldown | null;
  steps: SkillProcessStep[];
  effectBindings: SkillProcessEffectBinding[];
  stateOperations: SkillProcessStateOperation[];
  createdAt: string;
  updatedAt: string;
};

export type CreateSkillProcessRequest = {
  processKey: string;
  name: string;
  activationType: SkillProcessActivationType;
  description: string | null;
  sortOrder: number;
  cooldown: SkillProcessCooldown | null;
  steps: SkillProcessStep[];
  effectBindings: SkillProcessEffectBinding[];
  stateOperations: SkillProcessStateOperation[];
};

export type UpdateSkillProcessRequest = {
  name: string;
  activationType: SkillProcessActivationType;
  description: string | null;
  sortOrder: number;
  cooldown: SkillProcessCooldown | null;
  steps: SkillProcessStep[];
  effectBindings: SkillProcessEffectBinding[];
  stateOperations: SkillProcessStateOperation[];
};

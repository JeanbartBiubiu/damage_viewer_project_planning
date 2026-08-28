export type SkillProcessActivationType = 'ACTIVE' | 'PASSIVE' | 'CONSUMABLE';

export type SkillProcessStepType =
  | 'IMMEDIATE'
  | 'DELAY'
  | 'MULTI_HIT'
  | 'PERIODIC'
  | 'CHANNEL'
  | 'CHARGE'
  | 'RECAST'
  | 'EMPOWERED_BASIC_ATTACK';

export type SkillProcessFirstExecution = 'IMMEDIATE' | 'AFTER_INTERVAL';

export type SkillProcessEmpoweredConsumeMoment = 'ATTACK_START' | 'ATTACK_HIT';

export type SkillProcessProcessMomentType =
  | 'PROCESS_START'
  | 'PROCESS_COMPLETE'
  | 'PROCESS_FAILURE';

export type SkillProcessStepMomentType =
  | 'STEP_START'
  | 'STEP_EXECUTION'
  | 'STEP_COMPLETE'
  | 'STEP_TIMEOUT';

export type SkillProcessMomentType = SkillProcessProcessMomentType | SkillProcessStepMomentType;

export type SkillProcessProcessMoment = {
  momentType: SkillProcessProcessMomentType;
  stepKey: null;
};

export type SkillProcessStepMoment = {
  momentType: SkillProcessStepMomentType;
  stepKey: string;
};

export type SkillProcessMoment = SkillProcessProcessMoment | SkillProcessStepMoment;

export type SkillProcessEmptyDetail = {
  readonly [key: string]: never;
};

export type SkillProcessDelayDetail = {
  delayFormulaKey: string;
};

export type SkillProcessMultiHitDetail = {
  repeatCountFormulaKey: string;
  intervalFormulaKey: string | null;
};

export type SkillProcessPeriodicDetail = {
  repeatCountFormulaKey: string;
  intervalFormulaKey: string;
  firstExecution: SkillProcessFirstExecution;
};

export type SkillProcessChannelDetail = {
  durationFormulaKey: string;
  executionCountFormulaKey: string;
  firstExecution: SkillProcessFirstExecution;
};

export type SkillProcessChargeDetail = {
  minimumChargeFormulaKey: string;
  maximumChargeFormulaKey: string;
  releaseAtMaximum: boolean;
};

export type SkillProcessRecastDetail = {
  windowFormulaKey: string;
  maximumRecastCountFormulaKey: string;
};

export type SkillProcessEmpoweredBasicAttackDetail = {
  windowFormulaKey: string;
  consumeMoment: SkillProcessEmpoweredConsumeMoment;
};

type SkillProcessStepBase = {
  stepKey: string;
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
  durationFormulaKey: string;
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
  stateKey: string;
  moment: SkillProcessMoment;
  sortOrder: number;
};

export type SkillProcessNumericStateOperation = SkillProcessStateOperationBase & {
  operation: 'INCREASE' | 'DECREASE' | 'CONSUME' | 'SET';
  valueFormulaKey: string;
  optionKey: null;
};

export type SkillProcessModeStateOperation = SkillProcessStateOperationBase & {
  operation: 'SELECT';
  valueFormulaKey: null;
  optionKey: string;
};

export type SkillProcessFlagStateOperation = SkillProcessStateOperationBase & {
  operation: 'ENABLE' | 'DISABLE' | 'TOGGLE';
  valueFormulaKey: null;
  optionKey: null;
};

export type SkillProcessInternalCooldownStateOperation = SkillProcessStateOperationBase & {
  operation: 'START' | 'RESET';
  valueFormulaKey: null;
  optionKey: null;
};

export type SkillProcessStateOperation =
  | SkillProcessNumericStateOperation
  | SkillProcessModeStateOperation
  | SkillProcessFlagStateOperation
  | SkillProcessInternalCooldownStateOperation;

export type SkillProcessStateOperationKind = SkillProcessStateOperation['operation'];

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

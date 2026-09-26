import type { Skill, UpdateSkillRequest } from './skill';
import type { SkillEffect } from './skillEffect';
import type { CreateSkillEffectRequest, UpdateSkillEffectRequest } from './skillEffect';
import type { SkillFormula } from './skillFormula';
import type { CreateSkillFormulaRequest, UpdateSkillFormulaRequest } from './skillFormula';
import type { SkillInternalState } from './skillInternalState';
import type { CreateSkillInternalStateRequest, UpdateSkillInternalStateRequest } from './skillInternalState';
import type {
  CreateSkillParameterRequest,
  SkillParameter,
  UpdateSkillParameterRequest
} from './skillParameter';
import type { CreateSkillProcessRequest, SkillProcess, UpdateSkillProcessRequest } from './skillProcess';
import type { CreateSkillTriggerRuleRequest, SkillTriggerRuleDetail, UpdateSkillTriggerRuleRequest } from './skillTriggerRule';

export type SkillConfiguration = {
  skill: Skill;
  parameters: SkillParameter[];
  formulas: SkillFormula[];
  effects: SkillEffect[];
  processes: SkillProcess[];
  internalStates: SkillInternalState[];
  triggerRules: SkillTriggerRuleDetail[];
  baseDigest: string;
};

export type ParameterConfigurationChange =
  | { objectType: 'PARAMETER'; operation: 'CREATE'; key: string; value: CreateSkillParameterRequest }
  | { objectType: 'PARAMETER'; operation: 'UPDATE'; key: string; value: UpdateSkillParameterRequest }
  | { objectType: 'PARAMETER'; operation: 'DELETE'; key: string };

export type FormulaConfigurationChange =
  | { objectType: 'FORMULA'; operation: 'CREATE'; key: string; value: CreateSkillFormulaRequest }
  | { objectType: 'FORMULA'; operation: 'UPDATE'; key: string; value: UpdateSkillFormulaRequest }
  | { objectType: 'FORMULA'; operation: 'DELETE'; key: string };

export type InternalStateConfigurationChange =
  | { objectType: 'INTERNAL_STATE'; operation: 'CREATE'; key: string; value: CreateSkillInternalStateRequest }
  | { objectType: 'INTERNAL_STATE'; operation: 'UPDATE'; key: string; value: UpdateSkillInternalStateRequest }
  | { objectType: 'INTERNAL_STATE'; operation: 'DELETE'; key: string };

export type EffectConfigurationChange =
  | { objectType: 'EFFECT'; operation: 'CREATE'; key: string; value: CreateSkillEffectRequest }
  | { objectType: 'EFFECT'; operation: 'UPDATE'; key: string; value: UpdateSkillEffectRequest }
  | { objectType: 'EFFECT'; operation: 'DELETE'; key: string };

export type ProcessConfigurationChange =
  | { objectType: 'PROCESS'; operation: 'CREATE'; key: string; value: CreateSkillProcessRequest }
  | { objectType: 'PROCESS'; operation: 'UPDATE'; key: string; value: UpdateSkillProcessRequest }
  | { objectType: 'PROCESS'; operation: 'DELETE'; key: string };

export type TriggerRuleConfigurationChange =
  | { objectType: 'TRIGGER_RULE'; operation: 'CREATE'; key: string; value: CreateSkillTriggerRuleRequest }
  | { objectType: 'TRIGGER_RULE'; operation: 'UPDATE'; key: string; value: UpdateSkillTriggerRuleRequest }
  | { objectType: 'TRIGGER_RULE'; operation: 'DELETE'; key: string };

export type SkillConfigurationChange = ParameterConfigurationChange | FormulaConfigurationChange
  | InternalStateConfigurationChange | EffectConfigurationChange | ProcessConfigurationChange
  | TriggerRuleConfigurationChange;

export type CreateSkillConfigurationRequest = {
  skill: UpdateSkillRequest;
  changes: SkillConfigurationChange[];
};

export type UpdateSkillConfigurationRequest = {
  baseDigest: string;
  skill?: UpdateSkillRequest;
  changes: SkillConfigurationChange[];
};

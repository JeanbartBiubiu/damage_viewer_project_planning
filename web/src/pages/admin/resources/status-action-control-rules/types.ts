import type { StatusActionControlRule } from '../../../../types/api';

export type StatusActionControlRulesRecord = StatusActionControlRule;

export type StatusActionControlRulesSearchData = {
  ruleId: string;
  statusTypeId: string;
  ruleKind: string;
};

export type StatusActionControlRulesFormData = {
  ruleId: string;
  statusTypeId: string;
  ruleKind: string;
  actionTypeIdsText: string;
  actionMatchTypeIdsText: string;
  interruptPhaseTypeIdsText: string;
  priority: string;
  description: string;
  extendText: string;
};

import type { StatusActionControlRulesFormData, StatusActionControlRulesSearchData } from './types';

export const STATUS_ACTION_CONTROL_RULE_KIND_OPTIONS = [
  { label: 'forbid', value: 'forbid' },
  { label: 'interrupt', value: 'interrupt' },
  { label: 'limit', value: 'limit' }
];

export function createStatusActionControlRulesSearchData(): StatusActionControlRulesSearchData {
  return {
    ruleId: '',
    statusTypeId: '',
    ruleKind: ''
  };
}

export function createStatusActionControlRulesFormData(): StatusActionControlRulesFormData {
  return {
    ruleId: '',
    statusTypeId: '',
    ruleKind: 'forbid',
    actionTypeIdsText: '[\n  \n]',
    actionMatchTypeIdsText: '[\n  \n]',
    interruptPhaseTypeIdsText: '[\n  \n]',
    priority: '100',
    description: '',
    extendText: '{\n  \n}'
  };
}

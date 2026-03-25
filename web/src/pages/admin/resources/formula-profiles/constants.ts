import type { FormulaProfilesFormData, FormulaProfilesSearchData } from './types';

export const FORMULA_PROFILE_TYPE_OPTIONS = [
  { label: 'damage', value: 'damage' },
  { label: 'heal', value: 'heal' },
  { label: 'shield', value: 'shield' },
  { label: 'custom', value: 'custom' }
];

export const FORMULA_PROFILE_KIND_OPTIONS = [
  { label: 'base', value: 'base' },
  { label: 'linear', value: 'linear' },
  { label: 'ratio', value: 'ratio' },
  { label: 'custom', value: 'custom' }
];

export function createFormulaProfilesSearchData(): FormulaProfilesSearchData {
  return {
    formulaId: '',
    formulaType: '',
    formulaKind: ''
  };
}

export function createFormulaProfilesFormData(): FormulaProfilesFormData {
  return {
    formulaId: '',
    formulaType: '',
    formulaKind: '',
    description: '',
    paramsText: '{\n  \n}'
  };
}

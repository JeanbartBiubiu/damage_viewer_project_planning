import type { FormulaBindingsFormData, FormulaBindingsSearchData } from './types';

export const FORMULA_BINDING_TARGET_CATEGORY_OPTIONS = [
  { label: 'skill', value: 'skill' },
  { label: 'character', value: 'character' },
  { label: 'attribute', value: 'attribute' },
  { label: 'equipment', value: 'equipment' },
  { label: 'type', value: 'type' }
];

export function createFormulaBindingsSearchData(): FormulaBindingsSearchData {
  return {
    targetCategory: '',
    targetId: '',
    bindingKey: '',
    formulaId: ''
  };
}

export function createFormulaBindingsFormData(): FormulaBindingsFormData {
  return {
    targetCategory: '',
    targetId: '',
    bindingKey: '',
    formulaId: '',
    overrideParamsText: '{\n  \n}'
  };
}

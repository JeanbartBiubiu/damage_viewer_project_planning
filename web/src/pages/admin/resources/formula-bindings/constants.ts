import { createEmptyFormulaParamsText } from '../../../../components/formula-editor/formulaModels';
import type { FormulaBindingsFormData, FormulaBindingsSearchData } from './types';

export const FORMULA_BINDING_TARGET_CATEGORY_OPTIONS = [
  { label: '技能', value: 'skill' },
  { label: '英雄', value: 'hero' },
  { label: '装备', value: 'item' },
  { label: '全局', value: 'global' }
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
    overrideParamsText: createEmptyFormulaParamsText(),
    extraFieldsText: '{\n  \n}'
  };
}

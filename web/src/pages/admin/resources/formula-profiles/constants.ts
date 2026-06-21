import { createEmptyFormulaParamsText } from '../../../../components/formula-editor/formulaModels';
import type { FormulaProfilesFormData, FormulaProfilesSearchData } from './types';

export const FORMULA_PROFILE_TYPE_OPTIONS = [
  { label: '冷却', value: 'cooldown' },
  { label: '回复', value: 'regen' },
  { label: '属性', value: 'attribute' },
  { label: '伤害', value: 'damage' },
  { label: '资源消耗', value: 'resource_cost' },
  { label: '其他', value: 'other' }
];

export const FORMULA_PROFILE_KIND_OPTIONS = [
  { label: '变量表达式', value: 'vars_expr' },
  { label: '扁平参数', value: 'flat_params' },
  { label: '抽象语法树', value: 'ast' },
  { label: '基础型', value: 'base' },
  { label: '线性', value: 'linear' },
  { label: '比例', value: 'ratio' },
  { label: '自定义', value: 'custom' }
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
    damageTypeId: '',
    description: '',
    paramsText: createEmptyFormulaParamsText(),
    extraFieldsText: '{\n  \n}'
  };
}

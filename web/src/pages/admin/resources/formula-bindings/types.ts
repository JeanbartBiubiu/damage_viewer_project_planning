import type { FormulaBinding } from '../../../../types/api';

export type FormulaBindingsRecord = FormulaBinding;

export type FormulaBindingsSearchData = {
  targetCategory: string;
  targetId: string;
  bindingKey: string;
  formulaId: string;
};

export type FormulaBindingsFormData = {
  targetCategory: string;
  targetId: string;
  bindingKey: string;
  formulaId: string;
  overrideParamsText: string;
  extraFieldsText: string;
};

import type { FormulaProfile } from '../../../../types/api';

export type FormulaProfilesRecord = FormulaProfile;

export type FormulaProfilesSearchData = {
  formulaId: string;
  formulaType: string;
  formulaKind: string;
};

export type FormulaProfilesFormData = {
  formulaId: string;
  formulaType: string;
  formulaKind: string;
  damageTypeId: string;
  description: string;
  paramsText: string;
  extraFieldsText: string;
};

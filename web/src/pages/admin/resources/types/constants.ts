import type { TypesFormData, TypesSearchData } from './types';

export function createTypesSearchData(): TypesSearchData {
  return {
    typeId: '',
    name: ''
  };
}

export function createTypesFormData(): TypesFormData {
  return {
    typeId: '',
    name: '',
    description: '',
    reservedTypeId: '',
    parentTypeId: ''
  };
}

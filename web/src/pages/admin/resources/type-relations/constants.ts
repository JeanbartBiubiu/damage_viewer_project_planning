import type { TypeRelationsFormData, TypeRelationsSearchData } from './types';

export function createTypeRelationsSearchData(): TypeRelationsSearchData {
  return {
    typeId: '',
    targetCategory: '',
    targetId: ''
  };
}

export function createTypeRelationsFormData(): TypeRelationsFormData {
  return {
    typeId: '',
    targetCategory: '',
    targetId: '',
    extendText: '{\n  \n}'
  };
}

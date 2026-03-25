import type { AttributeDefinitionsFormData, AttributeDefinitionsSearchData } from './types';

export const ATTRIBUTE_VALUE_KIND_OPTIONS = [
  { label: 'scalar', value: 'scalar' },
  { label: 'ratio', value: 'ratio' },
  { label: 'rate', value: 'rate' },
  { label: 'flag', value: 'flag' }
];

export function createAttributeDefinitionsSearchData(): AttributeDefinitionsSearchData {
  return {
    attrKey: '',
    attrName: '',
    attrType: '',
    valueKind: ''
  };
}

export function createAttributeDefinitionsFormData(): AttributeDefinitionsFormData {
  return {
    attrKey: '',
    attrName: '',
    attrType: '',
    defaultValue: '0',
    valueKind: 'scalar',
    rateTargetAttrKey: ''
  };
}

import type { AttributeDefinitionsFormData, AttributeDefinitionsSearchData } from './types';

export const ATTRIBUTE_VALUE_KIND_OPTIONS = [
  { label: '数值', value: 'scalar' },
  { label: '比值', value: 'ratio' },
  { label: '比率', value: 'rate' },
  { label: '标记', value: 'flag' }
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
    attrType: 'number',
    defaultValue: '0',
    valueKind: 'scalar',
    rateTargetAttrKey: ''
  };
}

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
    order: '0',
    valueKind: 'scalar',
    rateTargetAttrKey: ''
  };
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function resolveAttributeOrder(record: { order?: unknown; sortOrder?: unknown }): number | undefined {
  const order = toFiniteNumber(record.order);
  if (order !== undefined) {
    return order;
  }
  return toFiniteNumber(record.sortOrder);
}

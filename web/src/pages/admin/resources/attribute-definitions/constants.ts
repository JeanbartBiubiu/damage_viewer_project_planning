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
    rateTargetAttrKey: '',
    hasMinValue: false,
    minValue: '0',
    hasMaxValue: false,
    maxValue: '1'
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

export function validateAttributeBoundsForm(formData: AttributeDefinitionsFormData): void {
  if (formData.hasMinValue) {
    const minValue = Number(formData.minValue.trim());
    if (!Number.isFinite(minValue)) {
      throw new Error('启用下界时 minValue 必须是有限数字');
    }
  }

  if (formData.hasMaxValue) {
    const maxValue = Number(formData.maxValue.trim());
    if (!Number.isFinite(maxValue)) {
      throw new Error('启用上界时 maxValue 必须是有限数字');
    }
  }

  if (formData.hasMinValue && formData.hasMaxValue) {
    const minValue = Number(formData.minValue.trim());
    const maxValue = Number(formData.maxValue.trim());
    if (Number.isFinite(minValue) && Number.isFinite(maxValue) && minValue > maxValue) {
      throw new Error('同时启用上下界时，minValue 不能大于 maxValue');
    }
  }
}

export function collectAttributeBoundsWarnings(formData: AttributeDefinitionsFormData): string[] {
  const warnings: string[] = [];
  const attrKey = formData.attrKey.trim();

  if (formData.valueKind === 'rate' && !hasExplicitZeroOneBounds(formData)) {
    warnings.push('valueKind=rate 建议配置显式 [0,1] 上下界');
  }

  if ((attrKey === 'crit_chance' || attrKey === 'critChance') && !hasCritChanceUpperBoundOne(formData)) {
    warnings.push('crit_chance / critChance 建议配置上界 maxValue=1');
  }

  if (attrKey === 'crit_damage' && formData.hasMaxValue) {
    const maxValue = Number(formData.maxValue.trim());
    if (Number.isFinite(maxValue) && maxValue < 1) {
      warnings.push('crit_damage 上界 maxValue 小于 1 可能导致暴击伤害语义异常');
    }
  }

  return warnings;
}

export function formatAttributeBoundsLabel(record: {
  minValue?: number;
  maxValue?: number;
  hasClampMin?: boolean;
  clampMin?: number;
  hasClampMax?: boolean;
  clampMax?: number;
}): string {
  const minValue = resolveDisplayMinValue(record);
  const maxValue = resolveDisplayMaxValue(record);
  const hasMin = minValue !== undefined;
  const hasMax = maxValue !== undefined;
  if (!hasMin && !hasMax) {
    return '—';
  }
  const minLabel = hasMin ? formatBoundEndpoint(minValue) : '∅';
  const maxLabel = hasMax ? formatBoundEndpoint(maxValue) : '∅';
  return `[${minLabel}, ${maxLabel}]`;
}

function resolveDisplayMinValue(record: {
  minValue?: number;
  hasClampMin?: boolean;
  clampMin?: number;
}): number | undefined {
  const minValue = toFiniteNumber(record.minValue);
  if (minValue !== undefined) {
    return minValue;
  }
  if (record.hasClampMin === true) {
    return toFiniteNumber(record.clampMin);
  }
  return undefined;
}

function resolveDisplayMaxValue(record: {
  maxValue?: number;
  hasClampMax?: boolean;
  clampMax?: number;
}): number | undefined {
  const maxValue = toFiniteNumber(record.maxValue);
  if (maxValue !== undefined) {
    return maxValue;
  }
  if (record.hasClampMax === true) {
    return toFiniteNumber(record.clampMax);
  }
  return undefined;
}

function hasExplicitZeroOneBounds(formData: AttributeDefinitionsFormData): boolean {
  if (!formData.hasMinValue || !formData.hasMaxValue) {
    return false;
  }
  const minValue = Number(formData.minValue.trim());
  const maxValue = Number(formData.maxValue.trim());
  return Number.isFinite(minValue) && Number.isFinite(maxValue) && minValue === 0 && maxValue === 1;
}

function hasCritChanceUpperBoundOne(formData: AttributeDefinitionsFormData): boolean {
  if (!formData.hasMaxValue) {
    return false;
  }
  const maxValue = Number(formData.maxValue.trim());
  return Number.isFinite(maxValue) && maxValue === 1;
}

function formatBoundEndpoint(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '?' : String(value);
}

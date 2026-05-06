import { RESERVED_TYPE_IDS, findTypeIdByReservedTypeId } from '../../../../config/reservedTypes';
import type { TypeDefinition } from '../../../../types/api';

export type DamageTypeOption = {
  label: string;
  value: string;
};

export function buildDamageTypeOptions(
  types: TypeDefinition[],
  parentTypeIdsByChildId: Map<number, number[]>
): DamageTypeOption[] {
  const damageTypeGroupId = findTypeIdByReservedTypeId(types, RESERVED_TYPE_IDS.DAMAGE_TYPE_GROUP);
  if (!damageTypeGroupId) {
    return [];
  }

  return types
    .filter((type) => (parentTypeIdsByChildId.get(type.typeId) ?? []).includes(damageTypeGroupId))
    .map((type) => ({
      label: formatDamageTypeLabel(type),
      value: String(type.typeId)
    }));
}

export function buildDamageTypeLabelMap(options: DamageTypeOption[]): Map<string, string> {
  return new Map(options.map((option) => [option.value, option.label]));
}

export function normalizeDamageTypeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }

  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0 && Number.isInteger(numeric)) {
    return String(numeric);
  }

  return trimmed;
}

export function appendCurrentDamageTypeOption(
  options: DamageTypeOption[],
  currentValue: unknown,
  currentLabel?: string
): DamageTypeOption[] {
  const normalizedValue = normalizeDamageTypeValue(currentValue);
  if (!normalizedValue || options.some((option) => option.value === normalizedValue)) {
    return options;
  }

  return [
    ...options,
    {
      label: currentLabel?.trim() || `${normalizedValue} (current)`,
      value: normalizedValue
    }
  ];
}

function formatDamageTypeLabel(type: TypeDefinition): string {
  const name = typeof type.name === 'string' ? type.name.trim() : '';
  return name ? `${name} (${type.typeId})` : String(type.typeId);
}

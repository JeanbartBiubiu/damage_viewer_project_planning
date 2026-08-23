import { ApiRequestError } from '../../../services/apiClient';
import type { Attribute } from '../../../types/attribute';
import type {
  EquipmentAttributeValues,
  EquipmentFieldIssue
} from '../../../types/equipment';

export type EquipmentDraft = {
  equipmentKey: string;
  name: string;
  description: string;
};

export type EquipmentDraftErrors = Partial<Record<keyof EquipmentDraft, string>>;

export function validateEquipmentDraft(
  draft: EquipmentDraft,
  includeEquipmentKey: boolean
): EquipmentDraftErrors {
  const errors: EquipmentDraftErrors = {};
  if (includeEquipmentKey) {
    if (!draft.equipmentKey.trim()) {
      errors.equipmentKey = '装备标识不能为空';
    } else if (!/^[a-z][a-z0-9_]{0,63}$/.test(draft.equipmentKey.trim())) {
      errors.equipmentKey = '小写字母开头，只能包含小写字母、数字和下划线';
    }
  }
  if (!draft.name.trim()) {
    errors.name = '装备名称不能为空';
  } else if (draft.name.trim().length > 100) {
    errors.name = '装备名称不能超过100个字符';
  }
  if (draft.description.trim().length > 2000) {
    errors.description = '说明不能超过2000个字符';
  }
  return errors;
}

export function normalizeEquipmentAttributeValues(
  attributes: Attribute[],
  source: EquipmentAttributeValues
): EquipmentAttributeValues {
  return Object.fromEntries(attributes.flatMap((attribute) => {
    const value = source[attribute.attributeKey];
    return typeof value === 'number' ? [[attribute.attributeKey, value]] : [];
  }));
}

export function isEquipmentAttributeConfigured(
  source: EquipmentAttributeValues,
  attributeKey: string
): boolean {
  return typeof source[attributeKey] === 'number';
}

export function removeEquipmentAttribute(
  source: EquipmentAttributeValues,
  attributeKey: string
): EquipmentAttributeValues {
  const next = { ...source };
  delete next[attributeKey];
  return next;
}

export function equipmentFieldIssues(error: unknown): EquipmentFieldIssue[] {
  if (!(error instanceof ApiRequestError)) return [];
  const raw = error.details?.fieldIssues;
  if (!Array.isArray(raw)) return [];
  return raw.filter((issue): issue is EquipmentFieldIssue => {
    if (!issue || typeof issue !== 'object') return false;
    const value = issue as Record<string, unknown>;
    return typeof value.field === 'string'
      && typeof value.code === 'string'
      && typeof value.message === 'string';
  });
}

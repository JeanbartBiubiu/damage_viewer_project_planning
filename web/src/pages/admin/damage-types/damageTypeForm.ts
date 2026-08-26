import { ApiRequestError } from '../../../services/apiClient';

export type DamageTypeDraft = {
  damageTypeKey: string;
  name: string;
  description: string;
  sortOrder: string;
};

export type DamageTypeDraftErrors = Partial<Record<keyof DamageTypeDraft, string>>;

export type DamageTypeFieldIssue = {
  field: string;
  code: string;
  message: string;
};

export function validateDamageTypeDraft(
  draft: DamageTypeDraft,
  includeKey: boolean
): DamageTypeDraftErrors {
  const errors: DamageTypeDraftErrors = {};
  if (includeKey) {
    if (!draft.damageTypeKey.trim()) {
      errors.damageTypeKey = '伤害类型标识不能为空';
    } else if (!/^[a-z][a-z0-9_]{0,63}$/.test(draft.damageTypeKey.trim())) {
      errors.damageTypeKey = '小写字母开头，只能包含小写字母、数字和下划线';
    }
  }
  if (!draft.name.trim()) {
    errors.name = '伤害类型名称不能为空';
  } else if (draft.name.trim().length > 100) {
    errors.name = '伤害类型名称不能超过100个字符';
  }
  if (draft.description.trim().length > 2000) {
    errors.description = '说明不能超过2000个字符';
  }
  const sortOrder = Number(draft.sortOrder.trim());
  if (!draft.sortOrder.trim()) {
    errors.sortOrder = '排序不能为空';
  } else if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    errors.sortOrder = '排序必须是大于等于0的整数';
  }
  return errors;
}

export function damageTypeFieldIssues(error: unknown): DamageTypeFieldIssue[] {
  if (!(error instanceof ApiRequestError)) return [];
  const raw = error.details?.fieldIssues;
  if (!Array.isArray(raw)) return [];
  return raw.filter((issue): issue is DamageTypeFieldIssue => {
    if (!issue || typeof issue !== 'object') return false;
    const value = issue as Record<string, unknown>;
    return typeof value.field === 'string'
      && typeof value.code === 'string'
      && typeof value.message === 'string';
  });
}

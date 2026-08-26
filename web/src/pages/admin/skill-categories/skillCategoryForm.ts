import { ApiRequestError } from '../../../services/apiClient';

export type SkillCategoryDraft = {
  skillCategoryKey: string;
  name: string;
  description: string;
  sortOrder: string;
};

export type SkillCategoryDraftErrors = Partial<Record<keyof SkillCategoryDraft, string>>;

export type SkillCategoryFieldIssue = {
  field: string;
  code: string;
  message: string;
};

export function validateSkillCategoryDraft(
  draft: SkillCategoryDraft,
  includeKey: boolean
): SkillCategoryDraftErrors {
  const errors: SkillCategoryDraftErrors = {};
  if (includeKey) {
    if (!draft.skillCategoryKey.trim()) {
      errors.skillCategoryKey = '技能分类标识不能为空';
    } else if (!/^[a-z][a-z0-9_]{0,63}$/.test(draft.skillCategoryKey.trim())) {
      errors.skillCategoryKey = '小写字母开头，只能包含小写字母、数字和下划线';
    }
  }
  if (!draft.name.trim()) {
    errors.name = '技能分类名称不能为空';
  } else if (draft.name.trim().length > 100) {
    errors.name = '技能分类名称不能超过100个字符';
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

export function skillCategoryFieldIssues(error: unknown): SkillCategoryFieldIssue[] {
  if (!(error instanceof ApiRequestError)) return [];
  const raw = error.details?.fieldIssues;
  if (!Array.isArray(raw)) return [];
  return raw.filter((issue): issue is SkillCategoryFieldIssue => {
    if (!issue || typeof issue !== 'object') return false;
    const value = issue as Record<string, unknown>;
    return typeof value.field === 'string'
      && typeof value.code === 'string'
      && typeof value.message === 'string';
  });
}

import { ApiRequestError } from '../../../services/apiClient';
import type {
  CreateSkillRequest,
  Skill,
  SkillStatus,
  UpdateSkillRequest
} from '../../../types/skill';

export type SkillDraft = {
  skillKey: string;
  name: string;
  description: string;
  maxLevel: string;
  status: SkillStatus;
  sortOrder: string;
  skillCategoryKeys: string[];
};

export type SkillDraftField =
  | 'skillKey'
  | 'name'
  | 'description'
  | 'maxLevel'
  | 'status'
  | 'sortOrder'
  | 'skillCategoryKeys';

export type SkillDraftErrors = Partial<Record<SkillDraftField, string>>;

export type SkillFormValidation =
  | { ok: true; normalized: CreateSkillRequest }
  | { ok: false; fieldErrors: SkillDraftErrors };

export type SkillCategoryIndexError = {
  index: number;
  message: string;
};

export type MappedSkillFieldIssues = {
  fieldErrors: SkillDraftErrors;
  categoryIndexErrors: SkillCategoryIndexError[];
  unmappedMessages: string[];
};

export const SKILL_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

const SKILL_DRAFT_FIELDS = new Set<SkillDraftField>([
  'skillKey',
  'name',
  'description',
  'maxLevel',
  'status',
  'sortOrder',
  'skillCategoryKeys'
]);

const INDEXED_CATEGORY_PATH = /^\/skillCategoryKeys\/(\d+)$/;

export function createEmptySkillDraft(): SkillDraft {
  return {
    skillKey: '',
    name: '',
    description: '',
    maxLevel: '1',
    status: 'ENABLED',
    sortOrder: '0',
    skillCategoryKeys: []
  };
}

export function skillToDraft(skill: Skill): SkillDraft {
  return {
    skillKey: skill.skillKey,
    name: skill.name,
    description: skill.description ?? '',
    maxLevel: String(skill.maxLevel),
    status: skill.status,
    sortOrder: String(skill.sortOrder),
    skillCategoryKeys: [...skill.skillCategoryKeys]
  };
}

export function validateSkillDraft(
  draft: SkillDraft,
  includeKey: boolean
): SkillFormValidation {
  const fieldErrors: SkillDraftErrors = {};
  const skillKey = draft.skillKey.trim();
  const name = draft.name.trim();
  const description = draft.description.trim();
  const skillCategoryKeys = normalizeCategoryKeys(draft.skillCategoryKeys);

  if (includeKey) {
    if (!skillKey) {
      fieldErrors.skillKey = '技能标识不能为空。';
    } else if (!SKILL_KEY_PATTERN.test(skillKey)) {
      fieldErrors.skillKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
    }
  }

  if (!name) {
    fieldErrors.name = '技能名称不能为空。';
  } else if (name.length > 100) {
    fieldErrors.name = '技能名称不能超过 100 个字符。';
  }

  if (description.length > 2000) {
    fieldErrors.description = '说明不能超过 2000 个字符。';
  }

  const maxLevelRaw = draft.maxLevel.trim();
  const maxLevel = Number(maxLevelRaw);
  if (!maxLevelRaw) {
    fieldErrors.maxLevel = '最高等级不能为空。';
  } else if (!Number.isInteger(maxLevel) || maxLevel < 1) {
    fieldErrors.maxLevel = '最高等级必须是大于等于 1 的整数。';
  }

  if (draft.status !== 'ENABLED' && draft.status !== 'DISABLED') {
    fieldErrors.status = '请选择有效状态。';
  }

  const sortOrderRaw = draft.sortOrder.trim();
  const sortOrder = Number(sortOrderRaw);
  if (!sortOrderRaw) {
    fieldErrors.sortOrder = '排序不能为空。';
  } else if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    fieldErrors.sortOrder = '排序必须是大于等于 0 的整数。';
  }

  const categoryError = validateCategoryKeys(skillCategoryKeys);
  if (categoryError) {
    fieldErrors.skillCategoryKeys = categoryError;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    normalized: {
      skillKey,
      name,
      description: description || null,
      maxLevel,
      status: draft.status,
      sortOrder,
      skillCategoryKeys
    }
  };
}

export function buildCreateSkillRequest(
  normalized: CreateSkillRequest
): CreateSkillRequest {
  return { ...normalized, skillCategoryKeys: [...normalized.skillCategoryKeys] };
}

export function buildUpdateSkillRequest(
  normalized: CreateSkillRequest
): UpdateSkillRequest {
  const { skillKey: _skillKey, ...request } = normalized;
  return {
    ...request,
    skillCategoryKeys: [...request.skillCategoryKeys]
  };
}

export function mapSkillFieldIssues(source: unknown): MappedSkillFieldIssues {
  const fieldErrors: SkillDraftErrors = {};
  const categoryIndexErrors: SkillCategoryIndexError[] = [];
  const unmappedMessages: string[] = [];
  const details = source instanceof ApiRequestError ? source.details : source;
  if (!isRecord(details) || !Array.isArray(details.fieldIssues)) {
    return { fieldErrors, categoryIndexErrors, unmappedMessages };
  }

  for (const rawIssue of details.fieldIssues) {
    if (!isRecord(rawIssue)) {
      continue;
    }
    const field = typeof rawIssue.field === 'string' ? rawIssue.field : '';
    const message = typeof rawIssue.message === 'string' && rawIssue.message.trim()
      ? rawIssue.message.trim()
      : '字段值不合法。';
    const categoryIndex = parseCategoryIndex(field);
    if (categoryIndex !== null) {
      categoryIndexErrors.push({ index: categoryIndex, message });
      continue;
    }
    if (SKILL_DRAFT_FIELDS.has(field as SkillDraftField)) {
      fieldErrors[field as SkillDraftField] = message;
    } else {
      unmappedMessages.push(message);
    }
  }

  return { fieldErrors, categoryIndexErrors, unmappedMessages };
}

function normalizeCategoryKeys(rawKeys: string[]): string[] {
  return rawKeys.map((item) => (typeof item === 'string' ? item.trim() : ''));
}

function validateCategoryKeys(skillCategoryKeys: string[]): string | undefined {
  if (skillCategoryKeys.some((key) => key === '')) {
    return '技能分类不能包含空项。';
  }
  const seen = new Set<string>();
  for (const key of skillCategoryKeys) {
    if (seen.has(key)) {
      return '技能分类不能重复。';
    }
    seen.add(key);
  }
  return undefined;
}

function parseCategoryIndex(field: string): number | null {
  const match = INDEXED_CATEGORY_PATH.exec(field);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

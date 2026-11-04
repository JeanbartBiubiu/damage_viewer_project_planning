import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import type {
  CreateSkillCategoryRequest,
  SkillCategory,
  SkillCategoryListQuery,
  SkillCategoryListResponse,
  UpdateSkillCategoryRequest
} from '../types/skillCategory';

function skillCategoriesPath(gameId: string, skillCategoryKey?: string): string {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/skill-categories`;
  return skillCategoryKey === undefined
    ? base
    : `${base}/${encodePathSegment(skillCategoryKey)}`;
}

function withQuery(path: string, query: SkillCategoryListQuery = {}): string {
  const params = new URLSearchParams();
  const keyword = query.keyword?.trim();
  if (keyword) params.set('keyword', keyword);
  if (query.status) params.set('status', query.status);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function listSkillCategories(
  apiBaseUrl: string,
  gameId: string,
  query: SkillCategoryListQuery = {},
  signal?: AbortSignal
): Promise<ApiResult<SkillCategoryListResponse>> {
  return requestJson<SkillCategoryListResponse>(
    apiBaseUrl,
    withQuery(skillCategoriesPath(gameId), query),
    { signal }
  );
}

export function getSkillCategory(
  apiBaseUrl: string,
  gameId: string,
  skillCategoryKey: string
): Promise<ApiResult<SkillCategory>> {
  return requestJson<SkillCategory>(
    apiBaseUrl,
    skillCategoriesPath(gameId, skillCategoryKey)
  );
}

export function createSkillCategory(
  apiBaseUrl: string,
  gameId: string,
  body: CreateSkillCategoryRequest
): Promise<ApiResult<SkillCategory>> {
  return requestJson<SkillCategory>(apiBaseUrl, skillCategoriesPath(gameId), {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export function updateSkillCategory(
  apiBaseUrl: string,
  gameId: string,
  skillCategoryKey: string,
  body: UpdateSkillCategoryRequest
): Promise<ApiResult<SkillCategory>> {
  return requestJson<SkillCategory>(apiBaseUrl, skillCategoriesPath(gameId, skillCategoryKey), {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

export function deleteSkillCategory(
  apiBaseUrl: string,
  gameId: string,
  skillCategoryKey: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, skillCategoriesPath(gameId, skillCategoryKey), {
    method: 'DELETE'
  });
}

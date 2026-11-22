import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import type { SkillCategory, SkillCategoryListQuery, SkillCategoryListResponse } from '../types/skillCategory';

export function skillCategoriesPath(gameId: string, skillCategoryKey?: string): string {
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

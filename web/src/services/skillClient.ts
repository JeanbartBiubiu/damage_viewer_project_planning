import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import type { Skill, SkillListQuery, SkillListResponse } from '../types/skill';

export function skillsPath(gameId: string, skillKey?: string): string {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/skills`;
  return skillKey === undefined ? base : `${base}/${encodePathSegment(skillKey)}`;
}

function withQuery(path: string, query: SkillListQuery = {}): string {
  const params = new URLSearchParams();
  const keyword = query.keyword?.trim();
  if (keyword) params.set('keyword', keyword);
  if (query.status) params.set('status', query.status);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function listSkills(
  apiBaseUrl: string,
  gameId: string,
  query: SkillListQuery = {}
): Promise<ApiResult<SkillListResponse>> {
  return requestJson<SkillListResponse>(apiBaseUrl, withQuery(skillsPath(gameId), query));
}

export function getSkill(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  signal?: AbortSignal
): Promise<ApiResult<Skill>> {
  return requestJson<Skill>(apiBaseUrl, skillsPath(gameId, skillKey), { signal });
}

import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import type {
  CreateSkillRequest,
  Skill,
  SkillListQuery,
  SkillListResponse,
  UpdateSkillRequest
} from '../types/skill';

function skillsPath(gameId: string, skillKey?: string): string {
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
  token: string,
  query: SkillListQuery = {}
): Promise<ApiResult<SkillListResponse>> {
  return requestJson<SkillListResponse>(apiBaseUrl, withQuery(skillsPath(gameId), query), { token });
}

export function getSkill(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string
): Promise<ApiResult<Skill>> {
  return requestJson<Skill>(apiBaseUrl, skillsPath(gameId, skillKey), { token });
}

export function createSkill(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: CreateSkillRequest
): Promise<ApiResult<Skill>> {
  return requestJson<Skill>(apiBaseUrl, skillsPath(gameId), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  });
}

export function updateSkill(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string,
  body: UpdateSkillRequest
): Promise<ApiResult<Skill>> {
  return requestJson<Skill>(apiBaseUrl, skillsPath(gameId, skillKey), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export function deleteSkill(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, skillsPath(gameId, skillKey), {
    method: 'DELETE',
    token
  });
}

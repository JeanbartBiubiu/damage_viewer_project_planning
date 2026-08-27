import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import { skillsPath } from './skillClient';
import type {
  CreateSkillFormulaRequest,
  SkillFormula,
  SkillFormulaSummary,
  UpdateSkillFormulaRequest
} from '../types/skillFormula';

function formulasPath(gameId: string, skillKey: string, formulaKey?: string): string {
  const base = `${skillsPath(gameId, skillKey)}/formulas`;
  return formulaKey === undefined ? base : `${base}/${encodePathSegment(formulaKey)}`;
}

export function listSkillFormulas(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string
): Promise<ApiResult<SkillFormulaSummary[]>> {
  return requestJson<SkillFormulaSummary[]>(apiBaseUrl, formulasPath(gameId, skillKey), { token });
}

export function getSkillFormula(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  formulaKey: string,
  token: string
): Promise<ApiResult<SkillFormula>> {
  return requestJson<SkillFormula>(
    apiBaseUrl,
    formulasPath(gameId, skillKey, formulaKey),
    { token }
  );
}

export function createSkillFormula(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string,
  body: CreateSkillFormulaRequest
): Promise<ApiResult<SkillFormula>> {
  return requestJson<SkillFormula>(apiBaseUrl, formulasPath(gameId, skillKey), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  });
}

export function updateSkillFormula(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  formulaKey: string,
  token: string,
  body: UpdateSkillFormulaRequest
): Promise<ApiResult<SkillFormula>> {
  return requestJson<SkillFormula>(
    apiBaseUrl,
    formulasPath(gameId, skillKey, formulaKey),
    {
      method: 'PUT',
      token,
      body: JSON.stringify(body)
    }
  );
}

export function deleteSkillFormula(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  formulaKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, formulasPath(gameId, skillKey, formulaKey), {
    method: 'DELETE',
    token
  });
}

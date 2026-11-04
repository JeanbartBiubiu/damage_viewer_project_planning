import { validateStoredSkillFormula } from './skillFormulaContract';
import { ApiRequestError } from './apiClient';
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
  skillKey: string
): Promise<ApiResult<SkillFormulaSummary[]>> {
  return requestJson<SkillFormulaSummary[]>(apiBaseUrl, formulasPath(gameId, skillKey));
}

export async function getSkillFormula(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  formulaKey: string
): Promise<ApiResult<SkillFormula>> {
  const result = await requestJson<SkillFormula>(apiBaseUrl, formulasPath(gameId, skillKey, formulaKey));
  return { ...result, data: parseSkillFormula(result.data, gameId, skillKey, formulaKey) };
}

export async function createSkillFormula(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  body: CreateSkillFormulaRequest
): Promise<ApiResult<SkillFormula>> {
  const result = await requestJson<SkillFormula>(apiBaseUrl, formulasPath(gameId, skillKey), {
    method: 'POST',
    body: JSON.stringify(body)
  }).catch(unconfirmedSkillFormulaWrite);
  try { return { ...result, data: parseSkillFormula(result.data, gameId, skillKey, body.formulaKey) }; }
  catch { throw new UnconfirmedSkillFormulaWriteError(); }
}

export async function updateSkillFormula(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  formulaKey: string,
  body: UpdateSkillFormulaRequest
): Promise<ApiResult<SkillFormula>> {
  const result = await requestJson<SkillFormula>(
    apiBaseUrl,
    formulasPath(gameId, skillKey, formulaKey),
    {
      method: 'PUT',
      body: JSON.stringify(body)
    }
  ).catch(unconfirmedSkillFormulaWrite);
  try { return { ...result, data: parseSkillFormula(result.data, gameId, skillKey, formulaKey) }; }
  catch { throw new UnconfirmedSkillFormulaWriteError(); }
}

export function deleteSkillFormula(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  formulaKey: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, formulasPath(gameId, skillKey, formulaKey), {
    method: 'DELETE'
  });
}

export class UnconfirmedSkillFormulaWriteError extends Error {
  constructor() { super('保存结果待确认'); this.name = 'UnconfirmedSkillFormulaWriteError'; }
}
export function parseSkillFormula(value: unknown, gameId: string, skillKey: string, formulaKey: string): SkillFormula {
  const row = value as SkillFormula | null;
  if (!row || row.gameId !== gameId || row.skillKey !== skillKey || row.formulaKey !== formulaKey
    || typeof row.name !== 'string' || typeof row.sortOrder !== 'number' || validateStoredSkillFormula(row.expression, skillKey)) {
    throw new ApiRequestError('技能公式详情不完整，请重新读取。', 502, 'INVALID_SKILL_FORMULA_RESPONSE');
  }
  return structuredClone(row);
}

function unconfirmedSkillFormulaWrite(error: unknown): never {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) throw error;
  throw new UnconfirmedSkillFormulaWriteError();
}

import { ApiRequestError, encodePathSegment, requestJson } from './apiClient';
import type { ApiResult } from './apiClient';
import type { CharacterAuthoringCheck } from '../types/characterAuthoringCheck';
import { parseAuthoringLocation } from './authoringLocation';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const string = (value: unknown): value is string => typeof value === 'string';
const nullableString = (value: unknown) => value === null || string(value);
const count = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;

export function parseCharacterAuthoringCheck(value: unknown, gameId: string, characterKey: string): CharacterAuthoringCheck {
  const invalid = () => { throw new ApiRequestError('角色录入检查响应不完整，请重新检查。', 502, 'INVALID_AUTHORING_CHECK_RESPONSE'); };
  if (!record(value) || value.gameId !== gameId || value.characterKey !== characterKey
    || !string(value.characterName) || !string(value.checkedAt) || Number.isNaN(Date.parse(value.checkedAt))
    || !record(value.conclusions) || !['NO_ERRORS', 'HAS_ERRORS'].includes(String(value.conclusions.structure))
    || value.conclusions.mechanics !== 'NOT_CHECKED' || value.conclusions.runtime !== 'NOT_RUN'
    || !record(value.summary) || !['attachedSkillCount', 'configuredAttributeCount', 'errorCount', 'reviewCount'].every(key => count(value.summary && (value.summary as Record<string, unknown>)[key]))
    || !Array.isArray(value.skills) || !Array.isArray(value.references) || !Array.isArray(value.issues)) return invalid();
  if (!value.skills.every(item => record(item) && string(item.skillKey) && nullableString(item.name)
    && nullableString(item.status)
    && (item.maxLevel === null || Number.isInteger(item.maxLevel)) && Number.isInteger(item.sortOrder)
    && count(item.effectCount) && count(item.processCount) && count(item.triggerRuleCount))) return invalid();
  if (!value.references.every(item => record(item)
    && string(item.sourceSkillKey) && string(item.sourceType) && string(item.sourceKey) && string(item.fieldPath)
    && string(item.targetType) && string(item.targetKey)
    && nullableString(item.targetSkillKey) && nullableString(item.targetSubKey)
    && parseAuthoringLocation(item.location, {
      skillKey: item.sourceSkillKey, objectType: item.sourceType, objectKey: item.sourceKey, fieldPath: item.fieldPath
    }))) return invalid();
  if (!value.issues.every(item => record(item) && (item.severity === 'ERROR' || item.severity === 'REVIEW')
    && string(item.code) && string(item.message) && string(item.objectType) && string(item.objectKey) && string(item.fieldPath)
    && nullableString(item.skillKey)
    && parseAuthoringLocation(item.location, {
      skillKey: item.skillKey, objectType: item.objectType, objectKey: item.objectKey, fieldPath: item.fieldPath
    }))) return invalid();
  const errors = value.issues.filter(item => item.severity === 'ERROR').length;
  const reviews = value.issues.filter(item => item.severity === 'REVIEW').length;
  if (value.summary.errorCount !== errors || value.summary.reviewCount !== reviews || value.summary.attachedSkillCount !== value.skills.length
    || value.conclusions.structure !== (errors ? 'HAS_ERRORS' : 'NO_ERRORS')) return invalid();
  return value as CharacterAuthoringCheck;
}

export async function getCharacterAuthoringCheck(apiBaseUrl: string, gameId: string, characterKey: string, token: string): Promise<ApiResult<CharacterAuthoringCheck>> {
  const path = `/api/admin/games/${encodePathSegment(gameId)}/characters/${encodePathSegment(characterKey)}/authoring-check`;
  const result = await requestJson<unknown>(apiBaseUrl, path, { token });
  return { ...result, data: parseCharacterAuthoringCheck(result.data, gameId, characterKey) };
}

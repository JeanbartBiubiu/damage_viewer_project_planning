import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import type { Character, CharacterAttributes, CharacterListQuery, CharacterListResponse, LevelConfig } from '../types/character';

export function gameAdminPath(gameId: string, suffix: string): string {
  return `/api/admin/games/${encodePathSegment(gameId)}/${suffix}`;
}

export function charactersPath(gameId: string, characterKey?: string): string {
  const base = gameAdminPath(gameId, 'characters');
  return characterKey === undefined ? base : `${base}/${encodePathSegment(characterKey)}`;
}

export function getLevelConfig(
  apiBaseUrl: string,
  gameId: string,
  signal?: AbortSignal
): Promise<ApiResult<LevelConfig>> {
  return requestJson<LevelConfig>(apiBaseUrl, gameAdminPath(gameId, 'level-config'), { signal });
}

export function listCharacters(
  apiBaseUrl: string,
  gameId: string,
  query: CharacterListQuery = {},
  signal?: AbortSignal
): Promise<ApiResult<CharacterListResponse>> {
  const keyword = query.keyword?.trim();
  const path = keyword
    ? `${charactersPath(gameId)}?${new URLSearchParams({ keyword }).toString()}`
    : charactersPath(gameId);
  return requestJson<CharacterListResponse>(apiBaseUrl, path, { signal });
}

export function getCharacter(
  apiBaseUrl: string,
  gameId: string,
  characterKey: string
): Promise<ApiResult<Character>> {
  return requestJson<Character>(apiBaseUrl, charactersPath(gameId, characterKey));
}

export function getCharacterAttributes(
  apiBaseUrl: string,
  gameId: string,
  characterKey: string
): Promise<ApiResult<CharacterAttributes>> {
  return requestJson<CharacterAttributes>(
    apiBaseUrl,
    `${charactersPath(gameId, characterKey)}/attributes`
  );
}

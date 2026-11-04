import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import type {
  Character,
  CharacterAttributes,
  CharacterListQuery,
  CharacterListResponse,
  CreateCharacterRequest,
  LevelConfig,
  UpdateCharacterAttributesRequest,
  UpdateCharacterRequest,
  UpdateLevelConfigRequest
} from '../types/character';

function gameAdminPath(gameId: string, suffix: string): string {
  return `/api/admin/games/${encodePathSegment(gameId)}/${suffix}`;
}

function charactersPath(gameId: string, characterKey?: string): string {
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

export function updateLevelConfig(
  apiBaseUrl: string,
  gameId: string,
  body: UpdateLevelConfigRequest
): Promise<ApiResult<LevelConfig>> {
  return requestJson<LevelConfig>(apiBaseUrl, gameAdminPath(gameId, 'level-config'), {
    method: 'PUT',
    body: JSON.stringify(body)
  });
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

export function createCharacter(
  apiBaseUrl: string,
  gameId: string,
  body: CreateCharacterRequest
): Promise<ApiResult<Character>> {
  return requestJson<Character>(apiBaseUrl, charactersPath(gameId), {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export function updateCharacter(
  apiBaseUrl: string,
  gameId: string,
  characterKey: string,
  body: UpdateCharacterRequest
): Promise<ApiResult<Character>> {
  return requestJson<Character>(apiBaseUrl, charactersPath(gameId, characterKey), {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

export function deleteCharacter(
  apiBaseUrl: string,
  gameId: string,
  characterKey: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, charactersPath(gameId, characterKey), {
    method: 'DELETE'
  });
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

export function updateCharacterAttributes(
  apiBaseUrl: string,
  gameId: string,
  characterKey: string,
  body: UpdateCharacterAttributesRequest
): Promise<ApiResult<CharacterAttributes>> {
  return requestJson<CharacterAttributes>(
    apiBaseUrl,
    `${charactersPath(gameId, characterKey)}/attributes`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
}

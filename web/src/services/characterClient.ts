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
  token: string
): Promise<ApiResult<LevelConfig>> {
  return requestJson<LevelConfig>(apiBaseUrl, gameAdminPath(gameId, 'level-config'), { token });
}

export function updateLevelConfig(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: UpdateLevelConfigRequest
): Promise<ApiResult<LevelConfig>> {
  return requestJson<LevelConfig>(apiBaseUrl, gameAdminPath(gameId, 'level-config'), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export function listCharacters(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  query: CharacterListQuery = {}
): Promise<ApiResult<CharacterListResponse>> {
  const keyword = query.keyword?.trim();
  const path = keyword
    ? `${charactersPath(gameId)}?${new URLSearchParams({ keyword }).toString()}`
    : charactersPath(gameId);
  return requestJson<CharacterListResponse>(apiBaseUrl, path, { token });
}

export function getCharacter(
  apiBaseUrl: string,
  gameId: string,
  characterKey: string,
  token: string
): Promise<ApiResult<Character>> {
  return requestJson<Character>(apiBaseUrl, charactersPath(gameId, characterKey), { token });
}

export function createCharacter(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: CreateCharacterRequest
): Promise<ApiResult<Character>> {
  return requestJson<Character>(apiBaseUrl, charactersPath(gameId), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  });
}

export function updateCharacter(
  apiBaseUrl: string,
  gameId: string,
  characterKey: string,
  token: string,
  body: UpdateCharacterRequest
): Promise<ApiResult<Character>> {
  return requestJson<Character>(apiBaseUrl, charactersPath(gameId, characterKey), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export function deleteCharacter(
  apiBaseUrl: string,
  gameId: string,
  characterKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, charactersPath(gameId, characterKey), {
    method: 'DELETE',
    token
  });
}

export function getCharacterAttributes(
  apiBaseUrl: string,
  gameId: string,
  characterKey: string,
  token: string
): Promise<ApiResult<CharacterAttributes>> {
  return requestJson<CharacterAttributes>(
    apiBaseUrl,
    `${charactersPath(gameId, characterKey)}/attributes`,
    { token }
  );
}

export function updateCharacterAttributes(
  apiBaseUrl: string,
  gameId: string,
  characterKey: string,
  token: string,
  body: UpdateCharacterAttributesRequest
): Promise<ApiResult<CharacterAttributes>> {
  return requestJson<CharacterAttributes>(
    apiBaseUrl,
    `${charactersPath(gameId, characterKey)}/attributes`,
    { method: 'PUT', token, body: JSON.stringify(body) }
  );
}

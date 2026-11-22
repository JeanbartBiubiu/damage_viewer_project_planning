import type { ApiResult } from '../apiClient';
import type { Character, CharacterAttributes, CreateCharacterRequest, LevelConfig, UpdateCharacterAttributesRequest, UpdateCharacterRequest, UpdateLevelConfigRequest } from '../../types/character';
import { charactersPath, gameAdminPath } from '../characterClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

export function updateLevelConfig(
  apiBaseUrl: string,
  gameId: string,
  body: UpdateLevelConfigRequest
): Promise<ApiResult<LevelConfig>> {
  return requestMaintenanceJson<LevelConfig>(apiBaseUrl, gameAdminPath(gameId, 'level-config'), {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

export function createCharacter(
  apiBaseUrl: string,
  gameId: string,
  body: CreateCharacterRequest
): Promise<ApiResult<Character>> {
  return requestMaintenanceJson<Character>(apiBaseUrl, charactersPath(gameId), {
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
  return requestMaintenanceJson<Character>(apiBaseUrl, charactersPath(gameId, characterKey), {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

export function deleteCharacter(
  apiBaseUrl: string,
  gameId: string,
  characterKey: string
): Promise<ApiResult<null>> {
  return requestMaintenanceJson<null>(apiBaseUrl, charactersPath(gameId, characterKey), {
    method: 'DELETE'
  });
}

export function updateCharacterAttributes(
  apiBaseUrl: string,
  gameId: string,
  characterKey: string,
  body: UpdateCharacterAttributesRequest
): Promise<ApiResult<CharacterAttributes>> {
  return requestMaintenanceJson<CharacterAttributes>(
    apiBaseUrl,
    `${charactersPath(gameId, characterKey)}/attributes`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
}

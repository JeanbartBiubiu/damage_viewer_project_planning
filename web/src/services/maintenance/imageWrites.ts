import type { ApiResult } from '../apiClient';
import type { CreateImageRequest, ManagedImage, UpdateImageRequest } from '../../types/image';
import { adminImagesPath, normalizeManagedImage, normalizeResult } from '../imageClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

export function createImage(
  apiBaseUrl: string,
  gameId: string,
  body: CreateImageRequest
): Promise<ApiResult<ManagedImage>> {
  return normalizeResult(
    requestMaintenanceJson<unknown>(apiBaseUrl, adminImagesPath(gameId), {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    normalizeManagedImage
  );
}

export function updateImage(
  apiBaseUrl: string,
  gameId: string,
  imageKey: string,
  body: UpdateImageRequest
): Promise<ApiResult<ManagedImage>> {
  return normalizeResult(
    requestMaintenanceJson<unknown>(apiBaseUrl, adminImagesPath(gameId, imageKey), {
      method: 'PUT',
      body: JSON.stringify(body)
    }),
    normalizeManagedImage
  );
}

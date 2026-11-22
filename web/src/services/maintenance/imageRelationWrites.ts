import { ApiRequestError, type ApiResult } from '../apiClient';
import type { ImageRelationTarget, RepresentativeImageResponse } from '../../types/imageRelation';
import { getRepresentativeImage, invalidResponse, normalized, parseRepresentative, representativeImagePath } from '../imageRelationClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

export function setRepresentativeImage(apiBaseUrl: string, gameId: string, target: ImageRelationTarget, imageKey: string): Promise<ApiResult<RepresentativeImageResponse>> {
  return normalized(requestMaintenanceJson<unknown>(apiBaseUrl, representativeImagePath(gameId, target), {
    method: 'PUT', body: JSON.stringify({ imageKey })
  }), (value) => {
    const parsed = parseRepresentative(value);
    if (parsed.image?.imageKey !== imageKey) invalidResponse();
    return parsed;
  });
}

export function removeRepresentativeImage(apiBaseUrl: string, gameId: string, target: ImageRelationTarget): Promise<ApiResult<null>> {
  return requestMaintenanceJson<null>(apiBaseUrl, representativeImagePath(gameId, target), { method: 'DELETE' });
}

function mutationResultIsUncertain(error: unknown): boolean {
  return !(error instanceof ApiRequestError) || error.status >= 500 || error.status === 408 || error.status === 429;
}

export async function setRepresentativeImageVerified(
  apiBaseUrl: string, gameId: string, target: ImageRelationTarget, imageKey: string
): Promise<ApiResult<RepresentativeImageResponse>> {
  let uncertain: unknown = null;
  try {
    await setRepresentativeImage(apiBaseUrl, gameId, target, imageKey);
  } catch (error) {
    if (!mutationResultIsUncertain(error)) throw error;
    uncertain = error;
  }
  const readback = await getRepresentativeImage(apiBaseUrl, gameId, target);
  if (readback.data.image?.imageKey === imageKey) return readback;
  if (uncertain) throw uncertain;
  invalidResponse();
}

export async function removeRepresentativeImageVerified(
  apiBaseUrl: string, gameId: string, target: ImageRelationTarget
): Promise<ApiResult<RepresentativeImageResponse>> {
  let uncertain: unknown = null;
  try {
    await removeRepresentativeImage(apiBaseUrl, gameId, target);
  } catch (error) {
    if (!mutationResultIsUncertain(error)) throw error;
    uncertain = error;
  }
  const readback = await getRepresentativeImage(apiBaseUrl, gameId, target);
  if (readback.data.image === null) return readback;
  if (uncertain) throw uncertain;
  invalidResponse();
}

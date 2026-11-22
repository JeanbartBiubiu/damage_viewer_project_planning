import { requestMaintenanceJson } from '../maintenanceApiRequest';
import type { ApiResult } from '../apiClient';
import { encodePathSegment } from '../apiClient';
import type { Attribute, AttributeListQuery, AttributeListResponse, CreateAttributeRequest, UpdateAttributeRequest } from '../../types/attribute';

function attributesPath(gameId: string, attributeKey?: string): string {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/attributes`;
  return attributeKey === undefined ? base : `${base}/${encodePathSegment(attributeKey)}`;
}

function withAttributeQuery(path: string, query: AttributeListQuery = {}): string {
  const params = new URLSearchParams();
  const keyword = query.keyword?.trim();
  if (keyword) {
    params.set('keyword', keyword);
  }
  if (query.status) {
    params.set('status', query.status);
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export async function listAttributes(
  apiBaseUrl: string,
  gameId: string,
  query: AttributeListQuery = {}
): Promise<ApiResult<AttributeListResponse>> {
  return requestMaintenanceJson<AttributeListResponse>(
    apiBaseUrl,
    withAttributeQuery(attributesPath(gameId), query)
  );
}

export async function getAttribute(
  apiBaseUrl: string,
  gameId: string,
  attributeKey: string
): Promise<ApiResult<Attribute>> {
  return requestMaintenanceJson<Attribute>(apiBaseUrl, attributesPath(gameId, attributeKey));
}

export async function createAttribute(
  apiBaseUrl: string,
  gameId: string,
  body: CreateAttributeRequest
): Promise<ApiResult<Attribute>> {
  return requestMaintenanceJson<Attribute>(apiBaseUrl, attributesPath(gameId), {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function updateAttribute(
  apiBaseUrl: string,
  gameId: string,
  attributeKey: string,
  body: UpdateAttributeRequest
): Promise<ApiResult<Attribute>> {
  return requestMaintenanceJson<Attribute>(apiBaseUrl, attributesPath(gameId, attributeKey), {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

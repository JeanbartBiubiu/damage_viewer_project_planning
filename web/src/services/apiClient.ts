import type {
  ApiErrorResponse,
  AttributeDefinition,
  AttributeDefinitionsResponse,
  CoefficientBucket,
  CoefficientBucketsResponse,
  CurrentVersion,
  FormulaBinding,
  FormulaBindingsResponse,
  FormulaProfile,
  FormulaProfilesResponse,
  GameDataBundle,
  GameProgressionSchema,
  GameSummary,
  Hero,
  HeroesResponse,
  ImageCollectionResponse,
  Item,
  ItemsResponse,
  JsonObject,
  OwnerCategoryResponse,
  Skill,
  SkillsResponse,
  StatusActionControlRule,
  StatusActionControlRulesResponse,
  TypeDefinition,
  TypeRelation,
  TypeRelationReplacePayload,
  TypeRelationsByTargetResponse,
  TypeRelationsResponse,
  TypesResponse,
  VersionCreatePayload,
  VersionCreateResponse,
  VersionPublishResponse
} from '../types/api';

const DEFAULT_API_BASE_URL = 'http://localhost:8080';

export type ApiResult<T> = {
  data: T;
  status: number;
  etag: string | null;
};

type RequestOptions = RequestInit & {
  token?: string;
  ifNoneMatch?: string;
};

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function resolveApiBaseUrl(explicitValue?: string): string {
  const candidate = explicitValue?.trim() || import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  return candidate.replace(/\/$/, '');
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.code ? `${error.code}: ${error.message}` : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unknown error occurred.';
}

export async function listGames(apiBaseUrl: string): Promise<ApiResult<GameSummary[]>> {
  return requestJson<GameSummary[]>(apiBaseUrl, '/api/games');
}

export async function getCurrentVersion(apiBaseUrl: string, gameId: string): Promise<ApiResult<CurrentVersion>> {
  return requestJson<CurrentVersion>(apiBaseUrl, `/api/games/${encodePathSegment(gameId)}/versions/current`);
}

export async function getBundle(
  apiBaseUrl: string,
  gameId: string,
  versionId: number,
  ifNoneMatch?: string
): Promise<ApiResult<GameDataBundle>> {
  return requestJson<GameDataBundle>(
    apiBaseUrl,
    `/api/games/${encodePathSegment(gameId)}/versions/${versionId}/bundle`,
    {
      ifNoneMatch
    }
  );
}

export async function getOwnerCategories(apiBaseUrl: string, gameId: string): Promise<ApiResult<OwnerCategoryResponse>> {
  return requestJson<OwnerCategoryResponse>(apiBaseUrl, `/api/games/${encodePathSegment(gameId)}/owner-categories`);
}

export async function getAdminProgressionSchema(
  apiBaseUrl: string,
  gameId: string,
  token: string
): Promise<ApiResult<GameProgressionSchema>> {
  return requestJson<GameProgressionSchema>(apiBaseUrl, adminPath(gameId, 'progression-schema'), {
    token
  });
}

export async function putAdminProgressionSchema(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: Partial<GameProgressionSchema>
): Promise<ApiResult<GameProgressionSchema>> {
  return requestJson<GameProgressionSchema>(apiBaseUrl, adminPath(gameId, 'progression-schema'), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export async function getImages(
  apiBaseUrl: string,
  gameId: string,
  updatedAfter?: string
): Promise<ApiResult<ImageCollectionResponse>> {
  const url = new URL(`/api/games/${encodePathSegment(gameId)}/images`, `${resolveApiBaseUrl(apiBaseUrl)}/`);
  if (updatedAfter) {
    url.searchParams.set('updatedAfter', updatedAfter);
  }
  return requestJson<ImageCollectionResponse>(apiBaseUrl, `${url.pathname}${url.search}`);
}

export async function getHeroes(apiBaseUrl: string, gameId: string, token: string): Promise<ApiResult<HeroesResponse>> {
  return requestJson<HeroesResponse>(apiBaseUrl, adminPath(gameId, 'heroes'), {
    token
  });
}

export async function putHero(
  apiBaseUrl: string,
  gameId: string,
  heroId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<Hero>> {
  return requestJson<Hero>(apiBaseUrl, adminPath(gameId, 'heroes', heroId), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export async function getSkills(apiBaseUrl: string, gameId: string, token: string): Promise<ApiResult<SkillsResponse>> {
  return requestJson<SkillsResponse>(apiBaseUrl, adminPath(gameId, 'skills'), {
    token
  });
}

export async function putSkill(
  apiBaseUrl: string,
  gameId: string,
  skillId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<Skill>> {
  return requestJson<Skill>(apiBaseUrl, adminPath(gameId, 'skills', skillId), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export async function getItems(apiBaseUrl: string, gameId: string, token: string): Promise<ApiResult<ItemsResponse>> {
  return requestJson<ItemsResponse>(apiBaseUrl, adminPath(gameId, 'items'), {
    token
  });
}

export async function putItem(
  apiBaseUrl: string,
  gameId: string,
  itemId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<Item>> {
  return requestJson<Item>(apiBaseUrl, adminPath(gameId, 'items', itemId), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export async function getAttributeDefinitions(
  apiBaseUrl: string,
  gameId: string,
  token: string
): Promise<ApiResult<AttributeDefinitionsResponse>> {
  return requestJson<AttributeDefinitionsResponse>(apiBaseUrl, adminPath(gameId, 'attribute-definitions'), {
    token
  });
}

export async function putAttributeDefinition(
  apiBaseUrl: string,
  gameId: string,
  attrKey: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AttributeDefinition>> {
  return requestJson<AttributeDefinition>(apiBaseUrl, adminPath(gameId, 'attribute-definitions', attrKey), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export async function getTypes(apiBaseUrl: string, gameId: string, token: string): Promise<ApiResult<TypesResponse>> {
  return requestJson<TypesResponse>(apiBaseUrl, adminPath(gameId, 'types'), {
    token
  });
}

export async function putType(
  apiBaseUrl: string,
  gameId: string,
  typeId: number,
  token: string,
  body: JsonObject
): Promise<ApiResult<TypeDefinition>> {
  return requestJson<TypeDefinition>(apiBaseUrl, adminPath(gameId, 'types', `${typeId}`), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export async function getTypeRelations(apiBaseUrl: string, gameId: string, token: string): Promise<ApiResult<TypeRelationsResponse>> {
  return requestJson<TypeRelationsResponse>(apiBaseUrl, adminPath(gameId, 'type-relations'), {
    token
  });
}

export async function putTypeRelation(
  apiBaseUrl: string,
  gameId: string,
  typeId: number,
  targetCategory: string,
  targetId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<TypeRelation>> {
  return requestJson<TypeRelation>(apiBaseUrl, adminPath(gameId, 'type-relations', `${typeId}`, targetCategory, targetId), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export async function replaceTypeRelationsForTarget(
  apiBaseUrl: string,
  gameId: string,
  targetCategory: string,
  targetId: string,
  token: string,
  body: TypeRelationReplacePayload
): Promise<ApiResult<TypeRelationsByTargetResponse>> {
  return requestJson<TypeRelationsByTargetResponse>(apiBaseUrl, adminPath(gameId, 'type-relations', targetCategory, targetId), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export async function getCoefficientBuckets(
  apiBaseUrl: string,
  gameId: string,
  token: string
): Promise<ApiResult<CoefficientBucketsResponse>> {
  return requestJson<CoefficientBucketsResponse>(apiBaseUrl, adminPath(gameId, 'coefficient-buckets'), {
    token
  });
}

export async function getCoefficientBucket(
  apiBaseUrl: string,
  gameId: string,
  bucketKey: string,
  token: string
): Promise<ApiResult<CoefficientBucket>> {
  return requestJson<CoefficientBucket>(apiBaseUrl, adminPath(gameId, 'coefficient-buckets', bucketKey), {
    token
  });
}

export async function putCoefficientBucket(
  apiBaseUrl: string,
  gameId: string,
  bucketKey: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<CoefficientBucket>> {
  return requestJson<CoefficientBucket>(apiBaseUrl, adminPath(gameId, 'coefficient-buckets', bucketKey), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export async function getStatusActionControlRules(
  apiBaseUrl: string,
  gameId: string,
  token: string
): Promise<ApiResult<StatusActionControlRulesResponse>> {
  return requestJson<StatusActionControlRulesResponse>(apiBaseUrl, adminPath(gameId, 'status-action-control-rules'), {
    token
  });
}

export async function getStatusActionControlRule(
  apiBaseUrl: string,
  gameId: string,
  ruleId: string,
  token: string
): Promise<ApiResult<StatusActionControlRule>> {
  return requestJson<StatusActionControlRule>(apiBaseUrl, adminPath(gameId, 'status-action-control-rules', ruleId), {
    token
  });
}

export async function putStatusActionControlRule(
  apiBaseUrl: string,
  gameId: string,
  ruleId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<StatusActionControlRule>> {
  return requestJson<StatusActionControlRule>(apiBaseUrl, adminPath(gameId, 'status-action-control-rules', ruleId), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export async function getFormulaProfiles(
  apiBaseUrl: string,
  gameId: string,
  token: string
): Promise<ApiResult<FormulaProfilesResponse>> {
  return requestJson<FormulaProfilesResponse>(apiBaseUrl, adminPath(gameId, 'formula-profiles'), {
    token
  });
}

export async function getFormulaProfile(
  apiBaseUrl: string,
  gameId: string,
  formulaId: string,
  token: string
): Promise<ApiResult<FormulaProfile>> {
  return requestJson<FormulaProfile>(apiBaseUrl, adminPath(gameId, 'formula-profiles', formulaId), {
    token
  });
}

export async function putFormulaProfile(
  apiBaseUrl: string,
  gameId: string,
  formulaId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<FormulaProfile>> {
  return requestJson<FormulaProfile>(apiBaseUrl, adminPath(gameId, 'formula-profiles', formulaId), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export async function getFormulaBindings(
  apiBaseUrl: string,
  gameId: string,
  token: string
): Promise<ApiResult<FormulaBindingsResponse>> {
  return requestJson<FormulaBindingsResponse>(apiBaseUrl, adminPath(gameId, 'formula-bindings'), {
    token
  });
}

export async function getFormulaBinding(
  apiBaseUrl: string,
  gameId: string,
  targetCategory: string,
  targetId: string,
  bindingKey: string,
  token: string
): Promise<ApiResult<FormulaBinding>> {
  return requestJson<FormulaBinding>(
    apiBaseUrl,
    adminPath(gameId, 'formula-bindings', targetCategory, targetId, bindingKey),
    {
      token
    }
  );
}

export async function putFormulaBinding(
  apiBaseUrl: string,
  gameId: string,
  targetCategory: string,
  targetId: string,
  bindingKey: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<FormulaBinding>> {
  return requestJson<FormulaBinding>(
    apiBaseUrl,
    adminPath(gameId, 'formula-bindings', targetCategory, targetId, bindingKey),
    {
      method: 'PUT',
      token,
      body: JSON.stringify(body)
    }
  );
}

export async function createVersion(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: VersionCreatePayload
): Promise<ApiResult<VersionCreateResponse>> {
  return requestJson<VersionCreateResponse>(apiBaseUrl, adminPath(gameId, 'versions'), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  });
}

export async function publishVersion(
  apiBaseUrl: string,
  gameId: string,
  versionId: number,
  token: string
): Promise<ApiResult<VersionPublishResponse>> {
  return requestJson<VersionPublishResponse>(apiBaseUrl, adminPath(gameId, 'versions', `${versionId}:publish`), {
    method: 'POST',
    token
  });
}

async function requestJson<T>(apiBaseUrl: string, path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  if (options.ifNoneMatch) {
    headers.set('If-None-Match', options.ifNoneMatch);
  }

  const response = await fetch(buildUrl(apiBaseUrl, path), {
    ...options,
    headers
  });

  const body = await parseBody(response);

  if (!response.ok) {
    throw toRequestError(response, body);
  }

  return {
    data: body as T,
    status: response.status,
    etag: response.headers.get('ETag')
  };
}

function adminPath(gameId: string, ...segments: string[]): string {
  const encodedSegments = segments.map(encodePathSegment).join('/');
  return `/api/admin/games/${encodePathSegment(gameId)}/${encodedSegments}`;
}

function buildUrl(apiBaseUrl: string, path: string): string {
  return new URL(path, `${resolveApiBaseUrl(apiBaseUrl)}/`).toString();
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

async function parseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function toRequestError(response: Response, body: unknown): ApiRequestError {
  if (typeof body === 'object' && body !== null) {
    const payload = body as ApiErrorResponse;
    return new ApiRequestError(
      payload.error?.message || `Request failed with HTTP ${response.status}`,
      response.status,
      payload.error?.code,
      payload.error?.details as Record<string, unknown> | undefined
    );
  }

  return new ApiRequestError(`Request failed with HTTP ${response.status}`, response.status);
}

import type { JsonObject } from '../types/api';
import type {
  Ability,
  AbilityCooldown,
  AbilityCost,
  AbilityParameter,
  AbilityPhase,
  AbilityPhaseEffectSequence,
  AbilityStateField,
  AdminWriteResponse,
  AttributeDefinition,
  CombatDataEnvelope,
  CombatDataGraph,
  CombatDataState,
  CombatEntity,
  EffectSequence,
  EffectStep,
  EffectStepPutBody,
  EntityAttribute,
  EntityAttributeStage,
  EntityProviderMount,
  EntityResource,
  EntityResourceStage,
  ExecuteEffectDetail,
  ListenerEffectSequence,
  ListenerMatchType,
  ProgressionSchema,
  Provider,
  ProviderFormula,
  ProviderLifecycle,
  ProviderListener,
  ProviderModifier,
  ProviderStateField,
  ProviderTickSequence,
  ResourceDefinition,
  TypeDefinition,
  TypeRelation
} from '../types/combatData';
import { assertExactlyOneEffectDetail, sanitizeAdminPayload } from './adminPayload';
import {
  ApiRequestError,
  getErrorMessage,
  type ApiResult,
  encodePathSegment,
  requestJson
} from './apiClient';

export type CombatDataQuery = Record<string, string | number | boolean | null | undefined>;

/**
 * Error formatting context for combat-data requests.
 * - `contract-entry`: state / resource list (and similar envelope endpoints). A 404 here
 *   usually means the API process does not expose combat-data at all (old backend / wrong port).
 * - `resource-detail`: a single resource that may legitimately be missing → keep ordinary Not Found.
 */
export type CombatDataErrorKind = 'contract-entry' | 'resource-detail';

export type FormatCombatDataErrorOptions = {
  /** Current API base URL shown to help spot 8080 vs 8081 mismatches. */
  apiBaseUrl?: string;
  /**
   * True when `GET /api/games` already succeeded for this base URL.
   * Required for the old-backend diagnosis; otherwise keep the generic message.
   */
  gamesReachable?: boolean;
};

const OLD_BACKEND_COMBAT_DATA_HINT =
  '当前 API 未提供 combat-data 接口。你可能连接了旧后端进程；请重启当前 backend worktree 服务，或把 API 地址切换到运行新后端的端口。';

/**
 * Format combat-data errors for UI. Callers must pass `kind` explicitly —
 * do not infer old-backend from arbitrary URL paths.
 */
export function formatCombatDataError(
  error: unknown,
  kind: CombatDataErrorKind,
  options: FormatCombatDataErrorOptions = {}
): string {
  const baseMessage = getErrorMessage(error);

  if (
    kind === 'contract-entry' &&
    options.gamesReachable === true &&
    error instanceof ApiRequestError &&
    error.status === 404
  ) {
    const apiHint = options.apiBaseUrl?.trim()
      ? ` 当前 API：${options.apiBaseUrl.trim().replace(/\/$/, '')}。`
      : '';
    const codeHint = error.code ? `（${error.code}）` : '';
    return `${OLD_BACKEND_COMBAT_DATA_HINT}${apiHint}${codeHint}`.trim();
  }

  return baseMessage;
}

function publicCombatDataPath(gameId: string, ...segments: string[]): string {
  const encoded = segments.map(encodePathSegment).join('/');
  return `/api/games/${encodePathSegment(gameId)}/combat-data/${encoded}`;
}

function adminCombatDataPath(gameId: string, ...segments: string[]): string {
  const encoded = segments.map(encodePathSegment).join('/');
  return `/api/admin/games/${encodePathSegment(gameId)}/combat-data/${encoded}`;
}

function withQuery(path: string, query?: CombatDataQuery): string {
  if (!query) {
    return path;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, String(value));
  }

  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

async function getCombatDataEnvelope<T>(
  apiBaseUrl: string,
  gameId: string,
  pathSegments: string[],
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<T>>> {
  return requestJson<CombatDataEnvelope<T>>(
    apiBaseUrl,
    withQuery(publicCombatDataPath(gameId, ...pathSegments), query)
  );
}

async function putCombatDataAdmin<T>(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  pathSegments: string[],
  body: unknown
): Promise<ApiResult<AdminWriteResponse<T>>> {
  const sanitized = sanitizeAdminPayload(body ?? {});
  return requestJson<AdminWriteResponse<T>>(apiBaseUrl, adminCombatDataPath(gameId, ...pathSegments), {
    method: 'PUT',
    token,
    body: JSON.stringify(sanitized)
  });
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

// --- Public GETs ---

export async function getCombatDataState(
  apiBaseUrl: string,
  gameId: string
): Promise<ApiResult<CombatDataEnvelope<CombatDataState>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['state']);
}

export async function getProgressionSchema(
  apiBaseUrl: string,
  gameId: string
): Promise<ApiResult<CombatDataEnvelope<ProgressionSchema>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['progression-schema']);
}

export async function getAttributeDefinitions(
  apiBaseUrl: string,
  gameId: string
): Promise<ApiResult<CombatDataEnvelope<AttributeDefinition[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['attribute-definitions']);
}

export async function getResourceDefinitions(
  apiBaseUrl: string,
  gameId: string
): Promise<ApiResult<CombatDataEnvelope<ResourceDefinition[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['resource-definitions']);
}

export async function getTypes(
  apiBaseUrl: string,
  gameId: string
): Promise<ApiResult<CombatDataEnvelope<TypeDefinition[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['types']);
}

export async function getTypeRelations(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<TypeRelation[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['type-relations'], query);
}

export async function getEntities(
  apiBaseUrl: string,
  gameId: string
): Promise<ApiResult<CombatDataEnvelope<CombatEntity[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['entities']);
}

export async function getEntity(
  apiBaseUrl: string,
  gameId: string,
  entityId: string
): Promise<ApiResult<CombatDataEnvelope<CombatEntity>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['entities', entityId]);
}

export async function getEntityAttributes(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<EntityAttribute[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['entity-attributes'], query);
}

export async function getEntityAttributeStages(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<EntityAttributeStage[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['entity-attribute-stages'], query);
}

export async function getEntityResources(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<EntityResource[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['entity-resources'], query);
}

export async function getEntityResourceStages(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<EntityResourceStage[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['entity-resource-stages'], query);
}

export async function getEntityProviderMounts(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<EntityProviderMount[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['entity-provider-mounts'], query);
}

export async function getProviders(
  apiBaseUrl: string,
  gameId: string
): Promise<ApiResult<CombatDataEnvelope<Provider[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['providers']);
}

export async function getProviderLifecycles(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<ProviderLifecycle[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['provider-lifecycles'], query);
}

export async function getProviderStateFields(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<ProviderStateField[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['provider-state-fields'], query);
}

export async function getProviderFormulas(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<ProviderFormula[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['provider-formulas'], query);
}

export async function getProviderModifiers(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<ProviderModifier[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['provider-modifiers'], query);
}

export async function getProviderListeners(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<ProviderListener[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['provider-listeners'], query);
}

export async function getListenerMatchTypes(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<ListenerMatchType[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['listener-match-types'], query);
}

export async function getProviderTickSequences(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<ProviderTickSequence[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['provider-tick-sequences'], query);
}

export async function getAbilities(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<Ability[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['abilities'], query);
}

export async function getAbilityParameters(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<AbilityParameter[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['ability-parameters'], query);
}

export async function getAbilityStateFields(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<AbilityStateField[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['ability-state-fields'], query);
}

export async function getAbilityPhases(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<AbilityPhase[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['ability-phases'], query);
}

export async function getAbilityCosts(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<AbilityCost[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['ability-costs'], query);
}

export async function getAbilityCooldowns(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<AbilityCooldown[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['ability-cooldowns'], query);
}

export async function getEffectSequences(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<EffectSequence[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['effect-sequences'], query);
}

export async function getEffectSteps(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<EffectStep[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['effect-steps'], query);
}

export async function getAbilityPhaseEffectSequences(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<AbilityPhaseEffectSequence[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['ability-phase-effect-sequences'], query);
}

export async function getListenerEffectSequences(
  apiBaseUrl: string,
  gameId: string,
  query?: CombatDataQuery
): Promise<ApiResult<CombatDataEnvelope<ListenerEffectSequence[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['listener-effect-sequences'], query);
}

export async function getExecuteEffectDetails(
  apiBaseUrl: string,
  gameId: string
): Promise<ApiResult<CombatDataEnvelope<ExecuteEffectDetail[]>>> {
  return getCombatDataEnvelope(apiBaseUrl, gameId, ['execute-effect-details']);
}

// --- Admin PUTs ---

export async function putProgressionSchema(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<ProgressionSchema>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['progression-schema'], body);
}

export async function putAttributeDefinition(
  apiBaseUrl: string,
  gameId: string,
  attrKey: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<AttributeDefinition>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['attribute-definitions', attrKey], body);
}

export async function putResourceDefinition(
  apiBaseUrl: string,
  gameId: string,
  resourceKey: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<ResourceDefinition>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['resource-definitions', resourceKey], body);
}

export async function putType(
  apiBaseUrl: string,
  gameId: string,
  typeId: number,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<TypeDefinition>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['types', `${typeId}`], body);
}

export async function putTypeRelation(
  apiBaseUrl: string,
  gameId: string,
  typeId: number,
  targetCategory: string,
  targetId: string,
  token: string,
  body: JsonObject = {}
): Promise<ApiResult<AdminWriteResponse<TypeRelation>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['type-relations', `${typeId}`, targetCategory, targetId],
    body
  );
}

export async function putEntity(
  apiBaseUrl: string,
  gameId: string,
  entityId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<CombatEntity>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['entities', entityId], body);
}

export async function putEntityAttribute(
  apiBaseUrl: string,
  gameId: string,
  entityId: string,
  attrKey: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<EntityAttribute>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['entities', entityId, 'attributes', attrKey], body);
}

export async function putEntityAttributeStage(
  apiBaseUrl: string,
  gameId: string,
  entityId: string,
  attrKey: string,
  stage: number,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<EntityAttributeStage>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['entities', entityId, 'attributes', attrKey, 'stages', `${stage}`],
    body
  );
}

export async function putEntityResource(
  apiBaseUrl: string,
  gameId: string,
  entityId: string,
  resourceKey: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<EntityResource>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['entities', entityId, 'resources', resourceKey],
    body
  );
}

export async function putEntityResourceStage(
  apiBaseUrl: string,
  gameId: string,
  entityId: string,
  resourceKey: string,
  stage: number,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<EntityResourceStage>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['entities', entityId, 'resources', resourceKey, 'stages', `${stage}`],
    body
  );
}

export async function putEntityProviderMount(
  apiBaseUrl: string,
  gameId: string,
  entityId: string,
  providerId: string,
  token: string,
  body: JsonObject = {}
): Promise<ApiResult<AdminWriteResponse<EntityProviderMount>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['entities', entityId, 'provider-mounts', providerId],
    body
  );
}

export async function putProvider(
  apiBaseUrl: string,
  gameId: string,
  providerId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<Provider>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['providers', providerId], body);
}

export async function putProviderLifecycle(
  apiBaseUrl: string,
  gameId: string,
  providerId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<ProviderLifecycle>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['providers', providerId, 'lifecycle'], body);
}

export async function putProviderFormula(
  apiBaseUrl: string,
  gameId: string,
  providerId: string,
  formulaKey: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<ProviderFormula>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['providers', providerId, 'formulas', formulaKey],
    body
  );
}

export async function putProviderStateField(
  apiBaseUrl: string,
  gameId: string,
  providerId: string,
  stateKey: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<ProviderStateField>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['providers', providerId, 'state-fields', stateKey],
    body
  );
}

export async function putProviderModifier(
  apiBaseUrl: string,
  gameId: string,
  modifierId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<ProviderModifier>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['provider-modifiers', modifierId], body);
}

export async function putProviderListener(
  apiBaseUrl: string,
  gameId: string,
  listenerId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<ProviderListener>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['provider-listeners', listenerId], body);
}

export async function putListenerMatchType(
  apiBaseUrl: string,
  gameId: string,
  listenerId: string,
  matchModeTypeId: number,
  typeId: number,
  token: string,
  body: JsonObject = {}
): Promise<ApiResult<AdminWriteResponse<ListenerMatchType>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['listeners', listenerId, 'match-types', `${matchModeTypeId}`, `${typeId}`],
    body
  );
}

export async function putProviderTickSequence(
  apiBaseUrl: string,
  gameId: string,
  providerId: string,
  sequenceId: string,
  token: string,
  body: JsonObject = {}
): Promise<ApiResult<AdminWriteResponse<ProviderTickSequence>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['providers', providerId, 'tick-sequences', sequenceId],
    body
  );
}

export async function putAbility(
  apiBaseUrl: string,
  gameId: string,
  abilityId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<Ability>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['abilities', abilityId], body);
}

export async function putAbilityParameter(
  apiBaseUrl: string,
  gameId: string,
  abilityId: string,
  paramKey: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<AbilityParameter>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['abilities', abilityId, 'parameters', paramKey],
    body
  );
}

export async function putAbilityStateField(
  apiBaseUrl: string,
  gameId: string,
  abilityId: string,
  stateKey: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<AbilityStateField>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['abilities', abilityId, 'state-fields', stateKey],
    body
  );
}

export async function putAbilityPhase(
  apiBaseUrl: string,
  gameId: string,
  phaseId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<AbilityPhase>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['ability-phases', phaseId], body);
}

export async function putAbilityCost(
  apiBaseUrl: string,
  gameId: string,
  costId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<AbilityCost>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['ability-costs', costId], body);
}

export async function putAbilityCooldown(
  apiBaseUrl: string,
  gameId: string,
  cooldownId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<AbilityCooldown>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['ability-cooldowns', cooldownId], body);
}

export async function putEffectSequence(
  apiBaseUrl: string,
  gameId: string,
  sequenceId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<EffectSequence>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['effect-sequences', sequenceId], body);
}

export async function putEffectStep(
  apiBaseUrl: string,
  gameId: string,
  stepId: string,
  token: string,
  body: EffectStepPutBody | JsonObject | Record<string, unknown>
): Promise<ApiResult<AdminWriteResponse<EffectStep>>> {
  const sanitized = sanitizeAdminPayload(body) as Record<string, unknown>;
  assertExactlyOneEffectDetail(sanitized);
  return requestJson<AdminWriteResponse<EffectStep>>(
    apiBaseUrl,
    adminCombatDataPath(gameId, 'effect-steps', stepId),
    {
      method: 'PUT',
      token,
      body: JSON.stringify(sanitized)
    }
  );
}

export async function putAbilityPhaseEffectSequence(
  apiBaseUrl: string,
  gameId: string,
  phaseId: string,
  triggerTypeId: number,
  sequenceId: string,
  token: string,
  body: JsonObject = {}
): Promise<ApiResult<AdminWriteResponse<AbilityPhaseEffectSequence>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['ability-phases', phaseId, 'effect-sequences', `${triggerTypeId}`, sequenceId],
    body
  );
}

export async function putListenerEffectSequence(
  apiBaseUrl: string,
  gameId: string,
  listenerId: string,
  sequenceId: string,
  token: string,
  body: JsonObject = {}
): Promise<ApiResult<AdminWriteResponse<ListenerEffectSequence>>> {
  return putCombatDataAdmin(
    apiBaseUrl,
    gameId,
    token,
    ['listeners', listenerId, 'effect-sequences', sequenceId],
    body
  );
}

export async function putExecuteEffectDetail(
  apiBaseUrl: string,
  gameId: string,
  stepId: string,
  token: string,
  body: JsonObject
): Promise<ApiResult<AdminWriteResponse<ExecuteEffectDetail>>> {
  return putCombatDataAdmin(apiBaseUrl, gameId, token, ['execute-effect-details', stepId], body);
}

/**
 * Load a full combat-data graph for a game (state + all list resources).
 * progression-schema is optional: 404 → null.
 */
export async function loadCombatDataGraph(apiBaseUrl: string, gameId: string): Promise<CombatDataGraph> {
  const [
    stateResult,
    progressionSchema,
    attributeDefinitions,
    resourceDefinitions,
    types,
    typeRelations,
    entities,
    entityAttributes,
    entityAttributeStages,
    entityResources,
    entityResourceStages,
    entityProviderMounts,
    providers,
    providerLifecycles,
    providerStateFields,
    providerFormulas,
    providerModifiers,
    providerListeners,
    listenerMatchTypes,
    providerTickSequences,
    abilities,
    abilityParameters,
    abilityStateFields,
    abilityPhases,
    abilityCosts,
    abilityCooldowns,
    effectSequences,
    effectSteps,
    abilityPhaseEffectSequences,
    listenerEffectSequences,
    executeEffectDetails
  ] = await Promise.all([
    getCombatDataState(apiBaseUrl, gameId),
    getProgressionSchema(apiBaseUrl, gameId)
      .then((result) => result.data.data)
      .catch((error: unknown) => {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }),
    getAttributeDefinitions(apiBaseUrl, gameId).then((r) => r.data.data),
    getResourceDefinitions(apiBaseUrl, gameId).then((r) => r.data.data),
    getTypes(apiBaseUrl, gameId).then((r) => r.data.data),
    getTypeRelations(apiBaseUrl, gameId).then((r) => r.data.data),
    getEntities(apiBaseUrl, gameId).then((r) => r.data.data),
    getEntityAttributes(apiBaseUrl, gameId).then((r) => r.data.data),
    getEntityAttributeStages(apiBaseUrl, gameId).then((r) => r.data.data),
    getEntityResources(apiBaseUrl, gameId).then((r) => r.data.data),
    getEntityResourceStages(apiBaseUrl, gameId).then((r) => r.data.data),
    getEntityProviderMounts(apiBaseUrl, gameId).then((r) => r.data.data),
    getProviders(apiBaseUrl, gameId).then((r) => r.data.data),
    getProviderLifecycles(apiBaseUrl, gameId).then((r) => r.data.data),
    getProviderStateFields(apiBaseUrl, gameId).then((r) => r.data.data),
    getProviderFormulas(apiBaseUrl, gameId).then((r) => r.data.data),
    getProviderModifiers(apiBaseUrl, gameId).then((r) => r.data.data),
    getProviderListeners(apiBaseUrl, gameId).then((r) => r.data.data),
    getListenerMatchTypes(apiBaseUrl, gameId).then((r) => r.data.data),
    getProviderTickSequences(apiBaseUrl, gameId).then((r) => r.data.data),
    getAbilities(apiBaseUrl, gameId).then((r) => r.data.data),
    getAbilityParameters(apiBaseUrl, gameId).then((r) => r.data.data),
    getAbilityStateFields(apiBaseUrl, gameId).then((r) => r.data.data),
    getAbilityPhases(apiBaseUrl, gameId).then((r) => r.data.data),
    getAbilityCosts(apiBaseUrl, gameId).then((r) => r.data.data),
    getAbilityCooldowns(apiBaseUrl, gameId).then((r) => r.data.data),
    getEffectSequences(apiBaseUrl, gameId).then((r) => r.data.data),
    getEffectSteps(apiBaseUrl, gameId).then((r) => r.data.data),
    getAbilityPhaseEffectSequences(apiBaseUrl, gameId).then((r) => r.data.data),
    getListenerEffectSequences(apiBaseUrl, gameId).then((r) => r.data.data),
    getExecuteEffectDetails(apiBaseUrl, gameId).then((r) => r.data.data)
  ]);

  const state = stateResult.data.data;
  const currentRevision = stateResult.data.currentRevision;

  return {
    gameId,
    currentRevision,
    state,
    progressionSchema,
    attributeDefinitions,
    resourceDefinitions,
    types,
    typeRelations,
    entities,
    entityAttributes,
    entityAttributeStages,
    entityResources,
    entityResourceStages,
    entityProviderMounts,
    providers,
    providerLifecycles,
    providerStateFields,
    providerFormulas,
    providerModifiers,
    providerListeners,
    listenerMatchTypes,
    providerTickSequences,
    abilities,
    abilityParameters,
    abilityStateFields,
    abilityPhases,
    abilityCosts,
    abilityCooldowns,
    effectSequences,
    effectSteps,
    abilityPhaseEffectSequences,
    listenerEffectSequences,
    executeEffectDetails
  };
}

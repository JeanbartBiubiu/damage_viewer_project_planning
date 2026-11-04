import { ApiRequestError, encodePathSegment, requestJson, type ApiResult } from './apiClient';
import { parseBuildOptionSkillRelation } from './skillRelationClient';
import {
  BUILD_BUDGET_SOURCES,
  BUILD_CONFIGURATION_MODES,
  type BuildBudget,
  type BuildConfigurationMode,
  type BuildDefinition,
  type BuildExclusion,
  type BuildGroup,
  type BuildGroupListResponse,
  type BuildGroupRole,
  type BuildOption,
  type BuildOptionListResponse,
  type BuildPrerequisite,
  type BuildSelectionRules,
  type BuildSlot,
  type BuildSlotRule,
  type BuildSystem,
  type BuildSystemListResponse,
  type CreateBuildGroupRequest,
  type CreateBuildOptionRequest,
  type CreateBuildSystemRequest,
  type UpdateBuildGroupRequest,
  type UpdateBuildOptionRequest,
  type UpdateBuildSystemRequest
} from '../types/build';

const KEY = /^[a-z][a-z0-9_]{0,63}$/;

function invalid(): never {
  throw new ApiRequestError('构筑响应不符合接口约定，请重新读取。', 502, 'INVALID_RESPONSE');
}

function record(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  if (fields && Object.keys(row).some(field => !fields.includes(field))) invalid();
  return row;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}

function stableKey(value: unknown): string {
  const key = text(value);
  if (!KEY.test(key)) invalid();
  return key;
}

function integer(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > 2147483647) invalid();
  return value;
}

function description(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalid();
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) invalid();
  const keys = value.map(stableKey);
  if (new Set(keys).size !== keys.length) invalid();
  return keys;
}

function rules(value: unknown, mode: BuildConfigurationMode): BuildSelectionRules {
  const row = record(value, ['groupRoles', 'budget', 'prerequisites', 'exclusions']);
  if (!Array.isArray(row.groupRoles) || !Array.isArray(row.prerequisites) || !Array.isArray(row.exclusions)) invalid();
  if (!('budget' in row)) invalid();
  const groupRoles = row.groupRoles.map(role => parseRole(role));
  const roleKeys = groupRoles.map(role => role.roleKey);
  if (new Set(roleKeys).size !== roleKeys.length) invalid();
  const directed = new Set<string>();
  for (const role of groupRoles) {
    for (const other of role.distinctFromRoleKeys) {
      if (!roleKeys.includes(other)) invalid();
      const reverse = `${other}\n${role.roleKey}`;
      if (directed.has(reverse)) invalid();
      directed.add(`${role.roleKey}\n${other}`);
    }
    if (role.minimumSelectedSlots > role.slotRules.length) invalid();
  }
  const prerequisites = row.prerequisites.map(item => parsePrerequisite(item, mode));
  const pairs = prerequisites.map(item => `${item.optionKey}\n${item.requiredOptionKey}`);
  if (new Set(pairs).size !== pairs.length || hasPrerequisiteCycle(prerequisites)) invalid();
  return {
    groupRoles,
    budget: row.budget === null ? null : parseBudget(row.budget),
    prerequisites,
    exclusions: row.exclusions.map(parseExclusion)
  };
}

function parseRole(value: unknown): BuildGroupRole {
  const row = record(value, [
    'roleKey', 'name', 'groupKeys', 'minimumGroups', 'maximumGroups', 'minimumSelectedSlots',
    'maximumSelectedSlots', 'distinctFromRoleKeys', 'slotRules'
  ]);
  const groupKeys = stringArray(row.groupKeys);
  const minimumGroups = integer(row.minimumGroups, 0);
  const maximumGroups = integer(row.maximumGroups, 0);
  const minimumSelectedSlots = integer(row.minimumSelectedSlots, 0);
  const maximumSelectedSlots = integer(row.maximumSelectedSlots, 0);
  if (minimumGroups > maximumGroups || maximumGroups > groupKeys.length || minimumGroups > groupKeys.length) invalid();
  if (minimumSelectedSlots > maximumSelectedSlots) invalid();
  if (!Array.isArray(row.slotRules)) invalid();
  const slotRules = row.slotRules.map(rule => parseSlotRule(rule, groupKeys));
  const slotIdentities = slotRules.map(rule => `${rule.groupKey}\n${rule.slotKey}`);
  if (new Set(slotIdentities).size !== slotIdentities.length) invalid();
  return {
    roleKey: stableKey(row.roleKey),
    name: text(row.name),
    groupKeys,
    minimumGroups,
    maximumGroups,
    minimumSelectedSlots,
    maximumSelectedSlots,
    distinctFromRoleKeys: stringArray(row.distinctFromRoleKeys).filter(key => key !== stableKey(row.roleKey) || invalid()),
    slotRules
  };
}

function parseSlotRule(value: unknown, groupKeys: string[]): BuildSlotRule {
  const row = record(value, ['groupKey', 'slotKey', 'minimumSelections', 'maximumSelections']);
  const groupKey = stableKey(row.groupKey);
  if (!groupKeys.includes(groupKey)) invalid();
  const minimumSelections = integer(row.minimumSelections, 0);
  const maximumSelections = integer(row.maximumSelections, 0);
  if (minimumSelections > maximumSelections) invalid();
  return { groupKey, slotKey: stableKey(row.slotKey), minimumSelections, maximumSelections };
}

function parseBudget(value: unknown): BuildBudget {
  const row = record(value, ['budgetKey', 'name', 'maximumSource', 'fixedMaximum']);
  if (!BUILD_BUDGET_SOURCES.includes(row.maximumSource as BuildBudget['maximumSource'])) invalid();
  const maximumSource = row.maximumSource as BuildBudget['maximumSource'];
  const fixedMaximum = maximumSource === 'FIXED' ? integer(row.fixedMaximum, 0) : null;
  if (maximumSource === 'SCENARIO_INPUT' && row.fixedMaximum !== null) invalid();
  return { budgetKey: stableKey(row.budgetKey), name: text(row.name), maximumSource, fixedMaximum };
}

function parsePrerequisite(value: unknown, mode: BuildConfigurationMode): BuildPrerequisite {
  const row = record(value, ['optionKey', 'minimumRank', 'requiredOptionKey', 'requiredMinimumRank']);
  const optionKey = stableKey(row.optionKey);
  const requiredOptionKey = stableKey(row.requiredOptionKey);
  if (optionKey === requiredOptionKey) invalid();
  const minimumRank = integer(row.minimumRank, 1);
  const requiredMinimumRank = integer(row.requiredMinimumRank, 1);
  if (mode === 'SLOT_SELECTION' && (minimumRank !== 1 || requiredMinimumRank !== 1)) invalid();
  return { optionKey, minimumRank, requiredOptionKey, requiredMinimumRank };
}

function parseExclusion(value: unknown): BuildExclusion {
  const row = record(value, ['optionKeys', 'maximumSelected']);
  const optionKeys = stringArray(row.optionKeys);
  if (optionKeys.length === 0) invalid();
  const maximumSelected = integer(row.maximumSelected, 0);
  if (maximumSelected > optionKeys.length) invalid();
  return { optionKeys, maximumSelected };
}

function hasPrerequisiteCycle(ruleset: BuildPrerequisite[]): boolean {
  const edges = new Map<string, string[]>();
  for (const rule of ruleset) {
    const next = edges.get(rule.requiredOptionKey) ?? [];
    next.push(rule.optionKey);
    edges.set(rule.requiredOptionKey, next);
  }
  const color = new Map<string, number>();
  const visit = (node: string): boolean => {
    const state = color.get(node) ?? 0;
    if (state === 2) return true;
    if (state === 1) return false;
    color.set(node, 2);
    for (const next of edges.get(node) ?? []) {
      if (visit(next)) return true;
    }
    color.set(node, 1);
    return false;
  };
  return ruleset.some(rule => visit(rule.requiredOptionKey));
}

function timestamps(row: Record<string, unknown>): { createdAt: string; updatedAt: string } {
  return { createdAt: text(row.createdAt), updatedAt: text(row.updatedAt) };
}

function system(value: unknown, gameId: string): BuildSystem {
  const row = record(value, [
    'gameId', 'systemKey', 'name', 'description', 'configurationMode', 'sortOrder',
    'selectionRules', 'createdAt', 'updatedAt'
  ]);
  if (row.gameId !== gameId) invalid();
  const configurationMode = row.configurationMode;
  if (!BUILD_CONFIGURATION_MODES.includes(configurationMode as BuildConfigurationMode)) invalid();
  return {
    gameId,
    systemKey: stableKey(row.systemKey),
    name: text(row.name),
    description: description(row.description),
    configurationMode: configurationMode as BuildConfigurationMode,
    sortOrder: integer(row.sortOrder, 0),
    selectionRules: rules(row.selectionRules, configurationMode as BuildConfigurationMode),
    ...timestamps(row)
  };
}

function slot(value: unknown): BuildSlot {
  const row = record(value, ['slotKey', 'name', 'minimumSelections', 'maximumSelections', 'optionKeys']);
  const minimumSelections = integer(row.minimumSelections, 0);
  const maximumSelections = integer(row.maximumSelections, 0);
  if (minimumSelections > maximumSelections) invalid();
  return {
    slotKey: stableKey(row.slotKey),
    name: text(row.name),
    minimumSelections,
    maximumSelections,
    optionKeys: stringArray(row.optionKeys)
  };
}

function group(value: unknown, gameId: string, systemKey?: string): BuildGroup {
  const row = record(value, [
    'gameId', 'systemKey', 'groupKey', 'name', 'description', 'sortOrder', 'slots', 'createdAt', 'updatedAt'
  ]);
  if (row.gameId !== gameId) invalid();
  const parsedSystemKey = stableKey(row.systemKey);
  if (systemKey !== undefined && parsedSystemKey !== systemKey) invalid();
  if (!Array.isArray(row.slots)) invalid();
  const slots = row.slots.map(slot);
  if (new Set(slots.map(item => item.slotKey)).size !== slots.length) invalid();
  return {
    gameId,
    systemKey: parsedSystemKey,
    groupKey: stableKey(row.groupKey),
    name: text(row.name),
    description: description(row.description),
    sortOrder: integer(row.sortOrder, 0),
    slots,
    ...timestamps(row)
  };
}

function option(value: unknown, gameId: string, systemKey?: string): BuildOption {
  const row = record(value, [
    'gameId', 'systemKey', 'optionKey', 'name', 'description', 'maxRank', 'rankCosts', 'createdAt', 'updatedAt'
  ]);
  if (row.gameId !== gameId) invalid();
  const parsedSystemKey = stableKey(row.systemKey);
  if (systemKey !== undefined && parsedSystemKey !== systemKey) invalid();
  const maxRank = integer(row.maxRank, 1);
  if (!Array.isArray(row.rankCosts) || row.rankCosts.length !== maxRank) invalid();
  return {
    gameId,
    systemKey: parsedSystemKey,
    optionKey: stableKey(row.optionKey),
    name: text(row.name),
    description: description(row.description),
    maxRank,
    rankCosts: row.rankCosts.map(cost => integer(cost, 0)),
    ...timestamps(row)
  };
}

function assertSnapshot(definition: BuildDefinition): void {
  const { system: current, groups, options, skillRelations } = definition;
  if (new Set(groups.map(item => item.groupKey)).size !== groups.length) invalid();
  if (new Set(options.map(item => item.optionKey)).size !== options.length) invalid();
  const optionIndex = new Map(options.map(item => [item.optionKey, item]));
  const groupIndex = new Map(groups.map(item => [item.groupKey, item]));
  const placed = new Set<string>();
  for (const item of groups) {
    if (item.systemKey !== current.systemKey) invalid();
    for (const entry of item.slots) {
      for (const optionKey of entry.optionKeys) {
        if (!optionIndex.has(optionKey)) invalid();
        if (current.configurationMode === 'POINT_ALLOCATION' && placed.has(optionKey)) invalid();
        placed.add(optionKey);
      }
    }
  }
  if (current.configurationMode === 'SLOT_SELECTION' && options.some(item => item.maxRank !== 1)) invalid();
  if (current.selectionRules.budget === null && options.some(item => item.rankCosts.some(cost => cost !== 0))) invalid();
  for (const role of current.selectionRules.groupRoles) {
    for (const groupKey of role.groupKeys) if (!groupIndex.has(groupKey)) invalid();
    for (const rule of role.slotRules) {
      const target = groupIndex.get(rule.groupKey)?.slots.find(entry => entry.slotKey === rule.slotKey);
      if (!target || rule.minimumSelections < target.minimumSelections || rule.maximumSelections > target.maximumSelections) invalid();
    }
  }
  for (const rule of current.selectionRules.prerequisites) {
    const left = optionIndex.get(rule.optionKey);
    const right = optionIndex.get(rule.requiredOptionKey);
    if (!left || !right || rule.minimumRank > left.maxRank || rule.requiredMinimumRank > right.maxRank) invalid();
  }
  for (const rule of current.selectionRules.exclusions) {
    if (rule.optionKeys.some(optionKey => !optionIndex.has(optionKey))) invalid();
  }
  const relations = new Set<string>();
  for (const relation of skillRelations) {
    if (relation.systemKey !== current.systemKey) invalid();
    const target = optionIndex.get(relation.optionKey);
    if (!target || relation.activationRank > target.maxRank) invalid();
    if (current.configurationMode === 'SLOT_SELECTION' && relation.skillLevelMode !== 'FIXED') invalid();
    const identity = JSON.stringify([relation.systemKey, relation.optionKey, relation.skillKey]);
    if (relations.has(identity)) invalid();
    relations.add(identity);
  }
}

function definition(value: unknown, gameId: string, systemKey: string): BuildDefinition {
  const row = record(value, ['system', 'groups', 'options', 'skillRelations']);
  if (!Array.isArray(row.groups) || !Array.isArray(row.options) || !Array.isArray(row.skillRelations)) invalid();
  const parsed: BuildDefinition = {
    system: system(row.system, gameId),
    groups: row.groups.map(item => group(item, gameId, systemKey)),
    options: row.options.map(item => option(item, gameId, systemKey)),
    skillRelations: row.skillRelations.map(item => parseBuildOptionSkillRelation(item, gameId, { systemKey }))
  };
  if (parsed.system.systemKey !== systemKey) invalid();
  assertSnapshot(parsed);
  return parsed;
}

function basePath(gameId: string, systemKey?: string): string {
  const root = `/api/admin/games/${encodePathSegment(gameId)}/build-systems`;
  return systemKey === undefined ? root : `${root}/${encodePathSegment(systemKey)}`;
}

function keywordPath(path: string, keyword?: string): string {
  const normalized = keyword?.trim();
  if (!normalized) return path;
  return `${path}?${new URLSearchParams({ keyword: normalized })}`;
}

async function listed<T>(
  request: Promise<ApiResult<unknown>>, parse: (value: unknown) => T, identity: (value: T) => string
): Promise<ApiResult<{ items: T[]; total: number }>> {
  const result = await request;
  const row = record(result.data, ['items', 'total']);
  if (!Array.isArray(row.items) || row.total !== row.items.length) invalid();
  const items = row.items.map(parse);
  if (new Set(items.map(identity)).size !== items.length) invalid();
  return { ...result, data: { items, total: items.length } };
}

async function exact<T>(
  request: Promise<ApiResult<unknown>>, parse: (value: unknown) => T, identity: (value: T) => string, key: string
): Promise<ApiResult<T>> {
  const result = await request;
  const data = parse(result.data);
  if (identity(data) !== key) invalid();
  return { ...result, data };
}

export function listBuildSystems(apiBaseUrl: string, gameId: string, keyword?: string): Promise<ApiResult<BuildSystemListResponse>> {
  return listed(requestJson(apiBaseUrl, keywordPath(basePath(gameId), keyword)), value => system(value, gameId), value => value.systemKey);
}

export function getBuildSystem(apiBaseUrl: string, gameId: string, systemKey: string) {
  return exact(requestJson(apiBaseUrl, basePath(gameId, systemKey)), value => system(value, gameId), value => value.systemKey, systemKey);
}

export function createBuildSystem(apiBaseUrl: string, gameId: string, body: CreateBuildSystemRequest) {
  return exact(requestJson(apiBaseUrl, basePath(gameId), { method: 'POST', body: JSON.stringify(body) }), value => system(value, gameId), value => value.systemKey, body.systemKey);
}

export function updateBuildSystem(apiBaseUrl: string, gameId: string, systemKey: string, body: UpdateBuildSystemRequest) {
  return exact(requestJson(apiBaseUrl, basePath(gameId, systemKey), { method: 'PUT', body: JSON.stringify(body) }), value => system(value, gameId), value => value.systemKey, systemKey);
}

export function deleteBuildSystem(apiBaseUrl: string, gameId: string, systemKey: string) {
  return requestJson<null>(apiBaseUrl, basePath(gameId, systemKey), { method: 'DELETE' });
}

export function getBuildDefinition(apiBaseUrl: string, gameId: string, systemKey: string): Promise<ApiResult<BuildDefinition>> {
  return exact(
    requestJson(apiBaseUrl, `${basePath(gameId, systemKey)}/definition`),
    value => definition(value, gameId, systemKey),
    value => value.system.systemKey,
    systemKey
  );
}

export function listBuildGroups(apiBaseUrl: string, gameId: string, systemKey: string, keyword?: string): Promise<ApiResult<BuildGroupListResponse>> {
  return listed(requestJson(apiBaseUrl, keywordPath(`${basePath(gameId, systemKey)}/groups`, keyword)), value => group(value, gameId, systemKey), value => value.groupKey);
}

export function getBuildGroup(apiBaseUrl: string, gameId: string, systemKey: string, groupKey: string) {
  return exact(requestJson(apiBaseUrl, `${basePath(gameId, systemKey)}/groups/${encodePathSegment(groupKey)}`), value => group(value, gameId, systemKey), value => value.groupKey, groupKey);
}

export function createBuildGroup(apiBaseUrl: string, gameId: string, systemKey: string, body: CreateBuildGroupRequest) {
  return exact(requestJson(apiBaseUrl, `${basePath(gameId, systemKey)}/groups`, { method: 'POST', body: JSON.stringify(body) }), value => group(value, gameId, systemKey), value => value.groupKey, body.groupKey);
}

export function updateBuildGroup(apiBaseUrl: string, gameId: string, systemKey: string, groupKey: string, body: UpdateBuildGroupRequest) {
  return exact(requestJson(apiBaseUrl, `${basePath(gameId, systemKey)}/groups/${encodePathSegment(groupKey)}`, { method: 'PUT', body: JSON.stringify(body) }), value => group(value, gameId, systemKey), value => value.groupKey, groupKey);
}

export function deleteBuildGroup(apiBaseUrl: string, gameId: string, systemKey: string, groupKey: string) {
  return requestJson<null>(apiBaseUrl, `${basePath(gameId, systemKey)}/groups/${encodePathSegment(groupKey)}`, { method: 'DELETE' });
}

export function listBuildOptions(apiBaseUrl: string, gameId: string, systemKey: string, keyword?: string): Promise<ApiResult<BuildOptionListResponse>> {
  return listed(requestJson(apiBaseUrl, keywordPath(`${basePath(gameId, systemKey)}/options`, keyword)), value => option(value, gameId, systemKey), value => value.optionKey);
}

export function getBuildOption(apiBaseUrl: string, gameId: string, systemKey: string, optionKey: string) {
  return exact(requestJson(apiBaseUrl, `${basePath(gameId, systemKey)}/options/${encodePathSegment(optionKey)}`), value => option(value, gameId, systemKey), value => value.optionKey, optionKey);
}

export function createBuildOption(apiBaseUrl: string, gameId: string, systemKey: string, body: CreateBuildOptionRequest) {
  return exact(requestJson(apiBaseUrl, `${basePath(gameId, systemKey)}/options`, { method: 'POST', body: JSON.stringify(body) }), value => option(value, gameId, systemKey), value => value.optionKey, body.optionKey);
}

export function updateBuildOption(apiBaseUrl: string, gameId: string, systemKey: string, optionKey: string, body: UpdateBuildOptionRequest) {
  return exact(requestJson(apiBaseUrl, `${basePath(gameId, systemKey)}/options/${encodePathSegment(optionKey)}`, { method: 'PUT', body: JSON.stringify(body) }), value => option(value, gameId, systemKey), value => value.optionKey, optionKey);
}

export function deleteBuildOption(apiBaseUrl: string, gameId: string, systemKey: string, optionKey: string) {
  return requestJson<null>(apiBaseUrl, `${basePath(gameId, systemKey)}/options/${encodePathSegment(optionKey)}`, { method: 'DELETE' });
}

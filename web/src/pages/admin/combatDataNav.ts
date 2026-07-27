import {
  COMBAT_DATA_RESOURCE_LIST,
  RESOURCE_GROUPS,
  getCombatDataResource,
  type CombatDataResourceConfig,
  type ResourceGroup
} from './combat-data/resourceRegistry';
import {
  buildCanonicalCombatDataHref,
  buildCombatDataFilterHref,
  parseCombatDataFilterQuery,
  splitCombatDataHash,
  type FilterFieldPair
} from './combat-data/resourceRelations';

export type CombatDataNavItem = {
  /** Resource id, e.g. `effect-steps`. */
  id: string;
  /** Full hash path without `#/`, e.g. `combat-data/effect-steps`. */
  hashSegment: string;
  label: string;
  summary: string;
  groupId: string;
};

export type CombatDataNavGroup = {
  id: string;
  label: string;
  items: CombatDataNavItem[];
};

export const COMBAT_DATA_HASH_PREFIX = 'combat-data';

export const DEFAULT_COMBAT_DATA_RESOURCE_ID =
  COMBAT_DATA_RESOURCE_LIST[0]?.id ?? 'progression-schema';

export function combatDataHashSegment(resourceId: string): string {
  return `${COMBAT_DATA_HASH_PREFIX}/${resourceId}`;
}

export function combatDataHref(resourceId: string, pairs: FilterFieldPair[] = []): string {
  return pairs.length > 0
    ? buildCombatDataFilterHref(resourceId, pairs)
    : buildCanonicalCombatDataHref(resourceId);
}

export function toCombatDataNavItem(resource: CombatDataResourceConfig): CombatDataNavItem {
  return {
    id: resource.id,
    hashSegment: combatDataHashSegment(resource.id),
    label: resource.label,
    summary: resource.summary,
    groupId: resource.groupId
  };
}

/** Every registry resource → unique `combat-data/<id>` nav entry. */
export const combatDataNavItems: CombatDataNavItem[] = COMBAT_DATA_RESOURCE_LIST.map(toCombatDataNavItem);

export const combatDataNavGroups: CombatDataNavGroup[] = RESOURCE_GROUPS.map((group: ResourceGroup) => ({
  id: group.id,
  label: group.label,
  items: combatDataNavItems.filter((item) => item.groupId === group.id)
}));

export function isKnownCombatDataResourceId(resourceId: string): boolean {
  return getCombatDataResource(resourceId) !== undefined;
}

/**
 * Parse hash path segments after stripping `#/` and any `?query`.
 * - `combat-data` / `admin` → default redirect target (null resource means bare index)
 * - `combat-data/effect-steps` → that resource
 * - unknown resource id → null (caller should redirect to default)
 */
export function parseCombatDataRoute(segments: string[]): {
  isCombatDataRoute: boolean;
  resourceId: string | null;
  needsDefaultRedirect: boolean;
} {
  const head = segments[0];
  if (head !== COMBAT_DATA_HASH_PREFIX && head !== 'admin') {
    return { isCombatDataRoute: false, resourceId: null, needsDefaultRedirect: false };
  }

  const resourceId = segments[1] ?? null;
  if (!resourceId) {
    return { isCombatDataRoute: true, resourceId: null, needsDefaultRedirect: true };
  }

  if (!isKnownCombatDataResourceId(resourceId)) {
    return { isCombatDataRoute: true, resourceId: null, needsDefaultRedirect: true };
  }

  return { isCombatDataRoute: true, resourceId, needsDefaultRedirect: false };
}

/**
 * Read combat-data resource + filter pairs from the current location hash.
 * Invalid filters yield `filterOk: false` (caller should canonicalize).
 */
export function readCombatDataLocation(hash = typeof window !== 'undefined' ? window.location.hash : ''): {
  isCombatDataRoute: boolean;
  resourceId: string | null;
  needsDefaultRedirect: boolean;
  filterPairs: FilterFieldPair[];
  filterOk: boolean;
} {
  const { segments, query } = splitCombatDataHash(hash);
  const parsed = parseCombatDataRoute(segments);
  if (!parsed.isCombatDataRoute || !parsed.resourceId) {
    return {
      ...parsed,
      filterPairs: [],
      filterOk: true
    };
  }
  if (!query) {
    return {
      ...parsed,
      filterPairs: [],
      filterOk: true
    };
  }
  const filter = parseCombatDataFilterQuery(query, parsed.resourceId);
  if (!filter.ok) {
    return {
      ...parsed,
      filterPairs: [],
      filterOk: false
    };
  }
  return {
    ...parsed,
    filterPairs: filter.pairs,
    filterOk: true
  };
}

/** Registry domain group id for a resource (`effects`, `entities`, …). */
export function registryGroupIdForCombatDataResource(resourceId: string): string | undefined {
  return getCombatDataResource(resourceId)?.groupId;
}

export function getAdjacentCombatDataResources(resourceId: string): {
  group: ResourceGroup | undefined;
  previous: CombatDataResourceConfig | null;
  next: CombatDataResourceConfig | null;
  siblings: CombatDataResourceConfig[];
} {
  const resource = getCombatDataResource(resourceId);
  if (!resource) {
    return { group: undefined, previous: null, next: null, siblings: [] };
  }

  const group = RESOURCE_GROUPS.find((item) => item.id === resource.groupId);
  const siblings = COMBAT_DATA_RESOURCE_LIST.filter((item) => item.groupId === resource.groupId);
  const index = siblings.findIndex((item) => item.id === resourceId);

  return {
    group,
    previous: index > 0 ? siblings[index - 1] ?? null : null,
    next: index >= 0 && index < siblings.length - 1 ? siblings[index + 1] ?? null : null,
    siblings
  };
}

/** @deprecated Prefer combatDataNavItems; kept for docs/checklist compatibility. */
export const combatDataInternalResourceIds = COMBAT_DATA_RESOURCE_LIST.map((resource) => resource.id);

export type { FilterFieldPair };

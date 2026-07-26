import {
  COMBAT_DATA_RESOURCE_LIST,
  filterReferenceRecords,
  getCombatDataResource,
  type CombatDataResourceConfig,
  type ReferenceDef,
  type ResourceFormValues,
  type ResourceWorkflow,
  type ResourceWorkflowException
} from './resourceRegistry';

const COMBAT_DATA_HASH_PREFIX = 'combat-data';

function combatDataHashSegment(resourceId: string): string {
  return `${COMBAT_DATA_HASH_PREFIX}/${resourceId}`;
}

/** Ordered filter pair for hash context links and client-side row matching. */
export type FilterFieldPair = {
  field: string;
  value: string;
};

export type RelationEdgeKind = 'reference' | 'dependent' | 'compound' | 'semantic';

export type RelationEdge = {
  /** Resource that holds the foreign key / compound keys. */
  fromResourceId: string;
  /** Resource being pointed at (upstream for from). */
  toResourceId: string;
  /** Declared field pairs in registry order (one for normal; two+ for compound). */
  fieldPairs: Array<{ fromField: string; toField: string }>;
  kind: RelationEdgeKind;
  /** For dependent edges: controlling field on `from`. */
  dependsOn?: string;
  /** For dependent edges: controlling value that activates this edge. */
  dependsOnValue?: string;
  label?: string;
};

export type MultiHopChain = {
  id: string;
  resourceId: string;
  assistanceField: string;
  sourceField: string;
  hops: Array<{ resourceId: string; matchField: string; valueField: string }>;
  targetFilter: { resourceId: string; recordField: string };
};

export type NeighborRelationState =
  | { status: 'loading' }
  | { status: 'empty-upstream' }
  | { status: 'missing-value'; rawValue: string }
  | { status: 'unknown' }
  | { status: 'ready'; count: number; records: Record<string, unknown>[] }
  | { status: 'zero' };

export type ResolvedLabel = {
  primary: string;
  secondary?: string;
  missing?: boolean;
};

export const MAX_CONCURRENT_DOWNSTREAM_REQUESTS = 3;

function cellString(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function trimCell(value: unknown): string {
  return cellString(value).trim();
}

export function getResourceWorkflow(resourceId: string): ResourceWorkflow | undefined {
  return getCombatDataResource(resourceId)?.workflow;
}

/** Allowed query fields: pathKeys ∪ static reference fields ∪ dependent reference fields. */
export function listAllowedFilterFields(config: CombatDataResourceConfig): string[] {
  const fields = new Set<string>();
  for (const key of config.pathKeys) {
    fields.add(key);
  }
  for (const reference of config.references ?? []) {
    fields.add(reference.field);
  }
  for (const dependent of config.dependentReferences ?? []) {
    fields.add(dependent.field);
  }
  return [...fields];
}

export function isAllowedFilterField(config: CombatDataResourceConfig, field: string): boolean {
  return listAllowedFilterFields(config).includes(field);
}

/**
 * Fail-closed percent-encoding check for raw query strings.
 * `URLSearchParams` accepts stray/invalid `%` sequences; reject those before parsing.
 * Valid `%XX` hex escapes (including UTF-8 multi-byte), `+` as space, and plain text pass.
 */
export function isWellFormedCombatDataQueryEncoding(raw: string): boolean {
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== '%') {
      continue;
    }
    if (i + 2 >= raw.length) {
      return false;
    }
    const h1 = raw[i + 1]!;
    const h2 = raw[i + 2]!;
    if (!/[0-9A-Fa-f]/.test(h1) || !/[0-9A-Fa-f]/.test(h2)) {
      return false;
    }
    i += 2;
  }
  try {
    // `+` is application/x-www-form-urlencoded space; decode as `%20` for UTF-8 checks.
    decodeURIComponent(raw.replace(/\+/g, '%20'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure plan for invalid-filter canonicalization without a browser-history push.
 * Caller applies `history.replaceState` when `replace` is true, then updates React state.
 */
export function planInvalidCombatDataFilterSync(
  currentHash: string,
  resourceId: string
): { replace: boolean; nextHash: string; filterPairs: FilterFieldPair[] } {
  const nextHash = buildCanonicalCombatDataHref(resourceId);
  return {
    replace: currentHash !== nextHash,
    nextHash,
    filterPairs: []
  };
}

/** Build exact path-key filter pairs for a saved form/record (AND match after refresh). */
export function buildSavedRecordFilterPairs(
  pathKeys: string[],
  source: Record<string, unknown> | ResourceFormValues
): FilterFieldPair[] {
  const pairs: FilterFieldPair[] = [];
  for (const field of pathKeys) {
    const raw = source[field];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      continue;
    }
    pairs.push({ field, value: String(raw) });
  }
  return pairs;
}

/**
 * Parse `field=&value=` alternating query for a known resource.
 * Rejects unknown fields, duplicates, empty values, unpaired keys, or any other key.
 */
export function parseCombatDataFilterQuery(
  query: string,
  resourceId: string
): { ok: true; pairs: FilterFieldPair[] } | { ok: false; reason: string } {
  const config = getCombatDataResource(resourceId);
  if (!config) {
    return { ok: false, reason: 'unknown-resource' };
  }

  const raw = query.startsWith('?') ? query.slice(1) : query;
  if (!raw) {
    return { ok: true, pairs: [] };
  }

  if (!isWellFormedCombatDataQueryEncoding(raw)) {
    return { ok: false, reason: 'malformed-encoding' };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { ok: false, reason: 'malformed-encoding' };
  }

  const entries: Array<{ key: string; value: string }> = [];
  for (const [key, value] of params.entries()) {
    entries.push({ key, value });
  }

  if (entries.length === 0) {
    return { ok: true, pairs: [] };
  }

  if (entries.length % 2 !== 0) {
    return { ok: false, reason: 'unpaired' };
  }

  const pairs: FilterFieldPair[] = [];
  const seenFields = new Set<string>();
  const allowed = new Set(listAllowedFilterFields(config));

  for (let i = 0; i < entries.length; i += 2) {
    const fieldEntry = entries[i];
    const valueEntry = entries[i + 1];
    if (!fieldEntry || !valueEntry) {
      return { ok: false, reason: 'unpaired' };
    }
    if (fieldEntry.key !== 'field' || valueEntry.key !== 'value') {
      return { ok: false, reason: 'invalid-keys' };
    }
    const field = fieldEntry.value;
    const value = valueEntry.value;
    if (!field || !value) {
      return { ok: false, reason: 'empty' };
    }
    if (!allowed.has(field)) {
      return { ok: false, reason: 'disallowed-field' };
    }
    if (seenFields.has(field)) {
      return { ok: false, reason: 'duplicate-field' };
    }
    seenFields.add(field);
    pairs.push({ field, value });
  }

  return { ok: true, pairs };
}

/** Serialize ordered pairs; registry/declaration order is caller responsibility. */
export function serializeCombatDataFilterQuery(pairs: FilterFieldPair[]): string {
  if (pairs.length === 0) {
    return '';
  }
  const params = new URLSearchParams();
  for (const pair of pairs) {
    params.append('field', pair.field);
    params.append('value', pair.value);
  }
  return params.toString();
}

export function buildCombatDataFilterHref(resourceId: string, pairs: FilterFieldPair[]): string {
  const path = combatDataHashSegment(resourceId);
  const query = serializeCombatDataFilterQuery(pairs);
  return query ? `#/${path}?${query}` : `#/${path}`;
}

export function buildCanonicalCombatDataHref(resourceId: string): string {
  return `#/${combatDataHashSegment(resourceId)}`;
}

/**
 * Exact client-side match: reject null/undefined field values; otherwise
 * `String(record[field]) === value` for every pair (AND).
 */
export function matchRecordByFilterPairs(
  record: Record<string, unknown>,
  pairs: FilterFieldPair[]
): boolean {
  if (pairs.length === 0) {
    return true;
  }
  for (const pair of pairs) {
    const raw = record[pair.field];
    if (raw === undefined || raw === null) {
      return false;
    }
    if (String(raw) !== pair.value) {
      return false;
    }
  }
  return true;
}

export function filterRecordsByPairs(
  records: Record<string, unknown>[],
  pairs: FilterFieldPair[]
): Record<string, unknown>[] {
  if (pairs.length === 0) {
    return records;
  }
  return records.filter((record) => matchRecordByFilterPairs(record, pairs));
}

/** Local search across stringified record values (case-insensitive). */
export function searchRecords(
  records: Record<string, unknown>[],
  query: string
): Record<string, unknown>[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return records;
  }
  return records.filter((record) =>
    Object.values(record).some((value) => {
      if (value === undefined || value === null) {
        return false;
      }
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value).toLowerCase().includes(needle);
        } catch {
          return String(value).toLowerCase().includes(needle);
        }
      }
      return String(value).toLowerCase().includes(needle);
    })
  );
}

export function listWorkflowExceptions(
  resourceId: string,
  kind?: ResourceWorkflowException['kind']
): ResourceWorkflowException[] {
  const workflow = getResourceWorkflow(resourceId);
  const exceptions = workflow?.exceptions ?? [];
  if (!kind) {
    return exceptions;
  }
  return exceptions.filter((item) => item.kind === kind);
}

export function listMultiHopChains(): MultiHopChain[] {
  const chains: MultiHopChain[] = [];
  for (const config of COMBAT_DATA_RESOURCE_LIST) {
    for (const exception of config.workflow.exceptions ?? []) {
      if (exception.kind !== 'multi-hop-assistance') {
        continue;
      }
      chains.push({
        id: exception.id,
        resourceId: config.id,
        assistanceField: exception.assistanceField,
        sourceField: exception.sourceField,
        hops: exception.hops,
        targetFilter: exception.targetFilter
      });
    }
  }
  return chains;
}

export function getMultiHopChainForResource(resourceId: string): MultiHopChain | undefined {
  return listMultiHopChains().find((chain) => chain.resourceId === resourceId);
}

function pushUniqueEdge(edges: RelationEdge[], edge: RelationEdge): void {
  const signature = [
    edge.fromResourceId,
    edge.toResourceId,
    edge.kind,
    edge.dependsOn ?? '',
    edge.dependsOnValue ?? '',
    edge.fieldPairs.map((p) => `${p.fromField}->${p.toField}`).join('|')
  ].join('::');
  if (edges.some((existing) => {
    const existingSig = [
      existing.fromResourceId,
      existing.toResourceId,
      existing.kind,
      existing.dependsOn ?? '',
      existing.dependsOnValue ?? '',
      existing.fieldPairs.map((p) => `${p.fromField}->${p.toField}`).join('|')
    ].join('::');
    return existingSig === signature;
  })) {
    return;
  }
  edges.push(edge);
}

/** Forward edges: from resource → its upstream dependencies. */
export function listUpstreamEdges(resourceId: string): RelationEdge[] {
  const config = getCombatDataResource(resourceId);
  if (!config) {
    return [];
  }
  const edges: RelationEdge[] = [];

  for (const reference of config.references ?? []) {
    // Self-reference (entities.entityId) is identity, not an upstream dependency edge.
    if (reference.resourceId === resourceId && reference.field === reference.valueKey) {
      continue;
    }
    pushUniqueEdge(edges, {
      fromResourceId: resourceId,
      toResourceId: reference.resourceId,
      fieldPairs: [{ fromField: reference.field, toField: reference.valueKey }],
      kind: 'reference',
      label: reference.field
    });
  }

  for (const dependent of config.dependentReferences ?? []) {
    for (const [dependsOnValue, target] of Object.entries(dependent.byValue)) {
      pushUniqueEdge(edges, {
        fromResourceId: resourceId,
        toResourceId: target.resourceId,
        fieldPairs: [{ fromField: dependent.field, toField: target.valueKey }],
        kind: 'dependent',
        dependsOn: dependent.dependsOn,
        dependsOnValue,
        label: dependent.field
      });
    }
  }

  for (const exception of config.workflow.exceptions ?? []) {
    if (exception.kind === 'compound-parent') {
      pushUniqueEdge(edges, {
        fromResourceId: resourceId,
        toResourceId: exception.targetResourceId,
        fieldPairs: exception.fieldPairs.map((pair) => ({
          fromField: pair.sourceField,
          toField: pair.targetField
        })),
        kind: 'compound',
        label: exception.targetResourceId
      });
    }
    if (exception.kind === 'semantic-context') {
      pushUniqueEdge(edges, {
        fromResourceId: resourceId,
        toResourceId: exception.resourceId,
        fieldPairs: [],
        kind: 'semantic',
        label: exception.purpose
      });
    }
  }

  return edges;
}

/** Reverse edges: resources that reference `resourceId` (direct downstream). */
export function listDownstreamEdges(resourceId: string): RelationEdge[] {
  const edges: RelationEdge[] = [];
  for (const config of COMBAT_DATA_RESOURCE_LIST) {
    for (const upstream of listUpstreamEdges(config.id)) {
      if (upstream.toResourceId === resourceId && upstream.kind !== 'semantic') {
        edges.push(upstream);
      }
    }
  }
  return edges;
}

export function buildFilterPairsForEdge(
  edge: RelationEdge,
  record: Record<string, unknown>
): FilterFieldPair[] | null {
  if (edge.kind === 'semantic' || edge.fieldPairs.length === 0) {
    return null;
  }
  const pairs: FilterFieldPair[] = [];
  for (const pair of edge.fieldPairs) {
    const raw = record[pair.fromField];
    if (raw === undefined || raw === null || String(raw) === '') {
      return null;
    }
    pairs.push({ field: pair.toField, value: String(raw) });
  }
  return pairs;
}

/** Prefill when creating a child on a downstream edge from a parent (upstream) record. */
export function buildCreateChildPrefill(
  edge: RelationEdge,
  parentRecord: Record<string, unknown>
): ResourceFormValues | null {
  if (edge.kind === 'semantic' || edge.fieldPairs.length === 0) {
    return null;
  }
  const form: ResourceFormValues = {};
  for (const pair of edge.fieldPairs) {
    // Parent is the upstream (`to`); child (`from`) receives fromField values.
    const raw = parentRecord[pair.toField];
    if (raw === undefined || raw === null || String(raw) === '') {
      return null;
    }
    form[pair.fromField] = typeof raw === 'boolean' || typeof raw === 'number' ? raw : String(raw);
  }
  return form;
}

/** Filter pairs targeting a downstream child resource from a parent record. */
export function buildDownstreamFilterPairs(
  edge: RelationEdge,
  parentRecord: Record<string, unknown>
): FilterFieldPair[] | null {
  if (edge.kind === 'semantic' || edge.fieldPairs.length === 0) {
    return null;
  }
  const pairs: FilterFieldPair[] = [];
  for (const pair of edge.fieldPairs) {
    const raw = parentRecord[pair.toField];
    if (raw === undefined || raw === null || String(raw) === '') {
      return null;
    }
    pairs.push({ field: pair.fromField, value: String(raw) });
  }
  return pairs;
}

/** Copy selected record into a create draft, clearing all path/identity keys. */
export function buildCopyForm(
  config: CombatDataResourceConfig,
  record: Record<string, unknown>
): ResourceFormValues {
  const form: ResourceFormValues = {};
  const pathKeySet = new Set(config.pathKeys);
  for (const field of config.fields) {
    if (pathKeySet.has(field.name) || field.lockedOnEdit) {
      form[field.name] = field.kind === 'boolean' ? false : field.kind === 'number' ? '' : '';
      continue;
    }
    const value = record[field.name];
    if (value === undefined || value === null) {
      form[field.name] =
        field.defaultValue !== undefined
          ? field.defaultValue
          : field.kind === 'boolean'
            ? false
            : field.kind === 'json'
              ? '{}'
              : '';
      continue;
    }
    if (field.kind === 'boolean') {
      form[field.name] = Boolean(value);
    } else if (field.kind === 'number') {
      form[field.name] = typeof value === 'number' ? value : Number(value);
    } else if (field.kind === 'json') {
      form[field.name] = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } else {
      form[field.name] = String(value);
    }
  }
  return form;
}

export function resolveReferenceLabel(
  records: Record<string, unknown>[] | undefined,
  valueKey: string,
  labelKey: string | undefined,
  rawValue: unknown
): ResolvedLabel {
  const raw =
    rawValue === undefined || rawValue === null || rawValue === ''
      ? ''
      : String(rawValue);
  if (!raw) {
    return { primary: '--' };
  }
  if (!records) {
    return { primary: raw, secondary: raw };
  }
  const match = records.find((record) => trimCell(record[valueKey]) === trimCell(raw));
  if (!match) {
    return { primary: raw, secondary: raw, missing: true };
  }
  const resolvedLabelKey = labelKey ?? valueKey;
  const label = trimCell(match[resolvedLabelKey]);
  if (label && label !== raw) {
    return { primary: label, secondary: raw };
  }
  return { primary: raw, secondary: raw };
}

/**
 * Apply multi-hop same-Provider filter for assisted Select options.
 * Missing/ambiguous hop or failed intermediate → null (assistance unavailable).
 * Never returns the unfiltered global candidate list.
 */
export function applyMultiHopTargetFilter(
  chain: MultiHopChain,
  sourceValue: unknown,
  recordsByResource: Record<string, Record<string, unknown>[] | undefined>,
  targetRecords: Record<string, unknown>[]
): { ok: true; records: Record<string, unknown>[] } | { ok: false; reason: string } {
  const start = trimCell(sourceValue);
  if (!start) {
    return { ok: false, reason: 'missing-source' };
  }

  let currentValue = start;
  for (const hop of chain.hops) {
    const hopRecords = recordsByResource[hop.resourceId];
    if (!hopRecords) {
      return { ok: false, reason: 'hop-unavailable' };
    }
    const matches = hopRecords.filter(
      (record) => trimCell(record[hop.matchField]) === currentValue
    );
    if (matches.length === 0) {
      return { ok: false, reason: 'hop-missing' };
    }
    if (matches.length > 1) {
      const values = new Set(matches.map((record) => trimCell(record[hop.valueField])));
      if (values.size !== 1 || [...values][0] === '') {
        return { ok: false, reason: 'hop-ambiguous' };
      }
      currentValue = [...values][0]!;
    } else {
      const next = trimCell(matches[0]![hop.valueField]);
      if (!next) {
        return { ok: false, reason: 'hop-blank' };
      }
      currentValue = next;
    }
  }

  const filtered = targetRecords.filter(
    (record) => trimCell(record[chain.targetFilter.recordField]) === currentValue
  );
  return { ok: true, records: filtered };
}

/**
 * Filter reference candidates (scope + targetPredicate already applied by registry helper).
 */
export function filterReferenceRecordsForAssistance(
  records: Record<string, unknown>[],
  reference: ReferenceDef,
  form: ResourceFormValues,
  lookupRecordsByResource?: Record<string, Record<string, unknown>[]>
): Record<string, unknown>[] {
  return filterReferenceRecords(records, reference, form, lookupRecordsByResource);
}

export function classifyNeighborState(input: {
  loading?: boolean;
  /** Request failure → 关系未知 (never zero). */
  failed?: boolean;
  upstreamEmpty?: boolean;
  rawValue?: unknown;
  matchedRecords?: Record<string, unknown>[] | null;
}): NeighborRelationState {
  if (input.loading) {
    return { status: 'loading' };
  }
  if (input.failed) {
    return { status: 'unknown' };
  }
  if (input.upstreamEmpty) {
    return { status: 'empty-upstream' };
  }
  if (input.matchedRecords == null) {
    return { status: 'unknown' };
  }
  const raw =
    input.rawValue === undefined || input.rawValue === null || input.rawValue === ''
      ? ''
      : String(input.rawValue);
  if (raw && input.matchedRecords.length === 0) {
    return { status: 'missing-value', rawValue: raw };
  }
  if (input.matchedRecords.length === 0) {
    return { status: 'zero' };
  }
  return {
    status: 'ready',
    count: input.matchedRecords.length,
    records: input.matchedRecords
  };
}

/** Display helper: failed neighbors always read as 关系未知. */
export function neighborStateLabel(state: NeighborRelationState): string {
  switch (state.status) {
    case 'loading':
      return '加载中';
    case 'empty-upstream':
      return '上游为空';
    case 'missing-value':
      return `缺失：${state.rawValue}`;
    case 'unknown':
      return '关系未知';
    case 'zero':
      return '0';
    case 'ready':
      return String(state.count);
    default:
      return '关系未知';
  }
}

/**
 * Strip hash path/query into path segments (query-free) and raw query string.
 * `#/combat-data/foo?field=a&value=1` → segments `['combat-data','foo']`, query `field=a&value=1`.
 */
export function splitCombatDataHash(hash: string): { segments: string[]; query: string } {
  const raw = hash.replace(/^#\/?/, '');
  const qIndex = raw.indexOf('?');
  const path = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const query = qIndex >= 0 ? raw.slice(qIndex + 1) : '';
  const segments = path.split('/').filter(Boolean);
  return { segments, query };
}

export function isCombatDataHashPrefix(segment: string | undefined): boolean {
  return segment === COMBAT_DATA_HASH_PREFIX || segment === 'admin';
}

/**
 * Simple concurrency pool for downstream list fetches (cap = 3).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, concurrency);
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current]!, current);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

/**
 * Phase-T3 — Provisional mechanism template registry bulk draft fill
 * (frozen plan provisional-mechanism-template-registry-phase-t3-bulk-draft-fill-v4).
 *
 * Inputs (exact paths; raw sha256/byteSize recorded dynamically, not equality-pinned):
 *   - 最小验证/unified-mechanism-inventory.json
 *   - 最小验证/wiki-only-mechanism-candidate-registry.json
 *
 * Per-card draft sources (never enter metadata.inputs / Unified currentInputHashes):
 *   - Hero: 数据参考/lol-wiki-current-champions/normalized/generic/<pageId>.json
 *   - Item: 数据参考/lol-wiki-current-items/manifest.json
 *           + 数据参考/lol-wiki-current-items/current-items.normalized.json
 *
 * Stable structural pins:
 *   - Unified mechanisms254 + key-order digest
 *   - Wiki candidates242 + key-order digest
 *   - digest = lowercase SHA256(UTF-8(keys.join("\n") + "\n"))
 *
 * Outputs:
 *   - 最小验证/provisional-mechanism-template-registry.json
 *   - 最小验证/provisional-mechanism-template-registry.csv
 *
 * CLI:
 *   node .../build-provisional-mechanism-template-registry.mjs
 *   node .../build-provisional-mechanism-template-registry.mjs --check
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const SCHEMA_VERSION = 'provisional-mechanism-template-registry-v3';
const FROZEN_PLAN_REV = 'provisional-mechanism-template-registry-phase-t3-bulk-draft-fill-v4';

const UNIFIED_REL = '最小验证/unified-mechanism-inventory.json';
const WIKI_REL = '最小验证/wiki-only-mechanism-candidate-registry.json';
const OUTPUT_JSON_REL = '最小验证/provisional-mechanism-template-registry.json';
const OUTPUT_CSV_REL = '最小验证/provisional-mechanism-template-registry.csv';

const HERO_SIDECAR_DIR_REL = '数据参考/lol-wiki-current-champions/normalized/generic';
const ITEMS_MANIFEST_REL = '数据参考/lol-wiki-current-items/manifest.json';
const ITEMS_NORMALIZED_REL = '数据参考/lol-wiki-current-items/current-items.normalized.json';
const HERO_SIDECAR_SCHEMA = 'lol-wiki-ability-generic-v1';

const STABLE_UNIFIED_MECHANISM_COUNT = 254;
const STABLE_UNIFIED_KEY_ORDER_SHA256 =
  '69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018';
const STABLE_WIKI_CANDIDATE_COUNT = 242;
const STABLE_WIKI_KEY_ORDER_SHA256 =
  '927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7';

const ALLOWED_UNIFIED_STATUSES = Object.freeze([
  'completed',
  'partial_actionable',
  'ready_to_implement',
  'blocked_runtime',
  'blocked_data',
  'out_of_scope',
  'regression_only',
  'stale_or_duplicate',
]);
const ALLOWED_UNIFIED_STATUS_SET = new Set(ALLOWED_UNIFIED_STATUSES);

const TARGET_STATUSES = Object.freeze([
  'partial_actionable',
  'ready_to_implement',
  'blocked_runtime',
  'blocked_data',
]);
const TARGET_STATUS_SET = new Set(TARGET_STATUSES);

const EXCLUDED_STATUSES = Object.freeze([
  'completed',
  'out_of_scope',
  'regression_only',
  'stale_or_duplicate',
]);
const EXCLUDED_STATUS_SET = new Set(EXCLUDED_STATUSES);

const TEMPLATE_STATE = 'provisional_unverified';
const DRAFT_STATE = 'mechanical_unverified';
const SNAPSHOT_CLAIM = 'unparsed_markup_not_numeric_truth';
const VERIFICATION_PENDING = 'pending';

const HERO_FIELD_ALLOWLIST = Object.freeze([
  'description',
  'description2',
  'description3',
  'description4',
  'description5',
  'description6',
  'leveling',
  'leveling2',
  'leveling3',
  'leveling4',
  'leveling5',
  'cooldown',
  'cost',
  'costtype',
  'damagetype',
  'notes',
]);
const LEVELING_FIELD_NAMES = Object.freeze([
  'leveling',
  'leveling2',
  'leveling3',
  'leveling4',
  'leveling5',
]);

const VERIFICATION_GATE_IDS = Object.freeze([
  'wiki_identity_and_revision',
  'wiki_numeric_contract',
  'bounded_phase_a_plan',
  'design_review_ready',
  'backend_seed_and_junit',
  'wasm_generic_test',
  'g8_unified_audit',
  'docs_and_governance',
]);

const NONCLAIMS = Object.freeze([
  'no_numeric_or_behavioral_fidelity_claim',
  'no_runtime_support_claim',
  'no_backend_materialization_claim',
  'no_g8_or_unified_status_change',
  'no_live_publish_or_migration',
  'no_new_completed_full_or_ready_assertion',
  'no_mechanical_draft_as_verified_phase_a_claim',
]);

const EXCLUSION_PROMPT_BY_ID = Object.freeze({
  full_fidelity_surfaces_review:
    'Review whether full-fidelity surfaces remain outside this provisional draft scope.',
  unresolved_data_fields_review:
    'Review unresolved data fields before any numeric contract draft proceeds.',
  geometry_selection_multitarget_review:
    'Review geometry, selection, and multi-target scope for this candidate.',
  distance_context_review: 'Review distance or ratio context required by this candidate.',
  rng_crit_context_review: 'Review RNG or critical-strike context for this candidate.',
  state_trigger_scheduling_review:
    'Review state, trigger, and scheduling behavior for this candidate.',
  cross_skill_dependency_review:
    'Review cross-skill formula dependencies for this candidate.',
  form_state_upgrade_review: 'Review form-state upgrade interactions for this candidate.',
  non_damage_or_meta_scope_review:
    'Review non-damage or meta scope boundaries for this candidate.',
  manual_scope_selection_review:
    'Review manual scope selection needed for this DPS-relevant candidate.',
});

const TAG_TO_EXCLUSION_ID = Object.freeze({
  multi_target_or_area: 'geometry_selection_multitarget_review',
  distance_or_ratio_modifier: 'distance_context_review',
  deterministic_random_crit_sequence: 'rng_crit_context_review',
  crit_scaling: 'rng_crit_context_review',
  on_hit: 'state_trigger_scheduling_review',
  every_n_hit: 'state_trigger_scheduling_review',
  magic_proc_on_third_stack: 'state_trigger_scheduling_review',
  stacking_dirty_fighting: 'state_trigger_scheduling_review',
  cooldown_or_haste_without_rotation: 'state_trigger_scheduling_review',
  attack_or_ability_hit_resource_gain: 'state_trigger_scheduling_review',
  periodic_charge_tick: 'state_trigger_scheduling_review',
  state_driven_max_mana_and_transform: 'state_trigger_scheduling_review',
  energized_charge_and_consume: 'state_trigger_scheduling_review',
  cross_skill_damage_formula: 'cross_skill_dependency_review',
  transcendent_form_skill_upgrade: 'form_state_upgrade_review',
  meta_or_non_target_dps: 'non_damage_or_meta_scope_review',
  dps_relevant_manual_review: 'manual_scope_selection_review',
});

const METADATA_KEYS = Object.freeze([
  'schemaVersion',
  'planRevision',
  'generatedAt',
  'stableKeyOrders',
  'inputs',
]);
const STABLE_KEY_ORDERS_KEYS = Object.freeze([
  'unifiedMechanismCount',
  'unifiedKeyOrderSha256',
  'wikiCandidateCount',
  'wikiKeyOrderSha256',
]);
const INPUT_ENTRY_KEYS = Object.freeze(['path', 'sha256', 'byteSize']);
const SUMMARY_KEYS = Object.freeze([
  'sourceUnifiedMechanismCount',
  'sourceWikiRegistryCount',
  'templateCount',
  'targetStatusCounts',
  'targetSourceKindCounts',
  'templateKindCounts',
  'excludedStatusCounts',
]);
const TARGET_STATUS_COUNT_KEYS = Object.freeze([
  'partial_actionable',
  'ready_to_implement',
  'blocked_runtime',
  'blocked_data',
]);
const TARGET_SOURCE_KIND_COUNT_KEYS = Object.freeze(['hero_skill', 'item_passive']);
const TEMPLATE_KIND_COUNT_KEYS = Object.freeze([
  'actionable_contract_placeholder',
  'runtime_contract_placeholder',
  'data_contract_placeholder',
]);
const EXCLUDED_STATUS_COUNT_KEYS = Object.freeze([
  'completed',
  'out_of_scope',
  'regression_only',
  'stale_or_duplicate',
]);
const TEMPLATE_KEYS = Object.freeze([
  'key',
  'inventoryOrdinal',
  'sourceKind',
  'ownerId',
  'skillKey',
  'passiveName',
  'currentStatus',
  'currentCompletionMode',
  'lane',
  'blocker',
  'mechanismTags',
  'unifiedSourceRefs',
  'wikiProvenance',
  'templateState',
  'templateKind',
  'draftContract',
  'verificationGates',
  'nonclaims',
]);
const DRAFT_CONTRACT_KEYS = Object.freeze([
  'draftState',
  'sourcePointers',
  'phaseATemplate',
  'rank',
  'resourceCost',
  'cooldownMs',
  'target',
  'timing',
  'formula',
  'operationGraph',
  'fixtures',
  'completedBoundary',
  'exclusions',
]);
const HERO_SOURCE_POINTER_KEYS = Object.freeze([
  'kind',
  'authority',
  'sidecarPath',
  'localFileSha256',
  'localFileByteSize',
  'canonical',
  'fieldRefs',
]);
const HERO_CANONICAL_KEYS = Object.freeze([
  'requestTitle',
  'resolvedTitle',
  'wikiPageId',
  'revisionId',
  'revisionTimestamp',
  'contentSha256',
  'rawByteSize',
]);
const ITEM_SOURCE_POINTER_KEYS = Object.freeze([
  'kind',
  'authority',
  'manifestPath',
  'manifestLocalFileSha256',
  'manifestLocalFileByteSize',
  'normalizedPath',
  'normalizedLocalFileSha256',
  'normalizedLocalFileByteSize',
  'canonicalRevisionId',
  'canonicalContentSha256',
  'localEqualsCanonicalClaim',
  'itemId',
  'effectSlotRefs',
]);
const PHASE_A_TEMPLATE_KEYS = Object.freeze([
  'id',
  'basisStatus',
  'basisTags',
  'requiresIndividualDesignReview',
]);
const SNAPSHOT_KEYS = Object.freeze(['fieldRef', 'raw', 'parsedNumericValue', 'claim']);
const RANK_KEYS = Object.freeze(['selection', 'value', 'sourceFieldRefs', 'verification']);
const RESOURCE_COST_KEYS = Object.freeze([
  'state',
  'sourceFieldRefs',
  'wikiMarkupSnapshots',
  'normalizedValue',
  'normalizedUnit',
  'verification',
]);
const COOLDOWN_MS_KEYS = Object.freeze([
  'state',
  'sourceFieldRefs',
  'wikiMarkupSnapshots',
  'normalizedValueMs',
  'verification',
]);
const TARGET_KEYS = Object.freeze(['mode', 'value', 'verification']);
const TIMING_KEYS = Object.freeze(['mode', 'valueMs', 'verification']);
const FORMULA_KEYS = Object.freeze([
  'mode',
  'sourceFieldRefs',
  'wikiMarkupSnapshots',
  'expression',
  'verification',
]);
const OPERATION_GRAPH_KEYS = Object.freeze([
  'templateKind',
  'nodes',
  'edges',
  'concreteIds',
  'concreteTypeIds',
  'requiredEvents',
  'requiredState',
  'productionRuntimeChangeRequired',
  'verification',
]);
const FIXTURE_KEYS = Object.freeze(['id', 'purpose', 'inputs', 'expected', 'verification']);
const EXCLUSION_KEYS = Object.freeze(['kind', 'id', 'prompt']);
const HERO_PROVENANCE_KEYS = Object.freeze([
  'ownerName',
  'pageId',
  'wikiItemId',
  'wikiEffectSlots',
  'sourceRef',
]);
const ITEM_PROVENANCE_KEYS = Object.freeze([
  'ownerName',
  'pageId',
  'wikiItemId',
  'wikiEffectSlots',
  'sourceRef',
]);
const GATE_KEYS = Object.freeze(['id', 'state']);

const CSV_COLUMNS = Object.freeze([
  'key',
  'inventoryOrdinal',
  'sourceKind',
  'ownerId',
  'skillKey',
  'passiveName',
  'currentStatus',
  'currentCompletionMode',
  'lane',
  'blocker',
  'mechanismTagsJson',
  'unifiedSourceRefsJson',
  'wikiOwnerName',
  'wikiPageId',
  'wikiItemId',
  'wikiEffectSlotsJson',
  'wikiSourceRef',
  'templateState',
  'templateKind',
  'draftContractJson',
  'verificationGatesJson',
  'nonclaimsJson',
]);

const TOP_LEVEL_KEYS = Object.freeze(['metadata', 'summary', 'templates']);

const HEX64_RE = /^[a-f0-9]{64}$/;
const HERO_SOURCE_REF_RE = /^(.+)@rev(\d+) sha256:([a-f0-9]{64})$/;
const FORBIDDEN_PROMPT_WORD_RE = /\b(verified|completed)\b/i;

const paths = {
  unified: path.join(repoRoot, ...UNIFIED_REL.split('/')),
  wiki: path.join(repoRoot, ...WIKI_REL.split('/')),
  outputJson: path.join(repoRoot, ...OUTPUT_JSON_REL.split('/')),
  outputCsv: path.join(repoRoot, ...OUTPUT_CSV_REL.split('/')),
  itemsManifest: path.join(repoRoot, ...ITEMS_MANIFEST_REL.split('/')),
  itemsNormalized: path.join(repoRoot, ...ITEMS_NORMALIZED_REL.split('/')),
};

function sha256Raw(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function keyOrderDigest(keys) {
  return sha256Raw(Buffer.from(`${keys.join('\n')}\n`, 'utf8'));
}

function canonicalizeEol(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function deepClone(value) {
  return structuredClone(value);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    if (typeof b !== 'object' || Array.isArray(b)) return false;
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    if (!ak.every((k, i) => k === bk[i])) return false;
    return ak.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function assertKeysOrder(obj, expectedKeys, label) {
  const keys = Object.keys(obj);
  if (keys.length !== expectedKeys.length || !keys.every((k, i) => k === expectedKeys[i])) {
    throw new Error(
      `${label} key order mismatch: got [${keys.join(',')}] expected [${expectedKeys.join(',')}]`,
    );
  }
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function compactJson(value) {
  return JSON.stringify(value);
}

function templateKindForStatus(status) {
  if (status === 'blocked_data') return 'data_contract_placeholder';
  if (status === 'blocked_runtime') return 'runtime_contract_placeholder';
  if (status === 'partial_actionable' || status === 'ready_to_implement') {
    return 'actionable_contract_placeholder';
  }
  throw new Error(`unexpected target status for templateKind: ${status}`);
}

function makeVerificationGates() {
  return VERIFICATION_GATE_IDS.map((id) => ({ id, state: VERIFICATION_PENDING }));
}

function makeNonclaims() {
  return [...NONCLAIMS];
}

function emptyOrderedCounts(keys) {
  const out = {};
  for (const k of keys) out[k] = 0;
  return out;
}

function isNonemptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isPositiveInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function isNonNegInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function assertExclusionPromptsFrozen() {
  for (const [id, prompt] of Object.entries(EXCLUSION_PROMPT_BY_ID)) {
    if (!isNonemptyString(prompt)) {
      throw new Error(`exclusion prompt empty @ ${id}`);
    }
    if (FORBIDDEN_PROMPT_WORD_RE.test(prompt)) {
      throw new Error(`exclusion prompt contains forbidden wording @ ${id}`);
    }
  }
}

function heroFieldRef(name) {
  return `fields.${name}`;
}

function itemEffectRef(itemId, slot) {
  return `items.${itemId}.effects.${slot}`;
}

function makeSnapshot(fieldRef, raw) {
  if (!isNonemptyString(fieldRef)) {
    throw new Error(`snapshot fieldRef must be nonempty string: ${fieldRef}`);
  }
  if (typeof raw !== 'string') {
    throw new Error(`snapshot raw must be string @ ${fieldRef}`);
  }
  return {
    fieldRef,
    raw,
    parsedNumericValue: null,
    claim: SNAPSHOT_CLAIM,
  };
}

function presentHeroFieldNames(sidecar) {
  if (!sidecar.fields || typeof sidecar.fields !== 'object' || Array.isArray(sidecar.fields)) {
    throw new Error(`sidecar.fields missing @ ${sidecar.pageId}`);
  }
  if (
    !sidecar.fieldPresence ||
    typeof sidecar.fieldPresence !== 'object' ||
    Array.isArray(sidecar.fieldPresence)
  ) {
    throw new Error(`sidecar.fieldPresence missing @ ${sidecar.pageId}`);
  }
  const present = [];
  for (const name of HERO_FIELD_ALLOWLIST) {
    if (sidecar.fieldPresence[name] === true) {
      const val = sidecar.fields[name];
      if (typeof val !== 'string') {
        throw new Error(
          `present field ${name} must be string @ ${sidecar.pageId} (got ${typeof val})`,
        );
      }
      present.push(name);
    }
  }
  return present;
}

function presentLevelingNames(presentNames) {
  const presentSet = new Set(presentNames);
  return LEVELING_FIELD_NAMES.filter((n) => presentSet.has(n));
}

function phaseATemplateId(currentStatus, sourceKind) {
  if (currentStatus === 'blocked_data') return 'data_gap_evidence_only_candidate';
  if (sourceKind === 'hero_skill') return 'hero_selected_primary_minimum_quantum_candidate';
  if (sourceKind === 'item_passive') return 'item_single_trigger_or_state_transition_candidate';
  throw new Error(`phaseATemplate discriminant fail-closed: ${currentStatus}/${sourceKind}`);
}

function buildExclusions(currentStatus, basisTags) {
  const seen = new Set();
  const out = [];
  const pushId = (id) => {
    if (seen.has(id)) return;
    const prompt = EXCLUSION_PROMPT_BY_ID[id];
    if (!isNonemptyString(prompt)) {
      throw new Error(`missing fixed exclusion prompt for id ${id}`);
    }
    if (FORBIDDEN_PROMPT_WORD_RE.test(prompt)) {
      throw new Error(`exclusion prompt forbidden wording @ ${id}`);
    }
    seen.add(id);
    out.push({ kind: 'candidate_exclusion', id, prompt });
  };

  pushId('full_fidelity_surfaces_review');
  if (currentStatus === 'blocked_data') {
    pushId('unresolved_data_fields_review');
  }
  for (const tag of basisTags) {
    const mapped = TAG_TO_EXCLUSION_ID[tag];
    if (mapped) pushId(mapped);
  }
  return out;
}

function loadItemDraftSources() {
  const manifestBuf = fs.readFileSync(paths.itemsManifest);
  const normalizedBuf = fs.readFileSync(paths.itemsNormalized);
  const manifest = JSON.parse(manifestBuf.toString('utf8'));
  const normalized = JSON.parse(normalizedBuf.toString('utf8'));

  if (!isPositiveInt(manifest.revid)) {
    throw new Error(`items manifest.revid must be positive integer, got ${manifest.revid}`);
  }
  if (!isNonemptyString(manifest.contentSha256) || !HEX64_RE.test(manifest.contentSha256)) {
    throw new Error('items manifest.contentSha256 must be 64-hex');
  }
  if (!normalized.revision || !isPositiveInt(normalized.revision.revid)) {
    throw new Error('items normalized.revision.revid missing/invalid');
  }
  if (normalized.revision.revid !== manifest.revid) {
    throw new Error(
      `items revision.revid mismatch: normalized=${normalized.revision.revid} manifest=${manifest.revid}`,
    );
  }
  if (!Array.isArray(normalized.items)) {
    throw new Error('items normalized.items must be array');
  }

  // Exact Map construction per frozen contract (matches Wiki-only builder).
  // Upstream dump may reuse placeholder IDs; target wikiItemId uniqueness is
  // fail-closed at resolve time against the source array.
  const byId = new Map(normalized.items.map((item) => [String(item.id), item]));

  return {
    manifestPath: ITEMS_MANIFEST_REL,
    normalizedPath: ITEMS_NORMALIZED_REL,
    manifestLocalFileSha256: sha256Raw(manifestBuf),
    manifestLocalFileByteSize: manifestBuf.length,
    normalizedLocalFileSha256: sha256Raw(normalizedBuf),
    normalizedLocalFileByteSize: normalizedBuf.length,
    canonicalRevisionId: manifest.revid,
    canonicalContentSha256: manifest.contentSha256,
    itemsArray: normalized.items,
    byId,
  };
}

function resolveHeroSidecar(candidate, unifiedRow) {
  const pageId = candidate.pageId;
  if (!isNonemptyString(pageId)) {
    throw new Error(`hero pageId missing @ ${unifiedRow.key}`);
  }
  const sidecarPath = `${HERO_SIDECAR_DIR_REL}/${pageId}.json`;
  const abs = path.join(repoRoot, ...sidecarPath.split('/'));
  if (!fs.existsSync(abs)) {
    throw new Error(`hero sidecar missing: ${sidecarPath}`);
  }
  const buf = fs.readFileSync(abs);
  const sidecar = JSON.parse(buf.toString('utf8'));

  if (sidecar.schemaVersion !== HERO_SIDECAR_SCHEMA) {
    throw new Error(`hero sidecar schemaVersion mismatch @ ${pageId}`);
  }
  if (sidecar.pageId !== pageId) {
    throw new Error(`hero sidecar pageId mismatch @ ${pageId}`);
  }
  if (sidecar.candidateKey !== unifiedRow.key) {
    throw new Error(`hero sidecar candidateKey mismatch @ ${pageId}`);
  }
  if (sidecar.ownerId !== unifiedRow.ownerId) {
    throw new Error(`hero sidecar ownerId mismatch @ ${pageId}`);
  }
  if (sidecar.skillKey !== unifiedRow.skillKey) {
    throw new Error(`hero sidecar skillKey mismatch @ ${pageId}`);
  }
  if (!isNonemptyString(sidecar.requestTitle)) {
    throw new Error(`hero sidecar requestTitle invalid @ ${pageId}`);
  }
  if (!isNonemptyString(sidecar.resolvedTitle)) {
    throw new Error(`hero sidecar resolvedTitle invalid @ ${pageId}`);
  }
  if (!isPositiveInt(sidecar.wikiPageId)) {
    throw new Error(`hero sidecar wikiPageId invalid @ ${pageId}`);
  }
  if (!isPositiveInt(sidecar.revisionId)) {
    throw new Error(`hero sidecar revisionId invalid @ ${pageId}`);
  }
  if (!isNonemptyString(sidecar.revisionTimestamp)) {
    throw new Error(`hero sidecar revisionTimestamp invalid @ ${pageId}`);
  }
  if (!isNonemptyString(sidecar.contentSha256) || !HEX64_RE.test(sidecar.contentSha256)) {
    throw new Error(`hero sidecar contentSha256 invalid @ ${pageId}`);
  }
  if (!isNonNegInt(sidecar.rawByteSize)) {
    throw new Error(`hero sidecar rawByteSize invalid @ ${pageId}`);
  }

  const m = HERO_SOURCE_REF_RE.exec(String(candidate.sourceRef || ''));
  if (!m) {
    throw new Error(`hero sourceRef parse failed @ ${unifiedRow.key}`);
  }
  if (m[1] !== sidecarPath) {
    throw new Error(`hero sourceRef path mismatch @ ${unifiedRow.key}`);
  }
  if (Number(m[2]) !== sidecar.revisionId) {
    throw new Error(`hero sourceRef revisionId mismatch @ ${unifiedRow.key}`);
  }
  if (m[3] !== sidecar.contentSha256) {
    throw new Error(`hero sourceRef contentSha256 mismatch @ ${unifiedRow.key}`);
  }

  const presentNames = presentHeroFieldNames(sidecar);
  return {
    sidecarPath,
    localFileSha256: sha256Raw(buf),
    localFileByteSize: buf.length,
    sidecar,
    presentNames,
  };
}

function buildHeroDraftContract(unifiedRow, candidate) {
  const resolved = resolveHeroSidecar(candidate, unifiedRow);
  const presentNames = resolved.presentNames;
  const presentSet = new Set(presentNames);
  const levelingNames = presentLevelingNames(presentNames);
  const fieldRefs = presentNames.map(heroFieldRef);

  const sourcePointers = {
    kind: 'hero_wiki_sidecar',
    authority: 'league_wiki_current_champion_template',
    sidecarPath: resolved.sidecarPath,
    localFileSha256: resolved.localFileSha256,
    localFileByteSize: resolved.localFileByteSize,
    canonical: {
      requestTitle: resolved.sidecar.requestTitle,
      resolvedTitle: resolved.sidecar.resolvedTitle,
      wikiPageId: resolved.sidecar.wikiPageId,
      revisionId: resolved.sidecar.revisionId,
      revisionTimestamp: resolved.sidecar.revisionTimestamp,
      contentSha256: resolved.sidecar.contentSha256,
      rawByteSize: resolved.sidecar.rawByteSize,
    },
    fieldRefs,
  };

  const basisTags = deepClone(unifiedRow.mechanismTags);
  const phaseATemplate = {
    id: phaseATemplateId(unifiedRow.status, unifiedRow.sourceKind),
    basisStatus: unifiedRow.status,
    basisTags,
    requiresIndividualDesignReview: true,
  };

  const rankRefs = levelingNames.map(heroFieldRef);
  const rank = {
    selection: 'max_rank_candidate',
    value: null,
    sourceFieldRefs: rankRefs,
    verification: VERIFICATION_PENDING,
  };

  const resourceNames = [];
  if (presentSet.has('cost')) resourceNames.push('cost');
  if (presentSet.has('costtype')) resourceNames.push('costtype');
  const resourceRefs = resourceNames.map(heroFieldRef);
  const resourceCost = {
    state: resourceNames.length > 0 ? 'source_fields_present' : 'source_fields_absent',
    sourceFieldRefs: resourceRefs,
    wikiMarkupSnapshots: resourceNames.map((n) =>
      makeSnapshot(heroFieldRef(n), resolved.sidecar.fields[n]),
    ),
    normalizedValue: null,
    normalizedUnit: null,
    verification: VERIFICATION_PENDING,
  };

  const cooldownPresent = presentSet.has('cooldown');
  const cooldownRefs = cooldownPresent ? [heroFieldRef('cooldown')] : [];
  const cooldownMs = {
    state: cooldownPresent ? 'source_fields_present' : 'source_fields_absent',
    sourceFieldRefs: cooldownRefs,
    wikiMarkupSnapshots: cooldownPresent
      ? [makeSnapshot(heroFieldRef('cooldown'), resolved.sidecar.fields.cooldown)]
      : [],
    normalizedValueMs: null,
    verification: VERIFICATION_PENDING,
  };

  const target = {
    mode: 'selected_primary_candidate',
    value: null,
    verification: VERIFICATION_PENDING,
  };

  const timing = {
    mode: 'minimum_quantum_timing_candidate',
    valueMs: null,
    verification: VERIFICATION_PENDING,
  };

  const formulaNames = [...levelingNames];
  if (presentSet.has('damagetype')) formulaNames.push('damagetype');
  const formula = {
    mode: 'wiki_formula_fields_unparsed',
    sourceFieldRefs: formulaNames.map(heroFieldRef),
    wikiMarkupSnapshots: formulaNames.map((n) =>
      makeSnapshot(heroFieldRef(n), resolved.sidecar.fields[n]),
    ),
    expression: null,
    verification: VERIFICATION_PENDING,
  };

  const operationGraph = {
    templateKind: 'provider_ability_single_quantum_candidate',
    nodes: [
      'provider_candidate',
      'ability_candidate',
      'phase_candidate',
      'sequence_candidate',
      'operation_candidate',
    ],
    edges: [
      'provider_to_ability',
      'ability_to_phase',
      'phase_to_sequence',
      'sequence_to_operation',
    ],
    concreteIds: null,
    concreteTypeIds: null,
    requiredEvents: [],
    requiredState: [],
    productionRuntimeChangeRequired: null,
    verification: VERIFICATION_PENDING,
  };

  const fixtures = [
    {
      id: 'baseline_quantum',
      purpose: 'exercise_minimum_candidate_quantum',
      inputs: null,
      expected: null,
      verification: VERIFICATION_PENDING,
    },
    {
      id: 'boundary_or_counterproof',
      purpose: 'exercise_boundary_or_unrelated_input_counterproof',
      inputs: null,
      expected: null,
      verification: VERIFICATION_PENDING,
    },
  ];

  return {
    draftState: DRAFT_STATE,
    sourcePointers,
    phaseATemplate,
    rank,
    resourceCost,
    cooldownMs,
    target,
    timing,
    formula,
    operationGraph,
    fixtures,
    completedBoundary: null,
    exclusions: buildExclusions(unifiedRow.status, basisTags),
  };
}

function buildItemDraftContract(unifiedRow, candidate, itemSources) {
  const itemId = candidate.wikiItemId;
  if (!isNonemptyString(itemId)) {
    throw new Error(`item wikiItemId missing @ ${unifiedRow.key}`);
  }
  if (!Array.isArray(candidate.wikiEffectSlots) || candidate.wikiEffectSlots.length === 0) {
    throw new Error(`item wikiEffectSlots empty @ ${unifiedRow.key}`);
  }
  const idKey = String(itemId);
  const idHits = itemSources.itemsArray.filter((it) => String(it.id) === idKey);
  if (idHits.length === 0) {
    throw new Error(`item id not found in normalized map: ${itemId}`);
  }
  if (idHits.length !== 1) {
    throw new Error(`duplicate item id for target wikiItemId: ${itemId}`);
  }
  const item = itemSources.byId.get(idKey);
  if (!item || item !== idHits[0]) {
    throw new Error(`item map resolve inconsistency @ ${itemId}`);
  }
  if (!item.effects || typeof item.effects !== 'object' || Array.isArray(item.effects)) {
    throw new Error(`item.effects missing @ ${itemId}`);
  }

  const effectSlotRefs = [];
  const formulaSnapshots = [];
  for (const slot of candidate.wikiEffectSlots) {
    if (!isNonemptyString(slot)) {
      throw new Error(`item effect slot invalid @ ${unifiedRow.key}`);
    }
    if (!Object.prototype.hasOwnProperty.call(item.effects, slot)) {
      throw new Error(`item effect slot absent: ${itemId}.${slot}`);
    }
    const effectObject = item.effects[slot];
    const ref = itemEffectRef(itemId, slot);
    effectSlotRefs.push(ref);
    formulaSnapshots.push(makeSnapshot(ref, JSON.stringify(effectObject)));
  }

  const sourcePointers = {
    kind: 'item_wiki_current_items',
    authority: 'league_wiki_current_items',
    manifestPath: itemSources.manifestPath,
    manifestLocalFileSha256: itemSources.manifestLocalFileSha256,
    manifestLocalFileByteSize: itemSources.manifestLocalFileByteSize,
    normalizedPath: itemSources.normalizedPath,
    normalizedLocalFileSha256: itemSources.normalizedLocalFileSha256,
    normalizedLocalFileByteSize: itemSources.normalizedLocalFileByteSize,
    canonicalRevisionId: itemSources.canonicalRevisionId,
    canonicalContentSha256: itemSources.canonicalContentSha256,
    localEqualsCanonicalClaim: false,
    itemId: String(itemId),
    effectSlotRefs,
  };

  const basisTags = deepClone(unifiedRow.mechanismTags);
  const phaseATemplate = {
    id: phaseATemplateId(unifiedRow.status, unifiedRow.sourceKind),
    basisStatus: unifiedRow.status,
    basisTags,
    requiresIndividualDesignReview: true,
  };

  return {
    draftState: DRAFT_STATE,
    sourcePointers,
    phaseATemplate,
    rank: {
      selection: 'not_applicable',
      value: null,
      sourceFieldRefs: [],
      verification: VERIFICATION_PENDING,
    },
    resourceCost: {
      state: 'not_applicable',
      sourceFieldRefs: [],
      wikiMarkupSnapshots: [],
      normalizedValue: null,
      normalizedUnit: null,
      verification: VERIFICATION_PENDING,
    },
    cooldownMs: {
      state: 'not_applicable',
      sourceFieldRefs: [],
      wikiMarkupSnapshots: [],
      normalizedValueMs: null,
      verification: VERIFICATION_PENDING,
    },
    target: {
      mode: 'source_owner_or_selected_target_candidate',
      value: null,
      verification: VERIFICATION_PENDING,
    },
    timing: {
      mode: 'minimum_quantum_timing_candidate',
      valueMs: null,
      verification: VERIFICATION_PENDING,
    },
    formula: {
      mode: 'wiki_effect_slots_unparsed',
      sourceFieldRefs: [...effectSlotRefs],
      wikiMarkupSnapshots: formulaSnapshots,
      expression: null,
      verification: VERIFICATION_PENDING,
    },
    operationGraph: {
      templateKind: 'provider_trigger_or_state_candidate',
      nodes: ['provider_candidate', 'trigger_or_state_candidate', 'operation_candidate'],
      edges: ['provider_to_trigger_or_state', 'trigger_or_state_to_operation'],
      concreteIds: null,
      concreteTypeIds: null,
      requiredEvents: [],
      requiredState: [],
      productionRuntimeChangeRequired: null,
      verification: VERIFICATION_PENDING,
    },
    fixtures: [
      {
        id: 'baseline_quantum',
        purpose: 'exercise_minimum_candidate_quantum',
        inputs: null,
        expected: null,
        verification: VERIFICATION_PENDING,
      },
      {
        id: 'boundary_or_counterproof',
        purpose: 'exercise_boundary_or_unrelated_input_counterproof',
        inputs: null,
        expected: null,
        verification: VERIFICATION_PENDING,
      },
    ],
    completedBoundary: null,
    exclusions: buildExclusions(unifiedRow.status, basisTags),
  };
}

function makeDraftContract(unifiedRow, candidate, itemSources) {
  if (unifiedRow.sourceKind === 'hero_skill') {
    return buildHeroDraftContract(unifiedRow, candidate);
  }
  if (unifiedRow.sourceKind === 'item_passive') {
    return buildItemDraftContract(unifiedRow, candidate, itemSources);
  }
  throw new Error(`unsupported sourceKind for draft: ${unifiedRow.sourceKind}`);
}

function buildWikiProvenance(candidate, sourceKind) {
  if (sourceKind === 'hero_skill') {
    const pageId = candidate.pageId;
    if (typeof pageId !== 'string' || pageId.length === 0) {
      throw new Error(`hero provenance pageId must be nonempty @ ${candidate.candidateKey}`);
    }
    if (typeof candidate.ownerName !== 'string' || candidate.ownerName.length === 0) {
      throw new Error(`hero provenance ownerName missing @ ${candidate.candidateKey}`);
    }
    if (typeof candidate.sourceRef !== 'string' || candidate.sourceRef.length === 0) {
      throw new Error(`hero provenance sourceRef missing @ ${candidate.candidateKey}`);
    }
    return {
      ownerName: candidate.ownerName,
      pageId,
      wikiItemId: null,
      wikiEffectSlots: [],
      sourceRef: candidate.sourceRef,
    };
  }
  if (sourceKind === 'item_passive') {
    const wikiItemId = candidate.wikiItemId;
    if (typeof wikiItemId !== 'string' || wikiItemId.length === 0) {
      throw new Error(`item provenance wikiItemId must be nonempty @ ${candidate.candidateKey}`);
    }
    if (!Array.isArray(candidate.wikiEffectSlots)) {
      throw new Error(`item provenance wikiEffectSlots must be array @ ${candidate.candidateKey}`);
    }
    if (typeof candidate.ownerName !== 'string' || candidate.ownerName.length === 0) {
      throw new Error(`item provenance ownerName missing @ ${candidate.candidateKey}`);
    }
    if (typeof candidate.sourceRef !== 'string' || candidate.sourceRef.length === 0) {
      throw new Error(`item provenance sourceRef missing @ ${candidate.candidateKey}`);
    }
    const rawPageId = candidate.pageId;
    const pageId =
      rawPageId == null || rawPageId === ''
        ? null
        : typeof rawPageId === 'string'
          ? rawPageId
          : (() => {
              throw new Error(`item provenance pageId invalid @ ${candidate.candidateKey}`);
            })();
    return {
      ownerName: candidate.ownerName,
      pageId,
      wikiItemId,
      wikiEffectSlots: deepClone(candidate.wikiEffectSlots),
      sourceRef: candidate.sourceRef,
    };
  }
  throw new Error(`unsupported sourceKind for provenance: ${sourceKind}`);
}

function readDynamicInput(absPath, relPath) {
  const buf = fs.readFileSync(absPath);
  const sha = sha256Raw(buf);
  return { buf, sha, byteSize: buf.length, doc: JSON.parse(buf.toString('utf8')) };
}

function assertStableKeyOrders(unified, wiki) {
  if (!Array.isArray(unified.mechanisms) || unified.mechanisms.length !== STABLE_UNIFIED_MECHANISM_COUNT) {
    throw new Error(
      `unified mechanisms length ${unified.mechanisms?.length}, expected ${STABLE_UNIFIED_MECHANISM_COUNT}`,
    );
  }
  if (!Array.isArray(wiki.candidates) || wiki.candidates.length !== STABLE_WIKI_CANDIDATE_COUNT) {
    throw new Error(
      `wiki candidates length ${wiki.candidates?.length}, expected ${STABLE_WIKI_CANDIDATE_COUNT}`,
    );
  }
  const unifiedDigest = keyOrderDigest(unified.mechanisms.map((m) => m.key));
  if (unifiedDigest !== STABLE_UNIFIED_KEY_ORDER_SHA256) {
    throw new Error(
      `unified key-order digest drift: got ${unifiedDigest}, expected ${STABLE_UNIFIED_KEY_ORDER_SHA256}`,
    );
  }
  const wikiDigest = keyOrderDigest(wiki.candidates.map((c) => c.candidateKey));
  if (wikiDigest !== STABLE_WIKI_KEY_ORDER_SHA256) {
    throw new Error(
      `wiki key-order digest drift: got ${wikiDigest}, expected ${STABLE_WIKI_KEY_ORDER_SHA256}`,
    );
  }
  return {
    unifiedMechanismCount: STABLE_UNIFIED_MECHANISM_COUNT,
    unifiedKeyOrderSha256: STABLE_UNIFIED_KEY_ORDER_SHA256,
    wikiCandidateCount: STABLE_WIKI_CANDIDATE_COUNT,
    wikiKeyOrderSha256: STABLE_WIKI_KEY_ORDER_SHA256,
  };
}

function partitionUnifiedMechanisms(mechanisms) {
  const targetStatusCounts = emptyOrderedCounts(TARGET_STATUS_COUNT_KEYS);
  const excludedStatusCounts = emptyOrderedCounts(EXCLUDED_STATUS_COUNT_KEYS);
  const filtered = [];

  for (const m of mechanisms) {
    if (!ALLOWED_UNIFIED_STATUS_SET.has(m.status)) {
      throw new Error(`unknown Unified status: ${m.status}`);
    }
    if (TARGET_STATUS_SET.has(m.status)) {
      targetStatusCounts[m.status] += 1;
      filtered.push(m);
      continue;
    }
    if (EXCLUDED_STATUS_SET.has(m.status)) {
      excludedStatusCounts[m.status] += 1;
      continue;
    }
    throw new Error(`status not in exhaustive partition: ${m.status}`);
  }

  const targetTotal = TARGET_STATUS_COUNT_KEYS.reduce((n, k) => n + targetStatusCounts[k], 0);
  const excludedTotal = EXCLUDED_STATUS_COUNT_KEYS.reduce((n, k) => n + excludedStatusCounts[k], 0);
  if (targetTotal + excludedTotal !== STABLE_UNIFIED_MECHANISM_COUNT) {
    throw new Error(
      `exhaustive partition sum ${targetTotal + excludedTotal} !== ${STABLE_UNIFIED_MECHANISM_COUNT}`,
    );
  }
  if (filtered.length !== targetTotal) {
    throw new Error(`filtered length ${filtered.length} !== targetTotal ${targetTotal}`);
  }
  if (mechanisms.length !== targetTotal + excludedTotal) {
    throw new Error('mechanisms length does not match exhaustive partition');
  }

  return { filtered, targetStatusCounts, excludedStatusCounts };
}

function validateDraftContractShape(draft, label, errors) {
  assertKeysOrderSafe(draft, DRAFT_CONTRACT_KEYS, label, errors);
  if (draft.draftState !== DRAFT_STATE) {
    errors.push(`${label}.draftState must be ${DRAFT_STATE}`);
  }
  if (draft.completedBoundary != null) {
    errors.push(`${label}.completedBoundary must be null`);
  }

  assertKeysOrderSafe(draft.phaseATemplate, PHASE_A_TEMPLATE_KEYS, `${label}.phaseATemplate`, errors);
  if (draft.phaseATemplate.requiresIndividualDesignReview !== true) {
    errors.push(`${label}.phaseATemplate.requiresIndividualDesignReview must be true`);
  }

  assertKeysOrderSafe(draft.rank, RANK_KEYS, `${label}.rank`, errors);
  assertKeysOrderSafe(draft.resourceCost, RESOURCE_COST_KEYS, `${label}.resourceCost`, errors);
  assertKeysOrderSafe(draft.cooldownMs, COOLDOWN_MS_KEYS, `${label}.cooldownMs`, errors);
  assertKeysOrderSafe(draft.target, TARGET_KEYS, `${label}.target`, errors);
  assertKeysOrderSafe(draft.timing, TIMING_KEYS, `${label}.timing`, errors);
  assertKeysOrderSafe(draft.formula, FORMULA_KEYS, `${label}.formula`, errors);
  assertKeysOrderSafe(draft.operationGraph, OPERATION_GRAPH_KEYS, `${label}.operationGraph`, errors);

  if (!Array.isArray(draft.fixtures) || draft.fixtures.length !== 2) {
    errors.push(`${label}.fixtures must be length-2 array`);
  } else {
    for (let i = 0; i < draft.fixtures.length; i++) {
      assertKeysOrderSafe(draft.fixtures[i], FIXTURE_KEYS, `${label}.fixtures[${i}]`, errors);
    }
    if (
      draft.fixtures[0].id !== 'baseline_quantum' ||
      draft.fixtures[0].purpose !== 'exercise_minimum_candidate_quantum' ||
      draft.fixtures[0].inputs != null ||
      draft.fixtures[0].expected != null ||
      draft.fixtures[0].verification !== VERIFICATION_PENDING
    ) {
      errors.push(`${label}.fixtures[0] mismatch`);
    }
    if (
      draft.fixtures[1].id !== 'boundary_or_counterproof' ||
      draft.fixtures[1].purpose !== 'exercise_boundary_or_unrelated_input_counterproof' ||
      draft.fixtures[1].inputs != null ||
      draft.fixtures[1].expected != null ||
      draft.fixtures[1].verification !== VERIFICATION_PENDING
    ) {
      errors.push(`${label}.fixtures[1] mismatch`);
    }
  }

  if (!Array.isArray(draft.exclusions)) {
    errors.push(`${label}.exclusions must be array`);
  } else {
    for (let i = 0; i < draft.exclusions.length; i++) {
      const ex = draft.exclusions[i];
      assertKeysOrderSafe(ex, EXCLUSION_KEYS, `${label}.exclusions[${i}]`, errors);
      if (ex.kind !== 'candidate_exclusion') {
        errors.push(`${label}.exclusions[${i}].kind must be candidate_exclusion`);
      }
      if (EXCLUSION_PROMPT_BY_ID[ex.id] !== ex.prompt) {
        errors.push(`${label}.exclusions[${i}] prompt/id mismatch`);
      }
      if (FORBIDDEN_PROMPT_WORD_RE.test(String(ex.prompt || ''))) {
        errors.push(`${label}.exclusions[${i}] prompt forbidden wording`);
      }
    }
  }

  const snapshotArrays = [
    draft.resourceCost?.wikiMarkupSnapshots,
    draft.cooldownMs?.wikiMarkupSnapshots,
    draft.formula?.wikiMarkupSnapshots,
  ];
  for (const arr of snapshotArrays) {
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      assertKeysOrderSafe(arr[i], SNAPSHOT_KEYS, `${label}.snapshot[${i}]`, errors);
      if (arr[i].parsedNumericValue != null || arr[i].claim !== SNAPSHOT_CLAIM) {
        errors.push(`${label}.snapshot[${i}] claim/numeric mismatch`);
      }
      if (typeof arr[i].raw !== 'string') {
        errors.push(`${label}.snapshot[${i}].raw must be string`);
      }
    }
  }
}

function validateSourcePointersShape(draft, sourceKind, label, errors) {
  if (sourceKind === 'hero_skill') {
    assertKeysOrderSafe(draft.sourcePointers, HERO_SOURCE_POINTER_KEYS, `${label}.sourcePointers`, errors);
    assertKeysOrderSafe(
      draft.sourcePointers.canonical,
      HERO_CANONICAL_KEYS,
      `${label}.sourcePointers.canonical`,
      errors,
    );
    if (draft.sourcePointers.kind !== 'hero_wiki_sidecar') {
      errors.push(`${label}.sourcePointers.kind mismatch`);
    }
    if (draft.sourcePointers.authority !== 'league_wiki_current_champion_template') {
      errors.push(`${label}.sourcePointers.authority mismatch`);
    }
  } else if (sourceKind === 'item_passive') {
    assertKeysOrderSafe(draft.sourcePointers, ITEM_SOURCE_POINTER_KEYS, `${label}.sourcePointers`, errors);
    if (draft.sourcePointers.kind !== 'item_wiki_current_items') {
      errors.push(`${label}.sourcePointers.kind mismatch`);
    }
    if (draft.sourcePointers.authority !== 'league_wiki_current_items') {
      errors.push(`${label}.sourcePointers.authority mismatch`);
    }
    if (draft.sourcePointers.localEqualsCanonicalClaim !== false) {
      errors.push(`${label}.sourcePointers.localEqualsCanonicalClaim must be false`);
    }
  }
}

function buildRegistry(generatedAt) {
  assertExclusionPromptsFrozen();
  const unifiedPin = readDynamicInput(paths.unified, UNIFIED_REL);
  const wikiPin = readDynamicInput(paths.wiki, WIKI_REL);
  const itemSources = loadItemDraftSources();

  const unified = unifiedPin.doc;
  const wiki = wikiPin.doc;
  const stableKeyOrders = assertStableKeyOrders(unified, wiki);
  const { filtered, targetStatusCounts, excludedStatusCounts } = partitionUnifiedMechanisms(
    unified.mechanisms,
  );

  const targetSourceKindCounts = emptyOrderedCounts(TARGET_SOURCE_KIND_COUNT_KEYS);
  for (const m of filtered) {
    if (!Object.prototype.hasOwnProperty.call(targetSourceKindCounts, m.sourceKind)) {
      throw new Error(`unexpected sourceKind: ${m.sourceKind}`);
    }
    targetSourceKindCounts[m.sourceKind] += 1;
  }

  const wikiByKey = new Map();
  for (const c of wiki.candidates) {
    if (wikiByKey.has(c.candidateKey)) {
      throw new Error(`duplicate wiki candidateKey: ${c.candidateKey}`);
    }
    wikiByKey.set(c.candidateKey, c);
  }

  const templates = [];
  const seenKeys = new Set();
  const seenOrdinals = new Set();

  for (const row of filtered) {
    if (seenKeys.has(row.key)) {
      throw new Error(`duplicate unified target key: ${row.key}`);
    }
    seenKeys.add(row.key);

    const candidate = wikiByKey.get(row.key);
    if (!candidate) {
      throw new Error(`wiki registry missing candidateKey === ${row.key}`);
    }
    if (candidate.sourceKind !== row.sourceKind) {
      throw new Error(`sourceKind mismatch @ ${row.key}`);
    }
    if (typeof candidate.inventoryOrdinal !== 'number' || !Number.isInteger(candidate.inventoryOrdinal)) {
      throw new Error(`inventoryOrdinal not integer @ ${row.key}`);
    }
    if (seenOrdinals.has(candidate.inventoryOrdinal)) {
      throw new Error(`nonunique inventoryOrdinal ${candidate.inventoryOrdinal} @ ${row.key}`);
    }
    seenOrdinals.add(candidate.inventoryOrdinal);

    for (const field of [
      'key',
      'sourceKind',
      'ownerId',
      'skillKey',
      'passiveName',
      'status',
      'completionMode',
      'lane',
      'blocker',
      'mechanismTags',
      'sourceRefs',
    ]) {
      if (!(field in row)) {
        throw new Error(`unified missing authority field ${field} @ ${row.key}`);
      }
    }
    if (!Array.isArray(row.mechanismTags)) {
      throw new Error(`mechanismTags not array @ ${row.key}`);
    }
    if (!Array.isArray(row.sourceRefs)) {
      throw new Error(`sourceRefs not array @ ${row.key}`);
    }
    if ('sourceText' in row) {
      throw new Error(`unified sourceText must not be copied @ ${row.key}`);
    }

    const wikiProvenance = buildWikiProvenance(candidate, row.sourceKind);
    if ('sourceText' in wikiProvenance) {
      throw new Error(`wikiProvenance must not include sourceText @ ${row.key}`);
    }
    const templateKind = templateKindForStatus(row.status);
    const draftContract = makeDraftContract(row, candidate, itemSources);

    const template = {
      key: row.key,
      inventoryOrdinal: candidate.inventoryOrdinal,
      sourceKind: row.sourceKind,
      ownerId: row.ownerId,
      skillKey: row.skillKey,
      passiveName: row.passiveName,
      currentStatus: row.status,
      currentCompletionMode: row.completionMode,
      lane: row.lane,
      blocker: row.blocker,
      mechanismTags: deepClone(row.mechanismTags),
      unifiedSourceRefs: deepClone(row.sourceRefs),
      wikiProvenance,
      templateState: TEMPLATE_STATE,
      templateKind,
      draftContract,
      verificationGates: makeVerificationGates(),
      nonclaims: makeNonclaims(),
    };

    if (!deepEqual(template.mechanismTags, row.mechanismTags)) {
      throw new Error(`mechanismTags deep inequality @ ${row.key}`);
    }
    if (!deepEqual(template.unifiedSourceRefs, row.sourceRefs)) {
      throw new Error(`unifiedSourceRefs deep inequality @ ${row.key}`);
    }
    if (row.sourceKind === 'item_passive') {
      if (!deepEqual(template.wikiProvenance.wikiEffectSlots, candidate.wikiEffectSlots)) {
        throw new Error(`wikiEffectSlots deep inequality @ ${row.key}`);
      }
    }

    templates.push(template);
  }

  const filteredKeySet = new Set(filtered.map((m) => m.key));
  const templateKeySet = new Set(templates.map((t) => t.key));
  if (filteredKeySet.size !== templateKeySet.size) {
    throw new Error('target key set size mismatch');
  }
  for (const k of filteredKeySet) {
    if (!templateKeySet.has(k)) throw new Error(`template missing key ${k}`);
  }
  for (let i = 0; i < filtered.length; i++) {
    if (templates[i].key !== filtered[i].key) {
      throw new Error(`filtered Unified order violated at index ${i}`);
    }
  }

  const templateKindCounts = emptyOrderedCounts(TEMPLATE_KIND_COUNT_KEYS);
  for (const t of templates) {
    templateKindCounts[t.templateKind] += 1;
  }

  const doc = {
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      planRevision: FROZEN_PLAN_REV,
      generatedAt,
      stableKeyOrders,
      inputs: [
        {
          path: UNIFIED_REL,
          sha256: unifiedPin.sha,
          byteSize: unifiedPin.byteSize,
        },
        {
          path: WIKI_REL,
          sha256: wikiPin.sha,
          byteSize: wikiPin.byteSize,
        },
      ],
    },
    summary: {
      sourceUnifiedMechanismCount: STABLE_UNIFIED_MECHANISM_COUNT,
      sourceWikiRegistryCount: STABLE_WIKI_CANDIDATE_COUNT,
      templateCount: templates.length,
      targetStatusCounts,
      targetSourceKindCounts,
      templateKindCounts,
      excludedStatusCounts,
    },
    templates,
  };

  assertKeysOrder(doc.metadata, METADATA_KEYS, 'metadata');
  assertKeysOrder(doc.metadata.stableKeyOrders, STABLE_KEY_ORDERS_KEYS, 'stableKeyOrders');
  assertKeysOrder(doc.summary, SUMMARY_KEYS, 'summary');
  assertKeysOrder(doc.summary.targetStatusCounts, TARGET_STATUS_COUNT_KEYS, 'targetStatusCounts');
  assertKeysOrder(
    doc.summary.targetSourceKindCounts,
    TARGET_SOURCE_KIND_COUNT_KEYS,
    'targetSourceKindCounts',
  );
  assertKeysOrder(doc.summary.templateKindCounts, TEMPLATE_KIND_COUNT_KEYS, 'templateKindCounts');
  assertKeysOrder(
    doc.summary.excludedStatusCounts,
    EXCLUDED_STATUS_COUNT_KEYS,
    'excludedStatusCounts',
  );

  const errors = validateRegistry(doc, filtered, wikiByKey, {
    unifiedSha: unifiedPin.sha,
    unifiedBytes: unifiedPin.byteSize,
    wikiSha: wikiPin.sha,
    wikiBytes: wikiPin.byteSize,
  }, itemSources);
  if (errors.length) {
    throw new Error(`registry validation failed (${errors.length}):\n${errors.slice(0, 40).join('\n')}`);
  }

  const csvText = toCsv(templates);
  return { doc, csvText };
}

function validateRegistry(doc, filteredUnifiedRows, wikiByKey, inputPins, itemSources) {
  const errors = [];
  assertExclusionPromptsFrozen();

  assertKeysOrderSafe(doc, TOP_LEVEL_KEYS, 'top-level', errors);
  if (!doc.metadata) {
    errors.push('missing metadata');
    return errors;
  }
  assertKeysOrderSafe(doc.metadata, METADATA_KEYS, 'metadata', errors);
  if (doc.metadata.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (doc.metadata.planRevision !== FROZEN_PLAN_REV) {
    errors.push(`planRevision must be ${FROZEN_PLAN_REV}`);
  }
  if (typeof doc.metadata.generatedAt !== 'string' || !doc.metadata.generatedAt) {
    errors.push('metadata.generatedAt must be nonempty string');
  }

  if (!doc.metadata.stableKeyOrders) {
    errors.push('missing metadata.stableKeyOrders');
  } else {
    assertKeysOrderSafe(
      doc.metadata.stableKeyOrders,
      STABLE_KEY_ORDERS_KEYS,
      'metadata.stableKeyOrders',
      errors,
    );
    if (doc.metadata.stableKeyOrders.unifiedMechanismCount !== STABLE_UNIFIED_MECHANISM_COUNT) {
      errors.push('stableKeyOrders.unifiedMechanismCount mismatch');
    }
    if (doc.metadata.stableKeyOrders.unifiedKeyOrderSha256 !== STABLE_UNIFIED_KEY_ORDER_SHA256) {
      errors.push('stableKeyOrders.unifiedKeyOrderSha256 mismatch');
    }
    if (doc.metadata.stableKeyOrders.wikiCandidateCount !== STABLE_WIKI_CANDIDATE_COUNT) {
      errors.push('stableKeyOrders.wikiCandidateCount mismatch');
    }
    if (doc.metadata.stableKeyOrders.wikiKeyOrderSha256 !== STABLE_WIKI_KEY_ORDER_SHA256) {
      errors.push('stableKeyOrders.wikiKeyOrderSha256 mismatch');
    }
  }

  if (!Array.isArray(doc.metadata.inputs) || doc.metadata.inputs.length !== 2) {
    errors.push('metadata.inputs must be length-2 array');
  } else {
    const [u, w] = doc.metadata.inputs;
    assertKeysOrderSafe(u, INPUT_ENTRY_KEYS, 'metadata.inputs[0]', errors);
    assertKeysOrderSafe(w, INPUT_ENTRY_KEYS, 'metadata.inputs[1]', errors);
    if (u.path !== UNIFIED_REL || u.sha256 !== inputPins.unifiedSha || u.byteSize !== inputPins.unifiedBytes) {
      errors.push('metadata.inputs[0] dynamic provenance mismatch');
    }
    if (w.path !== WIKI_REL || w.sha256 !== inputPins.wikiSha || w.byteSize !== inputPins.wikiBytes) {
      errors.push('metadata.inputs[1] dynamic provenance mismatch');
    }
  }

  assertKeysOrderSafe(doc.summary, SUMMARY_KEYS, 'summary', errors);
  if (doc.summary.sourceUnifiedMechanismCount !== STABLE_UNIFIED_MECHANISM_COUNT) {
    errors.push('summary.sourceUnifiedMechanismCount mismatch');
  }
  if (doc.summary.sourceWikiRegistryCount !== STABLE_WIKI_CANDIDATE_COUNT) {
    errors.push('summary.sourceWikiRegistryCount mismatch');
  }
  if (!Array.isArray(doc.templates)) {
    errors.push('templates must be array');
    return errors;
  }
  if (doc.summary.templateCount !== doc.templates.length) {
    errors.push('summary.templateCount mismatch');
  }
  if (!Array.isArray(filteredUnifiedRows) || filteredUnifiedRows.length !== doc.templates.length) {
    errors.push('filteredUnifiedRows length mismatch');
    return errors;
  }

  const derivedTargetStatusCounts = emptyOrderedCounts(TARGET_STATUS_COUNT_KEYS);
  const derivedSourceKindCounts = emptyOrderedCounts(TARGET_SOURCE_KIND_COUNT_KEYS);
  const derivedTemplateKindCounts = emptyOrderedCounts(TEMPLATE_KIND_COUNT_KEYS);
  for (const t of doc.templates) {
    if (!TARGET_STATUS_SET.has(t.currentStatus)) {
      errors.push(`non-target currentStatus in templates: ${t.currentStatus}`);
    } else {
      derivedTargetStatusCounts[t.currentStatus] += 1;
    }
    if (Object.prototype.hasOwnProperty.call(derivedSourceKindCounts, t.sourceKind)) {
      derivedSourceKindCounts[t.sourceKind] += 1;
    }
    if (Object.prototype.hasOwnProperty.call(derivedTemplateKindCounts, t.templateKind)) {
      derivedTemplateKindCounts[t.templateKind] += 1;
    }
  }

  assertKeysOrderSafe(
    doc.summary.targetStatusCounts,
    TARGET_STATUS_COUNT_KEYS,
    'summary.targetStatusCounts',
    errors,
  );
  assertKeysOrderSafe(
    doc.summary.targetSourceKindCounts,
    TARGET_SOURCE_KIND_COUNT_KEYS,
    'summary.targetSourceKindCounts',
    errors,
  );
  assertKeysOrderSafe(
    doc.summary.templateKindCounts,
    TEMPLATE_KIND_COUNT_KEYS,
    'summary.templateKindCounts',
    errors,
  );
  assertKeysOrderSafe(
    doc.summary.excludedStatusCounts,
    EXCLUDED_STATUS_COUNT_KEYS,
    'summary.excludedStatusCounts',
    errors,
  );

  if (!deepEqual(doc.summary.targetStatusCounts, derivedTargetStatusCounts)) {
    errors.push('summary.targetStatusCounts not derived from templates');
  }
  if (!deepEqual(doc.summary.targetSourceKindCounts, derivedSourceKindCounts)) {
    errors.push('summary.targetSourceKindCounts not derived from templates');
  }
  if (!deepEqual(doc.summary.templateKindCounts, derivedTemplateKindCounts)) {
    errors.push('summary.templateKindCounts not derived from templates');
  }

  const excludedTotal = EXCLUDED_STATUS_COUNT_KEYS.reduce(
    (n, k) => n + (doc.summary.excludedStatusCounts?.[k] || 0),
    0,
  );
  if (doc.templates.length + excludedTotal !== STABLE_UNIFIED_MECHANISM_COUNT) {
    errors.push('templates + excludedStatusCounts must sum to 254');
  }

  const seenKeys = new Set();
  const seenOrdinals = new Set();
  let itemSourceCtx = itemSources;
  try {
    if (!itemSourceCtx) itemSourceCtx = loadItemDraftSources();
  } catch (e) {
    errors.push(`item draft sources load failed: ${e.message}`);
    return errors;
  }

  for (let i = 0; i < doc.templates.length; i++) {
    const t = doc.templates[i];
    const u = filteredUnifiedRows[i];
    assertKeysOrderSafe(t, TEMPLATE_KEYS, `templates[${i}]`, errors);

    if (Object.prototype.hasOwnProperty.call(t, 'sourceText')) {
      errors.push(`sourceText forbidden on template @ ${t.key}`);
    }

    if (t.key !== u.key) errors.push(`order mismatch at ${i}: ${t.key} vs ${u.key}`);
    if (seenKeys.has(t.key)) errors.push(`duplicate key ${t.key}`);
    seenKeys.add(t.key);

    const candidate = wikiByKey.get(t.key);
    if (!candidate) {
      errors.push(`missing wiki membership @ ${t.key}`);
      continue;
    }
    if (t.inventoryOrdinal !== candidate.inventoryOrdinal) {
      errors.push(`inventoryOrdinal mismatch @ ${t.key}`);
    }
    if (seenOrdinals.has(t.inventoryOrdinal)) {
      errors.push(`nonunique inventoryOrdinal ${t.inventoryOrdinal}`);
    }
    seenOrdinals.add(t.inventoryOrdinal);

    if (t.sourceKind !== u.sourceKind) errors.push(`sourceKind mismatch @ ${t.key}`);
    if (t.ownerId !== u.ownerId) errors.push(`ownerId mismatch @ ${t.key}`);
    if (t.skillKey !== u.skillKey) errors.push(`skillKey mismatch @ ${t.key}`);
    if (t.passiveName !== u.passiveName) errors.push(`passiveName mismatch @ ${t.key}`);
    if (t.currentStatus !== u.status) errors.push(`currentStatus mismatch @ ${t.key}`);
    if (t.currentCompletionMode !== u.completionMode) {
      errors.push(`currentCompletionMode mismatch @ ${t.key}`);
    }
    if (t.lane !== u.lane) errors.push(`lane mismatch @ ${t.key}`);
    if (t.blocker !== u.blocker) errors.push(`blocker mismatch @ ${t.key}`);
    if (!deepEqual(t.mechanismTags, u.mechanismTags)) {
      errors.push(`mechanismTags deep inequality @ ${t.key}`);
    }
    if (!deepEqual(t.unifiedSourceRefs, u.sourceRefs)) {
      errors.push(`unifiedSourceRefs deep inequality @ ${t.key}`);
    }

    if (t.templateState !== TEMPLATE_STATE) {
      errors.push(`templateState must be ${TEMPLATE_STATE} @ ${t.key}`);
    }
    const expectedKind = templateKindForStatus(t.currentStatus);
    if (t.templateKind !== expectedKind) {
      errors.push(`templateKind mismatch @ ${t.key}`);
    }

    validateDraftContractShape(t.draftContract, `draftContract @ ${t.key}`, errors);
    validateSourcePointersShape(t.draftContract, t.sourceKind, `draftContract @ ${t.key}`, errors);

    try {
      const expectedDraft = makeDraftContract(u, candidate, itemSourceCtx);
      if (!deepEqual(t.draftContract, expectedDraft)) {
        errors.push(`draftContract regenerated mismatch @ ${t.key}`);
      }
    } catch (e) {
      errors.push(`draftContract regenerate failed @ ${t.key}: ${e.message}`);
    }

    if (!Array.isArray(t.verificationGates) || t.verificationGates.length !== VERIFICATION_GATE_IDS.length) {
      errors.push(`verificationGates length mismatch @ ${t.key}`);
    } else {
      for (let g = 0; g < t.verificationGates.length; g++) {
        const gate = t.verificationGates[g];
        assertKeysOrderSafe(gate, GATE_KEYS, `verificationGates[${g}] @ ${t.key}`, errors);
        if (gate.id !== VERIFICATION_GATE_IDS[g] || gate.state !== VERIFICATION_PENDING) {
          errors.push(`verificationGates[${g}] mismatch @ ${t.key}`);
        }
      }
    }

    if (!deepEqual(t.nonclaims, NONCLAIMS)) {
      errors.push(`nonclaims mismatch @ ${t.key}`);
    }

    assertKeysOrderSafe(
      t.wikiProvenance,
      t.sourceKind === 'hero_skill' ? HERO_PROVENANCE_KEYS : ITEM_PROVENANCE_KEYS,
      `wikiProvenance @ ${t.key}`,
      errors,
    );
    if (Object.prototype.hasOwnProperty.call(t.wikiProvenance, 'sourceText')) {
      errors.push(`wikiProvenance.sourceText forbidden @ ${t.key}`);
    }
    const expectedProv = buildWikiProvenance(candidate, t.sourceKind);
    if (!deepEqual(t.wikiProvenance, expectedProv)) {
      errors.push(`wikiProvenance deep inequality @ ${t.key}`);
    }

    if (t.templateState !== TEMPLATE_STATE) {
      errors.push(`non-provisional templateState @ ${t.key}`);
    }
    if (
      t.currentStatus === 'completed' ||
      t.templateKind === 'completed' ||
      t.draftContract.completedBoundary != null ||
      t.draftContract.draftState !== DRAFT_STATE
    ) {
      errors.push(`completed/full/verified claim detected @ ${t.key}`);
    }
  }

  return errors;
}

function assertKeysOrderSafe(obj, expectedKeys, label, errors) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    errors.push(`${label} must be object`);
    return;
  }
  const keys = Object.keys(obj);
  if (keys.length !== expectedKeys.length || !keys.every((k, i) => k === expectedKeys[i])) {
    errors.push(
      `${label} key order mismatch: got [${keys.join(',')}] expected [${expectedKeys.join(',')}]`,
    );
  }
}

function nullToEmptyCell(value) {
  return value == null ? '' : String(value);
}

function templateToCsvRow(t) {
  return {
    key: t.key,
    inventoryOrdinal: t.inventoryOrdinal,
    sourceKind: t.sourceKind,
    ownerId: t.ownerId,
    skillKey: t.skillKey,
    passiveName: t.passiveName,
    currentStatus: t.currentStatus,
    currentCompletionMode: t.currentCompletionMode,
    lane: t.lane,
    blocker: t.blocker,
    mechanismTagsJson: compactJson(t.mechanismTags),
    unifiedSourceRefsJson: compactJson(t.unifiedSourceRefs),
    wikiOwnerName: t.wikiProvenance.ownerName,
    wikiPageId: nullToEmptyCell(t.wikiProvenance.pageId),
    wikiItemId: nullToEmptyCell(t.wikiProvenance.wikiItemId),
    wikiEffectSlotsJson: compactJson(t.wikiProvenance.wikiEffectSlots),
    wikiSourceRef: t.wikiProvenance.sourceRef,
    templateState: t.templateState,
    templateKind: t.templateKind,
    draftContractJson: compactJson(t.draftContract),
    verificationGatesJson: compactJson(t.verificationGates),
    nonclaimsJson: compactJson(t.nonclaims),
  };
}

function toCsv(templates) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const t of templates) {
    const row = templateToCsvRow(t);
    lines.push(CSV_COLUMNS.map((c) => csvEscape(row[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function stripGeneratedAt(value) {
  if (Array.isArray(value)) return value.map(stripGeneratedAt);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'generatedAt') continue;
      out[k] = stripGeneratedAt(v);
    }
    return out;
  }
  return value;
}

function writeOutputs(doc, csvText) {
  fs.writeFileSync(paths.outputJson, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  fs.writeFileSync(paths.outputCsv, csvText, 'utf8');
}

function loadFilteredAndWikiMap() {
  const unifiedPin = readDynamicInput(paths.unified, UNIFIED_REL);
  const wikiPin = readDynamicInput(paths.wiki, WIKI_REL);
  assertStableKeyOrders(unifiedPin.doc, wikiPin.doc);
  const { filtered } = partitionUnifiedMechanisms(unifiedPin.doc.mechanisms);
  const wikiByKey = new Map(wikiPin.doc.candidates.map((c) => [c.candidateKey, c]));
  return {
    filtered,
    wikiByKey,
    inputPins: {
      unifiedSha: unifiedPin.sha,
      unifiedBytes: unifiedPin.byteSize,
      wikiSha: wikiPin.sha,
      wikiBytes: wikiPin.byteSize,
    },
  };
}

function runCheck() {
  if (!fs.existsSync(paths.outputJson) || !fs.existsSync(paths.outputCsv)) {
    console.error('--check failed: missing output json/csv');
    process.exit(1);
  }
  const existing = JSON.parse(fs.readFileSync(paths.outputJson, 'utf8'));
  const existingCsv = fs.readFileSync(paths.outputCsv, 'utf8');
  const { doc, csvText } = buildRegistry(existing.metadata?.generatedAt || new Date().toISOString());

  const { filtered, wikiByKey, inputPins } = loadFilteredAndWikiMap();
  const itemSources = loadItemDraftSources();
  const existingErrors = validateRegistry(existing, filtered, wikiByKey, inputPins, itemSources);
  if (existingErrors.length) {
    console.error('--check failed: existing json failed validation:');
    for (const e of existingErrors.slice(0, 30)) console.error(`  ${e}`);
    process.exit(1);
  }

  if (JSON.stringify(stripGeneratedAt(existing)) !== JSON.stringify(stripGeneratedAt(doc))) {
    console.error('--check failed: semantic JSON differs (ignoring metadata.generatedAt)');
    process.exit(1);
  }
  if (canonicalizeEol(existingCsv) !== canonicalizeEol(csvText)) {
    console.error('--check failed: CSV content differs');
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'check',
        schemaVersion: doc.metadata.schemaVersion,
        planRevision: doc.metadata.planRevision,
        templateCount: doc.summary.templateCount,
        targetStatusCounts: doc.summary.targetStatusCounts,
        targetSourceKindCounts: doc.summary.targetSourceKindCounts,
        templateKindCounts: doc.summary.templateKindCounts,
        excludedStatusCounts: doc.summary.excludedStatusCounts,
        stableKeyOrders: doc.metadata.stableKeyOrders,
      },
      null,
      2,
    ),
  );
}

function main() {
  const checkMode = process.argv.includes('--check');
  if (checkMode) {
    runCheck();
    return;
  }
  const generatedAt = new Date().toISOString();
  const { doc, csvText } = buildRegistry(generatedAt);
  writeOutputs(doc, csvText);
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'write',
        outputJson: OUTPUT_JSON_REL,
        outputCsv: OUTPUT_CSV_REL,
        schemaVersion: doc.metadata.schemaVersion,
        planRevision: doc.metadata.planRevision,
        templateCount: doc.summary.templateCount,
        targetStatusCounts: doc.summary.targetStatusCounts,
        targetSourceKindCounts: doc.summary.targetSourceKindCounts,
        templateKindCounts: doc.summary.templateKindCounts,
        excludedStatusCounts: doc.summary.excludedStatusCounts,
        stableKeyOrders: doc.metadata.stableKeyOrders,
      },
      null,
      2,
    ),
  );
}

main();

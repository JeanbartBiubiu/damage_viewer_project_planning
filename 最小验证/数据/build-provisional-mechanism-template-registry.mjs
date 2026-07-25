/**
 * Phase-T1 — Provisional mechanism template registry (frozen plan
 * provisional-mechanism-template-registry-phase-t1-v2).
 *
 * Inputs (exact pins):
 *   - 最小验证/unified-mechanism-inventory.json
 *   - 最小验证/wiki-only-mechanism-candidate-registry.json
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

const SCHEMA_VERSION = 'provisional-mechanism-template-registry-v1';
const FROZEN_PLAN_REV = 'provisional-mechanism-template-registry-phase-t1-v2';

const UNIFIED_REL = '最小验证/unified-mechanism-inventory.json';
const WIKI_REL = '最小验证/wiki-only-mechanism-candidate-registry.json';
const OUTPUT_JSON_REL = '最小验证/provisional-mechanism-template-registry.json';
const OUTPUT_CSV_REL = '最小验证/provisional-mechanism-template-registry.csv';

const PINNED_UNIFIED_SHA256 =
  '05f6705e7966b71578918df57237ee84894056dcba60a53c0e4a4ed13ef0d3eb';
const PINNED_UNIFIED_BYTES = 1047006;
const PINNED_WIKI_SHA256 =
  '06b2a124daf77dd84cf2970361fdb4ee854dbebfe8e7cbe1825a02988414bb0a';
const PINNED_WIKI_BYTES = 640928;

const SOURCE_UNIFIED_COUNT = 254;
const SOURCE_WIKI_COUNT = 242;
const TEMPLATE_COUNT = 87;

const TARGET_STATUSES = new Set([
  'partial_actionable',
  'ready_to_implement',
  'blocked_runtime',
  'blocked_data',
]);

const EXPECTED_TARGET_STATUS_COUNTS = {
  partial_actionable: 0,
  ready_to_implement: 0,
  blocked_runtime: 84,
  blocked_data: 3,
};

const EXPECTED_TARGET_SOURCE_KIND_COUNTS = {
  hero_skill: 85,
  item_passive: 2,
};

const EXPECTED_TEMPLATE_KIND_COUNTS = {
  actionable_contract_placeholder: 0,
  runtime_contract_placeholder: 84,
  data_contract_placeholder: 3,
};

const EXPECTED_EXCLUDED_STATUS_COUNTS = {
  completed: 89,
  out_of_scope: 72,
  regression_only: 5,
  stale_or_duplicate: 1,
};

const TEMPLATE_STATE = 'provisional_unverified';

const DRAFT_CONTRACT = Object.freeze({
  rank: null,
  resourceCost: null,
  cooldownMs: null,
  target: null,
  timing: null,
  formula: null,
  operationGraph: null,
  fixtures: Object.freeze([]),
  completedBoundary: null,
  exclusions: Object.freeze([]),
});

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
]);

const METADATA_KEYS = Object.freeze(['schemaVersion', 'planRevision', 'generatedAt', 'inputs']);
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

const paths = {
  unified: path.join(repoRoot, ...UNIFIED_REL.split('/')),
  wiki: path.join(repoRoot, ...WIKI_REL.split('/')),
  outputJson: path.join(repoRoot, ...OUTPUT_JSON_REL.split('/')),
  outputCsv: path.join(repoRoot, ...OUTPUT_CSV_REL.split('/')),
};

function sha256Raw(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
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

function makeDraftContract() {
  return {
    rank: null,
    resourceCost: null,
    cooldownMs: null,
    target: null,
    timing: null,
    formula: null,
    operationGraph: null,
    fixtures: [],
    completedBoundary: null,
    exclusions: [],
  };
}

function makeVerificationGates() {
  return VERIFICATION_GATE_IDS.map((id) => ({ id, state: 'pending' }));
}

function makeNonclaims() {
  return [...NONCLAIMS];
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

function readPinnedInput(absPath, relPath, expectedSha, expectedBytes) {
  const buf = fs.readFileSync(absPath);
  if (buf.length !== expectedBytes) {
    throw new Error(
      `${relPath} byteSize drift: got ${buf.length}, expected ${expectedBytes}`,
    );
  }
  const sha = sha256Raw(buf);
  if (sha !== expectedSha) {
    throw new Error(`${relPath} sha256 drift: got ${sha}, expected ${expectedSha}`);
  }
  return { buf, sha, byteSize: buf.length, doc: JSON.parse(buf.toString('utf8')) };
}

function countBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function assertExactCounts(actual, expected, label) {
  const ak = Object.keys(actual);
  const ek = Object.keys(expected);
  if (ak.length !== ek.length || !ek.every((k) => Object.prototype.hasOwnProperty.call(actual, k))) {
    throw new Error(`${label} keys mismatch: got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
  }
  for (const k of ek) {
    if (actual[k] !== expected[k]) {
      throw new Error(`${label}.${k}=${actual[k]}, expected ${expected[k]}`);
    }
  }
}

function buildRegistry(generatedAt) {
  const unifiedPin = readPinnedInput(
    paths.unified,
    UNIFIED_REL,
    PINNED_UNIFIED_SHA256,
    PINNED_UNIFIED_BYTES,
  );
  const wikiPin = readPinnedInput(paths.wiki, WIKI_REL, PINNED_WIKI_SHA256, PINNED_WIKI_BYTES);

  const unified = unifiedPin.doc;
  const wiki = wikiPin.doc;

  if (!Array.isArray(unified.mechanisms) || unified.mechanisms.length !== SOURCE_UNIFIED_COUNT) {
    throw new Error(
      `unified mechanisms length ${unified.mechanisms?.length}, expected ${SOURCE_UNIFIED_COUNT}`,
    );
  }
  if (!Array.isArray(wiki.candidates) || wiki.candidates.length !== SOURCE_WIKI_COUNT) {
    throw new Error(
      `wiki candidates length ${wiki.candidates?.length}, expected ${SOURCE_WIKI_COUNT}`,
    );
  }

  const excludedStatusCounts = {
    completed: 0,
    out_of_scope: 0,
    regression_only: 0,
    stale_or_duplicate: 0,
  };
  for (const m of unified.mechanisms) {
    if (TARGET_STATUSES.has(m.status)) continue;
    if (!Object.prototype.hasOwnProperty.call(excludedStatusCounts, m.status)) {
      throw new Error(`unexpected non-target status: ${m.status}`);
    }
    excludedStatusCounts[m.status] += 1;
  }
  assertExactCounts(excludedStatusCounts, EXPECTED_EXCLUDED_STATUS_COUNTS, 'excludedStatusCounts');

  const filtered = unified.mechanisms.filter((m) => TARGET_STATUSES.has(m.status));
  if (filtered.length !== TEMPLATE_COUNT) {
    throw new Error(`filtered target count ${filtered.length}, expected ${TEMPLATE_COUNT}`);
  }

  const targetStatusCounts = {
    partial_actionable: 0,
    ready_to_implement: 0,
    blocked_runtime: 0,
    blocked_data: 0,
  };
  const targetSourceKindCounts = { hero_skill: 0, item_passive: 0 };
  for (const m of filtered) {
    targetStatusCounts[m.status] += 1;
    if (!Object.prototype.hasOwnProperty.call(targetSourceKindCounts, m.sourceKind)) {
      throw new Error(`unexpected sourceKind: ${m.sourceKind}`);
    }
    targetSourceKindCounts[m.sourceKind] += 1;
  }
  assertExactCounts(targetStatusCounts, EXPECTED_TARGET_STATUS_COUNTS, 'targetStatusCounts');
  assertExactCounts(
    targetSourceKindCounts,
    EXPECTED_TARGET_SOURCE_KIND_COUNTS,
    'targetSourceKindCounts',
  );

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

    const wikiProvenance = buildWikiProvenance(candidate, row.sourceKind);
    const templateKind = templateKindForStatus(row.status);

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
      draftContract: makeDraftContract(),
      verificationGates: makeVerificationGates(),
      nonclaims: makeNonclaims(),
    };

    // Authority deep-equality including order (fail closed).
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

  // Unequal target key sets fail closed.
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

  const templateKindCounts = {
    actionable_contract_placeholder: 0,
    runtime_contract_placeholder: 0,
    data_contract_placeholder: 0,
  };
  for (const t of templates) {
    templateKindCounts[t.templateKind] += 1;
  }
  assertExactCounts(templateKindCounts, EXPECTED_TEMPLATE_KIND_COUNTS, 'templateKindCounts');

  const doc = {
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      planRevision: FROZEN_PLAN_REV,
      generatedAt,
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
      sourceUnifiedMechanismCount: SOURCE_UNIFIED_COUNT,
      sourceWikiRegistryCount: SOURCE_WIKI_COUNT,
      templateCount: TEMPLATE_COUNT,
      targetStatusCounts: { ...EXPECTED_TARGET_STATUS_COUNTS },
      targetSourceKindCounts: { ...EXPECTED_TARGET_SOURCE_KIND_COUNTS },
      templateKindCounts: { ...EXPECTED_TEMPLATE_KIND_COUNTS },
      excludedStatusCounts: { ...EXPECTED_EXCLUDED_STATUS_COUNTS },
    },
    templates,
  };

  const errors = validateRegistry(doc, filtered, wikiByKey);
  if (errors.length) {
    throw new Error(`registry validation failed (${errors.length}):\n${errors.slice(0, 40).join('\n')}`);
  }

  const csvText = toCsv(templates);
  return { doc, csvText };
}

function validateRegistry(doc, filteredUnifiedRows, wikiByKey) {
  const errors = [];

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
  if (!Array.isArray(doc.metadata.inputs) || doc.metadata.inputs.length !== 2) {
    errors.push('metadata.inputs must be length-2 array');
  } else {
    const [u, w] = doc.metadata.inputs;
    assertKeysOrderSafe(u, INPUT_ENTRY_KEYS, 'metadata.inputs[0]', errors);
    assertKeysOrderSafe(w, INPUT_ENTRY_KEYS, 'metadata.inputs[1]', errors);
    if (u.path !== UNIFIED_REL || u.sha256 !== PINNED_UNIFIED_SHA256 || u.byteSize !== PINNED_UNIFIED_BYTES) {
      errors.push('metadata.inputs[0] pin mismatch');
    }
    if (w.path !== WIKI_REL || w.sha256 !== PINNED_WIKI_SHA256 || w.byteSize !== PINNED_WIKI_BYTES) {
      errors.push('metadata.inputs[1] pin mismatch');
    }
  }

  assertKeysOrderSafe(doc.summary, SUMMARY_KEYS, 'summary', errors);
  if (doc.summary.sourceUnifiedMechanismCount !== SOURCE_UNIFIED_COUNT) {
    errors.push('summary.sourceUnifiedMechanismCount mismatch');
  }
  if (doc.summary.sourceWikiRegistryCount !== SOURCE_WIKI_COUNT) {
    errors.push('summary.sourceWikiRegistryCount mismatch');
  }
  if (doc.summary.templateCount !== TEMPLATE_COUNT) {
    errors.push('summary.templateCount mismatch');
  }
  if (!deepEqual(doc.summary.targetStatusCounts, EXPECTED_TARGET_STATUS_COUNTS)) {
    errors.push('summary.targetStatusCounts mismatch');
  }
  if (!deepEqual(doc.summary.targetSourceKindCounts, EXPECTED_TARGET_SOURCE_KIND_COUNTS)) {
    errors.push('summary.targetSourceKindCounts mismatch');
  }
  if (!deepEqual(doc.summary.templateKindCounts, EXPECTED_TEMPLATE_KIND_COUNTS)) {
    errors.push('summary.templateKindCounts mismatch');
  }
  if (!deepEqual(doc.summary.excludedStatusCounts, EXPECTED_EXCLUDED_STATUS_COUNTS)) {
    errors.push('summary.excludedStatusCounts mismatch');
  }

  if (!Array.isArray(doc.templates) || doc.templates.length !== TEMPLATE_COUNT) {
    errors.push(`templates length ${doc.templates?.length}, expected ${TEMPLATE_COUNT}`);
    return errors;
  }

  if (!Array.isArray(filteredUnifiedRows) || filteredUnifiedRows.length !== TEMPLATE_COUNT) {
    errors.push('filteredUnifiedRows length mismatch');
    return errors;
  }

  const seenKeys = new Set();
  const seenOrdinals = new Set();

  for (let i = 0; i < doc.templates.length; i++) {
    const t = doc.templates[i];
    const u = filteredUnifiedRows[i];
    assertKeysOrderSafe(t, TEMPLATE_KEYS, `templates[${i}]`, errors);

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

    assertKeysOrderSafe(t.draftContract, DRAFT_CONTRACT_KEYS, `draftContract @ ${t.key}`, errors);
    if (!deepEqual(t.draftContract, DRAFT_CONTRACT)) {
      // Compare against mutable equivalent of frozen constant.
      const expected = makeDraftContract();
      if (!deepEqual(t.draftContract, expected)) {
        errors.push(`draftContract fixed values mismatch @ ${t.key}`);
      }
    }

    if (!Array.isArray(t.verificationGates) || t.verificationGates.length !== VERIFICATION_GATE_IDS.length) {
      errors.push(`verificationGates length mismatch @ ${t.key}`);
    } else {
      for (let g = 0; g < t.verificationGates.length; g++) {
        const gate = t.verificationGates[g];
        assertKeysOrderSafe(gate, GATE_KEYS, `verificationGates[${g}] @ ${t.key}`, errors);
        if (gate.id !== VERIFICATION_GATE_IDS[g] || gate.state !== 'pending') {
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
    const expectedProv = buildWikiProvenance(candidate, t.sourceKind);
    if (!deepEqual(t.wikiProvenance, expectedProv)) {
      errors.push(`wikiProvenance deep inequality @ ${t.key}`);
    }

    // No completed/full/ready claim from provisional registry.
    if (t.templateState !== TEMPLATE_STATE) {
      errors.push(`non-provisional templateState @ ${t.key}`);
    }
    if (
      t.currentStatus === 'completed' ||
      t.templateKind === 'completed' ||
      t.draftContract.completedBoundary != null
    ) {
      errors.push(`completed/full claim detected @ ${t.key}`);
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
  const unifiedPin = readPinnedInput(
    paths.unified,
    UNIFIED_REL,
    PINNED_UNIFIED_SHA256,
    PINNED_UNIFIED_BYTES,
  );
  const wikiPin = readPinnedInput(paths.wiki, WIKI_REL, PINNED_WIKI_SHA256, PINNED_WIKI_BYTES);
  const filtered = unifiedPin.doc.mechanisms.filter((m) => TARGET_STATUSES.has(m.status));
  const wikiByKey = new Map(wikiPin.doc.candidates.map((c) => [c.candidateKey, c]));
  return { filtered, wikiByKey };
}

function runCheck() {
  if (!fs.existsSync(paths.outputJson) || !fs.existsSync(paths.outputCsv)) {
    console.error('--check failed: missing output json/csv');
    process.exit(1);
  }
  const existing = JSON.parse(fs.readFileSync(paths.outputJson, 'utf8'));
  const existingCsv = fs.readFileSync(paths.outputCsv, 'utf8');
  const { doc, csvText } = buildRegistry(existing.metadata?.generatedAt || new Date().toISOString());

  const { filtered, wikiByKey } = loadFilteredAndWikiMap();
  const existingErrors = validateRegistry(existing, filtered, wikiByKey);
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
        templateCount: doc.summary.templateCount,
        targetStatusCounts: doc.summary.targetStatusCounts,
        targetSourceKindCounts: doc.summary.targetSourceKindCounts,
        templateKindCounts: doc.summary.templateKindCounts,
        excludedStatusCounts: doc.summary.excludedStatusCounts,
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
        templateCount: doc.summary.templateCount,
        targetStatusCounts: doc.summary.targetStatusCounts,
        targetSourceKindCounts: doc.summary.targetSourceKindCounts,
        templateKindCounts: doc.summary.templateKindCounts,
        excludedStatusCounts: doc.summary.excludedStatusCounts,
      },
      null,
      2,
    ),
  );
}

main();

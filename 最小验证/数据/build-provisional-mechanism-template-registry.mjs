/**
 * Phase-T2 — Provisional mechanism template registry continuous refresh
 * (frozen plan provisional-mechanism-template-registry-phase-t2-dynamic-refresh-v1).
 *
 * Inputs (exact paths; raw sha256/byteSize recorded dynamically, not equality-pinned):
 *   - 最小验证/unified-mechanism-inventory.json
 *   - 最小验证/wiki-only-mechanism-candidate-registry.json
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

const SCHEMA_VERSION = 'provisional-mechanism-template-registry-v2';
const FROZEN_PLAN_REV = 'provisional-mechanism-template-registry-phase-t2-dynamic-refresh-v1';

const UNIFIED_REL = '最小验证/unified-mechanism-inventory.json';
const WIKI_REL = '最小验证/wiki-only-mechanism-candidate-registry.json';
const OUTPUT_JSON_REL = '最小验证/provisional-mechanism-template-registry.json';
const OUTPUT_CSV_REL = '最小验证/provisional-mechanism-template-registry.csv';

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

function emptyOrderedCounts(keys) {
  const out = {};
  for (const k of keys) out[k] = 0;
  return out;
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

function buildRegistry(generatedAt) {
  const unifiedPin = readDynamicInput(paths.unified, UNIFIED_REL);
  const wikiPin = readDynamicInput(paths.wiki, WIKI_REL);

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
  });
  if (errors.length) {
    throw new Error(`registry validation failed (${errors.length}):\n${errors.slice(0, 40).join('\n')}`);
  }

  const csvText = toCsv(templates);
  return { doc, csvText };
}

function validateRegistry(doc, filteredUnifiedRows, wikiByKey, inputPins) {
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
    if (Object.prototype.hasOwnProperty.call(t.wikiProvenance, 'sourceText')) {
      errors.push(`wikiProvenance.sourceText forbidden @ ${t.key}`);
    }
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
  const existingErrors = validateRegistry(existing, filtered, wikiByKey, inputPins);
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

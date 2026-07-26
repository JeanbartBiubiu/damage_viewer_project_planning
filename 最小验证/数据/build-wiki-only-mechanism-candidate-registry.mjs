/**
 * Run 1 — Wiki-only mechanism candidate registry (frozen plan
 * wiki-only-candidate-registry-source-allowlist-v3).
 *
 * Inputs (exact):
 *   - 数据参考/lol-wiki-mechanism-candidates/routing-manifest.json
 *   - 数据参考/lol-wiki-current-champions/identity-manifest.json
 *   - 数据参考/lol-wiki-current-champions/normalized/generic/{pageId}.json
 *   - 数据参考/lol-wiki-current-items/manifest.json
 *   - 数据参考/lol-wiki-current-items/current-items.normalized.json
 *
 * Outputs:
 *   - 最小验证/wiki-only-mechanism-candidate-registry.json
 *   - 最小验证/wiki-only-mechanism-candidate-registry.csv
 *
 * CLI:
 *   node .../build-wiki-only-mechanism-candidate-registry.mjs
 *   node .../build-wiki-only-mechanism-candidate-registry.mjs --check
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const FROZEN_PLAN_REV = 'wiki-only-candidate-registry-source-allowlist-v3';
const SCHEMA_VERSION = 'wiki-only-mechanism-candidate-registry-v1';
const EXPECTED_COUNT = 242;
const EXPECTED_HERO = 165;
const EXPECTED_ITEM = 77;
const EXPECTED_ITEM_OWNERS = 53;

const PINNED_ITEMS_REVID = 4030984;
const PINNED_ITEMS_SHA256 =
  'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d';

const ROUTING_REL = '数据参考/lol-wiki-mechanism-candidates/routing-manifest.json';
const IDENTITY_REL = '数据参考/lol-wiki-current-champions/identity-manifest.json';
const GENERIC_REL = '数据参考/lol-wiki-current-champions/normalized/generic';
const ITEMS_MANIFEST_REL = '数据参考/lol-wiki-current-items/manifest.json';
const ITEMS_NORMALIZED_REL = '数据参考/lol-wiki-current-items/current-items.normalized.json';
const GENERATOR_REL = '最小验证/数据/build-wiki-only-mechanism-candidate-registry.mjs';
const OUTPUT_JSON_REL = '最小验证/wiki-only-mechanism-candidate-registry.json';
const OUTPUT_CSV_REL = '最小验证/wiki-only-mechanism-candidate-registry.csv';

const paths = {
  routing: path.join(repoRoot, ...ROUTING_REL.split('/')),
  identity: path.join(repoRoot, ...IDENTITY_REL.split('/')),
  genericDir: path.join(repoRoot, ...GENERIC_REL.split('/')),
  itemsManifest: path.join(repoRoot, ...ITEMS_MANIFEST_REL.split('/')),
  itemsNormalized: path.join(repoRoot, ...ITEMS_NORMALIZED_REL.split('/')),
  outputJson: path.join(repoRoot, ...OUTPUT_JSON_REL.split('/')),
  outputCsv: path.join(repoRoot, ...OUTPUT_CSV_REL.split('/')),
};

/** Stable hero field order for deterministic sourceText. */
const HERO_FIELD_ORDER = [
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
  'tip',
];

/** Exact known item routes that must be asserted (fail closed). */
const EXACT_ITEM_ROUTES = [
  ['item_passive|3031|item_passive|无被动或仅主动/属性', []],
  ['item_passive|3139|item_passive|无被动或仅主动/属性', []],
  ['item_passive|3146|item_passive|无被动或仅主动/属性', []],
  ['item_passive|3004|item_passive|敬畏', ['pass']],
  ['item_passive|3004|item_passive|法力流', ['pass2', 'pass3']],
  ['item_passive|3074|item_passive|顺劈', ['pass']],
  ['item_passive|3087|item_passive|电疗', ['pass2']],
  ['item_passive|3087|item_passive|电火花', ['pass3']],
  ['item_passive|3094|item_passive|神射手', ['pass2']],
  ['item_passive|3142|item_passive|鬼影萦绕', ['pass']],
  ['item_passive|3179|item_passive|夜行者', ['pass3']],
  ['item_passive|3179|item_passive|封锁', ['pass', 'pass2']],
  ['item_passive|3748|item_passive|顺劈|数据参考/item.json#data.3748|71fa0f0c', ['pass']],
  ['item_passive|3748|item_passive|顺劈|数据参考/item.json#data.3748|020f8b5a', ['pass']],
  ['item_passive|6333|item_passive|无视痛苦|数据参考/item.json#data.6333|668e55b0', ['pass']],
  ['item_passive|6333|item_passive|蔑视', ['pass2']],
  ['item_passive|6333|item_passive|无视痛苦|数据参考/item.json#data.6333|52e96cc8', ['pass2']],
  ['item_passive|6631|item_passive|顺劈', ['pass']],
  ['item_passive|6695|item_passive|掠盾者|数据参考/item.json#data.6695|2892fed0', ['pass']],
  ['item_passive|6695|item_passive|掠盾者|数据参考/item.json#data.6695|7bcc8c31', ['pass']],
  ['item_passive|6698|item_passive|顺劈', ['pass']],
  ['item_passive|6699|item_passive|通电', ['pass2']],
  ['item_passive|6699|item_passive|苍穹', ['pass3']],
];

const SENTINEL_DISPOSITION = {
  '3031': 'stat_only_no_passive',
  '3139': 'active_only_sentinel',
  '3146': 'active_only_sentinel',
};

const CSV_COLUMNS = [
  'candidateKey',
  'inventoryOrdinal',
  'sourceKind',
  'ownerId',
  'skillKey',
  'passiveName',
  'pageId',
  'wikiItemId',
  'wikiEffectSlots',
  'legacyClassification',
  'resolvedBucket',
  'sourceRef',
];

function canonicalizeUtf8TextBytes(buf) {
  const text = Buffer.from(buf).toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return Buffer.from(text, 'utf8');
}

function canonicalizeEol(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function sha256Raw(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(absPath) {
  return sha256Raw(canonicalizeUtf8TextBytes(fs.readFileSync(absPath)));
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function slotsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
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

/** Shared structural forbidden sources (always checked). */
function citesForbiddenSourcePaths(text) {
  const s = String(text || '');
  if (/ddragon/i.test(s)) return true;
  if (/data\s+dragon/i.test(s)) return true;
  if (/(^|[^a-z0-9])dd\s+\d+(?:\.\d+)+/i.test(s)) return true;
  if (/数据参考\/item\.json/i.test(s)) return true;
  if (/数据参考\/champion(\/|\.json)/i.test(s)) return true;
  if (/champion-seed-candidate/i.test(s)) return true;
  if (/training-ground/i.test(s)) return true;
  return false;
}

/**
 * Provenance citation check for sourceRef / blockedReason / structured notes.
 * Wiki ability prose may contain media filenames like `*_screenshot.png`; those are
 * not treated as registry provenance citations.
 */
function citesForbiddenProvenanceCitation(text) {
  const s = String(text || '');
  if (citesForbiddenSourcePaths(s)) return true;
  if (/\bocr\b/i.test(s)) return true;
  if (/screenshot/i.test(s)) return true;
  return false;
}

/** Wiki-derived sourceText: forbid path/provenance citations, not media filenames. */
function citesForbiddenInWikiSourceText(text) {
  const s = String(text || '');
  if (citesForbiddenSourcePaths(s)) return true;
  // OCR/screenshot only when used as a data-source citation, not File: *_screenshot.png.
  if (/\b(?:from|via|by|using)\s+ocr\b/i.test(s)) return true;
  if (/\bocr\s+(?:baseline|capture|source|scan)\b/i.test(s)) return true;
  if (/\b(?:from|via|by|using)\s+screenshot\b/i.test(s)) return true;
  if (/\bscreenshot\s+(?:baseline|capture|source|ocr)\b/i.test(s)) return true;
  return false;
}

/** Recursively collect non-key string fields for forbidden-provenance scans. */
function collectActiveProvenanceStrings(value, out, keyPath = '') {
  if (value == null) return;
  if (typeof value === 'string') {
    out.push({ path: keyPath, text: value });
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectActiveProvenanceStrings(v, out, `${keyPath}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      // Opaque key fields may embed historical path fragments; never scan them.
      if (k === 'candidateKey' || k === 'fragmentDiscriminator') continue;
      collectActiveProvenanceStrings(v, out, keyPath ? `${keyPath}.${k}` : k);
    }
  }
}

function fieldCitesForbidden(pathKey, text) {
  if (pathKey === 'sourceText' || pathKey.endsWith('.sourceText')) {
    return citesForbiddenInWikiSourceText(text);
  }
  return citesForbiddenProvenanceCitation(text);
}

function heroSourceText(fields) {
  if (!fields || typeof fields !== 'object') return '';
  const parts = [];
  const seen = new Set();
  for (const key of HERO_FIELD_ORDER) {
    if (!(key in fields)) continue;
    const raw = fields[key];
    if (raw == null) continue;
    const text = String(raw).replace(/\s+$/g, '');
    if (!text.trim()) continue;
    parts.push(text.trimEnd());
    seen.add(key);
  }
  // Any remaining fields in sorted key order (deterministic; rare extras).
  for (const key of Object.keys(fields).sort()) {
    if (seen.has(key)) continue;
    const raw = fields[key];
    if (raw == null) continue;
    const text = String(raw).replace(/\s+$/g, '');
    if (!text.trim()) continue;
    parts.push(text.trimEnd());
  }
  return parts.join('\n').trim();
}

function effectSlotBody(effect) {
  if (effect == null) return { name: '', body: '' };
  if (typeof effect === 'string') {
    return { name: '', body: effect.trim() };
  }
  if (typeof effect !== 'object') {
    return { name: '', body: String(effect).trim() };
  }
  const name = String(effect.name || '').trim();
  const chunks = [];
  if (effect.description != null && String(effect.description).trim()) {
    chunks.push(String(effect.description).trim());
  }
  if (effect.description2 != null && String(effect.description2).trim()) {
    chunks.push(String(effect.description2).trim());
  }
  return { name, body: chunks.join('\n').trim() };
}

function itemSourceTextFromSlots(item, slots) {
  const effects = item?.effects || {};
  const parts = [];
  for (const slot of slots) {
    const { name, body } = effectSlotBody(effects[slot]);
    if (name && body) parts.push(`${name}: ${body}`);
    else if (name) parts.push(name);
    else if (body) parts.push(body);
  }
  return parts.join('\n\n').trim();
}

function itemSourceRef(itemId, slots, revid, contentSha256) {
  const slotPart = Array.isArray(slots) ? slots.join('+') : '';
  return (
    `${ITEMS_NORMALIZED_REL}#item_${itemId}_slots_${slotPart}`
    + `@revid${revid} sha256:${contentSha256}`
  );
}

function heroSourceRef(pageId, revisionId, contentSha256) {
  return `${GENERIC_REL}/${pageId}.json@rev${revisionId} sha256:${contentSha256}`;
}

function defaultCompatFields(entry) {
  const isHero = entry.sourceKind === 'hero_skill';
  const boundaryReason = entry.auditBaseline?.outOfScope?.boundaryReason || '';
  return {
    blockedReason: boundaryReason,
    needsUserData: [],
    levelDataStatus: isHero ? 'missing' : 'not_applicable',
    rankTableStatus: 'not_applicable',
    candidateDpsPassiveEffect: {},
  };
}

function buildCandidate(entry, ctx) {
  const auditBaseline = structuredClone(entry.auditBaseline);
  const compat = defaultCompatFields(entry);
  const base = {
    candidateKey: entry.candidateKey,
    inventoryOrdinal: entry.inventoryOrdinal,
    sourceKind: entry.sourceKind,
    ownerId: entry.ownerId,
    skillKey: entry.skillKey,
    passiveName: entry.keyLabelZh,
    classification: auditBaseline.legacyClassification,
    mechanismTags: [...(auditBaseline.mechanismTags || [])],
    ...compat,
    auditBaseline,
  };

  if (entry.sourceKind === 'hero_skill') {
    const identity = ctx.identityByKey.get(entry.candidateKey)
      || ctx.identityByOwnerSkill.get(`${entry.ownerId}|${entry.skillKey}`);
    if (!identity) {
      throw new Error(`missing identity for ${entry.candidateKey}`);
    }
    if (identity.pageId !== entry.pageId) {
      throw new Error(
        `pageId mismatch routing=${entry.pageId} identity=${identity.pageId} @ ${entry.candidateKey}`,
      );
    }
    if (identity.ownerId !== entry.ownerId || identity.skillKey !== entry.skillKey) {
      throw new Error(`identity owner/skill mismatch @ ${entry.candidateKey}`);
    }
    if (identity.zhDisplayName !== entry.keyLabelZh) {
      throw new Error(
        `zhDisplayName mismatch identity=${identity.zhDisplayName} keyLabelZh=${entry.keyLabelZh} @ ${entry.candidateKey}`,
      );
    }

    const genericPath = path.join(ctx.genericDir, `${entry.pageId}.json`);
    if (!fs.existsSync(genericPath)) {
      throw new Error(`missing generic wiki file ${GENERIC_REL}/${entry.pageId}.json`);
    }
    const doc = readJson(genericPath);
    if (doc.pageId !== entry.pageId) {
      throw new Error(`generic pageId ${doc.pageId} != ${entry.pageId}`);
    }
    if (doc.ownerId && doc.ownerId !== entry.ownerId) {
      throw new Error(`generic ownerId mismatch @ ${entry.candidateKey}`);
    }
    if (doc.skillKey && doc.skillKey !== entry.skillKey) {
      throw new Error(`generic skillKey mismatch @ ${entry.candidateKey}`);
    }
    if (!doc.revisionId || !doc.contentSha256) {
      throw new Error(`generic missing revision/hash @ ${entry.pageId}`);
    }

    return {
      ...base,
      ownerName: identity.wikiChampionTitle || entry.ownerId,
      pageId: entry.pageId,
      sourceText: heroSourceText(doc.fields),
      sourceRef: heroSourceRef(entry.pageId, doc.revisionId, doc.contentSha256),
    };
  }

  // item_passive
  const itemId = String(entry.wikiItemId || entry.ownerId);
  const item = ctx.itemsById.get(itemId);
  if (!item) {
    throw new Error(`missing current-items entry for wikiItemId=${itemId}`);
  }
  const slots = Array.isArray(entry.wikiEffectSlots) ? [...entry.wikiEffectSlots] : [];
  for (const slot of slots) {
    if (!(slot in (item.effects || {}))) {
      throw new Error(`missing effect slot ${slot} on item ${itemId} @ ${entry.candidateKey}`);
    }
  }

  const row = {
    ...base,
    ownerName: String(item.name || itemId),
    wikiItemId: itemId,
    wikiEffectSlots: slots,
    sourceRef: itemSourceRef(itemId, slots, ctx.itemsRevid, ctx.itemsContentSha256),
  };
  if (entry.fragmentDiscriminator) {
    row.fragmentDiscriminator = entry.fragmentDiscriminator;
  }

  const disposition = SENTINEL_DISPOSITION[itemId];
  if (disposition && slots.length === 0) {
    row.sentinelDisposition = disposition;
    // Structured note only — no fabricated ability prose.
    row.sourceText = `disposition:${disposition}`;
  } else {
    row.sourceText = itemSourceTextFromSlots(item, slots);
  }
  return row;
}

function candidateToCsvRow(c) {
  return {
    candidateKey: c.candidateKey,
    inventoryOrdinal: c.inventoryOrdinal,
    sourceKind: c.sourceKind,
    ownerId: c.ownerId,
    skillKey: c.skillKey,
    passiveName: c.passiveName,
    pageId: c.pageId || '',
    wikiItemId: c.wikiItemId || '',
    wikiEffectSlots: Array.isArray(c.wikiEffectSlots) ? c.wikiEffectSlots.join('+') : '',
    legacyClassification: c.auditBaseline?.legacyClassification || c.classification || '',
    resolvedBucket: c.auditBaseline?.resolvedBucket || '',
    sourceRef: c.sourceRef || '',
  };
}

function validateRegistry(doc, ctx) {
  const errors = [];
  const candidates = doc.candidates || [];
  if (candidates.length !== EXPECTED_COUNT) {
    errors.push(`candidateCount=${candidates.length}, expected ${EXPECTED_COUNT}`);
  }

  const keys = new Set();
  let hero = 0;
  let item = 0;
  const itemOwners = new Set();

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    if (!c.candidateKey) errors.push(`empty candidateKey @ index ${i}`);
    if (keys.has(c.candidateKey)) errors.push(`duplicate candidateKey ${c.candidateKey}`);
    keys.add(c.candidateKey);
    if (c.inventoryOrdinal !== i) {
      errors.push(`inventoryOrdinal ${c.inventoryOrdinal} != index ${i} @ ${c.candidateKey}`);
    }
    if (c.sourceKind === 'hero_skill') hero += 1;
    else if (c.sourceKind === 'item_passive') {
      item += 1;
      itemOwners.add(String(c.ownerId));
    } else {
      errors.push(`unknown sourceKind ${c.sourceKind} @ ${c.candidateKey}`);
    }

    if (c.passiveName == null || c.passiveName === '') {
      errors.push(`empty passiveName @ ${c.candidateKey}`);
    }
    if (!c.auditBaseline || typeof c.auditBaseline !== 'object') {
      errors.push(`missing auditBaseline @ ${c.candidateKey}`);
    } else {
      if (c.classification !== c.auditBaseline.legacyClassification) {
        errors.push(`classification != auditBaseline.legacyClassification @ ${c.candidateKey}`);
      }
      const tags = c.mechanismTags || [];
      const baseTags = c.auditBaseline.mechanismTags || [];
      if (JSON.stringify(tags) !== JSON.stringify(baseTags)) {
        errors.push(`mechanismTags != auditBaseline.mechanismTags @ ${c.candidateKey}`);
      }
    }

    if (c.sourceKind === 'hero_skill') {
      if (!c.pageId) errors.push(`missing pageId @ ${c.candidateKey}`);
      if (!String(c.sourceRef || '').includes(`${GENERIC_REL}/${c.pageId}.json@rev`)) {
        errors.push(`hero sourceRef missing page/rev @ ${c.candidateKey}`);
      }
      if (!String(c.sourceRef || '').includes('sha256:')) {
        errors.push(`hero sourceRef missing sha256 @ ${c.candidateKey}`);
      }
    } else {
      if (!c.wikiItemId) errors.push(`missing wikiItemId @ ${c.candidateKey}`);
      if (!Array.isArray(c.wikiEffectSlots)) {
        errors.push(`wikiEffectSlots not array @ ${c.candidateKey}`);
      }
      if (!String(c.sourceRef || '').startsWith(`${ITEMS_NORMALIZED_REL}#item_`)) {
        errors.push(`item sourceRef prefix @ ${c.candidateKey}`);
      }
      if (!String(c.sourceRef || '').includes(`@revid${PINNED_ITEMS_REVID}`)) {
        errors.push(`item sourceRef missing pinned revid @ ${c.candidateKey}`);
      }
      if (!String(c.sourceRef || '').includes(`sha256:${PINNED_ITEMS_SHA256}`)) {
        errors.push(`item sourceRef missing pinned sha256 @ ${c.candidateKey}`);
      }
    }

    // Forbidden provenance on active non-key fields (never inside candidateKey).
    const active = [];
    collectActiveProvenanceStrings(c, active);
    for (const { path: p, text } of active) {
      if (fieldCitesForbidden(p, text)) {
        errors.push(`forbidden provenance in ${p} @ ${c.candidateKey}`);
      }
    }
  }

  if (hero !== EXPECTED_HERO || item !== EXPECTED_ITEM) {
    errors.push(`sourceKind counts hero=${hero}/item=${item}, expected ${EXPECTED_HERO}/${EXPECTED_ITEM}`);
  }
  if (itemOwners.size !== EXPECTED_ITEM_OWNERS) {
    errors.push(`item owners=${itemOwners.size}, expected ${EXPECTED_ITEM_OWNERS}`);
  }
  if (keys.size !== EXPECTED_COUNT) {
    errors.push(`unique keys=${keys.size}, expected ${EXPECTED_COUNT}`);
  }

  // Exact known routes.
  const byKey = new Map(candidates.map((c) => [c.candidateKey, c]));
  for (const [key, expectedSlots] of EXACT_ITEM_ROUTES) {
    const c = byKey.get(key);
    if (!c) {
      errors.push(`missing exact route candidate ${key}`);
      continue;
    }
    if (!slotsEqual(c.wikiEffectSlots || [], expectedSlots)) {
      errors.push(
        `exact route slots mismatch @ ${key}: got ${JSON.stringify(c.wikiEffectSlots)} expected ${JSON.stringify(expectedSlots)}`,
      );
    }
  }

  // Sentinel dispositions.
  for (const [itemId, disposition] of Object.entries(SENTINEL_DISPOSITION)) {
    const c = candidates.find(
      (row) => row.sourceKind === 'item_passive' && String(row.wikiItemId) === itemId,
    );
    if (!c) {
      errors.push(`missing sentinel item ${itemId}`);
      continue;
    }
    if ((c.wikiEffectSlots || []).length !== 0) {
      errors.push(`sentinel ${itemId} must have empty wikiEffectSlots`);
    }
    if (c.sentinelDisposition !== disposition) {
      errors.push(
        `sentinel ${itemId} disposition=${c.sentinelDisposition}, expected ${disposition}`,
      );
    }
    if (citesForbiddenInWikiSourceText(c.sourceText)) {
      errors.push(`sentinel ${itemId} sourceText cites forbidden provenance`);
    }
    // Must not invent long ability prose for sentinels.
    if (String(c.sourceText || '').length > 80 && !String(c.sourceText).startsWith('disposition:')) {
      errors.push(`sentinel ${itemId} sourceText looks fabricated`);
    }
  }

  // Routing vs registry key/order parity.
  for (let i = 0; i < ctx.routingEntries.length; i += 1) {
    const r = ctx.routingEntries[i];
    const c = candidates[i];
    if (!c || c.candidateKey !== r.candidateKey) {
      errors.push(`order/key drift at ${i}: routing=${r?.candidateKey} registry=${c?.candidateKey}`);
    }
  }

  // Metadata pins.
  if (doc.metadata?.frozenPlanRev !== FROZEN_PLAN_REV) {
    errors.push(`metadata.frozenPlanRev mismatch`);
  }
  if (Number(doc.metadata?.itemsManifest?.revid) !== PINNED_ITEMS_REVID) {
    errors.push(`items manifest revid not pinned to ${PINNED_ITEMS_REVID}`);
  }
  if (doc.metadata?.itemsManifest?.contentSha256 !== PINNED_ITEMS_SHA256) {
    errors.push(`items manifest sha256 not pinned`);
  }

  return errors;
}

function buildRegistry(generatedAt) {
  const routing = readJson(paths.routing);
  if (routing.entryCount !== EXPECTED_COUNT || !Array.isArray(routing.entries)) {
    throw new Error(`routing manifest entryCount invalid: ${routing.entryCount}`);
  }
  if (routing.entries.length !== EXPECTED_COUNT) {
    throw new Error(`routing entries length ${routing.entries.length}`);
  }
  if (routing.frozenPlanRev !== FROZEN_PLAN_REV) {
    throw new Error(`routing frozenPlanRev=${routing.frozenPlanRev}, expected ${FROZEN_PLAN_REV}`);
  }

  const identity = readJson(paths.identity);
  const identityByKey = new Map((identity.entries || []).map((e) => [e.candidateKey, e]));
  const identityByOwnerSkill = new Map(
    (identity.entries || []).map((e) => [`${e.ownerId}|${e.skillKey}`, e]),
  );
  if ((identity.entries || []).length !== EXPECTED_HERO) {
    throw new Error(`identity entryCount ${(identity.entries || []).length}, expected ${EXPECTED_HERO}`);
  }

  const itemsManifest = readJson(paths.itemsManifest);
  if (Number(itemsManifest.revid) !== PINNED_ITEMS_REVID) {
    throw new Error(
      `items manifest revid=${itemsManifest.revid}, expected pinned ${PINNED_ITEMS_REVID}`,
    );
  }
  if (itemsManifest.contentSha256 !== PINNED_ITEMS_SHA256) {
    throw new Error(
      `items manifest contentSha256=${itemsManifest.contentSha256}, expected pinned ${PINNED_ITEMS_SHA256}`,
    );
  }
  const fileSha = sha256File(paths.itemsNormalized);
  // Prefer manifest pin; file hash may differ only by EOL — canonicalize already applied.
  // Assert manifest pin is the contractual provenance hash.
  const itemsContentSha256 = itemsManifest.contentSha256;

  const itemsDoc = readJson(paths.itemsNormalized);
  const itemsById = new Map((itemsDoc.items || []).map((it) => [String(it.id), it]));

  const ctx = {
    identityByKey,
    identityByOwnerSkill,
    genericDir: paths.genericDir,
    itemsById,
    itemsRevid: PINNED_ITEMS_REVID,
    itemsContentSha256,
    routingEntries: routing.entries,
  };

  const candidates = routing.entries.map((entry) => buildCandidate(entry, ctx));

  const heroCount = candidates.filter((c) => c.sourceKind === 'hero_skill').length;
  const itemCount = candidates.filter((c) => c.sourceKind === 'item_passive').length;
  const itemOwnerCount = new Set(
    candidates.filter((c) => c.sourceKind === 'item_passive').map((c) => String(c.ownerId)),
  ).size;

  const doc = {
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      frozenPlanRev: FROZEN_PLAN_REV,
      generatedAt,
      generatorPath: GENERATOR_REL,
      purpose: 'wiki_only_mechanism_candidate_registry_identity_and_evidence_text',
      inputs: {
        routingManifest: {
          path: ROUTING_REL,
          sha256: sha256File(paths.routing),
          entryCount: routing.entryCount,
        },
        identityManifest: {
          path: IDENTITY_REL,
          sha256: sha256File(paths.identity),
          entryCount: identity.entryCount ?? (identity.entries || []).length,
        },
        itemsManifest: {
          path: ITEMS_MANIFEST_REL,
          revid: PINNED_ITEMS_REVID,
          contentSha256: PINNED_ITEMS_SHA256,
        },
        itemsNormalized: {
          path: ITEMS_NORMALIZED_REL,
          sha256FileCanonical: fileSha,
          contentSha256Pinned: PINNED_ITEMS_SHA256,
        },
        genericWikiDir: GENERIC_REL,
      },
      itemsManifest: {
        revid: PINNED_ITEMS_REVID,
        contentSha256: PINNED_ITEMS_SHA256,
      },
    },
    summary: {
      candidateCount: candidates.length,
      sourceKindCounts: {
        hero_skill: heroCount,
        item_passive: itemCount,
      },
      itemOwnerCount,
      classificationBucketCounts: Object.fromEntries(
        ['migrated', 'partial', 'blocked', 'out_of_scope'].map((k) => [
          k,
          candidates.filter((c) => c.auditBaseline?.resolvedBucket === k).length,
        ]),
      ),
    },
    candidates,
  };

  const errors = validateRegistry(doc, ctx);
  if (errors.length) {
    const preview = errors.slice(0, 40).join('\n');
    throw new Error(`registry validation failed (${errors.length}):\n${preview}`);
  }

  const csvText = toCsv(candidates.map(candidateToCsvRow));
  return { doc, csvText };
}

function writeOutputs(doc, csvText) {
  fs.writeFileSync(paths.outputJson, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  fs.writeFileSync(paths.outputCsv, csvText, 'utf8');
}

function runCheck() {
  if (!fs.existsSync(paths.outputJson) || !fs.existsSync(paths.outputCsv)) {
    console.error('--check failed: missing output json/csv');
    process.exit(1);
  }
  const existing = readJson(paths.outputJson);
  const existingCsv = fs.readFileSync(paths.outputCsv, 'utf8');
  const { doc, csvText } = buildRegistry(existing.metadata?.generatedAt || new Date().toISOString());

  const existingErrors = validateRegistry(existing, {
    routingEntries: readJson(paths.routing).entries,
    identityByKey: new Map(),
    identityByOwnerSkill: new Map(),
    genericDir: paths.genericDir,
    itemsById: new Map(),
    itemsRevid: PINNED_ITEMS_REVID,
    itemsContentSha256: PINNED_ITEMS_SHA256,
  });
  // Re-validate existing with full rebuild context for route/identity checks already in build.
  // Semantic compare is the primary --check gate; still surface basic count errors.
  if (existingErrors.some((e) => /candidateCount|sourceKind|item owners|unique keys|exact route|sentinel|forbidden/.test(e))) {
    console.error('--check failed: existing json failed validation:');
    for (const e of existingErrors.slice(0, 30)) console.error(`  ${e}`);
    process.exit(1);
  }

  if (JSON.stringify(stripGeneratedAt(existing)) !== JSON.stringify(stripGeneratedAt(doc))) {
    console.error('--check failed: semantic JSON differs (ignoring generatedAt)');
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
        candidateCount: doc.summary.candidateCount,
        sourceKindCounts: doc.summary.sourceKindCounts,
        itemOwnerCount: doc.summary.itemOwnerCount,
        classificationBucketCounts: doc.summary.classificationBucketCounts,
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
        candidateCount: doc.summary.candidateCount,
        sourceKindCounts: doc.summary.sourceKindCounts,
        itemOwnerCount: doc.summary.itemOwnerCount,
        classificationBucketCounts: doc.summary.classificationBucketCounts,
        exactRoutesAsserted: EXACT_ITEM_ROUTES.length,
        sentinels: SENTINEL_DISPOSITION,
      },
      null,
      2,
    ),
  );
}

main();

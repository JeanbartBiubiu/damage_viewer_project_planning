/**
 * Run 1 — Batch-G ADC passive audit as Wiki-registry compatibility projection
 * (frozen plan wiki-only-candidate-registry-source-allowlist-v3).
 *
 * Sole input:
 *   - 最小验证/wiki-only-mechanism-candidate-registry.json
 *
 * Output (historical filename / schema role only — NOT G8 canonical input):
 *   - 最小验证/V2-Batch-G-adc-passive-audit.json
 *
 * CLI:
 *   node .../build-v2-batch-g-adc-passive-audit.mjs
 *   node .../build-v2-batch-g-adc-passive-audit.mjs --check
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const FROZEN_PLAN_REV = 'wiki-only-candidate-registry-source-allowlist-v3';
const REGISTRY_REL = '最小验证/wiki-only-mechanism-candidate-registry.json';
const OUTPUT_REL = '最小验证/V2-Batch-G-adc-passive-audit.json';
const GENERATOR_REL = '最小验证/数据/build-v2-batch-g-adc-passive-audit.mjs';

const WIKI_CHAMPIONS_GENERIC_REL =
  '数据参考/lol-wiki-current-champions/normalized/generic';
const WIKI_ITEMS_NORMALIZED_REL =
  '数据参考/lol-wiki-current-items/current-items.normalized.json';
const WIKI_ITEMS_MANIFEST_REL = '数据参考/lol-wiki-current-items/manifest.json';

const paths = {
  registry: path.join(repoRoot, ...REGISTRY_REL.split('/')),
  auditJson: path.join(repoRoot, ...OUTPUT_REL.split('/')),
};

const CLASSIFICATIONS = [
  'ready_to_encode',
  'already_covered',
  'needs_runtime_extension',
  'needs_manual_baseline',
  'out_of_scope_for_single_target_dps',
];

const EXPECTED_CLASSIFICATION_COUNTS = {
  already_covered: 22,
  needs_runtime_extension: 31,
  ready_to_encode: 1,
  needs_manual_baseline: 43,
  out_of_scope_for_single_target_dps: 145,
};

const EXPECTED_CANDIDATE_COUNT = 242;
const EXPECTED_HERO = 165;
const EXPECTED_ITEM = 77;
const EXPECTED_MARKSMAN_HEROES = 33;
const EXPECTED_ADC_ITEMS = 53;

const REQUIRED_STATS_BY_LEVEL_KEYS = [
  'hp',
  'mana',
  'ad',
  'armor',
  'magic_resist',
  'hp_regen',
  'mana_regen',
  'attack_speed',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function canonicalizeEol(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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

function semanticEqual(a, b) {
  return (
    canonicalizeEol(JSON.stringify(stripGeneratedAt(a), null, 2))
    === canonicalizeEol(JSON.stringify(stripGeneratedAt(b), null, 2))
  );
}

function citesForbiddenProvenance(text) {
  const s = String(text || '');
  if (/ddragon/i.test(s)) return true;
  if (/data\s+dragon/i.test(s)) return true;
  if (/数据参考\/item\.json/i.test(s)) return true;
  if (/数据参考\/champion(\/|\.json)/i.test(s)) return true;
  if (/training[-_]?ground/i.test(s)) return true;
  if (/\bOCR\b/i.test(s) && !/forbid|禁止|不得|provenance/i.test(s)) return true;
  if (/\bscreenshot\b/i.test(s) && !/forbid|禁止|不得/i.test(s)) return true;
  if (/训练营截图|训练场截图/i.test(s)) return true;
  return false;
}

function projectCandidate(entry) {
  const auditBaseline = structuredClone(entry.auditBaseline ?? {});
  const classification =
    entry.classification
    || auditBaseline.legacyClassification
    || '';
  const mechanismTags = Array.isArray(entry.mechanismTags)
    ? [...entry.mechanismTags]
    : Array.isArray(auditBaseline.mechanismTags)
      ? [...auditBaseline.mechanismTags]
      : [];

  return {
    candidateKey: entry.candidateKey,
    sourceKind: entry.sourceKind,
    ownerId: entry.ownerId,
    ownerName: entry.ownerName,
    skillKey: entry.skillKey,
    passiveName: entry.passiveName,
    sourceText: entry.sourceText ?? '',
    classification,
    mechanismTags,
    blockedReason: entry.blockedReason ?? '',
    needsUserData: Array.isArray(entry.needsUserData) ? [...entry.needsUserData] : [],
    levelDataStatus: entry.levelDataStatus ?? 'missing',
    rankTableStatus: entry.rankTableStatus ?? 'not_applicable',
    candidateDpsPassiveEffect:
      entry.candidateDpsPassiveEffect && typeof entry.candidateDpsPassiveEffect === 'object'
        ? structuredClone(entry.candidateDpsPassiveEffect)
        : {},
    sourceRef: entry.sourceRef ?? '',
    auditBaseline,
  };
}

function summarize(candidates) {
  const classificationCounts = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0]));
  const sourceKindCounts = {};
  const mechanismBacklog = {};
  const heroOwners = new Set();
  const itemOwners = new Set();

  for (const candidate of candidates) {
    classificationCounts[candidate.classification] =
      (classificationCounts[candidate.classification] ?? 0) + 1;
    sourceKindCounts[candidate.sourceKind] =
      (sourceKindCounts[candidate.sourceKind] ?? 0) + 1;
    if (candidate.sourceKind === 'hero_skill') {
      heroOwners.add(String(candidate.ownerId));
    } else if (candidate.sourceKind === 'item_passive') {
      itemOwners.add(String(candidate.ownerId));
    }
    if (candidate.classification === 'needs_runtime_extension') {
      for (const tag of candidate.mechanismTags ?? []) {
        mechanismBacklog[tag] = (mechanismBacklog[tag] ?? 0) + 1;
      }
    }
  }

  return {
    marksmanHeroCount: heroOwners.size,
    adcCompletedItemCount: itemOwners.size,
    candidateCount: candidates.length,
    sourceKindCounts,
    classificationCounts,
    mechanismBacklog,
  };
}

function buildAudit() {
  if (!fs.existsSync(paths.registry)) {
    throw new Error(`missing wiki-only registry input: ${REGISTRY_REL}`);
  }
  const registry = readJson(paths.registry);
  if (!Array.isArray(registry.candidates)) {
    throw new Error('wiki-only registry missing candidates[]');
  }

  const candidates = registry.candidates.map(projectCandidate);
  for (const candidate of candidates) {
    if (!CLASSIFICATIONS.includes(candidate.classification)) {
      throw new Error(
        `Invalid classification ${candidate.classification} for ${candidate.candidateKey}`,
      );
    }
  }

  const itemsManifest = registry.metadata?.itemsManifest ?? {};

  return {
    gameId: 'lol',
    batch: 'V2-Batch-G',
    generatedAt: new Date().toISOString(),
    projection: {
      role: 'wiki_registry_compatibility_projection',
      frozenPlanRev: FROZEN_PLAN_REV,
      canonicalInput: false,
      note: 'Historical Batch-G filename/schema surface only; G8 must read the wiki-only registry directly.',
      generatorPath: GENERATOR_REL,
    },
    source: {
      wikiOnlyMechanismCandidateRegistry: REGISTRY_REL,
      lolWikiCurrentChampionsGeneric: WIKI_CHAMPIONS_GENERIC_REL,
      lolWikiCurrentItemsNormalized: WIKI_ITEMS_NORMALIZED_REL,
      lolWikiCurrentItemsManifest: WIKI_ITEMS_MANIFEST_REL,
      itemsManifestRevid: itemsManifest.revid ?? null,
      itemsManifestContentSha256: itemsManifest.contentSha256 ?? null,
      registrySchemaVersion: registry.schemaVersion ?? null,
      registryFrozenPlanRev: registry.metadata?.frozenPlanRev ?? null,
    },
    dataPolicy: {
      numericTruthPrecedence: ['current_league_wiki_template_revision_only'],
      missingDataSource: 'league_wiki_template_revision_only',
      forbiddenMissingDataSources: [
        'screenshot',
        'training_ground_screenshot',
        'OCR',
        'data_dragon',
        'data_dragon_secondary',
      ],
      forbidDataDragonSecondary: true,
      wikiOnlyNumericTruth: true,
    },
    classificationValues: CLASSIFICATIONS,
    levelGate: {
      requiredStatsByLevelKeys: REQUIRED_STATS_BY_LEVEL_KEYS,
      rule:
        'Compatibility projection: level/rank gates are historical schema surface only; numeric truth is wiki-only registry provenance.',
    },
    summary: summarize(candidates),
    candidates,
  };
}

function validateAudit(audit) {
  const errors = [];

  if (audit?.projection?.canonicalInput === true) {
    errors.push('projection.canonicalInput must not be true (Batch-G is not G8 canonical input)');
  }
  if (!audit?.dataPolicy?.wikiOnlyNumericTruth) {
    errors.push('dataPolicy.wikiOnlyNumericTruth must be true');
  }
  if ((audit?.dataPolicy?.numericTruthPrecedence || []).includes('data_dragon_secondary')) {
    errors.push('dataPolicy must not include data_dragon_secondary');
  }
  if (!audit?.dataPolicy?.forbiddenMissingDataSources?.includes('screenshot')) {
    errors.push('dataPolicy must forbid screenshot/OCR missing-data sources');
  }
  if (!audit?.dataPolicy?.forbiddenMissingDataSources?.includes('data_dragon_secondary')) {
    errors.push('dataPolicy must forbid data_dragon_secondary');
  }

  const sourceBlob = JSON.stringify(audit?.source ?? {});
  if (citesForbiddenProvenance(sourceBlob) || /item\.json|champion\.json/i.test(sourceBlob)) {
    errors.push('source metadata must not cite DDragon/item.json/champion.json/OCR provenance');
  }
  if (!String(audit?.source?.wikiOnlyMechanismCandidateRegistry || '').includes(REGISTRY_REL)) {
    errors.push('source must point at wiki-only mechanism candidate registry');
  }

  for (const c of audit.candidates || []) {
    if (!c.candidateKey) {
      errors.push(`missing candidateKey @ ${c.ownerId}/${c.skillKey}/${c.passiveName}`);
    }
    if (!c.auditBaseline || typeof c.auditBaseline !== 'object') {
      errors.push(`missing auditBaseline @ ${c.candidateKey || c.passiveName}`);
    } else if (
      c.classification
      !== (c.auditBaseline.legacyClassification || c.classification)
    ) {
      errors.push(
        `classification != auditBaseline.legacyClassification @ ${c.candidateKey}`,
      );
    }

    if (citesForbiddenProvenance(c.sourceRef)) {
      errors.push(`forbidden provenance in sourceRef @ ${c.candidateKey}`);
    }
    if (/数据参考\/item\.json|数据参考\/champion(\/|\.json)/i.test(String(c.sourceRef || ''))) {
      errors.push(`DDragon path in sourceRef @ ${c.candidateKey}`);
    }
    for (const entry of c.needsUserData || []) {
      if (citesForbiddenProvenance(entry)) {
        errors.push(`needsUserData cites forbidden provenance @ ${c.candidateKey}`);
      }
    }
    if (citesForbiddenProvenance(c.blockedReason)) {
      errors.push(`blockedReason cites forbidden provenance @ ${c.candidateKey}`);
    }
  }

  const dravenQ = (audit.candidates || []).find(
    (c) => c.ownerId === 'hero_draven' && c.skillKey === 'Q' && c.passiveName === '旋转飞斧',
  );
  if (!dravenQ || dravenQ.classification !== 'already_covered') {
    errors.push('Draven Q 旋转飞斧 must remain already_covered under completed 1v1 scope');
  }

  const asheW = (audit.candidates || []).find(
    (c) => c.ownerId === 'hero_ashe' && c.skillKey === 'W' && c.passiveName === '万箭齐发',
  );
  if (!asheW || asheW.classification !== 'already_covered') {
    errors.push('Ashe W 万箭齐发 must be already_covered under completed Volley 1v1 scope (not ready_to_encode)');
  }

  const mag = (audit.candidates || []).find(
    (c) => c.ownerId === '2523' && c.passiveName === '高倍望远镜',
  );
  if (!mag || mag.classification !== 'already_covered') {
    errors.push('2523 高倍望远镜 must be already_covered under fixed-max 1.10 policy');
  }
  const arcane = (audit.candidates || []).find(
    (c) => c.ownerId === '2523' && c.passiveName === '奥术瞄准',
  );
  if (!arcane || arcane.classification !== 'out_of_scope_for_single_target_dps') {
    errors.push('2523 奥术瞄准 must be out_of_scope_for_single_target_dps (range-only)');
  }

  const ezrealP = (audit.candidates || []).find(
    (c) => c.ownerId === 'hero_ezreal' && c.skillKey === 'P' && c.passiveName === '咒能高涨',
  );
  if (
    !ezrealP
    || ezrealP.classification !== 'already_covered'
    || !(ezrealP.mechanismTags || []).includes('stacking_stat_modifier_on_hit')
    || !(ezrealP.mechanismTags || []).includes('attack_speed_percent_add')
  ) {
    errors.push(
      'Ezreal P 咒能高涨 must be already_covered under bounded 1v1 Rising Spell Force stacking AS scope (not needs_runtime_extension/ready_to_encode)',
    );
  }

  const kaisaP = (audit.candidates || []).find(
    (c) => c.ownerId === 'hero_kaisa' && c.skillKey === 'P' && c.passiveName === '体表活肤',
  );
  if (
    !kaisaP
    || kaisaP.classification !== 'already_covered'
    || !(kaisaP.mechanismTags || []).includes('on_hit')
    || !(kaisaP.mechanismTags || []).includes('stacking_plasma')
    || !(kaisaP.mechanismTags || []).includes('missing_health_consume')
  ) {
    errors.push(
      "Kai'Sa P 体表活肤 must be already_covered under completed Second Skin plasma/on-hit/missing-HP scope (not needs_runtime_extension/ready_to_encode)",
    );
  }

  const kindredP = (audit.candidates || []).find(
    (c) => c.ownerId === 'hero_kindred' && c.skillKey === 'P' && c.passiveName === '千珏之印',
  );
  if (
    !kindredP
    || kindredP.classification !== 'already_covered'
    || !(kindredP.mechanismTags || []).includes('attack_range_bonus')
    || !(kindredP.mechanismTags || []).includes('fixed_max_marks_phase_a')
    || !(kindredP.mechanismTags || []).includes('baked_qwe_mark_coefficients')
  ) {
    errors.push(
      'Kindred P 千珏之印 must be already_covered under fixed 25-mark Phase-A (not needs_runtime_extension/distance_based)',
    );
  }
  const kindredQ = (audit.candidates || []).find(
    (c) => c.ownerId === 'hero_kindred' && c.skillKey === 'Q' && c.passiveName === '乱箭之舞',
  );
  const kindredW = (audit.candidates || []).find(
    (c) => c.ownerId === 'hero_kindred' && c.skillKey === 'W' && c.passiveName === '狼灵狂热',
  );
  const kindredE = (audit.candidates || []).find(
    (c) => c.ownerId === 'hero_kindred' && c.skillKey === 'E' && c.passiveName === '横生惧意',
  );
  const kindredR = (audit.candidates || []).find(
    (c) => c.ownerId === 'hero_kindred' && c.skillKey === 'R' && c.passiveName === '羊灵生息',
  );
  if (!kindredQ || kindredQ.classification !== 'out_of_scope_for_single_target_dps') {
    errors.push('Kindred Q must remain out_of_scope_for_single_target_dps (probe must not upgrade)');
  }
  if (!kindredW || kindredW.classification !== 'out_of_scope_for_single_target_dps') {
    errors.push('Kindred W must remain out_of_scope_for_single_target_dps (probe must not upgrade)');
  }
  if (!kindredE || kindredE.classification !== 'needs_runtime_extension') {
    errors.push('Kindred E must remain needs_runtime_extension (probe must not upgrade)');
  }
  if (!kindredR || kindredR.classification !== 'out_of_scope_for_single_target_dps') {
    errors.push('Kindred R must remain out_of_scope_for_single_target_dps');
  }

  const terminus = (audit.candidates || []).find(
    (c) => c.ownerId === '3302' && c.passiveName === '晦影',
  );
  if (!terminus || terminus.classification !== 'ready_to_encode') {
    errors.push('3302 晦影 must remain intentional ready_to_encode=1 (do not close)');
  }

  const focusedWill = (audit.candidates || []).find(
    (c) => c.ownerId === '3161' && c.passiveName === '专注意志',
  );
  if (
    !focusedWill
    || focusedWill.classification !== 'already_covered'
    || /manual.?baseline|data dragon|ddragon/i.test(String(focusedWill.blockedReason || ''))
  ) {
    errors.push(
      '3161 专注意志 must be already_covered under Wiki-only Focused Will (not needs_manual_baseline/DDragon)',
    );
  }

  const nightstalker = (audit.candidates || []).find(
    (c) => c.ownerId === '3179' && c.passiveName === '夜行者',
  );
  if (
    !nightstalker
    || nightstalker.classification !== 'already_covered'
    || !(nightstalker.mechanismTags || []).includes('start_ready_true_on_hit')
    || !(nightstalker.mechanismTags || []).includes('armor_pen_flat_scaled_true')
  ) {
    errors.push(
      '3179 夜行者 must be already_covered under Wiki+Phase-A Nightstalker start-ready scope (not needs_runtime_extension)',
    );
  }
  const blackout = (audit.candidates || []).find(
    (c) => c.ownerId === '3179' && c.passiveName === '封锁',
  );
  if (!blackout || blackout.classification !== 'out_of_scope_for_single_target_dps') {
    errors.push('3179 封锁 must remain out_of_scope_for_single_target_dps');
  }

  const counts = audit.summary?.classificationCounts || {};
  for (const [k, v] of Object.entries(EXPECTED_CLASSIFICATION_COUNTS)) {
    if ((counts[k] || 0) !== v) {
      errors.push(`classificationCounts.${k} expected ${v}, got ${counts[k] || 0}`);
    }
  }
  if ((audit.summary?.candidateCount || 0) !== EXPECTED_CANDIDATE_COUNT) {
    errors.push(
      `candidateCount expected ${EXPECTED_CANDIDATE_COUNT}, got ${audit.summary?.candidateCount || 0}`,
    );
  }
  if ((audit.summary?.sourceKindCounts?.hero_skill || 0) !== EXPECTED_HERO) {
    errors.push(`hero_skill count expected ${EXPECTED_HERO}`);
  }
  if ((audit.summary?.sourceKindCounts?.item_passive || 0) !== EXPECTED_ITEM) {
    errors.push(`item_passive count expected ${EXPECTED_ITEM}`);
  }
  if ((audit.summary?.marksmanHeroCount || 0) !== EXPECTED_MARKSMAN_HEROES) {
    errors.push(`marksmanHeroCount expected ${EXPECTED_MARKSMAN_HEROES}`);
  }
  if ((audit.summary?.adcCompletedItemCount || 0) !== EXPECTED_ADC_ITEMS) {
    errors.push(`adcCompletedItemCount expected ${EXPECTED_ADC_ITEMS}`);
  }

  return errors;
}

function main() {
  const checkMode = process.argv.includes('--check');
  const audit = buildAudit();
  const errors = validateAudit(audit);
  if (errors.length) {
    console.error('self-check failed:');
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  if (checkMode) {
    if (!fs.existsSync(paths.auditJson)) {
      console.error('--check requires existing audit json');
      process.exit(1);
    }
    const existing = readJson(paths.auditJson);
    const existingErrors = validateAudit(existing);
    if (existingErrors.length) {
      console.error('existing json failed validation:');
      for (const e of existingErrors) console.error(`- ${e}`);
      process.exit(1);
    }
    if (!semanticEqual(existing, audit)) {
      console.error('--check failed: semantic content differs (ignoring generatedAt/EOL)');
      process.exit(1);
    }
    console.log('check ok');
    console.log(JSON.stringify({ summary: audit.summary }, null, 2));
    return;
  }

  writeJson(paths.auditJson, audit);
  console.log(JSON.stringify({
    auditJson: OUTPUT_REL,
    summary: audit.summary,
    projection: audit.projection,
  }, null, 2));
}

main();

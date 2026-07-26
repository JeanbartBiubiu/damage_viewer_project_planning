import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const RULE_SET_VERSION = 'generic-g8-v5-20260720';
const CLASSIFICATIONS = ['migrated', 'partial', 'blocked', 'out_of_scope'];

const paths = {
  inputJson: path.join(repoRoot, '最小验证', 'wiki-only-mechanism-candidate-registry.json'),
  outputJson: path.join(repoRoot, '最小验证', 'generic-g8-adc-passive-coverage-audit.json'),
  outputCsv: path.join(repoRoot, '最小验证', 'generic-g8-adc-passive-coverage-audit.csv'),
  generatorPath: path.join('最小验证', '数据', 'build-generic-g8-adc-passive-coverage-audit.mjs'),
  inputPath: path.join('最小验证', 'wiki-only-mechanism-candidate-registry.json'),
  identityManifestJson: path.join(
    repoRoot,
    '数据参考',
    'lol-wiki-current-champions',
    'identity-manifest.json',
  ),
  wikiGenericDir: path.join(
    repoRoot,
    '数据参考',
    'lol-wiki-current-champions',
    'normalized',
    'generic',
  ),
  wikiContractsJson: path.join(
    repoRoot,
    '数据参考',
    'lol-wiki-current-champions',
    'normalized',
    'reviewed-contracts.json',
  ),
};

const IDENTITY_MANIFEST_REL = '数据参考/lol-wiki-current-champions/identity-manifest.json';
const GENERIC_WIKI_REL = '数据参考/lol-wiki-current-champions/normalized/generic';
const WIKI_CONTRACTS_REL =
  '数据参考/lol-wiki-current-champions/normalized/reviewed-contracts.json';

/** Map Batch-G ownerId+skillKey → wiki reviewed-contract id. */
const WIKI_CONTRACT_BY_OWNER_SKILL = new Map([
  ['hero_ashe|Q', 'ashe-q'],
  ['hero_ashe|W', 'ashe-w'],
  ['hero_draven|Q', 'draven-q'],
  ['hero_graves|P', 'graves-p'],
  ['hero_akshan|P', 'akshan-p'],
  ['hero_akshan|E', 'akshan-e'],
  ['hero_kaisa|P', 'kaisa-p'],
  ['hero_ezreal|P', 'ezreal-p'],
]);

let _wikiContractsById = null;

function loadWikiContracts() {
  if (_wikiContractsById) return _wikiContractsById;
  _wikiContractsById = new Map();
  if (!fs.existsSync(paths.wikiContractsJson)) return _wikiContractsById;
  const doc = JSON.parse(fs.readFileSync(paths.wikiContractsJson, 'utf8'));
  for (const c of doc.contracts || []) {
    _wikiContractsById.set(c.id, c);
  }
  return _wikiContractsById;
}

function wikiContractForCandidate(candidate) {
  const pageId = wikiPageIdForCandidate(candidate);
  if (pageId) {
    const fromPage = loadWikiContracts().get(pageId);
    if (fromPage) return fromPage;
  }
  const legacyId = WIKI_CONTRACT_BY_OWNER_SKILL.get(`${candidate.ownerId}|${candidate.skillKey}`);
  if (!legacyId) return null;
  return loadWikiContracts().get(legacyId) || null;
}

function wikiSourceRef(contract) {
  return `${WIKI_CONTRACTS_REL}#${contract.id}@rev${contract.revisionId}`;
}

const PLACEHOLDER_SCALING_HINTS = {
  bonusattackdamage: 'bonus AD',
  attackdamage: 'AD',
  abilitypower: 'AP',
  bonusad: 'bonus AD',
  ad: 'AD',
  ap: 'AP',
  maxhealthdamage: 'max HP ratio',
  missinghealth: 'missing HP ratio',
  currenthealth: 'current HP ratio',
  totaldamage: 'AD/AP/bonus AD',
  netdamage: 'AD/AP/bonus AD',
  rmaindamage: 'AD/AP/bonus AD',
  calculateddamage: 'AD/AP/bonus AD',
  damagetodeal: 'AD/AP/bonus AD',
  damage: 'AD/AP/bonus AD',
};

let _identityByOwnerSkill = null;
let _identityByCandidateKey = null;
let _genericWikiCache = new Map();

function loadIdentityManifest() {
  if (_identityByOwnerSkill) return;
  _identityByOwnerSkill = new Map();
  _identityByCandidateKey = new Map();
  if (!fs.existsSync(paths.identityManifestJson)) return;
  const doc = JSON.parse(fs.readFileSync(paths.identityManifestJson, 'utf8'));
  for (const e of doc.entries || []) {
    _identityByOwnerSkill.set(`${e.ownerId}|${e.skillKey}`, e);
    if (e.candidateKey) _identityByCandidateKey.set(e.candidateKey, e);
  }
}

function wikiPageIdForCandidate(candidate) {
  loadIdentityManifest();
  const fromManifest = _identityByOwnerSkill.get(`${candidate.ownerId}|${candidate.skillKey}`);
  if (fromManifest?.pageId) return fromManifest.pageId;
  return WIKI_CONTRACT_BY_OWNER_SKILL.get(`${candidate.ownerId}|${candidate.skillKey}`) || null;
}

function loadGenericWiki(pageId) {
  if (!pageId) return null;
  if (_genericWikiCache.has(pageId)) return _genericWikiCache.get(pageId);
  const filePath = path.join(paths.wikiGenericDir, `${pageId}.json`);
  if (!fs.existsSync(filePath)) {
    _genericWikiCache.set(pageId, null);
    return null;
  }
  const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  _genericWikiCache.set(pageId, doc);
  return doc;
}

function wikiGenericSourceRef(doc) {
  return `${GENERIC_WIKI_REL}/${doc.pageId}.json@rev${doc.revisionId} sha256:${doc.contentSha256}`;
}

function wikiNumericSource(candidate) {
  const contract = wikiContractForCandidate(candidate);
  if (contract) {
    return { kind: 'reviewed', doc: contract, sourceRef: wikiSourceRef(contract) };
  }
  const pageId = wikiPageIdForCandidate(candidate);
  const generic = loadGenericWiki(pageId);
  if (generic) {
    return { kind: 'generic', doc: generic, sourceRef: wikiGenericSourceRef(generic) };
  }
  return null;
}

function wikiFieldBlob(doc) {
  if (!doc) return '';
  if (doc.fields && typeof doc.fields === 'object') {
    return Object.values(doc.fields).join('\n');
  }
  return '';
}

/** Required numeric-contract fields only; prose `notes` must not drive data gaps. */
const WIKI_REQUIRED_NUMERIC_FIELD_KEYS = [
  'leveling',
  'leveling2',
  'leveling3',
  'leveling4',
  'cooldown',
  'cost',
];

function wikiRequiredNumericBlob(doc) {
  if (!doc?.fields || typeof doc.fields !== 'object') return '';
  return WIKI_REQUIRED_NUMERIC_FIELD_KEYS.map((k) => String(doc.fields[k] || '')).join('\n');
}

function wikiHasExplicitUnknown(text) {
  // Bare "unknown" in notes/prose is not a numeric contract gap (e.g. Kayle Q patch history).
  return /precise formula is unknown|formula is unknown/i.test(String(text || ''));
}

function wikiHasTraceableNumericFormula(text) {
  return /\{\{(?:ap|pp|as|fd|#var:[a-z0-9_]+|#expr:)\|/i.test(String(text || ''));
}

function wikiClaimsDamage(text) {
  return /damage|伤害|处决|斩杀|true damage|magic damage|physical damage/i.test(String(text || ''));
}

function wikiClaimsBuffValues(text) {
  return /attack speed|攻速|bonus attack speed|攻击速度/i.test(String(text || ''));
}

function nonZeroEffectTables(effectValues) {
  const out = {};
  if (!effectValues || typeof effectValues !== 'object') return out;
  for (const [k, v] of Object.entries(effectValues)) {
    if (!Array.isArray(v)) continue;
    // e1..e10 keys are only available when the array has a real non-zero value.
    if (!v.some((x) => Number(x) !== 0)) continue;
    out[k] = v;
  }
  return out;
}

function extractTooltipPlaceholders(...texts) {
  const set = new Set();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  for (const text of texts) {
    let m;
    const s = String(text || '');
    while ((m = re.exec(s))) {
      let expr = m[1].trim().toLowerCase();
      expr = expr.replace(/^spell\.[^:]+:/, '');
      for (const tok of expr.split(/[^a-z0-9_]+/)) {
        if (!tok || /^\d+$/.test(tok)) continue;
        if (tok === 'spellmodifierdescriptionappend' || tok === 'spell') continue;
        set.add(tok);
      }
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'en'));
}

function isDamageLikePlaceholder(tok) {
  if (/damage|dmg/.test(tok)) return true;
  if (/(?:^|_)(?:ad|ap)(?:$|_)/.test(tok)) return true;
  if (/attackdamage|abilitypower|bonusad|bonusap/.test(tok)) return true;
  if (/health|hp/.test(tok) && /damage|ratio|percent|per/.test(tok)) return true;
  return false;
}

function scalingLabelForPlaceholder(tok) {
  if (PLACEHOLDER_SCALING_HINTS[tok]) return PLACEHOLDER_SCALING_HINTS[tok];
  if (/health|hp/.test(tok)) return 'HP ratio';
  if (/attackdamage|bonusad|(?:^|_)ad(?:$|_)/.test(tok)) return 'AD/bonus AD';
  if (/abilitypower|(?:^|_)ap(?:$|_)/.test(tok)) return 'AP';
  if (/attackspeed/.test(tok)) return 'attack speed';
  if (/armor|mr|magicresist/.test(tok)) return 'resist';
  return 'AD/AP/bonus AD/HP scaling';
}

function formatEffectTablesCompact(tables) {
  return Object.entries(tables)
    .map(([k, v]) => `${k}=[${v.join(',')}]`)
    .join('; ');
}

function emptyDataGapEvidence(partial = {}) {
  return {
    sourceVersion: partial.sourceVersion || '',
    sourceRef: partial.sourceRef || IDENTITY_MANIFEST_REL,
    availableEffectTables: {},
    availableCooldowns: [],
    availableCosts: {},
    tooltipPlaceholders: [],
    unresolvedDamagePlaceholders: [],
    varsMapEmpty: true,
    variablesEmpty: true,
    variables: [],
    missingFields: [],
    gapKind: 'none',
    reasonZh: '',
    blocker: '',
    ...partial,
  };
}

/**
 * Structured data-gap evidence for blocked hero skills.
 * Uses identity-manifest + reviewed-contracts or generic Wiki field maps.
 */
function buildHeroDataGapEvidence(candidate) {
  if (candidate.sourceKind !== 'hero_skill') {
    return emptyDataGapEvidence({ gapKind: 'not_hero_skill' });
  }

  if (candidate.ownerId === 'hero_yunara' && candidate.skillKey === 'R') {
    return yunaraRDataGapEvidence();
  }

  // Graves P Phase-A point-blank: Wiki reload unknown is a completed-boundary exclusion,
  // not a dataGapEvidence.missingFields driver.
  if (candidate.ownerId === 'hero_graves' && candidate.skillKey === 'P') {
    const wiki = wikiNumericSource(candidate);
    return emptyDataGapEvidence({
      sourceVersion: wiki ? `lol-wiki-rev-${wiki.doc.revisionId}` : '',
      sourceRef: wiki?.sourceRef || `${WIKI_CONTRACTS_REL}#graves-p`,
      missingFields: [],
      gapKind: 'none',
      reasonZh:
        'Graves P New Destiny Phase-A：贴脸合并弹丸伤害已闭环；Wiki 明确 unknown 的精确装填速度公式为 completed-boundary exclusion，不进入 dataGapEvidence.missingFields。',
      blocker: '',
      varsMapEmpty: false,
      variablesEmpty: false,
      variables: ['point_blank_pellet_formulas_wiki_explicit', 'reload_precise_formula_completed_boundary_exclusion'],
    });
  }

  const wiki = wikiNumericSource(candidate);
  if (!wiki) {
    return emptyDataGapEvidence({
      sourceRef: IDENTITY_MANIFEST_REL,
      missingFields: ['wiki_page_missing'],
      gapKind: 'wiki_page_missing',
      reasonZh:
        'identity-manifest 已登记该 hero skill，但 reviewed-contracts 与 normalized/generic 均缺可核验 pageId 快照',
      blocker: 'wiki_page_missing',
    });
  }

  const { doc, sourceRef, kind } = wiki;
  const sourceVersion = `lol-wiki-rev-${doc.revisionId}`;
  const blob = wikiFieldBlob(doc);
  const numericBlob = wikiRequiredNumericBlob(doc);
  const placeholders = extractTooltipPlaceholders(blob);
  const missingFields = [];
  let gapKind = 'none';
  let reasonZh = '';
  let blocker = '';

  if (wiki.kind === 'reviewed') {
    // Graves P handled by early return above; other reviewed contracts may still
    // carry blockedDataFields (e.g. Akshan delay ms).
    if (
      doc.id !== 'graves-p'
      && Array.isArray(doc.blockedDataFields)
      && doc.blockedDataFields.length
    ) {
      if (doc.id === 'akshan-p') {
        for (const f of doc.blockedDataFields) missingFields.push(f);
        if (missingFields.length) {
          gapKind = 'wiki_delay_ms_unpublished';
          reasonZh =
            'Akshan P Dirty Fighting：被动第二发 Wiki 写明 50% AD 且 after a delay，但 exact delay milliseconds 未公布；不得臆造 delay。';
          blocker = 'second_shot_exact_delay_ms_not_published';
        }
      } else {
        for (const f of doc.blockedDataFields) missingFields.push(f);
        if (missingFields.length) {
          gapKind = 'wiki_explicit_unknown';
          reasonZh = 'reviewed-contracts 标注未解析数值字段；保留 data gap。';
          blocker = 'reviewed_contract_blocked_data_fields';
        }
      }
    }
  }

  // Numeric-unknown detection uses required numeric fields only (not prose notes).
  if (missingFields.length === 0 && wikiHasExplicitUnknown(numericBlob)) {
    if (/reload|装填/i.test(numericBlob)) {
      missingFields.push('precise_reload_speed_formula');
      gapKind = 'wiki_explicit_unknown';
      reasonZh =
        'Wiki 明确标注 precise reload speed formula is unknown；保留 blocked_data。';
      blocker = 'wiki_explicit_unknown_precise_reload_speed_formula';
    } else {
      missingFields.push('wiki_explicit_unknown_numeric_contract');
      gapKind = 'wiki_explicit_unknown';
      reasonZh = 'Wiki 模板明确标注 unknown 的必填数值合同。';
      blocker = 'wiki_explicit_unknown_numeric_contract';
    }
  }

  const hasFormula = wikiHasTraceableNumericFormula(blob);
  if (
    missingFields.length === 0
    && wikiClaimsBuffValues(blob)
    && !hasFormula
  ) {
    missingFields.push('buff_rank_or_stack_values');
    gapKind = 'buff_numeric_contract';
    reasonZh = 'Wiki 状态/增益描述缺少可核验的攻速/时长/层数数值来源';
    blocker = 'missing_buff_numeric_contract';
  } else if (
    missingFields.length === 0
    && wikiClaimsDamage(blob)
    && !hasFormula
    && !wikiClaimsBuffValues(blob)
  ) {
    missingFields.push('passive_or_spell_damage_numeric_contract');
    gapKind = 'passive_numeric_contract';
    reasonZh = 'Wiki 描述声称伤害/额外伤害效果，但未提供可核验 {{ap|}}/{{pp|}} 公式';
    blocker = 'missing_damage_numeric_contract';
  }

  return emptyDataGapEvidence({
    sourceVersion,
    sourceRef,
    tooltipPlaceholders: placeholders,
    missingFields,
    gapKind,
    reasonZh:
      reasonZh
      || '当前 League Wiki 数值合同已齐或无可解析 data blocker；剩余为实现/runtime 缺口。',
    blocker,
  });
}

function item3097EnergizedDataGapEvidence() {
  return emptyDataGapEvidence({
    sourceVersion: 'lol-wiki-item-rev-4030984',
    sourceRef:
      '数据参考/lol-wiki-current-items/manifest.json@revid4030984;数据参考/lol-wiki-current-items/current-items.normalized.json#item_3097/effects.pass',
    missingFields: ['move_charge_rate', 'attack_charge_rate'],
    gapKind: 'status_charge_rate',
    reasonZh:
      '3097 盈能：本地 Wiki 仅写移动与普攻生成充能至 100，缺精确移动/普攻充能速率（非 Bolt 预充能伤害口径）',
    blocker: 'missing_precise_energize_move_and_attack_charge_rates_in_local_wiki',
  });
}

function yunaraRDataGapEvidence() {
  const rDoc = loadGenericWiki('yunara-r');
  const wDoc = loadGenericWiki('yunara-w');
  const sourceRef = rDoc
    ? wikiGenericSourceRef(rDoc)
    : `${GENERIC_WIKI_REL}/yunara-r.json`;
  const sourceVersion = rDoc ? `lol-wiki-rev-${rDoc.revisionId}` : 'wiki-generic-missing';
  const placeholders = extractTooltipPlaceholders(wikiFieldBlob(rDoc), wikiFieldBlob(wDoc));
  const missingFields = ['upgraded_arc_of_ruin_w_damage_formula'];
  return emptyDataGapEvidence({
    sourceVersion,
    sourceRef,
    tooltipPlaceholders: placeholders,
    missingFields,
    gapKind: 'unresolved_upgraded_arc_of_ruin_w_damage_formula',
    reasonZh:
      'Yunara R 定圣诀进入 Transcendent State 并将 W 升级为 Arc of Ruin；R 页仅给出 Arc of Ruin base damage（{{ap|160 to 480}}），本地 Wiki generic 缺 upgraded Arc of Ruin（W）完整伤害公式',
    blocker: 'missing_upgraded_arc_of_ruin_w_damage_formula',
  });
}

// Disabled: Graves P Phase-A no longer classifies Wiki reload-unknown as blocked_data.
// Kept as a no-op helper so historical call sites fail closed to empty missingFields.
function gravesPWikiDataGapEvidence(contract) {
  return emptyDataGapEvidence({
    sourceVersion: `lol-wiki-rev-${contract.revisionId}`,
    sourceRef: wikiSourceRef(contract),
    missingFields: [],
    gapKind: 'none',
    reasonZh:
      'Graves P New Destiny Phase-A：精确装填速度公式 Wiki unknown 为 completed-boundary exclusion；不再注入 blocked_data/missingFields。',
    blocker: '',
    availableEffectTables: {
      normalPellets: [4],
      critPellets: [6],
    },
    tooltipPlaceholders: [],
    unresolvedDamagePlaceholders: [],
    varsMapEmpty: false,
    variablesEmpty: false,
    variables: [
      'point_blank_pellet_formulas_wiki_explicit',
      'reload_precise_formula_completed_boundary_exclusion',
    ],
  });
}

function applyDataGapToBlockedClassification(candidate, classified) {
  if (classified.classification !== 'blocked') return classified;

  // Preserve precise evidence supplied by exact overrides (e.g. Yunara R cross-skill).
  if (
    classified.dataGapEvidence
    && Array.isArray(classified.dataGapEvidence.missingFields)
    && classified.dataGapEvidence.missingFields.length
  ) {
    return {
      ...classified,
      reason: classified.dataGapEvidence.reasonZh || classified.reason,
      remainingGap: classified.dataGapEvidence.reasonZh || classified.remainingGap,
    };
  }

  if (candidate.ownerId === '3097' && candidate.passiveName === '盈能') {
    const dataGapEvidence = item3097EnergizedDataGapEvidence();
    return {
      ...classified,
      reason: dataGapEvidence.reasonZh,
      remainingGap: dataGapEvidence.reasonZh,
      dataGapEvidence,
    };
  }

  // Current League Wiki outranks legacy Batch-B/OCR for all hero skills.
  const wiki = wikiNumericSource(candidate);
  if (wiki) {
    // Graves P: reviewed-contracts may still retain textual reload-unknown provenance,
    // but that must no longer drive blocked_data classification after Phase-A flip.
    if (
      wiki.kind === 'reviewed'
      && candidate.ownerId === 'hero_graves'
      && candidate.skillKey === 'P'
    ) {
      const dataGapEvidence = gravesPWikiDataGapEvidence(wiki.doc);
      return {
        ...classified,
        reason:
          classified.reason
          || 'Graves P Phase-A point-blank migrated；Wiki reload unknown 为 completed-boundary exclusion。',
        remainingGap: '',
        dataGapEvidence,
      };
    }
    if (wiki.kind === 'reviewed') {
      const contract = wiki.doc;
      if (
        contract.id !== 'graves-p'
        && (
          contract.numericContractStatus === 'partial_wiki_explicit_unknown_reload'
          || (Array.isArray(contract.blockedDataFields) && contract.blockedDataFields.length)
        )
      ) {
        const dataGapEvidence = gravesPWikiDataGapEvidence(contract);
        if (dataGapEvidence.missingFields.length) {
          return {
            ...classified,
            reason: dataGapEvidence.reasonZh,
            remainingGap: dataGapEvidence.reasonZh,
            dataGapEvidence,
          };
        }
      }
    }
    const dataGapEvidence = buildHeroDataGapEvidence(candidate);
    if (dataGapEvidence.missingFields.length) {
      return {
        ...classified,
        reason: dataGapEvidence.reasonZh,
        remainingGap: dataGapEvidence.reasonZh,
        dataGapEvidence,
      };
    }
    return {
      ...classified,
      reason:
        classified.reason
        || '当前 League Wiki 数值合同已齐；缺 runtime 表达能力（非 data blocker）。',
      remainingGap:
        classified.remainingGap
        || 'Wiki 数值合同已齐；缺 runtime 实现（非 data blocker）',
      dataGapEvidence: emptyDataGapEvidence({
        sourceVersion: dataGapEvidence.sourceVersion,
        sourceRef: dataGapEvidence.sourceRef,
        missingFields: [],
        gapKind: 'none',
        reasonZh:
          '当前 League Wiki 模板已提供可核验数值合同；剩余为实现/runtime 缺口。',
        blocker: '',
      }),
    };
  }

  if (candidate.sourceKind !== 'hero_skill') return classified;

  const dataGapEvidence = buildHeroDataGapEvidence(candidate);
  if (dataGapEvidence.missingFields.length) {
    return {
      ...classified,
      reason: dataGapEvidence.reasonZh,
      remainingGap: dataGapEvidence.reasonZh,
      dataGapEvidence,
    };
  }
  return {
    ...classified,
    reason: 'Wiki 数值合同已齐；缺 runtime 表达能力（非 data blocker）。',
    remainingGap: '无未解析 data 字段；缺 runtime 实现（非 data blocker）',
    dataGapEvidence,
  };
}

const SEED = {
  vayne: 'db/game_manage/seeds/lol_vayne_silver_bolts_seed.sql',
  formulaOnHit: 'db/game_manage/seeds/lol_formula_on_hit_mechanisms_seed.sql',
  adcItemOnHit: 'db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql',
  guinsoo: 'db/game_manage/seeds/lol_guinsoo_hk_seed.sql',
  spellblade: 'db/game_manage/seeds/lol_generic_spellblade_seed.sql',
  lichBaneSpellblade: 'db/game_manage/seeds/lol_generic_lich_bane_spellblade_seed.sql',
  essenceReaverSpellblade: 'db/game_manage/seeds/lol_generic_essence_reaver_spellblade_seed.sql',
  duskAndDawnSpellblade: 'db/game_manage/seeds/lol_generic_dusk_and_dawn_spellblade_seed.sql',
  energized: 'db/game_manage/seeds/lol_generic_energized_seed.sql',
  statikkShivEnergized: 'db/game_manage/seeds/lol_generic_statikk_shiv_energized_seed.sql',
  execute: 'db/game_manage/seeds/lol_generic_execute_threshold_seed.sql',
  linked: 'db/game_manage/seeds/lol_generic_linked_effects_seed.sql',
  crit: 'db/game_manage/seeds/lol_generic_crit_modifier_seed.sql',
  yunTalPracticeMakesLethal: 'db/game_manage/seeds/lol_generic_yun_tal_practice_makes_lethal_seed.sql',
  witsEndFray: 'db/game_manage/seeds/lol_generic_wits_end_fray_seed.sql',
  manamuneAwe: 'db/game_manage/seeds/lol_generic_manamune_awe_seed.sql',
  wikiReadyItems: 'db/game_manage/seeds/lol_generic_wiki_ready_items_seed.sql',
  twistedFateStackedDeck: 'db/game_manage/seeds/lol_generic_twisted_fate_stacked_deck_seed.sql',
  asheRangersFocusBackend: 'db/game_manage/seeds/lol_generic_ashe_rangers_focus_seed.sql',
  asheVolleyBackend: 'db/game_manage/seeds/lol_generic_ashe_volley_seed.sql',
  asheEnchantedCrystalArrowPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_ashe_enchanted_crystal_arrow_primary_hit_seed.sql',
  dravenSpinningAxeBackend: 'db/game_manage/seeds/lol_generic_draven_spinning_axe_seed.sql',
  pipelineDamageItemsBackend:
    'db/game_manage/seeds/lol_generic_pipeline_damage_items_seed.sql',
  kogmawCausticSpittleBackend: 'db/game_manage/seeds/lol_generic_kogmaw_caustic_spittle_seed.sql',
  kogmawVoidOozePrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_kogmaw_void_ooze_primary_hit_seed.sql',
  kogmawLivingArtilleryBackend:
    'db/game_manage/seeds/lol_generic_kogmaw_living_artillery_seed.sql',
  kaisaSuperchargeBackend: 'db/game_manage/seeds/lol_generic_kaisa_supercharge_seed.sql',
  kaisaVoidSeekerPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_kaisa_void_seeker_primary_hit_seed.sql',
  kaisaSecondSkinBackend: 'db/game_manage/seeds/lol_generic_kaisa_second_skin_seed.sql',
  dravenBloodRushBackend: 'db/game_manage/seeds/lol_generic_draven_blood_rush_seed.sql',
  dravenStandAsideBackend: 'db/game_manage/seeds/lol_generic_draven_stand_aside_seed.sql',
  teemoBlindingDartBackend: 'db/game_manage/seeds/lol_generic_teemo_blinding_dart_seed.sql',
  vayneCondemnPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_vayne_condemn_primary_hit_seed.sql',
  vayneFinalHourTimedBonusAdBackend:
    'db/game_manage/seeds/lol_generic_vayne_final_hour_timed_bonus_ad_seed.sql',
  quinnHeightenedSensesBackend:
    'db/game_manage/seeds/lol_generic_quinn_heightened_senses_seed.sql',
  quinnBlindingAssaultPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_quinn_blinding_assault_primary_hit_seed.sql',
  quinnVaultPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_quinn_vault_primary_hit_seed.sql',
  quinnHarrierPremarkedConsumeBackend:
    'db/game_manage/seeds/lol_generic_quinn_p_harrier_premarked_consume_seed.sql',
  xayahDeadlyPlumageBackend: 'db/game_manage/seeds/lol_generic_xayah_deadly_plumage_seed.sql',
  xayahDoubleDaggersPrimaryTwoHitBackend:
    'db/game_manage/seeds/lol_generic_xayah_double_daggers_primary_two_hit_seed.sql',
  xayahFeatherstormPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_xayah_featherstorm_primary_hit_seed.sql',
  jinxZapPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_jinx_zap_primary_hit_seed.sql',
  jhinDancingGrenadePrimaryFirstHitBackend:
    'db/game_manage/seeds/lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql',
  jhinDeadlyFlourishPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_jhin_deadly_flourish_primary_hit_seed.sql',
  caitlyn90CaliberNetPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql',
  kalistaPiercePrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_kalista_pierce_primary_hit_seed.sql',
  caitlynPiltoverPeacemakerFirstEnemyHitBackend:
    'db/game_manage/seeds/lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql',
  caitlynAceInTheHoleSingleBulletQuantumBackend:
    'db/game_manage/seeds/lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql',
  lucianPiercingLightSelectedTargetHitBackend:
    'db/game_manage/seeds/lol_generic_lucian_piercing_light_selected_target_hit_seed.sql',
  lucianArdentBlazePrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_lucian_ardent_blaze_primary_hit_seed.sql',
  lucianTheCullingSingleShotQuantumBackend:
    'db/game_manage/seeds/lol_generic_lucian_the_culling_single_shot_quantum_seed.sql',
  tristanaBusterShotPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_tristana_buster_shot_primary_hit_seed.sql',
  tristanaRapidFireTimedBonusAttackSpeedBackend:
    'db/game_manage/seeds/lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql',
  tristanaRocketJumpPrimaryLandingHitBackend:
    'db/game_manage/seeds/lol_generic_tristana_rocket_jump_primary_landing_hit_seed.sql',
  corkiPhosphorusBombPrimaryImpactBackend:
    'db/game_manage/seeds/lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql',
  kayleRadiantBlastBackend: 'db/game_manage/seeds/lol_generic_kayle_radiant_blast_seed.sql',
  gravesNewDestinyBackend: 'db/game_manage/seeds/lol_generic_graves_new_destiny_seed.sql',
  gravesQuickdrawMaxStackBackend:
    'db/game_manage/seeds/lol_generic_graves_quickdraw_max_stack_seed.sql',
  gravesSmokeScreenPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_graves_smoke_screen_primary_hit_seed.sql',
  gravesCollateralDamagePrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_graves_collateral_damage_primary_hit_seed.sql',
  gravesEndOfTheLineFirstOutboundPassBackend:
    'db/game_manage/seeds/lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql',
  sennaLastEmbraceFirstEnemyHitBackend:
    'db/game_manage/seeds/lol_generic_senna_last_embrace_first_enemy_hit_seed.sql',
  sennaDawningShadowPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_senna_dawning_shadow_primary_hit_seed.sql',
  ezrealRisingSpellForceBackend:
    'db/game_manage/seeds/lol_generic_ezreal_rising_spell_force_seed.sql',
  ezrealArcaneShiftPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_ezreal_arcane_shift_primary_hit_seed.sql',
  ezrealTrueshotBarragePrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql',
  ezrealMysticShotPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_ezreal_mystic_shot_primary_hit_seed.sql',
  akshanDirtyFightingBackend: 'db/game_manage/seeds/lol_generic_akshan_dirty_fighting_seed.sql',
  akshanAvengerangFirstOutboundHitBackend:
    'db/game_manage/seeds/lol_generic_akshan_avengerang_first_outbound_hit_seed.sql',
  twitchDeadlyVenomBackend: 'db/game_manage/seeds/lol_generic_twitch_deadly_venom_seed.sql',
  terminusJuxtapositionBackend:
    'db/game_manage/seeds/lol_generic_terminus_juxtaposition_seed.sql',
  firmament6699Backend: 'db/game_manage/seeds/lol_generic_firmament_6699_seed.sql',
  shapedCharge2520Backend: 'db/game_manage/seeds/lol_generic_shaped_charge_2520_seed.sql',
  focusedWill3161Backend: 'db/game_manage/seeds/lol_generic_focused_will_3161_seed.sql',
  nightstalker3179Backend: 'db/game_manage/seeds/lol_generic_nightstalker_3179_seed.sql',
  fiendhunterBolts2512Backend:
    'db/game_manage/seeds/lol_generic_fiendhunter_bolts_2512_seed.sql',
  experimentalHexplate3073Backend:
    'db/game_manage/seeds/lol_generic_experimental_hexplate_3073_seed.sql',
  sunderedSky6610Backend:
    'db/game_manage/seeds/lol_generic_sundered_sky_6610_seed.sql',
  yunTalFlurry3032Backend:
    'db/game_manage/seeds/lol_generic_yun_tal_flurry_3032_seed.sql',
  kindredMarkOfKindredMaxMarksBackend:
    'db/game_manage/seeds/lol_generic_kindred_mark_of_kindred_max_marks_seed.sql',
  varusBlightedQuiverBackend:
    'db/game_manage/seeds/lol_generic_varus_blighted_quiver_seed.sql',
  varusHailOfArrowsPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_varus_hail_of_arrows_primary_hit_seed.sql',
  varusChainOfCorruptionPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_varus_chain_of_corruption_primary_hit_seed.sql',
  twistedFateWildCardsPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_twisted_fate_wild_cards_primary_hit_seed.sql',
};

const WASM = {
  completedOnHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_completed_onhit_mechanisms_test.go',
  wikiReadyItems:
    'wasm/tinygo_engine_v2/internal/runtime/generic_wiki_ready_items_test.go',
  twistedFateStackedDeck:
    'wasm/tinygo_engine_v2/internal/runtime/generic_twisted_fate_stacked_deck_test.go',
  manamuneAwe: 'wasm/tinygo_engine_v2/internal/runtime/generic_manamune_awe_test.go',
  yunTalPracticeMakesLethal:
    'wasm/tinygo_engine_v2/internal/runtime/generic_yun_tal_practice_makes_lethal_test.go',
  spellblade: 'wasm/tinygo_engine_v2/internal/runtime/generic_spellblade_test.go',
  statikkShivEnergized:
    'wasm/tinygo_engine_v2/internal/runtime/generic_statikk_shiv_energized_test.go',
  witsEndFray: 'wasm/tinygo_engine_v2/internal/runtime/generic_wits_end_fray_test.go',
  energized: 'wasm/tinygo_engine_v2/internal/runtime/generic_energized_test.go',
  guinsooH: 'wasm/tinygo_engine_v2/internal/runtime/generic_guinsoo_h_test.go',
  guinsooK: 'wasm/tinygo_engine_v2/internal/runtime/generic_guinsoo_k_test.go',
  essenceReaverSpellblade:
    'wasm/tinygo_engine_v2/internal/runtime/generic_essence_reaver_spellblade_test.go',
  execute: 'wasm/tinygo_engine_v2/internal/runtime/generic_execute_test.go',
  asheRangersFocus:
    'wasm/tinygo_engine_v2/internal/runtime/generic_ashe_rangers_focus_test.go',
  asheVolley: 'wasm/tinygo_engine_v2/internal/runtime/generic_ashe_volley_test.go',
  asheEnchantedCrystalArrowPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_ashe_enchanted_crystal_arrow_primary_hit_test.go',
  dravenSpinningAxe:
    'wasm/tinygo_engine_v2/internal/runtime/generic_draven_spinning_axe_test.go',
  pipelineDamageModifier:
    'wasm/tinygo_engine_v2/internal/runtime/generic_pipeline_damage_modifier_test.go',
  kogmawCausticSpittle:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_caustic_spittle_test.go',
  kogmawVoidOozePrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_void_ooze_primary_hit_test.go',
  kogmawLivingArtillery:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_living_artillery_test.go',
  kogmawLivingArtilleryProviderStateCostGate:
    'wasm/tinygo_engine_v2/internal/runtime/generic_provider_state_cost_gate_test.go',
  kaisaSupercharge:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kaisa_supercharge_test.go',
  kaisaVoidSeekerPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kaisa_void_seeker_primary_hit_test.go',
  kaisaSecondSkin:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kaisa_second_skin_test.go',
  duskAndDawnSpellblade:
    'wasm/tinygo_engine_v2/internal/runtime/generic_dusk_and_dawn_spellblade_test.go',
  linkedEffects:
    'wasm/tinygo_engine_v2/internal/runtime/generic_linked_effects_test.go',
  dravenBloodRush:
    'wasm/tinygo_engine_v2/internal/runtime/generic_draven_blood_rush_test.go',
  dravenWAxeCatchReset:
    'wasm/tinygo_engine_v2/internal/runtime/generic_draven_w_axe_catch_reset_test.go',
  dravenStandAside:
    'wasm/tinygo_engine_v2/internal/runtime/generic_draven_stand_aside_test.go',
  teemoBlindingDart:
    'wasm/tinygo_engine_v2/internal/runtime/generic_teemo_blinding_dart_test.go',
  vayneCondemnPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_vayne_condemn_primary_hit_test.go',
  vayneFinalHourTimedBonusAd:
    'wasm/tinygo_engine_v2/internal/runtime/generic_vayne_final_hour_timed_bonus_ad_test.go',
  quinnHeightenedSenses:
    'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_heightened_senses_test.go',
  quinnBlindingAssaultPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_blinding_assault_primary_hit_test.go',
  quinnVaultPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_vault_primary_hit_test.go',
  quinnHarrierPremarkedConsume:
    'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_harrier_premarked_consume_test.go',
  xayahDeadlyPlumage:
    'wasm/tinygo_engine_v2/internal/runtime/generic_xayah_deadly_plumage_test.go',
  xayahDoubleDaggersPrimaryTwoHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_xayah_double_daggers_primary_two_hit_test.go',
  xayahFeatherstormPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_xayah_featherstorm_primary_hit_test.go',
  jinxZapPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_jinx_zap_primary_hit_test.go',
  jhinDancingGrenadePrimaryFirstHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_jhin_dancing_grenade_primary_first_hit_test.go',
  jhinDeadlyFlourishPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_jhin_deadly_flourish_primary_hit_test.go',
  caitlyn90CaliberNetPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_caitlyn_90_caliber_net_primary_hit_test.go',
  kalistaPiercePrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kalista_pierce_primary_hit_test.go',
  caitlynPiltoverPeacemakerFirstEnemyHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_caitlyn_piltover_peacemaker_first_enemy_hit_test.go',
  caitlynAceInTheHoleSingleBulletQuantum:
    'wasm/tinygo_engine_v2/internal/runtime/generic_caitlyn_ace_in_the_hole_single_bullet_quantum_test.go',
  lucianPiercingLightSelectedTargetHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_lucian_piercing_light_selected_target_hit_test.go',
  lucianArdentBlazePrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_lucian_ardent_blaze_primary_hit_test.go',
  lucianTheCullingSingleShotQuantum:
    'wasm/tinygo_engine_v2/internal/runtime/generic_lucian_the_culling_single_shot_quantum_test.go',
  tristanaBusterShotPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_tristana_buster_shot_primary_hit_test.go',
  tristanaRapidFireTimedBonusAttackSpeed:
    'wasm/tinygo_engine_v2/internal/runtime/generic_tristana_rapid_fire_timed_bonus_attack_speed_test.go',
  tristanaRocketJumpPrimaryLandingHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_tristana_rocket_jump_primary_landing_hit_test.go',
  corkiPhosphorusBombPrimaryImpact:
    'wasm/tinygo_engine_v2/internal/runtime/generic_corki_phosphorus_bomb_primary_impact_test.go',
  kayleRadiantBlast:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kayle_radiant_blast_test.go',
  gravesNewDestiny:
    'wasm/tinygo_engine_v2/internal/runtime/generic_graves_new_destiny_test.go',
  gravesQuickdrawMaxStack:
    'wasm/tinygo_engine_v2/internal/runtime/generic_graves_quickdraw_max_stack_test.go',
  gravesSmokeScreenPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_graves_smoke_screen_primary_hit_test.go',
  gravesCollateralDamagePrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_graves_collateral_damage_primary_hit_test.go',
  gravesEndOfTheLineFirstOutboundPass:
    'wasm/tinygo_engine_v2/internal/runtime/generic_graves_end_of_the_line_first_outbound_pass_test.go',
  sennaLastEmbraceFirstEnemyHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_senna_last_embrace_first_enemy_hit_test.go',
  sennaDawningShadowPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_senna_dawning_shadow_primary_hit_test.go',
  ezrealRisingSpellForce:
    'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_rising_spell_force_test.go',
  ezrealArcaneShiftPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_arcane_shift_primary_hit_test.go',
  ezrealTrueshotBarragePrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_trueshot_barrage_primary_hit_test.go',
  ezrealMysticShotPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_mystic_shot_primary_hit_test.go',
  akshanDirtyFighting:
    'wasm/tinygo_engine_v2/internal/runtime/generic_akshan_dirty_fighting_test.go',
  akshanAvengerangFirstOutboundHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_akshan_avengerang_first_outbound_hit_test.go',
  twitchDeadlyVenom:
    'wasm/tinygo_engine_v2/internal/runtime/generic_twitch_deadly_venom_test.go',
  terminusJuxtaposition:
    'wasm/tinygo_engine_v2/internal/runtime/generic_terminus_juxtaposition_test.go',
  firmament6699:
    'wasm/tinygo_engine_v2/internal/runtime/generic_firmament_6699_test.go',
  shapedCharge2520:
    'wasm/tinygo_engine_v2/internal/runtime/generic_shaped_charge_2520_test.go',
  focusedWill3161:
    'wasm/tinygo_engine_v2/internal/runtime/generic_focused_will_3161_test.go',
  nightstalker3179:
    'wasm/tinygo_engine_v2/internal/runtime/generic_nightstalker_3179_test.go',
  fiendhunterBolts2512:
    'wasm/tinygo_engine_v2/internal/runtime/generic_fiendhunter_bolts_2512_test.go',
  experimentalHexplate3073:
    'wasm/tinygo_engine_v2/internal/runtime/generic_experimental_hexplate_3073_test.go',
  sunderedSky6610:
    'wasm/tinygo_engine_v2/internal/runtime/generic_sundered_sky_6610_test.go',
  yunTalFlurry3032:
    'wasm/tinygo_engine_v2/internal/runtime/generic_yun_tal_flurry_3032_test.go',
  kindredMarkOfKindredMaxMarks:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kindred_mark_of_kindred_max_marks_test.go',
  varusBlightedQuiver:
    'wasm/tinygo_engine_v2/internal/runtime/generic_varus_blighted_quiver_test.go',
  varusHailOfArrowsPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_varus_hail_of_arrows_primary_hit_test.go',
  varusChainOfCorruptionPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_varus_chain_of_corruption_primary_hit_test.go',
  twistedFateWildCardsPrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_twisted_fate_wild_cards_primary_hit_test.go',
};

const COMPLETED_ONHIT_COMMIT = '3314c24';

function evidence(evidenceType, taskKey, sourcePath, note, sourceWorktree = 'backend') {
  const pathValue = sourcePath || '';
  return {
    evidenceType,
    taskKey: taskKey || '',
    sourcePath: pathValue,
    // sourcePath is resolvable only with an explicit worktree qualifier (backend|wasm)
    sourceWorktree: pathValue ? sourceWorktree : '',
    note: note || '',
  };
}

function siblingWorktreeRoots() {
  const parent = path.resolve(repoRoot, '..');
  return {
    backend: [repoRoot, path.join(parent, 'damage_backend_dev')],
    wasm: [repoRoot, path.join(parent, 'damage_wasm_dev')],
  };
}

function evidenceSourcePathExists(sourceWorktree, sourcePath) {
  const rel = String(sourcePath || '').replace(/\\/g, '/');
  if (!rel) return false;
  const roots = siblingWorktreeRoots()[sourceWorktree];
  if (!roots) return false;
  return roots.some((root) => fs.existsSync(path.join(root, ...rel.split('/'))));
}

function isGenericWasmTestPath(sourcePath) {
  const base = path.posix.basename(String(sourcePath || '').replace(/\\/g, '/'));
  return /^generic_.+_test\.go$/i.test(base);
}

function isBackendSeedPath(sourcePath) {
  const rel = String(sourcePath || '').replace(/\\/g, '/');
  return /^db\/game_manage\/seeds\/.+\.sql$/i.test(rel);
}

/** Strict bilateral gate for migrated/partial (and unified completed/partial). */
function validateBilateralCoverageEvidence(key, coverageEvidence, errors, opts = {}) {
  const ev = Array.isArray(coverageEvidence) ? coverageEvidence : [];
  const requireCompletedBoundary = opts.requireCompletedBoundary === true;
  const forbidLegacyLane = opts.lane === 'legacy_single_attacker_dps';

  if (forbidLegacyLane) {
    errors.push(`legacy_single_attacker_dps cannot serve as completion evidence @ ${key}`);
  }

  for (const e of ev) {
    if (!String(e.sourcePath || '').trim()) {
      errors.push(`empty evidence sourcePath @ ${key}`);
    }
  }

  const backend = ev.filter((e) => e.sourceWorktree === 'backend');
  const wasm = ev.filter((e) => e.sourceWorktree === 'wasm');
  if (!backend.length) {
    errors.push(`missing backend seed evidence @ ${key}`);
  }
  if (!wasm.length) {
    errors.push(`missing wasm generic *_test.go evidence @ ${key}`);
  }

  for (const e of backend) {
    if (!isBackendSeedPath(e.sourcePath)) {
      errors.push(`backend evidence must be db/game_manage/seeds/*.sql @ ${key}: ${e.sourcePath}`);
    } else if (!evidenceSourcePathExists('backend', e.sourcePath)) {
      errors.push(`backend seed path not found @ ${key}: ${e.sourcePath}`);
    }
  }
  for (const e of wasm) {
    if (!isGenericWasmTestPath(e.sourcePath)) {
      errors.push(`wasm evidence must be generic *_test.go @ ${key}: ${e.sourcePath}`);
    } else if (!evidenceSourcePathExists('wasm', e.sourcePath)) {
      errors.push(`wasm test path not found @ ${key}: ${e.sourcePath}`);
    }
  }

  if (requireCompletedBoundary) {
    for (const e of ev) {
      if (!/completedBoundary/i.test(String(e.note || ''))) {
        errors.push(`partial evidence note missing completedBoundary @ ${key} (${e.sourcePath})`);
      }
    }
  }
}

/** exact override: ownerId+skillKey or ownerId+passiveName */
const EXACT_OVERRIDES = new Map([
  [
    'hero_vayne|E',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'ability_flat_bonus_ad_damage',
        'active_physical_damage',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_vayne E 恶魔审判/Condemn：Wiki rev4008541（SHA256 f2b2ba17b90ff5096a9a154f8d1fd4cc43ed3e1be4ebb502cb644acf17712c37；normalized/generic/vayne-e.json）rank5 Phase-A v1 已由 wasm-generic-vayne-condemn-primary-hit 闭环为 migrated——90 mana / 12000ms CD；immediate primary-target scaffold；恰好一次 non-crit/non-copyable physical damage 190+0.50*(source.attr.ad.resolved-source.attr.ad.base)（交叉校验 baseAD60 / resolvedAD140 / bonusAD80 → raw230，armor100 → mitigated115）。Attempts t0/t11999/t12000 → two successes + exactly one cooldown skip without mana/damage；final mana 52 from 232。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile。明确排除 knockback/displacement475/direction、terrain 或玩家生成地形碰撞、wall bonus 285+0.75bAD 与 total 475+1.25bAD、stun/control1.5s、cast0.25/effect-at-cast-end、projectile/missile speeds2200/2000/range550/geometry/cancel、ranks1–4、Silver Bolts/basic/on-hit/equipment/loadout coupling、multi-target/repeat、live migration/publish/E2E；不宣称 wall/terrain/CC/cast/projectile/完整游戏保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-vayne-condemn-primary-hit',
          WASM.vayneCondemnPrimaryHit,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile; Wiki rev4008541/SHA256 f2b2ba17… rank5 90 mana/12000ms CD / one physical 190+0.50*bonusAD; baseAD60/resolvedAD140/bonusAD80→raw230/armor100→115; t0/t11999/t12000 two successes + one CD skip; final mana52; knockback/terrain/wall/stun/cast/projectile/multitarget/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-vayne-condemn-primary-hit',
          SEED.vayneCondemnPrimaryHitBackend,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile; backend lol_generic_vayne_condemn_primary_hit_seed.sql + LolGenericVayneCondemnPrimaryHitSeedSqlTest (owning e7d28f6; integrated 61290cb); not live published',
        ),
      ],
    },
  ],
  [
    'hero_vayne|R',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'cast_triggered_timed_bonus_ad',
        'flat_ad_add',
        'timed_provider_state',
      ],
      reason:
        'hero_vayne R 终极时刻/Final Hour：Wiki request Template:Data Vayne/R → resolved Template:Data Vayne/Final Hour；page1309991 / rev3807995 / timestamp 2024-11-05T22:07:10Z / canonical bytes2015 / SHA256 e417f1cfc5e8253fdfe8140c4659e8fe63441c38ca3aa1e37d69aa31e25d682d（normalized/generic/vayne-r.json）rank3 Phase-A v2 已由 wasm-generic-vayne-final-hour-timed-bonus-ad 闭环为 migrated——local raw caveat bytes2012 / SHA 343d19e30f0edf70359f122abb2c6c8e7d2d16d5e4c6db46416428d72e7c7642（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；80 mana / 70000ms CD；+65 AD for 12000ms via direct provider-scope override state_change，zero listeners/ability-start scaffold；fixture AD60→125→60；armor100 probe raw/mitigated125/62.5 then60/30；R has no damage。Attempts t0/t69999/t70000 → two successes + exactly one cooldown skip without cost/state write；mana300→140；second success re-arms state。completedBoundary：rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement。明确排除 Night Hunter movement speed/direction、Tumble cooldown/cast/dash/reset、invisibility/stealth、takedown/qualification/extension/cap、animations/projectiles、ranks1–2、Vayne P/Q/W/E/basic/Silver Bolts/Condemn、loadout/items/runes、direct R damage/target effects、live migration/publish/E2E/full fidelity；不宣称 Night Hunter/Tumble/stealth/takedown/完整游戏保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-vayne-final-hour-timed-bonus-ad',
          WASM.vayneFinalHourTimedBonusAd,
          'completedBoundary: rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement; Wiki request Template:Data Vayne/R → Final Hour; rev3807995/SHA256 e417f1cf… / bytes2015; local raw caveat bytes2012/SHA 343d19e3… no equivalence claim; rank3 80 mana/70000ms CD / +65 AD 12000ms direct provider-scope override state_change zero listeners/ability-start; AD60→125→60; armor100 probe 125/62.5 then60/30; R no damage; t0/t69999/t70000 two successes + one CD skip without cost/state write; mana300→140; second success re-arms; Night Hunter/Tumble/stealth/takedown/animation/ranks1-2/P-Q-W-E/basic/Silver Bolts/Condemn/loadout/items/runes/direct R damage/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-vayne-final-hour-timed-bonus-ad',
          SEED.vayneFinalHourTimedBonusAdBackend,
          'completedBoundary: rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement; backend lol_generic_vayne_final_hour_timed_bonus_ad_seed.sql + LolGenericVayneFinalHourTimedBonusAdSeedSqlTest (owning 4440c3d + stable-key correction 8eb9f2a; integrated 2710647 + correction 18dbff1); Wasm exact test commit 3a35a95; not live published',
        ),
      ],
    },
  ],
  [
    'hero_vayne|W',
    {
      classification: 'migrated',
      tags: ['every_n_hit', 'true_damage', 'formula_on_hit'],
      reason:
        '精确 candidate 已有 generic seed，且 generic_completed_onhit_mechanisms_test.go（commit 3314c24）CompileGeneric+RunGeneric 闭环主目标 every-3rd true on-hit。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-completed-onhit-mechanisms',
          WASM.completedOnHit,
          `Vayne W Silver Bolts main-target every-3rd true max(6% maxHP,50); commit ${COMPLETED_ONHIT_COMMIT}`,
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-vayne-silver-bolts',
          SEED.vayne,
          'backend lol_vayne_silver_bolts_seed.sql provider/mount; not claiming live publish',
        ),
      ],
    },
  ],
  [
    'hero_varus|W',
    {
      classification: 'migrated',
      tags: [
        'passive_on_hit_magic',
        'target_blight_stack_consume',
        'active_missing_health',
        'w_scoped_max_charge_carrier',
      ],
      reason:
        'hero_varus W 枯萎箭袋/Blighted Quiver：Wiki rev4026472（SHA256 16307174c4039d8ce71e639396328b2473f4a7e16247a7b2f8a183599b0901d2；normalized/generic/varus-w.json）rank5 Phase-A v2 已由 wasm-generic-varus-blighted-quiver 闭环为 migrated——被动 on-hit magic 40+0.15*bonusAD+0.25*AP 后 target blight_stacks+=1（max3/6000ms refresh_on_write）；W active 武装 blighted_quiver_active max1/5500ms；W-scoped Q max-charge ordering carrier（scaffold only）顺序：Q physical → W active missing-HP（post-Q/pre-Blight）→ Blight detonation×1.5 → conditional blight/active reset。completedBoundary：fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop。明确排除 ranks1–4、可变 Q 充能、真实 Q mana/CD/channel/projectile/多目标、W CD/recast、blight CDR refund、equipment/Guinsoo interop、monster caps、live migration/publish/E2E；不宣称真实 Q key 完成或完整游戏保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-varus-blighted-quiver',
          WASM.varusBlightedQuiver,
          'completedBoundary: fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop; exact CompileGeneric+RunGeneric (commit d6f2ea5); not claiming real Q key completion/full-game fidelity',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-varus-blighted-quiver',
          SEED.varusBlightedQuiverBackend,
          'completedBoundary: fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop; backend lol_generic_varus_blighted_quiver_seed.sql (owning ca8809d; integrated 5b2a18e); not live published',
        ),
      ],
    },
  ],
  [
    'hero_varus|E',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_varus E 恶灵箭雨/Hail of Arrows：Wiki rev3969402（SHA256 7b4be71bcc26ba933dff0235882d272c14e406abbf505290018ba15a5ba658e9；normalized/generic/varus-e.json）rank5 Phase-A v1 已由 wasm-generic-varus-hail-of-arrows-primary-hit 闭环为 migrated——90 mana / 10000ms CD；immediate primary-target scaffold（明确排除而非建模 Wiki 0.5s landing delay）；恰好一次 non-crit/non-copyable physical damage 180+0.90*(source.attr.ad.resolved-source.attr.ad.base)（交叉校验 baseAD59 / resolvedAD159 → raw270，armor100 → mitigated135）。Attempts t0/t9999/t10000 → two successes + exactly one cooldown skip without mana/damage；final mana 140 from 320。同修订 description + labeled rank table 明示 physical damage 60 to 180 (+90% bonus AD)；孤立 damagetype=Magic 为矛盾源元数据——reviewed 政策以 description+rank table 管辖本有界 physical 分支，绝不将 Magic 作 runtime 真值。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation。明确排除 cast0.2419/landing0.5/travel timing、target-location/projectile/range925/radius300/collision/geometry、all-enemies/multi-target/repeat、four-second field、slow30–50%/0.25s linger、Grievous Wounds、all Blighted Quiver stack consumption/~0.3s second detonation/W/Q/basic/on-hit coupling、ranks1–4、equipment/loadout、live/publish/E2E/full fidelity；不宣称 delay/area/field/control/W-detonation 保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-varus-hail-of-arrows-primary-hit',
          WASM.varusHailOfArrowsPrimaryHit,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation; Wiki rev3969402/SHA256 7b4be71b… rank5 90 mana/10000ms CD / one physical 180+0.90*bonusAD; baseAD59/resolvedAD159→raw270/armor100→135; t0/t9999/t10000 two successes + one CD skip; final mana140; description+rank-table physical authority; isolated damagetype=Magic contradictory metadata (not runtime truth); immediate scaffold excludes Wiki 0.5s landing delay; landing/geometry/multitarget/field/slow/GW/W-detonation/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-varus-hail-of-arrows-primary-hit',
          SEED.varusHailOfArrowsPrimaryHitBackend,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation; backend lol_generic_varus_hail_of_arrows_primary_hit_seed.sql + LolGenericVarusHailOfArrowsPrimaryHitSeedSqlTest (owning a08cdfd; integrated e924afd); not live published',
        ),
      ],
    },
  ],
  [
    'hero_varus|R',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_varus R 腐败锁链/Chain of Corruption：Wiki rev4008213（SHA256 62b397cc7133a767427e00a1a5b435fcb3fd94b4ec5021be4a7869837683e4ed；normalized/generic/varus-r.json）rank3 Phase-A v1 已由 wasm-generic-varus-chain-of-corruption-primary-hit 闭环为 migrated——100 mana / 60000ms CD；immediate primary-champion scaffold（明确排除而非建模 Wiki 未指定 cast delay 与 Effect at cast time end）；恰好一次 non-crit/non-copyable magic damage 350+1.00*source.attr.ap.resolved（交叉校验 AP200 → raw550，target MR100 → mitigated275）。Attempts t0/t59999/t60000 → two successes + exactly one cooldown skip without mana/damage；final mana 100 from 300；HP 1000→450。completedBoundary：rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget。明确排除 unspecified cast delay/Effect-at-cast-time-end、projectile/travel/speed/collision/global geometry/direction/facing/interception/spellshield/untargetable、root/reveal/tenacity/cleanse/CC immunity、Blight creation and 0.65/1.2/1.75 schedule/rank0/W coupling/detonation/state、tendril ground anchor/0.25 seeking/range/area/secondary/repeat/spread/multitarget、ranks1–2、P/Q/W/E/basic/loadout、live/publish/E2E/full fidelity；不宣称 cast/projectile/geometry/direction/root/reveal/Blight/tendril/seek/spread/multitarget 保真。Backend seed 显式依赖 Batch-B identity/AP check-only 前置，并自包含 ensure mana 定义与 hero_varus mana320/320；不写 games/game_entities/attribute_definitions/entity_attribute_values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-varus-chain-of-corruption-primary-hit',
          WASM.varusChainOfCorruptionPrimaryHit,
          'completedBoundary: rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget; Wiki rev4008213/SHA256 62b397cc… rank3 100 mana/60000ms CD / one magic 350+1.00*AP; AP200→raw550/MR100→275; t0/t59999/t60000 two successes + one CD skip; final mana100/HP450; immediate scaffold excludes unspecified cast delay and Effect at cast time end; cast/projectile/travel/collision/geometry/direction/root/reveal/Blight/tendril/seek/spread/multitarget/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-varus-chain-of-corruption-primary-hit',
          SEED.varusChainOfCorruptionPrimaryHitBackend,
          'completedBoundary: rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget; backend lol_generic_varus_chain_of_corruption_primary_hit_seed.sql + LolGenericVarusChainOfCorruptionPrimaryHitSeedSqlTest (owning 067b0f8; integrated 982145c); Wasm exact test commit 74f3b22; Batch-B identity/AP check-only prerequisites + self-contained ensure mana definition/hero_varus mana320/320 (does not write games/game_entities/attribute_definitions/entity_attribute_values); not live published',
        ),
      ],
    },
  ],
  [
    'hero_kogmaw|Q',
    {
      classification: 'migrated',
      tags: [
        'attack_speed_percent_add',
        'active_magic_damage',
        'armor_mr_percent_shred',
        'ability_cost_cooldown',
      ],
      reason:
        'hero_kogmaw Q 腐蚀唾液/Caustic Spittle Wiki rev3960434（SHA256 f651035612e1deeda77df641f5a0e21226ec74aeb4633e0f211780efc3f39a7d）rank5 口径已由 wasm-generic-kogmaw-caustic-spittle 闭环：被动常驻 +25% AS；主动 260+0.90*AP 魔法伤害（cast-time-start 先伤后击碎）；provider-target kogmaw_q_resist_reduction 4000ms refresh_on_write → opponent armor/MR percent_add −32%；40 mana / 7000ms CD。明确排除弹道飞行/目标选择、rank1–4、多目标/web，故标 migrated。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-kogmaw-caustic-spittle',
          WASM.kogmawCausticSpittle,
          'completedBoundary: Wiki rev3960434 rank5 passive +25% AS + active 260+0.90AP magic / 32% armor+MR shred 4000ms / 40 mana / 7000ms CD; damage-before-state; excluded projectile travel/target selection/rank1-4/multitarget/web',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-kogmaw-caustic-spittle',
          SEED.kogmawCausticSpittleBackend,
          'completedBoundary: provider_hero_kogmaw_caustic_spittle seed/mount path retained; active Q proven via wasm CompileGeneric+RunGeneric; backend lol_generic_kogmaw_caustic_spittle_seed.sql; not live published',
        ),
      ],
    },
  ],
  [
    'hero_kogmaw|E',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        "hero_kogmaw E 虚空淤泥/Void Ooze：Wiki rev3965135（SHA256 1dd448ea1985237f002dec43e2bf93d860eb976f7c98e75883254cb3cf70794b；normalized/generic/kogmaw-e.json）rank5 Phase-A v1 已由 wasm-generic-kogmaw-void-ooze-primary-hit 闭环为 migrated——100 mana / 12000ms CD；immediate primary-target scaffold（Wiki Effect at cast time start 与 scaffold 兼容，无假 cast-delay phase）；恰好一次 non-crit/non-copyable magic damage 230+0.65*source.attr.ap.resolved（交叉校验 AP100 → raw295，target MR100 → mitigated147.5）。Attempts t0/t11999/t12000 → two successes + exactly one cooldown skip without mana/damage；final mana 125 from 325。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration。明确排除 target-direction missile/projectile/travel/collision/path/range/width/speed/geometry、all-enemies/multi-target/repeated hits、ooze field/path blobs/every125 units/3s duration、slow60%/0.25s ticks/linger、cast timing beyond scaffold、ranks1–4、basic/W/Q/on-hit/equipment/loadout coupling、live/publish/E2E/full fidelity；不宣称 line/area/field/slow/projectile 保真。",
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-kogmaw-void-ooze-primary-hit',
          WASM.kogmawVoidOozePrimaryHit,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration; Wiki rev3965135/SHA256 1dd448ea… rank5 100 mana/12000ms CD / one magic 230+0.65*AP; AP100→raw295/MR100→147.5; t0/t11999/t12000 two successes + one CD skip; final mana125; Effect at cast time start compatible with scaffold; projectile/geometry/multitarget/slow/field/duration/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-kogmaw-void-ooze-primary-hit',
          SEED.kogmawVoidOozePrimaryHitBackend,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration; backend lol_generic_kogmaw_void_ooze_primary_hit_seed.sql + LolGenericKogmawVoidOozePrimaryHitSeedSqlTest (owning b1752e4; integrated 24c1ddf); not live published',
        ),
      ],
    },
  ],
  [
    'hero_kogmaw|R',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'bonus_ad_and_ap_ratio',
        'missing_health_damage_multiplier',
        'stack_escalating_mana_cost',
        'timed_provider_state',
      ],
      reason:
        "hero_kogmaw R 活体大炮/Living Artillery：Wiki request Template:Data Kog'Maw/R → resolved Template:Data Kog'Maw/Living Artillery；page1307963 / rev4007636 / timestamp 2026-04-12T08:34:32Z / canonical bytes2453 / SHA256 32f8dd8d875aaf95cec2be9cfe4a5a5526881b956f2f23e06ab87dc331ca8641（normalized/generic/kogmaw-r.json）rank3 Phase-A v2 已由 wasm-generic-kogmaw-living-artillery 闭环为 migrated——local raw caveat bytes2452 / SHA 11db6c16391dcbfa2c091e81399bff4b2a0abffcd468f71ea5e9d89759d5e447（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；mana cost 40*(1+living_artillery_stacks) / 1000ms CD；immediate primary-target scaffold；zero listeners/ability-start dependency；base magic 180+0.75*(resolvedAD-baseAD)+0.45*AP；missing-health multiplier 1+min(0.5,(5/6)*missingFraction) at/above 40% current HP，exactly 2 below 40%；fixture baseAD61/resolvedAD141/AP100 → base285；maxHP1000/MR100：current1000 raw285/mitigated142.5；current400 raw427.5/mitigated213.75；current399 raw570/mitigated285。Schedule：t0/t999/t1000 mana500 → two successes + one cooldown skip，costs40 then80，final mana380/state2；mana119 → first cost40 then resource skip，final mana79/state1/no second damage/write；ten successes cost40..400 total2200 cap9；8000ms lazy expiry and refresh covered。completedBoundary：rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth。明确排除 0.6s delay、location/range/radius/projectile/arc/collision/travel/area/multi-target、sight/reveal/stealth、ranks1–2、P/Q/W/E/basic/combo、equipment/runes/loadout、spell shield、animation、live migration/publish/browser E2E/full-game fidelity；不宣称 delay/location/geometry/multitarget/sight/reveal/stealth/完整游戏保真。",
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-kogmaw-living-artillery',
          WASM.kogmawLivingArtillery,
          'completedBoundary: rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth; Wiki request Template:Data Kog\'Maw/R → Living Artillery; rev4007636/SHA256 32f8dd8d… / bytes2453; local raw caveat bytes2452/SHA 11db6c16… no equivalence claim; rank3 mana 40*(1+living_artillery_stacks)/1000ms CD; zero listeners/ability-start; base 180+0.75*bonusAD+0.45*AP nested binary add; missing-HP multiplier 1+min(0.5,(5/6)*missingFraction) ≥40% HP else exactly 2; fixture baseAD61/resolvedAD141/AP100→base285; maxHP1000/MR100 current1000→285/142.5 current400→427.5/213.75 current399→570/285; t0/t999/t1000 mana500 two successes+one CD skip costs40→80 mana380/state2; mana119 first40 then resource skip mana79/state1; ten successes 40..400 total2200 cap9; 8000ms lazy expiry/refresh; Wasm exact test commit d58370a; delay/location/geometry/multitarget/sight/reveal/stealth/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-kogmaw-living-artillery',
          WASM.kogmawLivingArtilleryProviderStateCostGate,
          'completedBoundary: rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth; provider-aware dynamic cost gate regression (const/dynamic cost, resource_insufficient, lazy expiry, malformed ref fail-closed, zero listeners/ability-start); Wasm commit d58370a',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-kogmaw-living-artillery',
          SEED.kogmawLivingArtilleryBackend,
          'completedBoundary: rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth; backend lol_generic_kogmaw_living_artillery_seed.sql + LolGenericKogmawLivingArtillerySeedSqlTest (owning 100679a + nested-binary correction 473bd50; integrated 175b03a + correction d563b67); three-argument add corrected to nested binary add (do not endorse incompatible formula); Wasm exact test commit d58370a; Web asset sync 38b9229 artifact parity only (not bilateral substitute); not live published',
        ),
      ],
    },
  ],
  [
    'hero_kogmaw|W',
    {
      classification: 'migrated',
      tags: ['on_hit', 'target_max_hp_ratio', 'formula_on_hit'],
      reason:
        '精确 candidate 已纳入 formula-onhit seed，并由 generic_completed_onhit_mechanisms_test.go（commit 3314c24）CompileGeneric+RunGeneric 证明 KogMaw W 主目标 on-hit。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-completed-onhit-mechanisms',
          WASM.completedOnHit,
          `KogMaw W bio-arcane barrage main-target on-hit; commit ${COMPLETED_ONHIT_COMMIT}`,
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-formula-onhit-batch',
          SEED.formulaOnHit,
          'KogMaw W bio-arcane barrage main-target formula on-hit seed',
        ),
      ],
    },
  ],
  [
    'hero_teemo|E',
    {
      classification: 'migrated',
      tags: ['on_hit', 'flat_magic_damage', 'formula_on_hit'],
      reason:
        '精确 candidate 已纳入 formula-onhit seed，并由 generic_completed_onhit_mechanisms_test.go（commit 3314c24）证明 Teemo E 即时 on-hit（DoT 非本批）。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-completed-onhit-mechanisms',
          WASM.completedOnHit,
          `Teemo E toxic shot immediate on-hit (DoT out of batch); commit ${COMPLETED_ONHIT_COMMIT}`,
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-formula-onhit-batch',
          SEED.formulaOnHit,
          'Teemo E toxic shot immediate on-hit seed (DoT out of this batch)',
        ),
      ],
    },
  ],
  [
    'hero_teemo|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_teemo Q 致盲吹箭/Blinding Dart：Wiki rev3948425（SHA256 4e3c475ed55ec865f6a9060c8ad0b2665e5379b3ae7e9e5cb644f83212b240a7；normalized/generic/teemo-q.json）rank5 Phase-A v1 已由 wasm-generic-teemo-blinding-dart 闭环为 migrated——90 mana / 7000ms CD；immediate primary-target scaffold；恰好一次 non-crit/non-copyable magic damage 260+0.70*source.attr.ap.resolved（交叉校验 AP200 → raw400，target MR100 → mitigated200）。Attempts t0/t6999/t7000 → two successes + exactly one cooldown skip without mana/damage；final mana 154 from 334。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry。明确排除 blind/control 与 2–3s duration、cast time 0.25s、projectile/speed2500/range/geometry/collision/selection、ranks1–4、on-hit/equipment/Toxic Shot/basic-attack coupling/rotation、multi-target、live migration/publish/E2E；不宣称 blind/cast/projectile/geometry/multitarget/完整游戏保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-teemo-blinding-dart',
          WASM.teemoBlindingDart,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry; Wiki rev3948425/SHA256 4e3c475e… rank5 90 mana/7000ms CD / one magic 260+0.70*AP; AP200→raw400/MR100→200; t0/t6999/t7000 two successes + one CD skip; final mana154; blind/cast/projectile/geometry/multitarget/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-teemo-blinding-dart',
          SEED.teemoBlindingDartBackend,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry; backend lol_generic_teemo_blinding_dart_seed.sql + LolGenericTeemoBlindingDartSeedSqlTest (owning 1803c8c; integrated 7e27f33); not live published',
        ),
      ],
    },
  ],
  [
    'hero_twitch|P',
    {
      classification: 'migrated',
      tags: [
        'poison_dot_stack',
        'anchored_provider_tick',
        'true_damage_over_time',
        'on_hit_stack_apply',
      ],
      reason:
        'hero_twitch P 死亡毒液/Deadly Venom：Wiki rev4013286（SHA256 1567c0efec7f9e9021f6dc02410f92262dfa30128acc457c531199dbc9121b44）已给出 max6/6000ms、每 AA 一层、每秒真实伤害 tick、五档等级带、每层 +3% AP；当前 1v1 伤害核合同数据完整。generic anchored provider-tick ABI/runtime（commit 8612d0d）+ Backend lifecycle/seed（commit 92e100e）+ Web TickSpec 投影（commit 5a0931a）+ 精确 CompileGeneric/RunGeneric Twitch 测试（commit 7cb8b1d）已闭环，故标 migrated；不再以 missing_poison_dot_stack_runtime / blocked_data 阻塞。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-twitch-deadly-venom',
          WASM.twitchDeadlyVenom,
          'completedBoundary: Wiki rev4013286 Deadly Venom 1v1 (max6/6000ms / AA stack / 1s true ticks / L1·5·9·13·17 / +3% AP / inclusive final tick; commit 7cb8b1d on generic anchored tick ABI 8612d0d); not live published',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-twitch-deadly-venom',
          SEED.twitchDeadlyVenomBackend,
          'completedBoundary: Twitch Deadly Venom seeded (Backend lifecycle/seed commit 92e100e; Web TickSpec projection commit 5a0931a); backend lol_generic_twitch_deadly_venom_seed.sql; not live published',
        ),
      ],
    },
  ],
  [
    'hero_twistedfate|E',
    {
      classification: 'migrated',
      tags: ['every_n_hit', 'flat_magic_damage', 'bonus_ad_ap_ratio', 'attack_speed_percent_add'],
      reason:
        'hero_twistedfate E 卡牌骗术/Stacked Deck 已由 wasm-generic-twisted-fate-stacked-deck 批次闭环：仅 rank5；常驻 attack_speed percent_add 0.50；每第4次 source-owner basic_attack_hit 追加 magic raw=165+0.20*(resolved AD-base AD)+0.40*resolved AP；copyable_on_hit=false；MR 走当前 pipeline。',
      remainingGap:
        '仅建模 rank5；建筑物 50% 减伤未建模；其它 rank 数值表未建模；主动技能（Q/W/R）未建模。',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-twisted-fate-stacked-deck',
          WASM.twistedFateStackedDeck,
          'Twisted Fate E Stacked Deck rank5: +50% AS; every-4th hit magic 165+20%bonusAD+40%AP; copyable_on_hit=false',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-twisted-fate-stacked-deck',
          SEED.twistedFateStackedDeck,
          'Twisted Fate E Stacked Deck rank5 seed; building DR / other ranks / actives unmodeled',
        ),
      ],
    },
  ],
  [
    'hero_twistedfate|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'bonus_ad_ratio',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_twistedfate Q 万能牌/Wild Cards：Wiki rev3950864（SHA256 9cdd62cc18d41a4bbe1e42ac8202b40a776f7da51c67c6f2fea37f9ed1f0d597；normalized/generic/twistedfate-q.json）rank5 Phase-A v2 已由 wasm-generic-twisted-fate-wild-cards-primary-hit 闭环为 migrated——100 mana / 5000ms CD；immediate primary-target scaffold（明确排除而非建模 Wiki cast0.25 与 Effect at cast time end）；恰好一次 non-crit/non-copyable magic damage 240+0.50*(source.attr.ad.resolved-source.attr.ad.base)+0.85*source.attr.ap.resolved（交叉校验 baseAD52 / resolvedAD100 / AP100 → raw349，target MR100 → mitigated174.5）。Attempts t0/t4999/t5000 → two successes + exactly one cooldown skip without mana/damage；final mana 133 from 333；HP 1000→651。Wiki once-per-pass 仅为单次直击主目标的源正当化，不宣称 runtime pass/projectile/collision 保真。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget。明确排除 cast0.25/effect-at-cast-end、fan/three cards/cone/angles、direction、projectile/travel/collision/pass、range1450/width80/speed1000/geometry、AOE/multitarget/repeat、spellshield、ranks1–4、W/E/basic/Stacked Deck/on-hit/equipment/loadout、live/publish/E2E/full fidelity；不宣称 cast/fan/cone/projectile/pass/geometry/AOE/multitarget 保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-twisted-fate-wild-cards-primary-hit',
          WASM.twistedFateWildCardsPrimaryHit,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget; Wiki rev3950864/SHA256 9cdd62cc… rank5 100 mana/5000ms CD / one magic 240+0.50*(ad.resolved-ad.base)+0.85*AP; baseAD52/resolvedAD100/AP100→raw349/MR100→174.5; t0/t4999/t5000 two successes + one CD skip; final mana133/HP651; once-per-pass justifies single direct hit only (not runtime pass fidelity); immediate scaffold excludes Wiki cast0.25 and Effect at cast time end; cast/fan/cone/projectile/pass/geometry/AOE/multitarget/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-twisted-fate-wild-cards-primary-hit',
          SEED.twistedFateWildCardsPrimaryHitBackend,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget; backend lol_generic_twisted_fate_wild_cards_primary_hit_seed.sql + LolGenericTwistedFateWildCardsPrimaryHitSeedSqlTest (owning 18b959e; integrated a0da4f8); Wasm exact test commit 589db93; not live published',
        ),
      ],
    },
  ],
  [
    'hero_draven|Q',
    {
      classification: 'migrated',
      tags: ['spellblade_next_attack_state', 'spinning_axe_ready', 'axe_caught_rearm'],
      reason:
        'hero_draven Q 旋转飞斧/Spinning Axe：用户批准 1v1 口径已由 wasm-generic-draven-spinning-axe + backend seed 闭环——rank5 bonus 60+115% bonus AD；1400ms 自动接斧；独立 overlapping flight；max 2 axes；45 mana；8000ms CD；ready 窗/接斧 refresh；每次合格命中消费 1 斧。用户明确排除落点/移动/路径模拟与 Draven W CD reset，故标 migrated/completed，不再以这些排除分支阻塞。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-draven-spinning-axe',
          WASM.dravenSpinningAxe,
          'completedBoundary: user-approved Spinning Axe 1v1 (rank5 60+115%bonusAD / catch1400ms / max2 / 45mana / CD8000ms / ready+catch refresh / consume-per-hit / unique overlapping flights); excluded: landing-movement-path / W CD reset',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-draven-spinning-axe',
          SEED.dravenSpinningAxeBackend,
          'completedBoundary: Spinning Axe user-approved 1v1 seeded; excluded landing/W-reset out of scope; backend lol_generic_draven_spinning_axe_seed.sql',
        ),
      ],
    },
  ],
  [
    '2523|高倍望远镜',
    {
      classification: 'migrated',
      tags: ['outgoing_pre_mitigation_basic_damage_amp', 'fixed_maximum_multiplier'],
      reason:
        'item 2523 Magnification/高倍望远镜：用户批准 fixed-max 口径——每个 eligible basic-damage instance 使用最大 1.10 outgoing pre-mitigation multiplier。wasm-generic-pipeline-damage-modifier + backend lol_generic_pipeline_damage_items_seed.sql 提供 CompileGeneric+RunGeneric 证据。距离分段为用户排除分支，非 blocker；奥术瞄准仍单独 out_of_scope。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-pipeline-damage-modifier',
          WASM.pipelineDamageModifier,
          'completedBoundary: user-approved Magnification fixed-max 1.10 outgoing pre-mitigation on eligible basic damage; excluded: runtime distance input / distance scaling; Arcane Aim separate OOS',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-pipeline-damage-modifier',
          SEED.pipelineDamageItemsBackend,
          'completedBoundary: Magnification fixed-max 1.10 seeded; distance branch out of scope; backend lol_generic_pipeline_damage_items_seed.sql',
        ),
      ],
    },
  ],
  [
    'hero_ashe|Q',
    {
      classification: 'migrated',
      tags: ['stacking_stat_modifier_on_hit', 'attack_speed_percent_add', 'cast_condition'],
      reason:
        "hero_ashe Q 射手的专注/Ranger's Focus：当前 League Wiki + 用户批准口径下核心已闭环（4 Focus / 6s Flurry / rank5 +60% AS / 5箭合计 130% AD、首轮 6箭 156% AD / 30 mana）。wasm-generic-ashe-rangers-focus 提供 CompileGeneric+RunGeneric 证据。用户明确排除 attack-timer reset、逐箭飞行、Frost Shot、吸血、建筑物/多目标与完整轮转，故标 migrated/completed，不再以这些排除分支阻塞。",
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-ashe-rangers-focus',
          WASM.asheRangersFocus,
          "completedBoundary: user-approved Ranger's Focus core (Focus==4 cast + Flurry AS/damage); excluded: attack-timer reset / arrow travel / Frost Shot / life steal / buildings / multitarget / rotation; wiki rank5 AS=60%",
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-ashe-rangers-focus',
          SEED.asheRangersFocusBackend,
          "completedBoundary: Ranger's Focus user-approved core seeded; excluded branches out of scope; backend lol_generic_ashe_rangers_focus_seed.sql",
        ),
      ],
    },
  ],
  [
    'hero_ashe|W',
    {
      classification: 'migrated',
      tags: ['ability_flat_bonus_ad_damage', 'first_missile_only'],
      reason:
        'hero_ashe W 万箭齐发/Volley：当前 League Wiki + 用户批准 1v1 口径已由 wasm-generic-ashe-volley + backend seed 闭环——rank5 200+100% bonus AD；单目标一次 physical damage；55 mana；4000ms CD。用户明确排除 Frost Shot 减速/状态、弹道/锥形/碰撞/多目标、per-arrow 循环与其它 rank；Wiki 写明多箭命中同一目标仅计第一箭伤害，故标 migrated/completed，不再以这些排除分支阻塞。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-ashe-volley',
          WASM.asheVolley,
          'completedBoundary: user-approved Volley 1v1 (rank5 200+100%bonusAD / one physical instance / 55mana / CD4000ms / first-arrow-only); excluded: Frost Shot / projectile-cone-collision-multitarget / per-arrow loop / other ranks; attempts 0/3999/4000ms → 2 casts + 1 CD skip',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-ashe-volley',
          SEED.asheVolleyBackend,
          'completedBoundary: Volley user-approved 1v1 seeded; excluded Frost Shot/projectile/multi-target/other ranks out of scope; backend lol_generic_ashe_volley_seed.sql',
        ),
      ],
    },
  ],
  [
    'hero_ashe|R',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_ashe R 魔法水晶箭/Enchanted Crystal Arrow：Wiki rev4026934（SHA256 1d9ccefa98a41e57a088e76aaca16f7a78141e7373616520e2d6ba13f450664f；normalized/generic/ashe-r.json）rank3 Phase-A v1 已由 wasm-generic-ashe-enchanted-crystal-arrow-primary-hit 闭环为 migrated——100 mana / 60000ms CD；immediate primary-target scaffold（明确排除而非建模 Wiki cast0.25 与 Effect at cast time start）；恰好一次 non-crit/non-copyable magic damage 600+1.20*source.attr.ap.resolved（交叉校验 AP200 → raw840，target MR100 → mitigated420）。Attempts t0/t59999/t60000 → two successes + exactly one cooldown skip without mana/damage；final mana 80 from 280；HP 1000→160。completedBoundary：rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight。明确排除 cast0.25/effect-at-cast-time-start、projectile/travel/collision/geometry、distance-scaled stun、surrounding same-damage AOE/Frost、sight、ranks1–2、Ashe P/Q/W/basic/on-hit/equipment/loadout、live/publish/E2E/full fidelity；不宣称 cast/projectile/stun/AOE/Frost/sight 保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-ashe-enchanted-crystal-arrow-primary-hit',
          WASM.asheEnchantedCrystalArrowPrimaryHit,
          'completedBoundary: rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight; Wiki rev4026934/SHA256 1d9ccefa… rank3 100 mana/60000ms CD / one magic 600+1.20*AP; AP200→raw840/MR100→420; t0/t59999/t60000 two successes + one CD skip; final mana80/HP160; immediate scaffold excludes Wiki cast0.25 and Effect at cast time start; cast/projectile/travel/collision/geometry/distance-stun/AOE/Frost/sight/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-ashe-enchanted-crystal-arrow-primary-hit',
          SEED.asheEnchantedCrystalArrowPrimaryHitBackend,
          'completedBoundary: rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight; backend lol_generic_ashe_enchanted_crystal_arrow_primary_hit_seed.sql + LolGenericAsheEnchantedCrystalArrowPrimaryHitSeedSqlTest (owning 5d4a13f; integrated 2f820e4); Wasm exact test commit bb3dd81; not live published',
        ),
      ],
    },
  ],
  [
    'hero_ezreal|R',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'bonus_ad_ratio',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_ezreal R 精准弹幕/Trueshot Barrage：Wiki rev4013235（SHA256 e9d7f9d7411bcbb1ab00aeb89fe03a4fb8511625fc0a64266f5f63ced53580e0；normalized/generic/ezreal-r.json）rank3 Phase-A v2 已由 wasm-generic-ezreal-trueshot-barrage-primary-hit 闭环为 migrated——100 mana / 90000ms CD；immediate primary-champion scaffold（明确排除而非建模 Wiki cast1 / queue0.5 与 Effect at cast time start）；恰好一次 non-crit/non-copyable magic damage 750+1.00*(source.attr.ad.resolved-source.attr.ad.base)+1.10*source.attr.ap.resolved（交叉校验 baseAD60 / resolvedAD110 / AP200 → raw1020，target MR100 → mitigated510）。Attempts t0/t89999/t90000 → two successes + exactly one cooldown skip without mana/damage；final mana 100 from 300；HP 1500→480。completedBoundary：rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage。明确排除 cast1/queue0.5/effect-at-cast-start、projectile/travel/collision/global geometry/direction、multitarget/sight、minion/monster modified rank3 300+1.00 bonusAD+1.10 AP、ranks1–2、P/Q/W/E/basic/on-hit/equipment/loadout、live/publish/E2E/full fidelity；不宣称 cast/queue/projectile/geometry/direction/multitarget/sight/minion-monster-modified 保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_ezreal ad/ap/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-ezreal-trueshot-barrage-primary-hit',
          WASM.ezrealTrueshotBarragePrimaryHit,
          'completedBoundary: rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage; Wiki rev4013235/SHA256 e9d7f9d7… rank3 100 mana/90000ms CD / one magic 750+1.00*bonusAD+1.10*AP; baseAD60/resolvedAD110/AP200→raw1020/MR100→510; t0/t89999/t90000 two successes + one CD skip; final mana100/HP480; immediate scaffold excludes Wiki cast1/queue0.5 and Effect at cast time start; cast/queue/projectile/geometry/direction/multitarget/sight/minion-monster-modified/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-ezreal-trueshot-barrage-primary-hit',
          SEED.ezrealTrueshotBarragePrimaryHitBackend,
          'completedBoundary: rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage; backend lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql + LolGenericEzrealTrueshotBarragePrimaryHitSeedSqlTest (owning dea4538; integrated 8c93017); Wasm exact test commit e13d887; external existing-data/check-only prerequisites (does not write identity/panel/resource values); not live published',
        ),
      ],
    },
  ],
  [
    'hero_ezreal|E',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'bonus_ad_ratio',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_ezreal E 奥术跃迁/Arcane Shift：Wiki request Template:Data Ezreal/E → resolved Template:Data Ezreal/Arcane Shift；page1307111 / rev3989862 / timestamp 2026-02-03T23:19:20Z / canonical bytes1661 / SHA256 7ac83f7eaa237641c478f2e3ffa1a2714f7da0644c8a488ab6a6f47b67e27347（normalized/generic/ezreal-e.json）rank5 Phase-A v3 已由 wasm-generic-ezreal-arcane-shift-primary-hit 闭环为 migrated——local raw caveat bytes1661 / SHA f48a32706234b0c1ef1abab4b7f90e4ee88944623827fb22a41e23bdfac01792（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；70 mana / 14000ms CD；immediate primary-champion scaffold；恰好一次 non-crit/non-copyable magic damage 280+0.60*(source.attr.ad.resolved-source.attr.ad.base)+0.75*source.attr.ap.resolved（nested binary add；交叉校验 raw/mit 280/140、310/155、430/215、460/230）。Attempts t0/t13999/t14000 mana210 → two successes + exactly one cooldown skip without mana/damage；final mana 70；HP 1000→540；mana69 → resource skip/unchanged。成功命中保留既有 Rising Spell Force 一层：successful t0 + CD skip t100 → exactly one damage/ability_started/P stack and AS1.1。completedBoundary：rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks。明确排除 blink/homing/target-selection/visibility/Essence Flux priority、projectile/travel/reveal、ranks1–4、other Ezreal skills/basic、loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 blink/homing/visibility/Essence-Flux/projectile/reveal/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_ezreal ad/ap/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-ezreal-arcane-shift-primary-hit',
          WASM.ezrealArcaneShiftPrimaryHit,
          'completedBoundary: rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks; Wiki request Template:Data Ezreal/E → Arcane Shift; rev3989862/SHA256 7ac83f7e… / bytes1661; local raw caveat bytes1661/SHA f48a3270… no equivalence claim; rank5 70 mana/14000ms CD / one magic 280+0.60*bonusAD+0.75*AP nested binary add; branches raw/mit 280/140 310/155 430/215 460/230; t0/t13999/t14000 mana210 two successes + one CD skip final mana70/HP540; mana69 resource skip unchanged; P coexistence successful t0 + CD skip t100 → exactly one damage/ability_started/P stack and AS1.1; Wasm exact test commit 065beb1; blink/homing/visibility/Essence-Flux/projectile/reveal/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-ezreal-arcane-shift-primary-hit',
          SEED.ezrealArcaneShiftPrimaryHitBackend,
          'completedBoundary: rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks; backend lol_generic_ezreal_arcane_shift_primary_hit_seed.sql + LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest + README (owning 89e6677; integrated 0594b20); Wasm exact test commit 065beb1; nested binary add; external existing-data/check-only prerequisites (does not write identity/panel/resource values); Web source asset exact parity (no Web change/commit); not live published',
        ),
      ],
    },
  ],
  [
    'hero_ezreal|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_ezreal Q 秘术射击/Mystic Shot：Wiki request Template:Data Ezreal/Q → resolved Template:Data Ezreal/Mystic Shot；page1307107 / rev4013233 / timestamp 2026-04-28T21:19:30Z / canonical bytes2054 / SHA256 be5a24861dc53970c19378fe8bea17b242b5b406a588cebb32b0d59a4af4b533（normalized/generic/ezreal-q.json plus pages sibling are authority）rank5 Phase-A v2 已由 wasm-generic-ezreal-mystic-shot-primary-hit 闭环为 migrated——local raw caveat bytes2052 / SHA d8348b3b9eb4a076af5a87b714dd4de109643252f6b18fd2873f5a5bf7b05dbd（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；40 mana / 4500ms CD；immediate selected-primary-enemy-champion single physical hit scaffold；one immediate selected-primary-enemy-champion single noncritical/noncopyable physical damage operation add(add(const 120, mul(const 1.30, read source.attr.ad.resolved)), mul(const 0.40, read source.attr.ap.resolved))（exact nested binary add；total AD direct read；never bonus AD/subtraction；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no Q ability-specific type）（交叉校验 resolvedAD60/AP0/armor100 raw198/final99；resolvedAD160/AP0/armor100 raw328/final164；resolvedAD60/AP100/armor100 raw238/final119；resolvedAD160/AP100/armor100 raw368/final184；baseAD0 versus baseAD60 at resolvedAD160/AP0/armor100 both328/164）。Attempts mana120/baseAD60/resolvedAD160/AP100/HP1000/armor100 at t0/t4499/t4500 → success/skip/success，exactly two Q damage items；final mana40/HP632；exactly two automatic Q ability_started；mana39 at t0 → resource skip with mana/HP unchanged and no Q damage/event。成功命中保留既有 Rising Spell Force 一层：successful t0 + CD skip t100 → exactly one damage/ability_started/P stack and AS1.1。Ezreal Q provider is standalone；preserve existing P/E/R without requiring/mutating/synthesizing/copying them；Q seed contains no W rows；Backend has no repository-owned hero_ezreal / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Ezreal W dependence；不暗示 Batch-B 或 sibling Ezreal synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Main focused11/full998 passed。Wasm main validation passed gofmt/focused/count100/full/bench/build/smoke/benchmark；built and independent Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write；hero-named `_test.go` is regression/governance evidence only and excluded from production build。completedBoundary：rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity。明确排除 direction/range/projectile travel/collision/first-enemy acquisition、on-hit/on-attack/1.5s cooldown reduction、basic+spell dual-tag/lifesteal/vamp/spellshield/buffering、ranks1–4、other Ezreal skills/basic beyond coexistence、loadout/crit、live migration/publish/E2E/full fidelity；this is exactly one selected-primary-enemy-champion single physical hit, not full Q；不宣称 direction/range/projectile/collision/acquisition/on-hit/on-attack/CD-reduction/dual-tag/lifesteal/vamp/spellshield/buffering/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_ezreal ad/ap/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-ezreal-mystic-shot-primary-hit',
          WASM.ezrealMysticShotPrimaryHit,
          'completedBoundary: rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity; Wiki request Template:Data Ezreal/Q → Mystic Shot; rev4013233/SHA256 be5a2486… / bytes2054; local raw caveat bytes2052/SHA d8348b3b… no equivalence claim; rank5 40 mana/4500ms CD / one physical 120+1.30*totalAD+0.40*AP nested binary add; resolvedAD60/AP0/armor100 raw198/final99; resolvedAD160/AP0/armor100 raw328/final164; resolvedAD60/AP100/armor100 raw238/final119; resolvedAD160/AP100/armor100 raw368/final184; baseAD0 vs baseAD60 at resolvedAD160/AP0/armor100 both328/164; damage 20220/add 20170; no 20230; no explicit event op; no Q type; mana120/baseAD60/resolvedAD160/AP100/HP1000/armor100 t0/t4499/t4500 success/skip/success two Q damage items final mana40/HP632 two automatic Q ability_started; mana39 resource skip unchanged; P coexistence successful t0 + CD skip t100 → exactly one damage/ability_started/P stack and AS1.1; Wasm exact test commit 000e253; direction/range/projectile/collision/acquisition/on-hit/on-attack/CD-reduction/dual-tag/lifesteal/vamp/spellshield/buffering/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-ezreal-mystic-shot-primary-hit',
          SEED.ezrealMysticShotPrimaryHitBackend,
          'completedBoundary: rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity; backend lol_generic_ezreal_mystic_shot_primary_hit_seed.sql + LolGenericEzrealMysticShotPrimaryHitSeedSqlTest + README (owning 41fce6a; integrated ae66c56); Wasm exact test commit 000e253; nested binary add; external existing-data/check-only prerequisites (does not write identity/panel/resource values); Web source asset exact parity (no Web change/commit); not live published',
        ),
      ],
    },
  ],
  [
    'hero_ezreal|P',
    {
      classification: 'migrated',
      tags: ['stacking_stat_modifier_on_hit', 'attack_speed_percent_add'],
      reason:
        'hero_ezreal P 咒能高涨/Rising Spell Force：Wiki rev3932280（SHA256 5996c969e2d1b53b3c805737fa161b4a9e235d6e7b7c74899a6580de34ca77ba）+ 本次采用的确定性 1v1 口径已由 wasm-generic-ezreal-rising-spell-force + backend seed 闭环——每次 scheduled top-level 非普攻能力命中唯一目标 +1 provider-scoped stack；6000ms refresh-on-write；cap 5；每层 +10% AS（cap +50%）。本次口径明确排除普攻叠层、CD-skip cast、miss、多目标、单次施法多段命中与真实 Q/W/E/R 图，故标 migrated/completed，不再以这些排除分支阻塞。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-ezreal-rising-spell-force',
          WASM.ezrealRisingSpellForce,
          'completedBoundary: bounded 1v1 Rising Spell Force (ability_started hit→+1 stack / 6000ms refresh-on-write / cap5 / +10% AS per stack cap+50%); excluded: basic attacks / CD-skip cast / misses / multi-target / multi-hit-per-cast / real QWER graphs',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-ezreal-rising-spell-force',
          SEED.ezrealRisingSpellForceBackend,
          'completedBoundary: Rising Spell Force bounded 1v1 seeded; excluded branches out of scope; backend lol_generic_ezreal_rising_spell_force_seed.sql',
        ),
      ],
    },
  ],
  [
    'hero_kaisa|P',
    {
      classification: 'migrated',
      tags: ['on_hit', 'stacking_plasma', 'missing_health_consume'],
      reason:
        "hero_kaisa P 体表活肤/Second Skin：Wiki rev4038390（SHA256 f7adc35c58f47d28f8bd098a1303cf5cfef5a414783cde389ecf07240e95515f）+ 当前 canonical generic ABI 口径已由 wasm-generic-kaisa-second-skin + backend seed 闭环——provider-target plasma_stacks（default0/max5/4000ms refresh-on-write）；level1..18 精确插值 base=4+20/17*(level-1)、perStack=1+5/17*(level-1)；同 provider 有序普攻图：Caustic→+1 stack→第五层已损生命破裂→reset→物理普攻→恰好一次 event/basic_attack_hit。明确排除 W 2/3 层与 overflow、友军定身 Plasma、野怪 400 cap、法术护盾、Guinsoo phantom/buff-slot、多目标，故标 migrated/completed，不再以这些排除分支阻塞。",
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-kaisa-second-skin',
          WASM.kaisaSecondSkin,
          'completedBoundary: canonical generic Second Skin (plasma_stacks 0..5 / 4000ms refresh-on-write / exact L1..18 base+perStack / ordered Caustic→stack→fifth rupture→reset→physical BA→one basic_attack_hit); excluded: W 2/3 stacks+overflow / allied CC Plasma / monster 400 cap / spell shield / Guinsoo phantom-buff-slot / multi-target',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-kaisa-second-skin',
          SEED.kaisaSecondSkinBackend,
          'completedBoundary: Second Skin canonical generic seeded; excluded branches out of scope; backend lol_generic_kaisa_second_skin_seed.sql',
        ),
      ],
    },
  ],
  [
    'hero_akshan|P',
    {
      classification: 'partial',
      tags: [
        'every_n_hit',
        'on_hit',
        'stacking_dirty_fighting',
        'magic_proc_on_third_stack',
      ],
      reason:
        'hero_akshan P 无所不用/Dirty Fighting：Wiki rev4038197（SHA256 22ba762382dedced4b63a451c4513cb3129e3b16a137236e5b637eea7510b534）+ 当前 canonical generic ABI 口径已由 wasm-generic-akshan-dirty-fighting + backend 双边证据闭环——CompileFrame→session→RunFrame→ReleaseSessionFrame；typed 普攻物理伤害；provider-target dirty_fighting_stacks（default0/max3/5000ms refresh-on-write）；第三层魔法 15/40/80/150 @ levels 1/6/11/16 +60% AP 并消耗重置；护甲/MR pipeline、阈值、AP、refresh/expiry、从零第四击、每次攻击恰好一次 basic_attack_hit。标 partial（非 full）：第二发 50% AD 仅 after a delay，exact delay ms 未公布；技能命中叠层缺 accurate ability-hit wiring；英雄护盾与取消第二发移速及换目标/小兵/多目标非核心分支 out of damage scope。',
      remainingGap:
        'blocked_data：被动第二发 50% AD 仅 after a delay，exact delay ms 未公布（secondShotDelayMs / second_shot_exact_delay_ms_not_published）；runtime：技能命中叠层缺 accurate_ability_hit_event_wiring（不得用 ability_started 替代）；out_of_scope：英雄护盾、取消第二发移速、换目标/小兵/多目标非核心分支。',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-akshan-dirty-fighting',
          WASM.akshanDirtyFighting,
          'completedBoundary: Dirty Fighting AA core (CompileFrame→session→RunFrame→ReleaseSessionFrame / typed physical BA / dirty_fighting_stacks 0..3 5000ms refresh-on-write / third-stack magic 15/40/80/150@1/6/11/16 +60% AP consume-reset / armor-MR-AP thresholds / refresh-expiry / fourth-from-zero / one basic_attack_hit); remainingGap: secondShotDelayMs unpublished; ability-hit stack wiring; shield+cancel-MS+retarget/minion/multi-target OOS',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-akshan-dirty-fighting',
          SEED.akshanDirtyFightingBackend,
          'completedBoundary: Dirty Fighting AA damage core seeded; remainingGap: secondShotDelayMs / ability-hit wiring / shield+cancel-MS+retarget OOS; backend lol_generic_akshan_dirty_fighting_seed.sql',
        ),
      ],
    },
  ],
  [
    'hero_akshan|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_akshan Q 去而复还/Avengerang：Wiki request Template:Data Akshan/Q → resolved Template:Data Akshan/Avengerang；page1502462 / rev4007510 / timestamp 2026-04-11T22:35:01Z / canonical bytes2570 / SHA256 1cbf7dda955849d05ad2d7e578ed9507f8f61fc7525c5ed006a25185915b5f5b（normalized/generic/akshan-q.json plus pages sibling are authority）rank5 Phase-A v4 已由 wasm-generic-akshan-avengerang-first-outbound-hit 闭环为 migrated——local raw caveat bytes2570 / SHA 407e4671cc05e87edcd0038a9efe614ad98f65cd57ce339c2c9d69afe5b8c973（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；80 mana / immediate cooldown scaffold 5000ms（Wiki real cooldown starts after return is completed-boundary exclusion, not claimed implemented and not a remaining blocker）；immediate selected-primary-champion first-outbound-pass single physical hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable physical damage operation add(const 165, mul(const 0.70, sub(read source.attr.ad.resolved, read source.attr.ad.base)))（exact nested binary；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no Q ability-specific type）（交叉校验 armor100 base52/resolved52 raw165/final82.5；base52/resolved152 raw235/final117.5；base0/resolved100 versus base52/resolved152 both raw/final235）。Attempts mana240/baseAD52/resolvedAD152/HP1000/armor100 at t0/t4999/t5000 → success/skip/success，exactly two Q damage items；final mana80/HP765；exactly two automatic Q ability_started；mana79 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Dirty Fighting/basic coexistence preserved and Q does not synthesize ability-hit stacks。Akshan Q provider is standalone；Backend has no repository-owned hero_akshan / AD / mana materializer beyond Dirty Fighting prerequisites；record external existing-data/check-only prerequisites only；不暗示 Akshan P/W/E/R/Dirty Fighting stack synthesis dependence；不暗示 Batch-B 或 sibling Akshan synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Main focused12/full1010 passed。Wasm main validation passed gofmt/focused Akshan/Ezreal、Akshan count100、full Go、build、smoke、bench；exact test bytes66516 / SHA256 dc922f4249cb87a5f6afda8f3a88dac011cc5a5683ff6c0a9a8c5cfd16618805；built production and independent Web source asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no production/Web write。completedBoundary：rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity。明确排除 direction/range/extension/return pass/homing/projectile travel、cooldown-start-after-return、sight/reveal/movement speed、non-champion damage/spellshield、other ranks/siblings/loadout/bootstrap/crit/onhit/live/full fidelity；this is exactly one selected-primary first-outbound-pass physical hit, not full Q；不宣称 direction/range/extension/return/homing/projectile/cooldown-after-return/sight/reveal/MS/non-champion/spellshield/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_akshan/ad/mana via Dirty Fighting），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-akshan-avengerang-first-outbound-hit',
          WASM.akshanAvengerangFirstOutboundHit,
          'completedBoundary: rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity; Wiki request Template:Data Akshan/Q → Avengerang; rev4007510/SHA256 1cbf7dda… / bytes2570; local raw caveat bytes2570/SHA 407e4671… no equivalence claim; rank5 80 mana/immediate cooldown scaffold 5000ms (real CD after return excluded); one physical 165+0.70*bonusAD via exact nested binary add(const165, mul(0.70, sub(ad.resolved,ad.base))); armor100 base52/resolved52 raw165/final82.5; base52/resolved152 raw235/final117.5; base0/resolved100 vs base52/resolved152 both raw/final235; damage 20220/add 20170; no 20230; no explicit event op; no Q type; mana240/baseAD52/resolvedAD152/HP1000/armor100 t0/t4999/t5000 success/skip/success two Q damage items final mana80/HP765 two automatic Q ability_started; mana79 resource skip unchanged; Dirty Fighting/basic coexistence preserved and Q does not synthesize ability-hit stacks; standalone no sibling synthesis; Wasm exact test commit b58a549 bytes66516/SHA dc922f42…; direction/range/extension/return/homing/projectile/cooldown-after-return/sight/reveal/MS/non-champion/spellshield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-akshan-avengerang-first-outbound-hit',
          SEED.akshanAvengerangFirstOutboundHitBackend,
          'completedBoundary: rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity; backend lol_generic_akshan_avengerang_first_outbound_hit_seed.sql + LolGenericAkshanAvengerangFirstOutboundHitSeedSqlTest + README (owning bd8dbcb; integrated 45d589a); Wasm exact test commit b58a549; seed30848/SHA d45d8297…; JUnit59429/SHA 2f64e5c0…; README291215/SHA 188b0174…; external existing-data/check-only prerequisites (hero_akshan/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Akshan synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_kaisa|E',
    {
      classification: 'migrated',
      tags: ['cast_triggered_timed_attack_speed', 'attack_speed_percent_add'],
      reason:
        "hero_kaisa E 极限超载/Supercharge：Wiki rev4038391（SHA256 327dc441e84bf2b320dccbe9099b4e98bf42562529e95facd417fbbc27d99e24）+ 用户批准 Phase-A rank5 1v1 攻速分支已由 wasm-generic-kaisa-supercharge 闭环——30 mana / 10000ms CD；ability 无 damage ops；generic ability_started 作为充能完成近似；source-owner ability_started listener 武装 4000ms timed state（Wasm fixture `supercharge_as_active` / Backend seed `supercharge_active`；provider-local/data-defined，本证据语义等价，非跨 bundle 字面同键）；攻速 percent_add=0.80*provider.state.<active>（base 0.60→1.08）；CD 内再次尝试 skip。明确排除移动速度/幽灵、attack windup、真实充能/cast 时序、普攻 0.5s CD 返还、进化隐形、其它 rank、rotation/cadence、多目标、live migration/publish/E2E，故标 migrated/completed，不再以这些排除分支阻塞。",
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-kaisa-supercharge',
          WASM.kaisaSupercharge,
          'completedBoundary: user-approved Phase-A rank5 1v1 AS branch (30 mana/CD10000ms / ability_started charge-complete approx / 4000ms Wasm fixture state key supercharge_as_active / +80% AS base0.60→1.08 / CD-blocked recast); state keys are provider-local/data-defined and semantically equivalent to Backend seed supercharge_active for this evidence (not literal cross-bundle key identity); excluded: MS/ghost/windup / real cast timing / on-attack 0.5s CD refund / evolution invis / other ranks/rotation/cadence / multitarget / live migration/publish/E2E',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-kaisa-supercharge',
          SEED.kaisaSuperchargeBackend,
          'completedBoundary: Supercharge user-approved Phase-A rank5 1v1 AS branch seeded (Backend seed state key supercharge_active / 4000ms / +80% AS); provider-local/data-defined and semantically equivalent to Wasm fixture supercharge_as_active for this evidence (not literal cross-bundle key identity); excluded branches out of scope; backend lol_generic_kaisa_supercharge_seed.sql',
        ),
      ],
    },
  ],
  [
    'hero_kaisa|W',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        "hero_kaisa W 虚空索敌/Void Seeker：Wiki rev4034696（SHA256 aa4ba76c6fa345c711651fa56d9b914d4ea8b7eb3ddfae79d7feb25470d7e3d1；normalized/generic/kaisa-w.json）rank5 Phase-A v2 已由 wasm-generic-kaisa-void-seeker-primary-hit 闭环为 migrated——75 mana / 14000ms CD；immediate primary-target scaffold（明确排除而非建模 Wiki 0.4s cast 与 Effect at cast time end）；恰好一次 non-crit/non-copyable magic damage 130+1.30*source.attr.ad.resolved+0.45*source.attr.ap.resolved（交叉校验 totalAD100 / AP100 → raw305，target MR100 → mitigated152.5）。Attempts t0/t13999/t14000 → two successes + exactly one cooldown skip without mana/damage；final mana 195 from 345；HP 1000→695。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund。明确排除 cast0.4/effect-at-cast-end、projectile/travel/collision/first-enemy acquisition/location/range3000/width200/speed1750/geometry/spellshield、sight/reveal/true sight4s、applying2 Plasma 与全部 Second Skin/Plasma/Caustic Wounds coupling、item AP100 evolution/applying3 Plasma/champion-hit75% cooldown refund、ranks1–4、equipment/loadout、live/publish/E2E/full fidelity；不宣称 cast/projectile/sight/reveal/Plasma/evolution/refund 保真。",
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-kaisa-void-seeker-primary-hit',
          WASM.kaisaVoidSeekerPrimaryHit,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund; Wiki rev4034696/SHA256 aa4ba76c… rank5 75 mana/14000ms CD / one magic 130+1.30*source.attr.ad.resolved+0.45*AP; totalAD100/AP100→raw305/MR100→152.5; t0/t13999/t14000 two successes + one CD skip; final mana195/HP695; immediate scaffold excludes Wiki 0.4s cast and Effect at cast time end; cast/projectile/sight/reveal/Plasma/evolution/refund/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-kaisa-void-seeker-primary-hit',
          SEED.kaisaVoidSeekerPrimaryHitBackend,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund; backend lol_generic_kaisa_void_seeker_primary_hit_seed.sql + LolGenericKaisaVoidSeekerPrimaryHitSeedSqlTest (owning 9d9200a; integrated 1dc8d5b); not live published',
        ),
      ],
    },
  ],
  [
    'hero_draven|W',
    {
      classification: 'migrated',
      tags: ['timed_attack_speed_buff', 'catch_cooldown_reset'],
      reason:
        'hero_draven W 血性冲刺/Blood Rush：rank5 20 mana / 12000ms CD / 3000ms +40% AS 主动攻速核心，以及 event/axe_caught → cooldown_change override 0（W ready）已由 wasm-generic-draven-blood-rush、generic_draven_w_axe_catch_reset_test.go 与 backend lol_generic_draven_blood_rush_seed.sql 闭环。移动速度与衰减为允许不模拟的非伤害分支，故标 migrated。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-draven-blood-rush',
          WASM.dravenBloodRush,
          'completedBoundary: rank5 20 mana/12000ms CD/3000ms +40% AS timed state; axe_caught W-ready closed; MS/decay intentionally out of damage branch',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-draven-blood-rush',
          WASM.dravenWAxeCatchReset,
          'completedBoundary: event/axe_caught → cooldown_change override 0 (W ready); second W cast before normal 12000ms CD',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-draven-blood-rush',
          SEED.dravenBloodRushBackend,
          'completedBoundary: Blood Rush AS + axe_caught W ready seeded; backend lol_generic_draven_blood_rush_seed.sql; not live published',
        ),
      ],
    },
  ],
  [
    'hero_draven|E',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'ability_flat_bonus_ad_damage',
        'active_physical_damage',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_draven E 开道利斧/Stand Aside：Wiki rev4034694（SHA256 7bb6ebdc19413ef908e78fea01576d1184a66bc62fd6148120845573c1468e8d；normalized/generic/draven-e.json）rank5 Phase-A v2 已由 wasm-generic-draven-stand-aside 闭环为 migrated——70 mana / 12000ms CD；immediate primary-target scaffold；恰好一次 non-crit/non-copyable physical damage 215+0.50*(source.attr.ad.resolved-source.attr.ad.base)（交叉校验 base AD 62 / resolved AD 142 / bonus AD 80 → raw 255，armor 100 → mitigated 127.5）。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget。明确排除 Wiki 250ms cast/effect-at-cast-end（canonical AbilityDefinition 无 cast-delay 字段）、ranks1–4、projectile/travel、fan/line geometry、collision、target selection、multi-target/repeat、knock aside/airborne/slow/other CC、equipment/loadout、live migration/publish/E2E；不宣称 cast-delay/CC/geometry/multitarget/完整游戏保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-draven-stand-aside',
          WASM.dravenStandAside,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget; Wiki rev4034694/SHA256 7bb6ebdc… rank5 70 mana/12000ms CD / one physical 215+0.50*bonusAD; cast-delay/CC/geometry/multitarget/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-draven-stand-aside',
          SEED.dravenStandAsideBackend,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget; backend lol_generic_draven_stand_aside_seed.sql + LolGenericDravenStandAsideSeedSqlTest (owning 5f1f2bb; integrated 09dbf07); not live published',
        ),
      ],
    },
  ],
  [
    'hero_quinn|P',
    {
      classification: 'migrated',
      tags: [
        'on_hit',
        'formula_on_hit',
        'bonus_ad_ratio',
        'copyable_on_hit_false',
        'provider_target_state_consume',
      ],
      reason:
        'hero_quinn P 侵扰/Harrier：Wiki request Template:Data Quinn/I → resolved Template:Data Quinn/Harrier；page1308953 / rev4024765 / timestamp 2026-06-03T00:49:03Z / canonical bytes2390 / SHA256 740debfb3b72dd7f926337f7eb4adbe3a65c88caec227ca16e00dff6634f798c（normalized/generic/quinn-p.json）level18 Phase-A v2 pre-marked consume 已由 wasm-generic-quinn-harrier-premarked-consume 闭环为 migrated——local raw caveat bytes2390 / SHA 08853c2c25ada7769e25908123dbb56f7b14dc0c1479a8a5842693874849a731（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；预先存在 harrier_vulnerable 目标上 owner basic_attack_hit 时，同既有 W provider 有序：arm heightened_senses_active=1 → 恰好一次 non-crit/non-copyable physical 120+0.40*(source.attr.ad.resolved-source.attr.ad.base)（nested binary add）→ consume mark（Backend selector/self 20110 + scope provider_target 20252 / Wasm source+provider_target）；无 mark 不触发。交叉校验 bonusAD80 → raw152，armor100 → mitigated76；baseline raw120/mitigated60。t0/t3000 两次 AA 仅一次 P bonus，无第二次 W arm。W-before-P 与 P-before-W 同效；不宣称 W AS magnitude 校正。completedBoundary：level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels。明确排除 mark 生成（Q/E/Skystrike/Valor）、duration/reveal/overwrite/cooldown、targeting/AI、monster75、R disable、parry、levels1–17、multitarget/loadout/crit/replication、live migration/publish/E2E/full fidelity；不宣称 mark 生成/duration/Valor/monster/R-disable/parry/完整游戏保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-quinn-harrier-premarked-consume',
          WASM.quinnHarrierPremarkedConsume,
          'completedBoundary: level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels; Wiki request Template:Data Quinn/I → Harrier; rev4024765/SHA256 740debfb… / bytes2390; local raw caveat bytes2390/SHA 08853c2c… no equivalence claim; level18 preexisting harrier + basic_attack_hit → arm active1 → physical 120+0.40*bonusAD nested binary → consume mark 20110+20252/source+provider_target; bonusAD80→raw152/armor100→76; baseline raw120/60; t0/t3000 two AA only one P bonus no second W arm; W-before-P/P-before-W same; no W AS magnitude claim; shared W provider; Wasm exact test commit 7c84b36; mark production/duration/Valor/monster/R-disable/parry/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-quinn-harrier-premarked-consume',
          SEED.quinnHarrierPremarkedConsumeBackend,
          'completedBoundary: level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels; backend lol_generic_quinn_p_harrier_premarked_consume_seed.sql + LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest + README (owning 0a6301e; integrated 12d9281); Wasm exact test commit 7c84b36; extends existing W provider only; W rows check-only; nested binary add; 20110+20252; Web source asset exact parity (no Web change/commit); not live published',
        ),
      ],
    },
  ],
  [
    'hero_quinn|E',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_quinn E 旋翔掠杀/Vault：Wiki request Template:Data Quinn/E → resolved Template:Data Quinn/Vault；page1308957 / rev4024768 / timestamp 2026-06-03T00:51:11Z / canonical bytes2649 / SHA256 9f6baba1d062b473d41586cd8323f31bd7c1c4d865db134a783c19ae998e7714（normalized/generic/quinn-e.json）rank5 Phase-A v1 已由 wasm-generic-quinn-vault-primary-hit 闭环为 migrated——local raw caveat bytes2649 / SHA 317ac3ccf31e53ba17255dbb15c856ba5499d9257fbe0c9faa91b43f8438e24b（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；50 mana / 8000ms CD；immediate primary-champion scaffold；恰好一次 non-crit/non-copyable physical damage 140+0.20*(source.attr.ad.resolved-source.attr.ad.base)（nested binary add；冻结伤害公式无 distance multiplier——dash prose 非 distance-based damage modifier；交叉校验 baseAD59 / resolvedAD139 → raw156，armor100 → mitigated78；baseline resolvedAD59 → raw140/mitigated70）。Attempts t0/t7999/t8000 mana150 → two successes + exactly one cooldown skip without mana/damage；final mana 50；mana49 → resource skip/no hit。E 不产生 basic_attack_hit、不武装既有 Quinn W、不改变 AS；runtime 可合成既有 ability_started，不宣称全局零事件。completedBoundary：rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_140_plus_0_20_bonus_ad; no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks。明确排除 dash/tracking/bounce/range/speed/wall/geometry/grounded/knockdown、knockback/airborne/slow/control/facing/windup、Harrier/P/W interaction、basic-attack reset/fuzzy delay/autoattack、failed-too-far、spellshield/callforhelp、ranks1–4、other Quinn skills/basic、loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 dash/tracking/bounce/knockback/slow/Harrier/basic-attack-reset/完整游戏保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-quinn-vault-primary-hit',
          WASM.quinnVaultPrimaryHit,
          'completedBoundary: rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_140_plus_0_20_bonus_ad; no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks; Wiki request Template:Data Quinn/E → Vault; rev4024768/SHA256 9f6baba1… / bytes2649; local raw caveat bytes2649/SHA 317ac3cc… no equivalence claim; rank5 50 mana/8000ms CD / one physical 140+0.20*bonusAD nested binary add; no distance multiplier; baseAD59/resolvedAD139→raw156/armor100→78; baseline resolvedAD59→raw140/mitigated70; t0/t7999/t8000 mana150 two successes + one CD skip final mana50; mana49 resource skip/no hit; no basic_attack_hit / does not arm Quinn W / no AS change; may synthesize ability_started (not globally zero events); Wasm exact test commit bfe9e5b; dash/tracking/bounce/knockback/slow/Harrier/basic-attack-reset/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-quinn-vault-primary-hit',
          SEED.quinnVaultPrimaryHitBackend,
          'completedBoundary: rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_140_plus_0_20_bonus_ad; no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks; backend lol_generic_quinn_vault_primary_hit_seed.sql + LolGenericQuinnVaultPrimaryHitSeedSqlTest + README (owning c487eb4; integrated 3f698ab); Wasm exact test commit bfe9e5b; nested binary add; Web source asset exact parity (no Web change/commit); not live published',
        ),
      ],
    },
  ],
  [
    'hero_quinn|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'ap_ratio',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_quinn Q 炫目攻势/Blinding Assault：Wiki request Template:Data Quinn/Q → resolved Template:Data Quinn/Blinding Assault；page1308954 / rev4024766 / timestamp 2026-06-03T00:49:42Z / canonical bytes1742 / SHA256 abce6abdc2eefd069beba2d4297a1c9da5b1a675a426edb747346d9679d8085d（normalized/generic/quinn-q.json）rank5 Phase-A v1 已由 wasm-generic-quinn-blinding-assault-primary-hit 闭环为 migrated——local raw caveat bytes1742 / SHA be8878560c7d6541440d952788e40aeba0bef25a49955379df26f45ec82737bd（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；70 mana / 9000ms CD；immediate primary-champion scaffold；恰好一次 non-crit/non-copyable physical damage 205+1.00*(source.attr.ad.resolved-source.attr.ad.base)+0.50*source.attr.ap.resolved（nested binary add；交叉校验 baseAD59 / resolvedAD139 / AP100 → raw335，armor100 → mitigated167.5；分支 raw205/285/255/335 与 mitigated102.5/142.5/127.5/167.5）。Attempts t0/t8999/t9000 mana210 → two successes + exactly one cooldown skip without mana/damage；final mana 70；mana69 → resource skip/no hit。Q 不产生 basic_attack_hit、不武装既有 Quinn W、不改变 AS；runtime 可合成既有 ability_started，不宣称全局零事件。completedBoundary：rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_205_plus_1_00_bonus_ad_plus_0_50_ap; no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks。明确排除 Valor entity/AI、cast delay、direction/projectile/speed/travel/collision/range/width/radius/geometry/AOE/multitarget、monster double、Harrier/P/W interaction、nearsight/disarm/sight/control/death persistence、ranks1–4、other Quinn skills/basic、loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 Valor/projectile/geometry/AOE/Harrier/nearsight/disarm/完整游戏保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-quinn-blinding-assault-primary-hit',
          WASM.quinnBlindingAssaultPrimaryHit,
          'completedBoundary: rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_205_plus_1_00_bonus_ad_plus_0_50_ap; no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks; Wiki request Template:Data Quinn/Q → Blinding Assault; rev4024766/SHA256 abce6abd… / bytes1742; local raw caveat bytes1742/SHA be887856… no equivalence claim; rank5 70 mana/9000ms CD / one physical 205+1.00*bonusAD+0.50*AP nested binary add; baseAD59/resolvedAD139/AP100→raw335/armor100→167.5; branches raw205/285/255/335 mitigated102.5/142.5/127.5/167.5; t0/t8999/t9000 mana210 two successes + one CD skip final mana70; mana69 resource skip/no hit; no basic_attack_hit / does not arm Quinn W / no AS change; may synthesize ability_started (not globally zero events); Wasm exact test commit ba71996; Valor/projectile/geometry/AOE/Harrier/nearsight/disarm/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-quinn-blinding-assault-primary-hit',
          SEED.quinnBlindingAssaultPrimaryHitBackend,
          'completedBoundary: rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_205_plus_1_00_bonus_ad_plus_0_50_ap; no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks; backend lol_generic_quinn_blinding_assault_primary_hit_seed.sql + LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest + README (owning 5c174b5; integrated e030cd9); Wasm exact test commit ba71996; nested binary add; Web source asset exact parity (no Web change/commit); not live published',
        ),
      ],
    },
  ],
  [
    'hero_quinn|W',
    {
      classification: 'migrated',
      tags: ['target_state_conditioned_attack_speed', 'vulnerable'],
      reason:
        'hero_quinn W 敏锐感知/Heightened Senses Wiki rank-5 +80% AS/2s 目标状态条件攻速核心已由 wasm-generic-quinn-heightened-senses 闭环：真实 CompileGeneric+RunGeneric；预先存在 harrier_vulnerable target-state 时 basic_attack_hit 后 +80% AS 持续 2s；覆盖无易损不触发、触发、到期、refresh、target 隔离、phantom 不刷新、base 不污染；证据 wasm/tinygo_engine_v2/internal/runtime/generic_quinn_heightened_senses_test.go 与 db/game_manage/seeds/lol_generic_quinn_heightened_senses_seed.sql。Harrier 产生/额外伤害与 W 主动视野/移速明确不在本 W 伤害分支内。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-quinn-heightened-senses',
          WASM.quinnHeightenedSenses,
          'completedBoundary: preexisting harrier_vulnerable + basic_attack_hit → Wiki rank5 +80% AS 2s; harrier produce/bonus dmg and W vision/MS intentionally outside this W damage branch',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-quinn-heightened-senses',
          SEED.quinnHeightenedSensesBackend,
          'completedBoundary: Heightened Senses Wiki rank5 +80% AS core seeded; backend lol_generic_quinn_heightened_senses_seed.sql; not live published',
        ),
      ],
    },
  ],
  [
    'hero_xayah|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_xayah Q 双刃/Double Daggers：Wiki request Template:Data Xayah/Q → resolved Template:Data Xayah/Double Daggers；page1324541 / rev4008615 / timestamp 2026-04-15T00:26:21Z / canonical bytes2615 / SHA256 8010e567d2366730c5eb6cd0a31baec09c7f5137018ab2ca15fd84f167d990fd（normalized/generic/xayah-q.json plus pages sibling are authority）rank5 Phase-A v3 已由 wasm-generic-xayah-double-daggers-primary-two-hit 闭环为 migrated——live redirect page1324536/rev2864045 is live request detail only and is not stored in the sidecar；local raw caveat bytes2615 / SHA 6a1fde0a18de0b6f28e55be7df27e58f99c91d49310e79ae81a9e95384f974de（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；35 mana / 8000ms CD；immediate primary-champion two-feather scaffold；恰好两次有序 non-crit/non-copyable physical hits，each 105+0.50*(source.attr.ad.resolved-source.attr.ad.base)（nested binary formula；交叉校验 baseAD60/resolvedAD60 each105/total210，armor100 each52.5/total105；resolvedAD110 each130/total260，armor100 each65/total130）。Attempts t0/t7999/t8000 mana105/HP1000/armor100 → two successes + exactly one cooldown skip，four damage items；final mana35/HP740；two automatic ability_started；mana34 → resource skip/unchanged。Required Xayah W isolation coexistence：Q success/skip does not arm W and AS stays baseline；W success while Q mounted arms only W and causes zero Q damage；Backend W listener uses ability/xayah_deadly_plumage ALL matcher with ability_id NULL；runtime W ListenerDefinition.AbilityRef stays empty。completedBoundary：rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks。明确排除 cast time/attack lockout/effect-at-cast-end、direction/range/width/geometry、projectile/travel/collision/interception/spellshield、later-target 50% reduction、multitarget/formation/area、feather generation/ground state/E interaction、ranks1–4、P/E/R/basic/equipment/loadout/crit/on-hit、live migration/publish/E2E/full game fidelity；不宣称 cast-time/attack-lockout/direction/range/width/projectile/travel/interception/spellshield/secondary-target-reduction/feather-generation/ground-state/E/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（Xayah/ad/mana plus corrected W isolation prerequisites），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-xayah-double-daggers-primary-two-hit',
          WASM.xayahDoubleDaggersPrimaryTwoHit,
          'completedBoundary: rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks; Wiki request Template:Data Xayah/Q → Double Daggers; rev4008615/SHA256 8010e567… / bytes2615; local raw caveat bytes2615/SHA 6a1fde0a… no equivalence claim; live redirect page1324536/rev2864045 not stored in sidecar; rank5 35 mana/8000ms CD / two ordered physical 105+0.50*bonusAD nested binary; baseAD60/resolvedAD60 each105/total210 armor100 each52.5/total105; resolvedAD110 each130/total260 armor100 each65/total130; t0/t7999/t8000 mana105/HP1000 two successes + one CD skip four damage items final mana35/HP740 two ability_started; mana34 resource skip unchanged; Q success/skip does not arm W / AS baseline; W success while Q mounted arms only W / zero Q damage; Backend W ability/xayah_deadly_plumage ALL matcher ability_id NULL; runtime W ListenerDefinition.AbilityRef empty; Wasm exact test commit dd7dae6; cast-time/lockout/direction/range/projectile/interception/spellshield/secondary-reduction/feather/ground/E/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-xayah-double-daggers-primary-two-hit',
          SEED.xayahDoubleDaggersPrimaryTwoHitBackend,
          'completedBoundary: rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks; backend lol_generic_xayah_double_daggers_primary_two_hit_seed.sql + LolGenericXayahDoubleDaggersPrimaryTwoHitSeedSqlTest (owning 8ace954; integrated 6bab0b8); Wasm exact test commit dd7dae6; nested binary; external existing-data/check-only prerequisites (Xayah/ad/mana plus corrected W isolation; does not write identity/panel/resource values); not live published',
        ),
      ],
    },
  ],
  [
    'hero_xayah|R',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_xayah R 暴风羽刃/Featherstorm：Wiki request Template:Data Xayah/R → resolved Template:Data Xayah/Featherstorm；page1324544 / rev4008617 / timestamp 2026-04-15T00:26:44Z / canonical bytes1761 / SHA256 cb5c8ba5486a55027e7c2252589fa8e5d821d346cc44afa99243de71ce5b3077（normalized/generic/xayah-r.json plus pages sibling are authority）rank3 Phase-A v2 已由 wasm-generic-xayah-featherstorm-primary-hit 闭环为 migrated——local raw caveat bytes1761 / SHA debf23b0213a4d9669a29f6c415a6f67d582b7093d25059b7765745bed43ace1（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；100 mana / 100000ms CD；immediate primary-champion one physical damage quantum scaffold；one selected application of the leveling-labeled amount as an immediate bounded primary-champion physical damage quantum 400 + 1.00*(source.attr.ad.resolved-source.attr.ad.base)；exactly one noncrit/noncopyable physical damage operation（交叉校验 baseAD60/resolvedAD60 raw400，armor0=400，armor100=200；baseAD60/resolvedAD110 raw450，armor0=450，armor100=225）。Attempts t0/t99999/t100000 mana300/HP1000/armor100/resolvedAD110 → two successes + exactly one cooldown skip，two R damage-quantum items；final mana100/HP550；two automatic R ability_started；mana99 → resource skip/unchanged。Required Xayah W/Q/R isolation：R and Q never arm W；W self-cast arms W；R remains one quantum，Q remains two hits；definitions/mounts/snapshots remain distinct；Backend W listener uses ability/xayah_deadly_plumage ALL matcher with ability_id NULL；runtime W ListenerDefinition.AbilityRef stays empty。completedBoundary：rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity。明确排除 leap/ghosted/untargetable、one-second delay、attack/cast lockout、direction/cone/range/geometry、projectile/travel/collision/multitarget、feather generation/ground state/E dependency、other ranks、P/E/basic/equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 Wiki 证明完整 R once-only 或 complete Featherstorm 仅有一次总命中；不建模/宣称五次 damage ops 或同目标多羽基数。Backend seed 显式依赖 external existing-data/check-only 前置（Xayah/ad/mana plus corrected W isolation prerequisites；Q optional independent sibling），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-xayah-featherstorm-primary-hit',
          WASM.xayahFeatherstormPrimaryHit,
          'completedBoundary: rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity; Wiki request Template:Data Xayah/R → Featherstorm; rev4008617/SHA256 cb5c8ba5… / bytes1761; local raw caveat bytes1761/SHA debf23b0… no equivalence claim; rank3 100 mana/100000ms CD / one physical damage quantum 400+1.00*bonusAD; baseAD60/resolvedAD60 raw400 armor0=400 armor100=200; resolvedAD110 raw450 armor0=450 armor100=225; t0/t99999/t100000 mana300/HP1000/armor100 two successes + one CD skip two R damage-quantum items final mana100/HP550 two automatic R ability_started; mana99 resource skip unchanged; R and Q never arm W; W self-cast arms W; R one quantum / Q two hits; Backend W ability/xayah_deadly_plumage ALL matcher ability_id NULL; runtime W ListenerDefinition.AbilityRef empty; Wasm exact test commit 57ec17c; leap/ghosted/untargetable/one-second-delay/lockout/direction/cone/projectile/multitarget/feather/ground/E/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A; no claim Wiki proves whole-R once-only or complete Featherstorm one total hit; no five damage ops or same-target multi-feather cardinality',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-xayah-featherstorm-primary-hit',
          SEED.xayahFeatherstormPrimaryHitBackend,
          'completedBoundary: rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity; backend lol_generic_xayah_featherstorm_primary_hit_seed.sql + LolGenericXayahFeatherstormPrimaryHitSeedSqlTest (owning 354fd287; integrated 741e1ff); Wasm exact test commit 57ec17c; external existing-data/check-only prerequisites (Xayah/ad/mana plus corrected W isolation; Q optional independent sibling; does not write identity/panel/resource values); not live published',
        ),
      ],
    },
  ],
  [
    'hero_xayah|W',
    {
      classification: 'migrated',
      tags: ['cast_triggered_timed_attack_speed', 'attack_speed_percent_add', 'secondary_feather_ratio_damage'],
      reason:
        "hero_xayah W 致死羽衣/Deadly Plumage：Wiki rev4010669 / SHA256 09d5476533722311e85c4ca79813cd0bec2cf35d105be894b80dac14478845a7（normalized/generic/xayah-w.json）rank5 Phase-A 1v1 已由 wasm-generic-xayah-deadly-plumage 闭环为 migrated——40 mana / 14000ms CD / 4000ms timed AS +55%；Wiki 次级羽刃 25% → source-owned pipeline basic_damage*(1+0.25*deadly_plumage_active) @ outgoing_pre_mitigation（合并 1.25× 倍率，非第二 missile/伤害实例）；expected-crit 一次后再 ×1.25 一次；排除 on-hit/proc；Guinsoo phantom 不重放非 CopyableOnHit 基攻且不重跑倍率；wasm generic_xayah_deadly_plumage_test.go + backend lol_generic_xayah_deadly_plumage_seed.sql（未 live publish）。completedBoundary exclusions：移速/Rakan/Runaan/多目标/projectile/in-flight/ward/blind/dodge/block/独立次级羽刃/其它 rank/完整 live 保真。",
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-xayah-deadly-plumage',
          WASM.xayahDeadlyPlumage,
          'completedBoundary: Wiki rev4010669/SHA256 09d54765… rank5 40 mana/14000ms CD/4000ms +55% AS; source-owned basic_damage*(1+0.25*state) expected-crit once; on-hit/proc excluded; phantom non-replay; MS/Rakan/Runaan/projectile/separate missile/other ranks intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-xayah-deadly-plumage',
          SEED.xayahDeadlyPlumageBackend,
          'completedBoundary: Deadly Plumage Phase-A seeded (AS + basic_damage×1.25 excl on-hit/proc); backend lol_generic_xayah_deadly_plumage_seed.sql; not live published',
        ),
      ],
    },
  ],
  [
    'hero_jinx|W',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_jinx W 震荡电磁波！/Zap!：Wiki request Template:Data Jinx/W → resolved Template:Data Jinx/Zap!；page1307598 / rev3907092 / timestamp 2025-06-06T17:47:18Z / canonical bytes1321 / SHA256 8aa6ac3943076256fe6afea15f1dd6eebf892656be45784e2522abb6243f4d1f（normalized/generic/jinx-w.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-jinx-zap-primary-hit 闭环为 migrated——local raw caveat bytes1319 / SHA c373cc258c5c8c612930a32c5e851bd4b68dbbcb3c0d7f71ce1d25020ba12624（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；60 mana / 4000ms CD；immediate primary-champion single physical hit scaffold；one selected immediate primary-champion physical damage operation 210 + 1.40 * source.attr.ad.resolved（total AD；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（交叉校验 totalAD60 raw294；armor0=294，armor100=147。totalAD110 raw364；armor0=364，armor100=182）。Attempts mana180/HP1000/AD110/armor100 at t0/t3999/t4000 → success/skip/success，exactly two W damage items；final mana60/HP636；exactly two automatic W ability_started；mana59 at t0 → resource skip with mana/HP unchanged and no W damage/event。Jinx W is standalone；Backend has no repository-owned hero_jinx / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Jinx synthesis。completedBoundary：rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_1_40_total_ad; no_cast_timing_direction_range_width_projectile_travel_collision_first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity。明确排除 cast timing、direction/range/width/geometry、projectile travel/collision/first-enemy acquisition、sight/reveal、slow、other ranks、other Jinx abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 cast/direction/projectile/sight/reveal/slow/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_jinx/ad/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-jinx-zap-primary-hit',
          WASM.jinxZapPrimaryHit,
          'completedBoundary: rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_1_40_total_ad; no_cast_timing_direction_range_width_projectile_travel_collision_first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity; Wiki request Template:Data Jinx/W → Zap!; rev3907092/SHA256 8aa6ac39… / bytes1321; local raw caveat bytes1319/SHA c373cc25… no equivalence claim; rank5 60 mana/4000ms CD / one physical 210+1.40*totalAD; totalAD60 raw294 armor0=294 armor100=147; totalAD110 raw364 armor0=364 armor100=182; mana180/HP1000/AD110/armor100 t0/t3999/t4000 success/skip/success two W damage items final mana60/HP636 two automatic W ability_started; mana59 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit 2afde02; cast/direction/range/width/projectile/travel/collision/first-enemy/sight/reveal/slow/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-jinx-zap-primary-hit',
          SEED.jinxZapPrimaryHitBackend,
          'completedBoundary: rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_1_40_total_ad; no_cast_timing_direction_range_width_projectile_travel_collision_first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity; backend lol_generic_jinx_zap_primary_hit_seed.sql + LolGenericJinxZapPrimaryHitSeedSqlTest (owning b5abdb7; integrated a09adf1); Wasm exact test commit 2afde02; external existing-data/check-only prerequisites (hero_jinx/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Jinx synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_jhin|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_jhin Q 曼舞手雷/Dancing Grenade：Wiki request Template:Data Jhin/Q → resolved Template:Data Jhin/Dancing Grenade；page1307579 / rev4007611 / timestamp 2026-04-12T07:23:12Z / canonical bytes1913 / SHA256 522c4b918067b4b035b6744eb3dc83ce64ba5d47f677ed8517fcb246111685f1（normalized/generic/jhin-q.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-jhin-dancing-grenade-primary-first-hit 闭环为 migrated——local raw caveat bytes1911 / SHA 17deceae0abe42034f805a166ae5a16932ffcb19925654e6aa39625f026dd0cb（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；60 mana / 5000ms CD；immediate selected-primary-champion first-grenade single physical hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable physical damage operation add(add(const 144, mul(const 0.74, read source.attr.ad.resolved)), mul(const 0.60, read source.attr.ap.resolved))（exact nested binary add；total AD direct read；never bonus AD/subtraction；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no Q ability-specific type）（交叉校验 AD0/AP0/armor0 raw=final144；AD100/AP0/armor0 raw=final218；AD0/AP100/armor0 raw=final204；AD100/AP100/armor0 raw=final278；AD100/AP100/armor100 raw278/final139；AD200/AP100/armor100 raw352/final176；baseAD0 vs baseAD60 at resolvedAD100/AP0/armor0 both218）。Attempts mana180/baseAD60/resolvedAD100/AP100/HP1000/armor100 at t0/t4999/t5000 → success/skip/success，exactly two Q damage items；final mana60/HP722；exactly two automatic Q ability_started；mana59 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Q/W isolation：preserve existing W without requiring/mutating/synthesizing/copying W；Q seed contains no W rows；test-only composition of independent graphs only。Jhin Q is standalone；Backend has no repository-owned hero_jhin / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Jhin synthesis。completedBoundary：rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity。明确排除 cast time/unit-targeted cancel conditions、projectile travel/first-target acquisition、bounce to up to three additional targets/nearest-unhit priority、target-death +35% later-bounce amplification/maximum final bounce、spellshield bounce-persistence、other ranks、other Jhin abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 cast/cancel/projectile/acquisition/bounce/nearest-unhit/death-amp/max-bounce/spellshield/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_jhin/ad/ap/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-jhin-dancing-grenade-primary-first-hit',
          WASM.jhinDancingGrenadePrimaryFirstHit,
          'completedBoundary: rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity; Wiki request Template:Data Jhin/Q → Dancing Grenade; rev4007611/SHA256 522c4b91… / bytes1913; local raw caveat bytes1911/SHA 17deceae… no equivalence claim; rank5 60 mana/5000ms CD / one physical 144+0.74*totalAD+0.60*AP nested binary add; AD0/AP0/armor0=144; AD100/AP0/armor0=218; AD0/AP100/armor0=204; AD100/AP100/armor0=278; AD100/AP100/armor100 raw278/final139; AD200/AP100/armor100 raw352/final176; baseAD0 vs baseAD60 at resolvedAD100/AP0/armor0 both218; damage 20220/add 20170; no 20230; no explicit event op; no Q type; mana180/baseAD60/resolvedAD100/AP100/HP1000/armor100 t0/t4999/t5000 success/skip/success two Q damage items final mana60/HP722 two automatic Q ability_started; mana59 resource skip unchanged; Q/W isolation preserve existing W; standalone no sibling synthesis; Wasm exact test commit f70be27 bytes71563/SHA deaa6604…; cast/cancel/projectile/acquisition/bounce/nearest-unhit/death-amp/max-bounce/spellshield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-jhin-dancing-grenade-primary-first-hit',
          SEED.jhinDancingGrenadePrimaryFirstHitBackend,
          'completedBoundary: rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity; backend lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql + LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest (owning ce22594; integrated 488898e); Wasm exact test commit f70be27; external existing-data/check-only prerequisites (hero_jhin/ad/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Jhin synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_jhin|W',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_jhin W 致命华彩/Deadly Flourish：Wiki request Template:Data Jhin/W → resolved Template:Data Jhin/Deadly Flourish；page1307581 / rev4021795 / timestamp 2026-05-21T13:25:33Z / canonical bytes2942 / SHA256 14790ca09f6f320fc2fadc81c2fa7e783c7b81d48d792b7760494f2e8d788c65（normalized/generic/jhin-w.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-jhin-deadly-flourish-primary-hit 闭环为 migrated——local raw caveat bytes2940 / SHA 76790ba522dc101bb1f1c24ae620f80e8db6d10e890515cbc7da85005a67f78b（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；70 mana / 12000ms CD；immediate primary-champion single physical hit scaffold；one selected immediate primary-champion physical damage operation 210 + 0.50 * source.attr.ad.resolved（total AD；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（交叉校验 totalAD60 raw240；armor0=240，armor100=120。totalAD100 raw260；armor0=260，armor100=130）。Attempts mana210/HP1000/AD100/armor100 at t0/t11999/t12000 → success/skip/success，exactly two W damage items；final mana70/HP740；exactly two automatic W ability_started；mana69 at t0 → resource skip with mana/HP unchanged and no W damage/event。Minion-only 25% reduction does not apply to the selected champion and is excluded。Jhin W is standalone；Backend has no repository-owned hero_jhin / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Jhin synthesis。completedBoundary：rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_0_50_total_ad; no_cast_timing_direction_range_width_line_geometry_multitarget_champion_collision_projectile_interception_spell_shield_mark_creation_mark_detection_root_bonus_movement_speed_minion_reduction_other_ranks_or_full_fidelity。明确排除 cast timing/Effect-at-cast-start、direction/range/width/line geometry/multitarget/champion collision、projectile identity/interception/spell shield/facing、mark creation/detection/duration、root/control/tenacity、bonus movement speed、minion reduction、other ranks、other Jhin abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 cast/direction/line/projectile/mark/root/minion/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_jhin/ad/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-jhin-deadly-flourish-primary-hit',
          WASM.jhinDeadlyFlourishPrimaryHit,
          'completedBoundary: rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_0_50_total_ad; no_cast_timing_direction_range_width_line_geometry_multitarget_champion_collision_projectile_interception_spell_shield_mark_creation_mark_detection_root_bonus_movement_speed_minion_reduction_other_ranks_or_full_fidelity; Wiki request Template:Data Jhin/W → Deadly Flourish; rev4021795/SHA256 14790ca0… / bytes2942; local raw caveat bytes2940/SHA 76790ba5… no equivalence claim; rank5 70 mana/12000ms CD / one physical 210+0.50*totalAD; totalAD60 raw240 armor0=240 armor100=120; totalAD100 raw260 armor0=260 armor100=130; mana210/HP1000/AD100/armor100 t0/t11999/t12000 success/skip/success two W damage items final mana70/HP740 two automatic W ability_started; mana69 resource skip unchanged; selected-champion minion-reduction excluded; standalone no sibling synthesis; Wasm exact test commit d62d2e4; cast/direction/range/width/line/multitarget/collision/projectile/interception/spell-shield/mark/root/ms/minion/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-jhin-deadly-flourish-primary-hit',
          SEED.jhinDeadlyFlourishPrimaryHitBackend,
          'completedBoundary: rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_0_50_total_ad; no_cast_timing_direction_range_width_line_geometry_multitarget_champion_collision_projectile_interception_spell_shield_mark_creation_mark_detection_root_bonus_movement_speed_minion_reduction_other_ranks_or_full_fidelity; backend lol_generic_jhin_deadly_flourish_primary_hit_seed.sql + LolGenericJhinDeadlyFlourishPrimaryHitSeedSqlTest (owning 4903c00; integrated 0c103f8); Wasm exact test commit d62d2e4; external existing-data/check-only prerequisites (hero_jhin/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Jhin synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_caitlyn|E',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_caitlyn E 90口径绳网/90 Caliber Net：Wiki request Template:Data Caitlyn/E → resolved Template:Data Caitlyn/90 Caliber Net；page1306916 / rev4007584 / timestamp 2026-04-12T06:47:56Z / canonical bytes2095 / SHA256 9357e7b28b05f738cd8049a2d10a115e4033a54123c0e71f55d1262a92884db2（normalized/generic/caitlyn-e.json plus pages sibling are authority）rank5 Phase-A v3 已由 wasm-generic-caitlyn-90-caliber-net-primary-hit 闭环为 migrated——local raw caveat bytes2094 / SHA 3a5eba6df38ec34046440743d55de61490dc7b5a2488b8fc671851474d080073（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；75 mana / 8000ms CD；immediate primary-champion first-enemy single magic hit scaffold；one selected immediate primary-champion magic damage operation 280 + 0.80 * source.attr.ap.resolved；exactly one noncrit/noncopyable magic damage operation（damage type 20221 + add policy 20170；20230 forbidden）（交叉校验 AP0 → raw/mit 280/140；AP100 → raw/mit 360/180）。Attempts mana225/HP1000/AP100/MR100 at t0/t7999/t8000 → success/skip/success，exactly two E damage items；final mana75/HP640；exactly two automatic E ability_started；mana74 at t0 → resource skip with mana/HP unchanged and no E damage/event。Caitlyn E is standalone；Backend has no repository-owned hero_caitlyn / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Caitlyn synthesis。completedBoundary：rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; magic_280_plus_0_80_ap; no_cast_timing_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_suppression_spell_shield_recoil_dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_full_fidelity。明确排除 cast timing/Effect-at-cast-end、direction/range/width/line geometry/multitarget/first-enemy acquisition/collision、projectile/suppression/interception/spell shield、recoil/dash/terrain/buffered actions、slow/control/tenacity、Headshot/mark、other ranks、other Caitlyn abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 cast/direction/line/projectile/recoil/dash/slow/Headshot/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_caitlyn/ap/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-caitlyn-90-caliber-net-primary-hit',
          WASM.caitlyn90CaliberNetPrimaryHit,
          'completedBoundary: rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; magic_280_plus_0_80_ap; no_cast_timing_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_suppression_spell_shield_recoil_dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_full_fidelity; Wiki request Template:Data Caitlyn/E → 90 Caliber Net; rev4007584/SHA256 9357e7b2… / bytes2095; local raw caveat bytes2094/SHA 3a5eba6d… no equivalence claim; rank5 75 mana/8000ms CD / one magic 280+0.80*AP; AP0 raw/mit 280/140; AP100 raw/mit 360/180; damage 20221/add 20170/20230 forbidden; mana225/HP1000/AP100/MR100 t0/t7999/t8000 success/skip/success two E damage items final mana75/HP640 two automatic E ability_started; mana74 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit 4433ef1; cast/direction/range/width/line/multitarget/first-enemy/projectile/suppression/spell-shield/recoil/dash/terrain/buffer/slow/Headshot/mark/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-caitlyn-90-caliber-net-primary-hit',
          SEED.caitlyn90CaliberNetPrimaryHitBackend,
          'completedBoundary: rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; magic_280_plus_0_80_ap; no_cast_timing_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_suppression_spell_shield_recoil_dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_full_fidelity; backend lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql + LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest (owning 9506d01; integrated 384d658); Wasm exact test commit 4433ef1; external existing-data/check-only prerequisites (hero_caitlyn/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Caitlyn synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_kalista|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_kalista Q 穿刺/Pierce：Wiki request Template:Data Kalista/Q → resolved Template:Data Kalista/Pierce；page1307666 / rev3997075 / timestamp 2026-03-06T15:53:18Z / canonical bytes1625 / SHA256 90c490d921da436134c318249fa7d0038ceaa97dfb76e5bdaa0b330a43676a67（normalized/generic/kalista-q.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-kalista-pierce-primary-hit 闭环为 migrated——local raw caveat bytes1623 / SHA 0b8dd9cf9b40aae52fb6180ecabae7e459970f2f7c4d05711463df25fdbd1c94（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；80 mana / 9000ms CD；immediate primary-champion first-enemy single physical hit scaffold；one selected immediate primary-champion physical damage operation 270 + 1.05 * source.attr.ad.resolved（total AD；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no explicit event op）（交叉校验 (AD0,A0)=(270,270)；(AD0,A100)=(270,135)；(AD100,A0)=(375,375)；(AD100,A100)=(375,187.5)；(AD200,A100)=(480,240)）。Attempts mana240/HP1000/AD100/armor100 at t0/t8999/t9000 → success/skip/success，exactly two Q damage items；final mana80/HP625；exactly two automatic Q ability_started；mana79 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Kalista Q is standalone；Backend has no repository-owned hero_kalista / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Kalista synthesis。completedBoundary：rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_270_plus_1_05_total_ad; no_cast_timing_martial_poise_dash_cancel_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_interception_spell_shield_kill_continuation_rend_stack_transfer_other_ranks_or_full_fidelity。明确排除 cast timing/Effect-at-cast-end、Martial Poise/dash cancel、direction/range/width/line geometry/multitarget/first-enemy acquisition/collision、projectile/interception/spell shield、kill continuation/Rend stack transfer、other ranks、other Kalista abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 cast/Martial Poise/direction/line/projectile/kill/Rend/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_kalista/ad/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-kalista-pierce-primary-hit',
          WASM.kalistaPiercePrimaryHit,
          'completedBoundary: rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_270_plus_1_05_total_ad; no_cast_timing_martial_poise_dash_cancel_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_interception_spell_shield_kill_continuation_rend_stack_transfer_other_ranks_or_full_fidelity; Wiki request Template:Data Kalista/Q → Pierce; rev3997075/SHA256 90c490d9… / bytes1625; local raw caveat bytes1623/SHA 0b8dd9cf… no equivalence claim; rank5 80 mana/9000ms CD / one physical 270+1.05*totalAD; (AD0,A0)=(270,270); (AD0,A100)=(270,135); (AD100,A0)=(375,375); (AD100,A100)=(375,187.5); (AD200,A100)=(480,240); damage 20220/add 20170; no explicit event op; mana240/HP1000/AD100/armor100 t0/t8999/t9000 success/skip/success two Q damage items final mana80/HP625 two automatic Q ability_started; mana79 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit 99e7b39; cast/Martial-Poise/dash/direction/range/width/line/multitarget/first-enemy/projectile/interception/spell-shield/kill/Rend/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-kalista-pierce-primary-hit',
          SEED.kalistaPiercePrimaryHitBackend,
          'completedBoundary: rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_270_plus_1_05_total_ad; no_cast_timing_martial_poise_dash_cancel_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_interception_spell_shield_kill_continuation_rend_stack_transfer_other_ranks_or_full_fidelity; backend lol_generic_kalista_pierce_primary_hit_seed.sql + LolGenericKalistaPiercePrimaryHitSeedSqlTest (owning 04c061f; integrated bdb5d32); Wasm exact test commit 99e7b39; external existing-data/check-only prerequisites (hero_kalista/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Kalista synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_caitlyn|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_caitlyn Q 和平使者/Piltover Peacemaker：Wiki request Template:Data Caitlyn/Q → resolved Template:Data Caitlyn/Piltover Peacemaker；page1306911 / rev4007583 / timestamp 2026-04-12T06:47:12Z / canonical bytes1841 / SHA256 6c40deba7b6e60ab9c06bc014a214a8be4319c4ddf22c550237b659f19307caf（normalized/generic/caitlyn-q.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit 闭环为 migrated——local raw caveat bytes1838 / SHA 93da300971429a629f11a721c3993784db6a99d3559b1286eae9500176560b9a（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；75 mana / 6000ms CD；immediate primary-champion first-enemy full physical hit scaffold；one selected immediate primary-champion physical damage operation 210 + 2.05 * source.attr.ad.resolved（total AD；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no explicit event op）（交叉校验 (AD0,A0)=(210,210)；(AD0,A100)=(210,105)；(AD100,A0)=(415,415)；(AD100,A100)=(415,207.5)；(AD200,A100)=(620,310)）。Attempts mana225/HP1000/AD100/armor100 at t0/t5999/t6000 → success/skip/success，exactly two Q damage items；final mana75/HP585；exactly two automatic Q ability_started；mana74 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Caitlyn Q is standalone；Backend has no repository-owned hero_caitlyn / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Caitlyn synthesis。completedBoundary：rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; physical_210_plus_2_05_total_ad; no_cast_timing_attack_timer_reset_direction_range_width_line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_full_damage_projectile_spell_shield_other_ranks_or_full_fidelity。明确排除 cast timing/Effect-at-cast-start、attack timer reset、direction/range/width/line geometry/multitarget/post-first-enemy 60% damage、trap/reveal、full-damage projectile/spell shield、other ranks、other Caitlyn abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 cast/attack-timer-reset/direction/line/projectile/trap/reveal/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_caitlyn/ad/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit',
          WASM.caitlynPiltoverPeacemakerFirstEnemyHit,
          'completedBoundary: rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; physical_210_plus_2_05_total_ad; no_cast_timing_attack_timer_reset_direction_range_width_line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_full_damage_projectile_spell_shield_other_ranks_or_full_fidelity; Wiki request Template:Data Caitlyn/Q → Piltover Peacemaker; rev4007583/SHA256 6c40deba… / bytes1841; local raw caveat bytes1838/SHA 93da3009… no equivalence claim; rank5 75 mana/6000ms CD / one physical 210+2.05*totalAD; (AD0,A0)=(210,210); (AD0,A100)=(210,105); (AD100,A0)=(415,415); (AD100,A100)=(415,207.5); (AD200,A100)=(620,310); damage 20220/add 20170; no explicit event op; mana225/HP1000/AD100/armor100 t0/t5999/t6000 success/skip/success two Q damage items final mana75/HP585 two automatic Q ability_started; mana74 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit 0fe29e7; cast/attack-timer-reset/direction/range/width/line/multitarget/post-first-enemy-60%/trap/reveal/projectile/spell-shield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit',
          SEED.caitlynPiltoverPeacemakerFirstEnemyHitBackend,
          'completedBoundary: rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; physical_210_plus_2_05_total_ad; no_cast_timing_attack_timer_reset_direction_range_width_line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_full_damage_projectile_spell_shield_other_ranks_or_full_fidelity; backend lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql + LolGenericCaitlynPiltoverPeacemakerFirstEnemyHitSeedSqlTest (owning b5ef446; integrated 245a111); Wasm exact test commit 0fe29e7; external existing-data/check-only prerequisites (hero_caitlyn/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Caitlyn synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_caitlyn|R',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_caitlyn R 让子弹飞/Ace in the Hole：Wiki request Template:Data Caitlyn/R → resolved Template:Data Caitlyn/Ace in the Hole；page1306918 / rev3982561 / timestamp 2026-01-09T09:02:59Z / canonical bytes3119 / SHA256 08b488c97fc694d9a3de711ffd4ea0b95fc1746c3a11b9c44b878844e586e8a8（normalized/generic/caitlyn-r.json plus pages sibling are authority）rank3 Phase-A v1 已由 wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum 闭环为 migrated——local raw caveat bytes3119 / SHA 015c1dbe8f02dd5ac354e6a6da6def878f1acccf788b1f599ee4bfd589e05003（canonical identity remains sidecar/pages；no equivalence or contradiction claim；equal size alone is not byte equality or source contradiction）；100 mana / 90000ms CD；immediate selected-primary-champion single physical bullet-quantum scaffold；one immediate selected-primary-champion single noncritical/noncopyable physical damage quantum 650 + 1.00 * (source.attr.ad.resolved - source.attr.ad.base)（exact nested binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no explicit event op；ability_started is automatic）（交叉校验 base0/resolved0/armor0 raw=final650；base60/resolved60/armor0 raw=final650；base60/resolved160/armor0 raw=final750；base60/resolved160/armor100 raw750/final375；base60/resolved260/armor100 raw850/final425；base0/resolved100 versus base60/resolved160 armor0 both750）。Attempts mana300/baseAD60/resolvedAD160/HP1000/armor100 at t0/t89999/t90000 → success/skip/success，exactly two R damage items；final mana100/HP250；exactly two automatic R ability_started；mana99 at t0 → resource skip with mana/HP unchanged and no R damage/event。Caitlyn R provider is standalone；Backend has no repository-owned hero_caitlyn / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Caitlyn Q/E dependence；不暗示 Batch-B 或 sibling Caitlyn synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Cursor focused9/adjacent27/full902 passed；Main focused and adjacent passed；default full twice hit an existing isolated LolGenericKogmawLivingArtillerySeedSqlTest java.util.regex.StackOverflowError，while isolated Kog\'Maw passed and main full passed902/902 with MAVEN_OPTS=-Xss4m（nonblocking validation-runtime caveat；not a Caitlyn R contract failure）。Wasm main validation passed gofmt/focused/full/bench/build/smoke/benchmark；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity。明确排除 channel/locks/reveal/self-reveal/cancel/refund/short cooldown、homing/projectile/travel/interception/first-enemy geometry、crit scaling、untargetable/resurrection/target death/corpse/sight radius、unit-target cancel conditions/ability lockout、ranks1-2、siblings/loadout/on-hit/live/full fidelity；this is exactly one selected-target quantum, not full R；不宣称 channel/reveal/homing/projectile/crit/untargetable/resurrection/corpse/sight/cancel/lockout/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_caitlyn/ad/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum',
          WASM.caitlynAceInTheHoleSingleBulletQuantum,
          'completedBoundary: rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity; Wiki request Template:Data Caitlyn/R → Ace in the Hole; rev3982561/SHA256 08b488c9… / bytes3119; local raw caveat bytes3119/SHA 015c1dbe… no equivalence claim; rank3 100 mana/90000ms CD / one physical bullet quantum 650+1.00*bonusAD via nested binary sub(ad.resolved,ad.base); base0/resolved0/armor0=650; base60/resolved60/armor0=650; base60/resolved160/armor0=750; base60/resolved160/armor100 raw750/final375; base60/resolved260/armor100 raw850/final425; base0/resolved100 vs base60/resolved160 armor0 both750; damage 20220/add 20170; no explicit event op; mana300/baseAD60/resolvedAD160/HP1000/armor100 t0/t89999/t90000 success/skip/success two R damage items final mana100/HP250 two automatic R ability_started; mana99 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit 9fc57e7; channel/reveal/homing/projectile/crit/untargetable/resurrection/corpse/sight/cancel/lockout/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum',
          SEED.caitlynAceInTheHoleSingleBulletQuantumBackend,
          'completedBoundary: rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity; backend lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql + LolGenericCaitlynAceInTheHoleSingleBulletQuantumSeedSqlTest (owning f088e18; integrated 486b8d8); Wasm exact test commit 9fc57e7; external existing-data/check-only prerequisites (hero_caitlyn/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Caitlyn synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_tristana|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_attack_speed_modifier',
        'timed_state',
        'ability_type_listener_isolation',
      ],
      reason:
        'hero_tristana Q 急速射击/Rapid Fire：Wiki request Template:Data Tristana/Q → resolved Template:Data Tristana/Rapid Fire；page1308522 / rev4026462 / timestamp 2026-06-09T21:59:03Z / canonical bytes872 / SHA256 f6465863035c4634510ecc96e9ee04f4a998d150871d88e498e6636e27a9d4da（normalized/generic/tristana-q.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed 闭环为 migrated——local raw caveat bytes866 / SHA db084b4142559f0775af841fe163e1b80880e2661b26b6d82fb26261e1f5d170（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；35 mana / 16000ms CD；self timed bonus attack speed scaffold；timed state rapid_fire_active max1/7000ms；attack_speed percent_add 1.20*rapid_fire_active；game-local type62013 ability/tristana_rapid_fire；listener empty AbilityRef and exact all-match started/source_owner/Q-type；no damage or explicit event op；ability_started is automatic（fixture AS0.60→1.32 through6999→0.60 at7000）。Attempts mana105 at t0/t15999/t16000 → success/skip/success，exactly two automatic Q ability_started；final mana35/AS1.32；mana34 at t0 → resource skip with mana/AS unchanged；R does not arm Q and Q causes no R damage。Tristana Q provider is standalone；Backend has no repository-owned hero_tristana / attack_speed / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Tristana P/W/E/Explosive Charge dependence；不暗示 Batch-B 或 sibling Tristana synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Cursor focused11/adjacent49/full922 passed；Main focused11/adjacent49/full922 passed。Wasm main validation passed gofmt/focused6/full/bench/build/smoke/benchmark；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot; no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity。明确排除 rank-up update、attack animation/windup、basic attack count/rotation、cooldown bypass/reset/direct state admin、other ranks、siblings/loadout/bootstrap、Q damage/heal/shield/control/repeat/explicit event、Buster Shot dependency/synthesis、live/full fidelity；不宣称 rank-up/animation/windup/basic-count/rotation/CD-bypass/other-ranks/siblings/Q-damage/Buster-Shot-dependence/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_tristana/attack_speed/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed',
          WASM.tristanaRapidFireTimedBonusAttackSpeed,
          'completedBoundary: rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot; no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity; Wiki request Template:Data Tristana/Q → Rapid Fire; rev4026462/SHA256 f6465863… / bytes872; local raw caveat bytes866/SHA db084b41… no equivalence claim; rank5 35 mana/16000ms CD / timed rapid_fire_active 7000ms / attack_speed percent_add 1.20*rapid_fire_active; type62013 ability/tristana_rapid_fire; empty AbilityRef all-match started/source_owner/Q-type; no damage or explicit event op; AS0.60→1.32 through6999→0.60 at7000; mana105 t0/t15999/t16000 success/skip/success two automatic Q ability_started final mana35/AS1.32; mana34 resource skip unchanged; R does not arm Q and Q causes no R damage; standalone no sibling synthesis; Wasm exact test commit ddbca0f; rank-up/animation/windup/basic-count/rotation/CD-bypass/other-ranks/siblings/Q-damage/Buster-Shot-dependence/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed',
          SEED.tristanaRapidFireTimedBonusAttackSpeedBackend,
          'completedBoundary: rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot; no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity; backend lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql + LolGenericTristanaRapidFireTimedBonusAttackSpeedSeedSqlTest (owning abc7500; integrated 5d468bf); Wasm exact test commit ddbca0f; external existing-data/check-only prerequisites (hero_tristana/attack_speed/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Tristana synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_tristana|R',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'bonus_ad_ratio',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_tristana R 毁灭射击/Buster Shot：Wiki request Template:Data Tristana/R → resolved Template:Data Tristana/Buster Shot；page1308525 / rev4008205 / timestamp 2026-04-14T05:37:16Z / canonical bytes2385 / SHA256 2dff322949f442acc00a7074458fd5ed9bc542d6fd143b818a9a7151e117c058（normalized/generic/tristana-r.json plus pages sibling are authority）rank3 Phase-A v1 已由 wasm-generic-tristana-buster-shot-primary-hit 闭环为 migrated——local raw caveat bytes2382 / SHA 42e07f07f3188aada86d18d782c05d291f031dbbf92171e4a1120e828ebf8c7b（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；100 mana / 100000ms CD；immediate selected-primary-champion single magic hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable magic damage operation add(add(325,0.70*(source.attr.ad.resolved-source.attr.ad.base)),1.00*source.attr.ap.resolved)（exact nested binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable magic damage operation（damage type 20221 + add policy 20170；no explicit event op；ability_started is automatic）（交叉校验 base0/resolved0/AP0/MR0 raw=final325；base60/resolved60/AP0/MR0 raw=final325；base60/resolved160/AP0/MR0 raw=final395；base60/resolved160/AP100/MR0 raw=final495；base60/resolved160/AP100/MR100 raw495/final247.5；base60/resolved260/AP200/MR100 raw665/final332.5；base0/resolved100 versus base60/resolved160 AP100/MR0 both495）。Attempts mana300/baseAD60/resolvedAD160/AP100/HP1000/MR100 at t0/t99999/t100000 → success/skip/success，exactly two R damage items；final mana100/HP505；exactly two automatic R ability_started；mana99 at t0 → resource skip with mana/HP unchanged and no R damage/event。Tristana R provider is standalone；Backend has no repository-owned hero_tristana / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Tristana P/Q/W/E/Explosive Charge dependence；不暗示 Batch-B 或 sibling Tristana synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Cursor focused9/adjacent53/full911 passed；Main focused9/adjacent53/full911 passed。Wasm main validation passed gofmt/focused7/full/bench/build/smoke/benchmark；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_325_plus_0_70_bonus_ad_plus_1_00_ap; no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_other_ranks_or_full_fidelity。明确排除 cast time、knockback/stun/reveal、secondary zero damage/turret aggro、displacement/terrain/geometry/immunity、unit-target cancel、post-cast basic attack、Explosive Charge、ranks1-2、siblings/loadout/on-hit/live/full fidelity；this is exactly one selected-target magic hit, not full R；不宣称 cast/knockback/stun/reveal/secondary/terrain/displacement/immunity/unit-cancel/post-basic/Explosive-Charge/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_tristana/ad/ap/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-tristana-buster-shot-primary-hit',
          WASM.tristanaBusterShotPrimaryHit,
          'completedBoundary: rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_325_plus_0_70_bonus_ad_plus_1_00_ap; no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_other_ranks_or_full_fidelity; Wiki request Template:Data Tristana/R → Buster Shot; rev4008205/SHA256 2dff3229… / bytes2385; local raw caveat bytes2382/SHA 42e07f07… no equivalence claim; rank3 100 mana/100000ms CD / one magic 325+0.70*bonusAD+1.00*AP via nested binary add(add(325,0.70*(ad.resolved-ad.base)),1.00*ap.resolved); base0/resolved0/AP0/MR0=325; base60/resolved60/AP0/MR0=325; base60/resolved160/AP0/MR0=395; base60/resolved160/AP100/MR0=495; base60/resolved160/AP100/MR100 raw495/final247.5; base60/resolved260/AP200/MR100 raw665/final332.5; base0/resolved100 vs base60/resolved160 AP100/MR0 both495; damage 20221/add 20170; no explicit event op; mana300/baseAD60/resolvedAD160/AP100/HP1000/MR100 t0/t99999/t100000 success/skip/success two R damage items final mana100/HP505 two automatic R ability_started; mana99 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit b4d10e4; cast/knockback/stun/reveal/secondary/terrain/displacement/immunity/unit-cancel/post-basic/Explosive-Charge/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-tristana-buster-shot-primary-hit',
          SEED.tristanaBusterShotPrimaryHitBackend,
          'completedBoundary: rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_325_plus_0_70_bonus_ad_plus_1_00_ap; no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_other_ranks_or_full_fidelity; backend lol_generic_tristana_buster_shot_primary_hit_seed.sql + LolGenericTristanaBusterShotPrimaryHitSeedSqlTest (owning 8b98bcb; integrated 30209c4); Wasm exact test commit b4d10e4; external existing-data/check-only prerequisites (hero_tristana/ad/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Tristana synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_tristana|W',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'bonus_ad_ratio',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_tristana W 火箭跳跃/Rocket Jump：Wiki request Template:Data Tristana/W → resolved Template:Data Tristana/Rocket Jump；page1308523 / rev4007758 / timestamp 2026-04-12T14:13:05Z / canonical bytes2444 / SHA256 cf0e3ae91310ab5e7cc04408941671520e3464f75bc61da683b100ea82e56eec（normalized/generic/tristana-w.json plus pages sibling are authority）rank5 Phase-A v2 已由 wasm-generic-tristana-rocket-jump-primary-landing-hit 闭环为 migrated——local raw caveat bytes2443 / SHA 7283b2eb2020c20c6e48098e647ba4782b6dc134705c7c668d7e7279da1cabd9（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；50 mana / 14000ms CD；immediate selected-primary-champion single magic landing hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable magic damage operation add(add(210,1.00*(source.attr.ad.resolved-source.attr.ad.base)),0.50*source.attr.ap.resolved)（exact nested binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable magic damage operation（damage type 20221 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no W ability-specific type and no type62013）（交叉校验 base0/resolved0/AP0/MR0 raw=final210；base60/resolved60/AP0/MR0 raw=final210；base60/resolved160/AP0/MR0 raw=final310；base60/resolved160/AP100/MR0 raw=final360；base60/resolved160/AP100/MR100 raw360/final180；base60/resolved260/AP200/MR100 raw510/final255；base0/resolved100 versus base60/resolved160 AP100/MR0 both360）。Attempts mana150/baseAD60/resolvedAD160/AP100/HP1000/MR100 at t0/t13999/t14000 → success/skip/success，exactly two W damage items；final mana50/HP640；exactly two automatic W ability_started；mana49 at t0 → resource skip with mana/HP unchanged and no W damage/event。W does not arm Q and Q causes no W damage。Tristana W provider is standalone；Backend has no repository-owned hero_tristana / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Tristana P/Q/E/Explosive Charge/R dependence；不暗示 Batch-B 或 sibling Tristana synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Cursor focused10/adjacent57/full932 passed；Main focused10/adjacent57/full932 passed。Wasm main validation passed gofmt/focused7/full/bench/build/smoke/benchmark；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity。明确排除 dash/cast time/air time/landing delay、movement/geometry/range/speed/terrain/collision、AOE/radius350/secondary、slow/knockdown/grounded/spellshield、takedown/clone/Explosive Charge reset、cast-during-dash、other ranks、siblings/loadout/bootstrap/crit/on-hit/live/full fidelity；this is exactly one selected-target magic landing hit, not full W；不宣称 dash/cast/air-time/landing-delay/movement/geometry/AOE/slow/takedown/Explosive-Charge-reset/cast-during-dash/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_tristana/ad/ap/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-tristana-rocket-jump-primary-landing-hit',
          WASM.tristanaRocketJumpPrimaryLandingHit,
          'completedBoundary: rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity; Wiki request Template:Data Tristana/W → Rocket Jump; rev4007758/SHA256 cf0e3ae9… / bytes2444; local raw caveat bytes2443/SHA 7283b2eb… no equivalence claim; rank5 50 mana/14000ms CD / one magic 210+1.00*bonusAD+0.50*AP via nested binary add(add(210,1.00*(ad.resolved-ad.base)),0.50*ap.resolved); base0/resolved0/AP0/MR0=210; base60/resolved60/AP0/MR0=210; base60/resolved160/AP0/MR0=310; base60/resolved160/AP100/MR0=360; base60/resolved160/AP100/MR100 raw360/final180; base60/resolved260/AP200/MR100 raw510/final255; base0/resolved100 vs base60/resolved160 AP100/MR0 both360; damage 20221/add 20170; no 20230; no explicit event op; no W type/no type62013; mana150/baseAD60/resolvedAD160/AP100/HP1000/MR100 t0/t13999/t14000 success/skip/success two W damage items final mana50/HP640 two automatic W ability_started; mana49 resource skip unchanged; W does not arm Q and Q causes no W damage; standalone no sibling synthesis; Wasm exact test commit 9d2716c; dash/cast/air-time/landing-delay/movement/geometry/AOE/slow/takedown/Explosive-Charge-reset/cast-during-dash/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-tristana-rocket-jump-primary-landing-hit',
          SEED.tristanaRocketJumpPrimaryLandingHitBackend,
          'completedBoundary: rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity; backend lol_generic_tristana_rocket_jump_primary_landing_hit_seed.sql + LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest (owning 7cafeab; integrated ac304d3); Wasm exact test commit 9d2716c; external existing-data/check-only prerequisites (hero_tristana/ad/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Tristana synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_corki|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'bonus_ad_ratio',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_corki Q 磷光炸弹/Phosphorus Bomb：Wiki request Template:Data Corki/Q → resolved Template:Data Corki/Phosphorus Bomb；page1306953 / rev4007588 / timestamp 2026-04-12T06:50:59Z / canonical bytes1531 / SHA256 e71a474ef6b4df1df4808b397c8bd0f42ce284234f3eb7603fab09cabd760365（normalized/generic/corki-q.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-corki-phosphorus-bomb-primary-impact 闭环为 migrated——local raw caveat bytes1529 / SHA c39556a0d90226462e8a939ebe58888ec91325a9ca4d10be23e43dd77d948ba6（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；80 mana / 7000ms CD；immediate selected-primary-champion single magic impact hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable magic damage operation add(add(const 240, mul(const 1.25, sub(read source.attr.ad.resolved, read source.attr.ad.base))), mul(const 1.00, read source.attr.ap.resolved))（exact nested binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable magic damage operation（damage type 20221 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no Q ability-specific type）（交叉校验 base60/resolved60/AP0/MR0 raw=final240；base60/resolved160/AP0/MR0 raw=final365；base60/resolved60/AP100/MR0 raw=final340；base60/resolved160/AP100/MR0 raw=final465；base60/resolved156/AP100/MR100 raw460/final230；base60/resolved220/AP100/MR100 raw540/final270；base0/resolved100 versus base60/resolved160 AP0/MR0 both365）。Attempts mana240/baseAD60/resolvedAD156/AP100/HP1000/MR100 at t0/t6999/t7000 → success/skip/success，exactly two Q damage items；final mana80/HP540；exactly two automatic Q ability_started；mana79 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Corki Q provider is standalone；Backend has no repository-owned hero_corki / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Corki P/W/E/R dependence；不暗示 Batch-B 或 sibling Corki synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Main focused75/full975 passed。Wasm main validation passed gofmt/focused/full/bench/build/smoke/benchmark；built and independent Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write（embedded web/ copy is a wrong-path validation caveat, not independent Web parity failure）。completedBoundary：rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_other_ranks_or_full_fidelity。明确排除 cast time/location targeting/range/radius/geometry、projectile travel/minimum travel time/explosion、AOE/multitarget/surrounding、travel/impact-area sight、enemy-champion reveal/six-second duration、spellshield、collision/acquisition、other ranks、siblings/loadout/bootstrap/crit/on-hit/live/full fidelity；this is exactly one selected-primary magic impact hit, not full Q；不宣称 cast/location/range/radius/geometry/projectile/travel/minimum-time/explosion/AOE/multitarget/collision/acquisition/spellshield/sight/reveal/duration/other ranks/siblings/live/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_corki/ad/ap/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-corki-phosphorus-bomb-primary-impact',
          WASM.corkiPhosphorusBombPrimaryImpact,
          'completedBoundary: rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_other_ranks_or_full_fidelity; Wiki request Template:Data Corki/Q → Phosphorus Bomb; rev4007588/SHA256 e71a474e… / bytes1531; local raw caveat bytes1529/SHA c39556a0… no equivalence claim; rank5 80 mana/7000ms CD / one magic 240+1.25*bonusAD+1.00*AP via nested binary add(add(240,1.25*(ad.resolved-ad.base)),1.00*ap.resolved); base60/resolved60/AP0/MR0=240; base60/resolved160/AP0/MR0=365; base60/resolved60/AP100/MR0=340; base60/resolved160/AP100/MR0=465; base60/resolved156/AP100/MR100 raw460/final230; base60/resolved220/AP100/MR100 raw540/final270; base0/resolved100 vs base60/resolved160 AP0/MR0 both365; damage 20221/add 20170; no 20230; no explicit event op; no Q type; mana240/baseAD60/resolvedAD156/AP100/HP1000/MR100 t0/t6999/t7000 success/skip/success two Q damage items final mana80/HP540 two automatic Q ability_started; mana79 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit b381b1e bytes65821/SHA 58f47763…; cast/location/range/radius/geometry/projectile/travel/minimum-time/explosion/AOE/multitarget/sight/reveal/duration/spellshield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-corki-phosphorus-bomb-primary-impact',
          SEED.corkiPhosphorusBombPrimaryImpactBackend,
          'completedBoundary: rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_other_ranks_or_full_fidelity; backend lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql + LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest (owning 6003a7e; integrated b352677); Wasm exact test commit b381b1e; external existing-data/check-only prerequisites (hero_corki/ad/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Corki synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_lucian|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_lucian Q 透体圣光/Piercing Light：Wiki request Template:Data Lucian/Q → resolved Template:Data Lucian/Piercing Light；page1308176 / rev3982579 / timestamp 2026-01-09T09:22:29Z / canonical bytes1608 / SHA256 d7b03d15af48312a0ea5a06fa147b43c46d2a7ee6e1491dd121d796a2e452981（normalized/generic/lucian-q.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-lucian-piercing-light-selected-target-hit 闭环为 migrated——local raw caveat bytes1608 / SHA cd65b80f0580f0e4833028791bba2331a321366307b8c35f7fc28fe06c1f06c1（canonical identity remains sidecar/pages；no equivalence or contradiction claim；equal size alone is not byte equality or source contradiction）；80 mana / 5000ms CD；immediate selected-target single physical hit scaffold；one selected immediate selected-target single noncritical/noncopyable physical damage operation 220 + 1.00 * (source.attr.ad.resolved - source.attr.ad.base)（bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no explicit event op）（交叉校验 base60/resolved60/armor0 raw=final220；base60/resolved160/armor0 raw=final320；base60/resolved160/armor100 raw320/final160；base60/resolved260/armor100 raw420/final210；runtime test also carries an explicit total-AD counterproof）。Attempts mana240/baseAD60/resolvedAD160/HP1000/armor100 at t0/t4999/t5000 → success/skip/success，exactly two Q damage items；final mana80/HP680；exactly two automatic Q ability_started；mana79 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Lucian Q is standalone；Backend has no repository-owned hero_lucian / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Lucian synthesis；不暗示任何 production runtime/ABI/Web change。completedBoundary：rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; physical_220_plus_1_00_bonus_ad; no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_initial_target_death_early_end_other_ranks_or_full_fidelity。明确排除 cast timing、target lead/dodge、direction、target range、range/width/line geometry、multitarget/AOE、spell shield、buffered W or R、E lockout、initial-target-death early end、other ranks、other Lucian abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full Piercing Light/game fidelity；不宣称 cast/lead/dodge/direction/range/line/multitarget/AOE/spell-shield/buffer/E-lockout/early-end/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_lucian/ad/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-lucian-piercing-light-selected-target-hit',
          WASM.lucianPiercingLightSelectedTargetHit,
          'completedBoundary: rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; physical_220_plus_1_00_bonus_ad; no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_initial_target_death_early_end_other_ranks_or_full_fidelity; Wiki request Template:Data Lucian/Q → Piercing Light; rev3982579/SHA256 d7b03d15… / bytes1608; local raw caveat bytes1608/SHA cd65b80f… no equivalence claim; rank5 80 mana/5000ms CD / one physical 220+1.00*bonusAD via sub(ad.resolved,ad.base); base60/resolved60/armor0=220; base60/resolved160/armor0=320; base60/resolved160/armor100 raw320/final160; base60/resolved260/armor100 raw420/final210; total-AD counterproof; damage 20220/add 20170; no explicit event op; mana240/baseAD60/resolvedAD160/HP1000/armor100 t0/t4999/t5000 success/skip/success two Q damage items final mana80/HP680 two automatic Q ability_started; mana79 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit aaca359; cast/lead/dodge/direction/range/line/multitarget/AOE/spell-shield/buffer/E-lockout/early-end/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-lucian-piercing-light-selected-target-hit',
          SEED.lucianPiercingLightSelectedTargetHitBackend,
          'completedBoundary: rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; physical_220_plus_1_00_bonus_ad; no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_initial_target_death_early_end_other_ranks_or_full_fidelity; backend lol_generic_lucian_piercing_light_selected_target_hit_seed.sql + LolGenericLucianPiercingLightSelectedTargetHitSeedSqlTest (owning bfc9d54; integrated 826cdad); Wasm exact test commit aaca359; external existing-data/check-only prerequisites (hero_lucian/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Lucian synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_lucian|W',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_lucian W 热诚烈弹/Ardent Blaze：Wiki request Template:Data Lucian/W → resolved Template:Data Lucian/Ardent Blaze；page1308178 / rev3594941 / timestamp 2023-09-12T19:08:23Z / canonical bytes2542 / SHA256 b1ea7bc7a2e48be9ab97acfa1fc5addb80b8dd236dc97bd3d57c5e90951418c5（normalized/generic/lucian-w.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-lucian-ardent-blaze-primary-hit 闭环为 migrated——local raw caveat bytes2542 / SHA a57b0e49765ab5a9bdd30ad295d24e406a90015b083c8a0e817855c6bc152236（canonical identity remains sidecar/pages；no equivalence or contradiction claim；equal size alone is not byte equality or source contradiction）；60 mana / 10000ms CD；immediate primary-champion single magic hit scaffold；one immediate primary-champion single noncritical/noncopyable magic damage operation 215 + 0.90 * source.attr.ap.resolved；exactly one noncrit/noncopyable magic damage operation（damage type 20221 + add policy 20170；no explicit event op）（交叉校验 AP0/MR0 raw=final215；AP0/MR100 raw215/final107.5；AP100/MR0 raw=final305；AP100/MR100 raw305/final152.5；AP200/MR100 raw395/final197.5）。Attempts mana180/AP100/targetHP1000/MR100 at t0/t9999/t10000 → success/skip/success，exactly two W damage items；final mana60 and target HP695；exactly two automatic W ability_started；mana59 at t0 → resource skip with mana/HP unchanged and no W damage/event。Lucian W is standalone；Backend has no repository-owned hero_lucian / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Lucian Q dependence；不暗示 Batch-B 或 sibling Lucian synthesis；不暗示任何 production runtime/ABI/Web change。completedBoundary：rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_215_plus_0_90_ap; no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_shield_exception_other_ranks_or_full_fidelity。明确排除 cast timing and Effect-at-cast-time-end、direction/range/acquisition、missile/travel/collision、cross/explosion geometry、multitarget/AOE、sight、6-second mark、movement speed and its ranks、allied trigger/Vigilance、dodge/block/blind/persistent-damage、spell-shield mark exception、ranks1-4、equipment/loadout/crit/on-hit、other Lucian abilities/siblings、live migration/publish/E2E、full Ardent Blaze/game fidelity；不宣称 cast/Effect-at-cast-time-end/direction/range/missile/collision/cross/explosion/multitarget/AOE/sight/mark/ms/Vigilance/dodge/block/blind/DoT/spell-shield/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_lucian/ap/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-lucian-ardent-blaze-primary-hit',
          WASM.lucianArdentBlazePrimaryHit,
          'completedBoundary: rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_215_plus_0_90_ap; no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_shield_exception_other_ranks_or_full_fidelity; Wiki request Template:Data Lucian/W → Ardent Blaze; rev3594941/SHA256 b1ea7bc7… / bytes2542; local raw caveat bytes2542/SHA a57b0e49… no equivalence claim; rank5 60 mana/10000ms CD / one magic 215+0.90*AP; AP0/MR0=215; AP0/MR100 raw215/final107.5; AP100/MR0=305; AP100/MR100 raw305/final152.5; AP200/MR100 raw395/final197.5; damage 20221/add 20170; no explicit event op; mana180/AP100/HP1000/MR100 t0/t9999/t10000 success/skip/success two W damage items final mana60/HP695 two automatic W ability_started; mana59 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit d57dc3b; cast/Effect-at-cast-time-end/direction/range/missile/collision/cross/explosion/multitarget/AOE/sight/mark/ms/Vigilance/dodge/block/blind/DoT/spell-shield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-lucian-ardent-blaze-primary-hit',
          SEED.lucianArdentBlazePrimaryHitBackend,
          'completedBoundary: rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_215_plus_0_90_ap; no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_shield_exception_other_ranks_or_full_fidelity; backend lol_generic_lucian_ardent_blaze_primary_hit_seed.sql + LolGenericLucianArdentBlazePrimaryHitSeedSqlTest (owning 2b29c4e; integrated 7e8a40c); Wasm exact test commit d57dc3b; external existing-data/check-only prerequisites (hero_lucian/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Lucian synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_lucian|R',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_lucian R 圣枪洗礼/The Culling：Wiki request Template:Data Lucian/R → resolved Template:Data Lucian/The Culling；page1308182 / rev4007670 / timestamp 2026-04-12T10:40:21Z / canonical bytes4477 / SHA256 7a4679542eebdebf25da391a1222f08df2f416c641f48473d528e62296b9a2f7（normalized/generic/lucian-r.json plus pages sibling are authority）rank3 Phase-A v2 已由 wasm-generic-lucian-the-culling-single-shot-quantum 闭环为 migrated——local raw caveat bytes4477 / SHA b63612287a8a965e7655829a2054aec7b019705225fd7e7b4736303a172bc74d（canonical identity remains sidecar/pages；no equivalence or contradiction claim；equal size alone is not byte equality or source contradiction）；100 mana / 90000ms CD；immediate primary-champion first-enemy single physical shot-quantum scaffold；one immediate primary-champion single noncritical/noncopyable physical shot damage quantum 45 + 0.25 * source.attr.ad.resolved + 0.15 * source.attr.ap.resolved（exact nested binary add；total AD direct read；never bonus AD/subtraction；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no explicit event op；ability_started is automatic）（交叉校验 baseAD0/resolvedAD0/AP0/armor0 raw=final45；baseAD60/resolvedAD60/AP0/armor0 raw=final60；baseAD60/resolvedAD160/AP0/armor0 raw=final85；baseAD60/resolvedAD160/AP100/armor0 raw=final100；baseAD60/resolvedAD160/AP100/armor100 raw100/final50；baseAD60/resolvedAD260/AP200/armor100 raw140/final70；baseAD0 vs baseAD60 at resolvedAD160/AP100/armor0 both raw/final100）。Attempts mana300/baseAD60/resolvedAD160/AP100/targetHP1000/armor100 at t0/t89999/t90000 → success/skip/success，exactly two R shot-quantum damage items；final mana100 and target HP900；exactly two automatic R ability_started；mana99 at t0 → resource skip with mana/HP unchanged and no R damage/event。Lucian R provider is standalone；Backend has no repository-owned hero_lucian / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Lucian Q/W dependence；不暗示 Batch-B 或 sibling Lucian synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Cursor focused9/adjacent53/full893 passed；Main focused9 and adjacent53 passed；first full run had one transient existing LolGenericKogmawLivingArtillerySeedSqlTest java.util.regex.StackOverflowError（884 tests, 1 error），then isolated Kog\'Maw test passed10/10 and fresh full run passed893/893（nonblocking validation-runtime caveat；not a Lucian R contract failure）。Wasm main validation passed gofmt/focused eight top-level Lucian R tests/full Go/bench/standard TinyGo build/Node smoke/generic benchmark；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity。明确排除 3-second channel/channel state、0.75-second/manual/automatic recast、22 base shots and crit-chance additional-shot count、total channel damage、cadence/fire-rate、direction/range/width、missile offsets/alternating guns/travel/collision/first-enemy geometry/multitarget、minion double、movement/ghosted/facing、spell shield、interrupts/E usability/Q-W lockout/Thresh/Tahm、ranks1-2、equipment/loadout/crit/on-hit、other Lucian abilities/siblings、live migration/publish/E2E、full The Culling/game fidelity；this is one damage quantum, not one total R hit or total ultimate damage；不宣称 channel/recast/shot-count/crit-scaling/fire-rate/direction/range/missile/collision/multitarget/minion-double/move/ghost/facing/spell-shield/interrupts/lockout/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_lucian/ad/ap/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-lucian-the-culling-single-shot-quantum',
          WASM.lucianTheCullingSingleShotQuantum,
          'completedBoundary: rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity; Wiki request Template:Data Lucian/R → The Culling; rev4007670/SHA256 7a467954… / bytes4477; local raw caveat bytes4477/SHA b6361228… no equivalence claim; rank3 100 mana/90000ms CD / one physical shot quantum 45+0.25*totalAD+0.15*AP nested binary add; baseAD0/resolvedAD0/AP0/armor0=45; baseAD60/resolvedAD60/AP0/armor0=60; baseAD60/resolvedAD160/AP0/armor0=85; baseAD60/resolvedAD160/AP100/armor0=100; baseAD60/resolvedAD160/AP100/armor100 raw100/final50; baseAD60/resolvedAD260/AP200/armor100 raw140/final70; baseAD0 vs baseAD60 at resolvedAD160/AP100/armor0 both 100; damage 20220/add 20170; no explicit event op; mana300/baseAD60/resolvedAD160/AP100/HP1000/armor100 t0/t89999/t90000 success/skip/success two R shot-quantum damage items final mana100/HP900 two automatic R ability_started; mana99 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit ab2d9f7; channel/recast/shot-count/crit-scaling/fire-rate/direction/range/missile/collision/multitarget/minion-double/move/ghost/facing/spell-shield/interrupts/lockout/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-lucian-the-culling-single-shot-quantum',
          SEED.lucianTheCullingSingleShotQuantumBackend,
          'completedBoundary: rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity; backend lol_generic_lucian_the_culling_single_shot_quantum_seed.sql + LolGenericLucianTheCullingSingleShotQuantumSeedSqlTest (owning a2f5bca; integrated d83b09e); Wasm exact test commit ab2d9f7; external existing-data/check-only prerequisites (hero_lucian/ad/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Lucian synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_kayle|Q',
    {
      classification: 'migrated',
      tags: ['active_magic_damage', 'provider_target_resist_shred', 'bonus_ad_ap_scaling'],
      reason:
        'hero_kayle Q 耀焰冲击/Radiant Blast：Wiki rev4005105 / SHA256 ded516de4861d88de21ba54de9a8723b654f424f1cc3f9dac30d06382ee1a87c（normalized/generic/kayle-q.json）rank5 Phase-A 主目标 1v1 已由 wasm-generic-kayle-radiant-blast 闭环为 migrated——魔法伤害 180+0.60*(ad.resolved-ad.base)+0.50*ap.resolved；先伤后击碎；provider-target kayle_q_sundered（default0/max1/4000ms refresh_on_write）→ opponent armor/MR percent_add −15%；100 mana / 8000ms CD；wasm generic_kayle_radiant_blast_test.go + backend lol_generic_kayle_radiant_blast_seed.sql（未 live publish）。completedBoundary exclusions：slow、portal launch delay、attack-windup cast time、projectile travel/collision、cross expansion/secondary targets、ranks1–4、death persistence、live migration/publish/E2E/完整技能保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-kayle-radiant-blast',
          WASM.kayleRadiantBlast,
          'completedBoundary: Wiki rev4005105/SHA256 ded516de… rank5 Phase-A primary-target magic 180+0.60*bonusAD+0.50*AP; damage-then-kayle_q_sundered; armor/MR percent_add −15% ×4000ms; 100 mana/8000ms CD; test-only probes excluded from production; slow/portal/windup/projectile/cross/secondary/ranks1-4/death persistence/live/E2E intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-kayle-radiant-blast',
          SEED.kayleRadiantBlastBackend,
          'completedBoundary: Radiant Blast Phase-A seeded (magic+shred/cost/CD); backend lol_generic_kayle_radiant_blast_seed.sql; not live published',
        ),
      ],
    },
  ],
  [
    'hero_graves|P',
    {
      classification: 'migrated',
      tags: [
        'point_blank_merged_basic_attack',
        'expected_crit_branch_override',
        'copyable_on_hit_false',
      ],
      reason:
        'hero_graves P 新命运/New Destiny：Wiki rev4038342 / SHA256 553bda222e9e85f0eff6d4cba3b8723979a58b68fba9097d2dfa1bd373117aa8（normalized/generic/graves-p.json + reviewed-contracts#graves-p）Phase-A 贴脸最大弹丸 1v1 已由 wasm-generic-graves-new-destiny 闭环为 migrated——合并物理 raw=AD*F(x)*(1+3*s)，F(x)=0.6895+0.01765*x*(0.595+0.0225*(x-1))，s=0.33302；CritEligible；natural/forced C2 override=((1+5*s)/(1+3*s))*(1+0.5*(crit_damage.resolved-1)) 不双乘 crit_damage；恰好一次 damage + 一次 event/basic_attack_hit，copyable_on_hit=false；ability/basic_attack→basic_damage；CompileFrame→RunFrame→ReleaseSessionFrame。completedBoundary exclusions：精确装填速度公式（Wiki unknown）、弹药/装填日程/lockout/Quickdraw、距离/锥形/弹道/碰撞、多目标、建筑、眼/植物、blind/dodge/block、击退、吸血、逐弹 Black Cleaver、独立弹丸实例、RNG crit、live migration/publish/E2E/完整技能保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-graves-new-destiny',
          WASM.gravesNewDestiny,
          'completedBoundary: Wiki rev4038342/SHA256 553bda22… Phase-A point-blank merged AA AD*F(x)*(1+3*s); C2 natural/forced override Graves formula; one damage+one basic_attack_hit; copyable_on_hit=false; reload/ammo/projectile/multitarget/RNG/live/E2E intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-graves-new-destiny',
          SEED.gravesNewDestinyBackend,
          'completedBoundary: New Destiny Phase-A seeded (point-blank merged BA + C2 overrides); backend lol_generic_graves_new_destiny_seed.sql; not live published',
        ),
      ],
    },
  ],
  [
    'hero_graves|E',
    {
      classification: 'migrated',
      tags: [
        'fixed_max_true_grit_phase_a',
        'armor_mr_stat_flat_add',
        'direct_max_stack_override',
      ],
      reason:
        'hero_graves E 快速拔枪/Quickdraw：Wiki rev4007744 / SHA256 ff4c65c5ce2a0ac1ae757271fbb924b35bf4eca1af0f4d07a69d865db901a4e1（normalized/generic/graves-e.json）Phase-A 满层 True Grit 近似已由 wasm-generic-graves-quickdraw-max-stack 闭环为 migrated——rank5 mana40 / cooldown12000ms；一次 cast 直接 override true_grit_stacks=8；armor/bonus_armor 各 +152（19*8）；MR/bonus_MR 各 +76（19*0.5*8）；CompileFrame→RunFrame→ReleaseSessionFrame。completedBoundary exclusions：intermediate stacks、4s refresh/expiry、dash direction/geometry、reload、attack reset、pellet cooldown reduction、targeting/collision/multi-target/full fidelity。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-graves-quickdraw-max-stack',
          WASM.gravesQuickdrawMaxStack,
          'completedBoundary: Wiki rev4007744/SHA256 ff4c65c5… Phase-A max True Grit (rank5 mana40/CD12000ms / override true_grit_stacks=8 / armor+bonus_armor +152 / MR+bonus_MR +76); intermediate stacks/4s refresh/dash/reload/attack-reset/pellet CDR/targeting/collision/multitarget/full fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-graves-quickdraw-max-stack',
          SEED.gravesQuickdrawMaxStackBackend,
          'completedBoundary: Quickdraw Phase-A max-stack seeded; backend lol_generic_graves_quickdraw_max_stack_seed.sql + LolGenericGravesQuickdrawMaxStackSeedSqlTest; not live published',
        ),
      ],
    },
  ],
  [
    'hero_graves|W',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_graves W 烟幕弹/Smoke Screen：Wiki rev3956197（SHA256 20348473fe3441eb32ab656423f577a62a415fadf33fbdc6fcf576bc8b1d210d；normalized/generic/graves-w.json）rank5 Phase-A v2 已由 wasm-generic-graves-smoke-screen-primary-hit 闭环为 migrated——90 mana / 18000ms CD；immediate primary-target scaffold（明确排除而非建模 Wiki cast0.25 与 Effect at cast time end）；恰好一次 non-crit/non-copyable magic damage 260+0.60*source.attr.ap.resolved（交叉校验 AP200 → raw380，target MR100 → mitigated190）。Attempts t0/t17999/t18000 → two successes + exactly one cooldown skip without mana/damage；final mana 145 from 325；HP 1000→620。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction。明确排除 cast0.25/effect-at-cast-end、projectile/location/travel/collision/range/radius/speed/geometry、AOE/multitarget、slow、smoke cloud/field、nearsight/sight、spellshield、ranks1–4、P/E/basic/ammo/True Grit/bonus resistance/on-hit/equipment/loadout、live/publish/E2E/full fidelity；不宣称 cast/projectile/AOE/slow/smoke/nearsight/sight 保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-graves-smoke-screen-primary-hit',
          WASM.gravesSmokeScreenPrimaryHit,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction; Wiki rev3956197/SHA256 20348473… rank5 90 mana/18000ms CD / one magic 260+0.60*AP; AP200→raw380/MR100→190; t0/t17999/t18000 two successes + one CD skip; final mana145/HP620; immediate scaffold excludes Wiki cast0.25 and Effect at cast time end; cast/projectile/location/geometry/AOE/slow/smoke/nearsight/sight/spellshield/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-graves-smoke-screen-primary-hit',
          SEED.gravesSmokeScreenPrimaryHitBackend,
          'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction; backend lol_generic_graves_smoke_screen_primary_hit_seed.sql + LolGenericGravesSmokeScreenPrimaryHitSeedSqlTest (owning 1238c53; integrated 037bae3); Wasm exact test commit 78ab90c; not live published',
        ),
      ],
    },
  ],
  [
    'hero_graves|R',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_graves R 终极爆弹/Collateral Damage：Wiki rev4007499（SHA256 834843a7722fc9463e21e8d636b8adc644c220928b90f7bb4afedbaa08f85dd1；normalized/generic/graves-r.json）rank3 Phase-A v2 已由 wasm-generic-graves-collateral-damage-primary-hit 闭环为 migrated——100 mana / 60000ms CD；immediate primary-target scaffold（明确排除而非建模 Wiki cast delay、recoil dash、projectile line/geometry）；恰好一次 non-crit/non-copyable physical damage 575+1.50*(source.attr.ad.resolved-source.attr.ad.base)（交叉校验 baseAD66 / resolvedAD120 / bonusAD54 → raw656，armor100 → mitigated328）。Attempts t0/t59999/t60000 → two successes + exactly one cooldown skip without mana/damage；final mana 125 from 325；HP 1000→344。completedBoundary：rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage。明确排除 cast delay/effect-at-cast-end、recoil/dash 400、projectile/line travel/collision/range/geometry、multi-target/repeat、explosion cone/reduced damage 440+1.20 bonus AD（仅适用于额外敌人，excluded not denied）、ranks1–2、P/E/W/basic/ammo/True Grit/bonus resistance/on-hit/equipment/loadout、live/publish/E2E/full fidelity；不宣称 cast/recoil/projectile/line/multitarget/explosion-cone/reduced-damage 保真。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-graves-collateral-damage-primary-hit',
          WASM.gravesCollateralDamagePrimaryHit,
          'completedBoundary: rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage; Wiki rev4007499/SHA256 834843a7… rank3 100 mana/60000ms CD / one physical 575+1.50*bonusAD; baseAD66/resolvedAD120/bonusAD54→raw656/armor100→328; t0/t59999/t60000 two successes + one CD skip; final mana125/HP344; immediate scaffold excludes Wiki cast delay/recoil/projectile/line; explosion cone reduced 440+1.20 bonus AD excluded not denied; cast/recoil/projectile/line/multitarget/explosion-cone/reduced-damage/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-graves-collateral-damage-primary-hit',
          SEED.gravesCollateralDamagePrimaryHitBackend,
          'completedBoundary: rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage; backend lol_generic_graves_collateral_damage_primary_hit_seed.sql + LolGenericGravesCollateralDamagePrimaryHitSeedSqlTest (owning 9c1087b; integrated c2a8a97); Wasm exact test commit 4abadf1; not live published',
        ),
      ],
    },
  ],
  [
    'hero_graves|Q',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_graves Q 穷途末路/End of the Line：Wiki request Template:Data Graves/Q → resolved Template:Data Graves/End of the Line；page1307367 / rev4007501 / timestamp 2026-04-11T22:23:57Z / canonical bytes2266 / SHA256 c18840004febd305484392c882680939efe9fc609d4f733f81824439741345c5（normalized/generic/graves-q.json plus pages sibling are authority）rank5 Phase-A v2 已由 wasm-generic-graves-end-of-the-line-first-outbound-pass 闭环为 migrated——local raw caveat bytes2265 / SHA cd2744fb1f28e54bd3b5e25b96cb1d21babc0583bfd8e854d55c15ed83df0377（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；80 mana / 6000ms CD；immediate selected-primary-champion first-outbound-pass single physical hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable physical damage operation add(const 150, mul(const 0.65, sub(read source.attr.ad.resolved, read source.attr.ad.base)))（exact binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no Q ability-specific type）（交叉校验 base0/resolved0/armor0 raw=final150；base60/resolved60/armor0 raw=final150；base60/resolved160/armor0 raw=final215；base60/resolved160/armor100 raw215/final107.5；base60/resolved260/armor100 raw280/final140；base0/resolved100 versus base60/resolved160 armor0 both215）。Attempts mana240/baseAD60/resolvedAD160/HP1000/armor100 at t0/t5999/t6000 → success/skip/success，exactly two Q damage items；final mana80/HP785；exactly two automatic Q ability_started；mana79 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Q does not alter E True Grit and E produces no Q damage。Graves Q provider is standalone；Backend has no repository-owned hero_graves / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Graves P/E/W/R/True Grit/basic dependence；不暗示 Batch-B 或 sibling Graves synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Main focused50/full943 passed。Wasm main validation passed gofmt/focused7/full/bench/build/smoke/benchmark；exact test bytes66870 / SHA256 a95e0d9632b0fe45aaec9440ccd89c381d6903f2c99ab761581736ec1f8c8e77；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity。明确排除 cast/direction/range/width/line/projectile/pass-through/multitarget/trail/terrain/collision、delayed/terrain detonation、perpendicular/reverse wave/second pass/total、once-per-pass/spellshield/Wind Wall/Braum terrain、other ranks/siblings/loadout/bootstrap/crit/onhit/live/full fidelity；this is exactly one selected-primary first-outbound-pass physical hit, not full Q；不宣称 cast/direction/range/line/projectile/pass-through/multitarget/trail/terrain/detonation/reverse-wave/second-pass/total/once-per-pass/spellshield/Wind-Wall/Braum/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_graves/ad/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-graves-end-of-the-line-first-outbound-pass',
          WASM.gravesEndOfTheLineFirstOutboundPass,
          'completedBoundary: rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity; Wiki request Template:Data Graves/Q → End of the Line; rev4007501/SHA256 c1884000… / bytes2266; local raw caveat bytes2265/SHA cd2744fb… no equivalence claim; rank5 80 mana/6000ms CD / one physical 150+0.65*bonusAD via exact binary add(const150, mul(0.65, sub(ad.resolved,ad.base))); base0/resolved0/armor0=150; base60/resolved60/armor0=150; base60/resolved160/armor0=215; base60/resolved160/armor100 raw215/final107.5; base60/resolved260/armor100 raw280/final140; base0/resolved100 vs base60/resolved160 armor0 both215; damage 20220/add 20170; no 20230; no explicit event op; no Q type; mana240/baseAD60/resolvedAD160/HP1000/armor100 t0/t5999/t6000 success/skip/success two Q damage items final mana80/HP785 two automatic Q ability_started; mana79 resource skip unchanged; Q does not alter E True Grit and E produces no Q damage; standalone no sibling synthesis; Wasm exact test commit c16107e bytes66870/SHA a95e0d96…; cast/direction/range/line/projectile/pass-through/multitarget/trail/terrain/detonation/reverse-wave/second-pass/total/once-per-pass/spellshield/Wind-Wall/Braum/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-graves-end-of-the-line-first-outbound-pass',
          SEED.gravesEndOfTheLineFirstOutboundPassBackend,
          'completedBoundary: rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity; backend lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql + LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest (owning 9294292; integrated a54cf6f); Wasm exact test commit c16107e; external existing-data/check-only prerequisites (hero_graves/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Graves synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_senna|W',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_senna W 无尽厮守/Last Embrace：Wiki request Template:Data Senna/W → resolved Template:Data Senna/Last Embrace；page1409576 / rev4009139 / timestamp 2026-04-15T21:34:10Z / canonical bytes1656 / SHA256 48698aa2864b79564b1ea0ed624de8fc7123c3127c1e56deaa002d1aad3c8492（normalized/generic/senna-w.json plus pages sibling are authority）rank5 Phase-A v2 已由 wasm-generic-senna-last-embrace-first-enemy-hit 闭环为 migrated——local raw caveat bytes1651 / SHA 737cc69b6ea13da8d61437e3da37a799cc2779bd56516d166af5890dc6090d5e（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；70 mana / 11000ms CD；immediate selected-primary-champion first-enemy single physical hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable physical damage operation add(const 230, mul(const 0.90, sub(read source.attr.ad.resolved, read source.attr.ad.base)))（exact binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no W ability-specific type）（交叉校验 base0/resolved0/armor0 raw=final230；base60/resolved60/armor0 raw=final230；base60/resolved160/armor0 raw=final320；base60/resolved160/armor100 raw320/final160；base60/resolved260/armor100 raw410/final205；base0/resolved100 versus base60/resolved160 armor0 both320）。Attempts mana210/baseAD60/resolvedAD160/HP1000/armor100 at t0/t10999/t11000 → success/skip/success，exactly two W damage items；final mana70/HP680；exactly two automatic W ability_started；mana69 at t0 → resource skip with mana/HP unchanged and no W damage/event。Senna W provider is standalone；Backend has no repository-owned hero_senna / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Senna P/Q/E/R/basic dependence；不暗示 Batch-B 或 sibling Senna synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Main focused68/full954 passed。Wasm main validation passed gofmt/focused/full/bench/build/smoke/benchmark；exact test bytes62703 / SHA256 4a449fc09248fe7842b909a373edd5353d4fb1eed8831b655f9146bcd5696051；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_other_ranks_or_full_fidelity。明确排除 cast/effect-at-cast-time-end/direction/range/width/line/projectile/collision/acquisition、attachment/death spread/delayed root/root duration/surrounding AOE、untargetable/spellshield、other ranks/siblings/loadout/bootstrap/crit/onhit/live/full fidelity；this is exactly one selected-primary first-enemy physical hit, not full W；不宣称 cast/effect-at-cast-time-end/direction/range/line/projectile/collision/acquisition/attachment/death-spread/delayed-root/surrounding-AOE/untargetable/spellshield/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_senna/ad/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-senna-last-embrace-first-enemy-hit',
          WASM.sennaLastEmbraceFirstEnemyHit,
          'completedBoundary: rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_other_ranks_or_full_fidelity; Wiki request Template:Data Senna/W → Last Embrace; rev4009139/SHA256 48698aa2… / bytes1656; local raw caveat bytes1651/SHA 737cc69b… no equivalence claim; rank5 70 mana/11000ms CD / one physical 230+0.90*bonusAD via exact binary add(const230, mul(0.90, sub(ad.resolved,ad.base))); base0/resolved0/armor0=230; base60/resolved60/armor0=230; base60/resolved160/armor0=320; base60/resolved160/armor100 raw320/final160; base60/resolved260/armor100 raw410/final205; base0/resolved100 vs base60/resolved160 armor0 both320; damage 20220/add 20170; no 20230; no explicit event op; no W type; mana210/baseAD60/resolvedAD160/HP1000/armor100 t0/t10999/t11000 success/skip/success two W damage items final mana70/HP680 two automatic W ability_started; mana69 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit ebf7730 bytes62703/SHA 4a449fc0…; cast/effect-at-cast-time-end/direction/range/line/projectile/collision/acquisition/attachment/death-spread/delayed-root/surrounding-AOE/untargetable/spellshield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-senna-last-embrace-first-enemy-hit',
          SEED.sennaLastEmbraceFirstEnemyHitBackend,
          'completedBoundary: rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_other_ranks_or_full_fidelity; backend lol_generic_senna_last_embrace_first_enemy_hit_seed.sql + LolGenericSennaLastEmbraceFirstEnemyHitSeedSqlTest (owning c0c3090; integrated b90607b); Wasm exact test commit ebf7730; external existing-data/check-only prerequisites (hero_senna/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Senna synthesis; not live published',
        ),
      ],
    },
  ],
  [
    'hero_senna|R',
    {
      classification: 'migrated',
      tags: [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'ap_ratio',
        'immediate_impact_scaffold',
      ],
      reason:
        'hero_senna R 暗影燎原/Dawning Shadow：Wiki request Template:Data Senna/R → resolved Template:Data Senna/Dawning Shadow；page1409580 / rev4008033 / timestamp 2026-04-13T04:08:13Z / canonical bytes2356 / SHA256 4de188cce3d04f172d37f07db4e7c8e240388c5346f56838c82a3e6205c9de36（normalized/generic/senna-r.json plus pages sibling are authority）rank3 Phase-A v3 已由 wasm-generic-senna-dawning-shadow-primary-hit 闭环为 migrated——local raw caveat bytes2353 / SHA 1b448ff48b9fe906a13056f2f510e38ff96fcad410462972a93dbd3bb93195dc（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；100 mana / 100000ms CD；immediate selected-primary-enemy-champion single physical hit scaffold；one immediate selected-primary-enemy-champion single noncritical/noncopyable physical damage operation add(add(const 550, mul(const 1.15, sub(read source.attr.ad.resolved, read source.attr.ad.base))), mul(const 0.70, read source.attr.ap.resolved))（exact nested binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no R ability-specific type）（交叉校验 base60/resolved60/AP0/armor0 raw=final550；base60/resolved160/AP0/armor0 raw=final665；base60/resolved60/AP100/armor0 raw=final620；base60/resolved160/AP100/armor0 raw=final735；base60/resolved140/AP100/armor100 raw712/final356；base60/resolved220/AP100/armor100 raw804/final402；base0/resolved100 versus base60/resolved160 AP0/armor0 both665）。Attempts mana300/baseAD60/resolvedAD140/AP100/HP1000/armor100 at t0/t99999/t100000 → success/skip/success，exactly two R damage items；final mana100/HP288；exactly two automatic R ability_started；mana99 at t0 → resource skip with mana/HP unchanged and no R damage/event。Senna R provider is standalone；preserve existing W Last Embrace without requiring/mutating/copying/synthesizing W；check-only standalone W isolation；Backend has no repository-owned hero_senna / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Senna P/Q/W/E/basic dependence；不暗示 Batch-B 或 sibling Senna synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Main focused71/full987 passed。Wasm main validation passed gofmt/focused/full/bench/build/smoke/benchmark；exact test bytes73643 / SHA256 a42359e98452dfd3d1429fc12f8735daefd77b0da2269ba7b345200b9ff39fa9；built and independent Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity。明确排除 cast time/Effect at cast time start/queue time、global/direction/broad or narrow wave geometry/width、projectile travel/speed/destruction AOE/multitarget、enemy reveal/self reveal/allied or self shield、Mist scaling/Mist Wraith hits/path sight/spellshield、other ranks、siblings/loadout/bootstrap/crit/on-hit/live/full fidelity；this is exactly one selected-primary-enemy-champion single physical hit, not full R；不宣称 cast/Effect-at-cast-time-start/queue/global/direction/wave/projectile/AOE/reveal/shield/Mist/Wraith/sight/spellshield/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_senna/ad/ap/mana），不物化 identity/panel/resource values。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-senna-dawning-shadow-primary-hit',
          WASM.sennaDawningShadowPrimaryHit,
          'completedBoundary: rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity; Wiki request Template:Data Senna/R → Dawning Shadow; rev4008033/SHA256 4de188cc… / bytes2356; local raw caveat bytes2353/SHA 1b448ff4… no equivalence claim; rank3 100 mana/100000ms CD / one physical 550+1.15*bonusAD+0.70*AP via nested binary add(add(550,1.15*(ad.resolved-ad.base)),0.70*ap.resolved); base60/resolved60/AP0/armor0=550; base60/resolved160/AP0/armor0=665; base60/resolved60/AP100/armor0=620; base60/resolved160/AP100/armor0=735; base60/resolved140/AP100/armor100 raw712/final356; base60/resolved220/AP100/armor100 raw804/final402; base0/resolved100 vs base60/resolved160 AP0/armor0 both665; damage 20220/add 20170; no 20230; no explicit event op; no R type; mana300/baseAD60/resolvedAD140/AP100/HP1000/armor100 t0/t99999/t100000 success/skip/success two R damage items final mana100/HP288 two automatic R ability_started; mana99 resource skip unchanged; standalone preserve existing W / check-only W isolation / no sibling synthesis; Wasm exact test commit a8e4c08 bytes73643/SHA a42359e9…; cast/Effect-at-cast-time-start/queue/global/direction/wave/projectile/AOE/reveal/shield/Mist/Wraith/sight/spellshield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-senna-dawning-shadow-primary-hit',
          SEED.sennaDawningShadowPrimaryHitBackend,
          'completedBoundary: rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity; backend lol_generic_senna_dawning_shadow_primary_hit_seed.sql + LolGenericSennaDawningShadowPrimaryHitSeedSqlTest (owning b774a8d; integrated 4316923); Wasm exact test commit a8e4c08; external existing-data/check-only prerequisites (hero_senna/ad/ap/mana; does not write identity/panel/resource values); standalone preserve existing W / check-only W isolation / no Batch-B or sibling Senna synthesis; not live published',
        ),
      ],
    },
  ],
  [
    '3115|艾卡西亚之咬',
    {
      classification: 'migrated',
      tags: ['on_hit', 'ap_ratio', 'formula_on_hit'],
      reason:
        'item 3115 on-hit 已由 formula-onhit seed + generic_completed_onhit_mechanisms_test.go（commit 3314c24）闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-completed-onhit-mechanisms',
          WASM.completedOnHit,
          `Nashor Tooth Icathian Bite main-target on-hit; commit ${COMPLETED_ONHIT_COMMIT}`,
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-formula-onhit-batch',
          SEED.formulaOnHit,
          'Nashor Tooth Icathian Bite main-target on-hit seed',
        ),
      ],
    },
  ],
  [
    '3181|船长',
    {
      classification: 'migrated',
      tags: ['every_n_hit', 'on_hit', 'formula_on_hit'],
      reason:
        'item 3181 主目标 every-5th on-hit 已由 formula-onhit seed + generic_completed_onhit_mechanisms_test.go（commit 3314c24）闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-completed-onhit-mechanisms',
          WASM.completedOnHit,
          `Hullbreaker Skipper every-5th main-target damage; commit ${COMPLETED_ONHIT_COMMIT}`,
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-formula-onhit-batch',
          SEED.formulaOnHit,
          'Hullbreaker Skipper every-5th main-target damage seed',
        ),
      ],
    },
  ],
  [
    '3302|晦影',
    {
      classification: 'migrated',
      tags: ['on_hit', 'flat_magic_damage', 'formula_on_hit'],
      reason:
        'item 3302 晦影 on-hit 已由 formula-onhit seed + generic_completed_onhit_mechanisms_test.go（commit 3314c24）闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-completed-onhit-mechanisms',
          WASM.completedOnHit,
          `Terminus Shadow flat magic on-hit; commit ${COMPLETED_ONHIT_COMMIT}`,
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-formula-onhit-batch',
          SEED.formulaOnHit,
          'Terminus Shadow flat magic on-hit seed',
        ),
      ],
    },
  ],
  [
    '3302|交相',
    {
      classification: 'migrated',
      tags: [
        'alternating_polarity_stacks',
        'source_resist_flat_bonus',
        'source_percent_penetration',
        'on_hit',
      ],
      reason:
        'item 3302 交相/Juxtaposition：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；Phase-A 首击 Light 假设 + provider-scope next_polarity/light_stacks/dark_stacks（聚合 refresh_on_write 5000ms 近似，非独立 per-stack 过期）；Light pp 6@1/7@11/8@14 插值×层数加 armor/MR；Dark 每层 +10% armor_pen_percent/magic_pen_percent（flat add，满层 30%）；与 Shadow 30 magic 同 provider；已由 generic_terminus_juxtaposition_test.go + 计划 backend lol_generic_terminus_juxtaposition_seed.sql 闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-terminus-juxtaposition',
          WASM.terminusJuxtaposition,
          'Terminus Juxtaposition Light/Dark polarity stacks + Shadow 30 via generic_terminus_juxtaposition_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-terminus-juxtaposition',
          SEED.terminusJuxtapositionBackend,
          'planned backend lol_generic_terminus_juxtaposition_seed.sql + focused Java test; not claiming live publish',
        ),
      ],
    },
  ],
  [
    '6699|苍穹',
    {
      classification: 'migrated',
      tags: [
        'energized_precharged_firmament_consume',
        'current_hp_ratio_physical_on_hit',
        'timed_armor_pen_flat',
      ],
      reason:
        'item 6699 苍穹/Firmament：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；仅 ranged/precharged 口径——energized_charge 显式预充 100；下一次真实主目标普攻先武装 firmament_lethality_active=1（4000ms refresh_on_write）向 canonical armor_pen_flat 加 12（与基线 10 合成 penetrationFlat=22），再按 event.target 当前生命 7% 造成额外物理伤害（非 entry_target），后消费 charge→0；copyable_on_hit=false/phantom 零伤害零二次消费；不含自然充能/Galvanize/melee/非英雄上限/Web UI；已由 generic_firmament_6699_test.go + 计划 backend lol_generic_firmament_6699_seed.sql / LolGenericFirmament6699SeedSqlTest.java 闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-firmament-6699',
          WASM.firmament6699,
          'Firmament ranged precharged: charge100→arm+12 armor_pen_flat/4s→0.07*event.target.hp→consume; phantom non-copyable; via generic_firmament_6699_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-firmament-6699',
          SEED.firmament6699Backend,
          'planned backend lol_generic_firmament_6699_seed.sql + LolGenericFirmament6699SeedSqlTest.java; not claiming live publish',
        ),
      ],
    },
  ],
  [
    '2520|成型炸药',
    {
      classification: 'migrated',
      tags: [
        'next_ability_damage_true_arm_consume',
        'armor_pen_flat_scaled_true',
        'timed_ready_refresh_on_write',
      ],
      reason:
        'item 2520 成型炸药/Shaped Charge：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；仅 ranged 英雄分支——shaped_charge_ready default1/max1/45000ms refresh_on_write 开局即 ready；listener All{event/damage_instance,damage_trait/ability,event/source_owner} None{ability/basic_attack,damage_trait/on_hit,damage_trait/item,damage_trait/dot}；首次合格技能伤害实例先造成 child damage/true（15+0.75*source.attr.armor_pen_flat.resolved，基线22→31.5，CopyableOnHit=false，无 ability/item/on_hit/dot traits）再 override ready→0；同施法多段仅首段触发；真伤无视抗性但护盾按当前 pipeline 吸收；lazy expiry t>=45000 恢复 ready；不含 melee/史诗野怪/破坏(Sabotage)/宠物/DoT 纳入/Web UI；已由 generic_shaped_charge_2520_test.go + 计划 backend lol_generic_shaped_charge_2520_seed.sql / LolGenericShapedCharge2520SeedSqlTest.java 闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-shaped-charge-2520',
          WASM.shapedCharge2520,
          'Shaped Charge ranged: ready1→ability damage_instance true 15+0.75*armor_pen_flat→consume/45s; matcher All/None + shield boundary; via generic_shaped_charge_2520_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-shaped-charge-2520',
          SEED.shapedCharge2520Backend,
          'planned backend lol_generic_shaped_charge_2520_seed.sql + LolGenericShapedCharge2520SeedSqlTest.java; not claiming live publish',
        ),
      ],
    },
  ],
  [
    '3161|专注意志',
    {
      classification: 'migrated',
      tags: [
        'ability_pet_stack_grant',
        'per_cast_throttle',
        'stacking_outgoing_amp',
        'cast_origin_provenance',
      ],
      reason:
        'item 3161 专注意志/Focused Will：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；Wiki-only 合同——ability|pet 伤害（champion|pet cast origin）叠层，perCastThrottleMs=1000（每施法实例每秒至多 1 层），focused_will_stacks max4 / 聚合 refresh_on_write 6000ms，每层 +3%（1+0.03*stacks）ability|pet|proc 出站增伤；Phase-A 排除 item/basic_attack/innate 叠层与增伤路径；pipeline 先于 listener，触发伤害用 old-stack 层数。已由 generic_focused_will_3161_test.go + backend lol_generic_focused_will_3161_seed.sql / GenericCastOriginPerCastThrottleDbContractSqlTest + LolGenericFocusedWill3161SeedSqlTest 双边闭环；Web types + combatDataAssembler 精确投影 optional castOrigin/perCastThrottleMs（不声称 UI/live publish）。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-focused-will-3161',
          WASM.focusedWill3161,
          'Focused Will: ability|pet grant + perCastThrottle 1000ms + max4/6000ms aggregate refresh + 3% ability|pet|proc amp + item/basic/innate exclusions + old-stack ordering; via generic_focused_will_3161_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-focused-will-3161',
          SEED.focusedWill3161Backend,
          'backend lol_generic_focused_will_3161_seed.sql + GenericCastOriginPerCastThrottleDbContractSqlTest + LolGenericFocusedWill3161SeedSqlTest; Web combatDataAssembler/types optional castOrigin/perCastThrottleMs projection; not claiming UI/live publish',
        ),
      ],
    },
  ],
  [
    '3073|过载',
    {
      classification: 'migrated',
      tags: ['ultimate_cast_timed_attack_speed', 'attack_speed_percent_add'],
      sourceRef:
        '数据参考/lol-wiki-current-items/current-items.normalized.json#item_3073_Overdrive',
      reason:
        'item 3073 过载/Overdrive：League Wiki Module:ItemData/data revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；classic/ranged 伤害分支——ad=40 / attack_speed=0.20 / hp=450；终极施放武装 +0.50 bonus AS for [0,8000ms)，30000ms CD starts on cast。已由 generic_experimental_hexplate_3073_test.go + backend lol_generic_experimental_hexplate_3073_seed.sql / LolGenericExperimentalHexplate3073SeedSqlTest 双边闭环。明确排除 +20% movement speed、Hexcharged 30 ultimate haste、melee 35%/14%、Arena、non-champion/multi-target，故标 migrated/completed；不声称 live migrate/publish。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-min-validation-coverage-audit',
          WASM.experimentalHexplate3073,
          'completedBoundary: classic/ranged Overdrive ultimate arm / +0.50 AS [0,8000ms) / 30000ms CD on cast / non-ultimate reject; excluded MS / Hexcharged haste / melee / Arena / non-champion-multitarget; via generic_experimental_hexplate_3073_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-min-validation-coverage-audit',
          SEED.experimentalHexplate3073Backend,
          'completedBoundary: Overdrive seeded; backend lol_generic_experimental_hexplate_3073_seed.sql + LolGenericExperimentalHexplate3073SeedSqlTest; excluded MS / Hexcharged haste / melee / Arena / non-champion-multitarget; not claiming live migrate/publish',
        ),
      ],
    },
  ],
  [
    '6610|光盾打击',
    {
      classification: 'migrated',
      tags: ['conditional_guaranteed_crit', 'first_attack', 'absolute_crit_damage'],
      sourceRef:
        '数据参考/lol-wiki-current-items/current-items.normalized.json#item_6610_Lightshield_Strike',
      reason:
        'item 6610 光盾打击/Lightshield Strike：League Wiki Module:ItemData/data revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；classic 伤害分支——对英雄下一次普攻必定暴击、绝对总暴击伤害 1.60、provider_target cooldown 10000ms。已由 generic_sundered_sky_6610_test.go + backend lol_generic_sundered_sky_6610_seed.sql / LolGenericSunderedSky6610SeedSqlTest 双边闭环。明确排除治疗/overheal、Infinity Edge 或其他暴击伤害组合、Arena、non-champion、live publish/migration、多目标持久状态，故标 migrated/completed；不声称 live migrate/publish。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-min-validation-coverage-audit',
          WASM.sunderedSky6610,
          'completedBoundary: classic Lightshield Strike champion next BA guaranteed crit / absolute total crit damage 1.60 / provider_target CD 10000ms / first-hit CD / p=0|0.25|1 natural+forced; excluded healing/overheal / IE or other crit-damage combos / Arena / non-champion / multi-target persistent state; via generic_sundered_sky_6610_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-min-validation-coverage-audit',
          SEED.sunderedSky6610Backend,
          'completedBoundary: Lightshield Strike seeded; backend lol_generic_sundered_sky_6610_seed.sql + LolGenericSunderedSky6610SeedSqlTest; excluded healing/overheal / IE or other crit-damage combos / Arena / non-champion / multi-target persistent state; not claiming live migrate/publish',
        ),
      ],
    },
  ],
  [
    '3032|疾风骤雨',
    {
      classification: 'migrated',
      tags: ['timed_attack_speed_modifier', 'attack_crit_cooldown_interaction'],
      sourceRef:
        '数据参考/lol-wiki-current-items/current-items.normalized.json#item_3032_Flurry',
      reason:
        'item 3032 疾风骤雨/Flurry：League Wiki Module:ItemData/data revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；classic 伤害分支——对英雄普攻武装 +30% bonus AS for 6000ms、30000ms cooldown；listener event/damage_instance + ability/basic_attack + event/source_owner 且 perCastThrottleMs=1；每次普攻伤害实例以 state_duration_change 按 1000+1000*clamp(event.damage.effectiveCritChance,0,1) ms 缩短剩余冷却；首击先武装 active+cooldown 再立即减冷却。已由 generic_yun_tal_flurry_3032_test.go + backend lol_generic_yun_tal_flurry_3032_seed.sql / LolGenericYunTalFlurry3032SeedSqlTest 双边闭环。明确排除 projectile/launch-vs-hit 时序（超出 1v1 damage_instance 近似）、RNG、Arena、non-champion/multi-target、live migration/publish，故标 migrated/completed；不声称 live migrate/publish。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-min-validation-coverage-audit',
          WASM.yunTalFlurry3032,
          'completedBoundary: classic Flurry BA arm / +30% AS [0,6000ms) / 30000ms CD / state_duration_change CDR 1000+1000*clamp(effectiveCritChance,0,1) / perCastThrottleMs=1 / first-hit arm then immediate CDR; excluded projectile launch-vs-hit beyond 1v1 damage_instance / RNG / Arena / non-champion-multitarget / live migrate-publish; via generic_yun_tal_flurry_3032_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-min-validation-coverage-audit',
          SEED.yunTalFlurry3032Backend,
          'completedBoundary: Flurry seeded; backend lol_generic_yun_tal_flurry_3032_seed.sql + LolGenericYunTalFlurry3032SeedSqlTest; excluded projectile launch-vs-hit beyond 1v1 damage_instance / RNG / Arena / non-champion-multitarget / live migrate-publish; not claiming live migrate/publish',
        ),
      ],
    },
  ],
  [
    '3124|怨怒',
    {
      classification: 'migrated',
      tags: ['on_hit', 'flat_magic_damage'],
      reason:
        'item 3124 怨怒 on-hit 已由 adc-item-passives-base seed + generic_completed_onhit_mechanisms_test.go（commit 3314c24）闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-completed-onhit-mechanisms',
          WASM.completedOnHit,
          `Guinsoo Wrath flat magic on-hit; commit ${COMPLETED_ONHIT_COMMIT}`,
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-adc-item-passives-base',
          SEED.adcItemOnHit,
          'Guinsoo Wrath flat magic on-hit seed',
        ),
      ],
    },
  ],
  [
    '3153|雾之锋',
    {
      classification: 'migrated',
      tags: ['on_hit', 'target_current_hp_ratio'],
      reason:
        'item 3153 雾之锋 on-hit 已由 adc-item-passives-base seed + generic_completed_onhit_mechanisms_test.go（commit 3314c24）闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-completed-onhit-mechanisms',
          WASM.completedOnHit,
          `BotRK Mist's Edge current-HP on-hit; commit ${COMPLETED_ONHIT_COMMIT}`,
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-adc-item-passives-base',
          SEED.adcItemOnHit,
          'BotRK Mist\'s Edge current-HP on-hit seed',
        ),
      ],
    },
  ],
  [
    '3124|沸腾打击',
    {
      classification: 'migrated',
      tags: ['stacking_stat_modifier_on_hit', 'phantom_hit_on_hit_repeat'],
      reason:
        'item 3124 沸腾打击：满层后每第三次攻击 phantom（连续攻击 7/10/13…）；到达第 4 层的攻击不计入 counter；用 state_change+condition 递增/重置 guinsoos_phantom_hit_counter 后再 conditional register repeat，非 threshold-repeat alone。generic compile/run：generic_guinsoo_h_test.go + generic_guinsoo_k_test.go（TestGenericRunGuinsooCadenceEveryThirdAtFull）。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-guinsoo-hk',
          WASM.guinsooH,
          'Guinsoo Seething Strike stack/state path via generic_guinsoo_h_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-guinsoo-hk',
          WASM.guinsooK,
          'Guinsoo boiling strike already-full every-third cadence via generic_guinsoo_k_test.go TestGenericRunGuinsooCadenceEveryThirdAtFull',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-guinsoo-hk',
          SEED.guinsoo,
          'Guinsoo boiling strike seed lol_guinsoo_hk_seed.sql',
        ),
      ],
    },
  ],
  [
    '3078|咒刃',
    {
      classification: 'migrated',
      tags: ['spellblade_next_attack_state'],
      reason: 'item 3078 咒刃已由 wasm-generic-spellblade 批次 seed/mount + generic_spellblade_test.go 闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-spellblade',
          WASM.spellblade,
          'Trinity Force Spellblade next-attack state via generic_spellblade_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-spellblade',
          SEED.spellblade,
          'Trinity Force Spellblade next-attack state seed',
        ),
      ],
    },
  ],
  [
    '3100|咒刃',
    {
      classification: 'migrated',
      tags: ['spellblade_next_attack_state'],
      reason:
        'item 3100 巫妖之祸咒刃已由 lich-bane seed + generic_spellblade_test.go（Lich section）闭环（含 ready AS / intervalFormula cadence）。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-lich-bane-spellblade',
          WASM.spellblade,
          'Lich Bane Spellblade magic next-attack + ready AS percent_add via generic_spellblade_test.go Lich section',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-lich-bane-spellblade',
          SEED.lichBaneSpellblade,
          'Lich Bane Spellblade magic next-attack + ready AS percent_add seed',
        ),
      ],
    },
  ],
  [
    '3508|咒刃',
    {
      classification: 'migrated',
      tags: ['spellblade_next_attack_state'],
      reason:
        'item 3508 夺萃之镰咒刃已由 wasm-generic-essence-reaver-spellblade 批次闭环（物理契约 1.25 * base AD + 50 * resolved crit chance；10s ready；命中开始 1.5s ICD）。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-essence-reaver-spellblade',
          WASM.essenceReaverSpellblade,
          'Essence Reaver Spellblade via generic_essence_reaver_spellblade_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-essence-reaver-spellblade',
          SEED.essenceReaverSpellblade,
          'Essence Reaver Spellblade: 1.25 * base AD + 50 * resolved crit chance; 10s ready; hit-started 1.5s ICD',
        ),
      ],
    },
  ],
  [
    '2510|咒刃',
    {
      classification: 'migrated',
      tags: ['spellblade_next_attack_state'],
      reason:
        'item 2510 黄昏与黎明/Dusk and Dawn 咒刃：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；完成 exact 合同——10s ready；原魔法伤害 0.75 base AD + 0.10 resolved AP；原自身治疗 0.10 AP + 0.03 bonus HP；强化命中后 +200ms 一次 canonical copyable-on-hit replay；1.5s ICD 自强化命中开始；自身 Spellblade 伤害 non-copyable；共享 ready gate/无递归；不声称 live publish/migration。已由 generic_dusk_and_dawn_spellblade_test.go + backend lol_generic_dusk_and_dawn_spellblade_seed.sql / LolGenericDuskAndDawnSpellbladeSeedSqlTest + Web combatDataAssembler.test.ts delayMs=200→repeatDelayMs 投影闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-dusk-and-dawn-spellblade',
          WASM.duskAndDawnSpellblade,
          'Dusk and Dawn Spellblade exact: ability_start 10s ready; hit magic 0.75*base AD + 0.10*resolved AP; heal 0.10*AP + 0.03*bonus HP once; +200ms copyable-on-hit replay; 1.5s ICD on empowered hit; own damage non-copyable; shared ready/no recursion; via generic_dusk_and_dawn_spellblade_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-dusk-and-dawn-spellblade',
          SEED.duskAndDawnSpellblade,
          'backend lol_generic_dusk_and_dawn_spellblade_seed.sql + LolGenericDuskAndDawnSpellbladeSeedSqlTest; Web combatDataAssembler.test.ts delayMs=200→repeatDelayMs projection; not claiming live publish/migration',
        ),
      ],
    },
  ],
  [
    '6672|放倒它',
    {
      classification: 'migrated',
      tags: ['every_n_hit', 'target_missing_hp_amp'],
      reason:
        'item 6672 放倒它已由 adc-item-passives-base seed + generic_completed_onhit_mechanisms_test.go（commit 3314c24）闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-completed-onhit-mechanisms',
          WASM.completedOnHit,
          `Kraken Slayer Bring It Down every-3rd missing-HP amp; commit ${COMPLETED_ONHIT_COMMIT}`,
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-adc-item-passives-base',
          SEED.adcItemOnHit,
          'Kraken Slayer Bring It Down every-3rd missing-HP amp seed',
        ),
      ],
    },
  ],
  [
    '3094|神射手',
    {
      classification: 'migrated',
      tags: ['energized_charge_and_consume'],
      reason: 'item 3094 神射手已由 wasm-generic-energized 批次 seed/mount + generic_energized_test.go 闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-energized',
          WASM.energized,
          'Rapid Firecannon Sharpshooter energized consume via generic_energized_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-energized',
          SEED.energized,
          'Rapid Firecannon Sharpshooter energized consume seed',
        ),
      ],
    },
  ],
  [
    '3087|电疗',
    {
      classification: 'migrated',
      tags: ['energized_charge_and_consume'],
      reason:
        'item 3087 电疗主目标 Energized provider 已由 wasm-generic-statikk-shiv-energized 批次闭环（+15 charge / 上限 100 / 60 魔法伤害；source-owner basic_attack_hit；条件性 consume 后无条件 recharge）。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-statikk-shiv-energized',
          WASM.statikkShivEnergized,
          'Statikk Shiv Energized via generic_statikk_shiv_energized_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-statikk-shiv-energized',
          SEED.statikkShivEnergized,
          'Statikk Shiv 电疗: +15 charge (cap 100), 60 magic damage on ready seed',
        ),
      ],
    },
  ],
  [
    '3032|熟能生巧',
    {
      classification: 'migrated',
      tags: ['permanent_stacking_dynamic_crit_modifier'],
      reason:
        'item 3032 熟能生巧已由 wasm-generic-yun-tal-practice-makes-lethal 批次闭环：每次 source-owner ORIGINAL basic_attack_hit 永久 +1 practice_crit_stacks（上限 63）；暴击率动态 min(0.25, 0.004 * state)；仅 phantom/copied-on-hit 回放不计层。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-yun-tal-practice-makes-lethal',
          WASM.yunTalPracticeMakesLethal,
          'Yun Tal Practice Makes Lethal via generic_yun_tal_practice_makes_lethal_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-yun-tal-practice-makes-lethal',
          SEED.yunTalPracticeMakesLethal,
          'Yun Tal 熟能生巧 seed: practice_crit_stacks max 63; crit chance dynamic min(0.25, 0.004 * state)',
        ),
      ],
    },
  ],
  [
    '3091|喧争',
    {
      classification: 'migrated',
      tags: ['on_hit', 'flat_magic_damage'],
      reason:
        'item 3091 喧争已由 wasm-generic-wits-end-fray 批次闭环：source-owner ORIGINAL basic_attack_hit 造成恒定 45 额外魔法 on-hit；copyable_on_hit=true；Guinsoo phantom/copied-on-hit 回放可精确复制一次且不递归；不建模吸血元数据。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-wits-end-fray',
          WASM.witsEndFray,
          'Wits End Fray via generic_wits_end_fray_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-wits-end-fray',
          SEED.witsEndFray,
          'Wits End Fray: constant 45 bonus magic on-hit seed; copyable_on_hit=true',
        ),
      ],
    },
  ],
  [
    '3004|敬畏',
    {
      classification: 'migrated',
      tags: ['source_only_dynamic_mana_max_ad_modifier'],
      reason:
        'item 3004 敬畏已由 wasm-generic-manamune-awe 批次闭环：source-only 动态 AD = 0.02 * source.attr.mana.max；mana.max 0/1000/2000 → +0/+20/+40；无 event/state。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-manamune-awe',
          WASM.manamuneAwe,
          'Manamune Awe via generic_manamune_awe_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-manamune-awe',
          SEED.manamuneAwe,
          'Manamune Awe seed: AD = 0.02 * mana.max; tests 0/1000/2000 → +0/+20/+40',
        ),
      ],
    },
  ],
  [
    '2501|专横',
    {
      classification: 'migrated',
      tags: ['source_only_dynamic_bonus_hp_ad_modifier'],
      reason:
        'item 2501 专横/Tyranny 已由 wasm-generic-wiki-ready-items 闭环：source-only 动态 bonus AD = 2.5% bonus health；bonus HP 0/400/1000 → +0/+10/+25；真实 CompileGeneric+RunGeneric；幂等 seed/mount，未 live publish。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-wiki-ready-items',
          WASM.wikiReadyItems,
          'Tyranny: bonus HP 0/400/1000 → bonus AD 0/10/25 via CompileGeneric+RunGeneric; not live published',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-wiki-ready-items',
          SEED.wikiReadyItems,
          'backend lol_generic_wiki_ready_items_seed.sql idempotent seed/mount; LolGenericWikiReadyItemsSeedSqlTest; not live published',
        ),
      ],
    },
  ],
  [
    '2501|报复',
    {
      classification: 'migrated',
      tags: ['source_only_missing_health_ratio_dynamic_ad_multiply'],
      reason:
        'item 2501 报复/Retribution 已由 wasm-generic-wiki-ready-items 闭环：同一 item_2501 provider 第二枚 AD modifier（multiply Priority=100）；factor=1+clamp(missingHPRatio,0,0.70)*(0.12/0.70)；乘在已解析 AD（含专横 add）之上；full/50%/70%/90%cap + 同跑 HP 重解析；数值真源 数据参考/lol-wiki-current-items/manifest.json@revid4030984 contentSha256:e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；未 live publish。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-wiki-ready-items',
          WASM.wikiReadyItems,
          'Retribution: multiply after Tyranny; missing 0/50%/70%/90%cap + HP re-resolve; Wiki revid4030984 sha e7818eff…; not live published',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-wiki-ready-items',
          SEED.wikiReadyItems,
          'backend lol_generic_wiki_ready_items_seed.sql idempotent item_2501 seed/mount; LolGenericWikiReadyItemsSeedSqlTest; not live published',
        ),
      ],
    },
  ],
  [
    '3097|弩箭',
    {
      classification: 'migrated',
      tags: ['energized_precharged_bolt_consume'],
      reason:
        'item 3097 弩箭/Bolt（仅预充能口径）已由 wasm-generic-wiki-ready-items 闭环：初始 charge=100；首次真实普攻 100 magic 并消费；第二次不 proc；phantom/copied-on-hit 不额外触发；移速分支与 3097 盈能充能速率不在本口径；未 live publish。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-wiki-ready-items',
          WASM.wikiReadyItems,
          'Bolt: initial charge100, first AA 100 magic + consume, second no proc, phantom no extra trigger; not live published',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-wiki-ready-items',
          SEED.wikiReadyItems,
          'backend lol_generic_wiki_ready_items_seed.sql idempotent seed/mount; LolGenericWikiReadyItemsSeedSqlTest; not live published',
        ),
      ],
    },
  ],
  [
    '3004|法力流',
    {
      classification: 'blocked',
      tags: [
        'periodic_charge_tick',
        'attack_or_ability_hit_resource_gain',
        'state_driven_max_mana_and_transform',
      ],
      reason:
        'item 3004 法力流现行合同：每8秒充能至多4层；普攻或技能命中消耗一层并获得+3最大法力（对英雄+6），上限360后转变为魔切。当前 generic 缺 periodic_charge_tick / attack_or_ability_hit_resource_gain / state_driven_max_mana_and_transform；敬畏闭环不等于法力流已迁。',
      remainingGap:
        '缺 periodic_charge_tick（无数据驱动 provider 周期充能调度）、attack_or_ability_hit_resource_gain（本数据路径无通用技能命中源事件）、state_driven_max_mana_and_transform（无状态驱动最大法力累积与条件实体/provider 转变）。',
      coverageEvidence: [],
    },
  ],
  [
    '6676|死',
    {
      classification: 'migrated',
      tags: ['execute_threshold'],
      reason: 'item 6676 死/execute 已由 wasm-generic-execute-threshold 批次 seed/mount + generic_execute_test.go 闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-execute-threshold',
          WASM.execute,
          'Collector Death execute threshold via generic_execute_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-execute-threshold',
          SEED.execute,
          'Collector Death execute threshold seed',
        ),
      ],
    },
  ],
  [
    '3071|切割',
    {
      classification: 'partial',
      tags: ['stacking_stat_modifier_on_hit', 'linked_effects', 'armor_shred'],
      reason: 'Black Cleaver 切割已迁 linked-effects，但 6s/刷新/掉层语义未完整覆盖。',
      remainingGap: '缺 6s 持续、刷新与掉层完整语义；当前仅覆盖 on_damage_dealt 叠层削甲主路径。',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-linked-effects-black-cleaver',
          WASM.linkedEffects,
          'completedBoundary: on_damage_dealt Carve stack shred via generic_linked_effects_test.go; remainingGap: full 6s refresh/expiry drop semantics',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-linked-effects-black-cleaver',
          SEED.linked,
          'completedBoundary: Black Cleaver Carve linked armor shred seeded; remainingGap: partial timing semantics',
        ),
      ],
    },
  ],
  [
    '3748|顺劈',
    {
      classification: 'partial',
      tags: ['on_hit', 'formula_on_hit', 'multi_target_or_area'],
      reason: '巨九主目标 on-hit 公式已迁，多目标 cleave 未迁。',
      remainingGap: '主目标公式已 seed；身后锥形/多目标 cleave 与主动刚斩仍未迁。',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-completed-onhit-mechanisms',
          WASM.completedOnHit,
          `completedBoundary: shared primary-target on-hit physical=source.hp.max*0.005 for both 3748 cleave components; commit ${COMPLETED_ONHIT_COMMIT}; remainingGap: cone/cleave/active unmigrated`,
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-formula-onhit-batch',
          SEED.formulaOnHit,
          'completedBoundary: Titanic Hydra primary-target on-hit only; remainingGap: behind-target cleave and active unmigrated',
        ),
      ],
    },
  ],
  // --- Yunara R: upgraded Arc of Ruin W damage formula missing locally; not OOS ---
  [
    'hero_yunara|R',
    {
      classification: 'blocked',
      tags: ['transcendent_form_skill_upgrade', 'cross_skill_damage_formula'],
      reason:
        'Yunara R 定圣诀进入 Transcendent State 并将 W 升级为 Arc of Ruin；R 页仅给出 Arc of Ruin base damage，本地 Wiki generic 缺 upgraded Arc of Ruin（W）完整伤害公式',
      remainingGap:
        'Yunara R 定圣诀进入 Transcendent State 并将 W 升级为 Arc of Ruin；R 页仅给出 Arc of Ruin base damage，本地 Wiki generic 缺 upgraded Arc of Ruin（W）完整伤害公式',
      coverageEvidence: [],
      dataGapEvidence: null, // filled at classify time via yunaraRDataGapEvidence()
    },
  ],
  // --- explicit out_of_scope: Aphelios full weapon/ammo/swap system skipped ---
  [
    'hero_aphelios|P',
    {
      classification: 'out_of_scope',
      tags: ['weapon_ammo_swap_system'],
      reason:
        '用户明确跳过 Aphelios 整套武器/弹药/换枪复杂系统；P/Q/W/E/R 统一 out_of_scope。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    'hero_aphelios|Q',
    {
      classification: 'out_of_scope',
      tags: ['weapon_ammo_swap_system'],
      reason:
        '用户明确跳过 Aphelios 整套武器/弹药/换枪复杂系统；P/Q/W/E/R 统一 out_of_scope。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    'hero_aphelios|W',
    {
      classification: 'out_of_scope',
      tags: ['weapon_ammo_swap_system'],
      reason:
        '用户明确跳过 Aphelios 整套武器/弹药/换枪复杂系统；P/Q/W/E/R 统一 out_of_scope。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    'hero_aphelios|E',
    {
      classification: 'out_of_scope',
      tags: ['weapon_ammo_swap_system'],
      reason:
        '用户明确跳过 Aphelios 整套武器/弹药/换枪复杂系统；P/Q/W/E/R 统一 out_of_scope。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    'hero_aphelios|R',
    {
      classification: 'out_of_scope',
      tags: ['weapon_ammo_swap_system'],
      reason:
        '用户明确跳过 Aphelios 整套武器/弹药/换枪复杂系统；P/Q/W/E/R 统一 out_of_scope。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  // --- explicit out_of_scope: pure non-damage hero slots ---
  [
    'hero_teemo|W',
    {
      classification: 'out_of_scope',
      tags: ['movement_only'],
      reason: 'Teemo W 小莫快跑为纯移速/冲刺，无主目标伤害分支；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    'hero_sivir|P',
    {
      classification: 'out_of_scope',
      tags: ['movement_only'],
      reason: 'Sivir P 敏锐疾行为攻击英雄后短暂移速，无伤害分支；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    'hero_sivir|R',
    {
      classification: 'out_of_scope',
      tags: ['movement_cooldown_meta'],
      reason: 'Sivir R 狩猎为友军移速与冷却缩短，无主目标伤害分支；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    'hero_kindred|R',
    {
      classification: 'out_of_scope',
      tags: ['survivability_only'],
      reason: 'Kindred R 羊灵生息为区域免死/治疗，无主目标伤害分支；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  // --- explicit out_of_scope: item branches (owner|passiveName) ---
  [
    '2517|盛宴',
    {
      classification: 'out_of_scope',
      tags: ['survivability_only', 'takedown_omnivamp'],
      reason: '2517 Feast/盛宴为击杀后全能吸血，非 1v1 主目标伤害；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '2520|破坏',
    {
      classification: 'out_of_scope',
      tags: ['meta_or_non_target_dps', 'turret_epic_monster'],
      reason: '2520 Demolish/破坏为防御塔/史诗野怪蓄意破坏，非英雄 1v1 DPS；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '3026|重生',
    {
      classification: 'out_of_scope',
      tags: ['meta_or_non_target_dps', 'resurrection'],
      reason: '3026 Rebirth/重生为致命伤害复活，非伤害机制；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '3033|重伤',
    {
      classification: 'out_of_scope',
      tags: ['grievous_wounds_only'],
      reason: '3033 Grievous Wounds/重伤仅施加重伤，无额外伤害；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '3074|顺劈',
    {
      classification: 'out_of_scope',
      tags: ['multi_target_or_area'],
      reason: '3074 Cleave/顺劈为周围额外目标 cleave，超出单目标审计边界。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '3078|加快',
    {
      classification: 'out_of_scope',
      tags: ['movement_only'],
      reason: '3078 Quicken/加快为攻击后移速，无伤害分支；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '3085|风怒',
    {
      classification: 'out_of_scope',
      tags: ['multi_target_or_area'],
      reason: '3085 Wind\'s Fury/风怒为额外目标弩箭，超出单目标审计边界。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '3146|无被动或仅主动/属性',
    {
      classification: 'out_of_scope',
      tags: ['stat_only_or_active_only'],
      reason: '3146 无被动/仅主动属性候选，非被动伤害机制；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '3156|救主灵刃',
    {
      classification: 'out_of_scope',
      tags: ['survivability_only'],
      reason: '3156 Lifeline/救主灵刃为低血护盾与吸血，非主目标伤害；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '3179|夜行者',
    {
      classification: 'migrated',
      tags: [
        'spellblade_next_attack_state',
        'start_ready_true_on_hit',
        'armor_pen_flat_scaled_true',
      ],
      reason:
        'item 3179 夜行者/Nightstalker：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d（current-items.raw.lua 8550-8584）；用户批准 Phase-A 1v1 口径——nightstalker_ready default1/max1 untimed 开局即 ready；首次 basic_attack_hit+source_owner 触发一次真实伤害 50+1.5*armor_pen_flat.resolved（Wiki lethality 18→77）；随后 ready→0；无 re-arm；CopyableOnHit=false/无递归 phantom；真伤无视抗性但护盾按当前 pipeline 吸收。明确排除视野/隐身/unseen≥1s、4s 强化窗、re-arm、封锁/Blackout、多目标与 live publish，故标 migrated/completed。已由 generic_nightstalker_3179_test.go + backend lol_generic_nightstalker_3179_seed.sql / LolGenericNightstalker3179SeedSqlTest 双边闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-nightstalker-3179',
          WASM.nightstalker3179,
          'completedBoundary: user-approved Phase-A Nightstalker (start-ready1 / first BA hit true 50+1.5*armor_pen_flat / 18→77 / consume ready0 / no re-arm / CopyableOnHit=false / true bypasses resist shields absorb); excluded: vision/stealth/unseen / 4s window / re-arm / Blackout / multi-target / live publish; via generic_nightstalker_3179_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-nightstalker-3179',
          SEED.nightstalker3179Backend,
          'completedBoundary: Nightstalker Phase-A seeded; backend lol_generic_nightstalker_3179_seed.sql + LolGenericNightstalker3179SeedSqlTest; not claiming live publish',
        ),
      ],
    },
  ],
  [
    '3179|封锁',
    {
      classification: 'out_of_scope',
      tags: ['meta_or_non_target_dps', 'ward_vision'],
      reason: '3179 Blackout/封锁为守卫显形/反隐，非英雄 1v1 DPS；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '6333|无视痛苦',
    {
      classification: 'out_of_scope',
      tags: ['survivability_only', 'incoming_damage_store'],
      reason: '6333 Ignore Pain/无视痛苦为承伤延迟存储，非输出伤害分支；重复记录统一 out_of_scope。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '6333|蔑视',
    {
      classification: 'out_of_scope',
      tags: ['survivability_only', 'takedown_heal'],
      reason: '6333 Defiance/蔑视为击杀净化存储伤害并治疗，非输出伤害；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '6609|劈削',
    {
      classification: 'out_of_scope',
      tags: ['grievous_wounds_only'],
      reason: '6609 Hackshorn/劈削仅施加重伤，无额外伤害；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '6631|顺劈',
    {
      classification: 'out_of_scope',
      tags: ['multi_target_or_area'],
      reason: '6631 Cleave/顺劈为周围额外目标，超出单目标审计边界。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '6673|救主灵刃',
    {
      classification: 'out_of_scope',
      tags: ['survivability_only'],
      reason: '6673 Lifeline/救主灵刃为低血护盾，非主目标伤害；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '6695|掠盾者',
    {
      classification: 'out_of_scope',
      tags: ['shield_reduction_only'],
      reason: '6695 Shield Reaver/掠盾者为护盾削减，非主目标伤害；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '6697|盛名',
    {
      classification: 'out_of_scope',
      tags: ['takedown_stat_buff'],
      reason: '6697 Eminence/盛名为击杀后临时 AD 层数，非直接伤害机制；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '6698|顺劈',
    {
      classification: 'out_of_scope',
      tags: ['multi_target_or_area'],
      reason: '6698 Cleave/顺劈为周围额外目标，超出单目标审计边界。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '3071|热烈',
    {
      classification: 'out_of_scope',
      tags: ['movement_only'],
      reason: '3071 热烈/Fervor 仅为造成物理伤害后获得移速，无伤害分支；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '2523|奥术瞄准',
    {
      classification: 'out_of_scope',
      tags: ['takedown_attack_range_only'],
      reason:
        '2523 Arcane Aim/奥术瞄准：takedown 后 +100 攻击距离 8 秒，无伤害增量；审计边界外。同装备 Magnification/高倍望远镜为独立完成口径，不得合并。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    '6696|涌动',
    {
      classification: 'out_of_scope',
      tags: ['cooldown_or_haste_without_rotation', 'takedown_ultimate_cdr_only'],
      reason:
        '6696 Flux/涌动：takedown 后返还 ultimate total cooldown（含 lethality 缩放），纯冷却轮转无伤害增量；审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    'hero_kalista|P',
    {
      classification: 'out_of_scope',
      tags: ['pure_movement_or_dash', 'martial_poise_dash'],
      reason:
        'Kalista P Martial Poise：纯位移/冲刺语义，无主目标伤害增量；单目标 DPS 审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    'hero_kindred|P',
    {
      classification: 'migrated',
      tags: ['attack_range_bonus', 'fixed_max_marks_phase_a', 'baked_qwe_mark_coefficients'],
      reason:
        'hero_kindred P 千珏之印/Mark of the Kindred：Wiki rev3994253（SHA256 9ac60eae427fac9ba279734dba2c01b34852eb0be84a01d95296328794afc14a）+ 用户批准 fixed 25-mark Phase-A 口径已由 wasm-generic-kindred-mark-of-kindred-max-marks + backend seed 闭环——无 kindred_marks 状态键；常驻 attack_range +250（500→750，共享 AA/E 距离语义）；Q 探针总 bonus AS 1.60×4000ms；W rank5 冠军探针 45+0.265*currentHP；E rank5 探针 200+0.175*missingHP（排除 crit/完整第三击）。明确排除狩猎/击杀/takedown、中间叠层、野怪/地图视野，且不得把 Q/W/E inventory 机制标为 completed（探针仅证明 P 派生系数），故标 migrated/completed。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-kindred-mark-of-kindred-max-marks',
          WASM.kindredMarkOfKindredMaxMarks,
          'completedBoundary: user-approved fixed 25-mark Phase-A (attack_range +250 / Q AS 1.60×4000ms / W 45+0.265*currentHP / E 200+0.175*missingHP / no kindred_marks key); excluded: hunting/takedown/kill / intermediate stacks / monsters/map/vision; Q/W/E inventory mechanisms NOT completed by probes',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-kindred-mark-of-kindred-max-marks',
          SEED.kindredMarkOfKindredMaxMarksBackend,
          'completedBoundary: Kindred P fixed 25-mark Phase-A seeded; backend lol_generic_kindred_mark_of_kindred_max_marks_seed.sql + LolGenericKindredMarkOfKindredMaxMarksSeedSqlTest; not claiming live publish; Q/W/E inventory unchanged',
        ),
      ],
    },
  ],
]);

/** Exact candidateKey overrides (takes precedence over owner|slot / owner|passive). */
const CANDIDATE_KEY_OVERRIDES = new Map([
  [
    'item_passive|6333|item_passive|无视痛苦|数据参考/item.json#data.6333|52e96cc8',
    {
      classification: 'out_of_scope',
      tags: ['survivability_only', 'incoming_damage_store'],
      reason: '6333 Ignore Pain 重复记录（52e96cc8）：承伤存储非输出伤害；out_of_scope。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    'item_passive|6333|item_passive|无视痛苦|数据参考/item.json#data.6333|668e55b0',
    {
      classification: 'out_of_scope',
      tags: ['survivability_only', 'incoming_damage_store'],
      reason: '6333 Ignore Pain 重复记录（668e55b0）：承伤存储非输出伤害；out_of_scope。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
  [
    'item_passive|6695|item_passive|掠盾者|数据参考/item.json#data.6695|2892fed0',
    {
      classification: 'out_of_scope',
      tags: ['shield_reduction_only'],
      reason: '6695 Shield Reaver/掠盾者（2892fed0）：护盾削减非主目标伤害；out_of_scope。',
      remainingGap: '',
      coverageEvidence: [],
    },
  ],
]);

const COMPONENT_EXCEPTIONS = [
  {
    match: (c) => c.ownerId === '6694' && c.passiveName === '严寒',
    result: {
      classification: 'out_of_scope',
      tags: ['control_only', 'slow'],
      reason: '严寒是低血量减速控制，不是 execute；本审计边界外。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'classification_note',
          '',
          '',
          'mis-tagged execute_threshold in legacy; control_only for G8',
        ),
      ],
    },
  },
  {
    match: (c) => c.ownerId === '3031',
    result: {
      classification: 'out_of_scope',
      tags: ['stat_only_or_active_only', 'cross_capability_crit_modifier'],
      reason: '静态属性/无被动候选；本审计不记为 migrated，仅记录 cross capability。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'cross_capability',
          'wasm-generic-crit-modifier-infinity-edge',
          SEED.crit,
          'IE expected-crit/static modifier capability exists; candidate itself is stat-only',
        ),
      ],
    },
  },
  {
    match: (c) => c.ownerId === '3087' && c.passiveName === '电火花',
    result: {
      classification: 'out_of_scope',
      tags: ['multi_target_or_area', 'energized_bounce'],
      reason: '纯多目标电火花 component，当前 ADC 被动 1v1 单目标伤害审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === '3153' && c.passiveName === '抓挠之影',
    result: {
      classification: 'out_of_scope',
      tags: ['slow', 'control_only'],
      reason: '破败副被动仅为减速控制，无主目标伤害分支；本审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === 'hero_akshan' && c.skillKey === 'E',
    result: {
      classification: 'out_of_scope',
      tags: ['swing_path_non_single_target', 'heroic_swing_movement'],
      reason:
        'Akshan E Heroic Swing：已审阅的非单目标摆荡/射击路径分支；per-shot 数值已知但 swing 路径超出单目标 DPS 审计边界。',
      remainingGap: '',
      coverageEvidence: [],
    },
  },
  {
    // Disabled: Graves P Phase-A flipped to EXACT_OVERRIDES migrated; keep matcher inert.
    match: (c) => false && c.ownerId === 'hero_graves' && c.skillKey === 'P',
    result: {
      classification: 'blocked',
      tags: ['shotgun_point_blank_pellets', 'ammo_reload'],
      reason:
        'DISABLED: Graves P New Destiny Phase-A now migrated via EXACT_OVERRIDES; Wiki reload unknown is completed-boundary exclusion only.',
      remainingGap: '',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === 'hero_caitlyn' && c.skillKey === 'P',
    result: {
      classification: 'blocked',
      tags: ['on_hit', 'crit_scaling'],
      reason: '旧规则因关键词误判为 out_of_scope，但含主目标爆头伤害；缺精确 generic seed/mount。',
      remainingGap: '缺 Caitlyn P Headshot 主目标伤害与暴击缩放 runtime/数据闭环。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === '2512' && c.passiveName === '开战弹幕',
    result: {
      classification: 'migrated',
      tags: ['ultimate_cast_armed_attacks', 'conditional_crit_damage', 'pre_mitigation_true_damage'],
      sourceRef:
        '数据参考/lol-wiki-current-items/current-items.normalized.json#item_2512_Opening_Barrage',
      reason:
        'item 2512 开战弹幕/Opening Barrage：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；classic 8s 窗 / next 3 BA / +50% bonus AS / forced expected-crit×0.80 / natural expected-crit 附加 0.15*naturalBranchRawAmount*originalCritChance pre-mitigation true / 45s CD。已由 generic_fiendhunter_bolts_2512_test.go + backend lol_generic_fiendhunter_bolts_2512_seed.sql / LolGenericFiendhunterBolts2512SeedSqlTest 双边闭环。明确排除 Night Vigil ultimate haste、Arena 222512、Web castOrigin projection（arm matcher 使用 ability/ultimate），故标 migrated/completed；不声称 live migrate/publish。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-min-validation-coverage-audit',
          WASM.fiendhunterBolts2512,
          'completedBoundary: classic Opening Barrage (ultimate arm / 8s window / 3 charges / +50% AS / forced expected-crit 0.80 / natural branch 0.15*raw*critChance pre-mitigation true / 45s CD / multi-segment throttle / resist+shield / recursion); excluded: Night Vigil ultimate haste / Arena 222512 / Web castOrigin projection; via generic_fiendhunter_bolts_2512_test.go',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-min-validation-coverage-audit',
          SEED.fiendhunterBolts2512Backend,
          'completedBoundary: Opening Barrage seeded; backend lol_generic_fiendhunter_bolts_2512_seed.sql + LolGenericFiendhunterBolts2512SeedSqlTest; excluded: Night Vigil ultimate haste / Arena 222512 / Web castOrigin projection; not claiming live migrate/publish',
        ),
      ],
    },
  },
  {
    match: (c) => c.ownerId === '3036' && c.passiveName === '巨人杀手',
    result: {
      classification: 'migrated',
      tags: ['outgoing_damage_modifier', 'bonus_health_ratio'],
      reason:
        '3036 Giant Slayer/巨人杀手：Wiki 目标 bonus health 每 100 +1% 最多 15%（1500）outgoing damage amp；wasm-generic-pipeline-damage-modifier + backend lol_generic_pipeline_damage_items_seed.sql 闭环——bonus HP 0/400/1500/2000 → 100/104/115/115；当前 1v1 max-base 代理（target.attr.hp.max - target.attr.hp.base）；不声称 non-champion 过滤或 live publish。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-pipeline-damage-modifier',
          WASM.pipelineDamageModifier,
          'completedBoundary: Giant Slayer Wiki 1%/100 cap15; CompileGeneric+RunGeneric bonusHP 0/400/1500/2000 → 100/104/115/115; source-owned outgoing_pre_mitigation multiply; current 1v1 max-base proxy; no non-champion filter/live publish claim',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-pipeline-damage-modifier',
          SEED.pipelineDamageItemsBackend,
          'completedBoundary: Giant Slayer 1%/100 cap15 seeded; bonusHP 0/400/1500/2000 → 100/104/115/115; max-base proxy; backend lol_generic_pipeline_damage_items_seed.sql; no non-champion filter/live publish claim',
        ),
      ],
    },
  },
  {
    // Input Batch-G tag remains seeded_*; output primitive key means reproducible RNG, not data seed.
    match: (c) => (c.mechanismTags || []).includes('seeded_random_crit_sequence'),
    result: {
      classification: 'blocked',
      tags: ['deterministic_random_crit_sequence'],
      reason:
        'deterministic_random_crit_sequence：expected crit 不证明可复现 RNG/on-crit 序列语义。',
      remainingGap:
        '缺 deterministic_random_crit_sequence / on_crit_event 运行时原语；不得用 expected-crit 冒充完成。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => {
      const tags = c.mechanismTags || [];
      if (c.ownerId === 'hero_kalista' && c.skillKey === 'P') return false;
      if (c.ownerId === 'hero_kindred' && c.skillKey === 'P') return false;
      return (
        (tags.includes('distance_based_damage_modifier')
          || tags.includes('damage_multiplier_or_health_ratio'))
        && !exactOverrideFor(c)
      );
    },
    result: {
      classification: 'blocked',
      tags: ['distance_or_ratio_modifier'],
      reason: 'distance_based_damage_modifier / damage_multiplier_or_health_ratio 无精确 migrated/partial 证据。',
      remainingGap: '缺 distance_or_ratio_input 与 damage_multiplier_or_health_ratio runtime 原语。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => {
      const tags = c.mechanismTags || [];
      if (!tags.includes('spellblade_next_attack_state')) return false;
      if (c.ownerId === '3078' && c.passiveName === '咒刃') return false;
      if (c.ownerId === '3100' && c.passiveName === '咒刃') return false;
      return true;
    },
    result: {
      classification: 'blocked',
      tags: ['spellblade_next_attack_state'],
      reason: 'spellblade 家族除 item 3078/3100 咒刃外全部 blocked（含 Draven Q）；同机制代表完成不等于本 candidate 已 seed。',
      remainingGap: '缺该 candidate 精确 spellblade_next_attack_state 武装/消费 runtime。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => {
      const tags = c.mechanismTags || [];
      if (!tags.includes('energized_charge_and_consume')) return false;
      if (c.ownerId === '3094' && c.passiveName === '神射手') return false;
      // 3097 弩箭预充能伤害口径由 exact override 闭环；3097 盈能充能速率仍走本家族 blocked。
      if (c.ownerId === '3097' && c.passiveName === '弩箭') return false;
      // 6699 苍穹 ranged/precharged Firmament 由 exact override 闭环；6699 通电仍 stale。
      if (c.ownerId === '6699' && c.passiveName === '苍穹') return false;
      return true;
    },
    result: {
      classification: 'blocked',
      tags: ['energized_charge_and_consume'],
      reason:
        'energized 除 item 3094 神射手、item 3097 弩箭与 item 6699 苍穹（预充能口径）外全部 blocked；同机制代表完成不等于本 candidate 已 seed（含 3097 盈能充能速率）。',
      remainingGap: '缺该 candidate 精确 energized_charge_and_consume 充能/消费 runtime。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => {
      const tags = c.mechanismTags || [];
      if (!tags.includes('stacking_stat_modifier_on_hit')) return false;
      if (c.ownerId === '3124' && c.passiveName === '沸腾打击') return false;
      if (c.ownerId === '3071' && c.passiveName === '切割') return false;
      return true;
    },
    result: {
      classification: 'blocked',
      tags: ['stacking_stat_modifier_on_hit'],
      reason: 'stacking modifier 除 item 3124 与 item 3071 外 blocked。',
      remainingGap: '缺该 candidate 精确 stacking_stat_modifier_on_hit 状态机 runtime；不得因 Guinsoo/黑切代表完成而 partial。',
      coverageEvidence: [],
    },
  },
];

const DAMAGE_SIGNAL_RE =
  /伤害|普攻|斩杀|处决|攻击特效|真实伤害|物理伤害|魔法伤害|额外伤害|每第[一二三四五六七八九十零〇两\d]+次|暴击伤害|造成\d|命中造成/;

/** Broader damage-related signals for OOS validation (a–e gate). */
const DAMAGE_RELATED_SIGNAL_RE =
  /造成.{0,16}伤害|额外伤害|真实伤害|物理伤害|魔法伤害|附带伤害|攻击特效|斩杀|处决|伤害放大|易伤|护甲穿透|魔法穿透|法术穿透|穿甲|法穿|命中造成|攻击速度|攻速|获得.{0,24}攻击力|获得.{0,24}法术强度|额外攻击力|额外法术强度|暴击伤害/;

const PURE_CONTROL_TAGS = new Set(['control_only', 'slow']);

const PURE_OOS_TAGS = new Set([
  'survivability_only',
  'control_only',
  'slow',
  'cooldown_or_haste_without_rotation',
  'meta_or_non_target_dps',
  'multi_target_or_area',
  'stat_only_or_active_only',
  'no_single_target_dps_effect',
]);

const OOS_DAMAGE_SIGNAL_DISPOSITIONS = new Set([
  'aphelios_owner_allowlist',
  'other_target_or_building_only',
  'sibling_primary_completed_remaining_oos',
  'post_kill_next_encounter_only',
  'trigger_phrase_no_damage_amp',
]);

const BOUNDARY_CATEGORIES = new Set([
  'complex_owner_skip',
  'pure_movement_or_dash',
  'pure_vision',
  'pure_heal_shield_survival',
  'pure_control_or_debuff',
  'economy_or_post_takedown',
  'cooldown_or_ability_haste_only',
  'building_or_nonchampion_only',
  'other_targets_only',
  'stat_or_active_only',
  'completed_primary_branch_remaining_component',
  'explicit_user_scope',
]);

const GENERIC_OOS_REASON_RE =
  /文本为纯 meta\/economy\/vision|纯 meta\/economy\/vision\/building/;

const STALE_OTHER_TARGETS_REASON_RE =
  /伤害\/效果仅作用于额外目标\/建筑\/守卫，主目标单标靶 DPS 不受益/;

const MOVE_SEMANTIC_RE = /移动速度|移速|冲刺|跃迁|位移|幽灵状态|进行冲刺|突进|冲刺一小段/;
const PRIMARY_DAMAGE_DEAL_RE =
  /造成.{0,16}(物理|魔法|真实)?伤害|额外伤害|每次攻击.{0,8}伤害|发射.{0,12}伤害/;
const POST_DAMAGE_UTILITY_ONLY_RE =
  /造成物理伤害时会提供|造成物理伤害后|攻击一个单位时会提供|攻击一位英雄.{0,6}会/;

function exactKeyOwnerSkill(c) {
  return `${c.ownerId}|${c.skillKey}`;
}

function exactKeyOwnerPassive(c) {
  return `${c.ownerId}|${c.passiveName}`;
}

function exactOverrideFor(c) {
  const raw =
    EXACT_OVERRIDES.get(exactKeyOwnerSkill(c))
    || EXACT_OVERRIDES.get(exactKeyOwnerPassive(c))
    || null;
  if (!raw) return null;
  if (exactKeyOwnerSkill(c) === 'hero_yunara|R') {
    const dataGapEvidence = yunaraRDataGapEvidence();
    return {
      ...raw,
      reason: dataGapEvidence.reasonZh,
      remainingGap: dataGapEvidence.reasonZh,
      dataGapEvidence,
    };
  }
  return raw;
}

/** Treat inventoried UTF-8 text as LF-canonical for evidence hashing (CRLF/CR → LF). */
function canonicalizeUtf8TextBytes(buf) {
  const text = Buffer.from(buf).toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return Buffer.from(text, 'utf8');
}

function canonicalizeEol(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function sha256File(filePath) {
  const buf = canonicalizeUtf8TextBytes(fs.readFileSync(filePath));
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function shortTextFp(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 8);
}

function candidateBaseKey(c) {
  return `${c.sourceKind}|${c.ownerId}|${c.skillKey}|${c.passiveName}`;
}

/**
 * Registry rows already carry explicit candidateKey (including opaque collision
 * suffixes). Do not re-derive keys from sourceRef/sourceText.
 */
function resolveCandidateKeys(candidates) {
  const used = new Set();
  const keys = [];
  for (const c of candidates) {
    const key = String(c.candidateKey || '').trim();
    if (!key) {
      throw new Error(
        `missing explicit candidateKey for ${candidateBaseKey(c)}`,
      );
    }
    if (used.has(key)) {
      throw new Error(`duplicate candidateKey ${key}`);
    }
    used.add(key);
    keys.push(key);
  }
  return keys;
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function summarizeSourceText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function cleanReasonForCategoryMatch(reason) {
  const r = String(reason || '');
  if (!r.trim()) return '';
  if (GENERIC_OOS_REASON_RE.test(r) || STALE_OTHER_TARGETS_REASON_RE.test(r)) return '';
  return r;
}

function boundaryReasonForCategory(category, label) {
  switch (category) {
    case 'complex_owner_skip':
      return `${label}：复杂所有者/武器弹药系统整包跳过；主目标伤害分支已复核为边界外。`;
    case 'pure_movement_or_dash':
      return `${label}：纯移速/冲刺/位移，无主目标伤害增量；审计边界外。`;
    case 'pure_vision':
      return `${label}：纯视野/显形/守卫侦察，不含伤害；审计边界外。`;
    case 'pure_heal_shield_survival':
      return `${label}：纯治疗/护盾/生存/免死，不增加对主目标输出；审计边界外。`;
    case 'pure_control_or_debuff':
      return `${label}：纯控制/减速/重伤，无主目标伤害增量；审计边界外。`;
    case 'economy_or_post_takedown':
      return `${label}：击杀/经济收益发生在当前唯一主目标死亡之后，encounter 已结束；审计边界外。`;
    case 'cooldown_or_ability_haste_only':
      return `${label}：纯冷却缩减/技能急速，无主目标伤害增量；审计边界外。`;
    case 'building_or_nonchampion_only':
      return `${label}：仅作用于防御塔/史诗野怪/非英雄单位，非英雄主目标 DPS；审计边界外。`;
    case 'other_targets_only':
      return `${label}：该 component 伤害仅作用于额外目标，主目标不受该 component 伤害；审计边界外。`;
    case 'stat_or_active_only':
      return `${label}：静态属性或仅主动效果，不构成被动主目标伤害分支；审计边界外。`;
    case 'completed_primary_branch_remaining_component':
      return `${label}：主目标伤害分支已完成；剩余为多目标/范围 component，审计边界外。`;
    case 'explicit_user_scope':
      return `${label}：用户显式划定审计范围外；主目标伤害分支已复核为边界外。`;
    default:
      return `${label}：当前 ADC 被动 1v1 单目标伤害审计边界外。`;
  }
}

function excludedBehaviorForCategory(category, tags, text) {
  switch (category) {
    case 'complex_owner_skip':
      return 'aphelios_weapon_ammo_swap_system';
    case 'explicit_user_scope':
      return 'explicit_user_audit_scope';
    case 'pure_movement_or_dash':
      return 'movement_speed_or_dash';
    case 'pure_vision':
      return 'ward_vision_or_trap_reveal';
    case 'pure_heal_shield_survival':
      if (tags.includes('incoming_damage_store')) return 'incoming_damage_store';
      if (tags.includes('hot_sustain')) return 'hot_sustain';
      if (/复活|重生|免死/.test(text)) return 'revive_or_death_save';
      if (/护盾/.test(text)) return 'self_shield_or_survivability';
      return 'heal_shield_or_survivability';
    case 'pure_control_or_debuff':
      if (tags.includes('grievous_wounds_only') || /重伤/.test(text)) return 'grievous_wounds_only';
      return 'crowd_control_or_slow';
    case 'economy_or_post_takedown':
      if (tags.includes('takedown_omnivamp')) return 'post_kill_omnivamp';
      if (tags.includes('takedown_stat_buff')) return 'post_kill_temporary_ad';
      if (tags.includes('takedown_heal')) return 'post_kill_heal';
      if (/金币|赏金/.test(text)) return 'economy_gold';
      return 'post_kill_or_takedown_utility';
    case 'cooldown_or_ability_haste_only':
      return 'cooldown_haste_without_damage';
    case 'building_or_nonchampion_only':
      return 'building_or_epic_monster_damage';
    case 'other_targets_only':
      return 'other_target_or_aoe_damage';
    case 'stat_or_active_only':
      return 'static_stats_or_active_only';
    case 'completed_primary_branch_remaining_component':
      return 'remaining_multi_target_cleave_after_primary_complete';
    default:
      return 'non_damage_audit_boundary';
  }
}

function dispositionForCategory(category, text, owner) {
  if (category === 'complex_owner_skip' || owner === 'hero_aphelios') {
    return 'aphelios_owner_allowlist';
  }
  if (category === 'other_targets_only' || category === 'building_or_nonchampion_only') {
    return 'other_target_or_building_only';
  }
  if (category === 'completed_primary_branch_remaining_component') {
    return 'sibling_primary_completed_remaining_oos';
  }
  if (category === 'economy_or_post_takedown') {
    return 'post_kill_next_encounter_only';
  }
  if (category === 'pure_vision' && DAMAGE_RELATED_SIGNAL_RE.test(text)) {
    // Ward/trap-only bonus damage is still vision-scope; gate via trigger_phrase.
    return 'trigger_phrase_no_damage_amp';
  }
  if (POST_DAMAGE_UTILITY_ONLY_RE.test(text) || DAMAGE_RELATED_SIGNAL_RE.test(text)) {
    if (
      category === 'pure_movement_or_dash'
      || category === 'pure_heal_shield_survival'
      || category === 'pure_control_or_debuff'
      || category === 'cooldown_or_ability_haste_only'
      || category === 'stat_or_active_only'
      || category === 'explicit_user_scope'
      || category === 'pure_vision'
    ) {
      return 'trigger_phrase_no_damage_amp';
    }
  }
  return 'no_primary_target_damage_branch';
}

/**
 * Resolve OOS boundaryCategory from source text / explicit override signals.
 * Must NOT default-guess from mechanismTags multi_target / meta_or_non_target_dps.
 */
function resolveBoundaryCategory({ text, tags, reason, owner, key, passive }) {
  const reasonClean = cleanReasonForCategoryMatch(reason);
  const blob = `${text}|${passive}|${reasonClean}`;

  if (
    tags.includes('swing_path_non_single_target')
    || tags.includes('heroic_swing_movement')
    || /Heroic Swing|摆荡|swing path/i.test(reasonClean)
  ) {
    return 'explicit_user_scope';
  }
  if (owner === 'hero_aphelios' || tags.includes('weapon_ammo_swap_system')) {
    return 'complex_owner_skip';
  }
  if (/用户明确/.test(reasonClean)) {
    return 'explicit_user_scope';
  }
  if (
    /主目标 on-hit 分支已完成|剩余 cleave/.test(reasonClean)
    || /3748/.test(String(key || ''))
  ) {
    return 'completed_primary_branch_remaining_component';
  }

  if (
    /额外目标|附近的敌人|周围的敌人|身后锥形|身后的敌人/.test(blob)
    || (/顺劈|cleave|连锁闪电|风怒/.test(blob) && /附近|额外|周围/.test(blob))
  ) {
    return 'other_targets_only';
  }

  if (
    tags.includes('turret_epic_monster')
    || (/防御塔|史诗级野怪|太阳圆盘|攻城兵|超级士兵/.test(blob)
      && !/敌方英雄/.test(text)
      && !PRIMARY_DAMAGE_DEAL_RE.test(text))
  ) {
    return 'building_or_nonchampion_only';
  }

  if (
    (/提供.{0,12}视野|真实视野|显形附近|侦察|派出一只鹰|显形守卫|黑雾|变为伪装/.test(text)
      || tags.includes('ward_vision'))
    && !/复活|额外金币|赏金/.test(text)
    && !PRIMARY_DAMAGE_DEAL_RE.test(text.replace(/对(其|守卫|陷阱).{0,12}(额外)?伤害/g, ''))
  ) {
    return 'pure_vision';
  }

  if (
    tags.includes('takedown_omnivamp')
    || tags.includes('takedown_stat_buff')
    || tags.includes('takedown_attack_range_only')
    || tags.includes('takedown_ultimate_cdr_only')
    || tags.includes('takedown_heal')
    || (/击杀|阵亡|参与击杀|takedown|赏金|额外金币|崇拜/.test(blob)
      && !PRIMARY_DAMAGE_DEAL_RE.test(text))
  ) {
    return 'economy_or_post_takedown';
  }

  if (
    /冲刺|跃迁|突进|进行冲刺/.test(text)
    && !PRIMARY_DAMAGE_DEAL_RE.test(text)
  ) {
    return 'pure_movement_or_dash';
  }

  if (
    tags.includes('survivability_only')
    || tags.includes('incoming_damage_store')
    || tags.includes('shield_reduction_only')
    || tags.includes('hot_sustain')
    || tags.includes('resurrection')
    || (/护盾|治疗|吸血|复活|免死|承伤|回复生命|法术护盾|溢出治疗/.test(blob)
      && !PRIMARY_DAMAGE_DEAL_RE.test(text))
  ) {
    return 'pure_heal_shield_survival';
  }

  if (
    tags.includes('control_only')
    || tags.includes('slow')
    || tags.includes('grievous_wounds_only')
    || (/减速|重伤|禁锢|击退|晕眩/.test(blob) && !PRIMARY_DAMAGE_DEAL_RE.test(text))
  ) {
    return 'pure_control_or_debuff';
  }

  if (
    MOVE_SEMANTIC_RE.test(text)
    && (!PRIMARY_DAMAGE_DEAL_RE.test(text) || POST_DAMAGE_UTILITY_ONLY_RE.test(text))
  ) {
    return 'pure_movement_or_dash';
  }

  if (
    tags.includes('cooldown_or_haste_without_rotation')
    || tags.includes('takedown_ultimate_cdr_only')
    || (/技能急速|终极技能急速|冷却时间缩短|返还.{0,8}冷却|冷却缩减/.test(blob)
      && !PRIMARY_DAMAGE_DEAL_RE.test(text)
      && !MOVE_SEMANTIC_RE.test(text))
  ) {
    return 'cooldown_or_ability_haste_only';
  }

  if (
    tags.includes('stat_only_or_active_only')
    || /无被动|仅主动|静态属性|射程随等级/.test(blob)
  ) {
    return 'stat_or_active_only';
  }

  if (MOVE_SEMANTIC_RE.test(blob)) return 'pure_movement_or_dash';
  if (/视野|守卫|显形|伪装/.test(blob)) return 'pure_vision';
  if (/金币|赏金/.test(blob)) return 'economy_or_post_takedown';
  if (/护盾|治疗|复活/.test(blob)) return 'pure_heal_shield_survival';
  if (/急速|冷却/.test(blob)) return 'cooldown_or_ability_haste_only';
  return 'stat_or_active_only';
}

/**
 * Infer concrete excluded behavior + disposition + boundaryCategory for an OOS candidate.
 * Category is driven by source text / explicit override — not multi_target/meta tag guessing.
 */
function oosWikiSourceRef(c) {
  const wiki = wikiNumericSource(c);
  if (wiki?.sourceRef) return wiki.sourceRef;
  const pageId = wikiPageIdForCandidate(c);
  if (pageId) return `${GENERIC_WIKI_REL}/${pageId}.json`;
  return IDENTITY_MANIFEST_REL;
}

/**
 * Copy OOS semantic shape from auditBaseline.outOfScope; Wiki text/ref are
 * display/evidence only (filled after semantics).
 */
function outOfScopeEvidenceFromBaseline(c, oos) {
  const wikiRef = oosWikiSourceRef(c);
  const sourceRef =
    c.sourceKind === 'hero_skill'
      ? (wikiRef || String(c.sourceRef || IDENTITY_MANIFEST_REL))
      : String(c.sourceRef || wikiRef || IDENTITY_MANIFEST_REL);
  return {
    sourceRef,
    sourceTextSummary: summarizeSourceText(c.sourceText),
    reviewedPrimaryTargetDamageBranch: true,
    boundaryCategory: oos.boundaryCategory,
    excludedBehavior: oos.excludedBehavior,
    boundaryReason: oos.boundaryReason,
    damageRelevantSubBranchDisposition: oos.damageRelevantSubBranchDisposition,
  };
}

/**
 * Last-resort text heuristics only when auditBaseline.outOfScope is missing.
 * Prefer fail-closed callers when baseline OOS is absent.
 */
function inferOutOfScopeEvidence(c, classificationReason) {
  const text = String(c.sourceText || '');
  const tags = c.mechanismTags || [];
  const reason = String(classificationReason || '');
  const owner = String(c.ownerId || '');
  const passive = String(c.passiveName || '');
  const label = passive || `${owner}|${c.skillKey || ''}`;
  const keyHint = c.candidateKey || `${c.sourceKind}|${owner}|${c.skillKey || ''}|${passive}`;

  const boundaryCategory = resolveBoundaryCategory({
    text,
    tags,
    reason,
    owner,
    key: keyHint,
    passive,
  });
  const excludedBehavior = excludedBehaviorForCategory(boundaryCategory, tags, text);
  const disposition = dispositionForCategory(boundaryCategory, text, owner);
  const boundaryReason = boundaryReasonForCategory(boundaryCategory, label);
  const wikiRef = oosWikiSourceRef(c);

  return {
    sourceRef: wikiRef,
    sourceTextSummary: summarizeSourceText(text),
    reviewedPrimaryTargetDamageBranch: true,
    boundaryCategory,
    excludedBehavior,
    boundaryReason,
    damageRelevantSubBranchDisposition: disposition,
  };
}

function resolveOutOfScopeEvidence(c, classificationReason) {
  const oos = c.auditBaseline?.outOfScope;
  if (
    oos
    && typeof oos === 'object'
    && String(oos.boundaryCategory || '').trim()
    && String(oos.excludedBehavior || '').trim()
    && String(oos.boundaryReason || '').trim()
    && String(oos.damageRelevantSubBranchDisposition || '').trim()
  ) {
    return outOfScopeEvidenceFromBaseline(c, oos);
  }
  // Fail-closed path for missing baseline: keep infer only as last resort.
  return inferOutOfScopeEvidence(c, classificationReason);
}

function specificOosReasonFromEvidence(ev, fallbackReason) {
  if (ev?.boundaryReason && !GENERIC_OOS_REASON_RE.test(ev.boundaryReason)
    && !STALE_OTHER_TARGETS_REASON_RE.test(ev.boundaryReason)) {
    return ev.boundaryReason;
  }
  if (fallbackReason && !GENERIC_OOS_REASON_RE.test(fallbackReason)
    && !STALE_OTHER_TARGETS_REASON_RE.test(fallbackReason)) {
    return fallbackReason;
  }
  return ev?.boundaryReason || fallbackReason || '当前 ADC 被动 1v1 单目标伤害审计边界外。';
}

/**
 * Fallback classification from wiki-only registry auditBaseline — not sourceText
 * / effect-name / language regex bucket decisions.
 */
function classifyFallback(c) {
  const baseline = c.auditBaseline || {};
  const bucket = String(baseline.resolvedBucket || '').trim();
  const tags = [...(baseline.mechanismTags || c.mechanismTags || [])];
  const gapCode = String(baseline.gapCode || '').trim();
  const disposition = String(baseline.damageDisposition || '').trim();

  if (bucket === 'out_of_scope') {
    const oos = baseline.outOfScope;
    if (!oos || typeof oos !== 'object') {
      return {
        classification: 'blocked',
        tags: tags.length ? tags : ['oos_missing_baseline'],
        reason:
          'auditBaseline.resolvedBucket=out_of_scope but auditBaseline.outOfScope missing; fail-closed blocked.',
        remainingGap: '缺 auditBaseline.outOfScope 语义字段，无法安全标 out_of_scope。',
        coverageEvidence: [],
      };
    }
    const ev = outOfScopeEvidenceFromBaseline(c, oos);
    return {
      classification: 'out_of_scope',
      tags: tags.length ? tags : ['audit_boundary'],
      reason: specificOosReasonFromEvidence(ev, oos.boundaryReason),
      remainingGap: '',
      coverageEvidence: [],
      outOfScopeEvidence: ev,
    };
  }

  if (bucket === 'blocked') {
    const gap =
      gapCode
      || String(c.blockedReason || '').trim()
      || (disposition && disposition !== 'not_applicable'
        ? `damageDisposition=${disposition}`
        : '')
      || '缺可审查的 generic 覆盖证据。';
    return {
      classification: 'blocked',
      tags: tags.length ? tags : ['unclassified'],
      reason: gapCode
        ? `auditBaseline.gapCode=${gapCode}${disposition ? `; damageDisposition=${disposition}` : ''}`
        : '未命中 exact/component 规则；auditBaseline.resolvedBucket=blocked。',
      remainingGap: gap,
      coverageEvidence: [],
    };
  }

  if (bucket === 'partial') {
    return {
      classification: 'partial',
      tags: tags.length ? tags : ['partial_remaining'],
      reason: 'auditBaseline.resolvedBucket=partial（无 exact override 时保留基线桶）。',
      remainingGap:
        gapCode || String(c.blockedReason || '').trim() || 'partial_remaining',
      coverageEvidence: [],
    };
  }

  if (bucket === 'migrated') {
    return {
      classification: 'migrated',
      tags: tags.length ? tags : ['audit_baseline_migrated'],
      reason: 'auditBaseline.resolvedBucket=migrated（无 exact override 时保留基线桶）。',
      remainingGap: '',
      coverageEvidence: [],
    };
  }

  return {
    classification: 'blocked',
    tags: tags.length ? tags : ['unclassified'],
    reason: '缺 auditBaseline.resolvedBucket；保守 blocked。',
    remainingGap: '缺可审查的 generic 覆盖证据。',
    coverageEvidence: [],
  };
}

function classifyCandidate(c, candidateKey) {
  let classified;
  if (candidateKey && CANDIDATE_KEY_OVERRIDES.has(candidateKey)) {
    const byKey = CANDIDATE_KEY_OVERRIDES.get(candidateKey);
    classified = {
      ...byKey,
      tags: byKey.tags || c.mechanismTags || [],
    };
  } else {
    const exact = exactOverrideFor(c);
    if (exact) {
      classified = {
        ...exact,
        tags: exact.tags || c.mechanismTags || [],
      };
    } else {
      classified = null;
      for (const ex of COMPONENT_EXCEPTIONS) {
        if (ex.match(c)) {
          classified = {
            ...ex.result,
            tags: ex.result.tags || c.mechanismTags || [],
          };
          break;
        }
      }
      if (!classified) classified = classifyFallback(c);
    }
  }

  if (classified.classification === 'out_of_scope') {
    // Overrides/fallback: prefer auditBaseline.outOfScope semantics; Wiki ref/text for display.
    const ev = resolveOutOfScopeEvidence(
      { ...c, mechanismTags: classified.tags || c.mechanismTags },
      classified.reason,
    );
    classified = {
      ...classified,
      outOfScopeEvidence: ev,
      reason: specificOosReasonFromEvidence(ev, classified.reason),
    };
  }

  return applyDataGapToBlockedClassification(c, classified);
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows) {
  const headers = [
    'candidateKey',
    'sourceKind',
    'ownerId',
    'ownerName',
    'skillKey',
    'passiveName',
    'oldClassification',
    'genericClassification',
    'genericMechanismTags',
    'evidenceTaskKeys',
    'evidenceSourcePaths',
    'evidenceSourceWorktrees',
    'remainingGap',
    'dataGapMissingFields',
    'dataGapEvidenceJson',
    'outOfScopeExcludedBehavior',
    'outOfScopeEvidenceJson',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvEvidenceFields(coverageEvidence) {
  const ev = coverageEvidence || [];
  return {
    evidenceTaskKeys: ev.map((e) => e.taskKey).filter(Boolean).join('|'),
    evidenceSourcePaths: ev.map((e) => e.sourcePath).filter(Boolean).join('|'),
    evidenceSourceWorktrees: ev.map((e) => e.sourceWorktree).filter(Boolean).join('|'),
  };
}

function buildSummary(records) {
  const classificationCounts = Object.fromEntries(CLASSIFICATIONS.map((k) => [k, 0]));
  const sourceKindCounts = { hero_skill: 0, item_passive: 0 };
  for (const r of records) {
    classificationCounts[r.genericClassification] += 1;
    sourceKindCounts[r.sourceKind] = (sourceKindCounts[r.sourceKind] || 0) + 1;
  }
  const total = records.length;
  const inScope = total - classificationCounts.out_of_scope;
  const migrated = classificationCounts.migrated;
  const partial = classificationCounts.partial;
  const classificationPercents = Object.fromEntries(
    CLASSIFICATIONS.map((k) => [k, pct(classificationCounts[k], total)]),
  );
  return {
    candidateCount: total,
    sourceKindCounts,
    classificationCounts,
    classificationPercents,
    coverageRateMigratedOnly: {
      all: pct(migrated, total),
      inScope: pct(migrated, inScope),
    },
    coverageRateMigratedPlusPartial: {
      all: pct(migrated + partial, total),
      inScope: pct(migrated + partial, inScope),
    },
    inScopeCount: inScope,
  };
}

function containsImplEvidenceWording(text) {
  return /seed|mount|publish|E2E/i.test(String(text || ''));
}

/** Reject ddragon / data dragon / standalone DD numeric tokens; do not match ordinary "dd" words. */
function citesForbiddenProvenance(text) {
  const s = String(text || '');
  if (/ddragon/i.test(s)) return true;
  if (/data\s+dragon/i.test(s)) return true;
  // e.g. "DD 16.9.1" — boundary before DD so "added"/"middle" do not match
  if (/(^|[^a-z0-9])dd\s+\d+(?:\.\d+)+/i.test(s)) return true;
  if (/数据参考\/champion(\/|\.json)/i.test(s)) return true;
  if (/数据参考\/item\.json/i.test(s)) return true;
  if (/\bOCR\b/i.test(s)) return true;
  if (/training-ground/i.test(s)) return true;
  // Provenance claim of screenshot capture (not wiki media filenames like *_screenshot.png)
  if (/\b(from|via|using)\s+screenshot/i.test(s) || /\bscreenshot\s+(ocr|capture|source)/i.test(s)) {
    return true;
  }
  return false;
}

function validateAudit(audit) {
  const errors = [];
  const records = audit.candidates || [];
  if (records.length !== 242) errors.push(`candidateCount=${records.length}, expected 242`);
  const hero = records.filter((r) => r.sourceKind === 'hero_skill').length;
  const item = records.filter((r) => r.sourceKind === 'item_passive').length;
  if (hero !== 165 || item !== 77) {
    errors.push(`sourceKind counts=${hero}/${item}, expected 165/77`);
  }
  const keys = new Set();
  for (const r of records) {
    if (!r.candidateKey) errors.push('empty candidateKey');
    if (keys.has(r.candidateKey)) errors.push(`duplicate candidateKey ${r.candidateKey}`);
    keys.add(r.candidateKey);
    if (!CLASSIFICATIONS.includes(r.genericClassification)) {
      errors.push(`invalid classification ${r.genericClassification} @ ${r.candidateKey}`);
    }
    if (r.genericClassification === 'migrated' || r.genericClassification === 'partial') {
      const ev = r.coverageEvidence || [];
      const hasTask = ev.some((e) => e.taskKey);
      const hasPath = ev.some((e) => e.sourcePath);
      const hasWorktree = ev.some((e) => e.sourceWorktree);
      if (!hasTask || !hasPath || !hasWorktree) {
        errors.push(`evidence gate failed @ ${r.candidateKey}`);
      }
    }
    if (
      (r.genericClassification === 'blocked' || r.genericClassification === 'partial')
      && !String(r.remainingGap || '').trim()
    ) {
      errors.push(`gap gate failed @ ${r.candidateKey}`);
    }
  }
  const counts = audit.summary?.classificationCounts || {};
  const sum = CLASSIFICATIONS.reduce((acc, k) => acc + (counts[k] || 0), 0);
  if (sum !== 242) errors.push(`classification sum=${sum}, expected 242`);
  if (counts.migrated !== 90) errors.push(`migrated=${counts.migrated}, expected 90`);
  if (counts.partial !== 4) errors.push(`partial=${counts.partial}, expected 4`);
  if (counts.blocked !== 79) errors.push(`blocked=${counts.blocked}, expected 79`);
  if (counts.out_of_scope !== 69) errors.push(`out_of_scope=${counts.out_of_scope}, expected 69`);

  const serialized = JSON.stringify(audit).toLowerCase();
  if (serialized.includes('ddragon')) {
    errors.push('generated audit must not contain ddragon substring');
  }
  if (/数据参考\/champion(\/|\.json)/i.test(serialized) || serialized.includes('champion-seed-candidate')) {
    errors.push('generated audit must not cite deleted champion-static provenance paths');
  }

  // Active generated provenance: sourceRef + reason must not cite DDragon / Data Dragon / DD x.y.z
  // candidateKey is exempt (opaque collision keys may embed historical paths).
  for (const r of records) {
    if (citesForbiddenProvenance(r.classificationReason)) {
      errors.push(`classificationReason cites forbidden provenance @ ${r.candidateKey}`);
    }
    if (r.sourceRef && citesForbiddenProvenance(r.sourceRef)) {
      errors.push(`sourceRef cites forbidden provenance @ ${r.candidateKey}`);
    }
    if (r.sourceText && citesForbiddenProvenance(r.sourceText)) {
      errors.push(`sourceText cites forbidden provenance @ ${r.candidateKey}`);
    }
    for (const evKey of ['dataGapEvidence', 'outOfScopeEvidence', 'runtimeGapEvidence']) {
      const ref = r[evKey]?.sourceRef;
      if (ref && citesForbiddenProvenance(ref)) {
        errors.push(`${evKey}.sourceRef cites forbidden provenance @ ${r.candidateKey}`);
      }
    }
  }

  for (const r of records.filter((r) => r.sourceKind === 'hero_skill')) {
    const ev = r.dataGapEvidence;
    if (!ev?.sourceRef || !String(ev.sourceRef).trim()) continue;
    if (citesForbiddenProvenance(ev.sourceRef)) {
      errors.push(`hero dataGapEvidence.sourceRef cites forbidden provenance @ ${r.candidateKey}`);
    }
    if (
      Array.isArray(ev.missingFields)
      && ev.missingFields.length > 0
      && !String(ev.sourceRef).includes('lol-wiki-current-champions')
      && !String(ev.sourceRef).includes('build-generic-g8')
      && !String(ev.sourceRef).includes('build-unified-mechanism')
    ) {
      errors.push(`blocked_data hero row missing wiki sourceRef @ ${r.candidateKey}`);
    }
    if (
      Array.isArray(ev.missingFields)
      && ev.missingFields.length > 0
      && !String(ev.sourceVersion || '').includes('wiki-rev')
      && !String(ev.sourceRef).includes('build-generic-g8')
      && !String(ev.sourceRef).includes('build-unified-mechanism')
    ) {
      errors.push(`blocked_data hero row missing wiki revision @ ${r.candidateKey}`);
    }
  }

  // Final blocked_data precursors: blocked + non-empty missingFields must stay data-only wording.
  const blockedDataRows = records.filter(
    (r) =>
      r.genericClassification === 'blocked'
      && Array.isArray(r.dataGapEvidence?.missingFields)
      && r.dataGapEvidence.missingFields.length > 0,
  );
  for (const r of blockedDataRows) {
    const ev = r.dataGapEvidence;
    if (!Array.isArray(ev.missingFields) || ev.missingFields.length === 0) {
      errors.push(`blocked_data missingFields empty @ ${r.candidateKey}`);
    }
    const blob = `${r.classificationReason || ''}|${ev.blocker || ''}|${ev.reasonZh || ''}`;
    if (containsImplEvidenceWording(blob)) {
      errors.push(`blocked_data reason/blocker cites seed/mount/publish/E2E @ ${r.candidateKey}`);
    }
  }

  const yunaraR = records.find((r) => r.candidateKey === 'hero_skill|hero_yunara|R|定圣诀');
  if (
    !yunaraR
    || yunaraR.genericClassification !== 'blocked'
    || !yunaraR.dataGapEvidence?.missingFields?.some((f) =>
      String(f).includes('arc_of_ruin'),
    )
    || yunaraR.dataGapEvidence?.missingFields?.some((f) =>
      String(f).includes('transcendent') || String(f).includes('untouchable'),
    )
    || (yunaraR.dataGapEvidence?.missingFields || []).length !== 1
    || !String(yunaraR.dataGapEvidence?.sourceRef || '').includes('yunara-r')
  ) {
    errors.push(
      'Yunara R 定圣诀 must be blocked with Wiki generic dataGapEvidence covering only upgraded Arc of Ruin W damage formula',
    );
  }

  const kayleQ = records.find((r) => r.candidateKey === 'hero_skill|hero_kayle|Q|耀焰冲击');
  if (
    !kayleQ
    || kayleQ.genericClassification !== 'migrated'
    || String(kayleQ.remainingGap || '').trim()
    || !String(kayleQ.classificationReason || '').includes('4005105')
    || !String(kayleQ.classificationReason || '').includes(
      'ded516de4861d88de21ba54de9a8723b654f424f1cc3f9dac30d06382ee1a87c',
    )
    || !String(kayleQ.classificationReason || '').includes('180')
    || !String(kayleQ.classificationReason || '').includes('0.60')
    || !String(kayleQ.classificationReason || '').includes('0.50')
    || !String(kayleQ.classificationReason || '').includes('15%')
    || !String(kayleQ.classificationReason || '').includes('100 mana')
    || !String(kayleQ.classificationReason || '').includes('8000')
    || !String(kayleQ.sourceRef || '').includes('kayle-q.json')
    || citesForbiddenProvenance(kayleQ.classificationReason)
    || !(kayleQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.kayleRadiantBlast,
    )
    || !(kayleQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.kayleRadiantBlastBackend,
    )
  ) {
    errors.push(
      'Kayle Q must be migrated with empty remainingGap, Wiki rev4005105/SHA rank5 damage/shred/mana/CD wording, correct Wiki sourceRef, and bilateral wasm+backend evidence',
    );
  }
  if (kayleQ) {
    validateBilateralCoverageEvidence(
      kayleQ.candidateKey,
      kayleQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const gravesP = records.find((r) => r.candidateKey === 'hero_skill|hero_graves|P|新命运');
  if (
    !gravesP
    || gravesP.genericClassification !== 'migrated'
    || String(gravesP.remainingGap || '').trim()
    || (gravesP.dataGapEvidence?.missingFields || []).length !== 0
    || !String(gravesP.classificationReason || '').includes('4038342')
    || !String(gravesP.classificationReason || '').includes(
      '553bda222e9e85f0eff6d4cba3b8723979a58b68fba9097d2dfa1bd373117aa8',
    )
    || !String(gravesP.classificationReason || '').includes('0.6895')
    || !String(gravesP.classificationReason || '').includes('0.33302')
    || !String(gravesP.classificationReason || '').includes('copyable_on_hit=false')
    || !String(gravesP.classificationReason || '').includes('completedBoundary')
    || !String(gravesP.classificationReason || '').includes('装填')
    || !String(gravesP.sourceRef || '').includes('graves-p')
    || citesForbiddenProvenance(gravesP.classificationReason)
    || !(gravesP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.gravesNewDestiny,
    )
    || !(gravesP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.gravesNewDestinyBackend,
    )
  ) {
    errors.push(
      'Graves P must be migrated with empty remainingGap/missingFields, Wiki rev4038342/SHA Phase-A point-blank wording, reload as completedBoundary exclusion, correct Wiki sourceRef, and bilateral wasm+backend evidence',
    );
  }
  if (gravesP) {
    validateBilateralCoverageEvidence(
      gravesP.candidateKey,
      gravesP.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const gravesE = records.find((r) => r.candidateKey === 'hero_skill|hero_graves|E|快速拔枪');
  if (
    !gravesE
    || gravesE.genericClassification !== 'migrated'
    || String(gravesE.remainingGap || '').trim()
    || (gravesE.dataGapEvidence?.missingFields || []).length !== 0
    || !String(gravesE.classificationReason || '').includes('4007744')
    || !String(gravesE.classificationReason || '').includes(
      'ff4c65c5ce2a0ac1ae757271fbb924b35bf4eca1af0f4d07a69d865db901a4e1',
    )
    || !String(gravesE.classificationReason || '').includes('true_grit_stacks')
    || !String(gravesE.classificationReason || '').includes('152')
    || !String(gravesE.classificationReason || '').includes('76')
    || !String(gravesE.classificationReason || '').includes('40')
    || !String(gravesE.classificationReason || '').includes('12000')
    || !String(gravesE.classificationReason || '').includes('completedBoundary')
    || !String(gravesE.classificationReason || '').includes('intermediate stacks')
    || !String(gravesE.sourceRef || '').includes('graves-e')
    || citesForbiddenProvenance(gravesE.classificationReason)
    || !(gravesE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.gravesQuickdrawMaxStack
        && e.taskKey === 'wasm-generic-graves-quickdraw-max-stack',
    )
    || !(gravesE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.gravesQuickdrawMaxStackBackend
        && e.taskKey === 'wasm-generic-graves-quickdraw-max-stack'
        && String(e.note || '').includes('LolGenericGravesQuickdrawMaxStackSeedSqlTest'),
    )
  ) {
    errors.push(
      'Graves E must be migrated with empty remainingGap/missingFields, Wiki rev4007744/SHA Phase-A max True Grit wording, completedBoundary exclusions, correct Wiki sourceRef, and bilateral wasm+backend evidence',
    );
  }
  if (gravesE) {
    validateBilateralCoverageEvidence(
      gravesE.candidateKey,
      gravesE.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const gravesW = records.find((r) => r.candidateKey === 'hero_skill|hero_graves|W|烟幕弹');
  const gravesWTags = [...(gravesW?.genericMechanismTags || [])];
  const gravesWExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const gravesWReason = String(gravesW?.classificationReason || '');
  if (
    !gravesW
    || gravesW.genericClassification !== 'migrated'
    || String(gravesW.remainingGap || '').trim()
    || (gravesW.dataGapEvidence?.missingFields || []).length !== 0
    || gravesWTags.join('|') !== gravesWExpectedTags.join('|')
    || gravesWTags.includes('meta_or_non_target_dps')
    || String(gravesW.remainingGap || '').includes('blocked_data')
    || gravesWReason.includes('out_of_scope_for_single_target_dps')
    || gravesWReason.includes('blocked_data')
    || gravesWReason.includes('implementation_gap_no_unresolved_data_fields')
    || gravesWReason.includes('meta_or_non_target_dps')
    || !gravesWReason.includes('3956197')
    || !gravesWReason.includes(
      '20348473fe3441eb32ab656423f577a62a415fadf33fbdc6fcf576bc8b1d210d',
    )
    || !gravesWReason.includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction',
    )
    || !gravesWReason.includes('source.attr.ap.resolved')
    || !gravesWReason.includes('260')
    || !gravesWReason.includes('0.60')
    || !gravesWReason.includes('90 mana')
    || !gravesWReason.includes('18000')
    || !gravesWReason.includes('raw380')
    || !gravesWReason.includes('190')
    || !gravesWReason.includes('145')
    || !gravesWReason.includes('620')
    || !gravesWReason.includes('cast0.25')
    || !gravesWReason.includes('Effect at cast time end')
    || !gravesWReason.includes('smoke cloud')
    || !gravesWReason.includes('nearsight')
    || !gravesWReason.includes('True Grit')
    || !gravesWReason.includes('不宣称')
    || !String(gravesW.sourceRef || '').includes('graves-w.json')
    || citesForbiddenProvenance(gravesW.classificationReason)
    || !(gravesW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.gravesSmokeScreenPrimaryHit
        && e.taskKey === 'wasm-generic-graves-smoke-screen-primary-hit'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction',
        )
        && String(e.note || '').includes('cast0.25')
        && String(e.note || '').includes('nearsight'),
    )
    || !(gravesW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.gravesSmokeScreenPrimaryHitBackend
        && e.taskKey === 'wasm-generic-graves-smoke-screen-primary-hit'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction',
        )
        && String(e.note || '').includes('LolGenericGravesSmokeScreenPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('1238c53')
        && String(e.note || '').includes('037bae3')
        && String(e.note || '').includes('78ab90c'),
    )
  ) {
    errors.push(
      'Graves W must be migrated with empty remainingGap/missingFields, exact Smoke Screen tags (no meta_or_non_target_dps), stale blocked_data/out_of_scope/implementation-gap cleared, Wiki rev3956197/SHA + frozen completedBoundary, numeric contract/90mana/18000CD/AP200→380/MR100→190/mana145/HP620, cast0.25/smoke/nearsight/True Grit exclusions, and bilateral wasm+backend evidence (owning 1238c53 / integrated 037bae3 / Wasm 78ab90c; no cast/projectile/AOE/slow/smoke/nearsight fidelity claim)',
    );
  }
  if (gravesW) {
    validateBilateralCoverageEvidence(
      gravesW.candidateKey,
      gravesW.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const gravesR = records.find((r) => r.candidateKey === 'hero_skill|hero_graves|R|终极爆弹');
  const gravesRTags = [...(gravesR?.genericMechanismTags || [])];
  const gravesRExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'bonus_ad_ratio',
    'immediate_impact_scaffold',
  ];
  const gravesRReason = String(gravesR?.classificationReason || '');
  if (
    !gravesR
    || gravesR.genericClassification !== 'migrated'
    || String(gravesR.remainingGap || '').trim()
    || (gravesR.dataGapEvidence?.missingFields || []).length !== 0
    || gravesRTags.join('|') !== gravesRExpectedTags.join('|')
    || gravesRTags.includes('dps_relevant_manual_review')
    || String(gravesR.remainingGap || '').includes('blocked_data')
    || gravesRReason.includes('out_of_scope_for_single_target_dps')
    || gravesRReason.includes('blocked_data')
    || gravesRReason.includes('implementation_gap_no_unresolved_data_fields')
    || gravesRReason.includes('needs_manual_baseline')
    || gravesRReason.includes('dps_relevant_manual_review')
    || !gravesRReason.includes('4007499')
    || !gravesRReason.includes(
      '834843a7722fc9463e21e8d636b8adc644c220928b90f7bb4afedbaa08f85dd1',
    )
    || !gravesRReason.includes(
      'rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage',
    )
    || !gravesRReason.includes('source.attr.ad.resolved')
    || !gravesRReason.includes('source.attr.ad.base')
    || !gravesRReason.includes('575')
    || !gravesRReason.includes('1.50')
    || !gravesRReason.includes('100 mana')
    || !gravesRReason.includes('60000')
    || !gravesRReason.includes('baseAD66')
    || !gravesRReason.includes('resolvedAD120')
    || !gravesRReason.includes('bonusAD54')
    || !gravesRReason.includes('raw656')
    || !gravesRReason.includes('328')
    || !gravesRReason.includes('125')
    || !gravesRReason.includes('344')
    || !gravesRReason.includes('440')
    || !gravesRReason.includes('1.20')
    || !gravesRReason.includes('excluded not denied')
    || !gravesRReason.includes('recoil')
    || !gravesRReason.includes('explosion cone')
    || !gravesRReason.includes('不宣称')
    || !String(gravesR.sourceRef || '').includes('graves-r.json')
    || citesForbiddenProvenance(gravesR.classificationReason)
    || !(gravesR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.gravesCollateralDamagePrimaryHit
        && e.taskKey === 'wasm-generic-graves-collateral-damage-primary-hit'
        && String(e.note || '').includes(
          'rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage',
        )
        && String(e.note || '').includes('recoil')
        && String(e.note || '').includes('excluded not denied'),
    )
    || !(gravesR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.gravesCollateralDamagePrimaryHitBackend
        && e.taskKey === 'wasm-generic-graves-collateral-damage-primary-hit'
        && String(e.note || '').includes(
          'rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage',
        )
        && String(e.note || '').includes('LolGenericGravesCollateralDamagePrimaryHitSeedSqlTest')
        && String(e.note || '').includes('9c1087b')
        && String(e.note || '').includes('c2a8a97')
        && String(e.note || '').includes('4abadf1'),
    )
  ) {
    errors.push(
      'Graves R must be migrated with empty remainingGap/missingFields, exact Collateral Damage tags (no dps_relevant_manual_review), stale blocked_data/needs_manual_baseline/implementation-gap cleared, Wiki rev4007499/SHA + frozen completedBoundary, numeric contract/100mana/60000CD/baseAD66→120/bonus54→raw656/armor100→328/mana125/HP344, explosion-cone reduced 440+1.20 excluded-not-denied, recoil/cast/projectile exclusions, and bilateral wasm+backend evidence (owning 9c1087b / integrated c2a8a97 / Wasm 4abadf1; no cast/recoil/projectile/line/multitarget/explosion-cone fidelity claim)',
    );
  }
  if (gravesR) {
    validateBilateralCoverageEvidence(
      gravesR.candidateKey,
      gravesR.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const gravesQ = records.find((r) => r.candidateKey === 'hero_skill|hero_graves|Q|穷途末路');
  const gravesQTags = [...(gravesQ?.genericMechanismTags || [])];
  const gravesQExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'bonus_ad_ratio',
    'immediate_impact_scaffold',
  ];
  const gravesQReason = String(gravesQ?.classificationReason || '');
  const gravesQBoundary =
    'rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_graves|Q')) {
    errors.push('Graves Q exact override key hero_graves|Q must exist before fallback');
  }
  if (
    !gravesQ
    || gravesQ.candidateKey !== 'hero_skill|hero_graves|Q|穷途末路'
    || gravesQ.passiveName !== '穷途末路'
    || gravesQ.genericClassification !== 'migrated'
    || String(gravesQ.remainingGap || '').trim()
    || (gravesQ.dataGapEvidence?.missingFields || []).length !== 0
    || gravesQTags.join('|') !== gravesQExpectedTags.join('|')
    || gravesQTags.includes('multi_target_or_area')
    || gravesQTags.includes('meta_or_non_target_dps')
    || gravesQTags.includes('dps_relevant_manual_review')
    || gravesQTags.includes('primary_damage_branch_salvage')
    || gravesQTags.includes('total_ad_ratio')
    || !gravesQTags.includes('bonus_ad_ratio')
    || !gravesQTags.includes('active_physical_damage')
    || String(gravesQ.remainingGap || '').includes('blocked_data')
    || gravesQReason.includes('needs_manual_baseline')
    || gravesQReason.includes('blocked_data')
    || gravesQReason.includes('implementation_gap_no_unresolved_data_fields')
    || gravesQReason.includes('multi_target_or_area')
    || gravesQReason.includes('out_of_scope_for_single_target_dps')
    || gravesQReason.includes('dps_relevant_manual_review')
    || gravesQReason.includes('primary_damage_branch_salvage')
    || gravesQReason.includes('depends on Graves E')
    || gravesQReason.includes('depends on True Grit')
    || gravesQReason.includes('total AD；')
    || gravesQReason.includes('total_ad_ratio')
    || gravesQReason.includes('*totalAD')
    || !gravesQReason.includes('4007501')
    || !gravesQReason.includes(
      'c18840004febd305484392c882680939efe9fc609d4f733f81824439741345c5',
    )
    || !gravesQReason.includes(
      'cd2744fb1f28e54bd3b5e25b96cb1d21babc0583bfd8e854d55c15ed83df0377',
    )
    || !gravesQReason.includes('Template:Data Graves/Q')
    || !gravesQReason.includes('Template:Data Graves/End of the Line')
    || !gravesQReason.includes('page1307367')
    || !gravesQReason.includes('bytes2266')
    || !gravesQReason.includes('bytes2265')
    || !gravesQReason.includes('2026-04-11T22:23:57Z')
    || !gravesQReason.includes(gravesQBoundary)
    || !gravesQReason.includes('source.attr.ad.resolved')
    || !gravesQReason.includes('source.attr.ad.base')
    || !gravesQReason.includes('exact binary formula')
    || !gravesQReason.includes('bonus AD by explicit subtraction')
    || !gravesQReason.includes('不得按 total-AD 直读')
    || !gravesQReason.includes('150')
    || !gravesQReason.includes('0.65')
    || !gravesQReason.includes('80 mana')
    || !gravesQReason.includes('6000')
    || !gravesQReason.includes('20220')
    || !gravesQReason.includes('20170')
    || !gravesQReason.includes('no 20230')
    || !gravesQReason.includes('no explicit event op')
    || !gravesQReason.includes('no Q ability-specific type')
    || !gravesQReason.includes('base0/resolved0/armor0 raw=final150')
    || !gravesQReason.includes('base60/resolved60/armor0 raw=final150')
    || !gravesQReason.includes('base60/resolved160/armor0 raw=final215')
    || !gravesQReason.includes('base60/resolved160/armor100 raw215/final107.5')
    || !gravesQReason.includes('base60/resolved260/armor100 raw280/final140')
    || !gravesQReason.includes('base0/resolved100 versus base60/resolved160')
    || !gravesQReason.includes('t5999')
    || !gravesQReason.includes('t6000')
    || !gravesQReason.includes('mana240')
    || !gravesQReason.includes('mana79')
    || !gravesQReason.includes('HP785')
    || !gravesQReason.includes('ability_started')
    || !gravesQReason.includes('Q does not alter E True Grit')
    || !gravesQReason.includes('E produces no Q damage')
    || !gravesQReason.includes('standalone')
    || !gravesQReason.includes('external existing-data/check-only')
    || !gravesQReason.includes('identity/panel/resource')
    || !gravesQReason.includes('不暗示 Graves P/E/W/R/True Grit/basic dependence')
    || !gravesQReason.includes('不暗示 Batch-B')
    || !gravesQReason.includes('sibling Graves synthesis')
    || !gravesQReason.includes('production runtime/ABI/Web change')
    || !gravesQReason.includes('focused50/full943')
    || !gravesQReason.includes('focused7')
    || !gravesQReason.includes('66870')
    || !gravesQReason.includes(
      'a95e0d9632b0fe45aaec9440ccd89c381d6903f2c99ab761581736ec1f8c8e77',
    )
    || !gravesQReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0')
    || !gravesQReason.includes('不宣称')
    || !gravesQReason.includes('no equivalence or contradiction claim')
    || !gravesQReason.includes('exactly one selected-primary first-outbound-pass physical hit')
    || gravesQReason.includes('canonical byte equivalence')
    || gravesQReason.includes('Batch-B prerequisite')
    || gravesQReason.includes('live published')
    || !String(gravesQ.sourceRef || '').includes('graves-q.json')
    || !String(gravesQ.sourceRef || '').includes(
      'c18840004febd305484392c882680939efe9fc609d4f733f81824439741345c5',
    )
    || gravesQ.auditBaseline?.gapCode !== 'blocked_data'
    || gravesQ.auditBaseline?.resolvedBucket !== 'blocked'
    || gravesQ.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(gravesQ.auditBaseline?.mechanismTags || []).includes('multi_target_or_area')
    || gravesQ.classification !== 'out_of_scope_for_single_target_dps'
    || !(gravesQ.mechanismTags || []).includes('multi_target_or_area')
    || citesForbiddenProvenance(gravesQ.classificationReason)
    || !(gravesQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.gravesEndOfTheLineFirstOutboundPass
        && e.taskKey === 'wasm-generic-graves-end-of-the-line-first-outbound-pass'
        && String(e.note || '').includes(gravesQBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('c16107e')
        && String(e.note || '').includes('cd2744fb')
        && String(e.note || '').includes('20220')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no 20230')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('no Q type')
        && String(e.note || '').includes('exact binary')
        && String(e.note || '').includes('Q does not alter E True Grit')
        && String(e.note || '').includes('E produces no Q damage')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(gravesQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.gravesEndOfTheLineFirstOutboundPassBackend
        && e.taskKey === 'wasm-generic-graves-end-of-the-line-first-outbound-pass'
        && String(e.note || '').includes(gravesQBoundary)
        && String(e.note || '').includes('LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest')
        && String(e.note || '').includes('9294292')
        && String(e.note || '').includes('a54cf6f')
        && String(e.note || '').includes('c16107e')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Graves synthesis'),
    )
  ) {
    errors.push(
      'Graves Q must be migrated with empty remainingGap/missingFields, exact End of the Line ordered tags (no multi_target_or_area/primary_damage_branch_salvage; requires bonus_ad_ratio/active_physical_damage), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/multi_target_or_area/auditBaseline provenance, Wiki rev4007501/SHA + local raw caveat + frozen completedBoundary, rank5 80mana/6000CD/one physical 150+0.65*bonusAD exact binary numerics (150/150/215/215→107.5/280→140; bonusAD counterproof; 20220/20170; no 20230; no Q type; no explicit event op; t0/t5999/t6000 mana240→80/HP785 two damage/two ability_started; mana79 skip; Q does not alter E True Grit and E produces no Q damage), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-True-Grit-dependence/no-production-runtime-ABI-Web framing, focused50/full943 + focused7 + Wasm asset SHA, and bilateral wasm+backend evidence (owning 9294292 / integrated a54cf6f / Wasm c16107e; one selected-primary first-outbound-pass physical hit not full Q; no cast/direction/projectile/trail/detonation/reverse-wave/live claim)',
    );
  }
  if (gravesQ) {
    validateBilateralCoverageEvidence(
      gravesQ.candidateKey,
      gravesQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const sennaW = records.find((r) => r.candidateKey === 'hero_skill|hero_senna|W|无尽厮守');
  const sennaWTags = [...(sennaW?.genericMechanismTags || [])];
  const sennaWExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'bonus_ad_ratio',
    'immediate_impact_scaffold',
  ];
  const sennaWReason = String(sennaW?.classificationReason || '');
  const sennaWBoundary =
    'rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_senna|W')) {
    errors.push('Senna W exact override key hero_senna|W must exist before fallback');
  }
  if (
    !sennaW
    || sennaW.candidateKey !== 'hero_skill|hero_senna|W|无尽厮守'
    || sennaW.passiveName !== '无尽厮守'
    || sennaW.genericClassification !== 'migrated'
    || String(sennaW.remainingGap || '').trim()
    || (sennaW.dataGapEvidence?.missingFields || []).length !== 0
    || sennaWTags.join('|') !== sennaWExpectedTags.join('|')
    || sennaWTags.includes('multi_target_or_area')
    || sennaWTags.includes('meta_or_non_target_dps')
    || sennaWTags.includes('dps_relevant_manual_review')
    || sennaWTags.includes('primary_damage_branch_salvage')
    || sennaWTags.includes('total_ad_ratio')
    || !sennaWTags.includes('bonus_ad_ratio')
    || !sennaWTags.includes('active_physical_damage')
    || String(sennaW.remainingGap || '').includes('blocked_data')
    || sennaWReason.includes('needs_manual_baseline')
    || sennaWReason.includes('blocked_data')
    || sennaWReason.includes('implementation_gap_no_unresolved_data_fields')
    || sennaWReason.includes('multi_target_or_area')
    || sennaWReason.includes('out_of_scope_for_single_target_dps')
    || sennaWReason.includes('dps_relevant_manual_review')
    || sennaWReason.includes('primary_damage_branch_salvage')
    || sennaWReason.includes('depends on Senna')
    || sennaWReason.includes('total AD；')
    || sennaWReason.includes('total_ad_ratio')
    || sennaWReason.includes('*totalAD')
    || !sennaWReason.includes('4009139')
    || !sennaWReason.includes(
      '48698aa2864b79564b1ea0ed624de8fc7123c3127c1e56deaa002d1aad3c8492',
    )
    || !sennaWReason.includes(
      '737cc69b6ea13da8d61437e3da37a799cc2779bd56516d166af5890dc6090d5e',
    )
    || !sennaWReason.includes('Template:Data Senna/W')
    || !sennaWReason.includes('Template:Data Senna/Last Embrace')
    || !sennaWReason.includes('page1409576')
    || !sennaWReason.includes('bytes1656')
    || !sennaWReason.includes('bytes1651')
    || !sennaWReason.includes('2026-04-15T21:34:10Z')
    || !sennaWReason.includes(sennaWBoundary)
    || !sennaWReason.includes('source.attr.ad.resolved')
    || !sennaWReason.includes('source.attr.ad.base')
    || !sennaWReason.includes('exact binary formula')
    || !sennaWReason.includes('bonus AD by explicit subtraction')
    || !sennaWReason.includes('不得按 total-AD 直读')
    || !sennaWReason.includes('230')
    || !sennaWReason.includes('0.90')
    || !sennaWReason.includes('70 mana')
    || !sennaWReason.includes('11000')
    || !sennaWReason.includes('20220')
    || !sennaWReason.includes('20170')
    || !sennaWReason.includes('no 20230')
    || !sennaWReason.includes('no explicit event op')
    || !sennaWReason.includes('no W ability-specific type')
    || !sennaWReason.includes('base0/resolved0/armor0 raw=final230')
    || !sennaWReason.includes('base60/resolved60/armor0 raw=final230')
    || !sennaWReason.includes('base60/resolved160/armor0 raw=final320')
    || !sennaWReason.includes('base60/resolved160/armor100 raw320/final160')
    || !sennaWReason.includes('base60/resolved260/armor100 raw410/final205')
    || !sennaWReason.includes('base0/resolved100 versus base60/resolved160')
    || !sennaWReason.includes('t10999')
    || !sennaWReason.includes('t11000')
    || !sennaWReason.includes('mana210')
    || !sennaWReason.includes('mana69')
    || !sennaWReason.includes('HP680')
    || !sennaWReason.includes('ability_started')
    || !sennaWReason.includes('standalone')
    || !sennaWReason.includes('external existing-data/check-only')
    || !sennaWReason.includes('identity/panel/resource')
    || !sennaWReason.includes('不暗示 Senna P/Q/E/R/basic dependence')
    || !sennaWReason.includes('不暗示 Batch-B')
    || !sennaWReason.includes('sibling Senna synthesis')
    || !sennaWReason.includes('production runtime/ABI/Web change')
    || !sennaWReason.includes('focused68/full954')
    || !sennaWReason.includes('62703')
    || !sennaWReason.includes(
      '4a449fc09248fe7842b909a373edd5353d4fb1eed8831b655f9146bcd5696051',
    )
    || !sennaWReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0')
    || !sennaWReason.includes('不宣称')
    || !sennaWReason.includes('no equivalence or contradiction claim')
    || !sennaWReason.includes('exactly one selected-primary first-enemy physical hit')
    || sennaWReason.includes('canonical byte equivalence')
    || sennaWReason.includes('Batch-B prerequisite')
    || sennaWReason.includes('live published')
    || !String(sennaW.sourceRef || '').includes('senna-w.json')
    || !String(sennaW.sourceRef || '').includes(
      '48698aa2864b79564b1ea0ed624de8fc7123c3127c1e56deaa002d1aad3c8492',
    )
    || sennaW.auditBaseline?.gapCode !== 'blocked_data'
    || sennaW.auditBaseline?.resolvedBucket !== 'blocked'
    || sennaW.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(sennaW.auditBaseline?.mechanismTags || []).includes('multi_target_or_area')
    || sennaW.classification !== 'out_of_scope_for_single_target_dps'
    || !(sennaW.mechanismTags || []).includes('multi_target_or_area')
    || citesForbiddenProvenance(sennaW.classificationReason)
    || !(sennaW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.sennaLastEmbraceFirstEnemyHit
        && e.taskKey === 'wasm-generic-senna-last-embrace-first-enemy-hit'
        && String(e.note || '').includes(sennaWBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('ebf7730')
        && String(e.note || '').includes('737cc69b')
        && String(e.note || '').includes('20220')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no 20230')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('no W type')
        && String(e.note || '').includes('exact binary')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(sennaW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.sennaLastEmbraceFirstEnemyHitBackend
        && e.taskKey === 'wasm-generic-senna-last-embrace-first-enemy-hit'
        && String(e.note || '').includes(sennaWBoundary)
        && String(e.note || '').includes('LolGenericSennaLastEmbraceFirstEnemyHitSeedSqlTest')
        && String(e.note || '').includes('c0c3090')
        && String(e.note || '').includes('b90607b')
        && String(e.note || '').includes('ebf7730')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Senna synthesis'),
    )
  ) {
    errors.push(
      'Senna W must be migrated with empty remainingGap/missingFields, exact Last Embrace ordered tags (no multi_target_or_area/primary_damage_branch_salvage; requires bonus_ad_ratio/active_physical_damage), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/multi_target_or_area/auditBaseline provenance, Wiki rev4009139/SHA + local raw caveat + frozen completedBoundary, rank5 70mana/11000CD/one physical 230+0.90*bonusAD exact binary numerics (230/230/320/320→160/410→205; bonusAD counterproof; 20220/20170; no 20230; no W type; no explicit event op; t0/t10999/t11000 mana210→70/HP680 two damage/two ability_started; mana69 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-production-runtime-ABI-Web framing, focused68/full954 + Wasm asset SHA, and bilateral wasm+backend evidence (owning c0c3090 / integrated b90607b / Wasm ebf7730; one selected-primary first-enemy physical hit not full W; no cast/effect-at-cast-time-end/direction/projectile/attachment/root/AOE/live claim)',
    );
  }
  if (sennaW) {
    validateBilateralCoverageEvidence(
      sennaW.candidateKey,
      sennaW.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const sennaR = records.find((r) => r.candidateKey === 'hero_skill|hero_senna|R|暗影燎原');
  const sennaRTags = [...(sennaR?.genericMechanismTags || [])];
  const sennaRExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'bonus_ad_ratio',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const sennaRReason = String(sennaR?.classificationReason || '');
  const sennaRBoundary =
    'rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_senna|R')) {
    errors.push('Senna R exact override key hero_senna|R must exist before fallback');
  }
  if (
    !sennaR
    || sennaR.candidateKey !== 'hero_skill|hero_senna|R|暗影燎原'
    || sennaR.passiveName !== '暗影燎原'
    || sennaR.genericClassification !== 'migrated'
    || String(sennaR.remainingGap || '').trim()
    || (sennaR.dataGapEvidence?.missingFields || []).length !== 0
    || sennaRTags.join('|') !== sennaRExpectedTags.join('|')
    || sennaRTags.includes('multi_target_or_area')
    || sennaRTags.includes('meta_or_non_target_dps')
    || sennaRTags.includes('dps_relevant_manual_review')
    || sennaRTags.includes('primary_damage_branch_salvage')
    || sennaRTags.includes('total_ad_ratio')
    || !sennaRTags.includes('bonus_ad_ratio')
    || !sennaRTags.includes('ap_ratio')
    || !sennaRTags.includes('active_physical_damage')
    || String(sennaR.remainingGap || '').includes('blocked_data')
    || sennaRReason.includes('needs_manual_baseline')
    || sennaRReason.includes('blocked_data')
    || sennaRReason.includes('implementation_gap_no_unresolved_data_fields')
    || sennaRReason.includes('multi_target_or_area')
    || sennaRReason.includes('meta_or_non_target_dps')
    || sennaRReason.includes('out_of_scope_for_single_target_dps')
    || sennaRReason.includes('dps_relevant_manual_review')
    || sennaRReason.includes('primary_damage_branch_salvage')
    || sennaRReason.includes('total AD；')
    || sennaRReason.includes('total_ad_ratio')
    || sennaRReason.includes('*totalAD')
    || !sennaRReason.includes('4008033')
    || !sennaRReason.includes(
      '4de188cce3d04f172d37f07db4e7c8e240388c5346f56838c82a3e6205c9de36',
    )
    || !sennaRReason.includes(
      '1b448ff48b9fe906a13056f2f510e38ff96fcad410462972a93dbd3bb93195dc',
    )
    || !sennaRReason.includes('Template:Data Senna/R')
    || !sennaRReason.includes('Template:Data Senna/Dawning Shadow')
    || !sennaRReason.includes('page1409580')
    || !sennaRReason.includes('bytes2356')
    || !sennaRReason.includes('bytes2353')
    || !sennaRReason.includes('2026-04-13T04:08:13Z')
    || !sennaRReason.includes(sennaRBoundary)
    || !sennaRReason.includes('source.attr.ad.resolved')
    || !sennaRReason.includes('source.attr.ad.base')
    || !sennaRReason.includes('exact nested binary formula')
    || !sennaRReason.includes('bonus AD by explicit subtraction')
    || !sennaRReason.includes('不得按 total-AD 直读')
    || !sennaRReason.includes('add(add(const 550')
    || !sennaRReason.includes('1.15')
    || !sennaRReason.includes('0.70')
    || !sennaRReason.includes('100 mana')
    || !sennaRReason.includes('100000')
    || !sennaRReason.includes('20220')
    || !sennaRReason.includes('20170')
    || !sennaRReason.includes('no 20230')
    || !sennaRReason.includes('no explicit event op')
    || !sennaRReason.includes('no R ability-specific type')
    || !sennaRReason.includes('raw=final550')
    || !sennaRReason.includes('raw=final665')
    || !sennaRReason.includes('raw=final620')
    || !sennaRReason.includes('raw=final735')
    || !sennaRReason.includes('raw712/final356')
    || !sennaRReason.includes('raw804/final402')
    || !sennaRReason.includes('both665')
    || !sennaRReason.includes('t99999')
    || !sennaRReason.includes('t100000')
    || !sennaRReason.includes('mana300')
    || !sennaRReason.includes('mana99')
    || !sennaRReason.includes('HP288')
    || !sennaRReason.includes('ability_started')
    || !sennaRReason.includes('standalone')
    || !sennaRReason.includes('preserve existing W')
    || !sennaRReason.includes('check-only standalone W isolation')
    || !sennaRReason.includes('external existing-data/check-only')
    || !sennaRReason.includes('identity/panel/resource')
    || !sennaRReason.includes('不暗示 Senna P/Q/W/E/basic dependence')
    || !sennaRReason.includes('不暗示 Batch-B')
    || !sennaRReason.includes('sibling Senna synthesis')
    || !sennaRReason.includes('production runtime/ABI/Web change')
    || !sennaRReason.includes('focused71/full987')
    || !sennaRReason.includes('73643')
    || !sennaRReason.includes(
      'a42359e98452dfd3d1429fc12f8735daefd77b0da2269ba7b345200b9ff39fa9',
    )
    || !sennaRReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0')
    || !sennaRReason.includes('不宣称')
    || !sennaRReason.includes('no equivalence or contradiction claim')
    || !sennaRReason.includes('exactly one selected-primary-enemy-champion single physical hit')
    || sennaRReason.includes('canonical byte equivalence')
    || sennaRReason.includes('Batch-B prerequisite')
    || sennaRReason.includes('live published')
    || !String(sennaR.sourceRef || '').includes('senna-r.json')
    || !String(sennaR.sourceRef || '').includes(
      '4de188cce3d04f172d37f07db4e7c8e240388c5346f56838c82a3e6205c9de36',
    )
    || sennaR.auditBaseline?.gapCode !== 'blocked_data'
    || sennaR.auditBaseline?.resolvedBucket !== 'blocked'
    || sennaR.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(sennaR.auditBaseline?.mechanismTags || []).includes('meta_or_non_target_dps')
    || sennaR.classification !== 'out_of_scope_for_single_target_dps'
    || !(sennaR.mechanismTags || []).includes('meta_or_non_target_dps')
    || citesForbiddenProvenance(sennaR.classificationReason)
    || !(sennaR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.sennaDawningShadowPrimaryHit
        && e.taskKey === 'wasm-generic-senna-dawning-shadow-primary-hit'
        && String(e.note || '').includes(sennaRBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('a8e4c08')
        && String(e.note || '').includes('a42359e9')
        && String(e.note || '').includes('73643')
        && String(e.note || '').includes('1b448ff4')
        && String(e.note || '').includes('20220')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no 20230')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('no R type')
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('preserve existing W')
        && String(e.note || '').includes('check-only W isolation')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(sennaR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.sennaDawningShadowPrimaryHitBackend
        && e.taskKey === 'wasm-generic-senna-dawning-shadow-primary-hit'
        && String(e.note || '').includes(sennaRBoundary)
        && String(e.note || '').includes('LolGenericSennaDawningShadowPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('b774a8d')
        && String(e.note || '').includes('4316923')
        && String(e.note || '').includes('a8e4c08')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('preserve existing W')
        && String(e.note || '').includes('check-only W isolation')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Senna synthesis'),
    )
  ) {
    errors.push(
      'Senna R must be migrated with empty remainingGap/missingFields, exact Dawning Shadow ordered tags (no meta_or_non_target_dps/primary_damage_branch_salvage; requires bonus_ad_ratio/ap_ratio/active_physical_damage), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/meta_or_non_target_dps/auditBaseline provenance, Wiki rev4008033/SHA + local raw caveat + frozen completedBoundary, rank3 100mana/100000CD/one physical 550+1.15*bonusAD+0.70*AP via nested binary numerics (550/665/620/735; raw712→356; raw804→402; counterproof both665; 20220/20170; no 20230; no R type; no explicit event op; t0/t99999/t100000 mana300→100/HP288 two damage/two ability_started; mana99 skip), standalone/preserve-W/check-only-W-isolation/external-existing-data/check-only/no-Batch-B/no-sibling/no-production-runtime-ABI-Web framing, focused71/full987 + Wasm asset SHA, and bilateral wasm+backend evidence (owning b774a8d / integrated 4316923 / Wasm a8e4c08; one selected-primary-enemy-champion physical hit not full R; no cast/Effect-at-cast-time-start/queue/wave/projectile/AOE/reveal/shield/Mist/live claim)',
    );
  }
  if (sennaR) {
    validateBilateralCoverageEvidence(
      sennaR.candidateKey,
      sennaR.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const item3302Juxtaposition = records.find(
    (r) => r.candidateKey === 'item_passive|3302|item_passive|交相',
  );
  if (
    !item3302Juxtaposition
    || item3302Juxtaposition.genericClassification !== 'migrated'
    || String(item3302Juxtaposition.remainingGap || '').trim() !== ''
    || citesForbiddenProvenance(item3302Juxtaposition.classificationReason)
    || !String(item3302Juxtaposition.classificationReason || '').includes('4030984')
    || !String(item3302Juxtaposition.classificationReason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    )
    || !String(item3302Juxtaposition.classificationReason || '').includes('首击 Light')
    || !String(item3302Juxtaposition.classificationReason || '').includes('refresh_on_write')
    || !String(item3302Juxtaposition.classificationReason || '').includes('6@1')
    || !String(item3302Juxtaposition.classificationReason || '').includes('10%')
    || !(item3302Juxtaposition.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.terminusJuxtaposition,
    )
    || !(item3302Juxtaposition.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.terminusJuxtapositionBackend,
    )
  ) {
    errors.push(
      '3302 交相 must be migrated with empty remainingGap, Wiki revid/hash + first-Light/aggregate-refresh/pp/10% wording, and wasm+planned-backend evidence paths',
    );
  }

  const item6699Firmament = records.find(
    (r) => r.candidateKey === 'item_passive|6699|item_passive|苍穹',
  );
  if (
    !item6699Firmament
    || item6699Firmament.genericClassification !== 'migrated'
    || String(item6699Firmament.remainingGap || '').trim() !== ''
    || citesForbiddenProvenance(item6699Firmament.classificationReason)
    || !String(item6699Firmament.classificationReason || '').includes('4030984')
    || !String(item6699Firmament.classificationReason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    )
    || !String(item6699Firmament.classificationReason || '').includes('ranged')
    || !String(item6699Firmament.classificationReason || '').includes('precharged')
    || !String(item6699Firmament.classificationReason || '').includes('event.target')
    || !String(item6699Firmament.classificationReason || '').includes('armor_pen_flat')
    || !String(item6699Firmament.classificationReason || '').includes('4000')
    || !String(item6699Firmament.classificationReason || '').includes('copyable_on_hit=false')
    || !(item6699Firmament.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.firmament6699,
    )
    || !(item6699Firmament.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.firmament6699Backend,
    )
    || !String(
      (item6699Firmament.coverageEvidence || []).find(
        (e) => e.sourceWorktree === 'backend',
      )?.note || '',
    ).includes('LolGenericFirmament6699SeedSqlTest')
  ) {
    errors.push(
      '6699 苍穹 must be migrated with empty remainingGap, Wiki revid/hash + ranged/precharged/event.target/armor_pen_flat/4s/non-copyable wording, and wasm+planned-backend evidence paths',
    );
  }

  const item2520ShapedCharge = records.find(
    (r) => r.candidateKey === 'item_passive|2520|item_passive|成型炸药',
  );
  const item2520Sabotage = records.find(
    (r) => r.candidateKey === 'item_passive|2520|item_passive|破坏',
  );
  if (
    !item2520ShapedCharge
    || item2520ShapedCharge.genericClassification !== 'migrated'
    || String(item2520ShapedCharge.remainingGap || '').trim() !== ''
    || citesForbiddenProvenance(item2520ShapedCharge.classificationReason)
    || !String(item2520ShapedCharge.classificationReason || '').includes('4030984')
    || !String(item2520ShapedCharge.classificationReason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    )
    || !String(item2520ShapedCharge.classificationReason || '').includes('ranged')
    || !String(item2520ShapedCharge.classificationReason || '').includes('shaped_charge_ready')
    || !String(item2520ShapedCharge.classificationReason || '').includes('45000')
    || !String(item2520ShapedCharge.classificationReason || '').includes('armor_pen_flat')
    || !String(item2520ShapedCharge.classificationReason || '').includes('damage_trait/ability')
    || !String(item2520ShapedCharge.classificationReason || '').includes('generic_shaped_charge_2520_test.go')
    || !(item2520ShapedCharge.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.shapedCharge2520,
    )
    || !(item2520ShapedCharge.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.shapedCharge2520Backend,
    )
    || !String(
      (item2520ShapedCharge.coverageEvidence || []).find(
        (e) => e.sourceWorktree === 'backend',
      )?.note || '',
    ).includes('LolGenericShapedCharge2520SeedSqlTest')
  ) {
    errors.push(
      '2520 成型炸药 must be migrated with empty remainingGap, Wiki revid/hash + ranged/ready/matcher/formula/CD/shield wording, and wasm+planned-backend evidence paths',
    );
  }
  if (
    !item2520Sabotage
    || item2520Sabotage.genericClassification !== 'out_of_scope'
  ) {
    errors.push('2520 破坏/Sabotage must remain out_of_scope');
  }

  const item3161FocusedWill = records.find(
    (r) => r.candidateKey === 'item_passive|3161|item_passive|专注意志',
  );
  if (
    !item3161FocusedWill
    || item3161FocusedWill.genericClassification !== 'migrated'
    || String(item3161FocusedWill.remainingGap || '').trim() !== ''
    || citesForbiddenProvenance(item3161FocusedWill.classificationReason)
    || /manual.?baseline|data dragon|ddragon/i.test(
      String(item3161FocusedWill.classificationReason || ''),
    )
    || !String(item3161FocusedWill.classificationReason || '').includes('4030984')
    || !String(item3161FocusedWill.classificationReason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    )
    || !String(item3161FocusedWill.classificationReason || '').includes('perCastThrottleMs')
    || !String(item3161FocusedWill.classificationReason || '').includes('6000')
    || !String(item3161FocusedWill.classificationReason || '').includes('max4')
    || !String(item3161FocusedWill.classificationReason || '').includes('0.03')
    || !String(item3161FocusedWill.classificationReason || '').includes('old')
    || !String(item3161FocusedWill.classificationReason || '').includes(
      'generic_focused_will_3161_test.go',
    )
    || !String(item3161FocusedWill.classificationReason || '').includes('combatDataAssembler')
    || !(item3161FocusedWill.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.focusedWill3161,
    )
    || !(item3161FocusedWill.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.focusedWill3161Backend,
    )
    || !String(
      (item3161FocusedWill.coverageEvidence || []).find(
        (e) => e.sourceWorktree === 'backend',
      )?.note || '',
    ).includes('LolGenericFocusedWill3161SeedSqlTest')
    || !String(
      (item3161FocusedWill.coverageEvidence || []).find(
        (e) => e.sourceWorktree === 'backend',
      )?.note || '',
    ).includes('GenericCastOriginPerCastThrottleDbContractSqlTest')
  ) {
    errors.push(
      '3161 专注意志 must be migrated with empty remainingGap, Wiki revid/hash + perCastThrottle/max4/6000ms/3%/old-stack/Web projection wording (not blocked/manual/DDragon), and wasm+backend evidence paths',
    );
  }
  if (item3161FocusedWill) {
    validateBilateralCoverageEvidence(
      item3161FocusedWill.candidateKey,
      item3161FocusedWill.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const item3179Nightstalker = records.find(
    (r) => r.candidateKey === 'item_passive|3179|item_passive|夜行者',
  );
  if (
    !item3179Nightstalker
    || item3179Nightstalker.genericClassification !== 'migrated'
    || String(item3179Nightstalker.remainingGap || '').trim() !== ''
    || citesForbiddenProvenance(item3179Nightstalker.classificationReason)
    || !String(item3179Nightstalker.classificationReason || '').includes('4030984')
    || !String(item3179Nightstalker.classificationReason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    )
    || !String(item3179Nightstalker.classificationReason || '').includes('Phase-A')
    || !String(item3179Nightstalker.classificationReason || '').includes('50')
    || !String(item3179Nightstalker.classificationReason || '').includes('1.5')
    || !String(item3179Nightstalker.classificationReason || '').includes('armor_pen_flat')
    || !String(item3179Nightstalker.classificationReason || '').includes('ready')
    || !String(item3179Nightstalker.classificationReason || '').includes('re-arm')
    || !String(item3179Nightstalker.classificationReason || '').includes(
      'generic_nightstalker_3179_test.go',
    )
    || !(item3179Nightstalker.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.nightstalker3179,
    )
    || !(item3179Nightstalker.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.nightstalker3179Backend,
    )
    || !(item3179Nightstalker.coverageEvidence || [])
      .find((e) => e.sourceWorktree === 'backend')
      ?.note?.includes('LolGenericNightstalker3179SeedSqlTest')
  ) {
    errors.push(
      '3179 夜行者 must be migrated with empty remainingGap, Wiki revid/hash + Phase-A start-ready/true 50+1.5*armor_pen_flat/no re-arm wording, and wasm+backend evidence paths',
    );
  }
  if (item3179Nightstalker) {
    validateBilateralCoverageEvidence(
      item3179Nightstalker.candidateKey,
      item3179Nightstalker.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const item2512OpeningBarrage = records.find(
    (r) => r.candidateKey === 'item_passive|2512|item_passive|开战弹幕',
  );
  if (
    !item2512OpeningBarrage
    || item2512OpeningBarrage.genericClassification !== 'migrated'
    || String(item2512OpeningBarrage.remainingGap || '').trim() !== ''
    || String(item2512OpeningBarrage.sourceRef || '') !==
      '数据参考/lol-wiki-current-items/current-items.normalized.json#item_2512_Opening_Barrage'
    || String(item2512OpeningBarrage.sourceRef || '').includes('item.json')
    || citesForbiddenProvenance(item2512OpeningBarrage.classificationReason)
    || citesForbiddenProvenance(item2512OpeningBarrage.sourceRef)
    || !(item2512OpeningBarrage.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.fiendhunterBolts2512
        && e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    )
    || !(item2512OpeningBarrage.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.fiendhunterBolts2512Backend
        && e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    )
  ) {
    errors.push(
      '2512 开战弹幕 must be migrated with empty remainingGap, Wiki sourceRef (not item.json), and wasm+backend evidence paths',
    );
  }
  if (item2512OpeningBarrage) {
    validateBilateralCoverageEvidence(
      item2512OpeningBarrage.candidateKey,
      item2512OpeningBarrage.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const item3073Overdrive = records.find(
    (r) => r.candidateKey === 'item_passive|3073|item_passive|过载',
  );
  if (
    !item3073Overdrive
    || item3073Overdrive.genericClassification !== 'migrated'
    || String(item3073Overdrive.remainingGap || '').trim() !== ''
    || String(item3073Overdrive.sourceRef || '') !==
      '数据参考/lol-wiki-current-items/current-items.normalized.json#item_3073_Overdrive'
    || String(item3073Overdrive.sourceRef || '').includes('item.json')
    || citesForbiddenProvenance(item3073Overdrive.classificationReason)
    || citesForbiddenProvenance(item3073Overdrive.sourceRef)
    || !(item3073Overdrive.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.experimentalHexplate3073
        && e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    )
    || !(item3073Overdrive.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.experimentalHexplate3073Backend
        && e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    )
  ) {
    errors.push(
      '3073 过载 must be migrated with empty remainingGap, Wiki sourceRef (not item.json), and wasm+backend evidence paths',
    );
  }
  if (item3073Overdrive) {
    validateBilateralCoverageEvidence(
      item3073Overdrive.candidateKey,
      item3073Overdrive.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const item6610LightshieldStrike = records.find(
    (r) => r.candidateKey === 'item_passive|6610|item_passive|光盾打击',
  );
  if (
    !item6610LightshieldStrike
    || item6610LightshieldStrike.genericClassification !== 'migrated'
    || String(item6610LightshieldStrike.remainingGap || '').trim() !== ''
    || String(item6610LightshieldStrike.sourceRef || '') !==
      '数据参考/lol-wiki-current-items/current-items.normalized.json#item_6610_Lightshield_Strike'
    || String(item6610LightshieldStrike.sourceRef || '').includes('item.json')
    || citesForbiddenProvenance(item6610LightshieldStrike.classificationReason)
    || citesForbiddenProvenance(item6610LightshieldStrike.sourceRef)
    || !(item6610LightshieldStrike.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.sunderedSky6610
        && e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    )
    || !(item6610LightshieldStrike.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.sunderedSky6610Backend
        && e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    )
  ) {
    errors.push(
      '6610 光盾打击 must be migrated with empty remainingGap, Wiki sourceRef (not item.json), and wasm+backend evidence paths',
    );
  }
  if (item6610LightshieldStrike) {
    validateBilateralCoverageEvidence(
      item6610LightshieldStrike.candidateKey,
      item6610LightshieldStrike.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const item3032Flurry = records.find(
    (r) => r.candidateKey === 'item_passive|3032|item_passive|疾风骤雨',
  );
  if (
    !item3032Flurry
    || item3032Flurry.genericClassification !== 'migrated'
    || String(item3032Flurry.remainingGap || '').trim() !== ''
    || String(item3032Flurry.sourceRef || '') !==
      '数据参考/lol-wiki-current-items/current-items.normalized.json#item_3032_Flurry'
    || String(item3032Flurry.sourceRef || '').includes('item.json')
    || citesForbiddenProvenance(item3032Flurry.classificationReason)
    || citesForbiddenProvenance(item3032Flurry.sourceRef)
    || !(item3032Flurry.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.yunTalFlurry3032
        && e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    )
    || !(item3032Flurry.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.yunTalFlurry3032Backend
        && e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    )
  ) {
    errors.push(
      '3032 疾风骤雨 must be migrated with empty remainingGap, Wiki sourceRef (not item.json), and wasm+backend evidence paths',
    );
  }
  if (item3032Flurry) {
    validateBilateralCoverageEvidence(
      item3032Flurry.candidateKey,
      item3032Flurry.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const kindredP = records.find((r) => r.candidateKey === 'hero_skill|hero_kindred|P|千珏之印');
  if (
    !kindredP
    || kindredP.genericClassification !== 'migrated'
    || String(kindredP.remainingGap || '').trim() !== ''
    || citesForbiddenProvenance(kindredP.classificationReason)
    || /kindred_mark_stacks_max_assumption|c14a4/i.test(
      String(kindredP.classificationReason || ''),
    )
    || !String(kindredP.classificationReason || '').includes('3994253')
    || !String(kindredP.classificationReason || '').includes(
      '9ac60eae427fac9ba279734dba2c01b34852eb0be84a01d95296328794afc14a',
    )
    || !String(kindredP.classificationReason || '').includes('Phase-A')
    || !String(kindredP.classificationReason || '').includes('250')
    || !String(kindredP.classificationReason || '').includes('1.60')
    || !String(kindredP.classificationReason || '').includes('0.265')
    || !String(kindredP.classificationReason || '').includes('0.175')
    || !String(kindredP.classificationReason || '').includes('Q/W/E')
    || !(kindredP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.kindredMarkOfKindredMaxMarks,
    )
    || !(kindredP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.kindredMarkOfKindredMaxMarksBackend
        && String(e.note || '').includes('LolGenericKindredMarkOfKindredMaxMarksSeedSqlTest'),
    )
  ) {
    errors.push(
      'Kindred P must be migrated with empty remainingGap, Wiki rev3994253 + correct SHA (not c14a4) + fixed 25-mark Phase-A wording, and wasm+backend evidence paths',
    );
  }
  if (kindredP) {
    validateBilateralCoverageEvidence(
      kindredP.candidateKey,
      kindredP.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const kindredQ = records.find((r) => r.candidateKey === 'hero_skill|hero_kindred|Q|乱箭之舞');
  const kindredW = records.find((r) => r.candidateKey === 'hero_skill|hero_kindred|W|狼灵狂热');
  const kindredE = records.find((r) => r.candidateKey === 'hero_skill|hero_kindred|E|横生惧意');
  const kindredR = records.find((r) => r.candidateKey === 'hero_skill|hero_kindred|R|羊灵生息');
  if (!kindredQ || kindredQ.genericClassification !== 'blocked') {
    errors.push('Kindred Q must remain blocked (probe must not upgrade inventory)');
  }
  if (!kindredW || kindredW.genericClassification !== 'blocked') {
    errors.push('Kindred W must remain blocked (probe must not upgrade inventory)');
  }
  if (!kindredE || kindredE.genericClassification !== 'blocked') {
    errors.push('Kindred E must remain blocked (probe must not upgrade inventory)');
  }
  if (!kindredR || kindredR.genericClassification !== 'out_of_scope') {
    errors.push('Kindred R must remain out_of_scope');
  }

  const item3179Blackout = records.find(
    (r) => r.candidateKey === 'item_passive|3179|item_passive|封锁',
  );
  if (
    !item3179Blackout
    || item3179Blackout.genericClassification !== 'out_of_scope'
    || !(item3179Blackout.genericMechanismTags || []).includes('ward_vision')
  ) {
    errors.push('3179 封锁 must remain out_of_scope with ward_vision boundary');
  }

  const item3097Energized = records.find(
    (r) => r.candidateKey === 'item_passive|3097|item_passive|盈能',
  );
  if (
    !item3097Energized
    || item3097Energized.genericClassification !== 'blocked'
    || !item3097Energized.dataGapEvidence?.missingFields?.includes('move_charge_rate')
    || !item3097Energized.dataGapEvidence?.missingFields?.includes('attack_charge_rate')
    || !String(item3097Energized.dataGapEvidence?.sourceRef || '').includes(
      'manifest.json@revid4030984',
    )
    || !String(item3097Energized.dataGapEvidence?.sourceRef || '').includes(
      'current-items.normalized.json#item_3097/effects.pass',
    )
    || String(item3097Energized.dataGapEvidence?.sourceRef || '').includes('build-generic-g8')
  ) {
    errors.push(
      '3097 盈能 must be blocked with move/attack charge-rate gap and Wiki item provenance (not generator self-ref)',
    );
  }

  const item2501Retribution = records.find(
    (r) => r.candidateKey === 'item_passive|2501|item_passive|报复',
  );
  if (
    !item2501Retribution
    || item2501Retribution.genericClassification !== 'migrated'
    || String(item2501Retribution.remainingGap || '').trim()
    || !String(item2501Retribution.classificationReason || '').includes('multiply')
    || !String(item2501Retribution.classificationReason || '').includes('0.12')
    || !String(item2501Retribution.classificationReason || '').includes(
      'manifest.json@revid4030984',
    )
    || !String(item2501Retribution.classificationReason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    )
    || citesForbiddenProvenance(item2501Retribution.classificationReason)
    || !(item2501Retribution.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.wikiReadyItems,
    )
    || !(item2501Retribution.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.wikiReadyItems,
    )
  ) {
    errors.push(
      '2501 报复 must be migrated with empty remainingGap, Wiki revid/hash provenance, and bilateral wiki-ready wasm+backend evidence',
    );
  }
  if (item2501Retribution) {
    validateBilateralCoverageEvidence(
      item2501Retribution.candidateKey,
      item2501Retribution.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  // Final OOS must carry structured outOfScopeEvidence aligned to auditBaseline.
  const oosRows = records.filter((r) => r.genericClassification === 'out_of_scope');
  if (oosRows.length === 0) {
    errors.push('out_of_scope rows must be non-empty');
  }
  let oosOmnibusReason = 0;
  for (const r of oosRows) {
    const ev = r.outOfScopeEvidence;
    if (!ev || typeof ev !== 'object') {
      errors.push(`out_of_scope missing outOfScopeEvidence @ ${r.candidateKey}`);
      continue;
    }
    if (!String(ev.sourceRef || '').trim()) {
      errors.push(`out_of_scope outOfScopeEvidence.sourceRef empty @ ${r.candidateKey}`);
    }
    if (
      /数据参考\/champion\//i.test(String(ev.sourceRef || ''))
      || /数据参考\/item\.json/i.test(String(ev.sourceRef || ''))
      || citesForbiddenProvenance(ev.sourceRef)
    ) {
      errors.push(`out_of_scope outOfScopeEvidence.sourceRef cites forbidden provenance @ ${r.candidateKey}`);
    }
    if (!String(ev.sourceTextSummary || '').trim()) {
      errors.push(`out_of_scope outOfScopeEvidence.sourceTextSummary empty @ ${r.candidateKey}`);
    }
    if (ev.reviewedPrimaryTargetDamageBranch !== true) {
      errors.push(
        `out_of_scope reviewedPrimaryTargetDamageBranch must be true @ ${r.candidateKey}`,
      );
    }
    if (!BOUNDARY_CATEGORIES.has(String(ev.boundaryCategory || ''))) {
      errors.push(
        `out_of_scope boundaryCategory invalid @ ${r.candidateKey}: ${ev.boundaryCategory}`,
      );
    }
    if (!String(ev.excludedBehavior || '').trim()) {
      errors.push(`out_of_scope excludedBehavior empty @ ${r.candidateKey}`);
    }
    if (!String(ev.boundaryReason || '').trim()) {
      errors.push(`out_of_scope boundaryReason empty @ ${r.candidateKey}`);
    }
    if (
      GENERIC_OOS_REASON_RE.test(String(ev.boundaryReason || ''))
      || STALE_OTHER_TARGETS_REASON_RE.test(String(ev.boundaryReason || ''))
    ) {
      oosOmnibusReason += 1;
      errors.push(`out_of_scope generic omnibus reason not allowed @ ${r.candidateKey}`);
    }
    if (
      GENERIC_OOS_REASON_RE.test(String(r.classificationReason || ''))
      || STALE_OTHER_TARGETS_REASON_RE.test(String(r.classificationReason || ''))
    ) {
      oosOmnibusReason += 1;
      errors.push(`out_of_scope classificationReason still generic/omnibus @ ${r.candidateKey}`);
    }
    const disposition = String(ev.damageRelevantSubBranchDisposition || '');
    if (!disposition) {
      errors.push(
        `out_of_scope damageRelevantSubBranchDisposition empty @ ${r.candidateKey}`,
      );
    }

    // Semantic fields must equal auditBaseline.outOfScope when baseline present.
    const baselineOos = r.auditBaseline?.outOfScope;
    if (baselineOos && typeof baselineOos === 'object') {
      for (const field of [
        'boundaryCategory',
        'excludedBehavior',
        'boundaryReason',
        'damageRelevantSubBranchDisposition',
      ]) {
        if (String(ev[field] ?? '') !== String(baselineOos[field] ?? '')) {
          errors.push(
            `out_of_scope ${field} != auditBaseline.outOfScope @ ${r.candidateKey}: ${ev[field]} vs ${baselineOos[field]}`,
          );
        }
      }
    } else {
      errors.push(
        `out_of_scope missing auditBaseline.outOfScope (fail-closed) @ ${r.candidateKey}`,
      );
    }
  }
  if (oosOmnibusReason !== 0) {
    errors.push(`OOS generic omnibus reason count expected 0, got ${oosOmnibusReason}`);
  }
  const yunaraE = records.find((r) => r.candidateKey === 'hero_skill|hero_yunara|E|明踪步 | 夜影翻');
  if (
    !yunaraE
    || yunaraE.genericClassification !== 'out_of_scope'
    || yunaraE.outOfScopeEvidence?.boundaryCategory !== 'pure_movement_or_dash'
  ) {
    errors.push(
      'Yunara E 明踪步|夜影翻 must be out_of_scope with boundaryCategory=pure_movement_or_dash',
    );
  }

  const dravenQ = records.find((r) => r.candidateKey === 'hero_skill|hero_draven|Q|旋转飞斧');
  if (
    !dravenQ
    || dravenQ.genericClassification !== 'migrated'
    || !(dravenQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.dravenSpinningAxe,
    )
    || !(dravenQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.dravenSpinningAxeBackend,
    )
    || !String(dravenQ.classificationReason || '').includes('1400')
    || !String(dravenQ.classificationReason || '').includes('排除')
  ) {
    errors.push(
      'Draven Q must be migrated with bilateral wasm+backend evidence under user-approved 1v1 scope (landing/W-reset excluded)',
    );
  }
  const dravenW = records.find((r) => r.candidateKey === 'hero_skill|hero_draven|W|血性冲刺');
  if (
    !dravenW
    || dravenW.genericClassification !== 'migrated'
    || String(dravenW.remainingGap || '').trim()
    || !(dravenW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.dravenBloodRush,
    )
    || !(dravenW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.dravenWAxeCatchReset,
    )
    || !(dravenW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.dravenBloodRushBackend,
    )
    || !String(dravenW.classificationReason || '').includes('axe_caught')
    || !String(dravenW.classificationReason || '').includes('40%')
  ) {
    errors.push(
      'Draven W must be migrated with empty remainingGap and blood-rush + axe-catch-reset wasm + backend seed evidence',
    );
  }
  if (dravenW) {
    validateBilateralCoverageEvidence(
      dravenW.candidateKey,
      dravenW.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const dravenE = records.find((r) => r.candidateKey === 'hero_skill|hero_draven|E|开道利斧');
  const dravenETags = [...(dravenE?.genericMechanismTags || [])].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  const dravenEExpectedTags = [
    'ability_cost_cooldown',
    'ability_flat_bonus_ad_damage',
    'active_physical_damage',
    'immediate_impact_scaffold',
  ];
  if (
    !dravenE
    || dravenE.genericClassification !== 'migrated'
    || String(dravenE.remainingGap || '').trim()
    || (dravenE.dataGapEvidence?.missingFields || []).length !== 0
    || dravenETags.join('|') !== dravenEExpectedTags.join('|')
    || !String(dravenE.classificationReason || '').includes('4034694')
    || !String(dravenE.classificationReason || '').includes(
      '7bb6ebdc19413ef908e78fea01576d1184a66bc62fd6148120845573c1468e8d',
    )
    || !String(dravenE.classificationReason || '').includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget',
    )
    || !String(dravenE.classificationReason || '').includes('215')
    || !String(dravenE.classificationReason || '').includes('0.50')
    || !String(dravenE.classificationReason || '').includes('70 mana')
    || !String(dravenE.classificationReason || '').includes('12000')
    || !String(dravenE.classificationReason || '').includes('127.5')
    || !String(dravenE.classificationReason || '').includes('不宣称')
    || !String(dravenE.sourceRef || '').includes('draven-e.json')
    || citesForbiddenProvenance(dravenE.classificationReason)
    || !(dravenE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.dravenStandAside
        && e.taskKey === 'wasm-generic-draven-stand-aside'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget',
        ),
    )
    || !(dravenE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.dravenStandAsideBackend
        && e.taskKey === 'wasm-generic-draven-stand-aside'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget',
        )
        && String(e.note || '').includes('LolGenericDravenStandAsideSeedSqlTest'),
    )
  ) {
    errors.push(
      'Draven E must be migrated with empty remainingGap/missingFields, exact Stand Aside tags, Wiki rev4034694/SHA + frozen completedBoundary, numeric contract/70mana/12000CD/127.5, and bilateral wasm+backend evidence (no cast-delay/CC/geometry/multitarget/full-game claim)',
    );
  }
  if (dravenE) {
    validateBilateralCoverageEvidence(
      dravenE.candidateKey,
      dravenE.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const teemoQ = records.find((r) => r.candidateKey === 'hero_skill|hero_teemo|Q|致盲吹箭');
  const teemoQTags = [...(teemoQ?.genericMechanismTags || [])].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  const teemoQExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  if (
    !teemoQ
    || teemoQ.genericClassification !== 'migrated'
    || String(teemoQ.remainingGap || '').trim()
    || (teemoQ.dataGapEvidence?.missingFields || []).length !== 0
    || teemoQTags.join('|') !== teemoQExpectedTags.join('|')
    || teemoQTags.includes('meta_or_non_target_dps')
    || String(teemoQ.remainingGap || '').includes('blocked_data')
    || String(teemoQ.classificationReason || '').includes('out_of_scope_for_single_target_dps')
    || String(teemoQ.classificationReason || '').includes('blocked_data')
    || String(teemoQ.classificationReason || '').includes(
      'implementation_gap_no_unresolved_data_fields',
    )
    || !String(teemoQ.classificationReason || '').includes('3948425')
    || !String(teemoQ.classificationReason || '').includes(
      '4e3c475ed55ec865f6a9060c8ad0b2665e5379b3ae7e9e5cb644f83212b240a7',
    )
    || !String(teemoQ.classificationReason || '').includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry',
    )
    || !String(teemoQ.classificationReason || '').includes('260')
    || !String(teemoQ.classificationReason || '').includes('0.70')
    || !String(teemoQ.classificationReason || '').includes('90 mana')
    || !String(teemoQ.classificationReason || '').includes('7000')
    || !String(teemoQ.classificationReason || '').includes('raw400')
    || !String(teemoQ.classificationReason || '').includes('mitigated200')
    || !String(teemoQ.classificationReason || '').includes('154')
    || !String(teemoQ.classificationReason || '').includes('不宣称')
    || !String(teemoQ.sourceRef || '').includes('teemo-q.json')
    || citesForbiddenProvenance(teemoQ.classificationReason)
    || !(teemoQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.teemoBlindingDart
        && e.taskKey === 'wasm-generic-teemo-blinding-dart'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry',
        ),
    )
    || !(teemoQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.teemoBlindingDartBackend
        && e.taskKey === 'wasm-generic-teemo-blinding-dart'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry',
        )
        && String(e.note || '').includes('LolGenericTeemoBlindingDartSeedSqlTest'),
    )
  ) {
    errors.push(
      'Teemo Q must be migrated with empty remainingGap/missingFields, exact Blinding Dart tags, stale meta/blocked_data/out_of_scope/implementation-gap cleared, Wiki rev3948425/SHA + frozen completedBoundary, numeric contract/90mana/7000CD/AP200→400/MR100→200/mana154, and bilateral wasm+backend evidence (no blind/cast/projectile/geometry/multitarget/full-game claim)',
    );
  }
  if (teemoQ) {
    validateBilateralCoverageEvidence(
      teemoQ.candidateKey,
      teemoQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const vayneE = records.find((r) => r.candidateKey === 'hero_skill|hero_vayne|E|恶魔审判');
  const vayneETags = [...(vayneE?.genericMechanismTags || [])].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  const vayneEExpectedTags = [
    'ability_cost_cooldown',
    'ability_flat_bonus_ad_damage',
    'active_physical_damage',
    'immediate_impact_scaffold',
  ];
  if (
    !vayneE
    || vayneE.genericClassification !== 'migrated'
    || String(vayneE.remainingGap || '').trim()
    || (vayneE.dataGapEvidence?.missingFields || []).length !== 0
    || vayneETags.join('|') !== vayneEExpectedTags.join('|')
    || vayneETags.includes('dps_relevant_manual_review')
    || vayneETags.includes('meta_or_non_target_dps')
    || String(vayneE.remainingGap || '').includes('blocked_data')
    || String(vayneE.classificationReason || '').includes('out_of_scope_for_single_target_dps')
    || String(vayneE.classificationReason || '').includes('blocked_data')
    || String(vayneE.classificationReason || '').includes(
      'implementation_gap_no_unresolved_data_fields',
    )
    || !String(vayneE.classificationReason || '').includes('4008541')
    || !String(vayneE.classificationReason || '').includes(
      'f2b2ba17b90ff5096a9a154f8d1fd4cc43ed3e1be4ebb502cb644acf17712c37',
    )
    || !String(vayneE.classificationReason || '').includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile',
    )
    || !String(vayneE.classificationReason || '').includes('190')
    || !String(vayneE.classificationReason || '').includes('0.50')
    || !String(vayneE.classificationReason || '').includes('90 mana')
    || !String(vayneE.classificationReason || '').includes('12000')
    || !String(vayneE.classificationReason || '').includes('baseAD60')
    || !String(vayneE.classificationReason || '').includes('resolvedAD140')
    || !String(vayneE.classificationReason || '').includes('bonusAD80')
    || !String(vayneE.classificationReason || '').includes('raw230')
    || !String(vayneE.classificationReason || '').includes('mitigated115')
    || !String(vayneE.classificationReason || '').includes('52')
    || !String(vayneE.classificationReason || '').includes('不宣称')
    || !String(vayneE.sourceRef || '').includes('vayne-e.json')
    || citesForbiddenProvenance(vayneE.classificationReason)
    || !(vayneE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.vayneCondemnPrimaryHit
        && e.taskKey === 'wasm-generic-vayne-condemn-primary-hit'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile',
        ),
    )
    || !(vayneE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.vayneCondemnPrimaryHitBackend
        && e.taskKey === 'wasm-generic-vayne-condemn-primary-hit'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile',
        )
        && String(e.note || '').includes('LolGenericVayneCondemnPrimaryHitSeedSqlTest'),
    )
  ) {
    errors.push(
      'Vayne E must be migrated with empty remainingGap/missingFields, exact Condemn primary-hit tags, stale dps_relevant_manual_review/blocked_data/out_of_scope/implementation-gap cleared, Wiki rev4008541/SHA + frozen completedBoundary, numeric contract/90mana/12000CD/baseAD60→raw230/armor100→115/mana52, and bilateral wasm+backend evidence (no wall/terrain/CC/cast/projectile/full-game claim)',
    );
  }
  if (vayneE) {
    validateBilateralCoverageEvidence(
      vayneE.candidateKey,
      vayneE.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const vayneR = records.find((r) => r.candidateKey === 'hero_skill|hero_vayne|R|终极时刻');
  const vayneRTags = [...(vayneR?.genericMechanismTags || [])];
  const vayneRExpectedTags = [
    'ability_cost_cooldown',
    'cast_triggered_timed_bonus_ad',
    'flat_ad_add',
    'timed_provider_state',
  ];
  const vayneRReason = String(vayneR?.classificationReason || '');
  const vayneRBoundary =
    'rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement';
  if (
    !vayneR
    || vayneR.candidateKey !== 'hero_skill|hero_vayne|R|终极时刻'
    || vayneR.passiveName !== '终极时刻'
    || vayneR.genericClassification !== 'migrated'
    || String(vayneR.remainingGap || '').trim()
    || (vayneR.dataGapEvidence?.missingFields || []).length !== 0
    || vayneRTags.join('|') !== vayneRExpectedTags.join('|')
    || vayneRTags.includes('meta_or_non_target_dps')
    || vayneRTags.includes('dps_relevant_manual_review')
    || String(vayneR.remainingGap || '').includes('blocked_data')
    || vayneRReason.includes('out_of_scope_for_single_target_dps')
    || vayneRReason.includes('blocked_data')
    || vayneRReason.includes('implementation_gap_no_unresolved_data_fields')
    || vayneRReason.includes('meta_or_non_target_dps')
    || vayneRReason.includes('最终时刻')
    || JSON.stringify(vayneR.coverageEvidence || []).includes('最终时刻')
    || !vayneRReason.includes('3807995')
    || !vayneRReason.includes(
      'e417f1cfc5e8253fdfe8140c4659e8fe63441c38ca3aa1e37d69aa31e25d682d',
    )
    || !vayneRReason.includes('343d19e30f0edf70359f122abb2c6c8e7d2d16d5e4c6db46416428d72e7c7642')
    || !vayneRReason.includes('Template:Data Vayne/R')
    || !vayneRReason.includes('Template:Data Vayne/Final Hour')
    || !vayneRReason.includes('page1309991')
    || !vayneRReason.includes('bytes2015')
    || !vayneRReason.includes('bytes2012')
    || !vayneRReason.includes(vayneRBoundary)
    || !vayneRReason.includes('80 mana')
    || !vayneRReason.includes('70000')
    || !vayneRReason.includes('+65')
    || !vayneRReason.includes('12000')
    || !vayneRReason.includes('direct provider-scope override state_change')
    || !vayneRReason.includes('zero listeners')
    || !vayneRReason.includes('ability-start')
    || !vayneRReason.includes('AD60')
    || !vayneRReason.includes('125')
    || !vayneRReason.includes('62.5')
    || !vayneRReason.includes('mana300')
    || !vayneRReason.includes('140')
    || !vayneRReason.includes('t69999')
    || !vayneRReason.includes('Night Hunter')
    || !vayneRReason.includes('Tumble')
    || !vayneRReason.includes('不宣称')
    || !String(vayneR.sourceRef || '').includes('vayne-r.json')
    || !String(vayneR.sourceRef || '').includes(
      'e417f1cfc5e8253fdfe8140c4659e8fe63441c38ca3aa1e37d69aa31e25d682d',
    )
    || citesForbiddenProvenance(vayneR.classificationReason)
    || !(vayneR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.vayneFinalHourTimedBonusAd
        && e.taskKey === 'wasm-generic-vayne-final-hour-timed-bonus-ad'
        && String(e.note || '').includes(vayneRBoundary)
        && String(e.note || '').includes('direct provider-scope override state_change')
        && String(e.note || '').includes('zero listeners')
        && !String(e.note || '').includes('最终时刻'),
    )
    || !(vayneR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.vayneFinalHourTimedBonusAdBackend
        && e.taskKey === 'wasm-generic-vayne-final-hour-timed-bonus-ad'
        && String(e.note || '').includes(vayneRBoundary)
        && String(e.note || '').includes('LolGenericVayneFinalHourTimedBonusAdSeedSqlTest')
        && String(e.note || '').includes('4440c3d')
        && String(e.note || '').includes('8eb9f2a')
        && String(e.note || '').includes('2710647')
        && String(e.note || '').includes('18dbff1')
        && String(e.note || '').includes('3a35a95')
        && !String(e.note || '').includes('最终时刻'),
    )
  ) {
    errors.push(
      'Vayne R must be migrated with empty remainingGap/missingFields, exact Final Hour ordered tags (no meta_or_non_target_dps), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw classification/tags/auditBaseline provenance, Wiki rev3807995/SHA + local raw caveat + frozen completedBoundary, 80mana/70000CD/+65AD/12000ms direct state_change zero-listener numerics (AD60→125→60; armor100 125/62.5 then60/30; mana300→140; t0/t69999/t70000), stable-key 终极时刻 (fail-closed vs 最终时刻), and bilateral wasm+backend evidence (owning 4440c3d+8eb9f2a / integrated 2710647+18dbff1 / Wasm 3a35a95; no Night Hunter/Tumble/stealth/takedown/live claim)',
    );
  }
  if (vayneR) {
    validateBilateralCoverageEvidence(
      vayneR.candidateKey,
      vayneR.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const quinnP = records.find((r) => r.candidateKey === 'hero_skill|hero_quinn|P|侵扰');
  const quinnPTags = [...(quinnP?.genericMechanismTags || [])];
  const quinnPExpectedTags = [
    'on_hit',
    'formula_on_hit',
    'bonus_ad_ratio',
    'copyable_on_hit_false',
    'provider_target_state_consume',
  ];
  const quinnPReason = String(quinnP?.classificationReason || '');
  const quinnPBoundary =
    'level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels';
  if (!EXACT_OVERRIDES.has('hero_quinn|P')) {
    errors.push('Quinn P exact override key hero_quinn|P must exist before fallback');
  }
  if (
    !quinnP
    || quinnP.candidateKey !== 'hero_skill|hero_quinn|P|侵扰'
    || quinnP.passiveName !== '侵扰'
    || quinnP.genericClassification !== 'migrated'
    || String(quinnP.remainingGap || '').trim()
    || (quinnP.dataGapEvidence?.missingFields || []).length !== 0
    || quinnPTags.join('|') !== quinnPExpectedTags.join('|')
    || quinnPTags.includes('dps_relevant_manual_review')
    || quinnPTags.includes('meta_or_non_target_dps')
    || String(quinnP.remainingGap || '').includes('blocked_data')
    || quinnPReason.includes('blocked_data')
    || quinnPReason.includes('implementation_gap_no_unresolved_data_fields')
    || quinnPReason.includes('dps_relevant_manual_review')
    || !quinnPReason.includes('4024765')
    || !quinnPReason.includes(
      '740debfb3b72dd7f926337f7eb4adbe3a65c88caec227ca16e00dff6634f798c',
    )
    || !quinnPReason.includes('08853c2c25ada7769e25908123dbb56f7b14dc0c1479a8a5842693874849a731')
    || !quinnPReason.includes('Template:Data Quinn/I')
    || !quinnPReason.includes('Template:Data Quinn/Harrier')
    || !quinnPReason.includes('page1308953')
    || !quinnPReason.includes('bytes2390')
    || !quinnPReason.includes('2026-06-03T00:49:03Z')
    || !quinnPReason.includes(quinnPBoundary)
    || !quinnPReason.includes('nested binary')
    || !quinnPReason.includes('source.attr.ad.resolved')
    || !quinnPReason.includes('source.attr.ad.base')
    || !quinnPReason.includes('120')
    || !quinnPReason.includes('0.40')
    || !quinnPReason.includes('bonusAD80')
    || !quinnPReason.includes('raw152')
    || !quinnPReason.includes('mitigated76')
    || !quinnPReason.includes('raw120')
    || !quinnPReason.includes('mitigated60')
    || !quinnPReason.includes('t3000')
    || !quinnPReason.includes('20110')
    || !quinnPReason.includes('20252')
    || !quinnPReason.includes('provider_target')
    || !quinnPReason.includes('W-before-P')
    || !quinnPReason.includes('P-before-W')
    || !quinnPReason.includes('不宣称 W AS magnitude')
    || !quinnPReason.includes('basic_attack_hit')
    || !quinnPReason.includes('heightened_senses_active')
    || !quinnPReason.includes('harrier_vulnerable')
    || !quinnPReason.includes('Q/E/Skystrike/Valor')
    || !quinnPReason.includes('monster75')
    || !quinnPReason.includes('不宣称')
    || !String(quinnP.sourceRef || '').includes('quinn-p.json')
    || !String(quinnP.sourceRef || '').includes(
      '740debfb3b72dd7f926337f7eb4adbe3a65c88caec227ca16e00dff6634f798c',
    )
    || quinnP.auditBaseline?.gapCode !== 'blocked_data'
    || quinnP.auditBaseline?.resolvedBucket !== 'blocked'
    || !(quinnP.auditBaseline?.mechanismTags || []).includes('dps_relevant_manual_review')
    || quinnP.classification !== 'needs_manual_baseline'
    || !(quinnP.mechanismTags || []).includes('dps_relevant_manual_review')
    || citesForbiddenProvenance(quinnP.classificationReason)
    || !(quinnP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.quinnHarrierPremarkedConsume
        && e.taskKey === 'wasm-generic-quinn-harrier-premarked-consume'
        && String(e.note || '').includes(quinnPBoundary)
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('20110+20252')
        && String(e.note || '').includes('source+provider_target')
        && String(e.note || '').includes('shared W provider')
        && String(e.note || '').includes('W-before-P')
        && String(e.note || '').includes('7c84b36')
        && String(e.note || '').includes('no W AS magnitude'),
    )
    || !(quinnP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.quinnHarrierPremarkedConsumeBackend
        && e.taskKey === 'wasm-generic-quinn-harrier-premarked-consume'
        && String(e.note || '').includes(quinnPBoundary)
        && String(e.note || '').includes('LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest')
        && String(e.note || '').includes('README')
        && String(e.note || '').includes('0a6301e')
        && String(e.note || '').includes('12d9281')
        && String(e.note || '').includes('7c84b36')
        && String(e.note || '').includes('extends existing W provider')
        && String(e.note || '').includes('W rows check-only')
        && String(e.note || '').includes('20110+20252')
        && String(e.note || '').includes('no Web change'),
    )
  ) {
    errors.push(
      'Quinn P must be migrated with empty remainingGap/missingFields, exact Harrier ordered tags (no dps_relevant_manual_review), stale blocked_data/implementation-gap cleared while retaining raw needs_manual_baseline/dps_relevant_manual_review/auditBaseline provenance, Wiki rev4024765/SHA + local raw caveat + frozen completedBoundary, level18 preexisting-harrier consume numerics (bonusAD80→raw152/76; baseline raw120/60; t0/t3000 one P bonus), 20110+20252/source+provider_target, shared W provider + W-before-P/P-before-W order independence, no W AS magnitude claim, and bilateral wasm+backend evidence (owning 0a6301e / integrated 12d9281 / Wasm 7c84b36; Web parity no change; no mark-production/duration/Valor/monster/R-disable/parry/live claim)',
    );
  }
  if (quinnP) {
    validateBilateralCoverageEvidence(
      quinnP.candidateKey,
      quinnP.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const quinnE = records.find((r) => r.candidateKey === 'hero_skill|hero_quinn|E|旋翔掠杀');
  const quinnETags = [...(quinnE?.genericMechanismTags || [])];
  const quinnEExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'bonus_ad_ratio',
    'immediate_impact_scaffold',
  ];
  const quinnEReason = String(quinnE?.classificationReason || '');
  const quinnEBoundary =
    'rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_140_plus_0_20_bonus_ad; no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks';
  if (!EXACT_OVERRIDES.has('hero_quinn|E')) {
    errors.push('Quinn E exact override key hero_quinn|E must exist before distance_or_ratio fallback');
  }
  if (
    !quinnE
    || quinnE.candidateKey !== 'hero_skill|hero_quinn|E|旋翔掠杀'
    || quinnE.passiveName !== '旋翔掠杀'
    || quinnE.genericClassification !== 'migrated'
    || String(quinnE.remainingGap || '').trim()
    || (quinnE.dataGapEvidence?.missingFields || []).length !== 0
    || quinnETags.join('|') !== quinnEExpectedTags.join('|')
    || quinnETags.includes('distance_or_ratio_modifier')
    || quinnETags.includes('meta_or_non_target_dps')
    || quinnETags.includes('dps_relevant_manual_review')
    || String(quinnE.remainingGap || '').includes('distance_or_ratio')
    || String(quinnE.remainingGap || '').includes('blocked_data')
    || quinnEReason.includes('distance_based_damage_modifier / damage_multiplier')
    || quinnEReason.includes('blocked_data')
    || quinnEReason.includes('implementation_gap_no_unresolved_data_fields')
    || quinnEReason.includes('meta_or_non_target_dps')
    || quinnEReason.includes('zero listeners')
    || !quinnEReason.includes('4024768')
    || !quinnEReason.includes(
      '9f6baba1d062b473d41586cd8323f31bd7c1c4d865db134a783c19ae998e7714',
    )
    || !quinnEReason.includes('317ac3ccf31e53ba17255dbb15c856ba5499d9257fbe0c9faa91b43f8438e24b')
    || !quinnEReason.includes('Template:Data Quinn/E')
    || !quinnEReason.includes('Template:Data Quinn/Vault')
    || !quinnEReason.includes('page1308957')
    || !quinnEReason.includes('bytes2649')
    || !quinnEReason.includes('2026-06-03T00:51:11Z')
    || !quinnEReason.includes(quinnEBoundary)
    || !quinnEReason.includes('nested binary')
    || !quinnEReason.includes('source.attr.ad.resolved')
    || !quinnEReason.includes('source.attr.ad.base')
    || !quinnEReason.includes('140')
    || !quinnEReason.includes('0.20')
    || !quinnEReason.includes('50 mana')
    || !quinnEReason.includes('8000')
    || !quinnEReason.includes('baseAD59')
    || !quinnEReason.includes('resolvedAD139')
    || !quinnEReason.includes('raw156')
    || !quinnEReason.includes('mitigated78')
    || !quinnEReason.includes('raw140')
    || !quinnEReason.includes('mitigated70')
    || !quinnEReason.includes('t7999')
    || !quinnEReason.includes('mana150')
    || !quinnEReason.includes('mana49')
    || !quinnEReason.includes('distance multiplier')
    || !quinnEReason.includes('dash prose')
    || !quinnEReason.includes('basic_attack_hit')
    || !quinnEReason.includes('Quinn W')
    || !quinnEReason.includes('ability_started')
    || !quinnEReason.includes('不宣称全局零事件')
    || !quinnEReason.includes('dash')
    || !quinnEReason.includes('Harrier')
    || !quinnEReason.includes('不宣称')
    || !String(quinnE.sourceRef || '').includes('quinn-e.json')
    || !String(quinnE.sourceRef || '').includes(
      '9f6baba1d062b473d41586cd8323f31bd7c1c4d865db134a783c19ae998e7714',
    )
    || quinnE.auditBaseline?.gapCode !== 'blocked_data'
    || quinnE.auditBaseline?.resolvedBucket !== 'blocked'
    || !(quinnE.auditBaseline?.mechanismTags || []).includes('distance_based_damage_modifier')
    || quinnE.classification !== 'needs_runtime_extension'
    || !(quinnE.mechanismTags || []).includes('distance_based_damage_modifier')
    || citesForbiddenProvenance(quinnE.classificationReason)
    || !(quinnE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.quinnVaultPrimaryHit
        && e.taskKey === 'wasm-generic-quinn-vault-primary-hit'
        && String(e.note || '').includes(quinnEBoundary)
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('no distance multiplier')
        && String(e.note || '').includes('basic_attack_hit')
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('bfe9e5b')
        && !String(e.note || '').includes('zero listeners'),
    )
    || !(quinnE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.quinnVaultPrimaryHitBackend
        && e.taskKey === 'wasm-generic-quinn-vault-primary-hit'
        && String(e.note || '').includes(quinnEBoundary)
        && String(e.note || '').includes('LolGenericQuinnVaultPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('README')
        && String(e.note || '').includes('c487eb4')
        && String(e.note || '').includes('3f698ab')
        && String(e.note || '').includes('bfe9e5b')
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('no Web change'),
    )
  ) {
    errors.push(
      'Quinn E must be migrated with empty remainingGap/missingFields, exact Vault ordered tags (no distance_or_ratio_modifier), stale distance/blocked_data/implementation-gap cleared while retaining raw classification/tags/auditBaseline provenance, Wiki rev4024768/SHA + local raw caveat + frozen completedBoundary, rank5 50mana/8000CD/nested-binary 140+0.20bonusAD numerics (baseAD59/resolvedAD139→raw156/78; baseline resolvedAD59→raw140/70; t0/t7999/t8000 mana150→50; mana49 skip), no-distance-multiplier/dash-prose override-before-fallback, no-basic_attack_hit/no-Quinn-W-arm/no-AS/may-synthesize-ability_started (not globally zero events), and bilateral wasm+backend evidence (owning c487eb4 / integrated 3f698ab / Wasm bfe9e5b; Web parity no change; no dash/tracking/bounce/knockback/slow/Harrier/live claim)',
    );
  }
  if (quinnE) {
    validateBilateralCoverageEvidence(
      quinnE.candidateKey,
      quinnE.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const quinnQ = records.find((r) => r.candidateKey === 'hero_skill|hero_quinn|Q|炫目攻势');
  const quinnQTags = [...(quinnQ?.genericMechanismTags || [])];
  const quinnQExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'ap_ratio',
    'bonus_ad_ratio',
    'immediate_impact_scaffold',
  ];
  const quinnQReason = String(quinnQ?.classificationReason || '');
  const quinnQBoundary =
    'rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_205_plus_1_00_bonus_ad_plus_0_50_ap; no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks';
  if (
    !quinnQ
    || quinnQ.candidateKey !== 'hero_skill|hero_quinn|Q|炫目攻势'
    || quinnQ.passiveName !== '炫目攻势'
    || quinnQ.genericClassification !== 'migrated'
    || String(quinnQ.remainingGap || '').trim()
    || (quinnQ.dataGapEvidence?.missingFields || []).length !== 0
    || quinnQTags.join('|') !== quinnQExpectedTags.join('|')
    || quinnQTags.includes('meta_or_non_target_dps')
    || quinnQTags.includes('dps_relevant_manual_review')
    || String(quinnQ.remainingGap || '').includes('blocked_data')
    || quinnQReason.includes('out_of_scope_for_single_target_dps')
    || quinnQReason.includes('blocked_data')
    || quinnQReason.includes('implementation_gap_no_unresolved_data_fields')
    || quinnQReason.includes('meta_or_non_target_dps')
    || quinnQReason.includes('zero listeners')
    || !quinnQReason.includes('4024766')
    || !quinnQReason.includes(
      'abce6abdc2eefd069beba2d4297a1c9da5b1a675a426edb747346d9679d8085d',
    )
    || !quinnQReason.includes('be8878560c7d6541440d952788e40aeba0bef25a49955379df26f45ec82737bd')
    || !quinnQReason.includes('Template:Data Quinn/Q')
    || !quinnQReason.includes('Template:Data Quinn/Blinding Assault')
    || !quinnQReason.includes('page1308954')
    || !quinnQReason.includes('bytes1742')
    || !quinnQReason.includes('2026-06-03T00:49:42Z')
    || !quinnQReason.includes(quinnQBoundary)
    || !quinnQReason.includes('nested binary')
    || !quinnQReason.includes('source.attr.ad.resolved')
    || !quinnQReason.includes('source.attr.ad.base')
    || !quinnQReason.includes('source.attr.ap.resolved')
    || !quinnQReason.includes('205')
    || !quinnQReason.includes('1.00')
    || !quinnQReason.includes('0.50')
    || !quinnQReason.includes('70 mana')
    || !quinnQReason.includes('9000')
    || !quinnQReason.includes('baseAD59')
    || !quinnQReason.includes('resolvedAD139')
    || !quinnQReason.includes('raw335')
    || !quinnQReason.includes('167.5')
    || !quinnQReason.includes('raw205')
    || !quinnQReason.includes('285')
    || !quinnQReason.includes('255')
    || !quinnQReason.includes('102.5')
    || !quinnQReason.includes('142.5')
    || !quinnQReason.includes('127.5')
    || !quinnQReason.includes('t8999')
    || !quinnQReason.includes('mana210')
    || !quinnQReason.includes('mana69')
    || !quinnQReason.includes('basic_attack_hit')
    || !quinnQReason.includes('Quinn W')
    || !quinnQReason.includes('ability_started')
    || !quinnQReason.includes('不宣称全局零事件')
    || !quinnQReason.includes('Valor')
    || !quinnQReason.includes('nearsight')
    || !quinnQReason.includes('disarm')
    || !quinnQReason.includes('不宣称')
    || !String(quinnQ.sourceRef || '').includes('quinn-q.json')
    || !String(quinnQ.sourceRef || '').includes(
      'abce6abdc2eefd069beba2d4297a1c9da5b1a675a426edb747346d9679d8085d',
    )
    || quinnQ.auditBaseline?.gapCode !== 'blocked_data'
    || quinnQ.auditBaseline?.resolvedBucket !== 'blocked'
    || !(quinnQ.auditBaseline?.mechanismTags || []).includes('meta_or_non_target_dps')
    || quinnQ.classification !== 'out_of_scope_for_single_target_dps'
    || !(quinnQ.mechanismTags || []).includes('meta_or_non_target_dps')
    || citesForbiddenProvenance(quinnQ.classificationReason)
    || !(quinnQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.quinnBlindingAssaultPrimaryHit
        && e.taskKey === 'wasm-generic-quinn-blinding-assault-primary-hit'
        && String(e.note || '').includes(quinnQBoundary)
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('basic_attack_hit')
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('ba71996')
        && !String(e.note || '').includes('zero listeners'),
    )
    || !(quinnQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.quinnBlindingAssaultPrimaryHitBackend
        && e.taskKey === 'wasm-generic-quinn-blinding-assault-primary-hit'
        && String(e.note || '').includes(quinnQBoundary)
        && String(e.note || '').includes('LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('README')
        && String(e.note || '').includes('5c174b5')
        && String(e.note || '').includes('e030cd9')
        && String(e.note || '').includes('ba71996')
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('no Web change'),
    )
  ) {
    errors.push(
      'Quinn Q must be migrated with empty remainingGap/missingFields, exact Blinding Assault ordered tags (no meta_or_non_target_dps), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw classification/tags/auditBaseline provenance, Wiki rev4024766/SHA + local raw caveat + frozen completedBoundary, rank5 70mana/9000CD/nested-binary 205+1.00bonusAD+0.50AP numerics (baseAD59/resolvedAD139/AP100→raw335/167.5; branches 205/285/255/335 + 102.5/142.5/127.5/167.5; t0/t8999/t9000 mana210→70; mana69 skip), no-basic_attack_hit/no-Quinn-W-arm/no-AS/may-synthesize-ability_started (not globally zero events), and bilateral wasm+backend evidence (owning 5c174b5 / integrated e030cd9 / Wasm ba71996; Web parity no change; no Valor/projectile/Harrier/nearsight/disarm/live claim)',
    );
  }
  if (quinnQ) {
    validateBilateralCoverageEvidence(
      quinnQ.candidateKey,
      quinnQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const quinnW = records.find((r) => r.candidateKey === 'hero_skill|hero_quinn|W|敏锐感知');
  if (
    !quinnW
    || quinnW.genericClassification !== 'migrated'
    || String(quinnW.remainingGap || '').trim()
    || !String(quinnW.classificationReason || '').includes('80%')
    || !String(quinnW.classificationReason || '').includes('harrier')
    || String(quinnW.classificationReason || '').includes('+40%')
    || citesForbiddenProvenance(quinnW.classificationReason)
    || !(quinnW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.quinnHeightenedSenses,
    )
    || !(quinnW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.quinnHeightenedSensesBackend,
    )
  ) {
    errors.push(
      'Quinn W must be migrated with empty remainingGap, Wiki rank-5 +80% AS wording, and bilateral wasm+backend evidence',
    );
  }
  if (quinnW) {
    validateBilateralCoverageEvidence(
      quinnW.candidateKey,
      quinnW.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const kogmawQ = records.find((r) => r.candidateKey === 'hero_skill|hero_kogmaw|Q|腐蚀唾液');
  if (
    !kogmawQ
    || kogmawQ.genericClassification !== 'migrated'
    || String(kogmawQ.remainingGap || '').trim()
    || !String(kogmawQ.classificationReason || '').includes('3960434')
    || !String(kogmawQ.classificationReason || '').includes('0.90')
    || !String(kogmawQ.classificationReason || '').includes('32%')
    || citesForbiddenProvenance(kogmawQ.classificationReason)
    || !(kogmawQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.kogmawCausticSpittle,
    )
    || !(kogmawQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.kogmawCausticSpittleBackend,
    )
  ) {
    errors.push(
      'KogMaw Q must be migrated with empty remainingGap, Wiki rev3960434 rank5 active+passive wording, and bilateral wasm+backend evidence',
    );
  }
  if (kogmawQ) {
    validateBilateralCoverageEvidence(
      kogmawQ.candidateKey,
      kogmawQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const kogmawE = records.find((r) => r.candidateKey === 'hero_skill|hero_kogmaw|E|虚空淤泥');
  const kogmawETags = [...(kogmawE?.genericMechanismTags || [])].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  const kogmawEExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  if (
    !kogmawE
    || kogmawE.genericClassification !== 'migrated'
    || String(kogmawE.remainingGap || '').trim()
    || (kogmawE.dataGapEvidence?.missingFields || []).length !== 0
    || kogmawETags.join('|') !== kogmawEExpectedTags.join('|')
    || kogmawETags.includes('multi_target_or_area')
    || String(kogmawE.remainingGap || '').includes('blocked_data')
    || String(kogmawE.classificationReason || '').includes('out_of_scope_for_single_target_dps')
    || String(kogmawE.classificationReason || '').includes('blocked_data')
    || String(kogmawE.classificationReason || '').includes(
      'implementation_gap_no_unresolved_data_fields',
    )
    || !String(kogmawE.classificationReason || '').includes('3965135')
    || !String(kogmawE.classificationReason || '').includes(
      '1dd448ea1985237f002dec43e2bf93d860eb976f7c98e75883254cb3cf70794b',
    )
    || !String(kogmawE.classificationReason || '').includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration',
    )
    || !String(kogmawE.classificationReason || '').includes('230')
    || !String(kogmawE.classificationReason || '').includes('0.65')
    || !String(kogmawE.classificationReason || '').includes('100 mana')
    || !String(kogmawE.classificationReason || '').includes('12000')
    || !String(kogmawE.classificationReason || '').includes('raw295')
    || !String(kogmawE.classificationReason || '').includes('147.5')
    || !String(kogmawE.classificationReason || '').includes('125')
    || !String(kogmawE.classificationReason || '').includes('Effect at cast time start')
    || !String(kogmawE.classificationReason || '').includes('不宣称')
    || !String(kogmawE.sourceRef || '').includes('kogmaw-e.json')
    || citesForbiddenProvenance(kogmawE.classificationReason)
    || !(kogmawE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.kogmawVoidOozePrimaryHit
        && e.taskKey === 'wasm-generic-kogmaw-void-ooze-primary-hit'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration',
        ),
    )
    || !(kogmawE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.kogmawVoidOozePrimaryHitBackend
        && e.taskKey === 'wasm-generic-kogmaw-void-ooze-primary-hit'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration',
        )
        && String(e.note || '').includes('LolGenericKogmawVoidOozePrimaryHitSeedSqlTest'),
    )
  ) {
    errors.push(
      "Kog'Maw E must be migrated with empty remainingGap/missingFields, exact Void Ooze tags, stale multi_target_or_area/blocked_data/out_of_scope/implementation-gap cleared, Wiki rev3965135/SHA + frozen completedBoundary, numeric contract/100mana/12000CD/AP100→295/MR100→147.5/mana125, cast-time-start scaffold relation, and bilateral wasm+backend evidence (no line/area/field/slow/projectile fidelity claim)",
    );
  }
  if (kogmawE) {
    validateBilateralCoverageEvidence(
      kogmawE.candidateKey,
      kogmawE.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const kogmawR = records.find((r) => r.candidateKey === 'hero_skill|hero_kogmaw|R|活体大炮');
  const kogmawRTags = [...(kogmawR?.genericMechanismTags || [])];
  const kogmawRExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'bonus_ad_and_ap_ratio',
    'missing_health_damage_multiplier',
    'stack_escalating_mana_cost',
    'timed_provider_state',
  ];
  const kogmawRReason = String(kogmawR?.classificationReason || '');
  const kogmawRBoundary =
    'rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth';
  if (
    !kogmawR
    || kogmawR.candidateKey !== 'hero_skill|hero_kogmaw|R|活体大炮'
    || kogmawR.passiveName !== '活体大炮'
    || kogmawR.genericClassification !== 'migrated'
    || String(kogmawR.remainingGap || '').trim()
    || (kogmawR.dataGapEvidence?.missingFields || []).length !== 0
    || kogmawRTags.join('|') !== kogmawRExpectedTags.join('|')
    || kogmawRTags.includes('meta_or_non_target_dps')
    || kogmawRTags.includes('dps_relevant_manual_review')
    || String(kogmawR.remainingGap || '').includes('blocked_data')
    || kogmawRReason.includes('out_of_scope_for_single_target_dps')
    || kogmawRReason.includes('blocked_data')
    || kogmawRReason.includes('implementation_gap_no_unresolved_data_fields')
    || kogmawRReason.includes('meta_or_non_target_dps')
    || !kogmawRReason.includes('4007636')
    || !kogmawRReason.includes(
      '32f8dd8d875aaf95cec2be9cfe4a5a5526881b956f2f23e06ab87dc331ca8641',
    )
    || !kogmawRReason.includes('11db6c16391dcbfa2c091e81399bff4b2a0abffcd468f71ea5e9d89759d5e447')
    || !kogmawRReason.includes("Template:Data Kog'Maw/R")
    || !kogmawRReason.includes("Template:Data Kog'Maw/Living Artillery")
    || !kogmawRReason.includes('page1307963')
    || !kogmawRReason.includes('bytes2453')
    || !kogmawRReason.includes('bytes2452')
    || !kogmawRReason.includes(kogmawRBoundary)
    || !kogmawRReason.includes('40*(1+living_artillery_stacks)')
    || !kogmawRReason.includes('1000ms')
    || !kogmawRReason.includes('zero listeners')
    || !kogmawRReason.includes('ability-start')
    || !kogmawRReason.includes('180')
    || !kogmawRReason.includes('0.75')
    || !kogmawRReason.includes('0.45')
    || !kogmawRReason.includes('base285')
    || !kogmawRReason.includes('142.5')
    || !kogmawRReason.includes('427.5')
    || !kogmawRReason.includes('213.75')
    || !kogmawRReason.includes('570')
    || !kogmawRReason.includes('t999')
    || !kogmawRReason.includes('mana380')
    || !kogmawRReason.includes('mana79')
    || !kogmawRReason.includes('2200')
    || !kogmawRReason.includes('8000ms')
    || !kogmawRReason.includes('0.6s delay')
    || !kogmawRReason.includes('不宣称')
    || !String(kogmawR.sourceRef || '').includes('kogmaw-r.json')
    || !String(kogmawR.sourceRef || '').includes(
      '32f8dd8d875aaf95cec2be9cfe4a5a5526881b956f2f23e06ab87dc331ca8641',
    )
    || citesForbiddenProvenance(kogmawR.classificationReason)
    || !(kogmawR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.kogmawLivingArtillery
        && e.taskKey === 'wasm-generic-kogmaw-living-artillery'
        && String(e.note || '').includes(kogmawRBoundary)
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('d58370a'),
    )
    || !(kogmawR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.kogmawLivingArtilleryProviderStateCostGate
        && e.taskKey === 'wasm-generic-kogmaw-living-artillery'
        && String(e.note || '').includes(kogmawRBoundary)
        && String(e.note || '').includes('provider-aware')
        && String(e.note || '').includes('d58370a'),
    )
    || !(kogmawR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.kogmawLivingArtilleryBackend
        && e.taskKey === 'wasm-generic-kogmaw-living-artillery'
        && String(e.note || '').includes(kogmawRBoundary)
        && String(e.note || '').includes('LolGenericKogmawLivingArtillerySeedSqlTest')
        && String(e.note || '').includes('100679a')
        && String(e.note || '').includes('473bd50')
        && String(e.note || '').includes('175b03a')
        && String(e.note || '').includes('d563b67')
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('do not endorse')
        && String(e.note || '').includes('d58370a')
        && String(e.note || '').includes('38b9229'),
    )
  ) {
    errors.push(
      "Kog'Maw R must be migrated with empty remainingGap/missingFields, exact Living Artillery ordered tags (no meta_or_non_target_dps), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw classification/tags/auditBaseline provenance, Wiki rev4007636/SHA + local raw caveat + frozen completedBoundary, rank3 mana40*(1+stacks)/1000CD/nested-binary 180+0.75bonusAD+0.45AP missing-HP multiplier numerics (base285; 1000→285/142.5; 400→427.5/213.75; 399→570/285; t0/t999/t1000; mana380/79; cap9/2200; 8000ms), and bilateral wasm+backend evidence (owning 100679a+473bd50 / integrated 175b03a+d563b67 / Wasm d58370a + provider cost gate; Web 38b9229 artifact-only; no delay/location/geometry/multitarget/sight/reveal/stealth/live claim)",
    );
  }
  if (kogmawR) {
    validateBilateralCoverageEvidence(
      kogmawR.candidateKey,
      kogmawR.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const kaisaW = records.find((r) => r.candidateKey === 'hero_skill|hero_kaisa|W|虚空索敌');
  const kaisaWTags = [...(kaisaW?.genericMechanismTags || [])].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  const kaisaWExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const kaisaWReason = String(kaisaW?.classificationReason || '');
  if (
    !kaisaW
    || kaisaW.genericClassification !== 'migrated'
    || String(kaisaW.remainingGap || '').trim()
    || (kaisaW.dataGapEvidence?.missingFields || []).length !== 0
    || kaisaWTags.join('|') !== kaisaWExpectedTags.join('|')
    || kaisaWTags.includes('meta_or_non_target_dps')
    || kaisaWTags.includes('bonus_ad_ratio')
    || kaisaWTags.includes('total_ad_ratio')
    || String(kaisaW.remainingGap || '').includes('blocked_data')
    || kaisaWReason.includes('out_of_scope_for_single_target_dps')
    || kaisaWReason.includes('blocked_data')
    || kaisaWReason.includes('implementation_gap_no_unresolved_data_fields')
    || kaisaWReason.includes('meta_or_non_target_dps')
    || kaisaWReason.includes('bonus_ad_ratio')
    || kaisaWReason.includes('ad.resolved-ad.base')
    || kaisaWReason.includes('ad.resolved-source.attr.ad.base')
    || !kaisaWReason.includes('4034696')
    || !kaisaWReason.includes(
      'aa4ba76c6fa345c711651fa56d9b914d4ea8b7eb3ddfae79d7feb25470d7e3d1',
    )
    || !kaisaWReason.includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund',
    )
    || !kaisaWReason.includes('source.attr.ad.resolved')
    || !kaisaWReason.includes('totalAD100')
    || !kaisaWReason.includes('130')
    || !kaisaWReason.includes('1.30')
    || !kaisaWReason.includes('0.45')
    || !kaisaWReason.includes('75 mana')
    || !kaisaWReason.includes('14000')
    || !kaisaWReason.includes('raw305')
    || !kaisaWReason.includes('152.5')
    || !kaisaWReason.includes('195')
    || !kaisaWReason.includes('695')
    || !kaisaWReason.includes('Effect at cast time end')
    || !kaisaWReason.includes('0.4s cast')
    || !kaisaWReason.includes('不宣称')
    || !String(kaisaW.sourceRef || '').includes('kaisa-w.json')
    || citesForbiddenProvenance(kaisaW.classificationReason)
    || !(kaisaW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.kaisaVoidSeekerPrimaryHit
        && e.taskKey === 'wasm-generic-kaisa-void-seeker-primary-hit'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund',
        )
        && String(e.note || '').includes('source.attr.ad.resolved')
        && String(e.note || '').includes('0.4s cast'),
    )
    || !(kaisaW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.kaisaVoidSeekerPrimaryHitBackend
        && e.taskKey === 'wasm-generic-kaisa-void-seeker-primary-hit'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund',
        )
        && String(e.note || '').includes('LolGenericKaisaVoidSeekerPrimaryHitSeedSqlTest'),
    )
  ) {
    errors.push(
      "Kai'Sa W must be migrated with empty remainingGap/missingFields, exact Void Seeker tags (no meta_or_non_target_dps/bonus_ad_ratio/total_ad_ratio), stale blocked_data/out_of_scope/implementation-gap cleared, Wiki rev4034696/SHA + frozen completedBoundary, total AD via source.attr.ad.resolved (not bonus AD), numeric contract/75mana/14000CD/totalAD100+AP100→305/MR100→152.5/mana195/HP695, cast-end exclusion scaffold wording, and bilateral wasm+backend evidence (no cast/projectile/sight/reveal/Plasma/evolution/refund fidelity claim)",
    );
  }
  if (kaisaW) {
    validateBilateralCoverageEvidence(
      kaisaW.candidateKey,
      kaisaW.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const varusW = records.find((r) => r.candidateKey === 'hero_skill|hero_varus|W|枯萎箭袋');
  const varusWTags = [...(varusW?.genericMechanismTags || [])].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  const varusWExpectedTags = [
    'active_missing_health',
    'passive_on_hit_magic',
    'target_blight_stack_consume',
    'w_scoped_max_charge_carrier',
  ];
  if (
    !varusW
    || varusW.genericClassification !== 'migrated'
    || String(varusW.remainingGap || '').trim()
    || varusWTags.join('|') !== varusWExpectedTags.join('|')
    || !String(varusW.classificationReason || '').includes('4026472')
    || !String(varusW.classificationReason || '').includes(
      '16307174c4039d8ce71e639396328b2473f4a7e16247a7b2f8a183599b0901d2',
    )
    || !String(varusW.classificationReason || '').includes(
      'fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop',
    )
    || !String(varusW.classificationReason || '').includes('不宣称真实 Q')
    || citesForbiddenProvenance(varusW.classificationReason)
    || !(varusW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.varusBlightedQuiver
        && e.taskKey === 'wasm-generic-varus-blighted-quiver'
        && String(e.note || '').includes(
          'fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop',
        ),
    )
    || !(varusW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.varusBlightedQuiverBackend
        && e.taskKey === 'wasm-generic-varus-blighted-quiver'
        && String(e.note || '').includes(
          'fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop',
        ),
    )
  ) {
    errors.push(
      'Varus W must be migrated with empty remainingGap, exact blight tags, Wiki rev4026472/SHA + frozen completedBoundary, and bilateral wasm+backend evidence (no real-Q/full-game claim)',
    );
  }
  if (varusW) {
    validateBilateralCoverageEvidence(
      varusW.candidateKey,
      varusW.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const varusE = records.find((r) => r.candidateKey === 'hero_skill|hero_varus|E|恶灵箭雨');
  const varusETags = [...(varusE?.genericMechanismTags || [])].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  const varusEExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'bonus_ad_ratio',
    'immediate_impact_scaffold',
  ];
  if (
    !varusE
    || varusE.genericClassification !== 'migrated'
    || String(varusE.remainingGap || '').trim()
    || (varusE.dataGapEvidence?.missingFields || []).length !== 0
    || varusETags.join('|') !== varusEExpectedTags.join('|')
    || varusETags.includes('survivability_only')
    || String(varusE.remainingGap || '').includes('blocked_data')
    || String(varusE.classificationReason || '').includes('out_of_scope_for_single_target_dps')
    || String(varusE.classificationReason || '').includes('blocked_data')
    || String(varusE.classificationReason || '').includes(
      'implementation_gap_no_unresolved_data_fields',
    )
    || !String(varusE.classificationReason || '').includes('3969402')
    || !String(varusE.classificationReason || '').includes(
      '7b4be71bcc26ba933dff0235882d272c14e406abbf505290018ba15a5ba658e9',
    )
    || !String(varusE.classificationReason || '').includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation',
    )
    || !String(varusE.classificationReason || '').includes('physical')
    || !String(varusE.classificationReason || '').includes('180')
    || !String(varusE.classificationReason || '').includes('0.90')
    || !String(varusE.classificationReason || '').includes('90 mana')
    || !String(varusE.classificationReason || '').includes('10000')
    || !String(varusE.classificationReason || '').includes('baseAD59')
    || !String(varusE.classificationReason || '').includes('resolvedAD159')
    || !String(varusE.classificationReason || '').includes('raw270')
    || !String(varusE.classificationReason || '').includes('mitigated135')
    || !String(varusE.classificationReason || '').includes('140')
    || !String(varusE.classificationReason || '').includes('damagetype=Magic')
    || !String(varusE.classificationReason || '').includes('矛盾')
    || !String(varusE.classificationReason || '').includes('0.5s landing delay')
    || !String(varusE.classificationReason || '').includes('不宣称')
    || !String(varusE.sourceRef || '').includes('varus-e.json')
    || citesForbiddenProvenance(varusE.classificationReason)
    || !(varusE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.varusHailOfArrowsPrimaryHit
        && e.taskKey === 'wasm-generic-varus-hail-of-arrows-primary-hit'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation',
        )
        && String(e.note || '').includes('damagetype=Magic')
        && String(e.note || '').includes('0.5s landing delay'),
    )
    || !(varusE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.varusHailOfArrowsPrimaryHitBackend
        && e.taskKey === 'wasm-generic-varus-hail-of-arrows-primary-hit'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation',
        )
        && String(e.note || '').includes('LolGenericVarusHailOfArrowsPrimaryHitSeedSqlTest'),
    )
  ) {
    errors.push(
      'Varus E must be migrated with empty remainingGap/missingFields, exact Hail of Arrows tags, stale survivability_only/blocked_data/out_of_scope/implementation-gap cleared, Wiki rev3969402/SHA + frozen completedBoundary, description+rank-table physical authority with explicit isolated-Magic contradiction disclosure (not runtime truth), numeric contract/90mana/10000CD/baseAD59→159/raw270/armor100→135/mana140, 0.5s landing-delay exclusion wording, and bilateral wasm+backend evidence (no delay/area/field/control/W-detonation fidelity claim)',
    );
  }
  if (varusE) {
    validateBilateralCoverageEvidence(
      varusE.candidateKey,
      varusE.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const varusR = records.find((r) => r.candidateKey === 'hero_skill|hero_varus|R|腐败锁链');
  const varusRTags = [...(varusR?.genericMechanismTags || [])];
  const varusRExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const varusRReason = String(varusR?.classificationReason || '');
  if (
    !varusR
    || varusR.genericClassification !== 'migrated'
    || String(varusR.remainingGap || '').trim()
    || (varusR.dataGapEvidence?.missingFields || []).length !== 0
    || varusRTags.join('|') !== varusRExpectedTags.join('|')
    || varusRTags.includes('multi_target_or_area')
    || String(varusR.remainingGap || '').includes('blocked_data')
    || varusRReason.includes('out_of_scope_for_single_target_dps')
    || varusRReason.includes('blocked_data')
    || varusRReason.includes('implementation_gap_no_unresolved_data_fields')
    || varusRReason.includes('multi_target_or_area')
    || !varusRReason.includes('4008213')
    || !varusRReason.includes(
      '62b397cc7133a767427e00a1a5b435fcb3fd94b4ec5021be4a7869837683e4ed',
    )
    || !varusRReason.includes(
      'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget',
    )
    || !varusRReason.includes('source.attr.ap.resolved')
    || !varusRReason.includes('350')
    || !varusRReason.includes('1.00')
    || !varusRReason.includes('100 mana')
    || !varusRReason.includes('60000')
    || !varusRReason.includes('raw550')
    || !varusRReason.includes('275')
    || !varusRReason.includes('300')
    || !varusRReason.includes('450')
    || !varusRReason.includes('Effect at cast time end')
    || !varusRReason.includes('0.65')
    || !varusRReason.includes('1.2')
    || !varusRReason.includes('1.75')
    || !varusRReason.includes('Batch-B identity/AP check-only')
    || !varusRReason.includes('mana320/320')
    || !varusRReason.includes('games/game_entities/attribute_definitions/entity_attribute_values')
    || !varusRReason.includes('不宣称')
    || !String(varusR.sourceRef || '').includes('varus-r.json')
    || varusR.classification !== 'out_of_scope_for_single_target_dps'
    || !(varusR.mechanismTags || []).includes('multi_target_or_area')
    || varusR.auditBaseline?.gapCode !== 'blocked_data'
    || varusR.auditBaseline?.resolvedBucket !== 'blocked'
    || !(varusR.auditBaseline?.mechanismTags || []).includes('multi_target_or_area')
    || citesForbiddenProvenance(varusR.classificationReason)
    || !(varusR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.varusChainOfCorruptionPrimaryHit
        && e.taskKey === 'wasm-generic-varus-chain-of-corruption-primary-hit'
        && String(e.note || '').includes(
          'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget',
        )
        && String(e.note || '').includes('Effect at cast time end')
        && String(e.note || '').includes('raw550'),
    )
    || !(varusR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.varusChainOfCorruptionPrimaryHitBackend
        && e.taskKey === 'wasm-generic-varus-chain-of-corruption-primary-hit'
        && String(e.note || '').includes(
          'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget',
        )
        && String(e.note || '').includes('LolGenericVarusChainOfCorruptionPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('067b0f8')
        && String(e.note || '').includes('982145c')
        && String(e.note || '').includes('74f3b22')
        && String(e.note || '').includes('Batch-B identity/AP check-only')
        && String(e.note || '').includes('mana320/320')
        && String(e.note || '').includes(
          'games/game_entities/attribute_definitions/entity_attribute_values',
        ),
    )
  ) {
    errors.push(
      'Varus R must be migrated with empty remainingGap/missingFields, exact Chain of Corruption tags (no multi_target_or_area), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw classification/tags/auditBaseline provenance, Wiki rev4008213/SHA + frozen completedBoundary, numeric contract/100mana/60000CD/AP200→raw550/MR100→275/mana100/HP450, cast-end/root/reveal/Blight/tendril/seek/spread/multitarget exclusions, Batch-B identity/AP check-only + self-contained mana320/320 ensure (no games/game_entities/attribute_definitions/entity_attribute_values writes), and bilateral wasm+backend evidence (owning 067b0f8 / integrated 982145c / Wasm 74f3b22; no cast/projectile/geometry/direction/root/reveal/Blight/tendril fidelity claim)',
    );
  }
  if (varusR) {
    validateBilateralCoverageEvidence(
      varusR.candidateKey,
      varusR.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const twistedFateQ = records.find(
    (r) => r.candidateKey === 'hero_skill|hero_twistedfate|Q|万能牌',
  );
  const twistedFateQTags = [...(twistedFateQ?.genericMechanismTags || [])];
  const twistedFateQExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'bonus_ad_ratio',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const twistedFateQReason = String(twistedFateQ?.classificationReason || '');
  if (
    !twistedFateQ
    || twistedFateQ.genericClassification !== 'migrated'
    || String(twistedFateQ.remainingGap || '').trim()
    || (twistedFateQ.dataGapEvidence?.missingFields || []).length !== 0
    || twistedFateQTags.join('|') !== twistedFateQExpectedTags.join('|')
    || twistedFateQTags.includes('dps_relevant_manual_review')
    || String(twistedFateQ.remainingGap || '').includes('blocked_data')
    || twistedFateQReason.includes('out_of_scope_for_single_target_dps')
    || twistedFateQReason.includes('blocked_data')
    || twistedFateQReason.includes('implementation_gap_no_unresolved_data_fields')
    || twistedFateQReason.includes('dps_relevant_manual_review')
    || !twistedFateQReason.includes('3950864')
    || !twistedFateQReason.includes(
      '9cdd62cc18d41a4bbe1e42ac8202b40a776f7da51c67c6f2fea37f9ed1f0d597',
    )
    || !twistedFateQReason.includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget',
    )
    || !twistedFateQReason.includes('source.attr.ad.resolved-source.attr.ad.base')
    || !twistedFateQReason.includes('baseAD52')
    || !twistedFateQReason.includes('resolvedAD100')
    || !twistedFateQReason.includes('240')
    || !twistedFateQReason.includes('0.50')
    || !twistedFateQReason.includes('0.85')
    || !twistedFateQReason.includes('100 mana')
    || !twistedFateQReason.includes('5000')
    || !twistedFateQReason.includes('raw349')
    || !twistedFateQReason.includes('174.5')
    || !twistedFateQReason.includes('133')
    || !twistedFateQReason.includes('651')
    || !twistedFateQReason.includes('once-per-pass')
    || !twistedFateQReason.includes('cast0.25')
    || !twistedFateQReason.includes('Effect at cast time end')
    || !twistedFateQReason.includes('fan')
    || !twistedFateQReason.includes('range1450')
    || !twistedFateQReason.includes('不宣称')
    || !String(twistedFateQ.sourceRef || '').includes('twistedfate-q.json')
    || citesForbiddenProvenance(twistedFateQ.classificationReason)
    || !(twistedFateQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.twistedFateWildCardsPrimaryHit
        && e.taskKey === 'wasm-generic-twisted-fate-wild-cards-primary-hit'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget',
        )
        && String(e.note || '').includes('once-per-pass')
        && String(e.note || '').includes('cast0.25'),
    )
    || !(twistedFateQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.twistedFateWildCardsPrimaryHitBackend
        && e.taskKey === 'wasm-generic-twisted-fate-wild-cards-primary-hit'
        && String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget',
        )
        && String(e.note || '').includes('LolGenericTwistedFateWildCardsPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('18b959e')
        && String(e.note || '').includes('a0da4f8')
        && String(e.note || '').includes('589db93'),
    )
  ) {
    errors.push(
      'Twisted Fate Q must be migrated with empty remainingGap/missingFields, exact Wild Cards tags (no dps_relevant_manual_review), stale blocked_data/out_of_scope/implementation-gap cleared, Wiki rev3950864/SHA + frozen completedBoundary, bonus-AD+AP formula/cost/CD/numeric schedule, once-per-pass as single-hit justification only, cast0.25/fan/cone/projectile exclusions, and bilateral wasm+backend evidence (owning 18b959e / integrated a0da4f8 / Wasm 589db93; no cast/fan/cone/projectile/pass fidelity claim)',
    );
  }
  if (twistedFateQ) {
    validateBilateralCoverageEvidence(
      twistedFateQ.candidateKey,
      twistedFateQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const xayahQ = records.find((r) => r.candidateKey === 'hero_skill|hero_xayah|Q|双刃');
  const xayahQTags = [...(xayahQ?.genericMechanismTags || [])];
  const xayahQExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'bonus_ad_ratio',
    'immediate_impact_scaffold',
  ];
  const xayahQReason = String(xayahQ?.classificationReason || '');
  const xayahQBoundary =
    'rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks';
  if (!EXACT_OVERRIDES.has('hero_xayah|Q')) {
    errors.push('Xayah Q exact override key hero_xayah|Q must exist before fallback');
  }
  if (
    !xayahQ
    || xayahQ.candidateKey !== 'hero_skill|hero_xayah|Q|双刃'
    || xayahQ.passiveName !== '双刃'
    || xayahQ.genericClassification !== 'migrated'
    || String(xayahQ.remainingGap || '').trim()
    || (xayahQ.dataGapEvidence?.missingFields || []).length !== 0
    || xayahQTags.join('|') !== xayahQExpectedTags.join('|')
    || xayahQTags.includes('dps_relevant_manual_review')
    || xayahQTags.includes('meta_or_non_target_dps')
    || String(xayahQ.remainingGap || '').includes('blocked_data')
    || xayahQReason.includes('out_of_scope_for_single_target_dps')
    || xayahQReason.includes('blocked_data')
    || xayahQReason.includes('implementation_gap_no_unresolved_data_fields')
    || xayahQReason.includes('dps_relevant_manual_review')
    || !xayahQReason.includes('4008615')
    || !xayahQReason.includes(
      '8010e567d2366730c5eb6cd0a31baec09c7f5137018ab2ca15fd84f167d990fd',
    )
    || !xayahQReason.includes('6a1fde0a18de0b6f28e55be7df27e58f99c91d49310e79ae81a9e95384f974de')
    || !xayahQReason.includes('Template:Data Xayah/Q')
    || !xayahQReason.includes('Template:Data Xayah/Double Daggers')
    || !xayahQReason.includes('page1324541')
    || !xayahQReason.includes('page1324536')
    || !xayahQReason.includes('rev2864045')
    || !xayahQReason.includes('bytes2615')
    || !xayahQReason.includes('2026-04-15T00:26:21Z')
    || !xayahQReason.includes(xayahQBoundary)
    || !xayahQReason.includes('nested binary')
    || !xayahQReason.includes('source.attr.ad.resolved')
    || !xayahQReason.includes('source.attr.ad.base')
    || !xayahQReason.includes('105')
    || !xayahQReason.includes('0.50')
    || !xayahQReason.includes('35 mana')
    || !xayahQReason.includes('8000')
    || !xayahQReason.includes('baseAD60')
    || !xayahQReason.includes('resolvedAD60')
    || !xayahQReason.includes('resolvedAD110')
    || !xayahQReason.includes('total210')
    || !xayahQReason.includes('total105')
    || !xayahQReason.includes('total260')
    || !xayahQReason.includes('total130')
    || !xayahQReason.includes('52.5')
    || !xayahQReason.includes('t7999')
    || !xayahQReason.includes('mana105')
    || !xayahQReason.includes('mana34')
    || !xayahQReason.includes('HP740')
    || !xayahQReason.includes('ability_started')
    || !xayahQReason.includes('does not arm W')
    || !xayahQReason.includes('AS stays baseline')
    || !xayahQReason.includes('ability/xayah_deadly_plumage')
    || !xayahQReason.includes('ability_id NULL')
    || !xayahQReason.includes('ListenerDefinition.AbilityRef')
    || !xayahQReason.includes('external existing-data/check-only')
    || !xayahQReason.includes('identity/panel/resource')
    || !xayahQReason.includes('不宣称')
    || !String(xayahQ.sourceRef || '').includes('xayah-q.json')
    || !String(xayahQ.sourceRef || '').includes(
      '8010e567d2366730c5eb6cd0a31baec09c7f5137018ab2ca15fd84f167d990fd',
    )
    || xayahQ.auditBaseline?.gapCode !== 'blocked_data'
    || xayahQ.auditBaseline?.resolvedBucket !== 'blocked'
    || xayahQ.auditBaseline?.damageDisposition !== 'not_applicable'
    || !(xayahQ.auditBaseline?.mechanismTags || []).includes('dps_relevant_manual_review')
    || xayahQ.classification !== 'needs_manual_baseline'
    || !(xayahQ.mechanismTags || []).includes('dps_relevant_manual_review')
    || citesForbiddenProvenance(xayahQ.classificationReason)
    || !(xayahQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.xayahDoubleDaggersPrimaryTwoHit
        && e.taskKey === 'wasm-generic-xayah-double-daggers-primary-two-hit'
        && String(e.note || '').includes(xayahQBoundary)
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('does not arm W')
        && String(e.note || '').includes('dd7dae6')
        && String(e.note || '').includes('6a1fde0a')
        && String(e.note || '').includes('page1324536'),
    )
    || !(xayahQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.xayahDoubleDaggersPrimaryTwoHitBackend
        && e.taskKey === 'wasm-generic-xayah-double-daggers-primary-two-hit'
        && String(e.note || '').includes(xayahQBoundary)
        && String(e.note || '').includes('LolGenericXayahDoubleDaggersPrimaryTwoHitSeedSqlTest')
        && String(e.note || '').includes('8ace954')
        && String(e.note || '').includes('6bab0b8')
        && String(e.note || '').includes('dd7dae6')
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('W isolation'),
    )
  ) {
    errors.push(
      'Xayah Q must be migrated with empty remainingGap/missingFields, exact Double Daggers ordered tags (no dps_relevant_manual_review), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw needs_manual_baseline/dps_relevant_manual_review/auditBaseline provenance, Wiki rev4008615/SHA + local raw caveat + live-redirect-not-sidecar + frozen completedBoundary, rank5 35mana/8000CD/two nested-binary 105+0.50bonusAD hits (baseAD60→each105/total210/52.5; resolvedAD110→each130/total260/65; t0/t7999/t8000 mana105→35/HP740 four damage/two ability_started; mana34 skip; W isolation/AS baseline/ability_id NULL/AbilityRef empty), and bilateral wasm+backend evidence (owning 8ace954 / integrated 6bab0b8 / Wasm dd7dae6; no cast-time/lockout/projectile/secondary-reduction/feather/ground/E/live claim)',
    );
  }
  if (xayahQ) {
    validateBilateralCoverageEvidence(
      xayahQ.candidateKey,
      xayahQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const xayahR = records.find((r) => r.candidateKey === 'hero_skill|hero_xayah|R|暴风羽刃');
  const xayahRTags = [...(xayahR?.genericMechanismTags || [])];
  const xayahRExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'bonus_ad_ratio',
    'immediate_impact_scaffold',
  ];
  const xayahRReason = String(xayahR?.classificationReason || '');
  const xayahRBoundary =
    'rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_xayah|R')) {
    errors.push('Xayah R exact override key hero_xayah|R must exist before fallback');
  }
  if (
    !xayahR
    || xayahR.candidateKey !== 'hero_skill|hero_xayah|R|暴风羽刃'
    || xayahR.passiveName !== '暴风羽刃'
    || xayahR.genericClassification !== 'migrated'
    || String(xayahR.remainingGap || '').trim()
    || (xayahR.dataGapEvidence?.missingFields || []).length !== 0
    || xayahRTags.join('|') !== xayahRExpectedTags.join('|')
    || xayahRTags.includes('dps_relevant_manual_review')
    || xayahRTags.includes('meta_or_non_target_dps')
    || String(xayahR.remainingGap || '').includes('blocked_data')
    || xayahRReason.includes('out_of_scope_for_single_target_dps')
    || xayahRReason.includes('blocked_data')
    || xayahRReason.includes('implementation_gap_no_unresolved_data_fields')
    || xayahRReason.includes('dps_relevant_manual_review')
    || !xayahRReason.includes('4008617')
    || !xayahRReason.includes(
      'cb5c8ba5486a55027e7c2252589fa8e5d821d346cc44afa99243de71ce5b3077',
    )
    || !xayahRReason.includes('debf23b0213a4d9669a29f6c415a6f67d582b7093d25059b7765745bed43ace1')
    || !xayahRReason.includes('Template:Data Xayah/R')
    || !xayahRReason.includes('Template:Data Xayah/Featherstorm')
    || !xayahRReason.includes('page1324544')
    || !xayahRReason.includes('bytes1761')
    || !xayahRReason.includes('2026-04-15T00:26:44Z')
    || !xayahRReason.includes(xayahRBoundary)
    || !xayahRReason.includes('source.attr.ad.resolved')
    || !xayahRReason.includes('source.attr.ad.base')
    || !xayahRReason.includes('400')
    || !xayahRReason.includes('1.00')
    || !xayahRReason.includes('100 mana')
    || !xayahRReason.includes('100000')
    || !xayahRReason.includes('baseAD60')
    || !xayahRReason.includes('resolvedAD60')
    || !xayahRReason.includes('resolvedAD110')
    || !xayahRReason.includes('raw400')
    || !xayahRReason.includes('raw450')
    || !xayahRReason.includes('armor0=400')
    || !xayahRReason.includes('armor100=200')
    || !xayahRReason.includes('armor0=450')
    || !xayahRReason.includes('armor100=225')
    || !xayahRReason.includes('t99999')
    || !xayahRReason.includes('t100000')
    || !xayahRReason.includes('mana300')
    || !xayahRReason.includes('mana99')
    || !xayahRReason.includes('HP550')
    || !xayahRReason.includes('ability_started')
    || !xayahRReason.includes('never arm W')
    || !xayahRReason.includes('W self-cast arms W')
    || !xayahRReason.includes('one quantum')
    || !xayahRReason.includes('two hits')
    || !xayahRReason.includes('ability/xayah_deadly_plumage')
    || !xayahRReason.includes('ability_id NULL')
    || !xayahRReason.includes('ListenerDefinition.AbilityRef')
    || !xayahRReason.includes('external existing-data/check-only')
    || !xayahRReason.includes('Q optional')
    || !xayahRReason.includes('identity/panel/resource')
    || !xayahRReason.includes('不宣称')
    || !xayahRReason.includes('no equivalence or contradiction claim')
    || xayahRReason.includes('canonical byte equivalence')
    || xayahRReason.includes('Wiki proves the full R is once-only')
    || xayahRReason.includes('complete Featherstorm has one total hit')
    || xayahRReason.includes('five damage ops')
    || !String(xayahR.sourceRef || '').includes('xayah-r.json')
    || !String(xayahR.sourceRef || '').includes(
      'cb5c8ba5486a55027e7c2252589fa8e5d821d346cc44afa99243de71ce5b3077',
    )
    || xayahR.auditBaseline?.gapCode !== 'blocked_data'
    || xayahR.auditBaseline?.resolvedBucket !== 'blocked'
    || xayahR.auditBaseline?.damageDisposition !== 'not_applicable'
    || !(xayahR.auditBaseline?.mechanismTags || []).includes('dps_relevant_manual_review')
    || xayahR.classification !== 'needs_manual_baseline'
    || !(xayahR.mechanismTags || []).includes('dps_relevant_manual_review')
    || citesForbiddenProvenance(xayahR.classificationReason)
    || !(xayahR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.xayahFeatherstormPrimaryHit
        && e.taskKey === 'wasm-generic-xayah-featherstorm-primary-hit'
        && String(e.note || '').includes(xayahRBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('never arm W')
        && String(e.note || '').includes('57ec17c')
        && String(e.note || '').includes('debf23b0')
        && String(e.note || '').includes('no claim Wiki proves'),
    )
    || !(xayahR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.xayahFeatherstormPrimaryHitBackend
        && e.taskKey === 'wasm-generic-xayah-featherstorm-primary-hit'
        && String(e.note || '').includes(xayahRBoundary)
        && String(e.note || '').includes('LolGenericXayahFeatherstormPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('354fd287')
        && String(e.note || '').includes('741e1ff')
        && String(e.note || '').includes('57ec17c')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('Q optional')
        && String(e.note || '').includes('W isolation'),
    )
  ) {
    errors.push(
      'Xayah R must be migrated with empty remainingGap/missingFields, exact Featherstorm ordered tags (no dps_relevant_manual_review), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw needs_manual_baseline/dps_relevant_manual_review/auditBaseline provenance, Wiki rev4008617/SHA + local raw caveat + frozen completedBoundary, rank3 100mana/100000CD/one quantum 400+1.00bonusAD (baseAD60→raw400/200; resolvedAD110→raw450/225; t0/t99999/t100000 mana300→100/HP550 two damage/two ability_started; mana99 skip; W/Q/R isolation/ability_id NULL/AbilityRef empty), semantic framing (no Wiki-proven once-only / no five ops / no same-target multi-feather), and bilateral wasm+backend evidence (owning 354fd287 / integrated 741e1ff / Wasm 57ec17c; no leap/ghosted/delay/lockout/projectile/feather/ground/E/live claim)',
    );
  }
  if (xayahR) {
    validateBilateralCoverageEvidence(
      xayahR.candidateKey,
      xayahR.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const xayahW = records.find((r) => r.candidateKey === 'hero_skill|hero_xayah|W|致死羽衣');
  if (
    !xayahW
    || xayahW.genericClassification !== 'migrated'
    || String(xayahW.remainingGap || '').trim()
    || !String(xayahW.classificationReason || '').includes('4010669')
    || !String(xayahW.classificationReason || '').includes(
      '09d5476533722311e85c4ca79813cd0bec2cf35d105be894b80dac14478845a7',
    )
    || !String(xayahW.classificationReason || '').includes('1.25')
    || !String(xayahW.classificationReason || '').includes('25%')
    || String(xayahW.classificationReason || '').includes('20%')
    || !String(xayahW.sourceRef || '').includes('xayah-w.json')
    || citesForbiddenProvenance(xayahW.classificationReason)
    || !(xayahW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.xayahDeadlyPlumage,
    )
    || !(xayahW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.xayahDeadlyPlumageBackend,
    )
  ) {
    errors.push(
      'Xayah W must be migrated with empty remainingGap, Wiki rev4010669/SHA Phase-A 25%/1.25 wording, correct Wiki sourceRef, and bilateral wasm+backend evidence',
    );
  }
  if (xayahW) {
    validateBilateralCoverageEvidence(
      xayahW.candidateKey,
      xayahW.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const jinxW = records.find((r) => r.candidateKey === 'hero_skill|hero_jinx|W|震荡电磁波！');
  const jinxWTags = [...(jinxW?.genericMechanismTags || [])];
  const jinxWExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'immediate_impact_scaffold',
  ];
  const jinxWReason = String(jinxW?.classificationReason || '');
  const jinxWBoundary =
    'rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_1_40_total_ad; no_cast_timing_direction_range_width_projectile_travel_collision_first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_jinx|W')) {
    errors.push('Jinx W exact override key hero_jinx|W must exist before fallback');
  }
  if (
    !jinxW
    || jinxW.candidateKey !== 'hero_skill|hero_jinx|W|震荡电磁波！'
    || jinxW.passiveName !== '震荡电磁波！'
    || jinxW.genericClassification !== 'migrated'
    || String(jinxW.remainingGap || '').trim()
    || (jinxW.dataGapEvidence?.missingFields || []).length !== 0
    || jinxWTags.join('|') !== jinxWExpectedTags.join('|')
    || jinxWTags.includes('meta_or_non_target_dps')
    || jinxWTags.includes('bonus_ad_ratio')
    || jinxWTags.includes('total_ad_ratio')
    || String(jinxW.remainingGap || '').includes('blocked_data')
    || jinxWReason.includes('out_of_scope_for_single_target_dps')
    || jinxWReason.includes('blocked_data')
    || jinxWReason.includes('implementation_gap_no_unresolved_data_fields')
    || jinxWReason.includes('meta_or_non_target_dps')
    || jinxWReason.includes('bonus_ad_ratio')
    || jinxWReason.includes('ad.resolved-source.attr.ad.base')
    || jinxWReason.includes('ad.resolved-ad.base')
    || !jinxWReason.includes('3907092')
    || !jinxWReason.includes(
      '8aa6ac3943076256fe6afea15f1dd6eebf892656be45784e2522abb6243f4d1f',
    )
    || !jinxWReason.includes(
      'c373cc258c5c8c612930a32c5e851bd4b68dbbcb3c0d7f71ce1d25020ba12624',
    )
    || !jinxWReason.includes('Template:Data Jinx/W')
    || !jinxWReason.includes('Template:Data Jinx/Zap!')
    || !jinxWReason.includes('page1307598')
    || !jinxWReason.includes('bytes1321')
    || !jinxWReason.includes('bytes1319')
    || !jinxWReason.includes('2025-06-06T17:47:18Z')
    || !jinxWReason.includes(jinxWBoundary)
    || !jinxWReason.includes('source.attr.ad.resolved')
    || !jinxWReason.includes('total AD')
    || !jinxWReason.includes('210')
    || !jinxWReason.includes('1.40')
    || !jinxWReason.includes('60 mana')
    || !jinxWReason.includes('4000')
    || !jinxWReason.includes('totalAD60')
    || !jinxWReason.includes('totalAD110')
    || !jinxWReason.includes('raw294')
    || !jinxWReason.includes('raw364')
    || !jinxWReason.includes('armor0=294')
    || !jinxWReason.includes('armor100=147')
    || !jinxWReason.includes('armor0=364')
    || !jinxWReason.includes('armor100=182')
    || !jinxWReason.includes('t3999')
    || !jinxWReason.includes('t4000')
    || !jinxWReason.includes('mana180')
    || !jinxWReason.includes('mana59')
    || !jinxWReason.includes('HP636')
    || !jinxWReason.includes('ability_started')
    || !jinxWReason.includes('standalone')
    || !jinxWReason.includes('external existing-data/check-only')
    || !jinxWReason.includes('identity/panel/resource')
    || !jinxWReason.includes('不暗示 Batch-B')
    || !jinxWReason.includes('sibling Jinx synthesis')
    || !jinxWReason.includes('不宣称')
    || !jinxWReason.includes('no equivalence or contradiction claim')
    || jinxWReason.includes('canonical byte equivalence')
    || jinxWReason.includes('Batch-B prerequisite')
    || !String(jinxW.sourceRef || '').includes('jinx-w.json')
    || !String(jinxW.sourceRef || '').includes(
      '8aa6ac3943076256fe6afea15f1dd6eebf892656be45784e2522abb6243f4d1f',
    )
    || jinxW.auditBaseline?.gapCode !== 'blocked_data'
    || jinxW.auditBaseline?.resolvedBucket !== 'blocked'
    || jinxW.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(jinxW.auditBaseline?.mechanismTags || []).includes('meta_or_non_target_dps')
    || jinxW.classification !== 'out_of_scope_for_single_target_dps'
    || !(jinxW.mechanismTags || []).includes('meta_or_non_target_dps')
    || citesForbiddenProvenance(jinxW.classificationReason)
    || !(jinxW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.jinxZapPrimaryHit
        && e.taskKey === 'wasm-generic-jinx-zap-primary-hit'
        && String(e.note || '').includes(jinxWBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('2afde02')
        && String(e.note || '').includes('c373cc25')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(jinxW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.jinxZapPrimaryHitBackend
        && e.taskKey === 'wasm-generic-jinx-zap-primary-hit'
        && String(e.note || '').includes(jinxWBoundary)
        && String(e.note || '').includes('LolGenericJinxZapPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('b5abdb7')
        && String(e.note || '').includes('a09adf1')
        && String(e.note || '').includes('2afde02')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Jinx synthesis'),
    )
  ) {
    errors.push(
      'Jinx W must be migrated with empty remainingGap/missingFields, exact Zap! ordered tags (no meta_or_non_target_dps/bonus_ad_ratio), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/meta_or_non_target_dps/auditBaseline provenance, Wiki rev3907092/SHA + local raw caveat + frozen completedBoundary, rank5 60mana/4000CD/one physical 210+1.40*totalAD numerics (totalAD60→294/147; totalAD110→364/182; t0/t3999/t4000 mana180→60/HP636 two damage/two ability_started; mana59 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling framing, and bilateral wasm+backend evidence (owning b5abdb7 / integrated a09adf1 / Wasm 2afde02; no cast/direction/projectile/sight/reveal/slow/live claim)',
    );
  }
  if (jinxW) {
    validateBilateralCoverageEvidence(
      jinxW.candidateKey,
      jinxW.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const jhinQ = records.find((r) => r.candidateKey === 'hero_skill|hero_jhin|Q|曼舞手雷');
  const jhinQTags = [...(jhinQ?.genericMechanismTags || [])];
  const jhinQExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const jhinQReason = String(jhinQ?.classificationReason || '');
  const jhinQBoundary =
    'rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_jhin|Q')) {
    errors.push('Jhin Q exact override key hero_jhin|Q must exist before fallback');
  }
  if (
    !jhinQ
    || jhinQ.candidateKey !== 'hero_skill|hero_jhin|Q|曼舞手雷'
    || jhinQ.passiveName !== '曼舞手雷'
    || jhinQ.genericClassification !== 'migrated'
    || String(jhinQ.remainingGap || '').trim()
    || (jhinQ.dataGapEvidence?.missingFields || []).length !== 0
    || jhinQTags.join('|') !== jhinQExpectedTags.join('|')
    || jhinQTags.includes('multi_target_or_area')
    || jhinQTags.includes('bonus_ad_ratio')
    || jhinQTags.includes('total_ad_ratio')
    || jhinQTags.includes('primary_damage_branch_salvage')
    || String(jhinQ.remainingGap || '').includes('blocked_data')
    || jhinQReason.includes('out_of_scope_for_single_target_dps')
    || jhinQReason.includes('blocked_data')
    || jhinQReason.includes('implementation_gap_no_unresolved_data_fields')
    || jhinQReason.includes('multi_target_or_area')
    || jhinQReason.includes('bonus_ad_ratio')
    || jhinQReason.includes('total_ad_ratio')
    || jhinQReason.includes('ad.resolved-source.attr.ad.base')
    || jhinQReason.includes('ad.resolved-ad.base')
    || !jhinQReason.includes('4007611')
    || !jhinQReason.includes(
      '522c4b918067b4b035b6744eb3dc83ce64ba5d47f677ed8517fcb246111685f1',
    )
    || !jhinQReason.includes(
      '17deceae0abe42034f805a166ae5a16932ffcb19925654e6aa39625f026dd0cb',
    )
    || !jhinQReason.includes('Template:Data Jhin/Q')
    || !jhinQReason.includes('Template:Data Jhin/Dancing Grenade')
    || !jhinQReason.includes('page1307579')
    || !jhinQReason.includes('bytes1913')
    || !jhinQReason.includes('bytes1911')
    || !jhinQReason.includes('2026-04-12T07:23:12Z')
    || !jhinQReason.includes(jhinQBoundary)
    || !jhinQReason.includes('source.attr.ad.resolved')
    || !jhinQReason.includes('source.attr.ap.resolved')
    || !jhinQReason.includes('nested binary')
    || !jhinQReason.includes('total AD direct read')
    || !jhinQReason.includes('never bonus AD')
    || !jhinQReason.includes('144')
    || !jhinQReason.includes('0.74')
    || !jhinQReason.includes('0.60')
    || !jhinQReason.includes('60 mana')
    || !jhinQReason.includes('5000')
    || !jhinQReason.includes('raw=final144')
    || !jhinQReason.includes('raw=final218')
    || !jhinQReason.includes('raw=final204')
    || !jhinQReason.includes('raw=final278')
    || !jhinQReason.includes('raw278/final139')
    || !jhinQReason.includes('raw352/final176')
    || !jhinQReason.includes('both218')
    || !jhinQReason.includes('t4999')
    || !jhinQReason.includes('t5000')
    || !jhinQReason.includes('mana180')
    || !jhinQReason.includes('mana59')
    || !jhinQReason.includes('HP722')
    || !jhinQReason.includes('ability_started')
    || !jhinQReason.includes('Q/W isolation')
    || !jhinQReason.includes('standalone')
    || !jhinQReason.includes('external existing-data/check-only')
    || !jhinQReason.includes('identity/panel/resource')
    || !jhinQReason.includes('不暗示 Batch-B')
    || !jhinQReason.includes('sibling Jhin synthesis')
    || !jhinQReason.includes('不宣称')
    || !jhinQReason.includes('no equivalence or contradiction claim')
    || jhinQReason.includes('canonical byte equivalence')
    || jhinQReason.includes('Batch-B prerequisite')
    || !String(jhinQ.sourceRef || '').includes('jhin-q.json')
    || !String(jhinQ.sourceRef || '').includes(
      '522c4b918067b4b035b6744eb3dc83ce64ba5d47f677ed8517fcb246111685f1',
    )
    || jhinQ.auditBaseline?.gapCode !== 'blocked_data'
    || jhinQ.auditBaseline?.resolvedBucket !== 'blocked'
    || jhinQ.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(jhinQ.auditBaseline?.mechanismTags || []).includes('multi_target_or_area')
    || jhinQ.classification !== 'out_of_scope_for_single_target_dps'
    || !(jhinQ.mechanismTags || []).includes('multi_target_or_area')
    || citesForbiddenProvenance(jhinQ.classificationReason)
    || !(jhinQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.jhinDancingGrenadePrimaryFirstHit
        && e.taskKey === 'wasm-generic-jhin-dancing-grenade-primary-first-hit'
        && String(e.note || '').includes(jhinQBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('f70be27')
        && String(e.note || '').includes('deaa6604')
        && String(e.note || '').includes('71563')
        && String(e.note || '').includes('17deceae')
        && String(e.note || '').includes('Q/W isolation')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(jhinQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.jhinDancingGrenadePrimaryFirstHitBackend
        && e.taskKey === 'wasm-generic-jhin-dancing-grenade-primary-first-hit'
        && String(e.note || '').includes(jhinQBoundary)
        && String(e.note || '').includes('LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest')
        && String(e.note || '').includes('ce22594')
        && String(e.note || '').includes('488898e')
        && String(e.note || '').includes('f70be27')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Jhin synthesis'),
    )
  ) {
    errors.push(
      'Jhin Q must be migrated with empty remainingGap/missingFields, exact Dancing Grenade ordered tags (no multi_target_or_area/total_ad_ratio/salvage), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/multi_target_or_area/auditBaseline provenance, Wiki rev4007611/SHA + local raw caveat + frozen completedBoundary, rank5 60mana/5000CD/nested-binary 144+0.74*totalAD+0.60*AP numerics (144/218/204/278/139/352→176; counterproof both218; t0/t4999/t5000 mana180→60/HP722 two damage/two ability_started; mana59 skip), Q/W isolation, standalone/external-existing-data/check-only/no-Batch-B/no-sibling framing, and bilateral wasm+backend evidence (owning ce22594 / integrated 488898e / Wasm f70be27; no cast/cancel/projectile/bounce/death-amp/spellshield/live claim)',
    );
  }
  if (jhinQ) {
    validateBilateralCoverageEvidence(
      jhinQ.candidateKey,
      jhinQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const jhinW = records.find((r) => r.candidateKey === 'hero_skill|hero_jhin|W|致命华彩');
  const jhinWTags = [...(jhinW?.genericMechanismTags || [])];
  const jhinWExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'immediate_impact_scaffold',
  ];
  const jhinWReason = String(jhinW?.classificationReason || '');
  const jhinWBoundary =
    'rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_0_50_total_ad; no_cast_timing_direction_range_width_line_geometry_multitarget_champion_collision_projectile_interception_spell_shield_mark_creation_mark_detection_root_bonus_movement_speed_minion_reduction_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_jhin|W')) {
    errors.push('Jhin W exact override key hero_jhin|W must exist before fallback');
  }
  if (
    !jhinW
    || jhinW.candidateKey !== 'hero_skill|hero_jhin|W|致命华彩'
    || jhinW.passiveName !== '致命华彩'
    || jhinW.genericClassification !== 'migrated'
    || String(jhinW.remainingGap || '').trim()
    || (jhinW.dataGapEvidence?.missingFields || []).length !== 0
    || jhinWTags.join('|') !== jhinWExpectedTags.join('|')
    || jhinWTags.includes('meta_or_non_target_dps')
    || jhinWTags.includes('bonus_ad_ratio')
    || jhinWTags.includes('total_ad_ratio')
    || String(jhinW.remainingGap || '').includes('blocked_data')
    || jhinWReason.includes('out_of_scope_for_single_target_dps')
    || jhinWReason.includes('blocked_data')
    || jhinWReason.includes('implementation_gap_no_unresolved_data_fields')
    || jhinWReason.includes('meta_or_non_target_dps')
    || jhinWReason.includes('bonus_ad_ratio')
    || jhinWReason.includes('ad.resolved-source.attr.ad.base')
    || jhinWReason.includes('ad.resolved-ad.base')
    || !jhinWReason.includes('4021795')
    || !jhinWReason.includes(
      '14790ca09f6f320fc2fadc81c2fa7e783c7b81d48d792b7760494f2e8d788c65',
    )
    || !jhinWReason.includes(
      '76790ba522dc101bb1f1c24ae620f80e8db6d10e890515cbc7da85005a67f78b',
    )
    || !jhinWReason.includes('Template:Data Jhin/W')
    || !jhinWReason.includes('Template:Data Jhin/Deadly Flourish')
    || !jhinWReason.includes('page1307581')
    || !jhinWReason.includes('bytes2942')
    || !jhinWReason.includes('bytes2940')
    || !jhinWReason.includes('2026-05-21T13:25:33Z')
    || !jhinWReason.includes(jhinWBoundary)
    || !jhinWReason.includes('source.attr.ad.resolved')
    || !jhinWReason.includes('total AD')
    || !jhinWReason.includes('210')
    || !jhinWReason.includes('0.50')
    || !jhinWReason.includes('70 mana')
    || !jhinWReason.includes('12000')
    || !jhinWReason.includes('totalAD60')
    || !jhinWReason.includes('totalAD100')
    || !jhinWReason.includes('raw240')
    || !jhinWReason.includes('raw260')
    || !jhinWReason.includes('armor0=240')
    || !jhinWReason.includes('armor100=120')
    || !jhinWReason.includes('armor0=260')
    || !jhinWReason.includes('armor100=130')
    || !jhinWReason.includes('t11999')
    || !jhinWReason.includes('t12000')
    || !jhinWReason.includes('mana210')
    || !jhinWReason.includes('mana69')
    || !jhinWReason.includes('HP740')
    || !jhinWReason.includes('ability_started')
    || !jhinWReason.includes('Minion-only 25%')
    || !jhinWReason.includes('selected champion')
    || !jhinWReason.includes('standalone')
    || !jhinWReason.includes('external existing-data/check-only')
    || !jhinWReason.includes('identity/panel/resource')
    || !jhinWReason.includes('不暗示 Batch-B')
    || !jhinWReason.includes('sibling Jhin synthesis')
    || !jhinWReason.includes('不宣称')
    || !jhinWReason.includes('no equivalence or contradiction claim')
    || jhinWReason.includes('canonical byte equivalence')
    || jhinWReason.includes('Batch-B prerequisite')
    || !String(jhinW.sourceRef || '').includes('jhin-w.json')
    || !String(jhinW.sourceRef || '').includes(
      '14790ca09f6f320fc2fadc81c2fa7e783c7b81d48d792b7760494f2e8d788c65',
    )
    || jhinW.auditBaseline?.gapCode !== 'blocked_data'
    || jhinW.auditBaseline?.resolvedBucket !== 'blocked'
    || jhinW.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(jhinW.auditBaseline?.mechanismTags || []).includes('meta_or_non_target_dps')
    || jhinW.classification !== 'out_of_scope_for_single_target_dps'
    || !(jhinW.mechanismTags || []).includes('meta_or_non_target_dps')
    || citesForbiddenProvenance(jhinW.classificationReason)
    || !(jhinW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.jhinDeadlyFlourishPrimaryHit
        && e.taskKey === 'wasm-generic-jhin-deadly-flourish-primary-hit'
        && String(e.note || '').includes(jhinWBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('d62d2e4')
        && String(e.note || '').includes('76790ba5')
        && String(e.note || '').includes('minion-reduction excluded')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(jhinW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.jhinDeadlyFlourishPrimaryHitBackend
        && e.taskKey === 'wasm-generic-jhin-deadly-flourish-primary-hit'
        && String(e.note || '').includes(jhinWBoundary)
        && String(e.note || '').includes('LolGenericJhinDeadlyFlourishPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('4903c00')
        && String(e.note || '').includes('0c103f8')
        && String(e.note || '').includes('d62d2e4')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Jhin synthesis'),
    )
  ) {
    errors.push(
      'Jhin W must be migrated with empty remainingGap/missingFields, exact Deadly Flourish ordered tags (no meta_or_non_target_dps/bonus_ad_ratio), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/meta_or_non_target_dps/auditBaseline provenance, Wiki rev4021795/SHA + local raw caveat + frozen completedBoundary, rank5 70mana/12000CD/one physical 210+0.50*totalAD numerics (totalAD60→240/120; totalAD100→260/130; t0/t11999/t12000 mana210→70/HP740 two damage/two ability_started; mana69 skip), selected-champion/minion-reduction exclusion, standalone/external-existing-data/check-only/no-Batch-B/no-sibling framing, and bilateral wasm+backend evidence (owning 4903c00 / integrated 0c103f8 / Wasm d62d2e4; no cast/direction/line/projectile/mark/root/minion/live claim)',
    );
  }
  if (jhinW) {
    validateBilateralCoverageEvidence(
      jhinW.candidateKey,
      jhinW.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const caitlynE = records.find((r) => r.candidateKey === 'hero_skill|hero_caitlyn|E|90口径绳网');
  const caitlynETags = [...(caitlynE?.genericMechanismTags || [])];
  const caitlynEExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const caitlynEReason = String(caitlynE?.classificationReason || '');
  const caitlynEBoundary =
    'rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; magic_280_plus_0_80_ap; no_cast_timing_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_suppression_spell_shield_recoil_dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_caitlyn|E')) {
    errors.push('Caitlyn E exact override key hero_caitlyn|E must exist before fallback');
  }
  if (
    !caitlynE
    || caitlynE.candidateKey !== 'hero_skill|hero_caitlyn|E|90口径绳网'
    || caitlynE.passiveName !== '90口径绳网'
    || caitlynE.genericClassification !== 'migrated'
    || String(caitlynE.remainingGap || '').trim()
    || (caitlynE.dataGapEvidence?.missingFields || []).length !== 0
    || caitlynETags.join('|') !== caitlynEExpectedTags.join('|')
    || caitlynETags.includes('dps_relevant_manual_review')
    || caitlynETags.includes('meta_or_non_target_dps')
    || String(caitlynE.remainingGap || '').includes('blocked_data')
    || caitlynEReason.includes('needs_manual_baseline')
    || caitlynEReason.includes('blocked_data')
    || caitlynEReason.includes('implementation_gap_no_unresolved_data_fields')
    || caitlynEReason.includes('dps_relevant_manual_review')
    || caitlynEReason.includes('out_of_scope_for_single_target_dps')
    || !caitlynEReason.includes('4007584')
    || !caitlynEReason.includes(
      '9357e7b28b05f738cd8049a2d10a115e4033a54123c0e71f55d1262a92884db2',
    )
    || !caitlynEReason.includes(
      '3a5eba6df38ec34046440743d55de61490dc7b5a2488b8fc671851474d080073',
    )
    || !caitlynEReason.includes('Template:Data Caitlyn/E')
    || !caitlynEReason.includes('Template:Data Caitlyn/90 Caliber Net')
    || !caitlynEReason.includes('page1306916')
    || !caitlynEReason.includes('bytes2095')
    || !caitlynEReason.includes('bytes2094')
    || !caitlynEReason.includes('2026-04-12T06:47:56Z')
    || !caitlynEReason.includes(caitlynEBoundary)
    || !caitlynEReason.includes('source.attr.ap.resolved')
    || !caitlynEReason.includes('280')
    || !caitlynEReason.includes('0.80')
    || !caitlynEReason.includes('75 mana')
    || !caitlynEReason.includes('8000')
    || !caitlynEReason.includes('20221')
    || !caitlynEReason.includes('20170')
    || !caitlynEReason.includes('20230 forbidden')
    || !caitlynEReason.includes('raw/mit 280/140')
    || !caitlynEReason.includes('raw/mit 360/180')
    || !caitlynEReason.includes('t7999')
    || !caitlynEReason.includes('t8000')
    || !caitlynEReason.includes('mana225')
    || !caitlynEReason.includes('mana74')
    || !caitlynEReason.includes('HP640')
    || !caitlynEReason.includes('ability_started')
    || !caitlynEReason.includes('standalone')
    || !caitlynEReason.includes('external existing-data/check-only')
    || !caitlynEReason.includes('identity/panel/resource')
    || !caitlynEReason.includes('不暗示 Batch-B')
    || !caitlynEReason.includes('sibling Caitlyn synthesis')
    || !caitlynEReason.includes('不宣称')
    || !caitlynEReason.includes('no equivalence or contradiction claim')
    || caitlynEReason.includes('canonical byte equivalence')
    || caitlynEReason.includes('Batch-B prerequisite')
    || caitlynEReason.includes('live published')
    || !String(caitlynE.sourceRef || '').includes('caitlyn-e.json')
    || !String(caitlynE.sourceRef || '').includes(
      '9357e7b28b05f738cd8049a2d10a115e4033a54123c0e71f55d1262a92884db2',
    )
    || caitlynE.auditBaseline?.gapCode !== 'blocked_data'
    || caitlynE.auditBaseline?.resolvedBucket !== 'blocked'
    || caitlynE.auditBaseline?.damageDisposition !== 'not_applicable'
    || !(caitlynE.auditBaseline?.mechanismTags || []).includes('dps_relevant_manual_review')
    || caitlynE.classification !== 'needs_manual_baseline'
    || !(caitlynE.mechanismTags || []).includes('dps_relevant_manual_review')
    || citesForbiddenProvenance(caitlynE.classificationReason)
    || !(caitlynE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.caitlyn90CaliberNetPrimaryHit
        && e.taskKey === 'wasm-generic-caitlyn-90-caliber-net-primary-hit'
        && String(e.note || '').includes(caitlynEBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('4433ef1')
        && String(e.note || '').includes('3a5eba6d')
        && String(e.note || '').includes('20221')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('20230 forbidden')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(caitlynE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.caitlyn90CaliberNetPrimaryHitBackend
        && e.taskKey === 'wasm-generic-caitlyn-90-caliber-net-primary-hit'
        && String(e.note || '').includes(caitlynEBoundary)
        && String(e.note || '').includes('LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('9506d01')
        && String(e.note || '').includes('384d658')
        && String(e.note || '').includes('4433ef1')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Caitlyn synthesis'),
    )
  ) {
    errors.push(
      'Caitlyn E must be migrated with empty remainingGap/missingFields, exact 90 Caliber Net ordered tags (no dps_relevant_manual_review), stale blocked_data/needs_manual_baseline/implementation-gap cleared while retaining raw needs_manual_baseline/dps_relevant_manual_review/auditBaseline provenance, Wiki rev4007584/SHA + local raw caveat + frozen completedBoundary, rank5 75mana/8000CD/one magic 280+0.80*AP numerics (AP0→280/140; AP100→360/180; 20221/20170/20230 forbidden; t0/t7999/t8000 mana225→75/HP640 two damage/two ability_started; mana74 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling framing, and bilateral wasm+backend evidence (owning 9506d01 / integrated 384d658 / Wasm 4433ef1; no cast/direction/line/projectile/recoil/dash/slow/Headshot/live claim)',
    );
  }
  if (caitlynE) {
    validateBilateralCoverageEvidence(
      caitlynE.candidateKey,
      caitlynE.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const kalistaQ = records.find((r) => r.candidateKey === 'hero_skill|hero_kalista|Q|穿刺');
  const kalistaQTags = [...(kalistaQ?.genericMechanismTags || [])];
  const kalistaQExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'immediate_impact_scaffold',
  ];
  const kalistaQReason = String(kalistaQ?.classificationReason || '');
  const kalistaQBoundary =
    'rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_270_plus_1_05_total_ad; no_cast_timing_martial_poise_dash_cancel_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_interception_spell_shield_kill_continuation_rend_stack_transfer_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_kalista|Q')) {
    errors.push('Kalista Q exact override key hero_kalista|Q must exist before fallback');
  }
  if (
    !kalistaQ
    || kalistaQ.candidateKey !== 'hero_skill|hero_kalista|Q|穿刺'
    || kalistaQ.passiveName !== '穿刺'
    || kalistaQ.genericClassification !== 'migrated'
    || String(kalistaQ.remainingGap || '').trim()
    || (kalistaQ.dataGapEvidence?.missingFields || []).length !== 0
    || kalistaQTags.join('|') !== kalistaQExpectedTags.join('|')
    || kalistaQTags.includes('dps_relevant_manual_review')
    || kalistaQTags.includes('meta_or_non_target_dps')
    || kalistaQTags.includes('bonus_ad_ratio')
    || kalistaQTags.includes('total_ad_ratio')
    || String(kalistaQ.remainingGap || '').includes('blocked_data')
    || kalistaQReason.includes('needs_manual_baseline')
    || kalistaQReason.includes('blocked_data')
    || kalistaQReason.includes('implementation_gap_no_unresolved_data_fields')
    || kalistaQReason.includes('dps_relevant_manual_review')
    || kalistaQReason.includes('out_of_scope_for_single_target_dps')
    || kalistaQReason.includes('bonus_ad_ratio')
    || kalistaQReason.includes('ad.resolved-source.attr.ad.base')
    || kalistaQReason.includes('ad.resolved-ad.base')
    || !kalistaQReason.includes('3997075')
    || !kalistaQReason.includes(
      '90c490d921da436134c318249fa7d0038ceaa97dfb76e5bdaa0b330a43676a67',
    )
    || !kalistaQReason.includes(
      '0b8dd9cf9b40aae52fb6180ecabae7e459970f2f7c4d05711463df25fdbd1c94',
    )
    || !kalistaQReason.includes('Template:Data Kalista/Q')
    || !kalistaQReason.includes('Template:Data Kalista/Pierce')
    || !kalistaQReason.includes('page1307666')
    || !kalistaQReason.includes('bytes1625')
    || !kalistaQReason.includes('bytes1623')
    || !kalistaQReason.includes('2026-03-06T15:53:18Z')
    || !kalistaQReason.includes(kalistaQBoundary)
    || !kalistaQReason.includes('source.attr.ad.resolved')
    || !kalistaQReason.includes('total AD')
    || !kalistaQReason.includes('270')
    || !kalistaQReason.includes('1.05')
    || !kalistaQReason.includes('80 mana')
    || !kalistaQReason.includes('9000')
    || !kalistaQReason.includes('20220')
    || !kalistaQReason.includes('20170')
    || !kalistaQReason.includes('no explicit event op')
    || !kalistaQReason.includes('(AD0,A0)=(270,270)')
    || !kalistaQReason.includes('(AD0,A100)=(270,135)')
    || !kalistaQReason.includes('(AD100,A0)=(375,375)')
    || !kalistaQReason.includes('(AD100,A100)=(375,187.5)')
    || !kalistaQReason.includes('(AD200,A100)=(480,240)')
    || !kalistaQReason.includes('t8999')
    || !kalistaQReason.includes('t9000')
    || !kalistaQReason.includes('mana240')
    || !kalistaQReason.includes('mana79')
    || !kalistaQReason.includes('HP625')
    || !kalistaQReason.includes('ability_started')
    || !kalistaQReason.includes('standalone')
    || !kalistaQReason.includes('external existing-data/check-only')
    || !kalistaQReason.includes('identity/panel/resource')
    || !kalistaQReason.includes('不暗示 Batch-B')
    || !kalistaQReason.includes('sibling Kalista synthesis')
    || !kalistaQReason.includes('不宣称')
    || !kalistaQReason.includes('no equivalence or contradiction claim')
    || kalistaQReason.includes('canonical byte equivalence')
    || kalistaQReason.includes('Batch-B prerequisite')
    || kalistaQReason.includes('live published')
    || !String(kalistaQ.sourceRef || '').includes('kalista-q.json')
    || !String(kalistaQ.sourceRef || '').includes(
      '90c490d921da436134c318249fa7d0038ceaa97dfb76e5bdaa0b330a43676a67',
    )
    || kalistaQ.auditBaseline?.gapCode !== 'blocked_data'
    || kalistaQ.auditBaseline?.resolvedBucket !== 'blocked'
    || kalistaQ.auditBaseline?.damageDisposition !== 'not_applicable'
    || !(kalistaQ.auditBaseline?.mechanismTags || []).includes('dps_relevant_manual_review')
    || kalistaQ.classification !== 'needs_manual_baseline'
    || !(kalistaQ.mechanismTags || []).includes('dps_relevant_manual_review')
    || citesForbiddenProvenance(kalistaQ.classificationReason)
    || !(kalistaQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.kalistaPiercePrimaryHit
        && e.taskKey === 'wasm-generic-kalista-pierce-primary-hit'
        && String(e.note || '').includes(kalistaQBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('99e7b39')
        && String(e.note || '').includes('0b8dd9cf')
        && String(e.note || '').includes('20220')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(kalistaQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.kalistaPiercePrimaryHitBackend
        && e.taskKey === 'wasm-generic-kalista-pierce-primary-hit'
        && String(e.note || '').includes(kalistaQBoundary)
        && String(e.note || '').includes('LolGenericKalistaPiercePrimaryHitSeedSqlTest')
        && String(e.note || '').includes('04c061f')
        && String(e.note || '').includes('bdb5d32')
        && String(e.note || '').includes('99e7b39')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Kalista synthesis'),
    )
  ) {
    errors.push(
      'Kalista Q must be migrated with empty remainingGap/missingFields, exact Pierce ordered tags (no dps_relevant_manual_review/total_ad_ratio), stale blocked_data/needs_manual_baseline/implementation-gap cleared while retaining raw needs_manual_baseline/dps_relevant_manual_review/auditBaseline provenance, Wiki rev3997075/SHA + local raw caveat + frozen completedBoundary, rank5 80mana/9000CD/one physical 270+1.05*totalAD numerics ((AD0,A0)=(270,270); (AD0,A100)=(270,135); (AD100,A0)=(375,375); (AD100,A100)=(375,187.5); (AD200,A100)=(480,240); 20220/20170; no explicit event op; t0/t8999/t9000 mana240→80/HP625 two damage/two ability_started; mana79 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling framing, and bilateral wasm+backend evidence (owning 04c061f / integrated bdb5d32 / Wasm 99e7b39; no cast/Martial-Poise/direction/line/projectile/kill/Rend/live claim)',
    );
  }
  if (kalistaQ) {
    validateBilateralCoverageEvidence(
      kalistaQ.candidateKey,
      kalistaQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const caitlynQ = records.find((r) => r.candidateKey === 'hero_skill|hero_caitlyn|Q|和平使者');
  const caitlynQTags = [...(caitlynQ?.genericMechanismTags || [])];
  const caitlynQExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'immediate_impact_scaffold',
  ];
  const caitlynQReason = String(caitlynQ?.classificationReason || '');
  const caitlynQBoundary =
    'rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; physical_210_plus_2_05_total_ad; no_cast_timing_attack_timer_reset_direction_range_width_line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_full_damage_projectile_spell_shield_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_caitlyn|Q')) {
    errors.push('Caitlyn Q exact override key hero_caitlyn|Q must exist before fallback');
  }
  if (
    !caitlynQ
    || caitlynQ.candidateKey !== 'hero_skill|hero_caitlyn|Q|和平使者'
    || caitlynQ.passiveName !== '和平使者'
    || caitlynQ.genericClassification !== 'migrated'
    || String(caitlynQ.remainingGap || '').trim()
    || (caitlynQ.dataGapEvidence?.missingFields || []).length !== 0
    || caitlynQTags.join('|') !== caitlynQExpectedTags.join('|')
    || caitlynQTags.includes('dps_relevant_manual_review')
    || caitlynQTags.includes('meta_or_non_target_dps')
    || caitlynQTags.includes('bonus_ad_ratio')
    || caitlynQTags.includes('total_ad_ratio')
    || String(caitlynQ.remainingGap || '').includes('blocked_data')
    || caitlynQReason.includes('needs_manual_baseline')
    || caitlynQReason.includes('blocked_data')
    || caitlynQReason.includes('implementation_gap_no_unresolved_data_fields')
    || caitlynQReason.includes('dps_relevant_manual_review')
    || caitlynQReason.includes('out_of_scope_for_single_target_dps')
    || caitlynQReason.includes('bonus_ad_ratio')
    || caitlynQReason.includes('ad.resolved-source.attr.ad.base')
    || caitlynQReason.includes('ad.resolved-ad.base')
    || !caitlynQReason.includes('4007583')
    || !caitlynQReason.includes(
      '6c40deba7b6e60ab9c06bc014a214a8be4319c4ddf22c550237b659f19307caf',
    )
    || !caitlynQReason.includes(
      '93da300971429a629f11a721c3993784db6a99d3559b1286eae9500176560b9a',
    )
    || !caitlynQReason.includes('Template:Data Caitlyn/Q')
    || !caitlynQReason.includes('Template:Data Caitlyn/Piltover Peacemaker')
    || !caitlynQReason.includes('page1306911')
    || !caitlynQReason.includes('bytes1841')
    || !caitlynQReason.includes('bytes1838')
    || !caitlynQReason.includes('2026-04-12T06:47:12Z')
    || !caitlynQReason.includes(caitlynQBoundary)
    || !caitlynQReason.includes('source.attr.ad.resolved')
    || !caitlynQReason.includes('total AD')
    || !caitlynQReason.includes('210')
    || !caitlynQReason.includes('2.05')
    || !caitlynQReason.includes('75 mana')
    || !caitlynQReason.includes('6000')
    || !caitlynQReason.includes('20220')
    || !caitlynQReason.includes('20170')
    || !caitlynQReason.includes('no explicit event op')
    || !caitlynQReason.includes('(AD0,A0)=(210,210)')
    || !caitlynQReason.includes('(AD0,A100)=(210,105)')
    || !caitlynQReason.includes('(AD100,A0)=(415,415)')
    || !caitlynQReason.includes('(AD100,A100)=(415,207.5)')
    || !caitlynQReason.includes('(AD200,A100)=(620,310)')
    || !caitlynQReason.includes('t5999')
    || !caitlynQReason.includes('t6000')
    || !caitlynQReason.includes('mana225')
    || !caitlynQReason.includes('mana74')
    || !caitlynQReason.includes('HP585')
    || !caitlynQReason.includes('ability_started')
    || !caitlynQReason.includes('standalone')
    || !caitlynQReason.includes('external existing-data/check-only')
    || !caitlynQReason.includes('identity/panel/resource')
    || !caitlynQReason.includes('不暗示 Batch-B')
    || !caitlynQReason.includes('sibling Caitlyn synthesis')
    || !caitlynQReason.includes('不宣称')
    || !caitlynQReason.includes('no equivalence or contradiction claim')
    || caitlynQReason.includes('canonical byte equivalence')
    || caitlynQReason.includes('Batch-B prerequisite')
    || caitlynQReason.includes('live published')
    || !String(caitlynQ.sourceRef || '').includes('caitlyn-q.json')
    || !String(caitlynQ.sourceRef || '').includes(
      '6c40deba7b6e60ab9c06bc014a214a8be4319c4ddf22c550237b659f19307caf',
    )
    || caitlynQ.auditBaseline?.gapCode !== 'blocked_data'
    || caitlynQ.auditBaseline?.resolvedBucket !== 'blocked'
    || caitlynQ.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(caitlynQ.auditBaseline?.mechanismTags || []).includes('meta_or_non_target_dps')
    || caitlynQ.classification !== 'out_of_scope_for_single_target_dps'
    || !(caitlynQ.mechanismTags || []).includes('meta_or_non_target_dps')
    || citesForbiddenProvenance(caitlynQ.classificationReason)
    || !(caitlynQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.caitlynPiltoverPeacemakerFirstEnemyHit
        && e.taskKey === 'wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit'
        && String(e.note || '').includes(caitlynQBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('0fe29e7')
        && String(e.note || '').includes('93da3009')
        && String(e.note || '').includes('20220')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(caitlynQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.caitlynPiltoverPeacemakerFirstEnemyHitBackend
        && e.taskKey === 'wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit'
        && String(e.note || '').includes(caitlynQBoundary)
        && String(e.note || '').includes('LolGenericCaitlynPiltoverPeacemakerFirstEnemyHitSeedSqlTest')
        && String(e.note || '').includes('b5ef446')
        && String(e.note || '').includes('245a111')
        && String(e.note || '').includes('0fe29e7')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Caitlyn synthesis'),
    )
  ) {
    errors.push(
      'Caitlyn Q must be migrated with empty remainingGap/missingFields, exact Piltover Peacemaker ordered tags (no dps_relevant_manual_review/total_ad_ratio), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/meta_or_non_target_dps/auditBaseline provenance, Wiki rev4007583/SHA + local raw caveat + frozen completedBoundary, rank5 75mana/6000CD/one physical 210+2.05*totalAD numerics ((AD0,A0)=(210,210); (AD0,A100)=(210,105); (AD100,A0)=(415,415); (AD100,A100)=(415,207.5); (AD200,A100)=(620,310); 20220/20170; no explicit event op; t0/t5999/t6000 mana225→75/HP585 two damage/two ability_started; mana74 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling framing, and bilateral wasm+backend evidence (owning b5ef446 / integrated 245a111 / Wasm 0fe29e7; no cast/attack-timer-reset/direction/line/projectile/trap/reveal/live claim)',
    );
  }
  if (caitlynQ) {
    validateBilateralCoverageEvidence(
      caitlynQ.candidateKey,
      caitlynQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const lucianQ = records.find((r) => r.candidateKey === 'hero_skill|hero_lucian|Q|透体圣光');
  const lucianQTags = [...(lucianQ?.genericMechanismTags || [])];
  const lucianQExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'bonus_ad_ratio',
    'immediate_impact_scaffold',
  ];
  const lucianQReason = String(lucianQ?.classificationReason || '');
  const lucianQBoundary =
    'rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; physical_220_plus_1_00_bonus_ad; no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_initial_target_death_early_end_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_lucian|Q')) {
    errors.push('Lucian Q exact override key hero_lucian|Q must exist before fallback');
  }
  if (
    !lucianQ
    || lucianQ.candidateKey !== 'hero_skill|hero_lucian|Q|透体圣光'
    || lucianQ.passiveName !== '透体圣光'
    || lucianQ.genericClassification !== 'migrated'
    || String(lucianQ.remainingGap || '').trim()
    || (lucianQ.dataGapEvidence?.missingFields || []).length !== 0
    || lucianQTags.join('|') !== lucianQExpectedTags.join('|')
    || lucianQTags.includes('dps_relevant_manual_review')
    || lucianQTags.includes('meta_or_non_target_dps')
    || lucianQTags.includes('total_ad_ratio')
    || !lucianQTags.includes('bonus_ad_ratio')
    || String(lucianQ.remainingGap || '').includes('blocked_data')
    || lucianQReason.includes('needs_manual_baseline')
    || lucianQReason.includes('blocked_data')
    || lucianQReason.includes('implementation_gap_no_unresolved_data_fields')
    || lucianQReason.includes('dps_relevant_manual_review')
    || lucianQReason.includes('out_of_scope_for_single_target_dps')
    || lucianQReason.includes('total AD；')
    || lucianQReason.includes('total_ad_ratio')
    || lucianQReason.includes('*totalAD')
    || !lucianQReason.includes('3982579')
    || !lucianQReason.includes(
      'd7b03d15af48312a0ea5a06fa147b43c46d2a7ee6e1491dd121d796a2e452981',
    )
    || !lucianQReason.includes(
      'cd65b80f0580f0e4833028791bba2331a321366307b8c35f7fc28fe06c1f06c1',
    )
    || !lucianQReason.includes('Template:Data Lucian/Q')
    || !lucianQReason.includes('Template:Data Lucian/Piercing Light')
    || !lucianQReason.includes('page1308176')
    || !lucianQReason.includes('bytes1608')
    || !lucianQReason.includes('2026-01-09T09:22:29Z')
    || !lucianQReason.includes(lucianQBoundary)
    || !lucianQReason.includes('source.attr.ad.resolved - source.attr.ad.base')
    || !lucianQReason.includes('bonus AD by explicit subtraction')
    || !lucianQReason.includes('不得按 total-AD 直读')
    || !lucianQReason.includes('220')
    || !lucianQReason.includes('1.00')
    || !lucianQReason.includes('80 mana')
    || !lucianQReason.includes('5000')
    || !lucianQReason.includes('20220')
    || !lucianQReason.includes('20170')
    || !lucianQReason.includes('no explicit event op')
    || !lucianQReason.includes('base60/resolved60/armor0 raw=final220')
    || !lucianQReason.includes('base60/resolved160/armor0 raw=final320')
    || !lucianQReason.includes('base60/resolved160/armor100 raw320/final160')
    || !lucianQReason.includes('base60/resolved260/armor100 raw420/final210')
    || !lucianQReason.includes('total-AD counterproof')
    || !lucianQReason.includes('t4999')
    || !lucianQReason.includes('t5000')
    || !lucianQReason.includes('mana240')
    || !lucianQReason.includes('mana79')
    || !lucianQReason.includes('HP680')
    || !lucianQReason.includes('ability_started')
    || !lucianQReason.includes('standalone')
    || !lucianQReason.includes('external existing-data/check-only')
    || !lucianQReason.includes('identity/panel/resource')
    || !lucianQReason.includes('不暗示 Batch-B')
    || !lucianQReason.includes('sibling Lucian synthesis')
    || !lucianQReason.includes('production runtime/ABI/Web change')
    || !lucianQReason.includes('不宣称')
    || !lucianQReason.includes('no equivalence or contradiction claim')
    || lucianQReason.includes('canonical byte equivalence')
    || lucianQReason.includes('Batch-B prerequisite')
    || lucianQReason.includes('live published')
    || !String(lucianQ.sourceRef || '').includes('lucian-q.json')
    || !String(lucianQ.sourceRef || '').includes(
      'd7b03d15af48312a0ea5a06fa147b43c46d2a7ee6e1491dd121d796a2e452981',
    )
    || lucianQ.auditBaseline?.gapCode !== 'blocked_data'
    || lucianQ.auditBaseline?.resolvedBucket !== 'blocked'
    || lucianQ.auditBaseline?.damageDisposition !== 'not_applicable'
    || !(lucianQ.auditBaseline?.mechanismTags || []).includes('dps_relevant_manual_review')
    || lucianQ.classification !== 'needs_manual_baseline'
    || !(lucianQ.mechanismTags || []).includes('dps_relevant_manual_review')
    || citesForbiddenProvenance(lucianQ.classificationReason)
    || !(lucianQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.lucianPiercingLightSelectedTargetHit
        && e.taskKey === 'wasm-generic-lucian-piercing-light-selected-target-hit'
        && String(e.note || '').includes(lucianQBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('aaca359')
        && String(e.note || '').includes('cd65b80f')
        && String(e.note || '').includes('20220')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis')
        && String(e.note || '').includes('total-AD counterproof'),
    )
    || !(lucianQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.lucianPiercingLightSelectedTargetHitBackend
        && e.taskKey === 'wasm-generic-lucian-piercing-light-selected-target-hit'
        && String(e.note || '').includes(lucianQBoundary)
        && String(e.note || '').includes('LolGenericLucianPiercingLightSelectedTargetHitSeedSqlTest')
        && String(e.note || '').includes('bfc9d54')
        && String(e.note || '').includes('826cdad')
        && String(e.note || '').includes('aaca359')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Lucian synthesis'),
    )
  ) {
    errors.push(
      'Lucian Q must be migrated with empty remainingGap/missingFields, exact Piercing Light ordered tags (no dps_relevant_manual_review/total_ad_ratio; requires bonus_ad_ratio), stale blocked_data/needs_manual_baseline/implementation-gap cleared while retaining raw needs_manual_baseline/dps_relevant_manual_review/auditBaseline provenance, Wiki rev3982579/SHA + local raw caveat + frozen completedBoundary, rank5 80mana/5000CD/one physical 220+1.00*bonusAD via sub(ad.resolved,ad.base) numerics (base60/resolved60/armor0=220; resolved160/armor0=320; resolved160/armor100 raw320/final160; resolved260/armor100 raw420/final210; total-AD counterproof; 20220/20170; no explicit event op; t0/t4999/t5000 mana240→80/HP680 two damage/two ability_started; mana79 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-production-runtime-ABI-Web framing, and bilateral wasm+backend evidence (owning bfc9d54 / integrated 826cdad / Wasm aaca359; no cast/lead/dodge/direction/range/line/multitarget/AOE/spell-shield/buffer/E-lockout/early-end/live claim)',
    );
  }
  if (lucianQ) {
    validateBilateralCoverageEvidence(
      lucianQ.candidateKey,
      lucianQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const lucianW = records.find((r) => r.candidateKey === 'hero_skill|hero_lucian|W|热诚烈弹');
  const lucianWTags = [...(lucianW?.genericMechanismTags || [])];
  const lucianWExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const lucianWReason = String(lucianW?.classificationReason || '');
  const lucianWBoundary =
    'rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_215_plus_0_90_ap; no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_shield_exception_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_lucian|W')) {
    errors.push('Lucian W exact override key hero_lucian|W must exist before fallback');
  }
  if (
    !lucianW
    || lucianW.candidateKey !== 'hero_skill|hero_lucian|W|热诚烈弹'
    || lucianW.passiveName !== '热诚烈弹'
    || lucianW.genericClassification !== 'migrated'
    || String(lucianW.remainingGap || '').trim()
    || (lucianW.dataGapEvidence?.missingFields || []).length !== 0
    || lucianWTags.join('|') !== lucianWExpectedTags.join('|')
    || lucianWTags.includes('dps_relevant_manual_review')
    || lucianWTags.includes('meta_or_non_target_dps')
    || lucianWTags.includes('bonus_ad_ratio')
    || lucianWTags.includes('total_ad_ratio')
    || String(lucianW.remainingGap || '').includes('blocked_data')
    || lucianWReason.includes('needs_manual_baseline')
    || lucianWReason.includes('blocked_data')
    || lucianWReason.includes('implementation_gap_no_unresolved_data_fields')
    || lucianWReason.includes('dps_relevant_manual_review')
    || lucianWReason.includes('out_of_scope_for_single_target_dps')
    || lucianWReason.includes('meta_or_non_target_dps')
    || lucianWReason.includes('depends on Lucian Q')
    || lucianWReason.includes('requires Lucian Q')
    || !lucianWReason.includes('3594941')
    || !lucianWReason.includes(
      'b1ea7bc7a2e48be9ab97acfa1fc5addb80b8dd236dc97bd3d57c5e90951418c5',
    )
    || !lucianWReason.includes(
      'a57b0e49765ab5a9bdd30ad295d24e406a90015b083c8a0e817855c6bc152236',
    )
    || !lucianWReason.includes('Template:Data Lucian/W')
    || !lucianWReason.includes('Template:Data Lucian/Ardent Blaze')
    || !lucianWReason.includes('page1308178')
    || !lucianWReason.includes('bytes2542')
    || !lucianWReason.includes('2023-09-12T19:08:23Z')
    || !lucianWReason.includes(lucianWBoundary)
    || !lucianWReason.includes('source.attr.ap.resolved')
    || !lucianWReason.includes('215')
    || !lucianWReason.includes('0.90')
    || !lucianWReason.includes('60 mana')
    || !lucianWReason.includes('10000')
    || !lucianWReason.includes('20221')
    || !lucianWReason.includes('20170')
    || !lucianWReason.includes('no explicit event op')
    || !lucianWReason.includes('AP0/MR0 raw=final215')
    || !lucianWReason.includes('AP0/MR100 raw215/final107.5')
    || !lucianWReason.includes('AP100/MR0 raw=final305')
    || !lucianWReason.includes('AP100/MR100 raw305/final152.5')
    || !lucianWReason.includes('AP200/MR100 raw395/final197.5')
    || !lucianWReason.includes('t9999')
    || !lucianWReason.includes('t10000')
    || !lucianWReason.includes('mana180')
    || !lucianWReason.includes('mana59')
    || !lucianWReason.includes('HP695')
    || !lucianWReason.includes('ability_started')
    || !lucianWReason.includes('standalone')
    || !lucianWReason.includes('external existing-data/check-only')
    || !lucianWReason.includes('identity/panel/resource')
    || !lucianWReason.includes('不暗示 Lucian Q dependence')
    || !lucianWReason.includes('不暗示 Batch-B')
    || !lucianWReason.includes('sibling Lucian synthesis')
    || !lucianWReason.includes('production runtime/ABI/Web change')
    || !lucianWReason.includes('不宣称')
    || !lucianWReason.includes('no equivalence or contradiction claim')
    || !lucianWReason.includes('equal size alone is not byte equality or source contradiction')
    || lucianWReason.includes('canonical byte equivalence')
    || lucianWReason.includes('Batch-B prerequisite')
    || lucianWReason.includes('live published')
    || !String(lucianW.sourceRef || '').includes('lucian-w.json')
    || !String(lucianW.sourceRef || '').includes(
      'b1ea7bc7a2e48be9ab97acfa1fc5addb80b8dd236dc97bd3d57c5e90951418c5',
    )
    || lucianW.auditBaseline?.gapCode !== 'blocked_data'
    || lucianW.auditBaseline?.resolvedBucket !== 'blocked'
    || lucianW.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(lucianW.auditBaseline?.mechanismTags || []).includes('meta_or_non_target_dps')
    || lucianW.classification !== 'out_of_scope_for_single_target_dps'
    || !(lucianW.mechanismTags || []).includes('meta_or_non_target_dps')
    || citesForbiddenProvenance(lucianW.classificationReason)
    || !(lucianW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.lucianArdentBlazePrimaryHit
        && e.taskKey === 'wasm-generic-lucian-ardent-blaze-primary-hit'
        && String(e.note || '').includes(lucianWBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('d57dc3b')
        && String(e.note || '').includes('a57b0e49')
        && String(e.note || '').includes('20221')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(lucianW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.lucianArdentBlazePrimaryHitBackend
        && e.taskKey === 'wasm-generic-lucian-ardent-blaze-primary-hit'
        && String(e.note || '').includes(lucianWBoundary)
        && String(e.note || '').includes('LolGenericLucianArdentBlazePrimaryHitSeedSqlTest')
        && String(e.note || '').includes('2b29c4e')
        && String(e.note || '').includes('7e8a40c')
        && String(e.note || '').includes('d57dc3b')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Lucian synthesis'),
    )
  ) {
    errors.push(
      'Lucian W must be migrated with empty remainingGap/missingFields, exact Ardent Blaze ordered tags (no dps_relevant_manual_review/meta_or_non_target_dps), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/meta_or_non_target_dps/auditBaseline provenance, Wiki rev3594941/SHA + local raw caveat + frozen completedBoundary, rank5 60mana/10000CD/one magic 215+0.90*AP numerics (AP0/MR0=215; AP0/MR100 raw215/final107.5; AP100/MR0=305; AP100/MR100 raw305/final152.5; AP200/MR100 raw395/final197.5; 20221/20170; no explicit event op; t0/t9999/t10000 mana180→60/HP695 two damage/two ability_started; mana59 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-Lucian-Q-dependence/no-production-runtime-ABI-Web framing, and bilateral wasm+backend evidence (owning 2b29c4e / integrated 7e8a40c / Wasm d57dc3b; no cast/missile/cross/mark/ms/Vigilance/live claim)',
    );
  }
  if (lucianW) {
    validateBilateralCoverageEvidence(
      lucianW.candidateKey,
      lucianW.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const lucianR = records.find((r) => r.candidateKey === 'hero_skill|hero_lucian|R|圣枪洗礼');
  const lucianRTags = [...(lucianR?.genericMechanismTags || [])];
  const lucianRExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const lucianRReason = String(lucianR?.classificationReason || '');
  const lucianRBoundary =
    'rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_lucian|R')) {
    errors.push('Lucian R exact override key hero_lucian|R must exist before fallback');
  }
  if (
    !lucianR
    || lucianR.candidateKey !== 'hero_skill|hero_lucian|R|圣枪洗礼'
    || lucianR.passiveName !== '圣枪洗礼'
    || lucianR.genericClassification !== 'migrated'
    || String(lucianR.remainingGap || '').trim()
    || (lucianR.dataGapEvidence?.missingFields || []).length !== 0
    || lucianRTags.join('|') !== lucianRExpectedTags.join('|')
    || lucianRTags.includes('dps_relevant_manual_review')
    || lucianRTags.includes('meta_or_non_target_dps')
    || lucianRTags.includes('bonus_ad_ratio')
    || lucianRTags.includes('total_ad_ratio')
    || String(lucianR.remainingGap || '').includes('blocked_data')
    || lucianRReason.includes('needs_manual_baseline')
    || lucianRReason.includes('blocked_data')
    || lucianRReason.includes('implementation_gap_no_unresolved_data_fields')
    || lucianRReason.includes('dps_relevant_manual_review')
    || lucianRReason.includes('out_of_scope_for_single_target_dps')
    || lucianRReason.includes('meta_or_non_target_dps')
    || lucianRReason.includes('depends on Lucian Q')
    || lucianRReason.includes('requires Lucian Q')
    || lucianRReason.includes('depends on Lucian W')
    || lucianRReason.includes('requires Lucian W')
    || lucianRReason.includes('bonus AD by explicit subtraction')
    || lucianRReason.includes('ad.resolved - source.attr.ad.base')
    || lucianRReason.includes('ad.resolved-ad.base')
    || lucianRReason.includes('total_ad_ratio')
    || !lucianRReason.includes('4007670')
    || !lucianRReason.includes(
      '7a4679542eebdebf25da391a1222f08df2f416c641f48473d528e62296b9a2f7',
    )
    || !lucianRReason.includes(
      'b63612287a8a965e7655829a2054aec7b019705225fd7e7b4736303a172bc74d',
    )
    || !lucianRReason.includes('Template:Data Lucian/R')
    || !lucianRReason.includes('Template:Data Lucian/The Culling')
    || !lucianRReason.includes('page1308182')
    || !lucianRReason.includes('bytes4477')
    || !lucianRReason.includes('2026-04-12T10:40:21Z')
    || !lucianRReason.includes(lucianRBoundary)
    || !lucianRReason.includes('source.attr.ad.resolved')
    || !lucianRReason.includes('source.attr.ap.resolved')
    || !lucianRReason.includes('nested binary')
    || !lucianRReason.includes('total AD direct read')
    || !lucianRReason.includes('never bonus AD')
    || !lucianRReason.includes('45')
    || !lucianRReason.includes('0.25')
    || !lucianRReason.includes('0.15')
    || !lucianRReason.includes('100 mana')
    || !lucianRReason.includes('90000')
    || !lucianRReason.includes('20220')
    || !lucianRReason.includes('20170')
    || !lucianRReason.includes('no explicit event op')
    || !lucianRReason.includes('baseAD0/resolvedAD0/AP0/armor0 raw=final45')
    || !lucianRReason.includes('baseAD60/resolvedAD60/AP0/armor0 raw=final60')
    || !lucianRReason.includes('baseAD60/resolvedAD160/AP0/armor0 raw=final85')
    || !lucianRReason.includes('baseAD60/resolvedAD160/AP100/armor0 raw=final100')
    || !lucianRReason.includes('baseAD60/resolvedAD160/AP100/armor100 raw100/final50')
    || !lucianRReason.includes('baseAD60/resolvedAD260/AP200/armor100 raw140/final70')
    || !lucianRReason.includes('baseAD0 vs baseAD60')
    || !lucianRReason.includes('t89999')
    || !lucianRReason.includes('t90000')
    || !lucianRReason.includes('mana300')
    || !lucianRReason.includes('mana99')
    || !lucianRReason.includes('HP900')
    || !lucianRReason.includes('shot-quantum')
    || !lucianRReason.includes('ability_started')
    || !lucianRReason.includes('standalone')
    || !lucianRReason.includes('external existing-data/check-only')
    || !lucianRReason.includes('identity/panel/resource')
    || !lucianRReason.includes('不暗示 Lucian Q/W dependence')
    || !lucianRReason.includes('不暗示 Batch-B')
    || !lucianRReason.includes('sibling Lucian synthesis')
    || !lucianRReason.includes('production runtime/ABI/Web change')
    || !lucianRReason.includes('StackOverflowError')
    || !lucianRReason.includes('nonblocking validation-runtime caveat')
    || !lucianRReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0')
    || !lucianRReason.includes('不宣称')
    || !lucianRReason.includes('no equivalence or contradiction claim')
    || !lucianRReason.includes('equal size alone is not byte equality or source contradiction')
    || !lucianRReason.includes('one damage quantum')
    || lucianRReason.includes('canonical byte equivalence')
    || lucianRReason.includes('Batch-B prerequisite')
    || lucianRReason.includes('live published')
    || !String(lucianR.sourceRef || '').includes('lucian-r.json')
    || !String(lucianR.sourceRef || '').includes(
      '7a4679542eebdebf25da391a1222f08df2f416c641f48473d528e62296b9a2f7',
    )
    || lucianR.auditBaseline?.gapCode !== 'blocked_data'
    || lucianR.auditBaseline?.resolvedBucket !== 'blocked'
    || lucianR.auditBaseline?.damageDisposition !== 'not_applicable'
    || !(lucianR.auditBaseline?.mechanismTags || []).includes('dps_relevant_manual_review')
    || lucianR.classification !== 'needs_manual_baseline'
    || !(lucianR.mechanismTags || []).includes('dps_relevant_manual_review')
    || citesForbiddenProvenance(lucianR.classificationReason)
    || !(lucianR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.lucianTheCullingSingleShotQuantum
        && e.taskKey === 'wasm-generic-lucian-the-culling-single-shot-quantum'
        && String(e.note || '').includes(lucianRBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('ab2d9f7')
        && String(e.note || '').includes('b6361228')
        && String(e.note || '').includes('20220')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(lucianR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.lucianTheCullingSingleShotQuantumBackend
        && e.taskKey === 'wasm-generic-lucian-the-culling-single-shot-quantum'
        && String(e.note || '').includes(lucianRBoundary)
        && String(e.note || '').includes('LolGenericLucianTheCullingSingleShotQuantumSeedSqlTest')
        && String(e.note || '').includes('a2f5bca')
        && String(e.note || '').includes('d83b09e')
        && String(e.note || '').includes('ab2d9f7')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Lucian synthesis'),
    )
  ) {
    errors.push(
      'Lucian R must be migrated with empty remainingGap/missingFields, exact The Culling ordered tags (no dps_relevant_manual_review/total_ad_ratio/bonus_ad_ratio; requires ap_ratio), stale blocked_data/needs_manual_baseline/implementation-gap cleared while retaining raw needs_manual_baseline/dps_relevant_manual_review/auditBaseline provenance, Wiki rev4007670/SHA + local raw caveat + frozen completedBoundary, rank3 100mana/90000CD/one physical shot quantum 45+0.25*totalAD+0.15*AP nested binary numerics (baseAD0/0/0/0=45; 60/60/0/0=60; 60/160/0/0=85; 60/160/100/0=100; 60/160/100/100 raw100/final50; 60/260/200/100 raw140/final70; baseAD0 vs baseAD60 both 100; 20220/20170; no explicit event op; t0/t89999/t90000 mana300→100/HP900 two shot-quantum damage/two ability_started; mana99 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-Q-W-dependence/no-production-runtime-ABI-Web framing, StackOverflow/nonblocking validation caveat + Wasm asset SHA, and bilateral wasm+backend evidence (owning a2f5bca / integrated d83b09e / Wasm ab2d9f7; one damage quantum not total R; no channel/recast/shot-count/live claim)',
    );
  }
  if (lucianR) {
    validateBilateralCoverageEvidence(
      lucianR.candidateKey,
      lucianR.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const caitlynR = records.find((r) => r.candidateKey === 'hero_skill|hero_caitlyn|R|让子弹飞');
  const caitlynRTags = [...(caitlynR?.genericMechanismTags || [])];
  const caitlynRExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'bonus_ad_ratio',
    'immediate_impact_scaffold',
  ];
  const caitlynRReason = String(caitlynR?.classificationReason || '');
  const caitlynRBoundary =
    'rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_caitlyn|R')) {
    errors.push('Caitlyn R exact override key hero_caitlyn|R must exist before fallback');
  }
  if (
    !caitlynR
    || caitlynR.candidateKey !== 'hero_skill|hero_caitlyn|R|让子弹飞'
    || caitlynR.passiveName !== '让子弹飞'
    || caitlynR.genericClassification !== 'migrated'
    || String(caitlynR.remainingGap || '').trim()
    || (caitlynR.dataGapEvidence?.missingFields || []).length !== 0
    || caitlynRTags.join('|') !== caitlynRExpectedTags.join('|')
    || caitlynRTags.includes('dps_relevant_manual_review')
    || caitlynRTags.includes('meta_or_non_target_dps')
    || caitlynRTags.includes('total_ad_ratio')
    || !caitlynRTags.includes('bonus_ad_ratio')
    || String(caitlynR.remainingGap || '').includes('blocked_data')
    || caitlynRReason.includes('needs_manual_baseline')
    || caitlynRReason.includes('blocked_data')
    || caitlynRReason.includes('implementation_gap_no_unresolved_data_fields')
    || caitlynRReason.includes('dps_relevant_manual_review')
    || caitlynRReason.includes('out_of_scope_for_single_target_dps')
    || caitlynRReason.includes('meta_or_non_target_dps')
    || caitlynRReason.includes('depends on Caitlyn Q')
    || caitlynRReason.includes('requires Caitlyn Q')
    || caitlynRReason.includes('depends on Caitlyn E')
    || caitlynRReason.includes('requires Caitlyn E')
    || caitlynRReason.includes('total AD；')
    || caitlynRReason.includes('total_ad_ratio')
    || caitlynRReason.includes('*totalAD')
    || !caitlynRReason.includes('3982561')
    || !caitlynRReason.includes(
      '08b488c97fc694d9a3de711ffd4ea0b95fc1746c3a11b9c44b878844e586e8a8',
    )
    || !caitlynRReason.includes(
      '015c1dbe8f02dd5ac354e6a6da6def878f1acccf788b1f599ee4bfd589e05003',
    )
    || !caitlynRReason.includes('Template:Data Caitlyn/R')
    || !caitlynRReason.includes('Template:Data Caitlyn/Ace in the Hole')
    || !caitlynRReason.includes('page1306918')
    || !caitlynRReason.includes('bytes3119')
    || !caitlynRReason.includes('2026-01-09T09:02:59Z')
    || !caitlynRReason.includes(caitlynRBoundary)
    || !caitlynRReason.includes('source.attr.ad.resolved - source.attr.ad.base')
    || !caitlynRReason.includes('exact nested binary formula')
    || !caitlynRReason.includes('bonus AD by explicit subtraction')
    || !caitlynRReason.includes('不得按 total-AD 直读')
    || !caitlynRReason.includes('650')
    || !caitlynRReason.includes('1.00')
    || !caitlynRReason.includes('100 mana')
    || !caitlynRReason.includes('90000')
    || !caitlynRReason.includes('20220')
    || !caitlynRReason.includes('20170')
    || !caitlynRReason.includes('no explicit event op')
    || !caitlynRReason.includes('base0/resolved0/armor0 raw=final650')
    || !caitlynRReason.includes('base60/resolved60/armor0 raw=final650')
    || !caitlynRReason.includes('base60/resolved160/armor0 raw=final750')
    || !caitlynRReason.includes('base60/resolved160/armor100 raw750/final375')
    || !caitlynRReason.includes('base60/resolved260/armor100 raw850/final425')
    || !caitlynRReason.includes('base0/resolved100 versus base60/resolved160')
    || !caitlynRReason.includes('t89999')
    || !caitlynRReason.includes('t90000')
    || !caitlynRReason.includes('mana300')
    || !caitlynRReason.includes('mana99')
    || !caitlynRReason.includes('HP250')
    || !caitlynRReason.includes('bullet-quantum')
    || !caitlynRReason.includes('ability_started')
    || !caitlynRReason.includes('standalone')
    || !caitlynRReason.includes('external existing-data/check-only')
    || !caitlynRReason.includes('identity/panel/resource')
    || !caitlynRReason.includes('不暗示 Caitlyn Q/E dependence')
    || !caitlynRReason.includes('不暗示 Batch-B')
    || !caitlynRReason.includes('sibling Caitlyn synthesis')
    || !caitlynRReason.includes('production runtime/ABI/Web change')
    || !caitlynRReason.includes('StackOverflowError')
    || !caitlynRReason.includes('nonblocking validation-runtime caveat')
    || !caitlynRReason.includes('MAVEN_OPTS=-Xss4m')
    || !caitlynRReason.includes('902/902')
    || !caitlynRReason.includes('focused9/adjacent27/full902')
    || !caitlynRReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0')
    || !caitlynRReason.includes('不宣称')
    || !caitlynRReason.includes('no equivalence or contradiction claim')
    || !caitlynRReason.includes('equal size alone is not byte equality or source contradiction')
    || !caitlynRReason.includes('exactly one selected-target quantum')
    || caitlynRReason.includes('canonical byte equivalence')
    || caitlynRReason.includes('Batch-B prerequisite')
    || caitlynRReason.includes('live published')
    || !String(caitlynR.sourceRef || '').includes('caitlyn-r.json')
    || !String(caitlynR.sourceRef || '').includes(
      '08b488c97fc694d9a3de711ffd4ea0b95fc1746c3a11b9c44b878844e586e8a8',
    )
    || caitlynR.auditBaseline?.gapCode !== 'blocked_data'
    || caitlynR.auditBaseline?.resolvedBucket !== 'blocked'
    || caitlynR.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(caitlynR.auditBaseline?.mechanismTags || []).includes('meta_or_non_target_dps')
    || caitlynR.classification !== 'out_of_scope_for_single_target_dps'
    || !(caitlynR.mechanismTags || []).includes('meta_or_non_target_dps')
    || citesForbiddenProvenance(caitlynR.classificationReason)
    || !(caitlynR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.caitlynAceInTheHoleSingleBulletQuantum
        && e.taskKey === 'wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum'
        && String(e.note || '').includes(caitlynRBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('9fc57e7')
        && String(e.note || '').includes('015c1dbe')
        && String(e.note || '').includes('20220')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(caitlynR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.caitlynAceInTheHoleSingleBulletQuantumBackend
        && e.taskKey === 'wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum'
        && String(e.note || '').includes(caitlynRBoundary)
        && String(e.note || '').includes('LolGenericCaitlynAceInTheHoleSingleBulletQuantumSeedSqlTest')
        && String(e.note || '').includes('f088e18')
        && String(e.note || '').includes('486b8d8')
        && String(e.note || '').includes('9fc57e7')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Caitlyn synthesis'),
    )
  ) {
    errors.push(
      'Caitlyn R must be migrated with empty remainingGap/missingFields, exact Ace in the Hole ordered tags (no dps_relevant_manual_review/total_ad_ratio; requires bonus_ad_ratio), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/meta_or_non_target_dps/auditBaseline provenance, Wiki rev3982561/SHA + local raw caveat + frozen completedBoundary, rank3 100mana/90000CD/one physical bullet quantum 650+1.00*bonusAD via nested binary sub(ad.resolved,ad.base) numerics (base0/0/0=650; 60/60/0=650; 60/160/0=750; 60/160/100 raw750/final375; 60/260/100 raw850/final425; base0/resolved100 vs base60/resolved160 both750; 20220/20170; no explicit event op; t0/t89999/t90000 mana300→100/HP250 two damage/two ability_started; mana99 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-Q-E-dependence/no-production-runtime-ABI-Web framing, StackOverflow/MAVEN_OPTS/nonblocking validation caveat + Wasm asset SHA, and bilateral wasm+backend evidence (owning f088e18 / integrated 486b8d8 / Wasm 9fc57e7; one selected-target quantum not full R; no channel/reveal/homing/projectile/crit/live claim)',
    );
  }
  if (caitlynR) {
    validateBilateralCoverageEvidence(
      caitlynR.candidateKey,
      caitlynR.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const tristanaQ = records.find((r) => r.candidateKey === 'hero_skill|hero_tristana|Q|急速射击');
  const tristanaQTags = [...(tristanaQ?.genericMechanismTags || [])];
  const tristanaQExpectedTags = [
    'ability_cost_cooldown',
    'active_attack_speed_modifier',
    'timed_state',
    'ability_type_listener_isolation',
  ];
  const tristanaQReason = String(tristanaQ?.classificationReason || '');
  const tristanaQBoundary =
    'rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot; no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_tristana|Q')) {
    errors.push('Tristana Q exact override key hero_tristana|Q must exist before fallback');
  }
  if (
    !tristanaQ
    || tristanaQ.candidateKey !== 'hero_skill|hero_tristana|Q|急速射击'
    || tristanaQ.passiveName !== '急速射击'
    || tristanaQ.genericClassification !== 'migrated'
    || String(tristanaQ.remainingGap || '').trim()
    || (tristanaQ.dataGapEvidence?.missingFields || []).length !== 0
    || tristanaQTags.join('|') !== tristanaQExpectedTags.join('|')
    || tristanaQTags.includes('dps_relevant_manual_review')
    || tristanaQTags.includes('meta_or_non_target_dps')
    || tristanaQTags.includes('cast_triggered_timed_attack_speed')
    || tristanaQTags.includes('attack_speed_percent_add')
    || String(tristanaQ.remainingGap || '').includes('blocked_data')
    || tristanaQReason.includes('needs_manual_baseline')
    || tristanaQReason.includes('blocked_data')
    || tristanaQReason.includes('implementation_gap_no_unresolved_data_fields')
    || tristanaQReason.includes('dps_relevant_manual_review')
    || tristanaQReason.includes('depends on Tristana R')
    || tristanaQReason.includes('depends on Buster Shot')
    || tristanaQReason.includes('requires Buster Shot')
    || !tristanaQReason.includes('4026462')
    || !tristanaQReason.includes(
      'f6465863035c4634510ecc96e9ee04f4a998d150871d88e498e6636e27a9d4da',
    )
    || !tristanaQReason.includes(
      'db084b4142559f0775af841fe163e1b80880e2661b26b6d82fb26261e1f5d170',
    )
    || !tristanaQReason.includes('Template:Data Tristana/Q')
    || !tristanaQReason.includes('Template:Data Tristana/Rapid Fire')
    || !tristanaQReason.includes('page1308522')
    || !tristanaQReason.includes('bytes872')
    || !tristanaQReason.includes('bytes866')
    || !tristanaQReason.includes('2026-06-09T21:59:03Z')
    || !tristanaQReason.includes(tristanaQBoundary)
    || !tristanaQReason.includes('35 mana')
    || !tristanaQReason.includes('16000')
    || !tristanaQReason.includes('7000')
    || !tristanaQReason.includes('1.20*rapid_fire_active')
    || !tristanaQReason.includes('62013')
    || !tristanaQReason.includes('ability/tristana_rapid_fire')
    || !tristanaQReason.includes('empty AbilityRef')
    || !tristanaQReason.includes('no damage or explicit event')
    || !tristanaQReason.includes('AS0.60')
    || !tristanaQReason.includes('1.32')
    || !tristanaQReason.includes('through6999')
    || !tristanaQReason.includes('at7000')
    || !tristanaQReason.includes('t15999')
    || !tristanaQReason.includes('t16000')
    || !tristanaQReason.includes('mana105')
    || !tristanaQReason.includes('mana34')
    || !tristanaQReason.includes('mana35')
    || !tristanaQReason.includes('R does not arm Q')
    || !tristanaQReason.includes('Q causes no R damage')
    || !tristanaQReason.includes('ability_started')
    || !tristanaQReason.includes('standalone')
    || !tristanaQReason.includes('external existing-data/check-only')
    || !tristanaQReason.includes('identity/panel/resource')
    || !tristanaQReason.includes('不暗示 Tristana P/W/E/Explosive Charge dependence')
    || !tristanaQReason.includes('不暗示 Batch-B')
    || !tristanaQReason.includes('sibling Tristana synthesis')
    || !tristanaQReason.includes('production runtime/ABI/Web change')
    || !tristanaQReason.includes('focused11/adjacent49/full922')
    || !tristanaQReason.includes('focused6')
    || !tristanaQReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0')
    || !tristanaQReason.includes('不宣称')
    || !tristanaQReason.includes('no equivalence or contradiction claim')
    || tristanaQReason.includes('canonical byte equivalence')
    || tristanaQReason.includes('Batch-B prerequisite')
    || tristanaQReason.includes('live published')
    || !String(tristanaQ.sourceRef || '').includes('tristana-q.json')
    || !String(tristanaQ.sourceRef || '').includes(
      'f6465863035c4634510ecc96e9ee04f4a998d150871d88e498e6636e27a9d4da',
    )
    || tristanaQ.auditBaseline?.gapCode !== 'blocked_data'
    || tristanaQ.auditBaseline?.resolvedBucket !== 'blocked'
    || tristanaQ.auditBaseline?.damageDisposition !== 'not_applicable'
    || !(tristanaQ.auditBaseline?.mechanismTags || []).includes('dps_relevant_manual_review')
    || tristanaQ.classification !== 'needs_manual_baseline'
    || !(tristanaQ.mechanismTags || []).includes('dps_relevant_manual_review')
    || citesForbiddenProvenance(tristanaQ.classificationReason)
    || !(tristanaQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.tristanaRapidFireTimedBonusAttackSpeed
        && e.taskKey === 'wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed'
        && String(e.note || '').includes(tristanaQBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('ddbca0f')
        && String(e.note || '').includes('db084b41')
        && String(e.note || '').includes('62013')
        && String(e.note || '').includes('1.20*rapid_fire_active')
        && String(e.note || '').includes('no damage or explicit event')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(tristanaQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.tristanaRapidFireTimedBonusAttackSpeedBackend
        && e.taskKey === 'wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed'
        && String(e.note || '').includes(tristanaQBoundary)
        && String(e.note || '').includes('LolGenericTristanaRapidFireTimedBonusAttackSpeedSeedSqlTest')
        && String(e.note || '').includes('abc7500')
        && String(e.note || '').includes('5d468bf')
        && String(e.note || '').includes('ddbca0f')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Tristana synthesis'),
    )
  ) {
    errors.push(
      'Tristana Q must be migrated with empty remainingGap/missingFields, exact Rapid Fire ordered tags (no dps_relevant_manual_review; requires ability_cost_cooldown/active_attack_speed_modifier/timed_state/ability_type_listener_isolation), stale blocked_data/implementation-gap cleared while retaining raw needs_manual_baseline/dps_relevant_manual_review/auditBaseline provenance, Wiki rev4026462/SHA + local raw caveat + frozen completedBoundary, rank5 35mana/16000CD/timed7000/AS percent_add 1.20*rapid_fire_active/type62013/empty AbilityRef all-match numerics (AS0.60→1.32 through6999→0.60 at7000; mana105 t0/t15999/t16000 success/skip/success two starts final mana35/AS1.32; mana34 skip; R does not arm Q and Q causes no R damage), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-Buster-Shot-dependence/no-production-runtime-ABI-Web framing, focused11/adjacent49/full922 + focused6 + Wasm asset SHA, and bilateral wasm+backend evidence (owning abc7500 / integrated 5d468bf / Wasm ddbca0f; timed AS not full Q; no rank-up/animation/windup/basic-count/live claim)',
    );
  }
  if (tristanaQ) {
    validateBilateralCoverageEvidence(
      tristanaQ.candidateKey,
      tristanaQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const tristanaR = records.find((r) => r.candidateKey === 'hero_skill|hero_tristana|R|毁灭射击');
  const tristanaRTags = [...(tristanaR?.genericMechanismTags || [])];
  const tristanaRExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'bonus_ad_ratio',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const tristanaRReason = String(tristanaR?.classificationReason || '');
  const tristanaRBoundary =
    'rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_325_plus_0_70_bonus_ad_plus_1_00_ap; no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_tristana|R')) {
    errors.push('Tristana R exact override key hero_tristana|R must exist before fallback');
  }
  if (
    !tristanaR
    || tristanaR.candidateKey !== 'hero_skill|hero_tristana|R|毁灭射击'
    || tristanaR.passiveName !== '毁灭射击'
    || tristanaR.genericClassification !== 'migrated'
    || String(tristanaR.remainingGap || '').trim()
    || (tristanaR.dataGapEvidence?.missingFields || []).length !== 0
    || tristanaRTags.join('|') !== tristanaRExpectedTags.join('|')
    || tristanaRTags.includes('multi_target_or_area')
    || tristanaRTags.includes('meta_or_non_target_dps')
    || tristanaRTags.includes('dps_relevant_manual_review')
    || tristanaRTags.includes('total_ad_ratio')
    || !tristanaRTags.includes('bonus_ad_ratio')
    || !tristanaRTags.includes('ap_ratio')
    || !tristanaRTags.includes('active_magic_damage')
    || String(tristanaR.remainingGap || '').includes('blocked_data')
    || tristanaRReason.includes('needs_manual_baseline')
    || tristanaRReason.includes('blocked_data')
    || tristanaRReason.includes('implementation_gap_no_unresolved_data_fields')
    || tristanaRReason.includes('multi_target_or_area')
    || tristanaRReason.includes('out_of_scope_for_single_target_dps')
    || tristanaRReason.includes('dps_relevant_manual_review')
    || tristanaRReason.includes('depends on Tristana P')
    || tristanaRReason.includes('depends on Explosive Charge')
    || tristanaRReason.includes('requires Explosive Charge')
    || tristanaRReason.includes('total AD；')
    || tristanaRReason.includes('total_ad_ratio')
    || tristanaRReason.includes('*totalAD')
    || !tristanaRReason.includes('4008205')
    || !tristanaRReason.includes(
      '2dff322949f442acc00a7074458fd5ed9bc542d6fd143b818a9a7151e117c058',
    )
    || !tristanaRReason.includes(
      '42e07f07f3188aada86d18d782c05d291f031dbbf92171e4a1120e828ebf8c7b',
    )
    || !tristanaRReason.includes('Template:Data Tristana/R')
    || !tristanaRReason.includes('Template:Data Tristana/Buster Shot')
    || !tristanaRReason.includes('page1308525')
    || !tristanaRReason.includes('bytes2385')
    || !tristanaRReason.includes('bytes2382')
    || !tristanaRReason.includes('2026-04-14T05:37:16Z')
    || !tristanaRReason.includes(tristanaRBoundary)
    || !tristanaRReason.includes('source.attr.ad.resolved-source.attr.ad.base')
    || !tristanaRReason.includes('exact nested binary formula')
    || !tristanaRReason.includes('bonus AD by explicit subtraction')
    || !tristanaRReason.includes('不得按 total-AD 直读')
    || !tristanaRReason.includes('add(add(325,0.70*')
    || !tristanaRReason.includes('325')
    || !tristanaRReason.includes('0.70')
    || !tristanaRReason.includes('1.00')
    || !tristanaRReason.includes('100 mana')
    || !tristanaRReason.includes('100000')
    || !tristanaRReason.includes('20221')
    || !tristanaRReason.includes('20170')
    || !tristanaRReason.includes('no explicit event op')
    || !tristanaRReason.includes('base0/resolved0/AP0/MR0 raw=final325')
    || !tristanaRReason.includes('base60/resolved60/AP0/MR0 raw=final325')
    || !tristanaRReason.includes('base60/resolved160/AP0/MR0 raw=final395')
    || !tristanaRReason.includes('base60/resolved160/AP100/MR0 raw=final495')
    || !tristanaRReason.includes('base60/resolved160/AP100/MR100 raw495/final247.5')
    || !tristanaRReason.includes('base60/resolved260/AP200/MR100 raw665/final332.5')
    || !tristanaRReason.includes('base0/resolved100 versus base60/resolved160')
    || !tristanaRReason.includes('t99999')
    || !tristanaRReason.includes('t100000')
    || !tristanaRReason.includes('mana300')
    || !tristanaRReason.includes('mana99')
    || !tristanaRReason.includes('HP505')
    || !tristanaRReason.includes('ability_started')
    || !tristanaRReason.includes('standalone')
    || !tristanaRReason.includes('external existing-data/check-only')
    || !tristanaRReason.includes('identity/panel/resource')
    || !tristanaRReason.includes('不暗示 Tristana P/Q/W/E/Explosive Charge dependence')
    || !tristanaRReason.includes('不暗示 Batch-B')
    || !tristanaRReason.includes('sibling Tristana synthesis')
    || !tristanaRReason.includes('production runtime/ABI/Web change')
    || !tristanaRReason.includes('focused9/adjacent53/full911')
    || !tristanaRReason.includes('focused7')
    || !tristanaRReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0')
    || !tristanaRReason.includes('不宣称')
    || !tristanaRReason.includes('no equivalence or contradiction claim')
    || !tristanaRReason.includes('exactly one selected-target magic hit')
    || tristanaRReason.includes('canonical byte equivalence')
    || tristanaRReason.includes('Batch-B prerequisite')
    || tristanaRReason.includes('live published')
    || !String(tristanaR.sourceRef || '').includes('tristana-r.json')
    || !String(tristanaR.sourceRef || '').includes(
      '2dff322949f442acc00a7074458fd5ed9bc542d6fd143b818a9a7151e117c058',
    )
    || tristanaR.auditBaseline?.gapCode !== 'blocked_data'
    || tristanaR.auditBaseline?.resolvedBucket !== 'blocked'
    || tristanaR.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(tristanaR.auditBaseline?.mechanismTags || []).includes('multi_target_or_area')
    || tristanaR.classification !== 'out_of_scope_for_single_target_dps'
    || !(tristanaR.mechanismTags || []).includes('multi_target_or_area')
    || citesForbiddenProvenance(tristanaR.classificationReason)
    || !(tristanaR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.tristanaBusterShotPrimaryHit
        && e.taskKey === 'wasm-generic-tristana-buster-shot-primary-hit'
        && String(e.note || '').includes(tristanaRBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('b4d10e4')
        && String(e.note || '').includes('42e07f07')
        && String(e.note || '').includes('20221')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(tristanaR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.tristanaBusterShotPrimaryHitBackend
        && e.taskKey === 'wasm-generic-tristana-buster-shot-primary-hit'
        && String(e.note || '').includes(tristanaRBoundary)
        && String(e.note || '').includes('LolGenericTristanaBusterShotPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('8b98bcb')
        && String(e.note || '').includes('30209c4')
        && String(e.note || '').includes('b4d10e4')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Tristana synthesis'),
    )
  ) {
    errors.push(
      'Tristana R must be migrated with empty remainingGap/missingFields, exact Buster Shot ordered tags (no multi_target_or_area; requires bonus_ad_ratio/ap_ratio/active_magic_damage), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/multi_target_or_area/auditBaseline provenance, Wiki rev4008205/SHA + local raw caveat + frozen completedBoundary, rank3 100mana/100000CD/one magic 325+0.70*bonusAD+1.00*AP via nested binary numerics (325/325/395/495/495→247.5/665→332.5; bonusAD counterproof; 20221/20170; no explicit event op; t0/t99999/t100000 mana300→100/HP505 two damage/two ability_started; mana99 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-Explosive-Charge-dependence/no-production-runtime-ABI-Web framing, focused9/adjacent53/full911 + focused7 + Wasm asset SHA, and bilateral wasm+backend evidence (owning 8b98bcb / integrated 30209c4 / Wasm b4d10e4; one selected-target magic hit not full R; no cast/knockback/stun/reveal/secondary/live claim)',
    );
  }
  if (tristanaR) {
    validateBilateralCoverageEvidence(
      tristanaR.candidateKey,
      tristanaR.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const tristanaW = records.find((r) => r.candidateKey === 'hero_skill|hero_tristana|W|火箭跳跃');
  const tristanaWTags = [...(tristanaW?.genericMechanismTags || [])];
  const tristanaWExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'bonus_ad_ratio',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const tristanaWReason = String(tristanaW?.classificationReason || '');
  const tristanaWBoundary =
    'rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_tristana|W')) {
    errors.push('Tristana W exact override key hero_tristana|W must exist before fallback');
  }
  if (
    !tristanaW
    || tristanaW.candidateKey !== 'hero_skill|hero_tristana|W|火箭跳跃'
    || tristanaW.passiveName !== '火箭跳跃'
    || tristanaW.genericClassification !== 'migrated'
    || String(tristanaW.remainingGap || '').trim()
    || (tristanaW.dataGapEvidence?.missingFields || []).length !== 0
    || tristanaWTags.join('|') !== tristanaWExpectedTags.join('|')
    || tristanaWTags.includes('multi_target_or_area')
    || tristanaWTags.includes('meta_or_non_target_dps')
    || tristanaWTags.includes('dps_relevant_manual_review')
    || tristanaWTags.includes('primary_damage_branch_salvage')
    || tristanaWTags.includes('total_ad_ratio')
    || !tristanaWTags.includes('bonus_ad_ratio')
    || !tristanaWTags.includes('ap_ratio')
    || !tristanaWTags.includes('active_magic_damage')
    || String(tristanaW.remainingGap || '').includes('blocked_data')
    || tristanaWReason.includes('needs_manual_baseline')
    || tristanaWReason.includes('blocked_data')
    || tristanaWReason.includes('implementation_gap_no_unresolved_data_fields')
    || tristanaWReason.includes('multi_target_or_area')
    || tristanaWReason.includes('out_of_scope_for_single_target_dps')
    || tristanaWReason.includes('dps_relevant_manual_review')
    || tristanaWReason.includes('depends on Tristana P')
    || tristanaWReason.includes('depends on Explosive Charge')
    || tristanaWReason.includes('requires Explosive Charge')
    || tristanaWReason.includes('total AD；')
    || tristanaWReason.includes('total_ad_ratio')
    || tristanaWReason.includes('*totalAD')
    || !tristanaWReason.includes('4007758')
    || !tristanaWReason.includes(
      'cf0e3ae91310ab5e7cc04408941671520e3464f75bc61da683b100ea82e56eec',
    )
    || !tristanaWReason.includes(
      '7283b2eb2020c20c6e48098e647ba4782b6dc134705c7c668d7e7279da1cabd9',
    )
    || !tristanaWReason.includes('Template:Data Tristana/W')
    || !tristanaWReason.includes('Template:Data Tristana/Rocket Jump')
    || !tristanaWReason.includes('page1308523')
    || !tristanaWReason.includes('bytes2444')
    || !tristanaWReason.includes('bytes2443')
    || !tristanaWReason.includes('2026-04-12T14:13:05Z')
    || !tristanaWReason.includes(tristanaWBoundary)
    || !tristanaWReason.includes('source.attr.ad.resolved-source.attr.ad.base')
    || !tristanaWReason.includes('exact nested binary formula')
    || !tristanaWReason.includes('bonus AD by explicit subtraction')
    || !tristanaWReason.includes('不得按 total-AD 直读')
    || !tristanaWReason.includes('add(add(210,1.00*')
    || !tristanaWReason.includes('210')
    || !tristanaWReason.includes('1.00')
    || !tristanaWReason.includes('0.50')
    || !tristanaWReason.includes('50 mana')
    || !tristanaWReason.includes('14000')
    || !tristanaWReason.includes('20221')
    || !tristanaWReason.includes('20170')
    || !tristanaWReason.includes('no 20230')
    || !tristanaWReason.includes('no explicit event op')
    || !tristanaWReason.includes('no W ability-specific type')
    || !tristanaWReason.includes('no type62013')
    || !tristanaWReason.includes('base0/resolved0/AP0/MR0 raw=final210')
    || !tristanaWReason.includes('base60/resolved60/AP0/MR0 raw=final210')
    || !tristanaWReason.includes('base60/resolved160/AP0/MR0 raw=final310')
    || !tristanaWReason.includes('base60/resolved160/AP100/MR0 raw=final360')
    || !tristanaWReason.includes('base60/resolved160/AP100/MR100 raw360/final180')
    || !tristanaWReason.includes('base60/resolved260/AP200/MR100 raw510/final255')
    || !tristanaWReason.includes('base0/resolved100 versus base60/resolved160')
    || !tristanaWReason.includes('t13999')
    || !tristanaWReason.includes('t14000')
    || !tristanaWReason.includes('mana150')
    || !tristanaWReason.includes('mana49')
    || !tristanaWReason.includes('HP640')
    || !tristanaWReason.includes('ability_started')
    || !tristanaWReason.includes('W does not arm Q')
    || !tristanaWReason.includes('Q causes no W damage')
    || !tristanaWReason.includes('standalone')
    || !tristanaWReason.includes('external existing-data/check-only')
    || !tristanaWReason.includes('identity/panel/resource')
    || !tristanaWReason.includes('不暗示 Tristana P/Q/E/Explosive Charge/R dependence')
    || !tristanaWReason.includes('不暗示 Batch-B')
    || !tristanaWReason.includes('sibling Tristana synthesis')
    || !tristanaWReason.includes('production runtime/ABI/Web change')
    || !tristanaWReason.includes('focused10/adjacent57/full932')
    || !tristanaWReason.includes('focused7')
    || !tristanaWReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0')
    || !tristanaWReason.includes('不宣称')
    || !tristanaWReason.includes('no equivalence or contradiction claim')
    || !tristanaWReason.includes('exactly one selected-target magic landing hit')
    || tristanaWReason.includes('canonical byte equivalence')
    || tristanaWReason.includes('Batch-B prerequisite')
    || tristanaWReason.includes('live published')
    || !String(tristanaW.sourceRef || '').includes('tristana-w.json')
    || !String(tristanaW.sourceRef || '').includes(
      'cf0e3ae91310ab5e7cc04408941671520e3464f75bc61da683b100ea82e56eec',
    )
    || tristanaW.auditBaseline?.gapCode !== 'blocked_data'
    || tristanaW.auditBaseline?.resolvedBucket !== 'blocked'
    || tristanaW.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(tristanaW.auditBaseline?.mechanismTags || []).includes('multi_target_or_area')
    || tristanaW.classification !== 'out_of_scope_for_single_target_dps'
    || !(tristanaW.mechanismTags || []).includes('multi_target_or_area')
    || citesForbiddenProvenance(tristanaW.classificationReason)
    || !(tristanaW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.tristanaRocketJumpPrimaryLandingHit
        && e.taskKey === 'wasm-generic-tristana-rocket-jump-primary-landing-hit'
        && String(e.note || '').includes(tristanaWBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('9d2716c')
        && String(e.note || '').includes('7283b2eb')
        && String(e.note || '').includes('20221')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no 20230')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('no W type')
        && String(e.note || '').includes('no type62013')
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('W does not arm Q')
        && String(e.note || '').includes('Q causes no W damage')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(tristanaW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.tristanaRocketJumpPrimaryLandingHitBackend
        && e.taskKey === 'wasm-generic-tristana-rocket-jump-primary-landing-hit'
        && String(e.note || '').includes(tristanaWBoundary)
        && String(e.note || '').includes('LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest')
        && String(e.note || '').includes('7cafeab')
        && String(e.note || '').includes('ac304d3')
        && String(e.note || '').includes('9d2716c')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Tristana synthesis'),
    )
  ) {
    errors.push(
      'Tristana W must be migrated with empty remainingGap/missingFields, exact Rocket Jump ordered tags (no multi_target_or_area/primary_damage_branch_salvage; requires bonus_ad_ratio/ap_ratio/active_magic_damage), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/multi_target_or_area/auditBaseline provenance, Wiki rev4007758/SHA + local raw caveat + frozen completedBoundary, rank5 50mana/14000CD/one magic 210+1.00*bonusAD+0.50*AP via nested binary numerics (210/210/310/360/360→180/510→255; bonusAD counterproof; 20221/20170; no 20230; no W type/no type62013; no explicit event op; t0/t13999/t14000 mana150→50/HP640 two damage/two ability_started; mana49 skip; W does not arm Q and Q causes no W damage), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-Explosive-Charge-dependence/no-production-runtime-ABI-Web framing, focused10/adjacent57/full932 + focused7 + Wasm asset SHA, and bilateral wasm+backend evidence (owning 7cafeab / integrated ac304d3 / Wasm 9d2716c; one selected-target magic landing hit not full W; no dash/cast/air-time/AOE/slow/live claim)',
    );
  }
  if (tristanaW) {
    validateBilateralCoverageEvidence(
      tristanaW.candidateKey,
      tristanaW.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const corkiQ = records.find((r) => r.candidateKey === 'hero_skill|hero_corki|Q|磷光炸弹');
  const corkiQTags = [...(corkiQ?.genericMechanismTags || [])];
  const corkiQExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'bonus_ad_ratio',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const corkiQReason = String(corkiQ?.classificationReason || '');
  const corkiQBoundary =
    'rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_corki|Q')) {
    errors.push('Corki Q exact override key hero_corki|Q must exist before fallback');
  }
  if (
    !corkiQ
    || corkiQ.candidateKey !== 'hero_skill|hero_corki|Q|磷光炸弹'
    || corkiQ.passiveName !== '磷光炸弹'
    || corkiQ.genericClassification !== 'migrated'
    || String(corkiQ.remainingGap || '').trim()
    || (corkiQ.dataGapEvidence?.missingFields || []).length !== 0
    || corkiQTags.join('|') !== corkiQExpectedTags.join('|')
    || corkiQTags.includes('multi_target_or_area')
    || corkiQTags.includes('meta_or_non_target_dps')
    || corkiQTags.includes('dps_relevant_manual_review')
    || corkiQTags.includes('primary_damage_branch_salvage')
    || corkiQTags.includes('total_ad_ratio')
    || !corkiQTags.includes('bonus_ad_ratio')
    || !corkiQTags.includes('ap_ratio')
    || !corkiQTags.includes('active_magic_damage')
    || String(corkiQ.remainingGap || '').includes('blocked_data')
    || corkiQReason.includes('needs_manual_baseline')
    || corkiQReason.includes('blocked_data')
    || corkiQReason.includes('implementation_gap_no_unresolved_data_fields')
    || corkiQReason.includes('multi_target_or_area')
    || corkiQReason.includes('meta_or_non_target_dps')
    || corkiQReason.includes('out_of_scope_for_single_target_dps')
    || corkiQReason.includes('dps_relevant_manual_review')
    || corkiQReason.includes('primary_damage_branch_salvage')
    || corkiQReason.includes('total AD；')
    || corkiQReason.includes('total_ad_ratio')
    || corkiQReason.includes('*totalAD')
    || !corkiQReason.includes('4007588')
    || !corkiQReason.includes(
      'e71a474ef6b4df1df4808b397c8bd0f42ce284234f3eb7603fab09cabd760365',
    )
    || !corkiQReason.includes(
      'c39556a0d90226462e8a939ebe58888ec91325a9ca4d10be23e43dd77d948ba6',
    )
    || !corkiQReason.includes('Template:Data Corki/Q')
    || !corkiQReason.includes('Template:Data Corki/Phosphorus Bomb')
    || !corkiQReason.includes('page1306953')
    || !corkiQReason.includes('bytes1531')
    || !corkiQReason.includes('bytes1529')
    || !corkiQReason.includes('2026-04-12T06:50:59Z')
    || !corkiQReason.includes(corkiQBoundary)
    || !corkiQReason.includes('source.attr.ad.resolved')
    || !corkiQReason.includes('source.attr.ad.base')
    || !corkiQReason.includes('exact nested binary formula')
    || !corkiQReason.includes('bonus AD by explicit subtraction')
    || !corkiQReason.includes('不得按 total-AD 直读')
    || !corkiQReason.includes('add(add(const 240')
    || !corkiQReason.includes('1.25')
    || !corkiQReason.includes('1.00')
    || !corkiQReason.includes('80 mana')
    || !corkiQReason.includes('7000')
    || !corkiQReason.includes('20221')
    || !corkiQReason.includes('20170')
    || !corkiQReason.includes('no 20230')
    || !corkiQReason.includes('no explicit event op')
    || !corkiQReason.includes('no Q ability-specific type')
    || !corkiQReason.includes('raw=final240')
    || !corkiQReason.includes('raw=final365')
    || !corkiQReason.includes('raw=final340')
    || !corkiQReason.includes('raw=final465')
    || !corkiQReason.includes('raw460/final230')
    || !corkiQReason.includes('raw540/final270')
    || !corkiQReason.includes('both365')
    || !corkiQReason.includes('t6999')
    || !corkiQReason.includes('t7000')
    || !corkiQReason.includes('mana240')
    || !corkiQReason.includes('mana79')
    || !corkiQReason.includes('HP540')
    || !corkiQReason.includes('ability_started')
    || !corkiQReason.includes('standalone')
    || !corkiQReason.includes('external existing-data/check-only')
    || !corkiQReason.includes('identity/panel/resource')
    || !corkiQReason.includes('不暗示 Corki P/W/E/R dependence')
    || !corkiQReason.includes('不暗示 Batch-B')
    || !corkiQReason.includes('sibling Corki synthesis')
    || !corkiQReason.includes('production runtime/ABI/Web change')
    || !corkiQReason.includes('focused75/full975')
    || !corkiQReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0')
    || !corkiQReason.includes('不宣称')
    || !corkiQReason.includes('no equivalence or contradiction claim')
    || !corkiQReason.includes('exactly one selected-primary magic impact hit')
    || corkiQReason.includes('canonical byte equivalence')
    || corkiQReason.includes('Batch-B prerequisite')
    || corkiQReason.includes('live published')
    || !String(corkiQ.sourceRef || '').includes('corki-q.json')
    || !String(corkiQ.sourceRef || '').includes(
      'e71a474ef6b4df1df4808b397c8bd0f42ce284234f3eb7603fab09cabd760365',
    )
    || corkiQ.auditBaseline?.gapCode !== 'blocked_data'
    || corkiQ.auditBaseline?.resolvedBucket !== 'blocked'
    || corkiQ.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(corkiQ.auditBaseline?.mechanismTags || []).includes('meta_or_non_target_dps')
    || corkiQ.classification !== 'out_of_scope_for_single_target_dps'
    || !(corkiQ.mechanismTags || []).includes('meta_or_non_target_dps')
    || citesForbiddenProvenance(corkiQ.classificationReason)
    || !(corkiQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.corkiPhosphorusBombPrimaryImpact
        && e.taskKey === 'wasm-generic-corki-phosphorus-bomb-primary-impact'
        && String(e.note || '').includes(corkiQBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('b381b1e')
        && String(e.note || '').includes('58f47763')
        && String(e.note || '').includes('65821')
        && String(e.note || '').includes('c39556a0')
        && String(e.note || '').includes('20221')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no 20230')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('no Q type')
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(corkiQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.corkiPhosphorusBombPrimaryImpactBackend
        && e.taskKey === 'wasm-generic-corki-phosphorus-bomb-primary-impact'
        && String(e.note || '').includes(corkiQBoundary)
        && String(e.note || '').includes('LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest')
        && String(e.note || '').includes('6003a7e')
        && String(e.note || '').includes('b352677')
        && String(e.note || '').includes('b381b1e')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Corki synthesis'),
    )
  ) {
    errors.push(
      'Corki Q must be migrated with empty remainingGap/missingFields, exact Phosphorus Bomb ordered tags (no meta_or_non_target_dps/primary_damage_branch_salvage; requires bonus_ad_ratio/ap_ratio/active_magic_damage), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/meta_or_non_target_dps/auditBaseline provenance, Wiki rev4007588/SHA + local raw caveat + frozen completedBoundary, rank5 80mana/7000CD/one magic 240+1.25*bonusAD+1.00*AP via nested binary numerics (240/365/340/465; raw460→230; raw540→270; counterproof both365; 20221/20170; no 20230; no Q type; no explicit event op; t0/t6999/t7000 mana240→80/HP540 two damage/two ability_started; mana79 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-production-runtime-ABI-Web framing, focused75/full975 + Wasm asset SHA, and bilateral wasm+backend evidence (owning 6003a7e / integrated b352677 / Wasm b381b1e; one selected-primary magic impact hit not full Q; no cast/location/projectile/AOE/sight/reveal/live claim)',
    );
  }
  if (corkiQ) {
    validateBilateralCoverageEvidence(
      corkiQ.candidateKey,
      corkiQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const mag = records.find((r) => r.candidateKey === 'item_passive|2523|item_passive|高倍望远镜');
  if (
    !mag
    || mag.genericClassification !== 'migrated'
    || !(mag.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.pipelineDamageModifier,
    )
    || !(mag.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.pipelineDamageItemsBackend,
    )
    || !String(mag.classificationReason || '').includes('1.10')
  ) {
    errors.push(
      '2523 高倍望远镜 must be migrated with pipeline damage bilateral evidence under fixed-max 1.10 policy',
    );
  }
  const giantSlayer = records.find((r) => r.candidateKey === 'item_passive|3036|item_passive|巨人杀手');
  const giantReason = String(giantSlayer?.classificationReason || '');
  if (
    !giantSlayer
    || giantSlayer.genericClassification !== 'migrated'
    || String(giantSlayer.remainingGap || '') !== ''
    || !(giantSlayer.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.pipelineDamageModifier,
    )
    || !(giantSlayer.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.pipelineDamageItemsBackend,
    )
    || !(
      giantReason.includes('100/104/115/115')
      || (giantReason.includes('15%') && giantReason.includes('1500'))
      || giantReason.includes('cap15')
      || (giantReason.includes('最多 15%') && giantReason.includes('1500'))
    )
  ) {
    errors.push(
      '3036 巨人杀手 must be migrated with empty gap, pipeline damage bilateral evidence, and Wiki 1%/100 cap15 wording',
    );
  }
  const asheQ = records.find((r) => r.candidateKey === 'hero_skill|hero_ashe|Q|射手的专注');
  if (!asheQ || asheQ.genericClassification !== 'migrated') {
    errors.push("Ashe Q must remain migrated under user-approved Ranger's Focus scope");
  }
  const asheW = records.find((r) => r.candidateKey === 'hero_skill|hero_ashe|W|万箭齐发');
  if (
    !asheW
    || asheW.genericClassification !== 'migrated'
    || !(asheW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.asheVolley,
    )
    || !(asheW.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.asheVolleyBackend,
    )
    || !String(asheW.classificationReason || '').includes('200')
    || !String(asheW.classificationReason || '').includes('4000')
    || !String(asheW.classificationReason || '').includes('排除')
  ) {
    errors.push(
      'Ashe W must be migrated with bilateral wasm+backend evidence under user-approved Volley 1v1 scope',
    );
  }
  const asheR = records.find((r) => r.candidateKey === 'hero_skill|hero_ashe|R|魔法水晶箭');
  const asheRTags = [...(asheR?.genericMechanismTags || [])];
  const asheRExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const asheRReason = String(asheR?.classificationReason || '');
  if (
    !asheR
    || asheR.genericClassification !== 'migrated'
    || String(asheR.remainingGap || '').trim()
    || (asheR.dataGapEvidence?.missingFields || []).length !== 0
    || asheRTags.join('|') !== asheRExpectedTags.join('|')
    || asheRTags.includes('multi_target_or_area')
    || String(asheR.remainingGap || '').includes('blocked_data')
    || asheRReason.includes('out_of_scope_for_single_target_dps')
    || asheRReason.includes('blocked_data')
    || asheRReason.includes('implementation_gap_no_unresolved_data_fields')
    || asheRReason.includes('multi_target_or_area')
    || !asheRReason.includes('4026934')
    || !asheRReason.includes(
      '1d9ccefa98a41e57a088e76aaca16f7a78141e7373616520e2d6ba13f450664f',
    )
    || !asheRReason.includes(
      'rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight',
    )
    || !asheRReason.includes('source.attr.ap.resolved')
    || !asheRReason.includes('600')
    || !asheRReason.includes('1.20')
    || !asheRReason.includes('100 mana')
    || !asheRReason.includes('60000')
    || !asheRReason.includes('raw840')
    || !asheRReason.includes('420')
    || !asheRReason.includes('80')
    || !asheRReason.includes('160')
    || !asheRReason.includes('cast0.25')
    || !asheRReason.includes('Effect at cast time start')
    || !asheRReason.includes('distance-scaled stun')
    || !asheRReason.includes('Frost')
    || !asheRReason.includes('不宣称')
    || !String(asheR.sourceRef || '').includes('ashe-r.json')
    || asheR.auditBaseline?.gapCode !== 'blocked_data'
    || asheR.auditBaseline?.resolvedBucket !== 'blocked'
    || !(asheR.auditBaseline?.mechanismTags || []).includes('multi_target_or_area')
    || citesForbiddenProvenance(asheR.classificationReason)
    || !(asheR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.asheEnchantedCrystalArrowPrimaryHit
        && e.taskKey === 'wasm-generic-ashe-enchanted-crystal-arrow-primary-hit'
        && String(e.note || '').includes(
          'rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight',
        )
        && String(e.note || '').includes('cast0.25')
        && String(e.note || '').includes('Effect at cast time start'),
    )
    || !(asheR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.asheEnchantedCrystalArrowPrimaryHitBackend
        && e.taskKey === 'wasm-generic-ashe-enchanted-crystal-arrow-primary-hit'
        && String(e.note || '').includes(
          'rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight',
        )
        && String(e.note || '').includes('LolGenericAsheEnchantedCrystalArrowPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('5d4a13f')
        && String(e.note || '').includes('2f820e4')
        && String(e.note || '').includes('bb3dd81'),
    )
  ) {
    errors.push(
      'Ashe R must be migrated with empty remainingGap/missingFields, exact Enchanted Crystal Arrow tags (no multi_target_or_area), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw auditBaseline provenance, Wiki rev4026934/SHA + frozen completedBoundary, numeric contract/100mana/60000CD/AP200→840/MR100→420/mana80/HP160, cast0.25/Effect-at-cast-time-start/distance-stun/AOE/Frost/sight exclusions, and bilateral wasm+backend evidence (owning 5d4a13f / integrated 2f820e4 / Wasm bb3dd81; no cast/projectile/stun/AOE/Frost/sight fidelity claim)',
    );
  }
  if (asheR) {
    validateBilateralCoverageEvidence(
      asheR.candidateKey,
      asheR.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const ezrealR = records.find((r) => r.candidateKey === 'hero_skill|hero_ezreal|R|精准弹幕');
  const ezrealRTags = [...(ezrealR?.genericMechanismTags || [])];
  const ezrealRExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'bonus_ad_ratio',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const ezrealRReason = String(ezrealR?.classificationReason || '');
  if (
    !ezrealR
    || ezrealR.genericClassification !== 'migrated'
    || String(ezrealR.remainingGap || '').trim()
    || (ezrealR.dataGapEvidence?.missingFields || []).length !== 0
    || ezrealRTags.join('|') !== ezrealRExpectedTags.join('|')
    || ezrealRTags.includes('meta_or_non_target_dps')
    || String(ezrealR.remainingGap || '').includes('blocked_data')
    || ezrealRReason.includes('out_of_scope_for_single_target_dps')
    || ezrealRReason.includes('blocked_data')
    || ezrealRReason.includes('implementation_gap_no_unresolved_data_fields')
    || ezrealRReason.includes('meta_or_non_target_dps')
    || !ezrealRReason.includes('4013235')
    || !ezrealRReason.includes(
      'e9d7f9d7411bcbb1ab00aeb89fe03a4fb8511625fc0a64266f5f63ced53580e0',
    )
    || !ezrealRReason.includes(
      'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage',
    )
    || !ezrealRReason.includes('source.attr.ad.resolved')
    || !ezrealRReason.includes('source.attr.ad.base')
    || !ezrealRReason.includes('source.attr.ap.resolved')
    || !ezrealRReason.includes('750')
    || !ezrealRReason.includes('1.00')
    || !ezrealRReason.includes('1.10')
    || !ezrealRReason.includes('100 mana')
    || !ezrealRReason.includes('90000')
    || !ezrealRReason.includes('baseAD60')
    || !ezrealRReason.includes('resolvedAD110')
    || !ezrealRReason.includes('raw1020')
    || !ezrealRReason.includes('510')
    || !ezrealRReason.includes('300')
    || !ezrealRReason.includes('480')
    || !ezrealRReason.includes('cast1')
    || !ezrealRReason.includes('queue0.5')
    || !ezrealRReason.includes('Effect at cast time start')
    || !ezrealRReason.includes('300+1.00 bonusAD+1.10 AP')
    || !ezrealRReason.includes('external existing-data/check-only')
    || !ezrealRReason.includes('identity/panel/resource')
    || !ezrealRReason.includes('不宣称')
    || !String(ezrealR.sourceRef || '').includes('ezreal-r.json')
    || ezrealR.auditBaseline?.gapCode !== 'blocked_data'
    || ezrealR.auditBaseline?.resolvedBucket !== 'blocked'
    || !(ezrealR.auditBaseline?.mechanismTags || []).includes('meta_or_non_target_dps')
    || ezrealR.classification !== 'out_of_scope_for_single_target_dps'
    || !(ezrealR.mechanismTags || []).includes('meta_or_non_target_dps')
    || citesForbiddenProvenance(ezrealR.classificationReason)
    || !(ezrealR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.ezrealTrueshotBarragePrimaryHit
        && e.taskKey === 'wasm-generic-ezreal-trueshot-barrage-primary-hit'
        && String(e.note || '').includes(
          'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage',
        )
        && String(e.note || '').includes('cast1')
        && String(e.note || '').includes('queue0.5')
        && String(e.note || '').includes('Effect at cast time start'),
    )
    || !(ezrealR.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.ezrealTrueshotBarragePrimaryHitBackend
        && e.taskKey === 'wasm-generic-ezreal-trueshot-barrage-primary-hit'
        && String(e.note || '').includes(
          'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage',
        )
        && String(e.note || '').includes('LolGenericEzrealTrueshotBarragePrimaryHitSeedSqlTest')
        && String(e.note || '').includes('dea4538')
        && String(e.note || '').includes('8c93017')
        && String(e.note || '').includes('e13d887')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('identity/panel/resource'),
    )
  ) {
    errors.push(
      'Ezreal R must be migrated with empty remainingGap/missingFields, exact Trueshot Barrage tags (no meta_or_non_target_dps), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw classification/tags/auditBaseline provenance, Wiki rev4013235/SHA + frozen completedBoundary, numeric contract/100mana/90000CD/baseAD60→110/AP200→raw1020/MR100→510/mana100/HP480, cast1/queue0.5/Effect-at-cast-start/projectile/geometry/direction/multitarget/sight/minion-monster-modified exclusions, external existing-data/check-only seed limitation, and bilateral wasm+backend evidence (owning dea4538 / integrated 8c93017 / Wasm e13d887; no cast/queue/projectile/geometry/direction/multitarget/sight/minion-monster fidelity claim)',
    );
  }
  if (ezrealR) {
    validateBilateralCoverageEvidence(
      ezrealR.candidateKey,
      ezrealR.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const ezrealE = records.find((r) => r.candidateKey === 'hero_skill|hero_ezreal|E|奥术跃迁');
  const ezrealETags = [...(ezrealE?.genericMechanismTags || [])];
  const ezrealEExpectedTags = [
    'ability_cost_cooldown',
    'active_magic_damage',
    'bonus_ad_ratio',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const ezrealEReason = String(ezrealE?.classificationReason || '');
  const ezrealEBoundary =
    'rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks';
  if (!EXACT_OVERRIDES.has('hero_ezreal|E')) {
    errors.push('Ezreal E exact override key hero_ezreal|E must exist before fallback');
  }
  if (
    !ezrealE
    || ezrealE.candidateKey !== 'hero_skill|hero_ezreal|E|奥术跃迁'
    || ezrealE.passiveName !== '奥术跃迁'
    || ezrealE.genericClassification !== 'migrated'
    || String(ezrealE.remainingGap || '').trim()
    || (ezrealE.dataGapEvidence?.missingFields || []).length !== 0
    || ezrealETags.join('|') !== ezrealEExpectedTags.join('|')
    || ezrealETags.includes('multi_target_or_area')
    || ezrealETags.includes('meta_or_non_target_dps')
    || String(ezrealE.remainingGap || '').includes('blocked_data')
    || ezrealEReason.includes('out_of_scope_for_single_target_dps')
    || ezrealEReason.includes('blocked_data')
    || ezrealEReason.includes('implementation_gap_no_unresolved_data_fields')
    || ezrealEReason.includes('multi_target_or_area')
    || !ezrealEReason.includes('3989862')
    || !ezrealEReason.includes(
      '7ac83f7eaa237641c478f2e3ffa1a2714f7da0644c8a488ab6a6f47b67e27347',
    )
    || !ezrealEReason.includes('f48a32706234b0c1ef1abab4b7f90e4ee88944623827fb22a41e23bdfac01792')
    || !ezrealEReason.includes('Template:Data Ezreal/E')
    || !ezrealEReason.includes('Template:Data Ezreal/Arcane Shift')
    || !ezrealEReason.includes('page1307111')
    || !ezrealEReason.includes('bytes1661')
    || !ezrealEReason.includes('2026-02-03T23:19:20Z')
    || !ezrealEReason.includes(ezrealEBoundary)
    || !ezrealEReason.includes('nested binary')
    || !ezrealEReason.includes('source.attr.ad.resolved')
    || !ezrealEReason.includes('source.attr.ad.base')
    || !ezrealEReason.includes('source.attr.ap.resolved')
    || !ezrealEReason.includes('280')
    || !ezrealEReason.includes('0.60')
    || !ezrealEReason.includes('0.75')
    || !ezrealEReason.includes('70 mana')
    || !ezrealEReason.includes('14000')
    || !ezrealEReason.includes('280/140')
    || !ezrealEReason.includes('310/155')
    || !ezrealEReason.includes('430/215')
    || !ezrealEReason.includes('460/230')
    || !ezrealEReason.includes('t13999')
    || !ezrealEReason.includes('mana210')
    || !ezrealEReason.includes('mana69')
    || !ezrealEReason.includes('Rising Spell Force')
    || !ezrealEReason.includes('AS1.1')
    || !ezrealEReason.includes('ability_started')
    || !ezrealEReason.includes('external existing-data/check-only')
    || !ezrealEReason.includes('identity/panel/resource')
    || !ezrealEReason.includes('不宣称')
    || !String(ezrealE.sourceRef || '').includes('ezreal-e.json')
    || !String(ezrealE.sourceRef || '').includes(
      '7ac83f7eaa237641c478f2e3ffa1a2714f7da0644c8a488ab6a6f47b67e27347',
    )
    || ezrealE.auditBaseline?.gapCode !== 'blocked_data'
    || ezrealE.auditBaseline?.resolvedBucket !== 'blocked'
    || ezrealE.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(ezrealE.auditBaseline?.mechanismTags || []).includes('multi_target_or_area')
    || ezrealE.classification !== 'out_of_scope_for_single_target_dps'
    || !(ezrealE.mechanismTags || []).includes('multi_target_or_area')
    || citesForbiddenProvenance(ezrealE.classificationReason)
    || !(ezrealE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.ezrealArcaneShiftPrimaryHit
        && e.taskKey === 'wasm-generic-ezreal-arcane-shift-primary-hit'
        && String(e.note || '').includes(ezrealEBoundary)
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('AS1.1')
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('065beb1')
        && String(e.note || '').includes('f48a3270'),
    )
    || !(ezrealE.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.ezrealArcaneShiftPrimaryHitBackend
        && e.taskKey === 'wasm-generic-ezreal-arcane-shift-primary-hit'
        && String(e.note || '').includes(ezrealEBoundary)
        && String(e.note || '').includes('LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('README')
        && String(e.note || '').includes('89e6677')
        && String(e.note || '').includes('0594b20')
        && String(e.note || '').includes('065beb1')
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('no Web change'),
    )
  ) {
    errors.push(
      'Ezreal E must be migrated with empty remainingGap/missingFields, exact Arcane Shift ordered tags (no multi_target_or_area), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw classification/tags/auditBaseline provenance, Wiki rev3989862/SHA + local raw caveat + frozen completedBoundary, rank5 70mana/14000CD/nested-binary 280+0.60bonusAD+0.75AP numerics (280/140 310/155 430/215 460/230; t0/t13999/t14000 mana210→70/HP540; mana69 skip; P coexistence AS1.1), and bilateral wasm+backend evidence (owning 89e6677 / integrated 0594b20 / Wasm 065beb1; Web parity no change; no blink/homing/visibility/Essence-Flux/projectile/reveal/live claim)',
    );
  }
  if (ezrealE) {
    validateBilateralCoverageEvidence(
      ezrealE.candidateKey,
      ezrealE.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const ezrealQ = records.find((r) => r.candidateKey === 'hero_skill|hero_ezreal|Q|秘术射击');
  const ezrealQTags = [...(ezrealQ?.genericMechanismTags || [])];
  const ezrealQExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'ap_ratio',
    'immediate_impact_scaffold',
  ];
  const ezrealQReason = String(ezrealQ?.classificationReason || '');
  const ezrealQBoundary =
    'rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_ezreal|Q')) {
    errors.push('Ezreal Q exact override key hero_ezreal|Q must exist before fallback');
  }
  if (
    !ezrealQ
    || ezrealQ.candidateKey !== 'hero_skill|hero_ezreal|Q|秘术射击'
    || ezrealQ.passiveName !== '秘术射击'
    || ezrealQ.genericClassification !== 'migrated'
    || String(ezrealQ.remainingGap || '').trim()
    || (ezrealQ.dataGapEvidence?.missingFields || []).length !== 0
    || ezrealQTags.join('|') !== ezrealQExpectedTags.join('|')
    || ezrealQTags.includes('total_ad_ratio')
    || ezrealQTags.includes('cooldown_or_haste_without_rotation')
    || ezrealQTags.includes('meta_or_non_target_dps')
    || ezrealQTags.includes('primary_damage_branch_salvage')
    || ezrealQTags.includes('multi_target_or_area')
    || String(ezrealQ.remainingGap || '').includes('blocked_data')
    || ezrealQReason.includes('out_of_scope_for_single_target_dps')
    || ezrealQReason.includes('blocked_data')
    || ezrealQReason.includes('implementation_gap_no_unresolved_data_fields')
    || ezrealQReason.includes('cooldown_or_haste_without_rotation')
    || ezrealQReason.includes('total_ad_ratio')
    || ezrealQReason.includes('meta_or_non_target_dps')
    || ezrealQReason.includes('primary_damage_branch_salvage')
    || !ezrealQReason.includes('4013233')
    || !ezrealQReason.includes(
      'be5a24861dc53970c19378fe8bea17b242b5b406a588cebb32b0d59a4af4b533',
    )
    || !ezrealQReason.includes('d8348b3b9eb4a076af5a87b714dd4de109643252f6b18fd2873f5a5bf7b05dbd')
    || !ezrealQReason.includes('Template:Data Ezreal/Q')
    || !ezrealQReason.includes('Template:Data Ezreal/Mystic Shot')
    || !ezrealQReason.includes('page1307107')
    || !ezrealQReason.includes('bytes2054')
    || !ezrealQReason.includes('bytes2052')
    || !ezrealQReason.includes('2026-04-28T21:19:30Z')
    || !ezrealQReason.includes(ezrealQBoundary)
    || !ezrealQReason.includes('nested binary')
    || !ezrealQReason.includes('source.attr.ad.resolved')
    || !ezrealQReason.includes('source.attr.ap.resolved')
    || !ezrealQReason.includes('不得减 base AD')
    || !ezrealQReason.includes('add(add(const 120')
    || !ezrealQReason.includes('1.30')
    || !ezrealQReason.includes('0.40')
    || !ezrealQReason.includes('40 mana')
    || !ezrealQReason.includes('4500')
    || !ezrealQReason.includes('20220')
    || !ezrealQReason.includes('20170')
    || !ezrealQReason.includes('no 20230')
    || !ezrealQReason.includes('no explicit event op')
    || !ezrealQReason.includes('no Q ability-specific type')
    || !ezrealQReason.includes('raw198/final99')
    || !ezrealQReason.includes('raw328/final164')
    || !ezrealQReason.includes('raw238/final119')
    || !ezrealQReason.includes('raw368/final184')
    || !ezrealQReason.includes('both328/164')
    || !ezrealQReason.includes('t4499')
    || !ezrealQReason.includes('mana120')
    || !ezrealQReason.includes('mana39')
    || !ezrealQReason.includes('HP632')
    || !ezrealQReason.includes('Rising Spell Force')
    || !ezrealQReason.includes('AS1.1')
    || !ezrealQReason.includes('ability_started')
    || !ezrealQReason.includes('external existing-data/check-only')
    || !ezrealQReason.includes('identity/panel/resource')
    || !ezrealQReason.includes('focused11/full998')
    || !ezrealQReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0')
    || !ezrealQReason.includes('不宣称')
    || !String(ezrealQ.sourceRef || '').includes('ezreal-q.json')
    || !String(ezrealQ.sourceRef || '').includes(
      'be5a24861dc53970c19378fe8bea17b242b5b406a588cebb32b0d59a4af4b533',
    )
    || ezrealQ.auditBaseline?.gapCode !== 'blocked_data'
    || ezrealQ.auditBaseline?.resolvedBucket !== 'blocked'
    || ezrealQ.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(ezrealQ.auditBaseline?.mechanismTags || []).includes('cooldown_or_haste_without_rotation')
    || ezrealQ.classification !== 'out_of_scope_for_single_target_dps'
    || !(ezrealQ.mechanismTags || []).includes('cooldown_or_haste_without_rotation')
    || citesForbiddenProvenance(ezrealQ.classificationReason)
    || !(ezrealQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.ezrealMysticShotPrimaryHit
        && e.taskKey === 'wasm-generic-ezreal-mystic-shot-primary-hit'
        && String(e.note || '').includes(ezrealQBoundary)
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('AS1.1')
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('000e253')
        && String(e.note || '').includes('d8348b3b'),
    )
    || !(ezrealQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.ezrealMysticShotPrimaryHitBackend
        && e.taskKey === 'wasm-generic-ezreal-mystic-shot-primary-hit'
        && String(e.note || '').includes(ezrealQBoundary)
        && String(e.note || '').includes('LolGenericEzrealMysticShotPrimaryHitSeedSqlTest')
        && String(e.note || '').includes('README')
        && String(e.note || '').includes('41fce6a')
        && String(e.note || '').includes('ae66c56')
        && String(e.note || '').includes('000e253')
        && String(e.note || '').includes('nested binary')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('no Web change'),
    )
  ) {
    errors.push(
      'Ezreal Q must be migrated with empty remainingGap/missingFields, exact Mystic Shot ordered tags (no total_ad_ratio/cooldown_or_haste_without_rotation/salvage/meta), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw classification/tags/auditBaseline provenance, Wiki rev4013233/SHA + local raw caveat + frozen completedBoundary, rank5 40mana/4500CD/nested-binary 120+1.30*totalAD+0.40*AP numerics (198/99 328/164 238/119 368/184; counterproof both328/164; t0/t4499/t4500 mana120→40/HP632; mana39 skip; P coexistence AS1.1), and bilateral wasm+backend evidence (owning 41fce6a / integrated ae66c56 / Wasm 000e253; Web parity no change; no direction/projectile/on-hit/CD-reduction/dual-tag/lifesteal/spellshield/live claim)',
    );
  }
  if (ezrealQ) {
    validateBilateralCoverageEvidence(
      ezrealQ.candidateKey,
      ezrealQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }
  const ezrealP = records.find((r) => r.candidateKey === 'hero_skill|hero_ezreal|P|咒能高涨');
  if (
    !ezrealP
    || ezrealP.genericClassification !== 'migrated'
    || !(ezrealP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.ezrealRisingSpellForce,
    )
    || !(ezrealP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.ezrealRisingSpellForceBackend,
    )
    || !String(ezrealP.classificationReason || '').includes('6000')
    || !String(ezrealP.classificationReason || '').includes('排除')
    || String(ezrealP.remainingGap || '').trim()
  ) {
    errors.push(
      'Ezreal P must be migrated with bilateral wasm+backend evidence under bounded 1v1 Rising Spell Force scope (not blocked/ready)',
    );
  }
  const kaisaP = records.find((r) => r.candidateKey === 'hero_skill|hero_kaisa|P|体表活肤');
  if (
    !kaisaP
    || kaisaP.genericClassification !== 'migrated'
    || !(kaisaP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.kaisaSecondSkin
        && e.taskKey === 'wasm-generic-kaisa-second-skin',
    )
    || !(kaisaP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.kaisaSecondSkinBackend
        && e.taskKey === 'wasm-generic-kaisa-second-skin',
    )
    || !String(kaisaP.classificationReason || '').includes('4038390')
    || !String(kaisaP.classificationReason || '').includes('4000')
    || !String(kaisaP.classificationReason || '').includes('排除')
    || String(kaisaP.remainingGap || '').trim()
  ) {
    errors.push(
      "Kai'Sa P must be migrated with bilateral wasm+backend evidence under completed Second Skin canonical generic scope (not blocked/ready)",
    );
  }
  const twitchP = records.find((r) => r.candidateKey === 'hero_skill|hero_twitch|P|死亡毒液');
  if (
    !twitchP
    || twitchP.genericClassification !== 'migrated'
    || !(twitchP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.twitchDeadlyVenom
        && e.taskKey === 'wasm-generic-twitch-deadly-venom',
    )
    || !(twitchP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.twitchDeadlyVenomBackend
        && e.taskKey === 'wasm-generic-twitch-deadly-venom',
    )
    || !String(twitchP.classificationReason || '').includes('4013286')
    || !String(twitchP.classificationReason || '').includes(
      '1567c0efec7f9e9021f6dc02410f92262dfa30128acc457c531199dbc9121b44',
    )
    || !String(twitchP.classificationReason || '').includes('8612d0d')
    || !String(twitchP.classificationReason || '').includes('92e100e')
    || !String(twitchP.classificationReason || '').includes('5a0931a')
    || !String(twitchP.classificationReason || '').includes('7cb8b1d')
    || !String(twitchP.classificationReason || '').includes('anchored')
    || String(twitchP.remainingGap || '').trim()
    || (Array.isArray(twitchP.dataGapEvidence?.missingFields)
      && twitchP.dataGapEvidence.missingFields.length > 0)
  ) {
    errors.push(
      'Twitch P must be migrated with empty remainingGap, Wiki rev4013286/SHA + anchored DoT evidence (8612d0d/92e100e/5a0931a/7cb8b1d), and bilateral wasm+backend paths (not blocked/blocked_data)',
    );
  }
  if (twitchP) {
    validateBilateralCoverageEvidence(
      twitchP.candidateKey,
      twitchP.coverageEvidence,
      errors,
      { requireCompletedBoundary: true, lane: 'generic_runtime' },
    );
  }
  const akshanP = records.find((r) => r.candidateKey === 'hero_skill|hero_akshan|P|无所不用');
  if (
    !akshanP
    || akshanP.genericClassification !== 'partial'
    || !String(akshanP.classificationReason || '').includes('4038197')
    || !String(akshanP.classificationReason || '').includes(
      '22ba762382dedced4b63a451c4513cb3129e3b16a137236e5b637eea7510b534',
    )
    || !String(akshanP.classificationReason || '').includes('dirty_fighting_stacks')
    || !String(akshanP.classificationReason || '').includes('partial')
    || !String(akshanP.remainingGap || '').includes('secondShotDelayMs')
    || !String(akshanP.remainingGap || '').includes('accurate_ability_hit_event_wiring')
    || !(akshanP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.akshanDirtyFighting
        && e.taskKey === 'wasm-generic-akshan-dirty-fighting',
    )
    || !(akshanP.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.akshanDirtyFightingBackend
        && e.taskKey === 'wasm-generic-akshan-dirty-fighting',
    )
  ) {
    errors.push(
      'Akshan P must be partial with bilateral wasm+backend Dirty Fighting evidence (Wiki rev4038197/SHA; not full/migrated/blocked/ready)',
    );
  }
  if (akshanP) {
    validateBilateralCoverageEvidence(
      akshanP.candidateKey,
      akshanP.coverageEvidence,
      errors,
      { requireCompletedBoundary: true, lane: 'generic_runtime' },
    );
  }
  const akshanQ = records.find((r) => r.candidateKey === 'hero_skill|hero_akshan|Q|去而复还');
  const akshanQTags = [...(akshanQ?.genericMechanismTags || [])];
  const akshanQExpectedTags = [
    'ability_cost_cooldown',
    'active_physical_damage',
    'bonus_ad_ratio',
    'immediate_impact_scaffold',
  ];
  const akshanQReason = String(akshanQ?.classificationReason || '');
  const akshanQBoundary =
    'rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity';
  if (!EXACT_OVERRIDES.has('hero_akshan|Q')) {
    errors.push('Akshan Q exact override key hero_akshan|Q must exist before fallback');
  }
  if (
    !akshanQ
    || akshanQ.candidateKey !== 'hero_skill|hero_akshan|Q|去而复还'
    || akshanQ.passiveName !== '去而复还'
    || akshanQ.genericClassification !== 'migrated'
    || String(akshanQ.remainingGap || '').trim()
    || (akshanQ.dataGapEvidence?.missingFields || []).length !== 0
    || akshanQTags.join('|') !== akshanQExpectedTags.join('|')
    || akshanQTags.includes('cooldown_or_haste_without_rotation')
    || akshanQTags.includes('meta_or_non_target_dps')
    || akshanQTags.includes('dps_relevant_manual_review')
    || akshanQTags.includes('primary_damage_branch_salvage')
    || akshanQTags.includes('total_ad_ratio')
    || !akshanQTags.includes('bonus_ad_ratio')
    || !akshanQTags.includes('active_physical_damage')
    || String(akshanQ.remainingGap || '').includes('blocked_data')
    || akshanQReason.includes('needs_manual_baseline')
    || akshanQReason.includes('blocked_data')
    || akshanQReason.includes('implementation_gap_no_unresolved_data_fields')
    || akshanQReason.includes('cooldown_or_haste_without_rotation')
    || akshanQReason.includes('out_of_scope_for_single_target_dps')
    || akshanQReason.includes('dps_relevant_manual_review')
    || akshanQReason.includes('primary_damage_branch_salvage')
    || akshanQReason.includes('total AD；')
    || akshanQReason.includes('total_ad_ratio')
    || akshanQReason.includes('*totalAD')
    || !akshanQReason.includes('4007510')
    || !akshanQReason.includes(
      '1cbf7dda955849d05ad2d7e578ed9507f8f61fc7525c5ed006a25185915b5f5b',
    )
    || !akshanQReason.includes(
      '407e4671cc05e87edcd0038a9efe614ad98f65cd57ce339c2c9d69afe5b8c973',
    )
    || !akshanQReason.includes('Template:Data Akshan/Q')
    || !akshanQReason.includes('Template:Data Akshan/Avengerang')
    || !akshanQReason.includes('page1502462')
    || !akshanQReason.includes('bytes2570')
    || !akshanQReason.includes('2026-04-11T22:35:01Z')
    || !akshanQReason.includes(akshanQBoundary)
    || !akshanQReason.includes('source.attr.ad.resolved')
    || !akshanQReason.includes('source.attr.ad.base')
    || !akshanQReason.includes('exact nested binary')
    || !akshanQReason.includes('bonus AD by explicit subtraction')
    || !akshanQReason.includes('不得按 total-AD 直读')
    || !akshanQReason.includes('165')
    || !akshanQReason.includes('0.70')
    || !akshanQReason.includes('80 mana')
    || !akshanQReason.includes('5000')
    || !akshanQReason.includes('immediate cooldown scaffold')
    || !akshanQReason.includes('cooldown starts after return')
    || !akshanQReason.includes('not a remaining blocker')
    || !akshanQReason.includes('20220')
    || !akshanQReason.includes('20170')
    || !akshanQReason.includes('no 20230')
    || !akshanQReason.includes('no explicit event op')
    || !akshanQReason.includes('no Q ability-specific type')
    || !akshanQReason.includes('base52/resolved52 raw165/final82.5')
    || !akshanQReason.includes('base52/resolved152 raw235/final117.5')
    || !akshanQReason.includes('base0/resolved100 versus base52/resolved152')
    || !akshanQReason.includes('both raw/final235')
    || !akshanQReason.includes('t4999')
    || !akshanQReason.includes('t5000')
    || !akshanQReason.includes('mana240')
    || !akshanQReason.includes('mana79')
    || !akshanQReason.includes('HP765')
    || !akshanQReason.includes('ability_started')
    || !akshanQReason.includes('Dirty Fighting/basic coexistence')
    || !akshanQReason.includes('does not synthesize ability-hit stacks')
    || !akshanQReason.includes('standalone')
    || !akshanQReason.includes('external existing-data/check-only')
    || !akshanQReason.includes('identity/panel/resource')
    || !akshanQReason.includes('不暗示 Batch-B')
    || !akshanQReason.includes('sibling Akshan synthesis')
    || !akshanQReason.includes('production runtime/ABI/Web change')
    || !akshanQReason.includes('focused12/full1010')
    || !akshanQReason.includes('66516')
    || !akshanQReason.includes(
      'dc922f4249cb87a5f6afda8f3a88dac011cc5a5683ff6c0a9a8c5cfd16618805',
    )
    || !akshanQReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0')
    || !akshanQReason.includes('不宣称')
    || !akshanQReason.includes('no equivalence or contradiction claim')
    || !akshanQReason.includes('exactly one selected-primary first-outbound-pass physical hit')
    || akshanQReason.includes('canonical byte equivalence')
    || akshanQReason.includes('Batch-B prerequisite')
    || akshanQReason.includes('live published')
    || !String(akshanQ.sourceRef || '').includes('akshan-q.json')
    || !String(akshanQ.sourceRef || '').includes(
      '1cbf7dda955849d05ad2d7e578ed9507f8f61fc7525c5ed006a25185915b5f5b',
    )
    || akshanQ.auditBaseline?.gapCode !== 'blocked_data'
    || akshanQ.auditBaseline?.resolvedBucket !== 'blocked'
    || akshanQ.auditBaseline?.damageDisposition !== 'primary_damage_branch_salvage'
    || !(akshanQ.auditBaseline?.mechanismTags || []).includes('cooldown_or_haste_without_rotation')
    || akshanQ.classification !== 'out_of_scope_for_single_target_dps'
    || !(akshanQ.mechanismTags || []).includes('cooldown_or_haste_without_rotation')
    || citesForbiddenProvenance(akshanQ.classificationReason)
    || !(akshanQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'wasm'
        && e.sourcePath === WASM.akshanAvengerangFirstOutboundHit
        && e.taskKey === 'wasm-generic-akshan-avengerang-first-outbound-hit'
        && String(e.note || '').includes(akshanQBoundary)
        && String(e.note || '').includes('ability_started')
        && String(e.note || '').includes('b58a549')
        && String(e.note || '').includes('407e4671')
        && String(e.note || '').includes('20220')
        && String(e.note || '').includes('20170')
        && String(e.note || '').includes('no 20230')
        && String(e.note || '').includes('no explicit event op')
        && String(e.note || '').includes('no Q type')
        && String(e.note || '').includes('exact nested binary')
        && String(e.note || '').includes('Dirty Fighting/basic coexistence')
        && String(e.note || '').includes('does not synthesize ability-hit stacks')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no sibling synthesis'),
    )
    || !(akshanQ.coverageEvidence || []).some(
      (e) =>
        e.sourceWorktree === 'backend'
        && e.sourcePath === SEED.akshanAvengerangFirstOutboundHitBackend
        && e.taskKey === 'wasm-generic-akshan-avengerang-first-outbound-hit'
        && String(e.note || '').includes(akshanQBoundary)
        && String(e.note || '').includes('LolGenericAkshanAvengerangFirstOutboundHitSeedSqlTest')
        && String(e.note || '').includes('bd8dbcb')
        && String(e.note || '').includes('45d589a')
        && String(e.note || '').includes('b58a549')
        && String(e.note || '').includes('external existing-data/check-only')
        && String(e.note || '').includes('standalone')
        && String(e.note || '').includes('no Batch-B')
        && String(e.note || '').includes('sibling Akshan synthesis'),
    )
  ) {
    errors.push(
      'Akshan Q must be migrated with empty remainingGap/missingFields, exact Avengerang ordered tags (no cooldown_or_haste_without_rotation/primary_damage_branch_salvage; requires bonus_ad_ratio/active_physical_damage), stale blocked_data/out_of_scope/implementation-gap cleared while retaining raw out_of_scope_for_single_target_dps/cooldown_or_haste_without_rotation/auditBaseline provenance, Wiki rev4007510/SHA + local raw caveat + frozen completedBoundary, rank5 80mana/immediate-cooldown-scaffold5000/one physical 165+0.70*bonusAD exact nested binary numerics (165→82.5/235→117.5; bonusAD counterproof; 20220/20170; no 20230; no Q type; no explicit event op; t0/t4999/t5000 mana240→80/HP765 two damage/two ability_started; mana79 skip; Dirty Fighting coexistence; no ability-hit stack synthesis), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-production-runtime-ABI-Web framing, focused12/full1010 + Wasm asset SHA, and bilateral wasm+backend evidence (owning bd8dbcb / integrated 45d589a / Wasm b58a549; one selected-primary first-outbound-pass physical hit not full Q; no direction/return/homing/cooldown-after-return/sight/MS/spellshield/live claim)',
    );
  }
  if (akshanQ) {
    validateBilateralCoverageEvidence(
      akshanQ.candidateKey,
      akshanQ.coverageEvidence,
      errors,
      { lane: 'generic_runtime' },
    );
  }

  const rebuilt = buildSummary(records);
  const rateKeys = [
    ['coverageRateMigratedOnly', 'all'],
    ['coverageRateMigratedOnly', 'inScope'],
    ['coverageRateMigratedPlusPartial', 'all'],
    ['coverageRateMigratedPlusPartial', 'inScope'],
  ];
  for (const [a, b] of rateKeys) {
    if (audit.summary?.[a]?.[b] !== rebuilt[a][b]) {
      errors.push(`percent mismatch ${a}.${b}: ${audit.summary?.[a]?.[b]} vs ${rebuilt[a][b]}`);
    }
    if (Number.isNaN(audit.summary?.[a]?.[b])) {
      errors.push(`NaN percent ${a}.${b}`);
    }
  }
  for (const k of CLASSIFICATIONS) {
    if (audit.summary?.classificationPercents?.[k] !== rebuilt.classificationPercents[k]) {
      errors.push(`percent mismatch classificationPercents.${k}`);
    }
  }
  return errors;
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

function buildAudit(input, inputSha256, generatedAt) {
  const candidateKeys = resolveCandidateKeys(input.candidates);
  const records = input.candidates.map((c, index) => {
    const classified = classifyCandidate(c, candidateKeys[index]);
    const wiki = c.sourceKind === 'hero_skill' ? wikiNumericSource(c) : null;
    const wikiRef =
      wiki?.sourceRef
      || (c.sourceKind === 'hero_skill' ? oosWikiSourceRef(c) : null);
    const row = {
      ...c,
      candidateKey: candidateKeys[index],
      // Replace frozen Batch-G champion-static sourceRef with Wiki provenance.
      // Exact overrides may supply item Wiki sourceRef (e.g. 2512 Opening Barrage).
      sourceRef:
        classified.sourceRef
        || wikiRef
        || (c.sourceKind === 'item_passive' ? c.sourceRef : IDENTITY_MANIFEST_REL),
      genericClassification: classified.classification,
      genericMechanismTags: classified.tags,
      classificationReason: classified.reason,
      coverageEvidence: classified.coverageEvidence || [],
      remainingGap: classified.remainingGap || '',
    };
    if (classified.dataGapEvidence) {
      row.dataGapEvidence = classified.dataGapEvidence;
    }
    if (classified.outOfScopeEvidence) {
      row.outOfScopeEvidence = classified.outOfScopeEvidence;
    }
    return row;
  });

  const summary = buildSummary(records);
  return {
    metadata: {
      inputPath: paths.inputPath.replace(/\\/g, '/'),
      inputSha256,
      generatorPath: paths.generatorPath.replace(/\\/g, '/'),
      ruleSetVersion: RULE_SET_VERSION,
      generatedAt,
    },
    summary,
    candidates: records,
  };
}

function toCsvRows(audit) {
  return audit.candidates.map((r) => ({
    candidateKey: r.candidateKey,
    sourceKind: r.sourceKind,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    skillKey: r.skillKey,
    passiveName: r.passiveName,
    oldClassification: r.classification,
    genericClassification: r.genericClassification,
    genericMechanismTags: (r.genericMechanismTags || []).join('|'),
    ...csvEvidenceFields(r.coverageEvidence),
    remainingGap: r.remainingGap || '',
    dataGapMissingFields: (r.dataGapEvidence?.missingFields || []).join('|'),
    dataGapEvidenceJson: r.dataGapEvidence ? JSON.stringify(r.dataGapEvidence) : '',
    outOfScopeExcludedBehavior: r.outOfScopeEvidence?.excludedBehavior || '',
    outOfScopeEvidenceJson: r.outOfScopeEvidence ? JSON.stringify(r.outOfScopeEvidence) : '',
  }));
}

function writeOutputs(audit) {
  fs.writeFileSync(paths.outputJson, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  fs.writeFileSync(paths.outputCsv, toCsv(toCsvRows(audit)), 'utf8');
}

function main() {
  const checkMode = process.argv.includes('--check');
  if (!fs.existsSync(paths.inputJson)) {
    console.error(`missing input: ${paths.inputJson}`);
    process.exit(1);
  }
  const inputSha256 = sha256File(paths.inputJson);
  const input = JSON.parse(fs.readFileSync(paths.inputJson, 'utf8'));
  if (!Array.isArray(input.candidates) || input.candidates.length !== 242) {
    console.error(`input candidates must be 242, got ${input.candidates?.length}`);
    process.exit(1);
  }

  const generatedAt = new Date().toISOString();
  const audit = buildAudit(input, inputSha256, generatedAt);
  const errors = validateAudit(audit);
  if (errors.length) {
    console.error('self-check failed:');
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  if (checkMode) {
    if (!fs.existsSync(paths.outputJson) || !fs.existsSync(paths.outputCsv)) {
      console.error('--check requires existing json/csv outputs');
      process.exit(1);
    }
    const existing = JSON.parse(fs.readFileSync(paths.outputJson, 'utf8'));
    const existingErrors = validateAudit(existing);
    if (existingErrors.length) {
      console.error('existing json failed validation:');
      for (const e of existingErrors) console.error(`- ${e}`);
      process.exit(1);
    }
    const a = JSON.stringify(stripGeneratedAt(existing));
    const b = JSON.stringify(stripGeneratedAt(audit));
    if (a !== b) {
      console.error('--check failed: semantic content differs (ignoring generatedAt)');
      process.exit(1);
    }
    // rebuild csv and compare (EOL-canonical so CRLF vs LF checkouts match)
    const expectedCsv = toCsv(toCsvRows(audit));
    const actualCsv = fs.readFileSync(paths.outputCsv, 'utf8');
    if (canonicalizeEol(actualCsv) !== canonicalizeEol(expectedCsv)) {
      console.error('--check failed: csv content differs');
      process.exit(1);
    }
    console.log('check ok');
    console.log(JSON.stringify({
      candidateCount: audit.summary.candidateCount,
      sourceKindCounts: audit.summary.sourceKindCounts,
      classificationCounts: audit.summary.classificationCounts,
      coverageRateMigratedOnly: audit.summary.coverageRateMigratedOnly,
      coverageRateMigratedPlusPartial: audit.summary.coverageRateMigratedPlusPartial,
      ruleSetVersion: RULE_SET_VERSION,
    }, null, 2));
    return;
  }

  writeOutputs(audit);
  console.log('wrote', paths.outputJson);
  console.log('wrote', paths.outputCsv);
  console.log(JSON.stringify({
    candidateCount: audit.summary.candidateCount,
    sourceKindCounts: audit.summary.sourceKindCounts,
    classificationCounts: audit.summary.classificationCounts,
    classificationPercents: audit.summary.classificationPercents,
    coverageRateMigratedOnly: audit.summary.coverageRateMigratedOnly,
    coverageRateMigratedPlusPartial: audit.summary.coverageRateMigratedPlusPartial,
    inputSha256,
    ruleSetVersion: RULE_SET_VERSION,
  }, null, 2));
}

main();

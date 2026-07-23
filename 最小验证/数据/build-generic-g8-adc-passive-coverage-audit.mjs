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
  dravenSpinningAxeBackend: 'db/game_manage/seeds/lol_generic_draven_spinning_axe_seed.sql',
  pipelineDamageItemsBackend:
    'db/game_manage/seeds/lol_generic_pipeline_damage_items_seed.sql',
  kogmawCausticSpittleBackend: 'db/game_manage/seeds/lol_generic_kogmaw_caustic_spittle_seed.sql',
  kogmawVoidOozePrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_kogmaw_void_ooze_primary_hit_seed.sql',
  kaisaSuperchargeBackend: 'db/game_manage/seeds/lol_generic_kaisa_supercharge_seed.sql',
  kaisaVoidSeekerPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_kaisa_void_seeker_primary_hit_seed.sql',
  kaisaSecondSkinBackend: 'db/game_manage/seeds/lol_generic_kaisa_second_skin_seed.sql',
  dravenBloodRushBackend: 'db/game_manage/seeds/lol_generic_draven_blood_rush_seed.sql',
  dravenStandAsideBackend: 'db/game_manage/seeds/lol_generic_draven_stand_aside_seed.sql',
  teemoBlindingDartBackend: 'db/game_manage/seeds/lol_generic_teemo_blinding_dart_seed.sql',
  vayneCondemnPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_vayne_condemn_primary_hit_seed.sql',
  quinnHeightenedSensesBackend:
    'db/game_manage/seeds/lol_generic_quinn_heightened_senses_seed.sql',
  xayahDeadlyPlumageBackend: 'db/game_manage/seeds/lol_generic_xayah_deadly_plumage_seed.sql',
  kayleRadiantBlastBackend: 'db/game_manage/seeds/lol_generic_kayle_radiant_blast_seed.sql',
  gravesNewDestinyBackend: 'db/game_manage/seeds/lol_generic_graves_new_destiny_seed.sql',
  gravesQuickdrawMaxStackBackend:
    'db/game_manage/seeds/lol_generic_graves_quickdraw_max_stack_seed.sql',
  gravesSmokeScreenPrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_graves_smoke_screen_primary_hit_seed.sql',
  gravesCollateralDamagePrimaryHitBackend:
    'db/game_manage/seeds/lol_generic_graves_collateral_damage_primary_hit_seed.sql',
  ezrealRisingSpellForceBackend:
    'db/game_manage/seeds/lol_generic_ezreal_rising_spell_force_seed.sql',
  akshanDirtyFightingBackend: 'db/game_manage/seeds/lol_generic_akshan_dirty_fighting_seed.sql',
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
  dravenSpinningAxe:
    'wasm/tinygo_engine_v2/internal/runtime/generic_draven_spinning_axe_test.go',
  pipelineDamageModifier:
    'wasm/tinygo_engine_v2/internal/runtime/generic_pipeline_damage_modifier_test.go',
  kogmawCausticSpittle:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_caustic_spittle_test.go',
  kogmawVoidOozePrimaryHit:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_void_ooze_primary_hit_test.go',
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
  quinnHeightenedSenses:
    'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_heightened_senses_test.go',
  xayahDeadlyPlumage:
    'wasm/tinygo_engine_v2/internal/runtime/generic_xayah_deadly_plumage_test.go',
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
  ezrealRisingSpellForce:
    'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_rising_spell_force_test.go',
  akshanDirtyFighting:
    'wasm/tinygo_engine_v2/internal/runtime/generic_akshan_dirty_fighting_test.go',
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
  if (counts.migrated !== 60) errors.push(`migrated=${counts.migrated}, expected 60`);
  if (counts.partial !== 4) errors.push(`partial=${counts.partial}, expected 4`);
  if (counts.blocked !== 109) errors.push(`blocked=${counts.blocked}, expected 109`);
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

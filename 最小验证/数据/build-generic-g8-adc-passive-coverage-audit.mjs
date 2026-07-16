import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const RULE_SET_VERSION = 'generic-g8-v1-20260713';
const CLASSIFICATIONS = ['migrated', 'partial', 'blocked', 'out_of_scope'];

const paths = {
  inputJson: path.join(repoRoot, '最小验证', 'V2-Batch-G-adc-passive-audit.json'),
  outputJson: path.join(repoRoot, '最小验证', 'generic-g8-adc-passive-coverage-audit.json'),
  outputCsv: path.join(repoRoot, '最小验证', 'generic-g8-adc-passive-coverage-audit.csv'),
  generatorPath: path.join('最小验证', '数据', 'build-generic-g8-adc-passive-coverage-audit.mjs'),
  inputPath: path.join('最小验证', 'V2-Batch-G-adc-passive-audit.json'),
  seedCandidateJson: path.join(repoRoot, '数据参考', 'ddragon-champions', 'champion-seed-candidate.json'),
  championDir: path.join(repoRoot, '数据参考', 'champion'),
};

const SEED_CANDIDATE_REL = '数据参考/ddragon-champions/champion-seed-candidate.json';

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

/** Lazy index over champion-seed-candidate.json (ownerId+skillKey). */
let _seedSkillIndex = null;
let _seedHeroIdByNorm = null;
let _seedMeta = null;

function normChampionId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function loadSeedCandidateIndex() {
  if (_seedSkillIndex) return;
  if (!fs.existsSync(paths.seedCandidateJson)) {
    _seedSkillIndex = new Map();
    _seedHeroIdByNorm = new Map();
    _seedMeta = { version: '', sourceRef: SEED_CANDIDATE_REL };
    return;
  }
  const seed = JSON.parse(fs.readFileSync(paths.seedCandidateJson, 'utf8'));
  _seedMeta = {
    version: seed.source?.version || seed.versionCode || '',
    sourceRef: SEED_CANDIDATE_REL,
  };
  _seedHeroIdByNorm = new Map((seed.heroes || []).map((h) => [normChampionId(h.heroId), h.heroId]));
  _seedSkillIndex = new Map(
    (seed.skills || []).map((s) => [`${normChampionId(s.ownerId)}|${s.skillKey}`, s]),
  );
}

function resolveSeedChampionId(ownerId) {
  loadSeedCandidateIndex();
  const raw = String(ownerId || '').replace(/^hero_/i, '');
  return _seedHeroIdByNorm.get(normChampionId(raw)) || null;
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

function readChampionSpellTooltip(championId, skillKey) {
  if (!championId || !skillKey) return '';
  const filePath = path.join(paths.championDir, `${championId}.json`);
  if (!fs.existsSync(filePath)) return '';
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const champ = raw?.data?.[championId];
    if (!champ) return '';
    if (skillKey === 'P') return String(champ.passive?.description || '');
    const idx = 'QWER'.indexOf(skillKey);
    if (idx < 0) return '';
    return String(champ.spells?.[idx]?.tooltip || '');
  } catch {
    return '';
  }
}

function emptyDataGapEvidence(partial = {}) {
  return {
    sourceVersion: _seedMeta?.version || '',
    sourceRef: partial.sourceRef || SEED_CANDIDATE_REL,
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
 * Does not treat seed/mount/live publish/E2E as data blockers.
 */
function buildHeroDataGapEvidence(candidate) {
  loadSeedCandidateIndex();
  const champId = resolveSeedChampionId(candidate.ownerId);
  const skillKey = candidate.skillKey;
  if (!champId || !skillKey) {
    return emptyDataGapEvidence({
      missingFields: ['source_snapshot'],
      gapKind: 'source_snapshot_missing',
      reasonZh: '本地英雄技能候选快照缺该 ownerId+skillKey 的 source snapshot',
      blocker: 'source_snapshot_missing',
    });
  }
  const skill = _seedSkillIndex.get(`${normChampionId(champId)}|${skillKey}`);
  if (!skill) {
    return emptyDataGapEvidence({
      sourceRef: `${SEED_CANDIDATE_REL}#${champId}|${skillKey}`,
      missingFields: ['source_snapshot'],
      gapKind: 'source_snapshot_missing',
      reasonZh: '本地英雄技能候选快照缺该 ownerId+skillKey 的 source snapshot',
      blocker: 'source_snapshot_missing',
    });
  }

  const params = skill.params || {};
  const tables = nonZeroEffectTables(params.effectValues);
  const varsMap = params.varsMap && typeof params.varsMap === 'object' ? params.varsMap : {};
  const variables = Array.isArray(params.variables)
    ? params.variables.filter((v) => typeof v === 'string')
    : [];
  const varsMapEmpty = Object.keys(varsMap).length === 0;
  const variablesEmpty = variables.length === 0;
  const championTooltip = readChampionSpellTooltip(champId, skillKey);
  const placeholders = extractTooltipPlaceholders(
    skill.description,
    championTooltip,
    ...(params.damageInstances || []).map((d) => d.plainContent || ''),
  );
  const diUnresolved = (params.damageInstances || []).flatMap((d) => d.variables || []);
  const unresolvedDamage = [
    ...new Set([...placeholders.filter(isDamageLikePlaceholder), ...diUnresolved]),
  ].sort((a, b) => a.localeCompare(b, 'en'));
  const numericPlaceholders = placeholders.filter(
    (p) =>
      isDamageLikePlaceholder(p)
      || /armor|mr|magicresist|attackspeed|movespeed|cooldown|duration|stack|charge|shield|heal|mana|ratio|perstack|mod/.test(
        p,
      ),
  );
  const unresolvedNumeric = numericPlaceholders.filter((p) => !varsMap[p]);
  const costs =
    skill.resourceCosts && typeof skill.resourceCosts === 'object' ? skill.resourceCosts : {};
  const cds = Array.isArray(skill.cooldowns) ? skill.cooldowns : [];
  const claimsDamage = /伤害|damage|斩杀|处决/i.test(
    `${skill.description || ''}|${candidate.sourceText || ''}`,
  );
  const claimsBuffNeedValues =
    params.classificationReason === 'buff_needs_values'
    || (/攻击速度|攻速|attack speed/i.test(skill.description || '')
      && unresolvedNumeric.some((p) => /attackspeed|buffduration/.test(p)));

  const missingFields = [];
  let gapKind = 'none';
  let reasonZh = '';
  let blocker = '';

  if (unresolvedDamage.length && Object.keys(tables).length === 0) {
    gapKind = 'unresolved_damage_placeholder';
    for (const p of unresolvedDamage) missingFields.push(`tooltip:${p}`);
    if (varsMapEmpty) missingFields.push('varsMap');
    if (variablesEmpty) missingFields.push('variables_binding');
    reasonZh = `DDragon tooltip 保留 ${unresolvedDamage.join('/')}，effect/vars 未提供公式`;
    blocker = `unresolved_tooltip_${unresolvedDamage.join('_')}`;
  } else if (unresolvedDamage.length && Object.keys(tables).length) {
    gapKind = 'base_table_missing_scaling';
    for (const p of unresolvedDamage) {
      missingFields.push(`scaling:${p}:${scalingLabelForPlaceholder(p)}`);
    }
    if (varsMapEmpty) missingFields.push('varsMap');
    const ph = unresolvedDamage.join('/');
    const scales = [...new Set(unresolvedDamage.map(scalingLabelForPlaceholder))].join('/');
    reasonZh = `基础表已存在[${formatEffectTablesCompact(tables)}]，但 ${ph} 的 ${scales} 未在 varsMap/variables/effectValues 展开`;
    blocker = `base_table_missing_scaling_${unresolvedDamage.join('_')}`;
  } else if (unresolvedNumeric.length && Object.keys(tables).length) {
    gapKind = 'base_table_missing_scaling';
    for (const p of unresolvedNumeric) missingFields.push(`binding:${p}`);
    if (varsMapEmpty) missingFields.push('varsMap');
    reasonZh = `基础表已存在[${formatEffectTablesCompact(tables)}]，但 ${unresolvedNumeric.join('/')} 未在 varsMap/variables/effectValues 展开`;
    blocker = `base_table_unbound_${unresolvedNumeric.join('_')}`;
  } else if (unresolvedNumeric.length) {
    gapKind = 'unresolved_numeric_placeholder';
    for (const p of unresolvedNumeric) missingFields.push(`tooltip:${p}`);
    if (varsMapEmpty) missingFields.push('varsMap');
    reasonZh = `DDragon tooltip 保留 ${unresolvedNumeric.join('/')}，effect/vars 未提供数值绑定`;
    blocker = `unresolved_tooltip_${unresolvedNumeric.join('_')}`;
  } else if (claimsBuffNeedValues) {
    gapKind = 'buff_numeric_contract';
    missingFields.push('buff_rank_or_stack_values');
    reasonZh = '状态/增益描述缺少可核验的攻速/时长/层数数值来源';
    blocker = 'missing_buff_numeric_contract';
  } else if (
    claimsDamage
    && unresolvedDamage.length === 0
    && Object.keys(tables).length === 0
    && placeholders.length === 0
  ) {
    gapKind = 'passive_numeric_contract';
    missingFields.push('passive_or_spell_damage_numeric_contract');
    reasonZh = '描述声称伤害/额外伤害效果，但本地 DDragon 未提供可核验数值表或公式占位符';
    blocker = 'missing_damage_numeric_contract';
  }

  return emptyDataGapEvidence({
    sourceVersion: _seedMeta.version,
    sourceRef: `${SEED_CANDIDATE_REL}#${skill.skillId}`,
    availableEffectTables: tables,
    availableCooldowns: cds,
    availableCosts: costs,
    tooltipPlaceholders: placeholders,
    unresolvedDamagePlaceholders: unresolvedDamage,
    varsMapEmpty,
    variablesEmpty,
    variables,
    missingFields,
    gapKind,
    reasonZh:
      reasonZh
      || '本地数值快照无未解析伤害/数据字段；剩余为实现/runtime 缺口而非 data blocker',
    blocker,
  });
}

function item3097EnergizedDataGapEvidence() {
  return emptyDataGapEvidence({
    sourceVersion: 'local-wiki-item-3097',
    sourceRef: '最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs#item_3097_energized',
    missingFields: ['move_charge_rate', 'attack_charge_rate'],
    gapKind: 'status_charge_rate',
    reasonZh:
      '3097 盈能：本地 Wiki 仅写移动与普攻生成充能至 100，缺精确移动/普攻充能速率（非 Bolt 预充能伤害口径）',
    blocker: 'missing_precise_energize_move_and_attack_charge_rates_in_local_wiki',
  });
}

function yunaraRDataGapEvidence() {
  loadSeedCandidateIndex();
  const skill = _seedSkillIndex.get(`${normChampionId('Yunara')}|R`);
  const tables = nonZeroEffectTables(skill?.params?.effectValues);
  const varsMap = skill?.params?.varsMap && typeof skill.params.varsMap === 'object' ? skill.params.varsMap : {};
  const variables = Array.isArray(skill?.params?.variables)
    ? skill.params.variables.filter((v) => typeof v === 'string')
    : [];
  const cds = Array.isArray(skill?.cooldowns) ? skill.cooldowns : [];
  const costs =
    skill?.resourceCosts && typeof skill.resourceCosts === 'object' ? skill.resourceCosts : {};
  const placeholders = extractTooltipPlaceholders(
    skill?.description,
    readChampionSpellTooltip('Yunara', 'R'),
  );
  const missingFields = [
    'tooltip:buff_duration',
    'cross_skill:Q:tooltip:calc_damage',
    'cross_skill:Q:tooltip:calc_damage_spread',
    'cross_skill:Q:tooltip:calc_passive_damage',
    'cross_skill:Q:tooltip:calc_attack_speed',
    'cross_skill:W:tooltip:calc_damage_initial',
    'cross_skill:W:tooltip:calc_damage_per_second',
    'cross_skill:W:tooltip:calc_rw_damage',
    'varsMap',
  ];
  return emptyDataGapEvidence({
    sourceVersion: _seedMeta?.version || '16.9.1',
    sourceRef: `${SEED_CANDIDATE_REL}#champion_Yunara_R`,
    availableEffectTables: tables,
    availableCooldowns: cds,
    availableCosts: costs,
    tooltipPlaceholders: placeholders,
    unresolvedDamagePlaceholders: [],
    varsMapEmpty: Object.keys(varsMap).length === 0,
    variablesEmpty: variables.length === 0,
    variables,
    missingFields,
    gapKind: 'unresolved_transcendent_form_cross_skill_formulas',
    reasonZh:
      'Yunara R 定圣诀进入超凡形态并升级基础技能；本地 DDragon 16.9.1 R 的 buff_duration 未展开，Q/W 超凡形态 calc_damage/calc_rw_damage 等公式均未展开',
    blocker:
      'unresolved_yunara_r_buff_duration_and_qw_transcendent_calc_damage_formulas',
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
    reason: '本地 DDragon 数值快照无未解析伤害/数据字段；缺 runtime 表达能力（非 data blocker）。',
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
  dravenSpinningAxeBackend: 'db/game_manage/seeds/lol_generic_draven_spinning_axe_seed.sql',
  kogmawCausticSpittleBackend: 'db/game_manage/seeds/lol_generic_kogmaw_caustic_spittle_seed.sql',
  kaisaSuperchargeBackend: 'db/game_manage/seeds/lol_generic_kaisa_supercharge_seed.sql',
  dravenBloodRushBackend: 'db/game_manage/seeds/lol_generic_draven_blood_rush_seed.sql',
  quinnHeightenedSensesBackend:
    'db/game_manage/seeds/lol_generic_quinn_heightened_senses_seed.sql',
  xayahDeadlyPlumageBackend: 'db/game_manage/seeds/lol_generic_xayah_deadly_plumage_seed.sql',
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
  dravenSpinningAxe:
    'wasm/tinygo_engine_v2/internal/runtime/generic_draven_spinning_axe_test.go',
  kogmawCausticSpittle:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_caustic_spittle_test.go',
  kaisaSupercharge:
    'wasm/tinygo_engine_v2/internal/runtime/generic_kaisa_supercharge_test.go',
  duskAndDawnSpellblade:
    'wasm/tinygo_engine_v2/internal/runtime/generic_dusk_and_dawn_spellblade_test.go',
  linkedEffects:
    'wasm/tinygo_engine_v2/internal/runtime/generic_linked_effects_test.go',
  dravenBloodRush:
    'wasm/tinygo_engine_v2/internal/runtime/generic_draven_blood_rush_test.go',
  quinnHeightenedSenses:
    'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_heightened_senses_test.go',
  xayahDeadlyPlumage:
    'wasm/tinygo_engine_v2/internal/runtime/generic_xayah_deadly_plumage_test.go',
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
    'hero_kogmaw|Q',
    {
      classification: 'partial',
      tags: ['attack_speed_percent_add'],
      reason:
        'hero_kogmaw Q 腐蚀唾液/Caustic Spittle rank5 被动常驻 +25% attack_speed 已由 wasm-generic-kogmaw-caustic-spittle 闭环：provider-mounted static ModifierDefinition（target=attack_speed, valuePolicy=percent_add, constant 0.25）；base AS 0.72 → resolved 0.90；provider 不添加 ability/listener/state/damage/event。',
      remainingGap:
        'Q 主动命中魔法伤害、护甲/魔抗击碎、cast/cooldown/rotation、其它 rank 仍未建模；不得把 Q 被动视为完整 Q。',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-kogmaw-caustic-spittle',
          WASM.kogmawCausticSpittle,
          'completedBoundary: rank5 passive permanent attack_speed percent_add 0.25 (0.72→0.90); attribute-only provider; remainingGap: active Q hit/shred/cast/CD/rotation/other ranks unmodeled',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-kogmaw-caustic-spittle',
          SEED.kogmawCausticSpittleBackend,
          'completedBoundary: rank5 passive AS branch seeded; remainingGap: active hit/shred/cast unmodeled; backend lol_generic_kogmaw_caustic_spittle_seed.sql',
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
    'hero_draven|Q',
    {
      classification: 'partial',
      tags: ['spellblade_next_attack_state'],
      reason:
        'hero_draven Q 旋转飞斧/Spinning Axe rank5 初次飞斧已由 wasm-generic-draven-spinning-axe 批次闭环：Q active cast 经 ability_started 武装 source-owner timed state spinning_axe_ready=1（max1,duration_ms5800,refresh_on_write）；随后一次 source-owner basic_attack_hit 追加 physical raw=60+1.15*(resolved AD-base AD)，copyable_on_hit=false 并消费 ready。',
      remainingGap:
        '接斧重新武装、双斧上限、45 mana、8s CD、其它 rank、移动落点及 W/E/R 均未建模。',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-draven-spinning-axe',
          WASM.dravenSpinningAxe,
          'completedBoundary: rank5 initial axe ability_started arms 5800ms ready + first AA physical 60+1.15*bonusAD; remainingGap: catch rearm / dual axe / mana / CD / other ranks / landing / WER unmodeled',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-draven-spinning-axe',
          SEED.dravenSpinningAxeBackend,
          'completedBoundary: rank5 initial axe seeded; remainingGap: catch/dual-axe/landing unmodeled; backend lol_generic_draven_spinning_axe_seed.sql',
        ),
      ],
    },
  ],
  [
    'hero_ashe|Q',
    {
      classification: 'partial',
      tags: ['stacking_stat_modifier_on_hit', 'attack_speed_percent_add', 'cast_condition'],
      reason:
        'hero_ashe Q 射手的专注/Ranger\'s Focus rank5 核心已由 wasm-generic-ashe-rangers-focus 批次闭环：ability-level castCondition 读 owning provider Focus 槽（满4层才可施放）；Q 耗 30 mana、清 Focus、武装 6000ms Flurry；攻速 percent_add=0.75*provider.state.flurry_active；Flurry 首发 6×28%AD、后续 5×28%AD，每次 flurry 普攻仅一次 basic_attack_hit；Focus 用四槽 timed state 在刷新后 4000/5000/6000/7000ms 逐层掉落。',
      remainingGap:
        '未建模：generic attack-timer reset 调度、逐箭飞行、Frost Shot、吸血、建筑物/多目标、任意技能轮转/攻速 cadence、其它 rank。',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-ashe-rangers-focus',
          WASM.asheRangersFocus,
          'completedBoundary: rank5 Focus==4 cast + Flurry AS/damage core; remainingGap: attack-timer reset / arrow travel / Frost Shot / life steal / buildings / multitarget / rotation unmodeled',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-ashe-rangers-focus',
          SEED.asheRangersFocusBackend,
          'completedBoundary: rank5 Ranger\'s Focus core seeded; remainingGap: attack-timer/arrow-travel/rotation unmodeled; backend lol_generic_ashe_rangers_focus_seed.sql',
        ),
      ],
    },
  ],
  [
    'hero_kaisa|E',
    {
      classification: 'partial',
      tags: ['cast_triggered_timed_attack_speed', 'attack_speed_percent_add'],
      reason:
        'hero_kaisa E 极限超载/Supercharge rank5 核心已由 wasm-generic-kaisa-supercharge 批次闭环：E 耗 30 mana、CD 10000ms、ability 无 damage ops；generic ability_started 代表 charge completed（不模拟 cast time）；source-owner ability_started listener 武装 4000ms timed state supercharge_as_active；攻速 percent_add=0.80*provider.state.supercharge_as_active（base 0.60→1.08）；CD 内再次尝试 skip，无第二次 cost/state/event。',
      remainingGap:
        '未建模：移动速度/幽灵状态/攻击前摇、真实 cast time、普攻返还 0.5s CD、进化隐形、其它 rank/轮转/E2E。',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-kaisa-supercharge',
          WASM.kaisaSupercharge,
          'completedBoundary: rank5 30 mana/CD10000ms +80% AS timed state; remainingGap: move speed/ghost/windup / real cast time / on-attack 0.5 CD refund / evolution invis / other ranks/rotation unmodeled',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-kaisa-supercharge',
          SEED.kaisaSuperchargeBackend,
          'completedBoundary: rank5 Supercharge AS core seeded; remainingGap: cast timing/CD refund/stealth evolution unmodeled; backend lol_generic_kaisa_supercharge_seed.sql',
        ),
      ],
    },
  ],
  [
    'hero_draven|W',
    {
      classification: 'partial',
      tags: ['timed_attack_speed_buff', 'catch_cooldown_reset'],
      reason:
        'hero_draven W 血性冲刺/Blood Rush rank5 主动攻速核心已由 wasm-generic-draven-blood-rush 闭环：真实 CompileGeneric+RunGeneric；20 mana / CD 12000ms；ability_started 武装 3000ms timed AS state；+40% attack_speed；覆盖 cast 前、扣蓝、buff、到期、CD 内拒绝不扣蓝、12s 后重施/刷新、base view 不污染；本地 DD 16.9.1 DravenFury e4=40% AS / e5=3s / cost=20 / CD=12s。移动速度与衰减为允许不模拟的非伤害分支。',
      remainingGap:
        '接住旋转飞斧后立即刷新 W cooldown 所需 axe_caught 事件/ability cooldown reset 未建模。',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-draven-blood-rush',
          WASM.dravenBloodRush,
          'completedBoundary: rank5 20 mana/CD12000ms/+40% AS timed state; remainingGap: axe_caught CD reset unmodeled; MS/decay intentionally out of damage branch',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-draven-blood-rush',
          SEED.dravenBloodRushBackend,
          'completedBoundary: rank5 Blood Rush AS core seeded; remainingGap: axe_caught CD reset unmodeled; backend lol_generic_draven_blood_rush_seed.sql; not live published',
        ),
      ],
    },
  ],
  [
    'hero_quinn|W',
    {
      classification: 'partial',
      tags: ['target_state_conditioned_attack_speed', 'vulnerable'],
      reason:
        'hero_quinn W 敏锐感知/Heightened Senses rank5 目标状态条件攻速核心已由 wasm-generic-quinn-heightened-senses 闭环：真实 CompileGeneric+RunGeneric；预先存在 harrier_vulnerable target-state 时 basic_attack_hit 后 +40% AS 持续 2s；覆盖无易损不触发、触发、到期、refresh、target 隔离、phantom 不刷新、base 不污染；本地 DD 16.9.1 QuinnW e3 rank5=0.40 / e1,e5=2s。W 主动视野与移速为允许不模拟的非伤害分支。',
      remainingGap:
        'Quinn P/Q/E 对 harrier_vulnerable 的产生/消费与 Harrier 额外伤害未建模。',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-quinn-heightened-senses',
          WASM.quinnHeightenedSenses,
          'completedBoundary: preexisting harrier_vulnerable + basic_attack_hit → +40% AS 2s; remainingGap: P/Q/E harrier produce/consume/bonus dmg unmodeled; W vision/MS intentionally out of damage branch',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-quinn-heightened-senses',
          SEED.quinnHeightenedSensesBackend,
          'completedBoundary: Heightened Senses AS core seeded; remainingGap: harrier produce/consume/bonus dmg unmodeled; backend lol_generic_quinn_heightened_senses_seed.sql; not live published',
        ),
      ],
    },
  ],
  [
    'hero_xayah|W',
    {
      classification: 'partial',
      tags: ['cast_triggered_timed_attack_speed', 'attack_speed_percent_add', 'secondary_feather_ratio_damage'],
      reason:
        'hero_xayah W 致死羽衣/Deadly Plumage rank5 主动攻速核心已由 wasm-generic-xayah-deadly-plumage 闭环：真实 CompileGeneric+RunGeneric；40 mana / CD 14000ms；ability_started 武装 4000ms timed AS state；+55% attack_speed；wasm generic_xayah_deadly_plumage_test.go 7 tests（commit d59818f）；backend lol_generic_xayah_deadly_plumage_seed.sql 幂等 seed/mount + LolGenericXayahDeadlyPlumageSeedSqlTest 9 tests（commit afd71de，未 live publish）；本地 DD 16.9.1 e1=55 / e2=4 / e5=20 / cost=40 / CD=14。已完成 active AS branch。',
      remainingGap:
        '次级羽刃造成原真实普攻伤害20%，需要以已结算基础攻击伤害为输入的比例复制语义，并明确排除 on-hit/phantom 重复；MS/Rakan为非伤害OOS。',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-xayah-deadly-plumage',
          WASM.xayahDeadlyPlumage,
          'completedBoundary: rank5 40 mana/CD14000ms/+55% AS timed state; remainingGap: secondary feather 20% settled basic-attack damage ratio copy excluding on-hit/phantom unmodeled; MS/Rakan intentionally non-damage OOS',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-xayah-deadly-plumage',
          SEED.xayahDeadlyPlumageBackend,
          'completedBoundary: Deadly Plumage AS core seeded; remainingGap: secondary feather ratio copy unmodeled; backend lol_generic_xayah_deadly_plumage_seed.sql; not live published',
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
      classification: 'partial',
      tags: ['spellblade_next_attack_state'],
      reason:
        'item 2510 黄昏与黎明咒刃核心已由 wasm-generic-dusk-and-dawn-spellblade 覆盖：source-owner ability_start 武装 10s ready；下一次合格命中附加魔法伤害 0.75 * base AD + 0.10 * resolved AP；该命中开始 1.5s ICD；effect copyable false。',
      remainingGap:
        '缺治疗公式 0.10 AP + 0.03 bonus HP；缺 0.2s 延迟的第二次 on-hit 应用（需 generalized delayed-repeat 语义）。',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-dusk-and-dawn-spellblade',
          WASM.duskAndDawnSpellblade,
          'completedBoundary: ability_start 10s ready + hit magic 0.75*base AD + 0.10*resolved AP + 1.5s ICD; remainingGap: heal formula + delayed second on-hit',
          'wasm',
        ),
        evidence(
          'generic_batch',
          'wasm-generic-dusk-and-dawn-spellblade',
          SEED.duskAndDawnSpellblade,
          'completedBoundary: Dusk and Dawn Spellblade core seeded; remainingGap: healing_out_of_damage_branch_and_delayed_repeat_on_hit',
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
  // --- Yunara R: transcendent form upgrades Q/W damage formulas; not OOS ---
  [
    'hero_yunara|R',
    {
      classification: 'blocked',
      tags: ['transcendent_form_skill_upgrade', 'cross_skill_damage_formula'],
      reason:
        'Yunara R 定圣诀进入超凡形态并升级基础技能；本地 DDragon 16.9.1 R 的 buff_duration 未展开，Q/W 超凡形态 calc_damage/calc_rw_damage 等公式均未展开',
      remainingGap:
        'Yunara R 定圣诀进入超凡形态并升级基础技能；本地 DDragon 16.9.1 R 的 buff_duration 未展开，Q/W 超凡形态 calc_damage/calc_rw_damage 等公式均未展开',
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
        '2523 Arcane Aim/奥术瞄准：takedown 后 +100 攻击距离 8 秒，无伤害增量；审计边界外。同装备 Magnification/高倍望远镜仍单独审计。',
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
    match: (c) => c.ownerId === 'hero_akshan' && c.skillKey === 'P',
    result: {
      classification: 'blocked',
      tags: ['every_n_hit', 'on_hit', 'shield'],
      reason: '旧规则因护盾/生存误判为 out_of_scope，但含主目标额外伤害分支；缺精确 generic seed/mount。',
      remainingGap: '缺 Akshan P 主目标 every-3rd-hit 伤害与护盾分支的 runtime/数据闭环。',
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
    match: (c) => c.ownerId === '3032' && c.passiveName === '疾风骤雨',
    result: {
      classification: 'blocked',
      tags: ['timed_attack_speed_modifier', 'attack_crit_cooldown_interaction'],
      reason:
        '育恩塔尔 Flurry/疾风骤雨：对英雄发起普攻武装 +30% AS 6s/30s CD；on-hit -1s、crit -2s 冷却缩减；非纯冷却轮转。',
      remainingGap:
        '缺 attack_launch_vs_champion 武装、timed_attack_speed_buff、on_hit/crit cooldown_reduction 状态机。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === '6610' && c.passiveName === '光盾打击',
    result: {
      classification: 'blocked',
      tags: ['conditional_guaranteed_crit', 'first_attack', 'heal'],
      reason:
        '焚天 Lightshield Strike/光盾打击：对英雄下一次普攻为条件性必定暴击（指定暴击伤害）；治疗分支 out_of_scope；expected-crit 不实现 per-target 条件必定暴击。',
      remainingGap:
        '缺 per_target_guaranteed_crit_arm、specified_crit_damage_branch、per_target_10s_cooldown；healing OOS。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === '2512' && c.passiveName === '开战弹幕',
    result: {
      classification: 'blocked',
      tags: ['ultimate_cast_armed_attacks', 'conditional_crit_damage', 'pre_mitigation_true_damage'],
      reason:
        '2512 Opening Barrage/开战弹幕：ultimate_cast 武装接下来 3 次普攻/8s；+50% AS；条件暴击伤害；已暴击则附加 15% pre-mitigation 攻击伤害真实伤害；45s CD。',
      remainingGap:
        '缺 ultimate_cast_arm_next_3_attacks、deterministic_crit_branch、attack_pre_mitigation_snapshot、charge_consumption、45s_cooldown。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === '2523' && c.passiveName === '高倍望远镜',
    result: {
      classification: 'blocked',
      tags: ['distance_or_ratio_modifier', 'basic_damage_amplification'],
      reason:
        '2523 Magnification/高倍望远镜：edge-to-edge 距离输入，每 50 单位 +1% 最多 10% basic damage amplification。',
      remainingGap:
        '缺 edge_to_edge_distance_input、distance_scaled_basic_damage_amp_snapshot（1%/50 up to 10%）。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === '3036' && c.passiveName === '巨人杀手',
    result: {
      classification: 'blocked',
      tags: ['outgoing_damage_modifier', 'bonus_health_ratio'],
      reason:
        '3036 Giant Slayer/巨人杀手：按目标 bonus health，每 100 +1% 最多 15% outgoing damage amp。',
      remainingGap:
        '缺 target_bonus_health_input、outgoing_damage_amp_ordering（1%/100 up to 15%）。',
      coverageEvidence: [],
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
      return true;
    },
    result: {
      classification: 'blocked',
      tags: ['energized_charge_and_consume'],
      reason:
        'energized 除 item 3094 神射手与 item 3097 弩箭（预充能口径）外全部 blocked；同机制代表完成不等于本 candidate 已 seed（含 3097 盈能充能速率）。',
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

function buildCandidateKeys(candidates) {
  // Two-pass: collision groups always use sourceRef+fingerprint so keys are
  // order-independent when source-fragment rows share the same owner/skill/passive.
  const baseCounts = new Map();
  for (const c of candidates) {
    const base = candidateBaseKey(c);
    baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
  }

  const used = new Set();
  const keys = [];
  for (const c of candidates) {
    const base = candidateBaseKey(c);
    let key = base;
    if ((baseCounts.get(base) || 0) > 1) {
      key = `${base}|${c.sourceRef || ''}|${shortTextFp(c.sourceText)}`;
    }
    if (used.has(key)) {
      throw new Error(`unable to disambiguate candidateKey for ${key}`);
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

  return {
    sourceRef: c.sourceRef || '',
    sourceTextSummary: summarizeSourceText(text),
    reviewedPrimaryTargetDamageBranch: true,
    boundaryCategory,
    excludedBehavior,
    boundaryReason,
    damageRelevantSubBranchDisposition: disposition,
  };
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

function hasDamageSignal(text) {
  return DAMAGE_SIGNAL_RE.test(String(text || ''));
}

function hasDamageRelatedSignal(text) {
  return DAMAGE_RELATED_SIGNAL_RE.test(String(text || ''));
}

function isPureControlCandidate(c) {
  const tags = c.mechanismTags || [];
  return tags.length > 0 && tags.every((t) => PURE_CONTROL_TAGS.has(t));
}

function isPureOutOfScopeCandidate(c) {
  const tags = c.mechanismTags || [];
  if (!tags.some((t) => PURE_OOS_TAGS.has(t))) {
    return false;
  }
  // 纯减速/控制：即便文案含“攻击”触发词，仍属审计边界外。
  if (isPureControlCandidate(c) && !/伤害/.test(String(c.sourceText || ''))) {
    return true;
  }
  if (hasDamageSignal(c.sourceText)) {
    return false;
  }
  return true;
}

function classifyFallback(c) {
  const tags = [...(c.mechanismTags || [])];
  const old = c.classification;

  if (old === 'already_covered' || old === 'ready_to_encode') {
    return {
      classification: 'blocked',
      tags: tags.length ? tags : ['legacy_covered_not_generic'],
      reason: `旧 ${old} 不在 exact migrated/partial 清单；legacy != generic。`,
      remainingGap: '缺该精确 candidate 的 generic seed/mount + 完成批次证据。',
      coverageEvidence: [],
    };
  }

  if (old === 'needs_runtime_extension' || old === 'needs_manual_baseline') {
    return {
      classification: 'blocked',
      tags: tags.length ? tags : ['needs_runtime_or_baseline'],
      reason: `旧 ${old} 默认 blocked：缺 runtime、基线或精确 provider seed/live publish/E2E。`,
      remainingGap: c.blockedReason || '缺 runtime 扩展、手工基线或精确 generic seed/mount。',
      coverageEvidence: [],
    };
  }

  if (old === 'out_of_scope_for_single_target_dps') {
    if (isPureOutOfScopeCandidate(c)) {
      const draftReason =
        '文本为纯 meta/economy/vision/building/revive、纯生存、纯控制、纯冷却/主动轮转或纯额外目标收益；当前 ADC 被动 1v1 单目标伤害审计边界外。';
      const ev = inferOutOfScopeEvidence(c, draftReason);
      return {
        classification: 'out_of_scope',
        tags: tags.length ? tags : ['audit_boundary'],
        reason: specificOosReasonFromEvidence(ev, draftReason),
        remainingGap: '',
        coverageEvidence: [],
        outOfScopeEvidence: ev,
      };
    }
    if (hasDamageSignal(c.sourceText)) {
      return {
        classification: 'blocked',
        tags: tags.length ? tags : ['primary_target_damage_branch'],
        reason: '旧 out_of_scope 但 sourceText 含伤害/攻击/每N次等主目标相关语义；复合伤害分支不得整条 out_of_scope，且无精确 seed。',
        remainingGap: '缺精确 generic provider seed/mount/live publish/E2E；不得因旧 out_of_scope 标签放行。',
        coverageEvidence: [],
      };
    }
    const draftReason = '当前 ADC 被动 1v1 单目标伤害审计边界外。';
    const ev = inferOutOfScopeEvidence(c, draftReason);
    return {
      classification: 'out_of_scope',
      tags: tags.length ? tags : ['audit_boundary'],
      reason: specificOosReasonFromEvidence(ev, draftReason),
      remainingGap: '',
      coverageEvidence: [],
      outOfScopeEvidence: ev,
    };
  }

  return {
    classification: 'blocked',
    tags: tags.length ? tags : ['unclassified'],
    reason: '未命中 exact/component 规则，保守 blocked。',
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
    const ev = inferOutOfScopeEvidence(
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
  const expectedCounts = { migrated: 22, partial: 11, blocked: 142, out_of_scope: 67 };
  for (const [k, v] of Object.entries(expectedCounts)) {
    if ((counts[k] || 0) !== v) {
      errors.push(`classificationCounts.${k} expected ${v}, got ${counts[k] || 0}`);
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
    || !yunaraR.dataGapEvidence?.missingFields?.includes('tooltip:buff_duration')
    || !yunaraR.dataGapEvidence?.missingFields?.some((f) => String(f).includes('calc_rw_damage'))
    || !yunaraR.dataGapEvidence?.missingFields?.some((f) => String(f).includes('calc_damage'))
  ) {
    errors.push(
      'Yunara R 定圣诀 must be blocked with dataGapEvidence covering buff_duration and Q/W transcendent calc_damage/calc_rw_damage',
    );
  }

  // Final OOS must carry structured outOfScopeEvidence; damage-signal rows only via a–e.
  const oosRows = records.filter((r) => r.genericClassification === 'out_of_scope');
  if (oosRows.length !== 67) {
    errors.push(`out_of_scope rows expected 67, got ${oosRows.length}`);
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
    const cat = String(ev.boundaryCategory || '');
    const summary = String(ev.sourceTextSummary || '');
    const reasonBlob = `${ev.boundaryReason || ''}|${r.classificationReason || ''}`;
    if (cat === 'pure_movement_or_dash') {
      if (!/移动|移速|冲刺|跃迁|位移|幽灵/.test(summary)) {
        errors.push(
          `pure_movement_or_dash sourceTextSummary missing move semantics @ ${r.candidateKey}`,
        );
      }
      if (
        PRIMARY_DAMAGE_DEAL_RE.test(summary)
        && !POST_DAMAGE_UTILITY_ONLY_RE.test(summary)
        && disposition !== 'trigger_phrase_no_damage_amp'
      ) {
        errors.push(`pure_movement_or_dash has untreated primary damage @ ${r.candidateKey}`);
      }
    }
    if (cat === 'other_targets_only') {
      if (!/额外目标|附近的敌人|周围的敌人|主目标不受|身后/.test(`${summary}|${reasonBlob}`)) {
        errors.push(`other_targets_only missing primary-unaffected evidence @ ${r.candidateKey}`);
      }
    }
    if (cat === 'pure_vision') {
      if (!/视野|守卫|显形|伪装|侦察|鹰|黑雾/.test(summary)) {
        errors.push(`pure_vision sourceTextSummary missing vision semantics @ ${r.candidateKey}`);
      }
      if (PRIMARY_DAMAGE_DEAL_RE.test(summary) && !/守卫|陷阱/.test(summary)) {
        errors.push(`pure_vision must not include champion damage @ ${r.candidateKey}`);
      }
    }
    if (cat === 'economy_or_post_takedown') {
      if (!/击杀|阵亡|takedown|赏金|金币|encounter 已结束|主目标死亡/.test(reasonBlob)) {
        errors.push(
          `economy_or_post_takedown reason must state post-takedown encounter end @ ${r.candidateKey}`,
        );
      }
    }
    if (
      hasDamageRelatedSignal(r.sourceText)
      && !OOS_DAMAGE_SIGNAL_DISPOSITIONS.has(disposition)
    ) {
      errors.push(
        `out_of_scope has damage-related signal but disposition not in a–e @ ${r.candidateKey}: ${disposition}`,
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
  const candidateKeys = buildCandidateKeys(input.candidates);
  const records = input.candidates.map((c, index) => {
    const classified = classifyCandidate(c, candidateKeys[index]);
    const row = {
      ...c,
      candidateKey: candidateKeys[index],
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

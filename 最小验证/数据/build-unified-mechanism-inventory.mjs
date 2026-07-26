/**
 * Unified mechanism verification inventory generator.
 * Schema: unified-mechanism-inventory-v1
 *
 * Default: write JSON + CSV under 最小验证/
 * --check: rebuild in memory, never write; compare semantic JSON (ignore metadata.generatedAt) + EOL-canonical CSV
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const verifyRoot = path.join(repoRoot, '最小验证');
const dataRoot = path.join(verifyRoot, '数据');

const SCHEMA_VERSION = 'unified-mechanism-inventory-v1';
const GENERATOR_PATH = '最小验证/数据/build-unified-mechanism-inventory.mjs';
const OUTPUT_JSON_REL = '最小验证/unified-mechanism-inventory.json';
const OUTPUT_CSV_REL = '最小验证/unified-mechanism-inventory.csv';

const STATUS_VALUES = [
  'completed',
  'partial_actionable',
  'ready_to_implement',
  'blocked_runtime',
  'blocked_data',
  'out_of_scope',
  'regression_only',
  'stale_or_duplicate',
];
const COMPLETION_MODES = ['full', 'partial', 'none'];
const LANES = ['generic_runtime', 'legacy_single_attacker_dps', 'data_only', 'mixed_evidence'];

const REGISTRY_REL = '最小验证/wiki-only-mechanism-candidate-registry.json';
const G8_AUDIT_REL = '最小验证/generic-g8-adc-passive-coverage-audit.json';
const BATCH_G_AUDIT_REL = '最小验证/V2-Batch-G-adc-passive-audit.json';
const KATARINA_LEGACY_SEED_REL = '最小验证/卡特琳娜-MVP种子数据.json';
const KATARINA_R_KEY = 'hero_skill|hero_katarina|R|死亡莲华';
const MALZAHAR_E_KEY = 'hero_skill|hero_malzahar|E|恶咒降临';
const MALZAHAR_E_WIKI_REL =
  '数据参考/lol-wiki-extra-mechanisms/normalized/generic/malzahar-e.json';
const MALZAHAR_E_SCHEMA = 'lol-wiki-ability-generic-v1';
const MALZAHAR_E_PAGE_ID = 'malzahar-e';
const MALZAHAR_E_REVISION_ID = 4015185;
const MALZAHAR_E_CONTENT_SHA256 =
  '9098ee2fbe7dfb33d1ca375bbce0c68788fd60378780aa4ddab8afc46736ba84';
const MALZAHAR_E_REQUIRED_TRACKED_FIELDS = [
  'description',
  'description2',
  'leveling',
  'cooldown',
  'cost',
  'costtype',
  'damagetype',
  'notes',
];

const paths = {
  outputJson: path.join(repoRoot, OUTPUT_JSON_REL),
  outputCsv: path.join(repoRoot, OUTPUT_CSV_REL),
  registryJson: path.join(repoRoot, REGISTRY_REL),
  g8Json: path.join(repoRoot, G8_AUDIT_REL),
  fullItemJson: path.join(verifyRoot, 'V2-full-item-dps-coverage-20260615.json'),
  coeffBucketsA: path.join(verifyRoot, 'V2-BatchV-A-coefficient-buckets.json'),
  coeffBucketsB: path.join(verifyRoot, 'V2-BatchV-B-3082-wardens-mail-coefficient-buckets.json'),
  katarinaLegacySeed: path.join(verifyRoot, '卡特琳娜-MVP种子数据.json'),
  batchASeed: path.join(verifyRoot, 'V2-Batch-A-target-dummies.seed.json'),
  batchCSeed: path.join(verifyRoot, 'V2-Batch-C-adc-items.seed.json'),
  malzaharEWiki: path.join(repoRoot, MALZAHAR_E_WIKI_REL),
};

/**
 * Exact parsed/hashed current inputs only. No directory/regex discovery.
 * Missing entries fail closed.
 */
const ACTIVE_SOURCE_ALLOWLIST = [
  { rel: REGISTRY_REL, kind: 'coverage_json', abs: () => paths.registryJson },
  { rel: G8_AUDIT_REL, kind: 'coverage_json', abs: () => paths.g8Json },
  {
    rel: '最小验证/V2-full-item-dps-coverage-20260615.json',
    kind: 'coverage_json',
    abs: () => paths.fullItemJson,
  },
  {
    rel: '最小验证/V2-BatchV-A-coefficient-buckets.json',
    kind: 'coefficient_buckets_json',
    abs: () => paths.coeffBucketsA,
  },
  {
    rel: '最小验证/V2-BatchV-B-3082-wardens-mail-coefficient-buckets.json',
    kind: 'coefficient_buckets_json',
    abs: () => paths.coeffBucketsB,
  },
  {
    rel: '最小验证/V2-Batch-A-target-dummies.seed.json',
    kind: 'seed_json',
    abs: () => paths.batchASeed,
  },
  {
    rel: '最小验证/V2-Batch-C-adc-items.seed.json',
    kind: 'seed_json',
    abs: () => paths.batchCSeed,
  },
  {
    rel: KATARINA_LEGACY_SEED_REL,
    kind: 'seed_json',
    abs: () => paths.katarinaLegacySeed,
  },
  {
    // Provenance-only EXTRA Wiki sidecar: hashed/parsed, zero coverage records.
    rel: MALZAHAR_E_WIKI_REL,
    kind: 'document_json',
    abs: () => paths.malzaharEWiki,
  },
];

/** Exact generator hashes only. */
const GENERATOR_SOURCE_ALLOWLIST = [
  {
    rel: '最小验证/数据/build-wiki-only-mechanism-candidate-registry.mjs',
    kind: 'generator_mjs',
  },
  {
    rel: '最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs',
    kind: 'generator_mjs',
  },
  {
    rel: GENERATOR_PATH,
    kind: 'generator_mjs',
  },
];

/**
 * Exact non-hashed path strings permitted in sourceRefs/alias attachments.
 * disposition: current_generic_evidence | data_only_regression | historical_reference
 * No historical-only path may enter sources / currentInputHashes.
 */
const HISTORICAL_SOURCE_REF_ALLOWLIST = [
  { path: '最小验证/V2-Batch-B-hero-passives.seed.json', disposition: 'data_only_regression' },
  { path: '最小验证/V2-Batch-D-adc-item-passives.seed.json', disposition: 'data_only_regression' },
  { path: BATCH_G_AUDIT_REL, disposition: 'historical_reference' },
  { path: '最小验证/V2-Batch-J-status-damage-audit.json', disposition: 'historical_reference' },
  { path: '最小验证/V2-Batch-J-status-damage-migration.seed.json', disposition: 'data_only_regression' },
  { path: '最小验证/V2-Batch-K-guinsoo-phantom-hit-audit.json', disposition: 'current_generic_evidence' },
  { path: '最小验证/V2-Batch-L-spellblade-next-attack-audit.json', disposition: 'current_generic_evidence' },
  { path: '最小验证/V2-Batch-M-attr-read-trinity-base-ad-audit.json', disposition: 'current_generic_evidence' },
  { path: '最小验证/V2-Batch-N-energized-charge-and-consume-audit.json', disposition: 'current_generic_evidence' },
  { path: '最小验证/V2-Batch-P-target-equipment-linked-effects-audit.json', disposition: 'current_generic_evidence' },
  { path: '最小验证/V2-Batch-P-target-equipment-linked-effects.seed.json', disposition: 'data_only_regression' },
  { path: '最小验证/V2-BatchV-A-data-policy-items.seed.json', disposition: 'data_only_regression' },
  { path: '最小验证/V2-BatchV-B-3082-wardens-mail.seed.json', disposition: 'data_only_regression' },
  { path: '最小验证/V2-BatchV-equipment-tooltip-passive-candidates.seed.json', disposition: 'data_only_regression' },
  { path: '最小验证/V2-FullItem-3094-rapid-firecannon-energized.seed.json', disposition: 'data_only_regression' },
];

const HISTORICAL_SOURCE_REF_PATHS = new Set(
  HISTORICAL_SOURCE_REF_ALLOWLIST.map((e) => e.path),
);
const ACTIVE_SOURCE_PATHS = new Set(ACTIVE_SOURCE_ALLOWLIST.map((e) => e.rel));
const GENERATOR_SOURCE_PATHS = new Set(GENERATOR_SOURCE_ALLOWLIST.map((e) => e.rel));
const ALLOWED_HASHED_SOURCE_PATHS = new Set([
  ...ACTIVE_SOURCE_PATHS,
  ...GENERATOR_SOURCE_PATHS,
]);
const ALLOWED_SOURCEREF_PATHS = new Set([
  ...ACTIVE_SOURCE_PATHS,
  ...HISTORICAL_SOURCE_REF_PATHS,
]);

/**
 * Exact seed alias/sourceRef attachments. Do not read or hash these seed files.
 * Reproduces prior attachSeedSourceRefs intended per-mechanism refs.
 */
const SEED_REFERENCE_ATTACHMENTS = [
  { mechanismKey: 'hero_skill|hero_draven|Q|旋转飞斧', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_draven_q_spinning_axe_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_draven_q_spinning_axe_dps_v2' },
  { mechanismKey: 'hero_skill|hero_kaisa|P|体表活肤', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_kaisa_p_plasma_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_kaisa_p_plasma_dps_v2' },
  { mechanismKey: 'hero_skill|hero_kogmaw|Q|腐蚀唾液', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_kogmaw_q_caustic_spittle_passive_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_kogmaw_q_caustic_spittle_passive_dps_v2' },
  { mechanismKey: 'hero_skill|hero_kogmaw|W|生化弹幕', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_kogmaw_w_bio_arcane_barrage_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_kogmaw_w_bio_arcane_barrage_dps_v2' },
  { mechanismKey: MALZAHAR_E_KEY, path: '最小验证/V2-Batch-J-status-damage-migration.seed.json', sourceRecordKey: 'skill_malzahar_e', legacyStatus: 'data_only_regression', alias: 'skill_malzahar_e' },
  { mechanismKey: 'hero_skill|hero_teemo|E|毒性射击', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_teemo_e_toxic_shot_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_teemo_e_toxic_shot_dps_v2' },
  { mechanismKey: 'hero_skill|hero_teemo|P|游击队军备', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_teemo_p_guerrilla_warfare_attack_speed_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_teemo_p_guerrilla_warfare_attack_speed_dps_v2' },
  { mechanismKey: 'hero_skill|hero_twistedfate|E|卡牌骗术', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_twistedfate_e_stacked_deck_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_twistedfate_e_stacked_deck_dps_v2' },
  { mechanismKey: 'hero_skill|hero_twitch|P|死亡毒液', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_twitch_p_deadly_venom_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_twitch_p_deadly_venom_dps_v2' },
  { mechanismKey: 'hero_skill|hero_twitch|Q|埋伏', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_twitch_q_ambush_attack_speed_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_twitch_q_ambush_attack_speed_dps_v2' },
  { mechanismKey: 'hero_skill|hero_varus|P|复仇之欲', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_varus_p_revenge_champion_takedown_attack_speed_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_varus_p_revenge_champion_takedown_attack_speed_dps_v2' },
  { mechanismKey: 'hero_skill|hero_varus|P|复仇之欲', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_varus_p_revenge_minion_kill_attack_speed_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_varus_p_revenge_minion_kill_attack_speed_dps_v2' },
  { mechanismKey: 'hero_skill|hero_varus|W|枯萎箭袋', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_varus_w_blighted_quiver_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_varus_w_blighted_quiver_dps_v2' },
  { mechanismKey: 'hero_skill|hero_vayne|W|圣银弩箭', path: '最小验证/V2-Batch-B-hero-passives.seed.json', sourceRecordKey: 'skill_vayne_w_silver_bolts_dps_v2', legacyStatus: 'seed_skill', alias: 'skill_vayne_w_silver_bolts_dps_v2' },
  { mechanismKey: 'item_passive|3036|item_passive|巨人杀手', path: '最小验证/V2-BatchV-A-data-policy-items.seed.json', sourceRecordKey: 'item_3036_lord_dominiks_giant_slayer_batch_v_a', legacyStatus: 'seed_skill', alias: 'item_3036_lord_dominiks_giant_slayer_batch_v_a' },
  { mechanismKey: 'item_passive|3075|item_passive|荆棘', path: '最小验证/V2-Batch-P-target-equipment-linked-effects.seed.json', sourceRecordKey: 'item_3075_thornmail_thorns_dps_v2', legacyStatus: 'seed_skill', alias: 'item_3075_thornmail_thorns_dps_v2' },
  { mechanismKey: 'item_passive|3094|item_passive|神射手', path: '最小验证/V2-FullItem-3094-rapid-firecannon-energized.seed.json', sourceRecordKey: 'item_3094_rapid_firecannon_energized_dps_v2', legacyStatus: 'seed_skill', alias: 'item_3094_rapid_firecannon_energized_dps_v2' },
  { mechanismKey: 'item_passive|3100|item_passive|咒刃', path: '最小验证/V2-BatchV-equipment-tooltip-passive-candidates.seed.json', sourceRecordKey: 'item_3100_lich_bane_spellblade_dps_v2', legacyStatus: 'seed_skill', alias: 'item_3100_lich_bane_spellblade_dps_v2' },
  { mechanismKey: 'item_passive|3115|item_passive|艾卡西亚之咬', path: '最小验证/V2-BatchV-equipment-tooltip-passive-candidates.seed.json', sourceRecordKey: 'item_3115_nashors_tooth_icathian_bite_dps_v2', legacyStatus: 'seed_skill', alias: 'item_3115_nashors_tooth_icathian_bite_dps_v2' },
  { mechanismKey: 'item_passive|3508|item_passive|咒刃', path: '最小验证/V2-BatchV-equipment-tooltip-passive-candidates.seed.json', sourceRecordKey: 'item_3508_essence_reaver_spellblade_dps_v2', legacyStatus: 'seed_skill', alias: 'item_3508_essence_reaver_spellblade_dps_v2' },
  { mechanismKey: 'item_passive|6672|item_passive|放倒它', path: '最小验证/V2-Batch-D-adc-item-passives.seed.json', sourceRecordKey: 'item_6672_kraken_slayer_bring_it_down_dps_v2', legacyStatus: 'seed_skill', alias: 'item_6672_kraken_slayer_bring_it_down_dps_v2' },
];

/** Exact G8 candidateKey → unified status override (takes precedence over default mapping). */
const STATUS_OVERRIDES = new Map([
  [
    'item_passive|3124|item_passive|沸腾打击',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        '满层后每第三次攻击 phantom（连续 7/10/13…）；到达第 4 层不计 counter；generic state_change+condition+conditional repeat 已由 generic_guinsoo_k_test.go TestGenericRunGuinsooCadenceEveryThirdAtFull 闭环，非 threshold-repeat alone。',
      blocker: '',
    },
  ],
  [
    'hero_skill|hero_kaisa|P|体表活肤',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        "Kai'Sa P Second Skin：Wiki rev4038390（SHA256 f7adc35c58f47d28f8bd098a1303cf5cfef5a414783cde389ecf07240e95515f）+ 当前 canonical generic ABI 口径与 wasm-generic-kaisa-second-skin + backend seed 证据闭环——provider-target plasma_stacks（default0/max5/4000ms refresh-on-write）；level1..18 精确插值 base=4+20/17*(level-1)、perStack=1+5/17*(level-1)；同 provider 有序普攻图：Caustic→+1 stack→第五层已损生命破裂→reset→物理普攻→恰好一次 event/basic_attack_hit。明确排除 W 2/3 层与 overflow、友军定身 Plasma、野怪 400 cap、法术护盾、Guinsoo phantom/buff-slot、多目标，故标 completed。",
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kaisa-second-skin',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_kaisa_second_skin_test.go',
          sourceWorktree: 'wasm',
          note: 'completed Second Skin canonical generic; excluded W stacks/overflow / allied CC Plasma / monster 400 cap / spell shield / Guinsoo phantom-buff-slot / multi-target',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kaisa-second-skin',
          sourcePath: 'db/game_manage/seeds/lol_generic_kaisa_second_skin_seed.sql',
          sourceWorktree: 'backend',
          note: 'Second Skin canonical generic seed; excluded branches out of scope',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_ashe|W|万箭齐发',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Ashe W Volley：当前 League Wiki + 用户批准 1v1 口径（rank5 200+100% bonus AD / 单目标一次 physical damage / 55 mana / 4000ms CD / first-arrow-only）与 wasm-generic-ashe-volley + backend seed 证据闭环。用户明确排除 Frost Shot 减速/状态、弹道/锥形/碰撞/多目标、per-arrow 循环与其它 rank；Wiki 写明多箭命中同一目标仅计第一箭伤害，故标 completed。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ashe-volley',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_ashe_volley_test.go',
          sourceWorktree: 'wasm',
          note: 'user-approved Volley 1v1; excluded Frost Shot / projectile-cone-collision-multitarget / per-arrow loop / other ranks',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ashe-volley',
          sourcePath: 'db/game_manage/seeds/lol_generic_ashe_volley_seed.sql',
          sourceWorktree: 'backend',
          note: 'Volley user-approved 1v1 seed; excluded branches out of scope',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_ashe|R|魔法水晶箭',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Ashe R 魔法水晶箭/Enchanted Crystal Arrow：Wiki rev4026934（SHA256 1d9ccefa98a41e57a088e76aaca16f7a78141e7373616520e2d6ba13f450664f；normalized/generic/ashe-r.json）rank3 Phase-A v1 已由 wasm-generic-ashe-enchanted-crystal-arrow-primary-hit + backend seed 证据闭环——100 mana / 60000ms CD；immediate primary-target scaffold（明确排除而非建模 Wiki cast0.25 与 Effect at cast time start）；恰好一次 non-crit/non-copyable magic damage 600+1.20*source.attr.ap.resolved（交叉校验 AP200 → raw840，target MR100 → mitigated420）。Attempts t0/t59999/t60000 → two successes + exactly one cooldown skip without mana/damage；final mana 80 from 280；HP 1000→160。completedBoundary：rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight。明确排除 cast0.25/effect-at-cast-time-start、projectile/travel/collision/geometry、distance-scaled stun、surrounding same-damage AOE/Frost、sight、ranks1–2、Ashe P/Q/W/basic/on-hit/equipment/loadout、live/publish/E2E/full fidelity；不宣称 cast/projectile/stun/AOE/Frost/sight 保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ashe-enchanted-crystal-arrow-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_ashe_enchanted_crystal_arrow_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight; Wiki rev4026934/SHA256 1d9ccefa… rank3 100 mana/60000ms CD / one magic 600+1.20*AP; AP200→raw840/MR100→420; t0/t59999/t60000 two successes + one CD skip; final mana80/HP160; immediate scaffold excludes Wiki cast0.25 and Effect at cast time start; cast/projectile/travel/collision/geometry/distance-stun/AOE/Frost/sight/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ashe-enchanted-crystal-arrow-primary-hit',
          sourcePath:
            'db/game_manage/seeds/lol_generic_ashe_enchanted_crystal_arrow_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight; backend lol_generic_ashe_enchanted_crystal_arrow_primary_hit_seed.sql + LolGenericAsheEnchantedCrystalArrowPrimaryHitSeedSqlTest (owning 5d4a13f; integrated 2f820e4); Wasm exact test commit bb3dd81; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_akshan|P|无所不用',
    {
      status: 'blocked_data',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason:
        'Akshan P Dirty Fighting：Wiki rev4038197（SHA256 22ba762382dedced4b63a451c4513cb3129e3b16a137236e5b637eea7510b534）+ canonical generic ABI 与 wasm-generic-akshan-dirty-fighting + backend 双边证据已闭环伤害核心——CompileFrame→session→RunFrame→ReleaseSessionFrame；typed 普攻物理；provider-target dirty_fighting_stacks（0/max3/5000ms refresh-on-write）；第三层魔法 15/40/80/150 @ 1/6/11/16 +60% AP 消耗重置；护甲/MR/阈值/AP/refresh/expiry/从零第四击/每次攻击一次 basic_attack_hit。completionMode=partial（非 full）：被动第二发 50% AD 仅 after a delay，exact delay ms 未公布（blocked_data）；技能命中叠层缺 accurate_ability_hit_event_wiring；英雄护盾与取消第二发移速及换目标/小兵/多目标 out of damage scope。',
      blocker: 'second_shot_exact_delay_ms_not_published',
      dataGapEvidence: {
        sourceVersion: 'lol-wiki-rev-4038197',
        sourceRef:
          '数据参考/lol-wiki-current-champions/normalized/reviewed-contracts.json#akshan-p',
        availableEffectTables: {
          thirdStackMagicByLevel: [15, 40, 80, 150],
          thirdStackMagicLevels: [1, 6, 11, 16],
          secondShotAdRatio: [0.5],
          stackCap: [3],
          stackDurationMs: [5000],
        },
        availableCooldowns: [],
        availableCosts: {},
        tooltipPlaceholders: [],
        unresolvedDamagePlaceholders: [],
        varsMapEmpty: false,
        variablesEmpty: false,
        variables: [
          'dirty_fighting_stacks',
          'third_stack_magic_15_40_80_150_plus_60pct_ap',
          'second_shot_50pct_ad_after_a_delay',
        ],
        missingFields: ['secondShotDelayMs'],
        gapKind: 'wiki_delay_ms_unpublished',
        reasonZh:
          'Akshan P Dirty Fighting：被动第二发 Wiki 写明 50% AD 且 after a delay，但 exact delay milliseconds 未公布；不得臆造 delay。伤害核心（普攻叠层/第三层魔法）已部分闭环。',
        blocker: 'second_shot_exact_delay_ms_not_published',
      },
      runtimeGapEvidence: {
        sourceRef:
          '数据参考/lol-wiki-current-champions/normalized/reviewed-contracts.json#akshan-p',
        dataStatus: 'partial',
        requiredEvents: ['basic_attack_hit', 'accurate_ability_hit'],
        requiredState: ['dirty_fighting_stacks'],
        requiredFormulaInputs: ['ability_power', 'champion_level', 'attack_damage'],
        requiredScheduling: [],
        missingPrimitives: ['accurate_ability_hit_event_wiring'],
        completedBoundary:
          'AA Dirty Fighting core closed: CompileFrame→session→RunFrame→ReleaseSessionFrame; typed physical BA; dirty_fighting_stacks 0/max3/5000ms refresh-on-write; third-stack magic 15/40/80/150@1/6/11/16 +60% AP consume-reset; armor/MR/AP thresholds; refresh/expiry; fourth-from-zero; one basic_attack_hit per attack',
        remainingBoundary:
          '技能命中亦叠层，但 exact generic ability-hit event wiring 未建立；不得用 ability_started 替代。英雄护盾与取消第二发移速及换目标/小兵/多目标非核心分支 out of damage scope。',
      },
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-akshan-dirty-fighting',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_akshan_dirty_fighting_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: Dirty Fighting AA core; remainingGap: secondShotDelayMs / accurate_ability_hit_event_wiring / shield+cancel-MS+retarget OOS',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-akshan-dirty-fighting',
          sourcePath: 'db/game_manage/seeds/lol_generic_akshan_dirty_fighting_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: Dirty Fighting AA damage core; remainingGap: secondShotDelayMs / ability-hit wiring / shield+cancel-MS+retarget OOS',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_akshan|Q|去而复还',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Akshan Q 去而复还/Avengerang：Wiki request Template:Data Akshan/Q → resolved Template:Data Akshan/Avengerang；page1502462 / rev4007510 / timestamp 2026-04-11T22:35:01Z / canonical bytes2570 / SHA256 1cbf7dda955849d05ad2d7e578ed9507f8f61fc7525c5ed006a25185915b5f5b（normalized/generic/akshan-q.json plus pages sibling are authority）rank5 Phase-A v4 已由 wasm-generic-akshan-avengerang-first-outbound-hit + backend seed 证据闭环——local raw caveat bytes2570 / SHA 407e4671cc05e87edcd0038a9efe614ad98f65cd57ce339c2c9d69afe5b8c973（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；80 mana / immediate cooldown scaffold 5000ms（Wiki real cooldown starts after return is completed-boundary exclusion, not claimed implemented and not a remaining blocker）；immediate selected-primary-champion first-outbound-pass single physical hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable physical damage operation add(const 165, mul(const 0.70, sub(read source.attr.ad.resolved, read source.attr.ad.base)))（exact nested binary；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no Q ability-specific type）（交叉校验 armor100 base52/resolved52 raw165/final82.5；base52/resolved152 raw235/final117.5；base0/resolved100 versus base52/resolved152 both raw/final235）。Attempts mana240/baseAD52/resolvedAD152/HP1000/armor100 at t0/t4999/t5000 → success/skip/success，exactly two Q damage items；final mana80/HP765；exactly two automatic Q ability_started；mana79 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Dirty Fighting/basic coexistence preserved and Q does not synthesize ability-hit stacks。Akshan Q provider is standalone；Backend has no repository-owned hero_akshan / AD / mana materializer beyond Dirty Fighting prerequisites；record external existing-data/check-only prerequisites only；不暗示 Akshan P/W/E/R/Dirty Fighting stack synthesis dependence；不暗示 Batch-B 或 sibling Akshan synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Main focused12/full1010 passed。Wasm main validation passed gofmt/focused Akshan/Ezreal、Akshan count100、full Go、build、smoke、bench；exact test bytes66516 / SHA256 dc922f4249cb87a5f6afda8f3a88dac011cc5a5683ff6c0a9a8c5cfd16618805；built production and independent Web source asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no production/Web write。completedBoundary：rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity。明确排除 direction/range/extension/return pass/homing/projectile travel、cooldown-start-after-return、sight/reveal/movement speed、non-champion damage/spellshield、other ranks/siblings/loadout/bootstrap/crit/onhit/live/full fidelity；this is exactly one selected-primary first-outbound-pass physical hit, not full Q；不宣称 direction/range/extension/return/homing/projectile/cooldown-after-return/sight/reveal/MS/non-champion/spellshield/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_akshan/ad/mana via Dirty Fighting），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-akshan-avengerang-first-outbound-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_akshan_avengerang_first_outbound_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity; Wiki request Template:Data Akshan/Q → Avengerang; rev4007510/SHA256 1cbf7dda… / bytes2570; local raw caveat bytes2570/SHA 407e4671… no equivalence claim; rank5 80 mana/immediate cooldown scaffold 5000ms (real CD after return excluded); one physical 165+0.70*bonusAD via exact nested binary add(const165, mul(0.70, sub(ad.resolved,ad.base))); armor100 base52/resolved52 raw165/final82.5; base52/resolved152 raw235/final117.5; base0/resolved100 vs base52/resolved152 both raw/final235; damage 20220/add 20170; no 20230; no explicit event op; no Q type; mana240/baseAD52/resolvedAD152/HP1000/armor100 t0/t4999/t5000 success/skip/success two Q damage items final mana80/HP765 two automatic Q ability_started; mana79 resource skip unchanged; Dirty Fighting/basic coexistence preserved and Q does not synthesize ability-hit stacks; standalone no sibling synthesis; Wasm exact test commit b58a549 bytes66516/SHA dc922f42…; direction/range/extension/return/homing/projectile/cooldown-after-return/sight/reveal/MS/non-champion/spellshield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-akshan-avengerang-first-outbound-hit',
          sourcePath:
            'db/game_manage/seeds/lol_generic_akshan_avengerang_first_outbound_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity; backend lol_generic_akshan_avengerang_first_outbound_hit_seed.sql + LolGenericAkshanAvengerangFirstOutboundHitSeedSqlTest + README (owning bd8dbcb; integrated 45d589a); Wasm exact test commit b58a549; seed30848/SHA d45d8297…; JUnit59429/SHA 2f64e5c0…; README291215/SHA 188b0174…; external existing-data/check-only prerequisites (hero_akshan/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Akshan synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_sivir|Q|回旋之刃',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Sivir Q 回旋之刃/Boomerang Blade：Wiki request Template:Data Sivir/Q → resolved Template:Data Sivir/Boomerang Blade；page1308837 / rev4016378 / timestamp 2026-05-11T05:05:57Z / canonical bytes2745 / SHA256 0adcf3916b63e8b0ae6c2c7ad74d1796e3362a3a22682c58ef92aaccfae43e5e（normalized/generic/sivir-q.json bytes3018/SHA256 2320f7ada83cceee979c52cd314395c6b41e2f50c50e3114e9bca0d39386ff02 plus pages sibling bytes691/SHA256 adeab85889a4208b52f0b6cd3bcc3aef022a986dcad5168e1c817e3ab3323fa9 are authority）rank5 Phase-A v3 已由 wasm-generic-sivir-boomerang-blade-first-outbound-hit + backend seed 证据闭环——local raw caveat bytes2745 / SHA b8d46412519f211b27f2575684693f407806cbbca337a80e775a1baf4c2396a4（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；one standalone Q provider；rank5 mana75 / CD8000；immediate selected-primary-champion first-outbound-pass single physical noncrit/noncopyable damage scaffold；exact generic formula (160+0.70*(ad.resolved-ad.base)+0.60*ap.resolved)*(1+0.40*min(1,max(0,crit_chance.resolved))) via nested binary nodes with each read path exactly once and formula-local crit_chance clamp（no DB-bound/random crit / crit_damage / CritEligible claim）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no Q ability-specific type）（交叉校验 armor100 fixtures raw290/348/406 → final145/174/203；negative/overcap clamp；bonusAD/AP counterproof）。Attempts mana225/baseAD60/resolvedAD160/AP100/crit0.5/HP1000/armor100 at t0/t7999/t8000 → success/skip/success，exactly two Q damage items；final mana75/HP652；exactly two automatic Q ability_started；mana74 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Sivir Q provider is standalone；Backend external existing-data/check-only prerequisites only（hero_sivir/ad/ap/crit_chance/mana）；no Sivir materializer/shared identity-panel-resource write；current generic missing formula attrs read zero, not claimed fail-closed；hero-named `_test.go` is regression/governance evidence only；不暗示任何 production Wasm/public ABI/Web change。READY gate run-4db83782-b7af-4a56-8a75-2b687cc456a4 v3。Backend validation honesty：Main focused64/full1023 passed；mirror b14c48f exact parity with Sivir JUnit13 PASS；combined mirror sibling caveat: pre-existing Essence Reaver/Twisted Fate must BEGIN failures, not hidden/fixed here。Wasm main validation passed focused ten top-level、count100、full Go、Go bench、build、Node smoke+bench、parity PASS；exact test bytes79086 / SHA256 77a27da736577acc9a1bfd6728472a2b84c6a07353314528b115b112b917cc44；built production and independent Web source asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no production/Web write。completedBoundary：rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_base_160_plus_0_70_bonus_ad_plus_0_60_ap_scaled_by_0_to_0_40_formula_clamped_crit_chance; no_cast_time_bonus_attack_speed_direction_range_width_geometry_projectile_travel_speed_nonchampion_hit_reduction_return_pass_damage_modifier_reset_once_per_pass_spellshield_other_ranks_or_full_fidelity。明确排除 cast time/bonus attack speed/direction/range/width/geometry/projectile travel/speed、nonchampion hit reduction、return pass/damage modifier reset/once-per-pass、spellshield、other ranks/siblings/loadout/bootstrap/live/full fidelity；this is exactly one selected-primary first-outbound hit, not full Q；不宣称 cast/BAS/direction/range/width/geometry/projectile/nonchampion/return/once-per-pass/spellshield/other-ranks/完整游戏保真；no full-fidelity claim；no live/Admin/E2E claim。Backend seed 显式依赖 external existing-data/check-only 前置，不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-sivir-boomerang-blade-first-outbound-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_sivir_boomerang_blade_first_outbound_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_base_160_plus_0_70_bonus_ad_plus_0_60_ap_scaled_by_0_to_0_40_formula_clamped_crit_chance; no_cast_time_bonus_attack_speed_direction_range_width_geometry_projectile_travel_speed_nonchampion_hit_reduction_return_pass_damage_modifier_reset_once_per_pass_spellshield_other_ranks_or_full_fidelity; Wiki request Template:Data Sivir/Q → Boomerang Blade; rev4016378/SHA256 0adcf391… / bytes2745; local raw caveat bytes2745/SHA b8d46412… no equivalence claim; rank5 mana75/CD8000; one physical (160+0.70*(ad.resolved-ad.base)+0.60*ap.resolved)*(1+0.40*min(1,max(0,crit_chance.resolved))) nested binary read-once formula-local clamp; armor100 raw290/348/406 final145/174/203; negative/overcap clamp; bonusAD/AP counterproof; damage 20220/add 20170; no 20230; no explicit event op; no Q type; mana225 t0/t7999/t8000 success/skip/success two Q damage items final mana75/HP652 two automatic Q ability_started; mana74 resource skip unchanged; missing formula attrs read zero not fail-closed; hero-named _test.go regression/governance only; standalone no sibling synthesis; Wasm exact test commit bff4d160 bytes79086/SHA 77a27da7…; cast/BAS/direction/range/width/geometry/projectile/nonchampion/return/once-per-pass/spellshield/other-ranks/live/Admin/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-sivir-boomerang-blade-first-outbound-hit',
          sourcePath:
            'db/game_manage/seeds/lol_generic_sivir_boomerang_blade_first_outbound_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_base_160_plus_0_70_bonus_ad_plus_0_60_ap_scaled_by_0_to_0_40_formula_clamped_crit_chance; no_cast_time_bonus_attack_speed_direction_range_width_geometry_projectile_travel_speed_nonchampion_hit_reduction_return_pass_damage_modifier_reset_once_per_pass_spellshield_other_ranks_or_full_fidelity; backend lol_generic_sivir_boomerang_blade_first_outbound_hit_seed.sql + LolGenericSivirBoomerangBladeFirstOutboundHitSeedSqlTest + README (owning 3ded9cb; integrated b14c48f); Wasm exact test commit bff4d160; seed32326/SHA 4ba04a00…; JUnit63624/SHA 2f3368a9…; READY run-4db83782; Sivir JUnit13 PASS; combined mirror sibling caveat pre-existing Essence Reaver/Twisted Fate must BEGIN failures not hidden/fixed here; external existing-data/check-only prerequisites (hero_sivir/ad/ap/crit_chance/mana; does not write identity/panel/resource values; no Sivir materializer); standalone no Batch-B or sibling Sivir synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_akshan|E|骄行荡寇',
    {
      status: 'out_of_scope',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Akshan E Heroic Swing：已审阅的非单目标摆荡/射击路径分支；Wiki per-shot 数值已知，但 swing/terrain/multi-target 路径超出单目标 DPS 审计边界。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: {
        sourceRef:
          '数据参考/lol-wiki-current-champions/normalized/reviewed-contracts.json#akshan-e@rev4007412',
        sourceTextSummary:
          'Akshan Heroic Swing: hook→swing→periodic shots; multi-target/terrain path outside 1v1 DPS audit.',
        reviewedPrimaryTargetDamageBranch: true,
        boundaryCategory: 'explicit_user_scope',
        excludedBehavior: 'explicit_user_audit_scope',
        boundaryReason:
          '骄行荡寇：用户显式划定审计范围外（摆荡/地形/多目标射击路径）；主目标伤害分支已复核为边界外。',
        damageRelevantSubBranchDisposition: 'trigger_phrase_no_damage_amp',
      },
    },
  ],
  [
    'hero_skill|hero_ezreal|P|咒能高涨',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Ezreal P Rising Spell Force：Wiki rev3932280（SHA256 5996c969e2d1b53b3c805737fa161b4a9e235d6e7b7c74899a6580de34ca77ba）+ 本次采用的确定性 1v1 口径与 wasm-generic-ezreal-rising-spell-force + backend seed 证据闭环——每次 scheduled top-level 非普攻能力命中唯一目标 +1 provider-scoped stack；6000ms refresh-on-write；cap 5；每层 +10% AS（cap +50%）。本次口径明确排除普攻叠层、CD-skip cast、miss、多目标、单次施法多段命中与真实 Q/W/E/R 图，故标 completed。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ezreal-rising-spell-force',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_rising_spell_force_test.go',
          sourceWorktree: 'wasm',
          note: 'bounded 1v1 Rising Spell Force; excluded basic attacks / CD-skip / misses / multi-target / multi-hit-per-cast / real QWER graphs',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ezreal-rising-spell-force',
          sourcePath: 'db/game_manage/seeds/lol_generic_ezreal_rising_spell_force_seed.sql',
          sourceWorktree: 'backend',
          note: 'Rising Spell Force bounded 1v1 seed; excluded branches out of scope',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_ezreal|R|精准弹幕',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Ezreal R 精准弹幕/Trueshot Barrage：Wiki rev4013235（SHA256 e9d7f9d7411bcbb1ab00aeb89fe03a4fb8511625fc0a64266f5f63ced53580e0；normalized/generic/ezreal-r.json）rank3 Phase-A v2 已由 wasm-generic-ezreal-trueshot-barrage-primary-hit + backend seed 证据闭环——100 mana / 90000ms CD；immediate primary-champion scaffold（明确排除而非建模 Wiki cast1 / queue0.5 与 Effect at cast time start）；恰好一次 non-crit/non-copyable magic damage 750+1.00*(source.attr.ad.resolved-source.attr.ad.base)+1.10*source.attr.ap.resolved（交叉校验 baseAD60 / resolvedAD110 / AP200 → raw1020，target MR100 → mitigated510）。Attempts t0/t89999/t90000 → two successes + exactly one cooldown skip without mana/damage；final mana 100 from 300；HP 1500→480。completedBoundary：rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage。明确排除 cast1/queue0.5/effect-at-cast-start、projectile/travel/collision/global geometry/direction、multitarget/sight、minion/monster modified rank3 300+1.00 bonusAD+1.10 AP、ranks1–2、P/Q/W/E/basic/on-hit/equipment/loadout、live/publish/E2E/full fidelity；不宣称 cast/queue/projectile/geometry/direction/multitarget/sight/minion-monster-modified 保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_ezreal ad/ap/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ezreal-trueshot-barrage-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_trueshot_barrage_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage; Wiki rev4013235/SHA256 e9d7f9d7… rank3 100 mana/90000ms CD / one magic 750+1.00*bonusAD+1.10*AP; baseAD60/resolvedAD110/AP200→raw1020/MR100→510; t0/t89999/t90000 two successes + one CD skip; final mana100/HP480; immediate scaffold excludes Wiki cast1/queue0.5 and Effect at cast time start; cast/queue/projectile/geometry/direction/multitarget/sight/minion-monster-modified/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ezreal-trueshot-barrage-primary-hit',
          sourcePath:
            'db/game_manage/seeds/lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage; backend lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql + LolGenericEzrealTrueshotBarragePrimaryHitSeedSqlTest (owning dea4538; integrated 8c93017); Wasm exact test commit e13d887; external existing-data/check-only prerequisites (does not write identity/panel/resource values); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_ezreal|E|奥术跃迁',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Ezreal E 奥术跃迁/Arcane Shift：Wiki request Template:Data Ezreal/E → resolved Template:Data Ezreal/Arcane Shift；page1307111 / rev3989862 / timestamp 2026-02-03T23:19:20Z / canonical bytes1661 / SHA256 7ac83f7eaa237641c478f2e3ffa1a2714f7da0644c8a488ab6a6f47b67e27347（normalized/generic/ezreal-e.json）rank5 Phase-A v3 已由 wasm-generic-ezreal-arcane-shift-primary-hit + backend seed 证据闭环——local raw caveat bytes1661 / SHA f48a32706234b0c1ef1abab4b7f90e4ee88944623827fb22a41e23bdfac01792（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；70 mana / 14000ms CD；immediate primary-champion scaffold；恰好一次 non-crit/non-copyable magic damage 280+0.60*(source.attr.ad.resolved-source.attr.ad.base)+0.75*source.attr.ap.resolved（nested binary add；交叉校验 raw/mit 280/140、310/155、430/215、460/230）。Attempts t0/t13999/t14000 mana210 → two successes + exactly one cooldown skip without mana/damage；final mana 70；HP 1000→540；mana69 → resource skip/unchanged。成功命中保留既有 Rising Spell Force 一层：successful t0 + CD skip t100 → exactly one damage/ability_started/P stack and AS1.1。completedBoundary：rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks。明确排除 blink/homing/target-selection/visibility/Essence Flux priority、projectile/travel/reveal、ranks1–4、other Ezreal skills/basic、loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 blink/homing/visibility/Essence-Flux/projectile/reveal/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_ezreal ad/ap/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ezreal-arcane-shift-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_arcane_shift_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks; Wiki request Template:Data Ezreal/E → Arcane Shift; rev3989862/SHA256 7ac83f7e… / bytes1661; local raw caveat bytes1661/SHA f48a3270… no equivalence claim; rank5 70 mana/14000ms CD / one magic 280+0.60*bonusAD+0.75*AP nested binary add; branches raw/mit 280/140 310/155 430/215 460/230; t0/t13999/t14000 mana210 two successes + one CD skip final mana70/HP540; mana69 resource skip unchanged; P coexistence successful t0 + CD skip t100 → exactly one damage/ability_started/P stack and AS1.1; Wasm exact test commit 065beb1; blink/homing/visibility/Essence-Flux/projectile/reveal/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ezreal-arcane-shift-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_ezreal_arcane_shift_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks; backend lol_generic_ezreal_arcane_shift_primary_hit_seed.sql + LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest + README (owning 89e6677; integrated 0594b20); Wasm exact test commit 065beb1; nested binary add; external existing-data/check-only prerequisites (does not write identity/panel/resource values); Web source asset exact parity (no Web change/commit); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_ezreal|Q|秘术射击',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Ezreal Q 秘术射击/Mystic Shot：Wiki request Template:Data Ezreal/Q → resolved Template:Data Ezreal/Mystic Shot；page1307107 / rev4013233 / timestamp 2026-04-28T21:19:30Z / canonical bytes2054 / SHA256 be5a24861dc53970c19378fe8bea17b242b5b406a588cebb32b0d59a4af4b533（normalized/generic/ezreal-q.json plus pages sibling are authority）rank5 Phase-A v2 已由 wasm-generic-ezreal-mystic-shot-primary-hit + backend seed 证据闭环——local raw caveat bytes2052 / SHA d8348b3b9eb4a076af5a87b714dd4de109643252f6b18fd2873f5a5bf7b05dbd（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；40 mana / 4500ms CD；immediate selected-primary-enemy-champion single physical hit scaffold；one immediate selected-primary-enemy-champion single noncritical/noncopyable physical damage operation add(add(const 120, mul(const 1.30, read source.attr.ad.resolved)), mul(const 0.40, read source.attr.ap.resolved))（exact nested binary add；total AD direct read；never bonus AD/subtraction；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no Q ability-specific type）（交叉校验 resolvedAD60/AP0/armor100 raw198/final99；resolvedAD160/AP0/armor100 raw328/final164；resolvedAD60/AP100/armor100 raw238/final119；resolvedAD160/AP100/armor100 raw368/final184；baseAD0 versus baseAD60 at resolvedAD160/AP0/armor100 both328/164）。Attempts mana120/baseAD60/resolvedAD160/AP100/HP1000/armor100 at t0/t4499/t4500 → success/skip/success，exactly two Q damage items；final mana40/HP632；exactly two automatic Q ability_started；mana39 at t0 → resource skip with mana/HP unchanged and no Q damage/event。成功命中保留既有 Rising Spell Force 一层：successful t0 + CD skip t100 → exactly one damage/ability_started/P stack and AS1.1。Ezreal Q provider is standalone；preserve existing P/E/R without requiring/mutating/synthesizing/copying them；Q seed contains no W rows；Backend has no repository-owned hero_ezreal / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Ezreal W dependence；不暗示 Batch-B 或 sibling Ezreal synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Main focused11/full998 passed。Wasm main validation passed gofmt/focused/count100/full/bench/build/smoke/benchmark；built and independent Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write；hero-named `_test.go` is regression/governance evidence only and excluded from production build。completedBoundary：rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity。明确排除 direction/range/projectile travel/collision/first-enemy acquisition、on-hit/on-attack/1.5s cooldown reduction、basic+spell dual-tag/lifesteal/vamp/spellshield/buffering、ranks1–4、other Ezreal skills/basic beyond coexistence、loadout/crit、live migration/publish/E2E/full fidelity；this is exactly one selected-primary-enemy-champion single physical hit, not full Q；不宣称 direction/range/projectile/collision/acquisition/on-hit/on-attack/CD-reduction/dual-tag/lifesteal/vamp/spellshield/buffering/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_ezreal ad/ap/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ezreal-mystic-shot-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_mystic_shot_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity; Wiki request Template:Data Ezreal/Q → Mystic Shot; rev4013233/SHA256 be5a2486… / bytes2054; local raw caveat bytes2052/SHA d8348b3b… no equivalence claim; rank5 40 mana/4500ms CD / one physical 120+1.30*totalAD+0.40*AP nested binary add; resolvedAD60/AP0/armor100 raw198/final99; resolvedAD160/AP0/armor100 raw328/final164; resolvedAD60/AP100/armor100 raw238/final119; resolvedAD160/AP100/armor100 raw368/final184; baseAD0 vs baseAD60 at resolvedAD160/AP0/armor100 both328/164; damage 20220/add 20170; no 20230; no explicit event op; no Q type; mana120/baseAD60/resolvedAD160/AP100/HP1000/armor100 t0/t4499/t4500 success/skip/success two Q damage items final mana40/HP632 two automatic Q ability_started; mana39 resource skip unchanged; P coexistence successful t0 + CD skip t100 → exactly one damage/ability_started/P stack and AS1.1; Wasm exact test commit 000e253; direction/range/projectile/collision/acquisition/on-hit/on-attack/CD-reduction/dual-tag/lifesteal/vamp/spellshield/buffering/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ezreal-mystic-shot-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_ezreal_mystic_shot_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity; backend lol_generic_ezreal_mystic_shot_primary_hit_seed.sql + LolGenericEzrealMysticShotPrimaryHitSeedSqlTest + README (owning 41fce6a; integrated ae66c56); Wasm exact test commit 000e253; nested binary add; external existing-data/check-only prerequisites (does not write identity/panel/resource values); Web source asset exact parity (no Web change/commit); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_graves|P|新命运',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Graves P New Destiny：Wiki rev4038342（SHA256 553bda222e9e85f0eff6d4cba3b8723979a58b68fba9097d2dfa1bd373117aa8；normalized/generic/graves-p.json + reviewed-contracts#graves-p）Phase-A 贴脸最大弹丸 1v1 已由 wasm-generic-graves-new-destiny + backend seed 证据闭环——合并物理 raw=AD*F(x)*(1+3*s)，F(x)=0.6895+0.01765*x*(0.595+0.0225*(x-1))，s=0.33302；CritEligible；natural/forced C2 override=((1+5*s)/(1+3*s))*(1+0.5*(crit_damage.resolved-1)) 不双乘 crit_damage；恰好一次 damage + 一次 event/basic_attack_hit，copyable_on_hit=false；ability/basic_attack→basic_damage；CompileFrame→RunFrame→ReleaseSessionFrame。明确排除精确装填速度公式（Wiki unknown，completed-boundary）、弹药/装填日程/lockout/Quickdraw、距离/锥形/弹道/碰撞、多目标、建筑、眼/植物、blind/dodge/block、击退、吸血、逐弹 Black Cleaver、独立弹丸实例、RNG crit、live migration/publish/E2E/完整技能保真，故标 completed。',
      blocker: '',
      dataGapEvidence: {
        sourceVersion: 'lol-wiki-rev-4038342',
        sourceRef:
          '数据参考/lol-wiki-current-champions/normalized/reviewed-contracts.json#graves-p@rev4038342',
        availableEffectTables: {
          normalPellets: [4],
          critPellets: [6],
        },
        availableCooldowns: [],
        availableCosts: {},
        tooltipPlaceholders: [],
        unresolvedDamagePlaceholders: [],
        varsMapEmpty: false,
        variablesEmpty: false,
        variables: [
          'point_blank_pellet_formulas_wiki_explicit',
          'reload_precise_formula_completed_boundary_exclusion',
        ],
        missingFields: [],
        gapKind: 'none',
        reasonZh:
          'Graves P Phase-A：贴脸合并弹丸伤害已闭环；Wiki 明确 unknown 的精确装填速度公式为 completed-boundary exclusion，不进入 missingFields。',
        blocker: '',
      },
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-graves-new-destiny',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_graves_new_destiny_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: Phase-A point-blank merged AA + C2 overrides; reload unknown is completed-boundary exclusion',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-graves-new-destiny',
          sourcePath: 'db/game_manage/seeds/lol_generic_graves_new_destiny_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: New Destiny Phase-A seed; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_graves|E|快速拔枪',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Graves E Quickdraw：Wiki rev4007744（SHA256 ff4c65c5ce2a0ac1ae757271fbb924b35bf4eca1af0f4d07a69d865db901a4e1；normalized/generic/graves-e.json）Phase-A 满层 True Grit 近似已由 wasm-generic-graves-quickdraw-max-stack + backend seed 证据闭环——rank5 mana40 / cooldown12000ms；一次 cast 直接 override true_grit_stacks=8；armor/bonus_armor 各 +152（19*8）；MR/bonus_MR 各 +76（19*0.5*8）；CompileFrame→RunFrame→ReleaseSessionFrame。明确排除 intermediate stacks、4s refresh/expiry、dash direction/geometry、reload、attack reset、pellet cooldown reduction、targeting/collision/multi-target/full fidelity（completed-boundary），故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-graves-quickdraw-max-stack',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_graves_quickdraw_max_stack_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: Phase-A max True Grit (rank5 mana40/CD12000ms / true_grit_stacks=8 / armor+bonus_armor +152 / MR+bonus_MR +76); intermediate stacks/4s refresh/dash/reload/attack-reset/pellet CDR/targeting/collision/multitarget/full fidelity are completed-boundary exclusions',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-graves-quickdraw-max-stack',
          sourcePath: 'db/game_manage/seeds/lol_generic_graves_quickdraw_max_stack_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: Quickdraw Phase-A max-stack seed; LolGenericGravesQuickdrawMaxStackSeedSqlTest; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_graves|W|烟幕弹',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Graves W 烟幕弹/Smoke Screen：Wiki rev3956197（SHA256 20348473fe3441eb32ab656423f577a62a415fadf33fbdc6fcf576bc8b1d210d；normalized/generic/graves-w.json）rank5 Phase-A v2 已由 wasm-generic-graves-smoke-screen-primary-hit + backend seed 证据闭环——90 mana / 18000ms CD；immediate primary-target scaffold（明确排除而非建模 Wiki cast0.25 与 Effect at cast time end）；恰好一次 non-crit/non-copyable magic damage 260+0.60*source.attr.ap.resolved（交叉校验 AP200 → raw380，target MR100 → mitigated190）。Attempts t0/t17999/t18000 → two successes + exactly one cooldown skip without mana/damage；final mana 145 from 325；HP 1000→620。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction。明确排除 cast0.25/effect-at-cast-end、projectile/location/travel/collision/range/radius/speed/geometry、AOE/multitarget、slow、smoke cloud/field、nearsight/sight、spellshield、ranks1–4、P/E/basic/ammo/True Grit/bonus resistance/on-hit/equipment/loadout、live/publish/E2E/full fidelity；不宣称 cast/projectile/AOE/slow/smoke/nearsight/sight 保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-graves-smoke-screen-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_graves_smoke_screen_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction; Wiki rev3956197/SHA256 20348473… rank5 90 mana/18000ms CD / one magic 260+0.60*AP; AP200→raw380/MR100→190; t0/t17999/t18000 two successes + one CD skip; final mana145/HP620; immediate scaffold excludes Wiki cast0.25 and Effect at cast time end; cast/projectile/location/geometry/AOE/slow/smoke/nearsight/sight/spellshield/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-graves-smoke-screen-primary-hit',
          sourcePath:
            'db/game_manage/seeds/lol_generic_graves_smoke_screen_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction; backend lol_generic_graves_smoke_screen_primary_hit_seed.sql + LolGenericGravesSmokeScreenPrimaryHitSeedSqlTest (owning 1238c53; integrated 037bae3); Wasm exact test commit 78ab90c; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_graves|R|终极爆弹',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Graves R 终极爆弹/Collateral Damage：Wiki rev4007499（SHA256 834843a7722fc9463e21e8d636b8adc644c220928b90f7bb4afedbaa08f85dd1；normalized/generic/graves-r.json）rank3 Phase-A v2 已由 wasm-generic-graves-collateral-damage-primary-hit + backend seed 证据闭环——100 mana / 60000ms CD；immediate primary-target scaffold（明确排除而非建模 Wiki cast delay、recoil dash、projectile line/geometry）；恰好一次 non-crit/non-copyable physical damage 575+1.50*(source.attr.ad.resolved-source.attr.ad.base)（交叉校验 baseAD66 / resolvedAD120 / bonusAD54 → raw656，armor100 → mitigated328）。Attempts t0/t59999/t60000 → two successes + exactly one cooldown skip without mana/damage；final mana 125 from 325；HP 1000→344。completedBoundary：rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage。明确排除 cast delay/effect-at-cast-end、recoil/dash 400、projectile/line travel/collision/range/geometry、multi-target/repeat、explosion cone/reduced damage 440+1.20 bonus AD（仅适用于额外敌人，excluded not denied）、ranks1–2、P/E/W/basic/ammo/True Grit/bonus resistance/on-hit/equipment/loadout、live/publish/E2E/full fidelity；不宣称 cast/recoil/projectile/line/multitarget/explosion-cone/reduced-damage 保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-graves-collateral-damage-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_graves_collateral_damage_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage; Wiki rev4007499/SHA256 834843a7… rank3 100 mana/60000ms CD / one physical 575+1.50*bonusAD; baseAD66/resolvedAD120/bonusAD54→raw656/armor100→328; t0/t59999/t60000 two successes + one CD skip; final mana125/HP344; immediate scaffold excludes Wiki cast delay/recoil/projectile/line; explosion cone reduced 440+1.20 bonus AD excluded not denied; cast/recoil/projectile/line/multitarget/explosion-cone/reduced-damage/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-graves-collateral-damage-primary-hit',
          sourcePath:
            'db/game_manage/seeds/lol_generic_graves_collateral_damage_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage; backend lol_generic_graves_collateral_damage_primary_hit_seed.sql + LolGenericGravesCollateralDamagePrimaryHitSeedSqlTest (owning 9c1087b; integrated c2a8a97); Wasm exact test commit 4abadf1; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_graves|Q|穷途末路',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Graves Q 穷途末路/End of the Line：Wiki request Template:Data Graves/Q → resolved Template:Data Graves/End of the Line；page1307367 / rev4007501 / timestamp 2026-04-11T22:23:57Z / canonical bytes2266 / SHA256 c18840004febd305484392c882680939efe9fc609d4f733f81824439741345c5（normalized/generic/graves-q.json plus pages sibling are authority）rank5 Phase-A v2 已由 wasm-generic-graves-end-of-the-line-first-outbound-pass + backend seed 证据闭环——local raw caveat bytes2265 / SHA cd2744fb1f28e54bd3b5e25b96cb1d21babc0583bfd8e854d55c15ed83df0377（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；80 mana / 6000ms CD；immediate selected-primary-champion first-outbound-pass single physical hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable physical damage operation add(const 150, mul(const 0.65, sub(read source.attr.ad.resolved, read source.attr.ad.base)))（exact binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no Q ability-specific type）（交叉校验 base0/resolved0/armor0 raw=final150；base60/resolved60/armor0 raw=final150；base60/resolved160/armor0 raw=final215；base60/resolved160/armor100 raw215/final107.5；base60/resolved260/armor100 raw280/final140；base0/resolved100 versus base60/resolved160 armor0 both215）。Attempts mana240/baseAD60/resolvedAD160/HP1000/armor100 at t0/t5999/t6000 → success/skip/success，exactly two Q damage items；final mana80/HP785；exactly two automatic Q ability_started；mana79 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Q does not alter E True Grit and E produces no Q damage。Graves Q provider is standalone；Backend has no repository-owned hero_graves / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Graves P/E/W/R/True Grit/basic dependence；不暗示 Batch-B 或 sibling Graves synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Main focused50/full943 passed。Wasm main validation passed gofmt/focused7/full/bench/build/smoke/benchmark；exact test bytes66870 / SHA256 a95e0d9632b0fe45aaec9440ccd89c381d6903f2c99ab761581736ec1f8c8e77；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity。明确排除 cast/direction/range/width/line/projectile/pass-through/multitarget/trail/terrain/collision、delayed/terrain detonation、perpendicular/reverse wave/second pass/total、once-per-pass/spellshield/Wind Wall/Braum terrain、other ranks/siblings/loadout/bootstrap/crit/onhit/live/full fidelity；this is exactly one selected-primary first-outbound-pass physical hit, not full Q；不宣称 cast/direction/range/line/projectile/pass-through/multitarget/trail/terrain/detonation/reverse-wave/second-pass/total/once-per-pass/spellshield/Wind-Wall/Braum/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_graves/ad/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-graves-end-of-the-line-first-outbound-pass',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_graves_end_of_the_line_first_outbound_pass_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity; Wiki request Template:Data Graves/Q → End of the Line; rev4007501/SHA256 c1884000… / bytes2266; local raw caveat bytes2265/SHA cd2744fb… no equivalence claim; rank5 80 mana/6000ms CD / one physical 150+0.65*bonusAD via exact binary add(const150, mul(0.65, sub(ad.resolved,ad.base))); base0/resolved0/armor0=150; base60/resolved60/armor0=150; base60/resolved160/armor0=215; base60/resolved160/armor100 raw215/final107.5; base60/resolved260/armor100 raw280/final140; base0/resolved100 vs base60/resolved160 armor0 both215; damage 20220/add 20170; no 20230; no explicit event op; no Q type; mana240/baseAD60/resolvedAD160/HP1000/armor100 t0/t5999/t6000 success/skip/success two Q damage items final mana80/HP785 two automatic Q ability_started; mana79 resource skip unchanged; Q does not alter E True Grit and E produces no Q damage; standalone no sibling synthesis; Wasm exact test commit c16107e bytes66870/SHA a95e0d96…; cast/direction/range/line/projectile/pass-through/multitarget/trail/terrain/detonation/reverse-wave/second-pass/total/once-per-pass/spellshield/Wind-Wall/Braum/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-graves-end-of-the-line-first-outbound-pass',
          sourcePath:
            'db/game_manage/seeds/lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity; backend lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql + LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest (owning 9294292; integrated a54cf6f); Wasm exact test commit c16107e; external existing-data/check-only prerequisites (hero_graves/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Graves synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_senna|W|无尽厮守',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Senna W 无尽厮守/Last Embrace：Wiki request Template:Data Senna/W → resolved Template:Data Senna/Last Embrace；page1409576 / rev4009139 / timestamp 2026-04-15T21:34:10Z / canonical bytes1656 / SHA256 48698aa2864b79564b1ea0ed624de8fc7123c3127c1e56deaa002d1aad3c8492（normalized/generic/senna-w.json plus pages sibling are authority）rank5 Phase-A v2 已由 wasm-generic-senna-last-embrace-first-enemy-hit + backend seed 证据闭环——local raw caveat bytes1651 / SHA 737cc69b6ea13da8d61437e3da37a799cc2779bd56516d166af5890dc6090d5e（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；70 mana / 11000ms CD；immediate selected-primary-champion first-enemy single physical hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable physical damage operation add(const 230, mul(const 0.90, sub(read source.attr.ad.resolved, read source.attr.ad.base)))（exact binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no W ability-specific type）（交叉校验 base0/resolved0/armor0 raw=final230；base60/resolved60/armor0 raw=final230；base60/resolved160/armor0 raw=final320；base60/resolved160/armor100 raw320/final160；base60/resolved260/armor100 raw410/final205；base0/resolved100 versus base60/resolved160 armor0 both320）。Attempts mana210/baseAD60/resolvedAD160/HP1000/armor100 at t0/t10999/t11000 → success/skip/success，exactly two W damage items；final mana70/HP680；exactly two automatic W ability_started；mana69 at t0 → resource skip with mana/HP unchanged and no W damage/event。Senna W provider is standalone；Backend has no repository-owned hero_senna / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Senna P/Q/E/R/basic dependence；不暗示 Batch-B 或 sibling Senna synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Main focused68/full954 passed。Wasm main validation passed gofmt/focused/full/bench/build/smoke/benchmark；exact test bytes62703 / SHA256 4a449fc09248fe7842b909a373edd5353d4fb1eed8831b655f9146bcd5696051；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_other_ranks_or_full_fidelity。明确排除 cast/effect-at-cast-time-end/direction/range/width/line/projectile/collision/acquisition、attachment/death spread/delayed root/root duration/surrounding AOE、untargetable/spellshield、other ranks/siblings/loadout/bootstrap/crit/onhit/live/full fidelity；this is exactly one selected-primary first-enemy physical hit, not full W；不宣称 cast/effect-at-cast-time-end/direction/range/line/projectile/collision/acquisition/attachment/death-spread/delayed-root/surrounding-AOE/untargetable/spellshield/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_senna/ad/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-senna-last-embrace-first-enemy-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_senna_last_embrace_first_enemy_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_other_ranks_or_full_fidelity; Wiki request Template:Data Senna/W → Last Embrace; rev4009139/SHA256 48698aa2… / bytes1656; local raw caveat bytes1651/SHA 737cc69b… no equivalence claim; rank5 70 mana/11000ms CD / one physical 230+0.90*bonusAD via exact binary add(const230, mul(0.90, sub(ad.resolved,ad.base))); base0/resolved0/armor0=230; base60/resolved60/armor0=230; base60/resolved160/armor0=320; base60/resolved160/armor100 raw320/final160; base60/resolved260/armor100 raw410/final205; base0/resolved100 vs base60/resolved160 armor0 both320; damage 20220/add 20170; no 20230; no explicit event op; no W type; mana210/baseAD60/resolvedAD160/HP1000/armor100 t0/t10999/t11000 success/skip/success two W damage items final mana70/HP680 two automatic W ability_started; mana69 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit ebf7730 bytes62703/SHA 4a449fc0…; cast/effect-at-cast-time-end/direction/range/line/projectile/collision/acquisition/attachment/death-spread/delayed-root/surrounding-AOE/untargetable/spellshield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-senna-last-embrace-first-enemy-hit',
          sourcePath:
            'db/game_manage/seeds/lol_generic_senna_last_embrace_first_enemy_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_other_ranks_or_full_fidelity; backend lol_generic_senna_last_embrace_first_enemy_hit_seed.sql + LolGenericSennaLastEmbraceFirstEnemyHitSeedSqlTest (owning c0c3090; integrated b90607b); Wasm exact test commit ebf7730; external existing-data/check-only prerequisites (hero_senna/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Senna synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_senna|R|暗影燎原',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Senna R 暗影燎原/Dawning Shadow：Wiki request Template:Data Senna/R → resolved Template:Data Senna/Dawning Shadow；page1409580 / rev4008033 / timestamp 2026-04-13T04:08:13Z / canonical bytes2356 / SHA256 4de188cce3d04f172d37f07db4e7c8e240388c5346f56838c82a3e6205c9de36（normalized/generic/senna-r.json plus pages sibling are authority）rank3 Phase-A v3 已由 wasm-generic-senna-dawning-shadow-primary-hit + backend seed 证据闭环——local raw caveat bytes2353 / SHA 1b448ff48b9fe906a13056f2f510e38ff96fcad410462972a93dbd3bb93195dc（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；100 mana / 100000ms CD；immediate selected-primary-enemy-champion single physical hit scaffold；one immediate selected-primary-enemy-champion single noncritical/noncopyable physical damage operation add(add(const 550, mul(const 1.15, sub(read source.attr.ad.resolved, read source.attr.ad.base))), mul(const 0.70, read source.attr.ap.resolved))（exact nested binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no R ability-specific type）（交叉校验 base60/resolved60/AP0/armor0 raw=final550；base60/resolved160/AP0/armor0 raw=final665；base60/resolved60/AP100/armor0 raw=final620；base60/resolved160/AP100/armor0 raw=final735；base60/resolved140/AP100/armor100 raw712/final356；base60/resolved220/AP100/armor100 raw804/final402；base0/resolved100 versus base60/resolved160 AP0/armor0 both665）。Attempts mana300/baseAD60/resolvedAD140/AP100/HP1000/armor100 at t0/t99999/t100000 → success/skip/success，exactly two R damage items；final mana100/HP288；exactly two automatic R ability_started；mana99 at t0 → resource skip with mana/HP unchanged and no R damage/event。Senna R provider is standalone；preserve existing W Last Embrace without requiring/mutating/copying/synthesizing W；check-only standalone W isolation；Backend has no repository-owned hero_senna / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Senna P/Q/W/E/basic dependence；不暗示 Batch-B 或 sibling Senna synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Main focused71/full987 passed。Wasm main validation passed gofmt/focused/full/bench/build/smoke/benchmark；exact test bytes73643 / SHA256 a42359e98452dfd3d1429fc12f8735daefd77b0da2269ba7b345200b9ff39fa9；built and independent Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity。明确排除 cast time/Effect at cast time start/queue time、global/direction/broad or narrow wave geometry/width、projectile travel/speed/destruction AOE/multitarget、enemy reveal/self reveal/allied or self shield、Mist scaling/Mist Wraith hits/path sight/spellshield、other ranks、siblings/loadout/bootstrap/crit/on-hit/live/full fidelity；this is exactly one selected-primary-enemy-champion single physical hit, not full R；不宣称 cast/Effect-at-cast-time-start/queue/global/direction/wave/projectile/AOE/reveal/shield/Mist/Wraith/sight/spellshield/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_senna/ad/ap/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-senna-dawning-shadow-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_senna_dawning_shadow_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity; Wiki request Template:Data Senna/R → Dawning Shadow; rev4008033/SHA256 4de188cc… / bytes2356; local raw caveat bytes2353/SHA 1b448ff4… no equivalence claim; rank3 100 mana/100000ms CD / one physical 550+1.15*bonusAD+0.70*AP via nested binary add(add(550,1.15*(ad.resolved-ad.base)),0.70*ap.resolved); base60/resolved60/AP0/armor0=550; base60/resolved160/AP0/armor0=665; base60/resolved60/AP100/armor0=620; base60/resolved160/AP100/armor0=735; base60/resolved140/AP100/armor100 raw712/final356; base60/resolved220/AP100/armor100 raw804/final402; base0/resolved100 vs base60/resolved160 AP0/armor0 both665; damage 20220/add 20170; no 20230; no explicit event op; no R type; mana300/baseAD60/resolvedAD140/AP100/HP1000/armor100 t0/t99999/t100000 success/skip/success two R damage items final mana100/HP288 two automatic R ability_started; mana99 resource skip unchanged; standalone preserve existing W / check-only W isolation / no sibling synthesis; Wasm exact test commit a8e4c08 bytes73643/SHA a42359e9…; cast/Effect-at-cast-time-start/queue/global/direction/wave/projectile/AOE/reveal/shield/Mist/Wraith/sight/spellshield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-senna-dawning-shadow-primary-hit',
          sourcePath:
            'db/game_manage/seeds/lol_generic_senna_dawning_shadow_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity; backend lol_generic_senna_dawning_shadow_primary_hit_seed.sql + LolGenericSennaDawningShadowPrimaryHitSeedSqlTest (owning b774a8d; integrated 4316923); Wasm exact test commit a8e4c08; external existing-data/check-only prerequisites (hero_senna/ad/ap/mana; does not write identity/panel/resource values); standalone preserve existing W / check-only W isolation / no Batch-B or sibling Senna synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_twitch|P|死亡毒液',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Twitch P Deadly Venom：Wiki rev4013286（SHA256 1567c0efec7f9e9021f6dc02410f92262dfa30128acc457c531199dbc9121b44）已给出 max6/6000ms、每 AA 一层、每秒真实伤害 tick、五档等级带、每层 +3% AP；当前 1v1 伤害核合同数据完整。generic anchored provider-tick ABI/runtime（commit 8612d0d）+ Backend lifecycle/seed（commit 92e100e）+ Web TickSpec 投影（commit 5a0931a）+ 精确 CompileGeneric/RunGeneric Twitch 测试（commit 7cb8b1d）已闭环，故标 completed/full/generic_runtime。Batch-B legacy DPS seed 仅作 regression 证据，非 implementation layer。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-twitch-deadly-venom',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_twitch_deadly_venom_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: exact CompileGeneric+RunGeneric Deadly Venom (commit 7cb8b1d) on anchored provider-tick ABI (commit 8612d0d); not live published',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-anchored-provider-tick',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_anchored_tick_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: generic anchored provider-tick ABI/runtime (commit 8612d0d); write-triggered generation / cap-refresh / inclusive final tick',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-twitch-deadly-venom',
          sourcePath: 'db/game_manage/seeds/lol_generic_twitch_deadly_venom_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: Backend lifecycle/seed + LolGenericTwitchDeadlyVenomSeedSqlTest (commit 92e100e); not live published',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-twitch-deadly-venom',
          sourcePath: 'web/src/engine/combatDataAssembler.ts',
          sourceWorktree: 'web',
          note: 'completedBoundary: Web lifecycle type-id → TickSpec anchor pair projection (commit 5a0931a); fail-closed validation',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-twitch-deadly-venom',
          sourcePath: 'web/src/engine/combatDataAssembler.test.ts',
          sourceWorktree: 'web',
          note: 'completedBoundary: Web anchored tick lifecycle projection tests (commit 5a0931a)',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_varus|W|枯萎箭袋',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Varus W Blighted Quiver / 枯萎箭袋：Wiki rev4026472（SHA256 16307174c4039d8ce71e639396328b2473f4a7e16247a7b2f8a183599b0901d2；normalized/generic/varus-w.json）rank5 Phase-A v2 已由 wasm-generic-varus-blighted-quiver + backend seed 证据闭环——被动 on-hit magic 40+0.15*bonusAD+0.25*AP 后 target blight_stacks+=1（max3/6000ms refresh_on_write）；W active 武装 blighted_quiver_active max1/5500ms；W-scoped Q max-charge ordering carrier（scaffold only）顺序：Q physical → W active missing-HP（post-Q/pre-Blight）→ Blight detonation×1.5 → conditional blight/active reset。completedBoundary：fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop。明确排除 ranks1–4、可变 Q 充能、真实 Q mana/CD/channel/projectile/多目标、W CD/recast、blight CDR refund、equipment/Guinsoo interop、monster caps、live migration/publish/E2E；不宣称真实 Q key 完成或完整游戏保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-varus-blighted-quiver',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_varus_blighted_quiver_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop; exact CompileGeneric+RunGeneric (commit d6f2ea5); not claiming real Q key completion/full-game fidelity',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-varus-blighted-quiver',
          sourcePath: 'db/game_manage/seeds/lol_generic_varus_blighted_quiver_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop; backend seed (owning ca8809d; integrated 5b2a18e); not live published',
        },
      ],
    },
  ],
  [
    'item_passive|3071|item_passive|热烈',
    {
      status: 'out_of_scope',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason: '3071 热烈/Fervor 仅为造成物理伤害后获得 20 移速持续 2 秒，无伤害分支；审计边界外。',
      blocker: '',
    },
  ],
  [
    'item_passive|2501|item_passive|专横',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        '专横/Tyranny 当前 generic ABI：source-only 动态 bonus AD = 2.5% bonus health；TestGenericWikiReadyItems* 覆盖 bonus HP 0/400/1000→bonus AD 0/10/25；wasm generic_wiki_ready_items_test.go（CompileGeneric+RunGeneric）+ backend lol_generic_wiki_ready_items_seed.sql 幂等 seed/mount；不声称 live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-wiki-ready-items',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_wiki_ready_items_test.go',
          sourceWorktree: 'wasm',
          note: 'Tyranny bonus HP 0/400/1000 → bonus AD 0/10/25 via CompileGeneric+RunGeneric; commit 25a2a3b; not live published',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-wiki-ready-items',
          sourcePath: 'db/game_manage/seeds/lol_generic_wiki_ready_items_seed.sql',
          sourceWorktree: 'backend',
          note: 'idempotent seed/mount + LolGenericWikiReadyItemsSeedSqlTest; commit 27f3490; not live published',
        },
      ],
    },
  ],
  [
    'item_passive|2501|item_passive|报复',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        '报复/Retribution 当前 generic ABI：同一 item_2501 provider 上第二枚 source AD attribute modifier（ValuePolicy=multiply Priority=100；专横仍为 add Priority=0）；factor=1+clamp((max(0,hp.max-hp.current)/max(1,hp.max)),0,0.70)*(0.12/0.70)；乘在已解析 AD（含专横）之上，公式不读 ad.resolved；TestGenericWikiReadyItemsRetribution* 覆盖 full/50%/70%/90%cap + 同跑 HP 变更重解析；数值真源 数据参考/lol-wiki-current-items/manifest.json@revid4030984 contentSha256:e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d（pass2）；wasm generic_wiki_ready_items_test.go + backend lol_generic_wiki_ready_items_seed.sql；不声称 live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-wiki-ready-items',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_wiki_ready_items_test.go',
          sourceWorktree: 'wasm',
          note: 'Retribution: multiply factor on AD after Tyranny; missing HP 0/50%/70%/90%cap + same-run HP re-resolve; Wiki revid4030984 sha e7818eff…; not live published',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-wiki-ready-items',
          sourcePath: 'db/game_manage/seeds/lol_generic_wiki_ready_items_seed.sql',
          sourceWorktree: 'backend',
          note: 'idempotent item_2501 provider seed/mount path (wiki-ready items); LolGenericWikiReadyItemsSeedSqlTest; not live published',
        },
      ],
    },
  ],
  [
    'item_passive|3097|item_passive|弩箭',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        '弩箭/Bolt 当前 generic ABI（仅预充能口径）：初始 charge=100；首次真实普攻造成 100 额外魔法伤害并消费；第二次不 proc；phantom/copied-on-hit 不额外触发；移速分支与 3097 盈能充能速率不在本口径；wasm generic_wiki_ready_items_test.go + backend lol_generic_wiki_ready_items_seed.sql；不声称 live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-wiki-ready-items',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_wiki_ready_items_test.go',
          sourceWorktree: 'wasm',
          note: 'Bolt initial charge100, first 100 magic + consume, second no proc, phantom no extra; commit 25a2a3b; not live published',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-wiki-ready-items',
          sourcePath: 'db/game_manage/seeds/lol_generic_wiki_ready_items_seed.sql',
          sourceWorktree: 'backend',
          note: 'idempotent seed/mount + LolGenericWikiReadyItemsSeedSqlTest; commit 27f3490; not live published',
        },
      ],
    },
  ],
  [
    'item_passive|3097|item_passive|盈能',
    {
      status: 'blocked_data',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        '3097 Energized/盈能：本地 Wiki 仅写移动与普攻生成充能至 100，缺精确移动/普攻充能速率；与 Bolt 预充能伤害口径分开，继续 blocked_data。',
      blocker: 'missing_precise_energize_move_and_attack_charge_rates_in_local_wiki',
      dataGapEvidence: {
        sourceVersion: 'lol-wiki-item-rev-4030984',
        sourceRef:
          '数据参考/lol-wiki-current-items/manifest.json@revid4030984;数据参考/lol-wiki-current-items/current-items.normalized.json#item_3097/effects.pass',
        availableEffectTables: {},
        availableCooldowns: [],
        availableCosts: {},
        tooltipPlaceholders: [],
        unresolvedDamagePlaceholders: [],
        varsMapEmpty: true,
        variablesEmpty: true,
        variables: [],
        missingFields: ['move_charge_rate', 'attack_charge_rate'],
        gapKind: 'status_charge_rate',
        reasonZh:
          '3097 Energized/盈能：本地 Wiki 仅写移动与普攻生成充能至 100，缺精确移动/普攻充能速率；与 Bolt 预充能伤害口径分开，继续 blocked_data。',
        blocker: 'missing_precise_energize_move_and_attack_charge_rates_in_local_wiki',
      },
    },
  ],
  [
    'item_passive|2520|item_passive|成型炸药',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'item 2520 成型炸药/Shaped Charge：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；仅 ranged 英雄分支——shaped_charge_ready default1/max1/45000ms refresh_on_write 开局即 ready；listener All{event/damage_instance,damage_trait/ability,event/source_owner} None{ability/basic_attack,damage_trait/on_hit,damage_trait/item,damage_trait/dot}；首次合格技能伤害实例先造成 child damage/true（15+0.75*source.attr.armor_pen_flat.resolved，基线22→31.5，CopyableOnHit=false，无 ability/item/on_hit/dot traits）再 override ready→0；同施法多段仅首段触发；真伤无视抗性但护盾按当前 pipeline 吸收；lazy expiry t>=45000 恢复 ready；不含 melee/史诗野怪/破坏(Sabotage)/宠物/DoT 纳入/Web UI；已由 generic_shaped_charge_2520_test.go + 计划 backend lol_generic_shaped_charge_2520_seed.sql / LolGenericShapedCharge2520SeedSqlTest.java 闭环；不声称 live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-shaped-charge-2520',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_shaped_charge_2520_test.go',
          sourceWorktree: 'wasm',
          note: 'Shaped Charge ranged ability-damage true arm/consume + matcher/CD/shield; not live published',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-shaped-charge-2520',
          sourcePath: 'db/game_manage/seeds/lol_generic_shaped_charge_2520_seed.sql',
          sourceWorktree: 'backend',
          note: 'planned backend seed path + LolGenericShapedCharge2520SeedSqlTest.java; not claiming live migrate/publish',
        },
      ],
    },
  ],
  [
    'item_passive|3004|item_passive|法力流',
    {
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        '法力流现行合同数值已齐：每8秒至多4层；普攻或技能命中消耗一层并+3最大法力（对英雄+6），上限360后转变魔切。非数据缺口；缺 periodic_charge_tick / attack_or_ability_hit_resource_gain / state_driven_max_mana_and_transform runtime。',
      blocker:
        'missing_periodic_charge_tick_and_ability_hit_resource_gain_and_mana_transform_runtime',
    },
  ],
  [
    'item_passive|3073|item_passive|过载',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'item 3073 过载/Overdrive：League Wiki Module:ItemData/data revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d（current-items.normalized.json#item_3073_Overdrive）；classic/ranged 伤害分支——ad=40 / attack_speed=0.20 / hp=450；终极施放武装 +0.50 bonus AS for [0,8000ms)，30000ms CD starts on cast。已由 generic_experimental_hexplate_3073_test.go + backend lol_generic_experimental_hexplate_3073_seed.sql / LolGenericExperimentalHexplate3073SeedSqlTest 双边闭环。明确排除 +20% movement speed、Hexcharged 30 ultimate haste、melee 35%/14%、Arena、non-champion/multi-target，故标 completed/full；不声称 live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-min-validation-coverage-audit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_experimental_hexplate_3073_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: classic/ranged Overdrive ultimate arm / +0.50 AS [0,8000ms) / 30000ms CD on cast / non-ultimate reject; excluded MS / Hexcharged haste / melee / Arena / non-champion-multitarget',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-min-validation-coverage-audit',
          sourcePath: 'db/game_manage/seeds/lol_generic_experimental_hexplate_3073_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: Overdrive seeded + LolGenericExperimentalHexplate3073SeedSqlTest; excluded MS / Hexcharged haste / melee / Arena / non-champion-multitarget; not claiming live migrate/publish',
        },
      ],
    },
  ],
  [
    'item_passive|6610|item_passive|光盾打击',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'item 6610 光盾打击/Lightshield Strike：League Wiki Module:ItemData/data revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d（current-items.normalized.json#item_6610_Lightshield_Strike）；classic 伤害分支——对英雄下一次普攻必定暴击、绝对总暴击伤害 1.60、provider_target cooldown 10000ms。已由 generic_sundered_sky_6610_test.go + backend lol_generic_sundered_sky_6610_seed.sql / LolGenericSunderedSky6610SeedSqlTest 双边闭环。明确排除治疗/overheal、Infinity Edge 或其他暴击伤害组合、Arena、non-champion、live publish/migration、多目标持久状态，故标 completed/full；不声称 live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-min-validation-coverage-audit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_sundered_sky_6610_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: classic Lightshield Strike champion next BA guaranteed crit / absolute total crit damage 1.60 / provider_target CD 10000ms / first-hit CD / p=0|0.25|1 natural+forced; excluded healing/overheal / IE or other crit-damage combos / Arena / non-champion / multi-target persistent state',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-min-validation-coverage-audit',
          sourcePath: 'db/game_manage/seeds/lol_generic_sundered_sky_6610_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: Lightshield Strike seeded + LolGenericSunderedSky6610SeedSqlTest; excluded healing/overheal / IE or other crit-damage combos / Arena / non-champion / multi-target persistent state; not claiming live migrate/publish',
        },
      ],
    },
  ],
  [
    'item_passive|3161|item_passive|专注意志',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'item 3161 专注意志/Focused Will：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；Wiki-only 合同——ability|pet 伤害（champion|pet cast origin）叠层，perCastThrottleMs=1000（每施法实例每秒至多 1 层），focused_will_stacks max4 / 聚合 refresh_on_write 6000ms，每层 +3%（1+0.03*stacks）ability|pet|proc 出站增伤；Phase-A 排除 item/basic_attack/innate 叠层与增伤路径；pipeline 先于 listener，触发伤害用 old-stack 层数。已由 generic_focused_will_3161_test.go + backend lol_generic_focused_will_3161_seed.sql / GenericCastOriginPerCastThrottleDbContractSqlTest + LolGenericFocusedWill3161SeedSqlTest 双边闭环；Web types + combatDataAssembler 精确投影 optional castOrigin/perCastThrottleMs；不声称 UI/live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-focused-will-3161',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_focused_will_3161_test.go',
          sourceWorktree: 'wasm',
          note: 'Focused Will ability|pet grant + perCastThrottle 1000ms + max4/6000ms + 3% amp + exclusions + old-stack ordering; not live published',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-focused-will-3161',
          sourcePath: 'db/game_manage/seeds/lol_generic_focused_will_3161_seed.sql',
          sourceWorktree: 'backend',
          note: 'backend seed + GenericCastOriginPerCastThrottleDbContractSqlTest + LolGenericFocusedWill3161SeedSqlTest; Web combatDataAssembler/types optional castOrigin/perCastThrottleMs projection; not claiming UI/live migrate/publish',
        },
      ],
    },
  ],
  [
    'item_passive|3179|item_passive|夜行者',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'item 3179 夜行者/Nightstalker：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d（current-items.raw.lua 8550-8584）；用户批准 Phase-A 1v1 口径——nightstalker_ready default1/max1 untimed 开局即 ready；首次 basic_attack_hit+source_owner 触发一次真实伤害 50+1.5*armor_pen_flat.resolved（Wiki lethality 18→77）；随后 ready→0；无 re-arm；CopyableOnHit=false/无递归 phantom；真伤无视抗性但护盾按当前 pipeline 吸收。明确排除视野/隐身/unseen≥1s、4s 强化窗、re-arm、封锁/Blackout、多目标与 live publish，故标 completed/full。已由 generic_nightstalker_3179_test.go + backend lol_generic_nightstalker_3179_seed.sql / LolGenericNightstalker3179SeedSqlTest 双边闭环；不声称 live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-nightstalker-3179',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_nightstalker_3179_test.go',
          sourceWorktree: 'wasm',
          note: 'Nightstalker Phase-A start-ready / first BA true 50+1.5*armor_pen_flat / consume / no re-arm / phantom non-copyable; not live published',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-nightstalker-3179',
          sourcePath: 'db/game_manage/seeds/lol_generic_nightstalker_3179_seed.sql',
          sourceWorktree: 'backend',
          note: 'backend seed + LolGenericNightstalker3179SeedSqlTest; not claiming live migrate/publish',
        },
      ],
    },
  ],
  [
    'item_passive|6699|item_passive|苍穹',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'item 6699 苍穹/Firmament：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；仅 ranged/precharged 口径——energized_charge 显式预充 100；下一次真实主目标普攻先武装 firmament_lethality_active=1（4000ms refresh_on_write）向 canonical armor_pen_flat 加 12（与基线 10 合成 penetrationFlat=22），再按 event.target 当前生命 7% 造成额外物理伤害（非 entry_target），后消费 charge→0；copyable_on_hit=false/phantom 零伤害零二次消费；不含自然充能/Galvanize/melee/非英雄上限/Web UI；已由 generic_firmament_6699_test.go + 计划 backend lol_generic_firmament_6699_seed.sql / LolGenericFirmament6699SeedSqlTest.java 闭环；不声称 live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-firmament-6699',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_firmament_6699_test.go',
          sourceWorktree: 'wasm',
          note: 'Firmament ranged precharged arm/damage/consume + phantom non-copyable; not live published',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-firmament-6699',
          sourcePath: 'db/game_manage/seeds/lol_generic_firmament_6699_seed.sql',
          sourceWorktree: 'backend',
          note: 'planned backend seed path + LolGenericFirmament6699SeedSqlTest.java; not claiming live migrate/publish',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_kalista|P|武术姿态',
    {
      status: 'out_of_scope',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Kalista P Martial Poise：Wiki rev4024157 纯位移/冲刺语义，无主目标伤害增量；单目标 DPS 审计边界外。',
      blocker: '',
      outOfScopeEvidence: {
        sourceRef:
          '数据参考/lol-wiki-current-champions/normalized/generic/kalista-p.json@rev4024157',
        sourceTextSummary:
          '如果卡莉丝塔在进行普攻或穿刺的同时被下达了移动指令，那么她会在发起进攻的同时朝着这个移动指令的方向位移小段距离。',
        reviewedPrimaryTargetDamageBranch: true,
        boundaryCategory: 'pure_movement_or_dash',
        excludedBehavior: 'movement_speed_or_dash',
        boundaryReason: '武术姿态：纯移速/冲刺/位移，无主目标伤害增量；审计边界外。',
        damageRelevantSubBranchDisposition: 'no_primary_target_damage_branch',
      },
    },
  ],
  [
    'hero_skill|hero_kindred|P|千珏之印',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'hero_kindred P 千珏之印/Mark of the Kindred：Wiki rev3994253（SHA256 9ac60eae427fac9ba279734dba2c01b34852eb0be84a01d95296328794afc14a）+ 用户批准 fixed 25-mark Phase-A 口径已由 wasm-generic-kindred-mark-of-kindred-max-marks + backend seed 闭环——无 kindred_marks 状态键；常驻 attack_range +250（500→750，共享 AA/E 距离语义）；Q 探针总 bonus AS 1.60×4000ms；W rank5 冠军探针 45+0.265*currentHP；E rank5 探针 200+0.175*missingHP（排除 crit/完整第三击）。明确排除狩猎/击杀/takedown、中间叠层、野怪/地图视野；Q/W/E inventory 机制不因探针升级为 completed，故标 completed/full。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kindred-mark-of-kindred-max-marks',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_kindred_mark_of_kindred_max_marks_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: fixed 25-mark Phase-A (+250 range / Q AS 1.60×4000ms / W·E baked coeffs); excluded hunting/takedown/stacks/monsters/vision; Q/W/E inventory NOT completed',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kindred-mark-of-kindred-max-marks',
          sourcePath: 'db/game_manage/seeds/lol_generic_kindred_mark_of_kindred_max_marks_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: Kindred P fixed 25-mark Phase-A seeded; LolGenericKindredMarkOfKindredMaxMarksSeedSqlTest; not live publish; Q/W/E inventory unchanged',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_teemo|P|游击队军备',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Teemo P Guerrilla Warfare：Wiki rev4010103 已给出 Element of Surprise 20–80% bonus AS / 5s；采用 fixed-enabled AS 假设分支——离隐触发 AS 计入 DPS，stealth/brush/movement 事件分支 out of assumed scope。',
      blocker: '',
    },
  ],
  [
    'hero_skill|hero_teemo|Q|致盲吹箭',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Teemo Q 致盲吹箭/Blinding Dart：Wiki rev3948425（SHA256 4e3c475ed55ec865f6a9060c8ad0b2665e5379b3ae7e9e5cb644f83212b240a7；normalized/generic/teemo-q.json）rank5 Phase-A v1 已由 wasm-generic-teemo-blinding-dart + backend seed 证据闭环——90 mana / 7000ms CD；immediate primary-target scaffold；恰好一次 non-crit/non-copyable magic damage 260+0.70*source.attr.ap.resolved（交叉校验 AP200 → raw400，target MR100 → mitigated200）。Attempts t0/t6999/t7000 → two successes + exactly one cooldown skip without mana/damage；final mana 154 from 334。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry。明确排除 blind/control 与 2–3s duration、cast time 0.25s、projectile/speed2500/range/geometry/collision/selection、ranks1–4、on-hit/equipment/Toxic Shot/basic-attack coupling/rotation、multi-target、live migration/publish/E2E；不宣称 blind/cast/projectile/geometry/multitarget/完整游戏保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-teemo-blinding-dart',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_teemo_blinding_dart_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry; Wiki rev3948425/SHA256 4e3c475e… rank5 90 mana/7000ms CD / one magic 260+0.70*AP; AP200→raw400/MR100→200; t0/t6999/t7000 two successes + one CD skip; final mana154; blind/cast/projectile/geometry/multitarget/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-teemo-blinding-dart',
          sourcePath: 'db/game_manage/seeds/lol_generic_teemo_blinding_dart_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry; backend lol_generic_teemo_blinding_dart_seed.sql + LolGenericTeemoBlindingDartSeedSqlTest (owning 1803c8c; integrated 7e27f33); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_vayne|E|恶魔审判',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Vayne E 恶魔审判/Condemn：Wiki rev4008541（SHA256 f2b2ba17b90ff5096a9a154f8d1fd4cc43ed3e1be4ebb502cb644acf17712c37；normalized/generic/vayne-e.json）rank5 Phase-A v1 已由 wasm-generic-vayne-condemn-primary-hit + backend seed 证据闭环——90 mana / 12000ms CD；immediate primary-target scaffold；恰好一次 non-crit/non-copyable physical damage 190+0.50*(source.attr.ad.resolved-source.attr.ad.base)（交叉校验 baseAD60 / resolvedAD140 / bonusAD80 → raw230，armor100 → mitigated115）。Attempts t0/t11999/t12000 → two successes + exactly one cooldown skip without mana/damage；final mana 52 from 232。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile。明确排除 knockback/displacement475/direction、terrain 或玩家生成地形碰撞、wall bonus 285+0.75bAD 与 total 475+1.25bAD、stun/control1.5s、cast0.25/effect-at-cast-end、projectile/missile speeds2200/2000/range550/geometry/cancel、ranks1–4、Silver Bolts/basic/on-hit/equipment/loadout coupling、multi-target/repeat、live migration/publish/E2E；不宣称 wall/terrain/CC/cast/projectile/完整游戏保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-vayne-condemn-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_vayne_condemn_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile; Wiki rev4008541/SHA256 f2b2ba17… rank5 90 mana/12000ms CD / one physical 190+0.50*bonusAD; baseAD60/resolvedAD140/bonusAD80→raw230/armor100→115; t0/t11999/t12000 two successes + one CD skip; final mana52; knockback/terrain/wall/stun/cast/projectile/multitarget/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-vayne-condemn-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_vayne_condemn_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile; backend lol_generic_vayne_condemn_primary_hit_seed.sql + LolGenericVayneCondemnPrimaryHitSeedSqlTest (owning e7d28f6; integrated 61290cb); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_vayne|R|终极时刻',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Vayne R 终极时刻/Final Hour：Wiki request Template:Data Vayne/R → resolved Template:Data Vayne/Final Hour；page1309991 / rev3807995 / timestamp 2024-11-05T22:07:10Z / canonical bytes2015 / SHA256 e417f1cfc5e8253fdfe8140c4659e8fe63441c38ca3aa1e37d69aa31e25d682d（normalized/generic/vayne-r.json）rank3 Phase-A v2 已由 wasm-generic-vayne-final-hour-timed-bonus-ad + backend seed 证据闭环——local raw caveat bytes2012 / SHA 343d19e30f0edf70359f122abb2c6c8e7d2d16d5e4c6db46416428d72e7c7642（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；80 mana / 70000ms CD；+65 AD for 12000ms via direct provider-scope override state_change，zero listeners/ability-start scaffold；fixture AD60→125→60；armor100 probe raw/mitigated125/62.5 then60/30；R has no damage。Attempts t0/t69999/t70000 → two successes + exactly one cooldown skip without cost/state write；mana300→140；second success re-arms state。completedBoundary：rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement。明确排除 Night Hunter movement speed/direction、Tumble cooldown/cast/dash/reset、invisibility/stealth、takedown/qualification/extension/cap、animations/projectiles、ranks1–2、Vayne P/Q/W/E/basic/Silver Bolts/Condemn、loadout/items/runes、direct R damage/target effects、live migration/publish/E2E/full fidelity；不宣称 Night Hunter/Tumble/stealth/takedown/完整游戏保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-vayne-final-hour-timed-bonus-ad',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_vayne_final_hour_timed_bonus_ad_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement; Wiki request Template:Data Vayne/R → Final Hour; rev3807995/SHA256 e417f1cf… / bytes2015; local raw caveat bytes2012/SHA 343d19e3… no equivalence claim; rank3 80 mana/70000ms CD / +65 AD 12000ms direct provider-scope override state_change zero listeners/ability-start; AD60→125→60; armor100 probe 125/62.5 then60/30; R no damage; t0/t69999/t70000 two successes + one CD skip without cost/state write; mana300→140; second success re-arms; Night Hunter/Tumble/stealth/takedown/animation/ranks1-2/P-Q-W-E/basic/Silver Bolts/Condemn/loadout/items/runes/direct R damage/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-vayne-final-hour-timed-bonus-ad',
          sourcePath: 'db/game_manage/seeds/lol_generic_vayne_final_hour_timed_bonus_ad_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement; backend lol_generic_vayne_final_hour_timed_bonus_ad_seed.sql + LolGenericVayneFinalHourTimedBonusAdSeedSqlTest (owning 4440c3d + stable-key correction 8eb9f2a; integrated 2710647 + correction 18dbff1); Wasm exact test commit 3a35a95; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_twitch|Q|埋伏',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Twitch Q Ambush：Wiki rev3982645 已给出 rank 40–60% bonus AS / 6s；采用 fixed-enabled AS 假设分支——离隐触发 AS 计入 DPS，stealth/movement/kill CD reset 事件分支 out of assumed scope。',
      blocker: '',
    },
  ],
  [
    'hero_skill|hero_varus|P|复仇之欲',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Varus P Living Vengeance：Wiki rev4026465 已给出 kill/takedown AS 与 bonus AD/AP 公式；采用 fixed-enabled AS 假设分支——标准 kill AS 计入 DPS，minion kill/champion takedown 事件分支 out of assumed scope。',
      blocker: '',
    },
  ],
  [
    'item_passive|3302|item_passive|交相',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'item 3302 交相/Juxtaposition：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；Phase-A 首击 Light 假设；provider-scope next_polarity（untimed）+ light_stacks/dark_stacks（default0/max3/5000ms/聚合 refresh_on_write 近似，非独立 per-stack 过期）；Light pp 6@1/7@11/8@14 插值×层数加 armor/MR；Dark 每层 +10% armor_pen_percent/magic_pen_percent（flat add，满层 30%）；与 Shadow 30 magic 同 provider_item_3302_terminus；已由 generic_terminus_juxtaposition_test.go + 计划 backend lol_generic_terminus_juxtaposition_seed.sql / focused Java test 闭环；不声称 live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-terminus-juxtaposition',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_terminus_juxtaposition_test.go',
          sourceWorktree: 'wasm',
          note: 'Juxtaposition polarity/stacks/Light pp/Dark pen + Shadow 30; not live published',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-terminus-juxtaposition',
          sourcePath: 'db/game_manage/seeds/lol_generic_terminus_juxtaposition_seed.sql',
          sourceWorktree: 'backend',
          note: 'planned backend seed path + focused Java test; not claiming live migrate/publish',
        },
      ],
    },
  ],
  [
    'item_passive|6699|item_passive|通电',
    {
      status: 'stale_or_duplicate',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        '6699 通电/Current：旧 Batch N flat-100/25 充能口径与当前 Wiki 源冲突；保留为 stale_or_duplicate，不得与 6699 苍穹/Firmament 当前行并存为 blocked_runtime。',
      blocker: 'stale_batch_n_energized_current_row',
    },
  ],
  [
    'item_passive|3071|item_passive|切割',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        '当前 Carve 合同 6%×5 / 6000ms refresh-expiry 已由 generic_linked_effects_test.go 经 provider_target 结构化状态 + opponent percent_add modifier + root physical damage_dealt 原语闭环；不声称 live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-linked-effects-black-cleaver',
          sourcePath: 'wasm/tinygo_engine_v2/internal/runtime/generic_linked_effects_test.go',
          sourceWorktree: 'wasm',
          note: 'Black Cleaver Carve 6%x5 / 6000ms refresh-expiry via generic compile/run; not live migrated/published',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-linked-effects-black-cleaver',
          sourcePath: 'db/game_manage/seeds/lol_generic_linked_effects_seed.sql',
          sourceWorktree: 'backend',
          note: 'backend seed path referenced as evidence only; not claiming live migrate/publish',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_ashe|Q|射手的专注',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        "Ashe Q Ranger's Focus：当前 League Wiki + 用户批准口径（4 Focus / 6s / rank5 +60% AS / 5箭 130% AD、首轮 6箭 156% AD / 30 mana）与 wasm-generic-ashe-rangers-focus 证据闭环。用户明确排除 attack-timer reset、逐箭飞行、Frost Shot、吸血、建筑物/多目标与完整轮转，故标 completed。",
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ashe-rangers-focus',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_ashe_rangers_focus_test.go',
          sourceWorktree: 'wasm',
          note: "user-approved Ranger's Focus core; excluded attack-timer/arrow-travel/Frost Shot/lifesteal/structures/multitarget/rotation",
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-ashe-rangers-focus',
          sourcePath: 'db/game_manage/seeds/lol_generic_ashe_rangers_focus_seed.sql',
          sourceWorktree: 'backend',
          note: "Ranger's Focus user-approved core seed; excluded branches out of scope",
        },
      ],
    },
  ],
  [
    'hero_skill|hero_draven|Q|旋转飞斧',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Draven Q Spinning Axe：用户批准 1v1 口径（rank5 bonus 60+115% bonus AD / 1400ms 自动接斧 / 独立 overlapping flight / max 2 / 45 mana / 8000ms CD / ready 窗与接斧 refresh / 每次合格命中消费 1 斧）与 wasm-generic-draven-spinning-axe + backend seed 证据闭环。用户明确排除落点/移动/路径模拟与 Draven W CD reset，故标 completed。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-draven-spinning-axe',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_draven_spinning_axe_test.go',
          sourceWorktree: 'wasm',
          note: 'user-approved Spinning Axe 1v1; excluded landing-movement-path / W CD reset',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-draven-spinning-axe',
          sourcePath: 'db/game_manage/seeds/lol_generic_draven_spinning_axe_seed.sql',
          sourceWorktree: 'backend',
          note: 'Spinning Axe user-approved 1v1 seed; excluded branches out of scope',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_kaisa|E|极限超载',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        "Kai'Sa E Supercharge：Wiki rev4038391（SHA256 327dc441e84bf2b320dccbe9099b4e98bf42562529e95facd417fbbc27d99e24）+ 用户批准 Phase-A rank5 1v1 攻速分支与 wasm-generic-kaisa-supercharge + backend seed 证据闭环——30 mana / 10000ms CD；ability_started 充能完成近似；4000ms provider timed state（Wasm fixture `supercharge_as_active` / Backend seed `supercharge_active`；provider-local/data-defined，本证据语义等价，非跨 bundle 字面同键）；+80% AS（base 0.60→1.08）；CD 阻断重复施放。明确排除移动速度/幽灵、attack windup、真实充能/cast 时序、普攻 0.5s CD 返还、进化隐形、其它 rank、rotation/cadence、多目标、live migration/publish/E2E，故标 completed。",
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kaisa-supercharge',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_kaisa_supercharge_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: user-approved Phase-A rank5 1v1 AS branch; Wasm fixture state key supercharge_as_active (4000ms / +80% AS); provider-local/data-defined and semantically equivalent to Backend seed supercharge_active for this evidence (not literal cross-bundle key identity); CompileGeneric+RunGeneric; excluded MS/ghost/windup / real cast timing / on-attack 0.5s CD refund / evolution invis / other ranks/rotation / multitarget / live E2E',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kaisa-supercharge',
          sourcePath: 'db/game_manage/seeds/lol_generic_kaisa_supercharge_seed.sql',
          sourceWorktree: 'backend',
          note: 'Supercharge user-approved Phase-A rank5 1v1 AS branch seed; Backend seed state key supercharge_active (4000ms / +80% AS); provider-local/data-defined and semantically equivalent to Wasm fixture supercharge_as_active for this evidence (not literal cross-bundle key identity); excluded branches out of scope',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_kaisa|W|虚空索敌',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        "Kai'Sa W 虚空索敌/Void Seeker：Wiki rev4034696（SHA256 aa4ba76c6fa345c711651fa56d9b914d4ea8b7eb3ddfae79d7feb25470d7e3d1；normalized/generic/kaisa-w.json）rank5 Phase-A v2 已由 wasm-generic-kaisa-void-seeker-primary-hit + backend seed 证据闭环——75 mana / 14000ms CD；immediate primary-target scaffold（明确排除而非建模 Wiki 0.4s cast 与 Effect at cast time end）；恰好一次 non-crit/non-copyable magic damage 130+1.30*source.attr.ad.resolved+0.45*source.attr.ap.resolved（交叉校验 totalAD100 / AP100 → raw305，target MR100 → mitigated152.5）。Attempts t0/t13999/t14000 → two successes + exactly one cooldown skip without mana/damage；final mana 195 from 345；HP 1000→695。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund。明确排除 cast0.4/effect-at-cast-end、projectile/travel/collision/first-enemy acquisition/location/range3000/width200/speed1750/geometry/spellshield、sight/reveal/true sight4s、applying2 Plasma 与全部 Second Skin/Plasma/Caustic Wounds coupling、item AP100 evolution/applying3 Plasma/champion-hit75% cooldown refund、ranks1–4、equipment/loadout、live/publish/E2E/full fidelity；不宣称 cast/projectile/sight/reveal/Plasma/evolution/refund 保真，故标 completed。",
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kaisa-void-seeker-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_kaisa_void_seeker_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund; Wiki rev4034696/SHA256 aa4ba76c… rank5 75 mana/14000ms CD / one magic 130+1.30*source.attr.ad.resolved+0.45*AP; totalAD100/AP100→raw305/MR100→152.5; t0/t13999/t14000 two successes + one CD skip; final mana195/HP695; immediate scaffold excludes Wiki 0.4s cast and Effect at cast time end; cast/projectile/sight/reveal/Plasma/evolution/refund/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kaisa-void-seeker-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_kaisa_void_seeker_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund; backend lol_generic_kaisa_void_seeker_primary_hit_seed.sql + LolGenericKaisaVoidSeekerPrimaryHitSeedSqlTest (owning 9d9200a; integrated 1dc8d5b); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_draven|W|血性冲刺',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Draven W Blood Rush：rank5 20 mana / 12000ms CD / 3000ms +40% AS 主动攻速核心，以及 event/axe_caught → cooldown_change override 0（W ready）已由 generic CompileGeneric+RunGeneric 闭环（generic_draven_blood_rush_test.go + generic_draven_w_axe_catch_reset_test.go + backend seed）。移动速度与衰减为允许不模拟的非伤害分支。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-draven-blood-rush',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_draven_blood_rush_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5 20 mana/12000ms CD/3000ms +40% AS timed state',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-draven-blood-rush',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_draven_w_axe_catch_reset_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: event/axe_caught → cooldown_change override 0 W-ready',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-draven-blood-rush',
          sourcePath: 'db/game_manage/seeds/lol_generic_draven_blood_rush_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: Blood Rush AS + axe_caught W ready seeded; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_draven|E|开道利斧',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Draven E 开道利斧/Stand Aside：Wiki rev4034694（SHA256 7bb6ebdc19413ef908e78fea01576d1184a66bc62fd6148120845573c1468e8d；normalized/generic/draven-e.json）rank5 Phase-A v2 已由 wasm-generic-draven-stand-aside + backend seed 证据闭环——70 mana / 12000ms CD；immediate primary-target scaffold；恰好一次 non-crit/non-copyable physical damage 215+0.50*(source.attr.ad.resolved-source.attr.ad.base)（交叉校验 base AD 62 / resolved AD 142 / bonus AD 80 → raw 255，armor 100 → mitigated 127.5）。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget。明确排除 Wiki 250ms cast/effect-at-cast-end（canonical AbilityDefinition 无 cast-delay 字段）、ranks1–4、projectile/travel、fan/line geometry、collision、target selection、multi-target/repeat、knock aside/airborne/slow/other CC、equipment/loadout、live migration/publish/E2E；不宣称 cast-delay/CC/geometry/multitarget/完整游戏保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-draven-stand-aside',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_draven_stand_aside_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget; Wiki rev4034694/SHA256 7bb6ebdc… rank5 70 mana/12000ms CD / one physical 215+0.50*bonusAD; cast-delay/CC/geometry/multitarget/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-draven-stand-aside',
          sourcePath: 'db/game_manage/seeds/lol_generic_draven_stand_aside_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget; backend lol_generic_draven_stand_aside_seed.sql + LolGenericDravenStandAsideSeedSqlTest (owning 5f1f2bb; integrated 09dbf07); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_quinn|P|侵扰',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Quinn P 侵扰/Harrier：Wiki request Template:Data Quinn/I → resolved Template:Data Quinn/Harrier；page1308953 / rev4024765 / timestamp 2026-06-03T00:49:03Z / canonical bytes2390 / SHA256 740debfb3b72dd7f926337f7eb4adbe3a65c88caec227ca16e00dff6634f798c（normalized/generic/quinn-p.json）level18 Phase-A v2 pre-marked consume 已由 wasm-generic-quinn-harrier-premarked-consume + backend seed 证据闭环——local raw caveat bytes2390 / SHA 08853c2c25ada7769e25908123dbb56f7b14dc0c1479a8a5842693874849a731（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；预先存在 harrier_vulnerable 目标上 owner basic_attack_hit 时，同既有 W provider 有序：arm heightened_senses_active=1 → 恰好一次 non-crit/non-copyable physical 120+0.40*(source.attr.ad.resolved-source.attr.ad.base)（nested binary add）→ consume mark（Backend selector/self 20110 + scope provider_target 20252 / Wasm source+provider_target）；无 mark 不触发。交叉校验 bonusAD80 → raw152，armor100 → mitigated76；baseline raw120/mitigated60。t0/t3000 两次 AA 仅一次 P bonus，无第二次 W arm。W-before-P 与 P-before-W 同效；不宣称 W AS magnitude 校正。completedBoundary：level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels。明确排除 mark 生成（Q/E/Skystrike/Valor）、duration/reveal/overwrite/cooldown、targeting/AI、monster75、R disable、parry、levels1–17、multitarget/loadout/crit/replication、live migration/publish/E2E/full fidelity；不宣称 mark 生成/duration/Valor/monster/R-disable/parry/完整游戏保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-quinn-harrier-premarked-consume',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_harrier_premarked_consume_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels; Wiki request Template:Data Quinn/I → Harrier; rev4024765/SHA256 740debfb… / bytes2390; local raw caveat bytes2390/SHA 08853c2c… no equivalence claim; level18 preexisting harrier + basic_attack_hit → arm active1 → physical 120+0.40*bonusAD nested binary → consume mark 20110+20252/source+provider_target; bonusAD80→raw152/armor100→76; baseline raw120/60; t0/t3000 two AA only one P bonus no second W arm; W-before-P/P-before-W same; no W AS magnitude claim; shared W provider; Wasm exact test commit 7c84b36; mark production/duration/Valor/monster/R-disable/parry/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-quinn-harrier-premarked-consume',
          sourcePath: 'db/game_manage/seeds/lol_generic_quinn_p_harrier_premarked_consume_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels; backend lol_generic_quinn_p_harrier_premarked_consume_seed.sql + LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest + README (owning 0a6301e; integrated 12d9281); Wasm exact test commit 7c84b36; extends existing W provider only; W rows check-only; nested binary add; 20110+20252; Web source asset exact parity (no Web change/commit); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_quinn|E|旋翔掠杀',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Quinn E 旋翔掠杀/Vault：Wiki request Template:Data Quinn/E → resolved Template:Data Quinn/Vault；page1308957 / rev4024768 / timestamp 2026-06-03T00:51:11Z / canonical bytes2649 / SHA256 9f6baba1d062b473d41586cd8323f31bd7c1c4d865db134a783c19ae998e7714（normalized/generic/quinn-e.json）rank5 Phase-A v1 已由 wasm-generic-quinn-vault-primary-hit + backend seed 证据闭环——local raw caveat bytes2649 / SHA 317ac3ccf31e53ba17255dbb15c856ba5499d9257fbe0c9faa91b43f8438e24b（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；50 mana / 8000ms CD；immediate primary-champion scaffold；恰好一次 non-crit/non-copyable physical damage 140+0.20*(source.attr.ad.resolved-source.attr.ad.base)（nested binary add；冻结伤害公式无 distance multiplier——dash prose 非 distance-based damage modifier；交叉校验 baseAD59 / resolvedAD139 → raw156，armor100 → mitigated78；baseline resolvedAD59 → raw140/mitigated70）。Attempts t0/t7999/t8000 mana150 → two successes + exactly one cooldown skip without mana/damage；final mana 50；mana49 → resource skip/no hit。E 不产生 basic_attack_hit、不武装既有 Quinn W、不改变 AS；runtime 可合成既有 ability_started，不宣称全局零事件。completedBoundary：rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_140_plus_0_20_bonus_ad; no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks。明确排除 dash/tracking/bounce/range/speed/wall/geometry/grounded/knockdown、knockback/airborne/slow/control/facing/windup、Harrier/P/W interaction、basic-attack reset/fuzzy delay/autoattack、failed-too-far、spellshield/callforhelp、ranks1–4、other Quinn skills/basic、loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 dash/tracking/bounce/knockback/slow/Harrier/basic-attack-reset/完整游戏保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-quinn-vault-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_vault_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_140_plus_0_20_bonus_ad; no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks; Wiki request Template:Data Quinn/E → Vault; rev4024768/SHA256 9f6baba1… / bytes2649; local raw caveat bytes2649/SHA 317ac3cc… no equivalence claim; rank5 50 mana/8000ms CD / one physical 140+0.20*bonusAD nested binary add; no distance multiplier; baseAD59/resolvedAD139→raw156/armor100→78; baseline resolvedAD59→raw140/mitigated70; t0/t7999/t8000 mana150 two successes + one CD skip final mana50; mana49 resource skip/no hit; no basic_attack_hit / does not arm Quinn W / no AS change; may synthesize ability_started (not globally zero events); Wasm exact test commit bfe9e5b; dash/tracking/bounce/knockback/slow/Harrier/basic-attack-reset/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-quinn-vault-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_quinn_vault_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_140_plus_0_20_bonus_ad; no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks; backend lol_generic_quinn_vault_primary_hit_seed.sql + LolGenericQuinnVaultPrimaryHitSeedSqlTest + README (owning c487eb4; integrated 3f698ab); Wasm exact test commit bfe9e5b; nested binary add; Web source asset exact parity (no Web change/commit); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_quinn|Q|炫目攻势',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Quinn Q 炫目攻势/Blinding Assault：Wiki request Template:Data Quinn/Q → resolved Template:Data Quinn/Blinding Assault；page1308954 / rev4024766 / timestamp 2026-06-03T00:49:42Z / canonical bytes1742 / SHA256 abce6abdc2eefd069beba2d4297a1c9da5b1a675a426edb747346d9679d8085d（normalized/generic/quinn-q.json）rank5 Phase-A v1 已由 wasm-generic-quinn-blinding-assault-primary-hit + backend seed 证据闭环——local raw caveat bytes1742 / SHA be8878560c7d6541440d952788e40aeba0bef25a49955379df26f45ec82737bd（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；70 mana / 9000ms CD；immediate primary-champion scaffold；恰好一次 non-crit/non-copyable physical damage 205+1.00*(source.attr.ad.resolved-source.attr.ad.base)+0.50*source.attr.ap.resolved（nested binary add；交叉校验 baseAD59 / resolvedAD139 / AP100 → raw335，armor100 → mitigated167.5；分支 raw205/285/255/335 与 mitigated102.5/142.5/127.5/167.5）。Attempts t0/t8999/t9000 mana210 → two successes + exactly one cooldown skip without mana/damage；final mana 70；mana69 → resource skip/no hit。Q 不产生 basic_attack_hit、不武装既有 Quinn W、不改变 AS；runtime 可合成既有 ability_started，不宣称全局零事件。completedBoundary：rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_205_plus_1_00_bonus_ad_plus_0_50_ap; no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks。明确排除 Valor entity/AI、cast delay、direction/projectile/speed/travel/collision/range/width/radius/geometry/AOE/multitarget、monster double、Harrier/P/W interaction、nearsight/disarm/sight/control/death persistence、ranks1–4、other Quinn skills/basic、loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 Valor/projectile/geometry/AOE/Harrier/nearsight/disarm/完整游戏保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-quinn-blinding-assault-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_blinding_assault_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_205_plus_1_00_bonus_ad_plus_0_50_ap; no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks; Wiki request Template:Data Quinn/Q → Blinding Assault; rev4024766/SHA256 abce6abd… / bytes1742; local raw caveat bytes1742/SHA be887856… no equivalence claim; rank5 70 mana/9000ms CD / one physical 205+1.00*bonusAD+0.50*AP nested binary add; baseAD59/resolvedAD139/AP100→raw335/armor100→167.5; branches raw205/285/255/335 mitigated102.5/142.5/127.5/167.5; t0/t8999/t9000 mana210 two successes + one CD skip final mana70; mana69 resource skip/no hit; no basic_attack_hit / does not arm Quinn W / no AS change; may synthesize ability_started (not globally zero events); Wasm exact test commit ba71996; Valor/projectile/geometry/AOE/Harrier/nearsight/disarm/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-quinn-blinding-assault-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_quinn_blinding_assault_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_205_plus_1_00_bonus_ad_plus_0_50_ap; no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks; backend lol_generic_quinn_blinding_assault_primary_hit_seed.sql + LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest + README (owning 5c174b5; integrated e030cd9); Wasm exact test commit ba71996; nested binary add; Web source asset exact parity (no Web change/commit); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_quinn|W|敏锐感知',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Quinn W Heightened Senses：预先存在 harrier_vulnerable 时 Wiki rank-5 +80% AS/2s 与刷新已由 generic CompileGeneric+RunGeneric 闭环（Wiki rev4024767）；harrier produce/consume 与 Harrier 额外伤害非 W 完成所必需。W 主动视野/移速为允许不模拟的非伤害分支。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-quinn-heightened-senses',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_heightened_senses_test.go',
          sourceWorktree: 'wasm',
          note: 'AS branch only; harrier produce/consume not required for W completion',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-quinn-heightened-senses',
          sourcePath: 'db/game_manage/seeds/lol_generic_quinn_heightened_senses_seed.sql',
          sourceWorktree: 'backend',
          note: 'AS branch only; P/Q/E harrier deps preserved separately in inventory',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_xayah|Q|双刃',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Xayah Q 双刃/Double Daggers：Wiki request Template:Data Xayah/Q → resolved Template:Data Xayah/Double Daggers；page1324541 / rev4008615 / timestamp 2026-04-15T00:26:21Z / canonical bytes2615 / SHA256 8010e567d2366730c5eb6cd0a31baec09c7f5137018ab2ca15fd84f167d990fd（normalized/generic/xayah-q.json plus pages sibling are authority）rank5 Phase-A v3 已由 wasm-generic-xayah-double-daggers-primary-two-hit + backend seed 证据闭环——live redirect page1324536/rev2864045 is live request detail only and is not stored in the sidecar；local raw caveat bytes2615 / SHA 6a1fde0a18de0b6f28e55be7df27e58f99c91d49310e79ae81a9e95384f974de（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；35 mana / 8000ms CD；immediate primary-champion two-feather scaffold；恰好两次有序 non-crit/non-copyable physical hits，each 105+0.50*(source.attr.ad.resolved-source.attr.ad.base)（nested binary formula；交叉校验 baseAD60/resolvedAD60 each105/total210，armor100 each52.5/total105；resolvedAD110 each130/total260，armor100 each65/total130）。Attempts t0/t7999/t8000 mana105/HP1000/armor100 → two successes + exactly one cooldown skip，four damage items；final mana35/HP740；two automatic ability_started；mana34 → resource skip/unchanged。Required Xayah W isolation coexistence：Q success/skip does not arm W and AS stays baseline；W success while Q mounted arms only W and causes zero Q damage；Backend W listener uses ability/xayah_deadly_plumage ALL matcher with ability_id NULL；runtime W ListenerDefinition.AbilityRef stays empty。completedBoundary：rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks。明确排除 cast time/attack lockout/effect-at-cast-end、direction/range/width/geometry、projectile/travel/collision/interception/spellshield、later-target 50% reduction、multitarget/formation/area、feather generation/ground state/E interaction、ranks1–4、P/E/R/basic/equipment/loadout/crit/on-hit、live migration/publish/E2E/full game fidelity；不宣称 cast-time/attack-lockout/direction/range/width/projectile/travel/interception/spellshield/secondary-target-reduction/feather-generation/ground-state/E/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（Xayah/ad/mana plus corrected W isolation prerequisites），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-xayah-double-daggers-primary-two-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_xayah_double_daggers_primary_two_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks; Wiki request Template:Data Xayah/Q → Double Daggers; rev4008615/SHA256 8010e567… / bytes2615; local raw caveat bytes2615/SHA 6a1fde0a… no equivalence claim; live redirect page1324536/rev2864045 not stored in sidecar; rank5 35 mana/8000ms CD / two ordered physical 105+0.50*bonusAD nested binary; baseAD60/resolvedAD60 each105/total210 armor100 each52.5/total105; resolvedAD110 each130/total260 armor100 each65/total130; t0/t7999/t8000 mana105/HP1000 two successes + one CD skip four damage items final mana35/HP740 two ability_started; mana34 resource skip unchanged; Q success/skip does not arm W / AS baseline; W success while Q mounted arms only W / zero Q damage; Backend W ability/xayah_deadly_plumage ALL matcher ability_id NULL; runtime W ListenerDefinition.AbilityRef empty; Wasm exact test commit dd7dae6; cast-time/lockout/direction/range/projectile/interception/spellshield/secondary-reduction/feather/ground/E/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-xayah-double-daggers-primary-two-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_xayah_double_daggers_primary_two_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks; backend lol_generic_xayah_double_daggers_primary_two_hit_seed.sql + LolGenericXayahDoubleDaggersPrimaryTwoHitSeedSqlTest (owning 8ace954; integrated 6bab0b8); Wasm exact test commit dd7dae6; nested binary; external existing-data/check-only prerequisites (Xayah/ad/mana plus corrected W isolation; does not write identity/panel/resource values); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_xayah|R|暴风羽刃',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Xayah R 暴风羽刃/Featherstorm：Wiki request Template:Data Xayah/R → resolved Template:Data Xayah/Featherstorm；page1324544 / rev4008617 / timestamp 2026-04-15T00:26:44Z / canonical bytes1761 / SHA256 cb5c8ba5486a55027e7c2252589fa8e5d821d346cc44afa99243de71ce5b3077（normalized/generic/xayah-r.json plus pages sibling are authority）rank3 Phase-A v2 已由 wasm-generic-xayah-featherstorm-primary-hit + backend seed 证据闭环——local raw caveat bytes1761 / SHA debf23b0213a4d9669a29f6c415a6f67d582b7093d25059b7765745bed43ace1（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；100 mana / 100000ms CD；immediate primary-champion one physical damage quantum scaffold；one selected application of the leveling-labeled amount as an immediate bounded primary-champion physical damage quantum 400 + 1.00*(source.attr.ad.resolved-source.attr.ad.base)；exactly one noncrit/noncopyable physical damage operation（交叉校验 baseAD60/resolvedAD60 raw400，armor0=400，armor100=200；baseAD60/resolvedAD110 raw450，armor0=450，armor100=225）。Attempts t0/t99999/t100000 mana300/HP1000/armor100/resolvedAD110 → two successes + exactly one cooldown skip，two R damage-quantum items；final mana100/HP550；two automatic R ability_started；mana99 → resource skip/unchanged。Required Xayah W/Q/R isolation：R and Q never arm W；W self-cast arms W；R remains one quantum，Q remains two hits；definitions/mounts/snapshots remain distinct；Backend W listener uses ability/xayah_deadly_plumage ALL matcher with ability_id NULL；runtime W ListenerDefinition.AbilityRef stays empty。completedBoundary：rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity。明确排除 leap/ghosted/untargetable、one-second delay、attack/cast lockout、direction/cone/range/geometry、projectile/travel/collision/multitarget、feather generation/ground state/E dependency、other ranks、P/E/basic/equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 Wiki 证明完整 R once-only 或 complete Featherstorm 仅有一次总命中；不建模/宣称五次 damage ops 或同目标多羽基数。Backend seed 显式依赖 external existing-data/check-only 前置（Xayah/ad/mana plus corrected W isolation prerequisites；Q optional independent sibling），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-xayah-featherstorm-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_xayah_featherstorm_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity; Wiki request Template:Data Xayah/R → Featherstorm; rev4008617/SHA256 cb5c8ba5… / bytes1761; local raw caveat bytes1761/SHA debf23b0… no equivalence claim; rank3 100 mana/100000ms CD / one physical damage quantum 400+1.00*bonusAD; baseAD60/resolvedAD60 raw400 armor0=400 armor100=200; resolvedAD110 raw450 armor0=450 armor100=225; t0/t99999/t100000 mana300/HP1000/armor100 two successes + one CD skip two R damage-quantum items final mana100/HP550 two automatic R ability_started; mana99 resource skip unchanged; R and Q never arm W; W self-cast arms W; R one quantum / Q two hits; Backend W ability/xayah_deadly_plumage ALL matcher ability_id NULL; runtime W ListenerDefinition.AbilityRef empty; Wasm exact test commit 57ec17c; leap/ghosted/untargetable/one-second-delay/lockout/direction/cone/projectile/multitarget/feather/ground/E/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A; no claim Wiki proves whole-R once-only or complete Featherstorm one total hit; no five damage ops or same-target multi-feather cardinality',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-xayah-featherstorm-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_xayah_featherstorm_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity; backend lol_generic_xayah_featherstorm_primary_hit_seed.sql + LolGenericXayahFeatherstormPrimaryHitSeedSqlTest (owning 354fd287; integrated 741e1ff); Wasm exact test commit 57ec17c; external existing-data/check-only prerequisites (Xayah/ad/mana plus corrected W isolation; Q optional independent sibling; does not write identity/panel/resource values); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_xayah|W|致死羽衣',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Xayah W 致死羽衣/Deadly Plumage：Wiki rev4010669（SHA256 09d5476533722311e85c4ca79813cd0bec2cf35d105be894b80dac14478845a7；normalized/generic/xayah-w.json）rank5 Phase-A 1v1 已由 wasm-generic-xayah-deadly-plumage + backend seed 证据闭环——40 mana / 14000ms CD / 4000ms timed AS +55%；Wiki 次级羽刃 25% → source-owned pipeline basic_damage*(1+0.25*deadly_plumage_active) @ outgoing_pre_mitigation（合并 1.25×，非第二 missile/伤害实例）；expected-crit 一次后再 ×1.25 一次；排除 on-hit/proc；Guinsoo phantom 不重放非 CopyableOnHit 基攻且不重跑倍率。明确排除移速/Rakan/Runaan/多目标/projectile/in-flight/ward/blind/dodge/block/独立次级羽刃/其它 rank/完整 live 保真，故标 completed。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-xayah-deadly-plumage',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_xayah_deadly_plumage_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: Wiki rev4010669 Phase-A AS + basic_damage×1.25 excl on-hit/proc/phantom; MS/Rakan/Runaan/projectile/separate missile/other ranks excluded',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-xayah-deadly-plumage',
          sourcePath: 'db/game_manage/seeds/lol_generic_xayah_deadly_plumage_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: provider_hero_xayah_w_deadly_plumage Phase-A seed; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_jinx|W|震荡电磁波！',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Jinx W 震荡电磁波！/Zap!：Wiki request Template:Data Jinx/W → resolved Template:Data Jinx/Zap!；page1307598 / rev3907092 / timestamp 2025-06-06T17:47:18Z / canonical bytes1321 / SHA256 8aa6ac3943076256fe6afea15f1dd6eebf892656be45784e2522abb6243f4d1f（normalized/generic/jinx-w.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-jinx-zap-primary-hit + backend seed 证据闭环——local raw caveat bytes1319 / SHA c373cc258c5c8c612930a32c5e851bd4b68dbbcb3c0d7f71ce1d25020ba12624（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；60 mana / 4000ms CD；immediate primary-champion single physical hit scaffold；one selected immediate primary-champion physical damage operation 210 + 1.40 * source.attr.ad.resolved（total AD；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（交叉校验 totalAD60 raw294；armor0=294，armor100=147。totalAD110 raw364；armor0=364，armor100=182）。Attempts mana180/HP1000/AD110/armor100 at t0/t3999/t4000 → success/skip/success，exactly two W damage items；final mana60/HP636；exactly two automatic W ability_started；mana59 at t0 → resource skip with mana/HP unchanged and no W damage/event。Jinx W is standalone；Backend has no repository-owned hero_jinx / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Jinx synthesis。completedBoundary：rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_1_40_total_ad; no_cast_timing_direction_range_width_projectile_travel_collision_first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity。明确排除 cast timing、direction/range/width/geometry、projectile travel/collision/first-enemy acquisition、sight/reveal、slow、other ranks、other Jinx abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 cast/direction/projectile/sight/reveal/slow/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_jinx/ad/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-jinx-zap-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_jinx_zap_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_1_40_total_ad; no_cast_timing_direction_range_width_projectile_travel_collision_first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity; Wiki request Template:Data Jinx/W → Zap!; rev3907092/SHA256 8aa6ac39… / bytes1321; local raw caveat bytes1319/SHA c373cc25… no equivalence claim; rank5 60 mana/4000ms CD / one physical 210+1.40*totalAD; totalAD60 raw294 armor0=294 armor100=147; totalAD110 raw364 armor0=364 armor100=182; mana180/HP1000/AD110/armor100 t0/t3999/t4000 success/skip/success two W damage items final mana60/HP636 two automatic W ability_started; mana59 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit 2afde02; cast/direction/range/width/projectile/travel/collision/first-enemy/sight/reveal/slow/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-jinx-zap-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_jinx_zap_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_1_40_total_ad; no_cast_timing_direction_range_width_projectile_travel_collision_first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity; backend lol_generic_jinx_zap_primary_hit_seed.sql + LolGenericJinxZapPrimaryHitSeedSqlTest (owning b5abdb7; integrated a09adf1); Wasm exact test commit 2afde02; external existing-data/check-only prerequisites (hero_jinx/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Jinx synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_jinx|E|嚼火者手雷！',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Jinx E 嚼火者手雷！/Flame Chompers!：Wiki request Template:Data Jinx/E → resolved Template:Data Jinx/Flame Chompers!；page1307600 / rev3993368 / timestamp 2026-02-21T15:35:19Z / canonical bytes1786 / SHA256 64562ed4adb34c932810970fd9b9c016b46329d6f956541d334c60d2bc9d83ee（normalized/generic/jinx-e.json bytes2228/SHA256 de7922f66deb96c8652dd1a0509105b49cdcf22278d1fd591bc366060987183a plus pages sibling bytes694/SHA256 f2822e5708dd024c582575a9298c12b6e6cd66b37e3365ea8749e8e1d49b360d are authority）rank5 Phase-A v1 已由 wasm-generic-jinx-flame-chompers-primary-explosion-hit + backend seed 证据闭环——local raw caveat bytes1784 / SHA aabb099fd172522682e40f0826e4971797c3a047787ef3c5af902bc4b673a551（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；sourceCount12；90 mana / 10000ms CD；immediate selected-primary-champion single magic explosion-hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable magic damage operation add(const 290, mul(const 1.00, read source.attr.ap.resolved))（exact nested binary；one AP read）；exactly one noncrit/noncopyable magic damage operation（damage type 20221 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no E ability-specific type）（交叉校验 MR100 AP0 raw290/final145；AP100 raw390/final195；unrelated AD counterproof）。Attempts mana270/AP100/HP1000/MR100 at t0/t9999/t10000 → success/skip/success，exactly two E damage items；final mana90/HP610；exactly two automatic E ability_started；mana89 at t0 → resource skip with mana/HP unchanged and no E damage/event。standalone E，plus bounded E/W coexistence isolation；E does not trigger/mutate W and W does not trigger/mutate E；No P/Q/R/basic synthesis。Jinx E provider is standalone；Backend external existing-data/check-only prerequisites only（hero_jinx/ap/mana）；no identity/panel/resource materializer/write；不宣称 Jinx W/Batch-B owns prerequisites；不暗示 Batch-B 或 sibling Jinx synthesis；不暗示任何 production runtime/ABI/Web change。Design READY run-893fcb26-cd49-4bb2-9bc7-4a231b13762f：runDelta0，1750 parseable event lines，no truncation/mutation/user decision；production Wasm/public ABI/Web not needed。Backend validation honesty：owning df08d6b341d85b3c43bc70e33e43eae0cb736ac8 / run-1f38cae0-444e-4601-b316-9a74886b6b44 delta3/outside0；Main focused37/full1032 PASS；seed27322/SHA 686ff89b4f29b1697e478d2f1b676d80a9bd3288e460bea4f57e0a3b7583ee6f；JUnit46529/SHA 519c3e5ce2844d41bdc348441056352fb893633ca084bb261f63bffd0300d35a；README305324/SHA bc71abfed04e04299a78bc8f17ae17ad619e779cb014d65bf8ed3912eb86b7be at owning commit。Mirror 3b26d3e74a6eb460bb641f42a1909f9735eb7dbd / run-1554558c-1d6b-4add-9cd8-4d52c89a6b97 delta3/outside0 exact parity focused18 PASS。Wasm exact 9320b4dafc6225a3a20829de17223a0a6d715787 / run-5b26afad-2b5f-42b7-bc71-81ae5aaff897 delta1/outside0；exact test bytes63966 / SHA256 59ee84f4b61bee5f86d8cc374204e2551161e18fd20b20d9db17d8b51553741b；main focused7 top-level/count100/E+W/full Go/Go bench/TinyGo build/Node smoke+bench PASS；built production and independent Web source asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no production/Web write；hero-named `_test.go` is regression/governance evidence only，builds generic Provider/Ability/Formula contracts，excluded from production build；no hero-specific production branch/public ABI change。completedBoundary：rank5_selected_primary_champion_single_magic_explosion_hit; immediate_impact_and_cooldown_scaffold; magic_290_plus_1_00_ap; no_three_chomper_layout_landing_delay_arming_delay_five_second_lifetime_location_direction_range_geometry_area_multitarget_contact_acquisition_knockdown_root_one_chomper_per_champion_wind_wall_braum_spellshield_exception_vision_other_ranks_or_full_fidelity。明确排除 three-trap layout/count/identity、location/direction/range/geometry/area/multitarget、landing/arming/lifetime delays、contact/collision/acquisition/one-per-champion、knockdown/root/CC、Wind Wall/Braum/spell-shield exception/vision、other ranks/siblings/loadout/bootstrap/live/Admin/E2E/full E/full-game fidelity；this is exactly one selected-primary champion magic explosion-hit quantum, not one total in-game E hit；不宣称 three-trap/layout/landing/arming/lifetime/location/direction/range/geometry/area/multitarget/contact/acquisition/knockdown/root/Wind Wall/Braum/spellshield/vision/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_jinx/ap/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-jinx-flame-chompers-primary-explosion-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_jinx_flame_chompers_primary_explosion_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_selected_primary_champion_single_magic_explosion_hit; immediate_impact_and_cooldown_scaffold; magic_290_plus_1_00_ap; no_three_chomper_layout_landing_delay_arming_delay_five_second_lifetime_location_direction_range_geometry_area_multitarget_contact_acquisition_knockdown_root_one_chomper_per_champion_wind_wall_braum_spellshield_exception_vision_other_ranks_or_full_fidelity; Wiki request Template:Data Jinx/E → Flame Chompers!; rev3993368/SHA256 64562ed4… / bytes1786; local raw caveat bytes1784/SHA aabb099f… no equivalence claim; rank5 90 mana/10000ms CD / one magic 290+1.00*ap.resolved via exact nested binary add(const290, mul(1.00, read ap.resolved)); one AP read; MR100 AP0 raw290/final145; AP100 raw390/final195; unrelated AD counterproof; damage 20221/add 20170; no 20230; no explicit event op; no E type; mana270/AP100/HP1000/MR100 t0/t9999/t10000 success/skip/success two E damage items final mana90/HP610 two automatic E ability_started; mana89 resource skip unchanged; standalone E plus bounded E/W coexistence isolation; E does not trigger/mutate W and W does not trigger/mutate E; no P/Q/R/basic synthesis; hero-named _test.go regression/governance only; standalone no sibling synthesis; Wasm exact test commit 9320b4da bytes63966/SHA 59ee84f4…; three-trap/layout/landing/arming/lifetime/location/direction/range/geometry/area/multitarget/contact/acquisition/knockdown/root/Wind Wall/Braum/spellshield/vision/other-ranks/live/Admin/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-jinx-flame-chompers-primary-explosion-hit',
          sourcePath:
            'db/game_manage/seeds/lol_generic_jinx_flame_chompers_primary_explosion_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_selected_primary_champion_single_magic_explosion_hit; immediate_impact_and_cooldown_scaffold; magic_290_plus_1_00_ap; no_three_chomper_layout_landing_delay_arming_delay_five_second_lifetime_location_direction_range_geometry_area_multitarget_contact_acquisition_knockdown_root_one_chomper_per_champion_wind_wall_braum_spellshield_exception_vision_other_ranks_or_full_fidelity; backend lol_generic_jinx_flame_chompers_primary_explosion_hit_seed.sql + LolGenericJinxFlameChompersPrimaryExplosionHitSeedSqlTest + README (owning df08d6b; integrated 3b26d3e); Wasm exact test commit 9320b4da; seed27322/SHA 686ff89b…; JUnit46529/SHA 519c3e5c…; README305324/SHA bc71abfe…; READY run-893fcb26; run-1f38cae0 delta3/outside0 focused37/full1032; mirror run-1554558c exact parity focused18 PASS; external existing-data/check-only prerequisites (hero_jinx/ap/mana; does not write identity/panel/resource values; no claim Jinx W/Batch-B owns prerequisites); standalone no Batch-B or sibling Jinx synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_jhin|Q|曼舞手雷',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Jhin Q 曼舞手雷/Dancing Grenade：Wiki request Template:Data Jhin/Q → resolved Template:Data Jhin/Dancing Grenade；page1307579 / rev4007611 / timestamp 2026-04-12T07:23:12Z / canonical bytes1913 / SHA256 522c4b918067b4b035b6744eb3dc83ce64ba5d47f677ed8517fcb246111685f1（normalized/generic/jhin-q.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-jhin-dancing-grenade-primary-first-hit + backend seed 证据闭环——local raw caveat bytes1911 / SHA 17deceae0abe42034f805a166ae5a16932ffcb19925654e6aa39625f026dd0cb（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；60 mana / 5000ms CD；immediate selected-primary-champion first-grenade single physical hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable physical damage operation add(add(const 144, mul(const 0.74, read source.attr.ad.resolved)), mul(const 0.60, read source.attr.ap.resolved))（exact nested binary add；total AD direct read；never bonus AD/subtraction；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no Q ability-specific type）（交叉校验 AD0/AP0/armor0 raw=final144；AD100/AP0/armor0 raw=final218；AD0/AP100/armor0 raw=final204；AD100/AP100/armor0 raw=final278；AD100/AP100/armor100 raw278/final139；AD200/AP100/armor100 raw352/final176；baseAD0 vs baseAD60 at resolvedAD100/AP0/armor0 both218）。Attempts mana180/baseAD60/resolvedAD100/AP100/HP1000/armor100 at t0/t4999/t5000 → success/skip/success，exactly two Q damage items；final mana60/HP722；exactly two automatic Q ability_started；mana59 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Q/W isolation：preserve existing W without requiring/mutating/synthesizing/copying W；Q seed contains no W rows；test-only composition of independent graphs only。Jhin Q is standalone；Backend has no repository-owned hero_jhin / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Jhin synthesis。completedBoundary：rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity。明确排除 cast time/unit-targeted cancel conditions、projectile travel/first-target acquisition、bounce to up to three additional targets/nearest-unhit priority、target-death +35% later-bounce amplification/maximum final bounce、spellshield bounce-persistence、other ranks、other Jhin abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 cast/cancel/projectile/acquisition/bounce/nearest-unhit/death-amp/max-bounce/spellshield/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_jhin/ad/ap/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-jhin-dancing-grenade-primary-first-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_jhin_dancing_grenade_primary_first_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity; Wiki request Template:Data Jhin/Q → Dancing Grenade; rev4007611/SHA256 522c4b91… / bytes1913; local raw caveat bytes1911/SHA 17deceae… no equivalence claim; rank5 60 mana/5000ms CD / one physical 144+0.74*totalAD+0.60*AP nested binary add; AD0/AP0/armor0=144; AD100/AP0/armor0=218; AD0/AP100/armor0=204; AD100/AP100/armor0=278; AD100/AP100/armor100 raw278/final139; AD200/AP100/armor100 raw352/final176; baseAD0 vs baseAD60 at resolvedAD100/AP0/armor0 both218; damage 20220/add 20170; no 20230; no explicit event op; no Q type; mana180/baseAD60/resolvedAD100/AP100/HP1000/armor100 t0/t4999/t5000 success/skip/success two Q damage items final mana60/HP722 two automatic Q ability_started; mana59 resource skip unchanged; Q/W isolation preserve existing W; standalone no sibling synthesis; Wasm exact test commit f70be27 bytes71563/SHA deaa6604…; cast/cancel/projectile/acquisition/bounce/nearest-unhit/death-amp/max-bounce/spellshield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-jhin-dancing-grenade-primary-first-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity; backend lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql + LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest (owning ce22594; integrated 488898e); Wasm exact test commit f70be27; external existing-data/check-only prerequisites (hero_jhin/ad/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Jhin synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_jhin|W|致命华彩',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Jhin W 致命华彩/Deadly Flourish：Wiki request Template:Data Jhin/W → resolved Template:Data Jhin/Deadly Flourish；page1307581 / rev4021795 / timestamp 2026-05-21T13:25:33Z / canonical bytes2942 / SHA256 14790ca09f6f320fc2fadc81c2fa7e783c7b81d48d792b7760494f2e8d788c65（normalized/generic/jhin-w.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-jhin-deadly-flourish-primary-hit + backend seed 证据闭环——local raw caveat bytes2940 / SHA 76790ba522dc101bb1f1c24ae620f80e8db6d10e890515cbc7da85005a67f78b（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；70 mana / 12000ms CD；immediate primary-champion single physical hit scaffold；one selected immediate primary-champion physical damage operation 210 + 0.50 * source.attr.ad.resolved（total AD；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（交叉校验 totalAD60 raw240；armor0=240，armor100=120。totalAD100 raw260；armor0=260，armor100=130）。Attempts mana210/HP1000/AD100/armor100 at t0/t11999/t12000 → success/skip/success，exactly two W damage items；final mana70/HP740；exactly two automatic W ability_started；mana69 at t0 → resource skip with mana/HP unchanged and no W damage/event。Minion-only 25% reduction does not apply to the selected champion and is excluded。Jhin W is standalone；Backend has no repository-owned hero_jhin / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Jhin synthesis。completedBoundary：rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_0_50_total_ad; no_cast_timing_direction_range_width_line_geometry_multitarget_champion_collision_projectile_interception_spell_shield_mark_creation_mark_detection_root_bonus_movement_speed_minion_reduction_other_ranks_or_full_fidelity。明确排除 cast timing/Effect-at-cast-start、direction/range/width/line geometry/multitarget/champion collision、projectile identity/interception/spell shield/facing、mark creation/detection/duration、root/control/tenacity、bonus movement speed、minion reduction、other ranks、other Jhin abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 cast/direction/line/projectile/mark/root/minion/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_jhin/ad/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-jhin-deadly-flourish-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_jhin_deadly_flourish_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_0_50_total_ad; no_cast_timing_direction_range_width_line_geometry_multitarget_champion_collision_projectile_interception_spell_shield_mark_creation_mark_detection_root_bonus_movement_speed_minion_reduction_other_ranks_or_full_fidelity; Wiki request Template:Data Jhin/W → Deadly Flourish; rev4021795/SHA256 14790ca0… / bytes2942; local raw caveat bytes2940/SHA 76790ba5… no equivalence claim; rank5 70 mana/12000ms CD / one physical 210+0.50*totalAD; totalAD60 raw240 armor0=240 armor100=120; totalAD100 raw260 armor0=260 armor100=130; mana210/HP1000/AD100/armor100 t0/t11999/t12000 success/skip/success two W damage items final mana70/HP740 two automatic W ability_started; mana69 resource skip unchanged; selected-champion minion-reduction excluded; standalone no sibling synthesis; Wasm exact test commit d62d2e4; cast/direction/range/width/line/multitarget/collision/projectile/interception/spell-shield/mark/root/ms/minion/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-jhin-deadly-flourish-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_jhin_deadly_flourish_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_0_50_total_ad; no_cast_timing_direction_range_width_line_geometry_multitarget_champion_collision_projectile_interception_spell_shield_mark_creation_mark_detection_root_bonus_movement_speed_minion_reduction_other_ranks_or_full_fidelity; backend lol_generic_jhin_deadly_flourish_primary_hit_seed.sql + LolGenericJhinDeadlyFlourishPrimaryHitSeedSqlTest (owning 4903c00; integrated 0c103f8); Wasm exact test commit d62d2e4; external existing-data/check-only prerequisites (hero_jhin/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Jhin synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_caitlyn|E|90口径绳网',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Caitlyn E 90口径绳网/90 Caliber Net：Wiki request Template:Data Caitlyn/E → resolved Template:Data Caitlyn/90 Caliber Net；page1306916 / rev4007584 / timestamp 2026-04-12T06:47:56Z / canonical bytes2095 / SHA256 9357e7b28b05f738cd8049a2d10a115e4033a54123c0e71f55d1262a92884db2（normalized/generic/caitlyn-e.json plus pages sibling are authority）rank5 Phase-A v3 已由 wasm-generic-caitlyn-90-caliber-net-primary-hit + backend seed 证据闭环——local raw caveat bytes2094 / SHA 3a5eba6df38ec34046440743d55de61490dc7b5a2488b8fc671851474d080073（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；75 mana / 8000ms CD；immediate primary-champion first-enemy single magic hit scaffold；one selected immediate primary-champion magic damage operation 280 + 0.80 * source.attr.ap.resolved；exactly one noncrit/noncopyable magic damage operation（damage type 20221 + add policy 20170；20230 forbidden）（交叉校验 AP0 → raw/mit 280/140；AP100 → raw/mit 360/180）。Attempts mana225/HP1000/AP100/MR100 at t0/t7999/t8000 → success/skip/success，exactly two E damage items；final mana75/HP640；exactly two automatic E ability_started；mana74 at t0 → resource skip with mana/HP unchanged and no E damage/event。Caitlyn E is standalone；Backend has no repository-owned hero_caitlyn / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Caitlyn synthesis。completedBoundary：rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; magic_280_plus_0_80_ap; no_cast_timing_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_suppression_spell_shield_recoil_dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_full_fidelity。明确排除 cast timing/Effect-at-cast-end、direction/range/width/line geometry/multitarget/first-enemy acquisition/collision、projectile/suppression/interception/spell shield、recoil/dash/terrain/buffered actions、slow/control/tenacity、Headshot/mark、other ranks、other Caitlyn abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 cast/direction/line/projectile/recoil/dash/slow/Headshot/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_caitlyn/ap/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-caitlyn-90-caliber-net-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_caitlyn_90_caliber_net_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; magic_280_plus_0_80_ap; no_cast_timing_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_suppression_spell_shield_recoil_dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_full_fidelity; Wiki request Template:Data Caitlyn/E → 90 Caliber Net; rev4007584/SHA256 9357e7b2… / bytes2095; local raw caveat bytes2094/SHA 3a5eba6d… no equivalence claim; rank5 75 mana/8000ms CD / one magic 280+0.80*AP; AP0 raw/mit 280/140; AP100 raw/mit 360/180; damage 20221/add 20170/20230 forbidden; mana225/HP1000/AP100/MR100 t0/t7999/t8000 success/skip/success two E damage items final mana75/HP640 two automatic E ability_started; mana74 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit 4433ef1; cast/direction/range/width/line/multitarget/first-enemy/projectile/suppression/spell-shield/recoil/dash/terrain/buffer/slow/Headshot/mark/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-caitlyn-90-caliber-net-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; magic_280_plus_0_80_ap; no_cast_timing_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_suppression_spell_shield_recoil_dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_full_fidelity; backend lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql + LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest (owning 9506d01; integrated 384d658); Wasm exact test commit 4433ef1; external existing-data/check-only prerequisites (hero_caitlyn/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Caitlyn synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_kalista|Q|穿刺',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Kalista Q 穿刺/Pierce：Wiki request Template:Data Kalista/Q → resolved Template:Data Kalista/Pierce；page1307666 / rev3997075 / timestamp 2026-03-06T15:53:18Z / canonical bytes1625 / SHA256 90c490d921da436134c318249fa7d0038ceaa97dfb76e5bdaa0b330a43676a67（normalized/generic/kalista-q.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-kalista-pierce-primary-hit + backend seed 证据闭环——local raw caveat bytes1623 / SHA 0b8dd9cf9b40aae52fb6180ecabae7e459970f2f7c4d05711463df25fdbd1c94（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；80 mana / 9000ms CD；immediate primary-champion first-enemy single physical hit scaffold；one selected immediate primary-champion physical damage operation 270 + 1.05 * source.attr.ad.resolved（total AD；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no explicit event op）（交叉校验 (AD0,A0)=(270,270)；(AD0,A100)=(270,135)；(AD100,A0)=(375,375)；(AD100,A100)=(375,187.5)；(AD200,A100)=(480,240)）。Attempts mana240/HP1000/AD100/armor100 at t0/t8999/t9000 → success/skip/success，exactly two Q damage items；final mana80/HP625；exactly two automatic Q ability_started；mana79 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Kalista Q is standalone；Backend has no repository-owned hero_kalista / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Kalista synthesis。completedBoundary：rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_270_plus_1_05_total_ad; no_cast_timing_martial_poise_dash_cancel_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_interception_spell_shield_kill_continuation_rend_stack_transfer_other_ranks_or_full_fidelity。明确排除 cast timing/Effect-at-cast-end、Martial Poise/dash cancel、direction/range/width/line geometry/multitarget/first-enemy acquisition/collision、projectile/interception/spell shield、kill continuation/Rend stack transfer、other ranks、other Kalista abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 cast/Martial Poise/direction/line/projectile/kill/Rend/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_kalista/ad/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kalista-pierce-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_kalista_pierce_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_270_plus_1_05_total_ad; no_cast_timing_martial_poise_dash_cancel_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_interception_spell_shield_kill_continuation_rend_stack_transfer_other_ranks_or_full_fidelity; Wiki request Template:Data Kalista/Q → Pierce; rev3997075/SHA256 90c490d9… / bytes1625; local raw caveat bytes1623/SHA 0b8dd9cf… no equivalence claim; rank5 80 mana/9000ms CD / one physical 270+1.05*totalAD; (AD0,A0)=(270,270); (AD0,A100)=(270,135); (AD100,A0)=(375,375); (AD100,A100)=(375,187.5); (AD200,A100)=(480,240); damage 20220/add 20170; no explicit event op; mana240/HP1000/AD100/armor100 t0/t8999/t9000 success/skip/success two Q damage items final mana80/HP625 two automatic Q ability_started; mana79 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit 99e7b39; cast/Martial-Poise/dash/direction/range/width/line/multitarget/first-enemy/projectile/interception/spell-shield/kill/Rend/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kalista-pierce-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_kalista_pierce_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_270_plus_1_05_total_ad; no_cast_timing_martial_poise_dash_cancel_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_interception_spell_shield_kill_continuation_rend_stack_transfer_other_ranks_or_full_fidelity; backend lol_generic_kalista_pierce_primary_hit_seed.sql + LolGenericKalistaPiercePrimaryHitSeedSqlTest (owning 04c061f; integrated bdb5d32); Wasm exact test commit 99e7b39; external existing-data/check-only prerequisites (hero_kalista/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Kalista synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_caitlyn|Q|和平使者',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Caitlyn Q 和平使者/Piltover Peacemaker：Wiki request Template:Data Caitlyn/Q → resolved Template:Data Caitlyn/Piltover Peacemaker；page1306911 / rev4007583 / timestamp 2026-04-12T06:47:12Z / canonical bytes1841 / SHA256 6c40deba7b6e60ab9c06bc014a214a8be4319c4ddf22c550237b659f19307caf（normalized/generic/caitlyn-q.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit + backend seed 证据闭环——local raw caveat bytes1838 / SHA 93da300971429a629f11a721c3993784db6a99d3559b1286eae9500176560b9a（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；75 mana / 6000ms CD；immediate primary-champion first-enemy full physical hit scaffold；one selected immediate primary-champion physical damage operation 210 + 2.05 * source.attr.ad.resolved（total AD；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no explicit event op）（交叉校验 (AD0,A0)=(210,210)；(AD0,A100)=(210,105)；(AD100,A0)=(415,415)；(AD100,A100)=(415,207.5)；(AD200,A100)=(620,310)）。Attempts mana225/HP1000/AD100/armor100 at t0/t5999/t6000 → success/skip/success，exactly two Q damage items；final mana75/HP585；exactly two automatic Q ability_started；mana74 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Caitlyn Q is standalone；Backend has no repository-owned hero_caitlyn / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Caitlyn synthesis。completedBoundary：rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; physical_210_plus_2_05_total_ad; no_cast_timing_attack_timer_reset_direction_range_width_line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_full_damage_projectile_spell_shield_other_ranks_or_full_fidelity。明确排除 cast timing/Effect-at-cast-start、attack timer reset、direction/range/width/line geometry/multitarget/post-first-enemy 60% damage、trap/reveal、full-damage projectile/spell shield、other ranks、other Caitlyn abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full fidelity；不宣称 cast/attack-timer-reset/direction/line/projectile/trap/reveal/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_caitlyn/ad/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_caitlyn_piltover_peacemaker_first_enemy_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; physical_210_plus_2_05_total_ad; no_cast_timing_attack_timer_reset_direction_range_width_line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_full_damage_projectile_spell_shield_other_ranks_or_full_fidelity; Wiki request Template:Data Caitlyn/Q → Piltover Peacemaker; rev4007583/SHA256 6c40deba… / bytes1841; local raw caveat bytes1838/SHA 93da3009… no equivalence claim; rank5 75 mana/6000ms CD / one physical 210+2.05*totalAD; (AD0,A0)=(210,210); (AD0,A100)=(210,105); (AD100,A0)=(415,415); (AD100,A100)=(415,207.5); (AD200,A100)=(620,310); damage 20220/add 20170; no explicit event op; mana225/HP1000/AD100/armor100 t0/t5999/t6000 success/skip/success two Q damage items final mana75/HP585 two automatic Q ability_started; mana74 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit 0fe29e7; cast/attack-timer-reset/direction/range/width/line/multitarget/post-first-enemy-60%/trap/reveal/projectile/spell-shield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; physical_210_plus_2_05_total_ad; no_cast_timing_attack_timer_reset_direction_range_width_line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_full_damage_projectile_spell_shield_other_ranks_or_full_fidelity; backend lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql + LolGenericCaitlynPiltoverPeacemakerFirstEnemyHitSeedSqlTest (owning b5ef446; integrated 245a111); Wasm exact test commit 0fe29e7; external existing-data/check-only prerequisites (hero_caitlyn/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Caitlyn synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_lucian|Q|透体圣光',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Lucian Q 透体圣光/Piercing Light：Wiki request Template:Data Lucian/Q → resolved Template:Data Lucian/Piercing Light；page1308176 / rev3982579 / timestamp 2026-01-09T09:22:29Z / canonical bytes1608 / SHA256 d7b03d15af48312a0ea5a06fa147b43c46d2a7ee6e1491dd121d796a2e452981（normalized/generic/lucian-q.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-lucian-piercing-light-selected-target-hit + backend seed 证据闭环——local raw caveat bytes1608 / SHA cd65b80f0580f0e4833028791bba2331a321366307b8c35f7fc28fe06c1f06c1（canonical identity remains sidecar/pages；no equivalence or contradiction claim；equal size alone is not byte equality or source contradiction）；80 mana / 5000ms CD；immediate selected-target single physical hit scaffold；one selected immediate selected-target single noncritical/noncopyable physical damage operation 220 + 1.00 * (source.attr.ad.resolved - source.attr.ad.base)（bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no explicit event op）（交叉校验 base60/resolved60/armor0 raw=final220；base60/resolved160/armor0 raw=final320；base60/resolved160/armor100 raw320/final160；base60/resolved260/armor100 raw420/final210；runtime test also carries an explicit total-AD counterproof）。Attempts mana240/baseAD60/resolvedAD160/HP1000/armor100 at t0/t4999/t5000 → success/skip/success，exactly two Q damage items；final mana80/HP680；exactly two automatic Q ability_started；mana79 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Lucian Q is standalone；Backend has no repository-owned hero_lucian / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Batch-B 或 sibling Lucian synthesis；不暗示任何 production runtime/ABI/Web change。completedBoundary：rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; physical_220_plus_1_00_bonus_ad; no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_initial_target_death_early_end_other_ranks_or_full_fidelity。明确排除 cast timing、target lead/dodge、direction、target range、range/width/line geometry、multitarget/AOE、spell shield、buffered W or R、E lockout、initial-target-death early end、other ranks、other Lucian abilities/passives、equipment/loadout/crit/on-hit、live migration/publish/E2E/full Piercing Light/game fidelity；不宣称 cast/lead/dodge/direction/range/line/multitarget/AOE/spell-shield/buffer/E-lockout/early-end/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_lucian/ad/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-lucian-piercing-light-selected-target-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_lucian_piercing_light_selected_target_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; physical_220_plus_1_00_bonus_ad; no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_initial_target_death_early_end_other_ranks_or_full_fidelity; Wiki request Template:Data Lucian/Q → Piercing Light; rev3982579/SHA256 d7b03d15… / bytes1608; local raw caveat bytes1608/SHA cd65b80f… no equivalence claim; rank5 80 mana/5000ms CD / one physical 220+1.00*bonusAD via sub(ad.resolved,ad.base); base60/resolved60/armor0=220; base60/resolved160/armor0=320; base60/resolved160/armor100 raw320/final160; base60/resolved260/armor100 raw420/final210; total-AD counterproof; damage 20220/add 20170; no explicit event op; mana240/baseAD60/resolvedAD160/HP1000/armor100 t0/t4999/t5000 success/skip/success two Q damage items final mana80/HP680 two automatic Q ability_started; mana79 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit aaca359; cast/lead/dodge/direction/range/line/multitarget/AOE/spell-shield/buffer/E-lockout/early-end/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-lucian-piercing-light-selected-target-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_lucian_piercing_light_selected_target_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; physical_220_plus_1_00_bonus_ad; no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_initial_target_death_early_end_other_ranks_or_full_fidelity; backend lol_generic_lucian_piercing_light_selected_target_hit_seed.sql + LolGenericLucianPiercingLightSelectedTargetHitSeedSqlTest (owning bfc9d54; integrated 826cdad); Wasm exact test commit aaca359; external existing-data/check-only prerequisites (hero_lucian/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Lucian synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_lucian|W|热诚烈弹',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Lucian W 热诚烈弹/Ardent Blaze：Wiki request Template:Data Lucian/W → resolved Template:Data Lucian/Ardent Blaze；page1308178 / rev3594941 / timestamp 2023-09-12T19:08:23Z / canonical bytes2542 / SHA256 b1ea7bc7a2e48be9ab97acfa1fc5addb80b8dd236dc97bd3d57c5e90951418c5（normalized/generic/lucian-w.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-lucian-ardent-blaze-primary-hit + backend seed 证据闭环——local raw caveat bytes2542 / SHA a57b0e49765ab5a9bdd30ad295d24e406a90015b083c8a0e817855c6bc152236（canonical identity remains sidecar/pages；no equivalence or contradiction claim；equal size alone is not byte equality or source contradiction）；60 mana / 10000ms CD；immediate primary-champion single magic hit scaffold；one immediate primary-champion single noncritical/noncopyable magic damage operation 215 + 0.90 * source.attr.ap.resolved；exactly one noncrit/noncopyable magic damage operation（damage type 20221 + add policy 20170；no explicit event op）（交叉校验 AP0/MR0 raw=final215；AP0/MR100 raw215/final107.5；AP100/MR0 raw=final305；AP100/MR100 raw305/final152.5；AP200/MR100 raw395/final197.5）。Attempts mana180/AP100/targetHP1000/MR100 at t0/t9999/t10000 → success/skip/success，exactly two W damage items；final mana60 and target HP695；exactly two automatic W ability_started；mana59 at t0 → resource skip with mana/HP unchanged and no W damage/event。Lucian W is standalone；Backend has no repository-owned hero_lucian / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Lucian Q dependence；不暗示 Batch-B 或 sibling Lucian synthesis；不暗示任何 production runtime/ABI/Web change。completedBoundary：rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_215_plus_0_90_ap; no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_shield_exception_other_ranks_or_full_fidelity。明确排除 cast timing and Effect-at-cast-time-end、direction/range/acquisition、missile/travel/collision、cross/explosion geometry、multitarget/AOE、sight、6-second mark、movement speed and its ranks、allied trigger/Vigilance、dodge/block/blind/persistent-damage、spell-shield mark exception、ranks1-4、equipment/loadout/crit/on-hit、other Lucian abilities/siblings、live migration/publish/E2E、full Ardent Blaze/game fidelity；不宣称 cast/Effect-at-cast-time-end/direction/range/missile/collision/cross/explosion/multitarget/AOE/sight/mark/ms/Vigilance/dodge/block/blind/DoT/spell-shield/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_lucian/ap/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-lucian-ardent-blaze-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_lucian_ardent_blaze_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_215_plus_0_90_ap; no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_shield_exception_other_ranks_or_full_fidelity; Wiki request Template:Data Lucian/W → Ardent Blaze; rev3594941/SHA256 b1ea7bc7… / bytes2542; local raw caveat bytes2542/SHA a57b0e49… no equivalence claim; rank5 60 mana/10000ms CD / one magic 215+0.90*AP; AP0/MR0=215; AP0/MR100 raw215/final107.5; AP100/MR0=305; AP100/MR100 raw305/final152.5; AP200/MR100 raw395/final197.5; damage 20221/add 20170; no explicit event op; mana180/AP100/HP1000/MR100 t0/t9999/t10000 success/skip/success two W damage items final mana60/HP695 two automatic W ability_started; mana59 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit d57dc3b; cast/Effect-at-cast-time-end/direction/range/missile/collision/cross/explosion/multitarget/AOE/sight/mark/ms/Vigilance/dodge/block/blind/DoT/spell-shield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-lucian-ardent-blaze-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_lucian_ardent_blaze_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_215_plus_0_90_ap; no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_shield_exception_other_ranks_or_full_fidelity; backend lol_generic_lucian_ardent_blaze_primary_hit_seed.sql + LolGenericLucianArdentBlazePrimaryHitSeedSqlTest (owning 2b29c4e; integrated 7e8a40c); Wasm exact test commit d57dc3b; external existing-data/check-only prerequisites (hero_lucian/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Lucian synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_lucian|R|圣枪洗礼',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Lucian R 圣枪洗礼/The Culling：Wiki request Template:Data Lucian/R → resolved Template:Data Lucian/The Culling；page1308182 / rev4007670 / timestamp 2026-04-12T10:40:21Z / canonical bytes4477 / SHA256 7a4679542eebdebf25da391a1222f08df2f416c641f48473d528e62296b9a2f7（normalized/generic/lucian-r.json plus pages sibling are authority）rank3 Phase-A v2 已由 wasm-generic-lucian-the-culling-single-shot-quantum + backend seed 证据闭环——local raw caveat bytes4477 / SHA b63612287a8a965e7655829a2054aec7b019705225fd7e7b4736303a172bc74d（canonical identity remains sidecar/pages；no equivalence or contradiction claim；equal size alone is not byte equality or source contradiction）；100 mana / 90000ms CD；immediate primary-champion first-enemy single physical shot-quantum scaffold；one immediate primary-champion single noncritical/noncopyable physical shot damage quantum 45 + 0.25 * source.attr.ad.resolved + 0.15 * source.attr.ap.resolved（exact nested binary add；total AD direct read；never bonus AD/subtraction；不得减 base AD，亦不得称为 bonus AD）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no explicit event op；ability_started is automatic）（交叉校验 baseAD0/resolvedAD0/AP0/armor0 raw=final45；baseAD60/resolvedAD60/AP0/armor0 raw=final60；baseAD60/resolvedAD160/AP0/armor0 raw=final85；baseAD60/resolvedAD160/AP100/armor0 raw=final100；baseAD60/resolvedAD160/AP100/armor100 raw100/final50；baseAD60/resolvedAD260/AP200/armor100 raw140/final70；baseAD0 vs baseAD60 at resolvedAD160/AP100/armor0 both raw/final100）。Attempts mana300/baseAD60/resolvedAD160/AP100/targetHP1000/armor100 at t0/t89999/t90000 → success/skip/success，exactly two R shot-quantum damage items；final mana100 and target HP900；exactly two automatic R ability_started；mana99 at t0 → resource skip with mana/HP unchanged and no R damage/event。Lucian R provider is standalone；Backend has no repository-owned hero_lucian / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Lucian Q/W dependence；不暗示 Batch-B 或 sibling Lucian synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Cursor focused9/adjacent53/full893 passed；Main focused9 and adjacent53 passed；first full run had one transient existing LolGenericKogmawLivingArtillerySeedSqlTest java.util.regex.StackOverflowError（884 tests, 1 error），then isolated Kog\'Maw test passed10/10 and fresh full run passed893/893（nonblocking validation-runtime caveat；not a Lucian R contract failure）。Wasm main validation passed gofmt/focused eight top-level Lucian R tests/full Go/bench/standard TinyGo build/Node smoke/generic benchmark；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity。明确排除 3-second channel/channel state、0.75-second/manual/automatic recast、22 base shots and crit-chance additional-shot count、total channel damage、cadence/fire-rate、direction/range/width、missile offsets/alternating guns/travel/collision/first-enemy geometry/multitarget、minion double、movement/ghosted/facing、spell shield、interrupts/E usability/Q-W lockout/Thresh/Tahm、ranks1-2、equipment/loadout/crit/on-hit、other Lucian abilities/siblings、live migration/publish/E2E、full The Culling/game fidelity；this is one damage quantum, not one total R hit or total ultimate damage；不宣称 channel/recast/shot-count/crit-scaling/fire-rate/direction/range/missile/collision/multitarget/minion-double/move/ghost/facing/spell-shield/interrupts/lockout/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_lucian/ad/ap/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-lucian-the-culling-single-shot-quantum',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_lucian_the_culling_single_shot_quantum_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity; Wiki request Template:Data Lucian/R → The Culling; rev4007670/SHA256 7a467954… / bytes4477; local raw caveat bytes4477/SHA b6361228… no equivalence claim; rank3 100 mana/90000ms CD / one physical shot quantum 45+0.25*totalAD+0.15*AP nested binary add; baseAD0/resolvedAD0/AP0/armor0=45; baseAD60/resolvedAD60/AP0/armor0=60; baseAD60/resolvedAD160/AP0/armor0=85; baseAD60/resolvedAD160/AP100/armor0=100; baseAD60/resolvedAD160/AP100/armor100 raw100/final50; baseAD60/resolvedAD260/AP200/armor100 raw140/final70; baseAD0 vs baseAD60 at resolvedAD160/AP100/armor0 both 100; damage 20220/add 20170; no explicit event op; mana300/baseAD60/resolvedAD160/AP100/HP1000/armor100 t0/t89999/t90000 success/skip/success two R shot-quantum damage items final mana100/HP900 two automatic R ability_started; mana99 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit ab2d9f7; channel/recast/shot-count/crit-scaling/fire-rate/direction/range/missile/collision/multitarget/minion-double/move/ghost/facing/spell-shield/interrupts/lockout/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-lucian-the-culling-single-shot-quantum',
          sourcePath: 'db/game_manage/seeds/lol_generic_lucian_the_culling_single_shot_quantum_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity; backend lol_generic_lucian_the_culling_single_shot_quantum_seed.sql + LolGenericLucianTheCullingSingleShotQuantumSeedSqlTest (owning a2f5bca; integrated d83b09e); Wasm exact test commit ab2d9f7; external existing-data/check-only prerequisites (hero_lucian/ad/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Lucian synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_caitlyn|R|让子弹飞',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Caitlyn R 让子弹飞/Ace in the Hole：Wiki request Template:Data Caitlyn/R → resolved Template:Data Caitlyn/Ace in the Hole；page1306918 / rev3982561 / timestamp 2026-01-09T09:02:59Z / canonical bytes3119 / SHA256 08b488c97fc694d9a3de711ffd4ea0b95fc1746c3a11b9c44b878844e586e8a8（normalized/generic/caitlyn-r.json plus pages sibling are authority）rank3 Phase-A v1 已由 wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum + backend seed 证据闭环——local raw caveat bytes3119 / SHA 015c1dbe8f02dd5ac354e6a6da6def878f1acccf788b1f599ee4bfd589e05003（canonical identity remains sidecar/pages；no equivalence or contradiction claim；equal size alone is not byte equality or source contradiction）；100 mana / 90000ms CD；immediate selected-primary-champion single physical bullet-quantum scaffold；one immediate selected-primary-champion single noncritical/noncopyable physical damage quantum 650 + 1.00 * (source.attr.ad.resolved - source.attr.ad.base)（exact nested binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable physical damage operation（damage type 20220 + add policy 20170；no explicit event op；ability_started is automatic）（交叉校验 base0/resolved0/armor0 raw=final650；base60/resolved60/armor0 raw=final650；base60/resolved160/armor0 raw=final750；base60/resolved160/armor100 raw750/final375；base60/resolved260/armor100 raw850/final425；base0/resolved100 versus base60/resolved160 armor0 both750）。Attempts mana300/baseAD60/resolvedAD160/HP1000/armor100 at t0/t89999/t90000 → success/skip/success，exactly two R damage items；final mana100/HP250；exactly two automatic R ability_started；mana99 at t0 → resource skip with mana/HP unchanged and no R damage/event。Caitlyn R provider is standalone；Backend has no repository-owned hero_caitlyn / AD / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Caitlyn Q/E dependence；不暗示 Batch-B 或 sibling Caitlyn synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Cursor focused9/adjacent27/full902 passed；Main focused and adjacent passed；default full twice hit an existing isolated LolGenericKogmawLivingArtillerySeedSqlTest java.util.regex.StackOverflowError，while isolated Kog\'Maw passed and main full passed902/902 with MAVEN_OPTS=-Xss4m（nonblocking validation-runtime caveat；not a Caitlyn R contract failure）。Wasm main validation passed gofmt/focused/full/bench/build/smoke/benchmark；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity。明确排除 channel/locks/reveal/self-reveal/cancel/refund/short cooldown、homing/projectile/travel/interception/first-enemy geometry、crit scaling、untargetable/resurrection/target death/corpse/sight radius、unit-target cancel conditions/ability lockout、ranks1-2、siblings/loadout/on-hit/live/full fidelity；this is exactly one selected-target quantum, not full R；不宣称 channel/reveal/homing/projectile/crit/untargetable/resurrection/corpse/sight/cancel/lockout/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_caitlyn/ad/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_caitlyn_ace_in_the_hole_single_bullet_quantum_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity; Wiki request Template:Data Caitlyn/R → Ace in the Hole; rev3982561/SHA256 08b488c9… / bytes3119; local raw caveat bytes3119/SHA 015c1dbe… no equivalence claim; rank3 100 mana/90000ms CD / one physical bullet quantum 650+1.00*bonusAD via nested binary sub(ad.resolved,ad.base); base0/resolved0/armor0=650; base60/resolved60/armor0=650; base60/resolved160/armor0=750; base60/resolved160/armor100 raw750/final375; base60/resolved260/armor100 raw850/final425; base0/resolved100 vs base60/resolved160 armor0 both750; damage 20220/add 20170; no explicit event op; mana300/baseAD60/resolvedAD160/HP1000/armor100 t0/t89999/t90000 success/skip/success two R damage items final mana100/HP250 two automatic R ability_started; mana99 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit 9fc57e7; channel/reveal/homing/projectile/crit/untargetable/resurrection/corpse/sight/cancel/lockout/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum',
          sourcePath:
            'db/game_manage/seeds/lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity; backend lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql + LolGenericCaitlynAceInTheHoleSingleBulletQuantumSeedSqlTest (owning f088e18; integrated 486b8d8); Wasm exact test commit 9fc57e7; external existing-data/check-only prerequisites (hero_caitlyn/ad/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Caitlyn synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_tristana|Q|急速射击',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Tristana Q 急速射击/Rapid Fire：Wiki request Template:Data Tristana/Q → resolved Template:Data Tristana/Rapid Fire；page1308522 / rev4026462 / timestamp 2026-06-09T21:59:03Z / canonical bytes872 / SHA256 f6465863035c4634510ecc96e9ee04f4a998d150871d88e498e6636e27a9d4da（normalized/generic/tristana-q.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed + backend seed 证据闭环——local raw caveat bytes866 / SHA db084b4142559f0775af841fe163e1b80880e2661b26b6d82fb26261e1f5d170（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；35 mana / 16000ms CD；self timed bonus attack speed scaffold；timed state rapid_fire_active max1/7000ms；attack_speed percent_add 1.20*rapid_fire_active；game-local type62013 ability/tristana_rapid_fire；listener empty AbilityRef and exact all-match started/source_owner/Q-type；no damage or explicit event op；ability_started is automatic（fixture AS0.60→1.32 through6999→0.60 at7000）。Attempts mana105 at t0/t15999/t16000 → success/skip/success，exactly two automatic Q ability_started；final mana35/AS1.32；mana34 at t0 → resource skip with mana/AS unchanged；R does not arm Q and Q causes no R damage。Tristana Q provider is standalone；Backend has no repository-owned hero_tristana / attack_speed / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Tristana P/W/E/Explosive Charge dependence；不暗示 Batch-B 或 sibling Tristana synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Cursor focused11/adjacent49/full922 passed；Main focused11/adjacent49/full922 passed。Wasm main validation passed gofmt/focused6/full/bench/build/smoke/benchmark；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot; no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity。明确排除 rank-up update、attack animation/windup、basic attack count/rotation、cooldown bypass/reset/direct state admin、other ranks、siblings/loadout/bootstrap、Q damage/heal/shield/control/repeat/explicit event、Buster Shot dependency/synthesis、live/full fidelity；不宣称 rank-up/animation/windup/basic-count/rotation/CD-bypass/other-ranks/siblings/Q-damage/Buster-Shot-dependence/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_tristana/attack_speed/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_tristana_rapid_fire_timed_bonus_attack_speed_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot; no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity; Wiki request Template:Data Tristana/Q → Rapid Fire; rev4026462/SHA256 f6465863… / bytes872; local raw caveat bytes866/SHA db084b41… no equivalence claim; rank5 35 mana/16000ms CD / timed rapid_fire_active 7000ms / attack_speed percent_add 1.20*rapid_fire_active; type62013 ability/tristana_rapid_fire; empty AbilityRef all-match started/source_owner/Q-type; no damage or explicit event op; AS0.60→1.32 through6999→0.60 at7000; mana105 t0/t15999/t16000 success/skip/success two automatic Q ability_started final mana35/AS1.32; mana34 resource skip unchanged; R does not arm Q and Q causes no R damage; standalone no sibling synthesis; Wasm exact test commit ddbca0f; rank-up/animation/windup/basic-count/rotation/CD-bypass/other-ranks/siblings/Q-damage/Buster-Shot-dependence/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed',
          sourcePath:
            'db/game_manage/seeds/lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot; no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity; backend lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql + LolGenericTristanaRapidFireTimedBonusAttackSpeedSeedSqlTest (owning abc7500; integrated 5d468bf); Wasm exact test commit ddbca0f; external existing-data/check-only prerequisites (hero_tristana/attack_speed/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Tristana synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_tristana|R|毁灭射击',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Tristana R 毁灭射击/Buster Shot：Wiki request Template:Data Tristana/R → resolved Template:Data Tristana/Buster Shot；page1308525 / rev4008205 / timestamp 2026-04-14T05:37:16Z / canonical bytes2385 / SHA256 2dff322949f442acc00a7074458fd5ed9bc542d6fd143b818a9a7151e117c058（normalized/generic/tristana-r.json plus pages sibling are authority）rank3 Phase-A v1 已由 wasm-generic-tristana-buster-shot-primary-hit + backend seed 证据闭环——local raw caveat bytes2382 / SHA 42e07f07f3188aada86d18d782c05d291f031dbbf92171e4a1120e828ebf8c7b（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；100 mana / 100000ms CD；immediate selected-primary-champion single magic hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable magic damage operation add(add(325,0.70*(source.attr.ad.resolved-source.attr.ad.base)),1.00*source.attr.ap.resolved)（exact nested binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable magic damage operation（damage type 20221 + add policy 20170；no explicit event op；ability_started is automatic）（交叉校验 base0/resolved0/AP0/MR0 raw=final325；base60/resolved60/AP0/MR0 raw=final325；base60/resolved160/AP0/MR0 raw=final395；base60/resolved160/AP100/MR0 raw=final495；base60/resolved160/AP100/MR100 raw495/final247.5；base60/resolved260/AP200/MR100 raw665/final332.5；base0/resolved100 versus base60/resolved160 AP100/MR0 both495）。Attempts mana300/baseAD60/resolvedAD160/AP100/HP1000/MR100 at t0/t99999/t100000 → success/skip/success，exactly two R damage items；final mana100/HP505；exactly two automatic R ability_started；mana99 at t0 → resource skip with mana/HP unchanged and no R damage/event。Tristana R provider is standalone；Backend has no repository-owned hero_tristana / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Tristana P/Q/W/E/Explosive Charge dependence；不暗示 Batch-B 或 sibling Tristana synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Cursor focused9/adjacent53/full911 passed；Main focused9/adjacent53/full911 passed。Wasm main validation passed gofmt/focused7/full/bench/build/smoke/benchmark；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_325_plus_0_70_bonus_ad_plus_1_00_ap; no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_other_ranks_or_full_fidelity。明确排除 cast time、knockback/stun/reveal、secondary zero damage/turret aggro、displacement/terrain/geometry/immunity、unit-target cancel、post-cast basic attack、Explosive Charge、ranks1-2、siblings/loadout/on-hit/live/full fidelity；this is exactly one selected-target magic hit, not full R；不宣称 cast/knockback/stun/reveal/secondary/terrain/displacement/immunity/unit-cancel/post-basic/Explosive-Charge/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_tristana/ad/ap/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-tristana-buster-shot-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_tristana_buster_shot_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_325_plus_0_70_bonus_ad_plus_1_00_ap; no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_other_ranks_or_full_fidelity; Wiki request Template:Data Tristana/R → Buster Shot; rev4008205/SHA256 2dff3229… / bytes2385; local raw caveat bytes2382/SHA 42e07f07… no equivalence claim; rank3 100 mana/100000ms CD / one magic 325+0.70*bonusAD+1.00*AP via nested binary add(add(325,0.70*(ad.resolved-ad.base)),1.00*ap.resolved); base0/resolved0/AP0/MR0=325; base60/resolved60/AP0/MR0=325; base60/resolved160/AP0/MR0=395; base60/resolved160/AP100/MR0=495; base60/resolved160/AP100/MR100 raw495/final247.5; base60/resolved260/AP200/MR100 raw665/final332.5; base0/resolved100 vs base60/resolved160 AP100/MR0 both495; damage 20221/add 20170; no explicit event op; mana300/baseAD60/resolvedAD160/AP100/HP1000/MR100 t0/t99999/t100000 success/skip/success two R damage items final mana100/HP505 two automatic R ability_started; mana99 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit b4d10e4; cast/knockback/stun/reveal/secondary/terrain/displacement/immunity/unit-cancel/post-basic/Explosive-Charge/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-tristana-buster-shot-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_tristana_buster_shot_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_325_plus_0_70_bonus_ad_plus_1_00_ap; no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_other_ranks_or_full_fidelity; backend lol_generic_tristana_buster_shot_primary_hit_seed.sql + LolGenericTristanaBusterShotPrimaryHitSeedSqlTest (owning 8b98bcb; integrated 30209c4); Wasm exact test commit b4d10e4; external existing-data/check-only prerequisites (hero_tristana/ad/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Tristana synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_tristana|W|火箭跳跃',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Tristana W 火箭跳跃/Rocket Jump：Wiki request Template:Data Tristana/W → resolved Template:Data Tristana/Rocket Jump；page1308523 / rev4007758 / timestamp 2026-04-12T14:13:05Z / canonical bytes2444 / SHA256 cf0e3ae91310ab5e7cc04408941671520e3464f75bc61da683b100ea82e56eec（normalized/generic/tristana-w.json plus pages sibling are authority）rank5 Phase-A v2 已由 wasm-generic-tristana-rocket-jump-primary-landing-hit + backend seed 证据闭环——local raw caveat bytes2443 / SHA 7283b2eb2020c20c6e48098e647ba4782b6dc134705c7c668d7e7279da1cabd9（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；50 mana / 14000ms CD；immediate selected-primary-champion single magic landing hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable magic damage operation add(add(210,1.00*(source.attr.ad.resolved-source.attr.ad.base)),0.50*source.attr.ap.resolved)（exact nested binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable magic damage operation（damage type 20221 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no W ability-specific type and no type62013）（交叉校验 base0/resolved0/AP0/MR0 raw=final210；base60/resolved60/AP0/MR0 raw=final210；base60/resolved160/AP0/MR0 raw=final310；base60/resolved160/AP100/MR0 raw=final360；base60/resolved160/AP100/MR100 raw360/final180；base60/resolved260/AP200/MR100 raw510/final255；base0/resolved100 versus base60/resolved160 AP100/MR0 both360）。Attempts mana150/baseAD60/resolvedAD160/AP100/HP1000/MR100 at t0/t13999/t14000 → success/skip/success，exactly two W damage items；final mana50/HP640；exactly two automatic W ability_started；mana49 at t0 → resource skip with mana/HP unchanged and no W damage/event。W does not arm Q and Q causes no W damage。Tristana W provider is standalone；Backend has no repository-owned hero_tristana / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Tristana P/Q/E/Explosive Charge/R dependence；不暗示 Batch-B 或 sibling Tristana synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Cursor focused10/adjacent57/full932 passed；Main focused10/adjacent57/full932 passed。Wasm main validation passed gofmt/focused7/full/bench/build/smoke/benchmark；built and Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write。completedBoundary：rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity。明确排除 dash/cast time/air time/landing delay、movement/geometry/range/speed/terrain/collision、AOE/radius350/secondary、slow/knockdown/grounded/spellshield、takedown/clone/Explosive Charge reset、cast-during-dash、other ranks、siblings/loadout/bootstrap/crit/on-hit/live/full fidelity；this is exactly one selected-target magic landing hit, not full W；不宣称 dash/cast/air-time/landing-delay/movement/geometry/AOE/slow/takedown/Explosive-Charge-reset/cast-during-dash/other-ranks/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_tristana/ad/ap/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-tristana-rocket-jump-primary-landing-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_tristana_rocket_jump_primary_landing_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity; Wiki request Template:Data Tristana/W → Rocket Jump; rev4007758/SHA256 cf0e3ae9… / bytes2444; local raw caveat bytes2443/SHA 7283b2eb… no equivalence claim; rank5 50 mana/14000ms CD / one magic 210+1.00*bonusAD+0.50*AP via nested binary add(add(210,1.00*(ad.resolved-ad.base)),0.50*ap.resolved); base0/resolved0/AP0/MR0=210; base60/resolved60/AP0/MR0=210; base60/resolved160/AP0/MR0=310; base60/resolved160/AP100/MR0=360; base60/resolved160/AP100/MR100 raw360/final180; base60/resolved260/AP200/MR100 raw510/final255; base0/resolved100 vs base60/resolved160 AP100/MR0 both360; damage 20221/add 20170; no 20230; no explicit event op; no W type/no type62013; mana150/baseAD60/resolvedAD160/AP100/HP1000/MR100 t0/t13999/t14000 success/skip/success two W damage items final mana50/HP640 two automatic W ability_started; mana49 resource skip unchanged; W does not arm Q and Q causes no W damage; standalone no sibling synthesis; Wasm exact test commit 9d2716c; dash/cast/air-time/landing-delay/movement/geometry/AOE/slow/takedown/Explosive-Charge-reset/cast-during-dash/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-tristana-rocket-jump-primary-landing-hit',
          sourcePath:
            'db/game_manage/seeds/lol_generic_tristana_rocket_jump_primary_landing_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity; backend lol_generic_tristana_rocket_jump_primary_landing_hit_seed.sql + LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest (owning 7cafeab; integrated ac304d3); Wasm exact test commit 9d2716c; external existing-data/check-only prerequisites (hero_tristana/ad/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Tristana synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_corki|Q|磷光炸弹',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Corki Q 磷光炸弹/Phosphorus Bomb：Wiki request Template:Data Corki/Q → resolved Template:Data Corki/Phosphorus Bomb；page1306953 / rev4007588 / timestamp 2026-04-12T06:50:59Z / canonical bytes1531 / SHA256 e71a474ef6b4df1df4808b397c8bd0f42ce284234f3eb7603fab09cabd760365（normalized/generic/corki-q.json plus pages sibling are authority）rank5 Phase-A v1 已由 wasm-generic-corki-phosphorus-bomb-primary-impact + backend seed 证据闭环——local raw caveat bytes1529 / SHA c39556a0d90226462e8a939ebe58888ec91325a9ca4d10be23e43dd77d948ba6（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；80 mana / 7000ms CD；immediate selected-primary-champion single magic impact hit scaffold；one immediate selected-primary-champion single noncritical/noncopyable magic damage operation add(add(const 240, mul(const 1.25, sub(read source.attr.ad.resolved, read source.attr.ad.base))), mul(const 1.00, read source.attr.ap.resolved))（exact nested binary formula；bonus AD by explicit subtraction；不得按 total-AD 直读，亦不得省略 base 相减）；exactly one noncrit/noncopyable magic damage operation（damage type 20221 + add policy 20170；no 20230；no explicit event op；ability_started is automatic；no Q ability-specific type）（交叉校验 base60/resolved60/AP0/MR0 raw=final240；base60/resolved160/AP0/MR0 raw=final365；base60/resolved60/AP100/MR0 raw=final340；base60/resolved160/AP100/MR0 raw=final465；base60/resolved156/AP100/MR100 raw460/final230；base60/resolved220/AP100/MR100 raw540/final270；base0/resolved100 versus base60/resolved160 AP0/MR0 both365）。Attempts mana240/baseAD60/resolvedAD156/AP100/HP1000/MR100 at t0/t6999/t7000 → success/skip/success，exactly two Q damage items；final mana80/HP540；exactly two automatic Q ability_started；mana79 at t0 → resource skip with mana/HP unchanged and no Q damage/event。Corki Q provider is standalone；Backend has no repository-owned hero_corki / AD / AP / mana materializer；record external existing-data/check-only prerequisites only；不暗示 Corki P/W/E/R dependence；不暗示 Batch-B 或 sibling Corki synthesis；不暗示任何 production runtime/ABI/Web change。Backend validation honesty：Main focused75/full975 passed。Wasm main validation passed gofmt/focused/full/bench/build/smoke/benchmark；built and independent Web asset both 1169377 bytes/SHA256 65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0 with no Web write（embedded web/ copy is a wrong-path validation caveat, not independent Web parity failure）。completedBoundary：rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_other_ranks_or_full_fidelity。明确排除 cast time/location targeting/range/radius/geometry、projectile travel/minimum travel time/explosion、AOE/multitarget/surrounding、travel/impact-area sight、enemy-champion reveal/six-second duration、spellshield、collision/acquisition、other ranks、siblings/loadout/bootstrap/crit/on-hit/live/full fidelity；this is exactly one selected-primary magic impact hit, not full Q；不宣称 cast/location/range/radius/geometry/projectile/travel/minimum-time/explosion/AOE/multitarget/collision/acquisition/spellshield/sight/reveal/duration/other ranks/siblings/live/完整游戏保真。Backend seed 显式依赖 external existing-data/check-only 前置（hero_corki/ad/ap/mana），不物化 identity/panel/resource values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-corki-phosphorus-bomb-primary-impact',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_corki_phosphorus_bomb_primary_impact_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_other_ranks_or_full_fidelity; Wiki request Template:Data Corki/Q → Phosphorus Bomb; rev4007588/SHA256 e71a474e… / bytes1531; local raw caveat bytes1529/SHA c39556a0… no equivalence claim; rank5 80 mana/7000ms CD / one magic 240+1.25*bonusAD+1.00*AP via nested binary add(add(240,1.25*(ad.resolved-ad.base)),1.00*ap.resolved); base60/resolved60/AP0/MR0=240; base60/resolved160/AP0/MR0=365; base60/resolved60/AP100/MR0=340; base60/resolved160/AP100/MR0=465; base60/resolved156/AP100/MR100 raw460/final230; base60/resolved220/AP100/MR100 raw540/final270; base0/resolved100 vs base60/resolved160 AP0/MR0 both365; damage 20221/add 20170; no 20230; no explicit event op; no Q type; mana240/baseAD60/resolvedAD156/AP100/HP1000/MR100 t0/t6999/t7000 success/skip/success two Q damage items final mana80/HP540 two automatic Q ability_started; mana79 resource skip unchanged; standalone no sibling synthesis; Wasm exact test commit b381b1e bytes65821/SHA 58f47763…; cast/location/range/radius/geometry/projectile/travel/minimum-time/explosion/AOE/multitarget/sight/reveal/duration/spellshield/other-ranks/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-corki-phosphorus-bomb-primary-impact',
          sourcePath:
            'db/game_manage/seeds/lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_other_ranks_or_full_fidelity; backend lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql + LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest (owning 6003a7e; integrated b352677); Wasm exact test commit b381b1e; external existing-data/check-only prerequisites (hero_corki/ad/ap/mana; does not write identity/panel/resource values); standalone no Batch-B or sibling Corki synthesis; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_kayle|Q|耀焰冲击',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Kayle Q 耀焰冲击/Radiant Blast：Wiki rev4005105（SHA256 ded516de4861d88de21ba54de9a8723b654f424f1cc3f9dac30d06382ee1a87c；normalized/generic/kayle-q.json）rank5 Phase-A 主目标 1v1 已由 wasm-generic-kayle-radiant-blast + backend seed 证据闭环——魔法伤害 180+0.60*(ad.resolved-ad.base)+0.50*ap.resolved；先伤后击碎；provider-target kayle_q_sundered（default0/max1/4000ms refresh_on_write）→ opponent armor/MR percent_add −15%；100 mana / 8000ms CD。明确排除 slow、portal launch delay、attack-windup cast time、projectile travel/collision、cross expansion/secondary targets、ranks1–4、death persistence、live migration/publish/E2E/完整技能保真，故标 completed。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kayle-radiant-blast',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_kayle_radiant_blast_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: Wiki rev4005105 rank5 Phase-A primary-target magic+shred/cost/CD; damage-before-state; test-only probes; excluded slow/portal/windup/projectile/cross/secondary/ranks1-4/death persistence/live/E2E',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kayle-radiant-blast',
          sourcePath: 'db/game_manage/seeds/lol_generic_kayle_radiant_blast_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: provider_hero_kayle_radiant_blast Phase-A seed; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_kogmaw|Q|腐蚀唾液',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        "Kog'Maw Q 腐蚀唾液/Caustic Spittle：Wiki rev3960434（SHA256 f651035612e1deeda77df641f5a0e21226ec74aeb4633e0f211780efc3f39a7d）rank5 口径与 wasm-generic-kogmaw-caustic-spittle + backend seed 证据闭环——被动常驻 +25% AS；主动 260+0.90*AP 魔法伤害（Effect at cast time start：先伤后击碎）；provider-target kogmaw_q_resist_reduction（default0/max1/4000ms refresh_on_write）驱动 opponent armor/MR percent_add −32%；40 mana / 7000ms CD。明确排除弹道飞行/目标选择、rank1–4、多目标/web，故标 completed。",
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kogmaw-caustic-spittle',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_caustic_spittle_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: Wiki rev3960434 rank5 passive +25% AS + active magic/shred/cost/CD; damage-before-state; excluded projectile/rank1-4/multitarget/web',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kogmaw-caustic-spittle',
          sourcePath: 'db/game_manage/seeds/lol_generic_kogmaw_caustic_spittle_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: provider_hero_kogmaw_caustic_spittle seed/mount path; active Q proven via wasm; not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_kogmaw|E|虚空淤泥',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        "Kog'Maw E 虚空淤泥/Void Ooze：Wiki rev3965135（SHA256 1dd448ea1985237f002dec43e2bf93d860eb976f7c98e75883254cb3cf70794b；normalized/generic/kogmaw-e.json）rank5 Phase-A v1 已由 wasm-generic-kogmaw-void-ooze-primary-hit + backend seed 证据闭环——100 mana / 12000ms CD；immediate primary-target scaffold（Wiki Effect at cast time start 与 scaffold 兼容，无假 cast-delay phase）；恰好一次 non-crit/non-copyable magic damage 230+0.65*source.attr.ap.resolved（交叉校验 AP100 → raw295，target MR100 → mitigated147.5）。Attempts t0/t11999/t12000 → two successes + exactly one cooldown skip without mana/damage；final mana 125 from 325。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration。明确排除 target-direction missile/projectile/travel/collision/path/range/width/speed/geometry、all-enemies/multi-target/repeated hits、ooze field/path blobs/every125 units/3s duration、slow60%/0.25s ticks/linger、cast timing beyond scaffold、ranks1–4、basic/W/Q/on-hit/equipment/loadout coupling、live/publish/E2E/full fidelity；不宣称 line/area/field/slow/projectile 保真，故标 completed。",
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kogmaw-void-ooze-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_void_ooze_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration; Wiki rev3965135/SHA256 1dd448ea… rank5 100 mana/12000ms CD / one magic 230+0.65*AP; AP100→raw295/MR100→147.5; t0/t11999/t12000 two successes + one CD skip; final mana125; Effect at cast time start compatible with scaffold; projectile/geometry/multitarget/slow/field/duration/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kogmaw-void-ooze-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_kogmaw_void_ooze_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration; backend lol_generic_kogmaw_void_ooze_primary_hit_seed.sql + LolGenericKogmawVoidOozePrimaryHitSeedSqlTest (owning b1752e4; integrated 24c1ddf); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_kogmaw|R|活体大炮',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        "Kog'Maw R 活体大炮/Living Artillery：Wiki request Template:Data Kog'Maw/R → resolved Template:Data Kog'Maw/Living Artillery；page1307963 / rev4007636 / timestamp 2026-04-12T08:34:32Z / canonical bytes2453 / SHA256 32f8dd8d875aaf95cec2be9cfe4a5a5526881b956f2f23e06ab87dc331ca8641（normalized/generic/kogmaw-r.json）rank3 Phase-A v2 已由 wasm-generic-kogmaw-living-artillery + backend seed 证据闭环——local raw caveat bytes2452 / SHA 11db6c16391dcbfa2c091e81399bff4b2a0abffcd468f71ea5e9d89759d5e447（canonical identity remains sidecar/pages；no equivalence or contradiction claim）；mana cost 40*(1+living_artillery_stacks) / 1000ms CD；immediate primary-target scaffold；zero listeners/ability-start dependency；base magic 180+0.75*(resolvedAD-baseAD)+0.45*AP；missing-health multiplier 1+min(0.5,(5/6)*missingFraction) at/above 40% current HP，exactly 2 below 40%；fixture baseAD61/resolvedAD141/AP100 → base285；maxHP1000/MR100：current1000 raw285/mitigated142.5；current400 raw427.5/mitigated213.75；current399 raw570/mitigated285。Schedule：t0/t999/t1000 mana500 → two successes + one cooldown skip，costs40 then80，final mana380/state2；mana119 → first cost40 then resource skip，final mana79/state1/no second damage/write；ten successes cost40..400 total2200 cap9；8000ms lazy expiry and refresh covered。completedBoundary：rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth。明确排除 0.6s delay、location/range/radius/projectile/arc/collision/travel/area/multi-target、sight/reveal/stealth、ranks1–2、P/Q/W/E/basic/combo、equipment/runes/loadout、spell shield、animation、live migration/publish/browser E2E/full-game fidelity；不宣称 delay/location/geometry/multitarget/sight/reveal/stealth/完整游戏保真，故标 completed。",
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kogmaw-living-artillery',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_living_artillery_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth; Wiki request Template:Data Kog\'Maw/R → Living Artillery; rev4007636/SHA256 32f8dd8d… / bytes2453; local raw caveat bytes2452/SHA 11db6c16… no equivalence claim; rank3 mana 40*(1+living_artillery_stacks)/1000ms CD; zero listeners/ability-start; base 180+0.75*bonusAD+0.45*AP nested binary add; missing-HP multiplier 1+min(0.5,(5/6)*missingFraction) ≥40% HP else exactly 2; fixture baseAD61/resolvedAD141/AP100→base285; maxHP1000/MR100 current1000→285/142.5 current400→427.5/213.75 current399→570/285; t0/t999/t1000 mana500 two successes+one CD skip costs40→80 mana380/state2; mana119 first40 then resource skip mana79/state1; ten successes 40..400 total2200 cap9; 8000ms lazy expiry/refresh; Wasm exact test commit d58370a; delay/location/geometry/multitarget/sight/reveal/stealth/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kogmaw-living-artillery',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_provider_state_cost_gate_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth; provider-aware dynamic cost gate regression (const/dynamic cost, resource_insufficient, lazy expiry, malformed ref fail-closed, zero listeners/ability-start); Wasm commit d58370a',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-kogmaw-living-artillery',
          sourcePath: 'db/game_manage/seeds/lol_generic_kogmaw_living_artillery_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth; backend lol_generic_kogmaw_living_artillery_seed.sql + LolGenericKogmawLivingArtillerySeedSqlTest (owning 100679a + nested-binary correction 473bd50; integrated 175b03a + correction d563b67); three-argument add corrected to nested binary add (do not endorse incompatible formula); Wasm exact test commit d58370a; Web asset sync 38b9229 artifact parity only (not bilateral substitute); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_varus|E|恶灵箭雨',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Varus E 恶灵箭雨/Hail of Arrows：Wiki rev3969402（SHA256 7b4be71bcc26ba933dff0235882d272c14e406abbf505290018ba15a5ba658e9；normalized/generic/varus-e.json）rank5 Phase-A v1 已由 wasm-generic-varus-hail-of-arrows-primary-hit + backend seed 证据闭环——90 mana / 10000ms CD；immediate primary-target scaffold（明确排除而非建模 Wiki 0.5s landing delay）；恰好一次 non-crit/non-copyable physical damage 180+0.90*(source.attr.ad.resolved-source.attr.ad.base)（交叉校验 baseAD59 / resolvedAD159 → raw270，armor100 → mitigated135）。Attempts t0/t9999/t10000 → two successes + exactly one cooldown skip without mana/damage；final mana 140 from 320。同修订 description + labeled rank table 明示 physical damage 60 to 180 (+90% bonus AD)；孤立 damagetype=Magic 为矛盾源元数据——reviewed 政策以 description+rank table 管辖本有界 physical 分支，绝不将 Magic 作 runtime 真值。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation。明确排除 cast0.2419/landing0.5/travel timing、target-location/projectile/range925/radius300/collision/geometry、all-enemies/multi-target/repeat、four-second field、slow30–50%/0.25s linger、Grievous Wounds、all Blighted Quiver stack consumption/~0.3s second detonation/W/Q/basic/on-hit coupling、ranks1–4、equipment/loadout、live/publish/E2E/full fidelity；不宣称 delay/area/field/control/W-detonation 保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-varus-hail-of-arrows-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_varus_hail_of_arrows_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation; Wiki rev3969402/SHA256 7b4be71b… rank5 90 mana/10000ms CD / one physical 180+0.90*bonusAD; baseAD59/resolvedAD159→raw270/armor100→135; t0/t9999/t10000 two successes + one CD skip; final mana140; description+rank-table physical authority; isolated damagetype=Magic contradictory metadata (not runtime truth); immediate scaffold excludes Wiki 0.5s landing delay; landing/geometry/multitarget/field/slow/GW/W-detonation/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-varus-hail-of-arrows-primary-hit',
          sourcePath: 'db/game_manage/seeds/lol_generic_varus_hail_of_arrows_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation; backend lol_generic_varus_hail_of_arrows_primary_hit_seed.sql + LolGenericVarusHailOfArrowsPrimaryHitSeedSqlTest (owning a08cdfd; integrated e924afd); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_varus|R|腐败锁链',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Varus R 腐败锁链/Chain of Corruption：Wiki rev4008213（SHA256 62b397cc7133a767427e00a1a5b435fcb3fd94b4ec5021be4a7869837683e4ed；normalized/generic/varus-r.json）rank3 Phase-A v1 已由 wasm-generic-varus-chain-of-corruption-primary-hit + backend seed 证据闭环——100 mana / 60000ms CD；immediate primary-champion scaffold（明确排除而非建模 Wiki 未指定 cast delay 与 Effect at cast time end）；恰好一次 non-crit/non-copyable magic damage 350+1.00*source.attr.ap.resolved（交叉校验 AP200 → raw550，target MR100 → mitigated275）。Attempts t0/t59999/t60000 → two successes + exactly one cooldown skip without mana/damage；final mana 100 from 300；HP 1000→450。completedBoundary：rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget。明确排除 unspecified cast delay/Effect-at-cast-time-end、projectile/travel/speed/collision/global geometry/direction/facing/interception/spellshield/untargetable、root/reveal/tenacity/cleanse/CC immunity、Blight creation and 0.65/1.2/1.75 schedule/rank0/W coupling/detonation/state、tendril ground anchor/0.25 seeking/range/area/secondary/repeat/spread/multitarget、ranks1–2、P/Q/W/E/basic/loadout、live/publish/E2E/full fidelity；不宣称 cast/projectile/geometry/direction/root/reveal/Blight/tendril/seek/spread/multitarget 保真。Backend seed 显式依赖 Batch-B identity/AP check-only 前置，并自包含 ensure mana 定义与 hero_varus mana320/320；不写 games/game_entities/attribute_definitions/entity_attribute_values，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-varus-chain-of-corruption-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_varus_chain_of_corruption_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget; Wiki rev4008213/SHA256 62b397cc… rank3 100 mana/60000ms CD / one magic 350+1.00*AP; AP200→raw550/MR100→275; t0/t59999/t60000 two successes + one CD skip; final mana100/HP450; immediate scaffold excludes unspecified cast delay and Effect at cast time end; cast/projectile/travel/collision/geometry/direction/root/reveal/Blight/tendril/seek/spread/multitarget/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-varus-chain-of-corruption-primary-hit',
          sourcePath:
            'db/game_manage/seeds/lol_generic_varus_chain_of_corruption_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget; backend lol_generic_varus_chain_of_corruption_primary_hit_seed.sql + LolGenericVarusChainOfCorruptionPrimaryHitSeedSqlTest (owning 067b0f8; integrated 982145c); Wasm exact test commit 74f3b22; Batch-B identity/AP check-only prerequisites + self-contained ensure mana definition/hero_varus mana320/320 (does not write games/game_entities/attribute_definitions/entity_attribute_values); not live published',
        },
      ],
    },
  ],
  [
    'hero_skill|hero_twistedfate|Q|万能牌',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'Twisted Fate Q 万能牌/Wild Cards：Wiki rev3950864（SHA256 9cdd62cc18d41a4bbe1e42ac8202b40a776f7da51c67c6f2fea37f9ed1f0d597；normalized/generic/twistedfate-q.json）rank5 Phase-A v2 已由 wasm-generic-twisted-fate-wild-cards-primary-hit + backend seed 证据闭环——100 mana / 5000ms CD；immediate primary-target scaffold（明确排除而非建模 Wiki cast0.25 与 Effect at cast time end）；恰好一次 non-crit/non-copyable magic damage 240+0.50*(source.attr.ad.resolved-source.attr.ad.base)+0.85*source.attr.ap.resolved（交叉校验 baseAD52 / resolvedAD100 / AP100 → raw349，target MR100 → mitigated174.5）。Attempts t0/t4999/t5000 → two successes + exactly one cooldown skip without mana/damage；final mana 133 from 333；HP 1000→651。Wiki once-per-pass 仅为单次直击主目标的源正当化，不宣称 runtime pass/projectile/collision 保真。completedBoundary：rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget。明确排除 cast0.25/effect-at-cast-end、fan/three cards/cone/angles、direction、projectile/travel/collision/pass、range1450/width80/speed1000/geometry、AOE/multitarget/repeat、spellshield、ranks1–4、W/E/basic/Stacked Deck/on-hit/equipment/loadout、live/publish/E2E/full fidelity；不宣称 cast/fan/cone/projectile/pass/geometry/AOE/multitarget 保真，故标 completed。',
      blocker: '',
      dataGapEvidence: null,
      runtimeGapEvidence: null,
      outOfScopeEvidence: null,
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-twisted-fate-wild-cards-primary-hit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_twisted_fate_wild_cards_primary_hit_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget; Wiki rev3950864/SHA256 9cdd62cc… rank5 100 mana/5000ms CD / one magic 240+0.50*(ad.resolved-ad.base)+0.85*AP; baseAD52/resolvedAD100/AP100→raw349/MR100→174.5; t0/t4999/t5000 two successes + one CD skip; final mana133/HP651; once-per-pass justifies single direct hit only (not runtime pass fidelity); immediate scaffold excludes Wiki cast0.25 and Effect at cast time end; cast/fan/cone/projectile/pass/geometry/AOE/multitarget/live/E2E/full-game fidelity intentionally outside Phase-A',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-twisted-fate-wild-cards-primary-hit',
          sourcePath:
            'db/game_manage/seeds/lol_generic_twisted_fate_wild_cards_primary_hit_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget; backend lol_generic_twisted_fate_wild_cards_primary_hit_seed.sql + LolGenericTwistedFateWildCardsPrimaryHitSeedSqlTest (owning 18b959e; integrated a0da4f8); Wasm exact test commit 589db93; not live published',
        },
      ],
    },
  ],
  [
    'item_passive|2510|item_passive|咒刃',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'item 2510 黄昏与黎明/Dusk and Dawn 咒刃：League Wiki item manifest revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d；完成 exact 合同——10s ready；原魔法伤害 0.75 base AD + 0.10 resolved AP；原自身治疗 0.10 AP + 0.03 bonus HP；强化命中后 +200ms 一次 canonical copyable-on-hit replay；1.5s ICD 自强化命中开始；自身 Spellblade 伤害 non-copyable；共享 ready gate/无递归；故标 completed/full。已由 generic_dusk_and_dawn_spellblade_test.go + backend lol_generic_dusk_and_dawn_spellblade_seed.sql / LolGenericDuskAndDawnSpellbladeSeedSqlTest + Web combatDataAssembler.test.ts delayMs=200→repeatDelayMs 投影闭环；不声称 live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-dusk-and-dawn-spellblade',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_dusk_and_dawn_spellblade_test.go',
          sourceWorktree: 'wasm',
          note: 'Dusk and Dawn Spellblade exact: 10s ready; magic 0.75*baseAD+0.10*AP; heal 0.10*AP+0.03*bonusHP; +200ms copyable-on-hit; 1.5s ICD; own damage non-copyable; shared ready/no recursion; not live published',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-dusk-and-dawn-spellblade',
          sourcePath: 'db/game_manage/seeds/lol_generic_dusk_and_dawn_spellblade_seed.sql',
          sourceWorktree: 'backend',
          note: 'backend seed + LolGenericDuskAndDawnSpellbladeSeedSqlTest; Web combatDataAssembler.test.ts delayMs=200→repeatDelayMs; not claiming live migrate/publish',
        },
      ],
    },
  ],
  [
    'item_passive|3748|item_passive|顺劈|数据参考/item.json#data.3748|71fa0f0c',
    {
      status: 'out_of_scope',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason:
        '主目标 on-hit 分支已完成；剩余 cleave/主动分支为多目标/范围，超出单目标范围。',
      blocker: 'multi_target_cleave_and_active_out_of_single_target_scope',
      outOfScopeEvidence: {
        sourceRef:
          '最小验证/generic-g8-adc-passive-coverage-audit.json#item_passive|3748|item_passive|顺劈|数据参考/item.json#data.3748|71fa0f0c',
        sourceTextSummary: '攻击附带物理伤害并对目标身后的敌人们造成物理伤害。',
        reviewedPrimaryTargetDamageBranch: true,
        boundaryCategory: 'completed_primary_branch_remaining_component',
        excludedBehavior: 'remaining_multi_target_cleave_after_primary_complete',
        boundaryReason: '顺劈：主目标伤害分支已完成；剩余为多目标/范围 component，审计边界外。',
        damageRelevantSubBranchDisposition: 'sibling_primary_completed_remaining_oos',
      },
    },
  ],
  [
    'item_passive|3748|item_passive|顺劈|数据参考/item.json#data.3748|020f8b5a',
    {
      status: 'out_of_scope',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason:
        '主目标 on-hit 分支已完成；剩余 cleave/主动分支为多目标/范围，超出单目标范围。',
      blocker: 'multi_target_cleave_and_active_out_of_single_target_scope',
      outOfScopeEvidence: {
        sourceRef:
          '最小验证/generic-g8-adc-passive-coverage-audit.json#item_passive|3748|item_passive|顺劈|数据参考/item.json#data.3748|020f8b5a',
        sourceTextSummary: '，使其造成额外物理伤害 攻击特效并对目标身后的敌人们造成额外物理伤害。',
        reviewedPrimaryTargetDamageBranch: true,
        boundaryCategory: 'completed_primary_branch_remaining_component',
        excludedBehavior: 'remaining_multi_target_cleave_after_primary_complete',
        boundaryReason: '顺劈：主目标伤害分支已完成；剩余为多目标/范围 component，审计边界外。',
        damageRelevantSubBranchDisposition: 'sibling_primary_completed_remaining_oos',
      },
    },
  ],
  [
    'item_passive|2523|item_passive|奥术瞄准',
    {
      status: 'out_of_scope',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        '2523 Arcane Aim/奥术瞄准：takedown 后 +100 攻击距离持续 8 秒，无伤害增量；审计边界外。同装备 Magnification/高倍望远镜为独立完成口径，不得合并。',
      blocker: '',
    },
  ],
  [
    'item_passive|2523|item_passive|高倍望远镜',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        '2523 Magnification/高倍望远镜：用户批准 fixed-max 口径——每个 eligible basic-damage instance 使用最大 1.10 outgoing pre-mitigation multiplier；wasm-generic-pipeline-damage-modifier + backend lol_generic_pipeline_damage_items_seed.sql 闭环。距离分段为用户排除分支，非 blocker；奥术瞄准仍单独 out_of_scope。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-pipeline-damage-modifier',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_pipeline_damage_modifier_test.go',
          sourceWorktree: 'wasm',
          note: 'user-approved Magnification fixed-max 1.10; excluded runtime distance scaling',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-pipeline-damage-modifier',
          sourcePath: 'db/game_manage/seeds/lol_generic_pipeline_damage_items_seed.sql',
          sourceWorktree: 'backend',
          note: 'Magnification fixed-max 1.10 seed; distance branch out of scope',
        },
      ],
    },
  ],
  [
    'item_passive|3036|item_passive|巨人杀手',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        '3036 Giant Slayer/巨人杀手：Wiki 目标 bonus health 每 100 +1% 最多 15%（1500）outgoing damage amp；wasm-generic-pipeline-damage-modifier + backend lol_generic_pipeline_damage_items_seed.sql 闭环——bonus HP 0/400/1500/2000 → 100/104/115/115；当前 1v1 max-base 代理（target.attr.hp.max - target.attr.hp.base）；不声称 non-champion 过滤或 live publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-pipeline-damage-modifier',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_pipeline_damage_modifier_test.go',
          sourceWorktree: 'wasm',
          note: 'Giant Slayer Wiki 1%/100 cap15; bonusHP 0/400/1500/2000 → 100/104/115/115; source-owned outgoing_pre_mitigation; current 1v1 max-base proxy; no non-champion filter/live publish claim',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-pipeline-damage-modifier',
          sourcePath: 'db/game_manage/seeds/lol_generic_pipeline_damage_items_seed.sql',
          sourceWorktree: 'backend',
          note: 'Giant Slayer 1%/100 cap15 seed; 100/104/115/115; max-base proxy; no non-champion filter/live publish claim',
        },
      ],
    },
  ],
  [
    'item_passive|6696|item_passive|涌动',
    {
      status: 'out_of_scope',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        '6696 Flux/涌动：takedown 后返还 ultimate total cooldown（含 lethality 缩放），纯冷却轮转无伤害增量；审计边界外。',
      blocker: '',
    },
  ],
  [
    'item_passive|2512|item_passive|开战弹幕',
    {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason:
        'item 2512 开战弹幕/Opening Barrage：League Wiki Module:ItemData/data revid 4030984 / hash e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d（current-items.normalized.json#item_2512_Opening_Barrage）；classic 8s 窗 / next 3 BA / +50% bonus AS / forced expected-crit×0.80 / natural expected-crit 附加 0.15*naturalBranchRawAmount*originalCritChance pre-mitigation true / 45s CD。已由 generic_fiendhunter_bolts_2512_test.go + backend lol_generic_fiendhunter_bolts_2512_seed.sql / LolGenericFiendhunterBolts2512SeedSqlTest 双边闭环。明确排除 Night Vigil ultimate haste、Arena 222512、Web castOrigin projection（arm matcher 使用 ability/ultimate），故标 completed/full；不声称 live migrate/publish。',
      blocker: '',
      evidenceRefs: [
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-min-validation-coverage-audit',
          sourcePath:
            'wasm/tinygo_engine_v2/internal/runtime/generic_fiendhunter_bolts_2512_test.go',
          sourceWorktree: 'wasm',
          note: 'completedBoundary: classic Opening Barrage ultimate arm / 8s / 3 charges / +50% AS / forced expected-crit 0.80 / natural 0.15 true / 45s CD; excluded Night Vigil / Arena 222512 / Web castOrigin',
        },
        {
          evidenceType: 'generic_batch',
          taskKey: 'wasm-generic-min-validation-coverage-audit',
          sourcePath: 'db/game_manage/seeds/lol_generic_fiendhunter_bolts_2512_seed.sql',
          sourceWorktree: 'backend',
          note: 'completedBoundary: Opening Barrage seeded + LolGenericFiendhunterBolts2512SeedSqlTest; excluded Night Vigil / Arena 222512 / Web castOrigin; not claiming live migrate/publish',
        },
      ],
    },
  ],
]);


/**
 * Per-key runtimeGapEvidence for final blocked_runtime rows (verifiable, non-empty missingPrimitives).
 * blocker must be stable English primitive key(s); never seed/mount/publish/E2E.
 */
function makeRuntimeGapEvidence(spec) {
  const missingPrimitives = [...(spec.missingPrimitives || [])];
  if (!missingPrimitives.length) {
    throw new Error(`runtimeGapEvidence missingPrimitives empty @ ${spec.key || '?'}`);
  }
  const evidence = {
    sourceRef: spec.sourceRef,
    dataStatus: spec.dataStatus,
    requiredEvents: [...(spec.requiredEvents || [])],
    requiredState: [...(spec.requiredState || [])],
    requiredFormulaInputs: [...(spec.requiredFormulaInputs || [])],
    requiredScheduling: [...(spec.requiredScheduling || [])],
    missingPrimitives,
    remainingBoundary: spec.remainingBoundary || '',
  };
  if (spec.dataStatus === 'partial' || spec.completedBoundary) {
    evidence.completedBoundary = spec.completedBoundary || '';
  }
  return {
    reason: spec.reason,
    blocker: spec.blocker || missingPrimitives.join('+'),
    runtimeGapEvidence: evidence,
  };
}

const RUNTIME_GAP_SPEC_TABLE = {
  "hero_skill|hero_xayah|P|锐切": {
    "sourceRef": "数据参考/lol-wiki-current-champions/normalized/generic/xayah-p.json",
    "dataStatus": "complete",
    "requiredEvents": [
      "ability_cast",
      "basic_attack_hit",
      "feather_created",
      "feather_consumed_by_e"
    ],
    "requiredState": [
      "ability_after_next_attacks_budget",
      "feather_positions"
    ],
    "requiredFormulaInputs": [
      "piercing_secondary_target_hit"
    ],
    "requiredScheduling": [
      "post_ability_attack_budget_window"
    ],
    "missingPrimitives": [
      "ability_after_next_attacks_budget",
      "piercing_secondary_targets",
      "feather_creation_position_resource",
      "feather_consumed_by_e_dependency"
    ],
    "remainingBoundary": "主目标无额外伤害；作为 E feather-damage dependency 保留 runtime：技能后普攻预算、穿透次级目标、羽毛创建/位置/E 消费。",
    "reason": "Xayah P Clean Cuts：ability-after next attacks budget、piercing secondary targets、feather creation/position/resource consumed by E；主目标无额外伤害，但作为 E damage dependency 保留 runtime。",
    "blocker": "ability_after_next_attacks_budget+piercing_secondary_targets+feather_creation_position_resource+feather_consumed_by_e_dependency"
  },
  "hero_skill|hero_akshan|P|无所不用": {
    "sourceRef": "数据参考/lol-wiki-current-champions/normalized/reviewed-contracts.json#akshan-p",
    "dataStatus": "partial",
    "requiredEvents": [
      "basic_attack_hit",
      "accurate_ability_hit"
    ],
    "requiredState": [
      "dirty_fighting_stacks"
    ],
    "requiredFormulaInputs": [
      "ability_power",
      "champion_level",
      "attack_damage"
    ],
    "requiredScheduling": [],
    "missingPrimitives": [
      "accurate_ability_hit_event_wiring"
    ],
    "completedBoundary": "AA Dirty Fighting core closed: CompileFrame→session→RunFrame→ReleaseSessionFrame; typed physical BA; dirty_fighting_stacks 0/max3/5000ms refresh-on-write; third-stack magic 15/40/80/150@1/6/11/16 +60% AP consume-reset; armor/MR/AP thresholds; refresh/expiry; fourth-from-zero; one basic_attack_hit per attack",
    "remainingBoundary": "技能命中亦叠层，但 exact generic ability-hit event wiring 未建立；不得用 ability_started 替代。英雄护盾与取消第二发移速及换目标/小兵/多目标非核心分支 out of damage scope。",
    "reason": "Akshan P Dirty Fighting：技能命中叠层缺 accurate_ability_hit_event_wiring（不得用 ability_started 替代）。",
    "blocker": "accurate_ability_hit_event_wiring"
  },
  "item_passive|2051|item_passive|无畏": {
    "sourceRef": "数据参考/lol-wiki-current-items/current-items.normalized.json#item_2051_Undaunted",
    "dataStatus": "complete",
    "requiredEvents": [
      "incoming_champion_damage"
    ],
    "requiredState": [
      "target_owned_incoming_damage_intercept"
    ],
    "requiredFormulaInputs": [
      "flat_15_reduction",
      "dot_3_75_reduction",
      "damage_category",
      "post_mitigation_ordering"
    ],
    "requiredScheduling": [],
    "missingPrimitives": [
      "target_owned_incoming_champion_damage_interception",
      "flat15_and_dot_3_75_reduction",
      "damage_category_post_mitigation_ordering"
    ],
    "remainingBoundary": "缺目标侧 incoming champion damage interception（flat15 / DoT 3.75）与 damage category/post-mitigation ordering。",
    "reason": "2051 Undaunted：target-owned incoming champion damage interception，flat15；DoT 3.75；damage category/post-mitigation ordering。",
    "blocker": "target_owned_incoming_champion_damage_interception+flat15_and_dot_3_75_reduction+damage_category_post_mitigation_ordering"
  },
  "item_passive|3032|item_passive|疾风骤雨": {
    "sourceRef": "数据参考/lol-wiki-current-items/current-items.normalized.json#item_3032_Flurry",
    "dataStatus": "complete",
    "requiredEvents": [
      "attack_launch_vs_champion",
      "on_hit",
      "critical_strike"
    ],
    "requiredState": [
      "flurry_attack_speed_buff",
      "flurry_cooldown"
    ],
    "requiredFormulaInputs": [],
    "requiredScheduling": [
      "6s_buff_window",
      "30s_cooldown_with_on_hit_crit_cdr"
    ],
    "missingPrimitives": [
      "attack_launch_vs_champion_arm",
      "timed_attack_speed_buff_30pct_6s",
      "on_hit_cooldown_reduction_1s",
      "crit_cooldown_reduction_2s",
      "30s_cooldown"
    ],
    "remainingBoundary": "缺对英雄发起普攻武装 +30% AS 6s/30s CD，以及 on-hit -1s / crit -2s 冷却缩减。",
    "reason": "3032 Flurry：attack launch vs champion arms +30% AS 6s/30s CD；on-hit -1s、crit -2s cooldown reduction。",
    "blocker": "attack_launch_vs_champion_arm+timed_attack_speed_buff_30pct_6s+on_hit_cooldown_reduction_1s+crit_cooldown_reduction_2s+30s_cooldown"
  },
};

const RUNTIME_GAP_BY_KEY = new Map(
  Object.entries(RUNTIME_GAP_SPEC_TABLE).map(([key, spec]) => [
    key,
    makeRuntimeGapEvidence({ key, ...spec }),
  ]),
);

function synthesizeRuntimeGapFromTags(mechanism) {
  const tags = mechanism.mechanismTags || [];
  const missing = [];
  const events = [];
  const state = [];
  const inputs = [];
  const scheduling = [];
  for (const t of tags) {
    if (
      t === 'deterministic_random_crit_sequence'
      || t === 'seeded_random_crit_sequence'
    ) {
      // Reproducible RNG/crit sequence primitive (not data seed / mount / publish).
      missing.push('deterministic_random_crit_sequence');
      events.push('critical_strike_resolved');
    } else if (t === 'distance_or_ratio_modifier') {
      missing.push('distance_or_ratio_input');
      inputs.push('distance_or_ratio');
    } else if (t === 'cooldown_or_haste_without_rotation') {
      missing.push('cooldown_or_haste_rotation');
      scheduling.push('cooldown_or_haste_without_rotation');
    } else if (t === 'timed_attack_speed_buff' || t === 'timed_attack_speed_modifier') {
      missing.push('timed_attack_speed_modifier');
      scheduling.push('timed_attack_speed_window');
    } else if (t === 'catch_cooldown_reset') {
      missing.push('catch_cooldown_reset');
      events.push('catch_event');
    } else if (t === 'attack_crit_cooldown_interaction') {
      missing.push('attack_crit_cooldown_interaction');
    } else if (t === 'conditional_guaranteed_crit' || t === 'first_attack') {
      missing.push('conditional_guaranteed_crit');
      events.push('basic_attack_vs_champion');
    } else if (t === 'incoming_damage_modifier' || t === 'incoming_damage_reduction') {
      missing.push('incoming_damage_modifier');
      events.push('incoming_damage');
    } else if (t === 'outgoing_damage_modifier') {
      missing.push('outgoing_damage_modifier');
      events.push('outgoing_damage');
    } else if (t === 'energized_charge_and_consume') {
      missing.push('energized_charge_and_consume');
    } else if (t === 'spellblade_next_attack_state') {
      missing.push('spellblade_next_attack_state');
    } else if (t === 'penetration_family') {
      missing.push('penetration_family_state');
    } else if (t.includes('stealth') || t.includes('movement')) {
      missing.push('stealth_or_movement_events');
      events.push('stealth_or_movement');
    } else if (t.includes('takedown') || t.includes('kill')) {
      missing.push('kill_or_takedown_event');
      events.push('kill_or_takedown');
    } else if (
      t === 'dps_relevant_manual_review' ||
      t === 'existing_batch_b_seed' ||
      t === 'meta_or_non_target_dps' ||
      t === 'heal' ||
      t === 'vulnerable' ||
      t === 'target_state_conditioned_attack_speed' ||
      t === 'attack_speed_percent_add' ||
      t === 'cast_condition' ||
      t === 'stacking_stat_modifier_on_hit' ||
      t === 'cast_triggered_timed_attack_speed' ||
      t === 'secondary_feather_ratio_damage' ||
      t === 'incoming_crit_damage_modifier' ||
      t === 'attack_or_ability_hit_resource_gain' ||
      t === 'periodic_charge_tick' ||
      t === 'state_driven_max_mana_and_transform' ||
      t === 'flat_post_percent' ||
      t === 'post_mitigation_final' ||
      t === 'rock_solid'
    ) {
      // informational / already covered by blocker or other tags
    } else {
      missing.push(`runtime_primitive_${t}`);
    }
  }
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  let missingPrimitives = uniq(missing);
  const blockerText = String(mechanism.blocker || '');
  const blockerLooksStable =
    blockerText &&
    !containsImplEvidenceWording(blockerText) &&
    /^[a-z0-9_+.-]+$/i.test(blockerText);
  if (blockerLooksStable) {
    const fromBlocker = blockerText.split('+').map((s) => s.trim()).filter(Boolean);
    if (fromBlocker.length) {
      // Prefer explicit English blocker keys over weak tag-derived runtime_primitive_*.
      missingPrimitives = fromBlocker;
    }
  }
  if (!missingPrimitives.length) {
    missingPrimitives = ['unspecified_runtime_capability'];
  }
  return makeRuntimeGapEvidence({
    key: mechanism.key,
    sourceRef: `最小验证/数据/build-unified-mechanism-inventory.mjs#synthesize:${mechanism.key}`,
    dataStatus: mechanism.completionMode === 'partial' ? 'partial' : 'complete',
    requiredEvents: uniq(events),
    requiredState: uniq(state),
    requiredFormulaInputs: uniq(inputs),
    requiredScheduling: uniq(scheduling),
    missingPrimitives,
    completedBoundary:
      mechanism.completionMode === 'partial' ? 'partial core already closed where evidenced' : '',
    remainingBoundary: `按 mechanismTags/blocker 推导的 runtime 缺口：${missingPrimitives.join('+')}`,
    reason:
      mechanism.reason && !containsImplEvidenceWording(mechanism.reason)
        ? mechanism.reason
        : `机制 tags=${tags.join('|')} 缺对应 runtime 原语`,
    blocker: blockerLooksStable ? blockerText : missingPrimitives.join('+'),
  });
}

function resolveRuntimeGap(mechanism) {
  const exact = RUNTIME_GAP_BY_KEY.get(mechanism.key);
  if (exact) return exact;
  return synthesizeRuntimeGapFromTags(mechanism);
}

function hasNonEmptyDataMissingFields(evidence) {
  return Boolean(
    evidence
    && Array.isArray(evidence.missingFields)
    && evidence.missingFields.length > 0,
  );
}

function applyRuntimeGapToMechanism(mechanism) {
  const hasDataMissing = hasNonEmptyDataMissingFields(mechanism.dataGapEvidence);
  const tagsProveRuntime = isBlockedRuntimeByTagsOnly(mechanism.mechanismTags);

  // Data gaps always outrank runtime: demote and keep runtimeGapEvidence as secondary.
  if (mechanism.status === 'blocked_runtime' && hasDataMissing) {
    const ev = mechanism.dataGapEvidence;
    mechanism.status = 'blocked_data';
    if (mechanism.completionMode !== 'partial') mechanism.completionMode = 'none';
    mechanism.reason = ev.reasonZh || mechanism.reason;
    mechanism.blocker = ev.blocker || mechanism.blocker;
  }

  if (mechanism.status === 'blocked_runtime') {
    const resolved = resolveRuntimeGap(mechanism);
    mechanism.reason = resolved.reason;
    mechanism.blocker = resolved.blocker;
    mechanism.runtimeGapEvidence = resolved.runtimeGapEvidence;
    return mechanism;
  }

  if (mechanism.status === 'blocked_data' && (tagsProveRuntime || mechanism.runtimeGapEvidence)) {
    // Secondary runtime evidence only — do not overwrite data reason/blocker.
    const resolved = resolveRuntimeGap({
      ...mechanism,
      status: 'blocked_runtime',
    });
    mechanism.runtimeGapEvidence = resolved.runtimeGapEvidence;
    return mechanism;
  }

  mechanism.runtimeGapEvidence = mechanism.runtimeGapEvidence || null;
  return mechanism;
}


/** Tags that prove blocked_runtime for remaining G8 blocked rows. */
const BLOCKED_RUNTIME_TAGS = new Set([
  'deterministic_random_crit_sequence',
  'seeded_random_crit_sequence',
  'distance_or_ratio_modifier',
  'cooldown_or_haste_without_rotation',
  'timed_attack_speed_buff',
  'catch_cooldown_reset',
  'timed_attack_speed_modifier',
  'attack_crit_cooldown_interaction',
  'conditional_guaranteed_crit',
  'first_attack',
  'movement_or_stealth',
  'kill_or_takedown_event',
  'incoming_damage_modifier',
  'outgoing_damage_modifier',
  'penetration_family',
]);

const BLOCKED_RUNTIME_TAG_NEEDLES = [
  'deterministic_random_crit',
  'seeded_random_crit',
  'distance_or_ratio',
  'cooldown_or_haste',
  'penetration',
  'stealth',
  'movement',
  'takedown',
  'kill_event',
  'incoming_damage',
  'outgoing_damage',
  'crit_only',
  'damage_modifier',
];

/** Coverage boundary annotations for composite branches. */
const COVERAGE_BOUNDARIES = new Map([
  ['hero_skill|hero_teemo|E|毒性射击', 'instant_on_hit_only;poison_dot_out_of_batch'],
  ['hero_skill|hero_kogmaw|W|生化弹幕', 'primary_on_hit;active_window_prearmed_in_seed'],
  ['hero_skill|hero_varus|P|复仇之欲', 'minion_kill_branch|champion_takedown_branch;both_blocked_runtime'],
  [
    'hero_skill|hero_varus|W|枯萎箭袋',
    'fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop',
  ],
  [
    'hero_skill|hero_draven|E|开道利斧',
    'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget',
  ],
  [
    'hero_skill|hero_teemo|Q|致盲吹箭',
    'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry',
  ],
  [
    'hero_skill|hero_vayne|E|恶魔审判',
    'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile',
  ],
  [
    'hero_skill|hero_vayne|R|终极时刻',
    'rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement',
  ],
  [
    'hero_skill|hero_kogmaw|E|虚空淤泥',
    'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration',
  ],
  [
    'hero_skill|hero_kogmaw|R|活体大炮',
    'rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth',
  ],
  [
    'hero_skill|hero_kaisa|W|虚空索敌',
    'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund',
  ],
  [
    'hero_skill|hero_varus|E|恶灵箭雨',
    'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation',
  ],
  [
    'hero_skill|hero_varus|R|腐败锁链',
    'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget',
  ],
  [
    'hero_skill|hero_twistedfate|Q|万能牌',
    'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget',
  ],
  [
    'hero_skill|hero_graves|W|烟幕弹',
    'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction',
  ],
  [
    'hero_skill|hero_graves|R|终极爆弹',
    'rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage',
  ],
  [
    'hero_skill|hero_graves|Q|穷途末路',
    'rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_senna|W|无尽厮守',
    'rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_senna|R|暗影燎原',
    'rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_ashe|R|魔法水晶箭',
    'rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight',
  ],
  [
    'hero_skill|hero_ezreal|R|精准弹幕',
    'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage',
  ],
  [
    'hero_skill|hero_ezreal|E|奥术跃迁',
    'rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks',
  ],
  [
    'hero_skill|hero_ezreal|Q|秘术射击',
    'rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_quinn|P|侵扰',
    'level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels',
  ],
  [
    'hero_skill|hero_quinn|E|旋翔掠杀',
    'rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_140_plus_0_20_bonus_ad; no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks',
  ],
  [
    'hero_skill|hero_quinn|Q|炫目攻势',
    'rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_205_plus_1_00_bonus_ad_plus_0_50_ap; no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks',
  ],
  [
    'hero_skill|hero_xayah|Q|双刃',
    'rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks',
  ],
  [
    'hero_skill|hero_xayah|R|暴风羽刃',
    'rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_jinx|W|震荡电磁波！',
    'rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_1_40_total_ad; no_cast_timing_direction_range_width_projectile_travel_collision_first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_jinx|E|嚼火者手雷！',
    'rank5_selected_primary_champion_single_magic_explosion_hit; immediate_impact_and_cooldown_scaffold; magic_290_plus_1_00_ap; no_three_chomper_layout_landing_delay_arming_delay_five_second_lifetime_location_direction_range_geometry_area_multitarget_contact_acquisition_knockdown_root_one_chomper_per_champion_wind_wall_braum_spellshield_exception_vision_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_jhin|Q|曼舞手雷',
    'rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_jhin|W|致命华彩',
    'rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_0_50_total_ad; no_cast_timing_direction_range_width_line_geometry_multitarget_champion_collision_projectile_interception_spell_shield_mark_creation_mark_detection_root_bonus_movement_speed_minion_reduction_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_caitlyn|E|90口径绳网',
    'rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; magic_280_plus_0_80_ap; no_cast_timing_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_suppression_spell_shield_recoil_dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_kalista|Q|穿刺',
    'rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_270_plus_1_05_total_ad; no_cast_timing_martial_poise_dash_cancel_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_interception_spell_shield_kill_continuation_rend_stack_transfer_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_caitlyn|Q|和平使者',
    'rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; physical_210_plus_2_05_total_ad; no_cast_timing_attack_timer_reset_direction_range_width_line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_full_damage_projectile_spell_shield_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_lucian|Q|透体圣光',
    'rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; physical_220_plus_1_00_bonus_ad; no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_initial_target_death_early_end_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_lucian|W|热诚烈弹',
    'rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_215_plus_0_90_ap; no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_shield_exception_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_lucian|R|圣枪洗礼',
    'rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_caitlyn|R|让子弹飞',
    'rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_tristana|Q|急速射击',
    'rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot; no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_tristana|R|毁灭射击',
    'rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_325_plus_0_70_bonus_ad_plus_1_00_ap; no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_tristana|W|火箭跳跃',
    'rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_corki|Q|磷光炸弹',
    'rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_akshan|Q|去而复还',
    'rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_sivir|Q|回旋之刃',
    'rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_base_160_plus_0_70_bonus_ad_plus_0_60_ap_scaled_by_0_to_0_40_formula_clamped_crit_chance; no_cast_time_bonus_attack_speed_direction_range_width_geometry_projectile_travel_speed_nonchampion_hit_reduction_return_pass_damage_modifier_reset_once_per_pass_spellshield_other_ranks_or_full_fidelity',
  ],
  [
    'hero_skill|hero_akshan|P|无所不用',
    'dirty_fighting_aa_stack_third_magic_core_complete;second_shot_delay_ms_blocked_data;ability_hit_stack_wiring_runtime;shield_cancel_ms_retarget_oos',
  ],
  ['item_passive|3748|item_passive|顺劈|数据参考/item.json#data.3748|71fa0f0c', 'primary_target_formula;behind_target_and_active_unmigrated'],
  ['item_passive|3748|item_passive|顺劈|数据参考/item.json#data.3748|020f8b5a', 'primary_target_formula;behind_target_and_active_unmigrated'],
]);

/**
 * Specialized audit/seed alias attachments (do not create duplicate mechanisms).
 * versioned: unified-inventory-alias-v1
 */
const ALIAS_TABLE = [
  {
    alias: 'batch_k_guinsoo_wrath',
    mechanismKeys: ['item_passive|3124|item_passive|怨怒'],
    sourcePath: '最小验证/V2-Batch-K-guinsoo-phantom-hit-audit.json',
  },
  {
    alias: 'batch_k_guinsoo_boiling_strike',
    mechanismKeys: ['item_passive|3124|item_passive|沸腾打击'],
    sourcePath: '最小验证/V2-Batch-K-guinsoo-phantom-hit-audit.json',
  },
  {
    alias: 'batch_l_spellblade_superseded_by_m',
    mechanismKeys: ['item_passive|3078|item_passive|咒刃'],
    sourcePath: '最小验证/V2-Batch-L-spellblade-next-attack-audit.json',
    superseded: true,
  },
  {
    alias: 'batch_m_trinity_spellblade',
    mechanismKeys: ['item_passive|3078|item_passive|咒刃'],
    sourcePath: '最小验证/V2-Batch-M-attr-read-trinity-base-ad-audit.json',
  },
  {
    alias: 'batch_n_voltaic_energized',
    mechanismKeys: ['item_passive|6699|item_passive|通电', 'item_passive|6699|item_passive|苍穹'],
    sourcePath: '最小验证/V2-Batch-N-energized-charge-and-consume-audit.json',
  },
  {
    alias: 'batch_p_black_cleaver_carve',
    mechanismKeys: ['item_passive|3071|item_passive|切割'],
    sourcePath: '最小验证/V2-Batch-P-target-equipment-linked-effects-audit.json',
  },
  {
    alias: 'fullitem_3094_energized_container',
    mechanismKeys: ['item_passive|3094|item_passive|神射手'],
    sourcePath: '最小验证/V2-full-item-dps-coverage-20260615.json',
  },
  {
    alias: 'batch_g_terminus_shadow_stale_ready',
    mechanismKeys: ['item_passive|3302|item_passive|晦影'],
    sourcePath: '最小验证/V2-Batch-G-adc-passive-audit.json',
    note: 'old Batch G ready_to_encode is stale relative to generic completed evidence',
  },
];

/** Non-numeric owner alias table (versioned). Empty for v1 — numeric item_* only. */
const OWNER_ALIAS_TABLE = new Map();

/** Explicit extra mechanisms not present in G8 candidateKeys. */
const EXTRA_MECHANISMS = [
  {
    key: MALZAHAR_E_KEY,
    status: 'completed',
    completionMode: 'full',
    lane: 'generic_runtime',
    sourceKind: 'hero_skill',
    ownerId: 'hero_malzahar',
    skillKey: 'E',
    passiveName: '恶咒降临',
    mechanismTags: ['anchored_provider_tick', 'periodic_magic_damage', 'active_ability'],
    coverageBoundary: 'phase_a_rank5_primary_target_anchored_dot',
    reason:
      'Malzahar E 恶咒降临/Malefic Visions：EXTRA Wiki sidecar rev4015185（SHA256 9098ee2fbe7dfb33d1ca375bbce0c68788fd60378780aa4ddab8afc46736ba84；normalized/generic/malzahar-e.json）rank5 Phase-A 主目标锚定 DoT 已由 wasm-generic-malzahar-malefic-visions + generic anchored provider-tick（8612d0d）+ Backend seed（8444018/4351827）+ 既有 Web assembler/projection（61b93bf/5a0931a）证据闭环——cost100/CD7000；provider_target active max1/duration4000/refresh_on_write；250ms×16 inclusive；tick13.75+0.05AP magic；total220+0.80AP。明确排除 Q/R refresh、death spread/bounce/multitarget、mana restore/minion execute、cleanse/immunity、indirect/spell-effect、ranks1-4、cast targeting、AP snapshot mutation、live migration/publish/E2E/full fidelity。Batch-J 仅作 stale regression，故标 completed。',
    blocker: '',
    dataGapEvidence: null,
    runtimeGapEvidence: null,
    sourceRefs: [
      {
        path: MALZAHAR_E_WIKI_REL,
        legacyStatus: 'current_wiki_sidecar',
        sourceRecordKey: MALZAHAR_E_KEY,
      },
      {
        path: '最小验证/V2-Batch-J-status-damage-audit.json',
        legacyStatus: 'historical_reference',
        sourceRecordKey: 'skill_malzahar_e',
      },
      {
        path: '最小验证/V2-Batch-J-status-damage-migration.seed.json',
        legacyStatus: 'data_only_regression',
        sourceRecordKey: 'skill_malzahar_e',
      },
    ],
    evidenceRefs: [
      {
        evidenceType: 'generic_batch',
        taskKey: 'wasm-generic-malzahar-malefic-visions',
        sourcePath:
          'wasm/tinygo_engine_v2/internal/runtime/generic_malzahar_malefic_visions_test.go',
        sourceWorktree: 'wasm',
        note: 'completedBoundary: exact CompileGeneric+RunGeneric Malefic Visions rank5 primary-target anchored DoT (commit 0e69db1); not live published',
      },
      {
        evidenceType: 'generic_batch',
        taskKey: 'wasm-generic-anchored-provider-tick',
        sourcePath:
          'wasm/tinygo_engine_v2/internal/runtime/generic_anchored_tick_test.go',
        sourceWorktree: 'wasm',
        note: 'completedBoundary: generic anchored provider-tick ABI/runtime (commit 8612d0d); write-triggered generation / cap-refresh / inclusive final tick',
      },
      {
        evidenceType: 'generic_batch',
        taskKey: 'wasm-generic-malzahar-malefic-visions',
        sourcePath: 'db/game_manage/seeds/lol_generic_malzahar_malefic_visions_seed.sql',
        sourceWorktree: 'backend',
        note: 'completedBoundary: Backend seed + LolGenericMalzaharMaleficVisionsSeedSqlTest (commit 8444018; integrated 4351827); not live published',
      },
      {
        evidenceType: 'generic_batch',
        taskKey: 'wasm-generic-malzahar-malefic-visions',
        sourcePath: 'web/src/engine/combatDataAssembler.ts',
        sourceWorktree: 'web',
        note: 'completedBoundary: existing Web lifecycle type-id → TickSpec anchor pair projection (commit 61b93bf; integrated 5a0931a); no mechanism-specific Web change',
      },
      {
        evidenceType: 'generic_batch',
        taskKey: 'wasm-generic-malzahar-malefic-visions',
        sourcePath: 'web/src/engine/combatDataAssembler.test.ts',
        sourceWorktree: 'web',
        note: 'completedBoundary: existing Web anchored tick lifecycle projection tests (commit 5a0931a)',
      },
    ],
    aliases: ['skill_malzahar_e'],
  },
  {
    key: 'hero_skill|hero_brand|W|烈焰之柱',
    status: 'regression_only',
    completionMode: 'none',
    lane: 'legacy_single_attacker_dps',
    sourceKind: 'hero_skill',
    ownerId: 'hero_brand',
    skillKey: 'W',
    passiveName: '烈焰之柱',
    mechanismTags: ['keep_mechanics_config'],
    coverageBoundary: 'batch_j_status_migration_audit_only',
    reason: 'Batch J 状态迁移审计：keep_mechanics_config，不作新机制实现任务。',
    blocker: '',
    sourceRefs: [
      {
        path: '最小验证/V2-Batch-J-status-damage-audit.json',
        legacyStatus: 'keep_mechanics_config',
        sourceRecordKey: 'skill_brand_w',
      },
    ],
    aliases: ['skill_brand_w'],
  },
  {
    key: 'hero_skill|hero_ahri|Q|欺诈宝珠',
    status: 'regression_only',
    completionMode: 'none',
    lane: 'legacy_single_attacker_dps',
    sourceKind: 'hero_skill',
    ownerId: 'hero_ahri',
    skillKey: 'Q',
    passiveName: '欺诈宝珠',
    mechanismTags: ['keep_mechanics_config'],
    coverageBoundary: 'batch_j_status_migration_audit_only',
    reason: 'Batch J 状态迁移审计：keep_mechanics_config，不作新机制实现任务。',
    blocker: '',
    sourceRefs: [
      {
        path: '最小验证/V2-Batch-J-status-damage-audit.json',
        legacyStatus: 'keep_mechanics_config',
        sourceRecordKey: 'skill_ahri_q',
      },
    ],
    aliases: ['skill_ahri_q'],
  },
  {
    key: 'hero_skill|hero_katarina|R|死亡莲华',
    status: 'regression_only',
    completionMode: 'none',
    lane: 'legacy_single_attacker_dps',
    sourceKind: 'hero_skill',
    ownerId: 'hero_katarina',
    skillKey: 'R',
    passiveName: '死亡莲华',
    mechanismTags: ['keep_mechanics_config'],
    coverageBoundary: 'batch_j_status_migration_audit_only',
    reason: 'Batch J 状态迁移审计：keep_mechanics_config，不作新机制实现任务。',
    blocker: '',
    sourceRefs: [
      {
        path: '最小验证/V2-Batch-J-status-damage-audit.json',
        legacyStatus: 'keep_mechanics_config',
        sourceRecordKey: 'skill_katarina_r',
      },
    ],
    aliases: ['skill_katarina_r'],
  },
  {
    key: 'hero_skill|hero_leona|R|日炎耀斑',
    status: 'regression_only',
    completionMode: 'none',
    lane: 'legacy_single_attacker_dps',
    sourceKind: 'hero_skill',
    ownerId: 'hero_leona',
    skillKey: 'R',
    passiveName: '日炎耀斑',
    mechanismTags: ['keep_mechanics_config'],
    coverageBoundary: 'batch_j_status_migration_audit_only',
    reason: 'Batch J 状态迁移审计：keep_mechanics_config，不作新机制实现任务。',
    blocker: '',
    sourceRefs: [
      {
        path: '最小验证/V2-Batch-J-status-damage-audit.json',
        legacyStatus: 'keep_mechanics_config',
        sourceRecordKey: 'skill_leona_r',
      },
    ],
    aliases: ['skill_leona_r'],
  },
  {
    key: 'hero_skill|hero_leona|W|日蚀',
    status: 'regression_only',
    completionMode: 'none',
    lane: 'legacy_single_attacker_dps',
    sourceKind: 'hero_skill',
    ownerId: 'hero_leona',
    skillKey: 'W',
    passiveName: '日蚀',
    mechanismTags: ['keep_mechanics_config'],
    coverageBoundary: 'batch_j_status_migration_audit_only',
    reason: 'Batch J 状态迁移审计：keep_mechanics_config，不作新机制实现任务。',
    blocker: '',
    sourceRefs: [
      {
        path: '最小验证/V2-Batch-J-status-damage-audit.json',
        legacyStatus: 'keep_mechanics_config',
        sourceRecordKey: 'skill_leona_w',
      },
    ],
    aliases: ['skill_leona_w'],
  },
  {
    key: 'hero_skill|hero_drmundo|R|极限生机',
    status: 'out_of_scope',
    completionMode: 'none',
    lane: 'legacy_single_attacker_dps',
    sourceKind: 'hero_skill',
    ownerId: 'hero_drmundo',
    skillKey: 'R',
    passiveName: '极限生机',
    mechanismTags: ['hot_sustain'],
    coverageBoundary: 'batch_j_out_of_scope',
    reason: 'Batch J: HoT sustain 不在 1v1 damage-only 验证范围。',
    blocker: '',
    outOfScopeEvidence: {
      sourceRef: '最小验证/V2-Batch-J-status-damage-audit.json#skill_drmundo_r',
      sourceTextSummary: 'Batch J: HoT sustain 不在 1v1 damage-only 验证范围。',
      reviewedPrimaryTargetDamageBranch: true,
      boundaryCategory: 'pure_heal_shield_survival',
      excludedBehavior: 'hot_sustain',
      boundaryReason: '极限生机：纯治疗/护盾/生存/免死，不增加对主目标输出；审计边界外。',
      damageRelevantSubBranchDisposition: 'no_primary_target_damage_branch',
    },
    sourceRefs: [
      {
        path: '最小验证/V2-Batch-J-status-damage-audit.json',
        legacyStatus: 'out_of_scope',
        sourceRecordKey: 'skill_drmundo_r',
      },
    ],
    aliases: ['skill_drmundo_r'],
  },
  {
    key: 'item_passive|3075|item_passive|荆棘',
    status: 'completed',
    completionMode: 'full',
    lane: 'generic_runtime',
    sourceKind: 'item_passive',
    ownerId: '3075',
    skillKey: 'item_passive',
    passiveName: '荆棘',
    mechanismTags: ['on_damage_taken_reflect'],
    coverageBoundary: 'batch_p_thornmail;wiki_formula_ready;generic_wiki_ready_items_closed',
    reason:
      '荆棘/Thorns 当前 generic ABI：被真实普攻命中时对攻击者造成 20(+10% bonus armor) 魔法伤害；bonus armor 0/100→raw 20/30，经 MR；每真实普攻一次、不递归；重伤分支本口径不宣称；wasm generic_wiki_ready_items_test.go + backend lol_generic_wiki_ready_items_seed.sql；旧固定 20 简化作废；不声称 live migrate/publish。',
    blocker: '',
    sourceRefs: [
      {
        path: '最小验证/V2-Batch-P-target-equipment-linked-effects-audit.json',
        legacyStatus: 'publishConditions',
        sourceRecordKey: '3075',
      },
    ],
    evidenceRefs: [
      {
        evidenceType: 'generic_batch',
        taskKey: 'wasm-generic-wiki-ready-items',
        sourcePath:
          'wasm/tinygo_engine_v2/internal/runtime/generic_wiki_ready_items_test.go',
        sourceWorktree: 'wasm',
        note: 'Thorns bonus armor 0/100 → raw 20/30, MR, once per real AA, no recursion; commit 25a2a3b; not live published',
      },
      {
        evidenceType: 'generic_batch',
        taskKey: 'wasm-generic-wiki-ready-items',
        sourcePath: 'db/game_manage/seeds/lol_generic_wiki_ready_items_seed.sql',
        sourceWorktree: 'backend',
        note: 'idempotent seed/mount + LolGenericWikiReadyItemsSeedSqlTest; commit 27f3490; not live published',
      },
    ],
    aliases: ['item_3075_thornmail_thorns_dps_v2', 'batch_p_thorns'],
  },
  {
    key: 'item_passive|3143|item_passive|复原力',
    status: 'completed',
    completionMode: 'full',
    lane: 'generic_runtime',
    sourceKind: 'item_passive',
    ownerId: '3143',
    skillKey: 'item_passive',
    passiveName: '复原力',
    mechanismTags: ['incoming_crit_damage_modifier'],
    coverageBoundary:
      'batch_p_randuin;wiki_incoming_crit_part_x0.70;generic_target_hosted_incoming_crit_part_pipeline_proven',
    reason:
      '兰顿之兆/复原力：Wiki 合同为所受暴击伤害降低 30%；generic 目标侧 pipeline modifier（stage incoming_crit_part_post_mitigation / channel all_damage / bucket all_instances / multiply const 0.70）已由 expected-crit 管线证明（p=1→crit part 100→70；p=0 非暴击不变）；不声称 live migrate/publish。',
    blocker: '',
    sourceRefs: [
      {
        path: '最小验证/V2-Batch-P-target-equipment-linked-effects-audit.json',
        legacyStatus: 'blockedItems',
        sourceRecordKey: '3143',
      },
    ],
    evidenceRefs: [
      {
        evidenceType: 'generic_batch',
        taskKey: 'batch-p-randuin-v1',
        sourcePath:
          'wasm/tinygo_engine_v2/internal/runtime/generic_c2_crit_pipeline_test.go',
        sourceWorktree: 'wasm',
        note: 'TestC2RanduinResilienceIncomingCritReduction: target-hosted ×0.70 incoming_crit_part; p=1→70, p=0 unchanged; not live published',
      },
    ],
    aliases: ['item_3143_randuin_crit_reduction_dps_v2', 'batch_p_randuin'],
  },
  {
    key: 'item_passive|6665|item_passive|虚空天生',
    status: 'completed',
    completionMode: 'full',
    lane: 'generic_runtime',
    sourceKind: 'item_passive',
    ownerId: '6665',
    skillKey: 'item_passive',
    passiveName: '虚空天生',
    mechanismTags: ['full_stack_resists', 'target_armor_flat_bonus', 'target_magic_resist_flat_bonus'],
    coverageBoundary:
      'real_targetEquipmentEntityIds_projects_selected_target_item_static_armor_mr+target_only_derived_bonus_armor_bonus_magic_resist+target_owned_provider_mount;t5000_adds_30pct_of_projected_bonus_resist_later_tick_idempotent',
    reason:
      '6665 虚空天生/Voidborn Resilience：真实 targetEquipmentEntityIds 将所选目标装备静态 armor/MR、目标侧派生 bonus_armor/bonus_magic_resist 与 target-owned provider mount 投影进 compile 合同；既有 t=5000 runtime 对投影 bonus 抗性各加 30%，后续 tick 幂等（75/75+45/45→88.5/88.5）。backend seed（tag/loadout_equipment 资格）+ Web combatDataAssembler target loadout/bonus 投影 + wasm generic_jaksho_voidborn_resilience_test.go 三边证据闭环；非 G8 candidate，经 EXTRA_MECHANISMS 闭环。不声称 live migrate/publish（证据边界，非 blocker）。',
    blocker: '',
    sourceRefs: [
      {
        path: '最小验证/V2-BatchV-A-data-policy-items.seed.json',
        legacyStatus: 'seed_present',
        sourceRecordKey: 'item_6665_jaksho_voidborn_resilience_batch_v_a',
      },
    ],
    evidenceRefs: [
      {
        evidenceType: 'generic_batch',
        taskKey: 'planning-validation-milestones',
        sourcePath: 'db/game_manage/seeds/lol_generic_jaksho_voidborn_resilience_seed.sql',
        sourceWorktree: 'backend',
        note: 'completedBoundary: item_6665 static panel + provider_item_6665_jaksho_voidborn_resilience + tag/loadout_equipment (62011) eligibility relation; not claiming live migrate/publish',
      },
      {
        evidenceType: 'generic_batch',
        taskKey: 'planning-validation-milestones',
        sourcePath: 'web/src/engine/combatDataAssembler.ts',
        sourceWorktree: 'web',
        note: 'completedBoundary: targetEquipmentEntityIds projects selected target item static armor/MR, target-only derived bonus_armor/bonus_magic_resist, and target-owned provider mount',
      },
      {
        evidenceType: 'generic_batch',
        taskKey: 'planning-validation-milestones',
        sourcePath: 'web/src/engine/combatDataAssembler.test.ts',
        sourceWorktree: 'web',
        note: 'completedBoundary: jaksho-target-loadout-v2 target loadout + bonus projection (75/75 totals + 45/45 bonus pre-activation)',
      },
      {
        evidenceType: 'generic_batch',
        taskKey: 'planning-validation-milestones',
        sourcePath:
          'wasm/tinygo_engine_v2/internal/runtime/generic_jaksho_voidborn_resilience_test.go',
        sourceWorktree: 'wasm',
        note: 'completedBoundary: exact 75/75 + 45/45 → 88.5/88.5 at t=5000; later tick idempotent; target-owned; not live migrated/published',
      },
    ],
    aliases: ['item_6665_jaksho_voidborn_resilience_batch_v_a'],
    dependencyOf: [],
  },
  {
    key: 'item_passive|2051|item_passive|无畏',
    status: 'completed',
    completionMode: 'full',
    lane: 'generic_runtime',
    sourceKind: 'item_passive',
    ownerId: '2051',
    skillKey: 'item_passive',
    passiveName: '无畏',
    mechanismTags: ['flat_post_percent', 'incoming_damage_modifier', 'incoming_damage_reduction'],
    coverageBoundary:
      'batch_v_a_guardians_horn;pipeline_damage_modifier_closed;1v1_champion_source_scope',
    reason:
      '2051 Guardian\'s Horn/无畏（Wiki Undaunted）：ordinary post-mitigation −15、DoT −3.75；wasm-generic-pipeline-damage-modifier 交叉验证 100→85、100→96.25；backend lol_generic_pipeline_damage_items_seed.sql（focused Maven pass）。非 G8 candidate，经 EXTRA_MECHANISMS 闭环；不声称 non-champion filtering/live migrate/publish/hp5flat。',
    blocker: '',
    evidenceRefs: [
      {
        evidenceType: 'generic_batch',
        taskKey: 'wasm-generic-pipeline-damage-modifier',
        sourcePath:
          'wasm/tinygo_engine_v2/internal/runtime/generic_c1_damage_event_pipeline_test.go',
        sourceWorktree: 'wasm',
        note: 'Undaunted ordinary/DoT post-mitigation subtract; cross-check 100→85 / 100→96.25; 1v1 champion-source scope',
      },
      {
        evidenceType: 'generic_batch',
        taskKey: 'wasm-generic-pipeline-damage-modifier',
        sourcePath: 'db/game_manage/seeds/lol_generic_pipeline_damage_items_seed.sql',
        sourceWorktree: 'backend',
        note: 'Undaunted pipeline modifier seed; focused Maven evidence; not claiming live migrate/publish',
      },
    ],
    sourceRefs: [
      {
        path: '最小验证/V2-BatchV-A-data-policy-items.seed.json',
        legacyStatus: 'seed_present',
        sourceRecordKey: 'item_2051_guardians_horn_undaunted_batch_v_a',
      },
    ],
    aliases: ['item_2051_guardians_horn_undaunted_batch_v_a'],
  },
  {
    key: 'item_passive|3082|item_passive|坚如磐石',
    status: 'completed',
    completionMode: 'full',
    lane: 'generic_runtime',
    sourceKind: 'item_passive',
    ownerId: '3082',
    skillKey: 'item_passive',
    passiveName: '坚如磐石',
    mechanismTags: [
      'incoming_damage_modifier',
      'incoming_damage_reduction',
      'post_mitigation_final',
      'rock_solid',
    ],
    coverageBoundary: 'batch_v_b_wardens_mail;pipeline_damage_modifier_closed',
    reason:
      '3082 Rock Solid/坚如磐石：target-owned、每次施法首段 post-mitigation basic-damage；final=max(input-15,input*0.8)（等价 reduce min(15,20%)）；wasm-generic-pipeline-damage-modifier 交叉验证 100→85、50→40 与两段命中/下一施法 reset；backend lol_generic_pipeline_damage_items_seed.sql。非 G8 candidate，经 EXTRA_MECHANISMS 闭环；不声称 live migrate/publish。',
    blocker: '',
    evidenceRefs: [
      {
        evidenceType: 'generic_batch',
        taskKey: 'wasm-generic-pipeline-damage-modifier',
        sourcePath:
          'wasm/tinygo_engine_v2/internal/runtime/generic_pipeline_damage_modifier_test.go',
        sourceWorktree: 'wasm',
        note: 'Rock Solid first-per-cast post-mitigation max(input-15,input*0.8); cross-check 100→85 / 50→40 / two-hit then next-cast',
      },
      {
        evidenceType: 'generic_batch',
        taskKey: 'wasm-generic-pipeline-damage-modifier',
        sourcePath: 'db/game_manage/seeds/lol_generic_pipeline_damage_items_seed.sql',
        sourceWorktree: 'backend',
        note: 'Rock Solid pipeline modifier seed; not claiming live migrate/publish',
      },
    ],
    sourceRefs: [
      {
        path: '最小验证/V2-BatchV-B-3082-wardens-mail.seed.json',
        legacyStatus: 'seed_present',
        sourceRecordKey: 'item_3082_wardens_mail_rock_solid_batch_v_b',
      },
    ],
    aliases: ['item_3082_wardens_mail_rock_solid_batch_v_b'],
  },
];

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function relFromRepo(absPath) {
  return toPosix(path.relative(repoRoot, absPath));
}

function sha256Raw(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Treat inventoried UTF-8 text (.json/.csv/.mjs) as LF-canonical for evidence hashing (CRLF/CR → LF). */
function canonicalizeUtf8TextBytes(buf) {
  const text = Buffer.from(buf).toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return Buffer.from(text, 'utf8');
}

function canonicalizeEol(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function sha256File(absPath) {
  return sha256Raw(canonicalizeUtf8TextBytes(fs.readFileSync(absPath)));
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function normalizeOwnerId(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (OWNER_ALIAS_TABLE.has(s)) return OWNER_ALIAS_TABLE.get(s);
  const itemPref = s.match(/^item_(\d+)$/i);
  if (itemPref) return itemPref[1];
  if (/^\d+$/.test(s)) return s;
  return s;
}

function stableSortBy(arr, keyFn) {
  return [...arr].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Semantic compare helper: ignore only metadata.generatedAt per --check contract. */
function stripMetadataGeneratedAt(inventory) {
  if (!inventory || typeof inventory !== 'object') return inventory;
  const out = { ...inventory };
  if (inventory.metadata && typeof inventory.metadata === 'object') {
    out.metadata = { ...inventory.metadata };
    delete out.metadata.generatedAt;
  }
  return out;
}

function deepEqualJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function countRecordsForSource(kind, absPath, parsed) {
  if (kind === 'generator_mjs') {
    return { recordCount: 0, role: 'generator' };
  }
  // Provenance/document JSON: parse+hash only; never contributes coverage records.
  if (kind === 'document_json') {
    return { recordCount: 0, role: 'document' };
  }
  if (kind === 'coverage_csv' || kind === 'audit_csv') {
    const text = fs.readFileSync(absPath, 'utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    return { recordCount: Math.max(0, lines.length - 1), role: 'tabular_projection' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { recordCount: 0, role: 'opaque' };
  }
  if (Array.isArray(parsed)) {
    return { recordCount: parsed.length, role: 'record_array' };
  }
  if (Array.isArray(parsed.candidates)) {
    return { recordCount: parsed.candidates.length, role: 'candidates' };
  }
  if (Array.isArray(parsed.records)) {
    return { recordCount: parsed.records.length, role: 'records' };
  }
  if (Array.isArray(parsed.skills) || Array.isArray(parsed.items)) {
    return {
      recordCount: (parsed.skills?.length || 0) + (parsed.items?.length || 0),
      role: 'seed_entities',
    };
  }
  if (parsed.publishConditions || parsed.blockedItems) {
    const n =
      Object.keys(parsed.publishConditions || {}).length + Object.keys(parsed.blockedItems || {}).length;
    return { recordCount: n, role: 'gate_audit' };
  }
  if (parsed.expectedVerification) {
    return { recordCount: 1, role: 'gate_audit' };
  }
  if (parsed.counts || parsed.byStatus) {
    return { recordCount: Number(parsed.counts?.bundleItems || 0), role: 'coverage_summary' };
  }
  if (Array.isArray(parsed.coefficientBuckets)) {
    return { recordCount: parsed.coefficientBuckets.length, role: 'coefficient_buckets' };
  }
  return { recordCount: 0, role: 'document' };
}

/** Fail-closed identity checks for EXTRA Malzahar E normalized Wiki sidecar. */
function assertMalzaharEWikiDocument(parsed, rel) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${rel}: document_json must be a non-array object`);
  }
  if (parsed.schemaVersion !== MALZAHAR_E_SCHEMA) {
    throw new Error(`${rel}: schemaVersion must be ${MALZAHAR_E_SCHEMA}`);
  }
  if (parsed.candidateKey !== MALZAHAR_E_KEY) {
    throw new Error(`${rel}: candidateKey must be ${MALZAHAR_E_KEY}`);
  }
  if (parsed.pageId !== MALZAHAR_E_PAGE_ID) {
    throw new Error(`${rel}: pageId must be ${MALZAHAR_E_PAGE_ID}`);
  }
  if (Number(parsed.revisionId) !== MALZAHAR_E_REVISION_ID) {
    throw new Error(`${rel}: revisionId must be ${MALZAHAR_E_REVISION_ID}`);
  }
  if (String(parsed.contentSha256 || '') !== MALZAHAR_E_CONTENT_SHA256) {
    throw new Error(`${rel}: contentSha256 must be ${MALZAHAR_E_CONTENT_SHA256}`);
  }
  if (parsed.ownerId !== 'hero_malzahar' || parsed.skillKey !== 'E') {
    throw new Error(`${rel}: ownerId/skillKey must be hero_malzahar/E`);
  }
  const fields = parsed.fields;
  const presence = parsed.fieldPresence;
  if (!fields || typeof fields !== 'object' || !presence || typeof presence !== 'object') {
    throw new Error(`${rel}: missing fields/fieldPresence objects`);
  }
  for (const name of MALZAHAR_E_REQUIRED_TRACKED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(fields, name) || typeof fields[name] !== 'string') {
      throw new Error(`${rel}: missing required tracked field ${name}`);
    }
    if (presence[name] !== true) {
      throw new Error(`${rel}: fieldPresence.${name} must be true`);
    }
  }
  if (Array.isArray(parsed.candidates) || Array.isArray(parsed.records) || Array.isArray(parsed.mechanisms)) {
    throw new Error(`${rel}: document_json must not contribute coverage candidates/records/mechanisms`);
  }
}

function pushParsedSource(sources, seen, abs, rel, kind) {
  if (seen.has(rel)) return;
  seen.add(rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`missing required allowlisted source ${rel}`);
  }
  const buf = canonicalizeUtf8TextBytes(fs.readFileSync(abs));
  let parsed = null;
  if (kind.endsWith('_json')) {
    try {
      parsed = JSON.parse(buf.toString('utf8'));
    } catch (err) {
      throw new Error(`failed to parse source JSON ${rel}: ${err.message}`);
    }
  }
  if (rel === MALZAHAR_E_WIKI_REL) {
    if (kind !== 'document_json') {
      throw new Error(`${rel}: ACTIVE_SOURCE kind must be document_json`);
    }
    assertMalzaharEWikiDocument(parsed, rel);
  }
  const { recordCount, role } = countRecordsForSource(kind, abs, parsed);
  if (rel === MALZAHAR_E_WIKI_REL && (recordCount !== 0 || role !== 'document')) {
    throw new Error(`${rel}: must hash as document with recordCount 0`);
  }
  sources.push({
    path: rel,
    kind,
    sha256: sha256Raw(buf),
    byteSize: buf.byteLength,
    recordCount,
    role,
  });
}

function discoverSources() {
  const sources = [];
  const seen = new Set();

  for (const entry of ACTIVE_SOURCE_ALLOWLIST) {
    pushParsedSource(sources, seen, entry.abs(), entry.rel, entry.kind);
  }

  for (const entry of GENERATOR_SOURCE_ALLOWLIST) {
    const abs = path.join(repoRoot, entry.rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`missing required allowlisted generator ${entry.rel}`);
    }
    if (seen.has(entry.rel)) continue;
    seen.add(entry.rel);
    const buf = canonicalizeUtf8TextBytes(fs.readFileSync(abs));
    sources.push({
      path: entry.rel,
      kind: 'generator_mjs',
      sha256: sha256Raw(buf),
      byteSize: buf.byteLength,
      recordCount: 0,
      role: 'generator',
    });
  }

  const got = new Set(sources.map((s) => s.path));
  for (const p of ALLOWED_HASHED_SOURCE_PATHS) {
    if (!got.has(p)) throw new Error(`discoverSources missing allowlisted path ${p}`);
  }
  for (const p of got) {
    if (!ALLOWED_HASHED_SOURCE_PATHS.has(p)) {
      throw new Error(`discoverSources unexpected non-allowlisted path ${p}`);
    }
  }

  return stableSortBy(sources, (s) => `${s.kind}|${s.path}`);
}
function isBlockedRuntimeByTags(tags, gap, reason) {
  const list = tags || [];
  for (const t of list) {
    if (BLOCKED_RUNTIME_TAGS.has(t)) return true;
    if (BLOCKED_RUNTIME_TAG_NEEDLES.some((n) => t.includes(n))) return true;
  }
  const blob = `${gap || ''}|${reason || ''}|${list.join('|')}`;
  return /seeded_random|distance_or_ratio|cooldown_or_haste|penetration|stealth|隐身|移动|击杀|takedown|incoming_damage|outgoing_damage|crit-only|crit_only/i.test(
    blob,
  );
}

function isBlockedRuntimeByTagsOnly(tags) {
  const list = tags || [];
  for (const t of list) {
    if (BLOCKED_RUNTIME_TAGS.has(t)) return true;
    if (BLOCKED_RUNTIME_TAG_NEEDLES.some((n) => t.includes(n))) return true;
  }
  return false;
}

function containsImplEvidenceWording(text) {
  // Implementation-status tokens only. Domain key deterministic_random_crit_sequence
  // means reproducible RNG/crit sequence, not data seed.
  return /(^|[+_])seed([+_]|$)|seed\/mount|provider seed|generic seed|\bmount\b|live publish|\bpublish\b|\bE2E\b/i.test(
    String(text || ''),
  );
}

/** blocked_runtime blocker must not use seed/mount/publish/E2E implementation-status tokens. */
function containsBlockedRuntimeBlockerForbiddenToken(text) {
  return /(^|[+_])seed([+_]|$)|mount|publish|E2E/i.test(String(text || ''));
}

/** Reject ddragon / data dragon / standalone DD numeric tokens; do not match ordinary "dd" words. */
function citesForbiddenProvenance(text) {
  const s = String(text || '');
  if (/ddragon/i.test(s)) return true;
  if (/data\s+dragon/i.test(s)) return true;
  // e.g. "DD 16.9.1" — boundary before DD so "added"/"middle" do not match
  if (/(^|[^a-z0-9])dd\s+\d+(?:\.\d+)+/i.test(s)) return true;
  return false;
}

function mapG8ToUnified(candidate) {
  const key = candidate.candidateKey;
  const override = STATUS_OVERRIDES.get(key);
  if (override) {
    return {
      status: override.status,
      completionMode: override.completionMode,
      lane: override.lane,
      reason: override.reason,
      blocker: override.blocker || '',
      dataGapEvidence: override.dataGapEvidence || null,
      runtimeGapEvidence: override.runtimeGapEvidence || null,
      outOfScopeEvidence: override.outOfScopeEvidence || null,
    };
  }

  const gc = candidate.genericClassification;
  const tags = candidate.genericMechanismTags || candidate.mechanismTags || [];
  const gap = candidate.remainingGap || '';
  const reason = candidate.classificationReason || candidate.blockedReason || '';
  const evidence = candidate.dataGapEvidence || null;

  if (gc === 'migrated') {
    return {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason: reason || 'generic G8 migrated with coverage evidence',
      blocker: '',
      dataGapEvidence: null,
    };
  }
  if (gc === 'partial') {
    // Remaining branches are not automatically actionable; exact status comes from STATUS_OVERRIDES.
    return {
      status: 'blocked_runtime',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason: reason || 'generic G8 partial with non-actionable remaining branch',
      blocker: gap || 'remaining_gap',
      dataGapEvidence: null,
    };
  }
  if (gc === 'out_of_scope') {
    return {
      status: 'out_of_scope',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason: reason || 'generic G8 out_of_scope',
      blocker: '',
      dataGapEvidence: null,
      outOfScopeEvidence: candidate.outOfScopeEvidence || null,
    };
  }
  if (gc === 'blocked') {
    // Precise numeric/formula gaps always win over runtime tags/blockers.
    if (hasNonEmptyDataMissingFields(evidence)) {
      return {
        status: 'blocked_data',
        completionMode: 'none',
        lane: 'generic_runtime',
        reason: evidence.reasonZh || reason || 'data/template/rank/formula gap',
        blocker: evidence.blocker || gap || 'blocked_data',
        dataGapEvidence: evidence,
      };
    }
    // Tag-proven runtime gaps (only when no unresolved data fields).
    if (isBlockedRuntimeByTagsOnly(tags)) {
      return {
        status: 'blocked_runtime',
        completionMode: 'none',
        lane: 'generic_runtime',
        reason: reason || 'runtime capability gap',
        blocker: gap || 'blocked_runtime',
        dataGapEvidence: evidence,
      };
    }
    // No unresolved data fields → not blocked_data. Conservative: blocked_runtime only
    // (ready_to_implement requires explicit existing-runtime proof; do not guess).
    if (evidence && Array.isArray(evidence.missingFields) && evidence.missingFields.length === 0) {
      return {
        status: 'blocked_runtime',
        completionMode: 'none',
        lane: 'generic_runtime',
        reason:
          evidence.reasonZh
          || '本地数值快照无未解析伤害/数据字段；缺 runtime 表达能力（非 data blocker）',
        blocker: 'implementation_gap_no_unresolved_data_fields',
        dataGapEvidence: evidence,
      };
    }
    // Legacy blob heuristic only when structured evidence is unavailable.
    if (isBlockedRuntimeByTags(tags, gap, reason)) {
      return {
        status: 'blocked_runtime',
        completionMode: 'none',
        lane: 'generic_runtime',
        reason: reason || 'runtime capability gap',
        blocker: gap || 'blocked_runtime',
        dataGapEvidence: evidence,
      };
    }
    return {
      status: 'blocked_data',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason: reason || 'data/template/rank/formula gap',
      blocker: gap || 'blocked_data',
      dataGapEvidence: evidence,
    };
  }
  throw new Error(`unknown genericClassification ${gc} @ ${key}`);
}

function emptyMechanismShell(partial) {
  return {
    key: '',
    status: 'blocked_data',
    completionMode: 'none',
    lane: 'generic_runtime',
    sourceKind: '',
    ownerId: '',
    skillKey: '',
    passiveName: '',
    mechanismTags: [],
    coverageBoundary: '',
    reason: '',
    blocker: '',
    dataGapEvidence: null,
    runtimeGapEvidence: null,
    outOfScopeEvidence: null,
    sourceRefs: [],
    evidenceRefs: [],
    aliases: [],
    dependencyOf: [],
    ...partial,
  };
}

function buildMechanismsFromG8(g8) {
  const mechanisms = [];
  for (const c of g8.candidates) {
    const mapped = mapG8ToUnified(c);
    const override = STATUS_OVERRIDES.get(c.candidateKey);
    let evidenceRefs = (c.coverageEvidence || []).map((e) => ({
      evidenceType: e.evidenceType || '',
      taskKey: e.taskKey || '',
      sourcePath: e.sourcePath || '',
      sourceWorktree: e.sourceWorktree || '',
      note: e.note || '',
    }));
    if (override?.evidenceRefs?.length) {
      const byKey = new Map(evidenceRefs.map((e) => [`${e.taskKey}|${e.sourcePath}`, e]));
      for (const e of override.evidenceRefs) {
        byKey.set(`${e.taskKey}|${e.sourcePath}`, {
          evidenceType: e.evidenceType || 'generic_batch',
          taskKey: e.taskKey || '',
          sourcePath: e.sourcePath || '',
          sourceWorktree: e.sourceWorktree || '',
          note: e.note || '',
        });
      }
      evidenceRefs = [...byKey.values()];
    }
    mechanisms.push(
      applyRuntimeGapToMechanism(
        emptyMechanismShell({
          key: c.candidateKey,
          status: mapped.status,
          completionMode: mapped.completionMode,
          lane: mapped.lane,
          sourceKind: c.sourceKind,
          ownerId: normalizeOwnerId(c.ownerId),
          skillKey: c.skillKey || '',
          passiveName: c.passiveName || '',
          mechanismTags: [...(c.genericMechanismTags || c.mechanismTags || [])].sort((a, b) =>
            a.localeCompare(b, 'en'),
          ),
          coverageBoundary: COVERAGE_BOUNDARIES.get(c.candidateKey) || '',
          reason: mapped.reason,
          blocker: mapped.blocker,
          dataGapEvidence: mapped.dataGapEvidence || override?.dataGapEvidence || null,
          runtimeGapEvidence: mapped.runtimeGapEvidence || override?.runtimeGapEvidence || null,
          outOfScopeEvidence:
            override?.outOfScopeEvidence
            || mapped.outOfScopeEvidence
            || c.outOfScopeEvidence
            || null,
          sourceRefs: [
            {
              path: G8_AUDIT_REL,
              legacyStatus: c.genericClassification,
              sourceRecordKey: c.candidateKey,
            },
            {
              // Registry + G8 are the canonical family primaries (candidateKey discriminator).
              path: REGISTRY_REL,
              legacyStatus: 'registry_candidate',
              sourceRecordKey: c.candidateKey,
            },
          ],
          evidenceRefs,
          aliases: [],
          dependencyOf: [],
        }),
      ),
    );
  }
  return mechanisms;
}

function attachAliases(mechanismsByKey) {
  for (const row of ALIAS_TABLE) {
    for (const key of row.mechanismKeys) {
      const m = mechanismsByKey.get(key);
      if (!m) {
        throw new Error(`alias ${row.alias} references missing mechanism ${key}`);
      }
      if (!m.aliases.includes(row.alias)) m.aliases.push(row.alias);
      m.sourceRefs.push({
        path: row.sourcePath,
        legacyStatus: row.superseded ? 'superseded_evidence' : 'alias_attachment',
        sourceRecordKey: row.alias,
      });
      if (row.note) {
        m.reason = `${m.reason} | ${row.note}`;
      }
      if (row.superseded && !m.aliases.includes('batch_l_superseded_by_batch_m')) {
        m.aliases.push('batch_l_superseded_by_batch_m');
      }
    }
  }
}

function dispositionFullItemContainer(row, relatedKeys) {
  const status = row.coverageStatus;
  const itemId = String(row.itemId);
  if (status === 'live_dps_passive_present') {
    return {
      disposition: 'regression_only',
      status: 'regression_only',
      relatedMechanismKeys: relatedKeys,
      reason: 'live DPS passive present; container is regression evidence for matching mechanism keys',
    };
  }
  if (status === 'adc_pool_passive_gap' || status === 'adc_pool_stats_only') {
    return {
      disposition: 'stale_or_duplicate',
      status: 'stale_or_duplicate',
      relatedMechanismKeys: relatedKeys,
      reason: 'ADC pool mechanism/data branches handled by canonical G8 keys',
    };
  }
  if (status === 'map11_stats_present_non_adc_pool' || status === 'special_or_non_map11') {
    return {
      disposition: 'out_of_scope',
      status: 'out_of_scope',
      relatedMechanismKeys: [],
      reason: 'non-ADC-pool or special/non-map11 container',
    };
  }
  if (status === 'future_full_item_passive_review') {
    // Deterministic rule: mode/large-id variants use itemId length > 4
    if (itemId.length > 4) {
      return {
        disposition: 'stale_or_duplicate',
        status: 'stale_or_duplicate',
        relatedMechanismKeys: [],
        reason: 'mode/large-id future variant of a base item; stale_or_duplicate by explicit rule',
      };
    }
    return {
      disposition: 'blocked_data',
      status: 'blocked_data',
      relatedMechanismKeys: [],
      reason: 'ordinary future full-item tooltip/passive review; blocked_data',
    };
  }
  throw new Error(`unknown full-item coverageStatus ${status} @ item ${itemId}`);
}

function buildFullItemCoverageRecords(fullItems, mechanismsByKey) {
  const byOwner = new Map();
  for (const m of mechanismsByKey.values()) {
    if (!m.ownerId) continue;
    if (!byOwner.has(m.ownerId)) byOwner.set(m.ownerId, []);
    byOwner.get(m.ownerId).push(m.key);
  }

  const records = [];
  const dispositionCounts = Object.create(null);

  for (const row of fullItems) {
    const ownerId = normalizeOwnerId(row.itemId);
    const relatedKeys = (byOwner.get(ownerId) || []).slice().sort((a, b) => a.localeCompare(b, 'en'));
    const disp = dispositionFullItemContainer(row, relatedKeys);
    dispositionCounts[disp.disposition] = (dispositionCounts[disp.disposition] || 0) + 1;

    records.push({
      coverageKey: `full_item_container|${ownerId}`,
      kind: 'full_item_container',
      ownerId,
      name: row.name || '',
      legacyCoverageStatus: row.coverageStatus,
      nextAction: row.nextAction || '',
      status: disp.status,
      disposition: disp.disposition,
      relatedMechanismKeys: disp.relatedMechanismKeys,
      reason: disp.reason,
      sourceRefs: [
        {
          path: '最小验证/V2-full-item-dps-coverage-20260615.json',
          legacyStatus: row.coverageStatus,
          sourceRecordKey: String(row.itemId),
        },
      ],
      skillRefs: row.skillRefs || [],
      evidenceRefs: row.evidenceRefs || [],
    });
  }

  // Assert disposition arithmetic from task
  const expected = {
    regression_only: 13, // live_dps_passive_present
    stale_or_duplicate_adc: 23 + 19, // gap + stats_only
    blocked_data_future: 35,
    out_of_scope: 126 + 289,
    stale_or_duplicate_large: 13,
  };
  const live = fullItems.filter((r) => r.coverageStatus === 'live_dps_passive_present').length;
  const gap = fullItems.filter((r) => r.coverageStatus === 'adc_pool_passive_gap').length;
  const stats = fullItems.filter((r) => r.coverageStatus === 'adc_pool_stats_only').length;
  const map11 = fullItems.filter((r) => r.coverageStatus === 'map11_stats_present_non_adc_pool').length;
  const special = fullItems.filter((r) => r.coverageStatus === 'special_or_non_map11').length;
  const future = fullItems.filter((r) => r.coverageStatus === 'future_full_item_passive_review');
  const futureLarge = future.filter((r) => String(r.itemId).length > 4).length;
  const futureOrdinary = future.length - futureLarge;

  if (fullItems.length !== 518) {
    throw new Error(`full-item containers must be 518, got ${fullItems.length}`);
  }
  if (live !== expected.regression_only) {
    throw new Error(`live_dps_passive_present expected 13, got ${live}`);
  }
  if (gap !== 23 || stats !== 19) {
    throw new Error(`adc_pool gap/stats expected 23/19, got ${gap}/${stats}`);
  }
  if (map11 !== 126 || special !== 289) {
    throw new Error(`map11/special expected 126/289, got ${map11}/${special}`);
  }
  if (futureOrdinary !== 35 || futureLarge !== 13) {
    throw new Error(
      `future ordinary/large expected 35/13, got ${futureOrdinary}/${futureLarge}`,
    );
  }
  if (records.length !== 518) {
    throw new Error(`coverage full-item records must be 518, got ${records.length}`);
  }
  for (const r of records) {
    if (!r.disposition) throw new Error(`missing disposition @ ${r.coverageKey}`);
  }

  return { records: stableSortBy(records, (r) => r.coverageKey), dispositionCounts };
}

function buildCoefficientCoverageRecords() {
  const records = [];
  const files = [
    { abs: paths.coeffBucketsA, rel: '最小验证/V2-BatchV-A-coefficient-buckets.json' },
    { abs: paths.coeffBucketsB, rel: '最小验证/V2-BatchV-B-3082-wardens-mail-coefficient-buckets.json' },
  ];
  const dependencyMap = {
    flat_post_percent: ['item_passive|2051|item_passive|无畏'],
    outgoing_damage_amp: ['item_passive|3036|item_passive|巨人杀手'],
    ad_flat_bonus: ['item_passive|3004|item_passive|敬畏'],
    target_armor_flat_bonus: ['item_passive|6665|item_passive|虚空天生'],
    target_magic_resist_flat_bonus: ['item_passive|6665|item_passive|虚空天生'],
  };

  for (const f of files) {
    if (!fs.existsSync(f.abs)) continue;
    const doc = readJson(f.abs);
    const buckets = doc.coefficientBuckets || [];
    for (const b of buckets) {
      const depOf = dependencyMap[b.bucketKey] || [];
      records.push({
        coverageKey: `coefficient_bucket|${b.bucketKey}`,
        kind: 'coefficient_bucket',
        ownerId: '',
        name: b.name || b.bucketKey,
        legacyCoverageStatus: 'coefficient_bucket',
        nextAction: 'dependency_only',
        status: 'regression_only',
        disposition: 'regression_only',
        relatedMechanismKeys: depOf,
        reason: 'Coefficient buckets are coverage/dependency records; not distinct gameplay mechanisms.',
        sourceRefs: [
          {
            path: f.rel,
            legacyStatus: 'coefficient_bucket',
            sourceRecordKey: b.bucketKey,
          },
        ],
        skillRefs: [],
        evidenceRefs: [],
        dependencyOf: depOf,
      });
    }
  }
  return stableSortBy(records, (r) => r.coverageKey);
}

function buildDataOnlyCoverageRecords() {
  const records = [];
  const dataOnlySeeds = [
    {
      path: '最小验证/V2-Batch-A-target-dummies.seed.json',
      note: 'Batch A target dummies prove baselines; not passive mechanisms',
    },
    {
      path: '最小验证/V2-Batch-C-adc-items.seed.json',
      note: 'Batch C ADC item stats baselines; not passive mechanisms',
    },
  ];
  for (const s of dataOnlySeeds) {
    const abs = path.join(repoRoot, s.path);
    if (!fs.existsSync(abs)) continue;
    const doc = readJson(abs);
    records.push({
      coverageKey: `data_only_seed|${path.basename(s.path)}`,
      kind: 'data_only_seed',
      ownerId: '',
      name: path.basename(s.path),
      legacyCoverageStatus: 'data_only',
      nextAction: 'baseline_only',
      status: 'regression_only',
      disposition: 'regression_only',
      relatedMechanismKeys: [],
      reason: s.note,
      sourceRefs: [
        {
          path: s.path,
          legacyStatus: 'data_only',
          sourceRecordKey: doc.versionCode || path.basename(s.path),
        },
      ],
      skillRefs: [],
      evidenceRefs: [],
      itemCount: (doc.items || []).length,
      heroCount: (doc.heroes || []).length,
    });
  }
  return stableSortBy(records, (r) => r.coverageKey);
}

/**
 * Nonstandard Katarina MVP seed: one coverage-layer bundle record.
 * basic-attack is shared baseline inside the bundle; only R is a related mechanism key.
 * Must not contradict Batch-J keep_mechanics_config / regression_only disposition.
 */
function assertKatarinaSeedCompatibleWithBatchJ(mechanismsByKey) {
  const m = mechanismsByKey.get(KATARINA_R_KEY);
  if (!m) {
    throw new Error(`missing required mechanism ${KATARINA_R_KEY} for Katarina legacy seed`);
  }
  if (
    m.status !== 'regression_only' ||
    m.completionMode !== 'none' ||
    m.lane !== 'legacy_single_attacker_dps'
  ) {
    throw new Error(
      `Katarina seed contradicts Batch-J disposition for ${KATARINA_R_KEY}: ` +
        `status=${m.status} completionMode=${m.completionMode} lane=${m.lane} ` +
        `(expected regression_only/none/legacy_single_attacker_dps)`,
    );
  }
  const batchJ = (m.sourceRefs || []).find(
    (r) =>
      r.path === '最小验证/V2-Batch-J-status-damage-audit.json' &&
      r.sourceRecordKey === 'skill_katarina_r',
  );
  if (!batchJ || batchJ.legacyStatus !== 'keep_mechanics_config') {
    throw new Error(
      `Katarina seed contradicts Batch-J disposition for ${KATARINA_R_KEY}: ` +
        `expected Batch-J sourceRef skill_katarina_r/keep_mechanics_config, got ${JSON.stringify(batchJ)}`,
    );
  }
}

function attachKatarinaLegacySeedSourceRef(mechanismsByKey) {
  assertKatarinaSeedCompatibleWithBatchJ(mechanismsByKey);
  const m = mechanismsByKey.get(KATARINA_R_KEY);
  const exists = m.sourceRefs.some(
    (r) => r.path === KATARINA_LEGACY_SEED_REL && r.sourceRecordKey === 'skill_katarina_r',
  );
  if (!exists) {
    m.sourceRefs.push({
      path: KATARINA_LEGACY_SEED_REL,
      legacyStatus: 'legacy_mvp_seed',
      sourceRecordKey: 'skill_katarina_r',
    });
  }
  // Preserve Batch-J classification; do not mutate status/completionMode/lane.
  if (
    m.status !== 'regression_only' ||
    m.completionMode !== 'none' ||
    m.lane !== 'legacy_single_attacker_dps'
  ) {
    throw new Error(`Katarina R classification mutated after seed attach: ${m.status}/${m.completionMode}/${m.lane}`);
  }
}

function buildKatarinaLegacySeedCoverageRecord() {
  if (!fs.existsSync(paths.katarinaLegacySeed)) {
    throw new Error(`missing required Katarina legacy seed ${KATARINA_LEGACY_SEED_REL}`);
  }
  const doc = readJson(paths.katarinaLegacySeed);
  const skillIds = (doc.skills || []).map((s) => s.skillId);
  if (!skillIds.includes('skill_katarina_r')) {
    throw new Error('Katarina legacy seed missing skill_katarina_r');
  }
  if (!skillIds.includes('skill_katarina_basic_attack')) {
    throw new Error('Katarina legacy seed missing skill_katarina_basic_attack baseline');
  }
  return {
    coverageKey: `legacy_seed_bundle|${path.basename(KATARINA_LEGACY_SEED_REL)}`,
    kind: 'legacy_seed_bundle',
    ownerId: 'hero_katarina',
    name: path.basename(KATARINA_LEGACY_SEED_REL),
    legacyCoverageStatus: 'legacy_mvp_seed',
    nextAction: 'regression_evidence_only',
    status: 'regression_only',
    disposition: 'regression_only',
    relatedMechanismKeys: [KATARINA_R_KEY],
    reason:
      'Historical legacy_single_attacker_dps seed evidence (skill_katarina_r + shared skill_katarina_basic_attack baseline); not current generic ABI compile/run proof.',
    sourceRefs: [
      {
        path: KATARINA_LEGACY_SEED_REL,
        legacyStatus: 'legacy_mvp_seed',
        sourceRecordKey: doc.versionCode || path.basename(KATARINA_LEGACY_SEED_REL),
      },
    ],
    skillRefs: skillIds,
    evidenceRefs: [],
    itemCount: (doc.items || []).length,
    heroCount: (doc.heroes || []).length,
    scenarioCount: (doc.scenarios || []).length,
  };
}

function attachSeedSourceRefs(mechanismsByKey) {
  for (const row of SEED_REFERENCE_ATTACHMENTS) {
    if (!HISTORICAL_SOURCE_REF_PATHS.has(row.path) && !ACTIVE_SOURCE_PATHS.has(row.path)) {
      throw new Error(`SEED_REFERENCE_ATTACHMENTS path not allowlisted: ${row.path}`);
    }
    const m = mechanismsByKey.get(row.mechanismKey);
    if (!m) {
      throw new Error(`SEED_REFERENCE_ATTACHMENTS missing mechanism ${row.mechanismKey}`);
    }
    const exists = m.sourceRefs.some(
      (r) => r.path === row.path && r.sourceRecordKey === row.sourceRecordKey,
    );
    if (!exists) {
      m.sourceRefs.push({
        path: row.path,
        legacyStatus: row.legacyStatus,
        sourceRecordKey: row.sourceRecordKey,
      });
    }
    if (row.alias && !m.aliases.includes(row.alias)) {
      m.aliases.push(row.alias);
    }
  }
}

function linkCoefficientDependencies(mechanismsByKey, coeffRecords) {
  for (const rec of coeffRecords) {
    for (const key of rec.dependencyOf || []) {
      const m = mechanismsByKey.get(key);
      if (!m) continue;
      if (!m.dependencyOf.includes(rec.coverageKey)) {
        // dependencyOf on mechanism lists coverage keys this mechanism depends on
        m.dependencyOf.push(rec.coverageKey);
      }
    }
  }
}

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

const OOS_SEMANTIC_FIELDS = [
  'boundaryCategory',
  'excludedBehavior',
  'boundaryReason',
  'damageRelevantSubBranchDisposition',
];

function hasExplicitOosSemantics(ev) {
  if (!ev || typeof ev !== 'object') return false;
  if (ev.reviewedPrimaryTargetDamageBranch !== true) return false;
  if (!BOUNDARY_CATEGORIES.has(String(ev.boundaryCategory || ''))) return false;
  for (const field of OOS_SEMANTIC_FIELDS) {
    if (!String(ev[field] || '').trim()) return false;
  }
  if (
    GENERIC_OOS_REASON_RE.test(String(ev.boundaryReason || ''))
    || STALE_OTHER_TARGETS_REASON_RE.test(String(ev.boundaryReason || ''))
  ) {
    return false;
  }
  return true;
}

/**
 * Fill provenance/display fields only when semantic fields are already explicit.
 * Never synthesize semantic fields from source prose.
 */
function fillOosProvenanceDisplay(ev, mechanism, g8) {
  const out = { ...ev };
  if (!String(out.sourceRef || '').trim()) {
    if (g8?.outOfScopeEvidence?.sourceRef) {
      out.sourceRef = g8.outOfScopeEvidence.sourceRef;
    } else if (mechanism.sourceRefs?.[0]) {
      out.sourceRef = `${mechanism.sourceRefs[0].path}#${mechanism.sourceRefs[0].sourceRecordKey}`;
    } else {
      throw new Error(`out_of_scope missing sourceRef provenance @ ${mechanism.key}`);
    }
  }
  if (!String(out.sourceTextSummary || '').trim()) {
    if (g8?.outOfScopeEvidence?.sourceTextSummary) {
      out.sourceTextSummary = g8.outOfScopeEvidence.sourceTextSummary;
    } else if (String(g8?.sourceText || '').trim()) {
      out.sourceTextSummary = String(g8.sourceText).replace(/\s+/g, ' ').trim().slice(0, 180);
    } else if (String(mechanism.reason || '').trim()) {
      out.sourceTextSummary = String(mechanism.reason).replace(/\s+/g, ' ').trim().slice(0, 180);
    } else {
      throw new Error(`out_of_scope missing sourceTextSummary display @ ${mechanism.key}`);
    }
  }
  return out;
}

function ensureOutOfScopeEvidence(mechanisms, g8ByKey) {
  for (const m of mechanisms) {
    if (m.status !== 'out_of_scope') {
      m.outOfScopeEvidence = m.outOfScopeEvidence || null;
      continue;
    }
    const override = STATUS_OVERRIDES.get(m.key);
    const g8 = g8ByKey?.get(m.key);

    // G8-backed OOS: copy full G8 outOfScopeEvidence; do not synthesize semantics from text.
    if (g8?.genericClassification === 'out_of_scope' && g8.outOfScopeEvidence) {
      if (!hasExplicitOosSemantics(g8.outOfScopeEvidence)) {
        throw new Error(`G8 out_of_scopeEvidence incomplete (fail-closed) @ ${m.key}`);
      }
      m.outOfScopeEvidence = { ...g8.outOfScopeEvidence };
      m.reason = override?.reason || g8.outOfScopeEvidence.boundaryReason || m.reason;
      continue;
    }

    // Non-G8 extras / STATUS_OVERRIDE OOS: require explicit override semantics.
    const explicit =
      override?.outOfScopeEvidence
      || m.outOfScopeEvidence
      || null;
    if (!hasExplicitOosSemantics(explicit)) {
      throw new Error(
        `out_of_scope missing explicit semantic fields (fail-closed, no prose synthesis) @ ${m.key}`,
      );
    }
    m.outOfScopeEvidence = fillOosProvenanceDisplay(explicit, m, g8);
    m.reason = override?.reason || explicit.boundaryReason || m.reason;
  }
}
function buildSummary(sources, coverageRecords, mechanisms) {
  const statusCounts = Object.create(null);
  const completionModeCounts = Object.create(null);
  const laneCounts = Object.create(null);
  for (const s of STATUS_VALUES) statusCounts[s] = 0;
  for (const c of COMPLETION_MODES) completionModeCounts[c] = 0;
  for (const l of LANES) laneCounts[l] = 0;

  for (const m of mechanisms) {
    statusCounts[m.status] = (statusCounts[m.status] || 0) + 1;
    completionModeCounts[m.completionMode] = (completionModeCounts[m.completionMode] || 0) + 1;
    laneCounts[m.lane] = (laneCounts[m.lane] || 0) + 1;
  }

  const actionableKeys = mechanisms
    .filter((m) =>
      ['partial_actionable', 'ready_to_implement'].includes(m.status),
    )
    .map((m) => m.key)
    .sort((a, b) => a.localeCompare(b, 'en'));

  const fullItemCoverageCount = coverageRecords.filter((r) => r.kind === 'full_item_container').length;

  return {
    sourceCount: sources.length,
    coverageRecordCount: coverageRecords.length,
    fullItemContainerCount: fullItemCoverageCount,
    deduplicatedMechanismCount: mechanisms.length,
    statusCounts,
    completionModeCounts,
    laneCounts,
    actionableKeyCount: actionableKeys.length,
    actionableKeys,
  };
}

function validateInventory(inv) {
  const errors = [];
  if (inv.metadata?.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  }
  const keys = new Set();
  for (const m of inv.mechanisms || []) {
    if (!m.key) errors.push('empty mechanism key');
    if (keys.has(m.key)) errors.push(`duplicate mechanism key ${m.key}`);
    keys.add(m.key);
    if (!STATUS_VALUES.includes(m.status)) errors.push(`invalid status ${m.status} @ ${m.key}`);
    if (!COMPLETION_MODES.includes(m.completionMode)) {
      errors.push(`invalid completionMode ${m.completionMode} @ ${m.key}`);
    }
    if (!LANES.includes(m.lane)) errors.push(`invalid lane ${m.lane} @ ${m.key}`);
  }

  const statusSum = Object.values(inv.summary.statusCounts || {}).reduce((a, b) => a + b, 0);
  if (statusSum !== inv.mechanisms.length) {
    errors.push(`statusCounts sum ${statusSum} != mechanisms.length ${inv.mechanisms.length}`);
  }
  if (inv.summary.deduplicatedMechanismCount !== inv.mechanisms.length) {
    errors.push('summary.deduplicatedMechanismCount mismatch');
  }
  if (inv.summary.sourceCount !== inv.sources.length) {
    errors.push('summary.sourceCount mismatch');
  }
  if (inv.summary.coverageRecordCount !== inv.coverageRecords.length) {
    errors.push('summary.coverageRecordCount mismatch');
  }

  for (const s of inv.sources) {
    if (!/^[0-9a-f]{64}$/.test(s.sha256 || '')) {
      errors.push(`invalid sha256 @ ${s.path}`);
    }
    if (!s.path || s.path.includes('\\') || /^[A-Za-z]:/.test(s.path)) {
      errors.push(`non-portable path @ ${s.path}`);
    }
  }

  const fullItems = (inv.coverageRecords || []).filter((r) => r.kind === 'full_item_container');
  if (fullItems.length !== 518) {
    errors.push(`full-item coverageRecords expected 518, got ${fullItems.length}`);
  }
  for (const r of fullItems) {
    if (!r.disposition) errors.push(`missing disposition @ ${r.coverageKey}`);
  }

  // Required spot checks
  const m3302a = inv.mechanisms.find((m) => m.key === 'item_passive|3302|item_passive|晦影');
  const m3302b = inv.mechanisms.find((m) => m.key === 'item_passive|3302|item_passive|交相');
  const m3124 = inv.mechanisms.find((m) => m.key === 'item_passive|3124|item_passive|沸腾打击');
  const m3071 = inv.mechanisms.find((m) => m.key === 'item_passive|3071|item_passive|切割');
  const m3071Rage = inv.mechanisms.find((m) => m.key === 'item_passive|3071|item_passive|热烈');
  const m2051 = inv.mechanisms.find((m) => m.key === 'item_passive|2051|item_passive|无畏');
  const m3082 = inv.mechanisms.find((m) => m.key === 'item_passive|3082|item_passive|坚如磐石');
  const m6665 = inv.mechanisms.find((m) => m.key === 'item_passive|6665|item_passive|虚空天生');
  const mKaisaP = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kaisa|P|体表活肤');
  const mTwitchP = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_twitch|P|死亡毒液');
  const mMalzaharE = inv.mechanisms.find((m) => m.key === MALZAHAR_E_KEY);
  const mVarusW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_varus|W|枯萎箭袋');
  const mAsheQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_ashe|Q|射手的专注');
  const mDravenW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_draven|W|血性冲刺');
  const mQuinnP = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_quinn|P|侵扰');
  const mQuinnE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_quinn|E|旋翔掠杀');
  const mQuinnQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_quinn|Q|炫目攻势');
  const mQuinnW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_quinn|W|敏锐感知');
  const mKogmawQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kogmaw|Q|腐蚀唾液');
  const mXayahQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_xayah|Q|双刃');
  const mXayahR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_xayah|R|暴风羽刃');
  const mXayahW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_xayah|W|致死羽衣');
  const mJinxW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_jinx|W|震荡电磁波！');
  const mJinxE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_jinx|E|嚼火者手雷！');
  const mJhinQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_jhin|Q|曼舞手雷');
  const mJhinW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_jhin|W|致命华彩');
  const mCaitlynE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_caitlyn|E|90口径绳网');
  const mKalistaQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kalista|Q|穿刺');
  const mCaitlynQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_caitlyn|Q|和平使者');
  const mLucianQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_lucian|Q|透体圣光');
  const mLucianW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_lucian|W|热诚烈弹');
  const mLucianR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_lucian|R|圣枪洗礼');
  const mCaitlynR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_caitlyn|R|让子弹飞');
  const mTristanaQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_tristana|Q|急速射击');
  const mTristanaR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_tristana|R|毁灭射击');
  const mTristanaW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_tristana|W|火箭跳跃');
  const mCorkiQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_corki|Q|磷光炸弹');
  const m3748a = inv.mechanisms.find(
    (m) => m.key === 'item_passive|3748|item_passive|顺劈|数据参考/item.json#data.3748|71fa0f0c',
  );
  const m3748b = inv.mechanisms.find(
    (m) => m.key === 'item_passive|3748|item_passive|顺劈|数据参考/item.json#data.3748|020f8b5a',
  );
  const m2501Tyranny = inv.mechanisms.find((m) => m.key === 'item_passive|2501|item_passive|专横');
  const m3075Thorns = inv.mechanisms.find((m) => m.key === 'item_passive|3075|item_passive|荆棘');
  const m3097Bolt = inv.mechanisms.find((m) => m.key === 'item_passive|3097|item_passive|弩箭');
  const m3097Energized = inv.mechanisms.find((m) => m.key === 'item_passive|3097|item_passive|盈能');
  if (!m3302a || m3302a.status !== 'completed') errors.push('3302 晦影 must be completed');
  if (
    !m3302b ||
    m3302b.status !== 'completed' ||
    m3302b.completionMode !== 'full' ||
    m3302b.lane !== 'generic_runtime' ||
    m3302b.blocker ||
    !String(m3302b.reason || '').includes('4030984') ||
    !String(m3302b.reason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    ) ||
    !String(m3302b.reason || '').includes('首击 Light') ||
    !String(m3302b.reason || '').includes('refresh_on_write') ||
    !String(m3302b.reason || '').includes('6@1') ||
    !String(m3302b.reason || '').includes('10%') ||
    !String(m3302b.reason || '').includes('generic_terminus_juxtaposition_test.go') ||
    !(m3302b.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_terminus_juxtaposition_test.go',
    ) ||
    !(m3302b.evidenceRefs || []).some(
      (e) =>
        e.sourcePath === 'db/game_manage/seeds/lol_generic_terminus_juxtaposition_seed.sql',
    )
  ) {
    errors.push(
      '3302 交相 must be completed/full/generic_runtime with Wiki revid/hash, first-Light + aggregate refresh + pp/10% wording, and wasm+planned-backend evidence',
    );
  }
  if (!m3124 || m3124.status !== 'completed' || m3124.completionMode !== 'full') {
    errors.push('3124 沸腾打击 must be completed/full');
  }
  if (
    !m2501Tyranny ||
    m2501Tyranny.status !== 'completed' ||
    m2501Tyranny.completionMode !== 'full' ||
    m2501Tyranny.lane !== 'generic_runtime' ||
    m2501Tyranny.blocker ||
    !String(m2501Tyranny.reason || '').includes('2.5%') ||
    !String(m2501Tyranny.reason || '').includes('generic_wiki_ready_items_test.go') ||
    !(m2501Tyranny.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_wiki_ready_items_test.go',
    ) ||
    !(m2501Tyranny.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_wiki_ready_items_seed.sql',
    )
  ) {
    errors.push(
      '2501 专横 must be completed/full/generic_runtime with wiki-ready wasm+backend evidence refs',
    );
  }
  const m2501Retribution = inv.mechanisms.find((m) => m.key === 'item_passive|2501|item_passive|报复');
  if (
    !m2501Retribution ||
    m2501Retribution.status !== 'completed' ||
    m2501Retribution.completionMode !== 'full' ||
    m2501Retribution.lane !== 'generic_runtime' ||
    m2501Retribution.blocker ||
    !String(m2501Retribution.reason || '').includes('0.12') ||
    !String(m2501Retribution.reason || '').includes('multiply') ||
    !String(m2501Retribution.reason || '').includes('generic_wiki_ready_items_test.go') ||
    !String(m2501Retribution.reason || '').includes('manifest.json@revid4030984') ||
    !String(m2501Retribution.reason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    ) ||
    citesForbiddenProvenance(m2501Retribution.reason) ||
    !(m2501Retribution.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_wiki_ready_items_test.go',
    ) ||
    !(m2501Retribution.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_wiki_ready_items_seed.sql',
    )
  ) {
    errors.push(
      '2501 报复 must be completed/full/generic_runtime with Wiki revid/hash provenance and wiki-ready wasm+backend evidence refs',
    );
  }
  if (
    !m3075Thorns ||
    m3075Thorns.status !== 'completed' ||
    m3075Thorns.completionMode !== 'full' ||
    m3075Thorns.lane !== 'generic_runtime' ||
    m3075Thorns.blocker ||
    !String(m3075Thorns.reason || '').includes('20(+10% bonus armor)') ||
    !String(m3075Thorns.reason || '').includes('generic_wiki_ready_items_test.go') ||
    !(m3075Thorns.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_wiki_ready_items_test.go',
    ) ||
    !(m3075Thorns.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_wiki_ready_items_seed.sql',
    )
  ) {
    errors.push(
      '3075 荆棘 must be completed/full/generic_runtime with wiki-ready wasm+backend evidence refs',
    );
  }
  if (
    !m3097Bolt ||
    m3097Bolt.status !== 'completed' ||
    m3097Bolt.completionMode !== 'full' ||
    m3097Bolt.lane !== 'generic_runtime' ||
    m3097Bolt.blocker ||
    !String(m3097Bolt.reason || '').includes('charge=100') ||
    !String(m3097Bolt.reason || '').includes('generic_wiki_ready_items_test.go') ||
    !(m3097Bolt.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_wiki_ready_items_test.go',
    ) ||
    !(m3097Bolt.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_wiki_ready_items_seed.sql',
    )
  ) {
    errors.push(
      '3097 弩箭 must be completed/full/generic_runtime with wiki-ready wasm+backend evidence refs',
    );
  }
  if (
    !m3097Energized ||
    m3097Energized.status !== 'blocked_data' ||
    m3097Energized.completionMode !== 'none' ||
    m3097Energized.blocker !== 'missing_precise_energize_move_and_attack_charge_rates_in_local_wiki' ||
    !m3097Energized.dataGapEvidence?.missingFields?.includes('move_charge_rate') ||
    !m3097Energized.dataGapEvidence?.missingFields?.includes('attack_charge_rate') ||
    !String(m3097Energized.dataGapEvidence?.sourceRef || '').includes(
      'manifest.json@revid4030984',
    ) ||
    !String(m3097Energized.dataGapEvidence?.sourceRef || '').includes(
      'current-items.normalized.json#item_3097/effects.pass',
    ) ||
    String(m3097Energized.dataGapEvidence?.sourceRef || '').includes(
      'build-unified-mechanism',
    )
  ) {
    errors.push(
      '3097 盈能 must remain blocked_data/none with missing precise energize charge-rate blocker and Wiki item provenance (not generator self-ref)',
    );
  }
  if (
    !m3071 ||
    m3071.status !== 'completed' ||
    m3071.completionMode !== 'full' ||
    m3071.blocker ||
    !String(m3071.reason || '').includes('6%') ||
    !String(m3071.reason || '').includes('generic_linked_effects_test.go') ||
    !(m3071.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-linked-effects-black-cleaver' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_linked_effects_test.go',
    ) ||
    !(m3071.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-linked-effects-black-cleaver' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_linked_effects_seed.sql',
    )
  ) {
    errors.push(
      '3071 切割 must be completed/full with 6%x5/6000ms reason and wasm+backend evidence refs',
    );
  }
  if (
    !m3071Rage ||
    m3071Rage.status !== 'out_of_scope' ||
    m3071Rage.completionMode !== 'none' ||
    m3071Rage.blocker
  ) {
    errors.push('3071 热烈 must be out_of_scope/none (movement-only, no damage branch)');
  }
  if (
    !m2051 ||
    m2051.status !== 'completed' ||
    m2051.completionMode !== 'full' ||
    m2051.lane !== 'generic_runtime' ||
    m2051.blocker ||
    !String(m2051.reason || '').includes('15') ||
    !String(m2051.reason || '').includes('3.75') ||
    !String(m2051.reason || '').includes('85') ||
    !String(m2051.reason || '').includes('96.25') ||
    !(m2051.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_c1_damage_event_pipeline_test.go',
    ) ||
    !(m2051.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_pipeline_damage_items_seed.sql',
    )
  ) {
    errors.push(
      '2051 无畏 must be completed/full/generic_runtime with pipeline damage wasm+backend evidence (non-G8 EXTRA path)',
    );
  }
  const c2051 = (inv.coverageRecords || []).find((r) => r.coverageKey === 'full_item_container|2051');
  if (!c2051 || c2051.status !== 'out_of_scope' || c2051.disposition !== 'out_of_scope') {
    errors.push('full_item_container|2051 must remain out_of_scope');
  }
  if (
    !m3082 ||
    m3082.status !== 'completed' ||
    m3082.completionMode !== 'full' ||
    m3082.lane !== 'generic_runtime' ||
    m3082.blocker ||
    !String(m3082.reason || '').includes('max(input-15,input*0.8)') ||
    !String(m3082.reason || '').includes('100→85') ||
    !(m3082.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_pipeline_damage_modifier_test.go',
    ) ||
    !(m3082.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_pipeline_damage_items_seed.sql',
    )
  ) {
    errors.push(
      '3082 坚如磐石 must be completed/full with pipeline damage wasm+backend evidence (non-G8 EXTRA path)',
    );
  }
  if (
    !m6665 ||
    m6665.status !== 'completed' ||
    m6665.completionMode !== 'full' ||
    m6665.lane !== 'generic_runtime' ||
    m6665.blocker ||
    m6665.runtimeGapEvidence !== null ||
    !String(m6665.coverageBoundary || '').includes('targetEquipmentEntityIds') ||
    !String(m6665.coverageBoundary || '').includes('bonus_armor') ||
    !String(m6665.coverageBoundary || '').includes('bonus_magic_resist') ||
    !String(m6665.coverageBoundary || '').includes('target_owned_provider_mount') ||
    !String(m6665.coverageBoundary || '').includes('t5000') ||
    !String(m6665.coverageBoundary || '').includes('idempotent') ||
    !String(m6665.reason || '').includes('targetEquipmentEntityIds') ||
    !String(m6665.reason || '').includes('88.5/88.5') ||
    !String(m6665.reason || '').includes('不声称 live migrate/publish') ||
    String(m6665.coverageBoundary || '').includes('synthetic') ||
    String(m6665.reason || '').includes('剩余真实') ||
    !(m6665.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'backend' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_jaksho_voidborn_resilience_seed.sql' &&
        String(e.note || '').includes('loadout_equipment'),
    ) ||
    !(m6665.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'web' &&
        (e.sourcePath === 'web/src/engine/combatDataAssembler.ts' ||
          e.sourcePath === 'web/src/engine/combatDataAssembler.test.ts') &&
        (String(e.note || '').includes('targetEquipmentEntityIds') ||
          String(e.note || '').includes('bonus')),
    ) ||
    !(m6665.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'wasm' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_jaksho_voidborn_resilience_test.go' &&
        String(e.note || '').includes('88.5/88.5') &&
        String(e.note || '').includes('5000'),
    ) ||
    !(m6665.aliases || []).includes('item_6665_jaksho_voidborn_resilience_batch_v_a') ||
    !(m6665.mechanismTags || []).includes('full_stack_resists') ||
    !(m6665.mechanismTags || []).includes('target_armor_flat_bonus') ||
    !(m6665.mechanismTags || []).includes('target_magic_resist_flat_bonus')
  ) {
    errors.push(
      '6665 虚空天生 must be completed/full/generic_runtime with null blocker/runtimeGap, real targetEquipmentEntityIds coverage boundary (no synthetic remaining gap), and backend loadout-eligibility + web assembler/test + wasm 75/75→88.5/88.5 evidence refs',
    );
  }
  if (
    !mKaisaP ||
    mKaisaP.status !== 'completed' ||
    mKaisaP.completionMode !== 'full' ||
    mKaisaP.lane !== 'generic_runtime' ||
    mKaisaP.blocker ||
    !String(mKaisaP.reason || '').includes('4038390') ||
    !String(mKaisaP.reason || '').includes('4000') ||
    !String(mKaisaP.reason || '').includes('排除') ||
    !(mKaisaP.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_kaisa_second_skin_test.go',
    ) ||
    !(mKaisaP.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_kaisa_second_skin_seed.sql',
    )
  ) {
    errors.push(
      "Kaisa P must be completed/full under completed Second Skin canonical generic scope with wasm+backend evidence",
    );
  }
  if (
    !mTwitchP ||
    mTwitchP.status !== 'completed' ||
    mTwitchP.completionMode !== 'full' ||
    mTwitchP.lane !== 'generic_runtime' ||
    mTwitchP.blocker ||
    mTwitchP.runtimeGapEvidence ||
    hasNonEmptyDataMissingFields(mTwitchP.dataGapEvidence) ||
    !String(mTwitchP.reason || '').includes('4013286') ||
    !String(mTwitchP.reason || '').includes(
      '1567c0efec7f9e9021f6dc02410f92262dfa30128acc457c531199dbc9121b44',
    ) ||
    !String(mTwitchP.reason || '').includes('8612d0d') ||
    !String(mTwitchP.reason || '').includes('92e100e') ||
    !String(mTwitchP.reason || '').includes('5a0931a') ||
    !String(mTwitchP.reason || '').includes('7cb8b1d') ||
    !String(mTwitchP.reason || '').includes('anchored') ||
    !String(mTwitchP.reason || '').includes('regression') ||
    /missing_poison_dot_stack_runtime/i.test(String(mTwitchP.reason || '')) ||
    !(mTwitchP.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_twitch_deadly_venom_test.go',
    ) ||
    !(mTwitchP.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_anchored_tick_test.go',
    ) ||
    !(mTwitchP.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_twitch_deadly_venom_seed.sql',
    ) ||
    !(mTwitchP.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'web' &&
        (e.sourcePath === 'web/src/engine/combatDataAssembler.ts' ||
          e.sourcePath === 'web/src/engine/combatDataAssembler.test.ts'),
    )
  ) {
    errors.push(
      'Twitch P must be completed/full/generic_runtime with cleared poison-DoT blocker, Wiki rev4013286/SHA + ABI/Backend/Web/exact-test evidence, and legacy DPS only as regression',
    );
  }
  const malzaharTags = [...(mMalzaharE?.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en'));
  const malzaharExpectedTags = [
    'active_ability',
    'anchored_provider_tick',
    'periodic_magic_damage',
  ];
  if (
    !mMalzaharE ||
    mMalzaharE.status !== 'completed' ||
    mMalzaharE.completionMode !== 'full' ||
    mMalzaharE.lane !== 'generic_runtime' ||
    mMalzaharE.blocker ||
    mMalzaharE.dataGapEvidence !== null ||
    mMalzaharE.runtimeGapEvidence !== null ||
    mMalzaharE.coverageBoundary !== 'phase_a_rank5_primary_target_anchored_dot' ||
    malzaharTags.join('|') !== malzaharExpectedTags.join('|') ||
    !String(mMalzaharE.reason || '').includes(String(MALZAHAR_E_REVISION_ID)) ||
    !String(mMalzaharE.reason || '').includes(MALZAHAR_E_CONTENT_SHA256) ||
    !String(mMalzaharE.reason || '').includes('100') ||
    !String(mMalzaharE.reason || '').includes('7000') ||
    !String(mMalzaharE.reason || '').includes('4000') ||
    !String(mMalzaharE.reason || '').includes('250') ||
    !String(mMalzaharE.reason || '').includes('13.75') ||
    !String(mMalzaharE.reason || '').includes('0.05') ||
    !String(mMalzaharE.reason || '').includes('220') ||
    !String(mMalzaharE.reason || '').includes('0.80') ||
    !String(mMalzaharE.reason || '').includes('Batch-J') ||
    !String(mMalzaharE.reason || '').includes('regression') ||
    !String(mMalzaharE.reason || '').includes('排除') ||
    /status_resource_dot_migration_runtime|legacy_single_attacker_dps|status_resource_migration/i.test(
      `${mMalzaharE.status}|${mMalzaharE.lane}|${(mMalzaharE.mechanismTags || []).join('|')}|${mMalzaharE.blocker}|${mMalzaharE.reason}|${mMalzaharE.coverageBoundary}`,
    ) ||
    /tick_damage\+1\.0AP|1000ms|rank1\s*5\.6/i.test(String(mMalzaharE.reason || '')) ||
    !(mMalzaharE.sourceRefs || []).some(
      (r) =>
        r.path === MALZAHAR_E_WIKI_REL &&
        r.sourceRecordKey === MALZAHAR_E_KEY &&
        r.legacyStatus === 'current_wiki_sidecar',
    ) ||
    !(mMalzaharE.sourceRefs || []).some(
      (r) =>
        r.path === '最小验证/V2-Batch-J-status-damage-audit.json' &&
        r.sourceRecordKey === 'skill_malzahar_e' &&
        r.legacyStatus === 'historical_reference',
    ) ||
    !(mMalzaharE.sourceRefs || []).some(
      (r) =>
        r.path === '最小验证/V2-Batch-J-status-damage-migration.seed.json' &&
        r.sourceRecordKey === 'skill_malzahar_e' &&
        r.legacyStatus === 'data_only_regression',
    ) ||
    !(mMalzaharE.aliases || []).includes('skill_malzahar_e') ||
    !(mMalzaharE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-malzahar-malefic-visions' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_malzahar_malefic_visions_test.go' &&
        e.sourceWorktree === 'wasm',
    ) ||
    !(mMalzaharE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-anchored-provider-tick' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_anchored_tick_test.go' &&
        e.sourceWorktree === 'wasm',
    ) ||
    !(mMalzaharE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-malzahar-malefic-visions' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_malzahar_malefic_visions_seed.sql' &&
        e.sourceWorktree === 'backend',
    ) ||
    !(mMalzaharE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-malzahar-malefic-visions' &&
        e.sourceWorktree === 'web' &&
        e.sourcePath === 'web/src/engine/combatDataAssembler.ts',
    ) ||
    !(mMalzaharE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-malzahar-malefic-visions' &&
        e.sourceWorktree === 'web' &&
        e.sourcePath === 'web/src/engine/combatDataAssembler.test.ts',
    )
  ) {
    errors.push(
      'Malzahar E must be completed/full/generic_runtime with phase_a_rank5 anchored-DoT tags/boundary, cleared gaps, Wiki rev4015185/SHA + Wasm/Backend/Web evidence, Batch-J historical only, and no stale status_resource/Batch-J numeric truth',
    );
  }
  if (inv.mechanisms.some((m) => m.key !== MALZAHAR_E_KEY && (m.sourceRefs || []).some((r) => r.path === MALZAHAR_E_WIKI_REL))) {
    errors.push('Malzahar E Wiki sidecar sourceRef must not attach to non-Malzahar mechanisms');
  }
  if (
    !inv.sources.some(
      (s) =>
        s.path === MALZAHAR_E_WIKI_REL &&
        s.kind === 'document_json' &&
        s.recordCount === 0 &&
        s.role === 'document',
    )
  ) {
    errors.push(
      `sources missing document_json ${MALZAHAR_E_WIKI_REL} with recordCount 0 / role document`,
    );
  }
  if (!inv.metadata?.currentInputHashes?.[MALZAHAR_E_WIKI_REL]) {
    errors.push(`currentInputHashes missing ${MALZAHAR_E_WIKI_REL}`);
  }
  if ((inv.summary?.sourceCount || 0) !== 12) {
    errors.push(`sourceCount=${inv.summary?.sourceCount}, expected 12`);
  }
  if (
    !mVarusW ||
    mVarusW.status !== 'completed' ||
    mVarusW.completionMode !== 'full' ||
    mVarusW.lane !== 'generic_runtime' ||
    mVarusW.blocker ||
    mVarusW.dataGapEvidence !== null ||
    mVarusW.runtimeGapEvidence !== null ||
    mVarusW.outOfScopeEvidence !== null ||
    mVarusW.coverageBoundary !==
      'fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop' ||
    [...(mVarusW.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'active_missing_health',
        'passive_on_hit_magic',
        'target_blight_stack_consume',
        'w_scoped_max_charge_carrier',
      ].join('|') ||
    !String(mVarusW.reason || '').includes('4026472') ||
    !String(mVarusW.reason || '').includes(
      '16307174c4039d8ce71e639396328b2473f4a7e16247a7b2f8a183599b0901d2',
    ) ||
    !String(mVarusW.reason || '').includes(
      'fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop',
    ) ||
    !String(mVarusW.reason || '').includes('不宣称真实 Q') ||
    !(mVarusW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-varus-blighted-quiver' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_varus_blighted_quiver_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop',
        ),
    ) ||
    !(mVarusW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-varus-blighted-quiver' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_varus_blighted_quiver_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop',
        ),
    )
  ) {
    errors.push(
      'Varus W must be completed/full/generic_runtime with empty blocker, null gaps, exact blight tags/frozen boundary, and Backend/Wasm evidence (no real-Q/full-game claim)',
    );
  }
  if (!mAsheQ || mAsheQ.status !== 'completed' || mAsheQ.completionMode !== 'full') {
    errors.push('Ashe Q must be completed/full under user-approved Wiki scope');
  }
  const mAsheW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_ashe|W|万箭齐发');
  const mAkshanP = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_akshan|P|无所不用');
  const mAkshanE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_akshan|E|骄行荡寇');
  const mEzrealP = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_ezreal|P|咒能高涨');
  const mEzrealR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_ezreal|R|精准弹幕');
  const mEzrealE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_ezreal|E|奥术跃迁');
  const mEzrealQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_ezreal|Q|秘术射击');
  const mGravesP = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_graves|P|新命运');
  const mDravenQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_draven|Q|旋转飞斧');
  if (
    !mAsheW ||
    mAsheW.status !== 'completed' ||
    mAsheW.completionMode !== 'full' ||
    mAsheW.lane !== 'generic_runtime' ||
    mAsheW.blocker ||
    !String(mAsheW.reason || '').includes('200') ||
    !String(mAsheW.reason || '').includes('4000') ||
    !String(mAsheW.reason || '').includes('排除') ||
    !(mAsheW.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_ashe_volley_test.go',
    ) ||
    !(mAsheW.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_ashe_volley_seed.sql',
    )
  ) {
    errors.push(
      'Ashe W must be completed/full under user-approved Volley 1v1 scope with wasm+backend evidence',
    );
  }
  const mAsheR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_ashe|R|魔法水晶箭');
  const mAsheRReason = String(mAsheR?.reason || '');
  if (
    !mAsheR ||
    mAsheR.status !== 'completed' ||
    mAsheR.completionMode !== 'full' ||
    mAsheR.lane !== 'generic_runtime' ||
    mAsheR.blocker ||
    mAsheR.dataGapEvidence !== null ||
    mAsheR.runtimeGapEvidence !== null ||
    mAsheR.outOfScopeEvidence !== null ||
    mAsheR.coverageBoundary !==
      'rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight' ||
    [...(mAsheR.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mAsheR.mechanismTags || []).includes('multi_target_or_area') ||
    mAsheRReason.includes('multi_target_or_area') ||
    mAsheRReason.includes('implementation_gap_no_unresolved_data_fields') ||
    !mAsheRReason.includes('4026934') ||
    !mAsheRReason.includes(
      '1d9ccefa98a41e57a088e76aaca16f7a78141e7373616520e2d6ba13f450664f',
    ) ||
    !mAsheRReason.includes(
      'rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight',
    ) ||
    !mAsheRReason.includes('source.attr.ap.resolved') ||
    !mAsheRReason.includes('600') ||
    !mAsheRReason.includes('1.20') ||
    !mAsheRReason.includes('100 mana') ||
    !mAsheRReason.includes('60000') ||
    !mAsheRReason.includes('raw840') ||
    !mAsheRReason.includes('420') ||
    !mAsheRReason.includes('80') ||
    !mAsheRReason.includes('160') ||
    !mAsheRReason.includes('cast0.25') ||
    !mAsheRReason.includes('Effect at cast time start') ||
    !mAsheRReason.includes('distance-scaled stun') ||
    !mAsheRReason.includes('Frost') ||
    !mAsheRReason.includes('不宣称') ||
    !(mAsheR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-ashe-enchanted-crystal-arrow-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_ashe_enchanted_crystal_arrow_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight',
        ) &&
        String(e.note || '').includes('cast0.25') &&
        String(e.note || '').includes('Effect at cast time start'),
    ) ||
    !(mAsheR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-ashe-enchanted-crystal-arrow-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_ashe_enchanted_crystal_arrow_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight',
        ) &&
        String(e.note || '').includes('LolGenericAsheEnchantedCrystalArrowPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('5d4a13f') &&
        String(e.note || '').includes('2f820e4') &&
        String(e.note || '').includes('bb3dd81'),
    )
  ) {
    errors.push(
      'Ashe R must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Enchanted Crystal Arrow tags (no multi_target_or_area), Wiki rev4026934/SHA + frozen completedBoundary, numeric contract/100mana/60000CD/AP200→840/MR100→420/mana80/HP160, cast0.25/Effect-at-cast-time-start/distance-stun/AOE/Frost/sight exclusions, and bilateral wasm+backend evidence (owning 5d4a13f / integrated 2f820e4 / Wasm bb3dd81; no cast/projectile/stun/AOE/Frost/sight fidelity claim)',
    );
  }
  if (
    !mAkshanP ||
    mAkshanP.status !== 'blocked_data' ||
    mAkshanP.completionMode !== 'partial' ||
    mAkshanP.lane !== 'generic_runtime' ||
    mAkshanP.blocker !== 'second_shot_exact_delay_ms_not_published' ||
    !mAkshanP.dataGapEvidence?.missingFields?.includes('secondShotDelayMs') ||
    mAkshanP.dataGapEvidence?.blocker !== 'second_shot_exact_delay_ms_not_published' ||
    !String(mAkshanP.reason || '').includes('4038197') ||
    !String(mAkshanP.reason || '').includes(
      '22ba762382dedced4b63a451c4513cb3129e3b16a137236e5b637eea7510b534',
    ) ||
    !String(mAkshanP.reason || '').includes('dirty_fighting_stacks') ||
    mAkshanP.runtimeGapEvidence?.dataStatus !== 'partial' ||
    !(mAkshanP.runtimeGapEvidence?.missingPrimitives || []).includes(
      'accurate_ability_hit_event_wiring',
    ) ||
    !String(mAkshanP.runtimeGapEvidence?.completedBoundary || '').includes(
      'dirty_fighting_stacks',
    ) ||
    !String(mAkshanP.coverageBoundary || '').includes(
      'dirty_fighting_aa_stack_third_magic_core_complete',
    ) ||
    !(mAkshanP.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_akshan_dirty_fighting_test.go' &&
        e.sourceWorktree === 'wasm' &&
        e.taskKey === 'wasm-generic-akshan-dirty-fighting',
    ) ||
    !(mAkshanP.evidenceRefs || []).some(
      (e) =>
        e.sourcePath === 'db/game_manage/seeds/lol_generic_akshan_dirty_fighting_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        e.taskKey === 'wasm-generic-akshan-dirty-fighting',
    )
  ) {
    errors.push(
      'Akshan P must be blocked_data/partial/generic_runtime with Wiki rev4038197/SHA, secondShotDelayMs data gap, accurate_ability_hit_event_wiring runtime gap, and wasm+backend Dirty Fighting evidence (not ready_to_implement/full)',
    );
  }
  if (
    !mAkshanE ||
    mAkshanE.status !== 'out_of_scope' ||
    mAkshanE.completionMode !== 'none' ||
    mAkshanE.blocker ||
    mAkshanE.outOfScopeEvidence?.boundaryCategory !== 'explicit_user_scope' ||
    /击杀\/经济|economy_or_post_takedown/.test(String(mAkshanE.reason || ''))
  ) {
    errors.push(
      'Akshan E must be out_of_scope/none with explicit_user_scope (not economy/post-takedown mislabel)',
    );
  }
  const mAkshanQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_akshan|Q|去而复还');
  const mAkshanQReason = String(mAkshanQ?.reason || '');
  const mAkshanQBoundary =
    'rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity';
  if (
    !mAkshanQ ||
    !STATUS_OVERRIDES.has('hero_skill|hero_akshan|Q|去而复还') ||
    mAkshanQ.key !== 'hero_skill|hero_akshan|Q|去而复还' ||
    mAkshanQ.passiveName !== '去而复还' ||
    mAkshanQ.status !== 'completed' ||
    mAkshanQ.completionMode !== 'full' ||
    mAkshanQ.lane !== 'generic_runtime' ||
    mAkshanQ.blocker ||
    mAkshanQ.dataGapEvidence !== null ||
    mAkshanQ.runtimeGapEvidence !== null ||
    mAkshanQ.outOfScopeEvidence !== null ||
    mAkshanQ.coverageBoundary !== mAkshanQBoundary ||
    [...(mAkshanQ.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mAkshanQ.mechanismTags || []).includes('cooldown_or_haste_without_rotation') ||
    (mAkshanQ.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mAkshanQ.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mAkshanQ.mechanismTags || []).includes('primary_damage_branch_salvage') ||
    (mAkshanQ.mechanismTags || []).includes('total_ad_ratio') ||
    !(mAkshanQ.mechanismTags || []).includes('bonus_ad_ratio') ||
    !(mAkshanQ.mechanismTags || []).includes('active_physical_damage') ||
    mAkshanQReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mAkshanQReason.includes('blocked_data') ||
    mAkshanQReason.includes('cooldown_or_haste_without_rotation') ||
    mAkshanQReason.includes('needs_manual_baseline') ||
    mAkshanQReason.includes('out_of_scope_for_single_target_dps') ||
    mAkshanQReason.includes('dps_relevant_manual_review') ||
    mAkshanQReason.includes('primary_damage_branch_salvage') ||
    mAkshanQReason.includes('total AD；') ||
    mAkshanQReason.includes('total_ad_ratio') ||
    mAkshanQReason.includes('*totalAD') ||
    !mAkshanQReason.includes('4007510') ||
    !mAkshanQReason.includes(
      '1cbf7dda955849d05ad2d7e578ed9507f8f61fc7525c5ed006a25185915b5f5b',
    ) ||
    !mAkshanQReason.includes(
      '407e4671cc05e87edcd0038a9efe614ad98f65cd57ce339c2c9d69afe5b8c973',
    ) ||
    !mAkshanQReason.includes('Template:Data Akshan/Q') ||
    !mAkshanQReason.includes('Template:Data Akshan/Avengerang') ||
    !mAkshanQReason.includes('page1502462') ||
    !mAkshanQReason.includes('bytes2570') ||
    !mAkshanQReason.includes('2026-04-11T22:35:01Z') ||
    !mAkshanQReason.includes(mAkshanQBoundary) ||
    !mAkshanQReason.includes('source.attr.ad.resolved') ||
    !mAkshanQReason.includes('source.attr.ad.base') ||
    !mAkshanQReason.includes('exact nested binary') ||
    !mAkshanQReason.includes('bonus AD by explicit subtraction') ||
    !mAkshanQReason.includes('不得按 total-AD 直读') ||
    !mAkshanQReason.includes('165') ||
    !mAkshanQReason.includes('0.70') ||
    !mAkshanQReason.includes('80 mana') ||
    !mAkshanQReason.includes('5000') ||
    !mAkshanQReason.includes('immediate cooldown scaffold') ||
    !mAkshanQReason.includes('cooldown starts after return') ||
    !mAkshanQReason.includes('not a remaining blocker') ||
    !mAkshanQReason.includes('20220') ||
    !mAkshanQReason.includes('20170') ||
    !mAkshanQReason.includes('no 20230') ||
    !mAkshanQReason.includes('no explicit event op') ||
    !mAkshanQReason.includes('no Q ability-specific type') ||
    !mAkshanQReason.includes('base52/resolved52 raw165/final82.5') ||
    !mAkshanQReason.includes('base52/resolved152 raw235/final117.5') ||
    !mAkshanQReason.includes('base0/resolved100 versus base52/resolved152') ||
    !mAkshanQReason.includes('both raw/final235') ||
    !mAkshanQReason.includes('t4999') ||
    !mAkshanQReason.includes('t5000') ||
    !mAkshanQReason.includes('mana240') ||
    !mAkshanQReason.includes('mana79') ||
    !mAkshanQReason.includes('HP765') ||
    !mAkshanQReason.includes('ability_started') ||
    !mAkshanQReason.includes('Dirty Fighting/basic coexistence') ||
    !mAkshanQReason.includes('does not synthesize ability-hit stacks') ||
    !mAkshanQReason.includes('standalone') ||
    !mAkshanQReason.includes('external existing-data/check-only') ||
    !mAkshanQReason.includes('identity/panel/resource') ||
    !mAkshanQReason.includes('不暗示 Batch-B') ||
    !mAkshanQReason.includes('sibling Akshan synthesis') ||
    !mAkshanQReason.includes('production runtime/ABI/Web change') ||
    !mAkshanQReason.includes('focused12/full1010') ||
    !mAkshanQReason.includes('66516') ||
    !mAkshanQReason.includes(
      'dc922f4249cb87a5f6afda8f3a88dac011cc5a5683ff6c0a9a8c5cfd16618805',
    ) ||
    !mAkshanQReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mAkshanQReason.includes('不宣称') ||
    !mAkshanQReason.includes('no equivalence or contradiction claim') ||
    !mAkshanQReason.includes('exactly one selected-primary first-outbound-pass physical hit') ||
    mAkshanQReason.includes('canonical byte equivalence') ||
    mAkshanQReason.includes('Batch-B prerequisite') ||
    mAkshanQReason.includes('live published') ||
    !(mAkshanQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-akshan-avengerang-first-outbound-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_akshan_avengerang_first_outbound_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mAkshanQBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('b58a549') &&
        String(e.note || '').includes('407e4671') &&
        String(e.note || '').includes('20220') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no 20230') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('no Q type') &&
        String(e.note || '').includes('exact nested binary') &&
        String(e.note || '').includes('Dirty Fighting/basic coexistence') &&
        String(e.note || '').includes('does not synthesize ability-hit stacks') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mAkshanQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-akshan-avengerang-first-outbound-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_akshan_avengerang_first_outbound_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mAkshanQBoundary) &&
        String(e.note || '').includes('LolGenericAkshanAvengerangFirstOutboundHitSeedSqlTest') &&
        String(e.note || '').includes('bd8dbcb') &&
        String(e.note || '').includes('45d589a') &&
        String(e.note || '').includes('b58a549') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Akshan synthesis'),
    )
  ) {
    errors.push(
      'Akshan Q must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Avengerang ordered tags (no cooldown_or_haste_without_rotation/primary_damage_branch_salvage; requires bonus_ad_ratio/active_physical_damage), Wiki rev4007510/SHA + local raw caveat + frozen completedBoundary, rank5 80mana/immediate-cooldown-scaffold5000/one physical 165+0.70*bonusAD exact nested binary numerics/schedules (165→82.5/235→117.5; bonusAD counterproof; 20220/20170; no 20230; no Q type; no explicit event op; t0/t4999/t5000 mana240→80/HP765; mana79 skip; Dirty Fighting coexistence; no ability-hit stack synthesis), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-production-runtime-ABI-Web framing, focused12/full1010 + Wasm asset SHA, and bilateral evidence (owning bd8dbcb / integrated 45d589a / Wasm b58a549; one selected-primary first-outbound-pass physical hit not full Q; no direction/return/homing/cooldown-after-return/sight/MS/spellshield/live claim)',
    );
  }
  const mSivirQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_sivir|Q|回旋之刃');
  const mSivirQReason = String(mSivirQ?.reason || '');
  const mSivirQBoundary =
    'rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_base_160_plus_0_70_bonus_ad_plus_0_60_ap_scaled_by_0_to_0_40_formula_clamped_crit_chance; no_cast_time_bonus_attack_speed_direction_range_width_geometry_projectile_travel_speed_nonchampion_hit_reduction_return_pass_damage_modifier_reset_once_per_pass_spellshield_other_ranks_or_full_fidelity';
  if (
    !mSivirQ ||
    !STATUS_OVERRIDES.has('hero_skill|hero_sivir|Q|回旋之刃') ||
    mSivirQ.key !== 'hero_skill|hero_sivir|Q|回旋之刃' ||
    mSivirQ.passiveName !== '回旋之刃' ||
    mSivirQ.status !== 'completed' ||
    mSivirQ.completionMode !== 'full' ||
    mSivirQ.lane !== 'generic_runtime' ||
    mSivirQ.blocker ||
    mSivirQ.dataGapEvidence !== null ||
    mSivirQ.runtimeGapEvidence !== null ||
    mSivirQ.outOfScopeEvidence !== null ||
    mSivirQ.coverageBoundary !== mSivirQBoundary ||
    [...(mSivirQ.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'ap_ratio',
        'bonus_ad_ratio',
        'crit_scaling',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mSivirQ.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mSivirQ.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mSivirQ.mechanismTags || []).includes('blocked_data') ||
    (mSivirQ.mechanismTags || []).includes('primary_damage_branch_salvage') ||
    !(mSivirQ.mechanismTags || []).includes('bonus_ad_ratio') ||
    !(mSivirQ.mechanismTags || []).includes('ap_ratio') ||
    !(mSivirQ.mechanismTags || []).includes('crit_scaling') ||
    !(mSivirQ.mechanismTags || []).includes('active_physical_damage') ||
    mSivirQReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mSivirQReason.includes('blocked_data') ||
    mSivirQReason.includes('needs_manual_baseline') ||
    mSivirQReason.includes('dps_relevant_manual_review') ||
    mSivirQReason.includes('primary_damage_branch_salvage') ||
    mSivirQReason.includes('out_of_scope_for_single_target_dps') ||
    !mSivirQReason.includes('4016378') ||
    !mSivirQReason.includes(
      '0adcf3916b63e8b0ae6c2c7ad74d1796e3362a3a22682c58ef92aaccfae43e5e',
    ) ||
    !mSivirQReason.includes(
      'b8d46412519f211b27f2575684693f407806cbbca337a80e775a1baf4c2396a4',
    ) ||
    !mSivirQReason.includes(
      '2320f7ada83cceee979c52cd314395c6b41e2f50c50e3114e9bca0d39386ff02',
    ) ||
    !mSivirQReason.includes(
      'adeab85889a4208b52f0b6cd3bcc3aef022a986dcad5168e1c817e3ab3323fa9',
    ) ||
    !mSivirQReason.includes('Template:Data Sivir/Q') ||
    !mSivirQReason.includes('Template:Data Sivir/Boomerang Blade') ||
    !mSivirQReason.includes('page1308837') ||
    !mSivirQReason.includes('bytes2745') ||
    !mSivirQReason.includes('2026-05-11T05:05:57Z') ||
    !mSivirQReason.includes(mSivirQBoundary) ||
    !mSivirQReason.includes('(160+0.70*(ad.resolved-ad.base)+0.60*ap.resolved)*(1+0.40*min(1,max(0,crit_chance.resolved)))') ||
    !mSivirQReason.includes('formula-local') ||
    !mSivirQReason.includes('read path exactly once') ||
    !mSivirQReason.includes('no DB-bound/random crit') ||
    !mSivirQReason.includes('160') ||
    !mSivirQReason.includes('0.70') ||
    !mSivirQReason.includes('0.60') ||
    !mSivirQReason.includes('0.40') ||
    !mSivirQReason.includes('mana75') ||
    !mSivirQReason.includes('CD8000') ||
    !mSivirQReason.includes('20220') ||
    !mSivirQReason.includes('20170') ||
    !mSivirQReason.includes('no 20230') ||
    !mSivirQReason.includes('no explicit event op') ||
    !mSivirQReason.includes('no Q ability-specific type') ||
    !mSivirQReason.includes('raw290/348/406') ||
    !mSivirQReason.includes('final145/174/203') ||
    !mSivirQReason.includes('negative/overcap clamp') ||
    !mSivirQReason.includes('bonusAD/AP counterproof') ||
    !mSivirQReason.includes('t7999') ||
    !mSivirQReason.includes('t8000') ||
    !mSivirQReason.includes('mana225') ||
    !mSivirQReason.includes('mana74') ||
    !mSivirQReason.includes('HP652') ||
    !mSivirQReason.includes('ability_started') ||
    !mSivirQReason.includes('standalone') ||
    !mSivirQReason.includes('external existing-data/check-only') ||
    !mSivirQReason.includes('no Sivir materializer') ||
    !mSivirQReason.includes('identity/panel/resource') ||
    !mSivirQReason.includes('missing formula attrs read zero') ||
    !mSivirQReason.includes('not claimed fail-closed') ||
    !mSivirQReason.includes('regression/governance evidence only') ||
    !mSivirQReason.includes('production Wasm/public ABI/Web change') ||
    !mSivirQReason.includes('focused64/full1023') ||
    !mSivirQReason.includes('run-4db83782-b7af-4a56-8a75-2b687cc456a4') ||
    !mSivirQReason.includes('JUnit13 PASS') ||
    !mSivirQReason.includes('Essence Reaver') ||
    !mSivirQReason.includes('Twisted Fate') ||
    !mSivirQReason.includes('must BEGIN') ||
    !mSivirQReason.includes('Node smoke+bench') ||
    !mSivirQReason.includes('parity PASS') ||
    !mSivirQReason.includes('79086') ||
    !mSivirQReason.includes(
      '77a27da736577acc9a1bfd6728472a2b84c6a07353314528b115b112b917cc44',
    ) ||
    !mSivirQReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mSivirQReason.includes('不宣称') ||
    !mSivirQReason.includes('no equivalence or contradiction claim') ||
    !mSivirQReason.includes('exactly one selected-primary first-outbound hit, not full Q') ||
    !mSivirQReason.includes('no full-fidelity claim') ||
    !mSivirQReason.includes('no live/Admin/E2E claim') ||
    mSivirQReason.includes('canonical byte equivalence') ||
    mSivirQReason.includes('Batch-B prerequisite') ||
    mSivirQReason.includes('live published') ||
    !(mSivirQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-sivir-boomerang-blade-first-outbound-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_sivir_boomerang_blade_first_outbound_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mSivirQBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('bff4d160') &&
        String(e.note || '').includes('b8d46412') &&
        String(e.note || '').includes('20220') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no 20230') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('no Q type') &&
        String(e.note || '').includes('formula-local clamp') &&
        String(e.note || '').includes('raw290/348/406') &&
        String(e.note || '').includes('final145/174/203') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mSivirQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-sivir-boomerang-blade-first-outbound-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_sivir_boomerang_blade_first_outbound_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mSivirQBoundary) &&
        String(e.note || '').includes('LolGenericSivirBoomerangBladeFirstOutboundHitSeedSqlTest') &&
        String(e.note || '').includes('3ded9cb') &&
        String(e.note || '').includes('b14c48f') &&
        String(e.note || '').includes('bff4d160') &&
        String(e.note || '').includes('run-4db83782') &&
        String(e.note || '').includes('JUnit13 PASS') &&
        String(e.note || '').includes('Essence Reaver') &&
        String(e.note || '').includes('Twisted Fate') &&
        String(e.note || '').includes('must BEGIN') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('no Sivir materializer') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Sivir synthesis'),
    )
  ) {
    errors.push(
      'Sivir Q must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Boomerang Blade ordered tags (no dps_relevant_manual_review/blocked_data/salvage; requires bonus_ad_ratio/ap_ratio/crit_scaling/active_physical_damage), Wiki rev4016378/SHA + local raw caveat + frozen completedBoundary, rank5 mana75/CD8000/one physical (160+0.70*bonusAD+0.60*AP)*(1+0.40*clamp crit) nested binary read-once formula-local clamp numerics/schedules (290/348/406→145/174/203; negative/overcap clamp; bonusAD/AP counterproof; 20220/20170; no 20230; no Q type; no explicit event op; t0/t7999/t8000 mana225→75/HP652; mana74 skip; missing attrs read zero not fail-closed), standalone/external-existing-data/check-only/no-Sivir-materializer/no-Batch-B/no-sibling/no-production-Wasm-public-ABI-Web framing, READY run-4db83782 + focused64/full1023 + mirror JUnit13 PASS + Essence Reaver/Twisted Fate must BEGIN sibling caveat + Node smoke/parity + Wasm asset SHA, and bilateral evidence (owning 3ded9cb / integrated b14c48f / Wasm bff4d160; one selected-primary first-outbound hit not full Q; no cast/BAS/direction/return/spellshield/live/Admin/E2E/full-fidelity claim)',
    );
  }
  if (
    !mEzrealP ||
    mEzrealP.status !== 'completed' ||
    mEzrealP.completionMode !== 'full' ||
    mEzrealP.lane !== 'generic_runtime' ||
    mEzrealP.blocker ||
    !String(mEzrealP.reason || '').includes('6000') ||
    !String(mEzrealP.reason || '').includes('排除') ||
    !(mEzrealP.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_rising_spell_force_test.go',
    ) ||
    !(mEzrealP.evidenceRefs || []).some(
      (e) =>
        e.sourcePath === 'db/game_manage/seeds/lol_generic_ezreal_rising_spell_force_seed.sql',
    )
  ) {
    errors.push(
      'Ezreal P must be completed/full under bounded 1v1 Rising Spell Force scope with wasm+backend evidence',
    );
  }
  const mEzrealRReason = String(mEzrealR?.reason || '');
  if (
    !mEzrealR ||
    mEzrealR.status !== 'completed' ||
    mEzrealR.completionMode !== 'full' ||
    mEzrealR.lane !== 'generic_runtime' ||
    mEzrealR.blocker ||
    mEzrealR.dataGapEvidence !== null ||
    mEzrealR.runtimeGapEvidence !== null ||
    mEzrealR.outOfScopeEvidence !== null ||
    mEzrealR.coverageBoundary !==
      'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage' ||
    [...(mEzrealR.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mEzrealR.mechanismTags || []).includes('meta_or_non_target_dps') ||
    mEzrealRReason.includes('meta_or_non_target_dps') ||
    mEzrealRReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mEzrealRReason.includes('blocked_data') ||
    !mEzrealRReason.includes('4013235') ||
    !mEzrealRReason.includes(
      'e9d7f9d7411bcbb1ab00aeb89fe03a4fb8511625fc0a64266f5f63ced53580e0',
    ) ||
    !mEzrealRReason.includes(
      'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage',
    ) ||
    !mEzrealRReason.includes('source.attr.ad.resolved') ||
    !mEzrealRReason.includes('source.attr.ad.base') ||
    !mEzrealRReason.includes('source.attr.ap.resolved') ||
    !mEzrealRReason.includes('750') ||
    !mEzrealRReason.includes('1.00') ||
    !mEzrealRReason.includes('1.10') ||
    !mEzrealRReason.includes('100 mana') ||
    !mEzrealRReason.includes('90000') ||
    !mEzrealRReason.includes('baseAD60') ||
    !mEzrealRReason.includes('resolvedAD110') ||
    !mEzrealRReason.includes('raw1020') ||
    !mEzrealRReason.includes('510') ||
    !mEzrealRReason.includes('300') ||
    !mEzrealRReason.includes('480') ||
    !mEzrealRReason.includes('cast1') ||
    !mEzrealRReason.includes('queue0.5') ||
    !mEzrealRReason.includes('Effect at cast time start') ||
    !mEzrealRReason.includes('300+1.00 bonusAD+1.10 AP') ||
    !mEzrealRReason.includes('external existing-data/check-only') ||
    !mEzrealRReason.includes('identity/panel/resource') ||
    !mEzrealRReason.includes('不宣称') ||
    !(mEzrealR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-ezreal-trueshot-barrage-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_trueshot_barrage_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage',
        ) &&
        String(e.note || '').includes('cast1') &&
        String(e.note || '').includes('queue0.5') &&
        String(e.note || '').includes('Effect at cast time start'),
    ) ||
    !(mEzrealR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-ezreal-trueshot-barrage-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage',
        ) &&
        String(e.note || '').includes('LolGenericEzrealTrueshotBarragePrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('dea4538') &&
        String(e.note || '').includes('8c93017') &&
        String(e.note || '').includes('e13d887') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('identity/panel/resource'),
    )
  ) {
    errors.push(
      'Ezreal R must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Trueshot Barrage tags (no meta_or_non_target_dps), Wiki rev4013235/SHA + frozen completedBoundary, numeric contract/100mana/90000CD/baseAD60→110/AP200→raw1020/MR100→510/mana100/HP480, cast1/queue0.5/Effect-at-cast-start/projectile/geometry/direction/multitarget/sight/minion-monster-modified exclusions, external existing-data/check-only seed limitation, and bilateral wasm+backend evidence (owning dea4538 / integrated 8c93017 / Wasm e13d887; no cast/queue/projectile/geometry/direction/multitarget/sight/minion-monster fidelity claim)',
    );
  }
  const mEzrealEReason = String(mEzrealE?.reason || '');
  const mEzrealEBoundary =
    'rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks';
  if (
    !STATUS_OVERRIDES.has('hero_skill|hero_ezreal|E|奥术跃迁') ||
    !mEzrealE ||
    mEzrealE.key !== 'hero_skill|hero_ezreal|E|奥术跃迁' ||
    mEzrealE.passiveName !== '奥术跃迁' ||
    mEzrealE.status !== 'completed' ||
    mEzrealE.completionMode !== 'full' ||
    mEzrealE.lane !== 'generic_runtime' ||
    mEzrealE.blocker ||
    mEzrealE.dataGapEvidence !== null ||
    mEzrealE.runtimeGapEvidence !== null ||
    mEzrealE.outOfScopeEvidence !== null ||
    mEzrealE.coverageBoundary !== mEzrealEBoundary ||
    [...(mEzrealE.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mEzrealE.mechanismTags || []).includes('multi_target_or_area') ||
    mEzrealEReason.includes('multi_target_or_area') ||
    mEzrealEReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mEzrealEReason.includes('blocked_data') ||
    !mEzrealEReason.includes('3989862') ||
    !mEzrealEReason.includes(
      '7ac83f7eaa237641c478f2e3ffa1a2714f7da0644c8a488ab6a6f47b67e27347',
    ) ||
    !mEzrealEReason.includes('f48a32706234b0c1ef1abab4b7f90e4ee88944623827fb22a41e23bdfac01792') ||
    !mEzrealEReason.includes('Template:Data Ezreal/E') ||
    !mEzrealEReason.includes('Template:Data Ezreal/Arcane Shift') ||
    !mEzrealEReason.includes('page1307111') ||
    !mEzrealEReason.includes('bytes1661') ||
    !mEzrealEReason.includes('2026-02-03T23:19:20Z') ||
    !mEzrealEReason.includes(mEzrealEBoundary) ||
    !mEzrealEReason.includes('nested binary') ||
    !mEzrealEReason.includes('source.attr.ad.resolved') ||
    !mEzrealEReason.includes('source.attr.ad.base') ||
    !mEzrealEReason.includes('source.attr.ap.resolved') ||
    !mEzrealEReason.includes('280') ||
    !mEzrealEReason.includes('0.60') ||
    !mEzrealEReason.includes('0.75') ||
    !mEzrealEReason.includes('70 mana') ||
    !mEzrealEReason.includes('14000') ||
    !mEzrealEReason.includes('280/140') ||
    !mEzrealEReason.includes('310/155') ||
    !mEzrealEReason.includes('430/215') ||
    !mEzrealEReason.includes('460/230') ||
    !mEzrealEReason.includes('t13999') ||
    !mEzrealEReason.includes('mana210') ||
    !mEzrealEReason.includes('mana69') ||
    !mEzrealEReason.includes('Rising Spell Force') ||
    !mEzrealEReason.includes('AS1.1') ||
    !mEzrealEReason.includes('ability_started') ||
    !mEzrealEReason.includes('external existing-data/check-only') ||
    !mEzrealEReason.includes('identity/panel/resource') ||
    !mEzrealEReason.includes('不宣称') ||
    !(mEzrealE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-ezreal-arcane-shift-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_arcane_shift_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mEzrealEBoundary) &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('AS1.1') &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('065beb1') &&
        String(e.note || '').includes('f48a3270'),
    ) ||
    !(mEzrealE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-ezreal-arcane-shift-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_ezreal_arcane_shift_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mEzrealEBoundary) &&
        String(e.note || '').includes('LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('README') &&
        String(e.note || '').includes('89e6677') &&
        String(e.note || '').includes('0594b20') &&
        String(e.note || '').includes('065beb1') &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('no Web change'),
    )
  ) {
    errors.push(
      'Ezreal E must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Arcane Shift ordered tags (no multi_target_or_area), Wiki rev3989862/SHA + local raw caveat + frozen completedBoundary, rank5 70mana/14000CD/nested-binary 280+0.60bonusAD+0.75AP numerics (280/140 310/155 430/215 460/230; t0/t13999/t14000 mana210→70/HP540; mana69 skip; P coexistence AS1.1), and bilateral evidence (owning 89e6677 / integrated 0594b20 / Wasm 065beb1; Web parity no change; no blink/homing/visibility/Essence-Flux/projectile/reveal/live claim)',
    );
  }
  const mEzrealQReason = String(mEzrealQ?.reason || '');
  const mEzrealQBoundary =
    'rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity';
  if (
    !STATUS_OVERRIDES.has('hero_skill|hero_ezreal|Q|秘术射击') ||
    !mEzrealQ ||
    mEzrealQ.key !== 'hero_skill|hero_ezreal|Q|秘术射击' ||
    mEzrealQ.passiveName !== '秘术射击' ||
    mEzrealQ.status !== 'completed' ||
    mEzrealQ.completionMode !== 'full' ||
    mEzrealQ.lane !== 'generic_runtime' ||
    mEzrealQ.blocker ||
    mEzrealQ.dataGapEvidence !== null ||
    mEzrealQ.runtimeGapEvidence !== null ||
    mEzrealQ.outOfScopeEvidence !== null ||
    mEzrealQ.coverageBoundary !== mEzrealQBoundary ||
    [...(mEzrealQ.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mEzrealQ.mechanismTags || []).includes('total_ad_ratio') ||
    (mEzrealQ.mechanismTags || []).includes('cooldown_or_haste_without_rotation') ||
    (mEzrealQ.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mEzrealQ.mechanismTags || []).includes('primary_damage_branch_salvage') ||
    (mEzrealQ.mechanismTags || []).includes('multi_target_or_area') ||
    mEzrealQReason.includes('total_ad_ratio') ||
    mEzrealQReason.includes('cooldown_or_haste_without_rotation') ||
    mEzrealQReason.includes('meta_or_non_target_dps') ||
    mEzrealQReason.includes('primary_damage_branch_salvage') ||
    mEzrealQReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mEzrealQReason.includes('blocked_data') ||
    !mEzrealQReason.includes('4013233') ||
    !mEzrealQReason.includes(
      'be5a24861dc53970c19378fe8bea17b242b5b406a588cebb32b0d59a4af4b533',
    ) ||
    !mEzrealQReason.includes('d8348b3b9eb4a076af5a87b714dd4de109643252f6b18fd2873f5a5bf7b05dbd') ||
    !mEzrealQReason.includes('Template:Data Ezreal/Q') ||
    !mEzrealQReason.includes('Template:Data Ezreal/Mystic Shot') ||
    !mEzrealQReason.includes('page1307107') ||
    !mEzrealQReason.includes('bytes2054') ||
    !mEzrealQReason.includes('bytes2052') ||
    !mEzrealQReason.includes('2026-04-28T21:19:30Z') ||
    !mEzrealQReason.includes(mEzrealQBoundary) ||
    !mEzrealQReason.includes('nested binary') ||
    !mEzrealQReason.includes('source.attr.ad.resolved') ||
    !mEzrealQReason.includes('source.attr.ap.resolved') ||
    !mEzrealQReason.includes('不得减 base AD') ||
    !mEzrealQReason.includes('add(add(const 120') ||
    !mEzrealQReason.includes('1.30') ||
    !mEzrealQReason.includes('0.40') ||
    !mEzrealQReason.includes('40 mana') ||
    !mEzrealQReason.includes('4500') ||
    !mEzrealQReason.includes('20220') ||
    !mEzrealQReason.includes('20170') ||
    !mEzrealQReason.includes('no 20230') ||
    !mEzrealQReason.includes('no explicit event op') ||
    !mEzrealQReason.includes('no Q ability-specific type') ||
    !mEzrealQReason.includes('raw198/final99') ||
    !mEzrealQReason.includes('raw328/final164') ||
    !mEzrealQReason.includes('raw238/final119') ||
    !mEzrealQReason.includes('raw368/final184') ||
    !mEzrealQReason.includes('both328/164') ||
    !mEzrealQReason.includes('t4499') ||
    !mEzrealQReason.includes('mana120') ||
    !mEzrealQReason.includes('mana39') ||
    !mEzrealQReason.includes('HP632') ||
    !mEzrealQReason.includes('Rising Spell Force') ||
    !mEzrealQReason.includes('AS1.1') ||
    !mEzrealQReason.includes('ability_started') ||
    !mEzrealQReason.includes('external existing-data/check-only') ||
    !mEzrealQReason.includes('identity/panel/resource') ||
    !mEzrealQReason.includes('focused11/full998') ||
    !mEzrealQReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mEzrealQReason.includes('不宣称') ||
    !(mEzrealQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-ezreal-mystic-shot-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_mystic_shot_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mEzrealQBoundary) &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('AS1.1') &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('000e253') &&
        String(e.note || '').includes('d8348b3b'),
    ) ||
    !(mEzrealQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-ezreal-mystic-shot-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_ezreal_mystic_shot_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mEzrealQBoundary) &&
        String(e.note || '').includes('LolGenericEzrealMysticShotPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('README') &&
        String(e.note || '').includes('41fce6a') &&
        String(e.note || '').includes('ae66c56') &&
        String(e.note || '').includes('000e253') &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('no Web change'),
    )
  ) {
    errors.push(
      'Ezreal Q must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Mystic Shot ordered tags (no total_ad_ratio/cooldown_or_haste_without_rotation/salvage/meta), Wiki rev4013233/SHA + local raw caveat + frozen completedBoundary, rank5 40mana/4500CD/nested-binary 120+1.30*totalAD+0.40*AP numerics (198/99 328/164 238/119 368/184; counterproof both328/164; t0/t4499/t4500 mana120→40/HP632; mana39 skip; P coexistence AS1.1), and bilateral evidence (owning 41fce6a / integrated ae66c56 / Wasm 000e253; Web parity no change; no direction/projectile/on-hit/CD-reduction/dual-tag/lifesteal/spellshield/live claim)',
    );
  }
  if (
    !mGravesP ||
    mGravesP.status !== 'completed' ||
    mGravesP.completionMode !== 'full' ||
    mGravesP.lane !== 'generic_runtime' ||
    mGravesP.blocker ||
    hasNonEmptyDataMissingFields(mGravesP.dataGapEvidence) ||
    !String(mGravesP.reason || '').includes('4038342') ||
    !String(mGravesP.reason || '').includes(
      '553bda222e9e85f0eff6d4cba3b8723979a58b68fba9097d2dfa1bd373117aa8',
    ) ||
    !String(mGravesP.reason || '').includes('0.6895') ||
    !String(mGravesP.reason || '').includes('排除') ||
    !String(mGravesP.reason || '').includes('装填') ||
    !(mGravesP.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_graves_new_destiny_test.go' &&
        e.sourceWorktree === 'wasm' &&
        e.taskKey === 'wasm-generic-graves-new-destiny',
    ) ||
    !(mGravesP.evidenceRefs || []).some(
      (e) =>
        e.sourcePath === 'db/game_manage/seeds/lol_generic_graves_new_destiny_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        e.taskKey === 'wasm-generic-graves-new-destiny',
    )
  ) {
    errors.push(
      'Graves P must be completed/full/generic_runtime with empty missingFields, Wiki rev4038342/SHA Phase-A point-blank wording, reload as completed-boundary exclusion, and bilateral wasm+backend evidence',
    );
  }
  const mGravesE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_graves|E|快速拔枪');
  if (
    !mGravesE ||
    mGravesE.status !== 'completed' ||
    mGravesE.completionMode !== 'full' ||
    mGravesE.lane !== 'generic_runtime' ||
    mGravesE.blocker ||
    mGravesE.dataGapEvidence ||
    mGravesE.runtimeGapEvidence ||
    hasNonEmptyDataMissingFields(mGravesE.dataGapEvidence) ||
    !String(mGravesE.reason || '').includes('4007744') ||
    !String(mGravesE.reason || '').includes(
      'ff4c65c5ce2a0ac1ae757271fbb924b35bf4eca1af0f4d07a69d865db901a4e1',
    ) ||
    !String(mGravesE.reason || '').includes('true_grit_stacks') ||
    !String(mGravesE.reason || '').includes('152') ||
    !String(mGravesE.reason || '').includes('76') ||
    !String(mGravesE.reason || '').includes('12000') ||
    !String(mGravesE.reason || '').includes('排除') ||
    !String(mGravesE.reason || '').includes('intermediate stacks') ||
    citesForbiddenProvenance(mGravesE.reason) ||
    !(mGravesE.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_graves_quickdraw_max_stack_test.go' &&
        e.sourceWorktree === 'wasm' &&
        e.taskKey === 'wasm-generic-graves-quickdraw-max-stack',
    ) ||
    !(mGravesE.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_graves_quickdraw_max_stack_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        e.taskKey === 'wasm-generic-graves-quickdraw-max-stack' &&
        String(e.note || '').includes('LolGenericGravesQuickdrawMaxStackSeedSqlTest'),
    )
  ) {
    errors.push(
      'Graves E must be completed/full/generic_runtime with cleared blocker/data/runtime gaps, Wiki rev4007744/SHA Phase-A max True Grit wording, completed-boundary exclusions, and bilateral wasm+backend evidence',
    );
  }
  const mGravesW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_graves|W|烟幕弹');
  const mGravesWReason = String(mGravesW?.reason || '');
  if (
    !mGravesW ||
    mGravesW.status !== 'completed' ||
    mGravesW.completionMode !== 'full' ||
    mGravesW.lane !== 'generic_runtime' ||
    mGravesW.blocker ||
    mGravesW.dataGapEvidence !== null ||
    mGravesW.runtimeGapEvidence !== null ||
    mGravesW.outOfScopeEvidence !== null ||
    mGravesW.coverageBoundary !==
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction' ||
    [...(mGravesW.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mGravesW.mechanismTags || []).includes('meta_or_non_target_dps') ||
    mGravesWReason.includes('meta_or_non_target_dps') ||
    mGravesWReason.includes('implementation_gap_no_unresolved_data_fields') ||
    !mGravesWReason.includes('3956197') ||
    !mGravesWReason.includes(
      '20348473fe3441eb32ab656423f577a62a415fadf33fbdc6fcf576bc8b1d210d',
    ) ||
    !mGravesWReason.includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction',
    ) ||
    !mGravesWReason.includes('source.attr.ap.resolved') ||
    !mGravesWReason.includes('260') ||
    !mGravesWReason.includes('0.60') ||
    !mGravesWReason.includes('90 mana') ||
    !mGravesWReason.includes('18000') ||
    !mGravesWReason.includes('raw380') ||
    !mGravesWReason.includes('190') ||
    !mGravesWReason.includes('145') ||
    !mGravesWReason.includes('620') ||
    !mGravesWReason.includes('cast0.25') ||
    !mGravesWReason.includes('Effect at cast time end') ||
    !mGravesWReason.includes('smoke cloud') ||
    !mGravesWReason.includes('nearsight') ||
    !mGravesWReason.includes('True Grit') ||
    !mGravesWReason.includes('不宣称') ||
    !(mGravesW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-graves-smoke-screen-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_graves_smoke_screen_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction',
        ) &&
        String(e.note || '').includes('cast0.25') &&
        String(e.note || '').includes('nearsight'),
    ) ||
    !(mGravesW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-graves-smoke-screen-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_graves_smoke_screen_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction',
        ) &&
        String(e.note || '').includes('LolGenericGravesSmokeScreenPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('1238c53') &&
        String(e.note || '').includes('037bae3') &&
        String(e.note || '').includes('78ab90c'),
    )
  ) {
    errors.push(
      'Graves W must be completed/full/generic_runtime with cleared meta_or_non_target_dps/governed gaps, Wiki rev3956197/SHA, frozen boundary/AP formula/cost/CD/numeric schedule, cast0.25/smoke/nearsight/True Grit exclusion wording, bilateral evidence (owning 1238c53 / integrated 037bae3 / Wasm 78ab90c), and no cast/projectile/AOE/slow/smoke/nearsight fidelity claim',
    );
  }
  const mGravesR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_graves|R|终极爆弹');
  const mGravesRReason = String(mGravesR?.reason || '');
  if (
    !mGravesR ||
    mGravesR.status !== 'completed' ||
    mGravesR.completionMode !== 'full' ||
    mGravesR.lane !== 'generic_runtime' ||
    mGravesR.blocker ||
    mGravesR.dataGapEvidence !== null ||
    mGravesR.runtimeGapEvidence !== null ||
    mGravesR.outOfScopeEvidence !== null ||
    mGravesR.coverageBoundary !==
      'rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage' ||
    [...(mGravesR.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mGravesR.mechanismTags || []).includes('dps_relevant_manual_review') ||
    mGravesRReason.includes('dps_relevant_manual_review') ||
    mGravesRReason.includes('needs_manual_baseline') ||
    mGravesRReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mGravesRReason.includes('blocked_data') ||
    !mGravesRReason.includes('4007499') ||
    !mGravesRReason.includes(
      '834843a7722fc9463e21e8d636b8adc644c220928b90f7bb4afedbaa08f85dd1',
    ) ||
    !mGravesRReason.includes(
      'rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage',
    ) ||
    !mGravesRReason.includes('source.attr.ad.resolved') ||
    !mGravesRReason.includes('source.attr.ad.base') ||
    !mGravesRReason.includes('575') ||
    !mGravesRReason.includes('1.50') ||
    !mGravesRReason.includes('100 mana') ||
    !mGravesRReason.includes('60000') ||
    !mGravesRReason.includes('baseAD66') ||
    !mGravesRReason.includes('resolvedAD120') ||
    !mGravesRReason.includes('bonusAD54') ||
    !mGravesRReason.includes('raw656') ||
    !mGravesRReason.includes('328') ||
    !mGravesRReason.includes('125') ||
    !mGravesRReason.includes('344') ||
    !mGravesRReason.includes('440') ||
    !mGravesRReason.includes('1.20') ||
    !mGravesRReason.includes('excluded not denied') ||
    !mGravesRReason.includes('recoil') ||
    !mGravesRReason.includes('explosion cone') ||
    !mGravesRReason.includes('不宣称') ||
    !(mGravesR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-graves-collateral-damage-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_graves_collateral_damage_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage',
        ) &&
        String(e.note || '').includes('recoil') &&
        String(e.note || '').includes('excluded not denied'),
    ) ||
    !(mGravesR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-graves-collateral-damage-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_graves_collateral_damage_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage',
        ) &&
        String(e.note || '').includes('LolGenericGravesCollateralDamagePrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('9c1087b') &&
        String(e.note || '').includes('c2a8a97') &&
        String(e.note || '').includes('4abadf1'),
    )
  ) {
    errors.push(
      'Graves R must be completed/full/generic_runtime with cleared dps_relevant_manual_review/needs_manual_baseline/governed gaps, Wiki rev4007499/SHA, frozen boundary/bonus-AD formula/cost/CD/numeric schedule, explosion-cone reduced 440+1.20 excluded-not-denied, recoil/cast/projectile exclusion wording, bilateral evidence (owning 9c1087b / integrated c2a8a97 / Wasm 4abadf1), and no cast/recoil/projectile/line/multitarget/explosion-cone fidelity claim',
    );
  }
  const mGravesQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_graves|Q|穷途末路');
  const mGravesQReason = String(mGravesQ?.reason || '');
  const mGravesQBoundary =
    'rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity';
  if (
    !mGravesQ ||
    !STATUS_OVERRIDES.has('hero_skill|hero_graves|Q|穷途末路') ||
    mGravesQ.key !== 'hero_skill|hero_graves|Q|穷途末路' ||
    mGravesQ.passiveName !== '穷途末路' ||
    mGravesQ.status !== 'completed' ||
    mGravesQ.completionMode !== 'full' ||
    mGravesQ.lane !== 'generic_runtime' ||
    mGravesQ.blocker ||
    mGravesQ.dataGapEvidence !== null ||
    mGravesQ.runtimeGapEvidence !== null ||
    mGravesQ.outOfScopeEvidence !== null ||
    mGravesQ.coverageBoundary !== mGravesQBoundary ||
    [...(mGravesQ.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mGravesQ.mechanismTags || []).includes('multi_target_or_area') ||
    (mGravesQ.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mGravesQ.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mGravesQ.mechanismTags || []).includes('primary_damage_branch_salvage') ||
    (mGravesQ.mechanismTags || []).includes('total_ad_ratio') ||
    !(mGravesQ.mechanismTags || []).includes('bonus_ad_ratio') ||
    !(mGravesQ.mechanismTags || []).includes('active_physical_damage') ||
    mGravesQReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mGravesQReason.includes('blocked_data') ||
    mGravesQReason.includes('multi_target_or_area') ||
    mGravesQReason.includes('needs_manual_baseline') ||
    mGravesQReason.includes('out_of_scope_for_single_target_dps') ||
    mGravesQReason.includes('dps_relevant_manual_review') ||
    mGravesQReason.includes('primary_damage_branch_salvage') ||
    mGravesQReason.includes('depends on Graves E') ||
    mGravesQReason.includes('depends on True Grit') ||
    mGravesQReason.includes('total AD；') ||
    mGravesQReason.includes('total_ad_ratio') ||
    mGravesQReason.includes('*totalAD') ||
    !mGravesQReason.includes('4007501') ||
    !mGravesQReason.includes(
      'c18840004febd305484392c882680939efe9fc609d4f733f81824439741345c5',
    ) ||
    !mGravesQReason.includes(
      'cd2744fb1f28e54bd3b5e25b96cb1d21babc0583bfd8e854d55c15ed83df0377',
    ) ||
    !mGravesQReason.includes('Template:Data Graves/Q') ||
    !mGravesQReason.includes('Template:Data Graves/End of the Line') ||
    !mGravesQReason.includes('page1307367') ||
    !mGravesQReason.includes('bytes2266') ||
    !mGravesQReason.includes('bytes2265') ||
    !mGravesQReason.includes('2026-04-11T22:23:57Z') ||
    !mGravesQReason.includes(mGravesQBoundary) ||
    !mGravesQReason.includes('source.attr.ad.resolved') ||
    !mGravesQReason.includes('source.attr.ad.base') ||
    !mGravesQReason.includes('exact binary formula') ||
    !mGravesQReason.includes('bonus AD by explicit subtraction') ||
    !mGravesQReason.includes('不得按 total-AD 直读') ||
    !mGravesQReason.includes('150') ||
    !mGravesQReason.includes('0.65') ||
    !mGravesQReason.includes('80 mana') ||
    !mGravesQReason.includes('6000') ||
    !mGravesQReason.includes('20220') ||
    !mGravesQReason.includes('20170') ||
    !mGravesQReason.includes('no 20230') ||
    !mGravesQReason.includes('no explicit event op') ||
    !mGravesQReason.includes('no Q ability-specific type') ||
    !mGravesQReason.includes('base0/resolved0/armor0 raw=final150') ||
    !mGravesQReason.includes('base60/resolved60/armor0 raw=final150') ||
    !mGravesQReason.includes('base60/resolved160/armor0 raw=final215') ||
    !mGravesQReason.includes('base60/resolved160/armor100 raw215/final107.5') ||
    !mGravesQReason.includes('base60/resolved260/armor100 raw280/final140') ||
    !mGravesQReason.includes('base0/resolved100 versus base60/resolved160') ||
    !mGravesQReason.includes('t5999') ||
    !mGravesQReason.includes('t6000') ||
    !mGravesQReason.includes('mana240') ||
    !mGravesQReason.includes('mana79') ||
    !mGravesQReason.includes('HP785') ||
    !mGravesQReason.includes('ability_started') ||
    !mGravesQReason.includes('Q does not alter E True Grit') ||
    !mGravesQReason.includes('E produces no Q damage') ||
    !mGravesQReason.includes('standalone') ||
    !mGravesQReason.includes('external existing-data/check-only') ||
    !mGravesQReason.includes('identity/panel/resource') ||
    !mGravesQReason.includes('不暗示 Graves P/E/W/R/True Grit/basic dependence') ||
    !mGravesQReason.includes('不暗示 Batch-B') ||
    !mGravesQReason.includes('sibling Graves synthesis') ||
    !mGravesQReason.includes('production runtime/ABI/Web change') ||
    !mGravesQReason.includes('focused50/full943') ||
    !mGravesQReason.includes('focused7') ||
    !mGravesQReason.includes('66870') ||
    !mGravesQReason.includes(
      'a95e0d9632b0fe45aaec9440ccd89c381d6903f2c99ab761581736ec1f8c8e77',
    ) ||
    !mGravesQReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mGravesQReason.includes('不宣称') ||
    !mGravesQReason.includes('no equivalence or contradiction claim') ||
    !mGravesQReason.includes('exactly one selected-primary first-outbound-pass physical hit') ||
    mGravesQReason.includes('canonical byte equivalence') ||
    mGravesQReason.includes('Batch-B prerequisite') ||
    mGravesQReason.includes('live published') ||
    !(mGravesQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-graves-end-of-the-line-first-outbound-pass' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_graves_end_of_the_line_first_outbound_pass_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mGravesQBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('c16107e') &&
        String(e.note || '').includes('cd2744fb') &&
        String(e.note || '').includes('20220') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no 20230') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('no Q type') &&
        String(e.note || '').includes('exact binary') &&
        String(e.note || '').includes('Q does not alter E True Grit') &&
        String(e.note || '').includes('E produces no Q damage') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mGravesQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-graves-end-of-the-line-first-outbound-pass' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mGravesQBoundary) &&
        String(e.note || '').includes('LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest') &&
        String(e.note || '').includes('9294292') &&
        String(e.note || '').includes('a54cf6f') &&
        String(e.note || '').includes('c16107e') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Graves synthesis'),
    )
  ) {
    errors.push(
      'Graves Q must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact End of the Line ordered tags (no multi_target_or_area/primary_damage_branch_salvage; requires bonus_ad_ratio/active_physical_damage), Wiki rev4007501/SHA + local raw caveat + frozen completedBoundary, rank5 80mana/6000CD/one physical 150+0.65*bonusAD exact binary numerics/schedules (150/150/215/215→107.5/280→140; bonusAD counterproof; 20220/20170; no 20230; no Q type; no explicit event op; t0/t5999/t6000 mana240→80/HP785; mana79 skip; Q does not alter E True Grit and E produces no Q damage), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-True-Grit-dependence/no-production-runtime-ABI-Web framing, focused50/full943 + focused7 + Wasm asset SHA, and bilateral evidence (owning 9294292 / integrated a54cf6f / Wasm c16107e; one selected-primary first-outbound-pass physical hit not full Q; no cast/direction/projectile/trail/detonation/reverse-wave/live claim)',
    );
  }
  const mSennaW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_senna|W|无尽厮守');
  const mSennaWReason = String(mSennaW?.reason || '');
  const mSennaWBoundary =
    'rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_other_ranks_or_full_fidelity';
  if (
    !mSennaW ||
    !STATUS_OVERRIDES.has('hero_skill|hero_senna|W|无尽厮守') ||
    mSennaW.key !== 'hero_skill|hero_senna|W|无尽厮守' ||
    mSennaW.passiveName !== '无尽厮守' ||
    mSennaW.status !== 'completed' ||
    mSennaW.completionMode !== 'full' ||
    mSennaW.lane !== 'generic_runtime' ||
    mSennaW.blocker ||
    mSennaW.dataGapEvidence !== null ||
    mSennaW.runtimeGapEvidence !== null ||
    mSennaW.outOfScopeEvidence !== null ||
    mSennaW.coverageBoundary !== mSennaWBoundary ||
    [...(mSennaW.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mSennaW.mechanismTags || []).includes('multi_target_or_area') ||
    (mSennaW.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mSennaW.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mSennaW.mechanismTags || []).includes('primary_damage_branch_salvage') ||
    (mSennaW.mechanismTags || []).includes('total_ad_ratio') ||
    !(mSennaW.mechanismTags || []).includes('bonus_ad_ratio') ||
    !(mSennaW.mechanismTags || []).includes('active_physical_damage') ||
    mSennaWReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mSennaWReason.includes('blocked_data') ||
    mSennaWReason.includes('multi_target_or_area') ||
    mSennaWReason.includes('needs_manual_baseline') ||
    mSennaWReason.includes('out_of_scope_for_single_target_dps') ||
    mSennaWReason.includes('dps_relevant_manual_review') ||
    mSennaWReason.includes('primary_damage_branch_salvage') ||
    mSennaWReason.includes('depends on Senna') ||
    mSennaWReason.includes('total AD；') ||
    mSennaWReason.includes('total_ad_ratio') ||
    mSennaWReason.includes('*totalAD') ||
    !mSennaWReason.includes('4009139') ||
    !mSennaWReason.includes(
      '48698aa2864b79564b1ea0ed624de8fc7123c3127c1e56deaa002d1aad3c8492',
    ) ||
    !mSennaWReason.includes(
      '737cc69b6ea13da8d61437e3da37a799cc2779bd56516d166af5890dc6090d5e',
    ) ||
    !mSennaWReason.includes('Template:Data Senna/W') ||
    !mSennaWReason.includes('Template:Data Senna/Last Embrace') ||
    !mSennaWReason.includes('page1409576') ||
    !mSennaWReason.includes('bytes1656') ||
    !mSennaWReason.includes('bytes1651') ||
    !mSennaWReason.includes('2026-04-15T21:34:10Z') ||
    !mSennaWReason.includes(mSennaWBoundary) ||
    !mSennaWReason.includes('source.attr.ad.resolved') ||
    !mSennaWReason.includes('source.attr.ad.base') ||
    !mSennaWReason.includes('exact binary formula') ||
    !mSennaWReason.includes('bonus AD by explicit subtraction') ||
    !mSennaWReason.includes('不得按 total-AD 直读') ||
    !mSennaWReason.includes('230') ||
    !mSennaWReason.includes('0.90') ||
    !mSennaWReason.includes('70 mana') ||
    !mSennaWReason.includes('11000') ||
    !mSennaWReason.includes('20220') ||
    !mSennaWReason.includes('20170') ||
    !mSennaWReason.includes('no 20230') ||
    !mSennaWReason.includes('no explicit event op') ||
    !mSennaWReason.includes('no W ability-specific type') ||
    !mSennaWReason.includes('base0/resolved0/armor0 raw=final230') ||
    !mSennaWReason.includes('base60/resolved60/armor0 raw=final230') ||
    !mSennaWReason.includes('base60/resolved160/armor0 raw=final320') ||
    !mSennaWReason.includes('base60/resolved160/armor100 raw320/final160') ||
    !mSennaWReason.includes('base60/resolved260/armor100 raw410/final205') ||
    !mSennaWReason.includes('base0/resolved100 versus base60/resolved160') ||
    !mSennaWReason.includes('t10999') ||
    !mSennaWReason.includes('t11000') ||
    !mSennaWReason.includes('mana210') ||
    !mSennaWReason.includes('mana69') ||
    !mSennaWReason.includes('HP680') ||
    !mSennaWReason.includes('ability_started') ||
    !mSennaWReason.includes('standalone') ||
    !mSennaWReason.includes('external existing-data/check-only') ||
    !mSennaWReason.includes('identity/panel/resource') ||
    !mSennaWReason.includes('不暗示 Senna P/Q/E/R/basic dependence') ||
    !mSennaWReason.includes('不暗示 Batch-B') ||
    !mSennaWReason.includes('sibling Senna synthesis') ||
    !mSennaWReason.includes('production runtime/ABI/Web change') ||
    !mSennaWReason.includes('focused68/full954') ||
    !mSennaWReason.includes('62703') ||
    !mSennaWReason.includes(
      '4a449fc09248fe7842b909a373edd5353d4fb1eed8831b655f9146bcd5696051',
    ) ||
    !mSennaWReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mSennaWReason.includes('不宣称') ||
    !mSennaWReason.includes('no equivalence or contradiction claim') ||
    !mSennaWReason.includes('exactly one selected-primary first-enemy physical hit') ||
    mSennaWReason.includes('canonical byte equivalence') ||
    mSennaWReason.includes('Batch-B prerequisite') ||
    mSennaWReason.includes('live published') ||
    !(mSennaW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-senna-last-embrace-first-enemy-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_senna_last_embrace_first_enemy_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mSennaWBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('ebf7730') &&
        String(e.note || '').includes('737cc69b') &&
        String(e.note || '').includes('20220') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no 20230') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('no W type') &&
        String(e.note || '').includes('exact binary') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mSennaW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-senna-last-embrace-first-enemy-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_senna_last_embrace_first_enemy_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mSennaWBoundary) &&
        String(e.note || '').includes('LolGenericSennaLastEmbraceFirstEnemyHitSeedSqlTest') &&
        String(e.note || '').includes('c0c3090') &&
        String(e.note || '').includes('b90607b') &&
        String(e.note || '').includes('ebf7730') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Senna synthesis'),
    )
  ) {
    errors.push(
      'Senna W must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Last Embrace ordered tags (no multi_target_or_area/primary_damage_branch_salvage; requires bonus_ad_ratio/active_physical_damage), Wiki rev4009139/SHA + local raw caveat + frozen completedBoundary, rank5 70mana/11000CD/one physical 230+0.90*bonusAD exact binary numerics/schedules (230/230/320/320→160/410→205; bonusAD counterproof; 20220/20170; no 20230; no W type; no explicit event op; t0/t10999/t11000 mana210→70/HP680; mana69 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-production-runtime-ABI-Web framing, focused68/full954 + Wasm asset SHA, and bilateral evidence (owning c0c3090 / integrated b90607b / Wasm ebf7730; one selected-primary first-enemy physical hit not full W; no cast/effect-at-cast-time-end/direction/projectile/attachment/root/AOE/live claim)',
    );
  }
  const mSennaR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_senna|R|暗影燎原');
  const mSennaRReason = String(mSennaR?.reason || '');
  const mSennaRBoundary =
    'rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity';
  if (
    !mSennaR ||
    !STATUS_OVERRIDES.has('hero_skill|hero_senna|R|暗影燎原') ||
    mSennaR.key !== 'hero_skill|hero_senna|R|暗影燎原' ||
    mSennaR.passiveName !== '暗影燎原' ||
    mSennaR.status !== 'completed' ||
    mSennaR.completionMode !== 'full' ||
    mSennaR.lane !== 'generic_runtime' ||
    mSennaR.blocker ||
    mSennaR.dataGapEvidence !== null ||
    mSennaR.runtimeGapEvidence !== null ||
    mSennaR.outOfScopeEvidence !== null ||
    mSennaR.coverageBoundary !== mSennaRBoundary ||
    [...(mSennaR.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'ap_ratio',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mSennaR.mechanismTags || []).includes('multi_target_or_area') ||
    (mSennaR.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mSennaR.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mSennaR.mechanismTags || []).includes('primary_damage_branch_salvage') ||
    (mSennaR.mechanismTags || []).includes('total_ad_ratio') ||
    !(mSennaR.mechanismTags || []).includes('bonus_ad_ratio') ||
    !(mSennaR.mechanismTags || []).includes('ap_ratio') ||
    !(mSennaR.mechanismTags || []).includes('active_physical_damage') ||
    mSennaRReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mSennaRReason.includes('blocked_data') ||
    mSennaRReason.includes('multi_target_or_area') ||
    mSennaRReason.includes('meta_or_non_target_dps') ||
    mSennaRReason.includes('needs_manual_baseline') ||
    mSennaRReason.includes('out_of_scope_for_single_target_dps') ||
    mSennaRReason.includes('dps_relevant_manual_review') ||
    mSennaRReason.includes('primary_damage_branch_salvage') ||
    mSennaRReason.includes('total AD；') ||
    mSennaRReason.includes('total_ad_ratio') ||
    mSennaRReason.includes('*totalAD') ||
    !mSennaRReason.includes('4008033') ||
    !mSennaRReason.includes(
      '4de188cce3d04f172d37f07db4e7c8e240388c5346f56838c82a3e6205c9de36',
    ) ||
    !mSennaRReason.includes(
      '1b448ff48b9fe906a13056f2f510e38ff96fcad410462972a93dbd3bb93195dc',
    ) ||
    !mSennaRReason.includes('Template:Data Senna/R') ||
    !mSennaRReason.includes('Template:Data Senna/Dawning Shadow') ||
    !mSennaRReason.includes('page1409580') ||
    !mSennaRReason.includes('bytes2356') ||
    !mSennaRReason.includes('bytes2353') ||
    !mSennaRReason.includes('2026-04-13T04:08:13Z') ||
    !mSennaRReason.includes(mSennaRBoundary) ||
    !mSennaRReason.includes('source.attr.ad.resolved') ||
    !mSennaRReason.includes('source.attr.ad.base') ||
    !mSennaRReason.includes('exact nested binary formula') ||
    !mSennaRReason.includes('bonus AD by explicit subtraction') ||
    !mSennaRReason.includes('不得按 total-AD 直读') ||
    !mSennaRReason.includes('add(add(const 550') ||
    !mSennaRReason.includes('1.15') ||
    !mSennaRReason.includes('0.70') ||
    !mSennaRReason.includes('100 mana') ||
    !mSennaRReason.includes('100000') ||
    !mSennaRReason.includes('20220') ||
    !mSennaRReason.includes('20170') ||
    !mSennaRReason.includes('no 20230') ||
    !mSennaRReason.includes('no explicit event op') ||
    !mSennaRReason.includes('no R ability-specific type') ||
    !mSennaRReason.includes('raw=final550') ||
    !mSennaRReason.includes('raw=final665') ||
    !mSennaRReason.includes('raw=final620') ||
    !mSennaRReason.includes('raw=final735') ||
    !mSennaRReason.includes('raw712/final356') ||
    !mSennaRReason.includes('raw804/final402') ||
    !mSennaRReason.includes('both665') ||
    !mSennaRReason.includes('t99999') ||
    !mSennaRReason.includes('t100000') ||
    !mSennaRReason.includes('mana300') ||
    !mSennaRReason.includes('mana99') ||
    !mSennaRReason.includes('HP288') ||
    !mSennaRReason.includes('ability_started') ||
    !mSennaRReason.includes('standalone') ||
    !mSennaRReason.includes('preserve existing W') ||
    !mSennaRReason.includes('check-only standalone W isolation') ||
    !mSennaRReason.includes('external existing-data/check-only') ||
    !mSennaRReason.includes('identity/panel/resource') ||
    !mSennaRReason.includes('不暗示 Senna P/Q/W/E/basic dependence') ||
    !mSennaRReason.includes('不暗示 Batch-B') ||
    !mSennaRReason.includes('sibling Senna synthesis') ||
    !mSennaRReason.includes('production runtime/ABI/Web change') ||
    !mSennaRReason.includes('focused71/full987') ||
    !mSennaRReason.includes('73643') ||
    !mSennaRReason.includes(
      'a42359e98452dfd3d1429fc12f8735daefd77b0da2269ba7b345200b9ff39fa9',
    ) ||
    !mSennaRReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mSennaRReason.includes('不宣称') ||
    !mSennaRReason.includes('no equivalence or contradiction claim') ||
    !mSennaRReason.includes('exactly one selected-primary-enemy-champion single physical hit') ||
    mSennaRReason.includes('canonical byte equivalence') ||
    mSennaRReason.includes('Batch-B prerequisite') ||
    mSennaRReason.includes('live published') ||
    !(mSennaR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-senna-dawning-shadow-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_senna_dawning_shadow_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mSennaRBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('a8e4c08') &&
        String(e.note || '').includes('a42359e9') &&
        String(e.note || '').includes('73643') &&
        String(e.note || '').includes('1b448ff4') &&
        String(e.note || '').includes('20220') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no 20230') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('no R type') &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('preserve existing W') &&
        String(e.note || '').includes('check-only W isolation') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mSennaR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-senna-dawning-shadow-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_senna_dawning_shadow_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mSennaRBoundary) &&
        String(e.note || '').includes('LolGenericSennaDawningShadowPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('b774a8d') &&
        String(e.note || '').includes('4316923') &&
        String(e.note || '').includes('a8e4c08') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('preserve existing W') &&
        String(e.note || '').includes('check-only W isolation') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Senna synthesis'),
    )
  ) {
    errors.push(
      'Senna R must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Dawning Shadow ordered tags (no meta_or_non_target_dps/primary_damage_branch_salvage; requires bonus_ad_ratio/ap_ratio/active_physical_damage), Wiki rev4008033/SHA + local raw caveat + frozen completedBoundary, rank3 100mana/100000CD/one physical 550+1.15*bonusAD+0.70*AP nested binary numerics/schedules (550/665/620/735; raw712→356; raw804→402; counterproof both665; 20220/20170; no 20230; no R type; no explicit event op; t0/t99999/t100000 mana300→100/HP288; mana99 skip), standalone/preserve-W/check-only-W-isolation/external-existing-data/check-only/no-Batch-B/no-sibling/no-production-runtime-ABI-Web framing, focused71/full987 + Wasm asset SHA, and bilateral evidence (owning b774a8d / integrated 4316923 / Wasm a8e4c08; one selected-primary-enemy-champion physical hit not full R; no cast/Effect-at-cast-time-start/queue/wave/projectile/AOE/reveal/shield/Mist/live claim)',
    );
  }
  if (
    !mDravenQ ||
    mDravenQ.status !== 'completed' ||
    mDravenQ.completionMode !== 'full' ||
    mDravenQ.lane !== 'generic_runtime' ||
    mDravenQ.blocker ||
    !String(mDravenQ.reason || '').includes('1400') ||
    !String(mDravenQ.reason || '').includes('排除') ||
    !(mDravenQ.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_draven_spinning_axe_test.go',
    ) ||
    !(mDravenQ.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_draven_spinning_axe_seed.sql',
    )
  ) {
    errors.push(
      'Draven Q must be completed/full under user-approved 1v1 scope with wasm+backend evidence (landing/W-reset excluded)',
    );
  }
  const mDravenE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_draven|E|开道利斧');
  if (
    !mDravenE ||
    mDravenE.status !== 'completed' ||
    mDravenE.completionMode !== 'full' ||
    mDravenE.lane !== 'generic_runtime' ||
    mDravenE.blocker ||
    mDravenE.dataGapEvidence !== null ||
    mDravenE.runtimeGapEvidence !== null ||
    mDravenE.outOfScopeEvidence !== null ||
    mDravenE.coverageBoundary !==
      'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget' ||
    [...(mDravenE.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'ability_flat_bonus_ad_damage',
        'active_physical_damage',
        'immediate_impact_scaffold',
      ].join('|') ||
    !String(mDravenE.reason || '').includes('4034694') ||
    !String(mDravenE.reason || '').includes(
      '7bb6ebdc19413ef908e78fea01576d1184a66bc62fd6148120845573c1468e8d',
    ) ||
    !String(mDravenE.reason || '').includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget',
    ) ||
    !String(mDravenE.reason || '').includes('215') ||
    !String(mDravenE.reason || '').includes('0.50') ||
    !String(mDravenE.reason || '').includes('70 mana') ||
    !String(mDravenE.reason || '').includes('12000') ||
    !String(mDravenE.reason || '').includes('127.5') ||
    !String(mDravenE.reason || '').includes('不宣称') ||
    !(mDravenE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-draven-stand-aside' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_draven_stand_aside_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget',
        ),
    ) ||
    !(mDravenE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-draven-stand-aside' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_draven_stand_aside_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget',
        ) &&
        String(e.note || '').includes('LolGenericDravenStandAsideSeedSqlTest'),
    )
  ) {
    errors.push(
      'Draven E must be completed/full/generic_runtime with cleared gaps, Wiki rev4034694/SHA, frozen boundary/formula/cost/CD, bilateral evidence, and exclusions (no cast-delay/CC/geometry/multitarget/full-game claim)',
    );
  }
  if (
    !mDravenW ||
    mDravenW.status !== 'completed' ||
    mDravenW.completionMode !== 'full' ||
    mDravenW.lane !== 'generic_runtime' ||
    mDravenW.blocker ||
    !String(mDravenW.reason || '').includes('axe_caught') ||
    !String(mDravenW.reason || '').includes('40%') ||
    !(mDravenW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-draven-blood-rush' &&
        e.sourcePath === 'wasm/tinygo_engine_v2/internal/runtime/generic_draven_blood_rush_test.go' &&
        e.sourceWorktree === 'wasm',
    ) ||
    !(mDravenW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-draven-blood-rush' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_draven_w_axe_catch_reset_test.go' &&
        e.sourceWorktree === 'wasm',
    ) ||
    !(mDravenW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-draven-blood-rush' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_draven_blood_rush_seed.sql' &&
        e.sourceWorktree === 'backend',
    )
  ) {
    errors.push(
      'Draven W 血性冲刺 must be completed/full/generic_runtime with blood-rush + axe-catch-reset wasm and backend seed evidence refs',
    );
  }
  const mQuinnPReason = String(mQuinnP?.reason || '');
  const mQuinnPBoundary =
    'level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels';
  const mQuinnPExpectedTagsSorted = [
    'bonus_ad_ratio',
    'copyable_on_hit_false',
    'formula_on_hit',
    'on_hit',
    'provider_target_state_consume',
  ];
  if (
    !STATUS_OVERRIDES.has('hero_skill|hero_quinn|P|侵扰') ||
    !mQuinnP ||
    mQuinnP.key !== 'hero_skill|hero_quinn|P|侵扰' ||
    mQuinnP.passiveName !== '侵扰' ||
    mQuinnP.status !== 'completed' ||
    mQuinnP.completionMode !== 'full' ||
    mQuinnP.lane !== 'generic_runtime' ||
    mQuinnP.blocker ||
    mQuinnP.dataGapEvidence !== null ||
    mQuinnP.runtimeGapEvidence !== null ||
    mQuinnP.outOfScopeEvidence !== null ||
    mQuinnP.coverageBoundary !== mQuinnPBoundary ||
    [...(mQuinnP.mechanismTags || [])].join('|') !== mQuinnPExpectedTagsSorted.join('|') ||
    (mQuinnP.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mQuinnP.mechanismTags || []).includes('meta_or_non_target_dps') ||
    mQuinnPReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mQuinnPReason.includes('dps_relevant_manual_review') ||
    !mQuinnPReason.includes('4024765') ||
    !mQuinnPReason.includes(
      '740debfb3b72dd7f926337f7eb4adbe3a65c88caec227ca16e00dff6634f798c',
    ) ||
    !mQuinnPReason.includes('08853c2c25ada7769e25908123dbb56f7b14dc0c1479a8a5842693874849a731') ||
    !mQuinnPReason.includes('Template:Data Quinn/I') ||
    !mQuinnPReason.includes('Template:Data Quinn/Harrier') ||
    !mQuinnPReason.includes('page1308953') ||
    !mQuinnPReason.includes('bytes2390') ||
    !mQuinnPReason.includes('2026-06-03T00:49:03Z') ||
    !mQuinnPReason.includes(mQuinnPBoundary) ||
    !mQuinnPReason.includes('nested binary') ||
    !mQuinnPReason.includes('source.attr.ad.resolved') ||
    !mQuinnPReason.includes('source.attr.ad.base') ||
    !mQuinnPReason.includes('120') ||
    !mQuinnPReason.includes('0.40') ||
    !mQuinnPReason.includes('bonusAD80') ||
    !mQuinnPReason.includes('raw152') ||
    !mQuinnPReason.includes('mitigated76') ||
    !mQuinnPReason.includes('raw120') ||
    !mQuinnPReason.includes('mitigated60') ||
    !mQuinnPReason.includes('t3000') ||
    !mQuinnPReason.includes('20110') ||
    !mQuinnPReason.includes('20252') ||
    !mQuinnPReason.includes('provider_target') ||
    !mQuinnPReason.includes('W-before-P') ||
    !mQuinnPReason.includes('P-before-W') ||
    !mQuinnPReason.includes('不宣称 W AS magnitude') ||
    !mQuinnPReason.includes('basic_attack_hit') ||
    !mQuinnPReason.includes('heightened_senses_active') ||
    !mQuinnPReason.includes('harrier_vulnerable') ||
    !mQuinnPReason.includes('Q/E/Skystrike/Valor') ||
    !mQuinnPReason.includes('monster75') ||
    !mQuinnPReason.includes('不宣称') ||
    !(mQuinnP.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-quinn-harrier-premarked-consume' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_harrier_premarked_consume_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mQuinnPBoundary) &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('20110+20252') &&
        String(e.note || '').includes('source+provider_target') &&
        String(e.note || '').includes('shared W provider') &&
        String(e.note || '').includes('W-before-P') &&
        String(e.note || '').includes('7c84b36') &&
        String(e.note || '').includes('no W AS magnitude'),
    ) ||
    !(mQuinnP.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-quinn-harrier-premarked-consume' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_quinn_p_harrier_premarked_consume_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mQuinnPBoundary) &&
        String(e.note || '').includes('LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest') &&
        String(e.note || '').includes('README') &&
        String(e.note || '').includes('0a6301e') &&
        String(e.note || '').includes('12d9281') &&
        String(e.note || '').includes('7c84b36') &&
        String(e.note || '').includes('extends existing W provider') &&
        String(e.note || '').includes('W rows check-only') &&
        String(e.note || '').includes('20110+20252') &&
        String(e.note || '').includes('no Web change'),
    )
  ) {
    errors.push(
      'Quinn P must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Harrier ordered tags (sorted inventory; no dps_relevant_manual_review), Wiki rev4024765/SHA + local raw caveat + frozen completedBoundary, level18 preexisting-harrier consume numerics, 20110+20252/source+provider_target, shared W provider + W-before-P/P-before-W order independence, no W AS magnitude claim, and bilateral evidence (owning 0a6301e / integrated 12d9281 / Wasm 7c84b36; Web parity no change; no mark-production/duration/Valor/monster/R-disable/parry/live claim)',
    );
  }
  const mQuinnEReason = String(mQuinnE?.reason || '');
  const mQuinnEBoundary =
    'rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_140_plus_0_20_bonus_ad; no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks';
  if (
    !STATUS_OVERRIDES.has('hero_skill|hero_quinn|E|旋翔掠杀') ||
    !mQuinnE ||
    mQuinnE.key !== 'hero_skill|hero_quinn|E|旋翔掠杀' ||
    mQuinnE.passiveName !== '旋翔掠杀' ||
    mQuinnE.status !== 'completed' ||
    mQuinnE.completionMode !== 'full' ||
    mQuinnE.lane !== 'generic_runtime' ||
    mQuinnE.blocker ||
    mQuinnE.dataGapEvidence !== null ||
    mQuinnE.runtimeGapEvidence !== null ||
    mQuinnE.outOfScopeEvidence !== null ||
    mQuinnE.coverageBoundary !== mQuinnEBoundary ||
    [...(mQuinnE.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mQuinnE.mechanismTags || []).includes('distance_or_ratio_modifier') ||
    (mQuinnE.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mQuinnE.mechanismTags || []).includes('dps_relevant_manual_review') ||
    mQuinnEReason.includes('distance_based_damage_modifier / damage_multiplier') ||
    mQuinnEReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mQuinnEReason.includes('meta_or_non_target_dps') ||
    mQuinnEReason.includes('zero listeners') ||
    !mQuinnEReason.includes('4024768') ||
    !mQuinnEReason.includes(
      '9f6baba1d062b473d41586cd8323f31bd7c1c4d865db134a783c19ae998e7714',
    ) ||
    !mQuinnEReason.includes('317ac3ccf31e53ba17255dbb15c856ba5499d9257fbe0c9faa91b43f8438e24b') ||
    !mQuinnEReason.includes('Template:Data Quinn/E') ||
    !mQuinnEReason.includes('Template:Data Quinn/Vault') ||
    !mQuinnEReason.includes('page1308957') ||
    !mQuinnEReason.includes('bytes2649') ||
    !mQuinnEReason.includes('2026-06-03T00:51:11Z') ||
    !mQuinnEReason.includes(mQuinnEBoundary) ||
    !mQuinnEReason.includes('nested binary') ||
    !mQuinnEReason.includes('source.attr.ad.resolved') ||
    !mQuinnEReason.includes('source.attr.ad.base') ||
    !mQuinnEReason.includes('140') ||
    !mQuinnEReason.includes('0.20') ||
    !mQuinnEReason.includes('50 mana') ||
    !mQuinnEReason.includes('8000') ||
    !mQuinnEReason.includes('baseAD59') ||
    !mQuinnEReason.includes('resolvedAD139') ||
    !mQuinnEReason.includes('raw156') ||
    !mQuinnEReason.includes('mitigated78') ||
    !mQuinnEReason.includes('raw140') ||
    !mQuinnEReason.includes('mitigated70') ||
    !mQuinnEReason.includes('t7999') ||
    !mQuinnEReason.includes('mana150') ||
    !mQuinnEReason.includes('mana49') ||
    !mQuinnEReason.includes('distance multiplier') ||
    !mQuinnEReason.includes('dash prose') ||
    !mQuinnEReason.includes('basic_attack_hit') ||
    !mQuinnEReason.includes('Quinn W') ||
    !mQuinnEReason.includes('ability_started') ||
    !mQuinnEReason.includes('不宣称全局零事件') ||
    !mQuinnEReason.includes('dash') ||
    !mQuinnEReason.includes('Harrier') ||
    !mQuinnEReason.includes('不宣称') ||
    !(mQuinnE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-quinn-vault-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_vault_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mQuinnEBoundary) &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('no distance multiplier') &&
        String(e.note || '').includes('basic_attack_hit') &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('bfe9e5b') &&
        !String(e.note || '').includes('zero listeners'),
    ) ||
    !(mQuinnE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-quinn-vault-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_quinn_vault_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mQuinnEBoundary) &&
        String(e.note || '').includes('LolGenericQuinnVaultPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('README') &&
        String(e.note || '').includes('c487eb4') &&
        String(e.note || '').includes('3f698ab') &&
        String(e.note || '').includes('bfe9e5b') &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('no Web change'),
    )
  ) {
    errors.push(
      'Quinn E must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Vault ordered tags (no distance_or_ratio_modifier), Wiki rev4024768/SHA + local raw caveat + frozen completedBoundary, rank5 50mana/8000CD/nested-binary 140+0.20bonusAD numerics, no-distance-multiplier/dash-prose override-before-fallback, no-basic_attack_hit/no-Quinn-W-arm/no-AS/may-synthesize-ability_started (not globally zero events), and bilateral evidence (owning c487eb4 / integrated 3f698ab / Wasm bfe9e5b; Web parity no change; no dash/tracking/bounce/knockback/slow/Harrier/live claim)',
    );
  }
  const mQuinnQReason = String(mQuinnQ?.reason || '');
  const mQuinnQBoundary =
    'rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_205_plus_1_00_bonus_ad_plus_0_50_ap; no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks';
  if (
    !mQuinnQ ||
    mQuinnQ.key !== 'hero_skill|hero_quinn|Q|炫目攻势' ||
    mQuinnQ.passiveName !== '炫目攻势' ||
    mQuinnQ.status !== 'completed' ||
    mQuinnQ.completionMode !== 'full' ||
    mQuinnQ.lane !== 'generic_runtime' ||
    mQuinnQ.blocker ||
    mQuinnQ.dataGapEvidence !== null ||
    mQuinnQ.runtimeGapEvidence !== null ||
    mQuinnQ.outOfScopeEvidence !== null ||
    mQuinnQ.coverageBoundary !== mQuinnQBoundary ||
    [...(mQuinnQ.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'ap_ratio',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mQuinnQ.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mQuinnQ.mechanismTags || []).includes('dps_relevant_manual_review') ||
    mQuinnQReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mQuinnQReason.includes('meta_or_non_target_dps') ||
    mQuinnQReason.includes('zero listeners') ||
    !mQuinnQReason.includes('4024766') ||
    !mQuinnQReason.includes(
      'abce6abdc2eefd069beba2d4297a1c9da5b1a675a426edb747346d9679d8085d',
    ) ||
    !mQuinnQReason.includes('be8878560c7d6541440d952788e40aeba0bef25a49955379df26f45ec82737bd') ||
    !mQuinnQReason.includes('Template:Data Quinn/Q') ||
    !mQuinnQReason.includes('Template:Data Quinn/Blinding Assault') ||
    !mQuinnQReason.includes('page1308954') ||
    !mQuinnQReason.includes('bytes1742') ||
    !mQuinnQReason.includes('2026-06-03T00:49:42Z') ||
    !mQuinnQReason.includes(mQuinnQBoundary) ||
    !mQuinnQReason.includes('nested binary') ||
    !mQuinnQReason.includes('source.attr.ad.resolved') ||
    !mQuinnQReason.includes('source.attr.ad.base') ||
    !mQuinnQReason.includes('source.attr.ap.resolved') ||
    !mQuinnQReason.includes('205') ||
    !mQuinnQReason.includes('1.00') ||
    !mQuinnQReason.includes('0.50') ||
    !mQuinnQReason.includes('70 mana') ||
    !mQuinnQReason.includes('9000') ||
    !mQuinnQReason.includes('baseAD59') ||
    !mQuinnQReason.includes('resolvedAD139') ||
    !mQuinnQReason.includes('raw335') ||
    !mQuinnQReason.includes('167.5') ||
    !mQuinnQReason.includes('raw205') ||
    !mQuinnQReason.includes('285') ||
    !mQuinnQReason.includes('255') ||
    !mQuinnQReason.includes('102.5') ||
    !mQuinnQReason.includes('142.5') ||
    !mQuinnQReason.includes('127.5') ||
    !mQuinnQReason.includes('t8999') ||
    !mQuinnQReason.includes('mana210') ||
    !mQuinnQReason.includes('mana69') ||
    !mQuinnQReason.includes('basic_attack_hit') ||
    !mQuinnQReason.includes('Quinn W') ||
    !mQuinnQReason.includes('ability_started') ||
    !mQuinnQReason.includes('不宣称全局零事件') ||
    !mQuinnQReason.includes('Valor') ||
    !mQuinnQReason.includes('nearsight') ||
    !mQuinnQReason.includes('disarm') ||
    !mQuinnQReason.includes('不宣称') ||
    !(mQuinnQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-quinn-blinding-assault-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_blinding_assault_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mQuinnQBoundary) &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('basic_attack_hit') &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('ba71996') &&
        !String(e.note || '').includes('zero listeners'),
    ) ||
    !(mQuinnQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-quinn-blinding-assault-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_quinn_blinding_assault_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mQuinnQBoundary) &&
        String(e.note || '').includes('LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('README') &&
        String(e.note || '').includes('5c174b5') &&
        String(e.note || '').includes('e030cd9') &&
        String(e.note || '').includes('ba71996') &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('no Web change'),
    )
  ) {
    errors.push(
      'Quinn Q must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Blinding Assault ordered tags (no meta_or_non_target_dps), Wiki rev4024766/SHA + local raw caveat + frozen completedBoundary, rank5 70mana/9000CD/nested-binary 205+1.00bonusAD+0.50AP numerics, no-basic_attack_hit/no-Quinn-W-arm/no-AS/may-synthesize-ability_started (not globally zero events), and bilateral evidence (owning 5c174b5 / integrated e030cd9 / Wasm ba71996; Web parity no change; no Valor/projectile/Harrier/nearsight/disarm/live claim)',
    );
  }
  if (
    !mQuinnW ||
    mQuinnW.status !== 'completed' ||
    mQuinnW.completionMode !== 'full' ||
    mQuinnW.lane !== 'generic_runtime' ||
    mQuinnW.blocker ||
    !String(mQuinnW.reason || '').includes('harrier') ||
    !String(mQuinnW.reason || '').includes('80%') ||
    String(mQuinnW.reason || '').includes('+40%') ||
    citesForbiddenProvenance(mQuinnW.reason) ||
    !(mQuinnW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-quinn-heightened-senses' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_quinn_heightened_senses_test.go' &&
        e.sourceWorktree === 'wasm',
    ) ||
    !(mQuinnW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-quinn-heightened-senses' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_quinn_heightened_senses_seed.sql' &&
        e.sourceWorktree === 'backend',
    )
  ) {
    errors.push(
      'Quinn W 敏锐感知 must be completed/full for Wiki rank-5 +80% AS branch with wasm/backend evidence refs',
    );
  }
  if (
    !mKogmawQ ||
    mKogmawQ.status !== 'completed' ||
    mKogmawQ.completionMode !== 'full' ||
    mKogmawQ.lane !== 'generic_runtime' ||
    mKogmawQ.blocker ||
    !String(mKogmawQ.reason || '').includes('3960434') ||
    !String(mKogmawQ.reason || '').includes('0.90') ||
    !String(mKogmawQ.reason || '').includes('32%') ||
    citesForbiddenProvenance(mKogmawQ.reason) ||
    !(mKogmawQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kogmaw-caustic-spittle' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_caustic_spittle_test.go' &&
        e.sourceWorktree === 'wasm',
    ) ||
    !(mKogmawQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kogmaw-caustic-spittle' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_kogmaw_caustic_spittle_seed.sql' &&
        e.sourceWorktree === 'backend',
    )
  ) {
    errors.push(
      'KogMaw Q 腐蚀唾液 must be completed/full/generic_runtime with Wiki rev3960434 active+passive and bilateral wasm/backend evidence',
    );
  }
  const mKogmawE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kogmaw|E|虚空淤泥');
  if (
    !mKogmawE ||
    mKogmawE.status !== 'completed' ||
    mKogmawE.completionMode !== 'full' ||
    mKogmawE.lane !== 'generic_runtime' ||
    mKogmawE.blocker ||
    mKogmawE.dataGapEvidence !== null ||
    mKogmawE.runtimeGapEvidence !== null ||
    mKogmawE.outOfScopeEvidence !== null ||
    mKogmawE.coverageBoundary !==
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration' ||
    [...(mKogmawE.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mKogmawE.mechanismTags || []).includes('multi_target_or_area') ||
    !String(mKogmawE.reason || '').includes('3965135') ||
    !String(mKogmawE.reason || '').includes(
      '1dd448ea1985237f002dec43e2bf93d860eb976f7c98e75883254cb3cf70794b',
    ) ||
    !String(mKogmawE.reason || '').includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration',
    ) ||
    !String(mKogmawE.reason || '').includes('230') ||
    !String(mKogmawE.reason || '').includes('0.65') ||
    !String(mKogmawE.reason || '').includes('100 mana') ||
    !String(mKogmawE.reason || '').includes('12000') ||
    !String(mKogmawE.reason || '').includes('raw295') ||
    !String(mKogmawE.reason || '').includes('147.5') ||
    !String(mKogmawE.reason || '').includes('125') ||
    !String(mKogmawE.reason || '').includes('Effect at cast time start') ||
    !String(mKogmawE.reason || '').includes('不宣称') ||
    !(mKogmawE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kogmaw-void-ooze-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_void_ooze_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration',
        ),
    ) ||
    !(mKogmawE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kogmaw-void-ooze-primary-hit' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_kogmaw_void_ooze_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration',
        ) &&
        String(e.note || '').includes('LolGenericKogmawVoidOozePrimaryHitSeedSqlTest'),
    )
  ) {
    errors.push(
      "Kog'Maw E must be completed/full/generic_runtime with cleared multi_target/governed gaps, Wiki rev3965135/SHA, frozen boundary/formula/cost/CD/numeric schedule, cast-time-start scaffold wording, bilateral evidence, and exclusions (no line/area/field/slow/projectile fidelity claim)",
    );
  }
  const mKogmawR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kogmaw|R|活体大炮');
  const mKogmawRReason = String(mKogmawR?.reason || '');
  const mKogmawRBoundary =
    'rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth';
  if (
    !mKogmawR ||
    mKogmawR.key !== 'hero_skill|hero_kogmaw|R|活体大炮' ||
    mKogmawR.passiveName !== '活体大炮' ||
    mKogmawR.status !== 'completed' ||
    mKogmawR.completionMode !== 'full' ||
    mKogmawR.lane !== 'generic_runtime' ||
    mKogmawR.blocker ||
    mKogmawR.dataGapEvidence !== null ||
    mKogmawR.runtimeGapEvidence !== null ||
    mKogmawR.outOfScopeEvidence !== null ||
    mKogmawR.coverageBoundary !== mKogmawRBoundary ||
    [...(mKogmawR.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'bonus_ad_and_ap_ratio',
        'missing_health_damage_multiplier',
        'stack_escalating_mana_cost',
        'timed_provider_state',
      ].join('|') ||
    (mKogmawR.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mKogmawR.mechanismTags || []).includes('dps_relevant_manual_review') ||
    mKogmawRReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mKogmawRReason.includes('meta_or_non_target_dps') ||
    !mKogmawRReason.includes('4007636') ||
    !mKogmawRReason.includes(
      '32f8dd8d875aaf95cec2be9cfe4a5a5526881b956f2f23e06ab87dc331ca8641',
    ) ||
    !mKogmawRReason.includes('11db6c16391dcbfa2c091e81399bff4b2a0abffcd468f71ea5e9d89759d5e447') ||
    !mKogmawRReason.includes("Template:Data Kog'Maw/R") ||
    !mKogmawRReason.includes("Template:Data Kog'Maw/Living Artillery") ||
    !mKogmawRReason.includes('page1307963') ||
    !mKogmawRReason.includes('bytes2453') ||
    !mKogmawRReason.includes('bytes2452') ||
    !mKogmawRReason.includes(mKogmawRBoundary) ||
    !mKogmawRReason.includes('40*(1+living_artillery_stacks)') ||
    !mKogmawRReason.includes('1000ms') ||
    !mKogmawRReason.includes('zero listeners') ||
    !mKogmawRReason.includes('ability-start') ||
    !mKogmawRReason.includes('180') ||
    !mKogmawRReason.includes('0.75') ||
    !mKogmawRReason.includes('0.45') ||
    !mKogmawRReason.includes('base285') ||
    !mKogmawRReason.includes('142.5') ||
    !mKogmawRReason.includes('427.5') ||
    !mKogmawRReason.includes('213.75') ||
    !mKogmawRReason.includes('570') ||
    !mKogmawRReason.includes('t999') ||
    !mKogmawRReason.includes('mana380') ||
    !mKogmawRReason.includes('mana79') ||
    !mKogmawRReason.includes('2200') ||
    !mKogmawRReason.includes('8000ms') ||
    !mKogmawRReason.includes('0.6s delay') ||
    !mKogmawRReason.includes('不宣称') ||
    !(mKogmawR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kogmaw-living-artillery' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_living_artillery_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mKogmawRBoundary) &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('d58370a'),
    ) ||
    !(mKogmawR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kogmaw-living-artillery' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_provider_state_cost_gate_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mKogmawRBoundary) &&
        String(e.note || '').includes('provider-aware') &&
        String(e.note || '').includes('d58370a'),
    ) ||
    !(mKogmawR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kogmaw-living-artillery' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_kogmaw_living_artillery_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mKogmawRBoundary) &&
        String(e.note || '').includes('LolGenericKogmawLivingArtillerySeedSqlTest') &&
        String(e.note || '').includes('100679a') &&
        String(e.note || '').includes('473bd50') &&
        String(e.note || '').includes('175b03a') &&
        String(e.note || '').includes('d563b67') &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('do not endorse') &&
        String(e.note || '').includes('d58370a') &&
        String(e.note || '').includes('38b9229'),
    )
  ) {
    errors.push(
      "Kog'Maw R must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Living Artillery ordered tags (no meta_or_non_target_dps), Wiki rev4007636/SHA + local raw caveat + frozen completedBoundary, rank3 mana40*(1+stacks)/1000CD/nested-binary 180+0.75bonusAD+0.45AP missing-HP multiplier numerics, and bilateral evidence (owning 100679a+473bd50 / integrated 175b03a+d563b67 / Wasm d58370a + provider cost gate; Web 38b9229 artifact-only; no delay/location/geometry/multitarget/sight/reveal/stealth/live claim)",
    );
  }
  const mKaisaW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kaisa|W|虚空索敌');
  const mKaisaWReason = String(mKaisaW?.reason || '');
  if (
    !mKaisaW ||
    mKaisaW.status !== 'completed' ||
    mKaisaW.completionMode !== 'full' ||
    mKaisaW.lane !== 'generic_runtime' ||
    mKaisaW.blocker ||
    mKaisaW.dataGapEvidence !== null ||
    mKaisaW.runtimeGapEvidence !== null ||
    mKaisaW.outOfScopeEvidence !== null ||
    mKaisaW.coverageBoundary !==
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund' ||
    [...(mKaisaW.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mKaisaW.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mKaisaW.mechanismTags || []).includes('bonus_ad_ratio') ||
    (mKaisaW.mechanismTags || []).includes('total_ad_ratio') ||
    mKaisaWReason.includes('meta_or_non_target_dps') ||
    mKaisaWReason.includes('bonus_ad_ratio') ||
    mKaisaWReason.includes('ad.resolved-ad.base') ||
    mKaisaWReason.includes('implementation_gap_no_unresolved_data_fields') ||
    !mKaisaWReason.includes('4034696') ||
    !mKaisaWReason.includes(
      'aa4ba76c6fa345c711651fa56d9b914d4ea8b7eb3ddfae79d7feb25470d7e3d1',
    ) ||
    !mKaisaWReason.includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund',
    ) ||
    !mKaisaWReason.includes('source.attr.ad.resolved') ||
    !mKaisaWReason.includes('totalAD100') ||
    !mKaisaWReason.includes('130') ||
    !mKaisaWReason.includes('1.30') ||
    !mKaisaWReason.includes('0.45') ||
    !mKaisaWReason.includes('75 mana') ||
    !mKaisaWReason.includes('14000') ||
    !mKaisaWReason.includes('raw305') ||
    !mKaisaWReason.includes('152.5') ||
    !mKaisaWReason.includes('195') ||
    !mKaisaWReason.includes('695') ||
    !mKaisaWReason.includes('Effect at cast time end') ||
    !mKaisaWReason.includes('0.4s cast') ||
    !mKaisaWReason.includes('Plasma') ||
    !mKaisaWReason.includes('evolution') ||
    !mKaisaWReason.includes('cooldown refund') ||
    !mKaisaWReason.includes('不宣称') ||
    !(mKaisaW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kaisa-void-seeker-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_kaisa_void_seeker_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund',
        ) &&
        String(e.note || '').includes('source.attr.ad.resolved') &&
        String(e.note || '').includes('0.4s cast') &&
        String(e.note || '').includes('Plasma'),
    ) ||
    !(mKaisaW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kaisa-void-seeker-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_kaisa_void_seeker_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund',
        ) &&
        String(e.note || '').includes('LolGenericKaisaVoidSeekerPrimaryHitSeedSqlTest'),
    )
  ) {
    errors.push(
      "Kai'Sa W must be completed/full/generic_runtime with cleared meta_or_non_target_dps/governed gaps, Wiki rev4034696/SHA, frozen boundary/total-AD formula via source.attr.ad.resolved (not bonus AD)/cost/CD/numeric schedule, cast-end/Plasma/evolution/refund exclusion wording, bilateral evidence, and no cast/projectile/sight/reveal/Plasma/evolution/refund fidelity claim",
    );
  }
  const mVarusE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_varus|E|恶灵箭雨');
  if (
    !mVarusE ||
    mVarusE.status !== 'completed' ||
    mVarusE.completionMode !== 'full' ||
    mVarusE.lane !== 'generic_runtime' ||
    mVarusE.blocker ||
    mVarusE.dataGapEvidence !== null ||
    mVarusE.runtimeGapEvidence !== null ||
    mVarusE.outOfScopeEvidence !== null ||
    mVarusE.coverageBoundary !==
      'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation' ||
    [...(mVarusE.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mVarusE.mechanismTags || []).includes('survivability_only') ||
    !String(mVarusE.reason || '').includes('3969402') ||
    !String(mVarusE.reason || '').includes(
      '7b4be71bcc26ba933dff0235882d272c14e406abbf505290018ba15a5ba658e9',
    ) ||
    !String(mVarusE.reason || '').includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation',
    ) ||
    !String(mVarusE.reason || '').includes('physical') ||
    !String(mVarusE.reason || '').includes('180') ||
    !String(mVarusE.reason || '').includes('0.90') ||
    !String(mVarusE.reason || '').includes('90 mana') ||
    !String(mVarusE.reason || '').includes('10000') ||
    !String(mVarusE.reason || '').includes('baseAD59') ||
    !String(mVarusE.reason || '').includes('resolvedAD159') ||
    !String(mVarusE.reason || '').includes('raw270') ||
    !String(mVarusE.reason || '').includes('mitigated135') ||
    !String(mVarusE.reason || '').includes('140') ||
    !String(mVarusE.reason || '').includes('damagetype=Magic') ||
    !String(mVarusE.reason || '').includes('矛盾') ||
    !String(mVarusE.reason || '').includes('0.5s landing delay') ||
    !String(mVarusE.reason || '').includes('不宣称') ||
    !(mVarusE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-varus-hail-of-arrows-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_varus_hail_of_arrows_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation',
        ) &&
        String(e.note || '').includes('damagetype=Magic') &&
        String(e.note || '').includes('0.5s landing delay'),
    ) ||
    !(mVarusE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-varus-hail-of-arrows-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_varus_hail_of_arrows_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation',
        ) &&
        String(e.note || '').includes('LolGenericVarusHailOfArrowsPrimaryHitSeedSqlTest'),
    )
  ) {
    errors.push(
      'Varus E must be completed/full/generic_runtime with cleared survivability_only/governed gaps, Wiki rev3969402/SHA, frozen boundary/physical formula/cost/CD/numeric schedule, description+rank-table physical authority with explicit isolated-Magic contradiction disclosure (not runtime truth), 0.5s landing-delay exclusion wording, bilateral evidence, and exclusions (no delay/area/field/control/W-detonation fidelity claim)',
    );
  }
  const mVarusR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_varus|R|腐败锁链');
  const mVarusRReason = String(mVarusR?.reason || '');
  if (
    !mVarusR ||
    mVarusR.status !== 'completed' ||
    mVarusR.completionMode !== 'full' ||
    mVarusR.lane !== 'generic_runtime' ||
    mVarusR.blocker ||
    mVarusR.dataGapEvidence !== null ||
    mVarusR.runtimeGapEvidence !== null ||
    mVarusR.outOfScopeEvidence !== null ||
    mVarusR.coverageBoundary !==
      'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget' ||
    [...(mVarusR.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mVarusR.mechanismTags || []).includes('multi_target_or_area') ||
    mVarusRReason.includes('multi_target_or_area') ||
    mVarusRReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mVarusRReason.includes('blocked_data') ||
    !mVarusRReason.includes('4008213') ||
    !mVarusRReason.includes(
      '62b397cc7133a767427e00a1a5b435fcb3fd94b4ec5021be4a7869837683e4ed',
    ) ||
    !mVarusRReason.includes(
      'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget',
    ) ||
    !mVarusRReason.includes('source.attr.ap.resolved') ||
    !mVarusRReason.includes('350') ||
    !mVarusRReason.includes('1.00') ||
    !mVarusRReason.includes('100 mana') ||
    !mVarusRReason.includes('60000') ||
    !mVarusRReason.includes('raw550') ||
    !mVarusRReason.includes('275') ||
    !mVarusRReason.includes('300') ||
    !mVarusRReason.includes('450') ||
    !mVarusRReason.includes('Effect at cast time end') ||
    !mVarusRReason.includes('0.65') ||
    !mVarusRReason.includes('1.2') ||
    !mVarusRReason.includes('1.75') ||
    !mVarusRReason.includes('Batch-B identity/AP check-only') ||
    !mVarusRReason.includes('mana320/320') ||
    !mVarusRReason.includes(
      'games/game_entities/attribute_definitions/entity_attribute_values',
    ) ||
    !mVarusRReason.includes('不宣称') ||
    !(mVarusR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-varus-chain-of-corruption-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_varus_chain_of_corruption_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget',
        ) &&
        String(e.note || '').includes('Effect at cast time end') &&
        String(e.note || '').includes('raw550'),
    ) ||
    !(mVarusR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-varus-chain-of-corruption-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_varus_chain_of_corruption_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget',
        ) &&
        String(e.note || '').includes('LolGenericVarusChainOfCorruptionPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('067b0f8') &&
        String(e.note || '').includes('982145c') &&
        String(e.note || '').includes('74f3b22') &&
        String(e.note || '').includes('Batch-B identity/AP check-only') &&
        String(e.note || '').includes('mana320/320') &&
        String(e.note || '').includes(
          'games/game_entities/attribute_definitions/entity_attribute_values',
        ),
    )
  ) {
    errors.push(
      'Varus R must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Chain of Corruption tags (no multi_target_or_area), Wiki rev4008213/SHA + frozen completedBoundary, numeric contract/100mana/60000CD/AP200→raw550/MR100→275/mana100/HP450, cast-end/root/reveal/Blight/tendril/seek/spread/multitarget exclusions, Batch-B identity/AP check-only + self-contained mana320/320 ensure (no games/game_entities/attribute_definitions/entity_attribute_values writes), and bilateral wasm+backend evidence (owning 067b0f8 / integrated 982145c / Wasm 74f3b22; no cast/projectile/geometry/direction/root/reveal/Blight/tendril fidelity claim)',
    );
  }
  const mTwistedFateQ = inv.mechanisms.find(
    (m) => m.key === 'hero_skill|hero_twistedfate|Q|万能牌',
  );
  const mTwistedFateQReason = String(mTwistedFateQ?.reason || '');
  if (
    !mTwistedFateQ ||
    mTwistedFateQ.status !== 'completed' ||
    mTwistedFateQ.completionMode !== 'full' ||
    mTwistedFateQ.lane !== 'generic_runtime' ||
    mTwistedFateQ.blocker ||
    mTwistedFateQ.dataGapEvidence !== null ||
    mTwistedFateQ.runtimeGapEvidence !== null ||
    mTwistedFateQ.outOfScopeEvidence !== null ||
    mTwistedFateQ.coverageBoundary !==
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget' ||
    [...(mTwistedFateQ.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mTwistedFateQ.mechanismTags || []).includes('dps_relevant_manual_review') ||
    mTwistedFateQReason.includes('dps_relevant_manual_review') ||
    mTwistedFateQReason.includes('implementation_gap_no_unresolved_data_fields') ||
    !mTwistedFateQReason.includes('3950864') ||
    !mTwistedFateQReason.includes(
      '9cdd62cc18d41a4bbe1e42ac8202b40a776f7da51c67c6f2fea37f9ed1f0d597',
    ) ||
    !mTwistedFateQReason.includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget',
    ) ||
    !mTwistedFateQReason.includes('source.attr.ad.resolved-source.attr.ad.base') ||
    !mTwistedFateQReason.includes('baseAD52') ||
    !mTwistedFateQReason.includes('resolvedAD100') ||
    !mTwistedFateQReason.includes('240') ||
    !mTwistedFateQReason.includes('0.50') ||
    !mTwistedFateQReason.includes('0.85') ||
    !mTwistedFateQReason.includes('100 mana') ||
    !mTwistedFateQReason.includes('5000') ||
    !mTwistedFateQReason.includes('raw349') ||
    !mTwistedFateQReason.includes('174.5') ||
    !mTwistedFateQReason.includes('133') ||
    !mTwistedFateQReason.includes('651') ||
    !mTwistedFateQReason.includes('once-per-pass') ||
    !mTwistedFateQReason.includes('cast0.25') ||
    !mTwistedFateQReason.includes('Effect at cast time end') ||
    !mTwistedFateQReason.includes('fan') ||
    !mTwistedFateQReason.includes('range1450') ||
    !mTwistedFateQReason.includes('不宣称') ||
    !(mTwistedFateQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-twisted-fate-wild-cards-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_twisted_fate_wild_cards_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget',
        ) &&
        String(e.note || '').includes('once-per-pass') &&
        String(e.note || '').includes('cast0.25'),
    ) ||
    !(mTwistedFateQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-twisted-fate-wild-cards-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_twisted_fate_wild_cards_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget',
        ) &&
        String(e.note || '').includes('LolGenericTwistedFateWildCardsPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('18b959e') &&
        String(e.note || '').includes('a0da4f8') &&
        String(e.note || '').includes('589db93'),
    )
  ) {
    errors.push(
      'Twisted Fate Q must be completed/full/generic_runtime with cleared dps_relevant_manual_review/governed gaps, Wiki rev3950864/SHA, frozen boundary/bonus-AD+AP formula/cost/CD/numeric schedule, once-per-pass as single-hit justification only, cast0.25/fan/cone/projectile exclusion wording, bilateral evidence (owning 18b959e / integrated a0da4f8 / Wasm 589db93), and no cast/fan/cone/projectile/pass fidelity claim',
    );
  }
  if (
    !mXayahQ ||
    !STATUS_OVERRIDES.has('hero_skill|hero_xayah|Q|双刃') ||
    mXayahQ.key !== 'hero_skill|hero_xayah|Q|双刃' ||
    mXayahQ.passiveName !== '双刃' ||
    mXayahQ.status !== 'completed' ||
    mXayahQ.completionMode !== 'full' ||
    mXayahQ.lane !== 'generic_runtime' ||
    mXayahQ.blocker ||
    mXayahQ.dataGapEvidence !== null ||
    mXayahQ.runtimeGapEvidence !== null ||
    mXayahQ.outOfScopeEvidence !== null ||
    mXayahQ.coverageBoundary !==
      'rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks' ||
    [...(mXayahQ.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mXayahQ.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mXayahQ.mechanismTags || []).includes('meta_or_non_target_dps') ||
    String(mXayahQ.reason || '').includes('implementation_gap_no_unresolved_data_fields') ||
    String(mXayahQ.reason || '').includes('blocked_data') ||
    String(mXayahQ.reason || '').includes('dps_relevant_manual_review') ||
    !String(mXayahQ.reason || '').includes('4008615') ||
    !String(mXayahQ.reason || '').includes(
      '8010e567d2366730c5eb6cd0a31baec09c7f5137018ab2ca15fd84f167d990fd',
    ) ||
    !String(mXayahQ.reason || '').includes(
      '6a1fde0a18de0b6f28e55be7df27e58f99c91d49310e79ae81a9e95384f974de',
    ) ||
    !String(mXayahQ.reason || '').includes('Template:Data Xayah/Q') ||
    !String(mXayahQ.reason || '').includes('Template:Data Xayah/Double Daggers') ||
    !String(mXayahQ.reason || '').includes('page1324541') ||
    !String(mXayahQ.reason || '').includes('page1324536') ||
    !String(mXayahQ.reason || '').includes('rev2864045') ||
    !String(mXayahQ.reason || '').includes('bytes2615') ||
    !String(mXayahQ.reason || '').includes('2026-04-15T00:26:21Z') ||
    !String(mXayahQ.reason || '').includes(
      'rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks',
    ) ||
    !String(mXayahQ.reason || '').includes('nested binary') ||
    !String(mXayahQ.reason || '').includes('source.attr.ad.resolved') ||
    !String(mXayahQ.reason || '').includes('source.attr.ad.base') ||
    !String(mXayahQ.reason || '').includes('105') ||
    !String(mXayahQ.reason || '').includes('0.50') ||
    !String(mXayahQ.reason || '').includes('35 mana') ||
    !String(mXayahQ.reason || '').includes('8000') ||
    !String(mXayahQ.reason || '').includes('baseAD60') ||
    !String(mXayahQ.reason || '').includes('resolvedAD60') ||
    !String(mXayahQ.reason || '').includes('resolvedAD110') ||
    !String(mXayahQ.reason || '').includes('total210') ||
    !String(mXayahQ.reason || '').includes('total105') ||
    !String(mXayahQ.reason || '').includes('total260') ||
    !String(mXayahQ.reason || '').includes('total130') ||
    !String(mXayahQ.reason || '').includes('52.5') ||
    !String(mXayahQ.reason || '').includes('t7999') ||
    !String(mXayahQ.reason || '').includes('mana105') ||
    !String(mXayahQ.reason || '').includes('mana34') ||
    !String(mXayahQ.reason || '').includes('HP740') ||
    !String(mXayahQ.reason || '').includes('ability_started') ||
    !String(mXayahQ.reason || '').includes('does not arm W') ||
    !String(mXayahQ.reason || '').includes('AS stays baseline') ||
    !String(mXayahQ.reason || '').includes('ability/xayah_deadly_plumage') ||
    !String(mXayahQ.reason || '').includes('ability_id NULL') ||
    !String(mXayahQ.reason || '').includes('ListenerDefinition.AbilityRef') ||
    !String(mXayahQ.reason || '').includes('external existing-data/check-only') ||
    !String(mXayahQ.reason || '').includes('identity/panel/resource') ||
    !String(mXayahQ.reason || '').includes('不宣称') ||
    !(mXayahQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-xayah-double-daggers-primary-two-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_xayah_double_daggers_primary_two_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks',
        ) &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('does not arm W') &&
        String(e.note || '').includes('dd7dae6') &&
        String(e.note || '').includes('6a1fde0a') &&
        String(e.note || '').includes('page1324536'),
    ) ||
    !(mXayahQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-xayah-double-daggers-primary-two-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_xayah_double_daggers_primary_two_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks',
        ) &&
        String(e.note || '').includes('LolGenericXayahDoubleDaggersPrimaryTwoHitSeedSqlTest') &&
        String(e.note || '').includes('8ace954') &&
        String(e.note || '').includes('6bab0b8') &&
        String(e.note || '').includes('dd7dae6') &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('W isolation'),
    )
  ) {
    errors.push(
      'Xayah Q must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Double Daggers ordered tags (no dps_relevant_manual_review), Wiki rev4008615/SHA + local raw caveat + live-redirect-not-sidecar + frozen completedBoundary, rank5 35mana/8000CD/two nested-binary 105+0.50bonusAD hits numerics/schedules/W isolation, and bilateral evidence (owning 8ace954 / integrated 6bab0b8 / Wasm dd7dae6; no cast-time/lockout/projectile/secondary-reduction/feather/ground/E/live claim)',
    );
  }
  if (
    !mXayahR ||
    !STATUS_OVERRIDES.has('hero_skill|hero_xayah|R|暴风羽刃') ||
    mXayahR.key !== 'hero_skill|hero_xayah|R|暴风羽刃' ||
    mXayahR.passiveName !== '暴风羽刃' ||
    mXayahR.status !== 'completed' ||
    mXayahR.completionMode !== 'full' ||
    mXayahR.lane !== 'generic_runtime' ||
    mXayahR.blocker ||
    mXayahR.dataGapEvidence !== null ||
    mXayahR.runtimeGapEvidence !== null ||
    mXayahR.outOfScopeEvidence !== null ||
    mXayahR.coverageBoundary !==
      'rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity' ||
    [...(mXayahR.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mXayahR.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mXayahR.mechanismTags || []).includes('meta_or_non_target_dps') ||
    String(mXayahR.reason || '').includes('implementation_gap_no_unresolved_data_fields') ||
    String(mXayahR.reason || '').includes('blocked_data') ||
    String(mXayahR.reason || '').includes('dps_relevant_manual_review') ||
    !String(mXayahR.reason || '').includes('4008617') ||
    !String(mXayahR.reason || '').includes(
      'cb5c8ba5486a55027e7c2252589fa8e5d821d346cc44afa99243de71ce5b3077',
    ) ||
    !String(mXayahR.reason || '').includes(
      'debf23b0213a4d9669a29f6c415a6f67d582b7093d25059b7765745bed43ace1',
    ) ||
    !String(mXayahR.reason || '').includes('Template:Data Xayah/R') ||
    !String(mXayahR.reason || '').includes('Template:Data Xayah/Featherstorm') ||
    !String(mXayahR.reason || '').includes('page1324544') ||
    !String(mXayahR.reason || '').includes('bytes1761') ||
    !String(mXayahR.reason || '').includes('2026-04-15T00:26:44Z') ||
    !String(mXayahR.reason || '').includes(
      'rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity',
    ) ||
    !String(mXayahR.reason || '').includes('source.attr.ad.resolved') ||
    !String(mXayahR.reason || '').includes('source.attr.ad.base') ||
    !String(mXayahR.reason || '').includes('400') ||
    !String(mXayahR.reason || '').includes('1.00') ||
    !String(mXayahR.reason || '').includes('100 mana') ||
    !String(mXayahR.reason || '').includes('100000') ||
    !String(mXayahR.reason || '').includes('baseAD60') ||
    !String(mXayahR.reason || '').includes('resolvedAD60') ||
    !String(mXayahR.reason || '').includes('resolvedAD110') ||
    !String(mXayahR.reason || '').includes('raw400') ||
    !String(mXayahR.reason || '').includes('raw450') ||
    !String(mXayahR.reason || '').includes('armor0=400') ||
    !String(mXayahR.reason || '').includes('armor100=200') ||
    !String(mXayahR.reason || '').includes('armor0=450') ||
    !String(mXayahR.reason || '').includes('armor100=225') ||
    !String(mXayahR.reason || '').includes('t99999') ||
    !String(mXayahR.reason || '').includes('t100000') ||
    !String(mXayahR.reason || '').includes('mana300') ||
    !String(mXayahR.reason || '').includes('mana99') ||
    !String(mXayahR.reason || '').includes('HP550') ||
    !String(mXayahR.reason || '').includes('ability_started') ||
    !String(mXayahR.reason || '').includes('never arm W') ||
    !String(mXayahR.reason || '').includes('W self-cast arms W') ||
    !String(mXayahR.reason || '').includes('one quantum') ||
    !String(mXayahR.reason || '').includes('two hits') ||
    !String(mXayahR.reason || '').includes('ability/xayah_deadly_plumage') ||
    !String(mXayahR.reason || '').includes('ability_id NULL') ||
    !String(mXayahR.reason || '').includes('ListenerDefinition.AbilityRef') ||
    !String(mXayahR.reason || '').includes('external existing-data/check-only') ||
    !String(mXayahR.reason || '').includes('Q optional') ||
    !String(mXayahR.reason || '').includes('identity/panel/resource') ||
    !String(mXayahR.reason || '').includes('不宣称') ||
    !String(mXayahR.reason || '').includes('no equivalence or contradiction claim') ||
    String(mXayahR.reason || '').includes('canonical byte equivalence') ||
    String(mXayahR.reason || '').includes('Wiki proves the full R is once-only') ||
    String(mXayahR.reason || '').includes('complete Featherstorm has one total hit') ||
    String(mXayahR.reason || '').includes('five damage ops') ||
    !(mXayahR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-xayah-featherstorm-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_xayah_featherstorm_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity',
        ) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('never arm W') &&
        String(e.note || '').includes('57ec17c') &&
        String(e.note || '').includes('debf23b0') &&
        String(e.note || '').includes('no claim Wiki proves'),
    ) ||
    !(mXayahR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-xayah-featherstorm-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_xayah_featherstorm_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity',
        ) &&
        String(e.note || '').includes('LolGenericXayahFeatherstormPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('354fd287') &&
        String(e.note || '').includes('741e1ff') &&
        String(e.note || '').includes('57ec17c') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('Q optional') &&
        String(e.note || '').includes('W isolation'),
    )
  ) {
    errors.push(
      'Xayah R must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Featherstorm ordered tags (no dps_relevant_manual_review), Wiki rev4008617/SHA + local raw caveat + frozen completedBoundary, rank3 100mana/100000CD/one quantum 400+1.00bonusAD numerics/schedules/W-Q-R isolation, semantic framing (no Wiki-proven once-only / no five ops / no same-target multi-feather), and bilateral evidence (owning 354fd287 / integrated 741e1ff / Wasm 57ec17c; no leap/ghosted/delay/lockout/projectile/feather/ground/E/live claim)',
    );
  }
  if (
    !mXayahW ||
    mXayahW.status !== 'completed' ||
    mXayahW.completionMode !== 'full' ||
    mXayahW.lane !== 'generic_runtime' ||
    mXayahW.blocker ||
    mXayahW.runtimeGapEvidence ||
    mXayahW.dataGapEvidence ||
    !String(mXayahW.reason || '').includes('4010669') ||
    !String(mXayahW.reason || '').includes(
      '09d5476533722311e85c4ca79813cd0bec2cf35d105be894b80dac14478845a7',
    ) ||
    !String(mXayahW.reason || '').includes('1.25') ||
    !String(mXayahW.reason || '').includes('25%') ||
    String(mXayahW.reason || '').includes('20%') ||
    !(mXayahW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-xayah-deadly-plumage' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_xayah_deadly_plumage_test.go' &&
        e.sourceWorktree === 'wasm',
    ) ||
    !(mXayahW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-xayah-deadly-plumage' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_xayah_deadly_plumage_seed.sql' &&
        e.sourceWorktree === 'backend',
    )
  ) {
    errors.push(
      'Xayah W 致死羽衣 must be completed/full/generic_runtime with empty blocker/gaps, Wiki rev4010669 Phase-A 25%/1.25 wording, and bilateral wasm/backend evidence',
    );
  }
  const mJinxWReason = String(mJinxW?.reason || '');
  const mJinxWBoundary =
    'rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_1_40_total_ad; no_cast_timing_direction_range_width_projectile_travel_collision_first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity';
  if (
    !mJinxW ||
    !STATUS_OVERRIDES.has('hero_skill|hero_jinx|W|震荡电磁波！') ||
    mJinxW.key !== 'hero_skill|hero_jinx|W|震荡电磁波！' ||
    mJinxW.passiveName !== '震荡电磁波！' ||
    mJinxW.status !== 'completed' ||
    mJinxW.completionMode !== 'full' ||
    mJinxW.lane !== 'generic_runtime' ||
    mJinxW.blocker ||
    mJinxW.dataGapEvidence !== null ||
    mJinxW.runtimeGapEvidence !== null ||
    mJinxW.outOfScopeEvidence !== null ||
    mJinxW.coverageBoundary !== mJinxWBoundary ||
    [...(mJinxW.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mJinxW.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mJinxW.mechanismTags || []).includes('bonus_ad_ratio') ||
    (mJinxW.mechanismTags || []).includes('total_ad_ratio') ||
    mJinxWReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mJinxWReason.includes('blocked_data') ||
    mJinxWReason.includes('meta_or_non_target_dps') ||
    mJinxWReason.includes('bonus_ad_ratio') ||
    mJinxWReason.includes('ad.resolved-source.attr.ad.base') ||
    mJinxWReason.includes('ad.resolved-ad.base') ||
    !mJinxWReason.includes('3907092') ||
    !mJinxWReason.includes(
      '8aa6ac3943076256fe6afea15f1dd6eebf892656be45784e2522abb6243f4d1f',
    ) ||
    !mJinxWReason.includes(
      'c373cc258c5c8c612930a32c5e851bd4b68dbbcb3c0d7f71ce1d25020ba12624',
    ) ||
    !mJinxWReason.includes('Template:Data Jinx/W') ||
    !mJinxWReason.includes('Template:Data Jinx/Zap!') ||
    !mJinxWReason.includes('page1307598') ||
    !mJinxWReason.includes('bytes1321') ||
    !mJinxWReason.includes('bytes1319') ||
    !mJinxWReason.includes('2025-06-06T17:47:18Z') ||
    !mJinxWReason.includes(mJinxWBoundary) ||
    !mJinxWReason.includes('source.attr.ad.resolved') ||
    !mJinxWReason.includes('total AD') ||
    !mJinxWReason.includes('210') ||
    !mJinxWReason.includes('1.40') ||
    !mJinxWReason.includes('60 mana') ||
    !mJinxWReason.includes('4000') ||
    !mJinxWReason.includes('totalAD60') ||
    !mJinxWReason.includes('totalAD110') ||
    !mJinxWReason.includes('raw294') ||
    !mJinxWReason.includes('raw364') ||
    !mJinxWReason.includes('armor0=294') ||
    !mJinxWReason.includes('armor100=147') ||
    !mJinxWReason.includes('armor0=364') ||
    !mJinxWReason.includes('armor100=182') ||
    !mJinxWReason.includes('t3999') ||
    !mJinxWReason.includes('t4000') ||
    !mJinxWReason.includes('mana180') ||
    !mJinxWReason.includes('mana59') ||
    !mJinxWReason.includes('HP636') ||
    !mJinxWReason.includes('ability_started') ||
    !mJinxWReason.includes('standalone') ||
    !mJinxWReason.includes('external existing-data/check-only') ||
    !mJinxWReason.includes('identity/panel/resource') ||
    !mJinxWReason.includes('不暗示 Batch-B') ||
    !mJinxWReason.includes('sibling Jinx synthesis') ||
    !mJinxWReason.includes('不宣称') ||
    !mJinxWReason.includes('no equivalence or contradiction claim') ||
    mJinxWReason.includes('canonical byte equivalence') ||
    mJinxWReason.includes('Batch-B prerequisite') ||
    !(mJinxW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-jinx-zap-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_jinx_zap_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mJinxWBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('2afde02') &&
        String(e.note || '').includes('c373cc25') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mJinxW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-jinx-zap-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_jinx_zap_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mJinxWBoundary) &&
        String(e.note || '').includes('LolGenericJinxZapPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('b5abdb7') &&
        String(e.note || '').includes('a09adf1') &&
        String(e.note || '').includes('2afde02') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Jinx synthesis'),
    )
  ) {
    errors.push(
      'Jinx W must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Zap! ordered tags (no meta_or_non_target_dps/bonus_ad_ratio), Wiki rev3907092/SHA + local raw caveat + frozen completedBoundary, rank5 60mana/4000CD/one physical 210+1.40*totalAD numerics/schedules, standalone/external-existing-data/check-only/no-Batch-B/no-sibling framing, and bilateral evidence (owning b5abdb7 / integrated a09adf1 / Wasm 2afde02; no cast/direction/projectile/sight/reveal/slow/live claim)',
    );
  }
  const mJinxEReason = String(mJinxE?.reason || '');
  const mJinxEBoundary =
    'rank5_selected_primary_champion_single_magic_explosion_hit; immediate_impact_and_cooldown_scaffold; magic_290_plus_1_00_ap; no_three_chomper_layout_landing_delay_arming_delay_five_second_lifetime_location_direction_range_geometry_area_multitarget_contact_acquisition_knockdown_root_one_chomper_per_champion_wind_wall_braum_spellshield_exception_vision_other_ranks_or_full_fidelity';
  if (
    !mJinxE ||
    !STATUS_OVERRIDES.has('hero_skill|hero_jinx|E|嚼火者手雷！') ||
    mJinxE.key !== 'hero_skill|hero_jinx|E|嚼火者手雷！' ||
    mJinxE.passiveName !== '嚼火者手雷！' ||
    mJinxE.status !== 'completed' ||
    mJinxE.completionMode !== 'full' ||
    mJinxE.lane !== 'generic_runtime' ||
    mJinxE.blocker ||
    mJinxE.dataGapEvidence !== null ||
    mJinxE.runtimeGapEvidence !== null ||
    mJinxE.outOfScopeEvidence !== null ||
    mJinxE.coverageBoundary !== mJinxEBoundary ||
    [...(mJinxE.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mJinxE.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mJinxE.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mJinxE.mechanismTags || []).includes('blocked_data') ||
    (mJinxE.mechanismTags || []).includes('primary_damage_branch_salvage') ||
    (mJinxE.mechanismTags || []).includes('multi_target_or_area') ||
    !(mJinxE.mechanismTags || []).includes('active_magic_damage') ||
    !(mJinxE.mechanismTags || []).includes('ap_ratio') ||
    mJinxEReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mJinxEReason.includes('blocked_data') ||
    mJinxEReason.includes('meta_or_non_target_dps') ||
    mJinxEReason.includes('dps_relevant_manual_review') ||
    mJinxEReason.includes('primary_damage_branch_salvage') ||
    mJinxEReason.includes('multi_target_or_area') ||
    mJinxEReason.includes('out_of_scope_for_single_target_dps') ||
    !mJinxEReason.includes('3993368') ||
    !mJinxEReason.includes(
      '64562ed4adb34c932810970fd9b9c016b46329d6f956541d334c60d2bc9d83ee',
    ) ||
    !mJinxEReason.includes(
      'de7922f66deb96c8652dd1a0509105b49cdcf22278d1fd591bc366060987183a',
    ) ||
    !mJinxEReason.includes(
      'f2822e5708dd024c582575a9298c12b6e6cd66b37e3365ea8749e8e1d49b360d',
    ) ||
    !mJinxEReason.includes(
      'aabb099fd172522682e40f0826e4971797c3a047787ef3c5af902bc4b673a551',
    ) ||
    !mJinxEReason.includes('Template:Data Jinx/E') ||
    !mJinxEReason.includes('Template:Data Jinx/Flame Chompers!') ||
    !mJinxEReason.includes('page1307600') ||
    !mJinxEReason.includes('bytes1786') ||
    !mJinxEReason.includes('bytes2228') ||
    !mJinxEReason.includes('bytes694') ||
    !mJinxEReason.includes('bytes1784') ||
    !mJinxEReason.includes('2026-02-21T15:35:19Z') ||
    !mJinxEReason.includes('sourceCount12') ||
    !mJinxEReason.includes(mJinxEBoundary) ||
    !mJinxEReason.includes('source.attr.ap.resolved') ||
    !mJinxEReason.includes('exact nested binary') ||
    !mJinxEReason.includes('one AP read') ||
    !mJinxEReason.includes('290') ||
    !mJinxEReason.includes('1.00') ||
    !mJinxEReason.includes('90 mana') ||
    !mJinxEReason.includes('10000') ||
    !mJinxEReason.includes('20221') ||
    !mJinxEReason.includes('20170') ||
    !mJinxEReason.includes('no 20230') ||
    !mJinxEReason.includes('no explicit event op') ||
    !mJinxEReason.includes('no E ability-specific type') ||
    !mJinxEReason.includes('raw290/final145') ||
    !mJinxEReason.includes('raw390/final195') ||
    !mJinxEReason.includes('unrelated AD counterproof') ||
    !mJinxEReason.includes('t9999') ||
    !mJinxEReason.includes('t10000') ||
    !mJinxEReason.includes('mana270') ||
    !mJinxEReason.includes('mana89') ||
    !mJinxEReason.includes('HP610') ||
    !mJinxEReason.includes('ability_started') ||
    !mJinxEReason.includes('standalone E') ||
    !mJinxEReason.includes('E/W coexistence') ||
    !mJinxEReason.includes('does not trigger/mutate W') ||
    !mJinxEReason.includes('W does not trigger/mutate E') ||
    !mJinxEReason.includes('No P/Q/R/basic synthesis') ||
    !mJinxEReason.includes('external existing-data/check-only') ||
    !mJinxEReason.includes('hero_jinx/ap/mana') ||
    !mJinxEReason.includes('identity/panel/resource') ||
    !mJinxEReason.includes('不宣称 Jinx W/Batch-B owns prerequisites') ||
    !mJinxEReason.includes('不暗示 Batch-B') ||
    !mJinxEReason.includes('sibling Jinx synthesis') ||
    !mJinxEReason.includes('run-893fcb26-cd49-4bb2-9bc7-4a231b13762f') ||
    !mJinxEReason.includes('runDelta0') ||
    !mJinxEReason.includes('1750 parseable event lines') ||
    !mJinxEReason.includes('df08d6b341d85b3c43bc70e33e43eae0cb736ac8') ||
    !mJinxEReason.includes('run-1f38cae0-444e-4601-b316-9a74886b6b44') ||
    !mJinxEReason.includes('focused37/full1032') ||
    !mJinxEReason.includes('686ff89b4f29b1697e478d2f1b676d80a9bd3288e460bea4f57e0a3b7583ee6f') ||
    !mJinxEReason.includes('519c3e5ce2844d41bdc348441056352fb893633ca084bb261f63bffd0300d35a') ||
    !mJinxEReason.includes('bc71abfed04e04299a78bc8f17ae17ad619e779cb014d65bf8ed3912eb86b7be') ||
    !mJinxEReason.includes('3b26d3e74a6eb460bb641f42a1909f9735eb7dbd') ||
    !mJinxEReason.includes('run-1554558c-1d6b-4add-9cd8-4d52c89a6b97') ||
    !mJinxEReason.includes('focused18 PASS') ||
    !mJinxEReason.includes('9320b4dafc6225a3a20829de17223a0a6d715787') ||
    !mJinxEReason.includes('run-5b26afad-2b5f-42b7-bc71-81ae5aaff897') ||
    !mJinxEReason.includes('63966') ||
    !mJinxEReason.includes(
      '59ee84f4b61bee5f86d8cc374204e2551161e18fd20b20d9db17d8b51553741b',
    ) ||
    !mJinxEReason.includes('focused7 top-level') ||
    !mJinxEReason.includes('Node smoke+bench') ||
    !mJinxEReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mJinxEReason.includes('regression/governance evidence only') ||
    !mJinxEReason.includes('exactly one selected-primary champion magic explosion-hit quantum') ||
    !mJinxEReason.includes('不宣称') ||
    !mJinxEReason.includes('no equivalence or contradiction claim') ||
    mJinxEReason.includes('canonical byte equivalence') ||
    mJinxEReason.includes('Batch-B prerequisite') ||
    mJinxEReason.includes('live published') ||
    !(mJinxE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-jinx-flame-chompers-primary-explosion-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_jinx_flame_chompers_primary_explosion_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mJinxEBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('9320b4da') &&
        String(e.note || '').includes('aabb099f') &&
        String(e.note || '').includes('20221') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no 20230') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('no E type') &&
        String(e.note || '').includes('exact nested binary') &&
        String(e.note || '').includes('E/W coexistence') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mJinxE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-jinx-flame-chompers-primary-explosion-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_jinx_flame_chompers_primary_explosion_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mJinxEBoundary) &&
        String(e.note || '').includes('LolGenericJinxFlameChompersPrimaryExplosionHitSeedSqlTest') &&
        String(e.note || '').includes('df08d6b') &&
        String(e.note || '').includes('3b26d3e') &&
        String(e.note || '').includes('9320b4da') &&
        String(e.note || '').includes('run-893fcb26') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('no claim Jinx W/Batch-B owns prerequisites') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Jinx synthesis'),
    )
  ) {
    errors.push(
      'Jinx E must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Flame Chompers! ordered tags (no meta_or_non_target_dps/dps_relevant_manual_review/blocked_data/primary_damage_branch_salvage/multi_target_or_area; requires active_magic_damage/ap_ratio), Wiki rev3993368/SHA + normalized/pages/local-raw caveat + frozen completedBoundary, rank5 90mana/10000CD/one magic 290+1.00*AP exact nested binary numerics/schedules (raw290/final145; raw390/final195; AD counterproof; 20221/20170; no 20230; no E type; no explicit event op; t0/t9999/t10000 mana270→90/HP610; mana89 skip; E/W coexistence isolation; no P/Q/R/basic synthesis), standalone/external-existing-data/check-only/no-Jinx-W-Batch-B-prerequisite-claim/no-Batch-B/no-sibling/no-production-runtime-ABI-Web framing, READY run-893fcb26 + focused37/full1032 + mirror focused18 + Wasm asset SHA + hero-named _test.go governance-only, and bilateral evidence (owning df08d6b / integrated 3b26d3e / Wasm 9320b4da; one selected-primary magic explosion-hit quantum not full E; no three-trap/layout/landing/arming/lifetime/geometry/CC/spellshield/vision/live claim)',
    );
  }
  const mJhinQReason = String(mJhinQ?.reason || '');
  const mJhinQBoundary =
    'rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity';
  if (
    !mJhinQ ||
    !STATUS_OVERRIDES.has('hero_skill|hero_jhin|Q|曼舞手雷') ||
    mJhinQ.key !== 'hero_skill|hero_jhin|Q|曼舞手雷' ||
    mJhinQ.passiveName !== '曼舞手雷' ||
    mJhinQ.status !== 'completed' ||
    mJhinQ.completionMode !== 'full' ||
    mJhinQ.lane !== 'generic_runtime' ||
    mJhinQ.blocker ||
    mJhinQ.dataGapEvidence !== null ||
    mJhinQ.runtimeGapEvidence !== null ||
    mJhinQ.outOfScopeEvidence !== null ||
    mJhinQ.coverageBoundary !== mJhinQBoundary ||
    [...(mJhinQ.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mJhinQ.mechanismTags || []).includes('multi_target_or_area') ||
    (mJhinQ.mechanismTags || []).includes('bonus_ad_ratio') ||
    (mJhinQ.mechanismTags || []).includes('total_ad_ratio') ||
    (mJhinQ.mechanismTags || []).includes('primary_damage_branch_salvage') ||
    mJhinQReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mJhinQReason.includes('blocked_data') ||
    mJhinQReason.includes('multi_target_or_area') ||
    mJhinQReason.includes('bonus_ad_ratio') ||
    mJhinQReason.includes('total_ad_ratio') ||
    mJhinQReason.includes('ad.resolved-source.attr.ad.base') ||
    mJhinQReason.includes('ad.resolved-ad.base') ||
    !mJhinQReason.includes('4007611') ||
    !mJhinQReason.includes(
      '522c4b918067b4b035b6744eb3dc83ce64ba5d47f677ed8517fcb246111685f1',
    ) ||
    !mJhinQReason.includes(
      '17deceae0abe42034f805a166ae5a16932ffcb19925654e6aa39625f026dd0cb',
    ) ||
    !mJhinQReason.includes('Template:Data Jhin/Q') ||
    !mJhinQReason.includes('Template:Data Jhin/Dancing Grenade') ||
    !mJhinQReason.includes('page1307579') ||
    !mJhinQReason.includes('bytes1913') ||
    !mJhinQReason.includes('bytes1911') ||
    !mJhinQReason.includes('2026-04-12T07:23:12Z') ||
    !mJhinQReason.includes(mJhinQBoundary) ||
    !mJhinQReason.includes('source.attr.ad.resolved') ||
    !mJhinQReason.includes('source.attr.ap.resolved') ||
    !mJhinQReason.includes('nested binary') ||
    !mJhinQReason.includes('total AD direct read') ||
    !mJhinQReason.includes('never bonus AD') ||
    !mJhinQReason.includes('144') ||
    !mJhinQReason.includes('0.74') ||
    !mJhinQReason.includes('0.60') ||
    !mJhinQReason.includes('60 mana') ||
    !mJhinQReason.includes('5000') ||
    !mJhinQReason.includes('raw=final144') ||
    !mJhinQReason.includes('raw=final218') ||
    !mJhinQReason.includes('raw=final204') ||
    !mJhinQReason.includes('raw=final278') ||
    !mJhinQReason.includes('raw278/final139') ||
    !mJhinQReason.includes('raw352/final176') ||
    !mJhinQReason.includes('both218') ||
    !mJhinQReason.includes('t4999') ||
    !mJhinQReason.includes('t5000') ||
    !mJhinQReason.includes('mana180') ||
    !mJhinQReason.includes('mana59') ||
    !mJhinQReason.includes('HP722') ||
    !mJhinQReason.includes('ability_started') ||
    !mJhinQReason.includes('Q/W isolation') ||
    !mJhinQReason.includes('standalone') ||
    !mJhinQReason.includes('external existing-data/check-only') ||
    !mJhinQReason.includes('identity/panel/resource') ||
    !mJhinQReason.includes('不暗示 Batch-B') ||
    !mJhinQReason.includes('sibling Jhin synthesis') ||
    !mJhinQReason.includes('不宣称') ||
    !mJhinQReason.includes('no equivalence or contradiction claim') ||
    mJhinQReason.includes('canonical byte equivalence') ||
    mJhinQReason.includes('Batch-B prerequisite') ||
    !(mJhinQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-jhin-dancing-grenade-primary-first-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_jhin_dancing_grenade_primary_first_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mJhinQBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('f70be27') &&
        String(e.note || '').includes('deaa6604') &&
        String(e.note || '').includes('71563') &&
        String(e.note || '').includes('17deceae') &&
        String(e.note || '').includes('Q/W isolation') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mJhinQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-jhin-dancing-grenade-primary-first-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mJhinQBoundary) &&
        String(e.note || '').includes('LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest') &&
        String(e.note || '').includes('ce22594') &&
        String(e.note || '').includes('488898e') &&
        String(e.note || '').includes('f70be27') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Jhin synthesis'),
    )
  ) {
    errors.push(
      'Jhin Q must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Dancing Grenade ordered tags (no multi_target_or_area/total_ad_ratio/salvage), Wiki rev4007611/SHA + local raw caveat + frozen completedBoundary, rank5 60mana/5000CD/nested-binary 144+0.74*totalAD+0.60*AP numerics/schedules, Q/W isolation, standalone/external-existing-data/check-only/no-Batch-B/no-sibling framing, and bilateral evidence (owning ce22594 / integrated 488898e / Wasm f70be27; no cast/cancel/projectile/bounce/death-amp/spellshield/live claim)',
    );
  }
  const mJhinWReason = String(mJhinW?.reason || '');
  const mJhinWBoundary =
    'rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_0_50_total_ad; no_cast_timing_direction_range_width_line_geometry_multitarget_champion_collision_projectile_interception_spell_shield_mark_creation_mark_detection_root_bonus_movement_speed_minion_reduction_other_ranks_or_full_fidelity';
  if (
    !mJhinW ||
    !STATUS_OVERRIDES.has('hero_skill|hero_jhin|W|致命华彩') ||
    mJhinW.key !== 'hero_skill|hero_jhin|W|致命华彩' ||
    mJhinW.passiveName !== '致命华彩' ||
    mJhinW.status !== 'completed' ||
    mJhinW.completionMode !== 'full' ||
    mJhinW.lane !== 'generic_runtime' ||
    mJhinW.blocker ||
    mJhinW.dataGapEvidence !== null ||
    mJhinW.runtimeGapEvidence !== null ||
    mJhinW.outOfScopeEvidence !== null ||
    mJhinW.coverageBoundary !== mJhinWBoundary ||
    [...(mJhinW.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mJhinW.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mJhinW.mechanismTags || []).includes('bonus_ad_ratio') ||
    (mJhinW.mechanismTags || []).includes('total_ad_ratio') ||
    mJhinWReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mJhinWReason.includes('blocked_data') ||
    mJhinWReason.includes('meta_or_non_target_dps') ||
    mJhinWReason.includes('bonus_ad_ratio') ||
    mJhinWReason.includes('ad.resolved-source.attr.ad.base') ||
    mJhinWReason.includes('ad.resolved-ad.base') ||
    !mJhinWReason.includes('4021795') ||
    !mJhinWReason.includes(
      '14790ca09f6f320fc2fadc81c2fa7e783c7b81d48d792b7760494f2e8d788c65',
    ) ||
    !mJhinWReason.includes(
      '76790ba522dc101bb1f1c24ae620f80e8db6d10e890515cbc7da85005a67f78b',
    ) ||
    !mJhinWReason.includes('Template:Data Jhin/W') ||
    !mJhinWReason.includes('Template:Data Jhin/Deadly Flourish') ||
    !mJhinWReason.includes('page1307581') ||
    !mJhinWReason.includes('bytes2942') ||
    !mJhinWReason.includes('bytes2940') ||
    !mJhinWReason.includes('2026-05-21T13:25:33Z') ||
    !mJhinWReason.includes(mJhinWBoundary) ||
    !mJhinWReason.includes('source.attr.ad.resolved') ||
    !mJhinWReason.includes('total AD') ||
    !mJhinWReason.includes('210') ||
    !mJhinWReason.includes('0.50') ||
    !mJhinWReason.includes('70 mana') ||
    !mJhinWReason.includes('12000') ||
    !mJhinWReason.includes('totalAD60') ||
    !mJhinWReason.includes('totalAD100') ||
    !mJhinWReason.includes('raw240') ||
    !mJhinWReason.includes('raw260') ||
    !mJhinWReason.includes('armor0=240') ||
    !mJhinWReason.includes('armor100=120') ||
    !mJhinWReason.includes('armor0=260') ||
    !mJhinWReason.includes('armor100=130') ||
    !mJhinWReason.includes('t11999') ||
    !mJhinWReason.includes('t12000') ||
    !mJhinWReason.includes('mana210') ||
    !mJhinWReason.includes('mana69') ||
    !mJhinWReason.includes('HP740') ||
    !mJhinWReason.includes('ability_started') ||
    !mJhinWReason.includes('Minion-only 25%') ||
    !mJhinWReason.includes('selected champion') ||
    !mJhinWReason.includes('standalone') ||
    !mJhinWReason.includes('external existing-data/check-only') ||
    !mJhinWReason.includes('identity/panel/resource') ||
    !mJhinWReason.includes('不暗示 Batch-B') ||
    !mJhinWReason.includes('sibling Jhin synthesis') ||
    !mJhinWReason.includes('不宣称') ||
    !mJhinWReason.includes('no equivalence or contradiction claim') ||
    mJhinWReason.includes('canonical byte equivalence') ||
    mJhinWReason.includes('Batch-B prerequisite') ||
    !(mJhinW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-jhin-deadly-flourish-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_jhin_deadly_flourish_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mJhinWBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('d62d2e4') &&
        String(e.note || '').includes('76790ba5') &&
        String(e.note || '').includes('minion-reduction excluded') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mJhinW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-jhin-deadly-flourish-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_jhin_deadly_flourish_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mJhinWBoundary) &&
        String(e.note || '').includes('LolGenericJhinDeadlyFlourishPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('4903c00') &&
        String(e.note || '').includes('0c103f8') &&
        String(e.note || '').includes('d62d2e4') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Jhin synthesis'),
    )
  ) {
    errors.push(
      'Jhin W must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Deadly Flourish ordered tags (no meta_or_non_target_dps/bonus_ad_ratio), Wiki rev4021795/SHA + local raw caveat + frozen completedBoundary, rank5 70mana/12000CD/one physical 210+0.50*totalAD numerics/schedules, selected-champion/minion-reduction exclusion, standalone/external-existing-data/check-only/no-Batch-B/no-sibling framing, and bilateral evidence (owning 4903c00 / integrated 0c103f8 / Wasm d62d2e4; no cast/direction/line/projectile/mark/root/minion/live claim)',
    );
  }
  const mCaitlynEReason = String(mCaitlynE?.reason || '');
  const mCaitlynEBoundary =
    'rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; magic_280_plus_0_80_ap; no_cast_timing_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_suppression_spell_shield_recoil_dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_full_fidelity';
  if (
    !mCaitlynE ||
    !STATUS_OVERRIDES.has('hero_skill|hero_caitlyn|E|90口径绳网') ||
    mCaitlynE.key !== 'hero_skill|hero_caitlyn|E|90口径绳网' ||
    mCaitlynE.passiveName !== '90口径绳网' ||
    mCaitlynE.status !== 'completed' ||
    mCaitlynE.completionMode !== 'full' ||
    mCaitlynE.lane !== 'generic_runtime' ||
    mCaitlynE.blocker ||
    mCaitlynE.dataGapEvidence !== null ||
    mCaitlynE.runtimeGapEvidence !== null ||
    mCaitlynE.outOfScopeEvidence !== null ||
    mCaitlynE.coverageBoundary !== mCaitlynEBoundary ||
    [...(mCaitlynE.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mCaitlynE.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mCaitlynE.mechanismTags || []).includes('meta_or_non_target_dps') ||
    mCaitlynEReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mCaitlynEReason.includes('blocked_data') ||
    mCaitlynEReason.includes('dps_relevant_manual_review') ||
    mCaitlynEReason.includes('needs_manual_baseline') ||
    !mCaitlynEReason.includes('4007584') ||
    !mCaitlynEReason.includes(
      '9357e7b28b05f738cd8049a2d10a115e4033a54123c0e71f55d1262a92884db2',
    ) ||
    !mCaitlynEReason.includes(
      '3a5eba6df38ec34046440743d55de61490dc7b5a2488b8fc671851474d080073',
    ) ||
    !mCaitlynEReason.includes('Template:Data Caitlyn/E') ||
    !mCaitlynEReason.includes('Template:Data Caitlyn/90 Caliber Net') ||
    !mCaitlynEReason.includes('page1306916') ||
    !mCaitlynEReason.includes('bytes2095') ||
    !mCaitlynEReason.includes('bytes2094') ||
    !mCaitlynEReason.includes('2026-04-12T06:47:56Z') ||
    !mCaitlynEReason.includes(mCaitlynEBoundary) ||
    !mCaitlynEReason.includes('source.attr.ap.resolved') ||
    !mCaitlynEReason.includes('280') ||
    !mCaitlynEReason.includes('0.80') ||
    !mCaitlynEReason.includes('75 mana') ||
    !mCaitlynEReason.includes('8000') ||
    !mCaitlynEReason.includes('20221') ||
    !mCaitlynEReason.includes('20170') ||
    !mCaitlynEReason.includes('20230 forbidden') ||
    !mCaitlynEReason.includes('raw/mit 280/140') ||
    !mCaitlynEReason.includes('raw/mit 360/180') ||
    !mCaitlynEReason.includes('t7999') ||
    !mCaitlynEReason.includes('t8000') ||
    !mCaitlynEReason.includes('mana225') ||
    !mCaitlynEReason.includes('mana74') ||
    !mCaitlynEReason.includes('HP640') ||
    !mCaitlynEReason.includes('ability_started') ||
    !mCaitlynEReason.includes('standalone') ||
    !mCaitlynEReason.includes('external existing-data/check-only') ||
    !mCaitlynEReason.includes('identity/panel/resource') ||
    !mCaitlynEReason.includes('不暗示 Batch-B') ||
    !mCaitlynEReason.includes('sibling Caitlyn synthesis') ||
    !mCaitlynEReason.includes('不宣称') ||
    !mCaitlynEReason.includes('no equivalence or contradiction claim') ||
    mCaitlynEReason.includes('canonical byte equivalence') ||
    mCaitlynEReason.includes('Batch-B prerequisite') ||
    mCaitlynEReason.includes('live published') ||
    !(mCaitlynE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-caitlyn-90-caliber-net-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_caitlyn_90_caliber_net_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mCaitlynEBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('4433ef1') &&
        String(e.note || '').includes('3a5eba6d') &&
        String(e.note || '').includes('20221') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('20230 forbidden') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mCaitlynE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-caitlyn-90-caliber-net-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mCaitlynEBoundary) &&
        String(e.note || '').includes('LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('9506d01') &&
        String(e.note || '').includes('384d658') &&
        String(e.note || '').includes('4433ef1') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Caitlyn synthesis'),
    )
  ) {
    errors.push(
      'Caitlyn E must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact 90 Caliber Net ordered tags (no dps_relevant_manual_review), Wiki rev4007584/SHA + local raw caveat + frozen completedBoundary, rank5 75mana/8000CD/one magic 280+0.80*AP numerics/schedules (280/140 360/180; 20221/20170/20230 forbidden), standalone/external-existing-data/check-only/no-Batch-B/no-sibling framing, and bilateral evidence (owning 9506d01 / integrated 384d658 / Wasm 4433ef1; no cast/direction/line/projectile/recoil/dash/slow/Headshot/live claim)',
    );
  }
  const mKalistaQReason = String(mKalistaQ?.reason || '');
  const mKalistaQBoundary =
    'rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_270_plus_1_05_total_ad; no_cast_timing_martial_poise_dash_cancel_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_interception_spell_shield_kill_continuation_rend_stack_transfer_other_ranks_or_full_fidelity';
  if (
    !mKalistaQ ||
    !STATUS_OVERRIDES.has('hero_skill|hero_kalista|Q|穿刺') ||
    mKalistaQ.key !== 'hero_skill|hero_kalista|Q|穿刺' ||
    mKalistaQ.passiveName !== '穿刺' ||
    mKalistaQ.status !== 'completed' ||
    mKalistaQ.completionMode !== 'full' ||
    mKalistaQ.lane !== 'generic_runtime' ||
    mKalistaQ.blocker ||
    mKalistaQ.dataGapEvidence !== null ||
    mKalistaQ.runtimeGapEvidence !== null ||
    mKalistaQ.outOfScopeEvidence !== null ||
    mKalistaQ.coverageBoundary !== mKalistaQBoundary ||
    [...(mKalistaQ.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mKalistaQ.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mKalistaQ.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mKalistaQ.mechanismTags || []).includes('bonus_ad_ratio') ||
    (mKalistaQ.mechanismTags || []).includes('total_ad_ratio') ||
    mKalistaQReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mKalistaQReason.includes('blocked_data') ||
    mKalistaQReason.includes('dps_relevant_manual_review') ||
    mKalistaQReason.includes('needs_manual_baseline') ||
    mKalistaQReason.includes('bonus_ad_ratio') ||
    mKalistaQReason.includes('ad.resolved-source.attr.ad.base') ||
    mKalistaQReason.includes('ad.resolved-ad.base') ||
    !mKalistaQReason.includes('3997075') ||
    !mKalistaQReason.includes(
      '90c490d921da436134c318249fa7d0038ceaa97dfb76e5bdaa0b330a43676a67',
    ) ||
    !mKalistaQReason.includes(
      '0b8dd9cf9b40aae52fb6180ecabae7e459970f2f7c4d05711463df25fdbd1c94',
    ) ||
    !mKalistaQReason.includes('Template:Data Kalista/Q') ||
    !mKalistaQReason.includes('Template:Data Kalista/Pierce') ||
    !mKalistaQReason.includes('page1307666') ||
    !mKalistaQReason.includes('bytes1625') ||
    !mKalistaQReason.includes('bytes1623') ||
    !mKalistaQReason.includes('2026-03-06T15:53:18Z') ||
    !mKalistaQReason.includes(mKalistaQBoundary) ||
    !mKalistaQReason.includes('source.attr.ad.resolved') ||
    !mKalistaQReason.includes('total AD') ||
    !mKalistaQReason.includes('270') ||
    !mKalistaQReason.includes('1.05') ||
    !mKalistaQReason.includes('80 mana') ||
    !mKalistaQReason.includes('9000') ||
    !mKalistaQReason.includes('20220') ||
    !mKalistaQReason.includes('20170') ||
    !mKalistaQReason.includes('no explicit event op') ||
    !mKalistaQReason.includes('(AD0,A0)=(270,270)') ||
    !mKalistaQReason.includes('(AD0,A100)=(270,135)') ||
    !mKalistaQReason.includes('(AD100,A0)=(375,375)') ||
    !mKalistaQReason.includes('(AD100,A100)=(375,187.5)') ||
    !mKalistaQReason.includes('(AD200,A100)=(480,240)') ||
    !mKalistaQReason.includes('t8999') ||
    !mKalistaQReason.includes('t9000') ||
    !mKalistaQReason.includes('mana240') ||
    !mKalistaQReason.includes('mana79') ||
    !mKalistaQReason.includes('HP625') ||
    !mKalistaQReason.includes('ability_started') ||
    !mKalistaQReason.includes('standalone') ||
    !mKalistaQReason.includes('external existing-data/check-only') ||
    !mKalistaQReason.includes('identity/panel/resource') ||
    !mKalistaQReason.includes('不暗示 Batch-B') ||
    !mKalistaQReason.includes('sibling Kalista synthesis') ||
    !mKalistaQReason.includes('不宣称') ||
    !mKalistaQReason.includes('no equivalence or contradiction claim') ||
    mKalistaQReason.includes('canonical byte equivalence') ||
    mKalistaQReason.includes('Batch-B prerequisite') ||
    mKalistaQReason.includes('live published') ||
    !(mKalistaQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kalista-pierce-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_kalista_pierce_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mKalistaQBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('99e7b39') &&
        String(e.note || '').includes('0b8dd9cf') &&
        String(e.note || '').includes('20220') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mKalistaQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kalista-pierce-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_kalista_pierce_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mKalistaQBoundary) &&
        String(e.note || '').includes('LolGenericKalistaPiercePrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('04c061f') &&
        String(e.note || '').includes('bdb5d32') &&
        String(e.note || '').includes('99e7b39') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Kalista synthesis'),
    )
  ) {
    errors.push(
      'Kalista Q must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Pierce ordered tags (no dps_relevant_manual_review/total_ad_ratio), Wiki rev3997075/SHA + local raw caveat + frozen completedBoundary, rank5 80mana/9000CD/one physical 270+1.05*totalAD numerics/schedules ((AD0,A0)=(270,270); (AD0,A100)=(270,135); (AD100,A0)=(375,375); (AD100,A100)=(375,187.5); (AD200,A100)=(480,240); 20220/20170; no explicit event op), standalone/external-existing-data/check-only/no-Batch-B/no-sibling framing, and bilateral evidence (owning 04c061f / integrated bdb5d32 / Wasm 99e7b39; no cast/Martial-Poise/direction/line/projectile/kill/Rend/live claim)',
    );
  }
  const mCaitlynQReason = String(mCaitlynQ?.reason || '');
  const mCaitlynQBoundary =
    'rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; physical_210_plus_2_05_total_ad; no_cast_timing_attack_timer_reset_direction_range_width_line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_full_damage_projectile_spell_shield_other_ranks_or_full_fidelity';
  if (
    !mCaitlynQ ||
    !STATUS_OVERRIDES.has('hero_skill|hero_caitlyn|Q|和平使者') ||
    mCaitlynQ.key !== 'hero_skill|hero_caitlyn|Q|和平使者' ||
    mCaitlynQ.passiveName !== '和平使者' ||
    mCaitlynQ.status !== 'completed' ||
    mCaitlynQ.completionMode !== 'full' ||
    mCaitlynQ.lane !== 'generic_runtime' ||
    mCaitlynQ.blocker ||
    mCaitlynQ.dataGapEvidence !== null ||
    mCaitlynQ.runtimeGapEvidence !== null ||
    mCaitlynQ.outOfScopeEvidence !== null ||
    mCaitlynQ.coverageBoundary !== mCaitlynQBoundary ||
    [...(mCaitlynQ.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mCaitlynQ.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mCaitlynQ.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mCaitlynQ.mechanismTags || []).includes('bonus_ad_ratio') ||
    (mCaitlynQ.mechanismTags || []).includes('total_ad_ratio') ||
    mCaitlynQReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mCaitlynQReason.includes('blocked_data') ||
    mCaitlynQReason.includes('dps_relevant_manual_review') ||
    mCaitlynQReason.includes('needs_manual_baseline') ||
    mCaitlynQReason.includes('out_of_scope_for_single_target_dps') ||
    mCaitlynQReason.includes('bonus_ad_ratio') ||
    mCaitlynQReason.includes('ad.resolved-source.attr.ad.base') ||
    mCaitlynQReason.includes('ad.resolved-ad.base') ||
    !mCaitlynQReason.includes('4007583') ||
    !mCaitlynQReason.includes(
      '6c40deba7b6e60ab9c06bc014a214a8be4319c4ddf22c550237b659f19307caf',
    ) ||
    !mCaitlynQReason.includes(
      '93da300971429a629f11a721c3993784db6a99d3559b1286eae9500176560b9a',
    ) ||
    !mCaitlynQReason.includes('Template:Data Caitlyn/Q') ||
    !mCaitlynQReason.includes('Template:Data Caitlyn/Piltover Peacemaker') ||
    !mCaitlynQReason.includes('page1306911') ||
    !mCaitlynQReason.includes('bytes1841') ||
    !mCaitlynQReason.includes('bytes1838') ||
    !mCaitlynQReason.includes('2026-04-12T06:47:12Z') ||
    !mCaitlynQReason.includes(mCaitlynQBoundary) ||
    !mCaitlynQReason.includes('source.attr.ad.resolved') ||
    !mCaitlynQReason.includes('total AD') ||
    !mCaitlynQReason.includes('210') ||
    !mCaitlynQReason.includes('2.05') ||
    !mCaitlynQReason.includes('75 mana') ||
    !mCaitlynQReason.includes('6000') ||
    !mCaitlynQReason.includes('20220') ||
    !mCaitlynQReason.includes('20170') ||
    !mCaitlynQReason.includes('no explicit event op') ||
    !mCaitlynQReason.includes('(AD0,A0)=(210,210)') ||
    !mCaitlynQReason.includes('(AD0,A100)=(210,105)') ||
    !mCaitlynQReason.includes('(AD100,A0)=(415,415)') ||
    !mCaitlynQReason.includes('(AD100,A100)=(415,207.5)') ||
    !mCaitlynQReason.includes('(AD200,A100)=(620,310)') ||
    !mCaitlynQReason.includes('t5999') ||
    !mCaitlynQReason.includes('t6000') ||
    !mCaitlynQReason.includes('mana225') ||
    !mCaitlynQReason.includes('mana74') ||
    !mCaitlynQReason.includes('HP585') ||
    !mCaitlynQReason.includes('ability_started') ||
    !mCaitlynQReason.includes('standalone') ||
    !mCaitlynQReason.includes('external existing-data/check-only') ||
    !mCaitlynQReason.includes('identity/panel/resource') ||
    !mCaitlynQReason.includes('不暗示 Batch-B') ||
    !mCaitlynQReason.includes('sibling Caitlyn synthesis') ||
    !mCaitlynQReason.includes('不宣称') ||
    !mCaitlynQReason.includes('no equivalence or contradiction claim') ||
    mCaitlynQReason.includes('canonical byte equivalence') ||
    mCaitlynQReason.includes('Batch-B prerequisite') ||
    mCaitlynQReason.includes('live published') ||
    !(mCaitlynQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_caitlyn_piltover_peacemaker_first_enemy_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mCaitlynQBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('0fe29e7') &&
        String(e.note || '').includes('93da3009') &&
        String(e.note || '').includes('20220') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mCaitlynQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mCaitlynQBoundary) &&
        String(e.note || '').includes('LolGenericCaitlynPiltoverPeacemakerFirstEnemyHitSeedSqlTest') &&
        String(e.note || '').includes('b5ef446') &&
        String(e.note || '').includes('245a111') &&
        String(e.note || '').includes('0fe29e7') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Caitlyn synthesis'),
    )
  ) {
    errors.push(
      'Caitlyn Q must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Piltover Peacemaker ordered tags (no dps_relevant_manual_review/total_ad_ratio), Wiki rev4007583/SHA + local raw caveat + frozen completedBoundary, rank5 75mana/6000CD/one physical 210+2.05*totalAD numerics/schedules ((AD0,A0)=(210,210); (AD0,A100)=(210,105); (AD100,A0)=(415,415); (AD100,A100)=(415,207.5); (AD200,A100)=(620,310); 20220/20170; no explicit event op), standalone/external-existing-data/check-only/no-Batch-B/no-sibling framing, and bilateral evidence (owning b5ef446 / integrated 245a111 / Wasm 0fe29e7; no cast/attack-timer-reset/direction/line/projectile/trap/reveal/live claim)',
    );
  }
  const mLucianQReason = String(mLucianQ?.reason || '');
  const mLucianQBoundary =
    'rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; physical_220_plus_1_00_bonus_ad; no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_initial_target_death_early_end_other_ranks_or_full_fidelity';
  if (
    !mLucianQ ||
    !STATUS_OVERRIDES.has('hero_skill|hero_lucian|Q|透体圣光') ||
    mLucianQ.key !== 'hero_skill|hero_lucian|Q|透体圣光' ||
    mLucianQ.passiveName !== '透体圣光' ||
    mLucianQ.status !== 'completed' ||
    mLucianQ.completionMode !== 'full' ||
    mLucianQ.lane !== 'generic_runtime' ||
    mLucianQ.blocker ||
    mLucianQ.dataGapEvidence !== null ||
    mLucianQ.runtimeGapEvidence !== null ||
    mLucianQ.outOfScopeEvidence !== null ||
    mLucianQ.coverageBoundary !== mLucianQBoundary ||
    [...(mLucianQ.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mLucianQ.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mLucianQ.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mLucianQ.mechanismTags || []).includes('total_ad_ratio') ||
    !(mLucianQ.mechanismTags || []).includes('bonus_ad_ratio') ||
    mLucianQReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mLucianQReason.includes('blocked_data') ||
    mLucianQReason.includes('dps_relevant_manual_review') ||
    mLucianQReason.includes('needs_manual_baseline') ||
    mLucianQReason.includes('total AD；') ||
    mLucianQReason.includes('total_ad_ratio') ||
    mLucianQReason.includes('*totalAD') ||
    !mLucianQReason.includes('3982579') ||
    !mLucianQReason.includes(
      'd7b03d15af48312a0ea5a06fa147b43c46d2a7ee6e1491dd121d796a2e452981',
    ) ||
    !mLucianQReason.includes(
      'cd65b80f0580f0e4833028791bba2331a321366307b8c35f7fc28fe06c1f06c1',
    ) ||
    !mLucianQReason.includes('Template:Data Lucian/Q') ||
    !mLucianQReason.includes('Template:Data Lucian/Piercing Light') ||
    !mLucianQReason.includes('page1308176') ||
    !mLucianQReason.includes('bytes1608') ||
    !mLucianQReason.includes('2026-01-09T09:22:29Z') ||
    !mLucianQReason.includes(mLucianQBoundary) ||
    !mLucianQReason.includes('source.attr.ad.resolved - source.attr.ad.base') ||
    !mLucianQReason.includes('bonus AD by explicit subtraction') ||
    !mLucianQReason.includes('不得按 total-AD 直读') ||
    !mLucianQReason.includes('220') ||
    !mLucianQReason.includes('1.00') ||
    !mLucianQReason.includes('80 mana') ||
    !mLucianQReason.includes('5000') ||
    !mLucianQReason.includes('20220') ||
    !mLucianQReason.includes('20170') ||
    !mLucianQReason.includes('no explicit event op') ||
    !mLucianQReason.includes('base60/resolved60/armor0 raw=final220') ||
    !mLucianQReason.includes('base60/resolved160/armor0 raw=final320') ||
    !mLucianQReason.includes('base60/resolved160/armor100 raw320/final160') ||
    !mLucianQReason.includes('base60/resolved260/armor100 raw420/final210') ||
    !mLucianQReason.includes('total-AD counterproof') ||
    !mLucianQReason.includes('t4999') ||
    !mLucianQReason.includes('t5000') ||
    !mLucianQReason.includes('mana240') ||
    !mLucianQReason.includes('mana79') ||
    !mLucianQReason.includes('HP680') ||
    !mLucianQReason.includes('ability_started') ||
    !mLucianQReason.includes('standalone') ||
    !mLucianQReason.includes('external existing-data/check-only') ||
    !mLucianQReason.includes('identity/panel/resource') ||
    !mLucianQReason.includes('不暗示 Batch-B') ||
    !mLucianQReason.includes('sibling Lucian synthesis') ||
    !mLucianQReason.includes('production runtime/ABI/Web change') ||
    !mLucianQReason.includes('不宣称') ||
    !mLucianQReason.includes('no equivalence or contradiction claim') ||
    mLucianQReason.includes('canonical byte equivalence') ||
    mLucianQReason.includes('Batch-B prerequisite') ||
    mLucianQReason.includes('live published') ||
    !(mLucianQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-lucian-piercing-light-selected-target-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_lucian_piercing_light_selected_target_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mLucianQBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('aaca359') &&
        String(e.note || '').includes('cd65b80f') &&
        String(e.note || '').includes('20220') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis') &&
        String(e.note || '').includes('total-AD counterproof'),
    ) ||
    !(mLucianQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-lucian-piercing-light-selected-target-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_lucian_piercing_light_selected_target_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mLucianQBoundary) &&
        String(e.note || '').includes('LolGenericLucianPiercingLightSelectedTargetHitSeedSqlTest') &&
        String(e.note || '').includes('bfc9d54') &&
        String(e.note || '').includes('826cdad') &&
        String(e.note || '').includes('aaca359') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Lucian synthesis'),
    )
  ) {
    errors.push(
      'Lucian Q must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Piercing Light ordered tags (no dps_relevant_manual_review/total_ad_ratio; requires bonus_ad_ratio), Wiki rev3982579/SHA + local raw caveat + frozen completedBoundary, rank5 80mana/5000CD/one physical 220+1.00*bonusAD via sub(ad.resolved,ad.base) numerics/schedules (base60/resolved60/armor0=220; resolved160/armor0=320; resolved160/armor100 raw320/final160; resolved260/armor100 raw420/final210; total-AD counterproof; 20220/20170; no explicit event op), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-production-runtime-ABI-Web framing, and bilateral evidence (owning bfc9d54 / integrated 826cdad / Wasm aaca359; no cast/lead/dodge/direction/range/line/multitarget/AOE/spell-shield/buffer/E-lockout/early-end/live claim)',
    );
  }
  const mLucianWReason = String(mLucianW?.reason || '');
  const mLucianWBoundary =
    'rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_215_plus_0_90_ap; no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_shield_exception_other_ranks_or_full_fidelity';
  if (
    !mLucianW ||
    !STATUS_OVERRIDES.has('hero_skill|hero_lucian|W|热诚烈弹') ||
    mLucianW.key !== 'hero_skill|hero_lucian|W|热诚烈弹' ||
    mLucianW.passiveName !== '热诚烈弹' ||
    mLucianW.status !== 'completed' ||
    mLucianW.completionMode !== 'full' ||
    mLucianW.lane !== 'generic_runtime' ||
    mLucianW.blocker ||
    mLucianW.dataGapEvidence !== null ||
    mLucianW.runtimeGapEvidence !== null ||
    mLucianW.outOfScopeEvidence !== null ||
    mLucianW.coverageBoundary !== mLucianWBoundary ||
    [...(mLucianW.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mLucianW.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mLucianW.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mLucianW.mechanismTags || []).includes('bonus_ad_ratio') ||
    (mLucianW.mechanismTags || []).includes('total_ad_ratio') ||
    mLucianWReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mLucianWReason.includes('blocked_data') ||
    mLucianWReason.includes('dps_relevant_manual_review') ||
    mLucianWReason.includes('needs_manual_baseline') ||
    mLucianWReason.includes('out_of_scope_for_single_target_dps') ||
    mLucianWReason.includes('meta_or_non_target_dps') ||
    mLucianWReason.includes('depends on Lucian Q') ||
    mLucianWReason.includes('requires Lucian Q') ||
    !mLucianWReason.includes('3594941') ||
    !mLucianWReason.includes(
      'b1ea7bc7a2e48be9ab97acfa1fc5addb80b8dd236dc97bd3d57c5e90951418c5',
    ) ||
    !mLucianWReason.includes(
      'a57b0e49765ab5a9bdd30ad295d24e406a90015b083c8a0e817855c6bc152236',
    ) ||
    !mLucianWReason.includes('Template:Data Lucian/W') ||
    !mLucianWReason.includes('Template:Data Lucian/Ardent Blaze') ||
    !mLucianWReason.includes('page1308178') ||
    !mLucianWReason.includes('bytes2542') ||
    !mLucianWReason.includes('2023-09-12T19:08:23Z') ||
    !mLucianWReason.includes(mLucianWBoundary) ||
    !mLucianWReason.includes('source.attr.ap.resolved') ||
    !mLucianWReason.includes('215') ||
    !mLucianWReason.includes('0.90') ||
    !mLucianWReason.includes('60 mana') ||
    !mLucianWReason.includes('10000') ||
    !mLucianWReason.includes('20221') ||
    !mLucianWReason.includes('20170') ||
    !mLucianWReason.includes('no explicit event op') ||
    !mLucianWReason.includes('AP0/MR0 raw=final215') ||
    !mLucianWReason.includes('AP0/MR100 raw215/final107.5') ||
    !mLucianWReason.includes('AP100/MR0 raw=final305') ||
    !mLucianWReason.includes('AP100/MR100 raw305/final152.5') ||
    !mLucianWReason.includes('AP200/MR100 raw395/final197.5') ||
    !mLucianWReason.includes('t9999') ||
    !mLucianWReason.includes('t10000') ||
    !mLucianWReason.includes('mana180') ||
    !mLucianWReason.includes('mana59') ||
    !mLucianWReason.includes('HP695') ||
    !mLucianWReason.includes('ability_started') ||
    !mLucianWReason.includes('standalone') ||
    !mLucianWReason.includes('external existing-data/check-only') ||
    !mLucianWReason.includes('identity/panel/resource') ||
    !mLucianWReason.includes('不暗示 Lucian Q dependence') ||
    !mLucianWReason.includes('不暗示 Batch-B') ||
    !mLucianWReason.includes('sibling Lucian synthesis') ||
    !mLucianWReason.includes('production runtime/ABI/Web change') ||
    !mLucianWReason.includes('不宣称') ||
    !mLucianWReason.includes('no equivalence or contradiction claim') ||
    !mLucianWReason.includes('equal size alone is not byte equality or source contradiction') ||
    mLucianWReason.includes('canonical byte equivalence') ||
    mLucianWReason.includes('Batch-B prerequisite') ||
    mLucianWReason.includes('live published') ||
    !(mLucianW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-lucian-ardent-blaze-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_lucian_ardent_blaze_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mLucianWBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('d57dc3b') &&
        String(e.note || '').includes('a57b0e49') &&
        String(e.note || '').includes('20221') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mLucianW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-lucian-ardent-blaze-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_lucian_ardent_blaze_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mLucianWBoundary) &&
        String(e.note || '').includes('LolGenericLucianArdentBlazePrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('2b29c4e') &&
        String(e.note || '').includes('7e8a40c') &&
        String(e.note || '').includes('d57dc3b') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Lucian synthesis'),
    )
  ) {
    errors.push(
      'Lucian W must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Ardent Blaze ordered tags (no dps_relevant_manual_review/meta_or_non_target_dps), Wiki rev3594941/SHA + local raw caveat + frozen completedBoundary, rank5 60mana/10000CD/one magic 215+0.90*AP numerics/schedules (AP0/MR0=215; AP0/MR100 raw215/final107.5; AP100/MR0=305; AP100/MR100 raw305/final152.5; AP200/MR100 raw395/final197.5; 20221/20170; no explicit event op), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-Lucian-Q-dependence/no-production-runtime-ABI-Web framing, and bilateral evidence (owning 2b29c4e / integrated 7e8a40c / Wasm d57dc3b; no cast/missile/cross/mark/ms/Vigilance/live claim)',
    );
  }
  const mLucianRReason = String(mLucianR?.reason || '');
  const mLucianRBoundary =
    'rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity';
  if (
    !mLucianR ||
    !STATUS_OVERRIDES.has('hero_skill|hero_lucian|R|圣枪洗礼') ||
    mLucianR.key !== 'hero_skill|hero_lucian|R|圣枪洗礼' ||
    mLucianR.passiveName !== '圣枪洗礼' ||
    mLucianR.status !== 'completed' ||
    mLucianR.completionMode !== 'full' ||
    mLucianR.lane !== 'generic_runtime' ||
    mLucianR.blocker ||
    mLucianR.dataGapEvidence !== null ||
    mLucianR.runtimeGapEvidence !== null ||
    mLucianR.outOfScopeEvidence !== null ||
    mLucianR.coverageBoundary !== mLucianRBoundary ||
    [...(mLucianR.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mLucianR.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mLucianR.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mLucianR.mechanismTags || []).includes('bonus_ad_ratio') ||
    (mLucianR.mechanismTags || []).includes('total_ad_ratio') ||
    mLucianRReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mLucianRReason.includes('blocked_data') ||
    mLucianRReason.includes('dps_relevant_manual_review') ||
    mLucianRReason.includes('needs_manual_baseline') ||
    mLucianRReason.includes('out_of_scope_for_single_target_dps') ||
    mLucianRReason.includes('meta_or_non_target_dps') ||
    mLucianRReason.includes('depends on Lucian Q') ||
    mLucianRReason.includes('requires Lucian Q') ||
    mLucianRReason.includes('depends on Lucian W') ||
    mLucianRReason.includes('requires Lucian W') ||
    mLucianRReason.includes('bonus AD by explicit subtraction') ||
    mLucianRReason.includes('ad.resolved - source.attr.ad.base') ||
    mLucianRReason.includes('ad.resolved-ad.base') ||
    mLucianRReason.includes('total_ad_ratio') ||
    !mLucianRReason.includes('4007670') ||
    !mLucianRReason.includes(
      '7a4679542eebdebf25da391a1222f08df2f416c641f48473d528e62296b9a2f7',
    ) ||
    !mLucianRReason.includes(
      'b63612287a8a965e7655829a2054aec7b019705225fd7e7b4736303a172bc74d',
    ) ||
    !mLucianRReason.includes('Template:Data Lucian/R') ||
    !mLucianRReason.includes('Template:Data Lucian/The Culling') ||
    !mLucianRReason.includes('page1308182') ||
    !mLucianRReason.includes('bytes4477') ||
    !mLucianRReason.includes('2026-04-12T10:40:21Z') ||
    !mLucianRReason.includes(mLucianRBoundary) ||
    !mLucianRReason.includes('source.attr.ad.resolved') ||
    !mLucianRReason.includes('source.attr.ap.resolved') ||
    !mLucianRReason.includes('nested binary') ||
    !mLucianRReason.includes('total AD direct read') ||
    !mLucianRReason.includes('never bonus AD') ||
    !mLucianRReason.includes('45') ||
    !mLucianRReason.includes('0.25') ||
    !mLucianRReason.includes('0.15') ||
    !mLucianRReason.includes('100 mana') ||
    !mLucianRReason.includes('90000') ||
    !mLucianRReason.includes('20220') ||
    !mLucianRReason.includes('20170') ||
    !mLucianRReason.includes('no explicit event op') ||
    !mLucianRReason.includes('baseAD0/resolvedAD0/AP0/armor0 raw=final45') ||
    !mLucianRReason.includes('baseAD60/resolvedAD60/AP0/armor0 raw=final60') ||
    !mLucianRReason.includes('baseAD60/resolvedAD160/AP0/armor0 raw=final85') ||
    !mLucianRReason.includes('baseAD60/resolvedAD160/AP100/armor0 raw=final100') ||
    !mLucianRReason.includes('baseAD60/resolvedAD160/AP100/armor100 raw100/final50') ||
    !mLucianRReason.includes('baseAD60/resolvedAD260/AP200/armor100 raw140/final70') ||
    !mLucianRReason.includes('baseAD0 vs baseAD60') ||
    !mLucianRReason.includes('t89999') ||
    !mLucianRReason.includes('t90000') ||
    !mLucianRReason.includes('mana300') ||
    !mLucianRReason.includes('mana99') ||
    !mLucianRReason.includes('HP900') ||
    !mLucianRReason.includes('shot-quantum') ||
    !mLucianRReason.includes('ability_started') ||
    !mLucianRReason.includes('standalone') ||
    !mLucianRReason.includes('external existing-data/check-only') ||
    !mLucianRReason.includes('identity/panel/resource') ||
    !mLucianRReason.includes('不暗示 Lucian Q/W dependence') ||
    !mLucianRReason.includes('不暗示 Batch-B') ||
    !mLucianRReason.includes('sibling Lucian synthesis') ||
    !mLucianRReason.includes('production runtime/ABI/Web change') ||
    !mLucianRReason.includes('StackOverflowError') ||
    !mLucianRReason.includes('nonblocking validation-runtime caveat') ||
    !mLucianRReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mLucianRReason.includes('不宣称') ||
    !mLucianRReason.includes('no equivalence or contradiction claim') ||
    !mLucianRReason.includes('equal size alone is not byte equality or source contradiction') ||
    !mLucianRReason.includes('one damage quantum') ||
    mLucianRReason.includes('canonical byte equivalence') ||
    mLucianRReason.includes('Batch-B prerequisite') ||
    mLucianRReason.includes('live published') ||
    !(mLucianR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-lucian-the-culling-single-shot-quantum' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_lucian_the_culling_single_shot_quantum_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mLucianRBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('ab2d9f7') &&
        String(e.note || '').includes('b6361228') &&
        String(e.note || '').includes('20220') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mLucianR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-lucian-the-culling-single-shot-quantum' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_lucian_the_culling_single_shot_quantum_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mLucianRBoundary) &&
        String(e.note || '').includes('LolGenericLucianTheCullingSingleShotQuantumSeedSqlTest') &&
        String(e.note || '').includes('a2f5bca') &&
        String(e.note || '').includes('d83b09e') &&
        String(e.note || '').includes('ab2d9f7') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Lucian synthesis'),
    )
  ) {
    errors.push(
      'Lucian R must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact The Culling ordered tags (no dps_relevant_manual_review/total_ad_ratio/bonus_ad_ratio; requires ap_ratio), Wiki rev4007670/SHA + local raw caveat + frozen completedBoundary, rank3 100mana/90000CD/one physical shot quantum 45+0.25*totalAD+0.15*AP nested binary numerics/schedules (baseAD0/0/0/0=45; 60/60/0/0=60; 60/160/0/0=85; 60/160/100/0=100; 60/160/100/100 raw100/final50; 60/260/200/100 raw140/final70; baseAD0 vs baseAD60 both 100; 20220/20170; no explicit event op), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-Q-W-dependence/no-production-runtime-ABI-Web framing, StackOverflow/nonblocking validation caveat + Wasm asset SHA, and bilateral evidence (owning a2f5bca / integrated d83b09e / Wasm ab2d9f7; one damage quantum not total R; no channel/recast/shot-count/live claim)',
    );
  }
  const mCaitlynRReason = String(mCaitlynR?.reason || '');
  const mCaitlynRBoundary =
    'rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity';
  if (
    !mCaitlynR ||
    !STATUS_OVERRIDES.has('hero_skill|hero_caitlyn|R|让子弹飞') ||
    mCaitlynR.key !== 'hero_skill|hero_caitlyn|R|让子弹飞' ||
    mCaitlynR.passiveName !== '让子弹飞' ||
    mCaitlynR.status !== 'completed' ||
    mCaitlynR.completionMode !== 'full' ||
    mCaitlynR.lane !== 'generic_runtime' ||
    mCaitlynR.blocker ||
    mCaitlynR.dataGapEvidence !== null ||
    mCaitlynR.runtimeGapEvidence !== null ||
    mCaitlynR.outOfScopeEvidence !== null ||
    mCaitlynR.coverageBoundary !== mCaitlynRBoundary ||
    [...(mCaitlynR.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'active_physical_damage',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mCaitlynR.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mCaitlynR.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mCaitlynR.mechanismTags || []).includes('total_ad_ratio') ||
    !(mCaitlynR.mechanismTags || []).includes('bonus_ad_ratio') ||
    mCaitlynRReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mCaitlynRReason.includes('blocked_data') ||
    mCaitlynRReason.includes('dps_relevant_manual_review') ||
    mCaitlynRReason.includes('needs_manual_baseline') ||
    mCaitlynRReason.includes('out_of_scope_for_single_target_dps') ||
    mCaitlynRReason.includes('meta_or_non_target_dps') ||
    mCaitlynRReason.includes('depends on Caitlyn Q') ||
    mCaitlynRReason.includes('requires Caitlyn Q') ||
    mCaitlynRReason.includes('depends on Caitlyn E') ||
    mCaitlynRReason.includes('requires Caitlyn E') ||
    mCaitlynRReason.includes('total AD；') ||
    mCaitlynRReason.includes('total_ad_ratio') ||
    mCaitlynRReason.includes('*totalAD') ||
    !mCaitlynRReason.includes('3982561') ||
    !mCaitlynRReason.includes(
      '08b488c97fc694d9a3de711ffd4ea0b95fc1746c3a11b9c44b878844e586e8a8',
    ) ||
    !mCaitlynRReason.includes(
      '015c1dbe8f02dd5ac354e6a6da6def878f1acccf788b1f599ee4bfd589e05003',
    ) ||
    !mCaitlynRReason.includes('Template:Data Caitlyn/R') ||
    !mCaitlynRReason.includes('Template:Data Caitlyn/Ace in the Hole') ||
    !mCaitlynRReason.includes('page1306918') ||
    !mCaitlynRReason.includes('bytes3119') ||
    !mCaitlynRReason.includes('2026-01-09T09:02:59Z') ||
    !mCaitlynRReason.includes(mCaitlynRBoundary) ||
    !mCaitlynRReason.includes('source.attr.ad.resolved - source.attr.ad.base') ||
    !mCaitlynRReason.includes('exact nested binary formula') ||
    !mCaitlynRReason.includes('bonus AD by explicit subtraction') ||
    !mCaitlynRReason.includes('不得按 total-AD 直读') ||
    !mCaitlynRReason.includes('650') ||
    !mCaitlynRReason.includes('1.00') ||
    !mCaitlynRReason.includes('100 mana') ||
    !mCaitlynRReason.includes('90000') ||
    !mCaitlynRReason.includes('20220') ||
    !mCaitlynRReason.includes('20170') ||
    !mCaitlynRReason.includes('no explicit event op') ||
    !mCaitlynRReason.includes('base0/resolved0/armor0 raw=final650') ||
    !mCaitlynRReason.includes('base60/resolved60/armor0 raw=final650') ||
    !mCaitlynRReason.includes('base60/resolved160/armor0 raw=final750') ||
    !mCaitlynRReason.includes('base60/resolved160/armor100 raw750/final375') ||
    !mCaitlynRReason.includes('base60/resolved260/armor100 raw850/final425') ||
    !mCaitlynRReason.includes('base0/resolved100 versus base60/resolved160') ||
    !mCaitlynRReason.includes('t89999') ||
    !mCaitlynRReason.includes('t90000') ||
    !mCaitlynRReason.includes('mana300') ||
    !mCaitlynRReason.includes('mana99') ||
    !mCaitlynRReason.includes('HP250') ||
    !mCaitlynRReason.includes('bullet-quantum') ||
    !mCaitlynRReason.includes('ability_started') ||
    !mCaitlynRReason.includes('standalone') ||
    !mCaitlynRReason.includes('external existing-data/check-only') ||
    !mCaitlynRReason.includes('identity/panel/resource') ||
    !mCaitlynRReason.includes('不暗示 Caitlyn Q/E dependence') ||
    !mCaitlynRReason.includes('不暗示 Batch-B') ||
    !mCaitlynRReason.includes('sibling Caitlyn synthesis') ||
    !mCaitlynRReason.includes('production runtime/ABI/Web change') ||
    !mCaitlynRReason.includes('StackOverflowError') ||
    !mCaitlynRReason.includes('nonblocking validation-runtime caveat') ||
    !mCaitlynRReason.includes('MAVEN_OPTS=-Xss4m') ||
    !mCaitlynRReason.includes('902/902') ||
    !mCaitlynRReason.includes('focused9/adjacent27/full902') ||
    !mCaitlynRReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mCaitlynRReason.includes('不宣称') ||
    !mCaitlynRReason.includes('no equivalence or contradiction claim') ||
    !mCaitlynRReason.includes('equal size alone is not byte equality or source contradiction') ||
    !mCaitlynRReason.includes('exactly one selected-target quantum') ||
    mCaitlynRReason.includes('canonical byte equivalence') ||
    mCaitlynRReason.includes('Batch-B prerequisite') ||
    mCaitlynRReason.includes('live published') ||
    !(mCaitlynR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_caitlyn_ace_in_the_hole_single_bullet_quantum_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mCaitlynRBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('9fc57e7') &&
        String(e.note || '').includes('015c1dbe') &&
        String(e.note || '').includes('20220') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mCaitlynR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mCaitlynRBoundary) &&
        String(e.note || '').includes('LolGenericCaitlynAceInTheHoleSingleBulletQuantumSeedSqlTest') &&
        String(e.note || '').includes('f088e18') &&
        String(e.note || '').includes('486b8d8') &&
        String(e.note || '').includes('9fc57e7') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Caitlyn synthesis'),
    )
  ) {
    errors.push(
      'Caitlyn R must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Ace in the Hole ordered tags (no dps_relevant_manual_review/total_ad_ratio; requires bonus_ad_ratio), Wiki rev3982561/SHA + local raw caveat + frozen completedBoundary, rank3 100mana/90000CD/one physical bullet quantum 650+1.00*bonusAD via nested binary sub(ad.resolved,ad.base) numerics/schedules (base0/0/0=650; 60/60/0=650; 60/160/0=750; 60/160/100 raw750/final375; 60/260/100 raw850/final425; base0/resolved100 vs base60/resolved160 both750; 20220/20170; no explicit event op), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-Q-E-dependence/no-production-runtime-ABI-Web framing, StackOverflow/MAVEN_OPTS/nonblocking validation caveat + Wasm asset SHA, and bilateral evidence (owning f088e18 / integrated 486b8d8 / Wasm 9fc57e7; one selected-target quantum not full R; no channel/reveal/homing/projectile/crit/live claim)',
    );
  }
  const mTristanaQReason = String(mTristanaQ?.reason || '');
  const mTristanaQBoundary =
    'rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot; no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity';
  if (
    !mTristanaQ ||
    !STATUS_OVERRIDES.has('hero_skill|hero_tristana|Q|急速射击') ||
    mTristanaQ.key !== 'hero_skill|hero_tristana|Q|急速射击' ||
    mTristanaQ.passiveName !== '急速射击' ||
    mTristanaQ.status !== 'completed' ||
    mTristanaQ.completionMode !== 'full' ||
    mTristanaQ.lane !== 'generic_runtime' ||
    mTristanaQ.blocker ||
    mTristanaQ.dataGapEvidence !== null ||
    mTristanaQ.runtimeGapEvidence !== null ||
    mTristanaQ.outOfScopeEvidence !== null ||
    mTristanaQ.coverageBoundary !== mTristanaQBoundary ||
    [...(mTristanaQ.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'ability_type_listener_isolation',
        'active_attack_speed_modifier',
        'timed_state',
      ].join('|') ||
    (mTristanaQ.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mTristanaQ.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mTristanaQ.mechanismTags || []).includes('cast_triggered_timed_attack_speed') ||
    (mTristanaQ.mechanismTags || []).includes('attack_speed_percent_add') ||
    !(mTristanaQ.mechanismTags || []).includes('active_attack_speed_modifier') ||
    !(mTristanaQ.mechanismTags || []).includes('timed_state') ||
    !(mTristanaQ.mechanismTags || []).includes('ability_type_listener_isolation') ||
    mTristanaQReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mTristanaQReason.includes('blocked_data') ||
    mTristanaQReason.includes('needs_manual_baseline') ||
    mTristanaQReason.includes('dps_relevant_manual_review') ||
    mTristanaQReason.includes('depends on Tristana R') ||
    mTristanaQReason.includes('depends on Buster Shot') ||
    mTristanaQReason.includes('requires Buster Shot') ||
    !mTristanaQReason.includes('4026462') ||
    !mTristanaQReason.includes(
      'f6465863035c4634510ecc96e9ee04f4a998d150871d88e498e6636e27a9d4da',
    ) ||
    !mTristanaQReason.includes(
      'db084b4142559f0775af841fe163e1b80880e2661b26b6d82fb26261e1f5d170',
    ) ||
    !mTristanaQReason.includes('Template:Data Tristana/Q') ||
    !mTristanaQReason.includes('Template:Data Tristana/Rapid Fire') ||
    !mTristanaQReason.includes('page1308522') ||
    !mTristanaQReason.includes('bytes872') ||
    !mTristanaQReason.includes('bytes866') ||
    !mTristanaQReason.includes('2026-06-09T21:59:03Z') ||
    !mTristanaQReason.includes(mTristanaQBoundary) ||
    !mTristanaQReason.includes('35 mana') ||
    !mTristanaQReason.includes('16000') ||
    !mTristanaQReason.includes('7000') ||
    !mTristanaQReason.includes('1.20*rapid_fire_active') ||
    !mTristanaQReason.includes('62013') ||
    !mTristanaQReason.includes('ability/tristana_rapid_fire') ||
    !mTristanaQReason.includes('empty AbilityRef') ||
    !mTristanaQReason.includes('no damage or explicit event') ||
    !mTristanaQReason.includes('AS0.60') ||
    !mTristanaQReason.includes('1.32') ||
    !mTristanaQReason.includes('through6999') ||
    !mTristanaQReason.includes('at7000') ||
    !mTristanaQReason.includes('t15999') ||
    !mTristanaQReason.includes('t16000') ||
    !mTristanaQReason.includes('mana105') ||
    !mTristanaQReason.includes('mana34') ||
    !mTristanaQReason.includes('mana35') ||
    !mTristanaQReason.includes('R does not arm Q') ||
    !mTristanaQReason.includes('Q causes no R damage') ||
    !mTristanaQReason.includes('ability_started') ||
    !mTristanaQReason.includes('standalone') ||
    !mTristanaQReason.includes('external existing-data/check-only') ||
    !mTristanaQReason.includes('identity/panel/resource') ||
    !mTristanaQReason.includes('不暗示 Tristana P/W/E/Explosive Charge dependence') ||
    !mTristanaQReason.includes('不暗示 Batch-B') ||
    !mTristanaQReason.includes('sibling Tristana synthesis') ||
    !mTristanaQReason.includes('production runtime/ABI/Web change') ||
    !mTristanaQReason.includes('focused11/adjacent49/full922') ||
    !mTristanaQReason.includes('focused6') ||
    !mTristanaQReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mTristanaQReason.includes('不宣称') ||
    !mTristanaQReason.includes('no equivalence or contradiction claim') ||
    mTristanaQReason.includes('canonical byte equivalence') ||
    mTristanaQReason.includes('Batch-B prerequisite') ||
    mTristanaQReason.includes('live published') ||
    !(mTristanaQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_tristana_rapid_fire_timed_bonus_attack_speed_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mTristanaQBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('ddbca0f') &&
        String(e.note || '').includes('db084b41') &&
        String(e.note || '').includes('62013') &&
        String(e.note || '').includes('1.20*rapid_fire_active') &&
        String(e.note || '').includes('no damage or explicit event') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mTristanaQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mTristanaQBoundary) &&
        String(e.note || '').includes('LolGenericTristanaRapidFireTimedBonusAttackSpeedSeedSqlTest') &&
        String(e.note || '').includes('abc7500') &&
        String(e.note || '').includes('5d468bf') &&
        String(e.note || '').includes('ddbca0f') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Tristana synthesis'),
    )
  ) {
    errors.push(
      'Tristana Q must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Rapid Fire ordered tags (no dps_relevant_manual_review; requires ability_cost_cooldown/active_attack_speed_modifier/timed_state/ability_type_listener_isolation), Wiki rev4026462/SHA + local raw caveat + frozen completedBoundary, rank5 35mana/16000CD/timed7000/AS percent_add 1.20*rapid_fire_active/type62013/empty AbilityRef all-match numerics/schedules (AS0.60→1.32 through6999→0.60 at7000; mana105 t0/t15999/t16000 success/skip/success two starts final mana35/AS1.32; mana34 skip; R does not arm Q and Q causes no R damage), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-Buster-Shot-dependence/no-production-runtime-ABI-Web framing, focused11/adjacent49/full922 + focused6 + Wasm asset SHA, and bilateral evidence (owning abc7500 / integrated 5d468bf / Wasm ddbca0f; timed AS not full Q; no rank-up/animation/windup/basic-count/live claim)',
    );
  }
  const mTristanaRReason = String(mTristanaR?.reason || '');
  const mTristanaRBoundary =
    'rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_325_plus_0_70_bonus_ad_plus_1_00_ap; no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_other_ranks_or_full_fidelity';
  if (
    !mTristanaR ||
    !STATUS_OVERRIDES.has('hero_skill|hero_tristana|R|毁灭射击') ||
    mTristanaR.key !== 'hero_skill|hero_tristana|R|毁灭射击' ||
    mTristanaR.passiveName !== '毁灭射击' ||
    mTristanaR.status !== 'completed' ||
    mTristanaR.completionMode !== 'full' ||
    mTristanaR.lane !== 'generic_runtime' ||
    mTristanaR.blocker ||
    mTristanaR.dataGapEvidence !== null ||
    mTristanaR.runtimeGapEvidence !== null ||
    mTristanaR.outOfScopeEvidence !== null ||
    mTristanaR.coverageBoundary !== mTristanaRBoundary ||
    [...(mTristanaR.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mTristanaR.mechanismTags || []).includes('multi_target_or_area') ||
    (mTristanaR.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mTristanaR.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mTristanaR.mechanismTags || []).includes('total_ad_ratio') ||
    !(mTristanaR.mechanismTags || []).includes('bonus_ad_ratio') ||
    !(mTristanaR.mechanismTags || []).includes('ap_ratio') ||
    !(mTristanaR.mechanismTags || []).includes('active_magic_damage') ||
    mTristanaRReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mTristanaRReason.includes('blocked_data') ||
    mTristanaRReason.includes('multi_target_or_area') ||
    mTristanaRReason.includes('needs_manual_baseline') ||
    mTristanaRReason.includes('out_of_scope_for_single_target_dps') ||
    mTristanaRReason.includes('dps_relevant_manual_review') ||
    mTristanaRReason.includes('depends on Tristana P') ||
    mTristanaRReason.includes('depends on Explosive Charge') ||
    mTristanaRReason.includes('requires Explosive Charge') ||
    mTristanaRReason.includes('total AD；') ||
    mTristanaRReason.includes('total_ad_ratio') ||
    mTristanaRReason.includes('*totalAD') ||
    !mTristanaRReason.includes('4008205') ||
    !mTristanaRReason.includes(
      '2dff322949f442acc00a7074458fd5ed9bc542d6fd143b818a9a7151e117c058',
    ) ||
    !mTristanaRReason.includes(
      '42e07f07f3188aada86d18d782c05d291f031dbbf92171e4a1120e828ebf8c7b',
    ) ||
    !mTristanaRReason.includes('Template:Data Tristana/R') ||
    !mTristanaRReason.includes('Template:Data Tristana/Buster Shot') ||
    !mTristanaRReason.includes('page1308525') ||
    !mTristanaRReason.includes('bytes2385') ||
    !mTristanaRReason.includes('bytes2382') ||
    !mTristanaRReason.includes('2026-04-14T05:37:16Z') ||
    !mTristanaRReason.includes(mTristanaRBoundary) ||
    !mTristanaRReason.includes('source.attr.ad.resolved-source.attr.ad.base') ||
    !mTristanaRReason.includes('exact nested binary formula') ||
    !mTristanaRReason.includes('bonus AD by explicit subtraction') ||
    !mTristanaRReason.includes('不得按 total-AD 直读') ||
    !mTristanaRReason.includes('add(add(325,0.70*') ||
    !mTristanaRReason.includes('325') ||
    !mTristanaRReason.includes('0.70') ||
    !mTristanaRReason.includes('1.00') ||
    !mTristanaRReason.includes('100 mana') ||
    !mTristanaRReason.includes('100000') ||
    !mTristanaRReason.includes('20221') ||
    !mTristanaRReason.includes('20170') ||
    !mTristanaRReason.includes('no explicit event op') ||
    !mTristanaRReason.includes('base0/resolved0/AP0/MR0 raw=final325') ||
    !mTristanaRReason.includes('base60/resolved60/AP0/MR0 raw=final325') ||
    !mTristanaRReason.includes('base60/resolved160/AP0/MR0 raw=final395') ||
    !mTristanaRReason.includes('base60/resolved160/AP100/MR0 raw=final495') ||
    !mTristanaRReason.includes('base60/resolved160/AP100/MR100 raw495/final247.5') ||
    !mTristanaRReason.includes('base60/resolved260/AP200/MR100 raw665/final332.5') ||
    !mTristanaRReason.includes('base0/resolved100 versus base60/resolved160') ||
    !mTristanaRReason.includes('t99999') ||
    !mTristanaRReason.includes('t100000') ||
    !mTristanaRReason.includes('mana300') ||
    !mTristanaRReason.includes('mana99') ||
    !mTristanaRReason.includes('HP505') ||
    !mTristanaRReason.includes('ability_started') ||
    !mTristanaRReason.includes('standalone') ||
    !mTristanaRReason.includes('external existing-data/check-only') ||
    !mTristanaRReason.includes('identity/panel/resource') ||
    !mTristanaRReason.includes('不暗示 Tristana P/Q/W/E/Explosive Charge dependence') ||
    !mTristanaRReason.includes('不暗示 Batch-B') ||
    !mTristanaRReason.includes('sibling Tristana synthesis') ||
    !mTristanaRReason.includes('production runtime/ABI/Web change') ||
    !mTristanaRReason.includes('focused9/adjacent53/full911') ||
    !mTristanaRReason.includes('focused7') ||
    !mTristanaRReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mTristanaRReason.includes('不宣称') ||
    !mTristanaRReason.includes('no equivalence or contradiction claim') ||
    !mTristanaRReason.includes('exactly one selected-target magic hit') ||
    mTristanaRReason.includes('canonical byte equivalence') ||
    mTristanaRReason.includes('Batch-B prerequisite') ||
    mTristanaRReason.includes('live published') ||
    !(mTristanaR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-tristana-buster-shot-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_tristana_buster_shot_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mTristanaRBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('b4d10e4') &&
        String(e.note || '').includes('42e07f07') &&
        String(e.note || '').includes('20221') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mTristanaR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-tristana-buster-shot-primary-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_tristana_buster_shot_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mTristanaRBoundary) &&
        String(e.note || '').includes('LolGenericTristanaBusterShotPrimaryHitSeedSqlTest') &&
        String(e.note || '').includes('8b98bcb') &&
        String(e.note || '').includes('30209c4') &&
        String(e.note || '').includes('b4d10e4') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Tristana synthesis'),
    )
  ) {
    errors.push(
      'Tristana R must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Buster Shot ordered tags (no multi_target_or_area; requires bonus_ad_ratio/ap_ratio/active_magic_damage), Wiki rev4008205/SHA + local raw caveat + frozen completedBoundary, rank3 100mana/100000CD/one magic 325+0.70*bonusAD+1.00*AP nested binary numerics/schedules (325/325/395/495/495→247.5/665→332.5; bonusAD counterproof; 20221/20170; no explicit event op), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-Explosive-Charge-dependence/no-production-runtime-ABI-Web framing, focused9/adjacent53/full911 + focused7 + Wasm asset SHA, and bilateral evidence (owning 8b98bcb / integrated 30209c4 / Wasm b4d10e4; one selected-target magic hit not full R; no cast/knockback/stun/reveal/secondary/live claim)',
    );
  }
  const mTristanaWReason = String(mTristanaW?.reason || '');
  const mTristanaWBoundary =
    'rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity';
  if (
    !mTristanaW ||
    !STATUS_OVERRIDES.has('hero_skill|hero_tristana|W|火箭跳跃') ||
    mTristanaW.key !== 'hero_skill|hero_tristana|W|火箭跳跃' ||
    mTristanaW.passiveName !== '火箭跳跃' ||
    mTristanaW.status !== 'completed' ||
    mTristanaW.completionMode !== 'full' ||
    mTristanaW.lane !== 'generic_runtime' ||
    mTristanaW.blocker ||
    mTristanaW.dataGapEvidence !== null ||
    mTristanaW.runtimeGapEvidence !== null ||
    mTristanaW.outOfScopeEvidence !== null ||
    mTristanaW.coverageBoundary !== mTristanaWBoundary ||
    [...(mTristanaW.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mTristanaW.mechanismTags || []).includes('multi_target_or_area') ||
    (mTristanaW.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mTristanaW.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mTristanaW.mechanismTags || []).includes('primary_damage_branch_salvage') ||
    (mTristanaW.mechanismTags || []).includes('total_ad_ratio') ||
    !(mTristanaW.mechanismTags || []).includes('bonus_ad_ratio') ||
    !(mTristanaW.mechanismTags || []).includes('ap_ratio') ||
    !(mTristanaW.mechanismTags || []).includes('active_magic_damage') ||
    mTristanaWReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mTristanaWReason.includes('blocked_data') ||
    mTristanaWReason.includes('multi_target_or_area') ||
    mTristanaWReason.includes('needs_manual_baseline') ||
    mTristanaWReason.includes('out_of_scope_for_single_target_dps') ||
    mTristanaWReason.includes('dps_relevant_manual_review') ||
    mTristanaWReason.includes('depends on Tristana P') ||
    mTristanaWReason.includes('depends on Explosive Charge') ||
    mTristanaWReason.includes('requires Explosive Charge') ||
    mTristanaWReason.includes('total AD；') ||
    mTristanaWReason.includes('total_ad_ratio') ||
    mTristanaWReason.includes('*totalAD') ||
    !mTristanaWReason.includes('4007758') ||
    !mTristanaWReason.includes(
      'cf0e3ae91310ab5e7cc04408941671520e3464f75bc61da683b100ea82e56eec',
    ) ||
    !mTristanaWReason.includes(
      '7283b2eb2020c20c6e48098e647ba4782b6dc134705c7c668d7e7279da1cabd9',
    ) ||
    !mTristanaWReason.includes('Template:Data Tristana/W') ||
    !mTristanaWReason.includes('Template:Data Tristana/Rocket Jump') ||
    !mTristanaWReason.includes('page1308523') ||
    !mTristanaWReason.includes('bytes2444') ||
    !mTristanaWReason.includes('bytes2443') ||
    !mTristanaWReason.includes('2026-04-12T14:13:05Z') ||
    !mTristanaWReason.includes(mTristanaWBoundary) ||
    !mTristanaWReason.includes('source.attr.ad.resolved-source.attr.ad.base') ||
    !mTristanaWReason.includes('exact nested binary formula') ||
    !mTristanaWReason.includes('bonus AD by explicit subtraction') ||
    !mTristanaWReason.includes('不得按 total-AD 直读') ||
    !mTristanaWReason.includes('add(add(210,1.00*') ||
    !mTristanaWReason.includes('210') ||
    !mTristanaWReason.includes('1.00') ||
    !mTristanaWReason.includes('0.50') ||
    !mTristanaWReason.includes('50 mana') ||
    !mTristanaWReason.includes('14000') ||
    !mTristanaWReason.includes('20221') ||
    !mTristanaWReason.includes('20170') ||
    !mTristanaWReason.includes('no 20230') ||
    !mTristanaWReason.includes('no explicit event op') ||
    !mTristanaWReason.includes('no W ability-specific type') ||
    !mTristanaWReason.includes('no type62013') ||
    !mTristanaWReason.includes('base0/resolved0/AP0/MR0 raw=final210') ||
    !mTristanaWReason.includes('base60/resolved60/AP0/MR0 raw=final210') ||
    !mTristanaWReason.includes('base60/resolved160/AP0/MR0 raw=final310') ||
    !mTristanaWReason.includes('base60/resolved160/AP100/MR0 raw=final360') ||
    !mTristanaWReason.includes('base60/resolved160/AP100/MR100 raw360/final180') ||
    !mTristanaWReason.includes('base60/resolved260/AP200/MR100 raw510/final255') ||
    !mTristanaWReason.includes('base0/resolved100 versus base60/resolved160') ||
    !mTristanaWReason.includes('t13999') ||
    !mTristanaWReason.includes('t14000') ||
    !mTristanaWReason.includes('mana150') ||
    !mTristanaWReason.includes('mana49') ||
    !mTristanaWReason.includes('HP640') ||
    !mTristanaWReason.includes('ability_started') ||
    !mTristanaWReason.includes('W does not arm Q') ||
    !mTristanaWReason.includes('Q causes no W damage') ||
    !mTristanaWReason.includes('standalone') ||
    !mTristanaWReason.includes('external existing-data/check-only') ||
    !mTristanaWReason.includes('identity/panel/resource') ||
    !mTristanaWReason.includes('不暗示 Tristana P/Q/E/Explosive Charge/R dependence') ||
    !mTristanaWReason.includes('不暗示 Batch-B') ||
    !mTristanaWReason.includes('sibling Tristana synthesis') ||
    !mTristanaWReason.includes('production runtime/ABI/Web change') ||
    !mTristanaWReason.includes('focused10/adjacent57/full932') ||
    !mTristanaWReason.includes('focused7') ||
    !mTristanaWReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mTristanaWReason.includes('不宣称') ||
    !mTristanaWReason.includes('no equivalence or contradiction claim') ||
    !mTristanaWReason.includes('exactly one selected-target magic landing hit') ||
    mTristanaWReason.includes('canonical byte equivalence') ||
    mTristanaWReason.includes('Batch-B prerequisite') ||
    mTristanaWReason.includes('live published') ||
    !(mTristanaW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-tristana-rocket-jump-primary-landing-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_tristana_rocket_jump_primary_landing_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mTristanaWBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('9d2716c') &&
        String(e.note || '').includes('7283b2eb') &&
        String(e.note || '').includes('20221') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no 20230') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('no W type') &&
        String(e.note || '').includes('no type62013') &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('W does not arm Q') &&
        String(e.note || '').includes('Q causes no W damage') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mTristanaW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-tristana-rocket-jump-primary-landing-hit' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_tristana_rocket_jump_primary_landing_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mTristanaWBoundary) &&
        String(e.note || '').includes('LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest') &&
        String(e.note || '').includes('7cafeab') &&
        String(e.note || '').includes('ac304d3') &&
        String(e.note || '').includes('9d2716c') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Tristana synthesis'),
    )
  ) {
    errors.push(
      'Tristana W must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Rocket Jump ordered tags (no multi_target_or_area/primary_damage_branch_salvage; requires bonus_ad_ratio/ap_ratio/active_magic_damage), Wiki rev4007758/SHA + local raw caveat + frozen completedBoundary, rank5 50mana/14000CD/one magic 210+1.00*bonusAD+0.50*AP nested binary numerics/schedules (210/210/310/360/360→180/510→255; bonusAD counterproof; 20221/20170; no 20230; no W type/no type62013; no explicit event op; W does not arm Q and Q causes no W damage), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-Explosive-Charge-dependence/no-production-runtime-ABI-Web framing, focused10/adjacent57/full932 + focused7 + Wasm asset SHA, and bilateral evidence (owning 7cafeab / integrated ac304d3 / Wasm 9d2716c; one selected-target magic landing hit not full W; no dash/cast/air-time/AOE/slow/live claim)',
    );
  }
  const mCorkiQReason = String(mCorkiQ?.reason || '');
  const mCorkiQBoundary =
    'rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_other_ranks_or_full_fidelity';
  if (
    !mCorkiQ ||
    !STATUS_OVERRIDES.has('hero_skill|hero_corki|Q|磷光炸弹') ||
    mCorkiQ.key !== 'hero_skill|hero_corki|Q|磷光炸弹' ||
    mCorkiQ.passiveName !== '磷光炸弹' ||
    mCorkiQ.status !== 'completed' ||
    mCorkiQ.completionMode !== 'full' ||
    mCorkiQ.lane !== 'generic_runtime' ||
    mCorkiQ.blocker ||
    mCorkiQ.dataGapEvidence !== null ||
    mCorkiQ.runtimeGapEvidence !== null ||
    mCorkiQ.outOfScopeEvidence !== null ||
    mCorkiQ.coverageBoundary !== mCorkiQBoundary ||
    [...(mCorkiQ.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'bonus_ad_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mCorkiQ.mechanismTags || []).includes('multi_target_or_area') ||
    (mCorkiQ.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mCorkiQ.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mCorkiQ.mechanismTags || []).includes('primary_damage_branch_salvage') ||
    (mCorkiQ.mechanismTags || []).includes('total_ad_ratio') ||
    !(mCorkiQ.mechanismTags || []).includes('bonus_ad_ratio') ||
    !(mCorkiQ.mechanismTags || []).includes('ap_ratio') ||
    !(mCorkiQ.mechanismTags || []).includes('active_magic_damage') ||
    mCorkiQReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mCorkiQReason.includes('blocked_data') ||
    mCorkiQReason.includes('multi_target_or_area') ||
    mCorkiQReason.includes('meta_or_non_target_dps') ||
    mCorkiQReason.includes('needs_manual_baseline') ||
    mCorkiQReason.includes('out_of_scope_for_single_target_dps') ||
    mCorkiQReason.includes('dps_relevant_manual_review') ||
    mCorkiQReason.includes('primary_damage_branch_salvage') ||
    mCorkiQReason.includes('total AD；') ||
    mCorkiQReason.includes('total_ad_ratio') ||
    mCorkiQReason.includes('*totalAD') ||
    !mCorkiQReason.includes('4007588') ||
    !mCorkiQReason.includes(
      'e71a474ef6b4df1df4808b397c8bd0f42ce284234f3eb7603fab09cabd760365',
    ) ||
    !mCorkiQReason.includes(
      'c39556a0d90226462e8a939ebe58888ec91325a9ca4d10be23e43dd77d948ba6',
    ) ||
    !mCorkiQReason.includes('Template:Data Corki/Q') ||
    !mCorkiQReason.includes('Template:Data Corki/Phosphorus Bomb') ||
    !mCorkiQReason.includes('page1306953') ||
    !mCorkiQReason.includes('bytes1531') ||
    !mCorkiQReason.includes('bytes1529') ||
    !mCorkiQReason.includes('2026-04-12T06:50:59Z') ||
    !mCorkiQReason.includes(mCorkiQBoundary) ||
    !mCorkiQReason.includes('source.attr.ad.resolved') ||
    !mCorkiQReason.includes('source.attr.ad.base') ||
    !mCorkiQReason.includes('exact nested binary formula') ||
    !mCorkiQReason.includes('bonus AD by explicit subtraction') ||
    !mCorkiQReason.includes('不得按 total-AD 直读') ||
    !mCorkiQReason.includes('add(add(const 240') ||
    !mCorkiQReason.includes('1.25') ||
    !mCorkiQReason.includes('1.00') ||
    !mCorkiQReason.includes('80 mana') ||
    !mCorkiQReason.includes('7000') ||
    !mCorkiQReason.includes('20221') ||
    !mCorkiQReason.includes('20170') ||
    !mCorkiQReason.includes('no 20230') ||
    !mCorkiQReason.includes('no explicit event op') ||
    !mCorkiQReason.includes('no Q ability-specific type') ||
    !mCorkiQReason.includes('raw=final240') ||
    !mCorkiQReason.includes('raw=final365') ||
    !mCorkiQReason.includes('raw=final340') ||
    !mCorkiQReason.includes('raw=final465') ||
    !mCorkiQReason.includes('raw460/final230') ||
    !mCorkiQReason.includes('raw540/final270') ||
    !mCorkiQReason.includes('both365') ||
    !mCorkiQReason.includes('t6999') ||
    !mCorkiQReason.includes('t7000') ||
    !mCorkiQReason.includes('mana240') ||
    !mCorkiQReason.includes('mana79') ||
    !mCorkiQReason.includes('HP540') ||
    !mCorkiQReason.includes('ability_started') ||
    !mCorkiQReason.includes('standalone') ||
    !mCorkiQReason.includes('external existing-data/check-only') ||
    !mCorkiQReason.includes('identity/panel/resource') ||
    !mCorkiQReason.includes('不暗示 Corki P/W/E/R dependence') ||
    !mCorkiQReason.includes('不暗示 Batch-B') ||
    !mCorkiQReason.includes('sibling Corki synthesis') ||
    !mCorkiQReason.includes('production runtime/ABI/Web change') ||
    !mCorkiQReason.includes('focused75/full975') ||
    !mCorkiQReason.includes('65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0') ||
    !mCorkiQReason.includes('不宣称') ||
    !mCorkiQReason.includes('no equivalence or contradiction claim') ||
    !mCorkiQReason.includes('exactly one selected-primary magic impact hit') ||
    mCorkiQReason.includes('canonical byte equivalence') ||
    mCorkiQReason.includes('Batch-B prerequisite') ||
    mCorkiQReason.includes('live published') ||
    !(mCorkiQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-corki-phosphorus-bomb-primary-impact' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_corki_phosphorus_bomb_primary_impact_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mCorkiQBoundary) &&
        String(e.note || '').includes('ability_started') &&
        String(e.note || '').includes('b381b1e') &&
        String(e.note || '').includes('58f47763') &&
        String(e.note || '').includes('65821') &&
        String(e.note || '').includes('c39556a0') &&
        String(e.note || '').includes('20221') &&
        String(e.note || '').includes('20170') &&
        String(e.note || '').includes('no 20230') &&
        String(e.note || '').includes('no explicit event op') &&
        String(e.note || '').includes('no Q type') &&
        String(e.note || '').includes('nested binary') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no sibling synthesis'),
    ) ||
    !(mCorkiQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-corki-phosphorus-bomb-primary-impact' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mCorkiQBoundary) &&
        String(e.note || '').includes('LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest') &&
        String(e.note || '').includes('6003a7e') &&
        String(e.note || '').includes('b352677') &&
        String(e.note || '').includes('b381b1e') &&
        String(e.note || '').includes('external existing-data/check-only') &&
        String(e.note || '').includes('standalone') &&
        String(e.note || '').includes('no Batch-B') &&
        String(e.note || '').includes('sibling Corki synthesis'),
    )
  ) {
    errors.push(
      'Corki Q must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Phosphorus Bomb ordered tags (no meta_or_non_target_dps/primary_damage_branch_salvage; requires bonus_ad_ratio/ap_ratio/active_magic_damage), Wiki rev4007588/SHA + local raw caveat + frozen completedBoundary, rank5 80mana/7000CD/one magic 240+1.25*bonusAD+1.00*AP nested binary numerics/schedules (240/365/340/465; raw460→230; raw540→270; counterproof both365; 20221/20170; no 20230; no Q type; no explicit event op; t0/t6999/t7000 mana240→80/HP540; mana79 skip), standalone/external-existing-data/check-only/no-Batch-B/no-sibling/no-production-runtime-ABI-Web framing, focused75/full975 + Wasm asset SHA, and bilateral evidence (owning 6003a7e / integrated b352677 / Wasm b381b1e; one selected-primary magic impact hit not full Q; no cast/location/projectile/AOE/sight/reveal/live claim)',
    );
  }
  if (!m3748a || m3748a.status !== 'out_of_scope' || m3748a.completionMode !== 'partial') {
    errors.push('3748 顺劈 71fa0f0c must be out_of_scope/partial');
  }
  if (!m3748b || m3748b.status !== 'out_of_scope' || m3748b.completionMode !== 'partial') {
    errors.push('3748 顺劈 020f8b5a must be out_of_scope/partial');
  }

  const mKalistaP = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kalista|P|武术姿态');
  const mKindredP = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kindred|P|千珏之印');
  const mTeemoP = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_teemo|P|游击队军备');
  const mTwitchQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_twitch|Q|埋伏');
  const mVarusP = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_varus|P|复仇之欲');
  const m6699Current = inv.mechanisms.find((m) => m.key === 'item_passive|6699|item_passive|通电');
  const m6699Firmament = inv.mechanisms.find((m) => m.key === 'item_passive|6699|item_passive|苍穹');
  const m2520ShapedCharge = inv.mechanisms.find(
    (m) => m.key === 'item_passive|2520|item_passive|成型炸药',
  );
  const m2520Sabotage = inv.mechanisms.find((m) => m.key === 'item_passive|2520|item_passive|破坏');
  const m3161FocusedWill = inv.mechanisms.find(
    (m) => m.key === 'item_passive|3161|item_passive|专注意志',
  );
  const m3179Nightstalker = inv.mechanisms.find(
    (m) => m.key === 'item_passive|3179|item_passive|夜行者',
  );
  const m3179Blackout = inv.mechanisms.find(
    (m) => m.key === 'item_passive|3179|item_passive|封锁',
  );
  const m2512OpeningBarrage = inv.mechanisms.find(
    (m) => m.key === 'item_passive|2512|item_passive|开战弹幕',
  );
  const m3073Overdrive = inv.mechanisms.find(
    (m) => m.key === 'item_passive|3073|item_passive|过载',
  );
  const m6610LightshieldStrike = inv.mechanisms.find(
    (m) => m.key === 'item_passive|6610|item_passive|光盾打击',
  );
  if (
    !mKalistaP ||
    mKalistaP.status !== 'out_of_scope' ||
    mKalistaP.completionMode !== 'none' ||
    mKalistaP.blocker
  ) {
    errors.push('Kalista P must be out_of_scope/none (single-target policy)');
  }
  if (
    !mKindredP ||
    mKindredP.status !== 'completed' ||
    mKindredP.completionMode !== 'full' ||
    mKindredP.lane !== 'generic_runtime' ||
    mKindredP.blocker ||
    citesForbiddenProvenance(mKindredP.reason) ||
    /kindred_mark_stacks_max_assumption|c14a4/i.test(
      `${mKindredP.reason || ''}|${JSON.stringify(mKindredP.runtimeGapEvidence || {})}`,
    ) ||
    (mKindredP.runtimeGapEvidence &&
      Array.isArray(mKindredP.runtimeGapEvidence.requiredEvents) &&
      mKindredP.runtimeGapEvidence.requiredEvents.includes('kill_or_takedown')) ||
    (mKindredP.runtimeGapEvidence &&
      Array.isArray(mKindredP.runtimeGapEvidence.missingPrimitives) &&
      mKindredP.runtimeGapEvidence.missingPrimitives.some((p) =>
        /kindred_mark_stacks_max_assumption/i.test(String(p)),
      )) ||
    !String(mKindredP.reason || '').includes('3994253') ||
    !String(mKindredP.reason || '').includes(
      '9ac60eae427fac9ba279734dba2c01b34852eb0be84a01d95296328794afc14a',
    ) ||
    !String(mKindredP.reason || '').includes('Phase-A') ||
    !String(mKindredP.reason || '').includes('250') ||
    !String(mKindredP.reason || '').includes('1.60') ||
    !String(mKindredP.reason || '').includes('0.265') ||
    !String(mKindredP.reason || '').includes('0.175') ||
    !String(mKindredP.reason || '').includes('Q/W/E') ||
    !(mKindredP.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'wasm' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_kindred_mark_of_kindred_max_marks_test.go',
    ) ||
    !(mKindredP.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'backend' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_kindred_mark_of_kindred_max_marks_seed.sql' &&
        String(e.note || '').includes('LolGenericKindredMarkOfKindredMaxMarksSeedSqlTest'),
    )
  ) {
    errors.push(
      'Kindred P must be completed/full/generic_runtime under fixed 25-mark Phase-A with correct Wiki SHA (not c14a4) and bilateral evidence; Q/W/E inventory must not be upgraded by probes',
    );
  }
  const mKindredQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kindred|Q|乱箭之舞');
  const mKindredW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kindred|W|狼灵狂热');
  const mKindredE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kindred|E|横生惧意');
  const mKindredR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kindred|R|羊灵生息');
  if (!mKindredQ || mKindredQ.status !== 'blocked_runtime') {
    errors.push('Kindred Q must remain blocked_runtime (probe must not upgrade inventory)');
  }
  if (!mKindredW || mKindredW.status !== 'blocked_runtime') {
    errors.push('Kindred W must remain blocked_runtime (probe must not upgrade inventory)');
  }
  if (!mKindredE || mKindredE.status !== 'blocked_runtime') {
    errors.push('Kindred E must remain blocked_runtime (probe must not upgrade inventory)');
  }
  if (!mKindredR || mKindredR.status !== 'out_of_scope') {
    errors.push('Kindred R must remain out_of_scope');
  }
  if (!mTeemoP || mTeemoP.status !== 'completed' || /missing_stealth/.test(String(mTeemoP.blocker || ''))) {
    errors.push('Teemo P must be completed with fixed-enabled AS assumption (no stealth blockers)');
  }
  if (!mTwitchQ || mTwitchQ.status !== 'completed' || /missing_stealth/.test(String(mTwitchQ.blocker || ''))) {
    errors.push('Twitch Q must be completed with fixed-enabled AS assumption (no stealth blockers)');
  }
  if (!mVarusP || mVarusP.status !== 'completed' || /minion_kill|missing_stealth/.test(String(mVarusP.blocker || ''))) {
    errors.push('Varus P must be completed with fixed-enabled AS assumption (no kill-event blockers)');
  }
  if (
    !m6699Current ||
    m6699Current.status !== 'stale_or_duplicate' ||
    !m6699Firmament ||
    m6699Firmament.status !== 'completed' ||
    m6699Firmament.completionMode !== 'full' ||
    m6699Firmament.lane !== 'generic_runtime' ||
    m6699Firmament.blocker ||
    !String(m6699Firmament.reason || '').includes('4030984') ||
    !String(m6699Firmament.reason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    ) ||
    !String(m6699Firmament.reason || '').includes('ranged') ||
    !String(m6699Firmament.reason || '').includes('precharged') ||
    !String(m6699Firmament.reason || '').includes('event.target') ||
    !String(m6699Firmament.reason || '').includes('armor_pen_flat') ||
    !String(m6699Firmament.reason || '').includes('generic_firmament_6699_test.go') ||
    !(m6699Firmament.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'wasm' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_firmament_6699_test.go',
    ) ||
    !(m6699Firmament.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'backend' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_firmament_6699_seed.sql' &&
        String(e.note || '').includes('LolGenericFirmament6699SeedSqlTest'),
    )
  ) {
    errors.push(
      '6699 通电 must be stale_or_duplicate; 6699 苍穹 must be completed/full/generic_runtime with Wiki revid/hash + ranged/precharged evidence',
    );
  }
  if (
    !m2520ShapedCharge ||
    m2520ShapedCharge.status !== 'completed' ||
    m2520ShapedCharge.completionMode !== 'full' ||
    m2520ShapedCharge.lane !== 'generic_runtime' ||
    m2520ShapedCharge.blocker ||
    !String(m2520ShapedCharge.reason || '').includes('4030984') ||
    !String(m2520ShapedCharge.reason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    ) ||
    !String(m2520ShapedCharge.reason || '').includes('ranged') ||
    !String(m2520ShapedCharge.reason || '').includes('shaped_charge_ready') ||
    !String(m2520ShapedCharge.reason || '').includes('45000') ||
    !String(m2520ShapedCharge.reason || '').includes('armor_pen_flat') ||
    !String(m2520ShapedCharge.reason || '').includes('damage_trait/ability') ||
    !String(m2520ShapedCharge.reason || '').includes('generic_shaped_charge_2520_test.go') ||
    citesForbiddenProvenance(m2520ShapedCharge.reason) ||
    !(m2520ShapedCharge.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'wasm' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_shaped_charge_2520_test.go',
    ) ||
    !(m2520ShapedCharge.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'backend' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_shaped_charge_2520_seed.sql' &&
        String(e.note || '').includes('LolGenericShapedCharge2520SeedSqlTest'),
    )
  ) {
    errors.push(
      '2520 成型炸药 must be completed/full/generic_runtime with Wiki revid/hash + ranged/ready/matcher/formula/CD evidence',
    );
  }
  if (!m2520Sabotage || m2520Sabotage.status !== 'out_of_scope') {
    errors.push('2520 破坏/Sabotage must remain out_of_scope');
  }
  if (
    !m3161FocusedWill ||
    m3161FocusedWill.status !== 'completed' ||
    m3161FocusedWill.completionMode !== 'full' ||
    m3161FocusedWill.lane !== 'generic_runtime' ||
    m3161FocusedWill.blocker ||
    citesForbiddenProvenance(m3161FocusedWill.reason) ||
    /manual.?baseline|data dragon|ddragon|missing_ability_damage_stacking/i.test(
      String(m3161FocusedWill.reason || ''),
    ) ||
    !String(m3161FocusedWill.reason || '').includes('4030984') ||
    !String(m3161FocusedWill.reason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    ) ||
    !String(m3161FocusedWill.reason || '').includes('perCastThrottleMs') ||
    !String(m3161FocusedWill.reason || '').includes('6000') ||
    !String(m3161FocusedWill.reason || '').includes('max4') ||
    !String(m3161FocusedWill.reason || '').includes('0.03') ||
    !String(m3161FocusedWill.reason || '').includes('old') ||
    !String(m3161FocusedWill.reason || '').includes('generic_focused_will_3161_test.go') ||
    !String(m3161FocusedWill.reason || '').includes('combatDataAssembler') ||
    !(m3161FocusedWill.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'wasm' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_focused_will_3161_test.go',
    ) ||
    !(m3161FocusedWill.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'backend' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_focused_will_3161_seed.sql' &&
        String(e.note || '').includes('LolGenericFocusedWill3161SeedSqlTest') &&
        String(e.note || '').includes('GenericCastOriginPerCastThrottleDbContractSqlTest'),
    )
  ) {
    errors.push(
      '3161 专注意志 must be completed/full/generic_runtime with Wiki revid/hash + perCastThrottle/max4/6000ms/3%/old-stack/Web projection evidence (not blocked/manual/DDragon)',
    );
  }
  if (
    !m3179Nightstalker ||
    m3179Nightstalker.status !== 'completed' ||
    m3179Nightstalker.completionMode !== 'full' ||
    m3179Nightstalker.lane !== 'generic_runtime' ||
    m3179Nightstalker.blocker ||
    citesForbiddenProvenance(m3179Nightstalker.reason) ||
    /missing_vision_stealth|empowered_next_attack_runtime/i.test(
      String(m3179Nightstalker.reason || ''),
    ) ||
    !String(m3179Nightstalker.reason || '').includes('4030984') ||
    !String(m3179Nightstalker.reason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    ) ||
    !String(m3179Nightstalker.reason || '').includes('Phase-A') ||
    !String(m3179Nightstalker.reason || '').includes('50') ||
    !String(m3179Nightstalker.reason || '').includes('1.5') ||
    !String(m3179Nightstalker.reason || '').includes('armor_pen_flat') ||
    !String(m3179Nightstalker.reason || '').includes('ready') ||
    !String(m3179Nightstalker.reason || '').includes('re-arm') ||
    !String(m3179Nightstalker.reason || '').includes('generic_nightstalker_3179_test.go') ||
    !(m3179Nightstalker.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'wasm' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_nightstalker_3179_test.go',
    ) ||
    !(m3179Nightstalker.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'backend' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_nightstalker_3179_seed.sql' &&
        String(e.note || '').includes('LolGenericNightstalker3179SeedSqlTest'),
    )
  ) {
    errors.push(
      '3179 夜行者 must be completed/full/generic_runtime with Wiki revid/hash + Phase-A start-ready/true 50+1.5*armor_pen_flat/no re-arm evidence (not blocked/vision/DDragon)',
    );
  }
  if (
    !m3179Blackout ||
    m3179Blackout.status !== 'out_of_scope' ||
    m3179Blackout.completionMode !== 'none' ||
    !(m3179Blackout.mechanismTags || []).includes('ward_vision') ||
    !String(m3179Blackout.outOfScopeEvidence?.excludedBehavior || '').includes('ward_vision')
  ) {
    errors.push('3179 封锁 must remain out_of_scope with Blackout/ward-vision boundary');
  }
  if (
    !m2512OpeningBarrage ||
    m2512OpeningBarrage.status !== 'completed' ||
    m2512OpeningBarrage.completionMode !== 'full' ||
    m2512OpeningBarrage.lane !== 'generic_runtime' ||
    m2512OpeningBarrage.blocker ||
    m2512OpeningBarrage.runtimeGapEvidence !== null ||
    citesForbiddenProvenance(m2512OpeningBarrage.reason) ||
    citesForbiddenProvenance(JSON.stringify(m2512OpeningBarrage.evidenceRefs || [])) ||
    !String(m2512OpeningBarrage.reason || '').includes('4030984') ||
    !String(m2512OpeningBarrage.reason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    ) ||
    !(m2512OpeningBarrage.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'wasm' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_fiendhunter_bolts_2512_test.go' &&
        e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    ) ||
    !(m2512OpeningBarrage.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'backend' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_fiendhunter_bolts_2512_seed.sql' &&
        e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    )
  ) {
    errors.push(
      '2512 开战弹幕 must be completed/full/generic_runtime with empty blocker, null runtimeGapEvidence, Wiki revid/hash (no DDragon), and bilateral evidence refs',
    );
  }
  if (
    !m3073Overdrive ||
    m3073Overdrive.status !== 'completed' ||
    m3073Overdrive.completionMode !== 'full' ||
    m3073Overdrive.lane !== 'generic_runtime' ||
    m3073Overdrive.blocker ||
    m3073Overdrive.runtimeGapEvidence !== null ||
    citesForbiddenProvenance(m3073Overdrive.reason) ||
    citesForbiddenProvenance(JSON.stringify(m3073Overdrive.evidenceRefs || [])) ||
    !String(m3073Overdrive.reason || '').includes('4030984') ||
    !String(m3073Overdrive.reason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    ) ||
    !(m3073Overdrive.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'wasm' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_experimental_hexplate_3073_test.go' &&
        e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    ) ||
    !(m3073Overdrive.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'backend' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_experimental_hexplate_3073_seed.sql' &&
        e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    )
  ) {
    errors.push(
      '3073 过载 must be completed/full/generic_runtime with empty blocker, null runtimeGapEvidence, Wiki revid/hash (no DDragon), and bilateral evidence refs',
    );
  }
  if (
    !m6610LightshieldStrike ||
    m6610LightshieldStrike.status !== 'completed' ||
    m6610LightshieldStrike.completionMode !== 'full' ||
    m6610LightshieldStrike.lane !== 'generic_runtime' ||
    m6610LightshieldStrike.blocker ||
    m6610LightshieldStrike.runtimeGapEvidence !== null ||
    m6610LightshieldStrike.dataGapEvidence !== null ||
    citesForbiddenProvenance(m6610LightshieldStrike.reason) ||
    citesForbiddenProvenance(JSON.stringify(m6610LightshieldStrike.evidenceRefs || [])) ||
    !String(m6610LightshieldStrike.reason || '').includes('4030984') ||
    !String(m6610LightshieldStrike.reason || '').includes(
      'e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d',
    ) ||
    !String(m6610LightshieldStrike.reason || '').includes('1.60') ||
    !String(m6610LightshieldStrike.reason || '').includes('10000') ||
    !(m6610LightshieldStrike.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'wasm' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_sundered_sky_6610_test.go' &&
        e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    ) ||
    !(m6610LightshieldStrike.evidenceRefs || []).some(
      (e) =>
        e.sourceWorktree === 'backend' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_sundered_sky_6610_seed.sql' &&
        e.taskKey === 'wasm-generic-min-validation-coverage-audit',
    )
  ) {
    errors.push(
      '6610 光盾打击 must be completed/full/generic_runtime with empty blocker, null runtime/data gaps, Wiki revid/hash (no DDragon), and bilateral evidence refs',
    );
  }

  const sc = inv.summary?.statusCounts || {};
  for (const k of STATUS_VALUES) {
    if (typeof sc[k] !== 'number') {
      errors.push(`statusCounts missing ${k}`);
    }
  }
  const statusSumCheck = STATUS_VALUES.reduce((acc, k) => acc + (sc[k] || 0), 0);
  if (statusSumCheck !== inv.mechanisms.length) {
    errors.push(
      `statusCounts sum ${statusSumCheck} != mechanisms.length ${inv.mechanisms.length}`,
    );
  }
  if ((sc.ready_to_implement || 0) > 0) {
    errors.push('ready_to_implement must be 0 in Phase A (no C1-C4 primitive claims)');
  }
  if ((inv.summary?.actionableKeyCount || 0) !== 0) {
    errors.push(`actionableKeyCount expected 0, got ${inv.summary?.actionableKeyCount}`);
  }
  const gotActionable = [...(inv.summary?.actionableKeys || [])].sort((a, b) => a.localeCompare(b, 'en'));
  if (gotActionable.length !== 0) {
    errors.push(`actionableKeys expected empty, got ${gotActionable.join(',')}`);
  }
  if ((inv.summary?.deduplicatedMechanismCount || 0) !== inv.mechanisms.length) {
    errors.push('summary.deduplicatedMechanismCount mismatch');
  }
  if ((inv.mechanisms || []).length !== 254) {
    errors.push(`mechanisms.length=${inv.mechanisms?.length}, expected 254`);
  }
  if ((sc.completed || 0) !== 102) {
    errors.push(`completed=${sc.completed}, expected 102`);
  }
  if ((sc.partial_actionable || 0) !== 0) {
    errors.push(`partial_actionable=${sc.partial_actionable}, expected 0`);
  }
  if ((sc.ready_to_implement || 0) !== 0) {
    errors.push(`ready_to_implement=${sc.ready_to_implement}, expected 0`);
  }
  if ((sc.blocked_runtime || 0) !== 71) {
    errors.push(`blocked_runtime=${sc.blocked_runtime}, expected 71`);
  }
  if ((sc.blocked_data || 0) !== 3) {
    errors.push(`blocked_data=${sc.blocked_data}, expected 3`);
  }
  if ((sc.out_of_scope || 0) !== 72) {
    errors.push(`out_of_scope=${sc.out_of_scope}, expected 72`);
  }
  if ((sc.regression_only || 0) !== 5) {
    errors.push(`regression_only=${sc.regression_only}, expected 5`);
  }
  if ((sc.stale_or_duplicate || 0) !== 1) {
    errors.push(`stale_or_duplicate=${sc.stale_or_duplicate}, expected 1`);
  }
  const cm = inv.summary?.completionModeCounts || {};
  const cmSum = (cm.full || 0) + (cm.partial || 0) + (cm.none || 0);
  if (cmSum !== inv.mechanisms.length) {
    errors.push(
      `completionModeCounts sum ${cmSum} != mechanisms.length ${inv.mechanisms.length}`,
    );
  }
  if ((cm.full || 0) !== 102) {
    errors.push(`completionMode full=${cm.full}, expected 102`);
  }
  if ((cm.partial || 0) !== 3) {
    errors.push(`completionMode partial=${cm.partial}, expected 3`);
  }
  if ((cm.none || 0) !== 149) {
    errors.push(`completionMode none=${cm.none}, expected 149`);
  }
  const implGapCount = (inv.mechanisms || []).filter(
    (m) => m.blocker === 'implementation_gap_no_unresolved_data_fields',
  ).length;
  if (implGapCount !== 56) {
    errors.push(
      `implementation_gap_no_unresolved_data_fields=${implGapCount}, expected 56`,
    );
  }

  const serialized = JSON.stringify(inv).toLowerCase();
  if (serialized.includes('ddragon')) {
    errors.push('generated inventory must not contain ddragon substring');
  }
  if (
    /数据参考\/champion(\/|\.json)/i.test(serialized)
    || serialized.includes('champion-seed-candidate')
  ) {
    errors.push('generated inventory must not cite deleted champion-static provenance paths');
  }

  // Active generated provenance: reason + nested sourceRef must not cite DDragon / Data Dragon / DD x.y.z
  for (const m of inv.mechanisms || []) {
    if (citesForbiddenProvenance(m.reason)) {
      errors.push(`reason cites forbidden provenance @ ${m.key}`);
    }
    for (const evKey of ['dataGapEvidence', 'runtimeGapEvidence', 'outOfScopeEvidence']) {
      const ref = m[evKey]?.sourceRef;
      if (ref && citesForbiddenProvenance(ref)) {
        errors.push(`${evKey}.sourceRef cites forbidden provenance @ ${m.key}`);
      }
    }
  }

  // blocked_runtime must carry precise runtimeGapEvidence (non-empty missingPrimitives).
  const blockedRuntimeRows = (inv.mechanisms || []).filter((m) => m.status === 'blocked_runtime');
  for (const m of blockedRuntimeRows) {
    if (hasNonEmptyDataMissingFields(m.dataGapEvidence)) {
      errors.push(
        `blocked_runtime must not carry dataGapEvidence.missingFields @ ${m.key}`,
      );
    }
    const ev = m.runtimeGapEvidence;
    if (!ev || typeof ev !== 'object') {
      errors.push(`blocked_runtime missing runtimeGapEvidence @ ${m.key}`);
      continue;
    }
    if (!ev.sourceRef || !String(ev.sourceRef).trim()) {
      errors.push(`blocked_runtime runtimeGapEvidence.sourceRef empty @ ${m.key}`);
    }
    if (ev.dataStatus !== 'complete' && ev.dataStatus !== 'partial') {
      errors.push(`blocked_runtime runtimeGapEvidence.dataStatus invalid @ ${m.key}`);
    }
    for (const field of [
      'requiredEvents',
      'requiredState',
      'requiredFormulaInputs',
      'requiredScheduling',
      'missingPrimitives',
    ]) {
      if (!Array.isArray(ev[field])) {
        errors.push(`blocked_runtime runtimeGapEvidence.${field} not array @ ${m.key}`);
      }
    }
    if (!Array.isArray(ev.missingPrimitives) || ev.missingPrimitives.length === 0) {
      errors.push(`blocked_runtime missingPrimitives empty @ ${m.key}`);
    }
    if (ev.missingPrimitives?.some((p) => /runtime gap/i.test(String(p)))) {
      errors.push(`blocked_runtime generic missingPrimitive @ ${m.key}`);
    }
    if (ev.missingPrimitives?.some((p) => containsBlockedRuntimeBlockerForbiddenToken(p))) {
      errors.push(`blocked_runtime missingPrimitives cites seed/mount/publish/E2E @ ${m.key}`);
    }
    if (ev.dataStatus === 'partial' && !String(ev.completedBoundary || '').trim()) {
      errors.push(`blocked_runtime partial missing completedBoundary @ ${m.key}`);
    }
    if (!String(ev.remainingBoundary || '').trim()) {
      errors.push(`blocked_runtime remainingBoundary empty @ ${m.key}`);
    }
    if (containsBlockedRuntimeBlockerForbiddenToken(m.blocker)) {
      errors.push(`blocked_runtime blocker cites seed/mount/publish/E2E @ ${m.key}`);
    }
    if (containsImplEvidenceWording(m.reason)) {
      errors.push(`blocked_runtime reason cites seed/mount/publish/E2E @ ${m.key}`);
    }
    if (!/^[a-z0-9_+.-]+$/i.test(String(m.blocker || ''))) {
      errors.push(`blocked_runtime blocker must be stable English primitive key(s) @ ${m.key}: ${m.blocker}`);
    }
  }
  const mArcane = inv.mechanisms.find((m) => m.key === 'item_passive|2523|item_passive|奥术瞄准');
  const mFlux = inv.mechanisms.find((m) => m.key === 'item_passive|6696|item_passive|涌动');
  const mMag = inv.mechanisms.find((m) => m.key === 'item_passive|2523|item_passive|高倍望远镜');
  if (!mArcane || mArcane.status !== 'out_of_scope' || mArcane.completionMode !== 'none') {
    errors.push('2523 奥术瞄准 must be out_of_scope/none (range-only, no damage)');
  }
  if (!mFlux || mFlux.status !== 'out_of_scope' || mFlux.completionMode !== 'none') {
    errors.push('6696 涌动 must be out_of_scope/none (ultimate CDR only, no damage)');
  }
  if (
    !mMag ||
    mMag.status !== 'completed' ||
    mMag.completionMode !== 'full' ||
    mMag.lane !== 'generic_runtime' ||
    mMag.blocker ||
    !String(mMag.reason || '').includes('1.10') ||
    !(mMag.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_pipeline_damage_modifier_test.go',
    ) ||
    !(mMag.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_pipeline_damage_items_seed.sql',
    )
  ) {
    errors.push(
      '2523 高倍望远镜 must be completed/full under fixed-max 1.10 policy with pipeline damage wasm+backend evidence',
    );
  }
  const mGiant = inv.mechanisms.find((m) => m.key === 'item_passive|3036|item_passive|巨人杀手');
  const giantReason = String(mGiant?.reason || '');
  if (
    !mGiant ||
    mGiant.status !== 'completed' ||
    mGiant.completionMode !== 'full' ||
    mGiant.lane !== 'generic_runtime' ||
    mGiant.blocker ||
    !(
      giantReason.includes('100/104/115/115') ||
      (giantReason.includes('15%') && giantReason.includes('1500')) ||
      giantReason.includes('cap15') ||
      (giantReason.includes('最多 15%') && giantReason.includes('1500'))
    ) ||
    !(mGiant.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_pipeline_damage_modifier_test.go',
    ) ||
    !(mGiant.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_pipeline_damage_items_seed.sql',
    )
  ) {
    errors.push(
      '3036 巨人杀手 must be completed/full with no blocker, pipeline damage wasm+backend evidence, and 100/104/115/115 or cap wording',
    );
  }

  // blocked_data must carry precise, non-implementation data-gap evidence.
  const blockedDataRows = (inv.mechanisms || []).filter((m) => m.status === 'blocked_data');
  for (const m of blockedDataRows) {
    const ev = m.dataGapEvidence;
    if (!ev || typeof ev !== 'object') {
      errors.push(`blocked_data missing dataGapEvidence @ ${m.key}`);
      continue;
    }
    if (!Array.isArray(ev.missingFields) || ev.missingFields.length === 0) {
      errors.push(`blocked_data missingFields empty @ ${m.key}`);
    }
    const blob = `${m.reason || ''}|${m.blocker || ''}|${ev.reasonZh || ''}|${ev.blocker || ''}`;
    if (containsImplEvidenceWording(blob)) {
      errors.push(`blocked_data reason/blocker cites seed/mount/publish/E2E @ ${m.key}`);
    }
    if (m.sourceKind === 'hero_skill') {
      const ref = String(ev.sourceRef || '');
      if (citesForbiddenProvenance(ref)) {
        errors.push(`blocked_data hero row cites forbidden provenance @ ${m.key}`);
      }
      if (
        !ref.includes('lol-wiki-current-champions')
        && !ref.includes('build-generic-g8')
        && !ref.includes('build-unified-mechanism')
      ) {
        errors.push(`blocked_data hero row missing wiki sourceRef @ ${m.key}`);
      }
      if (
        !String(ev.sourceVersion || '').includes('wiki-rev')
        && !String(ev.sourceRef || '').includes('@rev')
        && !ref.includes('build-generic-g8')
        && !ref.includes('build-unified-mechanism')
      ) {
        errors.push(`blocked_data hero row missing wiki revision @ ${m.key}`);
      }
    }
  }
  const stale6699 = (inv.mechanisms || []).filter(
    (m) => m.ownerId === '6699' && m.status === 'stale_or_duplicate',
  );
  if (stale6699.length !== 1 || stale6699[0].passiveName !== '通电') {
    errors.push('expected exactly one stale_or_duplicate row for item 6699 通电');
  }

  const mYunaraR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_yunara|R|定圣诀');
  if (
    !mYunaraR
    || mYunaraR.status !== 'blocked_data'
    || mYunaraR.completionMode !== 'none'
    || !mYunaraR.dataGapEvidence?.missingFields?.some((f) => String(f).includes('arc_of_ruin'))
    || mYunaraR.dataGapEvidence?.missingFields?.some(
      (f) => String(f).includes('transcendent') || String(f).includes('untouchable'),
    )
    || (mYunaraR.dataGapEvidence?.missingFields || []).length !== 1
    || !String(mYunaraR.dataGapEvidence?.sourceRef || '').includes('yunara-r')
  ) {
    errors.push(
      'Yunara R 定圣诀 must be blocked_data/none with Wiki generic dataGapEvidence covering only upgraded Arc of Ruin W damage formula',
    );
  }

  const mKayleQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kayle|Q|耀焰冲击');
  if (
    !mKayleQ
    || mKayleQ.status !== 'completed'
    || mKayleQ.completionMode !== 'full'
    || mKayleQ.lane !== 'generic_runtime'
    || mKayleQ.blocker
    || mKayleQ.runtimeGapEvidence
    || mKayleQ.dataGapEvidence
    || !String(mKayleQ.reason || '').includes('4005105')
    || !String(mKayleQ.reason || '').includes(
      'ded516de4861d88de21ba54de9a8723b654f424f1cc3f9dac30d06382ee1a87c',
    )
    || !String(mKayleQ.reason || '').includes('180')
    || !String(mKayleQ.reason || '').includes('0.60')
    || !String(mKayleQ.reason || '').includes('0.50')
    || !String(mKayleQ.reason || '').includes('15%')
    || !String(mKayleQ.reason || '').includes('100 mana')
    || !String(mKayleQ.reason || '').includes('8000')
    || !(mKayleQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kayle-radiant-blast' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_kayle_radiant_blast_test.go' &&
        e.sourceWorktree === 'wasm',
    )
    || !(mKayleQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-kayle-radiant-blast' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_kayle_radiant_blast_seed.sql' &&
        e.sourceWorktree === 'backend',
    )
  ) {
    errors.push(
      'Kayle Q 耀焰冲击 must be completed/full/generic_runtime with empty blocker/gaps, Wiki rev4005105 Phase-A damage/shred/mana/CD wording, and bilateral wasm/backend evidence',
    );
  }

  const mTeemoQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_teemo|Q|致盲吹箭');
  if (
    !mTeemoQ ||
    mTeemoQ.status !== 'completed' ||
    mTeemoQ.completionMode !== 'full' ||
    mTeemoQ.lane !== 'generic_runtime' ||
    mTeemoQ.blocker ||
    mTeemoQ.dataGapEvidence !== null ||
    mTeemoQ.runtimeGapEvidence !== null ||
    mTeemoQ.outOfScopeEvidence !== null ||
    mTeemoQ.coverageBoundary !==
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry' ||
    [...(mTeemoQ.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'active_magic_damage',
        'ap_ratio',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mTeemoQ.mechanismTags || []).includes('meta_or_non_target_dps') ||
    !String(mTeemoQ.reason || '').includes('3948425') ||
    !String(mTeemoQ.reason || '').includes(
      '4e3c475ed55ec865f6a9060c8ad0b2665e5379b3ae7e9e5cb644f83212b240a7',
    ) ||
    !String(mTeemoQ.reason || '').includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry',
    ) ||
    !String(mTeemoQ.reason || '').includes('260') ||
    !String(mTeemoQ.reason || '').includes('0.70') ||
    !String(mTeemoQ.reason || '').includes('90 mana') ||
    !String(mTeemoQ.reason || '').includes('7000') ||
    !String(mTeemoQ.reason || '').includes('raw400') ||
    !String(mTeemoQ.reason || '').includes('mitigated200') ||
    !String(mTeemoQ.reason || '').includes('154') ||
    !String(mTeemoQ.reason || '').includes('不宣称') ||
    !(mTeemoQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-teemo-blinding-dart' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_teemo_blinding_dart_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry',
        ),
    ) ||
    !(mTeemoQ.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-teemo-blinding-dart' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_teemo_blinding_dart_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry',
        ) &&
        String(e.note || '').includes('LolGenericTeemoBlindingDartSeedSqlTest'),
    )
  ) {
    errors.push(
      'Teemo Q must be completed/full/generic_runtime with cleared gaps/stale tags, Wiki rev3948425/SHA, frozen boundary/formula/cost/CD/numeric schedule, bilateral evidence, and exclusions (no blind/cast/projectile/geometry/multitarget/full-game claim)',
    );
  }

  const mVayneE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_vayne|E|恶魔审判');
  if (
    !mVayneE ||
    mVayneE.status !== 'completed' ||
    mVayneE.completionMode !== 'full' ||
    mVayneE.lane !== 'generic_runtime' ||
    mVayneE.blocker ||
    mVayneE.dataGapEvidence !== null ||
    mVayneE.runtimeGapEvidence !== null ||
    mVayneE.outOfScopeEvidence !== null ||
    mVayneE.coverageBoundary !==
      'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile' ||
    [...(mVayneE.mechanismTags || [])].sort((a, b) => a.localeCompare(b, 'en')).join('|') !==
      [
        'ability_cost_cooldown',
        'ability_flat_bonus_ad_damage',
        'active_physical_damage',
        'immediate_impact_scaffold',
      ].join('|') ||
    (mVayneE.mechanismTags || []).includes('dps_relevant_manual_review') ||
    (mVayneE.mechanismTags || []).includes('meta_or_non_target_dps') ||
    !String(mVayneE.reason || '').includes('4008541') ||
    !String(mVayneE.reason || '').includes(
      'f2b2ba17b90ff5096a9a154f8d1fd4cc43ed3e1be4ebb502cb644acf17712c37',
    ) ||
    !String(mVayneE.reason || '').includes(
      'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile',
    ) ||
    !String(mVayneE.reason || '').includes('190') ||
    !String(mVayneE.reason || '').includes('0.50') ||
    !String(mVayneE.reason || '').includes('90 mana') ||
    !String(mVayneE.reason || '').includes('12000') ||
    !String(mVayneE.reason || '').includes('baseAD60') ||
    !String(mVayneE.reason || '').includes('resolvedAD140') ||
    !String(mVayneE.reason || '').includes('bonusAD80') ||
    !String(mVayneE.reason || '').includes('raw230') ||
    !String(mVayneE.reason || '').includes('mitigated115') ||
    !String(mVayneE.reason || '').includes('52') ||
    !String(mVayneE.reason || '').includes('不宣称') ||
    !(mVayneE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-vayne-condemn-primary-hit' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_vayne_condemn_primary_hit_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile',
        ),
    ) ||
    !(mVayneE.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-vayne-condemn-primary-hit' &&
        e.sourcePath === 'db/game_manage/seeds/lol_generic_vayne_condemn_primary_hit_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(
          'rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile',
        ) &&
        String(e.note || '').includes('LolGenericVayneCondemnPrimaryHitSeedSqlTest'),
    )
  ) {
    errors.push(
      'Vayne E must be completed/full/generic_runtime with cleared gaps/stale tags, Wiki rev4008541/SHA, frozen boundary/formula/cost/CD/numeric schedule, bilateral evidence, and exclusions (no wall/terrain/CC/cast/projectile/full-game claim)',
    );
  }

  const mVayneR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_vayne|R|终极时刻');
  const mVayneRReason = String(mVayneR?.reason || '');
  const mVayneRBoundary =
    'rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement';
  if (
    !mVayneR ||
    mVayneR.key !== 'hero_skill|hero_vayne|R|终极时刻' ||
    mVayneR.passiveName !== '终极时刻' ||
    mVayneR.status !== 'completed' ||
    mVayneR.completionMode !== 'full' ||
    mVayneR.lane !== 'generic_runtime' ||
    mVayneR.blocker ||
    mVayneR.dataGapEvidence !== null ||
    mVayneR.runtimeGapEvidence !== null ||
    mVayneR.outOfScopeEvidence !== null ||
    mVayneR.coverageBoundary !== mVayneRBoundary ||
    [...(mVayneR.mechanismTags || [])].join('|') !==
      [
        'ability_cost_cooldown',
        'cast_triggered_timed_bonus_ad',
        'flat_ad_add',
        'timed_provider_state',
      ].join('|') ||
    (mVayneR.mechanismTags || []).includes('meta_or_non_target_dps') ||
    (mVayneR.mechanismTags || []).includes('dps_relevant_manual_review') ||
    mVayneRReason.includes('implementation_gap_no_unresolved_data_fields') ||
    mVayneRReason.includes('meta_or_non_target_dps') ||
    mVayneRReason.includes('最终时刻') ||
    JSON.stringify(mVayneR.evidenceRefs || []).includes('最终时刻') ||
    !mVayneRReason.includes('3807995') ||
    !mVayneRReason.includes(
      'e417f1cfc5e8253fdfe8140c4659e8fe63441c38ca3aa1e37d69aa31e25d682d',
    ) ||
    !mVayneRReason.includes('343d19e30f0edf70359f122abb2c6c8e7d2d16d5e4c6db46416428d72e7c7642') ||
    !mVayneRReason.includes('Template:Data Vayne/R') ||
    !mVayneRReason.includes('Template:Data Vayne/Final Hour') ||
    !mVayneRReason.includes('page1309991') ||
    !mVayneRReason.includes('bytes2015') ||
    !mVayneRReason.includes('bytes2012') ||
    !mVayneRReason.includes(mVayneRBoundary) ||
    !mVayneRReason.includes('80 mana') ||
    !mVayneRReason.includes('70000') ||
    !mVayneRReason.includes('+65') ||
    !mVayneRReason.includes('12000') ||
    !mVayneRReason.includes('direct provider-scope override state_change') ||
    !mVayneRReason.includes('zero listeners') ||
    !mVayneRReason.includes('ability-start') ||
    !mVayneRReason.includes('AD60') ||
    !mVayneRReason.includes('125') ||
    !mVayneRReason.includes('62.5') ||
    !mVayneRReason.includes('mana300') ||
    !mVayneRReason.includes('140') ||
    !mVayneRReason.includes('t69999') ||
    !mVayneRReason.includes('Night Hunter') ||
    !mVayneRReason.includes('Tumble') ||
    !mVayneRReason.includes('不宣称') ||
    !(mVayneR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-vayne-final-hour-timed-bonus-ad' &&
        e.sourcePath ===
          'wasm/tinygo_engine_v2/internal/runtime/generic_vayne_final_hour_timed_bonus_ad_test.go' &&
        e.sourceWorktree === 'wasm' &&
        String(e.note || '').includes(mVayneRBoundary) &&
        String(e.note || '').includes('direct provider-scope override state_change') &&
        String(e.note || '').includes('zero listeners') &&
        !String(e.note || '').includes('最终时刻'),
    ) ||
    !(mVayneR.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-vayne-final-hour-timed-bonus-ad' &&
        e.sourcePath ===
          'db/game_manage/seeds/lol_generic_vayne_final_hour_timed_bonus_ad_seed.sql' &&
        e.sourceWorktree === 'backend' &&
        String(e.note || '').includes(mVayneRBoundary) &&
        String(e.note || '').includes('LolGenericVayneFinalHourTimedBonusAdSeedSqlTest') &&
        String(e.note || '').includes('4440c3d') &&
        String(e.note || '').includes('8eb9f2a') &&
        String(e.note || '').includes('2710647') &&
        String(e.note || '').includes('18dbff1') &&
        String(e.note || '').includes('3a35a95') &&
        !String(e.note || '').includes('最终时刻'),
    )
  ) {
    errors.push(
      'Vayne R must be completed/full/generic_runtime with cleared blocker/data/runtime/outOfScope gaps, exact Final Hour ordered tags (no meta_or_non_target_dps), Wiki rev3807995/SHA + local raw caveat + frozen completedBoundary, 80mana/70000CD/+65AD/12000ms direct state_change zero-listener numerics, stable-key 终极时刻 (fail-closed vs 最终时刻), and bilateral evidence (owning 4440c3d+8eb9f2a / integrated 2710647+18dbff1 / Wasm 3a35a95; no Night Hunter/Tumble/stealth/takedown/live claim)',
    );
  }

  // Final OOS: structured evidence only; G8-backed semantic fields must equal G8.
  const oosRows = (inv.mechanisms || []).filter((m) => m.status === 'out_of_scope');
  if (oosRows.length === 0) {
    errors.push('out_of_scope rows must be non-empty');
  }
  let oosOmnibusReason = 0;
  for (const m of oosRows) {
    const ev = m.outOfScopeEvidence;
    if (!ev || typeof ev !== 'object') {
      errors.push(`out_of_scope missing outOfScopeEvidence @ ${m.key}`);
      continue;
    }
    if (!String(ev.sourceRef || '').trim()) {
      errors.push(`out_of_scope outOfScopeEvidence.sourceRef empty @ ${m.key}`);
    }
    if (!String(ev.sourceTextSummary || '').trim()) {
      errors.push(`out_of_scope outOfScopeEvidence.sourceTextSummary empty @ ${m.key}`);
    }
    if (ev.reviewedPrimaryTargetDamageBranch !== true) {
      errors.push(`out_of_scope reviewedPrimaryTargetDamageBranch must be true @ ${m.key}`);
    }
    if (!BOUNDARY_CATEGORIES.has(String(ev.boundaryCategory || ''))) {
      errors.push(`out_of_scope boundaryCategory invalid @ ${m.key}: ${ev.boundaryCategory}`);
    }
    if (!String(ev.excludedBehavior || '').trim()) {
      errors.push(`out_of_scope excludedBehavior empty @ ${m.key}`);
    }
    if (!String(ev.boundaryReason || '').trim()) {
      errors.push(`out_of_scope boundaryReason empty @ ${m.key}`);
    }
    if (
      GENERIC_OOS_REASON_RE.test(String(ev.boundaryReason || ''))
      || STALE_OTHER_TARGETS_REASON_RE.test(String(ev.boundaryReason || ''))
    ) {
      oosOmnibusReason += 1;
      errors.push(`out_of_scope generic omnibus reason not allowed @ ${m.key}`);
    }
    if (
      GENERIC_OOS_REASON_RE.test(String(m.reason || ''))
      || STALE_OTHER_TARGETS_REASON_RE.test(String(m.reason || ''))
    ) {
      oosOmnibusReason += 1;
      errors.push(`out_of_scope reason still generic/omnibus @ ${m.key}`);
    }
    if (!String(ev.damageRelevantSubBranchDisposition || '').trim()) {
      errors.push(`out_of_scope damageRelevantSubBranchDisposition empty @ ${m.key}`);
    }
  }
  if (oosOmnibusReason !== 0) {
    errors.push(`OOS generic omnibus reason count expected 0, got ${oosOmnibusReason}`);
  }

  // G8-backed OOS: four semantic fields must equal G8 outOfScopeEvidence exactly.
  if (fs.existsSync(paths.g8Json)) {
    const g8Doc = readJson(paths.g8Json);
    const g8OosByKey = new Map(
      (g8Doc.candidates || [])
        .filter((c) => c.genericClassification === 'out_of_scope' && c.outOfScopeEvidence)
        .map((c) => [c.candidateKey, c.outOfScopeEvidence]),
    );
    for (const m of oosRows) {
      const g8Ev = g8OosByKey.get(m.key);
      if (!g8Ev) continue;
      const ev = m.outOfScopeEvidence;
      if (!ev) continue;
      for (const field of OOS_SEMANTIC_FIELDS) {
        if (String(ev[field] ?? '') !== String(g8Ev[field] ?? '')) {
          errors.push(
            `out_of_scope ${field} != G8 @ ${m.key}: ${ev[field]} vs ${g8Ev[field]}`,
          );
        }
      }
    }
  }

  const mYunaraE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_yunara|E|明踪步 | 夜影翻');
  if (
    !mYunaraE
    || mYunaraE.status !== 'out_of_scope'
    || mYunaraE.outOfScopeEvidence?.boundaryCategory !== 'pure_movement_or_dash'
  ) {
    errors.push(
      'Yunara E 明踪步|夜影翻 must be out_of_scope with boundaryCategory=pure_movement_or_dash',
    );
  }

  const coeffA = '最小验证/V2-BatchV-A-coefficient-buckets.json';
  const coeffB = '最小验证/V2-BatchV-B-3082-wardens-mail-coefficient-buckets.json';
  if (!inv.sources.some((s) => s.path === coeffA)) errors.push(`sources missing ${coeffA}`);
  if (!inv.sources.some((s) => s.path === coeffB)) errors.push(`sources missing ${coeffB}`);
  if (!inv.metadata?.currentInputHashes?.[coeffA]) {
    errors.push(`currentInputHashes missing ${coeffA}`);
  }
  if (!inv.metadata?.currentInputHashes?.[coeffB]) {
    errors.push(`currentInputHashes missing ${coeffB}`);
  }
  if (!inv.sources.some((s) => s.path === KATARINA_LEGACY_SEED_REL)) {
    errors.push(`sources missing ${KATARINA_LEGACY_SEED_REL}`);
  }
  if (!inv.metadata?.currentInputHashes?.[KATARINA_LEGACY_SEED_REL]) {
    errors.push(`currentInputHashes missing ${KATARINA_LEGACY_SEED_REL}`);
  }
  const katBundles = (inv.coverageRecords || []).filter(
    (r) => r.kind === 'legacy_seed_bundle' && r.coverageKey.includes('卡特琳娜-MVP种子数据.json'),
  );
  if (katBundles.length !== 1) {
    errors.push(`expected exactly 1 Katarina legacy_seed_bundle coverage record, got ${katBundles.length}`);
  } else if (katBundles[0].status !== 'regression_only' || katBundles[0].disposition !== 'regression_only') {
    errors.push('Katarina legacy seed bundle must be regression_only disposition/status');
  }
  const katMech = inv.mechanisms.find((m) => m.key === KATARINA_R_KEY);
  if (!katMech) {
    errors.push(`missing mechanism ${KATARINA_R_KEY}`);
  } else {
    if (
      katMech.status !== 'regression_only' ||
      katMech.completionMode !== 'none' ||
      katMech.lane !== 'legacy_single_attacker_dps'
    ) {
      errors.push(
        `Katarina R must remain regression_only/none/legacy_single_attacker_dps, got ${katMech.status}/${katMech.completionMode}/${katMech.lane}`,
      );
    }
    const seedRef = (katMech.sourceRefs || []).find(
      (r) => r.path === KATARINA_LEGACY_SEED_REL && r.sourceRecordKey === 'skill_katarina_r',
    );
    if (!seedRef) {
      errors.push(`Katarina R missing sourceRef to ${KATARINA_LEGACY_SEED_REL}`);
    }
  }
  if (inv.mechanisms.some((m) => (m.aliases || []).includes('skill_katarina_basic_attack'))) {
    errors.push('skill_katarina_basic_attack must not become a distinct mechanism alias');
  }

  const g8Keys = inv.mechanisms.filter((m) =>
    m.sourceRefs.some((r) => r.path === G8_AUDIT_REL),
  );
  if (g8Keys.length !== 242) {
    errors.push(`expected exactly 242 G8-backed mechanisms, got ${g8Keys.length}`);
  }

  const g8CandKeys = new Set(g8Keys.map((m) => m.key));
  if (g8CandKeys.size !== 242) {
    errors.push(`G8 canonical mechanism keys expected 242, got ${g8CandKeys.size}`);
  }

  // Primary G8 + registry sourceRefs on G8 mechanisms must be 242 unique each.
  const g8PrimaryKeys = [];
  const registryPrimaryKeys = [];
  for (const m of g8Keys) {
    const g8Primary = (m.sourceRefs || []).filter(
      (r) => r.path === G8_AUDIT_REL && r.sourceRecordKey === m.key,
    );
    if (g8Primary.length !== 1) {
      errors.push(
        `G8 mechanism ${m.key} expected exactly 1 primary G8 sourceRef keyed by candidateKey, got ${g8Primary.length}`,
      );
    } else {
      g8PrimaryKeys.push(g8Primary[0].sourceRecordKey);
    }
    const regPrimary = (m.sourceRefs || []).filter(
      (r) => r.path === REGISTRY_REL && r.sourceRecordKey === m.key,
    );
    if (regPrimary.length !== 1) {
      errors.push(
        `G8 mechanism ${m.key} expected exactly 1 primary registry sourceRef keyed by candidateKey, got ${regPrimary.length}`,
      );
    } else {
      registryPrimaryKeys.push(regPrimary[0].sourceRecordKey);
    }
    const batchGPrimary = (m.sourceRefs || []).filter(
      (r) => r.path === BATCH_G_AUDIT_REL && r.sourceRecordKey === m.key,
    );
    if (batchGPrimary.length !== 0) {
      errors.push(
        `G8 mechanism ${m.key} must have zero primary Batch-G sourceRefs, got ${batchGPrimary.length}`,
      );
    }
  }
  if (g8PrimaryKeys.length === 242 && new Set(g8PrimaryKeys).size !== 242) {
    errors.push(`G8 primary sourceRecordKey uniqueness expected 242, got ${new Set(g8PrimaryKeys).size}`);
  }
  if (registryPrimaryKeys.length === 242 && new Set(registryPrimaryKeys).size !== 242) {
    errors.push(
      `registry primary sourceRecordKey uniqueness expected 242, got ${new Set(registryPrimaryKeys).size}`,
    );
  }

  // Batch-G may appear only as explicitly allowlisted historical alias/reference.
  const batchGPrimaryExtras = inv.mechanisms.filter(
    (m) =>
      (m.sourceRefs || []).some((r) => r.path === BATCH_G_AUDIT_REL && r.sourceRecordKey === m.key),
  );
  if (batchGPrimaryExtras.length) {
    errors.push(
      `Batch-G primary candidateKey refs must be zero, got ${batchGPrimaryExtras.length}`,
    );
  }

  // Exact hashed source path set = ACTIVE + GENERATOR allowlists.
  const sourcePaths = new Set((inv.sources || []).map((s) => s.path));
  const hashPaths = new Set(Object.keys(inv.metadata?.currentInputHashes || {}));
  for (const p of ALLOWED_HASHED_SOURCE_PATHS) {
    if (!sourcePaths.has(p)) errors.push(`sources missing allowlisted path ${p}`);
    if (!hashPaths.has(p)) errors.push(`currentInputHashes missing allowlisted path ${p}`);
  }
  for (const p of sourcePaths) {
    if (!ALLOWED_HASHED_SOURCE_PATHS.has(p)) {
      errors.push(`sources contains non-allowlisted path ${p}`);
    }
  }
  for (const p of hashPaths) {
    if (!ALLOWED_HASHED_SOURCE_PATHS.has(p)) {
      errors.push(`currentInputHashes contains non-allowlisted path ${p}`);
    }
  }
  if (sourcePaths.has(BATCH_G_AUDIT_REL)) {
    errors.push('Batch-G must not appear in hashed sources');
  }
  if (hashPaths.has(BATCH_G_AUDIT_REL)) {
    errors.push('Batch-G must not appear in currentInputHashes');
  }

  // All mechanism/coverage sourceRefs must be active or exact historical allowlist paths.
  for (const m of inv.mechanisms || []) {
    for (const r of m.sourceRefs || []) {
      if (!ALLOWED_SOURCEREF_PATHS.has(r.path)) {
        errors.push(`mechanism sourceRef path not allowlisted @ ${m.key}: ${r.path}`);
      }
    }
  }
  for (const c of inv.coverageRecords || []) {
    for (const r of c.sourceRefs || []) {
      if (!ALLOWED_SOURCEREF_PATHS.has(r.path)) {
        errors.push(`coverage sourceRef path not allowlisted @ ${c.coverageKey}: ${r.path}`);
      }
    }
  }

  // HISTORICAL dispositions must be explicit enums.
  for (const e of HISTORICAL_SOURCE_REF_ALLOWLIST) {
    if (!['current_generic_evidence', 'data_only_regression', 'historical_reference'].includes(e.disposition)) {
      errors.push(`HISTORICAL_SOURCE_REF_ALLOWLIST bad disposition @ ${e.path}`);
    }
  }

  return errors;
}

function mechanismToCsvRow(m) {
  return {
    key: m.key,
    status: m.status,
    completionMode: m.completionMode,
    lane: m.lane,
    sourceKind: m.sourceKind,
    ownerId: m.ownerId,
    skillKey: m.skillKey,
    passiveName: m.passiveName,
    mechanismTags: (m.mechanismTags || []).join('|'),
    coverageBoundary: m.coverageBoundary || '',
    reason: m.reason || '',
    blocker: m.blocker || '',
    dataGapMissingFields: (m.dataGapEvidence?.missingFields || []).join('|'),
    dataGapEvidenceJson: m.dataGapEvidence ? JSON.stringify(m.dataGapEvidence) : '',
    runtimeGapMissingPrimitives: (m.runtimeGapEvidence?.missingPrimitives || []).join('|'),
    runtimeGapEvidenceJson: m.runtimeGapEvidence ? JSON.stringify(m.runtimeGapEvidence) : '',
    outOfScopeExcludedBehavior: m.outOfScopeEvidence?.excludedBehavior || '',
    outOfScopeEvidenceJson: m.outOfScopeEvidence ? JSON.stringify(m.outOfScopeEvidence) : '',
    sourceRefs: (m.sourceRefs || [])
      .map((r) => `${r.path}#${r.sourceRecordKey}:${r.legacyStatus}`)
      .join(';'),
    evidenceRefs: (m.evidenceRefs || [])
      .map((e) => `${e.taskKey}|${e.sourcePath}|${e.sourceWorktree}`)
      .join(';'),
    aliases: (m.aliases || []).join('|'),
    dependencyOf: (m.dependencyOf || []).join('|'),
  };
}

const CSV_COLUMNS = [
  'key',
  'status',
  'completionMode',
  'lane',
  'sourceKind',
  'ownerId',
  'skillKey',
  'passiveName',
  'mechanismTags',
  'coverageBoundary',
  'reason',
  'blocker',
  'dataGapMissingFields',
  'dataGapEvidenceJson',
  'runtimeGapMissingPrimitives',
  'runtimeGapEvidenceJson',
  'outOfScopeExcludedBehavior',
  'outOfScopeEvidenceJson',
  'sourceRefs',
  'evidenceRefs',
  'aliases',
  'dependencyOf',
];

function buildInventory(generatedAt) {
  if (!fs.existsSync(paths.g8Json)) {
    throw new Error(`missing required input ${relFromRepo(paths.g8Json)}`);
  }
  if (!fs.existsSync(paths.fullItemJson)) {
    throw new Error(`missing required input ${relFromRepo(paths.fullItemJson)}`);
  }

  const sources = discoverSources();
  const g8 = readJson(paths.g8Json);
  if (!Array.isArray(g8.candidates) || g8.candidates.length !== 242) {
    throw new Error(`G8 candidates must be 242, got ${g8.candidates?.length}`);
  }
  const uniqueG8 = new Set(g8.candidates.map((c) => c.candidateKey));
  if (uniqueG8.size !== 242) {
    throw new Error(`G8 unique candidateKey must be 242, got ${uniqueG8.size}`);
  }

  const fullItems = readJson(paths.fullItemJson);
  if (!Array.isArray(fullItems) || fullItems.length !== 518) {
    throw new Error(`full-item coverage must be 518 rows, got ${fullItems?.length}`);
  }

  const mechanisms = buildMechanismsFromG8(g8);
  const mechanismsByKey = new Map(mechanisms.map((m) => [m.key, m]));

  for (const extra of EXTRA_MECHANISMS) {
    if (mechanismsByKey.has(extra.key)) {
      throw new Error(`extra mechanism collides with existing key ${extra.key}`);
    }
    const m = applyRuntimeGapToMechanism(emptyMechanismShell(extra));
    mechanisms.push(m);
    mechanismsByKey.set(m.key, m);
  }

  attachAliases(mechanismsByKey);
  attachSeedSourceRefs(mechanismsByKey);
  attachKatarinaLegacySeedSourceRef(mechanismsByKey);

  const g8ByKey = new Map(g8.candidates.map((c) => [c.candidateKey, c]));
  ensureOutOfScopeEvidence(mechanisms, g8ByKey);

  const { records: fullItemRecords } = buildFullItemCoverageRecords(fullItems, mechanismsByKey);
  const coeffRecords = buildCoefficientCoverageRecords();
  linkCoefficientDependencies(mechanismsByKey, coeffRecords);
  const dataOnlyRecords = buildDataOnlyCoverageRecords();
  const katarinaSeedRecord = buildKatarinaLegacySeedCoverageRecord();

  const coverageRecords = stableSortBy(
    [...fullItemRecords, ...coeffRecords, ...dataOnlyRecords, katarinaSeedRecord],
    (r) => r.coverageKey,
  );

  // Stable sort mechanisms and nested arrays
  for (const m of mechanisms) {
    m.aliases = [...new Set(m.aliases)].sort((a, b) => a.localeCompare(b, 'en'));
    m.dependencyOf = [...new Set(m.dependencyOf)].sort((a, b) => a.localeCompare(b, 'en'));
    m.mechanismTags = [...new Set(m.mechanismTags)].sort((a, b) => a.localeCompare(b, 'en'));
    m.sourceRefs = stableSortBy(
      m.sourceRefs,
      (r) => `${r.path}|${r.sourceRecordKey}|${r.legacyStatus}`,
    );
    m.evidenceRefs = stableSortBy(
      m.evidenceRefs,
      (e) => `${e.taskKey}|${e.sourcePath}|${e.note}`,
    );
  }
  const sortedMechanisms = stableSortBy(mechanisms, (m) => m.key);

  const inputHashes = {};
  for (const s of sources) {
    inputHashes[s.path] = s.sha256;
  }

  const summary = buildSummary(sources, coverageRecords, sortedMechanisms);

  const inventory = {
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      generatorPath: GENERATOR_PATH,
      generatedAt,
      statusValues: [...STATUS_VALUES],
      completionModes: [...COMPLETION_MODES],
      lanes: [...LANES],
      dedupRules: [
        'g8_242_candidateKey_canonical_for_registry_g8_family',
        'registry_and_g8_sourceRecordKey_uses_candidateKey_for_uniqueness',
        'full_item_518_containers_are_coverage_not_mechanisms',
        'seed_without_candidateKey_uses_exact_tuple_kind_owner_skill_tag',
        'normalize_item_N_and_N_to_owner_N',
        'composite_branches_annotated_via_coverageBoundary',
        'coefficient_buckets_are_dependency_coverage_records',
        'preserve_hashed_same_name_text_fragments',
        'keep_both_3302_keys',
        'L_and_M_share_3078_spellblade_M_supersedes_L',
        'specialized_KLMNPJ_attach_by_alias',
        'batch_A_C_data_only_not_passive_mechanisms',
        'nonstandard_katarina_mvp_seed_is_legacy_regression_bundle',
      ],
      aliasTableVersion: 'unified-inventory-alias-v1',
      ownerAliasTableVersion: 'unified-inventory-owner-alias-v1',
      currentInputHashes: inputHashes,
    },
    summary,
    sources,
    coverageRecords,
    mechanisms: sortedMechanisms,
  };

  const errors = validateInventory(inventory);
  if (errors.length) {
    const msg = errors.map((e) => `- ${e}`).join('\n');
    throw new Error(`inventory validation failed:\n${msg}`);
  }

  return inventory;
}

function writeOutputs(inventory) {
  const jsonText = `${JSON.stringify(inventory, null, 2)}\n`;
  const csvText = toCsv(
    inventory.mechanisms.map(mechanismToCsvRow),
    CSV_COLUMNS,
  );
  // Write temp then rename for atomic-enough local runs
  const jsonTmp = `${paths.outputJson}.tmp`;
  const csvTmp = `${paths.outputCsv}.tmp`;
  fs.writeFileSync(jsonTmp, jsonText, 'utf8');
  fs.writeFileSync(csvTmp, csvText, 'utf8');
  fs.renameSync(jsonTmp, paths.outputJson);
  fs.renameSync(csvTmp, paths.outputCsv);
  return { jsonText, csvText };
}

function runCheck(inventory) {
  if (!fs.existsSync(paths.outputJson) || !fs.existsSync(paths.outputCsv)) {
    console.error('--check failed: missing output json/csv');
    process.exit(1);
  }
  const existing = readJson(paths.outputJson);
  const existingErrors = validateInventory(existing);
  if (existingErrors.length) {
    console.error('--check failed: existing json failed validation:');
    for (const e of existingErrors) console.error(`- ${e}`);
    process.exit(1);
  }
  if (!deepEqualJson(stripMetadataGeneratedAt(existing), stripMetadataGeneratedAt(inventory))) {
    console.error('--check failed: semantic JSON differs (ignoring metadata.generatedAt)');
    process.exit(1);
  }
  const expectedCsv = toCsv(inventory.mechanisms.map(mechanismToCsvRow), CSV_COLUMNS);
  const actualCsv = fs.readFileSync(paths.outputCsv, 'utf8');
  // EOL-canonical compare so CRLF vs LF checkouts of generated CSV still match
  if (canonicalizeEol(actualCsv) !== canonicalizeEol(expectedCsv)) {
    console.error('--check failed: CSV content differs');
    process.exit(1);
  }
  console.log('check ok');
  console.log(
    JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        sourceCount: inventory.summary.sourceCount,
        coverageRecordCount: inventory.summary.coverageRecordCount,
        fullItemContainerCount: inventory.summary.fullItemContainerCount,
        deduplicatedMechanismCount: inventory.summary.deduplicatedMechanismCount,
        statusCounts: inventory.summary.statusCounts,
        actionableKeyCount: inventory.summary.actionableKeyCount,
      },
      null,
      2,
    ),
  );
}

function main() {
  const checkMode = process.argv.includes('--check');
  const generatedAt = new Date().toISOString();
  let inventory;
  try {
    inventory = buildInventory(generatedAt);
  } catch (err) {
    console.error(String(err?.stack || err));
    process.exit(1);
  }

  if (checkMode) {
    runCheck(inventory);
    return;
  }

  writeOutputs(inventory);
  console.log('wrote', OUTPUT_JSON_REL);
  console.log('wrote', OUTPUT_CSV_REL);
  console.log(
    JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        sourceCount: inventory.summary.sourceCount,
        coverageRecordCount: inventory.summary.coverageRecordCount,
        fullItemContainerCount: inventory.summary.fullItemContainerCount,
        deduplicatedMechanismCount: inventory.summary.deduplicatedMechanismCount,
        statusCounts: inventory.summary.statusCounts,
        actionableKeyCount: inventory.summary.actionableKeyCount,
      },
      null,
      2,
    ),
  );
}

main();

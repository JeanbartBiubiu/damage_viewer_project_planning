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
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Varus W Blighted Quiver：Wiki rev4026472（SHA256 16307174c4039d8ce71e639396328b2473f4a7e16247a7b2f8a183599b0901d2）已给出 on-hit magic、blight consume 与 active missing-HP 分支公式；非 blocked_data。缺 blight stack/consume 与 active cast runtime。',
      blocker: 'missing_blight_stack_consume_and_active_cast_runtime',
      dataGapEvidence: null,
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
  const mQuinnW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_quinn|W|敏锐感知');
  const mKogmawQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_kogmaw|Q|腐蚀唾液');
  const mXayahW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_xayah|W|致死羽衣');
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
    mVarusW.status !== 'blocked_runtime' ||
    mVarusW.completionMode !== 'none' ||
    mVarusW.blocker !== 'missing_blight_stack_consume_and_active_cast_runtime' ||
    hasNonEmptyDataMissingFields(mVarusW.dataGapEvidence)
  ) {
    errors.push(
      'Varus W must be blocked_runtime/none with blight runtime blocker (Wiki formula present; not blocked_data)',
    );
  }
  if (!mAsheQ || mAsheQ.status !== 'completed' || mAsheQ.completionMode !== 'full') {
    errors.push('Ashe Q must be completed/full under user-approved Wiki scope');
  }
  const mAsheW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_ashe|W|万箭齐发');
  const mAkshanP = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_akshan|P|无所不用');
  const mAkshanE = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_akshan|E|骄行荡寇');
  const mEzrealP = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_ezreal|P|咒能高涨');
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
  if ((sc.completed || 0) !== 60) {
    errors.push(`completed=${sc.completed}, expected 60`);
  }
  if ((sc.blocked_runtime || 0) !== 113) {
    errors.push(`blocked_runtime=${sc.blocked_runtime}, expected 113`);
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
  if ((cm.full || 0) !== 60) {
    errors.push(`completionMode full=${cm.full}, expected 60`);
  }
  if ((cm.partial || 0) !== 3) {
    errors.push(`completionMode partial=${cm.partial}, expected 3`);
  }
  if ((cm.none || 0) !== 191) {
    errors.push(`completionMode none=${cm.none}, expected 191`);
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

/**
 * Unified mechanism verification inventory generator.
 * Schema: unified-mechanism-inventory-v1
 *
 * Default: write JSON + CSV under 最小验证/
 * --check: rebuild in memory, never write; compare semantic JSON (ignore metadata.generatedAt) + exact CSV
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

const paths = {
  outputJson: path.join(repoRoot, OUTPUT_JSON_REL),
  outputCsv: path.join(repoRoot, OUTPUT_CSV_REL),
  g8Json: path.join(verifyRoot, 'generic-g8-adc-passive-coverage-audit.json'),
  fullItemJson: path.join(verifyRoot, 'V2-full-item-dps-coverage-20260615.json'),
  batchJAudit: path.join(verifyRoot, 'V2-Batch-J-status-damage-audit.json'),
  batchPAudit: path.join(verifyRoot, 'V2-Batch-P-target-equipment-linked-effects-audit.json'),
  coeffBucketsA: path.join(verifyRoot, 'V2-BatchV-A-coefficient-buckets.json'),
  coeffBucketsB: path.join(verifyRoot, 'V2-BatchV-B-3082-wardens-mail-coefficient-buckets.json'),
  katarinaLegacySeed: path.join(verifyRoot, '卡特琳娜-MVP种子数据.json'),
};

const KATARINA_LEGACY_SEED_REL = '最小验证/卡特琳娜-MVP种子数据.json';
const KATARINA_R_KEY = 'hero_skill|hero_katarina|R|死亡莲华';
const BATCH_G_AUDIT_REL = '最小验证/V2-Batch-G-adc-passive-audit.json';
const G8_AUDIT_REL = '最小验证/generic-g8-adc-passive-coverage-audit.json';

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
      status: 'blocked_data',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        '当前 Data Dragon 文本无完整当前数值合同；历史 Batch B 1级/OCR 证据版本不一致，缺可核验的当前唯一数值真源。',
      blocker: 'missing_current_unique_numeric_source_vs_version_inconsistent_batch_b_level1_ocr',
    },
  ],
  [
    'hero_skill|hero_twitch|P|死亡毒液',
    {
      status: 'blocked_data',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        '历史 Batch B 为每层每 tick 1 点伤害，legacy helper 为 2；无唯一当前真源可裁定冲突。',
      blocker: 'batch_b_1_vs_legacy_helper_2_per_stack_tick_no_unique_current_truth',
    },
  ],
  [
    'hero_skill|hero_varus|W|枯萎箭袋',
    {
      status: 'blocked_data',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        '历史 seed params 含 on-hit 表 [8,17,26,35,44]，但可执行 legacy operation 固定 rank-1=8；当前 tooltip/effect 未解析，仍无唯一可核验的当前完整 rank 表。',
      blocker:
        'historical_seed_rank_table_8_17_26_35_44_vs_executable_rank1_8_current_tooltip_unresolved',
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
      status: 'ready_to_implement',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Wiki 公式已齐：专横/Tyranny = 获得相当于 2.5% bonus health 的 bonus AD。数据来源：数据参考/lol-wiki-current-items/current-items.normalized.json（item 2501 Tyranny）。可直接实现 source-only 动态 AD 修正。',
      blocker: '',
    },
  ],
  [
    'item_passive|2501|item_passive|报复',
    {
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Wiki 已给出报复/Retribution：按已损失生命值比例将其它来源总 AD 转为额外 AD（0–70% missing HP → 0–12%）。数据已齐，但缺 missing-health 比例驱动的动态 AD modifier runtime。',
      blocker: 'missing_missing_health_ratio_dynamic_ad_modifier_runtime',
    },
  ],
  [
    'item_passive|3097|item_passive|弩箭',
    {
      status: 'ready_to_implement',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Wiki 公式已齐（仅预充能口径）：弩箭/Bolt = 满盈能后下一次普攻造成 100 额外魔法伤害（另有移速分支本口径不实现）。数据来源：数据参考/lol-wiki-current-items/current-items.normalized.json（item 3097 Bolt）。与 3097 盈能充能速率缺口分开。',
      blocker: '',
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
    },
  ],
  [
    'item_passive|2520|item_passive|成型炸药',
    {
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Wiki 已给出成型炸药/Shaped Charge：对英雄或史诗野怪的下一次技能伤害附加真实伤害（含 lethality 缩放）。数据已齐，缺 next ability-damage instance 真实伤害武装/消费 runtime。',
      blocker: 'missing_next_ability_damage_true_damage_arm_consume_runtime',
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
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Wiki 已给出过载/Overdrive：施放终极技能后 8 秒获得攻速与移速（含 CD）。数据已齐，缺 ultimate_cast 事件与定时 AS/MS buff runtime。',
      blocker: 'missing_ultimate_cast_timed_attack_speed_and_ms_buff_runtime',
    },
  ],
  [
    'item_passive|3161|item_passive|专注意志',
    {
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Wiki 已给出专注意志/Focused Will：非固有技能/宠物伤害叠层，每层提升技能/宠物/特效伤害 3%（最多 4 层）。数据已齐，缺 ability-damage 叠层增伤状态机 runtime。',
      blocker: 'missing_ability_damage_stacking_amp_state_machine_runtime',
    },
  ],
  [
    'item_passive|3179|item_passive|夜行者',
    {
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Wiki 已给出夜行者/Nightstalker：脱离视野 ≥1 秒后对英雄下一次普攻附加真实伤害（含 lethality）。数据已齐，缺视野/隐身状态与强化下一次攻击 runtime。',
      blocker: 'missing_vision_stealth_state_and_empowered_next_attack_runtime',
    },
  ],
  [
    'item_passive|6699|item_passive|苍穹',
    {
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Wiki 已给出苍穹/Firmament：满盈能后下一次普攻按目标当前生命值比例造成额外物理伤害并给予短暂 lethality。公式可核验，但缺精确 energized provider 消费与 current-HP 比例伤害 runtime；不得继续标 blocked_data。',
      blocker: 'missing_energized_consume_and_current_hp_ratio_damage_runtime',
    },
  ],
  [
    'hero_skill|hero_teemo|P|游击队军备',
    {
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason: '依赖隐身/离隐与移动窗口事件；当前 generic runtime 缺口。',
      blocker: 'missing_stealth_movement_window_events',
    },
  ],
  [
    'hero_skill|hero_twitch|Q|埋伏',
    {
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason: '依赖隐身/离隐、移动速度与击杀刷新冷却；当前 generic runtime 缺口。',
      blocker: 'missing_stealth_movement_kill_cooldown_events',
    },
  ],
  [
    'hero_skill|hero_varus|P|复仇之欲',
    {
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason: '依赖小兵击杀与英雄参与击杀事件分支；当前 generic runtime 缺口。',
      blocker: 'missing_minion_kill_and_champion_takedown_events',
    },
  ],
  [
    'item_passive|3302|item_passive|交相',
    {
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason: '缺 generic 穿透/交相状态机支持；旧 Batch G ready 口径不得覆盖本键。',
      blocker: 'missing_generic_penetration_alternating_state',
    },
  ],
  [
    'item_passive|6699|item_passive|通电',
    {
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason: '旧 Batch N flat-100/25 充能口径与当前源冲突；缺精确 energized provider 闭环。',
      blocker: 'energized_runtime_and_value_conflict',
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
      status: 'blocked_runtime',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason:
        '核心已部分闭环，但剩余分支依赖 attack-timer reset、逐箭飞行与技能轮转语义，当前不可行动。',
      blocker: 'attack_timer_reset_arrow_travel_rotation_semantics',
    },
  ],
  [
    'hero_skill|hero_draven|Q|旋转飞斧',
    {
      status: 'blocked_runtime',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason:
        '初次飞斧已闭环，但接斧重新武装、双斧上限、移动落点与轮转不是 seed-only 可关闭。',
      blocker: 'catch_rearm_dual_axes_movement_landing_rotation',
    },
  ],
  [
    'hero_skill|hero_kaisa|E|极限超载',
    {
      status: 'blocked_runtime',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason:
        '核心已部分闭环，但真实 cast timing、普攻返还冷却与隐身/进化事件仍缺。',
      blocker: 'cast_timing_attack_timer_cooldown_stealth_evolution',
    },
  ],
  [
    'hero_skill|hero_kogmaw|Q|腐蚀唾液',
    {
      status: 'blocked_runtime',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason:
        '被动攻速已闭环，但主动命中、目标护甲/魔抗击碎与 cast/rotation 不能由静态被动关闭。',
      blocker: 'active_hit_armor_mr_shred_cast_rotation',
    },
  ],
  [
    'item_passive|2510|item_passive|咒刃',
    {
      status: 'blocked_runtime',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason:
        '治疗在伤害分支之外；剩余 DPS 分支需要 generalized delayed on-hit/repeat 调度。',
      blocker: 'healing_out_of_damage_branch_and_delayed_repeat_on_hit',
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
    },
  ],
]);

/** Tags that prove blocked_runtime for remaining G8 blocked rows. */
const BLOCKED_RUNTIME_TAGS = new Set([
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
    key: 'hero_skill|hero_malzahar|E|恶咒降临',
    status: 'blocked_data',
    completionMode: 'none',
    lane: 'legacy_single_attacker_dps',
    sourceKind: 'hero_skill',
    ownerId: 'hero_malzahar',
    skillKey: 'E',
    passiveName: '恶咒降临',
    mechanismTags: ['status_resource_migration'],
    coverageBoundary: 'batch_j_status_damage_audit',
    reason: 'Batch J: true DoT 需迁 status/resource；缺当前可核验数据闭环。',
    blocker: 'status_resource_migration_data_gap',
    sourceRefs: [
      {
        path: '最小验证/V2-Batch-J-status-damage-audit.json',
        legacyStatus: 'migrate_to_status_resource',
        sourceRecordKey: 'skill_malzahar_e',
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
    status: 'ready_to_implement',
    completionMode: 'none',
    lane: 'mixed_evidence',
    sourceKind: 'item_passive',
    ownerId: '3075',
    skillKey: 'item_passive',
    passiveName: '荆棘',
    mechanismTags: ['on_damage_taken_reflect'],
    coverageBoundary: 'batch_p_thornmail;wiki_formula_ready',
    reason:
      'Wiki 公式已齐：荆棘/Thorns = 被普攻命中时对攻击者造成 20(+10% bonus armor) 魔法伤害（并对英雄施加重伤）。数据来源：数据参考/lol-wiki-current-items/current-items.normalized.json（item 3075 Thorns）。旧固定 20 简化作废。',
    blocker: '',
    sourceRefs: [
      {
        path: '最小验证/V2-Batch-P-target-equipment-linked-effects-audit.json',
        legacyStatus: 'publishConditions',
        sourceRecordKey: '3075',
      },
    ],
    aliases: ['item_3075_thornmail_thorns_dps_v2', 'batch_p_thorns'],
  },
  {
    key: 'item_passive|3143|item_passive|复原力',
    status: 'blocked_runtime',
    completionMode: 'none',
    lane: 'mixed_evidence',
    sourceKind: 'item_passive',
    ownerId: '3143',
    skillKey: 'item_passive',
    passiveName: '复原力',
    mechanismTags: ['incoming_crit_damage_modifier'],
    coverageBoundary: 'batch_p_randuin_blocked',
    reason: '缺 generic 目标侧 incoming crit-only modifier hook。',
    blocker: 'missing_target_incoming_crit_only_modifier_hook',
    sourceRefs: [
      {
        path: '最小验证/V2-Batch-P-target-equipment-linked-effects-audit.json',
        legacyStatus: 'blockedItems',
        sourceRecordKey: '3143',
      },
    ],
    aliases: ['item_3143_randuin_crit_reduction_dps_v2', 'batch_p_randuin'],
  },
  {
    key: 'item_passive|6665|item_passive|虚空天生',
    status: 'out_of_scope',
    completionMode: 'partial',
    lane: 'generic_runtime',
    sourceKind: 'item_passive',
    ownerId: '6665',
    skillKey: 'item_passive',
    passiveName: '虚空天生',
    mechanismTags: ['full_stack_resists', 'target_armor_flat_bonus', 'target_magic_resist_flat_bonus'],
    coverageBoundary:
      'controlled_5s_target_owned_synthetic_bonus_resist_branch_complete;real_target_equipment_or_loadout_projection_outside_generic_host_input_contract',
    reason:
      'generic_jaksho_voidborn_resilience_test.go 已用 generic compile/run 证明受控部分：目标侧 provider_item_6665_jaksho_voidborn_resilience 在 t=5000 将 full_stack 0→1，并对显式 synthetic bonus_armor/bonus_magic_resist 各加 30%；不声称真实目标装备或 loadout 投影，亦未声称 seed 已 live migrate/publish。',
    blocker: 'real_target_equipment_or_loadout_projection_outside_generic_host_input_contract',
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
        sourcePath: 'wasm/tinygo_engine_v2/internal/runtime/generic_jaksho_voidborn_resilience_test.go',
        sourceWorktree: 'wasm',
        note: 'controlled target-owned 5s full_stack synthetic bonus-resist partial via generic compile/run; not live migrated/published',
      },
      {
        evidenceType: 'generic_batch',
        taskKey: 'planning-validation-milestones',
        sourcePath: 'db/game_manage/seeds/lol_generic_jaksho_voidborn_resilience_seed.sql',
        sourceWorktree: 'backend',
        note: 'backend seed path referenced as evidence only; not claiming live migrate/publish',
      },
    ],
    aliases: ['item_6665_jaksho_voidborn_resilience_batch_v_a'],
    dependencyOf: [],
  },
  {
    key: 'item_passive|2051|item_passive|无畏',
    status: 'blocked_runtime',
    completionMode: 'none',
    lane: 'mixed_evidence',
    sourceKind: 'item_passive',
    ownerId: '2051',
    skillKey: 'item_passive',
    passiveName: '无畏',
    mechanismTags: ['flat_post_percent', 'incoming_damage_modifier', 'incoming_damage_reduction'],
    coverageBoundary: 'batch_v_a_guardians_horn',
    reason:
      'Seed 使用目标侧 on_damage_taken 与 post-percent/post-mitigation incoming damage modifier；且 seed 标注为 ARAM-only。不可仅凭 seed/mount/tests 声称可关闭。',
    blocker: 'target_owned_on_damage_taken_post_percent_incoming_modifier_aram_only',
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
    status: 'blocked_runtime',
    completionMode: 'none',
    lane: 'mixed_evidence',
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
    coverageBoundary: 'batch_v_b_wardens_mail',
    reason:
      'Seed 要求目标侧 on_damage_taken、每次施法首段 incoming、post-mitigation 输入与 max(input-15,input*0.8)；类比并宽于 3143 incoming crit-only blocker。',
    blocker: 'target_owned_on_damage_taken_first_instance_post_mitigation_final_cap',
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

function sha256File(absPath) {
  return sha256Raw(fs.readFileSync(absPath));
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

function listVerifyRootFiles() {
  return fs
    .readdirSync(verifyRoot, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function classifyRootFile(name) {
  if (name.endsWith('.seed.json')) return 'seed_json';
  if (/^V2-full-item-dps-coverage-summary-.*\.json$/i.test(name) || /coverage-summary/i.test(name)) {
    return 'coverage_summary_json';
  }
  if (/-coverage-.*\.json$/i.test(name) || /coverage-audit\.json$/i.test(name)) return 'coverage_json';
  if (/-coverage-.*\.csv$/i.test(name) || /coverage-audit\.csv$/i.test(name)) return 'coverage_csv';
  if (name.endsWith('-audit.json') || /audit\.json$/i.test(name)) return 'audit_json';
  if (name.endsWith('-audit.csv') || /audit\.csv$/i.test(name)) return 'audit_csv';
  return null;
}

function countRecordsForSource(kind, absPath, parsed) {
  if (kind === 'generator_mjs') {
    return { recordCount: 0, role: 'generator' };
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

/** Consumed coefficient inputs that are not matched by classifyRootFile patterns. */
const EXPLICIT_COEFFICIENT_SOURCES = [
  {
    abs: paths.coeffBucketsA,
    rel: '最小验证/V2-BatchV-A-coefficient-buckets.json',
    kind: 'coefficient_buckets_json',
  },
  {
    abs: paths.coeffBucketsB,
    rel: '最小验证/V2-BatchV-B-3082-wardens-mail-coefficient-buckets.json',
    kind: 'coefficient_buckets_json',
  },
];

/**
 * Legacy seed bundles that do not match `*.seed.json` but are real consumed provenance inputs.
 * Hashed + dispositioned explicitly; not discovered by classifyRootFile.
 */
const EXPLICIT_NONSTANDARD_SEED_SOURCES = [
  {
    abs: paths.katarinaLegacySeed,
    rel: KATARINA_LEGACY_SEED_REL,
    kind: 'seed_json',
  },
];

function pushParsedSource(sources, seen, abs, rel, kind) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const buf = fs.readFileSync(abs);
  let parsed = null;
  if (kind.endsWith('_json')) {
    try {
      parsed = JSON.parse(buf.toString('utf8'));
    } catch (err) {
      throw new Error(`failed to parse source JSON ${rel}: ${err.message}`);
    }
  }
  const { recordCount, role } = countRecordsForSource(kind, abs, parsed);
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

  for (const name of listVerifyRootFiles()) {
    const kind = classifyRootFile(name);
    if (!kind) continue;
    const abs = path.join(verifyRoot, name);
    const rel = relFromRepo(abs);
    pushParsedSource(sources, seen, abs, rel, kind);
  }

  // Coefficient bucket JSONs are consumed by coverage records but do not match audit/coverage/seed patterns.
  for (const f of EXPLICIT_COEFFICIENT_SOURCES) {
    if (!fs.existsSync(f.abs)) {
      throw new Error(`missing required coefficient source ${f.rel}`);
    }
    pushParsedSource(sources, seen, f.abs, f.rel, f.kind);
  }

  // Nonstandard-named legacy seeds (e.g. 卡特琳娜-MVP种子数据.json) — not matched by *.seed.json.
  for (const f of EXPLICIT_NONSTANDARD_SEED_SOURCES) {
    if (!fs.existsSync(f.abs)) {
      throw new Error(`missing required nonstandard seed source ${f.rel}`);
    }
    pushParsedSource(sources, seen, f.abs, f.rel, f.kind);
  }

  const buildFiles = fs
    .readdirSync(dataRoot, { withFileTypes: true })
    .filter((d) => d.isFile() && /^build-.*\.mjs$/i.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, 'en'));

  for (const name of buildFiles) {
    const abs = path.join(dataRoot, name);
    const rel = relFromRepo(abs);
    const buf = fs.readFileSync(abs);
    sources.push({
      path: rel,
      kind: 'generator_mjs',
      sha256: sha256Raw(buf),
      byteSize: buf.byteLength,
      recordCount: 0,
      role: 'generator',
    });
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
    };
  }

  const gc = candidate.genericClassification;
  const tags = candidate.genericMechanismTags || candidate.mechanismTags || [];
  const gap = candidate.remainingGap || '';
  const reason = candidate.classificationReason || candidate.blockedReason || '';

  if (gc === 'migrated') {
    return {
      status: 'completed',
      completionMode: 'full',
      lane: 'generic_runtime',
      reason: reason || 'generic G8 migrated with coverage evidence',
      blocker: '',
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
    };
  }
  if (gc === 'out_of_scope') {
    return {
      status: 'out_of_scope',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason: reason || 'generic G8 out_of_scope',
      blocker: '',
    };
  }
  if (gc === 'blocked') {
    if (isBlockedRuntimeByTags(tags, gap, reason)) {
      return {
        status: 'blocked_runtime',
        completionMode: 'none',
        lane: 'generic_runtime',
        reason: reason || 'runtime capability gap',
        blocker: gap || 'blocked_runtime',
      };
    }
    return {
      status: 'blocked_data',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason: reason || 'data/template/rank/formula gap',
      blocker: gap || 'blocked_data',
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
        sourceRefs: [
          {
            path: G8_AUDIT_REL,
            legacyStatus: c.genericClassification,
            sourceRecordKey: c.candidateKey,
          },
          {
            // Use candidateKey so duplicate-name Batch-G rows (3748/6333/6695) stay unique.
            path: BATCH_G_AUDIT_REL,
            legacyStatus: c.classification,
            sourceRecordKey: c.candidateKey,
          },
        ],
        evidenceRefs,
        aliases: [],
        dependencyOf: [],
      }),
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
  const seedFiles = listVerifyRootFiles().filter((n) => n.endsWith('.seed.json'));
  for (const name of seedFiles) {
    const rel = `最小验证/${name}`;
    const doc = readJson(path.join(verifyRoot, name));
    // Batch A/C are data-only — skip promoting skills (none) and only covered above
    if (name.includes('Batch-A-') || name.includes('Batch-C-')) continue;

    for (const skill of doc.skills || []) {
      const ownerId = normalizeOwnerId(skill.ownerId || skill.heroId || skill.itemId || '');
      const skillKey = skill.skillKey || '';
      // Attach to all mechanisms with matching owner where skillKey aligns, without fuzzy Chinese names
      const candidates = [...mechanismsByKey.values()].filter((m) => m.ownerId === ownerId);
      let matched = [];
      if (skillKey && ['P', 'Q', 'W', 'E', 'R'].includes(skillKey)) {
        matched = candidates.filter((m) => m.skillKey === skillKey);
      } else if (skill.skillId) {
        matched = candidates.filter(
          (m) =>
            (m.aliases || []).includes(skill.skillId) ||
            m.sourceRefs.some((r) => r.sourceRecordKey === skill.skillId),
        );
      }
      if (!matched.length && candidates.length === 1) {
        matched = candidates;
      }

      for (const m of matched) {
        const exists = m.sourceRefs.some((r) => r.path === rel && r.sourceRecordKey === skill.skillId);
        if (!exists) {
          m.sourceRefs.push({
            path: rel,
            legacyStatus: 'seed_skill',
            sourceRecordKey: skill.skillId || `${ownerId}|${skillKey}`,
          });
        }
        if (skill.skillId && !m.aliases.includes(skill.skillId)) {
          m.aliases.push(skill.skillId);
        }
      }
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
  const mVarusW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_varus|W|枯萎箭袋');
  const mAsheQ = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_ashe|Q|射手的专注');
  const m3748a = inv.mechanisms.find(
    (m) => m.key === 'item_passive|3748|item_passive|顺劈|数据参考/item.json#data.3748|71fa0f0c',
  );
  const m3748b = inv.mechanisms.find(
    (m) => m.key === 'item_passive|3748|item_passive|顺劈|数据参考/item.json#data.3748|020f8b5a',
  );
  if (!m3302a || m3302a.status !== 'completed') errors.push('3302 晦影 must be completed');
  if (!m3302b || m3302b.status !== 'blocked_runtime') errors.push('3302 交相 must be blocked_runtime');
  if (!m3124 || m3124.status !== 'completed' || m3124.completionMode !== 'full') {
    errors.push('3124 沸腾打击 must be completed/full');
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
  if (!m2051 || m2051.status !== 'blocked_runtime' || m2051.completionMode !== 'none') {
    errors.push('2051 无畏 must be blocked_runtime/none');
  }
  if (!m3082 || m3082.status !== 'blocked_runtime' || m3082.completionMode !== 'none') {
    errors.push('3082 坚如磐石 must be blocked_runtime/none');
  }
  if (
    !m6665 ||
    m6665.status !== 'out_of_scope' ||
    m6665.completionMode !== 'partial' ||
    m6665.blocker !== 'real_target_equipment_or_loadout_projection_outside_generic_host_input_contract' ||
    !String(m6665.coverageBoundary || '').includes(
      'controlled_5s_target_owned_synthetic_bonus_resist_branch_complete',
    ) ||
    !String(m6665.coverageBoundary || '').includes(
      'real_target_equipment_or_loadout_projection_outside_generic_host_input_contract',
    ) ||
    !String(m6665.reason || '').includes('generic_jaksho_voidborn_resilience_test.go') ||
    !(m6665.evidenceRefs || []).some(
      (e) =>
        e.sourcePath ===
        'wasm/tinygo_engine_v2/internal/runtime/generic_jaksho_voidborn_resilience_test.go',
    ) ||
    !(m6665.evidenceRefs || []).some(
      (e) => e.sourcePath === 'db/game_manage/seeds/lol_generic_jaksho_voidborn_resilience_seed.sql',
    )
  ) {
    errors.push(
      '6665 虚空天生 must be out_of_scope/partial with controlled 5s synthetic branch + equipment/loadout blocker and wasm/backend evidence refs',
    );
  }
  if (
    !mKaisaP ||
    mKaisaP.status !== 'blocked_data' ||
    mKaisaP.completionMode !== 'none' ||
    mKaisaP.blocker !== 'missing_current_unique_numeric_source_vs_version_inconsistent_batch_b_level1_ocr'
  ) {
    errors.push('Kaisa P must be blocked_data/none with missing current unique numeric source blocker');
  }
  if (
    !mTwitchP ||
    mTwitchP.status !== 'blocked_data' ||
    mTwitchP.completionMode !== 'none' ||
    mTwitchP.blocker !== 'batch_b_1_vs_legacy_helper_2_per_stack_tick_no_unique_current_truth'
  ) {
    errors.push('Twitch P must be blocked_data/none with 1-vs-2 per-stack-tick damage conflict blocker');
  }
  if (
    !mVarusW ||
    mVarusW.status !== 'blocked_data' ||
    mVarusW.completionMode !== 'none' ||
    mVarusW.blocker !==
      'historical_seed_rank_table_8_17_26_35_44_vs_executable_rank1_8_current_tooltip_unresolved'
  ) {
    errors.push(
      'Varus W must be blocked_data/none with historical seed rank-table vs executable rank1-8 / unresolved current tooltip blocker',
    );
  }
  if (!mAsheQ || mAsheQ.status !== 'blocked_runtime' || mAsheQ.completionMode !== 'partial') {
    errors.push('Ashe Q must be blocked_runtime/partial');
  }
  if (!m3748a || m3748a.status !== 'out_of_scope' || m3748a.completionMode !== 'partial') {
    errors.push('3748 顺劈 71fa0f0c must be out_of_scope/partial');
  }
  if (!m3748b || m3748b.status !== 'out_of_scope' || m3748b.completionMode !== 'partial') {
    errors.push('3748 顺劈 020f8b5a must be out_of_scope/partial');
  }

  const sc = inv.summary?.statusCounts || {};
  const expectedStatus = {
    completed: 21,
    partial_actionable: 0,
    ready_to_implement: 3,
    blocked_runtime: 46,
    blocked_data: 109,
    out_of_scope: 70,
    regression_only: 5,
    stale_or_duplicate: 0,
  };
  for (const [k, v] of Object.entries(expectedStatus)) {
    if ((sc[k] || 0) !== v) errors.push(`statusCounts.${k} expected ${v}, got ${sc[k] || 0}`);
  }
  if ((inv.summary?.actionableKeyCount || 0) !== 3) {
    errors.push(`actionableKeyCount expected 3, got ${inv.summary?.actionableKeyCount}`);
  }
  const expectedActionable = [
    'item_passive|2501|item_passive|专横',
    'item_passive|3075|item_passive|荆棘',
    'item_passive|3097|item_passive|弩箭',
  ].sort((a, b) => a.localeCompare(b, 'en'));
  const gotActionable = [...(inv.summary?.actionableKeys || [])].sort((a, b) => a.localeCompare(b, 'en'));
  if (JSON.stringify(gotActionable) !== JSON.stringify(expectedActionable)) {
    errors.push(`actionableKeys expected ${expectedActionable.join(',')}, got ${gotActionable.join(',')}`);
  }
  if ((inv.summary?.deduplicatedMechanismCount || 0) !== 254) {
    errors.push(`mechanisms expected 254, got ${inv.summary?.deduplicatedMechanismCount}`);
  }
  if ((inv.summary?.sourceCount || 0) !== 36) {
    errors.push(`sourceCount expected 36, got ${inv.summary?.sourceCount}`);
  }
  if ((inv.summary?.coverageRecordCount || 0) !== 527) {
    errors.push(`coverageRecordCount expected 527, got ${inv.summary?.coverageRecordCount}`);
  }
  const cm = inv.summary?.completionModeCounts || {};
  if ((cm.full || 0) !== 21 || (cm.partial || 0) !== 8 || (cm.none || 0) !== 225) {
    errors.push(
      `completionModeCounts expected full=21 partial=8 none=225, got full=${cm.full} partial=${cm.partial} none=${cm.none}`,
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

  // Batch G must not double-count: unique G8 candidate keys should be 242 among mechanisms with that source
  const g8CandKeys = new Set(g8Keys.map((m) => m.key));
  if (g8CandKeys.size !== 242) {
    errors.push(`G8 canonical mechanism keys expected 242, got ${g8CandKeys.size}`);
  }

  // Primary Batch-G sourceRefs on G8 mechanisms must be 242 unique (candidateKey discriminators).
  const batchGPrimaryKeys = [];
  for (const m of g8Keys) {
    const primary = (m.sourceRefs || []).filter(
      (r) => r.path === BATCH_G_AUDIT_REL && r.sourceRecordKey === m.key,
    );
    if (primary.length !== 1) {
      errors.push(
        `G8 mechanism ${m.key} expected exactly 1 primary Batch-G sourceRef keyed by candidateKey, got ${primary.length}`,
      );
    } else {
      batchGPrimaryKeys.push(primary[0].sourceRecordKey);
    }
  }
  if (batchGPrimaryKeys.length === 242 && new Set(batchGPrimaryKeys).size !== 242) {
    errors.push(
      `Batch-G primary sourceRecordKey uniqueness expected 242, got ${new Set(batchGPrimaryKeys).size}`,
    );
  }
  // Batch G aliases attach to existing G8 keys — must not invent a second 242-mechanism family.
  const batchGOnlyExtra = inv.mechanisms.filter(
    (m) =>
      !g8CandKeys.has(m.key) &&
      (m.sourceRefs || []).some((r) => r.path === BATCH_G_AUDIT_REL && r.sourceRecordKey === m.key),
  );
  if (batchGOnlyExtra.length) {
    errors.push(
      `Batch-G must not add non-G8 mechanisms via primary candidateKey refs, got ${batchGOnlyExtra.length}`,
    );
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
    const m = emptyMechanismShell(extra);
    mechanisms.push(m);
    mechanismsByKey.set(m.key, m);
  }

  attachAliases(mechanismsByKey);
  attachSeedSourceRefs(mechanismsByKey);
  attachKatarinaLegacySeedSourceRef(mechanismsByKey);

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
        'g8_242_candidateKey_canonical_for_batch_g_family',
        'batch_g_sourceRecordKey_uses_candidateKey_for_uniqueness',
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
  if (actualCsv !== expectedCsv) {
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

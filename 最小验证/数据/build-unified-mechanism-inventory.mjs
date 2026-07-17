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
      status: 'ready_to_implement',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        "Kai'Sa P Second Skin：当前 League Wiki 已给出 Caustic Wounds 数值合同（4..24+12%AP、每先前层 1..6+3%AP、第五层 15%+6%/100AP 已损生命、4s/max5）。历史 Batch-B/OCR 仅 provenance。现有 on-hit/stack/missing-HP 能力可直接表达；不声称实现完成。",
      blocker: '',
      dataGapEvidence: null,
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
      status: 'ready_to_implement',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Akshan P Dirty Fighting：当前 League Wiki 已给出第二发 50% AD、第三层魔法伤害阈值 +60% AP、5s/3 stacks。护盾分支可留在伤害口径外。every-n-hit/on-hit 能力可直接表达；不声称已完成。',
      blocker: '',
      dataGapEvidence: null,
    },
  ],
  [
    'hero_skill|hero_akshan|E|骄行荡寇',
    {
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Akshan E Heroic Swing：Wiki per-shot 伤害与 0.2s 间隔已知；移动/摆荡/射击次数属 runtime scope，不是数据缺口。',
      blocker: 'swing_periodic_shot_scheduling_and_as_scaled_damage',
      dataGapEvidence: null,
      runtimeGapEvidence: {
        sourceRef:
          '数据参考/lol-wiki-current-champions/normalized/reviewed-contracts.json#akshan-e',
        dataStatus: 'complete',
        requiredEvents: ['ability_cast', 'swing_shot_tick'],
        requiredState: ['heroic_swing_active'],
        requiredFormulaInputs: ['bonus_attack_speed', 'shot_damage'],
        requiredScheduling: ['shot_every_0_2s_during_swing'],
        missingPrimitives: [
          'swing_periodic_shot_scheduling',
          'as_scaled_per_shot_damage',
          'hook_attach_terrain_path',
        ],
        remainingBoundary:
          '缺摆荡期间周期性射击调度、AS 缩放 per-shot 伤害与钩索路径 runtime。',
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
      status: 'blocked_data',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        'Graves P New Destiny：贴脸最大弹丸伤害公式已由当前 League Wiki 给出；仅精确装填速度公式被 Wiki 明确标注为 unknown（Precise formula is unknown）。不得再声称弹丸/距离数值缺失。',
      blocker: 'wiki_explicit_unknown_precise_reload_speed_formula',
      dataGapEvidence: {
        sourceVersion: 'lol-wiki-current-graves-p',
        sourceRef:
          '数据参考/lol-wiki-current-champions/normalized/reviewed-contracts.json#graves-p',
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
        variables: ['point_blank_pellet_formulas_wiki_explicit'],
        missingFields: ['precise_reload_speed_formula'],
        gapKind: 'wiki_explicit_unknown',
        reasonZh:
          'Graves P New Destiny：贴脸最大弹丸伤害公式已由当前 League Wiki 给出；仅精确装填速度公式被 Wiki 明确标注为 unknown（Precise formula is unknown）。不得再声称弹丸/距离数值缺失。',
        blocker: 'wiki_explicit_unknown_precise_reload_speed_formula',
      },
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
      dataGapEvidence: {
        sourceVersion: 'batch_b_vs_legacy_helper_conflict',
        sourceRef: '最小验证/数据/build-unified-mechanism-inventory.mjs#hero_twitch_P',
        availableEffectTables: {},
        availableCooldowns: [],
        availableCosts: {},
        tooltipPlaceholders: [],
        unresolvedDamagePlaceholders: [],
        varsMapEmpty: true,
        variablesEmpty: true,
        variables: [],
        missingFields: ['unique_per_stack_tick_damage', 'current_truth_source'],
        gapKind: 'conflicting_numeric_sources',
        reasonZh:
          '历史 Batch B 为每层每 tick 1 点伤害，legacy helper 为 2；无唯一当前真源可裁定冲突。',
        blocker: 'batch_b_1_vs_legacy_helper_2_per_stack_tick_no_unique_current_truth',
      },
    },
  ],
  [
    'hero_skill|hero_varus|W|枯萎箭袋',
    {
      status: 'blocked_data',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        '历史候选参数含 on-hit 表 [8,17,26,35,44]，但可执行 legacy operation 固定 rank-1=8；当前 tooltip/effect 未解析，仍无唯一可核验的当前完整 rank 表。',
      blocker:
        'historical_candidate_rank_table_8_17_26_35_44_vs_executable_rank1_8_current_tooltip_unresolved',
      dataGapEvidence: {
        sourceVersion: 'historical_candidate_vs_executable_rank1',
        sourceRef: '最小验证/数据/build-unified-mechanism-inventory.mjs#hero_varus_W',
        availableEffectTables: {},
        availableCooldowns: [],
        availableCosts: {},
        tooltipPlaceholders: [],
        unresolvedDamagePlaceholders: [],
        varsMapEmpty: true,
        variablesEmpty: true,
        variables: [],
        missingFields: [
          'current_full_rank_table',
          'resolved_current_tooltip_effect_binding',
        ],
        gapKind: 'conflicting_numeric_sources',
        reasonZh:
          '历史候选参数含 on-hit 表 [8,17,26,35,44]，但可执行 legacy operation 固定 rank-1=8；当前 tooltip/effect 未解析，仍无唯一可核验的当前完整 rank 表。',
        blocker:
          'historical_candidate_rank_table_8_17_26_35_44_vs_executable_rank1_8_current_tooltip_unresolved',
      },
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
        sourceVersion: 'local-wiki-item-3097',
        sourceRef: '最小验证/数据/build-unified-mechanism-inventory.mjs#item_3097_energized',
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
      status: 'blocked_runtime',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason:
        '核心已部分闭环，但真实 cast timing、普攻返还冷却与隐身/进化事件仍缺。',
      blocker: 'cast_timing_attack_timer_cooldown_stealth_evolution',
    },
  ],
  [
    'hero_skill|hero_draven|W|血性冲刺',
    {
      status: 'blocked_runtime',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason:
        'rank5 主动攻速核心已由 generic CompileGeneric+RunGeneric 闭环（20 mana / 12000ms CD / 3000ms +40% AS）；接斧立即刷新 W CD 仍缺 axe_caught 事件与 ability cooldown reset。移动速度与衰减为允许不模拟的非伤害分支，不作为阻塞。',
      blocker: 'axe_caught_event_ability_cooldown_reset',
    },
  ],
  [
    'hero_skill|hero_quinn|W|敏锐感知',
    {
      status: 'blocked_runtime',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason:
        '预先存在 harrier_vulnerable target-state 时，真实普攻触发 +40% AS/2s 与刷新已由 generic CompileGeneric+RunGeneric 闭环；Quinn P/Q/E 对 harrier_vulnerable 的产生/消费与 Harrier 额外伤害仍缺。W 主动视野与移速为允许不模拟的非伤害分支，不作为阻塞。',
      blocker: 'harrier_vulnerable_produce_consume_and_bonus_damage',
    },
  ],
  [
    'hero_skill|hero_xayah|W|致死羽衣',
    {
      status: 'blocked_runtime',
      completionMode: 'partial',
      lane: 'generic_runtime',
      reason:
        'rank5 主动攻速核心已由 generic CompileGeneric+RunGeneric 闭环（40 mana / 14000ms CD / 4000ms +55% AS）；次级羽刃造成原真实普攻伤害20% 所需、以已结算基础攻击伤害为输入的比例复制语义（明确排除 on-hit/phantom 重复）仍缺。移动速度与洛（Rakan）共享为允许不模拟的非伤害分支，不作为阻塞。',
      blocker: 'secondary_feather_settled_basic_attack_damage_ratio_copy_excluding_on_hit_phantom',
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
      status: 'blocked_runtime',
      completionMode: 'none',
      lane: 'generic_runtime',
      reason:
        '2512 Opening Barrage：ultimate_cast arms next3 attacks/8s；+50% AS；conditional crit damage；already-crit adds 15% pre-mitigation attack damage true damage；45s CD；需要 deterministic crit branch/attack pre-mitigation snapshot/charge consumption。',
      blocker:
        'ultimate_cast_arm_next_3_attacks_8s+deterministic_crit_branch+attack_pre_mitigation_snapshot+charge_consumption+45s_cooldown',
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
    "sourceRef": "数据参考/ddragon-champions/champion-seed-candidate.json#champion_Xayah_P",
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
  "hero_skill|hero_akshan|E|骄行荡寇": {
    "sourceRef": "数据参考/lol-wiki-current-champions/normalized/reviewed-contracts.json#akshan-e",
    "dataStatus": "complete",
    "requiredEvents": [
      "ability_cast",
      "swing_shot_tick"
    ],
    "requiredState": [
      "heroic_swing_active"
    ],
    "requiredFormulaInputs": [
      "bonus_attack_speed",
      "shot_damage"
    ],
    "requiredScheduling": [
      "shot_every_0_2s_during_swing"
    ],
    "missingPrimitives": [
      "swing_periodic_shot_scheduling",
      "as_scaled_per_shot_damage",
      "hook_attach_terrain_path"
    ],
    "remainingBoundary": "缺摆荡期间周期性射击调度、AS 缩放 per-shot 伤害与钩索路径 runtime。",
    "reason": "Akshan E：Wiki per-shot 伤害与 0.2s 间隔已知；移动/摆荡/射击次数属 runtime scope。",
    "blocker": "swing_periodic_shot_scheduling+as_scaled_per_shot_damage+hook_attach_terrain_path"
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
  "item_passive|2512|item_passive|开战弹幕": {
    "sourceRef": "数据参考/lol-wiki-current-items/current-items.normalized.json#item_2512_Opening_Barrage",
    "dataStatus": "complete",
    "requiredEvents": [
      "ultimate_cast",
      "basic_attack_launch",
      "critical_strike_resolved"
    ],
    "requiredState": [
      "opening_barrage_charges",
      "opening_barrage_window"
    ],
    "requiredFormulaInputs": [
      "conditional_crit_damage",
      "already_crit_15pct_pre_mitigation_true_damage",
      "attack_pre_mitigation_snapshot"
    ],
    "requiredScheduling": [
      "next_3_attacks_within_8s",
      "45s_cooldown"
    ],
    "missingPrimitives": [
      "ultimate_cast_arm_next_3_attacks_8s",
      "bonus_attack_speed_50_pct",
      "deterministic_crit_branch",
      "attack_pre_mitigation_snapshot",
      "already_crit_15pct_true_damage",
      "charge_consumption",
      "45s_cooldown"
    ],
    "remainingBoundary": "缺 ultimate_cast 武装 next3/8s、+50% AS、条件暴击分支、已暴击 15% pre-mitigation true damage、charge 消费与 45s CD。",
    "reason": "2512 Opening Barrage：ultimate_cast arms next3 attacks/8s；+50% AS；conditional crit damage；already-crit adds 15% pre-mitigation attack damage true damage；45s CD；需要 deterministic crit branch/attack pre-mitigation snapshot/charge consumption。",
    "blocker": "ultimate_cast_arm_next_3_attacks_8s+deterministic_crit_branch+attack_pre_mitigation_snapshot+charge_consumption+45s_cooldown"
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
  "item_passive|3036|item_passive|巨人杀手": {
    "sourceRef": "数据参考/lol-wiki-current-items/current-items.normalized.json#item_3036_Giant_Slayer",
    "dataStatus": "complete",
    "requiredEvents": [
      "outgoing_damage_dealt"
    ],
    "requiredState": [],
    "requiredFormulaInputs": [
      "target_bonus_health",
      "amp_1pct_per_100_up_to_15pct"
    ],
    "requiredScheduling": [
      "outgoing_damage_amp_ordering"
    ],
    "missingPrimitives": [
      "target_bonus_health_input",
      "outgoing_damage_amp_1pct_per_100_up_to_15pct",
      "outgoing_damage_amp_ordering"
    ],
    "remainingBoundary": "缺目标 bonus health 输入与 outgoing damage amp ordering（1%/100 至 15%）。",
    "reason": "3036 Giant Slayer：target bonus health input，1% per100 up to15%，outgoing damage amp ordering。",
    "blocker": "target_bonus_health_input+outgoing_damage_amp_1pct_per_100_up_to_15pct+outgoing_damage_amp_ordering"
  },
  "item_passive|6610|item_passive|光盾打击": {
    "sourceRef": "数据参考/lol-wiki-current-items/current-items.normalized.json#item_6610_Lightshield_Strike",
    "dataStatus": "complete",
    "requiredEvents": [
      "basic_attack_vs_champion"
    ],
    "requiredState": [
      "per_target_guaranteed_crit_arm",
      "per_target_cooldown"
    ],
    "requiredFormulaInputs": [
      "specified_crit_damage"
    ],
    "requiredScheduling": [
      "per_target_10s_cooldown"
    ],
    "missingPrimitives": [
      "per_target_next_attack_guaranteed_crit",
      "specified_crit_damage_branch",
      "per_target_10s_cooldown"
    ],
    "remainingBoundary": "治疗分支 out_of_scope；缺 per-target 下一次普攻必定暴击与指定暴击伤害/10s CD。",
    "reason": "6610 Lightshield Strike：per-target 10s next attack guaranteed crit with specified crit damage; healing OOS；needs conditional crit/per-target CD。",
    "blocker": "per_target_next_attack_guaranteed_crit+specified_crit_damage_branch+per_target_10s_cooldown"
  },
  "item_passive|6665|item_passive|虚空天生": {
    "sourceRef": "wasm/tinygo_engine_v2/internal/runtime/generic_jaksho_voidborn_resilience_test.go#VoidbornResilience",
    "dataStatus": "partial",
    "requiredEvents": [
      "target_equipment_or_loadout_projection"
    ],
    "requiredState": [
      "provider_item_6665_jaksho_voidborn_resilience",
      "full_stack"
    ],
    "requiredFormulaInputs": [
      "target_base_armor_and_magic_resist",
      "target_bonus_armor_and_magic_resist",
      "real_equipment_projected_bonus_resists"
    ],
    "requiredScheduling": [
      "full_stack_tick_interval_5000ms"
    ],
    "missingPrimitives": [
      "real_target_equipment_or_loadout_to_provider_projection",
      "target_base_and_bonus_resistance_input_consistency"
    ],
    "completedBoundary": "controlled synthetic：target-owned provider_item_6665_jaksho_voidborn_resilience 在 t=5000 将 full_stack 0→1，并对显式 synthetic bonus_armor/bonus_magic_resist 各加 30%。",
    "remainingBoundary": "真实 target equipment/loadout→provider projection 的跨层证据与目标基础/bonus resistance 输入一致性（非 live publish）。",
    "reason": "受控 synthetic bonus resist partial 已证明；剩余真实 equipment/loadout→provider 投影与目标 base/bonus resist 输入一致性。",
    "blocker": "real_target_equipment_or_loadout_projection_outside_generic_host_input_contract"
  }
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
    dataGapEvidence: {
      sourceVersion: 'batch_j_status_damage_audit',
      sourceRef: '最小验证/V2-Batch-J-status-damage-audit.json#skill_malzahar_e',
      availableEffectTables: {},
      availableCooldowns: [],
      availableCosts: {},
      tooltipPlaceholders: [],
      unresolvedDamagePlaceholders: [],
      varsMapEmpty: true,
      variablesEmpty: true,
      variables: [],
      missingFields: ['status_resource_dot_numeric_contract', 'current_verifiable_data_loop'],
      gapKind: 'status_resource_data_gap',
      reasonZh: 'Batch J: true DoT 需迁 status/resource；缺当前可核验数据闭环。',
      blocker: 'status_resource_migration_data_gap',
    },
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
    status: 'blocked_runtime',
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
      '受控 synthetic bonus resist partial 已证明；剩余真实 equipment/loadout→provider 投影与目标 base/bonus resist 输入一致性。',
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
  const buf = canonicalizeUtf8TextBytes(fs.readFileSync(abs));
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
    const buf = canonicalizeUtf8TextBytes(fs.readFileSync(abs));
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
            mapped.outOfScopeEvidence || override?.outOfScopeEvidence || null,
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

const DAMAGE_RELATED_SIGNAL_RE =
  /造成.{0,16}伤害|额外伤害|真实伤害|物理伤害|魔法伤害|附带伤害|攻击特效|斩杀|处决|伤害放大|易伤|护甲穿透|魔法穿透|法术穿透|穿甲|法穿|命中造成|攻击速度|攻速|获得.{0,24}攻击力|获得.{0,24}法术强度|额外攻击力|额外法术强度|暴击伤害/;

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
const VISION_SEMANTIC_RE = /视野|真实视野|显形|伪装|侦察|鹰|守卫|陷阱/;
const PRIMARY_DAMAGE_DEAL_RE =
  /造成.{0,16}(物理|魔法|真实)?伤害|额外伤害|每次攻击.{0,8}伤害|发射.{0,12}伤害/;
const POST_DAMAGE_UTILITY_ONLY_RE =
  /造成物理伤害时会提供|造成物理伤害后|攻击一个单位时会提供|攻击一位英雄.{0,6}会/;

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

  // other_targets_only: require explicit evidence primary target is not hit by this component
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

  // Vision-primary only (do not classify revive/economy skills that mention 伪装).
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

  // Dash/leap lead verbs before incidental shield/heal wording.
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

  // Fallback: non-damage meta without guessing multi_target/meta tags
  if (MOVE_SEMANTIC_RE.test(blob)) return 'pure_movement_or_dash';
  if (VISION_SEMANTIC_RE.test(blob)) return 'pure_vision';
  if (/金币|赏金/.test(blob)) return 'economy_or_post_takedown';
  if (/护盾|治疗|复活/.test(blob)) return 'pure_heal_shield_survival';
  if (/急速|冷却/.test(blob)) return 'cooldown_or_ability_haste_only';
  return 'stat_or_active_only';
}

function synthesizeOutOfScopeEvidence(mechanism, sourceText = '') {
  const text = String(sourceText || '');
  const tags = mechanism.mechanismTags || [];
  const reason = String(mechanism.reason || '');
  const passive = String(mechanism.passiveName || '');
  const owner = String(mechanism.ownerId || '');
  const label = passive || mechanism.key;
  const sourceRef =
    mechanism.sourceRefs?.[0]
      ? `${mechanism.sourceRefs[0].path}#${mechanism.sourceRefs[0].sourceRecordKey}`
      : `最小验证/数据/build-unified-mechanism-inventory.mjs#${mechanism.key}`;

  const boundaryCategory = resolveBoundaryCategory({
    text,
    tags,
    reason,
    owner,
    key: mechanism.key,
    passive,
  });
  const excludedBehavior = excludedBehaviorForCategory(boundaryCategory, tags, text);
  const disposition = dispositionForCategory(boundaryCategory, text, owner);
  const boundaryReason = boundaryReasonForCategory(boundaryCategory, label);

  return {
    sourceRef,
    sourceTextSummary: summarizeSourceText(text || reason),
    reviewedPrimaryTargetDamageBranch: true,
    boundaryCategory,
    excludedBehavior,
    boundaryReason,
    damageRelevantSubBranchDisposition: disposition,
  };
}

function ensureOutOfScopeEvidence(mechanisms, g8ByKey) {
  for (const m of mechanisms) {
    if (m.status !== 'out_of_scope') {
      m.outOfScopeEvidence = m.outOfScopeEvidence || null;
      continue;
    }
    const g8 = g8ByKey?.get(m.key);
    const sourceText = g8?.sourceText || '';
    const evExisting = m.outOfScopeEvidence;
    const catOk =
      evExisting
      && BOUNDARY_CATEGORIES.has(String(evExisting.boundaryCategory || ''))
      && evExisting.reviewedPrimaryTargetDamageBranch === true
      && String(evExisting.excludedBehavior || '').trim()
      && String(evExisting.boundaryReason || '').trim()
      && !GENERIC_OOS_REASON_RE.test(String(evExisting.boundaryReason || ''))
      && !STALE_OTHER_TARGETS_REASON_RE.test(String(evExisting.boundaryReason || ''));
    if (catOk) {
      m.reason = evExisting.boundaryReason;
      continue;
    }
    const ev = synthesizeOutOfScopeEvidence(m, sourceText);
    m.outOfScopeEvidence = ev;
    m.reason = ev.boundaryReason;
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
  const mDravenW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_draven|W|血性冲刺');
  const mQuinnW = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_quinn|W|敏锐感知');
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
  if (!m3302b || m3302b.status !== 'blocked_runtime') errors.push('3302 交相 must be blocked_runtime');
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
    m3097Energized.blocker !== 'missing_precise_energize_move_and_attack_charge_rates_in_local_wiki'
  ) {
    errors.push(
      '3097 盈能 must remain blocked_data/none with missing precise energize charge-rate blocker',
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
  if (!m2051 || m2051.status !== 'blocked_runtime' || m2051.completionMode !== 'none') {
    errors.push('2051 无畏 must be blocked_runtime/none');
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
    m6665.status !== 'blocked_runtime' ||
    m6665.completionMode !== 'partial' ||
    m6665.lane !== 'generic_runtime' ||
    m6665.blocker !== 'real_target_equipment_or_loadout_projection_outside_generic_host_input_contract' ||
    !String(m6665.coverageBoundary || '').includes(
      'controlled_5s_target_owned_synthetic_bonus_resist_branch_complete',
    ) ||
    !String(m6665.coverageBoundary || '').includes(
      'real_target_equipment_or_loadout_projection_outside_generic_host_input_contract',
    ) ||
    m6665.runtimeGapEvidence?.dataStatus !== 'partial' ||
    !String(m6665.runtimeGapEvidence?.remainingBoundary || '').includes(
      'equipment/loadout',
    ) ||
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
      '6665 虚空天生 must be blocked_runtime/partial/generic_runtime with controlled 5s synthetic completedBoundary + equipment/loadout remaining runtimeGap and wasm/backend evidence refs',
    );
  }
  if (
    !mKaisaP ||
    mKaisaP.status !== 'ready_to_implement' ||
    mKaisaP.completionMode !== 'none' ||
    mKaisaP.blocker
  ) {
    errors.push('Kaisa P must be ready_to_implement/none with Wiki numeric contract (no data blocker)');
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
      'historical_candidate_rank_table_8_17_26_35_44_vs_executable_rank1_8_current_tooltip_unresolved'
  ) {
    errors.push(
      'Varus W must be blocked_data/none with historical candidate rank-table vs executable rank1-8 / unresolved current tooltip blocker',
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
  if (!mAkshanP || mAkshanP.status !== 'ready_to_implement' || mAkshanP.completionMode !== 'none') {
    errors.push('Akshan P must be ready_to_implement/none (Wiki damage contract complete)');
  }
  if (
    !mAkshanE ||
    mAkshanE.status !== 'blocked_runtime' ||
    mAkshanE.completionMode !== 'none' ||
    mAkshanE.blocker !== 'swing_periodic_shot_scheduling+as_scaled_per_shot_damage+hook_attach_terrain_path'
  ) {
    errors.push('Akshan E must be blocked_runtime/none with swing/shot scheduling blocker');
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
    mGravesP.status !== 'blocked_data' ||
    mGravesP.completionMode !== 'none' ||
    mGravesP.blocker !== 'wiki_explicit_unknown_precise_reload_speed_formula' ||
    !mGravesP.dataGapEvidence?.missingFields?.includes('precise_reload_speed_formula')
  ) {
    errors.push(
      'Graves P must be blocked_data/none with wiki_explicit_unknown precise reload formula only',
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
    mDravenW.status !== 'blocked_runtime' ||
    mDravenW.completionMode !== 'partial' ||
    mDravenW.lane !== 'generic_runtime' ||
    mDravenW.blocker !== 'axe_caught_event_ability_cooldown_reset' ||
    !(mDravenW.evidenceRefs || []).some(
      (e) =>
        e.taskKey === 'wasm-generic-draven-blood-rush' &&
        e.sourcePath === 'wasm/tinygo_engine_v2/internal/runtime/generic_draven_blood_rush_test.go' &&
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
      'Draven W 血性冲刺 must be blocked_runtime/partial with axe_caught_event_ability_cooldown_reset blocker and wasm/backend evidence refs',
    );
  }
  if (
    !mQuinnW ||
    mQuinnW.status !== 'blocked_runtime' ||
    mQuinnW.completionMode !== 'partial' ||
    mQuinnW.lane !== 'generic_runtime' ||
    mQuinnW.blocker !== 'harrier_vulnerable_produce_consume_and_bonus_damage' ||
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
      'Quinn W 敏锐感知 must be blocked_runtime/partial with harrier_vulnerable_produce_consume_and_bonus_damage blocker and wasm/backend evidence refs',
    );
  }
  if (
    !mXayahW ||
    mXayahW.status !== 'blocked_runtime' ||
    mXayahW.completionMode !== 'partial' ||
    mXayahW.lane !== 'generic_runtime' ||
    mXayahW.blocker !==
      'secondary_feather_settled_basic_attack_damage_ratio_copy_excluding_on_hit_phantom' ||
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
      'Xayah W 致死羽衣 must be blocked_runtime/partial with secondary_feather_settled_basic_attack_damage_ratio_copy_excluding_on_hit_phantom blocker and wasm/backend evidence refs',
    );
  }
  if (!m3748a || m3748a.status !== 'out_of_scope' || m3748a.completionMode !== 'partial') {
    errors.push('3748 顺劈 71fa0f0c must be out_of_scope/partial');
  }
  if (!m3748b || m3748b.status !== 'out_of_scope' || m3748b.completionMode !== 'partial') {
    errors.push('3748 顺劈 020f8b5a must be out_of_scope/partial');
  }

  const sc = inv.summary?.statusCounts || {};
  const expectedStatus = {
    completed: 30,
    partial_actionable: 0,
    ready_to_implement: 2,
    blocked_runtime: 29,
    blocked_data: 118,
    out_of_scope: 70,
    regression_only: 5,
    stale_or_duplicate: 0,
  };
  for (const [k, v] of Object.entries(expectedStatus)) {
    if ((sc[k] || 0) !== v) errors.push(`statusCounts.${k} expected ${v}, got ${sc[k] || 0}`);
  }
  if ((inv.summary?.actionableKeyCount || 0) !== 2) {
    errors.push(`actionableKeyCount expected 2, got ${inv.summary?.actionableKeyCount}`);
  }
  const expectedActionable = [
    'hero_skill|hero_akshan|P|无所不用',
    'hero_skill|hero_kaisa|P|体表活肤',
  ];
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
  if ((cm.full || 0) !== 30 || (cm.partial || 0) !== 9 || (cm.none || 0) !== 215) {
    errors.push(
      `completionModeCounts expected full=30 partial=9 none=215, got full=${cm.full} partial=${cm.partial} none=${cm.none}`,
    );
  }


  // blocked_runtime must carry precise runtimeGapEvidence (non-empty missingPrimitives).
  const blockedRuntimeRows = (inv.mechanisms || []).filter((m) => m.status === 'blocked_runtime');
  if (blockedRuntimeRows.length !== 29) {
    errors.push(`blocked_runtime rows expected 29, got ${blockedRuntimeRows.length}`);
  }
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

  // blocked_data must carry precise, non-implementation data-gap evidence.
  const blockedDataRows = (inv.mechanisms || []).filter((m) => m.status === 'blocked_data');
  if (blockedDataRows.length !== 118) {
    errors.push(`blocked_data rows expected 118, got ${blockedDataRows.length}`);
  }
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
  }
  const bdHero = blockedDataRows.filter((m) => m.sourceKind === 'hero_skill').length;
  const bdItem = blockedDataRows.filter((m) => m.sourceKind === 'item_passive').length;
  if (bdHero !== 117 || bdItem !== 1) {
    errors.push(`blocked_data by kind expected hero_skill=117 item_passive=1, got ${bdHero}/${bdItem}`);
  }

  const mYunaraR = inv.mechanisms.find((m) => m.key === 'hero_skill|hero_yunara|R|定圣诀');
  if (
    !mYunaraR
    || mYunaraR.status !== 'blocked_data'
    || mYunaraR.completionMode !== 'none'
    || !mYunaraR.dataGapEvidence?.missingFields?.includes('tooltip:buff_duration')
    || !mYunaraR.dataGapEvidence?.missingFields?.some((f) => String(f).includes('calc_rw_damage'))
    || !mYunaraR.dataGapEvidence?.missingFields?.some((f) => String(f).includes('calc_damage'))
  ) {
    errors.push(
      'Yunara R 定圣诀 must be blocked_data/none with dataGapEvidence covering buff_duration and Q/W transcendent formulas',
    );
  }

  // Final OOS must carry structured outOfScopeEvidence; damage-signal rows only via a–e.
  const oosRows = (inv.mechanisms || []).filter((m) => m.status === 'out_of_scope');
  if (oosRows.length !== 70) {
    errors.push(`out_of_scope rows expected 70, got ${oosRows.length}`);
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
    const disposition = String(ev.damageRelevantSubBranchDisposition || '');
    if (!disposition) {
      errors.push(`out_of_scope damageRelevantSubBranchDisposition empty @ ${m.key}`);
    }
    const cat = String(ev.boundaryCategory || '');
    const summary = String(ev.sourceTextSummary || '');
    const reasonBlob = `${ev.boundaryReason || ''}|${m.reason || ''}`;
    if (cat === 'pure_movement_or_dash') {
      if (!/移动|移速|冲刺|跃迁|位移|幽灵/.test(summary)) {
        errors.push(`pure_movement_or_dash sourceTextSummary missing move semantics @ ${m.key}`);
      }
      if (
        PRIMARY_DAMAGE_DEAL_RE.test(summary)
        && !POST_DAMAGE_UTILITY_ONLY_RE.test(summary)
        && disposition !== 'trigger_phrase_no_damage_amp'
      ) {
        errors.push(`pure_movement_or_dash has untreated primary damage @ ${m.key}`);
      }
    }
    if (cat === 'other_targets_only') {
      if (!/额外目标|附近的敌人|周围的敌人|主目标不受|身后/.test(`${summary}|${reasonBlob}`)) {
        errors.push(`other_targets_only missing primary-unaffected evidence @ ${m.key}`);
      }
    }
    if (cat === 'pure_vision') {
      if (!/视野|守卫|显形|伪装|侦察|鹰|黑雾/.test(summary)) {
        errors.push(`pure_vision sourceTextSummary missing vision semantics @ ${m.key}`);
      }
      if (
        PRIMARY_DAMAGE_DEAL_RE.test(summary)
        && !/守卫|陷阱/.test(summary)
      ) {
        errors.push(`pure_vision must not include champion damage @ ${m.key}`);
      }
    }
    if (cat === 'economy_or_post_takedown') {
      if (!/击杀|阵亡|takedown|赏金|金币|encounter 已结束|主目标死亡/.test(reasonBlob)) {
        errors.push(`economy_or_post_takedown reason must state post-takedown encounter end @ ${m.key}`);
      }
    }
    // Prefer G8 sourceText when available via sourceTextSummary already stored;
    // validate damage-signal gate against sourceTextSummary + reason.
    const signalBlob = `${ev.sourceTextSummary || ''}|${m.reason || ''}`;
    if (
      DAMAGE_RELATED_SIGNAL_RE.test(signalBlob)
      && !OOS_DAMAGE_SIGNAL_DISPOSITIONS.has(disposition)
    ) {
      errors.push(
        `out_of_scope has damage-related signal but disposition not in a–e @ ${m.key}: ${disposition}`,
      );
    }
  }
  if (oosOmnibusReason !== 0) {
    errors.push(`OOS generic omnibus reason count expected 0, got ${oosOmnibusReason}`);
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

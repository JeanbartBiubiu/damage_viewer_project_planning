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
};

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
};

function evidence(evidenceType, taskKey, sourcePath, note) {
  const pathValue = sourcePath || '';
  return {
    evidenceType,
    taskKey: taskKey || '',
    sourcePath: pathValue,
    // backend-root-relative sourcePath is resolvable only with an explicit worktree qualifier
    sourceWorktree: pathValue ? 'backend' : '',
    note: note || '',
  };
}

/** exact override: ownerId+skillKey or ownerId+passiveName */
const EXACT_OVERRIDES = new Map([
  [
    'hero_vayne|W',
    {
      classification: 'migrated',
      tags: ['every_n_hit', 'true_damage', 'formula_on_hit'],
      reason: '精确 candidate 已有 generic seed/mount，且 wasm-generic-vayne-silver-bolts 批次闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-vayne-silver-bolts',
          SEED.vayne,
          'Vayne W 圣银弩箭 provider/mount + live publish/E2E',
        ),
      ],
    },
  ],
  [
    'hero_kogmaw|W',
    {
      classification: 'migrated',
      tags: ['on_hit', 'target_max_hp_ratio', 'formula_on_hit'],
      reason: '精确 candidate 已纳入 wasm-generic-formula-onhit-batch（KogMaw W rank5 主目标 on-hit）。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-formula-onhit-batch',
          SEED.formulaOnHit,
          'KogMaw W bio-arcane barrage main-target formula on-hit',
        ),
      ],
    },
  ],
  [
    'hero_teemo|E',
    {
      classification: 'migrated',
      tags: ['on_hit', 'flat_magic_damage', 'formula_on_hit'],
      reason: '精确 candidate 已纳入 wasm-generic-formula-onhit-batch（Teemo E 即时 on-hit；DoT 非本批）。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-formula-onhit-batch',
          SEED.formulaOnHit,
          'Teemo E toxic shot immediate on-hit (DoT out of this batch)',
        ),
      ],
    },
  ],
  [
    '3115|艾卡西亚之咬',
    {
      classification: 'migrated',
      tags: ['on_hit', 'ap_ratio', 'formula_on_hit'],
      reason: 'item 3115 on-hit 已由 formula-onhit 批次 seed/mount。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-formula-onhit-batch',
          SEED.formulaOnHit,
          'Nashor Tooth Icathian Bite main-target on-hit',
        ),
      ],
    },
  ],
  [
    '3181|船长',
    {
      classification: 'migrated',
      tags: ['every_n_hit', 'on_hit', 'formula_on_hit'],
      reason: 'item 3181 主目标 every-5th on-hit 已由 formula-onhit 批次 seed/mount。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-formula-onhit-batch',
          SEED.formulaOnHit,
          'Hullbreaker Skipper every-5th main-target damage',
        ),
      ],
    },
  ],
  [
    '3302|晦影',
    {
      classification: 'migrated',
      tags: ['on_hit', 'flat_magic_damage', 'formula_on_hit'],
      reason: 'item 3302 晦影 on-hit 已由 formula-onhit 批次 seed/mount。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-formula-onhit-batch',
          SEED.formulaOnHit,
          'Terminus Shadow flat magic on-hit',
        ),
      ],
    },
  ],
  [
    '3124|怨怒',
    {
      classification: 'migrated',
      tags: ['on_hit', 'flat_magic_damage'],
      reason: 'item 3124 怨怒 on-hit 已由 adc-item-passives-base seed/mount。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-adc-item-passives-base',
          SEED.adcItemOnHit,
          'Guinsoo Wrath flat magic on-hit',
        ),
      ],
    },
  ],
  [
    '3153|雾之锋',
    {
      classification: 'migrated',
      tags: ['on_hit', 'target_current_hp_ratio'],
      reason: 'item 3153 雾之锋 on-hit 已由 adc-item-passives-base seed/mount。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-adc-item-passives-base',
          SEED.adcItemOnHit,
          'BotRK Mist\'s Edge current-HP on-hit',
        ),
      ],
    },
  ],
  [
    '3124|沸腾打击',
    {
      classification: 'migrated',
      tags: ['stacking_stat_modifier_on_hit', 'phantom_hit_on_hit_repeat'],
      reason: 'item 3124 沸腾打击 stacking + phantom repeat 已由 guinsoo-hk 批次 seed/mount。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-guinsoo-hk',
          SEED.guinsoo,
          'Guinsoo boiling strike stacks + phantom repeat',
        ),
      ],
    },
  ],
  [
    '3078|咒刃',
    {
      classification: 'migrated',
      tags: ['spellblade_next_attack_state'],
      reason: 'item 3078 咒刃已由 wasm-generic-spellblade 批次 seed/mount。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-spellblade',
          SEED.spellblade,
          'Trinity Force Spellblade next-attack state',
        ),
      ],
    },
  ],
  [
    '3100|咒刃',
    {
      classification: 'migrated',
      tags: ['spellblade_next_attack_state'],
      reason: 'item 3100 巫妖之祸咒刃已由 wasm-generic-lich-bane-spellblade 批次闭环（含 ready AS / intervalFormula cadence）。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-lich-bane-spellblade',
          SEED.lichBaneSpellblade,
          'Lich Bane Spellblade magic next-attack + ready AS percent_add',
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
          SEED.duskAndDawnSpellblade,
          'Dusk and Dawn Spellblade core: ability_start 10s ready; hit magic 0.75*base AD + 0.10*resolved AP; hit-started 1.5s ICD; copyable false',
        ),
      ],
    },
  ],
  [
    '6672|放倒它',
    {
      classification: 'migrated',
      tags: ['every_n_hit', 'target_missing_hp_amp'],
      reason: 'item 6672 放倒它已由 wasm-generic-adc-item-passives-base 批次 seed/mount 闭环。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-adc-item-passives-base',
          SEED.adcItemOnHit,
          'Kraken Slayer Bring It Down every-3rd missing-HP amp',
        ),
      ],
    },
  ],
  [
    '3094|神射手',
    {
      classification: 'migrated',
      tags: ['energized_charge_and_consume'],
      reason: 'item 3094 神射手已由 wasm-generic-energized 批次 seed/mount。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-energized',
          SEED.energized,
          'Rapid Firecannon Sharpshooter energized consume',
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
          SEED.statikkShivEnergized,
          'Statikk Shiv 电疗: +15 charge (cap 100), 60 magic damage on ready; source-owner basic_attack_hit; conditional consume then unconditional recharge',
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
          SEED.yunTalPracticeMakesLethal,
          'Yun Tal 熟能生巧: every source-owner ORIGINAL basic_attack_hit permanently +1 practice_crit_stacks (max 63); crit chance dynamic min(0.25, 0.004 * state); only phantom/copied-on-hit replay(s) do not add stacks',
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
          SEED.witsEndFray,
          'Wits End Fray: source-owner ORIGINAL basic_attack_hit deals constant 45 bonus magic on-hit; copyable_on_hit=true; Guinsoo phantom/copied-on-hit replay may duplicate exactly once without recursion; lifesteal metadata not modeled',
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
          SEED.manamuneAwe,
          'Manamune Awe: source-only passive dynamically adds AD as 0.02 * source.attr.mana.max; tests at max mana 0/1000/2000 yield +0/+20/+40; no event/state',
        ),
      ],
    },
  ],
  [
    '6676|死',
    {
      classification: 'migrated',
      tags: ['execute_threshold'],
      reason: 'item 6676 死/execute 已由 wasm-generic-execute-threshold 批次 seed/mount。',
      remainingGap: '',
      coverageEvidence: [
        evidence(
          'generic_batch',
          'wasm-generic-execute-threshold',
          SEED.execute,
          'Collector Death execute threshold',
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
          SEED.linked,
          'Black Cleaver Carve linked armor shred (partial timing semantics)',
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
          'wasm-generic-formula-onhit-batch',
          SEED.formulaOnHit,
          'Titanic Hydra primary-target on-hit only',
        ),
      ],
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
      remainingGap: '缺 Akshan P 主目标 every-3rd-hit 精确 provider seed/live publish/E2E。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === 'hero_caitlyn' && c.skillKey === 'P',
    result: {
      classification: 'blocked',
      tags: ['on_hit', 'crit_scaling'],
      reason: '旧规则因关键词误判为 out_of_scope，但含主目标爆头伤害；缺精确 generic seed/mount。',
      remainingGap: '缺 Caitlyn P Headshot 主目标伤害精确 provider seed/live publish/E2E。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === 'hero_aphelios' && c.skillKey === 'Q' && c.passiveName === '武器技能',
    result: {
      classification: 'blocked',
      tags: ['composite_weapon_skill', 'primary_target_attack_branch', 'weapon_state'],
      reason: 'Aphelios Q 武器技能为复合武器技能，含主目标攻击分支；旧 multi_target 标签不得整条 out_of_scope。',
      remainingGap: '缺精确武器状态/provider/runtime 基线与 seed/mount/live publish/E2E。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === '3032' && c.passiveName === '疾风骤雨',
    result: {
      classification: 'blocked',
      tags: ['timed_attack_speed_modifier', 'attack_crit_cooldown_interaction'],
      reason: '育恩塔尔疾风骤雨为攻击触发的定时 30% 攻速修正，并含攻击/暴击冷却交互；非纯冷却轮转。',
      remainingGap: '缺精确定时条件攻速/暴击冷却状态机与 provider seed/mount/live publish/E2E。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === '6610' && c.passiveName === '光盾打击',
    result: {
      classification: 'blocked',
      tags: ['conditional_guaranteed_crit', 'first_attack', 'heal'],
      reason: '焚天光盾打击：对英雄第一次攻击为条件性必定暴击并治疗；expected-crit 不实现条件必定暴击语义，且含治疗分支不得整条 survivability out_of_scope。',
      remainingGap: '缺精确条件必定暴击状态/provider seed 与 E2E；不得用 expected-crit 冒充完成。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === 'hero_draven' && c.skillKey === 'W' && c.passiveName === '血性冲刺',
    result: {
      classification: 'blocked',
      tags: ['timed_attack_speed_buff', 'catch_cooldown_reset'],
      reason: 'Draven W 血性冲刺为定时主动攻速增益，并含接斧冷却刷新；旧 meta 标签不得整条 out_of_scope。',
      remainingGap: '缺精确 ability/cadence 状态与 provider seed/mount/live publish/E2E。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === 'hero_kaisa' && c.skillKey === 'E' && c.passiveName === '极限超载',
    result: {
      classification: 'blocked',
      tags: ['cast_triggered_timed_attack_speed'],
      reason: 'Kai\'Sa E 极限超载为施法触发的定时攻速分支；旧 meta 标签不得整条 out_of_scope。',
      remainingGap: '缺精确 ability/cadence 状态与 provider seed/mount/live publish/E2E。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => c.ownerId === 'hero_quinn' && c.skillKey === 'W' && c.passiveName === '敏锐感知',
    result: {
      classification: 'blocked',
      tags: ['target_state_conditioned_attack_speed', 'vulnerable'],
      reason: 'Quinn W 敏锐感知：攻击易损目标提供攻速；属目标状态条件 cadence，旧 meta 标签不得整条 out_of_scope。',
      remainingGap: '缺目标状态条件 cadence 行为与精确 provider seed/mount/live publish/E2E。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => (c.mechanismTags || []).includes('seeded_random_crit_sequence'),
    result: {
      classification: 'blocked',
      tags: ['seeded_random_crit_sequence'],
      reason: 'seeded_random_crit_sequence：expected crit 不证明 RNG/on-crit 序列语义。',
      remainingGap: '缺 seeded/random/on-crit 序列 runtime 与精确 seed；不得用 expected-crit 冒充完成。',
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
      remainingGap: '缺距离输入或复杂倍率/生命比例基线与精确 provider seed。',
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
      remainingGap: '缺该 candidate 精确 spellblade provider seed/mount/live publish/E2E。',
      coverageEvidence: [],
    },
  },
  {
    match: (c) => {
      const tags = c.mechanismTags || [];
      if (!tags.includes('energized_charge_and_consume')) return false;
      if (c.ownerId === '3094' && c.passiveName === '神射手') return false;
      return true;
    },
    result: {
      classification: 'blocked',
      tags: ['energized_charge_and_consume'],
      reason: 'energized 除 item 3094 神射手外全部 blocked；同机制代表完成不等于本 candidate 已 seed。',
      remainingGap: '缺该 candidate 精确 energized provider seed/mount/live publish/E2E。',
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
      remainingGap: '缺该 candidate 精确 stacking modifier seed/mount；不得因 Guinsoo/黑切代表完成而 partial。',
      coverageEvidence: [],
    },
  },
];

const DAMAGE_SIGNAL_RE =
  /伤害|普攻|斩杀|处决|攻击特效|真实伤害|物理伤害|魔法伤害|额外伤害|每第[一二三四五六七八九十零〇两\d]+次|暴击伤害|造成\d|命中造成/;

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

function exactKeyOwnerSkill(c) {
  return `${c.ownerId}|${c.skillKey}`;
}

function exactKeyOwnerPassive(c) {
  return `${c.ownerId}|${c.passiveName}`;
}

function exactOverrideFor(c) {
  return (
    EXACT_OVERRIDES.get(exactKeyOwnerSkill(c))
    || EXACT_OVERRIDES.get(exactKeyOwnerPassive(c))
    || null
  );
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
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

function hasDamageSignal(text) {
  return DAMAGE_SIGNAL_RE.test(String(text || ''));
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
      return {
        classification: 'out_of_scope',
        tags: tags.length ? tags : ['audit_boundary'],
        reason: '文本为纯 meta/economy/vision/building/revive、纯生存、纯控制、纯冷却/主动轮转或纯额外目标收益；当前 ADC 被动 1v1 单目标伤害审计边界外。',
        remainingGap: '',
        coverageEvidence: [],
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
    return {
      classification: 'out_of_scope',
      tags: tags.length ? tags : ['audit_boundary'],
      reason: '当前 ADC 被动 1v1 单目标伤害审计边界外。',
      remainingGap: '',
      coverageEvidence: [],
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

function classifyCandidate(c) {
  const exact = exactOverrideFor(c);
  if (exact) {
    return {
      ...exact,
      tags: exact.tags || c.mechanismTags || [],
    };
  }

  for (const ex of COMPONENT_EXCEPTIONS) {
    if (ex.match(c)) {
      return {
        ...ex.result,
        tags: ex.result.tags || c.mechanismTags || [],
      };
    }
  }

  return classifyFallback(c);
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
    const classified = classifyCandidate(c);
    return {
      ...c,
      candidateKey: candidateKeys[index],
      genericClassification: classified.classification,
      genericMechanismTags: classified.tags,
      classificationReason: classified.reason,
      coverageEvidence: classified.coverageEvidence || [],
      remainingGap: classified.remainingGap || '',
    };
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
    // rebuild csv and compare
    const expectedCsv = toCsv(toCsvRows(audit));
    const actualCsv = fs.readFileSync(paths.outputCsv, 'utf8');
    if (actualCsv !== expectedCsv) {
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

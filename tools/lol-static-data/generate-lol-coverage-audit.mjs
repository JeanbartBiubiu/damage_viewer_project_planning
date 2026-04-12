#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const snapshotRoot = path.join(
  repoRoot,
  '文档记录',
  '详细设计',
  '最小验证',
  '数据',
  'lol_竞技场静态文本快照',
);

const OUTPUTS = {
  champion: path.join(repoRoot, '文档记录', '需求澄清', 'wasm', 'LoL竞技场全量覆盖审计-英雄.md'),
  item: path.join(repoRoot, '文档记录', '需求澄清', 'wasm', 'LoL竞技场全量覆盖审计-装备.md'),
  rune: path.join(repoRoot, '文档记录', '需求澄清', 'wasm', 'LoL竞技场全量覆盖审计-符文.md'),
  augment: path.join(repoRoot, '文档记录', '需求澄清', 'wasm', 'LoL竞技场全量覆盖审计-海克斯强化.md'),
};

const DOC_META = {
  champion: {
    title: 'LoL竞技场全量覆盖审计-英雄',
    scope: '英雄被动与技能按原子 entry 审计',
    columns: ['entryId', 'ownerId', 'skillSlot', 'entryNameZh', 'primaryGroup', 'scopeAssessment', 'runtimeLayer', 'templateOrModel', 'coverageVerdict', 'gapOrConversionNote', 'sourceRef'],
    sharedFields: ['formula / sustain / trigger / mark / attr / tempo / counter / history / control / filter'],
    categoryFields: ['ownerId', 'skillSlot: P / Q / W / E / R / A', 'isPassive'],
    notes: [
      '英雄必须按被动与技能拆 entry，不按整英雄合并判断。',
      '阿卡丽 E1/E2、伊芙琳 W、布隆与布兰德计数器等已按前序结论做 override，不重复展开。',
    ],
  },
  item: {
    title: 'LoL竞技场全量覆盖审计-装备',
    scope: '装备按单实体 entry 审计',
    columns: ['entryId', 'entryNameZh', 'slotKind', 'primaryGroup', 'scopeAssessment', 'runtimeLayer', 'templateOrModel', 'coverageVerdict', 'gapOrConversionNote', 'sourceRef'],
    sharedFields: ['formula / sustain / trigger / mark / attr / tempo / counter / history / control / filter'],
    categoryFields: ['slotKind: stat_only / passive / active / mixed', 'itemTags'],
    notes: [
      '装备常把面板属性、主动、被动写在同一条文本里；必要时在备注里拆分判断。',
      '源数据优先于旧索引，若旧文档样本 id 与快照不一致，以快照为准。',
    ],
  },
  rune: {
    title: 'LoL竞技场全量覆盖审计-符文',
    scope: '符文按单实体 entry 审计',
    columns: ['entryId', 'entryNameZh', 'runeTree', 'slotIndex', 'primaryGroup', 'scopeAssessment', 'runtimeLayer', 'templateOrModel', 'coverageVerdict', 'gapOrConversionNote', 'sourceRef'],
    sharedFields: ['formula / sustain / trigger / mark / attr / tempo / counter / history / control / filter'],
    categoryFields: ['runeTree', 'slotIndex', 'runeTier'],
    notes: [
      '符文天然带路径和槽位层级，检索时不能只靠名字。',
      '如果符文主要表达基础属性，优先落到属性层，不额外发明新模板。',
    ],
  },
  augment: {
    title: 'LoL竞技场全量覆盖审计-海克斯强化',
    scope: '海克斯强化按单实体 entry 审计',
    columns: ['entryId', 'entryNameZh', 'apiName', 'rarity', 'primaryGroup', 'scopeAssessment', 'runtimeLayer', 'templateOrModel', 'coverageVerdict', 'gapOrConversionNote', 'sourceRef'],
    sharedFields: ['formula / sustain / trigger / mark / attr / tempo / counter / history / control / filter'],
    categoryFields: ['apiName', 'rarity', 'dataValueKeys'],
    notes: [
      '海克斯强化后续可能需要按稀有度和内部 API 名批量筛选。',
      '当前先做覆盖审计，不提前进入模式规则草案。',
    ],
  },
};

const GROUP_BY_TEMPLATE = new Map([
  ['damage_memory_window', '历史值与时间窗口'],
  ['damage_memory_window + consume_to_shield_damage', '历史值与时间窗口'],
  ['gray_health_window + recast_burst', '历史值与时间窗口'],
  ['damage_exchange_memory + consume_to_shield_heal', '历史值与时间窗口'],
  ['damage_memory_window + cleanse_cc', '历史值与时间窗口'],
  ['state_snapshot_rewind', '历史值与时间窗口'],
  ['control_apply', '控制效果与锁窗'],
  ['control_apply + control_immunity_window', '控制效果与锁窗'],
  ['control_apply + per_target_lockout', '控制效果与锁窗'],
  ['per_target_lockout', '控制效果与锁窗'],
  ['per_target_lockout + damage_ramp', '控制效果与锁窗'],
  ['control_immunity_window', '控制效果与锁窗'],
  ['defensive_window', '控制效果与锁窗'],
  ['defensive_window + damage_taken_modifier', '控制效果与锁窗'],
  ['counter_state + stack_threshold_proc + defensive_window', '控制效果与锁窗'],
  ['crit_policy_gap', '暴击资格与暴击策略'],
  ['damage_formula_base', '比例与阈值'],
  ['damage_formula_ratio', '比例与阈值'],
  ['damage_formula_threshold', '比例与阈值'],
  ['damage_taken_modifier', '比例与阈值'],
  ['execute_threshold', '比例与阈值'],
  ['shield_granted_proc', '护盾治疗吸血'],
  ['heal_on_hit', '护盾治疗吸血'],
  ['lifesteal', '护盾治疗吸血'],
  ['overheal_to_shield', '护盾治疗吸血'],
  ['lifesteal + overheal_to_shield', '护盾治疗吸血'],
  ['mark_state', '命中触发与标记结算'],
  ['mark_state + mark_arm + mark_consume', '命中触发与标记结算'],
  ['mark_state + mark_refresh_or_unlock', '命中触发与标记结算'],
  ['mark_state + skill_gate_on_mark', '命中触发与标记结算'],
  ['stored_damage_on_mark', '命中触发与标记结算'],
  ['on_hit_proc', '命中触发与标记结算'],
  ['damage_echo', '命中触发与标记结算'],
  ['cast_stage', '资源与节奏'],
  ['remaining_charges', '资源与节奏'],
  ['remaining_charges + grant_charge', '资源与节奏'],
  ['refund_cooldown', '资源与节奏'],
  ['reset_skill_cd', '资源与节奏'],
  ['resource_gate', '资源与节奏'],
  ['refund_cooldown + duration_extend', '资源与节奏'],
  ['counter_state', '叠层与时效'],
  ['counter_state + lockout_window', '叠层与时效'],
  ['counter_state + stack_to_stat', '叠层与时效'],
  ['counter_seed + stack_threshold_proc', '叠层与时效'],
  ['counter_state + stack_threshold_proc', '叠层与时效'],
  ['counter_state + stack_threshold_proc + lockout_window', '叠层与时效'],
  ['counter_state + stack_threshold_proc + periodic_proc', '叠层与时效'],
  ['periodic_proc', '叠层与时效'],
  ['flat_stat_bonus', '基础属性加成'],
  ['derived_stat_from_attrs', '属性派生与穿透顺序'],
  ['stack_to_stat', '属性派生与穿透顺序'],
  ['penetration_modifier', '属性派生与穿透顺序'],
  ['adaptive_force', '属性派生与穿透顺序'],
  ['incoming_damage_split_gap', '比例与阈值'],
  ['ability_on_hit_bridge_gap', '命中触发与标记结算'],
  ['invulnerable_window_gap', '比例与阈值'],
  ['filter_loadout_meta', '需过滤或待人工归类'],
  ['filter_shop_anvil_meta', '需过滤或待人工归类'],
  ['filter_random_bundle_meta', '需过滤或待人工归类'],
  ['filter_debug_placeholder', '需过滤或待人工归类'],
  ['filter_precombat_mobility', '需过滤或待人工归类'],
  ['filter_cc_only', '需过滤或待人工归类'],
  ['filter_consumable_meta', '需过滤或待人工归类'],
  ['filter_mobility_spell_replace', '需过滤或待人工归类'],
  ['filter_out_of_scope', '需过滤或待人工归类'],
  ['manual_review', '需过滤或待人工归类'],
]);

const GROUP_BY_RUNTIME = {
  formula: '比例与阈值',
  sustain: '护盾治疗吸血',
  trigger: '命中触发与标记结算',
  mark: '命中触发与标记结算',
  tempo: '资源与节奏',
  counter: '叠层与时效',
  attr: '属性派生与穿透顺序',
  history: '历史值与时间窗口',
  control: '控制效果与锁窗',
  filter: '需过滤或待人工归类',
};

const __CLI_ARGS = new Set(process.argv.slice(2));
const shouldWrite = __CLI_ARGS.has('--write');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function stripMarkup(text) {
  return String(text ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<li>/gi, ' ')
    .replace(/<\/li>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{[^}]+\}\}/g, ' ')
    .replace(/@[^@]+@/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function md(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

function buildChampionEntries(championZh, championEn) {
  const entries = [];
  for (const championId of Object.keys(championZh.data)) {
    const zh = championZh.data[championId];
    const en = championEn.data[championId];
    entries.push({
      category: 'champion',
      entryId: `champion:${championId}:passive`,
      ownerId: championId,
      ownerNameZh: zh.name,
      entryNameZh: zh.passive?.name ?? '',
      skillSlot: 'P',
      isPassive: true,
      text: `${stripMarkup(zh.passive?.description)}\n${stripMarkup(en.passive?.description)}`.trim(),
      sourceRef: `ddragon/16.7.1/zh_CN/championFull.json#data.${championId}.passive`,
    });
    zh.spells.forEach((spellZh, index) => {
      const spellEn = en.spells[index];
      entries.push({
        category: 'champion',
        entryId: `champion:${championId}:spell:${spellZh.id}`,
        ownerId: championId,
        ownerNameZh: zh.name,
        entryNameZh: spellZh.name,
        skillSlot: ['Q', 'W', 'E', 'R'][index] ?? `S${index + 1}`,
        isPassive: false,
        text: `${stripMarkup(spellZh.description)} ${stripMarkup(spellZh.tooltip)} ${stripMarkup(spellZh.resource)}\n${stripMarkup(spellEn.description)} ${stripMarkup(spellEn.tooltip)} ${stripMarkup(spellEn.resource)}`.trim(),
        sourceRef: `ddragon/16.7.1/zh_CN/championFull.json#data.${championId}.spells[${index}]`,
      });
    });
  }
  return entries;
}

function buildItemEntries(itemZh, itemEn) {
  return Object.keys(itemZh.data).map((itemId) => {
    const zh = itemZh.data[itemId];
    const en = itemEn.data[itemId];
    return {
      category: 'item',
      entryId: `item:${itemId}`,
      itemId,
      entryNameZh: zh.name,
      itemTags: zh.tags ?? [],
      descriptionRaw: zh.description ?? '',
      text: `${stripMarkup(zh.description)} ${stripMarkup(zh.plaintext)}\n${stripMarkup(en.description)} ${stripMarkup(en.plaintext)} ${(zh.tags ?? []).join(' ')}`.trim(),
      sourceRef: `ddragon/16.7.1/zh_CN/item.json#data.${itemId}`,
    };
  });
}

function buildRuneEntries(runesZh, runesEn) {
  const entries = [];
  runesZh.forEach((treeZh, treeIndex) => {
    const treeEn = runesEn[treeIndex];
    treeZh.slots.forEach((slotZh, slotIndex) => {
      const slotEn = treeEn.slots[slotIndex];
      slotZh.runes.forEach((runeZh, runeIndex) => {
        const runeEn = slotEn.runes[runeIndex];
        entries.push({
          category: 'rune',
          entryId: `rune:${runeZh.id}`,
          entryNameZh: runeZh.name,
          runeTree: treeZh.name,
          slotIndex,
          runeTier: slotIndex === 0 ? 'keystone' : `minor_${slotIndex}`,
          text: `${stripMarkup(runeZh.shortDesc)} ${stripMarkup(runeZh.longDesc)}\n${stripMarkup(runeEn.shortDesc)} ${stripMarkup(runeEn.longDesc)}`.trim(),
          sourceRef: `ddragon/16.7.1/zh_CN/runesReforged.json#tree[${treeIndex}].slot[${slotIndex}].rune[${runeIndex}]`,
        });
      });
    });
  });
  return entries;
}

function buildAugmentEntries(arenaZh, arenaEn) {
  return arenaZh.augments.map((augmentZh, index) => {
    const augmentEn = arenaEn.augments[index];
    return {
      category: 'augment',
      entryId: `augment:${augmentZh.id}`,
      entryNameZh: augmentZh.name,
      apiName: augmentZh.apiName,
      rarity: augmentZh.rarity,
      dataValueKeys: Object.keys(augmentZh.dataValues ?? {}),
      text: `${stripMarkup(augmentZh.desc)} ${stripMarkup(augmentZh.tooltip)}\n${stripMarkup(augmentEn?.desc)} ${stripMarkup(augmentEn?.tooltip)} ${Object.keys(augmentZh.dataValues ?? {}).join(' ')}`.trim(),
      sourceRef: `communitydragon/latest/zh_cn/arena.json#augments[${index}]`,
    };
  });
}

const OVERRIDES = {
  'champion:Ambessa:spell:AmbessaR': { runtimeLayer: 'control', templateOrModel: 'control_apply + control_immunity_window', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '不可阻挡突进、压制和晕眩都属于主战斗链，不能继续过滤。' },
  'champion:DrMundo:spell:DrMundoW': { runtimeLayer: 'history', templateOrModel: 'gray_health_window + recast_burst', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '最近承伤会转入灰色生命值，再通过二段施放转成爆发与治疗。' },
  'champion:Ekko:spell:EkkoR': { runtimeLayer: 'history', templateOrModel: 'state_snapshot_rewind', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '需要读取过去数秒的位置与生命值快照，再回溯并结算治疗。' },
  'champion:Graves:spell:GravesMove': { runtimeLayer: 'tempo', templateOrModel: 'refund_cooldown', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '命中会缩短冷却并刷新防御属性，不属于最近承伤记忆。' },
  'champion:Heimerdinger:spell:HeimerdingerR': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '核心语义是下一个基础技能升级，不是黑默丁格本人进入控制免疫窗口。' },
  'champion:Jhin:spell:JhinW': { runtimeLayer: 'control', templateOrModel: 'control_apply', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '主效果是远程伤害加禁锢；禁锢前置条件需要 recent damage gate，且 ally/trap 分支后续再拆。' },
  'champion:Malphite:spell:UFSlash': { runtimeLayer: 'control', templateOrModel: 'control_apply + control_immunity_window', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '不可阻挡的位移和击飞应显式保留为控制结果态，而不是继续压成纯伤害条目。' },
  'champion:Mordekaiser:spell:MordekaiserW': { runtimeLayer: 'history', templateOrModel: 'damage_exchange_memory + consume_to_shield_heal', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '储存造成和承受的伤害，再消费为护盾和治疗。' },
  'champion:Olaf:spell:OlafRagnarok': { runtimeLayer: 'control', templateOrModel: 'control_immunity_window', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '施放时净化并在持续期间免疫这些控制，不应继续过滤。' },
  'champion:Pyke:passive': { runtimeLayer: 'history', templateOrModel: 'gray_health_window + recast_burst', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '最近承伤会转入灰色生命值，并在脱离视野后加速恢复。' },
  'champion:Rengar:spell:RengarW': { runtimeLayer: 'history', templateOrModel: 'damage_memory_window + cleanse_cc', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '基于最近承伤值回复生命，强化状态下还会解除控制。' },
  'champion:Sett:spell:SettW': { runtimeLayer: 'history', templateOrModel: 'damage_memory_window + consume_to_shield_damage', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '记录最近承受的伤害，再把窗口值消费为护盾和真实伤害。' },
  'champion:TahmKench:spell:TahmKenchE': { runtimeLayer: 'history', templateOrModel: 'gray_health_window + recast_burst', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '最近承伤会转入灰色生命值，并可在主动施放时转为护盾。' },
  'champion:Taric:spell:TaricE': { runtimeLayer: 'control', templateOrModel: 'control_apply', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '延迟后造成伤害并眩晕目标，链式控制风险不能再被压成纯伤害公式。' },
  'champion:Udyr:spell:UdyrE': { runtimeLayer: 'control', templateOrModel: 'control_apply + per_target_lockout', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '命中时眩晕目标但对同一目标有独立锁窗，觉醒状态还带控制免疫。' },
  'champion:Vi:spell:ViR': { runtimeLayer: 'control', templateOrModel: 'control_apply + control_immunity_window', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '不可阻挡的锁定突进和击飞应显式保留为控制结果态。' },
  'champion:Yasuo:spell:YasuoE': { runtimeLayer: 'control', templateOrModel: 'per_target_lockout + damage_ramp', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '对同一目标有独立冷却，连续穿刺时还会提高伤害。' },
  'champion:Aatrox:passive': { runtimeLayer: 'sustain', templateOrModel: 'heal_on_hit', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '下次普攻附伤并按目标最大生命值治疗。' },
  'champion:Akali:spell:AkaliE': { runtimeLayer: 'mark', templateOrModel: 'mark_state + skill_gate_on_mark', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '拆成 E1 / E2；E2 仅在目标带标记时可释放。' },
  'champion:Akali:spell:AkaliW': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '隐形、不可被选取和能量上限提升不进当前 1v1 核心链路。' },
  'champion:Alistar:spell:FerociousHowl': { runtimeLayer: 'formula', templateOrModel: 'damage_taken_modifier', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '伤害减免可并入公式层；解控部分仍属附带效果。' },
  'champion:Aphelios:spell:ApheliosW': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '主副武器切换属于 loadout / weapon mode 语义。' },
  'champion:Aphelios:spell:ApheliosE_ClientTooltipWrapper': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '武器队列系统不进入当前 1v1 公式链。' },
  'champion:Aurora:spell:AuroraW': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '隐形与参与击杀后重置并存，先过滤。' },
  'champion:Cassiopeia:passive': { runtimeLayer: 'attr', templateOrModel: 'derived_stat_from_attrs', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '移动速度加成效率修正更像属性派生倍率。' },
  'champion:Draven:spell:DravenFury': { runtimeLayer: 'tempo', templateOrModel: 'refund_cooldown', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '接住飞斧会刷新冷却，且同时提供移速与攻速。' },
  'champion:Evelynn:spell:EvelynnW': { runtimeLayer: 'mark', templateOrModel: 'mark_state + mark_arm + mark_consume', coverageVerdict: 'covered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '按主收益线建模，默认成熟前不主动打破印记。' },
  'champion:Ezreal:spell:EzrealW': { runtimeLayer: 'mark', templateOrModel: 'mark_state + mark_consume', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Irelia:spell:IreliaR': { runtimeLayer: 'mark', templateOrModel: 'mark_state + mark_refresh_or_unlock', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Zed:spell:ZedR': { runtimeLayer: 'mark', templateOrModel: 'stored_damage_on_mark', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '需要标记窗口内储伤并到期结算。' },
  'champion:Fiddlesticks:passive': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '草人替身与扫描类语义不进当前主链路。' },
  'champion:Fizz:passive': { runtimeLayer: 'formula', templateOrModel: 'damage_taken_modifier', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '固定减伤可直接落入公式层。' },
  'champion:Gangplank:passive': { runtimeLayer: 'counter', templateOrModel: 'periodic_proc', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '周期就绪后的下次近战攻击点燃目标。' },
  'champion:Gnar:passive': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '怒气到阈值后变身属于形态切换。' },
  'champion:Hecarim:passive': { runtimeLayer: 'attr', templateOrModel: 'derived_stat_from_attrs', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Heimerdinger:passive': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '与炮台邻近相关的移速不进当前主链路。' },
  'champion:Jax:passive': { runtimeLayer: 'counter', templateOrModel: 'counter_state + stack_to_stat', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '连续普攻叠加攻速。' },
  'champion:Jayce:passive': { runtimeLayer: 'attr', templateOrModel: 'flat_stat_bonus', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '切换武器后短暂获得移速。' },
  'champion:Jinx:passive': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '击杀、史诗野怪和建筑触发的狂热属于事件层。' },
  'champion:Karma:passive': { runtimeLayer: 'tempo', templateOrModel: 'refund_cooldown', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Karthus:passive': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '死亡后继续施法属于生命周期钩子。' },
  'champion:Kayle:passive': { runtimeLayer: 'counter', templateOrModel: 'counter_state + stack_to_stat', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '等级与层数共同驱动攻速、移速、射程和焰浪增强。' },
  'champion:LeeSin:passive': { runtimeLayer: 'tempo', templateOrModel: 'resource_gate', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '技能后两次攻击返还能量并提供攻速。' },
  'champion:Lucian:spell:LucianE': { runtimeLayer: 'tempo', templateOrModel: 'refund_cooldown', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Malzahar:passive': { runtimeLayer: 'control', templateOrModel: 'defensive_window + damage_taken_modifier', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '近期未受伤或未受控时获得减伤和抗控窗口，不能继续只记成减伤倍率。' },
  'champion:Aatrox:spell:AatroxQ': { runtimeLayer: 'tempo', templateOrModel: 'cast_stage', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Annie:spell:AnnieQ': { runtimeLayer: 'tempo', templateOrModel: 'refund_cooldown', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Ezreal:spell:EzrealQ': { runtimeLayer: 'tempo', templateOrModel: 'refund_cooldown', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Ahri:spell:AhriR': { runtimeLayer: 'tempo', templateOrModel: 'remaining_charges + grant_charge', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '要区分剩余次数与击杀后补充次数。' },
  'champion:Annie:passive': { runtimeLayer: 'counter', templateOrModel: 'counter_seed + stack_threshold_proc', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '起始满层通过 counter_seed 表达。' },
  'champion:Braum:passive': { runtimeLayer: 'counter', templateOrModel: 'counter_state + stack_threshold_proc + lockout_window', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '目标级计数器，第 4 层触发后进入短锁窗。' },
  'champion:Brand:passive': { runtimeLayer: 'counter', templateOrModel: 'counter_state + stack_threshold_proc + periodic_proc', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '叠层、持续灼烧与满层后爆裂需要组合表达。' },
  'champion:MasterYi:passive': { runtimeLayer: 'counter', templateOrModel: 'counter_state + stack_threshold_proc', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '每隔若干次攻击触发双重打击。' },
  'champion:MasterYi:spell:Highlander': { runtimeLayer: 'tempo', templateOrModel: 'refund_cooldown + duration_extend', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '参与击杀延长持续时间并被动减少其它技能冷却。' },
  'champion:Mordekaiser:passive': { runtimeLayer: 'counter', templateOrModel: 'counter_state + periodic_proc', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '对英雄打出 3 次攻击或技能后展开伤害光环。' },
  'champion:Nami:passive': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '为友军提供移速增益。' },
  'champion:Nidalee:spell:AspectOfTheCougar': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '豹形态切换与技能替换不进当前主链路。' },
  'champion:Pantheon:passive': { runtimeLayer: 'counter', templateOrModel: 'counter_state + stack_threshold_proc', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Renekton:passive': { runtimeLayer: 'tempo', templateOrModel: 'resource_gate', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '怒气作为技能强化门槛。' },
  'champion:Rengar:passive': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '草丛跳跃与狩猎语义涉及地形和身份条件。' },
  'champion:Singed:passive': { runtimeLayer: 'attr', templateOrModel: 'flat_stat_bonus', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '经过附近英雄时获得爆发性移速。' },
  'champion:Sivir:passive': { runtimeLayer: 'attr', templateOrModel: 'flat_stat_bonus', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Sona:spell:SonaE': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '自我加速外还包含友军光环与减速能量和弦。' },
  'champion:Soraka:passive': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '朝低血量友军移动时加速。' },
  'champion:Sylas:spell:SylasR': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '偷取敌方终极技能属于技能替换语义。' },
  'champion:Talon:spell:TalonE': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '翻越地形不进入当前 1v1 核心链路。' },
  'champion:Teemo:passive': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '隐形与草丛条件不进当前主链路。' },
  'champion:Tristana:passive': { runtimeLayer: 'attr', templateOrModel: 'flat_stat_bonus', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '随等级提升射程。' },
  'champion:Tristana:spell:TristanaQ': { runtimeLayer: 'attr', templateOrModel: 'flat_stat_bonus', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Tryndamere:passive': { runtimeLayer: 'attr', templateOrModel: 'crit_policy_gap', coverageVerdict: 'gap', scopeAssessment: 'manual_review', gapOrConversionNote: '怒气被动增加暴击几率，暴露出英雄侧 crit chance 来源与消费缺口。' },
  'champion:Tryndamere:spell:UndyingRage': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '免死属于当前明确跳过的生命周期类。' },
  'champion:Twitch:spell:TwitchVenomCask': { runtimeLayer: 'counter', templateOrModel: 'counter_state + periodic_proc', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '施加并周期增加死亡毒液层数。' },
  'champion:Varus:passive': { runtimeLayer: 'attr', templateOrModel: 'flat_stat_bonus', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '击杀或助攻后获得攻速、攻击力和法强。' },
  'champion:Vayne:passive': { runtimeLayer: 'attr', templateOrModel: 'flat_stat_bonus', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Veigar:passive': { runtimeLayer: 'attr', templateOrModel: 'stack_to_stat', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '命中、击杀与拆塔永久提高法强。' },
  'champion:Viktor:passive': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '海克斯碎片驱动技能升级，属于元层成长。' },
  'champion:Xayah:passive': { runtimeLayer: 'trigger', templateOrModel: 'on_hit_proc', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '施放技能后数次普攻穿透并留下羽毛。' },
  'champion:Yunara:spell:YunaraR': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '超凡形态下基础技能升级属于形态强化。' },
  'champion:Zoe:spell:ZoeR': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '折返位移不进入当前 1v1 核心链路。' },
  'champion:Rammus:passive': { runtimeLayer: 'attr', templateOrModel: 'derived_stat_from_attrs', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'champion:Thresh:passive': { runtimeLayer: 'attr', templateOrModel: 'stack_to_stat', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'item:3031': { runtimeLayer: 'formula', templateOrModel: 'crit_policy_gap', coverageVerdict: 'gap', scopeAssessment: 'manual_review', gapOrConversionNote: '暴击伤害倍率不是普通属性加成，而是 crit multiplier policy。' },
  'item:223031': { runtimeLayer: 'formula', templateOrModel: 'crit_policy_gap', coverageVerdict: 'gap', scopeAssessment: 'manual_review', gapOrConversionNote: '杰作无尽之刃同样直接改写暴击伤害倍率，属于 crit multiplier policy。' },
  'item:3032': { runtimeLayer: 'tempo', templateOrModel: 'refund_cooldown', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '暴击时额外缩减冷却，依赖统一 on_crit 事件。' },
  'item:3072': { runtimeLayer: 'sustain', templateOrModel: 'lifesteal + overheal_to_shield', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '生命偷取溢出治疗转护盾。' },
  'item:3035': { runtimeLayer: 'attr', templateOrModel: 'penetration_modifier', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '以原始快照为准，最后的轻语真实 id 为 3035。' },
  'item:3143': { runtimeLayer: 'formula', templateOrModel: 'crit_policy_gap', coverageVerdict: 'gap', scopeAssessment: 'manual_review', gapOrConversionNote: '减少所受暴击伤害属于防守侧 crit mitigation policy。' },
  'item:223143': { runtimeLayer: 'formula', templateOrModel: 'crit_policy_gap', coverageVerdict: 'gap', scopeAssessment: 'manual_review', gapOrConversionNote: '杰作兰顿之兆同样直接减免所受暴击伤害，属于 defender crit mitigation policy。' },
  'item:3153': { runtimeLayer: 'trigger', templateOrModel: 'on_hit_proc', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '同时含当前生命值伤害与第 3 次攻击减速，后续应支持主机制 + 次机制。' },
  'item:3144': { runtimeLayer: 'tempo', templateOrModel: 'trigger + tempo', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '主动伤害与攻击缩短冷却并存。' },
  'item:6672': { runtimeLayer: 'counter', templateOrModel: 'counter_state + damage_formula_ratio', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '第 N 次触发与已损失生命值伤害叠在一条文本里。' },
  'rune:8401': { runtimeLayer: 'sustain', templateOrModel: 'shield_granted_proc', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '需订阅护盾获得事件。' },
  'rune:8128': { runtimeLayer: 'counter', templateOrModel: 'counter_state + stack_threshold_proc + refund_cooldown', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '低血量阈值、魂层与参与击杀后的刷新混在一起。' },
  'rune:8306': { runtimeLayer: 'filter', templateOrModel: 'filter_mobility_spell_replace', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '闪现冷却期间替换为引导位移，属于召唤师技能替换与位移语义。' },
  'rune:8313': { runtimeLayer: 'filter', templateOrModel: 'filter_consumable_meta', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '按等级发放合剂，属于消耗品与成长奖励语义。' },
  'rune:8352': { runtimeLayer: 'filter', templateOrModel: 'filter_consumable_meta', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '只改写药水回复时序，属于消耗品语义。' },
  'rune:8369': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '先攻含金币收益，当前主链路外。' },
  'rune:8214': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '艾黎同时涉及友军护盾与返回锁定，先过滤。' },
  'rune:8351': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '冰川增幅含区域、多目标与友军伤害减免。' },
  'augment:92': { runtimeLayer: 'formula', templateOrModel: 'crit_policy_gap', coverageVerdict: 'gap', scopeAssessment: 'manual_review', gapOrConversionNote: '装备效果和持续伤害可以暴击，属于 packet 资格策略。' },
  'augment:118': { runtimeLayer: 'sustain', templateOrModel: 'crit_policy_gap', coverageVerdict: 'gap', scopeAssessment: 'manual_review', gapOrConversionNote: '治疗和护盾可以暴击，属于 heal/shield crit policy。' },
  'augment:226': { runtimeLayer: 'filter', templateOrModel: 'filter_shop_anvil_meta', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '属性锻造器属于 loadout 预展开奖励，不直接进入战斗时公式。' },
  'augment:10': { runtimeLayer: 'filter', templateOrModel: 'filter_precombat_mobility', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '大炮入场属于回合开场位移语义。' },
  'augment:251': { runtimeLayer: 'formula', templateOrModel: 'incoming_damage_split_gap', coverageVerdict: 'gap', scopeAssessment: 'manual_review', gapOrConversionNote: '部分所受伤害延后为持续流血，暴露 incoming damage split / delayed damage buffer 缺口。' },
  'augment:322': { runtimeLayer: 'formula', templateOrModel: 'damage_formula_base + source_packet_filter', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '只放大强化符文和装备来源的伤害，需要 packet source 过滤。' },
  'augment:88': { runtimeLayer: 'tempo', templateOrModel: 'reset_skill_cd', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '每回合一次，在施放终极技能后刷新终极技能。' },
  'augment:156': { runtimeLayer: 'filter', templateOrModel: 'filter_loadout_meta', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '任务奖励依赖装备持有与替换，属于 loadout 元层。' },
  'augment:170': { runtimeLayer: 'attr', templateOrModel: 'flat_stat_bonus', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '攻击距离视为基础战斗属性。' },
  'augment:71': { runtimeLayer: 'attr', templateOrModel: 'flat_stat_bonus', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '攻击距离视为基础战斗属性。' },
  'augment:317': { runtimeLayer: 'filter', templateOrModel: 'filter_random_bundle_meta', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '随机替换强化符文属于 loadout 元层。' },
  'augment:404': { runtimeLayer: 'filter', templateOrModel: 'filter_debug_placeholder', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '调试/占位强化，不进入主链路。' },
  'augment:405': { runtimeLayer: 'filter', templateOrModel: 'filter_debug_placeholder', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '依赖帽子占位机制的调试强化，不进入主链路。' },
  'augment:333': { runtimeLayer: 'filter', templateOrModel: 'filter_shop_anvil_meta', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '购买锻造器后升级装备属于 loadout 元层。' },
  'augment:115': { runtimeLayer: 'attr', templateOrModel: 'flat_stat_bonus', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '攻击距离视为基础战斗属性。' },
  'augment:29': { runtimeLayer: 'trigger', templateOrModel: 'ability_on_hit_bridge_gap', coverageVerdict: 'gap', scopeAssessment: 'manual_review', gapOrConversionNote: '技能施加攻击特效并带每目标冷却，暴露 ability -> on-hit bridge 缺口。' },
  'augment:62': { runtimeLayer: 'filter', templateOrModel: 'filter_random_bundle_meta', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '需在战斗前预展开为 3 个具体龙魂效果。' },
  'augment:240': { runtimeLayer: 'filter', templateOrModel: 'filter_random_bundle_meta', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '每回合突变为敌方强化属于元层替换语义。' },
  'augment:11': { runtimeLayer: 'control', templateOrModel: 'defensive_window', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '施放终极技能后获得短时 0 伤害和控制免疫窗口。' },
  'augment:112': { runtimeLayer: 'control', templateOrModel: 'control_immunity_window', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '施放终极技能后获得短时霸体/控制免疫，不应继续过滤。' },
  'augment:228': { runtimeLayer: 'filter', templateOrModel: 'filter_shop_anvil_meta', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '属性锻造器属于 loadout 预展开奖励，不直接进入战斗时公式。' },
  'augment:105': { runtimeLayer: 'filter', templateOrModel: 'filter_precombat_mobility', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '回合开场移速与受伤后失效属于进场节奏语义。' },
  'augment:3': { runtimeLayer: 'filter', templateOrModel: 'filter_debug_placeholder', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '占位强化，不进入主链路。' },
  'augment:238': { runtimeLayer: 'filter', templateOrModel: 'filter_random_bundle_meta', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '额外棱彩强化属于 meta/loadout 元层。' },
  'augment:2': { runtimeLayer: 'tempo', templateOrModel: 'item_haste_modifier', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '全局装备急速作用于所有装备技能冷却。' },
  'augment:227': { runtimeLayer: 'filter', templateOrModel: 'filter_shop_anvil_meta', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', gapOrConversionNote: '属性锻造器属于 loadout 预展开奖励，不直接进入战斗时公式。' },
  'augment:229': { runtimeLayer: 'filter', templateOrModel: 'filter_shop_anvil_meta', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '售卖装备换钱属于商店/经济层。' },
  'augment:302': { runtimeLayer: 'filter', templateOrModel: 'filter_random_bundle_meta', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '按回合换取额外强化属于 meta 元层。' },
  'augment:84': { runtimeLayer: 'attr', templateOrModel: 'penetration_modifier', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'augment:41': { runtimeLayer: 'attr', templateOrModel: 'adaptive_force', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', gapOrConversionNote: '' },
  'augment:211': { runtimeLayer: 'mark', templateOrModel: 'stored_damage_on_mark', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', gapOrConversionNote: '终极技能后对全体敌人附着死亡标记，并储伤到期引爆。' },
  'augment:309': { runtimeLayer: 'tempo', templateOrModel: 'periodic_proc + refund_cooldown', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', gapOrConversionNote: '自动施法、减速、双穿甲碎与拾取后缩冷却并存。' },
  'augment:304': { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', gapOrConversionNote: '以回合为单位换取额外棱彩强化，属于 meta 层。' },
  'augment:48': { runtimeLayer: 'formula', templateOrModel: 'crit_policy_gap', coverageVerdict: 'gap', scopeAssessment: 'manual_review', gapOrConversionNote: '技能暴击资格、暴击伤害倍率与 AP 转暴击几率属于独立 crit policy 缺口。' },
};

const LAYERS = [
  { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'skip_for_now', note: '涉及主链路外语义，先过滤。', test: (entry, t) => /召唤师技能|召唤|搭档|友军|队友|伙伴|复活|复生|复生甲|潜行|伪装|商店|金币|回合结束|装备栏|portal|ally|partner|revive|stealth|disguise|shop|gold|summoner spell/i.test(t) },
  { runtimeLayer: 'control', templateOrModel: 'control_immunity_window', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', note: '先显式保留霸体、不可阻挡和控制免疫窗口语义。', test: (entry, t) => /霸体|不可阻挡|控制免疫|免疫定身|免疫限制|unstoppable|control immune|immune to crowd control/i.test(t) },
  { runtimeLayer: 'filter', templateOrModel: 'filter_out_of_scope', coverageVerdict: 'filtered', scopeAssessment: 'needs_conversion', note: '控制、位移或区域机制先不进 1v1 核心链路。', test: (entry, t) => !/伤害|damage|治疗|shield|heal|护盾|生命偷取|吸血|穿透|标记|印记|层|stack|冷却|充能|适应之力/.test(t) && /击飞|晕眩|魅惑|嘲讽|禁锢|沉默|致盲|减速|击退|墙|区域|地带|冲刺|位移|stun|charm|taunt|silence|blind|slow|knock|zone|dash/i.test(t) },
  { runtimeLayer: 'mark', templateOrModel: 'mark_state', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '', test: (entry, t) => /标记|印记|引爆印记|消耗印记|附着|detonate|mark|brand/i.test(t) },
  { runtimeLayer: 'history', templateOrModel: 'damage_memory_window', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', note: '最近承伤、灰色生命值、豪意等应落入历史窗口。', test: (entry, t) => /最近.?秒.*受到的伤害|过去.?秒.*受到的伤害|前.?秒.*受到的伤害|灰色生命值|豪意|damage taken in the last|gray health/i.test(t) },
  { runtimeLayer: 'control', templateOrModel: 'per_target_lockout', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', note: '每目标冷却与重复施放锁窗应单独保留。', test: (entry, t) => /per-target cooldown|per target cooldown|每个目标.+冷却|对每个目标.+冷却/i.test(t) },
  { runtimeLayer: 'tempo', templateOrModel: 'remaining_charges', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', note: '可能需要区分充能、返还与重置。', test: (entry, t) => /充能|储存次数|可再次施放|再次施放|再次释放|返还冷却|冷却时间缩短|刷新冷却|重置冷却|grant charge|charges?|refund|reset cooldown/i.test(t) },
  { runtimeLayer: 'counter', templateOrModel: 'counter_state', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', note: '可能需要 seed、阈值或周期触发。', test: (entry, t) => /每第三|每第3|叠加至|叠层|层数|最多可叠加|每层|层充能|每隔|every third|stacks|stack up to|every \d+ sec/i.test(t) },
  { runtimeLayer: 'attr', templateOrModel: 'flat_stat_bonus', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '', test: (entry, t) => entry.category !== 'champion' && /攻击力|法术强度|法强|生命值|护甲|魔抗|攻击速度|攻速|暴击几率|技能急速|移动速度|ability power|attack damage|attack speed|critical strike|ability haste|movement speed|armor|magic resist/i.test(t) && !/伤害|damage|护甲穿透|法术穿透|自适应/.test(t) },
  { runtimeLayer: 'attr', templateOrModel: 'penetration_modifier', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '', test: (entry, t) => /护甲穿透|法术穿透|穿透|penetration/i.test(t) },
  { runtimeLayer: 'attr', templateOrModel: 'adaptive_force', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '', test: (entry, t) => /适应之力|adaptive force/i.test(t) },
  { runtimeLayer: 'attr', templateOrModel: 'derived_stat_from_attrs', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '', test: (entry, t) => /基于.+护甲|基于.+魔法抗性|based on.+armor|based on.+magic resist/i.test(t) },
  { runtimeLayer: 'sustain', templateOrModel: 'overheal_to_shield', coverageVerdict: 'partial', scopeAssessment: 'core_1v1', note: '过量治疗与护盾转换需要单独模板。', test: (entry, t) => /过量治疗.+护盾|溢出治疗.+护盾|overheal.+shield/i.test(t) },
  { runtimeLayer: 'sustain', templateOrModel: 'lifesteal', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '', test: (entry, t) => /生命偷取|全能吸血|lifesteal|omnivamp/i.test(t) },
  { runtimeLayer: 'sustain', templateOrModel: 'heal_on_hit', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '', test: (entry, t) => /治疗|治愈|回复生命值|恢复生命值|回复已损失生命值|healing|heal(?!th)|restore health|restores health|regenerate|regen/i.test(t) },
  { runtimeLayer: 'sustain', templateOrModel: 'shield_granted_proc', coverageVerdict: 'partial', scopeAssessment: 'needs_conversion', note: '需要护盾事件订阅。', test: (entry, t) => /护盾|shield/i.test(t) },
  { runtimeLayer: 'formula', templateOrModel: 'execute_threshold', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '', test: (entry, t) => /低于.+%|高于.+%|斩杀|execute|below .*%|above .*%/i.test(t) },
  { runtimeLayer: 'formula', templateOrModel: 'damage_formula_ratio', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '', test: (entry, t) => /最大生命值|已损失生命值|当前生命值|造成.+%已造成伤害|bonus health|missing health|current health|max health/i.test(t) },
  { runtimeLayer: 'formula', templateOrModel: 'damage_formula_base', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '', test: (entry, t) => /造成.*伤害|magic damage|physical damage|adaptive damage|true damage|deals? damage/i.test(t) },
  { runtimeLayer: 'trigger', templateOrModel: 'damage_echo', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '', test: (entry, t) => /回响|回声|连锁闪电|echo|chain lightning/i.test(t) },
  { runtimeLayer: 'trigger', templateOrModel: 'on_hit_proc', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '', test: (entry, t) => /命中时|攻击时|造成伤害时|普攻会|attack or ability|on hit|on-hit|when you damage|when hitting/i.test(t) },
];

function classifyEntry(entry) {
  const override = OVERRIDES[entry.entryId];
  if (override) {
    return finalizeClassification(override);
  }
  const text = entry.text ?? '';
  for (const layer of LAYERS) {
    if (layer.test(entry, text)) {
      return finalizeClassification(layer);
    }
  }
  if (entry.category === 'item') {
    return finalizeClassification({ runtimeLayer: 'attr', templateOrModel: 'flat_stat_bonus', coverageVerdict: 'covered', scopeAssessment: 'core_1v1', note: '默认归为基础属性加成；待后续抽样复核。' });
  }
  return finalizeClassification({ runtimeLayer: 'filter', templateOrModel: 'manual_review', coverageVerdict: 'gap', scopeAssessment: 'manual_review', note: '未命中现有模板，需要人工复核。' });
}

function finalizeClassification(input) {
  const primaryGroup = GROUP_BY_TEMPLATE.get(input.templateOrModel) ?? GROUP_BY_RUNTIME[input.runtimeLayer] ?? '需过滤或待人工归类';
  return {
    primaryGroup,
    scopeAssessment: input.scopeAssessment,
    runtimeLayer: input.runtimeLayer,
    templateOrModel: input.templateOrModel,
    coverageVerdict: input.coverageVerdict,
    gapOrConversionNote: input.gapOrConversionNote ?? input.note ?? '',
  };
}

function getItemSlotKind(entry) {
  const raw = entry.descriptionRaw ?? '';
  const hasActive = /<active>|主动/.test(raw);
  const hasPassive = /<passive>|被动/.test(raw);
  const hasStats = /<stats>|攻击力|法术强度|生命值|护甲|魔抗|暴击|攻速|技能急速|移动速度|生命偷取|法力/.test(raw + ' ' + (entry.text ?? ''));
  if (hasActive && (hasPassive || hasStats)) return 'mixed';
  if (hasActive) return 'active';
  if (hasPassive) return hasStats ? 'mixed' : 'passive';
  return 'stat_only';
}

function toDocRows(entries) {
  return entries.map((entry) => {
    const cls = classifyEntry(entry);
    if (entry.category === 'champion') {
      return {
        entryId: entry.entryId,
        ownerId: entry.ownerId,
        skillSlot: entry.skillSlot,
        entryNameZh: entry.entryNameZh,
        ...cls,
        sourceRef: entry.sourceRef,
      };
    }
    if (entry.category === 'item') {
      return {
        entryId: entry.entryId,
        entryNameZh: entry.entryNameZh,
        slotKind: getItemSlotKind(entry),
        ...cls,
        sourceRef: entry.sourceRef,
      };
    }
    if (entry.category === 'rune') {
      return {
        entryId: entry.entryId,
        entryNameZh: entry.entryNameZh,
        runeTree: entry.runeTree,
        slotIndex: entry.slotIndex,
        runeTier: entry.runeTier,
        ...cls,
        sourceRef: entry.sourceRef,
      };
    }
    return {
      entryId: entry.entryId,
      entryNameZh: entry.entryNameZh,
      apiName: entry.apiName,
      rarity: entry.rarity,
      dataValueKeys: (entry.dataValueKeys ?? []).join(','),
      ...cls,
      sourceRef: entry.sourceRef,
    };
  });
}

function buildDoc(category, rows) {
  const meta = DOC_META[category];
  const lines = [
    'TASK_KEY: wasm-lol-entity-coverage-audit',
    'DOC_TYPE: 需求澄清',
    'WORKSTREAM: wasm',
    'STATUS: tracked',
    'EXECUTION_MODEL: gpt-5.4',
    'LAST_TRACKED_AT: 2026-04-10 00:00:00',
    '',
    `# ${meta.title}`,
    '',
    '日期：2026-04-10',
    `状态：进行中`,
    `范围：${meta.scope}`,
    `基线：当前原始快照重建后共 \`${rows.length}\` 条 ${category} entries`,
    '',
    '## 共享审计字段',
    '',
    `- \`runtimeLayer\`：\`${meta.sharedFields[0]}\``,
    '- `templateOrModel`：命中的模板或状态模型',
    '- `coverageVerdict`：`covered / partial / gap / filtered`',
    '- `gapOrConversionNote`：缺口、转换条件或过滤原因',
    '',
    `## ${meta.title.replace('LoL竞技场全量覆盖审计-', '')}专属字段`,
    '',
    ...meta.categoryFields.map((field) => `- \`${field}\``),
    '',
    '## 审计表',
    '',
    `| ${meta.columns.join(' | ')} |`,
    `| ${meta.columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${meta.columns.map((column) => md(row[column])).join(' | ')} |`),
    '',
    '## 当前备注',
    '',
    ...meta.notes.map((note) => `- ${note}`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function writeOrPrint(filePath, content) {
  if (shouldWrite) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`wrote ${path.relative(repoRoot, filePath)}`);
    return;
  }
  console.log(`===== ${path.relative(repoRoot, filePath)} =====`);
  console.log(content);
}

function loadAllEntries() {
  const championZh = readJson(path.join(snapshotRoot, 'ddragon', '16.7.1', 'zh_CN', 'championFull.json'));
  const championEn = readJson(path.join(snapshotRoot, 'ddragon', '16.7.1', 'en_US', 'championFull.json'));
  const itemZh = readJson(path.join(snapshotRoot, 'ddragon', '16.7.1', 'zh_CN', 'item.json'));
  const itemEn = readJson(path.join(snapshotRoot, 'ddragon', '16.7.1', 'en_US', 'item.json'));
  const runesZh = readJson(path.join(snapshotRoot, 'ddragon', '16.7.1', 'zh_CN', 'runesReforged.json'));
  const runesEn = readJson(path.join(snapshotRoot, 'ddragon', '16.7.1', 'en_US', 'runesReforged.json'));
  const arenaZh = readJson(path.join(snapshotRoot, 'communitydragon', 'latest', 'zh_cn', 'arena.json'));
  const arenaEn = readJson(path.join(snapshotRoot, 'communitydragon', 'latest', 'en_us', 'arena.json'));
  return {
    champion: buildChampionEntries(championZh, championEn),
    item: buildItemEntries(itemZh, itemEn),
    rune: buildRuneEntries(runesZh, runesEn),
    augment: buildAugmentEntries(arenaZh, arenaEn),
  };
}

function summarize(category, rows) {
  const layerCounts = {};
  const verdictCounts = {};
  rows.forEach((row) => {
    layerCounts[row.runtimeLayer] = (layerCounts[row.runtimeLayer] ?? 0) + 1;
    verdictCounts[row.coverageVerdict] = (verdictCounts[row.coverageVerdict] ?? 0) + 1;
  });
  console.log(JSON.stringify({ category, total: rows.length, layerCounts, verdictCounts }, null, 2));
}

function main() {
  const all = loadAllEntries();
  for (const category of Object.keys(all)) {
    const rows = toDocRows(all[category]);
    const content = buildDoc(category, rows);
    writeOrPrint(OUTPUTS[category], content);
    summarize(category, rows);
  }
}

main();

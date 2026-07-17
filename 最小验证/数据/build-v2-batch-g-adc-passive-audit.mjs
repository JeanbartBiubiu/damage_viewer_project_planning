import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

const paths = {
  championIndex: path.join(repoRoot, '数据参考', 'champion.json'),
  championDir: path.join(repoRoot, '数据参考', 'champion'),
  itemIndex: path.join(repoRoot, '数据参考', 'item.json'),
  heroPassiveSeed: path.join(repoRoot, '最小验证', 'V2-Batch-B-hero-passives.seed.json'),
  adcItemSeed: path.join(repoRoot, '最小验证', 'V2-Batch-C-adc-items.seed.json'),
  itemPassiveSeed: path.join(repoRoot, '最小验证', 'V2-Batch-D-adc-item-passives.seed.json'),
  auditJson: path.join(repoRoot, '最小验证', 'V2-Batch-G-adc-passive-audit.json'),
  wikiContracts: path.join(
    repoRoot,
    '数据参考',
    'lol-wiki-current-champions',
    'normalized',
    'reviewed-contracts.json',
  ),
};

const WIKI_NUMERIC_NEED =
  '当前 League Wiki 对应 Template:Data <Champion>/<Skill> 修订中的可核验数值/公式';

const CLASSIFICATIONS = [
  'ready_to_encode',
  'already_covered',
  'needs_runtime_extension',
  'needs_manual_baseline',
  'out_of_scope_for_single_target_dps',
];

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

const ITEM_READY_OVERRIDES = new Map([
  [
    '3302:晦影',
    {
      classification: 'ready_to_encode',
      mechanismTags: ['on_hit', 'flat_magic_damage'],
      candidateDpsPassiveEffect: {
        passiveId: 'item_3302_terminus_shadow_dps_v2',
        effectId: 'item_3302_terminus_shadow_dps_v2',
        sourceCategory: 'item_passive',
        sourceId: 'item_3302_terminus_shadow_dps_v2',
        sourceType: 'item',
        triggerId: 'terminus_shadow_on_hit',
        triggerKind: 'on_basic_attack_hit',
        operations: [
          {
            kind: 'damage',
            source: 'item_3302_terminus_shadow_dps_v2',
            damageType: 'magic',
            amount: 30,
          },
        ],
      },
      blockedReason: '',
      needsUserData: [],
    },
  ],
]);

const ITEM_CLASSIFICATION_OVERRIDES = new Map([
  ['3124:怨怒', alreadyCovered(['on_hit', 'flat_magic_damage'])],
  ['3124:沸腾打击', runtimeExtension(['stacking_stat_modifier_on_hit', 'phantom_hit_on_hit_repeat'], '需要 timed stacking stat modifier 与 phantom-hit 复制攻击特效语义。')],
  ['3153:雾之锋', alreadyCovered(['on_hit', 'target_current_hp_ratio'])],
  ['3153:抓挠之影', outOfScope(['slow', 'control_only'], '只产生减速，不改变当前单标靶 DPS 曲线。')],
  ['6672:放倒它', alreadyCovered(['every_n_hit', 'target_missing_hp_amp'])],
  // 用户批准 fixed-max 口径：eligible basic damage 一律 ×1.10；距离分段为排除分支，非 blocker。
  [
    '2523:高倍望远镜',
    alreadyCovered(['outgoing_pre_mitigation_basic_damage_amp', 'fixed_maximum_multiplier']),
  ],
  [
    '2523:奥术瞄准',
    outOfScope(
      ['takedown_attack_range_only'],
      'takedown 后仅增加攻击距离，无伤害增量；不与 Magnification/高倍望远镜合并。',
    ),
  ],
]);

/** Hero skill overrides keyed by `${heroId}:${skillKey}` (heroId already lowercased). */
const HERO_CLASSIFICATION_OVERRIDES = new Map([
  // Ashe W Volley：1v1 first-arrow-only 伤害分支已由 generic seed + wasm 证据闭环；不得标 ready_to_encode。
  [
    'hero_ashe:W',
    alreadyCovered(['ability_flat_bonus_ad_damage', 'first_missile_only']),
  ],
]);

function alreadyCovered(mechanismTags) {
  return {
    classification: 'already_covered',
    mechanismTags,
    blockedReason: '',
    needsUserData: [],
  };
}

function runtimeExtension(mechanismTags, blockedReason) {
  return {
    classification: 'needs_runtime_extension',
    mechanismTags,
    blockedReason,
    needsUserData: [],
  };
}

function manualBaseline(mechanismTags, blockedReason, needsUserData = []) {
  return {
    classification: 'needs_manual_baseline',
    mechanismTags,
    blockedReason,
    needsUserData,
  };
}

function outOfScope(mechanismTags, blockedReason) {
  return {
    classification: 'out_of_scope_for_single_target_dps',
    mechanismTags,
    blockedReason,
    needsUserData: [],
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function stripMarkup(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '\n')
    .replace(/<\/li>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{([^}]+)\}\}/g, '{{$1}}')
    .replace(/&nbsp;/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactText(value) {
  return stripMarkup(value).replace(/\s+/g, ' ').trim();
}

function md(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeHeroId(championId) {
  return `hero_${slug(championId)}`;
}

function loadMarksmanChampions(championIndex) {
  return Object.values(championIndex.data ?? {})
    .filter((champion) => (champion.tags ?? []).includes('Marksman'))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildCoveredHeroSkillKeys(heroPassiveSeed) {
  const keys = new Set();
  for (const skill of heroPassiveSeed.skills ?? []) {
    if (skill.ownerType !== 'hero') {
      continue;
    }
    const ownerId = String(skill.ownerId ?? '').toLowerCase();
    const skillKey = normalizeSkillKey(skill.skillKey);
    if (ownerId && skillKey) {
      keys.add(`${ownerId}:${skillKey}`);
    }
  }
  return keys;
}

function buildCompleteHeroLevelData(heroPassiveSeed) {
  const complete = new Set();
  for (const hero of heroPassiveSeed.heroes ?? []) {
    if (!hero.heroId || !hero.statsByLevel) {
      continue;
    }
    if (hasCompleteStatsByLevel(hero.statsByLevel)) {
      complete.add(String(hero.heroId).toLowerCase());
    }
  }
  return complete;
}

function hasCompleteStatsByLevel(statsByLevel) {
  return REQUIRED_STATS_BY_LEVEL_KEYS.every((key) => Array.isArray(statsByLevel[key]) && statsByLevel[key].length === 18);
}

function normalizeSkillKey(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'PASSIVE') {
    return 'P';
  }
  return ['P', 'Q', 'W', 'E', 'R'].includes(normalized) ? normalized : '';
}

function rankTableStatusForSkill(skillKey, spell, classification) {
  if (skillKey === 'P' || classification === 'already_covered' || classification === 'out_of_scope_for_single_target_dps') {
    return 'not_applicable';
  }
  if (!['Q', 'W', 'E', 'R'].includes(skillKey)) {
    return 'not_applicable';
  }
  if (!isDpsRelevantText(`${spell?.description ?? ''} ${spell?.tooltip ?? ''}`)) {
    return 'not_applicable';
  }
  if (hasCompleteSpellRankData(spell)) {
    return 'complete';
  }
  return 'missing';
}

function hasCompleteSpellRankData(spell) {
  const maxRank = Number(spell?.maxrank ?? 0);
  if (!Number.isInteger(maxRank) || maxRank <= 1) {
    return true;
  }
  const arrays = [];
  if (Array.isArray(spell.effect)) {
    arrays.push(...spell.effect.filter(Array.isArray));
  }
  if (spell.leveltip && typeof spell.leveltip === 'object') {
    arrays.push(...Object.values(spell.leveltip).filter(Array.isArray));
  }
  return arrays.some((values) => values.length >= maxRank + 1 || values.length >= maxRank);
}

function splitItemPassiveSections(item) {
  const raw = String(item.description ?? '');
  const regex = /<(passive|active)>(.*?)<\/\1>/gi;
  const matches = [...raw.matchAll(regex)];
  const sections = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const tagKind = match[1].toLowerCase();
    const name = stripMarkup(match[2]);
    const contentStart = match.index + match[0].length;
    const contentEnd = matches[index + 1]?.index ?? raw.length;
    const sourceText = stripMarkup(raw.slice(contentStart, contentEnd));
    sections.push({
      tagKind,
      passiveName: name || (tagKind === 'active' ? 'active' : 'passive'),
      sourceText,
    });
  }
  return sections.filter((section) => section.tagKind === 'passive');
}

function classifyHeroSkill({ champion, heroId, skillKey, sourceText, coveredHeroSkillKeys, completeHeroLevelData, spell }) {
  const coveredKey = `${heroId.toLowerCase()}:${skillKey}`;
  const heroOverride = HERO_CLASSIFICATION_OVERRIDES.get(coveredKey);
  if (heroOverride) {
    return {
      ...heroOverride,
      levelDataStatus: completeHeroLevelData.has(heroId.toLowerCase()) ? 'complete' : 'missing',
      rankTableStatus: 'not_applicable',
      candidateDpsPassiveEffect: {},
    };
  }
  if (coveredHeroSkillKeys.has(coveredKey)) {
    return {
      ...alreadyCovered(['existing_batch_b_seed']),
      levelDataStatus: completeHeroLevelData.has(heroId.toLowerCase()) ? 'complete' : 'missing',
      rankTableStatus: 'not_applicable',
    };
  }

  const text = compactText(sourceText);
  const base = classifyTextForDps(text);
  const levelDataStatus = completeHeroLevelData.has(heroId.toLowerCase()) ? 'complete' : 'missing';
  let classification = base.classification;
  let blockedReason = base.blockedReason;
  const needsUserData = [...base.needsUserData];
  const mechanismTags = [...base.mechanismTags];

  const rankTableStatus = rankTableStatusForSkill(skillKey, spell, classification);
  if (classification === 'ready_to_encode' && levelDataStatus !== 'complete') {
    classification = 'needs_manual_baseline';
    blockedReason = '候选机制可表达，但该英雄尚无 1-18 级 statsByLevel；Batch G gate 禁止进入 ready seed。';
    needsUserData.push(`${champion.id} 1-18 statsByLevel: hp/mana/ad/armor/magic_resist/hp_regen/mana_regen/attack_speed`);
  }
  if (classification === 'ready_to_encode' && rankTableStatus === 'missing') {
    classification = 'needs_manual_baseline';
    blockedReason = '候选机制可表达，但 Q/W/E/R DPS 参数缺完整 rank 表；Batch G gate 禁止进入 ready seed。';
    needsUserData.push(`${champion.id} ${skillKey} rank table for DPS passive values`);
  }

  return {
    classification,
    mechanismTags,
    levelDataStatus,
    rankTableStatus,
    candidateDpsPassiveEffect: {},
    blockedReason,
    needsUserData: Array.from(new Set(needsUserData)),
  };
}

function classifyItemPassive({ itemId, passiveName, sourceText }) {
  const overrideKey = `${itemId}:${passiveName}`;
  const readyOverride = ITEM_READY_OVERRIDES.get(overrideKey);
  if (readyOverride) {
    return {
      ...readyOverride,
      levelDataStatus: 'not_applicable',
      rankTableStatus: 'not_applicable',
    };
  }
  const coveredOverride = ITEM_CLASSIFICATION_OVERRIDES.get(overrideKey);
  if (coveredOverride) {
    return {
      ...coveredOverride,
      levelDataStatus: 'not_applicable',
      rankTableStatus: 'not_applicable',
      candidateDpsPassiveEffect: {},
    };
  }

  const text = compactText(sourceText);
  const result = classifyTextForDps(text);
  return {
    ...result,
    levelDataStatus: 'not_applicable',
    rankTableStatus: 'not_applicable',
    candidateDpsPassiveEffect: {},
  };
}

function classifyTextForDps(text) {
  if (!text) {
    return outOfScope(['stat_only_or_no_passive'], '未发现可审计的被动文本；装备属性已由 Batch C 处理。');
  }
  if (/(金币|视野|显形|守卫|陷阱|友军|士兵|建筑物|防御塔|野怪|非战斗状态|复活|凝滞|移除所有控制|法术护盾|幽灵状态|stealth|vision|gold)/i.test(text)) {
    return outOfScope(['meta_or_non_target_dps'], '金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。');
  }
  if (/(减速|眩晕|禁锢|击飞|沉默|致盲|控制|slow|stun|root|silence|blind)/i.test(text) && !/(伤害|damage|攻击|attack)/i.test(text)) {
    return outOfScope(['control_only'], '仅控制或减速，不改变当前单标靶 DPS 曲线。');
  }
  if (/(附近|周围|额外敌人|目标附近|身后|弹射|连锁|多支|区域|敌人们|nearby|additional enemies|chain|area)/i.test(text)) {
    return outOfScope(['multi_target_or_area'], '多目标、弹射或范围收益不属于当前单标靶 DPS。');
  }
  if (/(盈能|energized)/i.test(text)) {
    return runtimeExtension(['energized_charge_and_consume'], '需要移动/攻击充能、充能消耗和首次攻击状态语义。');
  }
  if (/(咒刃|施放技能后|下一次攻击|next attack|spellblade)/i.test(text)) {
    return runtimeExtension(['spellblade_next_attack_state'], '需要“施法后下一次普攻”状态；当前不做主动技能轮转。');
  }
  if (/(处决|低于\s*\d+%|execute|below)/i.test(text)) {
    return runtimeExtension(['execute_threshold'], '需要阈值击杀语义和 damage 后 HP 顺序。');
  }
  if (/(每第三次.*附带|附带2次|额外的一次|攻击特效.*额外的一次|phantom)/i.test(text)) {
    return runtimeExtension(['phantom_hit_on_hit_repeat'], '需要定义复制哪些 on-hit、触发顺序和防递归。');
  }
  if (/(可叠加|每层|层数|叠层|层时|stack)/i.test(text) && /(攻击速度|攻速|护甲|魔抗|穿透|移动速度|攻击力|stat)/i.test(text)) {
    return runtimeExtension(['stacking_stat_modifier_on_hit'], '需要 timed stack stat modifier 聚合和掉层语义。');
  }
  if (/(冷却|技能急速|终极技能急速|返还|重置|cooldown|haste)/i.test(text)) {
    return outOfScope(['cooldown_or_haste_without_rotation'], '当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。');
  }
  if (/(护盾|治疗|回复生命|生命偷取|吸血|shield|heal|lifesteal|omnivamp)/i.test(text)) {
    return outOfScope(['survivability_only'], '治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。');
  }
  if (/(暴击|必定产生暴击|常规暴击|crit)/i.test(text) && /(触发|额外|转而|状态|层)/i.test(text)) {
    return runtimeExtension(['seeded_random_crit_sequence'], '涉及 on-crit 分支或暴击状态变化，当前 critPolicy=expected 不能证明真实触发序列。');
  }
  if (/(基于敌人离你有多远|距离|distance)/i.test(text)) {
    return runtimeExtension(['distance_based_damage_modifier'], '当前 curve 没有攻击距离/目标距离输入。');
  }
  if (/(额外生命值|最大生命值|当前生命值|已损失生命值|missing health|max health|current health)/i.test(text) && /(额外伤害|伤害|damage)/i.test(text)) {
    if (/(一部分|至多|基于|%目标当前生命值|额外物理伤害$)/i.test(text) && !/\d+(?:\.\d+)?%|\d+/.test(text)) {
      return manualBaseline(
        ['health_ratio_damage'],
        '描述是生命值比例伤害，但本地 Data Dragon 文本缺可审计数值；须以当前 League Wiki 模板/修订为数值真源。',
        [WIKI_NUMERIC_NEED],
      );
    }
    return runtimeExtension(['damage_multiplier_or_health_ratio'], '当前 DPSPassiveEffect 不能表达全局伤害增幅或缺目标额外生命值字段。');
  }
  if (/(每第?\s*\d+|每五|每第三|every)/i.test(text) && /(额外.*伤害|伤害|damage)/i.test(text)) {
    if (!/\d+/.test(text)) {
      return manualBaseline(
        ['every_n_hit'],
        'every-N 伤害描述缺少可审计数值；须以当前 League Wiki 模板/修订为数值真源。',
        [WIKI_NUMERIC_NEED],
      );
    }
    return {
      classification: 'ready_to_encode',
      mechanismTags: ['every_n_hit'],
      blockedReason: '',
      needsUserData: [],
    };
  }
  if (/(命中时|普攻造成|攻击造成|攻击时|on-hit|on hit|attacks deal|basic attacks deal)/i.test(text) && /(额外.*伤害|魔法伤害|物理伤害|真实伤害|damage)/i.test(text)) {
    if (!/\d+/.test(text)) {
      return manualBaseline(
        ['on_hit'],
        'on-hit 伤害描述缺少可审计数值；须以当前 League Wiki 模板/修订为数值真源。',
        [WIKI_NUMERIC_NEED],
      );
    }
    return {
      classification: 'ready_to_encode',
      mechanismTags: ['on_hit'],
      blockedReason: '',
      needsUserData: [],
    };
  }
  if (isDpsRelevantText(text)) {
    return manualBaseline(
      ['dps_relevant_manual_review'],
      '文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表；须以当前 League Wiki 模板/修订为数值真源。',
      [WIKI_NUMERIC_NEED],
    );
  }
  return outOfScope(['no_single_target_dps_effect'], '未发现会改变当前单攻击方单标靶 DPS 的效果。');
}

function isDpsRelevantText(text) {
  return /(攻击|普攻|命中|伤害|攻速|攻击速度|暴击|穿透|生命值|on-hit|attack|damage|crit|penetration|health)/i.test(String(text ?? ''));
}

function buildHeroCandidates({ championIndex, coveredHeroSkillKeys, completeHeroLevelData }) {
  const candidates = [];
  for (const champion of loadMarksmanChampions(championIndex)) {
    const championFile = path.join(paths.championDir, `${champion.id}.json`);
    const championDetail = readJson(championFile).data?.[champion.id] ?? champion;
    const heroId = normalizeHeroId(champion.id);
    const passiveText = championDetail.passive?.description ?? champion.passive?.description ?? '';
    const passive = classifyHeroSkill({
      champion,
      heroId,
      skillKey: 'P',
      sourceText: passiveText,
      coveredHeroSkillKeys,
      completeHeroLevelData,
      spell: undefined,
    });
    candidates.push({
      sourceKind: 'hero_skill',
      ownerId: heroId,
      ownerName: championDetail.name ?? champion.name ?? champion.id,
      skillKey: 'P',
      passiveName: championDetail.passive?.name ?? 'Passive',
      sourceText: compactText(passiveText),
      ...passive,
      sourceRef: `数据参考/champion/${champion.id}.json#data.${champion.id}.passive`,
    });

    const spells = championDetail.spells ?? [];
    spells.forEach((spell, index) => {
      const skillKey = ['Q', 'W', 'E', 'R'][index] ?? `S${index + 1}`;
      const sourceText = `${spell.description ?? ''}\n${spell.tooltip ?? ''}`;
      const classification = classifyHeroSkill({
        champion,
        heroId,
        skillKey,
        sourceText,
        coveredHeroSkillKeys,
        completeHeroLevelData,
        spell,
      });
      candidates.push({
        sourceKind: 'hero_skill',
        ownerId: heroId,
        ownerName: championDetail.name ?? champion.name ?? champion.id,
        skillKey,
        passiveName: spell.name ?? skillKey,
        sourceText: compactText(sourceText),
        ...classification,
        sourceRef: `数据参考/champion/${champion.id}.json#data.${champion.id}.spells[${index}]`,
      });
    });
  }
  return candidates;
}

function buildItemCandidates({ itemRoot, adcItemSeed }) {
  const candidates = [];
  for (const seedItem of adcItemSeed.items ?? []) {
    const itemId = String(seedItem.itemId);
    const item = itemRoot.data?.[itemId] ?? seedItem;
    const sections = splitItemPassiveSections(item);
    if (sections.length === 0) {
      candidates.push({
        sourceKind: 'item_passive',
        ownerId: itemId,
        ownerName: seedItem.name ?? item.name ?? itemId,
        skillKey: 'item_passive',
        passiveName: '无被动或仅主动/属性',
        sourceText: compactText(item.description ?? ''),
        ...outOfScope(['stat_only_or_active_only'], '无可录入装备被动；属性已由 Batch C 处理，主动效果不进 Batch G。'),
        levelDataStatus: 'not_applicable',
        rankTableStatus: 'not_applicable',
        candidateDpsPassiveEffect: {},
        sourceRef: `数据参考/item.json#data.${itemId}`,
      });
      continue;
    }

    for (const section of sections) {
      const classification = classifyItemPassive({
        itemId,
        passiveName: section.passiveName,
        sourceText: section.sourceText,
      });
      candidates.push({
        sourceKind: 'item_passive',
        ownerId: itemId,
        ownerName: seedItem.name ?? item.name ?? itemId,
        skillKey: 'item_passive',
        passiveName: section.passiveName,
        sourceText: compactText(section.sourceText),
        ...classification,
        sourceRef: `数据参考/item.json#data.${itemId}`,
      });
    }
  }
  return candidates;
}

function summarize(candidates, marksmanHeroCount, adcCompletedItemCount) {
  const classificationCounts = Object.fromEntries(CLASSIFICATIONS.map((classification) => [classification, 0]));
  const sourceKindCounts = {};
  const mechanismBacklog = {};
  for (const candidate of candidates) {
    classificationCounts[candidate.classification] = (classificationCounts[candidate.classification] ?? 0) + 1;
    sourceKindCounts[candidate.sourceKind] = (sourceKindCounts[candidate.sourceKind] ?? 0) + 1;
    if (candidate.classification === 'needs_runtime_extension') {
      for (const tag of candidate.mechanismTags ?? []) {
        mechanismBacklog[tag] = (mechanismBacklog[tag] ?? 0) + 1;
      }
    }
  }
  return {
    marksmanHeroCount,
    adcCompletedItemCount,
    candidateCount: candidates.length,
    sourceKindCounts,
    classificationCounts,
    mechanismBacklog,
  };
}

function buildCoverageDoc({ audit }) {
  const lines = [
    'TASK_KEY: planning-validation-milestones',
    'DOC_TYPE: 详细设计',
    'WORKSTREAM: planning',
    'STATUS: draft',
    'EXECUTION_MODEL: gpt-5.4',
    'LAST_TRACKED_AT: 2026-05-20',
    '',
    '# V2 Batch G ADC 被动覆盖清单',
    '',
    '生成脚本：`最小验证/数据/build-v2-batch-g-adc-passive-audit.mjs`',
    '',
    '机器清单：`最小验证/V2-Batch-G-adc-passive-audit.json`',
    '',
    '## 汇总',
    '',
    `- Marksman 英雄候选池：${audit.summary.marksmanHeroCount}`,
    `- ADC 成装候选池：${audit.summary.adcCompletedItemCount}`,
    `- 候选被动/技能条目：${audit.summary.candidateCount}`,
    `- 分类计数：${Object.entries(audit.summary.classificationCounts).map(([key, value]) => `${key}=${value}`).join('；')}`,
    '',
    '## 机制 backlog 汇总',
    '',
  ];

  const backlogEntries = Object.entries(audit.summary.mechanismBacklog).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (backlogEntries.length === 0) {
    lines.push('- 无');
  } else {
    for (const [tag, count] of backlogEntries) {
      const owners = audit.candidates
        .filter((candidate) => candidate.classification === 'needs_runtime_extension' && (candidate.mechanismTags ?? []).includes(tag))
        .map((candidate) => `${candidate.ownerName}/${candidate.passiveName}`)
        .slice(0, 12)
        .join('；');
      lines.push(`- \`${tag}\`：${count} 项。样例：${owners}`);
    }
  }

  lines.push(
    '',
    '## 覆盖表',
    '',
    '| sourceKind | ownerId | ownerName | skillKey | passiveName | classification | mechanismTags | levelDataStatus | rankTableStatus | blockedReason | needsUserData |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );

  for (const candidate of audit.candidates) {
    lines.push([
      candidate.sourceKind,
      candidate.ownerId,
      candidate.ownerName,
      candidate.skillKey,
      candidate.passiveName,
      candidate.classification,
      (candidate.mechanismTags ?? []).join(', '),
      candidate.levelDataStatus,
      candidate.rankTableStatus,
      candidate.blockedReason,
      (candidate.needsUserData ?? []).join('; '),
    ].map(md).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function stripGeneratedAt(audit) {
  if (!audit || typeof audit !== 'object') return audit;
  const out = { ...audit };
  delete out.generatedAt;
  return out;
}

function buildAudit() {
  const championIndex = readJson(paths.championIndex);
  const itemRoot = readJson(paths.itemIndex);
  const heroPassiveSeed = readJson(paths.heroPassiveSeed);
  const adcItemSeed = readJson(paths.adcItemSeed);
  readJson(paths.itemPassiveSeed);

  const marksmanHeroCount = loadMarksmanChampions(championIndex).length;
  const adcCompletedItemCount = (adcItemSeed.items ?? []).length;
  const coveredHeroSkillKeys = buildCoveredHeroSkillKeys(heroPassiveSeed);
  const completeHeroLevelData = buildCompleteHeroLevelData(heroPassiveSeed);

  const candidates = [
    ...buildHeroCandidates({ championIndex, coveredHeroSkillKeys, completeHeroLevelData }),
    ...buildItemCandidates({ itemRoot, adcItemSeed }),
  ].map((candidate) => {
    if (!CLASSIFICATIONS.includes(candidate.classification)) {
      throw new Error(`Invalid classification ${candidate.classification} for ${candidate.ownerId}/${candidate.passiveName}`);
    }
    // Harden: never emit screenshot/OCR as an acceptable missing-data source.
    const needsUserData = (candidate.needsUserData || []).map((entry) => {
      const text = String(entry);
      if (
        /训练营截图|训练场截图|完整 tooltip 数值或训练营/i.test(text)
        || /\bscreenshot\b/i.test(text)
        || (/OCR/i.test(text) && !/provenance/i.test(text))
      ) {
        return WIKI_NUMERIC_NEED;
      }
      return entry;
    });
    return { ...candidate, needsUserData: Array.from(new Set(needsUserData)) };
  });

  const wikiContractsPresent = fs.existsSync(paths.wikiContracts);

  return {
    gameId: 'lol',
    batch: 'V2-Batch-G',
    generatedAt: new Date().toISOString(),
    source: {
      championJson: path.relative(repoRoot, paths.championIndex),
      championDetailDir: path.relative(repoRoot, paths.championDir),
      itemJson: path.relative(repoRoot, paths.itemIndex),
      championSourceVersion: String(championIndex.version ?? ''),
      itemSourceVersion: String(itemRoot.version ?? ''),
      adcItemSeed: path.relative(repoRoot, paths.adcItemSeed),
      heroPassiveSeed: path.relative(repoRoot, paths.heroPassiveSeed),
      itemPassiveSeed: path.relative(repoRoot, paths.itemPassiveSeed),
      lolWikiCurrentChampions: wikiContractsPresent
        ? path.relative(repoRoot, paths.wikiContracts).replace(/\\/g, '/')
        : '',
    },
    dataPolicy: {
      numericTruthPrecedence: [
        'current_league_wiki_template_revision',
        'data_dragon_secondary',
        'batch_b_ocr_historical_provenance_only',
      ],
      missingDataSource: 'league_wiki_template_revision_only',
      forbiddenMissingDataSources: ['screenshot', 'training_ground_screenshot', 'OCR'],
    },
    classificationValues: CLASSIFICATIONS,
    levelGate: {
      requiredStatsByLevelKeys: REQUIRED_STATS_BY_LEVEL_KEYS,
      rule: 'ready_to_encode hero_skill candidates require complete 1-18 statsByLevel and complete Q/W/E/R rank tables when DPS values vary by skill rank.',
    },
    summary: summarize(candidates, marksmanHeroCount, adcCompletedItemCount),
    candidates,
  };
}

function validateAudit(audit) {
  const errors = [];
  for (const c of audit.candidates || []) {
    for (const entry of c.needsUserData || []) {
      const text = String(entry);
      // Flag only when screenshot/OCR is suggested as a source, not when policy forbids them.
      if (
        /训练营截图|训练场截图|完整 tooltip 数值或训练营/i.test(text)
        || (/\bscreenshot\b/i.test(text) && !/forbid|禁止|不得/i.test(text))
        || (/OCR/i.test(text) && !/forbid|禁止|不得|provenance/i.test(text))
      ) {
        errors.push(`needsUserData still cites screenshot/OCR @ ${c.ownerId}/${c.skillKey}/${c.passiveName}`);
      }
    }
  }
  if (!audit.dataPolicy?.forbiddenMissingDataSources?.includes('screenshot')) {
    errors.push('dataPolicy must forbid screenshot/OCR missing-data sources');
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
    if (JSON.stringify(stripGeneratedAt(existing)) !== JSON.stringify(stripGeneratedAt(audit))) {
      console.error('--check failed: semantic content differs (ignoring generatedAt)');
      process.exit(1);
    }
    console.log('check ok');
    console.log(JSON.stringify({ summary: audit.summary }, null, 2));
    return;
  }

  // Only write allowlisted audit JSON (coverage markdown lives outside write scope).
  writeJson(paths.auditJson, audit);
  console.log(JSON.stringify({
    auditJson: path.relative(repoRoot, paths.auditJson),
    summary: audit.summary,
  }, null, 2));
}

main();

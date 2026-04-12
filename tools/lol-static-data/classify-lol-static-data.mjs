import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_SNAPSHOT_ROOT = path.resolve(
  process.cwd(),
  '文档记录',
  '详细设计',
  '最小验证',
  '数据',
  'lol_竞技场静态文本快照',
);

const GROUP_PRIORITY = [
  '比例与阈值',
  '护盾、治疗、吸血',
  '命中触发与标记结算',
  '资源与节奏',
  '叠层与时效',
  '抗性、穿透、转化、适应之力',
  '基础属性加成',
  '需过滤或转换',
  '待人工归类',
];

const MECHANISM_TAGS = [
  {
    key: 'hp_current_pct',
    cluster: '比例与阈值',
    description: '引用当前生命值百分比或低生命值状态',
    patterns: [/当前生命值|生命值低于|低生命值|current health|low health|health below/i],
  },
  {
    key: 'hp_max_pct',
    cluster: '比例与阈值',
    description: '引用最大生命值百分比',
    patterns: [/最大生命值|max health/i],
  },
  {
    key: 'hp_missing_pct',
    cluster: '比例与阈值',
    description: '引用已损失生命值百分比',
    patterns: [/已损失生命值|损失生命值|missing health/i],
  },
  {
    key: 'threshold',
    cluster: '比例与阈值',
    description: '存在阈值、上下限、低于/高于判定',
    patterns: [/低于|高于|阈值|上限|下限|below|above|threshold|clamp/i],
  },
  {
    key: 'execute',
    cluster: '比例与阈值',
    description: '斩杀或生命值触发立即击杀',
    patterns: [/斩杀|处决|立刻击杀|execute|instantly kill/i],
  },
  {
    key: 'heal',
    cluster: '护盾、治疗、吸血',
    description: '治疗或回复生命值',
    patterns: [/治疗|回复生命值|恢复生命值|\bhealing\b|\bheals?\b|\bhealed\b|restore .*health/i],
  },
  {
    key: 'shield',
    cluster: '护盾、治疗、吸血',
    description: '护盾相关',
    patterns: [/护盾|shield/i],
  },
  {
    key: 'life_steal',
    cluster: '护盾、治疗、吸血',
    description: '生命偷取、吸血、全能吸血',
    patterns: [/生命偷取|吸血|全能吸血|lifesteal|life steal|omnivamp/i],
  },
  {
    key: 'regen',
    cluster: '护盾、治疗、吸血',
    description: '生命/法力/能量回复或再生',
    patterns: [/生命回复|法力回复|回复速度|regen|regeneration|each second/i],
  },
  {
    key: 'on_hit',
    cluster: '命中触发与标记结算',
    description: '攻击命中触发',
    patterns: [/攻击命中|普攻命中|攻击敌方英雄时|每次攻击|on-hit|on hit|basic attacks?|attacks? against/i],
  },
  {
    key: 'ability_hit',
    cluster: '命中触发与标记结算',
    description: '技能命中触发',
    patterns: [/技能命中|技能造成伤害时|ability hit|ability hits|ability damage/i],
  },
  {
    key: 'mark_detonate',
    cluster: '命中触发与标记结算',
    description: '标记、储存伤害、引爆',
    patterns: [/标记|印记|储存.*伤害|引爆|mark|detonate|store .*damage/i],
  },
  {
    key: 'dot_burn',
    cluster: '命中触发与标记结算',
    description: '持续伤害、灼烧、流血等',
    patterns: [/持续伤害|持续造成|灼烧|燃烧|burn|damage over|bleed/i],
  },
  {
    key: 'crit',
    cluster: '命中触发与标记结算',
    description: '暴击或技能可暴击',
    patterns: [/暴击|crit(?:ical)?/i],
  },
  {
    key: 'resource_cost',
    cluster: '资源与节奏',
    description: '资源消耗或资源门槛',
    patterns: [/法力值|法力|能量|怒气|消耗|mana|energy|resource/i],
  },
  {
    key: 'cooldown',
    cluster: '资源与节奏',
    description: '冷却、技能急速、可用频率',
    patterns: [/冷却|技能急速|cooldown|ability haste/i],
  },
  {
    key: 'reset_refund',
    cluster: '资源与节奏',
    description: '冷却重置、返还、减少',
    patterns: [/重置|返还|减少.*冷却|reduced to|refresh|refund|reset/i],
  },
  {
    key: 'attack_speed',
    cluster: '资源与节奏',
    description: '攻击速度相关',
    patterns: [/攻击速度|attack speed/i],
  },
  {
    key: 'move_speed',
    cluster: '资源与节奏',
    description: '移动速度相关',
    patterns: [/移动速度|move speed/i],
  },
  {
    key: 'autocast',
    cluster: '资源与节奏',
    description: '自动施放或自动触发',
    patterns: [/自动施放|自动释放|autocast|automatically/i],
  },
  {
    key: 'stack',
    cluster: '叠层与时效',
    description: '层数、叠加、上限',
    patterns: [/叠层|层数|层|stack|stacks/i],
  },
  {
    key: 'duration',
    cluster: '叠层与时效',
    description: '持续时间、定时失效',
    patterns: [/持续.*秒|持续时间|duration|seconds?/i],
  },
  {
    key: 'buff_debuff',
    cluster: '叠层与时效',
    description: '增益、减益、控制、减速等状态',
    patterns: [/减速|眩晕|禁锢|沉默|易伤|增益|减益|slow|stun|snare|silence|buff|debuff/i],
  },
  {
    key: 'armor_mr_shred',
    cluster: '抗性、穿透、转化、适应之力',
    description: '护甲、魔抗、削减抗性',
    patterns: [/护甲|魔抗|魔法抗性|armor|magic resist|mr|shred/i],
  },
  {
    key: 'penetration',
    cluster: '抗性、穿透、转化、适应之力',
    description: '固定或百分比穿透',
    patterns: [/穿透|penetration/i],
  },
  {
    key: 'adaptive_force',
    cluster: '抗性、穿透、转化、适应之力',
    description: '适应之力、自适应伤害',
    patterns: [/适应之力|自适应伤害|adaptive force|adaptive damage/i],
  },
  {
    key: 'stat_conversion',
    cluster: '抗性、穿透、转化、适应之力',
    description: '属性转化、基于某属性转另一属性',
    patterns: [/转化为|转换为|gain an additional|convert|converted|基于.*获得/i],
  },
  {
    key: 'health_stat',
    cluster: '基础属性加成',
    description: '基础生命值属性加成',
    patterns: [],
  },
  {
    key: 'mana_stat',
    cluster: '基础属性加成',
    description: '基础法力或资源属性加成',
    patterns: [],
  },
  {
    key: 'offense_stat',
    cluster: '基础属性加成',
    description: '基础攻击力或法强属性加成',
    patterns: [],
  },
  {
    key: 'defense_stat',
    cluster: '基础属性加成',
    description: '基础护甲、魔抗、防御属性加成',
    patterns: [],
  },
  {
    key: 'crit_stat',
    cluster: '基础属性加成',
    description: '基础暴击属性加成',
    patterns: [],
  },
  {
    key: 'attack_speed_stat',
    cluster: '基础属性加成',
    description: '基础攻击速度属性加成',
    patterns: [],
  },
  {
    key: 'move_speed_stat',
    cluster: '基础属性加成',
    description: '基础移动速度属性加成',
    patterns: [],
  },
  {
    key: 'haste_stat',
    cluster: '基础属性加成',
    description: '基础冷却缩减/技能急速属性加成',
    patterns: [],
  },
  {
    key: 'ally_partner',
    cluster: '需过滤或转换',
    description: '依赖友军、搭档或双人联动',
    patterns: [/友军|搭档|队友|ally|partner/i],
  },
  {
    key: 'multi_target',
    cluster: '需过滤或转换',
    description: '多目标、范围或全体效果',
    patterns: [/所有敌人|所有目标|附近的敌人|周围.*敌人|all enemy|all enemies|nearby enemies|their partner/i],
  },
  {
    key: 'summon_object',
    cluster: '需过滤或转换',
    description: '召唤物、部署物、单位创建',
    patterns: [/召唤|召唤物|炮塔|宠物|分身|植物|summon|turret|pet|clone/i],
  },
  {
    key: 'mobility_spatial',
    cluster: '需过滤或转换',
    description: '位移、闪烁、传送、空间落点',
    patterns: [/位移|冲刺|突进|闪烁|传送|teleport|dash|blink|movement ability/i],
  },
  {
    key: 'terrain_vision',
    cluster: '需过滤或转换',
    description: '地形、视野、守卫、草丛、墙体',
    patterns: [/地形|视野|守卫|草丛|墙体|vision|ward|brush|wall/i],
  },
  {
    key: 'economy_round_meta',
    cluster: '需过滤或转换',
    description: '金币、商店、回合外奖励、模式元规则',
    patterns: [/金币|商店|回合后|额外棱彩|gold|shop|rounds remaining|prismatic augment/i],
  },
  {
    key: 'revive',
    cluster: '需过滤或转换',
    description: '复活或再生',
    patterns: [/复活|重生|revive|resurrect/i],
  },
];

const ITEM_TAG_MAP = {
  Health: ['health_stat'],
  Mana: ['mana_stat'],
  Damage: ['offense_stat'],
  SpellDamage: ['offense_stat'],
  AttackSpeed: ['attack_speed_stat'],
  CriticalStrike: ['crit_stat'],
  LifeSteal: ['life_steal'],
  SpellVamp: ['life_steal'],
  Armor: ['defense_stat'],
  SpellBlock: ['defense_stat'],
  CooldownReduction: ['haste_stat'],
  NonbootsMovement: ['move_speed_stat'],
  Boots: ['move_speed_stat'],
  OnHit: ['on_hit'],
  Aura: ['multi_target'],
  Active: ['autocast'],
  Vision: ['terrain_vision'],
  Stealth: ['mobility_spatial'],
};

function parseArgs(argv) {
  const args = {
    snapshotRoot: DEFAULT_SNAPSHOT_ROOT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--snapshot-root') {
      args.snapshotRoot = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

async function readJson(filePath) {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, 'utf8');
}

function stripMarkup(raw) {
  return String(raw ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function previewText(text, maxLen = 180) {
  if (!text) {
    return '';
  }
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen - 1)}…`;
}

function addTags(tagSet, tags) {
  for (const tag of tags) {
    tagSet.add(tag);
  }
}

function classifyTextTags(text, itemTags = []) {
  const tagSet = new Set();

  for (const tag of MECHANISM_TAGS) {
    if (tag.patterns.some((pattern) => pattern.test(text))) {
      tagSet.add(tag.key);
    }
  }

  for (const itemTag of itemTags) {
    if (ITEM_TAG_MAP[itemTag]) {
      addTags(tagSet, ITEM_TAG_MAP[itemTag]);
    }
  }

  return [...tagSet].sort();
}

function getGroupForTags(tags) {
  const tagSet = new Set(tags);
  for (const group of GROUP_PRIORITY) {
    if (
      MECHANISM_TAGS.some(
        (tag) => tag.cluster === group && tagSet.has(tag.key),
      )
    ) {
      return group;
    }
  }
  return '待人工归类';
}

function getScopeAssessment(tags) {
  const tagSet = new Set(tags);
  if (tagSet.has('ally_partner') || tagSet.has('summon_object') || tagSet.has('revive')) {
    return 'out_of_scope';
  }
  if (
    tagSet.has('multi_target') ||
    tagSet.has('mobility_spatial') ||
    tagSet.has('terrain_vision') ||
    tagSet.has('economy_round_meta')
  ) {
    return 'needs_conversion';
  }
  return 'in_scope';
}

function buildChampionEntries(championZh, championEn) {
  const entries = [];
  for (const championId of Object.keys(championZh.data)) {
    const zh = championZh.data[championId];
    const en = championEn.data[championId];
    const commonMeta = {
      sourceCategory: 'champion',
      ownerId: championId,
      ownerNameZh: zh.name,
      ownerNameEn: en.name,
      championRoles: zh.tags ?? [],
      partypeZh: zh.partype ?? '',
      partypeEn: en.partype ?? '',
    };

    const passiveTextZh = stripMarkup(zh.passive?.description);
    const passiveTextEn = stripMarkup(en.passive?.description);
    const passiveCombined = `${passiveTextZh}\n${passiveTextEn}`.trim();
    const passiveTags = classifyTextTags(passiveCombined);
    entries.push({
      entryId: `champion:${championId}:passive`,
      sourceType: 'champion_passive',
      nameZh: zh.passive?.name ?? '',
      nameEn: en.passive?.name ?? '',
      textPreviewZh: previewText(passiveTextZh),
      mechanismTags: passiveTags,
      primaryGroup: getGroupForTags(passiveTags),
      scopeAssessment: getScopeAssessment(passiveTags),
      sourceRef: `ddragon/16.7.1/zh_CN/championFull.json#data.${championId}.passive`,
      ...commonMeta,
    });

    zh.spells.forEach((spellZh, index) => {
      const spellEn = en.spells[index];
      const textZh = stripMarkup(`${spellZh.description ?? ''} ${spellZh.tooltip ?? ''} ${spellZh.resource ?? ''}`);
      const textEn = stripMarkup(`${spellEn.description ?? ''} ${spellEn.tooltip ?? ''} ${spellEn.resource ?? ''}`);
      const combined = `${textZh}\n${textEn}`.trim();
      const mechanismTags = classifyTextTags(combined);
      entries.push({
        entryId: `champion:${championId}:spell:${spellZh.id}`,
        sourceType: 'champion_spell',
        nameZh: spellZh.name,
        nameEn: spellEn.name,
        spellSlot: ['Q', 'W', 'E', 'R'][index] ?? `S${index + 1}`,
        textPreviewZh: previewText(textZh),
        mechanismTags,
        primaryGroup: getGroupForTags(mechanismTags),
        scopeAssessment: getScopeAssessment(mechanismTags),
        sourceRef: `ddragon/16.7.1/zh_CN/championFull.json#data.${championId}.spells[${index}]`,
        cooldownBurn: spellZh.cooldownBurn ?? '',
        costBurn: spellZh.costBurn ?? '',
        ...commonMeta,
      });
    });
  }
  return entries;
}

function buildItemEntries(itemZh, itemEn) {
  const entries = [];
  for (const itemId of Object.keys(itemZh.data)) {
    const zh = itemZh.data[itemId];
    const en = itemEn.data[itemId];
    const itemTags = zh.tags ?? [];
    const textZh = stripMarkup(`${zh.description ?? ''} ${zh.plaintext ?? ''}`);
    const textEn = stripMarkup(`${en.description ?? ''} ${en.plaintext ?? ''}`);
    const combined = `${textZh}\n${textEn}\n${itemTags.join(' ')}`;
    const mechanismTags = classifyTextTags(combined, itemTags);
    entries.push({
      entryId: `item:${itemId}`,
      sourceCategory: 'item',
      sourceType: 'item',
      nameZh: zh.name,
      nameEn: en.name,
      textPreviewZh: previewText(textZh),
      mechanismTags,
      primaryGroup: getGroupForTags(mechanismTags),
      scopeAssessment: getScopeAssessment(mechanismTags),
      sourceRef: `ddragon/16.7.1/zh_CN/item.json#data.${itemId}`,
      itemId,
      itemTags,
      depth: zh.depth ?? null,
      goldTotal: zh.gold?.total ?? null,
      purchasable: zh.gold?.purchasable ?? false,
      requiredAlly: zh.requiredAlly ?? '',
      requiredChampion: zh.requiredChampion ?? '',
    });
  }
  return entries;
}

function buildRuneEntries(runesZh, runesEn) {
  const entries = [];
  runesZh.forEach((treeZh, treeIndex) => {
    const treeEn = runesEn[treeIndex];
    treeZh.slots.forEach((slotZh, slotIndex) => {
      const slotEn = treeEn.slots[slotIndex];
      slotZh.runes.forEach((runeZh, runeIndex) => {
        const runeEn = slotEn.runes[runeIndex];
        const textZh = stripMarkup(`${runeZh.shortDesc ?? ''} ${runeZh.longDesc ?? ''}`);
        const textEn = stripMarkup(`${runeEn.shortDesc ?? ''} ${runeEn.longDesc ?? ''}`);
        const combined = `${textZh}\n${textEn}`;
        const mechanismTags = classifyTextTags(combined);
        entries.push({
          entryId: `rune:${runeZh.id}`,
          sourceCategory: 'rune',
          sourceType: 'rune',
          nameZh: runeZh.name,
          nameEn: runeEn.name,
          textPreviewZh: previewText(textZh),
          mechanismTags,
          primaryGroup: getGroupForTags(mechanismTags),
          scopeAssessment: getScopeAssessment(mechanismTags),
          sourceRef: `ddragon/16.7.1/zh_CN/runesReforged.json#tree[${treeIndex}].slot[${slotIndex}].rune[${runeIndex}]`,
          treeNameZh: treeZh.name,
          treeNameEn: treeEn.name,
          slotIndex,
        });
      });
    });
  });
  return entries;
}

function buildAugmentEntries(arenaZh, arenaEn) {
  const entries = [];
  arenaZh.augments.forEach((augmentZh, index) => {
    const augmentEn = arenaEn.augments[index];
    const textZh = stripMarkup(`${augmentZh.desc ?? ''} ${augmentZh.tooltip ?? ''}`);
    const textEn = stripMarkup(`${augmentEn?.desc ?? ''} ${augmentEn?.tooltip ?? ''}`);
    const dataValueKeys = Object.keys(augmentZh.dataValues ?? {});
    const combined = `${textZh}\n${textEn}\n${dataValueKeys.join(' ')}`;
    const mechanismTags = classifyTextTags(combined);
    entries.push({
      entryId: `augment:${augmentZh.id}`,
      sourceCategory: 'augment',
      sourceType: 'arena_augment',
      nameZh: augmentZh.name,
      nameEn: augmentEn?.name ?? '',
      textPreviewZh: previewText(textZh),
      mechanismTags,
      primaryGroup: getGroupForTags(mechanismTags),
      scopeAssessment: getScopeAssessment(mechanismTags),
      sourceRef: `communitydragon/latest/zh_cn/arena.json#augments[${index}]`,
      apiName: augmentZh.apiName,
      rarity: augmentZh.rarity,
      dataValueKeys,
    });
  });
  return entries;
}

function countBy(items, getKey) {
  const counts = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countTags(entries) {
  const overall = {};
  const bySourceCategory = {};
  for (const entry of entries) {
    for (const tag of entry.mechanismTags) {
      overall[tag] = (overall[tag] ?? 0) + 1;
      bySourceCategory[entry.sourceCategory] ??= {};
      bySourceCategory[entry.sourceCategory][tag] = (bySourceCategory[entry.sourceCategory][tag] ?? 0) + 1;
    }
  }
  return { overall, bySourceCategory };
}

function buildGroupIndex(entries) {
  const groups = {};
  for (const groupName of GROUP_PRIORITY) {
    const groupEntries = entries.filter((entry) => entry.primaryGroup === groupName);
    groups[groupName] = {
      count: groupEntries.length,
      bySourceCategory: countBy(groupEntries, (entry) => entry.sourceCategory),
      byScopeAssessment: countBy(groupEntries, (entry) => entry.scopeAssessment),
      samples: groupEntries
        .slice(0, 12)
        .map((entry) => ({
          entryId: entry.entryId,
          sourceType: entry.sourceType,
          ownerNameZh: entry.ownerNameZh ?? '',
          nameZh: entry.nameZh,
          mechanismTags: entry.mechanismTags,
          scopeAssessment: entry.scopeAssessment,
          sourceRef: entry.sourceRef,
        })),
    };
  }
  return groups;
}

function buildMarkdownReport(summary, groups, tagSummary, entries) {
  const lines = [];
  lines.push('# LoL竞技场静态数据分类汇总');
  lines.push('');
  lines.push(`- 生成时间：${summary.generatedAt}`);
  lines.push(`- Data Dragon 版本：${summary.dataDragonVersion}`);
  lines.push(`- 入口总数：${summary.entryCount}`);
  lines.push('');
  lines.push('## 数据源计数');
  lines.push('');
  for (const [key, value] of Object.entries(summary.bySourceCategory)) {
    lines.push(`- ${key}：${value}`);
  }
  lines.push('');
  lines.push('## 适配状态计数');
  lines.push('');
  for (const [key, value] of Object.entries(summary.byScopeAssessment)) {
    lines.push(`- ${key}：${value}`);
  }
  lines.push('');
  lines.push('## 一级机制分组');
  lines.push('');
  for (const groupName of GROUP_PRIORITY) {
    const group = groups[groupName];
    lines.push(`### ${groupName}`);
    lines.push('');
    lines.push(`- 数量：${group.count}`);
    lines.push(`- 数据源分布：${Object.entries(group.bySourceCategory).map(([k, v]) => `${k}=${v}`).join('，') || '无'}`);
    lines.push(`- 适配状态：${Object.entries(group.byScopeAssessment).map(([k, v]) => `${k}=${v}`).join('，') || '无'}`);
    if (group.samples.length > 0) {
      lines.push('- 示例：');
      for (const sample of group.samples.slice(0, 6)) {
        const ownerPrefix = sample.ownerNameZh ? `${sample.ownerNameZh} / ` : '';
        lines.push(`  - ${sample.entryId} | ${sample.sourceType} | ${ownerPrefix}${sample.nameZh} | ${sample.scopeAssessment}`);
      }
    }
    lines.push('');
  }
  lines.push('## 高频机制标签');
  lines.push('');
  const topTags = Object.entries(tagSummary.overall)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  for (const [tag, count] of topTags) {
    lines.push(`- ${tag}：${count}`);
  }
  lines.push('');
  lines.push('## 建议的首轮分析入口');
  lines.push('');
  const firstCandidates = entries
    .filter((entry) => entry.primaryGroup === '比例与阈值' && entry.scopeAssessment !== 'out_of_scope')
    .slice(0, 12);
  for (const entry of firstCandidates) {
    const ownerPrefix = entry.ownerNameZh ? `${entry.ownerNameZh} / ` : '';
    lines.push(`- ${entry.entryId} | ${entry.sourceType} | ${ownerPrefix}${entry.nameZh} | ${entry.textPreviewZh}`);
  }
  lines.push('');
  lines.push('## 说明');
  lines.push('');
  lines.push('- 这里的分类是“后续机制分析索引”，不是最终实现定案。');
  lines.push('- `in_scope` 表示可直接进入 1v1 数值分析；`needs_conversion` 表示需要先做语义折叠；`out_of_scope` 表示当前阶段不作为主样本。');
  lines.push('- 英雄按“被动/技能”拆成原子入口，避免一个英雄同时落入多个机制组后难以抽样。');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshotRoot = args.snapshotRoot;
  const summary = await readJson(path.join(snapshotRoot, 'summary.json'));
  const championZh = await readJson(path.join(snapshotRoot, 'ddragon', summary.dataDragonVersion, 'zh_CN', 'championFull.json'));
  const championEn = await readJson(path.join(snapshotRoot, 'ddragon', summary.dataDragonVersion, 'en_US', 'championFull.json'));
  const itemZh = await readJson(path.join(snapshotRoot, 'ddragon', summary.dataDragonVersion, 'zh_CN', 'item.json'));
  const itemEn = await readJson(path.join(snapshotRoot, 'ddragon', summary.dataDragonVersion, 'en_US', 'item.json'));
  const runesZh = await readJson(path.join(snapshotRoot, 'ddragon', summary.dataDragonVersion, 'zh_CN', 'runesReforged.json'));
  const runesEn = await readJson(path.join(snapshotRoot, 'ddragon', summary.dataDragonVersion, 'en_US', 'runesReforged.json'));
  const arenaZh = await readJson(path.join(snapshotRoot, 'communitydragon', 'latest', 'zh_cn', 'arena.json'));
  const arenaEn = await readJson(path.join(snapshotRoot, 'communitydragon', 'latest', 'en_us', 'arena.json'));

  const entries = [
    ...buildChampionEntries(championZh, championEn),
    ...buildItemEntries(itemZh, itemEn),
    ...buildRuneEntries(runesZh, runesEn),
    ...buildAugmentEntries(arenaZh, arenaEn),
  ];

  const compactEntries = entries.map((entry) => ({
    entryId: entry.entryId,
    sourceCategory: entry.sourceCategory,
    sourceType: entry.sourceType,
    ownerId: entry.ownerId ?? '',
    ownerNameZh: entry.ownerNameZh ?? '',
    nameZh: entry.nameZh,
    primaryGroup: entry.primaryGroup,
    scopeAssessment: entry.scopeAssessment,
    mechanismTags: entry.mechanismTags,
    textPreviewZh: entry.textPreviewZh,
    sourceRef: entry.sourceRef,
  }));

  const tagSummary = countTags(entries);
  const groups = buildGroupIndex(entries);
  const reportSummary = {
    generatedAt: new Date().toISOString(),
    dataDragonVersion: summary.dataDragonVersion,
    entryCount: entries.length,
    bySourceCategory: countBy(entries, (entry) => entry.sourceCategory),
    byScopeAssessment: countBy(entries, (entry) => entry.scopeAssessment),
  };

  const outputDir = path.join(snapshotRoot, '分类汇总');
  await ensureDir(outputDir);

  await writeJson(path.join(outputDir, 'mechanism_taxonomy.json'), {
    groups: GROUP_PRIORITY,
    mechanismTags: MECHANISM_TAGS.map(({ key, cluster, description }) => ({
      key,
      cluster,
      description,
    })),
  });
  await writeJson(path.join(outputDir, 'entry_index.json'), compactEntries);
  await writeJson(path.join(outputDir, 'group_summary.json'), groups);
  await writeJson(path.join(outputDir, 'tag_summary.json'), tagSummary);
  await writeJson(path.join(outputDir, 'summary.json'), reportSummary);
  await writeText(
    path.join(outputDir, 'LoL竞技场静态数据分类汇总.md'),
    buildMarkdownReport(reportSummary, groups, tagSummary, entries),
  );

  console.log(JSON.stringify(reportSummary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

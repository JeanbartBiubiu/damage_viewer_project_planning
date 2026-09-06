import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const write = (file, data) => fs.writeFileSync(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
const plain = value => value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').trim();
const sourceItems = read('地图11装备待录清单.json').items.filter(item => item.scopeCategory === '可购买普通装备候选');
const reviewedIds = '1001 1004 1006 1011 1018 1026 1027 1028 1029 1031 1033 1036 1037 1038 1042 1052 1053 1055 1057 1058 1086 2019 2020 2021 2022 3006 3020 3024 3031 3035 3051 3066 3067 3086 3108 3111 3113 3114 3133 3134 3135 3211 3801 4630 4642 6670 6690'.split(' ');
// 每项为：现有/建议标识、现有目录是否具备、对应Data Dragon字段、该字段是否存小数比例。
const definitions = {
  '移动速度': ['move_speed', true, 'FlatMovementSpeedMod', false],
  '移动速度%': ['move_speed_percent', false, 'PercentMovementSpeedMod', true],
  '基础法力回复%': ['base_mana_regen_percent', false, null, false],
  '基础生命回复%': ['base_hp_regen_percent', false, null, false],
  '生命值': ['hp', true, 'FlatHPPoolMod', false],
  '法力': ['mana', true, 'FlatMPPoolMod', false],
  '护甲': ['armor', true, 'FlatArmorMod', false],
  '魔法抗性': ['magic_resistance', true, 'FlatSpellBlockMod', false],
  '攻击力': ['attack_damage', true, 'FlatPhysicalDamageMod', false],
  '法术强度': ['ability_power', true, 'FlatMagicDamageMod', false],
  '暴击几率%': ['critical_strike_chance', true, 'FlatCritChanceMod', true],
  '攻击速度%': ['bonus_attack_speed_percent', true, 'PercentAttackSpeedMod', true],
  '生命偷取%': ['life_steal_percent', false, 'PercentLifeStealMod', true],
  '全能吸血%': ['omnivamp_percent', false, null, false],
  '技能急速': ['ability_haste', false, null, false],
  '穿甲': ['armor_pen_flat', true, null, false],
  '法术穿透': ['magic_pen_flat', false, null, false],
  '法术穿透%': ['magic_pen_percent', false, null, false],
  '暴击伤害%': ['critical_strike_damage_bonus_percent', false, null, false],
  '护甲穿透%': ['armor_pen_percent', true, null, false],
  '韧性%': ['tenacity_percent', false, null, false],
  '治疗和护盾强度%': ['heal_shield_power_percent', false, null, false],
};
const pure = [];
const notPure = [];
for (const item of sourceItems) {
  const statsBlock = item.description.match(/<stats>([\s\S]*?)<\/stats>/)?.[1];
  const rest = plain(item.description.replace(/<stats>[\s\S]*?<\/stats>/, ''));
  if (!statsBlock || !plain(statsBlock) || rest) {
    notPure.push({ itemId: item.itemId, name: item.name, reason: statsBlock && rest ? '属性以外还有机制或规则说明' : '没有完整属性段，不能认定纯属性' });
    continue;
  }
  if (!reviewedIds.includes(item.itemId)) throw new Error(`未人工核对的新纯属性条目 ${item.itemId}`);
  const matchedSourceFields = new Set();
  const attributes = statsBlock.split(/<br\s*\/?\s*>/i).filter(Boolean).map(line => {
    const match = line.match(/^<attention>([\d.]+)(%)?<\/attention>(.+)$/);
    if (!match) throw new Error(`不能解析属性 ${item.itemId}: ${line}`);
    const value = Number(match[1]);
    const percentage = Boolean(match[2]);
    const name = plain(match[3]);
    const def = definitions[name + (percentage ? '%' : '')];
    if (!def) throw new Error(`未核属性 ${name} ${item.itemId}`);
    const [key, existing, sourceField, sourceIsFraction] = def;
    const sourceStatsValue = sourceField && Object.hasOwn(item.stats, sourceField) ? item.stats[sourceField] : null;
    if (sourceStatsValue !== null) {
      const expected = sourceIsFraction ? value / 100 : value;
      if (Math.abs(expected - sourceStatsValue) > 1e-9) throw new Error(`说明与stats冲突 ${item.itemId} ${name}`);
      matchedSourceFields.add(sourceField);
    }
    const notes = [];
    if (name === '攻击速度') notes.push('这是额外攻击速度百分比，不是每秒基础攻击次数，禁止写入attack_speed。');
    if (name.startsWith('基础') && name.endsWith('回复')) notes.push('以角色基础回复为基数的百分比加成，禁止写入固定hp_regen或mana_regen。');
    if (name === '移动速度' && percentage) notes.push('百分比移速，禁止写入固定move_speed。');
    if (name === '暴击伤害') notes.push('只保留原文+30%的暴击伤害加成；本资料未证实叠加运算，不擅自换成总暴击倍率。');
    return {
      name, value, unit: percentage ? '百分数（10表示10%）' : '固定值',
      valueFraction: percentage ? value / 100 : null,
      sourceText: plain(line), sourceStatsField: sourceField, sourceStatsValue,
      crossCheck: sourceStatsValue !== null ? '说明与stats一致' : '数值取自完整说明；stats缺该字段，不填0',
      existingAttributeKey: existing ? key : null, suggestedNewAttributeKey: existing ? null : key,
      requiresNewAttribute: !existing, notes,
    };
  });
  const unmatchedFields = Object.keys(item.stats).filter(key => !matchedSourceFields.has(key));
  if (unmatchedFields.length) throw new Error(`stats多出未核属性 ${item.itemId}: ${unmatchedFields}`);
  pure.push({
    itemId: item.itemId, proposedKey: item.proposedKey, existingEquipmentKey: item.existingEquipmentKey,
    name: item.name, description: `16.17.1；${attributes.map(a => `${a.name} +${a.value}${a.valueFraction === null ? '' : '%'}`).join('；')}`,
    attributes, requiredSkills: [], needsNewAttributes: attributes.some(a => a.requiresNewAttribute),
    suggestedStatus: attributes.some(a => a.requiresNewAttribute) ? '需补属性目录后完整录入' : '现有属性目录可表达，待页面核单位并保存',
    sourceVersion: '16.17.1', sourceUrl: item.sourceUrl, sourcePointer: item.sourcePointer,
    sourceDescription: item.description, sourceStats: item.stats, imageUrl: item.imageUrl, gold: item.gold, from: item.from,
    reviewBoundary: '逐项核对本版官方说明只有直接固定属性，且所有stats字段与说明一致；不代表核过客户端隐藏机制或装备购买互斥。',
  });
}
if (pure.length !== reviewedIds.length) throw new Error('纯属性候选数改变');
const requiredAttributes = Object.values(pure.flatMap(item => item.attributes.filter(a => a.requiresNewAttribute).map(a => ({ ...a, itemId: item.itemId }))).reduce((out, a) => {
  const key = a.suggestedNewAttributeKey;
  out[key] ??= { suggestedKey: key, name: a.name, unit: a.unit, sourceItemIds: [] };
  out[key].sourceItemIds.push(a.itemId);
  return out;
}, {}));
write('纯属性装备可录清单.json', {
  version: '16.17.1', existingAttributeCatalogSource: '本阶段主任务提供的标识清单；未在本子任务读取数据库或页面单位',
  unitRule: '同时给出原文百分数和小数比例；value按显示单位（例如15表示15%），valueFraction为0.15。页面保存前按现有属性定义选对应表示，不能把同一个百分比乘100两次。',
  counts: { candidateItems: sourceItems.length, pureAttributeItems: pure.length, existingCatalogReady: pure.filter(x => !x.needsNewAttributes).length, needsNewAttributes: pure.filter(x => x.needsNewAttributes).length, newAttributeKinds: requiredAttributes.length, nonPureItems: notPure.length },
  requiredNewAttributes: requiredAttributes, items: pure, excludedFromPureList: notPure,
});

const clientSources = [
  ['perks-16.17-zh_CN.json', 'https://raw.communitydragon.org/16.17/plugins/rcp-be-lol-game-data/global/zh_cn/v1/perks.json'],
  ['perkstyles-16.17-zh_CN.json', 'https://raw.communitydragon.org/16.17/plugins/rcp-be-lol-game-data/global/zh_cn/v1/perkstyles.json'],
];
const perks = read(`客户端提取资料/${clientSources[0][0]}`);
const styles = read(`客户端提取资料/${clientSources[1][0]}`).styles;
const rows = styles[0].slots.filter(slot => slot.type === 'kStatMod');
if (styles.length !== 5 || rows.length !== 3 || rows.some(row => row.perks.length !== 3)) throw new Error('客户端碎片行数不符');
for (const style of styles) if (JSON.stringify(style.slots.filter(slot => slot.type === 'kStatMod')) !== JSON.stringify(rows)) throw new Error('不同符文系的碎片行不一致');
const dd = read('官方原始资料/runesReforged-16.17.1-zh_CN.json');
for (const p of dd) {
  const style = styles.find(s => s.id === p.id);
  if (!style || JSON.stringify(style.slots.slice(0, 4).map(s => s.perks)) !== JSON.stringify(p.slots.map(s => s.runes.map(r => r.id)))) throw new Error(`两来源符文槽位不一致 ${p.id}`);
}
const uniqueShardIds = [...new Set(rows.flatMap(row => row.perks))];
const shardRecords = uniqueShardIds.map(id => {
  const perk = perks.find(p => p.id === id);
  if (!perk) throw new Error(`碎片没有说明 ${id}`);
  return { runeId: id, name: perk.name, shortDescription: perk.shortDesc, longDescription: perk.longDesc,
    descriptionText: plain(perk.longDesc), tooltip: perk.tooltip, iconPath: perk.iconPath,
    sourcePointer: `/${perks.indexOf(perk)}`, sourceUrl: clientSources[0][1],
    unresolvedMeaning: id === 5008 ? ['适应之力在攻击力与法强间的转换和选择规则未由本文件解析'] : id === 5001 ? ['说明仅给出10–180及基于等级；逐等级数值和插值公式未由本文件解析'] : [],
  };
});
const slotChoices = rows.flatMap((row, rowIndex) => row.perks.map((id, optionIndex) => ({
  rowIndex, rowName: row.slotLabel, optionIndex, runeId: id,
  name: shardRecords.find(r => r.runeId === id).name,
  description: shardRecords.find(r => r.runeId === id).descriptionText,
  exclusiveGroup: `rune_shard_row_${rowIndex}`, sourceStyleIds: styles.map(s => s.id),
})));
write('符文属性碎片核对.json', {
  dataDragonVersion: '16.17.1', clientExtractionPatch: '16.17',
  sourceBoundary: 'CommunityDragon是社区维护的客户端资源提取镜像，不是拳头直接发布的Data Dragon。URL固定16.17，且5系62个符文前4槽顺序与Data Dragon16.17.1完全一致；未取得镜像对应客户端精确构建号。',
  counts: { uniqueShards: uniqueShardIds.length, rows: rows.length, slotChoices: slotChoices.length },
  displayDataVerified: true, fullMechanismVerified: false, records: shardRecords, slotChoices,
  inactiveStatRecords: perks.filter(p => p.id >= 5000 && p.id < 6000 && !uniqueShardIds.includes(p.id)).map(p => ({ id: p.id, name: p.name, description: plain(p.longDesc), reason: '保留在perks中，但5系当前kStatMod槽位均不引用，不作为当前可选碎片' })),
  selectionEvidence: { allFiveStylesSameShardRows: true, sixtyTwoRuneSlotsMatchDataDragon: true, allowedSecondaryPaths: styles.map(s => ({ primaryPathId: s.id, allowedSecondaryPathIds: s.allowedSubStyles })), perRowChoiceLimitExplicitInFiles: false, duplicateShardAcrossRowsAllowedBySlots: true },
  systemEntryStatus: '仍缺符文管理入口及选择关系，尚未写入系统',
});
write('补充资料清单.json', {
  purpose: '纯属性装备对照及符文碎片客户端展示资料',
  sources: clientSources.map(([file, url]) => {
    const absolute = path.join(root, '客户端提取资料', file), bytes = fs.readFileSync(absolute);
    return { url, file: `客户端提取资料/${file}`, retrievedAt: fs.statSync(absolute).mtime.toISOString(), byteSize: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }),
  verification: { pureAttributes: pure.length, candidateCoverage: pure.length + notPure.length, allDescriptionRowsParsed: true, allAvailableStatsMatched: true, runeStylesCompared: 5, shardRowsCompared: 15, uniqueShardIds: uniqueShardIds.length, slotChoices: slotChoices.length },
});
console.log(JSON.stringify({ pureAttributes: pure.length, ready: pure.filter(x => !x.needsNewAttributes).length, needNew: pure.filter(x => x.needsNewAttributes).length, requiredAttributes, shardRecords, slotChoices }, null, 2));

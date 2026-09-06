import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// 只从已保存的官方文件生成本目录资料，不调用业务接口、不代表已录入。
const root = path.dirname(fileURLToPath(import.meta.url));
const version = '16.17.1';
const sources = [
  ['item-16.17.1-zh_CN.json', `https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/item.json`],
  ['runesReforged-16.17.1-zh_CN.json', `https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/runesReforged.json`],
  ['versions.json', 'https://ddragon.leagueoflegends.com/api/versions.json'],
];
const read = file => JSON.parse(fs.readFileSync(path.join(root, '官方原始资料', file), 'utf8'));
const write = (file, data) => fs.writeFileSync(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
const items = read(sources[0][0]);
const runePaths = read(sources[1][0]);
if (items.version !== version || !read('versions.json').includes(version)) throw new Error('固定版本校验失败');
const plain = value => String(value ?? '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
const has = (id, ids) => ids.includes(id);
const firstBatchIds = ['1036', '1037', '1038', '1028', '1027', '1029', '1031', '1033', '1052', '1026'];
const currentRelations = { '1055': 'duolan_jian', '1056': 'duolanjie' };
const category = (id, item) => {
  if (!item.maps?.['11']) return ['地图11以外', '本轮范围外', '原始 maps[11] 不是 true；完整保留其他地图标记'];
  if ((+id >= 1501 && +id <= 1524) || has(id, ['2001', '2007', '7050', '771500'])) return ['非玩家或系统占位', '后置', '按名称与不可购买标记核对：建筑、兵线、回城或占位条目'];
  if (item.requiredChampion) return ['英雄专属', '后置', `requiredChampion=${item.requiredChampion}；与对应英雄的约定边界一起处理`];
  if (+id >= 10000 || has(id, ['2051', '3112', '3177', '3184'])) return ['模式归属待核', '资料待核', '地图11标记同时覆盖特殊模式候选；不能凭编号或同名推断为普通峡谷物品'];
  if (has(id, ['3340', '3363', '3364', '2055'])) return ['饰品与视野', '后置', '视野、侦察或守卫对象，保留清单'];
  if (has(id, ['3865', '3866', '3867', '3869', '3870', '3871', '3876', '3877', '3400'])) return ['经济与辅助任务', '后置', '经济、任务升级及视野部分后置；战斗属性和效果仍留作后续拆分核对'];
  if (has(id, ['2010', '2150', '2151', '2152', '2403', '2422'])) return ['符文生成物', '资料待核', '需先对应当前符文来源，不能当普通商店购买装备'];
  if (item.specialRecipe || has(id, ['2421', '3168', '3170', '3171', '3172', '3173', '3174', '3175', '3176'])) return ['特殊升级或使用后形态', '待录', '记录基础物品与升级条件；属性可以先准备，转化条件需逐项核对'];
  if (item.tags?.includes('Consumable') || item.consumed) return ['消耗品', '待核范围', '列出药水、合剂等；不默认为永久装备，不自动排除战斗收益'];
  if (item.gold?.purchasable !== true || item.inStore === false || item.hideFromAll === true) return ['非普通商店条目', '资料待核', '不可购买、不在商店或隐藏；仅凭该标记不判断已移除'];
  if (item.tags?.includes('Jungle')) return ['打野装备与宠物', '待核机制', '固定物品身份保留；召唤与独立对象按已约定排除边界处理'];
  return ['可购买普通装备候选', '待录', 'maps[11]=true、可购买、未隐藏；仍需逐项核对模式和机制，不是客户端可购买证明'];
};
const parsedDescriptionStats = item => {
  const block = item.description.match(/<stats>([\s\S]*?)<\/stats>/)?.[1] ?? '';
  return plain(block).split('\n').map(x => x.trim()).filter(Boolean);
};
const records = Object.entries(items.data).map(([id, item]) => {
  const [scopeCategory, entryStatus, reason] = category(id, item);
  const anomalies = [];
  if (!item.description.trim()) anomalies.push('说明为空');
  if (/\{\{|@[^@]+@/.test(item.description)) anomalies.push('说明含未替换变量');
  if (Object.keys(item.stats).length === 0 && parsedDescriptionStats(item).length) anomalies.push('说明有属性但stats为空');
  if (/<attention>[^<]+<\/attention>技能急速/.test(item.description) && !Object.keys(item.stats).some(key => /Haste/.test(key))) anomalies.push('stats未列出说明中的技能急速');
  if (/\b0(?:<\/[^>]+>)*移动速度/.test(item.description)) anomalies.push('动态显示值为0需核对公式');
  return {
    itemId: id, proposedKey: `item_${id}`, name: plain(item.name), rawName: item.name,
    existingEquipmentKey: currentRelations[id] ?? null,
    sourceVersion: version, sourceLocale: 'zh_CN', sourceUrl: sources[0][1], sourcePointer: `/data/${id}`,
    maps: item.maps, scopeCategory, entryStatus, reason, enteredInSystem: false,
    acquisition: { purchasable: item.gold.purchasable, inStore: item.inStore ?? null, hideFromAll: item.hideFromAll ?? null, requiredChampion: item.requiredChampion ?? null, specialRecipe: item.specialRecipe ?? null, consumed: item.consumed ?? false },
    gold: item.gold, from: item.from ?? [], into: item.into ?? [], tags: item.tags,
    imageUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${item.image.full}`,
    description: item.description, descriptionText: plain(item.description), plaintext: item.plaintext,
    stats: item.stats, descriptionStats: parsedDescriptionStats(item), effect: item.effect ?? null,
    sourceAnomalies: anomalies,
    mechanismReview: firstBatchIds.includes(id) ? '仅固定属性已逐项对照说明与stats；尚未页面保存' : '尚未逐项审查全部机制',
  };
});
const map11 = records.filter(record => record.maps['11']);
const statNames = {
  FlatPhysicalDamageMod: ['攻击力', '固定值'], FlatMagicDamageMod: ['法术强度', '固定值'],
  FlatHPPoolMod: ['生命值', '固定值'], FlatMPPoolMod: ['法力', '固定值'],
  FlatArmorMod: ['护甲', '固定值'], FlatSpellBlockMod: ['魔法抗性', '固定值'],
};
const firstBatch = firstBatchIds.map(id => {
  const item = items.data[id];
  if (!item.maps['11'] || !item.gold.purchasable || item.inStore === false || /<(passive|active)>/.test(item.description)) throw new Error(`第一批范围失败：${id}`);
  const attributes = Object.entries(item.stats).map(([sourceField, value]) => {
    if (!statNames[sourceField]) throw new Error(`第一批未知属性：${sourceField}`);
    const [name, unit] = statNames[sourceField];
    return { sourceField, name, value, unit, application: '装备提供的加成', existingAttributeKey: null };
  });
  return {
    itemId: id, proposedKey: `item_${id}`, name: item.name,
    description: `16.17.1；${attributes.map(a => `${a.name} +${a.value}`).join('；')}`,
    attributes, requiredSkills: [], price: item.gold, from: item.from ?? [],
    sourceUrl: sources[0][1], sourcePointer: `/data/${id}`, sourceDescription: item.description,
    sourceStats: item.stats, imageUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png`,
    entryStatus: '资料已核对，待页面录入',
  };
});
const runeRecords = runePaths.flatMap(p => p.slots.flatMap((slot, slotIndex) => slot.runes.map((rune, optionIndex) => ({
  runeId: rune.id, proposedKey: `rune_${rune.id}`, name: rune.name, key: rune.key,
  pathId: p.id, pathKey: p.key, pathName: p.name, slotIndex,
  slotName: slotIndex === 0 ? '基石' : `小符文第${slotIndex}行`, optionIndex,
  primaryEligible: true, secondaryEligible: slotIndex !== 0,
  sameSlotExclusiveGroup: `rune_path_${p.id}_slot_${slotIndex}`,
  iconUrl: `https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`,
  shortDescription: rune.shortDesc, longDescription: rune.longDesc,
  shortDescriptionText: plain(rune.shortDesc), longDescriptionText: plain(rune.longDesc),
  sourceVersion: version, sourceUrl: sources[1][1], sourcePointer: `/${runePaths.indexOf(p)}/slots/${slotIndex}/runes/${optionIndex}`,
  entryStatus: '系统阻塞', enteredInSystem: false,
  blockers: ['当前无独立符文身份管理入口', '当前无符文系、槽位及主副系选择关系'],
  mechanismReview: '原文完整留存，尚未逐项转为效果与规则',
}))));
const shardSupplementPath = path.join(root, '符文属性碎片核对.json');
const shardSupplement = fs.existsSync(shardSupplementPath) ? JSON.parse(fs.readFileSync(shardSupplementPath, 'utf8')) : null;
const selectionRules = {
  sourceBoundary: '官方文件提供系、槽位、符文标识；以下选择规则另列业务核对项，不伪装成文件直接给出的字段。',
  primary: { pathsChosen: 1, runesPerSlot: 1, slotIndexes: [0, 1, 2, 3] },
  secondary: { pathsChosen: 1, mustDifferFromPrimary: true, runeCount: 2, allowedSlotIndexes: [1, 2, 3], distinctSlotsRequired: true },
  shards: { rowCount: 3, choicesPerRow: 1, independentFromPaths: true, displayContentsVerifiedFromClientMirror: Boolean(shardSupplement) },
  ruleReviewStatus: shardSupplement ? '客户端镜像已证实不同主系允许的副系ID及3行碎片候选；每行选几个及副系两个不同行小符文的完整校验规则仍需核对，当前不实现校验' : '主副系结构与官方说明相符；全部选择约束需补固定版本客户端或完整官方规则证据，当前不实现校验',
  references: ['https://www.riotgames.com/en/news/runes-reforged-technical-retro', 'https://www.leagueoflegends.com/en-us/news/game-updates/patch-14-2-notes/', ...(shardSupplement ? ['https://raw.communitydragon.org/16.17/plugins/rcp-be-lol-game-data/global/zh_cn/v1/perkstyles.json'] : [])],
};
const shards = shardSupplement ? {
  coverage: '3行9个候选位置、7个唯一碎片的客户端展示资料已核对；适应之力转换和成长生命逐等级公式待核',
  complete: false, sourceFileContainsShards: false, exactIdsVerifiedFromClientMirror: true,
  detailsFile: '符文属性碎片核对.json', sourceBoundary: shardSupplement.sourceBoundary,
  records: shardSupplement.records, slotChoices: shardSupplement.slotChoices,
  entryStatus: '系统入口仍阻塞，部分公式资料待核',
} : {
  coverage: '固定版本官方数据来源缺失', complete: false, sourceFileContainsShards: false,
  expectedSlotNames: ['进攻', '灵活', '防御'], exactIdsVerified: false, records: [],
  reason: 'runesReforged.json 只有 5 系的基石与小符文，没有属性碎片，不能声称已完成全部天赋资料。',
  historicalEvidenceOnly: [
    { url: 'https://www.leagueoflegends.com/en-us/news/game-updates/patch-14-2-notes/', note: '14.2 对第2、3行碎片调整，是历史证据，不直接作为16.17.1数值。' },
    { url: 'https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-22-notes/', note: '25.22 又调整移动速度及韧性碎片，说明旧快照不能当当前数值。' },
  ],
  entryStatus: '资料与系统均阻塞',
};
const countBy = (list, field) => list.reduce((counts, record) => { counts[record[field]] = (counts[record[field]] ?? 0) + 1; return counts; }, {});
const manifest = {
  schemaVersion: 'equipment-rune-inventory-v1', fixedVersion: version, locale: 'zh_CN',
  scope: '召唤师峡谷英雄、装备、符文优先；斗魂竞技场与海克斯大乱斗的海克斯后置。本目录负责装备符文资料。',
  sources: sources.map(([file, url]) => {
    const absolute = path.join(root, '官方原始资料', file);
    const bytes = fs.readFileSync(absolute);
    return { url, file: `官方原始资料/${file}`, retrievedAt: fs.statSync(absolute).mtime.toISOString(), byteSize: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }),
  documentation: ['https://developer.riotgames.com/docs/lol#data-dragon', 'https://www.riotgames.com/en/news/runes-reforged-technical-retro'],
  counts: {
    rawItems: records.length, map11FlaggedItems: map11.length, otherMapItems: records.length - map11.length,
    map11Categories: countBy(map11, 'scopeCategory'), map11Status: countBy(map11, 'entryStatus'),
    firstSimpleEquipmentBatch: firstBatch.length,
    runePaths: runePaths.length, keystones: runeRecords.filter(r => r.slotIndex === 0).length,
    minorRunes: runeRecords.filter(r => r.slotIndex > 0).length, totalRuneRecords: runeRecords.length,
    verifiedShardRecords: shardSupplement?.records.length ?? 0,
    verifiedShardSlotChoices: shardSupplement?.slotChoices.length ?? 0,
  },
  completeness: { allRawItemIdsAccountedFor: true, allMap11FlaggedIdsAccountedFor: true, allRuneIdsAccountedFor: true, liveClientItemAvailabilityVerified: false, allRuneMechanismsReviewed: false, shardDisplayCoverageVerifiedFromClientMirror: Boolean(shardSupplement), fullShardMechanismsVerified: false, enteredInSystem: false },
  supplementalManifest: shardSupplement ? '补充资料清单.json' : null,
  oldWikiSnapshot: { path: '../../lol-wiki-current-items', usage: '仅作为后续机制补充；旧333条资料没有与16.17.1证明一致，不混入本轮固定版本属性。' },
};
write('资料清单.json', manifest);
write('装备全量处置清单.json', { version, items: records });
write('地图11装备待录清单.json', { version, scopeNotice: '地图标记候选集，不等同普通峡谷可购买全集。模式未明的条目单独待核。', items: map11 });
write('第一批10件基础装备.json', { version, items: firstBatch });
write('符文待录清单.json', { version, selectionRules, paths: runePaths.map(p => ({ id: p.id, key: p.key, name: p.name, slotRuneIds: p.slots.map(s => s.runes.map(r => r.id)) })), runes: runeRecords, shards });
if (new Set(records.map(r => r.itemId)).size !== records.length || new Set(runeRecords.map(r => r.runeId)).size !== runeRecords.length) throw new Error('标识重复');
console.log(JSON.stringify(manifest.counts, null, 2));

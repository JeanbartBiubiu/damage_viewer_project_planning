import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(root, '客户端原始资料');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, value) => fs.writeFileSync(path.join(root, p), JSON.stringify(value, null, 2) + '\n');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const escapePointer = s => String(s).replaceAll('~', '~0').replaceAll('/', '~1');
const pointer = parts => '/' + parts.map(escapePointer).join('/');
const sourceDefinitions = [
  ['items-16.17.cdtb.bin.json', 'https://raw.communitydragon.org/16.17/game/items.cdtb.bin.json', '16.17', '主证：客户端装备对象、命名数据、计算与说明绑定'],
  ['lol-16.17-zh_CN.stringtable.json', 'https://raw.communitydragon.org/16.17/game/zh_cn/data/menu/en_us/lol.stringtable.json', '16.17', '主证：中文游戏说明，文件内version=5是字符串表格式版本，不是游戏补丁版本'],
  ['items-16.17-zh_CN.json', 'https://raw.communitydragon.org/16.17/plugins/rcp-be-lol-game-data/global/zh_cn/v1/items.json', '16.17', '交叉核对：客户端对外装备列表，说明仍可能省略动态效果'],
  ['官方26.16更新说明.html', 'https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-16-notes/', '26.16', '旁证：星蚀数值、额外攻击力语义；挑战护手基础攻击力语义。不得单独充当16.17快照'],
  ['官方26.17更新说明.html', 'https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-17-notes/', '26.17', '版本公告核对；未检索到星蚀条目，不以没有公告代替当前对象证明'],
  ['globals-16.17.cdtb.bin.json', 'https://raw.communitydragon.org/16.17/game/globals.cdtb.bin.json', '16.17', '探索留档：未找到可直接使用的完整属性枚举定义，不用于填值'],
  ['shared-16.17.cdtb.bin.json', 'https://raw.communitydragon.org/16.17/game/shared.cdtb.bin.json', '16.17', '探索留档：未取得这15件的实际触发脚本，不用于推算缺失规则'],
  ['common-16.17.bin.json', 'https://raw.communitydragon.org/16.17/game/common.bin.json', '16.17', '探索留档：未取得完整属性枚举，不用于填值'],
  ['gameplay-16.17.bin.json', 'https://raw.communitydragon.org/16.17/game/gameplay.bin.json', '16.17', '探索留档：未取得完整属性枚举，不用于填值']
];
const buffers = new Map();
const sources = sourceDefinitions.map(([name, url, version, role]) => {
  const plain = path.join(rawDir, name);
  const compressed = plain + '.gz';
  assert.equal(path.dirname(plain), rawDir);
  const exists = fs.existsSync(plain);
  const bytes = exists ? fs.readFileSync(plain) : zlib.gunzipSync(fs.readFileSync(compressed));
  const timestamp = fs.statSync(exists ? plain : compressed).mtime.toISOString();
  if (!fs.existsSync(compressed)) {
    fs.writeFileSync(compressed, zlib.gzipSync(bytes, { level: 9 }));
    fs.utimesSync(compressed, new Date(timestamp), new Date(timestamp));
  }
  const zipped = fs.readFileSync(compressed);
  assert.equal(sha(zlib.gunzipSync(zipped)), sha(bytes), '压缩后内容必须与下载原文完全一致');
  buffers.set(name, bytes);
  return { 文件: '客户端原始资料/' + name + '.gz', 解压文件名: name, 地址: url, 目录或公告版本: version, 用途: role, 下载文件修改时间UTC: timestamp, 原始字节数: bytes.length, 原始SHA256: sha(bytes), 压缩字节数: zipped.length, 压缩SHA256: sha(zipped) };
});

const itemsName = 'items-16.17.cdtb.bin.json';
const stringsName = 'lol-16.17-zh_CN.stringtable.json';
const bin = JSON.parse(buffers.get(itemsName));
const strings = JSON.parse(buffers.get(stringsName)).entries;
const clientList = JSON.parse(buffers.get('items-16.17-zh_CN.json'));
const manual = read(path.join(root, '逐件补证说明.json'));
const previous = read(path.join(root, '../装备效果候选/装备效果候选.json'));
const gaps = read(path.join(root, '../装备效果候选/未补字段清单.json'));
const ids = Object.keys(manual);
assert.equal(ids.length, 15);
assert.equal(new Set(ids).size, 15);
assert.equal(gaps.blockedItemCount, 104);
const oldGapIds = new Set(gaps.blocked.map(x => x.itemId));
assert.equal(ids.filter(x => oldGapIds.has(x)).length, 14);
assert.equal(oldGapIds.has('1056'), false);
const source = name => sources.find(x => x.解压文件名 === name);
const makeRef = (name, parts, value) => ({ 来源文件: source(name).文件, 来源地址: source(name).地址, 版本: source(name).目录或公告版本, JSON指针: pointer(parts), 原值: value });
const binRef = (id, relative) => {
  const parts = ['Items/' + id, ...relative.split('/').filter(Boolean)];
  let value = bin;
  for (const part of parts) { assert(value && Object.hasOwn(value, part), '不存在的来源字段：' + pointer(parts)); value = value[part]; }
  return makeRef(itemsName, parts, value);
};
const stringRef = key => {
  assert.equal(typeof strings[key], 'string', '不存在的中文说明：' + key);
  return makeRef(stringsName, ['entries', key], strings[key]);
};
const dataRef = (id, key) => {
  const index = bin['Items/' + id].mDataValues.findIndex(x => x.mName === key);
  assert(index >= 0, '不存在的命名数据：' + id + '/' + key);
  return binRef(id, 'mDataValues/' + index);
};
function hash32(name) {
  let value = 2166136261;
  for (const c of name.toLowerCase()) value = Math.imul(value ^ c.charCodeAt(0), 16777619) >>> 0;
  return '{' + value.toString(16).padStart(8, '0') + '}';
}
const hashes = [
  ['MeleeBonusADShieldRatio', '{e367e801}'], ['RangedShieldMult', '{51df2a01}'],
  ['MeleePercMaxHP', '{b1f09313}'], ['RangedPercMaxHPMult', '{4b5548be}'], ['ShieldSplit', '{d02ea590}']
].map(([name, expected]) => {
  assert.equal(hash32(name), expected);
  return { 名称: name, 小写FNV1a计算: expected, 校验: '一致' };
});

const notesHTML = buffers.get('官方26.16更新说明.html').toString('utf8');
const notesSearches = ['8% Melee', '5% Ranged', '150 + 40%', '75 + 20%', '50% of Base Attack Damage'];
for (const term of notesSearches) assert(notesHTML.includes(term), '官方公告定位失败：' + term);
const corroboration = {
  基础攻击力: {
    结论: 'mStat=2、mStatFormula=1在本批基础攻击力公式中的含义有当前对象和官方公告旁证；不依赖旧网页给出的不同枚举顺序。',
    同版本对象: binRef('3053', 'mItemCalculations/BonusAD'),
    命名系数: dataRef('3053', 'ADtoAD'),
    绑定文案: stringRef('item_3053_tooltip'),
    官方旁证: { 来源文件: source('官方26.16更新说明.html').文件, 地址: source('官方26.16更新说明.html').地址, 定位: 'Items → Sterak’s Gage → Bonus Attack Damage；50% of Base Attack Damage', 说明: '公告给出基础攻击力50%，16.17对象ADtoAD也是0.5，且公式mStat=2/mStatFormula=1。' }
  },
  额外攻击力: {
    结论: '星蚀当前护盾公式mStat=2、mStatFormula=2与官方说明的额外攻击力一致，用于本批同枚举公式。',
    同版本对象: binRef('6692', 'mItemCalculations/{d02ea590}'),
    官方旁证: { 来源文件: source('官方26.16更新说明.html').文件, 地址: source('官方26.16更新说明.html').地址, 定位: 'Items → Eclipse → Shield', 说明: '近战150+40%额外攻击力、远程75+20%额外攻击力，与16.17计算字段相同。' }
  },
  法术强度与额外护甲: { 说明: 'NashorsAPValue、LichBaneAPValue和BonusArmorDamageRatio直接命名了属性；其相加结构及数值来自各自当前计算。本批没有声称取得完整客户端属性枚举表，也没有将未出现的枚举值推为新属性。' },
  星蚀伤害: {
    结论: '近战8%、远程5%目标最大生命值物理伤害由16.17正式绑定Tooltip、计算与官方公告互证。外部简介省略了伤害。',
    绑定文案: stringRef('item_6692_tooltip'),
    同版本对象: binRef('6692', 'mItemCalculations/MaxHealthDamageCalc'),
    官方旁证: { 来源文件: source('官方26.16更新说明.html').文件, 地址: source('官方26.16更新说明.html').地址, 定位: 'Items → Eclipse → Damage', 说明: '公告由近战6%/远程4%调整为8%/5%；本次只使用与16.17当前字段相同的调整后数值。' }
  },
  散列字段核对: hashes,
  数值展示: '原始浮点数完整保留；中文说明将0.449999988等表示误差整理为0.45。百分比采用1=100%的小数比例。算术换算有原始被乘数与乘数，不补未知系数。'
};

const attrFieldMap = { ability_haste: 'mAbilityHasteMod', tenacity_percent: 'mPercentTenacityItemMod', lifesteal: 'mPercentLifeStealMod', life_steal: 'mPercentLifeStealMod' };
let checkedAttrs = 0;
const results = ids.map(id => {
  const item = bin['Items/' + id];
  assert(item, '客户端缺装备' + id);
  const old = previous.items.find(x => x.itemId === id);
  assert(old, '冻结候选缺装备' + id);
  const listIndex = clientList.findIndex(x => String(x.id) === id);
  assert(listIndex >= 0, '客户端列表缺装备' + id);
  assert.equal(clientList[listIndex].name, old.name);
  const review = manual[id];
  const claims = review.已证明.map(([text, names, paths, texts]) => ({
    结论: text,
    来源证据: [...names.map(x => dataRef(id, x)), ...paths.map(x => binRef(id, x)), ...texts.map(stringRef)]
  }));
  const attrs = old.directAttributes.map(attr => {
    const field = attr.sourceStatsField ? 'm' + attr.sourceStatsField : attrFieldMap[attr.suggestedAttributeKey];
    const rawValue = field ? item[field] : undefined;
    if (rawValue !== undefined) {
      const expected = attr.valueForFractionConvention;
      assert(Math.abs(rawValue - expected) <= 1e-5, id + '属性差异：' + field + '=' + rawValue + '，冻结值=' + expected);
      checkedAttrs++;
    }
    return { 冻结直接属性: attr, 客户端核对: rawValue === undefined ? '当前对象未定位对应直接字段；仍用冻结来源，不以缺字段填0' : '一致（浮点误差小于0.00001）', ...(rawValue !== undefined ? { 客户端证据: binRef(id, field) } : {}) };
  });
  const locKeys = item.mItemDataClient.mTooltipData.mLocKeys;
  const bound = Object.entries(locKeys).filter(([key]) => /Tooltip/i.test(key)).map(([key, value]) => ({ 绑定字段: binRef(id, 'mItemDataClient/mTooltipData/mLocKeys/' + key), 说明: stringRef(value.toLowerCase()) }));
  for (const key of ['mDescription', 'mDynamicTooltip', 'mShopTooltip']) {
    const value = item.mItemDataClient[key];
    if (value && strings[value.toLowerCase()]) bound.push({ 绑定字段: binRef(id, 'mItemDataClient/' + key), 说明: stringRef(value.toLowerCase()) });
  }
  return {
    装备编号: id, 名称: old.name, 建议对象标识: old.equipmentKey,
    冻结版本: '16.17.1', 客户端目录版本: '16.17', 属于原104件缺项: oldGapIds.has(id),
    原缺项: gaps.blocked.find(x => x.itemId === id)?.requiredEvidence ?? [],
    结论: review.结论, 可用说明: review.可用说明, 直接属性交叉核对: attrs,
    已证明结论: claims, 实际说明绑定: bound,
    原始命名数据: (item.mDataValues ?? []).map((x, index) => binRef(id, 'mDataValues/' + index)),
    未确认字段原值: (review.未确认字段 ?? []).map(x => dataRef(id, x)),
    仍缺: review.仍缺, 运行边界: review.运行边界 ?? [], 禁止采用: review.禁止采用,
    证据层次: review.证据层次,
    客户端对外说明: makeRef('items-16.17-zh_CN.json', [String(listIndex), 'description'], clientList[listIndex].description),
    官方冻结说明: { 地址: old.sourceUrl, 版本: old.sourceVersion, JSON指针: old.sourcePointer + '/description', 原文: old.sourceDescription },
    来源边界: 'CommunityDragon是客户端资料提取分发站，不是拳头官方服务。16.17目录没有声明16.17.1微版本；保留独立版本标记，并逐项核对本批直接属性，不能宣称整个目录与Data Dragon 16.17.1逐字节相同。此补证是静态资料，没有录入、数据库或实际战斗证据。'
  };
});
const closed = results.filter(x => x.属于原104件缺项 && x.结论 === '原明确资料缺口补齐');
assert.equal(closed.length, 6);
const partial = results.filter(x => x.结论 === '部分补齐');
assert.equal(partial.length, 8);
const overview = {
  选定装备: results.length, 原104件中本次覆盖: 14, 原缺项可关闭: closed.length,
  部分补齐仍有缺项: partial.length, 额外复核原明确文案: 1,
  原104件本次未处理: 90, 若采纳本次原缺项关闭后仍需补证: 98,
  原缺项可关闭清单: closed.map(x => ({ 编号: x.装备编号, 名称: x.名称 })),
  保留缺项清单: partial.map(x => ({ 编号: x.装备编号, 名称: x.名称, 仍缺: x.仍缺 })),
  直接属性已交叉核对行数: checkedAttrs,
  原冻结候选SHA256: sha(fs.readFileSync(path.join(root, '../装备效果候选/装备效果候选.json'))),
  原冻结缺项SHA256: sha(fs.readFileSync(path.join(root, '../装备效果候选/未补字段清单.json'))),
  补证说明: '关闭仅指上一轮列出的明确资料缺口已获得本轮静态来源，不代表装备、技能已录入，也不代表战斗运行支持已完成。',
  版本边界: '16.17客户端目录与16.17.1 Data Dragon分别标记；26.16官方公告只用于与当前字段一致的语义旁证，没有拿旧值覆盖当前值。',
  原始资料: sources,
  压缩留档说明: '原文以gzip无损压缩。所有JSON指针指向解压后的原始JSON，原文与压缩文件均记录SHA256；每个压缩文件已回解压核对。'
};
write('逐件补证结果.json', results);
write('仍阻塞项.json', overview.保留缺项清单);
write('来源与覆盖.json', overview);
write('字段语义旁证.json', corroboration);
write('选定原始对象.json', { 装备对象: Object.fromEntries(ids.map(id => ['Items/' + id, bin['Items/' + id]])), 属性语义旁证对象: { 'Items/3053': bin['Items/3053'] } });

const lines = [
  '# 首批15件装备效果补证', '',
  '覆盖原104件缺项中的14件，另按优先要求复核多兰戒1件。6件原明确资料缺口可关闭，8件部分补齐。90件原缺项尚未处理；若采纳本批结果，原104件仍有98件需补证。这里没有业务写入或战斗验证。', '',
  '固定资料仍是Data Dragon 16.17.1；补证单独标记为CommunityDragon提取的16.17客户端目录，目录没有提供16.17.1微版本声明。完整来源、字节摘要与字段指针见同目录JSON。', '',
  '星蚀当前绑定文案包含百分比最大生命物理伤害，官方对外简介省略了这一效果。巫妖之祸正式文案还包含10秒内下一击50%攻速。两项都不能只依据外部简介录入。', '',
  '| 编号 | 装备 | 本次结论 |', '| --- | --- | --- |',
  ...results.map(x => `| ${x.装备编号} | ${x.名称} | ${x.结论} |`), '',
  '| 文件 | 用途 |', '| --- | --- |',
  '| 逐件补证结果.json | 逐件可用文案、直接属性核对、字段原值、JSON指针、绑定关系及仍缺项 |',
  '| 录入参考.md | 便于页面录入的15件说明及禁止混用的字段 |',
  '| 仍阻塞项.json | 8件仍不能补齐的具体字段或规则 |',
  '| 字段语义旁证.json | 基础/额外攻击力与星蚀参数的当前对象及官方公告互证 |',
  '| 选定原始对象.json | 15件完整客户端对象及1件仅用于属性语义旁证的对象 |',
  '| 来源与覆盖.json | 计数、版本边界、9份完整原文无损压缩包及双重摘要 |',
  '| 逐件补证说明.json | 人工逐项阅读的结论，生成脚本不自动猜机制 |',
  '| 生成补证资料.mjs | 只从保存的公开资料生成本目录产物，检查15条覆盖、字段引用与数值一致性 |', '',
  '在本目录运行 `node 生成补证资料.mjs` 可重新核对和生成。本次不新增系统属性、不修改上轮候选、不提交Git。', '',
  '来源：[16.17客户端装备对象](https://raw.communitydragon.org/16.17/game/items.cdtb.bin.json)、[16.17中文说明](https://raw.communitydragon.org/16.17/game/zh_cn/data/menu/en_us/lol.stringtable.json)、[拳头26.16公告](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-16-notes/)。', ''
];
fs.writeFileSync(path.join(root, 'README.md'), lines.join('\n'));
const reference = ['# 15件装备页面录入参考', '', '以下为静态资料候选。只采用“已证明”部分，仍缺项不填猜测值。每件的来源和原始字段见逐件补证结果.json。', ''];
for (const x of results) {
  reference.push(`## ${x.装备编号} ${x.名称}`, '', x.可用说明, '', `资料状态：${x.结论}。`, '');
  if (x.仍缺.length) reference.push('仍缺：', '', ...x.仍缺.map(v => '- ' + v), '');
  reference.push('不可混用：', '', ...x.禁止采用.map(v => '- ' + v), '');
  if (x.运行边界.length) reference.push('运行边界：' + x.运行边界.join('；') + '。', '');
}
fs.writeFileSync(path.join(root, '录入参考.md'), reference.join('\n'));
console.log(JSON.stringify({ 装备: results.length, 原缺项覆盖: 14, 原缺项可关闭: closed.length, 仍部分缺项: partial.length, 额外复核: 1, 已核对直接属性: checkedAttrs, 命名与计算及说明引用: results.reduce((sum, x) => sum + x.已证明结论.reduce((a, c) => a + c.来源证据.length, 0), 0), 压缩源文件数: sources.length, 原文字节: sources.reduce((s, x) => s + x.原始字节数, 0), 压缩字节: sources.reduce((s, x) => s + x.压缩字节数, 0) }));

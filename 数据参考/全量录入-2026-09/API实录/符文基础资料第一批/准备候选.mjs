import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../装备符文');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(source, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(here, name), `${JSON.stringify(value, null, 2)}\n`);
const clean = value => String(value ?? '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p\s*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
const inventory = read('符文待录清单.json');
const shards = read('符文属性碎片核对.json');
const official = read('官方原始资料/runesReforged-16.17.1-zh_CN.json');
const perks = read('客户端提取资料/perks-16.17-zh_CN.json');
const styles = read('客户端提取资料/perkstyles-16.17-zh_CN.json').styles;
const manifestSources = [...read('资料清单.json').sources, ...read('补充资料清单.json').sources];
const expectedRaw = ['官方原始资料/runesReforged-16.17.1-zh_CN.json', '客户端提取资料/perks-16.17-zh_CN.json', '客户端提取资料/perkstyles-16.17-zh_CN.json'];
const verifiedSources = expectedRaw.map(file => {
  const entry = manifestSources.find(item => item.file === file); assert(entry, file);
  const bytes = fs.readFileSync(path.join(source, file));
  assert.equal(hash(bytes), entry.sha256, `原始资料摘要变化: ${file}`); assert.equal(bytes.length, entry.byteSize);
  return { ...entry, verified: true };
});
const derivedSources = ['资料清单.json', '补充资料清单.json', '符文待录清单.json', '符文属性碎片核对.json'].map(file => ({ file, sha256: hash(fs.readFileSync(path.join(source, file))) }));
assert.equal(inventory.version, '16.17.1'); assert.equal(shards.clientExtractionPatch, '16.17');
assert.equal(inventory.runes.length, 62); assert.equal(shards.records.length, 7); assert.equal(official.length, 5);
const perkMap = new Map(perks.map((item, index) => [item.id, { item, index }]));
const stylesById = new Map(styles.map((item, index) => [item.id, { item, index }]));
const officialMap = new Map(official.flatMap((entry, pathIndex) => entry.slots.flatMap((slot, slotIndex) => slot.runes.map((rune, optionIndex) => [rune.id, { rune, pathId: entry.id, pathIndex, slotIndex, optionIndex }]))));
const imageUrl = iconPath => {
  assert(iconPath.startsWith('/lol-game-data/assets/'));
  return `https://raw.communitydragon.org/16.17/plugins/rcp-be-lol-game-data/global/default/${iconPath.slice('/lol-game-data/assets/'.length).toLowerCase()}`;
};
const runeEntries = inventory.runes.map(entry => {
  const raw = officialMap.get(entry.runeId); assert(raw); assert.equal(raw.rune.name, entry.name);
  assert.equal(raw.slotIndex, entry.slotIndex); assert.equal(raw.optionIndex, entry.optionIndex); assert.equal(raw.pathId, entry.pathId);
  assert.equal(entry.proposedKey, `rune_${entry.runeId}`);
  const description = clean(raw.rune.longDesc || raw.rune.shortDesc);
  assert.equal(description, entry.longDescriptionText || entry.shortDescriptionText, `说明清洗不一致:${entry.runeId}`);
  const client = perkMap.get(entry.runeId); assert(client?.item.iconPath);
  return { id: entry.runeId, body: { runeKey: entry.proposedKey, name: clean(raw.rune.name), description: description || null, category: raw.slotIndex === 0 ? 'KEYSTONE' : 'MINOR' }, source: { file: expectedRaw[0], pointer: `/${raw.pathIndex}/slots/${raw.slotIndex}/runes/${raw.optionIndex}`, shortDescription: clean(raw.rune.shortDesc), rawShortDescription: raw.rune.shortDesc, rawLongDescription: raw.rune.longDesc, iconPath: client.item.iconPath, iconSourceFile: expectedRaw[1], iconSourcePointer: `/${client.index}/iconPath`, fixedIconUrl: imageUrl(client.item.iconPath), officialIconUrl: entry.iconUrl } };
});
for (const entry of shards.records) {
  const client = perkMap.get(entry.runeId); assert(client); assert.equal(client.item.name, entry.name); assert.equal(client.item.iconPath, entry.iconPath);
  const description = clean(client.item.longDesc || client.item.shortDesc || entry.longDescription);
  assert.equal(description, entry.descriptionText);
  runeEntries.push({ id: entry.runeId, body: { runeKey: `rune_${entry.runeId}`, name: clean(entry.name), description: description || null, category: 'SHARD' }, source: { file: expectedRaw[1], pointer: `/${client.index}`, rawLongDescription: entry.longDescription, iconPath: entry.iconPath, fixedIconUrl: imageUrl(entry.iconPath), unresolvedMeaning: entry.unresolvedMeaning } });
}
const paths = official.map((entry, index) => {
  const client = stylesById.get(entry.id); assert(client);
  const slots = entry.slots.map((slot, slotIndex) => {
    assert.deepEqual(slot.runes.map(rune => rune.id), client.item.slots[slotIndex].perks);
    return { name: slotIndex === 0 ? '基石' : clean(client.item.slots[slotIndex].slotLabel), category: slotIndex === 0 ? 'KEYSTONE' : 'MINOR', runeKeys: slot.runes.map(rune => `rune_${rune.id}`) };
  });
  assert.equal(slots.length, 4);
  return { id: entry.id, body: { pathKey: `rune_path_${entry.id}`, name: clean(entry.name), description: clean(client.item.tooltip) || null, kind: 'RUNE_PATH', sortOrder: index, slots }, source: { file: expectedRaw[0], pointer: `/${index}`, detailFile: expectedRaw[2], detailPointer: `/styles/${client.index}`, iconPath: client.item.iconPath, fixedIconUrl: imageUrl(client.item.iconPath) } };
});
const firstStyle = styles[0];
const shardSlots = firstStyle.slots.slice(4).map(slot => ({ name: clean(slot.slotLabel), category: 'SHARD', runeKeys: slot.perks.map(id => `rune_${id}`) }));
for (const style of styles) assert.deepEqual(style.slots.slice(4).map(slot => ({ name: clean(slot.slotLabel), category: 'SHARD', runeKeys: slot.perks.map(id => `rune_${id}`) })), shardSlots);
assert.deepEqual(shards.slotChoices.map(entry => entry.runeId), shardSlots.flatMap(slot => slot.runeKeys.map(key => Number(key.slice(5)))));
paths.push({ id: null, body: { pathKey: 'rune_shards', name: '属性碎片', description: null, kind: 'SHARD_GROUP', sortOrder: paths.length, slots: shardSlots }, source: { file: expectedRaw[2], pointer: '/styles/0/slots', note: '五系共同的后三槽合并为一个碎片组；名称为现有中文管理术语；源未给独立分组说明和图标，保持null，不制作替代图片。' } });
assert.equal(new Set(runeEntries.map(entry => entry.body.runeKey)).size, 69);
assert.equal(new Set(runeEntries.map(entry => entry.body.name.toLocaleLowerCase())).size, 69);
assert.equal(paths.flatMap(entry => entry.body.slots).length, 23);
assert.equal(paths.flatMap(entry => entry.body.slots).flatMap(slot => slot.runeKeys).length, 71);
const byKey = new Map(runeEntries.map(entry => [entry.body.runeKey, entry.body]));
const ordinaryPositions = new Set();
for (const entry of [...runeEntries, ...paths]) {
  assert(entry.body.name.length && entry.body.name.length <= 100); assert((entry.body.description?.length ?? 0) <= 2000);
  assert(!/[<>]/.test(entry.body.description ?? ''), entry.body.name);
}
for (const entry of paths) for (const slot of entry.body.slots) {
  assert(slot.name.length && slot.name.length <= 100); assert.equal(new Set(slot.runeKeys).size, slot.runeKeys.length);
  for (const key of slot.runeKeys) { assert.equal(byKey.get(key)?.category, slot.category); if (slot.category !== 'SHARD') { assert(!ordinaryPositions.has(key)); ordinaryPositions.add(key); } }
}
const counts = { runes: runeEntries.length, keystones: runeEntries.filter(entry => entry.body.category === 'KEYSTONE').length, minors: runeEntries.filter(entry => entry.body.category === 'MINOR').length, uniqueShards: runeEntries.filter(entry => entry.body.category === 'SHARD').length, paths: paths.length, slots: 23, positions: 71, requestedImages: 74 };
const candidate = { schema: '符文基础资料候选第一批', version: { official: '16.17.1', clientMirror: '16.17', clientExactBuild: null }, status: '仅候选未写入', counts, runes: runeEntries, paths, note: '所有69身份保留目录布局；说明只是冻结展示资料，不代表机制已配置。技能挂载、参数公式效果触发、玩家选择规则均未录入。' };
write('候选与来源.json', candidate);
write('冻结来源.json', { verifiedSources, derivedSources, verifiedAt: new Date().toISOString(), candidateSha256: hash(fs.readFileSync(path.join(here, '候选与来源.json'))) });
write('符文请求.json', runeEntries.map(entry => entry.body));
write('分组请求.json', paths.map(entry => entry.body));
const images = [...runeEntries.map(entry => ({ kind: 'rune', key: entry.body.runeKey, name: entry.body.name, source: entry.source })), ...paths.filter(entry => entry.source.fixedIconUrl).map(entry => ({ kind: 'runePath', key: entry.body.pathKey, name: entry.body.name, source: entry.source }))].map(entry => ({ ...entry, proposedImageKey: entry.key, proposedImageName: `${entry.kind === 'rune' ? '符文' : '符文分组'}·${entry.name}`, primaryUrl: entry.source.fixedIconUrl, fallbackUrl: entry.source.officialIconUrl ?? null, rawFile: `原始图片/${entry.key}.png`, preparedFile: `页面图片/${entry.key}.png` }));
write('图片候选.json', images);
write('页面种子.json', { rune: byKey.get('rune_8005'), runePng: '页面图片/rune_8005.png', partialPath: { ...paths.find(entry => entry.id === 8000).body, slots: [{ name: '基石', category: 'KEYSTONE', runeKeys: ['rune_8005'] }] }, shard: byKey.get('rune_5008'), shardPng: '页面图片/rune_5008.png', partialShardPath: { ...paths.at(-1).body, slots: [{ name: '进攻', category: 'SHARD', runeKeys: ['rune_5008'] }, { name: '灵活', category: 'SHARD', runeKeys: ['rune_5008'] }] }, warning: '此处布局仅供首次真实页面验收，目录补齐后须用分组请求.json整体替换；不是最终完整布局。' });
console.log(JSON.stringify({ counts, candidateSha256: hash(fs.readFileSync(path.join(here, '候选与来源.json'))), seed: byKey.get('rune_8005') }, null, 2));

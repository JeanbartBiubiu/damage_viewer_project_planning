import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const parse = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const manifest = await parse('来源清单.json');
const inventory = await parse('英雄资料清单.json');
const queue = (await readFile(resolve(root, '录入进度.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
for (const source of manifest.sourceFiles) {
  const bytes = await readFile(resolve(root, source.path));
  if (bytes.length !== source.byteSize || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`原始资料变化：${source.path}`);
}
const ids = inventory.champions.map(champion => champion.sourceChampionId);
if (new Set(ids).size !== manifest.statistics.championCount) throw new Error('英雄数量或唯一性不符');
if (inventory.champions.some(champion => champion.skills.length !== 5)) throw new Error('技能槽数量不符');
if (queue.length !== ids.length * 6 || new Set(queue.map(entry => entry.entryKey)).size !== queue.length) throw new Error('录入进度缺项或重复');
for (const champion of inventory.champions) {
  if (['Sylas', 'Aphelios'].includes(champion.sourceChampionId) && champion.entryStatus !== '约定排除') throw new Error('明确排除项状态错误');
  for (const locale of ['zh_CN', 'en_US']) {
    const file = await parse(`原始资料/${locale}/champion/${champion.sourceChampionId}.json`);
    if (file.version !== inventory.sourceVersion || file.data[champion.sourceChampionId].spells.length !== 4) throw new Error('详情版本或技能槽不符');
  }
}
let growthSourceFiles = 0;
if (await access(resolve(root, '攻击力成长交叉核对.json')).then(() => true, () => false)) {
  const supplement = await parse('攻击力成长交叉核对.json');
  for (const source of supplement.sourceFiles) {
    const bytes = await readFile(resolve(root, source.path));
    if (bytes.length !== source.byteSize || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`成长补充来源变化：${source.path}`);
    growthSourceFiles += 1;
  }
  for (const hero of supplement.heroes) {
    const current = await parse(hero.currentClientRecord.source.path);
    const growth = current[hero.currentClientRecord.recordKey].damagePerLevelModifiable.baseValue;
    if (growth !== hero.supportedAttackDamageGrowth) throw new Error('交叉核对成长值与原始资料不符');
  }
}
let verifiedRootRecords = 0;
let verifiedTemporaryResponses = 0;
let verifiedLevelMaps = 0;
if (await access(resolve(root, '全英雄成长核对.json')).then(() => true, () => false)) {
  const supplement = await parse('全英雄成长核对.json');
  if (supplement.heroes.length !== ids.length || new Set(supplement.heroes.map(hero => hero.sourceChampionId)).size !== ids.length) throw new Error('全英雄根记录清单覆盖不符');
  for (const hero of supplement.heroes) {
    const bytes = await readFile(resolve(root, hero.recordPath));
    if (createHash('sha256').update(bytes).digest('hex') !== hero.recordSha256) throw new Error(`角色根记录变化：${hero.recordPath}`);
    const extracted = JSON.parse(bytes.toString('utf8'));
    if (extracted.record.__type !== 'CharacterRecord' || extracted.record.mCharacterName.toLowerCase() !== hero.sourceChampionId.toLowerCase()) throw new Error('根记录英雄身份不符');
    const growth = extracted.record.damagePerLevelModifiable?.baseValue ?? null;
    if (growth !== hero.clientAttackDamageGrowth || extracted.record.baseDamageModifiable.baseValue !== hero.clientBaseAttackDamage) throw new Error('全英雄成长汇总与根记录不符');
    if (await access(resolve(root, hero.source.path)).then(() => true, () => false)) {
      const rawBytes = await readFile(resolve(root, hero.source.path));
      if (rawBytes.length !== hero.source.byteSize || createHash('sha256').update(rawBytes).digest('hex') !== hero.source.sha256) throw new Error(`客户端全响应变化：${hero.source.path}`);
      const raw = JSON.parse(rawBytes.toString('utf8'));
      if (JSON.stringify(raw[hero.recordKey]) !== JSON.stringify(extracted.record)) throw new Error('提取根对象与客户端全响应不符');
      verifiedTemporaryResponses++;
    }
    verifiedRootRecords++;
  }
}
if (await access(resolve(root, '等级属性候选索引.json')).then(() => true, () => false)) {
  const candidates = await parse('等级属性候选索引.json');
  if (candidates.heroes.length !== ids.length) throw new Error('等级候选英雄覆盖不符');
  for (const hero of candidates.heroes) {
    const candidate = await parse(hero.path);
    for (const attribute of candidate.attributes) {
      if (Object.keys(attribute.levelValues).join(',') !== Array.from({ length: 18 }, (_, i) => i + 1).join(',')) throw new Error('候选等级必须恰好覆盖 1–18');
      let accumulatedGrowth = 0;
      for (let level = 1; level <= 18; level++) {
        if (level >= 2) accumulatedGrowth += 0.65 + 0.035 * level;
        const expected = attribute.formula === '常量基础值' ? attribute.base : attribute.formula === '攻速独立收益系数' ? attribute.base + attribute.attackSpeedRatio * attribute.growthPercent / 100 * accumulatedGrowth : attribute.base + attribute.growth * accumulatedGrowth;
        const actual = attribute.levelValues[String(level)];
        if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.000001) throw new Error(`候选等级数值不符：${hero.sourceChampionId}/${attribute.sourceAttributeKey}/${level}`);
      }
      verifiedLevelMaps++;
    }
  }
}
console.log(JSON.stringify({ verifiedSourceFiles: manifest.sourceFiles.length, verifiedGrowthSupplementSourceFiles: growthSourceFiles, verifiedRootRecords, verifiedAvailableFullClientResponses: verifiedTemporaryResponses, verifiedLevelMaps, champions: ids.length, sourceSkillSlots: ids.length * 5, progressEntries: queue.length, sourceStatistics: manifest.statistics }, null, 2));

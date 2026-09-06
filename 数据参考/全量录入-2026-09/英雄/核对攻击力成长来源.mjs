import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const evidencePath = '攻击力成长交叉核对.json';
if (await access(resolve(root, evidencePath)).then(() => true, () => false)) throw new Error('三名英雄的交叉来源已冻结，不覆盖。');
const files = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function collect(url, path) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const json = JSON.parse(bytes.toString('utf8'));
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), bytes);
  const source = { url, path, byteSize: bytes.length, sha256: sha256(bytes), fetchedAt: new Date().toISOString() };
  files.push(source);
  return { json, source };
}
const currentMetadata = await collect('https://raw.communitydragon.org/16.17/content-metadata.json', '成长补充原始资料/16.17/content-metadata.json');
const oldMetadata = await collect('https://raw.communitydragon.org/16.1/content-metadata.json', '成长补充原始资料/16.1/content-metadata.json');
if (!currentMetadata.json.version.startsWith('16.17.')) throw new Error('补充来源并非 16.17 版本');
const heroes = [];
for (const id of ['Garen', 'Ashe', 'Ezreal']) {
  const slug = id.toLowerCase();
  const current = await collect(`https://raw.communitydragon.org/16.17/game/data/characters/${slug}/${slug}.bin.json`, `成长补充原始资料/16.17/${slug}.bin.json`);
  const legacy = await collect(`https://raw.communitydragon.org/16.1/game/data/characters/${slug}/${slug}.bin.json`, `成长补充原始资料/16.1/${slug}.bin.json`);
  const legacyOfficial = await collect(`https://ddragon.leagueoflegends.com/cdn/16.1.1/data/en_US/champion/${id}.json`, `成长补充原始资料/16.1.1/${id}.json`);
  const currentOfficial = JSON.parse(await readFile(resolve(root, `原始资料/en_US/champion/${id}.json`), 'utf8'));
  const recordKey = `Characters/${id}/CharacterRecords/Root`;
  const record = current.json[recordKey];
  const oldRecord = legacy.json[recordKey];
  const oldOfficialStats = legacyOfficial.json.data[id].stats;
  const officialStats = currentOfficial.data[id].stats;
  if (record?.__type !== 'CharacterRecord' || record.mCharacterName !== id || oldRecord?.__type !== 'CharacterRecord') throw new Error(`${id} 角色根记录不匹配`);
  if (record.damagePerLevelModifiable?.__type !== 'ModifiableFloat' || !Number.isFinite(record.damagePerLevelModifiable.baseValue)) throw new Error(`${id} 当前成长字段形态异常`);
  if (oldRecord.damagePerLevel !== oldOfficialStats.attackdamageperlevel || oldRecord.baseDamage !== oldOfficialStats.attackdamage) throw new Error(`${id} 旧版官方字段与角色根记录无法交叉对应`);
  if (record.baseDamageModifiable.baseValue !== officialStats.attackdamage) throw new Error(`${id} 当前基础攻击力不一致，需人工核对`);
  heroes.push({
    sourceChampionId: id,
    currentClientRecord: { source: current.source, recordKey, recordType: record.__type, characterName: record.mCharacterName, baseDamageModifiable: record.baseDamageModifiable, damagePerLevelModifiable: record.damagePerLevelModifiable },
    currentOfficialDataDragon: { path: `原始资料/en_US/champion/${id}.json`, version: currentOfficial.version, attackdamage: officialStats.attackdamage, attackdamageperlevel: officialStats.attackdamageperlevel },
    historicalFieldCrossCheck: { clientSource: legacy.source, officialSource: legacyOfficial.source, recordKey, clientBaseDamage: oldRecord.baseDamage, clientDamagePerLevel: oldRecord.damagePerLevel, officialAttackDamage: oldOfficialStats.attackdamage, officialAttackDamagePerLevel: oldOfficialStats.attackdamageperlevel, valuesMatch: true },
    supportedAttackDamageGrowth: record.damagePerLevelModifiable.baseValue,
    conclusion: '当前角色根记录的成长原值已冻结；历史相同角色根记录字段与当期官方攻击力成长一致，当前基础攻击力也与官方一致，支持将当前包装字段的 baseValue 作为攻击力成长补证。',
    remainingBoundary: '这是客户端提取文件和历史字段的交叉证据，不是对游戏引擎源码或实际对局进行验证；16.17 与 16.17.1 是相同补丁号的不同资料版本标识，未证明构建字节完全一致。',
    existingSystemDataStatus: id === 'Ezreal' ? '上一阶段伊泽瑞尔攻击力成长为 0 的录入结果需要主任务重新核对，本子任务未读写数据库。' : '未读写数据库，交由页面录入时使用并核对。',
  });
}
const evidence = {
  schemaVersion: 1, frozenAt: new Date().toISOString(),
  sourceKind: 'CommunityDragon 从 Riot 游戏客户端提取的数据，非 Riot 官方接口，不是 Wiki 转述',
  sourceDocumentation: 'https://github.com/CommunityDragon/Docs/blob/master/assets.md',
  sourceVersion: { currentClientContent: currentMetadata.json.version, primaryDataDragon: '16.17.1', historicalClientContent: oldMetadata.json.version, historicalDataDragon: '16.1.1' },
  purpose: '只核对盖伦、艾希、伊泽瑞尔攻击力成长的来源，不展开技能解析，不进行业务录入。',
  affectedScope: { suspiciousOfficialChampionCount: 173, crossCheckedChampionCount: 3, otherChampionCountStillToCheck: 170, inScopeChampionCountStillToCheck: 168 },
  rootCauseStatus: '字段包装变更而官方静态资料仍输出零可能与提取适配有关，尚无生成器证据，不能认定根因。',
  heroes, sourceFiles: files.sort((a, b) => a.path.localeCompare(b.path)),
};
await writeFile(resolve(root, evidencePath), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
const inventory = JSON.parse(await readFile(resolve(root, '英雄资料清单.json'), 'utf8'));
for (const hero of heroes) {
  const item = inventory.champions.find(champion => champion.sourceChampionId === hero.sourceChampionId);
  item.attributeReview.attackdamageperlevel = {
    status: '已补充来源，待页面核对', rawValue: item.rawBaseStats.attackdamageperlevel,
    supportedValue: hero.supportedAttackDamageGrowth,
    evidencePath, source: hero.currentClientRecord.source,
    recordKey: hero.currentClientRecord.recordKey,
    fieldPath: 'damagePerLevelModifiable.baseValue',
    reason: '官方原始零值未覆盖；使用同补丁客户端提取字段及旧版官方对应值交叉补证。',
  };
}
await writeFile(resolve(root, '英雄资料清单.json'), `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
const firstFive = JSON.parse(await readFile(resolve(root, '首批五名英雄.json'), 'utf8'));
firstFive.champions = firstFive.champions.map(item => inventory.champions.find(champion => champion.sourceChampionId === item.sourceChampionId));
await writeFile(resolve(root, '首批五名英雄.json'), `${JSON.stringify(firstFive, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ sourceFiles: files.length, version: evidence.sourceVersion, heroes: heroes.map(hero => ({ id: hero.sourceChampionId, base: hero.currentClientRecord.baseDamageModifiable.baseValue, growth: hero.supportedAttackDamageGrowth, oldOfficialGrowth: hero.historicalFieldCrossCheck.officialAttackDamagePerLevel })) }, null, 2));

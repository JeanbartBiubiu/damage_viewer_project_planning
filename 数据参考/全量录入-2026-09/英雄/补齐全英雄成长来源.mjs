import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const exists = path => access(resolve(root, path)).then(() => true, () => false);
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const writeJson = async (path, value) => { await mkdir(dirname(resolve(root, path)), { recursive: true }); await writeFile(resolve(root, path), JSON.stringify(value, null, 2) + '\n', 'utf8'); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
if (await exists('全英雄成长核对.json')) throw new Error('全英雄成长来源已冻结，不覆盖。');
const inventory = await readJson('英雄资料清单.json');
const firstThree = await readJson('攻击力成长交叉核对.json');
const contentVersion = firstThree.sourceVersion.currentClientContent;
const metadataUrl = 'https://raw.communitydragon.org/16.17/content-metadata.json';
async function fetchBytes(url) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) { last = error; if (attempt < 3) await new Promise(done => setTimeout(done, attempt * 800)); }
  }
  throw last;
}
const metadataBefore = await fetchBytes(metadataUrl);
if (JSON.parse(metadataBefore).version !== contentVersion) throw new Error('16.17 目录内容版本已变化，先核对版本再继续');
const rows = [];
let next = 0;
let complete = 0;
const finiteField = (record, key) => Number.isFinite(record[key]?.baseValue) ? record[key].baseValue : null;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < inventory.champions.length) {
    const champion = inventory.champions[next++];
    const id = champion.sourceChampionId;
    const previous = firstThree.heroes.find(hero => hero.sourceChampionId === id);
    const url = `https://raw.communitydragon.org/16.17/game/data/characters/${id.toLowerCase()}/${id.toLowerCase()}.bin.json`;
    let bytes, source;
    if (previous) {
      source = { ...previous.currentClientRecord.source, storage: '保留的完整原始响应' };
      bytes = await readFile(resolve(root, source.path));
      if (sha256(bytes) !== source.sha256) throw new Error(`首批原始文件变化：${id}`);
    } else {
      const tempPath = `.临时原始响应/16.17/${id}.bin.json`;
      bytes = await fetchBytes(url);
      await mkdir(dirname(resolve(root, tempPath)), { recursive: true });
      await writeFile(resolve(root, tempPath), bytes);
      source = { url, path: tempPath, storage: '忽略提交的完整原始响应，可按URL复现', byteSize: bytes.length, sha256: sha256(bytes), fetchedAt: new Date().toISOString() };
    }
    const raw = JSON.parse(bytes.toString('utf8'));
    const candidates = Object.entries(raw).filter(([key, value]) => value?.__type === 'CharacterRecord' && /\/CharacterRecords\/Root$/i.test(key) && String(value.mCharacterName).toLowerCase() === id.toLowerCase());
    if (candidates.length !== 1) throw new Error(`${id} 角色根记录未唯一对应，发现 ${candidates.length} 项`);
    const [recordKey, record] = candidates[0];
    const base = finiteField(record, 'baseDamageModifiable');
    const growth = finiteField(record, 'damagePerLevelModifiable');
    const issues = [];
    if (base === null) issues.push('客户端基础攻击力字段缺失或不是有限数值');
    if (growth === null) issues.push('客户端攻击力成长字段缺失或不是有限数值，不补零');
    if (base !== null && Math.abs(base - champion.rawBaseStats.attackdamage) > 0.0001) issues.push('客户端与官方基础攻击力不一致，需核对');
    if (growth !== null && (growth < 0 || growth > 20)) issues.push('客户端成长超出本轮合理性检查范围，需核对');
    const recordPath = `角色根记录/${id}.json`;
    const extracted = { schemaVersion: 1, sourceChampionId: id, sourceNumericId: champion.sourceNumericId, clientContentVersion: contentVersion, source, recordKey, record };
    await writeJson(recordPath, extracted);
    const recordBytes = await readFile(resolve(root, recordPath));
    rows.push({ sourceChampionId: id, sourceNumericId: champion.sourceNumericId, chineseChampionName: champion.chineseChampionName, recordPath, recordSha256: sha256(recordBytes), source, recordKey, clientBaseAttackDamage: base, officialBaseAttackDamage: champion.rawBaseStats.attackdamage, clientAttackDamageGrowth: growth, officialRawAttackDamageGrowth: champion.rawBaseStats.attackdamageperlevel, idAligned: true, baseMatchesOfficial: base !== null && Math.abs(base - champion.rawBaseStats.attackdamage) <= 0.0001, status: issues.length ? '需核对' : '已补充来源，待页面核对', issues });
    complete++;
    if (complete % 25 === 0 || complete === inventory.champions.length) console.log(`角色根记录 ${complete}/${inventory.champions.length}`);
  }
}));
const metadataAfter = await fetchBytes(metadataUrl);
if (sha256(metadataBefore) !== sha256(metadataAfter)) throw new Error('采集期间版本元数据发生变化，请核对后再生成清单');
rows.sort((a, b) => a.sourceChampionId.localeCompare(b.sourceChampionId));
const result = {
  schemaVersion: 1, frozenAt: new Date().toISOString(), clientContentVersion: contentVersion, primaryDataDragonVersion: '16.17.1',
  sourceKind: firstThree.sourceKind,
  fieldMeaningEvidence: '攻击力成长交叉核对.json',
  boundary: '沿用三名英雄已交叉核对的角色根字段含义；保留完整角色根子对象及全响应摘要，不解析技能，不写入业务数据库；资料版本标识相同补丁号但不保证构建字节相同。',
  metadata: { url: metadataUrl, version: contentVersion, sha256: sha256(metadataBefore), unchangedDuringCollection: true },
  statistics: { championCount: rows.length, alignedIdCount: rows.filter(row => row.idAligned).length, matchedBaseAttackDamageCount: rows.filter(row => row.baseMatchesOfficial).length, finiteGrowthCount: rows.filter(row => row.clientAttackDamageGrowth !== null).length, explicitZeroGrowthCount: rows.filter(row => row.clientAttackDamageGrowth === 0).length, issueChampionCount: rows.filter(row => row.issues.length).length },
  heroes: rows,
};
await writeJson('全英雄成长核对.json', result);
for (const row of rows) {
  const champion = inventory.champions.find(item => item.sourceChampionId === row.sourceChampionId);
  champion.attributeReview.attackdamageperlevel = { status: row.status, rawValue: champion.rawBaseStats.attackdamageperlevel, supportedValue: row.issues.length ? null : row.clientAttackDamageGrowth, evidencePath: '全英雄成长核对.json', recordPath: row.recordPath, recordKey: row.recordKey, fieldPath: 'damagePerLevelModifiable.baseValue', reason: row.issues.length ? row.issues.join('；') : '同补丁客户端角色根记录已与英雄ID、官方基础攻击力对齐，沿用三名英雄交叉核对的成长字段含义。' };
}
await writeJson('英雄资料清单.json', inventory);
const firstFive = await readJson('首批五名英雄.json');
firstFive.champions = firstFive.champions.map(item => inventory.champions.find(champion => champion.sourceChampionId === item.sourceChampionId));
await writeJson('首批五名英雄.json', firstFive);
console.log(JSON.stringify({ statistics: result.statistics, issues: rows.filter(row => row.issues.length) }, null, 2));

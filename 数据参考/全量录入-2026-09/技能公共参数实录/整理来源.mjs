import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const stage = path.resolve(here, '..');
const heroDir = path.join(stage, '英雄');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = b => createHash('sha256').update(b).digest('hex');
const write = (p, data) => fs.writeFileSync(path.join(here, p), JSON.stringify(data, null, 2) + '\n');
const growth = read(path.join(heroDir, '全英雄成长核对.json'));
const manifest = read(path.join(heroDir, '来源清单.json'));
const sources = new Map(manifest.sourceFiles.map(x => [x.path, x]));
const directory = path.join(here, '客户端原文');
fs.mkdirSync(directory, { recursive: true });
const excluded = ['Sylas', 'Aphelios'];
const index = [];
for (const hero of growth.heroes) {
  const id = hero.sourceChampionId;
  if (excluded.includes(id)) continue;
  const originalPath = path.join(heroDir, hero.source.path);
  const archivePath = path.join(directory, id + '.json.gz');
  // 被忽略的旧缓存迁为有摘要的无损原文；已有压缩原文可独立复核，不再依赖缓存。
  const archiveExists = fs.existsSync(archivePath);
  const bytes = archiveExists ? gunzipSync(fs.readFileSync(archivePath)) : fs.readFileSync(originalPath);
  assert.equal(hash(bytes), hero.source.sha256, id + ' 客户端原文摘要');
  if (!archiveExists) fs.writeFileSync(archivePath, gzipSync(bytes, { level: 9 }));
  const raw = JSON.parse(bytes.toString('utf8'));
  const officialRelative = `原始资料/zh_CN/champion/${id}.json`;
  const officialBytes = fs.readFileSync(path.join(heroDir, officialRelative));
  assert.equal(hash(officialBytes), sources.get(officialRelative).sha256, id + ' 官方原文摘要');
  const official = JSON.parse(officialBytes.toString('utf8'));
  assert.equal(official.version, '16.17.1');
  const champion = official.data[id];
  const rootPath = hero.recordKey;
  const root = raw[rootPath];
  assert.ok(root, id + ' 角色根引用');
  assert.equal(champion.spells.length, 4);
  const skills = ['P', 'Q', 'W', 'E', 'R'].map((slot, i) => {
    const spellPath = i === 0 ? root.mCharacterPassiveSpell : root.spells?.[i - 1];
    const spell = typeof spellPath === 'string' ? raw[spellPath]?.mSpell : null;
    const d = i === 0 ? champion.passive : champion.spells[i - 1];
    return { slot, officialId: d.id ?? null, name: d.name, clientPath: spellPath ?? null,
      bindingAvailable: !!spell, officialMaxRank: d.maxrank ?? 1,
      cooldown: d.cooldown ?? null, cost: d.cost ?? null, resource: d.resource ?? null,
      clientCooldown: spell?.cooldownTime ?? null, clientMana: spell?.mana ?? null,
      clientCastTime: spell?.spellCastTime ?? null,
      dataValueNames: spell?.DataValues?.map(x => x.name) ?? [],
      calculationNames: Object.keys(spell?.mSpellCalculations ?? {}),
      note: i === 0 ? '被动只沿mCharacterPassiveSpell，不借用主动槽位。' : '仅保留实际角色根引用；字段仍需按技能行为及等级语义核对。' };
  });
  index.push({ championId: id, chineseName: champion.name, resourceType: champion.partype,
    client: { path: `客户端原文/${id}.json.gz`, sha256: hero.source.sha256,
      compressedSha256: hash(fs.readFileSync(archivePath)), byteSize: bytes.length,
      sourceUrl: hero.source.url, fetchedAt: hero.source.fetchedAt,
      contentVersion: growth.clientContentVersion },
    official: { ...sources.get(officialRelative),
      path: `../英雄/${officialRelative}` }, rootPath, skills });
}
assert.equal(index.length, 171);
assert.equal(index.flatMap(x => x.skills).length, 855);
write('技能来源索引.json', { generatedAt: new Date().toISOString(),
  sourceMeaning: '复用此前冻结的16.17客户端完整原文；与DDragon16.17.1分开记账。引用和原值索引不是可直接导入的机制候选。',
  excluded, championCount: index.length, skillCount: index.length * 5,
  missingBindings: index.flatMap(h => h.skills.filter(s => !s.bindingAvailable).map(s => h.championId + '_' + s.slot)),
  heroes: index });
console.log(JSON.stringify({ champions: index.length, skills: index.length * 5,
  uncompressedBytes: index.reduce((n, h) => n + h.client.byteSize, 0),
  missingBindings: index.flatMap(h => h.skills).filter(s => !s.bindingAvailable).length }));

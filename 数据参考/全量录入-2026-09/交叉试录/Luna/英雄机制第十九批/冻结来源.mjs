// 从固定来源索引保存本批四名英雄的完整客户端对象、官方正文和精确根绑定。
// 只读规划资料，不访问网络，不调用业务接口。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录';
const index = JSON.parse(await readFile(path.join(base, '技能来源索引.json'), 'utf8'));
const ids = ['Riven', 'Aatrox', 'Rengar', 'Khazix'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const keyFor = (id, slot) => `${id.toLowerCase()}_${slot.toLowerCase()}`;
const activeIndex = slot => ['Q', 'W', 'E', 'R'].indexOf(slot);
const note = '沿角色根 mCharacterPassiveSpell / spells 精确路径核对；完整客户端对象、计算树、数据值和官方16.17.1正文均保留。本批不以同名旧技能替代根绑定。';
const evidence = { generatedAt: new Date().toISOString(), sourceIndex: path.join(base, '技能来源索引.json'), note, heroes: [] };
const compact = { generatedAt: evidence.generatedAt, sourceIndex: evidence.sourceIndex, note, heroes: [] };

for (const id of ids) {
  const meta = index.heroes.find(hero => hero.championId === id);
  if (!meta) throw Error(`来源索引缺少 ${id}`);
  const clientCompressed = await readFile(path.join(base, meta.client.path));
  const clientRaw = gunzipSync(clientCompressed);
  const officialRaw = await readFile(path.resolve(base, meta.official.path));
  const clientHash = sha256(clientRaw);
  const compressedHash = sha256(clientCompressed);
  const officialHash = sha256(officialRaw);
  if (clientHash !== meta.client.sha256 || compressedHash !== meta.client.compressedSha256 || officialHash !== meta.official.sha256) throw Error(`来源摘要不符 ${id}`);
  const client = JSON.parse(clientRaw);
  const official = JSON.parse(officialRaw).data?.[id];
  if (!official) throw Error(`官方资料缺少 ${id}`);
  const root = client[meta.rootPath];
  if (!root) throw Error(`角色根缺少 ${id}/${meta.rootPath}`);
  const spells = [];
  for (const info of meta.skills) {
    const expectedPath = info.slot === 'P' ? root.mCharacterPassiveSpell : root.spells?.[activeIndex(info.slot)];
    if (expectedPath !== info.clientPath) throw Error(`根绑定不符 ${id}/${info.slot}`);
    const object = client[expectedPath];
    if (!object?.mSpell) throw Error(`绑定对象缺少mSpell ${id}/${info.slot}`);
    const officialSpell = info.slot === 'P' ? official.passive : official.spells?.[activeIndex(info.slot)];
    if (!officialSpell) throw Error(`官方技能缺少 ${id}/${info.slot}`);
    spells.push({
      slot: info.slot,
      skillKey: keyFor(id, info.slot),
      binding: expectedPath,
      name: officialSpell.name,
      maxrank: officialSpell.maxrank ?? 1,
      officialCooldown: officialSpell.cooldown ?? null,
      officialCost: officialSpell.cost ?? null,
      officialResource: officialSpell.resource ?? null,
      officialDescription: officialSpell.description ?? null,
      officialTooltip: officialSpell.tooltip ?? null,
      cooldownTime: object.mSpell.cooldownTime ?? null,
      mana: object.mSpell.mana ?? null,
      manaValues: object.mSpell.manaValues ?? null,
      castTime: object.mSpell.castTime ?? null,
      spellCastTime: object.mSpell.spellCastTime ?? null,
      mCastTime: object.mSpell.mCastTime ?? null,
      channelDuration: object.mSpell.mChannelDuration ?? null,
      dataValues: object.mSpell.DataValues ?? object.mSpell.mDataValues ?? [],
      calculations: object.mSpell.mSpellCalculations ?? {}
    });
  }
  const clientRecord = { ...meta.client, sha256: clientHash, compressedSha256: compressedHash };
  const officialRecord = { ...meta.official, sha256: officialHash };
  evidence.heroes.push({
    id,
    chineseName: meta.chineseName,
    officialResourceType: official.partype,
    rootPath: meta.rootPath,
    client: clientRecord,
    official: officialRecord,
    rootObject: root,
    spells: spells.map(spell => ({
      slot: spell.slot,
      skillKey: spell.skillKey,
      binding: spell.binding,
      name: spell.name,
      maxrank: spell.maxrank,
      officialCooldown: spell.officialCooldown,
      officialCost: spell.officialCost,
      officialResource: spell.officialResource,
      officialDescription: spell.officialDescription,
      officialTooltip: spell.officialTooltip,
      object: client[spell.binding],
      official: spell.slot === 'P' ? official.passive : official.spells?.[activeIndex(spell.slot)]
    }))
  });
  compact.heroes.push({
    id,
    chineseName: meta.chineseName,
    officialResourceType: official.partype,
    rootPath: meta.rootPath,
    client: clientRecord,
    official: officialRecord,
    bindings: spells
  });
}

await mkdir(path.join(here, '来源冻结'), { recursive: true });
await writeFile(path.join(here, '根绑定与数值证据.json'), JSON.stringify(evidence, null, 2) + '\n');
await writeFile(path.join(here, '来源冻结', '来源与哈希汇总.json'), JSON.stringify({
  generatedAt: evidence.generatedAt,
  sourceIndex: evidence.sourceIndex,
  note,
  heroes: compact.heroes.map(hero => ({
    id: hero.id,
    chineseName: hero.chineseName,
    officialResourceType: hero.officialResourceType,
    rootPath: hero.rootPath,
    client: hero.client,
    official: hero.official,
    bindings: hero.bindings.map(spell => ({
      slot: spell.slot,
      skillKey: spell.skillKey,
      binding: spell.binding,
      name: spell.name,
      maxrank: spell.maxrank,
      officialCooldown: spell.officialCooldown,
      officialCost: spell.officialCost,
      officialResource: spell.officialResource
    }))
  }))
}, null, 2) + '\n');
await writeFile(path.join(here, '来源冻结', '主技能数值展开.json'), JSON.stringify(compact, null, 2) + '\n');
console.log(JSON.stringify({ heroes: ids, skillCount: evidence.heroes.flatMap(hero => hero.spells).length, clientSha256: evidence.heroes.map(hero => [hero.id, hero.client.sha256]), officialSha256: evidence.heroes.map(hero => [hero.id, hero.official.sha256]) }, null, 2));

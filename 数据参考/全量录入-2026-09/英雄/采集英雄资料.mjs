import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const version = '16.17.1';
const sourceRoot = `https://ddragon.leagueoflegends.com/cdn/${version}/data`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (name, data) => writeFile(resolve(root, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
const exists = async name => access(resolve(root, name)).then(() => true, () => false);
const sourceFiles = [];
const excluded = new Map([['Sylas', '用户明确后置：赛拉斯及技能偷取机制。'], ['Aphelios', '用户明确后置：厄斐琉斯及完整武器技能集合。']]);

if (await exists('来源清单.json')) throw new Error('资料已冻结；请使用 核对资料.mjs，不覆盖已冻结资料或录入进度。');

async function collect(url, localPath) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const parsed = JSON.parse(bytes.toString('utf8'));
      await mkdir(dirname(resolve(root, localPath)), { recursive: true });
      await writeFile(resolve(root, localPath), bytes);
      sourceFiles.push({ path: localPath, url, fetchedAt: new Date().toISOString(), byteSize: bytes.length, sha256: sha256(bytes) });
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(done => setTimeout(done, attempt * 750));
    }
  }
  throw lastError;
}

const versions = await collect('https://ddragon.leagueoflegends.com/api/versions.json', '原始资料/versions.json');
if (!versions.includes(version)) throw new Error(`官方版本列表中不存在 ${version}`);
const indices = {};
for (const locale of ['zh_CN', 'en_US']) {
  indices[locale] = await collect(`${sourceRoot}/${locale}/champion.json`, `原始资料/${locale}/champion.json`);
  if (indices[locale].version !== version) throw new Error(`${locale} 索引版本不符`);
}
const championIds = Object.keys(indices.zh_CN.data).sort();
if (JSON.stringify(championIds) !== JSON.stringify(Object.keys(indices.en_US.data).sort())) throw new Error('中英文英雄名单不一致');
const details = { zh_CN: {}, en_US: {} };
const jobs = ['zh_CN', 'en_US'].flatMap(locale => championIds.map(id => ({ locale, id })));
let next = 0;
let completed = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < jobs.length) {
    const { locale, id } = jobs[next++];
    const result = await collect(`${sourceRoot}/${locale}/champion/${id}.json`, `原始资料/${locale}/champion/${id}.json`);
    if (result.version !== version || result.data[id]?.id !== id) throw new Error(`${locale}/${id} 详情版本或标识不符`);
    if (result.data[id].spells?.length !== 4 || !result.data[id].passive) throw new Error(`${id} 技能槽结构异常，需要人工核对`);
    details[locale][id] = result.data[id];
    completed += 1;
    if (completed % 40 === 0 || completed === jobs.length) console.log(`已下载英雄详情 ${completed}/${jobs.length}`);
  }
}));

const wikiRoot = resolve(root, '../../lol-wiki-current-champions');
const wikiIdentityBytes = await readFile(resolve(wikiRoot, 'identity-manifest.json'));
const wikiSummaryBytes = await readFile(resolve(wikiRoot, 'summary.json'));
const wikiIdentity = JSON.parse(wikiIdentityBytes);
const wikiSummary = JSON.parse(wikiSummaryBytes);
const normalize = text => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const wikiPages = new Map(wikiSummary.pages.map(page => [page.id, page]));
const sourceByPath = new Map(sourceFiles.map(source => [source.path, source]));
const slots = ['Q', 'W', 'E', 'R'];
const placeholders = text => [...new Set([...String(text ?? '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1]))].sort();

function skillEntry(champion, english, slot) {
  const isPassive = slot === 'P';
  const spell = isPassive ? champion.passive : champion.spells[slots.indexOf(slot)];
  const englishSpell = isPassive ? english.passive : english.spells[slots.indexOf(slot)];
  const variables = placeholders(`${spell.description ?? ''} ${spell.tooltip ?? ''} ${spell.resource ?? ''}`);
  const unresolved = variables.filter(variable => {
    if (variable === 'cost') return !Array.isArray(spell.cost);
    const effectMatch = /^e(\d+)$/.exec(variable);
    if (effectMatch) return spell.effect?.[Number(effectMatch[1])] == null;
    return !spell.vars?.some(entry => entry.key === variable && entry.coeff != null);
  });
  const matches = wikiIdentity.entries.filter(entry => normalize(entry.wikiChampionTitle) === normalize(champion.id) && entry.skillKey === slot);
  const supplementSources = matches.map(entry => ({ ...entry, ...(wikiPages.get(entry.pageId) ?? {}), sameVersionAsPrimarySource: false }));
  return {
    slot, name: spell.name, englishName: englishSpell.name,
    description: spell.description ?? null, tooltip: spell.tooltip ?? null,
    imageUrl: spell.image?.full ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/${isPassive ? 'passive' : 'spell'}/${spell.image.full}` : null,
    rawFields: isPassive ? null : Object.fromEntries(['id', 'maxrank', 'cooldown', 'cooldownBurn', 'cost', 'costBurn', 'effect', 'effectBurn', 'vars', 'datavalues', 'range', 'rangeBurn', 'resource', 'leveltip'].map(key => [key, spell[key] ?? null])),
    placeholders: variables,
    unresolvedPlaceholders: unresolved,
    unresolvedMechanismPlaceholders: unresolved.filter(variable => !['spellmodifierdescriptionappend', 'abilityresourcename'].includes(variable)),
    supplementSources,
    sourceCoverage: isPassive ? '仅被动说明和图片；无完整结构化数值与触发规则' : '详情原字段；不保证完整系数、机制或实际射程，原始零值未作机制推断',
    numericReviewStatus: '待核对', mechanismReviewStatus: '待核对',
    entryStatus: excluded.has(champion.id) ? '约定排除' : '待录入',
    exclusionReason: excluded.get(champion.id) ?? null,
  };
}

const champions = championIds.map(id => {
  const champion = details.zh_CN[id];
  const english = details.en_US[id];
  return {
    sourceChampionId: id, sourceNumericId: champion.key,
    name: champion.name, title: champion.title, englishName: english.name,
    chineseChampionName: champion.title, chineseChampionTitle: champion.name,
    tags: champion.tags, resourceType: champion.partype, rawBaseStats: champion.stats,
    attributeReview: { status: '待核对', attackdamageperlevel: { status: '待补证', rawValue: champion.stats.attackdamageperlevel, reason: '本次 173 名英雄的该字段全部为 0，保留官方原值但不能直接认定真实攻击力成长均为零；需另查可信数值来源。' } },
    imageUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champion.image.full}`,
    primarySources: ['zh_CN', 'en_US'].map(locale => sourceByPath.get(`原始资料/${locale}/champion/${id}.json`)),
    entryStatus: excluded.has(id) ? '约定排除' : '待录入',
    exclusionReason: excluded.get(id) ?? null,
    systemCharacterKey: null,
    skills: ['P', ...slots].map(slot => skillEntry(champion, english, slot)),
  };
});
const skills = champions.flatMap(champion => champion.skills);
const scope = {
  mode: '召唤师峡谷', primarySourceVersion: version,
  versionMeaning: 'Data Dragon 资料版本；不是逐区域客户端版本保证，也不是全部机制完整性保证',
  excludedChampions: [...excluded].map(([sourceChampionId, reason]) => ({ sourceChampionId, reason })),
  mechanismExclusions: [
    { key: 'independent_summoned_objects', label: '陷阱、召唤物、士兵、炮台等独立战斗对象', action: '保留角色和原始技能说明；涉及独立对象的机制后置，其余可表达部分正常录入' },
    { key: 'full_skill_set_replacement', label: '完整技能集合替换和完整变形技能集', action: '保留角色和原始技能说明；技能集合替换部分后置，简单模式和状态切换继续录入' },
  ],
  mechanismExclusionSource: '../../../文档记录/需求澄清/项目/效果与状态本地Wiki机制盘点.md#132-建议后置',
  exclusionReview: '未对其余 171 个英雄逐项人工判定后置机制；录入时按机制记录，不能自动排除整名英雄',
};
const statistics = {
  championCount: champions.length,
  inScopeChampionCount: champions.filter(champion => !excluded.has(champion.sourceChampionId)).length,
  excludedChampionCount: excluded.size,
  sourceSkillSlotCount: skills.length,
  inScopeSkillSlotCount: skills.filter(skill => skill.entryStatus !== '约定排除').length,
  excludedSkillSlotCount: skills.filter(skill => skill.entryStatus === '约定排除').length,
  championWithLocalWikiSupplementCount: champions.filter(champion => champion.skills.some(skill => skill.supplementSources.length > 0)).length,
  skillWithLocalWikiSupplementCount: skills.filter(skill => skill.supplementSources.length > 0).length,
  activeSpellWithUnresolvedPlaceholderCount: skills.filter(skill => skill.slot !== 'P' && skill.unresolvedPlaceholders.length > 0).length,
  activeSpellWithUnresolvedMechanismPlaceholderCount: skills.filter(skill => skill.slot !== 'P' && skill.unresolvedMechanismPlaceholders.length > 0).length,
  activeSpellWithEmptyVarsCount: skills.filter(skill => skill.slot !== 'P' && !skill.rawFields.vars?.length).length,
  activeSpellWithEmptyDatavaluesCount: skills.filter(skill => skill.slot !== 'P' && !Object.keys(skill.rawFields.datavalues ?? {}).length).length,
  championWithZeroRawAttackDamageGrowthCount: champions.filter(champion => champion.rawBaseStats.attackdamageperlevel === 0).length,
  passiveWithoutStructuredNumericFieldsCount: champions.length,
};
await writeJson('来源清单.json', {
  schemaVersion: 1, frozenAt: new Date().toISOString(), scope, statistics,
  officialFieldDocumentation: 'https://developer.riotgames.com/docs/lol#data-dragon_champions',
  officialFieldConstraints: [
    '英雄索引为摘要，单英雄详情包含更多字段。',
    '说明中的 eN 占位符通常对应 effect/effectBurn 的 N 下标；aN/fN 通常对应 vars。未找到的变量保留缺失。',
    'effect/effectBurn 第 0 项为原设计的一基下标占位，不作为等级数据。',
    '法力或能量消耗通常在 cost；生命消耗可能在 effect，必须结合 resource 核对。',
    '资料随补丁人工更新，可能滞后；资料版本不保证等于所有地区客户端版本。',
  ],
  localWikiSupplement: {
    note: '本地既有 Wiki 为跨修订机制补充，不能声称与 16.17.1 同版本。',
    identityManifestPath: '../../lol-wiki-current-champions/identity-manifest.json', identityManifestSha256: sha256(wikiIdentityBytes),
    summaryPath: '../../lol-wiki-current-champions/summary.json', summarySha256: sha256(wikiSummaryBytes),
    fetchedAt: wikiSummary.fetchedAt,
  },
  sourceFiles: sourceFiles.sort((a, b) => a.path.localeCompare(b.path)),
});
await writeJson('英雄资料清单.json', { schemaVersion: 1, sourceVersion: version, scope, statistics, champions });
const queue = champions.flatMap(champion => [
  { entryKey: `${champion.sourceChampionId}:角色`, objectType: '角色', sourceChampionId: champion.sourceChampionId, name: champion.chineseChampionName, slot: null, status: champion.entryStatus, note: champion.exclusionReason, browserVerifiedAt: null, systemObjectKey: null, issues: [] },
  ...champion.skills.map(skill => ({ entryKey: `${champion.sourceChampionId}:${skill.slot}`, objectType: '技能', sourceChampionId: champion.sourceChampionId, name: skill.name, slot: skill.slot, status: skill.entryStatus, note: skill.exclusionReason, browserVerifiedAt: null, systemObjectKey: null, issues: [] })),
]);
if (!(await exists('录入进度.jsonl'))) await writeFile(resolve(root, '录入进度.jsonl'), queue.map(entry => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
const initialIds = ['Garen', 'Ashe', 'Lux', 'Malphite', 'MissFortune'];
await writeJson('首批五名英雄.json', {
  sourceVersion: version,
  note: '首批候选仅按常见录入形态选择，未承诺五名英雄的机制简单或数值完整。原始属性、技能数值和说明可用于准备页面；未解占位和被动数值仍需补证，不能以零替代。',
  champions: initialIds.map(id => champions.find(champion => champion.sourceChampionId === id)),
});
console.log(JSON.stringify(statistics, null, 2));

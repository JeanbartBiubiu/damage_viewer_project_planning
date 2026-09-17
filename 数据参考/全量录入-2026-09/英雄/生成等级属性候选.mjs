import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const writeJson = async (path, data) => { await mkdir(dirname(resolve(root, path)), { recursive: true }); await writeFile(resolve(root, path), JSON.stringify(data, null, 2) + '\n', 'utf8'); };
const inventory = await readJson('英雄资料清单.json');
const growthEvidence = await readJson('全英雄成长核对.json');
const number = value => Number.isFinite(value) ? Number(value.toFixed(6)) : null;
const growthFactor = level => (level - 1) * (0.7025 + 0.0175 * (level - 1));
const levels = Array.from({ length: 18 }, (_, index) => index + 1);
const mapLevels = fn => Object.fromEntries(levels.map(level => [String(level), number(fn(level))]));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceRefs = [
  { url: 'https://leagueoflegends.fandom.com/wiki/Champion_statistic', kind: '社区机制说明的历史页面，网页检索可读', retrievedAt: '2026-09-06', supports: '普通成长公式及攻速收益系数公式；不是官方游戏引擎源码。' },
  { url: 'https://wiki.leagueoflegends.com/en-us/Attack_timer', kind: '现行社区 Wiki 攻速页面的检索内容', retrievedAt: '2026-09-06', supports: '成长系数示例和攻速基值、收益系数不能混用。' },
  { url: 'https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/', kind: 'Riot 官方补丁说明', retrievedAt: '2026-09-06', supports: '上路任务奖励可将等级上限提高到 20；当前候选仅沿用上一阶段 1–18 级，不代表覆盖全部上路等级。' },
];
const localFormulaEvidence = [];
for (const file of ['raw/akshan-p.wikitext', 'raw/kaisa-q.wikitext', 'raw/graves-p.wikitext']) {
  const path = `../../lol-wiki-current-champions/${file}`;
  const bytes = await readFile(resolve(root, path));
  const text = bytes.toString('utf8');
  if (!text.includes('0.7025+0.0175*(x-1)') && !text.includes('0.7025+0.0175*(20-1)')) throw new Error(`既有曲线证据未找到：${path}`);
  localFormulaEvidence.push({ path, sha256: sha256(bytes), purpose: '已有冻结 Wiki 原文中的相同成长因子；不将其数值混作本轮英雄资料版本。' });
}
const curve = {
  schemaVersion: 1, frozenAt: new Date().toISOString(), range: { min: 1, max: 18 },
  ordinaryFormula: 'base + growth * (level - 1) * (0.7025 + 0.0175 * (level - 1))',
  attackSpeedFormula: 'baseAttackSpeed + attackSpeedRatio * growthPercent / 100 * (level - 1) * (0.7025 + 0.0175 * (level - 1))',
  growthFactors: mapLevels(growthFactor),
  precision: '候选数值按 6 位小数输出；原始浮点数完整保留在角色根记录中。',
  sourceRefs, localFormulaEvidence,
  evidenceBoundary: '沿用上一阶段通用等级曲线，并对照社区机制说明、已有冻结原文及数学端点；本次未取得可读官方旧补丁全文或游戏引擎源码，所以等级图仍为录入候选，未声称实际对局验收。',
  boundaries: ['只表示角色基础数值与自然成长，不包含被动、技能、装备、符文、叠层和形态变化。', '普通法力以官方明确资源类型和字段生成；其余特殊资源暂不生成资源等级图。', '缺少成长字段时保留缺失，不用官方可疑零值兜底。', '上路 19–20 级未生成；记录为本轮数据范围缺口。'],
};
if (growthFactor(1) !== 0 || Math.abs(growthFactor(2) - 0.72) > 1e-10 || Math.abs(growthFactor(18) - 17) > 1e-10) throw new Error('等级曲线端点异常');
await writeJson('等级曲线依据.json', curve);
const summary = [];
const scalarPairs = [
  { key: 'hp', label: '生命值', unit: '点', baseKey: 'baseHPModifiable', growthKey: 'hpPerLevelModifiable', ddGrowth: 'hpperlevel', multiplier: 1 },
  { key: 'hpregen', label: '生命回复', unit: '每 5 秒', baseKey: 'baseStaticHPRegenModifiable', growthKey: 'hpRegenPerLevelModifiable', ddGrowth: 'hpregenperlevel', multiplier: 5 },
  { key: 'armor', label: '护甲', unit: '点', baseKey: 'baseArmorModifiable', growthKey: 'armorPerLevelModifiable', ddGrowth: 'armorperlevel', multiplier: 1 },
  { key: 'spellblock', label: '魔法抗性', unit: '点', baseKey: 'baseMR', growthKey: 'mrPerLevel', ddGrowth: 'spellblockperlevel', multiplier: 1 },
];
for (const champion of inventory.champions) {
  const row = growthEvidence.heroes.find(hero => hero.sourceChampionId === champion.sourceChampionId);
  const extracted = await readJson(row.recordPath);
  const record = extracted.record;
  const stats = champion.rawBaseStats;
  const read = key => number(record[key]?.baseValue);
  const attributes = [];
  const missing = [];
  const add = (key, label, unit, base, growth, sources, formula = '普通成长') => attributes.push({ sourceAttributeKey: key, systemAttributeKey: null, label, unit, base, growth, sources, formula, levelValues: formula === '常量基础值' ? mapLevels(() => base) : mapLevels(level => base + growth * growthFactor(level)) });
  for (const pair of scalarPairs) {
    const base = read(pair.baseKey), growth = read(pair.growthKey);
    if (base === null || growth === null) { missing.push({ attribute: pair.key, label: pair.label, reason: '客户端基础值或成长字段省略，未使用默认零值填补', missingFields: [base === null ? pair.baseKey : null, growth === null ? pair.growthKey : null].filter(Boolean), officialBase: stats[pair.key], officialGrowth: stats[pair.ddGrowth] }); continue; }
    if (Math.abs(base * pair.multiplier - stats[pair.key]) > 0.0001 || Math.abs(growth * pair.multiplier - stats[pair.ddGrowth]) > 0.0001) { missing.push({ attribute: pair.key, label: pair.label, reason: '客户端与官方数值不一致，暂不生成' }); continue; }
    add(pair.key, pair.label, pair.unit, stats[pair.key], stats[pair.ddGrowth], [`原始资料/zh_CN/champion/${champion.sourceChampionId}.json:stats.${pair.key}/${pair.ddGrowth}`, `${row.recordPath}:${pair.baseKey}.baseValue/${pair.growthKey}.baseValue`]);
  }
  if (row.issues.length || row.clientAttackDamageGrowth === null) missing.push({ attribute: 'attackdamage', label: '攻击力', reason: row.issues.join('；') });
  else add('attackdamage', '攻击力', '点', stats.attackdamage, number(row.clientAttackDamageGrowth), [`${row.recordPath}:baseDamageModifiable.baseValue/damagePerLevelModifiable.baseValue`, '全英雄成长核对.json']);
  for (const [key, label, clientKey] of [['movespeed', '基础移动速度', 'baseMoveSpeedModifiable'], ['attackrange', '基础攻击距离', 'attackRangeModifiable']]) {
    const base = read(clientKey);
    if (base === null || Math.abs(base - stats[key]) > 0.0001) missing.push({ attribute: key, label, reason: '基础字段无法与官方对齐' });
    else add(key, label, '游戏单位', stats[key], null, [`${row.recordPath}:${clientKey}.baseValue`], '常量基础值');
  }
  const attackSpeedBase = read('attackSpeedModifiable'), attackSpeedRatio = read('attackSpeedRatioModifiable'), attackSpeedGrowth = read('attackSpeedPerLevelModifiable');
  if ([attackSpeedBase, attackSpeedRatio, attackSpeedGrowth].some(value => value === null)) missing.push({ attribute: 'attackspeed', label: '攻击速度', reason: '攻速基值、收益系数或普通成长字段缺失，可能涉及特殊攻速机制，暂不生成' });
  else attributes.push({ sourceAttributeKey: 'attackspeed', systemAttributeKey: null, label: '攻击速度', unit: '次/秒', base: attackSpeedBase, attackSpeedRatio, growthPercent: attackSpeedGrowth, sources: [`${row.recordPath}:attackSpeedModifiable/attackSpeedRatioModifiable/attackSpeedPerLevelModifiable`], formula: '攻速独立收益系数', levelValues: mapLevels(level => attackSpeedBase + attackSpeedRatio * attackSpeedGrowth / 100 * growthFactor(level)) });
  if (champion.resourceType === '法力' && record.primaryAbilityResource?.arType === 0) {
    for (const [key, label, growthKey, unit] of [['mp', '法力值', 'mpperlevel', '点'], ['mpregen', '法力回复', 'mpregenperlevel', '每 5 秒']]) {
      if (Number.isFinite(stats[key]) && Number.isFinite(stats[growthKey])) add(key, label, unit, stats[key], stats[growthKey], [`原始资料/zh_CN/champion/${champion.sourceChampionId}.json:stats.${key}/${growthKey}`, `${row.recordPath}:primaryAbilityResource.arType`]);
      else missing.push({ attribute: key, label, reason: '官方法力基础值或成长未明确，不补零' });
    }
  } else missing.push({ attribute: 'resource', label: '资源', resourceType: champion.resourceType, reason: '特殊或未明确资源不按法力统一生成；保留原始资源说明及根字段，待机制核对' });
  const output = {
    schemaVersion: 1, sourceChampionId: champion.sourceChampionId, sourceNumericId: champion.sourceNumericId, name: champion.chineseChampionName,
    sourceVersion: { dataDragon: '16.17.1', client: growthEvidence.clientContentVersion },
    status: champion.entryStatus === '约定排除' ? '约定排除，仅保留候选资料' : '候选，待页面录入核对',
    levels: { min: 1, max: 18 }, curveEvidence: '../等级曲线依据.json',
    scope: '纯基础属性及自然成长；不含被动、技能、物品、符文、叠层或形态。',
    attributes, missing,
    attackSpeedInputs: { base: attackSpeedBase, ratio: attackSpeedRatio, growthPercent: attackSpeedGrowth, ratioDiffersFromBase: attackSpeedBase !== null && attackSpeedRatio !== null && Math.abs(attackSpeedBase - attackSpeedRatio) > 0.000001 },
    manualMechanicReview: '尚未逐名人工核对被动和例外规则，不能把此文件当最终角色完整性证明。',
  };
  const path = `等级属性候选/${champion.sourceChampionId}.json`;
  await writeJson(path, output);
  summary.push({ sourceChampionId: champion.sourceChampionId, name: champion.chineseChampionName, path, attributeCount: attributes.length, missing, attackDamageGrowth: champion.attributeReview.attackdamageperlevel.supportedValue, attackSpeedRatioDiffersFromBase: output.attackSpeedInputs.ratioDiffersFromBase });
}
const statistics = { championCount: summary.length, attackDamageGrowthAvailableCount: summary.filter(row => row.attackDamageGrowth !== null).length, ratioDiffersFromBaseCount: summary.filter(row => row.attackSpeedRatioDiffersFromBase).length, candidatesWithMissingFieldsCount: summary.filter(row => row.missing.length).length, candidateAttributeCount: summary.reduce((total, row) => total + row.attributeCount, 0) };
await writeJson('等级属性候选索引.json', { schemaVersion: 1, generatedAt: new Date().toISOString(), statistics, sourceMode: '召唤师峡谷基础数据', levelRange: '1–18；上路额外等级未生成', heroes: summary });
console.log(JSON.stringify(statistics, null, 2));

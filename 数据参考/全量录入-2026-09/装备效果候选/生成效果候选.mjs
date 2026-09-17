import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.join(root, '..', '装备符文');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const plain = value => value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
const normalize = value => plain(value).replace(/\s+/g, ' ').trim();
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceFile = path.join(sourceRoot, '官方原始资料', 'item-16.17.1-zh_CN.json');
const frozen = read(path.join(sourceRoot, '地图11装备待录清单.json')).items.filter(i => i.scopeCategory === '可购买普通装备候选');
const pureIds = new Set(read(path.join(sourceRoot, '纯属性装备可录清单.json')).items.map(i => i.itemId));
const review = read(path.join(root, '逐件审阅.json')).items;
const source = read(sourceFile);
const sourceManifest = read(path.join(sourceRoot, '资料清单.json'));
if (hash(sourceFile) !== sourceManifest.sources.find(s => s.file.endsWith('item-16.17.1-zh_CN.json')).sha256) throw new Error('官方快照与摘要不符');
const selected = frozen.filter(item => !pureIds.has(item.itemId));
if (frozen.length !== 181 || pureIds.size !== 47 || selected.length !== 134) throw new Error('冻结范围改变');
if (Object.keys(review).length !== 134 || selected.some(item => !review[item.itemId])) throw new Error('逐件审阅覆盖不足');

const sourceStatMeanings = {
  FlatHPPoolMod: '固定生命值', FlatMPPoolMod: '固定法力值', FlatArmorMod: '固定护甲', FlatSpellBlockMod: '固定魔法抗性',
  FlatPhysicalDamageMod: '固定攻击力', FlatMagicDamageMod: '固定法术强度', FlatMovementSpeedMod: '固定移动速度',
  PercentMovementSpeedMod: '百分比移动速度，小数比例', PercentAttackSpeedMod: '额外攻击速度，小数比例',
  FlatCritChanceMod: '暴击几率，小数比例', PercentLifeStealMod: '生命偷取，小数比例',
  FlatHPRegenMod: '每秒生命回复；多兰之盾0.8对应每5秒4生命',
};
const directKey = {
  '生命值': 'hp', '法力': 'mana', '护甲': 'armor', '魔法抗性': 'magic_resistance', '攻击力': 'attack_damage',
  '法术强度': 'ability_power', '攻击速度%': 'bonus_attack_speed_percent', '暴击几率%': 'critical_strike_chance',
  '移动速度': 'move_speed', '移动速度%': 'move_speed_percent', '技能急速': 'ability_haste',
  '基础生命回复%': 'base_hp_regen_percent', '基础法力回复%': 'base_mana_regen_percent', '生命偷取%': 'life_steal_percent',
  '全能吸血%': 'omnivamp_percent', '韧性%': 'tenacity_percent', '治疗和护盾强度%': 'heal_shield_power_percent',
  '穿甲': 'armor_pen_flat', '护甲穿透%': 'armor_pen_percent', '法术穿透': 'magic_pen_flat', '法术穿透%': 'magic_pen_percent',
};
const directSourceFields = {
  hp: 'FlatHPPoolMod', mana: 'FlatMPPoolMod', armor: 'FlatArmorMod', magic_resistance: 'FlatSpellBlockMod',
  attack_damage: 'FlatPhysicalDamageMod', ability_power: 'FlatMagicDamageMod', move_speed: 'FlatMovementSpeedMod',
  move_speed_percent: 'PercentMovementSpeedMod', bonus_attack_speed_percent: 'PercentAttackSpeedMod',
  critical_strike_chance: 'FlatCritChanceMod', life_steal_percent: 'PercentLifeStealMod',
};

function numbers(text) {
  return [...text.matchAll(/\d+(?:\.\d+)?\s*(?:%|秒|码|层|次|级|金币|生命值|法力值|法术强度|攻击力|技能急速)?/g)].map(match => {
    const value = Number(match[0].match(/\d+(?:\.\d+)?/)[0]);
    return {
      literal: match[0], value, percentageFraction: match[0].includes('%') ? value / 100 : null,
      context: text.slice(Math.max(0, match.index - 22), Math.min(text.length, match.index + match[0].length + 25)),
      sourceTextOffset: match.index,
      status: value === 0 ? '零值展示，需确认来源；不直接填公式常数' : '原文明示，具体含义由上下文确认',
    };
  });
}

const records = selected.map(item => {
  const raw = source.data[item.itemId];
  if (raw.description !== item.description) throw new Error(`候选与原始说明不一致 ${item.itemId}`);
  const statsHtml = raw.description.match(/<stats>([\s\S]*?)<\/stats>/)?.[1] ?? '';
  const directAttributes = statsHtml.split(/<br\s*\/?\s*>/gi).filter(line => normalize(line)).map(line => {
    const text = normalize(line), match = text.match(/^(\d+(?:\.\d+)?)(%)?(.+)$/);
    if (!match) return { sourceText: text, extractionStatus: '未能确定单一属性数值，人工核对' };
    const displayValue = Number(match[1]), isPercent = Boolean(match[2]), name = match[3].trim();
    const key = directKey[name + (isPercent ? '%' : '')];
    if (!key) throw new Error(`未核直接属性 ${item.itemId}: ${text}`);
    const valueForFractionConvention = isPercent ? displayValue / 100 : displayValue;
    const sourceStatsField = directSourceFields[key] ?? null;
    const sourceStatsValue = sourceStatsField && Object.hasOwn(raw.stats, sourceStatsField) ? raw.stats[sourceStatsField] : null;
    if (sourceStatsValue !== null && Math.abs(sourceStatsValue - valueForFractionConvention) > 1e-9) throw new Error(`说明与stats冲突 ${item.itemId}: ${name}`);
    return {
      name, displayValue, sourceText: text, sourceUnit: isPercent ? '百分数' : '固定值',
      valueForFractionConvention, sourceStatsField, sourceStatsValue,
      crossCheck: sourceStatsValue === null ? 'stats未提供对应值；取自完整说明，不填0' : '说明与stats一致',
      suggestedAttributeKey: key, catalogAvailability: '由主任务当前属性目录核对，不读取业务数据',
      extractionStatus: displayValue === 0 ? '零值需核对是否为成长展示，不能默认为完整固定属性' : '明确数值',
    };
  });
  const headers = [...raw.description.matchAll(/<(passive|active)>([\s\S]*?)<\/\1>/g)];
  if (!headers.length) throw new Error(`没有命名效果段落 ${item.itemId}`);
  const effects = [];
  let pendingActiveHeader = null;
  headers.forEach((header, index) => {
    const end = headers[index + 1]?.index ?? raw.description.length;
    const bodyHtml = raw.description.slice(header.index + header[0].length, end);
    const name = normalize(header[2]);
    if (header[1] === 'active' && name === '主动' && headers[index + 1]?.[1] === 'active') {
      pendingActiveHeader = { sourceStart: header.index, text: normalize(bodyHtml), rawHtml: header[0] + bodyHtml };
      return;
    }
    const prefix = pendingActiveHeader;
    pendingActiveHeader = null;
    const body = plain(bodyHtml);
    const textWithHeader = [prefix?.text, body].filter(Boolean).join('\n');
    const clauses = textWithHeader.split(/[。；\n]/).map(line => line.trim()).filter(Boolean);
    const conditionalClauses = clauses.filter(line => /时|后|如果|每|在|施放|攻击|承受|受到|命中|击杀|参与|低于|高于|达到|拥有|战斗|充能/.test(line));
    const mechanics = [];
    for (const [regex, label] of [[/攻击特效/, '攻击特效'], [/护盾/, '护盾'], [/层|第.*次|充能/, '层数或充能'], [/冷却|急速/, '冷却或急速'], [/减速|定身|控制|凝滞|幽灵|重伤/, '状态或控制'], [/治疗|回复/, '治疗或回复'], [/显形|侦察|守卫|陷阱/, '视野范围'], [/范围|附近|周围|地带|脚下|身后/, '多目标或区域'], [/永久|每60秒|转变/, '成长或转化'], [/金币/, '经济'], [/攻击力|法术强度|魔法抗性|护甲|移动速度|攻击速度|生命值/, '属性依赖或修改']]) if (regex.test(textWithHeader)) mechanics.push(label);
    const amountEvidence = numbers([name, textWithHeader].join('\n'));
    const suggestedName = `${item.name}·${name}`;
    const missing = review[item.itemId][0].split('；').filter(Boolean);
    effects.push({
      candidateKey: `item_${item.itemId}_effect_${effects.length + 1}`,
      name, activationKind: header[1] === 'active' ? '主动' : '被动',
      sourceTag: header[1], sourceText: textWithHeader,
      explicitConditionalOrTimingClauses: conditionalClauses,
      conditionBoundary: conditionalClauses.length ? '这些是含条件或时序的完整原文句，尚未转成事件枚举或执行协议' : '本段没有单独明示事件条件，需按持续效果或状态含义核对',
      explicitNumbers: amountEvidence, mechanismTopics: mechanics,
      sourceLocation: { pointer: `/data/${item.itemId}/description`, htmlStart: prefix?.sourceStart ?? header.index, htmlEnd: end, offsetUnit: 'JavaScript字符串码元偏移' },
      rawHtml: raw.description.slice(prefix?.sourceStart ?? header.index, end),
      suggestedSkillDraft: {
        name: suggestedName, equipmentKey: item.existingEquipmentKey ?? item.proposedKey,
        description: `来源：官方16.17.1装备${item.itemId}。${header[1] === 'active' ? '主动' : '被动'}：${name}。\n${textWithHeader}\n${missing.length ? `本装备待补资料：${missing.join('；')}。缺失字段不填0。` : '本次未发现必须补齐的明确数值缺口；来源、触发、对象和持续时间须按原文录入。'}`,
        entryOrder: ['先保存装备直接属性', '参数只使用原文明示且已辨明含义的数值', '再按原文准备效果或状态', '主动与被动分别设置入口并挂载装备', '缺字段的段落保留未完成，不编造公式'],
        limitations: ['候选说明尚未映射成现有API字段', '未验证当前系统可表达全部事件和对象', '未在页面保存或战斗执行'],
      },
    });
  });
  const missing = review[item.itemId][0].split('；').filter(Boolean);
  return {
    itemId: item.itemId, name: item.name, equipmentKey: item.existingEquipmentKey ?? item.proposedKey,
    sourceVersion: source.version, sourceUrl: item.sourceUrl, sourcePointer: `/data/${item.itemId}`,
    sourceDescription: raw.description, sourceDescriptionText: plain(raw.description),
    directAttributes, rawStats: raw.stats,
    rawStatsMeanings: Object.entries(raw.stats).map(([field, value]) => ({ field, value, meaning: sourceStatMeanings[field] ?? '尚未释义' })),
    rawEffectVariables: raw.effect ?? null,
    rawEffectBoundary: '这些旧字段没有名称到当前机制的可靠映射，完整保留但不自动作为公式系数',
    effects, missingRequiredEvidence: missing, boundaryReview: review[item.itemId][1],
    candidateReadiness: missing.length ? '部分资料可录，完整机制待补来源' : '原文可形成候选，系统表达与边界另核',
    actualSystemEntryStatus: '本资料任务没有业务写入',
  };
});
for (const record of records) {
  const mentionedFields = new Set(record.directAttributes.map(a => a.sourceStatsField).filter(Boolean));
  const remainder = Object.keys(record.rawStats).filter(field => !mentionedFields.has(field));
  if (remainder.length && !(record.itemId === '1054' && remainder.length === 1 && remainder[0] === 'FlatHPRegenMod' && record.rawStats.FlatHPRegenMod === 0.8)) throw new Error(`存在未核stats字段 ${record.itemId}: ${remainder}`);
}
const effects = records.flatMap(record => record.effects.map(effect => ({ itemId: record.itemId, equipmentName: record.name, ...effect })));
const blocked = records.filter(item => item.missingRequiredEvidence.length).map(item => ({ itemId: item.itemId, name: item.name, requiredEvidence: item.missingRequiredEvidence, boundaryReview: item.boundaryReview, effectKeys: item.effects.map(e => e.candidateKey) }));
const zeroItems = records.filter(item => item.directAttributes.some(a => a.displayValue === 0) || item.effects.some(effect => effect.explicitNumbers.some(n => n.value === 0)));
const unresolvedNumberlessItems = records.filter(item => /(?:相当于|造成|提供|获得)[^。\n]*%(?!\d)/.test(item.sourceDescriptionText) && item.itemId === '6699');
write('装备效果候选.json', { version: source.version, evidenceLevel: '固定来源文案及逐件资料审阅，不是系统录入或运行验证', items: records });
write('机制段落候选.json', { version: source.version, count: effects.length, effects });
write('未补字段清单.json', { blockedItemCount: blocked.length, blocked, zeroDisplayItems: zeroItems.map(i => ({ itemId: i.itemId, name: i.name })), numberlessPlaceholders: unresolvedNumberlessItems.map(i => ({ itemId: i.itemId, name: i.name, text: i.sourceDescriptionText })) });
const counts = {
  frozenOrdinaryEquipment: frozen.length, pureAttributeEquipmentExcluded: pureIds.size, coveredEquipment: records.length,
  namedEffectSections: effects.length, passiveSections: effects.filter(e => e.activationKind === '被动').length,
  activeSections: effects.filter(e => e.activationKind === '主动').length,
  itemsWithoutExplicitMissingValues: records.length - blocked.length, itemsRequiringMoreEvidence: blocked.length,
  itemsWithZeroDisplays: zeroItems.length, directAttributeRows: records.reduce((n, r) => n + r.directAttributes.length, 0),
};
write('来源与覆盖.json', {
  version: source.version, scope: '冻结181个普通装备候选，扣除已单独整理的47件纯属性，逐项覆盖余下134件',
  source: { url: sourceManifest.sources[0].url, file: '../装备符文/官方原始资料/item-16.17.1-zh_CN.json', byteSize: fs.statSync(sourceFile).size, sha256: hash(sourceFile) },
  reviewedItemIds: records.map(r => r.itemId), omittedSelectedItemIds: selected.filter(i => !records.some(r => r.itemId === i.itemId)).map(i => i.itemId),
  counts, methodology: ['逐件读过全部134条中文官方说明', '按原始active/passive标签分段；通用主动标题并入后面的命名主动', '全部直接属性保留原文，百分比另给小数比例', '数值仅摘录，不从缺失系数、0展示、范围端点推测完整公式', '逐件记录必要资料缺口及边界，候选不代表现有系统可完整录入'],
  verification: { sourceHashMatchesFrozenManifest: true, all134ItemsHaveManualReview: true, allSelectedItemsCoveredExactlyOnce: true, allAvailableDirectStatsMatchedDescription: true, doranShieldRegenReviewedInPassive: true, businessWrites: 0 },
});
const summary = ['# 装备效果录入候选说明', '', `范围为官方16.17.1中已冻结的181件普通候选，排除47件纯属性，余下${records.length}件全部有记录。共拆出${effects.length}个命名效果段，其中主动${counts.activeSections}个、被动${counts.passiveSections}个。`, '', '这是逐件来源说明，未调用业务接口、数据库或页面。带缺口的效果不能为方便保存而填0或套旧版本公式。以下名称可作为技能草稿名，最终技能字段、事件、目标及状态关系由页面实录核对。', ''];
for (const item of records) {
  summary.push(`## ${item.itemId} ${item.name}`, '', `直接属性：${item.directAttributes.map(a => a.sourceText).join('；')}。`, '');
  for (const effect of item.effects) summary.push(`**${effect.activationKind}：${effect.name}**`, '', effect.sourceText, '');
  summary.push(`待补资料：${item.missingRequiredEvidence.length ? item.missingRequiredEvidence.join('；') : '本次未发现明确缺失数值，仍需核对系统表达'}。`, '', `边界核对：${item.boundaryReview}。`, '', `来源定位：原始item.json的data.${item.itemId}.description。`, '');
}
fs.writeFileSync(path.join(root, '录入用说明.md'), `${summary.join('\n')}\n`, 'utf8');
console.log(JSON.stringify(counts, null, 2));

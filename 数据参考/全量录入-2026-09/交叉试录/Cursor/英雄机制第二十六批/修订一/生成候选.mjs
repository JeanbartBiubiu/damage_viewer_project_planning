import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const inputDir = path.join(here, '输入包');
const referenceDir = path.join(inputDir, '参考资料');
const batchDir = path.resolve(here, '..', '..', '..', '..', '数据参考', '全量录入-2026-09', '交叉试录', 'Cursor', '英雄机制第二十六批', '修订一');
const binding = readJson(path.join(inputDir, '来源绑定与当前文本.json'));
const inputVersion = readJson(path.join(inputDir, '输入版本.json'));
const currentSnapshot = readJson(path.join(referenceDir, '当前10槽保护快照.json'));
const reuseList = readJson(path.join(referenceDir, '公共参数复用清单.json'));
const stringTable = readGzipJson(path.join(referenceDir, 'lol-16.17-zh_CN.stringtable.json.gz'));
const order = [
  'alistar_p', 'alistar_q', 'alistar_w', 'alistar_e', 'alistar_r',
  'blitzcrank_p', 'blitzcrank_q', 'blitzcrank_w', 'blitzcrank_e', 'blitzcrank_r',
];
const endpointByKind = {
  parameters: 'parameters', formulas: 'formulas', effects: 'effects', processes: 'processes',
  internalStates: 'internal-states', triggerRules: 'trigger-rules',
};
const fieldByKind = {
  parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey', processes: 'processKey',
  internalStates: 'stateKey', triggerRules: 'ruleKey',
};

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readGzipJson(file) { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file))); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function sha256Bytes(value) { return createHash('sha256').update(value).digest('hex'); }
function sha256File(file) { return sha256Bytes(fs.readFileSync(file)); }
function stableNumber(value) {
  if (!Number.isFinite(value)) return value;
  const rounded = Math.round(value * 1e9) / 1e9;
  return Number.isInteger(rounded) ? rounded : rounded;
}
function sameNumber(actual, expected, tolerance = 1e-6) {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;
}
function ms(seconds, label) {
  if (!Number.isFinite(seconds)) throw new Error(`时间值不是数字: ${label}`);
  const value = Math.round(seconds * 1000);
  if (!Number.isInteger(value) || value < 0) throw new Error(`时间转换异常: ${label}=${seconds}`);
  return value;
}
function levels(values) { return Object.fromEntries(values.map((value, index) => [String(index + 1), value])); }

const rawCache = new Map();
const officialCache = new Map();
function sourceSkill(skillKey) {
  const match = /^([^_]+)_(p|q|w|e|r)$/.exec(skillKey);
  if (!match) throw new Error(`技能键格式异常: ${skillKey}`);
  const heroId = match[1] === 'alistar' ? 'Alistar' : 'Blitzcrank';
  const slot = match[2].toUpperCase();
  const hero = binding.heroes.find(item => item.id === heroId);
  const meta = hero?.source?.skills?.find(item => item.slot === slot);
  if (!hero || !meta) throw new Error(`来源绑定缺少技能: ${skillKey}`);
  const rawFile = path.join(referenceDir, '客户端原文', `${heroId}.json.gz`);
  if (!rawCache.has(heroId)) rawCache.set(heroId, readGzipJson(rawFile));
  const rawObjects = rawCache.get(heroId);
  const rawObject = rawObjects[meta.clientPath];
  if (!rawObject?.mSpell) throw new Error(`客户端原文缺少绑定对象: ${skillKey}/${meta.clientPath}`);
  const officialFile = path.join(referenceDir, '官方中文', `${heroId}.json`);
  if (!officialCache.has(heroId)) officialCache.set(heroId, readJson(officialFile));
  const officialData = officialCache.get(heroId).data?.[heroId];
  const officialSpell = slot === 'P'
    ? officialData?.passive
    : officialData?.spells?.find(item => item.id === meta.officialId);
  const locKeys = rawObject.mSpell.mClientData?.mTooltipData?.mLocKeys ?? {};
  const entries = stringTable.entries ?? {};
  const lowerObject = String(rawObject.ObjectName ?? '').toLowerCase();
  const lookup = (key, fallbacks = []) => {
    const exact = entries[String(key).toLowerCase()];
    if (exact !== undefined) return exact;
    for (const fallback of fallbacks) {
      const value = entries[String(fallback).toLowerCase()];
      if (value !== undefined) return value;
    }
    return null;
  };
  const currentTexts = {
    name: lookup(locKeys.keyName, [`spell_${lowerObject}_name`, `generatedtip_spell_${lowerObject}_displayname`]),
    summary: lookup(locKeys.keySummary, [`spell_${lowerObject}_summary`]),
    tooltip: lookup(locKeys.keyTooltip, [`spell_${lowerObject}_tooltip`, `generatedtip_spell_${lowerObject}_tooltipcontent`]),
    tooltipExtendedBelowLine: locKeys.keyTooltipExtendedBelowLine
      ? lookup(locKeys.keyTooltipExtendedBelowLine, [`spell_${lowerObject}_tooltipextendedbelowline`])
      : null,
    locKeys,
  };
  return {
    skillKey,
    hero,
    meta,
    rawFile,
    rawObject,
    rawSpell: rawObject.mSpell,
    officialSpell,
    currentTexts,
    officialFile,
  };
}

function dataRow(skillKey, name) {
  const { rawSpell } = sourceSkill(skillKey);
  const row = (rawSpell.DataValues ?? []).find(item => item.name === name);
  if (!row) throw new Error(`来源缺少 DataValues.${name}: ${skillKey}`);
  return row;
}
function dataValues(skillKey, name, count) {
  const row = dataRow(skillKey, name);
  if (!Array.isArray(row.values) || row.values.length < count + 1) throw new Error(`DataValues等级长度不足: ${skillKey}/${name}`);
  return row.values.slice(1, count + 1).map(stableNumber);
}
function assertSeries(skillKey, name, expected, tolerance = 1e-6) {
  const row = dataRow(skillKey, name);
  const actual = row.values.slice(1, expected.length + 1);
  if (actual.length !== expected.length || actual.some((value, index) => !sameNumber(value, expected[index], tolerance))) {
    throw new Error(`来源值不匹配 ${skillKey}/${name}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
  return expected.slice();
}
function spellField(skillKey, field) {
  const { rawSpell } = sourceSkill(skillKey);
  return rawSpell[field];
}
function assertSpellSeries(skillKey, field, expected, tolerance = 1e-6) {
  const actual = spellField(skillKey, field);
  if (!Array.isArray(actual) || actual.length < expected.length || actual.slice(0, expected.length).some((value, index) => !sameNumber(value, expected[index], tolerance))) {
    throw new Error(`来源字段不匹配 ${skillKey}/${field}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
  return expected.slice();
}
function assertSpellRankSeries(skillKey, field, expected, tolerance = 1e-6) {
  const actual = spellField(skillKey, field);
  const offset = Array.isArray(actual) && actual.length >= expected.length && sameNumber(actual[0], expected[0], tolerance)
    ? 0
    : (Array.isArray(actual) && actual.length > expected.length && sameNumber(actual[1], expected[0], tolerance) ? 1 : -1);
  const ranked = offset >= 0 ? actual.slice(offset, offset + expected.length) : [];
  if (ranked.length !== expected.length || ranked.some((value, index) => !sameNumber(value, expected[index], tolerance))) {
    throw new Error(`来源等级字段不匹配 ${skillKey}/${field}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
  return { values: expected.slice(), offset };
}
function levelSeries(skillKey, name, count, expected) { return assertSeries(skillKey, name, expected ?? dataValues(skillKey, name, count)); }
function recordData(sourceSeries, skillKey, name, expected, count = expected.length) {
  const raw = dataRow(skillKey, name).values.slice();
  const candidate = assertSeries(skillKey, name, expected).slice(0, count);
  sourceSeries[`${skillKey}/${name}`] = { raw, candidate, rankSlice: `索引1至${count}` };
  return candidate;
}
function recordSpell(sourceSeries, skillKey, field, expected) {
  const raw = spellField(skillKey, field);
  const candidate = Array.isArray(expected) ? assertSpellSeries(skillKey, field, expected) : expected;
  sourceSeries[`${skillKey}/spell.${field}`] = { raw, candidate };
  return candidate;
}
function recordSpellRanks(sourceSeries, skillKey, field, expected) {
  const raw = spellField(skillKey, field);
  const result = assertSpellRankSeries(skillKey, field, expected);
  sourceSeries[`${skillKey}/spell.${field}`] = { raw, candidate: result.values, rankOffset: result.offset, rankSlice: `索引${result.offset}至${result.offset + expected.length - 1}` };
  return result.values;
}
function recordSpellRanksAtOffset(sourceSeries, skillKey, field, expected, offset) {
  const raw = spellField(skillKey, field);
  const ranked = Array.isArray(raw) ? raw.slice(offset, offset + expected.length) : [];
  if (ranked.length !== expected.length || ranked.some((value, index) => !sameNumber(value, expected[index]))) {
    throw new Error(`来源固定索引等级字段不匹配 ${skillKey}/${field}: ${JSON.stringify(raw)}，期望索引${offset}起 ${JSON.stringify(expected)}`);
  }
  sourceSeries[`${skillKey}/spell.${field}`] = { raw, candidate: expected.slice(), rankOffset: offset, rankSlice: `技能等级索引${offset}至${offset + expected.length - 1}`, interpretation: '客户端cooldownTime索引0为非技能等级首项；技能等级1至5取索引1至5，独立官方数组确认同一顺序' };
  return expected.slice();
}

function p(parameterKey, name, valueType, valueMode, value, description, sortOrder) {
  if (valueMode === 'FIXED') return { parameterKey, name, valueType, valueMode, fixedValue: value, levelValues: null, description, sortOrder };
  if (valueMode === 'SKILL_LEVEL') return { parameterKey, name, valueType, valueMode, fixedValue: null, levelValues: levels(value), description, sortOrder };
  if (valueMode === 'RUNTIME_INPUT') return { parameterKey, name, valueType, valueMode, fixedValue: null, levelValues: null, description, sortOrder };
  throw new Error(`未知参数取值模式: ${valueMode}`);
}
const param = parameterKey => ({ nodeType: 'PARAMETER', parameterKey });
const attr = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind });
const op = (operation, left, right) => ({ nodeType: 'OPERATION', operation, operands: [left, right] });
const add = (left, right) => op('ADD', left, right);
const multiply = (left, right) => op('MULTIPLY', left, right);
function f(formulaKey, name, expression, description, sortOrder) { return { formulaKey, name, expression, description, sortOrder }; }
function valueRule(value) { return { value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }; }
function valueRef(kind, key) { return kind === 'FORMULA' ? { kind, formulaKey: key } : { kind: 'PARAMETER', parameterKey: key }; }
function timedLifecycle(durationParameterKey, instanceScope = 'SOURCE') {
  return {
    durationValue: { kind: 'PARAMETER', parameterKey: durationParameterKey },
    maxStacksValue: { kind: 'FIXED', value: 1 },
    applicationStacksValue: { kind: 'FIXED', value: 1 },
    instanceScope,
    reapplicationStackMode: 'KEEP',
    reapplicationDurationMode: 'REFRESH_ALL',
    expiryMode: 'ALL_AT_ONCE',
    periodicIntervalValue: null,
    firstPeriodicExecution: null,
  };
}
function persistentBehavior(reapplicationValueMode = 'REPLACE') {
  return {
    moment: 'PERSISTENT',
    valueReadMode: 'APPLICATION_SNAPSHOT',
    stackValueMode: 'SHARED',
    reapplicationValueMode,
    periodicExecutionMode: null,
  };
}
function effectBase(effectKey, name, description, sortOrder, lifecycle = null) { return { effectKey, name, description, sortOrder, lifecycle, results: [] }; }
function resourceEffect(effectKey, name, ref, attributeKey, operation, description, sortOrder = 10) {
  const e = effectBase(effectKey, name, description, sortOrder);
  e.results.push({ resultKey: 'resource', name, resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: 10, lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: valueRule(valueRef(ref.kind, ref.key)), detail: { attributeKey, operation } });
  return e;
}
function attributeEffect(effectKey, name, ref, attributeKey, operation, durationParameterKey, description, sortOrder = 10) {
  const e = effectBase(effectKey, name, description, sortOrder, timedLifecycle(durationParameterKey, 'SOURCE'));
  e.results.push({ resultKey: 'attribute', name, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description: null, sortOrder: 10, lifecycleBehavior: persistentBehavior(), spellShieldBlockScope: null, valueRule: valueRule(valueRef(ref.kind, ref.key)), detail: { attributeKey, operation, modifierZoneKey: 'attribute_flat_add' } });
  return e;
}
function shieldEffect(effectKey, name, ref, durationParameterKey, description, sortOrder = 10) {
  const e = effectBase(effectKey, name, description, sortOrder, timedLifecycle(durationParameterKey, 'SOURCE'));
  e.results.push({ resultKey: 'shield', name, resultType: 'NORMAL_SHIELD', target: 'SOURCE', description: null, sortOrder: 10, lifecycleBehavior: persistentBehavior(), spellShieldBlockScope: null, valueRule: valueRule(valueRef(ref.kind, ref.key)), detail: { absorbedDamageTypeKey: null, decayMode: 'NONE' } });
  return e;
}
function damageModifierEffect(effectKey, name, ref, durationParameterKey, description, sortOrder = 10) {
  const e = effectBase(effectKey, name, description, sortOrder, timedLifecycle(durationParameterKey, 'SOURCE'));
  e.results.push({ resultKey: 'damage_modifier', name, resultType: 'DAMAGE_MODIFIER', target: 'SOURCE', description: null, sortOrder: 10, lifecycleBehavior: persistentBehavior(), spellShieldBlockScope: null, valueRule: valueRule(valueRef(ref.kind, ref.key)), detail: { modifierZoneKey: 'damage_ratio', direction: 'TAKEN', operation: 'DECREASE', damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY', criticalFilter: 'ANY' } });
  return e;
}

function sourceRecord(skillKey) {
  const { hero, meta, rawFile, rawObject, rawSpell, officialSpell, currentTexts, officialFile } = sourceSkill(skillKey);
  const clientRel = `参考资料/客户端原文/${hero.id}.json.gz`;
  const zhRel = `参考资料/官方中文/${hero.id}.json`;
  const enRel = `参考资料/官方英文/${hero.id}.json`;
  const clientSource = inputVersion.sourceFiles.find(item => item.path === clientRel);
  const zhSource = inputVersion.sourceFiles.find(item => item.path === zhRel);
  const enSource = inputVersion.sourceFiles.find(item => item.path === enRel);
  return {
    hero: hero.id,
    heroName: hero.name,
    heroKey: hero.key,
    resourceType: hero.source.resourceType,
    rootPath: hero.rootPath,
    spellPath: meta.clientPath,
    bindingAvailable: meta.bindingAvailable,
    clientFile: clientRel,
    clientSha256: hero.source.client.sha256,
    clientCompressedSha256: hero.source.client.compressedSha256 ?? clientSource?.sha256,
    clientBuild: hero.source.client.contentVersion,
    officialZhFile: zhRel,
    officialZhSha256: zhSource?.sha256,
    officialEnFile: enRel,
    officialEnSha256: enSource?.sha256,
    currentBoundText: currentTexts,
    officialText: officialSpell ? { name: officialSpell.name, description: officialSpell.description, tooltip: officialSpell.tooltip, maxrank: officialSpell.maxrank } : null,
    rawObjectKeys: Object.keys(rawObject),
    rawSpellKeys: Object.keys(rawSpell),
    rawSpell,
  };
}
function proof(skillKey, facts, sourceNote) {
  const { currentTexts } = sourceSkill(skillKey);
  return { binding: sourceRecord(skillKey), currentBoundText: currentTexts, sourceFacts: facts, sourceNote };
}
function skillEntry(skillKey, write, facts, pending, excluded) {
  const snapshot = currentSnapshot.summary?.[skillKey];
  const { hero } = sourceSkill(skillKey);
  if (!snapshot?.subject) throw new Error(`保护快照缺少主体: ${skillKey}`);
  return {
    skillKey,
    name: snapshot.subject.name,
    maxLevel: snapshot.subject.maxLevel,
    source: sourceRecord(skillKey),
    write,
    proofs: [proof(skillKey, facts, `固定16.17客户端根绑定 ${hero.rootPath} -> 当前技能对象；只采用当前中文正文、DataValues和当前计算树。`)],
    pending,
    excluded,
    reusedParameters: reuseList.filter(item => item.skillKey === skillKey).map(item => ({ ...item, post: false })),
    protectedExisting: {
      subject: snapshot.subject,
      components: snapshot.components,
      publicOnly: snapshot.publicOnly,
    },
    existingCompositionCounts: Object.fromEntries(Object.entries(snapshot.components ?? {}).map(([key, value]) => [key, value.length])),
    status: '候选待审，未调用业务接口',
  };
}

const sourceSeries = {};
const sourceNotes = {};
function note(skillKey, value) { sourceNotes[skillKey] = value; }

function buildSkills() {
  const skills = {};

  const alistarPSelf = recordData(sourceSeries, 'alistar_p', 'AlistarPassiveHealRatio', [0.05], 1);
  const alistarPCooldown = recordData(sourceSeries, 'alistar_p', 'PassiveCooldown', [3], 1);
  const alistarPStacks = recordData(sourceSeries, 'alistar_p', 'PassiveMaxStacks', [7], 1);
  const alistarPChampionKill = recordData(sourceSeries, 'alistar_p', 'PassiveStacksChampionKill', [7], 1);
  recordData(sourceSeries, 'alistar_p', 'AlistarPassiveAllyHealRatio', [1.4], 1);
  recordData(sourceSeries, 'alistar_p', 'PassiveAllyNumHeal', [15], 1);
  skills.alistar_p = skillEntry('alistar_p', {
    parameters: [
      p('self_heal_ratio', '自身治疗比例', 'DECIMAL', 'FIXED', alistarPSelf[0], '当前正文BaseHeal只治疗自身这一部分；DataValues.AlistarPassiveHealRatio=0.05，未把附近友方治疗比例混入。', 10),
      p('passive_cooldown_ms', '被动冷却（毫秒）', 'INTEGER', 'FIXED', ms(alistarPCooldown[0], 'alistar_p/PassiveCooldown'), '当前绑定DataValues.PassiveCooldown=3秒，转换为3000毫秒；冷却重新开始的事件待接。', 20),
      p('passive_max_stacks', '被动满层次数', 'INTEGER', 'FIXED', alistarPStacks[0], '当前绑定DataValues.PassiveMaxStacks=7；次数为整数。', 30),
      p('passive_stacks_champion_kill', '敌方英雄或史诗级野怪击杀充能次数', 'INTEGER', 'FIXED', alistarPChampionKill[0], '当前绑定DataValues.PassiveStacksChampionKill=7；只记录明确的完整充能次数，不创建击杀事件。', 40),
    ],
    formulas: [
      f('self_heal_amount', '凯旋怒吼自身治疗量', multiply(param('self_heal_ratio'), attr('SOURCE', 'hp', 'TOTAL')), '当前BaseHeal树为mStat12×AlistarPassiveHealRatio；按同批已证生命选择器保存为自身总生命×0.05，治疗结果和触发时点待接。', 10),
    ],
    effects: [], processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { AlistarPassiveHealRatio: alistarPSelf, PassiveCooldown: alistarPCooldown, PassiveMaxStacks: alistarPStacks, PassiveStacksChampionKill: alistarPChampionKill },
    calculations: ['BaseHeal=StatByNamedDataValue(mStat12,AlistarPassiveHealRatio)', 'AllyHeal=BaseHeal×AlistarPassiveAllyHealRatio'],
    selectors: ['mStat12仅按自身总生命窄口径使用；友方倍率和友方人数不进入本轮写入。'],
    units: ['PassiveCooldown秒→毫秒', '治疗比例保存为0.05'],
  }, [], [
    { item: 'AlistarPassiveAllyHealRatio与PassiveAllyNumHeal', reason: '当前正文明确所有附近友方英雄，属于第三友军纯收益和人数分配，本轮排除；源值仍保留。' },
  ]);
  skills.alistar_p.pending.push(
    { item: '晕眩/震移/敌人阵亡获得层数、满7层和自身治疗触发', reason: '正文条件已核实；当前候选只保存参数和自身治疗计算量，不创建瞬时治疗或触发规则。' },
    { item: '史诗级野怪击杀完整充能', reason: '明确次数已保存；野怪事件接线仍待运行层。' },
  );
  note('alistar_p', 'mStat12的自身生命映射用于BaseHeal；友方修正与人数只作范围外来源证据。');

  const aQBase = recordData(sourceSeries, 'alistar_q', 'BaseDamage', [60, 100, 140, 180, 220]);
  const aQAp = recordData(sourceSeries, 'alistar_q', 'APRatio', [0.8], 1);
  const aQKnock = recordData(sourceSeries, 'alistar_q', 'KnockupDuration', [1], 1);
  recordData(sourceSeries, 'alistar_q', 'AoERadius', [375], 1);
  const aQCast = recordSpell(sourceSeries, 'alistar_q', 'spellCastTime', 0.25);
  skills.alistar_q = skillEntry('alistar_q', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', ms(aQCast, 'alistar_q/spellCastTime'), '当前绑定spellCastTime=0.25秒，转换为250毫秒；不表示命中事件已接线。', 10),
      p('base_damage', '基础魔法伤害', 'INTEGER', 'SKILL_LEVEL', aQBase, '当前绑定DataValues.BaseDamage索引1至5为60/100/140/180/220。', 20),
      p('ap_ratio', '法术强度倍率', 'DECIMAL', 'FIXED', aQAp[0], '当前绑定DataValues.APRatio=0.8；计算树TotalDamage的省略统计选择器按同版窄证mStat0映射法术强度。', 30),
      p('knockup_duration_ms', '击飞持续（毫秒）', 'INTEGER', 'FIXED', ms(aQKnock[0], 'alistar_q/KnockupDuration'), '当前绑定DataValues.KnockupDuration=1秒，转换为1000毫秒；只保存控制持续。', 40),
    ],
    formulas: [
      f('magic_damage', '大地粉碎单一敌方魔法伤害', add(param('base_damage'), multiply(param('ap_ratio'), attr('SOURCE', 'ability_power', 'TOTAL'))), '当前TotalDamage树=BaseDamage+APRatio×来源总法术强度；范围伤害结果和击飞事件待接。', 10),
    ],
    effects: [resourceEffect('mana_cost', '大地粉碎法力消耗', { kind: 'PARAMETER', key: 'mana_cost' }, 'mana', 'CONSUME', '复用当前已有mana_cost参数；只记录一次施放资源变化，施放事件和资源不足处理待接。')],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { BaseDamage: aQBase, APRatio: aQAp, KnockupDuration: aQKnock, AoERadius: [375] },
    calculations: ['TotalDamage=NamedDataValue(BaseDamage)+StatByNamedDataValue(APRatio)'],
    selectors: ['APRatio节点省略选择器，按同版窄证mStat0=法术强度。'],
    units: ['KnockupDuration秒→毫秒'],
  }, [
    { item: '击飞事件与单一命中目标', reason: '正文机制明确；当前无状态结果或命中事件接线，保留击飞持续参数。' },
  ], [
    { item: 'AoERadius', reason: '375为范围几何信息，当前没有独立消费者，本轮不建展示或几何公式。' },
  ]);

  const aWBase = recordData(sourceSeries, 'alistar_w', 'Damage', [55, 110, 165, 220, 275]);
  const aWStun = recordData(sourceSeries, 'alistar_w', 'StunDuration', [0.75], 1);
  const aWKnock = recordData(sourceSeries, 'alistar_w', 'KnockUpDuration', [0.75], 1);
  const aWAp = recordData(sourceSeries, 'alistar_w', 'APRatio', [1], 1);
  recordData(sourceSeries, 'alistar_w', 'KnockBackDistance', [700], 1);
  const aWCast = recordSpell(sourceSeries, 'alistar_w', 'spellCastTime', 0.5055999755859375);
  skills.alistar_w = skillEntry('alistar_w', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', ms(aWCast, 'alistar_w/spellCastTime'), '当前绑定spellCastTime约0.5056秒，按毫秒四舍五入为506；不表示位移过程已经接线。', 10),
      p('base_damage', '基础魔法伤害', 'INTEGER', 'SKILL_LEVEL', aWBase, '当前绑定DataValues.Damage索引1至5为55/110/165/220/275。', 20),
      p('ap_ratio', '法术强度倍率', 'DECIMAL', 'FIXED', aWAp[0], '当前绑定DataValues.APRatio=1；当前TotalDamage树以来源总法术强度作为省略选择器窄映射。', 30),
      p('stun_duration_ms', '眩晕持续（毫秒）', 'INTEGER', 'FIXED', ms(aWStun[0], 'alistar_w/StunDuration'), '当前绑定DataValues.StunDuration=0.75秒，转换为750毫秒。', 40),
      p('knockup_duration_ms', '击飞持续（毫秒）', 'INTEGER', 'FIXED', ms(aWKnock[0], 'alistar_w/KnockUpDuration'), '当前绑定DataValues.KnockUpDuration=0.75秒，转换为750毫秒；与击退位移过程分开。', 50),
    ],
    formulas: [
      f('magic_damage', '野蛮冲撞单一敌方魔法伤害', add(param('base_damage'), multiply(param('ap_ratio'), attr('SOURCE', 'ability_power', 'TOTAL'))), '当前TotalDamage树=Damage+APRatio×来源总法术强度；伤害结果和击退事件待接。', 10),
    ],
    effects: [resourceEffect('mana_cost', '野蛮冲撞法力消耗', { kind: 'PARAMETER', key: 'mana_cost' }, 'mana', 'CONSUME', '复用当前已有mana_cost参数；只记录一次施放资源变化，位移和控制事件待接。')],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { Damage: aWBase, StunDuration: aWStun, KnockUpDuration: aWKnock, APRatio: aWAp, KnockBackDistance: [700] },
    calculations: ['TotalDamage=NamedDataValue(Damage)+StatByNamedDataValue(APRatio)'],
    selectors: ['APRatio节点省略选择器，按同版窄证mStat0=法术强度。'],
    units: ['spellCastTime/StunDuration/KnockUpDuration秒→毫秒'],
  }, [
    { item: '单一目标击退、眩晕与命中事件', reason: '正文明确；当前候选只保存控制持续和数值公式，不创建状态或伤害结果。' },
  ], [
    { item: 'KnockBackDistance', reason: '700为位移距离/几何信息，当前没有独立位移消费者，本轮不建几何公式。' },
  ]);

  const aETrample = recordData(sourceSeries, 'alistar_e', 'TrampleDamage', [80, 110, 140, 170, 200]);
  const aEAp = recordData(sourceSeries, 'alistar_e', 'APRatio', [0.7], 1);
  const aEDuration = recordData(sourceSeries, 'alistar_e', 'Duration', [5], 1);
  const aEMaxStacks = recordData(sourceSeries, 'alistar_e', 'MaxStacks', [5], 1);
  const aEStun = recordData(sourceSeries, 'alistar_e', 'StunDuration', [1], 1);
  const aEFullCharge = recordData(sourceSeries, 'alistar_e', 'FullChargeDuration', [5], 1);
  const aEBonus = recordSpell(sourceSeries, 'alistar_e', 'spellCastTime', 0.25);
  recordData(sourceSeries, 'alistar_e', 'BonusAARange', [50], 1);
  recordData(sourceSeries, 'alistar_e', 'Radius', [350], 1);
  recordData(sourceSeries, 'alistar_e', 'ProcDamageBase', [20], 1);
  recordData(sourceSeries, 'alistar_e', 'ProcDamageScale', [15], 1);
  skills.alistar_e = skillEntry('alistar_e', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', ms(aEBonus, 'alistar_e/spellCastTime'), '当前绑定spellCastTime=0.25秒，转换为250毫秒。', 10),
      p('trample_damage', '践踏基础魔法伤害', 'INTEGER', 'SKILL_LEVEL', aETrample, '当前绑定DataValues.TrampleDamage索引1至5为80/110/140/170/200；正文是持续期间总值，不称作每次命中。', 20),
      p('ap_ratio', '践踏法术强度倍率', 'DECIMAL', 'FIXED', aEAp[0], '当前绑定DataValues.APRatio=0.7；当前TotalDamage树将其作为来源总法术强度倍率。', 30),
      p('duration_ms', '践踏持续（毫秒）', 'INTEGER', 'FIXED', ms(aEDuration[0], 'alistar_e/Duration'), '当前绑定DataValues.Duration=5秒，转换为5000毫秒；只描述持续窗口，不创建周期过程。', 40),
      p('max_stacks', '满层次数', 'INTEGER', 'FIXED', aEMaxStacks[0], '当前绑定DataValues.MaxStacks=5；次数为整数。', 50),
      p('stun_duration_ms', '满层普攻眩晕持续（毫秒）', 'INTEGER', 'FIXED', ms(aEStun[0], 'alistar_e/StunDuration'), '当前绑定DataValues.StunDuration=1秒，转换为1000毫秒。', 60),
      p('full_charge_duration_ms', '满层充能持续（毫秒）', 'INTEGER', 'FIXED', ms(aEFullCharge[0], 'alistar_e/FullChargeDuration'), '当前绑定DataValues.FullChargeDuration=5秒，转换为5000毫秒；与践踏持续分开。', 70),
      p('attack_bonus_damage', '满层后普攻额外魔法伤害实际输入', 'DECIMAL', 'RUNTIME_INPUT', null, '当前AttackBonusDamage树为ByCharLevelBreakpoints(mLevel1Value=20,mInitialBonusPerLevel=15)，实际等级曲线求值未证；保留无默认运行输入，不猜线性曲线。', 80),
    ],
    formulas: [
      f('total_magic_damage', '践踏持续期间魔法伤害总量', add(param('trample_damage'), multiply(param('ap_ratio'), attr('SOURCE', 'ability_power', 'TOTAL'))), '当前TotalDamage树标记tooltipOnly=true，且正文为持续期间总量；公式=TrampleDamage+0.7×来源总法术强度，不拆成每段tick。', 10),
    ],
    effects: [resourceEffect('mana_cost', '践踏法力消耗', { kind: 'PARAMETER', key: 'mana_cost' }, 'mana', 'CONSUME', '复用当前已有mana_cost参数；只记录一次施放资源变化，持续命中和满层普攻事件待接。')],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { TrampleDamage: aETrample, APRatio: aEAp, Duration: aEDuration, MaxStacks: aEMaxStacks, StunDuration: aEStun, FullChargeDuration: aEFullCharge, BonusAARange: [50], Radius: [350], ProcDamageBase: [20], ProcDamageScale: [15] },
    calculations: ['TotalDamage=NamedDataValue(TrampleDamage)+StatByNamedDataValue(APRatio),tooltipOnly=true', 'AttackBonusDamage=ByCharLevelBreakpoints(20,15)'],
    selectors: ['APRatio节点省略选择器，按同版窄证mStat0=法术强度。'],
    units: ['Duration/FullChargeDuration/StunDuration秒→毫秒', '正文TotalDamage为持续期间总量'],
  }, [
    { item: '践踏持续伤害实际节拍、命中英雄叠层和满层普攻', reason: '数值与满层窗口已保存；当前没有周期、命中、普攻事件接线，不创建DAMAGE或自动触发。' },
    { item: 'AttackBonusDamage等级曲线', reason: '当前树只有断点构造，未证求值算法；使用无默认实际输入。' },
  ], [
    { item: 'BonusAARange与Radius', reason: '当前值为攻击范围/半径几何信息，无独立消费者，本轮不建展示公式。' },
    { item: 'ProcDamageBase与ProcDamageScale', reason: '当前主计算树AttackBonusDamage未消费这两个DataValues；不以未接字段替代实际等级曲线。' },
    { item: '幽灵状态无视碰撞体积', reason: '当前正文是纯碰撞规则，本轮不建独立状态结果。' },
  ]);

  const aRDuration = recordData(sourceSeries, 'alistar_r', 'RDuration', [7], 1);
  const aRReduction = recordData(sourceSeries, 'alistar_r', 'RDamageReduction', [55, 65, 75]);
  const aRCast = recordSpell(sourceSeries, 'alistar_r', 'spellCastTime', 0.25);
  skills.alistar_r = skillEntry('alistar_r', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', ms(aRCast, 'alistar_r/spellCastTime'), '当前绑定spellCastTime=0.25秒，转换为250毫秒。', 10),
      p('duration_ms', '坚定意志持续（毫秒）', 'INTEGER', 'FIXED', ms(aRDuration[0], 'alistar_r/RDuration'), '当前绑定DataValues.RDuration=7秒，转换为7000毫秒。', 20),
      p('damage_reduction_percent_points', '伤害减免百分点', 'INTEGER', 'SKILL_LEVEL', aRReduction, '当前绑定DataValues.RDamageReduction原数组索引1至3为55/65/75；正文直接以百分号显示，保存百分点整数。', 30),
      p('percent_to_ratio', '百分比转比例', 'DECIMAL', 'FIXED', 0.01, '将正文显示的55/65/75百分数点转换为0.55/0.65/0.75供减伤区间使用。', 40),
    ],
    formulas: [
      f('damage_reduction_ratio', '坚定意志伤害减免比例', multiply(param('damage_reduction_percent_points'), param('percent_to_ratio')), '最终减免比例=RDamageReduction百分点×0.01；减免应用于物理和魔法伤害的资格由运行事件提供。', 10),
    ],
    effects: [
      resourceEffect('mana_cost', '坚定意志法力消耗', { kind: 'PARAMETER', key: 'mana_cost' }, 'mana', 'CONSUME', '复用当前已有mana_cost参数；只记录一次施放资源变化，净化与减伤应用事件待接。'),
    ],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { RDuration: aRDuration, RDamageReduction: aRReduction },
    calculations: [],
    sourceTextRule: '当前正文为@RDamageReduction@%伤害减免，必须先把百分点转成比例再进入damage_ratio。',
    units: ['RDuration秒→毫秒', 'RDamageReduction保持百分数点整数'],
  }, [
    { item: '净化限制效果与物理/魔法减伤应用', reason: '正文和数值已明确；当前乘区目录没有可复用的伤害减免乘区，本轮只保存参数和公式，不新增乘区或减伤效果；净化事件和伤害管线接线待运行层。' },
  ], []);

  const bPThreshold = recordData(sourceSeries, 'blitzcrank_p', 'HealthThreshold', [0.3], 1);
  const bPShieldRatio = recordData(sourceSeries, 'blitzcrank_p', 'ManaPercent', [0.35], 1);
  const bPDuration = recordData(sourceSeries, 'blitzcrank_p', 'ShieldDuration', [10], 1);
  const bPCooldown = recordData(sourceSeries, 'blitzcrank_p', 'Cooldown', [90], 1);
  recordData(sourceSeries, 'blitzcrank_p', 'ManaRatio', [1], 1);
  skills.blitzcrank_p = skillEntry('blitzcrank_p', {
    parameters: [
      p('health_threshold_ratio', '低生命触发比例', 'DECIMAL', 'FIXED', bPThreshold[0], '当前正文为低于30%生命值；DataValues.HealthThreshold=0.3，保留比例并等待触发事件。', 10),
      p('shield_ratio', '护盾资源比例', 'DECIMAL', 'FIXED', bPShieldRatio[0], '当前ShieldAmount树的AbilityResourceByCoefficient系数约0.35；正文显示按法力值，保存0.35，不将资源基准写死为属性总法力。', 20),
      p('shield_duration_ms', '护盾持续（毫秒）', 'INTEGER', 'FIXED', ms(bPDuration[0], 'blitzcrank_p/ShieldDuration'), '当前绑定DataValues.ShieldDuration=10秒，转换为10000毫秒。', 30),
      p('cooldown_ms', '法力屏障冷却（毫秒）', 'INTEGER', 'FIXED', ms(bPCooldown[0], 'blitzcrank_p/Cooldown'), '当前绑定DataValues.Cooldown=90秒，转换为90000毫秒。', 40),
      p('ability_resource_value', '护盾计算实际资源输入', 'DECIMAL', 'RUNTIME_INPUT', null, '当前ShieldAmount树直接使用AbilityResourceByCoefficient；本批资源属性的当前/总值资格未证，保留无默认实际输入，不借用mana属性。', 50),
    ],
    formulas: [
      f('shield_amount', '法力屏障护盾量', multiply(param('shield_ratio'), param('ability_resource_value')), '当前ShieldAmount树=AbilityResourceByCoefficient约0.35；实际资源值由运行输入提供，缺失时拒绝求值。', 10),
    ],
    effects: [shieldEffect('mana_barrier_shield', '法力屏障自身护盾', { kind: 'FORMULA', key: 'shield_amount' }, 'shield_duration_ms', '只定义自身普通护盾值和生命周期；低生命受伤触发、资源资格和护盾应用时点待接。')],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { HealthThreshold: bPThreshold, ManaPercent: bPShieldRatio, ShieldDuration: bPDuration, Cooldown: bPCooldown, ManaRatio: [1] },
    calculations: ['ShieldAmount=AbilityResourceByCoefficient(mCoefficient约0.35)'],
    selectors: ['AbilityResourceByCoefficient不映射到mana CURRENT/TOTAL；实际资源由无默认输入提供。'],
    units: ['ShieldDuration/Cooldown秒→毫秒', 'HealthThreshold/ManaPercent保存比例'],
  }, [
    { item: '低于阈值受到伤害时触发护盾、冷却锁定和护盾应用', reason: '当前正文机制明确；候选保留阈值与生命周期，不创建自动触发或状态。' },
    { item: 'AbilityResource的资源类型及当前/总值口径', reason: '来源只给AbilityResourceByCoefficient，当前资源资格未证；无默认输入。' },
  ], [
    { item: 'ManaRatio', reason: '当前ShieldAmount主树使用约0.35系数，ManaRatio=1未被该树消费；仅保留源映射，不把旧未消费字段写入。' },
  ]);

  const bQBase = recordData(sourceSeries, 'blitzcrank_q', 'BaseDamage', [110, 160, 210, 260, 310]);
  const bQAp = recordData(sourceSeries, 'blitzcrank_q', 'APRatio', [1.2], 1);
  const bQCast = recordSpell(sourceSeries, 'blitzcrank_q', 'spellCastTime', 0.25);
  recordData(sourceSeries, 'blitzcrank_q', 'LolipopLength', [70], 1);
  recordSpellRanks(sourceSeries, 'blitzcrank_q', 'cooldownTime', [21, 20, 19, 18, 17]);
  skills.blitzcrank_q = skillEntry('blitzcrank_q', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', ms(bQCast, 'blitzcrank_q/spellCastTime'), '当前绑定spellCastTime=0.25秒，转换为250毫秒。', 10),
      p('base_damage', '基础魔法伤害', 'INTEGER', 'SKILL_LEVEL', bQBase, '当前绑定DataValues.BaseDamage索引1至5为110/160/210/260/310。', 20),
      p('ap_ratio', '法术强度倍率', 'DECIMAL', 'FIXED', bQAp[0], '当前绑定DataValues.APRatio=1.2；当前TotalDamage树按同版窄证mStat0映射来源总法术强度。', 30),
    ],
    formulas: [
      f('magic_damage', '机械飞爪首个敌方英雄魔法伤害', add(param('base_damage'), multiply(param('ap_ratio'), attr('SOURCE', 'ability_power', 'TOTAL'))), '当前TotalDamage树=BaseDamage+1.2×来源总法术强度；首个敌人拉拽事件待接。', 10),
    ],
    effects: [resourceEffect('mana_cost', '机械飞爪法力消耗', { kind: 'PARAMETER', key: 'mana_cost' }, 'mana', 'CONSUME', '复用当前已有mana_cost参数；只记录一次施放资源变化，拉拽与命中事件待接。')],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { BaseDamage: bQBase, APRatio: bQAp, LolipopLength: [70] },
    calculations: ['TotalDamage=NamedDataValue(BaseDamage)+StatByNamedDataValue(APRatio)'],
    spellFields: { spellCastTime: 0.25, cooldownTime: [21, 20, 19, 18, 17, 16, 16] },
    selectors: ['APRatio节点省略选择器，按同版窄证mStat0=法术强度。'],
    units: ['spellCastTime秒→毫秒'],
  }, [
    { item: '第一个敌人拉拽与魔法伤害命中', reason: '当前正文明确第一个敌人；候选只保存数值公式和资源消耗，不创建DAMAGE或拉拽结果。' },
  ], [
    { item: 'LolipopLength与CherryBonusHaste', reason: '前者为抓取几何扩展，后者为空匿名模式字段；本轮不建无消费者组成。' },
  ]);

  const bWMove = recordData(sourceSeries, 'blitzcrank_w', 'MoveSpeedMod', [0.6, 0.65, 0.7, 0.75, 0.8]);
  const bWAttack = recordData(sourceSeries, 'blitzcrank_w', 'AttackSpeedMod', [0.3, 0.4, 0.5, 0.6, 0.7]);
  const bWDuration = recordData(sourceSeries, 'blitzcrank_w', 'Duration', [5], 1);
  const bWSlow = recordData(sourceSeries, 'blitzcrank_w', 'MoveSpeedModReduction', [0.3], 1);
  const bWSlowDuration = recordData(sourceSeries, 'blitzcrank_w', 'SlowDuration', [1.5], 1);
  const bWMin = recordData(sourceSeries, 'blitzcrank_w', 'MoveSpeedModMin', [0.1], 1);
  const bWMinTime = recordData(sourceSeries, 'blitzcrank_w', 'MoveSpeedModMinTime', [2.5], 1);
  recordData(sourceSeries, 'blitzcrank_w', 'PercentHealthDamage', [0.01], 1);
  const bWCast = recordSpell(sourceSeries, 'blitzcrank_w', 'spellCastTime', 0.4043000042438507);
  const bWCooldown = recordSpellRanks(sourceSeries, 'blitzcrank_w', 'cooldownTime', [15, 15, 15, 15, 15]);
  skills.blitzcrank_w = skillEntry('blitzcrank_w', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', ms(bWCast, 'blitzcrank_w/spellCastTime'), '当前绑定spellCastTime约0.4043秒，按毫秒四舍五入为404。', 10),
      p('move_speed_ratio', '移动速度起始加成比例', 'DECIMAL', 'SKILL_LEVEL', bWMove, '当前正文以MoveSpeedMod*100显示持续衰减的移动速度；保存等级1至5起始比例0.6/0.65/0.7/0.75/0.8，仅作衰减端点输入，不创建固定持续属性效果。', 20),
      p('attack_speed_ratio', '攻击速度加成比例', 'DECIMAL', 'SKILL_LEVEL', bWAttack, '当前正文以AttackSpeedMod*100显示攻击速度；保存等级1至5比例0.3/0.4/0.5/0.6/0.7，独立于移动速度衰减。', 30),
      p('duration_ms', '超级充能持续（毫秒）', 'INTEGER', 'FIXED', ms(bWDuration[0], 'blitzcrank_w/Duration'), '当前绑定DataValues.Duration=5秒，转换为5000毫秒。', 40),
      p('slow_ratio', '结束后移动速度降低比例', 'DECIMAL', 'FIXED', bWSlow[0], '当前正文以MoveSpeedModReduction*100显示30%减速；保存正幅度并使用DECREASE，避免双重负号。', 50),
      p('slow_duration_ms', '结束后减速持续（毫秒）', 'INTEGER', 'FIXED', ms(bWSlowDuration[0], 'blitzcrank_w/SlowDuration'), '当前绑定DataValues.SlowDuration=1.5秒，转换为1500毫秒。', 60),
      p('move_speed_min_ratio', '衰减最低移动速度比例', 'DECIMAL', 'FIXED', bWMin[0], '当前来源扩展文本明确衰减终点为MoveSpeedModMin*100；保存0.1，不把中间曲线猜成线性。', 70),
      p('decay_duration_ms', '衰减至最低值时间（毫秒）', 'INTEGER', 'FIXED', ms(bWMinTime[0], 'blitzcrank_w/MoveSpeedModMinTime'), '当前绑定DataValues.MoveSpeedModMinTime=2.5秒，转换为2500毫秒；只记录时间窗口。', 80),
      p('cooldown_ms', '过载运转冷却（毫秒）', 'INTEGER', 'SKILL_LEVEL', bWCooldown.map(value => ms(value, 'blitzcrank_w/cooldownTime')), '当前绑定cooldownTime各等级为15秒，转换为15000毫秒；当前槽只有mana_cost，故新增冷却参数。', 90),
    ],
    formulas: [],
    effects: [
      resourceEffect('mana_cost', '过载运转法力消耗', { kind: 'PARAMETER', key: 'mana_cost' }, 'mana', 'CONSUME', '复用当前已有mana_cost参数；只记录一次施放资源变化。'),
      attributeEffect('attack_speed_boost', '过载运转自身攻击速度加成', { kind: 'PARAMETER', key: 'attack_speed_ratio' }, 'bonus_attack_speed_percent', 'INCREASE', 'duration_ms', '当前正文的攻击速度加成独立持续5000毫秒；不与移动速度衰减共用数值，施放事件待接。', 30),
      attributeEffect('post_overdrive_slow', '过载运转结束后自身减速', { kind: 'PARAMETER', key: 'slow_ratio' }, 'move_speed_percent', 'DECREASE', 'slow_duration_ms', '这是主持续窗口5000毫秒结束后才开始的独立减速，持续1500毫秒；结束自动衔接事件待接，不在本候选中自动触发。', 40),
    ],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { MoveSpeedMod: bWMove, AttackSpeedMod: bWAttack, Duration: bWDuration, MoveSpeedModReduction: bWSlow, SlowDuration: bWSlowDuration, MoveSpeedModMin: bWMin, MoveSpeedModMinTime: bWMinTime, PercentHealthDamage: [0.01] },
    calculations: ['{c01903c1}=ByCharLevelBreakpoints(mLevel1Value=60,mInitialBonusPerLevel=20,mBreakpoints=[7级后每级5])，当前正文未引用'],
    spellFields: { spellCastTime: 0.4043000042438507, cooldownTime: [15, 15, 15, 15, 15] },
    units: ['Duration/SlowDuration/MoveSpeedModMinTime秒→毫秒', 'MoveSpeedMod/AttackSpeedMod/Slow以比例保存，正文乘100显示'],
  }, [
    { item: '移动速度持续衰减的中间曲线和施放时点', reason: '当前正文给出初始值、最低值和时间窗口，但未证中间求值曲线；只保存起始比例、最低比例和2500毫秒窗口，不创建固定5000毫秒移动速度效果。' },
    { item: '结束后减速的自动衔接', reason: '减速参数和独立效果已保存；仅在主5000毫秒窗口结束后开始的时序事件尚未接线，不自动触发。' },
  ], [
    { item: 'PercentHealthDamage', reason: '当前主正文和当前计算树未消费该兵野/附加伤害字段，本轮不写。' },
    { item: '{c01903c1}等级断点公式', reason: '当前正文未引用匿名断点对象，且求值循环未证，不建立无消费者公式。' },
  ]);

  const bEcc = recordData(sourceSeries, 'blitzcrank_e', 'CCDuration', [1], 1);
  const bECast = recordSpell(sourceSeries, 'blitzcrank_e', 'spellCastTime', 0.5217499732971191);
  const bECooldown = recordSpellRanksAtOffset(sourceSeries, 'blitzcrank_e', 'cooldownTime', [7, 6.5, 6, 5.5, 5], 1);
  skills.blitzcrank_e = skillEntry('blitzcrank_e', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', ms(bECast, 'blitzcrank_e/spellCastTime'), '当前绑定spellCastTime约0.52175秒，按毫秒四舍五入为522。', 10),
      p('cc_duration_ms', '击飞持续（毫秒）', 'INTEGER', 'FIXED', ms(bEcc[0], 'blitzcrank_e/CCDuration'), '当前绑定DataValues.CCDuration=1秒，转换为1000毫秒。', 20),
      p('total_attack_damage_multiplier', '整次攻击总攻击力倍率', 'DECIMAL', 'FIXED', 2, '当前TotalDamage树第一项mStat2×2，结合当前技能“下次攻击造成双倍伤害”语义按整次攻击总攻击力使用；不替换为额外攻击力。', 30),
      p('ability_power_ratio', '法术强度倍率', 'DECIMAL', 'FIXED', 0.25, '当前TotalDamage树第二项mCoefficient=0.25，当前节点未给单独数据名，按同版窄证法术强度选择器使用。', 40),
      p('cooldown_ms', '能量铁拳冷却（毫秒）', 'INTEGER', 'SKILL_LEVEL', bECooldown.map(value => ms(value, 'blitzcrank_e/cooldownTime')), '当前客户端cooldownTime首五项为7/7/6.5/6/5.5秒且含首项重复槽位；按官方16.17.1技能等级数组和同版技能等级口径采用7/6.5/6/5.5/5秒，转换为7000/6500/6000/5500/5000毫秒。', 50),
    ],
    formulas: [
      f('physical_damage', '能量铁拳整次攻击物理伤害', add(multiply(param('total_attack_damage_multiplier'), attr('SOURCE', 'attack_damage', 'TOTAL')), multiply(param('ability_power_ratio'), attr('SOURCE', 'ability_power', 'TOTAL'))), '当前TotalDamage树=2×来源总攻击力+0.25×来源总法术强度；这是整次强化攻击的总值，不再叠加一次基础攻击。', 10),
    ],
    effects: [resourceEffect('mana_cost', '能量铁拳法力消耗', { kind: 'PARAMETER', key: 'mana_cost' }, 'mana', 'CONSUME', '复用当前已有mana_cost参数；强化普攻、击飞和伤害事件待接。')],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { CCDuration: bEcc },
    calculations: ['TotalDamage=StatByCoefficientCalculationPart(mStat2,mCoefficient2)+StatByCoefficientCalculationPart(mCoefficient0.25)', '{a9d6b924}=mStat2×1.75+mCoefficient1.25（匿名旧树，当前不消费）'],
    spellFields: { spellCastTime: 0.5217499732971191, cooldownTime: [7, 7, 6.5, 6, 5.5, 5, 5], rankedCooldownTime: [7, 6.5, 6, 5.5, 5], officialCooldownTime: [7, 6.5, 6, 5.5, 5] },
    selectors: ['当前根复核将TotalDamage解释为整次攻击2×总AD+0.25×AP；匿名1.75/1.25树不写。'],
    units: ['spellCastTime/CCDuration秒→毫秒'],
  }, [
    { item: '下次攻击强化、击飞和物理伤害事件', reason: '当前正文明确；只保存整次攻击公式和控制持续，不创建DAMAGE或状态自动触发。' },
  ], [
    { item: '{a9d6b924}匿名公式', reason: '当前正文和主TotalDamage树不消费1.75×AD+1.25×AP旧树，本轮保留源映射但不写。' },
  ]);

  const bRPassiveBase = recordData(sourceSeries, 'blitzcrank_r', 'PassiveBaseDamage', [50, 100, 150]);
  const bRZap = recordData(sourceSeries, 'blitzcrank_r', 'ZapCountdown', [1], 1);
  const bRActiveBase = recordData(sourceSeries, 'blitzcrank_r', 'ActiveBaseDamage', [275, 400, 525]);
  const bRSilence = recordData(sourceSeries, 'blitzcrank_r', 'SilenceDuration', [0.5], 1);
  const bRPassiveAp = recordData(sourceSeries, 'blitzcrank_r', 'PassiveAPRatio', [0.3, 0.4, 0.5]);
  const bRActiveAp = recordData(sourceSeries, 'blitzcrank_r', 'ActiveAPRatio', [1], 1);
  recordData(sourceSeries, 'blitzcrank_r', 'ActiveRange', [600], 1);
  recordData(sourceSeries, 'blitzcrank_r', 'PassiveManaRatio', [0.05], 1);
  const bRCast = recordSpell(sourceSeries, 'blitzcrank_r', 'spellCastTime', 0.25);
  const bRCooldown = recordSpellRanks(sourceSeries, 'blitzcrank_r', 'cooldownTime', [60, 40, 20]);
  skills.blitzcrank_r = skillEntry('blitzcrank_r', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', ms(bRCast, 'blitzcrank_r/spellCastTime'), '当前绑定spellCastTime=0.25秒，转换为250毫秒。', 10),
      p('passive_base_damage', '被动基础魔法伤害', 'INTEGER', 'SKILL_LEVEL', bRPassiveBase, '当前绑定DataValues.PassiveBaseDamage索引1至3为50/100/150。', 20),
      p('passive_ap_ratio', '被动法术强度倍率', 'DECIMAL', 'SKILL_LEVEL', bRPassiveAp, '当前绑定DataValues.PassiveAPRatio索引1至3为0.3/0.4/0.5；正文以百分号显示时由比例×100。', 30),
      p('passive_resource_ratio', '被动资源倍率', 'DECIMAL', 'FIXED', 0.02, '当前PassiveDamage树的AbilityResourceByCoefficient实际系数约0.02；不采用未消费的PassiveManaRatio=0.05。', 40),
      p('passive_ability_resource_value', '被动电击实际资源输入', 'DECIMAL', 'RUNTIME_INPUT', null, '被动计算树直接使用AbilityResource；当前资源的属性类型与当前/总值口径未证，保留无默认输入。', 50),
      p('active_base_damage', '主动基础魔法伤害', 'INTEGER', 'SKILL_LEVEL', bRActiveBase, '当前绑定DataValues.ActiveBaseDamage索引1至3为275/400/525。', 60),
      p('active_ap_ratio', '主动法术强度倍率', 'DECIMAL', 'FIXED', bRActiveAp[0], '当前绑定DataValues.ActiveAPRatio=1；主动TotalDamage树使用来源总法术强度。', 70),
      p('zap_delay_ms', '被动标记后电击延迟（毫秒）', 'INTEGER', 'FIXED', ms(bRZap[0], 'blitzcrank_r/ZapCountdown'), '当前绑定DataValues.ZapCountdown=1秒，转换为1000毫秒；不把延迟当作伤害节拍。', 80),
      p('silence_duration_ms', '主动沉默持续（毫秒）', 'INTEGER', 'FIXED', ms(bRSilence[0], 'blitzcrank_r/SilenceDuration'), '当前绑定DataValues.SilenceDuration=0.5秒，转换为500毫秒。', 90),
      p('cooldown_ms', '静电力场冷却（毫秒）', 'INTEGER', 'SKILL_LEVEL', bRCooldown.map(value => ms(value, 'blitzcrank_r/cooldownTime')), '当前绑定cooldownTime等级1至3为60/40/20秒，转换为60000/40000/20000毫秒；当前槽只有mana_cost，故新增冷却参数。', 100),
    ],
    formulas: [
      f('passive_magic_damage', '静电力场被动电击魔法伤害', add(add(param('passive_base_damage'), multiply(param('passive_ap_ratio'), attr('SOURCE', 'ability_power', 'TOTAL'))), multiply(param('passive_resource_ratio'), param('passive_ability_resource_value'))), '当前PassiveDamage树=PassiveBaseDamage+PassiveAPRatio×来源总法术强度+0.02×AbilityResource；资源实际值无默认。', 10),
      f('active_magic_damage', '静电力场主动魔法伤害', add(param('active_base_damage'), multiply(param('active_ap_ratio'), attr('SOURCE', 'ability_power', 'TOTAL'))), '当前ActiveDamage树=ActiveBaseDamage+ActiveAPRatio×来源总法术强度；主动命中唯一敌方的事件待接。', 20),
    ],
    effects: [resourceEffect('mana_cost', '静电力场法力消耗', { kind: 'PARAMETER', key: 'mana_cost' }, 'mana', 'CONSUME', '复用当前已有mana_cost参数；被动标记、电击、主动沉默和护盾移除事件待接。')],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { PassiveBaseDamage: bRPassiveBase, ZapCountdown: bRZap, ActiveBaseDamage: bRActiveBase, SilenceDuration: bRSilence, PassiveAPRatio: bRPassiveAp, ActiveAPRatio: bRActiveAp, ActiveRange: [600], PassiveManaRatio: [0.05] },
    calculations: ['PassiveDamage=PassiveBaseDamage+StatByNamedDataValue(PassiveAPRatio)+AbilityResourceByCoefficient(mCoefficient约0.02)', 'ActiveDamage=ActiveBaseDamage+StatByNamedDataValue(ActiveAPRatio)'],
    selectors: ['被动资源项使用当前树实际0.02；资源值无默认，不能用mana TOTAL代替。', '主动与被动AP节点按同版窄证mStat0=法术强度。'],
    spellFields: { spellCastTime: 0.25, cooldownTime: [60, 40, 20] },
    units: ['ZapCountdown/SilenceDuration秒→毫秒', 'PassiveAPRatio保存比例'],
  }, [
    { item: '普攻标记、1秒后被动电击', reason: '当前正文明确“技能可用时标记攻击目标并在1秒后电击”；参数和公式已保存，标记与延迟事件待接。' },
    { item: '主动唯一敌方命中、沉默和护盾摧毁', reason: '当前正文明确；只保存主动伤害、沉默持续和资源消耗，不创建伤害/状态/护盾移除结果。' },
    { item: '被动只在技能可用时生效', reason: '资格条件保留为事件约束，不创建布尔状态或自动初始化。' },
  ], [
    { item: 'ActiveRange', reason: '600为范围几何信息，本轮唯一敌方范围规则由事件提供，不建展示面积公式。' },
    { item: 'PassiveManaRatio', reason: '当前树实际使用AbilityResource系数约0.02，0.05为未消费DataValue；只保留来源待核。' },
    { item: '不会打破野怪护盾', reason: '当前正文是兵野专用条件，按本轮范围排除；唯一敌方英雄主动效果仍保留待接。' },
  ]);

  return skills;
}

function listFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(file));
    else result.push(file);
  }
  return result.sort((a, b) => a.localeCompare(b));
}
function sourceManifest() {
  return listFiles(inputDir).map(file => ({ path: path.relative(inputDir, file).replaceAll(path.sep, '/'), sha256: sha256File(file), byteSize: fs.statSync(file).size }));
}
function buildCandidate() {
  const skills = buildSkills();
  const counts = { parameters: 0, formulas: 0, effects: 0, processes: 0, internalStates: 0, triggerRules: 0 };
  for (const skillKey of order) for (const kind of Object.keys(counts)) counts[kind] += skills[skillKey].write[kind].length;
  const expectedCounts = { parameters: 57, formulas: 10, effects: 11, processes: 0, internalStates: 0, triggerRules: 0 };
  if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) throw new Error(`候选计数异常: ${JSON.stringify(counts)}`);
  const snapshotSha256 = sha256File(path.join(referenceDir, '当前10槽保护快照.json'));
  const generatedAt = new Date().toISOString();
  const candidate = {
    meta: {
      generatedAt,
      batch: '英雄机制第二十六批',
      status: '候选待主负责人审查，未调用业务接口',
      gameId: 'lol',
      apiBase: 'http://127.0.0.1:8080/api/admin/games/lol',
      sourceVersion: { clientVersion: '16.17', officialVersion: '16.17.1', build: '16.17.8104348+branch.releases-16-17.content.release' },
      scope: '阿利斯塔、布里茨10个技能槽的修订一；只新增来源明确参数、实际二元公式、成熟自身护盾/属性效果和一次法力消耗组成。布里茨W移除错误的固定5000毫秒移动速度属性效果，仅保留起始/最低比例、2500毫秒衰减窗口、5000毫秒攻击速度效果和主窗口结束后1500毫秒减速；布里茨E冷却按客户端技能等级口径与官方数组修正为7000/6500/6000/5500/5000毫秒。减伤只保留参数与公式，因当前无可复用伤害乘区而不新增效果；不写主体、六类分类、关系、图片或已有公共参数，不建DAMAGE、DIRECT_HEAL、MOMENT_EVALUATION结果，不创建自动触发。',
      sourcePolicy: '固定客户端16.17、官方16.17.1和构建16.17.8104348；沿当前根绑定正文和当前计算树；未知等级曲线、资源类型和运行输入不猜、不设默认。',
      inputPackage: '输入包/',
      currentSnapshot: '输入包/参考资料/当前10槽保护快照.json',
      currentSnapshotSha256: snapshotSha256,
      sourceIndexSha256: inputVersion.sourceIndexSha256,
      businessWrites: 0,
      apiCalls: 0,
      tokenStored: false,
      candidateSha256: null,
    },
    skills,
    order,
    reusedPublicParameters: reuseList.map(item => ({ ...item, source: '输入包/参考资料/公共参数复用清单.json', post: false })),
    reusedExistingParameters: reuseList.map(item => ({ ...item, post: false })),
    counts,
    apiWrites: 0,
    sourceFiles: inputVersion.sourceFiles,
    sourceNotes,
    protectedObjects: {
      subjects: order.map(skillKey => ({ skillKey, subject: currentSnapshot.summary[skillKey].subject, source: '输入包/参考资料/当前10槽保护快照.json' })),
      currentCompositionLists: Object.fromEntries(order.map(skillKey => [skillKey, currentSnapshot.summary[skillKey].components])),
      reusedPublicParameters: reuseList.map(item => ({ ...item, current: currentSnapshot.summary[item.skillKey].components.parameters.find(row => row.parameterKey === item.parameterKey) ?? null })),
      scope: '只读保护快照中的主体和六类组成；所有已有对象完整保留，新增请求不得更新、删除或覆盖。',
    },
    revision: 'hero26-source-v1-candidate-revision-1',
  };
  return { candidate, snapshotSha256, generatedAt };
}

function makeRequests(candidate) {
  const requests = [];
  for (const skillKey of order) {
    for (const kind of ['parameters', 'formulas', 'effects']) {
      for (const body of candidate.skills[skillKey].write[kind]) {
        const stableKey = body[fieldByKind[kind]];
        requests.push({ sequence: requests.length + 1, method: 'POST', route: `/skills/${skillKey}/${endpointByKind[kind]}`, detailRoute: `/skills/${skillKey}/${endpointByKind[kind]}/${encodeURIComponent(stableKey)}`, skillKey, kind, stableKey, status: '仅意图，未调用', body });
      }
    }
  }
  const requestCounts = { parameters: 0, formulas: 0, effects: 0, processes: 0, internalStates: 0, triggerRules: 0 };
  for (const request of requests) requestCounts[request.kind] += 1;
  return { requests, requestCounts };
}

function main() {
  const { candidate, snapshotSha256, generatedAt } = buildCandidate();
  fs.mkdirSync(here, { recursive: true });
  fs.mkdirSync(batchDir, { recursive: true });
  writeJson(path.join(here, '完整候选.json'), candidate);
  const candidateSha256 = sha256File(path.join(here, '完整候选.json'));
  const sourceValues = {
    generatedAt,
    status: '独立源值摘要，未调用业务接口',
    sourceVersion: { clientVersion: '16.17', officialVersion: '16.17.1', build: '16.17.8104348+branch.releases-16-17.content.release' },
    sourceIndexSha256: inputVersion.sourceIndexSha256,
    sourceSeries,
    skills: Object.fromEntries(order.map(skillKey => {
      const { currentTexts, rawSpell } = sourceSkill(skillKey);
      return [skillKey, { binding: candidate.skills[skillKey].source, currentBoundText: currentTexts, dataValues: Object.fromEntries((rawSpell.DataValues ?? []).map(row => [row.name, row.values ?? null])), calculations: rawSpell.mSpellCalculations ?? {}, sourceNotes: sourceNotes[skillKey] ?? null, pending: candidate.skills[skillKey].pending, excluded: candidate.skills[skillKey].excluded }];
    })),
    noWrites: true,
  };
  writeJson(path.join(here, '源值解析.json'), sourceValues);
  const sourceValuesSha256 = sha256File(path.join(here, '源值解析.json'));
  const manifest = sourceManifest();
  writeJson(path.join(here, '来源哈希汇总.json'), { generatedAt, sourceVersion: candidate.meta.sourceVersion, inputPackage: '输入包/', files: manifest, sourceManifestSha256: null });
  const manifestSha256 = sha256File(path.join(here, '来源哈希汇总.json'));
  const { requests, requestCounts } = makeRequests(candidate);
  const plan = {
    generatedAt,
    status: '仅写入意图，未调用业务接口',
    batch: '英雄机制第二十六批',
    apiBase: candidate.meta.apiBase,
    sourceVersion: candidate.meta.sourceVersion,
    candidateSha256,
    currentSnapshotSha256: snapshotSha256,
    requestCount: requests.length,
    requestCounts,
    reusedPublicParameters: reuseList.map(item => ({ ...item, post: false })),
    protectedSkills: order,
    protectedCounts: { subjects: 10, currentCompositionSkillSlots: 10, currentCompositionLists: 60, reusedPublicParameters: 13 },
    requests,
    noApiCalls: true,
  };
  writeJson(path.join(here, '写前请求计划.json'), plan);
  const planSha256 = sha256File(path.join(here, '写前请求计划.json'));
  const version = {
    generatedAt,
    status: '候选待审',
    batch: '英雄机制第二十六批',
    sourceRevision: candidate.revision,
    candidateSha256,
    requestPlanSha256: planSha256,
    sourceValuesSha256,
    sourceManifestSha256: manifestSha256,
    currentSnapshotSha256: snapshotSha256,
    sourceIndexSha256: inputVersion.sourceIndexSha256,
    counts: candidate.counts,
    requestCount: requests.length,
    businessWrites: 0,
    strictMathSha256: null,
  };
  writeJson(path.join(here, '候选版本.json'), version);
  const lock = {
    generatedAt,
    status: '候选已生成，等待主负责人审查；未授权业务写入',
    batch: '英雄机制第二十六批',
    candidateSha256,
    requestPlanSha256: planSha256,
    sourceValuesSha256,
    sourceManifestSha256: manifestSha256,
    currentSnapshotSha256: snapshotSha256,
    requestCount: requests.length,
    counts: candidate.counts,
    protectedExisting: { subjects: 10, compositionLists: 60, reusedPublicParameters: 13 },
    noApiCalls: true,
    applyAuthorized: false,
  };
  writeJson(path.join(here, '冻结候选锁.json'), lock);
  const index = {
    batch: '英雄机制第二十六批',
    status: '候选待审，未调用业务接口',
    candidate: '完整候选.json',
    plan: '写前请求计划.json',
    sourceValues: '源值解析.json',
    sourceManifest: '来源哈希汇总.json',
    version: '候选版本.json',
    lock: '冻结候选锁.json',
    source: '输入包/来源绑定与当前文本.json',
    protected: '输入包/参考资料/当前10槽保护快照.json',
    reused: '输入包/参考资料/公共参数复用清单.json',
    counts: candidate.counts,
    requestCount: requests.length,
    exactNewObjects: candidate.counts.parameters + candidate.counts.formulas + candidate.counts.effects,
    reusedParameters: 13,
    protectedSubjects: 10,
    protectedCompositionLists: 60,
    noApiCalls: true,
  };
  writeJson(path.join(here, '候选交付索引.json'), index);
  for (const file of ['完整候选.json', '写前请求计划.json', '源值解析.json', '来源哈希汇总.json', '候选版本.json', '冻结候选锁.json', '候选交付索引.json']) {
    fs.copyFileSync(path.join(here, file), path.join(batchDir, file));
  }
  console.log(JSON.stringify({ candidateSha256, planSha256, sourceValuesSha256, sourceManifestSha256: manifestSha256, counts: candidate.counts, requestCount: requests.length, artifactDir: here, batchDir }, null, 2));
}

main();

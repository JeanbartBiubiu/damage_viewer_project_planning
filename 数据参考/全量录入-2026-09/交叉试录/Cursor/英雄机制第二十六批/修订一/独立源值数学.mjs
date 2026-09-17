import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const inputDir = path.join(here, '输入包');
const referenceDir = path.join(inputDir, '参考资料');
const candidateFile = path.join(here, '完整候选.json');
const binding = JSON.parse(fs.readFileSync(path.join(inputDir, '来源绑定与当前文本.json'), 'utf8'));
const inputVersion = JSON.parse(fs.readFileSync(path.join(inputDir, '输入版本.json'), 'utf8'));
const candidate = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(referenceDir, '当前10槽保护快照.json'), 'utf8'));
const reuseList = JSON.parse(fs.readFileSync(path.join(referenceDir, '公共参数复用清单.json'), 'utf8'));
const officialBlitzcrank = JSON.parse(fs.readFileSync(path.join(referenceDir, '官方中文', 'Blitzcrank.json'), 'utf8'));
const order = candidate.order;
const rawCache = new Map();
const parameterIndex = new Map();
const formulaIndex = new Map();
for (const skillKey of order) {
  for (const parameter of candidate.skills[skillKey].write.parameters) parameterIndex.set(`${skillKey}/${parameter.parameterKey}`, parameter);
  for (const formula of candidate.skills[skillKey].write.formulas) formulaIndex.set(`${skillKey}/${formula.formulaKey}`, formula);
}

function sha256File(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`不是有限数值: ${label}`);
  return value;
}
function approx(actual, expected, tolerance = 1e-8) { return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected)); }
function norm(value) { return Number((Math.round(value * 1e6) / 1e6).toFixed(6)); }
function ctx(skillKey, level, attributes = {}, runtime = {}) { return { skillKey, level, attributes, runtime, omitParameters: new Set(), omitAttributes: new Set() }; }

function rawHero(skillKey) {
  const heroId = skillKey.startsWith('alistar_') ? 'Alistar' : 'Blitzcrank';
  if (!rawCache.has(heroId)) rawCache.set(heroId, JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(referenceDir, '客户端原文', `${heroId}.json.gz`)))));
  return rawCache.get(heroId);
}
function bound(skillKey) {
  const heroId = skillKey.startsWith('alistar_') ? 'Alistar' : 'Blitzcrank';
  const slot = skillKey.slice(skillKey.lastIndexOf('_') + 1).toUpperCase();
  const hero = binding.heroes.find(item => item.id === heroId);
  const meta = hero?.source?.skills?.find(item => item.slot === slot);
  if (!hero || !meta) throw new Error(`独立来源缺少绑定 ${skillKey}`);
  const rawObject = rawHero(skillKey)[meta.clientPath];
  if (!rawObject?.mSpell) throw new Error(`独立来源缺少对象 ${skillKey}/${meta.clientPath}`);
  return { hero, meta, rawObject, rawSpell: rawObject.mSpell };
}
function rawData(skillKey, dataName, level = 1) {
  const row = (bound(skillKey).rawSpell.DataValues ?? []).find(item => item.name === dataName);
  if (!row || !Array.isArray(row.values)) throw new Error(`独立来源缺少DataValues ${skillKey}/${dataName}`);
  const value = row.values[level];
  if (value === undefined) throw new Error(`独立来源等级越界 ${skillKey}/${dataName}@${level}`);
  return norm(value);
}
function rawDataSeries(skillKey, dataName, count) {
  const row = (bound(skillKey).rawSpell.DataValues ?? []).find(item => item.name === dataName);
  if (!row || !Array.isArray(row.values)) throw new Error(`独立来源缺少DataValues ${skillKey}/${dataName}`);
  return row.values.slice(1, count + 1).map(norm);
}
function rawSpellField(skillKey, field) { return bound(skillKey).rawSpell[field]; }
function parameterValue(skillKey, parameterKey, context) {
  const fullKey = `${skillKey}/${parameterKey}`;
  if (context.omitParameters.has(fullKey)) throw new Error(`缺少参数输入 ${fullKey}`);
  const parameter = parameterIndex.get(fullKey);
  if (!parameter) throw new Error(`候选中缺少参数 ${fullKey}`);
  if (parameter.valueMode === 'FIXED') return finite(parameter.fixedValue, fullKey);
  if (parameter.valueMode === 'SKILL_LEVEL') {
    const key = String(context.level);
    if (!own(parameter.levelValues ?? {}, key)) throw new Error(`缺少等级参数输入 ${fullKey}@${key}`);
    return finite(parameter.levelValues[key], `${fullKey}@${key}`);
  }
  if (parameter.valueMode === 'RUNTIME_INPUT') {
    const values = context.runtime?.[skillKey] ?? {};
    if (!own(values, parameterKey)) throw new Error(`缺少运行输入 ${fullKey}`);
    return finite(values[parameterKey], fullKey);
  }
  throw new Error(`未知参数取值模式 ${parameter.valueMode}`);
}
function attributeValue(node, context) {
  const key = `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`;
  if (context.omitAttributes.has(key)) throw new Error(`缺少属性输入 ${key}`);
  const owner = context.attributes?.[node.attributeOwner] ?? {};
  const attribute = owner[node.attributeKey] ?? {};
  if (!own(attribute, node.attributeValueKind)) throw new Error(`缺少属性输入 ${key}`);
  return finite(attribute[node.attributeValueKind], key);
}
function evaluate(node, context, skillKey) {
  if (!node || typeof node !== 'object') throw new Error('公式节点为空');
  if (node.nodeType === 'PARAMETER') return parameterValue(skillKey, node.parameterKey, context);
  if (node.nodeType === 'ATTRIBUTE') return attributeValue(node, context);
  if (node.nodeType !== 'OPERATION') throw new Error(`未知节点类型 ${node.nodeType}`);
  if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`运算节点必须恰好两个输入 ${node.operation}`);
  const left = evaluate(node.operands[0], context, skillKey);
  const right = evaluate(node.operands[1], context, skillKey);
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error(`未实现运算 ${node.operation}`);
  }
}
function evalFormula(skillKey, formulaKey, context) {
  const formula = formulaIndex.get(`${skillKey}/${formulaKey}`);
  if (!formula) throw new Error(`候选中缺少公式 ${skillKey}/${formulaKey}`);
  return evaluate(formula.expression, context, skillKey);
}
function leaves(node, result = []) {
  if (node.nodeType === 'PARAMETER') result.push({ type: 'PARAMETER', key: node.parameterKey });
  else if (node.nodeType === 'ATTRIBUTE') result.push({ type: 'ATTRIBUTE', key: `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}` });
  else if (node.nodeType === 'OPERATION') {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error('发现非二元运算节点');
    for (const operand of node.operands) leaves(operand, result);
  } else throw new Error(`未知表达式节点 ${node.nodeType}`);
  return result;
}
function firstRemovableLeaf(skillKey, formula) {
  for (const leaf of leaves(formula.expression)) {
    if (leaf.type === 'ATTRIBUTE') return leaf;
    const parameter = parameterIndex.get(`${skillKey}/${leaf.key}`);
    if (parameter?.valueMode !== 'FIXED') return leaf;
  }
  throw new Error(`公式没有可缺值核验输入 ${skillKey}/${formula.formulaKey}`);
}

const attrsA = {
  SOURCE: { hp: { CURRENT: 1250, TOTAL: 3000, BONUS: 1750, MISSING: 1750 }, ability_power: { TOTAL: 50 }, attack_damage: { CURRENT: 160, TOTAL: 160, BONUS: 90 } },
  TARGET: { hp: { CURRENT: 900, TOTAL: 1600, BONUS: 700, MISSING: 700 } },
};
const attrsB = {
  SOURCE: { hp: { CURRENT: 2222, TOTAL: 4800, BONUS: 2578, MISSING: 2578 }, ability_power: { TOTAL: 275 }, attack_damage: { CURRENT: 405, TOTAL: 405, BONUS: 325 } },
  TARGET: { hp: { CURRENT: 2500, TOTAL: 5200, BONUS: 2700, MISSING: 2700 } },
};
const formulaCases = {
  'alistar_p/self_heal_amount': [
    { name: '自身总生命3000', context: ctx('alistar_p', 1, attrsA), expected: c => rawData('alistar_p', 'AlistarPassiveHealRatio') * c.attributes.SOURCE.hp.TOTAL },
    { name: '自身总生命4800', context: ctx('alistar_p', 1, attrsB), expected: c => rawData('alistar_p', 'AlistarPassiveHealRatio') * c.attributes.SOURCE.hp.TOTAL },
  ],
  'alistar_q/magic_damage': [
    { name: '一级法强50', context: ctx('alistar_q', 1, attrsA), expected: c => rawData('alistar_q', 'BaseDamage', 1) + rawData('alistar_q', 'APRatio') * c.attributes.SOURCE.ability_power.TOTAL },
    { name: '五级法强275', context: ctx('alistar_q', 5, attrsB), expected: c => rawData('alistar_q', 'BaseDamage', 5) + rawData('alistar_q', 'APRatio') * c.attributes.SOURCE.ability_power.TOTAL },
  ],
  'alistar_w/magic_damage': [
    { name: '一级法强50', context: ctx('alistar_w', 1, attrsA), expected: c => rawData('alistar_w', 'Damage', 1) + rawData('alistar_w', 'APRatio') * c.attributes.SOURCE.ability_power.TOTAL },
    { name: '五级法强275', context: ctx('alistar_w', 5, attrsB), expected: c => rawData('alistar_w', 'Damage', 5) + rawData('alistar_w', 'APRatio') * c.attributes.SOURCE.ability_power.TOTAL },
  ],
  'alistar_e/total_magic_damage': [
    { name: '一级持续总量', context: ctx('alistar_e', 1, attrsA), expected: c => rawData('alistar_e', 'TrampleDamage', 1) + rawData('alistar_e', 'APRatio') * c.attributes.SOURCE.ability_power.TOTAL },
    { name: '五级持续总量', context: ctx('alistar_e', 5, attrsB), expected: c => rawData('alistar_e', 'TrampleDamage', 5) + rawData('alistar_e', 'APRatio') * c.attributes.SOURCE.ability_power.TOTAL },
  ],
  'alistar_r/damage_reduction_ratio': [
    { name: '一级55百分点', context: ctx('alistar_r', 1, attrsA), expected: () => rawData('alistar_r', 'RDamageReduction', 1) * 0.01 },
    { name: '三级75百分点', context: ctx('alistar_r', 3, attrsB), expected: () => rawData('alistar_r', 'RDamageReduction', 3) * 0.01 },
  ],
  'blitzcrank_p/shield_amount': [
    { name: '资源800', context: ctx('blitzcrank_p', 1, attrsA, { blitzcrank_p: { ability_resource_value: 800 } }), expected: c => rawData('blitzcrank_p', 'ManaPercent') * c.runtime.blitzcrank_p.ability_resource_value },
    { name: '资源1533', context: ctx('blitzcrank_p', 1, attrsB, { blitzcrank_p: { ability_resource_value: 1533 } }), expected: c => rawData('blitzcrank_p', 'ManaPercent') * c.runtime.blitzcrank_p.ability_resource_value },
  ],
  'blitzcrank_q/magic_damage': [
    { name: '一级法强50', context: ctx('blitzcrank_q', 1, attrsA), expected: c => rawData('blitzcrank_q', 'BaseDamage', 1) + rawData('blitzcrank_q', 'APRatio') * c.attributes.SOURCE.ability_power.TOTAL },
    { name: '五级法强275', context: ctx('blitzcrank_q', 5, attrsB), expected: c => rawData('blitzcrank_q', 'BaseDamage', 5) + rawData('blitzcrank_q', 'APRatio') * c.attributes.SOURCE.ability_power.TOTAL },
  ],
  'blitzcrank_e/physical_damage': [
    { name: '总攻击力160法强50', context: ctx('blitzcrank_e', 1, attrsA), expected: c => 2 * c.attributes.SOURCE.attack_damage.TOTAL + 0.25 * c.attributes.SOURCE.ability_power.TOTAL },
    { name: '总攻击力405法强275', context: ctx('blitzcrank_e', 5, attrsB), expected: c => 2 * c.attributes.SOURCE.attack_damage.TOTAL + 0.25 * c.attributes.SOURCE.ability_power.TOTAL },
  ],
  'blitzcrank_r/passive_magic_damage': [
    { name: '一级资源500', context: ctx('blitzcrank_r', 1, attrsA, { blitzcrank_r: { passive_ability_resource_value: 500 } }), expected: c => rawData('blitzcrank_r', 'PassiveBaseDamage', 1) + rawData('blitzcrank_r', 'PassiveAPRatio', 1) * c.attributes.SOURCE.ability_power.TOTAL + 0.02 * c.runtime.blitzcrank_r.passive_ability_resource_value },
    { name: '三级资源1725', context: ctx('blitzcrank_r', 3, attrsB, { blitzcrank_r: { passive_ability_resource_value: 1725 } }), expected: c => rawData('blitzcrank_r', 'PassiveBaseDamage', 3) + rawData('blitzcrank_r', 'PassiveAPRatio', 3) * c.attributes.SOURCE.ability_power.TOTAL + 0.02 * c.runtime.blitzcrank_r.passive_ability_resource_value },
  ],
  'blitzcrank_r/active_magic_damage': [
    { name: '一级法强50', context: ctx('blitzcrank_r', 1, attrsA), expected: c => rawData('blitzcrank_r', 'ActiveBaseDamage', 1) + rawData('blitzcrank_r', 'ActiveAPRatio') * c.attributes.SOURCE.ability_power.TOTAL },
    { name: '三级法强275', context: ctx('blitzcrank_r', 3, attrsB), expected: c => rawData('blitzcrank_r', 'ActiveBaseDamage', 3) + rawData('blitzcrank_r', 'ActiveAPRatio') * c.attributes.SOURCE.ability_power.TOTAL },
  ],
};

const sourceChecks = [];
function checkParameterSeries(skillKey, parameterKey, sourceName, expectedCount, transform = values => values) {
  const parameter = parameterIndex.get(`${skillKey}/${parameterKey}`);
  if (!parameter) throw new Error(`缺少系列参数 ${skillKey}/${parameterKey}`);
  const raw = rawDataSeries(skillKey, sourceName, expectedCount);
  const expected = transform(raw.slice());
  const actual = parameter.valueMode === 'SKILL_LEVEL'
    ? Object.keys(parameter.levelValues ?? {}).sort((a, b) => Number(a) - Number(b)).map(key => parameter.levelValues[key])
    : parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : [];
  if (actual.length !== expected.length || actual.some((value, index) => !approx(value, expected[index]))) throw new Error(`源系列和参数不一致 ${skillKey}/${parameterKey}`);
  sourceChecks.push({ skillKey, parameterKey, sourceName, raw: (bound(skillKey).rawSpell.DataValues.find(row => row.name === sourceName)?.values ?? []).slice(), candidate: actual, transformation: transform === (values => values) ? null : '转换后比对' });
}
function checkFixedTime(skillKey, parameterKey, sourceField, sourceSeconds) {
  const parameter = parameterIndex.get(`${skillKey}/${parameterKey}`);
  const actualSeconds = sourceSeconds ?? rawSpellField(skillKey, sourceField);
  const expected = Math.round(actualSeconds * 1000);
  if (!parameter || parameter.fixedValue !== expected || parameter.valueType !== 'INTEGER') throw new Error(`时间参数不一致 ${skillKey}/${parameterKey}`);
  sourceChecks.push({ skillKey, parameterKey, sourceField, rawSeconds: actualSeconds, candidateMs: expected, normalized: true });
}
function checkCooldownRankSeries(skillKey, parameterKey, expectedSeconds, officialSpellId) {
  const parameter = parameterIndex.get(`${skillKey}/${parameterKey}`);
  const raw = rawSpellField(skillKey, 'cooldownTime');
  const rawRanked = Array.isArray(raw) ? raw.slice(1, 1 + expectedSeconds.length) : [];
  const officialSpell = (officialBlitzcrank.data?.Blitzcrank?.spells ?? []).find(spell => spell.id === officialSpellId);
  const official = officialSpell?.cooldown;
  const expectedMs = expectedSeconds.map(value => Math.round(value * 1000));
  const candidateValues = parameter?.valueMode === 'SKILL_LEVEL'
    ? Object.keys(parameter.levelValues ?? {}).sort((a, b) => Number(a) - Number(b)).map(key => parameter.levelValues[key])
    : [];
  if (!Array.isArray(raw) || rawRanked.length !== expectedSeconds.length || rawRanked.some((value, index) => !approx(value, expectedSeconds[index]))) {
    throw new Error(`客户端冷却等级口径不一致 ${skillKey}: ${JSON.stringify(raw)}，技能等级索引1起应为${JSON.stringify(expectedSeconds)}`);
  }
  if (!Array.isArray(official) || official.length !== expectedSeconds.length || official.some((value, index) => !approx(value, expectedSeconds[index]))) {
    throw new Error(`官方冷却等级口径不一致 ${skillKey}/${officialSpellId}: ${JSON.stringify(official)} != ${JSON.stringify(expectedSeconds)}`);
  }
  if (!parameter || candidateValues.length !== expectedMs.length || candidateValues.some((value, index) => value !== expectedMs[index]) || parameter.valueType !== 'INTEGER') {
    throw new Error(`候选冷却等级参数不一致 ${skillKey}/${parameterKey}: ${JSON.stringify(candidateValues)} != ${JSON.stringify(expectedMs)}`);
  }
  sourceChecks.push({
    skillKey,
    parameterKey,
    sourceField: 'cooldownTime',
    raw,
    clientRankSlice: { startIndex: 1, endIndex: expectedSeconds.length, values: rawRanked },
    officialFile: '参考资料/官方中文/Blitzcrank.json',
    officialSpellId,
    officialRankValues: official,
    expectedSeconds,
    candidateMs: candidateValues,
    transformation: '客户端技能等级索引1至5直接取值，秒转整数毫秒；官方16.17.1数组独立交叉核对',
  });
}

checkParameterSeries('alistar_p', 'self_heal_ratio', 'AlistarPassiveHealRatio', 1);
checkParameterSeries('alistar_p', 'passive_cooldown_ms', 'PassiveCooldown', 1, values => values.map(value => Math.round(value * 1000)));
checkParameterSeries('alistar_p', 'passive_max_stacks', 'PassiveMaxStacks', 1);
checkParameterSeries('alistar_p', 'passive_stacks_champion_kill', 'PassiveStacksChampionKill', 1);
checkFixedTime('alistar_q', 'cast_time_ms', 'spellCastTime');
checkParameterSeries('alistar_q', 'base_damage', 'BaseDamage', 5);
checkParameterSeries('alistar_q', 'ap_ratio', 'APRatio', 1);
checkParameterSeries('alistar_q', 'knockup_duration_ms', 'KnockupDuration', 1, values => values.map(value => Math.round(value * 1000)));
checkFixedTime('alistar_w', 'cast_time_ms', 'spellCastTime');
checkParameterSeries('alistar_w', 'base_damage', 'Damage', 5);
checkParameterSeries('alistar_w', 'ap_ratio', 'APRatio', 1);
checkParameterSeries('alistar_w', 'stun_duration_ms', 'StunDuration', 1, values => values.map(value => Math.round(value * 1000)));
checkParameterSeries('alistar_w', 'knockup_duration_ms', 'KnockUpDuration', 1, values => values.map(value => Math.round(value * 1000)));
checkFixedTime('alistar_e', 'cast_time_ms', 'spellCastTime');
checkParameterSeries('alistar_e', 'trample_damage', 'TrampleDamage', 5);
checkParameterSeries('alistar_e', 'ap_ratio', 'APRatio', 1);
checkParameterSeries('alistar_e', 'duration_ms', 'Duration', 1, values => values.map(value => Math.round(value * 1000)));
checkParameterSeries('alistar_e', 'max_stacks', 'MaxStacks', 1);
checkParameterSeries('alistar_e', 'stun_duration_ms', 'StunDuration', 1, values => values.map(value => Math.round(value * 1000)));
checkParameterSeries('alistar_e', 'full_charge_duration_ms', 'FullChargeDuration', 1, values => values.map(value => Math.round(value * 1000)));
checkFixedTime('alistar_r', 'cast_time_ms', 'spellCastTime');
checkParameterSeries('alistar_r', 'duration_ms', 'RDuration', 1, values => values.map(value => Math.round(value * 1000)));
checkParameterSeries('alistar_r', 'damage_reduction_percent_points', 'RDamageReduction', 3);
checkFixedTime('blitzcrank_q', 'cast_time_ms', 'spellCastTime');
checkParameterSeries('blitzcrank_q', 'base_damage', 'BaseDamage', 5);
checkParameterSeries('blitzcrank_q', 'ap_ratio', 'APRatio', 1);
checkParameterSeries('blitzcrank_p', 'health_threshold_ratio', 'HealthThreshold', 1);
checkParameterSeries('blitzcrank_p', 'shield_ratio', 'ManaPercent', 1);
checkParameterSeries('blitzcrank_p', 'shield_duration_ms', 'ShieldDuration', 1, values => values.map(value => Math.round(value * 1000)));
checkParameterSeries('blitzcrank_p', 'cooldown_ms', 'Cooldown', 1, values => values.map(value => Math.round(value * 1000)));
checkFixedTime('blitzcrank_w', 'cast_time_ms', 'spellCastTime');
checkParameterSeries('blitzcrank_w', 'move_speed_ratio', 'MoveSpeedMod', 5);
checkParameterSeries('blitzcrank_w', 'attack_speed_ratio', 'AttackSpeedMod', 5);
checkParameterSeries('blitzcrank_w', 'duration_ms', 'Duration', 1, values => values.map(value => Math.round(value * 1000)));
checkParameterSeries('blitzcrank_w', 'slow_ratio', 'MoveSpeedModReduction', 1);
checkParameterSeries('blitzcrank_w', 'slow_duration_ms', 'SlowDuration', 1, values => values.map(value => Math.round(value * 1000)));
checkParameterSeries('blitzcrank_w', 'move_speed_min_ratio', 'MoveSpeedModMin', 1);
checkParameterSeries('blitzcrank_w', 'decay_duration_ms', 'MoveSpeedModMinTime', 1, values => values.map(value => Math.round(value * 1000)));
checkParameterSeries('blitzcrank_e', 'cc_duration_ms', 'CCDuration', 1, values => values.map(value => Math.round(value * 1000)));
checkFixedTime('blitzcrank_e', 'cast_time_ms', 'spellCastTime');
checkCooldownRankSeries('blitzcrank_e', 'cooldown_ms', [7, 6.5, 6, 5.5, 5], 'PowerFist');
checkParameterSeries('blitzcrank_r', 'passive_base_damage', 'PassiveBaseDamage', 3);
checkParameterSeries('blitzcrank_r', 'passive_ap_ratio', 'PassiveAPRatio', 3);
checkParameterSeries('blitzcrank_r', 'active_base_damage', 'ActiveBaseDamage', 3);
checkParameterSeries('blitzcrank_r', 'active_ap_ratio', 'ActiveAPRatio', 1);
checkParameterSeries('blitzcrank_r', 'zap_delay_ms', 'ZapCountdown', 1, values => values.map(value => Math.round(value * 1000)));
checkParameterSeries('blitzcrank_r', 'silence_duration_ms', 'SilenceDuration', 1, values => values.map(value => Math.round(value * 1000)));
checkFixedTime('blitzcrank_r', 'cast_time_ms', 'spellCastTime');

const formulaResults = [];
const rejectionResults = [];
for (const skillKey of order) {
  for (const formula of candidate.skills[skillKey].write.formulas) {
    const key = `${skillKey}/${formula.formulaKey}`;
    const cases = formulaCases[key];
    if (!cases || cases.length < 2) throw new Error(`公式缺少两组独立算例 ${key}`);
    const evaluated = cases.map(example => {
      const actual = evalFormula(skillKey, formula.formulaKey, example.context);
      const expected = finite(example.expected(example.context), `${key}/${example.name}/expected`);
      if (!approx(actual, expected)) throw new Error(`数学不一致 ${key}/${example.name}: ${actual} != ${expected}`);
      return { name: example.name, level: example.context.level, expected, actual };
    });
    formulaResults.push({ skillKey, formulaKey: formula.formulaKey, cases: evaluated });
    const missing = firstRemovableLeaf(skillKey, formula);
    const missingContext = { ...cases[0].context, omitParameters: new Set(cases[0].context.omitParameters), omitAttributes: new Set(cases[0].context.omitAttributes) };
    if (missing.type === 'PARAMETER') missingContext.omitParameters.add(`${skillKey}/${missing.key}`);
    else missingContext.omitAttributes.add(missing.key);
    let rejected = false;
    let error = null;
    try { evalFormula(skillKey, formula.formulaKey, missingContext); } catch (caught) { rejected = true; error = String(caught.message ?? caught); }
    if (!rejected) throw new Error(`缺失输入未拒绝 ${key}/${missing.key}`);
    rejectionResults.push({ skillKey, formulaKey: formula.formulaKey, removed: missing, rejected, error });
  }
}

const boundaryResults = [];
function boundary(name, passed, detail) {
  if (!passed) throw new Error(`边界检查失败 ${name}: ${detail}`);
  boundaryResults.push({ name, passed, detail });
}
const r1 = evalFormula('alistar_r', 'damage_reduction_ratio', ctx('alistar_r', 1));
const r3 = evalFormula('alistar_r', 'damage_reduction_ratio', ctx('alistar_r', 3));
boundary('阿利斯塔R减伤55到75百分点', approx(r1, 0.55) && approx(r3, 0.75), `一级=${r1},三级=${r3}`);
const eAttrs = { SOURCE: { ability_power: { TOTAL: 120 }, attack_damage: { TOTAL: 200, BONUS: 80 } } };
const eValue = evalFormula('blitzcrank_e', 'physical_damage', ctx('blitzcrank_e', 5, eAttrs));
boundary('布里茨E使用总攻击力', approx(eValue, 430) && !approx(eValue, 2 * 80 + 0.25 * 120), `总攻击力200/额外攻击力80/法强120时=${eValue}`);
const pZero = evalFormula('blitzcrank_p', 'shield_amount', ctx('blitzcrank_p', 1, {}, { blitzcrank_p: { ability_resource_value: 0 } }));
const pHigh = evalFormula('blitzcrank_p', 'shield_amount', ctx('blitzcrank_p', 1, {}, { blitzcrank_p: { ability_resource_value: 2000 } }));
boundary('布里茨P资源0与2000', approx(pZero, 0) && approx(pHigh, 700), `零=${pZero},高资源=${pHigh}`);
const pMissing = { ...ctx('blitzcrank_p', 1), runtime: { blitzcrank_p: {} } };
let pRejected = false;
try { evalFormula('blitzcrank_p', 'shield_amount', pMissing); } catch { pRejected = true; }
boundary('布里茨P缺资源不默认0', pRejected, '缺少ability_resource_value时拒绝求值');
const rPassiveZero = evalFormula('blitzcrank_r', 'passive_magic_damage', ctx('blitzcrank_r', 1, attrsA, { blitzcrank_r: { passive_ability_resource_value: 0 } }));
const rPassiveHigh = evalFormula('blitzcrank_r', 'passive_magic_damage', ctx('blitzcrank_r', 1, attrsA, { blitzcrank_r: { passive_ability_resource_value: 1000 } }));
boundary('布里茨R被动资源输入变化', approx(rPassiveHigh - rPassiveZero, 20), `资源0=${rPassiveZero},资源1000=${rPassiveHigh}`);
const wParams = candidate.skills.blitzcrank_w.write.parameters;
const wDuration = wParams.find(item => item.parameterKey === 'duration_ms');
const wDecay = wParams.find(item => item.parameterKey === 'decay_duration_ms');
const wMin = wParams.find(item => item.parameterKey === 'move_speed_min_ratio');
boundary('布里茨W衰减终点和时间窗口', wDuration?.fixedValue === 5000 && wDecay?.fixedValue === 2500 && wMin?.fixedValue === 0.1, `持续=${wDuration?.fixedValue},衰减=${wDecay?.fixedValue},最低=${wMin?.fixedValue}`);
const wEffects = candidate.skills.blitzcrank_w.write.effects;
const wMove = candidate.skills.blitzcrank_w.write.parameters.find(item => item.parameterKey === 'move_speed_ratio');
const wAttack = candidate.skills.blitzcrank_w.write.parameters.find(item => item.parameterKey === 'attack_speed_ratio');
boundary('布里茨W只保留衰减端点而不固定移动速度效果', !wEffects.some(effect => effect.effectKey === 'move_speed_boost') && wMove?.levelValues?.['1'] === 0.6 && wMove?.levelValues?.['5'] === 0.8, `移动效果数=${wEffects.filter(effect => effect.effectKey === 'move_speed_boost').length},起始=${wMove?.levelValues?.['1']},末级=${wMove?.levelValues?.['5']}`);
boundary('布里茨W攻击速度五秒与结束减速分离', wEffects.some(effect => effect.effectKey === 'attack_speed_boost' && effect.lifecycle?.durationValue?.parameterKey === 'duration_ms') && wEffects.some(effect => effect.effectKey === 'post_overdrive_slow' && effect.lifecycle?.durationValue?.parameterKey === 'slow_duration_ms'), '攻击速度效果应独立引用5000毫秒主窗口，结束减速应独立引用1500毫秒');
boundary('布里茨W移动和攻击速度取值不混用', JSON.stringify(wMove?.levelValues) === JSON.stringify({ '1': 0.6, '2': 0.65, '3': 0.7, '4': 0.75, '5': 0.8 }) && JSON.stringify(wAttack?.levelValues) === JSON.stringify({ '1': 0.3, '2': 0.4, '3': 0.5, '4': 0.6, '5': 0.7 }), `移动=${JSON.stringify(wMove?.levelValues)},攻击=${JSON.stringify(wAttack?.levelValues)}`);
const eCooldown = candidate.skills.blitzcrank_e.write.parameters.find(item => item.parameterKey === 'cooldown_ms');
boundary('布里茨E客户端和官方冷却等级1至5', JSON.stringify(Object.values(eCooldown?.levelValues ?? {})) === JSON.stringify([7000, 6500, 6000, 5500, 5000]), `候选毫秒=${JSON.stringify(eCooldown?.levelValues)}`);
const pExcludedAlly = candidate.skills.alistar_p.excluded.some(item => /Ally|友方|友军/.test(`${item.item}${item.reason}`));
boundary('阿利斯塔P友方收益排除', pExcludedAlly && !candidate.skills.alistar_p.write.parameters.some(item => /ally|友方/i.test(item.parameterKey)), '友方治疗只在排除证据中保留');
const rExcludedMonster = candidate.skills.blitzcrank_r.excluded.some(item => /野怪/.test(item.item));
boundary('布里茨R野怪护盾规则排除', rExcludedMonster, '野怪护盾特殊规则未进入唯一敌方英雄候选');
const wCast = candidate.skills.alistar_w.write.parameters.find(item => item.parameterKey === 'cast_time_ms');
const eCast = candidate.skills.blitzcrank_e.write.parameters.find(item => item.parameterKey === 'cast_time_ms');
boundary('浮点施法时间整数化', wCast?.fixedValue === 506 && eCast?.fixedValue === 522 && wCast?.valueType === 'INTEGER' && eCast?.valueType === 'INTEGER', `AlistarW=${wCast?.fixedValue},BlitzE=${eCast?.fixedValue}`);

const structural = {
  operationNodes: 0,
  operationArityFailures: [],
  runtimeDefaultsFailures: [],
  integerTypeFailures: [],
  duplicateParameterKeys: [],
  forbiddenResultTypes: [],
  lifecycleReferenceFailures: [],
  forbiddenFuryAttribute: false,
  abilityResourceManaAlias: false,
};
const integerParameter = parameter => parameter.parameterKey.endsWith('_ms') || /(^|_)(stacks|count|次数)$/.test(parameter.parameterKey);
function inspectExpression(node, skillKey, formulaKey) {
  if (node.nodeType === 'OPERATION') {
    structural.operationNodes += 1;
    if (!Array.isArray(node.operands) || node.operands.length !== 2) structural.operationArityFailures.push(`${skillKey}/${formulaKey}`);
    for (const operand of node.operands ?? []) inspectExpression(operand, skillKey, formulaKey);
  }
}
function refs(node, result = []) {
  if (node.nodeType === 'PARAMETER') result.push({ type: 'PARAMETER', key: node.parameterKey });
  else if (node.nodeType === 'ATTRIBUTE') result.push({ type: 'ATTRIBUTE', key: `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}` });
  else if (node.nodeType === 'OPERATION') for (const child of node.operands ?? []) refs(child, result);
  return result;
}
for (const skillKey of order) {
  const skill = candidate.skills[skillKey];
  const seen = new Set();
  for (const parameter of skill.write.parameters) {
    if (seen.has(parameter.parameterKey)) structural.duplicateParameterKeys.push(`${skillKey}/${parameter.parameterKey}`);
    seen.add(parameter.parameterKey);
    if (integerParameter(parameter)) {
      const values = parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : [];
      if (parameter.valueType !== 'INTEGER' || values.some(value => !Number.isInteger(value))) structural.integerTypeFailures.push(`${skillKey}/${parameter.parameterKey}`);
    }
    if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) structural.runtimeDefaultsFailures.push(`${skillKey}/${parameter.parameterKey}`);
  }
  for (const formula of skill.write.formulas) {
    inspectExpression(formula.expression, skillKey, formula.formulaKey);
    for (const ref of refs(formula.expression)) if (ref.type === 'ATTRIBUTE' && ref.key.includes('/fury/')) structural.forbiddenFuryAttribute = true;
  }
  for (const effect of skill.write.effects) {
    for (const result of effect.results ?? []) {
      if (['DAMAGE', 'DIRECT_HEAL', 'MOMENT', 'MOMENT_EVALUATION'].includes(result.resultType)) structural.forbiddenResultTypes.push(`${skillKey}/${effect.effectKey}/${result.resultType}`);
      const value = result.valueRule?.value;
      if (value?.kind === 'FORMULA' && !formulaIndex.has(`${skillKey}/${value.formulaKey}`)) structural.lifecycleReferenceFailures.push(`${skillKey}/${effect.effectKey}/formula`);
      if (value?.kind === 'PARAMETER' && !parameterIndex.has(`${skillKey}/${value.parameterKey}`) && !reuseList.some(item => item.skillKey === skillKey && item.parameterKey === value.parameterKey)) structural.lifecycleReferenceFailures.push(`${skillKey}/${effect.effectKey}/parameter`);
      const duration = effect.lifecycle?.durationValue;
      if (duration?.kind === 'PARAMETER') {
        const parameter = parameterIndex.get(`${skillKey}/${duration.parameterKey}`);
        if (!parameter) structural.lifecycleReferenceFailures.push(`${skillKey}/${effect.effectKey}/duration`);
      }
    }
  }
}
if (structural.forbiddenFuryAttribute) throw new Error('候选错误引入fury属性');
for (const formula of candidate.skills.blitzcrank_r.write.formulas) if (JSON.stringify(formula.expression).includes('"attributeKey":"mana"')) structural.abilityResourceManaAlias = true;
if (structural.operationArityFailures.length || structural.runtimeDefaultsFailures.length || structural.integerTypeFailures.length || structural.duplicateParameterKeys.length || structural.forbiddenResultTypes.length || structural.lifecycleReferenceFailures.length || structural.abilityResourceManaAlias) throw new Error(`结构检查失败 ${JSON.stringify(structural)}`);

const protectedFailures = [];
for (const skillKey of order) {
  const current = snapshot.summary?.[skillKey];
  const protectedExisting = candidate.skills[skillKey].protectedExisting;
  if (JSON.stringify(current?.subject) !== JSON.stringify(protectedExisting?.subject)) protectedFailures.push(`${skillKey}/subject`);
  if (JSON.stringify(current?.components) !== JSON.stringify(protectedExisting?.components)) protectedFailures.push(`${skillKey}/components`);
}
if (protectedFailures.length) throw new Error(`保护快照不一致 ${protectedFailures.join(',')}`);
const forbiddenExistingWrites = candidate.reusedPublicParameters.filter(item => item.post !== false);
if (forbiddenExistingWrites.length) throw new Error('复用公共参数被标成可写');

const report = {
  generatedAt: new Date().toISOString(),
  status: '修订一独立读取16.17原始来源并对候选实际表达式求值通过；未调用业务接口',
  candidateSha256: sha256File(candidateFile),
  sourceIndexSha256: inputVersion.sourceIndexSha256,
  currentSnapshotSha256: sha256File(path.join(referenceDir, '当前10槽保护快照.json')),
  sourceTreeBasis: '本脚本重新读取输入包中的客户端压缩原文和当前绑定，独立使用原始DataValues/字段计算期望，再读取候选表达式求值；布里茨E冷却直接取客户端cooldownTime技能等级索引1至5，并独立读取官方16.17.1 PowerFist冷却数组；不信任候选源值摘要直接代替原始来源。',
  counts: { formulas: formulaResults.length, formulaCases: formulaResults.reduce((sum, item) => sum + item.cases.length, 0), rejectionCases: rejectionResults.length, boundaryCases: boundaryResults.length, sourceSeriesChecks: sourceChecks.length, protectedSkills: order.length, protectedCompositionLists: order.length * 6, reusedPublicParameters: reuseList.length },
  sourceChecks,
  formulaResults,
  rejectionResults,
  boundaryResults,
  structural,
  protectedFailures,
  noApiCalls: true,
  passed: true,
};
fs.writeFileSync(path.join(here, '严格数学.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ candidateSha256: report.candidateSha256, counts: report.counts, structural: report.structural, passed: report.passed, output: path.join(here, '严格数学.json') }, null, 2));

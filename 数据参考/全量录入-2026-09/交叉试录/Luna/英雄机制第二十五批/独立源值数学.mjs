import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidateFile = path.join(here, '完整候选.json');
const sourceValuesFile = path.join(here, '独立源值与算例.json');
const candidate = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
const sourceValues = JSON.parse(fs.readFileSync(sourceValuesFile, 'utf8'));

const sourceSeries = sourceValues.sourceSeries;
const sourceTransformations = sourceValues.sourceTransformations ?? {};
const formulaIndex = new Map();
const parameterIndex = new Map();

for (const skillKey of candidate.order) {
  const skill = candidate.skills[skillKey];
  for (const parameter of skill.write.parameters) parameterIndex.set(`${skillKey}/${parameter.parameterKey}`, parameter);
  for (const formula of skill.write.formulas) formulaIndex.set(`${skillKey}/${formula.formulaKey}`, formula);
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function number(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`不是有限数值: ${label}`);
  return value;
}

function ctx(skillKey, level, attributes = {}, runtime = {}) {
  return { skillKey, level, attributes, runtime, omitParameters: new Set(), omitAttributes: new Set() };
}

function parameterValue(skillKey, parameterKey, context) {
  const omitKey = `${skillKey}/${parameterKey}`;
  if (context.omitParameters.has(omitKey)) throw new Error(`缺少参数输入 ${omitKey}`);
  const parameter = parameterIndex.get(omitKey);
  if (!parameter) throw new Error(`候选中缺少参数 ${omitKey}`);
  if (parameter.valueMode === 'FIXED') return number(parameter.fixedValue, omitKey);
  if (parameter.valueMode === 'SKILL_LEVEL') {
    const key = String(context.level);
    if (!own(parameter.levelValues ?? {}, key)) throw new Error(`缺少等级参数输入 ${omitKey}@${key}`);
    return number(parameter.levelValues[key], `${omitKey}@${key}`);
  }
  if (parameter.valueMode === 'RUNTIME_INPUT') {
    const values = context.runtime?.[skillKey] ?? {};
    if (!own(values, parameterKey)) throw new Error(`缺少运行输入 ${omitKey}`);
    return number(values[parameterKey], omitKey);
  }
  throw new Error(`未知参数取值模式 ${parameter.valueMode}: ${omitKey}`);
}

function attributeValue(node, context) {
  const key = `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`;
  if (context.omitAttributes.has(key)) throw new Error(`缺少属性输入 ${key}`);
  const owner = context.attributes?.[node.attributeOwner] ?? {};
  const attribute = owner[node.attributeKey] ?? {};
  if (!own(attribute, node.attributeValueKind)) throw new Error(`缺少属性输入 ${key}`);
  return number(attribute[node.attributeValueKind], key);
}

function evaluate(node, context, skillKey) {
  if (!node || typeof node !== 'object') throw new Error('公式节点为空');
  if (node.nodeType === 'PARAMETER') return parameterValue(skillKey, node.parameterKey, context);
  if (node.nodeType === 'ATTRIBUTE') return attributeValue(node, context);
  if (node.nodeType !== 'OPERATION') throw new Error(`未知节点类型 ${node.nodeType}`);
  if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`运算节点必须恰好两个输入: ${node.operation}`);
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

function formula(skillKey, formulaKey) {
  const value = formulaIndex.get(`${skillKey}/${formulaKey}`);
  if (!value) throw new Error(`候选中缺少公式 ${skillKey}/${formulaKey}`);
  return value;
}

function evaluateFormula(skillKey, formulaKey, context) {
  return evaluate(formula(skillKey, formulaKey).expression, context, skillKey);
}

function rawSeries(skillKey, name) {
  const values = sourceValues.skills?.[skillKey]?.dataValues?.[name];
  if (!Array.isArray(values)) throw new Error(`独立源值缺少 ${skillKey}/${name}`);
  return values.slice(1);
}

function sourceValue(skillKey, name, level) {
  // 数学期望使用候选已保存的归一化源值；rawSeries 仍在 sourceChecks 中保留原始浮点证据。
  const values = Array.isArray(sourceSeries[`${skillKey}/${name}`]) ? sourceSeries[`${skillKey}/${name}`] : rawSeries(skillKey, name);
  if (level < 1 || level > values.length) throw new Error(`源值等级越界 ${skillKey}/${name}@${level}`);
  return number(values[level - 1], `${skillKey}/${name}@${level}`);
}

function seriesForCandidate(skillKey, name, level) {
  const values = sourceSeries[`${skillKey}/${name}`];
  if (!Array.isArray(values)) throw new Error(`候选源系列缺少 ${skillKey}/${name}`);
  if (level < 1 || level > values.length) throw new Error(`候选源系列等级越界 ${skillKey}/${name}@${level}`);
  return number(values[level - 1], `${skillKey}/${name}@${level}`);
}

const parameterSeriesMap = [
  ['drmundo_p', 'CurrentHealthLoss', 'current_health_loss_ratio'],
  ['drmundo_p', 'MaxHealthGain', 'max_health_gain_ratio'],
  ['drmundo_q', 'SlowAmount', 'slow_ratio'],
  ['drmundo_q', 'CurrentHealthDamage', 'current_health_damage_ratio'],
  ['drmundo_q', 'MinimumDamage', 'minimum_damage'],
  ['drmundo_q', 'HealthCost', 'health_cost'],
  ['drmundo_q', 'HealthRefundOnHitChampionMonsterPercent', 'health_refund_on_champion_monster_ratio'],
  ['drmundo_w', 'CurrentHealthCost', 'current_health_cost_ratio'],
  ['drmundo_w', 'GrayHealthStorage', 'gray_health_storage_ratio'],
  ['drmundo_w', 'GrayHealthInitialDuration', 'gray_health_initial_duration_ms', values => values.map(value => value * 1000), '秒换算为毫秒'],
  ['drmundo_w', 'GrayHealthBigMod', 'gray_health_hero_restore_ratio'],
  ['drmundo_w', 'GrayHealthSmallMod', 'gray_health_nonhero_restore_ratio'],
  ['drmundo_w', 'DamagePerTick', 'damage_per_tick'],
  ['drmundo_w', 'RecastBaseDamage', 'recast_base_damage'],
  ['drmundo_e', 'FlatHealthCost', 'flat_health_cost'],
  ['drmundo_e', 'BaseDamage', 'base_damage'],
  ['drmundo_e', 'BonusHealthRatio', 'bonus_health_ratio'],
  ['drmundo_e', 'MaxMissingHealthThreshold', 'max_missing_health_threshold_ratio'],
  ['drmundo_e', 'MaxDamageAmp', 'max_damage_amp'],
  ['drmundo_e', 'HealthToADRatio', 'health_to_ad_ratio'],
  ['drmundo_r', 'SpeedBoostAmount', 'speed_boost_ratio'],
  ['drmundo_r', 'MissingHealthHeal', 'missing_health_heal_ratio'],
  ['drmundo_r', 'MaxHealthHoT', 'max_health_hot_ratio'],
  ['drmundo_r', 'BonusPerNearbyChampion', 'bonus_per_nearby_champion_ratio'],
  ['tryndamere_q', 'BaseHealing', 'base_healing'],
  ['tryndamere_q', 'BonusHealPerFury', 'bonus_heal_per_fury'],
  ['tryndamere_q', 'APRatio', 'ap_ratio'],
  ['tryndamere_q', 'APRatioPerFury', 'ap_ratio_per_fury'],
  ['tryndamere_q', 'MaximumBonusAD', 'maximum_bonus_attack_damage'],
  ['tryndamere_q', 'RemainingHealthThreshold', 'remaining_health_threshold_ratio'],
  ['tryndamere_w', 'ADReduction', 'attack_damage_reduction'],
  ['tryndamere_w', 'SlowPotency', 'slow_ratio'],
  ['tryndamere_e', 'Damage', 'damage_base'],
  ['tryndamere_e', 'ADRatio', 'ad_ratio'],
  ['tryndamere_e', 'APRatio', 'ap_ratio'],
  ['tryndamere_e', 'ChampCDRefund', 'champion_crit_cooldown_refund_ms', values => values.map(value => value * 1000), '秒换算为毫秒'],
  ['tryndamere_e', 'ChampFuryGain', 'champion_fury_gain'],
  ['tryndamere_r', 'TryndRMinHealth', 'minimum_health'],
  ['tryndamere_r', 'TryndRFuryGain', 'fury_gain'],
];

function approx(actual, expected) {
  return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected));
}

const sourceChecks = [];
for (const [skillKey, sourceName, parameterKey, convert, conversionDescription] of parameterSeriesMap) {
  const series = sourceSeries[`${skillKey}/${sourceName}`];
  const parameter = parameterIndex.get(`${skillKey}/${parameterKey}`);
  if (!Array.isArray(series)) throw new Error(`源系列摘要缺少 ${skillKey}/${sourceName}`);
  if (!parameter) throw new Error(`源系列映射缺少候选参数 ${skillKey}/${parameterKey}`);
  const expectedCandidate = convert ? convert(series.slice()) : series.slice();
  const candidateValues = parameter.valueMode === 'SKILL_LEVEL'
    ? Object.keys(parameter.levelValues).sort((a, b) => Number(a) - Number(b)).map(key => parameter.levelValues[key])
    : parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : [];
  if (candidateValues.length !== expectedCandidate.length || candidateValues.some((value, index) => !approx(value, expectedCandidate[index]))) {
    throw new Error(`源系列与候选参数不一致 ${skillKey}/${sourceName}/${parameterKey}`);
  }
  const raw = rawSeries(skillKey, sourceName);
  const transformation = sourceTransformations[`${skillKey}/${sourceName}`] ?? null;
  sourceChecks.push({ skillKey, sourceName, parameterKey, raw, candidate: expectedCandidate, transformation, conversion: conversionDescription ?? null });
}

const attrsA = {
  SOURCE: {
    hp: { CURRENT: 1250, TOTAL: 3000, BONUS: 1750, MISSING: 1750 },
    ability_power: { TOTAL: 50 },
    attack_damage: { BONUS: 110, TOTAL: 160 },
  },
  TARGET: { hp: { CURRENT: 200, TOTAL: 1000, BONUS: 0, MISSING: 800 } },
};
const attrsB = {
  SOURCE: {
    hp: { CURRENT: 1777, TOTAL: 4200, BONUS: 2423, MISSING: 2423 },
    ability_power: { TOTAL: 275 },
    attack_damage: { BONUS: 325, TOTAL: 405 },
  },
  TARGET: { hp: { CURRENT: 2200, TOTAL: 5000, BONUS: 0, MISSING: 2800 } },
};

const cases = {
  'drmundo_p/health_loss_amount': [
    { name: '当前生命1250', context: ctx('drmundo_p', 1, attrsA), expected: c => sourceValue('drmundo_p', 'CurrentHealthLoss', 1) * c.attributes.SOURCE.hp.CURRENT },
    { name: '当前生命1777', context: ctx('drmundo_p', 1, attrsB), expected: c => sourceValue('drmundo_p', 'CurrentHealthLoss', 1) * c.attributes.SOURCE.hp.CURRENT },
  ],
  'drmundo_p/max_health_gain_amount': [
    { name: '最大生命3000', context: ctx('drmundo_p', 1, attrsA), expected: c => sourceValue('drmundo_p', 'MaxHealthGain', 1) * c.attributes.SOURCE.hp.TOTAL },
    { name: '最大生命4200', context: ctx('drmundo_p', 1, attrsB), expected: c => sourceValue('drmundo_p', 'MaxHealthGain', 1) * c.attributes.SOURCE.hp.TOTAL },
  ],
  'drmundo_p/max_health_regen_amount': [
    { name: '等级外供比例004', context: ctx('drmundo_p', 1, attrsA, { drmundo_p: { max_health_regen_ratio: 0.004 } }), expected: c => 0.004 * c.attributes.SOURCE.hp.TOTAL },
    { name: '等级外供比例005', context: ctx('drmundo_p', 1, attrsB, { drmundo_p: { max_health_regen_ratio: 0.005 } }), expected: c => 0.005 * c.attributes.SOURCE.hp.TOTAL },
  ],
  'drmundo_q/magic_damage': [
    { name: '一级低于最低值', context: ctx('drmundo_q', 1, attrsA), expected: c => Math.max(sourceValue('drmundo_q', 'MinimumDamage', 1), sourceValue('drmundo_q', 'CurrentHealthDamage', 1) * c.attributes.TARGET.hp.CURRENT) },
    { name: '五级高于最低值', context: ctx('drmundo_q', 5, attrsB), expected: c => Math.max(sourceValue('drmundo_q', 'MinimumDamage', 5), sourceValue('drmundo_q', 'CurrentHealthDamage', 5) * c.attributes.TARGET.hp.CURRENT) },
  ],
  'drmundo_q/health_refund_on_champion_monster': [
    { name: '一级生命代价', context: ctx('drmundo_q', 1, attrsA), expected: () => sourceValue('drmundo_q', 'HealthRefundOnHitChampionMonsterPercent', 1) * sourceValue('drmundo_q', 'HealthCost', 1) },
    { name: '五级生命代价', context: ctx('drmundo_q', 5, attrsB), expected: () => sourceValue('drmundo_q', 'HealthRefundOnHitChampionMonsterPercent', 1) * sourceValue('drmundo_q', 'HealthCost', 5) },
  ],
  'drmundo_w/health_cost': [
    { name: '一级当前生命', context: ctx('drmundo_w', 1, attrsA), expected: c => sourceValue('drmundo_w', 'CurrentHealthCost', 1) * c.attributes.SOURCE.hp.CURRENT },
    { name: '五级当前生命', context: ctx('drmundo_w', 5, attrsB), expected: c => sourceValue('drmundo_w', 'CurrentHealthCost', 1) * c.attributes.SOURCE.hp.CURRENT },
  ],
  'drmundo_w/damage_per_second': [
    { name: '一级每秒显示倍率', context: ctx('drmundo_w', 1, attrsA), expected: c => sourceValue('drmundo_w', 'DamagePerTick', 1) * 4 },
    { name: '五级每秒显示倍率', context: ctx('drmundo_w', 5, attrsB), expected: c => sourceValue('drmundo_w', 'DamagePerTick', 5) * 4 },
  ],
  'drmundo_w/initial_gray_health_storage': [
    { name: '首段比例百分之80', context: ctx('drmundo_w', 1, attrsA, { drmundo_w: { gray_health_initial_storage_ratio: 0.8, initial_damage_taken: 100 } }), expected: c => 0.8 * c.runtime.drmundo_w.initial_damage_taken },
    { name: '首段比例百分之95', context: ctx('drmundo_w', 5, attrsB, { drmundo_w: { gray_health_initial_storage_ratio: 0.95, initial_damage_taken: 250 } }), expected: c => 0.95 * c.runtime.drmundo_w.initial_damage_taken },
  ],
  'drmundo_w/subsequent_gray_health_storage': [
    { name: '后续伤害200', context: ctx('drmundo_w', 1, attrsA, { drmundo_w: { subsequent_damage_taken: 200 } }), expected: c => sourceValue('drmundo_w', 'GrayHealthStorage', 1) * c.runtime.drmundo_w.subsequent_damage_taken },
    { name: '后续伤害500', context: ctx('drmundo_w', 5, attrsB, { drmundo_w: { subsequent_damage_taken: 500 } }), expected: c => sourceValue('drmundo_w', 'GrayHealthStorage', 1) * c.runtime.drmundo_w.subsequent_damage_taken },
  ],
  'drmundo_w/hero_gray_health_restore_amount': [
    { name: '英雄命中灰色生命300', context: ctx('drmundo_w', 1, attrsA, { drmundo_w: { stored_gray_health: 300 } }), expected: c => 1 * c.runtime.drmundo_w.stored_gray_health },
    { name: '英雄命中灰色生命640', context: ctx('drmundo_w', 5, attrsB, { drmundo_w: { stored_gray_health: 640 } }), expected: c => 1 * c.runtime.drmundo_w.stored_gray_health },
  ],
  'drmundo_w/nonhero_gray_health_restore_amount': [
    { name: '非英雄命中灰色生命300', context: ctx('drmundo_w', 1, attrsA, { drmundo_w: { stored_gray_health: 300 } }), expected: c => 0.5 * c.runtime.drmundo_w.stored_gray_health },
    { name: '非英雄命中灰色生命640', context: ctx('drmundo_w', 5, attrsB, { drmundo_w: { stored_gray_health: 640 } }), expected: c => 0.5 * c.runtime.drmundo_w.stored_gray_health },
  ],
  'drmundo_w/recast_magic_damage': [
    { name: '一级额外生命1750', context: ctx('drmundo_w', 1, attrsA), expected: c => 20 + 0.07 * c.attributes.SOURCE.hp.BONUS },
    { name: '五级额外生命2423', context: ctx('drmundo_w', 5, attrsB), expected: c => 80 + 0.07 * c.attributes.SOURCE.hp.BONUS },
  ],
  'drmundo_e/additional_physical_damage': [
    { name: '一级额外生命1750', context: ctx('drmundo_e', 1, attrsA), expected: c => 5 + 0.05 * c.attributes.SOURCE.hp.BONUS },
    { name: '五级额外生命2423', context: ctx('drmundo_e', 5, attrsB), expected: c => 45 + 0.05 * c.attributes.SOURCE.hp.BONUS },
  ],
  'drmundo_e/passive_bonus_attack_damage': [
    { name: '一级总生命3000', context: ctx('drmundo_e', 1, attrsA), expected: c => 0.01 * sourceValue('drmundo_e', 'HealthToADRatio', 1) * c.attributes.SOURCE.hp.TOTAL },
    { name: '五级总生命4200', context: ctx('drmundo_e', 5, attrsB), expected: c => 0.01 * sourceValue('drmundo_e', 'HealthToADRatio', 5) * c.attributes.SOURCE.hp.TOTAL },
  ],
  'drmundo_e/maximum_damage_amplification_bonus_ratio': [
    { name: '最高端点百分之40', context: ctx('drmundo_e', 1, attrsA), expected: () => 1.4 - 1 },
    { name: '最高端点固定不随等级变化', context: ctx('drmundo_e', 5, attrsB), expected: () => 1.4 - 1 },
  ],
  'drmundo_r/nearby_champion_heal_multiplier': [
    { name: '零附近敌人', context: ctx('drmundo_r', 1, attrsA, { drmundo_r: { nearby_enemy_champion_count: 0 } }), expected: () => 1 + 0.05 * 0 },
    { name: '三级一个附近敌人', context: ctx('drmundo_r', 3, attrsB, { drmundo_r: { nearby_enemy_champion_count: 1 } }), expected: () => 1 + 0.05 * 1 },
  ],
  'drmundo_r/missing_health_heal_amount': [
    { name: '一级施放前缺失生命', context: ctx('drmundo_r', 1, attrsA, { drmundo_r: { nearby_enemy_champion_count: 0 } }), expected: c => sourceValue('drmundo_r', 'MissingHealthHeal', 1) * c.attributes.SOURCE.hp.MISSING * (1 + 0.05 * c.runtime.drmundo_r.nearby_enemy_champion_count) },
    { name: '三级附近敌人增幅', context: ctx('drmundo_r', 3, attrsB, { drmundo_r: { nearby_enemy_champion_count: 1 } }), expected: c => sourceValue('drmundo_r', 'MissingHealthHeal', 3) * c.attributes.SOURCE.hp.MISSING * (1 + 0.05 * c.runtime.drmundo_r.nearby_enemy_champion_count) },
  ],
  'drmundo_r/max_health_hot_total_amount': [
    { name: '一级施放前最大生命', context: ctx('drmundo_r', 1, attrsA, { drmundo_r: { nearby_enemy_champion_count: 0 } }), expected: c => sourceValue('drmundo_r', 'MaxHealthHoT', 1) * c.attributes.SOURCE.hp.TOTAL * (1 + 0.05 * c.runtime.drmundo_r.nearby_enemy_champion_count) },
    { name: '三级附近敌人增幅', context: ctx('drmundo_r', 3, attrsB, { drmundo_r: { nearby_enemy_champion_count: 1 } }), expected: c => sourceValue('drmundo_r', 'MaxHealthHoT', 3) * c.attributes.SOURCE.hp.TOTAL * (1 + 0.05 * c.runtime.drmundo_r.nearby_enemy_champion_count) },
  ],
  'tryndamere_p/crit_chance_from_fury': [
    { name: '零怒气', context: ctx('tryndamere_p', 1, attrsA, { tryndamere_p: { current_fury: 0 } }), expected: c => 0.005 * c.runtime.tryndamere_p.current_fury },
    { name: '八十怒气非满值', context: ctx('tryndamere_p', 1, attrsB, { tryndamere_p: { current_fury: 80 } }), expected: c => 0.005 * c.runtime.tryndamere_p.current_fury },
  ],
  'tryndamere_q/base_heal': [
    { name: '一级法强50', context: ctx('tryndamere_q', 1, attrsA, { tryndamere_q: { actual_fury_consumed: 0 } }), expected: c => sourceValue('tryndamere_q', 'BaseHealing', 1) + 0.3 * c.attributes.SOURCE.ability_power.TOTAL },
    { name: '五级法强275', context: ctx('tryndamere_q', 5, attrsB, { tryndamere_q: { actual_fury_consumed: 35 } }), expected: c => sourceValue('tryndamere_q', 'BaseHealing', 5) + 0.3 * c.attributes.SOURCE.ability_power.TOTAL },
  ],
  'tryndamere_q/heal_per_fury': [
    { name: '一级法强50', context: ctx('tryndamere_q', 1, attrsA, { tryndamere_q: { actual_fury_consumed: 0 } }), expected: c => sourceValue('tryndamere_q', 'BonusHealPerFury', 1) + 0.012 * c.attributes.SOURCE.ability_power.TOTAL },
    { name: '五级法强275', context: ctx('tryndamere_q', 5, attrsB, { tryndamere_q: { actual_fury_consumed: 35 } }), expected: c => sourceValue('tryndamere_q', 'BonusHealPerFury', 5) + 0.012 * c.attributes.SOURCE.ability_power.TOTAL },
  ],
  'tryndamere_q/active_heal_amount': [
    { name: '零实际怒气', context: ctx('tryndamere_q', 1, attrsA, { tryndamere_q: { actual_fury_consumed: 0 } }), expected: c => (sourceValue('tryndamere_q', 'BaseHealing', 1) + 0.3 * c.attributes.SOURCE.ability_power.TOTAL) + (sourceValue('tryndamere_q', 'BonusHealPerFury', 1) + 0.012 * c.attributes.SOURCE.ability_power.TOTAL) * c.runtime.tryndamere_q.actual_fury_consumed },
    { name: '三十五实际怒气', context: ctx('tryndamere_q', 5, attrsB, { tryndamere_q: { actual_fury_consumed: 35 } }), expected: c => (sourceValue('tryndamere_q', 'BaseHealing', 5) + 0.3 * c.attributes.SOURCE.ability_power.TOTAL) + (sourceValue('tryndamere_q', 'BonusHealPerFury', 5) + 0.012 * c.attributes.SOURCE.ability_power.TOTAL) * c.runtime.tryndamere_q.actual_fury_consumed },
  ],
  'tryndamere_e/physical_damage': [
    { name: '一级额外攻击力110法强50', context: ctx('tryndamere_e', 1, attrsA), expected: c => sourceValue('tryndamere_e', 'Damage', 1) + sourceValue('tryndamere_e', 'ADRatio', 1) * c.attributes.SOURCE.attack_damage.BONUS + sourceValue('tryndamere_e', 'APRatio', 1) * c.attributes.SOURCE.ability_power.TOTAL },
    { name: '五级额外攻击力325法强275', context: ctx('tryndamere_e', 5, attrsB), expected: c => sourceValue('tryndamere_e', 'Damage', 5) + sourceValue('tryndamere_e', 'ADRatio', 1) * c.attributes.SOURCE.attack_damage.BONUS + sourceValue('tryndamere_e', 'APRatio', 1) * c.attributes.SOURCE.ability_power.TOTAL },
  ],
};

function leafNodes(node, result = []) {
  if (node.nodeType === 'PARAMETER') result.push({ type: 'PARAMETER', key: node.parameterKey });
  else if (node.nodeType === 'ATTRIBUTE') result.push({ type: 'ATTRIBUTE', key: `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`, node });
  else if (node.nodeType === 'OPERATION') {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error('发现不是二元运算节点');
    for (const child of node.operands) leafNodes(child, result);
  } else throw new Error(`未知表达式节点 ${node.nodeType}`);
  return result;
}

const formulaResults = [];
const rejectionResults = [];
for (const skillKey of candidate.order) {
  for (const item of candidate.skills[skillKey].write.formulas) {
    const key = `${skillKey}/${item.formulaKey}`;
    const formulaCases = cases[key];
    if (!formulaCases || formulaCases.length < 2) throw new Error(`公式缺少两组独立算例 ${key}`);
    const evaluated = formulaCases.map(example => {
      const actual = evaluateFormula(skillKey, item.formulaKey, example.context);
      const expected = number(example.expected(example.context), `${key}/${example.name}/expected`);
      if (!approx(actual, expected)) throw new Error(`数学不一致 ${key}/${example.name}: actual=${actual} expected=${expected}`);
      return { name: example.name, expected, actual, level: example.context.level };
    });
    formulaResults.push({ skillKey, formulaKey: item.formulaKey, cases: evaluated });

    const leaves = leafNodes(item.expression);
    if (leaves.length === 0) throw new Error(`公式没有输入 ${key}`);
    const missing = leaves[0];
    const missingContext = { ...formulaCases[0].context, omitParameters: new Set(formulaCases[0].context.omitParameters), omitAttributes: new Set(formulaCases[0].context.omitAttributes) };
    if (missing.type === 'PARAMETER') missingContext.omitParameters.add(`${skillKey}/${missing.key}`);
    else missingContext.omitAttributes.add(missing.key);
    let rejected = false;
    let error = null;
    try {
      evaluateFormula(skillKey, item.formulaKey, missingContext);
    } catch (caught) {
      rejected = true;
      error = String(caught.message ?? caught);
    }
    if (!rejected) throw new Error(`缺值未拒绝 ${key}/${missing.key}`);
    rejectionResults.push({ skillKey, formulaKey: item.formulaKey, removed: missing, rejected, error });
  }
}

const boundaryResults = [];
function boundary(name, passed, detail) {
  if (!passed) throw new Error(`边界检查失败 ${name}: ${detail}`);
  boundaryResults.push({ name, passed, detail });
}

const qMinimum = evaluateFormula('drmundo_q', 'magic_damage', ctx('drmundo_q', 1, { TARGET: { hp: { CURRENT: 0 } } }));
boundary('drmundo_q/最低伤害零生命', qMinimum === 80, `当前生命0时结果=${qMinimum}`);
const qExact = evaluateFormula('drmundo_q', 'magic_damage', ctx('drmundo_q', 1, { TARGET: { hp: { CURRENT: 400 } } }));
boundary('drmundo_q/最低伤害恰好边界', qExact === 80, `当前生命400时结果=${qExact}`);
const qHigh = evaluateFormula('drmundo_q', 'magic_damage', ctx('drmundo_q', 1, { TARGET: { hp: { CURRENT: 1000 } } }));
boundary('drmundo_q/生命比例超过最低值', qHigh === 200, `当前生命1000时结果=${qHigh}`);

const wInitialDuration = parameterIndex.get('drmundo_w/gray_health_initial_duration_ms');
boundary('drmundo_w/首段750毫秒', wInitialDuration?.fixedValue === 750 && wInitialDuration.valueType === 'INTEGER', `参数=${wInitialDuration?.fixedValue}/${wInitialDuration?.valueType}`);
const wInitial = evaluateFormula('drmundo_w', 'initial_gray_health_storage', ctx('drmundo_w', 1, {}, { drmundo_w: { gray_health_initial_storage_ratio: 0.8, initial_damage_taken: 100 } }));
const wSubsequent = evaluateFormula('drmundo_w', 'subsequent_gray_health_storage', ctx('drmundo_w', 1, {}, { drmundo_w: { subsequent_damage_taken: 100 } }));
boundary('drmundo_w/首段与后续分开', wInitial === 80 && wSubsequent === 25, `首段=${wInitial},后续=${wSubsequent}`);

const eAmp = evaluateFormula('drmundo_e', 'maximum_damage_amplification_bonus_ratio', ctx('drmundo_e', 1));
boundary('drmundo_e/最高增幅端点', approx(eAmp, 0.4), `端点增幅=${eAmp}`);
const eThreshold = parameterIndex.get('drmundo_e/max_missing_health_threshold_ratio');
boundary('drmundo_e/已损失生命阈值保留', eThreshold?.fixedValue === 0.7, `阈值=${eThreshold?.fixedValue}`);

const rZero = evaluateFormula('drmundo_r', 'nearby_champion_heal_multiplier', ctx('drmundo_r', 3, {}, { drmundo_r: { nearby_enemy_champion_count: 0 } }));
const rOne = evaluateFormula('drmundo_r', 'nearby_champion_heal_multiplier', ctx('drmundo_r', 3, {}, { drmundo_r: { nearby_enemy_champion_count: 1 } }));
boundary('drmundo_r/附近英雄0到1', approx(rZero, 1) && approx(rOne, 1.05), `零=${rZero},一=${rOne}`);
const rPreCast = evaluateFormula('drmundo_r', 'missing_health_heal_amount', ctx('drmundo_r', 3, { SOURCE: { hp: { MISSING: 1000, TOTAL: 3000 } } }, { drmundo_r: { nearby_enemy_champion_count: 0 } }));
boundary('drmundo_r/施放前生命基数', rPreCast === 250, `缺失生命1000时结果=${rPreCast}`);

const pZero = evaluateFormula('tryndamere_p', 'crit_chance_from_fury', ctx('tryndamere_p', 1, {}, { tryndamere_p: { current_fury: 0 } }));
const pNonFull = evaluateFormula('tryndamere_p', 'crit_chance_from_fury', ctx('tryndamere_p', 1, {}, { tryndamere_p: { current_fury: 80 } }));
boundary('tryndamere_p/怒气0与非满值80', approx(pZero, 0) && approx(pNonFull, 0.4), `零=${pZero},八十=${pNonFull}`);
const qFuryZero = evaluateFormula('tryndamere_q', 'active_heal_amount', ctx('tryndamere_q', 1, { SOURCE: { ability_power: { TOTAL: 0 } } }, { tryndamere_q: { actual_fury_consumed: 0 } }));
const qFuryThirtyFive = evaluateFormula('tryndamere_q', 'active_heal_amount', ctx('tryndamere_q', 5, { SOURCE: { ability_power: { TOTAL: 100 } } }, { tryndamere_q: { actual_fury_consumed: 35 } }));
boundary('tryndamere_q/实际怒气0与35', approx(qFuryZero, 30) && approx(qFuryThirtyFive, 70 + 30 + (2.3 + 1.2) * 35), `零=${qFuryZero},三十五=${qFuryThirtyFive}`);

const wAdParameter = parameterIndex.get('tryndamere_w/attack_damage_reduction');
const wSlowParameter = parameterIndex.get('tryndamere_w/slow_ratio');
const wEffects = candidate.skills.tryndamere_w.write.effects;
boundary('tryndamere_w/负值转正并降低', wAdParameter?.levelValues?.['1'] === 20 && wSlowParameter?.levelValues?.['1'] === 0.3 && wEffects.every(effect => effect.results[0].detail.operation === 'DECREASE'), `AD=${wAdParameter?.levelValues?.['1']},slow=${wSlowParameter?.levelValues?.['1']}`);

const noFuryAttribute = candidate.skills.tryndamere_p.write.formulas.every(item => !JSON.stringify(item.expression).includes('mana')) && !JSON.stringify(candidate).includes('attributeKey":"fury"');
boundary('怒气不伪装为法力属性', noFuryAttribute, '公式仅使用current_fury运行输入，候选没有fury属性或mana映射');

const forbiddenResults = [];
const lifecycleKinds = new Set(['PARAMETER', 'FIXED']);
const integerKeys = parameter => parameter.parameterKey.endsWith('_ms') || new Set([
  'current_fury', 'actual_fury_consumed', 'nearby_enemy_champion_count', 'ticks_per_second', 'minimum_health',
  'attack_fury_gain', 'critical_attack_fury_gain', 'kill_unit_fury_gain', 'fury_decay_per_second',
  'champion_fury_gain', 'fury_gain',
]).has(parameter.parameterKey);
const structural = {
  operationNodes: 0,
  operationArityFailures: [],
  runtimeDefaultsFailures: [],
  integerTypeFailures: [],
  duplicateParameterKeys: [],
  forbiddenResultTypes: [],
  effectLifecycleFailures: [],
};

function inspectExpression(node, skillKey, formulaKey) {
  if (node.nodeType === 'OPERATION') {
    structural.operationNodes += 1;
    if (!Array.isArray(node.operands) || node.operands.length !== 2) structural.operationArityFailures.push(`${skillKey}/${formulaKey}`);
    for (const operand of node.operands ?? []) inspectExpression(operand, skillKey, formulaKey);
  }
}

for (const skillKey of candidate.order) {
  const skill = candidate.skills[skillKey];
  const seen = new Set();
  for (const parameter of skill.write.parameters) {
    if (seen.has(parameter.parameterKey)) structural.duplicateParameterKeys.push(`${skillKey}/${parameter.parameterKey}`);
    seen.add(parameter.parameterKey);
    if (integerKeys(parameter) && parameter.valueType !== 'INTEGER') structural.integerTypeFailures.push(`${skillKey}/${parameter.parameterKey}`);
    if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) structural.runtimeDefaultsFailures.push(`${skillKey}/${parameter.parameterKey}`);
  }
  for (const item of skill.write.formulas) inspectExpression(item.expression, skillKey, item.formulaKey);
  for (const effect of skill.write.effects) {
    for (const result of effect.results ?? []) {
      if (['DAMAGE', 'DIRECT_HEAL', 'MOMENT'].includes(result.resultType)) structural.forbiddenResultTypes.push(`${skillKey}/${effect.effectKey}/${result.resultType}`);
      if (result.resultType === 'ATTRIBUTE_CHANGE' && effect.lifecycle?.durationValue?.kind && !lifecycleKinds.has(effect.lifecycle.durationValue.kind)) structural.effectLifecycleFailures.push(`${skillKey}/${effect.effectKey}`);
    }
  }
}
if (structural.operationArityFailures.length || structural.runtimeDefaultsFailures.length || structural.integerTypeFailures.length || structural.duplicateParameterKeys.length || structural.forbiddenResultTypes.length || structural.effectLifecycleFailures.length) {
  throw new Error(`结构检查失败 ${JSON.stringify(structural)}`);
}

const formulaCount = candidate.order.reduce((total, skillKey) => total + candidate.skills[skillKey].write.formulas.length, 0);
if (formulaCount !== 23 || formulaResults.length !== 23 || rejectionResults.length !== 23) throw new Error(`公式统计异常 ${formulaCount}/${formulaResults.length}/${rejectionResults.length}`);

const report = {
  generatedAt: new Date().toISOString(),
  status: '独立实际候选表达式求值通过；未调用业务接口',
  candidateSha256: sha256File(candidateFile),
  sourceValuesSha256: sha256File(sourceValuesFile),
  sourceTreeBasis: '读取完整候选的实际表达式与独立源值摘要；期望值按当前16.17根绑定正文/计算树记录的DataValues、字面值和已证属性口径单独计算。',
  counts: { formulas: formulaCount, formulaCases: formulaResults.length * 2, rejectionCases: rejectionResults.length, boundaryCases: boundaryResults.length, sourceSeriesChecks: sourceChecks.length },
  sourceChecks,
  formulaResults,
  rejectionResults,
  boundaryResults,
  structural,
  noApiCalls: true,
  passed: true,
};
fs.writeFileSync(path.join(here, '严格数学.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ candidateSha256: report.candidateSha256, sourceValuesSha256: report.sourceValuesSha256, counts: report.counts, structural: report.structural, passed: report.passed, output: path.join(here, '严格数学.json') }, null, 2));

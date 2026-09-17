// 读取写后独立全量快照中的真实公式表达式，逐条做两组输入核对和缺少外部输入拒绝。
// 本脚本只读本地证据文件，不访问接口，不执行任何业务写入。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const snapshotPath = path.join(here, '修订一独立回读', '2026-09-09T12-36-35-368Z', '独立全量回读.json');
const sourcePath = path.join(here, '根绑定与数值证据.json');
const textPath = path.join(here, '补充文本证据.json');
const outputPath = path.join(here, '实际全公式数值核对.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readBytes = file => fs.readFileSync(file);
const readJson = file => JSON.parse(readBytes(file));
const snapshotBytes = readBytes(snapshotPath);
const sourceBytes = readBytes(sourcePath);
const textBytes = readBytes(textPath);
const snapshot = JSON.parse(snapshotBytes);
const source = JSON.parse(sourceBytes);
const textEvidence = JSON.parse(textBytes);

const skills = ['riven', 'aatrox', 'rengar', 'khazix'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const actualFormulaMap = new Map();
const parameterMap = new Map();
for (const skillKey of skills) {
  const subject = snapshot.subjects?.[skillKey];
  if (!subject) throw Error(`独立快照缺少技能主体 ${skillKey}`);
  for (const item of subject.components?.parameters?.items ?? []) parameterMap.set(`${skillKey}/${item.parameterKey}`, item);
  for (const entry of subject.components?.formulas?.details ?? []) {
    const formula = entry.detail?.data;
    if (formula?.formulaKey) actualFormulaMap.set(`${skillKey}/${formula.formulaKey}`, formula);
  }
}

function sourceSkill(skillKey) {
  for (const hero of source.heroes ?? []) {
    const spell = hero.spells?.find(item => item.skillKey === skillKey);
    if (spell) return spell;
  }
  throw Error(`冻结根绑定缺少技能 ${skillKey}`);
}

function sourceData(skillKey, dataValue) {
  const spell = sourceSkill(skillKey);
  const found = (spell.object?.mSpell?.DataValues ?? []).find(item => item.name === dataValue);
  if (!found || !Array.isArray(found.values)) throw Error(`冻结根绑定缺少数据值 ${skillKey}/${dataValue}`);
  return found.values;
}

function sourceRank(skillKey, dataValue, level) {
  const values = sourceData(skillKey, dataValue);
  const value = values[level];
  if (!Number.isFinite(Number(value))) throw Error(`冻结根绑定缺少等级值 ${skillKey}/${dataValue}/${level}`);
  return Number(value);
}

function sourceEffect(skillKey, index, level) {
  const values = sourceSkill(skillKey).object?.mSpell?.mEffectAmount?.[index - 1]?.value;
  if (!Array.isArray(values) || !Number.isFinite(Number(values[level]))) throw Error(`冻结根绑定缺少效果值 ${skillKey}/mEffectAmount[${index}]/${level}`);
  return Number(values[level]);
}

function sourceCalculation(skillKey, key) {
  const calculation = sourceSkill(skillKey).object?.mSpell?.mSpellCalculations?.[key];
  if (!calculation) throw Error(`冻结根绑定缺少计算树 ${skillKey}/${key}`);
  return calculation;
}

function sourcePart(skillKey, calculationKey, predicate, label) {
  const parts = sourceCalculation(skillKey, calculationKey).mFormulaParts ?? [];
  const part = parts.find(predicate);
  if (!part) throw Error(`冻结根绑定缺少计算树分支 ${skillKey}/${calculationKey}/${label}`);
  return part;
}

function sourceText(skillKey) {
  const skill = textEvidence.skills?.[skillKey];
  if (!skill) throw Error(`中文绑定证据缺少技能 ${skillKey}`);
  return Object.values(skill.keys ?? {}).map(item => item.text).filter(Boolean).join('\n');
}

function actualFormula(skillKey, formulaKey) {
  const formula = actualFormulaMap.get(`${skillKey}/${formulaKey}`);
  if (!formula?.expression) throw Error(`写后独立快照缺少真实表达式 ${skillKey}/${formulaKey}`);
  return formula;
}

function actualParameter(skillKey, parameterKey) {
  const item = parameterMap.get(`${skillKey}/${parameterKey}`);
  if (!item) throw Error(`写后独立快照缺少真实参数 ${skillKey}/${parameterKey}`);
  return item;
}

function externalLeaves(expression, result = []) {
  if (!expression || typeof expression !== 'object') return result;
  if (expression.nodeType === 'PARAMETER') {
    const parameter = actualParameter(currentSkill, expression.parameterKey);
    if (parameter.valueMode === 'RUNTIME_INPUT') result.push({ type: 'PARAMETER', key: expression.parameterKey });
  }
  if (expression.nodeType === 'ATTRIBUTE') result.push({ type: 'ATTRIBUTE', key: `${expression.attributeOwner}:${expression.attributeKey}:${expression.attributeValueKind}` });
  for (const child of expression.operands ?? []) externalLeaves(child, result);
  return result;
}

function parameterValue(skillKey, parameterKey, context) {
  const parameter = actualParameter(skillKey, parameterKey);
  if (parameter.valueMode === 'FIXED') {
    if (!Number.isFinite(Number(parameter.fixedValue))) throw Error(`固定参数没有数值 ${skillKey}/${parameterKey}`);
    return Number(parameter.fixedValue);
  }
  if (parameter.valueMode === 'SKILL_LEVEL') {
    const level = String(context.level ?? 1);
    if (!parameter.levelValues || !Object.prototype.hasOwnProperty.call(parameter.levelValues, level)) throw Error(`等级参数缺少等级 ${skillKey}/${parameterKey}/${level}`);
    if (!Number.isFinite(Number(parameter.levelValues[level]))) throw Error(`等级参数不是数值 ${skillKey}/${parameterKey}/${level}`);
    return Number(parameter.levelValues[level]);
  }
  if (parameter.valueMode === 'RUNTIME_INPUT') {
    if (!Object.prototype.hasOwnProperty.call(context.parameters ?? {}, parameterKey)) throw Object.assign(new Error(`缺少运行输入 ${skillKey}/${parameterKey}`), { code: 'MISSING_RUNTIME_INPUT' });
    if (!Number.isFinite(Number(context.parameters[parameterKey]))) throw Error(`运行输入不是数值 ${skillKey}/${parameterKey}`);
    return Number(context.parameters[parameterKey]);
  }
  throw Error(`参数模式未知 ${skillKey}/${parameterKey}/${parameter.valueMode}`);
}

function attributeValue(node, context) {
  const key = `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`;
  if (!Object.prototype.hasOwnProperty.call(context.attributes ?? {}, key)) throw Object.assign(new Error(`缺少属性输入 ${key}`), { code: 'MISSING_ATTRIBUTE_INPUT' });
  if (!Number.isFinite(Number(context.attributes[key]))) throw Error(`属性输入不是数值 ${key}`);
  return Number(context.attributes[key]);
}

function evaluate(skillKey, expression, context) {
  if (expression?.nodeType === 'PARAMETER') return parameterValue(skillKey, expression.parameterKey, context);
  if (expression?.nodeType === 'ATTRIBUTE') return attributeValue(expression, context);
  if (expression?.nodeType !== 'OPERATION' || !Array.isArray(expression.operands) || expression.operands.length !== 2) throw Error(`真实表达式不是受支持二元树 ${skillKey}`);
  const [left, right] = expression.operands.map(child => evaluate(skillKey, child, context));
  switch (expression.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw Error(`真实表达式运算不受支持 ${skillKey}/${expression.operation}`);
  }
}

function cloneContext(context) {
  return { level: context.level, parameters: { ...(context.parameters ?? {}) }, attributes: { ...(context.attributes ?? {}) } };
}

function numericClose(actual, expected) {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < 1e-4;
}

function assert(condition, message) {
  if (!condition) throw Error(message);
}

function context(level, parameters = {}, attributes = {}) {
  return { level, parameters, attributes };
}

const specs = [
  {
    skillKey: 'riven_p', formulaKey: 'passive_damage',
    a: context(1, { passive_damage_ratio: 0.3 }, { 'SOURCE:attack_damage:TOTAL': 200 }),
    b: context(1, { passive_damage_ratio: 0.45 }, { 'SOURCE:attack_damage:TOTAL': 250 }),
    expected: c => c.parameters.passive_damage_ratio * c.attributes['SOURCE:attack_damage:TOTAL'],
    sourceProof: () => { const part = sourcePart('riven_p', 'TotalDamage', item => item.mStat === 2 && item.mSubpart?.__type === 'ByCharLevelInterpolationCalculationPart', '等级伤害比例'); return { stat: part.mStat, start: part.mSubpart.mStartValue, end: part.mSubpart.mEndValue, sourceTextLength: sourceText('riven_p').length }; }
  },
  {
    skillKey: 'riven_q', formulaKey: 'first_slash_damage',
    a: context(3, {}, { 'SOURCE:attack_damage:TOTAL': 200 }), b: context(3, {}, { 'SOURCE:attack_damage:TOTAL': 250 }),
    expected: c => sourceRank('riven_q', 'BaseDamage', c.level) + sourceRank('riven_q', 'ADRatio', c.level) * c.attributes['SOURCE:attack_damage:TOTAL'],
    sourceProof: () => { const calc = sourceCalculation('riven_q', 'FirstSlashDamage'); const base = sourcePart('riven_q', 'FirstSlashDamage', item => item.mDataValue === 'BaseDamage', '基础伤害'); const ratio = sourcePart('riven_q', 'FirstSlashDamage', item => item.mStat === 2 && item.mStatFormula === 2 && item.mDataValue === 'ADRatio', '总攻击力系数'); return { calculationType: calc.__type, baseDataValue: base.mDataValue, ratioDataValue: ratio.mDataValue, stat: ratio.mStat, statFormula: ratio.mStatFormula }; }
  },
  {
    skillKey: 'riven_w', formulaKey: 'total_damage',
    a: context(5, {}, { 'SOURCE:attack_damage:BONUS': 100 }), b: context(5, {}, { 'SOURCE:attack_damage:BONUS': 200 }),
    expected: c => sourceRank('riven_w', 'BaseDamage', c.level) + c.attributes['SOURCE:attack_damage:BONUS'],
    sourceProof: () => { const part = sourcePart('riven_w', 'TotalDamage', item => item.mStat === 2 && item.mStatFormula === 2 && item.mCoefficient === 1, '额外攻击力'); return { stat: part.mStat, statFormula: part.mStatFormula, coefficient: part.mCoefficient, baseDataValue: 'BaseDamage' }; }
  },
  {
    skillKey: 'riven_e', formulaKey: 'total_shield',
    a: context(5, {}, { 'SOURCE:attack_damage:BONUS': 100 }), b: context(5, {}, { 'SOURCE:attack_damage:BONUS': 200 }),
    expected: c => sourceRank('riven_e', 'ShieldAmount', c.level) + 1.1 * c.attributes['SOURCE:attack_damage:BONUS'],
    sourceProof: () => { const part = sourcePart('riven_e', 'TotalShield', item => item.mStat === 2 && item.mStatFormula === 2, '额外攻击力'); return { stat: part.mStat, statFormula: part.mStatFormula, coefficient: part.mCoefficient, baseDataValue: 'ShieldAmount' }; }
  },
  {
    skillKey: 'riven_r', formulaKey: 'bonus_attack_damage',
    a: context(3, {}, { 'SOURCE:attack_damage:TOTAL': 200 }), b: context(3, {}, { 'SOURCE:attack_damage:TOTAL': 250 }),
    expected: c => sourceRank('riven_r', 'PercentBonusAD', c.level) * c.attributes['SOURCE:attack_damage:TOTAL'],
    sourceProof: () => { const part = sourcePart('riven_r', 'BonusAD', item => item.mStat === 2 && item.mDataValue === 'PercentBonusAD', '总攻击力增益'); return { stat: part.mStat, dataValue: part.mDataValue, sourceRank3: sourceRank('riven_r', 'PercentBonusAD', 3) }; }
  },
  {
    skillKey: 'riven_r', formulaKey: 'wind_slash_min_damage',
    a: context(3, {}, { 'SOURCE:attack_damage:BONUS': 100 }), b: context(3, {}, { 'SOURCE:attack_damage:BONUS': 200 }),
    expected: c => sourceRank('riven_r', 'MinBase', c.level) + 0.55 * c.attributes['SOURCE:attack_damage:BONUS'],
    sourceProof: () => { const part = sourcePart('riven_r', 'MinDamage', item => item.mStat === 2 && item.mStatFormula === 2, '额外攻击力'); return { stat: part.mStat, statFormula: part.mStatFormula, coefficient: part.mCoefficient, baseDataValue: 'MinBase' }; }
  },
  {
    skillKey: 'riven_r', formulaKey: 'wind_slash_max_damage',
    a: context(3, {}, { 'SOURCE:attack_damage:BONUS': 100 }), b: context(3, {}, { 'SOURCE:attack_damage:BONUS': 200 }),
    expected: c => sourceRank('riven_r', 'MaxBase', c.level) + 1.65 * c.attributes['SOURCE:attack_damage:BONUS'],
    sourceProof: () => { const part = sourcePart('riven_r', 'MaxDamage', item => item.mStat === 2 && item.mStatFormula === 2, '额外攻击力'); return { stat: part.mStat, statFormula: part.mStatFormula, coefficient: part.mCoefficient, baseDataValue: 'MaxBase' }; }
  },
  {
    skillKey: 'aatrox_p', formulaKey: 'passive_damage',
    a: context(1, { target_max_health: 1000, passive_damage_max_health_ratio: 0.04 }), b: context(1, { target_max_health: 2000, passive_damage_max_health_ratio: 0.1 }),
    expected: c => c.parameters.target_max_health * c.parameters.passive_damage_max_health_ratio,
    sourceProof: () => { const calc = sourceCalculation('aatrox_p', 'PDamage'); const part = calc.mFormulaParts?.[0]; assert(part?.__type === 'ByCharLevelInterpolationCalculationPart', 'Aatrox P来源不是角色等级插值树'); return { start: part.mStartValue, end: part.mEndValue, displayAsPercent: calc.mDisplayAsPercent === true }; }
  },
  {
    skillKey: 'aatrox_p', formulaKey: 'passive_healing',
    a: context(1, { passive_actual_damage: 100 }), b: context(1, { passive_actual_damage: 200 }),
    expected: c => c.parameters.passive_actual_damage * sourceRank('aatrox_p', 'PHealingRatio', 1),
    sourceProof: () => { const ratio = sourceRank('aatrox_p', 'PHealingRatio', 1); assert(ratio === 1, 'Aatrox P回复比例原值不是1'); return { dataValue: 'PHealingRatio', rawRatio: ratio, healingInput: '实际命中伤害运行输入' }; }
  },
  {
    skillKey: 'aatrox_q', formulaKey: 'q_damage',
    a: context(5, {}, { 'SOURCE:attack_damage:TOTAL': 200 }), b: context(5, {}, { 'SOURCE:attack_damage:TOTAL': 250 }),
    expected: c => sourceRank('aatrox_q', 'QBaseDamage', c.level) + sourceRank('aatrox_q', 'QTotalADRatio', c.level) * c.attributes['SOURCE:attack_damage:TOTAL'],
    sourceProof: () => { const part = sourcePart('aatrox_q', 'QDamage', item => item.mStat === 2 && item.mDataValue === 'QTotalADRatio', '总攻击力'); return { stat: part.mStat, dataValue: part.mDataValue, baseDataValue: 'QBaseDamage' }; }
  },
  {
    skillKey: 'aatrox_q', formulaKey: 'q_edge_damage',
    a: context(5, {}, { 'SOURCE:attack_damage:TOTAL': 200 }), b: context(5, {}, { 'SOURCE:attack_damage:TOTAL': 250 }),
    expected: c => (1 + sourceRank('aatrox_q', 'QSweetSpotBonus', c.level)) * (sourceRank('aatrox_q', 'QBaseDamage', c.level) + sourceRank('aatrox_q', 'QTotalADRatio', c.level) * c.attributes['SOURCE:attack_damage:TOTAL']),
    sourceProof: () => { const calc = sourceCalculation('aatrox_q', 'QEdgeDamage'); const parts = calc.mMultiplier?.mSubparts ?? []; assert(parts.some(item => item.mNumber === 1) && parts.some(item => item.mDataValue === 'QSweetSpotBonus'), 'Aatrox Q边缘倍率缺少1和QSweetSpotBonus'); return { multiplierParts: parts.map(item => item.mNumber ?? item.mDataValue ?? null), modifiedCalculation: calc.mModifiedGameCalculation, sweetSpotBonus: sourceRank('aatrox_q', 'QSweetSpotBonus', 5) }; }
  },
  {
    skillKey: 'aatrox_w', formulaKey: 'w_damage',
    a: context(5, {}, { 'SOURCE:attack_damage:TOTAL': 200 }), b: context(5, {}, { 'SOURCE:attack_damage:TOTAL': 250 }),
    expected: c => sourceRank('aatrox_w', 'WBaseDamage', c.level) + sourceRank('aatrox_w', 'WTotalADRatio', c.level) * c.attributes['SOURCE:attack_damage:TOTAL'],
    sourceProof: () => { const part = sourcePart('aatrox_w', 'WDamage', item => item.mStat === 2 && item.mDataValue === 'WTotalADRatio', '总攻击力'); return { stat: part.mStat, dataValue: part.mDataValue, baseDataValue: 'WBaseDamage' }; }
  },
  {
    skillKey: 'aatrox_e', formulaKey: 'total_healing_ratio',
    a: context(1, {}, { 'SOURCE:hp:BONUS': 1000 }), b: context(1, {}, { 'SOURCE:hp:BONUS': 2000 }),
    expected: c => sourceRank('aatrox_e', 'ESpellVamp', c.level) / 100 + sourceRank('aatrox_e', 'EVampHPRatio', c.level) * Number(sourceCalculation('aatrox_e', 'TotalEVamp').mMultiplier?.mNumber) * c.attributes['SOURCE:hp:BONUS'],
    sourceProof: () => { const calc = sourceCalculation('aatrox_e', 'TotalEVamp'); const part = sourcePart('aatrox_e', 'TotalEVamp', item => item.mStat === 12 && item.mStatFormula === 2 && item.mDataValue === 'EVampHPRatio', '额外生命值'); const multiplier = Number(calc.mMultiplier?.mNumber); assert(Math.abs(multiplier - 0.01) < 1e-6, 'Aatrox E根乘数不是0.01'); return { stat: part.mStat, statFormula: part.mStatFormula, dataValue: part.mDataValue, multiplier, basePercent: sourceRank('aatrox_e', 'ESpellVamp', 1), ratioRaw: sourceRank('aatrox_e', 'EVampHPRatio', 1), sourceTextLength: sourceText('aatrox_e').length }; }
  },
  {
    skillKey: 'rengar_q', formulaKey: 'q_total_damage',
    a: context(5, {}, { 'SOURCE:attack_damage:TOTAL': 200 }), b: context(5, {}, { 'SOURCE:attack_damage:TOTAL': 250 }),
    expected: c => sourceRank('rengar_q', 'BaseDamage', c.level) + c.attributes['SOURCE:attack_damage:TOTAL'] + sourceRank('rengar_q', 'BaseADRatio', c.level) * c.attributes['SOURCE:attack_damage:TOTAL'],
    sourceProof: () => { const parts = sourceCalculation('rengar_q', 'QTotalDamage').mFormulaParts ?? []; assert(parts.some(item => item.mCoefficient === 1 && item.mStat === 2) && parts.some(item => item.mStat === 2 && item.mDataValue === 'BaseADRatio'), 'Rengar Q总伤害树缺总攻击力两分支'); return { coefficient: 1, ratioDataValue: 'BaseADRatio', baseDataValue: 'BaseDamage' }; }
  },
  {
    skillKey: 'rengar_q', formulaKey: 'empowered_q_total_damage',
    a: context(1, { empowered_q_level_base_damage: 35 }, { 'SOURCE:attack_damage:TOTAL': 200 }), b: context(1, { empowered_q_level_base_damage: 105 }, { 'SOURCE:attack_damage:TOTAL': 250 }),
    expected: c => c.parameters.empowered_q_level_base_damage + c.attributes['SOURCE:attack_damage:TOTAL'] + sourceRank('rengar_q', 'EmpoweredADRatio', 5) * c.attributes['SOURCE:attack_damage:TOTAL'],
    sourceProof: () => { const parts = sourceCalculation('rengar_q', 'EmpoweredQTotalDamage').mFormulaParts ?? []; const levelPart = parts.find(item => item.mLevel1Value === 35); const ratio = parts.find(item => item.mDataValue === 'EmpoweredADRatio'); assert(levelPart && ratio?.mStat === 2, 'Rengar Q强化树缺等级基础或总攻击力分支'); return { level1Value: levelPart.mLevel1Value, initialBonusPerLevel: levelPart.mInitialBonusPerLevel, breakpoints: levelPart.mBreakpoints ?? [], ratioDataValue: ratio.mDataValue, note: '等级曲线完整算法不在本核对中插值；基础值按无默认运行输入提供' }; }
  },
  {
    skillKey: 'rengar_w', formulaKey: 'total_damage',
    a: context(5, {}, { 'SOURCE:ability_power:TOTAL': 100 }), b: context(5, {}, { 'SOURCE:ability_power:TOTAL': 200 }),
    expected: c => sourceRank('rengar_w', 'BaseDamage', c.level) + sourceRank('rengar_w', 'APRatio', c.level) * c.attributes['SOURCE:ability_power:TOTAL'],
    sourceProof: () => { const part = sourcePart('rengar_w', 'TotalDamage', item => item.mDataValue === 'APRatio', '法术强度'); return { dataValue: part.mDataValue, baseDataValue: 'BaseDamage' }; }
  },
  {
    skillKey: 'rengar_w', formulaKey: 'total_damage_empowered',
    a: context(1, { empowered_w_level_base_damage: 100 }, { 'SOURCE:ability_power:TOTAL': 100 }), b: context(1, { empowered_w_level_base_damage: 200 }, { 'SOURCE:ability_power:TOTAL': 200 }),
    expected: c => c.parameters.empowered_w_level_base_damage + sourceRank('rengar_w', 'EmpoweredAPRatio', 5) * c.attributes['SOURCE:ability_power:TOTAL'],
    sourceProof: () => { const parts = sourceCalculation('rengar_w', 'TotalDamageEmpowered').mFormulaParts ?? []; const levelPart = parts.find(item => Array.isArray(item.values)); const ratio = parts.find(item => item.mDataValue === 'EmpoweredAPRatio'); assert(levelPart && ratio, 'Rengar W强化树缺等级基础或法术强度分支'); return { sourceLevelValuesHead: levelPart.values.slice(0, 4), ratioDataValue: ratio.mDataValue, note: '等级基础值按无默认运行输入提供' }; }
  },
  {
    skillKey: 'rengar_w', formulaKey: 'recent_damage_heal',
    a: context(1, { recent_damage_taken: 100 }), b: context(1, { recent_damage_taken: 200 }),
    expected: c => c.parameters.recent_damage_taken * sourceRank('rengar_w', 'DamagePercentageHealed', 1) / 100,
    sourceProof: () => { const raw = sourceRank('rengar_w', 'DamagePercentageHealed', 1); assert(raw === 50, 'Rengar W回复百分数点不是50'); return { dataValue: 'DamagePercentageHealed', rawPercentPoints: raw, ratio: raw / 100 }; }
  },
  {
    skillKey: 'rengar_e', formulaKey: 'total_damage',
    a: context(5, {}, { 'SOURCE:attack_damage:BONUS': 100 }), b: context(5, {}, { 'SOURCE:attack_damage:BONUS': 200 }),
    expected: c => sourceRank('rengar_e', 'BaseDamage', c.level) + sourceRank('rengar_e', 'BonusADRatio', c.level) * c.attributes['SOURCE:attack_damage:BONUS'],
    sourceProof: () => { const part = sourcePart('rengar_e', 'TotalDamage', item => item.mStat === 2 && item.mStatFormula === 2 && item.mDataValue === 'BonusADRatio', '额外攻击力'); return { stat: part.mStat, statFormula: part.mStatFormula, dataValue: part.mDataValue, baseDataValue: 'BaseDamage' }; }
  },
  {
    skillKey: 'rengar_e', formulaKey: 'total_empowered_damage',
    a: context(1, { empowered_e_level_base_damage: 50 }, { 'SOURCE:attack_damage:BONUS': 100 }), b: context(1, { empowered_e_level_base_damage: 150 }, { 'SOURCE:attack_damage:BONUS': 200 }),
    expected: c => c.parameters.empowered_e_level_base_damage + sourceRank('rengar_e', 'BonusADRatio', 5) * c.attributes['SOURCE:attack_damage:BONUS'],
    sourceProof: () => { const parts = sourceCalculation('rengar_e', 'TotalEmpoweredDamage').mFormulaParts ?? []; const levelPart = parts.find(item => item.mLevel1Value === 50); const ratio = parts.find(item => item.mDataValue === 'BonusADRatio'); assert(levelPart && ratio?.mStat === 2 && ratio?.mStatFormula === 2, 'Rengar E强化树缺等级基础或额外攻击力分支'); return { level1Value: levelPart.mLevel1Value, initialBonusPerLevel: levelPart.mInitialBonusPerLevel, ratioDataValue: ratio.mDataValue, stat: ratio.mStat, statFormula: ratio.mStatFormula, note: '等级基础值按无默认运行输入提供' }; }
  },
  {
    skillKey: 'khazix_p', formulaKey: 'passive_damage',
    a: context(1, { passive_level_base_damage: 10 }, { 'SOURCE:attack_damage:BONUS': 100 }), b: context(1, { passive_level_base_damage: 80 }, { 'SOURCE:attack_damage:BONUS': 200 }),
    expected: c => c.parameters.passive_level_base_damage + sourceRank('khazix_p', 'BonusADRatio', 1) * c.attributes['SOURCE:attack_damage:BONUS'],
    sourceProof: () => { const calc = sourceCalculation('khazix_p', 'TotalDamage'); const levelPart = calc.mFormulaParts?.find(item => Array.isArray(item.values)); const ratio = calc.mFormulaParts?.find(item => item.mDataValue === 'BonusADRatio'); assert(levelPart && ratio?.mStat === 2 && ratio?.mStatFormula === 2, '卡兹克P树缺等级基础或额外攻击力分支'); return { levelValuesHead: levelPart.values.slice(0, 4), ratioDataValue: ratio.mDataValue, stat: ratio.mStat, statFormula: ratio.mStatFormula, note: '等级基础值按无默认运行输入提供' }; }
  },
  {
    skillKey: 'khazix_q', formulaKey: 'base_damage',
    a: context(5, {}, { 'SOURCE:attack_damage:BONUS': 100 }), b: context(5, {}, { 'SOURCE:attack_damage:BONUS': 200 }),
    expected: c => sourceEffect('khazix_q', 1, c.level) + sourceRank('khazix_q', 'BonusADRatio', c.level) * c.attributes['SOURCE:attack_damage:BONUS'],
    sourceProof: () => { const calc = sourceCalculation('khazix_q', 'BaseDamage'); const effectPart = calc.mFormulaParts?.find(item => item.mEffectIndex === 1); const ratio = calc.mFormulaParts?.find(item => item.mDataValue === 'BonusADRatio'); assert(effectPart && ratio?.mStat === 2 && ratio?.mStatFormula === 2, '卡兹克Q树缺效果值或额外攻击力分支'); return { effectIndex: effectPart.mEffectIndex, ratioDataValue: ratio.mDataValue, stat: ratio.mStat, statFormula: ratio.mStatFormula }; }
  },
  {
    skillKey: 'khazix_q', formulaKey: 'isolated_damage',
    a: context(5, {}, { 'SOURCE:attack_damage:BONUS': 100 }), b: context(5, {}, { 'SOURCE:attack_damage:BONUS': 200 }),
    expected: c => sourceCalculation('khazix_q', 'IsoDamage').mMultiplier.mNumber * (sourceEffect('khazix_q', 1, c.level) + sourceRank('khazix_q', 'BonusADRatio', c.level) * c.attributes['SOURCE:attack_damage:BONUS']),
    sourceProof: () => { const calc = sourceCalculation('khazix_q', 'IsoDamage'); const multiplier = Number(calc.mMultiplier?.mNumber); assert(Math.abs(multiplier - 2.1) < 1e-6 && calc.mModifiedGameCalculation === 'BaseDamage', '卡兹克Q孤立倍率不是2.1×BaseDamage'); return { multiplier, modifiedGameCalculation: calc.mModifiedGameCalculation, note: '孤立资格仍是无默认运行输入' }; }
  },
  {
    skillKey: 'khazix_w', formulaKey: 'base_damage',
    a: context(5, {}, { 'SOURCE:attack_damage:BONUS': 100 }), b: context(5, {}, { 'SOURCE:attack_damage:BONUS': 200 }),
    expected: c => sourceEffect('khazix_w', 1, c.level) + c.attributes['SOURCE:attack_damage:BONUS'],
    sourceProof: () => { const parts = sourceCalculation('khazix_w', 'BaseDamage').mFormulaParts ?? []; const effectPart = parts.find(item => item.mEffectIndex === 1); const statPart = parts.find(item => item.mStat === 2 && item.mStatFormula === 2); assert(effectPart && statPart?.mCoefficient === 1, '卡兹克W树缺效果值或额外攻击力分支'); return { effectIndex: effectPart.mEffectIndex, stat: statPart.mStat, statFormula: statPart.mStatFormula, coefficient: statPart.mCoefficient }; }
  },
  {
    skillKey: 'khazix_w', formulaKey: 'heal_amount',
    a: context(5, {}, { 'SOURCE:ability_power:TOTAL': 100 }), b: context(5, {}, { 'SOURCE:ability_power:TOTAL': 200 }),
    expected: c => sourceRank('khazix_w', 'BaseHeal', c.level) + sourceRank('khazix_w', 'HealAPRatio', c.level) * c.attributes['SOURCE:ability_power:TOTAL'],
    sourceProof: () => { const part = sourcePart('khazix_w', 'HealAmount', item => item.mDataValue === 'HealAPRatio', '法术强度'); return { dataValue: part.mDataValue, baseDataValue: 'BaseHeal' }; }
  },
  {
    skillKey: 'khazix_e', formulaKey: 'total_damage',
    a: context(5, {}, { 'SOURCE:attack_damage:BONUS': 100 }), b: context(5, {}, { 'SOURCE:attack_damage:BONUS': 200 }),
    expected: c => sourceEffect('khazix_e', 1, c.level) + sourceRank('khazix_e', 'ADRatio', c.level) * c.attributes['SOURCE:attack_damage:BONUS'],
    sourceProof: () => { const parts = sourceCalculation('khazix_e', 'TotalDamage').mFormulaParts ?? []; const effectPart = parts.find(item => item.mEffectIndex === 1); const statPart = parts.find(item => item.mStat === 2 && item.mStatFormula === 2); assert(effectPart && Math.abs(Number(statPart?.mCoefficient) - 0.4) < 1e-6, '卡兹克E树缺效果值或额外攻击力分支'); return { effectIndex: effectPart.mEffectIndex, stat: statPart.mStat, statFormula: statPart.mStatFormula, coefficient: statPart.mCoefficient }; }
  }
];

let currentSkill = null;
const results = [];
const failures = [];
const assertFormulaList = () => {
  assert(actualFormulaMap.size === 26, `独立快照公式数量应为26，实际${actualFormulaMap.size}`);
  assert(specs.length === 26, `核对规格数量应为26，实际${specs.length}`);
};

function missingInputChecks(skillKey, expression, a) {
  currentSkill = skillKey;
  const leaves = externalLeaves(expression);
  const unique = [...new Map(leaves.map(item => [`${item.type}:${item.key}`, item])).values()];
  const checks = [];
  for (const item of unique) {
    const altered = cloneContext(a);
    if (item.type === 'PARAMETER') {
      const parameter = actualParameter(skillKey, item.key);
      assert(parameter.valueMode === 'RUNTIME_INPUT', `外部参数不是运行输入 ${skillKey}/${item.key}`);
      assert(parameter.fixedValue === null && parameter.levelValues === null, `运行输入存在默认值 ${skillKey}/${item.key}`);
      delete altered.parameters[item.key];
    } else {
      delete altered.attributes[item.key];
    }
    let rejected = false;
    let error = null;
    try { evaluate(skillKey, expression, altered); } catch (caught) { rejected = caught?.code === 'MISSING_RUNTIME_INPUT' || caught?.code === 'MISSING_ATTRIBUTE_INPUT'; error = `${caught.name}: ${caught.message}`; }
    if (!rejected) throw Error(`缺少外部输入未拒绝 ${skillKey}/${item.key}`);
    checks.push({ input: item, rejected, error });
  }
  return { inputs: unique, checks, allRejected: checks.every(item => item.rejected) };
}

for (const spec of specs) {
  currentSkill = spec.skillKey;
  try {
    const formula = actualFormula(spec.skillKey, spec.formulaKey);
    const actualA = evaluate(spec.skillKey, formula.expression, spec.a);
    const actualB = evaluate(spec.skillKey, formula.expression, spec.b);
    const expectedA = spec.expected(spec.a);
    const expectedB = spec.expected(spec.b);
    const missing = missingInputChecks(spec.skillKey, formula.expression, spec.a);
    assert(numericClose(actualA, expectedA), `第一组数值不符 ${spec.skillKey}/${spec.formulaKey}: actual=${actualA}, expected=${expectedA}`);
    assert(numericClose(actualB, expectedB), `第二组数值不符 ${spec.skillKey}/${spec.formulaKey}: actual=${actualB}, expected=${expectedB}`);
    assert(Math.abs(actualA - actualB) >= 1e-6, `两组输入没有产生区分结果 ${spec.skillKey}/${spec.formulaKey}`);
    const sourceProof = spec.sourceProof();
    results.push({
      skillKey: spec.skillKey,
      formulaKey: spec.formulaKey,
      actualExpression: formula.expression,
      sourceProof,
      groups: [
        { context: spec.a, actual: actualA, expected: expectedA, delta: actualA - expectedA },
        { context: spec.b, actual: actualB, expected: expectedB, delta: actualB - expectedB }
      ],
      distinctInputs: true,
      missingInputChecks: missing,
      ok: true
    });
  } catch (error) {
    failures.push({ skillKey: spec.skillKey, formulaKey: spec.formulaKey, error: `${error.name}: ${error.message}` });
    results.push({ skillKey: spec.skillKey, formulaKey: spec.formulaKey, ok: false, error: `${error.name}: ${error.message}` });
  }
}

const runtimeInputs = [];
for (const [key, item] of parameterMap.entries()) {
  if (item.valueMode === 'RUNTIME_INPUT') runtimeInputs.push({ key, fixedValue: item.fixedValue, levelValues: item.levelValues });
}
const output = {
  generatedAt: new Date().toISOString(),
  mode: '只读本地写后独立全量快照；不访问接口、不写业务数据',
  source: 'client16.17/official16.17.1',
  snapshotPath,
  snapshotSha256: sha256(snapshotBytes),
  sourceEvidencePath: sourcePath,
  sourceEvidenceSha256: sha256(sourceBytes),
  textEvidencePath: textPath,
  textEvidenceSha256: sha256(textBytes),
  formulaCount: actualFormulaMap.size,
  expectedFormulaCount: 26,
  groupsPerFormula: 2,
  formulasWithDistinctGroups: results.filter(item => item.distinctInputs).length,
  missingInputChecks: results.reduce((sum, item) => sum + (item.missingInputChecks?.checks?.length ?? 0), 0),
  runtimeInputsWithoutDefaults: runtimeInputs.filter(item => item.fixedValue !== null || item.levelValues !== null),
  runtimeInputCount: runtimeInputs.length,
  results,
  failedChecks: failures,
  summary: {
    formulas: results.length,
    groups: results.reduce((sum, item) => sum + (item.groups?.length ?? 0), 0),
    distinctGroups: results.filter(item => item.distinctInputs).length,
    failedFormulas: failures.length,
    allMissingInputsRejected: results.every(item => item.missingInputChecks?.allRejected === true),
    noRuntimeInputDefaults: runtimeInputs.every(item => item.fixedValue === null && item.levelValues === null),
    passed: failures.length === 0 && results.length === 26
  }
};
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ outputPath, formulaCount: output.formulaCount, groups: output.summary.groups, distinctGroups: output.summary.distinctGroups, missingInputChecks: output.missingInputChecks, runtimeInputCount: output.runtimeInputCount, failedFormulas: failures.length, passed: output.summary.passed }, null, 2));
if (!output.summary.passed) process.exitCode = 1;

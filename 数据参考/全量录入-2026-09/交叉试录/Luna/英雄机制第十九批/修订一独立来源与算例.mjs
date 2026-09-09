import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const candidateBytes = fs.readFileSync(new URL('修订一候选.json', here));
const candidate = JSON.parse(candidateBytes);
const source = JSON.parse(fs.readFileSync(new URL('根绑定与数值证据.json', here), 'utf8'));
const snapshotBytes = fs.readFileSync(new URL('写前现值.json', here));
const snapshot = JSON.parse(snapshotBytes);

function skill(skillKey) {
  for (const hero of source.heroes) {
    const found = hero.spells.find(item => item.skillKey === skillKey);
    if (found) return found;
  }
  throw Error('缺来源技能 ' + skillKey);
}

function parameter(skillKey, key) {
  const item = candidate.skills[skillKey]?.write.parameters.find(value => value.parameterKey === key);
  if (!item) throw Error('缺候选参数 ' + skillKey + '/' + key);
  return item;
}

function valueOf(skillKey, key, context = {}) {
  const item = parameter(skillKey, key);
  if (item.valueMode === 'FIXED') return Number(item.fixedValue);
  if (item.valueMode === 'SKILL_LEVEL') return Number(item.levelValues[String(context.level ?? 1)]);
  if (item.valueMode === 'RUNTIME_INPUT') {
    if (!(key in context)) throw Error('算例未提供运行输入 ' + skillKey + '/' + key);
    return Number(context[key]);
  }
  throw Error('未知参数模式 ' + skillKey + '/' + key);
}

function evalExpression(skillKey, expression, context) {
  if (expression.nodeType === 'PARAMETER') return valueOf(skillKey, expression.parameterKey, context);
  if (expression.nodeType === 'ATTRIBUTE') {
    const key = expression.attributeKey;
    const contextKey = key === 'attack_damage'
      ? (expression.attributeValueKind === 'BONUS' ? 'bonus_attack_damage' : 'total_attack_damage')
      : key === 'ability_power'
        ? (expression.attributeValueKind === 'BONUS' ? 'bonus_ability_power' : 'total_ability_power')
        : key;
    if (!(contextKey in context)) throw Error('算例未提供属性 ' + skillKey + '/' + expression.attributeValueKind + '/' + key);
    return Number(context[contextKey]);
  }
  const [left, right] = expression.operands.map(item => evalExpression(skillKey, item, context));
  switch (expression.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw Error('未知公式运算 ' + expression.operation);
  }
}

function formula(skillKey, key, context) {
  const item = candidate.skills[skillKey]?.write.formulas.find(value => value.formulaKey === key);
  if (!item) throw Error('缺候选公式 ' + skillKey + '/' + key);
  return evalExpression(skillKey, item.expression, context);
}

function rawData(skillKey, name) {
  const entry = skill(skillKey).object.mSpell.DataValues.find(item => item.name === name);
  if (!entry) throw Error('缺原始数据值 ' + skillKey + '/' + name);
  return entry.values;
}

function rawRank(skillKey, name, level) {
  const values = rawData(skillKey, name);
  return Number(values[level]);
}

function rawEffect(skillKey, index, level) {
  const value = skill(skillKey).object.mSpell.mEffectAmount[index - 1]?.value;
  if (!Array.isArray(value)) throw Error('缺原始效果值 ' + skillKey + '/' + index);
  return Number(value[level]);
}

function expect(name, actual, expected, details = {}) {
  const delta = Math.abs(Number(actual) - Number(expected));
  const item = { name, actual, expected, delta, ok: delta < 1e-4, ...details };
  checks.push(item);
  if (!item.ok) throw Error('算例不一致 ' + name + ' actual=' + actual + ' expected=' + expected);
}

const checks = [];
const adInputs = { total_attack_damage: 200, bonus_attack_damage: 100 };
const apInputs = { total_ability_power: 100, bonus_ability_power: 40 };

function attackAttributes(expression, output = []) {
  if (!expression || typeof expression !== 'object') return output;
  if (expression.nodeType === 'ATTRIBUTE' && expression.attributeKey === 'attack_damage') output.push(expression);
  for (const child of expression.operands ?? []) attackAttributes(child, output);
  return output;
}

function assertSourceAttackMapping(skillKey, sourceCalculationKey, formulaKey, expectedValueKind, expectedFormula = 2) {
  const sourceCalculation = skill(skillKey).object.mSpell.mSpellCalculations?.[sourceCalculationKey];
  const sourceParts = sourceCalculation?.mFormulaParts ?? [];
  const sourceStatParts = sourceParts.filter(part => part && part.mStat !== undefined);
  const candidateFormula = candidate.skills[skillKey]?.write.formulas.find(item => item.formulaKey === formulaKey);
  const candidateParts = attackAttributes(candidateFormula?.expression);
  const actual = {
    sourceStatParts: sourceStatParts.map(part => ({ mStat: part.mStat, mStatFormula: part.mStatFormula ?? null })),
    candidateAttributeValueKinds: candidateParts.map(part => part.attributeValueKind)
  };
  const expected = {
    sourceStat: 2,
    sourceStatFormula: expectedFormula,
    candidateAttributeValueKind: expectedValueKind
  };
  const ok = sourceStatParts.length > 0
    && sourceStatParts.every(part => part.mStat === expected.sourceStat && (part.mStatFormula ?? null) === expected.sourceStatFormula)
    && candidateParts.length > 0
    && candidateParts.every(part => part.attributeValueKind === expected.candidateAttributeValueKind);
  const item = { name: `${skillKey}/${sourceCalculationKey}/攻击力属性选择`, actual, expected, delta: 0, ok };
  checks.push(item);
  if (!ok) throw Error('来源树与候选攻击力属性不一致 ' + item.name + ' ' + JSON.stringify({ actual, expected }));
}

// 独立检查原树的mStatFormula：2明确表示额外攻击力；缺省值0的总攻击力分支保留TOTAL。
for (const item of [
  ['riven_w', 'TotalDamage', 'total_damage', 'BONUS', 2],
  ['riven_e', 'TotalShield', 'total_shield', 'BONUS', 2],
  ['riven_r', 'MinDamage', 'wind_slash_min_damage', 'BONUS', 2],
  ['riven_r', 'MaxDamage', 'wind_slash_max_damage', 'BONUS', 2],
  ['rengar_e', 'TotalDamage', 'total_damage', 'BONUS', 2],
  ['rengar_e', 'TotalEmpoweredDamage', 'total_empowered_damage', 'BONUS', 2],
  ['khazix_p', 'TotalDamage', 'passive_damage', 'BONUS', 2],
  ['khazix_q', 'BaseDamage', 'base_damage', 'BONUS', 2],
  ['khazix_w', 'BaseDamage', 'base_damage', 'BONUS', 2],
  ['khazix_e', 'TotalDamage', 'total_damage', 'BONUS', 2],
  ['riven_q', 'FirstSlashDamage', 'first_slash_damage', 'TOTAL', 2],
  ['riven_r', 'BonusAD', 'bonus_attack_damage', 'TOTAL', null],
  ['aatrox_q', 'QDamage', 'q_damage', 'TOTAL', null],
  ['aatrox_w', 'WDamage', 'w_damage', 'TOTAL', null],
  ['rengar_q', 'QTotalDamage', 'q_total_damage', 'TOTAL', null],
  ['rengar_q', 'EmpoweredQTotalDamage', 'empowered_q_total_damage', 'TOTAL', null]
]) assertSourceAttackMapping(...item);

for (const [parameterKey, sourceKey, phrase] of [
  ['bonetooth_necklace_attack_damage', 'Spell_RengarPassive_Tooltip', '骨齿项链'],
  ['khazix_takedown_attack_damage', 'Spell_RengarPassive_TooltipExtended', '击杀卡兹克后会获得额外']
]) {
  const parameterItem = parameter('rengar_p', parameterKey);
  const proof = candidate.skills.rengar_p.proofs.find(item => item.parameterKey === undefined && item.source === sourceKey);
  const text = proof?.raw?.text ?? '';
  const ok = parameterItem.valueMode === 'RUNTIME_INPUT' && parameterItem.fixedValue === null && text.includes(phrase);
  const item = { name: `rengar_p/${parameterKey}/正文来源`, actual: { valueMode: parameterItem.valueMode, fixedValue: parameterItem.fixedValue, sourceTextContains: text.includes(phrase) }, expected: { valueMode: 'RUNTIME_INPUT', fixedValue: null, sourceTextContains: true }, delta: 0, ok };
  checks.push(item);
  if (!ok) throw Error('雷恩加尔骨齿项链正文绑定缺失 ' + parameterKey);
}

// 锐雯：三段共享一个源公式，第三段控制单独保留；护盾和疾风斩范围值核对。
{
  const level = 3;
  expect('riven_q/first_slash_damage/等级3', formula('riven_q', 'first_slash_damage', { level, ...adInputs }), rawRank('riven_q', 'BaseDamage', level) + rawRank('riven_q', 'ADRatio', level) * adInputs.total_attack_damage, { sourceValues: { base: rawRank('riven_q', 'BaseDamage', level), ratio: rawRank('riven_q', 'ADRatio', level) }, attributeValueKind: 'TOTAL', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage, recastCount: valueOf('riven_q', 'recast_count'), thirdKnockupMs: valueOf('riven_q', 'third_recast_knockup_duration_ms') });
  expect('riven_w/total_damage/等级5', formula('riven_w', 'total_damage', { level: 5, ...adInputs }), rawRank('riven_w', 'BaseDamage', 5) + adInputs.bonus_attack_damage, { sourceValues: { base: rawRank('riven_w', 'BaseDamage', 5), ratio: 1 }, attributeValueKind: 'BONUS', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  expect('riven_e/total_shield/等级5', formula('riven_e', 'total_shield', { level: 5, ...adInputs }), rawRank('riven_e', 'ShieldAmount', 5) + 1.1 * adInputs.bonus_attack_damage, { sourceValues: { shield: rawRank('riven_e', 'ShieldAmount', 5), adRatio: 1.1 }, attributeValueKind: 'BONUS', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  expect('riven_r/wind_slash_min_damage/等级3', formula('riven_r', 'wind_slash_min_damage', { level: 3, ...adInputs }), rawRank('riven_r', 'MinBase', 3) + 0.55 * adInputs.bonus_attack_damage, { sourceValues: { base: rawRank('riven_r', 'MinBase', 3), adRatio: 0.55 }, attributeValueKind: 'BONUS', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage, missingHealthRule: '官方正文有已损生命值说明，当前根树未给曲线，未猜测' });
  expect('riven_r/wind_slash_max_damage/等级3', formula('riven_r', 'wind_slash_max_damage', { level: 3, ...adInputs }), rawRank('riven_r', 'MaxBase', 3) + 1.65 * adInputs.bonus_attack_damage, { sourceValues: { base: rawRank('riven_r', 'MaxBase', 3), adRatio: 1.65 }, attributeValueKind: 'BONUS', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage, missingHealthRule: '官方正文有已损生命值说明，当前根树未给曲线，未猜测' });
  expect('riven_r/wind_slash_recast_count', valueOf('riven_r', 'wind_slash_recast_count'), 1, { sourceText: '强化期间可再施放一次；第二阶段单独记录' });
}

// 亚托克斯：PDamage与PCooldown均只保留角色等级边界；Q边缘1+0.75；W负减速转正比例。
{
  const targetMaxHealth = 2000;
  const ratioAtUpperBoundary = 0.10;
  expect('aatrox_p/passive_damage/上限边界', formula('aatrox_p', 'passive_damage', { target_max_health: targetMaxHealth, passive_damage_max_health_ratio: ratioAtUpperBoundary }), targetMaxHealth * ratioAtUpperBoundary, { ratioBoundary: [0.04, 0.1], interpolation: '未求值' });
  const actualPassiveDamage = 123;
  expect('aatrox_p/passive_healing/实际命中伤害', formula('aatrox_p', 'passive_healing', { passive_actual_damage: actualPassiveDamage }), actualPassiveDamage * rawRank('aatrox_p', 'PHealingRatio', 1), { actualHitDamage: actualPassiveDamage, healingRatio: rawRank('aatrox_p', 'PHealingRatio', 1), sourceTextUnit: 'PHealingRatio×100%实际伤害', separateFromPreMitigation: true });
  expect('aatrox_q/q_damage/等级5', formula('aatrox_q', 'q_damage', { level: 5, ...adInputs }), rawRank('aatrox_q', 'QBaseDamage', 5) + rawRank('aatrox_q', 'QTotalADRatio', 5) * adInputs.total_attack_damage, { sourceValues: { base: rawRank('aatrox_q', 'QBaseDamage', 5), ratio: rawRank('aatrox_q', 'QTotalADRatio', 5) }, attributeValueKind: 'TOTAL', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  expect('aatrox_q/q_edge_damage/等级5', formula('aatrox_q', 'q_edge_damage', { level: 5, ...adInputs }), 1.75 * (rawRank('aatrox_q', 'QBaseDamage', 5) + rawRank('aatrox_q', 'QTotalADRatio', 5) * adInputs.total_attack_damage), { edgeMultiplier: 1 + rawRank('aatrox_q', 'QSweetSpotBonus', 5), attributeValueKind: 'TOTAL', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  const rawSlow = rawRank('aatrox_w', 'WSlowPercentage', 5);
  expect('aatrox_w/slow_ratio/等级5', valueOf('aatrox_w', 'slow_ratio', { level: 5 }), -rawSlow, { rawSlow, textUnit: 'WSlowPercentage×-100%' });
  expect('aatrox_w/w_damage/等级5', formula('aatrox_w', 'w_damage', { level: 5, ...adInputs }), rawRank('aatrox_w', 'WBaseDamage', 5) + rawRank('aatrox_w', 'WTotalADRatio', 5) * adInputs.total_attack_damage, { sourceValues: { base: rawRank('aatrox_w', 'WBaseDamage', 5), ratio: rawRank('aatrox_w', 'WTotalADRatio', 5) }, attributeValueKind: 'TOTAL', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  const rootCalculation = skill('aatrox_e').object.mSpell.mSpellCalculations?.TotalEVamp;
  const rootMultiplier = Number(rootCalculation?.mMultiplier?.mNumber);
  const rawExtraHealthRatio = rawRank('aatrox_e', 'EVampHPRatio', 1);
  expect('aatrox_e/base_healing_ratio', valueOf('aatrox_e', 'base_healing_ratio'), rawRank('aatrox_e', 'ESpellVamp', 1) * rootMultiplier, { rootMultiplier, sourceText: 'ESpellVamp×0.01' });
  expect('aatrox_e/bonus_healing_ratio_per_bonus_health', valueOf('aatrox_e', 'bonus_healing_ratio_per_bonus_health'), rawExtraHealthRatio * rootMultiplier, { rootMultiplier, rawExtraHealthRatio, sourceText: 'EVampHPRatio×0.01/每点来源额外生命值' });
  const crossBytes = fs.readFileSync(new URL('../英雄机制第十七批/根绑定与数值证据.json', here));
  const crossSha256 = createHash('sha256').update(crossBytes).digest('hex');
  const cross = JSON.parse(crossBytes);
  const vladimirW = cross.heroes?.find(hero => hero.id === 'Vladimir')?.spells?.find(spell => spell.skillKey === 'vladimir_w');
  const crossTotalDamage = vladimirW?.object?.mSpell?.mSpellCalculations?.TotalDamage;
  const crossBonusHealthPart = crossTotalDamage?.mFormulaParts?.find(part => part?.mDataValue === 'BonusHealthRatio');
  const crossMappingOk = crossSha256 === 'da3d627ae08acf0af922daae667574be76ea0c5bc14d7d5fb0be7eae929e0b7a'
    && crossBonusHealthPart?.mStat === 12
    && crossBonusHealthPart?.mStatFormula === 2;
  checks.push({
    name: 'aatrox_e/TotalEVamp/额外生命值窄映射交叉来源',
    actual: { crossSha256, mStat: crossBonusHealthPart?.mStat ?? null, mStatFormula: crossBonusHealthPart?.mStatFormula ?? null, dataValue: crossBonusHealthPart?.mDataValue ?? null },
    expected: { crossSha256: 'da3d627ae08acf0af922daae667574be76ea0c5bc14d7d5fb0be7eae929e0b7a', mStat: 12, mStatFormula: 2, dataValue: 'BonusHealthRatio' },
    delta: 0,
    ok: crossMappingOk
  });
  if (!crossMappingOk) throw Error('Aatrox E额外生命值窄映射交叉来源不一致');
  for (const [bonusHealth, expectedRatio] of [[0, 0.16], [1000, 0.27], [2000, 0.38]]) {
    expect(`aatrox_e/total_healing_ratio/SOURCE.hp.BONUS=${bonusHealth}`, formula('aatrox_e', 'total_healing_ratio', { hp: bonusHealth }), expectedRatio, {
      bonusHealth,
      baseHealingRatio: valueOf('aatrox_e', 'base_healing_ratio'),
      perBonusHealth: valueOf('aatrox_e', 'bonus_healing_ratio_per_bonus_health'),
      rootMultiplier,
      formulaText: '0.16 + 0.00011×SOURCE.hp.BONUS'
    });
  }
  expect('aatrox_r/attack_damage_amp_ratio/等级3', valueOf('aatrox_r', 'attack_damage_amp_ratio', { level: 3 }), rawRank('aatrox_r', 'RTotalADAmp', 3), { textUnit: 'RTotalADAmp×100%' });
}

// 雷恩加尔：残暴值不是法力；Q/W/E读取弹药恢复字段，不把0.25秒展示冷却当再施放间隔。
{
  expect('rengar_p/max_ferocity', valueOf('rengar_p', 'max_ferocity'), rawRank('rengar_p', 'MaxFerocity', 1), { resource: '残暴值' });
  expect('rengar_q/ammo_recharge_time_ms/等级5', valueOf('rengar_q', 'ammo_recharge_time_ms', { level: 5 }), skill('rengar_q').object.mSpell.mAmmoRechargeTime[5] * 1000, { resource: '弹药恢复', publicCooldown: snapshot.skills.rengar_q.components.parameters.items.find(value => value.parameterKey === 'cooldown_ms')?.fixedValue ?? null });
  expect('rengar_q/q_total_damage/等级5', formula('rengar_q', 'q_total_damage', { level: 5, ...adInputs }), rawRank('rengar_q', 'BaseDamage', 5) + adInputs.total_attack_damage + rawRank('rengar_q', 'BaseADRatio', 5) * adInputs.total_attack_damage, { sourceValues: { base: rawRank('rengar_q', 'BaseDamage', 5), ratio: rawRank('rengar_q', 'BaseADRatio', 5) }, attributeValueKind: 'TOTAL', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  expect('rengar_q/empowered_q_total_damage/外供基础值', formula('rengar_q', 'empowered_q_total_damage', { empowered_q_level_base_damage: 50, level: 5, ...adInputs }), 50 + adInputs.total_attack_damage + rawRank('rengar_q', 'EmpoweredADRatio', 5) * adInputs.total_attack_damage, { suppliedRuntimeBase: 50, noLevelGuess: true, attributeValueKind: 'TOTAL', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  expect('rengar_w/total_damage/等级5', formula('rengar_w', 'total_damage', { level: 5, ...apInputs }), rawRank('rengar_w', 'BaseDamage', 5) + rawRank('rengar_w', 'APRatio', 5) * apInputs.total_ability_power, { sourceValues: { base: rawRank('rengar_w', 'BaseDamage', 5), ratio: rawRank('rengar_w', 'APRatio', 5) } });
  expect('rengar_w/recent_damage_heal/外供伤害', formula('rengar_w', 'recent_damage_heal', { recent_damage_taken: 400, level: 5 }), 400 * rawRank('rengar_w', 'DamagePercentageHealed', 5) * 0.01, { suppliedRuntimeDamage: 400, sourcePercent: rawRank('rengar_w', 'DamagePercentageHealed', 5) });
  expect('rengar_e/total_damage/等级5', formula('rengar_e', 'total_damage', { level: 5, ...adInputs }), rawRank('rengar_e', 'BaseDamage', 5) + rawRank('rengar_e', 'BonusADRatio', 5) * adInputs.bonus_attack_damage, { sourceValues: { base: rawRank('rengar_e', 'BaseDamage', 5), ratio: rawRank('rengar_e', 'BonusADRatio', 5) }, attributeValueKind: 'BONUS', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  expect('rengar_e/empowered/外供基础值', formula('rengar_e', 'total_empowered_damage', { empowered_e_level_base_damage: 170, level: 5, ...adInputs }), 170 + rawRank('rengar_e', 'BonusADRatio', 5) * adInputs.bonus_attack_damage, { suppliedRuntimeBase: 170, noLevelGuess: true, attributeValueKind: 'BONUS', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  const rBonus = candidate.skills.rengar_r.proofs.find(value => value.source === 'mSpellCalculations.BonusDamage');
  if (!rBonus || rBonus.raw?.mFormulaParts?.[0]?.mCoefficient !== 1) throw Error('缺雷恩加尔R 1倍攻击力来源证据');
  checks.push({ name: 'rengar_r/BonusDamage/源树', actual: '1×来源总攻击力（仅来源证据）', expected: '1×来源总攻击力（仅来源证据）', delta: 0, ok: true, directDisplayFormulaOmitted: true });
}

// 卡兹克：孤立资格和进化选择均无默认；效果值从mEffectAmount取等级索引1起。
{
  expect('khazix_p/passive_damage/外供角色等级基础值', formula('khazix_p', 'passive_damage', { passive_level_base_damage: 52, ...adInputs }), 52 + rawRank('khazix_p', 'BonusADRatio', 1) * adInputs.bonus_attack_damage, { suppliedRuntimeBase: 52, noLevelGuess: true, isolationInput: 'runtime', attributeValueKind: 'BONUS', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  expect('khazix_p/slow_ratio', valueOf('khazix_p', 'slow_ratio'), rawRank('khazix_p', 'SlowAmount', 1), { textUnit: 'SlowAmount×100%' });
  expect('khazix_q/base_damage/等级5', formula('khazix_q', 'base_damage', { level: 5, ...adInputs }), rawEffect('khazix_q', 1, 5) + rawRank('khazix_q', 'BonusADRatio', 5) * adInputs.bonus_attack_damage, { effectIndex: 1, attributeValueKind: 'BONUS', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  expect('khazix_q/isolated_damage/等级5', formula('khazix_q', 'isolated_damage', { level: 5, ...adInputs }), 2.1 * (rawEffect('khazix_q', 1, 5) + rawRank('khazix_q', 'BonusADRatio', 5) * adInputs.bonus_attack_damage), { isolatedMultiplier: 2.1, isolationInput: 'runtime', attributeValueKind: 'BONUS', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  expect('khazix_w/base_damage/等级5', formula('khazix_w', 'base_damage', { level: 5, ...adInputs }), rawEffect('khazix_w', 1, 5) + adInputs.bonus_attack_damage, { effectIndex: 1, adCoefficient: 1, attributeValueKind: 'BONUS', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  expect('khazix_w/heal_amount/等级5', formula('khazix_w', 'heal_amount', { level: 5, ...apInputs }), rawRank('khazix_w', 'BaseHeal', 5) + rawRank('khazix_w', 'HealAPRatio', 5) * apInputs.total_ability_power, { selfInRadius: 'runtime' });
  expect('khazix_e/total_damage/等级5', formula('khazix_e', 'total_damage', { level: 5, ...adInputs }), rawEffect('khazix_e', 1, 5) + rawRank('khazix_e', 'ADRatio', 5) * adInputs.bonus_attack_damage, { effectIndex: 1, attributeValueKind: 'BONUS', totalAttackDamage: adInputs.total_attack_damage, bonusAttackDamage: adInputs.bonus_attack_damage });
  expect('khazix_r/evolutions_available/等级3', valueOf('khazix_r', 'evolutions_available', { level: 3 }), rawRank('khazix_r', 'EvolutionsAvailable', 3), { evolution: '战前选择，候选无默认' });
  expect('khazix_r/evolved_cast_count', valueOf('khazix_r', 'evolved_cast_count', { level: 3 }), rawRank('khazix_r', 'EvolvedNumberOfCasts', 3), { evolution: '战前选择，候选无默认' });
}

const runtimeNoDefaults = [];
for (const [skillKey, item] of Object.entries(candidate.skills)) {
  for (const parameterItem of item.write.parameters) {
    if (parameterItem.valueMode === 'RUNTIME_INPUT') runtimeNoDefaults.push({ skillKey, parameterKey: parameterItem.parameterKey, fixedValue: parameterItem.fixedValue, levelValues: parameterItem.levelValues });
    if (parameterItem.parameterKey.endsWith('_ms')) {
      const values = parameterItem.valueMode === 'FIXED' ? [parameterItem.fixedValue] : parameterItem.valueMode === 'SKILL_LEVEL' ? Object.values(parameterItem.levelValues ?? {}) : [];
      if (values.some(value => Number(value) < 0)) throw Error('发现负毫秒参数 ' + skillKey + '/' + parameterItem.parameterKey);
    }
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  source: 'client16.17/official16.17.1',
  candidateFileSha256: createHash('sha256').update(candidateBytes).digest('hex'),
  candidatePlanSha256: createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),
  snapshotSha256: createHash('sha256').update(snapshotBytes).digest('hex'),
  sourceSkills: source.heroes.reduce((sum, hero) => sum + hero.spells.length, 0),
  candidateSkills: Object.keys(candidate.skills).length,
  checks,
  checkCount: checks.length,
  failedChecks: checks.filter(item => !item.ok).length,
  runtimeInputsWithoutDefaults: runtimeNoDefaults,
  runtimeInputCount: runtimeNoDefaults.length,
  notes: [
    'Aatrox P 的4%至10%和PCooldown的22至10秒只记录端点，未猜角色等级求值。',
    'Aatrox P 的回复消费本次实际命中伤害运行输入，与目标最大生命值折前伤害式分开。',
    'Aatrox E 的TotalEVamp保留根mMultiplier=0.01；EVampHPRatio原值0.011与第十七批Vladimir W同型mStat=12、mStatFormula=2交叉证明为SOURCE.hp.BONUS，换算为0.00011/点，完整比例为0.16 + 0.00011×SOURCE.hp.BONUS。',
    'mStat=2且mStatFormula=2的Riven W/E/R风斩、Rengar E和Khazix P/Q/W/E均独立核对为BONUS；Riven Q/R增益、Aatrox Q/W和Rengar Q的默认总攻击力分支保持TOTAL。',
    'Rengar Q/W/E使用mAmmoRechargeTime；公开0.25秒字段没有替代弹药恢复时间。',
    'Rengar E显形时长和R自身真实视野范围是纯视野排除；骨齿项链与击杀卡兹克攻击力由正文绑定为无默认运行输入。',
    'Khazix的孤立资格、进化选择和W自身爆炸范围均为无默认运行输入；不造条件状态。',
    'Riven R已损生命值伤害区间只有正文说明，当前根MinDamage/MaxDamage未给曲线，未猜测。'
  ]
};
const outJson = new URL('修订一独立源值与算例.json', here);
const outTxt = new URL('修订一独立源值与算例.txt', here);
fs.writeFileSync(outJson, JSON.stringify(summary, null, 2) + '\n');
const formatValue = value => value && typeof value === 'object' ? JSON.stringify(value) : value;
fs.writeFileSync(outTxt, [
  '第十九批独立源值与算例',
  `候选文件哈希：${summary.candidateFileSha256}`,
  `写前GET快照哈希：${summary.snapshotSha256}`,
  `算例：${summary.checkCount}，失败：${summary.failedChecks}`,
  '',
  ...checks.map(item => `${item.ok ? '通过' : '失败'} ${item.name}：实际=${formatValue(item.actual)}，期望=${formatValue(item.expected)}${item.noLevelGuess ? '（外供运行值，未猜等级）' : ''}`),
  '',
  ...summary.notes.map(note => '说明：' + note)
].join('\n') + '\n', 'utf8');
console.log(JSON.stringify({ candidateFileSha256: summary.candidateFileSha256, snapshotSha256: summary.snapshotSha256, checkCount: summary.checkCount, failedChecks: summary.failedChecks, runtimeInputCount: summary.runtimeInputCount }, null, 2));

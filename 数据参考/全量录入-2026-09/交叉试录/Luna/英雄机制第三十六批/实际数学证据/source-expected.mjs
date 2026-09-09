import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = 'C:/project/damage_web_dev';
const inputDir = path.join(root, '.agents', 'artifacts', 'hero36-root-entry-20260910');
const sourcePath = path.join(inputDir, '来源绑定与当前文本.json');
const sourceBytes = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBytes);
const sourceSkills = new Map(source.heroes.flatMap(hero => hero.skills).map(skill => [skill.skillKey, skill]));

export const sourceBindingSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');

const close = (a, b, tolerance = 1e-6) => Number.isFinite(Number(a)) && Number.isFinite(Number(b))
  && Math.abs(Number(a) - Number(b)) <= tolerance * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));
const spellOf = skillKey => sourceSkills.get(skillKey)?.object?.mSpell;
const dataValue = (skillKey, name) => {
  const value = (spellOf(skillKey)?.DataValues ?? []).find(item => item.name === name);
  if (!value || !Array.isArray(value.values)) throw new Error(`原始DataValues缺失：${skillKey}/${name}`);
  return value.values;
};
const rawAt = (skillKey, name, level) => {
  const value = dataValue(skillKey, name)[level];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`原始等级值缺失：${skillKey}/${name}/${level}`);
  return value;
};
const calculation = (skillKey, name) => {
  const value = spellOf(skillKey)?.mSpellCalculations?.[name];
  if (!value) throw new Error(`原始计算树缺失：${skillKey}/${name}`);
  return value;
};
const numbers = value => {
  const out = [];
  const visit = item => {
    if (typeof item === 'number' && Number.isFinite(item)) out.push(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value);
  return out;
};
const rawCoefficient = (skillKey, name, expected) => {
  const values = numbers(calculation(skillKey, name));
  const value = values.find(item => close(item, expected));
  if (value === undefined) throw new Error(`原始计算树系数缺失：${skillKey}/${name}/${expected}`);
  return value;
};
const rawNumberMultiplier = (skillKey, name, expected) => {
  const multiplier = calculation(skillKey, name).mMultiplier;
  if (!multiplier || typeof multiplier.mNumber !== 'number' || !close(multiplier.mNumber, expected)) {
    throw new Error(`原始计算树根乘数缺失：${skillKey}/${name}/${expected}`);
  }
  return multiplier.mNumber;
};
const apOf = context => context.attributes?.SOURCE?.ability_power?.TOTAL;
const hpOf = context => context.attributes?.TARGET?.hp?.TOTAL;
const currentHpOf = context => context.attributes?.TARGET?.hp?.CURRENT;
const runtimeOf = (context, key) => {
  const value = context.runtime?.[key];
  if (value === undefined || value === null) throw new Error(`独立期望缺少运行输入：${key}`);
  return value;
};

export function expected(skillKey, formulaKey, context) {
  const level = context.level;
  const ap = apOf(context);
  const hp = hpOf(context);
  const currentHp = currentHpOf(context);
  if (typeof ap !== 'number' || typeof hp !== 'number' || typeof currentHp !== 'number') throw new Error('独立期望缺少属性输入');
  switch (`${skillKey}|${formulaKey}`) {
    case 'evelynn_p|healing_threshold':
      return runtimeOf(context, 'actual_healing_threshold_base') + rawCoefficient(skillKey, 'HealingThresholdTOOLTIP', 2.5) * ap;
    case 'evelynn_q|missile_magic_damage':
      return rawAt(skillKey, 'HateSpikeBaseDamage', level) + rawAt(skillKey, 'HateSpikeAPRatio', 1) * ap;
    case 'evelynn_q|marked_bonus_magic_damage':
      return rawAt(skillKey, 'BonusDamageBase', level) + rawAt(skillKey, 'BonusDamageAPRatio', 1) * ap;
    case 'evelynn_e|ordinary_magic_damage':
      return rawAt(skillKey, 'BaseDamage', level) + rawNumberMultiplier(skillKey, 'PercentHealthBaseTOOLTIP', 0.01)
        * (rawAt(skillKey, 'BasePercentHealth', 1) + rawCoefficient(skillKey, 'PercentHealthBaseTOOLTIP', 0.015) * ap) * hp;
    case 'evelynn_e|empowered_magic_damage':
      return rawAt(skillKey, 'EmpoweredDamage', level) + rawNumberMultiplier(skillKey, 'PercentHealthEmpoweredTOOLTIP', 0.01)
        * (rawAt(skillKey, 'EmpoweredPercentHealth', 1) + rawCoefficient(skillKey, 'PercentHealthEmpoweredTOOLTIP', 0.025) * ap) * hp;
    case 'evelynn_r|normal_magic_damage':
      return rawAt(skillKey, 'BaseDamage', level) + rawCoefficient(skillKey, 'Damage', 0.75) * ap;
    case 'evelynn_r|low_health_magic_damage':
      return rawAt(skillKey, 'CritMultiplier', 1) * (rawAt(skillKey, 'BaseDamage', level) + rawCoefficient(skillKey, 'Damage', 0.75) * ap);
    case 'lillia_p|dot_total_magic_damage':
      return rawNumberMultiplier(skillKey, 'DotPercentTooltip', 0.01)
        * (rawAt(skillKey, 'DotDamagePercent', 1) + rawCoefficient(skillKey, 'DotPercentTotal', 0.0125) * ap) * hp;
    case 'lillia_p|champion_heal_per_tick':
      return runtimeOf(context, 'actual_champion_heal_base') + rawCoefficient(skillKey, 'ChampionHeal', 0.05) * ap;
    case 'lillia_p|champion_heal_total':
      return rawAt(skillKey, 'DotTicks', 1) * (runtimeOf(context, 'actual_champion_heal_base') + rawCoefficient(skillKey, 'ChampionHeal', 0.05) * ap);
    case 'lillia_q|inner_magic_damage':
      return rawAt(skillKey, 'FlatDamageBase', level) + rawAt(skillKey, 'APRatio', 1) * ap;
    case 'lillia_q|outer_true_damage':
      return rawAt(skillKey, 'FlatDamageTrue', level) + rawAt(skillKey, 'APRatio', 1) * ap;
    case 'lillia_q|move_speed_per_stack':
      return rawAt(skillKey, 'PranceBonusPerStack', level) + rawCoefficient(skillKey, 'PranceSpeed', 0.0003) * ap;
    case 'lillia_w|magic_damage':
      return rawAt(skillKey, 'FlatDamageBase', level) + rawCoefficient(skillKey, 'FlatDamage', 0.35) * ap;
    case 'lillia_w|sweet_spot_magic_damage':
      return rawAt(skillKey, 'SweetSpotBonus', 1) * (rawAt(skillKey, 'FlatDamageBase', level) + rawCoefficient(skillKey, 'FlatDamage', 0.35) * ap);
    case 'lillia_e|impact_magic_damage':
      return rawAt(skillKey, 'ImpactDamage', level) + rawAt(skillKey, 'APRatio', 1) * ap;
    case 'lillia_r|break_magic_damage':
      return rawAt(skillKey, 'BreakDamageBase', level) + rawCoefficient(skillKey, 'TotalDamage', 0.4) * ap;
    case 'fiddlesticks_q|normal_magic_damage':
      return Math.max(rawAt(skillKey, 'MinimumDamage', level), currentHp * (rawAt(skillKey, 'MaxHealthDamage', level) + rawCoefficient(skillKey, 'TotalPercentHealthDamage', 0.0003) * ap));
    case 'fiddlesticks_q|feared_magic_damage':
      return rawNumberMultiplier(skillKey, 'TotalPercentHealthDamageFeared', 2) * Math.max(rawAt(skillKey, 'MinimumDamage', level), currentHp * (rawAt(skillKey, 'MaxHealthDamage', level) + rawCoefficient(skillKey, 'TotalPercentHealthDamage', 0.0003) * ap));
    case 'fiddlesticks_w|damage_per_second':
      return rawAt(skillKey, 'DamagePerSecond', level) + rawCoefficient(skillKey, 'DrainDamageCalc', 0.45) * ap;
    case 'fiddlesticks_w|end_missing_health_damage':
      return 0.01 * rawAt(skillKey, 'PercentForTooltip', level) * runtimeOf(context, 'actual_target_missing_health');
    case 'fiddlesticks_w|champion_heal_amount':
      return 0.01 * rawAt(skillKey, 'VampPercentage', level) * runtimeOf(context, 'actual_hero_pre_mitigation_damage');
    case 'fiddlesticks_e|magic_damage':
      return rawAt(skillKey, 'BaseDamage', level) + rawCoefficient(skillKey, 'Damage', 0.5) * ap;
    case 'fiddlesticks_r|damage_per_second':
      return rawAt(skillKey, 'DamagePerSecond', level) + rawAt(skillKey, 'APRatio', 1) * ap;
    case 'fiddlesticks_r|damage_done_single_tick':
      return rawNumberMultiplier(skillKey, 'DamageDone', 0.25) * (rawAt(skillKey, 'DamagePerSecond', level) + rawAt(skillKey, 'APRatio', 1) * ap);
    case 'fiddlesticks_r|total_magic_damage':
      return rawAt(skillKey, 'Duration', 1) * (rawAt(skillKey, 'DamagePerSecond', level) + rawAt(skillKey, 'APRatio', 1) * ap);
    case 'singed_q|damage_per_second':
      return rawAt(skillKey, 'BaseDamagePerSecond', level) + rawAt(skillKey, 'APRatioPerSecond', 1) * ap;
    case 'singed_q|approximate_total_damage':
      return rawNumberMultiplier(skillKey, 'ApproximateTotalDamageTooltip', 4.75) * (rawAt(skillKey, 'BaseDamagePerSecond', level) + rawAt(skillKey, 'APRatioPerSecond', 1) * ap);
    case 'singed_e|base_magic_damage':
      return rawAt(skillKey, 'BaseDamageValue', level) + rawCoefficient(skillKey, 'BaseDamage', 0.55) * ap;
    case 'singed_e|max_health_magic_component':
      return 0.01 * rawAt(skillKey, 'MaxHPDamage', level) * hp;
    case 'singed_e|total_magic_damage':
      return rawAt(skillKey, 'BaseDamageValue', level) + rawCoefficient(skillKey, 'BaseDamage', 0.55) * ap
        + 0.01 * rawAt(skillKey, 'MaxHPDamage', level) * hp;
    default:
      throw new Error(`独立期望没有公式映射：${skillKey}/${formulaKey}`);
  }
}


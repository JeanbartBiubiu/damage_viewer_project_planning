import fs from 'node:fs';
import path from 'node:path';

const root = 'C:/project/damage_web_dev';
const inputDir = path.join(root, '.agents', 'artifacts', 'hero35-root-entry-20260910');
const sourcePath = path.join(inputDir, '来源绑定与当前文本.json');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''));
const sourceSkills = new Map(source.heroes.flatMap(hero => hero.skills).map(skill => [skill.skillKey, skill]));

export const sourceMeta = Object.freeze({
  sourcePath,
  clientVersion: source.clientVersion,
  officialVersion: source.officialVersion,
  sourceIndexSha256: source.sourceIndexSha256,
});

export const sourceSkill = skillKey => {
  const item = sourceSkills.get(skillKey);
  if (!item) throw new Error(`缺少冻结来源技能：${skillKey}`);
  return item;
};

export const spell = skillKey => sourceSkill(skillKey).object.mSpell;

export const rawData = (skillKey, name, level = 1) => {
  const values = spell(skillKey).DataValues?.find(item => item.name === name)?.values;
  if (!Array.isArray(values) || values[level] === undefined || !Number.isFinite(Number(values[level]))) {
    throw new Error(`缺少冻结来源数值：${skillKey}/${name}[${level}]`);
  }
  return Number(values[level]);
};

export const rawCalculation = (skillKey, name) => {
  const value = spell(skillKey).mSpellCalculations?.[name];
  if (!value) throw new Error(`缺少冻结来源计算树：${skillKey}/${name}`);
  return value;
};

export const rawCoefficient = (skillKey, name, partIndex = null) => {
  const parts = rawCalculation(skillKey, name).mFormulaParts ?? [];
  const part = partIndex === null ? parts.find(item => typeof item.mCoefficient === 'number') : parts[partIndex];
  if (!part || typeof part.mCoefficient !== 'number') throw new Error(`缺少冻结来源系数：${skillKey}/${name}[${partIndex ?? 'first'}]`);
  return Number(part.mCoefficient);
};

export const rawNumberMultiplier = (skillKey, name) => {
  const value = rawCalculation(skillKey, name).mMultiplier?.mNumber;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`缺少冻结来源根乘数：${skillKey}/${name}`);
  return value;
};

export const rawCharacterLevel = (skillKey, name, characterLevel) => {
  const part = (rawCalculation(skillKey, name).mFormulaParts ?? []).find(item => Array.isArray(item.values));
  if (!part || part.values[characterLevel] === undefined) throw new Error(`缺少冻结来源角色等级值：${skillKey}/${name}[${characterLevel}]`);
  return Number(part.values[characterLevel]);
};

const attrs = context => context.attributes ?? {};
const sourceAttr = (context, key, valueKind) => {
  const value = attrs(context).SOURCE?.[key]?.[valueKind];
  if (!Number.isFinite(Number(value))) throw new Error(`缺少来源属性输入：${key}/${valueKind}`);
  return Number(value);
};
const targetAttr = (context, key, valueKind) => {
  const value = attrs(context).TARGET?.[key]?.[valueKind];
  if (!Number.isFinite(Number(value))) throw new Error(`缺少目标属性输入：${key}/${valueKind}`);
  return Number(value);
};
const runtime = (context, key) => {
  const value = context.runtime?.[key];
  if (!Number.isFinite(Number(value))) throw new Error(`缺少运行输入：${key}`);
  return Number(value);
};

// 期望值只读取本文件绑定的冻结客户端树和DataValues；候选参数数值、候选表达式和接口详情都不参与。
export function expectedValue(skillKey, formulaKey, context) {
  const level = context.skillLevel;
  const characterLevel = context.characterLevel;
  const ap = sourceAttr(context, 'ability_power', 'TOTAL');
  const sourceHP = sourceAttr(context, 'hp', 'TOTAL');
  const sourceBonusHP = sourceAttr(context, 'hp', 'BONUS');
  const targetHP = targetAttr(context, 'hp', 'TOTAL');
  const r = key => runtime(context, key);
  switch (`${skillKey}/${formulaKey}`) {
    case 'braum_p/already_stunned_extra_magic_damage':
      return rawCharacterLevel('braum_p', 'TotalDamage', characterLevel) * rawData('braum_p', 'AlreadyStunnedDamageAmp');
    case 'braum_q/magic_damage':
      return rawData('braum_q', 'BaseDamage', level) + rawData('braum_q', 'MaxHPDamageValue') * sourceHP;
    case 'braum_w/self_armor_bonus':
      return rawData('braum_w', 'BaseResists', level) + rawData('braum_w', 'BraumArmorPercent') * r('actual_armor_stage');
    case 'braum_w/self_magic_resistance_bonus':
      return rawData('braum_w', 'BaseResists', level) + rawData('braum_w', 'BraumArmorPercent') * sourceAttr(context, 'magic_resistance', 'BONUS');
    case 'braum_r/magic_damage':
      return rawData('braum_r', 'BaseDamage', level) + rawCoefficient('braum_r', 'TotalDamage') * ap;
    case 'rell_p/on_hit_extra_magic_damage':
      return rawCoefficient('rell_p', 'OnHitDamage', 0) * sourceAttr(context, 'armor', 'TOTAL')
        + rawCoefficient('rell_p', 'OnHitDamage', 1) * sourceAttr(context, 'magic_resistance', 'TOTAL');
    case 'rell_q/magic_damage':
      return rawData('rell_q', 'BaseDamage', level) + rawCoefficient('rell_q', 'Damage') * ap;
    case 'rell_w/crash_down_magic_damage':
      return rawData('rell_w', 'CrashDownDamage', level) + rawCoefficient('rell_w', 'DismountDamage') * ap;
    case 'rell_w/crash_shield_value':
      return rawData('rell_w', 'ShieldBase', level) + rawData('rell_w', 'ShieldHealthRatio') * sourceHP;
    case 'rell_w/mount_up_extra_attack_magic_damage':
      return rawData('rell_w', 'MountUpDamage', level) + rawCoefficient('rell_w', 'FlipDamage') * ap;
    case 'rell_e/next_hit_extra_magic_damage':
      return (rawData('rell_e', 'PercentHealthDamage', level) + rawCoefficient('rell_e', 'MaxHealthDamageCalc') * ap) * targetHP;
    case 'rell_r/damage_per_second_magic':
      return rawData('rell_r', 'BaseDamagePerSecond', level) + rawCoefficient('rell_r', 'DamagePerSecond') * ap;
    case 'rell_r/total_magic_damage':
      return (rawData('rell_r', 'BaseDamagePerSecond', level) + rawCoefficient('rell_r', 'DamagePerSecond') * ap) * rawData('rell_r', 'Duration');
    case 'taric_p/empowered_attack_extra_magic_damage':
      return r('character_level_base_damage') * rawData('taric_p', 'BaseDamageMultiplierForModesBalance')
        + rawData('taric_p', 'ArmorDamageValue') * r('actual_armor_stage');
    case 'taric_p/basic_ability_cooldown_refund_seconds':
      return 1 + (1 - r('actual_cooldown_multiplier'));
    case 'taric_q/healing_per_charge':
      return rawData('taric_q', 'HealingPerStackBase') + rawData('taric_q', 'HealingAPRatio') * ap
        + rawData('taric_q', 'HealingHPRatio') * sourceHP;
    case 'taric_q/max_charge_healing':
      return (rawData('taric_q', 'HealingPerStackBase') + rawData('taric_q', 'HealingAPRatio') * ap
        + rawData('taric_q', 'HealingHPRatio') * sourceHP) * rawData('taric_q', 'MaxCharges', level);
    case 'taric_q/consumed_charge_healing':
      return (rawData('taric_q', 'HealingPerStackBase') + rawData('taric_q', 'HealingAPRatio') * ap
        + rawData('taric_q', 'HealingHPRatio') * sourceHP) * r('current_consumed_charge_count');
    case 'taric_w/self_armor_bonus':
      return rawData('taric_w', 'ArmorBonusPercentage', level) * r('actual_armor_stage');
    case 'taric_w/self_shield_value':
      return (rawData('taric_w', 'ShieldHPRatio', level) / 100) * sourceHP;
    case 'taric_e/magic_damage':
      return rawData('taric_e', 'BaseDamage', level) + rawCoefficient('taric_e', 'TotalDamage', 1) * ap
        + rawCoefficient('taric_e', 'TotalDamage', 2) * r('actual_armor_stage');
    case 'tahmkench_p/bonus_hp_magic_damage':
      return rawCoefficient('tahmkench_p', 'TotalDamage', 1) * sourceBonusHP;
    case 'tahmkench_p/ap_bonus_hp_magic_damage':
      return rawData('tahmkench_p', 'APRatioPer100BonusHP') * ap * 0.01 * sourceBonusHP;
    case 'tahmkench_p/total_passive_magic_damage':
      return r('character_level_base_damage') + rawCoefficient('tahmkench_p', 'TotalDamage', 1) * sourceBonusHP
        + rawData('tahmkench_p', 'APRatioPer100BonusHP') * ap * 0.01 * sourceBonusHP;
    case 'tahmkench_q/magic_damage':
      return rawData('tahmkench_q', 'BaseDamage', level) + rawCoefficient('tahmkench_q', 'TotalDamage') * ap;
    case 'tahmkench_q/self_heal':
      return rawData('tahmkench_q', 'BaseHeal', level) + rawData('tahmkench_q', 'PercentHealthHealing', level) * r('cast_stage_missing_hp');
    case 'tahmkench_w/magic_damage':
      return rawData('tahmkench_w', 'BaseDamage', level) + rawCoefficient('tahmkench_w', 'TotalDamage') * ap;
    case 'tahmkench_e/grey_health_maximum':
      return rawCoefficient('tahmkench_e', 'GreyHealthMaximum') * sourceHP;
    case 'tahmkench_e/grey_health_heal_value':
      return r('current_grey_health') * r('grey_health_healing_ratio');
    case 'tahmkench_r/target_max_hp_damage_ratio':
      return rawData('tahmkench_r', 'BasePercentHPDamage') + rawCoefficient('tahmkench_r', 'PercentHPDamage') * ap;
    case 'tahmkench_r/enemy_magic_damage':
      return rawData('tahmkench_r', 'BaseDamage', level)
        + (rawData('tahmkench_r', 'BasePercentHPDamage') + rawCoefficient('tahmkench_r', 'PercentHPDamage') * ap) * targetHP;
    case 'tahmkench_r/actual_cooldown_ms':
      return rawData('tahmkench_r', 'DataCooldown', level) * 1000 * r('actual_cooldown_multiplier');
    default:
      throw new Error(`没有冻结来源期望：${skillKey}/${formulaKey}`);
  }
}

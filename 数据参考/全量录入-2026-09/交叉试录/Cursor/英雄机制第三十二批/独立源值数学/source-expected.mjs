/*
 * 第三十二批独立源值期望。
 * 这里不读取候选参数；固定值和技能等级值都从传入的冻结来源绑定读取。
 * context.parameters 只承载明确标为运行输入的等级插值、属性阶段或状态值。
 */

const parts = (skillKey) => {
  const [hero, slot] = skillKey.split('_');
  return { heroId: hero === 'kaisa' ? 'Kaisa' : `${hero[0].toUpperCase()}${hero.slice(1)}`, slot: slot.toUpperCase() };
};
const entry = (binding, skillKey) => {
  const { heroId, slot } = parts(skillKey);
  const hero = binding?.heroes?.find((item) => item.id === heroId);
  const skill = hero?.skills?.find((item) => item.slot === slot);
  if (!skill) throw new Error(`SOURCE_BINDING_MISSING:${skillKey}`);
  return skill;
};
const raw = (binding, skillKey) => entry(binding, skillKey).object?.mSpell;
const dv = (binding, skillKey, name, level) => {
  const values = (raw(binding, skillKey)?.DataValues || []).find((item) => item.name === name)?.values;
  if (!Array.isArray(values) || values[level] === undefined) throw new Error(`SOURCE_DATAVALUE_MISSING:${skillKey}/${name}/${level}`);
  return values[level];
};
const effect = (binding, skillKey, index, level) => {
  const values = raw(binding, skillKey)?.mEffectAmount?.[index]?.value;
  if (!Array.isArray(values) || values[level] === undefined) throw new Error(`SOURCE_EFFECT_MISSING:${skillKey}/${index}/${level}`);
  return values[level];
};
const calc = (binding, skillKey, name) => {
  const value = raw(binding, skillKey)?.mSpellCalculations?.[name];
  if (!value) throw new Error(`SOURCE_CALCULATION_MISSING:${skillKey}/${name}`);
  return value;
};
const findPart = (node, predicate) => {
  if (!node || typeof node !== 'object') return undefined;
  if (!Array.isArray(node) && predicate(node)) return node;
  for (const child of Object.values(node)) {
    const hit = findPart(child, predicate);
    if (hit) return hit;
  }
  return undefined;
};
const requirePart = (tree, predicate, label) => {
  const hit = findPart(tree, predicate);
  if (!hit) throw new Error(`SOURCE_PART_MISSING:${label}`);
  return hit;
};
const named = (binding, skillKey, calculation, name, level) => {
  requirePart(calc(binding, skillKey, calculation), (item) => item.mDataValue === name, `${skillKey}/${calculation}/${name}`);
  return dv(binding, skillKey, name, level);
};
const coefficient = (tree, predicate, label) => requirePart(tree, predicate, label).mCoefficient;
const effectByPart = (binding, skillKey, tree, predicate, level, label) => {
  const part = requirePart(tree, predicate, label);
  // 原树 mEffectIndex 从 1 计数，绑定数组从 0 计数。
  if (!Number.isInteger(part.mEffectIndex) || part.mEffectIndex < 1) throw new Error(`SOURCE_EFFECT_INDEX_MISSING:${label}`);
  return effect(binding, skillKey, part.mEffectIndex - 1, level);
};
const runtime = (context, key) => {
  const value = context?.parameters?.[key];
  if (value === undefined || value === null) throw new Error(`MISSING_RUNTIME_INPUT:${key}`);
  return value;
};
const attribute = (context, owner, key, kind) => {
  const value = context?.attributes?.[owner]?.[key]?.[kind];
  if (value === undefined || value === null) throw new Error(`MISSING_ATTRIBUTE:${owner}.${key}.${kind}`);
  return value;
};
const textHas = (binding, skillKey, pattern, label) => {
  const text = Object.values(entry(binding, skillKey).currentTexts || {}).map((item) => item?.text || '').join('\n');
  if (!pattern.test(text)) throw new Error(`SOURCE_TEXT_LITERAL_MISSING:${label}`);
  return true;
};
const ms = (seconds) => Math.round(Number(seconds) * 1000);
const levelOf = (context) => {
  const level = Number(context?.level);
  if (!Number.isInteger(level) || level < 1) throw new Error('INVALID_SKILL_LEVEL');
  return level;
};

export function expected(skillKey, formulaKey, context, binding) {
  const level = levelOf(context);
  const adT = () => attribute(context, 'SOURCE', 'attack_damage', 'TOTAL');
  const adB = () => attribute(context, 'SOURCE', 'attack_damage', 'BONUS');
  const ap = () => attribute(context, 'SOURCE', 'ability_power', 'TOTAL');
  const msTotal = () => attribute(context, 'SOURCE', 'move_speed', 'TOTAL');
  const hpT = () => attribute(context, 'TARGET', 'hp', 'TOTAL');
  const hpM = () => attribute(context, 'TARGET', 'hp', 'MISSING');
  const key = `${skillKey}/${formulaKey}`;
  const sourceData = (skill, calculation, name) => named(binding, skill, calculation, name, level);
  const sourceTree = (skill, calculation) => calc(binding, skill, calculation);
  const baseADBonus = (skill, calculation, name = 'ADRatio') => sourceData(skill, calculation, name) * adB();
  const baseTotalAD = (skill, calculation, name) => sourceData(skill, calculation, name) * adT();
  const baseAP = (skill, calculation, name) => sourceData(skill, calculation, name) * ap();

  switch (key) {
    case 'corki_p/basic_attack_extra_true_damage': {
      const tree = sourceTree('corki_p', 'BasicAttackTOOLTIP');
      return sourceData('corki_p', 'BasicAttackTOOLTIP', requirePart(tree, (x) => x.mDataValue === 'AttackConversion', 'Corki P AttackConversion').mDataValue) * adT();
    }
    case 'corki_p/critical_extra_true_damage': {
      const basic = expected('corki_p', 'basic_attack_extra_true_damage', context, binding);
      const multiplier = sourceTree('corki_p', 'CriticalStrikeTOOLTIP').mMultiplier;
      return basic * coefficient(multiplier, (x) => x.mStat === 9, 'Corki P critical mStat9') * runtime(context, 'actual_critical_damage_ratio');
    }
    case 'corki_q/magic_damage': return sourceData('corki_q', 'TotalDamage', 'BaseDamage') + baseADBonus('corki_q', 'TotalDamage') + baseAP('corki_q', 'TotalDamage', 'APRatio');
    case 'corki_w/maximum_magic_damage': return sourceData('corki_w', 'MaximumDamage', 'BaseDamage') + baseAP('corki_w', 'MaximumDamage', 'APRatio') + baseADBonus('corki_w', 'MaximumDamage');
    case 'corki_w/dash_speed': return sourceData('corki_w', 'DashSpeed', 'DashSpeedBase') + sourceData('corki_w', 'DashSpeed', 'DashSpeedRatio') * msTotal();
    case 'corki_e/physical_damage': return sourceData('corki_e', 'TotalDamage', 'BaseDamage') + baseADBonus('corki_e', 'TotalDamage');
    case 'corki_r/small_missile_damage': return sourceData('corki_r', 'RSmallMissileDamage', 'BaseDamage') + baseADBonus('corki_r', 'RSmallMissileDamage');
    case 'corki_r/big_missile_damage': return expected('corki_r', 'small_missile_damage', context, binding) * sourceData('corki_r', 'RBigMissileDamage', 'RBigOneMultiplier');
    case 'corki_r/attack_refund_seconds': {
      const tree = sourceTree('corki_r', 'AttackRefund');
      const multiplier = sourceData('corki_r', 'AttackRefund', 'CDReductionOnHit');
      const unit = requirePart(tree, (x) => x.mNumber === 1, 'Corki R refund unit').mNumber;
      const stat = coefficient(tree, (x) => x.mStat === 8, 'Corki R refund mStat8');
      return multiplier * (unit + stat * runtime(context, 'attack_refund_mstat8_value'));
    }
    case 'kaisa_p/base_plasma_damage': return (runtime(context, 'base_damage_by_character_level') + sourceData('kaisa_p', 'PBaseDamage', 'PAPRatioBase') * ap()) * sourceData('kaisa_p', 'PBaseDamage', 'PTotalDamageMultiplier_ForModesBalance');
    case 'kaisa_p/per_stack_plasma_damage': return (runtime(context, 'per_stack_damage_by_character_level') + sourceData('kaisa_p', 'PCurrentPerStackDamage', 'PAPRatioPerStack') * ap()) * sourceData('kaisa_p', 'PCurrentPerStackDamage', 'PTotalDamageMultiplier_ForModesBalance');
    case 'kaisa_p/plasma_attack_damage': return expected('kaisa_p', 'base_plasma_damage', context, binding) + expected('kaisa_p', 'per_stack_plasma_damage', context, binding) * runtime(context, 'current_stack_count');
    case 'kaisa_p/execute_percentage': return sourceData('kaisa_p', 'PExecutePercentage', 'PExecuteRatio') + sourceData('kaisa_p', 'PExecutePercentage', 'PExecuteAPRatio') * ap();
    case 'kaisa_p/execute_missing_health_damage': return expected('kaisa_p', 'execute_percentage', context, binding) * hpM();
    case 'kaisa_q/individual_missile_damage': return sourceData('kaisa_q', 'TotalIndividualMissileDamage', 'BaseDamage') + baseADBonus('kaisa_q', 'TotalIndividualMissileDamage', 'BonusADRatio') + baseAP('kaisa_q', 'TotalIndividualMissileDamage', 'APRatio');
    case 'kaisa_q/subsequent_missile_damage': return expected('kaisa_q', 'individual_missile_damage', context, binding) * dv(binding, 'kaisa_q', 'ExtraHitReduction', level);
    case 'kaisa_q/normal_max_damage': {
      const tree = sourceTree('kaisa_q', 'MaxDamageTotal');
      const hits = tree.mFormulaParts?.[0]?.mSubparts?.[1]?.mPart1?.mPart2?.mNumber;
      if (hits === undefined) throw new Error('SOURCE_PART_MISSING:Kaisa Q normal max hit count');
      return expected('kaisa_q', 'individual_missile_damage', context, binding) * (1 + hits * sourceData('kaisa_q', 'MaxDamageTotal', 'ExtraHitReduction'));
    }
    case 'kaisa_q/evolved_max_damage': {
      const tree = sourceTree('kaisa_q', '{b2bd0d2f}');
      const hits = tree.mFormulaParts?.[0]?.mSubparts?.[1]?.mPart1?.mPart2?.mNumber;
      if (hits === undefined) throw new Error('SOURCE_PART_MISSING:Kaisa Q evolved max hit count');
      return expected('kaisa_q', 'individual_missile_damage', context, binding) * (1 + hits * sourceData('kaisa_q', '{b2bd0d2f}', 'ExtraHitReduction'));
    }
    case 'kaisa_w/magic_damage': {
      const tree = sourceTree('kaisa_w', 'TotalDamage');
      const base = effectByPart(binding, 'kaisa_w', tree, (x) => x.mEffectIndex === 1, level, 'Kaisa W base effect');
      const ad = coefficient(tree, (x) => x.mStat === 2, 'Kaisa W total AD coefficient');
      const ability = coefficient(tree, (x) => x.mStat === undefined && x.mCoefficient !== undefined, 'Kaisa W AP coefficient');
      return base + ad * adT() + ability * ap();
    }
    case 'kaisa_e/total_move_speed_ratio': {
      const tree = sourceTree('kaisa_e', 'TotalMovespeed');
      const base = effectByPart(binding, 'kaisa_e', tree, (x) => x.mEffectIndex === 1, level, 'Kaisa E base move speed');
      const clamp = tree.mFormulaParts?.[0];
      const stat = requirePart(clamp, (x) => x.mStat === 4 && x.mStatFormula === 2, 'Kaisa E bonus AS');
      const lower = clamp?.mFloor;
      const upper = clamp?.mCeiling;
      if (lower === undefined || upper === undefined) throw new Error('SOURCE_CLAMP_MISSING:Kaisa E move speed');
      const unit = requirePart(clamp, (x) => x.mNumber === 1, 'Kaisa E move speed unit').mNumber;
      return base * Math.min(upper, Math.max(lower, unit + stat.mCoefficient * runtime(context, 'actual_bonus_attack_speed_ratio')));
    }
    case 'kaisa_e/total_cast_time_ms': {
      const tree = sourceTree('kaisa_e', 'TotalCastTime');
      const clamp = tree.mFormulaParts?.[0];
      const floor = clamp?.mFloor;
      const base = effectByPart(binding, 'kaisa_e', tree, (x) => x.mEffectIndex === 3, level, 'Kaisa E cast base');
      const coefficientMs = coefficient(clamp, (x) => x.mStat === 4 && x.mCoefficient !== undefined, 'Kaisa E cast AS coefficient');
      if (floor === undefined) throw new Error('SOURCE_CLAMP_MISSING:Kaisa E cast time');
      return ms(Math.max(floor, base + coefficientMs * runtime(context, 'actual_attack_speed_stat')));
    }
    case 'kaisa_r/shield_value': return sourceData('kaisa_r', 'RCalculatedShieldValue', 'RBaseValue') + baseTotalAD('kaisa_r', 'RCalculatedShieldValue', 'RTotalADRatio') + baseAP('kaisa_r', 'RCalculatedShieldValue', 'RAPRatio');
    case 'xayah_q/single_dagger_damage': return sourceData('xayah_q', 'TotalDamage', 'BaseDamage') + coefficient(sourceTree('xayah_q', 'TotalDamage'), (x) => x.mStat === 2 && x.mStatFormula === 2, 'Xayah Q bonus AD') * adB();
    case 'xayah_q/two_dagger_damage': {
      textHas(binding, 'xayah_q', /两把匕首/, 'Xayah Q two daggers');
      return expected('xayah_q', 'single_dagger_damage', context, binding) * 2;
    }
    case 'xayah_e/base_feather_damage': return sourceData('xayah_e', 'FeatherDamage', 'BaseDamage') + dv(binding, 'xayah_e', 'bADRatio', level) * adB();
    case 'xayah_e/critical_multiplier': {
      const multiplier = sourceTree('xayah_e', 'FeatherDamage').mMultiplier;
      const one = requirePart(multiplier, (x) => x.mNumber === 1, 'Xayah E critical unit').mNumber;
      const critRatio = sourceData('xayah_e', 'FeatherDamage', requirePart(multiplier, (x) => x.mStat === 8 && x.mDataValue, 'Xayah E CritRatio').mDataValue);
      const critCoefficient = coefficient(multiplier, (x) => x.mStat === 9, 'Xayah E mStat9') ;
      return one + critRatio * runtime(context, 'actual_critical_chance_ratio') * (critCoefficient * runtime(context, 'actual_critical_damage_ratio') - one);
    }
    case 'xayah_e/feather_damage_before_falloff': return expected('xayah_e', 'base_feather_damage', context, binding) * expected('xayah_e', 'critical_multiplier', context, binding);
    case 'xayah_e/feather_falloff_multiplier': {
      const tree = sourceTree('xayah_e', 'FeatherDamage');
      const one = requirePart(tree, (x) => x.mNumber === 1, 'Xayah E falloff unit').mNumber;
      const minimum = textHas(binding, 'xayah_e', /最低降至10%/, 'Xayah E minimum falloff') ? 0.1 : undefined;
      const falloff = dv(binding, 'xayah_e', 'FeatherFalloff', level);
      return Math.max(minimum, one - falloff * (runtime(context, 'feather_sequence_index') - one));
    }
    case 'xayah_e/feather_damage': return expected('xayah_e', 'feather_damage_before_falloff', context, binding) * expected('xayah_e', 'feather_falloff_multiplier', context, binding);
    case 'xayah_r/physical_damage': return sourceData('xayah_r', 'Damage', 'RBaseDamage') + coefficient(sourceTree('xayah_r', 'Damage'), (x) => x.mStat === 2 && x.mStatFormula === 2, 'Xayah R bonus AD') * adB();
    case 'zeri_p/unenergized_magic_damage': return runtime(context, 'q_min_damage_level_base') + coefficient(sourceTree('zeri_q', 'MinDamage'), (x) => x.mCoefficient !== undefined, 'Zeri Q minimum AP') * ap();
    case 'zeri_p/execute_threshold': return runtime(context, 'q_passive_execute_threshold_level_base') + coefficient(sourceTree('zeri_q', 'PassiveExecuteThreshold'), (x) => x.mCoefficient !== undefined, 'Zeri Q threshold AP') * ap();
    case 'zeri_p/passive_max_damage': return runtime(context, 'q_passive_max_damage_level_base') + coefficient(sourceTree('zeri_q', 'PassiveMaxDamage'), (x) => x.mCoefficient !== undefined, 'Zeri Q maximum AP') * ap();
    case 'zeri_p/full_charge_magic_damage': return expected('zeri_p', 'passive_max_damage', context, binding) + runtime(context, 'q_passive_max_charge_hp_ratio') * hpT();
    case 'zeri_q/active_physical_damage': return sourceData('zeri_q', 'ActiveDamageThatCanCrit', 'BaseDamage') + baseTotalAD('zeri_q', 'ActiveDamageThatCanCrit', 'ActiveADRatio');
    case 'zeri_w/normal_physical_damage': return sourceData('zeri_w', 'TotalDamage', 'Damage') + baseTotalAD('zeri_w', 'TotalDamage', 'ADRatio') + baseAP('zeri_w', 'TotalDamage', 'APRatio');
    case 'zeri_w/wall_physical_damage': {
      const tree = sourceTree('zeri_w', 'WallDamage');
      const multiplier = tree.mMultiplier;
      const one = requirePart(multiplier, (x) => x.mNumber === 1, 'Zeri W wall unit').mNumber;
      const critical = sourceData('zeri_w', 'WallDamage', requirePart(multiplier, (x) => x.mDataValue === 'CriticalEffectiveness', 'Zeri W critical effect').mDataValue);
      const coefficientCrit = coefficient(multiplier, (x) => x.mStat === 9, 'Zeri W mStat9');
      return expected('zeri_w', 'normal_physical_damage', context, binding) * (one + critical * (coefficientCrit * runtime(context, 'actual_critical_damage_ratio') - one));
    }
    case 'zeri_e/bonus_magic_damage': {
      const tree = sourceTree('zeri_e', 'BonusDamageTotal');
      const multiplier = tree.mMultiplier;
      const one = requirePart(multiplier, (x) => x.mNumber === 1, 'Zeri E critical unit').mNumber;
      const critScaling = sourceData('zeri_e', 'BonusDamageTotal', requirePart(multiplier, (x) => x.mDataValue === 'CritScalingMod', 'Zeri E CritScalingMod').mDataValue);
      const critCoefficient = coefficient(multiplier, (x) => x.mStat === 9, 'Zeri E mStat9');
      return (sourceData('zeri_e', 'BonusDamageTotal', 'BonusDamageBase') + baseAP('zeri_e', 'BonusDamageTotal', 'BonusAPRatio')) * (one + critScaling * runtime(context, 'actual_critical_chance_ratio') * (critCoefficient * runtime(context, 'actual_critical_damage_ratio') - one));
    }
    case 'zeri_e/dash_speed': {
      const tree = sourceTree('zeri_e', 'DashSpeed');
      const base = requirePart(tree, (x) => x.mNumber === 600, 'Zeri E dash base').mNumber;
      const speed = coefficient(tree, (x) => x.mStat === 7, 'Zeri E move speed');
      return base + speed * msTotal();
    }
    case 'zeri_r/active_magic_damage': return sourceData('zeri_r', 'TotalActiveDamage', 'ActiveDamage') + coefficient(sourceTree('zeri_r', 'TotalActiveDamage'), (x) => x.mStat === undefined && x.mCoefficient !== undefined, 'Zeri R AP') * ap() + coefficient(sourceTree('zeri_r', 'TotalActiveDamage'), (x) => x.mStat === 2 && x.mStatFormula === 2, 'Zeri R bonus AD') * adB();
    case 'zeri_r/hypercharge_move_speed_ratio': return dv(binding, 'zeri_r', 'MSPercent', level) * runtime(context, 'current_hypercharge_stack_count');
    default: throw new Error(`SOURCE_EXPECTED_MISSING:${key}`);
  }
}

export default expected;

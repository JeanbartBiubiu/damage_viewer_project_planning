import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 这个模块只从冻结来源树取固定值和等级值；不读取第33批候选文件。
const here = path.dirname(fileURLToPath(import.meta.url));
const inputDir = path.resolve(here, '..', 'hero33-root-entry-20260910');
const frozenBinding = JSON.parse(fs.readFileSync(path.join(inputDir, '来源绑定与当前文本.json'), 'utf8'));
const heroByPrefix = Object.freeze({ sona: 'Sona', soraka: 'Soraka', karma: 'Karma', seraphine: 'Seraphine' });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceSpell(skillKey, binding) {
  const heroId = heroByPrefix[skillKey.split('_')[0]];
  assert(heroId, `未知技能来源：${skillKey}`);
  const hero = (binding?.heroes ?? []).find((item) => item.id === heroId);
  const skill = hero?.skills?.find((item) => item.skillKey === skillKey);
  assert(skill?.object?.mSpell, `来源树缺少技能：${skillKey}`);
  return skill.object.mSpell;
}

function dataValues(skillKey, name, binding) {
  const hit = (sourceSpell(skillKey, binding).DataValues ?? []).find((item) => item.name === name);
  assert(Array.isArray(hit?.values), `来源值缺失：${skillKey}/${name}`);
  return hit.values;
}

// DataValues 的第0项是占位项，技能等级从数组下标1开始。
function sourceValue(skillKey, name, level, binding) {
  assert(Number.isInteger(level) && level >= 1, `技能等级无效：${skillKey}/${level}`);
  const values = dataValues(skillKey, name, binding);
  const value = values[level];
  assert(typeof value === 'number' && Number.isFinite(value), `来源等级值无效：${skillKey}/${name}/${level}`);
  return value;
}

function walkNumeric(node, field, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (typeof node[field] === 'number' && Number.isFinite(node[field])) result.push(node[field]);
  for (const [key, child] of Object.entries(node)) {
    if (key !== field && child && typeof child === 'object') walkNumeric(child, field, result);
  }
  return result;
}

function calculation(skillKey, name, binding) {
  const calculation = sourceSpell(skillKey, binding).mSpellCalculations?.[name];
  assert(calculation && typeof calculation === 'object', `计算树缺失：${skillKey}/${name}`);
  return calculation;
}

function calculationNumber(skillKey, name, binding) {
  const value = walkNumeric(calculation(skillKey, name, binding), 'mNumber')[0];
  assert(value !== undefined, `计算树数字缺失：${skillKey}/${name}`);
  return value;
}

function calculationCoefficient(skillKey, name, binding) {
  const value = walkNumeric(calculation(skillKey, name, binding), 'mCoefficient')[0];
  assert(value !== undefined, `计算树系数缺失：${skillKey}/${name}`);
  return value;
}

function sourceAttribute(context, owner, key, valueKind) {
  const attributeKey = `${owner}:${key}:${valueKind}`;
  const attributes = context?.attributes;
  assert(attributes && Object.hasOwn(attributes, attributeKey), `属性输入缺失：${attributeKey}`);
  const value = attributes[attributeKey];
  assert(typeof value === 'number' && Number.isFinite(value), `属性输入无效：${attributeKey}`);
  return value;
}

function runtime(context, key) {
  const parameters = context?.parameters;
  assert(parameters && Object.hasOwn(parameters, key), `运行输入缺失：${key}`);
  const value = parameters[key];
  assert(typeof value === 'number' && Number.isFinite(value), `运行输入无效：${key}`);
  return value;
}

function sourceRatio(skillKey, dataName, level, binding) {
  return sourceValue(skillKey, dataName, level, binding);
}

function requireContext(skillKey, context) {
  assert(context?.skillKey === skillKey, `期望上下文技能不符：${context?.skillKey}/${skillKey}`);
  assert(Number.isInteger(context.level) && context.level >= 1, `期望上下文等级无效：${skillKey}/${context?.level}`);
}

/**
 * 用冻结客户端计算树、DataValues 和当前正文绑定重建指定公式期望值。
 * context.parameters 只允许提供实际运行输入；固定值和等级值不从候选复制。
 */
export function expected(skillKey, formulaKey, context, binding = frozenBinding) {
  requireContext(skillKey, context);
  const level = context.level;
  const AP = () => sourceAttribute(context, 'SOURCE', 'ability_power', 'TOTAL');
  const d = (key, name) => sourceValue(key, name, level, binding);
  const calc = (key, name) => calculationCoefficient(key, name, binding);
  const percent = (key, name) => sourceRatio(key, name, level, binding);
  switch (formulaKey) {
    case 'accelerando_current_ability_haste':
      return Math.min(sourceValue('sona_p', 'AccelerandoCap', 1, binding), sourceValue('sona_p', 'AccelerandoAHPerStack', 1, binding) * runtime(context, 'accelerando_current_stacks'));
    case 'power_chord_bonus_magic_damage':
      return runtime(context, 'power_chord_character_level_base_damage') + calc('sona_p', 'PowerChordDamage') * AP();
    case 'magic_damage':
      if (skillKey === 'sona_q') return d('sona_q', 'BaseDamage') + calc('sona_q', 'TotalDamage') * AP();
      if (skillKey === 'sona_r') return d('sona_r', 'BaseDamage') + calc('sona_r', 'TotalDamage') * AP();
      if (skillKey === 'soraka_q') return d('soraka_q', 'BaseDamage') + calc('soraka_q', 'TotalDamage') * AP();
      if (skillKey === 'soraka_e') return d('soraka_e', 'BaseDamage') + calc('soraka_e', 'TotalDamage') * AP();
      if (skillKey === 'karma_q') return d('karma_q', 'BaseDamage') + percent('karma_q', 'APRatio') * AP();
      if (skillKey === 'seraphine_q') return d('seraphine_q', 'BaseDamage') + percent('seraphine_q', 'APRatio') * AP();
      if (skillKey === 'seraphine_e') return d('seraphine_e', 'BaseDamage') + percent('seraphine_e', 'APRatio') * AP();
      if (skillKey === 'seraphine_r') return d('seraphine_r', 'R1BaseDamage') + percent('seraphine_r', 'R1APRatio') * AP();
      throw new Error(`未定义魔法伤害来源：${skillKey}`);
    case 'melody_attack_magic_damage':
      return d('sona_q', 'BaseOnHitDamage') + percent('sona_q', 'OnHitRatio') * AP();
    case 'chord_magic_damage':
      return runtime(context, 'chord_character_level_base_damage') + calc('sona_q', 'TotalStaccatoDamage') * AP();
    case 'self_heal':
      if (skillKey === 'soraka_r') return d('soraka_r', 'BaseHeal') + calc('soraka_r', 'HealingCalc') * AP();
      return d('sona_w', 'BaseHeal') + percent('sona_w', 'HealRatio') * AP();
    case 'shield_value':
      if (skillKey === 'sona_w') return d('sona_w', 'BaseShield') + percent('sona_w', 'ShieldRatio') * AP();
      if (skillKey === 'karma_e') return d('karma_e', 'BaseShield') + percent('karma_e', 'ShieldRatio') * AP();
      if (skillKey === 'seraphine_w') return percent('seraphine_w', 'ShieldAmpForSeraphine') * (d('seraphine_w', 'ShieldStrength') + percent('seraphine_w', 'ShieldAPRatio') * AP());
      throw new Error(`未定义护盾来源：${skillKey}`);
    case 'diminuendo_damage_reduction_ratio':
      return calculationNumber('sona_w', 'TotalDiminuendoWeakenPercent', binding) + calc('sona_w', 'TotalDiminuendoWeakenPercent') * AP();
    case 'self_move_speed_ratio_value':
      if (skillKey === 'sona_e') return d('sona_e', 'SelfBaseMovementSpeed') + calc('sona_e', 'TotalSelfMovementSpeed') * AP();
      if (skillKey === 'seraphine_w') return d('seraphine_w', 'WMSBonus') + percent('seraphine_w', 'WMSBonusAPRatio') * AP();
      throw new Error(`未定义自身移速来源：${skillKey}`);
    case 'tempo_slow_ratio':
      return calculationNumber('sona_e', 'TotalTempoMoveSpeedSlow', binding) + calc('sona_e', 'TotalTempoMoveSpeedSlow') * AP();
    case 'self_heal_total':
      return d('soraka_q', 'BaseHoT') + percent('soraka_q', 'HealAPRatio') * AP();
    case 'self_low_health_heal':
      return (d('soraka_r', 'BaseHeal') + calc('soraka_r', 'HealingCalc') * AP()) * (1 + percent('soraka_r', 'HealingAmpForLowHealthAllies'));
    case 'initial_magic_damage':
      return d('karma_w', 'BaseDamage') + percent('karma_w', 'APRatio') * AP();
    case 'rq_impact_magic_damage':
      return d('karma_r', 'QBonusDamage') + percent('karma_r', 'QBonusAPRatio') * AP();
    case 'rq_field_magic_damage':
      return d('karma_r', 'QDetonationDamage') + percent('karma_r', 'QDetonationAPRatio') * AP();
    case 'rw_heal_ratio':
      return calculationNumber('karma_r', 'RWHealAmount', binding) * (percent('karma_r', 'RWBaseHeal') + percent('karma_r', 'RWHealRatio') * AP());
    case 'rw_open_heal':
      return runtime(context, 'rw_open_missing_health') * (calculationNumber('karma_r', 'RWHealAmount', binding) * (percent('karma_r', 'RWBaseHeal') + percent('karma_r', 'RWHealRatio') * AP()));
    case 'rw_close_heal':
      return runtime(context, 'rw_close_missing_health') * (calculationNumber('karma_r', 'RWHealAmount', binding) * (percent('karma_r', 'RWBaseHeal') + percent('karma_r', 'RWHealRatio') * AP()));
    case 're_bonus_shield_value':
      return d('karma_r', 'EBonusShield') + percent('karma_r', 'EBonusShieldRatio') * AP();
    case 'note_magic_damage':
      return runtime(context, 'note_character_level_base_damage') + percent('seraphine_p', 'NoteAPRatio') * AP();
    case 'total_note_magic_damage':
      return runtime(context, 'current_note_count') * (runtime(context, 'note_character_level_base_damage') + percent('seraphine_p', 'NoteAPRatio') * AP());
    case 'low_health_max_magic_damage':
      return (d('seraphine_q', 'BaseDamage') + percent('seraphine_q', 'APRatio') * AP()) * calculationNumber('seraphine_q', 'TotalEmpoweredDamage', binding);
    case 'self_missing_health_heal':
      return (percent('seraphine_w', 'WMissingHPBase') / 100) * runtime(context, 'self_missing_health');
    default:
      throw new Error(`未定义公式来源：${skillKey}/${formulaKey}`);
  }
}

export const sourceBinding = frozenBinding;

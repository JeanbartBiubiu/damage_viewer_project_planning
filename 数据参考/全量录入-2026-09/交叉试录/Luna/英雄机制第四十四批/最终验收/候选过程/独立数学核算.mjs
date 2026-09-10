import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT = [path.resolve(HERE, "..", "hero44-root-entry-20260910"), path.resolve(HERE, "..", "..", "hero44-root-entry-20260910")].find(candidate => fs.existsSync(candidate));
if (!INPUT) throw new Error("找不到第四十四批冻结输入目录");
const DURABLE = path.resolve("C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十四批");
const OUTPUT_DURABLE = process.env.HERO44_MATH_DURABLE_DIR ? path.resolve(process.env.HERO44_MATH_DURABLE_DIR) : DURABLE;
const CANDIDATE_FILE = path.join(HERE, "完整候选.json");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const shaFile = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 1e-6 * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b))) + 1e-7;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const candidate = readJson(CANDIDATE_FILE);
const binding = readJson(path.join(INPUT, "来源绑定与当前文本.json"));
const sourceSkills = Object.fromEntries(binding.heroes.map(hero => [hero.id, Object.fromEntries(hero.skills.map(skill => [skill.slot, skill]))]));
const reusedPublic = new Set((candidate.reusedPublicParameters || []).map(item => item.skillKey + "/" + item.parameterKey));
const rawSpell = (heroId, slot) => sourceSkills[heroId][slot].object.mSpell;
const rawValues = (heroId, slot, name) => {
  const value = (rawSpell(heroId, slot).DataValues || []).find(row => row.name === name)?.values;
  assert(Array.isArray(value), `缺少原始数据值 ${heroId}/${slot}/${name}`);
  return value;
};
const rawAt = (heroId, slot, name, index) => rawValues(heroId, slot, name)[index];
const rawCalc = (heroId, slot, name) => {
  const value = rawSpell(heroId, slot).mSpellCalculations?.[name];
  assert(value, `缺少原始计算树 ${heroId}/${slot}/${name}`);
  return value;
};
const rawPart = (heroId, slot, calcName, index = 0) => rawCalc(heroId, slot, calcName).mFormulaParts[index];
const coefficient = (heroId, slot, calcName, index = 1) => {
  const value = rawPart(heroId, slot, calcName, index)?.mCoefficient;
  assert(typeof value === "number", `原始树没有系数 ${heroId}/${slot}/${calcName}/${index}`);
  return value;
};
const toMs = seconds => Math.round(Number(seconds) * 1000);
const sourceSkill = key => candidate.skills[key];
const parameter = (key, parameterKey) => {
  const value = sourceSkill(key).write.parameters.find(item => item.parameterKey === parameterKey);
  assert(value, `候选缺少参数 ${key}/${parameterKey}`);
  return value;
};
const attrKey = (owner, key, kind) => `${owner}.${key}.${kind}`;
const resolveParameter = (key, parameterKey, context) => {
  const item = parameter(key, parameterKey);
  if (item.valueMode === "FIXED") return item.fixedValue;
  if (item.valueMode === "SKILL_LEVEL") {
    const value = item.levelValues?.[String(context.skillLevel)];
    assert(value !== undefined, `缺少技能等级输入 ${key}/${parameterKey}`);
    return value;
  }
  if (item.valueMode === "CHARACTER_LEVEL") {
    const value = item.levelValues?.[String(context.characterLevel)];
    assert(value !== undefined, `缺少角色等级输入 ${key}/${parameterKey}`);
    return value;
  }
  if (item.valueMode === "RUNTIME_INPUT") {
    const value = context.runtime?.[parameterKey];
    assert(value !== undefined && value !== null, `缺少运行输入 ${key}/${parameterKey}`);
    assert(Number.isFinite(Number(value)), `运行输入不是有限数值 ${key}/${parameterKey}`);
    return value;
  }
  throw new Error(`未知参数模式 ${key}/${parameterKey}/${item.valueMode}`);
};
const evaluate = (key, node, context) => {
  assert(node && typeof node === "object", `空表达式 ${key}`);
  if (node.nodeType === "PARAMETER") return resolveParameter(key, node.parameterKey, context);
  if (node.nodeType === "ATTRIBUTE") {
    const value = context.attributes?.[attrKey(node.attributeOwner, node.attributeKey, node.attributeValueKind)];
    assert(value !== undefined && value !== null, `缺少属性输入 ${key}/${attrKey(node.attributeOwner, node.attributeKey, node.attributeValueKind)}`);
    assert(Number.isFinite(Number(value)), `属性输入不是有限数值 ${key}/${attrKey(node.attributeOwner, node.attributeKey, node.attributeValueKind)}`);
    return value;
  }
  if (node.nodeType === "OPERATION") {
    assert(Array.isArray(node.operands) && node.operands.length === 2, `运算不是双目 ${key}/${node.operation}`);
    const left = evaluate(key, node.operands[0], context);
    const right = evaluate(key, node.operands[1], context);
    if (node.operation === "ADD") return Number(left) + Number(right);
    if (node.operation === "SUBTRACT") return Number(left) - Number(right);
    if (node.operation === "MULTIPLY") return Number(left) * Number(right);
    if (node.operation === "DIVIDE") return Number(left) / Number(right);
    if (node.operation === "MIN") return Math.min(Number(left), Number(right));
    if (node.operation === "MAX") return Math.max(Number(left), Number(right));
    throw new Error(`不支持的运算 ${key}/${node.operation}`);
  }
  throw new Error(`不支持的表达式节点 ${key}/${node.nodeType}`);
};
const formula = (key, formulaKey) => {
  const item = sourceSkill(key).write.formulas.find(value => value.formulaKey === formulaKey);
  assert(item, `候选缺少公式 ${key}/${formulaKey}`);
  return item;
};
const context = ({ skillLevel = 1, characterLevel = 1, ap = 100, ad = 100, bonusAd = ad, hp = 1000, moveSpeed = 300, targetHp = 1000, runtime = {} } = {}) => ({
  skillLevel, characterLevel, runtime,
  attributes: {
    [attrKey("SOURCE", "ability_power", "TOTAL")]: ap,
    [attrKey("SOURCE", "attack_damage", "TOTAL")]: ad,
    [attrKey("SOURCE", "attack_damage", "BONUS")]: bonusAd,
    [attrKey("SOURCE", "hp", "TOTAL")]: hp,
    [attrKey("SOURCE", "move_speed", "TOTAL")]: moveSpeed,
    [attrKey("TARGET", "hp", "TOTAL")]: targetHp,
  },
});
const rawBreakpoint = (heroId, slot, calcName, level) => {
  const part = rawPart(heroId, slot, calcName);
  assert(typeof part?.mLevel1Value === "number", `断点原树缺少1级值 ${heroId}/${slot}/${calcName}`);
  let value = part.mLevel1Value;
  const points = (part.mBreakpoints || []).slice().sort((a, b) => a.mLevel - b.mLevel);
  for (let current = 2; current <= level; current += 1) {
    const slope = points.filter(point => point.mLevel <= current - 1 && typeof point.mBonusPerLevelAtAndAfter === "number").at(-1);
    value += slope ? slope.mBonusPerLevelAtAndAfter : (part.mInitialBonusPerLevel || 0);
    for (const point of points) if (point.mLevel === current) value += point.mAdditionalBonusAtThisLevel || 0;
  }
  return value;
};
const interpolation = (heroId, slot, calcName, level) => {
  const part = rawPart(heroId, slot, calcName);
  assert(typeof part?.mStartValue === "number" && typeof part?.mEndValue === "number", `插值树缺少端点 ${heroId}/${slot}/${calcName}`);
  return part.mStartValue + (part.mEndValue - part.mStartValue) * (level - 1) / 17;
};
const heroSlot = key => {
  const [hero, slot] = key.split("_");
  const heroId = hero === "monkeyking" ? "MonkeyKing" : hero[0].toUpperCase() + hero.slice(1);
  return [heroId, slot.toUpperCase()];
};
const rawExpected = (key, formulaKey, c) => {
  const [hero, slot] = heroSlot(key);
  const level = c.skillLevel;
  const ap = c.attributes[attrKey("SOURCE", "ability_power", "TOTAL")];
  const ad = c.attributes[attrKey("SOURCE", "attack_damage", "TOTAL")];
  const hp = c.attributes[attrKey("SOURCE", "hp", "TOTAL")];
  const targetHp = c.attributes[attrKey("TARGET", "hp", "TOTAL")];
  if (key === "illaoi_p") return rawAt(hero, slot, "MissingHPPercentHeal", 1) * c.runtime.missing_hp_at_slam;
  if (key === "illaoi_q") {
    const amp = rawAt(hero, slot, "TentacleDamageAmp", level);
    const core = c.runtime.tentacle_damage_base_at_character_level + rawAt(hero, slot, "TotalADRatio", 1) * ad + rawAt(hero, slot, "APRatio", 1) * ap;
    return (1 + amp) * core;
  }
  if (key === "illaoi_w") {
    const ratio = rawAt(hero, slot, "HealthPercentDamage", level) * 0.01 + rawAt(hero, slot, "HealthDamageADRatio", 1) * ad * 0.01;
    if (formulaKey === "health_percent_ratio") return ratio;
    if (formulaKey === "minimum_damage") return rawAt(hero, slot, "WMinDamage", level);
    if (formulaKey === "dash_speed") return rawAt(hero, slot, "DashSpeedBonus", 1) + c.attributes[attrKey("SOURCE", "move_speed", "TOTAL")];
    return Math.max(rawAt(hero, slot, "WMinDamage", level), targetHp * ratio);
  }
  if (key === "illaoi_r") return rawAt(hero, slot, "BaseDamage", level) + coefficient(hero, slot, "DamageCalc", 1) * c.attributes[attrKey("SOURCE", "attack_damage", "BONUS")];
  if (key === "monkeyking_p") {
    if (formulaKey === "bonus_armor") return c.runtime.bonus_armor_at_character_level;
    if (formulaKey === "tooltip_max_armor") return c.runtime.bonus_armor_at_character_level * rawAt(hero, slot, "TooltipMult", 1);
    if (formulaKey === "max_health_regen_per_tick") return rawAt(hero, slot, "HealthPercentPer5", 1) * hp * (1 + rawAt(hero, slot, "StackMultiplier", 1) * rawAt(hero, slot, "MaxStacks", 1));
    return rawAt(hero, slot, "HealthPercentPer5", 1) * hp;
  }
  if (key === "monkeyking_q") {
    if (formulaKey === "damage") return rawAt(hero, slot, "BaseDamage", level) + rawAt(hero, slot, "ADRatio", 1) * c.attributes[attrKey("SOURCE", "attack_damage", "BONUS")];
    return rawAt(hero, slot, "ArmorShredPercent", level);
  }
  if (key === "monkeyking_e") {
    if (formulaKey === "damage") return rawAt(hero, slot, "BaseDamage", level) + coefficient(hero, slot, "TotalDamage", 1) * ap;
    return rawAt(hero, slot, "AttackSpeed", level);
  }
  if (key === "monkeyking_r") {
    const perSecond = rawAt(hero, slot, "BasePercentMaxHPDmgPerSec", level) * targetHp + rawAt(hero, slot, "ADRatioPerSecond", 1) * ad;
    if (formulaKey === "damage_per_second") return perSecond;
    if (formulaKey === "damage_per_tick") return perSecond * rawAt(hero, slot, "SecondsPerTick", 1);
    return perSecond * rawAt(hero, slot, "SpinDuration", 1);
  }
  if (key === "neeko_q") {
    if (formulaKey === "first_damage") return rawAt(hero, slot, "ZoneDamage", level) + coefficient(hero, slot, "ExplosionDamage", 1) * ap;
    return rawAt(hero, slot, "SecondaryDamage", level) + coefficient(hero, slot, "SecondDamage", 1) * ap;
  }
  if (key === "neeko_w") {
    if (formulaKey === "passive_damage") return rawAt(hero, slot, "PassiveDamage", level) + rawAt(hero, slot, "APRatio", 1) * ap;
    if (formulaKey === "passive_move_speed") return rawAt(hero, slot, "PassiveHaste", level) * 0.01;
    return rawAt(hero, slot, "Haste", level) * 0.01;
  }
  if (key === "neeko_e") {
    if (formulaKey === "damage") return rawAt(hero, slot, "Damage", level) + coefficient(hero, slot, "BaseDamage", 1) * ap;
    return toMs(rawAt(hero, slot, "MinRootDuration", level));
  }
  if (key === "neeko_r") return rawAt(hero, slot, "Damage", level) + coefficient(hero, slot, "TotalDamage", 1) * ap;
  if (key === "yuumi_p") return c.runtime.heal_base_at_character_level + coefficient(hero, slot, "HealAmount", 1) * ap;
  if (key === "yuumi_q") {
    if (formulaKey === "normal_damage") return rawAt(hero, slot, "MissileDamage", level) + rawAt(hero, slot, "APRatio", 1) * ap;
    return rawAt(hero, slot, "EmpoweredMissileDamage", level) + rawAt(hero, slot, "EmpoweredAPRatio", 1) * ap;
  }
  if (key === "yuumi_w") throw new Error("悠米W本批无可录公式");
  if (key === "yuumi_e") {
    if (formulaKey === "shield_value") return rawAt(hero, slot, "BaseShielding", level) + rawAt(hero, slot, "APRatio", 1) * ap;
    if (formulaKey === "attack_speed_ratio") return (rawAt(hero, slot, "AttackSpeedAmount", level) + coefficient(hero, slot, "TotalAttackSpeed", 1) * ap) * 0.01;
    return rawAt(hero, slot, "MSAmount", 1) * 0.01;
  }
  if (key === "yuumi_r") {
    const wave = rawAt(hero, slot, "BaseMissileDamage", level) + coefficient(hero, slot, "TotalMissileDamage", 1) * ap;
    if (formulaKey === "missile_damage") return wave;
    if (formulaKey === "subsequent_wave_damage") return wave * rawAt(hero, slot, "MultiMissileReduction", 1);
    if (formulaKey === "single_target_total_damage") return wave * (1 + (rawAt(hero, slot, "NumberOfWaves", 1) - 1) * rawAt(hero, slot, "MultiMissileReduction", 1));
    const heal = rawAt(hero, slot, "BaseHealPerWave", level) + coefficient(hero, slot, "TotalHealPerWave", 1) * ap;
    if (formulaKey === "heal_per_wave") return heal;
    throw new Error(`未纳入排除友军增强公式 ${key}/${formulaKey}`);
  }
  throw new Error(`缺少独立原始期望 ${key}/${formulaKey}`);
};

const scenarios = {
  illaoi_p: { self_missing_health_heal: [context({ ap: 50, runtime: { missing_hp_at_slam: 100 } }), context({ ap: 400, runtime: { missing_hp_at_slam: 900 } })] },
  illaoi_q: {
    tentacle_damage: [context({ skillLevel: 1, ap: 50, ad: 90, runtime: { tentacle_damage_base_at_character_level: 9 } }), context({ skillLevel: 5, ap: 400, ad: 300, runtime: { tentacle_damage_base_at_character_level: 180 } })],
  },
  illaoi_w: {
    health_percent_ratio: [context({ skillLevel: 1, ad: 90 }), context({ skillLevel: 5, ad: 300 })],
    minimum_damage: [context({ skillLevel: 1 }), context({ skillLevel: 5 })],
    damage: [context({ skillLevel: 1, ad: 90, targetHp: 500 }), context({ skillLevel: 5, ad: 300, targetHp: 2500 })],
    dash_speed: [context({ moveSpeed: 300 }), context({ moveSpeed: 450 })],
  },
  illaoi_r: { damage: [context({ skillLevel: 1, ad: 150, bonusAd: 90 }), context({ skillLevel: 3, ad: 400, bonusAd: 300 })] },
  monkeyking_p: {
    bonus_armor: [context({ characterLevel: 1, runtime: { bonus_armor_at_character_level: interpolation("MonkeyKing", "P", "BonusArmor", 1) } }), context({ characterLevel: 18, runtime: { bonus_armor_at_character_level: interpolation("MonkeyKing", "P", "BonusArmor", 18) } })],
    tooltip_max_armor: [context({ characterLevel: 1, runtime: { bonus_armor_at_character_level: interpolation("MonkeyKing", "P", "BonusArmor", 1) } }), context({ characterLevel: 18, runtime: { bonus_armor_at_character_level: interpolation("MonkeyKing", "P", "BonusArmor", 18) } })],
    health_regen_per_tick: [context({ hp: 800 }), context({ hp: 2200 })],
    max_health_regen_per_tick: [context({ hp: 800 }), context({ hp: 2200 })],
  },
  monkeyking_q: { damage: [context({ skillLevel: 1, ad: 150, bonusAd: 90 }), context({ skillLevel: 5, ad: 400, bonusAd: 300 })], armor_shred_ratio: [context({ skillLevel: 1 }), context({ skillLevel: 5 })] },
  monkeyking_e: { damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })], attack_speed_ratio: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })] },
  monkeyking_r: {
    damage_per_second: [context({ skillLevel: 1, ad: 90, targetHp: 800 }), context({ skillLevel: 3, ad: 300, targetHp: 2500 })],
    damage_per_tick: [context({ skillLevel: 1, ad: 90, targetHp: 800 }), context({ skillLevel: 3, ad: 300, targetHp: 2500 })],
    full_spin_damage: [context({ skillLevel: 1, ad: 90, targetHp: 800 }), context({ skillLevel: 3, ad: 300, targetHp: 2500 })],
  },
  neeko_q: { first_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })], repeat_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })] },
  neeko_w: { passive_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })], passive_move_speed: [context({ skillLevel: 1 }), context({ skillLevel: 5 })], active_move_speed: [context({ skillLevel: 1 }), context({ skillLevel: 5 })] },
  neeko_e: { damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })], first_target_root_duration: [context({ skillLevel: 1 }), context({ skillLevel: 5 })] },
  neeko_r: { damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 3, ap: 400 })] },
  yuumi_p: { heal_amount: [context({ characterLevel: 1, ap: 50, runtime: { heal_base_at_character_level: interpolation("Yuumi", "P", "HealAmount", 1) } }), context({ characterLevel: 18, ap: 400, runtime: { heal_base_at_character_level: interpolation("Yuumi", "P", "HealAmount", 18) } })] },
  yuumi_q: { normal_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 6, ap: 400 })], empowered_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 6, ap: 400 })] },
  yuumi_w: {},
  yuumi_e: { shield_value: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })], attack_speed_ratio: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })], move_speed_ratio: [context({ skillLevel: 1 }), context({ skillLevel: 5 })] },
  yuumi_r: {
    missile_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 3, ap: 400 })],
    subsequent_wave_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 3, ap: 400 })],
    single_target_total_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 3, ap: 400 })],
    heal_per_wave: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 3, ap: 400 })],
  },
};

const levelSourceMap = {
  illaoi_q: { tentacle_damage_amp: "TentacleDamageAmp" },
  illaoi_w: { w_min_damage: "WMinDamage", health_percent_damage_points: "HealthPercentDamage" },
  illaoi_r: { base_damage: "BaseDamage" },
  monkeyking_q: { base_damage: "BaseDamage", armor_shred_ratio: "ArmorShredPercent", attack_range_bonus: "AttackRangeBonus" },
  monkeyking_e: { base_damage: "BaseDamage", attack_speed_ratio: "AttackSpeed" },
  monkeyking_r: { max_hp_damage_per_second_ratio: "BasePercentMaxHPDmgPerSec" },
  neeko_q: { zone_damage_base: "ZoneDamage", secondary_damage_base: "SecondaryDamage" },
  neeko_w: { passive_damage_base: "PassiveDamage", passive_move_speed_points: "PassiveHaste", active_move_speed_points: "Haste" },
  neeko_e: { damage_base: "Damage", min_root_duration_ms: "MinRootDuration" },
  neeko_r: { damage_base: "Damage" },
  yuumi_q: { missile_damage_base: "MissileDamage", empowered_damage_base: "EmpoweredMissileDamage", empowered_slow_percent_points: "EmpoweredSlowAmount" },
  yuumi_w: {},
  yuumi_e: { shield_base: "BaseShielding", attack_speed_points: "AttackSpeedAmount" },
  yuumi_r: { base_missile_damage: "BaseMissileDamage", heal_base_per_wave: "BaseHealPerWave" },
};
const skillMax = key => sourceSkill(key).maxLevel;
const levelTransform = (parameterKey, rawValue) => parameterKey.endsWith("_ms") ? toMs(rawValue) : rawValue;
const structural = { formulaCount: 0, binaryOperations: 0, invalidOperations: 0, missingReferences: 0, forbiddenResults: 0, runtimeWithoutDefault: 0, integerValues: 0, invalidIntegerValues: 0 };
const walk = (key, node) => {
  assert(node && typeof node === "object", `空公式节点 ${key}`);
  if (node.nodeType === "PARAMETER") {
    const item = parameter(key, node.parameterKey);
    if (item.valueMode === "RUNTIME_INPUT") {
      structural.runtimeWithoutDefault += Number(item.fixedValue === null && item.levelValues === null);
      assert(item.fixedValue === null && item.levelValues === null, `运行输入带默认 ${key}/${node.parameterKey}`);
    }
    return;
  }
  if (node.nodeType === "ATTRIBUTE") return;
  if (node.nodeType === "OPERATION") {
    if (Array.isArray(node.operands) && node.operands.length === 2) structural.binaryOperations += 1;
    else { structural.invalidOperations += 1; throw new Error(`不是双目运算 ${key}`); }
    walk(key, node.operands[0]); walk(key, node.operands[1]); return;
  }
  throw new Error(`未知表达式节点 ${key}/${node.nodeType}`);
};
for (const key of candidate.order) {
  const skill = sourceSkill(key);
  structural.formulaCount += skill.write.formulas.length;
  for (const item of skill.write.formulas) walk(key, item.expression);
  for (const item of skill.write.parameters) if (item.valueType === "INTEGER") {
    const values = item.valueMode === "FIXED" ? [item.fixedValue] : item.valueMode === "SKILL_LEVEL" || item.valueMode === "CHARACTER_LEVEL" ? Object.values(item.levelValues || {}) : [];
    for (const value of values) { structural.integerValues += 1; if (!Number.isInteger(value) || value < 0) structural.invalidIntegerValues += 1; }
  }
  for (const effect of skill.write.effects) for (const result of effect.results || []) {
    if (["DAMAGE", "DIRECT_HEAL", "MOMENT_EVALUATION"].includes(result.resultType)) structural.forbiddenResults += 1;
    if (result.valueRule?.value?.kind === "FORMULA") formula(key, result.valueRule.value.formulaKey);
  }
}
assert(structural.formulaCount === 36, `公式数量不是36：${structural.formulaCount}`);
assert(structural.invalidIntegerValues === 0, `存在非法整数参数：${structural.invalidIntegerValues}`);
assert(structural.forbiddenResults === 0, "存在禁止结果类型");

const effectValueCases = [];
for (const key of candidate.order) {
  const skill = sourceSkill(key);
  for (const effect of skill.write.effects) for (const result of effect.results || []) {
    const valueRule = result.valueRule;
    const value = valueRule?.value;
    assert(value && (value.kind === "FORMULA" || value.kind === "PARAMETER"), `效果缺少可核值${key}/${effect.effectKey}`);
    const multiplier = Number(valueRule.fixedMultiplier);
    assert(Number.isFinite(multiplier), `效果倍率不是有限数值${key}/${effect.effectKey}`);
    const detail = result.detail || {};
    if (result.resultType === "ATTRIBUTE_CHANGE") {
      assert(detail.operation === "INCREASE", `属性效果不是增量${key}/${effect.effectKey}`);
      assert(typeof detail.attributeKey === "string" && detail.attributeKey.length > 0, `属性效果缺少属性键${key}/${effect.effectKey}`);
      assert(detail.modifierZoneKey === "attribute_flat_add", `比例或护甲增量未使用平加区${key}/${effect.effectKey}`);
    }
    const skillCases = value.kind === "FORMULA" ? scenarios[key]?.[value.formulaKey] : null;
    if (value.kind === "FORMULA") {
      assert(Array.isArray(skillCases) && skillCases.length >= 2, `效果公式场景少于2组${key}/${effect.effectKey}`);
      for (const [caseIndex, scenario] of [skillCases[0], skillCases.at(-1)].entries()) {
        const sourceValue = evaluate(key, formula(key, value.formulaKey).expression, scenario);
        assert(Number.isFinite(Number(sourceValue)), `效果公式源值非有限${key}/${effect.effectKey}`);
        const finalValue = Number(sourceValue) * multiplier;
        assert(Number.isFinite(finalValue), `效果最终值非有限${key}/${effect.effectKey}`);
        effectValueCases.push({ skillKey: key, effectKey: effect.effectKey, resultKey: result.resultKey, caseIndex: caseIndex + 1, sourceValue, fixedMultiplier: multiplier, finalValue, sourceKind: "FORMULA", passed: true });
      }
    } else {
      const localParameter = skill.write.parameters.find(item => item.parameterKey === value.parameterKey);
      if (localParameter) {
        for (const [caseIndex, scenario] of [context({ skillLevel: 1, characterLevel: 1 }), context({ skillLevel: skill.maxLevel, characterLevel: 18 })].entries()) {
          const sourceValue = resolveParameter(key, value.parameterKey, scenario);
          assert(Number.isFinite(Number(sourceValue)), `效果参数源值非有限${key}/${effect.effectKey}`);
          const finalValue = Number(sourceValue) * multiplier;
          assert(Number.isFinite(finalValue), `效果最终值非有限${key}/${effect.effectKey}`);
          effectValueCases.push({ skillKey: key, effectKey: effect.effectKey, resultKey: result.resultKey, caseIndex: caseIndex + 1, sourceValue, fixedMultiplier: multiplier, finalValue, sourceKind: "PARAMETER", parameterKey: value.parameterKey, passed: true });
        }
      } else {
        assert(reusedPublic.has(key + "/" + value.parameterKey), `效果参数未在候选或公共复用中${key}/${effect.effectKey}/${value.parameterKey}`);
        assert(multiplier === 1, `公共复用效果倍率不是1${key}/${effect.effectKey}`);
        const officialValues = value.parameterKey === "cooldown_ms" ? skill.source.officialEvidence?.zh?.cooldown : skill.source.officialEvidence?.zh?.cost;
        assert(Array.isArray(officialValues), `公共复用效果缺少官方源值${key}/${effect.effectKey}/${value.parameterKey}`);
        for (const [caseIndex, skillLevel] of [1, skill.maxLevel].entries()) {
          const rawValue = officialValues[skillLevel - 1];
          assert(Number.isFinite(Number(rawValue)), `公共复用效果源值非有限${key}/${effect.effectKey}/${value.parameterKey}`);
          const sourceValue = value.parameterKey === "cooldown_ms" ? toMs(rawValue) : Number(rawValue);
          const finalValue = sourceValue * multiplier;
          assert(Number.isFinite(finalValue), `公共复用效果最终值非有限${key}/${effect.effectKey}`);
          effectValueCases.push({ skillKey: key, effectKey: effect.effectKey, resultKey: result.resultKey, caseIndex: caseIndex + 1, skillLevel, sourceValue, fixedMultiplier: multiplier, finalValue, sourceKind: "PUBLIC_REUSE", parameterKey: value.parameterKey, passed: true });
        }
      }
    }
  }
}

const ratioEffectChecks = [];
const ratioExpectations = [
  ["monkeyking_e", "self_attack_speed", "attack_speed_ratio", "bonus_attack_speed_percent", level => rawAt("MonkeyKing", "E", "AttackSpeed", level), [1, 5]],
  ["monkeyking_r", "self_move_speed", "move_speed_ratio", "move_speed_percent", () => rawAt("MonkeyKing", "R", "MoveSpeed", 1), [1, 3]],
  ["neeko_w", "self_passive_move_speed", "passive_move_speed", "move_speed_percent", level => rawAt("Neeko", "W", "PassiveHaste", level) * 0.01, [1, 5]],
  ["neeko_w", "self_active_move_speed", "active_move_speed", "move_speed_percent", level => rawAt("Neeko", "W", "Haste", level) * 0.01, [1, 5]],
  ["yuumi_e", "self_attack_speed", "attack_speed_ratio", "bonus_attack_speed_percent", level => (rawAt("Yuumi", "E", "AttackSpeedAmount", level) + coefficient("Yuumi", "E", "TotalAttackSpeed", 1) * 200) * 0.01, [1, 5]],
  ["yuumi_e", "self_move_speed", "move_speed_ratio", "move_speed_percent", () => rawAt("Yuumi", "E", "MSAmount", 1) * 0.01, [1, 5]],
];
for (const [key, effectKey, formulaKey, attributeKey, expectedAt, levels] of ratioExpectations) {
  const result = sourceSkill(key).write.effects.find(item => item.effectKey === effectKey)?.results?.[0];
  assert(result, `缺少比例属性效果${key}/${effectKey}`);
  assert(result.detail?.attributeKey === attributeKey, `比例属性键不符${key}/${effectKey}`);
  assert(result.detail?.modifierZoneKey === "attribute_flat_add", `比例属性乘区不符${key}/${effectKey}`);
  assert((result.valueRule?.value?.kind === "FORMULA" && result.valueRule.value.formulaKey === formulaKey) || (result.valueRule?.value?.kind === "PARAMETER" && result.valueRule.value.parameterKey === formulaKey), `比例属性效果未指向公式或参数${key}/${effectKey}`);
  for (const level of levels) {
    const c = context({ skillLevel: level, characterLevel: 18, ap: 200 });
    const valueRef = result.valueRule.value;
    const actual = (valueRef.kind === "FORMULA" ? evaluate(key, formula(key, formulaKey).expression, c) : resolveParameter(key, valueRef.parameterKey, c)) * Number(result.valueRule.fixedMultiplier);
    const expected = expectedAt(level);
    assert(Number.isFinite(actual) && Number.isFinite(expected) && near(actual, expected), `效果最终比例与源值不同${key}/${effectKey}/${level}`);
    ratioEffectChecks.push({ skillKey: key, effectKey, formulaKey, skillLevel: level, actual, expected, fixedMultiplier: result.valueRule.fixedMultiplier, attributeKey, modifierZoneKey: result.detail.modifierZoneKey, passed: true });
  }
}
assert(effectValueCases.length > 0, "没有效果最终值核算");
assert(ratioEffectChecks.length === ratioExpectations.reduce((total, item) => total + item[5].length, 0), "比例属性效果核算不完整");

const sourceChecks = { levelArrays: 0, levelArrayFailures: [], characterMaps: 0, characterMapFailures: [], rawFormulaCoefficients: 0, allRawCoefficientParts: 0, rawCoefficientFailures: [] };
for (const [key, mapping] of Object.entries(levelSourceMap)) {
  const [hero, slot] = heroSlot(key);
  for (const [parameterKey, rawName] of Object.entries(mapping)) {
    const item = parameter(key, parameterKey);
    const raw = rawValues(hero, slot, rawName);
    for (let level = 1; level <= skillMax(key); level += 1) {
      const expected = levelTransform(parameterKey, raw[level]);
      if (!near(item.levelValues?.[String(level)], expected)) sourceChecks.levelArrayFailures.push({ key, parameterKey, level, actual: item.levelValues?.[String(level)], expected });
      sourceChecks.levelArrays += 1;
    }
  }
}
for (const [hero, slot, calcName, index] of [["Illaoi", "R", "DamageCalc", 1], ["MonkeyKing", "E", "TotalDamage", 1], ["Neeko", "Q", "ExplosionDamage", 1], ["Neeko", "Q", "SecondDamage", 1], ["Neeko", "E", "BaseDamage", 1], ["Neeko", "R", "TotalDamage", 1], ["Yuumi", "P", "HealAmount", 1], ["Yuumi", "E", "TotalAttackSpeed", 1], ["Yuumi", "R", "TotalMissileDamage", 1], ["Yuumi", "R", "TotalHealPerWave", 1]]) { assert(typeof coefficient(hero, slot, calcName, index) === "number", `原始系数结构异常 ${hero}/${slot}/${calcName}`); sourceChecks.rawFormulaCoefficients += 1; }
const rawCoefficientParts = [];
for (const hero of binding.heroes) for (const skill of hero.skills) for (const [calcName, calc] of Object.entries(skill.object.mSpell.mSpellCalculations || {})) {
  const walkRaw = (node, location) => {
    if (!node || typeof node !== "object") return;
    if (Object.prototype.hasOwnProperty.call(node, "mCoefficient")) {
      if (typeof node.mCoefficient !== "number" || !Number.isFinite(node.mCoefficient)) sourceChecks.rawCoefficientFailures.push({ hero: hero.id, slot: skill.slot, calcName, location, value: node.mCoefficient });
      else rawCoefficientParts.push({ hero: hero.id, slot: skill.slot, calcName, location, coefficient: node.mCoefficient });
    }
    for (const [field, value] of Object.entries(node)) if (value && typeof value === "object") {
      if (Array.isArray(value)) value.forEach((child, index) => walkRaw(child, location + "." + field + "[" + index + "]"));
      else walkRaw(value, location + "." + field);
    }
  };
  walkRaw(calc, "root");
}
sourceChecks.allRawCoefficientParts = rawCoefficientParts.length;
assert(sourceChecks.rawCoefficientFailures.length === 0, `原始系数存在非有限值：${JSON.stringify(sourceChecks.rawCoefficientFailures)}`);
assert(sourceChecks.levelArrayFailures.length === 0, `等级数组源值不符：${JSON.stringify(sourceChecks.levelArrayFailures)}`);
assert(sourceChecks.characterMapFailures.length === 0, `角色等级映射不符：${JSON.stringify(sourceChecks.characterMapFailures)}`);

const results = [];
let caseCount = 0;
for (const key of candidate.order) for (const item of sourceSkill(key).write.formulas) {
  const cases = scenarios[key]?.[item.formulaKey];
  assert(Array.isArray(cases) && cases.length >= 2, `公式场景少于2组 ${key}/${item.formulaKey}`);
  for (let index = 0; index < cases.length; index += 1) {
    const c = cases[index];
    const actual = evaluate(key, item.expression, c);
    const expected = rawExpected(key, item.formulaKey, c);
    assert(Number.isFinite(actual) && Number.isFinite(expected), `公式结果非有限 ${key}/${item.formulaKey}`);
    const pass = near(actual, expected);
    results.push({ skillKey: key, formulaKey: item.formulaKey, caseIndex: index + 1, skillLevel: c.skillLevel, characterLevel: c.characterLevel, actual, expected, pass });
    assert(pass, `公式实算不符 ${key}/${item.formulaKey}/${index + 1}: ${actual} !== ${expected}`);
    caseCount += 1;
  }
}

const runtimeFormulaRefs = [];
for (const key of candidate.order) for (const item of sourceSkill(key).write.formulas) {
  const collect = node => {
    if (!node) return;
    if (node.nodeType === "PARAMETER") {
      const p = parameter(key, node.parameterKey);
      if (p.valueMode === "RUNTIME_INPUT" && !runtimeFormulaRefs.some(ref => ref.key === key && ref.formulaKey === item.formulaKey && ref.parameterKey === node.parameterKey)) runtimeFormulaRefs.push({ key, formulaKey: item.formulaKey, parameterKey: node.parameterKey });
    } else if (node.nodeType === "OPERATION") for (const operand of node.operands) collect(operand);
  };
  collect(item.expression);
}
const missingInputChecks = [];
for (const ref of runtimeFormulaRefs) {
  const valid = scenarios[ref.key][ref.formulaKey][0];
  const missingRuntime = { ...(valid.runtime || {}) };
  delete missingRuntime[ref.parameterKey];
  let rejected = false;
  try { evaluate(ref.key, formula(ref.key, ref.formulaKey).expression, { ...valid, runtime: missingRuntime }); } catch { rejected = true; }
  assert(rejected, `缺值没有拒绝 ${ref.key}/${ref.formulaKey}/${ref.parameterKey}`);
  missingInputChecks.push({ ...ref, rejected });
}
const attributeFormulaRefs = [];
for (const key of candidate.order) for (const item of sourceSkill(key).write.formulas) {
  const collect = node => {
    if (!node) return;
    if (node.nodeType === "ATTRIBUTE") {
      const reference = { key, formulaKey: item.formulaKey, attribute: attrKey(node.attributeOwner, node.attributeKey, node.attributeValueKind) };
      if (!attributeFormulaRefs.some(ref => ref.key === reference.key && ref.formulaKey === reference.formulaKey && ref.attribute === reference.attribute)) attributeFormulaRefs.push(reference);
    } else if (node.nodeType === "OPERATION") for (const operand of node.operands) collect(operand);
  };
  collect(item.expression);
}
const missingAttributeChecks = [];
for (const ref of attributeFormulaRefs) {
  const valid = scenarios[ref.key][ref.formulaKey][0];
  const attributes = { ...(valid.attributes || {}) };
  delete attributes[ref.attribute];
  let rejected = false;
  try { evaluate(ref.key, formula(ref.key, ref.formulaKey).expression, { ...valid, attributes }); } catch { rejected = true; }
  assert(rejected, `缺属性没有拒绝 ${ref.key}/${ref.formulaKey}/${ref.attribute}`);
  missingAttributeChecks.push({ ...ref, rejected });
}
const nonFiniteInputChecks = [];
for (const ref of runtimeFormulaRefs) {
  const valid = scenarios[ref.key][ref.formulaKey][0];
  const invalidRuntime = { ...(valid.runtime || {}), [ref.parameterKey]: Number.NaN };
  let rejected = false;
  try { evaluate(ref.key, formula(ref.key, ref.formulaKey).expression, { ...valid, runtime: invalidRuntime }); } catch { rejected = true; }
  assert(rejected, `非有限运行输入没有拒绝 ${ref.key}/${ref.formulaKey}/${ref.parameterKey}`);
  nonFiniteInputChecks.push({ ...ref, rejected });
}
for (const ref of attributeFormulaRefs) {
  const valid = scenarios[ref.key][ref.formulaKey][0];
  const invalidAttributes = { ...(valid.attributes || {}), [ref.attribute]: Number.NaN };
  let rejected = false;
  try { evaluate(ref.key, formula(ref.key, ref.formulaKey).expression, { ...valid, attributes: invalidAttributes }); } catch { rejected = true; }
  assert(rejected, `非有限属性输入没有拒绝 ${ref.key}/${ref.formulaKey}/${ref.attribute}`);
  nonFiniteInputChecks.push({ ...ref, rejected, inputType: "attribute" });
}
assert(caseCount >= structural.formulaCount * 2, "公式算例不足每公式两场景");
const report = {
  generatedAt: new Date().toISOString(), status: "通过", candidateMathReady: true, businessMathReady: false,
  note: "候选阶段独立数学核算；期望侧直接读取固定客户端原始值和主负责人换算口径，未调用业务接口。",
  candidateSha256: shaFile(CANDIDATE_FILE), revision: candidate.meta.revision, formulaCount: structural.formulaCount, caseCount, expectedCasesPerFormula: 2,
  results, effectValueCases, effectValueCheckCount: effectValueCases.length, ratioEffectChecks, ratioEffectCheckCount: ratioEffectChecks.length, missingInputCases: missingInputChecks, missingInputCaseCount: missingInputChecks.length, missingAttributeCases: missingAttributeChecks, missingAttributeCaseCount: missingAttributeChecks.length, nonFiniteInputCases: nonFiniteInputChecks, nonFiniteInputCaseCount: nonFiniteInputChecks.length, sourceChecks, structural,
  sourceFiles: { inputBinding: shaFile(path.join(INPUT, "来源绑定与当前文本.json")), inputVersion: shaFile(path.join(INPUT, "输入版本.json")), sourceNote: shaFile(path.join(INPUT, "主负责人源值核对说明.md")), candidate: shaFile(CANDIDATE_FILE) }, apiCalls: 0, apiWrites: 0,
};
const reportBytes = JSON.stringify(report, null, 2) + "\n";
const artifactReport = path.join(HERE, "独立数学核算.json");
fs.writeFileSync(artifactReport, reportBytes, "utf8");
fs.mkdirSync(OUTPUT_DURABLE, { recursive: true });
const durableScript = path.join(OUTPUT_DURABLE, "独立数学核算.mjs");
fs.writeFileSync(durableScript, fs.readFileSync(fileURLToPath(import.meta.url)));
const durableReport = path.join(OUTPUT_DURABLE, "独立数学核算.json");
fs.writeFileSync(durableReport, reportBytes, "utf8");
assert(shaFile(artifactReport) === shaFile(durableReport), "数学报告持久目录字节不一致");
assert(shaFile(fileURLToPath(import.meta.url)) === shaFile(durableScript), "数学脚本持久目录字节不一致");
console.log(JSON.stringify({ status: report.status, candidateMathReady: report.candidateMathReady, businessMathReady: report.businessMathReady, candidateSha256: report.candidateSha256, formulaCount: report.formulaCount, caseCount: report.caseCount, effectValueCheckCount: report.effectValueCheckCount, ratioEffectCheckCount: report.ratioEffectCheckCount, missingInputCaseCount: report.missingInputCaseCount, sourceChecks: report.sourceChecks, structural: report.structural, reportSha256: shaFile(artifactReport), scriptSha256: shaFile(fileURLToPath(import.meta.url)), apiCalls: 0, apiWrites: 0 }, null, 2));

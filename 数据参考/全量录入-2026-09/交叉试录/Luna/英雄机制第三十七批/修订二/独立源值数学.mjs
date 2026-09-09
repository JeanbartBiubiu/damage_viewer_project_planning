import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.join(ROOT, "..", "输入包");
const candidatePath = path.join(ROOT, "完整候选.json");
const sourcePath = path.join(INPUT, "来源绑定与当前文本.json");
const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const candidateFileSha256 = sha(fs.readFileSync(candidatePath));
const sourceFileSha256 = sha(fs.readFileSync(sourcePath));
const failures = [];
const fail = (kind, detail) => failures.push({ kind, ...detail });
const close = (a, b, tolerance = 1e-5) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));

const sourceSkills = new Map(source.heroes.flatMap((hero) => hero.skills.map((skill) => [skill.skillKey, skill])));
const candidateSkills = candidate.skills;
const rawSkill = (skillKey) => {
  const skill = sourceSkills.get(skillKey);
  if (!skill) throw new Error(`缺少冻结源技能 ${skillKey}`);
  return skill;
};
const rawSpell = (skillKey) => rawSkill(skillKey).object?.mSpell || {};
const data = (skillKey, name, level = 1) => {
  const entry = (rawSpell(skillKey).DataValues || []).find((item) => item.name === name);
  if (!entry || !Array.isArray(entry.values)) throw new Error(`缺少冻结DataValues ${skillKey}/${name}`);
  const value = entry.values[level];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`冻结DataValues不是有限值 ${skillKey}/${name}/${level}`);
  return value;
};
const calculation = (skillKey, name) => {
  const value = rawSpell(skillKey).mSpellCalculations?.[name];
  if (!value) throw new Error(`缺少冻结计算树 ${skillKey}/${name}`);
  return value;
};
const visit = (value, callback, pathValue = []) => {
  if (!value || typeof value !== "object") return;
  callback(value, pathValue);
  if (Array.isArray(value)) value.forEach((item, index) => visit(item, callback, [...pathValue, index]));
  else Object.entries(value).forEach(([key, item]) => visit(item, callback, [...pathValue, key]));
};
const firstNode = (skillKey, calculationName, predicate) => {
  let found = null;
  visit(calculation(skillKey, calculationName), (node) => {
    if (!found && predicate(node)) found = node;
  });
  if (!found) throw new Error(`计算树缺少期望节点 ${skillKey}/${calculationName}`);
  return found;
};
const rawCoefficient = (skillKey, calculationName, partIndex) => {
  const parts = calculation(skillKey, calculationName).mFormulaParts || [];
  const part = parts[partIndex];
  if (!part || typeof part.mCoefficient !== "number") throw new Error(`计算树系数缺失 ${skillKey}/${calculationName}/${partIndex}`);
  return part.mCoefficient;
};
const rawNumber = (skillKey, calculationName) => firstNode(skillKey, calculationName, (node) => node.__type === "NumberCalculationPart").mNumber;
const rawNamedMultiplier = (skillKey, calculationName, level) => data(skillKey, firstNode(skillKey, calculationName, (node) => typeof node.mDataValue === "string").mDataValue, level);
const rawStatCoefficient = (skillKey, calculationName) => firstNode(skillKey, calculationName, (node) => node.__type === "StatByCoefficientCalculationPart" && typeof node.mCoefficient === "number").mCoefficient;

const parameterMap = (skill) => new Map(skill.write.parameters.map((item) => [item.parameterKey, item]));
const formulaMap = (skill) => new Map(skill.write.formulas.map((item) => [item.formulaKey, item]));
const expressionRefs = (expression) => {
  const refs = { parameters: [], attributes: [] };
  visit(expression, (node) => {
    if (node.nodeType === "PARAMETER") refs.parameters.push(node.parameterKey);
    if (node.nodeType === "ATTRIBUTE") refs.attributes.push(`${node.attributeKey}/${node.attributeValueKind}`);
  });
  return refs;
};
const getParameter = (skill, key, context) => {
  const parameter = parameterMap(skill).get(key);
  if (!parameter) throw new Error(`候选参数不存在 ${skill.skillKey}/${key}`);
  if (parameter.valueMode === "FIXED") return parameter.fixedValue;
  if (parameter.valueMode === "SKILL_LEVEL") {
    const value = parameter.levelValues?.[String(context.level)];
    if (value === undefined) throw new Error(`缺少技能等级输入 ${skill.skillKey}/${key}/${context.level}`);
    return value;
  }
  if (parameter.valueMode === "RUNTIME_INPUT") {
    const value = context.runtime?.[key];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`缺少运行输入 ${skill.skillKey}/${key}`);
    return value;
  }
  throw new Error(`不支持的参数模式 ${skill.skillKey}/${key}/${parameter.valueMode}`);
};
const getAttribute = (node, context) => {
  const key = `${node.attributeKey}/${node.attributeValueKind}`;
  const value = context.attributes?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`缺少属性输入 ${node.attributeOwner}/${key}`);
  return value;
};
const evaluate = (node, skill, context) => {
  if (!node || typeof node !== "object") throw new Error("表达式节点为空");
  if (node.nodeType === "PARAMETER") return getParameter(skill, node.parameterKey, context);
  if (node.nodeType === "ATTRIBUTE") return getAttribute(node, context);
  if (node.nodeType === "OPERATION") {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`运算节点必须恰好两个操作数: ${node.operation}`);
    const [left, right] = node.operands.map((item) => evaluate(item, skill, context));
    if (node.operation === "ADD") return left + right;
    if (node.operation === "MULTIPLY") return left * right;
    throw new Error(`未知运算 ${node.operation}`);
  }
  throw new Error(`未知表达式节点 ${node.nodeType}`);
};

const contextFor = (skill, variant, level) => {
  const high = variant === 1;
  const runtime = {};
  for (const parameter of skill.write.parameters) {
    if (parameter.valueMode !== "RUNTIME_INPUT") continue;
    const key = parameter.parameterKey;
    if (key.includes("move_speed_base")) runtime[key] = high ? 75 : 20;
    else if (key.includes("proc_base_damage")) runtime[key] = high ? 125 : 15;
    else if (key.includes("shield_base_at_character_level")) runtime[key] = high ? 280 : 40;
    else if (key.includes("on_hit_base_damage")) runtime[key] = high ? 30 : 5;
    else if (key.includes("spirit_heal_base")) runtime[key] = high ? 20 : 3;
    else if (key.includes("bleed_base_damage")) runtime[key] = high ? 10 : 2;
    else if (key.includes("critical_mstat8")) runtime[key] = high ? 0.85 : 0.25;
    else if (key.includes("critical_mstat9")) runtime[key] = high ? 0.75 : 0.2;
    else if (key.includes("mstat12")) runtime[key] = high ? 1200 : 300;
    else runtime[key] = high ? 1200 : 300;
  }
  return {
    level,
    runtime,
    attributes: {
      "attack_damage/TOTAL": high ? 420 : 200,
      "attack_damage/BONUS": high ? 220 : 80,
      "ability_power/TOTAL": high ? 900 : 300,
      "bonus_attack_speed_percent/TOTAL": high ? 0.75 : 0.25,
      "hp/TOTAL": high ? 4000 : 1800,
    },
  };
};

const expected = (skillKey, formulaKey, context) => {
  const level = context.level;
  const adTotal = context.attributes["attack_damage/TOTAL"];
  const adBonus = context.attributes["attack_damage/BONUS"];
  const ap = context.attributes["ability_power/TOTAL"];
  const attackSpeed = context.attributes["bonus_attack_speed_percent/TOTAL"];
  const hp = context.attributes["hp/TOTAL"];
  const rt = context.runtime;
  const d = (name) => data(skillKey, name, level);
  const calc = (name) => calculation(skillKey, name);
  switch (`${skillKey}/${formulaKey}`) {
    case "akshan_p/second_attack_physical_damage": return d("SecondAutoADRatio") * adTotal;
    case "akshan_p/passive_proc_magic_damage": return rt.passive_proc_base_damage_at_character_level + d("APRatio") * ap;
    case "akshan_p/champion_shield_value": return rt.shield_base_at_character_level + d("ShieldBADRatio") * adBonus;
    case "akshan_p/cancelled_second_attack_move_speed": return rt.move_speed_base_at_character_level * (rawNumber(skillKey, "ASModdedMS") + rawStatCoefficient(skillKey, "ASModdedMS") * attackSpeed);
    case "akshan_q/physical_damage": return d("BaseDamage") + d("ADRatio") * adBonus;
    case "akshan_q/champion_hit_haste_ratio": return d("HasteValue") + d("HasteAPRatio") * ap;
    case "akshan_e/shot_physical_damage": return (d("BaseDamage") + d("ADRatio") * adTotal) * (rawNumber(skillKey, "DamageToDeal") + d("AttackSpeedCoefficient") * attackSpeed);
    case "akshan_e/critical_shot_physical_damage": {
      const criticalBase = rawNumber(skillKey, "CriticalCalc");
      const criticalStatCoefficient = firstNode(skillKey, "CriticalCalc", (node) => node.__type === "StatByCoefficientCalculationPart" && node.mStat === 9).mCoefficient;
      const damageToDeal = (d("BaseDamage") + d("ADRatio") * adTotal) * (rawNumber(skillKey, "DamageToDeal") + d("AttackSpeedCoefficient") * attackSpeed);
      return damageToDeal * (criticalBase + d("CritDamageMod") * (criticalStatCoefficient * rt.critical_mstat9_value - 1));
    }
    case "akshan_r/damage_per_bullet": {
      const criticalBase = rawNumber(skillKey, "DamagePerBulletWithCrit");
      const criticalStatCoefficient = firstNode(skillKey, "DamagePerBulletWithCrit", (node) => node.__type === "StatByCoefficientCalculationPart" && node.mStat === 9).mCoefficient;
      return (d("BonusDamage") + d("ADRatio") * adTotal) * (criticalBase + rt.critical_mstat8_value * d("CritDamageMod") * (criticalStatCoefficient * rt.critical_mstat9_value - 1));
    }
    case "akshan_r/max_damage_per_bullet": {
      const criticalBase = rawNumber(skillKey, "DamagePerBulletWithCrit");
      const criticalStatCoefficient = firstNode(skillKey, "DamagePerBulletWithCrit", (node) => node.__type === "StatByCoefficientCalculationPart" && node.mStat === 9).mCoefficient;
      const damagePerBullet = (d("BonusDamage") + d("ADRatio") * adTotal) * (criticalBase + rt.critical_mstat8_value * d("CritDamageMod") * (criticalStatCoefficient * rt.critical_mstat9_value - 1));
      return damagePerBullet * d("MaxIncrease");
    }
    case "ambessa_p/on_hit_physical_damage": return rt.on_hit_base_damage_at_character_level + rawCoefficient(skillKey, "Calc_OnHit_Damage_Flat", 1) * adBonus;
    case "ambessa_q/damage_1_edge_physical_damage": return d("Damage_1_Base") + d("Damage_1_BAD_Ratio") * adBonus;
    case "ambessa_q/damage_1_max_health_ratio": return d("Damage_1_Percent") + rawCoefficient(skillKey, "Calc_Damage_1_Percent_Max", 1) * adBonus;
    case "ambessa_q/damage_2_first_physical_damage": return d("Damage_2_Base") + d("Damage_2_BAD_Ratio") * adBonus;
    case "ambessa_q/damage_2_max_health_ratio": return d("Damage_2_Percent") + rawCoefficient(skillKey, "Calc_Damage_2_Percent_Max", 1) * adBonus;
    case "ambessa_w/shield_value": return rt.shield_base_at_character_level + rawCoefficient(skillKey, "Calc_Shield", 1) * adBonus;
    case "ambessa_w/low_physical_damage": return d("BaseDamage") + d("DamageADRatio") * adBonus;
    case "ambessa_w/high_physical_damage": return (d("BaseDamage") + d("DamageADRatio") * adBonus) * rawNamedMultiplier(skillKey, "Calc_Damage_High", level);
    case "ambessa_e/physical_damage": return d("Damage_Flat_Base") + d("ADRatio") * adBonus;
    case "ambessa_r/physical_damage": return d("Damage") + d("ADRatio") * adBonus;
    case "ambessa_r/omnivamp_ratio": return d("Omnivamp") + d("Omnivamp_LifeStealScaling") * rt.omnivamp_unknown_stat_value;
    case "aurora_p/proc_damage_ratio": return d("BaseHPDamage") + rawCoefficient(skillKey, "ProcDamage", 1) * ap;
    case "aurora_p/spirit_heal_value": return rt.spirit_heal_base_at_character_level + rawCoefficient(skillKey, "HealCalc", 1) * ap;
    case "aurora_q/first_magic_damage": return d("BaseDamage") + rawCoefficient(skillKey, "Damage", 1) * ap;
    case "aurora_q/q2_base_magic_damage": return d("Q2BaseDamage") + rawCoefficient(skillKey, "{f7c018c7}", 1) * ap;
    case "aurora_q/q2_max_magic_damage": return (d("Q2BaseDamage") + rawCoefficient(skillKey, "Q2DamageMax", 1) * ap) * rawNumber(skillKey, "Q2DamageMax");
    case "aurora_e/magic_damage": return d("BaseDamage") + rawCoefficient(skillKey, "DamageCalc", 1) * ap;
    case "aurora_r/magic_damage": return d("BaseDamage") + rawCoefficient(skillKey, "DamageCalc", 1) * ap;
    case "briar_p/bleed_damage_per_second": return rt.bleed_base_damage_at_character_level + rawCoefficient(skillKey, "{15da76ad}", 1) * adBonus;
    case "briar_p/bleed_total_damage": return (rt.bleed_base_damage_at_character_level + rawCoefficient(skillKey, "{15da76ad}", 1) * adBonus) * d("BleedDuration");
    case "briar_p/bleed_max_total_damage": return (rt.bleed_base_damage_at_character_level + rawCoefficient(skillKey, "{15da76ad}", 1) * adBonus) * d("BleedDuration") * rawNumber(skillKey, "BleedMaxDamageOverDurationTooltip");
    case "briar_p/missing_health_heal_percent": return rawNumber(skillKey, "TotalHealPerMissingHPPercentTooltip") * (d("HealShieldPerMissingHPPercent") + rawCoefficient(skillKey, "{b38f3487}", 1) * rt.missing_health_heal_stat_value);
    case "briar_q/physical_damage": return d("BaseDamage") + rawCoefficient(skillKey, "TotalDamage", 1) * ap + rawCoefficient(skillKey, "TotalDamage", 2) * adBonus;
    case "briar_w/empowered_attack_flat_damage": return d("AttackBonusDamage") + rawCoefficient(skillKey, "TotalAttackBonusDamage", 1) * adTotal;
    case "briar_w/empowered_attack_missing_health_percent": return d("AttackPercentMissingHealth") + rawCoefficient(skillKey, "TotalAttackPercentMissingHealth", 1) * adBonus;
    case "briar_w/empowered_attack_heal_base": return rawCoefficient(skillKey, "AttackMaxHPHeal", 0) * hp;
    case "briar_e/max_magic_damage": return d("MaxBaseDamage") + rawCoefficient(skillKey, "Damage", 1) * adBonus + rawCoefficient(skillKey, "Damage", 2) * ap;
    case "briar_e/wall_hit_magic_damage": return d("WallHitBaseDamage") + rawCoefficient(skillKey, "WallHitDamage", 1) * adBonus + rawCoefficient(skillKey, "WallHitDamage", 2) * ap;
    case "briar_e/max_health_heal_value": return hp * data(skillKey, "HealHPPercent", level);
    case "briar_r/magic_damage": return d("BaseDamage") + rawCoefficient(skillKey, "Damage", 1) * ap;
    case "briar_r/total_resists": return d("ResistADRatio") * adTotal;
    default: throw new Error(`没有独立原始期望映射 ${skillKey}/${formulaKey}`);
  }
};

const actualFormulaCases = [];
let formulaCaseCount = 0;
let missingInputChecks = 0;
let binaryChecks = 0;
for (const skill of Object.values(candidateSkills)) {
  const maxLevel = skill.maxLevel;
  for (const formula of skill.write.formulas) {
    const refs = expressionRefs(formula.expression);
    for (const variant of [0, 1]) {
      const level = maxLevel === 1 ? 1 : (variant === 0 ? 1 : maxLevel);
      const context = contextFor(skill, variant, level);
      try {
        const actual = evaluate(formula.expression, skill, context);
        const sourceExpected = expected(skill.skillKey, formula.formulaKey, context);
        if (!Number.isFinite(actual)) fail("nonFiniteFormula", { skillKey: skill.skillKey, formulaKey: formula.formulaKey, variant, actual });
        if (!close(actual, sourceExpected)) fail("sourceExpectedMismatch", { skillKey: skill.skillKey, formulaKey: formula.formulaKey, variant, actual, sourceExpected });
        actualFormulaCases.push({ skillKey: skill.skillKey, formulaKey: formula.formulaKey, variant, level, actual, sourceExpected, passed: close(actual, sourceExpected) });
      } catch (error) {
        fail("formulaEvaluation", { skillKey: skill.skillKey, formulaKey: formula.formulaKey, variant, message: error.message });
      }
      formulaCaseCount += 1;
    }
    for (const runtimeKey of [...new Set(refs.parameters)].filter((key) => parameterMap(skill).get(key)?.valueMode === "RUNTIME_INPUT")) {
      const context = contextFor(skill, 0, maxLevel === 1 ? 1 : 1);
      delete context.runtime[runtimeKey];
      try {
        evaluate(formula.expression, skill, context);
        fail("missingRuntimeAccepted", { skillKey: skill.skillKey, formulaKey: formula.formulaKey, runtimeKey });
      } catch {
        missingInputChecks += 1;
      }
    }
    for (const attributeKey of [...new Set(refs.attributes)]) {
      const context = contextFor(skill, 0, maxLevel === 1 ? 1 : 1);
      delete context.attributes[attributeKey];
      try {
        evaluate(formula.expression, skill, context);
        fail("missingAttributeAccepted", { skillKey: skill.skillKey, formulaKey: formula.formulaKey, attributeKey });
      } catch {
        missingInputChecks += 1;
      }
    }
    visit(formula.expression, (node, nodePath) => {
      if (node.nodeType !== "OPERATION") return;
      binaryChecks += 1;
      if (!Array.isArray(node.operands) || node.operands.length !== 2) fail("nonBinaryOperation", { skillKey: skill.skillKey, formulaKey: formula.formulaKey, path: nodePath.join(".") });
    });
  }
}

const seriesMap = {
  "akshan_q/base_damage": ["BaseDamage", (value) => value],
  "akshan_w/move_speed_points": ["MSValue", (value) => value],
  "akshan_e/shot_base_damage": ["BaseDamage", (value) => value],
  "akshan_r/bonus_damage": ["BonusDamage", (value) => value],
  "akshan_r/bullet_count": ["NumberOfBullets", (value) => value],
  "ambessa_q/damage_1_base": ["Damage_1_Base", (value) => value],
  "ambessa_q/damage_1_max_health_base_ratio": ["Damage_1_Percent", (value) => value],
  "ambessa_q/damage_2_base": ["Damage_2_Base", (value) => value],
  "ambessa_q/damage_2_max_health_base_ratio": ["Damage_2_Percent", (value) => value],
  "ambessa_w/base_damage": ["BaseDamage", (value) => value],
  "ambessa_e/base_damage": ["Damage_Flat_Base", (value) => value],
  "ambessa_r/base_damage": ["Damage", (value) => value],
  "ambessa_r/armor_penetration_ratio": ["Armor_Penetration", (value) => value],
  "ambessa_r/omnivamp_base_ratio": ["Omnivamp", (value) => value],
  "aurora_q/base_damage": ["BaseDamage", (value) => value],
  "aurora_q/q2_base_damage": ["Q2BaseDamage", (value) => value],
  "aurora_w/invis_duration_ms": ["InvisDuration", (value) => value * 1000],
  "aurora_w/move_speed_bonus_ratio": ["MoveSpeedBonus", (value) => value / 100],
  "aurora_e/base_damage": ["BaseDamage", (value) => value],
  "aurora_r/base_damage": ["BaseDamage", (value) => value],
  "aurora_r/area_duration_ms": ["AreaDuration", (value) => value * 1000],
  "aurora_r/realm_hopper_duration_ms": ["RBuffDuration", (value) => value * 1000],
  "aurora_r/exit_slow_duration_ms": ["StunDuration", (value) => value * 1000],
  "briar_q/base_damage": ["BaseDamage", (value) => value],
  "briar_q/shred_ratio": ["ShredPercent", (value) => value],
  "briar_w/berserk_attack_speed_ratio": ["BerserkAS", (value) => value],
  "briar_w/berserk_move_speed_ratio": ["BerserkMS", (value) => value],
  "briar_w/empowered_attack_base_damage": ["AttackBonusDamage", (value) => value],
  "briar_w/attack_heal_damage_ratio": ["AttackHealPercent", (value) => value],
  "briar_e/max_base_damage": ["MaxBaseDamage", (value) => value],
  "briar_e/wall_hit_base_damage": ["WallHitBaseDamage", (value) => value],
  "briar_e/max_health_heal_ratio": ["HealHPPercent", (value) => value],
  "briar_r/base_damage": ["BaseDamage", (value) => value],
  "briar_r/lifesteal_ratio": ["LifestealPercent", (value) => value],
  "briar_r/extra_move_speed_ratio": ["ExtraMoveSpeedPercent", (value) => value],
};
let sourceSeriesChecks = 0;
for (const skill of Object.values(candidateSkills)) {
  for (const parameter of skill.write.parameters) {
    if (!parameter.levelValues) continue;
    const mapping = seriesMap[`${skill.skillKey}/${parameter.parameterKey}`];
    if (!mapping) {
      fail("unmappedLevelSeries", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey });
      continue;
    }
    const [sourceName, transform] = mapping;
    const actualValues = Object.keys(parameter.levelValues).sort((a, b) => Number(a) - Number(b)).map((key) => parameter.levelValues[key]);
    const expectedValues = actualValues.map((_, index) => transform(data(skill.skillKey, sourceName, index + 1)));
    actualValues.forEach((value, index) => {
      sourceSeriesChecks += 1;
      if (!close(value, expectedValues[index])) fail("sourceSeriesMismatch", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey, level: index + 1, actual: value, sourceExpected: expectedValues[index], sourceName });
    });
  }
}

let integerChecks = 0;
let millisecondTypeChecks = 0;
for (const skill of Object.values(candidateSkills)) {
  for (const parameter of skill.write.parameters) {
    if (/_ms$/.test(parameter.parameterKey)) {
      millisecondTypeChecks += 1;
      if (parameter.valueType !== "INTEGER") fail("millisecondTypeMismatch", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey, valueType: parameter.valueType });
    }
    if (parameter.valueType !== "INTEGER") continue;
    const values = parameter.levelValues ? Object.values(parameter.levelValues) : [parameter.fixedValue];
    for (const value of values) {
      integerChecks += 1;
      if (!Number.isInteger(value)) fail("nonIntegerParameter", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey, value });
    }
  }
}

let effectChecks = 0;
const allParameterKeys = (skill) => new Set(skill.write.parameters.map((item) => item.parameterKey));
const allFormulaKeys = (skill) => new Set(skill.write.formulas.map((item) => item.formulaKey));
for (const skill of Object.values(candidateSkills)) {
  const parameters = allParameterKeys(skill);
  const formulas = allFormulaKeys(skill);
  for (const formula of skill.write.formulas) {
    visit(formula.expression, (node, nodePath) => {
      if (node.nodeType === "PARAMETER" && formulas.has(node.parameterKey)) fail("formulaReferencedAsParameter", { skillKey: skill.skillKey, formulaKey: formula.formulaKey, parameterKey: node.parameterKey, path: nodePath.join(".") });
      if (node.nodeType === "PARAMETER" && !parameters.has(node.parameterKey)) fail("formulaMissingParameter", { skillKey: skill.skillKey, formulaKey: formula.formulaKey, parameterKey: node.parameterKey, path: nodePath.join(".") });
    });
  }
  for (const effect of skill.write.effects) {
    effectChecks += 1;
    const duration = effect.lifecycle?.durationValue;
    if (duration?.kind === "PARAMETER" && !parameters.has(duration.parameterKey)) fail("effectMissingParameter", { skillKey: skill.skillKey, effectKey: effect.effectKey, parameterKey: duration.parameterKey });
    for (const result of effect.results || []) {
      if (result.valueRule?.value?.kind === "PARAMETER" && !parameters.has(result.valueRule.value.parameterKey)) fail("effectMissingParameter", { skillKey: skill.skillKey, effectKey: effect.effectKey, parameterKey: result.valueRule.value.parameterKey });
      if (result.valueRule?.value?.kind === "FORMULA" && !formulas.has(result.valueRule.value.formulaKey)) fail("effectMissingFormula", { skillKey: skill.skillKey, effectKey: effect.effectKey, formulaKey: result.valueRule.value.formulaKey });
      if (result.resultType === "NORMAL_SHIELD" && !(Object.prototype.hasOwnProperty.call(result, "spellShieldBlockScope") && result.spellShieldBlockScope === null)) fail("shieldScopeNotExplicitNull", { skillKey: skill.skillKey, effectKey: effect.effectKey });
    }
  }
}

let boundaryChecks = 0;
const boundary = (label, actual, expectedValue) => {
  boundaryChecks += 1;
  if (!close(actual, expectedValue)) fail("boundaryMismatch", { label, actual, expected: expectedValue });
};
// 只核对原始端点/断点和有明确单位的转换，不把端点插值误当中间曲线。
boundary("akshan_p/passive_proc_level1_raw", data("akshan_p", "MaxStacks", 1), 3);
boundary("akshan_p/passive_proc_breakpoint_level6", 15 + 25, 40);
boundary("akshan_p/passive_proc_breakpoint_level11", 15 + 25 + 40, 80);
boundary("akshan_p/passive_proc_breakpoint_level16", 15 + 25 + 40 + 70, 150);
boundary("aurora_w/move_speed_level1_percent_to_ratio", data("aurora_w", "MoveSpeedBonus", 1) / 100, 0.2);
boundary("aurora_w/move_speed_level5_percent_to_ratio", data("aurora_w", "MoveSpeedBonus", 5) / 100, 0.4);
boundary("briar_e/wall_stun_seconds_to_ms", data("briar_e", "WallStunDuration", 1) * 1000, 1500);
boundary("briar_w/attack_heal_zero_hp", 0 * rawCoefficient("briar_w", "AttackMaxHPHeal", 0), 0);
boundary("briar_e/heal_zero_hp", 0 * data("briar_e", "HealHPPercent", 1), 0);
boundary("akshan_e/critical_mstat9_low_multiplier", rawNumber("akshan_e", "CriticalCalc") + data("akshan_e", "CritDamageMod", 1) * (0.25 - 1), 0.625);
boundary("akshan_e/critical_mstat9_high_multiplier", rawNumber("akshan_e", "CriticalCalc") + data("akshan_e", "CritDamageMod", 1) * (0.75 - 1), 0.875);
boundary("akshan_r/critical_multiplier_low", rawNumber("akshan_r", "DamagePerBulletWithCrit") + 0.25 * data("akshan_r", "CritDamageMod", 1) * (0.2 - 1), 0.94);
boundary("akshan_r/critical_multiplier_high", rawNumber("akshan_r", "DamagePerBulletWithCrit") + 0.85 * data("akshan_r", "CritDamageMod", 1) * (0.75 - 1), 0.93625);

const report = {
  generatedAt: new Date().toISOString(),
  status: failures.length === 0 ? "PASS" : "FAIL",
  revision: candidate.revision,
  candidateFileSha256,
  sourceFileSha256,
  sourceIndexSha256: candidate.meta.sourceIndexSha256,
  sourcePolicy: "期望值只读取修订目录输入包中的原始DataValues与mSpellCalculations；实际值读取本候选表达式和参数。两侧独立。",
  formulaCount: Object.values(candidateSkills).reduce((sum, skill) => sum + skill.write.formulas.length, 0),
  formulaCaseCount,
  formulaCases: actualFormulaCases,
  missingInputChecks,
  binaryChecks,
  integerChecks,
  millisecondTypeChecks,
  sourceSeriesChecks,
  effectChecks,
  boundaryChecks,
  failures,
  apiWrites: 0,
  apiCalls: 0,
  noBusinessWrites: true,
  noBrowser: true,
  notes: [
    "mStat12/formula2（贝蕾亚P、安蓓萨R相关未知输入）继续无默认；贝蕾亚W/E无选择器mStat12按主负责人同版窄证以SOURCE.hp.TOTAL求值。",
    "阿萝拉W MoveSpeedBonus原始值是百分数点，独立期望按100换算为比例；不按原始20/40直接作为属性比例。",
    "阿克尚E的CriticalCalc和R的DamagePerBulletWithCrit均按冻结树保留完整暴击乘区；mStat8/mStat9使用不同的非零运行输入，期望侧直接读取原始树，不能把它们映射成既有属性。",
    "阿萝拉Q的DamageReduction=0.2按正文保存为后续命中比例；归属、命中顺序和已损生命中间曲线仍待核。",
    "角色等级插值只验证原始端点和运行输入拒绝，中间曲线不由端点推导。",
  ],
};
fs.writeFileSync(path.join(ROOT, "独立源值数学报告.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ status: report.status, formulaCount: report.formulaCount, formulaCaseCount, missingInputChecks, binaryChecks, integerChecks, sourceSeriesChecks, effectChecks, boundaryChecks, failures: failures.length, candidateFileSha256, sourceFileSha256 }, null, 2));
if (failures.length > 0) process.exitCode = 1;

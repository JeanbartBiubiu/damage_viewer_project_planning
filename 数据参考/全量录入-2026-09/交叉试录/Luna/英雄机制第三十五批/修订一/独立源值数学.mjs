import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = "C:/project/damage_web_dev/.agents/artifacts/hero35-luna-candidate/输入包";
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const readInput = (file) => JSON.parse(fs.readFileSync(path.join(INPUT, file), "utf8"));
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const candidate = read("完整候选.json");
const binding = readInput("来源绑定与当前文本.json");
const inputVersion = readInput("输入版本.json");
const ms = (value) => {
  const output = Math.round(Number(value) * 1000);
  if (!Number.isInteger(output)) throw new Error("毫秒源值不是整数");
  return output;
};
const sourceByKey = new Map();
for (const hero of binding.heroes) {
  for (const skill of hero.skills) sourceByKey.set(skill.skillKey, skill.object.mSpell);
}
const rawFor = (skillKey) => {
  const raw = sourceByKey.get(skillKey);
  if (!raw) throw new Error("缺少来源原文 " + skillKey);
  return raw;
};
const data = (skillKey, name, level = 1) => {
  const values = rawFor(skillKey).DataValues?.find((item) => item.name === name)?.values;
  if (!values || values[level] === undefined) throw new Error("缺少源值 " + skillKey + "/" + name + "[" + level + "]");
  return values[level];
};
const calc = (skillKey, name) => rawFor(skillKey).mSpellCalculations?.[name] || null;
const coefficient = (skillKey, name, partIndex = null) => {
  const parts = calc(skillKey, name)?.mFormulaParts || [];
  const part = partIndex === null
    ? parts.find((item) => typeof item.mCoefficient === "number")
    : parts[partIndex];
  if (!part || typeof part.mCoefficient !== "number") throw new Error("缺少计算树系数 " + skillKey + "/" + name);
  return part.mCoefficient;
};
const clean = (value) => typeof value === "number" ? Number(value.toFixed(8)) : value;
const sourceCharacterDamage = (skillKey, calcName, characterLevel) => {
  const part = calc(skillKey, calcName)?.mFormulaParts?.find((item) => Array.isArray(item.values));
  if (!part || part.values[characterLevel] === undefined) throw new Error("缺少角色等级源值 " + skillKey + "/" + calcName);
  return part.values[characterLevel];
};
const skill = (skillKey) => candidate.skills[skillKey];
const parameters = (skillKey) => Object.fromEntries(skill(skillKey).write.parameters.map((item) => [item.parameterKey, item]));
const attrKey = (node) => node.attributeOwner + ":" + node.attributeKey + ":" + node.attributeValueKind;
const attrsFor = (high) => ({
  "SOURCE:ability_power:TOTAL": high ? 300 : 80,
  "SOURCE:hp:TOTAL": high ? 2400 : 1200,
  "SOURCE:hp:BONUS": high ? 1200 : 300,
  "SOURCE:armor:TOTAL": high ? 150 : 60,
  "SOURCE:armor:BONUS": high ? 80 : 20,
  "SOURCE:magic_resistance:TOTAL": high ? 100 : 40,
  "SOURCE:magic_resistance:BONUS": high ? 60 : 10,
  "TARGET:hp:TOTAL": high ? 3000 : 1000,
});
const runtimeFor = (skillKey, high) => {
  const runtime = {
    steal_floor_by_character_level: high ? 3 : 1.5,
    current_stack_count: high ? 5 : 0,
    character_level_base_damage: high ? 93 : 25,
    actual_armor_stage: high ? 240 : 90,
    actual_cooldown_multiplier: high ? 0.75 : 0.5,
    current_consumed_charge_count: high ? 5 : 1,
    target_stack_count_before_hit: high ? 3 : 0,
    cast_stage_missing_hp: high ? 900 : 120,
    grey_health_healing_ratio: high ? 0.95 : 0.6,
    current_grey_health: high ? 1000 : 120,
  };
  if (skillKey === "taric_q" && !high) runtime.current_consumed_charge_count = 0;
  return runtime;
};
const caseFor = (skillKey, high) => ({
  skillLevel: high ? skill(skillKey).maxLevel : 1,
  characterLevel: high ? 18 : 1,
  attributes: attrsFor(high),
  runtime: runtimeFor(skillKey, high),
});
const runtimeBounds = {
  current_stack_count: [0, 5],
  target_stack_count_before_hit: [0, 3],
  current_consumed_charge_count: [0, 5],
  current_grey_health: [0, Number.POSITIVE_INFINITY],
  grey_health_healing_ratio: [0, 1],
  cast_stage_missing_hp: [0, Number.POSITIVE_INFINITY],
};
const parameterValue = (skillKey, parameterKey, context) => {
  const parameter = parameters(skillKey)[parameterKey];
  if (!parameter) throw new Error("候选缺少参数 " + skillKey + "/" + parameterKey);
  if (parameter.valueMode === "FIXED") return parameter.fixedValue;
  if (parameter.valueMode === "SKILL_LEVEL") {
    const value = parameter.levelValues?.[String(context.skillLevel)];
    if (value === undefined) throw new Error("技能等级参数缺值 " + skillKey + "/" + parameterKey);
    return value;
  }
  if (parameter.valueMode === "CHARACTER_LEVEL") {
    const value = parameter.levelValues?.[String(context.characterLevel)];
    if (value === undefined) throw new Error("角色等级参数缺值 " + skillKey + "/" + parameterKey);
    return value;
  }
  if (parameter.valueMode !== "RUNTIME_INPUT") throw new Error("未知参数取值方式 " + parameter.valueMode);
  if (!(parameterKey in context.runtime)) throw new Error("运行输入缺失 " + skillKey + "/" + parameterKey);
  const value = context.runtime[parameterKey];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("运行输入不是有限数值 " + skillKey + "/" + parameterKey);
  const range = runtimeBounds[parameterKey];
  if (range && (value < range[0] || value > range[1])) throw new Error("运行输入越界 " + skillKey + "/" + parameterKey);
  if (parameter.valueType === "INTEGER" && !Number.isInteger(value)) throw new Error("整数运行输入不是整数 " + skillKey + "/" + parameterKey);
  if (parameterKey === "current_consumed_charge_count") {
    const max = parameterValue(skillKey, "max_charge_count", context);
    if (value > max) throw new Error("实际消耗充能超过当前最大层数");
  }
  return value;
};
const attributeValue = (node, context) => {
  const key = attrKey(node);
  if (!(key in context.attributes)) throw new Error("属性输入缺失 " + key);
  const value = context.attributes[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("属性输入不是有限数值 " + key);
  return value;
};
const evalExpression = (skillKey, expression, context) => {
  if (!expression || typeof expression !== "object") throw new Error("表达式为空");
  if (expression.nodeType === "PARAMETER") return parameterValue(skillKey, expression.parameterKey, context);
  if (expression.nodeType === "ATTRIBUTE") return attributeValue(expression, context);
  if (expression.nodeType !== "OPERATION" || !Array.isArray(expression.operands) || expression.operands.length !== 2) {
    throw new Error("OPERATION必须恰好两个操作数");
  }
  const left = evalExpression(skillKey, expression.operands[0], context);
  const right = evalExpression(skillKey, expression.operands[1], context);
  switch (expression.operation) {
    case "ADD": return left + right;
    case "SUBTRACT": return left - right;
    case "MULTIPLY": return left * right;
    case "DIVIDE": return left / right;
    case "MIN": return Math.min(left, right);
    case "MAX": return Math.max(left, right);
    default: throw new Error("未知二元操作 " + expression.operation);
  }
};
const parameterRefs = (expression, output = []) => {
  if (!expression) return output;
  if (expression.nodeType === "PARAMETER") output.push(expression.parameterKey);
  else if (expression.nodeType === "OPERATION") expression.operands.forEach((item) => parameterRefs(item, output));
  return output;
};
const attributeRefs = (expression, output = []) => {
  if (!expression) return output;
  if (expression.nodeType === "ATTRIBUTE") output.push(attrKey(expression));
  else if (expression.nodeType === "OPERATION") expression.operands.forEach((item) => attributeRefs(item, output));
  return output;
};
const close = (actual, expected, epsilon = 1e-6) =>
  Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(actual), Math.abs(expected));
const expected = (skillKey, formulaKey, context) => {
  const level = context.skillLevel;
  const charLevel = context.characterLevel;
  const APValue = context.attributes["SOURCE:ability_power:TOTAL"];
  const sourceHP = context.attributes["SOURCE:hp:TOTAL"];
  const sourceBonusHP = context.attributes["SOURCE:hp:BONUS"];
  const targetHP = context.attributes["TARGET:hp:TOTAL"];
  const r = context.runtime;
  switch (skillKey + "/" + formulaKey) {
    case "braum_p/already_stunned_extra_magic_damage":
      return sourceCharacterDamage("braum_p", "TotalDamage", charLevel) * data("braum_p", "AlreadyStunnedDamageAmp");
    case "braum_q/magic_damage":
      return data("braum_q", "BaseDamage", level) + data("braum_q", "MaxHPDamageValue") * sourceHP;
    case "braum_w/self_armor_bonus":
      return data("braum_w", "BaseResists", level) + data("braum_w", "BraumArmorPercent") * r.actual_armor_stage;
    case "braum_w/self_magic_resistance_bonus":
      return data("braum_w", "BaseResists", level) + data("braum_w", "BraumArmorPercent") * context.attributes["SOURCE:magic_resistance:BONUS"];
    case "braum_r/magic_damage":
      return data("braum_r", "BaseDamage", level) + 0.6 * APValue;
    case "rell_p/on_hit_extra_magic_damage":
      return coefficient("rell_p", "OnHitDamage", 0) * context.attributes["SOURCE:armor:TOTAL"]
        + coefficient("rell_p", "OnHitDamage", 1) * context.attributes["SOURCE:magic_resistance:TOTAL"];
    case "rell_q/magic_damage":
      return data("rell_q", "BaseDamage", level) + coefficient("rell_q", "Damage") * APValue;
    case "rell_w/crash_down_magic_damage":
      return data("rell_w", "CrashDownDamage", level) + coefficient("rell_w", "DismountDamage") * APValue;
    case "rell_w/crash_shield_value":
      return data("rell_w", "ShieldBase", level) + data("rell_w", "ShieldHealthRatio") * sourceHP;
    case "rell_w/mount_up_extra_attack_magic_damage":
      return data("rell_w", "MountUpDamage", level) + coefficient("rell_w", "FlipDamage") * APValue;
    case "rell_e/next_hit_extra_magic_damage":
      return (data("rell_e", "PercentHealthDamage", level) + coefficient("rell_e", "MaxHealthDamageCalc") * APValue) * targetHP;
    case "rell_r/damage_per_second_magic":
      return data("rell_r", "BaseDamagePerSecond", level) + coefficient("rell_r", "DamagePerSecond") * APValue;
    case "rell_r/total_magic_damage":
      return (data("rell_r", "BaseDamagePerSecond", level) + coefficient("rell_r", "DamagePerSecond") * APValue) * data("rell_r", "Duration", level);
    case "taric_p/empowered_attack_extra_magic_damage":
      return r.character_level_base_damage * data("taric_p", "BaseDamageMultiplierForModesBalance")
        + data("taric_p", "ArmorDamageValue") * r.actual_armor_stage;
    case "taric_p/basic_ability_cooldown_refund_seconds":
      return 1 + (1 - r.actual_cooldown_multiplier);
    case "taric_q/healing_per_charge":
      return data("taric_q", "HealingPerStackBase") + data("taric_q", "HealingAPRatio") * APValue
        + data("taric_q", "HealingHPRatio") * sourceHP;
    case "taric_q/max_charge_healing":
      return (data("taric_q", "HealingPerStackBase") + data("taric_q", "HealingAPRatio") * APValue
        + data("taric_q", "HealingHPRatio") * sourceHP) * data("taric_q", "MaxCharges", level);
    case "taric_q/consumed_charge_healing":
      return (data("taric_q", "HealingPerStackBase") + data("taric_q", "HealingAPRatio") * APValue
        + data("taric_q", "HealingHPRatio") * sourceHP) * r.current_consumed_charge_count;
    case "taric_w/self_armor_bonus":
      return data("taric_w", "ArmorBonusPercentage", level) * r.actual_armor_stage;
    case "taric_w/self_shield_value":
      return (data("taric_w", "ShieldHPRatio", level) / 100) * sourceHP;
    case "taric_e/magic_damage":
      return data("taric_e", "BaseDamage", level) + coefficient("taric_e", "TotalDamage", 1) * APValue
        + coefficient("taric_e", "TotalDamage", 2) * r.actual_armor_stage;
    case "tahmkench_p/bonus_hp_magic_damage":
      return coefficient("tahmkench_p", "TotalDamage", 1) * sourceBonusHP;
    case "tahmkench_p/ap_bonus_hp_magic_damage":
      return data("tahmkench_p", "APRatioPer100BonusHP") * APValue * 0.01 * sourceBonusHP;
    case "tahmkench_p/total_passive_magic_damage":
      return r.character_level_base_damage + coefficient("tahmkench_p", "TotalDamage", 1) * sourceBonusHP
        + data("tahmkench_p", "APRatioPer100BonusHP") * APValue * 0.01 * sourceBonusHP;
    case "tahmkench_q/magic_damage":
      return data("tahmkench_q", "BaseDamage", level) + coefficient("tahmkench_q", "TotalDamage") * APValue;
    case "tahmkench_q/self_heal":
      return data("tahmkench_q", "BaseHeal", level) + data("tahmkench_q", "PercentHealthHealing", level) * r.cast_stage_missing_hp;
    case "tahmkench_w/magic_damage":
      return data("tahmkench_w", "BaseDamage", level) + coefficient("tahmkench_w", "TotalDamage") * APValue;
    case "tahmkench_e/grey_health_maximum":
      return coefficient("tahmkench_e", "GreyHealthMaximum") * sourceHP;
    case "tahmkench_e/grey_health_heal_value":
      return r.current_grey_health * r.grey_health_healing_ratio;
    case "tahmkench_r/target_max_hp_damage_ratio":
      return data("tahmkench_r", "BasePercentHPDamage") + coefficient("tahmkench_r", "PercentHPDamage") * APValue;
    case "tahmkench_r/enemy_magic_damage":
      return data("tahmkench_r", "BaseDamage", level)
        + (data("tahmkench_r", "BasePercentHPDamage") + coefficient("tahmkench_r", "PercentHPDamage") * APValue) * targetHP;
    case "tahmkench_r/actual_cooldown_ms":
      return data("tahmkench_r", "DataCooldown", level) * 1000 * r.actual_cooldown_multiplier;
    default: throw new Error("没有独立源值期望 " + skillKey + "/" + formulaKey);
  }
};

const formulaResults = [];
const failures = [];
for (const skillKey of candidate.order) {
  for (const item of skill(skillKey).write.formulas) {
    for (const high of [false, true]) {
      const context = caseFor(skillKey, high);
      try {
        const actual = evalExpression(skillKey, item.expression, context);
        const wanted = expected(skillKey, item.formulaKey, context);
        const pass = Number.isFinite(actual) && Number.isFinite(wanted) && close(actual, wanted);
        formulaResults.push({
          skillKey,
          formulaKey: item.formulaKey,
          case: high ? 2 : 1,
          skillLevel: context.skillLevel,
          characterLevel: context.characterLevel,
          abilityPower: context.attributes["SOURCE:ability_power:TOTAL"],
          actual,
          expected: wanted,
          pass,
        });
        if (!pass) failures.push({ check: "formula", skillKey, formulaKey: item.formulaKey, case: high ? 2 : 1, actual, expected: wanted });
      } catch (error) {
        formulaResults.push({ skillKey, formulaKey: item.formulaKey, case: high ? 2 : 1, pass: false, error: error.message });
        failures.push({ check: "formula-error", skillKey, formulaKey: item.formulaKey, message: error.message });
      }
    }
  }
}

const missingInputChecks = [];
for (const skillKey of candidate.order) {
  for (const item of skill(skillKey).write.formulas) {
    const context = caseFor(skillKey, false);
    const runtimeRefs = [...new Set(parameterRefs(item.expression).filter((key) => parameters(skillKey)[key]?.valueMode === "RUNTIME_INPUT"))];
    const attrs = [...new Set(attributeRefs(item.expression))];
    const missingContext = {
      skillLevel: context.skillLevel,
      characterLevel: context.characterLevel,
      attributes: { ...context.attributes },
      runtime: { ...context.runtime },
    };
    let missingKind = "NONE";
    let missingKey = null;
    if (runtimeRefs.length) {
      missingKind = "RUNTIME_INPUT";
      missingKey = runtimeRefs[0];
      delete missingContext.runtime[missingKey];
    } else if (attrs.length) {
      missingKind = "ATTRIBUTE";
      missingKey = attrs[0];
      delete missingContext.attributes[missingKey];
    }
    if (missingKind === "NONE") {
      missingInputChecks.push({ skillKey, formulaKey: item.formulaKey, missingKind, missingKey, rejected: null, applicable: false });
      continue;
    }
    let rejected = false;
    let message = null;
    try {
      evalExpression(skillKey, item.expression, missingContext);
    } catch (error) {
      rejected = true;
      message = error.message;
    }
    missingInputChecks.push({ skillKey, formulaKey: item.formulaKey, missingKind, missingKey, rejected, message, applicable: true });
    if (!rejected) failures.push({ check: "missing-input", skillKey, formulaKey: item.formulaKey, missingKind, missingKey });
  }
}

const binaryChecks = [];
const walkExpression = (skillKey, expression, pathName) => {
  if (!expression || expression.nodeType !== "OPERATION") return;
  const operands = expression.operands;
  const pass = Array.isArray(operands) && operands.length === 2;
  binaryChecks.push({ skillKey, path: pathName, operation: expression.operation, operands: operands?.length ?? null, pass });
  if (!pass) failures.push({ check: "binary", skillKey, path: pathName });
  if (pass) {
    walkExpression(skillKey, operands[0], pathName + ".operands[0]");
    walkExpression(skillKey, operands[1], pathName + ".operands[1]");
  }
};
for (const skillKey of candidate.order) {
  for (const item of skill(skillKey).write.formulas) walkExpression(skillKey, item.expression, item.formulaKey);
}

const runtimeChecks = [];
const integerChecks = [];
const ratioChecks = [];
for (const skillKey of candidate.order) {
  for (const item of skill(skillKey).write.parameters) {
    if (item.valueMode === "RUNTIME_INPUT") {
      const pass = item.fixedValue === null && item.levelValues === null;
      runtimeChecks.push({ skillKey, parameterKey: item.parameterKey, pass });
      if (!pass) failures.push({ check: "runtime-shape", skillKey, parameterKey: item.parameterKey });
    }
    if (item.parameterKey.endsWith("_ms")) {
      const values = item.valueMode === "FIXED" ? [item.fixedValue] : Object.values(item.levelValues || {});
      const pass = item.valueType === "INTEGER" && values.every((value) => Number.isInteger(value));
      integerChecks.push({ skillKey, parameterKey: item.parameterKey, valueType: item.valueType, values, pass });
      if (!pass) failures.push({ check: "integer-ms", skillKey, parameterKey: item.parameterKey });
    }
    if (/(ratio|percent_points)/.test(item.parameterKey)) {
      const values = item.valueMode === "FIXED" ? [item.fixedValue] : Object.values(item.levelValues || {});
      const pass = values.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
      ratioChecks.push({ skillKey, parameterKey: item.parameterKey, values, pass });
      if (!pass) failures.push({ check: "ratio-sign", skillKey, parameterKey: item.parameterKey });
    }
  }
}

const sourceSeriesChecks = [];
const series = [
  ["braum_q", "base_damage", "BaseDamage", 5, (value) => value],
  ["braum_w", "base_resistance", "BaseResists", 5, (value) => value],
  ["braum_e", "shield_hold_duration_ms", "ShieldHoldDuration", 5, ms],
  ["braum_e", "subsequent_damage_reduction_percent_points", "ShieldFacingDRAmount", 5, (value) => value],
  ["braum_r", "base_damage", "BaseDamage", 3, (value) => value],
  ["braum_r", "maximum_knockup_ms", "MaxKnockup", 3, ms],
  ["braum_r", "slow_zone_duration_ms", "SlowZoneDuration", 3, ms],
  ["braum_r", "slow_percent_points", "MoveSpeedMod", 3, (value) => value],
  ["rell_q", "base_damage", "BaseDamage", 5, (value) => value],
  ["rell_w", "crash_down_base_damage", "CrashDownDamage", 5, (value) => value],
  ["rell_w", "crash_shield_base", "ShieldBase", 5, (value) => value],
  ["rell_w", "mounted_move_speed_points", "MountedMoveSpeed", 5, (value) => value],
  ["rell_w", "mount_up_extra_attack_base_damage", "MountUpDamage", 5, (value) => value],
  ["rell_e", "next_hit_target_max_hp_ratio", "PercentHealthDamage", 5, clean],
  ["rell_r", "damage_per_second_base", "BaseDamagePerSecond", 3, (value) => value],
  ["taric_q", "max_charge_count", "MaxCharges", 5, (value) => value],
  ["taric_w", "armor_bonus_ratio", "ArmorBonusPercentage", 5, clean],
  ["taric_w", "self_shield_hp_ratio", "ShieldHPRatio", 5, (value) => clean(value / 100)],
  ["taric_e", "base_damage", "BaseDamage", 5, (value) => value],
  ["tahmkench_q", "base_damage", "BaseDamage", 5, (value) => value],
  ["tahmkench_q", "self_heal_base", "BaseHeal", 5, (value) => value],
  ["tahmkench_q", "self_heal_missing_hp_ratio", "PercentHealthHealing", 5, clean],
  ["tahmkench_w", "base_damage", "BaseDamage", 5, (value) => value],
  ["tahmkench_w", "champion_refund_ratio", "ChampRefund", 5, clean],
  ["tahmkench_e", "grey_health_conversion_ratio", "GreyHealthRatio", 5, clean],
  ["tahmkench_r", "cooldown_ms", "DataCooldown", 3, (value) => ms(value)],
  ["tahmkench_r", "base_damage", "BaseDamage", 3, (value) => value],
];
for (const [skillKey, parameterKey, sourceName, count, transform] of series) {
  const actual = Object.values(parameters(skillKey)[parameterKey]?.levelValues || {});
  const wanted = rawFor(skillKey).DataValues.find((item) => item.name === sourceName).values.slice(1, count + 1).map(transform);
  const pass = actual.length === wanted.length && actual.every((value, index) => close(value, wanted[index]));
  sourceSeriesChecks.push({ skillKey, parameterKey, sourceName, actual, expected: wanted, pass });
  if (!pass) failures.push({ check: "source-series", skillKey, parameterKey, actual, expected: wanted });
}

const fixedChecks = [];
const addFixed = (name, actual, wanted) => {
  const pass = close(actual, wanted);
  fixedChecks.push({ name, actual, expected: wanted, pass });
  if (!pass) failures.push({ check: "source-fixed", name, actual, expected: wanted });
};
addFixed("braum_p/character_level_damage_1", parameters("braum_p").total_magic_damage_by_character_level.levelValues["1"], sourceCharacterDamage("braum_p", "TotalDamage", 1));
addFixed("braum_p/character_level_damage_18", parameters("braum_p").total_magic_damage_by_character_level.levelValues["18"], sourceCharacterDamage("braum_p", "TotalDamage", 18));
addFixed("rell_p/on_hit_armor_ratio", parameters("rell_p").on_hit_armor_ratio.fixedValue, coefficient("rell_p", "OnHitDamage", 0));
addFixed("rell_p/on_hit_mr_ratio", parameters("rell_p").on_hit_magic_resistance_ratio.fixedValue, coefficient("rell_p", "OnHitDamage", 1));
addFixed("taric_q/charge_interval_ms", parameters("taric_q").charge_interval_ms.fixedValue, data("taric_q", "Recharge") * 1000);
addFixed("taric_w/self_shield_rank1_ratio", parameters("taric_w").self_shield_hp_ratio.levelValues["1"], data("taric_w", "ShieldHPRatio", 1) / 100);
addFixed("tahmkench_r/mana_cost", parameters("tahmkench_r").mana_cost.fixedValue, data("tahmkench_r", "DataManaCost", 1));
addFixed("tahmkench_r/cooldown_rank1_ms", parameters("tahmkench_r").cooldown_ms.levelValues["1"], data("tahmkench_r", "DataCooldown", 1) * 1000);
addFixed("tahmkench_r/cooldown_rank3_ms", parameters("tahmkench_r").cooldown_ms.levelValues["3"], data("tahmkench_r", "DataCooldown", 3) * 1000);

const effectChecks = [];
for (const skillKey of candidate.order) {
  for (const effect of skill(skillKey).write.effects) {
    const result = effect.results?.[0];
    const duration = effect.lifecycle?.durationValue;
    const value = result?.valueRule?.value;
    const durationPass = duration === null
      || (duration?.kind === "PARAMETER" && !!parameters(skillKey)[duration.parameterKey]);
    const valuePass = value?.kind === "FORMULA"
      ? skill(skillKey).write.formulas.some((item) => item.formulaKey === value.formulaKey)
      : value?.kind === "PARAMETER" && !!parameters(skillKey)[value.parameterKey];
    const pass = effect.lifecycle !== undefined
      && result?.resultType === "NORMAL_SHIELD"
      && result?.target === "SOURCE"
      && durationPass
      && valuePass
      && effect.lifecycle.maxStacksValue?.kind === "FIXED"
      && effect.lifecycle.applicationStacksValue?.kind === "FIXED";
    effectChecks.push({ skillKey, effectKey: effect.effectKey, duration, value, pass });
    if (!pass) failures.push({ check: "effect-reference", skillKey, effectKey: effect.effectKey });
  }
}

const boundaryChecks = [];
const boundary = (name, pass, details = {}) => {
  boundaryChecks.push({ name, pass, ...details });
  if (!pass) failures.push({ check: "boundary", name, ...details });
};
const evaluateBoundary = (skillKey, formulaKey, context) => evalExpression(skillKey, skill(skillKey).write.formulas.find((item) => item.formulaKey === formulaKey).expression, context);
const zeroTaric = caseFor("taric_q", false);
zeroTaric.runtime.current_consumed_charge_count = 0;
boundary("taric_q/consumed_zero", close(evaluateBoundary("taric_q", "consumed_charge_healing", zeroTaric), 0), { expected: 0 });
const maxTaric = caseFor("taric_q", true);
maxTaric.runtime.current_consumed_charge_count = 5;
boundary("taric_q/consumed_max", close(evaluateBoundary("taric_q", "consumed_charge_healing", maxTaric), expected("taric_q", "consumed_charge_healing", maxTaric)), { expected: expected("taric_q", "consumed_charge_healing", maxTaric) });
const tooManyCharges = caseFor("taric_q", true);
tooManyCharges.runtime.current_consumed_charge_count = 6;
let chargeRejected = false;
try { evaluateBoundary("taric_q", "consumed_charge_healing", tooManyCharges); } catch { chargeRejected = true; }
boundary("taric_q/reject_above_rank_max", chargeRejected, { rejected: true, upperBound: 5 });
const zeroGrey = caseFor("tahmkench_e", false);
zeroGrey.runtime.current_grey_health = 0;
boundary("tahmkench_e/grey_zero", close(evaluateBoundary("tahmkench_e", "grey_health_heal_value", zeroGrey), 0), { expected: 0 });
const greyCap = caseFor("tahmkench_e", true);
boundary("tahmkench_e/grey_cap", evaluateBoundary("tahmkench_e", "grey_health_maximum", greyCap) === 3 * greyCap.attributes["SOURCE:hp:TOTAL"], { expected: 7200 });
const negativeGrey = caseFor("tahmkench_e", false);
negativeGrey.runtime.current_grey_health = -1;
let greyRejected = false;
try { evaluateBoundary("tahmkench_e", "grey_health_heal_value", negativeGrey); } catch { greyRejected = true; }
boundary("tahmkench_e/reject_negative_grey", greyRejected, { rejected: true });
const sourceCooldown = Object.values(parameters("tahmkench_r").cooldown_ms.levelValues || {});
boundary("tahmkench_r/cooldown_source_values", JSON.stringify(sourceCooldown) === JSON.stringify([120000, 100000, 80000]), { actual: sourceCooldown, expected: [120000, 100000, 80000] });
const ratioUnits = [
  ["braum_q/source_max_hp_ratio", parameters("braum_q").source_max_hp_ratio.fixedValue, 0.025],
  ["braum_q/initial_slow_percent_points", parameters("braum_q").initial_slow_percent_points.fixedValue, 70],
  ["braum_e/self_move_speed_ratio", parameters("braum_e").self_move_speed_ratio.fixedValue, 0.1],
  ["taric_w/self_shield_hp_ratio", parameters("taric_w").self_shield_hp_ratio.levelValues["1"], 0.07],
  ["tahmkench_r/target_max_hp_base_ratio", parameters("tahmkench_r").target_max_hp_base_ratio.fixedValue, 0.15],
];
for (const [name, actual, wanted] of ratioUnits) boundary(name, close(actual, wanted), { actual, expected: wanted });
boundary("taric_q/reuse_cast_interval_not_new", !candidate.skills.taric_q.write.parameters.some((item) => item.parameterKey === "cast_interval_ms") && candidate.reusedPublicParameters.some((item) => item.skillKey === "taric_q" && item.parameterKey === "cast_interval_ms"), {});
boundary("tahmkench_r/wrapper_zero_not_used", sourceCooldown.every((value) => value > 0), { actual: sourceCooldown });

const allFormulaCount = candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.formulas.length, 0);
const applicableMissing = missingInputChecks.filter((item) => item.applicable);
const pass = failures.length === 0
  && formulaResults.length === allFormulaCount * 2
  && formulaResults.every((item) => item.pass)
  && applicableMissing.every((item) => item.rejected)
  && binaryChecks.every((item) => item.pass)
  && runtimeChecks.every((item) => item.pass)
  && integerChecks.every((item) => item.pass)
  && ratioChecks.every((item) => item.pass)
  && sourceSeriesChecks.every((item) => item.pass)
  && fixedChecks.every((item) => item.pass)
  && effectChecks.every((item) => item.pass)
  && boundaryChecks.every((item) => item.pass);
const report = {
  generatedAt: new Date().toISOString(),
  status: pass ? "PASS" : "FAIL",
  batch: "英雄机制第三十五批",
  candidateFileSha256: sha(fs.readFileSync(path.join(ROOT, "完整候选.json"))),
  sourceIndexSha256: inputVersion.sourceIndexSha256,
  method: "实际读取候选中的每个表达式，用输入包冻结的客户端DataValues、计算树、当前正文单位和官方源文件重新构造独立期望值；每个公式两组不同等级/属性/输入，缺失运行输入或属性时实际删除后求值；未调用业务接口。",
  formulaCaseCount: formulaResults.length,
  formulaResults,
  missingInputChecks,
  binaryChecks,
  runtimeInputChecks: runtimeChecks,
  integerMillisecondsChecks: integerChecks,
  ratioChecks,
  sourceSeriesChecks,
  fixedSourceChecks: fixedChecks,
  effectReferenceChecks: effectChecks,
  boundaryChecks,
  failures,
  sourceExpectedExamples: formulaResults.filter((item) => item.case === 1 || item.formulaKey === "enemy_magic_damage"),
  apiWrites: 0,
  apiCalls: 0,
  noApiCalls: true,
  evaluatorSha256: sha(fs.readFileSync(path.join(ROOT, "独立源值数学.mjs"))),
};
fs.writeFileSync(path.join(ROOT, "独立源值数学报告.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  status: report.status,
  formulaCount: allFormulaCount,
  formulaCaseCount: report.formulaCaseCount,
  applicableMissingInputChecks: applicableMissing.length,
  binaryChecks: binaryChecks.length,
  sourceSeriesChecks: sourceSeriesChecks.length,
  effectChecks: effectChecks.length,
  boundaryChecks: boundaryChecks.length,
  failures: failures.length,
  apiWrites: 0,
  apiCalls: 0,
}, null, 2));
if (!pass) process.exitCode = 1;

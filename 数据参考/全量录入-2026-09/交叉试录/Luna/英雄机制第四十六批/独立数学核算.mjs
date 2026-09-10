import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const durable = path.resolve(here, "../../../数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十六批");
const candidate = JSON.parse(fs.readFileSync(path.join(here, "完整候选.json"), "utf8"));
const sourceSummary = JSON.parse(fs.readFileSync(path.join(here, "来源值摘要.json"), "utf8"));
const sources = sourceSummary.sourceValues;
const epsilon = 1e-6;
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};
const near = (actual, expected) => Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(actual), Math.abs(expected));
const skillOf = skillKey => candidate.skills[skillKey];
const sourceOf = skillKey => sources[skillKey];
const paramsOf = skillKey => new Map(skillOf(skillKey).write.parameters.map(item => [item.parameterKey, item]));
const formulaOf = (skillKey, formulaKey) => skillOf(skillKey).write.formulas.find(item => item.formulaKey === formulaKey);
const sourceData = (skillKey, name, level) => {
  const values = sourceOf(skillKey).rawDataValues[name];
  assert(Array.isArray(values), `源数组缺失：${skillKey}/${name}`);
  const value = values?.[level];
  assert(Number.isFinite(value), `源数组级别值缺失：${skillKey}/${name}/${level}`);
  return value;
};
const sourceCoefficient = (skillKey, calculation, partIndex = 1) => {
  const part = sourceOf(skillKey).rawCalculations?.[calculation]?.mFormulaParts?.[partIndex];
  assert(Number.isFinite(part?.mCoefficient), `源系数缺失：${skillKey}/${calculation}/${partIndex}`);
  return part?.mCoefficient;
};
const sourceMultiplier = (skillKey, calculation) => {
  const value = sourceOf(skillKey).rawCalculations?.[calculation]?.mMultiplier?.mNumber;
  assert(Number.isFinite(value), `源根倍率缺失：${skillKey}/${calculation}`);
  return value;
};
const techniqueOf = (skillKey, objectName) => {
  const item = sourceOf(skillKey).techniqueSources?.find(value => value.objectName === objectName);
  assert(item, `彗技法源缺失：${skillKey}/${objectName}`);
  return item;
};

const runtimeValue = (skillKey, key, scenario) => {
  const values = {
    "belveth_p/stack_count": [2, 12],
    "belveth_p/actual_stack_attack_speed_ratio": [0.1, 0.15],
    "belveth_p/actual_temporary_attack_speed_ratio": [0.2, 0.2],
    "belveth_q/actual_attack_speed_percent_points": [10, 40],
    "belveth_w/stat_formula_2_value": [100, 250],
    "belveth_e/actual_attack_speed_stat_formula_2": [100, 250],
    "belveth_e/actual_strike_count": [6, 12],
    "belveth_r/qualified_hit_count": [1, 3],
    "hwei_p/actual_mark_damage_base": [40, 285],
    "hwei_p/actual_slow_stack_decay_ratio": [0.5, 0.8],
    "hwei_q/qw_actual_condition_damage": [200, 800],
    "hwei_w/wq_personal_effect_duration_ms": [1000, 2500],
    "locke_p/actual_min_onhit_base": [5, 40],
    "locke_p/actual_max_onhit_base": [10, 80],
    "locke_p/actual_target_missing_health_ratio": [0.2, 0.7],
    "locke_q/unused_nail_cooldown_refund_ratio": [0.2, 0.35],
    "locke_w/actual_attack_speed_ratio": [0.4, 0.7],
    "locke_w/actual_additional_heal": [100, 200],
    "locke_w/actual_max_healing_threshold": [250, 450],
    "locke_r/sealed_hero_count": [1, 3],
    "locke_r/ground_artifact_duration_ms": [1000, 5000],
    "zaahen_p/stack_count": [1, 12],
    "zaahen_p/actual_bonus_ad_per_stack_ratio": [0.015, 0.028],
    "zaahen_p/actual_revive_health_ratio": [0.3, 0.75],
    "zaahen_r/actual_eligible_damage": [100, 1000],
  };
  const value = values[`${skillKey}/${key}`];
  assert(value, `数学场景未定义运行输入：${skillKey}/${key}`);
  return value ? value[scenario] : 1 + scenario;
};
const scenarioOf = (skillKey, scenario) => {
  const skill = skillOf(skillKey);
  const runtime = {};
  for (const item of skill.write.parameters.filter(value => value.valueMode === "RUNTIME_INPUT")) runtime[item.parameterKey] = runtimeValue(skillKey, item.parameterKey, scenario);
  return {
    scenario,
    skillLevel: scenario === 0 ? 1 : skill.maxLevel,
    characterLevel: scenario === 0 ? 1 : 18,
    source: {
      abilityPower: scenario === 0 ? 80 : 500,
      attackDamageTotal: scenario === 0 ? 120 : 300,
      attackDamageBonus: scenario === 0 ? 40 : 180,
      hpTotal: scenario === 0 ? 1200 : 2200,
    },
    target: { hpTotal: scenario === 0 ? 1800 : 2600 },
    runtime,
  };
};
const attributeValue = (node, context) => {
  const owner = node.attributeOwner === "TARGET" ? context.target : context.source;
  if (node.attributeKey === "ability_power") return owner.abilityPower;
  if (node.attributeKey === "attack_damage") return node.attributeValueKind === "BONUS" ? owner.attackDamageBonus : owner.attackDamageTotal;
  if (node.attributeKey === "hp") return owner.hpTotal;
  throw new Error(`未知属性：${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`);
};
const resolveParameter = (skillKey, parameterKey, context) => {
  const parameter = paramsOf(skillKey).get(parameterKey);
  assert(parameter, `候选参数缺失：${skillKey}/${parameterKey}`);
  if (!parameter) return NaN;
  if (parameter.valueMode === "FIXED") return parameter.fixedValue;
  if (parameter.valueMode === "SKILL_LEVEL") return parameter.levelValues[String(context.skillLevel)];
  if (parameter.valueMode === "CHARACTER_LEVEL") return parameter.levelValues[String(context.characterLevel)];
  if (parameter.valueMode === "RUNTIME_INPUT") {
    if (!Object.prototype.hasOwnProperty.call(context.runtime, parameterKey)) throw new Error(`缺少运行输入：${skillKey}/${parameterKey}`);
    return context.runtime[parameterKey];
  }
  throw new Error(`未知参数模式：${skillKey}/${parameterKey}`);
};
const evaluateNode = (skillKey, node, context) => {
  if (!node) throw new Error(`空计算节点：${skillKey}`);
  if (node.nodeType === "PARAMETER") return resolveParameter(skillKey, node.parameterKey, context);
  if (node.nodeType === "ATTRIBUTE") return attributeValue(node, context);
  if (node.nodeType === "OPERATION") {
    assert(Array.isArray(node.operands) && node.operands.length === 2, `二元运算数目错误：${skillKey}/${node.operation}`);
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`非二元运算：${skillKey}`);
    const left = evaluateNode(skillKey, node.operands[0], context);
    const right = evaluateNode(skillKey, node.operands[1], context);
    if (node.operation === "ADD") return left + right;
    if (node.operation === "MULTIPLY") return left * right;
    throw new Error(`未知二元运算：${skillKey}/${node.operation}`);
  }
  throw new Error(`未知计算节点：${skillKey}/${node.nodeType}`);
};
const evaluateFormula = (skillKey, formulaKey, context) => evaluateNode(skillKey, formulaOf(skillKey, formulaKey).expression, context);

// 这里的期望值直接从来源数组、计算树和来源说明取值，和候选表达式分开计算。
const expected = (skillKey, formulaKey, context) => {
  const lv = context.skillLevel;
  const ap = context.source.abilityPower;
  const ad = context.source.attackDamageTotal;
  const bad = context.source.attackDamageBonus;
  const hp = context.target.hpTotal;
  const run = context.runtime;
  const d = (name, level = lv) => sourceData(skillKey, name, level);
  const c = (name, index = 1) => sourceCoefficient(skillKey, name, index);
  const k = `${skillKey}/${formulaKey}`;
  switch (k) {
    case "belveth_p/temporary_attack_speed_bonus": return run.actual_temporary_attack_speed_ratio;
    case "belveth_p/permanent_attack_speed_bonus": return run.stack_count * run.actual_stack_attack_speed_ratio;
    case "belveth_q/dash_physical_damage": return d("Damage") + d("ADRatio") * ad;
    case "belveth_q/direction_cooldown_haste": return d("PerSideCDAttackSpeedMultiplier") * run.actual_attack_speed_percent_points;
    case "belveth_w/magic_damage": return d("BaseDamage") + c("Damage") * run.stat_formula_2_value;
    case "belveth_e/damage_per_strike": return d("DamagePerHit") + c("DamagePerStrike") * ad;
    case "belveth_e/maximum_damage_per_strike": return sourceMultiplier(skillKey, "MaxDamagePerStrikeTooltip") * (d("DamagePerHit") + c("DamagePerStrike") * ad);
    case "belveth_e/source_counted_strikes": return d("NumberOfStrikes") + d("NumberOfStrikes") * sourceOf(skillKey).rawCalculations.TotalStrikes.mFormulaParts[1].mPart2.mCoefficient * run.actual_attack_speed_stat_formula_2;
    case "belveth_e/actual_strikes": return run.actual_strike_count;
    case "belveth_e/total_lifesteal_ratio": return d("BonusLifeSteal");
    case "belveth_r/passive_true_damage": return d("OnHitDamage") + c("FinalOnHitDamage") * bad;
    case "hwei_p/mark_magic_damage": return run.actual_mark_damage_base + c("TotalDamage") * ap;
    case "hwei_q/qq_magic_damage": return d("Tooltip_QQBaseDamage") + c("Tooltip_QQDamage") * ap;
    case "hwei_q/qq_target_hp_damage": return d("Tooltip_QQBonusDamage") * 0.01 * hp;
    case "hwei_q/qq_total_magic_damage": return d("Tooltip_QQBaseDamage") + c("Tooltip_QQDamage") * ap + d("Tooltip_QQBonusDamage") * 0.01 * hp;
    case "hwei_q/qw_base_magic_damage": return d("Tooltip_QWBaseDamage") + c("Tooltip_QWDamage") * ap;
    case "hwei_q/qw_max_condition_damage": return d("Tooltip_QWBonusDamageMult") * (d("Tooltip_QWBaseDamage") + c("Tooltip_QWDamage") * ap);
    case "hwei_q/qw_actual_damage": return run.qw_actual_condition_damage;
    case "hwei_q/qe_burst_magic_damage": return d("Tooltip_QEBaseDamage") + c("Tooltip_QEDamage") * ap;
    case "hwei_q/qe_magic_damage_per_second": return d("Tooltip_QEBaseDPS") + c("Tooltip_QEDamagePerSecond") * ap;
    case "hwei_w/wq_move_speed_ratio": return 0.01 * (d("Tooltip_WQBaseMoveSpeed") + c("Tooltip_WQMoveSpeed") * ap);
    case "hwei_w/ww_full_shield": return d("Tooltip_WWShieldAmountBase") + c("Tooltip_WWShieldAmount") * ap;
    case "hwei_w/ww_initial_shield": return sourceMultiplier(skillKey, "Tooltip_WWStartShieldAmount") * (d("Tooltip_WWShieldAmountBase") + c("Tooltip_WWStartShieldAmount") * ap);
    case "hwei_w/we_onhit_magic_damage": return d("Tooltip_WEBaseOnHitDamage") + c("Tooltip_WEOnHitDamage") * ap;
    case "hwei_w/we_total_magic_damage": return 3 * (d("Tooltip_WEBaseOnHitDamage") + c("Tooltip_WEOnHitDamage") * ap);
    case "hwei_w/we_total_mana_restore": return 3 * d("Tooltip_WEOnHitManaRestore");
    case "hwei_e/eq_magic_damage": return d("Tooltip_EQBaseDamage") + c("Tooltip_EQDamage") * ap;
    case "hwei_e/ew_magic_damage": return d("Tooltip_EWBaseDamage") + c("Tooltip_EWDamage") * ap;
    case "hwei_e/ee_magic_damage": return d("Tooltip_EEBaseDamage") + c("Tooltip_EEDamage") * ap;
    case "hwei_e/ee_slow_percent_points": return d("Tooltip_EESlowAmount");
    case "hwei_r/explosion_magic_damage": return d("RBaseDamage") + c("Damage") * ap;
    case "hwei_r/dot_magic_damage_per_second": return d("BaseDamageOverTime") + c("DamageOverTime") * ap;
    case "hwei_r/total_max_magic_damage": return d("RBaseDamage") + d("BaseDamageOverTime") * d("Duration") + c("TotalMaxDamage") * ap;
    case "locke_p/minimum_magic_damage": return run.actual_min_onhit_base + c("MinOnHitDamage") * ap;
    case "locke_p/maximum_magic_damage": return run.actual_max_onhit_base + c("MaxOnHitDamage") * ap;
    case "locke_q/missile_magic_damage": return d("BaseMissileDamage") + c("MissileDamage") * ap;
    case "locke_q/mark_magic_damage": return d("MarkDamage") + d("MarkRatio") * ap;
    case "locke_q/two_mark_magic_damage": return 1.2 * (d("MarkDamage") + d("MarkRatio") * ap);
    case "locke_q/three_mark_magic_damage": return 1.4 * (d("MarkDamage") + d("MarkRatio") * ap);
    case "locke_w/initial_move_speed_ratio": return d("BaseMoveSpeed") + c("MoveSpeed") * ap;
    case "locke_w/decay_total_time_ms": return (d("DecayTime") + d("TimeMaxPower")) * 1000;
    case "locke_w/attack_speed_ratio": return run.actual_attack_speed_ratio;
    case "locke_w/self_damage_per_second": return d("HealthCost") * context.source.hpTotal;
    case "locke_w/damage_restore_amount": return d("BaseDamageRestoreAmount") + c("DamageRestoreAmount") * ap;
    case "locke_w/additional_heal_amount": return run.actual_additional_heal;
    case "locke_w/max_healing_threshold": return run.actual_max_healing_threshold;
    case "locke_e/arrival_magic_damage": return d("BaseOnHitDamage") + c("OnHitDamage") * ap;
    case "locke_e/dash_magic_damage": return d("BaseDashDamage") + d("APRatio") * ap;
    case "locke_r/magic_damage": return d("BaseDamage") + c("Damage") * ap;
    case "locke_r/execute_bonus_ratio": return run.sealed_hero_count * d("ExecuteThresholdPerStack");
    case "locke_r/execute_threshold_ratio": return d("ExecutionThreshold") + run.sealed_hero_count * d("ExecuteThresholdPerStack");
    case "zaahen_p/bonus_ad_ratio_total": return run.stack_count * run.actual_bonus_ad_per_stack_ratio;
    case "zaahen_p/full_stack_bonus_ad_ratio": return d("MaxStacksMultiplier") * run.stack_count * run.actual_bonus_ad_per_stack_ratio;
    case "zaahen_p/revive_health_ratio": return run.actual_revive_health_ratio;
    case "zaahen_p/revive_cooldown": return context.characterLevel >= 16 ? 120000 : context.characterLevel >= 11 ? 180000 : context.characterLevel >= 6 ? 240000 : 300000;
    case "zaahen_q/first_attack_physical_damage": return d("Q1BaseDamage") + d("QCoeff") * bad;
    case "zaahen_q/recast_attack_physical_damage": return d("Q2BaseDamage") + d("QCoeff") * bad;
    case "zaahen_q/self_max_health_heal_ratio": return d("HealPercent");
    case "zaahen_w/initial_physical_damage": return d("InitialBaseDamage") + c("InitialDamage") * bad;
    case "zaahen_w/secondary_physical_damage": return d("SecondaryBaseDamage") + c("SecondaryDamage") * bad;
    case "zaahen_e/inner_physical_damage": return d("Damage_Base") + c("BaseDamageCalc") * bad;
    case "zaahen_e/outer_physical_damage": return d("SweetSpotDamageMod") * (d("Damage_Base") + c("BaseDamageCalc") * bad);
    case "zaahen_e/outer_magic_health_damage": return d("PercentHPDamage") * hp;
    case "zaahen_r/end_physical_damage": return d("EndDamage") + d("BonusADDamageRatio") * bad;
    case "zaahen_r/self_healing_from_actual_damage": return d("HealPercent") * run.actual_eligible_damage;
    default: throw new Error(`缺少独立期望公式：${k}`);
  }
};

const operationNodeCount = node => {
  if (!node) return 0;
  if (node.nodeType !== "OPERATION") return 0;
  return 1 + operationNodeCount(node.operands?.[0]) + operationNodeCount(node.operands?.[1]);
};

// 六类载荷结构、模式和整数毫秒检查。
const requiredKinds = ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"];
let formulaCount = 0;
let operationCount = 0;
let runtimeParameterCount = 0;
let levelArrayCount = 0;
let characterArrayCount = 0;
for (const [skillKey, skill] of Object.entries(candidate.skills)) {
  for (const kind of requiredKinds) assert(Array.isArray(skill.write[kind]), `六类载荷缺失：${skillKey}/${kind}`);
  const params = paramsOf(skillKey);
  for (const parameter of skill.write.parameters) {
    if (parameter.valueMode === "RUNTIME_INPUT") {
      runtimeParameterCount += 1;
      assert(parameter.fixedValue === null && parameter.levelValues === null, `运行输入带默认值：${skillKey}/${parameter.parameterKey}`);
    }
    if (parameter.valueMode === "SKILL_LEVEL") {
      levelArrayCount += 1;
      assert(Object.keys(parameter.levelValues || {}).length === skill.maxLevel, `技能等级数组长度错误：${skillKey}/${parameter.parameterKey}`);
      assert(Object.values(parameter.levelValues || {}).every(Number.isFinite), `技能等级数组有非数字：${skillKey}/${parameter.parameterKey}`);
    }
    if (parameter.valueMode === "CHARACTER_LEVEL") {
      characterArrayCount += 1;
      const keys = Object.keys(parameter.levelValues || {});
      assert(keys.length === 18 && keys.every((key, index) => key === String(index + 1)), `角色18级数组错误：${skillKey}/${parameter.parameterKey}`);
      assert(Object.values(parameter.levelValues || {}).every(Number.isFinite), `角色18级数组有非数字：${skillKey}/${parameter.parameterKey}`);
    }
    if (parameter.valueMode === "FIXED") {
      assert(Number.isFinite(parameter.fixedValue), `固定参数非数字：${skillKey}/${parameter.parameterKey}`);
      assert(parameter.fixedValue !== 0, `固定参数使用0占位：${skillKey}/${parameter.parameterKey}`);
    }
    if (parameter.parameterKey.endsWith("_ms")) {
      const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
      assert(values.every(value => Number.isInteger(value) && value >= 0), `毫秒参数不是非负整数：${skillKey}/${parameter.parameterKey}`);
    }
  }
  for (const formula of skill.write.formulas) {
    formulaCount += 1;
    operationCount += operationNodeCount(formula.expression);
    try {
      for (let scenario = 0; scenario < 2; scenario += 1) {
        const context = scenarioOf(skillKey, scenario);
        const actual = evaluateFormula(skillKey, formula.formulaKey, context);
        const expectedValue = expected(skillKey, formula.formulaKey, context);
        assert(Number.isFinite(actual), `公式结果非数字：${skillKey}/${formula.formulaKey}/场景${scenario + 1}`);
        assert(near(actual, expectedValue), `公式源值不一致：${skillKey}/${formula.formulaKey}/场景${scenario + 1}，候选=${actual}，期望=${expectedValue}`);
        formula._math = { scenario: scenario + 1, actual, expected: expectedValue, passed: near(actual, expectedValue) };
      }
    } catch (error) {
      failures.push(`公式核算异常：${skillKey}/${formula.formulaKey}：${error.message}`);
    }
    delete formula._math;
  }
}

// 每个运行输入都必须在缺值时拒绝，不能悄悄回退为零或其他默认值。
let missingInputChecks = 0;
for (const [skillKey, skill] of Object.entries(candidate.skills)) {
  for (const parameter of skill.write.parameters.filter(item => item.valueMode === "RUNTIME_INPUT")) {
    const context = scenarioOf(skillKey, 0);
    delete context.runtime[parameter.parameterKey];
    try {
      resolveParameter(skillKey, parameter.parameterKey, context);
      failures.push(`缺值未拒绝：${skillKey}/${parameter.parameterKey}`);
    } catch {
      missingInputChecks += 1;
    }
  }
}

// 用来源计算树单独复核关键源系数、倍率和比例属性的最终效果。
const coefficientChecks = [
  ["belveth_q", "total_ad_ratio", "DataValue ADRatio", "ADRatio", 1],
  ["belveth_q", "attack_speed_to_haste_ratio", "DataValue PerSideCDAttackSpeedMultiplier", "PerSideCDAttackSpeedMultiplier", 1],
  ["belveth_w", "damage_coefficient", "Damage mCoefficient", "Damage", 1],
  ["belveth_e", "onhit_damage_ad_ratio", "DamagePerStrike mCoefficient", "DamagePerStrike", 1],
  ["belveth_e", "attack_speed_strike_ratio", "TotalStrikes mCoefficient", "TotalStrikes", 1],
  ["belveth_r", "bonus_ad_ratio", "FinalOnHitDamage mCoefficient", "FinalOnHitDamage", 1],
  ["hwei_p", "mark_ap_ratio", "TotalDamage mCoefficient", "TotalDamage", 1],
  ["hwei_q", "qq_ap_ratio", "Tooltip_QQDamage mCoefficient", "Tooltip_QQDamage", 1],
  ["hwei_q", "qw_ap_ratio", "Tooltip_QWDamage mCoefficient", "Tooltip_QWDamage", 1],
  ["hwei_q", "qe_ap_ratio", "Tooltip_QEDamage mCoefficient", "Tooltip_QEDamage", 1],
  ["hwei_q", "qe_dps_ap_ratio", "Tooltip_QEDamagePerSecond mCoefficient", "Tooltip_QEDamagePerSecond", 1],
  ["hwei_w", "wq_ap_ratio", "Tooltip_WQMoveSpeed mCoefficient", "Tooltip_WQMoveSpeed", 1],
  ["hwei_w", "ww_shield_ap_ratio", "Tooltip_WWShieldAmount mCoefficient", "Tooltip_WWShieldAmount", 1],
  ["hwei_w", "we_onhit_ap_ratio", "Tooltip_WEOnHitDamage mCoefficient", "Tooltip_WEOnHitDamage", 1],
  ["hwei_e", "eq_ap_ratio", "补充技法EQ Damage mCoefficient", "Tooltip_EQDamage", 1],
  ["hwei_e", "ew_ap_ratio", "补充技法EW Damage mCoefficient", "Tooltip_EWDamage", 1],
  ["hwei_e", "ee_ap_ratio", "补充技法EE Damage mCoefficient", "Tooltip_EEDamage", 1],
  ["hwei_r", "explosion_ap_ratio", "Damage mCoefficient", "Damage", 1],
  ["hwei_r", "dot_ap_ratio", "DamageOverTime mCoefficient", "DamageOverTime", 1],
  ["hwei_r", "total_max_ap_ratio", "TotalMaxDamage mCoefficient", "TotalMaxDamage", 1],
  ["locke_p", "min_onhit_ap_ratio", "MinOnHitDamage mCoefficient", "MinOnHitDamage", 1],
  ["locke_p", "max_onhit_ap_ratio", "MaxOnHitDamage mCoefficient", "MaxOnHitDamage", 1],
  ["locke_q", "missile_ap_ratio", "MissileDamage mCoefficient", "MissileDamage", 1],
  ["locke_w", "move_speed_ap_ratio", "MoveSpeed mCoefficient", "MoveSpeed", 1],
  ["locke_w", "damage_restore_ap_ratio", "DamageRestoreAmount mCoefficient", "DamageRestoreAmount", 1],
  ["locke_e", "dash_ap_ratio", "DataValue APRatio", "APRatio", null],
  ["locke_r", "damage_ap_ratio", "Damage mCoefficient", "Damage", 1],
  ["zaahen_w", "initial_bonus_ad_ratio", "InitialDamage mCoefficient", "InitialDamage", 1],
  ["zaahen_w", "secondary_bonus_ad_ratio", "SecondaryDamage mCoefficient", "SecondaryDamage", 1],
  ["zaahen_e", "inner_bonus_ad_ratio", "BaseDamageCalc mCoefficient", "BaseDamageCalc", 1],
  ["zaahen_r", "bonus_ad_ratio", "DataValue BonusADDamageRatio", "BonusADDamageRatio", null],
];
const techniqueCoefficient = (skillKey, calcName) => {
  const item = techniqueOf(skillKey, calcName === "Tooltip_EQDamage" ? "HweiEQ" : calcName === "Tooltip_EWDamage" ? "HweiEW" : "HweiEE");
  return item.raw.calculations.Damage.mFormulaParts[1].mCoefficient;
};
const coefficientResults = [];
for (const [skillKey, parameterKey, description, calcName, index] of coefficientChecks) {
  const parameter = paramsOf(skillKey).get(parameterKey);
  let sourceValue;
  if (skillKey === "hwei_e") sourceValue = techniqueCoefficient(skillKey, calcName);
  else if (index === null) sourceValue = sourceData(skillKey, calcName, 1);
  else if (skillKey === "belveth_e" && parameterKey === "attack_speed_strike_ratio") sourceValue = sourceOf(skillKey).rawCalculations.TotalStrikes.mFormulaParts[1].mPart2.mCoefficient;
  else if (skillKey === "belveth_q" && parameterKey === "total_ad_ratio") sourceValue = sourceData(skillKey, "ADRatio", 1);
  else if (skillKey === "belveth_q" && parameterKey === "attack_speed_to_haste_ratio") sourceValue = sourceData(skillKey, "PerSideCDAttackSpeedMultiplier", 1);
  else sourceValue = sourceCoefficient(skillKey, calcName, index);
  assert(parameter && near(parameter.fixedValue, sourceValue), `源系数候选不一致：${skillKey}/${parameterKey}`);
  coefficientResults.push({ skillKey, parameterKey, description, sourceValue, candidateValue: parameter?.fixedValue, passed: Boolean(parameter && near(parameter.fixedValue, sourceValue)) });
}

const effectResults = [];
for (const [skillKey, skill] of Object.entries(candidate.skills)) {
  for (const effect of skill.write.effects) {
    for (const result of effect.results || []) {
      if (result.valueRule?.value?.kind === "FORMULA") {
        const formulaKey = result.valueRule.value.formulaKey;
        for (let scenario = 0; scenario < 2; scenario += 1) {
          const context = scenarioOf(skillKey, scenario);
          const value = evaluateFormula(skillKey, formulaKey, context);
          const finalValue = value * result.valueRule.fixedMultiplier;
          assert(Number.isFinite(finalValue), `效果最终值非数字：${skillKey}/${effect.effectKey}/${result.resultKey}`);
          effectResults.push({ skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, formulaKey, scenario: scenario + 1, formulaValue: value, fixedMultiplier: result.valueRule.fixedMultiplier, finalValue });
        }
      }
      if (result.resultType === "ATTRIBUTE_CHANGE") assert(result.detail?.modifierZoneKey === "attribute_flat_add", `属性效果未使用固定加算区：${skillKey}/${effect.effectKey}`);
    }
  }
}

// 彗补充技法九对象必须仍在Q/W/E既有组内，并且不生成新主体。
const hweiSource = sourceOf("hwei_e");
const techniqueNames = hweiSource.techniqueSources?.map(item => item.objectName) || [];
assert(techniqueNames.length === 3 && ["HweiEQ", "HweiEW", "HweiEE"].every(name => techniqueNames.includes(name)), "彗E组技法补充对象不完整");
assert(sourceOf("hwei_q").techniqueSources?.length === 3 && sourceOf("hwei_w").techniqueSources?.length === 3, "彗Q/W组技法补充对象不完整");

const report = {
  generatedAt: new Date().toISOString(),
  batch: candidate.meta.batch,
  revision: candidate.meta.revision,
  status: failures.length === 0 ? "通过" : "未通过",
  method: "候选表达式由本脚本解释；期望值独立读取来源数组、来源计算树和技法补充对象，再以两个等级/属性场景比较。",
  sourceVersion: candidate.meta.sourceVersion,
  sourceBindingSha256: candidate.meta.sourceBindingSha256,
  sourceSummarySha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(here, "来源值摘要.json"))).digest("hex"),
  scenarioDefinitions: [
    { id: 1, skillLevel: "1", characterLevel: 1, source: { abilityPower: 80, attackDamageTotal: 120, attackDamageBonus: 40, hpTotal: 1200 }, target: { hpTotal: 1800 } },
    { id: 2, skillLevel: "最高等级", characterLevel: 18, source: { abilityPower: 500, attackDamageTotal: 300, attackDamageBonus: 180, hpTotal: 2200 }, target: { hpTotal: 2600 } },
  ],
  counts: { skills: Object.keys(candidate.skills).length, formulas: formulaCount, operationNodes: operationCount, runtimeParameters: runtimeParameterCount, missingInputChecks, skillLevelArrays: levelArrayCount, characterLevelArrays: characterArrayCount, effects: effectResults.length / 2 },
  formulaChecks: Object.fromEntries(Object.entries(candidate.skills).map(([skillKey, skill]) => [skillKey, skill.write.formulas.map(formula => {
    const checks = [];
    for (let scenario = 0; scenario < 2; scenario += 1) {
      const context = scenarioOf(skillKey, scenario);
      const actual = evaluateFormula(skillKey, formula.formulaKey, context);
      const expectedValue = expected(skillKey, formula.formulaKey, context);
      checks.push({ scenario: scenario + 1, actual, expected: expectedValue, passed: near(actual, expectedValue) });
    }
    return { formulaKey: formula.formulaKey, checks };
  })])),
  coefficientChecks: coefficientResults,
  effectFinalValueChecks: effectResults,
  unitChecks: {
    allMillisecondsIntegers: failures.every(message => !message.includes("毫秒参数")),
    allFixedValuesFiniteAndNonzero: failures.every(message => !message.includes("固定参数")),
    attributeRatioModifierZone: "attribute_flat_add",
    ratioUnit: "比例字段按1=100%；属性效果使用固定加算区",
  },
  failures,
  noBusinessApiCalls: true,
};
const reportBytes = JSON.stringify(report, null, 2) + "\n";
fs.writeFileSync(path.join(here, "独立数学报告.json"), reportBytes);
fs.mkdirSync(durable, { recursive: true });
fs.writeFileSync(path.join(durable, "独立数学报告.json"), reportBytes);
if (failures.length) {
  console.error(JSON.stringify({ status: report.status, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: report.status, formulas: formulaCount, operationNodes: operationCount, runtimeParameters: runtimeParameterCount, missingInputChecks, effects: effectResults.length / 2 }));
}

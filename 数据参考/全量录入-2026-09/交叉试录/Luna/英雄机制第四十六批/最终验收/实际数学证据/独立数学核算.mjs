import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "..", "..", "..");
const review = path.join(workspace, ".agents", "artifacts", "hero46-independent-review");
const frozenCandidateFile = path.join(workspace, ".agents", "artifacts", "hero46-luna-candidate", "修订一", "完整候选.json");
const candidateFile = path.join(review, "GET覆盖候选.json");
const snapshotFile = path.join(review, "GET复核快照.json");
const getReportFile = path.join(review, "GET复核报告.json");
const sourceSummaryFile = path.join(workspace, ".agents", "artifacts", "hero46-luna-candidate", "修订一", "来源值摘要.json");
const candidate = JSON.parse(fs.readFileSync(candidateFile, "utf8"));
const frozenCandidate = JSON.parse(fs.readFileSync(frozenCandidateFile, "utf8"));
const getSnapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
const getReport = JSON.parse(fs.readFileSync(getReportFile, "utf8"));
const sourceSummary = JSON.parse(fs.readFileSync(sourceSummaryFile, "utf8"));
const sources = sourceSummary.sourceValues;
const epsilon = 1e-6;
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};
const near = (actual, expected) => Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(actual), Math.abs(expected));
const sha256File = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert(getReport.statusPass === true, "GET独立复核未通过");
assert(getSnapshot.protectedBaseline?.length === 198 && getSnapshot.finalDetails?.length === 330, "GET快照数量不是198+330");
assert(getSnapshot.overlay?.replacementCount === 304, "GET快照未覆盖全部304个新建项");
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
const sourceArrayData = (skillKey, name, level) => {
  const value = name.startsWith("rawFields.")
    ? sourceOf(skillKey).rawFields[name.slice("rawFields.".length)]?.[level]
    : sourceData(skillKey, name, level);
  assert(Number.isFinite(value), `源字段级别值缺失：${skillKey}/${name}/${level}`);
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
      hpCurrent: scenario === 0 ? 700 : 1500,
    },
    target: { hpTotal: scenario === 0 ? 1800 : 2600 },
    runtime,
  };
};
const attributeValue = (node, context) => {
  const owner = node.attributeOwner === "TARGET" ? context.target : context.source;
  if (node.attributeKey === "ability_power") return owner.abilityPower;
  if (node.attributeKey === "attack_damage") return node.attributeValueKind === "BONUS" ? owner.attackDamageBonus : owner.attackDamageTotal;
  if (node.attributeKey === "hp") {
    if (node.attributeValueKind === "CURRENT") return owner.hpCurrent;
    if (node.attributeValueKind === "TOTAL") return owner.hpTotal;
  }
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
  const currentHp = context.source.hpCurrent;
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
    case "locke_q/two_mark_magic_damage": return (1 + d("TwoMarkBonusPercent") / 100) * (2 * (d("MarkDamage") + d("MarkRatio") * ap));
    case "locke_q/three_mark_magic_damage": return (1 + d("ThreeMarkBonusPercent") / 100) * (3 * (d("MarkDamage") + d("MarkRatio") * ap));
    case "locke_w/initial_move_speed_ratio": return d("BaseMoveSpeed") + c("MoveSpeed") * ap;
    case "locke_w/decay_total_time_ms": return (d("DecayTime") + d("TimeMaxPower")) * 1000;
    case "locke_w/attack_speed_ratio": return run.actual_attack_speed_ratio;
    case "locke_w/self_damage_per_second": return d("HealthCost") * currentHp;
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
let integerValueCount = 0;
let integerValuePassCount = 0;
let finiteValueCount = 0;
let finiteValuePassCount = 0;
const formulaStructureFailures = [];
const walkFormulaStructure = (skillKey, formulaKey, node, location = "expression") => {
  if (!node || typeof node !== "object") {
    formulaStructureFailures.push(`${skillKey}/${formulaKey}/${location}:公式节点为空`);
    return;
  }
  if (node.nodeType === "OPERATION") {
    if (!["ADD", "MULTIPLY"].includes(node.operation) || !Array.isArray(node.operands) || node.operands.length !== 2) formulaStructureFailures.push(`${skillKey}/${formulaKey}/${location}:操作必须是允许的二元操作`);
    (node.operands || []).forEach((child, index) => walkFormulaStructure(skillKey, formulaKey, child, `${location}.operands[${index}]`));
    return;
  }
  if (node.nodeType === "PARAMETER" || node.nodeType === "ATTRIBUTE") return;
  formulaStructureFailures.push(`${skillKey}/${formulaKey}/${location}:未知公式节点类型${node.nodeType}`);
};
const finiteWalk = (skillKey, value, location = "write") => {
  if (typeof value === "number") {
    finiteValueCount += 1;
    if (Number.isFinite(value)) finiteValuePassCount += 1;
    else failures.push(`原生数值非有限：${skillKey}/${location}`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => finiteWalk(skillKey, item, `${location}[${index}]`));
  if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) finiteWalk(skillKey, item, `${location}.${key}`);
};
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
      const expectedKeys = Array.from({ length: skill.maxLevel }, (_, index) => String(index + 1));
      assert(JSON.stringify(Object.keys(parameter.levelValues || {})) === JSON.stringify(expectedKeys), `技能等级数组键错误：${skillKey}/${parameter.parameterKey}`);
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
    const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
    if (parameter.valueType === "INTEGER") {
      integerValueCount += values.length;
      const passed = values.every(value => Number.isInteger(value) && Number.isFinite(value));
      if (passed) integerValuePassCount += values.length;
      assert(passed, `INTEGER参数含非整数或非有限值：${skillKey}/${parameter.parameterKey}`);
    }
    if (parameter.parameterKey.endsWith("_ms")) {
      const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
      assert(values.every(value => Number.isInteger(value) && value >= 0), `毫秒参数不是非负整数：${skillKey}/${parameter.parameterKey}`);
    }
  }
  for (const formula of skill.write.formulas) {
    formulaCount += 1;
    operationCount += operationNodeCount(formula.expression);
    walkFormulaStructure(skillKey, formula.formulaKey, formula.expression);
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
  finiteWalk(skillKey, skill.write);
}
for (const failure of formulaStructureFailures) failures.push(failure);

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
      if (result.valueRule?.value?.kind === "FORMULA" || result.valueRule?.value?.kind === "PARAMETER") {
        const valueKind = result.valueRule.value.kind;
        const valueKey = valueKind === "FORMULA" ? result.valueRule.value.formulaKey : result.valueRule.value.parameterKey;
        for (let scenario = 0; scenario < 2; scenario += 1) {
          const context = scenarioOf(skillKey, scenario);
          const value = valueKind === "FORMULA" ? evaluateFormula(skillKey, valueKey, context) : resolveParameter(skillKey, valueKey, context);
          const finalValue = value * result.valueRule.fixedMultiplier;
          assert(Number.isFinite(finalValue), `效果最终值非数字：${skillKey}/${effect.effectKey}/${result.resultKey}`);
          effectResults.push({ skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, valueKind, valueKey, scenario: scenario + 1, value, fixedMultiplier: result.valueRule.fixedMultiplier, finalValue });
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

// 所有技能等级数组均与独立源摘要的对应数组逐项比较；毫秒字段按已证秒值转换。
const levelSourceChecks = [
  ["belveth_q", "damage_base", "Damage", 5, value => value],
  ["belveth_q", "per_side_cooldown_ms", "PerSideCooldown", 5, value => Math.round(value * 1000)],
  ["belveth_q", "overall_cooldown_ms", "rawFields.cooldownTime", 5, value => Math.round(value * 1000)],
  ["belveth_w", "damage_base", "BaseDamage", 5, value => value],
  ["belveth_w", "knockup_duration_ms", "Duration", 5, value => Math.round(value * 1000)],
  ["belveth_e", "damage_per_hit_base", "DamagePerHit", 5, value => value],
  ["belveth_e", "base_strike_count", "NumberOfStrikes", 5, value => value],
  ["belveth_e", "damage_reduction_ratio", "DRPercent", 5, value => value],
  ["belveth_e", "life_steal_ratio", "BonusLifeSteal", 5, value => value],
  ["belveth_r", "passive_onhit_base", "OnHitDamage", 3, value => value],
  ["hwei_q", "qq_damage_base", "Tooltip_QQBaseDamage", 5, value => value],
  ["hwei_q", "qq_target_hp_percent_points", "Tooltip_QQBonusDamage", 5, value => value],
  ["hwei_q", "qw_damage_base", "Tooltip_QWBaseDamage", 5, value => value],
  ["hwei_q", "qw_condition_max_multiplier", "Tooltip_QWBonusDamageMult", 5, value => value],
  ["hwei_q", "qe_burst_base", "Tooltip_QEBaseDamage", 5, value => value],
  ["hwei_q", "qe_damage_per_second_base", "Tooltip_QEBaseDPS", 5, value => value],
  ["hwei_w", "wq_move_speed_base", "Tooltip_WQBaseMoveSpeed", 5, value => value],
  ["hwei_w", "wq_area_duration_ms", "Tooltip_WQAreaDuration", 5, value => Math.round(value * 1000)],
  ["hwei_w", "ww_shield_base", "Tooltip_WWShieldAmountBase", 5, value => value],
  ["hwei_w", "we_onhit_base_damage", "Tooltip_WEBaseOnHitDamage", 5, value => value],
  ["hwei_w", "we_mana_restore", "Tooltip_WEOnHitManaRestore", 5, value => value],
  ["hwei_e", "eq_damage_base", "Tooltip_EQBaseDamage", 5, value => value],
  ["hwei_e", "eq_flee_duration_ms", "Tooltip_EQFleeDuration", 5, value => Math.round(value * 1000)],
  ["hwei_e", "ew_damage_base", "Tooltip_EWBaseDamage", 5, value => value],
  ["hwei_e", "ew_root_duration_ms", "Tooltip_EWRootDuration", 5, value => Math.round(value * 1000)],
  ["hwei_e", "ee_damage_base", "Tooltip_EEBaseDamage", 5, value => value],
  ["hwei_e", "ee_slow_percent_points", "Tooltip_EESlowAmount", 5, value => value],
  ["hwei_r", "explosion_base_damage", "RBaseDamage", 3, value => value],
  ["hwei_r", "dot_base_damage_per_second", "BaseDamageOverTime", 3, value => value],
  ["locke_q", "missile_damage_base", "BaseMissileDamage", 5, value => value],
  ["locke_q", "mark_damage_base", "MarkDamage", 5, value => value],
  ["locke_q", "mark_ap_ratio", "MarkRatio", 5, value => value],
  ["locke_w", "damage_restore_base", "BaseDamageRestoreAmount", 5, value => value],
  ["locke_e", "onhit_damage_base", "BaseOnHitDamage", 5, value => value],
  ["locke_e", "dash_damage_base", "BaseDashDamage", 5, value => value],
  ["locke_r", "damage_base", "BaseDamage", 3, value => value],
  ["locke_r", "execute_base_ratio", "ExecutionThreshold", 3, value => value],
  ["zaahen_q", "first_attack_base_damage", "Q1BaseDamage", 5, value => value],
  ["zaahen_q", "bonus_ad_ratio", "QCoeff", 5, value => value],
  ["zaahen_q", "recast_attack_base_damage", "Q2BaseDamage", 5, value => value],
  ["zaahen_q", "self_max_health_heal_ratio", "HealPercent", 5, value => value],
  ["zaahen_w", "initial_damage_base", "InitialBaseDamage", 5, value => value],
  ["zaahen_w", "secondary_damage_base", "SecondaryBaseDamage", 5, value => value],
  ["zaahen_e", "inner_damage_base", "Damage_Base", 5, value => value],
  ["zaahen_e", "outer_target_max_health_ratio", "PercentHPDamage", 5, value => value],
  ["zaahen_r", "end_damage_base", "EndDamage", 3, value => value],
  ["zaahen_r", "armor_penetration_ratio", "ArmorPen", 3, value => value],
];
const levelArrayResults = [];
for (const [skillKey, parameterKey, sourceName, maxLevel, transform] of levelSourceChecks) {
  const parameter = paramsOf(skillKey).get(parameterKey);
  const source = Object.fromEntries(Array.from({ length: maxLevel }, (_, index) => [String(index + 1), transform(sourceArrayData(skillKey, sourceName, index + 1))]));
  const passed = Boolean(parameter && parameter.valueMode === "SKILL_LEVEL" && Object.keys(parameter.levelValues || {}).length === maxLevel && Object.keys(source).every(key => near(parameter.levelValues[key], source[key])));
  assert(passed, `等级数组源值不一致：${skillKey}/${parameterKey}/${sourceName}`);
  levelArrayResults.push({ skillKey, parameterKey, sourceName, source, candidate: parameter?.levelValues, passed });
}

// 修订项的固定值、单位和原始字段单独从源摘要核对，避免只把候选错误复制到期望侧。
const fixedSourceResults = [];
const fixedSourceCases = [
  ["belveth_p", "stack_ratio_level1", "ASPerStackLevel1Value", "百分数点"],
  ["belveth_p", "stack_ratio_initial_per_level", "ASPerStackInitialBonusPerLevel", "百分数点"],
  ["belveth_p", "stack_ratio_after_level6", "ASPerStackLevel6BonusPerLevel", "百分数点"],
  ["belveth_p", "stack_ratio_after_level11", "ASPerStackLevel11BonusPerLevel", "百分数点"],
];
for (const [skillKey, parameterKey, sourceName, unit] of fixedSourceCases) {
  const parameter = paramsOf(skillKey).get(parameterKey);
  const source = sourceData(skillKey, sourceName, 1);
  const passed = Boolean(parameter && near(parameter.fixedValue, source) && parameter.description.includes(unit));
  assert(passed, `固定源值或单位不一致：${skillKey}/${parameterKey}`);
  fixedSourceResults.push({ skillKey, parameterKey, sourceName, source, candidate: parameter?.fixedValue, unit, passed });
}
const eeDelayParameter = paramsOf("hwei_e").get("ee_delay_ms");
const eeDelaySource = techniqueOf("hwei_e", "HweiEE").raw.dataValues.Delay[1] * 1000;
const eeDelayPassed = Boolean(eeDelayParameter && eeDelayParameter.fixedValue === Math.round(eeDelaySource) && eeDelayParameter.description.includes("600毫秒"));
assert(eeDelayPassed, "彗EE 600毫秒延迟源值不一致");
fixedSourceResults.push({ skillKey: "hwei_e", parameterKey: "ee_delay_ms", sourceField: "HweiEE.Delay[1]", source: eeDelaySource, candidate: eeDelayParameter?.fixedValue, unit: "毫秒", passed: eeDelayPassed });
const twoStackParameter = paramsOf("locke_q").get("two_mark_stack_count");
const threeStackParameter = paramsOf("locke_q").get("three_mark_stack_count");
const maxMarkStacksSource = sourceData("locke_q", "MaxStacks", 1);
const twoMarkBonusSource = sourceData("locke_q", "TwoMarkBonusPercent", 1);
const threeMarkBonusSource = sourceData("locke_q", "ThreeMarkBonusPercent", 1);
const lockeStackPassed = Boolean(twoStackParameter?.fixedValue === maxMarkStacksSource - 1 && threeStackParameter?.fixedValue === maxMarkStacksSource && twoMarkBonusSource === 20 && threeMarkBonusSource === 40);
assert(lockeStackPassed, "洛克Q两层/三层源层数或倍率不一致");
fixedSourceResults.push({ skillKey: "locke_q", parameters: ["two_mark_stack_count", "three_mark_stack_count"], source: { maxMarkStacks: maxMarkStacksSource, twoMarkBonusPercent: twoMarkBonusSource, threeMarkBonusPercent: threeMarkBonusSource }, candidate: { two: twoStackParameter?.fixedValue, three: threeStackParameter?.fixedValue }, passed: lockeStackPassed });
const zaahenSpellParameter = paramsOf("zaahen_e").get("spell_total_time_ms");
const zaahenSpellSource = sourceOf("zaahen_e").rawFields.spellTotalTime * 1000;
const zaahenSpellPassed = Boolean(zaahenSpellParameter && zaahenSpellParameter.fixedValue === Math.round(zaahenSpellSource) && zaahenSpellParameter.name.includes("原始总时间") && zaahenSpellParameter.description.includes("不等同突进耗时"));
assert(zaahenSpellPassed, "亚恒E spellTotalTime原始字段说明不一致");
fixedSourceResults.push({ skillKey: "zaahen_e", parameterKey: "spell_total_time_ms", sourceField: "fields.spellTotalTime", source: zaahenSpellSource, candidate: zaahenSpellParameter?.fixedValue, unit: "毫秒", passed: zaahenSpellPassed });

// 递归检查所有带类型的参数/公式引用，包括生命周期；这是初版遗漏的悬空引用边界。
const publicParameterKeys = new Set(candidate.reusedPublicParameters.map(item => `${item.skillKey}/${item.parameterKey}`));
let typedReferenceCount = 0;
const referenceFailures = [];
const typedKindFailures = [];
const formulaNodeFailures = [];
const walkTypedReferences = (skillKey, value, location = "write") => {
  if (Array.isArray(value)) return value.forEach((item, index) => walkTypedReferences(skillKey, item, `${location}[${index}]`));
  if (!value || typeof value !== "object") return;
  if (Object.prototype.hasOwnProperty.call(value, "kind") && !["PARAMETER", "FORMULA", "FIXED"].includes(value.kind)) typedKindFailures.push(`${skillKey}:${location} -> 未知kind/${value.kind}`);
  if (value.kind === "PARAMETER") {
    typedReferenceCount += 1;
    const found = paramsOf(skillKey).has(value.parameterKey) || publicParameterKeys.has(`${skillKey}/${value.parameterKey}`);
    if (!found) referenceFailures.push(`${skillKey}:${location} -> PARAMETER/${value.parameterKey}`);
  }
  if (value.kind === "FORMULA") {
    typedReferenceCount += 1;
    const found = Boolean(formulaOf(skillKey, value.formulaKey));
    if (!found) referenceFailures.push(`${skillKey}:${location} -> FORMULA/${value.formulaKey}`);
  }
  if (Object.prototype.hasOwnProperty.call(value, "nodeType") && !["OPERATION", "PARAMETER", "ATTRIBUTE"].includes(value.nodeType)) formulaNodeFailures.push(`${skillKey}:${location} -> 未知nodeType/${value.nodeType}`);
  if (value.nodeType === "OPERATION" && (!Array.isArray(value.operands) || value.operands.length !== 2 || !["ADD", "MULTIPLY"].includes(value.operation))) formulaNodeFailures.push(`${skillKey}:${location} -> 非二元或未知操作/${value.operation}`);
  if (value.nodeType === "ATTRIBUTE" && (!["SOURCE", "TARGET"].includes(value.attributeOwner) || !["BASE", "BONUS", "TOTAL", "CURRENT", "MISSING", "CURRENT_RATIO", "MISSING_RATIO"].includes(value.attributeValueKind))) formulaNodeFailures.push(`${skillKey}:${location} -> 属性节点层级非法`);
  if (value.nodeType === "PARAMETER") {
    typedReferenceCount += 1;
    const found = paramsOf(skillKey).has(value.parameterKey) || publicParameterKeys.has(`${skillKey}/${value.parameterKey}`);
    if (!found) referenceFailures.push(`${skillKey}:${location} -> node PARAMETER/${value.parameterKey}`);
  }
  if (value.nodeType === "FORMULA") {
    typedReferenceCount += 1;
    const found = Boolean(formulaOf(skillKey, value.formulaKey));
    if (!found) referenceFailures.push(`${skillKey}:${location} -> node FORMULA/${value.formulaKey}`);
  }
  for (const [key, child] of Object.entries(value)) walkTypedReferences(skillKey, child, `${location}.${key}`);
};
for (const [skillKey, item] of Object.entries(candidate.skills)) walkTypedReferences(skillKey, item.write);
assert(referenceFailures.length === 0, `存在悬空类型引用：${referenceFailures.join("；")}`);
assert(typedKindFailures.length === 0, `存在未知typed类型：${typedKindFailures.join("；")}`);
assert(formulaNodeFailures.length === 0, `存在非法公式节点：${formulaNodeFailures.join("；")}`);

// 属性效果必须使用固定加算区；修订后亚恒P不应再出现把比例直接写成攻击力的效果。
const ratioAttributes = new Set(["bonus_attack_speed_percent", "move_speed_percent", "life_steal_percent", "armor_pen_percent", "attack_speed_percent", "attack_damage_percent"]);
let ratioAttributeEffectCount = 0;
for (const [skillKey, item] of Object.entries(candidate.skills)) {
  for (const effect of item.write.effects) for (const result of effect.results || []) {
    if (result.resultType === "ATTRIBUTE_CHANGE") {
      assert(result.detail?.modifierZoneKey === "attribute_flat_add", `属性效果未使用固定加算区：${skillKey}/${effect.effectKey}`);
      if (ratioAttributes.has(result.detail?.attributeKey)) ratioAttributeEffectCount += 1;
    }
  }
}
assert(candidate.skills.belveth_w.write.effects.length === 0, "卑尔维斯W仍有整Q重置效果");
assert(candidate.skills.zaahen_p.write.effects.length === 0, "亚恒P仍有未经基准证明的直接攻击力效果");
const selfDamageFormula = formulaOf("locke_w", "self_damage_per_second");
const selfDamageHpNode = selfDamageFormula?.expression?.operands?.[1];
assert(selfDamageHpNode?.attributeOwner === "SOURCE" && selfDamageHpNode?.attributeKey === "hp" && selfDamageHpNode?.attributeValueKind === "CURRENT", "洛克W自伤未读取SOURCE.hp.CURRENT");
const selfMoveEffect = skillOf("locke_w").write.effects.find(item => item.effectKey === "self_move_speed");
assert(selfMoveEffect?.lifecycle?.durationValue?.kind === "FORMULA" && selfMoveEffect.lifecycle.durationValue.formulaKey === "decay_total_time_ms", "洛克W移速生命周期未引用衰减总公式");
const manaEffect = skillOf("hwei_w").write.effects.find(item => item.effectKey === "we_mana_restore");
assert(manaEffect?.results?.[0]?.valueRule?.value?.kind === "PARAMETER" && manaEffect.results[0].valueRule.value.parameterKey === "we_mana_restore", "彗WE回蓝效果未引用每次参数");
assert(!JSON.stringify(candidate).includes("w_group_m_cast_time_ms"), "彗W菜单250毫秒参数仍存在");
assert(!JSON.stringify(candidate).includes("dash_stage_duration_ms"), "亚恒E旧冲刺时长参数仍存在");
assert(candidate.skills.zaahen_e.write.parameters.some(item => item.parameterKey === "spell_total_time_ms"), "亚恒E原始总时间参数缺失");
assert(scenarioOf("locke_w", 0).source.hpCurrent !== scenarioOf("locke_w", 0).source.hpTotal && scenarioOf("locke_w", 1).source.hpCurrent !== scenarioOf("locke_w", 1).source.hpTotal, "当前生命场景未与最大生命区分");

const focusedChecks = {
  belvethEDamageReduction: {
    sourceField: "DRPercent[1..5]",
    source: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [String(index + 1), sourceData("belveth_e", "DRPercent", index + 1)])),
    candidate: paramsOf("belveth_e").get("damage_reduction_ratio")?.levelValues,
    passed: levelArrayResults.find(item => item.skillKey === "belveth_e" && item.parameterKey === "damage_reduction_ratio")?.passed === true,
  },
  lockeQMultiMark: [0, 1].map(scenario => {
    const context = scenarioOf("locke_q", scenario);
    const twoActual = evaluateFormula("locke_q", "two_mark_magic_damage", context);
    const threeActual = evaluateFormula("locke_q", "three_mark_magic_damage", context);
    const mark = sourceData("locke_q", "MarkDamage", context.skillLevel) + sourceData("locke_q", "MarkRatio", context.skillLevel) * context.source.abilityPower;
    const twoExpected = (1 + sourceData("locke_q", "TwoMarkBonusPercent", context.skillLevel) / 100) * (2 * mark);
    const threeExpected = (1 + sourceData("locke_q", "ThreeMarkBonusPercent", context.skillLevel) / 100) * (3 * mark);
    const passed = near(twoActual, twoExpected) && near(threeActual, threeExpected);
    assert(passed, `洛克Q多层独立场景不一致：场景${scenario + 1}`);
    return { scenario: scenario + 1, skillLevel: context.skillLevel, abilityPower: context.source.abilityPower, source: { mark, twoLayerBonusPercent: sourceData("locke_q", "TwoMarkBonusPercent", context.skillLevel), threeLayerBonusPercent: sourceData("locke_q", "ThreeMarkBonusPercent", context.skillLevel) }, candidate: { twoActual, threeActual }, expected: { twoExpected, threeExpected }, passed };
  }),
  lockeWCurrentHealth: [0, 1].map(scenario => {
    const context = scenarioOf("locke_w", scenario);
    const actual = evaluateFormula("locke_w", "self_damage_per_second", context);
    const expectedValue = sourceData("locke_w", "HealthCost", context.skillLevel) * context.source.hpCurrent;
    const passed = near(actual, expectedValue) && context.source.hpCurrent !== context.source.hpTotal;
    assert(passed, `洛克W当前生命独立场景不一致：场景${scenario + 1}`);
    return { scenario: scenario + 1, sourceCurrentHp: context.source.hpCurrent, sourceMaxHp: context.source.hpTotal, sourceHealthCost: sourceData("locke_w", "HealthCost", context.skillLevel), candidate: actual, expected: expectedValue, passed };
  }),
  hweiWEachMana: {
    effectValueKind: manaEffect?.results?.[0]?.valueRule?.value?.kind,
    effectValueKey: manaEffect?.results?.[0]?.valueRule?.value?.parameterKey,
    eachSource: sourceData("hwei_w", "Tooltip_WEOnHitManaRestore", 1),
    totalFormulaRetained: Boolean(formulaOf("hwei_w", "we_total_mana_restore")),
    passed: manaEffect?.results?.[0]?.valueRule?.value?.kind === "PARAMETER" && manaEffect.results[0].valueRule.value.parameterKey === "we_mana_restore",
  },
};

const report = {
  generatedAt: new Date().toISOString(),
  batch: candidate.meta.batch,
  revision: candidate.meta.revision,
  status: failures.length === 0 ? "通过" : "未通过",
  method: "最终详情GET快照覆盖全部304个新建项后，由本脚本解释候选表达式；期望值独立读取来源数组、来源计算树和技法补充对象，再以两个等级/属性场景比较。数学阶段不发起额外GET。",
  sourceVersion: candidate.meta.sourceVersion,
  sourceBindingSha256: candidate.meta.sourceBindingSha256,
  sourceSummarySha256: sha256File(sourceSummaryFile),
  frozenCandidateSha256: sha256File(frozenCandidateFile),
  overlayCandidateSha256: sha256File(candidateFile),
  getSnapshotSha256: sha256File(snapshotFile),
  actualWriteSha256: getReport.frozenEvidence?.actualWriteSha256 ?? null,
  getVerification: {
    protectedBaselineGETs: getReport.counts?.protectedBaselineGETs ?? null,
    finalDetailGETs: getReport.counts?.finalDetailGETs ?? null,
    totalGETs: getReport.counts?.totalGETs ?? null,
    expectedTotalGETs: 528,
    finalGETStatusPass: getReport.statusPass === true,
    extraMathGETs: 0,
  },
  scenarioDefinitions: [
    { id: 1, skillLevel: "1", characterLevel: 1, source: { abilityPower: 80, attackDamageTotal: 120, attackDamageBonus: 40, hpTotal: 1200, hpCurrent: 700 }, target: { hpTotal: 1800 } },
    { id: 2, skillLevel: "最高等级", characterLevel: 18, source: { abilityPower: 500, attackDamageTotal: 300, attackDamageBonus: 180, hpTotal: 2200, hpCurrent: 1500 }, target: { hpTotal: 2600 } },
  ],
  counts: { skills: Object.keys(candidate.skills).length, newItems: 304, reusedPublic: 26, protectedBaselineGETs: 198, finalDetailGETs: 330, totalGETs: 528, formulas: formulaCount, formulaScenarios: formulaCount * 2, operationNodes: operationCount, runtimeParameters: runtimeParameterCount, missingInputChecks, skillLevelArrays: levelArrayCount, characterLevelArrays: characterArrayCount, effects: effectResults.length / 2, integerValues: integerValueCount, integerValuePassCount, finiteValues: finiteValueCount, finiteValuePassCount },
  sourceParameterChecks: { levelArrays: levelArrayResults, fixedValues: fixedSourceResults },
  typedReferenceChecks: { checked: typedReferenceCount, passed: typedReferenceCount - referenceFailures.length, failures: referenceFailures, unknownKinds: typedKindFailures, formulaNodeFailures },
  focusedChecks,
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
    ratioUnit: "比例字段按1=100%；卑尔维斯P四个固定断点字段按百分数点保存；属性效果使用固定加算区",
    ratioAttributeEffectCount,
  },
  failures,
  noBusinessApiCalls: true,
  noExtraMathGETs: true,
  integerValuesAllPass: integerValueCount === integerValuePassCount,
  finiteValuesAllPass: finiteValueCount === finiteValuePassCount,
};
const reportBytes = JSON.stringify(report, null, 2) + "\n";
fs.writeFileSync(path.join(here, "独立数学报告.json"), reportBytes);
const mathReportFile = path.join(here, "独立数学报告.json");
const mathScriptFile = path.join(here, "独立数学核算.mjs");
fs.writeFileSync(path.join(here, "文件散列.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  files: {
    "独立数学核算.mjs": { sha256: sha256File(mathScriptFile), byteSize: fs.statSync(mathScriptFile).size },
    "独立数学报告.json": { sha256: sha256File(mathReportFile), byteSize: fs.statSync(mathReportFile).size },
  },
  evidence: {
    frozenCandidateSha256: report.frozenCandidateSha256,
    overlayCandidateSha256: report.overlayCandidateSha256,
    getSnapshotSha256: report.getSnapshotSha256,
    actualWriteSha256: report.actualWriteSha256,
    totalGETs: report.getVerification.totalGETs,
    extraMathGETs: report.getVerification.extraMathGETs,
  },
  counts: report.counts,
}, null, 2) + "\n");
if (failures.length) {
  console.error(JSON.stringify({ status: report.status, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: report.status, formulas: formulaCount, operationNodes: operationCount, runtimeParameters: runtimeParameterCount, missingInputChecks, effects: effectResults.length / 2 }));
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const repo = "C:/project/damage_web_dev";
const artifactDir = path.join(repo, ".agents/artifacts/hero29-luna-candidate/修订一");
const durableDir = path.join(repo, "数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第二十九批/修订一");
const inputDir = path.join(repo, ".agents/artifacts/hero29-root-entry-20260909");
const candidatePath = path.join(artifactDir, "完整候选.json");
const sourcePath = path.join(inputDir, "来源绑定与当前文本.json");
const inputVersionPath = path.join(inputDir, "输入版本.json");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const fileSha256 = file => sha256(fs.readFileSync(file));
const candidate = readJson(candidatePath);
const source = readJson(sourcePath);
const inputVersion = readJson(inputVersionPath);
const nearly = (a, b, factor = 1e-6) => Math.abs(Number(a) - Number(b)) <= factor * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));
const errors = [];
const positiveCases = [];
const missingCases = [];
const boundaryCases = [];
const sourceChecks = [];
const recordCheck = (condition, message, detail = undefined) => {
  if (!condition) throw new Error(message + (detail === undefined ? "" : "：" + JSON.stringify(detail)));
};
const sourceEntry = skillKey => {
  const heroId = skillKey.startsWith("ornn_") ? "Ornn" : "Shen";
  const slot = skillKey.slice(-1).toUpperCase();
  const hero = source.heroes.find(item => item.id === heroId);
  const bound = hero?.skills?.find(item => item.slot === slot);
  const summary = hero?.source?.skills?.find(item => item.slot === slot);
  recordCheck(hero && bound && summary, "来源技能缺失", skillKey);
  return { hero, bound, summary, spell: bound.object.mSpell };
};
const sourceSpell = skillKey => sourceEntry(skillKey).spell;
const maxLevel = skillKey => Number(sourceEntry(skillKey).summary.officialMaxRank);
const sourceData = (skillKey, dataName, rank) => {
  const item = sourceSpell(skillKey).DataValues?.find(value => value.name === dataName);
  recordCheck(item && Array.isArray(item.values), "来源数据值缺失", { skillKey, dataName });
  const value = item.values[rank];
  recordCheck(typeof value === "number" && Number.isFinite(value), "来源等级数据缺失", { skillKey, dataName, rank });
  return value;
};
const sourceCalc = (skillKey, calculationKey) => {
  const value = sourceSpell(skillKey).mSpellCalculations?.[calculationKey];
  recordCheck(value, "来源计算树缺失", { skillKey, calculationKey });
  return value;
};
const sourcePart = (skillKey, calculationKey, index) => {
  const value = sourceCalc(skillKey, calculationKey).mFormulaParts?.[index];
  recordCheck(value, "来源计算树分段缺失", { skillKey, calculationKey, index });
  return value;
};
const skillOf = skillKey => {
  const skill = candidate.skills[skillKey];
  recordCheck(skill, "候选技能缺失", skillKey);
  return skill;
};
const parameterOf = (skillKey, parameterKey) => {
  const parameter = skillOf(skillKey).write.parameters.find(item => item.parameterKey === parameterKey);
  recordCheck(parameter, "候选参数缺失", { skillKey, parameterKey });
  return parameter;
};
const runtimeInput = (scenario, key) => {
  recordCheck(Object.prototype.hasOwnProperty.call(scenario.runtime ?? {}, key), "运行输入缺失", key);
  const value = scenario.runtime[key];
  recordCheck(typeof value === "number" && Number.isFinite(value), "运行输入不是有限数值", { key, value });
  return value;
};
const parameterValue = (skillKey, parameterKey, scenario) => {
  const parameter = parameterOf(skillKey, parameterKey);
  let value;
  if (parameter.valueMode === "FIXED") value = parameter.fixedValue;
  else if (parameter.valueMode === "SKILL_LEVEL") value = parameter.levelValues?.[String(scenario.rank)];
  else if (parameter.valueMode === "CHARACTER_LEVEL") {
    recordCheck(Number.isInteger(scenario.characterLevel) && scenario.characterLevel >= 1 && scenario.characterLevel <= 18,
      "角色等级输入缺失或越界", scenario.characterLevel);
    value = parameter.levelValues?.[String(scenario.characterLevel)];
  } else if (parameter.valueMode === "RUNTIME_INPUT") value = runtimeInput(scenario, parameterKey);
  else throw new Error("未知参数取值模式：" + parameter.valueMode);
  recordCheck(typeof value === "number" && Number.isFinite(value), "参数实际值缺失", { skillKey, parameterKey, value });
  if (parameter.valueType === "INTEGER") recordCheck(Number.isInteger(value), "整数参数收到小数", { skillKey, parameterKey, value });
  return value;
};
const attributeValue = (node, scenario) => {
  const key = [node.attributeOwner, node.attributeKey, node.attributeValueKind].join(".");
  const value = scenario.attributes?.[key];
  recordCheck(typeof value === "number" && Number.isFinite(value), "属性输入缺失", key);
  return value;
};
const evaluate = (node, skillKey, scenario) => {
  recordCheck(node && typeof node === "object", "公式节点为空");
  if (node.nodeType === "PARAMETER") return parameterValue(skillKey, node.parameterKey, scenario);
  if (node.nodeType === "ATTRIBUTE") return attributeValue(node, scenario);
  recordCheck(node.nodeType === "OPERATION", "未知公式节点", node.nodeType);
  recordCheck(Array.isArray(node.operands) && node.operands.length === 2, "公式运算必须恰好两个操作数", node);
  const left = evaluate(node.operands[0], skillKey, scenario);
  const right = evaluate(node.operands[1], skillKey, scenario);
  switch (node.operation) {
    case "ADD": return left + right;
    case "SUBTRACT": return left - right;
    case "MULTIPLY": return left * right;
    case "DIVIDE": recordCheck(right !== 0, "公式除数为零"); return left / right;
    case "MIN": return Math.min(left, right);
    case "MAX": return Math.max(left, right);
    default: throw new Error("未知公式运算：" + node.operation);
  }
};
const collectDependencies = (node, skillKey, result = []) => {
  if (node.nodeType === "PARAMETER") {
    const parameter = parameterOf(skillKey, node.parameterKey);
    result.push(parameter.valueMode === "RUNTIME_INPUT"
      ? { kind: "RUNTIME_INPUT", key: node.parameterKey }
      : parameter.valueMode === "CHARACTER_LEVEL"
        ? { kind: "CHARACTER_LEVEL", key: "characterLevel" }
        : null);
  } else if (node.nodeType === "ATTRIBUTE") {
    result.push({ kind: "ATTRIBUTE", key: [node.attributeOwner, node.attributeKey, node.attributeValueKind].join(".") });
  } else for (const operand of node.operands ?? []) collectDependencies(operand, skillKey, result);
  return result.filter(Boolean);
};
const formulaOf = (skillKey, formulaKey) => {
  const formula = skillOf(skillKey).write.formulas.find(item => item.formulaKey === formulaKey);
  recordCheck(formula, "候选公式缺失", { skillKey, formulaKey });
  return formula;
};
const scenario = high => ({
  rank: high ? 5 : 1,
  characterLevel: high ? 18 : 1,
  attributes: {
    "SOURCE.hp.TOTAL": high ? 5200 : 3400,
    "SOURCE.hp.BONUS": high ? 1800 : 650,
    "SOURCE.ability_power.TOTAL": high ? 450 : 150,
    "SOURCE.attack_damage.TOTAL": high ? 350 : 180,
    "SOURCE.magic_resistance.BONUS": high ? 180 : 20,
    "TARGET.hp.TOTAL": high ? 6000 : 2200,
  },
  runtime: {
    actual_masterwork_count: high ? 3 : 0,
    actual_source_hp_before_ornn_passive: high ? 4800 : 3000,
    actual_source_armor_before_ornn_passive: high ? 150 : 80,
    actual_source_magic_resistance_before_ornn_passive: high ? 100 : 40,
    actual_cast_time_ms: high ? 500 : 300,
    actual_brittle_extra_magic_ratio: high ? 0.17 : 0.09,
    actual_source_armor_for_ornn_e: high ? 190 : 75,
    actual_base_shield_value: high ? 120 : 47,
    actual_shield_cooldown_reduction_ms: high ? 1000 : 4000,
  },
});
const scenarioFor = (skillKey, high) => {
  const value = scenario(high);
  value.rank = high ? maxLevel(skillKey) : 1;
  return value;
};

recordCheck(inputVersion.apiWrites === 0, "输入版本已有业务写入");
recordCheck(candidate.meta.apiWrites === 0, "候选标记已有业务写入");
recordCheck(Object.keys(candidate.skills).length === 10, "候选技能槽数量不符");
recordCheck(skillOf("shen_r").write.parameters.length === 0 && skillOf("shen_r").write.formulas.length === 0 && skillOf("shen_r").write.effects.length === 0,
  "慎R不应有本轮写入");
const formulaCount = Object.values(candidate.skills).reduce((total, skill) => total + skill.write.formulas.length, 0);
recordCheck(formulaCount === 18, "公式总数不符", formulaCount);
const publicKeys = new Set(candidate.reusedPublicParameters.map(item => item.skillKey + "|" + item.parameterKey));
recordCheck(publicKeys.size === 11, "公共参数复用数量不符", publicKeys.size);
recordCheck(candidate.postIntents.length === 97, "新增意图数量不符", candidate.postIntents.length);
const intentKeys = new Set();
for (const intent of candidate.postIntents) {
  const key = [intent.skillKey, intent.kind, intent.stableKey].join("|");
  recordCheck(!intentKeys.has(key), "新增意图重复", key);
  intentKeys.add(key);
  recordCheck(!(intent.kind === "parameters" && publicKeys.has(intent.skillKey + "|" + intent.stableKey)), "公共参数被重复写入", key);
  recordCheck(intent.method === "POST", "候选意图不是POST", intent);
}
const permittedOperations = new Set(["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MIN", "MAX"]);
const walkFormula = (node, skillKey, formulaKey) => {
  recordCheck(node && typeof node === "object", "公式节点为空", { skillKey, formulaKey });
  if (node.nodeType === "PARAMETER") {
    parameterOf(skillKey, node.parameterKey);
    return;
  }
  if (node.nodeType === "ATTRIBUTE") {
    recordCheck(["SOURCE", "TARGET"].includes(node.attributeOwner), "公式属性来源非法", node);
    recordCheck(["TOTAL", "BASE", "BONUS"].includes(node.attributeValueKind), "公式属性取值类别非法", node);
    return;
  }
  recordCheck(node.nodeType === "OPERATION" && permittedOperations.has(node.operation), "公式运算非法", node);
  recordCheck(Array.isArray(node.operands) && node.operands.length === 2, "公式运算必须二元", node);
  walkFormula(node.operands[0], skillKey, formulaKey);
  walkFormula(node.operands[1], skillKey, formulaKey);
};
for (const [skillKey, skill] of Object.entries(candidate.skills)) {
  const keys = new Set();
  for (const parameter of skill.write.parameters) {
    recordCheck(!keys.has(parameter.parameterKey), "参数键重复", { skillKey, parameterKey: parameter.parameterKey });
    keys.add(parameter.parameterKey);
    if (parameter.valueMode === "RUNTIME_INPUT") recordCheck(parameter.fixedValue === null && parameter.levelValues === null, "运行输入携带默认值", parameter);
    if (parameter.valueType === "INTEGER") {
      const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues ?? {});
      recordCheck(values.every(value => Number.isInteger(value)), "整数参数包含小数", { skillKey, parameterKey: parameter.parameterKey, values });
    }
    if (parameter.valueMode === "CHARACTER_LEVEL") {
      recordCheck(Object.keys(parameter.levelValues ?? {}).length === 18, "角色等级参数不是完整1至18映射", { skillKey, parameterKey: parameter.parameterKey });
    }
  }
  for (const formula of skill.write.formulas) walkFormula(formula.expression, skillKey, formula.formulaKey);
  for (const effect of skill.write.effects) {
    for (const result of effect.results ?? []) {
      recordCheck(result.resultType === "RESOURCE_CHANGE", "出现非资源结果", { skillKey, effectKey: effect.effectKey, resultType: result.resultType });
      recordCheck(["mana", "energy"].includes(result.detail?.attributeKey), "资源效果属性非法", result.detail);
      recordCheck(["CONSUME", "RESTORE"].includes(result.detail?.operation), "资源操作非法", result.detail);
      recordCheck(result.valueRule?.value?.kind === "PARAMETER", "资源效果没有参数值", result.valueRule);
      parameterOf(skillKey, result.valueRule.value.parameterKey);
    }
  }
  sourceChecks.push({ skillKey, parameters: skill.write.parameters.length, formulas: skill.write.formulas.length, effects: skill.write.effects.length, passed: true });
}

const expected = (skillKey, formulaKey, input) => {
  const rank = input.rank;
  const ap = input.attributes["SOURCE.ability_power.TOTAL"];
  const ad = input.attributes["SOURCE.attack_damage.TOTAL"];
  const hpBonus = input.attributes["SOURCE.hp.BONUS"];
  const targetHp = input.attributes["TARGET.hp.TOTAL"];
  if (skillKey === "ornn_p") {
    const ratio = sourceData(skillKey, "BaseStatAmp", 1) + sourceData(skillKey, "AdditionalMythicStatAmp", 1) * input.runtime.actual_masterwork_count;
    const before = {
      bonus_health: input.runtime.actual_source_hp_before_ornn_passive,
      bonus_armor: input.runtime.actual_source_armor_before_ornn_passive,
      bonus_magic_resistance: input.runtime.actual_source_magic_resistance_before_ornn_passive,
    }[formulaKey];
    if (formulaKey === "stat_amplification_ratio") return ratio;
    recordCheck(typeof before === "number", "奥恩P期望公式未知", formulaKey);
    return ratio * before;
  }
  if (skillKey === "ornn_q") {
    recordCheck(formulaKey === "physical_damage", "奥恩Q期望公式未知", formulaKey);
    return sourceData(skillKey, "BaseDamage", rank) + sourcePart(skillKey, "TotalDamage", 1).mCoefficient * ad;
  }
  if (skillKey === "ornn_w") {
    const minimum = sourceData(skillKey, "MinimumDamagePerTick", rank);
    const ratio = sourceData(skillKey, "PercentHPPerTick", rank);
    const ticks = sourceData(skillKey, "NumberOfTicks", rank);
    if (formulaKey === "minimum_damage_total") return minimum * ticks;
    if (formulaKey === "damage_per_tick") return Math.max(minimum, ratio * targetHp);
    if (formulaKey === "five_tick_damage_total") return ticks * Math.max(minimum, ratio * targetHp);
    if (formulaKey === "brittle_extra_magic_damage") return input.runtime.actual_brittle_extra_magic_ratio * targetHp;
    throw new Error("奥恩W期望公式未知：" + formulaKey);
  }
  if (skillKey === "ornn_e") {
    recordCheck(formulaKey === "physical_damage", "奥恩E期望公式未知", formulaKey);
    return sourceData(skillKey, "BaseDamage", rank)
      + sourceData(skillKey, "ArmorRatio", rank) * input.runtime.actual_source_armor_for_ornn_e
      + sourceData(skillKey, "MRRatio", rank) * input.attributes["SOURCE.magic_resistance.BONUS"];
  }
  if (skillKey === "ornn_r") {
    const one = sourceData(skillKey, "RBaseDamage", rank) + sourceData(skillKey, "RRatio", rank) * ap;
    if (formulaKey === "magic_damage_per_pass") return one;
    if (formulaKey === "magic_damage_same_enemy_total") return sourceData(skillKey, "RBaseDamage", rank) * 2 + sourceData(skillKey, "RRatio", rank) * ap * 2;
    throw new Error("奥恩R期望公式未知：" + formulaKey);
  }
  if (skillKey === "shen_p") {
    const base = input.runtime.actual_base_shield_value;
    const defaultValue = base + sourcePart(skillKey, "{58a09e24}", 1).mCoefficient * hpBonus;
    if (formulaKey === "default_shield_value") return defaultValue;
    if (formulaKey === "conditional_shield_value") return sourceData(skillKey, "ShenZedQuestShieldMultiplier", 1) * defaultValue;
    throw new Error("慎P期望公式未知：" + formulaKey);
  }
  if (skillKey === "shen_q") {
    const baseFlatPart = sourcePart(skillKey, "BaseFlatDamage", 0);
    const baseFlat = baseFlatPart.mLevel1Value + (baseFlatPart.mBreakpoints ?? [])
      .filter(point => input.characterLevel >= Number(point.mLevel))
      .reduce((sum, point) => sum + Number(point.mAdditionalBonusAtThisLevel), 0);
    const root = sourceCalc(skillKey, "BasePercentHealth").mMultiplier.mNumber;
    const points = formulaKey === "normal_enhanced_attack_magic_damage" ? sourceData(skillKey, "BasePercentDamage", rank) : sourceData(skillKey, "EnhancedPercentDamage", rank);
    const coefficient = formulaKey === "normal_enhanced_attack_magic_damage"
      ? sourcePart(skillKey, "BasePercentHealth", 1).mCoefficient
      : sourcePart(skillKey, "EmpPercentHealth", 1).mCoefficient;
    const one = baseFlat + root * (points + coefficient * ap) * targetHp;
    if (formulaKey === "normal_enhanced_attack_magic_damage" || formulaKey === "enhanced_attack_magic_damage") return one;
    if (formulaKey === "enhanced_attack_magic_damage_total") return sourceData(skillKey, "NumEnhancedAttacks", rank) * one;
    throw new Error("慎Q期望公式未知：" + formulaKey);
  }
  if (skillKey === "shen_e") {
    recordCheck(formulaKey === "physical_damage", "慎E期望公式未知", formulaKey);
    return sourceData(skillKey, "BaseDamage", rank) + sourceData(skillKey, "BonusHPRatio", rank) * hpBonus;
  }
  throw new Error("未知技能公式：" + skillKey + "/" + formulaKey);
};

for (const [skillKey, skill] of Object.entries(candidate.skills)) {
  for (const formula of skill.write.formulas) {
    for (const high of [false, true]) {
      const input = scenarioFor(skillKey, high);
      const actual = evaluate(formula.expression, skillKey, input);
      const wanted = expected(skillKey, formula.formulaKey, input);
      recordCheck(Number.isFinite(actual) && nearly(actual, wanted), "公式独立期望不一致", {
        skillKey, formulaKey: formula.formulaKey, actual, wanted, high,
      });
      positiveCases.push({ skillKey, formulaKey: formula.formulaKey, group: high ? "高等级高属性" : "低等级低属性", actual, expected: wanted, passed: true });
    }
    const dependencies = collectDependencies(formula.expression, skillKey);
    for (const dependency of dependencies) {
      const input = scenarioFor(skillKey, false);
      if (dependency.kind === "ATTRIBUTE") delete input.attributes[dependency.key];
      else if (dependency.kind === "RUNTIME_INPUT") delete input.runtime[dependency.key];
      else delete input.characterLevel;
      let rejected = false;
      try { evaluate(formula.expression, skillKey, input); } catch { rejected = true; }
      recordCheck(rejected, "公式缺值未拒绝", { skillKey, formulaKey: formula.formulaKey, dependency });
      missingCases.push({ skillKey, formulaKey: formula.formulaKey, dependency, rejected: true });
    }
  }
}

const runtimeParameters = [];
for (const [skillKey, skill] of Object.entries(candidate.skills)) {
  for (const parameter of skill.write.parameters.filter(item => item.valueMode === "RUNTIME_INPUT")) {
    const input = scenarioFor(skillKey, false);
    delete input.runtime[parameter.parameterKey];
    let rejected = false;
    try { parameterValue(skillKey, parameter.parameterKey, input); } catch { rejected = true; }
    recordCheck(rejected, "运行输入参数缺值未拒绝", { skillKey, parameterKey: parameter.parameterKey });
    runtimeParameters.push({ skillKey, parameterKey: parameter.parameterKey, rejected: true });
  }
}
const integerRuntimeRejections = [];
for (const [skillKey, skill] of Object.entries(candidate.skills)) {
  for (const parameter of skill.write.parameters.filter(item => item.valueMode === "RUNTIME_INPUT" && item.valueType === "INTEGER")) {
    const input = scenarioFor(skillKey, false);
    input.runtime[parameter.parameterKey] = 0.5;
    let rejected = false;
    try { parameterValue(skillKey, parameter.parameterKey, input); } catch { rejected = true; }
    recordCheck(rejected, "整数运行输入未拒绝小数", { skillKey, parameterKey: parameter.parameterKey });
    integerRuntimeRejections.push({ skillKey, parameterKey: parameter.parameterKey, value: 0.5, rejected: true });
  }
}
const invalidCharacterLevelRejections = [];
for (const invalidLevel of [0, 19, 1.5]) {
  const input = scenarioFor("shen_q", false);
  input.characterLevel = invalidLevel;
  let rejected = false;
  try { parameterValue("shen_q", "actual_base_flat_damage", input); } catch { rejected = true; }
  recordCheck(rejected, "角色等级非法值未拒绝", invalidLevel);
  invalidCharacterLevelRejections.push({ value: invalidLevel, rejected: true });
}
const negativeMasterwork = scenarioFor("ornn_p", false);
negativeMasterwork.runtime.actual_masterwork_count = -1;
let negativeMasterworkRejected = false;
try {
  const value = parameterValue("ornn_p", "actual_masterwork_count", negativeMasterwork);
  recordCheck(value >= 0, "杰作数量接受负数", value);
} catch { negativeMasterworkRejected = true; }
recordCheck(negativeMasterworkRejected, "杰作数量负数未拒绝");

const q = skillOf("shen_q");
const qFlatFormula = formulaOf("shen_q", "normal_enhanced_attack_magic_damage");
for (const level of [1, 3, 4, 7, 10, 13, 16, 18]) {
  const input = scenarioFor("shen_q", false);
  input.characterLevel = level;
  const actual = evaluate(qFlatFormula.expression, "shen_q", input);
  const basePart = sourcePart("shen_q", "BaseFlatDamage", 0);
  const baseFlat = basePart.mLevel1Value + (basePart.mBreakpoints ?? [])
    .filter(point => level >= Number(point.mLevel))
    .reduce((sum, point) => sum + Number(point.mAdditionalBonusAtThisLevel), 0);
  const wanted = baseFlat + sourceCalc("shen_q", "BasePercentHealth").mMultiplier.mNumber
    * (sourceData("shen_q", "BasePercentDamage", 1) + sourcePart("shen_q", "BasePercentHealth", 1).mCoefficient * input.attributes["SOURCE.ability_power.TOTAL"])
    * input.attributes["TARGET.hp.TOTAL"];
  recordCheck(nearly(actual, wanted), "慎Q角色等级断点求值不符", { level, actual, wanted });
  boundaryCases.push({ key: "shen_q/character_level", level, actual, expected: wanted, passed: true });
}
const eRefund = parameterOf("shen_e", "actual_energy_refund_on_damage");
for (const level of [1, 3, 4, 11, 12, 18]) {
  const value = eRefund.levelValues[String(level)];
  const wanted = level >= 12 ? 50 : level >= 4 ? 40 : 30;
  recordCheck(value === wanted, "慎E能量回复角色等级断点不符", { level, value, wanted });
  boundaryCases.push({ key: "shen_e/energy_refund_character_level", level, actual: value, expected: wanted, passed: true });
}
const wFormula = formulaOf("ornn_w", "damage_per_tick");
for (const targetHp of [1, 1000, 100000]) {
  const input = scenarioFor("ornn_w", false);
  input.attributes["TARGET.hp.TOTAL"] = targetHp;
  const actual = evaluate(wFormula.expression, "ornn_w", input);
  const minimum = sourceData("ornn_w", "MinimumDamagePerTick", 1);
  const wanted = Math.max(minimum, sourceData("ornn_w", "PercentHPPerTick", 1) * targetHp);
  recordCheck(nearly(actual, wanted), "奥恩W下限封顶求值不符", { targetHp, actual, wanted });
  boundaryCases.push({ key: "ornn_w/damage_per_tick_floor", targetHp, actual, expected: wanted, passed: true });
}
const pFormula = formulaOf("ornn_p", "stat_amplification_ratio");
for (const count of [0, 1, 13, 50]) {
  const input = scenarioFor("ornn_p", false);
  input.runtime.actual_masterwork_count = count;
  const actual = evaluate(pFormula.expression, "ornn_p", input);
  const wanted = sourceData("ornn_p", "BaseStatAmp", 1) + sourceData("ornn_p", "AdditionalMythicStatAmp", 1) * count;
  recordCheck(nearly(actual, wanted), "奥恩P杰作数量求值不符", { count, actual, wanted });
  boundaryCases.push({ key: "ornn_p/masterwork_count", count, actual, expected: wanted, passed: true });
}
const rFormula = formulaOf("ornn_r", "magic_damage_same_enemy_total");
const rInput = scenarioFor("ornn_r", true);
const perPass = evaluate(formulaOf("ornn_r", "magic_damage_per_pass").expression, "ornn_r", rInput);
const totalPass = evaluate(rFormula.expression, "ornn_r", rInput);
recordCheck(nearly(totalPass, perPass * 2), "奥恩R唯一敌人两程总量不符", { perPass, totalPass });
boundaryCases.push({ key: "ornn_r/two_passes", actual: totalPass, expected: perPass * 2, passed: true });
const qTotal = evaluate(formulaOf("shen_q", "enhanced_attack_magic_damage_total").expression, "shen_q", scenarioFor("shen_q", true));
const qOne = evaluate(formulaOf("shen_q", "enhanced_attack_magic_damage").expression, "shen_q", scenarioFor("shen_q", true));
recordCheck(nearly(qTotal, qOne * 3), "慎Q三次强化总量不符", { qOne, qTotal });
boundaryCases.push({ key: "shen_q/three_attacks", actual: qTotal, expected: qOne * 3, passed: true });
const pShield = scenarioFor("shen_p", true);
const defaultShield = evaluate(formulaOf("shen_p", "default_shield_value").expression, "shen_p", pShield);
const conditionalShield = evaluate(formulaOf("shen_p", "conditional_shield_value").expression, "shen_p", pShield);
const shieldMultiplier = sourceData("shen_p", "ShenZedQuestShieldMultiplier", 1);
recordCheck(nearly(conditionalShield, defaultShield * shieldMultiplier), "慎P条件护盾倍率不符", { defaultShield, conditionalShield, shieldMultiplier });
boundaryCases.push({ key: "shen_p/conditional_multiplier", actual: conditionalShield, expected: defaultShield * shieldMultiplier, passed: true });

const report = {
  at: new Date().toISOString(),
  candidateSha256: fileSha256(candidatePath),
  sourceBindingSha256: fileSha256(sourcePath),
  sourceInputSha256: fileSha256(inputVersionPath),
  status: "PASS",
  candidateMathReady: true,
  businessMathReady: false,
  apiWrites: 0,
  formulaCount,
  positiveCaseCount: positiveCases.length,
  missingValueRejectionCount: missingCases.length,
  runtimeParameterMissingRejectionCount: runtimeParameters.length,
  integerRuntimeRejectionCount: integerRuntimeRejections.length,
  invalidCharacterLevelRejectionCount: invalidCharacterLevelRejections.length,
  negativeMasterworkRejectionCount: negativeMasterworkRejected ? 1 : 0,
  boundaryCheckCount: boundaryCases.length,
  sourceCheckCount: sourceChecks.length,
  positiveCases,
  missingCases,
  runtimeParameters,
  integerRuntimeRejections,
  invalidCharacterLevelRejections,
  negativeMasterworkRejected,
  boundaryCases,
  sourceChecks,
  basis: "独立脚本从候选实际公式表达式树求值；公式常数、等级数组、根倍率、角色等级断点和结果乘数从冻结绑定源计算独立期望，不调用候选生成器中的期望函数，也不调用业务接口。",
  limits: [
    "当前仅证明候选表达式结构和冻结来源数值，未证明业务接口已保存或业务运行时会触发伤害、控制和资源效果。",
    "未给施法时间、奥恩W易碎比例、奥恩E护甲、慎P护盾基础值和冷却缩短曲线设置默认值；缺值测试必须拒绝。",
  ],
};
const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(artifactDir, "独立数学核算.json"), reportBytes);
fs.writeFileSync(path.join(durableDir, "独立数学核算.json"), reportBytes);
console.log(JSON.stringify({
  status: report.status,
  candidateMathReady: report.candidateMathReady,
  businessMathReady: report.businessMathReady,
  formulaCount,
  positiveCaseCount: positiveCases.length,
  missingValueRejectionCount: missingCases.length,
  runtimeParameterMissingRejectionCount: runtimeParameters.length,
  integerRuntimeRejectionCount: integerRuntimeRejections.length,
  invalidCharacterLevelRejectionCount: invalidCharacterLevelRejections.length,
  negativeMasterworkRejectionCount: negativeMasterworkRejected ? 1 : 0,
  boundaryCheckCount: boundaryCases.length,
  sourceCheckCount: sourceChecks.length,
  candidateSha256: report.candidateSha256,
}, null, 2));

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const expected = Object.freeze({
  sourceBindingSha256: "37a25d9cf21276968b5c72c9655e93eb7f6b7ceaabbaf451242dccf5fa14180c",
  candidateSha256: "046f2671121092a906008b6b07909156a90d4bc241e18ce646fc12480f3303cf",
  planSha256: "562b5c4060671668e4fc9fd116e35cf6c8cedac8c1b96f3ffed9bc2535f57ae9",
});
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--after-apply") {
  console.error("用法：node 独立回读-严格数学.mjs --after-apply <独立全量回读.json>");
  process.exit(2);
}
const readerPath = path.resolve(args[1]);
if (!fs.existsSync(readerPath)) throw new Error("找不到独立全量回读报告：" + readerPath);
const readerBytes = fs.readFileSync(readerPath);
const reader = JSON.parse(readerBytes);
const outputPath = path.join(path.dirname(readerPath), "独立严格数学.json");
const sha256Bytes = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sha256File = file => sha256Bytes(fs.readFileSync(file));
const sourcePath = path.resolve(here, "../hero27-root-entry-20260909/来源绑定与当前文本.json");
const sourceSha256 = sha256File(sourcePath);
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

function requireValue(condition, message, detail = undefined) {
  if (!condition) {
    const suffix = detail === undefined ? "" : "：" + JSON.stringify(detail);
    throw new Error(message + suffix);
  }
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
function stableString(value) {
  return JSON.stringify(canonical(value));
}
function closeEnough(actual, wanted, factor = 1e-6) {
  return Math.abs(Number(actual) - Number(wanted)) <=
    factor * Math.max(1, Math.abs(Number(actual)), Math.abs(Number(wanted)));
}

requireValue(sourceSha256 === expected.sourceBindingSha256, "冻结来源绑定散列变化", {
  actual: sourceSha256,
  expected: expected.sourceBindingSha256,
});
requireValue(reader.afterApply === true && reader.apiWrites === 0 && reader.complete === true,
  "独立回读不是完成的写后只读报告");
requireValue(reader.candidateSha256 === expected.candidateSha256 &&
  reader.planSha256 === expected.planSha256 &&
  reader.sourceBindingSha256 === expected.sourceBindingSha256,
  "回读报告的冻结散列不符", {
    candidate: reader.candidateSha256,
    plan: reader.planSha256,
    sourceBinding: reader.sourceBindingSha256,
  });

const details = reader.fullBusinessFields?.componentDetails;
requireValue(Array.isArray(details), "回读报告缺少组成详情");
const detailMap = new Map();
for (const item of details) {
  requireValue(item && typeof item.skillKey === "string" && typeof item.kind === "string" &&
    typeof item.stableKey === "string" && item.status === 200 && item.data &&
    typeof item.data === "object", "回读详情形状不符", item);
  const key = item.skillKey + "|" + item.kind + "|" + item.stableKey;
  requireValue(!detailMap.has(key), "回读详情重复：" + key);
  detailMap.set(key, item.data);
}
const actualFormulaMap = new Map();
const actualParameterMap = new Map();
for (const item of details) {
  const key = item.skillKey + "|" + item.stableKey;
  if (item.kind === "formulas") actualFormulaMap.set(key, item.data);
  if (item.kind === "parameters") actualParameterMap.set(key, item.data);
}

const skillKeys = [
  "gragas_p", "gragas_q", "gragas_w", "gragas_e", "gragas_r",
  "hecarim_p", "hecarim_q", "hecarim_w", "hecarim_e", "hecarim_r",
];
const formulaKeys = [
  "gragas_p/heal_amount",
  "gragas_q/minimum_damage",
  "gragas_q/maximum_damage",
  "gragas_q/maximum_slow_percent_points",
  "gragas_w/damage_reduction_ratio",
  "gragas_w/empowered_bonus_damage",
  "gragas_e/magic_damage",
  "gragas_r/magic_damage",
  "hecarim_p/bonus_attack_damage",
  "hecarim_q/base_physical_damage",
  "hecarim_q/damage_boost_per_stack_percent_points",
  "hecarim_q/physical_damage_at_stacks",
  "hecarim_q/cooldown_at_stacks_ms",
  "hecarim_w/magic_damage_total",
  "hecarim_w/self_healing_from_damage",
  "hecarim_e/minimum_damage",
  "hecarim_e/maximum_damage",
  "hecarim_r/magic_damage",
];
const sourceSkill = skillKey => {
  const heroId = skillKey.startsWith("gragas_") ? "Gragas" : "Hecarim";
  const slot = skillKey.slice(-1).toUpperCase();
  const hero = source.heroes?.find(item => item.id === heroId);
  const skill = hero?.skills?.find(item => item.slot === slot);
  requireValue(skill, "冻结来源技能缺失", skillKey);
  return skill;
};
const sourceSpell = skillKey => sourceSkill(skillKey).object?.mSpell;
const sourceData = (skillKey, name, rank) => {
  const value = sourceSpell(skillKey)?.DataValues?.find(item => item.name === name);
  requireValue(value && Array.isArray(value.values), "冻结来源DataValues缺失", { skillKey, name });
  const result = value.values[rank];
  requireValue(typeof result === "number" && Number.isFinite(result),
    "冻结来源DataValues等级值缺失", { skillKey, name, rank, values: value.values });
  return result;
};
const sourceCalculation = (skillKey, name) => {
  const result = sourceSpell(skillKey)?.mSpellCalculations?.[name];
  requireValue(result, "冻结来源计算树缺失", { skillKey, name });
  return result;
};
const sourcePart = (skillKey, calculation, index) => {
  const parts = sourceCalculation(skillKey, calculation).mFormulaParts;
  requireValue(Array.isArray(parts) && parts[index], "冻结来源计算树分段缺失", {
    skillKey,
    calculation,
    index,
  });
  return parts[index];
};
const sourceMultiplier = (skillKey, calculation) => {
  const value = sourceCalculation(skillKey, calculation).mMultiplier?.mNumber;
  requireValue(typeof value === "number" && Number.isFinite(value),
    "冻结来源根修饰倍率缺失", { skillKey, calculation });
  return value;
};
const sourceMaxRank = skillKey => {
  const skill = sourceSkill(skillKey);
  const heroId = skillKey.startsWith("gragas_") ? "Gragas" : "Hecarim";
  const slot = skillKey.slice(-1).toUpperCase();
  const hero = source.heroes?.find(item => item.id === heroId);
  const sourceSummary = hero?.source?.skills?.find(item => item.slot === slot);
  const rank = Number(skill.officialMaxRank ?? sourceSummary?.officialMaxRank);
  requireValue(Number.isInteger(rank) && rank > 0, "冻结来源最大等级缺失", { skillKey, rank });
  return rank;
};
const sourceCooldownMs = (skillKey, rank) => {
  const spell = sourceSpell(skillKey);
  const values = spell?.cooldownTime ?? spell?.Cooldown?.values;
  requireValue(Array.isArray(values) && typeof values[rank] === "number",
    "冻结来源冷却数组缺失", { skillKey, rank });
  return values[rank] * 1000;
};

const keyOf = (skillKey, formulaKey) => skillKey + "|" + formulaKey;
const actualFormula = (skillKey, formulaKey) => {
  const value = actualFormulaMap.get(keyOf(skillKey, formulaKey));
  requireValue(value && value.expression, "实际GET公式详情缺失", { skillKey, formulaKey });
  return value;
};
const actualParameter = (skillKey, parameterKey) => {
  const value = actualParameterMap.get(keyOf(skillKey, parameterKey));
  requireValue(value, "实际GET参数详情缺失", { skillKey, parameterKey });
  return value;
};

function parameterValue(skillKey, parameterKey, scenario) {
  const parameter = actualParameter(skillKey, parameterKey);
  let value;
  if (parameter.valueMode === "FIXED") value = parameter.fixedValue;
  else if (parameter.valueMode === "SKILL_LEVEL") {
    const rank = scenario.levels[skillKey];
    value = parameter.levelValues?.[String(rank)];
  } else if (parameter.valueMode === "RUNTIME_INPUT") {
    value = scenario.runtime?.[skillKey]?.[parameterKey];
    if (value === undefined || value === null) {
      throw new Error("MISSING_RUNTIME_INPUT:" + skillKey + "/" + parameterKey);
    }
  } else {
    throw new Error("UNSUPPORTED_VALUE_MODE:" + skillKey + "/" + parameterKey);
  }
  if (value === undefined || value === null || !Number.isFinite(Number(value))) {
    throw new Error("MISSING_PARAMETER_VALUE:" + skillKey + "/" + parameterKey);
  }
  const number = Number(value);
  if (parameter.valueType === "INTEGER" && !Number.isInteger(number)) {
    throw new Error("INTEGER_PARAMETER_REQUIRES_INTEGER:" + skillKey + "/" + parameterKey);
  }
  if (parameterKey === "actual_stacks" && number < 0) {
    throw new Error("RUNTIME_INPUT_MUST_BE_NONNEGATIVE:" + skillKey + "/" + parameterKey);
  }
  return number;
}

function attributeValue(owner, attributeKey, valueKind, scenario) {
  if (!["SOURCE", "TARGET"].includes(owner) ||
      !["TOTAL", "BASE", "BONUS"].includes(valueKind)) {
    throw new Error("UNSUPPORTED_ATTRIBUTE_NODE:" + owner + "." + attributeKey + "." + valueKind);
  }
  const value = scenario.attributes?.[owner]?.[attributeKey]?.[valueKind];
  if (value === undefined || value === null || !Number.isFinite(Number(value))) {
    throw new Error("MISSING_ATTRIBUTE:" + owner + "." + attributeKey + "." + valueKind);
  }
  return Number(value);
}

function evaluate(node, skillKey, scenario, at = "$") {
  requireValue(node && typeof node === "object", "实际公式节点缺失", { skillKey, at });
  if (node.nodeType === "PARAMETER") return parameterValue(skillKey, node.parameterKey, scenario);
  if (node.nodeType === "ATTRIBUTE") {
    return attributeValue(node.attributeOwner, node.attributeKey, node.attributeValueKind, scenario);
  }
  requireValue(node.nodeType === "OPERATION" && Array.isArray(node.operands) &&
    node.operands.length === 2, "实际公式必须是二元运算", { skillKey, at, node });
  const left = evaluate(node.operands[0], skillKey, scenario, at + ".left");
  const right = evaluate(node.operands[1], skillKey, scenario, at + ".right");
  switch (node.operation) {
    case "ADD": return left + right;
    case "SUBTRACT": return left - right;
    case "MULTIPLY": return left * right;
    case "DIVIDE":
      if (right === 0) throw new Error("DIVIDE_BY_ZERO:" + at);
      return left / right;
    case "MIN": return Math.min(left, right);
    case "MAX": return Math.max(left, right);
    default: throw new Error("UNSUPPORTED_OPERATION:" + node.operation);
  }
}

function collectDependencies(node, skillKey, result = { parameters: new Set(), runtime: new Set(), attributes: new Set() }) {
  if (node.nodeType === "PARAMETER") {
    result.parameters.add(node.parameterKey);
    const parameter = actualParameter(skillKey, node.parameterKey);
    if (parameter.valueMode === "RUNTIME_INPUT") result.runtime.add(node.parameterKey);
    return result;
  }
  if (node.nodeType === "ATTRIBUTE") {
    result.attributes.add(node.attributeOwner + "." + node.attributeKey + "." + node.attributeValueKind);
    return result;
  }
  requireValue(node.nodeType === "OPERATION" && Array.isArray(node.operands) &&
    node.operands.length === 2, "实际公式依赖扫描遇到非二元节点", { skillKey, node });
  for (const child of node.operands) collectDependencies(child, skillKey, result);
  return result;
}

function scenario(high) {
  const levels = Object.fromEntries(skillKeys.map(skillKey => [skillKey, high ? sourceMaxRank(skillKey) : 1]));
  return {
    id: high ? "B-最高技能等级" : "A-技能等级1",
    levels,
    attributes: {
      SOURCE: {
        hp: { TOTAL: high ? 5200 : 3500, BONUS: high ? 1400 : 700 },
        ability_power: { TOTAL: high ? 315 : 173 },
        attack_damage: { BONUS: high ? 130 : 75 },
      },
      TARGET: {
        hp: { TOTAL: high ? 4100 : 2600 },
      },
    },
    runtime: {
      hecarim_p: {
        actual_bonus_move_speed: high ? 105 : 40,
        move_speed_to_ad_ratio: high ? 0.24 : 0.14,
      },
      hecarim_q: {
        actual_stacks: high ? 3 : 0,
      },
      hecarim_w: {
        actual_self_damage_dealt: high ? 890 : 400,
      },
    },
  };
}

function expectedValue(skillKey, formulaKey, testCase) {
  const rank = testCase.levels[skillKey];
  const ap = testCase.attributes.SOURCE.ability_power.TOTAL;
  const bonusAd = testCase.attributes.SOURCE.attack_damage.BONUS;
  const targetHp = testCase.attributes.TARGET.hp.TOTAL;
  const cappedStacks = Math.min(testCase.runtime.hecarim_q?.actual_stacks ?? 0, sourceData("hecarim_q", "MaxStacks", rank));
  const formula = skillKey + "/" + formulaKey;
  switch (formula) {
    case "gragas_p/heal_amount":
      return sourceData("gragas_p", "HealRatio", rank) * testCase.attributes.SOURCE.hp.TOTAL;
    case "gragas_q/minimum_damage":
      return sourceData("gragas_q", "BaseDamage", rank) +
        sourcePart("gragas_q", "MinDamage", 1).mCoefficient * ap;
    case "gragas_q/maximum_damage": {
      const minimum = expectedValue("gragas_q", "minimum_damage", testCase);
      return sourceMultiplier("gragas_q", "MaxDamage") * minimum;
    }
    case "gragas_q/maximum_slow_percent_points":
      return sourceData("gragas_q", "SlowPercent", rank) * sourceMultiplier("gragas_q", "MaxDamage");
    case "gragas_w/damage_reduction_ratio":
      return sourceMultiplier("gragas_w", "DamageReduction") *
        (sourceData("gragas_w", "BaseDamageReduction", rank) +
          sourceData("gragas_w", "DamageReductionAP", rank) * ap);
    case "gragas_w/empowered_bonus_damage":
      return sourceData("gragas_w", "BaseDamage", rank) +
        sourceData("gragas_w", "BaseDamageAP", rank) * ap +
        sourceData("gragas_w", "MaxHPPercentDamage", rank) * 0.01 * targetHp;
    case "gragas_e/magic_damage":
      return sourceData("gragas_e", "BaseDamage", rank) +
        sourceData("gragas_e", "APRatio", rank) * ap;
    case "gragas_r/magic_damage":
      return sourceData("gragas_r", "BaseDamage", rank) +
        sourceData("gragas_r", "APRatio", rank) * ap;
    case "hecarim_p/bonus_attack_damage":
      return testCase.runtime.hecarim_p.actual_bonus_move_speed *
        testCase.runtime.hecarim_p.move_speed_to_ad_ratio;
    case "hecarim_q/base_physical_damage":
      return sourceData("hecarim_q", "BaseDamage", rank) +
        sourceData("hecarim_q", "BaseDamageBonusAD", rank) * bonusAd;
    case "hecarim_q/damage_boost_per_stack_percent_points":
      return sourceData("hecarim_q", "RampageBonusRatio", rank) +
        sourcePart("hecarim_q", "RampageBonusDamagePerc", 1).mCoefficient * bonusAd;
    case "hecarim_q/physical_damage_at_stacks": {
      const base = expectedValue("hecarim_q", "base_physical_damage", testCase);
      const boost = expectedValue("hecarim_q", "damage_boost_per_stack_percent_points", testCase);
      return base * (1 + cappedStacks * boost * 0.01);
    }
    case "hecarim_q/cooldown_at_stacks_ms":
      return Math.max(0, sourceCooldownMs("hecarim_q", rank) -
        cappedStacks * sourceData("hecarim_q", "RampageCooldownReduction", rank) * 1000);
    case "hecarim_w/magic_damage_total":
      return sourceData("hecarim_w", "Damage", rank) +
        sourceData("hecarim_w", "APRatio", rank) * ap;
    case "hecarim_w/self_healing_from_damage":
      return sourceData("hecarim_w", "DamageLeechPerc", rank) * 0.01 *
        testCase.runtime.hecarim_w.actual_self_damage_dealt;
    case "hecarim_e/minimum_damage":
      return sourceData("hecarim_e", "MinBaseDamage", rank) +
        sourceData("hecarim_e", "BonusADRatio", rank) * bonusAd;
    case "hecarim_e/maximum_damage":
      return sourceMultiplier("hecarim_e", "MaxDamage") *
        expectedValue("hecarim_e", "minimum_damage", testCase);
    case "hecarim_r/magic_damage":
      return sourceData("hecarim_r", "BaseDamage", rank) +
        sourceData("hecarim_r", "APRatio", rank) * ap;
    default:
      throw new Error("没有冻结来源独立期望：" + formula);
  }
}

const sourceTreeExpectations = [
  ["gragas_p", "HealAmount"],
  ["gragas_q", "MinDamage"], ["gragas_q", "MaxDamage"],
  ["gragas_w", "DamageReduction"], ["gragas_w", "TotalDamage"],
  ["gragas_e", "TotalDamage"], ["gragas_r", "DamageDone"],
  ["hecarim_p", "BonusAD"],
  ["hecarim_q", "Damage"], ["hecarim_q", "RampageBonusDamagePerc"],
  ["hecarim_w", "TotalDamage"], ["hecarim_w", "LeechAmount"],
  ["hecarim_e", "MinDamage"], ["hecarim_e", "MaxDamage"],
  ["hecarim_r", "DamageDone"],
];
const sourceTreeChecks = sourceTreeExpectations.map(([skillKey, calculation]) => {
  try {
    const tree = sourceCalculation(skillKey, calculation);
    return { skillKey, calculation, present: true, type: tree.__type ?? null };
  } catch (error) {
    return { skillKey, calculation, present: false, error: error.message };
  }
});
const shapeChecks = [];
function shapeCheck(label, passed, detail) {
  shapeChecks.push({ label, passed, detail });
}
try {
  const reduction = sourceCalculation("gragas_w", "DamageReduction");
  shapeCheck("古拉加斯W根修饰作用于整个减伤和", closeEnough(Number(reduction.mMultiplier?.mNumber), 0.01, 1e-7), {
    mNumber: reduction.mMultiplier?.mNumber,
  });
  const qMax = sourceCalculation("gragas_q", "MaxDamage");
  shapeCheck("古拉加斯Q最大伤害根倍率为1.5", closeEnough(Number(qMax.mMultiplier?.mNumber), 1.5, 1e-7), {
    mNumber: qMax.mMultiplier?.mNumber,
  });
  const eMax = sourceCalculation("hecarim_e", "MaxDamage");
  shapeCheck("赫卡里姆E最高伤害根倍率为2", closeEnough(Number(eMax.mMultiplier?.mNumber), 2, 1e-7), {
    mNumber: eMax.mMultiplier?.mNumber,
  });
  const pPart = sourcePart("hecarim_p", "BonusAD", 0);
  shapeCheck("赫卡里姆P保留mStat7与mStatFormula2", pPart.mStat === 7 && pPart.mStatFormula === 2, {
    mStat: pPart.mStat,
    mStatFormula: pPart.mStatFormula,
  });
} catch (error) {
  shapeCheck("来源根树形状读取", false, { error: error.message });
}

const failures = [];
const formulaRecords = [];
const positiveCases = [];
const missingValueChecks = [];
const boundaryChecks = [];
const formulaExpressions = [];
for (const formulaKey of formulaKeys) {
  const parts = formulaKey.split("/");
  const skillKey = parts[0];
  const formulaName = parts[1];
  const formula = actualFormula(skillKey, formulaName);
  formulaExpressions.push({
    skillKey,
    formulaKey: formulaName,
    expressionSha256: sha256Bytes(Buffer.from(stableString(formula.expression))),
    expression: formula.expression,
  });
  const dependency = collectDependencies(formula.expression, skillKey);
  const record = {
    skillKey,
    formulaKey: formulaName,
    runtimeDependencies: [...dependency.runtime],
    attributeDependencies: [...dependency.attributes],
    cases: [],
  };
  for (const testCase of [scenario(false), scenario(true)]) {
    try {
      const actualValue = evaluate(formula.expression, skillKey, testCase);
      const expectedValueForCase = expectedValue(skillKey, formulaName, testCase);
      const passed = Number.isFinite(actualValue) && closeEnough(actualValue, expectedValueForCase);
      const caseRecord = {
        caseId: testCase.id,
        rank: testCase.levels[skillKey],
        attributes: testCase.attributes,
        runtime: testCase.runtime[skillKey] ?? {},
        actual: actualValue,
        expected: expectedValueForCase,
        passed,
      };
      record.cases.push(caseRecord);
      positiveCases.push({ skillKey, formulaKey: formulaName, ...caseRecord });
      if (!passed) failures.push({
        type: "正例数值不一致",
        skillKey,
        formulaKey: formulaName,
        caseId: testCase.id,
        actual: actualValue,
        expected: expectedValueForCase,
      });
    } catch (error) {
      const caseRecord = {
        caseId: testCase.id,
        rank: testCase.levels[skillKey],
        passed: false,
        error: error.message,
      };
      record.cases.push(caseRecord);
      positiveCases.push({ skillKey, formulaKey: formulaName, ...caseRecord });
      failures.push({ type: "实际公式求值失败", skillKey, formulaKey: formulaName, caseId: testCase.id, error: error.message });
    }
  }
  for (const parameterKey of dependency.runtime) {
    const missingCase = scenario(false);
    delete missingCase.runtime[skillKey][parameterKey];
    let rejected = false;
    let errorMessage = null;
    try {
      evaluate(formula.expression, skillKey, missingCase);
    } catch (error) {
      rejected = true;
      errorMessage = error.message;
    }
    const check = {
      skillKey,
      formulaKey: formulaName,
      dependency: "PARAMETER:" + parameterKey,
      rejected,
      error: errorMessage,
    };
    missingValueChecks.push(check);
    if (!rejected) failures.push({ type: "缺少运行输入未拒绝", ...check });
  }
  for (const attributePath of dependency.attributes) {
    const [owner, attributeKey, valueKind] = attributePath.split(".");
    const missingCase = scenario(false);
    delete missingCase.attributes[owner][attributeKey][valueKind];
    let rejected = false;
    let errorMessage = null;
    try {
      evaluate(formula.expression, skillKey, missingCase);
    } catch (error) {
      rejected = true;
      errorMessage = error.message;
    }
    const check = {
      skillKey,
      formulaKey: formulaName,
      dependency: "ATTRIBUTE:" + attributePath,
      rejected,
      error: errorMessage,
    };
    missingValueChecks.push(check);
    if (!rejected) failures.push({ type: "缺少属性输入未拒绝", ...check });
  }
  formulaRecords.push(record);
}

const physicalFormula = actualFormula("hecarim_q", "physical_damage_at_stacks").expression;
const cooldownFormula = actualFormula("hecarim_q", "cooldown_at_stacks_ms").expression;
for (const count of [0, 1, 3, 4, 20]) {
  const testCase = scenario(false);
  testCase.id = "赫卡里姆Q层数" + count;
  testCase.runtime.hecarim_q.actual_stacks = count;
  for (const [formulaKey, expression] of [
    ["physical_damage_at_stacks", physicalFormula],
    ["cooldown_at_stacks_ms", cooldownFormula],
  ]) {
    try {
      const actualValue = evaluate(expression, "hecarim_q", testCase);
      const expectedValueForCase = expectedValue("hecarim_q", formulaKey, testCase);
      const passed = closeEnough(actualValue, expectedValueForCase);
      boundaryChecks.push({
        kind: "上限边界",
        formulaKey,
        count,
        actual: actualValue,
        expected: expectedValueForCase,
        passed,
      });
      if (!passed) failures.push({
        type: "赫卡里姆Q层数上限数值不符",
        formulaKey,
        count,
        actual: actualValue,
        expected: expectedValueForCase,
      });
    } catch (error) {
      boundaryChecks.push({ kind: "上限边界", formulaKey, count, passed: false, error: error.message });
      failures.push({ type: "赫卡里姆Q层数上限求值失败", formulaKey, count, error: error.message });
    }
  }
}
for (const count of [-1, 0.5]) {
  const testCase = scenario(false);
  testCase.id = "赫卡里姆Q非法层数" + count;
  testCase.runtime.hecarim_q.actual_stacks = count;
  let rejected = false;
  let errorMessage = null;
  try {
    evaluate(physicalFormula, "hecarim_q", testCase);
  } catch (error) {
    rejected = true;
    errorMessage = error.message;
  }
  boundaryChecks.push({
    kind: "非法整数输入",
    formulaKey: "physical_damage_at_stacks",
    count,
    rejected,
    error: errorMessage,
    passed: rejected,
  });
  if (!rejected) failures.push({ type: "非法赫卡里姆Q层数未拒绝", count });
}

const formulaCount = formulaRecords.length;
const positiveCaseCount = positiveCases.length;
const missingExpected = 20;
const boundaryExpected = 12;
if (formulaCount !== 18) failures.push({ type: "实际公式数量不符", actual: formulaCount, expected: 18 });
if (positiveCaseCount !== 36) failures.push({ type: "正例数量不符", actual: positiveCaseCount, expected: 36 });
if (missingValueChecks.length !== missingExpected) {
  failures.push({ type: "缺值检查数量不符", actual: missingValueChecks.length, expected: missingExpected });
}
if (boundaryChecks.length !== boundaryExpected) {
  failures.push({ type: "边界检查数量不符", actual: boundaryChecks.length, expected: boundaryExpected });
}
for (const check of sourceTreeChecks) {
  if (!check.present) failures.push({ type: "来源计算树缺失", ...check });
}
for (const check of shapeChecks) {
  if (!check.passed) failures.push({ type: "来源根树形状不符", ...check });
}

const report = {
  generatedAt: new Date().toISOString(),
  status: failures.length === 0 ? "PASS" : "REVISE",
  businessMathReady: failures.length === 0 && reader.complete === true,
  apiWrites: 0,
  readerReportSha256: sha256Bytes(readerBytes),
  readerReportPath: readerPath,
  sourceBindingSha256: sourceSha256,
  candidateSha256: reader.candidateSha256,
  planSha256: reader.planSha256,
  sourceBasis: "期望值全部从冻结16.17客户端绑定的DataValues、计算树分段和根修饰倍率独立读取；实际值全部从本次写后GET详情的expression求值。没有读取候选表达式，也没有用候选散列代替数学检查。",
  scopes: "测试属性仅使用实际公式出现的SOURCE/TARGET与TOTAL/BONUS；当前批没有把CURRENT当作公式输入。",
  expected: {
    formulaCount: 18,
    positiveCaseCount: 36,
    missingValueRejections: 20,
    boundaryChecks: 12,
  },
  actual: {
    formulaCount,
    positiveCaseCount,
    positivePassed: positiveCases.filter(item => item.passed).length,
    missingValueChecks: missingValueChecks.length,
    missingValueRejected: missingValueChecks.filter(item => item.rejected).length,
    boundaryChecks: boundaryChecks.length,
    boundaryPassed: boundaryChecks.filter(item => item.passed).length,
  },
  actualExpressions: formulaExpressions,
  sourceTreeChecks,
  sourceShapeChecks: shapeChecks,
  formulas: formulaRecords,
  positiveCases,
  missingValueChecks,
  boundaryChecks,
  failures,
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({
  status: report.status,
  businessMathReady: report.businessMathReady,
  apiWrites: 0,
  formulaCount: report.actual.formulaCount,
  positiveCases: report.actual.positiveCaseCount,
  positivePassed: report.actual.positivePassed,
  missingValueRejections: report.actual.missingValueRejected + "/" + report.actual.missingValueChecks,
  boundaryChecks: report.actual.boundaryPassed + "/" + report.actual.boundaryChecks,
  failures: report.failures.length,
  output: outputPath,
}, null, 2));
if (report.status !== "PASS") process.exitCode = 1;

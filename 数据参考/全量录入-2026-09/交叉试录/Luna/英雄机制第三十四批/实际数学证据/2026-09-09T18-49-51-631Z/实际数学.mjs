import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repo = "C:/project/damage_web_dev";
const inputDir = path.join(repo, ".agents/artifacts/hero34-root-entry-20260910");
const candidatePath = path.join(artifactDir, "实际候选.json");
const sourcePath = path.join(inputDir, "来源绑定与当前文本.json");
const outputPath = path.join(artifactDir, "严格数学.json");

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256File = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const close = (a, b, tolerance = 1e-6) => Number.isFinite(Number(a)) && Number.isFinite(Number(b))
  && Math.abs(Number(a) - Number(b)) <= tolerance * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));
const assert = (condition, message, detail = undefined) => {
  if (!condition) throw new Error(message + (detail === undefined ? "" : `：${JSON.stringify(detail)}`));
};

const candidate = readJson(candidatePath);
const source = readJson(sourcePath);
assert(candidate.meta?.apiCalls === 0 && candidate.meta?.businessWrites === 0, "候选不是零业务写入材料");
assert(candidate.meta?.sourceVersion?.clientVersion === "16.17" && candidate.meta?.sourceVersion?.officialVersion === "16.17.1", "候选来源版本不符");
assert(Object.keys(candidate.skills ?? {}).length === 20, "候选技能槽数量不符");

const sourceChecks = new Map();
const formulaCases = [];
const missingValueRejections = [];
const integerChecks = [];
const rangeChecks = [];
const recordSource = (key, value) => { if (!sourceChecks.has(key)) sourceChecks.set(key, value); };
const sourceSkill = skillKey => {
  const hero = source.heroes?.find(item => item.key === `champion_${skillKey.split("_")[0]}`);
  const skill = hero?.skills?.find(item => item.skillKey === skillKey);
  assert(skill, "冻结来源技能缺失", skillKey);
  return skill;
};
const sourceSpell = skillKey => sourceSkill(skillKey).object.mSpell;
const dataRow = (skillKey, dataName) => {
  const row = sourceSpell(skillKey).DataValues?.find(item => item.name === dataName);
  assert(row && Array.isArray(row.values), "冻结来源DataValues缺失", { skillKey, dataName });
  return row.values;
};
const dataAt = (skillKey, dataName, index) => {
  const value = dataRow(skillKey, dataName)[index];
  assert(typeof value === "number" && Number.isFinite(value), "冻结来源DataValues索引无值", { skillKey, dataName, index, value });
  return value;
};
const calculation = (skillKey, calculationKey) => {
  const value = sourceSpell(skillKey).mSpellCalculations?.[calculationKey];
  assert(value, "冻结来源计算树缺失", { skillKey, calculationKey });
  return value;
};
const walk = (value, visitor) => {
  if (!value || typeof value !== "object") return;
  visitor(value);
  if (Array.isArray(value)) value.forEach(item => walk(item, visitor));
  else Object.values(value).forEach(item => walk(item, visitor));
};
const sourceDataRef = (skillKey, calculationKey, dataName, index) => {
  let found = false;
  walk(calculation(skillKey, calculationKey), node => { if (node.mDataValue === dataName) found = true; });
  assert(found, "计算树没有引用指定DataValue", { skillKey, calculationKey, dataName });
  recordSource(`data:${skillKey}/${calculationKey}/${dataName}`, { kind: "DataValue", skillKey, calculationKey, dataName, index });
  return dataAt(skillKey, dataName, index);
};
const sourceCoefficient = (skillKey, calculationKey, expected) => {
  const values = [];
  walk(calculation(skillKey, calculationKey), node => { if (typeof node.mCoefficient === "number") values.push(node.mCoefficient); });
  const actual = values.find(value => close(value, expected));
  assert(actual !== undefined, "计算树系数不符", { skillKey, calculationKey, expected, values });
  recordSource(`coefficient:${skillKey}/${calculationKey}/${expected}`, { kind: "Coefficient", skillKey, calculationKey, expected, actual });
  return actual;
};
const sourceNumber = (skillKey, calculationKey, expected) => {
  const values = [];
  walk(calculation(skillKey, calculationKey), node => { if (typeof node.mNumber === "number") values.push(node.mNumber); });
  const actual = values.find(value => close(value, expected));
  assert(actual !== undefined, "计算树固定数字不符", { skillKey, calculationKey, expected, values });
  recordSource(`number:${skillKey}/${calculationKey}/${expected}`, { kind: "Number", skillKey, calculationKey, expected, actual });
  return actual;
};
const sourceCurve = (skillKey, calculationKey, expectedLength) => {
  let part;
  walk(calculation(skillKey, calculationKey), node => {
    if (node.__type === "ByCharLevelFormulaCalculationPart" && Array.isArray(node.values) && !part) part = node;
  });
  assert(part && part.values.length >= expectedLength + 1, "角色等级曲线缺失", { skillKey, calculationKey, expectedLength });
  recordSource(`curve:${skillKey}/${calculationKey}`, { kind: "ByCharLevelFormula", length: expectedLength, sourceIndices: Array.from({ length: expectedLength }, (_, i) => i + 1) });
  return part.values;
};
const sourceBreakpointValue = (skillKey, calculationKey, characterLevel, expectedBase, expectedLevels) => {
  let part;
  walk(calculation(skillKey, calculationKey), node => {
    if (node.__type === "ByCharLevelBreakpointsCalculationPart" && !part) part = node;
  });
  assert(part && close(part.mLevel1Value, expectedBase), "角色等级断点起点不符", { skillKey, calculationKey, expectedBase, actual: part?.mLevel1Value });
  const actualBreakpoints = part.mBreakpoints ?? [];
  assert(actualBreakpoints.length === expectedLevels.length && actualBreakpoints.every((item, index) => item.mLevel === expectedLevels[index][0] && close(item.mAdditionalBonusAtThisLevel, expectedLevels[index][1])), "角色等级断点不符", { skillKey, calculationKey, expectedLevels, actualBreakpoints });
  recordSource(`breakpoints:${skillKey}/${calculationKey}`, { kind: "ByCharLevelBreakpoints", base: part.mLevel1Value, breakpoints: actualBreakpoints.map(item => ({ level: item.mLevel, bonus: item.mAdditionalBonusAtThisLevel })) });
  return actualBreakpoints.reduce((value, item) => characterLevel >= item.mLevel ? value + item.mAdditionalBonusAtThisLevel : value, part.mLevel1Value);
};
const sourceInterpolation = (skillKey, calculationKey, start, end) => {
  let found = false;
  walk(calculation(skillKey, calculationKey), node => {
    if (node.__type === "ByCharLevelInterpolationCalculationPart" && close(node.mStartValue, start) && close(node.mEndValue, end)) found = true;
  });
  assert(found, "角色等级插值端点不符", { skillKey, calculationKey, start, end });
  recordSource(`interpolation:${skillKey}/${calculationKey}`, { kind: "ByCharLevelInterpolation", start, end });
};

const skillOf = skillKey => {
  const skill = candidate.skills?.[skillKey];
  assert(skill, "候选技能缺失", skillKey);
  return skill;
};
const parameterOf = (skillKey, parameterKey) => {
  const parameter = skillOf(skillKey).write.parameters.find(item => item.parameterKey === parameterKey);
  assert(parameter, "候选公式参数未定义", { skillKey, parameterKey });
  return parameter;
};
const runtimeValue = (scenario, key) => {
  assert(Object.prototype.hasOwnProperty.call(scenario.runtime ?? {}, key), "运行输入缺失", key);
  const value = scenario.runtime[key];
  assert(typeof value === "number" && Number.isFinite(value), "运行输入不是有限数值", { key, value });
  return value;
};
const rawParameter = (skillKey, parameterKey, scenario) => {
  const definition = parameterOf(skillKey, parameterKey);
  const mode = definition.valueMode;
  if (mode === "RUNTIME_INPUT") return runtimeValue(scenario, parameterKey);
  if (mode === "SKILL_LEVEL") assert(Number.isInteger(scenario.rank) && scenario.rank >= 1 && scenario.rank <= skillOf(skillKey).maxLevel, "技能等级输入越界", { skillKey, rank: scenario.rank });
  if (mode === "CHARACTER_LEVEL") assert(Number.isInteger(scenario.characterLevel) && scenario.characterLevel >= 1 && scenario.characterLevel <= 18, "角色等级输入越界", { skillKey, characterLevel: scenario.characterLevel });
  const rank = scenario.rank;
  const level = scenario.characterLevel;
  switch (`${skillKey}|${parameterKey}`) {
    case "katarina_p|character_level_base_damage": return sourceCurve("katarina_p", "TotalDamage", 18)[level];
    case "katarina_p|ap_ratio_by_character_level": return sourceBreakpointValue("katarina_p", "TotalDamage", level, 0.7, [[6,0.1],[11,0.1],[16,0.1]]);
    case "katarina_p|bonus_ad_ratio": return sourceDataRef("katarina_p", "TotalDamage", "BonusADRatio", 0);
    case "katarina_q|base_damage": return sourceDataRef("katarina_q", "TotalDamage", "BaseDamage", rank);
    case "katarina_q|ap_ratio": return sourceDataRef("katarina_q", "TotalDamage", "QAPRatio", 1);
    case "katarina_e|base_damage": return sourceDataRef("katarina_e", "TotalDamage", "BaseDamage", rank);
    case "katarina_e|ap_ratio": return sourceDataRef("katarina_e", "TotalDamage", "EAPRatio", 1);
    case "katarina_e|total_ad_ratio": return sourceDataRef("katarina_e", "TotalDamage", "EADRatio", 1);
    case "katarina_e|dagger_cooldown_ratio_by_character_level": return sourceBreakpointValue("katarina_e", "{016cd4b3}", level, 0.78, [[6,0.06],[11,0.06],[16,0.06],[21,0.04]]);
    case "katarina_e|data_cooldown_seconds": return sourceDataRef("katarina_e", "DaggerCooldownReduction", "DataCooldown", rank);
    case "katarina_e|milliseconds_per_second": recordSource("unit:katarina_e/milliseconds_per_second", { kind: "UnitConversion", secondsToMilliseconds: 1000 }); return 1000;
    case "katarina_r|magic_base_damage_per_tick": return sourceDataRef("katarina_r", "DamageCalc", "DamagePerTick", rank);
    case "katarina_r|magic_ap_ratio": return sourceDataRef("katarina_r", "DamageCalc", "RAPRatio", 1);
    case "katarina_r|ticks_per_second": return sourceDataRef("katarina_r", "TotalDamageCalc", "TicksPerSecond", 1);
    case "katarina_r|duration_seconds": return sourceDataRef("katarina_r", "TotalDamageCalc", "Duration", 1);
    case "katarina_r|bonus_ad_ratio": return sourceNumber("katarina_r", "ADDamageCalc", 0.16);
    case "katarina_r|attack_speed_coefficient": return sourceCoefficient("katarina_r", "ADDamageCalc", 3.125);
    case "katarina_r|one_ratio": return sourceNumber("katarina_r", "ADDamageCalc", 1);
    case "leblanc_q|base_damage": return sourceDataRef("leblanc_q", "Damage", "BaseDamage", rank);
    case "leblanc_q|mark_base_damage": return sourceDataRef("leblanc_q", "MarkDamage", "BaseMarkDamage", rank);
    case "leblanc_q|ap_ratio": return sourceDataRef("leblanc_q", "Damage", "APRatio", 1);
    case "leblanc_w|base_damage": return sourceDataRef("leblanc_w", "TotalDamage", "BaseDamage", rank);
    case "leblanc_w|ap_ratio": return sourceDataRef("leblanc_w", "TotalDamage", "WAPRatio", 1);
    case "leblanc_e|initial_base_damage": return sourceDataRef("leblanc_e", "InitialDamage", "BaseInitialDamage", rank);
    case "leblanc_e|delayed_base_damage": return sourceDataRef("leblanc_e", "DelayedDamage", "BaseDelayedDamage", rank);
    case "leblanc_e|initial_ap_ratio": return sourceDataRef("leblanc_e", "InitialDamage", "InitialAPRatio", 1);
    case "leblanc_e|delayed_ap_ratio": return sourceDataRef("leblanc_e", "DelayedDamage", "DelayedAPRatio", 1);
    case "leblanc_r|rq1_base_damage": return sourceDataRef("leblanc_r", "RQ1Damage", "RQ1Base", rank);
    case "leblanc_r|rq2_base_damage": return sourceDataRef("leblanc_r", "RQ2Damage", "RQ2Base", rank);
    case "leblanc_r|rw_base_damage": return sourceDataRef("leblanc_r", "RWDamage", "RWBase", rank);
    case "leblanc_r|re1_base_damage": return sourceDataRef("leblanc_r", "RE1Damage", "RE1Base", rank);
    case "leblanc_r|re2_base_damage": return sourceDataRef("leblanc_r", "RE2Damage", "RE2Base", rank);
    case "leblanc_r|rq1_re1_ap_ratio": return sourceDataRef("leblanc_r", "RQ1Damage", "RQ1RE1BaseAPRatio", 1);
    case "leblanc_r|rq2_ap_ratio": return sourceCoefficient("leblanc_r", "RQ2Damage", 0.8);
    case "leblanc_r|rw_ap_ratio": return sourceCoefficient("leblanc_r", "RWDamage", 0.9);
    case "leblanc_r|re2_ap_ratio": return sourceCoefficient("leblanc_r", "RE2Damage", 0.85);
    case "vex_p|actual_gloom_character_level_base_damage": sourceInterpolation("vex_p", "GloomProcCalc", 40, 150); return runtimeValue(scenario, parameterKey);
    case "vex_p|gloom_ap_ratio": return sourceDataRef("vex_p", "GloomProcCalc", "APRatio", 1);
    case "vex_q|base_damage": return sourceDataRef("vex_q", "QDamageCalc", "BaseDamage", rank);
    case "vex_q|ap_ratio": return sourceDataRef("vex_q", "QDamageCalc", "APRatio", 1);
    case "vex_w|base_shield": return sourceDataRef("vex_w", "ShieldCalc", "ShieldAmount", rank);
    case "vex_w|shield_ap_ratio": return sourceCoefficient("vex_w", "ShieldCalc", 0.75);
    case "vex_w|base_damage": return sourceDataRef("vex_w", "WDamageCalc", "BaseDamage", rank);
    case "vex_w|damage_ap_ratio": return sourceDataRef("vex_w", "WDamageCalc", "DamageAPRatio", 1);
    case "vex_e|base_damage": return sourceDataRef("vex_e", "EDamageCalc", "BaseDamage", rank);
    case "vex_e|ap_ratio": return sourceDataRef("vex_e", "EDamageCalc", "APRatio", rank);
    case "vex_r|base_damage": return sourceDataRef("vex_r", "RDamageCalc", "BaseDamage", rank);
    case "vex_r|first_ap_ratio": return sourceCoefficient("vex_r", "RDamageCalc", 0.2);
    case "vex_r|recast_base_damage": return sourceDataRef("vex_r", "RecastDamageCalc", "RecastDamage", rank);
    case "vex_r|recast_ap_ratio": return sourceCoefficient("vex_r", "RecastDamageCalc", 0.5);
    case "zilean_q|base_damage": return sourceDataRef("zilean_q", "TotalDamage", "BombBaseDamage", rank);
    case "zilean_q|ap_ratio": return sourceDataRef("zilean_q", "TotalDamage", "APRatio", 1);
    case "zilean_r|base_heal": return sourceDataRef("zilean_r", "RTotalHeal", "RBaseHeal", rank);
    case "zilean_r|ap_ratio": return sourceDataRef("zilean_r", "RTotalHeal", "APRatio", 1);
    default: throw new Error(`独立源值映射缺失：${skillKey}|${parameterKey}`);
  }
};

const actualParameter=(skillKey,key,scenario)=>{const p=parameterOf(skillKey,key);let value;if(p.valueMode==='RUNTIME_INPUT')value=runtimeValue(scenario,key);else if(p.valueMode==='FIXED')value=p.fixedValue;else {const level=p.valueMode==='CHARACTER_LEVEL'?scenario.characterLevel:scenario.rank,max=p.valueMode==='CHARACTER_LEVEL'?18:skillOf(skillKey).maxLevel;assert(Number.isInteger(level)&&level>=1&&level<=max,'等级越界');value=p.levelValues[level];}assert(typeof value==='number'&&Number.isFinite(value),'数值缺失');if(p.valueType==='INTEGER')assert(Number.isInteger(value),'非整数');return value;};
const evaluate = (node, skillKey, scenario) => {
  assert(node && typeof node === "object", "公式节点为空", skillKey);
  if (node.nodeType === "PARAMETER") return actualParameter(skillKey, node.parameterKey, scenario);
  if (node.nodeType === "ATTRIBUTE") {
    assert(["SOURCE", "TARGET"].includes(node.attributeOwner), "公式属性所有者非法", node);
    assert(["TOTAL", "BASE", "BONUS"].includes(node.attributeValueKind), "公式属性取值类别非法", node);
    const key = `${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`;
    const value = scenario.attributes?.[key];
    assert(typeof value === "number" && Number.isFinite(value), "属性输入缺失", key);
    return value;
  }
  assert(node.nodeType === "OPERATION" && Array.isArray(node.operands) && node.operands.length === 2, "公式运算必须严格二元", node);
  const [left, right] = node.operands.map(child => evaluate(child, skillKey, scenario));
  switch (node.operation) {
    case "ADD": return left + right;
    case "SUBTRACT": return left - right;
    case "MULTIPLY": return left * right;
    case "DIVIDE": assert(right !== 0, "公式除数为零"); return left / right;
    case "MIN": return Math.min(left, right);
    case "MAX": return Math.max(left, right);
    default: throw new Error(`未知公式运算：${node.operation}`);
  }
};
const collectDependencies = (node, skillKey, result = new Set()) => {
  if (node.nodeType === "PARAMETER") {
    const definition = parameterOf(skillKey, node.parameterKey);
    if (definition.valueMode === "RUNTIME_INPUT") result.add(`P|${node.parameterKey}`);
  } else if (node.nodeType === "ATTRIBUTE") result.add(`A|${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`);
  for (const child of node.operands ?? []) collectDependencies(child, skillKey, result);
  return result;
};

const expected = (skillKey, formulaKey, scenario) => {
  const rank = scenario.rank;
  const ap = scenario.attributes["SOURCE.ability_power.TOTAL"];
  const bonusAd = scenario.attributes["SOURCE.attack_damage.BONUS"];
  const p = key => rawParameter(skillKey, key, scenario);
  switch (`${skillKey}/${formulaKey}`) {
    case "katarina_p/dagger_magic_damage": return p("character_level_base_damage") + p("bonus_ad_ratio") * bonusAd + p("ap_ratio_by_character_level") * ap;
    case "katarina_q/magic_damage": return p("base_damage") + p("ap_ratio") * ap;
    case "katarina_e/magic_damage": return p("base_damage") + p("ap_ratio") * ap + p("total_ad_ratio") * scenario.attributes["SOURCE.attack_damage.TOTAL"];
    case "katarina_e/dagger_cooldown_reduction_ms": return p("dagger_cooldown_ratio_by_character_level") * p("actual_cooldown_multiplier") * p("data_cooldown_seconds") * p("milliseconds_per_second");
    case "katarina_r/magic_damage_per_tick": return p("magic_base_damage_per_tick") + p("magic_ap_ratio") * ap;
    case "katarina_r/total_magic_damage": return p("ticks_per_second") * p("duration_seconds") * (p("magic_base_damage_per_tick") + p("magic_ap_ratio") * ap);
    case "katarina_r/physical_damage_per_tick": return p("bonus_ad_ratio") * bonusAd * (p("one_ratio") + p("attack_speed_coefficient") * p("actual_attack_speed_ratio"));
    case "katarina_r/total_physical_damage": return p("ticks_per_second") * p("duration_seconds") * p("bonus_ad_ratio") * bonusAd * (p("one_ratio") + p("attack_speed_coefficient") * p("actual_attack_speed_ratio"));
    case "leblanc_q/initial_magic_damage": return p("base_damage") + p("ap_ratio") * ap;
    case "leblanc_q/mark_magic_damage": return p("mark_base_damage") + p("ap_ratio") * ap;
    case "leblanc_w/magic_damage": return p("base_damage") + p("ap_ratio") * ap;
    case "leblanc_e/initial_magic_damage": return p("initial_base_damage") + p("initial_ap_ratio") * ap;
    case "leblanc_e/delayed_magic_damage": return p("delayed_base_damage") + p("delayed_ap_ratio") * ap;
    case "leblanc_r/replicated_q_initial_damage": return p("rq1_base_damage") + p("rq1_re1_ap_ratio") * ap;
    case "leblanc_r/replicated_q_mark_damage": return p("rq2_base_damage") + p("rq2_ap_ratio") * ap;
    case "leblanc_r/replicated_w_damage": return p("rw_base_damage") + p("rw_ap_ratio") * ap;
    case "leblanc_r/replicated_e_initial_damage": return p("re1_base_damage") + p("rq1_re1_ap_ratio") * ap;
    case "leblanc_r/replicated_e_delayed_damage": return p("re2_base_damage") + p("re2_ap_ratio") * ap;
    case "vex_p/gloom_bonus_magic_damage": return p("actual_gloom_character_level_base_damage") + p("gloom_ap_ratio") * ap;
    case "vex_q/magic_damage": return p("base_damage") + p("ap_ratio") * ap;
    case "vex_w/shield_value": return p("base_shield") + p("shield_ap_ratio") * ap;
    case "vex_w/magic_damage": return p("base_damage") + p("damage_ap_ratio") * ap;
    case "vex_e/magic_damage": return p("base_damage") + p("ap_ratio") * ap;
    case "vex_r/first_magic_damage": return p("base_damage") + p("first_ap_ratio") * ap;
    case "vex_r/recast_magic_damage": return p("recast_base_damage") + p("recast_ap_ratio") * ap;
    case "zilean_q/magic_damage": return p("base_damage") + p("ap_ratio") * ap;
    case "zilean_r/revive_heal": return p("base_heal") + p("ap_ratio") * ap;
    default: throw new Error(`独立期望未覆盖：${skillKey}/${formulaKey}`);
  }
};

const scenarioFor = (skillKey, high) => ({
  rank: high ? skillOf(skillKey).maxLevel : 1,
  characterLevel: high ? 18 : 1,
  attributes: {
    "SOURCE.ability_power.TOTAL": high ? 420 : 120,
    "SOURCE.attack_damage.BONUS": high ? 210 : 65,
    "SOURCE.attack_damage.TOTAL": high ? 360 : 165,
  },
  runtime: {
    actual_cooldown_multiplier: high ? 0.55 : 0.8,
    actual_attack_speed_ratio: high ? 0.72 : 0.28,
    actual_gloom_character_level_base_damage: high ? 150 : 40,
  },
});

const formulaKeys = [];
const permittedOperations = new Set(["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MIN", "MAX"]);
for (const [skillKey, skill] of Object.entries(candidate.skills)) {
  const parameterKeys = new Set();
  for (const parameter of skill.write.parameters) {
    assert(!parameterKeys.has(parameter.parameterKey), "候选参数键重复", { skillKey, parameterKey: parameter.parameterKey });
    parameterKeys.add(parameter.parameterKey);
    assert(parameter.valueMode !== "RUNTIME_INPUT" || (parameter.fixedValue === null && parameter.levelValues === null), "运行输入带默认值", { skillKey, parameterKey: parameter.parameterKey });
    const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues ?? {});
    if (parameter.valueType === "INTEGER" || parameter.parameterKey.endsWith("_ms")) {
      assert(parameter.valueType === "INTEGER", "毫秒参数类型不是INTEGER", { skillKey, parameterKey: parameter.parameterKey });
      assert(values.every(Number.isInteger), "整数参数含小数", { skillKey, parameterKey: parameter.parameterKey, values });
      integerChecks.push({ skillKey, parameterKey: parameter.parameterKey, values, passed: true });
    }
    if (parameter.valueMode === "CHARACTER_LEVEL") assert(Object.keys(parameter.levelValues ?? {}).length === 18, "角色等级参数不是1至18完整映射", { skillKey, parameterKey: parameter.parameterKey });
  }
  for (const formula of skill.write.formulas) {
    const formulaKey = `${skillKey}/${formula.formulaKey}`;
    formulaKeys.push(formulaKey);
    const walkFormula = node => {
      assert(node && typeof node === "object", "公式节点为空", formulaKey);
      if (node.nodeType === "PARAMETER") { parameterOf(skillKey, node.parameterKey); return; }
      if (node.nodeType === "ATTRIBUTE") { assert(["SOURCE", "TARGET"].includes(node.attributeOwner) && ["TOTAL", "BASE", "BONUS"].includes(node.attributeValueKind), "公式属性口径非法", node); return; }
      assert(node.nodeType === "OPERATION" && permittedOperations.has(node.operation) && Array.isArray(node.operands) && node.operands.length === 2, "公式运算必须严格二元", node);
      walkFormula(node.operands[0]); walkFormula(node.operands[1]);
    };
    walkFormula(formula.expression);
    for (const high of [false, true]) {
      const scenario = scenarioFor(skillKey, high);
      const actual = evaluate(formula.expression, skillKey, scenario);
      const sourceExpected = expected(skillKey, formula.formulaKey, scenario);
      assert(Number.isFinite(actual) && close(actual, sourceExpected), "候选表达式与独立冻结源值期望不符", { formulaKey, actual, sourceExpected, rank: scenario.rank, characterLevel: scenario.characterLevel });
      formulaCases.push({ formulaKey, scenario: high ? "高端" : "低端", rank: scenario.rank, characterLevel: scenario.characterLevel, attributes: scenario.attributes, runtime: scenario.runtime, actual, sourceExpected, passed: true });
    }
    for (const dependency of collectDependencies(formula.expression, skillKey)) {
      const scenario = scenarioFor(skillKey, false);
      const [kind, key] = dependency.split("|");
      if (kind === "A") delete scenario.attributes[key];
      else delete scenario.runtime[key];
      let rejected = false;
      try { evaluate(formula.expression, skillKey, scenario); } catch { rejected = true; }
      assert(rejected, "缺失外部输入未拒绝", { formulaKey, dependency });
      missingValueRejections.push({ formulaKey, dependency, rejected: true });
    }
  }
}
assert(formulaKeys.length === 27, "公式总数不符", formulaKeys.length);
assert(formulaCases.length === 54, "公式双场景数量不符", formulaCases.length);
assert(missingValueRejections.length > 0, "没有执行缺值拒绝检查");

for (const [skillKey, formulaKey] of [["katarina_p", "dagger_magic_damage"], ["katarina_e", "dagger_cooldown_reduction_ms"]]) {
  for (const characterLevel of [0, 19]) {
    const scenario = scenarioFor(skillKey, false); scenario.characterLevel = characterLevel;
    const formula = skillOf(skillKey).write.formulas.find(item => item.formulaKey === formulaKey);
    let rejected = false;
    try { evaluate(formula.expression, skillKey, scenario); } catch { rejected = true; }
    assert(rejected, "非法角色等级未拒绝", { skillKey, characterLevel });
    rangeChecks.push({ check: "character_level", skillKey, characterLevel, rejected: true });
  }
}
for (const skillKey of ["katarina_q", "katarina_e", "katarina_r", "leblanc_q", "leblanc_w", "leblanc_e", "leblanc_r", "vex_q", "vex_w", "vex_e", "vex_r", "zilean_q", "zilean_r"]) {
  const skill = skillOf(skillKey);
  const formula = skill.write.formulas[0];
  for (const rank of [0, skill.maxLevel + 1]) {
    const scenario = scenarioFor(skillKey, false); scenario.rank = rank;
    let rejected = false;
    try { evaluate(formula.expression, skillKey, scenario); } catch { rejected = true; }
    assert(rejected, "非法技能等级未拒绝", { skillKey, rank });
    rangeChecks.push({ check: "skill_rank", skillKey, rank, rejected: true });
  }
}
rangeChecks.push({ check: "source_indices", details: "公式场景直接从冻结DataValues/计算树按技能等级索引读取；未使用候选参数值作为期望", passed: true });
rangeChecks.push({ check: "runtime_no_default", details: ["actual_cooldown_multiplier", "actual_attack_speed_ratio", "actual_gloom_character_level_base_damage"], passed: true });

const report = {
  at: new Date().toISOString(),
  status: "PASS",
  candidateMathReady: true,
  businessMathReady: false,
  candidateSha256: sha256File(candidatePath),
  sourceBindingSha256: sha256File(sourcePath),
  formulaCount: formulaKeys.length,
  formulaCaseCount: formulaCases.length,
  missingValueRejections: missingValueRejections.length,
  integerChecks: integerChecks.length,
  rangeChecks: rangeChecks.length,
  formulaCases,
  missing: missingValueRejections,
  integer: integerChecks,
  bounds: rangeChecks,
  sourceChecks: [...sourceChecks.values()],
  basis: "每个候选公式实际解析候选表达式；每个独立期望值直接读取冻结客户端DataValues和当前计算树，未从候选参数的固定值或等级值生成期望。两组明确角色等级、技能等级、属性和运行输入均通过；删除每个外部属性或运行输入均拒绝，非法等级、整数和毫秒约束均检查。未调用业务接口；业务实录仍须另行读取接口公式。",
  apiCalls: 0,
  apiWrites: 0,
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ status: report.status, candidateMathReady: report.candidateMathReady, formulaCount: report.formulaCount, formulaCases: report.formulaCaseCount, missing: report.missingValueRejections, integerChecks: report.integerChecks, rangeChecks: report.rangeChecks, candidateSha256: report.candidateSha256 }, null, 2));

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = "C:/project/damage_web_dev/.agents/artifacts/hero39-root-entry-20260910";
const candidatePath = "C:/project/damage_web_dev/.agents/artifacts/hero39-luna-candidate/修订一/完整候选.json";
const sourcePath = path.join(INPUT, "来源绑定与当前文本.json");
const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const candidateFileSha256 = sha256(fs.readFileSync(candidatePath));
const sourceFileSha256 = sha256(fs.readFileSync(sourcePath));
const getPath=process.env.HERO39_GET_REPORT;if(!getPath)throw new Error('必须提供独立GET快照');const actualGet=JSON.parse(fs.readFileSync(getPath));if(actualGet.status!=='PASS'||actualGet.actual.calls!==447||actualGet.candidateSha256!==candidateFileSha256)throw new Error('独立GET未通过或散列不符');
const actual=new Map(actualGet.rawResponses.map(x=>[x.route,x.data]));let actualHydrated=0;
for(const[k,sk]of Object.entries(candidate.skills))for(const[kind,id]of [['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey']])sk.write[kind]=sk.write[kind].map(p=>{const route='/skills/'+k+'/'+kind+'/'+p[id];if(!actual.has(route))throw new Error('缺少真实详情'+route);actualHydrated++;return actual.get(route);});if(actualHydrated!==215)throw new Error('实际组成数不符');
const sourceSkills = new Map(source.heroes.flatMap(hero => hero.skills.map(skill => [skill.skillKey, skill])));
const rawSkill = skillKey => {
  const value = sourceSkills.get(skillKey);
  if (!value) throw new Error("缺少冻结源技能 " + skillKey);
  return value;
};
const rawSpell = skillKey => rawSkill(skillKey).object?.mSpell || {};
const rawData = (skillKey, name, level) => {
  const row = (rawSpell(skillKey).DataValues || []).find(item => item.name === name);
  if (!row || !Array.isArray(row.values)) throw new Error("缺少冻结DataValues " + skillKey + "/" + name);
  const value = row.values[level];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("冻结DataValues不是有限值 " + skillKey + "/" + name + "/" + level);
  return value;
};
const rawCalculation = (skillKey, name) => {
  const value = rawSpell(skillKey).mSpellCalculations?.[name];
  if (!value) throw new Error("缺少冻结计算树 " + skillKey + "/" + name);
  return value;
};
const rawPart = (skillKey, name, index) => {
  const value = rawCalculation(skillKey, name).mFormulaParts?.[index];
  if (!value) throw new Error("缺少冻结计算树分支 " + skillKey + "/" + name + "/" + index);
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
  visit(rawCalculation(skillKey, calculationName), node => {
    if (!found && predicate(node)) found = node;
  });
  if (!found) throw new Error("计算树缺少原始节点 " + skillKey + "/" + calculationName);
  return found;
};
const rawNumber = (skillKey, calculationName) => firstNode(skillKey, calculationName, node => node.__type === "NumberCalculationPart").mNumber;
const rawCoefficient = (skillKey, calculationName, partIndex) => {
  const value = rawPart(skillKey, calculationName, partIndex).mCoefficient;
  if (typeof value !== "number") throw new Error("计算树系数缺失 " + skillKey + "/" + calculationName + "/" + partIndex);
  return value;
};
const rawCharValue = (skillKey, calculationName, characterLevel, partIndex = 0) => {
  let part = rawPart(skillKey, calculationName, partIndex);
  if (part.mSubpart) part = part.mSubpart;
  if (typeof part.mLevel1Value !== "number") throw new Error("角色等级原树缺少mLevel1Value " + skillKey + "/" + calculationName);
  const perLevel = typeof part.mInitialBonusPerLevel === "number" ? part.mInitialBonusPerLevel : 0;
  let result = part.mLevel1Value + perLevel * (characterLevel - 1);
  for (const breakpoint of part.mBreakpoints || []) {
    if (characterLevel >= breakpoint.mLevel) result += breakpoint.mAdditionalBonusAtThisLevel;
  }
  return result;
};

const parameterMap = skill => new Map(skill.write.parameters.map(item => [item.parameterKey, item]));
const expressionRefs = expression => {
  const refs = { parameters: [], attributes: [] };
  visit(expression, node => {
    if (node.nodeType === "PARAMETER") refs.parameters.push(node.parameterKey);
    if (node.nodeType === "ATTRIBUTE") refs.attributes.push(`${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`);
  });
  return refs;
};
const validateRuntime = (parameter, value, skillKey) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("运行输入不是有限数值 " + skillKey + "/" + parameter.parameterKey);
  if (parameter.valueType === "INTEGER" && (!Number.isInteger(value) || value < 0)) {
    throw new Error("INTEGER运行输入非法 " + skillKey + "/" + parameter.parameterKey);
  }
  if (parameter.parameterKey === "actual_style_grade_count" && (value < 0 || value > 6)) {
    throw new Error("评价等级超出0至6 " + skillKey + "/" + parameter.parameterKey);
  }
};
const getParameter = (skill, key, context) => {
  const parameter = parameterMap(skill).get(key);
  if (!parameter) throw new Error("候选参数不存在 " + skill.skillKey + "/" + key);
  let value;
  if (parameter.valueMode === "FIXED") value = parameter.fixedValue;
  else if (parameter.valueMode === "SKILL_LEVEL") value = parameter.levelValues?.[String(context.skillLevel)];
  else if (parameter.valueMode === "CHARACTER_LEVEL") value = parameter.levelValues?.[String(context.characterLevel)];
  else if (parameter.valueMode === "RUNTIME_INPUT") value = context.runtime?.[key];
  else throw new Error("未知参数模式 " + parameter.valueMode);
  if (value === undefined || value === null) throw new Error("缺少运行或等级输入 " + skill.skillKey + "/" + key);
  if (parameter.valueMode === "RUNTIME_INPUT") validateRuntime(parameter, value, skill.skillKey);
  return value;
};
const getAttribute = (node, context) => {
  const key = `${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`;
  const value = context.attributes?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("缺少属性输入 " + key);
  return value;
};
const evaluate = (node, skill, context) => {
  if (!node || typeof node !== "object") throw new Error("表达式节点为空");
  if (node.nodeType === "PARAMETER") return getParameter(skill, node.parameterKey, context);
  if (node.nodeType === "ATTRIBUTE") return getAttribute(node, context);
  if (node.nodeType !== "OPERATION") throw new Error("未知表达式节点 " + node.nodeType);
  if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error("运算节点必须恰好两个操作数");
  const [left, right] = node.operands.map(item => evaluate(item, skill, context));
  if (node.operation === "ADD") return left + right;
  if (node.operation === "MULTIPLY") return left * right;
  if (node.operation === "SUBTRACT") return left - right;
  throw new Error("未知运算 " + node.operation);
};
const close = (left, right, tolerance = 1e-6) => Number.isFinite(left) && Number.isFinite(right) &&
  Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const sourceTotalAD = context => context.attributes["SOURCE.attack_damage.TOTAL"];
const sourceBonusAD = context => context.attributes["SOURCE.attack_damage.BONUS"];
const sourceBonusHP = context => context.attributes["SOURCE.hp.BONUS"];
const sourceAP = context => context.attributes["SOURCE.ability_power.TOTAL"];

const runtimeValue = (skillKey, parameterKey, high, characterLevel) => {
  if (parameterKey === "actual_target_max_health") return high ? 4200 : 2400;
  if (parameterKey === "actual_current_enemy_healing_basis_damage") return high ? 1750 : 650;
  if (parameterKey === "actual_q_crit_lifesteal_ratio") return high ? 0.24 : 0.06;
  if (parameterKey === "actual_crit_multiplier") return high ? 2.1 : 1.25;
  if (parameterKey === "actual_mstat8_value") return high ? 0.85 : 0.25;
  if (parameterKey === "actual_mstat9_value") return high ? 2.05 : 1.3;
  if (parameterKey === "actual_stack_count") return high ? 500 : 100;
  if (parameterKey === "actual_style_grade_count") return high ? 6 : 2;
  if (parameterKey === "actual_attack_count_integer") return high ? 9 : 5;
  if (parameterKey === "actual_attack_speed_percent_points") return high ? 60 : 10;
  if (parameterKey === "melee_base_damage_at_character_level") {
    return rawCharValue("samira_p", "BonusMeleeDamage", characterLevel, 0);
  }
  if (parameterKey === "melee_ad_ratio_at_character_level") return high ? 0.09 : 0.045;
  throw new Error("未定义独立运行输入 " + skillKey + "/" + parameterKey);
};
const contextFor = (skill, high) => {
  const skillLevel = high ? skill.maxLevel : 1;
  const characterLevel = high ? 18 : 1;
  const runtime = {};
  for (const parameter of skill.write.parameters) {
    if (parameter.valueMode === "RUNTIME_INPUT") runtime[parameter.parameterKey] = runtimeValue(skill.skillKey, parameter.parameterKey, high, characterLevel);
  }
  return {
    skillLevel,
    characterLevel,
    runtime,
    attributes: {
      "SOURCE.attack_damage.TOTAL": high ? 340 : 200,
      "SOURCE.attack_damage.BONUS": high ? 180 : 80,
      "SOURCE.hp.TOTAL": high ? 5200 : 2200,
      "SOURCE.hp.BONUS": high ? 1800 : 600,
      "SOURCE.ability_power.TOTAL": high ? 250 : 80,
      "TARGET.hp.TOTAL": high ? 4600 : 2600,
    },
  };
};

const expected = (skillKey, formulaKey, context) => {
  const level = context.skillLevel;
  const characterLevel = context.characterLevel;
  const adTotal = sourceTotalAD(context);
  const adBonus = sourceBonusAD(context);
  const bonusHP = sourceBonusHP(context);
  const ap = sourceAP(context);
  const runtime = context.runtime;
  const d = name => rawData(skillKey, name, level);
  const c = name => rawCalculation(skillKey, name);
  switch (skillKey + "/" + formulaKey) {
    case "urgot_p/leg_physical_damage":
      return rawCharValue(skillKey, "ADDamage", characterLevel, 0) * adTotal +
        rawCharValue(skillKey, "PercentHPRatio", characterLevel) * runtime.actual_target_max_health;
    case "urgot_q/physical_damage":
      return d("BaseDamage") + rawCoefficient(skillKey, "TotalDamage", 1) * adTotal;
    case "urgot_w/damage_per_shot":
      return d("BaseDamage") + d("ADRatioTT") * adTotal;
    case "urgot_e/shield_value":
      return d("EShieldBaseHealth") + d("EShieldbADRatio") * adBonus + d("EShieldBonusHealthRatio") * bonusHP;
    case "urgot_e/physical_damage":
      return d("EBaseDamage") + rawCoefficient(skillKey, "EDamage", 1) * adBonus;
    case "urgot_r/physical_damage":
      return d("RBaseDamage") + d("RBonusADRatio") * adBonus;

    case "samira_p/melee_bonus_damage_base":
      return runtime.melee_base_damage_at_character_level + runtime.melee_ad_ratio_at_character_level * adTotal;
    case "samira_p/melee_bonus_damage_max":
      return rawNumber(skillKey, "EmpoweredMeleeDamageTooltip") *
        (runtime.melee_base_damage_at_character_level + runtime.melee_ad_ratio_at_character_level * adTotal);
    case "samira_p/style_move_speed_ratio_total":
      return rawCharValue(skillKey, "MSBonusNew", characterLevel) * runtime.actual_style_grade_count;
    case "samira_q/physical_damage":
      return d("BaseDamage") + d("QADRatio") * adTotal;
    case "samira_q/critical_physical_damage": {
      const base = d("BaseDamage") + d("QADRatio") * adTotal;
      const multiplier = rawNumber(skillKey, "CriticalDamageCalc") + d("CritDamageMod") *
        (runtime.actual_crit_multiplier - rawNumber(skillKey, "CriticalDamageCalc"));
      return base * multiplier;
    }
    case "samira_w/physical_damage_per_hit":
      return d("BaseDamage") + rawCoefficient(skillKey, "DamageCalc", 1) * adBonus;
    case "samira_e/dash_magic_damage":
      return d("BaseDamage") + rawCoefficient(skillKey, "DashDamage", 1) * adBonus;
    case "samira_r/physical_damage_per_shot":
      return d("BaseDamage") + d("ADRatio") * adTotal;
    case "samira_r/critical_physical_damage_per_shot":
      return (d("BaseDamage") + d("ADRatio") * adTotal) * runtime.actual_crit_multiplier;

    case "nilah_q/physical_damage_with_crit_scaling": {
      const base = d("BaseDamage") + d("QADRatio") * adTotal;
      const multiplier = rawNumber(skillKey, "DamageCalc") + runtime.actual_mstat8_value * d("ActiveCritScaling") *
        (runtime.actual_mstat9_value - rawNumber(skillKey, "DamageCalc"));
      return base * multiplier;
    }
    case "nilah_q/critical_lifesteal_ratio":
      return runtime.actual_mstat8_value * d("CritHealScalar");
    case "nilah_q/critical_armor_penetration_ratio":
      return runtime.actual_mstat8_value * d("CritArmorPenScalar");
    case "nilah_e/dash_physical_damage":
      return d("BaseDamage") + rawCoefficient(skillKey, "DashDamage", 1) * adBonus;
    case "nilah_r/burst_physical_damage":
      return d("DamageBase") + rawCoefficient(skillKey, "DamageCalc", 1) * adBonus;
    case "nilah_r/damage_per_tick":
      return d("DamagePerTick") + rawCoefficient(skillKey, "DamagePerTickCalc", 1) * adBonus;
    case "nilah_r/tooltip_sustained_damage":
      return rawNumber(skillKey, "DamagePerTickCalcTooltip") *
        (d("DamagePerTick") + rawCoefficient(skillKey, "DamagePerTickCalc", 1) * adBonus);
    case "nilah_r/self_healing_ratio":
      return rawNumber(skillKey, "ChampHealingPercent") + rawCoefficient(skillKey, "ChampHealingPercent", 1) * runtime.actual_mstat8_value +
        runtime.actual_q_crit_lifesteal_ratio;
    case "nilah_r/self_healing_amount":
      return (rawNumber(skillKey, "ChampHealingPercent") + rawCoefficient(skillKey, "ChampHealingPercent", 1) * runtime.actual_mstat8_value +
        runtime.actual_q_crit_lifesteal_ratio) * runtime.actual_current_enemy_healing_basis_damage;

    case "smolder_p/q_bonus_magic_damage":
      return rawData(skillKey, "QDamagePerStack", level) * runtime.actual_stack_count *
        (rawNumber(skillKey, "Passive_QDamageIncrease") + rawData(skillKey, "QCritRatio", level) * runtime.actual_mstat8_value *
          (runtime.actual_mstat9_value - rawNumber(skillKey, "Passive_QDamageIncrease")));
    case "smolder_p/w_bonus_magic_damage":
      return rawData(skillKey, "WDamagePerStack", level) * runtime.actual_stack_count;
    case "smolder_p/e_bonus_magic_damage_per_hit": {
      const multiplier = rawNumber(skillKey, "EBonusDamage") +
        rawCalculation(skillKey, "EBonusDamage").mMultiplier.mSubparts[1].mPart1.mCoefficient * runtime.actual_mstat8_value *
          (runtime.actual_mstat9_value - rawNumber(skillKey, "EBonusDamage"));
      return rawData(skillKey, "EDamagePerStack", level) * runtime.actual_stack_count * multiplier;
    }
    case "smolder_q/physical_damage_with_crit_scaling": {
      const base = d("BaseDamage") + d("ADRatio") * adBonus;
      const multiplier = rawNumber(skillKey, "TotalDamage") + runtime.actual_mstat8_value * d("CritRatio") *
        (runtime.actual_mstat9_value - rawNumber(skillKey, "TotalDamage"));
      return base * multiplier;
    }
    case "smolder_q/tier3_burn_max_health_ratio":
      return rawCoefficient(skillKey, "Tier3_Burn", 0) * adBonus + d("Tier3_Burn_Stack_Mult") * runtime.actual_stack_count;
    case "smolder_q/tier3_burn_true_damage":
      return (rawCoefficient(skillKey, "Tier3_Burn", 0) * adBonus + d("Tier3_Burn_Stack_Mult") * runtime.actual_stack_count) *
        runtime.actual_target_max_health;
    case "smolder_q/tier3_execute_health_threshold_ratio":
      return rawNumber(skillKey, "Tier3_ExecuteThreshold") * d("Tier3_ExecuteThresholdStart");
    case "smolder_w/initial_physical_damage":
      return d("BaseDamage") + d("HitADRatio") * adBonus;
    case "smolder_w/hero_explosion_physical_damage":
      return d("ExplosionBaseDamage") + rawCoefficient(skillKey, "ExplosionDamage", 1) * adBonus +
        rawCoefficient(skillKey, "ExplosionDamage", 2) * ap;
    case "smolder_e/attack_count_unrounded":
      return d("NumOfAttacksBase") + d("NumAttackStackRatio") * runtime.actual_stack_count;
    case "smolder_e/physical_damage_per_hit":
      return d("BaseDamage") + d("ADRatio") * adTotal;
    case "smolder_r/outer_physical_damage":
      return d("BaseDamage") + d("ADRatio") * adBonus + rawCoefficient(skillKey, "TotalDamage", 2) * ap;
    case "smolder_r/center_physical_damage":
      return rawData(skillKey, "SweetspotPercentageIncrease", level) *
        (d("BaseDamage") + d("ADRatio") * adBonus + rawCoefficient(skillKey, "TotalDamage", 2) * ap);
    case "smolder_r/self_healing_amount":
      return d("MomHeal") + rawCoefficient(skillKey, "MomHealCalc", 1) * adBonus + rawCoefficient(skillKey, "MomHealCalc", 2) * ap;
    default:
      throw new Error("没有独立原始期望映射 " + skillKey + "/" + formulaKey);
  }
};

const failures = [];
const formulaCases = [];
const fail = (kind, detail) => failures.push({ kind, ...detail });
const runtimeKeysForFormula = (skill, formula) => {
  const refs = expressionRefs(formula.expression);
  return [...new Set(refs.parameters)].filter(key => parameterMap(skill).get(key)?.valueMode === "RUNTIME_INPUT");
};
const attributeKeysForFormula = formula => [...new Set(expressionRefs(formula.expression).attributes)];
let formulaCaseCount = 0;
let missingInputChecks = 0;
let binaryChecks = 0;
for (const skill of Object.values(candidate.skills)) {
  for (const formula of skill.write.formulas) {
    for (const high of [false, true]) {
      const context = contextFor(skill, high);
      try {
        const actual = evaluate(formula.expression, skill, context);
        const sourceExpected = expected(skill.skillKey, formula.formulaKey, context);
        const passed = close(actual, sourceExpected);
        if (!passed) fail("sourceExpectedMismatch", { skillKey: skill.skillKey, formulaKey: formula.formulaKey, high, actual, sourceExpected });
        formulaCases.push({ skillKey: skill.skillKey, formulaKey: formula.formulaKey, high, skillLevel: context.skillLevel, characterLevel: context.characterLevel, actual, sourceExpected, passed });
      } catch (error) {
        formulaCases.push({ skillKey: skill.skillKey, formulaKey: formula.formulaKey, high, skillLevel: context.skillLevel, characterLevel: context.characterLevel, passed: false, error: error.message });
        fail("formulaEvaluation", { skillKey: skill.skillKey, formulaKey: formula.formulaKey, high, message: error.message });
      }
      formulaCaseCount += 1;
    }
    for (const runtimeKey of runtimeKeysForFormula(skill, formula)) {
      const context = contextFor(skill, false);
      delete context.runtime[runtimeKey];
      try {
        evaluate(formula.expression, skill, context);
        fail("missingRuntimeAccepted", { skillKey: skill.skillKey, formulaKey: formula.formulaKey, runtimeKey });
      } catch (error) {
        missingInputChecks += 1;
      }
    }
    for (const attributeKey of attributeKeysForFormula(formula)) {
      const context = contextFor(skill, false);
      delete context.attributes[attributeKey];
      try {
        evaluate(formula.expression, skill, context);
        fail("missingAttributeAccepted", { skillKey: skill.skillKey, formulaKey: formula.formulaKey, attributeKey });
      } catch (error) {
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

const seriesMappings = {
  "urgot_q/base_damage": ["BaseDamage", value => value],
  "urgot_q/slow_percent_points": ["SlowAmount", value => value * 100],
  "urgot_w/ad_ratio": ["ADRatioTT", value => value],
  "urgot_e/shield_base": ["EShieldBaseHealth", value => value],
  "urgot_e/damage_base": ["EBaseDamage", value => value],
  "urgot_r/damage_base": ["RBaseDamage", value => value],
  "samira_q/base_damage": ["BaseDamage", value => value],
  "samira_w/base_damage": ["BaseDamage", value => value],
  "samira_e/damage_base": ["BaseDamage", value => value],
  "samira_e/bonus_attack_speed_ratio": ["BonusAttackSpeed", value => value],
  "samira_r/base_damage": ["BaseDamage", value => value],
  "nilah_q/base_damage": ["BaseDamage", value => value],
  "nilah_e/damage_base": ["BaseDamage", value => value],
  "nilah_r/damage_base": ["DamageBase", value => value],
  "nilah_r/damage_per_tick_base": ["DamagePerTick", value => value],
  "smolder_q/base_damage": ["BaseDamage", value => value],
  "smolder_w/initial_damage_base": ["BaseDamage", value => value],
  "smolder_w/explosion_damage_base": ["ExplosionBaseDamage", value => value],
  "smolder_e/damage_base": ["BaseDamage", value => value],
  "smolder_r/damage_base": ["BaseDamage", value => value],
  "smolder_r/heal_base": ["MomHeal", value => value],
};
let sourceSeriesChecks = 0;
for (const skill of Object.values(candidate.skills)) {
  for (const parameter of skill.write.parameters) {
    if (!parameter.levelValues) continue;
    const mapping = seriesMappings[skill.skillKey + "/" + parameter.parameterKey];
    if (mapping) {
      const [sourceName, transform] = mapping;
      const levels = Object.keys(parameter.levelValues).sort((left, right) => Number(left) - Number(right));
      for (const key of levels) {
        const value = parameter.levelValues[key];
        const sourceValue = transform(rawData(skill.skillKey, sourceName, Number(key)));
        sourceSeriesChecks += 1;
        if (!close(value, sourceValue)) fail("sourceSeriesMismatch", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey, level: Number(key), actual: value, sourceExpected: sourceValue, sourceName });
      }
      continue;
    }
    if (skill.skillKey === "urgot_p" && parameter.parameterKey === "leg_attack_cooldown_ms") {
      for (const [key, value] of Object.entries(parameter.levelValues)) {
        const sourceValue = Math.round(rawCharValue("urgot_p", "PerLegCD", Number(key)) * 1000);
        sourceSeriesChecks += 1;
        if (value !== sourceValue) fail("sourceSeriesMismatch", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey, level: Number(key), actual: value, sourceExpected: sourceValue, sourceName: "PerLegCD" });
      }
      continue;
    }
    if (skill.skillKey === "urgot_p" && parameter.parameterKey === "leg_attack_ad_ratio") {
      for (const [key, value] of Object.entries(parameter.levelValues)) {
        const sourceValue = rawCharValue("urgot_p", "ADDamage", Number(key));
        sourceSeriesChecks += 1;
        if (!close(value, sourceValue)) fail("sourceSeriesMismatch", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey, level: Number(key), actual: value, sourceExpected: sourceValue, sourceName: "ADDamage" });
      }
      continue;
    }
    if (skill.skillKey === "urgot_p" && parameter.parameterKey === "leg_attack_target_max_health_ratio") {
      for (const [key, value] of Object.entries(parameter.levelValues)) {
        const sourceValue = rawCharValue("urgot_p", "PercentHPRatio", Number(key));
        sourceSeriesChecks += 1;
        if (!close(value, sourceValue)) fail("sourceSeriesMismatch", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey, level: Number(key), actual: value, sourceExpected: sourceValue, sourceName: "PercentHPRatio" });
      }
      continue;
    }
    if (skill.skillKey === "samira_p" && ["queen_max_dash_range_points", "style_move_speed_ratio_per_grade"].includes(parameter.parameterKey)) {
      const sourceName = parameter.parameterKey === "queen_max_dash_range_points" ? "QueenMaxDashRange" : "MSBonusNew";
      for (const [key, value] of Object.entries(parameter.levelValues)) {
        const sourceValue = rawCharValue("samira_p", sourceName, Number(key));
        sourceSeriesChecks += 1;
        if (!close(value, sourceValue)) fail("sourceSeriesMismatch", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey, level: Number(key), actual: value, sourceExpected: sourceValue, sourceName });
      }
      continue;
    }
    if (skill.skillKey === "urgot_w" && parameter.parameterKey === "finite_duration_ms") {
      for (const [key, value] of Object.entries(parameter.levelValues)) {
        const sourceValue = Math.round(rawData("urgot_w", "Duration", Number(key)) * 1000);
        sourceSeriesChecks += 1;
        if (value !== sourceValue) fail("sourceSeriesMismatch", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey, level: Number(key), actual: value, sourceExpected: sourceValue, sourceName: "Duration" });
      }
    }
  }
}

let integerChecks = 0;
let millisecondTypeChecks = 0;
let runtimeGuardChecks = 0;
for (const skill of Object.values(candidate.skills)) {
  for (const parameter of skill.write.parameters) {
    const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
    if (parameter.valueType === "INTEGER") {
      for (const value of values) {
        if (value === null || value === undefined) continue;
        integerChecks += 1;
        if (!Number.isInteger(value) || value < 0) fail("nonIntegerParameter", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey, value });
      }
    }
    if (parameter.parameterKey.endsWith("_ms")) {
      millisecondTypeChecks += 1;
      if (parameter.valueType !== "INTEGER") fail("millisecondTypeMismatch", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey, valueType: parameter.valueType });
    }
    if (parameter.valueMode !== "RUNTIME_INPUT" || parameter.valueType !== "INTEGER") continue;
    const context = contextFor(skill, false);
    for (const invalid of [-1, 1.5]) {
      context.runtime[parameter.parameterKey] = invalid;
      try {
        getParameter(skill, parameter.parameterKey, context);
        fail("invalidIntegerAccepted", { skillKey: skill.skillKey, parameterKey: parameter.parameterKey, invalid });
      } catch (error) {
        runtimeGuardChecks += 1;
      }
    }
  }
}

let boundaryChecks = 0;
const boundary = (label, actual, expectedValue) => {
  boundaryChecks += 1;
  if (!close(actual, expectedValue)) fail("boundaryMismatch", { label, actual, expected: expectedValue });
};
boundary("urgot_p/level_6_cooldown_ms", rawCharValue("urgot_p", "PerLegCD", 6) * 1000, 20000);
boundary("urgot_p/level_15_ad_ratio", rawCharValue("urgot_p", "ADDamage", 15), 1);
boundary("urgot_p/level_13_hp_ratio", rawCharValue("urgot_p", "PercentHPRatio", 13), 0.05999999865889549);
boundary("samira_p/level_4_dash_range", rawCharValue("samira_p", "QueenMaxDashRange", 4), 725);
boundary("samira_p/level_16_dash_range", rawCharValue("samira_p", "QueenMaxDashRange", 16), 950);
boundary("samira_p/level_18_move_speed_ratio", rawCharValue("samira_p", "MSBonusNew", 18), 0.034999999683350325);
boundary("urgot_q/slow_level_1_percent_points", rawData("urgot_q", "SlowAmount", 1) * 100, 45);
boundary("nilah_r/negative_slow_to_positive_points", Math.abs(rawData("nilah_r", "Microslow", 1) * 100), 10.000000149011612);
boundary("smolder_w/slow_percent_points", rawData("smolder_w", "SlowAmount", 1) * 100, 34.99999940395355);
boundary("smolder_q/execute_ratio", rawNumber("smolder_q", "Tier3_ExecuteThreshold") * rawData("smolder_q", "Tier3_ExecuteThresholdStart", 1), 0.0649999985474348);
boundary("smolder_e/attack_count_stack_0", rawData("smolder_e", "NumOfAttacksBase", 1) + rawData("smolder_e", "NumAttackStackRatio", 1) * 0, 5);
boundary("smolder_e/attack_count_stack_100", rawData("smolder_e", "NumOfAttacksBase", 1) + rawData("smolder_e", "NumAttackStackRatio", 1) * 100, 5.999999776482582);
boundary("smolder_e/floor_stack_100", Math.floor(rawData("smolder_e", "NumOfAttacksBase", 1) + rawData("smolder_e", "NumAttackStackRatio", 1) * 100), 5);
const separationContext = contextFor(candidate.skills.urgot_p, false);
if (separationContext.attributes["SOURCE.hp.TOTAL"] === separationContext.runtime.actual_target_max_health) {
  fail("sourceTargetScenarioNotSeparated", { sourceHp: separationContext.attributes["SOURCE.hp.TOTAL"], targetMaxHp: separationContext.runtime.actual_target_max_health });
}

if (formulaCases.length !== formulaCaseCount) fail("formulaCaseCountMismatch", { formulaCaseCount, recorded: formulaCases.length });
const formulaCount = Object.values(candidate.skills).reduce((sum, skill) => sum + skill.write.formulas.length, 0);
if (formulaCaseCount !== formulaCount * 2) fail("formulaScenarioCountMismatch", { formulaCount, formulaCaseCount });
const report = {
  actualHydrated,actualGETFile:getPath,actualGETSha256:sha256(fs.readFileSync(getPath)),
  generatedAt: new Date().toISOString(),
  status: failures.length === 0 ? "PASS" : "FAIL",
  revision: candidate.meta.revision,
  candidateFileSha256,
  sourceFileSha256,
  sourcePolicy: "实际侧读取独立447GET快照中的真实参数和表达式；期望侧只读取固定输入包来源绑定的DataValues、mSpellCalculations和当前文本所确定的常量。两侧不从同一份候选参数互相代算。",
  formulaCount,
  formulaCaseCount,
  formulaCases,
  missingInputChecks,
  binaryChecks,
  integerChecks,
  millisecondTypeChecks,
  runtimeGuardChecks,
  sourceSeriesChecks,
  boundaryChecks,
  failures,
  apiCalls: 0,
  apiWrites: 0,
  businessWrites: 0,
  noBusinessWrites: true,
  noBrowser: true,
  notes: [
    "厄加特E的mStat2/mStatFormula2和mStat12/mStatFormula2分别按来源额外攻击力与来源额外生命读取；属性与目标生命场景故意使用不同数值。",
    "莎弥拉被动角色等级中间总攻击力比例仍使用外供运行输入；独立期望只从原树读取固定端点，不从端点猜中间曲线。",
    "尼菈R的NumTicks与正文4倍持续伤害展示值并存；脚本只核对4倍树，不把6跳宣称为实际跳数。",
    "斯莫德E只核算未取整原式，并用独立floor边界记录向下取整约束；候选没有伪造取整运算。",
    "脚本只做真实GET详情的静态表达式代入核对，不代表战斗运行时或页面证据。",
  ],
};
const reportPath = path.join(ROOT, "独立源值数学报告.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  status: report.status,
  formulaCount,
  formulaCaseCount,
  missingInputChecks,
  binaryChecks,
  integerChecks,
  millisecondTypeChecks,
  runtimeGuardChecks,
  sourceSeriesChecks,
  boundaryChecks,
  failures: failures.length,
  candidateFileSha256,
  sourceFileSha256,
}, null, 2));
if (failures.length > 0) process.exitCode = 1;

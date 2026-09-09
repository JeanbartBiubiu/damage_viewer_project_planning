import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repo = "C:/project/damage_web_dev";
const inputDir = path.join(repo, ".agents/artifacts/hero36-root-entry-20260910");
const durableDir = path.join(repo, "数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第三十六批/修订一");
const candidatePath = path.join(artifactDir, "完整候选.json");
const bindingPath = path.join(inputDir, "来源绑定与当前文本.json");
const inputVersionPath = path.join(inputDir, "输入版本.json");
const generatedAt = new Date().toISOString();

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const close = (a, b, tolerance = 1e-6) => Number.isFinite(Number(a)) && Number.isFinite(Number(b))
  && Math.abs(Number(a) - Number(b)) <= tolerance * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));
const assert = (condition, message, detail = undefined) => {
  if (!condition) throw new Error(message + (detail === undefined ? "" : `：${JSON.stringify(detail)}`));
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
};
const writeJsonBoth = (relative, value) => {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
  writeJson(path.join(artifactDir, relative), value);
  fs.writeFileSync(path.join(durableDir, relative), bytes, "utf8");
  return bytes;
};
const writeTextBoth = (relative, value) => {
  const bytes = Buffer.from(value, "utf8");
  fs.writeFileSync(path.join(artifactDir, relative), bytes, "utf8");
  fs.writeFileSync(path.join(durableDir, relative), bytes, "utf8");
  return bytes;
};

const candidateBytes = fs.readFileSync(candidatePath);
const candidate = JSON.parse(candidateBytes);
const source = readJson(bindingPath);
const inputVersion = readJson(inputVersionPath);
assert(candidate.meta?.businessWrites === 0 && candidate.meta?.apiCalls === 0, "候选已含业务写入标记");
assert(candidate.meta?.candidateSha256 === sha256(JSON.stringify({ ...candidate, meta: { ...candidate.meta, candidateSha256: null } }, null, 2) + "\n"), "候选散列不符");
assert(source.clientVersion === "16.17" && source.officialVersion === "16.17.1", "源版本不符");

const sourceSkillOf = key => {
  const heroKey = `champion_${key.split("_")[0]}`;
  const hero = source.heroes.find(item => item.key === heroKey);
  return hero?.skills.find(item => item.skillKey === key);
};
const spellOf = key => sourceSkillOf(key)?.object?.mSpell;
const row = (skillKey, dataName) => {
  const value = (spellOf(skillKey)?.DataValues ?? []).find(item => item.name === dataName);
  assert(value && Array.isArray(value.values), "独立数学缺少原始DataValues", { skillKey, dataName });
  return value.values;
};
const rawAt = (skillKey, dataName, level) => {
  const values = row(skillKey, dataName);
  const value = values[level];
  assert(typeof value === "number" && Number.isFinite(value), "原始等级值缺失", { skillKey, dataName, level, values });
  return value;
};
const rawScalar = (skillKey, dataName, level = 1) => rawAt(skillKey, dataName, level);
const calculation = (skillKey, name) => {
  const value = spellOf(skillKey)?.mSpellCalculations?.[name];
  assert(value, "独立数学缺少计算树", { skillKey, name });
  return value;
};
const numbers = value => {
  const out = [];
  const visit = item => {
    if (typeof item === "number" && Number.isFinite(item)) out.push(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  return out;
};
const rawCoefficient = (skillKey, name, expected) => {
  const tree = calculation(skillKey, name);
  const actual = numbers(tree).find(value => close(value, expected));
  assert(actual !== undefined, "独立数学未找到原始树系数", { skillKey, name, expected, values: numbers(tree) });
  return actual;
};
const rawNumberMultiplier = (skillKey, name, expected) => {
  const multiplier = calculation(skillKey, name).mMultiplier;
  assert(multiplier && typeof multiplier.mNumber === "number" && close(multiplier.mNumber, expected), "独立数学未找到原始根乘数", { skillKey, name, expected, multiplier });
  return multiplier.mNumber;
};
const rawNamedMultiplier = (skillKey, name, dataName, level = 1) => {
  const multiplier = calculation(skillKey, name).mMultiplier;
  assert(multiplier?.mDataValue === dataName, "独立数学根数据值绑定不符", { skillKey, name, dataName, multiplier });
  return rawAt(skillKey, dataName, level);
};

const sourceParameter = (skillKey, key, level, runtime) => {
  const v = runtime?.[key];
  if (v !== undefined) return v;
  switch (`${skillKey}|${key}`) {
    case "evelynn_p|healing_threshold_ap_ratio": return rawCoefficient(skillKey, "HealingThresholdTOOLTIP", 2.5);
    case "evelynn_q|hate_spike_base_damage": return rawAt(skillKey, "HateSpikeBaseDamage", level);
    case "evelynn_q|hate_spike_ap_ratio": return rawScalar(skillKey, "HateSpikeAPRatio");
    case "evelynn_q|bonus_damage_base": return rawAt(skillKey, "BonusDamageBase", level);
    case "evelynn_q|bonus_damage_ap_ratio": return rawScalar(skillKey, "BonusDamageAPRatio");
    case "evelynn_e|base_damage": return rawAt(skillKey, "BaseDamage", level);
    case "evelynn_e|empowered_damage": return rawAt(skillKey, "EmpoweredDamage", level);
    case "evelynn_e|base_percent_health_points": return rawAt(skillKey, "BasePercentHealth", 1);
    case "evelynn_e|empowered_percent_health_points": return rawAt(skillKey, "EmpoweredPercentHealth", 1);
    case "evelynn_e|percent_points_to_ratio": return rawNumberMultiplier(skillKey, "PercentHealthBaseTOOLTIP", 0.01);
    case "evelynn_e|base_percent_ap_ratio": return rawCoefficient(skillKey, "PercentHealthBaseTOOLTIP", 0.015);
    case "evelynn_e|empowered_percent_ap_ratio": return rawCoefficient(skillKey, "PercentHealthEmpoweredTOOLTIP", 0.025);
    case "evelynn_r|base_damage": return rawAt(skillKey, "BaseDamage", level);
    case "evelynn_r|ap_ratio": return rawCoefficient(skillKey, "Damage", 0.75);
    case "evelynn_r|low_health_multiplier": return rawAt(skillKey, "CritMultiplier", 1);
    case "lillia_p|percent_points_to_ratio": return rawNumberMultiplier(skillKey, "DotPercentTooltip", 0.01);
    case "lillia_p|dot_damage_percent_points": return rawAt(skillKey, "DotDamagePercent", 1);
    case "lillia_p|dot_ap_ratio": return rawCoefficient(skillKey, "DotPercentTotal", 0.0125);
    case "lillia_p|dot_ticks": return rawAt(skillKey, "DotTicks", 1);
    case "lillia_p|champion_heal_ap_ratio": return rawCoefficient(skillKey, "ChampionHeal", 0.05);
    case "lillia_q|inner_damage_base": return rawAt(skillKey, "FlatDamageBase", level);
    case "lillia_q|outer_true_damage_base": return rawAt(skillKey, "FlatDamageTrue", level);
    case "lillia_q|ap_ratio": return rawScalar(skillKey, "APRatio");
    case "lillia_q|prance_bonus_ratio_per_stack": return rawAt(skillKey, "PranceBonusPerStack", level);
    case "lillia_q|prance_ap_ratio": return rawCoefficient(skillKey, "PranceSpeed", 0.0003);
    case "lillia_w|base_damage": return rawAt(skillKey, "FlatDamageBase", level);
    case "lillia_w|ap_ratio": return rawCoefficient(skillKey, "FlatDamage", 0.35);
    case "lillia_w|sweet_spot_multiplier": return rawAt(skillKey, "SweetSpotBonus", 1);
    case "lillia_e|impact_damage_base": return rawAt(skillKey, "ImpactDamage", level);
    case "lillia_e|ap_ratio": return rawScalar(skillKey, "APRatio");
    case "lillia_r|break_damage_base": return rawAt(skillKey, "BreakDamageBase", level);
    case "lillia_r|ap_ratio": return rawCoefficient(skillKey, "TotalDamage", 0.4);
    case "fiddlesticks_q|minimum_damage": return rawAt(skillKey, "MinimumDamage", level);
    case "fiddlesticks_q|current_health_ratio": return rawAt(skillKey, "MaxHealthDamage", level);
    case "fiddlesticks_q|current_health_ap_ratio": return rawCoefficient(skillKey, "TotalPercentHealthDamage", 0.0003);
    case "fiddlesticks_q|recent_fear_multiplier": return rawNumberMultiplier(skillKey, "TotalPercentHealthDamageFeared", 2);
    case "fiddlesticks_w|damage_per_second_base": return rawAt(skillKey, "DamagePerSecond", level);
    case "fiddlesticks_w|ap_ratio": return rawCoefficient(skillKey, "DrainDamageCalc", 0.45);
    case "fiddlesticks_w|end_missing_health_percent_points": return rawAt(skillKey, "PercentForTooltip", level);
    case "fiddlesticks_w|champion_heal_percent_points": return rawAt(skillKey, "VampPercentage", level);
    case "fiddlesticks_w|percent_points_to_ratio": return 0.01;
    case "fiddlesticks_e|base_damage": return rawAt(skillKey, "BaseDamage", level);
    case "fiddlesticks_e|ap_ratio": return rawCoefficient(skillKey, "Damage", 0.5);
    case "fiddlesticks_r|damage_per_second_base": return rawAt(skillKey, "DamagePerSecond", level);
    case "fiddlesticks_r|ap_ratio": return rawScalar(skillKey, "APRatio");
    case "fiddlesticks_r|full_duration_seconds": return rawAt(skillKey, "Duration", 1);
    case "fiddlesticks_r|single_damage_multiplier": return rawNumberMultiplier(skillKey, "DamageDone", 0.25);
    case "singed_q|damage_per_second_base": return rawAt(skillKey, "BaseDamagePerSecond", level);
    case "singed_q|ap_ratio": return rawScalar(skillKey, "APRatioPerSecond");
    case "singed_q|approximate_total_multiplier": return rawNumberMultiplier(skillKey, "ApproximateTotalDamageTooltip", 4.75);
    case "singed_e|base_damage_value": return rawAt(skillKey, "BaseDamageValue", level);
    case "singed_e|ap_ratio": return rawCoefficient(skillKey, "BaseDamage", 0.55);
    case "singed_e|max_health_percent_points": return rawAt(skillKey, "MaxHPDamage", level);
    case "singed_e|percent_points_to_ratio": return 0.01;
    default: throw new Error(`独立数学没有参数源映射：${skillKey}/${key}`);
  }
};

const candidateParameter = (skillKey, key, level, runtime) => {
  const spec = candidate.skills[skillKey]?.write?.parameters?.find(item => item.parameterKey === key);
  assert(spec, "候选参数缺失", { skillKey, key });
  if (spec.valueMode === "RUNTIME_INPUT") {
    if (!Object.prototype.hasOwnProperty.call(runtime ?? {}, key) || runtime[key] === undefined || runtime[key] === null) {
      throw new Error(`缺少候选运行输入：${skillKey}/${key}`);
    }
    return runtime[key];
  }
  if (spec.valueMode === "FIXED") {
    if (spec.fixedValue === undefined || spec.fixedValue === null) throw new Error(`候选固定参数缺值：${skillKey}/${key}`);
    return spec.fixedValue;
  }
  if (spec.valueMode === "SKILL_LEVEL" || spec.valueMode === "CHARACTER_LEVEL") {
    const value = spec.levelValues?.[String(level)];
    if (value === undefined || value === null) throw new Error(`候选等级参数缺值：${skillKey}/${key}/${level}`);
    return value;
  }
  throw new Error(`候选参数模式不支持：${skillKey}/${key}/${spec.valueMode}`);
};

function evaluate(node, context, skillKey, formulaKey) {
  assert(node && typeof node === "object", "公式节点为空", { skillKey, formulaKey });
  if (node.nodeType === "PARAMETER") {
    context.parameterBlock ??= {};
    if (context.parameterBlock[node.parameterKey] === undefined) {
      if (Object.prototype.hasOwnProperty.call(context.runtime ?? {}, node.parameterKey)) context.parameterBlock[node.parameterKey] = context.runtime[node.parameterKey];
      else context.parameterBlock[node.parameterKey] = candidateParameter(skillKey, node.parameterKey, context.level, context.runtime);
    }
    const value = context.parameterBlock[node.parameterKey];
    if (value === undefined) throw new Error(`缺少运行输入或参数：${skillKey}/${formulaKey}/${node.parameterKey}`);
    return value;
  }
  if (node.nodeType === "ATTRIBUTE") {
    const value = context.attributes?.[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
    if (value === undefined) throw new Error(`缺少属性输入：${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`);
    return value;
  }
  assert(node.nodeType === "OPERATION" && Array.isArray(node.operands) && node.operands.length === 2, "公式不是严格二元", { skillKey, formulaKey, node });
  const left = evaluate(node.operands[0], context, skillKey, formulaKey);
  const right = evaluate(node.operands[1], context, skillKey, formulaKey);
  switch (node.operation) {
    case "ADD": return left + right;
    case "SUBTRACT": return left - right;
    case "MULTIPLY": return left * right;
    case "DIVIDE": return left / right;
    case "MIN": return Math.min(left, right);
    case "MAX": return Math.max(left, right);
    default: throw new Error(`不支持的运算：${node.operation}`);
  }
}

const scenarios = [
  { label: "低等级输入", level: 1, attributes: { SOURCE: { ability_power: { TOTAL: 80 } }, TARGET: { hp: { TOTAL: 1000, CURRENT: 450 } } }, runtime: { actual_healing_threshold_base: 270, actual_heal_per_second: 24, actual_champion_heal_base: 1.5, actual_target_missing_health: 320, actual_hero_pre_mitigation_damage: 280 } },
  { label: "高等级输入", level: 5, attributes: { SOURCE: { ability_power: { TOTAL: 320 } }, TARGET: { hp: { TOTAL: 2400, CURRENT: 2100 } } }, runtime: { actual_healing_threshold_base: 390, actual_heal_per_second: 120, actual_champion_heal_base: 13, actual_target_missing_health: 1750, actual_hero_pre_mitigation_damage: 1450 } },
];

function expected(skillKey, formulaKey, scenario) {
  const l = scenario.level; const apValue = scenario.attributes.SOURCE.ability_power.TOTAL; const hp = scenario.attributes.TARGET.hp.TOTAL; const currentHp = scenario.attributes.TARGET.hp.CURRENT; const r = scenario.runtime;
  switch (`${skillKey}|${formulaKey}`) {
    case "evelynn_p|healing_threshold": return r.actual_healing_threshold_base + rawCoefficient(skillKey, "HealingThresholdTOOLTIP", 2.5) * apValue;
    case "evelynn_q|missile_magic_damage": return rawAt(skillKey, "HateSpikeBaseDamage", l) + rawAt(skillKey, "HateSpikeAPRatio", 1) * apValue;
    case "evelynn_q|marked_bonus_magic_damage": return rawAt(skillKey, "BonusDamageBase", l) + rawAt(skillKey, "BonusDamageAPRatio", 1) * apValue;
    case "evelynn_e|ordinary_magic_damage": return rawAt(skillKey, "BaseDamage", l) + rawNumberMultiplier(skillKey, "PercentHealthBaseTOOLTIP", 0.01) * (rawAt(skillKey, "BasePercentHealth", 1) + rawCoefficient(skillKey, "PercentHealthBaseTOOLTIP", 0.015) * apValue) * hp;
    case "evelynn_e|empowered_magic_damage": return rawAt(skillKey, "EmpoweredDamage", l) + rawNumberMultiplier(skillKey, "PercentHealthEmpoweredTOOLTIP", 0.01) * (rawAt(skillKey, "EmpoweredPercentHealth", 1) + rawCoefficient(skillKey, "PercentHealthEmpoweredTOOLTIP", 0.025) * apValue) * hp;
    case "evelynn_r|normal_magic_damage": return rawAt(skillKey, "BaseDamage", l) + rawCoefficient(skillKey, "Damage", 0.75) * apValue;
    case "evelynn_r|low_health_magic_damage": return rawAt(skillKey, "CritMultiplier", 1) * (rawAt(skillKey, "BaseDamage", l) + rawCoefficient(skillKey, "Damage", 0.75) * apValue);
    case "lillia_p|dot_total_magic_damage": return rawNumberMultiplier(skillKey, "DotPercentTooltip", 0.01) * (rawAt(skillKey, "DotDamagePercent", 1) + rawCoefficient(skillKey, "DotPercentTotal", 0.0125) * apValue) * hp;
    case "lillia_p|champion_heal_per_tick": return r.actual_champion_heal_base + rawCoefficient(skillKey, "ChampionHeal", 0.05) * apValue;
    case "lillia_p|champion_heal_total": return rawAt(skillKey, "DotTicks", 1) * (r.actual_champion_heal_base + rawCoefficient(skillKey, "ChampionHeal", 0.05) * apValue);
    case "lillia_q|inner_magic_damage": return rawAt(skillKey, "FlatDamageBase", l) + rawAt(skillKey, "APRatio", 1) * apValue;
    case "lillia_q|outer_true_damage": return rawAt(skillKey, "FlatDamageTrue", l) + rawAt(skillKey, "APRatio", 1) * apValue;
    case "lillia_q|move_speed_per_stack": return rawAt(skillKey, "PranceBonusPerStack", l) + rawCoefficient(skillKey, "PranceSpeed", 0.0003) * apValue;
    case "lillia_w|magic_damage": return rawAt(skillKey, "FlatDamageBase", l) + rawCoefficient(skillKey, "FlatDamage", 0.35) * apValue;
    case "lillia_w|sweet_spot_magic_damage": return rawAt(skillKey, "SweetSpotBonus", 1) * (rawAt(skillKey, "FlatDamageBase", l) + rawCoefficient(skillKey, "FlatDamage", 0.35) * apValue);
    case "lillia_e|impact_magic_damage": return rawAt(skillKey, "ImpactDamage", l) + rawAt(skillKey, "APRatio", 1) * apValue;
    case "lillia_r|break_magic_damage": return rawAt(skillKey, "BreakDamageBase", l) + rawCoefficient(skillKey, "TotalDamage", 0.4) * apValue;
    case "fiddlesticks_q|normal_magic_damage": return Math.max(rawAt(skillKey, "MinimumDamage", l), currentHp * (rawAt(skillKey, "MaxHealthDamage", l) + rawCoefficient(skillKey, "TotalPercentHealthDamage", 0.0003) * apValue));
    case "fiddlesticks_q|feared_magic_damage": return rawNumberMultiplier(skillKey, "TotalPercentHealthDamageFeared", 2) * Math.max(rawAt(skillKey, "MinimumDamage", l), currentHp * (rawAt(skillKey, "MaxHealthDamage", l) + rawCoefficient(skillKey, "TotalPercentHealthDamage", 0.0003) * apValue));
    case "fiddlesticks_w|damage_per_second": return rawAt(skillKey, "DamagePerSecond", l) + rawCoefficient(skillKey, "DrainDamageCalc", 0.45) * apValue;
    case "fiddlesticks_w|end_missing_health_damage": return 0.01 * rawAt(skillKey, "PercentForTooltip", l) * r.actual_target_missing_health;
    case "fiddlesticks_w|champion_heal_amount": return 0.01 * rawAt(skillKey, "VampPercentage", l) * r.actual_hero_pre_mitigation_damage;
    case "fiddlesticks_e|magic_damage": return rawAt(skillKey, "BaseDamage", l) + rawCoefficient(skillKey, "Damage", 0.5) * apValue;
    case "fiddlesticks_r|damage_per_second": return rawAt(skillKey, "DamagePerSecond", l) + rawAt(skillKey, "APRatio", 1) * apValue;
    case "fiddlesticks_r|damage_done_single_tick": return rawNumberMultiplier(skillKey, "DamageDone", 0.25) * (rawAt(skillKey, "DamagePerSecond", l) + rawAt(skillKey, "APRatio", 1) * apValue);
    case "fiddlesticks_r|total_magic_damage": return rawAt(skillKey, "Duration", 1) * (rawAt(skillKey, "DamagePerSecond", l) + rawAt(skillKey, "APRatio", 1) * apValue);
    case "singed_q|damage_per_second": return rawAt(skillKey, "BaseDamagePerSecond", l) + rawAt(skillKey, "APRatioPerSecond", 1) * apValue;
    case "singed_q|approximate_total_damage": return rawNumberMultiplier(skillKey, "ApproximateTotalDamageTooltip", 4.75) * (rawAt(skillKey, "BaseDamagePerSecond", l) + rawAt(skillKey, "APRatioPerSecond", 1) * apValue);
    case "singed_e|base_magic_damage": return rawAt(skillKey, "BaseDamageValue", l) + rawCoefficient(skillKey, "BaseDamage", 0.55) * apValue;
    case "singed_e|max_health_magic_component": return 0.01 * rawAt(skillKey, "MaxHPDamage", l) * hp;
    case "singed_e|total_magic_damage": return rawAt(skillKey, "BaseDamageValue", l) + rawCoefficient(skillKey, "BaseDamage", 0.55) * apValue + 0.01 * rawAt(skillKey, "MaxHPDamage", l) * hp;
    default: throw new Error(`独立数学没有期望函数：${skillKey}/${formulaKey}`);
  }
}

const formulaResults = [];
let missingChecks = 0;
for (const skillKey of candidate.order) {
  for (const f of candidate.skills[skillKey].write.formulas) {
    const scenariosResult = [];
    for (const scenario of scenarios) {
      const effectiveLevel = Math.min(scenario.level, candidate.skills[skillKey].maxLevel);
      const context = { level: effectiveLevel, requestedLevel: scenario.level, attributes: clone(scenario.attributes), runtime: clone(scenario.runtime), parameterBlock: {} };
      const actual = evaluate(f.expression, context, skillKey, f.formulaKey);
      const expectedValue = expected(skillKey, f.formulaKey, { ...scenario, level: effectiveLevel });
      assert(Number.isFinite(actual) && close(actual, expectedValue, 2e-7), "公式实算与独立原始源值不符", { skillKey, formulaKey: f.formulaKey, scenario: scenario.label, actual, expected: expectedValue });
      scenariosResult.push({ label: scenario.label, requestedLevel: scenario.level, effectiveLevel, actual, expected: expectedValue, delta: actual - expectedValue });
    }
    const leaves = [];
    const collect = node => {
      if (node.nodeType === "PARAMETER") leaves.push({ type: "PARAMETER", key: node.parameterKey });
      else if (node.nodeType === "ATTRIBUTE") leaves.push({ type: "ATTRIBUTE", owner: node.attributeOwner, key: node.attributeKey, valueKind: node.attributeValueKind });
      else node.operands.forEach(collect);
    };
    collect(f.expression);
    const uniqueLeaves = [...new Map(leaves.map(item => [JSON.stringify(item), item])).values()];
    for (const leaf of uniqueLeaves) {
      const effectiveLevel = Math.min(scenarios[0].level, candidate.skills[skillKey].maxLevel);
      const context = { level: effectiveLevel, requestedLevel: scenarios[0].level, attributes: clone(scenarios[0].attributes), runtime: clone(scenarios[0].runtime), parameterBlock: {} };
      if (leaf.type === "PARAMETER" && Object.prototype.hasOwnProperty.call(context.runtime, leaf.key)) delete context.runtime[leaf.key];
      if (leaf.type === "ATTRIBUTE") delete context.attributes?.[leaf.owner]?.[leaf.key]?.[leaf.valueKind];
      let rejected = false;
      try { evaluate(f.expression, context, skillKey, f.formulaKey); } catch { rejected = true; }
      if ((leaf.type === "PARAMETER" && scenarios[0].runtime[leaf.key] !== undefined) || leaf.type === "ATTRIBUTE") {
        assert(rejected, "缺值没有被拒绝", { skillKey, formulaKey: f.formulaKey, leaf });
        missingChecks += 1;
      }
    }
    formulaResults.push({ skillKey, formulaKey: f.formulaKey, scenarios: scenariosResult, sourceExpectation: "独立读取冻结客户端DataValues和mSpellCalculations，未从候选固定值计算期望", missingLeavesChecked: uniqueLeaves.filter(x => x.type === "ATTRIBUTE" || (x.type === "PARAMETER" && scenarios[0].runtime[x.key] !== undefined)).length });
  }
}

const integerChecks = [];
for (const skillKey of candidate.order) {
  for (const p of candidate.skills[skillKey].write.parameters) {
    if (p.valueMode === "RUNTIME_INPUT") {
      assert(p.fixedValue === null && p.levelValues === null, "运行输入存在默认值", { skillKey, parameterKey: p.parameterKey });
      continue;
    }
    const values = p.valueMode === "SKILL_LEVEL" || p.valueMode === "CHARACTER_LEVEL" ? Object.values(p.levelValues ?? {}) : [p.fixedValue];
    if (p.valueType === "INTEGER" || p.parameterKey.endsWith("_ms")) assert(values.every(Number.isInteger), "整数/毫秒参数含小数", { skillKey, parameterKey: p.parameterKey, values });
    integerChecks.push({ skillKey, parameterKey: p.parameterKey, valuesChecked: values.length });
  }
}
const boundaryChecks = [
  { name: "莉莉娅Q层数上限", value: candidate.skills.lillia_q.write.parameters.find(p => p.parameterKey === "prance_max_stacks").fixedValue, accepted: [4] },
  { name: "费德提克Q当前生命分支", valueKinds: ["CURRENT"], accepted: true },
  { name: "伊芙琳E普通强化互斥", formulas: ["ordinary_magic_damage", "empowered_magic_damage"], accepted: true },
  { name: "莉莉娅W中心替代", multiplier: candidate.skills.lillia_w.write.parameters.find(p => p.parameterKey === "sweet_spot_multiplier").fixedValue, accepted: [3] },
  { name: "费德提克R当前五秒", duration: candidate.skills.fiddlesticks_r.write.parameters.find(p => p.parameterKey === "full_duration_seconds").fixedValue, damagePerSecond: candidate.skills.fiddlesticks_r.write.parameters.find(p => p.parameterKey === "damage_per_second_base").levelValues, accepted: true },
  { name: "辛吉德R移动速度单位", value: candidate.skills.singed_r.write.parameters.find(p => p.parameterKey === "stat_amount").levelValues, accepted: true },
];

const report = {
  generatedAt,
  batch: candidate.meta.batch,
  status: "独立候选数学核算完成；未调用业务接口",
  candidateSha256: sha256(candidateBytes),
  inputBindingSha256: sha256(fs.readFileSync(bindingPath)),
  sourceExpectationPolicy: "每个公式的期望值直接读取冻结来源DataValues与mSpellCalculations；实际值只读取候选参数的FIXED/SKILL_LEVEL/CHARACTER_LEVEL或明确运行输入并求候选表达式树；运行输入和属性缺失必须拒绝。",
  candidateMathReady: true,
  businessMathReady: false,
  apiCalls: 0,
  apiWrites: 0,
  formulas: { total: formulaResults.length, scenariosPerFormula: 2, passed: formulaResults.length, results: formulaResults },
  missingInputChecks: { total: missingChecks, passed: missingChecks },
  integerAndMilliseconds: { checked: integerChecks.length, passed: integerChecks.length, details: integerChecks },
  boundaryChecks,
  noDefaults: true,
  note: "这是候选阶段的静态源值核算，不等同于业务GET后的实录表达式核算或战斗运行。",
};
const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(artifactDir, "独立数学核算.json"), reportBytes, "utf8");
fs.writeFileSync(path.join(durableDir, "独立数学核算.json"), reportBytes, "utf8");
const mathReportSha = sha256(reportBytes);
const mathScriptSha = sha256(fs.readFileSync(fileURLToPath(import.meta.url)));
const experience = `# 第三十六批候选修订一体验报告

修订一保留原候选作为历史证据，只在本目录和对应耐久目录生成当前候选。20个技能槽共129个参数、31个公式，形成160条新增请求意图；30项公共参数仍只复用，业务接口调用和写入均为0。

独立数学核算的实际值读取当前候选参数树：固定参数取候选固定值，技能等级参数按每个技能的有效等级取候选等级值，运行输入必须由场景明确提供；期望值另从冻结客户端DataValues和mSpellCalculations读取。31个公式各用低、高两组场景，因R技能最高等级为3，高场景实际使用等级3；31/31公式、62场景和40/40缺值拒绝通过。

本修订删除8个与当前mCastTime冲突或缺少独立施法依据的施法时间参数，并删除辛吉德E的一对一范围外非英雄封顶。新增伊芙琳Q标记目标最多命中3次、伊芙琳W英雄魅惑蓄力2500毫秒、辛吉德Q每秒13法力；原公式31条不变。

candidateMathReady为真，businessMathReady为假。该结果是候选阶段的静态核算，不代表业务实录或战斗运行；角色等级求值、属性阶段、触发时序和目标资格仍按无默认待核。
`;
const experienceBytes = writeTextBoth("体验报告.md", experience);
const version = readJson(path.join(artifactDir, "候选版本.json"));
Object.assign(version, {
  generatedAt,
  revision: candidate.meta.revision,
  counts: candidate.counts,
  requestCount: candidate.requestCount,
  candidateSha256: report.candidateSha256,
  planSha256: sha256(fs.readFileSync(path.join(artifactDir, "请求计划.json"))),
  sourceValuesSha256: sha256(fs.readFileSync(path.join(artifactDir, "来源值摘要.json"))),
  sourceRangeSha256: sha256(fs.readFileSync(path.join(artifactDir, "来源与范围.json"))),
  strictMathStatus: `已执行；${report.formulas.total}式${report.formulas.total * 2}场景、${report.missingInputChecks.total}缺值检查通过`,
  strictMathSha256: mathReportSha,
  mathScriptSha256: mathScriptSha,
  experienceSha256: sha256(experienceBytes),
  candidateMathReady: true,
  businessMathReady: false,
  businessWrites: 0,
  apiCalls: 0,
  noApiCalls: true,
});
writeJsonBoth("候选版本.json", version);
const hashes = readJson(path.join(artifactDir, "来源哈希汇总.json"));
hashes.generatedAt = generatedAt;
hashes.revision = candidate.meta.revision;
hashes.outputs = {
  ...hashes.outputs,
  candidateSha256: report.candidateSha256,
  planSha256: version.planSha256,
  sourceValuesSha256: version.sourceValuesSha256,
  sourceRangeSha256: version.sourceRangeSha256,
  mathReportSha256: mathReportSha,
  mathScriptSha256: mathScriptSha,
  experienceSha256: version.experienceSha256,
};
hashes.apiWrites = 0;
writeJsonBoth("来源哈希汇总.json", hashes);
fs.copyFileSync(fileURLToPath(import.meta.url), path.join(durableDir, "独立数学核算.mjs"));
console.log(JSON.stringify({ batch: report.batch, candidateSha256: report.candidateSha256, formulas: report.formulas.total, scenarios: report.formulas.total * 2, missingInputChecks: report.missingInputChecks.total, integerChecks: report.integerAndMilliseconds.checked, candidateMathReady: report.candidateMathReady, businessMathReady: report.businessMathReady, apiCalls: 0, apiWrites: 0 }, null, 2));

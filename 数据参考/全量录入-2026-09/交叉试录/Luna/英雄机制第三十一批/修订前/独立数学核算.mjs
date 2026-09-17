import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repo = "C:/project/damage_web_dev";
const inputDir = path.join(repo, ".agents/artifacts/hero31-root-entry-20260909");
const candidatePath = path.join(artifactDir, "完整候选.json");
const sourcePath = path.join(inputDir, "来源绑定与当前文本.json");
const outputPath = path.join(artifactDir, "独立数学核算.json");

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256File = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const close = (a, b, tolerance = 1e-6) => Number.isFinite(Number(a)) && Number.isFinite(Number(b))
  && Math.abs(Number(a) - Number(b)) <= tolerance * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));
const assert = (condition, message, detail = undefined) => {
  if (!condition) throw new Error(message + (detail === undefined ? "" : `：${JSON.stringify(detail)}`));
};
const candidate = readJson(candidatePath);
const source = readJson(sourcePath);

assert(candidate.meta?.businessWrites === 0 && candidate.meta?.apiCalls === 0, "候选不是零业务写入材料");
assert(candidate.meta?.sourceVersion?.clientVersion === "16.17" && candidate.meta?.sourceVersion?.officialVersion === "16.17.1", "候选来源版本不符");
assert(candidate.skills && Object.keys(candidate.skills).length === 20, "候选技能槽数量不符");

const sourceChecks = new Map();
const sourceSkill = skillKey => {
  const heroKey = `champion_${skillKey.split("_")[0]}`;
  const hero = source.heroes?.find(item => item.key === heroKey);
  const skill = hero?.skills?.find(item => item.skillKey === skillKey);
  assert(skill, "来源技能缺失", skillKey);
  return skill;
};
const spell = skillKey => sourceSkill(skillKey).object.mSpell;
const dataRow = (skillKey, dataName) => {
  const row = spell(skillKey).DataValues?.find(item => item.name === dataName);
  assert(row && Array.isArray(row.values), "来源DataValues缺失", { skillKey, dataName });
  return row.values;
};
const dataAt = (skillKey, dataName, index) => {
  const value = dataRow(skillKey, dataName)[index];
  assert(typeof value === "number" && Number.isFinite(value), "来源DataValues索引无值", { skillKey, dataName, index, value });
  return value;
};
const calculation = (skillKey, calculationName) => {
  const value = spell(skillKey).mSpellCalculations?.[calculationName];
  assert(value, "来源计算树缺失", { skillKey, calculationName });
  return value;
};
const walk = (value, visitor) => {
  if (!value || typeof value !== "object") return;
  visitor(value);
  if (Array.isArray(value)) value.forEach(item => walk(item, visitor));
  else Object.values(value).forEach(item => walk(item, visitor));
};
const sourceDataRef = (skillKey, calculationName, dataName) => {
  let found = false;
  walk(calculation(skillKey, calculationName), node => { if (node.mDataValue === dataName) found = true; });
  assert(found, "来源计算树没有指定DataValue", { skillKey, calculationName, dataName });
  sourceChecks.set(`data:${skillKey}/${calculationName}/${dataName}`, { kind: "DataValue", skillKey, calculationName, dataName });
  return dataRow(skillKey, dataName);
};
const sourceTreeRef = (skillKey, calculationName, treeDataName) => {
  let found = false;
  walk(calculation(skillKey, calculationName), node => { if (node.mDataValue === treeDataName) found = true; });
  assert(found, "来源计算树没有指定DataValue字段", { skillKey, calculationName, treeDataName });
  sourceChecks.set(`treeData:${skillKey}/${calculationName}/${treeDataName}`, { kind: "TreeDataValue", skillKey, calculationName, treeDataName });
  return true;
};
const sourceCoefficient = (skillKey, calculationName, expected) => {
  const values = [];
  walk(calculation(skillKey, calculationName), node => { if (typeof node.mCoefficient === "number") values.push(node.mCoefficient); });
  assert(values.some(value => close(value, expected)), "来源计算树系数不符", { skillKey, calculationName, values, expected });
  sourceChecks.set(`coefficient:${skillKey}/${calculationName}/${expected}`, { kind: "Coefficient", skillKey, calculationName, expected, actual: values });
  return expected;
};
const sourceMultiplier = (skillKey, calculationName, expected) => {
  const value = calculation(skillKey, calculationName).mMultiplier?.mNumber;
  assert(typeof value === "number" && close(value, expected), "来源根乘数不符", { skillKey, calculationName, value, expected });
  sourceChecks.set(`multiplier:${skillKey}/${calculationName}/${expected}`, { kind: "Multiplier", skillKey, calculationName, expected, actual: value });
  return expected;
};
const sourceMultiplierData = (skillKey, calculationName, dataName) => {
  const value = calculation(skillKey, calculationName).mMultiplier?.mDataValue;
  assert(value === dataName, "来源修正式乘数DataValue不符", { skillKey, calculationName, value, dataName });
  sourceChecks.set(`multiplierData:${skillKey}/${calculationName}/${dataName}`, { kind: "MultiplierDataValue", skillKey, calculationName, dataName });
  return true;
};
const sourceStat = (skillKey, calculationName, stat, statFormula) => {
  let found = false;
  walk(calculation(skillKey, calculationName), node => {
    if (node.mStat === stat && node.mStatFormula === statFormula) found = true;
  });
  assert(found, "来源属性选择器不符", { skillKey, calculationName, stat, statFormula });
  sourceChecks.set(`stat:${skillKey}/${calculationName}/${stat}/${statFormula}`, { kind: "StatSelector", skillKey, calculationName, stat, statFormula });
  return true;
};
const sourceModified = (skillKey, calculationName, modifiedName) => {
  const value = calculation(skillKey, calculationName).mModifiedGameCalculation;
  assert(value === modifiedName, "来源修改计算树不符", { skillKey, calculationName, value, modifiedName });
  sourceChecks.set(`modified:${skillKey}/${calculationName}/${modifiedName}`, { kind: "ModifiedCalculation", skillKey, calculationName, modifiedName });
  return true;
};
const sourceInterpolation = (skillKey, calculationName, start, end) => {
  let found = false;
  walk(calculation(skillKey, calculationName), node => {
    if (node.__type === "ByCharLevelInterpolationCalculationPart" && close(node.mStartValue, start) && close(node.mEndValue, end)) found = true;
  });
  assert(found, "来源角色等级插值端点不符", { skillKey, calculationName, start, end });
  sourceChecks.set(`interpolation:${skillKey}/${calculationName}`, { kind: "ByCharLevelInterpolation", skillKey, calculationName, start, end });
  return true;
};

const parameter = (skill, parameterKey, input) => {
  const item = skill.write.parameters.find(value => value.parameterKey === parameterKey);
  assert(item, "候选参数未定义", { skillKey: skill.skillKey, parameterKey });
  let value;
  if (item.valueMode === "FIXED") value = item.fixedValue;
  else if (item.valueMode === "SKILL_LEVEL") {
    assert(Number.isInteger(input.rank) && input.rank >= 1 && input.rank <= skill.maxLevel, "技能等级输入越界", { skillKey: skill.skillKey, rank: input.rank, maxLevel: skill.maxLevel });
    value = item.levelValues?.[String(input.rank)];
  } else if (item.valueMode === "RUNTIME_INPUT") value = input.runtime?.[parameterKey];
  else throw new Error(`未知参数模式：${item.valueMode}`);
  assert(typeof value === "number" && Number.isFinite(value), "运行输入缺值", { skillKey: skill.skillKey, parameterKey });
  if (item.valueType === "INTEGER") assert(Number.isInteger(value), "整数参数收到小数", { skillKey: skill.skillKey, parameterKey, value });
  return value;
};
const evaluate = (node, skill, input) => {
  assert(node && typeof node === "object", "公式节点不是对象");
  if (node.nodeType === "PARAMETER") return parameter(skill, node.parameterKey, input);
  if (node.nodeType === "ATTRIBUTE") {
    assert(node.attributeOwner === "SOURCE" || node.attributeOwner === "TARGET", "属性所有者不合法", node);
    const key = [node.attributeOwner, node.attributeKey, node.attributeValueKind].join(".");
    const value = input.attributes?.[key];
    assert(typeof value === "number" && Number.isFinite(value), "属性输入缺值", key);
    return value;
  }
  assert(node.nodeType === "OPERATION" && Array.isArray(node.operands) && node.operands.length === 2, "公式操作数必须严格为2", node);
  const [left, right] = node.operands.map(child => evaluate(child, skill, input));
  switch (node.operation) {
    case "ADD": return left + right;
    case "SUBTRACT": return left - right;
    case "MULTIPLY": return left * right;
    case "DIVIDE": assert(right !== 0, "公式除数为零"); return left / right;
    case "MIN": return Math.min(left, right);
    case "MAX": return Math.max(left, right);
    default: throw new Error(`未知公式操作：${node.operation}`);
  }
};
const collectExternalInputs = (node, skill, result = new Set()) => {
  if (node.nodeType === "ATTRIBUTE") result.add(`A|${[node.attributeOwner, node.attributeKey, node.attributeValueKind].join(".")}`);
  if (node.nodeType === "PARAMETER") {
    const item = skill.write.parameters.find(value => value.parameterKey === node.parameterKey);
    assert(item, "公式参数未定义", { skillKey: skill.skillKey, parameterKey: node.parameterKey });
    if (item.valueMode === "RUNTIME_INPUT") result.add(`P|${node.parameterKey}`);
  }
  for (const child of node.operands ?? []) collectExternalInputs(child, skill, result);
  return result;
};
const inputFor = (skill, high) => ({
  rank: high ? skill.maxLevel : 1,
  attributes: {
    "SOURCE.ability_power.TOTAL": high ? 320 : 120,
    "SOURCE.move_speed_percent.BONUS": high ? 0.18 : 0.05,
  },
  runtime: { actual_character_level_base_damage: high ? 39 : 5 },
});
const rankValue = (skillKey, dataName, rank, offset = 0) => dataAt(skillKey, dataName, offset + rank - 1);
const apOf = input => input.attributes["SOURCE.ability_power.TOTAL"];
const moveOf = input => input.attributes["SOURCE.move_speed_percent.BONUS"];

function expected(key, input) {
  const [skillKey, formulaKey] = key.split("/");
  const rank = input.rank;
  const ap = apOf(input);
  const move = moveOf(input);
  switch (key) {
    case "janna_p/bonus_magic_damage": {
      sourceDataRef("janna_p", "BonusDamage", "MSBonusMagicDamage");
      sourceStat("janna_p", "BonusDamage", 7, 2);
      return dataAt("janna_p", "MSBonusMagicDamage", 0) * move;
    }
    case "janna_q/minimum_magic_damage": {
      sourceDataRef("janna_q", "MinimumDamage", "MinDamage");
      sourceDataRef("janna_q", "MinimumDamage", "MinimumRatio");
      return rankValue("janna_q", "MinDamage", rank) + dataAt("janna_q", "MinimumRatio", 0) * ap;
    }
    case "janna_q/charged_magic_damage_per_second": {
      sourceDataRef("janna_q", "ExtraDamagePerSecondCharged", "BonusDamage");
      sourceDataRef("janna_q", "ExtraDamagePerSecondCharged", "BonusRatio");
      return rankValue("janna_q", "BonusDamage", rank) + dataAt("janna_q", "BonusRatio", 0) * ap;
    }
    case "janna_q/maximum_magic_damage": {
      sourceDataRef("janna_q", "MaxDamage", "MinDamage");
      sourceDataRef("janna_q", "MaxDamage", "MinimumRatio");
      sourceDataRef("janna_q", "MaxDamage", "MaxDuration");
      sourceDataRef("janna_q", "MaxDamage", "BonusDamage");
      sourceDataRef("janna_q", "MaxDamage", "BonusRatio");
      const minimum = rankValue("janna_q", "MinDamage", rank) + dataAt("janna_q", "MinimumRatio", 0) * ap;
      const charged = rankValue("janna_q", "BonusDamage", rank) + dataAt("janna_q", "BonusRatio", 0) * ap;
      return minimum + rankValue("janna_q", "MaxDuration", rank) * charged;
    }
    case "janna_q/maximum_knockup_seconds": {
      sourceDataRef("janna_q", "MaxKnockup", "BaseKnockup");
      sourceDataRef("janna_q", "MaxKnockup", "MaxDuration");
      sourceDataRef("janna_q", "MaxKnockup", "ChargeKnockup");
      return rankValue("janna_q", "BaseKnockup", rank) + rankValue("janna_q", "MaxDuration", rank) * rankValue("janna_q", "ChargeKnockup", rank);
    }
    case "janna_w/total_move_speed_ratio": {
      sourceDataRef("janna_w", "TotalMS", "MSPercent");
      sourceDataRef("janna_w", "TotalMS", "MSAPRatio");
      return rankValue("janna_w", "MSPercent", rank) + dataAt("janna_w", "MSAPRatio", 0) * ap;
    }
    case "janna_w/total_magic_damage": {
      sourceDataRef("janna_w", "TotalDamage", "BaseDamage");
      sourceDataRef("janna_w", "TotalDamage", "APRatio");
      sourceDataRef("janna_p", "BonusDamage", "MSBonusMagicDamage");
      sourceStat("janna_p", "BonusDamage", 7, 2);
      return rankValue("janna_w", "BaseDamage", rank) + dataAt("janna_w", "APRatio", 0) * ap + dataAt("janna_p", "MSBonusMagicDamage", 0) * move;
    }
    case "janna_w/total_slow_ratio": {
      sourceMultiplier("janna_w", "TotalSlow", 0.01);
      sourceDataRef("janna_w", "TotalSlow", "SlowPercent");
      sourceDataRef("janna_w", "TotalSlow", "SlowAPRatio");
      return 0.01 * (rankValue("janna_w", "SlowPercent", rank) + dataAt("janna_w", "SlowAPRatio", 0) * ap);
    }
    case "janna_e/total_shield": {
      sourceDataRef("janna_e", "TotalShield", "BaseShield");
      sourceDataRef("janna_e", "TotalShield", "ShieldAPRatio");
      return rankValue("janna_e", "BaseShield", rank) + dataAt("janna_e", "ShieldAPRatio", 0) * ap;
    }
    case "janna_e/total_attack_damage_bonus": {
      sourceDataRef("janna_e", "TotalAD", "BonusAD");
      sourceDataRef("janna_e", "TotalAD", "ADAPRatio");
      return rankValue("janna_e", "BonusAD", rank) + dataAt("janna_e", "ADAPRatio", 0) * ap;
    }
    case "janna_r/heal_per_second": {
      sourceDataRef("janna_r", "HealPerSecond", "HealBasePerSecond");
      sourceCoefficient("janna_r", "HealPerSecond", 0.5);
      return rankValue("janna_r", "HealBasePerSecond", rank) + 0.5 * ap;
    }
    case "janna_r/total_heal": {
      sourceMultiplierData("janna_r", "TotalHeal", "Duration");
      sourceModified("janna_r", "TotalHeal", "HealPerSecond");
      const perSecond = rankValue("janna_r", "HealBasePerSecond", rank) + 0.5 * ap;
      return rankValue("janna_r", "Duration", rank, 1) * perSecond;
    }
    case "lulu_p/single_bolt_magic_damage": {
      sourceInterpolation("lulu_p", "TotalDamage", 5, 39);
      sourceDataRef("lulu_p", "TotalDamage", "APRatioPerHit");
      return input.runtime.actual_character_level_base_damage + dataAt("lulu_p", "APRatioPerHit", 0) * ap;
    }
    case "lulu_p/combined_magic_damage": {
      sourceMultiplierData("lulu_p", "CombinedDamage", "NumberOfBolts");
      sourceInterpolation("lulu_p", "TotalDamage", 5, 39);
      sourceDataRef("lulu_p", "TotalDamage", "APRatioPerHit");
      return dataAt("lulu_p", "NumberOfBolts", 0) * (input.runtime.actual_character_level_base_damage + dataAt("lulu_p", "APRatioPerHit", 0) * ap);
    }
    case "lulu_q/magic_damage": {
      sourceDataRef("lulu_q", "TotalDamage", "BaseDamage");
      sourceDataRef("lulu_q", "TotalDamage", "APRatio");
      return rankValue("lulu_q", "BaseDamage", rank, 1) + dataAt("lulu_q", "APRatio", 0) * ap;
    }
    case "lulu_q/second_bolt_bonus_magic_damage": {
      sourceMultiplierData("lulu_q", "BonusMissileDamage", "DoubleHitBonus");
      sourceDataRef("lulu_q", "BonusMissileDamage", "BaseDamage");
      sourceDataRef("lulu_q", "BonusMissileDamage", "APRatio");
      return dataAt("lulu_q", "DoubleHitBonus", 0) * (rankValue("lulu_q", "BaseDamage", rank, 1) + dataAt("lulu_q", "APRatio", 0) * ap);
    }
    case "lulu_w/ally_move_speed_ratio": {
      sourceDataRef("lulu_w", "TotalMS", "BaseMS");
      sourceCoefficient("lulu_w", "TotalMS", 0.0005);
      return dataAt("lulu_w", "BaseMS", 0) + 0.0005 * ap;
    }
    case "lulu_e/magic_damage": {
      sourceDataRef("lulu_e", "TotalDamage", "BaseDamage");
      sourceDataRef("lulu_e", "TotalDamage", "DamageAPRatio");
      return rankValue("lulu_e", "BaseDamage", rank) + dataAt("lulu_e", "DamageAPRatio", 0) * ap;
    }
    case "lulu_e/shield_value": {
      sourceDataRef("lulu_e", "TotalShield", "BaseShield");
      sourceDataRef("lulu_e", "TotalShield", "ShieldAPRatio");
      return rankValue("lulu_e", "BaseShield", rank) + dataAt("lulu_e", "ShieldAPRatio", 0) * ap;
    }
    case "lulu_r/bonus_health_value": {
      sourceDataRef("lulu_r", "TotalBonusHealth", "BonusHealth");
      sourceCoefficient("lulu_r", "TotalBonusHealth", 0.55);
      return rankValue("lulu_r", "BonusHealth", rank) + 0.55 * ap;
    }
    case "nami_p/movement_speed_bonus": {
      sourceDataRef("nami_p", "TotalMSBonus", "FlatMS");
      sourceCoefficient("nami_p", "TotalMSBonus", 0.25);
      return dataAt("nami_p", "FlatMS", 0) + 0.25 * ap;
    }
    case "nami_q/magic_damage": {
      sourceDataRef("nami_q", "TotalDamageTT", "BaseDamage");
      sourceDataRef("nami_q", "TotalDamageTT", "APRatio");
      return rankValue("nami_q", "BaseDamage", rank, 1) + dataAt("nami_q", "APRatio", 0) * ap;
    }
    case "nami_w/first_damage": {
      sourceDataRef("nami_w", "TotalDamage", "BaseDamage");
      sourceDataRef("nami_w", "TotalDamage", "DamageAPRatio");
      return rankValue("nami_w", "BaseDamage", rank, 1) + dataAt("nami_w", "DamageAPRatio", 0) * ap;
    }
    case "nami_w/first_heal": {
      sourceDataRef("nami_w", "TotalHeal", "BaseHeal");
      sourceDataRef("nami_w", "TotalHeal", "HealAPRatio");
      return rankValue("nami_w", "BaseHeal", rank, 1) + dataAt("nami_w", "HealAPRatio", 0) * ap;
    }
    case "nami_w/bounce_scaling_ratio": {
      sourceMultiplier("nami_w", "BounceScaling", 0.01);
      sourceDataRef("nami_w", "BounceScaling", "BounceRatio");
      sourceDataRef("nami_w", "BounceScaling", "BounceRatioScaling");
      return 0.01 * (dataAt("nami_w", "BounceRatio", 0) + dataAt("nami_w", "BounceRatioScaling", 0) * ap);
    }
    case "nami_w/bounced_damage": {
      sourceDataRef("nami_w", "TotalDamage", "BaseDamage");
      sourceDataRef("nami_w", "TotalDamage", "DamageAPRatio");
      sourceMultiplier("nami_w", "BounceScaling", 0.01);
      sourceDataRef("nami_w", "BounceScaling", "BounceRatio");
      sourceDataRef("nami_w", "BounceScaling", "BounceRatioScaling");
      const first = rankValue("nami_w", "BaseDamage", rank, 1) + dataAt("nami_w", "DamageAPRatio", 0) * ap;
      const scale = 0.01 * (dataAt("nami_w", "BounceRatio", 0) + dataAt("nami_w", "BounceRatioScaling", 0) * ap);
      return first * (1 + scale);
    }
    case "nami_w/bounced_heal": {
      sourceDataRef("nami_w", "TotalHeal", "BaseHeal");
      sourceDataRef("nami_w", "TotalHeal", "HealAPRatio");
      sourceMultiplier("nami_w", "BounceScaling", 0.01);
      sourceDataRef("nami_w", "BounceScaling", "BounceRatio");
      sourceDataRef("nami_w", "BounceScaling", "BounceRatioScaling");
      const first = rankValue("nami_w", "BaseHeal", rank, 1) + dataAt("nami_w", "HealAPRatio", 0) * ap;
      const scale = 0.01 * (dataAt("nami_w", "BounceRatio", 0) + dataAt("nami_w", "BounceRatioScaling", 0) * ap);
      return first * (1 + scale);
    }
    case "nami_e/bonus_magic_damage_per_hit": {
      sourceDataRef("nami_e", "TotalDamage", "BaseDamage");
      sourceDataRef("nami_e", "TotalDamage", "DamageRatio");
      return rankValue("nami_e", "BaseDamage", rank, 1) + dataAt("nami_e", "DamageRatio", 0) * ap;
    }
    case "nami_e/slow_ratio": {
      sourceMultiplier("nami_e", "TotalSlow", 0.01);
      sourceDataRef("nami_e", "TotalSlow", "BaseSlow");
      sourceDataRef("nami_e", "TotalSlow", "SlowRatio");
      return 0.01 * (rankValue("nami_e", "BaseSlow", rank, 1) + dataAt("nami_e", "SlowRatio", 0) * ap);
    }
    case "nami_r/magic_damage": {
      sourceDataRef("nami_r", "TotalDamage", "BaseDamage");
      sourceCoefficient("nami_r", "TotalDamage", 0.6);
      return rankValue("nami_r", "BaseDamage", rank, 1) + 0.6 * ap;
    }
    case "morgana_q/magic_damage": {
      sourceDataRef("morgana_q", "TotalDamage", "Damage");
      sourceCoefficient("morgana_q", "TotalDamage", 0.9);
      return rankValue("morgana_q", "Damage", rank, 1) + 0.9 * ap;
    }
    case "morgana_w/minimum_magic_damage_per_second": {
      sourceDataRef("morgana_w", "TotalMinDamage", "BaseDamage");
      sourceTreeRef("morgana_w", "TotalMinDamage", "BaseApRatio");
      return rankValue("morgana_w", "BaseDamage", rank, 1) + dataAt("morgana_w", "BaseAPRatio", 0) * ap;
    }
    case "morgana_w/maximum_magic_damage_per_second": {
      sourceModified("morgana_w", "TotalMaxDamage", "TotalMinDamage");
      sourceDataRef("morgana_w", "TotalMaxDamage", "MissingHealthAmpPercent");
      const minimum = rankValue("morgana_w", "BaseDamage", rank, 1) + dataAt("morgana_w", "BaseAPRatio", 0) * ap;
      return minimum * (1 + dataAt("morgana_w", "MissingHealthAmpPercent", 0));
    }
    case "morgana_e/magic_shield_value": {
      sourceDataRef("morgana_e", "TotalShieldStrength", "ShieldStrength");
      sourceCoefficient("morgana_e", "TotalShieldStrength", 0.7);
      return rankValue("morgana_e", "ShieldStrength", rank, 1) + 0.7 * ap;
    }
    case "morgana_r/magic_damage": {
      sourceDataRef("morgana_r", "TotalDamage", "Damage");
      sourceCoefficient("morgana_r", "TotalDamage", 0.8);
      return rankValue("morgana_r", "Damage", rank, 1) + 0.8 * ap;
    }
    default: throw new Error(`未覆盖的公式：${key}`);
  }
}

const formulaCases = [];
const missingValueRejections = [];
const integerChecks = [];
const rangeChecks = [];
const formulaKeys = [];
for (const [skillKey, skill] of Object.entries(candidate.skills)) {
  for (const item of skill.write.parameters) {
    const values = item.valueMode === "FIXED"
      ? [item.fixedValue]
      : item.valueMode === "SKILL_LEVEL" ? Object.values(item.levelValues ?? {}) : [];
    if (item.valueType === "INTEGER" || item.parameterKey.endsWith("_ms")) {
      assert(item.valueType === "INTEGER", "毫秒参数类型不是INTEGER", { skillKey, parameterKey: item.parameterKey });
      assert(values.every(value => Number.isInteger(value)), "整数参数含小数", { skillKey, parameterKey: item.parameterKey, values });
      integerChecks.push({ skillKey, parameterKey: item.parameterKey, values, passed: true });
    }
    if (item.valueMode === "RUNTIME_INPUT") assert(item.fixedValue === null && item.levelValues === null, "运行输入带默认值", { skillKey, parameterKey: item.parameterKey });
  }
  for (const item of skill.write.formulas) {
    const key = `${skillKey}/${item.formulaKey}`;
    formulaKeys.push(key);
    for (const high of [false, true]) {
      const input = inputFor(skill, high);
      const actual = evaluate(item.expression, skill, input);
      const expectedValue = expected(key, input);
      assert(close(actual, expectedValue), "候选公式与独立来源期望不符", { key, actual, expected: expectedValue, input });
      formulaCases.push({ key, scenario: high ? "高端" : "低端", rank: input.rank, abilityPower: apOf(input), bonusMoveSpeed: moveOf(input), runtime: input.runtime, actual, expected: expectedValue, passed: true });
    }
    const refs = collectExternalInputs(item.expression, skill);
    for (const ref of refs) {
      const input = inputFor(skill, false);
      const [kind, keyPart] = ref.split("|");
      if (kind === "A") delete input.attributes[keyPart];
      else delete input.runtime[keyPart];
      let rejected = false;
      try { evaluate(item.expression, skill, input); } catch { rejected = true; }
      assert(rejected, "缺失外部输入未被拒绝", { key, ref });
      missingValueRejections.push({ key, missing: ref, rejected: true });
    }
  }
}

assert(formulaKeys.length === 35, "公式总数不符", formulaKeys.length);
assert(formulaCases.length === 70, "公式双场景数量不符", formulaCases.length);
assert(missingValueRejections.length > 0, "没有执行缺值拒绝检查");

const jannaQ = candidate.skills.janna_q;
for (const badRank of [0, 1.5, jannaQ.maxLevel + 1]) {
  const input = inputFor(jannaQ, false);
  input.rank = badRank;
  const formula = jannaQ.write.formulas.find(item => item.formulaKey === "minimum_magic_damage");
  let rejected = false;
  try { evaluate(formula.expression, jannaQ, input); } catch { rejected = true; }
  assert(rejected, "非法技能等级未拒绝", badRank);
  rangeChecks.push({ check: "skill_rank", skillKey: "janna_q", value: badRank, rejected: true });
}

const namiW = candidate.skills.nami_w;
const namiWMaxTargets = namiW.write.parameters.find(item => item.parameterKey === "max_targets");
assert(namiWMaxTargets?.valueType === "INTEGER" && namiWMaxTargets.fixedValue === 3, "娜美W目标上限来源值不符");
const namiWSourceMaxTargets = dataAt("nami_w", "MaxTargets", 0);
assert(namiWSourceMaxTargets === 3, "娜美W来源目标上限不符", namiWSourceMaxTargets);
assert(candidate.meta.scope.includes("唯一敌方英雄1V1"), "候选范围缺少一对一边界");
assert(namiW.pending.some(item => item.item.includes("起始目标")), "娜美W目标资格缺口未记录");
assert(namiW.excluded.some(item => item.item === "第三个目标"), "娜美W第三目标边界未记录");
rangeChecks.push({ check: "nami_w_one_vs_one_target_boundary", sourceMaxDifferentTargets: 3, allowedDifferentTargets: 2, thirdTargetRecordedExcluded: true, passed: true });

const jannaRDuration = candidate.skills.janna_r.write.parameters.find(item => item.parameterKey === "heal_duration_seconds");
assert(JSON.stringify(jannaRDuration?.levelValues) === JSON.stringify({ "1": 3, "2": 3, "3": 3 }), "迦娜R持续时间未使用来源索引1至3");
assert(dataAt("janna_r", "Duration", 1) === 3 && dataAt("janna_r", "Duration", 3) === 3, "迦娜R来源索引1至3不符");
rangeChecks.push({ check: "janna_r_duration_indices", sourceIndices: [1, 2, 3], candidateLevels: jannaRDuration.levelValues, passed: true });

const morganaRHaste = candidate.skills.morgana_r.write.parameters.find(item => item.parameterKey === "self_haste_percent_points");
assert(JSON.stringify(morganaRHaste?.levelValues) === JSON.stringify({ "1": 20, "2": 40, "3": 60 }), "莫甘娜R移速加成未使用来源索引1至3");
assert(dataAt("morgana_r", "HastePercent", 1) === 20 && dataAt("morgana_r", "HastePercent", 3) === 60, "莫甘娜R来源索引1至3不符");
rangeChecks.push({ check: "morgana_r_haste_indices", sourceIndices: [1, 2, 3], candidateLevels: morganaRHaste.levelValues, passed: true });

const luluP = candidate.skills.lulu_p;
const luluPRuntime = luluP.write.parameters.find(item => item.parameterKey === "actual_character_level_base_damage");
assert(luluPRuntime?.valueMode === "RUNTIME_INPUT" && luluPRuntime.fixedValue === null && luluPRuntime.levelValues === null, "璐璐P等级基础伤害不是真运行输入");
assert(sourceInterpolation("lulu_p", "TotalDamage", 5, 39), "璐璐P角色等级插值端点不符");
rangeChecks.push({ check: "lulu_p_level_damage_endpoints", runtimeInput: "actual_character_level_base_damage", endpoints: [5, 39], noDefault: true, passed: true });

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
  basis: "每个候选公式直接解析候选表达式，期望值独立读取冻结客户端DataValues和当前计算树；未使用候选参数值生成期望，也未调用业务接口。低端/高端各一组，外部属性和运行输入逐项缺值拒绝；写入后仍须用业务GET表达式复核。",
  apiCalls: 0,
  apiWrites: 0,
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ status: report.status, candidateMathReady: report.candidateMathReady, formulaCount: report.formulaCount, formulaCases: report.formulaCaseCount, missing: report.missingValueRejections, integerChecks: report.integerChecks, rangeChecks: report.rangeChecks, candidateSha256: report.candidateSha256 }, null, 2));

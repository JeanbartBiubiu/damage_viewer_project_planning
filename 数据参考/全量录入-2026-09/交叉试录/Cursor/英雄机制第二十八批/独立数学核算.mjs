import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repo = "C:/project/damage_web_dev";
const inputDir = path.join(repo, ".agents/artifacts/hero28-root-entry-20260909");
const durableDir = path.join(repo, "数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二十八批");
const candidatePath = path.join(artifactDir, "完整候选.json");
const planPath = path.join(artifactDir, "请求计划.json");
const versionPath = path.join(artifactDir, "候选版本.json");
const sourcePath = path.join(inputDir, "来源绑定与当前文本.json");
const inputVersionPath = path.join(inputDir, "输入版本.json");
const protectionPath = path.join(inputDir, "参考资料", "当前10槽保护快照.json");

const bytes = file => fs.readFileSync(file);
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const fileSha256 = file => sha256(bytes(file));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const close = (a, b, factor = 1e-6) =>
  Math.abs(Number(a) - Number(b)) <= factor * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (condition, message, detail = undefined) => {
  if (!condition) throw new Error(message + (detail === undefined ? "" : "：" + JSON.stringify(detail)));
};

const candidateBytes = bytes(candidatePath);
const planBytes = bytes(planPath);
const version = readJson(versionPath);
const candidate = JSON.parse(candidateBytes);
const plan = JSON.parse(planBytes);
const source = readJson(sourcePath);
const inputVersion = readJson(inputVersionPath);
const protectedSnapshot = readJson(protectionPath);
const frozen = {
  inputVersion: fileSha256(inputVersionPath),
  sourceBinding: fileSha256(sourcePath),
  protection: fileSha256(protectionPath),
};
const candidateSha256 = sha256(candidateBytes);
const planSha256 = sha256(planBytes);
const failures = [];
const check = (label, condition, detail = undefined) => {
  const record = { label, passed: Boolean(condition) };
  if (detail !== undefined) record.detail = detail;
  checks.push(record);
  if (!condition) failures.push({ type: "检查失败", ...record });
  return Boolean(condition);
};
const checks = [];

const skillKeys = [
  "maokai_p", "maokai_q", "maokai_w", "maokai_e", "maokai_r",
  "poppy_p", "poppy_q", "poppy_w", "poppy_e", "poppy_r",
];
const heroIdOf = skillKey => skillKey.startsWith("maokai_") ? "Maokai" : "Poppy";
const slotOf = skillKey => skillKey.slice(-1).toUpperCase();
const sourceSkill = skillKey => {
  const hero = source.heroes?.find(item => item.id === heroIdOf(skillKey));
  const bound = hero?.skills?.find(item => item.slot === slotOf(skillKey));
  const summary = hero?.source?.skills?.find(item => item.slot === slotOf(skillKey));
  fail(bound && summary, "冻结来源技能缺失", { skillKey, hero: heroIdOf(skillKey), slot: slotOf(skillKey) });
  return { hero, bound, summary, spell: bound.object.mSpell };
};
const sourceData = (skillKey, dataName, rank) => {
  const item = sourceSkill(skillKey).spell.DataValues?.find(value => value.name === dataName);
  fail(item && Array.isArray(item.values), "冻结来源DataValues缺失", { skillKey, dataName });
  const value = item.values[rank];
  fail(typeof value === "number" && Number.isFinite(value), "冻结来源等级值缺失", {
    skillKey, dataName, rank, values: item.values,
  });
  return value;
};
const sourceCalculation = (skillKey, calculation) => {
  const value = sourceSkill(skillKey).spell.mSpellCalculations?.[calculation];
  fail(value, "冻结来源计算树缺失", { skillKey, calculation });
  return value;
};
const sourcePart = (skillKey, calculation, index) => {
  const parts = sourceCalculation(skillKey, calculation).mFormulaParts;
  fail(Array.isArray(parts) && parts[index], "冻结来源计算树分段缺失", { skillKey, calculation, index });
  return parts[index];
};
const coefficient = (skillKey, calculation, index = 1) => {
  const value = Number(sourcePart(skillKey, calculation, index).mCoefficient);
  fail(Number.isFinite(value), "冻结来源系数缺失", { skillKey, calculation, index });
  return value;
};
const multiplier = (skillKey, calculation) => {
  const value = Number(sourceCalculation(skillKey, calculation).mMultiplier?.mNumber);
  fail(Number.isFinite(value), "冻结来源根倍率缺失", { skillKey, calculation });
  return value;
};
const maxLevel = skillKey => {
  const rank = Number(sourceSkill(skillKey).summary.officialMaxRank);
  fail(Number.isInteger(rank) && rank > 0, "冻结来源最大等级缺失", { skillKey, rank });
  return rank;
};

check("候选文件散列与版本记录一致", candidateSha256 === version.candidateSha256, {
  actual: candidateSha256, expected: version.candidateSha256,
});
check("计划文件散列与版本记录一致", planSha256 === version.planSha256, {
  actual: planSha256, expected: version.planSha256,
});
check("候选绑定冻结来源散列一致", candidate.meta?.sourceBindingSha256 === frozen.sourceBinding, frozen);
check("候选输入与保护快照散列一致",
  candidate.meta?.sourceInputSha256 === frozen.inputVersion &&
  candidate.meta?.protectionSnapshotSha256 === frozen.protection, frozen);
check("输入版本为只读且版本固定",
  inputVersion.apiWrites === 0 && inputVersion.GETs === 102 &&
  source.clientVersion === "16.17" && source.officialVersion === "16.17.1",
  { apiWrites: inputVersion.apiWrites, GETs: inputVersion.GETs, sourceVersions: source });
check("候选没有业务写入", candidate.meta?.apiWrites === 0 && plan.apiWrites === 0 && candidate.postIntents?.length === plan.count,
  { candidateApiWrites: candidate.meta?.apiWrites, planApiWrites: plan.apiWrites, planCount: plan.count });

const candidateSkills = candidate.skills ?? {};
for (const skillKey of skillKeys) {
  check("技能键和来源绑定一致：" + skillKey,
    candidateSkills[skillKey]?.skillKey === skillKey &&
    candidateSkills[skillKey]?.source?.binding === sourceSkill(skillKey).bound.binding,
    { candidate: candidateSkills[skillKey]?.source?.binding, source: sourceSkill(skillKey).bound.binding });
}

const parameterMap = new Map();
const formulaMap = new Map();
for (const skillKey of skillKeys) {
  const skill = candidateSkills[skillKey];
  fail(skill, "候选技能缺失", skillKey);
  const parameters = skill.write?.parameters ?? [];
  const formulas = skill.write?.formulas ?? [];
  const pMap = new Map(parameters.map(item => [item.parameterKey, item]));
  const fMap = new Map(formulas.map(item => [item.formulaKey, item]));
  fail(pMap.size === parameters.length, "候选参数键重复", skillKey);
  fail(fMap.size === formulas.length, "候选公式键重复", skillKey);
  parameterMap.set(skillKey, pMap);
  formulaMap.set(skillKey, fMap);
  for (const parameter of parameters) {
    const values = parameter.valueMode === "SKILL_LEVEL" ? Object.values(parameter.levelValues ?? {}) :
      parameter.valueMode === "FIXED" ? [parameter.fixedValue] : [];
    for (const value of values) {
      if (parameter.valueMode !== "RUNTIME_INPUT") {
        check("参数值有限：" + skillKey + "/" + parameter.parameterKey,
          typeof value === "number" && Number.isFinite(value), { value });
      }
      if (parameter.valueType === "INTEGER" && value !== null && value !== undefined) {
        check("整数参数没有小数：" + skillKey + "/" + parameter.parameterKey,
          Number.isInteger(Number(value)), { value });
      }
    }
    if (parameter.valueMode === "RUNTIME_INPUT") {
      check("实际输入无默认值：" + skillKey + "/" + parameter.parameterKey,
        parameter.fixedValue === null && parameter.levelValues === null,
        { fixedValue: parameter.fixedValue, levelValues: parameter.levelValues });
    }
    if (parameter.valueMode === "SKILL_LEVEL") {
      check("等级参数覆盖完整等级：" + skillKey + "/" + parameter.parameterKey,
        Object.keys(parameter.levelValues ?? {}).length === maxLevel(skillKey),
        { keys: Object.keys(parameter.levelValues ?? {}), maxLevel: maxLevel(skillKey) });
    }
  }
  for (const formula of formulas) {
    const walk = (node, at = "$") => {
      if (!node || typeof node !== "object") {
        failures.push({ type: "公式节点缺失", skillKey, formulaKey: formula.formulaKey, at });
        return;
      }
      if (node.nodeType === "PARAMETER") {
        check("公式参数引用存在：" + skillKey + "/" + formula.formulaKey + "/" + node.parameterKey,
          pMap.has(node.parameterKey), { parameterKey: node.parameterKey });
        return;
      }
      if (node.nodeType === "ATTRIBUTE") {
        check("属性节点范围受限：" + skillKey + "/" + formula.formulaKey,
          ["SOURCE", "TARGET"].includes(node.attributeOwner) &&
          ["TOTAL", "BASE", "BONUS"].includes(node.attributeValueKind), node);
        return;
      }
      const binary = node.nodeType === "OPERATION" && Array.isArray(node.operands) && node.operands.length === 2;
      check("公式运算保持二元：" + skillKey + "/" + formula.formulaKey + at, binary, node);
      if (binary) {
        walk(node.operands[0], at + ".left");
        walk(node.operands[1], at + ".right");
      }
    };
    walk(formula.expression);
  }
}

const levelMappings = {
  maokai_q: {
    base_damage: ["BaseDamage", value => value],
    target_max_health_ratio: ["BasePercentHealth", value => value],
  },
  maokai_w: {
    base_damage: ["BaseDamage", value => value],
    root_duration_ms: ["RootDuration", value => value * 1000],
  },
  maokai_r: {
    base_damage: ["BaseDamage", value => value],
    minimum_root_duration_ms: ["MinRootDuration", value => value * 1000],
    maximum_root_duration_ms: ["MaxRootDuration", value => value * 1000],
    move_haste_percent_points: ["MoveHaste", value => value * 100],
  },
  poppy_q: {
    base_damage: ["BaseDamageValue", value => value],
    target_max_health_ratio: ["HealthDamagePercent", value => value / 100],
    base_slow_ratio: ["BaseMoveSpeedMod", value => value],
  },
  poppy_w: { base_interrupt_damage: ["DamageValue", value => value] },
  poppy_e: {
    base_damage: ["BaseDamageValue", value => value],
    stun_duration_ms: ["StunDuration", value => value * 1000],
  },
  poppy_r: { base_damage: ["BaseDamage", value => value] },
};
const sourceLevelChecks = [];
for (const [skillKey, mapping] of Object.entries(levelMappings)) {
  const pMap = parameterMap.get(skillKey);
  for (const [parameterKey, [dataName, convert]] of Object.entries(mapping)) {
    const parameter = pMap.get(parameterKey);
    const actual = Object.values(parameter?.levelValues ?? {}).map(Number);
    const expected = [];
    for (let rank = 1; rank <= maxLevel(skillKey); rank += 1) expected.push(convert(sourceData(skillKey, dataName, rank)));
    const passed = actual.length === expected.length && actual.every((value, index) => close(value, expected[index], 1e-5));
    const record = { skillKey, parameterKey, dataName, actual, expected, passed };
    sourceLevelChecks.push(record);
    if (!passed) failures.push({ type: "等级参数与冻结来源不一致", ...record });
  }
}

const sourceShapeChecks = [];
const shape = (label, passed, detail) => {
  const record = { label, passed: Boolean(passed), detail };
  sourceShapeChecks.push(record);
  if (!passed) failures.push({ type: "来源计算树形状不符", ...record });
};
const hasDataPart = (part, dataName) => part.mDataValue === dataName;
const hasCoefficientPart = (part, value) => close(Number(part.mCoefficient), value, 1e-6);
const sourceP = sourceSkill("maokai_p").spell;
const maokaiHealingPart = sourceCalculation("maokai_p", "PassiveHealingTotal").mFormulaParts?.[0];
shape("茂凯P治疗取mStat12分段", maokaiHealingPart?.mStat === 12 && Boolean(maokaiHealingPart?.mSubpart), {
  mStat: maokaiHealingPart?.mStat, subpart: maokaiHealingPart?.mSubpart,
});
const maokaiQDamage = sourceCalculation("maokai_q", "TotalDamage").mFormulaParts ?? [];
shape("茂凯Q伤害包含基础值与法强段",
  hasDataPart(maokaiQDamage[0], "BaseDamage") && hasDataPart(maokaiQDamage[1], "APRatio"), maokaiQDamage);
shape("茂凯Q生命比例树直接取BasePercentHealth",
  hasDataPart(sourcePart("maokai_q", "TotalPercentHealth", 0), "BasePercentHealth"),
  sourcePart("maokai_q", "TotalPercentHealth", 0));
shape("茂凯W计算树法强系数为0.4",
  hasDataPart(sourcePart("maokai_w", "TotalDamage", 0), "BaseDamage") &&
  hasCoefficientPart(sourcePart("maokai_w", "TotalDamage", 1), 0.4), sourceCalculation("maokai_w", "TotalDamage"));
shape("茂凯R计算树法强系数为0.75",
  hasDataPart(sourcePart("maokai_r", "TotalDamage", 0), "BaseDamage") &&
  hasCoefficientPart(sourcePart("maokai_r", "TotalDamage", 1), 0.75), sourceCalculation("maokai_r", "TotalDamage"));
const poppyShield = sourceCalculation("poppy_p", "ShieldValue").mFormulaParts?.[0];
shape("波比P护盾取mStat12等级比例", poppyShield?.mStat === 12 && Boolean(poppyShield?.mSubpart), poppyShield);
shape("波比Q基础伤害取BaseDamageValue和0.75额外攻击力",
  hasDataPart(sourcePart("poppy_q", "BaseDamage", 0), "BaseDamageValue") &&
  sourcePart("poppy_q", "BaseDamage", 1).mStat === 2 &&
  sourcePart("poppy_q", "BaseDamage", 1).mStatFormula === 2 &&
  hasCoefficientPart(sourcePart("poppy_q", "BaseDamage", 1), 0.75), sourceCalculation("poppy_q", "BaseDamage"));
shape("波比Q减速树取额外生命系数",
  hasDataPart(sourcePart("poppy_q", "MoveSpeedMod", 0), "BaseMoveSpeedMod") &&
  sourcePart("poppy_q", "MoveSpeedMod", 1).mStat === 12 &&
  hasCoefficientPart(sourcePart("poppy_q", "MoveSpeedMod", 1), 0.00008), sourceCalculation("poppy_q", "MoveSpeedMod"));
shape("波比W双抗树分别取mStat1和mStat6",
  sourcePart("poppy_w", "BonusArmor", 0).mStat === 1 &&
  sourcePart("poppy_w", "BonusMR", 0).mStat === 6, {
    armor: sourceCalculation("poppy_w", "BonusArmor"), magicResistance: sourceCalculation("poppy_w", "BonusMR"),
  });
shape("波比W打断伤害含0.7法强段",
  hasDataPart(sourcePart("poppy_w", "InterruptDamage", 0), "DamageValue") &&
  hasCoefficientPart(sourcePart("poppy_w", "InterruptDamage", 1), 0.7), sourceCalculation("poppy_w", "InterruptDamage"));
shape("波比E使用tooltipOnly的TackleDamage且系数0.6",
  sourceCalculation("poppy_e", "TackleDamage").tooltipOnly === true &&
  hasDataPart(sourcePart("poppy_e", "TackleDamage", 0), "BaseDamageValue") &&
  hasCoefficientPart(sourcePart("poppy_e", "TackleDamage", 1), 0.6), sourceCalculation("poppy_e", "TackleDamage"));
shape("波比R完整伤害树含0.9额外攻击力",
  hasDataPart(sourcePart("poppy_r", "Damage", 0), "BaseDamage") &&
  sourcePart("poppy_r", "Damage", 1).mStat === 2 &&
  hasCoefficientPart(sourcePart("poppy_r", "Damage", 1), 0.9), sourceCalculation("poppy_r", "Damage"));
const halfDamage = sourceCalculation("poppy_r", "HalfDamage");
shape("波比R点按树引用完整伤害并使用SnapCastDamageRatio",
  halfDamage.mModifiedGameCalculation === "Damage" && halfDamage.mMultiplier?.mDataValue === "SnapCastDamageRatio",
  halfDamage);

const attrs = {
  sourceHpTotal: ["SOURCE", "hp", "TOTAL"],
  sourceHpBonus: ["SOURCE", "hp", "BONUS"],
  sourceAp: ["SOURCE", "ability_power", "TOTAL"],
  sourceBonusAd: ["SOURCE", "attack_damage", "BONUS"],
  targetHpTotal: ["TARGET", "hp", "TOTAL"],
};
function scenario(high) {
  const levels = Object.fromEntries(skillKeys.map(skillKey => [skillKey, high ? maxLevel(skillKey) : 1]));
  return {
    id: high ? "B-最高技能等级" : "A-技能等级1",
    levels,
    attributes: {
      SOURCE: {
        hp: { TOTAL: high ? 5200 : 3500, BONUS: high ? 1800 : 700 },
        ability_power: { TOTAL: high ? 315 : 173 },
        attack_damage: { BONUS: high ? 130 : 75 },
      },
      TARGET: { hp: { TOTAL: high ? 4100 : 2600 } },
    },
    runtime: {
      maokai_p: {
        actual_passive_heal_ratio: high ? 0.08 : 0.04,
        passive_cooldown_ms: high ? 20000 : 30000,
      },
      poppy_p: {
        actual_cooldown_ms: high ? 10000 : 16000,
        actual_passive_magic_damage: high ? 180 : 20,
        actual_shield_ratio_by_character_level: high ? 0.2 : 0.11,
      },
      poppy_w: {
        actual_source_armor_before_passive: high ? 250 : 100,
        actual_source_magic_resistance_before_passive: high ? 180 : 80,
      },
    },
  };
}

function parameterValue(skillKey, parameterKey, testCase) {
  const parameter = parameterMap.get(skillKey)?.get(parameterKey);
  fail(parameter, "候选公式引用参数缺失", { skillKey, parameterKey });
  let value;
  if (parameter.valueMode === "FIXED") value = parameter.fixedValue;
  else if (parameter.valueMode === "SKILL_LEVEL") {
    const rank = testCase.levels[skillKey];
    value = parameter.levelValues?.[String(rank)];
  } else if (parameter.valueMode === "RUNTIME_INPUT") {
    value = testCase.runtime?.[skillKey]?.[parameterKey];
    if (value === undefined || value === null) throw new Error("MISSING_RUNTIME_INPUT:" + skillKey + "/" + parameterKey);
  } else throw new Error("UNSUPPORTED_VALUE_MODE:" + parameter.valueMode);
  if (value === undefined || value === null || !Number.isFinite(Number(value))) {
    throw new Error("MISSING_PARAMETER_VALUE:" + skillKey + "/" + parameterKey);
  }
  const number = Number(value);
  if (parameter.valueType === "INTEGER" && !Number.isInteger(number)) {
    throw new Error("INTEGER_PARAMETER_REQUIRES_INTEGER:" + skillKey + "/" + parameterKey);
  }
  return number;
}
function attributeValue(owner, attributeKey, valueKind, testCase) {
  if (!["SOURCE", "TARGET"].includes(owner) || !["TOTAL", "BASE", "BONUS"].includes(valueKind)) {
    throw new Error("UNSUPPORTED_ATTRIBUTE_NODE:" + owner + "." + attributeKey + "." + valueKind);
  }
  const value = testCase.attributes?.[owner]?.[attributeKey]?.[valueKind];
  if (value === undefined || value === null || !Number.isFinite(Number(value))) {
    throw new Error("MISSING_ATTRIBUTE:" + owner + "." + attributeKey + "." + valueKind);
  }
  return Number(value);
}
function evaluate(node, skillKey, testCase, at = "$") {
  fail(node && typeof node === "object", "候选公式节点缺失", { skillKey, at });
  if (node.nodeType === "PARAMETER") return parameterValue(skillKey, node.parameterKey, testCase);
  if (node.nodeType === "ATTRIBUTE") return attributeValue(node.attributeOwner, node.attributeKey, node.attributeValueKind, testCase);
  fail(node.nodeType === "OPERATION" && Array.isArray(node.operands) && node.operands.length === 2,
    "候选公式必须是二元运算", { skillKey, at, node });
  const left = evaluate(node.operands[0], skillKey, testCase, at + ".left");
  const right = evaluate(node.operands[1], skillKey, testCase, at + ".right");
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
function dependencySet(node, skillKey, result = { parameters: new Set(), runtime: new Set(), attributes: new Set() }) {
  if (node.nodeType === "PARAMETER") {
    result.parameters.add(node.parameterKey);
    const parameter = parameterMap.get(skillKey)?.get(node.parameterKey);
    fail(parameter, "依赖参数缺失", { skillKey, parameterKey: node.parameterKey });
    if (parameter.valueMode === "RUNTIME_INPUT") result.runtime.add(node.parameterKey);
    return result;
  }
  if (node.nodeType === "ATTRIBUTE") {
    result.attributes.add(node.attributeOwner + "." + node.attributeKey + "." + node.attributeValueKind);
    return result;
  }
  fail(node.nodeType === "OPERATION" && Array.isArray(node.operands) && node.operands.length === 2,
    "依赖扫描遇到非二元公式", { skillKey, node });
  dependencySet(node.operands[0], skillKey, result);
  dependencySet(node.operands[1], skillKey, result);
  return result;
}

function sourceExpected(skillKey, formulaKey, testCase) {
  const rank = testCase.levels[skillKey];
  const ap = testCase.attributes.SOURCE.ability_power.TOTAL;
  const bonusAd = testCase.attributes.SOURCE.attack_damage.BONUS;
  const sourceHp = testCase.attributes.SOURCE.hp.TOTAL;
  const sourceBonusHp = testCase.attributes.SOURCE.hp.BONUS;
  const targetHp = testCase.attributes.TARGET.hp.TOTAL;
  switch (skillKey + "/" + formulaKey) {
    case "maokai_p/healing_total":
      return testCase.runtime.maokai_p.actual_passive_heal_ratio * sourceHp;
    case "maokai_q/magic_damage":
      return sourceData("maokai_q", "BaseDamage", rank) +
        sourceData("maokai_q", "APRatio", rank) * ap +
        sourceData("maokai_q", "BasePercentHealth", rank) * targetHp;
    case "maokai_w/magic_damage":
      return sourceData("maokai_w", "BaseDamage", rank) + coefficient("maokai_w", "TotalDamage") * ap;
    case "maokai_r/magic_damage":
      return sourceData("maokai_r", "BaseDamage", rank) + coefficient("maokai_r", "TotalDamage") * ap;
    case "poppy_p/shield_value":
      return testCase.runtime.poppy_p.actual_shield_ratio_by_character_level * sourceHp;
    case "poppy_q/physical_damage_per_hit":
      return sourceData("poppy_q", "BaseDamageValue", rank) +
        coefficient("poppy_q", "BaseDamage") * bonusAd +
        sourceData("poppy_q", "HealthDamagePercent", rank) / 100 * targetHp;
    case "poppy_q/physical_damage_same_target_total":
      return sourceData("poppy_q", "HealthDamagePercent", rank) / 100 * targetHp * 2 +
        (sourceData("poppy_q", "BaseDamageValue", rank) + coefficient("poppy_q", "BaseDamage") * bonusAd) * 2;
    case "poppy_q/slow_ratio":
      return sourceData("poppy_q", "BaseMoveSpeedMod", rank) + coefficient("poppy_q", "MoveSpeedMod") * sourceBonusHp;
    case "poppy_w/passive_bonus_armor":
      return sourceData("poppy_w", "PassiveResistPercent", rank) * testCase.runtime.poppy_w.actual_source_armor_before_passive;
    case "poppy_w/passive_bonus_armor_low_health":
      return sourceData("poppy_w", "PassiveResistPercent", rank) * 2 * testCase.runtime.poppy_w.actual_source_armor_before_passive;
    case "poppy_w/passive_bonus_magic_resistance":
      return sourceData("poppy_w", "PassiveResistPercent", rank) * testCase.runtime.poppy_w.actual_source_magic_resistance_before_passive;
    case "poppy_w/passive_bonus_magic_resistance_low_health":
      return sourceData("poppy_w", "PassiveResistPercent", rank) * 2 * testCase.runtime.poppy_w.actual_source_magic_resistance_before_passive;
    case "poppy_w/interrupt_magic_damage":
      return sourceData("poppy_w", "DamageValue", rank) + coefficient("poppy_w", "InterruptDamage") * ap;
    case "poppy_e/tackle_physical_damage":
      return sourceData("poppy_e", "BaseDamageValue", rank) + coefficient("poppy_e", "TackleDamage") * bonusAd;
    case "poppy_e/wall_collision_total_physical_damage":
      return 2 * (sourceData("poppy_e", "BaseDamageValue", rank) + coefficient("poppy_e", "TackleDamage") * bonusAd);
    case "poppy_r/full_physical_damage":
      return sourceData("poppy_r", "BaseDamage", rank) + coefficient("poppy_r", "Damage") * bonusAd;
    case "poppy_r/snap_physical_damage":
      return sourceData("poppy_r", "SnapCastDamageRatio", rank) *
        (sourceData("poppy_r", "BaseDamage", rank) + coefficient("poppy_r", "Damage") * bonusAd);
    default: throw new Error("没有冻结来源独立期望：" + skillKey + "/" + formulaKey);
  }
}

const formulaRecords = [];
const positiveCases = [];
const missingValueChecks = [];
const boundaryChecks = [];
const actualExpressions = [];
const formulaCountExpected = 17;
for (const skillKey of skillKeys) {
  for (const formula of candidateSkills[skillKey].write.formulas) {
    const dependency = dependencySet(formula.expression, skillKey);
    const record = {
      skillKey,
      formulaKey: formula.formulaKey,
      runtimeDependencies: [...dependency.runtime],
      attributeDependencies: [...dependency.attributes],
      cases: [],
    };
    actualExpressions.push({ skillKey, formulaKey: formula.formulaKey, expression: formula.expression, expressionSha256: sha256(JSON.stringify(formula.expression)) });
    for (const testCase of [scenario(false), scenario(true)]) {
      try {
        const actual = evaluate(formula.expression, skillKey, testCase);
        const expected = sourceExpected(skillKey, formula.formulaKey, testCase);
        const passed = Number.isFinite(actual) && close(actual, expected);
        const caseRecord = { caseId: testCase.id, rank: testCase.levels[skillKey], actual, expected, passed };
        record.cases.push(caseRecord);
        positiveCases.push({ skillKey, formulaKey: formula.formulaKey, ...caseRecord });
        if (!passed) failures.push({ type: "候选表达式与冻结来源期望不一致", skillKey, formulaKey: formula.formulaKey, ...caseRecord });
      } catch (error) {
        const caseRecord = { caseId: testCase.id, rank: testCase.levels[skillKey], passed: false, error: error.message };
        record.cases.push(caseRecord);
        positiveCases.push({ skillKey, formulaKey: formula.formulaKey, ...caseRecord });
        failures.push({ type: "候选表达式求值失败", skillKey, formulaKey: formula.formulaKey, error: error.message });
      }
    }
    for (const parameterKey of dependency.runtime) {
      const missing = scenario(false);
      delete missing.runtime[skillKey][parameterKey];
      let rejected = false;
      let errorMessage = null;
      try { evaluate(formula.expression, skillKey, missing); } catch (error) { rejected = true; errorMessage = error.message; }
      const item = { skillKey, formulaKey: formula.formulaKey, dependency: "PARAMETER:" + parameterKey, rejected, error: errorMessage };
      missingValueChecks.push(item);
      if (!rejected) failures.push({ type: "缺少实际输入未拒绝", ...item });
    }
    for (const attributePath of dependency.attributes) {
      const [owner, attributeKey, valueKind] = attributePath.split(".");
      const missing = scenario(false);
      delete missing.attributes[owner][attributeKey][valueKind];
      let rejected = false;
      let errorMessage = null;
      try { evaluate(formula.expression, skillKey, missing); } catch (error) { rejected = true; errorMessage = error.message; }
      const item = { skillKey, formulaKey: formula.formulaKey, dependency: "ATTRIBUTE:" + attributePath, rejected, error: errorMessage };
      missingValueChecks.push(item);
      if (!rejected) failures.push({ type: "缺少属性输入未拒绝", ...item });
    }
    formulaRecords.push(record);
  }
}

const runtimeParameterChecks = [];
for (const skillKey of skillKeys) {
  for (const parameter of candidateSkills[skillKey].write.parameters.filter(item => item.valueMode === "RUNTIME_INPUT")) {
    const missing = scenario(false);
    if (missing.runtime[skillKey]) delete missing.runtime[skillKey][parameter.parameterKey];
    let rejectedMissing = false;
    let missingError = null;
    try { parameterValue(skillKey, parameter.parameterKey, missing); } catch (error) { rejectedMissing = true; missingError = error.message; }
    const item = { skillKey, parameterKey: parameter.parameterKey, valueType: parameter.valueType, rejectedMissing, missingError };
    if (parameter.valueType === "INTEGER") {
      const fractional = scenario(false);
      fractional.runtime[skillKey] ??= {};
      fractional.runtime[skillKey][parameter.parameterKey] = 0.5;
      let rejectedFractional = false;
      let fractionalError = null;
      try { parameterValue(skillKey, parameter.parameterKey, fractional); } catch (error) { rejectedFractional = true; fractionalError = error.message; }
      item.rejectedFractional = rejectedFractional;
      item.fractionalError = fractionalError;
      if (!rejectedFractional) failures.push({ type: "整数实际输入未拒绝小数", skillKey, parameterKey, fractionalError });
    }
    runtimeParameterChecks.push(item);
    if (!rejectedMissing) failures.push({ type: "实际输入缺失未拒绝", skillKey, parameterKey, missingError });
  }
}

function evaluateFormula(skillKey, formulaKey, testCase) {
  const formula = formulaMap.get(skillKey)?.get(formulaKey);
  fail(formula, "候选公式缺失", { skillKey, formulaKey });
  return evaluate(formula.expression, skillKey, testCase);
}
function boundary(label, actual, expected, detail = {}) {
  const passed = close(actual, expected);
  const item = { label, actual, expected, passed, ...detail };
  boundaryChecks.push(item);
  if (!passed) failures.push({ type: "边界或组合关系不一致", ...item });
}
for (const high of [false, true]) {
  const testCase = scenario(high);
  const perHit = evaluateFormula("poppy_q", "physical_damage_per_hit", testCase);
  const total = evaluateFormula("poppy_q", "physical_damage_same_target_total", testCase);
  boundary("波比Q同一目标两次总量" + (high ? "高等级" : "一级"), total, perHit * 2, { perHit });
  const armor = evaluateFormula("poppy_w", "passive_bonus_armor", testCase);
  const armorLow = evaluateFormula("poppy_w", "passive_bonus_armor_low_health", testCase);
  boundary("波比W低生命护甲端点" + (high ? "高等级" : "一级"), armorLow, armor * 2, { armor });
  const magicResistance = evaluateFormula("poppy_w", "passive_bonus_magic_resistance", testCase);
  const magicResistanceLow = evaluateFormula("poppy_w", "passive_bonus_magic_resistance_low_health", testCase);
  boundary("波比W低生命魔抗端点" + (high ? "高等级" : "一级"), magicResistanceLow, magicResistance * 2, { magicResistance });
  const full = evaluateFormula("poppy_r", "full_physical_damage", testCase);
  const snap = evaluateFormula("poppy_r", "snap_physical_damage", testCase);
  boundary("波比R点按半伤害" + (high ? "高等级" : "一级"), snap, full * 0.5, { full });
  const tackle = evaluateFormula("poppy_e", "tackle_physical_damage", testCase);
  const wall = evaluateFormula("poppy_e", "wall_collision_total_physical_damage", testCase);
  boundary("波比E撞墙同目标两次" + (high ? "高等级" : "一级"), wall, tackle * 2, { tackle });
}
const slowLowCase = scenario(false);
const slowHighCase = clone(slowLowCase);
slowHighCase.id = "B-同等级较高额外生命";
slowHighCase.attributes.SOURCE.hp.BONUS = 1800;
const slowLow = evaluateFormula("poppy_q", "slow_ratio", slowLowCase);
const slowHigh = evaluateFormula("poppy_q", "slow_ratio", slowHighCase);
boundary("波比Q额外生命输入改变减速", slowHigh - slowLow,
  coefficient("poppy_q", "MoveSpeedMod") * (slowHighCase.attributes.SOURCE.hp.BONUS - slowLowCase.attributes.SOURCE.hp.BONUS), { slowLow, slowHigh });
const maokaiQLow = evaluateFormula("maokai_q", "magic_damage", scenario(false));
const maokaiQHigh = evaluateFormula("maokai_q", "magic_damage", scenario(true));
check("茂凯Q目标最大生命项随等级和目标值变化", maokaiQHigh > maokaiQLow, { maokaiQLow, maokaiQHigh });

const formulaCount = formulaRecords.length;
const positiveCaseCount = positiveCases.length;
check("公式总数为17", formulaCount === formulaCountExpected, { actual: formulaCount, expected: formulaCountExpected });
check("每个公式有两个正例", positiveCaseCount === formulaCountExpected * 2 && positiveCases.every(item => item.passed), {
  actual: positiveCaseCount, expected: formulaCountExpected * 2, passed: positiveCases.filter(item => item.passed).length,
});
check("缺值检查全部拒绝", missingValueChecks.length === 22 && missingValueChecks.every(item => item.rejected), {
  actual: missingValueChecks.length, expected: 22, rejected: missingValueChecks.filter(item => item.rejected).length,
});
check("实际输入缺值检查全部拒绝", runtimeParameterChecks.every(item => item.rejectedMissing), {
  count: runtimeParameterChecks.length, rejected: runtimeParameterChecks.filter(item => item.rejectedMissing).length,
});
check("整数实际输入小数全部拒绝", runtimeParameterChecks.filter(item => item.valueType === "INTEGER").every(item => item.rejectedFractional),
  runtimeParameterChecks.filter(item => item.valueType === "INTEGER"));
check("来源等级值逐项独立核对通过", sourceLevelChecks.length === 15 && sourceLevelChecks.every(item => item.passed), {
  checks: sourceLevelChecks.length, expected: 15, passed: sourceLevelChecks.filter(item => item.passed).length,
});
check("边界和组合关系全部通过", boundaryChecks.every(item => item.passed), {
  checks: boundaryChecks.length, passed: boundaryChecks.filter(item => item.passed).length,
});

const report = {
  generatedAt: new Date().toISOString(),
  status: failures.length === 0 ? "PASS" : "REVISE",
  candidateMathReady: failures.length === 0,
  businessMathReady: false,
  apiWrites: 0,
  candidateSha256,
  planSha256,
  sourceBindingSha256: frozen.sourceBinding,
  sourceInputSha256: frozen.inputVersion,
  protectionSnapshotSha256: frozen.protection,
  method: "从候选实际表达式树求值；期望值独立读取冻结客户端16.17绑定来源的DataValues、计算树分段和根修饰倍率，不用候选表达式生成期望值，不调用业务接口。",
  sourceVersions: { client: source.clientVersion, official: source.officialVersion },
  counts: {
    formulaCount,
    positiveCaseCount,
    positivePassed: positiveCases.filter(item => item.passed).length,
    missingValueChecks: missingValueChecks.length,
    missingValueRejected: missingValueChecks.filter(item => item.rejected).length,
    runtimeParameterChecks: runtimeParameterChecks.length,
    runtimeMissingRejected: runtimeParameterChecks.filter(item => item.rejectedMissing).length,
    boundaryChecks: boundaryChecks.length,
    boundaryPassed: boundaryChecks.filter(item => item.passed).length,
    sourceLevelChecks: sourceLevelChecks.length,
    sourceLevelPassed: sourceLevelChecks.filter(item => item.passed).length,
  },
  frozen,
  checks,
  sourceLevelChecks,
  sourceShapeChecks,
  actualExpressions,
  formulas: formulaRecords,
  positiveCases,
  missingValueChecks,
  runtimeParameterChecks,
  boundaryChecks,
  failures,
};
const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(artifactDir, "独立数学核算.json"), reportBytes);
fs.mkdirSync(durableDir, { recursive: true });
fs.writeFileSync(path.join(durableDir, "独立数学核算.json"), reportBytes);
console.log(JSON.stringify({
  status: report.status,
  candidateMathReady: report.candidateMathReady,
  businessMathReady: report.businessMathReady,
  apiWrites: 0,
  counts: report.counts,
  failures: failures.length,
  output: path.join(artifactDir, "独立数学核算.json"),
}, null, 2));
if (report.status !== "PASS") process.exitCode = 1;

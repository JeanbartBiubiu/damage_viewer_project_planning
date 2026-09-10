import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_DIR = HERE;
const INPUT_DIR = path.resolve(HERE, "..", "..", "hero42-root-entry-20260910");
const CANDIDATE_FILE = path.join(CANDIDATE_DIR, "完整候选.json");
const BINDING_FILE = path.join(INPUT_DIR, "来源绑定与当前文本.json");
const REPORT_FILE = path.join(HERE, "独立数学核算.json");

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const shaFile = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const near = (a, b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= 1e-6 * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b))) + 1e-7;
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
};
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const candidate = readJson(CANDIDATE_FILE);
const binding = readJson(BINDING_FILE);
const candidateVersion = readJson(path.join(CANDIDATE_DIR, "候选版本.json"));

const expectedOrder = [
  "qiyana_p", "qiyana_q", "qiyana_w", "qiyana_e", "qiyana_r",
  "ksante_p", "ksante_q", "ksante_w", "ksante_e", "ksante_r",
  "mel_p", "mel_q", "mel_w", "mel_e", "mel_r",
  "yunara_p", "yunara_q", "yunara_w", "yunara_e", "yunara_r",
];
const heroIds = { qiyana: "Qiyana", ksante: "KSante", mel: "Mel", yunara: "Yunara" };
const maxLevels = { p: 1, q: 5, w: 5, e: 5, r: 3 };
const sourceSkills = Object.fromEntries(binding.heroes.flatMap(hero => hero.skills.map(skill => [`${hero.id.toLowerCase()}_${skill.slot.toLowerCase()}`, skill])));
const keyParts = key => {
  const [stem, slot] = key.split("_");
  return { hero: heroIds[stem], slot: slot.toUpperCase() };
};
const sourceSkill = key => {
  const skill = sourceSkills[key];
  if (!skill) throw new Error(`缺少冻结来源绑定 ${key}`);
  return skill;
};
const sourceSpell = key => sourceSkill(key).object.mSpell;
const rawDataRow = (key, name) => {
  const row = (sourceSpell(key).DataValues || []).find(item => item.name === name);
  if (!row || !Array.isArray(row.values)) throw new Error(`缺少原始数据值 ${key}/${name}`);
  return row;
};
const rawAt = (key, name, index = 0) => {
  const value = rawDataRow(key, name).values[index];
  if (value === undefined || value === null) throw new Error(`原始数组没有索引 ${key}/${name}/${index}`);
  return value;
};
const rawCalc = (key, name) => {
  const calc = sourceSpell(key).mSpellCalculations?.[name];
  if (!calc) throw new Error(`缺少原始计算树 ${key}/${name}`);
  return calc;
};
const rawPart = (key, calcName, index = 0) => {
  const part = rawCalc(key, calcName).mFormulaParts?.[index];
  if (!part) throw new Error(`缺少原始计算树分项 ${key}/${calcName}/${index}`);
  return part;
};
const rawDataValueFromPart = (key, calcName, index) => {
  const part = rawPart(key, calcName, index);
  if (typeof part.mDataValue !== "string") throw new Error(`原始分项没有数据值引用 ${key}/${calcName}/${index}`);
  return rawAt(key, part.mDataValue, 0);
};
const rawCoefficient = (key, calcName, index) => {
  const part = rawPart(key, calcName, index);
  if (typeof part.mCoefficient === "number") return part.mCoefficient;
  return rawDataValueFromPart(key, calcName, index);
};
const rawMultiplierDataValue = (key, calcName) => {
  const part = rawCalc(key, calcName).mMultiplier;
  if (!part || typeof part.mDataValue !== "string") throw new Error(`原始计算树没有数据值乘数 ${key}/${calcName}`);
  return rawAt(key, part.mDataValue, 0);
};
const rawMultiplierLevel1 = (key, calcName) => {
  const part = rawCalc(key, calcName).mMultiplier;
  if (!part || typeof part.mLevel1Value !== "number") throw new Error(`原始计算树没有等级初值乘数 ${key}/${calcName}`);
  return part.mLevel1Value;
};
const rawNumber = (key, calcName, index) => {
  const part = rawPart(key, calcName, index);
  if (typeof part.mNumber !== "number") throw new Error(`原始分项没有常数 ${key}/${calcName}/${index}`);
  return part.mNumber;
};
const toMs = seconds => Math.round(Number(seconds) * 1000);
const toPoints = ratio => Number(ratio) * 100;

const issues = [];
const addIssue = issue => issues.push(issue);
const candidateSkill = key => {
  const skill = candidate.skills?.[key];
  if (!skill) throw new Error(`候选缺少技能 ${key}`);
  return skill;
};
const parameter = (key, parameterKey) => {
  const item = candidateSkill(key).write.parameters.find(value => value.parameterKey === parameterKey);
  if (!item) throw new Error(`候选缺少参数 ${key}/${parameterKey}`);
  return item;
};
const formula = (key, formulaKey) => {
  const item = candidateSkill(key).write.formulas.find(value => value.formulaKey === formulaKey);
  if (!item) throw new Error(`候选缺少公式 ${key}/${formulaKey}`);
  return item;
};
const attrKey = (owner, key, kind) => `${owner}.${key}.${kind}`;
const getContextValue = (context, key) => {
  const value = context.attributes?.[key];
  if (value === undefined || value === null) throw new Error(`缺少属性输入 ${key}`);
  return value;
};
const resolveParameter = (key, parameterKey, context) => {
  const item = parameter(key, parameterKey);
  if (item.valueMode === "FIXED") return item.fixedValue;
  if (item.valueMode === "SKILL_LEVEL") {
    if (!Number.isInteger(context.skillLevel)) throw new Error(`缺少技能等级输入 ${key}/${parameterKey}`);
    const value = item.levelValues?.[String(context.skillLevel)];
    if (value === undefined || value === null) throw new Error(`缺少技能等级数组值 ${key}/${parameterKey}/${context.skillLevel}`);
    return value;
  }
  if (item.valueMode === "CHARACTER_LEVEL") {
    if (!Number.isInteger(context.characterLevel)) throw new Error(`缺少角色等级输入 ${key}/${parameterKey}`);
    const value = item.levelValues?.[String(context.characterLevel)];
    if (value === undefined || value === null) throw new Error(`缺少角色等级数组值 ${key}/${parameterKey}/${context.characterLevel}`);
    return value;
  }
  if (item.valueMode === "RUNTIME_INPUT") {
    const value = context.runtime?.[parameterKey];
    if (value === undefined || value === null) throw new Error(`缺少运行输入 ${key}/${parameterKey}`);
    if (!Number.isFinite(Number(value))) throw new Error(`运行输入不是有限数 ${key}/${parameterKey}`);
    return value;
  }
  throw new Error(`未知参数模式 ${key}/${parameterKey}/${item.valueMode}`);
};
const evaluate = (key, node, context, formulaStack = []) => {
  if (!node || typeof node !== "object") throw new Error(`空表达式 ${key}`);
  if (node.nodeType === "PARAMETER") return resolveParameter(key, node.parameterKey, context);
  if (node.nodeType === "ATTRIBUTE") return getContextValue(context, attrKey(node.attributeOwner, node.attributeKey, node.attributeValueKind));
  if (node.nodeType === "FORMULA") {
    if (formulaStack.includes(node.formulaKey)) throw new Error(`公式循环 ${key}/${node.formulaKey}`);
    return evaluate(key, formula(key, node.formulaKey).expression, context, [...formulaStack, node.formulaKey]);
  }
  if (node.nodeType === "OPERATION") {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`运算不是二元 ${key}/${node.operation}`);
    const left = Number(evaluate(key, node.operands[0], context, formulaStack));
    const right = Number(evaluate(key, node.operands[1], context, formulaStack));
    if (node.operation === "ADD") return left + right;
    if (node.operation === "SUBTRACT") return left - right;
    if (node.operation === "MULTIPLY") return left * right;
    if (node.operation === "DIVIDE") return left / right;
    throw new Error(`不支持的运算 ${key}/${node.operation}`);
  }
  throw new Error(`不支持的表达式节点 ${key}/${node.nodeType}`);
};
const context = ({ skillLevel = 1, characterLevel = 1, ap = 0, totalAD = 0, bonusAD = 0, bonusHP = 0, bonusArmor = 0, bonusMR = 0, targetHp = 1000, runtime = {} } = {}) => ({
  skillLevel,
  characterLevel,
  runtime,
  attributes: {
    [attrKey("SOURCE", "ability_power", "TOTAL")]: ap,
    [attrKey("SOURCE", "attack_damage", "TOTAL")]: totalAD,
    [attrKey("SOURCE", "attack_damage", "BONUS")]: bonusAD,
    [attrKey("SOURCE", "hp", "TOTAL")]: bonusHP,
    [attrKey("SOURCE", "hp", "BONUS")]: bonusHP,
    [attrKey("SOURCE", "armor", "TOTAL")]: bonusArmor,
    [attrKey("SOURCE", "armor", "BONUS")]: bonusArmor,
    [attrKey("SOURCE", "magic_resistance", "TOTAL")]: bonusMR,
    [attrKey("SOURCE", "magic_resistance", "BONUS")]: bonusMR,
    [attrKey("TARGET", "hp", "TOTAL")]: targetHp,
  },
});
const sourceText = key => Object.values(sourceSkill(key).currentTexts || {}).map(value => value?.text || "").join("\n");

const structural = {
  formulaCount: 0,
  binaryOperations: 0,
  invalidOperations: 0,
  unknownOperations: 0,
  formulaReferenceNodes: 0,
  missingReferences: 0,
  runtimeWithoutDefault: 0,
  integerParameters: 0,
  integerValues: 0,
  invalidIntegerValues: 0,
  effectCount: 0,
  effectResultCount: 0,
  forbiddenResults: 0,
};
const runtimeRefs = [];
const parameterRefs = [];
const attributeRefs = [];
const formulaRefs = [];
const walk = (key, node, ownerFormulaKey, stack = []) => {
  if (!node || typeof node !== "object") {
    structural.missingReferences += 1;
    return;
  }
  if (node.nodeType === "PARAMETER") {
    let item;
    try { item = parameter(key, node.parameterKey); } catch { structural.missingReferences += 1; return; }
    parameterRefs.push({ key, formulaKey: ownerFormulaKey, parameterKey: node.parameterKey, valueMode: item.valueMode });
    if (item.valueMode === "RUNTIME_INPUT") {
      const noDefault = item.fixedValue === null && item.levelValues === null;
      if (noDefault) structural.runtimeWithoutDefault += 1;
      else addIssue({ type: "runtime-input-has-default", key, formulaKey: ownerFormulaKey, parameterKey: node.parameterKey, candidate: { fixedValue: item.fixedValue, levelValues: item.levelValues } });
      runtimeRefs.push({ key, formulaKey: ownerFormulaKey, parameterKey: node.parameterKey });
    }
    return;
  }
  if (node.nodeType === "ATTRIBUTE") {
    attributeRefs.push({ key, formulaKey: ownerFormulaKey, attribute: attrKey(node.attributeOwner, node.attributeKey, node.attributeValueKind) });
    return;
  }
  if (node.nodeType === "FORMULA") {
    structural.formulaReferenceNodes += 1;
    formulaRefs.push({ key, formulaKey: ownerFormulaKey, reference: node.formulaKey });
    try {
      if (!stack.includes(node.formulaKey)) walk(key, formula(key, node.formulaKey).expression, node.formulaKey, [...stack, node.formulaKey]);
    } catch { structural.missingReferences += 1; }
    return;
  }
  if (node.nodeType === "OPERATION") {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) {
      structural.invalidOperations += 1;
      addIssue({ type: "non-binary-operation", key, formulaKey: ownerFormulaKey, operation: node.operation, operands: node.operands?.length });
      return;
    }
    structural.binaryOperations += 1;
    if (!["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"].includes(node.operation)) {
      structural.unknownOperations += 1;
      addIssue({ type: "unknown-operation", key, formulaKey: ownerFormulaKey, operation: node.operation });
    }
    walk(key, node.operands[0], ownerFormulaKey, stack);
    walk(key, node.operands[1], ownerFormulaKey, stack);
    return;
  }
  addIssue({ type: "unknown-expression-node", key, formulaKey: ownerFormulaKey, nodeType: node.nodeType });
};

const levelMappings = [
  ["qiyana_q", "base_damage", "BaseDamage"],
  ["qiyana_w", "enchant_attack_speed_percent_points", "AttackSpeed", "points"],
  ["qiyana_w", "onhit_base_damage", "BaseDamage"],
  ["qiyana_w", "terrain_move_speed_percent_points", "PassiveMS", "points"],
  ["qiyana_e", "base_damage", "BaseDamage"],
  ["qiyana_r", "base_damage", "BaseDamage"],
  ["ksante_q", "base_damage", "FlatDamage"],
  ["ksante_w", "base_damage", "BaseDamage"],
  ["ksante_e", "shield_base", "ShieldBaseAmountFast"],
  ["ksante_r", "initial_damage", "BaseDamage"],
  ["ksante_r", "slam_base_damage", "SlamDownStrikeDamage"],
  ["mel_q", "explosion_count", "ExplosionCount"],
  ["mel_q", "initial_base_damage", "InitialDamage"],
  ["mel_q", "following_base_damage", "ExplosionDamage"],
  ["mel_w", "shield_base", "BaseShieldAmount"],
  ["mel_w", "reflected_damage_ratio", "BaseDamagePercent"],
  ["mel_e", "center_base_damage", "BaseDamage"],
  ["mel_e", "area_damage_base_per_second", "BaseAreaDamage"],
  ["mel_r", "passive_flat_base", "BasePassiveFlatDamage"],
  ["mel_r", "passive_stack_base", "BasePassiveStackDamage"],
  ["mel_r", "ult_flat_base", "BaseUltFlatDamage"],
  ["mel_r", "ult_stack_base", "BaseUltStackDamage"],
  ["yunara_q", "passive_base_damage", "Damage_Passive"],
  ["yunara_q", "active_base_damage", "Damage"],
  ["yunara_q", "attack_speed_percent_points", "Attack_Speed", "points"],
  ["yunara_w", "initial_base_damage", "Damage"],
  ["yunara_e", "move_speed_percent_points", "Move_Speed", "points"],
];
const levelMappingKeys = new Set(levelMappings.map(([key, parameterKey]) => `${key}/${parameterKey}`));
const sourceChecks = {
  levelParameters: 0,
  levelValues: 0,
  levelArrayFailures: [],
  fixedParameters: 0,
  fixedFailures: [],
  fixedSourceProofs: 0,
  textBindings: 0,
  textBindingFailures: [],
  textConsumerChecks: 0,
  textConsumerFailures: [],
  currentTreeCoverage: 0,
  currentTreeCoverageFailures: [],
  narrowAttributeChecks: [],
};
const levelRangeChecks = candidate.order.map(key => {
  const { slot } = keyParts(key);
  const expected = maxLevels[slot.toLowerCase()];
  const actual = candidateSkill(key).maxLevel;
  const pass = actual === expected;
  const check = { key, slot, actual, expected, pass };
  if (!pass) addIssue({ type: "skill-level-range-mismatch", ...check });
  return check;
});
const orderCheck = { actual: candidate.order, expected: expectedOrder, pass: same(candidate.order, expectedOrder) };
if (!orderCheck.pass) addIssue({ type: "candidate-order-mismatch", ...orderCheck });
const transformLevel = (raw, kind) => kind === "ms" ? toMs(raw) : kind === "points" ? toPoints(raw) : raw;
for (const [key, parameterKey, rawName, kind] of levelMappings) {
  const item = parameter(key, parameterKey);
  sourceChecks.levelParameters += 1;
  const max = candidateSkill(key).maxLevel;
  const expectedKeys = Array.from({ length: max }, (_, index) => String(index + 1));
  const actualKeys = Object.keys(item.levelValues || {}).sort((a, b) => Number(a) - Number(b));
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) addIssue({ type: "incomplete-level-map", key, parameterKey, actualKeys, expectedKeys });
  for (let level = 1; level <= max; level += 1) {
    const actual = item.levelValues?.[String(level)];
    const expected = transformLevel(rawAt(key, rawName, level), kind);
    sourceChecks.levelValues += 1;
    if (!near(actual, expected)) {
      const failure = { key, parameterKey, rawName, rawIndex: level, actual, expected };
      sourceChecks.levelArrayFailures.push(failure);
      addIssue({ type: "source-level-array-mismatch", ...failure });
    }
  }
}
for (const key of candidate.order || []) {
  const skill = candidateSkill(key);
  for (const item of skill.write.parameters) {
    if (item.valueMode === "SKILL_LEVEL" && !levelMappingKeys.has(`${key}/${item.parameterKey}`)) addIssue({ type: "unmapped-skill-level-parameter", key, parameterKey: item.parameterKey });
    if (item.valueType === "INTEGER") {
      structural.integerParameters += 1;
      const values = item.valueMode === "FIXED" ? [item.fixedValue] : item.valueMode === "SKILL_LEVEL" || item.valueMode === "CHARACTER_LEVEL" ? Object.values(item.levelValues || {}) : [];
      for (const value of values) {
        structural.integerValues += 1;
        if (!Number.isInteger(value) || value < 0) {
          structural.invalidIntegerValues += 1;
          addIssue({ type: "invalid-integer-parameter", key, parameterKey: item.parameterKey, value });
        }
      }
    }
  }
  structural.formulaCount += skill.write.formulas.length;
  for (const item of skill.write.formulas) walk(key, item.expression, item.formulaKey, [item.formulaKey]);
  structural.effectCount += skill.write.effects.length;
  for (const effect of skill.write.effects) {
    for (const result of effect.results || []) {
      structural.effectResultCount += 1;
      if (["DAMAGE", "DIRECT_HEAL", "MOMENT_EVALUATION"].includes(result.resultType)) structural.forbiddenResults += 1;
      if (result.valueRule?.value?.kind === "FORMULA") {
        try { formula(key, result.valueRule.value.formulaKey); } catch { addIssue({ type: "effect-formula-reference-missing", key, effectKey: effect.effectKey, formulaKey: result.valueRule.value.formulaKey }); }
      }
    }
  }
}
const duplicateRuntimeRefs = Array.from(new Map(runtimeRefs.map(ref => [`${ref.key}/${ref.formulaKey}/${ref.parameterKey}`, ref])).values());
const unmappedLevelParams = candidate.order.flatMap(key => candidateSkill(key).write.parameters.filter(item => item.valueMode === "SKILL_LEVEL").map(item => `${key}/${item.parameterKey}`)).filter(value => !levelMappingKeys.has(value));
if (unmappedLevelParams.length) addIssue({ type: "unmapped-level-parameters-summary", values: unmappedLevelParams });
if (structural.formulaCount !== 35) addIssue({ type: "formula-count-mismatch", actual: structural.formulaCount, expected: 35 });

const fixedChecks = [];
const fixed = (key, parameterKey, expected, source) => {
  const item = parameter(key, parameterKey);
  sourceChecks.fixedParameters += 1;
  const actual = item.fixedValue;
  const pass = item.valueMode === "FIXED" && near(actual, expected);
  const check = { key, parameterKey, actual, expected, source, pass };
  fixedChecks.push(check);
  sourceChecks.fixedSourceProofs += 1;
  if (!pass) {
    sourceChecks.fixedFailures.push(check);
    addIssue({ type: "source-fixed-value-mismatch", ...check });
  }
};
const runtimeOnly = (key, parameterKey) => {
  const item = parameter(key, parameterKey);
  if (item.valueMode !== "RUNTIME_INPUT" || item.fixedValue !== null || item.levelValues !== null) addIssue({ type: "runtime-input-shape-mismatch", key, parameterKey, candidate: item });
};

fixed("qiyana_p", "bonus_ad_ratio", rawAt("qiyana_p", "BonusADRatio"), "Qiyana/P DataValues.BonusADRatio[0]");
fixed("qiyana_p", "ap_ratio", rawAt("qiyana_p", "APRatio"), "Qiyana/P DataValues.APRatio[0]");
fixed("qiyana_p", "per_target_cooldown_ms", 25000, "Qiyana/P 当前中文正文25秒");
runtimeOnly("qiyana_p", "actual_character_level_base_damage");

fixed("qiyana_q", "bonus_ad_ratio", rawCoefficient("qiyana_q", "EnchantedDamage", 1), "Qiyana/Q EnchantedDamage.mFormulaParts[1].mCoefficient");
fixed("qiyana_q", "ice_root_duration_ms", toMs(rawAt("qiyana_q", "RootDuration")), "Qiyana/Q DataValues.RootDuration[0]");
fixed("qiyana_q", "ice_slow_percent_points", -toPoints(rawAt("qiyana_q", "SlowPotency")), "Qiyana/Q DataValues.SlowPotency[0] 取正文正百分数点");
fixed("qiyana_q", "ice_slow_duration_ms", toMs(rawAt("qiyana_q", "SlowDuration")), "Qiyana/Q DataValues.SlowDuration[0]");
fixed("qiyana_q", "wildwood_stealth_duration_ms", toMs(rawAt("qiyana_q", "StealthDuration")), "Qiyana/Q DataValues.StealthDuration[0]");
fixed("qiyana_q", "wildwood_move_speed_percent_points", toPoints(rawAt("qiyana_q", "Haste")), "Qiyana/Q DataValues.Haste[0]");
fixed("qiyana_q", "rock_execute_threshold_percent_points", toPoints(rawAt("qiyana_q", "CritThreshold")), "Qiyana/Q DataValues.CritThreshold[0]");
fixed("qiyana_q", "rock_explosion_delay_ms", toMs(rawAt("qiyana_q", "RockExplosionDelay")), "Qiyana/Q DataValues.RockExplosionDelay[0]");
runtimeOnly("qiyana_q", "rock_damage_multiplier");

fixed("qiyana_w", "onhit_ap_ratio", rawDataValueFromPart("qiyana_w", "OnHitDamage", 1), "Qiyana/W OnHitDamage.mFormulaParts[1].mDataValue");
fixed("qiyana_w", "onhit_bonus_ad_ratio", rawDataValueFromPart("qiyana_w", "OnHitDamage", 2), "Qiyana/W OnHitDamage.mFormulaParts[2].mDataValue");
fixed("qiyana_w", "terrain_distance", rawAt("qiyana_w", "Range"), "Qiyana/W DataValues.Range[0]");
fixed("qiyana_w", "dash_distance", rawAt("qiyana_w", "TravelDistance"), "Qiyana/W DataValues.TravelDistance[0]");
fixed("qiyana_w", "dash_speed", rawAt("qiyana_w", "DashSpeed"), "Qiyana/W DataValues.DashSpeed[0]");

fixed("qiyana_e", "bonus_ad_ratio", rawDataValueFromPart("qiyana_e", "Damage", 1), "Qiyana/E Damage.mFormulaParts[1].mDataValue");
fixed("qiyana_e", "dash_speed_min", rawAt("qiyana_e", "DashSpeed"), "Qiyana/E DataValues.DashSpeed[0]");
fixed("qiyana_e", "dash_speed_max", rawAt("qiyana_e", "DashSpeedMax"), "Qiyana/E DataValues.DashSpeedMax[0]");

fixed("qiyana_r", "bonus_ad_ratio", rawCoefficient("qiyana_r", "Damage", 1), "Qiyana/R Damage.mFormulaParts[1].mCoefficient");
fixed("qiyana_r", "target_max_health_ratio", rawAt("qiyana_r", "PercentHPDamageBaseRock"), "Qiyana/R DataValues.PercentHPDamageBaseRock[0]");
fixed("qiyana_r", "stun_duration_min_ms", toMs(rawAt("qiyana_r", "StunDurationMin")), "Qiyana/R DataValues.StunDurationMin[0]");
fixed("qiyana_r", "stun_duration_max_ms", toMs(rawAt("qiyana_r", "StunDuration")), "Qiyana/R DataValues.StunDuration[0]");

fixed("ksante_p", "mark_duration_ms", toMs(rawAt("ksante_p", "MarkDuration")), "KSante/P DataValues.MarkDuration[0]");
fixed("ksante_p", "flat_damage", rawAt("ksante_p", "FlatDamage"), "KSante/P DataValues.FlatDamage[0]");
fixed("ksante_p", "mark_target_max_health_ratio_min", rawAt("ksante_p", "MarkDamagePercentMin"), "KSante/P DataValues.MarkDamagePercentMin[0]");
fixed("ksante_p", "mark_target_max_health_ratio_max", rawAt("ksante_p", "MarkDamagePercentMax"), "KSante/P DataValues.MarkDamagePercentMax[0]");
runtimeOnly("ksante_p", "mark_target_max_health_ratio");

fixed("ksante_q", "bonus_armor_ratio", rawCoefficient("ksante_q", "BaseDamage", 1), "KSante/Q BaseDamage.mFormulaParts[1].mCoefficient (mStat=1，属性仍为运行输入)");
fixed("ksante_q", "bonus_magic_resistance_ratio", rawCoefficient("ksante_q", "BaseDamage", 2), "KSante/Q BaseDamage.mFormulaParts[2].mCoefficient (mStat=6，属性仍为运行输入)");
fixed("ksante_q", "slow_percent_points", toPoints(rawAt("ksante_q", "SlowPercent")), "KSante/Q DataValues.SlowPercent[0]");
fixed("ksante_q", "slow_duration_ms", toMs(rawAt("ksante_q", "SlowDuration")), "KSante/Q DataValues.SlowDuration[0]");
fixed("ksante_q", "recast_window_ms", toMs(rawAt("ksante_q", "RecastWindow")), "KSante/Q DataValues.RecastWindow[0]");
fixed("ksante_q", "stun_duration_ms", toMs(rawAt("ksante_q", "StunDuration")), "KSante/Q DataValues.StunDuration[0]");
fixed("ksante_q", "q3_knockup_duration_ms", toMs(rawAt("ksante_q", "KnockupDuration")), "KSante/Q DataValues.KnockupDuration[0]");
fixed("ksante_q", "defense_cap", rawAt("ksante_q", "DefenseCapforCooldown"), "KSante/Q DataValues.DefenseCapforCooldown[0]");
fixed("ksante_q", "cast_time_min_ms", toMs(rawAt("ksante_q", "MinCastTime")), "KSante/Q DataValues.MinCastTime[0]");
fixed("ksante_q", "cast_time_max_ms", toMs(rawAt("ksante_q", "MaxCastTime")), "KSante/Q DataValues.MaxCastTime[0]");
runtimeOnly("ksante_q", "bonus_armor_value");
runtimeOnly("ksante_q", "bonus_magic_resistance_value");

fixed("ksante_w", "target_max_health_base_ratio", rawAt("ksante_w", "MaxHealthDamage"), "KSante/W DataValues.MaxHealthDamage[0]");
fixed("ksante_w", "bonus_armor_ratio", rawDataValueFromPart("ksante_w", "TotalMaxHealthDamage", 1), "KSante/W TotalMaxHealthDamage.mFormulaParts[1].mDataValue");
fixed("ksante_w", "bonus_magic_resistance_ratio", rawDataValueFromPart("ksante_w", "TotalMaxHealthDamage", 2), "KSante/W TotalMaxHealthDamage.mFormulaParts[2].mDataValue");
fixed("ksante_w", "charge_min_duration_ms", toMs(rawAt("ksante_w", "MinChargeTime")), "KSante/W DataValues.MinChargeTime[0]");
fixed("ksante_w", "charge_max_duration_ms", toMs(rawAt("ksante_w", "MaxDuration")), "KSante/W DataValues.MaxDuration[0]");
fixed("ksante_w", "full_effect_charge_percent_points", toPoints(rawAt("ksante_w", "TimeToFullCharge")), "KSante/W DataValues.TimeToFullCharge[0]");
fixed("ksante_w", "self_damage_reduction_percent_points", toPoints(rawAt("ksante_w", "DamageReduction")), "KSante/W DataValues.DamageReduction[0]");
fixed("ksante_w", "knockback_stun_min_ms", toMs(rawAt("ksante_w", "MinKnockbackDuration")), "KSante/W DataValues.MinKnockbackDuration[0]");
fixed("ksante_w", "knockback_stun_max_ms", toMs(rawAt("ksante_w", "MaxKnockbackDuration")), "KSante/W DataValues.MaxKnockbackDuration[0]");
fixed("ksante_w", "dash_speed_base", rawAt("ksante_w", "DashSpeedBase"), "KSante/W DataValues.DashSpeedBase[0]");
fixed("ksante_w", "dash_distance_min", rawAt("ksante_w", "MinDashBase"), "KSante/W DataValues.MinDashBase[0]");
fixed("ksante_w", "dash_distance_max", rawAt("ksante_w", "MaxDashBase"), "KSante/W DataValues.MaxDashBase[0]");
runtimeOnly("ksante_w", "bonus_armor_value");
runtimeOnly("ksante_w", "bonus_magic_resistance_value");

fixed("ksante_e", "bonus_hp_ratio", rawDataValueFromPart("ksante_e", "TotalShield", 1), "KSante/E TotalShield.mFormulaParts[1].mDataValue (mStat=12/formula2，窄证)");
fixed("ksante_e", "shield_duration_ms", toMs(rawAt("ksante_e", "ShieldDuration")), "KSante/E DataValues.ShieldDuration[0]");
fixed("ksante_e", "free_dash_range", rawAt("ksante_e", "FreeTargetRangeBase"), "KSante/E DataValues.FreeTargetRangeBase[0]");
fixed("ksante_e", "free_dash_speed", rawAt("ksante_e", "FreeTargetSpeedBase"), "KSante/E DataValues.FreeTargetSpeedBase[0]");

fixed("ksante_r", "slam_bonus_hp_ratio", rawCoefficient("ksante_r", "TotalDamageSlamDown", 1), "KSante/R TotalDamageSlamDown.mFormulaParts[1].mCoefficient (mStat=12/formula2，窄证)");
const ksanteRSpell = sourceSpell("ksante_r");
if (!near(ksanteRSpell.spellCastTime, ksanteRSpell.mCastTime)) addIssue({ type: "cast-time-source-conflict", key: "ksante_r", spellCastTime: ksanteRSpell.spellCastTime, mCastTime: ksanteRSpell.mCastTime });
fixed("ksante_r", "cast_time_ms", toMs(ksanteRSpell.spellCastTime), "KSante/R spellCastTime 与 mCastTime 均为0.4秒");

fixed("mel_p", "overwhelm_duration_ms", toMs(rawAt("mel_p", "OverwhelmDuration")), "Mel/P DataValues.OverwhelmDuration[0]");
fixed("mel_p", "bonus_attack_duration_ms", toMs(rawAt("mel_p", "BonusAttackDuration")), "Mel/P DataValues.BonusAttackDuration[0]");
fixed("mel_p", "passive_bonus_missiles", rawAt("mel_p", "PassiveBonusMissiles"), "Mel/P DataValues.PassiveBonusMissiles[0]");
fixed("mel_p", "max_passive_bonus_missiles", rawAt("mel_p", "MaxPassiveBonusMissiles"), "Mel/P DataValues.MaxPassiveBonusMissiles[0]");
fixed("mel_p", "unlearned_r_passive_flat_damage", rawAt("mel_r", "BasePassiveFlatDamage", 0), "Mel/R 零级索引0 BasePassiveFlatDamage");
fixed("mel_p", "unlearned_r_passive_stack_damage", rawAt("mel_r", "BasePassiveStackDamage", 0), "Mel/R 零级索引0 BasePassiveStackDamage");
fixed("mel_p", "passive_missile_ap_ratio", rawCoefficient("mel_p", "PassiveBonusMissileDamage", 1), "Mel/P PassiveBonusMissileDamage.mFormulaParts[1].mCoefficient");
runtimeOnly("mel_p", "overwhelm_stack_count");
runtimeOnly("mel_p", "actual_character_level_passive_missile_base_damage");

fixed("mel_q", "initial_ap_ratio", rawCoefficient("mel_q", "InitialExplosionDamage", 1), "Mel/Q InitialExplosionDamage.mFormulaParts[1].mCoefficient");
fixed("mel_q", "following_ap_ratio", rawCoefficient("mel_q", "TotalExplosionDamage", 1), "Mel/Q TotalExplosionDamage.mFormulaParts[1].mCoefficient");
fixed("mel_q", "channel_duration_ms", toMs(rawAt("mel_q", "ChannelDuration")), "Mel/Q DataValues.ChannelDuration[0]");
const melQAll = rawCalc("mel_q", "AllDamageHit");
const melQUnitPart = melQAll.mFormulaParts?.[1]?.mPart2?.mSubparts?.find(part => typeof part.mNumber === "number" && part.mNumber < 0);
if (!melQUnitPart) addIssue({ type: "source-all-damage-unit-subpart-missing", key: "mel_q" });
fixed("mel_q", "unit_count", melQUnitPart ? -melQUnitPart.mNumber : Number.NaN, "Mel/Q AllDamageHit 第二项 ExplosionCount−1");

fixed("mel_w", "shield_duration_ms", toMs(rawAt("mel_w", "Duration")), "Mel/W DataValues.Duration[0]");
fixed("mel_w", "shield_ap_ratio", rawCoefficient("mel_w", "ShieldAmount", 1), "Mel/W ShieldAmount.mFormulaParts[1].mCoefficient");
fixed("mel_w", "move_speed_percent_points", toPoints(rawAt("mel_w", "MoveSpeed")), "Mel/W DataValues.MoveSpeed[0]");
fixed("mel_w", "move_speed_duration_ms", toMs(rawAt("mel_w", "MoveSpeedDuration")), "Mel/W DataValues.MoveSpeedDuration[0]");
fixed("mel_w", "physical_to_magic_reduction_percent_points", toPoints(rawAt("mel_w", "PhysDamageMod")), "Mel/W DataValues.PhysDamageMod[0]");
fixed("mel_w", "reflected_damage_ap_ratio", rawCoefficient("mel_w", "DamagePercent", 1), "Mel/W DamagePercent.mFormulaParts[1].mCoefficient");
fixed("mel_w", "physical_to_magic_multiplier", 1 - rawAt("mel_w", "PhysDamageMod"), "Mel/W 物理来源反射倍率=1-PhysDamageMod[0]");
runtimeOnly("mel_w", "actual_reflected_source_damage");

fixed("mel_e", "center_ap_ratio", rawCoefficient("mel_e", "Damage", 1), "Mel/E Damage.mFormulaParts[1].mCoefficient");
fixed("mel_e", "area_ap_ratio", rawDataValueFromPart("mel_e", "AreaDamagePerSecond", 1), "Mel/E AreaDamagePerSecond.mFormulaParts[1].mDataValue");
fixed("mel_e", "root_duration_ms", toMs(rawAt("mel_e", "RootDuration")), "Mel/E DataValues.RootDuration[0]");
fixed("mel_e", "area_slow_percent_points", toPoints(rawAt("mel_e", "AreaSlowAmount")), "Mel/E DataValues.AreaSlowAmount[0]");
fixed("mel_e", "area_slow_duration_ms", toMs(rawAt("mel_e", "AreaSlowDuration")), "Mel/E DataValues.AreaSlowDuration[0]");
fixed("mel_e", "area_dot_duration_ms", toMs(rawAt("mel_e", "DoTDuration")), "Mel/E DataValues.DoTDuration[0]");
fixed("mel_e", "area_ticks_per_second", rawAt("mel_e", "AreaTicksPerSecond"), "Mel/E DataValues.AreaTicksPerSecond[0]");
fixed("mel_e", "max_area_radius", rawAt("mel_e", "MaxAreaRadius"), "Mel/E DataValues.MaxAreaRadius[0]");
fixed("mel_e", "area_expand_duration_ms", toMs(rawAt("mel_e", "TimeToMaxRadius")), "Mel/E DataValues.TimeToMaxRadius[0]");

fixed("mel_r", "passive_flat_ap_ratio", rawCoefficient("mel_r", "PassiveFlatDamage", 1), "Mel/R PassiveFlatDamage.mFormulaParts[1].mCoefficient");
fixed("mel_r", "passive_stack_ap_ratio", rawCoefficient("mel_r", "PassiveStackDamage", 1), "Mel/R PassiveStackDamage.mFormulaParts[1].mCoefficient");
fixed("mel_r", "ult_flat_ap_ratio", rawCoefficient("mel_r", "UltFlatDamage", 1), "Mel/R UltFlatDamage.mFormulaParts[1].mCoefficient");
fixed("mel_r", "ult_stack_ap_ratio", rawCoefficient("mel_r", "UltStackDamage", 1), "Mel/R UltStackDamage.mFormulaParts[1].mCoefficient");
fixed("mel_r", "disintegrate_delay_ms", toMs(rawAt("mel_r", "DisintegrateDelay")), "Mel/R DataValues.DisintegrateDelay[0]");

fixed("yunara_p", "critical_extra_damage_base_ratio", rawNumber("yunara_p", "Calc_Damage_Amp", 0), "Yunara/P Calc_Damage_Amp.mFormulaParts[0].mNumber");
fixed("yunara_p", "critical_extra_damage_ap_ratio", rawCoefficient("yunara_p", "Calc_Damage_Amp", 1), "Yunara/P Calc_Damage_Amp.mFormulaParts[1].mCoefficient");
runtimeOnly("yunara_p", "actual_critical_damage_base");

fixed("yunara_q", "resource_max", rawAt("yunara_q", "Resource_Max"), "Yunara/Q DataValues.Resource_Max[0]");
fixed("yunara_q", "resource_champion_gain", rawAt("yunara_q", "Resource_Champion"), "Yunara/Q DataValues.Resource_Champion[0]");
fixed("yunara_q", "resource_duration_ms", toMs(rawAt("yunara_q", "Resource_Duration")), "Yunara/Q DataValues.Resource_Duration[0]");
fixed("yunara_q", "resource_loss_interval_ms", toMs(rawAt("yunara_q", "Resource_Loss_Interval")), "Yunara/Q DataValues.Resource_Loss_Interval[0]");
fixed("yunara_q", "resource_loss_amount", rawAt("yunara_q", "Resource_Loss"), "Yunara/Q DataValues.Resource_Loss[0]");
fixed("yunara_q", "active_resource_cost", rawAt("yunara_q", "Resource_Max"), "Yunara/Q 当前主动消耗8层与Resource_Max[0]");
fixed("yunara_q", "active_buff_duration_ms", toMs(rawAt("yunara_q", "Buff_Duration")), "Yunara/Q DataValues.Buff_Duration[0]");
fixed("yunara_q", "passive_ap_ratio", rawCoefficient("yunara_q", "Calc_Passive_Damage", 1), "Yunara/Q Calc_Passive_Damage.mFormulaParts[1].mCoefficient");
fixed("yunara_q", "active_ap_ratio", rawCoefficient("yunara_q", "Calc_Damage", 1), "Yunara/Q Calc_Damage.mFormulaParts[1].mCoefficient");

fixed("yunara_w", "bonus_ad_ratio", rawDataValueFromPart("yunara_w", "Calc_Damage_Initial", 1), "Yunara/W Calc_Damage_Initial.mFormulaParts[1].mDataValue");
fixed("yunara_w", "ap_ratio", rawDataValueFromPart("yunara_w", "Calc_Damage_Initial", 2), "Yunara/W Calc_Damage_Initial.mFormulaParts[2].mDataValue");
fixed("yunara_w", "dps_modifier", rawMultiplierDataValue("yunara_w", "Calc_Damage_Per_Second"), "Yunara/W Calc_Damage_Per_Second.mMultiplier.mDataValue");
fixed("yunara_w", "slow_percent_points", toPoints(rawAt("yunara_w", "Slow_Amount")), "Yunara/W DataValues.Slow_Amount[0]");
fixed("yunara_w", "slow_duration_ms", toMs(rawAt("yunara_w", "Slow_Duration")), "Yunara/W DataValues.Slow_Duration[0]");
fixed("yunara_w", "linger_duration_ms", toMs(rawAt("yunara_w", "Linger_Duration")), "Yunara/W DataValues.Linger_Duration[0]");
fixed("yunara_w", "cast_time_base_ms", toMs(rawAt("yunara_w", "Cast_Time_Base")), "Yunara/W DataValues.Cast_Time_Base[0]");
fixed("yunara_w", "cast_time_min_ms", toMs(rawAt("yunara_w", "Cast_Time_Min")), "Yunara/W DataValues.Cast_Time_Min[0]");
fixed("yunara_w", "cast_time_attack_speed_cap_percent_points", rawAt("yunara_w", "Cast_Time_Attack_Speed_Cap"), "Yunara/W DataValues.Cast_Time_Attack_Speed_Cap[0]");

fixed("yunara_e", "enemy_directed_move_speed_multiplier", rawMultiplierDataValue("yunara_e", "Calc_Move_Speed_Enhanced"), "Yunara/E Calc_Move_Speed_Enhanced.mMultiplier.mDataValue");
fixed("yunara_e", "buff_duration_ms", toMs(rawAt("yunara_e", "Buff_Duration")), "Yunara/E DataValues.Buff_Duration[0]");

const textTokens = {
  qiyana_p: ["FinalDamage", "25秒"],
  qiyana_q: ["VanillaDamage", "TremorDamage", "SlowDuration", "CritThreshold", "Haste"],
  qiyana_w: ["AttackSpeed", "OnHitDamage", "PassiveMS"],
  qiyana_e: ["Damage"],
  qiyana_r: ["Damage", "MissingHealthDamageRock", "StunDuration", "最大生命值"],
  ksante_p: ["FlatDamage", "PercentHealthDamage"],
  ksante_q: ["BaseDamage", "SlowDuration", "StunDuration", "DefenseCapforCooldown"],
  ksante_w: ["BaseDamage", "TotalMaxHealthDamage", "DamageReduction", "TimeToFullCharge"],
  ksante_e: ["ShieldDuration", "TotalShield"],
  ksante_r: ["BaseDamage", "TotalDamageSlamDown", "再次"],
  mel_p: ["OverwhelmDuration", "PassiveFlatDamage", "PassiveStackDamage", "PassiveBonusMissiles", "PassiveBonusMissileDamage", "MaxPassiveBonusMissiles"],
  mel_q: ["ExplosionCount", "InitialExplosionDamage", "TotalExplosionDamage", "AllDamageHit"],
  mel_w: ["Duration", "ShieldAmount", "MoveSpeedDuration", "MoveSpeed", "DamagePercent", "PhysDamageMod"],
  mel_e: ["RootDuration", "Damage", "AreaSlowAmount", "AreaDamagePerSecond", "MinionModTooltip"],
  mel_r: ["PassiveFlatDamage", "PassiveStackDamage", "UltFlatDamage", "UltStackDamage"],
  yunara_p: ["Calc_Damage_Amp"],
  yunara_q: ["Calc_Passive_Damage", "Calc_Attack_Speed", "Calc_Damage"],
  yunara_w: ["Calc_Damage_Initial", "Calc_Damage_Per_Second", "Calc_Slow", "Slow_Duration"],
  yunara_e: ["Calc_Move_Speed", "Calc_Move_Speed_Enhanced"],
  yunara_r: ["Buff_Duration", "基础技能获得升级"],
};
for (const key of candidate.order) {
  const actualText = candidateSkill(key).source?.currentBoundText;
  const expectedText = sourceSkill(key).currentTexts;
  sourceChecks.textBindings += 1;
  if (!same(actualText, expectedText)) {
    const failure = { key, actual: actualText, expected: expectedText };
    sourceChecks.textBindingFailures.push(failure);
    addIssue({ type: "current-text-binding-mismatch", ...failure });
  }
  for (const token of textTokens[key] || []) {
    sourceChecks.textConsumerChecks += 1;
    if (!sourceText(key).includes(token)) {
      const failure = { key, token };
      sourceChecks.textConsumerFailures.push(failure);
      addIssue({ type: "current-text-token-missing", ...failure });
    }
  }
}

const coverage = {
  qiyana_p: { FinalDamage: "selected", ICD: "excluded_unconsumed", "{222614ec}": "excluded_unconsumed" },
  qiyana_q: { EnchantedDamage: "selected", VanillaDamage: "selected", TremorDamage: "selected", "{7dc40c72}": "excluded_unconsumed", FalloffDamage: "excluded_extra_target", EnchantedFalloff: "excluded_extra_target", VanillaFalloff: "excluded_extra_target" },
  qiyana_w: { CleaveDamage: "excluded_unconsumed", TremorDamage: "excluded_unconsumed", OnHitDamage: "selected" },
  qiyana_e: { Damage: "selected" },
  qiyana_r: { Damage: "selected", MissingHealthDamageRock: "represented_parameter", MonsterCap: "excluded_monster" },
  ksante_p: { "{281dd874}": "excluded_unconsumed", PercentHealthDamage: "runtime_range", MaxHealthDamagePercent: "excluded_transformation" },
  ksante_q: { BaseDamage: "selected", "{9c9367bc}": "excluded_unconsumed" },
  ksante_w: { TotalMaxHealthDamage: "selected" },
  ksante_e: { TotalShield: "selected" },
  ksante_r: { TotalDamageSlamDown: "selected" },
  mel_p: { PassiveBonusMissileDamage: "selected" },
  mel_q: { TotalExplosionDamage: "selected", AllDamageHit: "selected_tooltip_only", MonsterModTooltip: "excluded_monster", InitialExplosionDamage: "selected" },
  mel_w: { DamagePercent: "represented_parameter", ShieldAmount: "selected" },
  mel_e: { Damage: "selected", AreaDamagePerSecond: "selected", MinionModTooltip: "excluded_monster" },
  mel_r: { PassiveStackDamage: "selected", PassiveFlatDamage: "selected", UltStackDamage: "selected", UltFlatDamage: "selected", MinionModTooltip: "excluded_monster" },
  yunara_p: { Calc_Damage_Amp: "selected" },
  yunara_q: { Calc_Passive_Damage: "selected", Calc_Attack_Speed: "represented_parameter", Calc_Damage: "selected", Calc_Damage_Spread: "excluded_extra_target", Calc_Minion_Execute_Threshold: "excluded_monster", Calc_Minion_Execute_Amp: "excluded_monster" },
  yunara_w: { Calc_Damage_Initial: "selected", Calc_Damage_Per_Second: "selected_tooltip_only", "{669adf33}": "excluded_monster", Calc_Slow: "represented_parameter", Calc_Minion_Damage_Mod: "excluded_monster" },
  yunara_e: { Calc_Move_Speed: "selected_parameter", Calc_Move_Speed_Enhanced: "selected" },
  yunara_r: { Calc_RW_Damage: "excluded_transformation", Calc_RW_Slow_Amount: "excluded_transformation", "{42964db5}": "excluded_transformation", Calc_RW_Cooldown_Reduction: "excluded_transformation" },
};
for (const key of candidate.order) {
  const actualNames = Object.keys(sourceSpell(key).mSpellCalculations || {}).sort();
  const expectedNames = Object.keys(coverage[key] || {}).sort();
  if (!same(actualNames, expectedNames)) {
    const failure = { key, actualNames, expectedNames };
    sourceChecks.currentTreeCoverageFailures.push(failure);
    addIssue({ type: "current-tree-coverage-mismatch", ...failure });
  }
  sourceChecks.currentTreeCoverage += actualNames.length;
}

const formulaExpected = (key, formulaKey, c) => {
  const level = c.skillLevel;
  const ap = Number(c.attributes[attrKey("SOURCE", "ability_power", "TOTAL")]);
  const bonusAD = Number(c.attributes[attrKey("SOURCE", "attack_damage", "BONUS")]);
  const bonusHP = Number(c.attributes[attrKey("SOURCE", "hp", "BONUS")]);
  const targetHp = Number(c.attributes[attrKey("TARGET", "hp", "TOTAL")]);
  const runtime = c.runtime || {};
  if (key === "qiyana_p") return runtime.actual_character_level_base_damage + rawAt(key, "BonusADRatio") * bonusAD + rawAt(key, "APRatio") * ap;
  if (key === "qiyana_q") {
    const baseName = formulaKey === "vanilla_physical_damage" ? "VanillaBase" : "BaseDamage";
    const base = rawAt(key, baseName, level);
    const ad = rawCoefficient(key, "VanillaDamage", 1);
    if (formulaKey === "rock_bonus_physical_damage") return runtime.rock_damage_multiplier * (rawAt(key, "BaseDamage", level) + rawCoefficient(key, "EnchantedDamage", 1) * bonusAD);
    return base + ad * bonusAD;
  }
  if (key === "qiyana_w") return rawAt(key, "BaseDamage", level) + rawDataValueFromPart(key, "OnHitDamage", 1) * ap + rawDataValueFromPart(key, "OnHitDamage", 2) * bonusAD;
  if (key === "qiyana_e") return rawAt(key, "BaseDamage", level) + rawDataValueFromPart(key, "Damage", 1) * bonusAD;
  if (key === "qiyana_r") return rawAt(key, "BaseDamage", level) + rawCoefficient(key, "Damage", 1) * bonusAD + rawAt(key, "PercentHPDamageBaseRock") * targetHp;
  if (key === "ksante_p") return rawAt(key, "FlatDamage") + runtime.mark_target_max_health_ratio * targetHp;
  if (key === "ksante_q") return rawAt(key, "FlatDamage", level) + rawCoefficient(key, "BaseDamage", 1) * runtime.bonus_armor_value + rawCoefficient(key, "BaseDamage", 2) * runtime.bonus_magic_resistance_value;
  if (key === "ksante_w") {
    const ratio = rawAt(key, "MaxHealthDamage") + rawDataValueFromPart(key, "TotalMaxHealthDamage", 1) * runtime.bonus_armor_value + rawDataValueFromPart(key, "TotalMaxHealthDamage", 2) * runtime.bonus_magic_resistance_value;
    if (formulaKey === "target_max_health_damage_ratio") return ratio;
    return rawAt(key, "BaseDamage", level) + ratio * targetHp;
  }
  if (key === "ksante_e") return rawAt(key, "ShieldBaseAmountFast", level) + rawDataValueFromPart(key, "TotalShield", 1) * bonusHP;
  if (key === "ksante_r") {
    if (formulaKey === "initial_physical_damage") return rawAt(key, "BaseDamage", level);
    return rawAt(key, "SlamDownStrikeDamage", level) + rawCoefficient(key, "TotalDamageSlamDown", 1) * bonusHP;
  }
  if (key === "mel_p") {
    if (formulaKey === "overwhelm_threshold_damage") return rawAt("mel_r", "BasePassiveFlatDamage", 0) + rawAt("mel_r", "BasePassiveStackDamage", 0) * runtime.overwhelm_stack_count;
    return runtime.actual_character_level_passive_missile_base_damage + rawCoefficient(key, "PassiveBonusMissileDamage", 1) * ap;
  }
  if (key === "mel_q") {
    const initial = rawAt(key, "InitialDamage", level) + rawCoefficient(key, "InitialExplosionDamage", 1) * ap;
    const following = rawAt(key, "ExplosionDamage", level) + rawCoefficient(key, "TotalExplosionDamage", 1) * ap;
    if (formulaKey === "initial_explosion_magic_damage") return initial;
    if (formulaKey === "following_explosion_magic_damage") return following;
    return initial + (rawAt(key, "ExplosionCount", level) + melQUnitPart.mNumber) * following;
  }
  if (key === "mel_w") {
    if (formulaKey === "self_shield_amount") return rawAt(key, "BaseShieldAmount", level) + rawCoefficient(key, "ShieldAmount", 1) * ap;
    const reflected = (rawAt(key, "BaseDamagePercent", level) + rawCoefficient(key, "DamagePercent", 1) * ap) * runtime.actual_reflected_source_damage;
    if (formulaKey === "reflected_physical_magic_damage") return reflected * (1 - rawAt(key, "PhysDamageMod"));
    return reflected;
  }
  if (key === "mel_e") {
    if (formulaKey === "center_magic_damage") return rawAt(key, "BaseDamage", level) + rawCoefficient(key, "Damage", 1) * ap;
    return rawAt(key, "BaseAreaDamage", level) + rawDataValueFromPart(key, "AreaDamagePerSecond", 1) * ap;
  }
  if (key === "mel_r") {
    const sourceMap = { passive_flat_damage: ["BasePassiveFlatDamage", "PassiveFlatDamage"], passive_stack_damage: ["BasePassiveStackDamage", "PassiveStackDamage"], ult_flat_damage: ["BaseUltFlatDamage", "UltFlatDamage"], ult_stack_damage: ["BaseUltStackDamage", "UltStackDamage"] };
    const [dataName, calcName] = sourceMap[formulaKey];
    return rawAt(key, dataName, level) + rawCoefficient(key, calcName, 1) * ap;
  }
  if (key === "yunara_p") {
    const ratio = rawNumber(key, "Calc_Damage_Amp", 0) + rawCoefficient(key, "Calc_Damage_Amp", 1) * ap;
    if (formulaKey === "critical_extra_damage_ratio") return ratio;
    return ratio * runtime.actual_critical_damage_base;
  }
  if (key === "yunara_q") {
    const dataName = formulaKey === "passive_magic_damage" ? "Damage_Passive" : "Damage";
    return rawAt(key, dataName, level) + rawCoefficient(key, formulaKey === "passive_magic_damage" ? "Calc_Passive_Damage" : "Calc_Damage", 1) * ap;
  }
  if (key === "yunara_w") {
    const initial = rawAt(key, "Damage", level) + rawDataValueFromPart(key, "Calc_Damage_Initial", 1) * bonusAD + rawDataValueFromPart(key, "Calc_Damage_Initial", 2) * ap;
    if (formulaKey === "initial_magic_damage") return initial;
    return rawMultiplierDataValue(key, "Calc_Damage_Per_Second") * initial;
  }
  if (key === "yunara_e") return rawMultiplierDataValue(key, "Calc_Move_Speed_Enhanced") * rawAt(key, "Move_Speed", level) * 100;
  throw new Error(`缺少独立原始期望 ${key}/${formulaKey}`);
};

const qiyanaPBase = rawPart("qiyana_p", "FinalDamage", 0).mLevel1Value;
const qiyanaRockMultiplier = rawMultiplierLevel1("qiyana_q", "TremorDamage");
const melMissileStart = rawPart("mel_p", "PassiveBonusMissileDamage", 0).mStartValue;
const melMissileEnd = rawPart("mel_p", "PassiveBonusMissileDamage", 0).mEndValue;
const ksantePMin = rawAt("ksante_p", "MarkDamagePercentMin");
const ksantePMax = rawAt("ksante_p", "MarkDamagePercentMax");
const scenarios = {
  qiyana_p: { passive_physical_damage: [context({ characterLevel: 1, ap: 50, bonusAD: 40, runtime: { actual_character_level_base_damage: qiyanaPBase } }), context({ characterLevel: 18, ap: 400, bonusAD: 300, runtime: { actual_character_level_base_damage: qiyanaPBase } })] },
  qiyana_q: {
    vanilla_physical_damage: [context({ skillLevel: 1, bonusAD: 50 }), context({ skillLevel: 5, bonusAD: 350 })],
    enchanted_physical_damage: [context({ skillLevel: 1, bonusAD: 50 }), context({ skillLevel: 5, bonusAD: 350 })],
    rock_bonus_physical_damage: [context({ skillLevel: 1, bonusAD: 50, characterLevel: 1, runtime: { rock_damage_multiplier: qiyanaRockMultiplier } }), context({ skillLevel: 5, bonusAD: 350, characterLevel: 18, runtime: { rock_damage_multiplier: qiyanaRockMultiplier } })],
  },
  qiyana_w: { onhit_magic_damage: [context({ skillLevel: 1, ap: 50, bonusAD: 40 }), context({ skillLevel: 5, ap: 400, bonusAD: 300 })] },
  qiyana_e: { physical_damage: [context({ skillLevel: 1, bonusAD: 50 }), context({ skillLevel: 5, bonusAD: 350 })] },
  qiyana_r: { environment_explosion_physical_damage: [context({ skillLevel: 1, bonusAD: 50, targetHp: 800 }), context({ skillLevel: 3, bonusAD: 350, targetHp: 2500 })] },
  ksante_p: { marked_attack_physical_damage: [context({ targetHp: 800, runtime: { mark_target_max_health_ratio: ksantePMin } }), context({ targetHp: 2500, runtime: { mark_target_max_health_ratio: ksantePMax } })] },
  ksante_q: { physical_damage: [context({ skillLevel: 1, runtime: { bonus_armor_value: 30, bonus_magic_resistance_value: 40 } }), context({ skillLevel: 5, runtime: { bonus_armor_value: 180, bonus_magic_resistance_value: 120 } })] },
  ksante_w: {
    target_max_health_damage_ratio: [context({ skillLevel: 1, runtime: { bonus_armor_value: 30, bonus_magic_resistance_value: 40 } }), context({ skillLevel: 5, runtime: { bonus_armor_value: 180, bonus_magic_resistance_value: 120 } })],
    charge_physical_damage: [context({ skillLevel: 1, targetHp: 800, runtime: { bonus_armor_value: 30, bonus_magic_resistance_value: 40 } }), context({ skillLevel: 5, targetHp: 2500, runtime: { bonus_armor_value: 180, bonus_magic_resistance_value: 120 } })],
  },
  ksante_e: { self_shield_amount: [context({ skillLevel: 1, bonusHP: 200 }), context({ skillLevel: 5, bonusHP: 2000 })] },
  ksante_r: {
    initial_physical_damage: [context({ skillLevel: 1 }), context({ skillLevel: 3 })],
    slam_down_physical_damage: [context({ skillLevel: 1, bonusHP: 200 }), context({ skillLevel: 3, bonusHP: 2000 })],
  },
  mel_p: {
    overwhelm_threshold_damage: [context({ runtime: { overwhelm_stack_count: 0 } }), context({ runtime: { overwhelm_stack_count: 9 } })],
    passive_bonus_missile_damage: [context({ characterLevel: 1, ap: 50, runtime: { actual_character_level_passive_missile_base_damage: melMissileStart } }), context({ characterLevel: 18, ap: 400, runtime: { actual_character_level_passive_missile_base_damage: melMissileEnd } })],
  },
  mel_q: {
    initial_explosion_magic_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
    following_explosion_magic_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
    all_explosion_magic_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
  },
  mel_w: {
    self_shield_amount: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
    reflected_magic_damage: [context({ skillLevel: 1, ap: 0, runtime: { actual_reflected_source_damage: 100 } }), context({ skillLevel: 5, ap: 400, runtime: { actual_reflected_source_damage: 1000 } })],
    reflected_physical_magic_damage: [context({ skillLevel: 1, ap: 0, runtime: { actual_reflected_source_damage: 100 } }), context({ skillLevel: 5, ap: 400, runtime: { actual_reflected_source_damage: 1000 } })],
  },
  mel_e: {
    center_magic_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
    area_damage_per_second: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
  },
  mel_r: {
    passive_flat_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 3, ap: 400 })],
    passive_stack_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 3, ap: 400 })],
    ult_flat_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 3, ap: 400 })],
    ult_stack_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 3, ap: 400 })],
  },
  yunara_p: {
    critical_extra_damage_ratio: [context({ ap: 0 }), context({ ap: 400 })],
    critical_extra_magic_damage: [context({ ap: 0, runtime: { actual_critical_damage_base: 100 } }), context({ ap: 400, runtime: { actual_critical_damage_base: 1000 } })],
  },
  yunara_q: {
    passive_magic_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
    active_magic_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
  },
  yunara_w: {
    initial_magic_damage: [context({ skillLevel: 1, ap: 50, bonusAD: 40 }), context({ skillLevel: 5, ap: 400, bonusAD: 300 })],
    damage_per_second: [context({ skillLevel: 1, ap: 50, bonusAD: 40 }), context({ skillLevel: 5, ap: 400, bonusAD: 300 })],
  },
  yunara_e: { enemy_directed_move_speed: [context({ skillLevel: 1 }), context({ skillLevel: 5 })] },
  yunara_r: {},
};

const formulaResults = [];
let caseCount = 0;
for (const key of candidate.order) {
  for (const item of candidateSkill(key).write.formulas) {
    const cases = scenarios[key]?.[item.formulaKey];
    if (!Array.isArray(cases) || cases.length < 2) {
      addIssue({ type: "formula-scenarios-less-than-two", key, formulaKey: item.formulaKey, count: cases?.length || 0 });
      continue;
    }
    for (let index = 0; index < cases.length; index += 1) {
      const c = cases[index];
      let actual;
      let expected;
      let evaluationError = null;
      try { actual = evaluate(key, item.expression, c); } catch (error) { evaluationError = String(error.message || error); }
      try { expected = formulaExpected(key, item.formulaKey, c); } catch (error) { evaluationError = evaluationError || `期望侧：${String(error.message || error)}`; }
      const pass = !evaluationError && near(actual, expected);
      const result = { skillKey: key, formulaKey: item.formulaKey, caseIndex: index + 1, skillLevel: c.skillLevel, characterLevel: c.characterLevel, actual, expected, pass, evaluationError };
      formulaResults.push(result);
      if (!pass) addIssue({ type: "formula-source-mismatch", ...result });
      caseCount += 1;
    }
  }
}

const missingInputChecks = [];
for (const ref of duplicateRuntimeRefs) {
  const valid = scenarios[ref.key]?.[ref.formulaKey]?.[0];
  if (!valid) {
    addIssue({ type: "runtime-reference-without-scenario", ...ref });
    continue;
  }
  const missingRuntime = { ...(valid.runtime || {}) };
  delete missingRuntime[ref.parameterKey];
  let rejected = false;
  try { evaluate(ref.key, formula(ref.key, ref.formulaKey).expression, { ...valid, runtime: missingRuntime }); } catch { rejected = true; }
  const check = { ...ref, rejected };
  missingInputChecks.push(check);
  if (!rejected) addIssue({ type: "missing-runtime-input-not-rejected", ...ref });
}

const allowedAttributes = new Set([
  "SOURCE.ability_power.TOTAL",
  "SOURCE.attack_damage.BONUS",
  "SOURCE.hp.BONUS",
  "TARGET.hp.TOTAL",
]);
for (const ref of attributeRefs) {
  if (!allowedAttributes.has(ref.attribute)) addIssue({ type: "unapproved-attribute-selector", ...ref });
}
const narrowAttributeChecks = [
  { key: "ksante_e", formulaKey: "self_shield_amount", attribute: "SOURCE.hp.BONUS", rawMStat: 12, rawMStatFormula: 2, status: "窄证允许，未推广全部属性枚举" },
  { key: "ksante_r", formulaKey: "slam_down_physical_damage", attribute: "SOURCE.hp.BONUS", rawMStat: 12, rawMStatFormula: 2, status: "窄证允许，未推广全部属性枚举" },
];
sourceChecks.narrowAttributeChecks = narrowAttributeChecks;
for (const check of narrowAttributeChecks) {
  const found = attributeRefs.some(ref => ref.key === check.key && ref.formulaKey === check.formulaKey && ref.attribute === check.attribute);
  if (!found) addIssue({ type: "narrow-attribute-selector-missing", ...check });
}
const unprovedArmorMappings = [
  { key: "ksante_q", parameterKeys: ["bonus_armor_value", "bonus_magic_resistance_value"], rawMStat: [1, 6], status: "保持运行输入；未把mStat1/6 formula2推广为全局属性映射" },
  { key: "ksante_w", parameterKeys: ["bonus_armor_value", "bonus_magic_resistance_value"], rawMStat: [1, 6], status: "保持运行输入；未把mStat1/6 formula2推广为全局属性映射" },
];
for (const check of unprovedArmorMappings) {
  for (const parameterKey of check.parameterKeys) {
    const item = parameter(check.key, parameterKey);
    if (item.valueMode !== "RUNTIME_INPUT") addIssue({ type: "unproved-armor-mapping-defaulted", ...check, parameterKey, candidate: item });
  }
}
sourceChecks.unprovedAttributeMappings = unprovedArmorMappings;

const effectAudit = {
  candidateEffectCount: structural.effectCount,
  candidateEffectResultCount: structural.effectResultCount,
  finalMultiplierChecks: 0,
  ratioFlatAddChecks: 0,
  status: structural.effectCount === 0 ? "无新增效果，最终倍率与属性平加区不适用；仅做空集合检查" : "按候选效果逐项检查",
  checks: [],
};
for (const key of candidate.order) {
  for (const effect of candidateSkill(key).write.effects) {
    for (const result of effect.results || []) {
      const multiplier = result.valueRule?.fixedMultiplier;
      if (multiplier !== undefined) {
        const check = { key, effectKey: effect.effectKey, resultKey: result.resultKey, fixedMultiplier: multiplier, finite: Number.isFinite(Number(multiplier)) };
        effectAudit.finalMultiplierChecks += 1;
        effectAudit.checks.push(check);
        if (!check.finite) addIssue({ type: "invalid-effect-final-multiplier", ...check });
      }
      if (result.detail?.modifierZoneKey === "attribute_flat_add") effectAudit.ratioFlatAddChecks += 1;
      if (result.valueRule?.value?.kind === "ATTRIBUTE" && result.detail?.modifierZoneKey !== "attribute_flat_add") addIssue({ type: "ratio-effect-zone-not-flat-add", key, effectKey: effect.effectKey, resultKey: result.resultKey, modifierZoneKey: result.detail?.modifierZoneKey });
    }
  }
}

const explicitCandidateGaps = [];
const ksanteRInitialFormula = candidateSkill("ksante_r").write.formulas.some(item => {
  const refs = [];
  const collect = node => {
    if (!node) return;
    if (node.nodeType === "PARAMETER") refs.push(node.parameterKey);
    else if (node.nodeType === "OPERATION") node.operands.forEach(collect);
    else if (node.nodeType === "FORMULA") refs.push(`FORMULA:${node.formulaKey}`);
  };
  collect(item.expression);
  return refs.includes("initial_damage");
});
if (!ksanteRInitialFormula) {
  const gap = {
    type: "current-consumer-without-formula",
    key: "ksante_r",
    field: "initial_damage",
    evidence: "冻结当前文本消费@BaseDamage@作为变形前首次伤害；候选只有initial_damage参数，没有引用它的首段公式或效果。",
    source: "KSante/R DataValues.BaseDamage[1..3] = 80/115/150；当前正文明确‘造成@BaseDamage@物理伤害’。",
  };
  explicitCandidateGaps.push(gap);
  addIssue(gap);
}
const melWRawDamagePercentParts = rawCalc("mel_w", "DamagePercent").mFormulaParts || [];
const melWHasApPart = melWRawDamagePercentParts.some(part => typeof part.mCoefficient === "number" && near(part.mCoefficient, 0.0005));
const melWCandidateParameterKeys = candidateSkill("mel_w").write.parameters.map(item => item.parameterKey);
const melWCandidateUsesApRatio = melWCandidateParameterKeys.includes("reflected_damage_ap_ratio");
if (melWHasApPart && !melWCandidateUsesApRatio) {
  const gap = {
    type: "source-coefficient-omitted",
    key: "mel_w",
    field: "reflected_magic_damage",
    source: "Mel/W DamagePercent.mFormulaParts[1].mCoefficient = 0.0005000000237487257，mStat省略按窄证为来源总法强。",
    candidate: "write.parameters没有reflected_damage_ap_ratio，公式只有reflected_damage_ratio×actual_reflected_source_damage。",
    impact: "法强大于0时反射比例缺少+0.0005×法强；第二个场景会出现数学不一致。",
  };
  explicitCandidateGaps.push(gap);
  addIssue(gap);
}
const yunaraPFormula = formula("yunara_p", "critical_extra_magic_damage");
const yunaraPHasFormulaRatioReference = (() => {
  let hasFormulaRatio = false;
  let hasParameterRatio = false;
  const collect = node => {
    if (!node || typeof node !== "object") return;
    if (node.nodeType === "FORMULA" && node.formulaKey === "critical_extra_damage_ratio") hasFormulaRatio = true;
    if (node.nodeType === "PARAMETER" && node.parameterKey === "critical_extra_damage_ratio") hasParameterRatio = true;
    if (node.nodeType === "OPERATION" && Array.isArray(node.operands)) node.operands.forEach(collect);
  };
  collect(yunaraPFormula.expression);
  return { hasFormulaRatio, hasParameterRatio };
})();
if (!yunaraPHasFormulaRatioReference.hasFormulaRatio && yunaraPHasFormulaRatioReference.hasParameterRatio) {
  const gap = {
    type: "formula-reference-node-mismatch",
    key: "yunara_p",
    field: "critical_extra_magic_damage",
    evidence: "冻结来源Calc_Damage_Amp计算树由基础0.1与法强系数0.001组成；候选另有critical_extra_damage_ratio公式。",
    candidate: "候选critical_extra_magic_damage把critical_extra_damage_ratio写成PARAMETER节点，没有引用同技能公式。",
    impact: "表达式求值找不到该参数；暴击额外伤害公式两个场景均无法计算。",
  };
  explicitCandidateGaps.push(gap);
  addIssue(gap);
}
const melWText = sourceText("mel_w");
const melWHasPhysicalFormula = candidateSkill("mel_w").write.formulas.some(item => item.formulaKey === "reflected_physical_magic_damage");
if (melWText.includes("PhysDamageMod") && !melWHasPhysicalFormula) {
  const gap = {
    type: "current-text-modifier-not-applied",
    key: "mel_w",
    field: "physical_to_magic_reduction_percent_points",
    evidence: "当前文本明确物理伤害转魔法伤害时降低PhysDamageMod*100%，冻结DataValues为30%。",
    candidate: "候选仅记录30百分数点参数，reflected_magic_damage没有来源伤害类型或减伤运算输入。",
    impact: "当前公式无法对物理来源弹体应用30%转换减伤；真实对方技能接线时仍需补条件分支。",
  };
  explicitCandidateGaps.push(gap);
  addIssue(gap);
}
const pendingConditionBindings = [
  { key: "mel_w", formulaKey: "reflected_magic_damage", condition: "原公式仅限非物理来源", status: "来源伤害类型条件待接线" },
  { key: "mel_w", formulaKey: "reflected_physical_magic_damage", condition: "物理来源才使用1-30%转换倍率", status: "来源伤害类型条件待接线" },
];

const candidateSha256 = shaFile(CANDIDATE_FILE);
const candidateVersionMatch = candidateVersion.candidateSha256 === candidateSha256;
if (!candidateVersionMatch) addIssue({ type: "candidate-version-hash-mismatch", candidateSha256, candidateVersionSha256: candidateVersion.candidateSha256 });
const scopeBoundaries = {
  clientVersion: binding.clientVersion,
  officialVersion: binding.officialVersion,
  characterLevelRange: [1, 18],
  skillLevelRanges: levelRangeChecks,
  orderCheck,
  skippedTransformationBranches: [
    { hero: "KSante", rawCalculations: ["MaxHealthDamagePercent"], status: "仅跳过完整变形分支；基础技能伤害与护盾仍核对" },
    { hero: "Yunara", rawCalculations: ["Calc_RW_Damage", "Calc_RW_Slow_Amount", "{42964db5}", "Calc_RW_Cooldown_Reduction"], status: "完整变形R分支按范围跳过；基础P/Q/W/E仍核对" },
  ],
  unresolvedInterpolations: [
    { key: "qiyana_p", parameterKey: "actual_character_level_base_damage", status: "运行输入；未猜角色等级插值" },
    { key: "qiyana_e", parameterKey: "dash_speed", status: "仅保留600到1200边界；未猜中间曲线" },
    { key: "ksante_p", parameterKey: "mark_target_max_health_ratio", status: "运行输入；仅保留1%到2%来源区间" },
    { key: "mel_p", parameterKey: "actual_character_level_passive_missile_base_damage", status: "运行输入；未猜角色等级插值" },
  ],
  unprovedMStatMappings: unprovedArmorMappings,
};
const report = {
  generatedAt: new Date().toISOString(),
  status: issues.length === 0 ? "通过" : "候选数学需修订",
  candidateMathReady: issues.length === 0,
  businessMathReady: false,
  note: "只读取冻结候选、冻结16.17源绑定、当前中文正文与原始计算树；未调用业务接口、未执行浏览器验证、未写入业务数据。未知插值与未证mStat保持运行输入或范围记录。",
  candidateSha256,
  candidateVersionSha256: candidateVersion.candidateSha256,
  candidateVersionMatch,
  revision: candidate.meta?.revision,
  sourceVersion: { clientVersion: binding.clientVersion, officialVersion: binding.officialVersion, candidate: candidate.meta?.sourceVersion },
  order: candidate.order,
  scopeBoundaries,
  pendingConditionBindings,
  formulaCount: structural.formulaCount,
  caseCount,
  expectedCasesPerFormula: 2,
  formulaResults,
  formulaPassCount: formulaResults.filter(result => result.pass).length,
  formulaFailCount: formulaResults.filter(result => !result.pass).length,
  missingInputChecks,
  missingInputCaseCount: missingInputChecks.length,
  missingInputRejectedCount: missingInputChecks.filter(check => check.rejected).length,
  sourceChecks,
  fixedChecks,
  effectAudit,
  structural,
  coverage,
  explicitCandidateGaps,
  issues,
  inputHashes: {
    candidate: candidateSha256,
    binding: shaFile(BINDING_FILE),
    scope: shaFile(path.join(INPUT_DIR, "主负责人范围与核对要求.md")),
    sourceNote: shaFile(path.join(INPUT_DIR, "主负责人源值核对说明.md")),
  },
  apiCalls: 0,
  apiWrites: 0,
  browserCalls: 0,
  businessWrites: 0,
};
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  status: report.status,
  candidateMathReady: report.candidateMathReady,
  businessMathReady: report.businessMathReady,
  candidateSha256,
  formulaCount: report.formulaCount,
  caseCount: report.caseCount,
  formulaPassCount: report.formulaPassCount,
  formulaFailCount: report.formulaFailCount,
  missingInputCaseCount: report.missingInputCaseCount,
  missingInputRejectedCount: report.missingInputRejectedCount,
  levelParameters: sourceChecks.levelParameters,
  levelValues: sourceChecks.levelValues,
  fixedParameters: sourceChecks.fixedParameters,
  fixedFailures: sourceChecks.fixedFailures.length,
  integerParameters: structural.integerParameters,
  integerValues: structural.integerValues,
  invalidIntegerValues: structural.invalidIntegerValues,
  formulaReferenceNodes: structural.formulaReferenceNodes,
  effectFinalMultiplierChecks: effectAudit.finalMultiplierChecks,
  ratioFlatAddChecks: effectAudit.ratioFlatAddChecks,
  explicitCandidateGapCount: explicitCandidateGaps.length,
  issueCount: issues.length,
  reportSha256: shaFile(REPORT_FILE),
  scriptSha256: shaFile(fileURLToPath(import.meta.url)),
  apiCalls: 0,
  apiWrites: 0,
  browserCalls: 0,
  businessWrites: 0,
}, null, 2));


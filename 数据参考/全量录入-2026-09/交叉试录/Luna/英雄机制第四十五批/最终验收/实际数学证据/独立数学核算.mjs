import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(ROOT, "..", "..", "..");
const REVIEW = path.join(WORKSPACE, ".agents", "artifacts", "hero45-independent-review");
const FROZEN_CANDIDATE_FILE = path.join(WORKSPACE, ".agents", "artifacts", "hero45-luna-candidate", "修订一", "完整候选.json");
const CANDIDATE_FILE = path.join(REVIEW, "GET覆盖候选.json");
const SNAPSHOT_FILE = path.join(REVIEW, "GET复核快照.json");
const INPUT = path.join(WORKSPACE, ".agents", "artifacts", "hero45-root-entry-20260910");
const candidate = JSON.parse(fs.readFileSync(CANDIDATE_FILE, "utf8"));
const frozenCandidate = JSON.parse(fs.readFileSync(FROZEN_CANDIDATE_FILE, "utf8"));
const getSnapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
const getReport = JSON.parse(fs.readFileSync(path.join(REVIEW, "GET复核报告.json"), "utf8"));
const binding = JSON.parse(fs.readFileSync(path.join(INPUT, "来源绑定与当前文本.json"), "utf8"));
const protection = JSON.parse(fs.readFileSync(path.join(INPUT, "参考资料", "当前20槽保护快照.json"), "utf8"));
const reuseList = JSON.parse(fs.readFileSync(path.join(INPUT, "参考资料", "公共参数复用清单.json"), "utf8"));
const inputVersion = JSON.parse(fs.readFileSync(path.join(INPUT, "输入版本.json"), "utf8"));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (left, right) => Math.abs(Number(left) - Number(right)) <= 1e-6 * Math.max(1, Math.abs(Number(left)), Math.abs(Number(right)));
const round = value => Number(Number(value).toFixed(9));
const need = (object, key, label) => {
  if (!Object.prototype.hasOwnProperty.call(object, key) || object[key] === null || object[key] === undefined) throw new Error(`缺少${label}`);
  return object[key];
};

const sourceSkills = Object.fromEntries(binding.heroes.map(hero => [hero.id, Object.fromEntries(hero.skills.map(skill => [skill.slot, skill]))]));
const spell = (heroId, slot) => sourceSkills[heroId][slot].object.mSpell;
const dataRow = (heroId, slot, name) => {
  const row = (spell(heroId, slot).DataValues || []).find(item => item.name === name);
  if (!row || !Array.isArray(row.values)) throw new Error(`缺少源DataValue ${heroId}/${slot}/${name}`);
  return row.values;
};
const dataAt = (heroId, slot, name, index = 1) => dataRow(heroId, slot, name)[index];
const calc = (heroId, slot, name) => {
  const value = (spell(heroId, slot).mSpellCalculations || {})[name];
  if (!value) throw new Error(`缺少源计算树 ${heroId}/${slot}/${name}`);
  return value;
};
const calcPart = (heroId, slot, name, index = 0) => {
  const part = (calc(heroId, slot, name).mFormulaParts || [])[index];
  if (!part) throw new Error(`缺少源计算树分支 ${heroId}/${slot}/${name}/${index}`);
  return part;
};
const calcCoefficient = (heroId, slot, name, index = 1) => {
  const value = calcPart(heroId, slot, name, index).mCoefficient;
  if (typeof value !== "number") throw new Error(`缺少源树系数 ${heroId}/${slot}/${name}/${index}`);
  return value;
};
const sourceParameter = (skillKey, parameterKey) => {
  const skillData = candidate.skills[skillKey];
  return skillData?.write.parameters.find(item => item.parameterKey === parameterKey);
};
const finalDetailByRoute = new Map((getSnapshot.finalDetails || []).map(item => [item.route, item]));
if (finalDetailByRoute.size !== 142) throw new Error(`GET最终详情快照数量异常：${finalDetailByRoute.size}`);
const publicData = new Map();
for (const item of reuseList) {
  const route = `/skills/${item.skillKey}/parameters/${item.parameterKey}`;
  const hit = finalDetailByRoute.get(route);
  if (!hit || hit.status !== 200) throw new Error(`公共参数最终GET缺失 ${route}`);
  publicData.set(`${item.skillKey}/${item.parameterKey}`, clone(hit.data));
}

const parameterMap = (skillKey, skillLevel, characterLevel, inputs = {}) => {
  const values = {};
  const skillData = candidate.skills[skillKey];
  for (const item of skillData.write.parameters) {
    if (item.valueMode === "FIXED") values[item.parameterKey] = item.fixedValue;
    else if (item.valueMode === "SKILL_LEVEL") values[item.parameterKey] = item.levelValues[String(skillLevel)];
    else if (item.valueMode === "CHARACTER_LEVEL") values[item.parameterKey] = item.levelValues[String(characterLevel)];
    else if (item.valueMode === "RUNTIME_INPUT") values[item.parameterKey] = need(inputs, item.parameterKey, `运行输入${skillKey}/${item.parameterKey}`);
    else throw new Error(`未知参数取值模式 ${skillKey}/${item.parameterKey}`);
  }
  for (const item of reuseList) {
    if (item.skillKey !== skillKey) continue;
    const data = publicData.get(`${item.skillKey}/${item.parameterKey}`);
    values[item.parameterKey] = data.valueMode === "FIXED" ? data.fixedValue : data.levelValues?.[String(skillLevel)];
  }
  return values;
};
const attrsFor = scenario => ({
  SOURCE: {
    attack_damage: { TOTAL: scenario.totalAD, BONUS: scenario.bonusAD },
    ability_power: { TOTAL: scenario.AP },
  },
  TARGET: { hp: { TOTAL: scenario.targetMaxHP } },
});
const evaluate = (node, params, attrs) => {
  if (!node || typeof node !== "object") throw new Error("公式节点为空");
  if (node.nodeType === "PARAMETER") return need(params, node.parameterKey, `公式参数${node.parameterKey}`);
  if (node.nodeType === "ATTRIBUTE") {
    const value = attrs[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
    if (typeof value !== "number") throw new Error(`缺少属性${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`);
    return value;
  }
  if (node.nodeType === "OPERATION") {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error("存在非二元操作");
    const [left, right] = node.operands.map(child => evaluate(child, params, attrs));
    if (node.operation === "ADD") return left + right;
    if (node.operation === "SUBTRACT") return left - right;
    if (node.operation === "MULTIPLY") return left * right;
    if (node.operation === "DIVIDE") return left / right;
    throw new Error(`未支持操作${node.operation}`);
  }
  throw new Error(`未支持节点${node.nodeType}`);
};
const walk = (node, callback) => {
  if (!node || typeof node !== "object") return;
  callback(node);
  if (Array.isArray(node.operands)) node.operands.forEach(child => walk(child, callback));
};
const refsOf = expression => {
  const refs = [];
  walk(expression, node => { if (node.nodeType === "PARAMETER") refs.push(node.parameterKey); });
  return refs;
};
const rankFor = (skillKey, index) => skillKey.endsWith("_p") ? 1 : skillKey.endsWith("_r") ? (index === 0 ? 1 : 3) : (index === 0 ? 1 : 5);
const scenarioFor = (skillKey, index) => ({
  skillKey,
  rank: rankFor(skillKey, index),
  characterLevel: index === 0 ? 1 : 18,
  totalAD: index === 0 ? 180 : 320,
  bonusAD: index === 0 ? 80 : 180,
  AP: index === 0 ? 120 : 420,
  targetMaxHP: index === 0 ? 1000 : 1800,
  inputs: {
    backstab_base_damage: index === 0 ? 20 : 35,
    shivs_base_damage: index === 0 ? 15 : 50,
    actual_critical_damage_multiplier: index === 0 ? 1 : 1.5,
    re_same_target_discharge_count: index === 0 ? 1 : 3,
  },
});

const expected = (skillKey, formulaKey, scenario) => {
  const rank = scenario.rank;
  const { AP, bonusAD, totalAD, inputs } = scenario;
  const value = (heroId, slot, name, index = 1) => dataAt(heroId, slot, name, index);
  switch (`${skillKey}/${formulaKey}`) {
    case "teemo_q/magic_damage":
      return value("Teemo", "Q", "BaseDamage", rank) + value("Teemo", "Q", "APRatio") * AP;
    case "teemo_e/impact_magic_damage":
      return value("Teemo", "E", "ImpactBaseDamage", rank) + value("Teemo", "E", "ImpactAPRatio") * AP + value("Teemo", "E", "ImpactBonusADRatio") * bonusAD;
    case "teemo_e/poison_tick_magic_damage":
      return value("Teemo", "E", "TickBaseDamage", rank) + value("Teemo", "E", "TickAPRatio") * AP + value("Teemo", "E", "TickBonusADRatio") * bonusAD;
    case "teemo_e/total_poison_magic_damage": {
      const tick = value("Teemo", "E", "TickBaseDamage", rank) + value("Teemo", "E", "TickAPRatio") * AP + value("Teemo", "E", "TickBonusADRatio") * bonusAD;
      return tick * value("Teemo", "E", "PoisonDuration") / value("Teemo", "E", "TickFrequency");
    }
    case "shaco_p/backstab_basic_attack_physical_damage":
      return need(inputs, "backstab_base_damage", "背刺普攻基础实际值") + value("Shaco", "P", "AttackBonusADRatio") * bonusAD;
    case "shaco_p/backstab_shiv_magic_damage":
      return need(inputs, "shivs_base_damage", "背刺E基础实际值") + calcCoefficient("Shaco", "P", "ShivDamage") * AP;
    case "shaco_p/backstab_shiv_execute_magic_damage":
      return (need(inputs, "shivs_base_damage", "背刺E基础实际值") + calcCoefficient("Shaco", "P", "ShivDamage") * AP) * value("Shaco", "P", "ShivExecuteDamagePercent");
    case "shaco_q/enhanced_attack_physical_damage":
      return value("Shaco", "Q", "BaseDamage", rank) + value("Shaco", "Q", "BonusADRatio") * bonusAD;
    case "shaco_q/backstab_critical_multiplier":
      return 1 + value("Shaco", "Q", "NonCritBackstabMod") * (need(inputs, "actual_critical_damage_multiplier", "mStat9实际总暴击倍率") - 1);
    case "shaco_q/backstab_critical_full_attack_physical_damage": {
      const multiplier = 1 + value("Shaco", "Q", "NonCritBackstabMod") * (need(inputs, "actual_critical_damage_multiplier", "mStat9实际总暴击倍率") - 1);
      const extra = value("Shaco", "Q", "BaseDamage", rank) + value("Shaco", "Q", "BonusADRatio") * bonusAD;
      return multiplier * (totalAD + extra);
    }
    case "shaco_e/magic_damage":
      return value("Shaco", "E", "BaseDamage", rank) + value("Shaco", "E", "BonusADRatio") * bonusAD + value("Shaco", "E", "APRatio") * AP;
    case "shaco_e/execute_magic_damage": {
      const damage = value("Shaco", "E", "BaseDamage", rank) + value("Shaco", "E", "BonusADRatio") * bonusAD + value("Shaco", "E", "APRatio") * AP;
      return damage * value("Shaco", "E", "ExecuteDamagePercent");
    }
    case "heimerdinger_w/initial_magic_damage":
      return value("Heimerdinger", "W", "BaseDamage", rank) + value("Heimerdinger", "W", "InitialDamageAPRatio") * AP;
    case "heimerdinger_w/following_magic_damage":
      return value("Heimerdinger", "W", "ExtraHitBaseDamage", rank) + calcCoefficient("Heimerdinger", "W", "ExtraHitDamage") * AP;
    case "heimerdinger_w/all_five_magic_damage":
      return value("Heimerdinger", "W", "TotalBaseDamage", rank) + calcCoefficient("Heimerdinger", "W", "TotalDamage") * AP;
    case "heimerdinger_e/magic_damage":
      return value("Heimerdinger", "E", "BaseDamage", rank) + calcCoefficient("Heimerdinger", "E", "Damage") * AP;
    case "heimerdinger_r/rw_initial_magic_damage":
      return value("Heimerdinger", "R", "WUltBaseDamage", rank) + calcCoefficient("Heimerdinger", "R", "WUltDamage") * AP;
    case "heimerdinger_r/rw_total_magic_damage":
      return value("Heimerdinger", "R", "WUltTotalBaseDamage", rank) + calcCoefficient("Heimerdinger", "R", "WUltTotalDamage") * AP;
    case "heimerdinger_r/re_single_discharge_magic_damage":
      return value("Heimerdinger", "R", "EUltBaseDamage", rank) + calcCoefficient("Heimerdinger", "R", "EUltDamage") * AP;
    case "heimerdinger_r/re_same_target_total_magic_damage":
      return (value("Heimerdinger", "R", "EUltBaseDamage", rank) + calcCoefficient("Heimerdinger", "R", "EUltDamage") * AP) * need(inputs, "re_same_target_discharge_count", "强化E同目标放电次数");
    case "zyra_q/magic_damage":
      return value("Zyra", "Q", "BaseDamage", rank) + calcCoefficient("Zyra", "Q", "InitialDamage") * AP;
    case "zyra_e/magic_damage":
      return value("Zyra", "E", "BaseDamage", rank) + calcCoefficient("Zyra", "E", "TotalDamage") * AP;
    case "zyra_r/magic_damage":
      return value("Zyra", "R", "BaseDamage", rank) + calcCoefficient("Zyra", "R", "TotalDamage") * AP;
    default:
      throw new Error(`缺少独立期望侧映射 ${skillKey}/${formulaKey}`);
  }
};

const formulaResults = [];
const missingInputCases = [];
const structureIssues = [];
const referencedRuntime = new Set();
for (const skillKey of candidate.order) {
  const skillData = candidate.skills[skillKey];
  for (const item of skillData.write.formulas) {
    walk(item.expression, node => {
      if (node.nodeType === "OPERATION" && (!Array.isArray(node.operands) || node.operands.length !== 2)) structureIssues.push(`${skillKey}/${item.formulaKey}:非二元操作`);
    });
    for (const ref of refsOf(item.expression)) {
      if (sourceParameter(skillKey, ref)?.valueMode === "RUNTIME_INPUT") referencedRuntime.add(`${skillKey}/${ref}`);
    }
    for (const index of [0, 1]) {
      const scenario = scenarioFor(skillKey, index);
      try {
        const params = parameterMap(skillKey, scenario.rank, scenario.characterLevel, scenario.inputs);
        const actual = evaluate(item.expression, params, attrsFor(scenario));
        const expectedValue = expected(skillKey, item.formulaKey, scenario);
        formulaResults.push({
          skillKey,
          formulaKey: item.formulaKey,
          scenario: index === 0 ? "基础场景" : "强化场景",
          inputs: { skillLevel: scenario.rank, characterLevel: scenario.characterLevel, totalAD: scenario.totalAD, bonusAD: scenario.bonusAD, AP: scenario.AP, runtime: clone(scenario.inputs) },
          actual: round(actual),
          expected: round(expectedValue),
          pass: equal(actual, expectedValue),
        });
      } catch (error) {
        formulaResults.push({ skillKey, formulaKey: item.formulaKey, scenario: index === 0 ? "基础场景" : "强化场景", pass: false, error: error.message });
      }
    }
    for (const ref of refsOf(item.expression)) {
      const parameter = sourceParameter(skillKey, ref);
      if (parameter?.valueMode !== "RUNTIME_INPUT") continue;
      const scenario = scenarioFor(skillKey, 0);
      const without = { ...scenario.inputs };
      delete without[ref];
      let rejected = false;
      try {
        const params = parameterMap(skillKey, scenario.rank, scenario.characterLevel, without);
        evaluate(item.expression, params, attrsFor(scenario));
      } catch (_error) {
        rejected = true;
      }
      missingInputCases.push({ skillKey, formulaKey: item.formulaKey, missingParameterKey: ref, rejected });
    }
  }
}

const typedReferenceChecks = [];
const finiteChecks = [];
const typedKinds = new Set(["PARAMETER", "FORMULA", "FIXED"]);
const nodeTypes = new Set(["OPERATION", "PARAMETER", "ATTRIBUTE"]);
const operations = new Set(["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MIN", "MAX"]);
const attributeOwners = new Set(["SOURCE", "TARGET"]);
const attributeValueKinds = new Set(["BASE", "BONUS", "TOTAL", "CURRENT", "MISSING", "CURRENT_RATIO", "MISSING_RATIO"]);
const finiteWalk = (value, label) => {
  if (typeof value === "number") {
    finiteChecks.push({ label, value, pass: Number.isFinite(value) });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => finiteWalk(item, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) finiteWalk(item, `${label}.${key}`);
};
for (const skillKey of candidate.order) {
  const write = candidate.skills[skillKey].write;
  const parameters = new Set(write.parameters.map(item => item.parameterKey));
  for (const item of reuseList.filter(value => value.skillKey === skillKey)) parameters.add(item.parameterKey);
  const formulas = new Set(write.formulas.map(item => item.formulaKey));
  const typedWalk = (value, label) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => typedWalk(item, `${label}[${index}]`));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(value, "kind")) {
      const kind = value.kind;
      if (!typedKinds.has(kind)) typedReferenceChecks.push({ label, kind, pass: false, reason: "未知typed引用类型" });
      else if (kind === "PARAMETER") typedReferenceChecks.push({ label, kind, reference: value.parameterKey, pass: typeof value.parameterKey === "string" && parameters.has(value.parameterKey), reason: parameters.has(value.parameterKey) ? null : "参数引用不存在" });
      else if (kind === "FORMULA") typedReferenceChecks.push({ label, kind, reference: value.formulaKey, pass: typeof value.formulaKey === "string" && formulas.has(value.formulaKey), reason: formulas.has(value.formulaKey) ? null : "公式引用不存在" });
      else typedReferenceChecks.push({ label, kind, value: value.value, pass: typeof value.value === "number" && Number.isFinite(value.value), reason: typeof value.value === "number" && Number.isFinite(value.value) ? null : "固定引用值不是有限数" });
    }
    if (Object.prototype.hasOwnProperty.call(value, "nodeType")) {
      const nodeType = value.nodeType;
      let pass = nodeTypes.has(nodeType);
      let reason = pass ? null : "未知公式节点类型";
      if (nodeType === "PARAMETER") {
        pass = pass && typeof value.parameterKey === "string" && parameters.has(value.parameterKey);
        if (!pass) reason = "公式参数引用不存在";
      } else if (nodeType === "ATTRIBUTE") {
        pass = pass && attributeOwners.has(value.attributeOwner) && attributeValueKinds.has(value.attributeValueKind);
        if (!pass) reason = "属性节点所有者或取值层级非法";
      } else if (nodeType === "OPERATION") {
        pass = pass && operations.has(value.operation) && Array.isArray(value.operands) && value.operands.length === 2;
        if (!pass) reason = "公式操作不是允许的二元操作";
      }
      typedReferenceChecks.push({ label, nodeType, pass, reason });
    }
    for (const [key, item] of Object.entries(value)) typedWalk(item, `${label}.${key}`);
  };
  typedWalk(write, `${skillKey}.write`);
  finiteWalk(write, `${skillKey}.write`);
}
const typedReferenceAllPass = typedReferenceChecks.every(item => item.pass);
const finiteAllPass = finiteChecks.every(item => item.pass);

const expectedParameter = new Map();
const mapData = (skillKey, parameterKey, heroId, slot, dataName, count, transform = value => value, start = 1) => {
  expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "SKILL_LEVEL", values: Object.fromEntries(Array.from({ length: count }, (_, index) => [String(index + 1), round(transform(dataAt(heroId, slot, dataName, start + index)))])) });
};
const mapFixedData = (skillKey, parameterKey, heroId, slot, dataName, transform = value => value, index = 1) => {
  expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "FIXED", value: round(transform(dataAt(heroId, slot, dataName, index))) });
};
const mapFixed = (skillKey, parameterKey, value) => expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "FIXED", value: round(value) });
const mapRuntime = (skillKey, parameterKey) => expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "RUNTIME_INPUT" });
const mapCalcCoefficient = (skillKey, parameterKey, heroId, slot, calcName, index = 1) => mapFixed(skillKey, parameterKey, calcCoefficient(heroId, slot, calcName, index));
const mapResource = (skillKey, parameterKey, heroId, slot, fieldName, count) => {
  const values = spell(heroId, slot)[fieldName];
  if (!Array.isArray(values) || values.length < count) throw new Error(`缺少源资源数组 ${heroId}/${slot}/${fieldName}`);
  expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "SKILL_LEVEL", values: Object.fromEntries(Array.from({ length: count }, (_, index) => [String(index + 1), values[index]])) });
};

mapFixedData("teemo_p", "stealth_stationary_duration_ms", "Teemo", "P", "StealthCooldownDuration", value => Math.round(value * 1000));
mapFixedData("teemo_p", "attack_speed_duration_ms", "Teemo", "P", "AttackSpeedDuration", value => Math.round(value * 1000));
expectedParameter.set("teemo_p/attack_speed_ratio", { mode: "CHARACTER_LEVEL", values: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(levelNumber => {
  const part = calcPart("Teemo", "P", "BonusAttackSpeed", 0);
  let value = part.mLevel1Value;
  for (const breakpoint of part.mBreakpoints || []) if (levelNumber >= breakpoint.mLevel) value += breakpoint.mAdditionalBonusAtThisLevel || 0;
  return [String(levelNumber), round(value)];
})) });
mapData("teemo_q", "base_damage", "Teemo", "Q", "BaseDamage", 5);
mapFixedData("teemo_q", "ap_ratio", "Teemo", "Q", "APRatio");
mapData("teemo_q", "blind_duration_ms", "Teemo", "Q", "BlindDuration", 5, value => Math.round(value * 1000));
mapFixed("teemo_q", "cast_time_ms", Math.round(spell("Teemo", "Q").spellCastTime * 1000));
mapData("teemo_w", "passive_move_speed_ratio", "Teemo", "W", "PassiveMoveSpeedBonus", 5);
mapFixedData("teemo_w", "passive_no_hero_damage_window_ms", "Teemo", "W", "PassiveCooldownOnDamageTaken", value => Math.round(value * 1000));
mapData("teemo_w", "active_move_speed_ratio", "Teemo", "W", "ActiveMoveSpeedBonus", 5);
mapFixedData("teemo_w", "active_move_speed_duration_ms", "Teemo", "W", "ActiveMoveSpeedBuffDuration", value => Math.round(value * 1000));
mapFixed("teemo_w", "cast_time_seconds", spell("Teemo", "W").spellCastTime);
mapData("teemo_e", "impact_base_damage", "Teemo", "E", "ImpactBaseDamage", 5);
mapFixedData("teemo_e", "impact_ap_ratio", "Teemo", "E", "ImpactAPRatio");
mapFixedData("teemo_e", "impact_bonus_ad_ratio", "Teemo", "E", "ImpactBonusADRatio");
mapData("teemo_e", "tick_base_damage", "Teemo", "E", "TickBaseDamage", 5);
mapFixedData("teemo_e", "tick_ap_ratio", "Teemo", "E", "TickAPRatio");
mapFixedData("teemo_e", "tick_bonus_ad_ratio", "Teemo", "E", "TickBonusADRatio");
mapFixedData("teemo_e", "poison_duration_ms", "Teemo", "E", "PoisonDuration", value => Math.round(value * 1000));
mapFixedData("teemo_e", "tick_interval_ms", "Teemo", "E", "TickFrequency", value => Math.round(value * 1000));
mapFixed("teemo_e", "poison_tick_count", dataAt("Teemo", "E", "PoisonDuration") / dataAt("Teemo", "E", "TickFrequency"));
mapRuntime("shaco_p", "backstab_base_damage");
mapFixedData("shaco_p", "backstab_bonus_ad_ratio", "Shaco", "P", "AttackBonusADRatio");
mapRuntime("shaco_p", "shivs_base_damage");
mapCalcCoefficient("shaco_p", "shivs_ap_ratio", "Shaco", "P", "ShivDamage");
mapFixedData("shaco_p", "shivs_execute_multiplier", "Shaco", "P", "ShivExecuteDamagePercent");
mapFixed("shaco_p", "execute_health_threshold_ratio", 0.3);
mapData("shaco_q", "stealth_duration_ms", "Shaco", "Q", "StealthDuration", 5, value => Math.round(value * 1000));
mapData("shaco_q", "enhanced_attack_base_damage", "Shaco", "Q", "BaseDamage", 5);
mapFixedData("shaco_q", "enhanced_attack_bonus_ad_ratio", "Shaco", "Q", "BonusADRatio");
mapFixedData("shaco_q", "backstab_crit_coefficient", "Shaco", "Q", "NonCritBackstabMod");
mapFixed("shaco_q", "crit_baseline", 1);
mapFixed("shaco_q", "crit_minus_one", -1);
mapRuntime("shaco_q", "actual_critical_damage_multiplier");
mapFixed("shaco_q", "cast_time_ms", Math.round(spell("Shaco", "Q").spellCastTime * 1000));
mapData("shaco_e", "base_damage", "Shaco", "E", "BaseDamage", 5);
mapFixedData("shaco_e", "bonus_ad_ratio", "Shaco", "E", "BonusADRatio");
mapFixedData("shaco_e", "ap_ratio", "Shaco", "E", "APRatio");
mapFixedData("shaco_e", "execute_health_threshold_ratio", "Shaco", "E", "ExecuteHealthThreshold");
mapFixedData("shaco_e", "execute_multiplier", "Shaco", "E", "ExecuteDamagePercent");
mapData("shaco_e", "slow_percent_points", "Shaco", "E", "SlowAmount", 5, value => Math.abs(Number(value)) * 100);
mapFixedData("shaco_e", "passive_slow_duration_ms", "Shaco", "E", "SlowDurationPassive", value => Math.round(value * 1000));
mapFixedData("shaco_e", "active_slow_duration_ms", "Shaco", "E", "SlowDurationActive", value => Math.round(value * 1000));
mapFixed("shaco_e", "cast_time_ms", Math.round(spell("Shaco", "E").spellCastTime * 1000));
mapFixedData("shaco_r", "teleport_range", "Shaco", "R", "TeleportRange");
mapFixed("shaco_r", "cast_time_ms", Math.round(spell("Shaco", "R").spellCastTime * 1000));
mapFixedData("heimerdinger_p", "near_turret_move_speed_ratio", "Heimerdinger", "P", "MovementSpeed");
mapData("heimerdinger_w", "initial_base_damage", "Heimerdinger", "W", "BaseDamage", 5);
mapFixedData("heimerdinger_w", "initial_ap_ratio", "Heimerdinger", "W", "InitialDamageAPRatio");
mapData("heimerdinger_w", "following_base_damage", "Heimerdinger", "W", "ExtraHitBaseDamage", 5);
mapCalcCoefficient("heimerdinger_w", "following_ap_ratio", "Heimerdinger", "W", "ExtraHitDamage");
mapData("heimerdinger_w", "all_five_base_damage", "Heimerdinger", "W", "TotalBaseDamage", 5);
mapCalcCoefficient("heimerdinger_w", "all_five_ap_ratio", "Heimerdinger", "W", "TotalDamage");
mapFixedData("heimerdinger_w", "missile_count", "Heimerdinger", "W", "Rockets");
mapFixed("heimerdinger_w", "cast_time_ms", Math.round(spell("Heimerdinger", "W").spellCastTime * 1000));
mapData("heimerdinger_e", "base_damage", "Heimerdinger", "E", "BaseDamage", 5);
mapCalcCoefficient("heimerdinger_e", "ap_ratio", "Heimerdinger", "E", "Damage");
mapFixedData("heimerdinger_e", "slow_percent_points", "Heimerdinger", "E", "SlowPercent", value => Number(value) * 100);
mapFixedData("heimerdinger_e", "slow_duration_ms", "Heimerdinger", "E", "SlowDuration", value => Math.round(value * 1000));
mapFixedData("heimerdinger_e", "stun_duration_ms", "Heimerdinger", "E", "StunDuration", value => Math.round(value * 1000));
mapFixed("heimerdinger_e", "cast_time_ms", Math.round(spell("Heimerdinger", "E").spellCastTime * 1000));
mapFixed("heimerdinger_r", "cast_time_seconds", spell("Heimerdinger", "R").spellCastTime);
mapData("heimerdinger_r", "rw_initial_base_damage", "Heimerdinger", "R", "WUltBaseDamage", 3);
mapCalcCoefficient("heimerdinger_r", "rw_initial_ap_ratio", "Heimerdinger", "R", "WUltDamage");
mapData("heimerdinger_r", "rw_total_base_damage", "Heimerdinger", "R", "WUltTotalBaseDamage", 3);
mapCalcCoefficient("heimerdinger_r", "rw_total_ap_ratio", "Heimerdinger", "R", "WUltTotalDamage");
mapFixed("heimerdinger_r", "rw_wave_count", 4);
mapData("heimerdinger_r", "re_discharge_base_damage", "Heimerdinger", "R", "EUltBaseDamage", 3);
mapCalcCoefficient("heimerdinger_r", "re_ap_ratio", "Heimerdinger", "R", "EUltDamage");
mapRuntime("heimerdinger_r", "re_same_target_discharge_count");
mapData("zyra_q", "base_damage", "Zyra", "Q", "BaseDamage", 5);
mapCalcCoefficient("zyra_q", "ap_ratio", "Zyra", "Q", "InitialDamage");
mapFixed("zyra_q", "cast_time_ms", Math.round(spell("Zyra", "Q").spellCastTime * 1000));
mapData("zyra_e", "base_damage", "Zyra", "E", "BaseDamage", 5);
mapCalcCoefficient("zyra_e", "ap_ratio", "Zyra", "E", "TotalDamage");
mapData("zyra_e", "root_duration_ms", "Zyra", "E", "RootDuration", 5, value => Math.round(value * 1000));
mapFixed("zyra_e", "cast_time_ms", Math.round(spell("Zyra", "E").spellCastTime * 1000));
mapData("zyra_r", "base_damage", "Zyra", "R", "BaseDamage", 3);
mapCalcCoefficient("zyra_r", "ap_ratio", "Zyra", "R", "TotalDamage");
mapFixed("zyra_r", "knockup_delay_ms", 2000);
mapFixedData("zyra_r", "knockup_duration_ms", "Zyra", "R", "KnockupDuration", value => Math.round(value * 1000));
mapFixed("zyra_r", "cast_time_ms", Math.round(spell("Zyra", "R").spellCastTime * 1000));

const parameterChecks = [];
const integerChecks = [];
for (const skillKey of candidate.order) {
  for (const parameter of candidate.skills[skillKey].write.parameters) {
    const expectedDefinition = expectedParameter.get(`${skillKey}/${parameter.parameterKey}`);
    if (!expectedDefinition) {
      parameterChecks.push({ skillKey, parameterKey: parameter.parameterKey, pass: false, error: "没有独立源值映射" });
      continue;
    }
    let pass = parameter.valueMode === expectedDefinition.mode;
    const details = { skillKey, parameterKey: parameter.parameterKey, valueMode: parameter.valueMode, expectedMode: expectedDefinition.mode };
    if (expectedDefinition.mode === "FIXED") {
      details.actual = parameter.fixedValue;
      details.expected = expectedDefinition.value;
      pass = pass && equal(parameter.fixedValue, expectedDefinition.value) && parameter.levelValues === null;
    } else if (expectedDefinition.mode === "SKILL_LEVEL" || expectedDefinition.mode === "CHARACTER_LEVEL") {
      details.actual = parameter.levelValues;
      details.expected = expectedDefinition.values;
      pass = pass && parameter.fixedValue === null && JSON.stringify(parameter.levelValues) === JSON.stringify(expectedDefinition.values);
    } else if (expectedDefinition.mode === "RUNTIME_INPUT") {
      pass = pass && parameter.fixedValue === null && parameter.levelValues === null;
    }
    parameterChecks.push({ ...details, pass });
    const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
    const integerOk = parameter.valueType !== "INTEGER" || values.every(value => Number.isInteger(value));
    const msOk = !parameter.parameterKey.endsWith("_ms") || values.every(value => Number.isInteger(value) && value >= 0);
    const runtimeNoDefault = parameter.valueMode !== "RUNTIME_INPUT" || (parameter.fixedValue === null && parameter.levelValues === null);
    integerChecks.push({ skillKey, parameterKey: parameter.parameterKey, integerOk, msOk, runtimeNoDefault, pass: integerOk && msOk && runtimeNoDefault });
  }
}

const currentConsumers = {
  teemo_q: ["CalculatedDamage"],
  teemo_e: ["ImpactCalculatedDamage", "TotalDotDamage"],
  shaco_p: ["BasicAttackDamage", "ShivDamage", "ShivDamageExecute"],
  shaco_q: ["TotalDamage", "QCritDamageMod"],
  shaco_e: ["TotalDamage", "TotalExecuteDamage"],
  heimerdinger_w: ["Damage", "ExtraHitDamage", "TotalDamage"],
  heimerdinger_e: ["Damage"],
  heimerdinger_r: ["WUltDamage", "WUltTotalDamage", "EUltDamage"],
  zyra_q: ["InitialDamage"],
  zyra_e: ["TotalDamage"],
  zyra_r: ["TotalDamage"],
};
const sourceSlotBySkill = {
  teemo_q: ["Teemo", "Q"], teemo_e: ["Teemo", "E"],
  shaco_p: ["Shaco", "P"], shaco_q: ["Shaco", "Q"], shaco_e: ["Shaco", "E"],
  heimerdinger_w: ["Heimerdinger", "W"], heimerdinger_e: ["Heimerdinger", "E"], heimerdinger_r: ["Heimerdinger", "R"],
  zyra_q: ["Zyra", "Q"], zyra_e: ["Zyra", "E"], zyra_r: ["Zyra", "R"],
};
const consumerChecks = [];
for (const [skillKey, names] of Object.entries(currentConsumers)) {
  const skillData = candidate.skills[skillKey];
  const [sourceHero, sourceSlot] = sourceSlotBySkill[skillKey];
  const sourceSkill = sourceSkills[sourceHero][sourceSlot];
  const sourceSpell = sourceSkill.object.mSpell;
  const text = Object.values(sourceSkill.currentTexts || {}).map(value => value?.text || "").join("\n");
  for (const name of names) {
    const formulaNames = sourceSpell.mSpellCalculations || {};
    const sourceExists = Boolean(formulaNames[name]);
    const selected = name === "CalculatedDamage" ? skillData.write.formulas.some(item => item.formulaKey === "magic_damage")
      : name === "ImpactCalculatedDamage" ? skillData.write.formulas.some(item => item.formulaKey === "impact_magic_damage")
        : name === "TotalDotDamage" ? skillData.write.formulas.some(item => item.formulaKey === "total_poison_magic_damage")
          : name === "BasicAttackDamage" ? skillData.write.formulas.some(item => item.formulaKey === "backstab_basic_attack_physical_damage")
            : name === "ShivDamage" ? skillData.write.formulas.some(item => item.formulaKey === "backstab_shiv_magic_damage")
              : name === "ShivDamageExecute" ? skillData.write.formulas.some(item => item.formulaKey === "backstab_shiv_execute_magic_damage")
                : name === "TotalDamage" && skillKey === "shaco_q" ? skillData.write.formulas.some(item => item.formulaKey === "enhanced_attack_physical_damage")
                  : name === "QCritDamageMod" ? skillData.write.formulas.some(item => item.formulaKey === "backstab_critical_multiplier")
                    : name === "TotalDamage" && skillKey === "shaco_e" ? skillData.write.formulas.some(item => item.formulaKey === "magic_damage")
                      : name === "TotalExecuteDamage" ? skillData.write.formulas.some(item => item.formulaKey === "execute_magic_damage")
                        : name === "Damage" && skillKey === "heimerdinger_w" ? skillData.write.formulas.some(item => item.formulaKey === "initial_magic_damage")
                          : name === "ExtraHitDamage" ? skillData.write.formulas.some(item => item.formulaKey === "following_magic_damage")
                            : name === "TotalDamage" && skillKey === "heimerdinger_w" ? skillData.write.formulas.some(item => item.formulaKey === "all_five_magic_damage")
                              : name === "Damage" && skillKey === "heimerdinger_e" ? skillData.write.formulas.some(item => item.formulaKey === "magic_damage")
                                : name === "WUltDamage" ? skillData.write.formulas.some(item => item.formulaKey === "rw_initial_magic_damage")
                                  : name === "WUltTotalDamage" ? skillData.write.formulas.some(item => item.formulaKey === "rw_total_magic_damage")
                                    : name === "EUltDamage" ? skillData.write.formulas.some(item => item.formulaKey === "re_single_discharge_magic_damage")
                                      : name === "InitialDamage" ? skillData.write.formulas.some(item => item.formulaKey === "magic_damage")
                                        : name === "TotalDamage" ? skillData.write.formulas.some(item => item.formulaKey === "magic_damage")
                                          : false;
    consumerChecks.push({ skillKey, calculation: name, sourceExists, textContainsName: text.includes(`@${name}@`), selected, pass: sourceExists && text.includes(`@${name}@`) && selected });
  }
}

const indexChecks = [
  { label: "Teemo Q BaseDamage索引0不作1级", pass: dataAt("Teemo", "Q", "BaseDamage", 0) !== candidate.skills.teemo_q.write.parameters.find(item => item.parameterKey === "base_damage").levelValues["1"] },
  { label: "Zyra Q BaseDamage索引1至5", pass: JSON.stringify(candidate.skills.zyra_q.write.parameters.find(item => item.parameterKey === "base_damage").levelValues) === JSON.stringify({ "1": 60, "2": 100, "3": 140, "4": 180, "5": 220 }) },
  { label: "Zyra R BaseDamage索引1至3", pass: JSON.stringify(candidate.skills.zyra_r.write.parameters.find(item => item.parameterKey === "base_damage").levelValues) === JSON.stringify({ "1": 200, "2": 300, "3": 400 }) },
  { label: "Heimer R EUltBaseDamage索引1至3", pass: JSON.stringify(candidate.skills.heimerdinger_r.write.parameters.find(item => item.parameterKey === "re_discharge_base_damage").levelValues) === JSON.stringify({ "1": 100, "2": 200, "3": 300 }) },
  { label: "Heimer R RW索引1至3", pass: JSON.stringify(candidate.skills.heimerdinger_r.write.parameters.find(item => item.parameterKey === "rw_initial_base_damage").levelValues) === JSON.stringify({ "1": 135, "2": 180, "3": 225 }) },
];

const effectChecks = [];
const bannedParameterNames = /monster|minion|clone|trap|plant|seed|vision|ammo/i;
const selectedBannedParameterChecks = [];
const ratioZones = [];
for (const skillKey of candidate.order) {
  for (const parameter of candidate.skills[skillKey].write.parameters) {
    selectedBannedParameterChecks.push({ skillKey, parameterKey: parameter.parameterKey, pass: !bannedParameterNames.test(parameter.parameterKey) });
  }
  for (const effect of candidate.skills[skillKey].write.effects) for (const result of effect.results || []) {
    const valueRule = result.valueRule;
    const fixedMultiplier = valueRule?.fixedMultiplier;
    const value = valueRule?.value;
    const refParameter = value?.kind === "PARAMETER" ? parameterMap(skillKey, scenarioFor(skillKey, 1).rank, scenarioFor(skillKey, 1).characterLevel, scenarioFor(skillKey, 1).inputs)[value.parameterKey] : undefined;
    const detail = result.detail || {};
    const finalValue = typeof refParameter === "number" ? refParameter * fixedMultiplier : null;
    const multiplierPass = fixedMultiplier === 1;
    const ratioPass = result.resultType !== "ATTRIBUTE_CHANGE" || detail.modifierZoneKey === "attribute_flat_add";
    effectChecks.push({ skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, resultType: result.resultType, valueKind: value?.kind || null, value: refParameter ?? null, fixedMultiplier, finalValue, multiplierPass, ratioPass, pass: Boolean(valueRule) && multiplierPass && ratioPass });
    if (result.resultType === "ATTRIBUTE_CHANGE") ratioZones.push({ skillKey, effectKey: effect.effectKey, attributeKey: detail.attributeKey, modifierZoneKey: detail.modifierZoneKey, pass: ratioPass });
  }
}

const levelChecks = [];
for (const skillKey of candidate.order) {
  const level = candidate.skills[skillKey].maxLevel;
  const expectedKeys = Array.from({ length: level }, (_, index) => String(index + 1));
  for (const parameter of candidate.skills[skillKey].write.parameters.filter(item => item.valueMode === "SKILL_LEVEL")) {
    levelChecks.push({ skillKey, parameterKey: parameter.parameterKey, expectedLevelKeys: expectedKeys, actualLevelKeys: Object.keys(parameter.levelValues || {}), pass: JSON.stringify(Object.keys(parameter.levelValues || {})) === JSON.stringify(expectedKeys) });
  }
}
const characterChecks = (() => {
  const parameter = candidate.skills.teemo_p.write.parameters.find(item => item.parameterKey === "attack_speed_ratio");
  const actual = Object.keys(parameter.levelValues || {});
  const expectedLevels = Array.from({ length: 18 }, (_, index) => String(index + 1));
  const values = Object.values(parameter.levelValues || {});
  const expectedValues = expectedLevels.map(levelNumber => {
    const part = calcPart("Teemo", "P", "BonusAttackSpeed", 0);
    let value = part.mLevel1Value;
    for (const breakpoint of part.mBreakpoints || []) if (Number(levelNumber) >= breakpoint.mLevel) value += breakpoint.mAdditionalBonusAtThisLevel || 0;
    return round(value);
  });
  return [{
    parameterKey: "teemo_p/attack_speed_ratio",
    actualLevelKeys: actual,
    expectedLevelKeys: expectedLevels,
    values,
    expectedValues,
    pass: JSON.stringify(actual) === JSON.stringify(expectedLevels) && values.length === expectedValues.length && values.every((value, index) => equal(value, expectedValues[index])),
  }];
})();

const scopeExclusionChecks = [
  {
    skillKey: "shaco_w",
    noParameters: candidate.skills.shaco_w.write.parameters.length === 0,
    noFormulas: candidate.skills.shaco_w.write.formulas.length === 0,
    noEffects: candidate.skills.shaco_w.write.effects.length === 0,
    pass: candidate.skills.shaco_w.write.parameters.length === 0 && candidate.skills.shaco_w.write.formulas.length === 0 && candidate.skills.shaco_w.write.effects.length === 0,
  },
  {
    skillKey: "heimerdinger_q",
    noParameters: candidate.skills.heimerdinger_q.write.parameters.length === 0,
    noFormulas: candidate.skills.heimerdinger_q.write.formulas.length === 0,
    noEffects: candidate.skills.heimerdinger_q.write.effects.length === 0,
    pass: candidate.skills.heimerdinger_q.write.parameters.length === 0 && candidate.skills.heimerdinger_q.write.formulas.length === 0 && candidate.skills.heimerdinger_q.write.effects.length === 0,
  },
];
const teemoWStateChecks = Array.from({ length: 5 }, (_, index) => {
  const rank = index + 1;
  const passive = candidate.skills.teemo_w.write.parameters.find(item => item.parameterKey === "passive_move_speed_ratio").levelValues[String(rank)];
  const active = candidate.skills.teemo_w.write.parameters.find(item => item.parameterKey === "active_move_speed_ratio").levelValues[String(rank)];
  const sourcePassive = dataAt("Teemo", "W", "PassiveMoveSpeedBonus", rank);
  const sourceActive = dataAt("Teemo", "W", "ActiveMoveSpeedBonus", rank);
  const additiveValue = passive + active;
  const pass = equal(passive, sourcePassive) && equal(active, sourceActive) && equal(active, passive * 2) && !equal(active, additiveValue);
  return { rank, passive, active, sourcePassive: round(sourcePassive), sourceActive: round(sourceActive), additiveValue: round(additiveValue), effectiveReplacementValue: active, pass };
});
const teemoWStateAllPass = teemoWStateChecks.every(item => item.pass);
const shacoQFullAttackFormula = candidate.skills.shaco_q.write.formulas.find(item => item.formulaKey === "backstab_critical_full_attack_physical_damage");
const shacoQFullAttackNodes = [];
if (shacoQFullAttackFormula) walk(shacoQFullAttackFormula.expression, node => shacoQFullAttackNodes.push(node));
const shacoQTotalADCount = shacoQFullAttackNodes.filter(node => node.nodeType === "ATTRIBUTE" && node.attributeOwner === "SOURCE" && node.attributeKey === "attack_damage" && node.attributeValueKind === "TOTAL").length;
const shacoQFullAttackRefs = shacoQFullAttackFormula ? refsOf(shacoQFullAttackFormula.expression) : [];
const shacoQBoundaryCheck = {
  formulaKey: "backstab_critical_full_attack_physical_damage",
  formulaPresent: Boolean(shacoQFullAttackFormula),
  totalAttackDamageAttributeCount: shacoQTotalADCount,
  containsQBaseParameter: shacoQFullAttackRefs.includes("enhanced_attack_base_damage"),
  containsQRatioParameter: shacoQFullAttackRefs.includes("enhanced_attack_bonus_ad_ratio"),
  containsPBackstabParameter: shacoQFullAttackRefs.includes("backstab_base_damage") || shacoQFullAttackRefs.includes("backstab_bonus_ad_ratio"),
  pass: Boolean(shacoQFullAttackFormula) && shacoQTotalADCount === 1 && shacoQFullAttackRefs.includes("enhanced_attack_base_damage") && shacoQFullAttackRefs.includes("enhanced_attack_bonus_ad_ratio") && !shacoQFullAttackRefs.includes("backstab_base_damage") && !shacoQFullAttackRefs.includes("backstab_bonus_ad_ratio"),
};

const runtimeMissingAllRejected = missingInputCases.length > 0 && missingInputCases.every(item => item.rejected);
const formulaPassCount = formulaResults.filter(item => item.pass).length;
const formulaFailCount = formulaResults.length - formulaPassCount;
const report = {
  generatedAt: new Date().toISOString(),
  batch: candidate.meta.batch,
  revision: candidate.meta.revision,
  status: "独立源值数学核算已执行；只读取已保存的336条GET快照，未发起额外业务接口请求、未调用浏览器或Git",
  sourceBasis: {
    clientVersion: binding.clientVersion,
    officialVersion: binding.officialVersion,
    sourceIndexSha256: inputVersion.sourceIndexSha256,
    sourceBindingSha256: candidate.meta.sourceBindingSha256,
    frozenCandidateSha256: sha256(fs.readFileSync(FROZEN_CANDIDATE_FILE)),
    overlayCandidateSha256: sha256(fs.readFileSync(CANDIDATE_FILE)),
    getSnapshotSha256: sha256(fs.readFileSync(SNAPSHOT_FILE)),
    actualWriteSha256: getReport.frozenEvidence?.actualWriteSha256 ?? null,
    getDetailCount: getSnapshot.finalDetails.length,
    getReplacementCount: getSnapshot.overlay?.replacementCount ?? null,
    expectedSide: "直接读取冻结输入原始DataValues、计算树和当前文本按源值重算，不从候选参数倒推期望值。",
    actualSide: "使用最终详情GET快照覆盖全部120个新建项后读取候选表达式，显式提供属性、技能等级、角色等级和无默认运行输入。",
  },
  getVerification: {
    protectedBaselineGETs: getReport.counts?.protectedBaselineGETs ?? null,
    finalDetailGETs: getReport.counts?.finalDetailGETs ?? null,
    totalGETs: getReport.counts?.totalGETs ?? null,
    expectedTotalGETs: 336,
    finalGETStatusPass: getReport.statusPass === true,
    extraMathGETs: 0,
  },
  formulaResults,
  formulaCount: formulaResults.length,
  formulaScenarioCount: formulaResults.length,
  formulaPassCount,
  formulaFailCount,
  formulaAtLeastTwoScenes: candidate.order.every(skillKey => candidate.skills[skillKey].write.formulas.length === 0 || candidate.skills[skillKey].write.formulas.every(item => formulaResults.filter(result => result.skillKey === skillKey && result.formulaKey === item.formulaKey).length >= 2)),
  missingInputCases,
  missingInputCaseCount: missingInputCases.length,
  missingInputAllRejected: runtimeMissingAllRejected,
  referencedRuntimeInputs: Array.from(referencedRuntime),
  parameterChecks,
  parameterCheckCount: parameterChecks.length,
  parameterCheckPassCount: parameterChecks.filter(item => item.pass).length,
  parameterCheckFailCount: parameterChecks.filter(item => !item.pass).length,
  levelChecks,
  levelCheckAllPass: levelChecks.every(item => item.pass),
  characterChecks,
  characterLevelAllPass: characterChecks.every(item => item.pass),
  indexChecks,
  sourceArrayIndexAllPass: indexChecks.every(item => item.pass),
  integerChecks,
  integerParameterCount: integerChecks.filter(item => candidate.skills[item.skillKey].write.parameters.find(parameter => parameter.parameterKey === item.parameterKey)?.valueType === "INTEGER").length,
  integerParameters: integerChecks.filter(item => candidate.skills[item.skillKey].write.parameters.find(parameter => parameter.parameterKey === item.parameterKey)?.valueType === "INTEGER" && item.pass).length,
  integerValueCount: integerChecks.reduce((sum, item) => {
    const parameter = candidate.skills[item.skillKey].write.parameters.find(value => value.parameterKey === item.parameterKey);
    return sum + (parameter?.valueType === "INTEGER" ? (parameter.valueMode === "FIXED" ? 1 : Object.keys(parameter.levelValues || {}).length) : 0);
  }, 0),
  integerValues: integerChecks.filter(item => item.pass).reduce((sum, item) => {
    const parameter = candidate.skills[item.skillKey].write.parameters.find(value => value.parameterKey === item.parameterKey);
    return sum + (parameter?.valueType === "INTEGER" ? (parameter.valueMode === "FIXED" ? 1 : Object.keys(parameter.levelValues || {}).length) : 0);
  }, 0),
  integerAndModeAllPass: integerChecks.every(item => item.pass),
  structureIssues,
  allFormulaOperationsBinary: structureIssues.length === 0,
  typedReferenceChecks,
  typedReferenceCheckCount: typedReferenceChecks.length,
  typedReferencePassCount: typedReferenceChecks.filter(item => item.pass).length,
  typedReferenceFailCount: typedReferenceChecks.filter(item => !item.pass).length,
  typedReferenceAllPass,
  finiteChecks,
  finiteCheckCount: finiteChecks.length,
  finitePassCount: finiteChecks.filter(item => item.pass).length,
  finiteFailCount: finiteChecks.filter(item => !item.pass).length,
  finiteAllPass,
  consumerChecks,
  currentConsumerAllPass: consumerChecks.every(item => item.pass),
  effectChecks,
  effectCount: effectChecks.length,
  effectFinalMultiplierCheckCount: effectChecks.length,
  effectFinalMultiplierAllPass: effectChecks.every(item => item.multiplierPass),
  ratioAttributeFlatAddChecks: ratioZones,
  ratioAttributeFlatAddAllPass: ratioZones.every(item => item.pass),
  selectedBannedParameterChecks,
  noUnitExclusionParameters: selectedBannedParameterChecks.every(item => item.pass),
  scopeExclusionChecks,
  scopeExclusionAllPass: scopeExclusionChecks.every(item => item.pass),
  teemoWStateChecks,
  teemoWStateAllPass,
  shacoQBoundaryCheck,
  publicReuseCount: reuseList.length,
  publicReuseExpected: 22,
  publicReuseAllProtected: reuseList.every(item => publicData.has(`${item.skillKey}/${item.parameterKey}`)),
  protectedSubjectsAllPresent: candidate.order.every(skillKey => candidate.skills[skillKey].protectedExisting.subject),
  maxLevelCheck: candidate.order.every(skillKey => candidate.skills[skillKey].maxLevel === (skillKey.endsWith("_p") ? 1 : skillKey.endsWith("_r") ? 3 : 5)),
  inputProtection: { GETs: protection.GETs, expectedGETs: 194, apiWrites: protection.apiWrites, expectedApiWrites: 0 },
  noApiCalls: true,
  noBrowserCalls: true,
  noGitWrites: true,
  apiWrites: 0,
  businessWrites: 0,
  statusPass: formulaFailCount === 0 && runtimeMissingAllRejected && parameterChecks.every(item => item.pass) && levelChecks.every(item => item.pass) && characterChecks.every(item => item.pass) && indexChecks.every(item => item.pass) && integerChecks.every(item => item.pass) && structureIssues.length === 0 && typedReferenceAllPass && finiteAllPass && consumerChecks.every(item => item.pass) && effectChecks.every(item => item.pass) && ratioZones.every(item => item.pass) && selectedBannedParameterChecks.every(item => item.pass) && scopeExclusionChecks.every(item => item.pass) && teemoWStateAllPass && shacoQBoundaryCheck.pass,
  scenarios: {
    基础场景: "技能等级1（R为1级）、角色等级1；总攻击力180、额外攻击力80、法强120；mStat9、插值基础值和强化E命中次数显式提供。",
    强化场景: "技能等级5（R为3级）、角色等级18；总攻击力320、额外攻击力180、法强420；运行输入改用另一组实际值。",
    missingInput: "逐公式移除所引用的RUNTIME_INPUT，必须拒绝计算；候选没有默认值。",
  },
};
const reportBytes = jsonBytes(report);
const reportSha256 = sha256(reportBytes);
fs.writeFileSync(path.join(ROOT, "独立数学报告.json"), reportBytes);

const updateVersion = directory => {
  const versionFile = path.join(directory, "候选版本.json");
  if (!fs.existsSync(versionFile)) return;
  const version = JSON.parse(fs.readFileSync(versionFile, "utf8"));
  version.sourceMathStatus = report.statusPass ? "独立数学核算已通过" : "独立数学核算存在失败";
  version.mathReportSha256 = reportSha256;
  version.mathFormulaCount = report.formulaCount;
  version.mathFormulaPassCount = report.formulaPassCount;
  version.mathFormulaFailCount = report.formulaFailCount;
  version.mathMissingInputCaseCount = report.missingInputCaseCount;
  version.mathMissingInputAllRejected = report.missingInputAllRejected;
  version.integerParameters = report.integerParameterCount;
  version.integerParameterPassCount = report.integerParameters;
  version.integerValues = report.integerValueCount;
  version.integerValuePassCount = report.integerValues;
  version.apiCalls = 0;
  version.apiWrites = 0;
  version.businessWrites = 0;
  fs.writeFileSync(versionFile, jsonBytes(version));
};
const updateManifest = directory => {
  const manifestFile = path.join(directory, "文件散列.json");
  if (!fs.existsSync(manifestFile)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const versionBytes = fs.readFileSync(path.join(directory, "候选版本.json"));
  manifest.files["候选版本.json"] = { sha256: sha256(versionBytes), byteSize: versionBytes.length };
  manifest.files["独立数学报告.json"] = { sha256: reportSha256, byteSize: reportBytes.length };
  manifest.mathReport = { file: "独立数学报告.json", sha256: reportSha256, byteSize: reportBytes.length, formulaCount: report.formulaCount, formulaPassCount: report.formulaPassCount, formulaFailCount: report.formulaFailCount, missingInputCaseCount: report.missingInputCaseCount };
  fs.writeFileSync(manifestFile, jsonBytes(manifest));
};
// 独立复核目录不包含候选版本或候选清单，不更新候选目录元数据。
const mathScriptFile = path.join(ROOT, "独立数学核算.mjs");
fs.writeFileSync(path.join(ROOT, "文件散列.json"), jsonBytes({
  generatedAt: new Date().toISOString(),
  files: {
    "独立数学核算.mjs": { sha256: sha256(fs.readFileSync(mathScriptFile)), byteSize: fs.statSync(mathScriptFile).size },
    "独立数学报告.json": { sha256: reportSha256, byteSize: reportBytes.length },
  },
  evidence: {
    frozenCandidateSha256: report.sourceBasis.frozenCandidateSha256,
    overlayCandidateSha256: report.sourceBasis.overlayCandidateSha256,
    getSnapshotSha256: report.sourceBasis.getSnapshotSha256,
    actualWriteSha256: report.sourceBasis.actualWriteSha256,
    totalGETs: report.getVerification.totalGETs,
    extraMathGETs: report.getVerification.extraMathGETs,
  },
  counts: {
    formulaCount: report.formulaCount,
    formulaPassCount: report.formulaPassCount,
    missingInputCaseCount: report.missingInputCaseCount,
    typedReferenceCheckCount: report.typedReferenceCheckCount,
    finiteCheckCount: report.finiteCheckCount,
    effectCount: report.effectCount,
  },
}));

console.log(JSON.stringify({
  statusPass: report.statusPass,
  reportSha256,
  formulaCount: report.formulaCount,
  formulaPassCount: report.formulaPassCount,
  formulaFailCount: report.formulaFailCount,
  missingInputCaseCount: report.missingInputCaseCount,
  missingInputAllRejected: report.missingInputAllRejected,
  parameterCheckCount: report.parameterCheckCount,
  parameterCheckPassCount: report.parameterCheckPassCount,
  parameterCheckFailCount: report.parameterCheckFailCount,
  effectCount: report.effectCount,
  integerParameterCount: report.integerParameterCount,
  integerParameters: report.integerParameters,
  integerValueCount: report.integerValueCount,
  integerValues: report.integerValues,
  apiWrites: 0,
  browserCalls: 0,
  gitWrites: 0,
}, null, 2));

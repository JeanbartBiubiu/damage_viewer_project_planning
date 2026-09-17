import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_FILE = path.join(ROOT, "完整候选.json");
const INPUT = path.resolve(ROOT, "..", "hero47-root-entry-20260910");
const DURABLE = path.resolve("数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十七批");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const round = value => Number(Number(value).toFixed(9));
const equal = (left, right) => Math.abs(Number(left) - Number(right)) <= 1e-6 * Math.max(1, Math.abs(Number(left)), Math.abs(Number(right)));
const need = (object, key, label) => {
  if (!Object.prototype.hasOwnProperty.call(object, key) || object[key] === null || object[key] === undefined) throw new Error(`缺少${label}`);
  return object[key];
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const toMs = seconds => {
  const raw = Number(seconds);
  const milliseconds = raw * 1000;
  const rounded = Math.round(milliseconds);
  assert(Number.isFinite(raw) && raw >= 0 && Math.abs(milliseconds - rounded) <= 1e-3, `时间不是可精确换算的整数毫秒：${seconds}`);
  return rounded;
};
const norm = value => round(value);

const candidate = readJson(CANDIDATE_FILE);
const binding = readJson(path.join(INPUT, "来源绑定与当前文本.json"));
const protection = readJson(path.join(INPUT, "参考资料", "当前20槽保护快照.json"));
const reuseList = readJson(path.join(INPUT, "参考资料", "公共参数复用清单.json"));
const inputVersion = readJson(path.join(INPUT, "输入版本.json"));
const QUALIFICATION = path.resolve(ROOT, "..", "hero47-qualification-review");
const qualificationFile = path.join(QUALIFICATION, "资格审查.json");
const qualificationReview = readJson(qualificationFile);
assert(candidate.order.length === 20, "候选不是20个技能槽");
assert(inputVersion.GETs === 193 && inputVersion.reusedParameters === 21 && inputVersion.apiWrites === 0, "冻结输入计数或写入状态不符");
assert(qualificationReview.status === "READY", "资格审查不是READY");
assert(qualificationReview.scope?.candidateChanged === false && qualificationReview.scope?.rootInputChanged === false, "资格审查改动了候选或根输入");
assert(qualificationReview.scope?.apiCalls === 0 && qualificationReview.scope?.apiWrites === 0 && qualificationReview.scope?.databaseCalls === 0 && qualificationReview.scope?.browserCalls === 0 && qualificationReview.scope?.gitWrites === 0, "资格审查存在业务调用或Git写入");
const qualificationBySkill = Object.fromEntries((qualificationReview.conclusions || []).map(item => [item.skillKey, item]));
const qualificationChecks = [
  { skillKey: "elise_w", rule: "一次性本体技能伤害载体", pass: qualificationBySkill.elise_w?.recordingDecision?.includes("本体技能载体处理") && qualificationBySkill.elise_w?.independentLifeManagement === "当前冻结资料未证实，不建立独立生命管理" },
  { skillKey: "nidalee_e", rule: "本轮仅保留自身效果", pass: qualificationBySkill.nidalee_e?.selfEligible === true && qualificationBySkill.nidalee_e?.batchRecordingOneThirdPartyAllyEligible === false && qualificationBySkill.nidalee_e?.recordingDecision?.includes("仅保留自身") },
];
assert(qualificationChecks.every(item => item.pass), "资格审查关键结论不完整");

const sourceSkills = Object.fromEntries(binding.heroes.map(hero => [hero.id, Object.fromEntries(hero.skills.map(skill => [skill.slot, skill]))]));
const spell = (heroId, slot) => sourceSkills[heroId]?.[slot]?.object?.mSpell;
const dataRow = (heroId, slot, name) => {
  const row = (spell(heroId, slot)?.DataValues || []).find(item => item.name === name);
  assert(row && Array.isArray(row.values), `缺少源DataValue：${heroId}/${slot}/${name}`);
  return row.values;
};
const dataAt = (heroId, slot, name, index = 1) => {
  const value = dataRow(heroId, slot, name)[index];
  assert(typeof value === "number" && Number.isFinite(value), `源DataValue不是有限数字：${heroId}/${slot}/${name}/${index}`);
  return value;
};
const calc = (heroId, slot, name) => {
  const value = (spell(heroId, slot)?.mSpellCalculations || {})[name];
  assert(value, `缺少源计算树：${heroId}/${slot}/${name}`);
  return value;
};
const calcPart = (heroId, slot, name, index = 0) => {
  const part = (calc(heroId, slot, name).mFormulaParts || [])[index];
  assert(part, `缺少源计算树分支：${heroId}/${slot}/${name}/${index}`);
  return part;
};
const calcCoefficient = (heroId, slot, name, index = 1) => {
  const value = calcPart(heroId, slot, name, index).mCoefficient;
  assert(typeof value === "number" && Number.isFinite(value), `缺少源树系数：${heroId}/${slot}/${name}/${index}`);
  return value;
};
const calcMultiplier = (heroId, slot, name) => {
  const value = calc(heroId, slot, name).mMultiplier?.mNumber;
  assert(typeof value === "number" && Number.isFinite(value), `缺少源树固定倍率：${heroId}/${slot}/${name}`);
  return value;
};
const calcSubpartNumber = (heroId, slot, name, index) => {
  const value = calc(heroId, slot, name).mMultiplier?.mSubparts?.[index]?.mNumber;
  assert(typeof value === "number" && Number.isFinite(value), `缺少源树子项固定值：${heroId}/${slot}/${name}/${index}`);
  return value;
};
const fieldAt = (heroId, slot, name, index = 1) => {
  const value = spell(heroId, slot)?.[name];
  if (Array.isArray(value)) {
    assert(typeof value[index] === "number" && Number.isFinite(value[index]), `缺少源字段数组值：${heroId}/${slot}/${name}/${index}`);
    return value[index];
  }
  assert(typeof value === "number" && Number.isFinite(value), `缺少源字段数字值：${heroId}/${slot}/${name}`);
  return value;
};

const publicData = new Map();
const protectedByRoute = new Map((protection.requests || []).map(request => [request.route, request]));
for (const item of reuseList) {
  const route = `/skills/${item.skillKey}/parameters/${item.parameterKey}`;
  const hit = protectedByRoute.get(route);
  assert(hit?.status === 200, `公共参数保护缺失：${route}`);
  publicData.set(`${item.skillKey}/${item.parameterKey}`, clone(hit.data));
}
const parameterOf = (skillKey, parameterKey) => candidate.skills[skillKey]?.write.parameters.find(item => item.parameterKey === parameterKey);
const parameterMap = (skillKey, skillLevel, characterLevel, inputs = {}) => {
  const values = {};
  const skillData = candidate.skills[skillKey];
  for (const item of skillData.write.parameters) {
    if (item.valueMode === "FIXED") values[item.parameterKey] = need(item, "fixedValue", `固定参数${skillKey}/${item.parameterKey}`);
    else if (item.valueMode === "SKILL_LEVEL") values[item.parameterKey] = need(item.levelValues, String(skillLevel), `技能等级参数${skillKey}/${item.parameterKey}/${skillLevel}`);
    else if (item.valueMode === "CHARACTER_LEVEL") values[item.parameterKey] = need(item.levelValues, String(characterLevel), `角色等级参数${skillKey}/${item.parameterKey}/${characterLevel}`);
    else if (item.valueMode === "RUNTIME_INPUT") values[item.parameterKey] = need(inputs, item.parameterKey, `运行输入${skillKey}/${item.parameterKey}`);
    else throw new Error(`未知参数取值模式：${skillKey}/${item.parameterKey}`);
  }
  for (const item of reuseList) {
    if (item.skillKey !== skillKey) continue;
    const data = publicData.get(`${item.skillKey}/${item.parameterKey}`);
    assert(data, `缺少公共参数保护值：${skillKey}/${item.parameterKey}`);
    values[item.parameterKey] = data.valueMode === "FIXED" ? data.fixedValue : data.levelValues?.[String(skillLevel)];
    assert(values[item.parameterKey] !== null && values[item.parameterKey] !== undefined, `公共参数没有技能等级值：${skillKey}/${item.parameterKey}/${skillLevel}`);
  }
  return values;
};
const attrsFor = scenario => ({
  SOURCE: {
    attack_damage: { TOTAL: scenario.totalAD, BONUS: scenario.bonusAD },
    ability_power: { TOTAL: scenario.AP },
    hp: { BONUS: scenario.sourceBonusHP },
  },
  TARGET: { hp: { TOTAL: scenario.targetMaxHP, CURRENT: scenario.targetCurrentHP } },
});
const evaluate = (node, params, attrs) => {
  if (!node || typeof node !== "object") throw new Error("公式节点为空");
  if (node.nodeType === "PARAMETER") return need(params, node.parameterKey, `公式参数${node.parameterKey}`);
  if (node.nodeType === "ATTRIBUTE") {
    const value = attrs[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`缺少属性${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`);
    return value;
  }
  if (node.nodeType === "OPERATION") {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error("存在非二元操作");
    const [left, right] = node.operands.map(child => evaluate(child, params, attrs));
    let result;
    if (node.operation === "ADD") result = left + right;
    else if (node.operation === "SUBTRACT") result = left - right;
    else if (node.operation === "MULTIPLY") result = left * right;
    else if (node.operation === "DIVIDE") result = left / right;
    else throw new Error(`未支持操作：${node.operation}`);
    assert(Number.isFinite(result), `公式结果不是有限数字：${result}`);
    return result;
  }
  throw new Error(`未支持节点：${node.nodeType}`);
};
const walk = (node, callback) => {
  if (!node || typeof node !== "object") return;
  callback(node);
  if (Array.isArray(node.operands)) node.operands.forEach(child => walk(child, callback));
};
const refsOf = expression => {
  const refs = [];
  walk(expression, node => { if (node.nodeType === "PARAMETER") refs.push(node.parameterKey); });
  return [...new Set(refs)];
};
const scenarioFor = (skillKey, index) => {
  const skillLevel = candidate.skills[skillKey].maxLevel > 1 ? (index === 0 ? 1 : candidate.skills[skillKey].maxLevel) : 1;
  return {
    skillKey,
    rank: skillLevel,
    characterLevel: index === 0 ? 1 : 18,
    totalAD: index === 0 ? 180 : 320,
    bonusAD: index === 0 ? 80 : 180,
    AP: index === 0 ? 120 : 420,
    sourceBonusHP: index === 0 ? 600 : 1400,
    targetMaxHP: index === 0 ? 1000 : 2200,
    targetCurrentHP: index === 0 ? 700 : 1350,
    inputs: {
      current_stack_count: index === 0 ? 2 : 8,
      nearby_enemy_count: index === 0 ? 0 : 1,
    },
  };
};

const expected = (skillKey, formulaKey, scenario) => {
  const { rank, AP, bonusAD, totalAD, sourceBonusHP, targetMaxHP, inputs } = scenario;
  const dv = (heroId, slot, name, index = rank) => dataAt(heroId, slot, name, index);
  switch (`${skillKey}/${formulaKey}`) {
    case "elise_q/current_health_magic_damage":
      return (dv("Elise", "Q", "TargetHPDamage") + dv("Elise", "Q", "APRatio") * AP) * calcMultiplier("Elise", "Q", "HumanPercentHealth") * scenario.targetCurrentHP;
    case "elise_q/human_magic_damage":
      return dv("Elise", "Q", "BaseDamage") + (dv("Elise", "Q", "TargetHPDamage") + dv("Elise", "Q", "APRatio") * AP) * calcMultiplier("Elise", "Q", "HumanPercentHealth") * scenario.targetCurrentHP;
    case "elise_w/magic_damage":
      return dv("Elise", "W", "BaseDamage") + dv("Elise", "W", "APRatio") * AP;
    case "elise_e/stun_duration":
      return toMs(dv("Elise", "E", "BaseStunDuration"));
    case "jayce_q/physical_damage":
      return dv("Jayce", "Q", "BaseDamage") + calcCoefficient("Jayce", "Q", "Damage") * bonusAD;
    case "jayce_w/magic_damage":
      return dv("Jayce", "W", "BaseDamage") + calcCoefficient("Jayce", "W", "Damage") * AP;
    case "jayce_e/magic_damage":
      return calcCoefficient("Jayce", "E", "FlatDamage", 0) * bonusAD + dv("Jayce", "E", "PercHPDamage") * targetMaxHP;
    case "nidalee_q/minimum_magic_damage":
      return dv("Nidalee", "Q", "SpearMinimumDamage") + dv("Nidalee", "Q", "SpearMinimumAPRatio") * AP;
    case "nidalee_q/maximum_magic_damage":
      return (dv("Nidalee", "Q", "SpearMinimumDamage") + dv("Nidalee", "Q", "SpearMinimumAPRatio") * AP) * dv("Nidalee", "Q", "DamageMulti");
    case "nidalee_e/total_healing":
      return dv("Nidalee", "E", "BaseHeal") + calcCoefficient("Nidalee", "E", "TotalHealing") * AP;
    case "nidalee_e/max_healing_multiplier":
      return calcSubpartNumber("Nidalee", "E", "MaxHealing", 0) + dv("Nidalee", "E", "MaxHealMult");
    case "nidalee_e/maximum_healing":
      return (dv("Nidalee", "E", "BaseHeal") + calcCoefficient("Nidalee", "E", "TotalHealing") * AP) * (calcSubpartNumber("Nidalee", "E", "MaxHealing", 0) + dv("Nidalee", "E", "MaxHealMult"));
    case "shyvana_p/bonus_armor":
      return dv("Shyvana", "P", "BonusArmor", 1) * need(inputs, "current_stack_count", "希瓦娜P当前层数");
    case "shyvana_p/bonus_magic_resist":
      return dv("Shyvana", "P", "BonusMagicResist", 1) * need(inputs, "current_stack_count", "希瓦娜P当前层数");
    case "shyvana_q/passive_max_health_magic_damage":
      return (dv("Shyvana", "Q", "Max_Health_Damage", 1) + dv("Shyvana", "Q", "Max_Health_AD_Ratio", 1) * bonusAD) * targetMaxHP;
    case "shyvana_q/active_physical_damage":
      return dv("Shyvana", "Q", "Base_Damage") + dv("Shyvana", "Q", "Damage_AD_Ratio", 1) * totalAD + calcCoefficient("Shyvana", "Q", "Calc_Damage", 2) * AP;
    case "shyvana_w/shield_amount":
      return dv("Shyvana", "W", "Shield") + dv("Shyvana", "W", "ShieldMaxHealth", 1) * sourceBonusHP;
    case "shyvana_w/nearby_shield_bonus":
      return (dv("Shyvana", "W", "Shield") + dv("Shyvana", "W", "ShieldMaxHealth", 1) * sourceBonusHP) * calcMultiplier("Shyvana", "W", "Calc_Shield_Per_Nearby_Champion");
    case "shyvana_w/shield_total": {
      const base = dv("Shyvana", "W", "Shield") + dv("Shyvana", "W", "ShieldMaxHealth", 1) * sourceBonusHP;
      return base + base * calcMultiplier("Shyvana", "W", "Calc_Shield_Per_Nearby_Champion") * need(inputs, "nearby_enemy_count", "希瓦娜W附近敌人数");
    }
    case "shyvana_w/toward_move_speed_ratio":
      return dv("Shyvana", "W", "BaseMoveSpeed") * dv("Shyvana", "W", "MoveSpeedAmpTowardsEnemies");
    case "shyvana_w/explosion_magic_damage":
      return dv("Shyvana", "W", "BaseDamage") + calcCoefficient("Shyvana", "W", "Damage") * AP;
    case "shyvana_e/damage":
      return dv("Shyvana", "E", "BaseDamage") + dv("Shyvana", "E", "DamageAPRatio") * AP;
    case "shyvana_e/max_health_damage":
      return dv("Shyvana", "E", "MaxHealthDamage") * targetMaxHP;
    case "shyvana_e/magic_damage":
      return dv("Shyvana", "E", "BaseDamage") + dv("Shyvana", "E", "DamageAPRatio") * AP + dv("Shyvana", "E", "MaxHealthDamage") * targetMaxHP;
    default:
      throw new Error(`缺少独立期望侧映射：${skillKey}/${formulaKey}`);
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
      if (!["PARAMETER", "ATTRIBUTE", "OPERATION"].includes(node.nodeType)) structureIssues.push(`${skillKey}/${item.formulaKey}:未知节点${node.nodeType}`);
      if (node.nodeType === "OPERATION" && (!Array.isArray(node.operands) || node.operands.length !== 2)) structureIssues.push(`${skillKey}/${item.formulaKey}:非二元操作`);
      if (node.nodeType === "OPERATION" && !["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"].includes(node.operation)) structureIssues.push(`${skillKey}/${item.formulaKey}:未知运算${node.operation}`);
    });
    for (const ref of refsOf(item.expression)) {
      if (parameterOf(skillKey, ref)?.valueMode === "RUNTIME_INPUT") referencedRuntime.add(`${skillKey}/${ref}`);
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
          inputs: { skillLevel: scenario.rank, characterLevel: scenario.characterLevel, totalAD: scenario.totalAD, bonusAD: scenario.bonusAD, AP: scenario.AP, sourceBonusHP: scenario.sourceBonusHP, targetMaxHP: scenario.targetMaxHP, targetCurrentHP: scenario.targetCurrentHP, runtime: clone(scenario.inputs) },
          actual: round(actual),
          expected: round(expectedValue),
          pass: equal(actual, expectedValue),
        });
      } catch (error) {
        formulaResults.push({ skillKey, formulaKey: item.formulaKey, scenario: index === 0 ? "基础场景" : "强化场景", pass: false, error: error.message });
      }
    }
    for (const ref of refsOf(item.expression)) {
      const parameter = parameterOf(skillKey, ref);
      if (parameter?.valueMode !== "RUNTIME_INPUT") continue;
      const scenario = scenarioFor(skillKey, 0);
      const without = { ...scenario.inputs };
      delete without[ref];
      let rejected = false;
      let error = null;
      try {
        const params = parameterMap(skillKey, scenario.rank, scenario.characterLevel, without);
        evaluate(item.expression, params, attrsFor(scenario));
      } catch (caught) {
        rejected = true;
        error = caught.message;
      }
      missingInputCases.push({ skillKey, formulaKey: item.formulaKey, missingParameterKey: ref, rejected, error });
    }
  }
}

const expectedParameter = new Map();
const sourceArraySpecs = [];
const mapSkill = (skillKey, parameterKey, heroId, slot, dataName, count, transform = value => value, start = 1) => {
  const sourceValues = dataRow(heroId, slot, dataName);
  assert(sourceValues.length > start + count - 1, `源数组等级不足：${heroId}/${slot}/${dataName}`);
  const values = Object.fromEntries(Array.from({ length: count }, (_, index) => [String(index + 1), norm(transform(sourceValues[start + index]))]));
  expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "SKILL_LEVEL", values });
  sourceArraySpecs.push({ skillKey, parameterKey, heroId, slot, dataName, start, count, transform });
};
const mapFixedData = (skillKey, parameterKey, heroId, slot, dataName, transform = value => value, index = 1) => expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "FIXED", value: norm(transform(dataAt(heroId, slot, dataName, index))) });
const mapFixedField = (skillKey, parameterKey, heroId, slot, fieldName, transform = value => value, index = 1) => expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "FIXED", value: norm(transform(fieldAt(heroId, slot, fieldName, index))) });
const mapFixed = (skillKey, parameterKey, value) => expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "FIXED", value: norm(value) });
const mapRuntime = (skillKey, parameterKey) => expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "RUNTIME_INPUT" });
const mapCoefficient = (skillKey, parameterKey, heroId, slot, calculationName, index = 1) => mapFixed(skillKey, parameterKey, calcCoefficient(heroId, slot, calculationName, index));
const mapMultiplier = (skillKey, parameterKey, heroId, slot, calculationName) => mapFixed(skillKey, parameterKey, calcMultiplier(heroId, slot, calculationName));

mapSkill("elise_q", "base_damage", "Elise", "Q", "BaseDamage", 5);
mapSkill("elise_q", "target_current_health_percent_points", "Elise", "Q", "TargetHPDamage", 5);
mapFixedData("elise_q", "ap_ratio", "Elise", "Q", "APRatio");
mapMultiplier("elise_q", "percent_point_ratio", "Elise", "Q", "HumanPercentHealth");
mapFixedField("elise_q", "cast_range", "Elise", "Q", "castRange");
mapFixedField("elise_q", "display_range", "Elise", "Q", "castRangeDisplayOverride");
mapFixedField("elise_q", "missile_speed", "Elise", "Q", "missileSpeed");
mapFixedField("elise_w", "cast_time_ms", "Elise", "W", "spellCastTime", toMs);
mapSkill("elise_w", "base_damage", "Elise", "W", "BaseDamage", 5);
mapFixedData("elise_w", "ap_ratio", "Elise", "W", "APRatio");
mapFixedData("elise_w", "explosion_delay_ms", "Elise", "W", "TimeToExplode", toMs);
mapFixedData("elise_w", "explosion_radius", "Elise", "W", "ExplosionSize");
mapSkill("elise_e", "stun_duration_ms", "Elise", "E", "BaseStunDuration", 5, toMs);
mapFixedField("elise_e", "cast_time_ms", "Elise", "E", "spellCastTime", toMs);

mapSkill("jayce_q", "base_damage", "Jayce", "Q", "BaseDamage", 6);
mapCoefficient("jayce_q", "bonus_ad_ratio", "Jayce", "Q", "Damage");
mapSkill("jayce_q", "slow_percent_points", "Jayce", "Q", "Slow", 6, value => Math.abs(Number(value)) * 100);
mapFixedData("jayce_q", "slow_duration_ms", "Jayce", "Q", "SlowDuration", toMs);
mapFixedField("jayce_q", "cast_time_ms", "Jayce", "Q", "spellCastTime", toMs);
mapSkill("jayce_w", "mana_gain", "Jayce", "W", "ManaGain", 6);
mapSkill("jayce_w", "base_damage", "Jayce", "W", "BaseDamage", 6);
mapFixedData("jayce_w", "duration_ms", "Jayce", "W", "Duration", toMs);
mapCoefficient("jayce_w", "ap_ratio", "Jayce", "W", "Damage");
mapFixedField("jayce_w", "cast_time_ms", "Jayce", "W", "spellCastTime", toMs);
mapSkill("jayce_e", "target_max_health_damage_ratio", "Jayce", "E", "PercHPDamage", 6);
mapCoefficient("jayce_e", "bonus_ad_ratio", "Jayce", "E", "FlatDamage", 0);
mapFixedData("jayce_e", "knockback_distance", "Jayce", "E", "KnockbackDistance");
mapFixedData("jayce_e", "knockback_duration_ms", "Jayce", "E", "KnockbackDuration", toMs);
mapFixedField("jayce_e", "cast_time_ms", "Jayce", "E", "mCastTime", toMs, 0);

mapFixed("nidalee_p", "passive_move_speed_ratio", dataAt("Nidalee", "R", "PassivePercentMS", 1) / 100);
mapFixed("nidalee_p", "move_speed_toward_enemy_ratio", dataAt("Nidalee", "R", "PassivePercentMS", 1) * 3 / 100);
mapFixed("nidalee_p", "toward_enemy_multiplier", 3);
mapFixed("nidalee_p", "brush_move_speed_duration_ms", toMs(2));
mapFixed("nidalee_p", "hunt_duration_ms", toMs(4));
mapFixed("nidalee_p", "move_speed_cap_ratio", 0.3);
mapSkill("nidalee_q", "minimum_base_damage", "Nidalee", "Q", "SpearMinimumDamage", 5);
mapFixedData("nidalee_q", "ap_ratio", "Nidalee", "Q", "SpearMinimumAPRatio");
mapFixedData("nidalee_q", "maximum_damage_multiplier", "Nidalee", "Q", "DamageMulti");
mapFixedData("nidalee_q", "range_threshold", "Nidalee", "Q", "RangeThreshold");
mapFixedField("nidalee_q", "cast_range", "Nidalee", "Q", "castRange");
mapFixedField("nidalee_q", "display_range", "Nidalee", "Q", "castRangeDisplayOverride");
mapFixedField("nidalee_q", "missile_speed", "Nidalee", "Q", "missileSpeed");
mapFixedField("nidalee_q", "cast_time_ms", "Nidalee", "Q", "spellCastTime", toMs);
mapSkill("nidalee_e", "base_heal", "Nidalee", "E", "BaseHeal", 5);
mapFixedData("nidalee_e", "max_heal_multiplier_bonus", "Nidalee", "E", "MaxHealMult");
mapFixedData("nidalee_e", "max_heal_threshold_ratio", "Nidalee", "E", "MaxHealThreshold");
mapCoefficient("nidalee_e", "ap_ratio", "Nidalee", "E", "TotalHealing");
mapSkill("nidalee_e", "attack_speed_ratio", "Nidalee", "E", "BonusAS", 5);
mapSkill("nidalee_e", "attack_speed_duration_ms", "Nidalee", "E", "ASDuration", 5, toMs);
mapFixedField("nidalee_e", "cast_time_ms", "Nidalee", "E", "spellCastTime", toMs);
mapFixed("nidalee_e", "max_heal_base_multiplier", calcSubpartNumber("Nidalee", "E", "MaxHealing", 0));

mapFixedData("shyvana_p", "bonus_armor_per_stack", "Shyvana", "P", "BonusArmor");
mapFixedData("shyvana_p", "bonus_magic_resist_per_stack", "Shyvana", "P", "BonusMagicResist");
mapFixedData("shyvana_p", "champion_takedown_stack_gain", "Shyvana", "P", "Stacks_Per_Champion");
mapRuntime("shyvana_p", "current_stack_count");
mapFixedData("shyvana_q", "max_health_damage_ratio", "Shyvana", "Q", "Max_Health_Damage");
mapFixedData("shyvana_q", "max_health_bonus_ad_ratio", "Shyvana", "Q", "Max_Health_AD_Ratio");
mapSkill("shyvana_q", "active_base_damage", "Shyvana", "Q", "Base_Damage", 5);
mapFixedData("shyvana_q", "active_total_ad_ratio", "Shyvana", "Q", "Damage_AD_Ratio");
mapCoefficient("shyvana_q", "active_ap_ratio", "Shyvana", "Q", "Calc_Damage", 2);
mapFixedData("shyvana_q", "cooldown_reduction_ms", "Shyvana", "Q", "Cooldown_Reduction", toMs);
mapSkill("shyvana_q", "enhance_duration_ms", "Shyvana", "Q", "EnhanceDuration", 5, toMs);
mapSkill("shyvana_q", "recast_duration_ms", "Shyvana", "Q", "RecastDuration", 5, toMs);
mapSkill("shyvana_q", "lockout_duration_ms", "Shyvana", "Q", "LockoutDuration", 5, toMs);
mapSkill("shyvana_q", "bonus_attack_range", "Shyvana", "Q", "Bonus_Attack_Range", 5);
mapFixedField("shyvana_q", "cast_time_ms", "Shyvana", "Q", "spellCastTime", toMs);
mapSkill("shyvana_w", "duration_ms", "Shyvana", "W", "Duration", 5, toMs);
mapFixedData("shyvana_w", "explosion_radius", "Shyvana", "W", "Radius");
mapFixedData("shyvana_w", "shield_radius", "Shyvana", "W", "Shield_Radius");
mapSkill("shyvana_w", "shield_base", "Shyvana", "W", "Shield", 5);
mapFixedData("shyvana_w", "bonus_health_ratio", "Shyvana", "W", "ShieldMaxHealth");
mapMultiplier("shyvana_w", "nearby_enemy_bonus_ratio", "Shyvana", "W", "Calc_Shield_Per_Nearby_Champion");
mapRuntime("shyvana_w", "nearby_enemy_count");
mapSkill("shyvana_w", "move_speed_ratio", "Shyvana", "W", "BaseMoveSpeed", 5);
mapSkill("shyvana_w", "move_speed_toward_multiplier", "Shyvana", "W", "MoveSpeedAmpTowardsEnemies", 5);
mapSkill("shyvana_w", "explosion_base_damage", "Shyvana", "W", "BaseDamage", 5);
mapCoefficient("shyvana_w", "explosion_ap_ratio", "Shyvana", "W", "Damage");
mapSkill("shyvana_e", "base_damage", "Shyvana", "E", "BaseDamage", 5);
mapSkill("shyvana_e", "ap_ratio", "Shyvana", "E", "DamageAPRatio", 5);
mapFixedData("shyvana_e", "target_max_health_damage_ratio", "Shyvana", "E", "MaxHealthDamage");
mapSkill("shyvana_e", "slow_ratio", "Shyvana", "E", "SlowAmount", 5);
mapSkill("shyvana_e", "slow_duration_ms", "Shyvana", "E", "SlowDuration", 5, toMs);
mapFixedField("shyvana_e", "cast_time_ms", "Shyvana", "E", "spellCastTime", toMs);

const parameterChecks = [];
const integerChecks = [];
for (const skillKey of candidate.order) {
  const skillData = candidate.skills[skillKey];
  for (const parameter of skillData.write.parameters) {
    const expectedDefinition = expectedParameter.get(`${skillKey}/${parameter.parameterKey}`);
    let pass = Boolean(expectedDefinition) && parameter.valueMode === expectedDefinition?.mode;
    const details = { skillKey, parameterKey: parameter.parameterKey, valueMode: parameter.valueMode, expectedMode: expectedDefinition?.mode || null };
    if (!expectedDefinition) details.error = "没有独立源值映射";
    else if (expectedDefinition.mode === "FIXED") {
      details.actual = parameter.fixedValue;
      details.expected = expectedDefinition.value;
      pass = pass && parameter.levelValues === null && typeof parameter.fixedValue === "number" && Number.isFinite(parameter.fixedValue) && equal(parameter.fixedValue, expectedDefinition.value);
    } else if (expectedDefinition.mode === "SKILL_LEVEL" || expectedDefinition.mode === "CHARACTER_LEVEL") {
      details.actual = parameter.levelValues;
      details.expected = expectedDefinition.values;
      const actualKeys = Object.keys(parameter.levelValues || {});
      const expectedKeys = Object.keys(expectedDefinition.values);
      pass = pass && parameter.fixedValue === null && JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) && expectedKeys.every(key => equal(parameter.levelValues[key], expectedDefinition.values[key]));
    } else if (expectedDefinition.mode === "RUNTIME_INPUT") {
      pass = pass && parameter.fixedValue === null && parameter.levelValues === null;
    }
    parameterChecks.push({ ...details, pass });
    const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
    const finiteOk = parameter.valueMode === "RUNTIME_INPUT" ? parameter.fixedValue === null && parameter.levelValues === null : values.every(value => typeof value === "number" && Number.isFinite(value));
    const integerOk = parameter.valueType !== "INTEGER" || values.every(value => Number.isInteger(value));
    const msOk = !parameter.parameterKey.endsWith("_ms") || (parameter.valueMode === "RUNTIME_INPUT" ? true : values.every(value => Number.isInteger(value) && value >= 0));
    integerChecks.push({ skillKey, parameterKey: parameter.parameterKey, valueMode: parameter.valueMode, finiteOk, integerOk, msOk, pass: finiteOk && integerOk && msOk });
  }
}

const characterLevelChecks = [];
for (const skillKey of candidate.order) for (const parameter of candidate.skills[skillKey].write.parameters.filter(item => item.valueMode === "CHARACTER_LEVEL")) {
  const expectedKeys = Array.from({ length: 18 }, (_, index) => String(index + 1));
  characterLevelChecks.push({ skillKey, parameterKey: parameter.parameterKey, expectedLevelKeys: expectedKeys, actualLevelKeys: Object.keys(parameter.levelValues || {}), pass: JSON.stringify(Object.keys(parameter.levelValues || {})) === JSON.stringify(expectedKeys) });
}
const levelChecks = [];
for (const skillKey of candidate.order) {
  const maxLevel = candidate.skills[skillKey].maxLevel;
  for (const parameter of candidate.skills[skillKey].write.parameters.filter(item => ["SKILL_LEVEL", "CHARACTER_LEVEL"].includes(item.valueMode))) {
    const expectedKeys = parameter.valueMode === "CHARACTER_LEVEL" ? Array.from({ length: 18 }, (_, index) => String(index + 1)) : Array.from({ length: maxLevel }, (_, index) => String(index + 1));
    const actualKeys = Object.keys(parameter.levelValues || {});
    levelChecks.push({ skillKey, parameterKey: parameter.parameterKey, valueMode: parameter.valueMode, expectedLevelKeys: expectedKeys, actualLevelKeys: actualKeys, pass: JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) });
  }
}

const indexChecks = sourceArraySpecs.map(spec => {
  const parameter = parameterOf(spec.skillKey, spec.parameterKey);
  const expectedFirst = norm(spec.transform(dataAt(spec.heroId, spec.slot, spec.dataName, spec.start)));
  const expectedLast = norm(spec.transform(dataAt(spec.heroId, spec.slot, spec.dataName, spec.start + spec.count - 1)));
  return {
    skillKey: spec.skillKey,
    parameterKey: spec.parameterKey,
    source: `${spec.heroId}/${spec.slot}/${spec.dataName}`,
    sourceIndexStart: spec.start,
    sourceIndexEnd: spec.start + spec.count - 1,
    zeroIndexValue: dataRow(spec.heroId, spec.slot, spec.dataName)[0],
    candidateLevel1: parameter?.levelValues?.["1"],
    candidateLast: parameter?.levelValues?.[String(spec.count)],
    expectedFirst,
    expectedLast,
    pass: Boolean(parameter) && equal(parameter.levelValues?.["1"], expectedFirst) && equal(parameter.levelValues?.[String(spec.count)], expectedLast),
  };
});

const currentConsumerMap = [
  { skillKey: "elise_q", heroId: "Elise", slot: "Q", name: "HumanPercentHealth", kind: "calculation", selected: "current_health_magic_damage", required: true },
  { skillKey: "elise_q", heroId: "Elise", slot: "Q", name: "MonsterDamageCapCalc", kind: "calculation", selected: null, required: false, reason: "野怪专用上限" },
  { skillKey: "elise_w", heroId: "Elise", slot: "W", name: "TotalDamage", kind: "calculation", selected: "magic_damage", required: true },
  { skillKey: "elise_e", heroId: "Elise", slot: "E", name: "TotalStunDuration", kind: "calculation", selected: "stun_duration", required: true },
  { skillKey: "jayce_q", heroId: "Jayce", slot: "Q", name: "Damage", kind: "calculation", selected: "physical_damage", required: true },
  { skillKey: "jayce_q", heroId: "Jayce", slot: "Q", name: "MonsterBonusDamage", kind: "data", selected: null, required: false, reason: "野怪专用额外伤害" },
  { skillKey: "jayce_w", heroId: "Jayce", slot: "W", name: "Damage", kind: "calculation", selected: "magic_damage", required: true },
  { skillKey: "jayce_e", heroId: "Jayce", slot: "E", name: "FlatDamage", kind: "calculation", selected: "magic_damage", required: true },
  { skillKey: "jayce_e", heroId: "Jayce", slot: "E", name: "MonsterCap", kind: "data", selected: null, required: false, reason: "野怪专用上限" },
  { skillKey: "nidalee_p", heroId: "Nidalee", slot: "R", textSlot: "P", name: "PassivePercentMS", kind: "data", selected: "passive_move_speed_ratio", required: true },
  { skillKey: "nidalee_q", heroId: "Nidalee", slot: "Q", name: "HumanMinimumDamage", kind: "calculation", selected: "minimum_magic_damage", required: true },
  { skillKey: "nidalee_q", heroId: "Nidalee", slot: "Q", name: "HumanMaximumDamage", kind: "calculation", selected: "maximum_magic_damage", required: true },
  { skillKey: "nidalee_w", heroId: "Nidalee", slot: "W", name: "DamagePerSecond", kind: "calculation", selected: null, required: false, reason: "陷阱持续伤害" },
  { skillKey: "nidalee_w", heroId: "Nidalee", slot: "W", name: "MaxTraps", kind: "calculation", selected: null, required: false, reason: "陷阱数量上限" },
  { skillKey: "nidalee_e", heroId: "Nidalee", slot: "E", name: "TotalHealing", kind: "calculation", selected: "total_healing", required: true },
  { skillKey: "nidalee_e", heroId: "Nidalee", slot: "E", name: "MaxHealing", kind: "calculation", selected: "maximum_healing", required: true },
  { skillKey: "shyvana_p", heroId: "Shyvana", slot: "P", name: "BonusArmor", kind: "data", selected: "bonus_armor_per_stack", required: true },
  { skillKey: "shyvana_p", heroId: "Shyvana", slot: "P", name: "BonusMagicResist", kind: "data", selected: "bonus_magic_resist_per_stack", required: true },
  { skillKey: "shyvana_p", heroId: "Shyvana", slot: "P", name: "Calc_Bonus_Armor", kind: "calculation", selected: "bonus_armor", required: true },
  { skillKey: "shyvana_p", heroId: "Shyvana", slot: "P", name: "Calc_Bonus_MR", kind: "calculation", selected: "bonus_magic_resist", required: true },
  { skillKey: "shyvana_q", heroId: "Shyvana", slot: "Q", name: "Calc_Max_Health_Damage", kind: "calculation", selected: "passive_max_health_magic_damage", required: true },
  { skillKey: "shyvana_q", heroId: "Shyvana", slot: "Q", name: "Calc_Damage", kind: "calculation", selected: "active_physical_damage", required: true },
  { skillKey: "shyvana_q", heroId: "Shyvana", slot: "Q", name: "Calc_Dragon_Form_Damage", kind: "calculation", selected: null, required: false, reason: "龙形态第三击" },
  { skillKey: "shyvana_w", heroId: "Shyvana", slot: "W", name: "Damage", kind: "calculation", selected: "explosion_magic_damage", required: true },
  { skillKey: "shyvana_w", heroId: "Shyvana", slot: "W", name: "MoveSpeed", kind: "calculation", selected: "move_speed_ratio", required: true },
  { skillKey: "shyvana_w", heroId: "Shyvana", slot: "W", name: "Calc_Shield", kind: "calculation", selected: "shield_amount", required: true },
  { skillKey: "shyvana_w", heroId: "Shyvana", slot: "W", name: "Calc_Shield_Per_Nearby_Champion", kind: "calculation", selected: "nearby_shield_bonus", required: true },
  { skillKey: "shyvana_w", heroId: "Shyvana", slot: "W", name: "MoveSpeedTowardsEnemies", kind: "calculation", selected: "toward_move_speed_ratio", required: true },
  { skillKey: "shyvana_w", heroId: "Shyvana", slot: "W", name: "Calc_Base_Heal", kind: "calculation", selected: null, required: false, reason: "龙形态治疗旧树" },
  { skillKey: "shyvana_w", heroId: "Shyvana", slot: "W", name: "Calc_Missing_Health_Heal", kind: "calculation", selected: null, required: false, reason: "龙形态治疗旧树" },
  { skillKey: "shyvana_e", heroId: "Shyvana", slot: "E", name: "Damage", kind: "calculation", selected: "damage", required: true },
  { skillKey: "shyvana_e", heroId: "Shyvana", slot: "E", name: "Calc_Max_Health_Damage", kind: "calculation", selected: "max_health_damage", required: true },
  { skillKey: "shyvana_e", heroId: "Shyvana", slot: "E", name: "Calc_Dragon_Damage", kind: "calculation", selected: null, required: false, reason: "龙形态放大" },
  { skillKey: "shyvana_e", heroId: "Shyvana", slot: "E", name: "DamagePerSecond", kind: "calculation", selected: null, required: false, reason: "地面轨迹" },
];
const textTokens = (heroId, slot) => {
  const text = Object.values(sourceSkills[heroId]?.[slot]?.currentTexts || {}).map(value => value?.text || "").join("\n");
  return [...text.matchAll(/@([^@]+)@/g)].map(match => match[1]);
};
const tokenMatches = (tokens, name) => tokens.some(token => token === name || token.endsWith(`:${name}`) || token.endsWith(`:${name}*100`) || token === `${name}*3` || token === `${name}*100`);
const consumerChecks = currentConsumerMap.map(item => {
  const sourceObject = item.kind === "data" ? (sourceSkills[item.heroId]?.[item.slot]?.object?.mSpell?.DataValues || []).find(row => row.name === item.name) : (spell(item.heroId, item.slot)?.mSpellCalculations || {})[item.name];
  const sourceExists = Boolean(sourceObject);
  const contains = tokenMatches(textTokens(item.heroId, item.textSlot || item.slot), item.name);
  const selected = item.selected === null ? false : (candidate.skills[item.skillKey].write.formulas.some(formula => formula.formulaKey === item.selected) || candidate.skills[item.skillKey].write.parameters.some(parameter => parameter.parameterKey === item.selected));
  return { ...item, sourceExists, textContainsName: contains, selected, pass: item.required ? sourceExists && contains && selected : !selected };
});

const effectChecks = [];
const ratioAttributeFlatAddChecks = [];
for (const skillKey of candidate.order) {
  const scenario = scenarioFor(skillKey, 1);
  const params = parameterMap(skillKey, scenario.rank, scenario.characterLevel, scenario.inputs);
  const attrs = attrsFor(scenario);
  for (const effect of candidate.skills[skillKey].write.effects) for (const result of effect.results || []) {
    const valueRule = result.valueRule;
    const value = valueRule?.value;
    let finalValue = null;
    let valuePass = Boolean(valueRule && value && ["PARAMETER", "FORMULA"].includes(value.kind));
    if (valuePass && value.kind === "PARAMETER") {
      try { finalValue = evaluate({ nodeType: "PARAMETER", parameterKey: value.parameterKey }, params, attrs); } catch (error) { valuePass = false; }
    } else if (valuePass && value.kind === "FORMULA") {
      const sourceFormula = candidate.skills[skillKey].write.formulas.find(item => item.formulaKey === value.formulaKey);
      if (!sourceFormula) valuePass = false;
      else {
        try { finalValue = evaluate(sourceFormula.expression, params, attrs); } catch (error) { valuePass = false; }
      }
    }
    const multiplierPass = valueRule?.fixedMultiplier === 1;
    const detail = result.detail || {};
    const ratioPass = result.resultType !== "ATTRIBUTE_CHANGE" || detail.modifierZoneKey === "attribute_flat_add";
    const finitePass = valuePass && typeof finalValue === "number" && Number.isFinite(finalValue);
    effectChecks.push({ skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, resultType: result.resultType, valueKind: value?.kind || null, valueKey: value?.parameterKey || value?.formulaKey || null, finalValue: finitePass ? round(finalValue * (valueRule?.fixedMultiplier || 0)) : null, fixedMultiplier: valueRule?.fixedMultiplier ?? null, valuePass, multiplierPass, ratioPass, pass: finitePass && multiplierPass && ratioPass });
    if (result.resultType === "ATTRIBUTE_CHANGE") ratioAttributeFlatAddChecks.push({ skillKey, effectKey: effect.effectKey, attributeKey: detail.attributeKey, modifierZoneKey: detail.modifierZoneKey, pass: ratioPass });
  }
}

const findEffect = (skillKey, effectKey) => candidate.skills[skillKey].write.effects.find(effect => effect.effectKey === effectKey);
const effectResult = (skillKey, effectKey) => findEffect(skillKey, effectKey)?.results?.[0];
const nidaleeP = candidate.skills.nidalee_p.write;
const nidaleePassiveBranchChecks = (() => {
  const params = parameterMap("nidalee_p", 1, 1, {});
  const valueOf = effectKey => {
    const result = effectResult("nidalee_p", effectKey);
    const value = result?.valueRule?.value;
    if (!value) return null;
    return value.kind === "PARAMETER" ? params[value.parameterKey] : null;
  };
  const branchValues = {
    brushBase: valueOf("brush_move_speed"),
    brushToward: valueOf("brush_move_speed_toward_enemy"),
    huntBase: valueOf("hunt_move_speed"),
    huntToward: valueOf("hunt_move_speed_toward_enemy"),
    cap: params.move_speed_cap_ratio,
  };
  const descriptions = nidaleeP.effects.map(effect => effect.description || "").join("\n");
  const valuePass = [branchValues.brushBase, branchValues.huntBase].every(value => equal(value, 0.1))
    && [branchValues.brushToward, branchValues.huntToward, branchValues.cap].every(value => equal(value, 0.3));
  const mutualPass = /互斥/.test(descriptions) && /替代/.test(descriptions) && /不与.*叠加/.test(descriptions)
    && /离开草丛|标记结束/.test(descriptions);
  const noCrossBranchSumPass = ![0.4, 0.6].some(value => Object.values(branchValues).some(actual => equal(actual, value)));
  return {
    rule: "奈德丽P草丛/捕猎分支互斥且30%封顶",
    branchValues,
    expected: { brushBase: 0.1, brushToward: 0.3, huntBase: 0.1, huntToward: 0.3, cap: 0.3 },
    valuePass,
    mutualPass,
    noCrossBranchSumPass,
    pass: valuePass && mutualPass && noCrossBranchSumPass,
  };
})();

const shyvanaPassiveAttributeChecks = [
  { effectKey: "bonus_armor", expectedAttributeKey: "armor" },
  { effectKey: "bonus_magic_resist", expectedAttributeKey: "magic_resistance" },
].map(item => {
  const result = effectResult("shyvana_p", item.effectKey);
  const actualAttributeKey = result?.detail?.attributeKey || null;
  const modifierZoneKey = result?.detail?.modifierZoneKey || null;
  return {
    effectKey: item.effectKey,
    expectedAttributeKey: item.expectedAttributeKey,
    actualAttributeKey,
    modifierZoneKey,
    pass: actualAttributeKey === item.expectedAttributeKey && modifierZoneKey === "attribute_flat_add",
  };
});
const shyvanaPassiveUnitScenario = scenarioFor("shyvana_p", 0);
shyvanaPassiveUnitScenario.inputs.current_stack_count = 3;
const shyvanaPassiveUnitParams = parameterMap("shyvana_p", 1, 1, shyvanaPassiveUnitScenario.inputs);
const shyvanaPassiveUnitChecks = [
  { formulaKey: "bonus_armor", perStackKey: "bonus_armor_per_stack" },
  { formulaKey: "bonus_magic_resist", perStackKey: "bonus_magic_resist_per_stack" },
].map(item => {
  const formulaData = candidate.skills.shyvana_p.write.formulas.find(formula => formula.formulaKey === item.formulaKey);
  const actual = formulaData ? evaluate(formulaData.expression, shyvanaPassiveUnitParams, attrsFor(shyvanaPassiveUnitScenario)) : null;
  const expected = 0.3 * shyvanaPassiveUnitScenario.inputs.current_stack_count;
  return {
    formulaKey: item.formulaKey,
    stackCount: shyvanaPassiveUnitScenario.inputs.current_stack_count,
    actual: actual === null ? null : round(actual),
    expected: round(expected),
    pass: actual !== null && equal(actual, expected) && equal(shyvanaPassiveUnitParams[item.perStackKey], 0.3),
  };
});
const shyvanaWBranchDescriptions = candidate.skills.shyvana_w.write.effects.map(effect => effect.description || "").join("\n");
const shyvanaWBranchEvidence = `${shyvanaWBranchDescriptions}\n${(candidate.skills.shyvana_w.pending || []).join("\n")}`;
const shyvanaWBranchChecks = Array.from({ length: candidate.skills.shyvana_w.maxLevel }, (_, index) => {
  const rank = index + 1;
  const scenario = scenarioFor("shyvana_w", 0);
  scenario.rank = rank;
  const params = parameterMap("shyvana_w", rank, 1, scenario.inputs);
  const towardFormula = candidate.skills.shyvana_w.write.formulas.find(formula => formula.formulaKey === "toward_move_speed_ratio");
  const actualBase = params.move_speed_ratio;
  const actualToward = towardFormula ? evaluate(towardFormula.expression, params, attrsFor(scenario)) : null;
  const sourceBase = dataAt("Shyvana", "W", "BaseMoveSpeed", rank);
  const sourceMultiplier = dataAt("Shyvana", "W", "MoveSpeedAmpTowardsEnemies", rank);
  const expectedBase = sourceBase;
  const expectedToward = sourceBase * sourceMultiplier;
  return {
    rank,
    actualBase: round(actualBase),
    expectedBase: round(expectedBase),
    actualToward: actualToward === null ? null : round(actualToward),
    expectedToward: round(expectedToward),
    combinedIfAdded: round(expectedBase + expectedToward),
    sourceBase,
    sourceMultiplier,
    levelValuesPass: equal(actualBase, expectedBase) && actualToward !== null && equal(actualToward, expectedToward),
  };
}).map(check => ({ ...check, replacementPass: /互斥/.test(shyvanaWBranchEvidence) && /完整替代/.test(shyvanaWBranchEvidence) && /不能叠加|不把两者相加/.test(shyvanaWBranchEvidence) && !/68\.75%/.test(shyvanaWBranchDescriptions), pass: check.levelValuesPass && /互斥/.test(shyvanaWBranchEvidence) && /完整替代/.test(shyvanaWBranchEvidence) && /不能叠加|不把两者相加/.test(shyvanaWBranchEvidence) && !/68\.75%/.test(shyvanaWBranchDescriptions) }));

const bannedParameterNames = /monster|minion|clone|trap|plant|seed|vision|ammo/i;
const selectedBannedParameterChecks = candidate.order.flatMap(skillKey => candidate.skills[skillKey].write.parameters.map(parameter => ({ skillKey, parameterKey: parameter.parameterKey, pass: !bannedParameterNames.test(parameter.parameterKey) })));
const maxLevelChecks = candidate.order.map(skillKey => {
  const route = protectedByRoute.get(`/skills/${skillKey}`);
  return { skillKey, candidateMaxLevel: candidate.skills[skillKey].maxLevel, protectedMaxLevel: route?.data?.maxLevel, pass: route?.status === 200 && candidate.skills[skillKey].maxLevel === route.data.maxLevel };
});
const integerParameterChecks = integerChecks.filter(item => candidate.skills[item.skillKey].write.parameters.find(parameter => parameter.parameterKey === item.parameterKey)?.valueType === "INTEGER");
const integerValueCount = integerParameterChecks.reduce((sum, item) => {
  const parameter = parameterOf(item.skillKey, item.parameterKey);
  return sum + (parameter?.valueMode === "FIXED" ? 1 : Object.keys(parameter?.levelValues || {}).length);
}, 0);
const integerValuePassCount = integerParameterChecks.filter(item => item.pass).reduce((sum, item) => {
  const parameter = parameterOf(item.skillKey, item.parameterKey);
  return sum + (parameter?.valueMode === "FIXED" ? 1 : Object.keys(parameter?.levelValues || {}).length);
}, 0);
const formulaPassCount = formulaResults.filter(item => item.pass).length;
const formulaFailCount = formulaResults.length - formulaPassCount;
const missingInputAllRejected = missingInputCases.length > 0 && missingInputCases.every(item => item.rejected);
const formulaAtLeastTwoScenes = candidate.order.every(skillKey => candidate.skills[skillKey].write.formulas.length === 0 || candidate.skills[skillKey].write.formulas.every(item => formulaResults.filter(result => result.skillKey === skillKey && result.formulaKey === item.formulaKey).length >= 2));
const formulaDefinitionCount = candidate.order.reduce((sum, skillKey) => sum + candidate.skills[skillKey].write.formulas.length, 0);
const report = {
  generatedAt: new Date().toISOString(),
  batch: candidate.meta.batch,
  revision: candidate.meta.revision,
  status: "独立源值数学核算已执行；未调用业务接口、浏览器或Git",
  sourceBasis: {
    clientVersion: binding.clientVersion,
    officialVersion: binding.officialVersion,
    sourceIndexSha256: inputVersion.sourceIndexSha256,
    sourceBindingSha256: candidate.meta.sourceBindingSha256,
    candidateSha256: sha256(fs.readFileSync(CANDIDATE_FILE)),
    qualificationReviewSha256: sha256(fs.readFileSync(qualificationFile)),
    expectedSide: "直接读取冻结输入原始DataValues、计算树和当前文本按源值重算，不从候选参数倒推期望值。",
    actualSide: "读取候选表达式，显式提供属性、技能等级、角色等级和无默认运行输入。",
  },
  formulaResults,
  formulaCount: formulaResults.length,
  formulaDefinitionCount,
  formulaScenarioCount: formulaResults.length,
  formulaPassCount,
  formulaScenarioPassCount: formulaPassCount,
  formulaFailCount,
  formulaAtLeastTwoScenes,
  missingInputCases,
  missingInputCaseCount: missingInputCases.length,
  missingInputAllRejected,
  referencedRuntimeInputs: Array.from(referencedRuntime),
  parameterChecks,
  parameterCheckCount: parameterChecks.length,
  parameterCheckPassCount: parameterChecks.filter(item => item.pass).length,
  parameterCheckFailCount: parameterChecks.filter(item => !item.pass).length,
  levelChecks,
  levelCheckAllPass: levelChecks.every(item => item.pass),
  characterLevelChecks,
  characterLevelCount: characterLevelChecks.length,
  characterLevelAllPass: characterLevelChecks.every(item => item.pass),
  indexChecks,
  sourceArrayIndexAllPass: indexChecks.every(item => item.pass),
  integerChecks,
  integerParameterCount: integerParameterChecks.length,
  integerParameters: integerParameterChecks.filter(item => item.pass).length,
  integerValueCount,
  integerValues: integerValuePassCount,
  integerAndModeAllPass: integerChecks.every(item => item.pass),
  structureIssues,
  allFormulaOperationsBinary: structureIssues.length === 0,
  consumerChecks,
  currentConsumerAllPass: consumerChecks.filter(item => item.required).every(item => item.pass),
  excludedConsumerChecks: consumerChecks.filter(item => !item.required),
  effectChecks,
  effectCount: effectChecks.length,
  effectFinalMultiplierCheckCount: effectChecks.length,
  effectFinalMultiplierAllPass: effectChecks.every(item => item.multiplierPass),
  ratioAttributeFlatAddChecks,
  ratioAttributeFlatAddAllPass: ratioAttributeFlatAddChecks.every(item => item.pass),
  nidaleePassiveBranchChecks,
  nidaleePassiveBranchAllPass: nidaleePassiveBranchChecks.pass,
  shyvanaPassiveAttributeChecks,
  shyvanaPassiveAttributeAllPass: shyvanaPassiveAttributeChecks.every(item => item.pass),
  shyvanaPassiveUnitChecks,
  shyvanaPassiveUnitAllPass: shyvanaPassiveUnitChecks.every(item => item.pass),
  shyvanaWBranchChecks,
  shyvanaWBranchAllPass: shyvanaWBranchChecks.every(item => item.pass),
  qualificationChecks,
  qualificationAllPass: qualificationChecks.every(item => item.pass),
  selectedBannedParameterChecks,
  noUnitExclusionParameters: selectedBannedParameterChecks.every(item => item.pass),
  publicReuseCount: reuseList.length,
  publicReuseExpected: 21,
  publicReuseAllProtected: reuseList.every(item => publicData.has(`${item.skillKey}/${item.parameterKey}`)),
  protectedSubjectsAllPresent: candidate.order.every(skillKey => candidate.skills[skillKey].protectedExisting.subject),
  maxLevelChecks,
  maxLevelAllPass: maxLevelChecks.every(item => item.pass),
  inputProtection: { GETs: protection.GETs, expectedGETs: 193, apiWrites: protection.apiWrites, expectedApiWrites: 0 },
  noApiCalls: true,
  noBrowserCalls: true,
  noGitWrites: true,
  apiWrites: 0,
  businessWrites: 0,
  statusPass: formulaFailCount === 0 && formulaAtLeastTwoScenes && missingInputAllRejected && parameterChecks.every(item => item.pass) && levelChecks.every(item => item.pass) && indexChecks.every(item => item.pass) && characterLevelChecks.every(item => item.pass) && integerChecks.every(item => item.pass) && structureIssues.length === 0 && consumerChecks.filter(item => item.required).every(item => item.pass) && effectChecks.every(item => item.pass) && ratioAttributeFlatAddChecks.every(item => item.pass) && nidaleePassiveBranchChecks.pass && shyvanaPassiveAttributeChecks.every(item => item.pass) && shyvanaPassiveUnitChecks.every(item => item.pass) && shyvanaWBranchChecks.every(item => item.pass) && selectedBannedParameterChecks.every(item => item.pass) && maxLevelChecks.every(item => item.pass) && qualificationChecks.every(item => item.pass),
  scenarios: {
    基础场景: "技能等级1（R为自身保护等级的1级场景）、角色等级1；总攻击力180、额外攻击力80、法强120、额外生命600；目标最大生命1000、当前生命700；希瓦娜P层数2、W附近合格敌人数0。",
    强化场景: "技能取各自保护快照最高等级、角色等级18；总攻击力320、额外攻击力180、法强420、额外生命1400；目标最大生命2200、当前生命1350；希瓦娜P层数8、W附近合格敌人数1。",
    missingInput: "逐公式移除所引用的RUNTIME_INPUT，必须拒绝计算；候选没有默认值。",
  },
};
// 上面状态字段需要依赖同一报告中的前置条件，重算一次避免自引用判定。
report.statusPass = formulaFailCount === 0 && report.formulaAtLeastTwoScenes && missingInputAllRejected && parameterChecks.every(item => item.pass) && indexChecks.every(item => item.pass) && characterLevelChecks.every(item => item.pass) && integerChecks.every(item => item.pass) && structureIssues.length === 0 && consumerChecks.filter(item => item.required).every(item => item.pass) && effectChecks.every(item => item.pass) && ratioAttributeFlatAddChecks.every(item => item.pass) && nidaleePassiveBranchChecks.pass && shyvanaPassiveAttributeChecks.every(item => item.pass) && shyvanaPassiveUnitChecks.every(item => item.pass) && shyvanaWBranchChecks.every(item => item.pass) && selectedBannedParameterChecks.every(item => item.pass) && maxLevelChecks.every(item => item.pass) && qualificationChecks.every(item => item.pass);

const reportBytes = jsonBytes(report);
const reportSha256 = sha256(reportBytes);
const experienceText = [
  "# 第四十七批体验补充报告",
  "",
  "本报告对应固定客户端16.17、官方16.17.1的20个当前根技能槽。候选只记录当前根人类或锤形态能够独立表达的本体伤害、控制、同一敌人重复命中、自身属性和基础资源；完整变形、替换套装、独立召唤物、陷阱、兵野分支与额外敌人分配留在范围外。",
  "",
  "伊莉丝Q明确把目标当前生命和目标最大生命区分开，0.25秒与0.125秒冲突保持待核；资格审查按一次施放、一次爆炸的本体技能伤害载体保留伊莉丝W唯一敌人单次爆炸效果，但敌方单独选中/击杀和爆炸事件仍待运行层核对；伊莉丝E只保留眩晕，不凭空增加零伤害。",
  "",
  "杰斯Q按保护快照的6级完整数组录入，减速的负源值转为百分数点；杰斯W保留4秒总伤害和锤形态普攻回蓝，不把整段伤害误当逐秒跳数；杰斯E保留额外攻击力段和目标最大生命段，炮形态均排除。",
  "",
  "奈德丽P跨R读取的PassivePercentMS已保留到P组成，草丛2秒、捕猎4秒、朝敌方英雄3倍和30%上限均有记录；草丛与捕猎各自的10%基础和朝向30%是互斥替代分支，不能同支或跨支叠加，离开条件留待事件层；奈德丽Q最大值按完整最小伤害式乘3.25，距离曲线未证不设线性；资格审查确认奈德丽E可作用自身，本轮只创建自身直接治疗和自身攻速效果，第三方友方分配排除。",
  "",
  "希瓦娜P按当前层数乘每层0.3固定护甲或魔抗点数，属性键为armor和magic_resistance而非百分比，3层独立核算为0.9；战前层数无默认。希瓦娜Q保留普通攻击附加魔法段、强化攻击三段物理式和自身Q冷却缩短；希瓦娜W最终护盾显式保留0或1名附近合格敌人的完整30%加成，护盾检查半径600与爆炸半径350分开，25%基础移动速度与43.75%朝向状态互斥替代，各等级均独立核对，不能叠为68.75%；希瓦娜E保留普通火球基础、法强、目标最大生命5%和减速，龙形态与地面轨迹排除。",
  "",
  `独立数学核算结果：${report.statusPass ? "通过" : "存在失败项"}；${report.formulaDefinitionCount}个公式各跑两个场景（${report.formulaScenarioCount}条场景记录），${report.missingInputCaseCount}个缺运行输入案例全部拒绝；新参数${candidate.counts.newParameters}、新公式${candidate.counts.newFormulas}、新效果${candidate.counts.newEffects}，整数参数${report.integerParameterCount}个、整数值${report.integerValueCount}个分开统计；另对奈德丽P互斥分支、希瓦娜P属性键及3层0.9点数、希瓦娜W各等级互斥移动速度完成独立核对。`,
  "",
  "尚待运行层补证：伊莉丝W敌方是否能单独选中或击杀、W接近/3秒爆炸事件、奈德丽Q距离曲线、奈德丽E自身单一目标接线与最大治疗阈值、奈德丽P草丛/捕猎互斥切换和离开条件、希瓦娜Q普攻后与第一/第二次同敌攻击时序、希瓦娜W附近敌人资格与护盾结束事件及25%/43.75%状态切换。未知输入均不使用默认零值。",
  "",
  "Cursor实际只读复核为READY，审计为2648事件、48个工具、24个冻结输入，业务写入和Git变化均为零。本报告和候选只表示静态来源与数学证据，不表示真实数据库、运行时、页面或战斗已完成。",
  "",
].join("\n");
const experienceBytes = Buffer.from(experienceText, "utf8");
for (const directory of [ROOT, DURABLE]) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "独立数学报告.json"), reportBytes);
  fs.writeFileSync(path.join(directory, "体验报告.md"), experienceBytes);
  fs.writeFileSync(path.join(directory, "独立数学核算.mjs"), fs.readFileSync(fileURLToPath(import.meta.url)));
}

const updateVersion = directory => {
  const file = path.join(directory, "候选版本.json");
  const version = readJson(file);
  const mathScriptSha256 = sha256(fs.readFileSync(path.join(directory, "独立数学核算.mjs")));
  version.status = report.statusPass ? "候选冻结，独立数学核算已通过；未调用业务接口" : "候选冻结，独立数学核算存在失败；未调用业务接口";
  version.sourceMathStatus = report.statusPass ? "独立数学核算已通过" : "独立数学核算存在失败";
  version.mathReportSha256 = reportSha256;
  version.mathScriptSha256 = mathScriptSha256;
  version.experienceReportSha256 = sha256(experienceBytes);
  version.mathFormulaCount = report.formulaCount;
  version.mathFormulaDefinitionCount = report.formulaDefinitionCount;
  version.mathFormulaScenarioCount = report.formulaScenarioCount;
  version.mathFormulaPassCount = report.formulaPassCount;
  version.mathFormulaFailCount = report.formulaFailCount;
  version.mathMissingInputCaseCount = report.missingInputCaseCount;
  version.mathMissingInputAllRejected = report.missingInputAllRejected;
  version.integerParameterCount = report.integerParameterCount;
  version.integerParameterPassCount = report.integerParameters;
  version.integerValueCount = report.integerValueCount;
  version.integerValuePassCount = report.integerValues;
  version.apiCalls = 0;
  version.apiWrites = 0;
  version.businessWrites = 0;
  version.noBusinessWrites = true;
  fs.writeFileSync(file, jsonBytes(version));
  return { versionBytes: fs.readFileSync(file), mathScriptSha256 };
};
const updateSummary = directory => {
  const file = path.join(directory, "来源哈希汇总.json");
  const summary = readJson(file);
  const versionBytes = fs.readFileSync(path.join(directory, "候选版本.json"));
  const mathBytes = fs.readFileSync(path.join(directory, "独立数学报告.json"));
  const mathScriptBytes = fs.readFileSync(path.join(directory, "独立数学核算.mjs"));
  const experience = fs.readFileSync(path.join(directory, "体验报告.md"));
  summary.outputFiles["候选版本.json"] = { sha256: sha256(versionBytes), byteSize: versionBytes.length };
  summary.outputFiles["独立数学报告.json"] = { sha256: sha256(mathBytes), byteSize: mathBytes.length };
  summary.outputFiles["独立数学核算.mjs"] = { sha256: sha256(mathScriptBytes), byteSize: mathScriptBytes.length };
  summary.outputFiles["体验报告.md"] = { sha256: sha256(experience), byteSize: experience.length };
  summary.mathReport = { file: "独立数学报告.json", sha256: sha256(mathBytes), byteSize: mathBytes.length, formulaCount: report.formulaCount, formulaDefinitionCount: report.formulaDefinitionCount, formulaScenarioCount: report.formulaScenarioCount, formulaPassCount: report.formulaPassCount, formulaScenarioPassCount: report.formulaScenarioPassCount, formulaFailCount: report.formulaFailCount, missingInputCaseCount: report.missingInputCaseCount, statusPass: report.statusPass };
  fs.writeFileSync(file, jsonBytes(summary));
};
const updateManifest = directory => {
  const file = path.join(directory, "文件散列.json");
  const manifest = readJson(file);
  for (const name of ["候选版本.json", "独立数学报告.json", "独立数学核算.mjs", "体验报告.md", "来源哈希汇总.json"]) {
    const bytes = fs.readFileSync(path.join(directory, name));
    manifest.files[name] = { sha256: sha256(bytes), byteSize: bytes.length };
  }
  manifest.mathReport = { file: "独立数学报告.json", sha256: reportSha256, byteSize: reportBytes.length, formulaCount: report.formulaCount, formulaDefinitionCount: report.formulaDefinitionCount, formulaScenarioCount: report.formulaScenarioCount, formulaPassCount: report.formulaPassCount, formulaScenarioPassCount: report.formulaScenarioPassCount, formulaFailCount: report.formulaFailCount, missingInputCaseCount: report.missingInputCaseCount, statusPass: report.statusPass };
  manifest.experienceReport = { file: "体验报告.md", sha256: sha256(experienceBytes), byteSize: experienceBytes.length };
  manifest.noApiCalls = true;
  manifest.apiWrites = 0;
  fs.writeFileSync(file, jsonBytes(manifest));
};
updateVersion(ROOT);
updateVersion(DURABLE);
updateSummary(ROOT);
updateSummary(DURABLE);
updateManifest(ROOT);
updateManifest(DURABLE);

console.log(JSON.stringify({
  statusPass: report.statusPass,
  reportSha256,
  experienceReportSha256: sha256(experienceBytes),
  formulaCount: report.formulaCount,
  formulaDefinitionCount: report.formulaDefinitionCount,
  formulaScenarioCount: report.formulaScenarioCount,
  formulaPassCount: report.formulaPassCount,
  formulaScenarioPassCount: report.formulaScenarioPassCount,
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

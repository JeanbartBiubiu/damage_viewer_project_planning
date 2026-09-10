import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = "C:/project/damage_web_dev/.agents/artifacts/hero40-root-entry-20260910";
const CANDIDATE_FILE = "C:/project/damage_web_dev/.agents/artifacts/hero40-luna-candidate/修订一/完整候选.json";
const REPORT_FILE = path.join(ROOT, "独立源值数学报告.json");
const read = file => JSON.parse(fs.readFileSync(path.join(INPUT, file), "utf8"));
const candidate = JSON.parse(fs.readFileSync(CANDIDATE_FILE, "utf8"));
const binding = read("来源绑定与当前文本.json");
const sourceVersion = read("输入版本.json");
const shaFile = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const actualGETFile = process.env.HERO40_GET_REPORT;
if (!actualGETFile) throw new Error("必须提供第40批独立GET快照");
const actualGET = JSON.parse(fs.readFileSync(actualGETFile, "utf8"));
const candidateFileSha256 = shaFile(CANDIDATE_FILE);
if (actualGET.status !== "PASS" || actualGET.actual?.calls !== 449 || actualGET.candidateSha256 !== candidateFileSha256) throw new Error("独立GET未通过或候选散列不符");
const actualByRoute = new Map((actualGET.rawResponses || []).map(item => [item.route, item.data]));
let actualHydrated = 0;
for (const skillKey of candidate.order) {
  const write = candidate.skills[skillKey].write;
  for (const [kind, idField] of [["parameters", "parameterKey"], ["formulas", "formulaKey"], ["effects", "effectKey"]]) {
    write[kind] = write[kind].map(item => {
      const route = "/skills/" + skillKey + "/" + kind + "/" + encodeURIComponent(item[idField]);
      const actualItem = actualByRoute.get(route);
      if (!actualItem) throw new Error("独立GET缺少详情 " + route);
      actualHydrated += 1;
      return actualItem;
    });
  }
}
if (actualHydrated !== 221) throw new Error("实际GET详情载入数不符：" + actualHydrated);
const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const heroIds = { senna: "Senna", thresh: "Thresh", pyke: "Pyke", twistedfate: "TwistedFate" };
const slotOf = key => key.split("_")[1].toUpperCase();
const heroOf = key => heroIds[key.split("_")[0]];
const heroes = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const bound = key => {
  const hero = heroes[heroOf(key)];
  const skill = hero.skills.find(item => item.skillKey === key || item.slot === slotOf(key));
  return skill.object.mSpell;
};
const data = (key, name) => bound(key).DataValues.find(item => item.name === name)?.values;
const dataAt = (key, name, index = 1) => data(key, name)[index];
const rawArrayAt = (key, name, index = 1) => {
  const value = bound(key)[name];
  return Array.isArray(value) ? value[index] : index === 0 ? value : undefined;
};
const calc = (key, name) => bound(key).mSpellCalculations?.[name];
const part = (key, name, index = 0) => calc(key, name)?.mFormulaParts?.[index];
const officialSpell = key => {
  const file = read("参考资料/官方中文/" + heroOf(key) + ".json");
  const hero = file.data?.[heroOf(key)] || file[heroOf(key)] || file;
  return hero.spells?.[{ Q: 0, W: 1, E: 2, R: 3 }[slotOf(key)]];
};
const officialEffect = (key, index, rank) => officialSpell(key).effect[index][rank - 1];

const attrValue = (node, scenario) => {
  if (node.attributeOwner !== "SOURCE") throw new Error("本批数学未定义目标属性");
  const kind = node.attributeValueKind;
  if (node.attributeKey === "ability_power" && kind === "TOTAL") return requireInput(scenario, "ability_power");
  if (node.attributeKey === "attack_damage" && kind === "TOTAL") return requireInput(scenario, "attack_damage_total");
  if (node.attributeKey === "attack_damage" && kind === "BONUS") return requireInput(scenario, "attack_damage_bonus");
  throw new Error("未定义属性 " + JSON.stringify(node));
};
const requireInput = (scenario, key) => {
  if (!Object.prototype.hasOwnProperty.call(scenario, key) || scenario[key] === undefined) throw new Error("缺少输入 " + key);
  const value = Number(scenario[key]);
  if (!Number.isFinite(value)) throw new Error("输入不是有限数 " + key);
  return value;
};
const parameterValue = (skillKey, parameterKey, scenario) => {
  const parameter = candidate.skills[skillKey].write.parameters.find(item => item.parameterKey === parameterKey);
  if (!parameter) throw new Error("候选参数不存在 " + skillKey + "/" + parameterKey);
  if (parameter.valueMode === "FIXED") return Number(parameter.fixedValue);
  if (parameter.valueMode === "SKILL_LEVEL") {
    const rank = Math.min(Number(scenario.rank || 1), candidate.skills[skillKey].maxLevel);
    const value = parameter.levelValues?.[String(rank)];
    if (value === undefined) throw new Error("缺少技能等级值 " + parameterKey);
    return Number(value);
  }
  return requireInput(scenario, parameterKey);
};
const evalExpression = (skillKey, node, scenario) => {
  if (node.nodeType === "PARAMETER") return parameterValue(skillKey, node.parameterKey, scenario);
  if (node.nodeType === "ATTRIBUTE") return attrValue(node, scenario);
  if (node.nodeType !== "OPERATION" || !Array.isArray(node.operands) || node.operands.length !== 2) throw new Error("表达式不是二元运算");
  const left = evalExpression(skillKey, node.operands[0], scenario);
  const right = evalExpression(skillKey, node.operands[1], scenario);
  if (node.operation === "ADD") return left + right;
  if (node.operation === "MULTIPLY") return left * right;
  throw new Error("未定义运算 " + node.operation);
};

const sourceExpected = (skillKey, formulaKey, s) => {
  const rank = Math.min(Number(s.rank || 1), candidate.skills[skillKey].maxLevel);
  const m = bound(skillKey);
  const d = (name, index = 1) => m.DataValues.find(item => item.name === name).values[index];
  const c = (name, index = 0) => m.mSpellCalculations[name].mFormulaParts[index];
  const ap = () => requireInput(s, "ability_power");
  const totalAd = () => requireInput(s, "attack_damage_total");
  const bonusAd = () => requireInput(s, "attack_damage_bonus");
  const soul = () => requireInput(s, "soul_count");
  const lethality = () => requireInput(s, "lethality_points_input");
  if (skillKey === "senna_p" && formulaKey === "bonus_on_hit_damage") return c("BonusOnHitDamage").mCoefficient * totalAd();
  if (skillKey === "senna_p" && formulaKey === "soul_attack_damage") return soul() * d("ADPerStack");
  if (skillKey === "senna_q" && formulaKey === "enemy_physical_damage") return d("BaseDamage", rank) + d("BADDamageRatio") * bonusAd();
  if (skillKey === "senna_q" && formulaKey === "self_heal") return d("BaseHeal", rank) + d("HealAPRatio") * ap() + d("HealADRatio") * bonusAd();
  if (skillKey === "senna_q" && formulaKey === "slow_ratio") return d("BaseSlow") + d("SlowAPRatio") * ap() + c("TotalSlow", 2).mCoefficient * bonusAd();
  if (skillKey === "senna_w" && formulaKey === "enemy_physical_damage") return d("BaseDamage", rank) + c("Damage", 1).mCoefficient * bonusAd();
  if (skillKey === "senna_e" && formulaKey === "self_move_speed_ratio") return d("MovementSpeedPercent") + d("MSAPRatio") * ap();
  if (skillKey === "senna_r" && formulaKey === "enemy_physical_damage") return d("Damage", rank) + d("DamageAPRatio") * ap() + c("TotalDamage", 2).mCoefficient * bonusAd();
  if (skillKey === "senna_r" && formulaKey === "self_shield") return d("Shield", rank) + d("ShieldAPRatio") * ap() + c("TotalShield", 2).mCoefficient * soul();
  if (skillKey === "thresh_p" && formulaKey === "current_soul_bonus") return soul() * d("StatValuePerSoul");
  if (skillKey === "thresh_q" && formulaKey === "enemy_magic_damage") return d("BaseDamage", rank) + d("APRatio") * ap();
  if (skillKey === "thresh_w" && formulaKey === "self_shield") return d("BaseShieldValue", rank) + d("ShieldPerSoul") * soul();
  if (skillKey === "thresh_e" && formulaKey === "passive_damage_min") return c("PAttackDamageMin").mCoefficient * soul();
  if (skillKey === "thresh_e" && formulaKey === "passive_damage_max") return c("PAttackDamageMin").mCoefficient * soul() + d("PassiveADRatioTT", rank) * totalAd();
  if (skillKey === "thresh_e" && formulaKey === "active_magic_damage") return d("ActiveBaseDamage", rank) + d("APRatio") * ap();
  if (skillKey === "thresh_r" && formulaKey === "enemy_magic_damage") return d("Damage", rank) + d("APRatio") * ap();
  if (skillKey === "pyke_p" && formulaKey === "one_enemy_storage_ratio") return d("OneEnemy") + c("OneEnemyCalc", 1).mCoefficient * lethality();
  if (skillKey === "pyke_p" && formulaKey === "damage_storage_max") return c("DamageStorageMax").mNumber + d("DamageStoreMaxBonusADRatio") * bonusAd();
  if (skillKey === "pyke_q" && formulaKey === "enemy_physical_damage") return d("BaseDamage", rank) + d("BonusADRatio") * bonusAd();
  if (skillKey === "pyke_q" && formulaKey === "mana_refund_amount") return d("ManaRefund") * requireInput(s, "actual_mana_spent");
  if (skillKey === "pyke_w" && formulaKey === "move_speed_bonus_ratio") return (d("BaseMoveSpeed") + c("MoveSpeed", 1).mCoefficient * lethality()) / 100;
  if (skillKey === "pyke_e" && formulaKey === "enemy_physical_damage") return d("BaseDamage", rank) + c("TotalDamage", 1).mCoefficient * bonusAd();
  if (skillKey === "pyke_e" && formulaKey === "stun_duration_ms") return d("BaseStunDuration") * 1000 + c("StunDuration", 1).mCoefficient * 1000 * lethality();
  if (skillKey === "pyke_r" && formulaKey === "execute_threshold_damage") return requireInput(s, "r_base_damage_at_character_level") + c("RDamage", 1).mCoefficient * bonusAd() + c("RDamage", 2).mCoefficient * lethality();
  if (skillKey === "pyke_r" && formulaKey === "reduced_damage") return d("ReducedDamage") * (requireInput(s, "r_base_damage_at_character_level") + c("RDamage", 1).mCoefficient * bonusAd() + c("RDamage", 2).mCoefficient * lethality());
  if (skillKey === "twistedfate_q" && formulaKey === "enemy_magic_damage") return d("BaseDamage", rank) + d("BonusADRatio") * bonusAd() + d("APRatio") * ap();
  if (skillKey === "twistedfate_w" && formulaKey === "blue_card_damage") {
    const base = officialEffect(skillKey, 1, rank) + d("ttAD") * totalAd() + d("ttBlueAP") * ap();
    return base + requireInput(s, "critical_effectiveness_input") * d("BlueCritMultiplier") * base;
  }
  if (skillKey === "twistedfate_w" && formulaKey === "red_card_damage") {
    const base = officialEffect(skillKey, 4, rank) + d("ttAD") * totalAd() + d("ttRedAP") * ap();
    return base + requireInput(s, "critical_effectiveness_input") * d("RedCritMultiplier") * base;
  }
  if (skillKey === "twistedfate_w" && formulaKey === "gold_card_damage") {
    const base = officialEffect(skillKey, 5, rank) + d("ttAD") * totalAd() + d("ttGoldAP") * ap();
    return base + requireInput(s, "critical_effectiveness_input") * d("GoldCritMultiplier") * base;
  }
  if (skillKey === "twistedfate_e" && formulaKey === "fourth_attack_magic_damage") return d("Damage", rank) + d("BonusADRatio") * bonusAd() + d("APRatio") * ap();
  throw new Error("没有原文期望算法 " + skillKey + "/" + formulaKey);
};

const runtimeNames = new Set([
  "soul_count", "current_health_damage_percent_points_at_character_level", "critical_damage_ratio_input",
  "lethality_points_input", "actual_mana_spent", "level_move_speed_ratio_at_character_level",
  "r_base_damage_at_character_level", "critical_effectiveness_input",
]);
const scenarioFor = (skillKey, index) => {
  const maxLevel = candidate.skills[skillKey].maxLevel;
  const rank = index === 0 ? 1 : maxLevel;
  const s = {
    rank, ability_power: index === 0 ? 80 : 215, attack_damage_total: index === 0 ? 130 : 260,
    attack_damage_bonus: index === 0 ? 45 : 120, soul_count: index === 0 ? 12 : 86,
    lethality_points_input: index === 0 ? 18 : 43, actual_mana_spent: index === 0 ? 64 : 119,
    r_base_damage_at_character_level: index === 0 ? 250 : 620,
    critical_effectiveness_input: index === 0 ? 0.35 : 1.2,
    current_health_damage_percent_points_at_character_level: index === 0 ? 1 : 18,
    level_move_speed_ratio_at_character_level: index === 0 ? 0.25 : 0.58,
  };
  return s;
};
const refs = (node, parameters = new Set(), attributes = []) => {
  if (node.nodeType === "PARAMETER") parameters.add(node.parameterKey);
  else if (node.nodeType === "ATTRIBUTE") attributes.push(node);
  else if (node.nodeType === "OPERATION") for (const child of node.operands) refs(child, parameters, attributes);
  return { parameters, attributes };
};
const checks = [];
const failures = [];
const record = item => { checks.push(item); if (!item.pass) failures.push(item); };
let formulaCount = 0;
for (const skillKey of candidate.order) {
  for (const formula of candidate.skills[skillKey].write.formulas) {
    formulaCount++;
    const formulaRefs = refs(formula.expression);
    for (let i = 0; i < 2; i++) {
      const scenario = scenarioFor(skillKey, i);
      try {
        const actual = evalExpression(skillKey, formula.expression, scenario);
        const expected = sourceExpected(skillKey, formula.formulaKey, scenario);
        record({ kind: "source-vs-candidate", skillKey, formulaKey: formula.formulaKey, case: i + 1, expected: Number(expected.toFixed(8)), actual: Number(actual.toFixed(8)), pass: close(expected, actual), inputs: scenario });
      } catch (error) {
        record({ kind: "source-vs-candidate", skillKey, formulaKey: formula.formulaKey, case: i + 1, pass: false, error: String(error) });
      }
    }
    const missingKeys = [...formulaRefs.parameters].filter(key => runtimeNames.has(key));
    const missingAttributes = [...new Set(formulaRefs.attributes.map(node => node.attributeKey + ":" + node.attributeValueKind))];
    for (const key of missingKeys) {
      const scenario = scenarioFor(skillKey, 0);
      delete scenario[key];
      let rejected = false;
      try { evalExpression(skillKey, formula.expression, scenario); } catch { rejected = true; }
      record({ kind: "missing-runtime-input-rejection", skillKey, formulaKey: formula.formulaKey, input: key, pass: rejected });
    }
    for (const key of missingAttributes) {
      const scenario = scenarioFor(skillKey, 0);
      const map = { "ability_power:TOTAL": "ability_power", "attack_damage:TOTAL": "attack_damage_total", "attack_damage:BONUS": "attack_damage_bonus" };
      delete scenario[map[key]];
      let rejected = false;
      try { evalExpression(skillKey, formula.expression, scenario); } catch { rejected = true; }
      record({ kind: "missing-attribute-rejection", skillKey, formulaKey: formula.formulaKey, input: key, pass: rejected });
    }
  }
}

const operationChecks = [];
const walkExpression = (node, skillKey, formulaKey) => {
  if (node.nodeType === "OPERATION") {
    operationChecks.push({ skillKey, formulaKey, operation: node.operation, operandCount: node.operands?.length, pass: Array.isArray(node.operands) && node.operands.length === 2 });
    for (const child of node.operands || []) walkExpression(child, skillKey, formulaKey);
  }
};
for (const skillKey of candidate.order) for (const item of candidate.skills[skillKey].write.formulas) walkExpression(item.expression, skillKey, item.formulaKey);
const integerChecks = [];
for (const skillKey of candidate.order) for (const parameter of candidate.skills[skillKey].write.parameters) {
  if (parameter.parameterKey.endsWith("_ms")) {
    const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
    integerChecks.push({ skillKey, parameterKey: parameter.parameterKey, valueType: parameter.valueType, values, pass: parameter.valueType === "INTEGER" && values.every(value => Number.isInteger(value) && Number.isFinite(value)) });
  }
}
const endpointValues = (levelValues, keys) => Object.fromEntries(keys.map(key => [String(key), levelValues[String(key)]]));
const sourceBoundaryChecks = [
  { name: "赛娜Q一级伤害索引", actual: endpointValues(candidate.skills.senna_q.write.parameters.find(x => x.parameterKey === "base_damage").levelValues, [1, 5]), expected: { "1": 30, "5": 130 } },
  { name: "赛娜Q一级治疗索引", actual: endpointValues(candidate.skills.senna_q.write.parameters.find(x => x.parameterKey === "base_heal").levelValues, [1, 5]), expected: { "1": 40, "5": 120 } },
  { name: "赛娜R前三等级伤害", actual: endpointValues(candidate.skills.senna_r.write.parameters.find(x => x.parameterKey === "damage").levelValues, [1, 3]), expected: { "1": 250, "3": 550 } },
  { name: "赛娜R前三等级护盾", actual: endpointValues(candidate.skills.senna_r.write.parameters.find(x => x.parameterKey === "shield").levelValues, [1, 3]), expected: { "1": 120, "3": 200 } },
  { name: "锤石E主动减速比例", actual: endpointValues(candidate.skills.thresh_e.write.parameters.find(x => x.parameterKey === "active_slow_ratio").levelValues, [1, 5]), expected: { "1": 0.2, "5": 0.4 } },
  { name: "派克E伤害首项", actual: endpointValues(candidate.skills.pyke_e.write.parameters.find(x => x.parameterKey === "base_damage").levelValues, [1, 5]), expected: { "1": 100, "5": 300 } },
  { name: "崔斯特W金牌基础伤害", actual: endpointValues(candidate.skills.twistedfate_w.write.parameters.find(x => x.parameterKey === "gold_base_damage").levelValues, [1, 5]), expected: { "1": 15, "5": 45 } },
  { name: "崔斯特W完整暴击系数", actual: candidate.skills.twistedfate_w.write.parameters.find(x => x.parameterKey === "gold_crit_multiplier").fixedValue, expected: 0.25 },
  { name: "崔斯特R冷却", actual: endpointValues(candidate.skills.twistedfate_r.write.parameters.find(x => x.parameterKey === "cooldown_ms").levelValues, [1, 3]), expected: { "1": 170000, "3": 110000 } },
];
for (const item of sourceBoundaryChecks) record({ kind: "source-boundary", ...item, pass: JSON.stringify(item.actual) === JSON.stringify(item.expected) });
for (const item of operationChecks) record({ kind: "binary-operation", ...item });
for (const item of integerChecks) record({ kind: "integer-millisecond", ...item });
const finiteChecks = [];
for (const skillKey of candidate.order) for (const parameter of candidate.skills[skillKey].write.parameters) {
  const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
  finiteChecks.push({ skillKey, parameterKey: parameter.parameterKey, pass: values.every(value => typeof value === "number" && Number.isFinite(value)) });
}
for (const item of finiteChecks) record({ kind: "finite-number", ...item });

const report = {
  generatedAt: new Date().toISOString(), status: failures.length === 0 ? "PASS" : "FAIL",
  method: "实际侧读取第40批独立449次GET快照中的221项新增参数、公式和效果详情；期望侧重新读取冻结客户端/官方原始数组与计算树，未读取候选数值作为期望。",
  input: {
    candidateFile: CANDIDATE_FILE, candidateFileSha256,
    actualGETFile, actualGETSha256: shaFile(actualGETFile), actualHydrated,
    bindingFile: path.join(INPUT, "来源绑定与当前文本.json"), bindingFileSha256: shaFile(path.join(INPUT, "来源绑定与当前文本.json")),
    sourceIndexSha256: sourceVersion.sourceIndexSha256, clientVersion: "16.17", officialVersion: "16.17.1",
  },
  counts: {
    formulas: formulaCount, sourceVsCandidateCases: checks.filter(x => x.kind === "source-vs-candidate").length,
    missingInputChecks: checks.filter(x => x.kind.includes("missing")).length,
    binaryOperationChecks: operationChecks.length, integerMillisecondChecks: integerChecks.length,
    finiteChecks: finiteChecks.length, sourceBoundaryChecks: sourceBoundaryChecks.length, totalChecks: checks.length,
    passed: checks.filter(x => x.pass).length,
    failed: failures.length,
  },
  sourceBoundaryChecks, operationChecks, integerChecks, finiteChecks, checks,
  failureSample: failures.slice(0, 20),
};
fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ status: report.status, counts: report.counts, reportSha256: shaFile(REPORT_FILE) }, null, 2));
if (failures.length || operationChecks.some(item => !item.pass) || integerChecks.some(item => !item.pass)) process.exitCode = 1;

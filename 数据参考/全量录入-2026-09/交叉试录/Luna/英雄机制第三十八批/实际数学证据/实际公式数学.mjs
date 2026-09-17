import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const repo = "C:/project/damage_web_dev";
const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const candidatePath = path.join(repo, ".agents/artifacts/hero38-luna-candidate/完整候选.json");
const sourcePath = path.join(repo, ".agents/artifacts/hero38-root-entry-20260910/来源绑定与当前文本.json");
const inputVersionPath = path.join(repo, ".agents/artifacts/hero38-root-entry-20260910/输入版本.json");
const durableDir = path.join(repo, "数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第三十八批");
const reportPath = path.join(artifactDir, "实际公式数学.json");

const sha256File = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
};
const assert = (condition, message, detail = undefined) => {
  if (!condition) throw new Error(message + (detail === undefined ? "" : `：${JSON.stringify(detail)}`));
};
const close = (a, b, tolerance = 1e-6) => Number.isFinite(Number(a)) && Number.isFinite(Number(b))
  && Math.abs(Number(a) - Number(b)) <= tolerance * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));
const copy = value => JSON.parse(JSON.stringify(value));

const candidate = readJson(candidatePath);
const getPath=process.env.HERO38_GET_REPORT;if(!getPath)throw new Error('必须指定同一次独立GET报告');const getReport=readJson(getPath);assert(getReport.status==='PASS'&&getReport.actual.calls===415,'独立GET未通过');assert(getReport.candidateSha256===sha256File(candidatePath),'实际GET候选散列不一致');
const actual=new Map(getReport.rawResponses.map(x=>[x.route,x.data]));let actualHydrated=0;
for(const [key,skill]of Object.entries(candidate.skills))for(const[k,id,route]of [['parameters','parameterKey','parameters'],['formulas','formulaKey','formulas'],['effects','effectKey','effects']])skill.write[k]=skill.write[k].map(x=>{const p='/skills/'+key+'/'+route+'/'+x[id];assert(actual.has(p),'缺少实际回读组成',p);actualHydrated++;return actual.get(p);});assert(actualHydrated===193,'实际组成数不符');
const binding = readJson(sourcePath);
const inputVersion = readJson(inputVersionPath);
assert(candidate.meta?.batch === "第三十八批嘉文四世李青斯卡纳凯尔", "候选批次不符");
assert(candidate.meta?.revision === "hero38-source-v1-candidate", "候选版本不符", candidate.meta?.revision);
assert(inputVersion.GETs === 197 && inputVersion.reusedParameters === 25 && inputVersion.apiWrites === 0, "输入保护计数不符", inputVersion);
assert(candidate.counts?.newParameters === 149 && candidate.counts?.newFormulas === 25 && candidate.counts?.newEffects === 19, "候选计数不符", candidate.counts);

const heroById = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const heroIds = { jarvaniv: "JarvanIV", leesin: "LeeSin", skarner: "Skarner", kayle: "Kayle" };
const skillKeys = [
  "jarvaniv_p", "jarvaniv_q", "jarvaniv_w", "jarvaniv_e", "jarvaniv_r",
  "leesin_p", "leesin_q", "leesin_w", "leesin_e", "leesin_r",
  "skarner_p", "skarner_q", "skarner_w", "skarner_e", "skarner_r",
  "kayle_p", "kayle_q", "kayle_w", "kayle_e", "kayle_r",
];
const slotOf = skillKey => skillKey.split("_").at(-1).toUpperCase();
const bound = skillKey => {
  const hero = heroById[heroIds[skillKey.split("_")[0]]];
  const skill = hero?.skills.find(item => item.skillKey === skillKey);
  assert(hero && skill, "来源技能缺失", skillKey);
  return { hero, skill, raw: skill.object.mSpell };
};
const rawOf = skillKey => bound(skillKey).raw;
const sourceSummary = skillKey => {
  const { hero } = bound(skillKey);
  return hero.source.skills.find(item => item.slot === slotOf(skillKey));
};
const maxLevel = skillKey => Number(candidate.skills[skillKey].maxLevel);
const dv = (skillKey, name, index) => {
  const item = (rawOf(skillKey).DataValues || []).find(value => value.name === name);
  assert(item && Array.isArray(item.values), "来源数据值缺失", { skillKey, name });
  const value = item.values[index];
  assert(typeof value === "number" && Number.isFinite(value), "来源数据值索引缺失", { skillKey, name, index, value });
  return value;
};
const effect = (skillKey, index, level) => {
  const value = rawOf(skillKey).mEffectAmount?.[index]?.value?.[level];
  assert(typeof value === "number" && Number.isFinite(value), "来源效果值索引缺失", { skillKey, index, level, value });
  return value;
};
const part = (skillKey, calculationName, index = 0) => {
  const calc = rawOf(skillKey).mSpellCalculations?.[calculationName];
  const item = calc?.mFormulaParts?.[index];
  assert(item, "来源计算树子项缺失", { skillKey, calculationName, index });
  return item;
};
const coefficient = (skillKey, calculationName, index) => {
  const value = part(skillKey, calculationName, index).mCoefficient;
  assert(typeof value === "number" && Number.isFinite(value), "来源计算树系数缺失", { skillKey, calculationName, index, value });
  return value;
};
const multiplier = (skillKey, calculationName) => {
  const value = rawOf(skillKey).mSpellCalculations?.[calculationName]?.mMultiplier?.mNumber;
  assert(typeof value === "number" && Number.isFinite(value), "来源计算树倍率缺失", { skillKey, calculationName, value });
  return value;
};
const rootMs = seconds => {
  const value = Number(seconds) * 1000;
  const rounded = Math.round(value);
  assert(Math.abs(value - rounded) <= 0.001, "来源时间不能精确转毫秒", seconds);
  return rounded;
};

const reused = new Set((candidate.reusedPublicParameters || []).map(item => `${item.skillKey}:${item.parameterKey}`));
const parameterOf = (skillKey, parameterKey) => {
  const parameter = candidate.skills[skillKey]?.write?.parameters?.find(item => item.parameterKey === parameterKey);
  if (parameter) return parameter;
  if (reused.has(`${skillKey}:${parameterKey}`)) return { parameterKey, valueMode: "REUSED_PUBLIC" };
  throw new Error(`参数引用不存在：${skillKey}:${parameterKey}`);
};
const formulaOf = (skillKey, formulaKey) => {
  const formula = candidate.skills[skillKey]?.write?.formulas?.find(item => item.formulaKey === formulaKey);
  assert(formula, "公式引用不存在", { skillKey, formulaKey });
  return formula;
};

const allFormulaNodes = [];
const collectNodes = (node, skillKey, formulaKey, pathName = "expression") => {
  assert(node && typeof node === "object", "公式节点缺失", { skillKey, formulaKey, pathName });
  if (node.nodeType === "OPERATION") {
    assert(Array.isArray(node.operands) && node.operands.length === 2, "操作必须严格为两个操作数", { skillKey, formulaKey, pathName, node });
    assert(node.operation === "ADD" || node.operation === "MULTIPLY", "发现未允许的操作", { skillKey, formulaKey, operation: node.operation });
    node.operands.forEach((child, index) => collectNodes(child, skillKey, formulaKey, `${pathName}.operands[${index}]`));
    return;
  }
  if (node.nodeType === "PARAMETER") {
    parameterOf(skillKey, node.parameterKey);
    allFormulaNodes.push({ kind: "PARAMETER", skillKey, formulaKey, key: node.parameterKey });
    return;
  }
  if (node.nodeType === "ATTRIBUTE") {
    assert(node.attributeOwner === "SOURCE", "属性节点必须读取SOURCE", { skillKey, formulaKey, node });
    assert(["TOTAL", "BASE", "BONUS", "CURRENT", "MISSING", "PERCENT", "FLAT"].includes(node.attributeValueKind), "属性取值类型不在接口枚举中", node);
    allFormulaNodes.push({ kind: "ATTRIBUTE", skillKey, formulaKey, key: `${node.attributeKey}:${node.attributeValueKind}` });
    return;
  }
  throw new Error(`未知公式节点：${skillKey}:${formulaKey}:${JSON.stringify(node)}`);
};

for (const skillKey of skillKeys) {
  const skill = candidate.skills[skillKey];
  assert(skill, "候选技能缺失", skillKey);
  assert(sourceSummary(skillKey)?.officialMaxRank === maxLevel(skillKey), "技能等级上限不一致", skillKey);
  const params = skill.write?.parameters || [];
  const formulas = skill.write?.formulas || [];
  for (const formula of formulas) collectNodes(formula.expression, skillKey, formula.formulaKey);
  for (const parameter of params) {
    assert(parameter.valueMode === "RUNTIME_INPUT" ? parameter.fixedValue === null && parameter.levelValues === null : true, "运行输入带有默认值", { skillKey, parameter });
    if (parameter.valueType === "INTEGER") {
      const values = parameter.valueMode === "SKILL_LEVEL" ? Object.values(parameter.levelValues || {}) : [parameter.fixedValue];
      assert(values.every(value => Number.isInteger(value)), "整数参数含非整数值", { skillKey, parameterKey: parameter.parameterKey, values });
    }
    if (parameter.valueMode === "SKILL_LEVEL") {
      const keys = Object.keys(parameter.levelValues || {});
      assert(keys.length === maxLevel(skillKey) && keys.every((key, index) => key === String(index + 1)), "技能等级参数索引不是1起连续值", { skillKey, parameterKey: parameter.parameterKey, keys });
    }
  }
  for (const effectBody of skill.write?.effects || []) for (const result of effectBody.results || []) {
    assert(!["DAMAGE", "DIRECT_HEAL", "MOMENT_EVALUATION", "SPELL_SHIELD"].includes(result.resultType), "候选效果越过本批结果范围", { skillKey, resultType: result.resultType });
    const value = result.valueRule?.value;
    if (value?.kind === "PARAMETER") parameterOf(skillKey, value.parameterKey);
    if (value?.kind === "FORMULA") formulaOf(skillKey, value.formulaKey);
  }
}

const valueOfParameter = (skillKey, parameterKey, scenario) => {
  const parameter = parameterOf(skillKey, parameterKey);
  if (parameter.valueMode === "REUSED_PUBLIC") throw new Error(`数学场景未允许直接读取未载入公共参数：${skillKey}:${parameterKey}`);
  if (parameter.valueMode === "FIXED") {
    assert(typeof parameter.fixedValue === "number" && Number.isFinite(parameter.fixedValue), "固定参数不是有限数", { skillKey, parameterKey });
    return parameter.fixedValue;
  }
  if (parameter.valueMode === "SKILL_LEVEL") {
    const value = parameter.levelValues?.[String(scenario.skillLevel)];
    assert(typeof value === "number" && Number.isFinite(value), "技能等级参数缺值", { skillKey, parameterKey, skillLevel: scenario.skillLevel });
    return value;
  }
  if (parameter.valueMode === "RUNTIME_INPUT") {
    if (!Object.prototype.hasOwnProperty.call(scenario.runtime || {}, parameterKey)) throw new Error(`MISSING_RUNTIME_INPUT:${skillKey}:${parameterKey}`);
    const value = scenario.runtime[parameterKey];
    assert(typeof value === "number" && Number.isFinite(value), "运行输入不是有限数", { skillKey, parameterKey, value });
    return value;
  }
  throw new Error(`未知参数模式：${skillKey}:${parameterKey}:${parameter.valueMode}`);
};
const valueOfAttribute = (node, scenario) => {
  const value = scenario.attributes?.[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
  if (value === undefined) throw new Error(`MISSING_ATTRIBUTE:${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`);
  assert(typeof value === "number" && Number.isFinite(value), "属性场景值不是有限数", { node, value });
  return value;
};
const evaluate = (node, skillKey, scenario) => {
  if (node.nodeType === "PARAMETER") return valueOfParameter(skillKey, node.parameterKey, scenario);
  if (node.nodeType === "ATTRIBUTE") return valueOfAttribute(node, scenario);
  assert(node.nodeType === "OPERATION" && Array.isArray(node.operands) && node.operands.length === 2, "实际公式操作数不是2", node);
  const left = evaluate(node.operands[0], skillKey, scenario);
  const right = evaluate(node.operands[1], skillKey, scenario);
  if (node.operation === "ADD") return left + right;
  if (node.operation === "MULTIPLY") return left * right;
  throw new Error(`实际公式操作未知：${node.operation}`);
};

const scenarioFor = (skillKey, caseIndex) => {
  const high = caseIndex === 1;
  return {
    skillLevel: high ? maxLevel(skillKey) : 1,
    attributes: {
      SOURCE: {
      ability_power: { TOTAL: high ? 275 : 80 },
      attack_damage: { TOTAL: high ? 230 : 125, BONUS: high ? 150 : 45 },
      hp: { TOTAL: high ? 3600 : 1800, BONUS: high ? 1200 : 500 },
      },
    },
    runtime: {
      energy_return_at_character_level: high ? 15 : 10,
      percent_health_base_at_character_level: high ? 9 : 5,
      stat12_value: high ? 760 : 220,
      passive_wave_base_at_character_level: high ? 38 : 20,
    },
  };
};

const rawExpected = (skillKey, formulaKey, scenario) => {
  const level = scenario.skillLevel;
  const ap = scenario.attributes.SOURCE.ability_power.TOTAL;
  const adTotal = scenario.attributes.SOURCE.attack_damage.TOTAL;
  const adBonus = scenario.attributes.SOURCE.attack_damage.BONUS;
  const runtime = scenario.runtime;
  switch (`${skillKey}:${formulaKey}`) {
    case "jarvaniv_q:physical_damage": return dv(skillKey, "BaseDamage", level) + coefficient(skillKey, "TotalDamage", 1) * adBonus;
    case "jarvaniv_w:shield_value": return effect(skillKey, 0, level) + coefficient(skillKey, "TotalShield", 1) * adBonus;
    case "jarvaniv_w:bonus_shield_value": return coefficient(skillKey, "BonusShield", 0) * scenario.attributes.SOURCE.hp.TOTAL;
    case "jarvaniv_e:magic_damage": return effect(skillKey, 1, level) + dv(skillKey, "APRatio", 0) * ap;
    case "jarvaniv_r:physical_damage": return dv(skillKey, "BaseDamage", level) + coefficient(skillKey, "DamageCalc", 1) * adBonus;
    case "leesin_p:first_hit_energy_return": return runtime.energy_return_at_character_level * dv(skillKey, "FirstHitEnergyMult", 0);
    case "leesin_q:initial_physical_damage": return dv(skillKey, "Q1BaseDamage", level) + dv(skillKey, "Q1ADRatio", 0) * adBonus;
    case "leesin_q:recast_physical_damage": return dv(skillKey, "Q2BaseDamage", level) + dv(skillKey, "Q2ADRatio", 0) * adBonus;
    case "leesin_q:empowered_physical_damage": return multiplier(skillKey, "EmpoweredDamage") * (dv(skillKey, "Q2BaseDamage", level) + dv(skillKey, "Q2ADRatio", 0) * adBonus);
    case "leesin_w:shield_value": return dv(skillKey, "ShieldValue", level) + coefficient(skillKey, "ShieldAmount", 1) * ap;
    case "leesin_e:initial_magic_damage": return dv(skillKey, "E1Damage", level) + coefficient(skillKey, "InitialDamage", 1) * adTotal;
    case "leesin_r:physical_damage": return dv(skillKey, "BaseDamage", level) + coefficient(skillKey, "Damage", 1) * adBonus;
    case "skarner_p:percent_health_damage_ratio": return multiplier(skillKey, "PercentHealthDamage") * runtime.percent_health_base_at_character_level;
    case "skarner_q:ability_damage": return dv(skillKey, "BaseDamage", level) + dv(skillKey, "ADRatio", 0) * adBonus + dv(skillKey, "BonusHealthRatio", 0) * scenario.attributes.SOURCE.hp.BONUS;
    case "skarner_w:magic_damage": return dv(skillKey, "BaseDamage", level) + dv(skillKey, "DamageAPRatio", 0) * ap;
    case "skarner_w:shield_value": return dv(skillKey, "InitialShieldRatio", 0) * scenario.attributes.SOURCE.hp.TOTAL;
    case "skarner_e:pin_physical_damage": return dv(skillKey, "PinBaseDamage", level) + dv(skillKey, "ADRatio", 0) * adBonus + dv(skillKey, "PinDamageRatio", 0) * scenario.attributes.SOURCE.hp.TOTAL;
    case "skarner_r:magic_damage": return dv(skillKey, "BaseDamage", level) + coefficient(skillKey, "Damage", 1) * ap;
    case "kayle_p:passive_wave_magic_damage": return runtime.passive_wave_base_at_character_level + dv(skillKey, "PassiveWaveAPRatio", 0) * ap + dv(skillKey, "PassiveWaveBonusADRatio", 0) * adBonus;
    case "kayle_q:magic_damage": return dv(skillKey, "Damage", level) + coefficient(skillKey, "TotalDamage", 1) * ap + coefficient(skillKey, "TotalDamage", 2) * adBonus;
    case "kayle_w:heal_value": return dv(skillKey, "Heal", level) + coefficient(skillKey, "TotalHeal", 1) * ap;
    case "kayle_w:haste_ratio": return dv(skillKey, "Haste", level) + coefficient(skillKey, "TotalHaste", 1) * ap;
    case "kayle_e:passive_magic_damage": return dv(skillKey, "PassiveDamage", level) + dv(skillKey, "PassiveAPRatio", 0) * ap + dv(skillKey, "PassiveBonusADRatio", 0) * adBonus;
    case "kayle_e:active_execute_ratio": return multiplier(skillKey, "ActiveTotalExecuteDamage") * (dv(skillKey, "ActiveExecutePercent", level) + coefficient(skillKey, "ActiveTotalExecuteDamage", 1) * ap);
    case "kayle_r:magic_damage": return dv(skillKey, "Damage", level) + coefficient(skillKey, "TotalDamage", 1) * ap + coefficient(skillKey, "TotalDamage", 2) * adBonus;
    default: throw new Error(`缺少独立来源期望：${skillKey}:${formulaKey}`);
  }
};

const formulaResults = [];
const missingResults = [];
const missingForFormula = (skillKey, formula, scenario) => {
  const missing = [];
  const visit = node => {
    if (node.nodeType === "PARAMETER") {
      const parameter = parameterOf(skillKey, node.parameterKey);
      if (parameter.valueMode === "RUNTIME_INPUT") {
        const altered = copy(scenario);
        delete altered.runtime[node.parameterKey];
        try {
          evaluate(formula.expression, skillKey, altered);
          throw new Error(`运行输入缺失却未拒绝：${skillKey}:${formula.formulaKey}:${node.parameterKey}`);
        } catch (error) {
          assert(String(error.message).startsWith("MISSING_RUNTIME_INPUT:"), "缺失运行输入错误类型不正确", { skillKey, formulaKey: formula.formulaKey, parameterKey: node.parameterKey, error: error.message });
          missing.push({ kind: "RUNTIME_INPUT", key: node.parameterKey });
        }
      }
      return;
    }
    if (node.nodeType === "ATTRIBUTE") {
      const altered = copy(scenario);
      delete altered.attributes?.[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
      try {
        evaluate(formula.expression, skillKey, altered);
        throw new Error(`属性缺失却未拒绝：${skillKey}:${formula.formulaKey}:${node.attributeKey}:${node.attributeValueKind}`);
      } catch (error) {
        assert(String(error.message).startsWith("MISSING_ATTRIBUTE:"), "缺失属性错误类型不正确", { skillKey, formulaKey: formula.formulaKey, key: node.attributeKey, error: error.message });
        missing.push({ kind: "ATTRIBUTE", key: `${node.attributeKey}:${node.attributeValueKind}` });
      }
      return;
    }
    if (node.nodeType === "OPERATION") node.operands.forEach(visit);
  };
  visit(formula.expression);
  return missing;
};

for (const skillKey of skillKeys) {
  for (const formula of candidate.skills[skillKey].write.formulas) {
    const scenarios = [scenarioFor(skillKey, 0), scenarioFor(skillKey, 1)];
    for (const [caseIndex, scenario] of scenarios.entries()) {
      const actual = evaluate(formula.expression, skillKey, scenario);
      const expected = rawExpected(skillKey, formula.formulaKey, scenario);
      assert(Number.isFinite(actual) && Number.isFinite(expected), "公式结果不是有限数", { skillKey, formulaKey: formula.formulaKey, caseIndex, actual, expected });
      assert(close(actual, expected, 2e-5), "实际候选公式与独立来源期望不符", { skillKey, formulaKey: formula.formulaKey, caseIndex, actual, expected, delta: actual - expected });
      formulaResults.push({ skillKey, formulaKey: formula.formulaKey, caseIndex: caseIndex + 1, skillLevel: scenario.skillLevel, actual, expected, passed: true });
    }
    const missing = missingForFormula(skillKey, formula, scenarioFor(skillKey, 0));
    missingResults.push({ skillKey, formulaKey: formula.formulaKey, missing, passed: missing.length > 0 });
    assert(missing.length > 0, "公式没有可验证的缺值拒绝场景", { skillKey, formulaKey: formula.formulaKey });
  }
}

const sourceParameterChecks = [
  ["jarvaniv_q", "base_damage", "dv", "BaseDamage", 1], ["jarvaniv_q", "armor_shred_ratio", "dv", "BaseARShred", 1],
  ["jarvaniv_w", "shield_base", "effect", 0, 1], ["jarvaniv_w", "slow_ratio", "dv", "BaseSlowAmount", 1],
  ["jarvaniv_e", "self_attack_speed_ratio", "dv", "PermanentAttackSpeed", 1], ["jarvaniv_e", "ally_attack_speed_ratio", "dv", "BaseAuraAS", 1], ["jarvaniv_e", "base_magic_damage", "effect", 1, 1],
  ["jarvaniv_r", "base_damage", "dv", "BaseDamage", 1],
  ["leesin_q", "q1_base_damage", "dv", "Q1BaseDamage", 1], ["leesin_q", "q2_base_damage", "dv", "Q2BaseDamage", 1],
  ["leesin_w", "shield_base", "dv", "ShieldValue", 1], ["leesin_w", "omnivamp_ratio", "dvDiv100", "LifestealAndSpellVamp", 1],
  ["leesin_e", "slow_percent_points", "dv", "SlowAmount", 1], ["leesin_e", "base_magic_damage", "dv", "E1Damage", 1],
  ["leesin_r", "base_damage", "dv", "BaseDamage", 1],
  ["skarner_q", "cooldown_ms", "rootMs", "cooldownTime", 1], ["skarner_q", "base_damage", "dv", "BaseDamage", 1], ["skarner_q", "attack_speed_ratio", "dv", "AttackSpeed", 1],
  ["skarner_w", "base_damage", "dv", "BaseDamage", 1], ["skarner_e", "pin_base_damage", "dv", "PinBaseDamage", 1], ["skarner_r", "base_damage", "dv", "BaseDamage", 1],
  ["kayle_q", "base_damage", "dv", "Damage", 1], ["kayle_q", "slow_percent_points", "dv", "SlowPercent", 1],
  ["kayle_w", "base_heal", "dv", "Heal", 1], ["kayle_w", "haste_ratio", "dv", "Haste", 1],
  ["kayle_e", "passive_base_damage", "dv", "PassiveDamage", 1], ["kayle_e", "active_execute_percent_points", "dv", "ActiveExecutePercent", 1],
  ["kayle_r", "base_damage", "dv", "Damage", 1], ["kayle_r", "aoe_radius", "dv", "AoERadius", 1],
];
const sourceParameterResults = [];
for (const [skillKey, parameterKey, kind, sourceName, sourceStart] of sourceParameterChecks) {
  const parameter = candidate.skills[skillKey].write.parameters.find(item => item.parameterKey === parameterKey);
  assert(parameter?.valueMode === "SKILL_LEVEL", "来源数组参数不是技能等级模式", { skillKey, parameterKey });
  const expected = [];
  for (let index = 0; index < maxLevel(skillKey); index++) {
    const sourceIndex = sourceStart + index;
    const raw = kind === "dv" ? dv(skillKey, sourceName, sourceIndex)
      : kind === "dvDiv100" ? dv(skillKey, sourceName, sourceIndex) / 100
      : kind === "effect" ? effect(skillKey, sourceName, sourceIndex)
      : kind === "rootMs" ? rootMs(rawOf(skillKey)[sourceName][sourceIndex])
      : (() => { throw new Error(`未知来源数组核对类型：${kind}`); })();
    expected.push(raw);
  }
  const actual = Object.values(parameter.levelValues).map(Number);
  assert(actual.length === expected.length && actual.every((value, index) => close(value, expected[index], 2e-5)), "候选技能等级数组与独立来源索引不符", { skillKey, parameterKey, actual, expected });
  sourceParameterResults.push({ skillKey, parameterKey, sourceName, sourceStart, actual, expected, passed: true });
}

const allIntegers = [];
for (const skillKey of skillKeys) for (const parameter of candidate.skills[skillKey].write.parameters) if (parameter.valueType === "INTEGER") {
  const values = parameter.valueMode === "SKILL_LEVEL" ? Object.values(parameter.levelValues).map(Number) : [parameter.fixedValue];
  assert(values.every(Number.isInteger), "整数参数边界检查失败", { skillKey, parameterKey: parameter.parameterKey, values });
  allIntegers.push({ skillKey, parameterKey: parameter.parameterKey, values });
}
const runtimeParameters = skillKeys.flatMap(skillKey => candidate.skills[skillKey].write.parameters.filter(parameter => parameter.valueMode === "RUNTIME_INPUT").map(parameter => ({ skillKey, parameterKey: parameter.parameterKey, fixedValue: parameter.fixedValue, levelValues: parameter.levelValues })));
assert(runtimeParameters.every(parameter => parameter.fixedValue === null && parameter.levelValues === null), "存在带默认的运行输入", runtimeParameters);

const parameterValue = (skillKey, parameterKey) => {
  const parameter = candidate.skills[skillKey].write.parameters.find(item => item.parameterKey === parameterKey);
  assert(parameter, "语义核对参数缺失", { skillKey, parameterKey });
  return parameter;
};
const breakpointChecks = [
  {
    skillKey: "jarvaniv_p",
    sourceName: "TooltipCooldown",
    levels: [1, 6, 11, 16],
    expected: [6, 5, 4, 3],
    actual: [
      parameterValue("jarvaniv_p", "cadence_cooldown_base_seconds").fixedValue,
      parameterValue("jarvaniv_p", "cadence_cooldown_base_seconds").fixedValue + parameterValue("jarvaniv_p", "cadence_cooldown_breakpoint_1_delta_seconds").fixedValue,
      parameterValue("jarvaniv_p", "cadence_cooldown_base_seconds").fixedValue + parameterValue("jarvaniv_p", "cadence_cooldown_breakpoint_1_delta_seconds").fixedValue + parameterValue("jarvaniv_p", "cadence_cooldown_breakpoint_2_delta_seconds").fixedValue,
      parameterValue("jarvaniv_p", "cadence_cooldown_base_seconds").fixedValue + parameterValue("jarvaniv_p", "cadence_cooldown_breakpoint_1_delta_seconds").fixedValue + parameterValue("jarvaniv_p", "cadence_cooldown_breakpoint_2_delta_seconds").fixedValue + parameterValue("jarvaniv_p", "cadence_cooldown_breakpoint_3_delta_seconds").fixedValue,
    ],
  },
  {
    skillKey: "leesin_p",
    sourceName: "EnergyReturn",
    levels: [1, 7, 13],
    expected: [10, 15, 20],
    actual: [
      parameterValue("leesin_p", "energy_return_level1").fixedValue,
      parameterValue("leesin_p", "energy_return_level1").fixedValue + parameterValue("leesin_p", "energy_return_breakpoint_1_increase").fixedValue,
      parameterValue("leesin_p", "energy_return_level1").fixedValue + parameterValue("leesin_p", "energy_return_breakpoint_1_increase").fixedValue + parameterValue("leesin_p", "energy_return_breakpoint_2_increase").fixedValue,
    ],
  },
];
for (const check of breakpointChecks) {
  const rawCalc = rawOf(check.skillKey).mSpellCalculations?.[check.sourceName];
  const rawPart = rawCalc?.mFormulaParts?.[0];
  assert(rawPart?.mLevel1Value === check.expected[0], "角色等级断点起点不符", check);
  const rawBreakpoints = (rawPart.mBreakpoints || []).map(item => [item.mLevel, item.mAdditionalBonusAtThisLevel]);
  assert(JSON.stringify(rawBreakpoints.map(item => item[0])) === JSON.stringify(check.levels.slice(1)), "角色等级断点等级不符", { check, rawBreakpoints });
  assert(check.actual.every((value, index) => close(value, check.expected[index])), "角色等级断点展开值不符", check);
}
const semanticChecks = [
  { name: "jarvaniv_e自身攻速为持久生命周期", passed: candidate.skills.jarvaniv_e.write.effects.find(item => item.effectKey === "self_attack_speed")?.lifecycle?.expiryMode === "EXPLICIT_ONLY" && candidate.skills.jarvaniv_e.write.effects.find(item => item.effectKey === "self_attack_speed")?.lifecycle?.durationValue === null },
  { name: "jarvaniv_q保留连接击飞750毫秒", passed: parameterValue("jarvaniv_q", "knock_up_duration_ms").fixedValue === 750 },
  { name: "leesin_r未写入碰撞额外生命参数", passed: !candidate.skills.leesin_r.write.parameters.some(item => ["percent_hp_carry_through_points", "target_bonus_health_value"].includes(item.parameterKey)) },
  { name: "kayle_q未写入冲突CastDelay", passed: !candidate.skills.kayle_q.write.parameters.some(item => item.parameterKey === "cast_delay_ms") },
  { name: "kayle_e未写入额外敌人爆炸半径", passed: !candidate.skills.kayle_e.write.parameters.some(item => item.parameterKey === "explosion_radius") },
  { name: "skarner_q记录下3次强化攻击", passed: parameterValue("skarner_q", "empowered_attack_count").fixedValue === 3 },
  { name: "mStat12窄映射节点明确", passed: candidate.skills.jarvaniv_w.write.formulas.some(formula => JSON.stringify(formula.expression).includes('"attributeKey":"hp"') && JSON.stringify(formula.expression).includes('"attributeValueKind":"TOTAL"')) && candidate.skills.skarner_q.write.formulas.some(formula => JSON.stringify(formula.expression).includes('"attributeValueKind":"BONUS"')) },
];
assert(semanticChecks.every(item => item.passed), "候选关键语义核对失败", semanticChecks);

const formulaCount = skillKeys.reduce((count, skillKey) => count + candidate.skills[skillKey].write.formulas.length, 0);
const operationCount = allFormulaNodes.filter(node => node.kind === "PARAMETER" || node.kind === "ATTRIBUTE").length;
const report = {
  apiCalls:0,apiWrites:0,actualHydrated,actualGETFile:getPath,actualGETSha256:sha256File(getPath),
  generatedAt: new Date().toISOString(),
  batch: candidate.meta.batch,
  revision: candidate.meta.revision,
  candidateFile: ".agents/artifacts/hero38-luna-candidate/完整候选.json",
  candidateFileSha256: sha256File(candidatePath),
  sourceBindingFile: ".agents/artifacts/hero38-root-entry-20260910/来源绑定与当前文本.json",
  sourceBindingSha256: sha256File(sourcePath),
  inputVersionSha256: sha256File(inputVersionPath),
  independentSourcePolicy: "实际值只读取同一次415GET快照的真实详情；独立期望重新读取冻结来源绑定中的DataValues、效果数组和计算树，不读取候选固定值或候选等级数组作为期望。",
  counts: {
    skills: skillKeys.length,
    formulas: formulaCount,
    expectedFormulas: 25,
    formulaScenarios: formulaResults.length,
    expectedScenarios: 50,
    missingFormulaChecks: missingResults.length,
    missingRejectedCases: missingResults.reduce((sum, item) => sum + item.missing.length, 0),
    sourceParameterChecks: sourceParameterResults.length,
    integerParameterChecks: allIntegers.length,
    runtimeParameters: runtimeParameters.length,
    formulaValueNodes: operationCount,
    breakpointChecks: breakpointChecks.length,
    semanticChecks: semanticChecks.length,
  },
  gates: {
    allBinaryOperations: true,
    actualCandidateParameterTree: true,
    independentRawSourceExpected: true,
    missingInputRejected: missingResults.every(item => item.passed),
    skillLevelAndIntegerBoundaries: true,
    forbiddenDirectResultTypesAbsent: true,
  },
  formulaResults,
  missingResults,
  sourceParameterResults,
  breakpointChecks,
  semanticChecks,
  runtimeParameters,
  status: "PASS",
};
writeJson(reportPath, report);
console.log(JSON.stringify({
  status: report.status,
  counts: report.counts,
  candidateFileSha256: report.candidateFileSha256,
  sourceBindingSha256: report.sourceBindingSha256,
  reportSha256: sha256File(reportPath),

}, null, 2));

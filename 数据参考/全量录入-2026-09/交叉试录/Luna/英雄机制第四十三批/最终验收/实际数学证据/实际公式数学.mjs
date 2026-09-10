import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_FILE = "C:/project/damage_web_dev/.agents/artifacts/hero43-luna-candidate/修订二/完整候选.json";
const INPUT = "C:/project/damage_web_dev/.agents/artifacts/hero43-root-entry-20260910";
const DURABLE = path.resolve("数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十三批");
const candidate = JSON.parse(fs.readFileSync(CANDIDATE_FILE, "utf8"));
const getPath=process.env.HERO43_GET_REPORT;if(!getPath)throw new Error('必须提供独立GET快照');const getReport=JSON.parse(fs.readFileSync(getPath));if(getReport.status!=='PASS'||getReport.actual.calls!==426||getReport.candidateSha256!==crypto.createHash('sha256').update(fs.readFileSync(CANDIDATE_FILE)).digest('hex'))throw new Error('快照不符');const snapshot=new Map(getReport.rawResponses.map(x=>[x.route,x.data]));let actualHydrated=0;for(const[k,sk]of Object.entries(candidate.skills))for(const[kind,id]of [['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey']])sk.write[kind]=sk.write[kind].map(x=>{const v=snapshot.get('/skills/'+k+'/'+kind+'/'+x[id]);if(!v)throw new Error('真实详情缺失');actualHydrated++;return v;});if(actualHydrated!==206)throw new Error('真实详情数不符');
const binding = JSON.parse(fs.readFileSync(path.join(INPUT, "来源绑定与当前文本.json"), "utf8"));
const protection = JSON.parse(fs.readFileSync(path.join(INPUT, "参考资料", "当前20槽保护快照.json"), "utf8"));
const reuseList = JSON.parse(fs.readFileSync(path.join(INPUT, "参考资料", "公共参数复用清单.json"), "utf8"));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const sourceSkills = Object.fromEntries(binding.heroes.map(hero => [hero.id, Object.fromEntries(hero.skills.map(skill => [skill.slot, skill]))]));
const spell = (heroId, slot) => sourceSkills[heroId][slot].object.mSpell;
const dataRow = (heroId, slot, name) => {
  const row = (spell(heroId, slot).DataValues || []).find(item => item.name === name);
  if (!row) throw new Error(`缺少源DataValue ${heroId}/${slot}/${name}`);
  return row.values;
};
const dataAt = (heroId, slot, name, index = 1) => dataRow(heroId, slot, name)[index];
const valueAt = (heroId, slot, name, level) => dataAt(heroId, slot, name, level);
const calc = (heroId, slot, name) => (spell(heroId, slot).mSpellCalculations || {})[name];
const coefficient = (heroId, slot, name, index = 1) => calc(heroId, slot, name).mFormulaParts[index].mCoefficient;
const equal = (left, right) => Math.abs(left - right) <= 1e-6 * Math.max(1, Math.abs(left), Math.abs(right));
const round = value => Number(Number(value).toFixed(9));
const need = (input, key, label) => {
  if (!(key in input) || input[key] === null || input[key] === undefined) throw new Error(`缺少${label}`);
  return input[key];
};

const attrsFor = (scenario, input = {}) => ({
  SOURCE: {
    attack_damage: { TOTAL: scenario.totalAD, BONUS: scenario.bonusAD },
    ability_power: { TOTAL: scenario.AP },
    hp: { TOTAL: scenario.sourceHP },
  },
  TARGET: {
    hp: { TOTAL: scenario.targetMaxHP },
  },
  ...input.attributes,
});
const parameterMap = (skillData, skillLevel, characterLevel, inputs = {}) => {
  const map = {};
  for (const item of skillData.write.parameters) {
    if (item.valueMode === "FIXED") map[item.parameterKey] = item.fixedValue;
    else if (item.valueMode === "SKILL_LEVEL") map[item.parameterKey] = item.levelValues[String(skillLevel)];
    else if (item.valueMode === "CHARACTER_LEVEL") map[item.parameterKey] = item.levelValues[String(characterLevel)];
    else if (item.valueMode === "RUNTIME_INPUT") {
      if (!(item.parameterKey in inputs)) throw new Error(`缺少运行输入 ${skillData.skillKey}/${item.parameterKey}`);
      map[item.parameterKey] = inputs[item.parameterKey];
    }
  }
  return map;
};
const evaluate = (node, params, attrs) => {
  if (node.nodeType === "PARAMETER") {
    if (!(node.parameterKey in params)) throw new Error(`缺少公式参数 ${node.parameterKey}`);
    return params[node.parameterKey];
  }
  if (node.nodeType === "ATTRIBUTE") {
    const value = attrs[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
    if (typeof value !== "number") throw new Error(`缺少属性 ${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`);
    return value;
  }
  if (node.nodeType === "OPERATION") {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error("存在非二元操作");
    const [left, right] = node.operands.map(child => evaluate(child, params, attrs));
    if (node.operation === "ADD") return left + right;
    if (node.operation === "MULTIPLY") return left * right;
    if (node.operation === "SUBTRACT") return left - right;
    throw new Error(`未支持操作 ${node.operation}`);
  }
  throw new Error(`未支持节点 ${node.nodeType}`);
};
const scenarioInputs = (skillKey, index) => {
  const base = {
    mark_count: index === 0 ? 4 : 11,
    additional_range_tier_count: index === 0 ? 0 : 2,
    actual_damage_base: index === 0 ? 80 : 220,
    actual_move_speed_ratio: index === 0 ? 0.15 : 0.3,
    actual_missing_health: index === 0 ? 300 : 850,
    actual_attack_heal: index === 0 ? 47 : 75,
    actual_target_missing_health: index === 0 ? 300 : 850,
    critical_stat: index === 0 ? 1 : 1.5,
    critical_stat8: index === 0 ? 1 : 1.25,
    critical_stat9: index === 0 ? 1 : 1.5,
    actual_target_current_health_ratio: index === 0 ? 0.49 : 0.2,
    actual_shen_zed_quest_bonus_ratio: index === 0 ? 0 : 0.02,
    qualified_body_damage: index === 0 ? 400 : 900,
  };
  const rank = index === 0 ? 1 : (skillKey.endsWith("_p") ? 1 : skillKey.endsWith("_r") ? 3 : 5);
  const characterLevel = index === 0 ? 1 : 18;
  return { rank, characterLevel, inputs: base, attrs: { SOURCE: { hp: { TOTAL: 1400 } }, TARGET: { hp: { TOTAL: index === 0 ? 1000 : 1800 } } }, totalAD: index === 0 ? 180 : 320, bonusAD: index === 0 ? 80 : 180, AP: index === 0 ? 120 : 420, sourceHP: index === 0 ? 900 : 1400, targetMaxHP: index === 0 ? 1000 : 1800, skillKey };
};

const expectedValue = (skillKey, formulaKey, rank, characterLevel, scenario) => {
  const input = scenario.inputs;
  const totalAD = scenario.totalAD;
  const bonusAD = scenario.bonusAD;
  const AP = scenario.AP;
  const targetHP = scenario.targetMaxHP;
  const raw = {
    gangplank_p: {
      passive_true_damage: () => need(input, "actual_damage_base", "实际被动基础伤害") + bonusAD,
    },
    gangplank_q: {
      shot_physical_damage: () => valueAt("Gangplank", "Q", "SpellDamage", rank) + totalAD,
      shot_crit_multiplier: () => 1 + (dataAt("Gangplank", "Q", "CritDamageMod") * (need(input, "critical_stat", "暴击统计") - 1)),
      shot_crit_physical_damage: () => {
        const stat = need(input, "critical_stat", "暴击统计");
        return (1 + dataAt("Gangplank", "Q", "CritDamageMod") * (stat - 1)) * (valueAt("Gangplank", "Q", "SpellDamage", rank) + totalAD);
      },
    },
    gangplank_w: {
      self_heal: () => valueAt("Gangplank", "W", "BaseHeal", rank) + coefficient("Gangplank", "W", "BaseHealth") * AP + 0.13 * need(input, "actual_missing_health", "自身已损生命"),
    },
    gangplank_r: {
      one_wave_magic_damage: () => valueAt("Gangplank", "R", "DamagePerWave", rank > 3 ? 3 : rank) + coefficient("Gangplank", "R", "OneWaveDamage") * AP,
      full_magic_damage: () => dataAt("Gangplank", "R", "TotalWavesTooltip") * (valueAt("Gangplank", "R", "DamagePerWave", rank > 3 ? 3 : rank) + coefficient("Gangplank", "R", "OneWaveDamage") * AP),
      full_magic_damage_with_extra_waves: () => (dataAt("Gangplank", "R", "TotalWavesTooltip") + 6) * (valueAt("Gangplank", "R", "DamagePerWave", rank > 3 ? 3 : rank) + coefficient("Gangplank", "R", "OneWaveDamage") * AP),
      deaths_daughter_true_damage: () => valueAt("Gangplank", "R", "DeathsDaughterBaseDamage", rank > 3 ? 3 : rank) + coefficient("Gangplank", "R", "DeathsDaughterDamage") * AP,
    },
    kindred_p: {
      first_tier_range_increase: () => dataAt("Kindred", "P", "RangeIncrease") * dataAt("Kindred", "P", "FirstTierMultiplier"),
      additional_range_increase: () => dataAt("Kindred", "P", "RangeIncrease") * need(input, "additional_range_tier_count", "后续射程档数"),
      q_mark_attack_speed_bonus: () => need(input, "mark_count", "印记") * coefficient("Kindred", "P", "QMarkBonus", 0),
      w_mark_current_health_damage_ratio: () => need(input, "mark_count", "印记") * coefficient("Kindred", "P", "WMarkBonus", 0),
      e_mark_missing_health_damage_ratio: () => need(input, "mark_count", "印记") * coefficient("Kindred", "P", "EMarkBonus", 0),
    },
    kindred_q: {
      arrow_physical_damage: () => valueAt("Kindred", "Q", "BaseDamage", rank) + coefficient("Kindred", "Q", "TotalDamage") * bonusAD,
      total_attack_speed_ratio: () => dataAt("Kindred", "Q", "BaseBonusAS") + need(input, "mark_count", "印记") * coefficient("Kindred", "Q", "TotalQAttackSpeed", 1),
    },
    kindred_w: {
      self_attack_heal: () => need(input, "actual_attack_heal", "实际W治疗"),
    },
    kindred_e: {
      raw_bite_damage: () => valueAt("Kindred", "E", "BaseDamage", rank) + dataAt("Kindred", "E", "BonusADRatio") * bonusAD,
      critical_multiplier: () => 1 + need(input, "critical_stat8", "mStat8") * dataAt("Kindred", "E", "CritMod") * (need(input, "critical_stat9", "mStat9") - 1),
      corrected_bite_damage: () => (1 + need(input, "critical_stat8", "mStat8") * dataAt("Kindred", "E", "CritMod") * (need(input, "critical_stat9", "mStat9") - 1)) * (valueAt("Kindred", "E", "BaseDamage", rank) + dataAt("Kindred", "E", "BonusADRatio") * bonusAD),
      raw_missing_health_ratio: () => dataAt("Kindred", "E", "BasePercentDamage") + need(input, "mark_count", "印记") * coefficient("Kindred", "E", "PercentBiteDamage", 1),
      corrected_missing_health_ratio: () => (1 + need(input, "critical_stat8", "mStat8") * dataAt("Kindred", "E", "CritMod") * (need(input, "critical_stat9", "mStat9") - 1)) * (dataAt("Kindred", "E", "BasePercentDamage") + need(input, "mark_count", "印记") * coefficient("Kindred", "E", "PercentBiteDamage", 1)),
      wolf_lunge_physical_damage: () => {
        const multiplier = 1 + need(input, "critical_stat8", "mStat8") * dataAt("Kindred", "E", "CritMod") * (need(input, "critical_stat9", "mStat9") - 1);
        const bite = valueAt("Kindred", "E", "BaseDamage", rank) + dataAt("Kindred", "E", "BonusADRatio") * bonusAD;
        const missing = dataAt("Kindred", "E", "BasePercentDamage") + need(input, "mark_count", "印记") * coefficient("Kindred", "E", "PercentBiteDamage", 1);
        return multiplier * bite + multiplier * missing * need(input, "actual_target_missing_health", "目标已损生命");
      },
      slow_percent_points: () => dataAt("Kindred", "E", "SlowAmount") + dataAt("Kindred", "E", "SlowAPRatio") * AP,
    },
    kindred_r: { ending_heal: () => valueAt("Kindred", "R", "HealFlat", rank > 3 ? 3 : rank) },
    naafiri_q: {
      first_cast_physical_damage: () => valueAt("Naafiri", "Q", "BaseDamageFirstCast", rank) + dataAt("Naafiri", "Q", "FirstCastBonusADRatio") * bonusAD,
      bleed_total_physical_damage: () => valueAt("Naafiri", "Q", "BleedBaseDamage", rank) + dataAt("Naafiri", "Q", "BleedBonusADRatio") * bonusAD,
      second_cast_min_physical_damage: () => valueAt("Naafiri", "Q", "BaseDamageSecondCast", rank) + dataAt("Naafiri", "Q", "SecondCastBonusADRatio") * bonusAD,
      second_cast_max_physical_damage: () => 2 * (valueAt("Naafiri", "Q", "BaseDamageSecondCast", rank) + dataAt("Naafiri", "Q", "SecondCastMaxADRatio") * bonusAD),
      second_cast_self_heal: () => valueAt("Naafiri", "Q", "BaseHealSecondCast", rank) + dataAt("Naafiri", "Q", "HealBonusADRatio") * bonusAD,
    },
    naafiri_w: { self_attack_damage_bonus: () => dataAt("Naafiri", "W", "NaafiriADPercentBoost") * totalAD },
    naafiri_e: {
      first_slash_physical_damage: () => valueAt("Naafiri", "E", "BaseDamageFirstSlash", rank) + dataAt("Naafiri", "E", "ADRatioFirstSlash") * bonusAD,
      second_hit_physical_damage: () => valueAt("Naafiri", "E", "BaseDamageSecondHit", rank) + dataAt("Naafiri", "E", "ADRatioSecondHit") * bonusAD,
    },
    naafiri_r: {
      body_physical_damage: () => valueAt("Naafiri", "R", "BaseDamage", rank > 3 ? 3 : rank) + bonusAD,
      second_cast_shield: () => valueAt("Naafiri", "R", "ShieldSize", rank > 3 ? 3 : rank) + coefficient("Naafiri", "R", "ShieldTotal") * bonusAD,
    },
    zed_p: {
      base_max_health_magic_damage: () => {
        const ratio = characterLevel <= 6 ? 0.05 : characterLevel <= 16 ? 0.075 : 0.1;
        return ratio * targetHP;
      },
      quest_max_health_magic_damage: () => {
        const ratio = characterLevel <= 6 ? 0.05 : characterLevel <= 16 ? 0.075 : 0.1;
        return (ratio + need(input, "actual_shen_zed_quest_bonus_ratio", "慎劫增益")) * targetHP;
      },
    },
    zed_q: { body_physical_damage: () => valueAt("Zed", "Q", "BaseDamage", rank) + bonusAD },
    zed_e: { body_physical_damage: () => valueAt("Zed", "E", "BaseDamage", rank) + dataAt("Zed", "E", "ADRatio") * bonusAD },
    zed_r: {
      mark_base_physical_damage: () => totalAD,
      detonation_physical_damage: () => totalAD + valueAt("Zed", "R", "RDamageAmp", rank > 3 ? 3 : rank) * need(input, "qualified_body_damage", "R合格本体伤害"),
    },
  };
  const fn = raw[skillKey]?.[formulaKey];
  if (!fn) throw new Error(`缺少期望侧映射 ${skillKey}/${formulaKey}`);
  return fn();
};

const results = [];
const missingInputCases = [];
const structureIssues = [];
const runtimeParameters = [];
const walk = (node, callback) => {
  if (!node || typeof node !== "object") return;
  callback(node);
  if (Array.isArray(node.operands)) node.operands.forEach(child => walk(child, callback));
};
const parameterRefs = expression => {
  const refs = [];
  walk(expression, node => { if (node.nodeType === "PARAMETER") refs.push(node.parameterKey); });
  return refs;
};
for (const key of candidate.order) {
  const skillData = candidate.skills[key];
  for (const parameter of skillData.write.parameters) {
    if (parameter.valueMode === "RUNTIME_INPUT") runtimeParameters.push({ skillKey: key, parameterKey: parameter.parameterKey });
  }
  for (const item of skillData.write.formulas) {
    walk(item.expression, node => {
      if (node.nodeType === "OPERATION" && (!Array.isArray(node.operands) || node.operands.length !== 2)) structureIssues.push(`${key}/${item.formulaKey}:非二元操作`);
    });
    for (const index of [0, 1]) {
      const scenario = scenarioInputs(key, index);
      try {
        const params = parameterMap(skillData, scenario.rank, scenario.characterLevel, scenario.inputs);
        const attrs = attrsFor(scenario, scenario);
        const actual = evaluate(item.expression, params, attrs);
        const expected = expectedValue(key, item.formulaKey, scenario.rank, scenario.characterLevel, scenario);
        results.push({ skillKey: key, formulaKey: item.formulaKey, scenario: index === 0 ? "基础场景" : "强化场景", inputs: { skillLevel: scenario.rank, characterLevel: scenario.characterLevel, totalAD: scenario.totalAD, bonusAD: scenario.bonusAD, AP: scenario.AP, targetMaxHP: scenario.targetMaxHP, runtime: clone(scenario.inputs) }, actual: round(actual), expected: round(expected), pass: equal(actual, expected) });
      } catch (error) {
        results.push({ skillKey: key, formulaKey: item.formulaKey, scenario: index === 0 ? "基础场景" : "强化场景", pass: false, error: error.message });
      }
    }
    for (const ref of parameterRefs(item.expression)) {
      const parameter = skillData.write.parameters.find(item2 => item2.parameterKey === ref);
      if (parameter?.valueMode !== "RUNTIME_INPUT") continue;
      const scenario = scenarioInputs(key, 0);
      const without = { ...scenario.inputs };
      delete without[ref];
      let rejected = false;
      try {
        const params = parameterMap(skillData, scenario.rank, scenario.characterLevel, without);
        evaluate(item.expression, params, attrsFor(scenario, scenario));
      } catch (error) {
        rejected = true;
      }
      missingInputCases.push({ skillKey: key, formulaKey: item.formulaKey, missingParameterKey: ref, rejected });
    }
  }
}

const effectValueCases = [];
const protectedParameters = new Map();
for (const item of reuseList) {
  const route = `/skills/${item.skillKey}/parameters/${item.parameterKey}`;
  const request = protection.requests.find(entry => entry.route === route);
  if (request) protectedParameters.set(`${item.skillKey}/${item.parameterKey}`, request.data);
}
const protectedParameterValue = (skillKey, parameterKey, skillLevel) => {
  const item = protectedParameters.get(`${skillKey}/${parameterKey}`);
  if (!item) return undefined;
  return item.valueMode === "FIXED" ? item.fixedValue : item.levelValues?.[String(skillLevel)];
};
for (const key of candidate.order) {
  const skillData = candidate.skills[key];
  const scenario = scenarioInputs(key, 1);
  const params = parameterMap(skillData, scenario.rank, scenario.characterLevel, scenario.inputs);
  const attrs = attrsFor(scenario, scenario);
  for (const effect of skillData.write.effects) for (const result of effect.results || []) {
    if (!result.valueRule?.value) {
      effectValueCases.push({ skillKey: key, effectKey: effect.effectKey, resultKey: result.resultKey, pass: false, error: "缺少valueRule" });
      continue;
    }
    try {
      const ref = result.valueRule.value;
      const value = ref.kind === "PARAMETER" ? (ref.parameterKey in params ? params[ref.parameterKey] : protectedParameterValue(key, ref.parameterKey, scenario.rank)) : evaluate(skillData.write.formulas.find(item => item.formulaKey === ref.formulaKey).expression, params, attrs);
      const detail = result.detail || {};
      effectValueCases.push({ skillKey: key, effectKey: effect.effectKey, resultKey: result.resultKey, resultType: result.resultType, value: round(value), fixedMultiplier: result.valueRule.fixedMultiplier, finalValue: round(value * result.valueRule.fixedMultiplier), attributeKey: detail.attributeKey || null, modifierZoneKey: detail.modifierZoneKey || null, unitNote: detail.attributeKey === "move_speed_percent" || detail.attributeKey === "bonus_attack_speed_percent" ? "比例属性：1表示100%，attribute_flat_add直接加比例" : detail.attributeKey === "attack_damage" ? "点数属性：attribute_flat_add直接加攻击力" : detail.attributeKey === "energy" ? "资源点数：RESOURCE_CHANGE/CONSUME" : detail.attributeKey === "mana" ? "资源点数：RESOURCE_CHANGE/CONSUME" : result.resultType === "NORMAL_SHIELD" ? "护盾点数：普通护盾" : "未分类" , pass: Number.isFinite(value) && Number.isFinite(result.valueRule.fixedMultiplier) && result.valueRule.fixedMultiplier===1 && (!["move_speed_percent","bonus_attack_speed_percent","attack_damage"].includes(detail.attributeKey)||detail.modifierZoneKey==="attribute_flat_add") });
    } catch (error) {
      effectValueCases.push({ skillKey: key, effectKey: effect.effectKey, resultKey: result.resultKey, pass: false, error: error.message });
    }
  }
}

const integerAndModeChecks = [];
for (const key of candidate.order) for (const parameter of candidate.skills[key].write.parameters) {
  const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
  const integerOk = parameter.valueType !== "INTEGER" || values.every(value => Number.isInteger(value));
  const msOk = !parameter.parameterKey.endsWith("_ms") || values.every(value => Number.isInteger(value) && value >= 0);
  const runtimeNoDefault = parameter.valueMode !== "RUNTIME_INPUT" || (parameter.fixedValue === null && parameter.levelValues === null);
  integerAndModeChecks.push({ skillKey: key, parameterKey: parameter.parameterKey, integerOk, msOk, runtimeNoDefault, pass: integerOk && msOk && runtimeNoDefault && (parameter.valueMode==="RUNTIME_INPUT" || (values.length>0 && values.every(value=>typeof value==="number"&&Number.isFinite(value)))) });
}

const protectionChecks = {
  inputGETs: protection.GETs,
  expectedInputGETs: 196,
  publicReuseCount: reuseList.length,
  expectedPublicReuseCount: 24,
  apiWrites: protection.apiWrites,
  allSubjectsProtected: candidate.order.every(key => candidate.skills[key].protectedExisting.subject),
  allExpressionsBinary: structureIssues.length === 0,
};
const report = {
  actualHydrated,actualGETFile:getPath,actualGETSha256:crypto.createHash("sha256").update(fs.readFileSync(getPath)).digest("hex"),businessMathReady:true,
  generatedAt: new Date().toISOString(),
  batch: candidate.meta.batch,
  revision: candidate.meta.revision,
  status: "实际独立回读快照数学已执行；零额外GET",
  sourceBasis: {
    clientVersion: binding.clientVersion,
    officialVersion: binding.officialVersion,
    sourceIndexSha256: JSON.parse(fs.readFileSync(path.join(INPUT, "输入版本.json"), "utf8")).sourceIndexSha256,
    sourceAuditSha256: candidate.meta.sourceAuditSha256,
    candidateSha256: sha256(fs.readFileSync(CANDIDATE_FILE)),
    expectedSide: "直接读取输入包原始DataValues/计算树并按补核语义重算，不读取候选参数作为期望值",
    actualSide: "读取独立426GET返回的实际表达式，场景显式提供属性和无默认运行输入",
  },
  formulaResults: results,
  formulaCount: results.length,
  formulaPassCount: results.filter(item => item.pass).length,
  formulaFailCount: results.filter(item => !item.pass).length,
  missingInputCases,
  missingInputAllRejected: missingInputCases.every(item => item.rejected),
  effectValueCases,
  effectValuePassCount: effectValueCases.filter(item => item.pass).length,
  effectValueFailCount: effectValueCases.filter(item => !item.pass).length,
  integerAndModeChecks,
  integerAndModeAllPass: integerAndModeChecks.every(item => item.pass),
  structureIssues,
  protectionChecks,
  scenarios: {
    基础场景: "技能等级1；角色等级1；总攻击力180、额外攻击力80、法强120；目标最大生命1000；运行输入显式填写。",
    强化场景: "技能等级5或3；角色等级18；总攻击力320、额外攻击力180、法强420；目标最大生命1800；运行输入显式填写。",
    missingInput: "逐公式移除其所引用的RUNTIME_INPUT，必须拒绝计算；候选不提供默认值。",
  },
  noApiCalls: true,
  apiWrites: 0,
};
const reportBytes = jsonBytes(report);
const reportSha256 = sha256(reportBytes);
fs.writeFileSync(path.join(ROOT, "独立数学报告.json"), reportBytes);

if(report.formulaFailCount||!report.missingInputAllRejected||report.effectValueFailCount||!report.integerAndModeAllPass||report.structureIssues.length)throw new Error('独立数学检查失败');
console.log(JSON.stringify({formulaCount:report.formulaCount,formulaPassCount:report.formulaPassCount,formulaFailCount:report.formulaFailCount,missing:report.missingInputCases.length,effects:report.effectValueCases.length,integerAndModeAllPass:report.integerAndModeAllPass,reportSha256}));

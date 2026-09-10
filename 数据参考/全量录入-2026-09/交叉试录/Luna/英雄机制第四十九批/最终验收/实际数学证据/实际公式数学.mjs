import fs from "node:fs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = "C:/project/damage_web_dev/.agents/artifacts/hero49-root-entry-20260910";
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const CANDIDATE_FILE = "C:/project/damage_web_dev/.agents/artifacts/hero49-luna-candidate/修订三/完整候选.json";
const candidate = readJson(CANDIDATE_FILE);
const getPath=process.env.HERO49_GET_REPORT;assert(getPath,'必须提供独立GET快照');const getReport=readJson(getPath);assert(getReport.status==='PASS'&&getReport.actual.calls===390&&getReport.candidateSha256===sha(CANDIDATE_FILE),'实际GET快照不符');const snapshot=new Map(getReport.rawResponses.map(x=>[x.route,x.data]));let actualHydrated=0;for(const[k,sk]of Object.entries(candidate.skills))for(const[kind,id]of [['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey']])sk.write[kind]=sk.write[kind].map(x=>{const v=snapshot.get('/skills/'+k+'/'+kind+'/'+x[id]);assert(v,'真实详情缺失');actualHydrated++;return v;});assert(actualHydrated===190,'真实详情数不符');function apiNode(n){assert(['PARAMETER','ATTRIBUTE','OPERATION'].includes(n.nodeType),'实际GET公式节点非法');if(n.nodeType==='OPERATION'){assert.equal(n.operands.length,2);n.operands.forEach(apiNode);}}for(const s of Object.values(candidate.skills))for(const f of s.write.formulas)apiNode(f.expression);
const binding = readJson(path.join(INPUT, "来源绑定与当前文本.json"));
const protection = readJson(path.join(INPUT, "参考资料", "当前20槽保护快照.json"));
const sourceByKey = Object.fromEntries(
  binding.heroes.flatMap(hero => hero.skills.map(skill => [skill.skillKey, { hero, skill }]))
);
const protectionDictionaries = protection.dictionaries || {};
const dictionaryItems = route => Array.isArray(protectionDictionaries[route]?.items)
  ? protectionDictionaries[route].items
  : [];
const dictionarySet = (route, key) => new Set(dictionaryItems(route)
  .map(item => item?.[key])
  .filter(value => typeof value === "string"));
const attributeKeys = dictionarySet("/attributes", "attributeKey");
const damageTypeKeys = dictionarySet("/damage-types", "damageTypeKey");
const modifierZoneKeys = dictionarySet("/modifier-zones", "modifierZoneKey");
const statusKeys = dictionarySet("/statuses", "statusKey");
const finite = value => typeof value === "number" && Number.isFinite(value);
const close = (left, right, tolerance) => finite(left) && finite(right) && Math.abs(left - right) <= tolerance;
const sourceSkill = key => sourceByKey[key]?.skill;
const sourceSpell = key => sourceSkill(key)?.sourceObject?.mSpell || {};
const sourceCalculations = key => sourceSpell(key).mSpellCalculations || {};
const sourceDataRows = key => Array.isArray(sourceSpell(key).DataValues) ? sourceSpell(key).DataValues : [];
const sourceDataRow = (key, dataName) => {
  const row = sourceDataRows(key).find(item => item?.name === dataName && Array.isArray(item.values));
  if (!row) throw new Error(`原始DataValues缺失 ${key}/${dataName}`);
  return row;
};
const dataAt = (key, dataName, rank) => {
  const row = sourceDataRow(key, dataName);
  if (row.values[rank] === undefined || !finite(row.values[rank])) {
    throw new Error(`原始DataValues等级缺失 ${key}/${dataName}/index${rank}`);
  }
  return row.values[rank];
};

const report = {
  actualHydrated,actualGETFile:getPath,actualGETSha256:sha(getPath),extraMathGETs:0,apiNodeKindsPassed:true,
  generatedAt: new Date().toISOString(),
  batch: candidate.meta?.batch,
  revision: candidate.meta?.revision,
  inputRoot: path.relative(path.resolve(ROOT, "..", ".."), INPUT),
  tolerance: 0.0001,
  failures: [],
  formulas: [],
  formulaCount: 0,
  formulaScenarios: 0,
  sourceMatches: 0,
  sourceRuleMatches: 0,
  rawCalculationMatches: 0,
  sourceTreeChecks: 0,
  sourceTreePasses: 0,
  missingRuntimeCases: 0,
  missingRuntimeRejected: 0,
  missingRuntimeAllRejected: true,
  runtimeDependentFormulaCount: 0,
  runtimeNoDefaultAllPass: true,
  parameterArraysChecked: 0,
  completeParameterArrays: 0,
  completeArrayValues: 0,
  incompleteArrayFailures: 0,
  integerParameterCount: 0,
  integerParameterPassCount: 0,
  integerValueCount: 0,
  integerValuePassCount: 0,
  millisecondsChecked: 0,
  typedReferencesChecked: 0,
  operationNodeCount: 0,
  binaryOperationPassCount: 0,
  allOperationsBinary: true,
  attributeNodeCheckCount: 0,
  attributeNodePassCount: 0,
  attributeNodeAllPass: true,
  effectAttributeCheckCount: 0,
  effectAttributePassCount: 0,
  effectAttributeAllPass: true,
  effectUnits: [],
  effectFinalMultipliers: [],
  effectFinalMultiplierAllPass: true,
  dictionaryKeyCheckCount: 0,
  dictionaryKeyPassCount: 0,
  dictionaryKeyAllPass: true,
  dictionaryKeyFailures: [],
  dictionaryKeysSeen: {
    damageTypeKey: [],
    absorbedDamageTypeKey: [],
    modifierZoneKey: [],
    statusKey: [],
  },
  dictionaryRoutes: {
    attributes: { present: Boolean(protectionDictionaries["/attributes"]), keys: [...attributeKeys].sort() },
    damageTypes: { present: Boolean(protectionDictionaries["/damage-types"]), keys: [...damageTypeKeys].sort() },
    modifierZones: { present: Boolean(protectionDictionaries["/modifier-zones"]), keys: [...modifierZoneKeys].sort() },
    statuses: { present: Boolean(protectionDictionaries["/statuses"]), keys: [...statusKeys].sort() },
  },
  formulaEvidenceDamageTypeMapping: [],
  gnarMoveSpeedAssertions: [],
  gnarMoveSpeedAllPass: true,
  kledRLevelAssertions: [],
  kledRLevelAllPass: true,
  missileSpeedAssertions: [],
  missileSpeedAllPass: true,
  specialFixAssertions: [],
  specialFixesAllPass: true,
  sourceFieldChecks: [],
  sourceFieldAllPass: true,
  sourceTreeAllPass: true,
  noCandidatePercentPointUnit: true,
  noApiCalls: true,
  noBrowserCalls: true,
  noGitWrites: true,
};
const fail = message => report.failures.push(message);
const failDictionary = message => {
  report.dictionaryKeyFailures.push(message);
  report.dictionaryKeyAllPass = false;
  fail(message);
};
const failAttribute = message => {
  report.attributeNodeAllPass = false;
  fail(message);
};
const failEffectAttribute = message => {
  report.effectAttributeAllPass = false;
  fail(message);
};
const failSource = message => {
  report.sourceTreeAllPass = false;
  fail(message);
};

const reusedKeys = new Set((candidate.reusedPublicParameters || [])
  .map(item => `${item.skillKey}/${item.parameterKey}`));
const sourceCandidate = key => candidate.skills[key];
const parameterOf = (key, parameterKey) => sourceCandidate(key).write.parameters
  .find(item => item.parameterKey === parameterKey);
const rawCalculationExists = (key, calculationName) => Object.prototype.hasOwnProperty.call(
  sourceCalculations(key), calculationName
);

const refs = (node, callback, where = "") => {
  if (!node || typeof node !== "object") return;
  callback(node, where);
  if (node.nodeType === "OPERATION") {
    for (const [index, operand] of (node.operands || []).entries()) {
      refs(operand, callback, `${where}/operands[${index}]`);
    }
  }
};

const attributeValue = (ctx, owner, attributeKey, valueKind) => {
  const value = ctx.values?.[owner]?.[attributeKey]?.[valueKind];
  if (!finite(value)) throw new Error(`缺少属性场景 ${owner}.${attributeKey}.${valueKind}`);
  return value;
};

const runtimeValue = (parameter, rank, scene) => {
  const key = parameter.parameterKey;
  if (parameter.valueType === "INTEGER" || key.endsWith("_ms")) {
    if (key.includes("count") || key.includes("stacks") || key.includes("attack_count")) return 2 + scene;
    return 1400 + rank * 100 + scene * 250;
  }
  if (key.includes("health") || key.includes("hp")) return 900 + rank * 100 + scene * 300;
  if (key.includes("ratio") || key.includes("percent")) return 0.2 + rank * 0.01 + scene * 0.05;
  return 80 + rank * 10 + scene * 25;
};

const scenarioFor = (key, def, rank, scene) => {
  const runtime = {};
  for (const parameter of def.write.parameters) {
    if (parameter.valueMode === "RUNTIME_INPUT") runtime[parameter.parameterKey] = runtimeValue(parameter, rank, scene);
  }
  const sourceAttackDamage = 220 + scene * 100 + rank * 5;
  const sourceBonusAttackDamage = 110 + scene * 100 + rank * 3;
  const sourceAbilityPower = 300 + scene * 200 + rank * 10;
  const sourceTotalHealth = 1800 + scene * 500 + rank * 20;
  const sourceBonusHealth = 400 + scene * 300 + rank * 15;
  const targetMaximumHealth = 2400 + scene * 1200 + rank * 50;
  return {
    key,
    def,
    rank,
    scene,
    characterLevel: scene === 0 ? 1 : 18,
    runtime,
    values: {
      SOURCE: {
        attack_damage: { TOTAL: sourceAttackDamage, BONUS: sourceBonusAttackDamage },
        ability_power: { TOTAL: sourceAbilityPower },
        hp: { TOTAL: sourceTotalHealth, BONUS: sourceBonusHealth },
      },
      TARGET: {
        attack_damage: { TOTAL: 160 + scene * 80, BONUS: 40 + scene * 30 },
        ability_power: { TOTAL: 100 + scene * 100 },
        hp: { TOTAL: targetMaximumHealth, BONUS: 500 + scene * 250 },
      },
    },
  };
};

const evalCandidateNode = (node, ctx) => {
  if (!node || typeof node !== "object") throw new Error("空候选表达式节点");
  if (node.nodeType === "PARAMETER") {
    const parameter = parameterOf(ctx.key, node.parameterKey);
    if (!parameter) {
      if (reusedKeys.has(`${ctx.key}/${node.parameterKey}`)) throw new Error(`复用参数未注入数学场景 ${ctx.key}/${node.parameterKey}`);
      throw new Error(`候选参数引用不存在 ${ctx.key}/${node.parameterKey}`);
    }
    if (parameter.valueMode === "RUNTIME_INPUT") {
      if (!Object.prototype.hasOwnProperty.call(ctx.runtime, node.parameterKey)) throw new Error(`缺少运行输入 ${ctx.key}/${node.parameterKey}`);
      return ctx.runtime[node.parameterKey];
    }
    if (parameter.valueMode === "FIXED") return parameter.fixedValue;
    if (parameter.valueMode === "SKILL_LEVEL") return parameter.levelValues?.[String(ctx.rank)];
    if (parameter.valueMode === "CHARACTER_LEVEL") return parameter.levelValues?.[String(ctx.characterLevel)];
    throw new Error(`未知参数取值模式 ${ctx.key}/${node.parameterKey}/${parameter.valueMode}`);
  }
  if (node.nodeType === "ATTRIBUTE" || node.nodeType === "SOURCE_ATTRIBUTE") {
    return attributeValue(ctx, node.attributeOwner, node.attributeKey, node.attributeValueKind);
  }
  if (node.nodeType === "SOURCE_DATA") return dataAt(ctx.key, node.dataName, ctx.rank) * (node.transform ?? 1);
  if (node.nodeType === "SOURCE_RUNTIME") {
    if (!Object.prototype.hasOwnProperty.call(ctx.runtime, node.runtimeKey)) throw new Error(`缺少来源运行输入 ${ctx.key}/${node.runtimeKey}`);
    return ctx.runtime[node.runtimeKey];
  }
  if (node.nodeType === "SOURCE_CONSTANT") {
    if (!finite(node.value)) throw new Error(`来源常数非有限数字 ${ctx.key}`);
    return node.value;
  }
  if (node.nodeType === "OPERATION") {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`运算不是恰好二元 ${ctx.key}`);
    const left = evalCandidateNode(node.operands[0], ctx);
    const right = evalCandidateNode(node.operands[1], ctx);
    if (node.operation === "ADD") return left + right;
    if (node.operation === "MULTIPLY") return left * right;
    throw new Error(`未知运算 ${ctx.key}/${node.operation}`);
  }
  throw new Error(`未知候选节点类型 ${ctx.key}/${node.nodeType}`);
};

const evalSourceRule = (node, ctx) => {
  if (!node || typeof node !== "object") throw new Error("空来源表达式节点");
  if (node.nodeType === "SOURCE_DATA" || node.nodeType === "SOURCE_RUNTIME" || node.nodeType === "SOURCE_CONSTANT" || node.nodeType === "SOURCE_ATTRIBUTE") {
    return evalCandidateNode(node, ctx);
  }
  if (node.nodeType === "ATTRIBUTE") return attributeValue(ctx, node.attributeOwner, node.attributeKey, node.attributeValueKind);
  if (node.nodeType === "OPERATION") {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`来源运算不是恰好二元 ${ctx.key}`);
    const left = evalSourceRule(node.operands[0], ctx);
    const right = evalSourceRule(node.operands[1], ctx);
    if (node.operation === "ADD") return left + right;
    if (node.operation === "MULTIPLY") return left * right;
    throw new Error(`未知来源运算 ${ctx.key}/${node.operation}`);
  }
  throw new Error(`未知来源节点类型 ${ctx.key}/${node.nodeType}`);
};

const rawStat = (part, ctx) => {
  const stat = part.mStat;
  const formula = part.mStatFormula;
  if (stat === 2) return attributeValue(ctx, "SOURCE", "attack_damage", formula === 2 ? "BONUS" : "TOTAL");
  if (stat === 12) return attributeValue(ctx, "SOURCE", "hp", formula === 2 ? "BONUS" : "TOTAL");
  if (stat === 7) return attributeValue(ctx, "SOURCE", "move_speed", formula === 2 ? "BONUS" : "TOTAL");
  if (stat === undefined || stat === null) return attributeValue(ctx, "SOURCE", "ability_power", "TOTAL");
  throw new Error(`未支持的原始属性枚举 mStat=${stat}`);
};

const evalRawPart = (key, part, ctx) => {
  if (!part || typeof part !== "object") throw new Error(`原始计算子项为空 ${key}`);
  const type = part.__type;
  if (type === "NamedDataValueCalculationPart") return dataAt(key, part.mDataValue, ctx.rank);
  if (type === "NumberCalculationPart") return part.mNumber;
  if (type === "StatByCoefficientCalculationPart") return rawStat(part, ctx) * (part.mCoefficient ?? 1);
  if (type === "StatByNamedDataValueCalculationPart") return rawStat(part, ctx) * dataAt(key, part.mDataValue, ctx.rank);
  if (type === "ProductOfSubPartsCalculationPart") return evalRawPart(key, part.mPart1, ctx) * evalRawPart(key, part.mPart2, ctx);
  if (type === "SumOfSubPartsCalculationPart") return (part.mSubparts || []).reduce((sum, subpart) => sum + evalRawPart(key, subpart, ctx), 0);
  throw new Error(`未支持的原始计算子项 ${key}/${type}`);
};

const evalRawCalculation = (key, calculationName, ctx, stack = []) => {
  if (stack.includes(calculationName)) throw new Error(`原始计算循环 ${key}/${calculationName}`);
  const calculation = sourceCalculations(key)[calculationName];
  if (!calculation) throw new Error(`原始计算树缺少 ${key}/${calculationName}`);
  let value;
  if (calculation.mModifiedGameCalculation) {
    value = evalRawCalculation(key, calculation.mModifiedGameCalculation, ctx, [...stack, calculationName]);
  } else if (Array.isArray(calculation.mFormulaParts)) {
    value = calculation.mFormulaParts.reduce((sum, part) => sum + evalRawPart(key, part, ctx), 0);
  } else {
    throw new Error(`原始计算树无可求值公式 ${key}/${calculationName}`);
  }
  if (calculation.mMultiplier) value *= evalRawPart(key, calculation.mMultiplier, ctx);
  return value;
};

const sourceExpected = (key, formula, evidence, ctx) => {
  const formulaKey = formula.formulaKey;
  const rawName = evidence.sourceCalculation;
  const runtime = ctx.runtime;
  let value;
  let rawCalculationValue = null;
  switch (`${key}/${formulaKey}`) {
    case "gnar_p/small_move_speed_bonus":
    case "gnar_p/small_attack_speed_bonus":
    case "gnar_p/small_attack_range_bonus":
      if (!rawCalculationExists(key, rawName)) throw new Error(`来源计算名不存在 ${key}/${rawName}`);
      value = runtime[evidence.sourceRule.runtimeKey];
      break;
    case "kled_p/skaarl_damage_pool":
      if (!rawCalculationExists(key, rawName)) throw new Error(`来源计算名不存在 ${key}/${rawName}`);
      value = runtime.actual_skaarl_base_health + attributeValue(ctx, "SOURCE", "hp", "BONUS");
      break;
    case "quinn_p/marked_attack_physical_damage":
      if (!rawCalculationExists(key, rawName)) throw new Error(`来源计算名不存在 ${key}/${rawName}`);
      value = (runtime.actual_mark_damage_base
        + dataAt(key, "ADRatio", ctx.rank) * attributeValue(ctx, "SOURCE", "attack_damage", "BONUS"))
        * dataAt(key, "ModesPassiveDamageMultiplier", ctx.rank);
      break;
    case "gnar_w/third_hit_magic_damage":
      if (!rawCalculationExists(key, rawName)) throw new Error(`来源计算名不存在 ${key}/${rawName}`);
      rawCalculationValue = evalRawCalculation(key, rawName, ctx)
        + dataAt(key, "MiniPercentHPDamage", ctx.rank)
          * attributeValue(ctx, "TARGET", "hp", "TOTAL");
      value = rawCalculationValue;
      break;
    case "kled_q/full_two_segment_physical_damage":
      if (!rawCalculationExists(key, rawName)) throw new Error(`来源计算名不存在 ${key}/${rawName}`);
      rawCalculationValue = evalRawCalculation(key, "TotalDamage", ctx)
        * (1 + dataAt(key, "TetherPopDamageMultiplier", ctx.rank));
      value = rawCalculationValue;
      break;
    case "kled_w/fourth_max_hp_damage":
    case "kled_w/fourth_total_extra_damage": {
      if (!rawCalculationExists(key, rawName)) throw new Error(`来源计算名不存在 ${key}/${rawName}`);
      const ratio = evalRawCalculation(key, rawName, ctx);
      const damage = ratio * attributeValue(ctx, "TARGET", "hp", "TOTAL");
      rawCalculationValue = formulaKey === "fourth_total_extra_damage"
        ? damage + dataAt(key, "BaseFlatDamage", ctx.rank)
        : damage;
      value = rawCalculationValue;
      break;
    }
    case "kled_r/minimum_magic_damage":
    case "kled_r/maximum_magic_damage": {
      if (!rawCalculationExists(key, rawName)) throw new Error(`来源计算名不存在 ${key}/${rawName}`);
      const ratio = evalRawCalculation(key, rawName, ctx);
      rawCalculationValue = ratio * attributeValue(ctx, "TARGET", "hp", "TOTAL");
      value = rawCalculationValue;
      break;
    }
    case "reksai_r/percent_health_ratio":
      if (!rawCalculationExists(key, rawName)) throw new Error(`来源计算名不存在 ${key}/${rawName}`);
      value = dataAt(key, "PercentHealthDamage", ctx.rank) * 0.01;
      break;
    case "reksai_r/total_physical_damage":
      if (!rawCalculationExists(key, rawName)) throw new Error(`来源计算名不存在 ${key}/${rawName}`);
      rawCalculationValue = evalRawCalculation(key, rawName, ctx)
        + dataAt(key, "PercentHealthDamage", ctx.rank) * 0.01
        * attributeValue(ctx, "TARGET", "hp", "TOTAL");
      value = rawCalculationValue;
      break;
    case "quinn_r/move_speed_bonus":
      value = dataAt(key, "MovementSpeedMod", ctx.rank);
      break;
    default:
      if (!rawCalculationExists(key, rawName)) throw new Error(`来源计算名不存在 ${key}/${rawName}`);
      rawCalculationValue = evalRawCalculation(key, rawName, ctx);
      value = rawCalculationValue;
      break;
  }
  if (!finite(value)) throw new Error(`原始树期望值非有限数字 ${key}/${formulaKey}`);
  return { value, rawCalculationValue };
};

const checkNodeShapeAndReferences = (key, def, node, where) => {
  refs(node, (item, nodeWhere) => {
    const location = `${where}${nodeWhere}`;
    if (item.nodeType === "OPERATION") {
      report.operationNodeCount += 1;
      if (Array.isArray(item.operands) && item.operands.length === 2 && ["ADD", "MULTIPLY"].includes(item.operation)) {
        report.binaryOperationPassCount += 1;
      } else {
        report.allOperationsBinary = false;
        fail(`运算必须是恰好两个操作数且只允许加法/乘法 ${key}/${location}`);
      }
    }
    if (item.nodeType === "PARAMETER") {
      report.typedReferencesChecked += 1;
      if (!parameterOf(key, item.parameterKey) && !reusedKeys.has(`${key}/${item.parameterKey}`)) {
        fail(`参数引用不存在 ${key}/${location}/${item.parameterKey}`);
      }
    }
    if (item.nodeType === "ATTRIBUTE" || item.nodeType === "SOURCE_ATTRIBUTE") {
      report.attributeNodeCheckCount += 1;
      if (attributeKeys.has(item.attributeKey)) {
        report.attributeNodePassCount += 1;
      } else {
        failAttribute(`属性字典不存在 ${key}/${location}/${item.attributeKey}`);
      }
    }
  });
};

const checkEffectReferences = (key, def) => {
  const formulas = new Set(def.write.formulas.map(item => item.formulaKey));
  for (const effect of def.write.effects) {
    for (const result of effect.results || []) {
      const value = result.valueRule?.value;
      if (value?.kind === "PARAMETER") {
        report.typedReferencesChecked += 1;
        if (!parameterOf(key, value.parameterKey) && !reusedKeys.has(`${key}/${value.parameterKey}`)) {
          fail(`效果参数引用不存在 ${key}/${effect.effectKey}/${value.parameterKey}`);
        }
      }
      if (value?.kind === "FORMULA") {
        report.typedReferencesChecked += 1;
        if (!formulas.has(value.formulaKey)) fail(`效果公式引用不存在 ${key}/${effect.effectKey}/${value.formulaKey}`);
      }
      const detail = result.detail || {};
      if (detail.attributeKey) {
        report.effectAttributeCheckCount += 1;
        if (attributeKeys.has(detail.attributeKey)) {
          report.effectAttributePassCount += 1;
        } else {
          failEffectAttribute(`效果属性字典不存在 ${key}/${effect.effectKey}/${detail.attributeKey}`);
        }
        if (detail.attributeKey === "move_speed_percent" || detail.attributeKey === "bonus_attack_speed_percent") {
          report.effectUnits.push({
            key,
            effectKey: effect.effectKey,
            attributeKey: detail.attributeKey,
            modifierZoneKey: detail.modifierZoneKey,
            unit: "比例值按1=100%存储",
          });
          if (detail.modifierZoneKey !== "attribute_flat_add") {
            fail(`比例属性必须使用attribute_flat_add ${key}/${effect.effectKey}/${detail.attributeKey}`);
          }
        }
      }
      if (result.valueRule) {
        const multiplier = result.valueRule.fixedMultiplier;
        const item = { key, effectKey: effect.effectKey, resultKey: result.resultKey, fixedMultiplier: multiplier };
        report.effectFinalMultipliers.push(item);
        if (finite(multiplier)) {
          item.pass = true;
        } else {
          item.pass = false;
          report.effectFinalMultiplierAllPass = false;
          fail(`效果最终倍率必须是有限数字 ${key}/${effect.effectKey}/${result.resultKey}`);
        }
      }
    }
  }
};

const checkArrays = (key, def) => {
  for (const parameter of def.write.parameters) {
    report.parameterArraysChecked += 1;
    const parameterFailuresBefore = report.failures.length;
    if (parameter.valueType === "INTEGER") report.integerParameterCount += 1;
    if (parameter.valueMode === "RUNTIME_INPUT") {
      if (parameter.fixedValue !== null || parameter.levelValues !== null) {
        report.runtimeNoDefaultAllPass = false;
        fail(`运行输入不得带默认值 ${key}/${parameter.parameterKey}`);
      }
    } else if (parameter.valueMode === "FIXED") {
      if (parameter.levelValues !== null) fail(`固定参数不得带等级数组 ${key}/${parameter.parameterKey}`);
      if (!finite(parameter.fixedValue)) fail(`固定参数必须是有限数字 ${key}/${parameter.parameterKey}`);
    } else if (parameter.valueMode === "SKILL_LEVEL" || parameter.valueMode === "CHARACTER_LEVEL") {
      const expectedKeys = parameter.valueMode === "SKILL_LEVEL"
        ? Array.from({ length: def.maxLevel }, (_, index) => String(index + 1))
        : Array.from({ length: 18 }, (_, index) => String(index + 1));
      const actualKeys = Object.keys(parameter.levelValues || {});
      if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
        report.incompleteArrayFailures += 1;
        fail(`等级数组不完整 ${key}/${parameter.parameterKey} 期望${expectedKeys.join(",")} 实际${actualKeys.join(",")}`);
      } else {
        report.completeParameterArrays += 1;
        report.completeArrayValues += actualKeys.length;
      }
    } else {
      fail(`未知参数取值模式 ${key}/${parameter.parameterKey}/${parameter.valueMode}`);
    }
    const values = parameter.valueMode === "FIXED"
      ? [parameter.fixedValue]
      : parameter.valueMode === "RUNTIME_INPUT"
        ? []
        : Object.values(parameter.levelValues || {});
    for (const value of values) {
      if (!finite(value)) fail(`参数值必须是有限数字 ${key}/${parameter.parameterKey}`);
      if (parameter.valueType === "INTEGER") {
        report.integerValueCount += 1;
        if (Number.isInteger(value)) report.integerValuePassCount += 1;
        else fail(`整数参数含小数 ${key}/${parameter.parameterKey}/${value}`);
      }
      if (parameter.parameterKey.endsWith("_ms")) {
        report.millisecondsChecked += 1;
        if (!Number.isInteger(value)) fail(`毫秒参数必须是精确整数 ${key}/${parameter.parameterKey}/${value}`);
      }
    }
    if (parameter.valueType === "INTEGER" && report.failures.length === parameterFailuresBefore) {
      report.integerParameterPassCount += 1;
    }
  }
};

const scanDictionaryRefs = (value, location = "candidate") => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanDictionaryRefs(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const current = `${location}.${key}`;
    if (["damageTypeKey", "absorbedDamageTypeKey", "modifierZoneKey", "statusKey"].includes(key) && item !== null && item !== undefined) {
      const text = String(item);
      report.dictionaryKeyCheckCount += 1;
      if (!report.dictionaryKeysSeen[key].includes(text)) report.dictionaryKeysSeen[key].push(text);
      const set = key === "damageTypeKey" || key === "absorbedDamageTypeKey"
        ? damageTypeKeys
        : key === "modifierZoneKey" ? modifierZoneKeys : statusKeys;
      if (set.has(text)) report.dictionaryKeyPassCount += 1;
      else failDictionary(`字典引用不存在 ${current}=${text}`);
    }
    scanDictionaryRefs(item, current);
  }
};

const mapEvidenceDamageType = value => ({ PHYSICAL: "physics", MAGIC: "magic", TRUE: "real" }[value] || null);

const checkFormula = (key, def, formula, sceneRank, scene) => {
  const evidence = def.formulaEvidence?.[formula.formulaKey];
  report.formulaScenarios += 1;
  const ctx = scenarioFor(key, def, sceneRank, scene);
  if (!evidence?.sourceRule) {
    fail(`公式缺少来源规则 ${key}/${formula.formulaKey}`);
    return;
  }
  let candidateValue;
  let sourceRuleValue;
  let expected;
  try {
    candidateValue = evalCandidateNode(formula.expression, ctx);
    sourceRuleValue = evalSourceRule(evidence.sourceRule, ctx);
    expected = sourceExpected(key, formula, evidence, ctx);
  } catch (error) {
    fail(`公式独立求值失败 ${key}/${formula.formulaKey}/scene${scene}: ${error.message}`);
    return;
  }
  const candidateMatches = close(candidateValue, expected.value, report.tolerance);
  const sourceRuleMatches = close(sourceRuleValue, expected.value, report.tolerance);
  const rawMatches = expected.rawCalculationValue === null || close(expected.rawCalculationValue, expected.value, report.tolerance);
  const row = {
    key,
    formulaKey: formula.formulaKey,
    rank: sceneRank,
    scene,
    sourceCalculation: evidence.sourceCalculation,
    candidateValue,
    sourceRuleValue,
    independentSourceValue: expected.value,
    rawCalculationValue: expected.rawCalculationValue,
    candidateMatches,
    sourceRuleMatches,
    rawCalculationMatches: rawMatches,
    delta: Math.abs(candidateValue - expected.value),
  };
  report.formulas.push(row);
  report.sourceTreeChecks += 1;
  if (candidateMatches) report.sourceMatches += 1;
  else fail(`候选公式与原始树不一致 ${key}/${formula.formulaKey}/scene${scene}`);
  if (sourceRuleMatches) report.sourceRuleMatches += 1;
  else failSource(`候选来源规则与原始树不一致 ${key}/${formula.formulaKey}/scene${scene}`);
  if (rawMatches) report.rawCalculationMatches += 1;
  else failSource(`原始计算树与独立值不一致 ${key}/${formula.formulaKey}/scene${scene}`);
  if (candidateMatches && sourceRuleMatches && rawMatches) report.sourceTreePasses += 1;

  const runtimeKeys = new Set();
  refs(formula.expression, node => {
    if (node.nodeType === "PARAMETER" && parameterOf(key, node.parameterKey)?.valueMode === "RUNTIME_INPUT") runtimeKeys.add(node.parameterKey);
  });
  refs(evidence.sourceRule, node => {
    if (node.nodeType === "SOURCE_RUNTIME") runtimeKeys.add(node.runtimeKey);
  });
  if (runtimeKeys.size > 0) {
    for (const runtimeKey of runtimeKeys) {
      report.missingRuntimeCases += 1;
      const missingCtx = { ...ctx, runtime: { ...ctx.runtime } };
      delete missingCtx.runtime[runtimeKey];
      let candidateRejected = false;
      let sourceRejected = false;
      try { evalCandidateNode(formula.expression, missingCtx); } catch { candidateRejected = true; }
      try { evalSourceRule(evidence.sourceRule, missingCtx); } catch { sourceRejected = true; }
      if (candidateRejected && sourceRejected) report.missingRuntimeRejected += 1;
      else {
        report.missingRuntimeAllRejected = false;
        fail(`缺少运行输入未同时拒绝 ${key}/${formula.formulaKey}/${runtimeKey}/scene${scene}`);
      }
    }
  }
};

const getParameter = (key, parameterKey) => sourceCandidate(key).write.parameters.find(item => item.parameterKey === parameterKey);
const addSpecial = (name, details, pass) => {
  const item = { name, ...details, pass };
  report.specialFixAssertions.push(item);
  if (!pass) {
    report.specialFixesAllPass = false;
    fail(`修订专项核对失败 ${name}`);
  }
};

// 先审查所有结构、引用、数组和效果，再进行数值场景。
scanDictionaryRefs(candidate);
for (const key of candidate.order) {
  const def = sourceCandidate(key);
  if (!def) {
    fail(`候选技能顺序引用不存在 ${key}`);
    continue;
  }
  checkArrays(key, def);
  checkEffectReferences(key, def);
  for (const formula of def.write.formulas) {
    checkNodeShapeAndReferences(key, def, formula.expression, `formula/${formula.formulaKey}/`);
    const evidence = def.formulaEvidence?.[formula.formulaKey];
    if (!evidence?.sourceRule) continue;
    checkNodeShapeAndReferences(key, def, evidence.sourceRule, `sourceRule/${formula.formulaKey}/`);
  }
}
report.attributeNodeAllPass = report.attributeNodePassCount === report.attributeNodeCheckCount;
report.effectAttributeAllPass = report.effectAttributePassCount === report.effectAttributeCheckCount;
report.allOperationsBinary = report.operationNodeCount === report.binaryOperationPassCount;

for (const key of candidate.order) {
  const def = sourceCandidate(key);
  report.formulaCount += def.write.formulas.length;
  for (const formula of def.write.formulas) {
    const ranks = [1, def.maxLevel];
    for (const [scene, rank] of ranks.entries()) checkFormula(key, def, formula, rank, scene);
    const evidence = def.formulaEvidence?.[formula.formulaKey];
    const mappedDamageType = mapEvidenceDamageType(evidence?.damageType);
    if (mappedDamageType) {
      report.formulaEvidenceDamageTypeMapping.push({
        key,
        formulaKey: formula.formulaKey,
        sourceLabel: evidence.damageType,
        mappedDamageTypeKey: mappedDamageType,
        exists: damageTypeKeys.has(mappedDamageType),
      });
      if (!damageTypeKeys.has(mappedDamageType)) failDictionary(`来源伤害类型映射不存在 ${key}/${formula.formulaKey}/${mappedDamageType}`);
    }
  }
}
report.missingRuntimeAllRejected = report.missingRuntimeAllRejected && report.missingRuntimeCases === report.missingRuntimeRejected;

// 纳尔W/R移速档：从原始GnarR计算树读取20/40/60/80%，再对照修订候选。
const gnarRRawRow = sourceDataRow("gnar_r", "RHyperMovementSpeedPercent");
const gnarRRaw = [1, 2, 3, 4].map(rank => gnarRRawRow.values[rank - 1]);
const gnarMoveParams = [
  ["gnar_w", "r_unlearned_move_speed_ratio", 1],
  ["gnar_w", "r_level_1_move_speed_ratio", 2],
  ["gnar_w", "r_level_2_move_speed_ratio", 3],
  ["gnar_w", "r_level_3_move_speed_ratio", 4],
  ["gnar_r", "unlearned_move_speed_ratio", 1],
];
for (const [skillKey, parameterKey, rawRank] of gnarMoveParams) {
  const parameter = getParameter(skillKey, parameterKey);
  const rawPercent = gnarRRaw[rawRank - 1];
  const expectedRatio = rawPercent / 100;
  const candidateValue = parameter?.fixedValue;
  const pass = close(candidateValue, expectedRatio, report.tolerance);
  report.gnarMoveSpeedAssertions.push({ skillKey, parameterKey, sourceData: "GnarR.RHyperMovementSpeedPercent", rawRank, rawPercent, expectedRatio, candidateValue, pass });
  if (!pass) {
    report.gnarMoveSpeedAllPass = false;
    fail(`纳尔移速档与原始R等级不一致 ${skillKey}/${parameterKey}`);
  }
}

// 克烈R：逐个R等级读取PercentHPBase及两个原始mMultiplier，按MAXHP两场景验算。
const kledRSource = sourceCalculations("kled_r");
const kledRMinMultiplier = kledRSource.MinimumDamageTooltip?.mMultiplier?.mNumber;
const kledRMaxMultiplier = kledRSource.MaximumChargeDamage?.mMultiplier?.mNumber;
if (!close(kledRMinMultiplier, 0.01, report.tolerance)) fail("克烈R原始最小伤害mMultiplier不是0.01");
if (!close(kledRMaxMultiplier, 0.03, report.tolerance)) fail("克烈R原始最大伤害mMultiplier不是0.03");
if (getParameter("kled_r", "percent_point_unit")) {
  report.noCandidatePercentPointUnit = false;
  fail("克烈R仍存在会重复缩放的percent_point_unit");
}
for (const rank of [1, 2, 3]) {
  const rawPercentBase = dataAt("kled_r", "PercentHPBase", rank);
  const rawBracketCoefficient = kledRSource["{598e3ed3}"]?.mFormulaParts?.[1]?.mCoefficient;
  const rawMinimumFormula = kledRSource.MinimumDamageTooltip;
  const rawMaximumFormula = kledRSource.MaximumChargeDamage;
  for (const scene of [0, 1]) {
    const def = sourceCandidate("kled_r");
    const ctx = scenarioFor("kled_r", def, rank, scene);
    const bonusAD = attributeValue(ctx, "SOURCE", "attack_damage", "BONUS");
    const targetMAXHP = attributeValue(ctx, "TARGET", "hp", "TOTAL");
    const bracket = rawPercentBase + rawBracketCoefficient * bonusAD;
    const expectedMinimum = rawMinimumFormula.mMultiplier.mNumber * bracket * targetMAXHP;
    const expectedMaximum = rawMaximumFormula.mMultiplier.mNumber * bracket * targetMAXHP;
    for (const [formulaKey, expectedValue, rawFormula] of [
      ["minimum_magic_damage", expectedMinimum, rawMinimumFormula],
      ["maximum_magic_damage", expectedMaximum, rawMaximumFormula],
    ]) {
      const formula = def.write.formulas.find(item => item.formulaKey === formulaKey);
      const evidence = def.formulaEvidence[formulaKey];
      let candidateValue = null;
      let sourceRuleValue = null;
      let rawCalculationValue = null;
      try {
        candidateValue = evalCandidateNode(formula.expression, ctx);
        sourceRuleValue = evalSourceRule(evidence.sourceRule, ctx);
        const rawRatio = evalRawCalculation("kled_r", formulaKey === "minimum_magic_damage" ? "MinimumDamageTooltip" : "MaximumChargeDamage", ctx);
        rawCalculationValue = rawRatio * targetMAXHP;
      } catch (error) {
        fail(`克烈R等级场景求值失败 rank${rank}/scene${scene}/${formulaKey}: ${error.message}`);
      }
      const pass = close(candidateValue, expectedValue, report.tolerance)
        && close(sourceRuleValue, expectedValue, report.tolerance)
        && close(rawCalculationValue, expectedValue, report.tolerance);
      report.kledRLevelAssertions.push({
        rank,
        scene,
        formulaKey,
        sourcePercentHPBase: rawPercentBase,
        sourceBracketCoefficient: rawBracketCoefficient,
        sourceChargeMultiplier: rawFormula.mMultiplier.mNumber,
        sourceBonusAD: bonusAD,
        targetMAXHP,
        expectedValue,
        candidateValue,
        sourceRuleValue,
        rawCalculationValue,
        pass,
      });
      if (!pass) {
        report.kledRLevelAllPass = false;
        fail(`克烈R等级/MAXHP核算不一致 rank${rank}/scene${scene}/${formulaKey}`);
      }
    }
  }
}

// 飞弹速度从绑定对象原始mSpell字段读取；字段不能误命名为射程。
const missileChecks = [
  { skillKey: "gnar_q", sourceField: "mSpell.missileSpeed", rawValue: sourceSpell("gnar_q").missileSpeed, candidateKey: "missile_speed" },
  { skillKey: "quinn_q", sourceField: "mSpell.missileSpeed", rawValue: sourceSpell("quinn_q").missileSpeed, candidateKey: "missile_speed" },
  { skillKey: "quinn_q", sourceField: "mSpell.mMissileSpec.movementComponent.mSpeed", rawValue: sourceSpell("quinn_q").mMissileSpec?.movementComponent?.mSpeed, candidateKey: "missile_speed" },
];
for (const item of missileChecks) {
  const parameter = getParameter(item.skillKey, item.candidateKey);
  const pass = finite(item.rawValue) && close(parameter?.fixedValue, item.rawValue, report.tolerance);
  report.missileSpeedAssertions.push({ ...item, candidateValue: parameter?.fixedValue, pass });
  if (!pass) {
    report.missileSpeedAllPass = false;
    fail(`飞弹速度字段核对失败 ${item.skillKey}/${item.sourceField}`);
  }
}
for (const key of ["gnar_q", "quinn_q"]) {
  if (getParameter(key, "missile_range")) {
    report.missileSpeedAllPass = false;
    fail(`飞弹速度仍错误命名为missile_range ${key}`);
  }
}

// 四项修订专项：纯显形排除、R的3秒资格、RekSai W保护项和范围状态。
const quinnPReveal = dataAt("quinn_p", "RevealDuration", 1);
const quinnPRevealPresent = Boolean(getParameter("quinn_p", "reveal_duration_ms"));
addSpecial("quinn_p纯显形排除", {
  sourceRevealDurationSeconds: quinnPReveal,
  candidateParameterPresent: quinnPRevealPresent,
}, !quinnPRevealPresent && close(quinnPReveal, 4, report.tolerance));
const quinnRRemoval = dataAt("quinn_r", "SlowDuration", 1);
const quinnRRemovalParameter = getParameter("quinn_r", "non_minion_damage_removal_duration_ms");
const quinnRCooldown = getParameter("quinn_r", "cooldown_ms");
addSpecial("quinn_r非小兵伤害移除时长独立于冷却", {
  sourceSlowDurationSeconds: quinnRRemoval,
  candidateRemovalDurationMs: quinnRRemovalParameter?.fixedValue,
  candidateCooldownLevelValues: quinnRCooldown?.levelValues,
}, close(quinnRRemoval, 3, report.tolerance)
  && quinnRRemovalParameter?.fixedValue === 3000
  && quinnRRemovalParameter.parameterKey !== quinnRCooldown?.parameterKey
  && Object.values(quinnRCooldown?.levelValues || {}).every(value => value === 3000));
const reksaiW = sourceCandidate("reksai_w");
addSpecial("reksai_w保护冷却不生成新组成", {
  pending: reksaiW.pending,
  parameters: reksaiW.write.parameters.length,
  formulas: reksaiW.write.formulas.length,
  effects: reksaiW.write.effects.length,
}, Array.isArray(reksaiW.pending) && reksaiW.pending.length === 0
  && reksaiW.write.parameters.length === 0
  && reksaiW.write.formulas.length === 0
  && reksaiW.write.effects.length === 0);

const sourceFieldChecks = [
  { name: "gnar_q飞弹速度", path: "gnar_q.mSpell.missileSpeed", actual: sourceSpell("gnar_q").missileSpeed, expected: 1200 },
  { name: "quinn_q飞弹速度", path: "quinn_q.mSpell.missileSpeed", actual: sourceSpell("quinn_q").missileSpeed, expected: 1550 },
  { name: "quinn_q飞弹组件速度", path: "quinn_q.mSpell.mMissileSpec.movementComponent.mSpeed", actual: sourceSpell("quinn_q").mMissileSpec?.movementComponent?.mSpeed, expected: 1550 },
  { name: "quinn_rSlowDuration", path: "quinn_r.DataValues.SlowDuration[1]", actual: quinnRRemoval, expected: 3 },
];
for (const item of sourceFieldChecks) {
  const pass = close(item.actual, item.expected, report.tolerance);
  report.sourceFieldChecks.push({ ...item, pass });
  if (!pass) {
    report.sourceFieldAllPass = false;
    fail(`原始字段核对失败 ${item.name}/${item.path}`);
  }
}

report.dictionaryKeysSeen.damageTypeKey.sort();
report.dictionaryKeysSeen.absorbedDamageTypeKey.sort();
report.dictionaryKeysSeen.modifierZoneKey.sort();
report.dictionaryKeysSeen.statusKey.sort();
report.formulaScenariosAtLeastTwo = report.formulaScenarios === report.formulaCount * 2;
if (!report.formulaScenariosAtLeastTwo) fail(`公式场景不足：${report.formulaScenarios}/${report.formulaCount * 2}`);
report.completeParameterArraysAllPass = report.incompleteArrayFailures === 0;
report.integerParametersSeparateCountsPass = report.integerParameterPassCount === report.integerParameterCount;
report.integerValuesSeparateCountsPass = report.integerValuePassCount === report.integerValueCount;
report.missingRuntimeRejectedAll = report.missingRuntimeAllRejected;
report.status = report.failures.length === 0 ? "通过" : "失败";
fs.writeFileSync(path.join(ROOT, "独立数学报告.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  status: report.status,
  revision: report.revision,
  formulaCount: report.formulaCount,
  formulaScenarios: report.formulaScenarios,
  sourceMatches: report.sourceMatches,
  sourceRuleMatches: report.sourceRuleMatches,
  missingRuntimeCases: report.missingRuntimeCases,
  missingRuntimeRejected: report.missingRuntimeRejected,
  integerParameterCount: report.integerParameterCount,
  integerValueCount: report.integerValueCount,
  dictionaryKeyCheckCount: report.dictionaryKeyCheckCount,
  gnarMoveSpeedAssertions: report.gnarMoveSpeedAssertions.length,
  kledRLevelAssertions: report.kledRLevelAssertions.length,
  missileSpeedAssertions: report.missileSpeedAssertions.length,
  failures: report.failures.length,
  report: path.join(ROOT, "独立数学报告.json"),
}, null, 2));
if (report.failures.length) process.exitCode = 1;

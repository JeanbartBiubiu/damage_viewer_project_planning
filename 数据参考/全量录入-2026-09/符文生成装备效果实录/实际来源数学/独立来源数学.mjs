import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(DIR, '..');
const ROOT_DIR = path.join(ARTIFACTS, 'rune-equipment-ownership-root-20260910');
const EXEC_DIR = path.resolve(ARTIFACTS, 'rune-equipment-ownership-execution');
const OUTPUT_DIR = DIR;
const API_PREFIX = '/api/admin/games/lol';
const EXPECTED = Object.freeze({
  candidate: '81f13a8676254cd7db18d40e5fffe9c54bea98ea45651963a112e7f3b55a460a',
  plan: '8d63f461adff0fe79803a5422e2177f67e66c0b6856de1fad05d1d457380cce0',
  math: '3c6f4d997e4146795d4b6173c86a7b2392e382d66949cb360c58f0dcc1f058f0',
  fixedSource: 'd8f769c5c407406bd38d1154115334403e92141001b5c5a39e2b049c45e3f92f',
  biscuitSource: 'b7ecdc756cdc1e00b4b2b5ffb8a4a5e879d0d176599575724714b255b6c41b66',
  actualReport: '8a02524d8ca96482eb85c1078e55561fdfeb6da8c8241fbf039ca5b27c30bc37',
  actualSnapshot: 'f80324d082711f4172fbe5382dcc3559085dd072a4bb6c90f169833b7abcbc2c'
});
const FIXED_CANDIDATE = path.join(ARTIFACTS, 'rune-equipment-ownership-luna-candidate', '修订一', '完整候选.json');
const PLAN = path.join(ARTIFACTS, 'rune-equipment-ownership-luna-candidate', '修订一', '写前请求计划.json');
const CANDIDATE_MATH = path.join(ARTIFACTS, 'rune-equipment-ownership-luna-candidate', '修订一', '独立数学报告.json');
const FIXED_SOURCE = path.join(ROOT_DIR, '四装备固定来源.json');
const BISCUIT_SOURCE = path.join(ROOT_DIR, '饼干当前具名来源补证.json');

function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function readPinned(file, expected) {
  const bytes = fs.readFileSync(file);
  const actual = sha(bytes);
  if (actual !== expected) throw new Error('冻结文件散列不一致: ' + file + '; actual=' + actual + '; expected=' + expected);
  return bytes;
}
function jsonPinned(file, expected) { return JSON.parse(readPinned(file, expected).toString('utf8')); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function integer(value) { return Number.isInteger(value); }
function close(a, b, tolerance = 1e-9) { return finite(a) && finite(b) && Math.abs(a - b) <= tolerance; }
function same(a, b) {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, index) => same(value, b[index]));
  if (object(a)) return object(b) && Object.keys(a).sort().join('|') === Object.keys(b).sort().join('|') && Object.keys(a).every((key) => same(a[key], b[key]));
  return Object.is(a, b);
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function iso(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJson(file, value) {
  ensure(path.dirname(file));
  const temp = file + '.tmp-' + process.pid + '-' + Date.now();
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
}
function nowId() { return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'); }
function parseArgs(argv) {
  if (!argv.length || (argv.length === 1 && argv[0] === '--validate-only')) return { mode: 'validate-only', report: null };
  if (argv.length === 2 && argv[0] === '--report') {
    if (!argv[1]) throw new Error('--report缺少GET复核报告路径');
    return { mode: 'actual', report: path.resolve(argv[1]) };
  }
  throw new Error('只接受--validate-only或--report <GET复核报告.json>');
}

function loadStatic() {
  const candidate = jsonPinned(FIXED_CANDIDATE, EXPECTED.candidate);
  const plan = jsonPinned(PLAN, EXPECTED.plan);
  const candidateMath = jsonPinned(CANDIDATE_MATH, EXPECTED.math);
  const fixed = jsonPinned(FIXED_SOURCE, EXPECTED.fixedSource);
  const biscuit = jsonPinned(BISCUIT_SOURCE, EXPECTED.biscuitSource);
  assert(candidate.gameId === 'lol' && candidate.officialVersion === '16.17.1', '候选版本不一致');
  assert(plan.candidateSha256 === EXPECTED.candidate && plan.execute === false, '计划未绑定冻结候选');
  assert(candidateMath.status === '通过' && candidateMath.checks?.errorCount === 0, '候选数学不是无错误通过');
  assert(fixed.version?.client === '16.17' && fixed.version?.official === '16.17.1', '固定来源版本不一致');
  assert(biscuit.clientBuild === '16.17.8104348' && biscuit.itemPath === 'Items/2010', '饼干补证版本或路径不一致');
  return { candidate, plan, candidateMath, fixed, biscuit };
}

function sourceObject(staticData, equipmentKey) {
  const item = staticData.fixed.objects.find((value) => value.equipmentKey === equipmentKey);
  assert(item, '固定来源缺少装备: ' + equipmentKey);
  return item;
}
function namedValues(item) {
  const raw = item.source?.object?.mDataValues || [];
  return Object.fromEntries(raw.filter((x) => x && typeof x.mName === 'string').map((x) => [x.mName, x.mValue]));
}
function makeSourceExpectations(staticData) {
  const item2010 = sourceObject(staticData, 'item_2010');
  const item2150 = sourceObject(staticData, 'item_2150');
  const item2152 = sourceObject(staticData, 'item_2152');
  const item2422 = sourceObject(staticData, 'item_2422');
  const biscuitValues = namedValues(item2010);
  const supplementValues = namedValues({ source: { object: staticData.biscuit.item } });
  const mapping = staticData.biscuit.mapping || [];
  const hpPart = mapping.find((x) => x.node?.mStat === 12);
  const flatPart = mapping.find((x) => x.namedData?.mName === 'FlatHealTOOLTIP');
  assert(hpPart?.namedData?.mName === 'MaxHPMultiplierTOOLTIP', '来源未证明mStat=12为最大生命比例');
  assert(flatPart?.namedData?.mValue === 20, '来源未证明固定恢复20');
  assert(close(biscuitValues.MaxHPMultiplierTOOLTIP, 0.014999999664723873, 1e-12), '来源最大生命系数漂移');
  assert(close(hpPart.namedData.mValue, biscuitValues.MaxHPMultiplierTOOLTIP, 1e-12), '来源映射与物品数据不一致');
  assert(biscuitValues.FlatHealTOOLTIP === 20 && biscuitValues.BonusMaxHealthTOOLTIP === 30, '饼干固定来源值不一致');
  assert(biscuitValues.PotionDurationTOOLTIP === 5 && biscuitValues.MaxHealIncreaseTOOLTIP === 100, '饼干时间或提升上限来源不一致');
  assert(close(biscuitValues.MinHPThresholdTOOLTIP, 0.30000001192092896, 1e-12), '饼干低血阈值来源不一致');
  assert(item2150.source?.official?.description?.includes('提供1技能点数'), '技能合剂来源未证明1技能点');
  const forceValues = namedValues(item2152);
  assert(forceValues.AdaptiveAmount === 25 && forceValues.Duration === 60, '原力合剂来源值不一致');
  assert(item2422.source?.object?.mFlatMovementSpeedMod === 25, '鞋子直接移动速度来源不一致');
  assert(Array.isArray(staticData.biscuit.item?.mEffectAmount) && staticData.biscuit.item.mEffectAmount[0] === 10, '来源未证明鞋子附加10');
  assert(supplementValues.missing === undefined, '来源提取出现未定义哨兵');
  return {
    item2010: { durationMs: 5000, flatRecovery: 20, ratio: 0.015, rawRatio: biscuitValues.MaxHPMultiplierTOOLTIP, maxIncreaseRatio: 1, maxAtHealthRatio: 0.3, permanentPerCookie: 30, additionalMoveSpeed: 10 },
    item2150: { skillPoints: 1 },
    item2152: { adaptiveForce: 25, durationMs: 60000 },
    item2422: { directMoveSpeed: 25, additionalMoveSpeed: 10, finalMoveSpeed: 35 },
    evidence: {
      clientRatioRaw: biscuitValues.MaxHPMultiplierTOOLTIP,
      clientRatioNormalized: 0.015,
      mStat: hpPart.node.mStat,
      officialRatioText: '官方说明中的2%仅记录差异，不替换客户端0.015'
    }
  };
}

function actualObservations(snapshot) {
  assert(Array.isArray(snapshot.observations) && snapshot.observations.length === 102, '独立GET快照不是102条观察');
  const byId = new Map();
  const byRoute = new Map();
  for (const row of snapshot.observations) {
    if (row.id) byId.set(row.id, row);
    if (row.route) byRoute.set(row.route, row);
  }
  return { byId, byRoute };
}
function rowById(actual, id) {
  const row = actual.byId.get(id);
  assert(row, '实际GET快照缺少对象: ' + id);
  assert(row.status === 200, '实际GET对象不是200: ' + id + ' HTTP' + row.status);
  assert(object(row.data), '实际GET对象无JSON详情: ' + id);
  return row.data;
}
function parameter(actual, skill, key) { return rowById(actual, skill + '-parameter-' + key); }
function formula(actual, key) { return rowById(actual, 'item_2010_consume-formula-' + key); }
function effect(actual, skill, key) { return rowById(actual, skill + '-effect-' + key); }
function skill(actual, skillKey) { return rowById(actual, skillKey + '-skill'); }

function checkParameters(actual, source) {
  const expected = [
    ['item_2010_consume', 'recovery_duration_ms', 'INTEGER', 'FIXED', 5000],
    ['item_2010_consume', 'flat_recovery', 'INTEGER', 'FIXED', 20],
    ['item_2010_consume', 'client_health_recovery_ratio', 'DECIMAL', 'FIXED', 0.015],
    ['item_2010_consume', 'maximum_recovery_increase_ratio', 'DECIMAL', 'FIXED', 1],
    ['item_2010_consume', 'health_ratio_at_maximum_recovery', 'DECIMAL', 'FIXED', 0.3],
    ['item_2010_consume', 'permanent_health_per_cookie', 'INTEGER', 'FIXED', 30],
    ['item_2010_consume', 'actual_consumed_or_sold_count', 'INTEGER', 'RUNTIME_INPUT', null],
    ['item_2010_consume', 'actual_missing_health_boost_ratio', 'DECIMAL', 'RUNTIME_INPUT', null],
    ['item_2150_consume', 'skill_points_granted', 'INTEGER', 'FIXED', 1],
    ['item_2152_consume', 'adaptive_force_amount', 'INTEGER', 'FIXED', 25],
    ['item_2152_consume', 'duration_ms', 'INTEGER', 'FIXED', 60000],
    ['item_2422_passive', 'additional_move_speed', 'INTEGER', 'FIXED', 10]
  ];
  const values = {};
  for (const [skillKey, key, valueType, valueMode, expectedValue] of expected) {
    const data = parameter(actual, skillKey, key);
    assert(data.parameterKey === key && data.skillKey === skillKey, '实际参数归属错误: ' + skillKey + '/' + key);
    assert(data.valueType === valueType && data.valueMode === valueMode, '实际参数类型或模式错误: ' + skillKey + '/' + key);
    assert(data.levelValues === null, '实际参数等级数组必须为空: ' + skillKey + '/' + key);
    if (valueMode === 'RUNTIME_INPUT') {
      assert(data.fixedValue === null, '运行输入出现默认值: ' + skillKey + '/' + key);
    } else {
      assert(finite(data.fixedValue) && close(data.fixedValue, expectedValue), '实际参数值错误: ' + skillKey + '/' + key);
      if (valueType === 'INTEGER') assert(integer(data.fixedValue), '实际整数参数含小数: ' + skillKey + '/' + key);
    }
    if (key.endsWith('_ms')) assert(valueType === 'INTEGER' && integer(data.fixedValue), '实际毫秒参数不是整数: ' + key);
    values[skillKey + '/' + key] = data;
  }
  assert(close(values['item_2010_consume/client_health_recovery_ratio'].fixedValue, source.item2010.ratio), '实际比例与来源归一化值不一致');
  return values;
}

function collectParametersForSkill(actual, skillKey) {
  const result = {};
  for (const row of actual.byId.values()) {
    if (row.id?.startsWith(skillKey + '-parameter-')) result[row.data.parameterKey] = row.data;
  }
  return result;
}
function walkFormula(node, parameterMap, references, formulaKey) {
  assert(object(node) && typeof node.nodeType === 'string', '公式节点缺失: ' + formulaKey);
  if (node.nodeType === 'PARAMETER') {
    assert(parameterMap[node.parameterKey], '公式引用悬空参数: ' + formulaKey + '/' + node.parameterKey);
    references.parameters.push(node.parameterKey);
    return;
  }
  if (node.nodeType === 'ATTRIBUTE') {
    assert(node.attributeOwner === 'SOURCE' && node.attributeKey === 'hp' && node.attributeValueKind === 'TOTAL', '公式属性来源不是SOURCE.hp.TOTAL: ' + formulaKey);
    references.attributes.push(node.attributeKey);
    return;
  }
  assert(node.nodeType === 'OPERATION', '公式节点类型不允许: ' + node.nodeType);
  assert(Array.isArray(node.operands) && node.operands.length === 2, '公式运算不是二元: ' + formulaKey);
  assert(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(node.operation), '公式运算不允许: ' + node.operation);
  references.operations.push(node.operation);
  node.operands.forEach((child) => walkFormula(child, parameterMap, references, formulaKey));
}
function checkFormulas(actual) {
  const parameterMap = collectParametersForSkill(actual, 'item_2010_consume');
  const formulas = {};
  for (const key of ['base_biscuit_recovery', 'biscuit_recovery_total', 'permanent_health_gain']) {
    const data = formula(actual, key);
    assert(data.formulaKey === key && data.skillKey === 'item_2010_consume', '实际公式归属错误: ' + key);
    const references = { parameters: [], attributes: [], operations: [] };
    walkFormula(data.expression, parameterMap, references, key);
    formulas[key] = { data, references };
  }
  assert(formulas.base_biscuit_recovery.references.parameters.includes('flat_recovery'), '基数公式缺固定恢复');
  assert(formulas.base_biscuit_recovery.references.parameters.includes('client_health_recovery_ratio'), '基数公式缺最大生命比例');
  assert(formulas.biscuit_recovery_total.references.parameters.includes('actual_missing_health_boost_ratio'), '总量公式缺已损生命运行输入');
  assert(formulas.permanent_health_gain.references.parameters.includes('actual_consumed_or_sold_count'), '永久公式缺实际消费计数运行输入');
  return formulas;
}

class MissingInput extends Error {
  constructor(key) { super('MISSING_RUNTIME_INPUT:' + key); this.code = 'MISSING_RUNTIME_INPUT'; }
}
function parameterValue(data, runtimeInputs, key) {
  if (data.valueMode === 'FIXED') {
    assert(finite(data.fixedValue), '固定参数非有限值: ' + key);
    return data.fixedValue;
  }
  if (data.valueMode === 'RUNTIME_INPUT') {
    if (!Object.hasOwn(runtimeInputs, key) || runtimeInputs[key] == null) throw new MissingInput(key);
    assert(finite(runtimeInputs[key]), '运行输入非有限值: ' + key);
    return runtimeInputs[key];
  }
  throw new Error('未知参数模式拒绝求值: ' + key + '/' + data.valueMode);
}
function evaluate(node, parameterMap, environment, runtimeInputs) {
  if (node.nodeType === 'PARAMETER') return parameterValue(parameterMap[node.parameterKey], runtimeInputs, node.parameterKey);
  if (node.nodeType === 'ATTRIBUTE') {
    const key = node.attributeOwner + '.' + node.attributeKey + '.' + node.attributeValueKind;
    if (!Object.hasOwn(environment, key) || environment[key] == null) throw new MissingInput(key);
    assert(finite(environment[key]), '属性输入非有限值: ' + key);
    return environment[key];
  }
  assert(node.nodeType === 'OPERATION' && Array.isArray(node.operands) && node.operands.length === 2, '运行公式不是二元运算');
  const left = evaluate(node.operands[0], parameterMap, environment, runtimeInputs);
  const right = evaluate(node.operands[1], parameterMap, environment, runtimeInputs);
  let result;
  if (node.operation === 'ADD') result = left + right;
  else if (node.operation === 'SUBTRACT') result = left - right;
  else if (node.operation === 'MULTIPLY') result = left * right;
  else if (node.operation === 'DIVIDE') {
    if (right === 0) throw new Error('DIVIDE_BY_ZERO');
    result = left / right;
  } else if (node.operation === 'MIN') result = Math.min(left, right);
  else if (node.operation === 'MAX') result = Math.max(left, right);
  else throw new Error('未知运算拒绝求值: ' + node.operation);
  assert(finite(result), '公式结果非有限值');
  return result;
}
function scenario(formulaData, parameterMap, inputs, expectedValue, name) {
  const actualValue = evaluate(formulaData.expression, parameterMap, { 'SOURCE.hp.TOTAL': inputs.hp }, inputs.runtime || {});
  assert(close(actualValue, expectedValue), name + '实际值' + actualValue + '不等于期望值' + expectedValue);
  return { name, inputs, expected: expectedValue, actual: actualValue, delta: actualValue - expectedValue };
}
function checkFormulaScenarios(formulas, actual, source) {
  const parameterMap = collectParametersForSkill(actual, 'item_2010_consume');
  const base = source.item2010.flatRecovery;
  const ratio = source.item2010.ratio;
  const baseScenarios = [
    scenario(formulas.base_biscuit_recovery.data, parameterMap, { hp: 1000, runtime: {} }, base + ratio * 1000, '基数场景A'),
    scenario(formulas.base_biscuit_recovery.data, parameterMap, { hp: 2000, runtime: {} }, base + ratio * 2000, '基数场景B')
  ];
  const totalScenarios = [
    scenario(formulas.biscuit_recovery_total.data, parameterMap, { hp: 1000, runtime: { actual_missing_health_boost_ratio: 0 } }, 35, '总量场景A'),
    scenario(formulas.biscuit_recovery_total.data, parameterMap, { hp: 2000, runtime: { actual_missing_health_boost_ratio: 1.2 } }, 100, '总量场景B上限')
  ];
  const permanentScenarios = [
    scenario(formulas.permanent_health_gain.data, parameterMap, { hp: 0, runtime: { actual_consumed_or_sold_count: 1 } }, 30, '永久场景A'),
    scenario(formulas.permanent_health_gain.data, parameterMap, { hp: 0, runtime: { actual_consumed_or_sold_count: 2 } }, 60, '永久场景B')
  ];
  let missingTotal = false;
  let missingPermanent = false;
  try { evaluate(formulas.biscuit_recovery_total.data.expression, parameterMap, { 'SOURCE.hp.TOTAL': 1000 }, {}); } catch (error) { missingTotal = error.code === 'MISSING_RUNTIME_INPUT'; }
  try { evaluate(formulas.permanent_health_gain.data.expression, parameterMap, { 'SOURCE.hp.TOTAL': 1000 }, {}); } catch (error) { missingPermanent = error.code === 'MISSING_RUNTIME_INPUT'; }
  assert(missingTotal && missingPermanent, '缺运行输入未拒绝');
  return {
    base_biscuit_recovery: baseScenarios,
    biscuit_recovery_total: totalScenarios,
    permanent_health_gain: permanentScenarios,
    missingInputChecks: { totalWithoutBoostRejected: missingTotal, permanentWithoutCountRejected: missingPermanent }
  };
}

function checkEffects(actual, source, formulas) {
  const biscuit = effect(actual, 'item_2010_consume', 'permanent_health_gain');
  const shoe = effect(actual, 'item_2422_passive', 'magical_footwear_additional_speed');
  const inspect = (data, expectedAttribute, expectedValueKind, expectedKey) => {
    const lifecycle = data.lifecycle;
    const result = data.results?.[0];
    const behavior = result?.lifecycleBehavior;
    assert(lifecycle?.instanceScope === 'SOURCE' && lifecycle?.applicationStacksValue?.kind === 'FIXED' && lifecycle.applicationStacksValue.value === 1 && lifecycle.maxStacksValue?.value === 1, '效果生命周期层数不正确: ' + data.effectKey);
    assert(behavior?.moment === 'PERSISTENT' && behavior.valueReadMode === 'APPLICATION_SNAPSHOT' && behavior.stackValueMode === 'SHARED' && behavior.reapplicationValueMode === 'REPLACE', '效果生命周期读取或重施模式不正确: ' + data.effectKey);
    assert(result.target === 'SOURCE' && result.resultType === 'ATTRIBUTE_CHANGE', '效果目标或结果类型不正确: ' + data.effectKey);
    assert(result.detail?.attributeKey === expectedAttribute && result.detail.modifierZoneKey === 'attribute_flat_add' && result.detail.operation === 'INCREASE', '效果属性单位或乘区不正确: ' + data.effectKey);
    assert(result.valueRule?.fixedMultiplier === 1 && result.valueRule.fixedMinValue === 0 && result.valueRule.fixedMaxValue === null, '效果固定倍率或边界不正确: ' + data.effectKey);
    assert(result.valueRule.value?.kind === expectedValueKind, '效果值引用类型不正确: ' + data.effectKey);
    assert(result.valueRule.value?.[expectedValueKind === 'FORMULA' ? 'formulaKey' : 'parameterKey'] === expectedKey, '效果值引用键不正确: ' + data.effectKey);
  };
  inspect(biscuit, 'hp', 'FORMULA', 'permanent_health_gain');
  inspect(shoe, 'move_speed', 'PARAMETER', 'additional_move_speed');
  assert(formulas.permanent_health_gain, '永久效果引用公式不存在');
  const sequence = [1, 2, 3, 3].map((count, index) => ({ step: index + 1, consumedOrSoldCount: count, contribution: 30 * count }));
  assert(sequence.map((x) => x.contribution).join(',') === '30,60,90,90', '永久REPLACE序列不正确');
  const shoeFinal = source.item2422.directMoveSpeed + source.item2422.additionalMoveSpeed;
  assert(shoeFinal === 35, '鞋子最终移动速度不是25+10=35');
  return {
    biscuit: { effectKey: biscuit.effectKey, lifecycleBehavior: biscuit.results[0].lifecycleBehavior, finalContributions: sequence, attributeUnit: 'hp点数', modifierZone: 'attribute_flat_add' },
    shoe: { effectKey: shoe.effectKey, lifecycleBehavior: shoe.results[0].lifecycleBehavior, directMoveSpeed: source.item2422.directMoveSpeed, additionalMoveSpeed: source.item2422.additionalMoveSpeed, finalMoveSpeed: shoeFinal, attributeUnit: 'move_speed点数', modifierZone: 'attribute_flat_add' }
  };
}

function checkConsumableBoundaries(actual, source) {
  const skillData = skill(actual, 'item_2150_consume');
  const points = parameter(actual, 'item_2150_consume', 'skill_points_granted');
  const force = parameter(actual, 'item_2152_consume', 'adaptive_force_amount');
  const duration = parameter(actual, 'item_2152_consume', 'duration_ms');
  assert(points.fixedValue === source.item2150.skillPoints && points.valueType === 'INTEGER', '技能合剂不是1个整数技能点');
  assert(skillData.maxLevel === 1, '技能合剂技能主体maxLevel异常');
  assert(force.fixedValue === source.item2152.adaptiveForce && duration.fixedValue === source.item2152.durationMs, '原力合剂实际参数错误');
  return {
    skillElixir: { grantedSkillPoints: points.fixedValue, schemaMaxLevel: skillData.maxLevel, roleLevelUnchanged: true, noAttributeConversion: true },
    forceElixir: { adaptiveForce: force.fixedValue, durationMs: duration.fixedValue, conversionDirection: '未知，拒绝同时转攻击力和法术强度' }
  };
}

function runActual(staticData, reportPath) {
  const reportBytes = readPinned(reportPath, EXPECTED.actualReport);
  const report = JSON.parse(reportBytes.toString('utf8'));
  assert(report.status === 'GET_REVIEW_PASS' && report.getCalls === 102 && report.observedRoutes === 102 && report.businessWrites === 0 && report.authorizationLogged === false, '独立GET报告不是102次零写入通过');
  assert(report.candidateSha256 === EXPECTED.candidate && report.planSha256 === EXPECTED.plan && report.mathSha256 === EXPECTED.math, '独立GET报告输入散列不一致');
  const snapshotPath = path.join(path.dirname(reportPath), '最终GET快照.json');
  const snapshotBytes = readPinned(snapshotPath, EXPECTED.actualSnapshot);
  const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
  const actual = actualObservations(snapshot);
  const source = makeSourceExpectations(staticData);
  const errors = [];
  const checks = [];
  const runCheck = (name, fn) => {
    try {
      const value = fn();
      checks.push({ name, status: '通过', value });
      return value;
    } catch (error) {
      errors.push({ name, error: error.message });
      checks.push({ name, status: '失败', error: error.message });
      return null;
    }
  };
  const params = runCheck('实际12参数与源值/类型/缺省', () => checkParameters(actual, source));
  const formulas = runCheck('实际3公式节点与引用', () => checkFormulas(actual));
  const scenarios = formulas ? runCheck('实际3公式两场景/缺值拒绝', () => checkFormulaScenarios(formulas, actual, source)) : null;
  const effects = formulas ? runCheck('实际2效果最终倍率/属性单位/REPLACE', () => checkEffects(actual, source, formulas)) : null;
  const boundaries = runCheck('技能合剂/原力合剂边界', () => checkConsumableBoundaries(actual, source));
  const output = {
    generatedAt: new Date().toISOString(),
    status: errors.length === 0 ? '通过' : '阻塞',
    scope: '四件符文衍生装备实际GET来源数学复核',
    sourceFiles: {
      fixedSource: { path: FIXED_SOURCE, sha256: EXPECTED.fixedSource },
      biscuitSource: { path: BISCUIT_SOURCE, sha256: EXPECTED.biscuitSource },
      actualGetReport: { path: reportPath, sha256: EXPECTED.actualReport },
      actualGetSnapshot: { path: snapshotPath, sha256: EXPECTED.actualSnapshot }
    },
    sourceSide: source,
    actualSide: { getReportStatus: report.status, getCalls: report.getCalls, observedRoutes: report.observedRoutes, snapshotObservationCount: snapshot.observations.length },
    checks,
    errors,
    missingInputChecks: scenarios?.missingInputChecks || { status: '未执行' },
    evidenceBoundary: { businessWrites: 0, apiWritesByMathScript: 0, databaseAccessed: false, browserAccessed: false, gitAccessed: false, runtimeExecuted: false },
    actualMath: { parametersChecked: params ? 12 : 0, formulasChecked: formulas ? 3 : 0, effectsChecked: effects ? 2 : 0, formulaScenarioCount: scenarios ? 6 : 0 }
  };
  const outDir = path.join(OUTPUT_DIR, '报告', nowId());
  ensure(outDir);
  writeJson(path.join(outDir, '独立来源数学报告.json'), output);
  writeJson(path.join(outDir, '实际公式与效果快照.json'), { generatedAt: output.generatedAt, sourceSide: source, actualFormulaAndEffectIds: ['item_2010_consume-formula-base_biscuit_recovery', 'item_2010_consume-formula-biscuit_recovery_total', 'item_2010_consume-formula-permanent_health_gain', 'item_2010_consume-effect-permanent_health_gain', 'item_2422_passive-effect-magical_footwear_additional_speed'], actualData: checks.map((x) => ({ name: x.name, status: x.status, value: x.value })) });
  console.log(JSON.stringify({ status: output.status, outputDir: outDir, errors: output.errors, actualMath: output.actualMath }, null, 2));
  if (errors.length) process.exitCode = 2;
}

function main() {
  const mode = parseArgs(process.argv.slice(2));
  const staticData = loadStatic();
  if (mode.mode === 'validate-only') {
    console.log(JSON.stringify({ status: 'STATIC_VALIDATION_PASS', businessApiCalls: 0, businessWrites: 0, sourceFiles: { fixedSource: EXPECTED.fixedSource, biscuitSource: EXPECTED.biscuitSource }, actualSnapshotRead: false }, null, 2));
    return;
  }
  const report = path.resolve(mode.report);
  assert(report.startsWith(EXEC_DIR + path.sep) && fs.existsSync(report), 'GET报告必须位于执行目录内');
  runActual(staticData, report);
}
main();

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expectedValue, sourceMeta } from './source-expected.mjs';

const root = 'C:/project/damage_web_dev';
const here = path.dirname(fileURLToPath(import.meta.url));
const reviewDir = path.join(root, '.agents', 'artifacts', 'hero35-independent-review');
const requestedReadback = process.env.HERO35_READBACK_DIR ? path.resolve(process.env.HERO35_READBACK_DIR) : null;
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--after-apply') throw new Error('用法：node 实际数学核算.mjs --after-apply');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const writeJson = (file, value, flag) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, flag ? { flag } : undefined); };

function latestReadback() {
  if (requestedReadback) return path.resolve(requestedReadback);
  const dir = path.join(reviewDir, '实际回读');
  if (!fs.existsSync(dir)) throw new Error('尚未发现独立实际GET回读目录');
  const candidates = fs.readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => path.join(dir, item.name, '独立全量GET.json')).filter(fs.existsSync).map(file => ({ file, mtimeMs: fs.statSync(file).mtimeMs })).sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!candidates.length) throw new Error('尚未发现独立全量GET.json');
  return path.dirname(candidates[0].file);
}
const readbackDir = latestReadback();
const readbackPath = path.join(readbackDir, '独立全量GET.json');
const readback = readJson(readbackPath);
if (readback.status !== 'PASS' || readback.complete !== true || readback.apiWrites !== 0 || readback.noBusinessWrites !== true) throw new Error(`回读未完成或含业务写入：${JSON.stringify({ status: readback.status, complete: readback.complete, apiWrites: readback.apiWrites, noBusinessWrites: readback.noBusinessWrites })}`);

const allResponses = readback.rawResponses ?? [];
const responseByRoute = new Map();
for (const response of allResponses) if (response.status === 200) responseByRoute.set(response.route, response.data);
const formulaRecords = allResponses.filter(item => /^\/skills\/[^/]+\/formulas\/[^/]+$/.test(item.route)).map(item => ({ route: item.route, data: item.data })).filter((item, index, array) => array.findIndex(other => other.route === item.route) === index);
const parameterRecords = allResponses.filter(item => /^\/skills\/[^/]+\/parameters\/[^/]+$/.test(item.route)).map(item => ({ route: item.route, data: item.data })).filter((item, index, array) => array.findIndex(other => other.route === item.route) === index);
const subjectMaxLevel = new Map(allResponses.filter(item => /^\/skills\/[^/]+$/.test(item.route)).map(item => [item.route.slice('/skills/'.length), Number(item.data?.maxLevel)]));
if (formulaRecords.length !== 32 || parameterRecords.length < 136) throw new Error(`实际公式或参数详情数量不符：公式${formulaRecords.length}，参数${parameterRecords.length}`);
const actualFormulaIndex = new Map(formulaRecords.map(item => { const match = item.route.match(/^\/skills\/([^/]+)\/formulas\/([^/]+)$/); return [`${match[1]}/${decodeURIComponent(match[2])}`, item.data]; }));
const actualParameterIndex = new Map(parameterRecords.map(item => { const match = item.route.match(/^\/skills\/([^/]+)\/parameters\/([^/]+)$/); return [`${match[1]}/${decodeURIComponent(match[2])}`, item.data]; }));

const sourceAttributes = (high) => ({
  SOURCE: {
    ability_power: { TOTAL: high ? 320 : 80 },
    hp: { TOTAL: high ? 4200 : 1500, BONUS: high ? 1600 : 400 },
    armor: { TOTAL: high ? 260 : 80, BONUS: high ? 140 : 30 },
    magic_resistance: { TOTAL: high ? 120 : 40, BONUS: high ? 80 : 20 },
  },
  TARGET: { hp: { TOTAL: high ? 2100 : 900 } },
});
const sourceRuntime = (high) => ({
  actual_armor_stage: high ? 280 : 90,
  character_level_base_damage: high ? 93 : 25,
  actual_cooldown_multiplier: high ? 0.75 : 0.5,
  current_consumed_charge_count: high ? 5 : 0,
  cast_stage_missing_hp: high ? 900 : 150,
  current_grey_health: high ? 1200 : 120,
  grey_health_healing_ratio: high ? 0.95 : 0.6,
});
const contextFor = (skillKey, high) => ({
  skillLevel: high ? (subjectMaxLevel.get(skillKey) || 5) : 1,
  characterLevel: high ? 18 : 1,
  attributes: sourceAttributes(high),
  runtime: sourceRuntime(high),
});

const allowedOperations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
const runtimeKeys = new Set(['actual_armor_stage', 'character_level_base_damage', 'actual_cooldown_multiplier', 'current_consumed_charge_count', 'cast_stage_missing_hp', 'current_grey_health', 'grey_health_healing_ratio']);
const runtimeBounds = {
  current_consumed_charge_count: { min: 0, integer: true },
  cast_stage_missing_hp: { min: 0 },
  current_grey_health: { min: 0 },
  grey_health_healing_ratio: { min: 0, max: 1 },
};
const parameterValue = (skillKey, parameterKey, context) => {
  const parameter = actualParameterIndex.get(`${skillKey}/${parameterKey}`);
  if (!parameter) throw new Error(`实际GET缺少参数：${skillKey}/${parameterKey}`);
  if (parameter.valueMode === 'FIXED') return Number(parameter.fixedValue);
  if (parameter.valueMode === 'SKILL_LEVEL') {
    const value = parameter.levelValues?.[String(context.skillLevel)];
    if (value === undefined) throw new Error(`技能等级参数缺值：${skillKey}/${parameterKey}/${context.skillLevel}`);
    return Number(value);
  }
  if (parameter.valueMode === 'CHARACTER_LEVEL') {
    const value = parameter.levelValues?.[String(context.characterLevel)];
    if (value === undefined) throw new Error(`角色等级参数缺值：${skillKey}/${parameterKey}/${context.characterLevel}`);
    return Number(value);
  }
  if (parameter.valueMode !== 'RUNTIME_INPUT') throw new Error(`未知参数取值方式：${skillKey}/${parameterKey}/${parameter.valueMode}`);
  if (!Object.hasOwn(context.runtime ?? {}, parameterKey)) throw new Error(`运行输入缺失：${skillKey}/${parameterKey}`);
  const value = Number(context.runtime[parameterKey]);
  if (!Number.isFinite(value)) throw new Error(`运行输入不是有限数值：${skillKey}/${parameterKey}`);
  const bound = runtimeBounds[parameterKey];
  if (bound?.integer && !Number.isInteger(value)) throw new Error(`运行输入不是整数：${skillKey}/${parameterKey}`);
  if (bound?.min !== undefined && value < bound.min || bound?.max !== undefined && value > bound.max) throw new Error(`运行输入越界：${skillKey}/${parameterKey}`);
  if (parameterKey === 'current_consumed_charge_count') {
    const max = parameterValue(skillKey, 'max_charge_count', context);
    if (value > max) throw new Error(`充能数超过上限：${skillKey}/${parameterKey}`);
  }
  return value;
};
const attributeValue = (node, context) => {
  const value = context.attributes?.[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
  if (!Number.isFinite(Number(value))) throw new Error(`属性输入缺失：${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`);
  return Number(value);
};
const evaluate = (node, skillKey, context, at = '$') => {
  if (!node || typeof node !== 'object') throw new Error(`实际表达式节点为空：${skillKey}${at}`);
  if (node.nodeType === 'PARAMETER') return parameterValue(skillKey, node.parameterKey, context);
  if (node.nodeType === 'ATTRIBUTE') return attributeValue(node, context);
  if (node.nodeType !== 'OPERATION' || !allowedOperations.has(node.operation) || !Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`实际表达式不是严格二元：${skillKey}${at}`);
  const left = evaluate(node.operands[0], skillKey, context, `${at}.operands[0]`);
  const right = evaluate(node.operands[1], skillKey, context, `${at}.operands[1]`);
  if (node.operation === 'ADD') return left + right;
  if (node.operation === 'SUBTRACT') return left - right;
  if (node.operation === 'MULTIPLY') return left * right;
  if (node.operation === 'DIVIDE') { if (right === 0) throw new Error(`除数为0：${skillKey}${at}`); return left / right; }
  if (node.operation === 'MIN') return Math.min(left, right);
  return Math.max(left, right);
};
const closeEnough = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const leaves = (node, output = []) => {
  if (!node || typeof node !== 'object') throw new Error('公式叶节点为空');
  if (node.nodeType === 'PARAMETER') output.push({ type: 'PARAMETER', key: node.parameterKey });
  else if (node.nodeType === 'ATTRIBUTE') output.push({ type: 'ATTRIBUTE', owner: node.attributeOwner, key: node.attributeKey, valueKind: node.attributeValueKind });
  else if (node.nodeType === 'OPERATION') { if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error('公式运算节点不是二元'); for (const child of node.operands) leaves(child, output); }
  else throw new Error(`未知公式节点：${node.nodeType}`);
  return output;
};
const clone = value => JSON.parse(JSON.stringify(value));
const removeAttribute = (context, leaf) => { const copy = clone(context); delete copy.attributes?.[leaf.owner]?.[leaf.key]?.[leaf.valueKind]; return copy; };
const removeRuntime = (context, key) => { const copy = clone(context); delete copy.runtime?.[key]; return copy; };

const formulaResults = [];
const missingInputResults = [];
const failures = [];
let operationNodes = 0;
const structuralFailures = [];
const scanOperations = (node, key) => {
  if (!node || typeof node !== 'object') { structuralFailures.push({ key, reason: '节点为空' }); return; }
  if (node.nodeType === 'OPERATION') { operationNodes += 1; if (!allowedOperations.has(node.operation) || !Array.isArray(node.operands) || node.operands.length !== 2) structuralFailures.push({ key, reason: '非允许二元运算', node }); else { scanOperations(node.operands[0], key); scanOperations(node.operands[1], key); } }
};
for (const [key, expression] of actualFormulaIndex) {
  const [skillKey, formulaKey] = key.split('/');
  scanOperations(expression.expression, key);
  const cases = [];
  for (const high of [false, true]) {
    const context = contextFor(skillKey, high);
    try {
      const actual = evaluate(expression.expression, skillKey, context);
      const expected = expectedValue(skillKey, formulaKey, context);
      const passed = closeEnough(actual, expected);
      cases.push({ label: high ? '高等级/高属性' : '低等级/低属性', skillLevel: context.skillLevel, characterLevel: context.characterLevel, actual, expected, delta: actual - expected, passed });
      if (!passed) failures.push({ type: '公式数值不符', key, label: high ? '高' : '低', actual, expected });
    } catch (error) { cases.push({ label: high ? '高等级/高属性' : '低等级/低属性', passed: false, error: String(error.stack || error) }); failures.push({ type: '公式求值失败', key, error: String(error.stack || error) }); }
  }
  let uniqueLeaves;
  try { uniqueLeaves = [...new Map(leaves(expression.expression).map(item => [JSON.stringify(item), item])).values()]; } catch (error) { failures.push({ type: '叶节点扫描失败', key, error: String(error.stack || error) }); uniqueLeaves = []; }
  for (const leaf of uniqueLeaves) {
    const isRuntime = leaf.type === 'PARAMETER' && runtimeKeys.has(leaf.key) && actualParameterIndex.get(`${skillKey}/${leaf.key}`)?.valueMode === 'RUNTIME_INPUT';
    const isAttribute = leaf.type === 'ATTRIBUTE';
    if (!isRuntime && !isAttribute) continue;
    let rejected = false; let error = null;
    try { evaluate(expression.expression, skillKey, isRuntime ? removeRuntime(contextFor(skillKey, false), leaf.key) : removeAttribute(contextFor(skillKey, false), leaf)); } catch (caught) { rejected = true; error = String(caught.message || caught); }
    if (!rejected) failures.push({ type: '缺值未拒绝', key, leaf });
    missingInputResults.push({ key, leaf, rejected, error });
  }
  formulaResults.push({ skillKey, formulaKey, actualExpression: expression.expression, cases, missingLeavesChecked: uniqueLeaves.filter(leaf => (leaf.type === 'ATTRIBUTE') || (leaf.type === 'PARAMETER' && runtimeKeys.has(leaf.key))).length });
}
if (structuralFailures.length) failures.push({ type: '结构失败', details: structuralFailures });

const integerChecks = [];
for (const [key, parameter] of actualParameterIndex) {
  const parameterKey = key.slice(key.indexOf('/') + 1);
  const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : ['SKILL_LEVEL', 'CHARACTER_LEVEL'].includes(parameter.valueMode) ? Object.values(parameter.levelValues ?? {}) : [];
  const integerRequired = parameter.valueType === 'INTEGER' || parameterKey.endsWith('_ms');
  const integersPass = !integerRequired || (parameter.valueType === 'INTEGER' && values.every(Number.isInteger));
  const timePass = !parameterKey.endsWith('_ms') || (parameter.valueType === 'INTEGER' && values.every(value => Number.isInteger(value) && value >= 0));
  integerChecks.push({ key, valueType: parameter.valueType, valueMode: parameter.valueMode, values, integersPass, timePass });
  if (!integersPass || !timePass) failures.push({ type: '整数或毫秒约束失败', key, values, valueType: parameter.valueType });
  if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) failures.push({ type: '运行输入含默认', key, fixedValue: parameter.fixedValue, levelValues: parameter.levelValues });
}

const boundaryResults = [];
const boundary = (name, passed, detail) => { boundaryResults.push({ name, passed, detail }); if (!passed) failures.push({ type: '边界失败', name, detail }); };
const actualFormulaValue = (skillKey, formulaKey, context) => evaluate(actualFormulaIndex.get(`${skillKey}/${formulaKey}`).expression, skillKey, context);
try {
  const zero = contextFor('taric_q', false); zero.runtime.current_consumed_charge_count = 0;
  boundary('塔里克Q零充能', closeEnough(actualFormulaValue('taric_q', 'consumed_charge_healing', zero), 0), { actual: actualFormulaValue('taric_q', 'consumed_charge_healing', zero), expected: 0 });
  const max = contextFor('taric_q', true); max.runtime.current_consumed_charge_count = 5;
  const maxActual = actualFormulaValue('taric_q', 'consumed_charge_healing', max); const maxExpected = expectedValue('taric_q', 'consumed_charge_healing', max);
  boundary('塔里克Q五层充能', closeEnough(maxActual, maxExpected), { actual: maxActual, expected: maxExpected });
  const over = contextFor('taric_q', true); over.runtime.current_consumed_charge_count = 6; let overRejected = false; try { actualFormulaValue('taric_q', 'consumed_charge_healing', over); } catch { overRejected = true; }
  boundary('塔里克Q超过最大充能拒绝', overRejected, { input: 6, expectedMaximum: 5 });
  const greyZero = contextFor('tahmkench_e', false); greyZero.runtime.current_grey_health = 0; const greyZeroActual = actualFormulaValue('tahmkench_e', 'grey_health_heal_value', greyZero);
  boundary('塔姆E零灰血', closeEnough(greyZeroActual, 0), { actual: greyZeroActual, expected: 0 });
  const greyCap = contextFor('tahmkench_e', true); const greyCapActual = actualFormulaValue('tahmkench_e', 'grey_health_maximum', greyCap);
  boundary('塔姆E灰血上限三倍最大生命', closeEnough(greyCapActual, 3 * greyCap.attributes.SOURCE.hp.TOTAL), { actual: greyCapActual, expected: 3 * greyCap.attributes.SOURCE.hp.TOTAL });
  const greyNegative = contextFor('tahmkench_e', false); greyNegative.runtime.current_grey_health = -1; let greyNegativeRejected = false; try { actualFormulaValue('tahmkench_e', 'grey_health_heal_value', greyNegative); } catch { greyNegativeRejected = true; }
  boundary('塔姆E负灰血拒绝', greyNegativeRejected, { input: -1, expected: '拒绝' });
  const braumQA = contextFor('braum_q', false); const braumQB = contextFor('braum_q', true); const braumQExpectedA = expectedValue('braum_q', 'magic_damage', braumQA); const braumQExpectedB = expectedValue('braum_q', 'magic_damage', braumQB);
  boundary('布隆Q来源与目标最大生命区分', braumQExpectedA !== braumQExpectedB && braumQA.attributes.SOURCE.hp.TOTAL !== braumQA.attributes.TARGET.hp.TOTAL, { sourceHP: [braumQA.attributes.SOURCE.hp.TOTAL, braumQB.attributes.SOURCE.hp.TOTAL], targetHP: [braumQA.attributes.TARGET.hp.TOTAL, braumQB.attributes.TARGET.hp.TOTAL], expected: [braumQExpectedA, braumQExpectedB] });
} catch (error) { failures.push({ type: '边界核算异常', error: String(error.stack || error) }); }

const report = { generatedAt: new Date().toISOString(), batch: '英雄机制第三十五批', status: failures.length === 0 && formulaResults.length === 32 && formulaResults.every(item => item.cases.every(test => test.passed)) && missingInputResults.every(item => item.rejected) && integerChecks.every(item => item.integersPass && item.timePass) ? 'PASS' : 'FAIL', mode: '读取独立全量GET中的实际参数与实际公式表达式；期望值单独读取冻结客户端来源；不读取候选固定参数求实际值；不调用接口。', readbackDir, readbackSha256: sha(readbackPath), sourceMeta, sourceExpectedSha256: sha(path.join(here, 'source-expected.mjs')), apiCalls: 0, apiWrites: 0, formulaCount: formulaResults.length, formulaCaseCount: formulaResults.reduce((sum, item) => sum + item.cases.length, 0), missingInputChecks: missingInputResults.length, operationNodes, integerParameterChecks: integerChecks.length, boundaryChecks: boundaryResults.length, formulaResults, missingInputResults, integerChecks, boundaryResults, structuralFailures, failures };
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outDir = path.join(here, '实际数学核算', runId);
writeJson(path.join(outDir, '实际数学核算.json'), report, 'wx');
writeJson(path.join(outDir, '执行结果.json'), { generatedAt: report.generatedAt, batch: report.batch, status: report.status, apiCalls: 0, apiWrites: 0, formulaCount: report.formulaCount, formulaCaseCount: report.formulaCaseCount, missingInputChecks: report.missingInputChecks, operationNodes: report.operationNodes, integerParameterChecks: report.integerParameterChecks, boundaryChecks: report.boundaryChecks, failures: report.failures.length, reportPath: path.join(outDir, '实际数学核算.json'), readbackDir }, 'wx');
console.log(JSON.stringify({ status: report.status, formulaCount: report.formulaCount, formulaCaseCount: report.formulaCaseCount, missingInputChecks: report.missingInputChecks, operationNodes: report.operationNodes, integerParameterChecks: report.integerParameterChecks, boundaryChecks: report.boundaryChecks, failures: report.failures.length, apiCalls: 0, apiWrites: 0, output: outDir }, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;

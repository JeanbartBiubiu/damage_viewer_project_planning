import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expected, sourceBindingSha256 } from './source-expected.mjs';

const root = 'C:/project/damage_web_dev';
const reviewDir = path.join(root, '.agents', 'artifacts', 'hero36-independent-review');
const mathDir = path.dirname(fileURLToPath(import.meta.url));
const candidateDir = path.join(root, '.agents', 'artifacts', 'hero36-luna-candidate', '修订一');
const candidatePath = path.join(candidateDir, '完整候选.json');
const planPath = path.join(candidateDir, '写前请求计划.json');
const expectedCandidateSha256 = '9d278c07710b96dc7d29a91df2160ea34954daccb8cf576a0e72492295cf0313';
const expectedPlanSha256 = '2241e69a53f9538a4135515251f063aa5df4a03120e33163f56648d5471ec91b';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); };
const clone = value => JSON.parse(JSON.stringify(value));
const close = (a, b, tolerance = 2e-7) => Number.isFinite(Number(a)) && Number.isFinite(Number(b))
  && Math.abs(Number(a) - Number(b)) <= tolerance * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--after-apply') throw new Error('用法：node 实际数学核算.mjs --after-apply');
const candidateSha256 = sha(candidatePath);
const planSha256 = sha(planPath);
if (candidateSha256 !== expectedCandidateSha256) throw new Error(`候选散列不符：${candidateSha256}`);
if (planSha256 !== expectedPlanSha256) throw new Error(`计划散列不符：${planSha256}`);

const findLatestGetReport = () => {
  const explicit = process.env.HERO36_GET_REPORT;
  if (explicit) return path.resolve(explicit);
  const base = path.join(reviewDir, '实际回读');
  const found = [];
  if (!fs.existsSync(base)) return null;
  const stack = [base];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const item = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(item);
      else if (entry.name === '独立全量GET.json') found.push({ path: item, mtimeMs: fs.statSync(item).mtimeMs });
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path ?? null;
};
const getReportPath = findLatestGetReport();
if (!getReportPath || !fs.existsSync(getReportPath)) throw new Error('缺少独立全量GET报告；先完成写后独立回读');
const getReport = readJson(getReportPath);
if (getReport.status !== 'PASS' || getReport.complete !== true) throw new Error(`独立全量GET未通过：${getReportPath}`);
if (getReport.candidateSha256 !== candidateSha256 || getReport.planSha256 !== planSha256) throw new Error('GET报告散列与当前修订不符');
if (!Array.isArray(getReport.rawResponses)) throw new Error('GET报告缺少完整原始响应');

const rawResponses = getReport.rawResponses;
const detailByRoute = new Map();
const subjectByKey = new Map();
for (const record of rawResponses) {
  if (record.status !== 200 || !record.data) continue;
  const subject = record.route.match(/^\/skills\/([^/]+)$/);
  if (subject) subjectByKey.set(subject[1], record.data);
  const detail = record.route.match(/^\/skills\/([^/]+)\/(parameters|formulas)\/([^/]+)$/);
  if (detail) detailByRoute.set(record.route, record.data);
}
const parameterRows = [];
const formulaRows = [];
for (const [route, data] of detailByRoute) {
  const match = route.match(/^\/skills\/([^/]+)\/(parameters|formulas)\/([^/]+)$/);
  const skillKey = match[1];
  const kind = match[2];
  if (kind === 'parameters') parameterRows.push({ route, skillKey, parameterKey: decodeURIComponent(match[3]), data });
  else formulaRows.push({ route, skillKey, formulaKey: decodeURIComponent(match[3]), data });
}
parameterRows.sort((a, b) => a.route.localeCompare(b.route));
formulaRows.sort((a, b) => a.route.localeCompare(b.route));
if (parameterRows.length !== 159) throw new Error(`实际参数详情应为159项，实际${parameterRows.length}`);
if (formulaRows.length !== 31) throw new Error(`实际公式详情应为31项，实际${formulaRows.length}`);
const parameterByKey = new Map(parameterRows.map(row => [`${row.skillKey}|${row.parameterKey}`, row.data]));
const formulaByKey = new Map(formulaRows.map(row => [`${row.skillKey}|${row.formulaKey}`, row.data]));

const formulaFailures = [];
const missingFailures = [];
const integerFailures = [];
const boundaryFailures = [];
const evaluate = (node, context, skillKey, formulaKey) => {
  if (!node || typeof node !== 'object') throw new Error(`公式节点为空：${skillKey}/${formulaKey}`);
  if (node.nodeType === 'PARAMETER') {
    const key = node.parameterKey;
    const parameter = parameterByKey.get(`${skillKey}|${key}`);
    if (!parameter) throw new Error(`实际GET参数详情缺失：${skillKey}/${key}`);
    if (parameter.valueMode === 'RUNTIME_INPUT') {
      if (!own(context.runtime, key) || context.runtime[key] === undefined || context.runtime[key] === null) throw new Error(`缺少运行输入：${skillKey}/${key}`);
      return context.runtime[key];
    }
    if (parameter.valueMode === 'FIXED') {
      if (parameter.fixedValue === undefined || parameter.fixedValue === null) throw new Error(`实际固定参数缺值：${skillKey}/${key}`);
      return parameter.fixedValue;
    }
    if (parameter.valueMode === 'SKILL_LEVEL') {
      const value = parameter.levelValues?.[String(context.skillLevel)];
      if (value === undefined || value === null) throw new Error(`实际技能等级参数缺值：${skillKey}/${key}/${context.skillLevel}`);
      return value;
    }
    if (parameter.valueMode === 'CHARACTER_LEVEL') {
      const value = parameter.levelValues?.[String(context.characterLevel)];
      if (value === undefined || value === null) throw new Error(`实际角色等级参数缺值：${skillKey}/${key}/${context.characterLevel}`);
      return value;
    }
    throw new Error(`实际参数模式不支持：${skillKey}/${key}/${parameter.valueMode}`);
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const value = context.attributes?.[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
    if (value === undefined || value === null) throw new Error(`缺少属性输入：${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`);
    return value;
  }
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`公式不是严格二元：${skillKey}/${formulaKey}`);
  const left = evaluate(node.operands[0], context, skillKey, formulaKey);
  const right = evaluate(node.operands[1], context, skillKey, formulaKey);
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error(`公式运算不支持：${node.operation}`);
  }
};
const collectLeaves = (node, leaves = []) => {
  if (!node || typeof node !== 'object') return leaves;
  if (node.nodeType === 'PARAMETER') leaves.push({ type: 'PARAMETER', parameterKey: node.parameterKey });
  else if (node.nodeType === 'ATTRIBUTE') leaves.push({ type: 'ATTRIBUTE', attributeOwner: node.attributeOwner, attributeKey: node.attributeKey, attributeValueKind: node.attributeValueKind });
  else if (Array.isArray(node.operands)) node.operands.forEach(child => collectLeaves(child, leaves));
  return leaves;
};
const uniqueLeaves = node => [...new Map(collectLeaves(node).map(item => [JSON.stringify(item), item])).values()];
const scenarios = [
  { label: '低等级输入', requestedSkillLevel: 1, characterLevel: 6, attributes: { SOURCE: { ability_power: { TOTAL: 80 } }, TARGET: { hp: { TOTAL: 1000, CURRENT: 450 } } }, runtime: { actual_healing_threshold_base: 270, actual_champion_heal_base: 1.5, actual_target_missing_health: 320, actual_hero_pre_mitigation_damage: 280 } },
  { label: '高等级输入', requestedSkillLevel: 5, characterLevel: 13, attributes: { SOURCE: { ability_power: { TOTAL: 320 } }, TARGET: { hp: { TOTAL: 2400, CURRENT: 2100 } } }, runtime: { actual_healing_threshold_base: 390, actual_champion_heal_base: 13, actual_target_missing_health: 1750, actual_hero_pre_mitigation_damage: 1450 } },
];
const maxLevelOf = skillKey => {
  const value = subjectByKey.get(skillKey)?.maxLevel;
  if (!Number.isInteger(value) || value < 1) throw new Error(`实际主体缺少有效最高等级：${skillKey}`);
  return value;
};
const formulaResults = [];
let missingInputChecks = 0;
for (const row of formulaRows) {
  const maxLevel = maxLevelOf(row.skillKey);
  const scenariosResult = [];
  for (const scenario of scenarios) {
    const skillLevel = Math.min(scenario.requestedSkillLevel, maxLevel);
    const context = { skillLevel, characterLevel: scenario.characterLevel, attributes: clone(scenario.attributes), runtime: clone(scenario.runtime) };
    try {
      const actual = evaluate(row.data.expression, context, row.skillKey, row.formulaKey);
      const expectedValue = expected(row.skillKey, row.formulaKey, { level: skillLevel, attributes: clone(scenario.attributes), runtime: clone(scenario.runtime) });
      const passed = Number.isFinite(actual) && close(actual, expectedValue);
      if (!passed) formulaFailures.push({ skillKey: row.skillKey, formulaKey: row.formulaKey, scenario: scenario.label, actual, expected: expectedValue, reason: '实录表达式与冻结原始来源期望不符' });
      scenariosResult.push({ label: scenario.label, requestedSkillLevel: scenario.requestedSkillLevel, skillLevel, actual, expected: expectedValue, delta: actual - expectedValue, passed });
    } catch (error) {
      formulaFailures.push({ skillKey: row.skillKey, formulaKey: row.formulaKey, scenario: scenario.label, reason: String(error.stack || error) });
      scenariosResult.push({ label: scenario.label, requestedSkillLevel: scenario.requestedSkillLevel, skillLevel, passed: false, error: String(error.stack || error) });
    }
  }
  const leaves = uniqueLeaves(row.data.expression);
  for (const leaf of leaves) {
    const shouldReject = leaf.type === 'ATTRIBUTE' || (leaf.type === 'PARAMETER' && parameterByKey.get(`${row.skillKey}|${leaf.parameterKey}`)?.valueMode === 'RUNTIME_INPUT');
    if (!shouldReject) continue;
    const context = { skillLevel: Math.min(scenarios[0].requestedSkillLevel, maxLevel), characterLevel: scenarios[0].characterLevel, attributes: clone(scenarios[0].attributes), runtime: clone(scenarios[0].runtime) };
    if (leaf.type === 'ATTRIBUTE') delete context.attributes?.[leaf.attributeOwner]?.[leaf.attributeKey]?.[leaf.attributeValueKind];
    else delete context.runtime[leaf.parameterKey];
    let rejected = false;
    try { evaluate(row.data.expression, context, row.skillKey, row.formulaKey); } catch { rejected = true; }
    missingInputChecks += 1;
    if (!rejected) missingFailures.push({ skillKey: row.skillKey, formulaKey: row.formulaKey, leaf, reason: '删除实际输入后仍未拒绝' });
  }
  formulaResults.push({ skillKey: row.skillKey, formulaKey: row.formulaKey, scenarios: scenariosResult, missingLeavesChecked: leaves.filter(leaf => leaf.type === 'ATTRIBUTE' || (leaf.type === 'PARAMETER' && parameterByKey.get(`${row.skillKey}|${leaf.parameterKey}`)?.valueMode === 'RUNTIME_INPUT')).length });
}

let parameterConstraintsChecked = 0;
let runtimeParametersChecked = 0;
let integerParametersChecked = 0;
let millisecondsParametersChecked = 0;
for (const row of parameterRows) {
  const p = row.data;
  parameterConstraintsChecked += 1;
  if (p.valueMode === 'RUNTIME_INPUT') {
    runtimeParametersChecked += 1;
    if (p.fixedValue !== null || p.levelValues !== null) integerFailures.push({ skillKey: row.skillKey, parameterKey: row.parameterKey, reason: '运行输入存在默认值' });
  }
  const values = p.valueMode === 'FIXED' ? [p.fixedValue] : Object.values(p.levelValues ?? {});
  const requiresInteger = p.valueType === 'INTEGER';
  const requiresMilliseconds = row.parameterKey.endsWith('_ms');
  if (requiresInteger) integerParametersChecked += 1;
  if (requiresMilliseconds) millisecondsParametersChecked += 1;
  if ((requiresInteger || requiresMilliseconds) && values.some(value => !Number.isInteger(value) || value < 0)) {
    integerFailures.push({ skillKey: row.skillKey, parameterKey: row.parameterKey, values, reason: requiresMilliseconds ? '毫秒或整数参数含非整数/负值' : '整数参数含非整数/负值' });
  }
}
const readParameter = (skillKey, parameterKey) => parameterByKey.get(`${skillKey}|${parameterKey}`);
const boundaryValues = [
  ['伊芙琳Q标记最多命中', 'evelynn_q', 'marked_bonus_max_hits', 3],
  ['伊芙琳W魅惑蓄力毫秒', 'evelynn_w', 'charm_charge_time_ms', 2500],
  ['辛吉德Q每秒法力', 'singed_q', 'mana_per_second', 13],
  ['费德提克R持续秒数', 'fiddlesticks_r', 'full_duration_seconds', 5],
  ['莉莉娅Q舞步层数上限', 'lillia_q', 'prance_max_stacks', 4],
];
for (const [name, skillKey, parameterKey, expectedValue] of boundaryValues) {
  const actual = readParameter(skillKey, parameterKey)?.fixedValue;
  const passed = actual === expectedValue;
  if (!passed) boundaryFailures.push({ name, skillKey, parameterKey, expected: expectedValue, actual });
}

const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outDir = path.join(mathDir, '实际数学核算', runId);
fs.mkdirSync(outDir, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  batch: '英雄机制第三十六批',
  revision: '修订一',
  status: formulaFailures.length === 0 && missingFailures.length === 0 && integerFailures.length === 0 && boundaryFailures.length === 0 ? 'PASS' : 'REVISE',
  complete: formulaFailures.length === 0 && missingFailures.length === 0 && integerFailures.length === 0 && boundaryFailures.length === 0,
  mode: '实际GET表达式独立数学核算',
  apiBase: getReport.apiBase,
  apiCalls: 0,
  apiWrites: 0,
  noBusinessWrites: true,
  candidateSha256,
  planSha256,
  sourceBindingSha256,
  getReportPath,
  getReportSha256: sha(getReportPath),
  formulas: { total: formulaRows.length, scenariosPerFormula: 2, scenarioCases: formulaResults.reduce((sum, row) => sum + row.scenarios.length, 0), passed: formulaResults.filter(row => row.scenarios.every(item => item.passed)).length, results: formulaResults },
  missingInputChecks: { total: missingInputChecks, passed: missingInputChecks - missingFailures.length, failures: missingFailures },
  parameterConstraints: { total: parameterConstraintsChecked, passed: parameterConstraintsChecked - integerFailures.length, runtimeParameters: runtimeParametersChecked, integerParameters: integerParametersChecked, millisecondsParameters: millisecondsParametersChecked, failures: integerFailures },
  boundaryChecks: { total: boundaryValues.length, passed: boundaryValues.length - boundaryFailures.length, values: boundaryValues.map(([name, skillKey, parameterKey, expectedValue]) => ({ name, skillKey, parameterKey, expected: expectedValue, actual: readParameter(skillKey, parameterKey)?.fixedValue, passed: !boundaryFailures.some(item => item.skillKey === skillKey && item.parameterKey === parameterKey) })), failures: boundaryFailures },
  failures: { formula: formulaFailures, missingInput: missingFailures, parameter: integerFailures, boundary: boundaryFailures },
  note: '实际值来自独立全量GET中的公式和参数详情，期望值只读取冻结来源绑定的客户端DataValues与mSpellCalculations；缺值检查是真实调用求值器后的拒绝结果。本文件是验收核算器，不是战斗运行时。',
};
writeJson(path.join(outDir, '实际公式数学.json'), report);
writeJson(path.join(outDir, '执行结果.json'), { generatedAt: report.generatedAt, status: report.status, complete: report.complete, apiCalls: 0, apiWrites: 0, formulas: report.formulas, missingInputChecks: report.missingInputChecks, parameterConstraints: report.parameterConstraints, boundaryChecks: report.boundaryChecks, candidateSha256, planSha256, sourceBindingSha256, getReportPath });
console.log(JSON.stringify({ status: report.status, complete: report.complete, formulas: report.formulas.total, scenarioCases: report.formulas.scenarioCases, formulaPassed: report.formulas.passed, missingInputChecks: report.missingInputChecks, parameterConstraints: report.parameterConstraints, boundaryChecks: report.boundaryChecks, apiCalls: 0, apiWrites: 0, output: outDir }, null, 2));
if (!report.complete) process.exitCode = 1;


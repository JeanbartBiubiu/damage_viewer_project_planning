import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactRoot = path.resolve(here, '..');
const candidateDir = path.join(artifactRoot, 'hero33-luna-candidate', '修订二');
const inputDir = path.join(artifactRoot, 'hero33-root-entry-20260910');
const candidatePath = path.join(candidateDir, '完整候选.json');
const planPath = path.join(candidateDir, '写前请求计划.json');
const inputVersionPath = path.join(inputDir, '输入版本.json');
const sourceBindingPath = path.join(inputDir, '来源绑定与当前文本.json');
const freezePath = path.join(artifactRoot, 'hero33-luna-candidate', '文件字节冻结.json');
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const frozen = Object.freeze({
  candidateFile: '841a100c48f51a135dbb6d4457ec5523af2030611cbbac1f2212b388be5a8b4e',
  planFile: '0deb6cea79b44b7f9db2a73a0fedc4d91802f650abcc4703fac3070513acbf52',
  historicalCandidateContent: '9d09798406df9fc6e50152211a2611c8fd5d2bead66dabed373d0c6600339a23',
  sourceBinding: '4f75c9bd57e9c0d7d71536c0b79ef7640796655e9b10cbfbecfd7f4f8b269767',
});

if (process.argv.length !== 3 || process.argv[2] !== '--after-apply') throw new Error('用法：node 实际GET数学.mjs --after-apply');
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function writeJson(file, value, flag) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, flag ? { flag } : undefined); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function close(a, b, epsilon = 1e-6) { return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b)); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeRoute(route) { assert(typeof route === 'string' && route.startsWith('/') && !route.includes('://') && !route.includes('..') && !route.includes('#'), `不安全接口路径：${route}`); }

const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const inputVersion = readJson(inputVersionPath);
const binding = readJson(sourceBindingPath);
const freeze = readJson(freezePath);
assert(sha256File(candidatePath) === frozen.candidateFile, '修订二候选字节散列变化');
assert(sha256File(planPath) === frozen.planFile, '修订二计划字节散列变化');
assert(sha256File(sourceBindingPath) === frozen.sourceBinding, '来源绑定字节散列变化');
assert(freeze.historicalContentSha256 === frozen.historicalCandidateContent, '历史候选内容散列说明变化');
assert(candidate.meta?.candidateSha256 === frozen.historicalCandidateContent, '候选内部历史内容散列不符');
assert(plan.candidateSha256 === frozen.candidateFile, '计划未绑定修订二候选字节散列');
assert(candidate.meta?.batch === '英雄机制第三十三批' && candidate.meta?.sourceVersion?.clientVersion === '16.17' && candidate.meta?.sourceVersion?.officialVersion === '16.17.1', '候选批次或来源版本不符');
assert(inputVersion.apiWrites === 0 && inputVersion.GETs === 200, '来源输入包不是只读保护快照');

const formulaSpecs = plan.requests.filter((item) => item.kind === 'formulas').map((item) => ({
  skillKey: item.skillKey, formulaKey: item.stableKey, route: item.detailRoute, level: candidate.skills[item.skillKey].maxLevel, body: item.body,
}));
const newParameterSpecs = plan.requests.filter((item) => item.kind === 'parameters').map((item) => ({ skillKey: item.skillKey, parameterKey: item.stableKey, route: item.detailRoute }));
const reuseList = readJson(path.join(inputDir, '参考资料', '公共参数复用清单.json'));
const reusedParameterSpecs = reuseList.map((item) => ({ skillKey: item.skillKey, parameterKey: item.parameterKey, route: `/skills/${item.skillKey}/parameters/${encodeURIComponent(item.parameterKey)}` }));
assert(formulaSpecs.length === 34 && newParameterSpecs.length === 131 && reusedParameterSpecs.length === 28, '数学读取对象计数不符');
const parameterSpecs = [...newParameterSpecs, ...reusedParameterSpecs];
const parameterRoutes = [...new Set(parameterSpecs.map((item) => item.route))];
assert(parameterRoutes.length === 159, `公式参数实际读取对象应为159项，实际${parameterRoutes.length}`);
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const runDir = path.join(here, '实际数学', runId);
fs.mkdirSync(runDir, { recursive: true });
const journalPath = path.join(runDir, '所有GET原始响应.jsonl');
const calls = [];
let sequence = 0;
function journal(value) { const fd = fs.openSync(journalPath, 'a'); try { fs.writeSync(fd, `${JSON.stringify(value)}\n`, undefined, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
async function get(route) {
  safeRoute(route);
  const seq = ++sequence;
  journal({ phase: 'BEFORE', seq, method: 'GET', route, at: new Date().toISOString() });
  let result;
  try {
    const response = await fetch(`${apiBase}${route}`, { method: 'GET', headers: { Authorization: `Bearer ${process.env.HERO33_API_TOKEN || 'local-entry'}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const text = await response.text();
    let data = null; let parseError = null;
    if (text.length) { try { data = JSON.parse(text); } catch (error) { parseError = String(error.message || error); } }
    result = { seq, method: 'GET', route, status: response.status, data, ...(parseError ? { parseError, bodyText: text } : {}), finishedAt: new Date().toISOString() };
  } catch (error) { result = { seq, method: 'GET', route, status: null, data: null, error: String(error.message || error), finishedAt: new Date().toISOString() }; }
  journal({ phase: 'AFTER', ...result });
  calls.push(result);
  if (result.status === null || result.parseError) throw new Error(`GET失败，停止数学读取：${route}，${result.error || result.parseError}`);
  if (result.status !== 200) throw new Error(`GET状态异常，停止数学读取：${route}，状态=${result.status}`);
  return result.data;
}

const formulaData = new Map();
const parameterData = new Map();
try {
  for (const spec of formulaSpecs) formulaData.set(`${spec.skillKey}/${spec.formulaKey}`, await get(spec.route));
  for (const spec of parameterSpecs) parameterData.set(`${spec.skillKey}/${spec.parameterKey}`, await get(spec.route));
} catch (error) {
  const execution = { generatedAt: new Date().toISOString(), mode: '第三十三批实际GET公式数学', afterApply: true, status: 'STOPPED', complete: false, apiWrites: 0, noBusinessWrites: true, calls: calls.length, methods: { GET: calls.length }, error: String(error.stack || error), journalPath, frozen };
  writeJson(path.join(runDir, '执行结果.json'), execution, 'wx');
  console.log(JSON.stringify({ status: execution.status, complete: false, apiWrites: 0, calls: calls.length, output: runDir, error: execution.error }, null, 2));
  process.exitCode = 1;
  throw error;
}

const runtimeBounds = Object.freeze({
  accelerando_current_stacks: { min: 0, max: 120 },
  current_note_count: { min: 0, max: 4 },
  target_health_ratio: { min: 0, max: 1 },
});
function parameterValue(skillKey, parameterKey, context) {
  const parameter = parameterData.get(`${skillKey}/${parameterKey}`);
  assert(parameter, `实际GET缺少参数：${skillKey}/${parameterKey}`);
  let value;
  if (parameter.valueMode === 'FIXED') {
    assert(parameter.fixedValue !== null && parameter.fixedValue !== undefined, `固定参数无值：${skillKey}/${parameterKey}`);
    value = parameter.fixedValue;
  } else if (parameter.valueMode === 'SKILL_LEVEL') {
    assert(Number.isInteger(context.level) && context.level >= 1, `技能等级无效：${skillKey}/${context.level}`);
    assert(parameter.levelValues && Object.hasOwn(parameter.levelValues, String(context.level)), `实际等级值缺失：${skillKey}/${parameterKey}/${context.level}`);
    value = parameter.levelValues[String(context.level)];
  } else if (parameter.valueMode === 'RUNTIME_INPUT') {
    assert(context.parameters && Object.hasOwn(context.parameters, parameterKey), `运行输入缺失：${skillKey}/${parameterKey}`);
    value = context.parameters[parameterKey];
    const bound = runtimeBounds[parameterKey];
    if (bound) assert(value >= bound.min && value <= bound.max, `运行输入超出范围：${skillKey}/${parameterKey}`);
  } else throw new Error(`未知参数模式：${skillKey}/${parameterKey}/${parameter.valueMode}`);
  assert(typeof value === 'number' && Number.isFinite(value), `实际参数值不是有限数：${skillKey}/${parameterKey}`);
  if (parameter.valueType === 'INTEGER') assert(Number.isInteger(value), `INTEGER参数收到非整数：${skillKey}/${parameterKey}`);
  return value;
}
function attributeValue(node, context) {
  assert(node.nodeType === 'ATTRIBUTE', '属性节点类型错误');
  const key = `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`;
  assert(context.attributes && Object.hasOwn(context.attributes, key), `属性输入缺失：${key}`);
  const value = context.attributes[key];
  assert(typeof value === 'number' && Number.isFinite(value), `属性输入无效：${key}`);
  return value;
}
function evaluate(skillKey, node, context) {
  assert(node && typeof node === 'object', `实际表达式节点为空：${skillKey}`);
  if (node.nodeType === 'PARAMETER') return parameterValue(skillKey, node.parameterKey, context);
  if (node.nodeType === 'ATTRIBUTE') return attributeValue(node, context);
  assert(node.nodeType === 'OPERATION' && Array.isArray(node.operands) && node.operands.length === 2, `表达式必须是二元运算：${skillKey}`);
  const [left, right] = node.operands.map((child) => evaluate(skillKey, child, context));
  if (node.operation === 'ADD') return left + right;
  if (node.operation === 'SUBTRACT') return left - right;
  if (node.operation === 'MULTIPLY') return left * right;
  if (node.operation === 'DIVIDE') { assert(right !== 0, `除数为零：${skillKey}`); return left / right; }
  if (node.operation === 'MIN') return Math.min(left, right);
  if (node.operation === 'MAX') return Math.max(left, right);
  throw new Error(`未知运算：${skillKey}/${node.operation}`);
}
function parameterRefs(node, result = []) { if (!node || typeof node !== 'object') return result; if (node.nodeType === 'PARAMETER') result.push(node.parameterKey); else if (node.nodeType === 'OPERATION') node.operands.forEach((child) => parameterRefs(child, result)); return result; }
function attributeRefs(node, result = []) { if (!node || typeof node !== 'object') return result; if (node.nodeType === 'ATTRIBUTE') result.push(`${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`); else if (node.nodeType === 'OPERATION') node.operands.forEach((child) => attributeRefs(child, result)); return result; }
function binaryChecksFor(skillKey, node, at, records, failures) {
  if (!node || typeof node !== 'object') { failures.push({ check: 'binary', skillKey, at, reason: '节点为空' }); return; }
  if (node.nodeType !== 'OPERATION') return;
  const pass = Array.isArray(node.operands) && node.operands.length === 2 && ['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(node.operation);
  records.push({ skillKey, at, operation: node.operation, operands: node.operands?.length ?? null, pass });
  if (!pass) failures.push({ check: 'binary', skillKey, at, operation: node.operation, operands: node.operands?.length ?? null });
  for (const [index, child] of (node.operands ?? []).entries()) binaryChecksFor(skillKey, child, `${at}.operands[${index}]`, records, failures);
}
function contextFor(skillKey, caseIndex) {
  const high = caseIndex === 1;
  const maxLevel = candidate.skills[skillKey].maxLevel;
  return {
    skillKey,
    level: high ? maxLevel : 1,
    attributes: { 'SOURCE:ability_power:TOTAL': high ? 240 : 40 },
    parameters: {
      accelerando_current_stacks: high ? 120 : 0,
      power_chord_character_level_base_damage: high ? 82 : 28,
      chord_character_level_base_damage: high ? 96 : 35,
      rw_open_missing_health: high ? 720 : 120,
      rw_close_missing_health: high ? 380 : 280,
      note_character_level_base_damage: high ? 44 : 18,
      current_note_count: high ? 4 : 0,
      target_health_ratio: high ? 0.2 : 0.8,
      self_missing_health: high ? 900 : 200,
    },
  };
}
function sourceSpell(skillKey) {
  const heroId = { sona: 'Sona', soraka: 'Soraka', karma: 'Karma', seraphine: 'Seraphine' }[skillKey.split('_')[0]];
  const hero = binding.heroes.find((item) => item.id === heroId);
  return hero?.skills?.find((item) => item.skillKey === skillKey)?.object?.mSpell;
}
function sourceDataValue(skillKey, name, level = 1) {
  const value = sourceSpell(skillKey)?.DataValues?.find((item) => item.name === name)?.values?.[level];
  assert(typeof value === 'number' && Number.isFinite(value), `数学旁证缺少来源值：${skillKey}/${name}/${level}`);
  return value;
}
function sourceCalculationNumber(skillKey, calculationName, field) {
  const root = sourceSpell(skillKey)?.mSpellCalculations?.[calculationName];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return undefined;
    if (typeof node[field] === 'number' && Number.isFinite(node[field])) return node[field];
    for (const child of Object.values(node)) {
      const value = walk(child);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const value = walk(root);
  assert(value !== undefined, `数学旁证缺少计算树数字：${skillKey}/${calculationName}/${field}`);
  return value;
}
function sourceText(skillKey) {
  const heroId = { sona: 'Sona', soraka: 'Soraka', karma: 'Karma', seraphine: 'Seraphine' }[skillKey.split('_')[0]];
  return binding.heroes.find((item) => item.id === heroId)?.skills?.find((item) => item.skillKey === skillKey)?.currentTexts?.keyTooltip?.text ?? '';
}

const { expected } = await import(pathToFileURL(path.join(artifactRoot, 'hero33-independent-source-math', 'source-expected.mjs')));
const formulaCases = [];
const failures = [];
const binaryChecks = [];
for (const spec of formulaSpecs) {
  const actualFormula = formulaData.get(`${spec.skillKey}/${spec.formulaKey}`);
  assert(actualFormula?.expression, `实际GET公式缺少表达式：${spec.skillKey}/${spec.formulaKey}`);
  binaryChecksFor(spec.skillKey, actualFormula.expression, spec.formulaKey, binaryChecks, failures);
  for (const caseIndex of [0, 1]) {
    const context = contextFor(spec.skillKey, caseIndex);
    try {
      const actual = evaluate(spec.skillKey, actualFormula.expression, context);
      const sourceExpected = expected(spec.skillKey, spec.formulaKey, context, binding);
      const pass = close(actual, sourceExpected);
      const record = { skillKey: spec.skillKey, formulaKey: spec.formulaKey, case: caseIndex + 1, level: context.level, abilityPower: context.attributes['SOURCE:ability_power:TOTAL'], actual, sourceExpected, pass };
      formulaCases.push(record);
      if (!pass) failures.push({ check: 'formula-value', ...record });
    } catch (error) {
      const record = { skillKey: spec.skillKey, formulaKey: spec.formulaKey, case: caseIndex + 1, pass: false, error: String(error.message || error) };
      formulaCases.push(record);
      failures.push({ check: 'formula-exception', ...record });
    }
  }
}

const missingInputChecks = [];
for (const spec of formulaSpecs) {
  const actualFormula = formulaData.get(`${spec.skillKey}/${spec.formulaKey}`);
  const refs = [...new Set(parameterRefs(actualFormula.expression))];
  const attrs = [...new Set(attributeRefs(actualFormula.expression))];
  const runtimeRef = refs.find((key) => parameterData.get(`${spec.skillKey}/${key}`)?.valueMode === 'RUNTIME_INPUT');
  const context = contextFor(spec.skillKey, 0);
  let missingKind = 'NONE'; let missingKey = null;
  if (runtimeRef) { missingKind = 'RUNTIME_INPUT'; missingKey = runtimeRef; delete context.parameters[missingKey]; }
  else if (attrs.length) { missingKind = 'ATTRIBUTE'; missingKey = attrs[0]; delete context.attributes[missingKey]; }
  let rejected = false; let message = null;
  try { evaluate(spec.skillKey, actualFormula.expression, context); } catch (error) { rejected = true; message = String(error.message || error); }
  const record = { skillKey: spec.skillKey, formulaKey: spec.formulaKey, missingKind, missingKey, rejected, ...(message ? { message } : {}) };
  missingInputChecks.push(record);
  if (!rejected) failures.push({ check: 'missing-input-not-rejected', ...record });
}

const integerMillisecondsChecks = [];
for (const [key, parameter] of parameterData) {
  if (!key.endsWith('_ms')) continue;
  const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : [];
  const pass = parameter.valueType === 'INTEGER' && values.every((value) => Number.isInteger(value));
  const record = { key, valueType: parameter.valueType, values, pass };
  integerMillisecondsChecks.push(record);
  if (!pass) failures.push({ check: 'milliseconds-integer', ...record });
}

const boundaryChecks = [];
function boundary(name, pass, details) { const record = { name, pass, ...details }; boundaryChecks.push(record); if (!pass) failures.push({ check: 'boundary', ...record }); }
function formulaSpec(skillKey, formulaKey) { const spec = formulaSpecs.find((item) => item.skillKey === skillKey && item.formulaKey === formulaKey); assert(spec, `缺少实际公式规格：${skillKey}/${formulaKey}`); return spec; }
function actualFormulaValue(skillKey, formulaKey, context) { const data = formulaData.get(`${skillKey}/${formulaKey}`); return evaluate(skillKey, data.expression, context); }
function sourceFormulaValue(skillKey, formulaKey, context) { return expected(skillKey, formulaKey, context, binding); }
function checkValidCase(name, skillKey, formulaKey, context, expectedValue) {
  try { const actual = actualFormulaValue(skillKey, formulaKey, context); boundary(name, close(actual, expectedValue), { skillKey, formulaKey, actual, sourceExpected: expectedValue, level: context.level, abilityPower: context.attributes['SOURCE:ability_power:TOTAL'] }); return actual; } catch (error) { boundary(name, false, { skillKey, formulaKey, error: String(error.message || error) }); return null; }
}
function checkReject(name, skillKey, formulaKey, context, reason) {
  let rejected = false; let message = null;
  try { actualFormulaValue(skillKey, formulaKey, context); } catch (error) { rejected = true; message = String(error.message || error); }
  boundary(name, rejected, { skillKey, formulaKey, rejected, reason, ...(message ? { message } : {}) });
}
formulaSpec('sona_p', 'accelerando_current_ability_haste');
const sonaStack0 = contextFor('sona_p', 0); sonaStack0.parameters.accelerando_current_stacks = 0;
const sonaStack120 = contextFor('sona_p', 1); sonaStack120.parameters.accelerando_current_stacks = 120;
checkValidCase('sona_accelerando_stacks_0', 'sona_p', 'accelerando_current_ability_haste', sonaStack0, sourceFormulaValue('sona_p', 'accelerando_current_ability_haste', sonaStack0));
checkValidCase('sona_accelerando_stacks_120', 'sona_p', 'accelerando_current_ability_haste', sonaStack120, sourceFormulaValue('sona_p', 'accelerando_current_ability_haste', sonaStack120));
for (const value of [121, -1, 0.5]) { const context = contextFor('sona_p', 1); context.parameters.accelerando_current_stacks = value; checkReject(`sona_accelerando_invalid_${String(value).replace('.', '_')}`, 'sona_p', 'accelerando_current_ability_haste', context, '0至120且INTEGER'); }
const notes0 = contextFor('seraphine_p', 0); notes0.parameters.current_note_count = 0;
const notes4 = contextFor('seraphine_p', 1); notes4.parameters.current_note_count = 4;
const note0 = checkValidCase('seraphine_notes_0', 'seraphine_p', 'total_note_magic_damage', notes0, sourceFormulaValue('seraphine_p', 'total_note_magic_damage', notes0));
const note4 = checkValidCase('seraphine_notes_4', 'seraphine_p', 'total_note_magic_damage', notes4, sourceFormulaValue('seraphine_p', 'total_note_magic_damage', notes4));
boundary('seraphine_notes_growth_0_to_4', Number.isFinite(note0) && Number.isFinite(note4) && note0 === 0 && note4 > 0, { note0, note4, sourceMaxCount: sourceDataValue('seraphine_p', 'MaxNotes', 1) });
for (const value of [5, -1, 1.5]) { const context = contextFor('seraphine_p', 1); context.parameters.current_note_count = value; checkReject(`seraphine_notes_invalid_${String(value).replace('.', '_')}`, 'seraphine_p', 'total_note_magic_damage', context, '0至4且INTEGER'); }

const sorakaThreshold = parameterData.get('soraka_r/low_health_threshold_ratio');
const sorakaText = sourceText('soraka_r');
const sorakaLow1 = contextFor('soraka_r', 0);
const sorakaLow2 = contextFor('soraka_r', 1);
const sorakaValue1 = checkValidCase('soraka_r_low_health_eval_case_1', 'soraka_r', 'self_low_health_heal', sorakaLow1, sourceFormulaValue('soraka_r', 'self_low_health_heal', sorakaLow1));
const sorakaValue2 = checkValidCase('soraka_r_low_health_eval_case_2', 'soraka_r', 'self_low_health_heal', sorakaLow2, sourceFormulaValue('soraka_r', 'self_low_health_heal', sorakaLow2));
const thresholdSource = sourceDataValue('soraka_p', 'HealthThreshold', 1);
boundary('soraka_r_40_percent_condition', close(sorakaThreshold?.fixedValue, 0.4) && close(thresholdSource, 0.4) && /低于40%/.test(sorakaText), { actualParameter: sorakaThreshold?.fixedValue ?? null, sourceThreshold: thresholdSource, textHasCondition: /低于40%/.test(sorakaText), sourceText: sorakaText });
boundary('soraka_r_low_health_two_distinct_actual_values', Number.isFinite(sorakaValue1) && Number.isFinite(sorakaValue2) && !close(sorakaValue1, sorakaValue2), { case1: sorakaValue1, case2: sorakaValue2, sourceCase1: sourceFormulaValue('soraka_r', 'self_low_health_heal', sorakaLow1), sourceCase2: sourceFormulaValue('soraka_r', 'self_low_health_heal', sorakaLow2), reason: '两个不同等级与法强输入的实际公式求值' });

const finiteChecks = formulaCases.map((item) => ({ skillKey: item.skillKey, formulaKey: item.formulaKey, case: item.case, pass: item.pass && Number.isFinite(item.actual) && Number.isFinite(item.sourceExpected) }));
for (const record of finiteChecks) if (!record.pass) failures.push({ check: 'finite', ...record });
const statusCounts = calls.reduce((out, call) => { const key = String(call.status); out[key] = (out[key] || 0) + 1; return out; }, {});
const formulaPass = formulaCases.length === 68 && formulaCases.every((item) => item.pass);
const missingPass = missingInputChecks.length === 34 && missingInputChecks.every((item) => item.rejected);
const binaryPass = binaryChecks.length > 0 && binaryChecks.every((item) => item.pass);
const integerPass = integerMillisecondsChecks.every((item) => item.pass);
const boundaryPass = boundaryChecks.length > 0 && boundaryChecks.every((item) => item.pass);
const readPass = calls.length === 193 && calls.every((call) => call.method === 'GET' && call.status === 200);
const pass = readPass && formulaPass && missingPass && binaryPass && integerPass && boundaryPass && failures.length === 0;
const report = {
  generatedAt: new Date().toISOString(), mode: '第三十三批实际GET公式数学', afterApply: true, apiBase, status: pass ? 'PASS' : 'FAIL', complete: pass, apiWrites: 0, noBusinessWrites: true,
  methodology: '公式表达式和参数值均从业务接口实际GET回读；期望值只由独立模块从冻结客户端DataValues、mSpellCalculations和当前文本绑定重建；不使用候选固定值代替来源值，不创建默认运行输入。每个公式两组有限输入，缺一个实际运行/属性输入后调用同一求值器确认拒绝；整数毫秒和层数边界由实际求值器检查。',
  hashes: { candidateFileSha256: sha256File(candidatePath), planFileSha256: sha256File(planPath), candidateHistoricalContentSha256: candidate.meta.candidateSha256, planDeclaredCandidateFileSha256: plan.candidateSha256, inputVersionSha256: sha256File(inputVersionPath), sourceBindingSha256: sha256File(sourceBindingPath), byteFreezeSha256: sha256File(freezePath), sourceExpectedModuleSha256: sha256File(path.join(artifactRoot, 'hero33-independent-source-math', 'source-expected.mjs')) },
  sourceVersion: candidate.meta.sourceVersion,
  actualGET: { calls: calls.length, expectedCalls: 193, methods: { GET: calls.length }, statuses: statusCounts, allStatus200: readPass, journalPath },
  formulaCases, formulaCaseCount: formulaCases.length, finiteChecks,
  missingInputChecks, binaryChecks, integerMillisecondsChecks, boundaryChecks,
  sourceChecks: { sorakaRThreshold: { actualParameter: sorakaThreshold?.fixedValue ?? null, sourceDataValue: thresholdSource, text: sorakaText, conditionBound: 0.4 }, karmaRWRootPercentPointToRatio: { rawMNumber: sourceCalculationNumber('karma_r', 'RWHealAmount', 'mNumber'), meaning: 'RWHealAmount根百分数点转比例乘数' }, seraphineQEmpoweredMultiplier: { rawMNumber: sourceCalculationNumber('seraphine_q', 'TotalEmpoweredDamage', 'mNumber'), meaning: 'Q强化端点根乘数；仅作为已录公式端点' } },
  failures,
  writeEvidence: { candidateDir, candidateFileSha256: frozen.candidateFile, planFileSha256: frozen.planFile },
};
const reportPath = path.join(runDir, '实际GET数学验收.json');
writeJson(reportPath, report, 'wx');
const execution = { generatedAt: report.generatedAt, mode: report.mode, afterApply: true, status: report.status, complete: report.complete, apiWrites: 0, noBusinessWrites: true, calls: report.actualGET.calls, methods: report.actualGET.methods, statuses: report.actualGET.statuses, formulaCaseCount: report.formulaCaseCount, missingInputChecks: missingInputChecks.length, integerMillisecondsChecks: integerMillisecondsChecks.length, boundaryChecks: boundaryChecks.length, failures: failures.length, reportPath, journalPath };
writeJson(path.join(runDir, '执行结果.json'), execution, 'wx');
console.log(JSON.stringify({ status: report.status, complete: report.complete, apiWrites: 0, calls: report.actualGET.calls, formulaCaseCount: report.formulaCaseCount, missingInputChecks: missingInputChecks.length, integerMillisecondsChecks: integerMillisecondsChecks.length, boundaryChecks: boundaryChecks.length, failures: failures.length, output: runDir }, null, 2));
if (!pass) process.exitCode = 1;

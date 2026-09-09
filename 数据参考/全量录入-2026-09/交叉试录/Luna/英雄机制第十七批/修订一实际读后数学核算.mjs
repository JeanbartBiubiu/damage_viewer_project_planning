import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 独立读后数学核算。只读取独立全量回读目录中的新GET结果和冻结来源，不发送接口请求，也不读取受保护录入器运行目录。
// 表达式取自本轮独立GET得到的实际公式详情；候选文件仅用于组成键、参数边界和固定算例的期望值。
const herePath = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--run-dir') throw Error('必须指定 --run-dir <独立回读目录>');
const runDir = path.resolve(args[1]);
const independentRoot = path.join(herePath, '独立回读');
const relativeRun = path.relative(independentRoot, runDir);
if (!relativeRun || relativeRun.startsWith('..') || path.isAbsolute(relativeRun)) throw Error('数学结果只能读取独立回读目录');
const candidateFile = '修订一候选.json';
const planFile = '修订一写前计划.json';
const freezeFile = '修订一冻结候选锁.json';
const sourceFile = '根绑定与数值证据.json';
const examplesFile = '修订一独立源值与算例.json';
const fullProtectionFile = '修订一写前完整保护.json';
const expected = {
  candidateSha256: '76ff9761638e3f10d147f662204bbb94656f10ee0edafbc39dcd97d8d37babd7',
  planFileSha256: '7b1b6a62bafaefb8b0d78272300ec281beed0baa5397be902b7685a687254718',
  freezeSha256: 'baee05b688db36f42cfce7fd8e2376e5e93c64888b0ecebc96cfa9752fbec258',
  examplesSha256: '745dab5d338d9ff9ec452e467afac070222c0e05d6dd2477affc95a7837f469a',
  fullProtectionSha256: 'cff6dd7a97ed589f57fcee22052814496dcab6f1f5492bf7e18626d379a2d457',
  totalComponents: 285,
  formulas: 47,
};
const heroes = ['vladimir', 'swain', 'rumble', 'aurelionsol'];
const skills = heroes.flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const kinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const readBytes = name => fs.readFileSync(path.join(herePath, name));
const readJson = name => JSON.parse(readBytes(name));
const close = (left, right, tolerance = 1e-5) => Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) <= tolerance;
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !serverFields.has(key)).sort().map(key => [key, canonical(value[key])]))
    : value;
const diff = (left, right, at = '$') => {
  if (equal(left, right)) return null;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return { path: at, expected: left, actual: right };
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return { path: at, expected: left, actual: right };
    for (let index = 0; index < left.length; index++) {
      const child = diff(left[index], right[index], `${at}[${index}]`);
      if (child) return child;
    }
    return null;
  }
  for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    if (!(key in left) || !(key in right)) return { path: `${at}.${key}`, expected: left[key], actual: right[key] };
    const child = diff(left[key], right[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
};
const businessDiff = (left, right) => diff(canonical(left), canonical(right));
const candidateBytes = readBytes(candidateFile);
const planBytes = readBytes(planFile);
const freezeBytes = readBytes(freezeFile);
const examplesBytes = readBytes(examplesFile);
const fullProtectionBytes = readBytes(fullProtectionFile);
const candidate = JSON.parse(candidateBytes);
const plan = JSON.parse(planBytes);
const freeze = JSON.parse(freezeBytes);
const examples = JSON.parse(examplesBytes);
const source = readJson(sourceFile);
const baseline = JSON.parse(fullProtectionBytes);
const execution = JSON.parse(fs.readFileSync(path.join(runDir, '执行结果.json')));
const snapshot = JSON.parse(fs.readFileSync(path.join(runDir, '独立全量组件现值.json')));
const checks = [];
const failures = [];
const check = (name, passed, detail = null) => {
  const row = { name, passed: Boolean(passed), detail };
  checks.push(row);
  if (!row.passed) failures.push(row);
  return row.passed;
};
check('候选文件冻结', sha256(candidateBytes) === expected.candidateSha256, sha256(candidateBytes));
check('写前计划冻结', sha256(planBytes) === expected.planFileSha256, sha256(planBytes));
check('冻结锁冻结', sha256(freezeBytes) === expected.freezeSha256, sha256(freezeBytes));
check('固定算例文件冻结', sha256(examplesBytes) === expected.examplesSha256, sha256(examplesBytes));
check('写前完整保护冻结', sha256(fullProtectionBytes) === expected.fullProtectionSha256, sha256(fullProtectionBytes));
check('独立回读结果只读且全量完成', execution.apiWrites === 0 && execution.businessWrites === 0 && execution.actual?.methods?.GET === execution.actual?.calls && execution.actual?.details === expected.totalComponents && execution.actual?.lists === 120 && snapshot.phase === '独立全量新GET', { execution: execution.actual, phase: snapshot.phase });
check('独立回读没有失败', execution.failures?.length === 0 && execution.status === 'READY_FOR_POST_WRITE_MATH', execution.failures);

const candidateEntries = [];
for (const skillKey of skills) for (const [kind, key] of kinds) for (const body of candidate.skills?.[skillKey]?.write?.[kind] ?? []) candidateEntries.push({ skillKey, kind, id: body[key], body });
const candidateByKey = new Map(candidateEntries.map(entry => [`${entry.skillKey}/${entry.kind}/${entry.id}`, entry]));
check('候选组成总数恰为285', candidateEntries.length === expected.totalComponents, candidateEntries.length);
const actualByKey = new Map();
for (const record of snapshot.details ?? []) actualByKey.set(`${record.skillKey}/${record.kind}/${record.id}`, record);
check('独立GET详情恰为285且键无重复', (snapshot.details ?? []).length === expected.totalComponents && actualByKey.size === expected.totalComponents, { details: snapshot.details?.length, unique: actualByKey.size });
const componentDiffs = [];
for (const entry of candidateEntries) {
  const key = `${entry.skillKey}/${entry.kind}/${entry.id}`;
  const actual = actualByKey.get(key);
  const difference = actual?.status === 200 ? businessDiff(entry.body, actual.data) : { path: '$', expected: '200详情', actual: actual?.status ?? 'missing' };
  if (difference) componentDiffs.push({ key, diff: difference });
}
check('实际详情全字段等于候选', componentDiffs.length === 0, componentDiffs);

const actualParameter = new Map();
const actualFormula = new Map();
for (const record of snapshot.details ?? []) {
  if (record.status !== 200) continue;
  const key = `${record.skillKey}/${record.id}`;
  if (record.kind === 'parameters') actualParameter.set(key, record.data);
  if (record.kind === 'formulas') actualFormula.set(key, record.data);
}
const explicitInputs = examples.summary?.explicitExampleInputs ?? {};
const runtimeSamples = explicitInputs.runtime ?? {};
const baseAttrs = explicitInputs.attributes ?? {};
const runtimeFor = (skillKey, parameterKey, inputs) => {
  if (Object.hasOwn(inputs, parameterKey)) return inputs[parameterKey];
  if (Object.hasOwn(inputs, `${skillKey}/${parameterKey}`)) return inputs[`${skillKey}/${parameterKey}`];
  if (Object.hasOwn(runtimeSamples, `${skillKey}/${parameterKey}`)) return runtimeSamples[`${skillKey}/${parameterKey}`];
  if (Object.hasOwn(runtimeSamples, parameterKey)) return runtimeSamples[parameterKey];
  throw Error(`缺少实际运行输入 ${skillKey}/${parameterKey}`);
};
const valueOfParameter = (skillKey, parameterKey, context) => {
  const parameter = actualParameter.get(`${skillKey}/${parameterKey}`);
  if (!parameter) throw Error(`实际参数缺失 ${skillKey}/${parameterKey}`);
  if (parameter.valueMode === 'FIXED') {
    if (parameter.fixedValue === null || parameter.fixedValue === undefined) throw Error(`固定参数无值 ${skillKey}/${parameterKey}`);
    return Number(parameter.fixedValue);
  }
  if (parameter.valueMode === 'SKILL_LEVEL' || parameter.valueMode === 'CHARACTER_LEVEL') {
    const value = parameter.levelValues?.[String(context.rank ?? 1)];
    if (value === null || value === undefined) throw Error(`实际参数缺少等级 ${skillKey}/${parameterKey}/${context.rank ?? 1}`);
    return Number(value);
  }
  if (parameter.valueMode === 'RUNTIME_INPUT') return Number(runtimeFor(skillKey, parameterKey, context.inputs ?? {}));
  throw Error(`未知实际参数模式 ${skillKey}/${parameterKey}/${parameter.valueMode}`);
};
const operations = {
  ADD: (left, right) => left + right,
  SUBTRACT: (left, right) => left - right,
  MULTIPLY: (left, right) => left * right,
  DIVIDE: (left, right) => { if (right === 0) throw Error('公式除数为0'); return left / right; },
  MIN: Math.min,
  MAX: Math.max,
};
const evaluate = (skillKey, node, context) => {
  if (node?.nodeType === 'PARAMETER') return valueOfParameter(skillKey, node.parameterKey, context);
  if (node?.nodeType === 'ATTRIBUTE') {
    const inputKey = `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`;
    if (!Object.hasOwn(context.attrs ?? {}, inputKey)) throw Error(`缺少实际属性 ${skillKey}/${inputKey}`);
    return Number(context.attrs[inputKey]);
  }
  if (node?.nodeType === 'OPERATION' && operations[node.operation] && Array.isArray(node.operands) && node.operands.length === 2) return operations[node.operation](...node.operands.map(child => evaluate(skillKey, child, context)));
  throw Error(`实际公式含非法节点 ${skillKey}`);
};
const formulaValue = (skillKey, formulaKey, context) => {
  const formula = actualFormula.get(`${skillKey}/${formulaKey}`);
  if (!formula?.expression) throw Error(`实际公式表达式缺失 ${skillKey}/${formulaKey}`);
  return evaluate(skillKey, formula.expression, context);
};
const formulaEntries = candidateEntries.filter(entry => entry.kind === 'formulas');
check('实际公式数量恰为47', formulaEntries.length === expected.formulas && actualFormula.size === expected.formulas, { candidate: formulaEntries.length, actual: actualFormula.size });
const formulaChecks = [];
const inputRejections = [];
for (const entry of formulaEntries) {
  const context = { rank: 1, attrs: { ...baseAttrs }, inputs: {} };
  for (const parameter of candidate.skills[entry.skillKey].write.parameters ?? []) if (parameter.valueMode === 'RUNTIME_INPUT' && Object.hasOwn(runtimeSamples, `${entry.skillKey}/${parameter.parameterKey}`)) context.inputs[parameter.parameterKey] = runtimeSamples[`${entry.skillKey}/${parameter.parameterKey}`];
  let actualValue = null;
  let error = null;
  try { actualValue = formulaValue(entry.skillKey, entry.id, context); } catch (reason) { error = reason.message; }
  const missing = Boolean(error?.includes('缺少实际运行输入') || error?.includes('缺少实际属性'));
  if (missing) inputRejections.push({ key: `${entry.skillKey}/${entry.id}`, error });
  const passed = !error && Number.isFinite(actualValue);
  formulaChecks.push({ key: `${entry.skillKey}/${entry.id}`, passed, status: missing ? 'MISSING_INPUT_REJECTED' : passed ? 'PASSED' : 'FAILED', actualValue, error });
}
check('47个实际公式均可用明确输入求值', formulaChecks.every(row => row.passed), formulaChecks.filter(row => !row.passed));

const exampleResults = [];
for (const example of examples.summary?.examples ?? []) {
  const inputs = { ...(example.inputs ?? {}) };
  const attrs = {};
  for (const [key, value] of Object.entries(inputs)) if (key.includes(':')) attrs[key] = value;
  const runtime = Object.fromEntries(Object.entries(inputs).filter(([key]) => !key.includes(':')));
  let actualValue = null;
  let error = null;
  try { actualValue = formulaValue(example.skillKey, example.formulaKey, { rank: example.rank ?? 1, attrs, inputs: runtime }); } catch (reason) { error = reason.message; }
  const passed = !error && close(actualValue, example.expected);
  exampleResults.push({ skillKey: example.skillKey, formulaKey: example.formulaKey, expected: example.expected, actual: actualValue, passed, error });
}
check('固定代表算例全部由实际表达式复核', exampleResults.length === (examples.summary?.examples?.length ?? 0) && exampleResults.every(row => row.passed), { total: exampleResults.length, failed: exampleResults.filter(row => !row.passed) });

const boundaryResults = [];
const boundary = (name, passed, detail) => { const row = { name, passed: Boolean(passed), detail }; boundaryResults.push(row); check(name, passed, detail); };
const evaluateBoundary = (skillKey, count) => formulaValue(skillKey, skillKey === 'aurelionsol_p' ? 'e_execute_threshold_ratio' : 'current_execute_threshold_ratio', { rank: 1, attrs: { ...baseAttrs }, inputs: { stardust_count: count } });
boundary('奥瑞利安·索尔P处决0星尘为0.05比例', close(evaluateBoundary('aurelionsol_p', 0), 0.05), evaluateBoundary('aurelionsol_p', 0));
boundary('奥瑞利安·索尔P处决100星尘为0.076比例', close(evaluateBoundary('aurelionsol_p', 100), 0.076), evaluateBoundary('aurelionsol_p', 100));
boundary('奥瑞利安·索尔E处决0星尘为0.05比例', close(evaluateBoundary('aurelionsol_e', 0), 0.05), evaluateBoundary('aurelionsol_e', 0));
boundary('奥瑞利安·索尔E处决100星尘为0.076比例', close(evaluateBoundary('aurelionsol_e', 100), 0.076), evaluateBoundary('aurelionsol_e', 100));

const negativeControls = [];
const negative = (name, fn) => {
  try { fn(); negativeControls.push({ name, rejected: false }); check(`负例 ${name}`, false, '本应拒绝却未拒绝'); }
  catch (error) { negativeControls.push({ name, rejected: true, error: error.message }); check(`负例 ${name}`, true, error.message); }
};
negative('范围外RumbleQ小兵伤害公式不存在', () => formulaValue('rumble_q', 'minion_damage', { rank: 1, attrs: { ...baseAttrs }, inputs: {} }));
negative('范围外SwainW显形时长公式不存在', () => {
  if (actualParameter.has('swain_w/reveal_duration_ms')) return;
  throw Error('实际参数缺失 swain_w/reveal_duration_ms');
});

const actualExpressionHashes = Object.fromEntries([...actualFormula.entries()].map(([key, value]) => [key, sha256(JSON.stringify(value.expression))]));
const report = {
  at: new Date().toISOString(),
  status: failures.length === 0 ? 'READY_FOR_INDEPENDENT_REVIEW' : 'REVISE',
  mode: '独立全量GET后的实际表达式数学核算；不发送接口请求',
  runDir,
  candidateSha256: expected.candidateSha256,
  source: 'client16.17/official16.17.1',
  sourceBuild: '16.17.8104348+branch.releases-16-17.content.release',
  checks: checks.length,
  failedChecks: failures.length,
  failures,
  actualExpressionHashes,
  formulas: { total: formulaEntries.length, actualStored: actualFormula.size, checks: formulaChecks, inputRejections },
  examples: exampleResults,
  boundaries: boundaryResults,
  negativeControls,
  sourceHeroes: source.heroes?.map(hero => hero.id) ?? [],
  actualReadback: execution.actual,
  apiWrites: 0,
  businessWrites: 0,
};
await fsp.writeFile(path.join(runDir, '实际读后数学核算.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, runDir, checks: report.checks, failedChecks: report.failedChecks, formulas: formulaEntries.length, actualStoredExpressions: actualFormula.size, formulaChecks: formulaChecks.length, representativeExamples: exampleResults.length, inputRejections: inputRejections.length, output: path.join(runDir, '实际读后数学核算.json') }, null, 2));
if (failures.length) process.exitCode = 1;

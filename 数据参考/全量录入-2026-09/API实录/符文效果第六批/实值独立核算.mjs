import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// 独立 GET 40 参数和 5 公式后，求值器仅消费实际响应对象；无业务写入口。
const here = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(here, name)));
const fixedPlanSha = '424ae390c61108adc692de63e95926c847e72e855607176bc8703621491eda02';
assert.equal(sha(fs.readFileSync(path.join(here, '最终请求.json'))), fixedPlanSha);
assert.equal(sha(fs.readFileSync(path.join(here, '独立复核/最终独立审查结论.json'))), '2ee88cfe8a329c06f05c2fb49634152c461d7880ec01db0383f9bd96e6b70d6e');
const plan = read('最终请求.json'), review = read('独立复核/最终独立审查结论.json');
const wanted = plan.requests.filter(p => ['parameter', 'formula'].includes(p.kind));
assert.equal(wanted.length, 45);
const auth = process.env.RUNE6_API_TOKEN;
assert.ok(auth, '缺本地认证环境变量');
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '');
const reportName = `实值独立核算-${runId}.json`, logName = `实值核算流水-${runId}.jsonl`;
const report = { startedAt: new Date().toISOString(), requestSha256: fixedPlanSha, apiMethods: ['GET'], businessWrites: 0, reads: [], actualParameters: [], actualFormulas: [], math: [], negativeControls: [], summary: null };
const save = () => fs.writeFileSync(path.join(here, reportName), JSON.stringify(report, null, 2) + '\n');
const log = value => fs.appendFileSync(path.join(here, logName), JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
const match = (a, b) => b === null || typeof b !== 'object' ? Object.is(a, b) : Array.isArray(b) ? Array.isArray(a) && a.length === b.length && b.every((v, i) => match(a[i], v)) : a && Object.entries(b).every(([k, v]) => match(a[k], v));
const actualParameters = new Map(), actualFormulas = new Map();
try {
  for (const item of wanted) {
    log({ phase: 'before', method: 'GET', route: item.readRoute });
    const response = await fetch(`http://127.0.0.1:8080/api/admin/games/lol${item.readRoute}`, { headers: { Authorization: `Bearer ${auth}` }, signal: AbortSignal.timeout(30000) });
    const actual = await response.json();
    log({ phase: 'after', method: 'GET', route: item.readRoute, status: response.status, actual });
    const row = { id: item.id, skillKey: item.skillKey, route: item.readRoute, kind: item.kind, status: response.status, actual, fullRequestFieldsMatched: response.status === 200 && match(actual, item.body) };
    report.reads.push(row); save();
    assert.equal(response.status, 200, item.readRoute);
    assert.equal(row.fullRequestFieldsMatched, true, `实际保存字段不同 ${item.readRoute}`);
    const key = `${item.id}/${actual[item.kind === 'parameter' ? 'parameterKey' : 'formulaKey']}`;
    (item.kind === 'parameter' ? actualParameters : actualFormulas).set(key, actual);
    report[item.kind === 'parameter' ? 'actualParameters' : 'actualFormulas'].push({ id: item.id, actual });
  }
  assert.equal(actualParameters.size, 40); assert.equal(actualFormulas.size, 5);
  function parameter(id, key, supplied) {
    const p = actualParameters.get(`${id}/${key}`);
    if (!p) throw new Error(`未知参数 ${key}`);
    if (p.valueMode === 'FIXED') { assert.ok(Number.isFinite(p.fixedValue)); return p.fixedValue; }
    assert.equal(p.valueMode, 'RUNTIME_INPUT');
    assert.equal(p.fixedValue, null); assert.equal(p.levelValues, null);
    if (!Object.hasOwn(supplied, key) || !Number.isFinite(supplied[key])) throw new Error(`缺运行输入 ${key}`);
    if (p.valueType === 'INTEGER' && !Number.isInteger(supplied[key])) throw new Error(`违反已声明整数输入域 ${key}`);
    if (['actual_legend_stacks', 'actual_consumed_or_sold_count', 'actual_distinct_equipment_attribute_count'].includes(key) && supplied[key] < 0) throw new Error(`违反已声明非负输入域 ${key}`);
    return supplied[key];
  }
  function evaluate(id, node, supplied = {}, attributes = {}) {
    if (node.nodeType === 'PARAMETER') return parameter(id, node.parameterKey, supplied);
    if (node.nodeType === 'ATTRIBUTE') {
      const key = [node.attributeOwner, node.attributeKey, node.attributeValueKind].join('/');
      if (!Object.hasOwn(attributes, key)) throw new Error(`缺属性 ${key}`);
      return attributes[key];
    }
    if (node.nodeType !== 'OPERATION') throw new Error(`非法节点 ${node.nodeType}`);
    const values = node.operands.map(n => evaluate(id, n, supplied, attributes));
    if (node.operation === 'ADD') return values.reduce((a, b) => a + b, 0);
    if (node.operation === 'MULTIPLY') return values.reduce((a, b) => a * b, 1);
    if (node.operation === 'MIN') return Math.min(...values);
    throw new Error(`未支持运算 ${node.operation}`);
  }
  for (const example of review.math) {
    const f = actualFormulas.get(`${example.id}/${example.formulaKey}`);
    assert.ok(f, '算例只能求值实际GET所得公式');
    let actual;
    try { actual = evaluate(example.id, f.expression, example.supplied, example.attributes); } catch (e) { actual = e.message; }
    const expected = example.expected;
    const passed = typeof expected === 'number' ? typeof actual === 'number' && Math.abs(actual - expected) < 1e-9 : typeof actual === 'string' && actual.startsWith(expected);
    report.math.push({ ...example, actual, pass: passed, inputSource: '本次45个实际GET中的参数和公式；预期数字来自写前独立算例' });
    assert.ok(passed, `${example.id}/${example.formulaKey} ${example.reason}`);
  }
  assert.equal(report.math.length, 25);
  assert.equal(new Set(report.math.map(r => `${r.id}/${r.formulaKey}`)).size, 5);
  const controls = [
    { name: '实际层数不得为负', id: 9105, expression: actualFormulas.get('9105/base_skill_haste_from_legend').expression, supplied: { actual_legend_stacks: -1 }, error: '违反已声明非负输入域' },
    { name: '实际层数不得为小数', id: 9105, expression: actualFormulas.get('9105/base_skill_haste_from_legend').expression, supplied: { actual_legend_stacks: 1.5 }, error: '违反已声明整数输入域' },
    { name: '成长生命未核当前等级结果不默认0', id: 5001, expression: { nodeType: 'PARAMETER', parameterKey: 'actual_level_health_bonus' }, error: '缺运行输入' },
    { name: '不可引入公式引用节点', id: 9105, expression: { nodeType: 'FORMULA', formulaKey: 'base_skill_haste_from_legend' }, error: '非法节点' },
    { name: '已撤人工比例键不能回退读值', id: 8345, expression: { nodeType: 'PARAMETER', parameterKey: 'selected_health_recovery_ratio' }, supplied: { selected_health_recovery_ratio: .02 }, error: '未知参数' }
  ];
  for (const item of controls) {
    let error = null; try { evaluate(item.id, item.expression, item.supplied || {}); } catch (e) { error = e.message; }
    const passed = typeof error === 'string' && error.startsWith(item.error);
    report.negativeControls.push({ ...item, actualError: error, passed, boundary: '独立求值器输入域和引用防错检查；不宣称后端运行时已执行此拒绝' });
    assert.ok(passed, item.name);
  }
  assert.equal(parameter(8463, 'actual_base_heal', { actual_base_heal: 35 }), 35);
  report.meleeRanged = { actualBaseHealParameter: actualParameters.get('8463/actual_base_heal'), suppliedBase: 35, melee: 35, ranged: evaluate(8463, actualFormulas.get('8463/ranged_heal_amount').expression, { actual_base_heal: 35 }), expectedRanged: 24.5 };
  assert.equal(report.meleeRanged.ranged, 24.5);
  report.summary = { passed: true, actualGET: 45, parameters: 40, formulas: 5, independentCases: 25, additionalNegativeControls: 5, allFieldsMatched: true, businessWrites: 0 };
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ file: reportName, ...report.summary, sha256: sha(fs.readFileSync(path.join(here, reportName))) }));
} catch (e) {
  report.failure = { name: e.name, message: e.message };
  log({ phase: 'failed', error: report.failure }); save();
  console.error(JSON.stringify({ file: reportName, error: e.message, actualGETCompleted: report.reads.length })); process.exitCode = 1;
}

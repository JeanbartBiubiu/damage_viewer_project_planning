import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../..');
const batch = path.join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第十一批', '等级曲线修正');
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const shaJson = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requestFile = path.join(batch, '最终修正请求.json');
const requestBytes = fs.readFileSync(requestFile);
const request = JSON.parse(requestBytes);
const checks = [];
const issues = [];
const check = (name, pass, detail = null) => {
  checks.push({ name, pass, detail });
  if (!pass) issues.push({ name, detail });
};
const token = process.env.HERO11_API_TOKEN || 'local-entry';
const targetRequests = request.requests;
const liveReads = [];

async function get(route) {
  const response = await fetch(apiBase + route, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = { parseError: String(error), responseText: text.slice(0, 500) };
  }
  const item = { at: new Date().toISOString(), method: 'GET', route, status: response.status, data };
  liveReads.push(item);
  return item;
}

const results = [];
for (const planned of targetRequests) {
  const actual = await get(planned.route);
  const data = actual.data;
  const objectSha256 = actual.status === 200 && data && !data.parseError ? shaJson(data) : null;
  const bodyMatches = actual.status === 200 && data && !data.parseError
    && Object.entries(planned.body ?? {}).every(([key, value]) => isDeepStrictEqual(data[key], value));
  const before = planned.before ?? {};
  const identityKeys = ['gameId', 'skillKey', 'parameterKey', 'formulaKey', 'name', 'sortOrder', 'valueType'];
  const identityMatches = actual.status === 200 && identityKeys
    .filter(key => before[key] !== undefined)
    .every(key => isDeepStrictEqual(data[key], before[key]));
  const item = { route: planned.route, status: actual.status, objectSha256, data, bodyMatches, identityMatches };
  results.push(item);
  check(`${planned.route}实时GET状态为200`, actual.status === 200, { status: actual.status, data });
  check(`${planned.route}实时返回字段匹配修正请求`, bodyMatches, { body: planned.body, data });
  check(`${planned.route}身份字段与修正前一致`, identityMatches, { before, data });
}

const parameterResults = results.filter(item => item.route.includes('/parameters/'));
check('实时回读正好包含6个参数和1个公式', results.length === 7 && parameterResults.length === 6 && results.filter(item => item.route.includes('/formulas/')).length === 1, results.map(item => item.route));
check('6个参数均为RUNTIME_INPUT且没有固定或等级默认值', parameterResults.every(item => item.data.valueMode === 'RUNTIME_INPUT' && item.data.fixedValue === null && item.data.levelValues === null), parameterResults.map(item => ({ route: item.route, valueMode: item.data.valueMode, fixedValue: item.data.fixedValue, levelValues: item.data.levelValues })));

const formula = results.find(item => item.route === '/skills/gwen_p/formulas/passive_heal_amount')?.data;
const param = (node, key) => node?.nodeType === 'PARAMETER' && node.parameterKey === key;
const cap = expression => expression?.nodeType === 'OPERATION'
  && expression.operation === 'ADD'
  && expression.operands?.length === 2
  && param(expression.operands[0], 'heal_cap_level')
  && expression.operands[1]?.nodeType === 'OPERATION'
  && expression.operands[1].operation === 'MULTIPLY'
  && param(expression.operands[1].operands?.[0], 'heal_cap_ap_ratio')
  && expression.operands[1].operands?.[1]?.nodeType === 'ATTRIBUTE'
  && expression.operands[1].operands[1].attributeOwner === 'SOURCE'
  && expression.operands[1].operands[1].attributeKey === 'ability_power'
  && expression.operands[1].operands[1].attributeValueKind === 'TOTAL';
const healing = expression => expression?.nodeType === 'OPERATION'
  && expression.operation === 'MIN'
  && expression.operands?.length === 2
  && expression.operands[0]?.nodeType === 'OPERATION'
  && expression.operands[0].operation === 'MULTIPLY'
  && param(expression.operands[0].operands?.[0], 'healing_ratio')
  && param(expression.operands[0].operands?.[1], 'actual_passive_hero_damage')
  && cap(expression.operands[1]);
check('格温实时公式为实际伤害治疗与HealCap的MIN', healing(formula?.expression), formula?.expression ?? null);

const evaluate = (node, inputs) => {
  if (node?.nodeType === 'PARAMETER') {
    if (!Object.prototype.hasOwnProperty.call(inputs, node.parameterKey)) throw new Error(`缺输入 ${node.parameterKey}`);
    return inputs[node.parameterKey];
  }
  if (node?.nodeType === 'ATTRIBUTE') {
    const key = `${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`;
    if (!Object.prototype.hasOwnProperty.call(inputs, key)) throw new Error(`缺属性 ${key}`);
    return inputs[key];
  }
  if (node?.nodeType !== 'OPERATION' || !Array.isArray(node.operands)) throw new Error('未知表达式节点');
  const values = node.operands.map(operand => evaluate(operand, inputs));
  if (node.operation === 'ADD') return values.reduce((sum, value) => sum + value, 0);
  if (node.operation === 'MULTIPLY') return values.reduce((product, value) => product * value, 1);
  if (node.operation === 'MIN') return Math.min(...values);
  throw new Error(`未知操作 ${node.operation}`);
};
const mathCases = [
  { name: '治疗低于上限', inputs: { healing_ratio: 0.67, actual_passive_hero_damage: 10, heal_cap_level: 30, heal_cap_ap_ratio: 0.07, 'SOURCE.ability_power.TOTAL': 100 }, expected: 6.7 },
  { name: '治疗超过上限', inputs: { healing_ratio: 0.67, actual_passive_hero_damage: 100, heal_cap_level: 30, heal_cap_ap_ratio: 0.07, 'SOURCE.ability_power.TOTAL': 100 }, expected: 37 },
  { name: '高上限下治疗未超过', inputs: { healing_ratio: 0.67, actual_passive_hero_damage: 100, heal_cap_level: 70, heal_cap_ap_ratio: 0.07, 'SOURCE.ability_power.TOTAL': 100 }, expected: 67 },
];
const evaluatedMathCases = [];
for (const item of mathCases) {
  let actual = null;
  let pass = false;
  try {
    actual = evaluate(formula?.expression, item.inputs);
    pass = Math.abs(actual - item.expected) < 1e-9;
  } catch (error) {
    actual = { error: String(error) };
  }
  const evaluated = { ...item, actual, pass };
  evaluatedMathCases.push(evaluated);
  check(`实时公式独立算例：${item.name}`, pass, evaluated);
}
let missingInputRejected = false;
try {
  evaluate(formula?.expression, { healing_ratio: 0.67, actual_passive_hero_damage: 10, heal_cap_ap_ratio: 0.07, 'SOURCE.ability_power.TOTAL': 100 });
} catch (error) {
  missingInputRejected = /heal_cap_level/.test(String(error.message));
}
check('实时公式缺少heal_cap_level时拒绝计算', missingInputRejected, null);

const output = {
  at: new Date().toISOString(),
  pass: issues.length === 0,
  apiWrites: 0,
  requestSha256: crypto.createHash('sha256').update(requestBytes).digest('hex'),
  targetCount: targetRequests.length,
  results,
  liveReads,
  checks,
  issues,
  mathCases: evaluatedMathCases,
  missingInputRejected,
  boundary: '本文件由7条实时GET产生；没有调用PUT/POST，没有修改候选或业务数据，也没有运行战斗或页面。对象散列按实时返回JSON序列化计算。',
};
fs.writeFileSync(path.join(here, '实际7GET实时回读.json'), JSON.stringify(output, null, 2) + '\n');
const report = [
  '# 英雄11七项实时GET独立回读',
  '',
  `结论：${output.pass ? '通过' : '发现问题'}。请求文件散列：\`${output.requestSha256}\`。本次只读请求${results.length}条，业务写入：0。`,
  '',
  '本次脚本直接向本地管理接口读取6个参数和1个公式，逐项记录状态、完整返回对象和对象散列。6个参数实时值均为 `RUNTIME_INPUT`，`fixedValue` 与 `levelValues` 均为 `null`；参数键、公式键、名称、排序和类型等身份字段保持。',
  '',
  '格温实时公式确认是“0.67×实际对英雄伤害”与“等级上限基础值+0.07×总法强”的较小值。独立算例得到6.7、37、67；缺少 `heal_cap_level` 时拒绝计算。',
  '',
  '这份证据只证明本次接口实时GET返回值和表达式核对，不证明战斗运行或页面验收。',
  '',
  '## 实时对象散列',
  '',
  ...results.map(item => `- ${item.route}：HTTP ${item.status}；SHA-256（返回JSON）\`${item.objectSha256 ?? '无'}\``),
  '',
  '## 检查结果',
  '',
  ...checks.map(item => `- ${item.pass ? '通过' : '问题'}：${item.name}`),
  '',
  `结构化证据：\`${path.join(here, '实际7GET实时回读.json')}\`。`,
  '',
].join('\n');
fs.writeFileSync(path.join(here, '实际7GET实时回读报告.md'), report);
console.log(JSON.stringify({ pass: output.pass, gets: results.length, checks: checks.length, issues: issues.length, objectShas: results.map(item => ({ route: item.route, status: item.status, sha256: item.objectSha256 })) }));
if (!output.pass) process.exitCode = 1;

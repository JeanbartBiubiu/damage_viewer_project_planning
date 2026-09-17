import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../..');
const batch = path.join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第十一批', '等级曲线修正');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const requestFile = path.join(batch, '最终修正请求.json');
const resultFile = path.join(batch, '实际修正结果.json');
const request = readJson(requestFile);
const result = readJson(resultFile);
const checks = [];
const issues = [];
const check = (name, pass, detail = null) => {
  checks.push({ name, pass, detail });
  if (!pass) issues.push({ name, detail });
};

const expectedRequestSha = '922f213e781fea8ab8cec893f8cec096382cfaca2cd2e7518958a8e7df636599';
const expectedCandidateHistoricalSha = '98eb0627937a403ddcecd5b597469271ef5b9e074113083bac38d3572e1f2a83';
check('最终修正请求文件散列正确', sha256File(requestFile) === expectedRequestSha, {
  actual: sha256File(requestFile),
  expected: expectedRequestSha,
});
check('实际结果引用最终请求散列', result.requestSha256 === expectedRequestSha, {
  actual: result.requestSha256,
  expected: expectedRequestSha,
});
check('最终请求保留历史候选散列', request.candidateHistoricalSha256 === expectedCandidateHistoricalSha, {
  actual: request.candidateHistoricalSha256,
  expected: expectedCandidateHistoricalSha,
});
check('本次请求没有夹带其他业务写入', request.businessWrites === 0 || (Array.isArray(request.businessWrites) && request.businessWrites.length === 0), request.businessWrites);
check('实际结果明确成功', result.summary?.success === true && result.writes?.length === 7, result.summary);

const targetKeys = [
  ['irelia_p', 'single_stack_attack_speed_percent'],
  ['irelia_w', 'final_physical_reduction_percent'],
  ['fiora_p', 'passive_heal_amount'],
  ['gwen_p', 'heal_cap_level'],
  ['camille_p', 'passive_cooldown_seconds'],
  ['camille_p', 'shield_level_ratio'],
];
const runtimeParameterRoutes = new Set(targetKeys.map(([skillKey, parameterKey]) => `/skills/${skillKey}/parameters/${parameterKey}`));
const formulaRoute = '/skills/gwen_p/formulas/passive_heal_amount';
const requests = request.requests ?? [];
const writes = result.writes ?? [];
const reads = result.reads ?? [];
const routeOf = item => item?.route;
const lastSuccessfulRead = route => [...reads].reverse().find(item => item.route === route && item.status === 200 && item.data);
const sameBodyFields = (body, data) => Object.keys(body).every(key => isDeepStrictEqual(body[key], data?.[key]));
const identityKeys = ['gameId', 'skillKey', 'parameterKey', 'formulaKey', 'name', 'sortOrder', 'valueType'];

for (const req of requests) {
  const route = routeOf(req);
  const write = writes.find(item => item.route === route);
  const finalRead = lastSuccessfulRead(route);
  check(`${route}写入状态为200`, req.method === 'PUT' && write?.status === 200, { request: req, write });
  check(`${route}存在最终成功GET`, Boolean(finalRead), finalRead ?? null);
  if (!write?.after || !finalRead?.data) continue;
  check(`${route}写后GET与写入回显完全一致`, isDeepStrictEqual(write.after, finalRead.data), {
    writeAfter: write.after,
    finalRead: finalRead.data,
  });
  check(`${route}请求字段全部持久化`, sameBodyFields(req.body ?? {}, finalRead.data), {
    body: req.body,
    data: finalRead.data,
  });
  const before = req.before;
  for (const key of identityKeys) {
    if (before?.[key] !== undefined) {
      check(`${route}身份字段${key}未被改动`, isDeepStrictEqual(before[key], finalRead.data[key]), {
        before: before[key],
        after: finalRead.data[key],
      });
    }
  }
}

check('7条修正路由互不重复且全部命中', requests.length === 7 && new Set(requests.map(routeOf)).size === 7 && requests.every(req => runtimeParameterRoutes.has(req.route) || req.route === formulaRoute), requests.map(routeOf));
check('6个等级不确定参数均为运行时输入且无默认值', targetKeys.every(([skillKey, parameterKey]) => {
  const route = `/skills/${skillKey}/parameters/${parameterKey}`;
  const data = lastSuccessfulRead(route)?.data;
  return data?.valueMode === 'RUNTIME_INPUT' && data.fixedValue === null && data.levelValues === null;
}), targetKeys.map(([skillKey, parameterKey]) => lastSuccessfulRead(`/skills/${skillKey}/parameters/${parameterKey}`)?.data));

const gwenRequest = requests.find(item => item.route === formulaRoute);
const gwenRead = lastSuccessfulRead(formulaRoute)?.data;
const gwenExpression = gwenRead?.expression;
const isParam = (node, key) => node?.nodeType === 'PARAMETER' && node.parameterKey === key;
const isGwenCapExpression = expression => expression?.nodeType === 'OPERATION'
  && expression.operation === 'ADD'
  && expression.operands?.length === 2
  && isParam(expression.operands[0], 'heal_cap_level')
  && expression.operands[1]?.nodeType === 'OPERATION'
  && expression.operands[1].operation === 'MULTIPLY'
  && isParam(expression.operands[1].operands?.[0], 'heal_cap_ap_ratio')
  && expression.operands[1].operands?.[1]?.nodeType === 'ATTRIBUTE'
  && expression.operands[1].operands[1].attributeOwner === 'SOURCE'
  && expression.operands[1].operands[1].attributeKey === 'ability_power'
  && expression.operands[1].operands[1].attributeValueKind === 'TOTAL';
const isGwenHealExpression = expression => expression?.nodeType === 'OPERATION'
  && expression.operation === 'MIN'
  && expression.operands?.length === 2
  && expression.operands[0]?.nodeType === 'OPERATION'
  && expression.operands[0].operation === 'MULTIPLY'
  && isParam(expression.operands[0].operands?.[0], 'healing_ratio')
  && isParam(expression.operands[0].operands?.[1], 'actual_passive_hero_damage')
  && isGwenCapExpression(expression.operands[1]);
check('格温治疗公式实际GET为比例乘实际伤害与上限的MIN', isGwenHealExpression(gwenExpression), gwenExpression);
check('格温公式请求字段与实际GET一致', Boolean(gwenRequest) && sameBodyFields(gwenRequest.body, gwenRead), { body: gwenRequest?.body, data: gwenRead });

const evaluate = (node, inputs) => {
  if (!node) throw new Error('缺少表达式节点');
  if (node.nodeType === 'PARAMETER') {
    if (!Object.prototype.hasOwnProperty.call(inputs, node.parameterKey)) throw new Error(`缺少参数:${node.parameterKey}`);
    return inputs[node.parameterKey];
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const key = `${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`;
    if (!Object.prototype.hasOwnProperty.call(inputs, key)) throw new Error(`缺少属性:${key}`);
    return inputs[key];
  }
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands)) throw new Error('未知表达式节点');
  const values = node.operands.map(item => evaluate(item, inputs));
  if (node.operation === 'ADD') return values.reduce((sum, value) => sum + value, 0);
  if (node.operation === 'MULTIPLY') return values.reduce((product, value) => product * value, 1);
  if (node.operation === 'MIN') return Math.min(...values);
  throw new Error(`未知操作:${node.operation}`);
};
const mathCases = [
  {
    name: '实际治疗低于上限',
    inputs: { healing_ratio: 0.67, actual_passive_hero_damage: 10, heal_cap_level: 30, heal_cap_ap_ratio: 0.07, 'SOURCE.ability_power.TOTAL': 100 },
    expected: 6.7,
  },
  {
    name: '实际治疗高于上限',
    inputs: { healing_ratio: 0.67, actual_passive_hero_damage: 100, heal_cap_level: 30, heal_cap_ap_ratio: 0.07, 'SOURCE.ability_power.TOTAL': 100 },
    expected: 37,
  },
  {
    name: '较高等级上限下未超过',
    inputs: { healing_ratio: 0.67, actual_passive_hero_damage: 100, heal_cap_level: 70, heal_cap_ap_ratio: 0.07, 'SOURCE.ability_power.TOTAL': 100 },
    expected: 67,
  },
];
const evaluatedMathCases = mathCases.map(item => {
  const actual = evaluate(gwenExpression, item.inputs);
  return { ...item, actual, pass: Math.abs(actual - item.expected) < 1e-9 };
});
for (const item of evaluatedMathCases) check(`独立算例：${item.name}`, item.pass, item);
let missingInputRejected = false;
try {
  evaluate(gwenExpression, { healing_ratio: 0.67, actual_passive_hero_damage: 10, heal_cap_ap_ratio: 0.07, 'SOURCE.ability_power.TOTAL': 100 });
} catch (error) {
  missingInputRejected = /heal_cap_level/.test(String(error.message));
}
check('缺少heal_cap_level时拒绝计算', missingInputRejected, null);

const output = {
  generatedAt: new Date().toISOString(),
  pass: issues.length === 0,
  requestSha256: sha256File(requestFile),
  expectedRequestSha256: expectedRequestSha,
  candidateHistoricalSha256: request.candidateHistoricalSha256,
  targetRoutes: requests.map(routeOf),
  checks,
  issues,
  summary: {
    targetWrites: writes.length,
    resultReads: reads.length,
    fullProtectionGets: result.summary?.fullProtectionGets ?? null,
    runtimeParameters: 6,
    formulaCorrections: 1,
    independentMathCases: evaluatedMathCases,
    missingInputRejected,
    businessWrites: Array.isArray(request.businessWrites) ? request.businessWrites.length : request.businessWrites,
  },
  evidence: {
    requestFile,
    resultFile,
    boundary: '只读审查已完成的API结果快照；本脚本未调用业务接口，未修改业务数据，未运行战斗或页面。',
  },
};
fs.writeFileSync(path.join(here, '实际修正7项独立回读.json'), JSON.stringify(output, null, 2) + '\n');
const report = [
  '# 英雄11七项实际修正独立回读',
  '',
  `结论：${output.pass ? '通过' : '发现问题'}。最终请求散列：\`${output.requestSha256}\`；历史候选散列：\`${output.candidateHistoricalSha256}\`。`,
  '',
  '逐项对照最终修正结果中的7个写后对象与最后一次成功GET：6个等级不确定参数均为 `RUNTIME_INPUT`，`fixedValue` 与 `levelValues` 均为 `null`，原参数键、名称、排序和类型保持不变；格温治疗公式为“0.67×实际对英雄伤害”与“等级上限基础值+0.07×总法强”的较小值。',
  '',
  '独立算例覆盖治疗低于上限（6.7）、超过上限（37）和较高上限下未超过（67）；删除 `heal_cap_level` 输入会拒绝计算。',
  '',
  `结果快照记录写入${writes.length}项、GET${reads.length}项，其中完整保护GET为${result.summary?.fullProtectionGets ?? '未知'}项；请求没有夹带其他业务写入。`,
  '',
  '本证据只说明接口写后持久化字段和表达式核对通过，不宣称战斗运行或页面验收。',
  '',
  '## 检查结果',
  '',
  ...checks.map(item => `- ${item.pass ? '通过' : '问题'}：${item.name}`),
  '',
  `结构化证据：\`${path.join(here, '实际修正7项独立回读.json')}\`。`,
  '',
].join('\n');
fs.writeFileSync(path.join(here, '实际修正7项独立回读报告.md'), report);
console.log(JSON.stringify({ pass: output.pass, checks: checks.length, issues: issues.length, requestSha256: output.requestSha256, mathCases: evaluatedMathCases.length }));

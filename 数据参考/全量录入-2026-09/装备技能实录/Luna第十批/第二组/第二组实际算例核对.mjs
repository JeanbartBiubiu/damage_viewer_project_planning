import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const candidateFile = path.join(directory, '第二组接口候选.json');
const candidateBytes = fs.readFileSync(candidateFile);
const candidate = JSON.parse(candidateBytes.toString('utf8'));
const candidateSha256 = crypto.createHash('sha256').update(candidateBytes).digest('hex');
const expectedCandidateSha256 = '8e1befbdbdeef83b78f0208fd2eff260a1e0d3333a5db514f1c5eda3d4ab88e2';
if (candidateSha256 !== expectedCandidateSha256) {
  throw new Error(`候选SHA不一致：expected=${expectedCandidateSha256} actual=${candidateSha256}`);
}

function latestReadOnlyFile() {
  const names = fs.readdirSync(directory)
    .filter(name => /^第二组只读检查-\d+\.json$/.test(name))
    .sort();
  if (names.length === 0) throw new Error('缺少第二组写后只读检查文件');
  return names.at(-1);
}

function readOnlyEvidence() {
  const file = latestReadOnlyFile();
  const data = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
  const statuses = data.objects.flatMap(object => object.results.map(result => result.status));
  if (data.objects.length !== 2 || statuses.some(status => status !== 200)) {
    throw new Error('写后独立GET存在非200入口');
  }
  return {
    file,
    generatedAt: data.generatedAt,
    objects: data.objects.map(object => ({
      equipmentKey: object.equipmentKey,
      skillKey: object.skillKey,
      resultCount: object.results.length,
      statuses: object.results.map(result => ({
        route: result.route,
        status: result.status,
        ...(result.route.includes('/formulas/') ? { data: result.data } : {}),
      })),
    })),
  };
}

function writeEvidence() {
  const names = fs.readdirSync(directory)
    .filter(name => /^第二组安全写入-执行-\d+\.json$/.test(name))
    .sort();
  if (names.length === 0) throw new Error('缺少第二组补缺执行证据');
  const file = names.at(-1);
  const data = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
  if (data.summary?.verifiedWriteCount !== 27 || data.summary?.mismatchCount !== 0) {
    throw new Error('第二组执行证据不是27项全量精确回读');
  }
  return {
    file,
    generatedAt: data.generatedAt,
    summary: data.summary,
    objects: data.objects.map(object => ({
      equipmentKey: object.equipmentKey,
      skillKey: object.skillKey,
      finalReadback: object.finalReadback,
    })),
  };
}

function parameterMap(object) {
  return Object.fromEntries(object.apiPayload.parameters.map(parameter => [
    parameter.parameterKey,
    parameter.fixedValue,
  ]));
}

function evaluate(node, context) {
  if (node?.nodeType === 'PARAMETER') {
    const value = context.parameters[node.parameterKey];
    if (value === undefined) throw new Error(`缺少参数 ${node.parameterKey}`);
    return value;
  }
  if (node?.nodeType === 'ATTRIBUTE') {
    const value = context.attributes[node.attributeKey];
    if (value === undefined) throw new Error(`缺少属性 ${node.attributeKey}`);
    return value;
  }
  if (node?.nodeType === 'OPERATION') {
    const values = (node.operands ?? []).map(operand => evaluate(operand, context));
    if (node.operation === 'ADD') return values.reduce((sum, value) => sum + value, 0);
    if (node.operation === 'MULTIPLY') return values.reduce((product, value) => product * value, 1);
    throw new Error(`算例不支持运算 ${node.operation}`);
  }
  throw new Error(`算例不支持节点 ${JSON.stringify(node)}`);
}

function subsetEqual(expected, actual, prefix = '') {
  const issues = [];
  if (expected === null || typeof expected !== 'object') {
    if (!Object.is(expected, actual)) issues.push({ path: prefix, expected, actual });
    return issues;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      issues.push({ path: `${prefix}.length`, expected: expected.length, actual: actual?.length });
      return issues;
    }
    expected.forEach((item, index) => issues.push(...subsetEqual(item, actual[index], `${prefix}[${index}]`)));
    return issues;
  }
  for (const [key, value] of Object.entries(expected)) {
    issues.push(...subsetEqual(value, actual?.[key], prefix ? `${prefix}.${key}` : key));
  }
  return issues;
}

function actualFormulaChecks(object, execution) {
  const formulaResults = execution.objects
    .find(item => item.equipmentKey === object.equipmentKey)
    ?.finalReadback.filter(result => result.path.includes('/formulas/')) ?? [];
  const actualByKey = new Map(formulaResults.map(result => [
    result.path.slice(result.path.lastIndexOf('/') + 1),
    result,
  ]));
  return object.apiPayload.formulas.map(formula => {
    const actual = actualByKey.get(formula.formulaKey);
    const astIssues = actual?.status === 200
      ? subsetEqual(formula, actual.data, `formula.${formula.formulaKey}`)
      : [{ path: `formula.${formula.formulaKey}`, expected: 200, actual: actual?.status }];
    return {
      formulaKey: formula.formulaKey,
      expectedExpression: formula.expression,
      actualExpression: actual?.data?.expression ?? null,
      astMatches: astIssues.length === 0,
      astIssues,
    };
  });
}

const readOnly = readOnlyEvidence();
const execution = writeEvidence();
const expectedValues = {
  item_3004: {
    attributes: { mana: 500 },
    formulas: {
      bonus_attack_damage_from_max_mana: 10,
      mana_flow_max_mana_per_hit: 3,
      mana_flow_hero_hit_max_mana: 6,
    },
  },
  item_3041: {
    attributes: {},
    formulas: {
      ability_power_from_glory: 5,
      move_speed_percent_from_glory_threshold: 0.1,
    },
  },
};

const objects = candidate.objects.map(object => {
  const expected = expectedValues[object.equipmentKey];
  if (!expected) throw new Error(`未预置算例对象 ${object.equipmentKey}`);
  const context = { parameters: parameterMap(object), attributes: expected.attributes };
  const arithmetic = object.apiPayload.formulas.map(formula => {
    const calculated = evaluate(formula.expression, context);
    const expectedValue = expected.formulas[formula.formulaKey];
    const passed = Math.abs(calculated - expectedValue) < 1e-9;
    return {
      formulaKey: formula.formulaKey,
      expression: formula.expression,
      inputs: { attributes: context.attributes, parameters: context.parameters },
      calculated,
      expected: expectedValue,
      passed,
    };
  });
  const ast = actualFormulaChecks(object, execution);
  return {
    equipmentKey: object.equipmentKey,
    skillKey: object.skillKey,
    arithmetic,
    ast,
    passed: arithmetic.every(item => item.passed) && ast.every(item => item.astMatches),
  };
});

const result = {
  batch: 'Luna第十批/第二组',
  generatedAt: new Date().toISOString(),
  status: '写后独立GET与实际公式树算例；不调用写接口。',
  candidateSha256,
  readOnlyEvidence: readOnly,
  writeEvidence: {
    file: execution.file,
    generatedAt: execution.generatedAt,
    summary: execution.summary,
  },
  objects,
  passed: objects.every(object => object.passed),
  boundary: '500法力、荣耀层数等仅为算例输入；算例证明数值与当前回读AST一致，不证明击杀、助攻、阵亡或升级运行时已经接线。',
};
const output = path.join(directory, '第二组实际算例核对.json');
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, passed: result.passed, objects: objects.map(object => ({ equipmentKey: object.equipmentKey, arithmetic: object.arithmetic.length, ast: object.ast.length, passed: object.passed })) }, null, 2));
if (!result.passed) process.exitCode = 1;

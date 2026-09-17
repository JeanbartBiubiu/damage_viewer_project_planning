import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  apiBaseUrl,
  get,
  kinds,
  load,
  makeRunDirectory,
  snapshot,
  verifySources
} from './接口工具.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !['--static', '--run'].includes(args[0]))) {
  throw Error('只允许默认说明、--static 静态算例或 --run 实际接口回读');
}
const mode = args[0] ?? 'help';
if (mode === 'help') {
  console.log('默认只显示用法；--static 只读候选并核对算例；--run 只用GET回读业务数据并保存独立记录。');
  process.exit(0);
}

const loaded = await load();
const { plan } = loaded;

const numericCases = [
  {
    equipmentKey: 'item_3137',
    formulaKey: 'self_healing',
    parameterOverrides: {},
    attributes: { 'SOURCE:ability_power:TOTAL': 300 },
    expected: 160,
    calculation: '100+0.2×SOURCE法术强度300=160'
  },
  {
    equipmentKey: 'item_2522',
    formulaKey: 'amplification_ratio',
    parameterOverrides: { actual_ability_resource_formula2: 500 },
    attributes: {},
    expected: 0.175,
    calculation: '0.01×(15+0.005×原资源实际输入500)=0.175'
  },
  {
    equipmentKey: 'item_3181',
    formulaKey: 'ranged_bonus_damage',
    parameterOverrides: { actual_mstat12_formula0: 200 },
    attributes: { 'SOURCE:attack_damage:BASE': 100 },
    expected: 91,
    calculation: '0.7×(1.2×基础攻击力100+0.05×原第二属性输入200)=91'
  },
  {
    equipmentKey: 'item_6610',
    formulaKey: 'ranged_self_healing',
    parameterOverrides: {},
    attributes: { 'SOURCE:attack_damage:BASE': 100, 'SOURCE:hp:MISSING': 500 },
    expected: 65,
    calculation: '0.5×(0.9×基础攻击力100)+0.04×已损生命500=65'
  },
  {
    equipmentKey: 'item_6333',
    formulaKey: 'melee_deferred_damage',
    parameterOverrides: { actual_eligible_incoming_damage: 100 },
    attributes: {},
    expected: 30,
    calculation: '0.3×明确符合资格的伤害100=30'
  },
  {
    equipmentKey: 'item_6333',
    formulaKey: 'ranged_deferred_damage',
    parameterOverrides: { actual_eligible_incoming_damage: 100 },
    attributes: {},
    expected: 10,
    calculation: '0.1×明确符合资格的伤害100=10'
  },
  {
    equipmentKey: 'item_6333',
    formulaKey: 'total_healing',
    parameterOverrides: {},
    attributes: { 'SOURCE:attack_damage:BONUS': 200 },
    expected: 150,
    calculation: '0.75×额外攻击力200=两秒总治疗150'
  },
  {
    equipmentKey: 'item_6696',
    formulaKey: 'refund_ratio',
    parameterOverrides: { actual_mstat29_formula0: 20 },
    attributes: {},
    expected: 0.15,
    calculation: '0.01×(10+0.25×原mStat29输入20)=0.15'
  },
  {
    equipmentKey: 'item_6696',
    formulaKey: 'refund_cooldown_ms',
    parameterOverrides: { actual_mstat29_formula0: 20, actual_ultimate_total_cooldown_ms: 100000 },
    attributes: {},
    expected: 15000,
    calculation: '0.15×终极技能总冷却100000毫秒=15000毫秒'
  }
];

const derivedCases = [
  {
    equipmentKey: 'item_4401',
    normalMagicHits: 6,
    immobilizeEvents: 1,
    expected: 8,
    calculation: '普通英雄魔法伤害6次+定身事件1次×实际计数2=8次'
  }
];

function round(value) {
  return Math.round(value * 1e9) / 1e9;
}

function objectFor(objects, equipmentKey) {
  const object = objects.find(item => item.equipmentKey === equipmentKey);
  assert.ok(object, `算例装备不存在：${equipmentKey}`);
  return object;
}

function viewFor(object, liveRow) {
  if (!liveRow) {
    return {
      parameters: object.apiPayload.parameters,
      formulas: object.apiPayload.formulas
    };
  }
  assert.equal(liveRow.subject?.state, 'same', `${object.skillKey}主体不是同值`);
  return {
    parameters: liveRow.components.filter(item => item.kind === 'parameters').map(item => item.data),
    formulas: liveRow.components.filter(item => item.kind === 'formulas').map(item => item.data)
  };
}

function parameterMap(view, overrides = {}, requiredKeys = null) {
  const values = {};
  for (const parameter of view.parameters) {
    assert.ok(parameter && typeof parameter.parameterKey === 'string', '参数GET结果缺少参数键');
    const value = Object.hasOwn(overrides, parameter.parameterKey) ? overrides[parameter.parameterKey] : parameter.fixedValue;
    if (value === null || value === undefined) {
      if (requiredKeys?.has(parameter.parameterKey)) throw Error(`算例缺少参数输入：${parameter.parameterKey}`);
      continue;
    }
    assert.ok(Number.isFinite(Number(value)), `参数不是有限数值：${parameter.parameterKey}`);
    values[parameter.parameterKey] = Number(value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    assert.ok(Object.hasOwn(values, key), `算例覆盖了不存在的参数：${key}`);
    assert.ok(Number.isFinite(Number(value)), `算例覆盖值不是有限数值：${key}`);
    values[key] = Number(value);
  }
  return values;
}

function expressionParameterKeys(node, keys = new Set()) {
  if (node?.nodeType === 'PARAMETER') keys.add(node.parameterKey);
  for (const operand of node?.operands ?? []) expressionParameterKeys(operand, keys);
  return keys;
}

function validateExpression(node, parameterKeys, currentPath = 'expression') {
  assert.ok(node && typeof node === 'object', `${currentPath}必须为对象`);
  if (node.nodeType === 'PARAMETER') {
    assert.ok(parameterKeys.has(node.parameterKey), `${currentPath}引用不存在的参数：${node.parameterKey}`);
    return;
  }
  if (node.nodeType === 'ATTRIBUTE') {
    assert.ok(['SOURCE', 'TARGET', 'OWNER'].includes(node.attributeOwner), `${currentPath}属性归属不支持`);
    assert.ok(typeof node.attributeKey === 'string' && node.attributeKey.length > 0, `${currentPath}缺少属性键`);
    assert.ok(['BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO'].includes(node.attributeValueKind), `${currentPath}属性取值口径不支持`);
    return;
  }
  assert.equal(node.nodeType, 'OPERATION', `${currentPath}节点类型不支持：${node.nodeType}`);
  assert.ok(['ADD', 'MULTIPLY'].includes(node.operation), `${currentPath}运算不支持：${node.operation}`);
  assert.ok(Array.isArray(node.operands) && node.operands.length === 2, `${currentPath}必须有两个操作数`);
  validateExpression(node.operands[0], parameterKeys, `${currentPath}.operands[0]`);
  validateExpression(node.operands[1], parameterKeys, `${currentPath}.operands[1]`);
}

function evaluate(node, context, currentPath = 'expression') {
  validateExpression(node, new Set(Object.keys(context.parameters)), currentPath);
  if (node.nodeType === 'PARAMETER') return context.parameters[node.parameterKey];
  if (node.nodeType === 'ATTRIBUTE') {
    const key = `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`;
    assert.ok(Object.hasOwn(context.attributes, key), `算例缺少属性输入：${key}`);
    assert.ok(Number.isFinite(Number(context.attributes[key])), `属性输入不是有限数值：${key}`);
    return Number(context.attributes[key]);
  }
  const left = evaluate(node.operands[0], context, `${currentPath}.operands[0]`);
  const right = evaluate(node.operands[1], context, `${currentPath}.operands[1]`);
  return node.operation === 'ADD' ? left + right : left * right;
}

function formulaFor(view, formulaKey) {
  const formula = view.formulas.find(item => item?.formulaKey === formulaKey);
  assert.ok(formula, `GET结果缺少公式：${formulaKey}`);
  assert.ok(formula.expression, `公式缺少表达式：${formulaKey}`);
  return formula;
}

function runNumericCases(objects, rowsByEquipmentKey) {
  return numericCases.map((item, index) => {
    const object = objectFor(objects, item.equipmentKey);
    const view = viewFor(object, rowsByEquipmentKey.get(item.equipmentKey));
    const formula = formulaFor(view, item.formulaKey);
    const parameters = parameterMap(view, item.parameterOverrides, expressionParameterKeys(formula.expression));
    const actual = round(evaluate(formula.expression, { parameters, attributes: item.attributes }));
    assert.ok(Math.abs(actual - item.expected) <= 1e-9, `算例${index + 1}结果不符：${item.equipmentKey}/${item.formulaKey}`);
    return {
      index: index + 1,
      kind: 'formula',
      equipmentKey: item.equipmentKey,
      formulaKey: item.formulaKey,
      parameters,
      attributes: item.attributes,
      expected: item.expected,
      actual,
      calculation: item.calculation,
      passed: true
    };
  });
}

function runDerivedCases(objects, rowsByEquipmentKey) {
  return derivedCases.map((item, index) => {
    const object = objectFor(objects, item.equipmentKey);
    const view = viewFor(object, rowsByEquipmentKey.get(item.equipmentKey));
    const parameters = parameterMap(view);
    const requiredHits = parameters.required_magic_hits;
    const immobilizeHits = parameters.immobilize_hit_count;
    const actual = item.normalMagicHits + item.immobilizeEvents * immobilizeHits;
    assert.equal(requiredHits, item.expected, `${item.equipmentKey}所需计数已变化`);
    assert.equal(actual, item.expected, `${item.equipmentKey}区别性计数算例不符`);
    return {
      index: numericCases.length + index + 1,
      kind: '固定参数推导',
      equipmentKey: item.equipmentKey,
      inputs: { normalMagicHits: item.normalMagicHits, immobilizeEvents: item.immobilizeEvents, immobilizeHitCount: immobilizeHits },
      expected: item.expected,
      actual,
      calculation: item.calculation,
      passed: true
    };
  });
}

function validateLiveSnapshot(live, planObjects) {
  const expectedComponents = planObjects.reduce((sum, object) => sum + kinds.reduce((total, [kind]) => total + object.apiPayload[kind].length, 0), 0);
  const expectedTotal = planObjects.length + expectedComponents + planObjects.length + planObjects.length;
  assert.equal(live.objects.length, planObjects.length, '实库对象数量不符');
  assert.equal(live.missing.length, 0, '实库仍缺少候选字段');
  assert.equal(live.conflicts.length, 0, '实库存在候选字段冲突');
  assert.equal(live.deferred.length, 0, '实库仍有延后对象');
  assert.equal(live.sameCount, expectedTotal, '实库同值组成总数不符');
  assert.equal(live.catalogs.length, 3, '目录GET数量不符');
  assert.ok(live.catalogs.every(item => item.status === 200), '属性、修正区或技能分类目录GET失败');
  const expectedSkillKeys = new Set(planObjects.map(object => object.skillKey));
  assert.ok(planObjects.every(object => live.inventory.some(item => item.skillKey === object.skillKey)), '技能目录缺少本批技能');
  assert.equal(live.objects.filter(row => expectedSkillKeys.has(row.skillKey)).length, planObjects.length, '实库技能对象重复或缺项');
  for (const object of planObjects) {
    const row = live.objects.find(item => item.equipmentKey === object.equipmentKey && item.skillKey === object.skillKey);
    assert.ok(row, `实库回读缺少对象：${object.skillKey}`);
    assert.equal(row.subject.state, 'same', `${object.skillKey}主体回读异值`);
    assert.equal(row.componentLists.length, kinds.length, `${object.skillKey}六类组成列表不完整`);
    assert.ok(row.componentLists.every(list => list.status === 200 && list.keySetMatch), `${object.skillKey}组成列表键集合不符`);
    assert.equal(row.components.length, expectedComponentsFor(object), `${object.skillKey}组成详情数量不符`);
    assert.ok(row.components.every(component => component.state === 'same' && !component.unexpected), `${object.skillKey}组成详情存在异值或越界项`);
    assert.equal(row.relation?.state, 'same', `${object.skillKey}装备挂载回读异值`);
    assert.equal(row.image?.state, 'same', `${object.skillKey}技能代表图回读异值`);
    assert.equal(row.protection.routes.length, 3, `${object.equipmentKey}核心保护路由不完整`);
    assert.ok(row.protection.routes.every(route => route.match), `${object.equipmentKey}装备、属性或装备代表图被改动`);
    assert.ok(row.protection.routes.some(route => route.route.endsWith('/attributes') && route.match), `${object.equipmentKey}直接属性保护缺失`);
    assert.ok(row.protection.routes.some(route => route.route.endsWith('/representative-image') && route.match), `${object.equipmentKey}装备代表图保护缺失`);
  }
}

function expectedComponentsFor(object) {
  return kinds.reduce((sum, [kind]) => sum + object.apiPayload[kind].length, 0);
}

const rowsByEquipmentKey = new Map();
const result = {
  generatedAt: new Date().toISOString(),
  mode: mode === '--run' ? '实际接口GET回读与公式算例' : '候选静态公式算例',
  apiBaseUrl: mode === '--run' ? apiBaseUrl : null,
  candidateSha256: loaded.hash,
  sourceSha256: loaded.sourceHash,
  beforeHash: loaded.beforeHash,
  activeSlotHash: loaded.activeSlotHash,
  noBusinessWrites: true,
  apiWrites: 0,
  getRequests: 0,
  sourceProof: null,
  snapshot: null,
  cases: [],
  errors: []
};

let runDirectory = null;
if (mode === '--run') {
  const runId = `独立实值核算-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  runDirectory = await makeRunDirectory(runId);
  result.runId = runId;
}

try {
  result.sourceProof = await verifySources(loaded.source);
  if (mode === '--run') {
    const trackedGet = async (...requestArgs) => {
      result.getRequests += 1;
      return get(...requestArgs);
    };
    result.snapshot = await snapshot(plan, loaded.before, { request: trackedGet });
    validateLiveSnapshot(result.snapshot, plan.objects);
    for (const row of result.snapshot.objects) rowsByEquipmentKey.set(row.equipmentKey, row);
  }
  result.cases = [...runNumericCases(plan.objects, rowsByEquipmentKey), ...runDerivedCases(plan.objects, rowsByEquipmentKey)];
} catch (error) {
  result.errors.push(String(error));
  process.exitCode = 1;
} finally {
  if (runDirectory) {
    const filePath = path.join(runDirectory, '独立实值核算.json');
    result.outputPath = filePath;
    await writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  }
}

console.log(JSON.stringify({
  mode: result.mode,
  runId: result.runId,
  candidateSha256: result.candidateSha256,
  getRequests: result.getRequests,
  apiWrites: result.apiWrites,
  caseCount: result.cases.length,
  passed: result.cases.filter(item => item.passed).length,
  errors: result.errors,
  outputPath: result.outputPath
}));

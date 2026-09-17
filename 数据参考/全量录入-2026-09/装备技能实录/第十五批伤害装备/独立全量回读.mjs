import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiBaseUrl, get, kinds, load, snapshot, verifySources } from './接口工具.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const loaded = await load();
const { plan, before, hash } = loaded;

function actualComponent(row, kind, key) {
  const [,, api] = kinds.find(item => item[0] === kind);
  const item = row.components.find(component => component.kind === kind && component.id === key);
  assert.ok(item, `${row.skillKey} 缺少回读组成 ${api}/${key}`);
  assert.equal(item.state, 'same', `${row.skillKey} 组成不同值 ${api}/${key}`);
  return item.data;
}

function formulaRows(row) {
  return new Map(row.components.filter(component => component.kind === 'formulas' && component.state === 'same').map(component => [component.id, component.data]));
}

function parameterRows(row) {
  return new Map(row.components.filter(component => component.kind === 'parameters' && component.state === 'same').map(component => [component.id, component.data]));
}

function evaluate(node, parameters, inputs, attributes) {
  if (node.nodeType === 'PARAMETER') {
    const parameter = parameters.get(node.parameterKey);
    assert.ok(parameter, `公式引用参数不存在：${node.parameterKey}`);
    if (parameter.valueMode === 'FIXED') return parameter.fixedValue;
    assert.equal(parameter.valueMode, 'RUNTIME_INPUT', `公式参数不是显式输入：${node.parameterKey}`);
    assert.ok(Object.hasOwn(inputs, node.parameterKey), `算例缺少显式输入：${node.parameterKey}`);
    assert.ok(Number.isFinite(inputs[node.parameterKey]), `算例输入不是数值：${node.parameterKey}`);
    if (parameter.valueType === 'INTEGER') assert.ok(Number.isInteger(inputs[node.parameterKey]), `算例输入不是整数：${node.parameterKey}`);
    return inputs[node.parameterKey];
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const value = attributes?.[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
    assert.ok(Number.isFinite(value), `算例缺少属性：${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`);
    return value;
  }
  assert.equal(node.nodeType, 'OPERATION', `未知公式节点：${node.nodeType}`);
  const values = node.operands.map(operand => evaluate(operand, parameters, inputs, attributes));
  if (node.operation === 'ADD') return values.reduce((sum, value) => sum + value, 0);
  if (node.operation === 'MULTIPLY') return values.reduce((product, value) => product * value, 1);
  if (node.operation === 'MIN') return Math.min(...values);
  if (node.operation === 'MAX') return Math.max(...values);
  if (node.operation === 'SUBTRACT') return values.slice(1).reduce((result, value) => result - value, values[0]);
  throw Error(`未知公式运算：${node.operation}`);
}

function checkFormula(rowsBySkill, name, skillKey, formulaKey, inputs, attributes, expected) {
  const row = rowsBySkill.get(skillKey);
  assert.ok(row, `算例技能缺失：${skillKey}`);
  const formula = formulaRows(row).get(formulaKey);
  assert.ok(formula, `算例公式缺失：${skillKey}/${formulaKey}`);
  const value = evaluate(formula.expression, parameterRows(row), inputs, attributes);
  const match = Number.isFinite(value) && Math.abs(value - expected) < 1e-9;
  assert.equal(match, true, `${name}：${value} !== ${expected}`);
  return { name, skillKey, formulaKey, inputs, attributes, actual: value, expected, match: true };
}

function rejectFormula(rowsBySkill, name, skillKey, formulaKey, inputs) {
  const row = rowsBySkill.get(skillKey);
  assert.ok(row, `拒绝算例技能缺失：${skillKey}`);
  const formula = formulaRows(row).get(formulaKey);
  assert.ok(formula, `拒绝算例公式缺失：${skillKey}/${formulaKey}`);
  let rejected = false;
  try { evaluate(formula.expression, parameterRows(row), inputs, {}); } catch { rejected = true; }
  assert.equal(rejected, true, `${name} 应拒绝`);
  return { name, skillKey, formulaKey, inputs, actual: 'rejected', expected: 'rejected', match: true };
}

const out = {
  startedAt: new Date().toISOString(),
  mode: '独立 GET 全字段回读',
  apiBaseUrl,
  candidateSha256: hash,
  boundary: '不读取写入响应作为回读；重新 GET 技能主体、六类组成、挂载、图片及装备保护字段。公式算例使用重新 GET 的公式和参数，不代表浏览器、战斗或 Wasm 运行验证。',
  success: false
};

try {
  out.sources = await verifySources(loaded.source);
  out.snapshot = await snapshot(plan, before, { request: get });
  const rowsBySkill = new Map(out.snapshot.objects.map(row => [row.skillKey, row]));
  const componentLists = out.snapshot.objects.flatMap(row => row.componentLists);
  const protectionRows = out.snapshot.objects.map(row => ({
    equipmentKey: row.equipmentKey,
    skillKey: row.skillKey,
    equipmentCoreFieldsMatch: row.protection.routes.every(route => route.match),
    equipmentRoutes: row.protection.routes.map(route => ({ route: route.route, status: route.status, match: route.match, actual: route.actual, fields: route.fields })),
    relationActual: row.relation,
    relationMatchesCandidate: row.relation.state === 'same',
    equipmentImageKey: row.image.equipmentImageKey,
    skillImageState: row.image.state,
    imageReused: row.image.state === 'same' && row.image.equipmentImageKey === plan.objects.find(object => object.skillKey === row.skillKey).apiPayload.representativeImage.imageKey
  }));
  out.protection = {
    equipmentCount: protectionRows.length,
    equipmentCoreFieldsMatch: protectionRows.every(row => row.equipmentCoreFieldsMatch),
    relationsMatchCandidate: protectionRows.every(row => row.relationMatchesCandidate),
    representativeImagesReused: protectionRows.filter(row => row.imageReused).length,
    rows: protectionRows
  };
  out.sixComponentLists = {
    expected: plan.objects.length * kinds.length,
    read: componentLists.length,
    allStatus200: componentLists.every(list => list.status === 200),
    allKeysMatch: componentLists.every(list => list.keySetMatch),
    rows: componentLists
  };
  out.componentDetails = {
    expected: plan.totals.parameters + plan.totals.formulas + plan.totals.effects + plan.totals.processes + plan.totals.internalStates + plan.totals.triggerRules,
    same: out.snapshot.objects.reduce((sum, row) => sum + row.components.filter(component => component.state === 'same').length, 0),
    fullFieldsMatch: out.snapshot.objects.every(row => row.components.every(component => component.state === 'same'))
  };
  out.formulaCases = [];
  for (const [input, expected] of [[0, 20], [100, 22], [500, 30]]) out.formulaCases.push(checkFormula(rowsBySkill, `2503燃烧/${input}`, 'item_2503_passive', 'burn_damage_per_second', { burn_scaling_stat_value: input }, {}, expected));
  out.formulaCases.push(checkFormula(rowsBySkill, '2508总伤害', 'item_2508_passive', 'total_damage', {}, {}, 15));
  for (const [input, expected] of [[0, 60], [100, 65], [500, 85]]) out.formulaCases.push(checkFormula(rowsBySkill, `3118地面伤害/${input}`, 'item_3118_passive', 'ground_burn_damage_value', { ground_damage_scaling_stat_value: input }, {}, expected));
  for (const [input, expected] of [[0, 100], [100, 110]]) out.formulaCases.push(checkFormula(rowsBySkill, `3152魔法弹/${input}`, 'item_3152_active', 'firebolt_damage', { firebolt_scaling_stat_value: input }, {}, expected));
  out.formulaCases.push(checkFormula(rowsBySkill, '6660展示DPS', 'item_6660_passive', 'display_dps', {}, {}, 15));
  for (const [input, echo, maximum] of [[0, 75, 150], [100, 80, 160], [500, 100, 200]]) {
    out.formulaCases.push(checkFormula(rowsBySkill, `6655回声/${input}`, 'item_6655_passive', 'echo_damage', { echo_scaling_stat_value: input }, {}, echo));
    out.formulaCases.push(checkFormula(rowsBySkill, `6655单目标上限/${input}`, 'item_6655_passive', 'single_target_max_damage', { echo_scaling_stat_value: input }, {}, maximum));
  }
  out.formulaCases.push(checkFormula(rowsBySkill, '6655剩余回声比例', 'item_6655_passive', 'remaining_echo_total_ratio', {}, {}, 1));
  for (const [input, expected] of [[0, 0], [1, 0.02], [2, 0.04], [3, 0.06], [4, 0.06]]) out.formulaCases.push(checkFormula(rowsBySkill, `3147完整间隔/${input}`, 'item_3147_passive', 'damage_increase_ratio', { completed_combat_intervals: input }, {}, expected));
  out.formulaCases.push(rejectFormula(rowsBySkill, '3147未完成间隔', 'item_3147_passive', 'damage_increase_ratio', { completed_combat_intervals: 0.5 }));
  for (const [hp, melee, ranged] of [[0, 0, 0], [100, 9, 7], [1000, 90, 70]]) {
    const attributes = { TARGET: { hp: { CURRENT: hp } } };
    out.formulaCases.push(checkFormula(rowsBySkill, `6699近战当前生命值/${hp}`, 'item_6699_passive', 'melee_current_hp_damage', {}, attributes, melee));
    out.formulaCases.push(checkFormula(rowsBySkill, `6699远程当前生命值/${hp}`, 'item_6699_passive', 'ranged_current_hp_damage', {}, attributes, ranged));
  }
  for (const [input, expected] of [[0, 125], [100, 135]]) out.formulaCases.push(checkFormula(rowsBySkill, `4646风啸/${input}`, 'item_4646_passive', 'squall_damage', { squall_scaling_stat_value: input }, {}, expected));
  out.formulaSummary = { cases: out.formulaCases.length, failures: out.formulaCases.filter(item => !item.match).length };
  out.success = out.snapshot.missing.length === 0
    && out.snapshot.conflicts.length === 0
    && out.protection.equipmentCoreFieldsMatch
    && out.protection.relationsMatchCandidate
    && out.protection.representativeImagesReused === plan.objects.length
    && out.sixComponentLists.read === out.sixComponentLists.expected
    && out.sixComponentLists.allStatus200
    && out.sixComponentLists.allKeysMatch
    && out.componentDetails.same === out.componentDetails.expected
    && out.componentDetails.fullFieldsMatch
    && out.formulaSummary.failures === 0;
} catch (error) {
  out.error = String(error);
}
out.finishedAt = new Date().toISOString();
await writeFile(path.join(here, '独立全量回读.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ success: out.success, candidateSha256: out.candidateSha256, skillInventory: out.snapshot?.inventory.length, components: out.snapshot?.sameCount, missing: out.snapshot?.missing.length, conflicts: out.snapshot?.conflicts.length, sixComponentLists: out.sixComponentLists?.read, formulaCases: out.formulaSummary?.cases, formulaFailures: out.formulaSummary?.failures, error: out.error }));
if (!out.success) process.exitCode = 1;

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidate = JSON.parse(await readFile(path.join(here, '完整候选.json'), 'utf8'));
const objects = new Map(candidate.objects.map(object => [object.equipmentKey, object]));

function round(value) {
  return Math.round(value * 1e9) / 1e9;
}

function evaluate(node, context) {
  assert.ok(node && typeof node === 'object', '公式节点必须为对象');
  if (node.nodeType === 'PARAMETER') {
    assert.ok(Object.hasOwn(context.parameters, node.parameterKey), `算例缺少参数输入 ${node.parameterKey}`);
    return context.parameters[node.parameterKey];
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const key = `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`;
    assert.ok(Object.hasOwn(context.attributes, key), `算例缺少属性输入 ${key}`);
    return context.attributes[key];
  }
  assert.equal(node.nodeType, 'OPERATION');
  assert.ok(Array.isArray(node.operands));
  assert.equal(node.operands.length, 2, `${node.operation}必须有两个操作数`);
  const left = evaluate(node.operands[0], context);
  const right = evaluate(node.operands[1], context);
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error(`未知公式运算 ${node.operation}`);
  }
}

function formula(object, formulaKey) {
  const row = object.apiPayload.formulas.find(item => item.formulaKey === formulaKey);
  assert.ok(row, `${object.skillKey}缺少公式 ${formulaKey}`);
  return row;
}

function assertFormulaReferences(object) {
  const parameterKeys = new Set(object.apiPayload.parameters.map(item => item.parameterKey));
  function visit(node) {
    if (node.nodeType === 'PARAMETER') {
      assert.ok(parameterKeys.has(node.parameterKey), `${object.skillKey}公式引用了非参数 ${node.parameterKey}`);
      return;
    }
    if (node.nodeType === 'ATTRIBUTE') {
      assert.ok(['SOURCE', 'TARGET', 'OWNER'].includes(node.attributeOwner));
      assert.ok(typeof node.attributeKey === 'string' && node.attributeKey.length > 0);
      assert.ok(['BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO'].includes(node.attributeValueKind));
      return;
    }
    assert.equal(node.nodeType, 'OPERATION');
    assert.ok(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(node.operation));
    assert.equal(node.operands.length, 2, `${object.skillKey}/${node.operation}操作数不是2`);
    visit(node.operands[0]);
    visit(node.operands[1]);
  }
  for (const row of object.apiPayload.formulas) visit(row.expression);
}

for (const object of candidate.objects) assertFormulaReferences(object);

function hasNode(node, predicate) {
  if (predicate(node)) return true;
  if (node?.nodeType === 'OPERATION') return node.operands.some(child => hasNode(child, predicate));
  return false;
}

const structuralChecks = [
  { check: '2520不含破坏支路正常参数或公式', passed: !objects.get('item_2520').apiPayload.parameters.some(row => row.parameterKey.startsWith('destruction_') || row.parameterKey === 'damage_takedown_window_ms') && !objects.get('item_2520').apiPayload.formulas.some(row => row.formulaKey.startsWith('destruction_')) },
  { check: '2530不含和音第三方治疗正常参数或公式', passed: !objects.get('item_2530').apiPayload.parameters.some(row => row.parameterKey.startsWith('harmony_heal_') || row.parameterKey.startsWith('ally_')) && !objects.get('item_2530').apiPayload.formulas.some(row => row.formulaKey.startsWith('ally_')) },
  { check: '2523不含无证距离插值公式或运行时距离输入', passed: objects.get('item_2523').apiPayload.formulas.length === 0 && !objects.get('item_2523').apiPayload.parameters.some(row => row.parameterKey === 'telescope_target_distance') },
  { check: '2517两个技能急速公式绑定SOURCE额外攻击力', passed: objects.get('item_2517').apiPayload.formulas.every(row => hasNode(row.expression, node => node.nodeType === 'ATTRIBUTE' && node.attributeOwner === 'SOURCE' && node.attributeKey === 'attack_damage' && node.attributeValueKind === 'BONUS')) },
  { check: '2510两个缺省节点绑定SOURCE法术强度', passed: objects.get('item_2510').apiPayload.formulas.every(row => hasNode(row.expression, node => node.nodeType === 'ATTRIBUTE' && node.attributeOwner === 'SOURCE' && node.attributeKey === 'ability_power' && node.attributeValueKind === 'TOTAL')) }
];
for (const check of structuralChecks) assert.equal(check.passed, true, check.check);

const cases = [
  { id: 'item_2510', key: 'spellblade_damage_value', inputs: { spellblade_damage_mstat2_formula1_input: 100 }, attributes: { 'SOURCE:ability_power:TOTAL': 50 }, expected: 80, explanation: '咒刃伤害：0.75×100+0.1×SOURCE法术强度50' },
  { id: 'item_2510', key: 'spellblade_healing_value', inputs: { spellblade_healing_mstat12_formula2_input: 50 }, attributes: { 'SOURCE:ability_power:TOTAL': 200 }, expected: 21.5, explanation: '咒刃治疗：0.1×SOURCE法术强度200+0.03×50' },
  { id: 'item_2512', key: 'barrage_attack_speed_bonus', inputs: {}, expected: 0.5, explanation: '开战弹幕攻击速度比例' },
  { id: 'item_2512', key: 'barrage_critical_damage_result', inputs: {}, expected: 0.8, explanation: '开战弹幕常规暴击伤害比例' },
  { id: 'item_2512', key: 'barrage_extra_true_damage_result', inputs: {}, expected: 0.15, explanation: '开战弹幕额外真实伤害比例' },
  { id: 'item_2517', key: 'melee_haste_from_bonus_attack_damage', inputs: {}, attributes: { 'SOURCE:attack_damage:BONUS': 100 }, expected: 18, explanation: '近战饥馑：5+0.13×SOURCE额外攻击力100' },
  { id: 'item_2517', key: 'ranged_haste_from_bonus_attack_damage', inputs: {}, attributes: { 'SOURCE:attack_damage:BONUS': 100 }, expected: 15, explanation: '远程饥馑：5+0.10×SOURCE额外攻击力100' },
  { id: 'item_2520', key: 'ability_damage_value', inputs: { ability_damage_mstat29_input: 40, ability_damage_ranged_multiplier_input: 0.5 }, expected: 55, explanation: '成型炸药：(50+1.5×40)×0.5' },
  { id: 'item_2526', key: 'harmony_heal_shield_strength_percent_points', inputs: { harmony_resource_input: 1000 }, expected: 5, explanation: '和谐：0.005×1000=5百分数点（5%）' },
  { id: 'item_2526', key: 'mana_flow_normal_hit_gain', inputs: {}, expected: 4, explanation: '法力流普通命中增加4' },
  { id: 'item_2526', key: 'mana_flow_hero_hit_gain', inputs: {}, expected: 8, explanation: '法力流英雄命中：4×2' },
  { id: 'item_2530', key: 'harmony_heal_shield_strength_percent_points', inputs: { harmony_resource_input: 1000 }, expected: 5, explanation: '歌之权冠和谐：0.005×1000=5百分数点（5%）' },
  { id: 'item_3040', key: 'bonus_ap_from_max_mana', inputs: {}, attributes: { 'SOURCE:mana:TOTAL': 1000 }, expected: 20, explanation: '敬畏：1000×0.02' },
  { id: 'item_3040', key: 'lifeline_shield_value', inputs: { lifeline_shield_resource_input: 500 }, expected: 90, explanation: '救主灵刃：0.18×500' },
  { id: 'item_3042', key: 'bonus_attack_damage_from_max_mana', inputs: {}, attributes: { 'SOURCE:mana:TOTAL': 1000 }, expected: 20, explanation: '魔切敬畏：1000×0.02' },
  { id: 'item_3042', key: 'on_hit_damage_from_max_mana', inputs: {}, attributes: { 'SOURCE:mana:TOTAL': 1000 }, expected: 12, explanation: '魔切攻击特效：1000×0.012' },
  { id: 'item_3042', key: 'melee_ability_damage_from_max_mana', inputs: {}, attributes: { 'SOURCE:mana:TOTAL': 1000 }, expected: 40, explanation: '魔切近战技能：1000×0.04' },
  { id: 'item_3042', key: 'ranged_ability_damage_from_max_mana', inputs: {}, attributes: { 'SOURCE:mana:TOTAL': 1000 }, expected: 30, explanation: '魔切远程技能：1000×0.03' },
  { id: 'item_3042', key: 'champ_range_default', inputs: {}, expected: 1, explanation: '魔切默认施法分支' },
  { id: 'item_3042', key: 'champ_range_ranged', inputs: {}, expected: 2, explanation: '魔切远程施法分支' },
  { id: 'item_3073', key: 'overload_melee_attack_speed_bonus', inputs: {}, expected: 0.5, explanation: '过载近战攻击速度50%' },
  { id: 'item_3073', key: 'overload_ranged_attack_speed_bonus', inputs: {}, expected: 0.35, explanation: '过载远程攻击速度35%' },
  { id: 'item_3073', key: 'overload_melee_move_speed_bonus', inputs: {}, expected: 0.2, explanation: '过载近战移动速度20%' },
  { id: 'item_3073', key: 'overload_ranged_move_speed_bonus', inputs: {}, expected: 0.14, explanation: '过载远程移动速度14%' },
  { id: 'item_3083', key: 'warmog_base_healing_value', inputs: { warmog_healing_stat_input: 4000 }, expected: 60, explanation: '狂徒基础治疗：0.015×4000' },
  { id: 'item_3083', key: 'warmog_tooltip_healing_value', inputs: { warmog_healing_stat_input: 4000 }, expected: 120, explanation: '狂徒提示治疗：0.015×4000×2' },
  { id: 'item_3083', key: 'warmog_bonus_health_from_equipment', inputs: { warmog_equipment_health_input: 1000 }, expected: 120, explanation: '狂徒之活力：1000×0.12' }
];

const parameterCases = [
  { id: 'item_2523', key: 'telescope_max_range', expected: 500, explanation: '高倍望远镜已证上限距离500码' },
  { id: 'item_2523', key: 'telescope_max_damage_amp_ratio', expected: 0.1, explanation: '高倍望远镜已证上限额外伤害0.1小数比例（10%）' },
  { id: 'item_2526', key: 'harmony_resource_percent_point_coefficient', expected: 0.005, explanation: '耳语头环和谐系数0.005，结果按百分数点解释' },
  { id: 'item_2530', key: 'harmony_resource_percent_point_coefficient', expected: 0.005, explanation: '歌之权冠和谐系数0.005，结果按百分数点解释' }
];

const results = cases.map((item, index) => {
  const object = objects.get(item.id);
  assert.ok(object, `算例装备不存在 ${item.id}`);
  const context = {
    parameters: Object.fromEntries(object.apiPayload.parameters
      .filter(parameter => parameter.valueMode === 'FIXED')
      .map(parameter => [parameter.parameterKey, parameter.fixedValue])),
    attributes: item.attributes ?? {}
  };
  Object.assign(context.parameters, item.inputs ?? {});
  const actual = round(evaluate(formula(object, item.key).expression, context));
  assert.equal(actual, item.expected, `算例${index + 1} ${item.id}/${item.key}结果不符`);
  return { index: index + 1, equipmentKey: item.id, formulaKey: item.key, inputs: context, calculation: item.explanation, expected: item.expected, actual, passed: true };
});

const parameterResults = parameterCases.map((item, index) => {
  const object = objects.get(item.id);
  assert.ok(object, `参数核对装备不存在 ${item.id}`);
  const parameter = object.apiPayload.parameters.find(row => row.parameterKey === item.key);
  assert.ok(parameter, `${item.id}缺少参数 ${item.key}`);
  assert.equal(parameter.valueMode, 'FIXED', `${item.id}/${item.key}不是固定值`);
  assert.equal(parameter.fixedValue, item.expected, `${item.id}/${item.key}固定值不符`);
  return { index: index + 1, equipmentKey: item.id, parameterKey: item.key, calculation: item.explanation, expected: item.expected, actual: parameter.fixedValue, passed: true };
});

const report = {
  generatedAt: new Date().toISOString(),
  stage: '候选独立数值核对；只读取完整候选.json，不调用业务接口',
  candidateFile: '完整候选.json',
  candidateSha256: JSON.parse(await readFile(path.join(here, '完整版本.json'), 'utf8')).sha256,
  formulaReferenceCheck: { objects: candidate.objects.length, formulas: candidate.totals.formulas, passed: true },
  formulaCaseCount: results.length,
  parameterCheckCount: parameterResults.length,
  caseCount: results.length + parameterResults.length,
  passed: results.length + parameterResults.length,
  failed: 0,
  cases: results,
  parameterChecks: parameterResults,
  structuralChecks,
  boundary: '算例只证明候选参数、显式输入和运算树的算术结果；不证明触发、状态、周期、目标筛选、冷却消费或战斗运行时。'
};
await writeFile(path.join(here, '独立数值核对.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ file: '独立数值核对.json', caseCount: report.caseCount, passed: report.passed, failed: report.failed, candidateSha256: report.candidateSha256 }));

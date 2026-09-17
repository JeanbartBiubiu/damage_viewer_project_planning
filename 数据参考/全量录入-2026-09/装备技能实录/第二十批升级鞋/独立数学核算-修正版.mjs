import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT = path.resolve(HERE, '..', '..', '..', '..', '..', 'damage_web_dev', '.agents', 'artifacts', 'gear20-finalize');
const CANDIDATE_PATH = path.join(HERE, '修正版最终候选.json');
const EXPECTED_CANDIDATE_SHA = '9dc1b9628720c0afc91d9e835649ae6899dd9bfcbacac136fae7c7081ab79f62';
const candidateBytes = fs.readFileSync(CANDIDATE_PATH);
const candidateSha256 = crypto.createHash('sha256').update(candidateBytes).digest('hex');
if (candidateSha256 !== EXPECTED_CANDIDATE_SHA) throw new Error(`修正版候选哈希变化：${candidateSha256}`);
const candidate = JSON.parse(candidateBytes.toString('utf8'));

function fail(message) { throw new Error(message); }
function approx(actual, expected, epsilon = 1e-9) {
  return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon;
}
function objectFor(skillKey) {
  const object = candidate.objects.find(value => value.skillKey === skillKey);
  if (!object) fail(`缺少技能：${skillKey}`);
  return object;
}
function parameterMap(object) {
  return Object.fromEntries(object.apiPayload.parameters.map(parameter => [parameter.parameterKey, parameter]));
}
function formulaFor(skillKey, formulaKey) {
  const object = objectFor(skillKey);
  const formula = object.apiPayload.formulas.find(value => value.formulaKey === formulaKey);
  if (!formula) fail(`缺少公式：${skillKey}/${formulaKey}`);
  return { object, formula };
}
function runtimeValue(parameterKey, parameter, overrides) {
  if (!Object.hasOwn(overrides, parameterKey)) throw new Error(`MISSING_RUNTIME_PARAMETER:${parameterKey}`);
  const value = overrides[parameterKey];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`INVALID_RUNTIME_PARAMETER:${parameterKey}`);
  if (parameter.valueType === 'INTEGER' && !Number.isInteger(value)) throw new Error(`INVALID_INTEGER_RUNTIME_PARAMETER:${parameterKey}`);
  if (parameter.valueType === 'DECIMAL' && typeof value !== 'number') throw new Error(`INVALID_DECIMAL_RUNTIME_PARAMETER:${parameterKey}`);
  return value;
}
function evaluate(node, object, overrides) {
  if (!node || typeof node !== 'object') throw new Error('INVALID_EXPRESSION_NODE');
  if (node.nodeType === 'PARAMETER') {
    const parameter = parameterMap(object)[node.parameterKey];
    if (!parameter) throw new Error(`UNKNOWN_PARAMETER:${node.parameterKey}`);
    if (parameter.valueMode === 'FIXED') {
      if (typeof parameter.fixedValue !== 'number' || !Number.isFinite(parameter.fixedValue)) throw new Error(`INVALID_FIXED_PARAMETER:${node.parameterKey}`);
      return parameter.fixedValue;
    }
    if (parameter.valueMode === 'RUNTIME_INPUT') return runtimeValue(node.parameterKey, parameter, overrides);
    throw new Error(`UNSUPPORTED_VALUE_MODE:${node.parameterKey}`);
  }
  if (node.nodeType === 'ATTRIBUTE') throw new Error(`ATTRIBUTE_NOT_PROVIDED:${node.attributeKey}`);
  if (node.nodeType === 'FORMULA') throw new Error(`FORMULA_REFERENCE_NOT_ALLOWED:${node.formulaKey}`);
  if (node.nodeType !== 'OPERATION') throw new Error(`UNSUPPORTED_NODE:${node.nodeType}`);
  const operands = node.operands ?? [];
  if (operands.length === 0) throw new Error(`EMPTY_OPERATION:${node.operation}`);
  const values = operands.map(child => evaluate(child, object, overrides));
  if (node.operation === 'ADD') return values.reduce((left, right) => left + right, 0);
  if (node.operation === 'MULTIPLY') return values.reduce((left, right) => left * right, 1);
  if (node.operation === 'MIN') return Math.min(...values);
  throw new Error(`UNSUPPORTED_OPERATION:${node.operation}`);
}
function positive(name, skillKey, formulaKey, overrides, expected) {
  const { object, formula } = formulaFor(skillKey, formulaKey);
  let actual = null; let error = null;
  try { actual = evaluate(formula.expression, object, overrides); } catch (value) { error = String(value); }
  return { name, skillKey, formulaKey, overrides, expected, actual, error, pass: error === null && approx(actual, expected) };
}
function rejected(name, skillKey, formulaKey, overrides, expectedError) {
  const { object, formula } = formulaFor(skillKey, formulaKey);
  let error = null;
  try { evaluate(formula.expression, object, overrides); } catch (value) { error = String(value); }
  return { name, skillKey, formulaKey, overrides, expectedError, error, rejected: error !== null, pass: error === expectedError };
}
function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(child => walk(child, visitor));
    return;
  }
  visitor(node);
  Object.values(node).forEach(child => walk(child, visitor));
}

const parameterCount = candidate.objects.reduce((sum, object) => sum + object.apiPayload.parameters.length, 0);
const formulaCount = candidate.objects.reduce((sum, object) => sum + object.apiPayload.formulas.length, 0);
const formulaShapes = [];
for (const object of candidate.objects) {
  for (const formula of object.apiPayload.formulas) {
    const nodes = []; const illegal = [];
    walk(formula.expression, node => {
      nodes.push(node.nodeType);
      if (node.nodeType === 'OPERATION' && !['ADD', 'MULTIPLY', 'MIN'].includes(node.operation)) illegal.push(`operation:${node.operation}`);
      if (!['PARAMETER', 'OPERATION'].includes(node.nodeType)) illegal.push(`node:${node.nodeType}`);
    });
    formulaShapes.push({ skillKey: object.skillKey, formulaKey: formula.formulaKey, nodeCount: nodes.length, illegal, pass: illegal.length === 0 });
  }
}

const positives = [
  positive('不朽之路五层', 'item_3168_passive', 'stacked_omnivamp', { actual_stacks: 5 }, 0.03),
  positive('迅速进军移动速度400', 'item_3170_passive', 'adaptive_force_from_move_speed', { actual_source_move_speed: 400 }, 20),
  positive('猩红明朗远程比例', 'item_3171_passive', 'ranged_move_speed_ratio', {}, 0.08),
  positive('带链碾碎者护盾', 'item_3173_passive', 'magic_shield_value', { actual_level_base_shield: 100, source_mstat12_formula2_value: 500 }, 140),
  positive('装甲战靴护盾', 'item_3174_passive', 'physical_shield_value', { actual_level_base_shield: 100, source_mstat12_formula2_value: 500 }, 140),
];
const capCases = [9, 10, 11].map(actual_stacks => positive(
  `不朽之路层数${actual_stacks}`,
  'item_3168_passive', 'stacked_omnivamp', { actual_stacks }, Math.min(actual_stacks, 10) * 0.006,
));
const missingValueRejections = [
  rejected('不朽之路缺层数', 'item_3168_passive', 'stacked_omnivamp', {}, 'Error: MISSING_RUNTIME_PARAMETER:actual_stacks'),
  rejected('迅速进军缺移动速度', 'item_3170_passive', 'adaptive_force_from_move_speed', {}, 'Error: MISSING_RUNTIME_PARAMETER:actual_source_move_speed'),
  rejected('带链碾碎者缺当前等级基础护盾', 'item_3173_passive', 'magic_shield_value', { source_mstat12_formula2_value: 500 }, 'Error: MISSING_RUNTIME_PARAMETER:actual_level_base_shield'),
  rejected('带链碾碎者缺来源输入', 'item_3173_passive', 'magic_shield_value', { actual_level_base_shield: 100 }, 'Error: MISSING_RUNTIME_PARAMETER:source_mstat12_formula2_value'),
  rejected('装甲战靴缺当前等级基础护盾', 'item_3174_passive', 'physical_shield_value', { source_mstat12_formula2_value: 500 }, 'Error: MISSING_RUNTIME_PARAMETER:actual_level_base_shield'),
  rejected('装甲战靴缺来源输入', 'item_3174_passive', 'physical_shield_value', { actual_level_base_shield: 100 }, 'Error: MISSING_RUNTIME_PARAMETER:source_mstat12_formula2_value'),
];
const typeRejections = [
  rejected('层数拒绝小数0.5', 'item_3168_passive', 'stacked_omnivamp', { actual_stacks: 0.5 }, 'Error: INVALID_INTEGER_RUNTIME_PARAMETER:actual_stacks'),
];
const shieldLevelNoDefault = [];
for (const [skillKey, formulaKey] of [['item_3173_passive', 'magic_shield_value'], ['item_3174_passive', 'physical_shield_value']]) {
  const parameter = parameterMap(objectFor(skillKey)).actual_level_base_shield;
  const missing = rejected(`${skillKey}基础护盾无默认`, skillKey, formulaKey, { source_mstat12_formula2_value: 500 }, 'Error: MISSING_RUNTIME_PARAMETER:actual_level_base_shield');
  shieldLevelNoDefault.push({
    skillKey,
    parameter: { valueType: parameter.valueType, valueMode: parameter.valueMode, fixedValue: parameter.fixedValue, levelValues: parameter.levelValues },
    missingEvaluation: missing,
    pass: parameter.valueType === 'DECIMAL' && parameter.valueMode === 'RUNTIME_INPUT' && parameter.fixedValue === null && parameter.levelValues === null && missing.pass,
  });
}
const removedBreakpointParameters = candidate.objects
  .filter(object => ['item_3173', 'item_3174'].includes(object.equipmentKey))
  .every(object => !object.apiPayload.parameters.some(parameter => ['shield_breakpoint_level', 'shield_bonus_per_level'].includes(parameter.parameterKey)));

const allPass = parameterCount === 28
  && formulaCount === 5
  && formulaShapes.every(value => value.pass)
  && positives.every(value => value.pass)
  && capCases.every(value => value.pass)
  && missingValueRejections.every(value => value.pass)
  && typeRejections.every(value => value.pass)
  && shieldLevelNoDefault.every(value => value.pass)
  && removedBreakpointParameters;
const result = {
  generatedAt: new Date().toISOString(),
  mode: '独立解析修正版候选表达式',
  noBusinessWrites: true,
  apiWrites: 0,
  candidateSha256,
  parameterCount,
  formulaCount,
  formulaShapes,
  positiveCases: positives,
  capCases,
  missingValueRejections,
  integerTypeRejections: typeRejections,
  shieldLevelNoDefault,
  removedBreakpointParameters,
  allPass,
  candidateMathReady: allPass,
  businessMathReady: false,
  businessMathNote: '本结果只解析候选表达式；业务实值核算须由独立回读脚本读取完成后的业务接口。',
};
fs.mkdirSync(ARTIFACT, { recursive: true });
const resultPath = path.join(ARTIFACT, `独立数学核算-修正版-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
if (!allPass) process.exitCode = 1;
console.log(JSON.stringify({ resultPath, candidateSha256, parameterCount, formulaCount, positivePassed: positives.filter(value => value.pass).length, positiveTotal: positives.length, capPassed: capCases.filter(value => value.pass).length, capTotal: capCases.length, missingPassed: missingValueRejections.filter(value => value.pass).length, missingTotal: missingValueRejections.length, integerTypePassed: typeRejections.filter(value => value.pass).length, integerTypeTotal: typeRejections.length, shieldNoDefaultPassed: shieldLevelNoDefault.filter(value => value.pass).length, shieldNoDefaultTotal: shieldLevelNoDefault.length, candidateMathReady: allPass, businessMathReady: false }));

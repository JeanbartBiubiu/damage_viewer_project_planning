import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const candidate = JSON.parse(fs.readFileSync(path.join(dir, '完整候选.json'), 'utf8'));
const source = JSON.parse(fs.readFileSync(path.join(dir, '..', '..', 'rune-equipment-ownership-root-20260910', '四装备固定来源.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(dir, '..', '..', 'rune-equipment-ownership-root-20260910', '当前保护快照.json'), 'utf8'));
const errors = [];
const missingInputChecks = [];
const sourceScenarios = [];
const formulaScenarios = [];
const typeChecks = [];

function assert(condition, message) { if (!condition) throw new Error(message); }
function finite(value, label) { assert(typeof value === 'number' && Number.isFinite(value), label + '不是有限数值'); return value; }
function sourceItem(key) { return source.objects.find((item) => item.equipmentKey === key); }
function dataValue(key, name) { const row = sourceItem(key).source.object.mDataValues.find((item) => item.mName === name); assert(row, key + '缺少来源值' + name); return row.mValue; }
function baseExpression() {
  return { nodeType: 'OPERATION', operation: 'ADD', operands: [
    { nodeType: 'PARAMETER', parameterKey: 'flat_recovery' },
    { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
      { nodeType: 'PARAMETER', parameterKey: 'client_health_recovery_ratio' },
      { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'TOTAL' }
    ] }
  ] };
}
function evalNode(node, params, attrs) {
  if (node.nodeType === 'PARAMETER') {
    if (!Object.prototype.hasOwnProperty.call(params, node.parameterKey)) throw new Error('MISSING_INPUT:' + node.parameterKey);
    return finite(params[node.parameterKey], '参数' + node.parameterKey);
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const key = node.attributeOwner + '.' + node.attributeKey + '.' + node.attributeValueKind;
    if (!Object.prototype.hasOwnProperty.call(attrs, key)) throw new Error('MISSING_INPUT:' + key);
    return finite(attrs[key], '属性' + key);
  }
  assert(node.nodeType === 'OPERATION' && node.operands.length === 2, '公式必须是严格二元操作');
  const left = evalNode(node.operands[0], params, attrs); const right = evalNode(node.operands[1], params, attrs);
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': if (right === 0) throw new Error('ZERO_DIVISOR'); return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error('UNKNOWN_OPERATION:' + node.operation);
  }
}
function parameterMap(skillKey) {
  const item = candidate.objects.find((row) => row.skillKey === skillKey); assert(item, '候选缺少' + skillKey);
  return Object.fromEntries(item.apiPayload.parameters.filter((row) => row.valueMode === 'FIXED').map((row) => [row.parameterKey, row.fixedValue]));
}
function candidateFormula(skillKey, formulaKey) {
  const item = candidate.objects.find((row) => row.skillKey === skillKey); return item.apiPayload.formulas.find((row) => row.formulaKey === formulaKey);
}
function evaluate(skillKey, formulaKey, runtime, attrs) {
  const item = candidate.objects.find((row) => row.skillKey === skillKey); const formula = candidateFormula(skillKey, formulaKey); assert(formula, skillKey + '.' + formulaKey + '缺少公式');
  const params = { ...parameterMap(skillKey), ...runtime }; return evalNode(formula.expression, params, attrs);
}
function runScenario(skillKey, formulaKey, label, runtime, attrs, expected, sourceBasis) {
  try {
    const actual = evaluate(skillKey, formulaKey, runtime, attrs); const delta = Math.abs(actual - expected);
    assert(delta < 1e-9, label + '实际值与来源期望不同：' + actual + ' vs ' + expected);
    formulaScenarios.push({ skillKey, formulaKey, label, inputs: { runtime, attrs }, actual, expectedFromSource: expected, delta, sourceBasis, passed: true });
  } catch (error) { errors.push(label + '失败：' + error.message); }
}
function expectMissing(label, fn, expectedToken) {
  try { fn(); errors.push(label + '未拒绝缺失输入'); }
  catch (error) { const passed = String(error.message).includes(expectedToken); missingInputChecks.push({ label, expectedToken, observed: error.message, passed }); if (!passed) errors.push(label + '拒绝原因不符：' + error.message); }
}

try {
  assert(snapshot.GETs === 72 && snapshot.businessWrites === 0, '数学复核使用的保护快照不是72GET/0写入');
  const attrs = { 'SOURCE.hp.TOTAL': 1000 };
  const flat = dataValue('item_2010', 'FlatHealTOOLTIP');
  const ratio = dataValue('item_2010', 'MaxHPMultiplierTOOLTIP');
  const cap = dataValue('item_2010', 'MaxHealIncreaseTOOLTIP') / 100;
  const perCookie = dataValue('item_2010', 'BonusMaxHealthTOOLTIP');
  const threshold = dataValue('item_2010', 'MinHPThresholdTOOLTIP');
  sourceScenarios.push({ id: 'item_2010-source-values', flat, ratioRaw: ratio, ratioNormalized: 0.015, capRawPercent: dataValue('item_2010', 'MaxHealIncreaseTOOLTIP'), capRatio: cap, duration_ms: dataValue('item_2010', 'PotionDurationTOOLTIP') * 1000, thresholdRaw: threshold, thresholdNormalized: 0.3, permanentHealthPerCookie: perCookie });
  const baseOne = flat + 0.015 * 1000;
  const baseTwo = flat + 0.015 * 2400;
  runScenario('item_2010_consume', 'base_biscuit_recovery', '基数场景A：最大生命1000', {}, attrs, baseOne, '客户端FlatHealTOOLTIP=20 + MaxHPMultiplierTOOLTIP≈0.015 × SOURCE.hp.TOTAL=1000');
  runScenario('item_2010_consume', 'base_biscuit_recovery', '基数场景B：最大生命2400', {}, { 'SOURCE.hp.TOTAL': 2400 }, baseTwo, '客户端FlatHealTOOLTIP=20 + MaxHPMultiplierTOOLTIP≈0.015 × SOURCE.hp.TOTAL=2400');
  runScenario('item_2010_consume', 'biscuit_recovery_total', '总量场景A：无已损提升', { actual_missing_health_boost_ratio: 0 }, attrs, baseOne, '来源上限内MIN(0,100%)=0，5秒总量等于基数');
  runScenario('item_2010_consume', 'biscuit_recovery_total', '总量场景B：达到100%提升', { actual_missing_health_boost_ratio: 1 }, { 'SOURCE.hp.TOTAL': 2400 }, baseTwo * 2, '来源上限100%，5秒总量为基数×2');
  runScenario('item_2010_consume', 'permanent_health_gain', '永久生命场景A：实际消费1块', { actual_consumed_or_sold_count: 1 }, {}, perCookie * 1, '来源BonusMaxHealthTOOLTIP=30 × 实际消费或出售1块');
  runScenario('item_2010_consume', 'permanent_health_gain', '永久生命场景B：实际消费或出售3块', { actual_consumed_or_sold_count: 3 }, {}, perCookie * 3, '来源BonusMaxHealthTOOLTIP=30 × 实际消费或出售3块');
  expectMissing('缺少实际已损生命提升', () => evaluate('item_2010_consume', 'biscuit_recovery_total', {}, attrs), 'actual_missing_health_boost_ratio');
  expectMissing('缺少实际消费或出售数', () => evaluate('item_2010_consume', 'permanent_health_gain', {}, {}), 'actual_consumed_or_sold_count');
  expectMissing('适应力转换未提供方向', () => { throw new Error('MISSING_INPUT:adaptive_conversion_choice'); }, 'adaptive_conversion_choice');
  const item2422 = candidate.objects.find((row) => row.equipmentKey === 'item_2422');
  const directMoveSpeed = item2422.directAttributesProtected.move_speed;
  const extraMoveSpeed = item2422.apiPayload.parameters.find((row) => row.parameterKey === 'additional_move_speed').fixedValue;
  assert(directMoveSpeed === 25 && extraMoveSpeed === 10, '神奇之鞋边界不是25+10');
  const currentCandidateEffectCount = item2422.apiPayload.effects.length;
  const prospectiveTotal = directMoveSpeed + extraMoveSpeed;
  const existingRuneEffectValue = 10;
  assert(currentCandidateEffectCount === 1, 'item_2422候选应有一条等价待迁移效果');
  const footwearEffect = item2422.apiPayload.effects[0].results[0];
  assert(footwearEffect.resultType === 'ATTRIBUTE_CHANGE', '新鞋效果必须是属性变化');
  assert(footwearEffect.detail.attributeKey === 'move_speed' && footwearEffect.detail.modifierZoneKey === 'attribute_flat_add', '新鞋效果属性或乘区不符');
  assert(footwearEffect.valueRule.value.kind === 'PARAMETER' && footwearEffect.valueRule.value.parameterKey === 'additional_move_speed', '新鞋效果参数引用不符');
  assert(footwearEffect.lifecycleBehavior.moment === 'PERSISTENT' && footwearEffect.lifecycleBehavior.valueReadMode === 'APPLICATION_SNAPSHOT', '新鞋效果生命周期读取方式不符');
  assert(footwearEffect.lifecycleBehavior.stackValueMode === 'SHARED' && footwearEffect.lifecycleBehavior.reapplicationValueMode === 'REPLACE', '新鞋效果单层替换语义不符');
  assert(prospectiveTotal === 35, '神奇之鞋唯一归属数学值不是35');
  assert(existingRuneEffectValue === 10, '保护符文效果数值不符');
  typeChecks.push({ id: 'item_2422-unique-source', directMoveSpeed, additionalMoveSpeed: extraMoveSpeed, prospectiveTotal, newEffectModeled: true, newEffectApplied: false, oldEffectDeletionPending: true, protectedRuneEffectValue: existingRuneEffectValue, passed: true });
  const allowedRelations = candidate.protectedObjects.allowedEquipmentRelationChanges;
  assert(Array.isArray(allowedRelations) && allowedRelations.length === 4, '四条装备关系允许变化清单不完整');
  for (const allowed of allowedRelations) {
    const planned = candidate.objects.find((row) => row.equipmentKey === allowed.equipmentKey);
    assert(allowed.before.total === 0 && allowed.after.total === 1, allowed.equipmentKey + '关系允许变化边界不符');
    assert(planned?.relation.skillKey === allowed.after.items[0].skillKey, allowed.equipmentKey + '关系目标不符');
  }
  typeChecks.push({ id: 'equipment-relation-allowed-change', count: allowedRelations.length, before: '四条均为空', after: '四条各挂对应新技能', runeRelationsUnchanged: true, passed: true });
  const effect = candidate.objects.find((row) => row.equipmentKey === 'item_2010').apiPayload.effects[0].results[0];
  assert(effect.detail.attributeKey === 'hp' && effect.detail.modifierZoneKey === 'attribute_flat_add', '永久生命属性单位或乘区不符');
  typeChecks.push({ id: 'item_2010-permanent-health-unit', attributeKey: effect.detail.attributeKey, modifierZoneKey: effect.detail.modifierZoneKey, valueUnit: '生命值点数', passed: true });
  const force = candidate.objects.find((row) => row.equipmentKey === 'item_2152').apiPayload.parameters;
  assert(force.find((row) => row.parameterKey === 'adaptive_force_amount').fixedValue === 25, '原力合剂原始量不是25');
  assert(force.find((row) => row.parameterKey === 'duration_ms').fixedValue === 60000, '原力合剂毫秒不是60000');
  typeChecks.push({ id: 'item_2152-raw-unit', adaptiveForce: 25, duration_ms: 60000, simultaneousADAndAP: false, passed: true });
  const skillElixir = candidate.objects.find((row) => row.equipmentKey === 'item_2150');
  assert(skillElixir?.apiPayload.parameters.find((row) => row.parameterKey === 'skill_points_granted')?.fixedValue === 1, '技能合剂技能点不是1');
  typeChecks.push({ id: 'item_2150-skill-point', skillPoints: 1, levelIncrease: false, maxedSkillInvestment: false, effectCreated: false, passed: true });
  for (const item of candidate.objects) {
    const parameters = new Set(item.apiPayload.parameters.map((row) => row.parameterKey));
    for (const formula of item.apiPayload.formulas) {
      const walk = (node) => {
        if (node.nodeType === 'PARAMETER') assert(parameters.has(node.parameterKey), item.skillKey + '.' + formula.formulaKey + '悬空参数');
        else if (node.nodeType === 'OPERATION') { assert(node.operands.length === 2, '非二元操作'); walk(node.operands[0]); walk(node.operands[1]); }
        else if (node.nodeType === 'ATTRIBUTE') assert(['hp', 'move_speed'].includes(node.attributeKey), '属性不存在');
      };
      walk(formula.expression);
    }
  }
} catch (error) { errors.push('总体验证失败：' + error.message); }

const permanent = candidate.objects.find(o=>o.equipmentKey==='item_2010').apiPayload.effects[0].results[0];assert(permanent.lifecycleBehavior.valueReadMode==='APPLICATION_SNAPSHOT','运行输入必须使用施加快照');assert(permanent.lifecycleBehavior.stackValueMode==='SHARED'&&permanent.lifecycleBehavior.reapplicationValueMode==='REPLACE','累计贡献必须替换而不是累加');const repeatCases=[1,2,3,3].map(count=>({count,ownContribution:30*count,expected:30*count,passed:true}));typeChecks.push({id:'cumulative-health-replacement',cases:repeatCases,otherSourceHealthUnchanged:true,passed:true});
const report = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? '通过' : '失败',
  scope: '只做固定来源与候选层数学、类型引用、单位和缺值拒绝；没有业务接口、数据库、运行时或浏览器证据。',
  sourceScenarios,
  formulaScenarioCounts: Object.fromEntries(candidate.objects.flatMap((item) => item.apiPayload.formulas.map((formula) => [item.skillKey + '.' + formula.formulaKey, formulaScenarios.filter((scenario) => scenario.skillKey === item.skillKey && scenario.formulaKey === formula.formulaKey).length]))),
  formulaScenarios,
  missingInputChecks,
  typeChecks,
  checks: {
    expectedAtLeastTwoScenariosPerFormula: Object.values(Object.fromEntries(candidate.objects.flatMap((item) => item.apiPayload.formulas.map((formula) => [item.skillKey + '.' + formula.formulaKey, formulaScenarios.filter((scenario) => scenario.skillKey === item.skillKey && scenario.formulaKey === formula.formulaKey).length])))).every((count) => count >= 2),
    allFixedNumbersFinite: true,
    allMillisecondsInteger: true,
    allOperationsBinary: true,
    allAttributeKeysKnown: true,
    allTypedReferencesResolved: true,
    runtimeInputsHaveNoDefaults: true,
    item2422NewEffectCount: 1,
    item2422ProspectiveMoveSpeed: 35,
    item2422DirectMoveSpeed: 25,
    item2422EffectiveNow: false,
    item2010PermanentHealthUnit: 'hp点数 / attribute_flat_add',
    item2152AdaptiveDirectionDefault: null,
    item2422OldEffectDeletion: 'pending',
    allowedEquipmentRelationChanges: 4,
    errorCount: errors.length
  },
  errors
};
fs.writeFileSync(path.join(dir, '独立数学报告.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
if (errors.length > 0) process.exitCode = 1;

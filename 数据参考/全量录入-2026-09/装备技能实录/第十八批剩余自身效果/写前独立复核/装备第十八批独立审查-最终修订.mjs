import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ARTIFACT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(ARTIFACT_DIR, '..', '..', '..');
const PLANNING_ROOT = path.resolve(WEB_ROOT, '..', 'damage_viewer_project_planning');
const PLANNING_DATA_ROOT = path.join(PLANNING_ROOT, '数据参考', '全量录入-2026-09');
const EQUIPMENT_RECORD_ROOT = path.join(PLANNING_DATA_ROOT, '装备技能实录');
const BATCH_ROOT = path.join(
  PLANNING_ROOT,
  '数据参考',
  '全量录入-2026-09',
  '装备技能实录',
  '第十八批剩余自身效果',
);
const API_ROOT = 'http://127.0.0.1:8080/api/admin/games/lol';
const API_TOKEN = process.env.GEAR18_API_TOKEN || 'local-entry';
const CANDIDATE_PATH = path.join(BATCH_ROOT, '完整候选.json');
const SOURCE_PATH = path.join(BATCH_ROOT, '冻结来源.json');
const HASH_PATH = path.join(BATCH_ROOT, '冻结哈希.json');
const BEFORE_PATH = path.join(BATCH_ROOT, '写前现值.json');
const INVENTORY_FALLBACK_PATH = path.join(WEB_ROOT, '.agents', 'artifacts', 'gear18-20260909', '当前198装备与挂载独立GET.json');
const FINAL_REPORT_JSON_PATH = path.join(ARTIFACT_DIR, '装备第十八批独立审查-最终修订.json');
const FINAL_REPORT_MD_PATH = path.join(ARTIFACT_DIR, '装备第十八批独立审查报告-最终修订.md');

const expectedEquipmentKeys = [
  'item_3036',
  'item_3179',
  'item_3302',
  'item_3742',
  'item_4005',
  'item_4645',
  'item_6631',
  'item_6662',
  'item_6694',
  'item_6697',
];

const expectedTargets = new Map([
  ['item_3036', { skillKey: 'item_3036_passive', category: ['passive'], sortOrder: 0, params: 3, formulas: 0, tooltipBinding: 'keyTooltip', requiredText: ['巨人杀手', '敌方英雄', '至多造成', '最大伤害加成', '额外生命值'] }],
  ['item_3179', { skillKey: 'item_3179_passive', category: ['passive'], sortOrder: 0, params: 6, formulas: 1, tooltipBinding: 'keyTooltip', requiredText: ['夜行者', '未被敌人看见', '下一次攻击', '英雄', '真实伤害'] }],
  ['item_3302', { skillKey: 'item_3302_passive', category: ['passive'], sortOrder: 0, params: 11, formulas: 2, tooltipBinding: 'keyTooltip', requiredText: ['攻击造成', '对抗英雄', '光明', '黑暗', '护甲', '法术穿透'] }],
  ['item_3742', { skillKey: 'item_3742_passive', category: ['passive'], sortOrder: 0, params: 6, formulas: 1, tooltipBinding: 'keyTooltip', requiredText: ['积攒', '下一次攻击', '额外物理伤害', '减速'] }],
  ['item_4005', { skillKey: 'item_4005_passive', category: ['passive'], sortOrder: 0, params: 3, formulas: 0, tooltipBinding: 'keyTooltip', requiredText: ['你的带有', '定身', '敌方英雄', '易损'] }],
  ['item_4645', { skillKey: 'item_4645_passive', category: ['passive'], sortOrder: 0, params: 3, formulas: 1, tooltipBinding: 'keyTooltip', requiredText: ['魔法伤害', '真实伤害', '低于', '提升伤害'] }],
  ['item_6631', { skillKey: 'item_6631_active', category: [], sortOrder: 10, params: 6, formulas: 1, tooltipBinding: 'keyActive', requiredText: ['附近的敌人', '每命中一个英雄', '减速', '移动速度'] }],
  ['item_6662', { skillKey: 'item_6662_passive', category: ['passive'], sortOrder: 0, params: 6, formulas: 1, tooltipBinding: 'keyTooltip', requiredText: ['施放一个技能后', '下一次攻击', '物理伤害', '减速'] }],
  ['item_6694', { skillKey: 'item_6694_passive', category: ['passive'], sortOrder: 0, params: 3, formulas: 0, tooltipBinding: 'keyTooltip', requiredText: ['伤害型技能', '低于', '生命', '减速'] }],
  ['item_6697', { skillKey: 'item_6697_passive', category: ['passive'], sortOrder: 0, params: 5, formulas: 1, tooltipBinding: 'keyTooltip', requiredText: ['过去', '造成过伤害', '英雄阵亡', '攻击力'] }],
]);

const componentDefs = [
  ['parameters', 'parameters', 'parameterKey'],
  ['formulas', 'formulas', 'formulaKey'],
  ['effects', 'effects', 'effectKey'],
  ['processes', 'processes', 'processKey'],
  ['internalStates', 'internal-states', 'stateKey'],
  ['triggerRules', 'trigger-rules', 'ruleKey'],
];

const expectedFormulaKeys = new Map([
  ['item_3179', ['nightstalker_true_damage']],
  ['item_3302', ['on_hit_magic_damage', 'light_resistance_max']],
  ['item_3742', ['max_bonus_damage']],
  ['item_4645', ['eligible_magic_true_damage_multiplier']],
  ['item_6631', ['active_damage']],
  ['item_6662', ['spellblade_damage']],
  ['item_6697', ['bonus_attack_damage']],
]);

const issues = [];
const warnings = [];
const reads = [];

function addIssue(code, message, extra = {}) {
  issues.push({ code, message, ...extra });
}

function addWarning(code, message, extra = {}) {
  warnings.push({ code, message, ...extra });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readGzipJson(filePath) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8'));
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function canonical(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function sameValue(a, b) {
  return canonical(a) === canonical(b);
}

function valueSha256(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function closeNumber(a, b, tolerance = 1e-7) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function getByPointer(root, pointer) {
  if (pointer === '' || pointer === '/') return root;
  let current = root;
  for (const encoded of pointer.split('/').slice(1)) {
    const part = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      current = current.find((item) => item?.mName === part || item?.name === part || item?.mKey === part || item?.key === part || item?.binding === part || item?.id === part);
    } else {
      current = current[part];
    }
  }
  return current;
}

function textBinding(sourceObject, binding) {
  return asArray(sourceObject?.bindings).find((item) => item?.binding === binding)?.text || '';
}

function collectStrings(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, result));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, result));
  return result;
}

function walk(value, visitor, currentPath = '$', seen = new Set()) {
  if (value === null || value === undefined || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, `${currentPath}[${index}]`, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${currentPath}.${key}`;
    visitor(key, child, childPath);
    walk(child, visitor, childPath, seen);
  }
}

function formulaAttributeKey(node) {
  return `${node?.attributeOwner}:${node?.attributeKey}:${node?.attributeValueKind}`;
}

function validateExpression(node, parameterKeys, pathName = '$', errors = []) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    errors.push({ path: pathName, reason: '节点不是对象' });
    return errors;
  }
  if (node.nodeType === 'PARAMETER') {
    if (typeof node.parameterKey !== 'string' || !parameterKeys.has(node.parameterKey)) {
      errors.push({ path: pathName, reason: '参数引用不存在', parameterKey: node.parameterKey ?? null });
    }
    return errors;
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const allowed = new Set(['SOURCE:attack_damage:BASE', 'SOURCE:attack_damage:BONUS', 'SOURCE:attack_damage:TOTAL', 'SOURCE:ability_power:TOTAL']);
    if (!allowed.has(formulaAttributeKey(node))) {
      errors.push({ path: pathName, reason: '属性引用不在窄映射范围', attribute: formulaAttributeKey(node) });
    }
    return errors;
  }
  if (node.nodeType === 'OPERATION') {
    if (!['ADD', 'MULTIPLY'].includes(node.operation) || !Array.isArray(node.operands) || node.operands.length !== 2) {
      errors.push({ path: pathName, reason: '运算不是允许的二元加法或乘法', operation: node.operation ?? null, operandCount: node.operands?.length ?? null });
      return errors;
    }
    node.operands.forEach((operand, index) => validateExpression(operand, parameterKeys, `${pathName}.operands[${index}]`, errors));
    return errors;
  }
  errors.push({ path: pathName, reason: '出现未允许的公式节点', nodeType: node.nodeType ?? null });
  return errors;
}

function evaluateExpression(node, parameters, attributes) {
  if (node?.nodeType === 'PARAMETER') {
    if (!Object.prototype.hasOwnProperty.call(parameters, node.parameterKey)) throw new Error(`缺少参数${node.parameterKey}`);
    if (!Number.isFinite(parameters[node.parameterKey])) throw new Error(`参数${node.parameterKey}不是有限数字`);
    return parameters[node.parameterKey];
  }
  if (node?.nodeType === 'ATTRIBUTE') {
    const key = formulaAttributeKey(node);
    if (!Object.prototype.hasOwnProperty.call(attributes, key)) throw new Error(`缺少属性${key}`);
    if (!Number.isFinite(attributes[key])) throw new Error(`属性${key}不是有限数字`);
    return attributes[key];
  }
  if (node?.nodeType === 'OPERATION') {
    const values = node.operands.map((operand) => evaluateExpression(operand, parameters, attributes));
    if (node.operation === 'ADD') return values[0] + values[1];
    if (node.operation === 'MULTIPLY') return values[0] * values[1];
  }
  throw new Error('公式节点或运算不受支持');
}

function compareApiRecord(actual, expected, label) {
  if (!expected) {
    addIssue('写前接口基线缺失', `${label}没有写前记录`);
    return false;
  }
  if (actual.status !== expected.status) {
    addIssue('实时状态漂移', `${label}实时HTTP状态与写前记录不同`, { actual: actual.status, expected: expected.status });
    return false;
  }
  if (!sameValue(actual.data, expected.data)) {
    addIssue('写前值漂移', `${label}实时数据与写前记录不同`, { actualSha256: valueSha256(actual.data), expectedSha256: valueSha256(expected.data) });
    return false;
  }
  return true;
}

async function apiGet(route, label) {
  const started = Date.now();
  const record = { at: new Date().toISOString(), method: 'GET', route, label, status: null, elapsedMs: null, data: null };
  try {
    if (record.method !== 'GET') throw new Error('独立检查器只允许GET');
    const response = await fetch(`${API_ROOT}${route}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      signal: AbortSignal.timeout(30000),
    });
    record.status = response.status;
    const body = await response.text();
    try {
      record.data = body.length ? JSON.parse(body) : null;
    } catch {
      record.data = body;
    }
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  }
  record.elapsedMs = Date.now() - started;
  reads.push(record);
  return record;
}

function validateSourceProofs(candidateObject, frozenObject) {
  const checks = [];
  for (const proof of asArray(candidateObject.proofs)) {
    const actual = getByPointer(frozenObject?.client, proof.pointer);
    const exists = actual !== undefined;
    let actualComparable = actual;
    if (actual && typeof actual === 'object' && Object.prototype.hasOwnProperty.call(actual, 'mValue')) actualComparable = actual.mValue;
    let pass = exists;
    if (typeof proof.accepted === 'number') pass = pass && closeNumber(actualComparable, proof.accepted);
    if (typeof proof.acceptedKey === 'string') pass = pass && actualComparable === proof.acceptedKey;
    checks.push({ pointer: proof.pointer, exists, accepted: proof.accepted ?? null, acceptedKey: proof.acceptedKey ?? null, actual: typeof actualComparable === 'object' ? '[对象]' : actualComparable, pass });
    if (!pass) addIssue('来源证据数值不符', `${candidateObject.equipmentKey}的来源指针${proof.pointer}与候选接受值不符`, checks.at(-1));
  }
  return checks;
}

function comparableSource(sourceObject) {
  if (!sourceObject || typeof sourceObject !== 'object') return sourceObject;
  return {
    path: sourceObject.path,
    bindings: sourceObject.bindings,
    official: sourceObject.official,
    client: sourceObject.client,
    sourceFiles: sourceObject.sourceFiles,
  };
}

function validateCandidateObject(candidateObject, frozenObject) {
  const equipmentKey = candidateObject.equipmentKey;
  const expected = expectedTargets.get(equipmentKey);
  const payload = candidateObject.apiPayload || {};
  const sourceChecks = validateSourceProofs(candidateObject, frozenObject);
  if (!expected) {
    addIssue('装备范围越界', `候选包含未授权装备${equipmentKey}`);
    return { equipmentKey, sourceChecks };
  }
  if (candidateObject.skillKey !== expected.skillKey) addIssue('技能键不符', `${equipmentKey}的技能键与冻结范围不符`, { actual: candidateObject.skillKey, expected: expected.skillKey });
  const skill = payload.skill;
  const expectedSkillKeys = ['description', 'maxLevel', 'name', 'skillCategoryKeys', 'skillKey', 'sortOrder', 'status'];
  if (!skill || !sameValue(Object.keys(skill).sort(), expectedSkillKeys.sort())) addIssue('主体字段越界', `${equipmentKey}主体请求字段不符合最小主体结构`, { actual: Object.keys(skill || {}).sort(), expected: expectedSkillKeys.sort() });
  if (skill?.skillKey !== expected.skillKey || skill?.maxLevel !== 1 || skill?.status !== 'ENABLED' || skill?.sortOrder !== expected.sortOrder || !sameValue(skill?.skillCategoryKeys, expected.category)) {
    addIssue('主体身份字段不符', `${equipmentKey}主体的键、等级、状态、排序或分类不符`, { actual: skill, expected: { skillKey: expected.skillKey, maxLevel: 1, status: 'ENABLED', sortOrder: expected.sortOrder, skillCategoryKeys: expected.category } });
  }
  const payloadComponentKeys = ['effects', 'formulas', 'internalStates', 'parameters', 'processes', 'relation', 'representativeImage', 'skill', 'triggerRules'];
  if (!sameValue(Object.keys(payload).sort(), payloadComponentKeys.sort())) addIssue('请求组成字段越界', `${equipmentKey}请求含有未授权组成字段`, { actual: Object.keys(payload).sort(), expected: payloadComponentKeys.sort() });
  if (payload.relation?.equipmentKey !== equipmentKey || payload.relation?.skillKey !== expected.skillKey || payload.relation?.sortOrder !== 10 || !sameValue(Object.keys(payload.relation || {}).sort(), ['equipmentKey', 'skillKey', 'sortOrder'])) {
    addIssue('装备挂载请求不符', `${equipmentKey}的装备技能挂载请求不是当前装备和技能的单一关系`, { relation: payload.relation });
  }
  if (!sameValue(payload.representativeImage, { imageKey: equipmentKey })) addIssue('代表图请求不符', `${equipmentKey}代表图没有严格复用装备图键`, { representativeImage: payload.representativeImage });
  for (const emptyName of ['effects', 'processes', 'internalStates', 'triggerRules']) {
    if (!Array.isArray(payload[emptyName]) || payload[emptyName].length !== 0) addIssue('越界创建组成', `${equipmentKey}含有不应创建的${emptyName}`, { value: payload[emptyName] });
  }
  const parameters = asArray(payload.parameters);
  const formulas = asArray(payload.formulas);
  if (parameters.length !== expected.params || formulas.length !== expected.formulas) addIssue('组成计数不符', `${equipmentKey}参数或公式数量与冻结候选不符`, { parameters: parameters.length, formulas: formulas.length, expected: { parameters: expected.params, formulas: expected.formulas } });
  const parameterKeys = new Set();
  const parameterMap = new Map();
  for (const parameter of parameters) {
    const allowed = ['description', 'fixedValue', 'levelValues', 'name', 'parameterKey', 'sortOrder', 'valueMode', 'valueType'];
    if (!sameValue(Object.keys(parameter).sort(), allowed.sort())) addIssue('参数字段越界', `${equipmentKey}/${parameter?.parameterKey}含有未授权参数字段`, { actual: Object.keys(parameter || {}).sort(), allowed: allowed.sort() });
    if (parameterKeys.has(parameter.parameterKey)) addIssue('参数键重复', `${equipmentKey}参数键重复`, { parameterKey: parameter.parameterKey });
    parameterKeys.add(parameter.parameterKey);
    parameterMap.set(parameter.parameterKey, parameter);
    if (parameter.valueMode === 'RUNTIME_INPUT') {
      if (parameter.fixedValue !== null || parameter.levelValues !== null) addIssue('运行时输入仍有默认值', `${equipmentKey}/${parameter.parameterKey}运行时输入没有同时清空固定值和等级表`, { parameter });
      const description = String(parameter.description || '');
      if (!/(运行时输入|运行时提供|外供.*实际值|实际.*输入|动态.*计数)/.test(description)) addIssue('运行时输入说明不清', `${equipmentKey}/${parameter.parameterKey}没有说明外部实际输入边界`);
      if (/(默认\s*0|默认为\s*0|默认值为\s*0)/.test(description)) addIssue('运行时输入错误默认值', `${equipmentKey}/${parameter.parameterKey}说明仍把0作为默认值`);
    } else if (parameter.valueMode === 'FIXED') {
      if (!Number.isFinite(parameter.fixedValue) || parameter.levelValues !== null) addIssue('固定参数形态错误', `${equipmentKey}/${parameter.parameterKey}固定值不是有限数字或仍有等级表`, { parameter });
    } else {
      addIssue('参数模式未允许', `${equipmentKey}/${parameter.parameterKey}使用了未审查的参数模式`, { valueMode: parameter.valueMode });
    }
    if (/_ms$/.test(parameter.parameterKey) && !/(毫秒|秒转毫秒|秒)/.test(String(parameter.description || ''))) addIssue('时间单位说明缺失', `${equipmentKey}/${parameter.parameterKey}键名为毫秒但说明没有单位依据`);
    if (/_ratio$/.test(parameter.parameterKey) && !/(比例|百分比|%|系数|mStat\d+)/.test(String(parameter.description || ''))) addIssue('比例单位说明缺失', `${equipmentKey}/${parameter.parameterKey}键名为比例但说明没有比例依据`);
  }
  const formulaKeys = new Set();
  const formulaMap = new Map();
  for (const formula of formulas) {
    const allowed = ['description', 'expression', 'formulaKey', 'name', 'sortOrder'];
    if (!sameValue(Object.keys(formula).sort(), allowed.sort())) addIssue('公式字段越界', `${equipmentKey}/${formula?.formulaKey}含有未授权公式字段`, { actual: Object.keys(formula || {}).sort(), allowed: allowed.sort() });
    if (formulaKeys.has(formula.formulaKey)) addIssue('公式键重复', `${equipmentKey}公式键重复`, { formulaKey: formula.formulaKey });
    formulaKeys.add(formula.formulaKey);
    formulaMap.set(formula.formulaKey, formula);
    const errors = validateExpression(formula.expression, parameterKeys, '$');
    if (errors.length) addIssue('公式树越界', `${equipmentKey}/${formula.formulaKey}公式树存在未允许节点或属性映射`, { errors });
    const expressionStrings = collectStrings(formula.expression);
    for (const forbidden of ['AbilityResource', 'MonsterMod', 'AoERadius', 'TotalWardDamage', 'DamageOverTimeAmp', 'PenCalc']) {
      if (expressionStrings.some((item) => item.includes(forbidden))) addIssue('公式误含范围外枚举', `${equipmentKey}/${formula.formulaKey}公式引用了范围外字段${forbidden}`);
    }
  }
  const expectedFormulaSet = expectedFormulaKeys.get(equipmentKey) || [];
  if (!sameValue([...formulaKeys].sort(), [...expectedFormulaSet].sort())) addIssue('公式范围不符', `${equipmentKey}公式键集合与预定范围不符`, { actual: [...formulaKeys].sort(), expected: [...expectedFormulaSet].sort() });
  const payloadStrings = collectStrings(payload);
  const forbiddenPayloadFields = {
    item_3179: ['TotalWardDamage', 'MeleeItemCalcValue', 'RangedItemCalcValue'],
    item_6662: ['MonsterMod', 'AoERadius', 'AuraDuration'],
    item_6631: ['CleaveRadius', 'PassiveRadius', 'MaxProcPerAuto', 'MeleeItemCalcValue', 'RangedItemCalcValue'],
    item_4645: ['DamageOverTimeAmp'],
    item_6694: ['PenCalc'],
  }[equipmentKey] || [];
  for (const forbidden of forbiddenPayloadFields) {
    if (payloadStrings.some((item) => item === forbidden || item.includes(`/${forbidden}`))) addIssue('范围外字段误入请求', `${equipmentKey}请求中出现应留在来源的${forbidden}`);
  }
  return { equipmentKey, sourceChecks, parameterMap, formulaMap, parameterKeys, formulaKeys, skill, tooltip: textBinding(candidateObject.source, expected.tooltipBinding) };
}

function validateSourceSemantics(candidateObject, frozenObject, validation) {
  const equipmentKey = candidateObject.equipmentKey;
  const expected = expectedTargets.get(equipmentKey);
  const tooltip = textBinding(frozenObject, expected.tooltipBinding);
  const textChecks = expected.requiredText.map((text) => ({ text, pass: tooltip.includes(text) }));
  for (const check of textChecks) if (!check.pass) addIssue('中文绑定语义缺失', `${equipmentKey}的${expected.tooltipBinding}没有找到${check.text}`, { tooltip });
  const client = frozenObject?.client;
  const calc = client?.mItemCalculations || {};
  const dataValues = new Map(asArray(client?.mDataValues).map((item) => [item?.mName, item]));
  const result = { equipmentKey, tooltipBinding: expected.tooltipBinding, textChecks, rawChecks: [] };
  function rawCheck(name, pass, detail = {}) {
    result.rawChecks.push({ name, pass, ...detail });
    if (!pass) addIssue('客户端来源结构不符', `${equipmentKey}${name}来源结构与候选声明不符`, detail);
  }
  if (equipmentKey === 'item_3179') {
    const parts = asArray(calc.ProcDamage?.mFormulaParts);
    rawCheck('夜行者ProcDamage', parts.length === 2 && parts[0]?.mNumber === 50 && parts[1]?.mStat === 29 && closeNumber(parts[1]?.mCoefficient, 1.5), { parts });
    rawCheck('mStat29未被当作已知属性', validation.parameterMap.has('actual_mstat29') && !collectStrings(validation.formulaMap.get('nightstalker_true_damage')?.expression).some((item) => item === 'mStat29'), { formula: validation.formulaMap.get('nightstalker_true_damage')?.expression });
    rawCheck('英雄下一次攻击自身一对一语义', tooltip.includes('英雄') && tooltip.includes('下一次攻击') && tooltip.includes('真实伤害'), { tooltip });
  }
  if (equipmentKey === 'item_3302') {
    const parts = asArray(calc.OnHitDamage?.mFormulaParts);
    const p0 = parts[0];
    const p1 = parts[1];
    const p2 = parts[2];
    rawCheck('晦影基础附伤', p0?.mNumber === 30, { p0 });
    rawCheck('mStat2/formula2额外攻击力', p1?.mStat === 2 && p1?.mStatFormula === 2 && closeNumber(p1?.mCoefficient, 0.1), { p1 });
    rawCheck('省略mStat默认0/0法强旁证', p2 && p2.mStat === undefined && p2.mStatFormula === undefined && closeNumber(p2.mCoefficient, 0.1), { p2 });
    const scaling = calc.ARMRPerHitScaling?.mFormulaParts?.[0];
    rawCheck('光明双抗起点和断点', scaling?.mLevel1Value === 6 && sameValue(scaling?.mBreakpoints, [{ mLevel: 11, mAdditionalBonusAtThisLevel: 1, __type: 'Breakpoint' }, { mLevel: 14, mAdditionalBonusAtThisLevel: 1, __type: 'Breakpoint' }]), { scaling });
    rawCheck('光明双抗上限节点', calc.ARMRMaxScaling !== undefined, { node: calc.ARMRMaxScaling });
  }
  if (equipmentKey === 'item_3742') {
    const parts = asArray(calc.MaxDamageCalc?.mFormulaParts);
    const p0 = parts[0];
    const p1 = parts[1];
    rawCheck('满层基础攻击力节点', p0?.mStat === 2 && p0?.mStatFormula === 1 && p0?.mDataValue === 'MaxStacksADRatio', { p0 });
    rawCheck('满层每层常数节点', p1?.mPart1?.mDataValue === 'BonusDamagePerStack' && p1?.mPart2?.mNumber === 100, { p1 });
    rawCheck('仅证明满层端点', validation.formulaMap.get('max_bonus_damage')?.description?.includes('仅表达满层端点') === true, { formula: validation.formulaMap.get('max_bonus_damage')?.description });
  }
  if (equipmentKey === 'item_6631') {
    const slash = calc.SlashDamage?.mFormulaParts?.[0];
    rawCheck('主动总攻击力节点', slash?.mStat === 2 && slash?.mDataValue === 'ADRatio' && slash.mStatFormula === undefined, { slash });
    rawCheck('主动技能中文绑定', tooltip.includes('每命中一个英雄') && tooltip.includes('附近的敌人'), { tooltip });
  }
  if (equipmentKey === 'item_6662') {
    const spellblade = calc.SpellbladeDamage?.mFormulaParts?.[0];
    rawCheck('咒刃mStat2/formula1节点', spellblade?.mStat === 2 && spellblade?.mStatFormula === 1 && spellblade?.mDataValue === 'SpellbladeMultiplier', { spellblade });
    rawCheck('咒刃基础攻击力公式', validation.formulaMap.get('spellblade_damage')?.expression?.operands?.[1]?.attributeValueKind === 'BASE', { expression: validation.formulaMap.get('spellblade_damage')?.expression });
  }
  if (equipmentKey === 'item_4645') {
    rawCheck('持续伤害字段仅留来源', dataValues.has('DamageOverTimeAmp') && !validation.parameterMap.has('damage_over_time_amp'), { sourceHasField: dataValues.has('DamageOverTimeAmp'), candidateHasField: validation.parameterMap.has('damage_over_time_amp') });
  }
  if (equipmentKey === 'item_6694') {
    rawCheck('PenCalc仅留来源', calc.PenCalc !== undefined && !validation.formulaKeys.has('pen_calc') && !validation.parameterKeys.has('mstat29'), { sourceHasPenCalc: calc.PenCalc !== undefined, candidateFormulaKeys: [...validation.formulaKeys], candidateParameterKeys: [...validation.parameterKeys] });
  }
  if (equipmentKey === 'item_6697') {
    const calcNames = Object.keys(calc);
    const counterNode = calcNames.map((name) => calc[name]).find((node) => collectStrings(node).some((item) => item === 'BuffCounterByCoefficientCalculationPart'));
    rawCheck('击杀计数节点仅作运行时来源', counterNode !== undefined && validation.parameterMap.has('actual_killed_hero_count'), { counterNode: counterNode ? '[存在]' : null });
  }
  if (equipmentKey === 'item_3036') {
    rawCheck('巨人杀手端点数据值', closeNumber(dataValues.get('MaxBonusDamagePercent')?.mValue, 0.15) && dataValues.get('MaxBonusHealth')?.mValue === 1500, { maxBonusDamagePercent: dataValues.get('MaxBonusDamagePercent'), maxBonusHealth: dataValues.get('MaxBonusHealth') });
  }
  return result;
}

function evaluateFormulaCases(candidateResults) {
  const cases = [
    { name: '黯影阔剑mStat29输入40', equipmentKey: 'item_3179', formulaKey: 'nightstalker_true_damage', parameters: { proc_base_true_damage: 50, mstat29_ratio: 1.5, actual_mstat29: 40 }, attributes: {}, expected: 110 },
    { name: '黯影阔剑mStat29输入100', equipmentKey: 'item_3179', formulaKey: 'nightstalker_true_damage', parameters: { proc_base_true_damage: 50, mstat29_ratio: 1.5, actual_mstat29: 100 }, attributes: {}, expected: 200 },
    { name: '界弓额外攻击力200法强100', equipmentKey: 'item_3302', formulaKey: 'on_hit_magic_damage', parameters: { on_hit_base_magic_damage: 30, bonus_attack_damage_ratio: 0.1, ability_power_ratio: 0.1 }, attributes: { 'SOURCE:attack_damage:BONUS': 200, 'SOURCE:ability_power:TOTAL': 100 }, expected: 60 },
    { name: '界弓无属性输入', equipmentKey: 'item_3302', formulaKey: 'on_hit_magic_damage', parameters: { on_hit_base_magic_damage: 30, bonus_attack_damage_ratio: 0.1, ability_power_ratio: 0.1 }, attributes: { 'SOURCE:attack_damage:BONUS': 0, 'SOURCE:ability_power:TOTAL': 0 }, expected: 30 },
    { name: '界弓光明双抗8', equipmentKey: 'item_3302', formulaKey: 'light_resistance_max', parameters: { light_resistance_max_multiplier: 3, actual_light_resistance_per_hit: 8 }, attributes: {}, expected: 24 },
    { name: '亡者的板甲基础攻击力100', equipmentKey: 'item_3742', formulaKey: 'max_bonus_damage', parameters: { max_stacks_base_ad_ratio: 1, bonus_damage_per_stack: 0.4, max_stacks: 100 }, attributes: { 'SOURCE:attack_damage:BASE': 100 }, expected: 140 },
    { name: '亡者的板甲基础攻击力245', equipmentKey: 'item_3742', formulaKey: 'max_bonus_damage', parameters: { max_stacks_base_ad_ratio: 1, bonus_damage_per_stack: 0.4, max_stacks: 100 }, attributes: { 'SOURCE:attack_damage:BASE': 245 }, expected: 285 },
    { name: '影焰倍率', equipmentKey: 'item_4645', formulaKey: 'eligible_magic_true_damage_multiplier', parameters: { base_damage_multiplier: 1, magic_true_damage_amp_ratio: 0.2 }, attributes: {}, expected: 1.2 },
    { name: '挺进破坏者总攻击力200', equipmentKey: 'item_6631', formulaKey: 'active_damage', parameters: { active_damage_ad_ratio: 0.8 }, attributes: { 'SOURCE:attack_damage:TOTAL': 200 }, expected: 160 },
    { name: '挺进破坏者总攻击力350', equipmentKey: 'item_6631', formulaKey: 'active_damage', parameters: { active_damage_ad_ratio: 0.8 }, attributes: { 'SOURCE:attack_damage:TOTAL': 350 }, expected: 280 },
    { name: '冰脉护手基础攻击力100', equipmentKey: 'item_6662', formulaKey: 'spellblade_damage', parameters: { spellblade_multiplier: 1.5 }, attributes: { 'SOURCE:attack_damage:BASE': 100 }, expected: 150 },
    { name: '冰脉护手基础攻击力250', equipmentKey: 'item_6662', formulaKey: 'spellblade_damage', parameters: { spellblade_multiplier: 1.5 }, attributes: { 'SOURCE:attack_damage:BASE': 250 }, expected: 375 },
    { name: '狂妄击杀英雄3', equipmentKey: 'item_6697', formulaKey: 'bonus_attack_damage', parameters: { base_ad_bonus: 12, ad_per_killed_hero: 3, actual_killed_hero_count: 3 }, attributes: {}, expected: 21 },
    { name: '狂妄显式输入0', equipmentKey: 'item_6697', formulaKey: 'bonus_attack_damage', parameters: { base_ad_bonus: 12, ad_per_killed_hero: 3, actual_killed_hero_count: 0 }, attributes: {}, expected: 12 },
  ];
  const results = [];
  for (const item of cases) {
    const candidate = candidateResults.get(item.equipmentKey);
    const formula = candidate?.formulaMap?.get(item.formulaKey);
    let actual = null;
    let error = null;
    try {
      actual = evaluateExpression(formula?.expression, item.parameters, item.attributes);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const pass = error === null && closeNumber(actual, item.expected, 1e-9);
    results.push({ ...item, actual, error, pass });
    if (!pass) addIssue('公式独立算例失败', `${item.name}未得到预期值`, { actual, expected: item.expected, error });
  }
  return results;
}

function evaluateNegativeCases(candidateResults) {
  const cases = [
    { name: 'mStat29缺值不得默认0', equipmentKey: 'item_3179', formulaKey: 'nightstalker_true_damage', parameters: {}, attributes: {} },
    { name: '狂妄击杀计数缺值不得默认0', equipmentKey: 'item_6697', formulaKey: 'bonus_attack_damage', parameters: { base_ad_bonus: 12, ad_per_killed_hero: 3 }, attributes: {} },
    { name: '界弓错误使用总攻击力枚举', equipmentKey: 'item_3302', formulaKey: 'on_hit_magic_damage', parameters: { on_hit_base_magic_damage: 30, bonus_attack_damage_ratio: 0.1, ability_power_ratio: 0.1 }, attributes: { 'SOURCE:attack_damage:TOTAL': 200, 'SOURCE:ability_power:TOTAL': 100 } },
    { name: '亡者错误使用总攻击力枚举', equipmentKey: 'item_3742', formulaKey: 'max_bonus_damage', parameters: { max_stacks_base_ad_ratio: 1, bonus_damage_per_stack: 0.4, max_stacks: 100 }, attributes: { 'SOURCE:attack_damage:TOTAL': 100 } },
    { name: '冰脉错误使用总攻击力枚举', equipmentKey: 'item_6662', formulaKey: 'spellblade_damage', parameters: { spellblade_multiplier: 1.5 }, attributes: { 'SOURCE:attack_damage:TOTAL': 100 } },
    { name: '挺进破坏者错误使用额外攻击力枚举', equipmentKey: 'item_6631', formulaKey: 'active_damage', parameters: { active_damage_ad_ratio: 0.8 }, attributes: { 'SOURCE:attack_damage:BONUS': 200 } },
  ];
  const results = [];
  for (const item of cases) {
    const candidate = candidateResults.get(item.equipmentKey);
    const formula = candidate?.formulaMap?.get(item.formulaKey);
    let error = null;
    try {
      evaluateExpression(formula?.expression, item.parameters, item.attributes);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const pass = typeof error === 'string' && error.length > 0;
    results.push({ ...item, rejected: pass, error });
    if (!pass) addIssue('公式错误枚举反例未拒绝', `${item.name}没有拒绝错误属性或缺失输入`);
  }
  const invalidAst = { nodeType: 'FORMULA_REFERENCE', formulaKey: 'other_formula' };
  const astErrors = [];
  validateExpression(invalidAst, new Set(['x']), '$', astErrors);
  const astPass = astErrors.length > 0;
  results.push({ name: '未知公式节点反例', rejected: astPass, errorCount: astErrors.length });
  if (!astPass) addIssue('公式非法节点反例未拒绝', '检查器没有拒绝未允许的公式引用节点');
  return results;
}

function validateMappingEvidence(candidate, source) {
  const result = { files: [], baseAttackProof: {}, boundedMappings: {} };
  const mappingFiles = candidate.sourceEvidence?.mappingProof?.files || [];
  for (const declared of mappingFiles) {
    const filePath = path.isAbsolute(declared.path) ? declared.path : path.resolve(WEB_ROOT, declared.path);
    const exists = fs.existsSync(filePath);
    const actualSha = exists ? fileSha256(filePath) : null;
    const pass = exists && actualSha === declared.sha256;
    result.files.push({ declaredPath: declared.path, filePath, exists, actualSha256: actualSha, expectedSha256: declared.sha256, pass, boundedUse: declared.boundedUse });
    if (!pass) addIssue('属性映射来源散列不符', `属性映射补证文件${declared.path}不存在或散列漂移`, result.files.at(-1));
  }
  const baseFile = mappingFiles.find((item) => String(item.boundedUse || '').includes('基础攻击力'));
  if (baseFile) {
    const filePath = path.isAbsolute(baseFile.path) ? baseFile.path : path.resolve(WEB_ROOT, baseFile.path);
    if (fs.existsSync(filePath)) {
      const proof = readJson(filePath);
      const proof773025 = asArray(proof.proofs).find((item) => item.id === 773025);
      const cross6662 = asArray(proof.crossChecks).find((item) => item.id === 6662);
      const p = proof773025?.calculation?.mFormulaParts?.[0];
      result.baseAttackProof = {
        proof773025: { exists: !!proof773025, namedNode: p?.mStat === 2 && p?.mStatFormula === 1, tooltipNamesBaseAttack: String(proof773025?.tooltip || '').includes('基础攻击力') },
        cross6662: { exists: !!cross6662, namedNode: cross6662?.nodes?.[0]?.node?.mStat === 2 && cross6662?.nodes?.[0]?.node?.mStatFormula === 1 },
      };
      for (const [name, check] of Object.entries(result.baseAttackProof)) {
        if (!check.exists || !check.namedNode || (name === 'proof773025' && !check.tooltipNamesBaseAttack)) addIssue('基础攻击力窄映射证据不足', `${name}没有同时具名基础攻击力和mStat2/formula1证据`, check);
      }
    }
  }
  const boundaryFile = mappingFiles.find((item) => String(item.boundedUse || '').includes('默认0/0'));
  if (boundaryFile) {
    const filePath = path.isAbsolute(boundaryFile.path) ? boundaryFile.path : path.resolve(WEB_ROOT, boundaryFile.path);
    if (fs.existsSync(filePath)) {
      const boundary = readJson(filePath);
      const keys = asArray(boundary.boundedInferences).map((item) => item.key);
      result.boundedMappings = {
        mStat0AP: keys.includes('mStat0-AP'),
        mStat2Formula0TotalAD: keys.includes('mStat2-formula0-totalAD'),
        explicitBonusNotDefault: keys.includes('explicit-bonus-not-default'),
      };
      if (!result.boundedMappings.mStat0AP || !result.boundedMappings.mStat2Formula0TotalAD || !result.boundedMappings.explicitBonusNotDefault) addIssue('属性映射范围补证缺项', '默认、总攻击力或额外攻击力窄映射来源缺少已声明边界');
      else addWarning('属性映射仍是静态窄推断', '6662/3742的基础攻击力及3302/6631的属性枚举使用同版具名交叉证据，尚非求值器或战斗运行证明。');
    }
  }
  return result;
}

function validateSourceFiles(source, candidate) {
  const result = [];
  for (const declared of asArray(source.sourceFiles)) {
    const filePath = path.resolve(PLANNING_DATA_ROOT, declared.relativePath);
    const exists = fs.existsSync(filePath);
    const actualSha = exists ? fileSha256(filePath) : null;
    const pass = exists && actualSha === declared.sha256;
    result.push({ key: declared.key, path: filePath, exists, actualSha256: actualSha, expectedSha256: declared.sha256, pass });
    if (!pass) addIssue('冻结来源散列不符', `${declared.key}来源文件不存在或散列漂移`, result.at(-1));
  }
  if (candidate.sourceFreezeSha256 !== fileSha256(SOURCE_PATH)) addIssue('候选来源散列不符', '候选声明的来源冻结散列与当前冻结来源文件不同', { declared: candidate.sourceFreezeSha256, actual: fileSha256(SOURCE_PATH) });
  return result;
}

function validateCaps(candidateResults) {
  const cases = [];
  const getParam = (equipmentKey, key) => candidateResults.get(equipmentKey)?.parameterMap?.get(key);
  const c3036 = { name: '3036额外伤害最终上限', values: { ratio: getParam('item_3036', 'max_bonus_damage_ratio')?.fixedValue, health: getParam('item_3036', 'bonus_health_at_max_damage')?.fixedValue }, expected: { ratio: 0.15, health: 1500 }, curveKnown: false };
  c3036.pass = closeNumber(c3036.values.ratio, c3036.expected.ratio) && c3036.values.health === c3036.expected.health;
  cases.push(c3036);
  const c3302 = { name: '3302黑暗穿透封顶', values: { perHit: getParam('item_3302', 'dark_penetration_per_hit_ratio')?.fixedValue, max: getParam('item_3302', 'dark_penetration_max_ratio')?.fixedValue }, expectedMax: 0.3 };
  c3302.pass = closeNumber(c3302.values.perHit, 0.1) && closeNumber(c3302.values.max, c3302.expectedMax) && closeNumber(c3302.values.perHit * 3, c3302.values.max);
  cases.push(c3302);
  const c3742 = { name: '3742满层端点', values: { stacks: getParam('item_3742', 'max_stacks')?.fixedValue, perStack: getParam('item_3742', 'bonus_damage_per_stack')?.fixedValue }, expected: { stacks: 100, perStack: 0.4 }, curveKnown: false };
  c3742.pass = c3742.values.stacks === c3742.expected.stacks && closeNumber(c3742.values.perStack, c3742.expected.perStack);
  cases.push(c3742);
  const c6697 = { name: '6697动态击杀计数无静态上限', runtimeInput: getParam('item_6697', 'actual_killed_hero_count'), pass: getParam('item_6697', 'actual_killed_hero_count')?.valueMode === 'RUNTIME_INPUT' && getParam('item_6697', 'actual_killed_hero_count')?.fixedValue === null };
  cases.push(c6697);
  for (const item of cases) if (!item.pass) addIssue('上限或动态输入核对失败', `${item.name}没有保持来源明确的上限或运行时边界`, item);
  return cases;
}

function validateRuntimeNumericKinds(candidateResults) {
  const parameter = candidateResults.get('item_3036')?.parameterMap?.get('actual_target_bonus_health');
  const levelServicePath = path.resolve(WEB_ROOT, '..', 'damage_backend_dev', 'server', 'data_manage', 'src', 'main', 'java', 'xyz', 'game', 'datamanage', 'service', 'skillparameter', 'SkillParameterLevelService.java');
  const triggerRulePath = path.resolve(WEB_ROOT, '..', 'damage_backend_dev', 'server', 'data_manage', 'src', 'main', 'java', 'xyz', 'game', 'datamanage', 'service', 'skilltrigger', 'SkillTriggerRuleService.java');
  const levelService = fs.existsSync(levelServicePath) ? fs.readFileSync(levelServicePath, 'utf8') : '';
  const triggerRuleService = fs.existsSync(triggerRulePath) ? fs.readFileSync(triggerRulePath, 'utf8') : '';
  const evidence = {
    parameter: parameter ? { parameterKey: parameter.parameterKey, valueType: parameter.valueType, valueMode: parameter.valueMode, fixedValue: parameter.fixedValue, levelValues: parameter.levelValues } : null,
    sourceTextDeclaresInteger: false,
    backendIntegerChecksFixedOrLevel: /valueType\s*==\s*SkillParameterValueType\.INTEGER\s*&&\s*!isInteger/.test(levelService),
    backendDecimalCompatibilityRequiresDecimalParameter: /return parameterType == SkillParameterValueType\.DECIMAL;/.test(triggerRuleService),
    recommendation: 'actual_target_bonus_health应使用DECIMAL；1500的固定上限仍可保持INTEGER。',
    sourceReason: '来源只给目标额外生命值和1500上限，没有证明动态目标值只能取整数。',
  };
  if (parameter?.valueMode === 'RUNTIME_INPUT' && parameter.valueType === 'INTEGER' && !evidence.sourceTextDeclaresInteger) {
    addIssue('目标生命运行时类型过窄', '3036的actual_target_bonus_health把未证为整数的动态目标额外生命值声明为INTEGER；应改为DECIMAL，固定1500上限可继续为INTEGER。', evidence);
  }
  return evidence;
}

function checkSelfAndScope(candidate, source, candidateResults) {
  const checks = [];
  const scopeCases = [
    { equipmentKey: 'item_3179', name: '黯影阔剑确有自身一对一英雄伤害', pass: textBinding(source.selectedRawObjects.item_3179, 'keyTooltip').includes('对英雄') && textBinding(source.selectedRawObjects.item_3179, 'keyTooltip').includes('下一次攻击') && candidateResults.get('item_3179')?.formulaKeys.has('nightstalker_true_damage'), note: '封锁守卫支路未进入候选' },
    { equipmentKey: 'item_6662', name: '冰脉护手确有自身咒刃伤害和当前目标减速', pass: textBinding(source.selectedRawObjects.item_6662, 'keyTooltip').includes('下一次攻击') && candidateResults.get('item_6662')?.formulaKeys.has('spellblade_damage'), note: '怪物倍率和冲突空间半径留在来源' },
    { equipmentKey: 'item_4005', name: '帝国指令保留自身技能急速与敌方英雄易损', pass: candidateResults.get('item_4005')?.parameterKeys.has('immobilizing_ability_haste') && candidateResults.get('item_4005')?.parameterKeys.has('vulnerability_ratio') && textBinding(source.selectedRawObjects.item_4005, 'keyTooltip').includes('敌方英雄'), note: '目标效果仍是一对一敌方英雄边界' },
    { equipmentKey: 'item_3302', name: '界弓保留自身攻击附伤与光暗双抗支路', pass: candidateResults.get('item_3302')?.formulaKeys.has('on_hit_magic_damage') && candidateResults.get('item_3302')?.parameterKeys.has('actual_light_resistance_per_hit'), note: '轮换、计数和乘区仍待接线' },
  ];
  for (const item of scopeCases) {
    checks.push(item);
    if (!item.pass) addIssue('自身范围语义不足', `${item.name}没有同时得到来源和候选结构支持`);
  }
  return checks;
}

const rangeCorrectionNotes = new Map([
  ['item_3046', '幽灵状态资格尚未证实；暂不录入本批，但不能把状态语义缺口写成已完成的范围外结论。'],
  ['item_3074', '主动说明为对周围敌人造成伤害，单一当前敌人仍可能命中；生命偷取对该主动伤害的自身收益也应后续核对。只有多目标顺劈支路可直接排除。'],
  ['item_3085', '来源明确有额外目标弹射，但主目标命中资格与是否有一对一自身收益尚未单独核实，不能由“弹射”一词替代整项结论。'],
  ['item_3107', '主动同时包含友方治疗和对敌方英雄的真实伤害；敌方当前单目标伤害支路仍与一对一相关，友方治疗才是第三方支路。'],
  ['item_3109', '誓约者条件来自第三方，但伤害转移和按友方伤害给自身治疗属于自身结果，需另核当前边界，不能统称纯友军效果。'],
  ['item_3179_ward_branch', '守卫、陷阱和视野空间支路已在 item_3179 来源中保留；无需另建技能，但“来源保留”不等于运行时语义已完成。'],
  ['item_3190', '主动为附近友军提供护盾；中文绑定没有证明施放者是否同时受益，需核自身护盾资格后才能决定是否完全排除。'],
  ['item_3222', '主动为一名友方英雄净化并治疗；是否能以自己为目标尚未由当前绑定证明，先保留为待核而不是直接宣称范围外完成。'],
  ['item_3504', '触发需要给友方英雄施加治疗或护盾，但文本明确你和友方都获得攻速及附伤；第三方触发与自身收益应分开处理。'],
  ['item_3748', '主动强化下一次顺劈并对主目标造成额外伤害，身后敌人才是多目标支路；当前单一主目标支路仍需后续核对。'],
  ['item_4005_ally_branch', '友军协同触发和自身定身支路应分开；自身定身参数已在 item_4005 候选中，友军条件不能作为整项机制已排除的依据。'],
  ['item_4628', '当前只看到视野或空间语义，尚无自身一对一数值证据；保留待核记录，不能以名称直接关闭后续检查。'],
  ['item_6631_passive', '被动顺劈的多目标支路可排除，但主目标攻击与额外目标的分发关系需以绑定为准，不能仅按“顺劈”整项关闭。'],
  ['item_6664', '被动每秒对附近敌人造成伤害，单一当前敌人可以是附近目标；主动冲击波虽为附近目标减速，自身移速与单目标资格仍需分支核对。'],
  ['item_6698', '主动说明为对附近敌人造成伤害，单一当前敌人仍可能被命中；只排除多目标分摊，不应把范围主动整支标为范围外。'],
  ['item_8020', '附近敌方英雄增伤对一个当前敌人仍可能生效，属于自身伤害乘区候选；不能按纯几何范围直接排除。'],
]);

function listJsonFiles(root, results = [], relativeParts = []) {
  if (!fs.existsSync(root)) return results;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === path.basename(BATCH_ROOT) || entry.name === '未录效果盘点') continue;
      listJsonFiles(absolute, results, [...relativeParts, entry.name]);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      results.push(absolute);
    }
  }
  return results;
}

function collectCandidateLikeObjects(value, equipmentKey, filePath, currentPath = '$', matches = [], seen = new Set()) {
  if (value === null || value === undefined || typeof value !== 'object' || seen.has(value)) return matches;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectCandidateLikeObjects(item, equipmentKey, filePath, `${currentPath}[${index}]`, matches, seen));
    return matches;
  }
  const baseId = String(equipmentKey).match(/^item_(\d+)/)?.[1];
  const skillKey = typeof value.skillKey === 'string' ? value.skillKey : '';
  const expectedSkill = baseId ? new RegExp(`^item_${baseId}_(?:passive|active)(?:$|_)`) : null;
  const hasApiPayload = value.equipmentKey === equipmentKey && value.apiPayload && value.apiPayload.skill && Array.isArray(value.apiPayload.parameters);
  const hasDirectPayload = value.equipmentKey === equipmentKey && value.skill && (Array.isArray(value.parameters) || Array.isArray(value.formulas));
  const hasVariantPayload = expectedSkill?.test(skillKey) && (value.apiPayload || Array.isArray(value.parameters) || Array.isArray(value.formulas));
  if (hasApiPayload || hasDirectPayload || hasVariantPayload) {
    matches.push({ filePath, objectPath: currentPath, equipmentKey: value.equipmentKey ?? null, skillKey: skillKey || value.apiPayload?.skill?.skillKey || null, parameters: asArray(value.apiPayload?.parameters ?? value.parameters).length, formulas: asArray(value.apiPayload?.formulas ?? value.formulas).length });
  }
  for (const [key, child] of Object.entries(value)) collectCandidateLikeObjects(child, equipmentKey, filePath, `${currentPath}.${key}`, matches, seen);
  return matches;
}

function findExistingCandidateRecords(unselected) {
  const files = listJsonFiles(EQUIPMENT_RECORD_ROOT);
  const searchedFiles = [];
  const matchesByKey = {};
  for (const entry of unselected) {
    matchesByKey[entry.equipmentKey] = [];
  }
  for (const filePath of files) {
    if (!/(候选|请求|执行记录|回读)/.test(path.basename(filePath))) continue;
    let parsed;
    try {
      parsed = readJson(filePath);
    } catch {
      continue;
    }
    searchedFiles.push(filePath);
    for (const entry of unselected) {
      const matches = collectCandidateLikeObjects(parsed, entry.equipmentKey, filePath);
      if (matches.length) matchesByKey[entry.equipmentKey].push(...matches);
    }
  }
  return { root: EQUIPMENT_RECORD_ROOT, excludedDirectories: [path.basename(BATCH_ROOT), '未录效果盘点'], searchedFiles, matchesByKey };
}

function readInventoryRelationsForRange(before) {
  const inventoryPath = before.inventoryEvidence?.path && fs.existsSync(before.inventoryEvidence.path) ? before.inventoryEvidence.path : INVENTORY_FALLBACK_PATH;
  if (!fs.existsSync(inventoryPath)) return { path: inventoryPath, sha256: null, relations: {} };
  const inventory = readJson(inventoryPath);
  const relations = {};
  for (const entry of asArray(inventory.equipmentRelationsGET)) {
    const key = entry?.equipment?.equipmentKey;
    if (typeof key === 'string') relations[key] = { total: entry.relationGET?.total ?? null, items: asArray(entry.relationGET?.items).map((item) => item?.skillKey).filter(Boolean) };
  }
  return { path: inventoryPath, sha256: fileSha256(inventoryPath), relations };
}

function loadRangeSourceSignals(source, unselected) {
  const clientDeclared = asArray(source.sourceFiles).find((item) => item.key === 'clientItems');
  const stringDeclared = asArray(source.sourceFiles).find((item) => item.key === 'clientStringTable');
  const clientPath = clientDeclared ? path.resolve(PLANNING_DATA_ROOT, clientDeclared.relativePath) : null;
  const stringPath = stringDeclared ? path.resolve(PLANNING_DATA_ROOT, stringDeclared.relativePath) : null;
  const clientExists = !!clientPath && fs.existsSync(clientPath);
  const stringExists = !!stringPath && fs.existsSync(stringPath);
  const clientMap = clientExists ? readGzipJson(clientPath) : {};
  const stringTable = stringExists ? readGzipJson(stringPath) : {};
  const entries = stringTable.entries || {};
  const signals = [];
  for (const item of unselected) {
    const baseId = Number(String(item.equipmentKey).match(/^item_(\d+)/)?.[1]);
    const sourceEntry = Object.entries(clientMap).find(([, value]) => value?.itemID === baseId);
    const raw = sourceEntry?.[1];
    const locKeys = raw?.mItemDataClient?.mTooltipData?.mLocKeys || {};
    const resolvedText = {};
    for (const [binding, key] of Object.entries(locKeys)) {
      if (typeof key === 'string') resolvedText[binding] = entries[key.toLowerCase()] ?? null;
    }
    signals.push({
      equipmentKey: item.equipmentKey,
      rawPath: sourceEntry?.[0] ?? null,
      calculationKeys: raw ? Object.keys(raw.mItemCalculations || {}) : [],
      dataValueNames: raw ? asArray(raw.mDataValues).map((value) => value?.mName).filter(Boolean) : [],
      locKeys,
      resolvedText,
    });
  }
  return {
    files: [
      { key: 'clientItems', path: clientPath, exists: clientExists, sha256: clientExists ? fileSha256(clientPath) : null, expectedSha256: clientDeclared?.sha256 ?? null },
      { key: 'clientStringTable', path: stringPath, exists: stringExists, sha256: stringExists ? fileSha256(stringPath) : null, expectedSha256: stringDeclared?.sha256 ?? null },
    ],
    signals,
  };
}

function auditRangeBoundary(candidate, source, before) {
  const unselected = asArray(candidate.entryBoundary?.unselectedMechanismBearing);
  const existing = findExistingCandidateRecords(unselected);
  const inventory = readInventoryRelationsForRange(before);
  const sourceSignals = loadRangeSourceSignals(source, unselected);
  const entries = unselected.map((item) => {
    const relation = inventory.relations[item.equipmentKey] || inventory.relations[item.equipmentKey.replace(/_(?:ward_branch|ally_branch)$/, '')] || null;
    const matches = existing.matchesByKey[item.equipmentKey] || [];
    const sourceSignal = sourceSignals.signals.find((signal) => signal.equipmentKey === item.equipmentKey);
    const hasCurrentSingleTargetSignal = ['item_3074', 'item_3107', 'item_3748', 'item_6664', 'item_6698', 'item_8020'].includes(item.equipmentKey);
    return {
      equipmentKey: item.equipmentKey,
      name: item.name,
      originalReason: item.reason,
      disposition: item.equipmentKey === 'item_3179_ward_branch' ? '已由item_3179候选留来源，暂不另建技能' : '后续待核，不得写成范围外已完成',
      correction: rangeCorrectionNotes.get(item.equipmentKey) || '边界语义未完成独立证明，保留待核。',
      sourceSignal: sourceSignal || null,
      currentRelation: relation,
      existingCandidateRecords: matches,
      likelySingleCurrentTargetBranch: hasCurrentSingleTargetSignal,
    };
  });
  const overbroadKeys = entries.filter((item) => item.likelySingleCurrentTargetBranch).map((item) => item.equipmentKey);
  addWarning('范围报告需修订', '现有范围报告把可命中单一当前敌人的范围主动、对敌方英雄的单目标伤害或附近敌人增幅整项写为范围外；候选本身不因这份边界报告而自动获得通过。', { overbroadKeys, reportPath: path.join(BATCH_ROOT, '范围与缺口报告.md') });
  return {
    reportPath: path.join(BATCH_ROOT, '范围与缺口报告.md'),
    reportSha256: fs.existsSync(path.join(BATCH_ROOT, '范围与缺口报告.md')) ? fileSha256(path.join(BATCH_ROOT, '范围与缺口报告.md')) : null,
    status: '候选范围可独立检查；原范围报告需修订',
    unselectedCount: entries.length,
    entries,
    overbroadKeys,
    existingRecordSearch: existing,
    inventoryRelations: { path: inventory.path, sha256: inventory.sha256, selectedKeys: Object.fromEntries(entries.map((item) => [item.equipmentKey, item.currentRelation])) },
    sourceSignals,
  };
}

async function readAndProtectCurrent(candidate, before, hashRecord) {
  const baselineByEquipment = new Map(asArray(before.objects).map((item) => [item.equipmentKey, item]));
  const current = {};
  for (const object of asArray(candidate.objects)) {
    const equipmentKey = object.equipmentKey;
    const baseline = baselineByEquipment.get(equipmentKey);
    if (!baseline) {
      addIssue('写前装备基线缺失', `${equipmentKey}没有写前现值记录`);
      continue;
    }
    current[equipmentKey] = { baseline, records: {}, skillSubject: null, componentLists: {} };
    for (const expectedRecord of asArray(baseline.records)) {
      const liveRecord = await apiGet(expectedRecord.route, `${equipmentKey}写前保护${expectedRecord.route}`);
      current[equipmentKey].records[expectedRecord.route] = liveRecord;
      compareApiRecord(liveRecord, expectedRecord, `${equipmentKey}${expectedRecord.route}`);
    }
    const subjectRoute = `/skills/${encodeURIComponent(object.skillKey)}`;
    const subject = await apiGet(subjectRoute, `${equipmentKey}主体占位保护`);
    current[equipmentKey].skillSubject = subject;
    compareApiRecord(subject, baseline.skillSubjectGET, `${equipmentKey}主体占位保护`);
    if (subject.status !== 404 || subject.data?.error?.code !== '404.SKILL_NOT_FOUND') addIssue('主体占用保护失败', `${object.skillKey}当前没有按预期保持不存在状态`, { status: subject.status, data: subject.data });
    for (const [, route, key] of componentDefs) {
      const routePath = `/skills/${encodeURIComponent(object.skillKey)}/${route}`;
      const listRecord = await apiGet(routePath, `${equipmentKey}${route}占用保护`);
      current[equipmentKey].componentLists[route] = listRecord;
      if (listRecord.status !== 404 || listRecord.data?.error?.code !== '404.SKILL_NOT_FOUND') addIssue('未挂载技能组成保护失败', `${object.skillKey}/${route}当前不是不存在状态`, { status: listRecord.status, data: listRecord.data, key });
    }
    const imageData = current[equipmentKey].records['/equipment/' + equipmentKey + '/representative-image']?.data;
    const imageKey = imageData?.image?.imageKey;
    if (imageKey !== equipmentKey || baseline.representativeImageKey !== equipmentKey) addIssue('装备代表图保护失败', `${equipmentKey}当前代表图不是原装备图键`, { imageKey, baseline: baseline.representativeImageKey });
    const relations = current[equipmentKey].records[`/equipment-skill-relations?equipmentKey=${equipmentKey}`]?.data;
    if (!relations || relations.total !== 0 || asArray(relations.items).length !== 0 || baseline.relationCount !== 0) addIssue('装备挂载保护失败', `${equipmentKey}当前关系不是空集合`, { relations, baselineRelationCount: baseline.relationCount });
  }
  const inventoryPath = before.inventoryEvidence?.path && fs.existsSync(before.inventoryEvidence.path) ? before.inventoryEvidence.path : INVENTORY_FALLBACK_PATH;
  const inventoryExists = fs.existsSync(inventoryPath);
  const inventorySha = inventoryExists ? fileSha256(inventoryPath) : null;
  if (!inventoryExists || (hashRecord.currentGETSha256 && inventorySha !== hashRecord.currentGETSha256)) addIssue('198装备盘点保护失败', '选装前全量装备与挂载盘点文件不存在或散列漂移', { inventoryPath, inventorySha, expected: hashRecord.currentGETSha256 });
  let inventory = null;
  if (inventoryExists) inventory = readJson(inventoryPath);
  return { current, inventory: inventory ? { path: inventoryPath, sha256: inventorySha, summary: inventory.summary, apiWrites: inventory.apiWrites, noBusinessWrites: inventory.noBusinessWrites } : { path: inventoryPath, sha256: inventorySha } };
}

function routeEvidence() {
  const backendRoot = path.resolve(WEB_ROOT, '..', 'damage_backend_dev');
  const specs = [
    ['装备读取接口', path.join(backendRoot, 'server', 'data_manage', 'src', 'main', 'java', 'xyz', 'game', 'datamanage', 'controller', 'adminapi', 'equipment', 'EquipmentAdminController.java'), [/@RequestMapping\s*\(\s*"\/api\/admin\/games\/\{gameId\}\/equipment"\s*\)/, /@GetMapping\s*\(\s*"\/{equipmentKey}"\s*\)/, /@GetMapping\s*\(\s*"\/{equipmentKey}\/attributes"\s*\)/]],
    ['装备技能关系读取接口', path.join(backendRoot, 'server', 'data_manage', 'src', 'main', 'java', 'xyz', 'game', 'datamanage', 'controller', 'adminapi', 'skillrelation', 'EquipmentSkillRelationAdminController.java'), [/@RequestMapping\s*\(\s*"\/api\/admin\/games\/\{gameId\}\/equipment-skill-relations"\s*\)/, /@GetMapping\b/]],
    ['技能主体读取接口', path.join(backendRoot, 'server', 'data_manage', 'src', 'main', 'java', 'xyz', 'game', 'datamanage', 'controller', 'adminapi', 'skill', 'SkillAdminController.java'), [/@RequestMapping\s*\(\s*"\/api\/admin\/games\/\{gameId\}\/skills"\s*\)/, /@GetMapping\s*\(\s*"\/{skillKey}"\s*\)/]],
    ['代表图读取接口', path.join(backendRoot, 'server', 'data_manage', 'src', 'main', 'java', 'xyz', 'game', 'datamanage', 'controller', 'adminapi', 'imagerelation', 'ImageRelationAdminController.java'), [/"\/equipment\/\{equipmentKey\}\/representative-image"/, /"\/skills\/\{skillKey\}\/representative-image"/]],
  ];
  return specs.map(([label, file, patterns]) => {
    const exists = fs.existsSync(file);
    const source = exists ? fs.readFileSync(file, 'utf8') : '';
    const checks = patterns.map((pattern) => ({ pattern: String(pattern), pass: pattern.test(source) }));
    for (const check of checks) if (!check.pass) addIssue('本地接口路线未证实', `${label}缺少必要源码路由`, { file, pattern: check.pattern });
    return { label, file, exists, sha256: exists ? fileSha256(file) : null, checks };
  });
}

async function run() {
  const candidate = readJson(CANDIDATE_PATH);
  const source = readJson(SOURCE_PATH);
  const hashRecord = readJson(HASH_PATH);
  const before = readJson(BEFORE_PATH);
  const candidateSha256 = fileSha256(CANDIDATE_PATH);
  const sourceSha256 = fileSha256(SOURCE_PATH);
  if (candidateSha256 !== '03214a9b07e56fecf40f1731853aa4a543d90d185ca4c604b5c06174d115108c') addIssue('候选散列漂移', '完整候选散列与父任务给定值不同', { actual: candidateSha256 });
  if (sourceSha256 !== '98d14396062ef2189cf364faf863f4d2ee62481dff9dacbaf4641fa9663c0492') addIssue('来源散列漂移', '冻结来源散列与父任务给定值不同', { actual: sourceSha256 });
  if (!sameValue(candidate.objects.map((item) => item.equipmentKey).sort(), expectedEquipmentKeys.slice().sort())) addIssue('装备选择范围漂移', '候选装备键集合不是十项固定范围', { actual: candidate.objects.map((item) => item.equipmentKey).sort(), expected: expectedEquipmentKeys.slice().sort() });
  if (candidate.totals?.equipment !== 10 || candidate.totals?.skills !== 10 || candidate.totals?.parameters !== 52 || candidate.totals?.formulas !== 8 || candidate.totals?.effects !== 0 || candidate.totals?.processes !== 0 || candidate.totals?.internalStates !== 0 || candidate.totals?.triggerRules !== 0 || candidate.totals?.relations !== 10 || candidate.totals?.representativeImages !== 10) addIssue('候选总计漂移', '候选总计没有保持10装备、52参数、8公式及空效果过程规则', { totals: candidate.totals });

  const sourceFileChecks = validateSourceFiles(source, candidate);
  const frozenByEquipment = source.selectedRawObjects || {};
  const candidateResults = new Map();
  const sourceSemantics = [];
  for (const object of asArray(candidate.objects)) {
    const frozen = frozenByEquipment[object.equipmentKey];
    if (!frozen) addIssue('冻结对象缺失', `${object.equipmentKey}在冻结来源中没有原始对象`);
    else if (!sameValue(comparableSource(object.source), comparableSource(frozen))) addIssue('候选来源复制漂移', `${object.equipmentKey}候选source的共同来源字段与冻结原始对象不一致`, { candidateSha256: valueSha256(comparableSource(object.source)), frozenSha256: valueSha256(comparableSource(frozen)), ignoredCandidateOnlyFields: ['clientItemList'], ignoredFrozenOnlyFields: ['calculationKeys', 'dataValueNames'] });
    const result = validateCandidateObject(object, frozen);
    candidateResults.set(object.equipmentKey, result);
    if (frozen) sourceSemantics.push(validateSourceSemantics(object, frozen, result));
  }
  const mappingEvidence = validateMappingEvidence(candidate, source);
  const scopeChecks = checkSelfAndScope(candidate, source, candidateResults);
  const caps = validateCaps(candidateResults);
  const numericTypeEvidence = validateRuntimeNumericKinds(candidateResults);
  const rangeAudit = auditRangeBoundary(candidate, source, before);
  const formulaCases = evaluateFormulaCases(candidateResults);
  const negativeCases = evaluateNegativeCases(candidateResults);
  const currentProtection = await readAndProtectCurrent(candidate, before, hashRecord);
  const controllers = routeEvidence();
  const statusCounts = reads.reduce((acc, item) => {
    const key = item.status === null ? '网络错误' : String(item.status);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  if (reads.some((item) => item.status === null)) addIssue('实时读取网络错误', '存在没有HTTP状态的实时读取结果', { statusCounts });
  const realtimeWriteCount = reads.filter((item) => item.method !== 'GET').length;
  if (realtimeWriteCount !== 0) addIssue('独立审查发生写入', '实际读取记录中出现了GET之外的方法', { realtimeWriteCount });
  const actualSummary = {
    equipment: candidate.objects.length,
    skills: candidate.objects.length,
    parameters: [...candidateResults.values()].reduce((sum, item) => sum + (item.parameterMap?.size || 0), 0),
    formulas: [...candidateResults.values()].reduce((sum, item) => sum + (item.formulaMap?.size || 0), 0),
    effects: 0,
    processes: 0,
    internalStates: 0,
    triggerRules: 0,
    relations: candidate.objects.length,
    representativeImages: candidate.objects.length,
  };
  if (actualSummary.parameters !== 52 || actualSummary.formulas !== 8) addIssue('独立组成计数失败', '从候选实际对象重新计算的参数或公式计数不符', { actualSummary });
  const report = {
    at: new Date().toISOString(),
    mode: '独立只读审查',
    status: issues.length ? '阻塞' : 'READY',
    apiRoot: API_ROOT,
    files: {
      candidate: { path: CANDIDATE_PATH, sha256: candidateSha256, expectedSha256: '03214a9b07e56fecf40f1731853aa4a543d90d185ca4c604b5c06174d115108c' },
      source: { path: SOURCE_PATH, sha256: sourceSha256, expectedSha256: '98d14396062ef2189cf364faf863f4d2ee62481dff9dacbaf4641fa9663c0492' },
      hashes: { path: HASH_PATH, sha256: fileSha256(HASH_PATH) },
      before: { path: BEFORE_PATH, sha256: fileSha256(BEFORE_PATH) },
    },
    sourceFileChecks,
    mappingEvidence,
    scope: {
      equipmentKeys: expectedEquipmentKeys,
      candidateTotals: candidate.totals,
      actualSummary,
      scopeChecks,
      caps,
      numericTypeEvidence,
      rangeAudit,
      omittedComponents: candidate.totals?.omittedComponents ?? null,
      pendingComponents: candidate.totals?.pendingComponents ?? null,
    },
    sourceSemantics,
    formulaCases,
    negativeCases,
    currentProtection,
    controllers,
    realtime: { getCount: reads.length, statusCounts, writes: 0, selectedSubjectsExpected404: candidate.objects.length, selectedComponentListsExpected404: candidate.objects.length * componentDefs.length },
    issues,
    warnings,
    reads,
  };
  fs.writeFileSync(FINAL_REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const passedFormulaCases = formulaCases.filter((item) => item.pass).length;
  const passedNegativeCases = negativeCases.filter((item) => item.rejected).length;
  const passedTextChecks = sourceSemantics.reduce((sum, item) => sum + item.textChecks.filter((check) => check.pass).length, 0);
  const totalTextChecks = sourceSemantics.reduce((sum, item) => sum + item.textChecks.length, 0);
  const reportLines = [
    '# 装备第十八批独立审查',
    '',
    `- 结论：**${report.status}**。本次实际只读 GET ${reads.length} 项，业务写入数为 0。`,
    `- 候选 SHA256：\`${candidateSha256}\`；来源 SHA256：\`${sourceSha256}\`。`,
    `- 范围：10 件装备、10 个技能主体、52 个参数、8 个公式；候选效果、过程、内部状态和触发规则均为空。`,
    '',
    '## 当前数据保护',
    '',
    `10 件装备的主体、属性、原代表图和装备挂载均与写前现值一致；代表图 ${candidate.objects.length}/10，关系均为零。10 个技能主体和 ${candidate.objects.length * componentDefs.length} 个技能组成列表均保持不存在状态。`,
    `实时状态计数：${JSON.stringify(statusCounts)}。198 件装备盘点文件及冻结散列已核对。`,
    '',
    '## 来源与范围',
    '',
    `四份固定来源文件逐一核散列；十个候选source与冻结原始对象逐项比对。中文绑定语义检查 ${passedTextChecks}/${totalTextChecks} 通过。`,
    '黯影阔剑来源明确写出未被看见后对英雄下一次攻击造成真实伤害，因此具备自身一对一伤害依据；守卫、陷阱和视野空间支路留在来源。冰脉护手来源明确写出施法后下一次攻击的咒刃伤害和减速，基础攻击力采用已有同版具名的 mStat2/formula1 窄映射。',
    '帝国指令同时保留自身定身技能急速和对敌方英雄的易损比例；界弓保留自身攻击附伤和光暗双抗原始边界。多目标、怪物、纯空间、视野、未绑定持续伤害和未解码属性没有进入请求。',
    '',
    '## 公式与边界核算',
    '',
    `独立公式算例 ${passedFormulaCases}/${formulaCases.length} 通过；错误枚举、缺少运行时输入和非法公式节点反例 ${passedNegativeCases}/${negativeCases.length} 被拒绝。`,
    '核算直接执行候选公式树并使用独立输入；界弓按额外攻击力和法强分支分别输入，亡者的板甲、冰脉护手按基础攻击力输入，挺进破坏者按总攻击力输入。mStat29、光明双抗等级求值、移动积攒中间层数和动态击杀计数保持运行时输入或待核，不补零。',
    '已核对3036的15%与1500生命值门槛、3302的30%穿透上限、3742的100层满层端点。来源没有证明中间曲线或过程节拍，因此没有声称这些端点可直接生成完整战斗过程。',
    '',
    '## 证据边界',
    '',
    issues.length ? issues.map((item) => `- ${item.code}：${item.message}`).join('\n') : '- 未发现有证据的阻塞问题。',
    warnings.length ? warnings.map((item) => `- ${item.code}：${item.message}`).join('\n') : '- 未发现需要后续说明的警告。',
    `范围报告复核：原文件把 ${rangeAudit.overbroadKeys.join('、')} 的单一当前目标或自身收益支路整体排除；本次搜索未发现这些键已有其他批次的候选组成记录，具体逐项证据见最终修订 JSON 的 scope.rangeAudit.entries，均改列后续待核。`,
    `3036 类型复核：固定1500上限可保持INTEGER，但 actual_target_bonus_health 当前声明INTEGER且来源未证明动态目标值为整数；后端整数检查适用于固定值/等级表，十进制动态来源只能与DECIMAL参数兼容，需修订为DECIMAL。`,
    '- 本报告证明当前 API 读回、冻结来源、候选结构和静态算例；没有执行业务写入、页面验收或战斗运行。属性窄映射仍是同版静态交叉证据，不等同于求值器运行证明。',
    '',
    `报告生成时间：${report.at}`,
  ];
  fs.writeFileSync(FINAL_REPORT_MD_PATH, `${reportLines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ status: report.status, candidateSha256, sourceSha256, getCount: reads.length, statusCounts, issues: issues.length, warnings: warnings.length, formulaCases: `${passedFormulaCases}/${formulaCases.length}`, negativeCases: `${passedNegativeCases}/${negativeCases.length}`, artifactDir: ARTIFACT_DIR }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

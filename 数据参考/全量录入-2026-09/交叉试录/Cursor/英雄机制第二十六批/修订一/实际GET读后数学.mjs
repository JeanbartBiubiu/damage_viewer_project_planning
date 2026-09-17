import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// 只读取独立回读器给出的路由，再重新GET所有候选组件；表达式和参数均来自本次实际GET响应。
// 本脚本只允许GET，不读取候选中的表达式作为求值依据，也不发送任何业务写请求。
const here = path.dirname(fileURLToPath(import.meta.url));
const inputDir = path.join(here, '输入包');
const referenceDir = path.join(inputDir, '参考资料');
const readerRoot = path.join(here, '独立回读');
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sha256File = file => sha256(fs.readFileSync(file));
const latestDirectory = root => fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().at(-1);
const readerRun = path.join(readerRoot, latestDirectory(readerRoot));
const readerEvidenceFile = path.join(readerRun, '候选组件回读.json');
const readerEvidence = readJson(readerEvidenceFile);
const candidateEntries = (readerEvidence.candidateEntries ?? []).map(entry => ({ skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, detailRoute: entry.detailRoute }));
const expectedRoutes = [...new Set(candidateEntries.map(entry => entry.detailRoute))];
const expectedFormulaEntries = candidateEntries.filter(entry => entry.kind === 'formulas');
const expectedParameterEntries = candidateEntries.filter(entry => entry.kind === 'parameters');
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputDir = path.join(here, '实际GET数学', runId);
fs.mkdirSync(outputDir, { recursive: true });
const rawFile = path.join(outputDir, '实际GET原始响应.jsonl');
const responses = new Map();
const calls = [];
const failures = [];
const checks = [];

function check(name, passed, detail = null) {
  const row = { name, passed: Boolean(passed), detail };
  checks.push(row);
  if (!row.passed) failures.push(row);
  return row.passed;
}
function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`不是有限数值: ${label}`);
  return value;
}
function approx(actual, expected, tolerance = 1e-8) { return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected)); }
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function ctx(skillKey, level, attributes = {}, runtime = {}) { return { skillKey, level, attributes, runtime, omitParameters: new Set(), omitAttributes: new Set() }; }
function attrKey(owner, key, kind) { return `${owner}/${key}/${kind}`; }
function keyOf(skillKey, kind, stableKey) { return `${skillKey}/${kind}/${stableKey}`; }

async function get(route) {
  const sequence = calls.length + 1;
  const response = await fetch(apiBase + route, {
    method: 'GET',
    headers: { Authorization: `Bearer ${process.env.HERO26_API_TOKEN ?? 'local-entry'}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data = null;
  let parseError = null;
  try { data = text ? JSON.parse(text) : null; } catch (error) { parseError = String(error.message ?? error); }
  const record = { sequence, method: 'GET', route, status: response.status, data, ...(parseError ? { parseError } : {}) };
  calls.push(record);
  fs.appendFileSync(rawFile, `${JSON.stringify(record)}\n`, 'utf8');
  responses.set(route, { status: response.status, data });
  return record;
}

const runtimeErrors = [];
try {
  check('独立回读输入为present且通过', readerEvidence.expectation === 'present' && readerEvidence.passed === true && readerEvidence.missingCount === 0, { readerRun, expectation: readerEvidence.expectation, passed: readerEvidence.passed, missing: readerEvidence.missingCount });
  check('实际GET路由为78个唯一候选详情', expectedRoutes.length === 78 && candidateEntries.length === 78, { entries: candidateEntries.length, uniqueRoutes: expectedRoutes.length });
  for (const route of expectedRoutes) await get(route);
} catch (error) {
  runtimeErrors.push(String(error.stack ?? error));
  failures.push({ name: '重新GET候选组件', passed: false, detail: runtimeErrors.at(-1) });
}

const parameterIndex = new Map();
const formulaIndex = new Map();
for (const entry of candidateEntries) {
  const actual = responses.get(entry.detailRoute);
  if (!actual || actual.status !== 200 || !actual.data) continue;
  if (entry.kind === 'parameters') parameterIndex.set(`${entry.skillKey}/${entry.stableKey}`, actual.data);
  if (entry.kind === 'formulas') formulaIndex.set(`${entry.skillKey}/${entry.stableKey}`, actual.data);
}
check('实际GET参数详情全部返回', parameterIndex.size === expectedParameterEntries.length, { expected: expectedParameterEntries.length, actual: parameterIndex.size });
check('实际GET公式详情全部返回', formulaIndex.size === expectedFormulaEntries.length, { expected: expectedFormulaEntries.length, actual: formulaIndex.size });

function parameterValue(skillKey, parameterKey, context) {
  const fullKey = `${skillKey}/${parameterKey}`;
  if (context.omitParameters.has(fullKey)) throw new Error(`缺少参数输入 ${fullKey}`);
  const parameter = parameterIndex.get(fullKey);
  if (!parameter) throw new Error(`实际GET缺少参数 ${fullKey}`);
  if (parameter.valueMode === 'FIXED') return finite(parameter.fixedValue, fullKey);
  if (parameter.valueMode === 'SKILL_LEVEL') {
    const levelKey = String(context.level);
    if (!own(parameter.levelValues ?? {}, levelKey)) throw new Error(`缺少等级参数输入 ${fullKey}@${levelKey}`);
    return finite(parameter.levelValues[levelKey], `${fullKey}@${levelKey}`);
  }
  if (parameter.valueMode === 'RUNTIME_INPUT') {
    const values = context.runtime?.[skillKey] ?? {};
    if (!own(values, parameterKey)) throw new Error(`缺少运行输入 ${fullKey}`);
    return finite(values[parameterKey], fullKey);
  }
  throw new Error(`未知参数取值模式 ${parameter.valueMode}`);
}
function attributeValue(node, context) {
  const key = attrKey(node.attributeOwner, node.attributeKey, node.attributeValueKind);
  if (context.omitAttributes.has(key)) throw new Error(`缺少属性输入 ${key}`);
  const owner = context.attributes?.[node.attributeOwner] ?? {};
  const attribute = owner[node.attributeKey] ?? {};
  if (!own(attribute, node.attributeValueKind)) throw new Error(`缺少属性输入 ${key}`);
  return finite(attribute[node.attributeValueKind], key);
}
function evaluate(node, context, skillKey) {
  if (!node || typeof node !== 'object') throw new Error('公式节点为空');
  if (node.nodeType === 'PARAMETER') return parameterValue(skillKey, node.parameterKey, context);
  if (node.nodeType === 'ATTRIBUTE') return attributeValue(node, context);
  if (node.nodeType !== 'OPERATION') throw new Error(`未知节点类型 ${node.nodeType}`);
  if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`运算节点必须恰好两个输入 ${node.operation}`);
  const left = evaluate(node.operands[0], context, skillKey);
  const right = evaluate(node.operands[1], context, skillKey);
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error(`未实现运算 ${node.operation}`);
  }
}
function evaluateActual(skillKey, formulaKey, context) {
  const formula = formulaIndex.get(`${skillKey}/${formulaKey}`);
  if (!formula) throw new Error(`实际GET缺少公式 ${skillKey}/${formulaKey}`);
  return evaluate(formula.expression, context, skillKey);
}
function directExpected(skillKey, formulaKey, context) {
  const p = parameterKey => parameterValue(skillKey, parameterKey, context);
  const a = (owner, key, kind) => {
    const value = context.attributes?.[owner]?.[key]?.[kind];
    return finite(value, attrKey(owner, key, kind));
  };
  if (skillKey === 'alistar_p' && formulaKey === 'self_heal_amount') return p('self_heal_ratio') * a('SOURCE', 'hp', 'TOTAL');
  if (skillKey === 'alistar_q' && formulaKey === 'magic_damage') return p('base_damage') + p('ap_ratio') * a('SOURCE', 'ability_power', 'TOTAL');
  if (skillKey === 'alistar_w' && formulaKey === 'magic_damage') return p('base_damage') + p('ap_ratio') * a('SOURCE', 'ability_power', 'TOTAL');
  if (skillKey === 'alistar_e' && formulaKey === 'total_magic_damage') return p('trample_damage') + p('ap_ratio') * a('SOURCE', 'ability_power', 'TOTAL');
  if (skillKey === 'alistar_r' && formulaKey === 'damage_reduction_ratio') return p('damage_reduction_percent_points') * p('percent_to_ratio');
  if (skillKey === 'blitzcrank_p' && formulaKey === 'shield_amount') return p('shield_ratio') * p('ability_resource_value');
  if (skillKey === 'blitzcrank_q' && formulaKey === 'magic_damage') return p('base_damage') + p('ap_ratio') * a('SOURCE', 'ability_power', 'TOTAL');
  if (skillKey === 'blitzcrank_e' && formulaKey === 'physical_damage') return p('total_attack_damage_multiplier') * a('SOURCE', 'attack_damage', 'TOTAL') + p('ability_power_ratio') * a('SOURCE', 'ability_power', 'TOTAL');
  if (skillKey === 'blitzcrank_r' && formulaKey === 'passive_magic_damage') return p('passive_base_damage') + p('passive_ap_ratio') * a('SOURCE', 'ability_power', 'TOTAL') + p('passive_resource_ratio') * p('passive_ability_resource_value');
  if (skillKey === 'blitzcrank_r' && formulaKey === 'active_magic_damage') return p('active_base_damage') + p('active_ap_ratio') * a('SOURCE', 'ability_power', 'TOTAL');
  throw new Error(`未定义独立期望 ${skillKey}/${formulaKey}`);
}

const attrsA = { SOURCE: { hp: { TOTAL: 3000 }, ability_power: { TOTAL: 50 }, attack_damage: { TOTAL: 160, BONUS: 90 } } };
const attrsB = { SOURCE: { hp: { TOTAL: 4800 }, ability_power: { TOTAL: 275 }, attack_damage: { TOTAL: 405, BONUS: 325 } } };
const formulaCases = {
  'alistar_p/self_heal_amount': [ctx('alistar_p', 1, attrsA), ctx('alistar_p', 1, attrsB)],
  'alistar_q/magic_damage': [ctx('alistar_q', 1, attrsA), ctx('alistar_q', 5, attrsB)],
  'alistar_w/magic_damage': [ctx('alistar_w', 1, attrsA), ctx('alistar_w', 5, attrsB)],
  'alistar_e/total_magic_damage': [ctx('alistar_e', 1, attrsA), ctx('alistar_e', 5, attrsB)],
  'alistar_r/damage_reduction_ratio': [ctx('alistar_r', 1, attrsA), ctx('alistar_r', 3, attrsB)],
  'blitzcrank_p/shield_amount': [ctx('blitzcrank_p', 1, {}, { blitzcrank_p: { ability_resource_value: 800 } }), ctx('blitzcrank_p', 1, {}, { blitzcrank_p: { ability_resource_value: 1533 } })],
  'blitzcrank_q/magic_damage': [ctx('blitzcrank_q', 1, attrsA), ctx('blitzcrank_q', 5, attrsB)],
  'blitzcrank_e/physical_damage': [ctx('blitzcrank_e', 1, attrsA), ctx('blitzcrank_e', 5, attrsB)],
  'blitzcrank_r/passive_magic_damage': [ctx('blitzcrank_r', 1, attrsA, { blitzcrank_r: { passive_ability_resource_value: 500 } }), ctx('blitzcrank_r', 3, attrsB, { blitzcrank_r: { passive_ability_resource_value: 1725 } })],
  'blitzcrank_r/active_magic_damage': [ctx('blitzcrank_r', 1, attrsA), ctx('blitzcrank_r', 3, attrsB)],
};
const formulaResults = [];
const rejectionResults = [];
function leaves(node, output = []) {
  if (node?.nodeType === 'PARAMETER') output.push({ type: 'PARAMETER', key: node.parameterKey });
  else if (node?.nodeType === 'ATTRIBUTE') output.push({ type: 'ATTRIBUTE', key: attrKey(node.attributeOwner, node.attributeKey, node.attributeValueKind) });
  else if (node?.nodeType === 'OPERATION' && Array.isArray(node.operands) && node.operands.length === 2) for (const child of node.operands) leaves(child, output);
  else throw new Error('实际GET表达式存在未知或非二元节点');
  return output;
}
for (const entry of expectedFormulaEntries) {
  const formulaKey = entry.stableKey;
  const key = `${entry.skillKey}/${formulaKey}`;
  const cases = formulaCases[key] ?? [];
  if (cases.length !== 2) { failures.push({ name: `公式双场景 ${key}`, passed: false, detail: `场景数=${cases.length}` }); continue; }
  const actualFormula = formulaIndex.get(key);
  const evaluated = [];
  for (const [index, context] of cases.entries()) {
    try {
      const actual = finite(evaluateActual(entry.skillKey, formulaKey, context), `${key}/实际GET`);
      const expected = finite(directExpected(entry.skillKey, formulaKey, context), `${key}/独立期望`);
      const passed = approx(actual, expected);
      check(`${key}场景${index + 1}`, passed, { level: context.level, actual, expected, attributes: context.attributes, runtimeInputs: context.runtime });
      evaluated.push({ index: index + 1, level: context.level, actual, expected, passed });
    } catch (error) {
      const message = String(error.message ?? error);
      failures.push({ name: `${key}场景${index + 1}`, passed: false, detail: message });
      evaluated.push({ index: index + 1, passed: false, error: message });
    }
  }
  formulaResults.push({ skillKey: entry.skillKey, formulaKey, route: entry.detailRoute, actualResponseSha256: sha256(JSON.stringify(actualFormula)), expression: actualFormula?.expression ?? null, cases: evaluated });
  let leaf = null;
  try { leaf = leaves(actualFormula?.expression).find(item => item.type === 'ATTRIBUTE') ?? leaves(actualFormula?.expression)[0]; } catch (error) { failures.push({ name: `缺值叶子解析 ${key}`, passed: false, detail: String(error.message ?? error) }); }
  const missingContext = cases[0] ? { ...cases[0], omitParameters: new Set(cases[0].omitParameters), omitAttributes: new Set(cases[0].omitAttributes) } : null;
  let rejected = false;
  let rejectionError = null;
  if (missingContext && leaf) {
    if (leaf.type === 'ATTRIBUTE') missingContext.omitAttributes.add(leaf.key);
    else missingContext.omitParameters.add(`${entry.skillKey}/${leaf.key}`);
    try { evaluateActual(entry.skillKey, formulaKey, missingContext); } catch (error) { rejected = true; rejectionError = String(error.message ?? error); }
  }
  check(`${key}缺失输入拒绝`, rejected, { removed: leaf, error: rejectionError });
  rejectionResults.push({ skillKey: entry.skillKey, formulaKey, removed: leaf, rejected, error: rejectionError });
}

const boundaryResults = [];
function boundary(name, passed, detail) {
  const result = { name, passed: Boolean(passed), detail };
  boundaryResults.push(result);
  check(`边界 ${name}`, passed, detail);
}
try {
  const r1 = evaluateActual('alistar_r', 'damage_reduction_ratio', ctx('alistar_r', 1));
  const r3 = evaluateActual('alistar_r', 'damage_reduction_ratio', ctx('alistar_r', 3));
  boundary('阿利斯塔R减伤55到75百分点', approx(r1, 0.55) && approx(r3, 0.75), { rank1: r1, rank3: r3 });
  const eAttrs = { SOURCE: { ability_power: { TOTAL: 120 }, attack_damage: { TOTAL: 200, BONUS: 80 } } };
  const eValue = evaluateActual('blitzcrank_e', 'physical_damage', ctx('blitzcrank_e', 5, eAttrs));
  boundary('布里茨E使用总攻击力', approx(eValue, 2 * 200 + 0.25 * 120) && !approx(eValue, 2 * 80 + 0.25 * 120), eValue);
  const pZero = evaluateActual('blitzcrank_p', 'shield_amount', ctx('blitzcrank_p', 1, {}, { blitzcrank_p: { ability_resource_value: 0 } }));
  const pHigh = evaluateActual('blitzcrank_p', 'shield_amount', ctx('blitzcrank_p', 1, {}, { blitzcrank_p: { ability_resource_value: 2000 } }));
  boundary('布里茨P资源0与2000', approx(pZero, 0) && approx(pHigh, 2000 * parameterValue('blitzcrank_p', 'shield_ratio', ctx('blitzcrank_p', 1))), { zero: pZero, high: pHigh });
  let pRejected = false;
  try { evaluateActual('blitzcrank_p', 'shield_amount', ctx('blitzcrank_p', 1)); } catch { pRejected = true; }
  boundary('布里茨P缺资源不默认0', pRejected, '缺少实际资源输入时必须拒绝求值');
  const rZero = evaluateActual('blitzcrank_r', 'passive_magic_damage', ctx('blitzcrank_r', 1, attrsA, { blitzcrank_r: { passive_ability_resource_value: 0 } }));
  const rHigh = evaluateActual('blitzcrank_r', 'passive_magic_damage', ctx('blitzcrank_r', 1, attrsA, { blitzcrank_r: { passive_ability_resource_value: 1000 } }));
  boundary('布里茨R被动资源输入变化', approx(rHigh - rZero, 1000 * parameterValue('blitzcrank_r', 'passive_resource_ratio', ctx('blitzcrank_r', 1))), { zero: rZero, high: rHigh });
  const wDuration = parameterIndex.get('blitzcrank_w/duration_ms');
  const wDecay = parameterIndex.get('blitzcrank_w/decay_duration_ms');
  const wMin = parameterIndex.get('blitzcrank_w/move_speed_min_ratio');
  boundary('布里茨W衰减终点和时间窗口', wDuration?.fixedValue === 5000 && wDecay?.fixedValue === 2500 && wMin?.fixedValue === 0.1, { duration: wDuration?.fixedValue, decay: wDecay?.fixedValue, minimum: wMin?.fixedValue });
  const wMove = parameterIndex.get('blitzcrank_w/move_speed_ratio');
  const wAttack = parameterIndex.get('blitzcrank_w/attack_speed_ratio');
  boundary('布里茨W只保留移动端点而不创建移动效果', !candidateEntries.some(entry => entry.skillKey === 'blitzcrank_w' && entry.kind === 'effects' && entry.stableKey === 'move_speed_boost'), { moveEffectRoutes: candidateEntries.filter(entry => entry.skillKey === 'blitzcrank_w' && entry.kind === 'effects').map(entry => entry.stableKey) });
  boundary('布里茨W移动和攻击速度取值不混用', JSON.stringify(wMove?.levelValues) === JSON.stringify({ '1': 0.6, '2': 0.65, '3': 0.7, '4': 0.75, '5': 0.8 }) && JSON.stringify(wAttack?.levelValues) === JSON.stringify({ '1': 0.3, '2': 0.4, '3': 0.5, '4': 0.6, '5': 0.7 }), { move: wMove?.levelValues, attack: wAttack?.levelValues });
  const wAttackEffect = responses.get('/skills/blitzcrank_w/effects/attack_speed_boost')?.data;
  const wSlowEffect = responses.get('/skills/blitzcrank_w/effects/post_overdrive_slow')?.data;
  boundary('布里茨W攻速五秒与结束减速分离', wAttackEffect?.results?.[0]?.valueRule?.value?.parameterKey === 'attack_speed_ratio' && wSlowEffect?.results?.[0]?.valueRule?.value?.parameterKey === 'slow_ratio' && wAttackEffect?.lifecycle?.durationValue?.parameterKey === 'duration_ms' && wSlowEffect?.lifecycle?.durationValue?.parameterKey === 'slow_duration_ms', { attack: wAttackEffect?.lifecycle, slow: wSlowEffect?.lifecycle });
  const eCooldown = parameterIndex.get('blitzcrank_e/cooldown_ms');
  boundary('布里茨E实际GET冷却等级1至5', JSON.stringify(eCooldown?.levelValues) === JSON.stringify({ '1': 7000, '2': 6500, '3': 6000, '4': 5500, '5': 5000 }) && eCooldown?.valueType === 'INTEGER', eCooldown?.levelValues);
} catch (error) {
  failures.push({ name: '范围和边界核验', passed: false, detail: String(error.stack ?? error) });
}

const rawCache = new Map();
const binding = readJson(path.join(inputDir, '来源绑定与当前文本.json'));
const officialBlitzcrank = readJson(path.join(referenceDir, '官方中文', 'Blitzcrank.json'));
function rawHero(heroId) {
  if (!rawCache.has(heroId)) rawCache.set(heroId, JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(referenceDir, '客户端原文', `${heroId}.json.gz`)))));
  return rawCache.get(heroId);
}
function boundSpell(skillKey) {
  const heroId = skillKey.startsWith('alistar_') ? 'Alistar' : 'Blitzcrank';
  const slot = skillKey.slice(skillKey.lastIndexOf('_') + 1).toUpperCase();
  const hero = binding.heroes.find(item => item.id === heroId);
  const meta = hero?.source?.skills?.find(item => item.slot === slot);
  const rawObject = meta ? rawHero(heroId)[meta.clientPath] : null;
  if (!rawObject?.mSpell) throw new Error(`来源绑定缺少${skillKey}`);
  return rawObject.mSpell;
}
function dataValues(skillKey, name) {
  const row = (boundSpell(skillKey).DataValues ?? []).find(item => item.name === name);
  if (!row || !Array.isArray(row.values)) throw new Error(`来源数组缺少${skillKey}/${name}`);
  return row.values;
}
const sourceSeries = [];
function sourceSeriesCheck(name, skillKey, parameterKey, sourceName, expected) {
  const raw = dataValues(skillKey, sourceName);
  const actual = parameterIndex.get(`${skillKey}/${parameterKey}`)?.levelValues;
  const actualValues = actual ? Object.keys(actual).sort((a, b) => Number(a) - Number(b)).map(key => actual[key]) : [];
  const rawRankSlice = raw.slice(1, expected.length + 1);
  const passed = actualValues.length === expected.length && actualValues.every((value, index) => approx(value, expected[index], 1e-6)) && rawRankSlice.length === expected.length && rawRankSlice.every((value, index) => approx(value, expected[index], 1e-6));
  sourceSeries.push({ name, skillKey, parameterKey, sourceName, raw, rawRankSlice, actualValues, expected, passed, comparison: '逐项容差比较，保留原始浮点值' });
  check(`源数组 ${name}`, passed, sourceSeries.at(-1));
}
try {
  sourceSeriesCheck('布里茨W移动速度原数组等级1至5', 'blitzcrank_w', 'move_speed_ratio', 'MoveSpeedMod', [0.6, 0.65, 0.7, 0.75, 0.8]);
  sourceSeriesCheck('布里茨W攻击速度原数组等级1至5', 'blitzcrank_w', 'attack_speed_ratio', 'AttackSpeedMod', [0.3, 0.4, 0.5, 0.6, 0.7]);
  const clientCooldown = boundSpell('blitzcrank_e').cooldownTime;
  const officialSpell = (officialBlitzcrank.data?.Blitzcrank?.spells ?? []).find(spell => spell.id === 'PowerFist');
  const expectedSeconds = [7, 6.5, 6, 5.5, 5];
  const eCooldown = parameterIndex.get('blitzcrank_e/cooldown_ms');
  const actualMs = Object.keys(eCooldown?.levelValues ?? {}).sort((a, b) => Number(a) - Number(b)).map(key => eCooldown.levelValues[key]);
  const passed = JSON.stringify(clientCooldown?.slice(1, 6)) === JSON.stringify(expectedSeconds) && JSON.stringify(officialSpell?.cooldown) === JSON.stringify(expectedSeconds) && JSON.stringify(actualMs) === JSON.stringify(expectedSeconds.map(value => value * 1000));
  sourceSeries.push({ name: '布里茨E客户端与官方冷却等级1至5', clientRaw: clientCooldown, clientRankSlice: clientCooldown?.slice(1, 6), official: officialSpell?.cooldown, expectedSeconds, actualMs, passed });
  check('源数组 布里茨E客户端与官方冷却等级1至5', passed, sourceSeries.at(-1));
  check('源字段保留客户端首项重复说明', Array.isArray(clientCooldown) && clientCooldown.length === 7 && clientCooldown[0] === clientCooldown[1], { clientCooldown });
} catch (error) {
  failures.push({ name: '来源数组交叉核验', passed: false, detail: String(error.stack ?? error) });
}

const structural = { operationNodes: 0, operationArityFailures: [], runtimeDefaultsFailures: [], integerTypeFailures: [], formulaCount: formulaIndex.size, parameterCount: parameterIndex.size };
function inspect(node, skillKey, formulaKey) {
  if (node?.nodeType === 'OPERATION') {
    structural.operationNodes += 1;
    if (!Array.isArray(node.operands) || node.operands.length !== 2) structural.operationArityFailures.push(`${skillKey}/${formulaKey}`);
    for (const child of node.operands ?? []) inspect(child, skillKey, formulaKey);
  }
}
for (const [key, formula] of formulaIndex) inspect(formula.expression, ...key.split('/'));
for (const [key, parameter] of parameterIndex) {
  if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null && parameter.fixedValue !== undefined || parameter.levelValues !== null && parameter.levelValues !== undefined)) structural.runtimeDefaultsFailures.push(key);
  if (parameter.parameterKey.endsWith('_ms')) {
    const values = parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : [];
    if (parameter.valueType !== 'INTEGER' || values.some(value => !Number.isInteger(value))) structural.integerTypeFailures.push(key);
  }
}
check('实际GET表达式全部为二元运算', structural.operationArityFailures.length === 0, structural.operationArityFailures);
check('实际GET运行输入无默认值', structural.runtimeDefaultsFailures.length === 0, structural.runtimeDefaultsFailures);
check('实际GET毫秒参数为整数', structural.integerTypeFailures.length === 0, structural.integerTypeFailures);

const execution = {
  generatedAt: new Date().toISOString(),
  runId,
  status: failures.length ? '实际GET数学失败' : '实际GET表达式独立严格数学通过',
  mode: '独立fresh-GET后数学',
  apiBase,
  readerRun,
  readerEvidenceSha256: sha256File(readerEvidenceFile),
  freshGET: { count: calls.length, routes: expectedRoutes.length, statuses: calls.reduce((out, call) => { out[String(call.status)] = (out[String(call.status)] ?? 0) + 1; return out; }, {}) },
  counts: { formulas: formulaResults.length, formulaCases: formulaResults.reduce((sum, item) => sum + item.cases.length, 0), rejectionCases: rejectionResults.length, boundaryCases: boundaryResults.length, sourceSeriesChecks: sourceSeries.length, checks: checks.length, failures: failures.length },
  formulaResults,
  rejectionResults,
  boundaryResults,
  sourceSeries,
  structural,
  checks,
  failures,
  apiWrites: 0,
  noBusinessWrites: true,
  noPostPutDelete: true,
  passed: failures.length === 0,
  rawResponseFile: rawFile,
};
fs.writeFileSync(path.join(outputDir, '实际GET数学.json'), `${JSON.stringify(execution, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(outputDir, '执行结果.json'), `${JSON.stringify({ generatedAt: execution.generatedAt, runId, mode: execution.mode, freshGET: execution.freshGET, counts: execution.counts, apiWrites: 0, noBusinessWrites: true, passed: execution.passed, outputDir }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ runId, mode: execution.mode, freshGET: execution.freshGET, counts: execution.counts, structural, apiWrites: 0, noBusinessWrites: true, passed: execution.passed, outputDir }, null, 2));
if (!execution.passed) process.exitCode = 1;

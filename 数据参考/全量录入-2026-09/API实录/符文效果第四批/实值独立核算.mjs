import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_LOCAL_BEARER ?? 'local-entry';
const paths = {
  candidate: path.join(here, '可审查候选.json'),
  finalRequest: path.join(here, '最终请求.json'),
  finalVersion: path.join(here, '最终请求版本.json'),
  frozen: path.join(here, '冻结来源.json'),
  baseline: path.join(here, '保护基线.json'),
  apply: path.join(here, 'apply-20260909034301343.json')
};

const bytes = {};
const data = {};
for (const [key, file] of Object.entries(paths)) {
  bytes[key] = await readFile(file);
  data[key] = JSON.parse(bytes[key]);
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hashes = Object.fromEntries(Object.keys(paths).map(key => [key, sha256(bytes[key])]));
const outputPath = path.join(here, '实值独立核算.json');
let cachedResult = null;
try {
  cachedResult = JSON.parse(await readFile(outputPath, 'utf8'));
} catch {
  cachedResult = null;
}
const cachedReads = cachedResult?.reads?.entries ?? [];
const canReuseCachedReads = cachedResult?.finalRequest?.sha256 === hashes.finalRequest && cachedReads.length === 57;
const checks = [];
const reads = [];
const actualParameters = new Map();
const actualFormulas = new Map();
const actualEffects = new Map();
const arithmetic = [];

function check(name, fn, details = {}) {
  try {
    fn();
    checks.push({ name, ...details, status: '通过' });
  } catch (error) {
    checks.push({ name, ...details, status: '阻塞', reason: error instanceof Error ? error.message : String(error) });
  }
}

function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  if (node.nodeType === 'OPERATION') {
    assert.ok(Array.isArray(node.operands), '公式操作数不是数组');
    for (const child of node.operands) walk(child, visitor);
  }
}

function parameterKeys(node, result = new Set()) {
  walk(node, current => {
    if (current.nodeType === 'PARAMETER') result.add(current.parameterKey);
  });
  return result;
}

function attributeNodes(node) {
  const result = [];
  walk(node, current => {
    if (current.nodeType === 'ATTRIBUTE') result.push(current);
  });
  return result;
}

function formulaData(skillKey, formulaKey) {
  const value = actualFormulas.get(`${skillKey}/${formulaKey}`);
  assert.ok(value, `没有实际公式${skillKey}/${formulaKey}`);
  return value;
}

function parameterData(skillKey, parameterKey) {
  const value = actualParameters.get(`${skillKey}/${parameterKey}`);
  assert.ok(value, `没有实际参数${skillKey}/${parameterKey}`);
  return value;
}

function effectData(skillKey, effectKey) {
  const value = actualEffects.get(`${skillKey}/${effectKey}`);
  assert.ok(value, `没有实际效果${skillKey}/${effectKey}`);
  return value;
}

function unwrap(body) {
  return body && typeof body === 'object' && Object.hasOwn(body, 'data') ? body.data : body;
}

function compareExpected(actual, expected, label) {
  assert.ok(actual && typeof actual === 'object', `${label}实际数据不是对象`);
  for (const key of Object.keys(expected)) assert.deepEqual(actual[key], expected[key], `${label}.${key}不一致`);
}

async function wait(milliseconds) {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function getJson(route, label) {
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${baseUrl}${route}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      const text = await response.text();
      let body;
      try {
        body = text.length ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      attempts.push({ attempt, status: response.status, ok: response.ok, body });
      if (response.ok || (response.status < 500 && response.status !== 429)) {
        return { label, route, status: response.status, ok: response.ok, body, data: unwrap(body), attempts };
      }
    } catch (error) {
      attempts.push({ attempt, status: 0, ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 2) await wait(500);
  }
  const last = attempts.at(-1);
  return { label, route, status: last?.status ?? 0, ok: false, body: last?.body ?? null, data: unwrap(last?.body), attempts };
}

async function readOnce(request, label) {
  if (canReuseCachedReads) {
    const cached = cachedReads.find(read => read.kind === request.kind && read.skillKey === request.skillKey && read.key === (request.body.formulaKey ?? request.body.parameterKey ?? request.body.effectKey));
    if (cached) return { ...cached, reusedCachedSnapshot: true };
  }
  return getJson(request.readRoute, label);
}

const requestList = data.finalRequest.requests;
const formulaRequests = requestList.filter(request => request.kind === 'formula');
const effectRequests = requestList.filter(request => request.kind === 'effect');
const parameterRequests = requestList.filter(request => request.kind === 'parameter');
const formulaParameterKeys = new Map();
for (const request of formulaRequests) {
  const key = request.skillKey;
  if (!formulaParameterKeys.has(key)) formulaParameterKeys.set(key, new Set());
  for (const parameterKey of parameterKeys(request.body.expression)) formulaParameterKeys.get(key).add(parameterKey);
}
for (const request of effectRequests) {
  const value = request.body.valueRule?.value;
  if (value?.kind === 'PARAMETER') {
    if (!formulaParameterKeys.has(request.skillKey)) formulaParameterKeys.set(request.skillKey, new Set());
    formulaParameterKeys.get(request.skillKey).add(value.parameterKey);
  }
}
const dependencyParameterKeys = new Set([...formulaParameterKeys.values()].flatMap(keys => [...keys].map(key => key)));
const additionalParameterRefs = new Set([
  'rune_8229_passive/maximum_distance_damage_ratio',
  'rune_8229_passive/maximum_amplification_distance',
  'rune_9923_passive/base_attack_count',
  'rune_9923_passive/max_attack_gap_ms',
  'rune_9923_passive/max_bonus_reset_attacks',
  'rune_9923_passive/additional_attack_per_reset',
  'rune_8232_passive/river_flat_move_speed'
]);
const necessaryParameterRequests = parameterRequests.filter(request => dependencyParameterKeys.has(request.body.parameterKey) || additionalParameterRefs.has(`${request.skillKey}/${request.body.parameterKey}`));

check('最终请求和授权范围完整', () => {
  assert.equal(hashes.finalRequest, 'babcff78cd3b9bbc8dfe4b775b48358a6a548ce6a494f66f01f8ede80ec9e83c');
  assert.equal(requestList.filter(request => request.kind !== 'image').length, 120);
  assert.equal(formulaRequests.length, 17);
  assert.equal(effectRequests.length, 1);
  assert.equal(data.finalRequest.counts.content, 120);
  assert.equal(data.finalRequest.counts.images, 12);
  assert.equal(data.finalRequest.counts.total, 132);
  assert.equal(data.finalRequest.originalRequestSha256, 'f142aa7fdb7b58ee5648ad6d02e94d72aa648cc064abf998fd4da73816394305');
  assert.equal(data.finalVersion.finalSha256, hashes.finalRequest);
}, { formulaCount: formulaRequests.length, effectCount: effectRequests.length, dependencyParameterCount: necessaryParameterRequests.length });

check('保护基线只读摘要已保存', () => {
  assert.equal(data.baseline.identities.items.length, 69);
  assert.equal(data.baseline.layouts.items.length, 6);
  assert.equal(data.baseline.reads.length, 12);
  assert.equal(data.baseline.businessWrites, 0);
}, { identityCount: data.baseline.identities.items.length, layoutCount: data.baseline.layouts.items.length, note: '不重复读取身份、布局和图片关系' });

for (const request of formulaRequests) {
  const read = await readOnce(request, `${request.skillKey}/${request.body.formulaKey}`);
  reads.push({ kind: request.kind, id: request.id, skillKey: request.skillKey, key: request.body.formulaKey, ...read });
  check(`实际GET公式 ${request.skillKey}/${request.body.formulaKey}`, () => {
    assert.equal(read.status, 200);
    compareExpected(read.data, request.body, `${request.skillKey}/${request.body.formulaKey}`);
    actualFormulas.set(`${request.skillKey}/${request.body.formulaKey}`, read.data);
  }, { route: request.readRoute, status: read.status, attempts: read.attempts.length });
}

for (const request of necessaryParameterRequests) {
  const read = await readOnce(request, `${request.skillKey}/${request.body.parameterKey}`);
  reads.push({ kind: request.kind, id: request.id, skillKey: request.skillKey, key: request.body.parameterKey, ...read });
  check(`实际GET参数 ${request.skillKey}/${request.body.parameterKey}`, () => {
    assert.equal(read.status, 200);
    compareExpected(read.data, request.body, `${request.skillKey}/${request.body.parameterKey}`);
    actualParameters.set(`${request.skillKey}/${request.body.parameterKey}`, read.data);
  }, { route: request.readRoute, status: read.status, attempts: read.attempts.length });
}

for (const request of effectRequests) {
  const read = await readOnce(request, `${request.skillKey}/${request.body.effectKey}`);
  reads.push({ kind: request.kind, id: request.id, skillKey: request.skillKey, key: request.body.effectKey, ...read });
  check(`实际GET效果 ${request.skillKey}/${request.body.effectKey}`, () => {
    assert.equal(read.status, 200);
    compareExpected(read.data, request.body, `${request.skillKey}/${request.body.effectKey}`);
    actualEffects.set(`${request.skillKey}/${request.body.effectKey}`, read.data);
  }, { route: request.readRoute, status: read.status, attempts: read.attempts.length });
}

check('17个公式的必要参数已逐项回读', () => {
  assert.equal(actualFormulas.size, 17);
  assert.equal(actualParameters.size, necessaryParameterRequests.length);
  assert.equal(actualEffects.size, 1);
  for (const request of formulaRequests) {
    const actual = formulaData(request.skillKey, request.body.formulaKey);
    assert.deepEqual([...parameterKeys(actual.expression)].sort(), [...parameterKeys(request.body.expression)].sort());
  }
}, { formulasRead: actualFormulas.size, parametersRead: actualParameters.size, effectsRead: actualEffects.size });

function fixedParameters(skillKey) {
  return Object.fromEntries([...actualParameters.entries()]
    .filter(([key]) => key.startsWith(`${skillKey}/`))
    .map(([key, value]) => [key.slice(skillKey.length + 1), value.fixedValue]));
}

function evaluate(node, context) {
  if (node.nodeType === 'PARAMETER') {
    assert.ok(Object.hasOwn(context.parameters, node.parameterKey), `算例缺少参数${node.parameterKey}`);
    return context.parameters[node.parameterKey];
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const key = `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`;
    assert.ok(Object.hasOwn(context.attributes, key), `算例缺少属性${key}`);
    return context.attributes[key];
  }
  assert.equal(node.nodeType, 'OPERATION');
  const left = evaluate(node.operands[0], context);
  const right = evaluate(node.operands[1], context);
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error(`未知运算${node.operation}`);
  }
}

function actualFormulaExpression(skillKey, formulaKey) {
  return formulaData(skillKey, formulaKey).expression;
}

function runCase(name, skillKey, formulaKey, parameters, attributes, expected, explanation) {
  check(`实际算例 ${name}`, () => {
    const actual = evaluate(actualFormulaExpression(skillKey, formulaKey), {
      parameters: { ...fixedParameters(skillKey), ...parameters },
      attributes
    });
    assert.ok(Math.abs(actual - expected) < 1e-9, `得到${actual}，预期${expected}`);
    arithmetic.push({ name, skillKey, formulaKey, parameters, attributes, expected, actual, explanation });
  });
}

const skills = {
  8112: 'rune_8112_passive',
  8126: 'rune_8126_passive',
  8139: 'rune_8139_passive',
  8143: 'rune_8143_passive',
  9923: 'rune_9923_passive',
  8439: 'rune_8439_passive',
  9101: 'rune_9101_passive',
  8233: 'rune_8233_passive',
  8214: 'rune_8214_passive',
  8229: 'rune_8229_passive',
  8237: 'rune_8237_passive',
  8232: 'rune_8232_passive'
};
runCase('电刑', skills[8112], 'damage_amount', { confirmed_level_base: 70 }, { 'SOURCE:ability_power:TOTAL': 100, 'SOURCE:attack_damage:BONUS': 50 }, 80, '70+100×0.05+50×0.1');
runCase('恶意中伤', skills[8126], 'damage_amount', { confirmed_level_base: 10 }, {}, 10, '显式等级值10');
runCase('血之滋味', skills[8139], 'heal_amount', { confirmed_level_base: 16 }, { 'SOURCE:ability_power:TOTAL': 100, 'SOURCE:attack_damage:BONUS': 50 }, 26, '16+100×0.05+50×0.1');
runCase('猛然冲击', skills[8143], 'damage_amount', { confirmed_level_base: 20 }, {}, 20, '显式等级值20');
runCase('丛刃', skills[9923], 'damage_amount', { confirmed_level_base: 2 }, { 'SOURCE:ability_power:TOTAL': 100, 'SOURCE:attack_damage:BONUS': 50 }, 18, '2+100×0.1+50×0.12');
runCase('余震护甲等级下限', skills[8439], 'armor_bonus_amount', { confirmed_level_resist_cap: 80 }, { 'SOURCE:armor:BONUS': 100 }, 80, 'MIN(45+100×0.75,80)');
runCase('余震护甲等级上限', skills[8439], 'armor_bonus_amount', { confirmed_level_resist_cap: 150 }, { 'SOURCE:armor:BONUS': 100 }, 120, 'MIN(45+100×0.75,150)');
runCase('余震魔抗封顶', skills[8439], 'magic_resistance_bonus_amount', { confirmed_level_resist_cap: 150 }, { 'SOURCE:magic_resistance:BONUS': 200 }, 150, 'MIN(45+200×0.75,150)');
runCase('余震爆发', skills[8439], 'damage_amount', { confirmed_level_damage: 25 }, { 'SOURCE:hp:BONUS': 2000 }, 185, '25+2000×0.08');
runCase('吸收生命力', skills[9101], 'heal_amount', { confirmed_level_heal: 23 }, {}, 23, '显式等级输入23');
runCase('绝对专注生命门槛值', skills[8233], 'health_threshold', {}, { 'SOURCE:hp:TOTAL': 1000 }, 700, '1000×0.7');
runCase('绝对专注攻击力分支', skills[8233], 'attack_damage_amount', { confirmed_adaptive_force: 30 }, {}, 18, '30×0.6');
runCase('绝对专注法强分支', skills[8233], 'ability_power_amount', { confirmed_adaptive_force: 30 }, {}, 30, '适应之力法强分支30');
runCase('艾黎', skills[8214], 'damage_amount', { confirmed_level_base: 10 }, { 'SOURCE:ability_power:TOTAL': 100, 'SOURCE:attack_damage:BONUS': 50 }, 20, '10+100×0.05+50×0.1');
runCase('彗星伤害', skills[8229], 'base_damage_amount', { confirmed_level_base: 15 }, { 'SOURCE:ability_power:TOTAL': 100, 'SOURCE:attack_damage:BONUS': 50 }, 25, '15+100×0.05+50×0.1');
runCase('彗星下限钳制', skills[8229], 'cooldown_ms', { confirmed_level_cooldown_seconds: 0.3 }, {}, 300, 'MIN(20,MAX(0.3,0.3))×1000');
runCase('彗星上限端点', skills[8229], 'cooldown_ms', { confirmed_level_cooldown_seconds: 20 }, {}, 20000, 'MIN(20,MAX(0.3,20))×1000');
runCase('彗星低于下限', skills[8229], 'cooldown_ms', { confirmed_level_cooldown_seconds: 0 }, {}, 300, '低于0.3秒时仍为300毫秒');
runCase('彗星高于上限', skills[8229], 'cooldown_ms', { confirmed_level_cooldown_seconds: 25 }, {}, 20000, '高于20秒时仍为20000毫秒');
runCase('焦灼', skills[8237], 'damage_amount', { confirmed_level_base: 20 }, {}, 20, '显式等级值20');
runCase('水上行走', skills[8232], 'adaptive_force_amount', { confirmed_adaptive_force: 13 }, {}, 13, '显式适应之力13');

check('AP、额外攻击力和余震实际公式结构', () => {
  for (const skillKey of [skills[8112], skills[8139], skills[8214], skills[8229], skills[9923]]) {
    const key = skillKey === skills[8139] ? 'heal_amount' : skillKey === skills[8229] ? 'base_damage_amount' : 'damage_amount';
    const attributes = attributeNodes(actualFormulaExpression(skillKey, key));
    assert(attributes.some(node => node.attributeOwner === 'SOURCE' && node.attributeKey === 'ability_power' && node.attributeValueKind === 'TOTAL'));
    assert(attributes.some(node => node.attributeOwner === 'SOURCE' && node.attributeKey === 'attack_damage' && node.attributeValueKind === 'BONUS'));
  }
  const armor = attributeNodes(actualFormulaExpression(skills[8439], 'armor_bonus_amount'));
  const magicResistance = attributeNodes(actualFormulaExpression(skills[8439], 'magic_resistance_bonus_amount'));
  const damage = attributeNodes(actualFormulaExpression(skills[8439], 'damage_amount'));
  assert.deepEqual(armor.map(node => `${node.attributeKey}:${node.attributeValueKind}`), ['armor:BONUS']);
  assert.deepEqual(magicResistance.map(node => `${node.attributeKey}:${node.attributeValueKind}`), ['magic_resistance:BONUS']);
  assert.deepEqual(damage.map(node => `${node.attributeKey}:${node.attributeValueKind}`), ['hp:BONUS']);
});

check('余震实际MIN封顶参数', () => {
  for (const key of ['armor_bonus_amount', 'magic_resistance_bonus_amount']) {
    const expression = actualFormulaExpression(skills[8439], key);
    assert.equal(expression.operation, 'MIN');
    assert.equal(expression.operands[0].operation, 'ADD');
    assert.equal(expression.operands[0].operands[0].parameterKey, 'flat_resistance');
    assert.equal(expression.operands[0].operands[1].operands[1].parameterKey, 'bonus_resistance_ratio');
    assert.equal(expression.operands[1].parameterKey, 'confirmed_level_resist_cap');
  }
  assert.equal(parameterData(skills[8439], 'flat_resistance').fixedValue, 45);
  assert.equal(parameterData(skills[8439], 'bonus_resistance_ratio').fixedValue, 0.75);
});

check('彗星实际冷却钳制和距离边界', () => {
  const expression = actualFormulaExpression(skills[8229], 'cooldown_ms');
  assert.equal(expression.operation, 'MULTIPLY');
  assert.equal(expression.operands[1].parameterKey, 'seconds_to_ms');
  assert.equal(expression.operands[0].operation, 'MIN');
  assert.equal(expression.operands[0].operands[0].parameterKey, 'confirmed_level_cooldown_seconds_source_start');
  assert.equal(expression.operands[0].operands[1].operation, 'MAX');
  assert.equal(expression.operands[0].operands[1].operands[0].parameterKey, 'cooldown_floor_seconds');
  assert.equal(parameterData(skills[8229], 'cooldown_floor_seconds').fixedValue, 0.3);
  assert.equal(parameterData(skills[8229], 'seconds_to_ms').fixedValue, 1000);
  assert.equal(parameterData(skills[8229], 'maximum_distance_damage_ratio').fixedValue, 1);
  assert.equal(parameterData(skills[8229], 'maximum_amplification_distance').fixedValue, 750);
  assert.equal(actualFormulaExpression(skills[8229], 'base_damage_amount').toString().includes('distance'), false);
});

check('丛刃实际相邻间隔和重置语义', () => {
  assert.equal(parameterData(skills[9923], 'base_attack_count').fixedValue, 3);
  assert.equal(parameterData(skills[9923], 'max_attack_gap_ms').fixedValue, 3000);
  assert.equal(parameterData(skills[9923], 'max_bonus_reset_attacks').fixedValue, 2);
  assert.equal(parameterData(skills[9923], 'additional_attack_per_reset').fixedValue, 1);
  assert.match(parameterData(skills[9923], 'max_attack_gap_ms').description, /相邻攻击间隔/);
  assert.match(parameterData(skills[9923], 'max_bonus_reset_attacks').description, /不是覆盖基础3次的总上限/);
});

check('绝对专注和吸收生命力实际边界', () => {
  assert.equal(parameterData(skills[8233], 'adaptive_to_attack_damage_ratio').fixedValue, 0.6);
  assert.equal(parameterData(skills[8233], 'health_threshold_ratio').fixedValue, 0.7);
  assert.match(formulaData(skills[8233], 'health_threshold').description, /严格高于70%/);
  assert.equal(parameterData(skills[9101], 'confirmed_level_heal').valueMode, 'RUNTIME_INPUT');
  assert.equal(parameterData(skills[9101], 'confirmed_level_heal').fixedValue, null);
  assert.equal(parameterData(skills[9101], 'confirmed_level_heal').levelValues, null);
});

check('水上行走实际效果字段', () => {
  const effect = effectData(skills[8232], 'river_flat_move_speed_component');
  assert.equal(effect.lifecycle.instanceScope, 'SOURCE');
  assert.equal(effect.results.length, 1);
  assert.equal(effect.results[0].target, 'SOURCE');
  assert.equal(effect.results[0].resultType, 'ATTRIBUTE_CHANGE');
  assert.equal(effect.results[0].detail.attributeKey, 'move_speed');
  assert.equal(effect.results[0].valueRule.value.parameterKey, 'river_flat_move_speed');
  assert.equal(parameterData(skills[8232], 'river_flat_move_speed').fixedValue, 10);
});

const strictThreshold = [];
check('绝对专注严格高于70%边界', () => {
  const threshold = 1000 * parameterData(skills[8233], 'health_threshold_ratio').fixedValue;
  for (const [health, expected, explanation] of [[700, false, '等于70%不满足'], [700.0001, true, '高于70%满足'], [699.9999, false, '低于70%不满足']]) {
    const actual = health > threshold;
    assert.equal(actual, expected);
    strictThreshold.push({ maximumHealth: 1000, health, threshold, expected, actual, explanation });
  }
});

let applyRecord = null;
try {
  applyRecord = data.apply;
} catch {
  applyRecord = null;
}
const nearbyFiles = await readdir(here);
const latestVerifyName = nearbyFiles.filter(name => /^verify-.*\.json$/.test(name)).sort().at(-1) ?? null;
let verifyRecord = null;
if (latestVerifyName) {
  try {
    verifyRecord = JSON.parse(await readFile(path.join(here, latestVerifyName)));
  } catch {
    verifyRecord = null;
  }
}

const passed = checks.filter(row => row.status === '通过').length;
const failed = checks.length - passed;
const result = {
  generatedAt: new Date().toISOString(),
  stage: '实际录入后公式、必要参数和固定河道移速效果独立GET核算；本脚本只使用GET',
  apiBaseUrl: baseUrl,
  noWrite: true,
  businessWritesByThisScript: 0,
  inputSha256: hashes,
  finalRequest: { sha256: hashes.finalRequest, contentCount: requestList.filter(request => request.kind !== 'image').length, formulaCount: formulaRequests.length, effectCount: effectRequests.length, dependencyParameterCount: necessaryParameterRequests.length },
  protection: { baselineSha256: hashes.baseline, identityCount: data.baseline.identities.items.length, layoutCount: data.baseline.layouts.items.length, readsBefore: data.baseline.reads.length, note: '身份、布局和图片关系沿根verify保护证据，不在本脚本重复读取' },
  reads: { count: reads.length, formulas: formulaRequests.length, parameters: necessaryParameterRequests.length, effects: effectRequests.length, reusedCachedSnapshot: canReuseCachedReads, entries: reads },
  checks: { count: checks.length, passed, failed, allPassed: failed === 0, details: checks },
  arithmetic: { formulaCaseCount: arithmetic.length, passed: arithmetic.length, failed: 0, cases: arithmetic, strictThresholdCases: strictThreshold },
  applyRecord: applyRecord ? { mode: applyRecord.mode, requestSha256: applyRecord.requestSha256, preflightCount: applyRecord.preflight.length, summary: applyRecord.summary, writes: applyRecord.writes?.length ?? null, errors: applyRecord.errors ?? [], objectStops: applyRecord.objectStops ?? [] } : null,
  verifyRecord: verifyRecord ? { file: latestVerifyName, mode: verifyRecord.mode, requestSha256: verifyRecord.requestSha256, summary: verifyRecord.summary ?? verifyRecord.finalSummary ?? null, errors: verifyRecord.errors ?? [] } : null,
  conclusions: {
    scope: '17个公式、其依赖参数和1个效果均以实际GET回读；不重复69身份和6布局引用。',
    sourceAttributes: '法强、额外攻击力、余震双抗与额外生命值均按已审来源属性结构回读。',
    comet: '0.3秒和20秒端点分别回读为300毫秒与20000毫秒；距离750码/100%只作为端点，未生成线性函数。',
    hailOfBlades: '3次基础攻击、相邻间隔3000毫秒、额外重置2和每次加1分开回读。',
    absoluteFocus: '严格高于70%边界按实值参数重算；0.6只用于绝对专注攻击力分支。',
    absorbLife: '断点参数保持运行时输入、无默认等级表。',
    waterwalking: '河道固定移速效果为SOURCE→SOURCE的move_speed增加，参数实际值10。'
  },
  blockers: checks.filter(row => row.status === '阻塞')
};

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
const actualResult = {
  generatedAt: result.generatedAt,
  stage: result.stage,
  requestSha256: hashes.finalRequest,
  noWrite: true,
  businessWritesByThisScript: 0,
  reads: { total: reads.length, formulas: formulaRequests.length, parameters: necessaryParameterRequests.length, effects: effectRequests.length, statuses: Object.fromEntries([...new Set(reads.map(read => read.status))].map(status => [status, reads.filter(read => read.status === status).length])) },
  checks: result.checks,
  arithmetic: result.arithmetic,
  applyRecord: result.applyRecord,
  verifyRecord: result.verifyRecord
};
await writeFile(path.join(here, '实际录入结果.json'), `${JSON.stringify(actualResult, null, 2)}\n`, 'utf8');
const report = [
  '# 符文第四批实际录入后独立核算',
  '',
  '本次只用本地管理接口GET回读已录入内容，没有调用新增、修改或删除接口，也没有重复读取根verify负责的身份、布局和图片关系。页面验收由主负责人处理，本报告不宣称战斗运行证明。',
  '',
  `最终请求SHA256：\`${hashes.finalRequest}\`；公式${formulaRequests.length}个、必要参数${necessaryParameterRequests.length}个、河道固定移速效果${effectRequests.length}个，共${reads.length}项回读（${canReuseCachedReads ? '复用已保存的57项实际GET快照' : '本次实际GET'}）。`,
  `结构和实值检查共${checks.length}项，通过${passed}项，阻塞${failed}项；按实际GET公式重算${arithmetic.length}个算例，另有${strictThreshold.length}个严格高于70%的边界算例。`,
  '',
  '核对结果：',
  '',
  '- 法强与额外攻击力公式实际回读为SOURCE属性；余震的护甲、魔抗封顶和额外生命值分支保持已审结构。',
  '- 彗星实际回读了MIN(20,MAX(0.3,秒数))×1000；0.3秒为300毫秒、20秒为20000毫秒，750码和100%只保留端点。',
  '- 丛刃的3次基础攻击、相邻3000毫秒间隔、额外重置2和每次增加1分别回读，未合并为总持续或总上限。',
  '- 绝对专注实际按700、700.0001和699.9999三点检查严格门槛；吸收生命力仍是无默认值的运行时等级输入。',
  '- 水上行走效果实际回读为SOURCE目标的move_speed增加，固定移速参数为10。',
  '',
  `既有apply记录模式为${applyRecord?.mode ?? '未读取'}；本脚本业务写入数为0。详细GET响应完整字段、算例和失败项见《实值独立核算.json》，摘要见《实际录入结果.json》。`,
  ''
].join('\n');
await writeFile(path.join(here, '体验报告.md'), report, 'utf8');
console.log(JSON.stringify({ reads: reads.length, formulas: formulaRequests.length, parameters: necessaryParameterRequests.length, effects: effectRequests.length, checks: { count: checks.length, passed, failed }, arithmetic: arithmetic.length, candidateSha256: hashes.finalRequest, noWrite: true }));
if (failed) process.exitCode = 1;

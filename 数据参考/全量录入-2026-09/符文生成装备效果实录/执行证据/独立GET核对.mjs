import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(DIR, '..');
const CANDIDATE_DIR = path.join(ARTIFACTS, 'rune-equipment-ownership-luna-candidate', '修订一');
const ROOT_DIR = path.join(ARTIFACTS, 'rune-equipment-ownership-root-20260910');
const EXEC_DIR = DIR;
const BASE_URL = 'http://127.0.0.1:8080';
const API_PREFIX = '/api/admin/games/lol';
const OLD_SKILL = 'rune_8304_passive';
const OLD_EFFECT = 'magical_footwear_additional_speed';
const SERVER_ONLY_FIELDS = new Set(['gameId', 'createdAt', 'updatedAt', 'skillKey', 'enabled', 'name', 'resultCount', 'lifecycleEnabled']);
const EXPECTED = Object.freeze({
  candidate: '81f13a8676254cd7db18d40e5fffe9c54bea98ea45651963a112e7f3b55a460a',
  plan: '8d63f461adff0fe79803a5422e2177f67e66c0b6856de1fad05d1d457380cce0',
  math: '3c6f4d997e4146795d4b6173c86a7b2392e382d66949cb360c58f0dcc1f058f0',
  migration: 'a5a9a6079d0a76e1a22d1655fe34a9924783f034727b912889681b6848507cc0',
  snapshot: '293b263cac1da4aad9d8e06f2d1c565fbcd12acd19aa2a748d5eb76796059304',
  supplementary: 'f270f6179322e797fa92b40fc67a26ed12104f1e544e418a63b5c5e0f7b782f1',
  oldReference: '71003cd779663be9e148b078af28684fb8528364b2921928203742219ac4f9f8'
});
const RELATION_FIELDS = ['gameId', 'equipmentKey', 'skillKey', 'sortOrder'];

function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function readPinned(file, expected) {
  const bytes = fs.readFileSync(file);
  const actual = hash(bytes);
  if (actual !== expected) throw new Error('冻结文件散列不一致: ' + file + '; actual=' + actual + '; expected=' + expected);
  return bytes;
}
function jsonPinned(file, expected) { return JSON.parse(readPinned(file, expected).toString('utf8')); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function same(a, b) { return canonical(a) === canonical(b); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function iso(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function nowId() { return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'); }
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }
function write(file, data) {
  ensure(path.dirname(file));
  const temp = file + '.tmp-' + process.pid + '-' + Date.now();
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
}
function append(file, data) {
  ensure(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(data) + '\n', 'utf8');
  const fd = fs.openSync(file, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function inside(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (object(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = /(authorization|bearer|token|cookie|password|secret|credential)/i.test(key) ? '[已隐藏]' : redact(item);
    }
    return out;
  }
  if (typeof value === 'string' && /^Bearer\s/i.test(value)) return '[已隐藏]';
  return value;
}
function args(argv) {
  if (!argv.length) return { mode: 'validate-only', runDir: null };
  if (argv.length === 2 && argv[0] === '--run') {
    if (!argv[1]) throw new Error('--run缺少实际写入目录');
    return { mode: 'run', runDir: argv[1] };
  }
  if (argv.length === 1 && argv[0] === '--validate-only') return { mode: 'validate-only', runDir: null };
  throw new Error('独立核对器只接受--validate-only或--run <实际写入目录>');
}

function entries(candidate) {
  const list = [];
  for (const item of candidate.objects) {
    const p = item.apiPayload;
    const skill = item.skillKey;
    list.push({ id: skill + '-skill', kind: 'skill', method: 'POST', skillKey: skill, equipmentKey: item.equipmentKey, path: API_PREFIX + '/skills', read: API_PREFIX + '/skills/' + skill, body: p.skill });
    for (const type of ['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules']) {
      const segment = type === 'internalStates' ? 'internal-states' : type === 'triggerRules' ? 'trigger-rules' : type;
      const keyName = type === 'parameters' ? 'parameterKey' : type === 'formulas' ? 'formulaKey' : type === 'effects' ? 'effectKey' : type === 'processes' ? 'processKey' : type === 'internalStates' ? 'stateKey' : 'triggerRuleKey';
      const idPart = type === 'internalStates' ? 'internal-state' : type === 'triggerRules' ? 'trigger-rule' : type.slice(0, -1);
      for (const body of p[type] || []) {
        const key = body[keyName];
        list.push({ id: skill + '-' + idPart + '-' + key, kind: type, method: 'POST', skillKey: skill, equipmentKey: item.equipmentKey, path: API_PREFIX + '/skills/' + skill + '/' + segment, read: API_PREFIX + '/skills/' + skill + '/' + segment + '/' + encodeURIComponent(key), body });
      }
    }
    list.push({ id: skill + '-equipment-skill-relation', kind: 'relation', method: 'POST', skillKey: skill, equipmentKey: item.equipmentKey, path: API_PREFIX + '/equipment-skill-relations', read: API_PREFIX + '/equipment-skill-relations?equipmentKey=' + encodeURIComponent(item.equipmentKey) + '&skillKey=' + encodeURIComponent(skill), body: item.relation });
    list.push({ id: skill + '-representative-image', kind: 'image', method: 'PUT', skillKey: skill, equipmentKey: item.equipmentKey, path: API_PREFIX + '/skills/' + skill + '/representative-image', read: API_PREFIX + '/skills/' + skill + '/representative-image', body: item.representativeImage });
  }
  return list;
}

function staticValidate(candidate, plan, math, migration, snapshot, supplementary, oldReference) {
  assert(candidate.gameId === 'lol' && candidate.officialVersion === '16.17.1', '候选版本不正确');
  assert(candidate.rootRevision?.revision === '修订一' && candidate.rootRevision.unchangedShoeMigration === true, '候选修订或迁移意图不正确');
  assert(candidate.apiWrites?.executed === false && candidate.objects?.length === 4, '候选执行状态或装备数不正确');
  assert(candidate.totals?.newParameters === 12 && candidate.totals?.newFormulas === 3 && candidate.totals?.newEffects === 2, '候选新对象计数不正确');
  assert(plan.execute === false && plan.rootRevision === '修订一' && plan.candidateSha256 === EXPECTED.candidate, '计划没有绑定冻结候选');
  assert(plan.writeRequests?.length === 30, '计划不是30写请求');
  const methods = plan.writeRequests.reduce((out, x) => { out[x.method] = (out[x.method] || 0) + 1; return out; }, {});
  assert(methods.POST === 25 && methods.PUT === 4 && methods.DELETE === 1, '计划方法计数不正确');
  const derived = new Map(entries(candidate).map((x) => [x.id, x]));
  for (const request of plan.writeRequests) {
    assert(request.execute === false && request.path?.startsWith(API_PREFIX), '计划含非冻结请求: ' + request.id);
    if (request.method !== 'DELETE') {
      const source = derived.get(request.id);
      assert(source && source.method === request.method && source.path === request.path && same(source.body, request.body), '计划body与候选不一致: ' + request.id);
    }
  }
  assert(math.status === '通过' && math.checks?.errorCount === 0, '独立数学报告未通过');
  assert(migration && migration.passed !== false, '迁移意图不允许');
  assert(snapshot.GETs === 72 && snapshot.businessWrites === 0 && snapshot.requests.length === 72, '保护快照不为72 GET/零写入');
  assert(supplementary.GETs === 6 && supplementary.businessWrites === 0 && supplementary.requests.length === 6, '补充保护快照不为6 GET/零写入');
  const oldImageRoute = '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT + '/representative-image';
  const oldImage = supplementary.requests.find((x) => x.route === oldImageRoute);
  assert(oldImage && oldImage.status === 200 && same(oldImage.data, { image: null }), '补充快照缺少旧效果代表图空值证据');
  assert(oldReference.passed === true && Array.isArray(oldReference.inboundReferences) && oldReference.inboundReferences.length === 0 && Array.isArray(oldReference.imageRelations) && oldReference.imageRelations.length === 0, '旧效果引用证据未通过');
  const attrs = new Set((snapshot.requests.find((x) => x.route === '/attributes')?.data?.items || []).map((x) => x.attributeKey));
  const zones = new Set((snapshot.requests.find((x) => x.route === '/modifier-zones')?.data?.items || []).map((x) => x.modifierZoneKey));
  for (const item of candidate.objects) {
    const p = item.apiPayload;
    const params = new Set((p.parameters || []).map((x) => x.parameterKey));
    const formulas = new Set((p.formulas || []).map((x) => x.formulaKey));
    for (const parameter of p.parameters || []) {
      if (parameter.valueMode === 'FIXED') {
        assert(finite(parameter.fixedValue), '固定参数非有限值: ' + parameter.parameterKey);
        if (parameter.valueType === 'INTEGER') assert(Number.isInteger(parameter.fixedValue), '整数参数含小数: ' + parameter.parameterKey);
      }
      if (parameter.valueMode === 'RUNTIME_INPUT') assert(parameter.fixedValue == null && parameter.levelValues == null, '运行输入有默认值: ' + parameter.parameterKey);
      if (parameter.parameterKey.endsWith('_ms')) assert(parameter.valueType === 'INTEGER' && Number.isInteger(parameter.fixedValue), '毫秒参数不为整数: ' + parameter.parameterKey);
      const levels = parameter.levelValues == null ? [] : Array.isArray(parameter.levelValues) ? parameter.levelValues : Object.values(parameter.levelValues);
      for (const value of levels) {
        assert(finite(value), '等级参数非有限值: ' + parameter.parameterKey);
        if (parameter.valueType === 'INTEGER') assert(Number.isInteger(value), '等级整数参数含小数: ' + parameter.parameterKey);
      }
    }
    const visit = (node, key) => {
      assert(object(node) && typeof node.nodeType === 'string', '公式节点非法: ' + key);
      if (node.nodeType === 'PARAMETER') assert(params.has(node.parameterKey), '公式参数悬空: ' + key);
      else if (node.nodeType === 'ATTRIBUTE') assert(attrs.has(node.attributeKey), '公式属性不存在: ' + key);
      else if (node.nodeType === 'OPERATION') {
        assert(Array.isArray(node.operands) && node.operands.length === 2, '公式不是二元运算: ' + key);
        node.operands.forEach((child) => visit(child, key));
      } else throw new Error('公式节点类型不允许: ' + node.nodeType);
    };
    for (const formula of p.formulas || []) visit(formula.expression, formula.formulaKey);
    for (const effect of p.effects || []) {
      for (const result of effect.results || []) {
        if (result.detail?.attributeKey != null) assert(attrs.has(result.detail.attributeKey), '效果属性不存在: ' + effect.effectKey);
        if (result.detail?.modifierZoneKey != null) assert(zones.has(result.detail.modifierZoneKey), '效果乘区不存在: ' + effect.effectKey);
        const value = result.valueRule?.value;
        if (value?.kind === 'PARAMETER') assert(params.has(value.parameterKey), '效果参数悬空: ' + effect.effectKey);
        if (value?.kind === 'FORMULA') assert(formulas.has(value.formulaKey), '效果公式悬空: ' + effect.effectKey);
        if (value != null) assert(value.kind === 'PARAMETER' || value.kind === 'FORMULA' || value.kind === 'FIXED', '效果值类型不允许: ' + effect.effectKey);
        for (const number of [result.valueRule?.fixedMultiplier, result.valueRule?.fixedMinValue, result.valueRule?.fixedMaxValue]) {
          if (number != null) assert(finite(number), '效果固定值非有限数: ' + effect.effectKey);
        }
      }
    }
  }
}

function relationCore(row) { return Object.fromEntries(RELATION_FIELDS.map((key) => [key, row?.[key]])); }
function relation(data, equipmentKey, skillKey) {
  assert(object(data) && Array.isArray(data.items) && Number.isInteger(data.total), '关系响应不是items+total');
  assert(data.total === data.items.length, '关系total与items不一致');
  assert(data.hasNext !== true && !(typeof data.pageSize === 'number' && data.total > data.items.length), '关系分页未取全');
  assert(data.items.length === 1, '目标装备关系不是恰好一条');
  assert(same(relationCore(data.items[0]), { gameId: 'lol', equipmentKey, skillKey, sortOrder: 10 }), '关系核心字段不一致: ' + equipmentKey);
  for (const key of ['createdAt', 'updatedAt']) if (key in data.items[0]) assert(iso(data.items[0][key]), '关系时间字段非法: ' + key);
}
function expectedProjection(expected, actual) {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((value, index) => expectedProjection(value, actual[index]));
  if (object(expected)) {
    return object(actual)
      && Object.keys(actual).every((key) => Object.hasOwn(expected, key) || SERVER_ONLY_FIELDS.has(key))
      && Object.entries(expected).every(([key, value]) => expectedProjection(value, actual[key]));
  }
  return Object.is(expected, actual);
}
function baseline(snapshot, route) { return snapshot.requests.find((x) => x.route === route); }

async function get(route, context) {
  assert(route.startsWith(API_PREFIX) && !route.includes('://') && !route.includes('..'), 'GET路径越界: ' + route);
  const log = { at: new Date().toISOString(), method: 'GET', route, authorizationLogged: false };
  append(context.logFile, { type: 'request', ...log });
  const headers = { Accept: 'application/json' };
  const token = process.env.RUNE_EQUIPMENT_OWNERSHIP_TOKEN;
  if (token) headers.Authorization = token.startsWith('Bearer ') ? token : 'Bearer ' + token;
  let response;
  let text = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      response = await fetch(BASE_URL + route, { method: 'GET', headers, signal: controller.signal });
      text = await response.text();
    } finally { clearTimeout(timer); }
  } catch (error) {
    append(context.logFile, { type: 'response', ...log, status: null, error: '请求失败: ' + error.message });
    throw new Error('独立GET未知网络结果: ' + route);
  }
  let data = null;
  let parseError = null;
  if (text.length) {
    try { data = JSON.parse(text); } catch (error) { parseError = error.message; }
  }
  append(context.logFile, { type: 'response', ...log, status: response.status, emptyBody: text.length === 0, responseBytes: Buffer.byteLength(text), responseSha256: hash(Buffer.from(text)), parseError, data: redact(data) });
  context.calls += 1;
  return { status: response.status, data };
}

async function verifyFinal(frozen, context) {
  const observations = [];
  for (const item of frozen.snapshot.requests) {
    const r = await get(API_PREFIX + item.route, context);
    const oldDetail = item.route === '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT;
    const oldList = item.route === '/skills/' + OLD_SKILL + '/effects';
    const oldImage = item.route === '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT + '/representative-image';
    if (oldDetail || oldImage) assert(r.status === 404, '旧效果详情或图片未404: ' + item.route);
    else if (oldList) assert(r.status === 200 && Array.isArray(r.data) && r.data.length === 0, '旧效果列表不是空数组');
    else {
      const rel = item.route.match(/^\/equipment-skill-relations\?equipmentKey=([^&]+)/);
      if (rel) {
        const equipmentKey = decodeURIComponent(rel[1]);
        const target = frozen.candidate.objects.find((x) => x.equipmentKey === equipmentKey);
        assert(r.status === 200, '最终装备关系不是200: ' + equipmentKey);
        relation(r.data, equipmentKey, target.skillKey);
      } else assert(r.status === item.status && same(r.data, item.data), '保护对象已改变: ' + item.route);
    }
    observations.push({ route: item.route, status: r.status, data: redact(r.data) });
  }
  const oldImageRoute = frozen.supplementary.requests.find((x) => x.route === '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT + '/representative-image');
  assert(oldImageRoute, '补充快照缺少旧效果代表图');
  const oldImage = await get(API_PREFIX + oldImageRoute.route, context);
  assert(oldImage.status === 404, '最终旧效果代表图未404');
  observations.push({ route: oldImageRoute.route, status: oldImage.status, data: redact(oldImage.data), source: 'supplementary' });
  const seen = new Set();
  for (const entry of entries(frozen.candidate)) {
    if (seen.has(entry.read)) continue;
    seen.add(entry.read);
    const r = await get(entry.read, context);
    if (entry.kind === 'relation') {
      assert(r.status === 200, '候选关系详情不是200: ' + entry.id);
      relation(r.data, entry.equipmentKey, entry.skillKey);
    } else if (entry.kind === 'image') {
      assert(r.status === 200 && expectedProjection(entry.body, r.data?.image), '候选代表图不一致: ' + entry.id);
    } else {
      assert(r.status === 200 && expectedProjection(entry.body, r.data), '候选对象详情不一致: ' + entry.id);
    }
    observations.push({ id: entry.id, route: entry.read, status: r.status, data: redact(r.data) });
  }
  return observations;
}

async function run(frozen, runDir) {
  const absolute = path.resolve(runDir);
  assert(inside(absolute, path.join(EXEC_DIR, '实际写入')) && absolute !== path.join(EXEC_DIR, '实际写入'), '最终GET目录必须在实际写入目录内');
  const executionReport = JSON.parse(fs.readFileSync(path.join(absolute, '执行结果.json'), 'utf8'));
  assert(executionReport.status === 'COMPLETED', '实际写入报告不是COMPLETED');
  assert(executionReport.candidateSha256 === EXPECTED.candidate && executionReport.planSha256 === EXPECTED.plan, '实际写入报告散列不一致');
  const outputDir = path.join(EXEC_DIR, '独立GET核对', nowId());
  ensure(outputDir);
  const context = { logFile: path.join(outputDir, 'GET日志.jsonl'), calls: 0 };
  let observations;
  try {
    observations = await verifyFinal(frozen, context);
    const report = { generatedAt: new Date().toISOString(), status: 'GET_REVIEW_PASS', runDir: absolute, getCalls: context.calls, businessWrites: 0, authorizationLogged: false, candidateSha256: EXPECTED.candidate, planSha256: EXPECTED.plan, mathSha256: EXPECTED.math, oldReferenceSha256: EXPECTED.oldReference, protectedGETBaseline: 72, observedRoutes: observations.length, databaseAccessed: false, browserAccessed: false, gitAccessed: false };
    write(path.join(outputDir, 'GET复核报告.json'), report);
    write(path.join(outputDir, '最终GET快照.json'), { generatedAt: report.generatedAt, observations });
    console.log(JSON.stringify({ ...report, outputDir }, null, 2));
  } catch (error) {
    const report = { generatedAt: new Date().toISOString(), status: 'GET_REVIEW_STOPPED', runDir: absolute, getCalls: context.calls, businessWrites: 0, authorizationLogged: false, stopReason: error.message };
    write(path.join(outputDir, 'GET复核报告.json'), report);
    throw error;
  }
}

async function main() {
  const mode = args(process.argv.slice(2));
  const candidate = jsonPinned(path.join(CANDIDATE_DIR, '完整候选.json'), EXPECTED.candidate);
  const plan = jsonPinned(path.join(CANDIDATE_DIR, '写前请求计划.json'), EXPECTED.plan);
  const math = jsonPinned(path.join(CANDIDATE_DIR, '独立数学报告.json'), EXPECTED.math);
  const migration = jsonPinned(path.join(ARTIFACTS, 'rune-equipment-ownership-luna-candidate', '神奇之鞋迁移意图.json'), EXPECTED.migration);
  const snapshot = jsonPinned(path.join(ROOT_DIR, '当前保护快照.json'), EXPECTED.snapshot);
  const supplementary = jsonPinned(path.join(ROOT_DIR, '补充查重与分类.json'), EXPECTED.supplementary);
  const oldReference = jsonPinned(path.join(ROOT_DIR, '旧鞋效果真实引用只读核对.json'), EXPECTED.oldReference);
  staticValidate(candidate, plan, math, migration, snapshot, supplementary, oldReference);
  if (mode.mode === 'validate-only') {
    console.log(JSON.stringify({ status: 'STATIC_VALIDATION_PASS', mode: mode.mode, businessApiCalls: 0, businessWrites: 0, getOnly: true, candidateSha256: EXPECTED.candidate, planSha256: EXPECTED.plan, mathSha256: EXPECTED.math, plannedWrites: { total: 30, POST: 25, PUT: 4, DELETE: 1 } }, null, 2));
    return;
  }
  await run({ candidate, plan, math, migration, snapshot, supplementary, oldReference }, mode.runDir);
}
main().catch((error) => {
  console.error(JSON.stringify({ status: 'GET_REVIEW_STOPPED', error: error.message, businessWrites: 0, authorizationLogged: false }, null, 2));
  process.exitCode = 1;
});

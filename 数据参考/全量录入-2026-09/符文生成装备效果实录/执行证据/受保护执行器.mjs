import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(DIR, '..');
const CANDIDATE_DIR = path.join(ARTIFACTS, 'rune-equipment-ownership-luna-candidate', '修订一');
const ROOT_DIR = path.join(ARTIFACTS, 'rune-equipment-ownership-root-20260910');
const CURSOR_DIR = path.join(ARTIFACTS, 'rune-equipment-ownership-v3-cursor-review-run-20260910');
const EXEC_DIR = DIR;
const BASE_URL = 'http://127.0.0.1:8080';
const API_PREFIX = '/api/admin/games/lol';
const NODE_RUNTIME = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe';
const EXEC_CONFIRM = 'CONFIRM_RUNE_EQUIPMENT_OWNERSHIP_30_WRITES';
const EXPECTED = Object.freeze({
  candidate: '81f13a8676254cd7db18d40e5fffe9c54bea98ea45651963a112e7f3b55a460a',
  plan: '8d63f461adff0fe79803a5422e2177f67e66c0b6856de1fad05d1d457380cce0',
  math: '3c6f4d997e4146795d4b6173c86a7b2392e382d66949cb360c58f0dcc1f058f0',
  migration: 'a5a9a6079d0a76e1a22d1655fe34a9924783f034727b912889681b6848507cc0',
  snapshot: '293b263cac1da4aad9d8e06f2d1c565fbcd12acd19aa2a748d5eb76796059304',
  supplementary: 'f270f6179322e797fa92b40fc67a26ed12104f1e544e418a63b5c5e0f7b782f1',
  oldReference: '71003cd779663be9e148b078af28684fb8528364b2921928203742219ac4f9f8',
  cursorV3: 'd1cec1483504f62bcab560bd881a58fe0c39209cb4991eb274e28c2690998a15'
});
const OLD_SKILL = 'rune_8304_passive';
const OLD_EFFECT = 'magical_footwear_additional_speed';
const RELATION_FIELDS = ['gameId', 'equipmentKey', 'skillKey', 'sortOrder'];
const SERVER_ONLY_FIELDS = new Set(['gameId', 'createdAt', 'updatedAt', 'skillKey', 'enabled', 'name', 'resultCount', 'lifecycleEnabled']);

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function readPinned(file, hash) {
  const bytes = fs.readFileSync(file);
  const actual = sha256Bytes(bytes);
  if (actual !== hash) throw new Error('冻结文件散列不一致: ' + file + '; actual=' + actual + '; expected=' + hash);
  return bytes;
}
function jsonPinned(file, hash) {
  return JSON.parse(readPinned(file, hash).toString('utf8'));
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function same(a, b) { return canonical(a) === canonical(b); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function isFiniteNumber(value) { return typeof value === 'number' && Number.isFinite(value); }
function isIso(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function nowId() { return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const temp = file + '.tmp-' + process.pid + '-' + Date.now();
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
}
function appendJsonl(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(value) + '\n', 'utf8');
  const fd = fs.openSync(file, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function safeInside(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (isObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/(authorization|bearer|token|cookie|password|secret|credential)/i.test(key)) out[key] = '[已隐藏]';
      else out[key] = redact(item);
    }
    return out;
  }
  if (typeof value === 'string' && /^Bearer\s/i.test(value)) return '[已隐藏]';
  return value;
}
function parseArgs(argv) {
  const args = { mode: 'validate-only', resume: null, acknowledgeDelete: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--validate-only') args.mode = 'validate-only';
    else if (arg === '--preflight') args.mode = 'preflight';
    else if (arg === '--execute') args.mode = 'execute';
    else if (arg === '--acknowledge-unique-delete') args.acknowledgeDelete = true;
    else if (arg === '--resume') {
      args.resume = argv[++i];
      if (!args.resume) throw new Error('--resume 缺少实际写入目录');
      args.mode = 'execute';
    } else throw new Error('不认识的参数: ' + arg);
  }
  if (args.mode === 'validate-only' && (args.resume || args.acknowledgeDelete)) throw new Error('离线校验不接受续跑或删除确认');
  if (args.mode !== 'execute' && args.acknowledgeDelete) throw new Error('只有执行模式可确认唯一删除');
  if (args.mode === 'execute' && process.env.RUNE_EQUIPMENT_OWNERSHIP_CONFIRM !== EXEC_CONFIRM) throw new Error('执行模式需要显式确认环境变量，准备阶段不会设置该变量');
  return args;
}

function loadFrozen() {
  const candidate = jsonPinned(path.join(CANDIDATE_DIR, '完整候选.json'), EXPECTED.candidate);
  const plan = jsonPinned(path.join(CANDIDATE_DIR, '写前请求计划.json'), EXPECTED.plan);
  const math = jsonPinned(path.join(CANDIDATE_DIR, '独立数学报告.json'), EXPECTED.math);
  const migration = jsonPinned(path.join(ARTIFACTS, 'rune-equipment-ownership-luna-candidate', '神奇之鞋迁移意图.json'), EXPECTED.migration);
  const snapshot = jsonPinned(path.join(ROOT_DIR, '当前保护快照.json'), EXPECTED.snapshot);
  const supplementary = jsonPinned(path.join(ROOT_DIR, '补充查重与分类.json'), EXPECTED.supplementary);
  const oldReference = jsonPinned(path.join(ROOT_DIR, '旧鞋效果真实引用只读核对.json'), EXPECTED.oldReference);
  const cursorText = readPinned(path.join(CURSOR_DIR, 'Cursor来源复核结论.md'), EXPECTED.cursorV3).toString('utf8');
  validateCandidate(candidate, snapshot);
  validatePlan(candidate, plan);
  validateSupplementary(supplementary);
  assert(math.status === '通过' && math.checks?.errorCount === 0, '独立数学报告不是无错误通过');
  assert(migration && migration.passed !== false, '神奇之鞋迁移意图不是允许状态');
  assert(snapshot.GETs === 72 && snapshot.businessWrites === 0 && snapshot.requests.length === 72, '保护快照不是72 GET/零写入');
  assert(oldReference.passed === true && Array.isArray(oldReference.inboundReferences) && oldReference.inboundReferences.length === 0 && Array.isArray(oldReference.imageRelations) && oldReference.imageRelations.length === 0, '旧效果引用只读证据未通过');
  assert(/\bVERDICT:\s*READY\b/.test(cursorText) && !/\b(?:BLOCK|REVISE)\b/.test(cursorText), 'Cursor v3 结论不是 READY');
  return { candidate, plan, math, migration, snapshot, supplementary, oldReference, cursorText };
}

function validateSupplementary(supplementary) {
  assert(supplementary.GETs === 6 && supplementary.businessWrites === 0 && supplementary.requests.length === 6, '补充保护快照不是6 GET/零写入');
  const expectedImageRoute = '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT + '/representative-image';
  const image = supplementary.requests.find((x) => x.route === expectedImageRoute);
  assert(image && image.status === 200 && same(image.data, { image: null }), '补充快照缺少旧效果代表图空值证据');
  for (const skill of ['item_2010_consume', 'item_2150_consume', 'item_2152_consume', 'item_2422_passive']) {
    const row = supplementary.requests.find((x) => x.route === '/skills/' + skill);
    assert(row && row.status === 404, '补充快照缺少新技能404查重证据: ' + skill);
  }
}

function validateCandidate(candidate, snapshot) {
  assert(candidate.gameId === 'lol' && candidate.officialVersion === '16.17.1', '候选游戏或固定版本不正确');
  assert(candidate.rootRevision?.revision === '修订一' && candidate.rootRevision.unchangedShoeMigration === true, '候选不是修订一或错误改动神奇之鞋迁移意图');
  assert(candidate.apiWrites?.executed === false, '冻结候选已经声明执行过写入');
  assert(candidate.objects?.length === 4, '候选必须包含四件装备');
  const counts = candidate.totals || {};
  const expectedCounts = { equipmentCount: 4, newSkills: 4, newParameters: 12, newFormulas: 3, newEffects: 2, newProcesses: 0, newInternalStates: 0, newTriggerRules: 0, relations: 4, representativeImages: 4, protectedParameters: 19, protectedFormulas: 2, protectedEffects: 1, protectedTotal: 22 };
  for (const [key, value] of Object.entries(expectedCounts)) assert(counts[key] === value, '候选计数' + key + '不正确');
  const attrs = new Set((snapshot.requests.find((r) => r.route === '/attributes')?.data?.items || []).map((x) => x.attributeKey));
  const zones = new Set((snapshot.requests.find((r) => r.route === '/modifier-zones')?.data?.items || []).map((x) => x.modifierZoneKey));
  for (const object of candidate.objects) {
    const payload = object.apiPayload;
    assert(object.equipmentKey && object.skillKey && payload?.skill?.skillKey === object.skillKey, '技能主体缺失: ' + object.skillKey);
    const parameterKeys = new Set((payload.parameters || []).map((p) => p.parameterKey));
    const formulaKeys = new Set((payload.formulas || []).map((f) => f.formulaKey));
    for (const parameter of payload.parameters || []) {
      assert(parameter.valueMode && parameter.valueType, '参数模式缺失: ' + object.skillKey + '/' + parameter.parameterKey);
      if (parameter.valueMode === 'FIXED') {
        assert(isFiniteNumber(parameter.fixedValue), '固定参数不是有限数值: ' + parameter.parameterKey);
        if (parameter.valueType === 'INTEGER') assert(Number.isInteger(parameter.fixedValue), '整数参数不是整数: ' + parameter.parameterKey);
      }
      if (parameter.valueMode === 'RUNTIME_INPUT') assert(parameter.fixedValue == null && parameter.levelValues == null, '运行输入出现默认值: ' + parameter.parameterKey);
      if (parameter.parameterKey.endsWith('_ms')) assert(parameter.valueType === 'INTEGER' && isFiniteNumber(parameter.fixedValue) && Number.isInteger(parameter.fixedValue), '毫秒参数不是整数固定值: ' + parameter.parameterKey);
      if (parameter.levelValues != null) {
        const values = Array.isArray(parameter.levelValues) ? parameter.levelValues : Object.values(parameter.levelValues);
        for (const value of values) {
          assert(isFiniteNumber(value), '等级参数含非有限值: ' + parameter.parameterKey);
          if (parameter.valueType === 'INTEGER') assert(Number.isInteger(value), '等级整数参数含小数: ' + parameter.parameterKey);
        }
      }
    }
    const visit = (node, formulaKey) => {
      assert(isObject(node) && typeof node.nodeType === 'string', '公式节点缺失: ' + formulaKey);
      if (node.nodeType === 'PARAMETER') assert(parameterKeys.has(node.parameterKey), '公式引用悬空参数: ' + formulaKey + '/' + node.parameterKey);
      else if (node.nodeType === 'ATTRIBUTE') assert(attrs.has(node.attributeKey), '公式引用未知属性: ' + formulaKey + '/' + node.attributeKey);
      else if (node.nodeType === 'OPERATION') {
        assert(Array.isArray(node.operands) && node.operands.length === 2, '公式不是二元运算: ' + formulaKey);
        node.operands.forEach((child) => visit(child, formulaKey));
      } else throw new Error('公式节点类型不允许: ' + formulaKey + '/' + node.nodeType);
    };
    for (const formula of payload.formulas || []) visit(formula.expression, formula.formulaKey);
    for (const effect of payload.effects || []) {
      for (const result of effect.results || []) {
        const detail = result.detail || {};
        if (detail.attributeKey != null) assert(attrs.has(detail.attributeKey), '效果引用未知属性: ' + effect.effectKey);
        if (detail.modifierZoneKey != null) assert(zones.has(detail.modifierZoneKey), '效果引用未知乘区: ' + effect.effectKey);
        const rule = result.valueRule?.value;
        if (rule?.kind === 'PARAMETER') assert(parameterKeys.has(rule.parameterKey), '效果引用悬空参数: ' + effect.effectKey);
        if (rule?.kind === 'FORMULA') assert(formulaKeys.has(rule.formulaKey), '效果引用悬空公式: ' + effect.effectKey);
        for (const number of [result.valueRule?.fixedMultiplier, result.valueRule?.fixedMinValue, result.valueRule?.fixedMaxValue]) {
          if (number != null) assert(isFiniteNumber(number), '效果固定值不是有限数: ' + effect.effectKey);
        }
      }
    }
  }
  const biscuit = candidate.objects.find((x) => x.skillKey === 'item_2010_consume');
  const permanent = biscuit?.apiPayload.effects?.find((x) => x.effectKey === 'permanent_health_gain');
  assert(permanent?.results?.[0]?.lifecycleBehavior?.valueReadMode === 'APPLICATION_SNAPSHOT', '饼干永久效果未快照读取');
  assert(permanent.results[0].lifecycleBehavior.stackValueMode === 'SHARED' && permanent.results[0].lifecycleBehavior.reapplicationValueMode === 'REPLACE', '饼干累计效果生命周期不符合修订一');
  const shoe = candidate.objects.find((x) => x.skillKey === 'item_2422_passive');
  assert(shoe?.apiPayload.effects?.[0]?.results?.[0]?.detail?.attributeKey === 'move_speed', '有点神奇之鞋效果属性不正确');
  assert(shoe.apiPayload.effects[0].results[0].detail.modifierZoneKey === 'attribute_flat_add', '有点神奇之鞋效果乘区不正确');
}

function validatePlan(candidate, plan) {
  assert(plan.execute === false && plan.rootRevision === '修订一', '请求计划不是冻结的离线计划');
  assert(plan.candidateSha256 === EXPECTED.candidate, '请求计划未绑定候选散列');
  assert(plan.writeRequests?.length === 30, '计划不是30个写请求');
  const counts = { POST: 0, PUT: 0, DELETE: 0 };
  for (const request of plan.writeRequests) {
    assert(request.execute === false && request.status === '仅计划，未调用', '请求意外声明可执行: ' + request.id);
    assert(request.path?.startsWith(API_PREFIX) && !request.path.includes('://') && !request.path.includes('..'), '请求路径越界: ' + request.path);
    assert(Object.hasOwn(counts, request.method), '计划含不允许方法: ' + request.method);
    counts[request.method] += 1;
  }
  assert(counts.POST === 25 && counts.PUT === 4 && counts.DELETE === 1, '计划方法计数不是25 POST/4 PUT/1 DELETE');
  const deletion = plan.writeRequests.find((x) => x.method === 'DELETE');
  assert(deletion?.path === API_PREFIX + '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT, '计划删除目标不是唯一旧效果');
  const derived = new Map(candidateEntries(candidate).map((entry) => [entry.id, entry]));
  for (const request of plan.writeRequests) {
    if (request.method === 'DELETE') continue;
    const entry = derived.get(request.id);
    assert(entry, '计划请求没有候选来源: ' + request.id);
    assert(entry.method === request.method && entry.path === request.path && same(entry.body, request.body), '计划请求与候选不一致: ' + request.id);
  }
}

function candidateEntries(candidate) {
  const entries = [];
  for (const object of candidate.objects) {
    const p = object.apiPayload;
    const skill = object.skillKey;
    entries.push({ id: skill + '-skill', method: 'POST', kind: 'skill', equipmentKey: object.equipmentKey, skillKey: skill, path: API_PREFIX + '/skills', readRoute: API_PREFIX + '/skills/' + skill, body: p.skill });
    for (const type of ['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules']) {
      const list = p[type] || [];
      const segment = type === 'internalStates' ? 'internal-states' : type === 'triggerRules' ? 'trigger-rules' : type;
      const keyName = type === 'parameters' ? 'parameterKey' : type === 'formulas' ? 'formulaKey' : type === 'effects' ? 'effectKey' : type === 'processes' ? 'processKey' : type === 'internalStates' ? 'stateKey' : 'triggerRuleKey';
      const idPart = type === 'internalStates' ? 'internal-state' : type === 'triggerRules' ? 'trigger-rule' : type.slice(0, -1);
      for (const body of list) {
        const key = body[keyName];
        entries.push({ id: skill + '-' + idPart + '-' + key, method: 'POST', kind: type, equipmentKey: object.equipmentKey, skillKey: skill, path: API_PREFIX + '/skills/' + skill + '/' + segment, readRoute: API_PREFIX + '/skills/' + skill + '/' + segment + '/' + encodeURIComponent(key), body });
      }
    }
    entries.push({ id: skill + '-equipment-skill-relation', method: 'POST', kind: 'relation', equipmentKey: object.equipmentKey, skillKey: skill, path: API_PREFIX + '/equipment-skill-relations', readRoute: API_PREFIX + '/equipment-skill-relations?equipmentKey=' + encodeURIComponent(object.equipmentKey) + '&skillKey=' + encodeURIComponent(skill), body: object.relation });
    entries.push({ id: skill + '-representative-image', method: 'PUT', kind: 'image', equipmentKey: object.equipmentKey, skillKey: skill, path: API_PREFIX + '/skills/' + skill + '/representative-image', readRoute: API_PREFIX + '/skills/' + skill + '/representative-image', body: object.representativeImage });
  }
  return entries;
}
function expectedBaseline(snapshot, route) { return snapshot.requests.find((x) => x.route === route); }
function relationCore(row) { return Object.fromEntries(RELATION_FIELDS.map((key) => [key, row?.[key]])); }
function validateRelationResponse(data, expectedEquipment, expectedSkill, requireTarget) {
  assert(isObject(data) && Array.isArray(data.items) && Number.isInteger(data.total), '装备技能关系不是带total的列表');
  assert(data.total === data.items.length, '装备技能关系分页总数与items不一致，禁止继续');
  if (data.hasNext === true || (typeof data.pageSize === 'number' && data.total > data.items.length)) throw new Error('装备关系响应显示未取全页');
  if (!requireTarget) {
    assert(data.items.length === 0, '保护中的装备' + expectedEquipment + '已有关系');
    return;
  }
  assert(data.items.length === 1, '装备' + expectedEquipment + '关系数量不是1');
  assert(same(relationCore(data.items[0]), { gameId: 'lol', equipmentKey: expectedEquipment, skillKey: expectedSkill, sortOrder: 10 }), '装备关系核心字段不一致: ' + expectedEquipment);
  for (const key of ['createdAt', 'updatedAt']) if (key in data.items[0]) assert(isIso(data.items[0][key]), '装备关系时间字段无效: ' + key);
}
function probeRelation(data, expectedEquipment, expectedSkill) {
  assert(isObject(data) && Array.isArray(data.items) && Number.isInteger(data.total), '装备技能关系不是带total的列表');
  assert(data.total === data.items.length, '装备技能关系分页总数与items不一致，禁止继续');
  if (data.hasNext === true || (typeof data.pageSize === 'number' && data.total > data.items.length)) throw new Error('装备关系响应显示未取全页');
  if (data.items.length === 0) return 'MISSING';
  if (data.items.length !== 1) return 'CONFLICT';
  const row = data.items[0];
  if (!same(relationCore(row), { gameId: 'lol', equipmentKey: expectedEquipment, skillKey: expectedSkill, sortOrder: 10 })) return 'CONFLICT';
  for (const key of ['createdAt', 'updatedAt']) if (key in row) assert(isIso(row[key]), '装备关系时间字段无效: ' + key);
  return 'SAME';
}
async function fetchJson(route, method, body, context) {
  assert(route.startsWith(API_PREFIX) && !route.includes('://') && !route.includes('..'), '拒绝越界请求路径: ' + route);
  if (method !== 'GET') assert(context.mode === 'execute', '离线模式拒绝' + method);
  const logBase = { at: new Date().toISOString(), phase: context.phase, method, route, body: redact(body ?? null), authorizationLogged: false };
  appendJsonl(context.logFile, { type: 'request', ...logBase });
  const headers = { Accept: 'application/json' };
  const token = process.env.RUNE_EQUIPMENT_OWNERSHIP_TOKEN;
  if (token) headers.Authorization = token.startsWith('Bearer ') ? token : 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  let text = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      response = await fetch(BASE_URL + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      text = await response.text();
    } finally { clearTimeout(timer); }
  } catch (error) {
    appendJsonl(context.logFile, { type: 'response', ...logBase, status: null, error: '请求失败: ' + error.message, responseBodyLogged: false });
    throw new Error('未知网络结果，已停止且不重放' + method + ' ' + route);
  }
  let data = null;
  let parseError = null;
  if (text.length) {
    try { data = JSON.parse(text); } catch (error) { parseError = error.message; }
  }
  appendJsonl(context.logFile, { type: 'response', ...logBase, status: response.status, emptyBody: text.length === 0, responseBytes: Buffer.byteLength(text), responseSha256: sha256Bytes(Buffer.from(text)), parseError, data: redact(data), responseBodyLogged: true });
  return { status: response.status, data, text };
}
function statusAllowed(method, status) { return method === 'POST' ? status === 200 || status === 201 : method === 'PUT' ? status === 200 : method === 'DELETE' ? status === 204 : status === 200; }
function projectExpected(expected, actual) {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((value, index) => projectExpected(value, actual[index]));
  if (isObject(expected)) {
    return isObject(actual)
      && Object.keys(actual).every((key) => Object.hasOwn(expected, key) || SERVER_ONLY_FIELDS.has(key))
      && Object.entries(expected).every(([key, value]) => projectExpected(value, actual[key]));
  }
  return Object.is(expected, actual);
}
function sameBusiness(expected, actual) { return projectExpected(expected, actual); }

function makeContext(mode, runDir, frozen) { return { mode, runDir, logFile: path.join(runDir, '请求日志.jsonl'), frozen }; }
function acquireRun(resume) {
  const writesDir = path.join(EXEC_DIR, '实际写入');
  ensureDir(writesDir);
  if (resume) {
    const runDir = path.resolve(resume);
    assert(safeInside(runDir, writesDir) && runDir !== writesDir, '续跑目录必须在实际写入目录内');
    const lockFile = path.join(runDir, '运行锁.json');
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    assert(['STARTED', 'RUNNING', 'STOPPED'].includes(lock.status), '续跑锁状态不允许: ' + lock.status);
    assert(lock.candidateSha256 === EXPECTED.candidate && lock.planSha256 === EXPECTED.plan, '续跑锁未绑定当前冻结候选和计划');
    const globalLock = path.join(EXEC_DIR, '实际写入锁.json');
    assert(fs.existsSync(globalLock), '续跑缺少全局实际写入锁');
    const global = JSON.parse(fs.readFileSync(globalLock, 'utf8'));
    assert(path.resolve(global.runDir) === runDir, '续跑目录与全局锁不一致');
    return { runDir, lockFile, globalLock, lock };
  }
  const runDir = path.join(writesDir, nowId());
  ensureDir(path.join(runDir, '写前意图'));
  const globalLock = path.join(EXEC_DIR, '实际写入锁.json');
  let fd;
  try { fd = fs.openSync(globalLock, 'wx'); } catch (error) { throw new Error('已有实际写入锁，拒绝并行或重复执行: ' + error.code); }
  const lock = { status: 'STARTED', runDir, createdAt: new Date().toISOString(), candidateSha256: EXPECTED.candidate, planSha256: EXPECTED.plan, plannedWrites: { total: 30, POST: 25, PUT: 4, DELETE: 1 } };
  fs.writeFileSync(fd, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  writeJson(path.join(runDir, '运行锁.json'), lock);
  writeJson(path.join(runDir, '状态.json'), { status: 'STARTED', nextSequence: 1, calls: 0, writes: { POST: 0, PUT: 0, DELETE: 0 }, actionStates: {} });
  return { runDir, lockFile: path.join(runDir, '运行锁.json'), globalLock, lock };
}
function updateLock(run, status, extra = {}) {
  run.lock = { ...run.lock, ...extra, status, updatedAt: new Date().toISOString() };
  writeJson(run.lockFile, run.lock);
  if (run.globalLock) writeJson(run.globalLock, run.lock);
}
function loadState(run) { const file = path.join(run.runDir, '状态.json'); return { file, value: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
function saveState(state) { if (state.file) writeJson(state.file, state.value); }
function setActionState(state, id, value, extra = {}) {
  state.value.actionStates[id] = { ...(state.value.actionStates[id] || {}), state: value, updatedAt: new Date().toISOString(), ...extra };
  saveState(state);
}
function intentFile(run, sequence, id) { return path.join(run.runDir, '写前意图', String(sequence).padStart(3, '0') + '-' + id + '.json'); }
function createIntent(run, action) {
  const file = intentFile(run, action.sequence, action.id);
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (['VERIFIED', 'SKIPPED'].includes(existing.state)) return existing;
    throw new Error('发现未确定的写前意图，拒绝重放: ' + file);
  }
  const value = { sequence: action.sequence, id: action.id, method: action.method, path: action.path, bodySha256: sha256Bytes(Buffer.from(JSON.stringify(action.body ?? null))), state: 'PREPARED', preparedAt: new Date().toISOString(), authorizationLogged: false };
  const fd = fs.openSync(file, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return value;
}
function updateIntent(run, action, value) { writeJson(intentFile(run, action.sequence, action.id), value); }

async function probe(action, context) {
  const response = await fetchJson(action.readRoute, 'GET', undefined, { ...context, phase: '写前查重:' + action.id });
  if (action.kind === 'relation') {
    if (response.status === 404) return { state: 'MISSING', response };
    if (response.status !== 200) return { state: 'CONFLICT', response };
    const state = probeRelation(response.data, action.equipmentKey, action.skillKey);
    return { state, response };
  }
  if (action.kind === 'image') {
    if (response.status === 404) return { state: 'MISSING', response };
    if (response.status !== 200) return { state: 'CONFLICT', response };
    const image = response.data?.image;
    if (image == null) return { state: 'MISSING', response };
    if (sameBusiness(action.body, image)) return { state: 'SAME', response };
    return { state: 'CONFLICT', response };
  }
  if (response.status === 404) return { state: 'MISSING', response };
  if (response.status !== 200 || !sameBusiness(action.body, response.data)) return { state: 'CONFLICT', response };
  return { state: 'SAME', response };
}
async function verifyEntry(action, context) {
  const response = await fetchJson(action.readRoute, 'GET', undefined, { ...context, phase: '写后核对:' + action.id });
  if (action.kind === 'relation') {
    assert(response.status === 200, '写后关系详情不是200: ' + action.id);
    validateRelationResponse(response.data, action.equipmentKey, action.skillKey, true);
    return;
  }
  if (action.kind === 'image') {
    assert(response.status === 200 && sameBusiness(action.body, response.data?.image), '写后图片详情不一致: ' + action.id);
    return;
  }
  assert(response.status === 200 && sameBusiness(action.body, response.data), '写后对象详情不一致: ' + action.id);
}

async function verifySnapshot(context, phase, allowDeleted, finalRelations) {
  const snapshot = context.frozen.snapshot;
  for (const baseline of snapshot.requests) {
    const response = await fetchJson(API_PREFIX + baseline.route, 'GET', undefined, { ...context, phase: phase + ':保护:' + baseline.route });
    const oldDetail = baseline.route === '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT;
    const oldList = baseline.route === '/skills/' + OLD_SKILL + '/effects';
    const oldImage = baseline.route === '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT + '/representative-image';
    if (allowDeleted && oldDetail) { assert(response.status === 404, phase + ':旧效果详情未404'); continue; }
    if (allowDeleted && oldList) {
      assert(response.status === 200 && ((Array.isArray(response.data) && response.data.length === 0) || (response.data?.items?.length === 0 && response.data?.total === 0)), phase + ':旧效果列表未清空');
      continue;
    }
    if (allowDeleted && oldImage) { assert(response.status === 404, phase + ':旧效果代表图未404'); continue; }
    const relationMatch = baseline.route.match(/^\/equipment-skill-relations\?equipmentKey=([^&]+)/);
    if (relationMatch) {
      const equipmentKey = decodeURIComponent(relationMatch[1]);
      const target = context.frozen.candidate.objects.find((x) => x.equipmentKey === equipmentKey);
      assert(response.status === 200, phase + ':装备关系不是200: ' + equipmentKey);
      if (finalRelations === 'allow') {
        if (response.data?.items?.length === 0) validateRelationResponse(response.data, equipmentKey, target?.skillKey, false);
        else validateRelationResponse(response.data, equipmentKey, target?.skillKey, true);
      } else {
        validateRelationResponse(response.data, equipmentKey, target?.skillKey, finalRelations);
      }
      continue;
    }
    assert(response.status === baseline.status && same(baseline.data, response.data), phase + ':保护快照变化 ' + baseline.route);
  }
  const imageRoute = context.frozen.supplementary.requests.find((x) => x.route === '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT + '/representative-image');
  assert(imageRoute, phase + ':补充快照缺少旧效果代表图');
  const imageResponse = await fetchJson(API_PREFIX + imageRoute.route, 'GET', undefined, { ...context, phase: phase + ':补充保护:' + imageRoute.route });
  if (allowDeleted) assert(imageResponse.status === 404, phase + ':旧效果代表图未404');
  else assert(imageResponse.status === imageRoute.status && same(imageRoute.data, imageResponse.data), phase + ':旧效果代表图保护变化');
}
async function verifyEquipmentRelation(context, equipmentKey, requireTarget, phase) {
  const target = context.frozen.candidate.objects.find((x) => x.equipmentKey === equipmentKey);
  const response = await fetchJson(API_PREFIX + '/equipment-skill-relations?equipmentKey=' + encodeURIComponent(equipmentKey) + '&page=1&pageSize=200', 'GET', undefined, { ...context, phase: phase + ':装备关系:' + equipmentKey });
  assert(response.status === 200, phase + ':装备关系不是200: ' + equipmentKey);
  validateRelationResponse(response.data, equipmentKey, target?.skillKey, requireTarget);
}
async function verifyOldEffectBarrier(context, deleted) {
  const base = API_PREFIX + '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT;
  const detail = await fetchJson(base, 'GET', undefined, { ...context, phase: deleted ? '旧效果删除后详情' : '旧效果删除前详情' });
  const list = await fetchJson(API_PREFIX + '/skills/' + OLD_SKILL + '/effects', 'GET', undefined, { ...context, phase: deleted ? '旧效果删除后列表' : '旧效果删除前列表' });
  const image = await fetchJson(base + '/representative-image', 'GET', undefined, { ...context, phase: deleted ? '旧效果删除后代表图' : '旧效果删除前代表图' });
  if (deleted) {
    assert(detail.status === 404, '旧效果删除后详情不是404');
    assert(list.status === 200 && ((Array.isArray(list.data) && list.data.length === 0) || (list.data?.items?.length === 0 && list.data?.total === 0)), '旧效果删除后列表不是空');
    assert(image.status === 404, '旧效果删除后代表图不是404');
  } else {
    const oldDetail = expectedBaseline(context.frozen.snapshot, '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT);
    const oldList = expectedBaseline(context.frozen.snapshot, '/skills/' + OLD_SKILL + '/effects');
    const oldImage = expectedBaseline(context.frozen.supplementary, '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT + '/representative-image');
    assert(detail.status === 200 && same(oldDetail.data, detail.data), '旧效果删除前详情保护不一致');
    assert(list.status === 200 && same(oldList.data, list.data), '旧效果删除前列表保护不一致');
    assert(image.status === 200 && same(oldImage.data, image.data), '旧效果删除前代表图保护不一致');
  }
}
async function executeEntry(action, state, run, context) {
  const current = await probe(action, context);
  if (current.state === 'SAME') { setActionState(state, action.id, 'SKIPPED', { reason: '已存在且逐字段一致' }); return 'SKIPPED'; }
  if (current.state === 'CONFLICT') throw new Error('写前查重冲突，立即停止: ' + action.id);
  if (context.mode === 'preflight') { setActionState(state, action.id, 'MISSING', { reason: '只读预检发现缺失' }); return 'MISSING'; }
  const intent = createIntent(run, action);
  if (intent.state === 'VERIFIED' || intent.state === 'SKIPPED') return intent.state;
  const sent = { ...intent, state: 'SENT', sentAt: new Date().toISOString() };
  updateIntent(run, action, sent);
  let response;
  try { response = await fetchJson(action.path, action.method, action.body, { ...context, phase: '写入:' + action.id }); }
  catch (error) { updateIntent(run, action, { ...sent, state: 'UNKNOWN', error: error.message }); throw error; }
  if (!statusAllowed(action.method, response.status)) {
    updateIntent(run, action, { ...sent, state: 'FAILED', status: response.status });
    if (response.status === 409) throw new Error('服务返回409，停止且不删除依赖: ' + action.id);
    throw new Error('写入状态不符合计划: ' + action.id + ' HTTP' + response.status);
  }
  state.value.writes[action.method] += 1;
  saveState(state);
  await verifyEntry(action, context);
  updateIntent(run, action, { ...sent, state: 'VERIFIED', verifiedAt: new Date().toISOString(), responseStatus: response.status });
  setActionState(state, action.id, 'VERIFIED', { responseStatus: response.status });
  return 'VERIFIED';
}
async function verifyBeforeDelete(context) {
  assert(context.frozen.oldReference.passed === true && Array.isArray(context.frozen.oldReference.inboundReferences) && context.frozen.oldReference.inboundReferences.length === 0 && Array.isArray(context.frozen.oldReference.imageRelations) && context.frozen.oldReference.imageRelations.length === 0, '删前旧效果引用证据不满足');
  await verifySnapshot(context, '删除前', false, 'allow');
  await verifyEquipmentRelation(context, 'item_2422', false, '删除前');
  const shoe = context.frozen.candidate.objects.find((x) => x.skillKey === 'item_2422_passive');
  for (const action of context.actions.filter((x) => x.skillKey === shoe.skillKey && x.kind !== 'relation' && x.kind !== 'image')) {
    const p = await probe(action, context);
    assert(p.state === 'SAME', '删除前新鞋对象未完整核对: ' + action.id);
  }
  await verifyOldEffectBarrier(context, false);
}
async function executeDelete(action, state, run, context) {
  const oldDetailRoute = API_PREFIX + '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT;
  const current = await fetchJson(oldDetailRoute, 'GET', undefined, { ...context, phase: '唯一删除写前详情' });
  if (current.status === 404) {
    await verifyOldEffectBarrier(context, true);
    if (run) {
      const file = intentFile(run, action.sequence, action.id);
      if (fs.existsSync(file)) {
        const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
        updateIntent(run, action, { ...previous, state: 'VERIFIED', recoveredAt: new Date().toISOString(), reason: '旧效果已404，禁止重放DELETE' });
      }
    }
    setActionState(state, action.id, 'SKIPPED', { reason: '旧效果已404，禁止重放DELETE' });
    return 'SKIPPED';
  }
  if (current.status !== 200) throw new Error('旧效果删除前状态异常: HTTP' + current.status);
  if (context.mode === 'preflight') {
    await verifySnapshot(context, '只读预检删除前保护', false, false);
    await verifyOldEffectBarrier(context, false);
    setActionState(state, action.id, 'READY', { reason: '唯一删除已满足只读门槛；实际删除前仍需新对象完整GET' });
    return 'READY';
  }
  await verifyBeforeDelete(context);
  const intent = createIntent(run, action);
  if (intent.state === 'VERIFIED' || intent.state === 'SKIPPED') return intent.state;
  const sent = { ...intent, state: 'SENT', sentAt: new Date().toISOString() };
  updateIntent(run, action, sent);
  let response;
  try { response = await fetchJson(action.path, 'DELETE', undefined, { ...context, phase: '唯一删除:' + action.id }); }
  catch (error) { updateIntent(run, action, { ...sent, state: 'UNKNOWN', error: error.message }); throw error; }
  if (response.status !== 204) {
    updateIntent(run, action, { ...sent, state: 'FAILED', status: response.status });
    if (response.status === 409) throw new Error('唯一旧效果DELETE返回409，停止且不删除依赖');
    throw new Error('唯一旧效果DELETE不是204: HTTP' + response.status);
  }
  state.value.writes.DELETE += 1;
  saveState(state);
  await verifyOldEffectBarrier(context, true);
  await verifySnapshot(context, 'DELETE后', true, 'allow');
  updateIntent(run, action, { ...sent, state: 'VERIFIED', verifiedAt: new Date().toISOString(), responseStatus: 204 });
  setActionState(state, action.id, 'VERIFIED', { responseStatus: 204 });
  return 'VERIFIED';
}
function makeReport(status, mode, extra = {}) {
  return {
    generatedAt: new Date().toISOString(), status, mode, apiBase: BASE_URL + API_PREFIX,
    candidateSha256: EXPECTED.candidate, planSha256: EXPECTED.plan, mathSha256: EXPECTED.math, migrationIntentSha256: EXPECTED.migration,
    plannedWrites: { total: 30, POST: 25, PUT: 4, DELETE: 1 }, businessWrites: extra.businessWrites ?? 0,
    authorizationLogged: false, runtimeExecuted: false, databaseAccessed: false, browserAccessed: false, gitAccessed: false, ...extra
  };
}
async function runMode(args, frozen) {
  if (args.mode === 'validate-only') {
    console.log(JSON.stringify({ status: 'STATIC_VALIDATION_PASS', mode: args.mode, businessApiCalls: 0, businessWrites: 0, candidateSha256: EXPECTED.candidate, planSha256: EXPECTED.plan, mathSha256: EXPECTED.math, plannedWrites: { total: 30, POST: 25, PUT: 4, DELETE: 1 }, nodeRuntime: NODE_RUNTIME }, null, 2));
    return;
  }
  const run = acquireRun(args.resume);
  const state = loadState(run);
  const derived = new Map(candidateEntries(frozen.candidate).map((entry) => [entry.id, entry]));
  const actions = frozen.plan.writeRequests.map((request, index) => ({ ...request, sequence: request.sequence ?? index + 1, ...(derived.get(request.id) || {}), method: request.method, path: request.path, body: request.body }));
  const context = makeContext(args.mode, run.runDir, frozen);
  context.actions = actions;
  state.value.status = 'RUNNING';
  saveState(state);
  updateLock(run, 'RUNNING');
  try {
    if (args.resume) {
      const old = await fetchJson(API_PREFIX + '/skills/' + OLD_SKILL + '/effects/' + OLD_EFFECT, 'GET', undefined, { ...context, phase: '续跑前旧效果状态' });
      if (old.status === 404) {
        await verifyOldEffectBarrier(context, true);
        await verifySnapshot(context, '续跑前', true, 'allow');
      } else if (old.status === 200) {
        await verifySnapshot(context, '续跑前', false, 'allow');
        await verifyEquipmentRelation(context, 'item_2422', false, '续跑前');
      } else {
        throw new Error('续跑前旧效果状态异常: HTTP' + old.status);
      }
    } else {
      await verifySnapshot(context, '执行前', false, false);
    }
    const results = [];
    for (const action of actions) {
      if (action.method === 'DELETE') {
        assert(action.id === 'item_2422_passive-migrate-delete-old-effect', '存在非预期删除');
        if (!args.acknowledgeDelete) throw new Error('执行唯一DELETE必须带--acknowledge-unique-delete');
        results.push(await executeDelete(action, state, run, context));
      } else {
        if (action.kind === 'relation' && action.equipmentKey === 'item_2422') await verifyOldEffectBarrier(context, true);
        results.push(await executeEntry(action, state, run, context));
      }
      state.value.nextSequence = action.sequence + 1;
      saveState(state);
    }
    await verifySnapshot(context, '最终', true, true);
    const sentWrites = state.value.writes;
    const report = makeReport('COMPLETED', args.mode, { runDir: run.runDir, results, businessWrites: sentWrites.POST + sentWrites.PUT + sentWrites.DELETE, sentWrites });
    writeJson(path.join(run.runDir, '执行结果.json'), report);
    state.value.status = 'COMPLETED';
    saveState(state);
    updateLock(run, 'COMPLETED', { completedAt: new Date().toISOString(), sentWrites });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    state.value.status = 'STOPPED';
    state.value.stopReason = error.message;
    saveState(state);
    const sentWrites = state.value.writes;
    const report = makeReport('STOPPED', args.mode, { runDir: run.runDir, businessWrites: sentWrites.POST + sentWrites.PUT + sentWrites.DELETE, sentWrites, stopReason: error.message });
    writeJson(path.join(run.runDir, '执行结果.json'), report);
    updateLock(run, 'STOPPED', { stoppedAt: new Date().toISOString(), stopReason: error.message, sentWrites });
    throw error;
  }
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const frozen = loadFrozen();
  if (args.mode === 'preflight') {
    const runDir = path.join(EXEC_DIR, '只读预检', nowId());
    ensureDir(runDir);
    const context = makeContext(args.mode, runDir, frozen);
    const derived = new Map(candidateEntries(frozen.candidate).map((entry) => [entry.id, entry]));
    context.actions = frozen.plan.writeRequests.map((request, index) => ({ ...request, sequence: request.sequence ?? index + 1, ...(derived.get(request.id) || {}), method: request.method, path: request.path, body: request.body }));
    try {
      await verifySnapshot(context, '只读预检保护', false, false);
      const state = { value: { actionStates: {} } };
      const results = [];
      for (const action of context.actions) results.push(action.method === 'DELETE' ? await executeDelete(action, state, null, context) : await executeEntry(action, state, null, context));
      const report = makeReport('PRECHECK_PASS', args.mode, { runDir, results, businessWrites: 0, apiGetsOnly: true });
      writeJson(path.join(runDir, '执行结果.json'), report);
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      const report = makeReport('PRECHECK_STOPPED', args.mode, { runDir, businessWrites: 0, apiGetsOnly: true, stopReason: error.message });
      writeJson(path.join(runDir, '执行结果.json'), report);
      throw error;
    }
    return;
  }
  await runMode(args, frozen);
}
main().catch((error) => {
  console.error(JSON.stringify({ status: 'STOPPED', error: error.message, authorizationLogged: false }, null, 2));
  process.exitCode = 1;
});

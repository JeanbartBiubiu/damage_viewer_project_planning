import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const batchDir = path.resolve(here, '..');
const dataRoot = path.resolve(batchDir, '..', '..');
const candidateFile = path.join(batchDir, '可审查请求.json');
const boundaryFile = path.join(batchDir, '候选与边界.json');
const frozenSourceFile = path.join(batchDir, '冻结来源.json');
const structureFile = path.join(batchDir, '结构核对.json');
const arithmeticFile = path.join(batchDir, '独立数值核对.json');
const sourceFile = path.join(dataRoot, '装备符文', '客户端提取资料', 'perks-16.17-zh_CN.json');
const candidateSha256 = 'da45fa734c11590f0fbe7ed027ee9aa21c4b1d890b6231e89558dca32c3fe478';
const sourceSha256 = 'be0bb4eedde39f3a8e1dc245f9b4382379d87674c2fdc62b2650b6af4d9f565b';
const gameId = 'lol';
const baseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_VIEWER_LOCAL_BEARER || 'local-entry';
const targetIds = [5007, 5005, 5011, 5010, 5013];
const fixedAttributeIds = new Set([5007, 5005, 5011]);

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
  throw new Error('参数仅支持默认只读或显式 --apply。');
}
const apply = args.length === 1;
if (!token.trim()) throw new Error('本地管理接口令牌为空，未执行任何接口调用。');

const runId = new Date().toISOString().replace(/[-:.TZ]/g, '');
const reportFile = path.join(here, `安全写入-${apply ? '执行' : '只读'}-${runId}.json`);
const journalFile = path.join(here, '安全写入流水.jsonl');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sameJson(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function redact(value, depth = 0) {
  if (depth > 14) return '[省略]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(authorization|cookie|token|bearer|imageBase64)$/i.test(key)) continue;
    output[key] = redact(item, depth + 1);
  }
  return output;
}

class ApiFailure extends Error {
  constructor(method, route, status, data) {
    super(`${method} ${route} 返回 HTTP ${status}`);
    this.name = 'ApiFailure';
    this.method = method;
    this.route = route;
    this.status = status;
    this.data = data;
  }
}

class NetworkFailure extends Error {
  constructor(method, route, error) {
    super(`${method} ${route} 网络请求失败：${error?.name || '未知错误'}`);
    this.name = 'NetworkFailure';
    this.method = method;
    this.route = route;
    this.causeName = error?.name || null;
  }
}

function describeError(error) {
  if (error instanceof ApiFailure) {
    return {
      type: error.name,
      method: error.method,
      route: error.route,
      status: error.status,
      response: redact(error.data)
    };
  }
  return {
    type: error?.name || 'Error',
    method: error?.method,
    route: error?.route,
    message: String(error?.message || error)
  };
}

const report = {
  schema: '符文效果第一批/接口录入/安全写入报告',
  runId,
  mode: apply ? 'apply' : 'read-only',
  gameId,
  baseUrl,
  frozenCandidateSha256: candidateSha256,
  frozenSourceSha256: sourceSha256,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  staticVerification: null,
  preflight: { startedAt: null, completedAt: null, targets: [], summary: null },
  gets: [],
  operations: [],
  failures: [],
  warnings: [],
  summary: {
    candidateRequests: 22,
    post: { target: 22, planned: 0, reused: 0, written: 0, confirmedAfterError: 0, conflict: 0, failed: 0 },
    objects: { target: 5, ready: 0, completed: 0, blocked: 0, failed: 0 },
    imageRelations: { target: 5, planned: 0, skippedSame: 0, written: 0, noSourceImage: 0, conflict: 0, failed: 0 }
  }
};

function saveReport() {
  report.updatedAt = new Date().toISOString();
  fs.writeFileSync(reportFile, `${JSON.stringify(redact(report), null, 2)}\n`, 'utf8');
}

function journal(event) {
  fs.appendFileSync(journalFile, `${JSON.stringify(redact({ runId, at: new Date().toISOString(), ...event }))}\n`, 'utf8');
}

function operation(event) {
  const item = { at: new Date().toISOString(), ...event };
  report.operations.push(redact(item));
  journal({ type: 'operation', ...item });
  saveReport();
}

function failure(stage, target, error, extra = {}) {
  const item = { at: new Date().toISOString(), stage, target, error: describeError(error), ...extra };
  report.failures.push(redact(item));
  journal({ type: 'failure', ...item });
  saveReport();
}

function warning(stage, target, message, extra = {}) {
  const item = { at: new Date().toISOString(), stage, target, message, ...extra };
  report.warnings.push(redact(item));
  journal({ type: 'warning', ...item });
  saveReport();
}

function encode(value) {
  return encodeURIComponent(value);
}

function skillKeyOf(id) {
  return `rune_${id}_passive`;
}

function runeKeyOf(id) {
  return `rune_${id}`;
}

function skillRoute(skillKey) {
  return `/skills/${encode(skillKey)}`;
}

function parametersRoute(skillKey) {
  return `${skillRoute(skillKey)}/parameters`;
}

function effectsRoute(skillKey) {
  return `${skillRoute(skillKey)}/effects`;
}

function triggerRulesRoute(skillKey) {
  return `${skillRoute(skillKey)}/trigger-rules`;
}

function runeRoute(runeKey) {
  return `/runes/${encode(runeKey)}`;
}

function runeRepresentativeRoute(runeKey) {
  return `${runeRoute(runeKey)}/representative-image`;
}

function skillRepresentativeRoute(skillKey) {
  return `${skillRoute(skillKey)}/representative-image`;
}

function relationListRoute(runeKey) {
  return `/rune-skill-relations?runeKey=${encode(runeKey)}`;
}

function relationExactRoute(runeKey, skillKey) {
  return `${relationListRoute(runeKey)}&skillKey=${encode(skillKey)}`;
}

function expectedRoutes(id) {
  const skillKey = skillKeyOf(id);
  const routes = ['/skills', parametersRoute(skillKey)];
  if (id === 5013) routes.push(parametersRoute(skillKey));
  if (fixedAttributeIds.has(id)) routes.push(effectsRoute(skillKey), triggerRulesRoute(skillKey));
  routes.push('/rune-skill-relations');
  return routes;
}

function requestKind(request) {
  if (request.path === '/skills') return 'skill';
  if (/\/parameters$/.test(request.path)) return 'parameter';
  if (/\/effects$/.test(request.path)) return 'effect';
  if (/\/trigger-rules$/.test(request.path)) return 'trigger-rule';
  if (request.path === '/rune-skill-relations') return 'relation';
  return null;
}

function readRouteFor(request) {
  const kind = requestKind(request);
  if (kind === 'skill') return skillRoute(request.body.skillKey);
  if (kind === 'parameter') return `${parametersRoute(request.body.skillKey || request.path.split('/')[2])}/${encode(request.body.parameterKey)}`;
  if (kind === 'effect') return `${effectsRoute(request.body.skillKey || request.path.split('/')[2])}/${encode(request.body.effectKey)}`;
  if (kind === 'trigger-rule') return `${triggerRulesRoute(request.body.skillKey || request.path.split('/')[2])}/${encode(request.body.ruleKey)}`;
  if (kind === 'relation') return relationExactRoute(request.body.runeKey, request.body.skillKey);
  throw new Error(`未知候选请求路由：${request.path}`);
}

function collectionRoute(kind, skillKey) {
  if (kind === 'parameter') return parametersRoute(skillKey);
  if (kind === 'effect') return effectsRoute(skillKey);
  if (kind === 'trigger-rule') return triggerRulesRoute(skillKey);
  throw new Error(`未知子集合类型：${kind}`);
}

function primaryKey(kind, body) {
  if (kind === 'parameter') return body.parameterKey;
  if (kind === 'effect') return body.effectKey;
  if (kind === 'trigger-rule') return body.ruleKey;
  return null;
}

function relationCore(item) {
  if (!item || typeof item !== 'object') return null;
  return { runeKey: item.runeKey, skillKey: item.skillKey, sortOrder: item.sortOrder };
}

function expectedCore(request) {
  const kind = requestKind(request);
  if (kind === 'relation') return relationCore(request.body);
  return request.body;
}

function actualForRequest(request, data) {
  const kind = requestKind(request);
  if (kind === 'relation') {
    const items = data && Array.isArray(data.items) ? data.items : [];
    return relationCore(items.find((item) => item.runeKey === request.body.runeKey && item.skillKey === request.body.skillKey));
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const body = request.body;
  const actual = {};
  for (const key of Object.keys(body)) actual[key] = data[key];
  return actual;
}

function matchesRequest(request, data) {
  return sameJson(expectedCore(request), actualForRequest(request, data));
}

function parseIdPointer(pointer) {
  const match = /^\/(\d+)$/.exec(pointer || '');
  return match ? Number(match[1]) : null;
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function staticVerification() {
  const actualCandidateSha256 = sha256File(candidateFile);
  if (actualCandidateSha256 !== candidateSha256) throw new Error(`可审查请求.json SHA256 不符：${actualCandidateSha256}`);
  const actualSourceSha256 = sha256File(sourceFile);
  if (actualSourceSha256 !== sourceSha256) throw new Error(`perks-16.17-zh_CN.json SHA256 不符：${actualSourceSha256}`);

  const candidate = readJson(candidateFile);
  if (!Array.isArray(candidate) || candidate.length !== targetIds.length) throw new Error('可审查请求不是 5 个主体。');
  const ids = candidate.map((item) => item?.id);
  if (!sameJson(ids, targetIds)) throw new Error(`候选主体顺序或集合不符：${JSON.stringify(ids)}`);

  const requestCounts = { skill: 0, parameter: 0, effect: 0, 'trigger-rule': 0, relation: 0 };
  const candidateById = new Map();
  for (const item of candidate) {
    const skillKey = skillKeyOf(item.id);
    if (!Array.isArray(item.requests) || item.requests.length !== expectedRoutes(item.id).length) {
      throw new Error(`主体 ${item.id} 请求数量不符。`);
    }
    if (!sameJson(item.requests.map((request) => request.path), expectedRoutes(item.id))) {
      throw new Error(`主体 ${item.id} 路由集合或顺序不符。`);
    }
    for (const [index, request] of item.requests.entries()) {
      if (request.method !== 'POST') throw new Error(`主体 ${item.id} 第 ${index + 1} 项不是 POST。`);
      const kind = requestKind(request);
      if (!kind) throw new Error(`主体 ${item.id} 存在未授权路由：${request.path}`);
      requestCounts[kind] += 1;
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new Error(`主体 ${item.id} 请求正文缺失。`);
      if (kind === 'skill' && request.body.skillKey !== skillKey) throw new Error(`主体 ${item.id} 技能键不符。`);
      if (kind === 'parameter' && !request.body.parameterKey) throw new Error(`主体 ${item.id} 参数键缺失。`);
      if (kind === 'effect' && (!fixedAttributeIds.has(item.id) || request.body.effectKey !== 'stat_bonus')) throw new Error(`主体 ${item.id} 效果正文不符。`);
      if (kind === 'trigger-rule' && (!fixedAttributeIds.has(item.id) || request.body.ruleKey !== 'initialize_stat_bonus')) throw new Error(`主体 ${item.id} 规则正文不符。`);
      if (kind === 'relation' && (request.body.runeKey !== runeKeyOf(item.id) || request.body.skillKey !== skillKey || request.body.sortOrder !== 0)) throw new Error(`主体 ${item.id} 挂载正文不符。`);
      if (kind !== 'skill' && kind !== 'relation' && request.body.skillKey && request.body.skillKey !== skillKey) throw new Error(`主体 ${item.id} 子对象技能键不符。`);
      if (kind === 'parameter' && (request.body.valueMode !== 'FIXED' || request.body.levelValues !== null || typeof request.body.fixedValue !== 'number')) throw new Error(`主体 ${item.id} 参数不是固定值。`);
    }
    if (!fixedAttributeIds.has(item.id) && item.requests.some((request) => ['effect', 'trigger-rule'].includes(requestKind(request)))) {
      throw new Error(`主体 ${item.id} 不应有属性效果或初始化规则。`);
    }
    candidateById.set(item.id, item);
  }
  if (!sameJson(requestCounts, { skill: 5, parameter: 6, effect: 3, 'trigger-rule': 3, relation: 5 })) throw new Error(`请求计数不符：${JSON.stringify(requestCounts)}`);

  const sourceReport = readJson(frozenSourceFile);
  if (sourceReport.sourceSha256 !== sourceSha256 || sourceReport.byteSize !== fs.statSync(sourceFile).size) throw new Error('冻结来源记录与实际来源文件不符。');
  const sourceRows = readJson(sourceFile);
  if (!Array.isArray(sourceRows)) throw new Error('冻结来源文件不是数组。');
  const sourceById = new Map((sourceReport.sources || []).map((item) => [item?.raw?.id, item]));
  const sourceChecks = [];
  for (const id of targetIds) {
    const entry = sourceById.get(id);
    if (!entry || entry.sha256 !== sourceSha256 || entry.version !== '16.17' || entry.raw?.id !== id) throw new Error(`主体 ${id} 来源记录不完整。`);
    const index = parseIdPointer(entry.pointer);
    if (index === null || !sameJson(sourceRows[index], entry.raw)) throw new Error(`主体 ${id} 来源指针或原文不符。`);
    sourceChecks.push({ id, pointer: entry.pointer, text: cleanText(entry.raw.longDesc), sha256: entry.sha256 });
  }

  const boundary = readJson(boundaryFile);
  for (const id of targetIds) {
    const entry = (boundary.entries || []).find((item) => item.id === id);
    const candidateEntry = candidateById.get(id);
    if (!entry || !sameJson(entry.requests, candidateEntry.requests)) throw new Error(`主体 ${id} 与候选边界记录不一致。`);
  }
  const structure = readJson(structureFile);
  if (structure.checks?.requestCount !== 22 || structure.checks?.forbiddenIdentityOrDictionaryRequests !== 0 || structure.checks?.businessWritesPerformed !== 0) {
    throw new Error('结构核对记录不满足 22 项、无身份/字典请求且未写入的约束。');
  }
  const arithmetic = readJson(arithmeticFile);
  if (!Array.isArray(arithmetic.arithmetic) || arithmetic.arithmetic.length !== 8 || arithmetic.arithmetic.some((item) => item.passed !== true)) {
    throw new Error('父独立数值核对未完整通过。');
  }

  return {
    candidate,
    sourceChecks,
    candidateSha256: actualCandidateSha256,
    sourceSha256: actualSourceSha256,
    sourceByteSize: fs.statSync(sourceFile).size,
    requestCounts,
    counts: { subjects: candidate.length, requests: candidate.reduce((sum, item) => sum + item.requests.length, 0) },
    parentEvidence: {
      structureFile: path.basename(structureFile),
      structureChecks: structure.checks,
      arithmeticFile: path.basename(arithmeticFile),
      arithmeticCount: arithmetic.arithmetic.length
    }
  };
}

async function request(method, route, body) {
  if (method !== 'GET' && !apply) throw new Error(`只读模式禁止 ${method} ${route}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
  const options = { method, headers, signal: controller.signal };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  let text;
  try {
    response = await fetch(`${baseUrl}${route}`, options);
    text = await response.text();
  } catch (error) {
    throw new NetworkFailure(method, route, error);
  } finally {
    clearTimeout(timeout);
  }
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 20000) };
    }
  }
  if (response.status < 200 || response.status >= 300) throw new ApiFailure(method, route, response.status, data);
  return { status: response.status, data };
}

function recordGet(route, context, result) {
  const item = { route, context, status: result.status ?? null, exists: result.exists ?? false, data: result.data ?? null };
  if (result.error) item.error = describeError(result.error);
  report.gets.push(redact({ at: new Date().toISOString(), ...item }));
  journal({ type: 'GET', ...item });
  saveReport();
}

async function safeRead(route, context) {
  try {
    const response = await request('GET', route);
    const result = { exists: true, status: response.status, data: response.data, error: null };
    recordGet(route, context, result);
    return result;
  } catch (error) {
    const result = { exists: false, status: error?.status ?? null, data: error?.data ?? null, error };
    recordGet(route, context, result);
    return result;
  }
}

function responseImage(result) {
  if (!result?.exists || !result.data || typeof result.data !== 'object' || !Object.prototype.hasOwnProperty.call(result.data, 'image')) return null;
  if (result.data.image === null) return null;
  if (!result.data.image || typeof result.data.image !== 'object' || typeof result.data.image.imageKey !== 'string') return { invalid: true };
  return result.data.image;
}

function readSnapshot(result) {
  return {
    exists: result?.exists ?? false,
    status: result?.status ?? null,
    data: result?.data ?? null,
    error: result?.error ? describeError(result.error) : null
  };
}

function preflightSnapshot(pre) {
  return {
    id: pre.id,
    skillKey: pre.skillKey,
    runeKey: pre.runeKey,
    blockers: pre.blockers,
    warnings: pre.warnings,
    skill: readSnapshot(pre.skill),
    rune: readSnapshot(pre.rune),
    collections: pre.collections,
    requests: pre.requestStates,
    relation: pre.relation,
    images: pre.images
  };
}

async function preflightObject(entry) {
  const id = entry.id;
  const skillKey = skillKeyOf(id);
  const runeKey = runeKeyOf(id);
  const pre = {
    id,
    skillKey,
    runeKey,
    blockers: [],
    warnings: [],
    skill: null,
    rune: null,
    collections: {},
    requestStates: [],
    relation: null,
    images: null
  };
  const models = entry.requests.map((request, index) => ({ request, index, kind: requestKind(request), readRoute: readRouteFor(request) }));
  const skillModel = models.find((item) => item.kind === 'skill');
  pre.skill = await safeRead(skillModel.readRoute, { phase: 'preflight', id, kind: 'skill', requestIndex: skillModel.index });
  if (pre.skill.exists && !matchesRequest(skillModel.request, pre.skill.data)) pre.blockers.push('技能现值与候选不一致');
  if (pre.skill.error && pre.skill.status !== 404) pre.blockers.push('技能现值读取失败');

  pre.rune = await safeRead(runeRoute(runeKey), { phase: 'preflight', id, kind: 'rune-prerequisite' });
  if (!pre.rune.exists) pre.blockers.push(pre.rune.status === 404 ? '符文身份不存在，不能创建挂载' : '符文身份读取失败');

  const childKinds = ['parameter', 'effect', 'trigger-rule'];
  for (const kind of childKinds) {
    const childModels = models.filter((item) => item.kind === kind);
    const list = await safeRead(collectionRoute(kind, skillKey), { phase: 'preflight', id, kind: `${kind}-list` });
    const listItems = list.exists && Array.isArray(list.data) ? list.data : null;
    const listKeys = listItems ? listItems.map((item) => primaryKey(kind, item)) : [];
    const parentMissing = !pre.skill.exists && pre.skill.status === 404 && list.status === 404;
    if (list.error && !parentMissing) pre.blockers.push(`${kind}列表读取失败`);
    pre.collections[kind] = { ...readSnapshot(list), itemCount: listItems?.length ?? null, keys: listKeys };
    if (listItems && childModels.length === 0 && listItems.length > 0) pre.warnings.push(`${kind}现有额外对象 ${listItems.length} 个，未改动`);
    for (const model of childModels) {
      const detail = await safeRead(model.readRoute, { phase: 'preflight', id, kind, requestIndex: model.index });
      const listed = listItems ? listItems.find((item) => primaryKey(kind, item) === primaryKey(kind, model.request.body)) : undefined;
      let state = 'read-error';
      if (parentMissing && detail.status === 404) state = 'parent-missing';
      else if (detail.exists) state = matchesRequest(model.request, detail.data) ? 'same' : 'conflict';
      else if (detail.status === 404 && listItems && !listed) state = 'missing';
      else if (detail.status === 404 && !listItems) state = 'read-error';
      if (listed && detail.status === 404) state = 'inconsistent';
      if (state === 'conflict' || state === 'inconsistent') pre.blockers.push(`${kind} ${primaryKey(kind, model.request.body)} 现值冲突`);
      if (state === 'read-error') pre.blockers.push(`${kind} ${primaryKey(kind, model.request.body)} 读取失败`);
      pre.requestStates[model.index] = {
        index: model.index,
        kind,
        postRoute: model.request.path,
        readRoute: model.readRoute,
        state,
        expected: expectedCore(model.request),
        actual: detail.exists ? actualForRequest(model.request, detail.data) : null,
        detail: readSnapshot(detail)
      };
    }
  }

  const relationModel = models.find((item) => item.kind === 'relation');
  const relation = await safeRead(relationListRoute(runeKey), { phase: 'preflight', id, kind: 'relation-list' });
  const relationItems = relation.exists && Array.isArray(relation.data?.items) ? relation.data.items : null;
  const relationItem = relationItems?.find((item) => item.runeKey === runeKey && item.skillKey === skillKey);
  let relationState = 'read-error';
  if (relation.exists && relationItems) relationState = relationItem ? (matchesRequest(relationModel.request, { items: [relationItem] }) ? 'same' : 'conflict') : 'missing';
  else if (relation.status === 404 && pre.rune.status === 404) relationState = 'parent-missing';
  if (relation.error && relationState !== 'parent-missing') pre.blockers.push('符文技能挂载列表读取失败');
  if (relationState === 'conflict') pre.blockers.push('符文技能挂载现值冲突');
  pre.relation = {
    ...readSnapshot(relation),
    itemCount: relationItems?.length ?? null,
    extraItems: relationItems?.filter((item) => !(item.runeKey === runeKey && item.skillKey === skillKey)) ?? [],
    state: relationState,
    expected: expectedCore(relationModel.request),
    actual: relationItem ? relationCore(relationItem) : null
  };
  pre.requestStates[relationModel.index] = {
    index: relationModel.index,
    kind: 'relation',
    postRoute: relationModel.request.path,
    readRoute: relationModel.readRoute,
    state: relationState,
    expected: expectedCore(relationModel.request),
    actual: relationItem ? relationCore(relationItem) : null,
    detail: readSnapshot(relation)
  };

  const sourceImage = await safeRead(runeRepresentativeRoute(runeKey), { phase: 'preflight', id, kind: 'rune-representative-image' });
  const skillImage = await safeRead(skillRepresentativeRoute(skillKey), { phase: 'preflight', id, kind: 'skill-representative-image' });
  const sourceImageValue = responseImage(sourceImage);
  const skillImageValue = responseImage(skillImage);
  if (sourceImageValue?.invalid) pre.warnings.push('符文代表图响应格式异常，跳过复用');
  if (sourceImage.exists && sourceImageValue && sourceImageValue.enabled !== true) pre.blockers.push('符文代表图未启用，停止该对象图片复用');
  if (skillImage.exists && skillImageValue?.invalid) pre.blockers.push('技能代表图响应格式异常');
  if (skillImage.exists && skillImageValue && sourceImageValue && skillImageValue.imageKey !== sourceImageValue.imageKey) pre.blockers.push('技能已有代表图且与符文图不同');
  if (sourceImage.error && sourceImage.status !== 404) pre.warnings.push('符文代表图读取失败，核心效果录入仍可继续但跳过图片复用');
  pre.images = {
    source: readSnapshot(sourceImage),
    sourceImage: sourceImageValue?.invalid ? null : sourceImageValue,
    skill: readSnapshot(skillImage),
    skillImage: skillImageValue?.invalid ? null : skillImageValue,
    state: sourceImageValue?.invalid || skillImageValue?.invalid ? 'unavailable' : !sourceImageValue ? 'no-source-image' : !skillImage.exists ? 'parent-missing' : skillImageValue && skillImageValue.imageKey === sourceImageValue.imageKey ? 'same' : skillImageValue ? 'conflict' : 'planned'
  };

  for (const model of models) {
    if (pre.requestStates[model.index]) continue;
    let state = 'read-error';
    if (model.kind === 'skill') state = pre.skill.exists ? (matchesRequest(model.request, pre.skill.data) ? 'same' : 'conflict') : pre.skill.status === 404 ? 'missing' : 'read-error';
    pre.requestStates[model.index] = { index: model.index, kind: model.kind, postRoute: model.request.path, readRoute: model.readRoute, state, expected: expectedCore(model.request), actual: pre.skill.exists ? actualForRequest(model.request, pre.skill.data) : null, detail: readSnapshot(pre.skill) };
  }
  if (pre.blockers.length) {
    failure('preflight-conflict', `skill:${skillKey}`, new Error('预检发现对象保护阻塞项。'), { blockers: pre.blockers });
  }
  if (pre.warnings.length) warning('preflight-warning', `skill:${skillKey}`, '预检发现可选项警告。', { warnings: pre.warnings });
  report.preflight.targets.push(redact(preflightSnapshot(pre)));
  saveReport();
  return { entry, pre, models };
}

function assertAllowedCandidatePost(request) {
  if (request.method !== 'POST' || !candidateAllowedPosts.has(request.path)) throw new Error(`尝试写入未授权候选路由：${request.method} ${request.path}`);
}

function assertAllowedImagePut(route, skillKey) {
  if (!targetIds.some((id) => skillKeyOf(id) === skillKey) || route !== skillRepresentativeRoute(skillKey)) throw new Error(`尝试写入未授权技能图片关系：PUT ${route}`);
}

async function postAndConfirm(requestToWrite, confirmRoute, context) {
  assertAllowedCandidatePost(requestToWrite);
  let postResponse = null;
  let postError = null;
  try {
    postResponse = await request('POST', requestToWrite.path, requestToWrite.body);
    operation({ type: 'POST', phase: 'write', target: context.target, route: requestToWrite.path, result: 'response-received', status: postResponse.status, response: postResponse.data, expected: expectedCore(requestToWrite) });
  } catch (error) {
    postError = error;
    operation({ type: 'POST', phase: 'write', target: context.target, route: requestToWrite.path, result: 'error-response', status: error?.status ?? null, response: error?.data ?? null, error: describeError(error), expected: expectedCore(requestToWrite) });
  }
  const confirmed = await safeRead(confirmRoute, { phase: 'post-confirm', target: context.target, requestIndex: context.requestIndex });
  const confirmedMatches = confirmed.exists && matchesRequest(requestToWrite, confirmed.data);
  if (confirmedMatches) {
    report.summary.post.written += postError ? 0 : 1;
    if (postError) report.summary.post.confirmedAfterError += 1;
    operation({ type: 'GET_CONFIRM', target: context.target, route: confirmRoute, result: postError ? 'confirmed-after-error-no-retry' : 'written-and-confirmed', status: confirmed.status, actual: actualForRequest(requestToWrite, confirmed.data) });
    return { ok: true, postError, confirmed };
  }
  report.summary.post.failed += 1;
  failure('post-confirm', context.target, postError || new Error('写入后 GET 未得到候选现值，未重发。'), {
    requestIndex: context.requestIndex,
    postRoute: requestToWrite.path,
    postStatus: postResponse?.status ?? postError?.status ?? null,
    postResponse: postResponse?.data ?? postError?.data ?? null,
    confirmed: readSnapshot(confirmed),
    retry: false
  });
  return { ok: false, postError, confirmed };
}

async function imagePutAndConfirm(skillKey, imageKey, target) {
  const route = skillRepresentativeRoute(skillKey);
  assertAllowedImagePut(route, skillKey);
  let response = null;
  let error = null;
  try {
    response = await request('PUT', route, { imageKey });
    operation({ type: 'PUT', phase: 'image-relation', target, route, result: 'response-received', status: response.status, response: response.data, body: { imageKey } });
  } catch (caught) {
    error = caught;
    operation({ type: 'PUT', phase: 'image-relation', target, route, result: 'error-response', status: caught?.status ?? null, response: caught?.data ?? null, error: describeError(caught), body: { imageKey } });
  }
  const confirmed = await safeRead(route, { phase: 'image-post-confirm', target });
  const actualImage = responseImage(confirmed);
  if (actualImage && actualImage.imageKey === imageKey) {
    report.summary.imageRelations.written += 1;
    operation({ type: 'GET_CONFIRM', target, route, result: error ? 'confirmed-after-error-no-retry' : 'written-and-confirmed', status: confirmed.status, actual: actualImage });
    return true;
  }
  report.summary.imageRelations.failed += 1;
  failure('image-put-confirm', target, error || new Error('图片关系写入后 GET 未得到同图，未重发。'), { imageKey, response: error?.data ?? response?.data ?? null, confirmed: readSnapshot(confirmed), retry: false });
  return false;
}

async function processImage(object) {
  const { entry, pre } = object;
  const target = `skill:${pre.skillKey}/representative-image`;
  const sourceImage = pre.images?.sourceImage;
  if (!sourceImage) {
    report.summary.imageRelations.noSourceImage += 1;
    operation({ type: 'IMAGE_RELATION', target, result: 'no-source-image' });
    return true;
  }
  if (sourceImage.enabled !== true) {
    report.summary.imageRelations.conflict += 1;
    failure('image-source-conflict', target, new Error('对应符文代表图未启用，未建立技能图片关系。'), { sourceImage });
    return false;
  }
  const current = await safeRead(skillRepresentativeRoute(pre.skillKey), { phase: 'image-before-write', id: entry.id });
  const currentImage = responseImage(current);
  if (currentImage?.invalid) {
    report.summary.imageRelations.failed += 1;
    failure('image-current-read', target, new Error('技能代表图响应格式异常。'));
    return false;
  }
  if (currentImage && currentImage.imageKey !== sourceImage.imageKey) {
    report.summary.imageRelations.conflict += 1;
    failure('image-conflict', target, new Error('技能已有不同代表图，按对象保护停止。'), { expectedImageKey: sourceImage.imageKey, actualImage: currentImage });
    return false;
  }
  if (currentImage && currentImage.imageKey === sourceImage.imageKey) {
    report.summary.imageRelations.skippedSame += 1;
    operation({ type: 'IMAGE_RELATION', target, result: 'same-image-skip', imageKey: sourceImage.imageKey });
    return true;
  }
  report.summary.imageRelations.planned += 1;
  const success = await imagePutAndConfirm(pre.skillKey, sourceImage.imageKey, target);
  if (!success) return false;
  return true;
}

async function processObject(object) {
  const { entry, pre } = object;
  const target = `skill:${pre.skillKey}`;
  if (pre.blockers.length) {
    report.summary.objects.blocked += 1;
    operation({ type: 'OBJECT', target, result: 'blocked-by-preflight', blockers: pre.blockers });
    return;
  }
  report.summary.objects.ready += 1;
  let complete = true;
  for (const model of object.models.sort((a, b) => a.index - b.index)) {
    const state = pre.requestStates[model.index];
    if (!state) {
      complete = false;
      failure('state-missing', target, new Error(`候选第 ${model.index + 1} 项没有预检状态。`));
      break;
    }
    const requestToWrite = model.request;
    if (state.state === 'same') {
      report.summary.post.reused += 1;
      operation({ type: 'POST', phase: 'preflight', target: `${target}/${model.kind}`, route: requestToWrite.path, result: 'same-value-skip', expected: expectedCore(requestToWrite), actual: state.actual });
      continue;
    }
    if (!['missing', 'parent-missing'].includes(state.state)) {
      complete = false;
      report.summary.post.conflict += state.state === 'conflict' || state.state === 'inconsistent' ? 1 : 0;
      failure('object-protection', `${target}/${model.kind}`, new Error(`预检状态 ${state.state} 不允许写入。`), { state });
      break;
    }
    const confirmation = await postAndConfirm(requestToWrite, state.readRoute, { target: `${target}/${model.kind}`, requestIndex: model.index });
    if (!confirmation.ok) {
      complete = false;
      break;
    }
  }
  if (complete) {
    const imageComplete = await processImage(object);
    complete = complete && imageComplete;
  }
  if (complete) {
    report.summary.objects.completed += 1;
    operation({ type: 'OBJECT', target, result: 'completed' });
  } else {
    report.summary.objects.failed += 1;
    operation({ type: 'OBJECT', target, result: 'stopped-after-failure' });
  }
  saveReport();
}

function recordReadOnlyPlan(objects) {
  for (const object of objects) {
    for (const model of object.models) {
      const state = object.pre.requestStates[model.index];
      if (!state) continue;
      if (state.state === 'same') {
        report.summary.post.reused += 1;
        operation({ type: 'POST', phase: 'read-only-plan', target: `skill:${object.pre.skillKey}/${model.kind}`, route: model.request.path, result: 'same-value-skip', expected: expectedCore(model.request), actual: state.actual });
      } else if (['missing', 'parent-missing'].includes(state.state)) {
        report.summary.post.planned += 1;
        operation({ type: 'POST', phase: 'read-only-plan', target: `skill:${object.pre.skillKey}/${model.kind}`, route: model.request.path, result: 'missing-plan-only', expected: expectedCore(model.request), state: state.state });
      }
    }
  }
}

const staticResult = staticVerification();
const candidate = staticResult.candidate;
const candidateAllowedPosts = new Set(candidate.flatMap((entry) => entry.requests.map((requestToWrite) => requestToWrite.path)));

async function main() {
  report.staticVerification = staticResult;
  report.preflight.startedAt = new Date().toISOString();
  saveReport();
  const objects = [];
  for (const entry of candidate) objects.push(await preflightObject(entry));
  report.preflight.completedAt = new Date().toISOString();
  report.preflight.summary = {
    targetObjects: objects.length,
    blockedObjects: objects.filter((object) => object.pre.blockers.length > 0).length,
    targetRequests: candidate.reduce((sum, entry) => sum + entry.requests.length, 0),
    sameRequests: objects.reduce((sum, object) => sum + object.pre.requestStates.filter((state) => state?.state === 'same').length, 0),
    missingRequests: objects.reduce((sum, object) => sum + object.pre.requestStates.filter((state) => ['missing', 'parent-missing'].includes(state?.state)).length, 0),
    conflictOrErrorRequests: objects.reduce((sum, object) => sum + object.pre.requestStates.filter((state) => state && !['same', 'missing', 'parent-missing'].includes(state.state)).length, 0)
  };
  saveReport();
  if (!apply) {
    recordReadOnlyPlan(objects);
    report.completedAt = new Date().toISOString();
    saveReport();
    console.log(JSON.stringify({ mode: report.mode, reportFile, summary: report.summary, preflight: report.preflight.summary }, null, 2));
    return;
  }
  for (const object of objects) await processObject(object);
  report.completedAt = new Date().toISOString();
  saveReport();
  console.log(JSON.stringify({ mode: report.mode, reportFile, summary: report.summary, preflight: report.preflight.summary, failures: report.failures.length }, null, 2));
  if (report.failures.length > 0) process.exitCode = 2;
}

main().catch((error) => {
  report.fatal = describeError(error);
  failure('fatal', 'batch', error);
  saveReport();
  console.error(JSON.stringify({ mode: report.mode, reportFile, error: describeError(error) }, null, 2));
  process.exitCode = 1;
});

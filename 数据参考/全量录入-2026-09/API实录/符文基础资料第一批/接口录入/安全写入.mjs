import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const batchDir = path.resolve(here, '..');
const dataRoot = path.resolve(batchDir, '..', '..');
const candidateFile = path.join(here, '接口候选.json');
const sourceReportFile = path.join(here, '来源图片哈希.json');
const pageSeedFile = path.join(batchDir, '页面种子.json');
const freezeCandidateSha256 = '3998e7f3dd49dcbbb29fd257f022202139d077c11c8131f50f63362874f6895d';
const gameId = 'lol';
const baseUrl = process.env.DAMAGE_VIEWER_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_VIEWER_LOCAL_BEARER;
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
  throw new Error('参数仅支持默认只读或显式 --apply。');
}
const apply = args.length === 1;
if (!token) throw new Error('缺少 DAMAGE_VIEWER_LOCAL_BEARER，未执行任何接口调用。');

const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
const reportFile = path.join(here, `安全写入-${apply ? '执行' : '只读'}-${runStamp}.json`);
const journalFile = path.join(here, '安全写入流水.jsonl');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function coreRune(row) {
  return row && {
    runeKey: row.runeKey,
    name: row.name,
    description: row.description,
    category: row.category
  };
}

function corePath(row) {
  return row && {
    pathKey: row.pathKey,
    name: row.name,
    description: row.description,
    kind: row.kind,
    sortOrder: row.sortOrder,
    slots: Array.isArray(row.slots) ? row.slots.map((slot) => ({
      name: slot.name,
      category: slot.category,
      runeKeys: Array.isArray(slot.runeKeys) ? [...slot.runeKeys] : slot.runeKeys
    })) : row.slots
  };
}

function redact(value, depth = 0) {
  if (depth > 8) return '[省略]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(imageBase64|token|authorization|cookie)$/i.test(key)) continue;
    output[key] = redact(item, depth + 1);
  }
  return output;
}

function summarizeResponse(data) {
  if (!data || typeof data !== 'object') return redact(data);
  if (Array.isArray(data.items)) return { total: data.total, items: data.items.map((item) => redact(item)) };
  if (Object.prototype.hasOwnProperty.call(data, 'image')) {
    return { image: data.image ? {
      imageKey: data.image.imageKey,
      name: data.image.name,
      enabled: data.image.enabled,
      mimeType: data.image.mimeType,
      byteSize: data.image.byteSize,
      width: data.image.width,
      height: data.image.height
    } : null };
  }
  return redact(data);
}

function safeRoutePart(value) {
  return encodeURIComponent(value);
}

class NetworkFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkFailure';
  }
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

async function request(method, route, body) {
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
    throw new NetworkFailure(`${method} ${route} 网络请求失败：${error?.name || '未知错误'}`);
  } finally {
    clearTimeout(timeout);
  }
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 2000) };
    }
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ApiFailure(method, route, response.status, data);
  }
  return { status: response.status, data };
}

async function getMaybe(route) {
  try {
    const response = await request('GET', route);
    return { exists: true, data: response.data, status: response.status };
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) {
      return { exists: false, data: null, status: 404 };
    }
    throw error;
  }
}

function describeError(error) {
  if (error instanceof ApiFailure) {
    return { type: error.name, method: error.method, route: error.route, status: error.status, response: summarizeResponse(error.data) };
  }
  return { type: error?.name || 'Error', message: String(error?.message || error) };
}

function relativeDataPath(file) {
  const resolved = path.resolve(dataRoot, file);
  if (!resolved.startsWith(`${dataRoot}${path.sep}`)) throw new Error(`来源路径越界：${file}`);
  return resolved;
}

function relativeBatchPath(file) {
  const resolved = path.resolve(batchDir, file);
  if (!resolved.startsWith(`${batchDir}${path.sep}`)) throw new Error(`批次路径越界：${file}`);
  return resolved;
}

function decodeImageBase64(value) {
  if (typeof value !== 'string' || !value) return null;
  const comma = value.indexOf(',');
  const encoded = comma >= 0 ? value.slice(comma + 1) : value;
  try {
    return Buffer.from(encoded, 'base64');
  } catch {
    return null;
  }
}

function staticVerification(candidate, sourceReport, pageSeed) {
  if (candidate.frozenCandidateSha256 !== freezeCandidateSha256) throw new Error('接口候选未绑定冻结候选 SHA256。');
  const originalCandidate = path.join(batchDir, '候选与来源.json');
  const originalSha256 = sha256File(originalCandidate);
  if (originalSha256 !== freezeCandidateSha256) throw new Error(`候选与来源.json SHA256 不符：${originalSha256}`);
  if (candidate.gameId !== gameId) throw new Error('接口候选游戏不是 lol。');
  if (candidate.counts?.runes !== 69 || candidate.counts?.paths !== 6 || candidate.counts?.requestedImages !== 74) throw new Error('接口候选数量不符合冻结集合。');
  if (!Array.isArray(candidate.runes) || candidate.runes.length !== 69) throw new Error('接口候选符文数量不为69。');
  if (!Array.isArray(candidate.paths) || candidate.paths.length !== 6) throw new Error('接口候选布局数量不为6。');
  if (!Array.isArray(candidate.images) || candidate.images.length !== 74) throw new Error('接口候选图片数量不为74。');
  if (!Array.isArray(sourceReport.images) || sourceReport.images.length !== 74) throw new Error('来源图片哈希记录数量不为74。');
  const sourceImageByKey = new Map(sourceReport.images.map((item) => [item.targetKey, item]));
  const runeKeys = new Set();
  for (const item of candidate.runes) {
    const body = item.body;
    if (!body || !['runeKey', 'name', 'description', 'category'].every((key) => Object.prototype.hasOwnProperty.call(body, key))) throw new Error('符文候选缺少接口字段。');
    if (runeKeys.has(body.runeKey)) throw new Error(`符文键重复：${body.runeKey}`);
    runeKeys.add(body.runeKey);
    if (!['KEYSTONE', 'MINOR', 'SHARD'].includes(body.category)) throw new Error(`符文分类非法：${body.runeKey}`);
  }
  const pathKeys = new Set();
  let slots = 0;
  let positions = 0;
  for (const item of candidate.paths) {
    const body = item.body;
    if (!body || pathKeys.has(body.pathKey)) throw new Error(`布局键重复或缺失：${body?.pathKey}`);
    pathKeys.add(body.pathKey);
    if (!Array.isArray(body.slots)) throw new Error(`布局槽位缺失：${body.pathKey}`);
    slots += body.slots.length;
    for (const slot of body.slots) {
      if (!Array.isArray(slot.runeKeys) || new Set(slot.runeKeys).size !== slot.runeKeys.length) throw new Error(`布局槽位重复：${body.pathKey}/${slot.name}`);
      positions += slot.runeKeys.length;
      for (const runeKey of slot.runeKeys) if (!runeKeys.has(runeKey)) throw new Error(`布局引用未知符文：${body.pathKey}/${runeKey}`);
    }
  }
  if (slots !== 23 || positions !== 71) throw new Error(`布局统计不符：${slots}槽/${positions}位置。`);
  if (!pathKeys.has('rune_shards')) throw new Error('布局缺少 rune_shards。');
  const imageKeys = new Set();
  const imageChecks = [];
  for (const plan of candidate.images) {
    if (plan.targetKey === 'rune_shards' || imageKeys.has(`${plan.kind}:${plan.targetKey}`)) throw new Error(`图片目标非法或重复：${plan.targetKey}`);
    imageKeys.add(`${plan.kind}:${plan.targetKey}`);
    const sourceImage = sourceImageByKey.get(plan.targetKey);
    if (!sourceImage) throw new Error(`图片没有来源哈希：${plan.targetKey}`);
    const preparedPath = relativeBatchPath(plan.preparedFile);
    const rawPath = relativeBatchPath(plan.rawFile);
    if (!fs.existsSync(preparedPath) || !fs.existsSync(rawPath)) throw new Error(`图片文件不存在：${plan.targetKey}`);
    const prepared = fs.readFileSync(preparedPath);
    const actualSha256 = sha256Buffer(prepared);
    const rawSha256 = sha256File(rawPath);
    const size = pngSize(prepared);
    if (actualSha256 !== plan.preparedSha256 || actualSha256 !== sourceImage.preparedSha256) throw new Error(`页面图片哈希不符：${plan.targetKey}`);
    if (rawSha256 !== plan.rawSha256 || rawSha256 !== sourceImage.rawSha256) throw new Error(`原始图片哈希不符：${plan.targetKey}`);
    if (!size || size.width !== plan.width || size.height !== plan.height || prepared.length !== plan.byteSize) throw new Error(`页面图片元数据不符：${plan.targetKey}`);
    imageChecks.push({ targetKey: plan.targetKey, sha256: actualSha256, byteSize: prepared.length, width: size.width, height: size.height });
  }
  const inputChecks = [];
  for (const [name, entry] of Object.entries(sourceReport.inputHashes || {})) {
    const file = relativeDataPath(entry.file);
    const actualSha256 = sha256File(file);
    if (actualSha256 !== entry.sha256) throw new Error(`输入文件哈希变化：${entry.file}`);
    inputChecks.push({ name, file: entry.file, sha256: actualSha256, byteSize: fs.statSync(file).size });
  }
  const sourceChecks = [];
  for (const source of [...(sourceReport.verifiedSources || []), ...(sourceReport.derivedSources || [])]) {
    const file = relativeDataPath(source.resolvedFile);
    const actualSha256 = sha256File(file);
    if (actualSha256 !== source.sha256) throw new Error(`冻结来源哈希变化：${source.resolvedFile}`);
    sourceChecks.push({ file: source.resolvedFile, sha256: actualSha256, byteSize: fs.statSync(file).size });
  }
  if (!sameJson(coreRune(candidate.runes.find((item) => item.body.runeKey === pageSeed.rune.runeKey)?.body), coreRune(pageSeed.rune))) throw new Error('页面种子首个符文与候选不一致。');
  if (!sameJson(coreRune(candidate.runes.find((item) => item.body.runeKey === pageSeed.shard.runeKey)?.body), coreRune(pageSeed.shard))) throw new Error('页面种子属性碎片与候选不一致。');
  return {
    originalCandidateSha256: originalSha256,
    inputChecks,
    sourceChecks,
    imageChecks,
    counts: { runes: candidate.runes.length, paths: candidate.paths.length, slots, positions, images: imageChecks.length }
  };
}

const candidate = readJson(candidateFile);
const sourceReport = readJson(sourceReportFile);
const pageSeed = readJson(pageSeedFile);
const report = {
  schema: '符文基础资料第一批/接口录入/安全写入报告',
  runId: runStamp,
  mode: apply ? 'apply' : 'read-only',
  gameId,
  baseUrl,
  frozenCandidateSha256: freezeCandidateSha256,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  staticVerification: null,
  liveLists: null,
  protectedExisting: { runeKeys: [], pathKeys: [], extraRuneKeys: [], extraPathKeys: [] },
  summary: {
    runes: { target: 69, reused: 0, created: 0, planned: 0, conflict: 0, failed: 0 },
    paths: { target: 6, reused: 0, created: 0, updated: 0, planned: 0, conflict: 0, failed: 0 },
    images: { target: 74, reused: 0, created: 0, planned: 0, conflict: 0, failed: 0 },
    relations: { target: 74, reused: 0, set: 0, planned: 0, conflict: 0, failed: 0 }
  },
  operations: [],
  failures: [],
  final: null
};

function saveReport() {
  report.updatedAt = new Date().toISOString();
  fs.writeFileSync(reportFile, `${JSON.stringify(redact(report), null, 2)}\n`, 'utf8');
}

function journal(event) {
  fs.appendFileSync(journalFile, `${JSON.stringify(redact({ runId: report.runId, at: new Date().toISOString(), ...event }))}\n`, 'utf8');
}

function operation(event) {
  report.operations.push({ at: new Date().toISOString(), ...event });
  journal({ type: 'operation', ...event });
  saveReport();
}

function failure(stage, target, error, extra = {}) {
  const item = { at: new Date().toISOString(), stage, target, error: describeError(error), ...extra };
  report.failures.push(item);
  journal({ type: 'failure', ...item });
  saveReport();
}

function bump(group, field) {
  report.summary[group][field] += 1;
}

function runeRoute(key) {
  return `/runes/${safeRoutePart(key)}`;
}

function pathRoute(key) {
  return `/rune-paths/${safeRoutePart(key)}`;
}

function imageRoute(key) {
  return `/images/${safeRoutePart(key)}`;
}

function relationRoute(kind, key) {
  return kind === 'rune'
    ? `/runes/${safeRoutePart(key)}/representative-image`
    : `/rune-paths/${safeRoutePart(key)}/representative-image`;
}

function usageRoute(key) {
  return `/images/${safeRoutePart(key)}/usages`;
}

function relationImage(data) {
  if (!data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, 'image')) throw new Error('代表图响应缺少 image 字段。');
  if (data.image === null) return null;
  if (!data.image || typeof data.image !== 'object' || typeof data.image.imageKey !== 'string') throw new Error('代表图响应中的 image 不完整。');
  return data.image;
}

function verifyImage(image, plan, options = {}) {
  if (!image || image.gameId !== gameId || image.imageKey === undefined) return { ok: false, reason: '图片身份字段不符' };
  if (image.enabled !== true) return { ok: false, reason: '图片未启用' };
  if (image.mimeType !== 'image/png') return { ok: false, reason: `图片类型为 ${image.mimeType}` };
  if (image.byteSize !== plan.byteSize || image.width !== plan.width || image.height !== plan.height) return { ok: false, reason: '图片尺寸或字节数不符' };
  const bytes = decodeImageBase64(image.imageBase64);
  if (!bytes) return { ok: false, reason: '图片内容缺失或不是有效 base64' };
  const actualSha256 = sha256Buffer(bytes);
  if (actualSha256 !== plan.preparedSha256 || bytes.length !== plan.byteSize) return { ok: false, reason: `图片内容哈希不符：${actualSha256}` };
  if (options.requireProposedName && image.name !== plan.proposedImageName) return { ok: false, reason: `图片名称不符：${image.name}` };
  return { ok: true, imageKey: image.imageKey, sha256: actualSha256 };
}

function imageSummary(image) {
  if (!image) return null;
  return {
    imageKey: image.imageKey,
    name: image.name,
    enabled: image.enabled,
    mimeType: image.mimeType,
    byteSize: image.byteSize,
    width: image.width,
    height: image.height
  };
}

const acceptedImageReuse = new Map((candidate.acceptedImageReuse || []).map((item) => [`${item.kind}:${item.targetKey}`, item.imageKey]));
const liveRuneKeys = new Set();
const livePathKeys = new Set();
const runeReady = new Set();
const pathReady = new Set();
const runeStates = new Map();
const pathStates = new Map();

async function fetchList(route, label) {
  const response = await request('GET', route);
  if (!response.data || !Array.isArray(response.data.items) || response.data.total !== response.data.items.length) throw new Error(`${label}列表响应不符合 items/total 约定。`);
  return response.data.items;
}

async function processRune(item) {
  const body = item.body;
  const key = body.runeKey;
  const target = `rune:${key}`;
  let current;
  try {
    current = await getMaybe(runeRoute(key));
  } catch (error) {
    bump('runes', 'failed');
    failure('rune-read', target, error);
    runeStates.set(key, 'failed');
    return;
  }
  if (current.exists) {
    if (sameJson(coreRune(current.data), coreRune(body))) {
      bump('runes', 'reused');
      runeReady.add(key);
      runeStates.set(key, 'reused');
      operation({ stage: 'runes', target, action: 'reuse', result: 'same-value', current: coreRune(current.data) });
    } else {
      bump('runes', 'conflict');
      runeStates.set(key, 'conflict');
      failure('rune-conflict', target, new Error('现有字段与冻结候选不同，按规则停止当前对象。'), { expected: coreRune(body), actual: coreRune(current.data) });
    }
    return;
  }
  if (liveRuneKeys.has(key)) {
    bump('runes', 'failed');
    runeStates.set(key, 'failed');
    failure('rune-read', target, new Error('列表包含该键但详情返回404，未冒险补写。'));
    return;
  }
  if (!apply) {
    bump('runes', 'planned');
    runeStates.set(key, 'planned');
    operation({ stage: 'runes', target, action: 'create', result: 'planned-read-only', body: coreRune(body) });
    return;
  }
  let postError = null;
  let postStatus = null;
  try {
    const response = await request('POST', '/runes', body);
    postStatus = response.status;
  } catch (error) {
    postError = error;
  }
  let confirmed;
  try {
    confirmed = await getMaybe(runeRoute(key));
  } catch (error) {
    bump('runes', 'failed');
    runeStates.set(key, 'failed');
    failure('rune-create-confirm', target, error, { postStatus, postError: postError ? describeError(postError) : null });
    return;
  }
  if (confirmed.exists && sameJson(coreRune(confirmed.data), coreRune(body))) {
    bump('runes', 'created');
    runeReady.add(key);
    runeStates.set(key, 'created');
    operation({ stage: 'runes', target, action: 'create', result: postError ? 'confirmed-after-error' : 'created-and-confirmed', postStatus, postError: postError ? describeError(postError) : null, current: coreRune(confirmed.data) });
  } else {
    bump('runes', 'failed');
    runeStates.set(key, 'failed');
    failure('rune-create', target, postError || new Error('写入后逐项 GET 未得到期望对象，未重发。'), { postStatus, postError: postError ? describeError(postError) : null, confirmed: confirmed.exists ? coreRune(confirmed.data) : null });
  }
}

function pathUpdateBody(body) {
  const { pathKey: _pathKey, ...update } = body;
  return update;
}

function pathIsPartialExact(key, current) {
  const partial = key === 'rune_path_8000' ? pageSeed.partialPath : key === 'rune_shards' ? pageSeed.partialShardPath : null;
  return partial && sameJson(corePath(current), corePath(partial));
}

async function processPath(item) {
  const body = item.body;
  const key = body.pathKey;
  const target = `path:${key}`;
  let current;
  try {
    current = await getMaybe(pathRoute(key));
  } catch (error) {
    bump('paths', 'failed');
    pathStates.set(key, 'failed');
    failure('path-read', target, error);
    return;
  }
  if (current.exists) {
    if (sameJson(corePath(current.data), corePath(body))) {
      bump('paths', 'reused');
      pathReady.add(key);
      pathStates.set(key, 'reused');
      operation({ stage: 'paths', target, action: 'reuse', result: 'same-value', current: corePath(current.data) });
      return;
    }
    if (!pathIsPartialExact(key, current.data)) {
      bump('paths', 'conflict');
      pathStates.set(key, 'conflict');
      failure('path-conflict', target, new Error('现有布局既不是冻结页面种子 partial，也不是最终候选，按规则停止当前对象。'), { expected: corePath(body), actual: corePath(current.data) });
      return;
    }
    const dependencies = body.slots.flatMap((slot) => slot.runeKeys).filter((runeKey) => !runeReady.has(runeKey));
    if (dependencies.length && apply) {
      bump('paths', 'failed');
      pathStates.set(key, 'failed');
      failure('path-dependency', target, new Error('布局引用的符文未完成同值复用或创建，未执行 partial 到完整布局更新。'), { dependencies: [...new Set(dependencies)] });
      return;
    }
    if (!apply) {
      bump('paths', 'planned');
      pathStates.set(key, 'planned');
      operation({ stage: 'paths', target, action: 'update', result: 'planned-read-only-partial-exact', expectedFinal: corePath(body), currentPartial: corePath(current.data), dependencies: [...new Set(dependencies)] });
      return;
    }
    let putError = null;
    let putStatus = null;
    try {
      const response = await request('PUT', pathRoute(key), pathUpdateBody(body));
      putStatus = response.status;
    } catch (error) {
      putError = error;
    }
    let confirmed;
    try {
      confirmed = await getMaybe(pathRoute(key));
    } catch (error) {
      bump('paths', 'failed');
      pathStates.set(key, 'failed');
      failure('path-update-confirm', target, error, { putStatus, putError: putError ? describeError(putError) : null });
      return;
    }
    if (confirmed.exists && sameJson(corePath(confirmed.data), corePath(body))) {
      bump('paths', 'updated');
      pathReady.add(key);
      pathStates.set(key, 'updated');
      operation({ stage: 'paths', target, action: 'update', result: putError ? 'confirmed-after-error' : 'updated-and-confirmed', putStatus, putError: putError ? describeError(putError) : null, current: corePath(confirmed.data) });
    } else {
      bump('paths', 'failed');
      pathStates.set(key, 'failed');
      failure('path-update', target, putError || new Error('布局更新后逐项 GET 未得到完整候选，未重发。'), { putStatus, putError: putError ? describeError(putError) : null, confirmed: confirmed.exists ? corePath(confirmed.data) : null });
    }
    return;
  }
  if (livePathKeys.has(key)) {
    bump('paths', 'failed');
    pathStates.set(key, 'failed');
    failure('path-read', target, new Error('列表包含该键但详情返回404，未冒险补写。'));
    return;
  }
  const dependencies = body.slots.flatMap((slot) => slot.runeKeys).filter((runeKey) => !runeReady.has(runeKey));
  if (dependencies.length && apply) {
    bump('paths', 'failed');
    pathStates.set(key, 'failed');
    failure('path-dependency', target, new Error('布局引用的符文未完成同值复用或创建，未执行创建。'), { dependencies: [...new Set(dependencies)] });
    return;
  }
  if (!apply) {
    bump('paths', 'planned');
    pathStates.set(key, 'planned');
    operation({ stage: 'paths', target, action: 'create', result: 'planned-read-only', body: corePath(body), dependencies: [...new Set(dependencies)] });
    return;
  }
  let postError = null;
  let postStatus = null;
  try {
    const response = await request('POST', '/rune-paths', body);
    postStatus = response.status;
  } catch (error) {
    postError = error;
  }
  let confirmed;
  try {
    confirmed = await getMaybe(pathRoute(key));
  } catch (error) {
    bump('paths', 'failed');
    pathStates.set(key, 'failed');
    failure('path-create-confirm', target, error, { postStatus, postError: postError ? describeError(postError) : null });
    return;
  }
  if (confirmed.exists && sameJson(corePath(confirmed.data), corePath(body))) {
    bump('paths', 'created');
    pathReady.add(key);
    pathStates.set(key, 'created');
    operation({ stage: 'paths', target, action: 'create', result: postError ? 'confirmed-after-error' : 'created-and-confirmed', postStatus, postError: postError ? describeError(postError) : null, current: corePath(confirmed.data) });
  } else {
    bump('paths', 'failed');
    pathStates.set(key, 'failed');
    failure('path-create', target, postError || new Error('布局创建后逐项 GET 未得到期望对象，未重发。'), { postStatus, postError: postError ? describeError(postError) : null, confirmed: confirmed.exists ? corePath(confirmed.data) : null });
  }
}

async function getUsages(plan, imageKey) {
  const response = await request('GET', usageRoute(imageKey));
  const data = response.data;
  if (!data || !Array.isArray(data.runes) || !Array.isArray(data.runePaths)) throw new Error('图片使用关系响应缺少 runes/runePaths。');
  const found = plan.kind === 'rune'
    ? data.runes.some((row) => row.runeKey === plan.targetKey)
    : data.runePaths.some((row) => row.pathKey === plan.targetKey);
  if (!found) throw new Error('图片已设为代表图，但使用关系回读未找到目标。');
  return { runeCount: data.runes.length, pathCount: data.runePaths.length, found };
}

async function verifyCurrentImage(plan, relation, namePolicy = false) {
  const imageKey = relation.imageKey;
  const imageResponse = await getMaybe(imageRoute(imageKey));
  if (!imageResponse.exists) throw new Error(`代表图片 ${imageKey} 详情返回404。`);
  const check = verifyImage(imageResponse.data, plan, { requireProposedName: namePolicy });
  if (!check.ok) throw new Error(`代表图片内容校验失败：${check.reason}`);
  return { image: imageResponse.data, check };
}

async function processImage(plan) {
  const target = `${plan.kind}:${plan.targetKey}`;
  let relation;
  try {
    const response = await request('GET', relationRoute(plan.kind, plan.targetKey));
    relation = relationImage(response.data);
  } catch (error) {
    const dependencyNotReady = !apply
      && error instanceof ApiFailure
      && error.status === 404
      && ((plan.kind === 'rune' && !runeReady.has(plan.targetKey)) || (plan.kind === 'runePath' && !pathReady.has(plan.targetKey)));
    if (dependencyNotReady) {
      bump('images', 'planned');
      bump('relations', 'planned');
      operation({ stage: 'images', target, action: 'read-relation', result: 'planned-dependency-not-created', status: error.status, response: summarizeResponse(error.data) });
      return;
    }
    bump('images', 'failed');
    bump('relations', 'failed');
    failure('image-relation-read', target, error);
    return;
  }
  if (relation) {
    try {
      const verified = await verifyCurrentImage(plan, relation, false);
      const acceptedKey = acceptedImageReuse.get(target);
      bump('images', 'reused');
      bump('relations', 'reused');
      let usages = null;
      try {
        usages = await getUsages(plan, relation.imageKey);
      } catch (error) {
        failure('image-usages-read', target, error, { imageKey: relation.imageKey });
      }
      operation({ stage: 'images', target, action: 'reuse-relation', result: 'same-content', image: imageSummary(verified.image), imageKeyAcceptedByPageCheck: acceptedKey ? relation.imageKey === acceptedKey : false, usages });
    } catch (error) {
      bump('images', 'conflict');
      bump('relations', 'conflict');
      failure('image-conflict', target, error, { relation: imageSummary(relation) });
    }
    return;
  }
  let preparedImage;
  try {
    const preparedPath = relativeBatchPath(plan.preparedFile);
    preparedImage = fs.readFileSync(preparedPath);
  } catch (error) {
    bump('images', 'failed');
    bump('relations', 'failed');
    failure('image-local-read', target, error);
    return;
  }
  let imageKey = plan.proposedImageKey;
  let imageExists = false;
  try {
    const current = await getMaybe(imageRoute(imageKey));
    imageExists = current.exists;
    if (current.exists) {
      const check = verifyImage(current.data, plan, { requireProposedName: true });
      if (!check.ok) throw new Error(`拟用图片键已有异值：${check.reason}`);
      operation({ stage: 'images', target, action: 'reuse-image', result: 'same-value-no-relation', image: imageSummary(current.data) });
    }
  } catch (error) {
    bump('images', 'conflict');
    bump('relations', 'conflict');
    failure('image-preflight', target, error, { imageKey });
    return;
  }
  if (!imageExists) {
    if (!apply) {
      bump('images', 'planned');
      bump('relations', 'planned');
      operation({ stage: 'images', target, action: 'create-image-and-relation', result: 'planned-read-only', imageKey, imageName: plan.proposedImageName, preparedSha256: plan.preparedSha256, byteSize: plan.byteSize, width: plan.width, height: plan.height });
      return;
    }
    const imageBase64 = `data:image/png;base64,${preparedImage.toString('base64')}`;
    let postError = null;
    let postStatus = null;
    try {
      const response = await request('POST', '/images', { imageKey, name: plan.proposedImageName, description: null, imageBase64 });
      postStatus = response.status;
    } catch (error) {
      postError = error;
    }
    let confirmed;
    try {
      confirmed = await getMaybe(imageRoute(imageKey));
    } catch (error) {
      bump('images', 'failed');
      failure('image-create-confirm', target, error, { imageKey, postStatus, postError: postError ? describeError(postError) : null });
      return;
    }
    if (!confirmed.exists) {
      bump('images', 'failed');
      failure('image-create', target, postError || new Error('图片创建后逐项 GET 仍为404，未重发。'), { imageKey, postStatus, postError: postError ? describeError(postError) : null });
      return;
    }
    const imageCheck = verifyImage(confirmed.data, plan, { requireProposedName: true });
    if (!imageCheck.ok) {
      bump('images', 'conflict');
      failure('image-create-mismatch', target, new Error(imageCheck.reason), { imageKey, postStatus, postError: postError ? describeError(postError) : null, image: imageSummary(confirmed.data) });
      return;
    }
    bump('images', 'created');
    operation({ stage: 'images', target, action: 'create-image', result: postError ? 'confirmed-after-error' : 'created-and-confirmed', imageKey, postStatus, postError: postError ? describeError(postError) : null, image: imageSummary(confirmed.data) });
  }
  let relationBefore;
  try {
    const response = await request('GET', relationRoute(plan.kind, plan.targetKey));
    relationBefore = relationImage(response.data);
  } catch (error) {
    bump('relations', 'failed');
    failure('relation-recheck', target, error, { imageKey });
    return;
  }
  if (relationBefore) {
    try {
      const verified = await verifyCurrentImage(plan, relationBefore, false);
      bump('images', 'reused');
      bump('relations', 'reused');
      operation({ stage: 'images', target, action: 'reuse-relation-after-race', result: 'same-content', image: imageSummary(verified.image) });
    } catch (error) {
      bump('images', 'conflict');
      bump('relations', 'conflict');
      failure('relation-race-conflict', target, error, { relation: imageSummary(relationBefore) });
    }
    return;
  }
  if (!apply) {
    bump('relations', 'planned');
    operation({ stage: 'images', target, action: 'set-relation', result: 'planned-read-only', imageKey });
    return;
  }
  let putError = null;
  let putStatus = null;
  try {
    const response = await request('PUT', relationRoute(plan.kind, plan.targetKey), { imageKey });
    putStatus = response.status;
  } catch (error) {
    putError = error;
  }
  let relationConfirmed = null;
  try {
    const response = await request('GET', relationRoute(plan.kind, plan.targetKey));
    relationConfirmed = relationImage(response.data);
  } catch (error) {
    bump('relations', 'failed');
    failure('relation-write-confirm', target, error, { imageKey, putStatus, putError: putError ? describeError(putError) : null });
    return;
  }
  if (!relationConfirmed || relationConfirmed.imageKey !== imageKey) {
    bump('relations', 'failed');
    failure('relation-write', target, putError || new Error('代表图写入后逐项 GET 未得到期望图片，未重发。'), { imageKey, putStatus, putError: putError ? describeError(putError) : null, confirmed: imageSummary(relationConfirmed) });
    return;
  }
  try {
    const verified = await verifyCurrentImage(plan, relationConfirmed, true);
    let usages = null;
    try {
      usages = await getUsages(plan, imageKey);
    } catch (error) {
      failure('image-usages-read', target, error, { imageKey });
    }
    bump('relations', 'set');
    operation({ stage: 'images', target, action: 'set-relation', result: putError ? 'confirmed-after-error' : 'set-and-confirmed', imageKey, putStatus, putError: putError ? describeError(putError) : null, image: imageSummary(verified.image), usages });
  } catch (error) {
    bump('images', 'failed');
    bump('relations', 'failed');
    failure('relation-image-confirm', target, error, { imageKey, relation: imageSummary(relationConfirmed) });
  }
}

async function main() {
  let staticInfo;
  try {
    staticInfo = staticVerification(candidate, sourceReport, pageSeed);
    report.staticVerification = { status: 'passed', ...staticInfo };
    saveReport();
  } catch (error) {
    report.staticVerification = { status: 'failed', error: describeError(error) };
    failure('static-verification', 'frozen-inputs', error);
    throw error;
  }

  let liveRunes;
  let livePaths;
  try {
    liveRunes = await fetchList('/runes', '符文');
    livePaths = await fetchList('/rune-paths', '布局');
  } catch (error) {
    failure('list-read', 'runes-and-paths', error);
    throw error;
  }
  const candidateRuneKeys = new Set(candidate.runes.map((item) => item.body.runeKey));
  const candidatePathKeys = new Set(candidate.paths.map((item) => item.body.pathKey));
  for (const row of liveRunes) if (typeof row.runeKey === 'string') liveRuneKeys.add(row.runeKey);
  for (const row of livePaths) if (typeof row.pathKey === 'string') livePathKeys.add(row.pathKey);
  report.liveLists = {
    runeCount: liveRunes.length,
    pathCount: livePaths.length,
    runeKeys: liveRunes.map((row) => row.runeKey),
    pathKeys: livePaths.map((row) => row.pathKey)
  };
  report.protectedExisting = {
    runeKeys: [...liveRuneKeys],
    pathKeys: [...livePathKeys],
    extraRuneKeys: [...liveRuneKeys].filter((key) => !candidateRuneKeys.has(key)),
    extraPathKeys: [...livePathKeys].filter((key) => !candidatePathKeys.has(key))
  };
  saveReport();

  for (const item of candidate.runes) await processRune(item);
  for (const item of candidate.paths) await processPath(item);
  for (const plan of candidate.images) await processImage(plan);
  report.final = { completedAt: new Date().toISOString(), mode: report.mode, summary: report.summary, failureCount: report.failures.length };
  saveReport();
  console.log(JSON.stringify({ reportFile, mode: report.mode, static: report.staticVerification.status, liveLists: report.liveLists, summary: report.summary, failures: report.failures.length }, null, 2));
}

main().catch((error) => {
  saveReport();
  console.error(JSON.stringify({ reportFile, mode: report.mode, error: describeError(error), failures: report.failures.length }, null, 2));
  process.exitCode = 1;
});

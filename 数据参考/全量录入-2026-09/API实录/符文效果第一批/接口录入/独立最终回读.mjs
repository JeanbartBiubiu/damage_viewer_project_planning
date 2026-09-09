import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const batchDir = path.resolve(here, '..');
const dataRoot = path.resolve(batchDir, '..', '..');
const candidateFile = path.join(batchDir, '可审查请求.json');
const frozenSourceFile = path.join(batchDir, '冻结来源.json');
const sourceFile = path.join(dataRoot, '装备符文', '客户端提取资料', 'perks-16.17-zh_CN.json');
const candidateSha256 = 'da45fa734c11590f0fbe7ed027ee9aa21c4b1d890b6231e89558dca32c3fe478';
const sourceSha256 = 'be0bb4eedde39f3a8e1dc245f9b4382379d87674c2fdc62b2650b6af4d9f565b';
const gameId = 'lol';
const baseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_VIEWER_LOCAL_BEARER || 'local-entry';
const targetIds = [5007, 5005, 5011, 5010, 5013];

if (process.argv.length !== 2) throw new Error('独立最终回读只允许默认只读模式，不接受写入参数。');
if (!token.trim()) throw new Error('本地管理接口令牌为空，未执行任何接口调用。');

const runId = new Date().toISOString().replace(/[-:.TZ]/g, '');
const reportFile = path.join(here, `独立最终回读-${runId}.json`);

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
  if (error instanceof ApiFailure) return { type: error.name, method: error.method, route: error.route, status: error.status, response: redact(error.data) };
  return { type: error?.name || 'Error', method: error?.method, route: error?.route, message: String(error?.message || error) };
}

const report = {
  schema: '符文效果第一批/接口录入/独立最终回读报告',
  runId,
  mode: 'GET_ONLY',
  gameId,
  baseUrl,
  frozenCandidateSha256: candidateSha256,
  frozenSourceSha256: sourceSha256,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  staticVerification: null,
  requestReads: [],
  saved: [],
  sourceImageUsages: [],
  arithmetic: [],
  experience: {
    apiRead: '已重新读取候选请求对应的技能、参数、效果、初始化规则和符文技能挂载。',
    imageRead: '已读取五个符文代表图、五个技能代表图和来源图用途。',
    browser: '本脚本未操作浏览器；页面体验由主负责人另行验收。',
    runtime: '未运行战斗引擎，不把接口保存证据当作战斗运行证据。'
  },
  failures: [],
  allGets: [],
  summary: null
};

function saveReport() {
  report.updatedAt = new Date().toISOString();
  fs.writeFileSync(reportFile, `${JSON.stringify(redact(report), null, 2)}\n`, 'utf8');
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

function relationCore(item) {
  if (!item || typeof item !== 'object') return null;
  return { runeKey: item.runeKey, skillKey: item.skillKey, sortOrder: item.sortOrder };
}

function expectedCore(request) {
  return requestKind(request) === 'relation' ? relationCore(request.body) : request.body;
}

function actualForRequest(request, data) {
  if (requestKind(request) === 'relation') {
    const items = data && Array.isArray(data.items) ? data.items : [];
    return relationCore(items.find((item) => item.runeKey === request.body.runeKey && item.skillKey === request.body.skillKey));
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const actual = {};
  for (const key of Object.keys(request.body)) actual[key] = data[key];
  return actual;
}

function matchesRequest(request, data) {
  return sameJson(expectedCore(request), actualForRequest(request, data));
}

async function get(route) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
  let response;
  let text;
  try {
    response = await fetch(`${baseUrl}${route}`, { method: 'GET', headers, signal: controller.signal });
    text = await response.text();
  } catch (error) {
    throw new NetworkFailure('GET', route, error);
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
  if (response.status < 200 || response.status >= 300) throw new ApiFailure('GET', route, response.status, data);
  return { status: response.status, data };
}

async function read(route, context) {
  try {
    const response = await get(route);
    const row = { at: new Date().toISOString(), route, context, status: response.status, data: response.data, error: null };
    report.allGets.push(redact(row));
    saveReport();
    return { exists: true, status: response.status, data: response.data, error: null };
  } catch (error) {
    const row = { at: new Date().toISOString(), route, context, status: error?.status ?? null, data: error?.data ?? null, error: describeError(error) };
    report.allGets.push(redact(row));
    saveReport();
    return { exists: false, status: error?.status ?? null, data: error?.data ?? null, error };
  }
}

function snapshot(result) {
  return { exists: result.exists, status: result.status, data: result.data, error: result.error ? describeError(result.error) : null };
}

function imageValue(result) {
  if (!result.exists || !result.data || typeof result.data !== 'object') return null;
  if (result.data.image === null) return null;
  return result.data.image && typeof result.data.image === 'object' ? result.data.image : { invalid: true };
}

function fail(stage, target, message, extra = {}) {
  report.failures.push(redact({ at: new Date().toISOString(), stage, target, message, ...extra }));
  saveReport();
}

function staticVerification(candidate) {
  const actualCandidateSha256 = sha256File(candidateFile);
  const actualSourceSha256 = sha256File(sourceFile);
  if (actualCandidateSha256 !== candidateSha256) throw new Error(`可审查请求.json SHA256 不符：${actualCandidateSha256}`);
  if (actualSourceSha256 !== sourceSha256) throw new Error(`perks-16.17-zh_CN.json SHA256 不符：${actualSourceSha256}`);
  if (!Array.isArray(candidate) || candidate.length !== targetIds.length || !sameJson(candidate.map((item) => item.id), targetIds)) throw new Error('最终回读候选主体集合不符。');
  const frozen = readJson(frozenSourceFile);
  if (frozen.sourceSha256 !== sourceSha256) throw new Error('最终回读冻结来源 SHA256 不符。');
  const sourceIds = new Set((frozen.sources || []).map((item) => item?.raw?.id));
  for (const id of targetIds) if (!sourceIds.has(id)) throw new Error(`最终回读缺少主体 ${id} 的来源记录。`);
  const requestCount = candidate.reduce((sum, item) => sum + (Array.isArray(item.requests) ? item.requests.length : 0), 0);
  if (requestCount !== 22) throw new Error(`最终回读候选请求数不为 22：${requestCount}`);
  return { candidateSha256: actualCandidateSha256, sourceSha256: actualSourceSha256, sourceByteSize: fs.statSync(sourceFile).size, targetIds, requestCount };
}

async function readCandidateRequests(candidate) {
  for (const entry of candidate) {
    for (const [requestIndex, request] of entry.requests.entries()) {
      const route = readRouteFor(request);
      const result = await read(route, { phase: 'final-request-read', id: entry.id, requestIndex, kind: requestKind(request), postRoute: request.path });
      const matches = result.exists && matchesRequest(request, result.data);
      const row = {
        id: entry.id,
        skillKey: skillKeyOf(entry.id),
        requestIndex,
        kind: requestKind(request),
        postRoute: request.path,
        readRoute: route,
        expected: expectedCore(request),
        actual: result.exists ? actualForRequest(request, result.data) : null,
        matches,
        response: snapshot(result)
      };
      report.requestReads.push(redact(row));
      if (!result.exists || !matches) fail('final-request-mismatch', `${entry.id}/${requestIndex + 1}`, '最终 GET 未得到候选完整字段。', row);
      saveReport();
    }
  }
}

async function readSavedObject(entry) {
  const id = entry.id;
  const skillKey = skillKeyOf(id);
  const runeKey = runeKeyOf(id);
  const skill = await read(skillRoute(skillKey), { phase: 'saved-skill', id });
  const parameters = await read(parametersRoute(skillKey), { phase: 'saved-array', id, kind: 'parameters' });
  const effects = await read(effectsRoute(skillKey), { phase: 'saved-array', id, kind: 'effects' });
  const triggerRules = await read(triggerRulesRoute(skillKey), { phase: 'saved-array', id, kind: 'trigger-rules' });
  const relation = await read(relationListRoute(runeKey), { phase: 'saved-array', id, kind: 'relation' });
  const parameterRequests = entry.requests.filter((request) => requestKind(request) === 'parameter');
  const effectRequests = entry.requests.filter((request) => requestKind(request) === 'effect');
  const ruleRequests = entry.requests.filter((request) => requestKind(request) === 'trigger-rule');
  const parameterDetails = [];
  for (const request of parameterRequests) parameterDetails.push({ parameterKey: request.body.parameterKey, response: snapshot(await read(readRouteFor(request), { phase: 'saved-detail', id, kind: 'parameter', parameterKey: request.body.parameterKey })) });
  const effectDetails = [];
  for (const request of effectRequests) effectDetails.push({ effectKey: request.body.effectKey, response: snapshot(await read(readRouteFor(request), { phase: 'saved-detail', id, kind: 'effect', effectKey: request.body.effectKey })) });
  const ruleDetails = [];
  for (const request of ruleRequests) ruleDetails.push({ ruleKey: request.body.ruleKey, response: snapshot(await read(readRouteFor(request), { phase: 'saved-detail', id, kind: 'trigger-rule', ruleKey: request.body.ruleKey })) });
  const sourceImage = await read(runeRepresentativeRoute(runeKey), { phase: 'source-image', id });
  const skillImage = await read(skillRepresentativeRoute(skillKey), { phase: 'skill-image', id });
  const sourceImageValue = imageValue(sourceImage);
  const usages = sourceImageValue?.imageKey ? await read(`/images/${encode(sourceImageValue.imageKey)}/usages`, { phase: 'source-image-usages', id, imageKey: sourceImageValue.imageKey }) : { exists: false, status: null, data: null, error: null };
  if (!skill.exists || !parameters.exists || !effects.exists || !triggerRules.exists || !relation.exists) fail('saved-array-read', skillKey, '最终保存数组或技能详情读取失败。', { skill: snapshot(skill), parameters: snapshot(parameters), effects: snapshot(effects), triggerRules: snapshot(triggerRules), relation: snapshot(relation) });
  report.saved.push(redact({
    id,
    skillKey,
    runeKey,
    skill: snapshot(skill),
    arrays: { parameters: snapshot(parameters), effects: snapshot(effects), triggerRules: snapshot(triggerRules), relation: snapshot(relation) },
    completeFields: { parameters: parameterDetails, effects: effectDetails, triggerRules: ruleDetails },
    representativeImages: { sourceRune: snapshot(sourceImage), skill: snapshot(skillImage) },
    sourceImageUsage: snapshot(usages)
  }));
  if (!sourceImageValue?.imageKey) fail('source-image-read', skillKey, '对应符文没有可供复核的代表图。', { source: snapshot(sourceImage) });
  else report.sourceImageUsages.push(redact({ id, runeKey, imageKey: sourceImageValue.imageKey, usage: snapshot(usages) }));
  saveReport();
}

function savedData(id) {
  return report.saved.find((item) => item.id === id);
}

function detailData(saved, collection, key) {
  const rows = saved?.completeFields?.[collection];
  const row = Array.isArray(rows) ? rows.find((item) => item[collection === 'parameters' ? 'parameterKey' : collection === 'effects' ? 'effectKey' : 'ruleKey'] === key) : null;
  return row?.response?.data || null;
}

function parameterValue(saved, key) {
  return detailData(saved, 'parameters', key)?.fixedValue;
}

function effectCount(saved, collection) {
  const data = saved?.arrays?.[collection]?.data;
  return Array.isArray(data) ? data.length : null;
}

function arithmeticCheck(id, sample, independent, expected, actual, unit, passed) {
  report.arithmetic.push({ id, sample, independent, expected, actual, unit, passed });
}

function buildArithmetic() {
  const s5007 = savedData(5007);
  const s5005 = savedData(5005);
  const s5011 = savedData(5011);
  const s5010 = savedData(5010);
  const s5013 = savedData(5013);
  const v5007 = parameterValue(s5007, 'ability_haste_bonus');
  const v5005 = parameterValue(s5005, 'bonus_attack_speed_ratio');
  const v5011 = parameterValue(s5011, 'health_bonus');
  const v5010 = parameterValue(s5010, 'move_speed_ratio');
  const vTenacity = parameterValue(s5013, 'tenacity_ratio');
  const vSlowResist = parameterValue(s5013, 'slow_resist_ratio');
  arithmeticCheck(5007, '已有技能急速20', '20 + 实际保存技能急速参数', 28, typeof v5007 === 'number' ? 20 + v5007 : null, '点', typeof v5007 === 'number' && Math.abs(28 - (20 + v5007)) < 1e-12);
  arithmeticCheck(5005, '已有额外攻速比例0.35', '0.35 + 实际保存攻击速度参数', 0.45, typeof v5005 === 'number' ? 0.35 + v5005 : null, '额外攻速比例', typeof v5005 === 'number' && Math.abs(0.45 - (0.35 + v5005)) < 1e-12);
  arithmeticCheck(5005, '单位核对', '10 / 100', 0.1, v5005, '比例', v5005 === 0.1);
  arithmeticCheck(5011, '已有生命值属性1000', '1000 + 实际保存生命值参数', 1065, typeof v5011 === 'number' ? 1000 + v5011 : null, '点', typeof v5011 === 'number' && Math.abs(1065 - (1000 + v5011)) < 1e-12);
  arithmeticCheck(5010, '单位核对，不推断与装备组合', '2.5 / 100', 0.025, v5010, '比例', v5010 === 0.025);
  arithmeticCheck(5013, '两个独立比例，不合成30%', '[实际保存韧性参数, 实际保存减速抗性参数]', [0.15, 0.15], [vTenacity, vSlowResist], '依次韧性和减速抗性比例', vTenacity === 0.15 && vSlowResist === 0.15);
  const count5013 = effectCount(s5013, 'effects');
  arithmeticCheck(5013, '阻止错误跨来源加算效果', '实际保存效果数组长度', 0, count5013, '个', count5013 === 0);
  const count5010 = effectCount(s5010, 'effects');
  arithmeticCheck(5010, '未证实移速分组前不生成属性效果', '实际保存效果数组长度', 0, count5010, '个', count5010 === 0);
}

function summarize() {
  const completeFields = report.saved.reduce((sum, item) => sum + Object.values(item.completeFields || {}).reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0), 0);
  const savedCounts = report.saved.map((item) => ({ id: item.id, parameters: Array.isArray(item.arrays.parameters.data) ? item.arrays.parameters.data.length : null, effects: Array.isArray(item.arrays.effects.data) ? item.arrays.effects.data.length : null, triggerRules: Array.isArray(item.arrays.triggerRules.data) ? item.arrays.triggerRules.data.length : null, relations: item.arrays.relation.data?.total ?? null, sourceImageKey: imageValue(item.representativeImages.sourceRune)?.imageKey ?? null, skillImageKey: imageValue(item.representativeImages.skill)?.imageKey ?? null }));
  report.summary = {
    candidateRequests: 22,
    requestReads: report.requestReads.length,
    matchingRequestReads: report.requestReads.filter((item) => item.matches === true).length,
    savedObjects: report.saved.length,
    completeFieldObjects: completeFields,
    sourceImageUsages: report.sourceImageUsages.length,
    arithmeticChecks: report.arithmetic.length,
    arithmeticPassed: report.arithmetic.filter((item) => item.passed === true).length,
    failures: report.failures.length,
    savedCounts,
    boundary: '接口字段与来源图用途回读证据，不代表浏览器缓存同步或战斗运行通过。'
  };
}

async function main() {
  const candidate = readJson(candidateFile);
  report.staticVerification = staticVerification(candidate);
  saveReport();
  await readCandidateRequests(candidate);
  for (const entry of candidate) await readSavedObject(entry);
  buildArithmetic();
  summarize();
  report.completedAt = new Date().toISOString();
  saveReport();
  console.log(JSON.stringify({ reportFile, summary: report.summary, failures: report.failures.length }, null, 2));
  if (report.failures.length > 0 || report.summary.matchingRequestReads !== 22 || report.summary.arithmeticPassed !== 8) process.exitCode = 2;
}

main().catch((error) => {
  report.fatal = describeError(error);
  saveReport();
  console.error(JSON.stringify({ reportFile, error: describeError(error) }, null, 2));
  process.exitCode = 1;
});

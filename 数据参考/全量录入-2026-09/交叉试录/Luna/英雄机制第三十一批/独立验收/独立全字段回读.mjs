import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactRoot = path.resolve(here, '..');
const candidateDir = path.join(artifactRoot, 'hero31-luna-candidate', '修订三');
const inputDir = path.join(artifactRoot, 'hero31-root-entry-20260909');
const candidatePath = path.join(candidateDir, '完整候选.json');
const planPath = path.join(candidateDir, '请求计划.json');
const writerPath = path.join(candidateDir, '单位修复执行.mjs');
const unitFixPlanPath = path.join(candidateDir, '单位修复方案.json');
const lockPath = path.join(candidateDir, '实际写入锁.json');
const revision2Dir = path.join(artifactRoot, 'hero31-luna-candidate', '修订二');
const revision2CandidatePath = path.join(revision2Dir, '完整候选.json');
const revision2PlanPath = path.join(revision2Dir, '请求计划.json');
const revision2WriterPath = path.join(revision2Dir, '受保护写入器.mjs');
const revision2LockPath = path.join(revision2Dir, '实际写入锁.json');
const inputVersionPath = path.join(inputDir, '输入版本.json');
const sourceBindingPath = path.join(inputDir, '来源绑定与当前文本.json');
const protectionPath = path.join(inputDir, '参考资料', '当前20槽保护快照.json');
const reusePath = path.join(inputDir, '参考资料', '公共参数复用清单.json');
const sourceRangePath = path.join(inputDir, '来源与范围.json');
const semanticNotePath = path.join(inputDir, '候选前关键语义核对.md');
const oldFailurePath = path.join(
  artifactRoot,
  'hero31-luna-candidate',
  '修订一',
  '实际写入',
  '2026-09-09T17-41-43-780Z',
  '执行结果.json',
);

const frozen = Object.freeze({
  candidate: 'bf26b9374fc305af52e7298934a54244aec5bec0166017ae5a99a38a2019ddcc',
  plan: '67d053b4f95435ad515d01e245175081a6bbd5eb4be8f8ca29e0bdae07f4bcc1',
  writer: 'e22f1a7d93e40d000f86e973df7b992e44a070b8f69dc3db7ba1434fae1bae0d',
  unitFixPlan: 'b8c002b2d25a33ef710d881c43e05b6b79db501bf3925aaf3312066684889d5f',
  revision2Candidate: 'fed901ff7819c5a2bd1e5238936c7cf1a6916af8116be2bc776e9ade93d256c0',
  revision2Plan: '440501e0016adb35d584bf73d22eb7a7d9c21f936e86942bb891199409199b90',
  revision2Writer: '3133f1f3b28bd5893ef9dcce337b769cbbcb61c7894cdb3e6614d9f106f49d51',
  inputVersion: '859eced8efea73b88a725224f34a064846c639e713681a832e40dacff1cc817a',
  sourceBinding: '3903525c50256f6c7df36e692f9648d13a073bffe105e280fd80653c99302330',
  protection: '94af4474ea98f040a3ad09aeffc07a8608cde19a10ce3c2995499aba2883802c',
  reuse: '4813020e549a0b22e80eb2a466a6262892d3f4531c8599af2185d670fbfe914c',
  sourceRange: '27f83bd55ed75570921c2482b03a60e336a6df442531fb60bad149557d2c6d47',
  semanticNote: '9dc832573a1dcf854e92ea4ca818a576ff206702c0f08ebc1afe509a3161b55e',
  oldFailure: '21c33d3336432fd8eee58a29ef9762b4a358da66778c8d7b2fe6e36d13f882b0',
});

if (process.argv.length !== 3 || process.argv[2] !== '--after-apply') {
  throw new Error('用法：node 独立全字段回读.mjs --after-apply');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(file, value, flag) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, flag ? { flag } : undefined);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['gameId', 'skillKey', 'createdAt', 'updatedAt'].includes(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, strip(child)]),
    );
  }
  return value;
}

function firstDiff(expected, actual, at = '$') {
  if (equal(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    return { at, expected, actual };
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      return { at, expected, actual };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDiff(expected[index], actual[index], `${at}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const key of keys) {
    if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) {
      return { at: `${at}.${key}`, expectedPresent: Object.hasOwn(expected, key), actualPresent: Object.hasOwn(actual, key) };
    }
    const difference = firstDiff(expected[key], actual[key], `${at}.${key}`);
    if (difference) return difference;
  }
  return null;
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.data)) return value.data;
  return null;
}

function listProjectedDiff(expected, actual, idField) {
  if (!actual || actual[idField] !== expected[idField]) {
    return { at: `.${idField}`, expected: expected[idField], actual: actual?.[idField] };
  }
  for (const field of Object.keys(expected)) {
    if (!Object.hasOwn(actual, field)) continue;
    const difference = firstDiff(strip(expected[field]), strip(actual[field]), `.${field}`);
    if (difference) return difference;
  }
  return null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRoute(route) {
  assert(
    typeof route === 'string'
      && route.startsWith('/')
      && !route.includes('://')
      && !route.includes('..')
      && !route.includes('#'),
    `不安全接口路径：${route}`,
  );
}

const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const unitFixPlan = readJson(unitFixPlanPath);
const inputVersion = readJson(inputVersionPath);
const sourceBinding = readJson(sourceBindingPath);
const protection = readJson(protectionPath);
const reuseList = readJson(reusePath);
const sourceRange = readJson(sourceRangePath);
const semanticNote = fs.readFileSync(semanticNotePath, 'utf8');
const oldFailure = readJson(oldFailurePath);
const lockedWrite = readJson(lockPath);
const revision2Candidate = readJson(revision2CandidatePath);
const revision2Plan = readJson(revision2PlanPath);
const revision2LockedWrite = readJson(revision2LockPath);

const hashFiles = [
  ['candidate', candidatePath, frozen.candidate],
  ['plan', planPath, frozen.plan],
  ['writer', writerPath, frozen.writer],
  ['unitFixPlan', unitFixPlanPath, frozen.unitFixPlan],
  ['revision2Candidate', revision2CandidatePath, frozen.revision2Candidate],
  ['revision2Plan', revision2PlanPath, frozen.revision2Plan],
  ['revision2Writer', revision2WriterPath, frozen.revision2Writer],
  ['inputVersion', inputVersionPath, frozen.inputVersion],
  ['sourceBinding', sourceBindingPath, frozen.sourceBinding],
  ['protection', protectionPath, frozen.protection],
  ['reuse', reusePath, frozen.reuse],
  ['sourceRange', sourceRangePath, frozen.sourceRange],
  ['semanticNote', semanticNotePath, frozen.semanticNote],
  ['oldFailure', oldFailurePath, frozen.oldFailure],
];
for (const [label, file, expected] of hashFiles) {
  assert(fs.existsSync(file), `冻结文件不存在：${label}`);
  assert(sha256File(file) === expected, `冻结文件散列变化：${label}`);
}

assert(candidate.meta?.batch === '英雄机制第三十一批', '候选批次不符');
assert(candidate.meta?.sourceVersion?.clientVersion === '16.17', '候选客户端版本不符');
assert(candidate.meta?.sourceVersion?.officialVersion === '16.17.1', '候选官方版本不符');
assert(candidate.meta?.apiCalls === 0 && candidate.meta?.businessWrites === 0 && candidate.apiWrites === 0, '候选含业务写入记录');
assert(candidate.counts?.skills === 20, '候选技能数量不符');
assert(candidate.counts?.parameters === 120 && candidate.counts?.formulas === 35 && candidate.counts?.effects === 23, '候选组成计数不符');
assert(candidate.counts?.processes === 0 && candidate.counts?.internalStates === 0 && candidate.counts?.triggerRules === 0, '候选含非本批组成');
assert(plan.noApiCalls === true && plan.apiWrites === 0, '写前计划不是零写入计划');
assert(plan.requestCount === 178 && Array.isArray(plan.requests) && plan.requests.length === 178, '写前计划应为178项');
assert(inputVersion.apiWrites === 0 && inputVersion.businessWrites === 0 && inputVersion.GETs === 201, '输入包保护计数不符');
assert(sourceBinding.clientVersion === '16.17' && sourceBinding.officialVersion === '16.17.1', '来源绑定版本不符');
assert(sourceRange.batch === '第三十一批迦娜璐璐娜美莫甘娜', '来源范围批次不符');
assert(semanticNote.length > 0, '语义核对文件为空');

for (const sourceFile of inputVersion.sourceFiles ?? []) {
  const file = path.join(inputDir, sourceFile.path);
  assert(!path.relative(inputDir, file).startsWith('..'), `来源文件越界：${sourceFile.path}`);
  assert(fs.existsSync(file) && sha256File(file) === sourceFile.sha256, `来源文件散列变化：${sourceFile.path}`);
}

assert(revision2LockedWrite.status === 'COMPLETED', `修订二大批写入尚未完成：${JSON.stringify(revision2LockedWrite)}`);
assert(revision2LockedWrite.apiWrites === 98 && revision2LockedWrite.confirmed === 98, `修订二应确认98项POST：${JSON.stringify(revision2LockedWrite)}`);
assert(revision2LockedWrite.reportPath && fs.existsSync(revision2LockedWrite.reportPath), '修订二大批执行结果不存在');
const revision2WriteResult = readJson(revision2LockedWrite.reportPath);
assert(
  revision2WriteResult.success === true
    && revision2WriteResult.apiWrites === 98
    && revision2WriteResult.confirmed === 98
    && revision2WriteResult.counts?.POST === 98,
  '修订二大批执行结果未确认98项POST成功',
);
assert(unitFixPlan.apiWrites === 0 && Array.isArray(unitFixPlan.actions) && unitFixPlan.actions.length === 2, '修订三单位替换计划不符');
assert(unitFixPlan.before?.parameterKey === 'slow_percent_points', '修订三旧参数键不符');
assert(unitFixPlan.after?.parameterKey === 'polymorph_slow_amount', '修订三新参数键不符');
assert(unitFixPlan.actions[0]?.method === 'POST' && unitFixPlan.actions[1]?.method === 'DELETE', '修订三应为一新增和一删除');
assert(lockedWrite.status === 'COMPLETED', `修订三单位替换尚未完成：${JSON.stringify(lockedWrite)}`);
assert(lockedWrite.post201 === 1 && lockedWrite.delete204 === 1, `修订三应确认1项POST和1项DELETE：${JSON.stringify(lockedWrite)}`);
assert(lockedWrite.reportPath && fs.existsSync(lockedWrite.reportPath), '修订三单位替换结果不存在');
const unitFixResult = readJson(lockedWrite.reportPath);
assert(
  unitFixResult.success === true
    && unitFixResult.post201 === 1
    && unitFixResult.delete204 === 1,
  '修订三单位替换结果未确认成功',
);

const skills = candidate.order;
assert(Array.isArray(skills) && skills.length === 20 && new Set(skills).size === 20, '候选技能顺序不符');
const kinds = [
  { kind: 'parameters', api: 'parameters', id: 'parameterKey' },
  { kind: 'formulas', api: 'formulas', id: 'formulaKey' },
  { kind: 'effects', api: 'effects', id: 'effectKey' },
  { kind: 'processes', api: 'processes', id: 'processKey' },
  { kind: 'internalStates', api: 'internal-states', id: 'stateKey' },
  { kind: 'triggerRules', api: 'trigger-rules', id: 'ruleKey' },
];
const kindByName = new Map(kinds.map(item => [item.kind, item]));
const collectionRoutes = new Map();
for (const skillKey of skills) {
  for (const item of kinds) {
    collectionRoutes.set(`/skills/${skillKey}/${item.api}`, { skillKey, ...item });
  }
}

const candidateBodyByDetail = new Map();
for (const skillKey of skills) {
  const write = candidate.skills?.[skillKey]?.write;
  assert(write, `候选缺少技能写入结构：${skillKey}`);
  for (const item of kinds) {
    const entries = write[item.kind] ?? [];
    for (const body of entries) {
      const stableKey = body?.[item.id];
      assert(typeof stableKey === 'string' && stableKey.length > 0, `候选稳定键无效：${skillKey}/${item.kind}`);
      const route = `/skills/${skillKey}/${item.api}`;
      const detailRoute = `${route}/${encodeURIComponent(stableKey)}`;
      assert(!candidateBodyByDetail.has(detailRoute), `候选详情重复：${detailRoute}`);
      candidateBodyByDetail.set(detailRoute, { skillKey, kind: item.kind, api: item.api, id: item.id, stableKey, route, detailRoute, candidateBody: body, reused: false });
    }
  }
}
assert(candidateBodyByDetail.size === 178, `候选新详情应为178项，实际${candidateBodyByDetail.size}`);

const plannedDetails = [];
const plannedByDetail = new Map();
const plannedListIntents = new Map();
const normalizedPlanDetailRoutes = [];
for (const intent of plan.requests) {
  const item = kindByName.get(intent.kind);
  assert(item, `计划组成类型无效：${intent.kind}`);
  const expectedRoute = `/skills/${intent.skillKey}/${item.api}`;
  const expectedDetailRoute = `${expectedRoute}/${encodeURIComponent(intent.stableKey)}`;
  assert(intent.method === 'POST' && intent.route === expectedRoute, `计划接口无效：${intent.sequence}`);
  const isUnitReplacement = intent.skillKey === 'lulu_w'
    && intent.kind === 'parameters'
    && intent.stableKey === 'polymorph_slow_amount'
    && intent.detailRoute === '/skills/lulu_w/parameters/slow_percent_points';
  assert(intent.detailRoute === expectedDetailRoute || isUnitReplacement, `计划详情路径无效：${intent.sequence}`);
  assert(intent.body?.[item.id] === intent.stableKey, `计划稳定键不符：${intent.sequence}`);
  assert(!plannedByDetail.has(expectedDetailRoute), `计划详情重复：${expectedDetailRoute}`);
  const candidateEntry = candidateBodyByDetail.get(expectedDetailRoute);
  assert(candidateEntry && equal(candidateEntry.candidateBody, intent.body), `计划与候选不一致：${expectedDetailRoute}`);
  const entry = {
    skillKey: intent.skillKey,
    kind: intent.kind,
    api: item.api,
    id: item.id,
    stableKey: intent.stableKey,
    route: intent.route,
    detailRoute: expectedDetailRoute,
    planDetailRoute: intent.detailRoute,
    candidateBody: intent.body,
    reused: false,
    sequence: intent.sequence,
  };
  plannedDetails.push(entry);
  plannedByDetail.set(entry.detailRoute, entry);
  if (isUnitReplacement) normalizedPlanDetailRoutes.push({ sequence: intent.sequence, from: intent.detailRoute, to: expectedDetailRoute });
  if (!plannedListIntents.has(entry.route)) plannedListIntents.set(entry.route, []);
  plannedListIntents.get(entry.route).push(intent);
}
assert(plannedDetails.length === 178 && plannedByDetail.size === 178, '计划新增详情不是178项');
assert(normalizedPlanDetailRoutes.length === 1, '修订三计划应只有一项单位替换详情路径需归一');

const oldPostCalls = oldFailure.calls?.filter(call => call.method === 'POST') ?? [];
const oldSuccessfulPosts = oldPostCalls.filter(call => call.status === 201);
const oldRejectedPosts = oldPostCalls.filter(call => call.status === 400);
assert(oldFailure.success === false && oldFailure.apiWrites === 80 && oldFailure.confirmed === 80, '修订一失败证据计数不符');
assert(oldPostCalls.length === 81 && oldSuccessfulPosts.length === 80 && oldRejectedPosts.length === 1, '修订一应为80成功、1拒绝');
const previousSaved = new Set();
for (const call of oldSuccessfulPosts) {
  const item = kinds.find(value => value.api === call.route.split('/').at(-1));
  assert(item && /^\/skills\/[^/]+\/[^/]+$/.test(call.route), `修订一成功请求路径无效：${call.route}`);
  const stableKey = call.body?.[item.id] ?? call.data?.[item.id];
  assert(typeof stableKey === 'string', `修订一成功请求缺少稳定键：${call.route}`);
  previousSaved.add(`${call.route}/${encodeURIComponent(stableKey)}`);
}
assert(previousSaved.size === 80, '修订一成功详情去重后不是80项');
assert(previousSaved.has('/skills/lulu_w/parameters/slow_percent_points'), '修订一成功项应包含待替换的璐璐W旧参数');
assert(Array.isArray(revision2Plan.requests) && revision2Plan.requestCount === 178 && revision2Plan.requests.length === 178, '修订二历史计划应为178项');
const revision2PlanRoutes = new Set(revision2Plan.requests.map(intent => `${intent.route}/${encodeURIComponent(intent.stableKey)}`));
assert(revision2PlanRoutes.size === 178, '修订二历史计划详情重复');
for (const detailRoute of previousSaved) assert(revision2PlanRoutes.has(detailRoute), `修订一成功项不在修订二计划：${detailRoute}`);
const legacyReplacementOldRoute = '/skills/lulu_w/parameters/slow_percent_points';
const legacyReplacementNewRoute = '/skills/lulu_w/parameters/polymorph_slow_amount';
const previousSavedInFinal = new Set([...previousSaved].map(route => route === legacyReplacementOldRoute ? legacyReplacementNewRoute : route));
assert(previousSavedInFinal.size === 80 && previousSavedInFinal.has(legacyReplacementNewRoute), '修订一历史项映射到修订三后应保留80项');
for (const detailRoute of previousSavedInFinal) assert(plannedByDetail.has(detailRoute), `修订一成功项映射后不在修订三计划：${detailRoute}`);
const revision2Remaining = [...revision2PlanRoutes].filter(route => !previousSaved.has(route));
assert(revision2Remaining.length === 98, `修订二剩余详情应为98项，实际${revision2Remaining.length}`);
const finalRemaining = plannedDetails.filter(entry => !previousSavedInFinal.has(entry.detailRoute));
assert(finalRemaining.length === 98, `修订二对应最终剩余详情应为98项，实际${finalRemaining.length}`);

assert(Array.isArray(protection.requests) && protection.requests.length === 201 && protection.GETs === 201, '保护快照应为201条GET');
assert(protection.requests.every(request => request.status === 200), '保护快照存在非200请求');
const baselineByRoute = new Map();
for (const request of protection.requests) {
  assert(typeof request.route === 'string' && !baselineByRoute.has(request.route), `保护快照路由重复：${request.route}`);
  baselineByRoute.set(request.route, request);
}
const protectedLists = protection.requests.filter(request => collectionRoutes.has(request.route));
assert(protectedLists.length === 120, `保护组成列表应为120条，实际${protectedLists.length}`);

const reusedDetails = [];
for (const item of reuseList) {
  const detailRoute = `/skills/${item.skillKey}/parameters/${encodeURIComponent(item.parameterKey)}`;
  const baseline = baselineByRoute.get(detailRoute);
  assert(baseline?.status === 200, `复用详情不在保护快照：${detailRoute}`);
  assert(!plannedByDetail.has(detailRoute), `复用详情与新增详情重叠：${detailRoute}`);
  reusedDetails.push({
    skillKey: item.skillKey,
    kind: 'parameters',
    api: 'parameters',
    id: 'parameterKey',
    stableKey: item.parameterKey,
    route: `/skills/${item.skillKey}/parameters`,
    detailRoute,
    candidateBody: baseline.data,
    reused: true,
  });
}
assert(reusedDetails.length === 29 && new Set(reusedDetails.map(entry => entry.detailRoute)).size === 29, '复用详情应为29项');

const allDetails = [...reusedDetails, ...plannedDetails];
assert(allDetails.length === 207 && new Set(allDetails.map(entry => entry.detailRoute)).size === 207, '最终详情应为207项');
const freshRoutes = [...new Set([
  ...protection.requests.map(request => request.route),
  ...plannedDetails.map(entry => entry.detailRoute),
])];
assert(freshRoutes.length === 379, `独立唯一GET应为379条，实际${freshRoutes.length}`);

const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const runDir = path.join(here, '实际回读', runId);
fs.mkdirSync(runDir, { recursive: true });
const journalPath = path.join(runDir, '所有GET原始响应.jsonl');
const calls = [];
let sequence = 0;

function appendJournal(value) {
  const descriptor = fs.openSync(journalPath, 'a');
  try {
    fs.writeSync(descriptor, `${JSON.stringify(value)}\n`, undefined, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

async function get(route) {
  safeRoute(route);
  const seq = ++sequence;
  appendJournal({ phase: 'BEFORE', seq, method: 'GET', route, at: new Date().toISOString() });
  let result;
  try {
    const response = await fetch(`http://127.0.0.1:8080/api/admin/games/lol${route}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.HERO31_API_TOKEN || 'local-entry'}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    });
    const bodyText = await response.text();
    let data = null;
    let parseError = null;
    if (bodyText.length > 0) {
      try {
        data = JSON.parse(bodyText);
      } catch (error) {
        parseError = String(error.message || error);
      }
    }
    result = {
      seq,
      method: 'GET',
      route,
      status: response.status,
      data,
      ...(parseError ? { parseError, bodyText } : {}),
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    result = {
      seq,
      method: 'GET',
      route,
      status: null,
      data: null,
      error: String(error.message || error),
      finishedAt: new Date().toISOString(),
    };
  }
  appendJournal({ phase: 'AFTER', ...result });
  calls.push(result);
  if (result.status === null || result.parseError) throw new Error(`GET失败，停止回读：${route}，${result.error || result.parseError}`);
  if (result.status !== 200) throw new Error(`GET状态异常，停止回读：${route}，状态=${result.status}`);
  return result;
}

function category(route) {
  if (['/attributes', '/skill-categories', '/modifier-zones', '/damage-types'].includes(route)) return '目录';
  if (route.startsWith('/characters/')) return '角色';
  if (route.startsWith('/character-skill-relations?')) return '关系';
  if (route.includes('/representative-image')) return '图片';
  if (/^\/skills\/[^/]+$/.test(route)) return '主体';
  if (collectionRoutes.has(route)) return '六类列表';
  if (reusedDetails.some(entry => entry.detailRoute === route)) return '复用详情';
  return '新增详情';
}

function checkProtection(resultByRoute) {
  const records = [];
  const failures = [];
  const counts = {
    catalogs: 0,
    characters: 0,
    relations: 0,
    subjects: 0,
    images: 0,
    componentLists: 0,
    reusedDetails: 0,
  };
  for (const expected of protection.requests) {
    const actual = resultByRoute.get(expected.route);
    const record = {
      route: expected.route,
      category: category(expected.route),
      expectedStatus: expected.status,
      actualStatus: actual?.status ?? null,
      passed: false,
    };
    if (!actual || actual.status !== expected.status) {
      record.reason = '状态码变化';
      failures.push(record);
      records.push(record);
      continue;
    }
    if (record.category === '目录') counts.catalogs += 1;
    else if (record.category === '角色') counts.characters += 1;
    else if (record.category === '关系') counts.relations += 1;
    else if (record.category === '主体') counts.subjects += 1;
    else if (record.category === '图片') counts.images += 1;
    else if (record.category === '复用详情') counts.reusedDetails += 1;
    const collection = collectionRoutes.get(expected.route);
    if (!collection) {
      record.diff = firstDiff(strip(expected.data), strip(actual.data));
      record.passed = !record.diff;
    } else {
      counts.componentLists += 1;
      const oldRows = rows(expected.data);
      const actualRows = rows(actual.data);
      const planned = plannedListIntents.get(expected.route) ?? [];
      const oldKeys = oldRows?.map(row => row?.[collection.id]) ?? [];
      const actualKeys = actualRows?.map(row => row?.[collection.id]) ?? [];
      const allowed = new Set([...oldKeys, ...planned.map(intent => intent.stableKey)]);
      const oldDifferences = [];
      for (const oldRow of oldRows ?? []) {
        const current = actualRows?.find(row => row?.[collection.id] === oldRow[collection.id]);
        const diff = listProjectedDiff(oldRow, current, collection.id);
        if (diff) oldDifferences.push({ stableKey: oldRow[collection.id], diff });
      }
      const plannedDifferences = [];
      for (const intent of planned) {
        const current = actualRows?.find(row => row?.[collection.id] === intent.stableKey);
        const diff = listProjectedDiff(intent.body, current, collection.id);
        if (diff) plannedDifferences.push({ stableKey: intent.stableKey, diff });
      }
      record.oldCount = oldRows?.length ?? null;
      record.actualCount = actualRows?.length ?? null;
      record.plannedCount = planned.length;
      record.unexpected = actualKeys.filter(key => !allowed.has(key));
      record.missingOld = oldKeys.filter(key => !actualKeys.includes(key));
      record.missingPlanned = planned.map(intent => intent.stableKey).filter(key => !actualKeys.includes(key));
      record.duplicateKeys = actualKeys.filter((key, index) => actualKeys.indexOf(key) !== index);
      record.oldDifferences = oldDifferences;
      record.plannedDifferences = plannedDifferences;
      record.passed = Array.isArray(oldRows)
        && Array.isArray(actualRows)
        && new Set(oldKeys).size === oldKeys.length
        && new Set(actualKeys).size === actualKeys.length
        && record.unexpected.length === 0
        && record.missingOld.length === 0
        && record.missingPlanned.length === 0
        && record.duplicateKeys.length === 0
        && oldDifferences.length === 0
        && plannedDifferences.length === 0;
    }
    if (!record.passed) failures.push(record);
    records.push(record);
  }
  return {
    checked: records.length,
    passed: records.filter(record => record.passed).length,
    failures,
    records,
    counts,
  };
}

function checkDetails(resultByRoute) {
  const records = [];
  const failures = [];
  for (const entry of allDetails) {
    const actual = resultByRoute.get(entry.detailRoute);
    const diff = actual?.status === 200
      ? firstDiff(strip(entry.candidateBody), strip(actual.data))
      : { at: '$status', expected: 200, actual: actual?.status ?? null };
    const record = {
      skillKey: entry.skillKey,
      kind: entry.kind,
      stableKey: entry.stableKey,
      route: entry.detailRoute,
      expected: entry.reused ? '复用既有组成' : '本批新增',
      status: actual?.status ?? null,
      passed: !diff,
      ...(diff ? { diff } : {}),
    };
    records.push(record);
    if (diff) failures.push(record);
  }
  return {
    checked: records.length,
    matched: records.filter(record => record.passed).length,
    failures,
    reusedChecked: records.filter(record => record.expected === '复用既有组成').length,
    plannedChecked: records.filter(record => record.expected === '本批新增').length,
    records,
  };
}

const resultByRoute = new Map();
let reportWritten = false;
function writeStopped(error) {
  if (reportWritten) return;
  const statuses = calls.reduce((out, call) => {
    const key = String(call.status);
    out[key] = (out[key] || 0) + 1;
    return out;
  }, {});
  const execution = {
    generatedAt: new Date().toISOString(),
    mode: '第三十一批修订三写后独立全字段GET回读',
    afterApply: true,
    status: 'STOPPED',
    complete: false,
    apiWrites: 0,
    noBusinessWrites: true,
    calls: calls.length,
    methods: { GET: calls.length },
    statuses,
    error: String(error?.stack || error),
    journalPath,
    frozen,
  };
  writeJson(path.join(runDir, '执行结果.json'), execution, 'wx');
  reportWritten = true;
  console.log(JSON.stringify({ status: execution.status, complete: false, apiWrites: 0, calls: calls.length, output: runDir, error: execution.error }, null, 2));
}

try {
  for (const route of freshRoutes) resultByRoute.set(route, await get(route));

  const protectionResult = checkProtection(resultByRoute);
  const detailResult = checkDetails(resultByRoute);
  const statuses = calls.reduce((out, call) => {
    const key = String(call.status);
    out[key] = (out[key] || 0) + 1;
    return out;
  }, {});
  const allStatus200 = calls.length === 379
    && new Set(calls.map(call => call.route)).size === 379
    && calls.every(call => call.method === 'GET' && call.status === 200);
  const protectionPassed = protectionResult.checked === 201
    && protectionResult.passed === 201
    && protectionResult.failures.length === 0;
  const detailsPassed = detailResult.checked === 207
    && detailResult.matched === 207
    && detailResult.reusedChecked === 29
    && detailResult.plannedChecked === 178
    && detailResult.failures.length === 0;
  const actualDetails = allDetails.map(entry => ({
    skillKey: entry.skillKey,
    kind: entry.kind,
    stableKey: entry.stableKey,
    route: entry.detailRoute,
    expected: entry.reused ? '复用既有组成' : '本批新增',
    status: resultByRoute.get(entry.detailRoute)?.status ?? null,
    data: resultByRoute.get(entry.detailRoute)?.data ?? null,
  }));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: '第三十一批修订三写后独立全字段GET回读',
    afterApply: true,
    apiBase: 'http://127.0.0.1:8080/api/admin/games/lol',
    apiWrites: 0,
    noBusinessWrites: true,
    methodology: '修订二大批和修订三单位替换锁均完成后，按冻结保护快照和修订三请求计划逐条执行GET；保护对象、主体、图片、角色、关系、六类列表、29项公共复用详情和178项本批最终详情均保留完整响应；列表核对旧行及本批计划行的投影字段，详情执行完整字段比对；本报告不进行数学验收。',
    hashes: {
      candidateSha256: sha256File(candidatePath),
      planSha256: sha256File(planPath),
      writerSha256: sha256File(writerPath),
      unitFixPlanSha256: sha256File(unitFixPlanPath),
      revision2CandidateSha256: sha256File(revision2CandidatePath),
      revision2PlanSha256: sha256File(revision2PlanPath),
      revision2WriterSha256: sha256File(revision2WriterPath),
      inputVersionSha256: sha256File(inputVersionPath),
      sourceBindingSha256: sha256File(sourceBindingPath),
      protectionSnapshotSha256: sha256File(protectionPath),
      reuseSha256: sha256File(reusePath),
      sourceRangeSha256: sha256File(sourceRangePath),
      semanticNoteSha256: sha256File(semanticNotePath),
      oldFailureSha256: sha256File(oldFailurePath),
    },
    sourceVersion: candidate.meta.sourceVersion,
    expected: {
      previousRevision1Successful: 80,
      previousRevision1Rejected: 1,
      revision2Successful: 98,
      revision3UnitFixPost: 1,
      revision3UnitFixDelete: 1,
      protectedRoutes: 201,
      protectedLists: 120,
      protectedCatalogs: 4,
      protectedCharacters: 4,
      protectedRelations: 4,
      protectedSubjects: 20,
      protectedImages: 20,
      reusedDetails: 29,
      plannedDetails: 178,
      componentDetails: 207,
      uniqueFreshGET: 379,
    },
    actual: {
      calls: calls.length,
      uniqueFreshGET: new Set(calls.map(call => call.route)).size,
      methods: { GET: calls.length },
      statuses,
      allStatus200,
      journalPath,
    },
    protection: protectionResult,
    details: detailResult,
    planRouteNormalization: normalizedPlanDetailRoutes,
    fullBusinessFields: {
      protectedRoutes: protection.requests.map(request => ({
        route: request.route,
        category: category(request.route),
        status: resultByRoute.get(request.route)?.status ?? null,
        data: resultByRoute.get(request.route)?.data ?? null,
      })),
      componentDetails: actualDetails,
    },
    rawResponses: calls,
    writeEvidence: {
      revision2: {
        lockPath: revision2LockPath,
        lockedWrite: revision2LockedWrite,
        reportPath: revision2LockedWrite.reportPath,
        result: {
          success: revision2WriteResult.success,
          apiWrites: revision2WriteResult.apiWrites,
          confirmed: revision2WriteResult.confirmed,
          counts: revision2WriteResult.counts,
        },
      },
      revision3UnitFix: {
        lockPath,
        lockedWrite,
        reportPath: lockedWrite.reportPath,
        result: {
          success: unitFixResult.success,
          post201: unitFixResult.post201,
          delete204: unitFixResult.delete204,
          GETs: unitFixResult.GETs,
        },
      },
    },
    frozen,
    status: allStatus200 && protectionPassed && detailsPassed ? 'PASS' : 'REVISE',
    complete: allStatus200 && protectionPassed && detailsPassed,
  };
  const reportPath = path.join(runDir, '独立全量回读.json');
  writeJson(reportPath, report, 'wx');
  const execution = {
    generatedAt: report.generatedAt,
    mode: report.mode,
    status: report.status,
    complete: report.complete,
    apiWrites: 0,
    noBusinessWrites: true,
    calls: report.actual.calls,
    methods: report.actual.methods,
    statuses: report.actual.statuses,
    protection: { checked: report.protection.checked, passed: report.protection.passed },
    details: {
      checked: report.details.checked,
      matched: report.details.matched,
      reusedChecked: report.details.reusedChecked,
      plannedChecked: report.details.plannedChecked,
    },
    reportPath,
    journalPath,
  };
  writeJson(path.join(runDir, '执行结果.json'), execution, 'wx');
  reportWritten = true;
  console.log(JSON.stringify({
    status: report.status,
    complete: report.complete,
    apiWrites: 0,
    calls: report.actual.calls,
    methods: report.actual.methods,
    statuses: report.actual.statuses,
    protection: { checked: report.protection.checked, passed: report.protection.passed },
    details: execution.details,
    output: runDir,
  }, null, 2));
  if (!report.complete) process.exitCode = 1;
} catch (error) {
  writeStopped(error);
  process.exitCode = 1;
  throw error;
}

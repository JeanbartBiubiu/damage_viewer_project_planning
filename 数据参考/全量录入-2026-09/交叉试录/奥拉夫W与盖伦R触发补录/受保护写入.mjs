import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');
if (process.env.DAMAGE_ALLOW_BUSINESS_WRITES !== '1') {
  throw new Error('当前仅准备阶段；必须显式设置 DAMAGE_ALLOW_BUSINESS_WRITES=1 才允许业务写入');
}

const reportPath = path.join(here, '06-写入与即时回读.json');
const targetKeys = [
  { skillKey: 'olaf_w', characterKey: 'champion_olaf' },
  { skillKey: 'garen_r', characterKey: 'champion_garen' }
];
const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const shaFile = (fileName) => sha256(fs.readFileSync(path.join(here, fileName)));
const readJson = (fileName) => JSON.parse(fs.readFileSync(path.join(here, fileName), 'utf8'));
const frozen = readJson('02-冻结请求.json');
const baseline = readJson('04-写入前现值.json');
const review = readJson('05-Cursor独立评审.json');
const report = {
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  authorizationValueRecorded: false,
  preflight: [],
  writes: [],
  finalReadback: [],
  businessWriteCount: 0,
  error: null
};

function saveReport() {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function deepEqual(actual, expected) {
  if (Object.is(actual, expected)) return true;
  if (typeof actual !== typeof expected || actual === null || expected === null) return false;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected)
      && actual.length === expected.length
      && actual.every((value, index) => deepEqual(value, expected[index]));
  }
  if (typeof actual !== 'object') return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index] && deepEqual(actual[key], expected[key]));
}

function subsetEqual(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length >= expected.length
      && expected.every((value, index) => subsetEqual(actual[index], value));
  }
  if (expected && typeof expected === 'object') {
    return Boolean(actual && typeof actual === 'object' && !Array.isArray(actual))
      && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && subsetEqual(actual[key], value));
  }
  return Object.is(actual, expected);
}

function requireStatus(response, expected, context) {
  if (response.status !== expected) throw new Error(`${context} 预期 ${expected}，实际 ${response.status}`);
  return response;
}

function arrayData(response, context) {
  requireStatus(response, 200, context);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(`${context} 没有数组结果`);
}

let getCount = 0;
let writeCount = 0;
async function request(method, route, body) {
  if (method === 'GET') getCount += 1;
  if (method !== 'GET') {
    writeCount += 1;
    if (method !== 'POST' && method !== 'PUT') throw new Error(`禁止的业务方法：${method}`);
    if (method === 'POST' && !route.endsWith('/trigger-rules')) throw new Error(`POST 越界：${route}`);
    if (method === 'PUT' && !route.startsWith('/skills/')) throw new Error(`PUT 越界：${route}`);
  }
  const response = await fetch(baseUrl + route, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000)
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { parseError: true, responseBytes: Buffer.byteLength(raw) };
    }
  }
  return { method, route, status: response.status, data };
}

async function getMany(routes, concurrency = 24) {
  const result = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= routes.length) return;
      result[index] = await request('GET', routes[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker()));
  return result;
}

function ruleKeyId(skillKey, ruleKey) {
  return `${skillKey}/${ruleKey}`;
}

async function scanRules(includeDetails) {
  const skillsResponse = requireStatus(await request('GET', '/skills'), 200, '全技能目录');
  const skills = arrayData(skillsResponse, '全技能目录');
  const skillKeys = skills.map((item) => item.skillKey).sort();
  if (new Set(skillKeys).size !== skillKeys.length) throw new Error('全技能目录存在重复 skillKey');
  const listResponses = await getMany(skillKeys.map((skillKey) => `/skills/${encodeURIComponent(skillKey)}/trigger-rules`));
  const lists = listResponses.map((response, index) => {
    const rules = arrayData(response, `触发规则列表 ${skillKeys[index]}`);
    const ruleKeys = rules.map((item) => item.ruleKey);
    if (new Set(ruleKeys).size !== ruleKeys.length) throw new Error(`触发规则列表键重复：${skillKeys[index]}`);
    return { skillKey: skillKeys[index], response, rules, ruleKeys: ruleKeys.sort() };
  });
  const refs = lists.flatMap((list) => list.ruleKeys.map((ruleKey) => ({ skillKey: list.skillKey, ruleKey })));
  const details = includeDetails
    ? await getMany(refs.map(({ skillKey, ruleKey }) => `/skills/${encodeURIComponent(skillKey)}/trigger-rules/${encodeURIComponent(ruleKey)}`))
    : [];
  if (includeDetails) details.forEach((response, index) => requireStatus(response, 200, `触发规则详情 ${refs[index].skillKey}/${refs[index].ruleKey}`));
  return {
    skillsResponse,
    skills,
    skillKeys,
    lists,
    refs,
    details: details.map((response, index) => ({ ...refs[index], response }))
  };
}

async function readTarget(target) {
  const subject = requireStatus(await request('GET', `/skills/${target.skillKey}`), 200, `${target.skillKey} 主体`);
  const relation = requireStatus(
    await request('GET', `/character-skill-relations?characterKey=${encodeURIComponent(target.characterKey)}`),
    200,
    `${target.characterKey} 关系`
  );
  const representativeImage = requireStatus(await request('GET', `/skills/${target.skillKey}/representative-image`), 200, `${target.skillKey} 代表图片`);
  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const list = requireStatus(await request('GET', `/skills/${target.skillKey}/${apiName}`), 200, `${target.skillKey}/${apiName}`);
    const items = arrayData(list, `${target.skillKey}/${apiName}`);
    const keys = items.map((item) => item[keyName]);
    if (keys.some((key) => typeof key !== 'string') || new Set(keys).size !== keys.length) throw new Error(`${target.skillKey}/${apiName} 键异常`);
    const details = await getMany(keys.map((key) => `/skills/${target.skillKey}/${apiName}/${encodeURIComponent(key)}`));
    details.forEach((response, index) => requireStatus(response, 200, `${target.skillKey}/${apiName}/${keys[index]}`));
    components[apiName] = { list, details: details.map((response, index) => ({ key: keys[index], response })) };
  }
  return { skillKey: target.skillKey, characterKey: target.characterKey, subject, relation, representativeImage, components };
}

function targetComparable(target) {
  return {
    subject: target.subject,
    relation: target.relation,
    representativeImage: target.representativeImage,
    components: target.components
  };
}

function targetProtectedComparable(target) {
  return {
    subject: target.subject,
    relation: target.relation,
    representativeImage: target.representativeImage,
    components: Object.fromEntries(
      Object.entries(target.components).filter(([kind]) => kind !== 'trigger-rules')
    )
  };
}

function sameStringList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function validateApprovedHashes() {
  let approved;
  try {
    approved = JSON.parse(process.env.DAMAGE_APPROVED_HASHES_JSON ?? '{}');
  } catch {
    throw new Error('DAMAGE_APPROVED_HASHES_JSON 不是有效 JSON');
  }
  for (const fileName of ['01-来源与方案.md', '02-冻结请求.json', '03-来源快照.json', '04-写入前现值.json', '05-Cursor独立评审.json']) {
    const expected = approved[fileName];
    if (!/^[0-9a-f]{64}$/i.test(String(expected ?? ''))) throw new Error(`缺少批准散列：${fileName}`);
    const actual = shaFile(fileName);
    if (actual.toLowerCase() !== String(expected).toLowerCase()) throw new Error(`${fileName} 散列漂移：${actual}`);
  }
  const approvedCursor = process.env.DAMAGE_APPROVED_CURSOR_SUMMARY_SHA256;
  if (!/^[0-9a-f]{64}$/i.test(String(approvedCursor ?? ''))) throw new Error('缺少 Cursor 原始摘要批准散列');
  if (approvedCursor.toLowerCase() !== String(frozen.cursorOriginalSummary?.sha256 ?? '').toLowerCase()) {
    throw new Error('Cursor 原始摘要散列不符');
  }
}

function validateReview() {
  if (review.resultStatus !== 'finished' || review.verdict !== 'READY' || review.reviewedPlanRevision !== 1) {
    throw new Error('独立评审尚未达到 READY');
  }
  if (review.writeAllowlistAudit?.runDeltaCount !== 0
    || review.writeAllowlistAudit?.outsideScopeCount !== 0
    || review.writeAllowlistAudit?.runDeltaOutsideScopeCount !== 0
    || review.toolEvents?.allTerminalCallsCompleted !== true
    || review.toolEvents?.anyTruncated !== false
    || review.apiWrites !== 0) {
    throw new Error('独立评审写入门禁字段不合格');
  }
}

function expectedOldRuleMap() {
  return new Map(baseline.allSkillRuleScan.ruleDetails.map((item) => [ruleKeyId(item.skillKey, item.ruleKey), item.response]));
}

function checkRuleInventory(current, expectedOld, context) {
  const refs = current.refs.map(({ skillKey, ruleKey }) => ruleKeyId(skillKey, ruleKey)).sort();
  const oldKeys = [...expectedOld.keys()].sort();
  if (!sameStringList(refs, oldKeys)) throw new Error(`${context} 既有规则键集合变化`);
  for (const item of current.details) {
    const id = ruleKeyId(item.skillKey, item.ruleKey);
    const old = expectedOld.get(id);
    if (!old) throw new Error(`${context} 出现未知既有规则：${id}`);
    if (!deepEqual(item.response, old)) throw new Error(`${context} 既有规则对象变化：${id}`);
  }
}

function checkListInventory(current, expected) {
  if (!deepEqual(current.skillsResponse, expected.skillsCatalog)) throw new Error('全技能目录发生变化');
  if (current.lists.length !== expected.ruleLists.length) throw new Error('触发规则列表数量变化');
  const expectedBySkill = new Map(expected.ruleLists.map((item) => [item.skillKey, item]));
  for (const currentList of current.lists) {
    const saved = expectedBySkill.get(currentList.skillKey);
    if (!saved || !deepEqual(currentList.response, saved.response) || !deepEqual(currentList.rules, saved.rules)) {
      throw new Error(`触发规则列表变化：${currentList.skillKey}`);
    }
  }
}

function checkFinalListInventory(current, expected, oldRuleKeys) {
  if (!deepEqual(current.skillsResponse, expected.skillsCatalog)) throw new Error('最终全技能目录发生变化');
  const expectedBySkill = new Map(expected.ruleLists.map((item) => [item.skillKey, item]));
  for (const currentList of current.lists) {
    const saved = expectedBySkill.get(currentList.skillKey);
    if (!saved) throw new Error(`最终出现未知技能规则列表：${currentList.skillKey}`);
    const currentOld = currentList.rules.filter((item) => oldRuleKeys.has(ruleKeyId(currentList.skillKey, item.ruleKey)));
    const savedOld = saved.rules.filter((item) => oldRuleKeys.has(ruleKeyId(saved.skillKey, item.ruleKey)));
    if (!deepEqual(currentOld, savedOld)) throw new Error(`最终既有规则列表摘要变化：${currentList.skillKey}`);
  }
}

function checkTargetBaseline(current, expectedTargets) {
  const expectedBySkill = new Map(expectedTargets.map((item) => [item.skillKey, item]));
  for (const item of current) {
    const expected = expectedBySkill.get(item.skillKey);
    if (!expected || !deepEqual(targetComparable(item), targetComparable(expected))) {
      throw new Error(`目标现值变化：${item.skillKey}`);
    }
  }
}

function checkTargetRulesEmpty(currentTargets, frozenWrites) {
  const intended = new Map(frozenWrites.filter((item) => item.method === 'POST').map((item) => [item.detailRoute, item]));
  for (const target of currentTargets) {
    const rules = arrayData(target.components['trigger-rules'].list, `${target.skillKey}/trigger-rules`);
    for (const rule of rules) {
      const id = `/skills/${target.skillKey}/trigger-rules/${rule.ruleKey}`;
      if (intended.has(id)) throw new Error(`新增目标已存在，禁止重放：${id}`);
    }
  }
}

async function preflight() {
  if (frozen.status !== 'READY_FOR_INDEPENDENT_REVIEW' || frozen.writable !== true) throw new Error('冻结请求当前不可写入');
  if (frozen.plannedRuleAdds !== 2 || frozen.plannedWrites !== frozen.writes.length) throw new Error('冻结请求数量不符');
  if (frozen.expectedCurrent?.ruleCount !== 94 || frozen.expectedCurrent?.sourceInitializedCount !== 24) throw new Error('冻结预期规则计数不符');
  if (baseline.businessWrites !== 0 || baseline.requestPolicy?.businessWriteIssued !== false) throw new Error('写前基线已有业务写入记录');
  if (shaFile('03-来源快照.json') !== frozen.sourceSnapshotSha256) throw new Error('来源快照散列与冻结请求不符');
  if (shaFile('02-冻结请求.json') !== baseline.frozenRequestSha256) throw new Error('冻结请求散列与写前基线不符');
  validateReview();

  const currentTargets = [];
  for (const target of targetKeys) currentTargets.push(await readTarget(target));
  const currentRules = await scanRules(true);
  const secondRules = await scanRules(false);
  const secondKeys = secondRules.refs.map(({ skillKey, ruleKey }) => ruleKeyId(skillKey, ruleKey)).sort();
  const firstKeys = currentRules.refs.map(({ skillKey, ruleKey }) => ruleKeyId(skillKey, ruleKey)).sort();
  if (!sameStringList(currentRules.skillKeys, secondRules.skillKeys) || !sameStringList(firstKeys, secondKeys)) {
    throw new Error('写入前两轮纯 GET 键集合不稳定');
  }
  if (currentRules.refs.length !== 94 || currentRules.details.length !== 94) throw new Error(`写入前规则总数异常：${currentRules.refs.length}`);
  const sourceInitialized = currentRules.details.filter((item) => item.response.data?.eventSource?.eventType === 'SOURCE_INITIALIZED').length;
  if (sourceInitialized !== 24) throw new Error(`写入前 SOURCE_INITIALIZED 数量异常：${sourceInitialized}`);

  checkTargetBaseline(currentTargets, baseline.targets);
  checkListInventory(currentRules, baseline.allSkillRuleScan);
  checkRuleInventory(currentRules, expectedOldRuleMap(), '写入前');
  checkTargetRulesEmpty(currentTargets, frozen.writes);
  report.preflight = [{
    targetGetCount: getCount,
    targetCount: currentTargets.length,
    skillCount: currentRules.skillKeys.length,
    ruleCount: currentRules.refs.length,
    sourceInitializedCount: sourceInitialized,
    secondScanSkillCount: secondRules.skillKeys.length,
    secondScanRuleCount: secondRules.refs.length,
    businessWrites: 0
  }];
  saveReport();
  return { currentTargets, currentRules };
}

function routeForBefore(entry) {
  return entry.detailRoute ?? (entry.method === 'POST' ? `${entry.route}/${entry.body.ruleKey}` : entry.route);
}

async function executeWrites() {
  for (const entry of frozen.writes) {
    const detailRoute = routeForBefore(entry);
    const before = await request('GET', detailRoute);
    const expectedBefore = entry.method === 'POST' ? 404 : 200;
    requireStatus(before, expectedBefore, `写入前目标 ${detailRoute}`);
    if (entry.method === 'PUT') {
      const target = baseline.targets.find((item) => item.skillKey === entry.route.split('/')[2]);
      if (!target || !deepEqual(before, target.subject)) throw new Error(`主体 PUT 前现值变化：${detailRoute}`);
    }
    const written = await request(entry.method, entry.route, entry.body);
    report.businessWriteCount += 1;
    const writeLog = {
      id: entry.id,
      method: entry.method,
      route: entry.route,
      detailRoute,
      bodySha256: sha256(Buffer.from(JSON.stringify(entry.body), 'utf8')),
      status: written.status,
      immediateReadback: null
    };
    report.writes.push(writeLog);
    saveReport();
    requireStatus(written, entry.expectedStatus, `写入 ${entry.route}`);
    if (!subsetEqual(written.data, entry.body)) throw new Error(`写入响应不包含冻结请求体：${entry.route}`);
    const readback = await request('GET', detailRoute);
    writeLog.immediateReadback = readback;
    saveReport();
    requireStatus(readback, 200, `即时回读 ${detailRoute}`);
    if (!subsetEqual(readback.data, entry.body)) throw new Error(`即时回读不包含冻结请求体：${detailRoute}`);
  }
}

async function finalReadback() {
  const finalTargets = [];
  for (const target of targetKeys) finalTargets.push(await readTarget(target));
  const baselineBySkill = new Map(baseline.targets.map((item) => [item.skillKey, item]));
  for (const target of finalTargets) {
    const expected = baselineBySkill.get(target.skillKey);
    if (!expected || !deepEqual(targetProtectedComparable(target), targetProtectedComparable(expected))) {
      throw new Error(`最终受保护组成变化：${target.skillKey}`);
    }
  }
  const finalRules = await scanRules(true);
  const oldMap = expectedOldRuleMap();
  const finalKeys = finalRules.refs.map(({ skillKey, ruleKey }) => ruleKeyId(skillKey, ruleKey)).sort();
  const expectedKeys = [...oldMap.keys(), 'olaf_w/on_used', 'garen_r/on_hit'].sort();
  if (!sameStringList(finalKeys, expectedKeys)) throw new Error('最终规则键集合不是旧94条加两条目标规则');
  if (finalRules.refs.length !== 96 || finalRules.details.length !== 96) throw new Error(`最终规则总数异常：${finalRules.refs.length}`);
  const sourceInitialized = finalRules.details.filter((item) => item.response.data?.eventSource?.eventType === 'SOURCE_INITIALIZED').length;
  if (sourceInitialized !== 24) throw new Error(`最终 SOURCE_INITIALIZED 数量变化：${sourceInitialized}`);
  checkRuleInventory({ ...finalRules, refs: finalRules.refs.filter(({ skillKey, ruleKey }) => oldMap.has(ruleKeyId(skillKey, ruleKey))), details: finalRules.details.filter(({ skillKey, ruleKey }) => oldMap.has(ruleKeyId(skillKey, ruleKey))) }, oldMap, '最终');
  checkFinalListInventory(finalRules, baseline.allSkillRuleScan, oldMap);
  const frozenByDetail = new Map(frozen.writes.filter((entry) => entry.method === 'POST').map((entry) => [entry.detailRoute, entry.body]));
  for (const item of finalRules.details) {
    const expected = frozenByDetail.get(`/skills/${item.skillKey}/trigger-rules/${item.ruleKey}`);
    if (expected && !subsetEqual(item.response.data, expected)) throw new Error(`新增规则最终回读不含请求体：${item.skillKey}/${item.ruleKey}`);
  }
  for (const entry of frozen.writes.filter((item) => item.method === 'PUT')) {
    const target = finalTargets.find((item) => item.skillKey === entry.route.split('/')[2]);
    if (!target || !subsetEqual(target.subject.data, entry.body)) throw new Error(`主体更新最终回读不含冻结字段：${entry.route}`);
  }
  report.finalReadback.push({
    getCount,
    targetCount: finalTargets.length,
    skillCount: finalRules.skillKeys.length,
    ruleCount: finalRules.refs.length,
    sourceInitializedCount: sourceInitialized,
    targetKeys: finalTargets.map((item) => item.skillKey),
    businessWrites: report.businessWriteCount
  });
}

try {
  validateApprovedHashes();
  const before = await preflight();
  await executeWrites();
  await finalReadback();
  if (writeCount !== report.businessWriteCount) throw new Error('业务写入计数记录不一致');
  report.status = 'PASS';
  report.completedAt = new Date().toISOString();
  report.getCount = getCount;
  report.writeCount = writeCount;
  saveReport();
  console.log(JSON.stringify({ status: report.status, getCount, businessWrites: report.businessWriteCount, preflight: before.currentRules.refs.length, finalRuleCount: report.finalReadback.at(-1).ruleCount }, null, 2));
} catch (error) {
  report.status = 'FAILED';
  report.completedAt = new Date().toISOString();
  report.getCount = getCount;
  report.writeCount = writeCount;
  report.error = { message: error instanceof Error ? error.message : String(error) };
  saveReport();
  throw error;
}

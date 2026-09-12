import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(here, '07-Luna独立回读.json');
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_ENTRY_TOKEN || `luna-get-${crypto.randomUUID()}`;
const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];
const nonTriggerKinds = componentKinds.filter(([kind]) => kind !== 'trigger-rules');
const targets = [
  { skillKey: 'olaf_w', characterKey: 'champion_olaf', hero: '奥拉夫', imageHero: '奥拉夫' },
  { skillKey: 'garen_r', characterKey: 'champion_garen', hero: '盖伦', imageHero: '盖伦' }
];

const calls = [];
const failures = [];
const report = {
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: 'RUNNING',
  passed: false,
  methodPolicy: 'GET_ONLY',
  apiBase,
  authorizationValueRecorded: false,
  businessWrites: 0,
  businessWriteCount: 0,
  apiWrites: 0,
  getCount: 0,
  mismatches: 0,
  inputFiles: {},
  staticChecks: [],
  ruleScan: null,
  targetReadback: null,
  mechanismChecks: [],
  requestSummary: null,
  targetSummaries: [],
  findings: [],
  limitations: [
    '本轮只证明管理数据、接口回读和本地代表图片文件尺寸。',
    '本轮未执行战斗运行、Wasm 或浏览器页面验收。'
  ],
  error: null,
};

function scrub(value) {
  const text = String(value ?? '');
  return token && text.includes(token) ? '[REDACTED]' : text;
}

function clip(value, max = 1600) {
  if (value === undefined) return '[undefined]';
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  text = scrub(text);
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function sha256Value(value) {
  return sha256(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function firstDiff(expected, actual, at = '$') {
  if (Object.is(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    return { at, expected: clip(expected), actual: clip(actual) };
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return { at, expected: clip(expected), actual: clip(actual) };
    }
    if (expected.length !== actual.length) {
      return { at: `${at}.length`, expected: expected.length, actual: actual.length };
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
      return {
        at: `${at}.${key}`,
        expectedPresent: Object.hasOwn(expected, key),
        actualPresent: Object.hasOwn(actual, key),
      };
    }
    const difference = firstDiff(expected[key], actual[key], `${at}.${key}`);
    if (difference) return difference;
  }
  return null;
}

function diff(expected, actual) {
  return firstDiff(stable(expected), stable(actual));
}

// 新规则允许后端补充明确的响应元数据或空字段；对象中冻结字段必须存在，数组长度和顺序必须完全相同。
function subsetDiff(actual, expected, at = '$') {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return { at, expected: clip(expected), actual: clip(actual) };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = subsetDiff(actual[index], expected[index], `${at}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
      return { at, expected: clip(expected), actual: clip(actual) };
    }
    for (const [key, value] of Object.entries(expected)) {
      if (!Object.hasOwn(actual, key)) {
        return { at: `${at}.${key}`, expectedPresent: true, actualPresent: false };
      }
      const difference = subsetDiff(actual[key], value, `${at}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return Object.is(actual, expected) ? null : { at, expected, actual };
}

function rows(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return null;
}

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(here, fileName), 'utf8'));
}

function ruleRefKey(skillKey, ruleKey) {
  return `${skillKey}/${ruleKey}`;
}

function encodeKey(value) {
  return encodeURIComponent(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function check(bucket, scope, name, fn, details = {}) {
  try {
    const result = fn();
    const record = {
      name,
      passed: true,
      ...details,
      ...(result && typeof result === 'object' ? result : {})
    };
    bucket.push(record);
    return record;
  } catch (error) {
    const record = {
      name,
      passed: false,
      ...details,
      message: scrub(error?.message ?? error)
    };
    bucket.push(record);
    failures.push({ scope, ...record });
    return record;
  }
}

function addFailure(scope, message, details = {}) {
  failures.push({ scope, message: scrub(message), ...details });
}

function safeRoute(route) {
  assert(typeof route === 'string' && route.startsWith('/'), `不安全 GET 路径：${route}`);
  assert(!route.includes('://') && !route.includes('..') && !route.includes('#'), `不安全 GET 路径：${route}`);
}

async function get(route) {
  safeRoute(route);
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(apiBase + route, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(30_000)
    });
    const bodyText = await response.text();
    let data = null;
    let parseError = null;
    if (bodyText) {
      try {
        data = JSON.parse(bodyText);
      } catch (error) {
        parseError = scrub(error?.message ?? error);
      }
    }
    const result = {
      method: 'GET',
      route,
      status: response.status,
      data,
      ...(parseError ? { parseError } : {}),
      startedAt,
      finishedAt: new Date().toISOString()
    };
    calls.push({
      method: 'GET',
      route,
      status: response.status,
      ...(parseError ? { parseError } : {})
    });
    return result;
  } catch (error) {
    const result = {
      method: 'GET',
      route,
      status: null,
      data: null,
      error: scrub(error?.message ?? error),
      startedAt,
      finishedAt: new Date().toISOString()
    };
    calls.push({ method: 'GET', route, status: null, error: result.error });
    return result;
  }
}

async function mapLimit(values, limit, worker) {
  const results = new Array(values.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => run()));
  return results;
}

function callSummary() {
  const methods = {};
  const statuses = {};
  for (const call of calls) {
    methods[call.method] = (methods[call.method] || 0) + 1;
    const status = String(call.status);
    statuses[status] = (statuses[status] || 0) + 1;
  }
  return {
    totalGets: calls.length,
    methods,
    statuses,
    allRequestsWereGET: calls.length > 0 && calls.every((call) => call.method === 'GET'),
    failedRequests: calls
      .filter((call) => call.status === null || call.status >= 400 || call.parseError)
      .map((call) => ({
        method: call.method,
        route: call.route,
        status: call.status,
        ...(call.error ? { error: scrub(call.error) } : {}),
        ...(call.parseError ? { parseError: scrub(call.parseError) } : {})
      }))
  };
}

function inputPath(fileName) {
  return path.join(here, fileName);
}

function collectInputHashes() {
  const names = [
    'README.md',
    '01-来源与方案.md',
    '02-冻结请求.json',
    '03-来源快照.json',
    '04-写入前现值.json',
    '05-Cursor独立评审.json',
    '06-写入与即时回读.json',
    '受保护写入.mjs',
    '页面验收.mjs'
  ];
  const result = {};
  for (const name of names) {
    try {
      result[name] = { path: inputPath(name), sha256: sha256File(inputPath(name)) };
    } catch (error) {
      result[name] = { path: inputPath(name), error: scrub(error?.message ?? error) };
    }
  }
  return result;
}

function approvedHashPath(fileName) {
  const direct = inputPath(fileName);
  if (fs.existsSync(direct)) return direct;
  return null;
}

function pngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(bytes.length >= 24 && bytes.subarray(0, 8).equals(signature), `不是 PNG 文件：${filePath}`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), byteSize: bytes.length };
}

function imageSourceFor(sourceSnapshot, hero) {
  return sourceSnapshot?.sources?.find((source) => source.hero === hero && source.kind === '代表图片来源') || null;
}

function expectedTargetRuleBodies(frozen) {
  const map = new Map();
  for (const write of frozen?.writes || []) {
    if (write.method !== 'POST' || !write.detailRoute) continue;
    const match = write.detailRoute.match(/^\/skills\/([^/?]+)\/trigger-rules\/([^/?]+)$/);
    if (match) map.set(ruleRefKey(decodeURIComponent(match[1]), decodeURIComponent(match[2])), write.body);
  }
  return map;
}

function baselineRuleMap(baseline) {
  const map = new Map();
  for (const entry of baseline?.allSkillRuleScan?.ruleDetails || []) {
    if (entry?.skillKey && entry?.ruleKey && entry?.response?.data) {
      map.set(ruleRefKey(entry.skillKey, entry.ruleKey), entry.response.data);
    }
  }
  return map;
}

function baselineTargetMap(baseline) {
  return new Map((baseline?.targets || []).map((target) => [target.skillKey, target]));
}

function responseDataCheck(actual, expected, label, bucket, scope, strict = true) {
  check(bucket, scope, label, () => {
    assert(actual && actual.method === 'GET', `${label} 请求方法不是 GET`);
    assert(actual.status === 200, `${label} 状态不是 200，实际 ${actual.status}`);
    const difference = strict ? diff(expected?.data, actual.data) : subsetDiff(actual.data, expected?.data);
    assert(!difference, `${label} 数据不匹配：${JSON.stringify(difference)}`);
  }, { status: actual?.status ?? null });
}

async function readTarget(target, baselineTarget, sourceSnapshot) {
  const checks = [];
  const summary = {
    skillKey: target.skillKey,
    hero: target.hero,
    characterKey: target.characterKey,
    subjectStatus: null,
    relationStatus: null,
    representativeImageStatus: null,
    sourceImage: null,
    components: {},
    checks
  };
  const actual = { skillKey: target.skillKey, components: {}, rules: null };

  const subject = await get(`/skills/${encodeKey(target.skillKey)}`);
  summary.subjectStatus = subject.status;
  responseDataCheck(subject, baselineTarget?.subject, `${target.skillKey} 主体严格回读`, checks, 'targetReadback');
  actual.subject = subject;

  const relationRoute = `/character-skill-relations?characterKey=${encodeKey(target.characterKey)}`;
  const relation = await get(relationRoute);
  summary.relationStatus = relation.status;
  responseDataCheck(relation, baselineTarget?.relation, `${target.skillKey} 角色技能关系严格回读`, checks, 'targetReadback');
  actual.relation = relation;

  const image = await get(`/skills/${encodeKey(target.skillKey)}/representative-image`);
  summary.representativeImageStatus = image.status;
  responseDataCheck(image, baselineTarget?.representativeImage, `${target.skillKey} 代表图片关联严格回读`, checks, 'targetReadback');
  actual.representativeImage = image;

  const imageSource = imageSourceFor(sourceSnapshot, target.imageHero);
  let sourceImageInfo = { path: imageSource?.path || null };
  check(checks, 'targetReadback', `${target.skillKey} 代表图片启用且来源为 64x64`, () => {
    assert(image.data?.image?.enabled === true, '代表图片关联未启用');
    assert(imageSource && typeof imageSource.path === 'string', '来源快照没有代表图片文件');
    const dimensions = pngDimensions(imageSource.path);
    sourceImageInfo = {
      path: imageSource.path,
      byteSize: dimensions.byteSize,
      width: dimensions.width,
      height: dimensions.height,
      expectedSha256: imageSource.sha256,
      actualSha256: sha256File(imageSource.path)
    };
    assert(sourceImageInfo.actualSha256 === sourceImageInfo.expectedSha256, '代表图片来源散列与03快照不一致');
    assert(dimensions.width === 64 && dimensions.height === 64, `代表图片尺寸不是64x64：${dimensions.width}x${dimensions.height}`);
  }, { imageKey: image.data?.image?.imageKey ?? null });
  summary.sourceImage = sourceImageInfo;

  for (const [apiName, keyField] of nonTriggerKinds) {
    const baselineComponent = baselineTarget?.components?.[apiName];
    const list = await get(`/skills/${encodeKey(target.skillKey)}/${apiName}`);
    const expectedList = baselineComponent?.list;
    const listChecks = [];
    responseDataCheck(list, expectedList, `${target.skillKey}/${apiName} 列表严格回读`, listChecks, 'targetReadback');
    const expectedRows = rows(expectedList?.data) || [];
    const actualRows = rows(list.data) || [];
    const expectedKeys = expectedRows.map((row) => row?.[keyField]);
    const actualKeys = actualRows.map((row) => row?.[keyField]);
    const duplicateActual = actualKeys.filter((key, index) => actualKeys.indexOf(key) !== index);
    const keyMismatch = diff(expectedKeys, actualKeys);
    check(listChecks, 'targetReadback', `${target.skillKey}/${apiName} 列表稳定键和顺序`, () => {
      assert(expectedKeys.every((key) => typeof key === 'string'), '基线列表存在缺失稳定键');
      assert(actualKeys.every((key) => typeof key === 'string'), '当前列表存在缺失稳定键');
      assert(duplicateActual.length === 0, `当前列表存在重复稳定键：${duplicateActual.join(',')}`);
      assert(!keyMismatch, `列表稳定键不一致：${JSON.stringify(keyMismatch)}`);
    }, { expectedCount: expectedKeys.length, actualCount: actualKeys.length });

    const expectedDetails = new Map((baselineComponent?.details || []).map((entry) => [entry.key, entry.response?.data]));
    const detailKeys = [...new Set([...expectedKeys, ...actualKeys].filter((key) => typeof key === 'string'))];
    const detailResponses = await mapLimit(detailKeys, 24, async (key) => ({
      key,
      response: await get(`/skills/${encodeKey(target.skillKey)}/${apiName}/${encodeKey(key)}`)
    }));
    const detailChecks = [];
    let detailMatched = 0;
    for (const entry of detailResponses) {
      const expectedData = expectedDetails.get(entry.key);
      check(detailChecks, 'targetReadback', `${target.skillKey}/${apiName}/${entry.key} 详情严格回读`, () => {
        assert(expectedDetails.has(entry.key), '当前详情键不在04基线列表');
        assert(entry.response.status === 200, `详情状态不是200，实际 ${entry.response.status}`);
        const difference = diff(expectedData, entry.response.data);
        assert(!difference, `详情数据不匹配：${JSON.stringify(difference)}`);
        detailMatched += 1;
      }, { status: entry.response.status, key: entry.key });
    }
    actual.components[apiName] = {
      list,
      listRows: actualRows,
      details: detailResponses,
      detailData: new Map(detailResponses.map((entry) => [entry.key, entry.response.data]))
    };
    summary.components[apiName] = {
      listStatus: list.status,
      expectedCount: expectedKeys.length,
      actualCount: actualKeys.length,
      expectedKeys,
      actualKeys,
      detailExpected: expectedKeys.length,
      detailRead: detailResponses.length,
      detailMatched,
      checks: [...listChecks, ...detailChecks]
    };
    checks.push(...listChecks, ...detailChecks);
  }
  return { actual, summary };
}

async function scanAllRules(baseline, frozen) {
  const checks = [];
  const skillsResponse = await get('/skills');
  const skillRows = rows(skillsResponse.data) || [];
  const actualSkillKeys = skillRows.map((row) => row?.skillKey);
  const baselineSkillKeys = (rows(baseline?.allSkillRuleScan?.skillsCatalog?.data) || [])
    .map((row) => row?.skillKey)
    .sort((a, b) => String(a).localeCompare(String(b)));
  const sortedSkillKeys = [...actualSkillKeys].filter((key) => typeof key === 'string').sort((a, b) => a.localeCompare(b));
  const duplicateSkillKeys = actualSkillKeys.filter((key, index) => actualSkillKeys.indexOf(key) !== index);
  const skillKeyDifference = diff(baselineSkillKeys, sortedSkillKeys);
  check(checks, 'ruleScan', '技能目录为1062项且稳定键保持不变', () => {
    assert(skillsResponse.status === 200, `技能目录状态不是200，实际 ${skillsResponse.status}`);
    assert(Array.isArray(rows(skillsResponse.data)), '技能目录没有数组结果');
    assert(actualSkillKeys.length === 1062, `技能目录数量不是1062，实际 ${actualSkillKeys.length}`);
    assert(duplicateSkillKeys.length === 0, `技能目录稳定键重复：${duplicateSkillKeys.join(',')}`);
    assert(!skillKeyDifference, `技能目录键集合不一致：${JSON.stringify(skillKeyDifference)}`);
  }, { status: skillsResponse.status, count: actualSkillKeys.length, skillKeysSha256: sha256Value(sortedSkillKeys) });

  const listResponses = await mapLimit(sortedSkillKeys, 24, async (skillKey) => ({
    skillKey,
    response: await get(`/skills/${encodeKey(skillKey)}/trigger-rules`)
  }));
  const listFailures = [];
  const duplicateRuleRefs = [];
  const ruleRefs = [];
  const listSummaries = [];
  for (const item of listResponses) {
    const list = rows(item.response.data);
    const keys = Array.isArray(list) ? list.map((row) => row?.ruleKey) : [];
    const duplicateKeys = keys.filter((key, index) => keys.indexOf(key) !== index);
    if (item.response.status !== 200 || !Array.isArray(list) || keys.some((key) => typeof key !== 'string') || duplicateKeys.length > 0) {
      listFailures.push({
        skillKey: item.skillKey,
        status: item.response.status,
        responseShape: Array.isArray(list) ? 'array' : item.response.data === null ? 'null' : typeof item.response.data,
        duplicateKeys
      });
    }
    for (const ruleKey of keys) {
      if (typeof ruleKey === 'string') ruleRefs.push({ skillKey: item.skillKey, ruleKey });
    }
    listSummaries.push({ skillKey: item.skillKey, status: item.response.status, count: keys.length, ruleKeys: keys });
  }
  const refCounts = new Map();
  for (const ref of ruleRefs) {
    const refKey = ruleRefKey(ref.skillKey, ref.ruleKey);
    refCounts.set(refKey, (refCounts.get(refKey) || 0) + 1);
  }
  for (const [refKey, count] of refCounts) if (count > 1) duplicateRuleRefs.push(refKey);
  check(checks, 'ruleScan', '1062个技能触发规则列表均为200数组且引用无重复', () => {
    assert(listResponses.length === 1062, `规则列表请求数不是1062，实际 ${listResponses.length}`);
    assert(listFailures.length === 0, `规则列表失败或形状异常：${JSON.stringify(listFailures.slice(0, 10))}`);
    assert(duplicateRuleRefs.length === 0, `规则引用重复：${duplicateRuleRefs.join(',')}`);
  }, { listGetCount: listResponses.length, failedListCount: listFailures.length, duplicateRuleRefs: duplicateRuleRefs.slice(0, 20) });

  const uniqueRefs = [...new Map(ruleRefs.map((ref) => [ruleRefKey(ref.skillKey, ref.ruleKey), ref])).values()]
    .sort((a, b) => ruleRefKey(a.skillKey, a.ruleKey).localeCompare(ruleRefKey(b.skillKey, b.ruleKey)));
  const detailResponses = await mapLimit(uniqueRefs, 24, async (ref) => ({
    ...ref,
    response: await get(`/skills/${encodeKey(ref.skillKey)}/trigger-rules/${encodeKey(ref.ruleKey)}`)
  }));
  const baselineRules = baselineRuleMap(baseline);
  const expectedNewRules = expectedTargetRuleBodies(frozen);
  const expectedOldKeys = new Set((baseline?.preservation?.existingRuleKeys || [...baselineRules.keys()]).map(String));
  const expectedNewKeys = new Set(expectedNewRules.keys());
  const expectedAllKeys = new Set([...expectedOldKeys, ...expectedNewKeys]);
  const actualRuleKeys = new Set(uniqueRefs.map((ref) => ruleRefKey(ref.skillKey, ref.ruleKey)));
  const missingKeys = [...expectedAllKeys].filter((key) => !actualRuleKeys.has(key)).sort();
  const unexpectedKeys = [...actualRuleKeys].filter((key) => !expectedAllKeys.has(key)).sort();
  const detailChecks = [];
  const actualRuleData = new Map();
  let oldMatched = 0;
  let newMatched = 0;
  let sourceInitializedCount = 0;
  for (const item of detailResponses) {
    const refKey = ruleRefKey(item.skillKey, item.ruleKey);
    const expectedOld = baselineRules.get(refKey);
    const expectedNew = expectedNewRules.get(refKey);
    const kind = expectedOld ? 'existing' : expectedNew ? 'new' : 'unexpected';
    const record = { skillKey: item.skillKey, ruleKey: item.ruleKey, kind, status: item.response.status, passed: false };
    try {
      assert(item.response.status === 200, `规则详情状态不是200，实际 ${item.response.status}`);
      if (expectedOld) {
        const difference = diff(expectedOld, item.response.data);
        assert(!difference, `旧规则与04详情不一致：${JSON.stringify(difference)}`);
        oldMatched += 1;
      } else if (expectedNew) {
        const difference = subsetDiff(item.response.data, expectedNew);
        assert(!difference, `新增规则与02冻结体不一致：${JSON.stringify(difference)}`);
        newMatched += 1;
      } else {
        throw new Error('规则键不在04旧集合或02新增集合');
      }
      actualRuleData.set(refKey, item.response.data);
      if (item.response.data?.eventSource?.eventType === 'SOURCE_INITIALIZED') sourceInitializedCount += 1;
      record.passed = true;
    } catch (error) {
      record.message = scrub(error?.message ?? error);
      failures.push({ scope: 'ruleDetails', ...record });
    }
    detailChecks.push(record);
  }
  for (const key of missingKeys) addFailure('ruleScan', '规则键缺失', { ref: key });
  for (const key of unexpectedKeys) addFailure('ruleScan', '发现冻结集合之外的规则键', { ref: key });
  check(checks, 'ruleScan', '规则键集合恰为04旧94条加两条新增规则', () => {
    assert(expectedOldKeys.size === 94, `04旧规则集合不是94条，实际 ${expectedOldKeys.size}`);
    assert(expectedNewKeys.size === 2, `02新增规则集合不是2条，实际 ${expectedNewKeys.size}`);
    assert(uniqueRefs.length === 96, `当前规则总数不是96，实际 ${uniqueRefs.length}`);
    assert(missingKeys.length === 0, `缺失规则：${missingKeys.join(',')}`);
    assert(unexpectedKeys.length === 0, `额外规则：${unexpectedKeys.join(',')}`);
  }, {
    skillCount: sortedSkillKeys.length,
    ruleCount: uniqueRefs.length,
    expectedRuleCount: expectedAllKeys.size,
    missingKeys,
    unexpectedKeys,
    ruleKeysSha256: sha256Value([...actualRuleKeys].sort())
  });
  check(checks, 'ruleScan', '旧94条规则详情逐对象严格一致', () => {
    assert(oldMatched === 94, `严格匹配旧规则数不是94，实际 ${oldMatched}`);
  }, { expected: 94, matched: oldMatched });
  check(checks, 'ruleScan', '两条新增规则按冻结体字段、数组长度和顺序核对', () => {
    assert(newMatched === 2, `严格核对新增规则数不是2，实际 ${newMatched}`);
  }, { expected: 2, matched: newMatched });
  check(checks, 'ruleScan', 'SOURCE_INITIALIZED仍为24条', () => {
    assert(sourceInitializedCount === 24, `SOURCE_INITIALIZED数量不是24，实际 ${sourceInitializedCount}`);
  }, { expected: 24, actual: sourceInitializedCount });

  return {
    checks,
    skillsResponse,
    listResponses,
    listSummaries,
    detailResponses,
    actualRuleData,
    sourceInitializedCount,
    uniqueRefs,
    expectedOldKeys,
    expectedNewKeys,
    actualRuleKeys,
    missingKeys,
    unexpectedKeys,
    oldMatched,
    newMatched,
    listFailures,
    duplicateRuleRefs,
    detailChecks
  };
}

function findComponentData(targetResult, apiName, key) {
  return targetResult?.actual?.components?.[apiName]?.detailData?.get(key) || null;
}

function runMechanismChecks(ruleScan, targetResults) {
  const checks = report.mechanismChecks;
  const olafRule = ruleScan.actualRuleData.get('olaf_w/on_used');
  const garenRule = ruleScan.actualRuleData.get('garen_r/on_hit');
  check(checks, 'mechanism', '奥拉夫 on_used 为主动使用并唯一启动cast', () => {
    assert(olafRule?.ruleKey === 'on_used', '规则键不是on_used');
    assert(olafRule?.eventSource?.eventType === 'SKILL_USED', '事件类型不是SKILL_USED');
    assert(olafRule?.eventSource?.detail?.sourceSkillKey === 'olaf_w', 'sourceSkillKey不是olaf_w');
    assert(olafRule?.eventSource?.detail?.useKind === 'ACTIVE', 'useKind不是ACTIVE');
    assert(Array.isArray(olafRule.conditionGroups) && olafRule.conditionGroups.length === 0, '奥拉夫规则条件组不是空数组');
    assert(Array.isArray(olafRule.actions) && olafRule.actions.length === 1, '奥拉夫规则动作不是唯一一项');
    const action = olafRule.actions[0];
    assert(action.actionType === 'START_PROCESS' && action.detail?.processKey === 'cast', '奥拉夫动作不是START_PROCESS cast');
    assert(action.targetContext === 'CURRENT_TARGET', '奥拉夫动作目标不是CURRENT_TARGET');
  }, {
    eventType: olafRule?.eventSource?.eventType ?? null,
    sourceSkillKey: olafRule?.eventSource?.detail?.sourceSkillKey ?? null,
    useKind: olafRule?.eventSource?.detail?.useKind ?? null,
    conditionGroupCount: olafRule?.conditionGroups?.length ?? null,
    actionCount: olafRule?.actions?.length ?? null,
    actionType: olafRule?.actions?.[0]?.actionType ?? null,
    processKey: olafRule?.actions?.[0]?.detail?.processKey ?? null,
    targetContext: olafRule?.actions?.[0]?.targetContext ?? null
  });
  check(checks, 'mechanism', '盖伦 on_hit 为英雄命中并唯一执行justice_damage', () => {
    assert(garenRule?.ruleKey === 'on_hit', '规则键不是on_hit');
    assert(garenRule?.eventSource?.eventType === 'SKILL_HIT', '事件类型不是SKILL_HIT');
    assert(garenRule?.eventSource?.detail?.sourceSkillKey === 'garen_r', 'sourceSkillKey不是garen_r');
    assert(Array.isArray(garenRule.conditionGroups) && garenRule.conditionGroups.length === 1, '盖伦规则条件组不是唯一一组');
    const group = garenRule.conditionGroups[0];
    assert(Array.isArray(group.conditions) && group.conditions.length === 1, '盖伦条件不是唯一一项');
    const condition = group.conditions[0];
    assert(condition.conditionType === 'TARGET_CATEGORY_CHECK', '盖伦条件类型错误');
    assert(diff(condition.detail?.categories, ['CHAMPION']) === null, '盖伦目标类别不是唯一CHAMPION');
    assert(Array.isArray(garenRule.actions) && garenRule.actions.length === 1, '盖伦规则动作不是唯一一项');
    const action = garenRule.actions[0];
    assert(action.actionType === 'EXECUTE_EFFECT' && action.detail?.effectKey === 'justice_damage', '盖伦动作不是EXECUTE_EFFECT justice_damage');
    assert(action.targetContext === 'CURRENT_TARGET', '盖伦动作目标不是CURRENT_TARGET');
  }, {
    eventType: garenRule?.eventSource?.eventType ?? null,
    sourceSkillKey: garenRule?.eventSource?.detail?.sourceSkillKey ?? null,
    conditionGroupCount: garenRule?.conditionGroups?.length ?? null,
    conditionType: garenRule?.conditionGroups?.[0]?.conditions?.[0]?.conditionType ?? null,
    categories: garenRule?.conditionGroups?.[0]?.conditions?.[0]?.detail?.categories ?? null,
    actionCount: garenRule?.actions?.length ?? null,
    actionType: garenRule?.actions?.[0]?.actionType ?? null,
    effectKey: garenRule?.actions?.[0]?.detail?.effectKey ?? null,
    targetContext: garenRule?.actions?.[0]?.targetContext ?? null
  });

  const olafProcess = findComponentData(targetResults.get('olaf_w'), 'processes', 'cast');
  const olafParameters = targetResults.get('olaf_w')?.actual?.components?.parameters?.detailData;
  const olafEffects = targetResults.get('olaf_w')?.actual?.components?.effects?.detailData;
  check(checks, 'mechanism', '奥拉夫cast已有法力、冷却、护盾和攻速组成', () => {
    assert(olafProcess?.cooldown?.durationValue?.parameterKey === 'cooldown_ms', 'cast没有绑定cooldown_ms');
    assert(Array.isArray(olafProcess?.effectBindings) && olafProcess.effectBindings.length === 3, 'cast效果绑定不是3项');
    assert(diff(olafProcess.effectBindings.map((binding) => binding.effectKey), ['mana_cost', 'cast_shield', 'attack_speed']) === null,
      'cast效果绑定顺序不是法力、护盾、攻速');
    assert(olafParameters?.has('mana_cost') && olafParameters?.has('cooldown_ms'), '奥拉夫缺少法力或冷却参数');
    assert(olafEffects?.has('mana_cost') && olafEffects?.has('cast_shield') && olafEffects?.has('attack_speed'), '奥拉夫缺少法力、护盾或攻速效果');
  }, {
    cooldownParameter: olafProcess?.cooldown?.durationValue?.parameterKey ?? null,
    effectBindings: olafProcess?.effectBindings?.map((binding) => binding.effectKey) ?? null,
    parameterKeys: olafParameters ? [...olafParameters.keys()] : [],
    effectKeys: olafEffects ? [...olafEffects.keys()] : []
  });

  const garenFormula = findComponentData(targetResults.get('garen_r'), 'formulas', 'damage');
  const garenEffect = findComponentData(targetResults.get('garen_r'), 'effects', 'justice_damage');
  check(checks, 'mechanism', '盖伦damage公式和justice_damage真实伤害结果仍在', () => {
    assert(garenFormula?.formulaKey === 'damage', '盖伦damage公式缺失');
    assert(garenFormula?.expression?.operation === 'ADD', '盖伦damage公式不是加法');
    assert(garenFormula.expression.operands?.[0]?.parameterKey === 'base_damage', '盖伦公式缺少base_damage');
    const damageOperand = garenFormula.expression.operands?.[1];
    assert(damageOperand?.operation === 'MULTIPLY', '盖伦公式缺少乘法项');
    assert(damageOperand.operands?.[0]?.attributeOwner === 'TARGET' && damageOperand.operands?.[0]?.attributeValueKind === 'MISSING', '盖伦公式不是目标已损失生命');
    assert(damageOperand.operands?.[1]?.parameterKey === 'missing_hp_ratio', '盖伦公式缺少missing_hp_ratio');
    assert(garenEffect?.effectKey === 'justice_damage', 'justice_damage效果缺失');
    assert(Array.isArray(garenEffect.results) && garenEffect.results.length === 1, 'justice_damage没有唯一结果');
    const result = garenEffect.results[0];
    assert(result.resultKey === 'damage' && result.resultType === 'DAMAGE', 'justice_damage结果键或类型错误');
    assert(result.detail?.damageTypeKey === 'real' && result.detail?.originKind === 'DIRECT' && result.detail?.deliveryKind === 'SKILL', 'justice_damage不是真实直接技能伤害');
    assert(result.valueRule?.value?.formulaKey === 'damage' && result.target === 'TARGET', 'justice_damage没有绑定damage公式和目标');
  }, {
    formulaKey: garenFormula?.formulaKey ?? null,
    formulaOperation: garenFormula?.expression?.operation ?? null,
    effectKey: garenEffect?.effectKey ?? null,
    resultKey: garenEffect?.results?.[0]?.resultKey ?? null,
    resultType: garenEffect?.results?.[0]?.resultType ?? null,
    damageTypeKey: garenEffect?.results?.[0]?.detail?.damageTypeKey ?? null,
    formulaBinding: garenEffect?.results?.[0]?.valueRule?.value?.formulaKey ?? null
  });
}

async function main() {
  report.inputFiles = collectInputHashes();
  const frozen = readJson('02-冻结请求.json');
  const sourceSnapshot = readJson('03-来源快照.json');
  const baseline = readJson('04-写入前现值.json');
  const review = readJson('05-Cursor独立评审.json');
  const writeReport = readJson('06-写入与即时回读.json');
  const baselineRuleKeys = new Set((baseline.preservation?.existingRuleKeys || []).map(String));
  const expectedNewRuleBodies = expectedTargetRuleBodies(frozen);

  check(report.staticChecks, 'static', '冻结请求、写入报告和04基线前置条件', () => {
    assert(frozen.status === 'READY_FOR_INDEPENDENT_REVIEW' && frozen.writable === true, '02冻结请求不是可评审状态');
    assert(frozen.expectedCurrent?.skillCount === 1062 && frozen.expectedCurrent?.ruleCount === 94 && frozen.expectedCurrent?.sourceInitializedCount === 24, '02预期基线计数错误');
    assert(frozen.plannedWrites === 2 && frozen.writes?.length === 2 && expectedNewRuleBodies.size === 2, '02不是两条新增规则');
    assert(review.verdict === 'READY' && review.requestAudit?.businessWriteMethodsFound === 0 && review.apiWrites === 0, '05独立评审未READY或含写入');
    assert(writeReport.status === 'PASS' && writeReport.businessWriteCount === 2 && writeReport.writeCount === 2, '06写入报告不是PASS且写入数不是2');
    const final = writeReport.finalReadback?.[0];
    assert(final?.skillCount === 1062 && final?.ruleCount === 96 && final?.sourceInitializedCount === 24, '06终态回读计数不符');
    assert(baseline.businessWrites === 0 && baseline.preservation?.existingRuleCount === 94 && baselineRuleKeys.size === 94, '04基线规则集合不是94条');
    assert(diff([...baseline.preservation.expectedNewRuleKeys].sort(), [...expectedNewRuleBodies.keys()].sort()) === null, '02新增键与04预期新增键不一致');
  }, {
    frozenStatus: frozen.status,
    reviewVerdict: review.verdict,
    writeStatus: writeReport.status,
    writeCount: writeReport.businessWriteCount,
    baselineRuleCount: baselineRuleKeys.size,
    expectedNewRuleKeys: [...expectedNewRuleBodies.keys()].sort()
  });

  const ruleScan = await scanAllRules(baseline, frozen);
  const targetResults = new Map();
  const targetSummaries = [];
  const baselineTargets = baselineTargetMap(baseline);
  for (const target of targets) {
    const result = await readTarget(target, baselineTargets.get(target.skillKey), sourceSnapshot);
    targetResults.set(target.skillKey, result);
    targetSummaries.push(result.summary);
  }
  runMechanismChecks(ruleScan, targetResults);

  report.ruleScan = {
    expected: {
      skillCount: 1062,
      ruleListGetCount: 1062,
      oldRuleCount: 94,
      newRuleCount: 2,
      totalRuleCount: 96,
      sourceInitializedCount: 24
    },
    actual: {
      skillCount: ruleScan.uniqueRefs.length ? ruleScan.skillsResponse.status === 200 ? rows(ruleScan.skillsResponse.data)?.length ?? 0 : 0 : rows(ruleScan.skillsResponse.data)?.length ?? 0,
      ruleListGetCount: ruleScan.listResponses.length,
      ruleDetailGetCount: ruleScan.detailResponses.length,
      totalRuleCount: ruleScan.uniqueRefs.length,
      oldRulesMatched: ruleScan.oldMatched,
      newRulesMatched: ruleScan.newMatched,
      sourceInitializedCount: ruleScan.sourceInitializedCount,
      ruleKeysSha256: sha256Value([...ruleScan.actualRuleKeys].sort()),
      oldRuleKeysSha256: sha256Value([...ruleScan.expectedOldKeys].sort()),
      newRuleKeys: [...ruleScan.expectedNewKeys].sort()
    },
    checks: ruleScan.checks,
    detailChecks: ruleScan.detailChecks,
    failedRuleLists: ruleScan.listFailures,
    duplicateRuleRefs: ruleScan.duplicateRuleRefs,
    missingKeys: ruleScan.missingKeys,
    unexpectedKeys: ruleScan.unexpectedKeys
  };
  report.targetReadback = {
    targetCount: targetSummaries.length,
    targets: targetSummaries.map((summary) => ({
      skillKey: summary.skillKey,
      hero: summary.hero,
      subjectStatus: summary.subjectStatus,
      relationStatus: summary.relationStatus,
      representativeImageStatus: summary.representativeImageStatus,
      sourceImage: summary.sourceImage,
      components: Object.fromEntries(Object.entries(summary.components).map(([kind, value]) => [kind, {
        listStatus: value.listStatus,
        expectedCount: value.expectedCount,
        actualCount: value.actualCount,
        detailExpected: value.detailExpected,
        detailRead: value.detailRead,
        detailMatched: value.detailMatched,
        keysMatch: diff(value.expectedKeys, value.actualKeys) === null,
        passedChecks: value.checks.filter((item) => item.passed).length,
        totalChecks: value.checks.length
      }]))
    })),
    checks: targetSummaries.flatMap((summary) => summary.checks)
  };
  report.targetSummaries = [
    {
      skillKey: 'olaf_w',
      summary: '主体、奥拉夫角色技能关系、代表图片、参数/公式/效果/过程/内部状态列表及详情均按04严格回读；on_used主动启动cast。',
      representativeImage: targetSummaries.find((item) => item.skillKey === 'olaf_w')?.sourceImage || null
    },
    {
      skillKey: 'garen_r',
      summary: '主体、盖伦角色技能关系、代表图片、参数/公式/效果/过程/内部状态列表及详情均按04严格回读；on_hit命中英雄后执行justice_damage。',
      representativeImage: targetSummaries.find((item) => item.skillKey === 'garen_r')?.sourceImage || null
    }
  ];
  report.requestSummary = callSummary();
  report.getCount = report.requestSummary.totalGets;
  report.businessWrites = calls.filter((call) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(call.method)).length;
  report.businessWriteCount = report.businessWrites;
  report.apiWrites = report.businessWrites;
  report.findings = failures.map((failure) => ({
    scope: failure.scope,
    name: failure.name,
    message: failure.message,
    ...(failure.ref ? { ref: failure.ref } : {}),
    ...(failure.skillKey ? { skillKey: failure.skillKey } : {}),
    ...(failure.ruleKey ? { ruleKey: failure.ruleKey } : {})
  }));
  report.mismatches = failures.length;
  report.passed = failures.length === 0 &&
    report.requestSummary.allRequestsWereGET &&
    report.requestSummary.failedRequests.length === 0 &&
    report.businessWrites === 0 &&
    report.ruleScan.actual.totalRuleCount === 96 &&
    report.ruleScan.actual.sourceInitializedCount === 24;
  report.status = report.passed ? 'PASS' : 'FAIL';
}

function persist() {
  report.completedAt = report.completedAt || new Date().toISOString();
  report.requestSummary = report.requestSummary || callSummary();
  report.getCount = report.requestSummary.totalGets;
  report.businessWrites = calls.filter((call) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(call.method)).length;
  report.businessWriteCount = report.businessWrites;
  report.apiWrites = report.businessWrites;
  report.mismatches = failures.length;
  report.findings = failures.map((failure) => ({
    scope: failure.scope,
    name: failure.name,
    message: scrub(failure.message),
    ...(failure.ref ? { ref: failure.ref } : {}),
    ...(failure.skillKey ? { skillKey: failure.skillKey } : {}),
    ...(failure.ruleKey ? { ruleKey: failure.ruleKey } : {})
  }));
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

try {
  await main();
} catch (error) {
  report.status = 'FAIL';
  report.passed = false;
  report.error = { message: scrub(error?.message ?? error) };
  failures.push({ scope: 'fatal', message: report.error.message });
} finally {
  report.completedAt = new Date().toISOString();
  report.methodPolicy = 'GET_ONLY';
  report.authorizationValueRecorded = false;
  persist();
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    passed: report.passed,
    methodPolicy: report.methodPolicy,
    businessWrites: report.businessWrites,
    apiWrites: report.apiWrites,
    gets: report.getCount,
    rules: report.ruleScan?.actual?.totalRuleCount ?? null,
    mismatches: report.mismatches,
    targets: report.targetSummaries.map((target) => target.skillKey),
    output: outputPath
  }, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

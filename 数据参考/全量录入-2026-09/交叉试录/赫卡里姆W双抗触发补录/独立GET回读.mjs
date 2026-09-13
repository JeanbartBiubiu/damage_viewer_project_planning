import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildRule, expectedCurrent, sourceFiles, target } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const outputPath = name => path.join(here, name);
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
const approvedBatchSha256 = '1c614bb258283f36852de2365064fc98f44bd7db4390548201788de4d1518092';
const frozenBodySha256 = 'cf78066c1eb4222cd7da01cdd15e8627f0134867f8720b234f91bfe15001ae5c';

const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey']
];

let getCount = 0;
const statusCounts = {};
const transportErrors = [];
const differences = [];
const issues = [];

const jsonText = value => JSON.stringify(value, null, 2) + '\n';
const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : value;
const shaValue = value => {
  const text = JSON.stringify(stable(value));
  return shaBytes(Buffer.from(text === undefined ? 'undefined' : text, 'utf8'));
};
const fileSha = filePath => shaBytes(fs.readFileSync(filePath));
const equal = (left, right) => isDeepStrictEqual(stable(left), stable(right));
const readJson = name => JSON.parse(fs.readFileSync(outputPath(name), 'utf8'));
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key]]));
const ruleId = (skillKey, ruleKey) => skillKey + '/' + ruleKey;
const targetRuleId = ruleId(target.skillKey, target.ruleKey);

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function recordIssue(message, details = {}) {
  issues.push({ message, ...details });
}

function compareDeep(label, expected, actual) {
  if (equal(expected, actual)) return true;
  differences.push({
    kind: label,
    expectedSha256: shaValue(expected),
    actualSha256: actual === undefined ? null : shaValue(actual)
  });
  return false;
}

function compareSet(label, expectedValues, actualValues) {
  const expected = new Set(expectedValues);
  const actual = new Set(actualValues);
  const missing = [...expected].filter(value => !actual.has(value)).sort();
  const unexpected = [...actual].filter(value => !expected.has(value)).sort();
  if (missing.length === 0 && unexpected.length === 0) return true;
  differences.push({ kind: label, missing, unexpected });
  return false;
}

function normalizeStoredRule(value) {
  return pick(value, [
    'ruleKey',
    'name',
    'description',
    'sortOrder',
    'eventSource',
    'conditionGroups',
    'actions',
    'perTargetCooldown',
    'maxTriggersPerProcess'
  ]);
}

function loadInputs() {
  const freeze = readJson('02-冻结请求.json');
  const source = readJson('03-来源散列快照.json');
  const baseline = readJson('04-共享写前现值.json');
  const preparation = readJson('05-只读准备报告.json');
  const writeEvidence = readJson('06-写入与即时回读.json');
  const configPath = outputPath('批次配置.mjs');
  const executorPath = outputPath('批次执行.mjs');

  const freezeBase = { ...freeze };
  delete freezeBase.batchSha256;
  ensure(freeze.batchSha256 === approvedBatchSha256, '冻结批次散列不是批准值');
  ensure(shaValue(freezeBase) === freeze.batchSha256, '冻结批次散列校验失败');
  ensure(freeze.configSha256 === fileSha(configPath), '批次配置散列已变化');
  ensure(freeze.executorSha256 === fileSha(executorPath), '批次执行器散列已变化');
  ensure(freeze.request?.route === '/skills/' + target.skillKey + '/trigger-rules', '冻结请求路径不符');
  ensure(shaValue(freeze.request.body) === freeze.request.bodySha256, '冻结正文散列校验失败');
  ensure(freeze.request.bodySha256 === frozenBodySha256, '冻结正文不是批准值');
  ensure(equal(freeze.expectedCurrent, expectedCurrent), '冻结计数与批次配置不一致');

  ensure(shaValue(source) === freeze.sourceSnapshotSha256, '来源散列快照与冻结不一致');
  ensure(source.schemaVersion === 1, '来源散列快照版本不符');
  ensure(source.objectPath === 'skills.' + target.skillKey, '来源对象路径不符');
  ensure(Array.isArray(source.files) && source.files.length === sourceFiles.length, '来源文件散列数量不符');

  ensure(equal(baseline.expectedCurrent, expectedCurrent), '写前基线计数与批次配置不一致');
  ensure(baseline.methodPolicy === 'GET_ONLY', '写前基线方法策略不符');
  ensure(baseline.authorizationValueRecorded === false, '写前基线不应记录令牌');
  ensure(Array.isArray(baseline.global?.skillKeys), '写前基线技能目录缺失');
  ensure(Array.isArray(baseline.global?.ruleRefs), '写前基线规则引用缺失');
  ensure(Array.isArray(baseline.global?.ruleDetails), '写前基线规则详情缺失');
  ensure(baseline.global.ruleRefs.length === expectedCurrent.ruleCount, '写前基线规则数不符');
  ensure(baseline.global.ruleDetails.length === expectedCurrent.ruleCount, '写前基线规则详情数不符');
  ensure(Array.isArray(baseline.target?.ruleState?.keys) && baseline.target.ruleState.keys.length === 0, '写前目标规则列表不为空');
  ensure(baseline.target?.ruleState?.candidate?.status === 404, '写前目标规则详情不是404');

  ensure(preparation.status === 'READY_FOR_MAIN_REVIEW', '只读准备报告状态不符');
  ensure(preparation.methodPolicy === 'GET_ONLY', '只读准备报告方法策略不符');
  ensure(preparation.postCount === 0, '只读准备报告记录了业务写入');
  ensure(preparation.businessWrites === 0, '只读准备报告业务写入不为零');
  ensure(preparation.skillCount === expectedCurrent.skillCount, '只读准备报告技能数不符');
  ensure(preparation.ruleCount === expectedCurrent.ruleCount, '只读准备报告规则数不符');
  ensure(preparation.sourceInitializedCount === expectedCurrent.sourceInitializedCount, '只读准备报告来源初始化数不符');
  ensure(preparation.candidateStatus === 404, '只读准备报告候选状态不符');
  ensure(preparation.baselineSha256 === shaValue(baseline), '只读准备报告基线散列不符');
  ensure(preparation.sourceSnapshotSha256 === shaValue(source), '只读准备报告来源散列不符');
  ensure(preparation.frozenBatchSha256 === freeze.batchSha256, '只读准备报告批准批次不符');
  ensure(preparation.targetNonRuleSnapshotSha256 === shaValue(baseline.target.nonRule), '只读准备报告目标非规则散列不符');

  ensure(writeEvidence.status === 'PASS', '写入与即时回读报告不是PASS');
  ensure(writeEvidence.approvedBatchSha256 === freeze.batchSha256, '即时回读批准批次不符');
  ensure(writeEvidence.postCount === 1, '即时回读报告未记录恰好一次业务写入');
  ensure(writeEvidence.replayedWrites === 0, '即时回读报告记录了重放写入');
  ensure(writeEvidence.recoveryReadPerformed === false, '即时回读报告记录了恢复读');
  ensure(writeEvidence.candidateBeforeStatus === 404, '即时回读写前候选状态不符');
  ensure(writeEvidence.targetNonRuleSnapshotSha256 === shaValue(baseline.target.nonRule), '即时回读目标非规则散列不符');
  ensure(writeEvidence.bodySha256 === frozenBodySha256, '即时回读正文散列不符');
  ensure(writeEvidence.immediateReadback?.status === 200, '即时回读详情不是200');
  ensure(equal(normalizeStoredRule(writeEvidence.immediateReadback.data), freeze.request.body), '即时回读正文与冻结正文不一致');

  return {
    freeze,
    source,
    baseline,
    preparation,
    writeEvidence,
    hashes: {
      batchSha256: freeze.batchSha256,
      frozenBodySha256: freeze.request.bodySha256,
      sourceSnapshotSha256: shaValue(source),
      baselineSha256: shaValue(baseline),
      preparationSha256: shaValue(preparation),
      writeEvidenceSha256: shaValue(writeEvidence),
      configSha256: fileSha(configPath),
      executorSha256: fileSha(executorPath)
    }
  };
}

function parseResponse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { parseError: true, responseBytes: Buffer.byteLength(raw) };
  }
}

async function get(route) {
  getCount += 1;
  try {
    const response = await fetch(baseUrl + route, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(30_000)
    });
    const raw = await response.text();
    const data = parseResponse(raw);
    const status = String(response.status);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    return { method: 'GET', route, status: response.status, data };
  } catch (error) {
    transportErrors.push({
      route,
      message: error instanceof Error ? error.message : String(error)
    });
    return { method: 'GET', route, status: null, data: null, transportError: true };
  }
}

async function getMany(routes, concurrency = 24) {
  const results = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= routes.length) return;
      results[index] = await get(routes[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker()));
  return results;
}

function requireStatus(response, context, expected = 200) {
  ensure(response && response.status === expected, context + ' 预期' + expected + '，实际' + (response?.status ?? '网络失败'));
}

function arrayData(response, context) {
  requireStatus(response, context);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(context + ' 没有数组结果');
}

function sortedUnique(values, context) {
  ensure(Array.isArray(values), context + '不是数组');
  ensure(values.every(value => typeof value === 'string' && value.length > 0), context + '存在空键');
  const sorted = [...values].sort();
  ensure(new Set(sorted).size === sorted.length, context + '存在重复键');
  return sorted;
}

function targetRoutes() {
  const skill = '/skills/' + encodeURIComponent(target.skillKey);
  const owner = '/characters/' + encodeURIComponent(target.ownerKey);
  return {
    skill,
    static: {
      subject: skill,
      owner,
      ownerAttributes: owner + '/attributes',
      ownerRepresentativeImage: owner + '/representative-image',
      relationByOwner: '/character-skill-relations?characterKey=' + encodeURIComponent(target.ownerKey),
      relationBySkill: '/character-skill-relations?skillKey=' + encodeURIComponent(target.skillKey),
      skillRepresentativeImage: skill + '/representative-image'
    }
  };
}

function relationItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

async function readTargetNonRule() {
  const routes = targetRoutes();
  const staticData = {};
  for (const [name, route] of Object.entries(routes.static)) {
    const response = await get(route);
    requireStatus(response, target.name + ' ' + route);
    staticData[name] = response.data;
  }

  ensure(staticData.subject?.skillKey === target.skillKey, '技能主体键不符');
  ensure(staticData.owner?.characterKey === target.ownerKey, '角色主体键不符');
  const relationMatch = item => item.characterKey === target.ownerKey && item.skillKey === target.skillKey;
  ensure(relationItems(staticData.relationByOwner).some(relationMatch), '正向角色技能关系缺失');
  ensure(relationItems(staticData.relationBySkill).some(relationMatch), '反向角色技能关系缺失');
  for (const key of ['ownerRepresentativeImage', 'skillRepresentativeImage']) {
    ensure(staticData[key]?.image?.enabled === true, key + '代表图不可用');
  }

  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const listRoute = routes.skill + '/' + apiName;
    const listResponse = await get(listRoute);
    const items = arrayData(listResponse, target.name + ' ' + apiName);
    const keys = sortedUnique(items.map(item => item[keyName]), target.name + ' ' + apiName);
    const details = await getMany(keys.map(key => listRoute + '/' + encodeURIComponent(key)));
    details.forEach((response, index) => requireStatus(response, apiName + '/' + keys[index]));
    components[apiName] = {
      list: listResponse.data,
      keys,
      details: details.map((response, index) => ({ key: keys[index], data: response.data }))
    };
  }
  return { static: staticData, components };
}

async function scanGlobalRules(expectedRuleCount) {
  const skillsResponse = await get('/skills');
  const skills = arrayData(skillsResponse, '技能目录');
  const skillKeys = sortedUnique(skills.map(item => item.skillKey), '技能目录');
  ensure(skillKeys.length === expectedCurrent.skillCount, '技能总数不符：' + skillKeys.length);
  if (typeof skillsResponse.data?.total === 'number') {
    ensure(skillsResponse.data.total === skillKeys.length, '技能目录total不符');
  }

  const listResponses = await getMany(skillKeys.map(skillKey => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules'));
  const lists = listResponses.map((response, index) => {
    const skillKey = skillKeys[index];
    const rules = arrayData(response, skillKey + ' 规则列表');
    const ruleKeys = sortedUnique(rules.map(item => item.ruleKey), skillKey + ' 规则列表');
    return { skillKey, data: response.data, ruleKeys };
  });

  const refs = lists
    .flatMap(item => item.ruleKeys.map(ruleKey => ({ skillKey: item.skillKey, ruleKey })))
    .sort((left, right) => ruleId(left.skillKey, left.ruleKey).localeCompare(ruleId(right.skillKey, right.ruleKey)));
  const refIds = refs.map(item => ruleId(item.skillKey, item.ruleKey));
  ensure(new Set(refIds).size === refIds.length, '当前规则引用存在重复');
  ensure(refs.length === expectedRuleCount, '规则总数不符：' + refs.length);

  const detailResponses = await getMany(refs.map(item => '/skills/' + encodeURIComponent(item.skillKey) + '/trigger-rules/' + encodeURIComponent(item.ruleKey)));
  detailResponses.forEach((response, index) => requireStatus(response, ruleId(refs[index].skillKey, refs[index].ruleKey) + '详情'));
  const details = detailResponses.map((response, index) => ({ ...refs[index], data: response.data }));
  const eventTypeCounts = details.reduce((counts, item) => {
    const eventType = item.data?.eventSource?.eventType;
    if (eventType) counts[eventType] = (counts[eventType] || 0) + 1;
    return counts;
  }, {});
  ensure((eventTypeCounts.SOURCE_INITIALIZED || 0) === expectedCurrent.sourceInitializedCount, '来源初始化规则数不符');
  return { skills: skillsResponse.data, skillKeys, lists, refs, details, eventTypeCounts };
}

function validateBaselineShape(baseline) {
  const refs = baseline.global.ruleRefs;
  const refIds = refs.map(item => ruleId(item.skillKey, item.ruleKey));
  ensure(refIds.length === expectedCurrent.ruleCount, '写前规则引用数量不符');
  ensure(new Set(refIds).size === refIds.length, '写前规则引用存在重复');
  const detailIds = baseline.global.ruleDetails.map(item => ruleId(item.skillKey, item.ruleKey));
  ensure(detailIds.length === expectedCurrent.ruleCount, '写前规则详情数量不符');
  ensure(new Set(detailIds).size === detailIds.length, '写前规则详情存在重复');
  compareSet('写前引用与详情键集合', refIds, detailIds);
  ensure(baseline.global.skillKeys.length === expectedCurrent.skillCount, '写前技能目录数量不符');
}

function compareReadbackToBaseline(inputs, global, nonRule) {
  const { baseline, freeze } = inputs;
  validateBaselineShape(baseline);

  compareSet('技能目录键集合', baseline.global.skillKeys, global.skillKeys);

  const baselineRefs = baseline.global.ruleRefs;
  const currentRefs = global.refs;
  const baselineIds = baselineRefs.map(item => ruleId(item.skillKey, item.ruleKey));
  const currentIds = currentRefs.map(item => ruleId(item.skillKey, item.ruleKey));
  compareSet('最终规则键集合', [...baselineIds, targetRuleId], currentIds);

  const baselineDetails = new Map(
    baseline.global.ruleDetails.map(item => [ruleId(item.skillKey, item.ruleKey), item])
  );
  const currentDetails = new Map(
    global.details.map(item => [ruleId(item.skillKey, item.ruleKey), item])
  );
  for (const [id, expected] of baselineDetails) {
    compareDeep('旧规则详情/' + id, expected, currentDetails.get(id));
  }

  const baselineLists = new Map(baseline.global.ruleLists.map(item => [item.skillKey, item]));
  for (const actual of global.lists) {
    if (actual.skillKey === target.skillKey) continue;
    compareDeep('旧技能规则列表/' + actual.skillKey, baselineLists.get(actual.skillKey), actual);
  }
  const targetList = global.lists.find(item => item.skillKey === target.skillKey);
  ensure(targetList, '当前技能目录缺少目标技能规则列表');
  compareSet('目标技能规则键', [target.ruleKey], targetList.ruleKeys);

  const actualNew = currentDetails.get(targetRuleId);
  ensure(actualNew, '最终规则详情缺少 ' + targetRuleId);
  const normalizedNew = normalizeStoredRule(actualNew.data);
  compareDeep('新规则冻结正文', freeze.request.body, normalizedNew);
  ensure(shaValue(normalizedNew) === frozenBodySha256, '新规则规范化散列不符');

  compareDeep('目标非规则组成', baseline.target.nonRule, nonRule);

  if (differences.length > 0) {
    throw new Error('独立回读发现' + differences.length + '项差异');
  }
  return {
    targetList,
    actualNew,
    normalizedNew,
    baselineRuleDetailsCompared: baselineDetails.size,
    oldRuleDetailDifferenceCount: 0,
    targetNonRuleMatches: true
  };
}

function writeReport(report) {
  fs.writeFileSync(outputPath('07-独立GET回读.json'), jsonText(report), { encoding: 'utf8', flag: 'wx' });
}

function baseReport(inputs = null) {
  return {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    status: 'STARTED',
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    businessWrites: 0,
    getCount: 0,
    statusCounts: {},
    transportErrorCount: 0,
    differenceCount: 0,
    differences: [],
    issues: [],
    approvedBatchSha256: approvedBatchSha256,
    frozenBodySha256: frozenBodySha256,
    inputEvidence: inputs?.hashes || null,
    boundary: '本报告仅证明本次认证 HTTP 回读使用 GET 并核对当前管理接口数据；不证明页面、Wasm 组装、宿主事件生产或真实战斗运行。'
  };
}

async function run() {
  let inputs = null;
  let report = baseReport();
  try {
    ensure(token.length > 0, '缺少非空临时 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出');
    inputs = loadInputs();
    report = baseReport(inputs);

    const global = await scanGlobalRules(expectedCurrent.finalRuleCount);
    const nonRule = await readTargetNonRule();
    const verification = compareReadbackToBaseline(inputs, global, nonRule);
    ensure(global.skillKeys.length === expectedCurrent.skillCount, '最终技能数不符');
    ensure(global.refs.length === expectedCurrent.finalRuleCount, '最终规则数不符');
    ensure((global.eventTypeCounts.SOURCE_INITIALIZED || 0) === expectedCurrent.sourceInitializedCount, '最终来源初始化数不符');

    report.status = 'PASS';
    report.completedAt = new Date().toISOString();
    report.getCount = getCount;
    report.statusCounts = { ...statusCounts };
    report.transportErrorCount = transportErrors.length;
    report.differenceCount = differences.length;
    report.differences = differences;
    report.issues = issues;
    report.globalReadback = {
      skillDirectoryStatus: 200,
      skillCount: global.skillKeys.length,
      ruleListGetCount: global.skillKeys.length,
      ruleDetailGetCount: global.details.length,
      ruleCount: global.refs.length,
      sourceInitializedCount: global.eventTypeCounts.SOURCE_INITIALIZED || 0,
      eventTypeCounts: global.eventTypeCounts,
      ruleRefsSha256: shaValue(global.refs),
      ruleDetailsSha256: shaValue(global.details),
      finalRuleSetSha256: shaValue(global.refs.map(item => ruleId(item.skillKey, item.ruleKey)))
    };
    report.oldRuleComparison = {
      baselineRuleCount: expectedCurrent.ruleCount,
      comparedCount: verification.baselineRuleDetailsCompared,
      differenceCount: verification.oldRuleDetailDifferenceCount,
      unchanged: true
    };
    report.newRule = {
      id: targetRuleId,
      listKeyCount: verification.targetList.ruleKeys.length,
      normalizedSha256: shaValue(verification.normalizedNew),
      equalsFrozenBody: true
    };
    report.targetReadback = {
      staticGetCount: 7,
      staticRoutes: Object.keys(targetRoutes().static),
      componentListGetCount: componentKinds.length,
      componentDetailCounts: Object.fromEntries(componentKinds.map(([apiName]) => [apiName, nonRule.components[apiName].details.length])),
      nonRuleSnapshotSha256: shaValue(nonRule),
      matchesWriteBeforeNonRuleSnapshot: true
    };
    report.businessWrites = 0;
    report.boundary = '本报告仅证明一次独立认证回读：全技能目录、全部技能规则列表、全部131条规则详情，以及赫卡里姆角色/属性/双向关系/代表图和全部五类技能组成均已通过GET核对；不证明页面、Wasm组装、宿主事件生产或真实战斗运行。';
    writeReport(report);
    process.stdout.write(jsonText({
      status: report.status,
      getCount: report.getCount,
      statusCounts: report.statusCounts,
      skillCount: report.globalReadback.skillCount,
      ruleCount: report.globalReadback.ruleCount,
      sourceInitializedCount: report.globalReadback.sourceInitializedCount,
      businessWrites: report.businessWrites,
      differenceCount: report.differenceCount,
      newRuleSha256: report.newRule.normalizedSha256
    }));
  } catch (error) {
    report.status = 'FAILED';
    report.completedAt = new Date().toISOString();
    report.getCount = getCount;
    report.statusCounts = { ...statusCounts };
    report.transportErrorCount = transportErrors.length;
    report.differenceCount = differences.length;
    report.differences = differences;
    report.issues = issues;
    report.inputEvidence = inputs?.hashes || report.inputEvidence;
    report.error = {
      message: error instanceof Error ? error.message : String(error)
    };
    if (transportErrors.length > 0) report.transportErrors = transportErrors;
    report.businessWrites = 0;
    writeReport(report);
    process.exitCode = 1;
    process.stderr.write(jsonText({
      status: report.status,
      getCount: report.getCount,
      statusCounts: report.statusCounts,
      businessWrites: report.businessWrites,
      differenceCount: report.differenceCount,
      error: report.error
    }));
  }
}

await run();

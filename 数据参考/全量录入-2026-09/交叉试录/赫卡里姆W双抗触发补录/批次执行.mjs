import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildRule, expectedCurrent, sourceFiles, target } from './批次配置.mjs';

const mode = process.argv[2];
if (!['prepare', 'write'].includes(mode)) throw new Error('用法：node 批次执行.mjs prepare|write');

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');

const outputPath = name => path.join(here, name);
const jsonText = value => JSON.stringify(value, null, 2) + '\n';
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : value;
const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const fileSha = filePath => shaBytes(fs.readFileSync(filePath));
const equal = (left, right) => isDeepStrictEqual(stable(left), stable(right));
const writeNewJson = (name, value) => fs.writeFileSync(outputPath(name), jsonText(value), { encoding: 'utf8', flag: 'wx' });
const readJson = name => JSON.parse(fs.readFileSync(outputPath(name), 'utf8'));
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key]]));
const assertTrue = (condition, message) => assert.equal(Boolean(condition), true, message);
const ruleId = (skillKey, ruleKey) => skillKey + '/' + ruleKey;
const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey']
];

let getCount = 0;
let postCount = 0;
const statusCounts = {};

async function request(method, route, body) {
  if (!['GET', 'POST'].includes(method)) throw new Error('不允许的方法：' + method);
  if (mode === 'prepare' && method !== 'GET') throw new Error('prepare 模式只允许 GET');
  if (method === 'GET') getCount += 1;
  if (method === 'POST') postCount += 1;
  const response = await fetch(baseUrl + route, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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
  statusCounts[response.status] = (statusCounts[response.status] || 0) + 1;
  return { method, route, status: response.status, data };
}

const get = route => request('GET', route);
const post = (route, body) => request('POST', route, body);

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

function arrayData(response, context) {
  assert.equal(response.status, 200, context + ' 预期200，实际' + response.status);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(context + ' 没有数组结果');
}

function sortedUnique(values, context) {
  assertTrue(values.every(value => typeof value === 'string' && value.length > 0), context + ' 存在空键');
  const sorted = [...values].sort();
  assert.equal(new Set(sorted).size, sorted.length, context + ' 存在重复键');
  return sorted;
}

function sourceSnapshot() {
  const files = sourceFiles.map(relativePath => {
    const absolutePath = path.join(repoRoot, ...relativePath.split('/'));
    assertTrue(fs.existsSync(absolutePath), '来源文件不存在：' + relativePath);
    const bytes = fs.readFileSync(absolutePath);
    return { relativePath, bytes: bytes.length, sha256: shaBytes(bytes) };
  });
  const sourceDocument = JSON.parse(fs.readFileSync(path.join(repoRoot, ...target.sourceFile.split('/')), 'utf8'));
  const sourceSkill = sourceDocument.skills?.[target.skillKey];
  assertTrue(sourceSkill, '固定候选缺少 ' + target.skillKey);
  assertTrue(sourceSkill.source?.currentTexts?.keySummary?.text?.includes('护甲和魔抗'), '固定候选摘要未证明双抗');
  assertTrue(sourceSkill.source?.currentTexts?.keyTooltip?.text?.includes('@ResistAmount@'), '固定候选正文未引用双抗数值');
  assert.deepEqual(sourceSkill.write?.processes, [], '固定候选过程预期为空');
  assert.deepEqual(sourceSkill.write?.internalStates, [], '固定候选内部状态预期为空');
  assert.deepEqual(sourceSkill.write?.triggerRules, [], '固定候选规则预期为空');
  const resistance = sourceSkill.write?.parameters?.find(item => item.parameterKey === 'resistance_gain');
  const duration = sourceSkill.write?.parameters?.find(item => item.parameterKey === 'duration_ms');
  assert.deepEqual(resistance?.levelValues, { '1': 5, '2': 10, '3': 15, '4': 20, '5': 25 }, '固定候选双抗等级值不符');
  assert.equal(duration?.fixedValue, 4000, '固定候选持续时间不符');
  for (const check of target.effectChecks) {
    const effect = sourceSkill.write?.effects?.find(item => item.effectKey === check.effectKey);
    assertTrue(effect, '固定候选缺少效果 ' + check.effectKey);
    assert.equal(effect.lifecycle?.durationValue?.parameterKey, check.durationParameterKey, check.effectKey + ' 持续引用不符');
    assert.equal(effect.lifecycle?.instanceScope, 'SOURCE', check.effectKey + ' 实例范围不符');
    const result = effect.results?.find(item => item.resultKey === check.resultKey);
    assertTrue(result, '固定候选缺少结果 ' + check.resultKey);
    assert.equal(result.resultType, check.resultType, check.effectKey + ' 结果类型不符');
    assert.equal(result.target, check.resultTarget, check.effectKey + ' 结果目标不符');
    assert.equal(result.detail?.attributeKey, check.attributeKey, check.effectKey + ' 属性不符');
    assert.equal(result.valueRule?.value?.parameterKey, check.valueParameterKey, check.effectKey + ' 数值引用不符');
  }
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    sourceVersion: '16.17/16.17.1',
    files,
    objectPath: 'skills.' + target.skillKey,
    objectSha256: shaValue(sourceSkill),
    relevant: {
      summary: sourceSkill.source.currentTexts.keySummary,
      tooltip: sourceSkill.source.currentTexts.keyTooltip,
      parameters: sourceSkill.write.parameters.filter(item => target.parameterChecks.includes(item.parameterKey)),
      formulas: sourceSkill.write.formulas.filter(item => target.formulaChecks.includes(item.formulaKey)),
      effects: sourceSkill.write.effects.filter(item => target.effectChecks.some(check => check.effectKey === item.effectKey)),
      pending: sourceSkill.pending || [],
      excluded: sourceSkill.excluded || []
    },
    boundary: '固定来源证明管理组成，不证明Wasm组装、宿主事件或战斗运行。'
  };
}

function sourceSkillObject() {
  const sourceDocument = JSON.parse(fs.readFileSync(path.join(repoRoot, ...target.sourceFile.split('/')), 'utf8'));
  return sourceDocument.skills[target.skillKey];
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

function validateStoredComposition(sourceSkill, components) {
  for (const key of target.parameterChecks) {
    const actual = components.parameters.details.find(item => item.key === key)?.data;
    const expected = sourceSkill.write.parameters.find(item => item.parameterKey === key);
    assertTrue(actual && expected, '参数缺失：' + key);
    assert.equal(equal(pick(actual, ['parameterKey', 'name', 'valueType', 'valueMode', 'fixedValue', 'levelValues', 'description', 'sortOrder']), expected), true, '参数与固定候选不一致：' + key);
  }
  for (const check of target.effectChecks) {
    const actual = components.effects.details.find(item => item.key === check.effectKey)?.data;
    const expected = sourceSkill.write.effects.find(item => item.effectKey === check.effectKey);
    assertTrue(actual && expected, '效果缺失：' + check.effectKey);
    assert.equal(equal(pick(actual, ['effectKey', 'name', 'description', 'sortOrder', 'lifecycle', 'results']), expected), true, '效果与固定候选不一致：' + check.effectKey);
  }
  assert.deepEqual(components.processes.keys, [], '目标过程预期为空');
  assert.deepEqual(components['internal-states'].keys, [], '目标内部状态预期为空');
}

async function readTarget() {
  const routes = targetRoutes();
  const staticData = {};
  for (const [name, route] of Object.entries(routes.static)) {
    const response = await get(route);
    assert.equal(response.status, 200, target.name + ' ' + route + ' 非200');
    staticData[name] = response.data;
  }
  assert.equal(staticData.subject?.skillKey, target.skillKey, '技能主体键不符');
  assert.equal(staticData.owner?.characterKey, target.ownerKey, '角色主体键不符');
  const relationMatch = item => item.characterKey === target.ownerKey && item.skillKey === target.skillKey;
  assertTrue((staticData.relationByOwner?.items || staticData.relationByOwner || []).some(relationMatch), '正向角色技能关系缺失');
  assertTrue((staticData.relationBySkill?.items || staticData.relationBySkill || []).some(relationMatch), '反向角色技能关系缺失');
  for (const key of ['ownerRepresentativeImage', 'skillRepresentativeImage']) {
    assertTrue(staticData[key]?.image?.enabled === true, key + ' 代表图不可用');
  }

  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const listRoute = routes.skill + '/' + apiName;
    const list = await get(listRoute);
    const items = arrayData(list, target.name + ' ' + apiName);
    const keys = sortedUnique(items.map(item => item[keyName]), target.name + ' ' + apiName);
    const details = await getMany(keys.map(key => listRoute + '/' + encodeURIComponent(key)));
    details.forEach((response, index) => assert.equal(response.status, 200, apiName + '/' + keys[index] + ' 非200'));
    components[apiName] = {
      list: list.data,
      keys,
      details: details.map((response, index) => ({ key: keys[index], data: response.data }))
    };
  }
  validateStoredComposition(sourceSkillObject(), components);

  const ruleListRoute = routes.skill + '/trigger-rules';
  const ruleList = await get(ruleListRoute);
  const ruleItems = arrayData(ruleList, target.name + ' 规则列表');
  const candidate = await get(ruleListRoute + '/' + encodeURIComponent(target.ruleKey));
  return {
    nonRule: { static: staticData, components },
    ruleState: {
      list: ruleList.data,
      keys: sortedUnique(ruleItems.map(item => item.ruleKey), target.name + ' 规则列表'),
      candidate
    }
  };
}

async function scanRules(expectedRuleCount) {
  const skillsResponse = await get('/skills');
  const skills = arrayData(skillsResponse, '技能目录');
  const skillKeys = sortedUnique(skills.map(item => item.skillKey), '技能目录');
  assert.equal(skillKeys.length, expectedCurrent.skillCount, '技能总数不符');
  if (typeof skillsResponse.data?.total === 'number') assert.equal(skillsResponse.data.total, skillKeys.length, '技能目录total不符');
  const listResponses = await getMany(skillKeys.map(skillKey => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules'));
  const lists = listResponses.map((response, index) => {
    const rules = arrayData(response, skillKeys[index] + ' 规则列表');
    const ruleKeys = sortedUnique(rules.map(item => item.ruleKey), skillKeys[index] + ' 规则列表');
    return { skillKey: skillKeys[index], data: response.data, ruleKeys };
  });
  const refs = lists
    .flatMap(item => item.ruleKeys.map(ruleKey => ({ skillKey: item.skillKey, ruleKey })))
    .sort((left, right) => ruleId(left.skillKey, left.ruleKey).localeCompare(ruleId(right.skillKey, right.ruleKey)));
  assert.equal(refs.length, expectedRuleCount, '规则总数不符');
  const detailResponses = await getMany(refs.map(item => '/skills/' + encodeURIComponent(item.skillKey) + '/trigger-rules/' + encodeURIComponent(item.ruleKey)));
  detailResponses.forEach((response, index) => assert.equal(response.status, 200, ruleId(refs[index].skillKey, refs[index].ruleKey) + ' 详情非200'));
  const details = detailResponses.map((response, index) => ({ ...refs[index], data: response.data }));
  const eventTypeCounts = details.reduce((counts, item) => {
    const eventType = item.data?.eventSource?.eventType;
    if (eventType) counts[eventType] = (counts[eventType] || 0) + 1;
    return counts;
  }, {});
  assert.equal(eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '来源初始化规则数不符');
  return { skills: skillsResponse.data, skillKeys, lists, refs, details, eventTypeCounts };
}

function normalizeStoredRule(value) {
  return pick(value, ['ruleKey', 'name', 'description', 'sortOrder', 'eventSource', 'conditionGroups', 'actions', 'perTargetCooldown', 'maxTriggersPerProcess']);
}

function verifyFreeze(freeze) {
  const copy = { ...freeze };
  delete copy.batchSha256;
  assert.equal(freeze.batchSha256, shaValue(copy), '冻结批次散列不符');
  assert.equal(freeze.configSha256, fileSha(outputPath('批次配置.mjs')), '批次配置已变化');
  assert.equal(freeze.executorSha256, fileSha(fileURLToPath(import.meta.url)), '批次执行器已变化');
  assert.equal(freeze.request.bodySha256, shaValue(freeze.request.body), '冻结请求正文散列不符');
  assert.equal(freeze.request.method, 'POST', '冻结方法不符');
  assert.equal(freeze.request.route, '/skills/' + target.skillKey + '/trigger-rules', '冻结路径不符');
}

async function prepare() {
  for (const name of ['02-冻结请求.json', '03-来源散列快照.json', '04-共享写前现值.json', '05-只读准备报告.json']) {
    if (fs.existsSync(outputPath(name))) throw new Error(name + ' 已存在，拒绝覆盖。');
  }

  const source = sourceSnapshot();
  writeNewJson('03-来源散列快照.json', source);
  const body = buildRule();
  const freezeBase = {
    schemaVersion: 1,
    revision: 'rev1',
    frozenAt: new Date().toISOString(),
    status: 'FROZEN_FOR_MAIN_REVIEW',
    expectedCurrent,
    target: {
      ownerKey: target.ownerKey,
      skillKey: target.skillKey,
      ruleKey: target.ruleKey,
      effectKeys: target.effectChecks.map(item => item.effectKey),
      omitted: target.omitted
    },
    allowedOperations: [{ method: 'POST', route: '/skills/' + target.skillKey + '/trigger-rules' }],
    request: {
      method: 'POST',
      route: '/skills/' + target.skillKey + '/trigger-rules',
      body,
      bodySha256: shaValue(body)
    },
    sourceSnapshotSha256: shaValue(source),
    configSha256: fileSha(outputPath('批次配置.mjs')),
    executorSha256: fileSha(fileURLToPath(import.meta.url)),
    authorizationValueRecorded: false
  };
  const freeze = { ...freezeBase, batchSha256: shaValue(freezeBase) };
  writeNewJson('02-冻结请求.json', freeze);

  const global = await scanRules(expectedCurrent.ruleCount);
  const current = await readTarget();
  assert.deepEqual(current.ruleState.keys, [], '候选技能已有其他规则，需重新复核');
  assert.equal(current.ruleState.candidate.status, 404, '候选规则必须不存在');
  const baseline = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    global: {
      skills: global.skills,
      skillKeys: global.skillKeys,
      ruleLists: global.lists,
      ruleRefs: global.refs,
      ruleDetails: global.details,
      eventTypeCounts: global.eventTypeCounts
    },
    target: current,
    expectedCurrent
  };
  writeNewJson('04-共享写前现值.json', baseline);
  const report = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    status: 'READY_FOR_MAIN_REVIEW',
    methodPolicy: 'GET_ONLY',
    getCount,
    postCount,
    statusCounts,
    skillCount: global.skillKeys.length,
    ruleCount: global.refs.length,
    sourceInitializedCount: global.eventTypeCounts.SOURCE_INITIALIZED || 0,
    candidateStatus: current.ruleState.candidate.status,
    targetRuleKeys: current.ruleState.keys,
    targetNonRuleSnapshotSha256: shaValue(current.nonRule),
    baselineSha256: shaValue(baseline),
    sourceSnapshotSha256: shaValue(source),
    frozenBatchSha256: freeze.batchSha256,
    repeatedFullBaselineCount: 0,
    businessWrites: 0,
    boundary: '准备报告不证明写入、页面、Wasm、宿主事件或战斗运行。'
  };
  writeNewJson('05-只读准备报告.json', report);
  process.stdout.write(jsonText({
    status: report.status,
    getCount: report.getCount,
    skillCount: report.skillCount,
    ruleCount: report.ruleCount,
    sourceInitializedCount: report.sourceInitializedCount,
    candidateStatus: report.candidateStatus,
    batchSha256: freeze.batchSha256,
    businessWrites: report.businessWrites
  }));
}

async function writeProtected() {
  if (process.env.DAMAGE_ALLOW_WRITE !== 'YES') throw new Error('缺少 DAMAGE_ALLOW_WRITE=YES，拒绝写入。');
  if (fs.existsSync(outputPath('06-写入与即时回读.json'))) throw new Error('06-写入与即时回读.json 已存在，拒绝覆盖。');
  const freeze = readJson('02-冻结请求.json');
  const source = readJson('03-来源散列快照.json');
  const baseline = readJson('04-共享写前现值.json');
  verifyFreeze(freeze);
  assert.equal(String(process.env.DAMAGE_APPROVED_BATCH_SHA256 || '').trim(), freeze.batchSha256, '批准批次散列不符');
  assert.equal(shaValue(source), freeze.sourceSnapshotSha256, '来源快照与冻结不符');
  assert.equal(baseline.expectedCurrent?.ruleCount, expectedCurrent.ruleCount, '写前基线规则数不符');
  assert.equal(baseline.global?.ruleRefs?.length, expectedCurrent.ruleCount, '写前基线规则集合不符');

  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    status: 'STARTED',
    allowedOperations: freeze.allowedOperations,
    approvedBatchSha256: freeze.batchSha256,
    authorizationValueRecorded: false,
    getCount: 0,
    postCount: 0,
    statusCounts: {},
    replayedWrites: 0,
    recoveryReadPerformed: false
  };
  let postAttempted = false;
  let postResponse = null;
  try {
    const skills = await get('/skills');
    assert.equal(arrayData(skills, '当前技能目录').length, expectedCurrent.skillCount, '写前技能总数变化');
    const current = await readTarget();
    assert.deepEqual(current.ruleState.keys, [], '写前目标规则列表不为空');
    assert.equal(current.ruleState.candidate.status, 404, '写前候选详情必须404');
    assert.equal(equal(current.nonRule, baseline.target.nonRule), true, '写前目标非规则组成变化');

    postAttempted = true;
    postResponse = await post(freeze.request.route, freeze.request.body);
    assert.equal(postResponse.status, 201, '业务POST预期201，实际' + postResponse.status);
    const immediate = await get('/skills/' + target.skillKey + '/trigger-rules/' + target.ruleKey);
    assert.equal(immediate.status, 200, '即时回读非200');
    assert.equal(equal(normalizeStoredRule(immediate.data), freeze.request.body), true, '即时回读与冻结请求不一致');

    report.status = 'PASS';
    report.completedAt = new Date().toISOString();
    report.postResponse = postResponse;
    report.immediateReadback = immediate;
    report.candidateBeforeStatus = current.ruleState.candidate.status;
    report.targetNonRuleSnapshotSha256 = shaValue(current.nonRule);
    report.bodySha256 = shaValue(normalizeStoredRule(immediate.data));
    report.boundary = '一次受保护写入和即时回读通过；独立最终回读、页面和运行验证另行执行。';
  } catch (error) {
    report.status = 'FAILED';
    report.completedAt = new Date().toISOString();
    report.error = { message: error instanceof Error ? error.message : String(error) };
    report.postAttempted = postAttempted;
    report.postResponse = postResponse;
    if (postAttempted) {
      report.recoveryReadPerformed = true;
      try {
        const recovered = await get('/skills/' + target.skillKey + '/trigger-rules/' + target.ruleKey);
        report.recoveryReadback = recovered;
        if (recovered.status === 200) {
          report.recoveryMatchesFrozen = equal(normalizeStoredRule(recovered.data), freeze.request.body);
        }
      } catch (recoveryError) {
        report.recoveryError = { message: recoveryError instanceof Error ? recoveryError.message : String(recoveryError) };
      }
    }
    report.getCount = getCount;
    report.postCount = postCount;
    report.statusCounts = statusCounts;
    writeNewJson('06-写入与即时回读.json', report);
    throw error;
  }
  report.getCount = getCount;
  report.postCount = postCount;
  report.statusCounts = statusCounts;
  writeNewJson('06-写入与即时回读.json', report);
  process.stdout.write(jsonText({
    status: report.status,
    getCount: report.getCount,
    postCount: report.postCount,
    replayedWrites: report.replayedWrites,
    recoveryReadPerformed: report.recoveryReadPerformed,
    bodySha256: report.bodySha256
  }));
}

if (mode === 'prepare') await prepare();
else await writeProtected();

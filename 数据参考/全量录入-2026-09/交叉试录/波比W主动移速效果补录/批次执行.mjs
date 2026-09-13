import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildEffect, expectedCurrent, sourceFiles, target } from './批次配置.mjs';

const mode = process.argv[2];
if (!['prepare', 'write'].includes(mode)) throw new Error('用法：node 批次执行.mjs prepare|write');
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');

const kinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];
let getCount = 0;
let postCount = 0;
const statusCounts = {};
const outputPath = name => path.join(here, name);
const jsonText = value => JSON.stringify(value, null, 2) + '\n';
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : value;
const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const shaValue = value => shaBytes(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const fileSha = file => shaBytes(fs.readFileSync(file));
const equal = (left, right) => isDeepStrictEqual(stable(left), stable(right));
const writeNewJson = (name, value) => fs.writeFileSync(outputPath(name), jsonText(value), { encoding: 'utf8', flag: 'wx' });
const readJson = name => JSON.parse(fs.readFileSync(outputPath(name), 'utf8'));
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key]]));

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
    try { data = JSON.parse(raw); } catch { data = { parseError: true, responseBytes: Buffer.byteLength(raw) }; }
  }
  statusCounts[response.status] = (statusCounts[response.status] || 0) + 1;
  return { method, route, status: response.status, data };
}

const get = route => request('GET', route);
const post = (route, body) => request('POST', route, body);
async function getMany(routes, concurrency = 24) {
  const responses = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= routes.length) return;
      responses[index] = await get(routes[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker()));
  return responses;
}

function arrayData(response, context) {
  assert.equal(response.status, 200, context + ' 预期200，实际' + response.status);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(context + ' 没有数组结果');
}

function sortedUnique(values, context) {
  assert(values.every(value => typeof value === 'string' && value.length > 0), context + ' 存在空键');
  const sorted = [...values].sort();
  assert.equal(new Set(sorted).size, sorted.length, context + ' 存在重复键');
  return sorted;
}

function normalizeEffect(value) {
  return pick(value, ['effectKey', 'name', 'description', 'sortOrder', 'lifecycle', 'results']);
}

function sourceSnapshot() {
  const files = sourceFiles.map(relativePath => {
    const absolutePath = path.join(repoRoot, ...relativePath.split('/'));
    assert(fs.existsSync(absolutePath), '来源文件不存在：' + relativePath);
    const bytes = fs.readFileSync(absolutePath);
    return { relativePath, bytes: bytes.length, sha256: shaBytes(bytes) };
  });
  const sourceDocument = JSON.parse(fs.readFileSync(path.join(repoRoot, ...target.sourceFile.split('/')), 'utf8'));
  const sourceSkill = sourceDocument.skills?.[target.skillKey];
  assert(sourceSkill, '固定候选缺少 ' + target.skillKey);
  assert(sourceSkill.source?.currentTexts?.keyTooltip?.text?.includes('@Haste@%移动速度'), '固定正文未证明主动移动速度');
  assert(sourceSkill.source.currentTexts.keyTooltip.text.includes('@Duration@秒'), '固定正文未证明主动持续时间');
  const valueParameter = sourceSkill.write.parameters.find(item => item.parameterKey === target.valueParameterKey);
  const durationParameter = sourceSkill.write.parameters.find(item => item.parameterKey === target.durationParameterKey);
  assert.equal(valueParameter?.fixedValue, 40, '主动移速参数不是40');
  assert.equal(durationParameter?.fixedValue, 2000, '主动持续参数不是2000');
  assert.equal(sourceSkill.write.effects.some(item => item.effectKey === target.effectKey), false, '旧候选意外已有新效果');
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    sourceVersion: '16.17/16.17.1',
    files,
    objectPath: 'skills.' + target.skillKey,
    objectSha256: shaValue(sourceSkill),
    relevant: {
      binding: sourceSkill.source.binding,
      summary: sourceSkill.source.currentTexts.keySummary,
      tooltip: sourceSkill.source.currentTexts.keyTooltip,
      valueParameter,
      durationParameter,
      proposedEffect: buildEffect(),
      pending: sourceSkill.pending,
      excluded: sourceSkill.excluded
    },
    boundary: '固定来源证明数值；现行接口同类效果另由写前基线核对。'
  };
}

function relationItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

async function readTarget() {
  const skillRoute = '/skills/' + target.skillKey;
  const ownerRoute = '/characters/' + target.ownerKey;
  const staticRoutes = {
    subject: skillRoute,
    owner: ownerRoute,
    ownerAttributes: ownerRoute + '/attributes',
    ownerRepresentativeImage: ownerRoute + '/representative-image',
    relationByOwner: '/character-skill-relations?characterKey=' + target.ownerKey,
    relationBySkill: '/character-skill-relations?skillKey=' + target.skillKey,
    skillRepresentativeImage: skillRoute + '/representative-image',
    moveSpeedAttribute: '/attributes/move_speed_percent',
    flatAddZone: '/modifier-zones/attribute_flat_add',
    analogEffect: '/skills/' + target.analogSkillKey + '/effects/' + target.analogEffectKey
  };
  const staticData = {};
  for (const [key, route] of Object.entries(staticRoutes)) {
    const response = await get(route);
    assert.equal(response.status, 200, route + ' 非200');
    staticData[key] = response.data;
  }
  assert.equal(staticData.subject.skillKey, target.skillKey);
  assert.equal(staticData.owner.characterKey, target.ownerKey);
  const matches = item => item.characterKey === target.ownerKey && item.skillKey === target.skillKey;
  assert(relationItems(staticData.relationByOwner).some(matches), '正向角色技能关系缺失');
  assert(relationItems(staticData.relationBySkill).some(matches), '反向角色技能关系缺失');
  assert.equal(staticData.ownerRepresentativeImage?.image?.enabled, true, '角色代表图不可用');
  assert.equal(staticData.skillRepresentativeImage?.image?.enabled, true, '技能代表图不可用');
  assert.equal(staticData.moveSpeedAttribute.attributeKey, 'move_speed_percent');
  assert(staticData.moveSpeedAttribute.description.includes('1 表示 100%'));
  assert.equal(staticData.flatAddZone.modifierZoneKey, 'attribute_flat_add');
  const analog = normalizeEffect(staticData.analogEffect);
  const analogResult = analog.results?.[0];
  assert.equal(analogResult?.detail?.attributeKey, 'move_speed_percent');
  assert.equal(analogResult?.detail?.modifierZoneKey, 'attribute_flat_add');
  assert.equal(analogResult?.valueRule?.fixedMultiplier, 0.01);
  assert.equal(analogResult?.target, 'SOURCE');

  const components = {};
  for (const [kind, keyName] of kinds) {
    const listRoute = skillRoute + '/' + kind;
    const listResponse = await get(listRoute);
    const items = arrayData(listResponse, kind + ' 列表');
    const keys = sortedUnique(items.map(item => item[keyName]), kind + ' 列表');
    const details = await getMany(keys.map(key => listRoute + '/' + encodeURIComponent(key)));
    details.forEach((response, index) => assert.equal(response.status, 200, kind + '/' + keys[index] + ' 非200'));
    components[kind] = { list: listResponse.data, keys, details: details.map((response, index) => ({ key: keys[index], data: response.data })) };
  }
  const candidate = await get(skillRoute + '/effects/' + target.effectKey);
  return { staticRoutes, static: staticData, components, candidate };
}

function validateBefore(current) {
  assert.deepEqual(current.components.effects.keys, [target.existingEffectKey], '写前效果键集合不符');
  assert.equal(current.candidate.status, 404, '候选效果必须为404');
  assert.deepEqual(current.components.processes.keys, [], '过程应为空');
  assert.deepEqual(current.components['internal-states'].keys, [], '内部状态应为空');
  assert.deepEqual(current.components['trigger-rules'].keys, [], '触发规则应为空');
  const value = current.components.parameters.details.find(item => item.key === target.valueParameterKey)?.data;
  const duration = current.components.parameters.details.find(item => item.key === target.durationParameterKey)?.data;
  assert.equal(value?.fixedValue, 40, '实库主动移速参数不符');
  assert.equal(duration?.fixedValue, 2000, '实库主动持续参数不符');
}

function verifyFreeze(freeze) {
  const copy = { ...freeze };
  delete copy.batchSha256;
  assert.equal(freeze.batchSha256, shaValue(copy), '冻结批次散列不符');
  assert.equal(freeze.configSha256, fileSha(outputPath('批次配置.mjs')), '批次配置已变化');
  assert.equal(freeze.executorSha256, fileSha(fileURLToPath(import.meta.url)), '批次执行器已变化');
  assert.equal(freeze.request.bodySha256, shaValue(freeze.request.body), '冻结正文散列不符');
  assert.deepEqual(freeze.request.body, buildEffect(), '冻结正文与配置不符');
  assert.equal(freeze.request.route, '/skills/' + target.skillKey + '/effects', '冻结路径不符');
}

async function prepare() {
  for (const name of ['02-冻结请求.json', '03-来源散列快照.json', '04-写入前现值.json', '05-只读准备报告.json']) {
    if (fs.existsSync(outputPath(name))) throw new Error(name + ' 已存在，拒绝覆盖。');
  }
  const source = sourceSnapshot();
  writeNewJson('03-来源散列快照.json', source);
  const effect = buildEffect();
  const freezeBase = {
    schemaVersion: 1,
    revision: 'rev1',
    frozenAt: new Date().toISOString(),
    status: 'FROZEN_FOR_MAIN_REVIEW',
    expectedCurrent,
    target: {
      ownerKey: target.ownerKey,
      skillKey: target.skillKey,
      effectKey: target.effectKey,
      resultKey: target.resultKey,
      expectedExistingEffectKeys: [target.existingEffectKey],
      omitted: ['主动施法规则', '反突进、缚地、减速与伤害', '被动双抗与低生命翻倍', '法力扣除时点、冷却和施放资格']
    },
    allowedOperations: [{ method: 'POST', route: '/skills/' + target.skillKey + '/effects' }],
    request: {
      method: 'POST',
      route: '/skills/' + target.skillKey + '/effects',
      body: effect,
      bodySha256: shaValue(effect)
    },
    sourceSnapshotSha256: shaValue(source),
    configSha256: fileSha(outputPath('批次配置.mjs')),
    executorSha256: fileSha(fileURLToPath(import.meta.url)),
    authorizationValueRecorded: false
  };
  const freeze = { ...freezeBase, batchSha256: shaValue(freezeBase) };
  writeNewJson('02-冻结请求.json', freeze);

  const skillsResponse = await get('/skills');
  const skills = arrayData(skillsResponse, '技能目录');
  assert.equal(skills.length, expectedCurrent.skillCount, '技能总数不符');
  const current = await readTarget();
  validateBefore(current);
  const baseline = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    global: {
      skillCount: skills.length,
      skillKeysSha256: shaValue(sortedUnique(skills.map(item => item.skillKey), '技能目录')),
      priorRuleCheckpoint: current.static.analogEffect ? {
        sourceFile: sourceFiles[4],
        ruleCount: expectedCurrent.ruleCount,
        sourceInitializedCount: expectedCurrent.sourceInitializedCount,
        ruleRefsSha256: '6a9c7ec9170ff89849b7de333fe20df6d46c58dac63351aff0c3031960c998ee',
        ruleDetailsSha256: '0977aaa127f34b1804ac54bbdebb60fea2a9c7009694d79e5bf2227863246264'
      } : null
    },
    target: current,
    expectedCurrent
  };
  writeNewJson('04-写入前现值.json', baseline);
  const report = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    status: 'READY_FOR_MAIN_REVIEW',
    methodPolicy: 'GET_ONLY',
    getCount,
    postCount,
    statusCounts,
    skillCount: skills.length,
    ruleCheckpointCount: expectedCurrent.ruleCount,
    sourceInitializedCheckpointCount: expectedCurrent.sourceInitializedCount,
    candidateStatus: current.candidate.status,
    existingEffectKeys: current.components.effects.keys,
    targetSnapshotSha256: shaValue(current),
    baselineSha256: shaValue(baseline),
    sourceSnapshotSha256: shaValue(source),
    frozenBatchSha256: freeze.batchSha256,
    repeatedFullBaselineCount: 0,
    businessWrites: 0,
    boundary: '纯GET预检只读取技能目录、波比目标组成、同类现行效果与目录；全量131条规则沿用上一批独立检查点，写后再独立全量回读。'
  };
  writeNewJson('05-只读准备报告.json', report);
  process.stdout.write(jsonText({ status: report.status, getCount, skillCount: report.skillCount, candidateStatus: report.candidateStatus, batchSha256: freeze.batchSha256, bodySha256: freeze.request.bodySha256, businessWrites: 0 }));
}

async function writeProtected() {
  if (process.env.DAMAGE_ALLOW_WRITE !== 'YES') throw new Error('缺少 DAMAGE_ALLOW_WRITE=YES，拒绝写入。');
  if (fs.existsSync(outputPath('06-写入与即时回读.json'))) throw new Error('06-写入与即时回读.json 已存在，拒绝覆盖。');
  const freeze = readJson('02-冻结请求.json');
  const source = readJson('03-来源散列快照.json');
  const baseline = readJson('04-写入前现值.json');
  verifyFreeze(freeze);
  assert.equal(String(process.env.DAMAGE_APPROVED_BATCH_SHA256 || '').trim(), freeze.batchSha256, '批准批次散列不符');
  assert.equal(shaValue(source), freeze.sourceSnapshotSha256, '来源快照与冻结不符');
  assert.equal(shaValue(baseline), readJson('05-只读准备报告.json').baselineSha256, '写前基线散列不符');

  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    status: 'STARTED',
    approvedBatchSha256: freeze.batchSha256,
    allowedOperations: freeze.allowedOperations,
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
    const skills = arrayData(await get('/skills'), '当前技能目录');
    assert.equal(skills.length, expectedCurrent.skillCount, '写入前技能总数变化');
    const current = await readTarget();
    validateBefore(current);
    assert.equal(equal(current, baseline.target), true, '写入前目标组成已变化');

    postAttempted = true;
    postResponse = await post(freeze.request.route, freeze.request.body);
    assert.equal(postResponse.status, 201, '业务POST预期201，实际' + postResponse.status);
    const detailRoute = '/skills/' + target.skillKey + '/effects/' + target.effectKey;
    const immediate = await get(detailRoute);
    assert.equal(immediate.status, 200, '即时回读非200');
    assert.equal(equal(normalizeEffect(immediate.data), freeze.request.body), true, '即时回读与冻结正文不一致');
    const effectList = await get('/skills/' + target.skillKey + '/effects');
    const keys = sortedUnique(arrayData(effectList, '写后效果列表').map(item => item.effectKey), '写后效果列表');
    assert.deepEqual(keys, [target.effectKey, target.existingEffectKey].sort(), '写后效果键集合不符');

    report.status = 'PASS';
    report.completedAt = new Date().toISOString();
    report.candidateBeforeStatus = current.candidate.status;
    report.postResponse = postResponse;
    report.immediateReadback = immediate;
    report.effectKeysAfter = keys;
    report.bodySha256 = shaValue(normalizeEffect(immediate.data));
    report.targetBeforeSnapshotSha256 = shaValue(current);
    report.boundary = '一次受保护POST与即时GET回读通过；独立全量规则与目标组成回读、页面和运行验证另行执行。';
  } catch (error) {
    report.status = 'FAILED';
    report.completedAt = new Date().toISOString();
    report.error = { message: error instanceof Error ? error.message : String(error) };
    report.postAttempted = postAttempted;
    report.postResponse = postResponse;
    if (postAttempted) {
      report.recoveryReadPerformed = true;
      try {
        const recovered = await get('/skills/' + target.skillKey + '/effects/' + target.effectKey);
        report.recoveryReadback = recovered;
        if (recovered.status === 200) report.recoveryMatchesFrozen = equal(normalizeEffect(recovered.data), freeze.request.body);
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
  process.stdout.write(jsonText({ status: report.status, getCount, postCount, replayedWrites: report.replayedWrites, recoveryReadPerformed: report.recoveryReadPerformed, bodySha256: report.bodySha256 }));
}

if (mode === 'prepare') await prepare();
else await writeProtected();

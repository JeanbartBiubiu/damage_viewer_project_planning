import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；写入脚本不会把令牌写入报告。');
if (process.env.DAMAGE_ALLOW_BUSINESS_WRITES !== '1') {
  throw new Error('必须显式设置 DAMAGE_ALLOW_BUSINESS_WRITES=1 才允许业务写入。');
}

const reportPath = path.join(here, '06-写入与即时回读.json');
if (fs.existsSync(reportPath)) throw new Error('已存在 06-写入与即时回读.json，拒绝重放。');

const requiredHashFiles = [
  '01-合并方案.md',
  '02-合并冻结请求.json',
  '03-来源散列快照.json',
  '04-共享写前现值.json'
];
const reviewedInputFiles = [
  'README.md',
  '01-合并方案.md',
  '02-合并冻结请求.json',
  '03-来源散列快照.json',
  '04-共享写前现值.json',
  '受保护写入.mjs',
  '独立GET回读.mjs',
  '只读页面验收.mjs'
];
const reviewFile = process.env.DAMAGE_CURSOR_REVIEW_FILE || '05-Cursor独立评审.json';
const allowedMethods = new Set(['GET', 'POST']);
const expectedCurrent = { skillCount: 1062, ruleCount: 96, sourceInitializedCount: 24, finalRuleCount: 100 };
const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];
const targetConfigs = [
  { id: 'black', name: '黑色切割者', skillKey: 'item_3071_passive', ownerKey: 'item_3071', ownerKind: 'equipment', ruleKey: 'on_physical_damage_dealt_to_champion', effectKey: 'armor_shred' },
  { id: 'magic', name: '魔切', skillKey: 'item_3042_passive', ownerKey: 'item_3042', ownerKind: 'equipment', ruleKey: 'on_basic_attack_hit_to_champion', effectKey: 'on_hit_damage_from_max_mana' },
  { id: 'stridebreaker', name: '挺进破坏者', skillKey: 'item_6631_active', ownerKey: 'item_6631', ownerKind: 'equipment', ruleKey: 'actual_hit', effectKey: 'active_hit' },
  { id: 'triumph', name: '凯旋', skillKey: 'rune_9111_passive', ownerKey: 'rune_9111', ownerKind: 'rune', ruleKey: 'on_champion_kill', effectKey: 'triumph_heal' }
];
const targetById = new Map(targetConfigs.map((target) => [target.id, target]));

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
};
const shaValue = (value) => sha256(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const localPath = (name) => path.join(here, name);
const fileSha = (name) => sha256(fs.readFileSync(localPath(name)));
const readJson = (name) => JSON.parse(fs.readFileSync(localPath(name), 'utf8'));
const equal = (actual, expected) => isDeepStrictEqual(stable(actual), stable(expected));
const subsetEqual = (actual, expected) => {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length
      && expected.every((value, index) => subsetEqual(actual[index], value));
  }
  if (expected && typeof expected === 'object') {
    return Boolean(actual && typeof actual === 'object' && !Array.isArray(actual))
      && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && subsetEqual(actual[key], value));
  }
  return Object.is(actual, expected);
};
const requireStatus = (response, expected, context) => {
  assert.equal(response.status, expected, context + ' 预期 ' + expected + '，实际 ' + response.status);
  return response;
};
const arrayData = (response, context) => {
  requireStatus(response, 200, context);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(context + ' 没有数组结果');
};
const sortedUnique = (values, context) => {
  assert.equal(values.every((value) => typeof value === 'string' && value.length > 0), true, context + ' 存在空键');
  const sorted = [...values].sort();
  assert.equal(new Set(sorted).size, sorted.length, context + ' 存在重复键');
  return sorted;
};
const ruleId = (skillKey, ruleKey) => skillKey + '/' + ruleKey;

const frozen = readJson('02-合并冻结请求.json');
const baseline = readJson('04-共享写前现值.json');
const approvedSource = process.env.DAMAGE_APPROVED_HASHES_JSON
  ? JSON.parse(process.env.DAMAGE_APPROVED_HASHES_JSON)
  : (() => {
      const file = process.env.DAMAGE_APPROVED_HASHES_FILE || '批准散列.json';
      if (!fs.existsSync(localPath(file))) throw new Error('缺少批准散列 JSON：' + file);
      return readJson(file);
    })();
const approvedHashes = approvedSource.files && typeof approvedSource.files === 'object'
  ? approvedSource.files
  : approvedSource;
if (!approvedHashes || typeof approvedHashes !== 'object') throw new Error('批准散列 JSON 结构不符');
for (const file of requiredHashFiles) {
  const expected = String(approvedHashes[file] || '');
  if (!/^[0-9a-f]{64}$/i.test(expected)) throw new Error('缺少批准散列：' + file);
  const actual = fileSha(file);
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(file + ' 散列漂移：' + actual);
}
if (!fs.existsSync(localPath(reviewFile))) throw new Error('缺少 Cursor 已接受证据：' + reviewFile);
const review = readJson(reviewFile);
const reviewHash = String(approvedHashes[reviewFile] || '');
if (!/^[0-9a-f]{64}$/i.test(reviewHash)) throw new Error('缺少 Cursor 评审证据批准散列：' + reviewFile);
if (fileSha(reviewFile).toLowerCase() !== reviewHash.toLowerCase()) throw new Error('Cursor 评审证据散列漂移');
const reviewInputHashes = review.approvedInputHashes;
if (!reviewInputHashes || typeof reviewInputHashes !== 'object' || Array.isArray(reviewInputHashes)) {
  throw new Error('Cursor 评审缺少 approvedInputHashes');
}
for (const file of reviewedInputFiles) {
  const reviewExpected = String(reviewInputHashes[file] || '');
  const approvedExpected = String(approvedHashes[file] || '');
  if (!/^[0-9a-f]{64}$/i.test(reviewExpected)) throw new Error('Cursor 评审缺少 approvedInputHashes：' + file);
  if (!/^[0-9a-f]{64}$/i.test(approvedExpected)) throw new Error('批准散列缺少已评审输入文件：' + file);
  if (reviewExpected.toLowerCase() !== approvedExpected.toLowerCase()) throw new Error('Cursor 评审批准散列与批准散列文件不一致：' + file);
  const actual = fileSha(file);
  if (actual.toLowerCase() !== reviewExpected.toLowerCase()) throw new Error('Cursor 评审输入散列漂移：' + file);
}

const report = {
  schemaVersion: 2,
  revision: 'rev2',
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  authorizationValueRecorded: false,
  approvedHashFile: process.env.DAMAGE_APPROVED_HASHES_FILE || '批准散列.json',
  approvedHashes,
  cursorReview: { file: reviewFile },
  preflight: { rounds: [], targetRounds: [] },
  writes: [],
  finalReadback: null,
  businessWriteCount: 0,
  getCount: 0,
  error: null
};
const saveReport = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

function validateReview() {
  const finished = review.finished === true || review.resultStatus === 'finished';
  const ready = review.status === 'READY' || review.verdict === 'READY';
  const revision = review.revision === 'rev2' || review.reviewedPlanRevision === 2;
  const accepted = review.accepted === undefined || review.accepted === true || review.verdict === 'READY';
  const writes = review.businessWrites ?? review.apiWrites ?? 0;
  assert.equal(finished, true, 'Cursor 评审尚未完成');
  assert.equal(ready, true, 'Cursor 评审不是 READY');
  assert.equal(revision, true, 'Cursor 评审不是 rev2');
  assert.equal(accepted, true, 'Cursor 评审没有 accepted=true');
  assert.equal(writes, 0, 'Cursor 评审记录包含业务写入');
  assert.equal(review.writeAllowlistAudit?.auditAvailable, true, 'Cursor 评审缺少可用写入白名单审计');
  assert.equal(review.writeAllowlistAudit?.runDeltaCount, 0, 'Cursor 评审写入白名单运行差异不为 0');
  assert.equal(review.writeAllowlistAudit?.outsideScopeCount, 0, 'Cursor 评审存在范围外写入白名单调用');
  assert.equal(review.writeAllowlistAudit?.runDeltaOutsideScopeCount, 0, 'Cursor 评审存在范围外运行差异');
  assert.equal(review.toolEvents?.allTerminalCallsCompleted, true, 'Cursor 评审工具调用未全部完成');
  assert.equal(review.toolEvents?.anyTruncated, false, 'Cursor 评审存在截断工具输出');
  assert.ok(Array.isArray(review.reviewedFiles), 'Cursor 评审缺少 reviewedFiles');
  for (const file of reviewedInputFiles) assertCondition(review.reviewedFiles.includes(file), 'Cursor 评审未覆盖 ' + file);
  report.cursorReview = {
    file: reviewFile,
    status: review.status || review.verdict,
    finished,
    accepted,
    revision: review.revision || review.reviewedPlanRevision,
    businessWrites: writes,
    approvedInputHashes: reviewInputHashes,
    writeAllowlistAudit: review.writeAllowlistAudit,
    toolEvents: review.toolEvents
  };
}

function assertCondition(condition, message) {
  assert.equal(Boolean(condition), true, message);
}

function validateFrozen() {
  assert.equal(frozen.schemaVersion, 2, '冻结请求版本不符');
  assert.equal(frozen.planRevision, 2, '冻结请求不是 rev2');
  assert.equal(frozen.revision, 'rev2', '冻结请求修订号不符');
  assert.equal(frozen.status, 'READY', '冻结请求不是 READY');
  assert.equal(frozen.writable, true, '冻结请求不可写');
  assert.deepEqual(frozen.expectedCurrent, expectedCurrent, '冻结基线计数不符');
  assert.equal(frozen.sourceSnapshotSha256, fileSha('03-来源散列快照.json'), '来源快照散列不符');
  assert.equal(frozen.requests?.length, 4, '冻结请求不是四项');
  assert.equal(frozen.writeBoundary?.businessWriteCount, 4, '冻结业务写入数不符');
  assert.equal(frozen.writeBoundary?.expectedStatus, 201, '冻结预期状态不符');
  const expectedOrder = targetConfigs.map((target) => target.id);
  assert.deepEqual(frozen.requests.map((entry) => entry.id), expectedOrder, '冻结顺序不符');
  const seen = new Set();
  for (const entry of frozen.requests) {
    assert.equal(entry.method, 'POST', '存在非 POST 冻结请求');
    assert.equal(entry.expectedStatus, 201, '存在非 201 冻结请求');
    assert.equal(entry.route, '/skills/' + entry.skillKey + '/trigger-rules', '冻结 POST 路径越界');
    assert.equal(entry.detailRoute, entry.route + '/' + entry.ruleKey, '冻结详情路径不符');
    assert.equal(seen.has(entry.detailRoute), false, '冻结请求目标重复');
    seen.add(entry.detailRoute);
    assert.equal(entry.bodySha256, shaValue(entry.body), '冻结请求体散列不符：' + entry.id);
    const target = targetById.get(entry.id);
    assertCondition(target && target.skillKey === entry.skillKey && target.ruleKey === entry.ruleKey, '冻结目标映射不符：' + entry.id);
    validateCandidateBody(target, entry.body);
  }
}

function validateCandidateBody(target, body) {
  const expected = {
    black: { eventType: 'DAMAGE_DEALT', detail: { damageTypeKey: 'physics', deliveryKind: 'ANY', originKind: 'ANY' } },
    magic: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
    stridebreaker: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'item_6631_active' } },
    triumph: { eventType: 'KILL', detail: {} }
  }[target.id];
  assert.deepEqual(body.eventSource, { eventType: expected.eventType, detail: expected.detail }, target.name + ' 事件不符');
  const conditions = (body.conditionGroups || []).flatMap((group) => group.conditions || []);
  const category = conditions.find((condition) => condition.conditionType === 'TARGET_CATEGORY_CHECK');
  assertCondition(category, target.name + ' 缺少英雄类别条件');
  assert.deepEqual(category.detail?.categories, ['CHAMPION'], target.name + ' 英雄类别条件不符');
  const action = (body.actions || []).find((item) => item.actionType === 'EXECUTE_EFFECT'
    && item.detail?.effectKey === target.effectKey);
  assertCondition(action, target.name + ' 缺少目标效果动作');
  assert.equal(action.targetContext, 'CURRENT_TARGET', target.name + ' 动作目标上下文不符');
  assert.equal(body.perTargetCooldown, null, target.name + ' 逐目标冷却不符');
  assert.equal(body.maxTriggersPerProcess, null, target.name + ' 过程触发次数不符');
}

function targetRoutes(config) {
  const skill = '/skills/' + encodeURIComponent(config.skillKey);
  const owner = config.ownerKind === 'equipment'
    ? '/equipment/' + encodeURIComponent(config.ownerKey)
    : '/runes/' + encodeURIComponent(config.ownerKey);
  const ownerImage = config.ownerKind === 'equipment'
    ? owner + '/representative-image'
    : null;
  const relation = config.ownerKind === 'equipment'
    ? '/equipment-skill-relations?equipmentKey=' + encodeURIComponent(config.ownerKey)
    : '/rune-skill-relations?runeKey=' + encodeURIComponent(config.ownerKey);
  const routes = {
    subject: skill,
    owner,
    relation,
    relationFiltered: relation + '&skillKey=' + encodeURIComponent(config.skillKey),
    skillRepresentativeImage: skill + '/representative-image'
  };
  if (ownerImage) routes.ownerRepresentativeImage = ownerImage;
  return { skill, routes };
}

async function request(method, route, body = undefined) {
  if (!allowedMethods.has(method)) throw new Error('拒绝未批准的方法：' + method);
  if (method === 'GET') report.getCount += 1;
  if (method === 'POST') {
    report.businessWriteCount += 1;
    const allowed = frozen.requests.some((entry) => entry.method === 'POST' && entry.route === route);
    if (!allowed) throw new Error('POST 越界：' + route);
  }
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

async function readTarget(config, expectedCandidateStatus) {
  const routeInfo = targetRoutes(config);
  const staticResponses = {};
  for (const [key, route] of Object.entries(routeInfo.routes)) {
    staticResponses[key] = await request('GET', route);
    requireStatus(staticResponses[key], 200, config.name + ' ' + route);
  }
  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const listRoute = routeInfo.skill + '/' + apiName;
    const list = await request('GET', listRoute);
    const items = arrayData(list, config.name + ' ' + listRoute);
    const keys = sortedUnique(items.map((item) => item[keyName]), config.name + ' ' + listRoute);
    const detailRoutes = keys.map((key) => listRoute + '/' + encodeURIComponent(key));
    const details = await getMany(detailRoutes);
    details.forEach((response, index) => requireStatus(response, 200, config.name + ' ' + detailRoutes[index]));
    components[apiName] = {
      list,
      items,
      keys,
      details: details.map((response, index) => ({ key: keys[index], response }))
    };
  }
  const candidateRoute = routeInfo.skill + '/trigger-rules/' + encodeURIComponent(config.ruleKey);
  const candidateDetail = await request('GET', candidateRoute);
  requireStatus(candidateDetail, expectedCandidateStatus, config.name + ' 候选规则详情');
  const target = {
    id: config.id,
    name: config.name,
    ownerKind: config.ownerKind,
    ownerKey: config.ownerKey,
    skillKey: config.skillKey,
    candidateRuleKey: config.ruleKey,
    staticResponses,
    components,
    candidateDetail,
    nonRule: {
      static: Object.fromEntries(Object.entries(staticResponses).map(([key, response]) => [key, response.data])),
      components: Object.fromEntries(
        componentKinds
          .filter(([apiName]) => apiName !== 'trigger-rules')
          .map(([apiName]) => [apiName, {
            list: components[apiName].list.data,
            details: components[apiName].details.map(({ key, response }) => ({ key, data: response.data }))
          }])
      )
    }
  };
  validateTargetComposition(config, target);
  return target;
}

function validateTargetComposition(config, target) {
  const subject = target.staticResponses.subject.data;
  assert.equal(subject.skillKey, config.skillKey, config.name + ' 技能主体键不符');
  const owner = target.staticResponses.owner.data;
  const ownerKeyName = config.ownerKind === 'equipment' ? 'equipmentKey' : 'runeKey';
  assert.equal(owner[ownerKeyName], config.ownerKey, config.name + ' 所有者主体键不符');
  const relationItems = target.staticResponses.relation.data?.items || [];
  const filteredItems = target.staticResponses.relationFiltered.data?.items || [];
  const relationMatches = (item) => item.skillKey === config.skillKey
    && (item.equipmentKey === config.ownerKey || item.runeKey === config.ownerKey);
  assertCondition(relationItems.some(relationMatches), config.name + ' 全量关系缺少目标');
  assertCondition(filteredItems.some(relationMatches), config.name + ' 过滤关系缺少目标');
  assert.equal(target.staticResponses.skillRepresentativeImage.data?.image?.imageKey, config.ownerKey, config.name + ' 技能代表图键不符');
  if (config.ownerKind === 'equipment') {
    assert.equal(target.staticResponses.ownerRepresentativeImage.data?.image?.imageKey, config.ownerKey, config.name + ' 装备代表图键不符');
  }
  const effect = target.components.effects.details.find(({ key }) => key === config.effectKey)?.response.data;
  assertCondition(effect && Array.isArray(effect.results) && effect.results.length > 0, config.name + ' 效果或结果缺失');
  const result = config.id === 'black'
    ? effect.results.find((item) => item.resultKey === 'armor_reduction')
    : config.id === 'triumph'
      ? effect.results.find((item) => item.resultKey === 'result')
      : effect.results.find((item) => item.resultKey === 'damage');
  assertCondition(result, config.name + ' 代表结果缺失');
  assert.equal(result.target, config.id === 'triumph' ? 'SOURCE' : 'TARGET', config.name + ' 结果目标不符');
}

async function scanRules(passName) {
  const skillsResponse = await request('GET', '/skills');
  const skills = arrayData(skillsResponse, passName + '全技能目录');
  const skillKeys = sortedUnique(skills.map((skill) => skill.skillKey), passName + '全技能目录');
  if (typeof skillsResponse.data?.total === 'number') {
    assert.equal(skillsResponse.data.total, skills.length, passName + '技能目录 total 不符');
  }
  const listResponses = await getMany(skillKeys.map((skillKey) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules'));
  const lists = listResponses.map((response, index) => {
    const skillKey = skillKeys[index];
    const rules = arrayData(response, passName + '规则列表 ' + skillKey);
    const ruleKeys = sortedUnique(rules.map((rule) => rule.ruleKey), passName + '规则列表 ' + skillKey);
    return { skillKey, response, rules, ruleKeys };
  });
  const refs = lists
    .flatMap(({ skillKey, ruleKeys }) => ruleKeys.map((ruleKey) => ({ skillKey, ruleKey })))
    .sort((left, right) => ruleId(left.skillKey, left.ruleKey).localeCompare(ruleId(right.skillKey, right.ruleKey)));
  const detailResponses = await getMany(refs.map(({ skillKey, ruleKey }) =>
    '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules/' + encodeURIComponent(ruleKey)));
  detailResponses.forEach((response, index) =>
    requireStatus(response, 200, passName + '规则详情 ' + ruleId(refs[index].skillKey, refs[index].ruleKey)));
  return {
    passName,
    skillsResponse,
    skills,
    skillKeys,
    lists,
    refs,
    details: detailResponses.map((response, index) => ({ ...refs[index], response })),
    eventTypeCounts: detailResponses.reduce((counts, response) => {
      const eventType = response.data?.eventSource?.eventType;
      if (eventType) counts[eventType] = (counts[eventType] || 0) + 1;
      return counts;
    }, {}),
    ruleCount: refs.length
  };
}

function baselineRuleLists() {
  return baseline.preservation?.existingRuleLists || baseline.globalBaseline?.first?.ruleLists || [];
}

function baselineRuleDetails() {
  return baseline.preservation?.existingRuleDetails || baseline.globalBaseline?.first?.ruleDetails || [];
}

function baselineSkillKeys() {
  return baseline.globalBaseline?.first?.skillKeys || [];
}

function oldRuleIdSet() {
  return new Set(baselineRuleDetails().map((item) => ruleId(item.skillKey, item.ruleKey)));
}

function compareOldRules(scan, context, exactLists) {
  const oldDetails = baselineRuleDetails();
  const oldMap = new Map(oldDetails.map((item) => [ruleId(item.skillKey, item.ruleKey), item.response?.data]));
  const oldIds = [...oldMap.keys()].sort();
  const currentIds = scan.refs.map((item) => ruleId(item.skillKey, item.ruleKey)).filter((id) => oldMap.has(id)).sort();
  assert.deepEqual(currentIds, oldIds, context + ' 旧规则键集合变化');
  for (const item of scan.details) {
    const id = ruleId(item.skillKey, item.ruleKey);
    if (oldMap.has(id)) assert.equal(equal(item.response.data, oldMap.get(id)), true, context + ' 旧规则详情变化：' + id);
  }
  const expectedLists = baselineRuleLists();
  const expectedBySkill = new Map(expectedLists.map((item) => [item.skillKey, item]));
  for (const current of scan.lists) {
    const expected = expectedBySkill.get(current.skillKey);
    assertCondition(expected, context + ' 出现未知技能规则列表：' + current.skillKey);
    const currentOld = current.rules.filter((item) => oldMap.has(ruleId(current.skillKey, item.ruleKey)));
    const expectedOld = expected.rules.filter((item) => oldMap.has(ruleId(expected.skillKey, item.ruleKey)));
    assert.equal(equal(currentOld, expectedOld), true, context + ' 旧规则列表摘要变化：' + current.skillKey);
    if (exactLists) assert.equal(equal(current.response, expected.response), true, context + ' 规则列表响应变化：' + current.skillKey);
  }
  assert.equal(scan.skillKeys.length, expectedCurrent.skillCount, context + ' 技能数变化');
  assert.equal(scan.details.filter((item) => oldMap.has(ruleId(item.skillKey, item.ruleKey))).length, expectedCurrent.ruleCount, context + ' 旧规则详情数变化');
}

function compareTargetNonRule(currentTargets, context) {
  const expected = baseline.preservation?.targetNonRuleSnapshots || {};
  for (const target of currentTargets) {
    assertCondition(expected[target.id], context + ' 缺少目标基线：' + target.id);
    assert.equal(equal(target.nonRule, expected[target.id]), true, context + ' 目标非规则组成变化：' + target.id);
  }
}

function candidateEntryByTarget(target) {
  return frozen.requests.find((entry) => entry.id === target.id);
}

async function preflight() {
  validateFrozen();
  validateReview();
  assert.equal(baseline.schemaVersion, 2, '写前现值版本不符');
  assert.equal(baseline.revision, 'rev2', '写前现值修订号不符');
  assert.equal(baseline.frozenRequestSha256, fileSha('02-合并冻结请求.json'), '冻结请求散列与写前现值不符');
  assert.equal(baseline.sourceSnapshotSha256, fileSha('03-来源散列快照.json'), '来源散列与写前现值不符');
  assert.equal(baseline.businessWrites, 0, '写前现值已有业务写入');
  assert.equal(baseline.requestPolicy?.method, 'GET', '写前现值方法策略不是 GET');
  assert.deepEqual(baseline.expectedCurrent, expectedCurrent, '写前现值计数不符');
  assert.equal(baseline.preservation?.existingRuleCount, expectedCurrent.ruleCount, '写前现值未保存旧 96 条');
  assert.equal(baselineRuleDetails().length, expectedCurrent.ruleCount, '写前现值旧规则详情不完整');
  assert.equal(baselineRuleLists().length, expectedCurrent.skillCount, '写前现值规则列表不完整');
  const firstScan = await scanRules('写入前第一轮');
  const firstTargets = [];
  for (const target of targetConfigs) firstTargets.push(await readTarget(target, 404));
  compareOldRules(firstScan, '写入前第一轮', true);
  compareTargetNonRule(firstTargets, '写入前第一轮');
  const secondScan = await scanRules('写入前第二轮');
  const secondTargets = [];
  for (const target of targetConfigs) secondTargets.push(await readTarget(target, 404));
  compareOldRules(secondScan, '写入前第二轮', true);
  compareTargetNonRule(secondTargets, '写入前第二轮');
  assert.equal(equal(firstScan.refs, secondScan.refs), true, '写入前两轮规则键集合不稳定');
  assert.equal(equal(firstTargets.map((target) => target.nonRule), secondTargets.map((target) => target.nonRule)), true, '写入前两轮目标组成不稳定');
  assert.equal(firstScan.ruleCount, expectedCurrent.ruleCount, '首写前规则总数不是 96');
  assert.equal(secondScan.ruleCount, expectedCurrent.ruleCount, '首写前第二轮规则总数不是 96');
  assert.equal(firstScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '首写前 SOURCE_INITIALIZED 不是 24');
  assert.equal(secondScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '首写前第二轮 SOURCE_INITIALIZED 不是 24');
  report.preflight.rounds = [
    { pass: '写入前第一轮', skillCount: firstScan.skillKeys.length, ruleCount: firstScan.ruleCount, sourceInitializedCount: firstScan.eventTypeCounts.SOURCE_INITIALIZED || 0, ruleKeysSha256: shaValue(firstScan.refs) },
    { pass: '写入前第二轮', skillCount: secondScan.skillKeys.length, ruleCount: secondScan.ruleCount, sourceInitializedCount: secondScan.eventTypeCounts.SOURCE_INITIALIZED || 0, ruleKeysSha256: shaValue(secondScan.refs) }
  ];
  report.preflight.targetRounds = [
    { pass: '写入前第一轮', snapshots: firstTargets.map((target) => ({ id: target.id, candidateDetailStatus: target.candidateDetail.status, nonRuleSnapshotSha256: shaValue(target.nonRule) })) },
    { pass: '写入前第二轮', snapshots: secondTargets.map((target) => ({ id: target.id, candidateDetailStatus: target.candidateDetail.status, nonRuleSnapshotSha256: shaValue(target.nonRule) })) }
  ];
  saveReport();
}

async function executeWrites() {
  for (const entry of frozen.requests) {
    const target = targetById.get(entry.id);
    const candidateRoute = entry.detailRoute;
    const before = await request('GET', candidateRoute);
    requireStatus(before, 404, '写入前候选详情 ' + candidateRoute);
    const written = await request('POST', entry.route, entry.body);
    const writeLog = {
      id: entry.id,
      ruleKey: entry.ruleKey,
      method: 'POST',
      route: entry.route,
      detailRoute: candidateRoute,
      expectedStatus: 201,
      bodySha256: shaValue(entry.body),
      responseStatus: written.status,
      immediateReadback: null
    };
    report.writes.push(writeLog);
    saveReport();
    requireStatus(written, 201, '写入 ' + entry.route);
    assert.equal(subsetEqual(written.data, entry.body), true, '写入响应不包含冻结请求体：' + entry.id);
    const immediate = await request('GET', candidateRoute);
    writeLog.immediateReadback = immediate;
    saveReport();
    requireStatus(immediate, 200, '即时回读 ' + candidateRoute);
    assert.equal(subsetEqual(immediate.data, entry.body), true, '即时回读不包含冻结请求体：' + entry.id);
    assertCondition(target, '写入目标映射丢失：' + entry.id);
  }
}

async function finalReadback() {
  const finalTargets = [];
  for (const target of targetConfigs) finalTargets.push(await readTarget(target, 200));
  compareTargetNonRule(finalTargets, '最终回读');
  const finalScan = await scanRules('最终');
  const oldMap = new Map(baselineRuleDetails().map((item) => [ruleId(item.skillKey, item.ruleKey), item.response?.data]));
  const newMap = new Map(frozen.requests.map((entry) => [entry.detailRoute, entry]));
  const expectedIds = [...oldMap.keys(), ...frozen.requests.map((entry) => entry.skillKey + '/' + entry.ruleKey)].sort();
  const actualIds = finalScan.refs.map((item) => ruleId(item.skillKey, item.ruleKey)).sort();
  assert.deepEqual(actualIds, expectedIds, '最终规则键集合不是旧 96 条加四条新规则');
  assert.equal(finalScan.ruleCount, expectedCurrent.finalRuleCount, '最终规则总数不是 100');
  assert.equal(finalScan.details.length, expectedCurrent.finalRuleCount, '最终规则详情数不是 100');
  assert.equal(finalScan.skillKeys.length, expectedCurrent.skillCount, '最终技能数不是 1062');
  assert.equal(finalScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '最终 SOURCE_INITIALIZED 不是 24');
  compareOldRules(finalScan, '最终', false);
  const newDetailObservations = [];
  for (const item of finalScan.details) {
    const entry = newMap.get('/skills/' + item.skillKey + '/trigger-rules/' + item.ruleKey);
    if (entry) {
      validateCandidateBody(targetById.get(entry.id), entry.body);
      assert.equal(subsetEqual(item.response.data, entry.body), true, '新增规则最终回读不符：' + entry.id);
      newDetailObservations.push({ id: entry.id, status: item.response.status, bodySha256: shaValue(entry.body) });
    }
  }
  assert.equal(newDetailObservations.length, 4, '最终新规则详情不是四条');
  report.finalReadback = {
    targetSnapshots: finalTargets.map((target) => ({ id: target.id, candidateDetailStatus: target.candidateDetail.status, nonRuleSnapshotSha256: shaValue(target.nonRule) })),
    skillCount: finalScan.skillKeys.length,
    ruleCount: finalScan.ruleCount,
    sourceInitializedCount: finalScan.eventTypeCounts.SOURCE_INITIALIZED || 0,
    ruleKeysSha256: shaValue(finalScan.refs),
    newRuleDetails: newDetailObservations
  };
}

try {
  await preflight();
  await executeWrites();
  await finalReadback();
  assert.equal(report.businessWriteCount, 4, '成功前业务写入数不是 4');
  assert.equal(report.writes.length, 4, '成功前写入记录数不是 4');
  assert.equal(report.writes.every((entry) => entry.responseStatus === 201 && entry.immediateReadback?.status === 200), true, '存在未完成 201 与即时回读的写入');
  report.status = 'PASS';
  report.completedAt = new Date().toISOString();
  saveReport();
  process.stdout.write(JSON.stringify({
    status: report.status,
    revision: report.revision,
    businessWriteCount: report.businessWriteCount,
    getCount: report.getCount,
    immediateReadbacks: report.writes.length,
    finalRuleCount: report.finalReadback.ruleCount,
    sourceInitializedCount: report.finalReadback.sourceInitializedCount
  }, null, 2));
} catch (error) {
  report.status = 'FAILED';
  report.completedAt = new Date().toISOString();
  report.error = { message: error instanceof Error ? error.message : String(error) };
  saveReport();
  throw error;
}

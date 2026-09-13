import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { expectedCurrent, targetConfigs } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；写入脚本不会保存或输出令牌。');
if (process.env.DAMAGE_ALLOW_BUSINESS_WRITES !== '1') throw new Error('必须显式设置 DAMAGE_ALLOW_BUSINESS_WRITES=1 才允许业务写入。');
const MAX_POSTS = 6;
const reportPath = path.join(here, '06-写入与即时回读.json');
if (fs.existsSync(reportPath)) throw new Error('已存在06-写入与即时回读.json，拒绝重放。');

const componentKinds = [['parameters', 'parameterKey'], ['formulas', 'formulaKey'], ['effects', 'effectKey'], ['processes', 'processKey'], ['internal-states', 'stateKey'], ['trigger-rules', 'ruleKey']];
const targetById = new Map(targetConfigs.map((target) => [target.id, target]));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const shaValue = (value) => sha256(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const localPath = (name) => path.join(here, name);
const fileSha = (name) => sha256(fs.readFileSync(localPath(name)));
const readJson = (name) => JSON.parse(fs.readFileSync(localPath(name), 'utf8'));
const equal = (actual, expected) => isDeepStrictEqual(stable(actual), stable(expected));
const subsetEqual = (actual, expected) => {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => subsetEqual(actual[index], value));
  if (expected && typeof expected === 'object') return Boolean(actual && typeof actual === 'object' && !Array.isArray(actual)) && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && subsetEqual(actual[key], value));
  return Object.is(actual, expected);
};
const assertCondition = (condition, message) => assert.equal(Boolean(condition), true, message);
const ruleId = (skillKey, ruleKey) => skillKey + '/' + ruleKey;
const requireStatus = (response, expected, context) => { assert.equal(response.status, expected, context + ' 预期' + expected + '，实际' + response.status); return response; };
const arrayData = (response, context) => { requireStatus(response, 200, context); if (Array.isArray(response.data)) return response.data; if (Array.isArray(response.data?.items)) return response.data.items; throw new Error(context + ' 没有数组结果'); };
const sortedUnique = (values, context) => { assertCondition(values.every((value) => typeof value === 'string' && value.length > 0), context + ' 存在空键'); const sorted = [...values].sort(); assert.equal(new Set(sorted).size, sorted.length, context + ' 存在重复键'); return sorted; };

const frozen = readJson('02-合并冻结请求.json');
const baseline = readJson('04-共享写前现值.json');
const reviewedInputFiles = ['批次配置.mjs', '00-独立语义评审.json', 'README.md', '01-合并方案.md', '02-合并冻结请求.json', '03-来源散列快照.json', '04-共享写前现值.json', '受保护写入.mjs', '独立GET回读.mjs', '只读页面验收.mjs', 'Cursor终审只读检查.mjs'];
const requiredHashFiles = reviewedInputFiles;
const reviewFile = '05-Cursor独立评审.json';
const approvedSource = process.env.DAMAGE_APPROVED_HASHES_JSON
  ? JSON.parse(process.env.DAMAGE_APPROVED_HASHES_JSON)
  : (() => { const name = process.env.DAMAGE_APPROVED_HASHES_FILE || '批准散列.json'; if (!fs.existsSync(localPath(name))) throw new Error('缺少批准散列 JSON：' + name); return readJson(name); })();
const approvedHashes = approvedSource.files && typeof approvedSource.files === 'object' ? approvedSource.files : approvedSource;
if (!approvedHashes || typeof approvedHashes !== 'object') throw new Error('批准散列 JSON 结构不符');
for (const name of requiredHashFiles) { const expected = String(approvedHashes[name] || ''); assert(/^[a-f0-9]{64}$/i.test(expected), '缺少批准散列：' + name); assert.equal(fileSha(name).toLowerCase(), expected.toLowerCase(), name + ' 散列漂移'); }
if (!fs.existsSync(localPath(reviewFile))) throw new Error('缺少 Cursor 已接受证据：' + reviewFile);
const review = readJson(reviewFile);
const reviewHash = String(approvedHashes[reviewFile] || '');
assert(/^[a-f0-9]{64}$/i.test(reviewHash), '缺少 Cursor 评审证据批准散列：' + reviewFile);
assert.equal(fileSha(reviewFile).toLowerCase(), reviewHash.toLowerCase(), 'Cursor 评审证据散列漂移');
const reviewInputHashes = review.approvedInputHashes;
assertCondition(reviewInputHashes && typeof reviewInputHashes === 'object' && !Array.isArray(reviewInputHashes), 'Cursor 评审缺少 approvedInputHashes');
for (const name of reviewedInputFiles) {
  const reviewed = String(reviewInputHashes[name] || '');
  const approved = String(approvedHashes[name] || '');
  assert(/^[a-f0-9]{64}$/i.test(reviewed), 'Cursor 评审缺少输入散列：' + name);
  assert.equal(reviewed.toLowerCase(), approved.toLowerCase(), 'Cursor 评审与批准散列不一致：' + name);
  assert.equal(fileSha(name).toLowerCase(), reviewed.toLowerCase(), 'Cursor 评审输入散列漂移：' + name);
}

const report = { schemaVersion: 2, revision: 'rev1', startedAt: new Date().toISOString(), status: 'RUNNING', authorizationValueRecorded: false, approvedHashes, cursorReview: { file: reviewFile }, preflight: { rounds: [], targetRounds: [] }, writes: [], finalReadback: null, businessWriteCount: 0, getCount: 0, error: null };
const saveReport = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
const cursorParam = (review, key) => {
  const candidates = [review.params, review.model?.params, review.model];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const item = candidate.find((entry) => entry?.id === key || entry?.name === key);
      if (item) return item.value;
    } else if (candidate && typeof candidate === 'object' && Object.hasOwn(candidate, key)) {
      return candidate[key];
    }
  }
  return undefined;
};
function validateReview() {
  assert.equal(review.resultStatus, 'finished', 'Cursor 评审尚未完成');
  assert.equal(review.accepted, true, 'Cursor 评审没有accepted=true');
  assert.equal(review.revision, 'rev1', 'Cursor 评审不是rev1');
  assert.equal(review.reviewedPlanRevision, 1, 'Cursor 评审计划修订不为1');
  assert.equal(review.verdict, 'READY', 'Cursor 评审不是READY');
  assert.equal(review.status === undefined || review.status === 'READY', true, 'Cursor 评审状态不是READY');
  assert.equal(review.model?.id, 'grok-4.6', 'Cursor 评审模型不符');
  assert.equal(cursorParam(review, 'effort'), 'high', 'Cursor 评审推理强度不符');
  const fast = cursorParam(review, 'fast');
  assert.equal(fast === false || fast === 'false', true, 'Cursor 评审fast参数不符');
  assert.equal(review.checker?.status, 'READY', 'Cursor 检查器状态不是READY');
  assert.equal(review.checker?.verdict, 'READY', 'Cursor 检查器结论不是READY');
  assert.equal(review.businessWrites ?? review.apiWrites ?? 0, 0, 'Cursor 评审记录包含业务写入');
  assert.equal(review.writeAllowlistAudit?.auditAvailable, true, 'Cursor 评审缺少写入白名单审计');
  assert.equal(review.writeAllowlistAudit?.runDeltaCount, 0, 'Cursor 评审运行差异不为0');
  assert.equal(review.writeAllowlistAudit?.outsideScopeCount, 0, 'Cursor 评审存在范围外调用');
  assert.equal(review.writeAllowlistAudit?.runDeltaOutsideScopeCount, 0, 'Cursor 评审运行范围外差异不为0');
  assert.equal(review.toolEvents?.allTerminalCallsCompleted, true, 'Cursor 评审工具调用未完成');
  assert.equal(review.toolEvents?.anyTruncated, false, 'Cursor 评审存在截断输出');
  assertCondition(Array.isArray(review.reviewedFiles), 'Cursor 评审缺少reviewedFiles');
  assert.deepEqual([...review.reviewedFiles].sort(), [...reviewedInputFiles].sort(), 'Cursor 评审文件范围不符');
  assert.equal(Object.hasOwn(reviewInputHashes, reviewFile), false, 'Cursor 评审输入散列不应包含自身');
  for (const name of reviewedInputFiles) assertCondition(review.reviewedFiles.includes(name), 'Cursor 评审未覆盖' + name);
  report.cursorReview = { file: reviewFile, status: review.status || review.verdict, accepted: review.accepted, revision: review.revision, reviewedPlanRevision: review.reviewedPlanRevision, resultStatus: review.resultStatus, model: review.model, params: review.params, checker: review.checker, businessWrites: 0, approvedInputHashes: reviewInputHashes, writeAllowlistAudit: review.writeAllowlistAudit, toolEvents: review.toolEvents };
}
function validateBody(target, body) {
  assert.equal(body.ruleKey, target.ruleKey, target.name + ' 规则键不符');
  assert.deepEqual(body.eventSource, { eventType: target.eventType, detail: target.eventDetail }, target.name + ' 事件明细不符');
  const category = (body.conditionGroups || []).flatMap((group) => group.conditions || []).find((item) => item.conditionType === 'TARGET_CATEGORY_CHECK');
  if (target.conditionKind === 'NONE') assert.equal((body.conditionGroups || []).length, 0, target.name + ' 不应有条件组');
  else {
    assert.equal(Array.isArray(body.conditionGroups), true, target.name + ' 条件组不是数组');
    assert.equal(body.conditionGroups.length, 1, target.name + ' 必须只有一个条件组');
    assert.equal(Array.isArray(body.conditionGroups[0].conditions), true, target.name + ' 条件项不是数组');
    assert.equal(body.conditionGroups[0].conditions.length, 1, target.name + ' 必须只有一个条件');
    assert.equal(category, body.conditionGroups[0].conditions[0], target.name + ' 条件项不是预期类别条件');
    assert.equal(category.conditionType, 'TARGET_CATEGORY_CHECK', target.name + ' 条件类型不符');
    assert.deepEqual(category.detail?.categories, ['CHAMPION'], target.name + ' 英雄类别条件不符');
  }
  assertCondition(Array.isArray(target.actions), target.name + ' 配置缺少actions');
  assert.deepEqual(body.actions, target.actions, target.name + ' 动作结构或顺序不符');
  assert.equal(body.perTargetCooldown, null, target.name + ' 逐目标冷却不符');
  assert.equal(body.maxTriggersPerProcess, null, target.name + ' 过程触发次数不符');
}
function validateFrozen() {
  assert.equal(targetConfigs.length, MAX_POSTS, '本批目标数量不是六项');
  assert.equal(frozen.schemaVersion, 2, '冻结版本不符'); assert.equal(frozen.planRevision, 1, '冻结计划修订不符'); assert.equal(frozen.revision, 'rev1', '冻结修订号不符'); assert.equal(frozen.status, 'READY', '冻结状态不是READY'); assert.equal(frozen.writable, true, '冻结请求不可写');
  assert.deepEqual(frozen.expectedCurrent, expectedCurrent, '冻结基线计数不符'); assert.equal(frozen.semanticReviewSha256, fileSha('00-独立语义评审.json'), '独立语义评审散列不符'); assert.equal(frozen.sourceSnapshotSha256, fileSha('03-来源散列快照.json'), '来源散列不符'); assert.equal(frozen.requests?.length, MAX_POSTS, '冻结请求数量不是六项'); assert.equal(frozen.writeBoundary?.businessWriteCount, MAX_POSTS, '冻结写入数不是六项'); assert.deepEqual(frozen.writeBoundary?.methods, ['POST'], '冻结方法边界不符'); assert.equal(frozen.writeBoundary?.noPutPatchDelete, true, '冻结边界允许非POST方法'); assert.equal(frozen.writeBoundary?.noReplayIfReportExists, true, '冻结边界未禁止重放');
  assert.deepEqual(frozen.requests.map((entry) => entry.id), targetConfigs.map((target) => target.id), '冻结顺序不符');
  const seen = new Set();
  for (const entry of frozen.requests) {
    const target = targetById.get(entry.id); assertCondition(target, '未知冻结目标：' + entry.id); assert.equal(entry.method, 'POST', '存在非POST冻结请求'); assert.equal(entry.expectedStatus, 201, '存在非201冻结请求'); assert.equal(entry.route, '/skills/' + entry.skillKey + '/trigger-rules', '冻结写入路径越界'); assert.equal(entry.detailRoute, entry.route + '/' + entry.ruleKey, '冻结详情路径不符'); assert.equal(seen.has(entry.detailRoute), false, '冻结目标重复'); seen.add(entry.detailRoute);
    assert(/^[a-f0-9]{64}$/i.test(String(entry.bodySha256 || '')), '缺少bodySha256：' + entry.id); assert.equal(entry.bodySha256, shaValue(entry.body), '冻结请求体散列不符：' + entry.id); validateBody(target, entry.body);
  }
}
function targetRoutes(config) {
  const skill = '/skills/' + encodeURIComponent(config.skillKey);
  const owner = config.ownerKind === 'equipment' ? '/equipment/' + encodeURIComponent(config.ownerKey) : '/characters/' + encodeURIComponent(config.ownerKey);
  const relations = config.ownerKind === 'equipment' ? 'equipment-skill-relations' : 'character-skill-relations';
  const ownerKeyName = config.ownerKind === 'equipment' ? 'equipmentKey' : 'characterKey';
  return { skill, owner, ownerKeyName, static: { subject: skill, owner, ownerAttributes: owner + '/attributes', ownerRepresentativeImage: owner + '/representative-image', relation: '/' + relations + '?' + ownerKeyName + '=' + encodeURIComponent(config.ownerKey), relationFiltered: '/' + relations + '?skillKey=' + encodeURIComponent(config.skillKey), skillRepresentativeImage: skill + '/representative-image' } };
}
function validateEffect(config, target) {
  for (const check of config.effectChecks) {
    const effect = target.components.effects.details.find(({ key }) => key === check.effectKey)?.response.data;
    assertCondition(effect, config.name + ' 缺少已有效果：' + check.effectKey);
    const result = effect.results?.find((item) => item.resultKey === check.resultKey);
    assertCondition(result, config.name + ' 缺少已有结果：' + check.resultKey);
    assert.equal(result.resultType, check.resultType, config.name + ' 结果类型不符：' + check.effectKey);
    assert.equal(result.target, check.resultTarget, config.name + ' 结果目标不符：' + check.effectKey);
    assert.equal(result.valueRule?.value?.kind, check.valueKind, config.name + ' 结果取值种类不符：' + check.effectKey);
    const actualValueKey = check.valueKind === 'FORMULA' ? result.valueRule?.value?.formulaKey : result.valueRule?.value?.parameterKey;
    assert.equal(actualValueKey, check.valueKey, config.name + ' 结果取值键不符：' + check.effectKey);
    if (check.valueKind === 'FORMULA') assertCondition(target.components.formulas.keys.includes(check.valueKey), config.name + ' 缺少公式：' + check.valueKey);
    if (check.valueKind === 'PARAMETER') assertCondition(target.components.parameters.keys.includes(check.valueKey), config.name + ' 缺少参数：' + check.valueKey);
    if (check.durationParameterKey) assert.deepEqual(effect.lifecycle?.durationValue, { kind: 'PARAMETER', parameterKey: check.durationParameterKey }, config.name + ' 持续时间不符：' + check.effectKey);
    if (check.absorbedDamageTypeKey) assert.equal(result.detail?.absorbedDamageTypeKey, check.absorbedDamageTypeKey, config.name + ' 护盾吸收类型不符：' + check.effectKey);
  }
}
function validateProcess(config, target) {
  if (!config.processCheck) return;
  const check = config.processCheck;
  const process = target.components.processes.details.find(({ key }) => key === check.processKey)?.response.data;
  assertCondition(process, config.name + ' 缺少已有过程：' + check.processKey);
  assert.equal(process.activationType, check.activationType, config.name + ' 过程启动类型不符');
  assert.deepEqual(process.cooldown?.durationValue, { kind: 'PARAMETER', parameterKey: check.cooldownParameterKey }, config.name + ' 过程冷却参数不符');
  assert.deepEqual(process.cooldown?.startMoment, { momentType: 'PROCESS_START', stepKey: null }, config.name + ' 过程冷却起点不符');
  const actualSteps = (process.steps || []).map((step) => ({ stepKey: step.stepKey, stepType: step.stepType, sortOrder: step.sortOrder }));
  assert.deepEqual(actualSteps, check.steps, config.name + ' 过程步骤不符');
  const actualBindings = (process.effectBindings || []).map((binding) => ({
    bindingKey: binding.bindingKey,
    effectKey: binding.effectKey,
    momentType: binding.moment?.momentType,
    stepKey: binding.moment?.stepKey ?? null,
    sortOrder: binding.sortOrder
  }));
  assert.deepEqual(actualBindings, check.effectBindings, config.name + ' 过程效果绑定或顺序不符');
}
async function request(method, route, body) {
  if (!['GET', 'POST'].includes(method)) throw new Error('拒绝未批准的方法：' + method);
  if (method === 'GET') report.getCount += 1;
  if (method === 'POST') { assertCondition(report.businessWriteCount < MAX_POSTS, 'POST次数超过六次'); report.businessWriteCount += 1; assertCondition(frozen.requests.some((entry) => entry.method === 'POST' && entry.route === route), 'POST越界：' + route); }
  const response = await fetch(baseUrl + route, { method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const raw = await response.text(); let data = null; if (raw) { try { data = JSON.parse(raw); } catch { data = { parseError: true, responseBytes: Buffer.byteLength(raw) }; } }
  return { method, route, status: response.status, data };
}
async function getMany(routes, concurrency = 24) { const result = new Array(routes.length); let cursor = 0; async function worker() { while (true) { const index = cursor++; if (index >= routes.length) return; result[index] = await request('GET', routes[index]); } } await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker())); return result; }
async function readTarget(config, expectedCandidateStatus) {
  const routeInfo = targetRoutes(config); const staticResponses = {};
  for (const [key, route] of Object.entries(routeInfo.static)) staticResponses[key] = requireStatus(await request('GET', route), 200, config.name + ' ' + route);
  const subject = staticResponses.subject.data; assert.equal(subject?.skillKey, config.skillKey, config.name + ' 技能主体键不符'); const owner = staticResponses.owner.data; assert.equal(owner?.[routeInfo.ownerKeyName], config.ownerKey, config.name + ' 所有者主体键不符');
  const relationMatch = (item) => item.skillKey === config.skillKey && item[routeInfo.ownerKeyName] === config.ownerKey; assertCondition(arrayData(staticResponses.relation, config.name + ' 全量关系').some(relationMatch), config.name + ' 全量关系缺少目标'); assertCondition(arrayData(staticResponses.relationFiltered, config.name + ' 反向关系').some(relationMatch), config.name + ' 反向关系缺少目标');
  for (const key of ['ownerRepresentativeImage', 'skillRepresentativeImage']) { const image = staticResponses[key].data?.image; assertCondition(image?.enabled === true && typeof image.imageKey === 'string' && image.imageKey.length > 0, config.name + ' 图片不可用'); }
  const components = {};
  for (const [apiName, keyName] of componentKinds) { const listRoute = routeInfo.skill + '/' + apiName; const list = await request('GET', listRoute); const items = arrayData(list, config.name + ' ' + listRoute); const keys = sortedUnique(items.map((item) => item[keyName]), config.name + ' ' + listRoute); const details = await getMany(keys.map((key) => listRoute + '/' + encodeURIComponent(key))); details.forEach((response, index) => requireStatus(response, 200, config.name + ' 组成详情 ' + keys[index])); components[apiName] = { list, items, keys, details: details.map((response, index) => ({ key: keys[index], response })) }; }
  const candidateRoute = routeInfo.skill + '/trigger-rules/' + encodeURIComponent(config.ruleKey); const candidateDetail = requireStatus(await request('GET', candidateRoute), expectedCandidateStatus, config.name + ' 候选详情');
  const target = { id: config.id, name: config.name, ownerKind: config.ownerKind, ownerKey: config.ownerKey, skillKey: config.skillKey, candidateRuleKey: config.ruleKey, staticResponses, components, candidateDetail, nonRule: { static: Object.fromEntries(Object.entries(staticResponses).map(([key, response]) => [key, response.data])), components: Object.fromEntries(componentKinds.filter(([apiName]) => apiName !== 'trigger-rules').map(([apiName]) => [apiName, { list: components[apiName].list.data, details: components[apiName].details.map(({ key, response }) => ({ key, data: response.data })) }])) } };
  validateEffect(config, target);
  validateProcess(config, target);
  return target;
}
async function scanRules(passName) {
  const skillsResponse = await request('GET', '/skills'); const skills = arrayData(skillsResponse, passName + '全技能目录'); const skillKeys = sortedUnique(skills.map((skill) => skill.skillKey), passName + '全技能目录'); assert.equal(skillKeys.length, expectedCurrent.skillCount, passName + ' 技能数不是1062');
  const listResponses = await getMany(skillKeys.map((skillKey) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules')); const lists = listResponses.map((response, index) => { const rules = arrayData(response, passName + ' 规则列表 ' + skillKeys[index]); const ruleKeys = sortedUnique(rules.map((rule) => rule.ruleKey), passName + ' 规则列表 ' + skillKeys[index]); return { skillKey: skillKeys[index], response, rules, ruleKeys }; });
  const refs = lists.flatMap(({ skillKey, ruleKeys }) => ruleKeys.map((ruleKey) => ({ skillKey, ruleKey }))).sort((left, right) => ruleId(left.skillKey, left.ruleKey).localeCompare(ruleId(right.skillKey, right.ruleKey))); const detailResponses = await getMany(refs.map(({ skillKey, ruleKey }) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules/' + encodeURIComponent(ruleKey))); detailResponses.forEach((response, index) => requireStatus(response, 200, passName + ' 规则详情 ' + ruleId(refs[index].skillKey, refs[index].ruleKey))); const details = detailResponses.map((response, index) => ({ ...refs[index], response })); const eventTypeCounts = details.reduce((counts, item) => { const eventType = item.response.data?.eventSource?.eventType; if (eventType) counts[eventType] = (counts[eventType] || 0) + 1; return counts; }, {}); return { passName, skillsResponse, skills, skillKeys, lists, refs, details, ruleCount: refs.length, eventTypeCounts };
}
const baselineRuleDetails = () => baseline.preservation?.existingRuleDetails || baseline.globalBaseline?.first?.ruleDetails || [];
const baselineRuleLists = () => baseline.preservation?.existingRuleLists || baseline.globalBaseline?.first?.ruleLists || [];
function compareOldRules(scan, context, exactLists) {
  const oldDetails = baselineRuleDetails(); assert.equal(oldDetails.length, expectedCurrent.ruleCount, context + ' 旧规则详情不完整'); const oldMap = new Map(oldDetails.map((item) => [ruleId(item.skillKey, item.ruleKey), item.response?.data])); const currentOld = scan.refs.map((item) => ruleId(item.skillKey, item.ruleKey)).filter((id) => oldMap.has(id)).sort(); assert.deepEqual(currentOld, [...oldMap.keys()].sort(), context + ' 旧规则键集合变化');
  for (const item of scan.details) { const id = ruleId(item.skillKey, item.ruleKey); if (oldMap.has(id)) assert.equal(equal(item.response.data, oldMap.get(id)), true, context + ' 旧规则详情变化：' + id); }
  const expectedBySkill = new Map(baselineRuleLists().map((item) => [item.skillKey, item])); for (const current of scan.lists) { const expected = expectedBySkill.get(current.skillKey); assertCondition(expected, context + ' 旧规则列表缺少技能：' + current.skillKey); const currentOldRules = current.rules.filter((item) => oldMap.has(ruleId(current.skillKey, item.ruleKey))); const expectedOldRules = expected.rules.filter((item) => oldMap.has(ruleId(expected.skillKey, item.ruleKey))); assert.equal(equal(currentOldRules, expectedOldRules), true, context + ' 旧规则列表摘要变化：' + current.skillKey); if (exactLists) assert.equal(equal(current.response, expected.response), true, context + ' 旧规则列表响应变化：' + current.skillKey); }
}
function compareTargetNonRule(targets, context) { const expected = baseline.preservation?.targetNonRuleSnapshots || {}; for (const target of targets) { assertCondition(expected[target.id], context + ' 缺少目标非规则基线：' + target.id); assert.equal(equal(target.nonRule, expected[target.id]), true, context + ' 目标非规则组成变化：' + target.id); } }
async function preflight() {
  validateFrozen(); validateReview(); assert.equal(baseline.status, 'CAPTURED', '写前现值尚未由准备脚本取得'); assert.equal(baseline.schemaVersion, 2, '写前现值版本不符'); assert.equal(baseline.revision, 'rev1', '写前现值修订不符'); assert.equal(baseline.semanticReviewSha256, fileSha('00-独立语义评审.json'), '写前独立语义评审散列不符'); assert.equal(baseline.frozenRequestSha256, fileSha('02-合并冻结请求.json'), '写前冻结散列不符'); assert.equal(baseline.sourceSnapshotSha256, fileSha('03-来源散列快照.json'), '写前来源散列不符'); assert.equal(baseline.businessWrites, 0, '写前现值已有业务写入'); assert.equal(baseline.requestPolicy?.method, 'GET', '写前方法策略不为GET'); assert.deepEqual(baseline.expectedCurrent, expectedCurrent, '写前计数不符'); assert.equal(baseline.preservation?.existingRuleCount, expectedCurrent.ruleCount, '写前未保存旧120条'); assert.equal(baselineRuleDetails().length, expectedCurrent.ruleCount, '写前旧规则详情不是120条'); assert.equal(baselineRuleLists().length, expectedCurrent.skillCount, '写前规则列表不是1062项');
  const firstScan = await scanRules('写入前第一轮'); const firstTargets = []; for (const target of targetConfigs) firstTargets.push(await readTarget(target, 404)); compareOldRules(firstScan, '写入前第一轮', true); compareTargetNonRule(firstTargets, '写入前第一轮');
  const secondScan = await scanRules('写入前第二轮'); const secondTargets = []; for (const target of targetConfigs) secondTargets.push(await readTarget(target, 404)); compareOldRules(secondScan, '写入前第二轮', true); compareTargetNonRule(secondTargets, '写入前第二轮');
  assert.equal(firstScan.ruleCount, expectedCurrent.ruleCount, '首写前规则总数不是120'); assert.equal(secondScan.ruleCount, expectedCurrent.ruleCount, '首写前第二轮规则总数不是120'); assert.equal(firstScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '首写前SOURCE_INITIALIZED不是24'); assert.equal(secondScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '首写前第二轮SOURCE_INITIALIZED不是24'); assert.equal(equal(firstScan.refs, secondScan.refs), true, '写入前两轮规则键集合不稳定'); assert.equal(equal(firstTargets.map((target) => target.nonRule), secondTargets.map((target) => target.nonRule)), true, '写入前两轮目标组成不稳定');
  report.preflight.rounds = [firstScan, secondScan].map((scan) => ({ pass: scan.passName, skillCount: scan.skillKeys.length, ruleCount: scan.ruleCount, sourceInitializedCount: scan.eventTypeCounts.SOURCE_INITIALIZED || 0, ruleKeysSha256: shaValue(scan.refs) })); report.preflight.targetRounds = [firstTargets, secondTargets].map((targets, index) => ({ pass: index === 0 ? '写入前第一轮' : '写入前第二轮', snapshots: targets.map((target) => ({ id: target.id, candidateDetailStatus: target.candidateDetail.status, nonRuleSnapshotSha256: shaValue(target.nonRule) })) })); saveReport();
}
async function executeWrites() {
  for (const entry of frozen.requests) { const before = await request('GET', entry.detailRoute); requireStatus(before, 404, '写入前候选详情 ' + entry.detailRoute); const written = await request('POST', entry.route, entry.body); const writeLog = { id: entry.id, ruleKey: entry.ruleKey, method: 'POST', route: entry.route, detailRoute: entry.detailRoute, expectedStatus: 201, bodySha256: shaValue(entry.body), responseStatus: written.status, immediateReadback: null }; report.writes.push(writeLog); saveReport(); requireStatus(written, 201, '写入 ' + entry.route); assert.equal(subsetEqual(written.data, entry.body), true, '写入响应不包含冻结请求体：' + entry.id); const immediate = await request('GET', entry.detailRoute); writeLog.immediateReadback = immediate; saveReport(); requireStatus(immediate, 200, '即时回读 ' + entry.detailRoute); assert.equal(subsetEqual(immediate.data, entry.body), true, '即时回读不包含冻结请求体：' + entry.id); }
}
async function finalReadback() {
  const finalTargets = []; for (const target of targetConfigs) finalTargets.push(await readTarget(target, 200)); compareTargetNonRule(finalTargets, '最终回读'); const finalScan = await scanRules('最终'); assert.equal(finalScan.ruleCount, expectedCurrent.finalRuleCount, '最终规则总数不是126'); assert.equal(finalScan.skillKeys.length, expectedCurrent.skillCount, '最终技能数不是1062'); assert.equal(finalScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '最终SOURCE_INITIALIZED不是24');
  const oldMap = new Map(baselineRuleDetails().map((item) => [ruleId(item.skillKey, item.ruleKey), item.response?.data])); const expectedIds = [...oldMap.keys(), ...frozen.requests.map((entry) => ruleId(entry.skillKey, entry.ruleKey))].sort(); const actualIds = finalScan.refs.map((item) => ruleId(item.skillKey, item.ruleKey)).sort(); assert.deepEqual(actualIds, expectedIds, '最终规则集合不是旧规则加本批新增规则'); compareOldRules(finalScan, '最终', false);
  const newObservations = []; for (const entry of frozen.requests) { const actual = finalScan.details.find((item) => item.skillKey === entry.skillKey && item.ruleKey === entry.ruleKey); assertCondition(actual, '缺少新增规则：' + entry.id); assert.equal(subsetEqual(actual.response.data, entry.body), true, '新增规则最终回读不符：' + entry.id); assert.equal(entry.bodySha256, shaValue(entry.body), '最终核对bodySha256不符：' + entry.id); newObservations.push({ id: entry.id, status: actual.response.status, bodySha256: entry.bodySha256 }); }
  report.finalReadback = { targetSnapshots: finalTargets.map((target) => ({ id: target.id, candidateDetailStatus: target.candidateDetail.status, nonRuleSnapshotSha256: shaValue(target.nonRule) })), skillCount: finalScan.skillKeys.length, ruleCount: finalScan.ruleCount, sourceInitializedCount: finalScan.eventTypeCounts.SOURCE_INITIALIZED || 0, ruleKeysSha256: shaValue(finalScan.refs), newRuleDetails: newObservations };
}

try { await preflight(); await executeWrites(); await finalReadback(); assert.equal(report.businessWriteCount, MAX_POSTS, '成功前业务写入数不是六次'); assert.equal(report.writes.length, MAX_POSTS, '成功前写入记录数不是六项'); assert.equal(report.businessWriteCount <= MAX_POSTS, true, '业务POST超过六次'); assert.equal(report.writes.every((entry) => entry.responseStatus === 201 && entry.immediateReadback?.status === 200), true, '存在未完成的201或即时回读'); report.status = 'PASS'; report.completedAt = new Date().toISOString(); saveReport(); process.stdout.write(JSON.stringify({ status: report.status, revision: report.revision, businessWriteCount: report.businessWriteCount, getCount: report.getCount, finalRuleCount: report.finalReadback.ruleCount, sourceInitializedCount: report.finalReadback.sourceInitializedCount }, null, 2)); }
catch (error) { report.status = 'FAILED'; report.completedAt = new Date().toISOString(); report.error = { message: error instanceof Error ? error.message : String(error) }; saveReport(); throw error; }

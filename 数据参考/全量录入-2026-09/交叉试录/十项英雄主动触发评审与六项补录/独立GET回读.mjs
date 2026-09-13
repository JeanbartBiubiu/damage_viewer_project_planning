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
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；独立回读只发送 GET。');
const reportPath = path.join(here, '07-独立GET回读.json');
if (fs.existsSync(reportPath)) throw new Error('已存在07-独立GET回读.json，拒绝覆盖。');

const componentKinds = [['parameters', 'parameterKey'], ['formulas', 'formulaKey'], ['effects', 'effectKey'], ['processes', 'processKey'], ['internal-states', 'stateKey'], ['trigger-rules', 'ruleKey']];
const targetById = new Map(targetConfigs.map((target) => [target.id, target]));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const shaValue = (value) => sha256(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const fileSha = (name) => sha256(fs.readFileSync(path.join(here, name)));
const equal = (actual, expected) => isDeepStrictEqual(stable(actual), stable(expected));
const assertCondition = (condition, message) => assert.equal(Boolean(condition), true, message);
const ruleId = (skillKey, ruleKey) => skillKey + '/' + ruleKey;
const report = { schemaVersion: 2, revision: 'rev1', startedAt: new Date().toISOString(), status: 'RUNNING', methodPolicy: 'GET_ONLY', authorizationValueRecorded: false, businessWrites: 0, getCount: 0, methods: { GET: 0 }, targets: [], global: null, error: null };
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
const requireStatus = (response, expected, context) => { assert.equal(response.status, expected, context + ' 预期' + expected + '，实际' + response.status); return response; };
const arrayData = (response, context) => { requireStatus(response, 200, context); if (Array.isArray(response.data)) return response.data; if (Array.isArray(response.data?.items)) return response.data.items; throw new Error(context + ' 没有数组结果'); };
const sortedUnique = (values, context) => { assertCondition(values.every((value) => typeof value === 'string' && value.length > 0), context + ' 存在空键'); const sorted = [...values].sort(); assert.equal(new Set(sorted).size, sorted.length, context + ' 存在重复键'); return sorted; };
async function get(route) { report.getCount += 1; report.methods.GET += 1; const response = await fetch(baseUrl + route, { method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) }); const raw = await response.text(); let data = null; if (raw) { try { data = JSON.parse(raw); } catch { data = { parseError: true, responseBytes: Buffer.byteLength(raw) }; } } return { method: 'GET', route, status: response.status, data }; }
async function getMany(routes, concurrency = 24) { const result = new Array(routes.length); let cursor = 0; async function worker() { while (true) { const index = cursor++; if (index >= routes.length) return; result[index] = await get(routes[index]); } } await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker())); return result; }
function targetRoutes(config) { const skill = '/skills/' + encodeURIComponent(config.skillKey); const owner = config.ownerKind === 'equipment' ? '/equipment/' + encodeURIComponent(config.ownerKey) : '/characters/' + encodeURIComponent(config.ownerKey); const relation = config.ownerKind === 'equipment' ? 'equipment-skill-relations' : 'character-skill-relations'; const ownerKeyName = config.ownerKind === 'equipment' ? 'equipmentKey' : 'characterKey'; return { skill, owner, ownerKeyName, static: { subject: skill, owner, ownerAttributes: owner + '/attributes', ownerRepresentativeImage: owner + '/representative-image', relation: '/' + relation + '?' + ownerKeyName + '=' + encodeURIComponent(config.ownerKey), relationFiltered: '/' + relation + '?skillKey=' + encodeURIComponent(config.skillKey), skillRepresentativeImage: skill + '/representative-image' } }; }
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
function validateBody(config, body) {
  assert.equal(body.ruleKey, config.ruleKey, config.name + ' 规则键不符');
  assert.deepEqual(body.eventSource, { eventType: config.eventType, detail: config.eventDetail }, config.name + ' 事件明细不符');
  if (config.conditionKind === 'NONE') assert.deepEqual(body.conditionGroups, [], config.name + ' 不应有条件组');
  else {
    assert.equal(body.conditionGroups?.length, 1, config.name + ' 条件组数量不符');
    assert.equal(body.conditionGroups[0].conditions?.length, 1, config.name + ' 条件数量不符');
    assert.equal(body.conditionGroups[0].conditions[0].conditionType, 'TARGET_CATEGORY_CHECK', config.name + ' 条件类型不符');
    assert.deepEqual(body.conditionGroups[0].conditions[0].detail?.categories, ['CHAMPION'], config.name + ' 英雄类别条件不符');
  }
  assert.deepEqual(body.actions, config.actions, config.name + ' 动作结构或顺序不符');
  assert.equal(body.perTargetCooldown, null, config.name + ' 逐目标冷却不符');
  assert.equal(body.maxTriggersPerProcess, null, config.name + ' 过程触发次数不符');
}
async function readTarget(config) {
  const info = targetRoutes(config); const staticResponses = {}; for (const [key, route] of Object.entries(info.static)) staticResponses[key] = requireStatus(await get(route), 200, config.name + ' ' + route);
  assert.equal(staticResponses.subject.data?.skillKey, config.skillKey, config.name + ' 技能主体键不符'); assert.equal(staticResponses.owner.data?.[info.ownerKeyName], config.ownerKey, config.name + ' 所有者主体键不符'); const match = (item) => item.skillKey === config.skillKey && item[info.ownerKeyName] === config.ownerKey; assertCondition(arrayData(staticResponses.relation, config.name + ' 全量关系').some(match), config.name + ' 全量关系缺少目标'); assertCondition(arrayData(staticResponses.relationFiltered, config.name + ' 反向关系').some(match), config.name + ' 反向关系缺少目标');
  for (const key of ['ownerRepresentativeImage', 'skillRepresentativeImage']) { const image = staticResponses[key].data?.image; assertCondition(image?.enabled === true && typeof image.imageKey === 'string' && image.imageKey.length > 0, config.name + ' 图片不可用'); }
  const components = {}; for (const [apiName, keyName] of componentKinds) { const listRoute = info.skill + '/' + apiName; const list = await get(listRoute); const items = arrayData(list, config.name + ' ' + listRoute); const keys = sortedUnique(items.map((item) => item[keyName]), config.name + ' ' + listRoute); const details = await getMany(keys.map((key) => listRoute + '/' + encodeURIComponent(key))); details.forEach((response, index) => requireStatus(response, 200, config.name + ' 组成详情 ' + keys[index])); components[apiName] = { list, items, keys, details: details.map((response, index) => ({ key: keys[index], response })) }; }
  const candidateRoute = info.skill + '/trigger-rules/' + encodeURIComponent(config.ruleKey); const candidateDetail = requireStatus(await get(candidateRoute), 200, config.name + ' 新规则详情');
  const target = { id: config.id, name: config.name, skillKey: config.skillKey, ownerKey: config.ownerKey, candidateRuleKey: config.ruleKey, staticResponses, components, candidateDetail, nonRule: { static: Object.fromEntries(Object.entries(staticResponses).map(([key, response]) => [key, response.data])), components: Object.fromEntries(componentKinds.filter(([apiName]) => apiName !== 'trigger-rules').map(([apiName]) => [apiName, { list: components[apiName].list.data, details: components[apiName].details.map(({ key, response }) => ({ key, data: response.data })) }])) } };
  validateEffect(config, target);
  validateProcess(config, target);
  return target;
}
async function scanRules() { const skillsResponse = await get('/skills'); const skills = arrayData(skillsResponse, '最终全技能目录'); const skillKeys = sortedUnique(skills.map((skill) => skill.skillKey), '最终全技能目录'); assert.equal(skillKeys.length, expectedCurrent.skillCount, '最终技能数不是1062'); const listsResponses = await getMany(skillKeys.map((skillKey) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules')); const lists = listsResponses.map((response, index) => { const rules = arrayData(response, '最终规则列表 ' + skillKeys[index]); const ruleKeys = sortedUnique(rules.map((rule) => rule.ruleKey), '最终规则列表 ' + skillKeys[index]); return { skillKey: skillKeys[index], response, rules, ruleKeys }; }); const refs = lists.flatMap(({ skillKey, ruleKeys }) => ruleKeys.map((ruleKey) => ({ skillKey, ruleKey }))).sort((left, right) => ruleId(left.skillKey, left.ruleKey).localeCompare(ruleId(right.skillKey, right.ruleKey))); const detailsResponses = await getMany(refs.map(({ skillKey, ruleKey }) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules/' + encodeURIComponent(ruleKey))); detailsResponses.forEach((response, index) => requireStatus(response, 200, '最终规则详情 ' + ruleId(refs[index].skillKey, refs[index].ruleKey))); const details = detailsResponses.map((response, index) => ({ ...refs[index], response })); const eventTypeCounts = details.reduce((counts, item) => { const eventType = item.response.data?.eventSource?.eventType; if (eventType) counts[eventType] = (counts[eventType] || 0) + 1; return counts; }, {}); return { skillsResponse, skills, skillKeys, lists, refs, details, eventTypeCounts, ruleCount: refs.length }; }
const oldRuleDetails = () => baseline.preservation?.existingRuleDetails || baseline.globalBaseline?.first?.ruleDetails || [];
const oldRuleLists = () => baseline.preservation?.existingRuleLists || baseline.globalBaseline?.first?.ruleLists || [];
function compareOld(scan) { const oldDetails = oldRuleDetails(); assert.equal(oldDetails.length, expectedCurrent.ruleCount, '旧规则详情不是120条'); const oldMap = new Map(oldDetails.map((item) => [ruleId(item.skillKey, item.ruleKey), item.response?.data])); const currentOldIds = scan.refs.map((item) => ruleId(item.skillKey, item.ruleKey)).filter((id) => oldMap.has(id)).sort(); assert.deepEqual(currentOldIds, [...oldMap.keys()].sort(), '旧120条规则键集合变化'); for (const item of scan.details) { const id = ruleId(item.skillKey, item.ruleKey); if (oldMap.has(id)) assert.equal(equal(item.response.data, oldMap.get(id)), true, '旧规则详情变化：' + id); } const expectedBySkill = new Map(oldRuleLists().map((item) => [item.skillKey, item])); for (const list of scan.lists) { const expected = expectedBySkill.get(list.skillKey); assertCondition(expected, '旧规则列表缺少技能：' + list.skillKey); const currentOld = list.rules.filter((item) => oldMap.has(ruleId(list.skillKey, item.ruleKey))); const expectedOld = expected.rules.filter((item) => oldMap.has(ruleId(expected.skillKey, item.ruleKey))); assert.equal(equal(currentOld, expectedOld), true, '旧规则列表摘要变化：' + list.skillKey); } }

const frozen = readJson('02-合并冻结请求.json');
const baseline = readJson('04-共享写前现值.json');
try {
  assert.equal(frozen.schemaVersion, 2, '冻结请求版本不符'); assert.equal(frozen.planRevision, 1, '冻结请求计划修订不符'); assert.equal(frozen.revision, 'rev1', '冻结请求不是rev1'); assert.equal(frozen.status, 'READY', '冻结请求状态不是READY'); assert.equal(frozen.writable, true, '冻结请求不可写'); assert.equal(frozen.requests?.length, targetConfigs.length, '冻结请求数量不符'); assert.equal(frozen.writeBoundary?.businessWriteCount, targetConfigs.length, '冻结写入数不符'); assert.deepEqual(frozen.writeBoundary?.methods, ['POST'], '冻结方法边界不符'); assert.equal(frozen.writeBoundary?.noPutPatchDelete, true, '冻结边界允许非POST方法'); assert.equal(frozen.writeBoundary?.noReplayIfReportExists, true, '冻结边界未禁止重放'); assert.deepEqual(frozen.expectedCurrent, expectedCurrent, '冻结基线计数不符'); assert.deepEqual(frozen.requests.map((entry) => entry.id), targetConfigs.map((target) => target.id), '冻结请求顺序不符'); for (const entry of frozen.requests) { const config = targetById.get(entry.id); assertCondition(config, '冻结请求存在未知目标：' + entry.id); assert.equal(entry.method, 'POST', '冻结请求存在非POST方法：' + entry.id); assert.equal(entry.expectedStatus, 201, '冻结请求状态不是201：' + entry.id); assert.equal(entry.route, '/skills/' + config.skillKey + '/trigger-rules', '冻结请求路径不符：' + entry.id); assert.equal(entry.detailRoute, entry.route + '/' + config.ruleKey, '冻结详情路径不符：' + entry.id); assert.equal(entry.bodySha256, shaValue(entry.body), '冻结请求体散列不符：' + entry.id); validateBody(config, entry.body); }
  assert.equal(baseline.status, 'CAPTURED', '写前现值尚未取得'); assert.equal(baseline.schemaVersion, 2, '写前现值版本不符'); assert.equal(baseline.revision, 'rev1', '写前现值不是rev1'); assert.equal(baseline.semanticReviewSha256, fileSha('00-独立语义评审.json'), '独立语义评审散列不符'); assert.equal(baseline.sourceSnapshotSha256, fileSha('03-来源散列快照.json'), '来源快照散列不符'); assert.equal(baseline.frozenRequestSha256, fileSha('02-合并冻结请求.json'), '冻结请求散列不符'); assert.equal(baseline.businessWrites, 0, '写前现值包含业务写入'); assert.deepEqual(baseline.expectedCurrent, expectedCurrent, '写前基线计数不符'); assert.equal(oldRuleDetails().length, expectedCurrent.ruleCount, '写前未保存旧120条详情'); assert.equal(oldRuleLists().length, expectedCurrent.skillCount, '写前未保存1062个规则列表');
  const targets = []; for (const config of targetConfigs) targets.push(await readTarget(config)); const expectedSnapshots = baseline.preservation?.targetNonRuleSnapshots || {}; for (const target of targets) { assertCondition(expectedSnapshots[target.id], '缺少目标非规则基线：' + target.id); assert.equal(equal(target.nonRule, expectedSnapshots[target.id]), true, '非规则组成变化：' + target.id); const entry = frozen.requests.find((item) => item.id === target.id); assertCondition(entry, '冻结请求缺少目标：' + target.id); assert.equal(entry.bodySha256, shaValue(entry.body), '冻结请求体散列不符：' + target.id); assert.equal(target.candidateDetail.status, 200, '新增规则详情不是200：' + target.id); assert.equal(equal(target.candidateDetail.data, entry.body), true, '新增规则详情与冻结请求不符：' + target.id); report.targets.push({ id: target.id, skillKey: target.skillKey, candidateDetailStatus: target.candidateDetail.status, candidateBodySha256: shaValue(target.candidateDetail.data), frozenBodySha256: entry.bodySha256, nonRuleSnapshotSha256: shaValue(target.nonRule) }); }
  const finalScan = await scanRules(); assert.equal(finalScan.ruleCount, expectedCurrent.finalRuleCount, '最终规则总数不是126'); assert.equal(finalScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '最终SOURCE_INITIALIZED不是24'); compareOld(finalScan); const oldMap = new Map(oldRuleDetails().map((item) => [ruleId(item.skillKey, item.ruleKey), item.response?.data])); const expectedIds = [...oldMap.keys(), ...frozen.requests.map((entry) => ruleId(entry.skillKey, entry.ruleKey))].sort(); const actualIds = finalScan.refs.map((item) => ruleId(item.skillKey, item.ruleKey)).sort(); assert.deepEqual(actualIds, expectedIds, '最终规则集合不是旧规则加本批新增规则'); for (const entry of frozen.requests) { const actual = finalScan.details.find((item) => item.skillKey === entry.skillKey && item.ruleKey === entry.ruleKey); assertCondition(actual, '缺少新增规则：' + entry.id); assert.equal(entry.bodySha256, shaValue(entry.body), '终审bodySha256不符：' + entry.id); assert.equal(equal(actual.response.data, entry.body), true, '新增规则最终回读不符：' + entry.id); }
  report.global = { skillCount: finalScan.skillKeys.length, ruleCount: finalScan.ruleCount, sourceInitializedCount: finalScan.eventTypeCounts.SOURCE_INITIALIZED || 0, eventTypeCounts: finalScan.eventTypeCounts, ruleKeysSha256: shaValue(finalScan.refs), oldRuleDetailsExact: true, newRulesExact: true }; report.status = 'PASS'; report.completedAt = new Date().toISOString(); save(); process.stdout.write(JSON.stringify({ status: report.status, revision: report.revision, getCount: report.getCount, methods: report.methods, businessWrites: report.businessWrites, skillCount: report.global.skillCount, ruleCount: report.global.ruleCount, sourceInitializedCount: report.global.sourceInitializedCount }, null, 2));
} catch (error) { report.status = 'FAILED'; report.completedAt = new Date().toISOString(); report.error = { message: error instanceof Error ? error.message : String(error) }; save(); throw error; }

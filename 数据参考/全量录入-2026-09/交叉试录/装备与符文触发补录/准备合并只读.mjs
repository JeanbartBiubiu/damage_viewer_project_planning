import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const batchRoot = path.resolve(here, '..');
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；只读脚本不会保存或输出令牌。');

const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 96,
  sourceInitializedCount: 24,
  finalRuleCount: 100
};

const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];

const upstream = [
  {
    id: 'black',
    name: '黑色切割者',
    directory: path.join(batchRoot, '黑色切割者触发补录'),
    frozenFile: '02-冻结请求.json',
    sourceFile: '03-来源快照.json',
    baselineFile: '04-写入前现值.json',
    reportFile: '05-只读准备报告.json',
    skillKey: 'item_3071_passive',
    ownerKey: 'item_3071',
    ownerKind: 'equipment',
    ruleKey: 'on_physical_damage_dealt_to_champion',
    expectedEventType: 'DAMAGE_DEALT',
    expectedEventDetail: { damageTypeKey: 'physics', deliveryKind: 'ANY', originKind: 'ANY' },
    expectedEffectKey: 'armor_shred',
    expectedFormulaKey: null,
    expectedResultKey: 'armor_reduction',
    expectedResultTarget: 'TARGET'
  },
  {
    id: 'magic',
    name: '魔切',
    directory: path.join(batchRoot, '魔切普攻触发补录'),
    frozenFile: '02-冻结请求.json',
    sourceFile: '03-来源快照.json',
    baselineFile: '04-写入前现值.json',
    reportFile: '05-只读准备报告.json',
    skillKey: 'item_3042_passive',
    ownerKey: 'item_3042',
    ownerKind: 'equipment',
    ruleKey: 'on_basic_attack_hit_to_champion',
    expectedEventType: 'BASIC_ATTACK_HIT',
    expectedEventDetail: {},
    expectedEffectKey: 'on_hit_damage_from_max_mana',
    expectedFormulaKey: 'on_hit_damage_from_max_mana',
    expectedResultKey: 'damage',
    expectedResultTarget: 'TARGET'
  },
  {
    id: 'stridebreaker',
    name: '挺进破坏者',
    directory: path.join(batchRoot, '挺进破坏者主动触发补录'),
    frozenFile: '02-冻结请求.json',
    sourceFile: '03-来源快照.json',
    baselineFile: '04-写入前现值.json',
    reportFile: '05-只读准备报告.json',
    skillKey: 'item_6631_active',
    ownerKey: 'item_6631',
    ownerKind: 'equipment',
    ruleKey: 'actual_hit',
    expectedEventType: 'SKILL_HIT',
    expectedEventDetail: { sourceSkillKey: 'item_6631_active' },
    expectedEffectKey: 'active_hit',
    expectedFormulaKey: 'active_damage',
    expectedResultKey: 'damage',
    expectedResultTarget: 'TARGET'
  },
  {
    id: 'triumph',
    name: '凯旋',
    directory: path.join(batchRoot, '凯旋符文触发补录'),
    frozenFile: '02-冻结请求.json',
    sourceFile: '03-来源快照.json',
    baselineFile: '04-写入前现值.json',
    reportFile: '05-只读准备报告.md',
    skillKey: 'rune_9111_passive',
    ownerKey: 'rune_9111',
    ownerKind: 'rune',
    ruleKey: 'on_champion_kill',
    expectedEventType: 'KILL',
    expectedEventDetail: {},
    expectedEffectKey: 'triumph_heal',
    expectedFormulaKey: 'triumph_heal',
    expectedResultKey: 'result',
    expectedResultTarget: 'SOURCE'
  }
];

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
const fileSha = (filePath) => sha256(fs.readFileSync(filePath));
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (name, value) => {
  fs.writeFileSync(localPath(name), JSON.stringify(value, null, 2) + '\n', 'utf8');
};

function assertCondition(condition, message) {
  assert.equal(Boolean(condition), true, message);
}

function responseData(response, context) {
  assert.equal(response.status, 200, context + ' 预期 200，实际 ' + response.status);
  return response.data;
}

function arrayData(response, context) {
  const data = responseData(response, context);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  throw new Error(context + ' 没有数组结果');
}

function statusCounts(responses) {
  return responses.reduce((counts, response) => {
    const key = String(response.status);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function sortedUnique(values, context) {
  assertCondition(values.every((value) => typeof value === 'string' && value.length > 0), context + ' 存在空键');
  const sorted = [...values].sort();
  assert.equal(new Set(sorted).size, sorted.length, context + ' 存在重复键');
  return sorted;
}

function sourceFileRecord(filePath, kind) {
  assertCondition(fs.existsSync(filePath), '来源文件不存在：' + filePath);
  const bytes = fs.readFileSync(filePath);
  return { kind, path: filePath, byteSize: bytes.byteLength, sha256: sha256(bytes) };
}

function directoryManifest(directory) {
  return fs.readdirSync(directory)
    .sort()
    .map((file) => {
      const filePath = path.join(directory, file);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return null;
      return sourceFileRecord(filePath, file);
    })
    .filter(Boolean);
}

let getCount = 0;
const statusCountsAll = {};
async function get(route) {
  getCount += 1;
  const response = await fetch(baseUrl + route, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
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
  statusCountsAll[response.status] = (statusCountsAll[response.status] || 0) + 1;
  return { method: 'GET', route, status: response.status, data };
}

async function getMany(routes, concurrency = 24) {
  const results = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= routes.length) return;
      results[index] = await get(routes[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker()));
  return results;
}

function collectActualWriteEvidence(value, pathText = 'root', evidence = []) {
  if (!value || typeof value !== 'object') return evidence;
  if (value.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(value.method).toUpperCase())) {
    evidence.push({ path: pathText, method: value.method, route: value.route || null });
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectActualWriteEvidence(child, pathText + '[' + index + ']', evidence));
  } else {
    Object.entries(value).forEach(([key, child]) => {
      if (['expectedBusinessWrite', 'plannedWrites', 'plannedRuleAdds'].includes(key)) return;
      collectActualWriteEvidence(child, pathText + '.' + key, evidence);
    });
  }
  return evidence;
}

function actualWriteCount(value) {
  const counts = [];
  if (typeof value?.businessWrites === 'number') counts.push(value.businessWrites);
  if (typeof value?.businessWriteCount === 'number') counts.push(value.businessWriteCount);
  if (typeof value?.businessWritesIssued === 'number') counts.push(value.businessWritesIssued);
  if (typeof value?.businessWriteIssued === 'boolean') counts.push(value.businessWriteIssued ? 1 : 0);
  if (typeof value?.requestPolicy?.businessWritesIssued === 'number') counts.push(value.requestPolicy.businessWritesIssued);
  if (typeof value?.requestPolicy?.businessWriteIssued === 'boolean') counts.push(value.requestPolicy.businessWriteIssued ? 1 : 0);
  if (Array.isArray(value?.requestPolicy?.writeMethodsObserved)) {
    counts.push(value.requestPolicy.writeMethodsObserved.filter((method) => String(method).toUpperCase() !== 'GET').length);
  }
  if (Array.isArray(value?.requestPolicy?.businessMethodsSent)) {
    counts.push(value.requestPolicy.businessMethodsSent.filter((method) => String(method).toUpperCase() !== 'GET').length);
  }
  if (Array.isArray(value?.requestLog)) {
    counts.push(value.requestLog.filter((entry) => String(entry.method || '').toUpperCase() !== 'GET').length);
  }
  return Math.max(0, ...counts);
}

function recursiveRuleCount(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  const counts = [];
  for (const key of ['ruleCount', 'ruleDetailCount', 'ruleSummaryCount']) {
    if (typeof value[key] === 'number') counts.push(value[key]);
  }
  if (Array.isArray(value)) {
    value.forEach((child) => counts.push(...recursiveRuleCount(child, seen)));
  } else {
    Object.values(value).forEach((child) => counts.push(...recursiveRuleCount(child, seen)));
  }
  return counts;
}

function loadUpstream(config) {
  const frozenPath = path.join(config.directory, config.frozenFile);
  const sourcePath = path.join(config.directory, config.sourceFile);
  const baselinePath = path.join(config.directory, config.baselineFile);
  const reportPath = path.join(config.directory, config.reportFile);
  const frozen = readJson(frozenPath);
  const source = readJson(sourcePath);
  const baseline = readJson(baselinePath);
  const report = config.reportFile.endsWith('.json') ? readJson(reportPath) : fs.readFileSync(reportPath, 'utf8');
  const write = config.id === 'triumph'
    ? null
    : (frozen.writes || []).find((entry) => entry?.body?.ruleKey === config.ruleKey);
  if (config.id !== 'triumph') {
    assertCondition(['READY', 'READY_FOR_INDEPENDENT_REVIEW'].includes(frozen.status), config.name + ' 上游冻结状态不是 READY');
    assert.equal(frozen.plannedWrites, 1, config.name + ' 上游计划写入数不是 1');
    assertCondition(write && write.method === 'POST', config.name + ' 上游没有候选 POST');
    assert.equal(write.route, '/skills/' + config.skillKey + '/trigger-rules', config.name + ' 上游 POST 路径不符');
    assert.equal(write.detailRoute, '/skills/' + config.skillKey + '/trigger-rules/' + config.ruleKey, config.name + ' 上游详情路径不符');
    const expectedStatus = write.expectedStatus ?? 201;
    assert.equal(expectedStatus, 201, config.name + ' 上游 POST 预期状态不是 201');
    assert.equal(write.body?.ruleKey, config.ruleKey, config.name + ' 上游候选规则键不符');
  } else {
    assert.equal(frozen.status, 'REVISE', '凯旋原上游应保留 REVISE 证据');
    assert.equal(frozen.plannedWrites, 0, '凯旋原上游 REVISE 不应有写入计划');
  }
  assertCondition(recursiveRuleCount(baseline).includes(96), config.name + ' 上游没有 96 条规则基线');
  assert.equal(actualWriteCount(baseline), 0, config.name + ' 上游基线包含业务写入');
  if (typeof report === 'object') assert.equal(actualWriteCount(report), 0, config.name + ' 上游报告包含业务写入');
  assert.equal(collectActualWriteEvidence(baseline).length, 0, config.name + ' 上游记录出现非 GET 请求');
  if (frozen.sourceSnapshotSha256) {
    assert.equal(frozen.sourceSnapshotSha256, fileSha(sourcePath), config.name + ' 上游来源散列不匹配');
  }
  return {
    config,
    frozen,
    source,
    baseline,
    report,
    write,
    files: {
      frozen: sourceFileRecord(frozenPath, config.frozenFile),
      source: sourceFileRecord(sourcePath, config.sourceFile),
      baseline: sourceFileRecord(baselinePath, config.baselineFile),
      report: sourceFileRecord(reportPath, config.reportFile)
    }
  };
}

function findCondition(rule) {
  return (rule?.conditionGroups || [])
    .flatMap((group) => group.conditions || [])
    .find((condition) => condition.conditionType === 'TARGET_CATEGORY_CHECK');
}

function findAction(rule, effectKey) {
  return (rule?.actions || []).find((action) => action.actionType === 'EXECUTE_EFFECT'
    && action.detail?.effectKey === effectKey);
}

function validateCandidateBody(config, body) {
  assert.equal(body.ruleKey, config.ruleKey, config.name + ' 规则键不符');
  assert.equal(body.eventSource?.eventType, config.expectedEventType, config.name + ' 事件类型不符');
  assert.deepEqual(body.eventSource?.detail, config.expectedEventDetail, config.name + ' 事件明细不符');
  const condition = findCondition(body);
  assertCondition(condition, config.name + ' 缺少 TARGET_CATEGORY_CHECK');
  assert.deepEqual(condition.detail?.categories, ['CHAMPION'], config.name + ' 类别条件不符');
  const action = findAction(body, config.expectedEffectKey);
  assertCondition(action, config.name + ' 缺少目标效果动作');
  assert.equal(action.targetContext, 'CURRENT_TARGET', config.name + ' 动作目标上下文不符');
  assert.equal(action.detail?.effectKey, config.expectedEffectKey, config.name + ' 动作效果键不符');
  assert.equal(body.perTargetCooldown, null, config.name + ' 不应凭空设置逐目标冷却');
  assert.equal(body.maxTriggersPerProcess, null, config.name + ' 不应凭空设置过程触发次数');
}

function makeTriumphBody() {
  return {
    ruleKey: 'on_champion_kill',
    name: '击杀英雄触发凯旋治疗',
    description: '严格一对一模型中，来源对象击杀当前英雄目标后，在当前目标上下文执行已有的 triumph_heal；KILL 没有 EVENT_SOURCE，已有结果 target=SOURCE，因此治疗技能拥有者。多人助攻和完整参与击杀不由本规则描述。',
    sortOrder: 10,
    eventSource: { eventType: 'KILL', detail: {} },
    conditionGroups: [
      {
        groupKey: 'champion_target',
        name: '被击杀对象为英雄',
        sortOrder: 10,
        conditions: [
          {
            conditionKey: 'champion_target',
            conditionType: 'TARGET_CATEGORY_CHECK',
            sortOrder: 10,
            detail: { categories: ['CHAMPION'] }
          }
        ]
      }
    ],
    actions: [
      {
        actionKey: 'execute_triumph_heal',
        name: '执行凯旋治疗',
        actionType: 'EXECUTE_EFFECT',
        sortOrder: 10,
        targetContext: 'CURRENT_TARGET',
        detail: { effectKey: 'triumph_heal' },
        runtimeInputBindings: [],
        resultModifiers: []
      }
    ],
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  };
}

function normalizedRequest(loaded) {
  const config = loaded.config;
  const body = config.id === 'triumph' ? makeTriumphBody() : loaded.write.body;
  validateCandidateBody(config, body);
  return {
    id: config.id,
    name: config.name,
    skillKey: config.skillKey,
    ownerKey: config.ownerKey,
    ownerKind: config.ownerKind,
    ruleKey: config.ruleKey,
    method: 'POST',
    route: '/skills/' + config.skillKey + '/trigger-rules',
    detailRoute: '/skills/' + config.skillKey + '/trigger-rules/' + config.ruleKey,
    expectedStatus: 201,
    body,
    bodySha256: shaValue(body),
    sourceExpectedStatus: config.id === 'triumph' ? null : (loaded.write.expectedStatus ?? null),
    sourceExpectedStatusDefaulted: config.id !== 'triumph' && loaded.write.expectedStatus === undefined
  };
}

async function readTarget(config) {
  const skillRoute = '/skills/' + encodeURIComponent(config.skillKey);
  const ownerRoute = config.ownerKind === 'equipment'
    ? '/equipment/' + encodeURIComponent(config.ownerKey)
    : '/runes/' + encodeURIComponent(config.ownerKey);
  const ownerImageRoute = config.ownerKind === 'equipment'
    ? '/equipment/' + encodeURIComponent(config.ownerKey) + '/representative-image'
    : null;
  const relationBase = config.ownerKind === 'equipment'
    ? '/equipment-skill-relations?equipmentKey=' + encodeURIComponent(config.ownerKey)
    : '/rune-skill-relations?runeKey=' + encodeURIComponent(config.ownerKey);
  const relationFiltered = relationBase + '&skillKey=' + encodeURIComponent(config.skillKey);
  const staticRoutes = {
    subject: skillRoute,
    owner: ownerRoute,
    relation: relationBase,
    relationFiltered,
    skillRepresentativeImage: skillRoute + '/representative-image'
  };
  if (ownerImageRoute) staticRoutes.ownerRepresentativeImage = ownerImageRoute;
  const staticResponses = {};
  for (const [key, route] of Object.entries(staticRoutes)) {
    staticResponses[key] = await get(route);
    responseData(staticResponses[key], config.name + ' ' + route);
  }

  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const listRoute = skillRoute + '/' + apiName;
    const listResponse = await get(listRoute);
    const items = arrayData(listResponse, config.name + ' ' + listRoute);
    const keys = sortedUnique(items.map((item) => item[keyName]), config.name + ' ' + listRoute);
    const detailRoutes = keys.map((key) => listRoute + '/' + encodeURIComponent(key));
    const detailResponses = await getMany(detailRoutes);
    detailResponses.forEach((response, index) => responseData(response, config.name + ' ' + detailRoutes[index]));
    components[apiName] = {
      list: listResponse,
      items,
      keys,
      details: detailResponses.map((response, index) => ({ key: keys[index], response }))
    };
  }

  const candidateDetail = await get(
    skillRoute + '/trigger-rules/' + encodeURIComponent(config.ruleKey)
  );
  assert.equal(candidateDetail.status, 404, config.name + ' 候选规则详情应为 404，实际 ' + candidateDetail.status);

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
  validateTarget(config, target);
  return target;
}

function validateTarget(config, target) {
  const subject = target.staticResponses.subject.data;
  assert.equal(subject.skillKey, config.skillKey, config.name + ' 技能主体键不符');
  const owner = target.staticResponses.owner.data;
  assert.equal(owner[config.ownerKind === 'equipment' ? 'equipmentKey' : 'runeKey'], config.ownerKey, config.name + ' 所有者主体键不符');
  const relationItems = target.staticResponses.relation.data?.items || [];
  const filteredItems = target.staticResponses.relationFiltered.data?.items || [];
  assertCondition(
    relationItems.some((item) => item.skillKey === config.skillKey && (item.equipmentKey === config.ownerKey || item.runeKey === config.ownerKey)),
    config.name + ' 全量关系缺少目标技能'
  );
  assertCondition(
    filteredItems.some((item) => item.skillKey === config.skillKey && (item.equipmentKey === config.ownerKey || item.runeKey === config.ownerKey)),
    config.name + ' 过滤关系缺少目标技能'
  );
  const skillImage = target.staticResponses.skillRepresentativeImage.data?.image;
  assert.equal(skillImage?.imageKey, config.ownerKey, config.name + ' 技能代表图片键不符');
  if (config.ownerKind === 'equipment') {
    const ownerImage = target.staticResponses.ownerRepresentativeImage.data?.image;
    assert.equal(ownerImage?.imageKey, config.ownerKey, config.name + ' 装备代表图片键不符');
  }
  const triggerKeys = target.components['trigger-rules'].keys;
  assertCondition(!triggerKeys.includes(config.ruleKey), config.name + ' 目标规则列表已经包含候选键');
  const effect = target.components.effects.details.find(({ key }) => key === config.expectedEffectKey)?.response.data;
  assertCondition(effect, config.name + ' 缺少已有 ' + config.expectedEffectKey + ' 效果');
  assertCondition(Array.isArray(effect.results) && effect.results.length > 0, config.name + ' 已有效果没有结果');
  const result = config.expectedResultKey
    ? effect.results.find((item) => item.resultKey === config.expectedResultKey)
    : effect.results[0];
  assertCondition(result, config.name + ' 缺少预期效果结果');
  assert.equal(result.target, config.expectedResultTarget, config.name + ' 效果结果 target 不符');
  if (config.expectedFormulaKey) {
    assertCondition(target.components.formulas.keys.includes(config.expectedFormulaKey), config.name + ' 缺少已有公式 ' + config.expectedFormulaKey);
    assert.equal(result.valueRule?.value?.formulaKey, config.expectedFormulaKey, config.name + ' 结果公式键不符');
  }
}

async function scanRules(passName) {
  const skillsResponse = await get('/skills');
  const skills = arrayData(skillsResponse, passName + '全技能目录');
  const skillKeys = sortedUnique(skills.map((skill) => skill.skillKey), passName + '全技能目录');
  if (typeof skillsResponse.data?.total === 'number') {
    assert.equal(skillsResponse.data.total, skills.length, passName + '技能目录 total 不一致');
  }
  const listResponses = await getMany(skillKeys.map((skillKey) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules'));
  const lists = listResponses.map((response, index) => {
    const skillKey = skillKeys[index];
    const rules = arrayData(response, passName + '技能 ' + skillKey + ' 规则列表');
    const ruleKeys = sortedUnique(rules.map((rule) => rule.ruleKey), passName + '技能 ' + skillKey + ' 规则列表');
    return { skillKey, response, rules, ruleKeys };
  });
  const refs = lists
    .flatMap(({ skillKey, ruleKeys }) => ruleKeys.map((ruleKey) => ({ skillKey, ruleKey })))
    .sort((left, right) => (left.skillKey + '/' + left.ruleKey).localeCompare(right.skillKey + '/' + right.ruleKey));
  const detailResponses = await getMany(
    refs.map(({ skillKey, ruleKey }) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules/' + encodeURIComponent(ruleKey))
  );
  detailResponses.forEach((response, index) => responseData(response, passName + '规则详情 ' + refs[index].skillKey + '/' + refs[index].ruleKey));
  const details = detailResponses.map((response, index) => ({ ...refs[index], response }));
  return {
    passName,
    skillsResponse,
    skills,
    skillKeys,
    lists,
    refs,
    details,
    ruleCount: refs.length,
    eventTypeCounts: details.reduce((counts, { response }) => {
      const eventType = response.data?.eventSource?.eventType;
      if (eventType) counts[eventType] = (counts[eventType] || 0) + 1;
      return counts;
    }, {}),
    conditionTypeCounts: details.reduce((counts, { response }) => {
      for (const group of response.data?.conditionGroups || []) {
        for (const condition of group.conditions || []) {
          if (condition.conditionType) counts[condition.conditionType] = (counts[condition.conditionType] || 0) + 1;
        }
      }
      return counts;
    }, {}),
    statusSummary: {
      catalog: statusCounts([skillsResponse]),
      lists: statusCounts(listResponses),
      details: statusCounts(detailResponses)
    }
  };
}

function inventoryComparable(scan) {
  return {
    skillKeys: scan.skillKeys,
    lists: scan.lists.map(({ skillKey, rules, ruleKeys }) => ({ skillKey, rules, ruleKeys })),
    details: scan.details.map(({ skillKey, ruleKey, response }) => ({ skillKey, ruleKey, data: response.data }))
  };
}

function inventoryOutput(scan) {
  return {
    passName: scan.passName,
    skillCount: scan.skillKeys.length,
    ruleCount: scan.ruleCount,
    eventTypeCounts: scan.eventTypeCounts,
    conditionTypeCounts: scan.conditionTypeCounts,
    statusSummary: scan.statusSummary,
    skillKeys: scan.skillKeys,
    ruleLists: scan.lists.map(({ skillKey, response, rules, ruleKeys }) => ({
      skillKey,
      response,
      rules,
      ruleKeys
    })),
    ruleDetails: scan.details
  };
}

function sourceSnapshot(loaded, requests) {
  return {
    schemaVersion: 2,
    revision: 'rev2',
    capturedAt: new Date().toISOString(),
    sourcePolicy: '固定现有四个上游批次的来源记录；前三项从各自 02 提取，凯旋原 02 的 REVISE 只作为问题证据，本目录重新建立 rev2 请求。',
    methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
    authorizationValueRecorded: false,
    sourceDirectories: loaded.map(({ config, files }) => ({
      id: config.id,
      name: config.name,
      directory: config.directory,
      files: Object.values(files),
      upstreamStatus: config.id === 'triumph' ? 'REVISE' : 'READY',
      upstreamFrozenRequest: files.frozen.sha256,
      upstreamSourceSnapshot: files.source.sha256,
      upstreamBaseline: files.baseline.sha256,
      upstreamReport: files.report.sha256
    })),
    acceptedFacts: {
      black: {
        skillKey: 'item_3071_passive',
        eventType: 'DAMAGE_DEALT',
        detail: { damageTypeKey: 'physics', deliveryKind: 'ANY', originKind: 'ANY' },
        condition: { conditionType: 'TARGET_CATEGORY_CHECK', categories: ['CHAMPION'] },
        targetContext: 'CURRENT_TARGET',
        effectKey: 'armor_shred'
      },
      magic: {
        skillKey: 'item_3042_passive',
        eventType: 'BASIC_ATTACK_HIT',
        detail: {},
        condition: { conditionType: 'TARGET_CATEGORY_CHECK', categories: ['CHAMPION'] },
        targetContext: 'CURRENT_TARGET',
        effectKey: 'on_hit_damage_from_max_mana'
      },
      stridebreaker: {
        skillKey: 'item_6631_active',
        eventType: 'SKILL_HIT',
        detail: { sourceSkillKey: 'item_6631_active' },
        condition: { conditionType: 'TARGET_CATEGORY_CHECK', categories: ['CHAMPION'] },
        targetContext: 'CURRENT_TARGET',
        effectKey: 'active_hit'
      },
      triumph: {
        skillKey: 'rune_9111_passive',
        eventType: 'KILL',
        detail: {},
        condition: { conditionType: 'TARGET_CATEGORY_CHECK', categories: ['CHAMPION'] },
        targetContext: 'CURRENT_TARGET',
        effectKey: 'triumph_heal',
        existingResultTarget: 'SOURCE',
        currentTargetMeaning: '被击杀英雄',
        eventSourceAvailable: false,
        scope: '严格一对一中的本人击杀子集；不覆盖多人助攻或完整参与击杀；跳过 20 金币'
      }
    },
    requests: requests.map((request) => ({
      id: request.id,
      ruleKey: request.ruleKey,
      bodySha256: request.bodySha256,
      sourceExpectedStatus: request.sourceExpectedStatus,
      sourceExpectedStatusDefaulted: request.sourceExpectedStatusDefaulted
    }))
  };
}

const loadedUpstream = upstream.map(loadUpstream);
const requests = loadedUpstream.map(normalizedRequest);
const source = sourceSnapshot(loadedUpstream, requests);
writeJson('03-来源散列快照.json', source);

const targets = [];
for (const config of upstream) targets.push(await readTarget(config));

const firstScan = await scanRules('第一轮');
const secondScan = await scanRules('第二轮');
const firstComparable = inventoryComparable(firstScan);
const secondComparable = inventoryComparable(secondScan);
const stableSkillKeys = isDeepStrictEqual(firstScan.skillKeys, secondScan.skillKeys);
const stableRuleKeys = isDeepStrictEqual(firstScan.refs, secondScan.refs);
const stableRuleDetails = isDeepStrictEqual(firstComparable.details, secondComparable.details);
const stableRuleLists = isDeepStrictEqual(firstComparable.lists, secondComparable.lists);
const stableRead = stableSkillKeys && stableRuleKeys && stableRuleDetails && stableRuleLists;
assert.equal(firstScan.skillKeys.length, expectedCurrent.skillCount, '全技能数量不是 1062');
assert.equal(firstScan.ruleCount, expectedCurrent.ruleCount, '规则总数不是 96');
assert.equal(secondScan.ruleCount, expectedCurrent.ruleCount, '第二轮规则总数不是 96');
assert.equal(firstScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, 'SOURCE_INITIALIZED 数量不是 24');
assert.equal(secondScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '第二轮 SOURCE_INITIALIZED 数量不是 24');
assert.equal(stableRead, true, '两轮规则列表或详情不稳定');

const freeze = {
  schemaVersion: 2,
  planRevision: 2,
  revision: 'rev2',
  generatedAt: new Date().toISOString(),
  status: 'READY',
  writable: true,
  gameId: 'lol',
  fixedVersion: '16.17.1',
  methodPolicy: 'GET_ONLY_PRECHECK_THEN_FOUR_POSTS',
  authorizationValueRecorded: false,
  sourceSnapshotSha256: fileSha(localPath('03-来源散列快照.json')),
  expectedCurrent,
  observedCurrent: {
    skillCount: firstScan.skillKeys.length,
    ruleCount: firstScan.ruleCount,
    sourceInitializedCount: firstScan.eventTypeCounts.SOURCE_INITIALIZED || 0,
    eventTypeCounts: firstScan.eventTypeCounts,
    conditionTypeCounts: firstScan.conditionTypeCounts,
    stableRead,
    twoRoundRuleKeySetStable: stableRuleKeys,
    twoRoundRuleDetailStable: stableRuleDetails
  },
  writeBoundary: {
    businessWriteCount: 4,
    order: requests.map(({ id, route, detailRoute }) => ({ id, route, detailRoute })),
    methods: ['POST'],
    expectedStatus: 201,
    onlyFrozenRoutes: true,
    noPutPatchDelete: true,
    noOtherObjectWrites: true,
    noRerunExistingRules: true,
    noReplayIfReportExists: true
  },
  requests,
  protection: {
    candidateDetailsMustBe404: requests.map(({ detailRoute }) => detailRoute),
    targetNonRuleSnapshotSha256: Object.fromEntries(targets.map((target) => [target.id, shaValue(target.nonRule)])),
    targetSkills: targets.map((target) => target.skillKey),
    existingRuleCount: expectedCurrent.ruleCount,
    existingRuleDetailsSaved: true,
    existingRuleListsSaved: true,
    expectedFinalRuleCount: expectedCurrent.finalRuleCount,
    expectedNewRuleRefs: requests.map(({ skillKey, ruleKey }) => skillKey + '/' + ruleKey),
    sourceInitializedCount: expectedCurrent.sourceInitializedCount
  },
  targetBefore: targets.map((target) => ({
    id: target.id,
    skillKey: target.skillKey,
    ownerKey: target.ownerKey,
    ownerKind: target.ownerKind,
    candidateRuleKey: target.candidateRuleKey,
    candidateDetailStatus: target.candidateDetail.status,
    componentKeys: Object.fromEntries(componentKinds.map(([apiName]) => [apiName, target.components[apiName].keys])),
    nonRuleSnapshotSha256: shaValue(target.nonRule)
  })),
  excluded: [
    '不修改四个目标的主体、关系、代表图片、参数、公式、效果、过程或内部状态。',
    '不修改旧 96 条规则，不把 KILL 的 CURRENT_TARGET 改成 EVENT_SOURCE。',
    '凯旋不描述多人助攻或完整参与击杀，不录入额外 20 金币。',
    '不把静态来源、GET 预检或页面验收当作战斗运行时或 Wasm 证明。'
  ]
};
writeJson('02-合并冻结请求.json', freeze);

const baseline = {
  schemaVersion: 2,
  revision: 'rev2',
  capturedAt: new Date().toISOString(),
  baseUrl,
  requestPolicy: {
    method: 'GET',
    authorizationValueRecorded: false,
    businessWriteIssued: false,
    writeMethodsObserved: []
  },
  healthProbe: {
    route: firstScan.skillsResponse.route,
    status: firstScan.skillsResponse.status,
    observedSkillCount: firstScan.skillKeys.length
  },
  sourceSnapshotSha256: fileSha(localPath('03-来源散列快照.json')),
  frozenRequestSha256: fileSha(localPath('02-合并冻结请求.json')),
  expectedCurrent,
  observedCurrent: freeze.observedCurrent,
  stableVerification: {
    firstScanSkillCount: firstScan.skillKeys.length,
    secondScanSkillCount: secondScan.skillKeys.length,
    firstScanRuleCount: firstScan.ruleCount,
    secondScanRuleCount: secondScan.ruleCount,
    firstRuleKeysSha256: shaValue(firstScan.refs),
    secondRuleKeysSha256: shaValue(secondScan.refs),
    stableSkillKeys,
    stableRuleKeys,
    stableRuleLists,
    stableRuleDetails,
    stableRead
  },
  getCount,
  statusCounts: statusCountsAll,
  businessWrites: 0,
  targets,
  globalBaseline: {
    first: inventoryOutput(firstScan),
    second: inventoryOutput(secondScan)
  },
  preservation: {
    existingRuleCount: firstScan.ruleCount,
    existingRuleRefs: firstScan.refs,
    existingRuleLists: firstScan.lists.map(({ skillKey, response, rules, ruleKeys }) => ({
      skillKey,
      response,
      rules,
      ruleKeys
    })),
    existingRuleDetails: firstScan.details,
    expectedFinalRuleCount: expectedCurrent.finalRuleCount,
    expectedNewRuleRefs: requests.map(({ skillKey, ruleKey }) => ({ skillKey, ruleKey })),
    targetNonRuleSnapshots: Object.fromEntries(targets.map((target) => [target.id, target.nonRule]))
  }
};
writeJson('04-共享写前现值.json', baseline);

console.log(JSON.stringify({
  status: freeze.status,
  writable: freeze.writable,
  revision: freeze.revision,
  getCount,
  businessWrites: 0,
  serviceHealth: baseline.healthProbe,
  observedCurrent: freeze.observedCurrent,
  stableRead,
  targetCandidates: targets.map((target) => ({
    id: target.id,
    skillKey: target.skillKey,
    ruleKey: target.candidateRuleKey,
    candidateDetailStatus: target.candidateDetail.status,
    nonRuleSnapshotSha256: shaValue(target.nonRule)
  })),
  plannedPosts: requests.map(({ id, route, ruleKey, expectedStatus }) => ({ id, route, ruleKey, expectedStatus })),
  hashes: {
    sourceSnapshot: fileSha(localPath('03-来源散列快照.json')),
    frozenRequest: fileSha(localPath('02-合并冻结请求.json')),
    sharedBaseline: fileSha(localPath('04-共享写前现值.json'))
  },
  statusCounts: statusCountsAll
}, null, 2));

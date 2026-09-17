import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildRule, expectedCurrent, targetConfigs } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；本脚本只发送 GET。');

const outputNames = ['02-合并冻结请求.json', '03-来源散列快照.json', '04-共享写前现值.json'];
for (const name of outputNames) {
  if (fs.existsSync(path.join(here, name))) throw new Error(`${name} 已存在，拒绝覆盖。`);
}

const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey']
];
const scriptNames = ['01-合并方案.md', '批次配置.mjs', '准备合并只读.mjs', '受保护写入.mjs', '独立GET回读.mjs', '只读页面验收.mjs'];
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const shaValue = (value) => sha256(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;
const fileSha = (filePath) => sha256(fs.readFileSync(filePath));
const equal = (actual, expected) => isDeepStrictEqual(stable(actual), stable(expected));
const assertCondition = (condition, message) => assert.equal(Boolean(condition), true, message);
const ruleId = (skillKey, ruleKey) => `${skillKey}/${ruleKey}`;
const arrayData = (response, context) => {
  assert.equal(response.status, 200, `${context} 预期200，实际${response.status}`);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(`${context} 没有数组结果`);
};
const sortedUnique = (values, context) => {
  assertCondition(values.every((value) => typeof value === 'string' && value.length > 0), `${context} 存在空键`);
  const sorted = [...values].sort();
  assert.equal(new Set(sorted).size, sorted.length, `${context} 存在重复键`);
  return sorted;
};
const pick = (value, keys) => Object.fromEntries(keys.map((key) => [key, value?.[key]]));

let getCount = 0;
const statusCounts = {};
async function get(route) {
  getCount += 1;
  const response = await fetch(baseUrl + route, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000)
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); }
    catch { data = { parseError: true, responseBytes: Buffer.byteLength(raw) }; }
  }
  statusCounts[response.status] = (statusCounts[response.status] || 0) + 1;
  return { method: 'GET', route, status: response.status, data };
}
async function getMany(routes, concurrency = 24) {
  const output = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= routes.length) return;
      output[index] = await get(routes[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker()));
  return output;
}

function sourceSnapshot() {
  const files = new Map();
  const objects = [];
  for (const config of targetConfigs) {
    const sourcePath = path.join(repoRoot, ...config.sourceFile.split('/'));
    assertCondition(fs.existsSync(sourcePath), `${config.name} 来源文件不存在`);
    const bytes = fs.readFileSync(sourcePath);
    const document = JSON.parse(bytes.toString('utf8'));
    const sourceObject = document.skills?.[config.skillKey];
    assertCondition(sourceObject, `${config.name} 来源对象不存在`);
    const formula = sourceObject.write?.formulas?.find((item) => item.formulaKey === config.formulaKey);
    const effect = sourceObject.write?.effects?.find((item) => item.effectKey === config.effectKey);
    assertCondition(formula, `${config.name} 来源候选缺少公式 ${config.formulaKey}`);
    assertCondition(effect, `${config.name} 来源候选缺少效果 ${config.effectKey}`);
    const result = effect.results?.find((item) => item.resultKey === config.resultKey);
    assertCondition(result, `${config.name} 来源候选缺少结果 ${config.resultKey}`);
    assert.equal(result.resultType, 'DAMAGE', `${config.name} 来源结果不是伤害`);
    assert.equal(result.target, 'TARGET', `${config.name} 来源结果目标不符`);
    assert.equal(result.valueRule?.value?.kind, 'FORMULA', `${config.name} 来源结果不是公式取值`);
    assert.equal(result.valueRule?.value?.formulaKey, config.formulaKey, `${config.name} 来源结果公式不符`);
    assert.deepEqual(sourceObject.write?.triggerRules, [], `${config.name} 上游候选不应自带规则写入`);
    if (!files.has(config.sourceFile)) {
      files.set(config.sourceFile, { relativePath: config.sourceFile, bytes: bytes.length, sha256: sha256(bytes) });
    }
    objects.push({
      id: config.id,
      skillKey: config.skillKey,
      relativePath: config.sourceFile,
      objectPath: `skills.${config.skillKey}`,
      objectSha256: shaValue(sourceObject),
      formulaSha256: shaValue(formula),
      effectSha256: shaValue(effect),
      sourcePending: sourceObject.pending || [],
      sourceExcluded: sourceObject.excluded || []
    });
  }
  return {
    schemaVersion: 1,
    revision: 'rev1',
    capturedAt: new Date().toISOString(),
    status: 'CAPTURED',
    sourceVersion: '16.17/16.17.1',
    files: [...files.values()],
    objects,
    runtimeBoundary: '来源候选只证明管理组成；不证明Wasm组装、宿主事件生产或战斗运行。'
  };
}

function validateStoredComposition(config, sourceObject, components) {
  const formula = components.formulas.details.find((item) => item.key === config.formulaKey)?.data;
  const effect = components.effects.details.find((item) => item.key === config.effectKey)?.data;
  assertCondition(formula, `${config.name} 实库缺少公式 ${config.formulaKey}`);
  assertCondition(effect, `${config.name} 实库缺少效果 ${config.effectKey}`);
  const sourceFormula = sourceObject.write.formulas.find((item) => item.formulaKey === config.formulaKey);
  const sourceEffect = sourceObject.write.effects.find((item) => item.effectKey === config.effectKey);
  assert.equal(equal(pick(formula, ['formulaKey', 'name', 'expression', 'description', 'sortOrder']), sourceFormula), true, `${config.name} 实库公式与固定候选不一致`);
  assert.equal(equal(pick(effect, ['effectKey', 'name', 'description', 'sortOrder', 'lifecycle', 'results']), sourceEffect), true, `${config.name} 实库效果与固定候选不一致`);
  const result = effect.results?.find((item) => item.resultKey === config.resultKey);
  assertCondition(result, `${config.name} 实库缺少结果 ${config.resultKey}`);
  assert.equal(result.resultType, 'DAMAGE', `${config.name} 实库结果不是伤害`);
  assert.equal(result.target, 'TARGET', `${config.name} 实库结果目标不符`);
  assert.equal(result.valueRule?.value?.formulaKey, config.formulaKey, `${config.name} 实库结果公式不符`);
}

function targetRoutes(config) {
  const skill = `/skills/${encodeURIComponent(config.skillKey)}`;
  const owner = `/characters/${encodeURIComponent(config.ownerKey)}`;
  return {
    skill,
    static: {
      subject: skill,
      owner,
      ownerAttributes: `${owner}/attributes`,
      ownerRepresentativeImage: `${owner}/representative-image`,
      relationByOwner: `/character-skill-relations?characterKey=${encodeURIComponent(config.ownerKey)}`,
      relationBySkill: `/character-skill-relations?skillKey=${encodeURIComponent(config.skillKey)}`,
      skillRepresentativeImage: `${skill}/representative-image`
    }
  };
}

async function readTarget(config, sourceObject) {
  const routes = targetRoutes(config);
  const staticResponses = {};
  for (const [key, route] of Object.entries(routes.static)) {
    const response = await get(route);
    assert.equal(response.status, 200, `${config.name} ${route} 非200`);
    staticResponses[key] = response;
  }
  assert.equal(staticResponses.subject.data?.skillKey, config.skillKey, `${config.name} 技能主体键不符`);
  assert.equal(staticResponses.owner.data?.characterKey, config.ownerKey, `${config.name} 角色主体键不符`);
  const relationMatch = (item) => item.skillKey === config.skillKey && item.characterKey === config.ownerKey;
  assertCondition(arrayData(staticResponses.relationByOwner, `${config.name} 正向关系`).some(relationMatch), `${config.name} 正向关系缺失`);
  assertCondition(arrayData(staticResponses.relationBySkill, `${config.name} 反向关系`).some(relationMatch), `${config.name} 反向关系缺失`);
  for (const key of ['ownerRepresentativeImage', 'skillRepresentativeImage']) {
    const image = staticResponses[key].data?.image;
    assertCondition(image?.enabled === true && typeof image.imageKey === 'string' && image.imageKey.length > 0, `${config.name} ${key} 不可用`);
  }
  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const listRoute = `${routes.skill}/${apiName}`;
    const list = await get(listRoute);
    const items = arrayData(list, `${config.name} ${apiName}`);
    const keys = sortedUnique(items.map((item) => item[keyName]), `${config.name} ${apiName}`);
    const responses = await getMany(keys.map((key) => `${listRoute}/${encodeURIComponent(key)}`));
    responses.forEach((response, index) => assert.equal(response.status, 200, `${config.name} ${apiName}/${keys[index]} 非200`));
    components[apiName] = {
      list: list.data,
      keys,
      details: responses.map((response, index) => ({ key: keys[index], data: response.data }))
    };
  }
  validateStoredComposition(config, sourceObject, components);
  const candidateRoute = `${routes.skill}/trigger-rules/${encodeURIComponent(config.ruleKey)}`;
  const candidateDetail = await get(candidateRoute);
  assert.equal(candidateDetail.status, 404, `${config.name} 候选详情必须404`);
  return {
    id: config.id,
    skillKey: config.skillKey,
    ownerKey: config.ownerKey,
    candidateRuleKey: config.ruleKey,
    candidateDetail,
    nonRule: {
      static: Object.fromEntries(Object.entries(staticResponses).map(([key, response]) => [key, response.data])),
      components
    }
  };
}

async function scanRules() {
  const skillsResponse = await get('/skills');
  const skills = arrayData(skillsResponse, '全技能目录');
  const skillKeys = sortedUnique(skills.map((item) => item.skillKey), '全技能目录');
  assert.equal(skillKeys.length, expectedCurrent.skillCount, `技能数不是${expectedCurrent.skillCount}`);
  if (typeof skillsResponse.data?.total === 'number') assert.equal(skillsResponse.data.total, skillKeys.length, '技能目录total不符');
  const listResponses = await getMany(skillKeys.map((skillKey) => `/skills/${encodeURIComponent(skillKey)}/trigger-rules`));
  const ruleLists = listResponses.map((response, index) => {
    const rules = arrayData(response, `${skillKeys[index]} 规则列表`);
    const ruleKeys = sortedUnique(rules.map((item) => item.ruleKey), `${skillKeys[index]} 规则列表`);
    return { skillKey: skillKeys[index], data: response.data, rules, ruleKeys };
  });
  const refs = ruleLists
    .flatMap(({ skillKey, ruleKeys }) => ruleKeys.map((ruleKey) => ({ skillKey, ruleKey })))
    .sort((left, right) => ruleId(left.skillKey, left.ruleKey).localeCompare(ruleId(right.skillKey, right.ruleKey)));
  assert.equal(refs.length, expectedCurrent.ruleCount, `规则数不是${expectedCurrent.ruleCount}`);
  const detailResponses = await getMany(refs.map(({ skillKey, ruleKey }) => `/skills/${encodeURIComponent(skillKey)}/trigger-rules/${encodeURIComponent(ruleKey)}`));
  detailResponses.forEach((response, index) => assert.equal(response.status, 200, `${ruleId(refs[index].skillKey, refs[index].ruleKey)} 详情非200`));
  const ruleDetails = detailResponses.map((response, index) => ({ ...refs[index], data: response.data }));
  const eventTypeCounts = ruleDetails.reduce((counts, item) => {
    const key = item.data?.eventSource?.eventType;
    if (key) counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  assert.equal(eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, 'SOURCE_INITIALIZED数量不符');
  return { skillsResponse: skillsResponse.data, skillKeys, ruleLists, refs, ruleDetails, eventTypeCounts };
}

const source = sourceSnapshot();
const sourceText = jsonText(source);
const sourceSnapshotSha256 = sha256(Buffer.from(sourceText, 'utf8'));
const sourceObjects = new Map();
for (const config of targetConfigs) {
  const sourcePath = path.join(repoRoot, ...config.sourceFile.split('/'));
  sourceObjects.set(config.id, JSON.parse(fs.readFileSync(sourcePath, 'utf8')).skills[config.skillKey]);
}
const requests = targetConfigs.map((config) => {
  const body = buildRule(config);
  return {
    id: config.id,
    name: config.name,
    skillKey: config.skillKey,
    ownerKey: config.ownerKey,
    ruleKey: config.ruleKey,
    effectKey: config.effectKey,
    formulaKey: config.formulaKey,
    method: 'POST',
    route: `/skills/${config.skillKey}/trigger-rules`,
    detailRoute: `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`,
    expectedStatus: 201,
    bodySha256: shaValue(body),
    body
  };
});
const scriptHashes = scriptNames.map((name) => {
  const filePath = path.join(here, name);
  assertCondition(fs.existsSync(filePath), `缺少批次文件 ${name}`);
  return { name, sha256: fileSha(filePath) };
});
const batchSha256 = shaValue({
  revision: 'rev1',
  expectedCurrent,
  requests: requests.map(({ id, skillKey, ruleKey, route, bodySha256 }) => ({ id, skillKey, ruleKey, route, bodySha256 })),
  sourceObjects: source.objects.map(({ skillKey, objectSha256 }) => ({ skillKey, objectSha256 })),
  scriptHashes
});
const frozen = {
  schemaVersion: 1,
  revision: 'rev1',
  status: 'FROZEN',
  frozenAt: new Date().toISOString(),
  methodPolicy: { allowedBusinessMethods: ['POST'], allowedRequestCount: 4 },
  expectedCurrent,
  sourceSnapshotSha256,
  batchSha256,
  scriptHashes,
  requests,
  runtimeBoundary: '四条规则可由管理接口保存；Wasm组装、宿主命中事件生产和战斗运行尚未验证。'
};
const frozenText = jsonText(frozen);
const frozenRequestSha256 = sha256(Buffer.from(frozenText, 'utf8'));

const scan = await scanRules();
for (const config of targetConfigs) {
  const list = scan.ruleLists.find((item) => item.skillKey === config.skillKey);
  assertCondition(list, `${config.name} 缺少规则列表基线`);
  assert.deepEqual(list.ruleKeys, [], `${config.name} 写前规则列表必须为空`);
}
const targets = [];
for (const config of targetConfigs) targets.push(await readTarget(config, sourceObjects.get(config.id)));

const baseline = {
  schemaVersion: 1,
  revision: 'rev1',
  status: 'CAPTURED',
  capturedAt: new Date().toISOString(),
  methodPolicy: 'GET_ONLY',
  methods: { GET: getCount },
  getCount,
  businessWrites: 0,
  statusCounts,
  expectedCurrent,
  sourceSnapshotSha256,
  frozenRequestSha256,
  batchSha256,
  global: {
    skillsResponse: scan.skillsResponse,
    skillKeys: scan.skillKeys,
    ruleLists: scan.ruleLists.map(({ skillKey, data, ruleKeys }) => ({ skillKey, data, ruleKeys })),
    ruleDetails: scan.ruleDetails,
    ruleRefsSha256: shaValue(scan.refs),
    ruleDetailsSha256: shaValue(scan.ruleDetails),
    eventTypeCounts: scan.eventTypeCounts
  },
  targetNonRuleSnapshots: Object.fromEntries(targets.map((target) => [target.id, target.nonRule])),
  targetChecks: targets.map((target) => ({
    id: target.id,
    skillKey: target.skillKey,
    candidateDetailStatus: target.candidateDetail.status,
    nonRuleSnapshotSha256: shaValue(target.nonRule)
  })),
  experience: {
    sharedFullBaselineCount: 1,
    repeatedFullBaselineCount: 0,
    targetReadsAfterBaseline: true,
    cursorReview: '普通低风险接线，按当前流程不调用Cursor。'
  }
};

fs.writeFileSync(path.join(here, '03-来源散列快照.json'), sourceText, { encoding: 'utf8', flag: 'wx' });
fs.writeFileSync(path.join(here, '02-合并冻结请求.json'), frozenText, { encoding: 'utf8', flag: 'wx' });
fs.writeFileSync(path.join(here, '04-共享写前现值.json'), jsonText(baseline), { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({
  status: 'PASS',
  getCount,
  statusCounts,
  skillCount: scan.skillKeys.length,
  ruleCount: scan.refs.length,
  sourceInitializedCount: scan.eventTypeCounts.SOURCE_INITIALIZED || 0,
  targetCount: targets.length,
  batchSha256,
  businessWrites: 0
}, null, 2));

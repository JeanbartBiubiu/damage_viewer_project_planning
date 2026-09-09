import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

// 第二十二批最终候选受保护录入器。默认只读预检；只有显式确认、保护对象无漂移、
// 每个缺项仍为缺项且逐项写后GET一致时才允许新增组成。角色主体、目录、关系、图片
// 和已有组成永不写入。本文件不保存令牌。
const here = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.HERO22_API_TOKEN;
if (!token) throw new Error('缺少临时环境变量 HERO22_API_TOKEN');

const heroes = ['leona', 'nautilus', 'alistar', 'blitzcrank'];
const candidateHeroes = ['leona', 'nautilus'];
const slots = ['p', 'q', 'w', 'e', 'r'];
const allSkills = heroes.flatMap(hero => slots.map(slot => `${hero}_${slot}`));
const candidateSkills = candidateHeroes.flatMap(hero => slots.map(slot => `${hero}_${slot}`));
const kinds = [
  { kind: 'parameters', field: 'parameterKey', endpoint: 'parameters' },
  { kind: 'formulas', field: 'formulaKey', endpoint: 'formulas' },
  { kind: 'effects', field: 'effectKey', endpoint: 'effects' },
  { kind: 'processes', field: 'processKey', endpoint: 'processes' },
  { kind: 'internalStates', field: 'stateKey', endpoint: 'internal-states' },
  { kind: 'triggerRules', field: 'ruleKey', endpoint: 'trigger-rules' },
];
const catalogs = [
  { name: 'skill-categories', key: 'skillCategoryKey' },
  { name: 'attributes', key: 'attributeKey' },
  { name: 'modifier-zones', key: 'modifierZoneKey' },
  { name: 'damage-types', key: 'damageTypeKey' },
];
const expected = {
  candidateSha256: '9ce3115402b975c25dc86ce779179e094fba433ff3273a3aac5d06952547e074',
  planSha256: '3ca4514a0f7d61b7852e771f7e714a8979d1a735f546e5a552370930225aa4ba',
  lockSha256: 'fed7aca54f6da2c62dbc8a046a91f3a577320343ebd52064d5264aed4be0a1bf',
  versionSha256: '37296dd40be566d4b54a4017659fa6bc3fa826bc9a37f38de021e673afc93137',
  mathSha256: '5a1f5131bba0d9f2dc696b1135ca67858a371b250cf952306da8cec897e17853',
  snapshotSha256: '8ec887af62d5c6ebdf592fab60b72cd2589022338ce76ee589f8c370bce7d079',
  sourceSha256: '1f5c18f71a9492a5aa86f33c4896f5c47b460c85b0b5f4560029856b2e8761f5',
  sourceManifestSha256: '9dfa1b1ec7debc76d6ea73629f03e55577a4955f84d398050c5871b1bf223014',
  counts: { parameters: 54, formulas: 14, effects: 9, processes: 0, internalStates: 0, triggerRules: 0 },
  totalNew: 77,
  reusedPublic: 16,
  existingDetails: 29,
  preflightGets: 201,
};

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw new Error('只接受默认只读预检或 --apply');
const apply = args.includes('--apply');
if (apply && process.env.HERO22_APPLY_CONFIRM !== 'CONFIRM_HERO22_COMPONENT_POSTS') {
  throw new Error('实际POST需要显式设置 HERO22_APPLY_CONFIRM=CONFIRM_HERO22_COMPONENT_POSTS；当前保持只读预检');
}

const sha256 = value => createHash('sha256').update(value).digest('hex');
const readBytes = name => fs.readFileSync(path.join(here, name));
const readJson = name => JSON.parse(readBytes(name));
const fileSha = name => sha256(readBytes(name));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
const identity = (skillKey, kind, stableKey) => `${skillKey}/${kind}/${stableKey}`;
const keyOf = (item, field) => item?.[field] ?? null;
const candidate = readJson('最终候选.json');
const plan = readJson('最终请求计划.json');
const freeze = readJson('最终冻结候选锁.json');
const version = readJson('最终候选版本.json');
const math = readJson('最终严格数学.json');
const originalSnapshot = readJson('当前现值保护快照.json');

function diff(expectedValue, actualValue, at = '$') {
  if (isDeepStrictEqual(expectedValue, actualValue)) return null;
  if (expectedValue === null || actualValue === null || typeof expectedValue !== 'object' || typeof actualValue !== 'object') {
    return { path: at, expected: expectedValue, actual: actualValue };
  }
  if (Array.isArray(expectedValue) || Array.isArray(actualValue)) {
    if (!Array.isArray(expectedValue) || !Array.isArray(actualValue) || expectedValue.length !== actualValue.length) {
      return { path: at, expected: expectedValue, actual: actualValue };
    }
    for (let index = 0; index < expectedValue.length; index++) {
      const child = diff(expectedValue[index], actualValue[index], `${at}[${index}]`);
      if (child) return child;
    }
    return null;
  }
  for (const key of [...new Set([...Object.keys(expectedValue), ...Object.keys(actualValue)])].sort()) {
    if (!(key in expectedValue) || !(key in actualValue)) return { path: `${at}.${key}`, expected: expectedValue[key], actual: actualValue[key] };
    const child = diff(expectedValue[key], actualValue[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
}

// API 返回的已有详情允许服务端补充这四个字段；其余业务字段逐字段比较。
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const businessCanonical = value => Array.isArray(value)
  ? value.map(businessCanonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !serverFields.has(key)).sort().map(key => [key, businessCanonical(value[key])]))
    : value;
const businessDiff = (expectedValue, actualValue) => diff(businessCanonical(expectedValue), businessCanonical(actualValue));

const staticChecks = [];
const staticFailures = [];
function check(name, passed, detail = null) {
  const row = { name, passed: Boolean(passed), detail };
  staticChecks.push(row);
  if (!row.passed) staticFailures.push(row);
  return row.passed;
}

const candidateEntries = [];
for (const skillKey of candidateSkills) {
  const skill = candidate.skills?.[skillKey];
  for (const spec of kinds) {
    for (const body of skill?.write?.[spec.kind] ?? []) {
      candidateEntries.push({ skillKey, kind: spec.kind, field: spec.field, endpoint: spec.endpoint, id: body[spec.field], body, route: `/skills/${skillKey}/${spec.endpoint}` });
    }
  }
}
const candidateEntryMap = new Map(candidateEntries.map(entry => [identity(entry.skillKey, entry.kind, entry.id), entry]));
const planEntries = (plan.requests ?? []).map(request => ({
  skillKey: request.skillKey,
  kind: request.kind,
  id: request.stableKey,
  field: kinds.find(spec => spec.kind === request.kind)?.field ?? null,
  endpoint: kinds.find(spec => spec.kind === request.kind)?.endpoint ?? null,
  route: request.route,
  detailRoute: `/skills/${request.skillKey}/${kinds.find(spec => spec.kind === request.kind)?.endpoint ?? request.kind}/${encodeURIComponent(request.stableKey)}`,
  body: request.body,
}));
const planEntryMap = new Map(planEntries.map(entry => [identity(entry.skillKey, entry.kind, entry.id), entry]));
const reusedKeys = new Set((candidate.reusedPublicParameters ?? []).map(item => identity(item.skillKey, 'parameters', item.parameterKey)));

check('最终候选文件散列冻结', fileSha('最终候选.json') === expected.candidateSha256, fileSha('最终候选.json'));
check('最终请求计划散列冻结', fileSha('最终请求计划.json') === expected.planSha256, fileSha('最终请求计划.json'));
check('最终候选锁散列冻结', fileSha('最终冻结候选锁.json') === expected.lockSha256, fileSha('最终冻结候选锁.json'));
check('最终候选版本散列冻结', fileSha('最终候选版本.json') === expected.versionSha256, fileSha('最终候选版本.json'));
check('最终严格数学散列冻结', fileSha('最终严格数学.json') === expected.mathSha256, fileSha('最终严格数学.json'));
check('最终严格数学全公式与边界通过', math.summary?.finalFormulaCount === 14 && math.summary?.formulaCases === 28 && math.summary?.rejectionCases === 6 && math.summary?.boundaryCases === 3 && math.summary?.failures === 0 && math.summary?.passed === true && math.sourceTreeBasis?.dataValue === 'ArmorBaseBonus', math.summary);
check('现值快照散列冻结', fileSha('当前现值保护快照.json') === expected.snapshotSha256, fileSha('当前现值保护快照.json'));
check('源值核对散列冻结', fileSha('候选源值核对.json') === expected.sourceSha256, fileSha('候选源值核对.json'));
check('最终来源哈希汇总冻结', fileSha('最终来源哈希汇总.json') === expected.sourceManifestSha256, fileSha('最终来源哈希汇总.json'));
check('锁内散列互相一致', freeze.candidateSha256 === expected.candidateSha256 && freeze.requestPlanSha256 === expected.planSha256 && freeze.snapshotSha256 === expected.snapshotSha256 && freeze.sourceValuesSha256 === expected.sourceSha256 && freeze.sourceManifestSha256 === expected.sourceManifestSha256, freeze);
check('版本文件引用一致', version.candidateSha256 === expected.candidateSha256 && version.requestPlanSha256 === expected.planSha256, version);
check('锁内禁止业务写入', freeze.businessWrites === 0 && candidate.apiWrites === 0 && plan.businessWrites === 0, { freeze: freeze.businessWrites, candidate: candidate.apiWrites, plan: plan.businessWrites });
check('候选槽顺序冻结', isDeepStrictEqual(Object.keys(candidate.skills ?? {}), candidateSkills), Object.keys(candidate.skills ?? {}));
check('候选计数冻结', isDeepStrictEqual(candidate.counts, expected.counts), candidate.counts);
check('候选条目唯一', candidateEntryMap.size === candidateEntries.length && candidateEntries.length === 77, { total: candidateEntries.length, unique: candidateEntryMap.size });
check('计划条目唯一且与候选一一对应', planEntryMap.size === planEntries.length && planEntries.length === 77 && planEntries.every(entry => {
  const candidateEntry = candidateEntryMap.get(identity(entry.skillKey, entry.kind, entry.id));
  return candidateEntry && isDeepStrictEqual(entry.body, candidateEntry.body) && entry.route === candidateEntry.route;
}), { total: planEntries.length, unique: planEntryMap.size });
check('计划计数冻结', isDeepStrictEqual(plan.requestCounts, expected.counts) && plan.requestCount === expected.totalNew, plan.requestCounts);
check('只新增三类组成', planEntries.every(entry => ['parameters', 'formulas', 'effects'].includes(entry.kind)) && candidateEntries.every(entry => ['parameters', 'formulas', 'effects'].includes(entry.kind)), null);
check('既有公共参数不进入POST', planEntries.every(entry => !reusedKeys.has(identity(entry.skillKey, entry.kind, entry.id))) && reusedKeys.size === expected.reusedPublic, { reused: reusedKeys.size });
check('不写主体、关系、图片和目录', candidateEntries.every(entry => entry.route.startsWith('/skills/') && !entry.route.includes('/characters') && !entry.route.includes('/relations')), null);

function walk(value, callback, at = '$') {
  if (!value || typeof value !== 'object') return;
  callback(value, at);
  for (const [key, child] of Object.entries(value)) walk(child, callback, `${at}.${key}`);
}
function validateCandidateSchema() {
  const errors = [];
  const valueTypes = new Set(['INTEGER', 'DECIMAL']);
  const valueModes = new Set(['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT']);
  const nodeTypes = new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']);
  const operations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
  const resultTypes = new Set(['RESOURCE_CHANGE', 'NORMAL_SHIELD']);
  const add = (message, at) => errors.push({ message, at });
  for (const skillKey of candidateSkills) {
    const skill = candidate.skills[skillKey];
    const parameterKeys = new Set();
    for (const parameter of skill.write.parameters) {
      if (parameterKeys.has(parameter.parameterKey)) add('参数键重复', `${skillKey}/${parameter.parameterKey}`);
      parameterKeys.add(parameter.parameterKey);
      if (!valueTypes.has(parameter.valueType) || !valueModes.has(parameter.valueMode)) add('参数类型或取值模式未知', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.valueMode === 'FIXED' && (parameter.fixedValue === null || parameter.fixedValue === undefined || parameter.levelValues !== null)) add('固定参数形态错误', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) add('运行输入不允许默认值', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.valueMode === 'SKILL_LEVEL' && (parameter.fixedValue !== null || !parameter.levelValues || Object.keys(parameter.levelValues).length !== skill.maxLevel)) add('技能等级参数等级表不完整', `${skillKey}/${parameter.parameterKey}`);
      const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : [];
      if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) add('参数值不是有限数字', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.valueType === 'INTEGER' && values.some(value => !Number.isInteger(value))) add('整数参数含小数', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.parameterKey.endsWith('_ms') && values.some(value => value < 0)) add('毫秒参数为负', `${skillKey}/${parameter.parameterKey}`);
    }
    for (const formula of skill.write.formulas) {
      walk(formula.expression, (node, at) => {
        if (node.nodeType !== undefined && !nodeTypes.has(node.nodeType)) add('公式节点类型未知', `${skillKey}/${formula.formulaKey}${at}`);
        if (node.nodeType === 'PARAMETER' && !parameterKeys.has(node.parameterKey)) add('公式参数引用未定义', `${skillKey}/${formula.formulaKey}${at}`);
        if (node.nodeType === 'OPERATION' && (!operations.has(node.operation) || !Array.isArray(node.operands) || node.operands.length !== 2)) add('公式运算结构非法', `${skillKey}/${formula.formulaKey}${at}`);
      });
    }
    for (const effect of skill.write.effects) {
      if (effect.effectKey === 'mana_cost' && effect.lifecycle !== null && effect.lifecycle !== undefined) add('法力代价效果不应带生命周期', `${skillKey}/${effect.effectKey}`);
      if (effect.effectKey === 'shield' && (effect.lifecycle === null || effect.lifecycle === undefined)) add('自身护盾效果必须带生命周期', `${skillKey}/${effect.effectKey}`);
      walk(effect, (node, at) => {
        if (node.resultType !== undefined && !resultTypes.has(node.resultType)) add('效果结果类型未知', `${skillKey}/${effect.effectKey}${at}`);
        if (node.nodeType === 'PARAMETER' || node.nodeType === 'ATTRIBUTE') add('效果不得把表达式树节点当字段', `${skillKey}/${effect.effectKey}${at}`);
        if (node.valueMode === 'RUNTIME_INPUT' || node.mode === 'RUNTIME_INPUT') add('效果间接引用运行输入', `${skillKey}/${effect.effectKey}${at}`);
        if (node.durationValue && (node.durationValue.nodeType !== undefined || !['PARAMETER', 'FIXED', 'FORMULA'].includes(node.durationValue.kind))) add('生命周期时长必须使用kind字段', `${skillKey}/${effect.effectKey}${at}`);
      });
      if (JSON.stringify(effect).includes('DAMAGE') || JSON.stringify(effect).includes('DIRECT_HEAL') || JSON.stringify(effect).includes('MOMENT_EVALUATION')) add('效果含禁止的即时结果或时刻求值', `${skillKey}/${effect.effectKey}`);
    }
    for (const kind of ['processes', 'internalStates', 'triggerRules']) if (skill.write[kind]?.length) add('禁止写入非参数公式效果组成', `${skillKey}/${kind}`);
  }
  return errors;
}
const schemaErrors = validateCandidateSchema();
check('候选结构与类型校验', schemaErrors.length === 0, schemaErrors);

const requests = [];
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(here, '最终-只读预检', runId);
await fsp.mkdir(runDir, { recursive: true });
const journalFile = path.join(runDir, 'HTTP流水.jsonl');
const writeJournalFile = path.join(runDir, '写入流水.jsonl');
const appendJsonl = async (file, value) => {
  const handle = await fsp.open(file, 'a');
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
};
const saveJson = async (name, value) => {
  const file = path.join(runDir, name);
  await fsp.writeFile(file, jsonBytes(value), { flag: 'wx' });
};
const request = async (route, options = {}) => {
  if (!route.startsWith('/') || route.includes('://') || route.includes('..')) throw new Error(`非法接口路径：${route}`);
  const method = options.method ?? 'GET';
  if (!['GET', 'POST'].includes(method)) throw new Error(`禁止HTTP方法：${method}`);
  if (method === 'POST' && !apply) throw new Error('只读预检禁止POST');
  const sequence = requests.length + 1;
  const at = new Date().toISOString();
  await appendJsonl(journalFile, { sequence, phase: '请求前', at, method, route, ...(method === 'POST' ? { body: options.body } : {}) });
  const started = Date.now();
  let result;
  try {
    const response = await fetch(apiBase + route, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    const raw = await response.text();
    let data = null;
    let parseError = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (error) { parseError = `${error.name}: ${error.message}`; }
    result = { sequence, at, method, route, status: response.status, ok: response.ok && !parseError, elapsedMs: Date.now() - started, data, ...(parseError ? { parseError, rawBytes: Buffer.byteLength(raw), rawSha256: sha256(raw) } : {}) };
  } catch (error) {
    result = { sequence, at, method, route, status: null, ok: false, elapsedMs: Date.now() - started, data: null, error: `${error.name}: ${error.message}` };
  }
  requests.push(result);
  await appendJsonl(journalFile, { ...result, phase: '请求后' });
  return result;
};
const mustGet = async route => {
  const result = await request(route);
  if (!result.ok) throw new Error(`GET失败，立即停止：${route} status=${result.status ?? 'network'}`);
  return result;
};
const allowMissingGet = async route => {
  const result = await request(route);
  if (!result.ok && result.status !== 404) throw new Error(`缺项探测GET失败，立即停止：${route} status=${result.status ?? 'network'}`);
  return result;
};

async function fetchProtection() {
  const state = { catalogs: {}, characters: {}, relations: {}, subjects: {}, components: {}, images: {} };
  for (const catalog of catalogs) state.catalogs[catalog.name] = await mustGet(`/${catalog.name}`).then(result => result.data);
  for (const hero of heroes) {
    state.characters[hero] = (await mustGet(`/characters/champion_${hero}`)).data;
    state.relations[hero] = (await mustGet(`/character-skill-relations?characterKey=champion_${hero}`)).data;
  }
  for (const skillKey of allSkills) {
    state.subjects[skillKey] = (await mustGet(`/skills/${skillKey}`)).data;
    state.components[skillKey] = {};
    for (const spec of kinds) {
      const list = (await mustGet(`/skills/${skillKey}/${spec.endpoint}`)).data;
      const items = rows(list);
      const seen = new Set();
      const details = [];
      for (const item of items) {
        const stableKey = keyOf(item, spec.field);
        if (typeof stableKey !== 'string' || seen.has(stableKey)) throw new Error(`列表稳定键无效或重复：${skillKey}/${spec.kind}/${stableKey}`);
        seen.add(stableKey);
      }
      for (const item of items) {
        const stableKey = item[spec.field];
        const response = await mustGet(`/skills/${skillKey}/${spec.endpoint}/${encodeURIComponent(stableKey)}`);
        details.push({ stableKey, response: response.data });
      }
      state.components[skillKey][spec.kind] = { list, details };
    }
    state.images[skillKey] = (await mustGet(`/skills/${skillKey}/representative-image`)).data;
  }
  return state;
}

function compareProtection(expectedState, actualState) {
  const conflicts = [];
  for (const catalog of catalogs) {
    const item = diff(expectedState.catalogs?.[catalog.name], actualState.catalogs?.[catalog.name]);
    if (item) conflicts.push({ type: 'catalog', name: catalog.name, diff: item });
  }
  for (const hero of heroes) {
    for (const [type, key] of [['character', 'characters'], ['relation', 'relations']]) {
      const item = diff(expectedState[key]?.[hero], actualState[key]?.[hero]);
      if (item) conflicts.push({ type, hero, diff: item });
    }
  }
  for (const skillKey of allSkills) {
    for (const [type, key] of [['subject', 'subjects'], ['image', 'images']]) {
      const item = diff(expectedState[key]?.[skillKey], actualState[key]?.[skillKey]);
      if (item) conflicts.push({ type, skillKey, diff: item });
    }
    for (const spec of kinds) {
      const before = expectedState.components?.[skillKey]?.[spec.kind];
      const after = actualState.components?.[skillKey]?.[spec.kind];
      const listDiff = diff(before?.list, after?.list);
      if (listDiff) conflicts.push({ type: 'list', skillKey, kind: spec.kind, diff: listDiff });
      const beforeDetails = new Map((before?.details ?? []).map(item => [item.stableKey, item.response]));
      const afterDetails = new Map((after?.details ?? []).map(item => [item.stableKey, item.response]));
      for (const [stableKey, beforeValue] of beforeDetails) {
        const detailDiff = diff(beforeValue, afterDetails.get(stableKey));
        if (detailDiff) conflicts.push({ type: 'detail', skillKey, kind: spec.kind, stableKey, diff: detailDiff });
      }
      if (beforeDetails.size !== afterDetails.size) conflicts.push({ type: 'detailCount', skillKey, kind: spec.kind, expected: beforeDetails.size, actual: afterDetails.size });
    }
  }
  return conflicts;
}

function flattenCurrent(state) {
  const map = new Map();
  for (const skillKey of allSkills) for (const spec of kinds) {
    for (const item of state.components?.[skillKey]?.[spec.kind]?.details ?? []) map.set(identity(skillKey, spec.kind, item.stableKey), item.response);
  }
  return map;
}
function currentCounts(state) {
  const counts = Object.fromEntries(kinds.map(spec => [spec.kind, 0]));
  let details = 0;
  for (const skillKey of allSkills) for (const spec of kinds) {
    const list = state.components?.[skillKey]?.[spec.kind]?.list;
    counts[spec.kind] += rows(list).length;
    details += state.components?.[skillKey]?.[spec.kind]?.details?.length ?? 0;
  }
  return { counts, details };
}
function targetNonPublic(state) {
  const allowed = new Set(['cooldown_ms', 'mana_cost']);
  const rowsFound = [];
  for (const skillKey of candidateSkills) {
    const values = rows(state.components?.[skillKey]?.parameters?.list);
    for (const item of values) if (!allowed.has(item.parameterKey)) rowsFound.push({ skillKey, parameterKey: item.parameterKey });
    for (const spec of kinds.filter(item => item.kind !== 'parameters')) {
      for (const item of rows(state.components?.[skillKey]?.[spec.kind]?.list)) rowsFound.push({ skillKey, kind: spec.kind, key: item[spec.field] });
    }
  }
  return rowsFound;
}
function catalogKeys(data, key) { return new Set(rows(data).map(item => item?.[key]).filter(value => typeof value === 'string')); }
function expressionAttributes(expression, result = []) {
  if (!expression || typeof expression !== 'object') return result;
  if (expression.nodeType === 'ATTRIBUTE') result.push(expression);
  for (const child of expression.operands ?? []) expressionAttributes(child, result);
  return result;
}
function validateFreshCandidate(state) {
  const errors = [];
  const attributes = catalogKeys(state.catalogs.attributes, 'attributeKey');
  for (const entry of candidateEntries) {
    for (const node of expressionAttributes(entry.body.expression)) {
      if (!attributes.has(node.attributeKey)) errors.push({ type: 'attribute', identity: identity(entry.skillKey, entry.kind, entry.id), attributeKey: node.attributeKey });
    }
    walk(entry.body, (node, at) => {
      if (node.resultType === 'RESOURCE_CHANGE' && node.detail?.attributeKey !== 'mana') errors.push({ type: 'resource', identity: identity(entry.skillKey, entry.kind, entry.id), at, attributeKey: node.detail?.attributeKey });
      if (node.resultType === 'NORMAL_SHIELD' && node.target !== 'SOURCE') errors.push({ type: 'shieldTarget', identity: identity(entry.skillKey, entry.kind, entry.id), at, target: node.target });
    });
  }
  return errors;
}

const report = {
  at: new Date().toISOString(),
  runId,
  mode: apply ? 'apply' : '只读预检',
  apiBase,
  candidateSha256: expected.candidateSha256,
  planSha256: expected.planSha256,
  businessWrites: 0,
  expected: { catalogs: 4, subjects: 20, characters: 4, relations: 4, images: 20, componentLists: 120, protectedDetails: expected.existingDetails, candidateComponents: expected.totalNew },
  candidateCounts: expected.counts,
  reusedPublicParameters: expected.reusedPublic,
  staticChecks,
  staticFailures,
  calls: null,
  freshCounts: null,
  protectionConflicts: null,
  candidateConflicts: null,
  missing: null,
  apiWrites: 0,
  success: false,
  errors: [],
};
const saveReport = async () => {
  report.calls = {
    total: requests.length,
    methods: requests.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}),
    statuses: requests.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}),
  };
  report.apiWrites = requests.filter(item => item.method === 'POST').length;
  await fsp.writeFile(path.join(runDir, '执行结果.json'), jsonBytes(report));
};

  await saveJson('运行锁.json', { at: report.at, runId, mode: report.mode, candidateSha256: expected.candidateSha256, planSha256: expected.planSha256, expectedPosts: apply ? expected.totalNew : 0, businessWrites: 0 });
await appendJsonl(journalFile, { sequence: 0, phase: '运行开始', at: report.at, method: 'NONE', route: null, mode: report.mode });

try {
  if (staticFailures.length) throw new Error(`静态冻结校验失败${staticFailures.length}项`);
  const fresh = await fetchProtection();
  await saveJson('完整只读现值.json', fresh);
  const freshCounts = currentCounts(fresh);
  const protectionConflicts = compareProtection(originalSnapshot, fresh);
  const candidateConflicts = validateFreshCandidate(fresh);
  const current = flattenCurrent(fresh);
  const missing = planEntries.filter(entry => !current.has(identity(entry.skillKey, entry.kind, entry.id)));
  const existingNonPublic = targetNonPublic(fresh);
  const catalogPresence = {
    attributes: ['ability_power', 'attack_damage', 'hp', 'magic_resistance', 'mana'].map(key => ({ key, present: catalogKeys(fresh.catalogs.attributes, 'attributeKey').has(key) })),
  };
  report.freshCounts = { ...freshCounts, expectedExistingDetails: expected.existingDetails, existingNonPublic };
  report.protectionConflicts = protectionConflicts;
  report.candidateConflicts = candidateConflicts;
  report.missing = { count: missing.length, byKind: Object.fromEntries(kinds.map(spec => [spec.kind, missing.filter(entry => entry.kind === spec.kind).length])), identities: missing.map(entry => identity(entry.skillKey, entry.kind, entry.id)) };
  report.catalogPresence = catalogPresence;
  const preflightPass = requests.length === expected.preflightGets
    && requests.every(item => item.method === 'GET' && item.status === 200 && item.ok)
    && freshCounts.details === expected.existingDetails
    && protectionConflicts.length === 0
    && candidateConflicts.length === 0
    && existingNonPublic.length === 0
    && missing.length === expected.totalNew
    && Object.values(catalogPresence).flat().every(item => item.present);
  report.preflight = { pass: preflightPass, expectedGets: expected.preflightGets, actualGets: requests.length, protectionConflicts: protectionConflicts.length, candidateConflicts: candidateConflicts.length, existingNonPublic: existingNonPublic.length, missing: missing.length, freshCounts, catalogPresence, apiWrites: requests.filter(item => item.method !== 'GET').length };
  await saveReport();
  if (!preflightPass) throw new Error(`只读预检失败：${JSON.stringify({ gets: requests.length, protection: protectionConflicts.length, candidate: candidateConflicts.length, nonPublic: existingNonPublic.length, missing: missing.length })}`);
  if (!apply) {
    report.success = true;
    report.nextStep = '根负责人审查后，如需实际补缺，设置HERO22_APPLY_CONFIRM并以--apply运行；本次没有POST。';
  } else {
    const persistentLock = path.join(here, '最终-写入准备', '实际录入写入锁.json');
    await fsp.mkdir(path.dirname(persistentLock), { recursive: true });
    let lockHandle;
    try { lockHandle = await fsp.open(persistentLock, 'wx'); } catch (error) { throw new Error(error.code === 'EEXIST' ? '已存在实际录入写入锁，禁止并行或重放' : error.message); }
    try {
      await lockHandle.writeFile(JSON.stringify({ at: new Date().toISOString(), runId, candidateSha256: expected.candidateSha256, planSha256: expected.planSha256, expectedPosts: expected.totalNew, policy: '只允许最终候选中的新增参数、公式、效果POST；主体、目录、关系、图片及已有组成永不写入。' }, null, 2) + '\n');
      await lockHandle.sync();
    } finally { await lockHandle.close(); }
    const applyResult = { startedAt: new Date().toISOString(), confirmed: 0, postCount: 0, skippedExisting: 0, stopped: false, stopReason: null };
    for (const entry of planEntries) {
      const before = await allowMissingGet(entry.detailRoute);
      if (before.status === 200) {
        const bodyDiff = businessDiff(entry.body, before.data);
        if (bodyDiff) throw new Error(`写前已有同键但值不一致：${identity(entry.skillKey, entry.kind, entry.id)}`);
        applyResult.confirmed++;
        applyResult.skippedExisting++;
        await appendJsonl(writeJournalFile, { at: new Date().toISOString(), action: '已有同值，跳过POST', identity: identity(entry.skillKey, entry.kind, entry.id), status: before.status });
        continue;
      }
      const intentName = `${sha256(`${expected.candidateSha256}\n${entry.detailRoute}\n${entry.id}`)}.json`;
      const intentDir = path.join(here, '最终-写入准备', '写前意图');
      await fsp.mkdir(intentDir, { recursive: true });
      const intentFile = path.join(intentDir, intentName);
      try {
        const intentHandle = await fsp.open(intentFile, 'wx');
        try { await intentHandle.writeFile(JSON.stringify({ at: new Date().toISOString(), candidateSha256: expected.candidateSha256, method: 'POST', route: entry.route, detailRoute: entry.detailRoute, skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, body: entry.body }, null, 2) + '\n'); await intentHandle.sync(); } finally { await intentHandle.close(); }
      } catch (error) {
        if (error.code === 'EEXIST') throw new Error(`写前意图已存在且组成仍缺失，停止：${identity(entry.skillKey, entry.kind, entry.id)}`);
        throw error;
      }
      await appendJsonl(writeJournalFile, { at: new Date().toISOString(), action: '准备POST', identity: identity(entry.skillKey, entry.kind, entry.id), route: entry.route, body: entry.body, intentFile });
      const post = await request(entry.route, { method: 'POST', body: entry.body });
      if (!post.ok) {
        applyResult.stopped = true;
        applyResult.stopReason = { phase: 'POST失败', identity: identity(entry.skillKey, entry.kind, entry.id), status: post.status, error: post.error ?? post.parseError };
        await appendJsonl(writeJournalFile, { at: new Date().toISOString(), action: 'POST失败，停止全部写入', ...applyResult.stopReason });
        break;
      }
      const after = await mustGet(entry.detailRoute);
      const afterDiff = businessDiff(entry.body, after.data);
      applyResult.postCount++;
      if (afterDiff) {
        applyResult.stopped = true;
        applyResult.stopReason = { phase: '写后GET不一致', identity: identity(entry.skillKey, entry.kind, entry.id), diff: afterDiff, postStatus: post.status, readbackStatus: after.status };
        await appendJsonl(writeJournalFile, { at: new Date().toISOString(), action: '写后GET异常，停止全部写入', ...applyResult.stopReason });
        break;
      }
      applyResult.confirmed++;
      await appendJsonl(writeJournalFile, { at: new Date().toISOString(), action: 'POST后GET确认', identity: identity(entry.skillKey, entry.kind, entry.id), postStatus: post.status, readbackStatus: after.status });
    }
    applyResult.finishedAt = new Date().toISOString();
    report.apply = applyResult;
    await saveJson('实际写入结果.json', applyResult);
    if (applyResult.stopped || applyResult.confirmed !== planEntries.length) throw new Error(`实际补缺未全部确认：${JSON.stringify({ confirmed: applyResult.confirmed, expected: planEntries.length, postCount: applyResult.postCount, stopped: applyResult.stopped })}`);
    report.success = true;
    report.nextStep = '逐项写后GET已完成；另行运行独立全量回读器确认全量组成与公式。';
  }
} catch (error) {
  report.errors.push({ name: error.name, message: error.message });
} finally {
  report.finishedAt = new Date().toISOString();
  await saveReport();
}

console.log(JSON.stringify({ success: report.success, mode: report.mode, runId, apiWrites: report.apiWrites, calls: report.calls, preflight: report.preflight ?? null, errors: report.errors, output: runDir }, null, 2));
if (!report.success) process.exitCode = 1;

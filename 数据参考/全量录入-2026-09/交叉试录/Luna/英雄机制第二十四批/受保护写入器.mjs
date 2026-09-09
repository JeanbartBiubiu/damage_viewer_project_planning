import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 默认只读预检。只有 --apply、专用环境确认、唯一锁、冻结散列和逐项GET保护同时通过时才允许POST。
// 本器只可能创建参数、公式、效果；主体、目录、已有组成、过程、内部状态和触发规则永不更新。
const here = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidateName = '完整候选.json';
const versionName = '候选版本.json';
const planName = '写入请求计划.json';
const freezeName = '写入准备冻结.json';
const snapshotName = '写前现值.json';
const heroes = ['nunu', 'sejuani', 'sion', 'volibear'];
const skills = heroes.flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const kinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
const catalogKinds = [
  ['attributes', 'attributeKey'],
  ['modifier-zones', 'modifierZoneKey'],
  ['damage-types', 'damageTypeKey'],
  ['statuses', 'statusKey'],
];
const writableKinds = new Set(['parameters', 'formulas', 'effects']);
const allowedNodeTypes = new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']);
const allowedOperations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw Error('只接受默认只读预检或 --apply');
const apply = args.includes('--apply');
if (apply && process.env.HERO24_APPLY_CONFIRM !== 'CONFIRM_HERO24_COMPONENT_POSTS') throw Error('实际POST需要显式设置 HERO24_APPLY_CONFIRM=CONFIRM_HERO24_COMPONENT_POSTS');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fileBytes = name => fs.readFileSync(path.join(here, name));
const readJson = name => JSON.parse(fileBytes(name));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : Array.isArray(value?.data?.items) ? value.data.items : [];
const idField = kind => kinds.find(item => item[0] === kind)?.[1];
const endpointKind = kind => kinds.find(item => item[0] === kind)?.[2];
const keyOf = (skillKey, kind, id) => `${skillKey}/${kind}/${id}`;
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !serverFields.has(key)).sort().map(key => [key, canonical(value[key])]))
    : value;
const exactCanonical = value => Array.isArray(value)
  ? value.map(exactCanonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, exactCanonical(value[key])]))
    : value;
const diff = (expected, actual, at = '$') => {
  if (equal(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return { path: at, expected, actual };
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return { path: at, expected, actual };
    for (let index = 0; index < expected.length; index++) { const child = diff(expected[index], actual[index], `${at}[${index}]`); if (child) return child; }
    return null;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    if (!(key in expected) || !(key in actual)) return { path: `${at}.${key}`, expected: expected[key], actual: actual[key] };
    const child = diff(expected[key], actual[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
};
const businessDiff = (expected, actual) => diff(canonical(expected), canonical(actual));
const exactDiff = (expected, actual) => diff(exactCanonical(expected), exactCanonical(actual));
const detailData = record => record?.detail?.data ?? record?.detail?.response ?? record?.response?.data ?? record?.data ?? null;
const listSummaryDiff = (item, detail) => {
  if (!item || !detail) return { path: '$', expected: '详情对象', actual: detail };
  const countFields = { actionCount: 'actions', conditionGroupCount: 'conditionGroups', effectBindingCount: 'effectBindings', resultCount: 'results', stateOperationCount: 'stateOperations', stepCount: 'steps' };
  for (const [key, expectedValue] of Object.entries(item)) {
    if (key === 'updatedAt' && !(key in detail)) continue;
    const actualValue = countFields[key]
      ? Array.isArray(detail[countFields[key]]) ? detail[countFields[key]].length : undefined
      : key === 'eventType'
        ? detail.eventSource?.eventType
        : key === 'maxTriggersPerProcessEnabled'
          ? detail.maxTriggersPerProcess !== null && detail.maxTriggersPerProcess !== undefined
          : key === 'perTargetCooldownEnabled'
            ? detail.perTargetCooldown !== null && detail.perTargetCooldown !== undefined
            : key === 'lifecycleEnabled'
              ? detail.lifecycle !== null && detail.lifecycle !== undefined
              : detail[key];
    if (!equal(expectedValue, actualValue)) return { path: key, expected: expectedValue, actual: actualValue };
  }
  return null;
};

const candidateBytes = fileBytes(candidateName);
const versionBytes = fileBytes(versionName);
const planBytes = fileBytes(planName);
const freezeBytes = fileBytes(freezeName);
const snapshotBytes = fileBytes(snapshotName);
const candidate = JSON.parse(candidateBytes);
const version = JSON.parse(versionBytes);
const plan = JSON.parse(planBytes);
const freeze = JSON.parse(freezeBytes);
const baseline = JSON.parse(snapshotBytes);
const staticChecks = [];
const staticFailures = [];
const check = (name, passed, detail = null) => { const row = { name, passed: Boolean(passed), detail }; staticChecks.push(row); if (!row.passed) staticFailures.push(row); return row.passed; };
const checkHash = (name, actual, expected) => check(name, actual === expected, actual);

checkHash('候选散列冻结', sha256(candidateBytes), freeze.candidateSha256);
checkHash('候选版本散列冻结', sha256(versionBytes), freeze.candidateVersionSha256);
checkHash('请求计划散列冻结', sha256(planBytes), freeze.requestPlanSha256);
checkHash('写前现值散列冻结', sha256(snapshotBytes), freeze.snapshotSha256);
check('冻结状态待授权', freeze.status === 'PREPARED_NOT_APPLIED', freeze.status);
check('游戏和来源版本固定', freeze.gameId === 'lol' && freeze.sourceVersion === 'client16.17/official16.17.1', { gameId: freeze.gameId, sourceVersion: freeze.sourceVersion });
for (const [name, expected] of Object.entries(freeze.sourceHashes ?? {})) {
  let actual = null;
  try { actual = sha256(fileBytes(name)); } catch (error) { staticFailures.push({ name: `冻结源文件存在/${name}`, passed: false, detail: error.message }); continue; }
  checkHash(`冻结源文件散列/${name}`, actual, expected);
}
for (const historical of [freeze.historicalCandidates?.previousFinal, freeze.historicalCandidates?.priorIntermediate]) {
  if (!historical) continue;
  checkHash(`历史候选保持/${historical.path}`, sha256(fileBytes(historical.path)), historical.sha256);
}
check('候选版本内部候选散列一致', version.fileSha256 === sha256(candidateBytes), { declared: version.fileSha256, actual: sha256(candidateBytes) });
check('请求计划绑定候选', plan.candidateSha256 === sha256(candidateBytes), plan.candidateSha256);
check('请求计划绑定版本', plan.candidateVersionSha256 === sha256(versionBytes), plan.candidateVersionSha256);
check('请求计划绑定写前现值', plan.snapshotSha256 === sha256(snapshotBytes), plan.snapshotSha256);

const reuseSet = new Set((plan.reuseParameters ?? []).map(item => `${item.skillKey}/${item.parameterKey}`));
const candidateByKey = new Map();
const allEntries = [];
for (const skillKey of skills) {
  const skill = candidate.skills?.[skillKey];
  check(`候选技能位/${skillKey}`, Boolean(skill), skill ? skill.maxLevel : null);
  for (const [kind, field] of kinds) {
    const list = skill?.write?.[kind];
    check(`候选组成数组/${skillKey}/${kind}`, Array.isArray(list), Array.isArray(list) ? list.length : typeof list);
    for (const body of list ?? []) {
      const id = body?.[field];
      const compound = keyOf(skillKey, kind, id);
      if (candidateByKey.has(compound)) check(`候选键唯一/${compound}`, false, '重复');
      candidateByKey.set(compound, { skillKey, kind, id, body, route: `/skills/${encodeURIComponent(skillKey)}/${endpointKind(kind)}`, detailRoute: `/skills/${encodeURIComponent(skillKey)}/${endpointKind(kind)}/${encodeURIComponent(id ?? '')}` });
      allEntries.push(candidateByKey.get(compound));
    }
    if (!writableKinds.has(kind)) check(`禁止写入/${skillKey}/${kind}`, (list ?? []).length === 0, list);
  }
}
const candidateCounts = Object.fromEntries(kinds.map(([kind]) => [kind, allEntries.filter(entry => entry.kind === kind).length]));
const expectedCandidateCounts = { parameters: 229, formulas: 38, effects: 19, processes: 0, internalStates: 0, triggerRules: 0 };
check('候选计数229/38/19', equal(candidateCounts, expectedCandidateCounts), candidateCounts);

function validateExpression(node, skillKey, formulaKey, at = '$', parameterKeys = new Set()) {
  if (!node || typeof node !== 'object') { check(`公式节点/${skillKey}/${formulaKey}${at}`, false, node); return; }
  check(`公式节点类型/${skillKey}/${formulaKey}${at}`, allowedNodeTypes.has(node.nodeType), node.nodeType);
  if (node.nodeType === 'PARAMETER') check(`公式参数存在/${skillKey}/${formulaKey}${at}`, parameterKeys.has(node.parameterKey), node.parameterKey);
  if (node.nodeType === 'ATTRIBUTE') {
    check(`公式属性归属/${skillKey}/${formulaKey}${at}`, ['SOURCE', 'TARGET'].includes(node.attributeOwner), node.attributeOwner);
    check(`公式属性类别/${skillKey}/${formulaKey}${at}`, ['TOTAL', 'BASE', 'BONUS'].includes(node.attributeValueKind), node.attributeValueKind);
  }
  if (node.nodeType === 'OPERATION') {
    check(`公式二元运算/${skillKey}/${formulaKey}${at}`, allowedOperations.has(node.operation) && Array.isArray(node.operands) && node.operands.length === 2, node);
    for (const [index, child] of (node.operands ?? []).entries()) validateExpression(child, skillKey, formulaKey, `${at}.operands[${index}]`, parameterKeys);
  }
}
function walkAny(value, callback, at = '$') {
  if (!value || typeof value !== 'object') return;
  callback(value, at);
  for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') walkAny(child, callback, `${at}.${key}`);
}
for (const skillKey of skills) {
  const skill = candidate.skills[skillKey];
  const parameterKeys = new Set((skill.write.parameters ?? []).map(item => item.parameterKey));
  for (const parameter of skill.write.parameters ?? []) {
    if (parameter.valueType !== 'INTEGER') continue;
    const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : [];
    check(`整数参数/${skillKey}/${parameter.parameterKey}`, parameter.valueMode === 'RUNTIME_INPUT' ? parameter.fixedValue === null && parameter.levelValues === null : values.every(value => Number.isInteger(Number(value))), { valueMode: parameter.valueMode, values });
    if (parameter.parameterKey.endsWith('_ms')) check(`毫秒非负/${skillKey}/${parameter.parameterKey}`, values.every(value => Number(value) >= 0), values);
  }
  for (const formula of skill.write.formulas ?? []) validateExpression(formula.expression, skillKey, formula.formulaKey, '$', parameterKeys);
  for (const effect of skill.write.effects ?? []) walkAny(effect, (node, at) => {
    if (node.resultType) check(`效果结果允许/${skillKey}/${effect.effectKey}${at}`, !['DAMAGE', 'DIRECT_HEAL'].includes(node.resultType), node.resultType);
    if (node.moment) check(`效果非瞬时求值/${skillKey}/${effect.effectKey}${at}`, node.moment !== 'MOMENT_EVALUATION', node.moment);
    if (node.valueMode) check(`效果不含运行输入/${skillKey}/${effect.effectKey}${at}`, node.valueMode !== 'RUNTIME_INPUT', node.valueMode);
    if (node.mode) check(`效果不含运行输入模式/${skillKey}/${effect.effectKey}${at}`, node.mode !== 'RUNTIME_INPUT', node.mode);
  });
}

const planEntries = [];
const planByKey = new Map();
for (const item of plan.requests ?? []) {
  const key = keyOf(item.skillKey, item.kind, item.stableKey);
  if (planByKey.has(key)) check(`计划键唯一/${key}`, false, '重复');
  planByKey.set(key, item);
  const candidateEntry = candidateByKey.get(key);
  check(`计划属于候选/${key}`, Boolean(candidateEntry) && item.method === 'POST' && item.route === candidateEntry.route && item.detailRoute === candidateEntry.detailRoute && equal(item.body, candidateEntry.body), { method: item.method, route: item.route });
  if (candidateEntry) check(`计划体散列/${key}`, item.bodySha256 === sha256(jsonBytes(item.body)), item.bodySha256);
  if (item.kind === 'parameters') check(`计划不重复公共参数/${key}`, !reuseSet.has(`${item.skillKey}/${item.stableKey}`), key);
  planEntries.push(item);
}
const newCounts = Object.fromEntries(kinds.map(([kind]) => [kind, planEntries.filter(item => item.kind === kind).length]));
check('复用清单29项', reuseSet.size === 29, reuseSet.size);
check('计划计数257', planEntries.length === 257 && equal(newCounts, { parameters: 200, formulas: 38, effects: 19, processes: 0, internalStates: 0, triggerRules: 0 }), { entries: planEntries.length, newCounts });
check('候选与计划新增组成一致', planEntries.length === allEntries.filter(entry => writableKinds.has(entry.kind) && !(entry.kind === 'parameters' && reuseSet.has(`${entry.skillKey}/${entry.id}`))).length, { plan: planEntries.length });

const baselineByKey = new Map();
for (const skillKey of skills) {
  const component = baseline.skills?.[skillKey]?.components;
  for (const [kind, field] of kinds) {
    const block = component?.[kind];
    const items = block?.items ?? rows(block?.list?.data);
    const details = block?.details ?? [];
    for (const item of items) {
      const id = item?.[field];
      const record = details.find(detail => detail.id === id || detail.item?.[field] === id);
      baselineByKey.set(keyOf(skillKey, kind, id), { list: item, detail: detailData(record) });
    }
  }
}
check('冻结现有详情29项', baselineByKey.size === 29, baselineByKey.size);
for (const key of baselineByKey.keys()) {
  const [skillKey, kind, id] = key.split('/');
  const allowedReuse = kind === 'parameters' && reuseSet.has(`${skillKey}/${id}`);
  check(`冻结组成保护或复用/${key}`, !candidateByKey.has(key) || allowedReuse, key);
}

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(here, '写入准备执行', runId);
const journalPath = path.join(runDir, 'HTTP流水.jsonl');
const calls = [];
const events = [];
const errors = [];
await fsp.mkdir(runDir, { recursive: true });
await fsp.writeFile(path.join(runDir, '运行锁.json'), JSON.stringify({ at: new Date().toISOString(), runId, mode: apply ? '受保护实际写入' : '只读预检', candidateSha256: sha256(candidateBytes), requestPlanSha256: sha256(planBytes), expectedPostCount: apply ? 257 : 0, apiWrites: 0, status: 'RUNNING' }, null, 2) + '\n', { flag: 'wx' });
const saveJson = async (name, value) => fsp.writeFile(path.join(runDir, name), jsonBytes(value));
const appendJsonl = async (file, value) => { const handle = await fsp.open(file, 'a'); try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); } };
const emit = async event => { const row = { at: new Date().toISOString(), ...event }; events.push(row); await appendJsonl(path.join(runDir, '逐项写入日志.jsonl'), row); };
const safeRoute = route => { if (typeof route !== 'string' || !route.startsWith('/') || route.includes('://') || route.includes('..')) throw Error(`非法API路径：${route}`); };
const request = async (method, route, body) => {
  safeRoute(route);
  if (method !== 'GET' && (!apply || method !== 'POST')) throw Error(`本器禁止该请求方法：${method}`);
  const sequence = calls.length + 1;
  await appendJsonl(journalPath, { sequence, phase: '请求前', at: new Date().toISOString(), method, route, ...(body === undefined ? {} : { body }) });
  const started = Date.now();
  let result;
  try {
    const response = await fetch(apiBase + route, { method, headers: { Authorization: `Bearer ${process.env.HERO24_API_TOKEN ?? 'local-entry'}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    const raw = await response.text();
    let data = null; let parseError = false;
    try { data = raw ? JSON.parse(raw) : null; } catch { parseError = true; }
    result = { sequence, method, route, status: response.status, ok: response.ok && !parseError, data, ...(parseError ? { parseError: true, responseBytes: Buffer.byteLength(raw), responseSha256: sha256(raw) } : {}) };
  } catch (error) { result = { sequence, method, route, status: null, ok: false, data: null, error: `${error.name}: ${error.message}` }; }
  calls.push(result);
  await appendJsonl(journalPath, { ...result, phase: '请求后', at: new Date().toISOString(), elapsedMs: Date.now() - started });
  return result;
};
const mustGet = async route => { const result = await request('GET', route); if (!result.ok) throw Error(`GET失败：${route} status=${result.status ?? 'network'}${result.error ? ` ${result.error}` : ''}`); return result; };
const optionalGet = async route => { const result = await request('GET', route); if (result.status !== 404 && !result.ok) throw Error(`缺项GET异常：${route} status=${result.status ?? 'network'}${result.error ? ` ${result.error}` : ''}`); return result; };

const fetchProtection = async () => {
  const protection = { catalogs: {}, subjects: {} };
  for (const [name] of catalogKinds) protection.catalogs[name] = await mustGet(`/${name}`);
  for (const skillKey of skills) protection.subjects[skillKey] = await mustGet(`/skills/${encodeURIComponent(skillKey)}`);
  return protection;
};
const protectionDiffs = protection => {
  const conflicts = [];
  for (const [name] of catalogKinds) { const difference = exactDiff(baseline.catalogs?.[name]?.data, protection.catalogs[name]?.data); if (difference) conflicts.push({ type: '目录漂移', name, diff: difference }); }
  for (const skillKey of skills) { const difference = exactDiff(baseline.skills?.[skillKey]?.subject?.data, protection.subjects[skillKey]?.data); if (difference) conflicts.push({ type: '技能主体漂移', skillKey, diff: difference }); }
  return conflicts;
};
const catalogReferences = protection => {
  const maps = Object.fromEntries(catalogKinds.map(([name, field]) => [field, new Map(rows(protection.catalogs[name]?.data).map(item => [item[field], item]))]));
  const references = []; const conflicts = [];
  const walk = (value, at) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${at}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (maps[key] && typeof child === 'string') { const row = maps[key].get(child); const ref = { at: `${at}.${key}`, key, value: child, status: row?.status ?? null, enabled: row?.status === 'ENABLED' }; references.push(ref); if (!ref.enabled) conflicts.push(ref); }
      walk(child, `${at}.${key}`);
    }
  };
  for (const entry of allEntries) walk(entry.body, keyOf(entry.skillKey, entry.kind, entry.id));
  return { references, conflicts };
};

const fetchComponents = async phase => {
  const lists = []; const details = []; const conflicts = []; const missing = []; const existing = []; const currentKeys = new Set();
  for (const skillKey of skills) for (const [kind, field, endpoint] of kinds) {
    const route = `/skills/${encodeURIComponent(skillKey)}/${endpoint}`;
    const response = await mustGet(route); const items = rows(response.data); const ids = items.map(item => item?.[field]);
    if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) conflicts.push({ phase, type: '列表键重复或非法', skillKey, kind, ids });
    lists.push({ skillKey, kind, route, status: response.status, items });
    const seen = new Set();
    for (const item of items) {
      const id = item[field]; const compound = keyOf(skillKey, kind, id); seen.add(compound); currentKeys.add(compound);
      const detailRoute = `${route}/${encodeURIComponent(id)}`; const detailResponse = await mustGet(detailRoute); const data = detailResponse.data;
      const summaryDifference = listSummaryDiff(item, data); if (summaryDifference) conflicts.push({ phase, type: '列表详情摘要不一致', skillKey, kind, id, diff: summaryDifference });
      const frozen = baselineByKey.get(compound); const candidateEntry = candidateByKey.get(compound);
      if (!frozen && !candidateEntry) conflicts.push({ phase, type: '发现计划外组成', skillKey, kind, id });
      if (frozen) {
        const listDifference = exactDiff(frozen.list, item); const detailDifference = exactDiff(frozen.detail, data);
        if (listDifference) conflicts.push({ phase, type: '冻结列表行漂移', skillKey, kind, id, diff: listDifference });
        if (detailDifference) conflicts.push({ phase, type: '冻结详情漂移', skillKey, kind, id, diff: detailDifference });
        if (candidateEntry?.kind === 'parameters') {
          for (const fieldName of ['valueType', 'valueMode', 'fixedValue', 'levelValues']) if (!equal(candidateEntry.body[fieldName], data?.[fieldName])) conflicts.push({ phase, type: '复用参数值漂移', skillKey, kind, id, field: fieldName, expected: candidateEntry.body[fieldName], actual: data?.[fieldName] });
        }
        existing.push({ skillKey, kind, id, classification: '冻结保护', data });
      } else if (candidateEntry) {
        const difference = businessDiff(candidateEntry.body, data);
        if (difference) conflicts.push({ phase, type: '候选已有异值', skillKey, kind, id, diff: difference });
        existing.push({ skillKey, kind, id, classification: difference ? '已有异值' : '已有同值', data });
      }
      details.push({ skillKey, kind, id, route: detailRoute, status: detailResponse.status, listItem: item, data, listSummaryDiff: summaryDifference });
    }
    for (const [compound] of baselineByKey) if (compound.startsWith(`${skillKey}/${kind}/`) && !seen.has(compound)) conflicts.push({ phase, type: '冻结组成从列表消失', skillKey, kind, id: compound.slice(`${skillKey}/${kind}/`.length) });
    for (const entry of allEntries.filter(item => item.skillKey === skillKey && item.kind === kind)) if (!seen.has(keyOf(entry.skillKey, entry.kind, entry.id))) missing.push(entry);
  }
  return { phase, lists, details, conflicts, missing, existing, currentKeys, counts: { lists: lists.length, details: details.length, existing: existing.length, missing: missing.length }, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
};

const report = { at: new Date().toISOString(), runId, mode: apply ? '受保护实际写入' : '只读预检', apiBase, candidateSha256: sha256(candidateBytes), candidateVersionSha256: sha256(versionBytes), requestPlanSha256: sha256(planBytes), freezeSha256: sha256(freezeBytes), snapshotSha256: sha256(snapshotBytes), sourceVersion: 'client16.17/official16.17.1', expected: { heroes: 4, skills: 20, catalogs: 4, componentLists: 120, frozenDetails: 29, candidateCounts: expectedCandidateCounts, reusedParameters: 29, newByKind: { parameters: 200, formulas: 38, effects: 19 }, plannedPostCount: 257 }, staticChecks, staticFailures, apiWrites: 0, errors };
const saveReport = async () => { report.calls = { total: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}) }; report.apiWrites = calls.filter(item => item.method === 'POST').length; report.writeEvents = events.length; await saveJson('执行结果.json', report); };
const globalLockPath = path.join(here, '第二十四批实际写入锁.json');
let globalLock = null;
const acquireGlobalLock = async () => { try { globalLock = await fsp.open(globalLockPath, 'wx'); await globalLock.writeFile(JSON.stringify({ at: new Date().toISOString(), runId, status: 'RUNNING', candidateSha256: sha256(candidateBytes), requestPlanSha256: sha256(planBytes), expectedPostCount: 257, policy: '仅参数200、公式38、效果19；复用参数、主体、目录、其它组成永不更新。' }, null, 2) + '\n'); await globalLock.sync(); await globalLock.close(); globalLock = null; } catch (error) { if (error.code === 'EEXIST') throw Error('已有第二十四批实际写入锁，禁止并行或重放'); throw error; } };
const updateGlobalLock = async (status, extra = {}) => { if (!fs.existsSync(globalLockPath)) return; const value = JSON.parse(fs.readFileSync(globalLockPath, 'utf8')); fs.writeFileSync(globalLockPath, JSON.stringify({ ...value, status, ...extra, updatedAt: new Date().toISOString() }, null, 2) + '\n'); };
const intentDir = path.join(here, '写前POST意图');
const createIntent = async entry => {
  await fsp.mkdir(intentDir, { recursive: true });
  const file = path.join(intentDir, `${sha256(`${sha256(candidateBytes)}\n${entry.route}\n${entry.id}`)}.json`);
  try { const handle = await fsp.open(file, 'wx'); try { await handle.writeFile(JSON.stringify({ at: new Date().toISOString(), candidateSha256: sha256(candidateBytes), method: 'POST', route: entry.route, detailRoute: entry.detailRoute, skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, body: entry.body }, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); } return { file, existed: false }; }
  catch (error) { if (error.code === 'EEXIST') return { file, existed: true }; throw error; }
};

let preProtection = null; let preComponents = null; let preCatalog = null; let allConflicts = [];
try {
  if (staticFailures.length) throw Error(`静态冻结校验失败${staticFailures.length}项`);
  await appendJsonl(journalPath, { sequence: 0, phase: '运行开始', at: new Date().toISOString(), method: 'NONE', route: null, mode: report.mode });
  preProtection = await fetchProtection();
  const protectionConflicts = protectionDiffs(preProtection);
  preCatalog = catalogReferences(preProtection);
  preComponents = await fetchComponents('写前');
  allConflicts = [...protectionConflicts, ...preCatalog.conflicts, ...preComponents.conflicts];
  if (preComponents.counts.lists !== 120) allConflicts.push({ type: '六类列表数量不符', actual: preComponents.counts.lists, expected: 120 });
  if (preComponents.existing.filter(item => item.classification === '冻结保护').length !== 29) allConflicts.push({ type: '冻结参数保护数量不符', actual: preComponents.existing.filter(item => item.classification === '冻结保护').length, expected: 29 });
  const candidateSame = preComponents.existing.filter(item => item.classification === '已有同值').length;
  const candidateDifferent = preComponents.existing.filter(item => item.classification === '已有异值').length;
  report.preflight = { pass: allConflicts.length === 0, protectionConflicts: protectionConflicts.length, catalogReferences: preCatalog.references.length, catalogConflicts: preCatalog.conflicts.length, componentCounts: preComponents.counts, conflicts: allConflicts.length, candidateAlreadySame: candidateSame, candidateAlreadyDifferent: candidateDifferent, candidateMissing: preComponents.missing.length, frozenDetails: preComponents.existing.filter(item => item.classification === '冻结保护').length, expectedNewByKind: { parameters: 200, formulas: 38, effects: 19 } };
  await saveJson('写前保护.json', preProtection);
  await saveJson('写前组成现值.json', { ...preComponents, protectionConflicts, catalogReferences: preCatalog.references, catalogConflicts: preCatalog.conflicts, allConflicts });
  await saveReport();
  if (allConflicts.length) throw Error(`写前保护、目录或组成冲突${allConflicts.length}项`);
  if (!apply) {
    report.success = true;
    report.next = '主负责人复核本报告后，如确认无漂移，设置 HERO24_APPLY_CONFIRM=CONFIRM_HERO24_COMPONENT_POSTS 并使用 --apply；当前未发送POST。';
  } else {
    await acquireGlobalLock();
    await emit({ phase: '写入锁已取得', expectedPostCount: 257, missingBefore: preComponents.missing.length });
    const initialExisting = new Map(preComponents.existing.map(item => [keyOf(item.skillKey, item.kind, item.id), item]));
    const applied = { startedAt: new Date().toISOString(), expected: 257, posted: 0, skippedSame: 0, confirmed: 0, stopped: false, stopReason: null };
    for (const requestEntry of planEntries) {
      const entry = candidateByKey.get(keyOf(requestEntry.skillKey, requestEntry.kind, requestEntry.stableKey));
      if (!entry) throw Error(`计划项无法定位候选：${keyOf(requestEntry.skillKey, requestEntry.kind, requestEntry.stableKey)}`);
      const initial = initialExisting.get(keyOf(entry.skillKey, entry.kind, entry.id));
      if (initial?.classification === '已有同值') { applied.skippedSame++; applied.confirmed++; await emit({ phase: '逐项确认', action: '已有同值跳过POST', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id }); continue; }
      const before = await optionalGet(entry.detailRoute);
      if (before.status === 200) {
        const difference = businessDiff(entry.body, before.data);
        if (difference) { applied.stopped = true; applied.stopReason = { phase: '逐项写前GET异值', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, diff: difference }; await emit({ ...applied.stopReason, action: '异值停止全部写入' }); break; }
        applied.skippedSame++; applied.confirmed++; await emit({ phase: '逐项确认', action: '逐项GET发现同值跳过POST', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id }); continue;
      }
      if (before.status !== 404) { applied.stopped = true; applied.stopReason = { phase: '逐项写前GET未知', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, status: before.status, error: before.error }; await emit({ ...applied.stopReason, action: '未知状态停止全部写入' }); break; }
      const intent = await createIntent(entry);
      if (intent.existed) { applied.stopped = true; applied.stopReason = { phase: '防重放', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, intentFile: intent.file }; await emit({ ...applied.stopReason, action: '已有持久化POST意图且目标仍缺失，停止' }); break; }
      await emit({ phase: '请求前', action: '准备POST', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, route: entry.route, detailRoute: entry.detailRoute, intentFile: intent.file, body: entry.body });
      const post = await request('POST', entry.route, entry.body); applied.posted++;
      const after = await optionalGet(entry.detailRoute);
      const difference = post.ok && after.status === 200 ? businessDiff(entry.body, after.data) : { path: '$', expected: 'POST成功且写后GET为200并同值', actual: { postStatus: post.status, postError: post.error, readbackStatus: after.status, readbackError: after.error } };
      const matched = !difference;
      await emit({ phase: '请求后', action: matched ? 'POST后逐条GET通过' : 'POST或逐条GET异常，停止全部写入', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, postStatus: post.status, postOk: post.ok, readbackStatus: after.status, matched, diff: difference, actual: after.data });
      if (!matched) { applied.stopped = true; applied.stopReason = { phase: 'POST后GET核对', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, postStatus: post.status, readbackStatus: after.status, diff: difference }; break; }
      applied.confirmed++;
    }
    applied.finishedAt = new Date().toISOString();
    report.apply = { ...applied, pass: !applied.stopped && applied.confirmed === 257 && applied.posted + applied.skippedSame === 257 };
    await saveJson('实际写入结果.json', applied);
    if (!report.apply.pass) throw Error('实际POST未完成257项逐项确认');
    const postProtection = await fetchProtection();
    const postProtectionDiffs = protectionDiffs(postProtection);
    const postComponents = await fetchComponents('写后');
    await saveJson('写后保护.json', postProtection);
    await saveJson('最终组成现值.json', { ...postComponents, protectionConflicts: postProtectionDiffs });
    const expectedDetails = 29 + 257;
    report.final = { componentCounts: postComponents.counts, expectedDetails, protectionConflicts: postProtectionDiffs.length, conflicts: postComponents.conflicts.length, missing: postComponents.missing.length, pass: postComponents.counts.lists === 120 && postComponents.counts.details === expectedDetails && postComponents.conflicts.length === 0 && postComponents.missing.length === 0 && postProtectionDiffs.length === 0 };
    if (!report.final.pass) throw Error('写后完整组成或主体目录保护回读未通过');
    await updateGlobalLock('COMPLETED', { posted: applied.posted, skippedSame: applied.skippedSame, confirmed: applied.confirmed, finalDetails: postComponents.counts.details });
    report.success = true;
  }
} catch (error) {
  errors.push({ name: error.name, message: error.message }); report.success = false; report.error = { name: error.name, message: error.message }; if (apply) await updateGlobalLock('ABORTED', { apiWrites: calls.filter(item => item.method === 'POST').length, error: error.message });
} finally {
  report.finishedAt = new Date().toISOString();
  report.apiWrites = calls.filter(item => item.method === 'POST').length;
  await saveReport();
  const lockPath = path.join(runDir, '运行锁.json');
  await fsp.writeFile(lockPath, JSON.stringify({ at: report.at, runId, mode: report.mode, candidateSha256: report.candidateSha256, requestPlanSha256: report.requestPlanSha256, expectedPostCount: apply ? 257 : 0, apiWrites: report.apiWrites, status: report.success ? 'COMPLETED' : 'ABORTED', finishedAt: report.finishedAt }, null, 2) + '\n');
}
console.log(JSON.stringify({ success: report.success, mode: report.mode, runId, apiWrites: report.apiWrites, calls: report.calls, preflight: report.preflight ?? null, apply: report.apply ? { posted: report.apply.posted, skippedSame: report.apply.skippedSame, confirmed: report.apply.confirmed, stopped: report.apply.stopped, pass: report.apply.pass } : null, final: report.final ?? null, errors: report.errors, output: runDir }, null, 2));
if (!report.success) process.exitCode = 1;

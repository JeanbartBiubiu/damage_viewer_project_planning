import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual as equal} from 'node:util';
import {fileURLToPath} from 'node:url';

// 这是写入器完成后的第二轮只读核验。它只发送GET，重新获取保护对象、六类列表和219条详情，再启动独立数学子进程。
const herePath = path.dirname(fileURLToPath(import.meta.url));
const archivePath = path.join(herePath, '恢复交付');
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidatePath = path.join(archivePath, '最终候选.json');
const planPath = path.join(archivePath, '最终写前计划.json');
const originalPath = path.join(herePath, '写前现值.json');
const historicalMediaPath = path.join(archivePath, '关联与图片保护快照.json');
const expectedCandidateSha256 = 'd5668bcda66786383f9bc0bbcf02464cee3dc7c34417f3bd244ecd0fdc0ecae1';
const expectedPlanSha256 = 'eefb4349d27c7ac42b3192eac33981551b5dfeebe2fbdb4957f1948feeed3991';
const expectedOriginalCandidateSha256 = 'a98792185a594829b214f1aaeb0ba1503cfa34d72ac1af9a88302b4d906e31c7';
const expectedOriginalSnapshotSha256 = '79142b374fba9a9b5f099dda33525788ca1071ea35bc668b5998721cabe8f834';
const expectedMediaSnapshotSha256 = '10d71c98f2a9106e0ddddd5e6dbc0a01da75d6cb2b7cb9603f40bd1d0daa1ee0';
const skills = ['viktor', 'orianna', 'syndra', 'taliyah'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const heroes = ['viktor', 'orianna', 'syndra', 'taliyah'];
const kinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
const catalogKinds = [['attributes', 'attributeKey'], ['modifier-zones', 'modifierZoneKey'], ['damage-types', 'damageTypeKey'], ['statuses', 'statusKey']];
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
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
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return {path: at, expected, actual};
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return {path: at, expected, actual};
    for (let index = 0; index < expected.length; index++) { const child = diff(expected[index], actual[index], `${at}[${index}]`); if (child) return child; }
    return null;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    if (!(key in expected) || !(key in actual)) return {path: `${at}.${key}`, expected: expected[key], actual: actual[key]};
    const child = diff(expected[key], actual[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
};
const businessDiff = (expected, actual) => diff(canonical(expected), canonical(actual));
const exactDiff = (expected, actual) => diff(exactCanonical(expected), exactCanonical(actual));
const rows = response => Array.isArray(response?.data) ? response.data : Array.isArray(response?.data?.items) ? response.data.items : [];
const args = process.argv.slice(2);
if (args.length) throw Error('独立全量回读器不接受参数；它只执行第二轮GET');

const candidateBytes = fs.readFileSync(candidatePath);
const planBytes = fs.readFileSync(planPath);
if (sha256(candidateBytes) !== expectedCandidateSha256) throw Error('独立回读前最终候选散列变化');
if (sha256(planBytes) !== expectedPlanSha256) throw Error('独立回读前最终计划散列变化');
if (sha256(fs.readFileSync(path.join(herePath, '完整候选.json'))) !== expectedOriginalCandidateSha256) throw Error('独立回读前原始候选散列变化');
if (sha256(fs.readFileSync(originalPath)) !== expectedOriginalSnapshotSha256) throw Error('独立回读前写前现值散列变化');
const candidate = JSON.parse(candidateBytes);
const plan = JSON.parse(planBytes);
const original = readJson(originalPath);
const historicalMedia = readJson(historicalMediaPath);
if (historicalMedia.snapshotSha256 !== expectedMediaSnapshotSha256 || historicalMedia.summary?.requests !== 28 || historicalMedia.summary?.apiWrites !== 0) throw Error('独立回读前关联图片保护快照散列不符');
if (plan.requests?.length !== 191 || plan.reuseObjects?.length !== 28) throw Error('独立回读前精确计划计数不符');
const expectedEntries = [];
for (const skillKey of skills) for (const [kind, idField] of kinds) for (const body of candidate.skills?.[skillKey]?.write?.[kind] ?? []) expectedEntries.push({skillKey, kind, id: body[idField], body});
if (expectedEntries.length !== 219) throw Error(`独立回读前候选组件计数不符：${expectedEntries.length}`);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(herePath, '独立回读', runId);
await fsp.mkdir(runDir, {recursive: true});
const runLockPath = path.join(runDir, '运行锁.json');
const lock = await fsp.open(runLockPath, 'wx');
try {
  await lock.writeFile(JSON.stringify({at: new Date().toISOString(), runId, mode: '独立第二轮全量GET', candidateSha256: expectedCandidateSha256, planSha256: expectedPlanSha256, apiWrites: 0}, null, 2) + '\n');
  await lock.sync();
} finally { await lock.close(); }
const journalPath = path.join(runDir, 'HTTP流水.jsonl');
const calls = [];
const failures = [];
const check = (name, passed, details = null) => { if (!passed) failures.push({name, details}); };
const appendJsonl = async value => {
  const handle = await fsp.open(journalPath, 'a');
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
};
const token = process.env.HERO15_API_TOKEN ?? 'local-entry';
const get = async route => {
  if (!route.startsWith('/') || route.includes('://') || route.includes('..')) throw Error(`非法GET路径：${route}`);
  const sequence = calls.length + 1;
  await appendJsonl({sequence, phase: '请求前', at: new Date().toISOString(), method: 'GET', route});
  const started = Date.now();
  let result;
  try {
    const response = await fetch(apiBase + route, {method: 'GET', headers: {Authorization: `Bearer ${token}`, Accept: 'application/json'}, signal: AbortSignal.timeout(30000)});
    const raw = await response.text();
    let data = null;
    let parseError = false;
    try { data = raw ? JSON.parse(raw) : null; } catch { parseError = true; }
    result = {route, method: 'GET', status: response.status, ok: response.ok && !parseError, data, ...(parseError ? {parseError: true, responseBytes: Buffer.byteLength(raw), responseSha256: sha256(raw)} : {})};
  } catch (error) {
    result = {route, method: 'GET', status: null, ok: false, data: null, error: `${error.name}: ${error.message}`};
  }
  const completed = {sequence, phase: '请求后', at: new Date().toISOString(), method: 'GET', route, elapsedMs: Date.now() - started, status: result.status, ok: result.ok, ...(result.error ? {error: result.error} : {}), ...(result.parseError ? {parseError: true, responseBytes: result.responseBytes, responseSha256: result.responseSha256} : {})};
  await appendJsonl(completed);
  calls.push({...result, elapsedMs: completed.elapsedMs});
  if (!result.ok) failures.push({name: `GET失败 ${route}`, details: {status: result.status, error: result.error, parseError: result.parseError}});
  return result;
};

const protection = {catalogs: {}, relations: {}, subjects: {}, images: {}, characters: {}};
for (const [name] of catalogKinds) protection.catalogs[name] = await get(`/${name}`);
for (const hero of heroes) {
  protection.characters[hero] = await get(`/characters/champion_${hero}`);
  protection.relations[hero] = await get(`/character-skill-relations?characterKey=champion_${hero}`);
}
for (const skillKey of skills) {
  protection.subjects[skillKey] = await get(`/skills/${skillKey}`);
  protection.images[skillKey] = await get(`/skills/${skillKey}/representative-image`);
}

const detailByKey = new Map();
const lists = [];
const details = [];
for (const skillKey of skills) for (const [kind, idField, apiKind] of kinds) {
  const route = `/skills/${skillKey}/${apiKind}`;
  const response = await get(route);
  const items = rows(response);
  lists.push({skillKey, kind, route, status: response.status, items});
  const ids = items.map(item => item[idField]);
  check(`列表键唯一 ${skillKey}/${kind}`, ids.every(id => typeof id === 'string') && new Set(ids).size === ids.length, {ids});
}
for (const entry of expectedEntries) {
  const route = `/skills/${entry.skillKey}/${kinds.find(item => item[0] === entry.kind)[2]}/${encodeURIComponent(entry.id)}`;
  const response = await get(route);
  const record = {skillKey: entry.skillKey, kind: entry.kind, id: entry.id, route, status: response.status, ok: response.ok, data: response.data, ...(response.error ? {error: response.error} : {})};
  details.push(record);
  detailByKey.set(`${entry.skillKey}/${entry.kind}/${entry.id}`, record);
}

const protectionConflicts = [];
for (const [name, idField] of catalogKinds) {
  const oldRows = rows(original.catalogs?.[name]);
  const freshRows = rows(protection.catalogs[name]);
  for (const oldRow of oldRows) {
    const current = freshRows.find(row => row[idField] === oldRow[idField]);
    const rowDiff = exactDiff(oldRow, current);
    if (rowDiff) protectionConflicts.push({type: 'catalog', name, key: oldRow[idField], diff: rowDiff});
  }
}
for (const skillKey of skills) {
  const oldSubject = original.skills?.[skillKey]?.subject?.data;
  const freshSubject = protection.subjects[skillKey]?.data;
  const subjectDiff = exactDiff(oldSubject, freshSubject);
  if (subjectDiff) protectionConflicts.push({type: 'subject', skillKey, diff: subjectDiff});
  if (freshSubject?.maxLevel !== candidate.skills[skillKey]?.maxLevel) protectionConflicts.push({type: 'subjectMaxLevel', skillKey, expected: candidate.skills[skillKey]?.maxLevel, actual: freshSubject?.maxLevel});
}
for (const historical of historicalMedia.requests ?? []) {
  let fresh;
  if (historical.route.startsWith('/characters/')) fresh = protection.characters[historical.route.split('champion_')[1]];
  else if (historical.route.startsWith('/character-skill-relations')) fresh = protection.relations[historical.route.split('champion_')[1]];
  else if (historical.route.startsWith('/skills/')) fresh = protection.images[historical.route.split('/')[2]];
  if (!fresh?.ok || exactDiff(historical.data, fresh.data)) protectionConflicts.push({type: 'historicalProtection', route: historical.route, diff: exactDiff(historical.data, fresh?.data)});
}
check('保护对象与写前/历史快照全字段一致', protectionConflicts.length === 0, protectionConflicts);

const expectedBySkillKind = new Map();
for (const entry of expectedEntries) expectedBySkillKind.set(`${entry.skillKey}/${entry.kind}`, (expectedBySkillKind.get(`${entry.skillKey}/${entry.kind}`) ?? []).concat(entry));
const listConflicts = [];
const listSummaryDiff = (item, detail) => {
  for (const [key, expected] of Object.entries(item ?? {})) {
    const actual = key === 'resultCount'
      ? Array.isArray(detail?.results) ? detail.results.length : undefined
      : key === 'lifecycleEnabled'
        ? detail?.lifecycle !== null && detail?.lifecycle !== undefined
        : detail?.[key];
    const rowDiff = businessDiff(expected, actual);
    if (rowDiff) return {path: key, expected, actual, detail: rowDiff};
  }
  return null;
};
for (const list of lists) {
  const idField = kinds.find(item => item[0] === list.kind)[1];
  const expected = expectedBySkillKind.get(`${list.skillKey}/${list.kind}`) ?? [];
  const expectedIds = new Set(expected.map(entry => entry.id));
  const actualIds = new Set(list.items.map(item => item[idField]));
  if (actualIds.size !== expectedIds.size || [...actualIds].some(id => !expectedIds.has(id))) listConflicts.push({skillKey: list.skillKey, kind: list.kind, expected: [...expectedIds], actual: [...actualIds]});
  for (const item of list.items) {
    const key = `${list.skillKey}/${list.kind}/${item[idField]}`;
    const detail = detailByKey.get(key);
    const expectedEntry = expected.find(entry => entry.id === item[idField]);
    if (!expectedEntry || !detail) { listConflicts.push({skillKey: list.skillKey, kind: list.kind, id: item[idField], type: 'unexpectedListItem'}); continue; }
    const summaryDiff = listSummaryDiff(item, detail.data);
    if (summaryDiff) listConflicts.push({skillKey: list.skillKey, kind: list.kind, id: item[idField], type: 'listDetailDiff', diff: summaryDiff});
  }
}
check('120个列表与详情全字段对应', listConflicts.length === 0, listConflicts);

const componentConflicts = [];
for (const entry of expectedEntries) {
  const key = `${entry.skillKey}/${entry.kind}/${entry.id}`;
  const actual = detailByKey.get(key);
  if (!actual?.ok || actual.status !== 200) { componentConflicts.push({key, type: 'missingOrFailedDetail', status: actual?.status ?? null}); continue; }
  const objectDiff = businessDiff(entry.body, actual.data);
  if (objectDiff) componentConflicts.push({key, type: 'businessFieldDiff', diff: objectDiff});
}
check('219个组件详情全字段对应最终候选', componentConflicts.length === 0, componentConflicts);
check('第二轮没有多余组件详情', detailByKey.size === 219 && details.length === 219, {details: details.length, unique: detailByKey.size});
const catalogReferences = [];
const catalogSets = Object.fromEntries(catalogKinds.map(([name, key]) => [key, new Set(rows(protection.catalogs[name]).map(row => row[key]))]));
const walk = (value, at = '$') => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (catalogSets[key] && typeof child === 'string') catalogReferences.push({at: `${at}.${key}`, key, value: child, present: catalogSets[key].has(child)});
    if (child && typeof child === 'object') walk(child, `${at}.${key}`);
  }
};
for (const entry of expectedEntries) walk(entry.body, `${entry.skillKey}/${entry.kind}/${entry.id}`);
for (const required of [{key: 'attributeKey', value: 'mana'}, {key: 'attributeKey', value: 'move_speed_percent'}, {key: 'modifierZoneKey', value: 'attribute_flat_add'}]) check(`目录存在 ${required.key}=${required.value}`, catalogReferences.some(item => item.key === required.key && item.value === required.value && item.present), required);
for (const reference of catalogReferences) if (!reference.present) failures.push({name: '候选目录引用缺失', details: reference});

const componentSnapshot = {
  phase: '写后',
  startedAt: new Date().toISOString(),
  subjects: protection.subjects,
  lists,
  details,
  skills: {},
  missing: componentConflicts.filter(item => item.type === 'missingOrFailedDetail').map(item => ({skillKey: item.key.split('/')[0], kind: item.key.split('/')[1], id: item.key.split('/').slice(2).join('/')})),
  conflicts: [...listConflicts, ...componentConflicts],
  existing: [],
  counts: {lists: lists.length, details: details.length, existing: details.filter(record => record.status === 200).length, missing: componentConflicts.filter(item => item.type === 'missingOrFailedDetail').length},
  finishedAt: new Date().toISOString(),
  protectionConflicts,
  catalogReferences,
};
for (const skillKey of skills) componentSnapshot.skills[skillKey] = {components: {}};
for (const list of lists) componentSnapshot.skills[list.skillKey].components[list.kind] = {list, items: list.items, details: details.filter(record => record.skillKey === list.skillKey && record.kind === list.kind), missing: []};
await fsp.writeFile(path.join(runDir, '写后保护.json'), JSON.stringify(protection, null, 2) + '\n');
await fsp.writeFile(path.join(runDir, '最终全量组件现值.json'), JSON.stringify(componentSnapshot, null, 2) + '\n');

const statusCounts = calls.reduce((out, call) => { out[String(call.status)] = (out[String(call.status)] ?? 0) + 1; return out; }, {});
const methodCounts = calls.reduce((out, call) => { out[call.method] = (out[call.method] ?? 0) + 1; return out; }, {});
const expectedRequestCount = 4 + 20 + 4 + 4 + 20 + 120 + 219;
check('独立第二轮GET请求总数', calls.length === expectedRequestCount, {actual: calls.length, expected: expectedRequestCount});
check('独立第二轮没有写请求', methodCounts.GET === calls.length && !methodCounts.POST && !methodCounts.PUT && !methodCounts.DELETE, methodCounts);
const execution = {
  startedAt: runId,
  runId,
  mode: '第二轮独立全量GET；不发送业务写入',
  apiBase,
  candidateFileSha256: expectedCandidateSha256,
  planSha256: expectedPlanSha256,
  originalSnapshotSha256: expectedOriginalSnapshotSha256,
  apiWrites: 0,
  expected: {catalogs: 4, subjects: 20, characters: 4, relations: 4, images: 20, lists: 120, componentDetails: 219, totalRequests: expectedRequestCount},
  actual: {calls: calls.length, methods: methodCounts, statuses: statusCounts, protectionConflicts: protectionConflicts.length, listConflicts: listConflicts.length, componentConflicts: componentConflicts.length, catalogReferences: catalogReferences.length},
  failures,
  success: failures.length === 0,
};
await fsp.writeFile(path.join(runDir, '执行结果.json'), JSON.stringify(execution, null, 2) + '\n');
const mathChild = spawnSync(process.execPath, [path.join(herePath, '实际读后数学核算.mjs'), '--run-dir', runDir], {encoding: 'utf8', windowsHide: true, timeout: 120000});
let math = null;
const mathPath = path.join(runDir, '实际读后数学核算.json');
if (fs.existsSync(mathPath)) math = readJson(mathPath);
if (mathChild.status !== 0 || !math || math.status !== 'READY_FOR_INDEPENDENT_REVIEW') failures.push({name: '独立实际参数公式数学核算未通过', details: {childStatus: mathChild.status, childOutput: (mathChild.stdout ?? '').trim(), childError: (mathChild.stderr ?? '').trim(), mathStatus: math?.status ?? null}});
execution.independentMath = {status: math?.status ?? null, checks: math?.checks ?? null, failedChecks: math?.failedChecks ?? null, formulaChecks: math?.formulas?.checks?.length ?? null, inputRejections: math?.formulas?.inputRejections?.length ?? null, resultPath: mathPath};
execution.failures = failures;
execution.success = failures.length === 0;
execution.finishedAt = new Date().toISOString();
await fsp.writeFile(path.join(runDir, '执行结果.json'), JSON.stringify(execution, null, 2) + '\n');
console.log(JSON.stringify({status: execution.success ? 'READY_FOR_INDEPENDENT_REVIEW' : 'REVISE', runId, calls: calls.length, expectedRequestCount, methods: methodCounts, statuses: statusCounts, protectionConflicts: protectionConflicts.length, listConflicts: listConflicts.length, componentConflicts: componentConflicts.length, formulaChecks: math?.formulas?.checks?.length ?? 0, mathStatus: math?.status ?? null, output: runDir}));
if (!execution.success) process.exitCode = 1;

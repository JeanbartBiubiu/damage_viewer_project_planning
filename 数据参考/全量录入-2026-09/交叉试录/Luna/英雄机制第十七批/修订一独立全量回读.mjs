import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 第十七批独立第二轮回读。它只发送全新的GET，不读取受保护录入器的运行目录或其组件快照作结论依据。
// 执行时重新取得4个共享目录、4个角色、4个关系、20个技能主体、20张图片、120个列表及列表中全部详情。
const herePath = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidateFile = '修订一候选.json';
const planFile = '修订一写前计划.json';
const freezeFile = '修订一冻结候选锁.json';
const oldReadOnlyFile = '只读保护与公共参数.json';
const fullProtectionFile = '修订一写前完整保护.json';
const heroes = ['vladimir', 'swain', 'rumble', 'aurelionsol'];
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
const expected = {
  candidateSha256: '76ff9761638e3f10d147f662204bbb94656f10ee0edafbc39dcd97d8d37babd7',
  planFileSha256: '7b1b6a62bafaefb8b0d78272300ec281beed0baa5397be902b7685a687254718',
  freezeSha256: 'baee05b688db36f42cfce7fd8e2376e5e93c64888b0ecebc96cfa9752fbec258',
  oldReadOnlySha256: 'ba50c2f11595df9c64d95345b4af156f9e468656b3bcdb8634558048bad8b62c',
  fullProtectionSha256: 'cff6dd7a97ed589f57fcee22052814496dcab6f1f5492bf7e18626d379a2d457',
  totalComponents: 285,
  lists: 120,
};
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const readBytes = name => fs.readFileSync(path.join(herePath, name));
const readJson = name => JSON.parse(readBytes(name));
const rows = response => Array.isArray(response?.data) ? response.data : Array.isArray(response?.data?.items) ? response.data.items : [];
const idField = kind => kinds.find(item => item[0] === kind)?.[1];
const apiKind = kind => kinds.find(item => item[0] === kind)?.[2];
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
const diff = (left, right, at = '$') => {
  if (equal(left, right)) return null;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return { path: at, expected: left, actual: right };
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return { path: at, expected: left, actual: right };
    for (let index = 0; index < left.length; index++) {
      const child = diff(left[index], right[index], `${at}[${index}]`);
      if (child) return child;
    }
    return null;
  }
  for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    if (!(key in left) || !(key in right)) return { path: `${at}.${key}`, expected: left[key], actual: right[key] };
    const child = diff(left[key], right[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
};
const businessDiff = (left, right) => diff(canonical(left), canonical(right));
const exactDiff = (left, right) => diff(exactCanonical(left), exactCanonical(right));
const listSummaryDiff = (item, detail) => {
  if (!item || !detail) return { path: '$', expected: 'detail', actual: detail };
  for (const [key, expectedValue] of Object.entries(item)) {
    const actualValue = key === 'resultCount'
      ? Array.isArray(detail.results) ? detail.results.length : undefined
      : key === 'lifecycleEnabled'
        ? detail.lifecycle !== null && detail.lifecycle !== undefined
        : detail[key];
    if (!equal(expectedValue, actualValue)) return { path: key, expected: expectedValue, actual: actualValue };
  }
  return null;
};

const candidateBytes = readBytes(candidateFile);
const planBytes = readBytes(planFile);
const freezeBytes = readBytes(freezeFile);
const oldReadOnlyBytes = readBytes(oldReadOnlyFile);
const fullProtectionBytes = readBytes(fullProtectionFile);
const candidate = JSON.parse(candidateBytes);
const plan = JSON.parse(planBytes);
const freeze = JSON.parse(freezeBytes);
const oldReadOnly = JSON.parse(oldReadOnlyBytes);
const baseline = JSON.parse(fullProtectionBytes);
const checks = [];
const failures = [];
const check = (name, passed, detail = null) => {
  const row = { name, passed: Boolean(passed), detail };
  checks.push(row);
  if (!row.passed) failures.push(row);
  return row.passed;
};
check('候选散列冻结', sha256(candidateBytes) === expected.candidateSha256, sha256(candidateBytes));
check('计划散列冻结', sha256(planBytes) === expected.planFileSha256, sha256(planBytes));
check('冻结锁散列冻结', sha256(freezeBytes) === expected.freezeSha256, sha256(freezeBytes));
check('旧只读散列冻结', sha256(oldReadOnlyBytes) === expected.oldReadOnlySha256, sha256(oldReadOnlyBytes));
check('写前完整保护基线散列冻结', sha256(fullProtectionBytes) === expected.fullProtectionSha256, sha256(fullProtectionBytes));
check('独立回读只读策略', candidate.meta?.apiWrites === 0 && freeze.api?.businessWrites === 0 && freeze.api?.apiCalls === 0, { candidateApiWrites: candidate.meta?.apiWrites, freezeApi: freeze.api });
check('候选技能位恰为20项', equal(Object.keys(candidate.skills ?? {}), skills), Object.keys(candidate.skills ?? {}));
const candidateEntries = [];
for (const skillKey of skills) for (const [kind, key] of kinds) for (const body of candidate.skills?.[skillKey]?.write?.[kind] ?? []) candidateEntries.push({ skillKey, kind, id: body[key], route: `/skills/${skillKey}/${apiKind(kind)}/${encodeURIComponent(body[key])}`, body });
const candidateById = new Map(candidateEntries.map(entry => [keyOf(entry.skillKey, entry.kind, entry.id), entry]));
check('候选组成总数恰为285', candidateEntries.length === expected.totalComponents, candidateEntries.length);
check('计划请求恰为263条', plan.requestCount === 263 && plan.requests?.length === 263 && plan.requests.every(item => item.method === 'POST'), { requestCount: plan.requestCount, requests: plan.requests?.length });

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(herePath, '独立回读', runId);
await fsp.mkdir(runDir, { recursive: true });
const journalPath = path.join(runDir, 'HTTP流水.jsonl');
const calls = [];
const appendJsonl = async value => {
  const handle = await fsp.open(journalPath, 'a');
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
};
const saveJson = async (name, value) => fsp.writeFile(path.join(runDir, name), JSON.stringify(value, null, 2) + '\n');
const get = async route => {
  if (!route.startsWith('/') || route.includes('://') || route.includes('..')) throw Error(`非法GET路径 ${route}`);
  const sequence = calls.length + 1;
  const startedAt = new Date().toISOString();
  await appendJsonl({ sequence, phase: '请求前', at: startedAt, method: 'GET', route });
  const started = Date.now();
  let result;
  try {
    const response = await fetch(apiBase + route, { method: 'GET', headers: { Authorization: `Bearer ${process.env.HERO17_API_TOKEN ?? 'local-entry'}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const raw = await response.text();
    let data = null;
    let parseError = false;
    try { data = raw ? JSON.parse(raw) : null; } catch { parseError = true; }
    result = { route, method: 'GET', status: response.status, ok: response.ok && !parseError, data, ...(parseError ? { parseError: true, responseBytes: Buffer.byteLength(raw), responseSha256: sha256(raw) } : {}) };
  } catch (error) {
    result = { route, method: 'GET', status: null, ok: false, data: null, error: `${error.name}: ${error.message}` };
  }
  const completed = { sequence, phase: '请求后', at: new Date().toISOString(), method: 'GET', route, elapsedMs: Date.now() - started, status: result.status, ok: result.ok, ...(result.error ? { error: result.error } : {}), ...(result.parseError ? { parseError: true, responseBytes: result.responseBytes, responseSha256: result.responseSha256 } : {}), data: result.data };
  await appendJsonl(completed);
  calls.push({ ...result, elapsedMs: completed.elapsedMs });
  if (!result.ok) throw Error(`GET失败即停 ${route} status=${result.status ?? 'network'}${result.error ? ` ${result.error}` : ''}`);
  return result;
};

const protection = { catalogs: {}, characters: {}, relations: {}, subjects: {}, images: {} };
const lists = [];
const details = [];
const protectionConflicts = [];
const listConflicts = [];
const componentConflicts = [];
const catalogReferences = [];
const oldRouteData = new Map((oldReadOnly.requests ?? []).map(item => [item.route, item.data]));
const baselineProtection = baseline.protection ?? {};
try {
  if (failures.length) throw Error(`静态冻结校验失败 ${failures.length}项`);
  for (const [name] of catalogKinds) protection.catalogs[name] = await get(`/${name}`);
  for (const hero of heroes) {
    const characterKey = `champion_${hero}`;
    protection.characters[hero] = await get(`/characters/${characterKey}`);
    protection.relations[hero] = await get(`/character-skill-relations?characterKey=${encodeURIComponent(characterKey)}`);
  }
  for (const skillKey of skills) {
    protection.subjects[skillKey] = await get(`/skills/${skillKey}`);
    protection.images[skillKey] = await get(`/skills/${skillKey}/representative-image`);
  }
  await saveJson('独立保护.json', protection);
  for (const [name] of catalogKinds) {
    const old = oldRouteData.get(`/${name}`);
    if (old && exactDiff(old, protection.catalogs[name]?.data)) protectionConflicts.push({ type: 'catalog', name, diff: exactDiff(old, protection.catalogs[name]?.data) });
    const baselineData = baselineProtection.catalogs?.[name]?.data;
    if (baselineData && exactDiff(baselineData, protection.catalogs[name]?.data)) protectionConflicts.push({ type: 'catalogBaseline', name, diff: exactDiff(baselineData, protection.catalogs[name]?.data) });
  }
  for (const hero of heroes) {
    const characterRoute = `/characters/champion_${hero}`;
    const relationRoute = `/character-skill-relations?characterKey=champion_${hero}`;
    const characterData = protection.characters[hero]?.data;
    const relationData = protection.relations[hero]?.data;
    if (exactDiff(oldRouteData.get(characterRoute), characterData)) protectionConflicts.push({ type: 'character', hero, diff: exactDiff(oldRouteData.get(characterRoute), characterData) });
    if (exactDiff(oldRouteData.get(relationRoute), relationData)) protectionConflicts.push({ type: 'relation', hero, diff: exactDiff(oldRouteData.get(relationRoute), relationData) });
    if (exactDiff(baselineProtection.characters?.[hero]?.data, characterData)) protectionConflicts.push({ type: 'characterBaseline', hero, diff: exactDiff(baselineProtection.characters?.[hero]?.data, characterData) });
    if (exactDiff(baselineProtection.relations?.[hero]?.data, relationData)) protectionConflicts.push({ type: 'relationBaseline', hero, diff: exactDiff(baselineProtection.relations?.[hero]?.data, relationData) });
  }
  for (const skillKey of skills) {
    const imageRoute = `/skills/${skillKey}/representative-image`;
    const imageData = protection.images[skillKey]?.data;
    if (exactDiff(oldRouteData.get(imageRoute), imageData)) protectionConflicts.push({ type: 'image', skillKey, diff: exactDiff(oldRouteData.get(imageRoute), imageData) });
    if (exactDiff(baselineProtection.images?.[skillKey]?.data, imageData)) protectionConflicts.push({ type: 'imageBaseline', skillKey, diff: exactDiff(baselineProtection.images?.[skillKey]?.data, imageData) });
    if (exactDiff(baselineProtection.subjects?.[skillKey]?.data, protection.subjects[skillKey]?.data)) protectionConflicts.push({ type: 'subject', skillKey, diff: exactDiff(baselineProtection.subjects?.[skillKey]?.data, protection.subjects[skillKey]?.data) });
    if (protection.subjects[skillKey]?.data?.maxLevel !== candidate.skills[skillKey]?.maxLevel) protectionConflicts.push({ type: 'subjectMaxLevel', skillKey, expected: candidate.skills[skillKey]?.maxLevel, actual: protection.subjects[skillKey]?.data?.maxLevel });
  }

  const expectedIdsByList = new Map();
  for (const entry of candidateEntries) {
    const listKey = `${entry.skillKey}/${entry.kind}`;
    expectedIdsByList.set(listKey, [...(expectedIdsByList.get(listKey) ?? []), entry.id]);
  }
  for (const skillKey of skills) for (const [kind, key, endpointKind] of kinds) {
    const route = `/skills/${skillKey}/${endpointKind}`;
    const response = await get(route);
    const items = rows(response);
    const ids = items.map(item => item[key]);
    const listRecord = { skillKey, kind, route, status: response.status, items };
    lists.push(listRecord);
    if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) listConflicts.push({ type: 'duplicateOrInvalidKey', skillKey, kind, ids });
    const expectedIds = new Set(expectedIdsByList.get(`${skillKey}/${kind}`) ?? []);
    if (ids.length !== expectedIds.size || ids.some(id => !expectedIds.has(id))) listConflicts.push({ type: 'listIdsDiffer', skillKey, kind, expected: [...expectedIds], actual: ids });
    for (const item of items) {
      const id = item[key];
      const detailRoute = `${route}/${encodeURIComponent(id)}`;
      const responseDetail = await get(detailRoute);
      const record = { skillKey, kind, id, route: detailRoute, status: responseDetail.status, data: responseDetail.data, listItem: item, listSummaryDiff: listSummaryDiff(item, responseDetail.data) };
      details.push(record);
      if (record.listSummaryDiff) listConflicts.push({ type: 'listDetailMismatch', skillKey, kind, id, diff: record.listSummaryDiff });
      const entry = candidateById.get(keyOf(skillKey, kind, id));
      if (!entry) componentConflicts.push({ type: 'unexpectedExisting', skillKey, kind, id });
      if (entry) {
        const difference = businessDiff(entry.body, responseDetail.data);
        if (difference) componentConflicts.push({ type: 'candidateDetailMismatch', skillKey, kind, id, diff: difference });
      }
    }
  }
  const catalogSets = Object.fromEntries(catalogKinds.map(([name, key]) => [key, new Map(rows(protection.catalogs[name]).map(item => [item[key], item]))]));
  const walk = (value, at) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${at}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (catalogSets[key] && typeof child === 'string') {
        const item = catalogSets[key].get(child);
        const reference = { at: `${at}.${key}`, key, value: child, enabled: item?.status === 'ENABLED' };
        catalogReferences.push(reference);
        if (!reference.enabled) componentConflicts.push({ type: 'catalogReferenceMissing', ...reference });
      }
      walk(child, `${at}.${key}`);
    }
  };
  for (const entry of candidateEntries) walk(entry.body, keyOf(entry.skillKey, entry.kind, entry.id));
  const actualByKey = new Map(details.map(record => [keyOf(record.skillKey, record.kind, record.id), record]));
  check('独立详情数量恰为285', details.length === expected.totalComponents && actualByKey.size === expected.totalComponents, { details: details.length, unique: actualByKey.size });
  check('独立列表数量恰为120', lists.length === expected.lists, lists.length);
  check('独立详情完整对应候选', componentConflicts.length === 0 && candidateEntries.every(entry => actualByKey.has(keyOf(entry.skillKey, entry.kind, entry.id))), { candidate: candidateEntries.length, actual: actualByKey.size, conflicts: componentConflicts.length });
  check('保护对象无漂移', protectionConflicts.length === 0, protectionConflicts);
  check('列表和详情无冲突', listConflicts.length === 0, listConflicts);
  const snapshot = { phase: '独立全量新GET', startedAt: new Date().toISOString(), protection, lists, details, counts: { catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, lists: lists.length, details: details.length }, protectionConflicts, listConflicts, componentConflicts, catalogReferences, finishedAt: new Date().toISOString() };
  await saveJson('独立全量组件现值.json', snapshot);
  const execution = {
    at: new Date().toISOString(),
    status: failures.length === 0 ? 'READY_FOR_POST_WRITE_MATH' : 'REVISE',
    mode: '独立第二轮全量GET；不读取受保护录入器运行目录，不发送业务写入',
    apiBase,
    candidateSha256: expected.candidateSha256,
    planFileSha256: expected.planFileSha256,
    source: 'client16.17/official16.17.1',
    apiWrites: 0,
    businessWrites: 0,
    expected: { catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, lists: 120, candidateDetails: 285 },
    actual: { calls: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}), lists: lists.length, details: details.length, protectionConflicts: protectionConflicts.length, listConflicts: listConflicts.length, componentConflicts: componentConflicts.length },
    checks,
    failures,
    output: runDir,
  };
  check('独立回读只使用GET', execution.actual.methods.GET === calls.length && !execution.actual.methods.POST && !execution.actual.methods.PUT && !execution.actual.methods.DELETE, execution.actual.methods);
  execution.status = failures.length === 0 ? 'READY_FOR_POST_WRITE_MATH' : 'REVISE';
  execution.checks = checks;
  execution.failures = failures;
  await saveJson('执行结果.json', execution);
  await fsp.writeFile(path.join(runDir, '运行锁.json'), JSON.stringify({ at: new Date().toISOString(), runId, mode: execution.mode, apiWrites: 0 }, null, 2) + '\n');
  console.log(JSON.stringify({ status: execution.status, runId, calls: calls.length, methods: execution.actual.methods, statuses: execution.actual.statuses, lists: lists.length, details: details.length, protectionConflicts: protectionConflicts.length, listConflicts: listConflicts.length, componentConflicts: componentConflicts.length, output: runDir }, null, 2));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  const execution = { at: new Date().toISOString(), status: 'REVISE', mode: '独立第二轮全量GET；不发送业务写入', apiBase, candidateSha256: expected.candidateSha256, apiWrites: 0, businessWrites: 0, calls: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), checks, failures, error: { name: error.name, message: error.message }, output: runDir };
  await saveJson('执行结果.json', execution);
  console.log(JSON.stringify({ status: 'REVISE', runId, calls: calls.length, error: execution.error, output: runDir }, null, 2));
  process.exitCode = 1;
}

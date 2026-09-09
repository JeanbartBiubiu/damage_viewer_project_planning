import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 第十七批写入前完整保护。只发送GET，保存四个共享目录、20个技能主体、4个角色、4个关系、20张关联图片、120个组成列表及列表内全部详情。
// 该文件建立的是写入器的只读基线，不执行任何POST、PUT或DELETE。
const herePath = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidateFile = '修订一候选.json';
const planFile = '修订一写前计划.json';
const freezeFile = '修订一冻结候选锁.json';
const oldReadOnlyFile = '只读保护与公共参数.json';
const outputFile = '修订一写前完整保护.json';
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
  candidateDetails: 285,
  reusedPublicParameters: 22,
  newComponents: 263,
};
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const readBytes = name => fs.readFileSync(path.join(herePath, name));
const readJson = name => JSON.parse(readBytes(name));
const rows = response => Array.isArray(response?.data) ? response.data : Array.isArray(response?.data?.items) ? response.data.items : [];
const idField = kind => kinds.find(item => item[0] === kind)?.[1];
const apiKind = kind => kinds.find(item => item[0] === kind)?.[2];
const identity = (skillKey, kind, id) => `${skillKey}/${kind}/${id}`;
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
const candidate = JSON.parse(candidateBytes);
const plan = JSON.parse(planBytes);
const freeze = JSON.parse(freezeBytes);
const oldReadOnly = JSON.parse(oldReadOnlyBytes);
const checks = [];
const failures = [];
const check = (name, passed, detail = null) => {
  const row = { name, passed: Boolean(passed), detail };
  checks.push(row);
  if (!row.passed) failures.push(row);
  return row.passed;
};
check('修订一候选散列冻结', sha256(candidateBytes) === expected.candidateSha256, sha256(candidateBytes));
check('修订一计划散列冻结', sha256(planBytes) === expected.planFileSha256, sha256(planBytes));
check('修订一锁散列冻结', sha256(freezeBytes) === expected.freezeSha256, sha256(freezeBytes));
check('旧只读证据散列冻结', sha256(oldReadOnlyBytes) === expected.oldReadOnlySha256, sha256(oldReadOnlyBytes));
check('候选为20个固定技能位', equal(Object.keys(candidate.skills ?? {}), skills), Object.keys(candidate.skills ?? {}));
check('冻结候选等待审查且零写入', freeze.status?.includes('等待主负责人审查') && candidate.meta?.apiWrites === 0 && freeze.api?.businessWrites === 0 && freeze.api?.apiCalls === 0, { status: freeze.status, candidateApiWrites: candidate.meta?.apiWrites, freezeApi: freeze.api });

const candidateEntries = [];
for (const skillKey of skills) for (const [kind, key] of kinds) for (const body of candidate.skills?.[skillKey]?.write?.[kind] ?? []) {
  candidateEntries.push({ skillKey, kind, id: body[key], key, base: `/skills/${skillKey}/${apiKind(kind)}`, route: `/skills/${skillKey}/${apiKind(kind)}/${encodeURIComponent(body[key])}`, body });
}
const candidateById = new Map(candidateEntries.map(entry => [identity(entry.skillKey, entry.kind, entry.id), entry]));
const reusedKeys = new Set((plan.reusedPublicParameters ?? []).map(item => identity(item.skillKey, 'parameters', item.parameterKey)));
check('候选总组成数为285', candidateEntries.length === expected.candidateDetails, candidateEntries.length);
check('复用公共参数恰为22项', reusedKeys.size === expected.reusedPublicParameters && reusedKeys.size === (candidate.meta?.reuseReport?.publicParameters?.length ?? 0), reusedKeys.size);
check('计划恰含263条POST', plan.requestCount === expected.newComponents && plan.requests?.length === expected.newComponents && plan.requests.every(item => item.method === 'POST'), { requestCount: plan.requestCount, entries: plan.requests?.length });
check('计划不含主体、目录或六类禁写', (plan.requests ?? []).every(item => /^\/skills\/[^/]+\/(parameters|formulas|effects)$/.test(item.route)), null);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(herePath, '写入准备', `完整保护-${runId}`);
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

const protection = { catalogs: {}, characters: {}, relations: {}, subjects: {}, images: {}, lists: {}, details: {} };
const listConflicts = [];
const protectionConflicts = [];
const componentConflicts = [];
const catalogReferences = [];
const expectedExistingByList = new Map();
for (const key of reusedKeys) {
  const [skillKey, kind, id] = key.split('/');
  const listKey = `${skillKey}/${kind}`;
  expectedExistingByList.set(listKey, [...(expectedExistingByList.get(listKey) ?? []), id]);
}

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
  const oldRequests = new Map((oldReadOnly.requests ?? []).map(item => [item.route, item]));
  for (const [name, key] of catalogKinds) {
    const actual = rows(protection.catalogs[name]);
    if (name !== 'statuses') {
      const old = rows(oldReadOnly.catalogs?.[name]);
      const difference = exactDiff(old, actual);
      if (difference) protectionConflicts.push({ type: 'catalogChangedSinceOldReadOnly', name, diff: difference });
    }
    if (!actual.length) protectionConflicts.push({ type: 'catalogEmpty', name });
  }
  for (const item of plan.reusedPublicParameters ?? []) {
    const key = identity(item.skillKey, 'parameters', item.parameterKey);
    const route = `/skills/${item.skillKey}/parameters/${encodeURIComponent(item.parameterKey)}`;
    const old = oldReadOnly.parameters?.[`${item.skillKey}/${item.parameterKey}`]?.detail?.data;
    const actual = null;
    if (!old || !oldRequests.has(route)) protectionConflicts.push({ type: 'oldPublicParameterMissing', key, route });
    // 公共参数详情在后面的列表明细回读中取得；此处只校验旧证据确实保存了完整详情。
    if (old && oldRequests.get(route)?.data && exactDiff(old, oldRequests.get(route).data)) protectionConflicts.push({ type: 'oldPublicParameterEvidenceMismatch', key });
    void actual;
  }
  const historicalMedia = oldRequests;
  for (const hero of heroes) {
    const characterRoute = `/characters/champion_${hero}`;
    const relationRoute = `/character-skill-relations?characterKey=champion_${hero}`;
    const characterDifference = exactDiff(historicalMedia.get(characterRoute)?.data, protection.characters[hero]?.data);
    const relationDifference = exactDiff(historicalMedia.get(relationRoute)?.data, protection.relations[hero]?.data);
    if (characterDifference) protectionConflicts.push({ type: 'characterChangedSinceOldReadOnly', hero, diff: characterDifference });
    if (relationDifference) protectionConflicts.push({ type: 'relationChangedSinceOldReadOnly', hero, diff: relationDifference });
  }
  for (const skillKey of skills) {
    const route = `/skills/${skillKey}/representative-image`;
    const difference = exactDiff(historicalMedia.get(route)?.data, protection.images[skillKey]?.data);
    if (difference) protectionConflicts.push({ type: 'imageChangedSinceOldReadOnly', skillKey, diff: difference });
  }
  for (const skillKey of skills) {
    const subject = protection.subjects[skillKey]?.data;
    if (!subject) protectionConflicts.push({ type: 'subjectMissing', skillKey });
    if (subject?.maxLevel !== candidate.skills[skillKey]?.maxLevel) protectionConflicts.push({ type: 'subjectMaxLevelMismatch', skillKey, expected: candidate.skills[skillKey]?.maxLevel, actual: subject?.maxLevel });
  }

  for (const skillKey of skills) for (const [kind, key, endpointKind] of kinds) {
    const route = `/skills/${skillKey}/${endpointKind}`;
    const response = await get(route);
    const items = rows(response);
    const ids = items.map(item => item[key]);
    const listKey = `${skillKey}/${kind}`;
    protection.lists[listKey] = { skillKey, kind, route, status: response.status, items };
    if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) listConflicts.push({ type: 'duplicateOrInvalidListKey', skillKey, kind, ids });
    const expectedIds = new Set(expectedExistingByList.get(listKey) ?? []);
    if (ids.length !== expectedIds.size || ids.some(id => !expectedIds.has(id))) listConflicts.push({ type: 'unexpectedCurrentComponent', skillKey, kind, expected: [...expectedIds], actual: ids });
    for (const item of items) {
      const id = item[key];
      const detailRoute = `${route}/${encodeURIComponent(id)}`;
      const detailResponse = await get(detailRoute);
      const detailRecord = { skillKey, kind, id, route: detailRoute, status: detailResponse.status, data: detailResponse.data, listItem: item, listSummaryDiff: listSummaryDiff(item, detailResponse.data) };
      protection.details[identity(skillKey, kind, id)] = detailRecord;
      if (detailRecord.listSummaryDiff) listConflicts.push({ type: 'listDetailMismatch', skillKey, kind, id, diff: detailRecord.listSummaryDiff });
      const candidateEntry = candidateById.get(identity(skillKey, kind, id));
      if (!candidateEntry) componentConflicts.push({ type: 'unexpectedExisting', skillKey, kind, id });
      if (candidateEntry) {
        const difference = businessDiff(candidateEntry.body, detailResponse.data);
        if (difference) componentConflicts.push({ type: 'existingValueMismatch', skillKey, kind, id, diff: difference });
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
  for (const entry of candidateEntries) walk(entry.body, identity(entry.skillKey, entry.kind, entry.id));
  const requiredCatalogItems = [
    ['attributes', 'mana'],
    ['attributes', 'move_speed_percent'],
    ['modifier-zones', 'attribute_flat_add'],
  ];
  const requiredCatalogChecks = requiredCatalogItems.map(([name, key]) => {
    const catalogKey = catalogKinds.find(item => item[0] === name)?.[1];
    const row = catalogSets[catalogKey]?.get(key);
    const passed = Boolean(row && row.status === 'ENABLED');
    if (!passed) componentConflicts.push({ type: 'requiredCatalogItemMissing', catalog: name, key, status: row?.status ?? 'MISSING' });
    return { catalog: name, key, status: row?.status ?? null, passed };
  });
  const expectedDetailCount = Object.values(protection.lists).reduce((sum, list) => sum + list.items.length, 0);
  const summary = {
    catalogs: Object.keys(protection.catalogs).length,
    characters: Object.keys(protection.characters).length,
    relations: Object.keys(protection.relations).length,
    subjects: Object.keys(protection.subjects).length,
    images: Object.keys(protection.images).length,
    lists: Object.keys(protection.lists).length,
    details: Object.keys(protection.details).length,
    publicParameterDetails: [...reusedKeys].filter(key => protection.details[key]).length,
    expectedPublicParameterDetails: expected.reusedPublicParameters,
    expectedCandidateDetails: expected.candidateDetails,
    expectedNewComponents: expected.newComponents,
    currentExpectedExistingDetails: expected.reusedPublicParameters,
    requests: calls.length,
    statusCounts: calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}),
    failures: calls.filter(item => !item.ok).length,
    apiWrites: calls.filter(item => item.method !== 'GET').length,
    businessWrites: 0,
    methodCounts: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}),
    expectedRequestFormula: '4共享目录+4角色+4关系+20技能主体+20图片+120列表+当前列表全部详情',
    listItemDetailCount: expectedDetailCount,
  };
  const result = {
    at: new Date().toISOString(),
    runId,
    mode: '只读完整保护；不发送业务写入',
    source: 'client16.17/official16.17.1',
    sourceBuild: '16.17.8104348+branch.releases-16-17.content.release',
    apiBase,
    candidateSha256: expected.candidateSha256,
    planFileSha256: expected.planFileSha256,
    freezeSha256: expected.freezeSha256,
    oldReadOnlySha256: expected.oldReadOnlySha256,
    candidateCounts: { total: candidateEntries.length, new: expected.newComponents, reused: expected.reusedPublicParameters },
    protection,
    conflicts: { protection: protectionConflicts, lists: listConflicts, components: componentConflicts },
    catalogReferences,
    requiredCatalogChecks,
    checks,
    failures,
    summary,
    apiWrites: 0,
    businessWrites: 0,
  };
  check('完整保护对象数量', summary.catalogs === 4 && summary.characters === 4 && summary.relations === 4 && summary.subjects === 20 && summary.images === 20 && summary.lists === 120, summary);
  check('写前当前组成仅含22个复用公共参数', summary.details === expected.reusedPublicParameters && summary.publicParameterDetails === expected.reusedPublicParameters && protectionConflicts.length === 0 && listConflicts.length === 0 && componentConflicts.length === 0, { details: summary.details, protectionConflicts: protectionConflicts.length, listConflicts: listConflicts.length, componentConflicts: componentConflicts.length });
  check('共享目录关键项已启用', requiredCatalogChecks.every(item => item.passed), requiredCatalogChecks);
  check('完整保护只使用GET', summary.apiWrites === 0 && summary.businessWrites === 0 && summary.methodCounts.GET === summary.requests, summary.methodCounts);
  result.checks = checks;
  result.failures = failures;
  result.status = failures.length === 0 ? 'READY_FOR_WRITER_REVIEW' : 'REVISE';
  await saveJson('保护结果.json', result);
  const outputBytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
  await fsp.writeFile(path.join(herePath, outputFile), outputBytes, { flag: 'wx' });
  await fsp.writeFile(path.join(runDir, '运行锁.json'), JSON.stringify({ at: new Date().toISOString(), runId, mode: result.mode, apiWrites: 0, candidateSha256: expected.candidateSha256, planFileSha256: expected.planFileSha256 }, null, 2) + '\n');
  console.log(JSON.stringify({ status: result.status, runId, output: path.join(herePath, outputFile), summary, conflicts: { protection: protectionConflicts.length, lists: listConflicts.length, components: componentConflicts.length }, requiredCatalogChecks }, null, 2));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  const result = { at: new Date().toISOString(), runId, mode: '只读完整保护；不发送业务写入', candidateSha256: expected.candidateSha256, planFileSha256: expected.planFileSha256, freezeSha256: expected.freezeSha256, apiWrites: 0, businessWrites: 0, summary: { requests: calls.length, methodCounts: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}) }, error: { name: error.name, message: error.message }, checks, failures };
  await saveJson('保护结果.json', result);
  console.log(JSON.stringify({ status: 'REVISE', runId, output: path.join(runDir, '保护结果.json'), error: result.error, calls: calls.length }, null, 2));
  process.exitCode = 1;
}

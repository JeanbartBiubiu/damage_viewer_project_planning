import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 这是业务写入后的独立第二轮核验。它只发送GET，重新取得保护对象、120个列表和候选153条详情，数学核算另起进程读取本轮结果。
// 不读取实际录入器的组件快照作为结论依据；GET出错立即停止后续请求。
const herePath = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidateFile = '完整候选-修订版2.json';
const candidateVersionFile = '候选版本-修订版2.json';
const planFile = '写前计划-修订版2.json';
const freezeFile = '冻结候选锁-修订版2.json';
const originalFile = '写前现值.json';
const mediaFile = '关联与图片保护快照-终稿.json';
const sourceEvidenceFile = '修订组件来源摘要-修订版2.json';
const skills = ['malzahar', 'anivia', 'lissandra', 'karthus'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const heroes = ['malzahar', 'anivia', 'lissandra', 'karthus'];
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
  candidateSha256: '1e8809bc4c69d42a4b947f9d533e51bdb8e53d4ff04153091ec7cbadbda643bc',
  candidateVersionSha256: '6f12f66530b3ddb4d4ac7c69379348d6f018079f84a80a7d005b9bd02bb9d2e8',
  writePlanSha256: '6c2e687d3aaa74401d07fe200fa1c4bfe022f183a51f2d20d3492ba41d90b022',
  freezeSha256: 'e4c8fa637700b666a885b9fa1500e164d511a1ce3344c05e443d5444f05a9f75',
  originalSha256: '4f4c30ab1768b20f3d1f762b9fb73d96baebba8e4c70870d4bdfbf849725b339',
  mediaSha256: 'bc2e2cbc99cc940644e05ed575467a143c146eb5e17ef01f7bca593b67e78938',
  sourceEvidenceSha256: '1c46d8d383796c8cc02562d49a398881333a9071dd517aa55431f4353ee9268b',
  candidateDetails: 153,
  lists: 120,
};
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const readBytes = file => fs.readFileSync(file);
const readJson = file => JSON.parse(readBytes(file));
const filePath = name => path.join(herePath, name);
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
const diff = (expectedValue, actualValue, at = '$') => {
  if (equal(expectedValue, actualValue)) return null;
  if (expectedValue === null || actualValue === null || typeof expectedValue !== 'object' || typeof actualValue !== 'object') return { path: at, expected: expectedValue, actual: actualValue };
  if (Array.isArray(expectedValue) || Array.isArray(actualValue)) {
    if (!Array.isArray(expectedValue) || !Array.isArray(actualValue) || expectedValue.length !== actualValue.length) return { path: at, expected: expectedValue, actual: actualValue };
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
};
const businessDiff = (expectedValue, actualValue) => diff(canonical(expectedValue), canonical(actualValue));
const exactDiff = (expectedValue, actualValue) => diff(exactCanonical(expectedValue), exactCanonical(actualValue));
const listSummaryDiff = (item, detail) => {
  for (const [key, expectedValue] of Object.entries(item ?? {})) {
    const actualValue = key === 'resultCount'
      ? Array.isArray(detail?.results) ? detail.results.length : undefined
      : key === 'lifecycleEnabled'
        ? detail?.lifecycle !== null && detail?.lifecycle !== undefined
        : detail?.[key];
    if (!equal(expectedValue, actualValue)) return { path: key, expected: expectedValue, actual: actualValue };
  }
  return null;
};
const schema = {
  parameterValueTypes: new Set(['INTEGER', 'DECIMAL']),
  parameterValueModes: new Set(['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT']),
  nodeTypes: new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']),
  operations: new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']),
  resultTypes: new Set(['RESOURCE_CHANGE']),
  resourceOperations: new Set(['CONSUME', 'RESTORE']),
};
const candidateBytes = readBytes(filePath(candidateFile));
const candidateVersionBytes = readBytes(filePath(candidateVersionFile));
const planBytes = readBytes(filePath(planFile));
const freezeBytes = readBytes(filePath(freezeFile));
const originalBytes = readBytes(filePath(originalFile));
const mediaBytes = readBytes(filePath(mediaFile));
const sourceEvidenceBytes = readBytes(filePath(sourceEvidenceFile));
const candidate = JSON.parse(candidateBytes);
const candidateVersion = JSON.parse(candidateVersionBytes);
const plan = JSON.parse(planBytes);
const freeze = JSON.parse(freezeBytes);
const original = JSON.parse(originalBytes);
const media = JSON.parse(mediaBytes);
const sourceEvidence = JSON.parse(sourceEvidenceBytes);
const expectedEntries = [];
for (const skillKey of skills) for (const [kind, key] of kinds) for (const body of candidate.skills?.[skillKey]?.write?.[kind] ?? []) expectedEntries.push({ skillKey, kind, id: body[key], body });
const checks = [];
const failures = [];
const check = (name, passed, detail = null) => { const row = { name, passed: Boolean(passed), detail }; checks.push(row); if (!row.passed) failures.push(row); return row.passed; };
check('候选冻结', sha256(candidateBytes) === expected.candidateSha256, sha256(candidateBytes));
check('候选版本冻结', sha256(candidateVersionBytes) === expected.candidateVersionSha256, sha256(candidateVersionBytes));
check('写前计划冻结', sha256(planBytes) === expected.writePlanSha256, sha256(planBytes));
check('修订版2锁冻结', sha256(freezeBytes) === expected.freezeSha256, sha256(freezeBytes));
check('写前现值冻结', sha256(originalBytes) === expected.originalSha256, sha256(originalBytes));
check('关联与图片保护快照冻结', sha256(mediaBytes) === expected.mediaSha256, sha256(mediaBytes));
check('来源摘要冻结', sha256(sourceEvidenceBytes) === expected.sourceEvidenceSha256, sha256(sourceEvidenceBytes));
check('候选20槽顺序冻结', equal(Object.keys(candidate.skills ?? {}), skills), Object.keys(candidate.skills ?? {}));
check('候选153条组成', expectedEntries.length === expected.candidateDetails, expectedEntries.length);
check('候选来源与锁关联', candidateVersion.fileSha256 === expected.candidateSha256 && freeze.candidateSha256 === expected.candidateSha256 && plan.candidateSha256 === expected.candidateSha256, null);
check('候选计划关联', candidateVersion.planSha256 === freeze.candidatePlanSha256 && plan.candidatePlanSha256 === freeze.candidatePlanSha256, { candidatePlanSha256: freeze.candidatePlanSha256 });
check('本轮资料未声明写入', candidate.meta?.apiWrites === 0 && plan.policy?.businessWrites === 0 && freeze.apiWrites === 0 && freeze.businessWrites === 0, null);
check('来源摘要关联候选', sourceEvidence.candidateSha256 === expected.candidateSha256, sourceEvidence.candidateSha256);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(herePath, '独立回读', runId);
await fsp.mkdir(runDir, { recursive: true });
const journalPath = path.join(runDir, 'HTTP流水.jsonl');
const runLockPath = path.join(runDir, '运行锁.json');
const calls = [];
const appendJsonl = async value => { const handle = await fsp.open(journalPath, 'a'); try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); } };
const saveJson = async (name, value) => fsp.writeFile(path.join(runDir, name), JSON.stringify(value, null, 2) + '\n');
await fsp.writeFile(runLockPath, JSON.stringify({ at: new Date().toISOString(), runId, mode: '独立第二轮全量GET', candidateSha256: expected.candidateSha256, planSha256: expected.writePlanSha256, apiWrites: 0 }, null, 2) + '\n');
await appendJsonl({ sequence: 0, phase: '运行开始', at: new Date().toISOString(), method: 'NONE', route: null, mode: '独立第二轮全量GET' });
const get = async route => {
  if (!route.startsWith('/') || route.includes('://') || route.includes('..')) throw Error(`非法GET路径 ${route}`);
  const sequence = calls.length + 1;
  await appendJsonl({ sequence, phase: '请求前', at: new Date().toISOString(), method: 'GET', route });
  const started = Date.now();
  let result;
  try {
    const response = await fetch(apiBase + route, { method: 'GET', headers: { Authorization: `Bearer ${process.env.HERO16_API_TOKEN ?? 'local-entry'}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
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

let protection = null;
let lists = [];
let details = [];
let protectionConflicts = [];
let listConflicts = [];
let componentConflicts = [];
let catalogReferences = [];
let math = null;
let execution = { runId, mode: '独立第二轮全量GET；不发送业务写入', apiBase, candidateSha256: expected.candidateSha256, planSha256: expected.writePlanSha256, apiWrites: 0, expected: { catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, lists: 120, candidateDetails: 153, totalRequests: 325 }, actual: null, failures: [], success: false };
try {
  if (failures.length) throw Error(`静态冻结校验失败 ${failures.length} 项`);
  protection = { catalogs: {}, characters: {}, relations: {}, subjects: {}, images: {} };
  for (const [name] of catalogKinds) protection.catalogs[name] = await get(`/${name}`);
  for (const hero of heroes) {
    protection.characters[hero] = await get(`/characters/champion_${hero}`);
    protection.relations[hero] = await get(`/character-skill-relations?characterKey=champion_${hero}`);
  }
  for (const skillKey of skills) {
    protection.subjects[skillKey] = await get(`/skills/${skillKey}`);
    protection.images[skillKey] = await get(`/skills/${skillKey}/representative-image`);
  }
  await saveJson('独立保护.json', protection);
  for (const [name, key] of catalogKinds) {
    const oldRows = rows(original.catalogs?.[name]);
    const actualRows = rows(protection.catalogs[name]);
    const rowDiff = exactDiff(oldRows, actualRows);
    if (rowDiff) protectionConflicts.push({ type: 'catalog', name, diff: rowDiff });
  }
  for (const skillKey of skills) {
    const subjectDiff = exactDiff(original.skills?.[skillKey]?.subject?.data, protection.subjects[skillKey]?.data);
    if (subjectDiff) protectionConflicts.push({ type: 'subject', skillKey, diff: subjectDiff });
    if (protection.subjects[skillKey]?.data?.maxLevel !== candidate.skills[skillKey]?.maxLevel) protectionConflicts.push({ type: 'subjectMaxLevel', skillKey, expected: candidate.skills[skillKey]?.maxLevel, actual: protection.subjects[skillKey]?.data?.maxLevel });
  }
  const historicalMedia = new Map((media.requests ?? []).map(item => [item.route, item.data]));
  for (const hero of heroes) {
    const characterRoute = `/characters/champion_${hero}`;
    const relationRoute = `/character-skill-relations?characterKey=champion_${hero}`;
    const characterDiff = exactDiff(historicalMedia.get(characterRoute), protection.characters[hero]?.data);
    const relationDiff = exactDiff(historicalMedia.get(relationRoute), protection.relations[hero]?.data);
    if (characterDiff) protectionConflicts.push({ type: 'character', hero, diff: characterDiff });
    if (relationDiff) protectionConflicts.push({ type: 'relation', hero, diff: relationDiff });
  }
  for (const skillKey of skills) {
    const route = `/skills/${skillKey}/representative-image`;
    const imageDiff = exactDiff(historicalMedia.get(route), protection.images[skillKey]?.data);
    if (imageDiff) protectionConflicts.push({ type: 'image', skillKey, diff: imageDiff });
  }
  check('保护对象与历史快照全字段一致', protectionConflicts.length === 0, protectionConflicts);

  const expectedBySkillKind = new Map();
  for (const entry of expectedEntries) expectedBySkillKind.set(`${entry.skillKey}/${entry.kind}`, (expectedBySkillKind.get(`${entry.skillKey}/${entry.kind}`) ?? []).concat(entry));
  const listMap = new Map();
  for (const skillKey of skills) for (const [kind, key, endpointKind] of kinds) {
    const route = `/skills/${skillKey}/${endpointKind}`;
    const response = await get(route);
    const items = rows(response);
    const ids = items.map(item => item[key]);
    if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) listConflicts.push({ skillKey, kind, type: 'duplicateOrInvalidKey', ids });
    listMap.set(`${skillKey}/${kind}`, { skillKey, kind, route, status: response.status, items });
    lists.push({ skillKey, kind, route, status: response.status, items });
  }
  const detailMap = new Map();
  for (const entry of expectedEntries) {
    const route = `/skills/${entry.skillKey}/${apiKind(entry.kind)}/${encodeURIComponent(entry.id)}`;
    const response = await get(route);
    const list = listMap.get(`${entry.skillKey}/${entry.kind}`);
    const listItem = list?.items.find(item => item[idField(entry.kind)] === entry.id) ?? null;
    const listDiff = listItem ? listSummaryDiff(listItem, response.data) : { path: 'list', expected: 'candidate entry', actual: 'missing from list' };
    if (listDiff) listConflicts.push({ skillKey: entry.skillKey, kind: entry.kind, id: entry.id, type: 'listDetailMismatch', diff: listDiff });
    const record = { skillKey: entry.skillKey, kind: entry.kind, id: entry.id, route, status: response.status, data: response.data, listItem, listSummaryDiff: listDiff };
    details.push(record);
    detailMap.set(keyOf(entry.skillKey, entry.kind, entry.id), record);
    const bodyDiff = businessDiff(entry.body, response.data);
    if (bodyDiff) componentConflicts.push({ skillKey: entry.skillKey, kind: entry.kind, id: entry.id, type: 'candidateDetailDiff', diff: bodyDiff });
  }
  for (const list of lists) {
    const idKey = idField(list.kind);
    const expectedForList = expectedBySkillKind.get(`${list.skillKey}/${list.kind}`) ?? [];
    const expectedIds = new Set(expectedForList.map(entry => entry.id));
    const actualIds = new Set(list.items.map(item => item[idKey]));
    if (actualIds.size !== expectedIds.size || [...actualIds].some(id => !expectedIds.has(id))) listConflicts.push({ skillKey: list.skillKey, kind: list.kind, type: 'listIdsDiffer', expected: [...expectedIds], actual: [...actualIds] });
  }
  check('120个六类列表完整对应候选', lists.length === expected.lists && listConflicts.length === 0, { lists: lists.length, conflicts: listConflicts.length });
  check('153条候选详情全字段对应', details.length === expected.candidateDetails && details.every(item => item.status === 200) && componentConflicts.length === 0, { details: details.length, conflicts: componentConflicts.length });

  const catalogSets = Object.fromEntries(catalogKinds.map(([name, key]) => [key, new Map(rows(protection.catalogs[name]).map(item => [item[key], item]))]));
  const schemaErrors = [];
  const walk = (value, at) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${at}[${index}]`));
    if (!value || typeof value !== 'object') return;
    if (value.nodeType !== undefined) {
      if (!schema.nodeTypes.has(value.nodeType)) schemaErrors.push({ at, type: 'nodeType', value: value.nodeType });
      if (value.nodeType === 'OPERATION' && !schema.operations.has(value.operation)) schemaErrors.push({ at, type: 'operation', value: value.operation });
    }
    if (value.resultType !== undefined && !schema.resultTypes.has(value.resultType)) schemaErrors.push({ at, type: 'resultType', value: value.resultType });
    if (value.detail?.operation !== undefined && !schema.resourceOperations.has(value.detail.operation)) schemaErrors.push({ at, type: 'resourceOperation', value: value.detail.operation });
    for (const [key, child] of Object.entries(value)) {
      if (catalogSets[key] && typeof child === 'string') {
        const row = catalogSets[key].get(child);
        const reference = { at: `${at}.${key}`, key, value: child, enabled: row?.status === 'ENABLED' };
        catalogReferences.push(reference);
        if (!reference.enabled) componentConflicts.push({ type: 'catalogReferenceMissing', ...reference });
      }
      walk(child, `${at}.${key}`);
    }
  };
  for (const entry of expectedEntries) walk(entry.body, `${entry.skillKey}/${entry.kind}/${entry.id}`);
  for (const skillKey of skills) for (const parameter of candidate.skills[skillKey].write.parameters) {
    if (!schema.parameterValueTypes.has(parameter.valueType)) schemaErrors.push({ skillKey, parameterKey: parameter.parameterKey, type: 'valueType', value: parameter.valueType });
    if (!schema.parameterValueModes.has(parameter.valueMode)) schemaErrors.push({ skillKey, parameterKey: parameter.parameterKey, type: 'valueMode', value: parameter.valueMode });
    if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) schemaErrors.push({ skillKey, parameterKey: parameter.parameterKey, type: 'runtimeDefault' });
    if (parameter.valueMode === 'SKILL_LEVEL' && (parameter.fixedValue !== null || !parameter.levelValues || Object.keys(parameter.levelValues).length !== candidate.skills[skillKey].maxLevel)) schemaErrors.push({ skillKey, parameterKey: parameter.parameterKey, type: 'skillLevelMap' });
  }
  check('实际类型状态目录和结构字典无未知值', schemaErrors.length === 0 && componentConflicts.every(item => item.type !== 'catalogReferenceMissing'), { schemaErrors, catalogConflicts: componentConflicts.filter(item => item.type === 'catalogReferenceMissing').length });
  check('候选引用的实际目录项均启用', catalogReferences.every(item => item.enabled), catalogReferences.filter(item => !item.enabled));
  check('没有无schema热量或其他未知属性', catalogReferences.every(item => item.value !== 'heat' && item.value !== '热量'), catalogReferences.filter(item => item.value === 'heat' || item.value === '热量'));
  const componentSnapshot = { phase: '独立全量新GET', startedAt: new Date().toISOString(), protection, lists, details, counts: { lists: lists.length, details: details.length, successfulDetails: details.filter(item => item.status === 200).length }, protectionConflicts, listConflicts, componentConflicts, catalogReferences, finishedAt: new Date().toISOString() };
  await saveJson('最终全量组件现值.json', componentSnapshot);
  execution.actual = { calls: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}), protection: { catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20 }, lists: lists.length, details: details.length, protectionConflicts: protectionConflicts.length, listConflicts: listConflicts.length, componentConflicts: componentConflicts.length, catalogReferences: catalogReferences.length };
  check('独立全量GET请求总数', calls.length === 325, execution.actual);
  check('独立回读只使用GET', execution.actual.methods.GET === calls.length && !execution.actual.methods.POST && !execution.actual.methods.PUT && !execution.actual.methods.DELETE, execution.actual.methods);
  execution.failures = failures;
  execution.success = failures.length === 0;
  await saveJson('执行结果.json', execution);
  if (execution.success) {
    const child = spawnSync(process.execPath, [filePath('实际读后数学核算.mjs'), '--run-dir', runDir], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    const mathPath = path.join(runDir, '实际读后数学核算.json');
    if (fs.existsSync(mathPath)) math = readJson(mathPath);
    if (child.status !== 0 || !math || !['READY_FOR_INDEPENDENT_REVIEW'].includes(math.status)) {
      failures.push({ name: '独立实际参数公式数学核算未通过', detail: { childStatus: child.status, stdout: child.stdout?.trim(), stderr: child.stderr?.trim(), mathStatus: math?.status ?? null } });
      execution.success = false;
    }
    execution.independentMath = { status: math?.status ?? null, checks: math?.checks ?? null, failedChecks: math?.failedChecks ?? null, formulaChecks: math?.formulas?.checks?.length ?? null, inputRejections: math?.formulas?.inputRejections?.length ?? null, output: mathPath };
  }
} catch (error) {
  failures.push({ name: error.name, detail: error.message });
  execution.failures = failures;
  execution.success = false;
  execution.actual = { calls: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}) };
} finally {
  execution.failures = failures;
  execution.success = failures.length === 0 && execution.success;
  execution.finishedAt = new Date().toISOString();
  await saveJson('执行结果.json', execution);
}
console.log(JSON.stringify({ status: execution.success ? 'READY_FOR_INDEPENDENT_REVIEW' : 'REVISE', runId, calls: calls.length, expectedRequests: 325, methods: execution.actual?.methods ?? {}, statuses: execution.actual?.statuses ?? {}, protectionConflicts: protectionConflicts.length, listConflicts: listConflicts.length, componentConflicts: componentConflicts.length, mathStatus: math?.status ?? null, output: runDir }, null, 2));
if (!execution.success) process.exitCode = 1;

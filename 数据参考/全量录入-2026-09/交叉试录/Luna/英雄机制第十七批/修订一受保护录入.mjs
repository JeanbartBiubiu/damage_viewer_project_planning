import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 第十七批受保护录入器。默认只读预检；只有 --apply 和显式环境确认同时存在时才允许263条新增POST。
// 只允许参数、公式、效果三类新增；主体、角色、关系、图片、目录和其他三类组成永不写入。
// 写入前后均逐条GET，任一冲突、错误或回读不一致立即停止。
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
const writableKinds = new Set(['parameters', 'formulas', 'effects']);
const catalogKinds = [
  ['attributes', 'attributeKey'],
  ['modifier-zones', 'modifierZoneKey'],
  ['damage-types', 'damageTypeKey'],
  ['statuses', 'statusKey'],
];
const expected = {
  candidateSha256: '76ff9761638e3f10d147f662204bbb94656f10ee0edafbc39dcd97d8d37babd7',
  candidatePlanSha256: '92712a5aea2836a4e1fc1d0ecec4d22beb29bae9bd3414570fb12b391727ece1',
  planFileSha256: '7b1b6a62bafaefb8b0d78272300ec281beed0baa5397be902b7685a687254718',
  freezeSha256: 'baee05b688db36f42cfce7fd8e2376e5e93c64888b0ecebc96cfa9752fbec258',
  oldReadOnlySha256: 'ba50c2f11595df9c64d95345b4af156f9e468656b3bcdb8634558048bad8b62c',
  fullProtectionSha256: 'cff6dd7a97ed589f57fcee22052814496dcab6f1f5492bf7e18626d379a2d457',
  totalComponents: 285,
  reusedPublicParameters: 22,
  newComponents: 263,
};
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const schema = {
  parameterValueTypes: new Set(['INTEGER', 'DECIMAL']),
  parameterValueModes: new Set(['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT']),
  nodeTypes: new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']),
  operations: new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']),
  resultTypes: new Set(['RESOURCE_CHANGE', 'NORMAL_SHIELD', 'ATTRIBUTE_CHANGE']),
  resourceOperations: new Set(['CONSUME', 'RESTORE']),
  attributeOperations: new Set(['INCREASE', 'DECREASE', 'SET']),
};
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
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw Error('只接受默认只读预检或 --apply');
const apply = args.includes('--apply');
if (apply && process.env.HERO17_APPLY_CONFIRM !== 'CONFIRM_HERO17_COMPONENT_POSTS') throw Error('实际POST需要显式设置 HERO17_APPLY_CONFIRM=CONFIRM_HERO17_COMPONENT_POSTS');

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
const staticChecks = [];
const staticFailures = [];
const staticCheck = (name, passed, detail = null) => {
  const row = { name, passed: Boolean(passed), detail };
  staticChecks.push(row);
  if (!row.passed) staticFailures.push(row);
  return row.passed;
};
staticCheck('修订一候选文件冻结', sha256(candidateBytes) === expected.candidateSha256, sha256(candidateBytes));
staticCheck('修订一写前计划文件冻结', sha256(planBytes) === expected.planFileSha256, sha256(planBytes));
staticCheck('修订一冻结锁冻结', sha256(freezeBytes) === expected.freezeSha256, sha256(freezeBytes));
staticCheck('旧只读文件冻结', sha256(oldReadOnlyBytes) === expected.oldReadOnlySha256, sha256(oldReadOnlyBytes));
staticCheck('完整保护文件冻结', sha256(fullProtectionBytes) === expected.fullProtectionSha256, sha256(fullProtectionBytes));
staticCheck('候选计划散列关联', plan.candidateSha256 === expected.candidateSha256 && plan.candidatePlanSha256 === expected.candidatePlanSha256 && freeze.baseCandidateSha256 === '7a09c5e2597c819aa38c7ac0901e047c2709cfcdb1be6310ebafe9ff926cc14a' && freeze.candidatePlanSha256 === expected.candidatePlanSha256, { candidate: plan.candidateSha256, plan: plan.candidatePlanSha256, freeze: freeze.candidatePlanSha256 });
staticCheck('候选保持20个固定技能位', equal(Object.keys(candidate.skills ?? {}), skills), Object.keys(candidate.skills ?? {}));
staticCheck('候选只含参数公式效果', skills.every(skillKey => (candidate.skills[skillKey].write.processes ?? []).length === 0 && (candidate.skills[skillKey].write.internalStates ?? []).length === 0 && (candidate.skills[skillKey].write.triggerRules ?? []).length === 0), null);
staticCheck('候选零业务写入标记', candidate.meta?.apiWrites === 0 && baseline.apiWrites === 0 && baseline.businessWrites === 0, { candidate: candidate.meta?.apiWrites, baseline: baseline.apiWrites });
staticCheck('完整保护是194次全GET', baseline.summary?.requests === 194 && baseline.summary?.failures === 0 && baseline.summary?.apiWrites === 0 && baseline.summary?.methodCounts?.GET === 194, baseline.summary);
staticCheck('完整保护覆盖对象数量', baseline.summary?.catalogs === 4 && baseline.summary?.characters === 4 && baseline.summary?.relations === 4 && baseline.summary?.subjects === 20 && baseline.summary?.images === 20 && baseline.summary?.lists === 120, baseline.summary);
staticCheck('完整保护没有冲突', Object.values(baseline.conflicts ?? {}).every(value => Array.isArray(value) && value.length === 0) && baseline.status === 'READY_FOR_WRITER_REVIEW', baseline.conflicts);

const candidateEntries = [];
for (const skillKey of skills) for (const [kind, key] of kinds) for (const body of candidate.skills?.[skillKey]?.write?.[kind] ?? []) {
  candidateEntries.push({ skillKey, kind, id: body[key], key, base: `/skills/${skillKey}/${apiKind(kind)}`, route: `/skills/${skillKey}/${apiKind(kind)}/${encodeURIComponent(body[key])}`, body });
}
const candidateById = new Map(candidateEntries.map(entry => [keyOf(entry.skillKey, entry.kind, entry.id), entry]));
const reusedKeys = new Set((plan.reusedPublicParameters ?? []).map(item => keyOf(item.skillKey, 'parameters', item.parameterKey)));
const expectedNewEntries = candidateEntries.filter(entry => !reusedKeys.has(keyOf(entry.skillKey, entry.kind, entry.id)));
staticCheck('候选总组成恰为285', candidateEntries.length === expected.totalComponents, candidateEntries.length);
staticCheck('复用公共参数恰为22', reusedKeys.size === expected.reusedPublicParameters, reusedKeys.size);
staticCheck('新增组成恰为263', expectedNewEntries.length === expected.newComponents, expectedNewEntries.length);
staticCheck('计划恰为263条POST', plan.requests?.length === expected.newComponents && plan.requestCount === expected.newComponents && plan.requests.every(item => item.method === 'POST'), { requestCount: plan.requestCount, entries: plan.requests?.length });
staticCheck('计划键唯一且覆盖新增', (() => {
  const planKeys = new Set((plan.requests ?? []).map(item => keyOf(item.skillKey, item.kind, item.stableKey ?? item.key)));
  return planKeys.size === expectedNewEntries.length && expectedNewEntries.every(entry => planKeys.has(keyOf(entry.skillKey, entry.kind, entry.id)));
})(), null);
for (const entry of expectedNewEntries) {
  const planned = (plan.requests ?? []).find(item => keyOf(item.skillKey, item.kind, item.stableKey ?? item.key) === keyOf(entry.skillKey, entry.kind, entry.id));
  staticCheck(`计划对象等于候选 ${keyOf(entry.skillKey, entry.kind, entry.id)}`, Boolean(planned) && planned.route === entry.base && equal(planned.body, entry.body), planned ? { route: planned.route } : null);
}
const baselineDetails = new Map(Object.entries(baseline.protection?.details ?? {}).map(([key, record]) => [key, record.data]));
const baselineLists = new Map(Object.entries(baseline.protection?.lists ?? {}).map(([key, record]) => [key, record.items ?? []]));
staticCheck('完整保护明细正好为22个复用参数', baselineDetails.size === expected.reusedPublicParameters && [...reusedKeys].every(key => baselineDetails.has(key)), { details: baselineDetails.size, reuseKeys: reusedKeys.size });
for (const [key, body] of candidateById) if (reusedKeys.has(key)) staticCheck(`复用参数值保持 ${key}`, Boolean(baselineDetails.get(key)) && !businessDiff(body.body, baselineDetails.get(key)), businessDiff(body.body, baselineDetails.get(key)));

const validateCandidate = () => {
  const errors = [];
  const references = [];
  const add = (message, detail) => errors.push({ message, detail });
  const walk = (value, at, catalogSets) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${at}[${index}]`, catalogSets));
    if (!value || typeof value !== 'object') return;
    if (value.nodeType !== undefined) {
      if (!schema.nodeTypes.has(value.nodeType)) add('未知公式节点类型', { at, value: value.nodeType });
      if (value.nodeType === 'OPERATION' && !schema.operations.has(value.operation)) add('未知公式运算', { at, value: value.operation });
    }
    if (value.resultType !== undefined && !schema.resultTypes.has(value.resultType)) add('未知效果结果类型', { at, value: value.resultType });
    if (value.moment !== undefined && value.moment === 'MOMENT_EVALUATION') add('禁止即时求值', { at, value: value.moment });
    if (value.operation !== undefined && value.detail?.attributeKey) {
      const allowedOperations = value.resultType === 'ATTRIBUTE_CHANGE' ? schema.attributeOperations : schema.resourceOperations;
      if (!allowedOperations.has(value.operation)) add('未知效果操作', { at, value: value.operation });
    }
    if (value.lifecycle?.durationValue) {
      const duration = value.lifecycle.durationValue;
      if (duration.kind !== 'PARAMETER' || typeof duration.parameterKey !== 'string' || Object.hasOwn(duration, 'nodeType')) add('生命周期参数引用结构错误', { at, duration });
    }
    for (const [key, child] of Object.entries(value)) {
      if (catalogSets[key] && typeof child === 'string') {
        const row = catalogSets[key].get(child);
        references.push({ at: `${at}.${key}`, key, value: child, enabled: row?.status === 'ENABLED' });
        if (!row || row.status !== 'ENABLED') add('引用的共享目录项不存在或未启用', references.at(-1));
      }
      walk(child, `${at}.${key}`, catalogSets);
    }
  };
  const catalogSets = Object.fromEntries(catalogKinds.map(([name, key]) => [key, new Map(rows(baseline.protection?.catalogs?.[name]).map(item => [item[key], item]))]));
  for (const entry of candidateEntries) walk(entry.body, keyOf(entry.skillKey, entry.kind, entry.id), catalogSets);
  for (const skillKey of skills) {
    const skill = candidate.skills[skillKey];
    for (const parameter of skill.write.parameters) {
      if (!schema.parameterValueTypes.has(parameter.valueType)) add('未知参数值类型', { skillKey, parameterKey: parameter.parameterKey, value: parameter.valueType });
      if (!schema.parameterValueModes.has(parameter.valueMode)) add('未知参数值模式', { skillKey, parameterKey: parameter.parameterKey, value: parameter.valueMode });
      if (parameter.valueMode === 'FIXED' && (parameter.fixedValue === null || parameter.fixedValue === undefined || parameter.levelValues !== null)) add('固定参数结构不完整', { skillKey, parameterKey: parameter.parameterKey });
      if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) add('运行输入带有默认值', { skillKey, parameterKey: parameter.parameterKey });
      if (parameter.valueMode === 'SKILL_LEVEL' && (parameter.fixedValue !== null || !parameter.levelValues || Object.keys(parameter.levelValues).length !== skill.maxLevel)) add('技能等级参数等级表不完整', { skillKey, parameterKey: parameter.parameterKey });
      const values = parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : [];
      if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) add('参数值不是有限数字', { skillKey, parameterKey: parameter.parameterKey });
      if (parameter.valueType === 'INTEGER' && values.some(value => !Number.isInteger(value))) add('整数参数含小数值', { skillKey, parameterKey: parameter.parameterKey });
    }
  }
  return { errors, references };
};
const candidateValidation = validateCandidate();
staticCheck('候选结构和目录引用有效', candidateValidation.errors.length === 0, candidateValidation.errors);
staticCheck('候选没有即时伤害或直接治疗', !JSON.stringify(candidateEntries.map(entry => entry.body)).includes('"resultType":"DAMAGE"') && !JSON.stringify(candidateEntries.map(entry => entry.body)).includes('"resultType":"DIRECT_HEAL"'), null);
staticCheck('候选没有过程状态规则', candidateEntries.every(entry => writableKinds.has(entry.kind)), null);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(herePath, '写入准备', `录入-${runId}`);
await fsp.mkdir(runDir, { recursive: true });
const httpJournal = path.join(runDir, 'HTTP流水.jsonl');
const writeJournal = path.join(runDir, '写入流水.jsonl');
const runLock = path.join(runDir, '运行锁.json');
const writeLock = path.join(herePath, '写入准备', '修订一实际录入写入锁.json');
const calls = [];
const writeEvents = [];
const appendJsonl = async (file, value) => {
  const handle = await fsp.open(file, 'a');
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
};
const saveJson = async (name, value) => fsp.writeFile(path.join(runDir, name), JSON.stringify(value, null, 2) + '\n');
const request = async (route, { method = 'GET', body } = {}) => {
  if (!route.startsWith('/') || route.includes('://') || route.includes('..')) throw Error(`非法接口路径 ${route}`);
  if (!['GET', 'POST'].includes(method)) throw Error(`禁止HTTP方法 ${method}`);
  if (method === 'POST') {
    if (!apply) throw Error('只读预检禁止POST');
    if (sha256(readBytes(candidateFile)) !== expected.candidateSha256 || sha256(readBytes(planFile)) !== expected.planFileSha256 || sha256(readBytes(freezeFile)) !== expected.freezeSha256 || sha256(readBytes(fullProtectionFile)) !== expected.fullProtectionSha256) throw Error('POST前冻结文件散列变化');
    const match = route.match(/^\/skills\/([^/]+)\/(parameters|formulas|effects)$/);
    if (!match || !skills.includes(match[1])) throw Error(`POST超出本批范围 ${route}`);
    const kind = kinds.find(item => item[2] === match[2]);
    const id = body?.[kind[1]];
    const entry = candidateById.get(keyOf(match[1], kind[0], id));
    if (!entry || reusedKeys.has(keyOf(match[1], kind[0], id)) || !equal(entry.body, body)) throw Error(`POST对象不等于263条新增冻结候选 ${route}/${id}`);
    const planned = (plan.requests ?? []).some(item => item.route === route && keyOf(item.skillKey, item.kind, item.stableKey ?? item.key) === keyOf(match[1], kind[0], id) && equal(item.body, body));
    if (!planned) throw Error(`POST不在263条冻结计划内 ${route}/${id}`);
  }
  const sequence = calls.length + 1;
  const startedAt = new Date().toISOString();
  await appendJsonl(httpJournal, { sequence, phase: '请求前', at: startedAt, method, route, ...(body ? { body } : {}) });
  const started = Date.now();
  let result;
  try {
    const response = await fetch(apiBase + route, { method, headers: { Authorization: `Bearer ${process.env.HERO17_API_TOKEN ?? 'local-entry'}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    const raw = await response.text();
    let data = null;
    let parseError = false;
    try { data = raw ? JSON.parse(raw) : null; } catch { parseError = true; }
    result = { route, method, status: response.status, ok: response.ok && !parseError, data, ...(parseError ? { parseError: true, responseBytes: Buffer.byteLength(raw), responseSha256: sha256(raw) } : {}) };
  } catch (error) {
    result = { route, method, status: null, ok: false, data: null, error: `${error.name}: ${error.message}` };
  }
  const completed = { sequence, phase: '请求后', at: new Date().toISOString(), method, route, elapsedMs: Date.now() - started, status: result.status, ok: result.ok, ...(result.error ? { error: result.error } : {}), ...(result.parseError ? { parseError: true, responseBytes: result.responseBytes, responseSha256: result.responseSha256 } : {}), data: result.data };
  await appendJsonl(httpJournal, completed);
  calls.push({ ...result, elapsedMs: completed.elapsedMs });
  return result;
};
const mustGet = async route => {
  const result = await request(route);
  if (!result.ok) throw Error(`GET失败 ${route} status=${result.status ?? 'network'}${result.error ? ` ${result.error}` : ''}`);
  return result;
};
const optionalMissingGet = async route => {
  const result = await request(route);
  if (!(result.status === 404 || result.ok)) throw Error(`缺项探测GET异常 ${route} status=${result.status ?? 'network'}${result.error ? ` ${result.error}` : ''}`);
  return result;
};
const fetchProtection = async () => {
  const result = { catalogs: {}, characters: {}, relations: {}, subjects: {}, images: {} };
  for (const [name] of catalogKinds) result.catalogs[name] = await mustGet(`/${name}`);
  for (const hero of heroes) {
    const characterKey = `champion_${hero}`;
    result.characters[hero] = await mustGet(`/characters/${characterKey}`);
    result.relations[hero] = await mustGet(`/character-skill-relations?characterKey=${encodeURIComponent(characterKey)}`);
  }
  for (const skillKey of skills) {
    result.subjects[skillKey] = await mustGet(`/skills/${skillKey}`);
    result.images[skillKey] = await mustGet(`/skills/${skillKey}/representative-image`);
  }
  return result;
};
const validateProtection = (before, after) => {
  const conflicts = [];
  for (const [name] of catalogKinds) {
    const difference = exactDiff(rows(before.catalogs?.[name]), rows(after.catalogs?.[name]));
    if (difference) conflicts.push({ type: 'catalog', name, diff: difference });
  }
  for (const skillKey of skills) {
    const subjectDifference = exactDiff(before.subjects?.[skillKey]?.data, after.subjects?.[skillKey]?.data);
    const imageDifference = exactDiff(before.images?.[skillKey]?.data, after.images?.[skillKey]?.data);
    if (subjectDifference) conflicts.push({ type: 'subject', skillKey, diff: subjectDifference });
    if (imageDifference) conflicts.push({ type: 'image', skillKey, diff: imageDifference });
  }
  for (const hero of heroes) {
    const characterDifference = exactDiff(before.characters?.[hero]?.data, after.characters?.[hero]?.data);
    const relationDifference = exactDiff(before.relations?.[hero]?.data, after.relations?.[hero]?.data);
    if (characterDifference) conflicts.push({ type: 'character', hero, diff: characterDifference });
    if (relationDifference) conflicts.push({ type: 'relation', hero, diff: relationDifference });
  }
  return conflicts;
};
const fetchComponentState = async (protection, phase) => {
  const lists = [];
  const details = [];
  const conflicts = [];
  const missing = [];
  const existing = [];
  for (const skillKey of skills) for (const [kind, key, endpointKind] of kinds) {
    const route = `/skills/${skillKey}/${endpointKind}`;
    const response = await mustGet(route);
    const items = rows(response);
    const ids = items.map(item => item[key]);
    const listKey = `${skillKey}/${kind}`;
    if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) conflicts.push({ phase, type: 'duplicateOrInvalidListKey', skillKey, kind, ids });
    if (phase === '写前') {
      const baselineItems = baselineLists.get(listKey) ?? [];
      const difference = exactDiff(baselineItems, items);
      if (difference) conflicts.push({ phase, type: 'baselineListChanged', skillKey, kind, diff: difference });
    }
    const listRecord = { skillKey, kind, route, status: response.status, items };
    lists.push(listRecord);
    for (const item of items) {
      const id = item[key];
      const detailRoute = `${route}/${encodeURIComponent(id)}`;
      const detailResponse = await mustGet(detailRoute);
      const listDifference = listSummaryDiff(item, detailResponse.data);
      if (listDifference) conflicts.push({ phase, type: 'listDetailMismatch', skillKey, kind, id, diff: listDifference });
      const record = { skillKey, kind, id, route: detailRoute, status: detailResponse.status, data: detailResponse.data, listItem: item, listSummaryDiff: listDifference };
      details.push(record);
      const componentKey = keyOf(skillKey, kind, id);
      const candidateEntry = candidateById.get(componentKey);
      if (!candidateEntry) conflicts.push({ phase, type: 'unexpectedExisting', skillKey, kind, id });
      if (reusedKeys.has(componentKey)) {
        const protectedDifference = exactDiff(baselineDetails.get(componentKey), detailResponse.data);
        if (protectedDifference) conflicts.push({ phase, type: 'protectedOriginalChanged', skillKey, kind, id, diff: protectedDifference });
        if (candidateEntry) {
          const valueDifference = businessDiff(candidateEntry.body, detailResponse.data);
          if (valueDifference) conflicts.push({ phase, type: 'reusedValueMismatch', skillKey, kind, id, diff: valueDifference });
        }
        existing.push({ skillKey, kind, id, classification: '保护并复用', oldProtected: true });
      } else if (candidateEntry) {
        const valueDifference = businessDiff(candidateEntry.body, detailResponse.data);
        if (valueDifference) conflicts.push({ phase, type: 'existingCandidateMismatch', skillKey, kind, id, diff: valueDifference });
        existing.push({ skillKey, kind, id, classification: valueDifference ? '现值异值' : '已有同值', oldProtected: false });
      }
    }
    const currentIds = new Set(items.map(item => item[key]));
    for (const entry of candidateEntries.filter(item => item.skillKey === skillKey && item.kind === kind)) {
      if (!currentIds.has(entry.id)) missing.push({ ...entry, idField: key });
    }
  }
  return { phase, startedAt: new Date().toISOString(), subjects: protection.subjects, lists, details, missing, existing, conflicts, counts: { lists: lists.length, details: details.length, existing: existing.length, missing: missing.length }, finishedAt: new Date().toISOString() };
};
const validateCatalogReferences = protection => {
  const sets = Object.fromEntries(catalogKinds.map(([name, key]) => [key, new Map(rows(protection.catalogs?.[name]).map(item => [item[key], item]))]));
  const references = [];
  const conflicts = [];
  const required = [];
  const walk = (value, at) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${at}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (sets[key] && typeof child === 'string') {
        const item = sets[key].get(child);
        const reference = { at: `${at}.${key}`, key, value: child, enabled: item?.status === 'ENABLED' };
        references.push(reference);
        if (!reference.enabled) conflicts.push(reference);
      }
      walk(child, `${at}.${key}`);
    }
  };
  for (const entry of candidateEntries) walk(entry.body, keyOf(entry.skillKey, entry.kind, entry.id));
  for (const [catalog, key] of [['attributes', 'mana'], ['attributes', 'move_speed_percent'], ['modifier-zones', 'attribute_flat_add']]) {
    const catalogKey = catalogKinds.find(item => item[0] === catalog)?.[1];
    const row = sets[catalogKey]?.get(key);
    const requiredCheck = { catalog, key, status: row?.status ?? null, passed: row?.status === 'ENABLED' };
    required.push(requiredCheck);
    references.push({ at: `required.${catalog}.${key}`, key: catalogKey, value: key, enabled: requiredCheck.passed, required: true });
    if (!row || row.status !== 'ENABLED') conflicts.push({ at: `required.${catalog}.${key}`, key: catalogKey, value: key, reason: row ? `状态为${row.status}` : '目录不存在' });
  }
  return { references, conflicts, required };
};
const acquireWriteLock = async () => {
  await fsp.mkdir(path.dirname(writeLock), { recursive: true });
  let handle;
  try { handle = await fsp.open(writeLock, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw Error('已有第十七批实际录入锁，禁止并行或重放');
    throw error;
  }
  try { await handle.writeFile(JSON.stringify({ at: new Date().toISOString(), runId, candidateSha256: expected.candidateSha256, planSha256: expected.planFileSha256, expectedPostCount: expected.newComponents, policy: '只允许263条冻结计划中的参数、公式、效果POST；其他对象永不POST。' }, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
};
const createIntent = async entry => {
  const intentDir = path.join(herePath, '写入准备', '修订一写入意图');
  await fsp.mkdir(intentDir, { recursive: true });
  const file = path.join(intentDir, `${sha256(`${expected.candidateSha256}\n${entry.route}\n${entry.id}`)}.json`);
  try {
    const handle = await fsp.open(file, 'wx');
    try { await handle.writeFile(JSON.stringify({ at: new Date().toISOString(), candidateSha256: expected.candidateSha256, route: entry.route, id: entry.id, method: 'POST', body: entry.body }, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    return { file, existed: false };
  } catch (error) {
    if (error.code === 'EEXIST') return { file, existed: true };
    throw error;
  }
};
const emitWrite = async event => {
  const value = { at: new Date().toISOString(), ...event };
  writeEvents.push(value);
  await appendJsonl(writeJournal, value);
  return value;
};

const report = {
  at: new Date().toISOString(),
  runId,
  mode: apply ? '仅创建冻结候选缺项' : '只读预检',
  apiBase,
  candidateFile,
  candidateSha256: expected.candidateSha256,
  candidatePlanSha256: expected.candidatePlanSha256,
  planFileSha256: expected.planFileSha256,
  freezeSha256: expected.freezeSha256,
  fullProtectionSha256: expected.fullProtectionSha256,
  source: 'client16.17/official16.17.1',
  expected: { catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, lists: 120, protectedDetails: 22, candidateDetails: 285, newComponents: 263, exactPostCount: 263 },
  candidateCounts: { total: candidateEntries.length, new: expectedNewEntries.length, reused: reusedKeys.size },
  staticChecks,
  staticFailures,
  apiWrites: 0,
  calls: null,
  writeEvents: 0,
  success: false,
  errors: [],
};
const saveReport = async () => {
  report.calls = { total: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}) };
  report.apiWrites = calls.filter(item => item.method === 'POST').length;
  report.writeEvents = writeEvents.length;
  await saveJson('执行结果.json', report);
};
await fsp.writeFile(runLock, JSON.stringify({ at: new Date().toISOString(), runId, mode: apply ? 'apply' : 'preflight', candidateSha256: expected.candidateSha256, planSha256: expected.planFileSha256, expectedApiWrites: apply ? expected.newComponents : 0 }, null, 2) + '\n');
await appendJsonl(httpJournal, { sequence: 0, phase: '运行开始', at: new Date().toISOString(), method: 'NONE', route: null, mode: apply ? 'apply' : 'preflight' });

let beforeProtection = null;
let beforeCatalog = null;
let beforeComponents = null;
try {
  if (staticFailures.length) throw Error(`静态冻结校验失败 ${staticFailures.length}项`);
  beforeProtection = await fetchProtection();
  beforeCatalog = validateCatalogReferences(beforeProtection);
  const protectionConflicts = validateProtection(baseline.protection, beforeProtection);
  await saveJson('写前保护.json', beforeProtection);
  beforeComponents = await fetchComponentState(beforeProtection, '写前');
  const allConflicts = [...protectionConflicts, ...beforeCatalog.conflicts, ...beforeComponents.conflicts];
  if (beforeComponents.details.length !== expected.reusedPublicParameters) allConflicts.push({ type: 'protectedDetailCount', actual: beforeComponents.details.length, expected: expected.reusedPublicParameters });
  const actualReuse = beforeComponents.existing.filter(item => item.oldProtected).map(item => keyOf(item.skillKey, item.kind, item.id));
  for (const key of reusedKeys) if (!actualReuse.includes(key)) allConflicts.push({ type: 'reuseMissing', key });
  for (const key of actualReuse) if (!reusedKeys.has(key)) allConflicts.push({ type: 'reuseUnexpected', key });
  if (beforeComponents.missing.length !== expected.newComponents) allConflicts.push({ type: 'missingCount', actual: beforeComponents.missing.length, expected: expected.newComponents });
  if (beforeComponents.existing.length + beforeComponents.missing.length !== expected.totalComponents) allConflicts.push({ type: 'candidateCoverage', existing: beforeComponents.existing.length, missing: beforeComponents.missing.length, expected: expected.totalComponents });
  await saveJson('写前组件现值.json', { ...beforeComponents, protectionConflicts, catalogReferences: beforeCatalog.references, catalogConflicts: beforeCatalog.conflicts, allConflicts });
  report.preflight = { pass: allConflicts.length === 0, protectionConflicts: protectionConflicts.length, catalogReferences: beforeCatalog.references.length, catalogConflicts: beforeCatalog.conflicts.length, requiredCatalogChecks: beforeCatalog.required, conflicts: allConflicts.length, counts: beforeComponents.counts, missingByKind: Object.fromEntries(kinds.map(([kind]) => [kind, beforeComponents.missing.filter(item => item.kind === kind).length])) };
  await saveReport();
  if (allConflicts.length) throw Error(`写前保护、目录或组成冲突 ${allConflicts.length}项`);
  if (!apply) {
    report.success = true;
    report.next = '主负责人审查后，设置 HERO17_APPLY_CONFIRM=CONFIRM_HERO17_COMPONENT_POSTS，再以 --apply 执行一次；当前未发送POST。';
  } else {
    await acquireWriteLock();
    await emitWrite({ phase: '写入锁已取得', expectedPostCount: beforeComponents.missing.length });
    const applyResult = { startedAt: new Date().toISOString(), expected: beforeComponents.missing.length, confirmed: 0, postCount: 0, stopped: false, stopReason: null };
    for (const entry of beforeComponents.missing) {
      const before = await optionalMissingGet(entry.route);
      if (before.status === 200) {
        const difference = businessDiff(entry.body, before.data);
        if (difference) throw Error(`写前缺项已异值 ${entry.skillKey}/${entry.kind}/${entry.id}`);
        await emitWrite({ skillKey: entry.skillKey, kind: entry.kind, id: entry.id, action: '已有同值，跳过POST', beforeStatus: before.status });
        applyResult.confirmed++;
        continue;
      }
      const intent = await createIntent(entry);
      if (intent.existed) {
        applyResult.stopped = true;
        applyResult.stopReason = { phase: '写前意图防重放', skillKey: entry.skillKey, kind: entry.kind, id: entry.id, intentFile: intent.file };
        await emitWrite({ ...applyResult.stopReason, action: '已有写前意图且仍缺失，停止全部写入' });
        break;
      }
      await emitWrite({ skillKey: entry.skillKey, kind: entry.kind, id: entry.id, action: '准备创建', route: entry.base, body: entry.body, intentFile: intent.file });
      const post = await request(entry.base, { method: 'POST', body: entry.body });
      const after = await mustGet(entry.route);
      const difference = businessDiff(entry.body, after.data);
      const matched = !difference;
      await emitWrite({ skillKey: entry.skillKey, kind: entry.kind, id: entry.id, action: post.ok && matched ? '创建后逐条GET确认' : '响应或回读异常，停止全部写入', postStatus: post.status, postOk: post.ok, readbackStatus: after.status, matched, diff: difference, actual: after.data });
      applyResult.postCount++;
      if (!post.ok || !matched) {
        applyResult.stopped = true;
        applyResult.stopReason = { phase: '写后完整GET对账', skillKey: entry.skillKey, kind: entry.kind, id: entry.id, postStatus: post.status, readbackStatus: after.status, diff: difference };
        break;
      }
      applyResult.confirmed++;
    }
    applyResult.finishedAt = new Date().toISOString();
    report.apply = applyResult;
    await saveJson('实际写入结果.json', applyResult);
    await saveReport();
    if (applyResult.stopped || applyResult.confirmed !== beforeComponents.missing.length || applyResult.postCount !== expected.newComponents) throw Error('实际补缺没有完成263条逐条GET确认');
    const afterProtection = await fetchProtection();
    const protectionDrift = validateProtection(beforeProtection, afterProtection);
    await saveJson('写后保护.json', afterProtection);
    const afterComponents = await fetchComponentState(afterProtection, '写后');
    await saveJson('最终全量组件现值.json', afterComponents);
    report.final = { details: afterComponents.details.length, lists: afterComponents.lists.length, missing: afterComponents.missing.length, existing: afterComponents.existing.length, conflicts: afterComponents.conflicts.length, protectionDrift: protectionDrift.length, pass: afterComponents.details.length === expected.totalComponents && afterComponents.lists.length === 120 && afterComponents.missing.length === 0 && afterComponents.conflicts.length === 0 && protectionDrift.length === 0 };
    if (!report.final.pass) throw Error('写后全量组成或保护回读未通过');
    report.success = true;
  }
} catch (error) {
  report.errors.push({ name: error.name, message: error.message });
} finally {
  report.finishedAt = new Date().toISOString();
  await saveReport();
}
console.log(JSON.stringify({ success: report.success, mode: report.mode, runId, apiWrites: report.apiWrites, calls: report.calls, preflight: report.preflight ?? null, apply: report.apply ? { confirmed: report.apply.confirmed, postCount: report.apply.postCount, stopped: report.apply.stopped } : null, final: report.final ?? null, errors: report.errors, output: runDir }, null, 2));
if (!report.success) process.exitCode = 1;
